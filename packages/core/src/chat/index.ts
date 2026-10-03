import { containsBlockedWord, sanitiseChatText } from './filter.js';
import type { FilterOptions } from './filter.js';

export * from './filter.js';

/**
 * Text chat.
 *
 * Chat is the cheapest feature in this game to build and the most expensive one to get wrong: it
 * is the reason an age rating exists, the main vector for harassment, and the thing a store will
 * actually check before approving a social title. So the interesting code here is not "deliver a
 * string" — it is the rate limit and the filter, and the fact that both run on the server, where
 * a modified client cannot skip them.
 *
 * Everything here is pure and clock-injectable, so the limits can be tested without waiting real
 * seconds for them.
 */

export type ChatChannel = 'room' | 'team' | 'system';

export interface ChatMessage {
  playerId: string;
  name: string;
  channel: ChatChannel;
  text: string;
  at: number;
}

export type ChatRejection = 'empty' | 'too-fast' | 'repeated' | 'blocked-word' | 'muted';

export interface ChatVerdict {
  ok: boolean;
  /** The cleaned text, present when `ok`. */
  text?: string;
  reason?: ChatRejection;
}

export interface ChatLimits {
  /** Messages allowed inside `windowMs`. */
  burst: number;
  windowMs: number;
  /** Minimum gap between two messages from the same player. */
  minGapMs: number;
  /** How many of the player's own recent messages are checked for repeats. */
  repeatMemory: number;
  maxLength: number;
}

export const DEFAULT_CHAT_LIMITS: ChatLimits = {
  burst: 5,
  windowMs: 10_000,
  minGapMs: 700,
  repeatMemory: 3,
  maxLength: 140,
};

interface History {
  times: number[];
  recent: string[];
}

/**
 * Server-side chat gate. One instance per room.
 *
 * Holds a little history per player — send times and the last few messages — which is what makes
 * it possible to catch the two things that actually ruin a lobby: flooding, and posting the same
 * line over and over just under the flood limit.
 */
export class ChatGuard {
  private history = new Map<string, History>();
  private limits: ChatLimits;
  private filter: FilterOptions;

  constructor(limits: Partial<ChatLimits> = {}, filter: FilterOptions = {}) {
    this.limits = { ...DEFAULT_CHAT_LIMITS, ...limits };
    this.filter = filter;
  }

  /**
   * Decide whether a message may be sent, and return the text that should be.
   *
   * A rejection is never silent to the sender — the caller tells them why — but it is always
   * silent to everyone else, because a blocked message that other players can see was blocked is
   * still a delivered message.
   */
  check(playerId: string, raw: string, now = Date.now()): ChatVerdict {
    const text = sanitiseChatText(raw, this.limits.maxLength);
    if (!text) return { ok: false, reason: 'empty' };

    const entry = this.entry(playerId);
    const times = entry.times.filter((t) => now - t < this.limits.windowMs);

    const last = times.at(-1);
    if (last !== undefined && now - last < this.limits.minGapMs) {
      // Not recorded: a rejected message must not count towards the burst, or a player held at
      // the gap limit would lock themselves out of the whole window by retrying.
      entry.times = times;
      return { ok: false, reason: 'too-fast' };
    }
    if (times.length >= this.limits.burst) {
      entry.times = times;
      return { ok: false, reason: 'too-fast' };
    }

    const folded = text.toLowerCase();
    if (entry.recent.includes(folded)) {
      entry.times = times;
      return { ok: false, reason: 'repeated' };
    }

    if (containsBlockedWord(text, this.filter)) {
      // Recorded as a send, deliberately: filter evasion is iterative, and letting someone try
      // twenty variants for free is how they find the one that gets through.
      times.push(now);
      entry.times = times;
      return { ok: false, reason: 'blocked-word' };
    }

    times.push(now);
    entry.times = times;
    entry.recent.push(folded);
    if (entry.recent.length > this.limits.repeatMemory) entry.recent.shift();

    return { ok: true, text };
  }

  /** Drop a player's history when they leave, so a long-lived room does not grow forever. */
  forget(playerId: string): void {
    this.history.delete(playerId);
  }

  reset(): void {
    this.history.clear();
  }

  private entry(playerId: string): History {
    let entry = this.history.get(playerId);
    if (!entry) {
      entry = { times: [], recent: [] };
      this.history.set(playerId, entry);
    }
    return entry;
  }
}

/** Human-readable reason, shown to the sender only. */
export function explainRejection(reason: ChatRejection): string {
  switch (reason) {
    case 'empty':
      return 'Nothing to send.';
    case 'too-fast':
      return 'Slow down a moment.';
    case 'repeated':
      return 'You just said that.';
    case 'blocked-word':
      return 'That message was not sent.';
    case 'muted':
      return 'You cannot chat right now.';
  }
}
