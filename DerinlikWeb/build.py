#!/usr/bin/env python3
"""Builds DerinlikWeb/dist/index.html from game.html.

- Inlines every models/*.glb (base64) into MODEL_DATA; models/manifest.json may add a "place" note per model.
- Inlines every textures/*.jpg|png|webp as a data URL into TEXTURE_DATA (keyed by file stem).
- Inlines the realism modules src/fx-*.js at the /*FX_MODULES*/ marker, each wrapped in its own block scope,
  and hoists their `import ... from '...'` lines to the top of the module script (deduplicated).

Usage: python3 build.py [--only post,lighting] [--none] [--out dist/test.html]
  --only  include just these modules (names are the part after "fx-"), for testing one module in isolation
  --none  include no modules (the plain game)
"""
import argparse, base64, json, pathlib, re

root = pathlib.Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--only", default=None)
ap.add_argument("--none", action="store_true")
ap.add_argument("--out", default=str(root / "dist" / "index.html"))
args = ap.parse_args()

src = (root / "game.html").read_text(encoding="utf-8")

# --- models
models = {}
places = {}
manifest = root / "models" / "manifest.json"
if manifest.exists():
    places = {k: v.get("place", "") for k, v in json.loads(manifest.read_text(encoding="utf-8")).items()}
for glb in sorted((root / "models").glob("*.glb")):
    models[glb.stem] = {"glb": base64.b64encode(glb.read_bytes()).decode(), "place": places.get(glb.stem, "")}
src = src.replace("{/*MODELS*/}", json.dumps(models) if models else "{}")

# --- baked textures (textures/<name>.jpg|png -> data URL)
MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
textures = {}
for t in sorted((root / "textures").glob("*")) if (root / "textures").exists() else []:
    if t.suffix.lower() in MIME:
        textures[t.stem] = f"data:{MIME[t.suffix.lower()]};base64," + base64.b64encode(t.read_bytes()).decode()
src = src.replace("{/*TEXTURES*/}", json.dumps(textures) if textures else "{}")

# --- realism modules
wanted = None if args.only is None else {n.strip() for n in args.only.split(",") if n.strip()}
modules = []
for f in sorted((root / "src").glob("fx-*.js")):
    name = f.stem[3:]
    if args.none or (wanted is not None and name not in wanted):
        continue
    modules.append((name, f.read_text(encoding="utf-8")))
if wanted:
    missing = wanted - {n for n, _ in modules}
    if missing:
        raise SystemExit(f"unknown module(s): {', '.join(sorted(missing))}")

IMPORT = re.compile(r"^\s*import\s+[^;]*?\s+from\s+['\"][^'\"]+['\"]\s*;?\s*$", re.M)
imports, bodies = [], []
for name, code in modules:
    for m in IMPORT.finditer(code):
        line = m.group(0).strip().rstrip(";") + ";"
        if line not in imports:
            imports.append(line)
    body = IMPORT.sub("", code).strip("\n")
    bodies.append(f"/* ---- src/fx-{name}.js ---- */\n{{\n{body}\n}}")
marker = "/*FX_MODULES*/"
if marker not in src:
    raise SystemExit("game.html lost its /*FX_MODULES*/ marker")
src = src.replace(marker, "\n\n".join(bodies) if bodies else "/* no realism modules */")
if imports:
    anchor = "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';"
    if anchor not in src:
        raise SystemExit("game.html lost its GLTFLoader import (import hoisting anchor)")
    existing = set(re.findall(r"^import .*;$", src, re.M))
    extra = [i for i in imports if i not in existing]
    src = src.replace(anchor, anchor + ("\n" + "\n".join(extra) if extra else ""))

out = pathlib.Path(args.out)
if not out.is_absolute():
    out = root / out
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(src, encoding="utf-8")
print(f"{out.relative_to(root) if out.is_relative_to(root) else out}: {len(src)/1024:.0f} KB, {len(models)} model(s), {len(textures)} texture(s), modules: {', '.join(n for n, _ in modules) or 'none'}")
