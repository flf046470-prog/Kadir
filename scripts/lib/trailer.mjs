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
 * Where each segment starts in the finished video when consecutive segments overlap by a
 * crossfade, and how long the whole thing runs. ffmpeg's `xfade` wants each join's offset measured
 * on the output timeline, which is the running total of durations less every crossfade so far —
 * the arithmetic that is easy to get wrong by one join.
 *
 * `crossfade` is one length for every join, or a list with one per join: the real footage the
 * trailer opens on dissolves quickly from shot to shot and turns into the game over a longer one.
 */
export function timeline(durations, crossfade) {
  const joins = Array.isArray(crossfade) ? crossfade : durations.slice(1).map(() => crossfade);
  if (joins.length !== durations.length - 1) throw new Error(`${durations.length} segments need ${durations.length - 1} crossfades, not ${joins.length}`);
  // A segment has to outlast both of the joins it takes part in, or the two would overlap.
  for (const [i, duration] of durations.entries()) {
    const shared = (joins[i - 1] ?? 0) + (joins[i] ?? 0);
    if (duration <= shared) throw new Error(`segment ${i} lasts ${duration} s, no longer than its crossfades (${shared} s)`);
  }
  const starts = [];
  let at = 0;
  for (const [i, duration] of durations.entries()) {
    starts.push(at);
    at += duration - (joins[i] ?? 0);
  }
  return { starts, offsets: starts.slice(1), total: at };
}

/**
 * HLG to SDR: to linear light with the HLG reference white at 203 nits (ITU-R BT.2408), into
 * BT.709 primaries, the highlights above that white rolled off (`mobius`), and back to BT.709.
 * Decoded as if it were BT.709 instead, an HLG clip comes out grey and washed out, which is how the
 * grassland plate first looked; `hable` at 100 nits came out a shade dark and orange.
 */
export const HLG_TO_SDR = ['zscale=t=linear:npl=203', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=mobius:desat=0', 'zscale=t=bt709:m=bt709:r=tv'];

/**
 * The ffmpeg filter that turns one stock plate (`assets/trailer/plates.json`) into a 1920x1080,
 * 30 fps segment of exactly `frames` frames: one source frame per trailer frame, converted to
 * BT.709, and pushed in if the plate asks for it.
 */
export function plateFilter(plate) {
  const steps = [`trim=start_frame=${plate.startFrame}:end_frame=${plate.startFrame + plate.frames}`, `setpts=N/${FPS}/TB`];
  if (plate.transfer === 'arib-std-b67') steps.push(...HLG_TO_SDR, 'format=yuv420p');
  else if (plate.transfer !== 'bt709') throw new Error(`${plate.id}: no conversion from the ${plate.transfer} transfer`);
  if (plate.push) {
    const { from, to, x, y } = plate.push;
    // zoompan crops iw/zoom x ih/zoom at (x, y) and scales it to the output: centred on (x, y),
    // clamped by zoompan itself where that would leave the frame. One frame in, one frame out.
    const zoom = `${from}+${(to - from).toFixed(4)}*on/${plate.frames - 1}`;
    steps.push(`zoompan=z='${zoom}':x='iw*${x}-iw/zoom/2':y='ih*${y}-ih/zoom/2':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS}`);
  } else {
    steps.push(`scale=${WIDTH}:${HEIGHT}:flags=lanczos`);
  }
  steps.push('setsar=1', 'format=yuv420p');
  return steps.join(',');
}

/**
 * The plates the trailer opens on, checked before anything is downloaded: every field the build
 * and the credits need, and a licence that was read.
 */
export function readPlates(manifest) {
  const plates = manifest?.plates;
  if (!Array.isArray(plates) || plates.length === 0) throw new Error('assets/trailer/plates.json lists no plates');
  if (!manifest.licence?.name || !manifest.licence?.url || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.licence?.read ?? '')) {
    throw new Error('assets/trailer/plates.json has no licence with a date it was read');
  }
  for (const plate of plates) {
    for (const key of ['id', 'title', 'page', 'creator', 'creatorPage', 'url', 'sha256', 'transfer']) {
      if (typeof plate[key] !== 'string' || plate[key].length === 0) throw new Error(`plate ${plate.id ?? '?'}: no ${key}`);
    }
    if (!/^[0-9a-f]{64}$/.test(plate.sha256)) throw new Error(`plate ${plate.id}: sha256 is not a sha256`);
    for (const key of ['bytes', 'startFrame', 'frames']) {
      if (!Number.isInteger(plate[key]) || plate[key] < 0) throw new Error(`plate ${plate.id}: ${key} is not a whole number`);
    }
    if (plate.frames < FPS) throw new Error(`plate ${plate.id}: ${plate.frames} frames is under a second`);
  }
  return plates;
}

/**
 * Cinema bars over the real footage, drawn as two black strips that slide off the top and bottom
 * of the frame between `from` and `to` (seconds on the output timeline, eased) — the picture opens
 * out to the full 16:9 of the game as the footage turns into it. `bar` is each strip's height in
 * pixels. A filtergraph fragment from `[input]` to `[output]`.
 */
export function letterbox(input, output, { bar, from, to, total }) {
  const span = (to - from).toFixed(3);
  const eased = `st(0,clip((t-${from.toFixed(3)})/${span},0,1));ld(0)*ld(0)*(3-2*ld(0))`;
  const strip = (label) => `color=c=black:s=${WIDTH}x${bar}:r=${FPS}:d=${total.toFixed(3)}[${label}]`;
  return [
    strip('lbTop'),
    strip('lbBottom'),
    `[${input}][lbTop]overlay=x=0:y='-${bar}*(${eased})':eval=frame[lbHalf]`,
    `[lbHalf][lbBottom]overlay=x=0:y='${HEIGHT - bar}+${bar}*(${eased})':eval=frame[${output}]`,
  ].join(';');
}

/**
 * The share of horizontally neighbouring pixels in rows `top` to `bottom` of a grey frame that
 * differ by at most 2 levels. Measured on the trailer: 0.22–0.50 on footage and on the game, which
 * is how a picture with detail in it reads, and 0.94–0.98 through the middle of the pixelation,
 * where the picture is blocks of one colour 54 px wide. It is how the finished video is checked to
 * turn into the game where the cut says it does, rather than trusted to.
 */
export function blockiness(gray, width, top, bottom) {
  let same = 0;
  let pairs = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = 0; x < width - 1; x++) {
      pairs++;
      if (Math.abs(gray[y * width + x] - gray[y * width + x + 1]) <= 2) same++;
    }
  }
  return pairs === 0 ? 0 : same / pairs;
}

/** The brightest pixel in rows `top` to `bottom` of a grey frame: a cinema bar is black throughout. */
export function brightest(gray, width, top, bottom) {
  let most = 0;
  for (let i = top * width; i < bottom * width; i++) most = Math.max(most, gray[i]);
  return most;
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
