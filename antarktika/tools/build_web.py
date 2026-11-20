"""Assemble the hosted web build (Meta Quest PWA / browser) from the iOS Game folder.

    python3 tools/build_web.py [out_dir]        (default: antarktika/dist/web)

Copies ios/Antarktika/Game, adds quest/manifest.webmanifest and quest/icons, and links the manifest
from index.html. If quest/assetlinks.json exists (made from assetlinks.template.json once the
signing key is chosen) it is published at /.well-known/assetlinks.json. The output is a static
site: deploy it as its own project (root = the output folder) so that it is served from "/".
"""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GAME = os.path.join(ROOT, "ios", "Antarktika", "Game")
QUEST = os.path.join(ROOT, "quest")
out = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "dist", "web")

if os.path.exists(out):
    shutil.rmtree(out)
shutil.copytree(GAME, out)
shutil.copy(os.path.join(QUEST, "manifest.webmanifest"), os.path.join(out, "manifest.webmanifest"))
icons = os.path.join(QUEST, "icons")
if os.path.isdir(icons):
    shutil.copytree(icons, os.path.join(out, "icons"))
links = os.path.join(QUEST, "assetlinks.json")
if os.path.exists(links):
    os.makedirs(os.path.join(out, ".well-known"), exist_ok=True)
    shutil.copy(links, os.path.join(out, ".well-known", "assetlinks.json"))
p = os.path.join(out, "index.html")
s = open(p, encoding="utf-8").read()
tag = '<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#06202e"><link rel="icon" href="icons/icon-192.png">'
assert "<title>" in s
s = s.replace("<title>", tag + "<title>", 1)
open(p, "w", encoding="utf-8").write(s)
# static-host config: correct manifest MIME type, long cache for models
open(os.path.join(out, "vercel.json"), "w").write(
    '{\n  "headers": [\n    { "source": "/manifest.webmanifest", "headers": [{ "key": "Content-Type", "value": "application/manifest+json" }] },\n'
    '    { "source": "/models/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800" }] }\n  ]\n}\n')
size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(out) for f in fs)
print("web build →", out, "%.1f MB" % (size / 1e6), "assetlinks:", os.path.exists(links))
