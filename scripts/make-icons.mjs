#!/usr/bin/env node
/**
 * The app icon, drawn from the game's own kangaroo.
 *
 *   npm run build:client && npm run icons
 *
 * Writes `assets/brand/kangaroo.png` — the shipped `kangaroo.glb`, posed from its own run clip, on
 * a transparent background and trimmed to the animal — and composes the four icons the web
 * manifest and every store package start from (`packages/client/public/icons/`).
 *
 * The icon this replaces was a flat orange shape off to one side of its square. At the 184 px
 * Steam asks for, and on a phone's home screen, it read as a blot, not a kangaroo.
 *
 * The cut-out is a file of its own because the store scripts used to recover it by keying the
 * icon's green out (`keyOut`). That worked on a flat shape. On a lit model it does not: measured,
 * 12.5 % of the kangaroo's opaque pixels — its shaded fur and its eyes — fall within keyOut's
 * reach of the background green, and would have come out partly see-through.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKGROUND, BRAND_GLYPH, imageDataUri, renderModel, serveDist } from './lib/listing.mjs';
import { decodePng, encodePng, encodePngRGB } from './lib/png.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(root, 'dist', 'client');
const THREE = path.join(root, 'node_modules', 'three');
const ICONS = path.join(root, 'packages', 'client', 'public', 'icons');

/** Three-quarter view in mid-bound: the tail out behind and both feet clear of the ground read at any size. */
const POSE = { id: 'kangaroo', clip: 'run', t: 0.7, yaw: 65, pitch: 6, size: 1400 };

/**
 * `fill` is the share of the canvas the kangaroo's longer side takes. `rounded` icons are the
 * 'any'-purpose ones: a rounded square with transparent corners, as before. The maskable one is
 * full bleed, and its kangaroo stays inside the central 80 % circle every platform keeps.
 */
const ICON_SPECS = [
  { file: 'icon-1024.png', size: 1024, rounded: true, fill: 0.74 },
  { file: 'icon-512.png', size: 512, rounded: true, fill: 0.74 },
  { file: 'icon-192.png', size: 192, rounded: true, fill: 0.76 },
  { file: 'icon-maskable-512.png', size: 512, rounded: false, fill: 0.56 },
];

/** Corner radius as a share of the side, measured off the icon this replaces (220 px at 1024). */
const CORNER = 0.215;

try {
  await readFile(path.join(DIST, 'models', 'kangaroo.glb'));
} catch {
  console.error('icons — dist/client/models/kangaroo.glb is missing. Run `npm run build:client` first.');
  process.exit(1);
}

const server = await serveDist(DIST, THREE);
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  const glyph = await renderModel(browser, server.base, POSE);
  await mkdir(path.dirname(BRAND_GLYPH), { recursive: true });
  await writeFile(BRAND_GLYPH, encodePng(glyph));
  console.log(`icons — ${path.relative(root, BRAND_GLYPH)} ${glyph.width}x${glyph.height}`);

  const src = imageDataUri(glyph);
  for (const spec of ICON_SPECS) {
    const context = await browser.newContext({ viewport: { width: spec.size, height: spec.size }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // The browser scales the cut-out down with proper filtering; a 1400 px render taken to 192 px
    // by nearest-neighbour sampling would shimmer along every edge.
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
      .tile {
        position: absolute; inset: 0; background: ${BACKGROUND};
        border-radius: ${spec.rounded ? `${CORNER * 100}%` : '0'};
        display: flex; align-items: center; justify-content: center;
      }
      img { max-width: ${spec.fill * 100}%; max-height: ${spec.fill * 100}%; filter: drop-shadow(0 ${spec.size * 0.012}px ${spec.size * 0.02}px rgba(0,0,0,.35)); }
    </style></head><body><div class="tile"><img src="${src}" alt=""></div></body></html>`);
    await page.waitForFunction(() => document.querySelector('img')?.complete);
    const shot = decodePng(await page.screenshot({ omitBackground: spec.rounded }));
    await context.close();
    // The maskable icon has no transparent corners to keep, so it is written without an alpha channel.
    await writeFile(path.join(ICONS, spec.file), spec.rounded ? encodePng(shot) : encodePngRGB(shot));
    console.log(`icons — ${spec.file} ${shot.width}x${shot.height}`);
  }
} finally {
  await browser.close();
  await server.close();
}
