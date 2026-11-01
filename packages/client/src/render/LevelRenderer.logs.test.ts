import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildLevel, DEFAULT_SETTINGS } from '@kc/core';
import type { BoxCollider, Collider } from '@kc/core';
import { LevelRenderer, LOG_MODEL, fitLogBody } from './LevelRenderer.js';
import { profileFor } from '../platform/Platform.js';
import type { AssetLibrary } from './AssetLibrary.js';

/**
 * A fallen log is a box to the physics and a log to the eye (`BoxCollider.drawAs`). The part with a
 * right answer before a GPU sees it: no log is drawn as a box, every one is drawn, and the bark of
 * the real model lies where the box's top and sides are — so a player stands on what they see.
 */

const isLog = (c: Collider): c is BoxCollider => c.kind === 'box' && c.drawAs === 'log';

/** The shipped log model, read the way `AssetLibrary.loadGeometry` reads it: one mesh, transform baked. */
async function shippedLog(): Promise<THREE.BufferGeometry> {
  const bytes = readFileSync(new URL(`../../public/models/props/${LOG_MODEL}.glb`, import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const scene = await new Promise<THREE.Object3D>((resolve, reject) => new GLTFLoader().parse(buffer, '', (gltf) => resolve(gltf.scene), reject));
  const meshes: THREE.Mesh[] = [];
  scene.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
  });
  expect(meshes).toHaveLength(1);
  const mesh = meshes[0] as THREE.Mesh;
  mesh.updateWorldMatrix(true, false);
  return mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
}

function logMeshes(renderer: LevelRenderer): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  renderer.group.traverse((obj) => {
    if (obj instanceof THREE.InstancedMesh && obj.userData.kind === 'log') out.push(obj);
  });
  return out;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('fallen logs', () => {
  const profile = profileFor('pc', 'high', DEFAULT_SETTINGS);

  it('draws every log once and never as the box it collides as', () => {
    const level = buildLevel('jungle-world');
    const logs = level.colliders.filter(isLog);
    expect(logs.length).toBeGreaterThan(20);
    const renderer = new LevelRenderer(level, profile);
    expect(logMeshes(renderer).reduce((n, m) => n + m.count, 0)).toBe(logs.length);
    let boxes = 0;
    renderer.group.traverse((obj) => {
      if (obj instanceof THREE.InstancedMesh && obj.geometry instanceof THREE.BoxGeometry) boxes += obj.count;
    });
    expect(boxes).toBe(level.colliders.filter((c) => c.kind === 'box' && !c.drawAs).length);
    renderer.dispose();
  });

  it("lays the model's bark on the box: its top is the box's top and its sides are the box's sides", async () => {
    const source = await shippedLog();
    const assets = {
      loadGeometry: async (url: string) => (url === `/models/props/${LOG_MODEL}.glb` ? source : null),
    } as unknown as AssetLibrary;
    const errors = { top: [] as number[], side: [] as number[] };
    for (const id of ['jungle-world', 'outback-station']) {
      const level = buildLevel(id);
      const logs = level.colliders.filter(isLog);
      const renderer = new LevelRenderer(level, profile, assets);
      await settle();
      const meshes = logMeshes(renderer);
      expect(meshes).toHaveLength(1);
      const mesh = meshes[0] as THREE.InstancedMesh;
      // The model, not the stand-in cylinder.
      expect(mesh.geometry).not.toBeInstanceOf(THREE.CylinderGeometry);
      expect(mesh.count).toBe(logs.length);

      const matrix = new THREE.Matrix4();
      const ray = new THREE.Raycaster();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        const at = new THREE.Vector3().setFromMatrixPosition(matrix);
        const log = logs.find((c) => Math.abs(c.center.x - at.x) < 1e-4 && Math.abs(c.center.z - at.z) < 1e-4 && Math.abs(c.center.y - at.y) < 1e-4);
        expect(log, `instance ${i} of ${id} is on a log collider`).toBeDefined();
        const box = log as BoxCollider;
        const drawn = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
        drawn.applyMatrix4(matrix);
        drawn.updateMatrixWorld(true);
        const along = new THREE.Vector3(Math.cos(box.yaw), 0, -Math.sin(box.yaw));
        const across = new THREE.Vector3(Math.sin(box.yaw), 0, Math.cos(box.yaw));
        for (const t of [-0.6, -0.3, 0, 0.3, 0.6]) {
          const point = new THREE.Vector3(box.center.x, box.center.y, box.center.z).addScaledVector(along, t * box.half.x);
          ray.set(point.clone().setY(box.center.y + box.half.y * 3), new THREE.Vector3(0, -1, 0));
          const top = ray.intersectObject(drawn)[0];
          expect(top, `${id} log ${box.id} has bark at t=${t}`).toBeDefined();
          errors.top.push(((top as THREE.Intersection).point.y - (box.center.y + box.half.y)) / box.half.y);
          for (const side of [-1, 1]) {
            ray.set(point.clone().addScaledVector(across, side * box.half.z * 3), across.clone().multiplyScalar(-side));
            const hit = ray.intersectObject(drawn)[0];
            expect(hit).toBeDefined();
            const reach = Math.abs((hit as THREE.Intersection).point.clone().sub(point).dot(across));
            errors.side.push((reach - box.half.z) / box.half.z);
          }
        }
      }
      renderer.dispose();
    }
    // As shares of the log's radius. A log is not a cylinder, so its bark wanders about the box —
    // measured −7…+2 % on top and −13…+5 % at the sides. The first fit, by the highest point of each
    // stretch, put the top 7 % low on the median and a side 21 % in, and fails here.
    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;
    expect(Math.abs(median(errors.top))).toBeLessThan(0.05);
    expect(Math.abs(median(errors.side))).toBeLessThan(0.05);
    for (const e of errors.top) expect(Math.abs(e)).toBeLessThan(0.1);
    for (const e of errors.side) expect(Math.abs(e)).toBeLessThan(0.15);
  });

  it('fits by the body, not by a stub sticking out of it', () => {
    // A 4 m log of radius 0.5 lying on the ground, with a knot standing 0.3 m proud of its top.
    const body = new THREE.CylinderGeometry(0.5, 0.5, 4, 12, 8);
    body.rotateZ(Math.PI / 2);
    body.translate(0, 0.5, 0);
    const knot = new THREE.BoxGeometry(0.2, 0.3, 0.2);
    knot.translate(0.4, 1.15, 0);
    const merged = new THREE.BufferGeometry();
    const a = body.toNonIndexed().attributes.position as THREE.BufferAttribute;
    const b = knot.toNonIndexed().attributes.position as THREE.BufferAttribute;
    merged.setAttribute('position', new THREE.Float32BufferAttribute([...(a.array as Float32Array), ...(b.array as Float32Array)], 3));
    const fitted = fitLogBody(merged);
    fitted.computeBoundingBox();
    const box = fitted.boundingBox as THREE.Box3;
    // The bark spans ±1; the knot is what pokes past it, not what the bark is squeezed under.
    expect(box.min.y).toBeCloseTo(-1, 2);
    expect(box.max.y).toBeCloseTo(1 + 0.3 / 0.5, 1);
    expect(box.max.z).toBeCloseTo(1, 1);
    expect(box.max.x).toBeCloseTo(1, 5);
  });
});
