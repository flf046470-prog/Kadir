import { DEFAULT_SETTINGS, mergeSettings } from '@kc/core';
import type { Settings } from '@kc/core';

const KEYS = {
  settings: 'kc.settings.v1',
  session: 'kc.session.v1',
  name: 'kc.name.v1',
  tutorial: 'kc.tutorial.v1',
} as const;

/**
 * Where a session is kept. A token is only good on the server that issued it, and a PC build has
 * two — the hosted one and the one it carries (`net/servers.ts`) — so one key would hand each the
 * other's token. The page's own server keeps the original key, so nobody already signed in on the
 * web is signed out by this.
 */
export function sessionKeyFor(server: string | null): string {
  return server ? `${KEYS.session}@${server}` : KEYS.session;
}

export interface SessionInfo {
  playerId: string;
  token: string;
}

/**
 * Local persistence for things that are safe to keep on the device: settings, the session token
 * and whether the tutorial has been seen. Everything that affects entitlements (coins, owned
 * content, progress) lives on the server — this store is a cache and a convenience, never a
 * source of truth.
 */
export class LocalStore {
  private available: boolean;

  constructor() {
    this.available = probeStorage();
  }

  loadSettings(): Settings {
    if (!this.available) return structuredClone(DEFAULT_SETTINGS);
    try {
      const raw = localStorage.getItem(KEYS.settings);
      return mergeSettings(raw ? JSON.parse(raw) : null);
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  saveSettings(settings: Settings): void {
    this.write(KEYS.settings, JSON.stringify(settings));
  }

  /** The session for `server` — null meaning the server that served this page. */
  loadSession(server: string | null = null): SessionInfo | null {
    const raw = this.read(sessionKeyFor(server));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as SessionInfo;
      return parsed.playerId && parsed.token ? parsed : null;
    } catch {
      return null;
    }
  }

  saveSession(session: SessionInfo, server: string | null = null): void {
    this.write(sessionKeyFor(server), JSON.stringify(session));
  }

  clearSession(server: string | null = null): void {
    this.remove(sessionKeyFor(server));
  }

  loadName(): string {
    return this.read(KEYS.name) ?? '';
  }

  saveName(name: string): void {
    this.write(KEYS.name, name);
  }

  tutorialSeen(): boolean {
    return this.read(KEYS.tutorial) === '1';
  }

  markTutorialSeen(): void {
    this.write(KEYS.tutorial, '1');
  }

  private read(key: string): string | null {
    if (!this.available) return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    if (!this.available) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode / quota: settings simply do not persist. Never break the game for it.
      this.available = false;
    }
  }

  private remove(key: string): void {
    if (!this.available) return;
    try {
      localStorage.removeItem(key);
    } catch {
      this.available = false;
    }
  }
}

function probeStorage(): boolean {
  try {
    const probe = '__kc_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
