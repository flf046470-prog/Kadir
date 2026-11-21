/**
 * What a PC build must keep the same from one launch to the next.
 *
 * The page's storage belongs to its *origin*, and the origin includes the port. `main.cjs` used to
 * ask the OS for a free port on every launch, so every launch was a new origin with empty storage,
 * and the game asked for a name again. Measured over three launches with one persistent profile:
 * asked for a name three times, three accounts on the bundled server, and the service worker's
 * cache growing 1.9 → 3.7 → 5.6 MB because each origin installs its own. Everything a player had
 * earned was on an account the next launch could not reach.
 *
 * A stable port was not enough on its own: the bundled server was also handed a new random
 * `KC_SESSION_SECRET` every launch, so the token the page kept was signed with a key the next
 * server no longer had.
 *
 * Kept free of Electron and the filesystem so it can be unit tested; `main.cjs` is the wiring.
 */

/**
 * The ports the game is served on, in order of preference. Fixed, so a player whose first choice
 * is permanently taken by another program still lands on the same origin every launch.
 *
 * Below both operating systems' ephemeral ranges (Linux 32768–60999, Windows 49152–65535), so the
 * OS never hands one to some other program's outgoing connection; clear of Steam's own 27015–27050;
 * and not the server's development default, 8787.
 */
export const GAME_PORTS: readonly number[] = Array.from({ length: 10 }, (_, i) => 21787 + i);

/** A port saved by an earlier launch, or null if the text is not one. */
export function parseSavedPort(text: string | null | undefined): number | null {
  const value = Number((text ?? '').trim());
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : null;
}

/**
 * Ports to try, in order: the one the last launch used — the player's storage lives on that origin
 * — then the fixed list. Only a port from this list is ever saved; the OS's own pick, the last
 * resort when all of them are taken, is a different origin every time and must not become the one
 * the next launch goes back to, or one bad launch would orphan everything before it.
 */
export function portCandidates(saved: number | null): number[] {
  const ports = saved === null ? [...GAME_PORTS] : [saved, ...GAME_PORTS];
  return [...new Set(ports)];
}

/** The hosted server the bundled one should send players to, or '' to play on this computer. */
export function onlineOriginFor(appPackage: { kangarooChase?: { onlineOrigin?: unknown } }, env: (name: string) => string | undefined): string {
  // The environment wins, set or empty: `KC_ONLINE_ORIGIN=` is how a tester runs a packaged build
  // offline without repacking it.
  const fromEnv = env('KC_ONLINE_ORIGIN');
  if (fromEnv !== undefined) return fromEnv.trim();
  const packaged = appPackage.kangarooChase?.onlineOrigin;
  return typeof packaged === 'string' ? packaged.trim() : '';
}

/** A session secret saved by an earlier launch, or null if the text is not one. */
export function parseSavedSecret(text: string | null | undefined): string | null {
  const value = (text ?? '').trim();
  return /^[0-9a-f]{64}$/.test(value) ? value : null;
}
