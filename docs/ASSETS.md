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
| Quaternius, Kenney, Poly Pizza (CC0 filter) | CC0 / public domain | **Safe.** No attribution required (we credit anyway). |
| Khronos glTF sample assets | CC0 / CC-BY | Safe; check per-model — several are CC0 model + CC-BY rig. |
| Sketchfab CC-BY models | CC-BY | Usable **with attribution** — add `credit` on the model ref; it appears in the credits screen. |
| Fab, but only its CC0-licensed listings | CC0 | Safe. Fab hosts both CC and Standard-License content; only the CC0 half is usable here. |
| Unity Asset Store, Synty, Fab Standard License, Epic marketplace | Store EULA | **Refused by the fetch script.** See below. |

### Why the store EULAs are refused rather than reviewed case by case

These marketplaces permit shipping assets *inside* a product, but not a product "designed to
allow your end users to extract or download assets separately". This game is web-delivered:
every `.glb` the server sends is one right-click away in devtools. We cannot honestly claim
players cannot extract them, so the condition those licences depend on is not satisfiable by
this build — regardless of whether the asset was free.

That makes it a build-shape problem, not a per-asset judgement call, so it is enforced in code:
`scripts/fetch-assets.mjs` refuses those hosts outright, and `credits.test.ts` asserts none are
in the manifest. Refusing by **host** rather than by licence string is deliberate — the failure
this prevents is somebody pasting a store asset into the manifest labelled `CC0-1.0` and nobody
noticing.

A native-only build (Steam, packaged, assets inside the binary) is a genuinely different
question and could use a separate manifest. It is not the build we ship today, and mixing the
two in one manifest is how the wrong file ends up on the web.

### What is in the manifest today

Six packs, covering the four things a build needs: **characters** (Quaternius Ultimate Animated
Animals, Khronos Fox), **environment** (Quaternius nature kit, Kenney Nature Kit),
**animation** (Quaternius Universal Animation Library), and **audio** (Kenney Impact Sounds).
All CC0 except the Fox, which is CC-BY-4.0 and credited.

Only the Fox is fetchable by URL; the rest are behind click-throughs, so they are declared
`"source": "manual"` and resolved from downloaded archives with `--from`. That is not a
limitation of the pipeline — it is what those sites require, and the manifest records exactly
which file goes where so the install is reproducible once you have the archive.

Freesound and similar CC0 audio libraries are the equivalent choice for sound, if the procedural
audio is ever replaced.

## Installing a pack

Packs are declared in [`assets/packs.json`](../assets/packs.json) and installed by a script, so
what ships is always traceable to a licence:

```bash
npm run assets:check              # validate the manifest, download nothing
npm run assets:fetch              # install every url-sourced pack
npm run assets:fetch -- --from ~/Downloads   # also resolve click-through packs from archives there
npm run assets:fetch -- --clean   # remove installed files
```

The manifest is enforced, not advisory. `assets:check` runs as part of `npm run verify` and fails
when a pack declares no licence, uses a licence not cleared for a web build, is attribution-bound
but names no author, installs outside the install directory, or — for anything fetched over the
network — has no pinned `sha256`. That last one matters: pinning the bytes means an upstream file
being swapped fails the build instead of quietly shipping something we never vetted.

Installed files land in `packages/client/public/models/` and are **gitignored**. They are
generated output, and the click-through packs (Quaternius, Kenney, Synty) cannot legally be
redistributed through this repo anyway, so none of them are committed.

Attribution lives in `packages/core/src/content/credits.ts` and is rendered by the in-game
credits screen (Settings → Credits & licences). `credits.test.ts` fails the build if a pack in
the manifest requires attribution and has no entry there — a CC-BY asset shipped without its
author named is a licence breach, so it is worth a failing test rather than a code review.

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
