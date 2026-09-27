import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildLevel, listLevels } from '@kc/core';
import { DISTANT_LAND_STYLES, DistantLand, distantLandFrame, distantLandGeometry } from './DistantLand.js';

describe('the land beyond the map', () => {
  for (const entry of listLevels()) {
    it(`${entry.id}: stands wholly outside the play area and never reaches into it`, () => {
      const level = buildLevel(entry.id);
      expect(DISTANT_LAND_STYLES[level.id], `no style for ${level.id}`).toBeDefined();
      const frame = distantLandFrame(level);
      // Every collider is inside the ring's inner edge.
      for (const c of level.colliders) {
        const r = c.kind === 'box' ? Math.hypot(c.half.x, c.half.z) : c.radius;
        expect(Math.hypot(c.center.x - frame.centreX, c.center.z - frame.centreZ) + r).toBeLessThan(frame.inner);
      }
      const geometry = distantLandGeometry(frame, DISTANT_LAND_STYLES[level.id]!, 1);
      const p = geometry.getAttribute('position');
      const style = DISTANT_LAND_STYLES[level.id]!;
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i) - frame.centreX, p.getZ(i) - frame.centreZ);
        expect(d).toBeGreaterThanOrEqual(frame.inner - 1e-3);
        expect(p.getY(i) - frame.floorY).toBeGreaterThanOrEqual(-1e-3);
        expect(p.getY(i) - frame.floorY).toBeLessThanOrEqual(style.height + 1e-3);
      }
    });
  }

  it('stands above the map\'s own walls, seen from its middle, in most directions', () => {
    /**
     * Fixed heights put the outback's mesas and the jungle's hills wholly behind the edge cliffs in
     * a real game frame. Asked per compass sector: the land's highest elevation angle against the
     * steepest wall in the same sector.
     */
    const SECTORS = 16;
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      const land = new DistantLand(level);
      const frame = distantLandFrame(level);
      const sector = (x: number, z: number): number =>
        Math.floor(((Math.atan2(x - frame.centreX, z - frame.centreZ) / (Math.PI * 2) + 1) % 1) * SECTORS);
      const wall: number[] = Array.from({ length: SECTORS }, () => 0);
      for (const c of level.colliders) {
        if (c.zone !== 'edge' || c.kind !== 'box') continue;
        const d = Math.max(1, Math.hypot(c.center.x - frame.centreX, c.center.z - frame.centreZ));
        const k = sector(c.center.x, c.center.z);
        wall[k] = Math.max(wall[k]!, Math.atan2(c.center.y + c.half.y - frame.floorY, d));
      }
      const hill: number[] = Array.from({ length: SECTORS }, () => 0);
      const p = land.mesh.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i) - frame.centreX, p.getZ(i) - frame.centreZ);
        const k = sector(p.getX(i), p.getZ(i));
        hill[k] = Math.max(hill[k]!, Math.atan2(p.getY(i) - frame.floorY, d));
      }
      const clear = hill.filter((h, k) => h > wall[k]!).length;
      expect(clear, `${entry.id}: land clears the walls in ${clear}/${SECTORS} directions`).toBeGreaterThanOrEqual(12);
      land.dispose();
    }
  });

  it('is wound upwards, and its near slopes face the map', () => {
    const level = buildLevel('glacier-world');
    const frame = distantLandFrame(level);
    const geometry = distantLandGeometry(frame, DISTANT_LAND_STYLES['glacier-world']!, 1);
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    let near = 0;
    let facing = 0;
    for (let i = 0; i < p.count; i++) {
      // Every face points up: wound the right way round, so it is drawn from above and inside.
      expect(n.getY(i)).toBeGreaterThan(0);
      const toCentre = new THREE.Vector3(frame.centreX - p.getX(i), 0, frame.centreZ - p.getZ(i));
      if (toCentre.length() > frame.inner + 60) continue;
      near++;
      if (new THREE.Vector3(n.getX(i), 0, n.getZ(i)).dot(toCentre.normalize()) > 0) facing++;
    }
    // The slope rising from the foot of the cliffs is the side a player sees, and it faces them.
    expect(facing / near).toBeGreaterThan(0.9);
  });

  it('gives each map its own landform', () => {
    const heights = (id: string): number[] => {
      const level = buildLevel(id);
      const frame = distantLandFrame(level);
      const p = distantLandGeometry(frame, DISTANT_LAND_STYLES[id]!, 1).getAttribute('position');
      const out: number[] = [];
      for (let i = 0; i < p.count; i++) out.push(p.getY(i) - frame.floorY);
      return out;
    };
    const glacier = heights('glacier-world');
    const outback = heights('outback-station');
    // Heights follow each map's walls, so shape is what tells them apart: mesas are flat-topped —
    // many vertices share a few tread heights — where peaks are all different.
    const treads = new Set(outback.filter((h) => h > 5).map((h) => h.toFixed(1)));
    const peaks = new Set(glacier.filter((h) => h > 5).map((h) => h.toFixed(1)));
    expect(treads.size).toBeLessThan(peaks.size / 3);
  });

  it('asks for a far plane that reaches its far edge from anywhere on the map', () => {
    for (const entry of listLevels()) {
      const level = buildLevel(entry.id);
      const land = new DistantLand(level);
      const frame = distantLandFrame(level);
      const p = land.mesh.geometry.getAttribute('position');
      let furthest = 0;
      for (let i = 0; i < p.count; i++) furthest = Math.max(furthest, Math.hypot(p.getX(i) - frame.centreX, p.getZ(i) - frame.centreZ));
      let farthestCollider = 0;
      for (const c of level.colliders) farthestCollider = Math.max(farthestCollider, Math.hypot(c.center.x - frame.centreX, c.center.z - frame.centreZ));
      expect(land.reach).toBeGreaterThanOrEqual(furthest + farthestCollider);
      land.dispose();
    }
  });
});
