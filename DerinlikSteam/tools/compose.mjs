// Composes the Steam store and library art from the key-art plates (capture.mjs) and the game's logotype.
// Usage (repository root): node DerinlikSteam/tools/compose.mjs [--only header,small]
// Writes DerinlikSteam/art/*.png at the exact sizes Steamworks asks for (Store Graphical Assets, Library Assets),
// plus DerinlikDesktop/build/icon.png for the desktop app.
// Logotype: IBM Plex Sans Condensed Light (SIL OFL 1.1, the game's own UI face, from @fontsource in DerinlikWeb);
// the dots of the two Turkish İ letters are the camcorder's red REC light. Capsules carry nothing but the title.
import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const art = path.join(root, 'DerinlikSteam', 'art');
const fonts = path.join(root, 'DerinlikWeb', 'node_modules', '@fontsource', 'ibm-plex-sans-condensed', 'files');
const rest = process.argv.slice(2);
const only = rest.includes('--only') ? new Set(rest[rest.indexOf('--only') + 1].split(',')) : null;
fs.mkdirSync(art, { recursive: true });

const plate = (name) => pathToFileURL(path.join(here, 'plates', `${name}.png`)).href;
const font = (w) => pathToFileURL(path.join(fonts, `ibm-plex-sans-condensed-latin-${w}-normal.woff2`)).href;

const CSS = `
@font-face { font-family: Plex; font-weight: 300; src: url(${font(300)}) format('woff2'); }
@font-face { font-family: Plex; font-weight: 400; src: url(${font(400)}) format('woff2'); }
@font-face { font-family: Plex; font-weight: 500; src: url(${font(500)}) format('woff2'); }
html, body { margin: 0; background: transparent; }
.art { position: relative; overflow: hidden; background: #050506; }
.bg { position: absolute; inset: 0; background-repeat: no-repeat; }
.shade { position: absolute; inset: 0; }
.logo { position: absolute; display: flex; flex-direction: column; align-items: center; color: #e4ded2; font-family: Plex; line-height: 1; white-space: nowrap; }
.word { font-weight: 300; letter-spacing: .14em; margin-right: -.14em; text-shadow: 0 0 .25em rgba(0,0,0,.75), 0 .02em .08em rgba(0,0,0,.9); }
.i { position: relative; }
.i::before { content: ''; position: absolute; left: calc(50% - .07em); top: .105em; width: .12em; height: .12em; transform: translateX(-50%);
  border-radius: 50%; background: #e3312b; box-shadow: 0 0 .12em rgba(227,49,43,.85), 0 0 .4em rgba(227,49,43,.35); }
.sub { font-weight: 400; font-size: .15em; letter-spacing: .36em; margin-right: -.36em; margin-top: .55em; color: #c9c1b2; text-shadow: 0 0 .5em rgba(0,0,0,.9); }
`;
const logo = ({ size, x = 50, y = 50, sub = true }) => `
  <div class="logo" style="font-size:${size}px; left:${x}%; top:${y}%; transform:translate(-50%,-50%)">
    <div class="word">DER<span class="i">I</span>NL<span class="i">I</span>K</div>
    ${sub ? '<div class="sub">THE DEPTHS · ECHOES OF THE FORGOTTEN</div>' : ''}
  </div>`;
// bg: plate, size (CSS background-size), pos; shade: CSS background for the darkening layer; filter for the plate.
const scene = ({ w, h, bg, size = 'cover', pos = '50% 50%', filter = '', shade = '', logo: l }) => `
  <div class="art" style="width:${w}px; height:${h}px">
    <div class="bg" style="background-image:url(${plate(bg)}); background-size:${size}; background-position:${pos}; filter:${filter}"></div>
    ${shade ? `<div class="shade" style="background:${shade}"></div>` : ''}
    ${l ? logo(l) : ''}
  </div>`;

const vignette = (k) => `radial-gradient(ellipse at 50% 50%, rgba(5,5,6,0) 35%, rgba(5,5,6,${k}) 100%)`;
// Plates: k_paris (the ossuary portal; its inscription sits in the top 30% of the plate, so the wide crops start below
// it), k_gate (the lit Sakarya gate). The Kola plates wait for the chapter's realism pass.
const parisLow = (w) => ({ bg: 'k_paris', size: `${w}% auto`, pos: '50% 100%' });   // skull corridor, no inscription
const ASSETS = [
  // store
  { file: 'header_capsule_920x430.png', ...{ w: 920, h: 430, ...parisLow(122), shade: `linear-gradient(rgba(5,5,6,.35), rgba(5,5,6,.55)), ${vignette(.75)}`, logo: { size: 104, y: 50 } } },
  { file: 'small_capsule_462x174.png', ...{ w: 462, h: 174, ...parisLow(134), shade: `linear-gradient(rgba(5,5,6,.4), rgba(5,5,6,.55)), ${vignette(.65)}`, logo: { size: 62, y: 52, sub: false } } },
  // the gate kept whole above the title: the plate is shown at 88% height on the brick-dark ground, edges faded into it
  { file: 'main_capsule_1232x706.png', ...{ w: 1232, h: 706, bg: 'k_gate', size: 'auto 88%', pos: '50% 0%', shade: `linear-gradient(90deg, #050506 2%, rgba(5,5,6,0) 12%, rgba(5,5,6,0) 88%, #050506 98%), linear-gradient(rgba(5,5,6,0) 55%, rgba(5,5,6,.92) 84%), ${vignette(.55)}`, logo: { size: 128, y: 84 } } },
  { file: 'vertical_capsule_748x896.png', ...{ w: 748, h: 896, bg: 'k_paris', pos: '50% 50%', shade: `linear-gradient(rgba(5,5,6,0) 50%, rgba(5,5,6,.9) 88%), ${vignette(.5)}`, logo: { size: 104, y: 85 } } },
  { file: 'page_background_1438x810.png', ...{ w: 1438, h: 810, bg: 'k_gate', pos: '50% 50%', filter: 'saturate(.5) brightness(.45) blur(3px)', shade: vignette(.85) } },
  // library
  { file: 'library_capsule_600x900.png', ...{ w: 600, h: 900, bg: 'k_paris', pos: '50% 50%', shade: `linear-gradient(rgba(5,5,6,0) 50%, rgba(5,5,6,.9) 88%), ${vignette(.5)}`, logo: { size: 84, y: 86 } } },
  { file: 'library_header_920x430.png', ...{ w: 920, h: 430, ...parisLow(122), shade: `linear-gradient(rgba(5,5,6,.35), rgba(5,5,6,.55)), ${vignette(.75)}`, logo: { size: 104, y: 50 } } },
  { file: 'library_hero_3840x1240.png', ...{ w: 3840, h: 1240, bg: 'k_paris', pos: '50% 72%', shade: vignette(.45) } },
];

const browser = await chromium.launch();
const tmp = path.join(here, '.compose.html');
async function render(body, size, file, opts = {}) {
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${body}</body>`);
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(tmp).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  const el = await page.$(opts.selector || '.art');
  await el.screenshot({ path: file, omitBackground: !!opts.transparent });
  await page.close();
  console.log('wrote', path.relative(root, file));
}
for (const a of ASSETS) if (!only || only.has(a.file.split('_')[0]) || only.has(a.file)) await render(scene(a), { width: a.w, height: a.h }, path.join(art, a.file));

// library logo: transparent PNG, 1280 px wide (Steamworks: "1280px wide and/or 720px tall")
if (!only || only.has('logo')) {
  const body = `<div class="art" style="width:1280px; height:520px; background:transparent">${logo({ size: 236, y: 50 })}</div>`;
  await render(body, { width: 1280, height: 520 }, path.join(art, 'library_logo_1280.png'), { transparent: true });
}
// app icon (desktop shell) and the Steam community icon: the camcorder viewfinder (corner brackets, REC light) around a D
if (!only || only.has('icon')) {
  const icon = (n) => {
    const c = (pos) => `<div style="position:absolute; width:${n * .2}px; height:${n * .2}px; border:0 solid #e4ded2; ${pos}"></div>`;
    const b = n * .035, m = n * .1;
    return `<div class="art" style="width:${n}px; height:${n}px; background: radial-gradient(circle at 50% 45%, #1d1915, #050506 72%)">
      ${c(`left:${m}px; top:${m}px; border-left-width:${b}px; border-top-width:${b}px`)}${c(`right:${m}px; top:${m}px; border-right-width:${b}px; border-top-width:${b}px`)}
      ${c(`left:${m}px; bottom:${m}px; border-left-width:${b}px; border-bottom-width:${b}px`)}${c(`right:${m}px; bottom:${m}px; border-right-width:${b}px; border-bottom-width:${b}px`)}
      <div style="position:absolute; left:${n * .2}px; top:${n * .2}px; width:${n * .1}px; height:${n * .1}px; border-radius:50%; background:#e3312b; box-shadow:0 0 ${n * .04}px rgba(227,49,43,.9)"></div>
      <div class="logo" style="font-size:${n * .56}px; left:50%; top:53%; transform:translate(-50%,-50%)"><div class="word" style="letter-spacing:0; margin:0; font-weight:400">D</div></div></div>`;
  };
  fs.mkdirSync(path.join(root, 'DerinlikDesktop', 'build'), { recursive: true });
  await render(icon(512), { width: 512, height: 512 }, path.join(root, 'DerinlikDesktop', 'build', 'icon.png'));
  await render(icon(184), { width: 184, height: 184 }, path.join(art, 'community_icon_184x184.png'));
}
// Meta Horizon Store (Quest) art and the installable web app's icons: --only meta. Sizes and rules from Meta's asset
// design guidelines (developers.meta.com/vr/resources/asset-guidelines): branded assets carry the exact app title
// ("DERİNLİK") and nothing else (no tagline), title inside the safe area and never in a corner, all of one design.
// Store icon 512 (square, opaque), spatialized icon 180 as background + transparent foreground. Web app: 192/512 icons
// and a 512 maskable one, full-bleed and opaque, its mark inside the 80% safe circle.
if (!only || only.has('meta')) {
  const quest = path.join(root, 'DerinlikQuest');
  const icons = path.join(quest, 'public', 'icons'), out = path.join(quest, 'art');
  fs.mkdirSync(icons, { recursive: true }); fs.mkdirSync(out, { recursive: true });
  for (const f of ['app_icon_1024x1024.png', 'hero_2560x1440.png', 'small_landscape_1280x720.png']) fs.rmSync(path.join(out, f), { force: true });
  const metaIcon = (n, safe = 1, { bg = true, mark = true } = {}) => {
    const c = (pos) => `<div style="position:absolute; width:${n * .2 * safe}px; height:${n * .2 * safe}px; border:0 solid #e4ded2; ${pos}"></div>`;
    const b = n * .035 * safe, m = n * (safe < 1 ? .25 : .1);   // maskable: bracket corners at r = .25·√2 < .4
    return `<div class="art" style="width:${n}px; height:${n}px; background:${bg ? 'radial-gradient(circle at 50% 45%, #1d1915, #050506 72%)' : 'transparent'}">
      ${mark ? `${c(`left:${m}px; top:${m}px; border-left-width:${b}px; border-top-width:${b}px`)}${c(`right:${m}px; top:${m}px; border-right-width:${b}px; border-top-width:${b}px`)}
      ${c(`left:${m}px; bottom:${m}px; border-left-width:${b}px; border-bottom-width:${b}px`)}${c(`right:${m}px; bottom:${m}px; border-right-width:${b}px; border-bottom-width:${b}px`)}
      <div style="position:absolute; left:${m + n * .1 * safe}px; top:${m + n * .1 * safe}px; width:${n * .1 * safe}px; height:${n * .1 * safe}px; border-radius:50%; background:#e3312b; box-shadow:0 0 ${n * .04 * safe}px rgba(227,49,43,.9)"></div>
      <div class="logo" style="font-size:${n * .56 * safe}px; left:50%; top:53%; transform:translate(-50%,-50%)"><div class="word" style="letter-spacing:0; margin:0; font-weight:400">D</div></div>` : ''}</div>`;
  };
  for (const n of [192, 512]) await render(metaIcon(n), { width: n, height: n }, path.join(icons, `icon-${n}.png`));
  await render(metaIcon(512, .62), { width: 512, height: 512 }, path.join(icons, 'icon-512-maskable.png'));
  await render(metaIcon(512), { width: 512, height: 512 }, path.join(out, 'icon_512x512.png'));
  // spatialized library tile: the dark ground, and the viewfinder mark alone on transparency (18 px padding inside 180)
  await render(metaIcon(180, 1, { mark: false }), { width: 180, height: 180 }, path.join(out, 'spatial_icon_background_180x180.png'));
  await render(metaIcon(180, .8, { bg: false }), { width: 180, height: 180 }, path.join(out, 'spatial_icon_foreground_180x180.png'), { transparent: true });
  // covers: the lit Sakarya gate, the title low and centred, inside the middle 80%
  const cover = (w, h, size, { pos = '50% 40%', y = 74 } = {}) => scene({ w, h, bg: 'k_gate', size: 'cover', pos,
    shade: `linear-gradient(rgba(5,5,6,0) 45%, rgba(5,5,6,.88) 86%), ${vignette(.55)}`, logo: { size, y, sub: false } });
  const COVERS = [
    ['hero_cover_3000x900.png', 3000, 900, 250, { pos: '50% 42%', y: 72 }],
    ['cover_landscape_2560x1440.png', 2560, 1440, 280],
    ['cover_square_1440x1440.png', 1440, 1440, 210],
    ['cover_portrait_1008x1440.png', 1008, 1440, 150, { y: 76 }],
    ['mini_landscape_1080x360.png', 1080, 360, 96, { pos: '50% 42%', y: 70 }],
    ['trailer_cover_2560x1440.png', 2560, 1440, 280],
  ];
  for (const [file, w, h, size, o] of COVERS) await render(cover(w, h, size, o), { width: w, height: h }, path.join(out, file));
  const body = `<div class="art" style="width:2400px; height:640px; background:transparent">${logo({ size: 360, y: 50, sub: false })}</div>`;
  await render(body, { width: 2400, height: 640 }, path.join(out, 'logo_transparent_2400x640.png'), { transparent: true });
}
fs.rmSync(tmp, { force: true });
await browser.close();
