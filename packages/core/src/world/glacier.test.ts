import { describe, expect, it } from 'vitest';

import { buildGlacierWorld } from './glacier.js';
import { buildJungleWorld } from './jungle.js';
import { buildLevel, defaultLevelId, getLevelEntry, listLevels } from './registry.js';
import { zoneAt } from './zone.js';
import type { BoxCollider } from '../physics/types.js';
import { SurfaceFlags } from '../physics/types.js';

/**
 * The second map, and the registry that makes a second map possible at all.
 *
 * Until this existed `buildJungleWorld()` was called directly in three places — the client, the
 * room and the room manager — and the server's `levelId`, which it had always sent in its welcome
 * message, was not even declared in the client's handler. Whatever the server said, the client
 * built the jungle.
 *
 * What is asserted here is mostly *not* geometry. A map is worth having because it plays
 * differently, so the tests are about the properties that make the glacier a different game:
 * it is slippery, it has somewhere dark to hide, and it is reachable.
 */
describe('glacier world', () => {
  const level = buildGlacierWorld();
  const boxes = level.colliders.filter((c): c is BoxCollider => c.kind === 'box');

  it('registers itself alongside the jungle', () => {
    const ids = listLevels().map((l) => l.id).sort();
    expect(ids).toContain('jungle-world');
    expect(ids).toContain('glacier-world');
  });

  it('leaves the jungle as the default, so nothing silently moves house', () => {
    expect(defaultLevelId()).toBe('jungle-world');
  });

  it('builds by id through the registry', () => {
    expect(buildLevel('glacier-world').id).toBe('glacier-world');
    expect(buildLevel('jungle-world').id).toBe('jungle-world');
  });

  it('falls back rather than throwing on an id it does not know', () => {
    // This runs on the client against an id chosen by the server, so a client older than a map
    // must land somewhere playable instead of taking the whole game down.
    expect(() => buildLevel('map-from-the-future')).not.toThrow();
    expect(buildLevel('map-from-the-future').id).toBe(defaultLevelId());
  });

  it('describes itself for the menus', () => {
    const entry = getLevelEntry('glacier-world');
    expect(entry?.name).toBe('Glacier World');
    expect((entry?.description ?? '').length).toBeGreaterThan(20);
  });

  it('is mostly slippery, which is the entire point of it', () => {
    /**
     * The one property that makes this a different game rather than the jungle in white. Measured
     * by surface area rather than by collider count: a hundred tiny grippable boulders must not
     * outvote the rink they are sitting on.
     */
    const area = (c: BoxCollider) => c.half.x * c.half.z;
    let slippery = 0;
    let total = 0;
    for (const box of boxes) {
      const a = area(box);
      total += a;
      if ((box.surface.flags & SurfaceFlags.Slippery) !== 0) slippery += a;
    }
    expect(total).toBeGreaterThan(0);
    expect(slippery / total).toBeGreaterThan(0.5);
  });

  it('is more slippery than the jungle', () => {
    const slipperyShare = (lvl: ReturnType<typeof buildJungleWorld>) => {
      let slippery = 0;
      let total = 0;
      for (const c of lvl.colliders) {
        if (c.kind !== 'box') continue;
        const a = c.half.x * c.half.z;
        total += a;
        if ((c.surface.flags & SurfaceFlags.Slippery) !== 0) slippery += a;
      }
      return total === 0 ? 0 : slippery / total;
    };
    expect(slipperyShare(level)).toBeGreaterThan(slipperyShare(buildJungleWorld()));
  });

  it('keeps one place with grip, so a runner has somewhere to stop', () => {
    // The crevasse is the whole reason to risk a dead end. If its floor were ice too there would
    // be no reason to go down there at all.
    // Found by depth and footprint rank rather than by a literal half-extent: `half.x > 20` was a
    // number copied off the geometry of the day, and it stopped matching the moment the map was
    // rescaled — reporting "there is no crevasse floor" for a crevasse that was right there.
    const deep = boxes.filter((c) => c.center.y < -8);
    const crevasseFloor = deep.sort((a, b) => b.half.x * b.half.z - a.half.x * a.half.z)[0];
    expect(crevasseFloor).toBeDefined();
    expect((crevasseFloor?.surface.flags ?? 0) & SurfaceFlags.Slippery).toBe(0);
  });

  it('has somewhere genuinely dark', () => {
    // Which only means anything because zone darkness now reaches the renderer.
    const crevasse = level.zones.find((z) => z.name === 'crevasse');
    expect(crevasse?.darkness).toBeGreaterThan(0.5);
    expect(zoneAt(level, crevasse?.center ?? { x: 0, y: 0, z: 0 })?.zone.name).toBe('crevasse');
  });

  it('puts the spawn on the rink, not in the hole', () => {
    expect(zoneAt(level, level.spawns[0]?.position ?? { x: 0, y: 0, z: 0 })?.zone.name).toBe('shelf');
  });

  it('deals enough spawns for a full room, on both sides', () => {
    expect(level.spawns.length).toBeGreaterThanOrEqual(8);
    expect(level.spawns.some((s) => s.tag === 'chaser')).toBe(true);
    expect(level.spawns.some((s) => s.tag === 'runner')).toBe(true);
  });

  it('gives the parkour mode a route that ends at a finish', () => {
    expect(level.checkpoints.length).toBeGreaterThan(3);
    expect(level.checkpoints.filter((c) => c.finish)).toHaveLength(1);
  });

  it('is identical for the same seed', () => {
    // Client and server build this independently. A level that differed between them would
    // desynchronise every collision in the match.
    const again = buildGlacierWorld();
    expect(again.colliders.length).toBe(level.colliders.length);
    expect(again.props.map((p) => `${p.kind}:${p.position.x.toFixed(3)}`)).toEqual(
      level.props.map((p) => `${p.kind}:${p.position.x.toFixed(3)}`),
    );
  });

  it('differs for a different seed, so the seed is actually used', () => {
    const other = buildGlacierWorld(12345);
    expect(other.props.map((p) => p.position.x.toFixed(3))).not.toEqual(level.props.map((p) => p.position.x.toFixed(3)));
  });

  it('has no green scenery, which would read as the wrong map', () => {
    const foliage = level.props.filter((p) => ['bush', 'fern', 'tree', 'palm', 'vine', 'flower'].includes(p.kind));
    expect(foliage).toEqual([]);
  });

  it('keeps every spawn above the kill plane', () => {
    for (const spawn of level.spawns) expect(spawn.position.y).toBeGreaterThan(level.killPlaneY);
  });
});
