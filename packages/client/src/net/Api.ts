import type { AnimalDef, CosmeticDef, GameModeDef, PlayerProfile, StoreItem } from '@kc/core';

export interface ProfileBundle {
  profile: PlayerProfile;
  daily: { index: number; reward: { kind: string; amount?: number; contentId?: string }; claimable: boolean }[];
  season: { level: number; xp: number; xpIntoLevel: number; xpPerLevel: number; premiumOwned: boolean; claimable: unknown[] };
  achievements: { def: { id: string; name: string; description: string; threshold: number }; value: number; done: boolean }[];
}

export interface ContentBundle {
  animals: AnimalDef[];
  cosmetics: CosmeticDef[];
  store: StoreItem[];
  modes: GameModeDef[];
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  animalId: string;
  ticks: number;
}

/**
 * HTTP client for everything transactional: identity, profile, purchases, dailies, leaderboards.
 * Kept separate from the game socket because these operations must be authenticated per request
 * and are safe to retry — unlike gameplay intents, which are fire-and-forget.
 */
export class Api {
  private token: string | null = null;

  constructor(private readonly baseUrl = '') {}

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);

    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
    if (!response.ok) {
      throw new ApiError(body.error ?? `${response.status}`, response.status);
    }
    return body;
  }

  createGuest(name: string): Promise<{ playerId: string; token: string; profile: PlayerProfile }> {
    return this.request('/api/guest', { method: 'POST', body: JSON.stringify({ name }) });
  }

  getProfile(): Promise<ProfileBundle> {
    return this.request('/api/profile');
  }

  setName(name: string): Promise<{ profile: PlayerProfile }> {
    return this.request('/api/profile/name', { method: 'POST', body: JSON.stringify({ name }) });
  }

  getContent(): Promise<ContentBundle> {
    return this.request('/api/content');
  }

  equipAnimal(animalId: string): Promise<{ equipped: PlayerProfile['equipped'] }> {
    return this.request('/api/equip', { method: 'POST', body: JSON.stringify({ animalId }) });
  }

  equipCosmetic(slot: string, cosmeticId: string | null): Promise<{ equipped: PlayerProfile['equipped'] }> {
    return this.request('/api/equip', { method: 'POST', body: JSON.stringify({ slot, cosmeticId }) });
  }

  purchase(itemId: string, receipt: string): Promise<{ granted: string[]; coins: number }> {
    return this.request('/api/purchase', { method: 'POST', body: JSON.stringify({ itemId, receipt }) });
  }

  purchaseWithCoins(itemId: string): Promise<{ granted: string[]; coins: number }> {
    return this.request('/api/purchase/coins', { method: 'POST', body: JSON.stringify({ itemId }) });
  }

  claimDaily(): Promise<{ claim: { ok: boolean; streak: number; reward?: { kind: string; amount?: number } }; coins: number }> {
    return this.request('/api/daily/claim', { method: 'POST' });
  }

  claimSeason(): Promise<{ claimed: { claimed: unknown[] } }> {
    return this.request('/api/season/claim', { method: 'POST' });
  }

  leaderboard(levelId: string): Promise<{ entries: LeaderboardEntry[] }> {
    return this.request(`/api/leaderboard/${encodeURIComponent(levelId)}`);
  }

  rooms(): Promise<{ rooms: { code: string; modeId: string; players: number; max: number }[] }> {
    return this.request('/api/rooms');
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
