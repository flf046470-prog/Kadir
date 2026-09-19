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

export interface SanctionStore {
  active(playerId: string, now?: number): Sanction | null;
  add(sanction: Sanction): void;
}

export class MemorySanctionStore implements SanctionStore {
  private map = new Map<string, Sanction[]>();

  active(playerId: string, now = Date.now()): Sanction | null {
    const list = this.map.get(playerId) ?? [];
    for (const sanction of list) {
      if (sanction.expiresAt === 0 || sanction.expiresAt > now) return sanction;
    }
    return null;
  }

  add(sanction: Sanction): void {
    const list = this.map.get(sanction.targetId) ?? [];
    list.push(sanction);
    this.map.set(sanction.targetId, list);
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
