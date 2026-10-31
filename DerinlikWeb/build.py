#!/usr/bin/env python3
"""Builds DerinlikWeb/dist/index.html from game.html.

- Inlines every models/*.glb (base64) into MODEL_DATA; models/manifest.json may add a "place" note per model.
- Inlines every textures/*.jpg|png|webp as a data URL into TEXTURE_DATA (keyed by file stem).
- Inlines every i18n/<lang>.json (Turkish source text -> translation) into I18N_DATA; i18n/source.json is the key list.
- Inlines the realism modules src/fx-*.js at the /*FX_MODULES*/ marker, each wrapped in its own block scope,
  and hoists their `import ... from '...'` lines to the top of the module script (deduplicated).

Usage: python3 build.py [--only post,lighting] [--none] [--offline] [--demo] [--out dist/test.html]
  --only     include just these modules (names are the part after "fx-"), for testing one module in isolation
  --none     include no modules (the plain game)
  --demo     Steam demo build: chapter 1 (Sakarya) only, ending on the demo end screen with the wishlist line.
  --offline  no network at all: bundle three.js (esbuild) and the OFL fonts into the page (desktop / Steam build;
             run `npm install` in DerinlikWeb first)
"""
import argparse, base64, json, pathlib, re

root = pathlib.Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("--only", default=None)
ap.add_argument("--none", action="store_true")
ap.add_argument("--offline", action="store_true")
ap.add_argument("--demo", action="store_true")
ap.add_argument("--out", default=str(root / "dist" / "index.html"))
args = ap.parse_args()

src = (root / "game.html").read_text(encoding="utf-8")
if args.demo:  # Steam demo: Sakarya only, then the demo end screen (game.html DEMO); before bundling strips comments
    assert "/*DEMO*/false" in src
    src = src.replace("/*DEMO*/false", "true")

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

# --- translations (i18n/<lang>.json: Turkish source text -> translation)
i18n = {f.stem: json.loads(f.read_text(encoding="utf-8")) for f in sorted((root / "i18n").glob("*.json")) if f.stem != "source"} if (root / "i18n").exists() else {}
src = src.replace("{/*I18N*/}", json.dumps(i18n, ensure_ascii=False) if i18n else "{}")

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

# --- offline: no CDN, no Google Fonts (desktop / Steam build). Needs `npm install` in DerinlikWeb first.
if args.offline:
    import subprocess, tempfile
    nm = root / "node_modules"
    if not (nm / "three").exists() or not (nm / ".bin" / "esbuild").exists():
        raise SystemExit("--offline needs the npm tooling: run `npm install` in DerinlikWeb first")
    # fonts: the OFL families the game uses, latin + latin-ext subsets (Turkish needs latin-ext), as data URLs
    face = re.compile(r"/\* [^*]*?-(latin|latin-ext)-\d+-\w+ \*/\s*(@font-face \{.*?\})", re.S)
    css = []
    for pkg, files in (("ibm-plex-sans-condensed", ("300.css", "400.css", "600.css", "400-italic.css")), ("vt323", ("400.css",))):
        base = nm / "@fontsource" / pkg
        for f in files:
            for _, rule in face.findall((base / f).read_text(encoding="utf-8")):
                woff2 = re.search(r"url\(\./files/([^)]+\.woff2)\)", rule).group(1)
                data = base64.b64encode((base / "files" / woff2).read_bytes()).decode()
                css.append(re.sub(r"src: [^;]+;", f"src: url(data:font/woff2;base64,{data}) format('woff2');", rule))
    head_fonts = re.compile(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\s*<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\s*<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]+">')
    if not head_fonts.search(src):
        raise SystemExit("game.html: Google Fonts <link> block not found")
    src = head_fonts.sub(lambda _: "<style>/* OFL fonts (IBM Plex Sans Condensed, VT323) inlined for offline play */\n" + "\n".join(css) + "\n</style>", src, count=1)
    # script: drop the CDN import map and bundle the module (three.js 0.160.0 included) with esbuild
    imap = re.compile(r'<script type="importmap">.*?</script>\s*', re.S)
    if not imap.search(src):
        raise SystemExit("game.html: import map not found")
    src = imap.sub("", src, count=1)
    start = src.index('<script type="module">') + len('<script type="module">')
    end = src.index("</script>", start)
    with tempfile.TemporaryDirectory(dir=root) as tmp:  # inside DerinlikWeb so node_modules resolves
        entry, bundle = pathlib.Path(tmp) / "entry.mjs", pathlib.Path(tmp) / "bundle.js"
        entry.write_text(src[start:end], encoding="utf-8")
        subprocess.run([str(nm / ".bin" / "esbuild"), str(entry), "--bundle", "--format=esm", "--minify", "--target=es2022",
                        "--legal-comments=none", f"--outfile={bundle}", "--log-level=warning"], check=True)
        code = bundle.read_text(encoding="utf-8").replace("</script", "<\\/script")
    src = src[:start] + "\n" + code + "\n" + src[end:]
    for host in ("cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"):
        if host in src:
            raise SystemExit(f"offline build still references {host}")

# --- document skeleton: game.html is a fragment; opened straight from disk (or in the desktop shell) the browser would
# otherwise guess a legacy encoding and garble every Turkish letter
if not src.lstrip().lower().startswith("<!doctype"):
    src = ('<!doctype html>\n<html lang="tr">\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + src)

out = pathlib.Path(args.out)
if not out.is_absolute():
    out = root / out
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(src, encoding="utf-8")
print(f"{out.relative_to(root) if out.is_relative_to(root) else out}: {len(src)/1024:.0f} KB, {len(models)} model(s), {len(textures)} texture(s), modules: {', '.join(n for n, _ in modules) or 'none'}")
