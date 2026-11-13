/* ANTARKTIKA: WHITEOUT — desktop shell for Steam (Windows / Linux / Steam Deck) and SteamVR.
 *
 * The game is the same WebGL/WebXR build that ships on iOS and Meta Quest. This shell serves the
 * Game folder from a loopback HTTP server (the engine refuses file:// and WebXR needs a secure
 * context; 127.0.0.1 counts as one), opens it full screen and keeps saves in Electron's userData
 * (localStorage of the app's own profile — Steam Cloud can sync that folder via Auto-Cloud).
 *
 *   electron .            desktop (mouse + keyboard, gamepad through the Gamepad API)
 *   electron . --vr       enters the immersive WebXR session as soon as the world is loaded
 *                         (Chromium's OpenXR backend → SteamVR must be the active OpenXR runtime)
 *   electron . --windowed 1600x900 window instead of full screen
 *   electron . --smoke    loads the world, prints its status and exits (0 = ready); used by `npm run smoke`
 */
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const VR = process.argv.includes('--vr');
const WINDOWED = process.argv.includes('--windowed');
const GAME = app.isPackaged ? path.join(process.resourcesPath, 'Game') : path.resolve(__dirname, '..', 'ios', 'Antarktika', 'Game');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };

// WebXR through OpenXR (SteamVR / Windows). Has to be set before the app is ready.
app.commandLine.appendSwitch('enable-features', 'OpenXR,WebXR');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function serve() {
  const srv = http.createServer((req, res) => {
    const rel = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[/\\]+/, '') || 'index.html';
    const file = path.join(GAME, rel);
    if (!file.startsWith(GAME) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

app.whenReady().then(async () => {
  const port = await serve();
  Menu.setApplicationMenu(null);
  // the game is fully offline: block every request that is not the loopback server
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(http:\/\/127\.0\.0\.1:|devtools:|data:|blob:)/.test(d.url) }));
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['pointerLock', 'fullscreen', 'xr', 'openExternal'].includes(perm)));
  const win = new BrowserWindow({
    width: 1600, height: 900, fullscreen: !WINDOWED, backgroundColor: '#030a10', show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  await win.loadURL('http://127.0.0.1:' + port + '/index.html' + (VR ? '?autovr=1' : ''));
  if (process.argv.includes('--smoke')) {
    const t0 = Date.now();
    const poll = setInterval(async () => {
      const st = await win.webContents.executeJavaScript('window.ANTARKTIKA3D ? [ANTARKTIKA3D.status, !!navigator.xr, document.title] : null').catch(() => null);
      if (st && st[0] === 'ready') { console.log('SMOKE ready', JSON.stringify(st), (Date.now() - t0) + ' ms'); clearInterval(poll); app.exit(0); }
      else if (Date.now() - t0 > 240000) { console.log('SMOKE timeout', JSON.stringify(st)); clearInterval(poll); app.exit(1); }
    }, 1000);
  }
});
app.on('window-all-closed', () => app.quit());
