# DERİNLİK — desktop build (Steam)

An [Electron](https://www.electronjs.org/) shell around the offline build of the web game in `../DerinlikWeb`. The game
page is built with three.js and the OFL fonts bundled into one HTML file (no CDN, no network). The shell opens it in
one fullscreen window and refuses every request that is not the local page, a `data:` URL or a `blob:`.

| File | What it does |
| --- | --- |
| `main.js` | Window (fullscreen; `--windowed` for a 1600×900 window), F11 / Alt+Enter fullscreen toggle, no menu bar, no navigation or popups, offline request filter, single instance |
| `preload.js` | The only bridge to the page: `window.derinlikDesktop.quit()` and `.toggleFullscreen()` |
| `prepare-game.js` | Runs `python build.py --offline --out app/index.html` in `../DerinlikWeb` |
| `package.json` | Electron 44.5.1 + electron-builder 26.15.3; `build` config for a Windows/Linux folder build |

The game page shows a **Masaüstüne çık** (quit to desktop) button on the title, pause and end screens only when it runs
inside this shell (`window.derinlikDesktop` exists); in a browser tab nothing changes.

## Build on Windows

Needs Node.js 22+ and Python 3 on the PATH.

```bat
cd DerinlikWeb
npm install
cd ..\DerinlikDesktop
npm install
npm start            :: builds app\index.html and opens the game
npm run dist:win     :: release\win-unpacked\Derinlik.exe (the folder to upload to Steam)
```

`npm start -- --windowed` opens it in a window instead of fullscreen.

## Steam upload (later, after the Coming Soon page)

The whole `release/win-unpacked/` folder is the depot content; the launch option is `Derinlik.exe`. Steamworks
integration (achievements, cloud saves, overlay) is not wired yet: it needs a native module such as `steamworks.js`
and a test on a PC with the Steam client running, which this environment does not have.

## What was tested here, and what was not

Tested on Linux (Xvfb, software GPU — SwiftShader):

- `npm start` path: the game page loads in Electron, fonts with Turkish letters load offline, a request to the
  internet is blocked, the game starts and renders chapter 1 (WebGL 2), Esc opens the pause menu, the quit button
  closes the app. No console errors.
- `electron-builder --linux` and `--win` both package; the packaged Linux executable starts the game.

Not tested (needs real hardware):

- Running `Derinlik.exe` on Windows, frame rate on a real GPU, the Steam overlay, controller input.
- The Windows executable has the default Electron icon until `build/icon.png` (512×512) is added — the store art
  step produces it.
