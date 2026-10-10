/**
 * Moderation model.
 *
 * Mute/block are client-side and instant (a player should never wait for a server round-trip to
 * silence someone). Report/kick/ban are server-side decisions; this module defines the shared
 * shapes and the rate limits so the same rules apply wherever they run.
 */
export type ReportReason = 'harassment' | 'cheating' | 'inappropriate-name' | 'voice-abuse' | 'griefing' | 'other';

export interface Report {
  id: string;
  reporterId: string;
  targetId: string;
  reason: ReportReason;
  /** Room the incident happened in — enough context for review without storing chat logs. */
  roomCode: string;
  at: number;
}

export type SanctionKind = 'kick' | 'mute' | 'ban';

export interface Sanction {
  kind: SanctionKind;
  targetId: string;
  /** Unix ms; 0 means permanent. */
  expiresAt: number;
  reason: ReportReason;
  issuedBy: string;
  at: number;
}

export interface ModerationState {
  muted: Set<string>;
  blocked: Set<string>;
}

export function createModerationState(muted: string[] = [], blocked: string[] = []): ModerationState {
  return { muted: new Set(muted), blocked: new Set(blocked) };
}

export function isMuted(state: ModerationState, playerId: string): boolean {
  return state.muted.has(playerId) || state.blocked.has(playerId);
}

/** Blocked players are hidden and silenced, and cannot be matched into the same private room. */
export function isBlocked(state: ModerationState, playerId: string): boolean {
  return state.blocked.has(playerId);
}

export const REPORT_COOLDOWN_MS = 30_000;
export const MAX_REPORTS_PER_HOUR = 10;

export class ReportLimiter {
  private history = new Map<string, number[]>();

  allow(reporterId: string, now = Date.now()): boolean {
    const times = (this.history.get(reporterId) ?? []).filter((t) => now - t < 3_600_000);
    if (times.length >= MAX_REPORTS_PER_HOUR) return false;
    const last = times.at(-1);
    if (last !== undefined && now - last < REPORT_COOLDOWN_MS) return false;
    times.push(now);
    this.history.set(reporterId, times);
    return true;
  }

  reset(reporterId?: string): void {
    if (reporterId) this.history.delete(reporterId);
    else this.history.clear();
  }
}

/** How long a kicked player is kept out of the room they were kicked from. */
export const KICK_REJOIN_MS = 5 * 60_000;

/**
 * Automatic mute, for when no moderator is online.
 *
 * A report used to be written to a log and nothing else — "recorded for human review; no automated
 * punishment" — and there was no human, and no way for one to read the log. So a player shouting
 * slurs into proximity voice kept doing it for the whole round however many people reported them.
 *
 * The rule is deliberately hard to weaponise: it counts **distinct** reporters (one angry player
 * reporting ten times is one report, and the limiter caps them anyway), in a short window, and needs
 * at least three of them *and* three tenths of everybody else in the room — a party of friends in a
 * 32-player lobby cannot mute a stranger by themselves. The mute is temporary, and it only stops
 * this player's chat and voice reaching others; it takes nothing else away. Moderators are told.
 */
export const AUTO_MUTE_WINDOW_MS = 10 * 60_000;
export const AUTO_MUTE_MS = 10 * 60_000;
export const AUTO_MUTE_MIN_REPORTERS = 3;

export function autoMuteThreshold(roomSize: number): number {
  return Math.max(AUTO_MUTE_MIN_REPORTERS, Math.ceil(Math.max(0, roomSize - 1) * 0.3));
}

/** Distinct reporters per target over a sliding window. */
export class ReportTracker {
  private byTarget = new Map<string, Map<string, number>>();

  /** Record a report; returns how many distinct players reported this target inside the window. */
  record(targetId: string, reporterId: string, now = Date.now()): number {
    const reporters = this.byTarget.get(targetId) ?? new Map<string, number>();
    reporters.set(reporterId, now);
    for (const [id, at] of reporters) if (now - at > AUTO_MUTE_WINDOW_MS) reporters.delete(id);
    this.byTarget.set(targetId, reporters);
    return reporters.size;
  }

  count(targetId: string, now = Date.now()): number {
    const reporters = this.byTarget.get(targetId);
    if (!reporters) return 0;
    let n = 0;
    for (const at of reporters.values()) if (now - at <= AUTO_MUTE_WINDOW_MS) n++;
    return n;
  }

  clear(targetId: string): void {
    this.byTarget.delete(targetId);
  }
}

export interface SanctionStore {
  active(playerId: string, now?: number, kind?: SanctionKind): Sanction | null;
  add(sanction: Sanction): void;
  lift(playerId: string, kind: SanctionKind): void;
}

export class MemorySanctionStore implements SanctionStore {
  private map = new Map<string, Sanction[]>();

  active(playerId: string, now = Date.now(), kind?: SanctionKind): Sanction | null {
    const list = this.map.get(playerId) ?? [];
    for (const sanction of list) {
      if (kind && sanction.kind !== kind) continue;
      if (sanction.expiresAt === 0 || sanction.expiresAt > now) return sanction;
    }
    return null;
  }

  add(sanction: Sanction): void {
    const list = this.map.get(sanction.targetId) ?? [];
    list.push(sanction);
    this.map.set(sanction.targetId, list);
  }

  /** Lift every active sanction of one kind — an unmute, an unban. */
  lift(playerId: string, kind: SanctionKind): void {
    const list = this.map.get(playerId);
    if (!list) return;
    this.map.set(
      playerId,
      list.filter((s) => s.kind !== kind),
    );
  }
}

/** Light profanity/impersonation guard for display names. Not a substitute for human review. */
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _-]{1,15}$/u;
const RESERVED = ['admin', 'moderator', 'kangaroochase', 'system', 'server'];

export function isAcceptableName(name: string): boolean {
  const trimmed = name.trim();
  if (!NAME_PATTERN.test(trimmed)) return false;
  const lower = trimmed.toLowerCase().replace(/[\s_-]/g, '');
  return !RESERVED.some((word) => lower.includes(word));
}

export function sanitizeName(name: string, fallback = 'Roo'): string {
  const trimmed = name.trim().slice(0, 16);
  return isAcceptableName(trimmed) ? trimmed : fallback;
}
