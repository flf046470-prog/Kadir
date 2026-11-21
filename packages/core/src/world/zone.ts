import type { Vec3 } from '../math/vec3.js';
import type { LevelDef, ZoneDef } from './level.js';

/**
 * Which zone a point is in, and how far into it.
 *
 * Zones were authored into every level and read by nobody. `buildJungleWorld` declares three —
 * jungle at darkness 0.05, cave at 0.75, canyon at 0.15 — and `ZoneDef.darkness` carries the
 * comment "0..1 fog/darkness hint for the client", which is exactly the promise that was never
 * kept: no client code ever looked a zone up, so the cave was as bright as the clearing and the
 * `music` bus the ambience would have played on sat at gain 0.5 with nothing connected to it.
 *
 * Shared rather than client-side because it is pure geometry over level data, and because the
 * same question ("where is this player?") is one a mode or a server-side rule may want later.
 *
 * `weight` is what makes the result usable for anything continuous. A hard in/out test at the
 * zone boundary snaps fog and swaps an ambience bed in a single frame, which reads as a bug
 * rather than as walking into a cave; this ramps across the outer fifth of the radius so the
 * caller can blend.
 */
export interface ZoneSample {
  zone: ZoneDef;
  /** 0 at the zone's edge, 1 once well inside it. */
  weight: number;
}

/** Fraction of the radius over which a zone fades in, measured inward from its edge. */
const EDGE_FADE = 0.2;

export function zoneAt(level: LevelDef, position: Vec3): ZoneSample | undefined {
  let best: ZoneSample | undefined;

  for (const zone of level.zones) {
    const dx = position.x - zone.center.x;
    const dy = position.y - zone.center.y;
    const dz = position.z - zone.center.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance > zone.radius) continue;

    const fade = zone.radius * EDGE_FADE;
    const weight = fade <= 0 ? 1 : Math.min(1, (zone.radius - distance) / fade);

    /**
     * The smaller zone wins where two overlap.
     *
     * Zones are nested by intent — a cave mouth sits inside the jungle's radius — so "the most
     * specific place the player is standing" is the smallest one containing them, never the first
     * in the list. Ties break on the stronger weight, so a player deeper into one of two equal
     * zones hears that one.
     */
    if (
      !best ||
      zone.radius < best.zone.radius ||
      (zone.radius === best.zone.radius && weight > best.weight)
    ) {
      best = { zone, weight };
    }
  }

  return best;
}

/**
 * How dark it should be at a point, 0..1.
 *
 * Outside every zone the answer is 0 rather than the level's own default: a level that wants a
 * gloomy baseline says so in `fogDensity`, and darkness is the *local* departure from it.
 */
export function darknessAt(level: LevelDef, position: Vec3): number {
  const sample = zoneAt(level, position);
  if (!sample) return 0;
  return sample.zone.darkness * sample.weight;
}
