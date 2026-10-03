/**
 * What every store listing script shares: serving the built client, getting a browser into a live
 * round, choosing the frame worth keeping, and drawing key art.
 *
 * It lived inside `pack-meta-listing.mjs` until there were three stores to dress. Copied into a
 * second script it would have been two implementations of "get into a match" drifting apart — the
 * shape of defect this repository keeps finding (two sun positions, two binding lists, two body
 * plans) — so it is one module that each store's script calls.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { decodePng, encodePng, keyOut, trim } from './png.mjs';

/** The game's own ground green. Every drawn asset in every store listing sits on this. */
export const BACKGROUND = '#1d3a24';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

/**
 * A page that draws one of the game's own animal models — the shipped `.glb`, the same file the
 * game loads — posed from one of its own clips, on a transparent background. Key art is drawn
 * from this rather than from the app icon's flat silhouette: the icon is built to survive being
 * cropped to a circle at 48 px, and blown up to fill a capsule it reads as a cut-out shape.
 */
const MODEL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}</style></head><body>
<script type="importmap">{"imports":{"three":"/__three/build/three.module.js","three/addons/":"/__three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const q = new URLSearchParams(location.search);
const size = Number(q.get('size')), yaw = THREE.MathUtils.degToRad(Number(q.get('yaw'))), pitch = THREE.MathUtils.degToRad(Number(q.get('pitch')));
const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
r.setPixelRatio(1); r.setSize(size, size); r.setClearColor(0x000000, 0);
r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdcefff, 0x5a4a30, 1.5));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6); sun.position.set(2.5, 4, 3.5); scene.add(sun);
const rim = new THREE.DirectionalLight(0xbfe3ff, 1.4); rim.position.set(-3, 2.5, -3); scene.add(rim);
new GLTFLoader().load('/models/' + q.get('id') + '.glb', (g) => {
  const model = g.scene;
  scene.add(model);
  const clip = g.animations.find((c) => c.name === q.get('clip'));
  if (clip) {
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
    mixer.setTime(Number(q.get('t')) * clip.duration);
  }
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02;
  cam.position.set(centre.x + Math.sin(yaw) * Math.cos(pitch) * distance, centre.y + Math.sin(pitch) * distance, centre.z + Math.cos(yaw) * Math.cos(pitch) * distance);
  cam.lookAt(centre);
  r.render(scene, cam);
  document.title = 'ready';
}, undefined, (e) => { document.title = 'error: ' + e; });
</script></body></html>`;

/**
 * Serve `dist` on a free port: the built client, with the app shell for every other path. Also
 * serves `three` from `node_modules` under `/__three/` and the model page at `/__model.html`.
 */
export async function serveDist(dist, three) {
  const server = createServer(async (req, res) => {
    let file = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (file === '/__model.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(MODEL_PAGE);
      return;
    }
    if (file === '/') file = '/index.html';
    const disk = file.startsWith('/__three/') && three ? path.join(three, file.slice('/__three/'.length)) : path.join(dist, file);
    try {
      const body = await readFile(disk);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(await readFile(path.join(dist, 'index.html')));
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Photograph one of the game's animals in a pose from its own clips, as a transparent PNG trimmed
 * to the animal. `t` is the share of the clip, `yaw` the camera's bearing round the model in
 * degrees (0 = in front), `pitch` its elevation.
 */
export async function renderModel(browser, base, { id = 'kangaroo', clip = 'run', t = 0.6, yaw = 35, pitch = 8, size = 1400 } = {}) {
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.goto(`${base}/__model.html?id=${id}&clip=${clip}&t=${t}&yaw=${yaw}&pitch=${pitch}&size=${size}`);
    await page.waitForFunction(() => document.title === 'ready' || document.title.startsWith('error'), null, { timeout: 60_000 });
    const title = await page.title();
    if (title !== 'ready') throw new Error(`model page: ${title}`);
    return trim(decodePng(await page.screenshot({ omitBackground: true })));
  } finally {
    await context.close();
  }
}

/** An RGBA image as a data URI — RGBA, so what was keyed out stays transparent in the browser. */
export function imageDataUri(image) {
  return `data:image/png;base64,${Buffer.from(encodePng(image)).toString('base64')}`;
}

/**
 * The icon's kangaroo alone, keyed off its background and trimmed to its own bounds, as a data URI.
 *
 * **Encoded with alpha.** It was written through `encodePngRGB`, which drops the channel `keyOut`
 * had just cleared — and `keyOut` leaves the colour under a cleared pixel alone, so every keyed
 * pixel came back as the icon's background green. Measured on Meta's square cover: the corner of
 * the glyph rendered (29, 58, 36) against (42, 96, 54) just outside it, a dark box round the
 * kangaroo on every piece of key art, under a doc comment on `encodePngRGB` that says not to.
 */
export function glyphDataUri(icon) {
  return imageDataUri(trim(keyOut(icon, BACKGROUND)));
}

/** A PNG frame as a data URI, for drawing a captured gameplay frame behind key art. */
export function pngDataUri(bytes) {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * Settings every store capture runs with: the high tier, fixed.
 *
 * Left on `auto`, the frame-time governor watches swiftshader draw a frame every second or two and
 * does what it is for — drops the tier — so the art would show the low tier while claiming to be
 * the game. A fixed tier is not governed. Call before the first navigation.
 */
export async function pinStoreQuality(context) {
  await context.addInitScript(() => {
    localStorage.setItem(
      'kc.settings.v1',
      JSON.stringify({ graphics: { quality: 'high', shadows: true, postProcessing: true, renderScale: 1, sceneryDetail: 1 } }),
    );
  });
}

/**
 * Boot the game and get into a live round of `mode`, ready to photograph. `problem` records a
 * failure. `map` is a map's display name on the Game modes screen's picker ("Glacier World"); left
 * out, the round plays whatever the picker defaults to.
 */
export async function enterMatch(page, base, mode, problem, map = null) {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.locator('input[type=text]').first().fill('Roo');
  await page.locator('button', { hasText: 'Start' }).first().click();
  await page.waitForTimeout(2500);

  const gotIt = page.locator('button', { hasText: 'Got it' });
  if (await gotIt.count()) {
    await gotIt.first().click();
    await page.waitForTimeout(1200);
  }

  await page.locator('button', { hasText: 'Game modes' }).first().click();
  await page.waitForTimeout(1000);
  if (map) {
    const pick = page.locator('.kc-root button', { hasText: map });
    if (await pick.count()) {
      await pick.first().click();
      await page.waitForTimeout(600);
    } else {
      problem(`no map named "${map}" on the Game modes screen`);
    }
  }
  const cards = page.locator('.kc-root .kc-card');
  let found = false;
  for (let i = 0; i < (await cards.count()); i++) {
    if ((await cards.nth(i).locator('h3').innerText()).trim() !== mode) continue;
    const button = cards.nth(i).locator('button').first();
    // A mode that is not the current one shows "Select" first, then becomes the play button.
    if ((await button.innerText()).trim() === 'Select') {
      await button.click();
      await page.waitForTimeout(600);
    }
    await cards.nth(i).locator('button').first().click();
    found = true;
    break;
  }
  if (!found) problem(`no game mode card named "${mode}"`);
  // Long enough for the world to stream in, the bots to spread out and the round to start.
  await page.waitForTimeout(9000);
}

/** Swing the view. Dragging rather than nudging, so this works whether or not pointer lock took. */
export async function lookAround(page, dx, dy = 0) {
  const size = page.viewportSize();
  const cx = size.width / 2;
  const cy = size.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8);
  await page.mouse.up();
}

/**
 * Walk the map, look around, and keep the busiest frame — the one with the most going on, by
 * compressed size. See `pack-msstore-listing.mjs` for the measurement behind that proxy: an
 * empty-field frame deflates to a fraction of the size a frame with terrain, props and other
 * players does, and the ranking it produces matches picking by eye.
 */
export async function captureBestFrame(page, candidates = 7) {
  let best = null;
  for (let i = 0; i < candidates; i++) {
    await page.keyboard.down('w');
    await page.waitForTimeout(1100);
    await page.keyboard.up('w');
    await lookAround(page, 620, i === 0 ? 90 : 0);
    await page.waitForTimeout(350);

    // Shoot at the top of a hop: the signature move, and the only pose that reads as movement.
    await page.keyboard.down('Space');
    await page.waitForTimeout(300);
    await page.keyboard.up('Space');
    await page.waitForTimeout(210);

    const frame = await page.screenshot({ animations: 'disabled' });
    if (!best || frame.length > best.length) best = frame;
  }
  return best;
}

/**
 * Hide everything the page draws over the 3D view, leaving the frame alone. For art that sits
 * behind a store's own text or logo (Steam's library hero must carry no text at all); the
 * screenshots keep the HUD, because it is what a player sees.
 */
export async function hideInterface(page) {
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  await page.waitForTimeout(100);
}

export async function releaseKeys(page) {
  await page.keyboard.up('w').catch(() => {});
  await page.keyboard.up('Space').catch(() => {});
}

/**
 * Draw one piece of key art: the kangaroo and the name, on the game's own colours or over a real
 * gameplay frame.
 *
 * `.text` and `.roo` are always siblings, never one nested inside the other, and `.text` always
 * gets an *explicit* height rather than one derived from its own content. Both are load-bearing,
 * and both come from a version of this that shipped briefly with an invisible title:
 *
 *   - `container-type: size` — what makes the title's `cqmin` units scale with the text block
 *     instead of the viewport — requires the container to have a definite size, not one that
 *     depends on its own content's layout. `.text` was briefly `width: 100%` with no explicit
 *     height, so it could wrap around the kangaroo it then contained; a container whose size
 *     depends on its content cannot also size that content by container query, so every `cqmin`
 *     value inside it — the title, the rule, the tagline — resolved to zero instead. The rule
 *     line was the only thing still visible, because it has a `min-height` fallback in pixels.
 *   - With the kangaroo *inside* `.text` instead of beside it, the image's box was whatever a
 *     hand-picked padding percentage left over, which is exactly the "guessed per shape" failure
 *     this was already rewritten once to avoid.
 *
 * The two most extreme ratios — wider than 2.5:1 — put a narrow sliver of kangaroo next to a wall
 * of text as a column, so those go side by side instead (`veryWide`).
 *
 * Options:
 *   - `tagline`: a line under the title, or null. **Steam allows the game's name and nothing else on
 *     a capsule** ("No other miscellaneous text"), so its art passes null; Meta's carries one.
 *   - `backdrop`: a data URI of a gameplay frame drawn behind everything, darkened so the name reads.
 */
export async function renderCover(page, glyph, { veryWide, tagline = null, backdrop = null } = {}) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; }
    body {
      height: 100vh; display: flex; flex-direction: ${veryWide ? 'row' : 'column'}; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif;
      background: ${ground(backdrop)};
    }
    .text {
      ${veryWide ? 'height: 100%; width: 62%;' : 'width: 100%; height: 38%;'}
      box-sizing: border-box; padding: ${veryWide ? '0 4%' : '6% 8% 0'};
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      container-type: size;
    }
    h1 {
      margin: 0; color: #fff; font-weight: 800; letter-spacing: .045em; line-height: 1.02;
      text-align: center; font-size: 15cqmin;
      text-shadow: 0 2px 16px rgba(0,0,0,.55);
    }
    .rule { width: 22%; height: 1.4cqmin; min-height: 3px; border-radius: 999px; background: #ffd166; margin: 4% 0 3%; }
    p { margin: 0; color: #ffe9b8; font-weight: 600; text-align: center; font-size: 5.4cqmin; }
    .roo {
      ${veryWide ? 'height: 74%; width: 34%; margin: 0 4% 0 0;' : 'flex: 1; min-height: 0; width: 100%; padding: 0 12% 6%; box-sizing: border-box;'}
      object-fit: contain;
      filter: drop-shadow(0 2.5cqmin 4cqmin rgba(0,0,0,.5));
    }
  </style></head><body>
    <div class="text">
      <h1>KANGAROO CHASE</h1>
      ${tagline ? `<div class="rule"></div><p>${tagline}</p>` : ''}
    </div>
    <img class="roo" src="${glyph}" alt="">
  </body></html>`);
  await page.waitForTimeout(300);
}

/** The ground key art stands on: the game's own greens, or a gameplay frame darkened so a name reads over it. */
function ground(backdrop) {
  return backdrop
    ? `linear-gradient(180deg, rgba(8,18,10,.35) 0%, rgba(8,18,10,.12) 45%, rgba(8,18,10,.72) 100%), url("${backdrop}") center / cover no-repeat`
    : 'radial-gradient(circle at 50% 40%, #3c8a4c 0%, #1d3a24 48%, #0b160e 100%)';
}

/**
 * Draw the logo: the kangaroo beside the name set on two lines, scaled as one block to fill
 * `fill` of the canvas in whichever direction runs out first.
 *
 * Fitted by measuring the laid-out block rather than by a font size guessed per canvas: a logo is
 * asked for at 16:9 (Steam's library logo, Epic's product logo) and at 462x174 (Steam's small
 * capsule, which the logo should "nearly fill"), and the one number that is right for all three is
 * the one the browser measures. `transparent` leaves the canvas empty — both stores lay their logo
 * over their own artwork — and the name then carries a dark outline so it stays legible
 * on whatever it lands on, which is what Epic's guidelines ask of a logo on its dark pages.
 */
export async function renderLogo(page, glyph, { backdrop = null, transparent = false, fill = 0.92 } = {}) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; height: 100%; background: transparent; }
    body {
      height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif;
      background: ${transparent ? 'transparent' : ground(backdrop)};
    }
    .logo { display: inline-flex; align-items: center; gap: 28px; transform-origin: center; }
    .logo img { height: 260px; filter: drop-shadow(0 8px 14px rgba(0,0,0,.45)); }
    h1 {
      margin: 0; color: #fff; font-weight: 800; letter-spacing: .04em; line-height: .98; font-size: 120px;
      text-shadow: 0 4px 18px rgba(0,0,0,.5);
      ${transparent ? '-webkit-text-stroke: 5px #0b160e; paint-order: stroke fill;' : ''}
    }
    h1 span { display: block; }
    h1 span + span { color: #ffd166; }
  </style></head><body>
    <div class="logo"><img src="${glyph}" alt=""><h1><span>KANGAROO</span><span>CHASE</span></h1></div>
  </body></html>`);
  await page.waitForFunction(() => document.querySelector('.logo img')?.complete);
  await page.evaluate((share) => {
    const logo = document.querySelector('.logo');
    const box = logo.getBoundingClientRect();
    const scale = Math.min((innerWidth * share) / box.width, (innerHeight * share) / box.height);
    logo.style.transform = `scale(${scale})`;
  }, fill);
  await page.waitForTimeout(200);
}

/**
 * Re-encode PNG bytes as a JPEG with the browser's own encoder. Two stores ask for JPEG (Steam's app
 * icon, Epic's social preview and its 4 MB carousel images) and this repository has no JPEG encoder
 * of its own — a page that already has one is cheaper than writing a second codec.
 */
export async function toJpeg(page, pngBytes, quality = 0.9) {
  const dataUrl = await page.evaluate(
    async ({ src, q }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', q);
    },
    { src: pngDataUri(pngBytes), q: quality },
  );
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

/** Read a JPEG's pixel size from its start-of-frame marker, so a written file can be checked. */
export function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('not a JPEG marker');
    const marker = bytes[i + 1];
    const length = bytes.readUInt16BE(i + 2);
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error('no frame header in JPEG');
}
