"""Polar sound bed for the store videos, built with ffmpeg's generators (no third-party audio).

    python3 tools/make_soundbed.py <out.wav> <seconds> [--hits 3.3,6.1,...]

Layers, after the game's own WebAudio design (a3d.js sfxUpdate): a gusting low wind (brown noise through a
slowly swept low-pass), a high whistle (narrow band-pass on pink noise), a hiss of blown snow, and a low
two-note drone (A1 + E2) that swells toward the end. Optional soft low hits mark the cuts.
48 kHz stereo, peaks kept below -3 dBFS.
"""
import subprocess
import sys


def main():
    out, dur = sys.argv[1], float(sys.argv[2])
    hits = [float(x) for x in sys.argv[sys.argv.index("--hits") + 1].split(",")] if "--hits" in sys.argv else []
    D = f"{dur:.2f}"
    src = [
        f"anoisesrc=d={D}:c=brown:r=48000:a=0.9:seed=7",
        f"anoisesrc=d={D}:c=pink:r=48000:a=0.5:seed=11",
        f"anoisesrc=d={D}:c=white:r=48000:a=0.2:seed=13",
        f"sine=f=55:d={D}:r=48000",
        f"sine=f=82.4:d={D}:r=48000",
    ]
    f = [
        # gusts: low-pass wind with a slow tremolo, panned slightly by a phase-offset echo
        "[0]lowpass=f=420,tremolo=f=0.13:d=0.7,volume=1.9,aecho=0.8:0.6:37:0.25[wind]",
        "[1]bandpass=f=1250:width_type=q:w=14,tremolo=f=0.11:d=0.9,volume=4.0[whistle]",
        "[2]highpass=f=3800,tremolo=f=0.21:d=0.8,volume=0.32[hiss]",
        f"[3][4]amix=inputs=2:normalize=0,volume=0.10,afade=t=in:d=3,volume='0.6+0.4*t/{D}':eval=frame[drone]",
    ]
    mix = ["[wind]", "[whistle]", "[hiss]", "[drone]"]
    for i, t in enumerate(hits):
        src.append(f"sine=f=46:d=1.6:r=48000")
        f.append(f"[{5 + i}]afade=t=in:d=0.02,afade=t=out:st=0.08:d=1.5,volume=0.5,adelay={int(t * 1000)}|{int(t * 1000)},apad=whole_dur={D}[h{i}]")
        mix.append(f"[h{i}]")
    f.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0,aformat=channel_layouts=stereo,"
             f"afade=t=in:d=1.2,afade=t=out:st={dur - 1.5:.2f}:d=1.5,alimiter=limit=0.7,atrim=0:{D}[a]")
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for s in src:
        cmd += ["-f", "lavfi", "-i", s]
    cmd += ["-filter_complex", ";".join(f), "-map", "[a]", "-ar", "48000", "-c:a", "pcm_s16le", out]
    subprocess.run(cmd, check=True)
    print("ok", out, D, "s")


if __name__ == "__main__":
    main()
