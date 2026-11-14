"""Edit the store trailers and the App Store app preview.

    python3 tools/make_trailer.py trailer <keyart_dir> <capture_dir> <out.mp4> --store steam|meta|web
    python3 tools/make_trailer.py preview <capture_dir> <out.mp4>

Inputs
  <keyart_dir>/keyart_{station,city,camp}.png        Cycles stills (blender/scripts/render_keyart.py)
  <capture_dir>/<shot>/#####.png + shots.json        in-engine footage (capture_gameplay.cjs)

trailer  Cycles stills with a slow camera push -> gameplay montage of all seven chapters -> logo.
         Picture size = the capture size (1920x1080 for Steam / Meta). H.264 high, 30 fps, ~10 Mb/s,
         AAC 48 kHz (Steam asks for >= 5000 kb/s; Meta for 1080p H.264/AAC, 30 s - 2 min, logo only
         at the start or the end, so the meta cut ends on the logotype alone).
preview  App Store app preview: in-app footage only (Apple's rule), 30 fps, <= 30 s, 1920x886.
Titles are drawn with Pillow (Inter, SIL OFL) and the soundtrack comes from trailer_audio.py.
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1920, 886          # picture area (iPhone landscape app-preview size, ~2.17:1)
FPS = 30
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-{}.otf"


def run(cmd):
    print("+", " ".join(cmd[:6]), "...")
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def font(weight, size):
    try:
        return ImageFont.truetype(FONT.format(weight), size)
    except OSError:
        return ImageFont.load_default()


def card(path, lines, bg=(3, 10, 16)):
    """Title card: list of (text, weight, size, rgb, spacing_after)."""
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    total = sum(s + gap for _, _, s, _, gap in lines)
    y = (H - total) // 2
    for text, weight, size, rgb, gap in lines:
        f = font(weight, size)
        w = d.textlength(text, font=f)
        d.text(((W - w) / 2, y), text, font=f, fill=rgb)
        y += size + gap
    im.save(path)


def clip_from_frames(pattern, src_fps, out, seconds=None, crop_wide=False, start=1):
    """Frames → 30 fps clip at W×H. Cycles frames are 16:9 and get a centre crop to 2.17:1."""
    vf = []
    if crop_wide:
        vf += [f"scale={W}:-2:flags=lanczos", f"crop={W}:{H}"]
    else:
        vf += [f"scale={W}:{H}:flags=lanczos"]
    vf += [f"fps={FPS}", "format=yuv420p"]
    cmd = ["ffmpeg", "-y", "-framerate", str(src_fps), "-start_number", str(start), "-i", pattern]
    if seconds:
        cmd += ["-t", str(seconds)]
    cmd += ["-vf", ",".join(vf), "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-an", out]
    run(cmd)


def clip_from_still(png, seconds, out, fade=0.6):
    run(["ffmpeg", "-y", "-loop", "1", "-framerate", str(FPS), "-t", str(seconds), "-i", png,
         "-vf", f"fade=t=in:st=0:d={fade},fade=t=out:st={seconds - fade}:d={fade},format=yuv420p",
         "-c:v", "libx264", "-crf", "16", "-an", out])


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def xfade_chain(clips, transitions, out, audio=None, pad_to=None, bitrate=None):
    """Concatenate clips with xfade transitions [(kind, seconds)] between consecutive clips."""
    inputs, parts = [], []
    for c in clips:
        inputs += ["-i", c]
    durs = [duration(c) for c in clips]
    label, t = "[0:v]", durs[0]
    for i in range(1, len(clips)):
        kind, d = transitions[i - 1]
        nxt = f"[x{i}]"
        parts.append(f"{label}[{i}:v]xfade=transition={kind}:duration={d}:offset={t - d:.3f}{nxt}")
        label, t = nxt, t + durs[i] - d
    vf = ";".join(parts)
    final = label
    if pad_to:
        vf += f";{label}pad={pad_to[0]}:{pad_to[1]}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[vout]"
        final = "[vout]"
    cmd = ["ffmpeg", "-y"] + inputs
    if audio:
        cmd += ["-i", audio]
    cmd += ["-filter_complex", vf, "-map", final]
    if audio:
        cmd += ["-map", f"{len(clips)}:a", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest"]
    cmd += ["-c:v", "libx264"] + (["-b:v", bitrate, "-maxrate", "14M", "-bufsize", "20M"] if bitrate else ["-crf", "18"])
    cmd += ["-preset", "slow", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(FPS), "-movflags", "+faststart", out]
    run(cmd)
    return t


def soundtrack(path, seconds, **cues):
    hits = cues.pop("hits", [])
    args = [sys.executable, os.path.join(HERE, "trailer_audio.py"), path, f"{seconds:.2f}"]
    args += [f"{k}={v:.2f}" for k, v in cues.items()] + ["hits=" + ",".join(f"{h:.2f}" for h in hits)]
    run(args)


def push_in(png, seconds, out, zoom=0.09, focus=(0.5, 0.5)):
    """Slow camera push on a still (rendered larger than the frame, so the zoom stays sharp)."""
    n = int(seconds * FPS)
    z = f"1+{zoom}*on/{n}"
    vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop={W * 2}:{H * 2},"
          f"zoompan=z='{z}':x='(iw-iw/zoom)*{focus[0]}':y='(ih-ih/zoom)*{focus[1]}':d={n}:s={W}x{H}:fps={FPS},format=yuv420p")
    run(["ffmpeg", "-y", "-i", png, "-vf", vf, "-frames:v", str(n), "-c:v", "libx264", "-crf", "15", "-an", out])


def load(cap_dir):
    global W, H
    meta = json.load(open(os.path.join(cap_dir, "shots.json")))
    W, H = meta["size"]
    return meta["fps"], {s["id"] for s in meta["shots"]}


GAME = ["g2_ramp_door", "g3_generator", "g5_frequency", "g6_cave_torch", "g7_crystals", "h1_hall_stars", "h2_kaan",
        "c1_city_bridge", "c2_spire", "gr1_gallery", "gr2_sync", "k1_camp_drone", "k2_camp_pump", "t1_tower_clock", "g9_wide"]
PREVIEW = ["g2_ramp_door", "g7_crystals", "h1_hall_stars", "c1_city_bridge", "gr2_sync", "k1_camp_drone", "t1_tower_clock"]
END_LINE = {"steam": "Steam'de · Masaüstü ve VR", "web": "Çevrimdışı · Reklamsız · Yedi bölüm, üç son", "meta": None}


def trailer(key_dir, cap_dir, out, store):
    cap_fps, have = load(cap_dir)
    tmp = tempfile.mkdtemp(prefix="trailer_")
    T = lambda n: os.path.join(tmp, n)   # noqa: E731
    k = H / 886
    ice, warm, dim = (232, 249, 255), (255, 194, 146), (130, 170, 182)
    Z = lambda v: int(v * k)             # noqa: E731
    card(T("t_open.png"), [("2091", "Light", Z(46), dim, Z(26)), ("ANTARKTİKA · 86° GÜNEY", "SemiBold", Z(54), ice, 0)])
    card(T("t_signal.png"), [("ARAŞTIRMA İSTASYONU HELIKON-14", "SemiBold", Z(50), ice, Z(30)), ("03:17'DE SUSTU", "Bold", Z(72), warm, 0)])
    card(T("t_under.png"), [("BUZUN DÖRT KİLOMETRE ALTINDA", "SemiBold", Z(50), ice, Z(30)), ("BİRİ IŞIKLARI AÇIK BIRAKMIŞ", "Bold", Z(64), warm, 0)])
    card(T("t_end.png"), [("YEDİ BÖLÜM", "Light", Z(52), dim, Z(22)), ("ÜÇ SON", "Bold", Z(92), warm, 0)])
    lines = [("ANTARKTIKA", "Black", Z(150), ice, Z(18)), ("W H I T E O U T", "Light", Z(58), warm, Z(60) if END_LINE[store] else 0)]
    if END_LINE[store]:
        lines.append((END_LINE[store], "Regular", Z(34), dim, 0))
    card(T("t_title.png"), lines)

    A = lambda n: os.path.join(key_dir, n)   # noqa: E731
    real = []
    clip_from_still(T("t_open.png"), 2.8, T("c00.mp4")); real.append(T("c00.mp4"))
    push_in(A("keyart_station.png"), 4.5, T("r0.mp4"), focus=(0.55, 0.55)); real.append(T("r0.mp4"))
    clip_from_still(T("t_signal.png"), 2.6, T("c01.mp4")); real.append(T("c01.mp4"))
    push_in(A("keyart_city.png"), 4.5, T("r1.mp4"), focus=(0.5, 0.45)); real.append(T("r1.mp4"))
    clip_from_still(T("t_under.png"), 2.6, T("c02.mp4")); real.append(T("c02.mp4"))
    push_in(A("keyart_camp.png"), 4.0, T("r2.mp4"), focus=(0.5, 0.5)); real.append(T("r2.mp4"))

    game = []
    for s in [g for g in GAME if g in have]:
        clip_from_frames(os.path.join(cap_dir, s, "%05d.png"), cap_fps, T(s + ".mp4"))
        game.append(T(s + ".mp4"))
    clip_from_still(T("t_end.png"), 2.4, T("c98.mp4"))
    clip_from_still(T("t_title.png"), 4.5, T("c99.mp4"), fade=0.9)

    clips = real + game + [T("c98.mp4"), T("c99.mp4")]
    trans = [("fade", 0.6)] * (len(real) - 1) + [("pixelize", 0.9)]      # rendered world -> the game
    trans += [("fadeblack", 0.35)] * (len(game) - 1) + [("fade", 0.6), ("fade", 0.8)]
    durs = [duration(c) for c in clips]
    starts, t = [], 0.0
    for i, d in enumerate(durs):
        starts.append(t)
        t += d - (trans[i][1] if i < len(trans) else 0)
    game_cut = starts[len(real)]
    soundtrack(T("score.wav"), t, helikon=starts[3], game=game_cut, title=starts[-1], hits=[starts[1], starts[3], starts[5], game_cut])
    xfade_chain(clips, trans, out, audio=T("score.wav"), bitrate="10M")
    print("trailer", store, round(t, 1), "s", f"{W}x{H}", "->", out)


def preview(cap_dir, out):
    cap_fps, have = load(cap_dir)
    tmp = tempfile.mkdtemp(prefix="preview_")
    T = lambda n: os.path.join(tmp, n)   # noqa: E731
    pv = []
    for s in [g for g in PREVIEW if g in have]:
        clip_from_frames(os.path.join(cap_dir, s, "%05d.png"), cap_fps, T(s + ".mp4"))
        pv.append(T(s + ".mp4"))
    ptrans = [("fadeblack", 0.3)] * (len(pv) - 1)
    pd = sum(duration(c) for c in pv) - sum(d for _, d in ptrans)
    plen = min(pd, 29.5)
    soundtrack(T("preview.wav"), plen, game=min(0.5, plen / 4), title=max(plen * 0.6, plen - 2.5), hits=[])
    xfade_chain(pv, ptrans, T("full.mp4"), audio=T("preview.wav"))
    run(["ffmpeg", "-y", "-i", T("full.mp4"), "-t", "29.5", "-c", "copy", "-movflags", "+faststart", out])
    print("app preview", round(plen, 1), "s", f"{W}x{H}", "->", out)


def main():
    a = sys.argv[1:]
    os.makedirs(os.path.dirname(os.path.abspath(a[-1] if a[0] == "preview" else a[3])), exist_ok=True)
    if a[0] == "preview":
        preview(a[1], a[2])
    else:
        trailer(a[1], a[2], a[3], a[a.index("--store") + 1] if "--store" in a else "web")


if __name__ == "__main__":
    main()
