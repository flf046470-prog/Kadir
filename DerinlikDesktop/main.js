// DERİNLİK desktop shell: runs the offline build of the web game (app/index.html, made by prepare-game.js)
// in one fullscreen window. No network: every request that is not the local page, a data: URL or a blob: is refused.
const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const path = require('path');

// the game starts its audio on the first click, but a desktop game should never be muted by a browser policy
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
const windowed = process.argv.includes('--windowed');

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    fullscreen: !windowed, backgroundColor: '#000000', show: false, title: 'DERİNLİK',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());

  // stay on the game page: no navigation, no popups
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // F11 and Alt+Enter toggle fullscreen (Esc stays with the game: it pauses)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });

  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: !/^(file|data|blob|devtools):/.test(details.url) });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'pointerLock' || permission === 'fullscreen'));
  createWindow();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
ipcMain.on('derinlik:quit', () => app.quit());
ipcMain.on('derinlik:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
