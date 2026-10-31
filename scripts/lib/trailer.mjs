/**
 * The arithmetic behind the store trailer, kept out of the capture script so it can be tested:
 * where each cut lands, what the captions say, and which ffmpeg can encode the result.
 */

import { execFileSync } from 'node:child_process';

/** Both stores take 30 fps (Epic: "30 fps or 60 fps (non drop-frame)"). */
export const FPS = 30;
/** Epic's carousel video and Steam's trailer are both 1920x1080. */
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** Epic's ceiling for a carousel video. */
export const MAX_BYTES = 300 * 1024 * 1024;

/**
 * Where each segment starts in the finished video when consecutive segments overlap by
 * `crossfade` seconds, and how long the whole thing runs. ffmpeg's `xfade` wants each join's
 * offset measured on the output timeline, which is the running total of durations less one
 * crossfade per join so far — the arithmetic that is easy to get wrong by one join.
 */
export function timeline(durations, crossfade) {
  if (durations.some((d) => d <= crossfade)) throw new Error('every segment must be longer than the crossfade');
  const starts = [];
  let at = 0;
  for (const duration of durations) {
    starts.push(at);
    at += duration - crossfade;
  }
  return { starts, offsets: starts.slice(1), total: at + crossfade };
}

/**
 * The captions, one per gameplay shot, read from `docs/PC_LISTINGS.md`'s "Trailer captions"
 * block — the same file whose numbers `copy.test.ts` holds to the code, so a caption cannot claim
 * a mode count the game does not have.
 */
export function readCaptions(markdown) {
  const section = markdown.match(/^## Trailer captions\n[\s\S]*?^```[^\n]*\n([\s\S]*?)^```/m);
  if (!section) throw new Error('docs/PC_LISTINGS.md has no "## Trailer captions" block');
  return section[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * An ffmpeg that can write what the stores take: H.264 video and AAC audio.
 *
 * Playwright ships an ffmpeg, and it cannot — it is built for its own VP8 screen recordings. So
 * this looks for `$FFMPEG`, then `ffmpeg` on the path, then the static build in the
 * `imageio-ffmpeg` Python package (`pip install imageio-ffmpeg`), and asks each for `libx264`
 * rather than trusting that a binary called ffmpeg has it.
 */
export function findFfmpeg() {
  const candidates = [];
  if (process.env.FFMPEG) candidates.push(process.env.FFMPEG);
  candidates.push('ffmpeg');
  try {
    candidates.push(execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim());
  } catch {
    // Not installed; the error below says how to get it.
  }
  for (const bin of candidates) {
    try {
      const encoders = execFileSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (/\blibx264\b/.test(encoders) && /\baac\b/.test(encoders)) return bin;
    } catch {
      // Missing or broken; try the next.
    }
  }
  return null;
}

/**
 * Replaces `performance.now` and `requestAnimationFrame` so the capture decides when a frame
 * happens and how much game time it covers. Installed with `addInitScript`, before the game's own
 * code runs.
 *
 * Under swiftshader the game draws about one frame a second, and its loop caps a frame's step at
 * 100 ms — so in real time a trailer would be a slow-motion slideshow, which is what the old GIF
 * capture produced at 12 fps. Held, every `step(ms)` runs exactly one frame `ms` later in game
 * time, however long the drawing takes, and the video plays at the speed the game does.
 *
 * Not touched: `Date.now` and timers. Nothing that moves on screen reads them (`GameClient.frame`
 * takes its time from the animation frame), and the music they schedule is rendered separately.
 */
export function timeControlSource() {
  return `(() => {
    const realNow = performance.now.bind(performance);
    const realRaf = window.requestAnimationFrame.bind(window);
    const realCancel = window.cancelAnimationFrame.bind(window);
    let held = false;
    let now = 0;
    let nextId = 1;
    const queue = new Map();
    performance.now = () => (held ? now : realNow());
    window.requestAnimationFrame = (cb) => {
      if (!held) return realRaf(cb);
      const id = -(nextId++);
      queue.set(id, cb);
      return id;
    };
    window.cancelAnimationFrame = (id) => (id < 0 ? queue.delete(id) : realCancel(id));
    window.__kcTime = {
      hold() {
        if (held) return;
        now = realNow();
        held = true;
      },
      step(ms, snap = false) {
        now += ms;
        const due = [...queue.values()];
        queue.clear();
        for (const cb of due) cb(now);
        if (!snap) return null;
        // Read the frame back in the same task that drew it, while the drawing buffer still holds
        // it: once the page composites, a WebGL canvas without preserveDrawingBuffer is cleared.
        const canvas = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        return canvas ? canvas.toDataURL('image/jpeg', 0.92) : null;
      },
    };
  })();`;
}
