import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LAUNCH_ANIMALS } from '@kc/core';
import { describe, expect, it } from 'vitest';

/**
 * No two animals may ship as the same mesh, measured on the mesh.
 *
 * `animals.shape.test.ts` asks the same question of the *declared traits*, and that is not
 * enough — it passed while two clone pairs shipped. `tools/blender/characters.py` only built
 * three of the five tails `AnimalVisual` declares, and its if/elif chain ended in a bare `else`,
 * so `thin` and `fin` both silently became `thick`. Measured on the generated art at the time:
 * `dragon`/`wolf` and `lion`/`tiger` had identical POSITION+NORMAL hashes despite declaring
 * different tails. A guard that reads the data can only ever see what the data *says*; this one
 * reads what the pipeline actually produced.
 *
 * Hashing POSITION and NORMAL rather than the whole file is deliberate. CLAUDE.md records that
 * `assets:build` is deterministic in the geometry and **not** in the bytes: a rebuild with no
 * source change rewrites `WEIGHTS_0` and `INDICES` (ties between joint influences and triangle
 * order are not stable) while POSITION differs by 0.000e+0. Hashing the file would fail on every
 * rebuild and teach everyone to ignore it.
 */

const MODELS = fileURLToPath(new URL('../../public/models/', import.meta.url));

const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

interface Glb {
  json: {
    accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    nodes?: { name?: string }[];
  };
  bin: Buffer;
}

/** Split a .glb into its JSON and BIN chunks. */
function readGlb(path: string): Glb {
  const buf = readFileSync(path);
  let offset = 12; // 12-byte header: magic, version, length
  let json: Glb['json'] | null = null;
  let bin: Buffer | null = null;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const kind = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(body.toString('utf8')) as Glb['json'];
    else if (kind === 0x004e4942) bin = Buffer.from(body);
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error(`${path}: not a two-chunk glb`);
  return { json, bin };
}

/**
 * The bytes one accessor addresses, de-interleaved.
 *
 * `byteStride` has to be honoured rather than assumed absent: a strided bufferView packs several
 * attributes together, and reading it as a flat run would hash a different attribute's bytes and
 * report a difference that is not there.
 */
function accessorBytes(glb: Glb, index: number): Buffer {
  const accessor = glb.json.accessors[index];
  const view = glb.json.bufferViews[accessor.bufferView];
  const element = COMPONENT_BYTES[accessor.componentType] * COMPONENTS[accessor.type];
  const stride = view.byteStride ?? element;
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = Buffer.alloc(accessor.count * element);
  for (let i = 0; i < accessor.count; i++) {
    glb.bin.copy(out, i * element, base + i * stride, base + i * stride + element);
  }
  return out;
}

/** Every vertex position and normal in the file, hashed. Colours and the rig are not in it. */
function shapeHash(glb: Glb): string {
  const hash = createHash('sha256');
  for (const mesh of glb.json.meshes) {
    for (const primitive of mesh.primitives) {
      for (const key of ['POSITION', 'NORMAL']) {
        const accessor = primitive.attributes[key];
        if (accessor === undefined) continue;
        hash.update(key);
        hash.update(accessorBytes(glb, accessor));
      }
    }
  }
  return hash.digest('hex');
}

const withModels = LAUNCH_ANIMALS.filter((a) => a.model?.url.startsWith('/models/'));

describe('the generated animal meshes', () => {
  it('has one on disk for every animal that claims one', () => {
    // A vacuously-true uniqueness check is the failure mode every scan-style guard in this
    // project has had to be protected from, and here it is one missing file away.
    for (const animal of withModels) {
      const path = MODELS + animal.model!.url.replace('/models/', '');
      expect(() => readFileSync(path), `${animal.id}: ${path}`).not.toThrow();
    }
    expect(withModels.length).toBeGreaterThanOrEqual(16);
  });

  it('gives every animal geometry no other animal has', () => {
    const byHash = new Map<string, string>();
    const clones: string[] = [];
    for (const animal of withModels) {
      const hash = shapeHash(readGlb(MODELS + animal.model!.url.replace('/models/', '')));
      const previous = byHash.get(hash);
      if (previous) clones.push(`${previous} = ${animal.id}`);
      else byHash.set(hash, animal.id);
    }
    expect(clones, `these animals ship as the same mesh in different paint: ${clones.join(', ')}`)
      .toEqual([]);
  });

  it('builds the limbs its declared body plan calls for', () => {
    // The plan is the one trait whose effect is nameable rather than only hashable, and it is the
    // one that silently diverged: `build` was optional, this pipeline defaulted to `quadruped`
    // and `Avatar.ts` defaulted to `upright`. Checking bone names catches a re-divergence by
    // name instead of leaving it to the hash, which would only say "something moved".
    for (const animal of withModels) {
      const glb = readGlb(MODELS + animal.model!.url.replace('/models/', ''));
      const names = (glb.json.nodes ?? []).map((n) => n.name ?? '');
      const quadruped = names.some((n) => n.startsWith('frontpaw'));
      expect(quadruped, `${animal.id} declares ${animal.visual.build}`)
        .toBe(animal.visual.build === 'quadruped');
    }
  });
});
