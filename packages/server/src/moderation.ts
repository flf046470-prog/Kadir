import { AUTO_MUTE_MS, KICK_REJOIN_MS, MemorySanctionStore, ReportTracker, autoMuteThreshold } from '@kc/core';
import type { PlayerProfile, SanctionStore } from '@kc/core';
import type { ModActionKind, ModReportView, ServerMessage } from '@kc/net';
import type { AccountService } from './accounts.js';

/** A permanent ban, as stored on the profile. */
export const PERMANENT = Number.MAX_SAFE_INTEGER;
/** Longest temporary sanction a moderator can type: 30 days. Anything longer is a permanent ban. */
const MAX_MINUTES = 30 * 24 * 60;
const QUEUE_SIZE = 200;

/** What the moderation service needs to know about the live rooms, without importing them. */
export interface LivePlayers {
  /** Name and room of a connected player, or null when they are offline. */
  find(playerId: string): { name: string; roomCode: string; roomSize: number } | null;
  send(playerId: string, message: ServerMessage): void;
  /** Close the player's socket with a reason the client can show. */
  disconnect(playerId: string, code: number, reason: string): void;
  /** Tell everyone in the player's room to drop their voice calls to them. */
  silenceVoice(playerId: string): void;
  /**
   * The profile object a connected player's room holds, or null when offline. A sanction has to
   * be written to *this* object: the room saves it when the player leaves, and a copy loaded from
   * the store would be overwritten by it — measured, a ban applied that way vanished the moment
   * the kick that follows it saved the room's stale profile.
   */
  liveProfile(playerId: string): PlayerProfile | null;
}

/**
 * Moderators, sanctions and the report queue — server-wide, because a player's behaviour does not
 * stop at a room door and neither should a mute.
 *
 * Before this, every piece existed and none of them connected: `SanctionStore` had `kick`, `mute`
 * and `ban`, but each room built its own empty store so a mute died with the room; nothing ever
 * issued a sanction, nothing checked a ban at login, and reports went into a list nobody could
 * read. The client, for its part, never sent a report at all.
 *
 * Who is a moderator is configuration (`KC_MODERATORS`, player ids) and is decided from the verified
 * session — a client cannot claim it. Bans and mutes are written onto the target's profile, so they
 * survive a restart and follow the account into any room.
 */
export class ModerationService {
  readonly sanctions: SanctionStore = new MemorySanctionStore();
  private readonly tracker = new ReportTracker();
  private readonly queue: ModReportView[] = [];
  private readonly kicks = new Map<string, number>();
  private readonly online = new Set<string>();
  private live: LivePlayers | null = null;
  private nextReportId = 1;

  constructor(
    private readonly moderators: ReadonlySet<string>,
    private readonly accounts: AccountService,
  ) {}

  attach(live: LivePlayers): void {
    this.live = live;
  }

  isModerator(playerId: string): boolean {
    return this.moderators.has(playerId);
  }

  /**
   * At login: refuse a banned account, and re-arm a mute that outlived the last session. Returns
   * the refusal message, or null to let the player in.
   */
  admit(profile: PlayerProfile, now = Date.now()): string | null {
    if (profile.banUntil && profile.banUntil > now) {
      return profile.banUntil >= PERMANENT
        ? `This account is banned.${profile.sanctionReason ? ` Reason: ${profile.sanctionReason}` : ''}`
        : `This account is banned until ${new Date(profile.banUntil).toUTCString()}.`;
    }
    if (profile.muteUntil && profile.muteUntil > now && !this.sanctions.active(profile.playerId, now, 'mute')) {
      this.sanctions.add({ kind: 'mute', targetId: profile.playerId, expiresAt: profile.muteUntil, reason: 'other', issuedBy: 'system', at: now });
    }
    return null;
  }

  isMuted(playerId: string, now = Date.now()): boolean {
    return this.sanctions.active(playerId, now, 'mute') !== null;
  }

  isKickedFrom(roomCode: string, playerId: string, now = Date.now()): boolean {
    const until = this.kicks.get(`${roomCode}:${playerId}`);
    if (until === undefined) return false;
    if (until <= now) {
      this.kicks.delete(`${roomCode}:${playerId}`);
      return false;
    }
    return true;
  }

  moderatorOnline(playerId: string, online: boolean): void {
    if (!this.isModerator(playerId)) return;
    if (online) this.online.add(playerId);
    else this.online.delete(playerId);
  }

  /** A report was accepted by a room's limiter. Queues it, tells moderators, and may auto-mute. */
  report(reporterId: string, targetId: string, reason: string, now = Date.now()): ModReportView {
    const live = this.live;
    const target = live?.find(targetId) ?? null;
    const reporter = live?.find(reporterId) ?? null;
    const reporters = this.tracker.record(targetId, reporterId, now);
    const view: ModReportView = {
      id: String(this.nextReportId++),
      reporterId,
      reporterName: reporter?.name ?? reporterId,
      targetId,
      targetName: target?.name ?? targetId,
      reason: reason.slice(0, 200),
      roomCode: target?.roomCode ?? reporter?.roomCode ?? '',
      at: now,
      reporters,
    };
    if (target && reporters >= autoMuteThreshold(target.roomSize) && !this.isMuted(targetId, now)) {
      view.autoMuted = true;
      void this.applyMute(targetId, now + AUTO_MUTE_MS, 'Muted automatically after reports from several players.', 'system', now);
    }
    this.queue.push(view);
    if (this.queue.length > QUEUE_SIZE) this.queue.shift();
    for (const id of this.online) live?.send(id, { t: 'mod-report', report: view });
    return view;
  }

  recentReports(): ModReportView[] {
    return [...this.queue].reverse();
  }

  /** A moderator's action. Everything a non-moderator sends here is refused. */
  async act(issuerId: string, action: ModActionKind, targetId: string, minutes = 0, reason = '', now = Date.now()): Promise<{ ok: boolean; message: string }> {
    if (!this.isModerator(issuerId)) return { ok: false, message: 'Not a moderator.' };
    if (!targetId || targetId === issuerId) return { ok: false, message: 'Pick another player.' };
    if (this.isModerator(targetId)) return { ok: false, message: 'Moderators cannot sanction each other here.' };
    const live = this.live;
    const target = live?.find(targetId) ?? null;
    const name = target?.name ?? targetId;
    const note = reason.trim().slice(0, 200);
    const span = Math.min(MAX_MINUTES, Math.max(1, Math.round(minutes || 0)));

    switch (action) {
      case 'kick': {
        if (!target) return { ok: false, message: `${name} is not online.` };
        this.kicks.set(`${target.roomCode}:${targetId}`, now + KICK_REJOIN_MS);
        live?.send(targetId, { t: 'sanctioned', kind: 'kick', until: now + KICK_REJOIN_MS, message: `A moderator removed you from this room.${note ? ` Reason: ${note}` : ''}` });
        live?.disconnect(targetId, 4010, 'kicked');
        return { ok: true, message: `${name} was kicked.` };
      }
      case 'mute':
        await this.applyMute(targetId, now + span * 60_000, `A moderator muted you for ${span} min.${note ? ` Reason: ${note}` : ''}`, issuerId, now, note);
        return { ok: true, message: `${name} is muted for ${span} min.` };
      case 'unmute': {
        this.sanctions.lift(targetId, 'mute');
        this.tracker.clear(targetId);
        await this.updateProfile(targetId, (p) => {
          delete p.muteUntil;
        });
        live?.send(targetId, { t: 'sanctioned', kind: 'unmute', until: 0, message: 'You can talk again.' });
        return { ok: true, message: `${name} is unmuted.` };
      }
      case 'ban': {
        const until = minutes > 0 ? now + span * 60_000 : PERMANENT;
        this.sanctions.add({ kind: 'ban', targetId, expiresAt: until >= PERMANENT ? 0 : until, reason: 'other', issuedBy: issuerId, at: now });
        await this.updateProfile(targetId, (p) => {
          p.banUntil = until;
          if (note) p.sanctionReason = note;
        });
        if (target) {
          live?.send(targetId, { t: 'sanctioned', kind: 'ban', until: until >= PERMANENT ? 0 : until, message: `A moderator banned this account${until >= PERMANENT ? '' : ` for ${span} min`}.${note ? ` Reason: ${note}` : ''}` });
          live?.disconnect(targetId, 4011, 'banned');
        }
        return { ok: true, message: until >= PERMANENT ? `${name} is banned permanently.` : `${name} is banned for ${span} min.` };
      }
      case 'unban':
        this.sanctions.lift(targetId, 'ban');
        await this.updateProfile(targetId, (p) => {
          delete p.banUntil;
        });
        return { ok: true, message: `${name} is unbanned.` };
      default:
        return { ok: false, message: 'Unknown action.' };
    }
  }

  private async applyMute(targetId: string, until: number, message: string, issuedBy: string, now: number, note = ''): Promise<void> {
    this.sanctions.lift(targetId, 'mute');
    this.sanctions.add({ kind: 'mute', targetId, expiresAt: until, reason: 'voice-abuse', issuedBy, at: now });
    this.live?.silenceVoice(targetId);
    this.live?.send(targetId, { t: 'sanctioned', kind: 'mute', until, message });
    await this.updateProfile(targetId, (p) => {
      p.muteUntil = until;
      if (note) p.sanctionReason = note;
    });
  }

  private async updateProfile(playerId: string, change: (profile: PlayerProfile) => void): Promise<void> {
    const profile = this.live?.liveProfile(playerId) ?? (await this.accounts.loadOrCreate(playerId));
    change(profile);
    await this.accounts.save(profile);
  }
}

/** `KC_MODERATORS`: comma-separated player ids. */
export function parseModerators(raw: string | undefined): Set<string> {
  return new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}
