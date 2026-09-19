# Meshy AI prompt kit

Prompts for generating the game's **props and environment** in Meshy, in a style that matches the
character pack.

## Read this first: what Meshy is and is not for here

**Characters: no.** The launch roster (kangaroo, wolf, fox, tiger, frog, penguin) needs skeletons
and walk/run/jump/idle cycles. Meshy's auto-rig targets humanoids and is unreliable on quadrupeds
and hoppers, and an unanimated character reads as a sliding statue. Those six come from
**Quaternius "Ultimate Animated Animals"** — CC0, already rigged, already declared in
`assets/packs.json` with exact filenames. The only character Meshy is a reasonable fit for is
`human`, which is humanoid and rigs cleanly (Mixamo is an equally good free route).

**Props and environment: yes.** Static geometry, no rig, no animation. This is what Meshy is good
at, and it is a real gap — every prop in the world is procedural right now.

## The style block — paste into EVERY prompt

Style coherence across a set matters more than any single model. Generated one at a time with
free-form wording, a prop set comes back in eight different art styles and the world looks broken.
Keep this clause byte-identical on every generation:

```
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```

Why each part earns its place:

- **flat shaded / chunky / soft rounded** — matches Quaternius, which is the character style.
- **minimal surface detail** — Meshy's default instinct is heavy displacement and noise, which
  costs triangles that a mobile and Quest build cannot spend.
- **no baked shadows / neutral lighting** — the renderer lights the scene. A model with shadow
  painted into its texture stays dark when it is standing in sunlight.
- **no ground plane / no base / no pedestal** — Meshy loves adding a little disc under things.
  That disc becomes geometry floating inside the terrain.
- **single centered object** — asking for a scene returns one fused mesh that cannot be placed.

## Negative prompt

```
photorealistic, hyperrealistic, high detail, noisy displacement, baked shadows, ambient occlusion
baked into texture, ground plane, base, pedestal, text, watermark, multiple objects, scene,
diorama, character, creature, human
```

## Generation settings

| Setting | Value | Why |
|---|---|---|
| Topology | Quad / remesh on | Cleaner decimation later |
| Target polycount | **1k–3k tris** for props, **8k–15k** for `human` | Quest and mid-range phones are the budget |
| Texture resolution | **1024²** props, 2048² character | 4K textures blow the download budget |
| Format | **GLB** | What the loader takes |
| PBR | On | Renderer expects metalness/roughness |

Install location is `packages/client/public/models`. Anything heavier than the budget above must be
decimated before it lands there — Meshy's default output is routinely 5–10× over.

## Licence check — do this before generating, not after

The game is web-delivered, so every file the server sends is downloadable by any player with
devtools open. `assets/packs.json` therefore clears only CC0, CC-BY and permissive licences, and
the fetch script refuses sources whose terms forbid end-user extraction of raw assets.

**Confirm what your specific Meshy plan grants for commercial use and redistribution of the
generated files before putting them in this repo.** Terms differ by tier and change over time; the
free tier is generally more restrictive than paid. Record the answer in `packs.json` as a pack
entry with `licence` and `sourceUrl` filled in, exactly as the other packs do — an asset with no
recorded licence fails `npm run assets:check` in CI, by design.

---

# The prompts

Each is `[subject] + [style block]`. The subjects below are the props the jungle world actually
places (`packages/core/src/world/jungle.ts`), not a generic list.

## Priority 1 — props the world places today

### rock
```
a single weathered boulder, irregular angular faces, mossy green patches on top, grey-brown stone,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```
Generate 3–4 variants. A world with one rock mesh repeated reads as a texture, not a place.

### log
```
a fallen hollow tree log lying horizontally, rough bark, cracked open end showing pale inner wood,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```

### bush
```
a round leafy jungle bush, dense broad tropical leaves, layered green foliage,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```

### flower
```
a cluster of tropical flowers on short stems, wide bright pink and yellow petals, few large leaves,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```

### stalagmite
```
a pointed cave stalagmite rising from the floor, tapering ribbed cone, damp grey limestone,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```

### crystal
```
a cluster of glowing cyan crystal shards growing at angles from a rocky base, faceted translucent
gems, stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```
Emissive comes from the material in-engine, not from the texture — do not ask for "glowing light".

### banner
```
a tall festival banner on a wooden pole, rectangular cloth hanging vertically, plain bold colored
fabric with no writing, rope ties,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```
"no writing" is repeated deliberately: banners are the asset Meshy is most likely to scribble
fake lettering onto, and fake lettering is a localisation and store-review problem.

## Priority 2 — parkour and biome dressing

### jungle tree
```
a tall tropical jungle tree, thick straight trunk, broad canopy of large flat leaves, few hanging
vines, stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```

### vine
```
a hanging jungle vine with broad leaves along its length, long vertical rope-like stem,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```

### canyon rock formation
```
a tall layered sandstone canyon spire, horizontal orange and red strata, flat wide top,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```
The flat top is not decoration — it is a landing surface. Ask for it explicitly.

### wooden platform / ledge
```
a simple wooden plank platform, four thick planks side by side with visible grain, square shape,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```

## Priority 3 — the one character worth generating here

### human
```
a friendly cartoon human character in casual clothes, T-pose, arms straight out to the sides,
legs straight and slightly apart, simple rounded proportions, large head, no facial hair,
stylized low-poly game asset, flat shaded, chunky simplified forms, soft rounded edges,
saturated colors, minimal surface detail, no text, no logos, single centered object,
neutral even lighting, no baked shadows, no ground plane, no base, no pedestal
```

**T-pose is mandatory** — auto-riggers fail on A-pose and on any dynamic pose. After generating,
run Meshy's rigging step, or take the mesh to Mixamo for a rig plus a walk/run/jump/idle set. Those
clip names must match what the avatar animation layer looks for; check
`packages/client/src/render/` for the current mapping before renaming anything.

---

## Workflow, end to end

1. Generate with the prompt, at the polycount in the settings table.
2. Check it in Meshy's viewer from **below** — Meshy frequently leaves a hidden disc or stray
   fragment under the subject, and it will intersect the terrain.
3. Export **GLB**, 1024² textures.
4. Decimate if over budget.
5. Drop into `packages/client/public/models`.
6. Add a pack entry to `assets/packs.json` with `licence`, `author` and `sourceUrl` filled in.
   CI (`npm run assets:check`) fails on a pack with no licence — that gate is intentional and
   should not be worked around.
7. `npm run build && npm run check:smoke` to confirm nothing regressed.

## Generate a whole set, not one model

Ask for **3–4 variants of rock, bush and tree**. Repetition is the thing that makes a game world
look cheap, and it is far more noticeable than any individual model's quality. Four mediocre rocks
beat one excellent rock placed two hundred times.
