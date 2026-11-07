"""Edit the marketing trailer and the App Store app preview from rendered frames.

    python3 tools/make_trailer.py <blender_frames_dir> <capture_dir> <out_dir>

Inputs
  <blender_frames_dir>/{station,selin,cave,match}/####.png   Cycles shots (render_trailer.py)
  <capture_dir>/<shot>/#####.png + shots.json                in-engine footage (capture_gameplay.cjs)

Outputs (H.264, AAC)
  trailer_1080p.mp4        marketing trailer: real-world Cycles shots → match cut into the game
                           (same camera, pixel-dissolve) → gameplay montage → title. 1920×1080,
                           2.17:1 picture letterboxed. For the web / social, NOT an App Store preview.
  app_preview_1920x886.mp4 App Store app preview: in-app footage only (Apple's rule), 30 fps,
                           ≤ 30 s, 1920×886 (6.5"/6.7"/6.9" iPhone landscape).
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


def xfade_chain(clips, transitions, out, audio=None, pad_to=None):
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
        cmd += ["-map", f"{len(clips)}:a", "-c:a", "aac", "-b:a", "192k", "-shortest"]
    cmd += ["-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-movflags", "+faststart", out]
    run(cmd)
    return t


def soundtrack(path, seconds, **cues):
    hits = cues.pop("hits", [])
    args = [sys.executable, os.path.join(HERE, "trailer_audio.py"), path, f"{seconds:.2f}"]
    args += [f"{k}={v:.2f}" for k, v in cues.items()] + ["hits=" + ",".join(f"{h:.2f}" for h in hits)]
    run(args)


def main():
    blend_dir, cap_dir, out_dir = sys.argv[1:4]
    os.makedirs(out_dir, exist_ok=True)
    meta = json.load(open(os.path.join(cap_dir, "shots.json")))
    cap_fps = meta["fps"]
    have = {s["id"] for s in meta["shots"]}
    tmp = tempfile.mkdtemp(prefix="trailer_")
    T = lambda n: os.path.join(tmp, n)   # noqa: E731

    # ---- title cards
    ice, warm, dim = (232, 249, 255), (255, 194, 146), (130, 170, 182)
    card(T("t_open.png"), [("2091", "Light", 46, dim, 26), ("ANTARKTİKA · 86° GÜNEY", "SemiBold", 54, ice, 0)])
    card(T("t_signal.png"), [("ARAŞTIRMA İSTASYONU HELIKON-14", "SemiBold", 50, ice, 30), ("03:17'DE SUSTU", "Bold", 72, warm, 0)])
    card(T("t_title.png"), [("ANTARKTİKA", "Black", 150, ice, 18), ("W H I T E O U T", "Light", 58, warm, 60),
                            ("App Store'da · Çevrimdışı · Reklamsız", "Regular", 34, dim, 0)])

    # ---- real-world (Cycles) section
    real = []
    clip_from_still(T("t_open.png"), 3.0, T("c00.mp4")); real.append(T("c00.mp4"))
    for i, shot in enumerate(["station", "selin", "cave"]):
        clip_from_frames(os.path.join(blend_dir, shot, "%04d.png"), 24, T(f"r{i}.mp4"), crop_wide=True)
        real.append(T(f"r{i}.mp4"))
    clip_from_still(T("t_signal.png"), 2.6, T("c01.mp4")); real.append(T("c01.mp4"))
    clip_from_frames(os.path.join(blend_dir, "match", "%04d.png"), 24, T("r_match.mp4"), crop_wide=True)
    real.append(T("r_match.mp4"))

    # ---- game section: the first game shot is the same camera as the match shot
    game_order = [s for s in ["g1_match", "g2_ramp_door", "g3_generator", "g4_lab_power", "g5_frequency",
                              "g6_cave_torch", "g7_crystals", "g8_selin", "g9_wide"] if s in have]
    game = []
    for s in game_order:
        clip_from_frames(os.path.join(cap_dir, s, "%05d.png"), cap_fps, T(s + ".mp4"))
        game.append(T(s + ".mp4"))
    clip_from_still(T("t_title.png"), 4.5, T("c99.mp4"), fade=0.9)

    clips = real + game + [T("c99.mp4")]
    trans = [("fade", 0.6)] * (len(real) - 1)
    trans += [("pixelize", 1.0)]                       # real life → game: the world digitises
    trans += [("fadeblack", 0.35)] * (len(game) - 1)
    trans += [("fade", 0.8)]
    # cue times for the score
    durs = [duration(c) for c in clips]
    starts, t = [], 0.0
    for i, d in enumerate(durs):
        starts.append(t)
        t += d - (trans[i][1] if i < len(trans) else 0)
    total = t
    game_cut = starts[len(real)]
    soundtrack(T("score.wav"), total, helikon=starts[2], game=game_cut, title=starts[-1], hits=starts[1:len(real)] + [game_cut])
    xfade_chain(clips, trans, os.path.join(out_dir, "trailer_1080p.mp4"), audio=T("score.wav"), pad_to=(1920, 1080))

    # ---- App Store app preview: in-app footage only, 15–30 s
    pv = [T(s + ".mp4") for s in ["g2_ramp_door", "g3_generator", "g5_frequency", "g6_cave_torch", "g7_crystals", "g8_selin", "g9_wide"] if s in have]
    ptrans = [("fadeblack", 0.3)] * (len(pv) - 1)
    pd = sum(duration(c) for c in pv) - sum(d for _, d in ptrans)
    plen = min(pd, 29.5)
    soundtrack(T("preview.wav"), plen, game=min(0.5, plen / 4), title=max(plen * 0.6, plen - 2.5), hits=[])
    xfade_chain(pv, ptrans, T("preview_full.mp4"), audio=T("preview.wav"))
    run(["ffmpeg", "-y", "-i", T("preview_full.mp4"), "-t", "29.5", "-c", "copy", os.path.join(out_dir, "app_preview_1920x886.mp4")])
    print("trailer", round(total, 1), "s · app preview", round(min(pd, 29.5), 1), "s →", out_dir)


if __name__ == "__main__":
    main()
