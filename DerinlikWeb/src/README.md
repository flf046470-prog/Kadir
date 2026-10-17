# Realism modules (`src/fx-*.js`)

`build.py` inlines every `src/fx-<name>.js` into the game's module script at the `/*FX_MODULES*/` marker. That marker sits after the whole core (renderer, world builders, chapters, player, enemy, input) and before the frame loop and boot.

## How a module is built in
- **Scope.** Each file is wrapped in its own block `{ ... }`, so its `const`, `let`, `class` and `function` names never collide with other modules. It still sees every core binding: `THREE`, `scene`, `camera`, `renderer`, `canvas`, `W`, `state`, `player`, `torch`, `enemy`, `MODELS`, `M`, `matCache`, `simTime`, `later`, `LUX`, `FX`, `isTouch`, `sfx`, `ac`, `master` and so on.
- **Imports.** Write `import { X } from 'three/addons/...';` at the top of the file. `build.py` hoists these lines to the top of the module script and removes duplicates. Only `three` and `three/addons/...` (Three.js **0.160.0**) are available.
- **Isolated builds.** `python3 build.py --only lighting --out dist/lighting.html` builds the game with just that module. `--none` builds it with no modules.
- **Errors.** An exception inside an `FX.on` handler is caught and logged with `console.error`. The test harness counts those, so treat any console error as a failing test.

## The FX bus (`FX` in `game.html`)
| Member | Meaning |
|---|---|
| `FX.on(event, fn)`, `FX.emit(event, ...args)` | Event bus |
| `FX.quality` | `'high'`, `'medium'` or `'low'`. Defaults to `'high'` on desktop and `'medium'` on touch devices. The pause menu changes it and emits `quality`. |
| `FX.render` | Set it to `(realDt) => {...}` to take over drawing, for example with an EffectComposer. Default: `renderer.render(scene, camera)`. |

Events emitted by the core:

| Event | Args | When |
|---|---|---|
| `init` | — | Once, after Blender models load and before the first chapter is built |
| `reset` | — | Start of `resetWorld()`, before `W.group` is torn down (every chapter build) |
| `build` | `i`, `spec` | The chapter's geometry exists but has **not** been statically batched yet. This is the place to swap the material of individual meshes (for example only the floors), or to add static dressing meshes that should be batched too. |
| `chapter` | `i`, `spec` | After static batching. Chapter `i` (0 Sakarya, 1 Nevşehir, 2 SIFIR-17, 3 Paris) is built. `spec` holds `{spawn, fog, ambient, objective}`. Also fires for the start-screen backdrop (chapter 0). |
| `frame` | `dt` | End of every simulation step, after the player camera is placed and interaction raycasts are done. Camera offsets added here are reset by the next step. It does not fire while paused or before the game starts. |
| `draw` | `realDt` | Every rendered frame, including while paused and on the start screen |
| `resize` | `w`, `h` | Window resize |
| `material` | `kind`, `mat` | A shared material was created. `kind` is a surface name (`concrete`, `plaster`, `stone`, `old`, `wood`, `slab`, `tuff`, `soviet`, `tile`, `lime`, `bone`) or `metal`, `rust`, `dark`, `coat`, `skin` or `hair`. Materials are cached across chapters, so this fires once per material. |
| `light` | `bulb`, `on` | A bulb was switched (flicker, horror event) |
| `torch` | `on` | Flashlight toggled |
| `cam` | `raised` | Camcorder raised or lowered |
| `step` | `crouched`, `sprinting` | Footstep |
| `slam` | `hingeVec3` | A door slammed shut (Sakarya corridor B) |
| `mover` | `{mesh, offset, dur, start}` | A slab, seal disc, blast door or final door starts moving |
| `gate` | `gate` | An Echo Gate wakes. `gate.group`, `gate.radius`, `gate.light`, and `gate.k` ramps 0→1 over 2.5 s. |
| `echo` | `level` | Echo level changed (0–8) |
| `say` | `who`, `text`, `ms` | A subtitle line starts. Speakers: `'Ekin'`, `'Camille'`, `'İkinci Ses'`, `'Diğer Ekin'`, `'Kayıttaki Ekin'`. |
| `chase` | `on`, `copy` | The Copy starts or stops chasing |
| `catch` | `copy` | The Copy caught the player (a respawn follows) |
| `respawn` | — | The player was put back at the checkpoint |
| `capture` | `target` | The camcorder recorded a hidden thing |
| `transit` | `nextChapter` | A gate started a chapter change (screen fades) |
| `ending` | `'A'`, `'B'` or `'C'` | An ending was chosen |

## Static batching and surface tags
- **Batching.** After `build`, the core merges every plain static mesh that is a direct child of `W.group` and uses a shared (cached) material into one mesh per material. Those meshes have `userData.batch = true`. The originals stay in the scene invisible, so raycasts still hit them.
- **What is not merged.** Meshes in `W.interact`, `W.hiddenOnly` or `W.targets`, movers (`userData.dynamic`), groups, Blender props and anything with its own material.
- **Surface tags.** Every mesh made by `room()` and `wall()` is tagged `userData.surface = 'floor' | 'ceiling' | 'wall'`. Use the tags in `build` to give floors, walls and ceilings different materials.

## Baked textures
`TEXTURE_DATA` maps `textures/<name>.(jpg|png|webp)` stems to data URLs; `build.py` inlines them. Load one with `new THREE.TextureLoader().load(TEXTURE_DATA[name])`.

Naming convention for PBR sets:
- `<set>_albedo` (sRGB)
- `<set>_normal` (tangent space, OpenGL +Y)
- `<set>_orm` (R = ambient occlusion, G = roughness, B = metalness; linear)

Textures must tile seamlessly. Budget: total inlined textures ≤ 6 MB on disk.

## Registries on `W` (rebuilt every chapter)
- **`W.group`** — root of everything in the current chapter. Add your meshes here so they are cleared on chapter change. Geometry under it is disposed on reset unless `userData.shared` is set.
- **`W.lights`** — every bulb and flame: `{group, light, glass, kind: 'bulb'|'lamp'|'flame'|'alarm', color, base, on, set(on)}`. Flame intensity is rewritten every step by the core flicker.
- **`W.figures`** — `{group, role, copy?}`. Roles:
  - `'copy'` — Volkova's normal look. `copy` is the `Copy` instance with `x`, `z`, `heading`, `mode`, `wait`.
  - `'copy-true'` — the black form only the camcorder shows; a child of the copy group.
  - `'camille'`.
  - `'other'` — the other Ekin, camcorder-only.
  - The figure group's local −Z is its front. The core only moves and rotates the group, so a module may replace the group's children.
- **`W.updaters`** — functions called with `dt` every step.
- **`W.colliders`**, **`W.occluders`** — collision AABBs and segments, and raycast blockers (enemy sight, interaction).

## Ownership (one module per concern)
| Module | Owns |
|---|---|
| `fx-post` | `FX.render` (EffectComposer: bloom, per-chapter grade, vignette, grain, chromatic aberration), the camcorder image look (replaces the CSS filter on `#view.cam`), Echo/Second-Voice distortion. Screen-space AO (GTAOPass) was tried and left out: it crashed the software GPU used for testing, so it could not be verified. |
| `fx-lighting` | Flashlight LED cookie, bounce light and flicker; lamp halos; hanging-bulb sway; one shadowed lamp on *high*; a per-chapter environment probe for materials marked `userData.fxReflective`. A visible beam mesh was tried and removed (it showed a ring artifact). |
| `fx-particles` | Dust motes, drips/splashes, debris and dust bursts on `mover`/`slam`, steam, flame billboards on every `kind: 'flame'` light, gate particles |
| `fx-materials` | Real-world surfaces: Blender-baked PBR sets in `textures/` (made by `tools/bake_textures.py`) applied on `material`/`build`. Covers soil, mud, rock and tuff, limestone, concrete, plaster, brick, wood, tile, painted and rusted metal, ice, frost and snow. Also world-space grime and wetness, decals, puddles, and environment dressing such as icicles, frozen puddles, snow drifts and mud. |
| `fx-characters` | Replaces `W.figures` visuals with the rigged Blender humanoid (`MODELS.humanoid`) and animates it |
| `fx-camera` | Camera feel (head bob, breathing, shake on `slam`/`mover`/`catch`/`chase`), the first-person hands/flashlight viewmodel |

Shared contracts:
- **Flashlight.** `fx-camera` may move `torch` and `torch.target` into a swaying rig under the camera. `fx-lighting` attaches anything that must follow the beam as children of `torch`. Never assume `torch.parent === camera`.
- **Glow.** Things meant to glow use HDR colours: emissive or basic colours with intensity above 1. `fx-post`'s bloom threshold is 2.2 (linear), so only light sources bloom, never lit walls.
- **Shaking.** Modules other than `fx-camera` request a shake with `FX.emit('shake', {amp, dur})`, amp in metres. `fx-camera` performs it.

## Target
The owner asked for realism "like the real world" (gerçek dünya gibi): believable soil, ice, stone, water, metal, light and motion. Prefer physically based, observed-from-reality detail over stylised effects. Every change must still keep the game readable and playable.

## Performance rules
The target is a laptop RTX 4050 at 1080p, 60 fps on `'high'`. Phones run `'medium'`.
- **Quality levels.** Respect `FX.quality`. `'low'` must look like the plain game (or better) at near-zero cost. Handle the `quality` event live; no reload.
- **Lights.** Point lights cost per pixel per light. Do not add more than 2 extra lights per chapter, and prefer emissive and additive tricks.
- **Shadows.** At most one shadowed point light per chapter, with a ≤512 map, on `'high'` only.
- **Particles.** Use `THREE.Points` or `InstancedMesh`. Never create one mesh per particle, and allocate no meshes, materials or textures per frame.
- **Disposal.** Dispose render targets and textures you allocate when they are replaced.
