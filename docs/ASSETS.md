# Art & audio assets

The game ships **fully playable with zero downloaded assets**: animals, props and level geometry
are generated procedurally, and every sound is synthesised at runtime. That is a deliberate
baseline — it keeps the first load small (important on mobile data and on a Quest browser), and
it means gameplay can never be blocked on an art pipeline.

An art pack is an **optional layer on top**, wired through `AssetLibrary` and the optional
`AnimalDef.model` field.

## The rule that keeps art safe

> Art is visual only. Collision, grips, hitboxes, reach and every movement constant come from
> level and player **data**, never from a mesh.

`LevelDef.colliders` (gameplay) and `LevelDef.props` (decoration) are separate lists for exactly
this reason. Swapping in a different tree model changes what the tree looks like, never where it
can be climbed. The same holds for animals: `AnimalDef.visual`/`model` are cosmetic, while the
capsule and `MovementConfig` are shared by everyone (see the fairness clamp in
`packages/core/src/player/config.ts`).

## Choosing a source

This is a **web-delivered** game: every file served is downloadable by players. That makes
licence choice a real engineering constraint, not paperwork.

| Source | Licence | Web build |
| --- | --- | --- |
| Quaternius, Kenney, Poly Pizza (CC0 filter) | CC0 / public domain | Safe. No attribution required (crediting is still good manners). |
| Sketchfab CC-BY models | CC-BY | Usable **with attribution** — add `credit` on the model ref; it appears in the credits screen. |
| Unity/Unreal asset-store packs (incl. Synty) | Store EULA | Check the EULA first. These usually permit shipping inside a game, but many restrict distributing raw asset files, and a web build serves extractable `.glb`s. Read the specific licence before shipping. |

Freesound and similar CC0 audio libraries are the equivalent choice for sound, if the procedural
audio is ever replaced.

## Pipeline

Target budgets: **≤ 3 k triangles** per animal, **≤ 1 k** per prop, one 512² atlas per pack,
everything Draco- or meshopt-compressed.

```bash
# FBX/OBJ -> glTF
npx fbx2gltf -i Kangaroo.fbx -o kangaroo.gltf --binary

# Optimise: dedupe, weld, simplify, atlas, compress
npx @gltf-transform/cli optimize kangaroo.glb kangaroo.opt.glb \
  --texture-compress webp --simplify true --compress meshopt
```

Put the result in `packages/client/public/models/` and reference it from the animal data:

```ts
{
  id: 'kangaroo',
  // ...
  model: { url: '/models/kangaroo.opt.glb', scale: 1, offsetY: 0, credit: 'Quaternius (CC0)' },
}
```

Nothing else changes. If the file is missing or fails to parse, `AssetLibrary` logs once and the
procedural avatar is used instead, so a broken asset never takes the game down.

## Cosmetic sockets

Authored models can name their attachment points; the loader looks them up by node name:

```ts
model: {
  url: '/models/fox.glb',
  sockets: { head: 'Socket_Head', face: 'Socket_Face', back: 'Socket_Back', tail: 'Socket_Tail' },
}
```

Missing sockets fall back to the procedural positions, so a pack can be adopted incrementally.

## What is worth buying/downloading first

1. **Six launch animals** — the strongest identity win per file.
2. **Jungle environment kit** (trees, rocks, ruins) for the props layer.
3. Everything else (UI, effects, audio) is procedural and cheap to keep that way.
