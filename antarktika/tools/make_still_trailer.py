"""Fast store video from in-engine stills (tools/capture_stills.cjs) — slow push-ins and crossfades.

    python3 tools/make_still_trailer.py <stills_dir> <out.mp4> --size 1920x886 [--open keyart.jpg] [--close keyart.jpg]
                                        [--secs 3.3] [--max 29.5] [--skip 09] [--silent]

Used for the App Store app preview (1920x886, in-app frames only, <= 30 s) and the Steam / Meta trailers
(1920x1080 with key-art title and end cards). Frame-by-frame gameplay capture under the software renderer
takes hours; this builds a store-ready H.264 / AAC 48 kHz file in a few minutes.
"""
import glob
import os
import subprocess
import sys


def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d


def main():
    src, out = sys.argv[1], sys.argv[2]
    W, H = map(int, arg("--size", "1920x886").split("x"))
    d, fps, xf = float(arg("--secs", "3.3")), 30, 0.5
    skip = arg("--skip", "")
    files = [f for f in sorted(glob.glob(os.path.join(src, "*.png"))) if not (skip and os.path.basename(f).startswith(skip))]
    if arg("--open"):
        files.insert(0, arg("--open"))
    if arg("--close"):
        files.append(arg("--close"))
    n = int(d * fps)
    inp, flt = [], []
    for i, f in enumerate(files):
        inp += ["-i", f]
        z = "1.0+0.0012*on" if i % 2 == 0 else "1.11-0.0012*on"
        flt.append(f"[{i}:v]scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},"
                   f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={fps},setsar=1,format=yuv420p[v{i}]")
    prev, off = "v0", 0.0
    for i in range(1, len(files)):
        off += n / fps - xf
        flt.append(f"[{prev}][v{i}]xfade=transition=fade:duration={xf}:offset={off:.3f}[x{i}]")
        prev = f"x{i}"
    end = min(off + n / fps, float(arg("--max", "1e9")))
    # sound bed (wind, whistle, snow hiss, drone; a soft low hit on every cut) unless --silent
    bed = None
    if "--silent" not in sys.argv:
        bed = os.path.splitext(out)[0] + ".bed.wav"
        cuts = ",".join(f"{(i * (n / fps - xf)):.2f}" for i in range(1, len(files)))
        subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "make_soundbed.py"), bed, f"{end:.2f}", "--hits", cuts], check=True)
    flt.append(f"[{prev}]fade=t=in:st=0:d=0.4,fade=t=out:st={end-0.6:.2f}:d=0.6,format=yuv420p[out]")
    subprocess.run(["ffmpeg", "-y", "-v", "error"] + inp + (["-i", bed] if bed else ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]) + [
                    "-filter_complex", ";".join(flt), "-map", "[out]", "-map", f"{len(files)}:a", "-t", f"{end:.2f}",
                    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "medium", "-b:v", "10M",
                    "-r", str(fps), "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", out], check=True)
    if bed:
        os.remove(bed)
    print("ok", out, f"{end:.1f}s", W, H)


if __name__ == "__main__":
    main()
