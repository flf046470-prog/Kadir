/**
 * Analytics abstraction.
 *
 * Deliberately narrow: the product questions we care about (retention, which mode and animal
 * people actually play, how long a round runs) are answerable from aggregate counters. No
 * personal data, no free text, no positions — `sanitizeParams` drops anything unexpected.
 */
export type AnalyticsEventName =
  | 'session_start'
  | 'session_end'
  | 'match_start'
  | 'match_end'
  | 'mode_selected'
  | 'animal_selected'
  | 'cosmetic_equipped'
  | 'store_viewed'
  | 'purchase_completed'
  | 'daily_claimed'
  | 'achievement_unlocked'
  | 'tutorial_step'
  | 'quality_tier_changed'
  | 'error';

export type AnalyticsValue = string | number | boolean;
export type AnalyticsParams = Record<string, AnalyticsValue>;

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  params: AnalyticsParams;
  at: number;
}

export interface Analytics {
  track(name: AnalyticsEventName, params?: AnalyticsParams): void;
  flush(): Promise<void>;
}

const ALLOWED_KEYS = new Set([
  'mode',
  'animal',
  'cosmetic',
  'slot',
  'platform',
  'quality',
  'durationSeconds',
  'players',
  'placement',
  'score',
  'tags',
  'itemId',
  'priceCents',
  'currency',
  'streak',
  'achievementId',
  'step',
  'code',
  'fps',
  'level',
  'won',
]);

export function sanitizeParams(params: AnalyticsParams | undefined): AnalyticsParams {
  if (!params) return {};
  const out: AnalyticsParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 40);
    else if (typeof value === 'number') out[key] = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
    else out[key] = value;
  }
  return out;
}

/** Buffers events and hands them to a sink in batches. The sink is injected per platform. */
export class BufferedAnalytics implements Analytics {
  private buffer: AnalyticsEvent[] = [];

  constructor(
    private readonly sink: (events: AnalyticsEvent[]) => Promise<void>,
    private readonly maxBuffer = 50,
    private readonly enabled = true,
  ) {}

  track(name: AnalyticsEventName, params?: AnalyticsParams): void {
    if (!this.enabled) return;
    this.buffer.push({ name, params: sanitizeParams(params), at: Date.now() });
    if (this.buffer.length >= this.maxBuffer) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    await this.sink(batch);
  }

  get pending(): number {
    return this.buffer.length;
  }
}

export const NullAnalytics: Analytics = {
  track() {},
  async flush() {},
};
