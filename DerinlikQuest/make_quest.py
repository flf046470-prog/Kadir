#!/usr/bin/env python3
"""Builds the Meta Quest (Horizon Store) web app and its packaging files.

The Quest version is the offline game page served as an installable web app (PWA). Meta's bubblewrap wraps the live
page into a signed APK (a Trusted Web Activity) that runs it as an immersive WebXR app; installed that way the game
goes straight into the headset (src/fx-xr.js, getDigitalGoodsService).

    python3 DerinlikQuest/make_quest.py                       # web/ only: the site to deploy
    python3 DerinlikQuest/make_quest.py --host derinlik.example.com --app-id 0 \
        --keystore /safe/place/derinlik.keystore [--fingerprint AA:BB:...]

Writes
  web/                         the site: index.html (offline game + manifest link), manifest.webmanifest, icons/,
                               privacy.html, vercel.json; with --fingerprint also .well-known/assetlinks.json
  twa/twa-manifest.json        with --host: bubblewrap's input (horizonOSAppMode "immersive")

Nothing here deploys, signs or uploads: those need the owner's accounts (see README.md).
"""
import argparse, json, pathlib, re, shutil, subprocess, sys

here = pathlib.Path(__file__).resolve().parent
repo = here.parent
ap = argparse.ArgumentParser()
ap.add_argument("--host", help="the public HTTPS host the web app is served from, e.g. derinlik.vercel.app")
ap.add_argument("--app-id", default="0", help="numeric Horizon App ID ('0' builds and sideloads without store features)")
ap.add_argument("--package", default="com.derinlik.quest", help="Android package name; permanent once uploaded")
ap.add_argument("--keystore", help="signing keystore path (kept OUTSIDE web/; permanent: every update must reuse it)")
ap.add_argument("--alias", default="derinlik")
ap.add_argument("--fingerprint", help="the keystore's SHA-256 certificate fingerprint (colon hex) for assetlinks.json; default: signing.json")
ap.add_argument("--version", type=int, default=1, help="version code; must rise with every uploaded build")
ap.add_argument("--version-name", default="0.1.0")
ap.add_argument("--skip-build", action="store_true", help="reuse web/index.html")
a = ap.parse_args()
# the release key's public identity is kept in the repository (signing.json); its file and password are not
signing = json.loads((pathlib.Path(__file__).resolve().parent / "signing.json").read_text(encoding="utf-8"))
a.fingerprint = a.fingerprint or signing["sha256"]
if a.package == "com.derinlik.quest": a.package = signing["package"]
if a.alias == "derinlik": a.alias = signing["alias"]

web = here / "web"
public = here / "public"
web.mkdir(exist_ok=True)

# --- the game page: the offline build (no CDN, fonts inside), plus the manifest link the store wrapper needs
page = web / "index.html"
if not a.skip_build:
    subprocess.run([sys.executable, str(repo / "DerinlikWeb" / "build.py"), "--offline", "--out", str(page)], check=True)
html = page.read_text(encoding="utf-8")
head = ('<link rel="manifest" href="/manifest.webmanifest">\n<meta name="theme-color" content="#050506">\n'
        '<link rel="icon" href="/icons/icon-192.png">\n')
if 'rel="manifest"' not in html:
    html = html.replace('<meta charset="utf-8">\n', '<meta charset="utf-8">\n' + head, 1)
    assert 'rel="manifest"' in html, "build.py output has no <meta charset> line to put the manifest link after"
    page.write_text(html, encoding="utf-8")

# --- static files: manifest, icons, privacy policy
for p in public.rglob("*"):
    if p.is_file():
        dst = web / p.relative_to(public)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst)
# the manifest must be served as application/manifest+json; assetlinks as JSON; the page never cached stale
(web / "vercel.json").write_text(json.dumps({"headers": [
    {"source": "/manifest.webmanifest", "headers": [{"key": "Content-Type", "value": "application/manifest+json"}]},
    {"source": "/.well-known/assetlinks.json", "headers": [{"key": "Content-Type", "value": "application/json"}]},
    {"source": "/", "headers": [{"key": "Cache-Control", "value": "no-cache"}]},
]}, indent=1) + "\n", encoding="utf-8")

if a.fingerprint:
    if not re.fullmatch(r"([0-9A-F]{2}:){31}[0-9A-F]{2}", a.fingerprint.upper()):
        raise SystemExit("--fingerprint must be the SHA-256 in colon hex (32 bytes), as keytool -list -v prints it")
    (web / ".well-known").mkdir(exist_ok=True)
    (web / ".well-known" / "assetlinks.json").write_text(json.dumps([{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {"namespace": "android_app", "package_name": a.package, "sha256_cert_fingerprints": [a.fingerprint.upper()]},
    }], indent=1) + "\n", encoding="utf-8")

# --- bubblewrap input (the scripted path: bubblewrap init needs a terminal)
if a.host:
    host = re.sub(r"^https?://", "", a.host).rstrip("/")
    if a.keystore and pathlib.Path(a.keystore).resolve().is_relative_to(web.resolve()):
        raise SystemExit("the keystore must not live inside web/: that folder is deployed publicly")
    twa = here / "twa"
    twa.mkdir(exist_ok=True)
    m = json.loads((public / "manifest.webmanifest").read_text(encoding="utf-8"))
    (twa / "twa-manifest.json").write_text(json.dumps({
        "packageId": a.package, "applicationId": str(a.app_id), "host": host,
        "name": m["name"], "launcherName": m["short_name"],
        "display": "standalone", "orientation": "landscape",
        "themeColor": m["theme_color"], "backgroundColor": m["background_color"], "startUrl": "/",
        "navigationColor": m["theme_color"], "themeColorDark": m["theme_color"], "navigationColorDark": m["theme_color"],
        # fields bubblewrap's Gradle template prints verbatim: left out, they become a syntax error in build.gradle
        "enableNotifications": False, "splashScreenFadeOutDuration": 300, "enableSiteSettingsShortcut": False,
        "enableMicrophone": False, "enableXRScene": False, "shortcuts": [], "generatorApp": "bubblewrap-cli",
        "iconUrl": f"https://{host}/icons/icon-512.png", "maskableIconUrl": f"https://{host}/icons/icon-512-maskable.png",
        "webManifestUrl": f"https://{host}/manifest.webmanifest",
        "signingKey": {"path": str(pathlib.Path(a.keystore).resolve()) if a.keystore else "", "alias": a.alias},
        "appVersion": a.version_name, "appVersionCode": a.version,   # bubblewrap reads the version name from "appVersion"
        "fallbackType": "customtabs", "features": {},
        "isMetaQuest": True, "horizonOSAppMode": "immersive",   # WebXR: "2D" would show a URL bar, not the headset
        "fingerprints": [], "minSdkVersion": 29,
    }, indent=1) + "\n", encoding="utf-8")
    print("wrote", (twa / "twa-manifest.json").relative_to(repo))

size = sum(p.stat().st_size for p in web.rglob("*") if p.is_file())
print(f"web/: {size / 1e6:.1f} MB, {sum(1 for p in web.rglob('*') if p.is_file())} files"
      + ("" if a.fingerprint else " (no assetlinks.json yet: pass --fingerprint once the signing key exists)"))
