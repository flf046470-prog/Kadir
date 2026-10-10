'use strict';
/**
 * Electron main process for the Steam build.
 *
 * The shape of this file is forced by one constraint: **Electron cannot host a WebXR session.**
 * It disables `checkout_webxr` in its DEPS, so its Chromium is built with `enable_vr=false` and
 * `navigator.xr` never reports an immersive device. No runtime flag changes that.
 *
 * So the app runs the game server locally and presents two ways in:
 *   - Flat play, in this Electron window. Fully functional.
 *   - VR, by handing the same local URL to Chrome or Edge in app mode, where WebXR is driven by
 *     the system OpenXR runtime that SteamVR provides.
 *
 * Online play is not on that local server. It serves the game and runs offline practice; the
 * page it serves is told (`KC_ONLINE_ORIGIN`) to play on the hosted server, where Steam, Epic and
 * browser players meet, and falls back to the local one when that cannot be reached.
 *
 * The decision logic lives in @kc/shell (bundled to dist/shell/index.cjs) so it can be unit
 * tested without Electron; this file is the wiring. `npm run check:shell` runs it under a
 * stand-in for Electron to prove the wiring, since no CI machine can open the real one.
 */

const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

const { planVrLaunch, portCandidates, parseSavedPort, parseSavedSecret, onlineOriginFor } = require('./resources/shell/index.cjs');

const ROOT = path.join(__dirname, 'resources');
const SERVER_ENTRY = path.join(ROOT, 'server', 'main.js');
const CLIENT_DIR = path.join(ROOT, 'client');

let serverProcess = null;
let mainWindow = null;
let vrProcess = null;
let baseUrl = null;

/** Packed in by `pack:steam --online`; the environment can override it (see `onlineOriginFor`). */
const ONLINE_ORIGIN = onlineOriginFor(require('./package.json'), (name) => process.env[name]);

/** Files in the player's own data folder that have to survive from one launch to the next. */
const kept = (name) => path.join(app.getPath('userData'), name);

function readKept(name) {
  try {
    return fs.readFileSync(kept(name), 'utf8');
  } catch {
    return null;
  }
}

function writeKept(name, text, mode = 0o644) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(kept(name), `${text}\n`, { mode });
}

/** `port` if nothing is listening on it (0: whatever the OS picks), else null. */
function tryPort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(null));
    probe.listen(port, '127.0.0.1', () => {
      const bound = probe.address().port;
      probe.close(() => resolve(bound));
    });
  });
}

/**
 * The same port as last launch whenever possible: the page's storage — name, settings, and the
 * token to the player's account — belongs to an origin, and the port is part of it. See
 * `packages/shell/src/launch.ts` for what an OS-chosen port every launch cost.
 */
async function choosePort() {
  for (const candidate of portCandidates(parseSavedPort(readKept('port')))) {
    const port = await tryPort(candidate);
    if (port) return { port, stable: true };
  }
  return { port: await tryPort(0), stable: false };
}

/**
 * One secret for the life of the install. A new one each launch signed the page's token with a key
 * the next launch's server did not have, which logs the player out of their own computer.
 */
function sessionSecret() {
  const saved = parseSavedSecret(readKept('session-secret'));
  if (saved) return saved;
  const fresh = require('node:crypto').randomBytes(32).toString('hex');
  writeKept('session-secret', fresh, 0o600);
  return fresh;
}

function waitForServer(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: '127.0.0.1' }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`server did not start within ${timeoutMs} ms`));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

/**
 * Run the bundled server with Electron's own Node.
 *
 * ELECTRON_RUN_AS_NODE makes `process.execPath` behave as a plain Node binary, which is what
 * lets the Steam depot ship one runtime instead of also bundling Node.
 */
async function startServer() {
  const { port, stable } = await choosePort();
  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      KC_PUBLIC_DIR: CLIENT_DIR,
      // Per-user, not next to the binary: a Steam library directory is often read-only, and on
      // Windows it sits under Program Files where writes are blocked outright.
      KC_DATA_DIR: path.join(app.getPath('userData'), 'data'),
      KC_SESSION_SECRET: process.env.KC_SESSION_SECRET || sessionSecret(),
      KC_ONLINE_ORIGIN: ONLINE_ORIGIN,
    },
    // The IPC channel is how the server knows this process is gone (it exits on `disconnect`), so
    // a crash here cannot leave it holding the port the next launch needs.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  serverProcess.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.on('exit', (code) => {
    serverProcess = null;
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox('Kangaroo Chase', `The game server stopped unexpectedly (exit ${code}).`);
      app.quit();
    }
  });

  await waitForServer(port);
  // Only once the server is really up on it, and never the OS's own pick: saving that would send
  // the next launch to an origin with nothing in it.
  if (stable) writeKept('port', String(port));
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

function launchVr() {
  const probe = {
    platform: process.platform,
    exists: (p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    },
    env: (name) => process.env[name],
  };

  const profileDir = path.join(app.getPath('userData'), 'vr-profile');
  const plan = planVrLaunch(probe, `${baseUrl}/?vr=1`, profileDir);

  if (!plan.available) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'VR unavailable',
      message: 'Kangaroo Chase could not start in VR.',
      detail: plan.reason,
      buttons: ['OK'],
    });
    return;
  }

  if (vrProcess && !vrProcess.killed) {
    dialog.showMessageBox(mainWindow, { type: 'info', message: 'VR is already running.', buttons: ['OK'] });
    return;
  }

  fs.mkdirSync(profileDir, { recursive: true });
  vrProcess = spawn(plan.browser.path, plan.args, { detached: true, stdio: 'ignore' });
  vrProcess.on('exit', () => {
    vrProcess = null;
  });
  vrProcess.unref();
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Game',
        submenu: [
          { label: 'Play in VR', accelerator: 'CmdOrCtrl+Shift+V', click: launchVr },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'reload' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          { label: 'Credits & licences', click: () => mainWindow?.webContents.executeJavaScript('window.dispatchEvent(new Event("kc:credits"))').catch(() => {}) },
          { label: 'Open in browser', click: () => baseUrl && shell.openExternal(baseUrl) },
        ],
      },
    ]),
  );
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0f1a12',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      // The page is our own build served from localhost, but it stays sandboxed with no Node
      // access: it loads remote art packs, and nothing it does should be able to reach the OS.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  // External links open in the real browser, never as a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(baseUrl);
}

// One copy at a time. A second would find the first one's port taken, start on another — a new
// origin with empty storage — and greet the player as a stranger in the second window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
      buildMenu();
      await createWindow();
    } catch (error) {
      dialog.showErrorBox('Kangaroo Chase', `Failed to start.\n\n${error.message}`);
      app.quit();
    }
  });
}

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
});

app.on('window-all-closed', () => app.quit());
