#!/usr/bin/env python3
"""Builds DerinlikWeb/dist/index.html from game.html, inlining Blender GLB props from models/ (if any)."""
import base64, json, pathlib
root = pathlib.Path(__file__).resolve().parent
src = (root / "game.html").read_text(encoding="utf-8")
models = {}
manifest = root / "models" / "manifest.json"
if manifest.exists():
    for name, spec in json.loads(manifest.read_text()).items():
        glb = root / "models" / f"{name}.glb"
        if glb.exists():
            models[name] = {"glb": base64.b64encode(glb.read_bytes()).decode(), "place": spec["place"]}
out = src.replace("{/*MODELS*/}", json.dumps(models) if models else "{}")
(root / "dist").mkdir(exist_ok=True)
(root / "dist" / "index.html").write_text(out, encoding="utf-8")
print(f"dist/index.html: {len(out)/1024:.0f} KB, {len(models)} model(s)")
