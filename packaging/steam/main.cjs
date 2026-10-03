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
 * The decision logic lives in @kc/shell (bundled to dist/shell/index.cjs) so it can be unit
 * tested without Electron; this file is the wiring.
 */

const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

const { planVrLaunch } = require('./resources/shell/index.cjs');

const ROOT = path.join(__dirname, 'resources');
const SERVER_ENTRY = path.join(ROOT, 'server', 'main.js');
const CLIENT_DIR = path.join(ROOT, 'client');

let serverProcess = null;
let mainWindow = null;
let vrProcess = null;
let baseUrl = null;

/** Ask the OS for a free port rather than guessing one that may already be taken. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
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
  const port = await freePort();
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
      KC_SESSION_SECRET: process.env.KC_SESSION_SECRET || require('node:crypto').randomBytes(32).toString('hex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
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

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) serverProcess.kill();
});

app.on('window-all-closed', () => app.quit());
