#!/usr/bin/env node
/**
 * The store trailer: a 1920x1080, 30 fps H.264/AAC MP4 of the real game, for a Steam page and
 * for Epic's media carousel, which lists a video as required.
 *
 *   Epic carousel video   1920x1080, MP4, 30 or 60 fps (non drop-frame), AAC stereo 48 kHz, ≤ 300 MB
 *   Steam trailer         1920x1080 recommended, H.264 MP4; shown first on the page
 *
 * It opens on nine seconds of real kangaroos — stock footage, `assets/trailer/plates.json`, under
 * the Pexels License — and the last of them, bounding away from the camera, pixelates into the
 * player's own kangaroo doing the same in the game. Every frame from there on is the built game,
 * driven through the same menus a player uses, in solo practice with bots: nothing is staged and
 * nothing here can show a feature the game does not have. What this adds is time. Under swiftshader the game draws about a frame a second, so `timeControlSource`
 * holds the game's clock and steps it exactly 1/30 s per captured frame — the video plays at the
 * speed the game does, however long each frame takes to draw. The interface is hidden; a caption
 * per shot comes from `docs/PC_LISTINGS.md`, where `copy.test.ts` checks its numbers.
 *
 * The soundtrack is wind and birds under the real footage, a sweep and a hit where it turns into
 * the game, and then the game's own score (`scheduleBar`), all rendered offline — see
 * `lib/trailer-audio.ts` for why nothing recorded is in it.
 *
 * Usage:
 *   pip install imageio-ffmpeg            # an ffmpeg with libx264; Playwright's cannot write H.264
 *   npm run build:client && npm run pack:trailer
 *   npm run pack:trailer -- --resume       # keep the shots a run that died already finished
 *
 * The stock footage is downloaded into dist/trailer-stock/ on the first run (about 145 MB) and
 * refused unless it is byte for byte the file whose licence was read.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  enterMatch,
  frameUp,
  pursuit,
  growTo,
  hideInterface,
  imageDataUri,
  pinStoreQuality,
  releaseKeys,
  renderCover,
  renderLogo,
  renderModel,
  rollPastCountdown,
  seekPlayers,
  serveDist,
  Steering,
} from './lib/listing.mjs';
import {
  FPS,
  HEIGHT,
  MAX_BYTES,
  WIDTH,
  blockiness,
  brightest,
  findFfmpeg,
  letterbox,
  plateFilter,
  readCaptions,
  readPlates,
  timeControlSource,
  timeline,
} from './lib/trailer.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist', 'client');
const WORK = path.join(root, 'dist', 'trailer-work');
const STOCK = path.join(root, 'dist', 'trailer-stock');
const OUT = path.join(root, 'packaging', 'steam', 'listing', 'trailer', 'kangaroo-chase-trailer.mp4');
const EPIC_COPY = path.join(root, 'packaging', 'epic', 'listing', 'carousel', '00-trailer.mp4');

const TITLE_SECONDS = 3.5;
const END_SECONDS = 4.5;
const CROSSFADE = 0.5;
/** Between one real shot and the next: quick, as a documentary cuts. */
const REAL_DISSOLVE = 0.3;
/**
 * The real footage turning into the game: ffmpeg's `pixelize` transition, whose blocks grow to
 * about 54 px at its middle — where one picture has become the other — and shrink away again.
 */
const TRANSFORM_SECONDS = 1.6;
/**
 * Cinema bars over the real footage, which slide off as it turns into the game and the picture
 * opens out to the game's full 16:9. 60 px a side is 2:1; the 2.39:1 of a cinema (138 px) cut off
 * the ears of the kangaroo that looks into the camera.
 */
const LETTERBOX = 60;

/**
 * Five shots, three maps, five modes. `turn` is how far the camera swings across the shot, in
 * mouse pixels; alternating its sign keeps consecutive shots from all drifting the same way.
 *
 * Each mode is filmed on the map where its players are most often close: the share of
 * player-seconds with somebody within 12 m and in sight, six bots, 4 seeds × 90 s
 * (`captureViewOf`). Chase: outback 33 %. Duel: glacier 44 %. King of the Hill: glacier 71 % — on
 * the outback the filming player once started 140 m from everybody, in a rock corner, which no
 * average over bots predicts. Roo Ball is 96–98 % anywhere, so it carries the jungle and closes the
 * trailer on the outback. Every mode where one side runs from the other films badly, whatever its
 * average: the Hunt (17–31 %) and Infection (40 % on the glacier) each closed a take, and each was
 * a kangaroo alone — the runners are as fast as the one filming them. Consecutive shots change map.
 *
 * The first shot is the one the real footage (`assets/trailer/plates.json`) turns into: the chase
 * on the outback, the player's own kangaroo hopping away from the camera across dry grass and red
 * earth — the picture the last real shot ends on. Its caption waits for the pixelation to clear
 * (`captionAt`).
 */
const SHOTS = [
  { mode: 'Kangaroo Chase', map: 'Outback Station', seconds: 7, turn: -200, captionAt: 1.7 },
  { mode: 'King of the Hill', map: 'Glacier World', seconds: 6.5, turn: 240 },
  { mode: 'Roo Ball', map: 'Jungle World', seconds: 6.5, turn: -160 },
  { mode: 'Conversion Duel', map: 'Glacier World', seconds: 6.5, turn: 180 },
  { mode: 'Roo Ball', map: 'Outback Station', seconds: 6.5, turn: -220 },
];

// Filming takes about two hours under swiftshader, and one run was killed at that mark during its
// fifth shot with nothing kept: the shots it had finished were in the work folder, but their first
// frames, which the title and end cards are drawn over, were only ever held in memory. A finished
// shot now leaves its first frame and a marker beside its video, and `--resume` films only the rest.
const RESUME = process.argv.includes('--resume');

const problems = [];
const problem = (m) => problems.push(m);
const log = (m) => console.log(`pack:trailer — ${m}`);

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
  console.error('pack:trailer — no ffmpeg with libx264 and aac. `pip install imageio-ffmpeg`, or set FFMPEG.');
  process.exit(1);
}

const captions = readCaptions(await readFile(path.join(root, 'docs', 'PC_LISTINGS.md'), 'utf8'));
if (captions.length !== SHOTS.length + 1) {
  console.error(`pack:trailer — docs/PC_LISTINGS.md has ${captions.length} trailer captions; ${SHOTS.length + 1} are needed (one per shot, one for the end card).`);
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('pack:trailer — playwright is not installed.');
  process.exit(1);
}
try {
  await readFile(path.join(DIST, 'index.html'));
} catch {
  console.error('pack:trailer — dist/client is missing. Run `npm run build:client` first.');
  process.exit(1);
}

if (!RESUME) await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });

// --- the real footage -----------------------------------------------------------------------------

const plates = readPlates(JSON.parse(await readFile(path.join(root, 'assets', 'trailer', 'plates.json'), 'utf8')));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * A plate's source file, downloaded once into dist/trailer-stock/ and refused unless it is byte for
 * byte the file whose licence was read: a stock site can replace a file behind the same address.
 */
async function stock(plate) {
  const file = path.join(STOCK, `${plate.id}-${plate.sha256.slice(0, 12)}.mp4`);
  try {
    if ((await stat(file)).size === plate.bytes && sha256(await readFile(file)) === plate.sha256) return file;
  } catch {
    // Not downloaded yet.
  }
  log(`downloading the "${plate.id}" plate (${(plate.bytes / 1e6).toFixed(1)} MB) from Pexels…`);
  const response = await fetch(plate.url);
  if (!response.ok) throw new Error(`${plate.id}: GET ${plate.url} -> HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (bytes.length !== plate.bytes || digest !== plate.sha256) {
    throw new Error(`${plate.id}: ${plate.url} is not the file recorded (${bytes.length} bytes, sha256 ${digest}); read its licence again before changing assets/trailer/plates.json`);
  }
  await mkdir(STOCK, { recursive: true });
  await writeFile(`${file}.part`, bytes);
  await rename(`${file}.part`, file);
  return file;
}

/** How many video frames a file holds, counted by decoding it — a plate cut short is a jump in the trailer. */
function countFrames(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', file, '-map', '0:v:0', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', () => {
      const counts = [...err.matchAll(/frame=\s*(\d+)/g)];
      resolve(counts.length > 0 ? Number(counts[counts.length - 1][1]) : 0);
    });
  });
}

// Before any filming: a plate that cannot be had should stop the run now, not two hours from now.
const real = [];
for (const plate of plates) {
  const file = path.join(WORK, `real-${plate.id}.mp4`);
  try {
    await runFfmpeg(['-i', await stock(plate), '-vf', plateFilter(plate), '-an', '-frames:v', String(plate.frames), '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-r', String(FPS), file]);
  } catch (error) {
    console.error(`pack:trailer — the "${plate.id}" plate: ${String(error).split('\n')[0]}`);
    process.exit(1);
  }
  const frames = await countFrames(file);
  if (frames !== plate.frames) {
    console.error(`pack:trailer — the "${plate.id}" plate came out ${frames} frames long, not ${plate.frames}: its source is shorter than startFrame + frames.`);
    process.exit(1);
  }
  real.push({ file, seconds: plate.frames / FPS });
  log(`real footage: "${plate.title}" by ${plate.creator}, ${(plate.frames / FPS).toFixed(2)} s`);
}

const server = await serveDist(DIST, path.join(root, 'node_modules', 'three'));
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

/** Run ffmpeg to completion, keeping its stderr for the error message. */
function runFfmpeg(args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
    if (input) input(child.stdin);
  });
}

async function still(size, draw) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await draw(page);
    return await page.screenshot({ animations: 'disabled', omitBackground: true });
  } finally {
    await context.close();
  }
}

/** A caption laid over the lower left of a shot, on a transparent frame the size of the video. */
function captionFrame(text) {
  return still({ width: WIDTH, height: HEIGHT }, (page) =>
    page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; height: 100%; background: transparent; }
      body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif; }
      .cap { position: absolute; left: 96px; bottom: 104px; max-width: 1100px; }
      .rule { width: 120px; height: 8px; border-radius: 999px; background: #ffd166; margin-bottom: 22px; }
      p { margin: 0; color: #fff; font-weight: 800; font-size: 64px; line-height: 1.08; letter-spacing: .01em;
          text-shadow: 0 3px 18px rgba(0,0,0,.65), 0 1px 3px rgba(0,0,0,.6); }
    </style></head><body><div class="cap"><div class="rule"></div><p>${text}</p></div></body></html>`),
  );
}

/**
 * Film one shot: into a match, hold the clock, roll past the countdown unrecorded, then capture
 * `seconds` of play one stepped frame at a time straight into ffmpeg, caption overlaid.
 */
async function film(shot, index) {
  const file = path.join(WORK, `shot-${index}.mp4`);
  const captionPng = path.join(WORK, `caption-${index}.png`);
  await writeFile(captionPng, await captionFrame(captions[index]));

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await pinStoreQuality(context);
  await context.addInitScript(timeControlSource());
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  let firstFrame = null;
  let lastFrame = null;
  let repeats = 0;
  try {
    await enterMatch(page, server.base, shot.mode, problem, shot.map, { held: true });
    await hideInterface(page);
    const steering = new Steering(page);
    await steering.begin();
    if (!(await rollPastCountdown(page))) problem(`${shot.mode}: the round never left its countdown`);
    // Find somebody to film before filming (`seekPlayers`): run blind, every shot ran into the
    // nearest wall and filmed it, and three of the four filmed never showed another player. All of
    // this runs at 1280x720: none of it is filmed, and every step is a frame drawn in software.
    await steering.calibrate();
    const found = await seekPlayers(page, steering);
    log(`  found somebody ${found === null ? 'never' : `after ${found.toFixed(1)} s`}`);
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    const framed = await frameUp(page, steering);
    log(`  framed somebody near ${framed === null ? 'never' : `after ${framed.toFixed(1)} s more`}`);
    await growTo(page, { width: WIDTH, height: HEIGHT });
    for (let i = 0; i < 3; i++) await page.evaluate(() => window.__kcTime.step(1000 / 30));

    const frames = Math.round(shot.seconds * FPS);
    const fadeIn = (shot.captionAt ?? 0.4).toFixed(2);
    const fadeOut = (shot.seconds - 0.9).toFixed(2);
    let previous = null;
    await runFfmpeg(
      [
        '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
        '-loop', '1', '-framerate', String(FPS), '-i', captionPng,
        '-filter_complex',
        `[1:v]format=rgba,fade=t=in:st=${fadeIn}:d=0.4:alpha=1,fade=t=out:st=${fadeOut}:d=0.4:alpha=1[c];[0:v][c]overlay=0:0:shortest=1,format=yuv420p[v]`,
        '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-r', String(FPS), file,
      ],
      async (stdin) => {
        // W and Shift are down from `frameUp`.
        let running = true;
        let sprinting = true;
        for (let f = 0; f < frames; f++) {
          // A hop every 1.6 s while moving — the signature move.
          if (running && f % 48 === 0) await page.keyboard.down('Space');
          if (f % 48 === 4) await page.keyboard.up('Space');
          // Follow whoever is in sight, turning no faster than a camera operator would (60°/s);
          // with nobody in sight, the slow pan the shot was given.
          const { target } = await steering.steer({ maxTurn: 0.035, drift: shot.turn / frames, anyone: true, focus: true });
          // Close in on them from far and stand and watch from near (`pursuit`): sprinting the
          // whole shot overtook them in a second and filmed what was beyond.
          const want = pursuit(target, running);
          if (want.run !== running) {
            await (want.run ? page.keyboard.down('KeyW') : page.keyboard.up('KeyW'));
            running = want.run;
          }
          if (want.sprint !== sprinting) {
            await (want.sprint ? page.keyboard.down('ShiftLeft') : page.keyboard.up('ShiftLeft'));
            sprinting = want.sprint;
          }
          const dataUrl = await page.evaluate((ms) => window.__kcTime.step(ms, true), 1000 / FPS);
          if (!dataUrl) throw new Error('the game has no canvas to film');
          const jpg = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
          if (f === 0) firstFrame = jpg;
          if (previous && previous.equals(jpg)) repeats++;
          previous = jpg;
          if (!stdin.write(jpg)) await new Promise((r) => stdin.once('drain', r));
          if (f % 30 === 29) log(`  ${shot.mode}: ${f + 1}/${frames} frames`);
        }
        stdin.end();
      },
    );
    // A frozen game films as a still. Identical consecutive frames say the clock did not move.
    if (repeats > frames * 0.1) problem(`${shot.mode}: ${repeats} of ${frames} frames repeat the one before — the game did not advance`);
    // Written last, after ffmpeg has closed the video: the marker is what says the shot is whole.
    await writeFile(path.join(WORK, `shot-${index}.jpg`), firstFrame);
    await writeFile(path.join(WORK, `shot-${index}-last.jpg`), previous);
    lastFrame = previous;
    await writeFile(path.join(WORK, `shot-${index}.json`), JSON.stringify({ ...markerOf(shot), repeats, frames }));
  } finally {
    await releaseKeys(page);
    await page.keyboard.up('ShiftLeft').catch(() => {});
    await page.mouse.up().catch(() => {});
    await context.close();
  }
  return { file, firstFrame, lastFrame, repeats, frames: Math.round(shot.seconds * FPS) };
}

/** What a finished shot's marker records about how it was filmed: a shot is kept only if all of it matches. */
function markerOf(shot) {
  return { mode: shot.mode, map: shot.map, seconds: shot.seconds, captionAt: shot.captionAt ?? null };
}

/** The whole video's sound as a WAV: `plan` is a `SoundtrackPlan` (`lib/trailer-audio.ts`). */
async function soundtrack(plan, total) {
  const { build } = await import('esbuild');
  const bundle = await build({
    entryPoints: [path.join(root, 'scripts', 'lib', 'trailer-audio.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const sampleRate = 48_000;
    const b64 = await page.evaluate(([p, s, r]) => window.__renderSoundtrack(p, s, r), [plan, total + 1, sampleRate]);
    const pcm = Buffer.from(b64, 'base64');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono; ffmpeg makes it stereo
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    const file = path.join(WORK, 'score.wav');
    await writeFile(file, Buffer.concat([header, pcm]));
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    if (peak < 300) problem(`the rendered soundtrack is silent (peak ${peak} of 32767)`);
    // The real footage has no sound of its own: what plays under it is the outdoor bed, and a
    // bed that failed to render would leave nine silent seconds at the top of the trailer.
    const quiet = (from, to) => {
      let most = 0;
      for (let i = Math.floor(from * sampleRate) * 2; i < Math.floor(to * sampleRate) * 2 && i < pcm.length; i += 2) most = Math.max(most, Math.abs(pcm.readInt16LE(i)));
      return most;
    };
    if (plan.outdoors && quiet(1, plan.outdoors.until - 0.5) < 300) problem('the soundtrack is silent under the real footage');
    return file;
  } finally {
    await context.close();
  }
}

// --- shots ----------------------------------------------------------------------------------------

/** A shot an earlier run finished, if `--resume` and it is the same shot. */
async function kept(shot, i) {
  if (!RESUME) return null;
  try {
    const meta = JSON.parse(await readFile(path.join(WORK, `shot-${i}.json`), 'utf8'));
    const want = markerOf(shot);
    if (Object.keys(want).some((key) => meta[key] !== want[key])) return null;
    const firstFrame = await readFile(path.join(WORK, `shot-${i}.jpg`));
    const lastFrame = await readFile(path.join(WORK, `shot-${i}-last.jpg`));
    return { file: path.join(WORK, `shot-${i}.mp4`), firstFrame, lastFrame, repeats: meta.repeats, frames: meta.frames };
  } catch {
    return null;
  }
}

const taken = [];
for (const [i, shot] of SHOTS.entries()) {
  const done = await kept(shot, i);
  if (done) {
    log(`shot ${i + 1}/${SHOTS.length}: ${shot.mode} on ${shot.map} — kept from the last run`);
    taken.push(done);
    continue;
  }
  log(`shot ${i + 1}/${SHOTS.length}: ${shot.mode} on ${shot.map}`);
  try {
    taken.push(await film(shot, i));
  } catch (error) {
    problem(`${shot.mode}: ${String(error).split('\n')[0]}`);
  }
}
if (taken.length !== SHOTS.length) {
  await browser.close();
  await server.close();
  report();
  process.exit(1);
}

// --- cards ----------------------------------------------------------------------------------------

log('title and end cards, soundtrack…');
const roo = imageDataUri(await renderModel(browser, server.base, { clip: 'run', t: 0.7, yaw: 40, pitch: 6, size: 1200 }));
const backdropFor = (jpg) => `data:image/jpeg;base64,${jpg.toString('base64')}`;
const titlePng = path.join(WORK, 'title.png');
const endPng = path.join(WORK, 'end.png');
// The title comes straight after the first game shot, over that shot's last frame: the game
// freezes, softens and darkens, and the name comes up over it.
await writeFile(titlePng, await still({ width: WIDTH, height: HEIGHT }, (page) => renderLogo(page, roo, { backdrop: backdropFor(taken[0].lastFrame), fill: 0.6 })));
// Side by side, as the Steam main capsule is. Stacked, the name and the line under it share 38 % of
// the card's height, and on a 1080p frame the line came out 21 px tall — unreadable on a phone,
// which is where a store page's video is most often watched.
// Behind the end card, the Roo Ball shot's first frame: of every mode it is the one with players
// in shot nearly all the time (96–98 %), so its first frame is sure to have some. Found by mode,
// not by position — it was `taken[2]`, which stopped being Roo Ball when the shots were reordered.
const endBackdrop = taken[SHOTS.findIndex((s) => s.mode === 'Roo Ball')] ?? taken[0];
await writeFile(endPng, await still({ width: WIDTH, height: HEIGHT }, (page) => renderCover(page, roo, { veryWide: true, tagline: captions[SHOTS.length], backdrop: backdropFor(endBackdrop.firstFrame) })));

// The cut: the real footage, the first game shot it turns into, the title, the other four shots,
// the end card.
const loopStill = (file, seconds) => ['-loop', '1', '-framerate', String(FPS), '-t', String(seconds), '-i', file];
const segments = [
  ...real.map((r) => ({ seconds: r.seconds, input: ['-i', r.file] })),
  { seconds: SHOTS[0].seconds, input: ['-i', taken[0].file] },
  { seconds: TITLE_SECONDS, input: loopStill(titlePng, TITLE_SECONDS) },
  ...taken.slice(1).map((t, i) => ({ seconds: SHOTS[i + 1].seconds, input: ['-i', t.file] })),
  { seconds: END_SECONDS, input: loopStill(endPng, END_SECONDS) },
];
const joins = [
  ...real.slice(1).map(() => ({ transition: 'fade', seconds: REAL_DISSOLVE })),
  { transition: 'pixelize', seconds: TRANSFORM_SECONDS },
  ...segments.slice(real.length + 1).map(() => ({ transition: 'fade', seconds: CROSSFADE })),
];
const { offsets, total } = timeline(
  segments.map((s) => s.seconds),
  joins.map((j) => j.seconds),
);
// Where the real footage starts turning into the game, and the middle of that, where it has.
const transformFrom = offsets[real.length - 1];
const transformAt = transformFrom + TRANSFORM_SECONDS / 2;
const score = await soundtrack(
  {
    outdoors: { until: transformAt, fade: 0.6 },
    transform: { start: transformFrom, at: transformAt },
    scoreFrom: transformAt,
    moods: [
      { mood: 'chase', until: total - END_SECONDS },
      { mood: 'victory', until: total + 10 },
    ],
  },
  total,
);

await browser.close();
await server.close();

// --- assembly -------------------------------------------------------------------------------------

log(`assembling ${total.toFixed(2)} s; the real footage turns into the game at ${transformFrom.toFixed(2)}–${(transformFrom + TRANSFORM_SECONDS).toFixed(2)} s…`);
const inputs = [...segments.flatMap((s) => s.input), '-i', score];
const prep = segments.map((_, i) => `[${i}:v]scale=${WIDTH}:${HEIGHT},setsar=1,format=yuv420p,fps=${FPS}[s${i}]`);
const xfades = [];
let prev = 's0';
for (const [i, join] of joins.entries()) {
  const outLabel = i === joins.length - 1 ? 'joined' : `x${i + 1}`;
  xfades.push(`[${prev}][s${i + 1}]xfade=transition=${join.transition}:duration=${join.seconds}:offset=${offsets[i].toFixed(3)}[${outLabel}]`);
  prev = outLabel;
}
const bars = letterbox('joined', 'opened', { bar: LETTERBOX, from: transformFrom + 0.4, to: transformFrom + TRANSFORM_SECONDS, total });
const video = `[opened]fade=t=in:st=0:d=0.6,fade=t=out:st=${(total - 0.8).toFixed(3)}:d=0.8[v]`;
const audio = `[${segments.length}:a]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.4,afade=t=out:st=${(total - 2).toFixed(3)}:d=2,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`;
await mkdir(path.dirname(OUT), { recursive: true });
await runFfmpeg([
  ...inputs,
  '-filter_complex', [...prep, ...xfades, bars, video, audio].join(';'),
  '-map', '[v]', '-map', '[a]', '-t', total.toFixed(3),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2',
  '-movflags', '+faststart', OUT,
]);
await mkdir(path.dirname(EPIC_COPY), { recursive: true });
await copyFile(OUT, EPIC_COPY);

// --- verification ---------------------------------------------------------------------------------

/** Read the finished file back the way an upload form would: container, codecs, size, rate. */
async function verify(file) {
  const info = await new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => resolve(err));
  });
  const expect = (pattern, what) => {
    if (!pattern.test(info)) problem(`${path.relative(root, file)}: expected ${what}`);
  };
  expect(/Video: h264 \(High\)/, 'H.264 High profile video');
  expect(/yuv420p/, 'yuv420p');
  expect(new RegExp(`${WIDTH}x${HEIGHT}`), `${WIDTH}x${HEIGHT}`);
  expect(/\b30 fps\b/, '30 fps');
  expect(/Audio: aac/, 'AAC audio');
  expect(/48000 Hz, stereo/, '48 kHz stereo audio');
  const bytes = (await stat(file)).size;
  if (bytes > MAX_BYTES) problem(`${path.relative(root, file)} is ${(bytes / 1e6).toFixed(1)} MB, over Epic's 300 MB`);
  const duration = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0;

  // The cut, measured on the finished file: cinema bars over the real footage, the picture broken
  // into blocks where it turns into the game, and the full frame of the game after it.
  const frameAt = (t) =>
    new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks = [];
      child.stdout.on('data', (d) => chunks.push(d));
      child.on('error', reject);
      child.on('close', () => resolve(Buffer.concat(chunks)));
    });
  const body = [LETTERBOX, HEIGHT - LETTERBOX];
  const footage = await frameAt(2);
  if (brightest(footage, WIDTH, 0, LETTERBOX) > 30) problem(`at 2 s the top ${LETTERBOX} rows are not a black bar`);
  if (blockiness(footage, WIDTH, ...body) > 0.8) problem('at 2 s the real footage is already broken into blocks');
  const blocks = blockiness(await frameAt(transformAt), WIDTH, ...body);
  if (blocks < 0.85) problem(`at ${transformAt.toFixed(2)} s, the middle of the transform, the picture is not in blocks (${blocks.toFixed(2)})`);
  const game = await frameAt(transformFrom + TRANSFORM_SECONDS + 0.5);
  if (brightest(game, WIDTH, 0, LETTERBOX) <= 30) problem('after the transform the top of the frame is still black: the bars did not open');
  if (blockiness(game, WIDTH, ...body) > 0.8) problem('after the transform the game is still in blocks');
  return { bytes, seconds, blocks };
}

const result = await verify(OUT);
report(result);

function report(result) {
  if (result) {
    console.log(`\nWrote ${path.relative(root, OUT)} — ${result.seconds.toFixed(2)} s, ${(result.bytes / 1e6).toFixed(1)} MB, ${WIDTH}x${HEIGHT} ${FPS} fps H.264 + AAC 48 kHz stereo`);
    console.log(`  the real footage turns into the game at ${transformFrom.toFixed(2)}–${(transformFrom + TRANSFORM_SECONDS).toFixed(2)} s (blocks ${result.blocks.toFixed(2)} at its middle)`);
    console.log(`  and the same file as ${path.relative(root, EPIC_COPY)} for Epic's media carousel.`);
    for (const plate of plates) console.log(`  real: "${plate.title}" by ${plate.creator} (${plate.page}), ${plate.frames} frames`);
    for (const [i, t] of taken.entries()) console.log(`  shot ${i + 1}: ${SHOTS[i].mode} on ${SHOTS[i].map} — ${t.frames} frames, ${t.repeats} repeated`);
  }
  if (problems.length > 0) {
    console.error(`\n\x1b[31m${problems.length} problem(s):\x1b[0m`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  }
}
