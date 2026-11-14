#!/usr/bin/env python3
"""Builds DERİNLİK II on the first game's engine.

Takes DerinlikWeb/game.html (core: renderer, player, camcorder, audio, menus, save) and swaps the story:
the chapter registry, the title screen, the save key. src/chapters.js holds the new levels. The page is written to
DerinlikII/build/game2.html, then DerinlikWeb/build.py bundles it with the shared fx-* modules, models and textures.

Usage (repository root): python3 DerinlikII/make.py [--offline] [--out DerinlikII/dist/index.html]
"""
import argparse, pathlib, re, subprocess, sys

here = pathlib.Path(__file__).resolve().parent
web = here.parent / "DerinlikWeb"
ap = argparse.ArgumentParser()
ap.add_argument("--offline", action="store_true")
ap.add_argument("--out", default=str(here / "dist" / "index.html"))
args = ap.parse_args()

src = (web / "game.html").read_text(encoding="utf-8")
chapters = (here / "src" / "chapters.js").read_text(encoding="utf-8")


def swap(old, new, count=1, regex=False):
    global src
    n = len(re.findall(old, src, flags=re.S)) if regex else src.count(old)
    if n < 1:
        sys.exit(f"make.py: the core changed, not found: {old[:70]!r}")
    src = re.sub(old, new, src, count=count, flags=re.S) if regex else src.replace(old, new, count)


# story: the new chapters ahead of the registry, and a registry with only them
swap("/* ================================================================ chapters and transitions */",
     chapters + "\n/* ================================================================ chapters and transitions */")
swap(r"const CHAPTERS = \[.*?\n\];",
     "const CHAPTERS = [\n  { place: 'KERGUELEN-78', title: 'İSTASYON', year: '2029', build: () => buildIstasyon() },\n];", regex=True)
# chapter 1 is the last one so far: its lift ends the slice (sliceEnd), never goChapter(1)
# saves and storage: its own key; never touch the first game's keys
swap("const SAVE_KEY = 'derinlik.save.v2';", "const SAVE_KEY = 'derinlik2.save.v1';")
swap("try { localStorage.removeItem('derinlik.save.v1'); } catch (_) {} // the old story's saves do not fit the new one", "")
swap("localStorage.setItem('derinlik.legacy.v1'", "void ('derinlik.legacy.v1'")
# title screen
swap("card('03.17\\'den önce oraya var.<br>Bundan sonra kimse sana inanmayacak.', 4200);", "card('78° GÜNEY · 03.17<br>Son sinyal buradan geldi.', 4200);")
swap("<title>Derinlik · The Depths</title>", "<title>DERİNLİK II · 78° Güney</title>")
swap('<div class="eyebrow">Birinci şahıs psikolojik korku · 4 bölüm · 7 son</div>', '<div class="eyebrow">Birinci şahıs psikolojik korku · Bölüm 1 (erken sürüm)</div>')
swap("<h1>DERİNLİK</h1>", "<h1>DERİNLİK II</h1>")
swap('<p class="sub">THE DEPTHS: ECHOES OF THE FORGOTTEN</p>', '<p class="sub">78° GÜNEY</p>')
swap(r'<p class="lede">2028\. Ekin Yalın.*?</p>',
     '<p class="lede">2029, kutup gecesi. Dört merkez bir şeyi içeride tutmak için kurulmuştu; KAYIT 00 son sinyalin 78° Güney\'den geldiğini söylüyordu. '
     'Ekin, kaseti gönderen terk edilmiş sondaj istasyonuna iniyor. İlk oyunu bu tarayıcıda bitirdiysen, dünya senin bıraktığın gibi.</p>', regex=True)

out = here / "build" / "game2.html"
out.parent.mkdir(exist_ok=True)
out.write_text(src, encoding="utf-8")
cmd = [sys.executable, str(web / "build.py"), "--src", str(out), "--out", str(pathlib.Path(args.out).resolve())] + (["--offline"] if args.offline else [])
sys.exit(subprocess.call(cmd))
