#!/usr/bin/env python3
"""Writes the SteamPipe build scripts that upload DERİNLİK (and its demo) to Steam with steamcmd.

    python3 DerinlikSteam/steamworks/make_steampipe.py --app <AppID> --depot <DepotID> \
        [--demo-app <AppID> --demo-depot <DepotID>] [--branch <beta branch to set live>] [--desc "..."]

The ids come from Steamworks (App Admin: the app's id; SteamPipe > Depots: its Windows depot, usually AppID + 1).
Writes DerinlikSteam/steamworks/scripts/app_build_<AppID>.vdf (and the demo's), whose content roots are the Electron
Windows folders built by DerinlikDesktop (`npm run dist:win`, `npm run dist:win:demo`). Then, from that folder:

    steamcmd +login <steam account> +run_app_build "$PWD/scripts/app_build_<AppID>.vdf" +quit

Uploading is the owner's action (their Steam account and Steam Guard); nothing here logs in or uploads.
With no --branch the build only appears under SteamPipe > Builds, where it is set live by hand (the safe default).
Format: partner.steamgames.com/doc/sdk/uploading ("Configuring depots", app build and depot build VDF).
"""
import argparse, os, pathlib

here = pathlib.Path(__file__).resolve().parent
repo = here.parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--app", type=int, required=True)
ap.add_argument("--depot", type=int, required=True)
ap.add_argument("--demo-app", type=int)
ap.add_argument("--demo-depot", type=int)
ap.add_argument("--branch", default="", help="branch to set the build live on (never 'default' from a script)")
ap.add_argument("--desc", default="DERINLIK build")
a = ap.parse_args()
if a.branch == "default":
    raise SystemExit("set the default branch live by hand in Steamworks, after testing the build on a beta branch")
if bool(a.demo_app) != bool(a.demo_depot):
    raise SystemExit("--demo-app and --demo-depot go together")

out = here / "scripts"
out.mkdir(exist_ok=True)
(here / "output").mkdir(exist_ok=True)


def q(s):
    return '"' + str(s).replace("\\", "/") + '"'


def write(app, depot, root, desc):
    content = pathlib.Path(root)
    rel = os.path.relpath(content, out).replace(os.sep, "/")   # relative to scripts/, where steamcmd reads the file
    vdf = f'''"AppBuild"
{{
	"AppID" {q(app)}
	"Desc" {q(desc)}
	"ContentRoot" {q(rel + "/")}
	"BuildOutput" {q("../output/")}
	"SetLive" {q(a.branch)}
	"Depots"
	{{
		{q(depot)}
		{{
			"FileMapping"
			{{
				"LocalPath" "*"
				"DepotPath" "."
				"recursive" "1"
			}}
			"FileExclusion" "*.pdb"
		}}
	}}
}}
'''
    path = out / f"app_build_{app}.vdf"
    path.write_text(vdf, encoding="utf-8")
    print("wrote", path.relative_to(repo), "->", content.relative_to(repo) if content.is_relative_to(repo) else content,
          "" if content.exists() else "(not built yet)")


write(a.app, a.depot, repo / "DerinlikDesktop" / "release" / "win-unpacked", a.desc)
if a.demo_app:
    write(a.demo_app, a.demo_depot, repo / "DerinlikDesktop" / "release-demo" / "win-unpacked", a.desc + " (demo)")
