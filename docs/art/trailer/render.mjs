/*
    Renders trailer.html to a WebM by stepping its clock, not by recording playback.

    Chromium is driven over the DevTools Protocol: seek to an exact time, screenshot,
    repeat. That makes the render reproducible and frame-exact — a wall-clock capture
    would drop frames under load and produce a different file every run.

    The ffmpeg that ships with Playwright is a stripped build: VP8 into WebM, fed by
    JPEG frames over a pipe. No H.264 and no GIF muxer are compiled in, so WebM is the
    only video this environment can actually produce.
*/
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const FPS = Number(process.env.FPS || 24);
const QUALITY = Number(process.env.QUALITY || 92);
const OUT = resolve(DIR, process.env.OUT || 'dream-layers-trailer.webm');
const PORT = 9455 + (process.pid % 500);

function findChrome() {
    if (process.env.CHROME) return process.env.CHROME;
    const roots = ['/opt/pw-browsers'];
    for (const root of roots) {
        if (!existsSync(root)) continue;
        for (const d of readdirSync(root)) {
            for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
                const p = `${root}/${d}/${rel}`;
                if (existsSync(p)) return p;
            }
        }
    }
    for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
        if (existsSync(p)) return p;
    }
    throw new Error('no chromium binary found; set CHROME=/path/to/chrome');
}

function findFfmpeg() {
    if (process.env.FFMPEG) return process.env.FFMPEG;
    const root = '/opt/pw-browsers';
    if (existsSync(root)) {
        for (const d of readdirSync(root)) {
            const p = `${root}/${d}/ffmpeg-linux`;
            if (existsSync(p)) return p;
        }
    }
    return 'ffmpeg';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const chrome = findChrome();
    const ffmpeg = findFfmpeg();
    console.log(`chromium: ${chrome}`);
    console.log(`ffmpeg:   ${ffmpeg}`);

    const browser = spawn(chrome, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=1', '--window-size=1920,1080',
        '--disable-dev-shm-usage', '--mute-audio',
        `--remote-debugging-port=${PORT}`,
        `file://${resolve(DIR, 'trailer.html')}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    browser.stderr.on('data', () => {});

    // Wait for the DevTools endpoint to come up.
    let target = null;
    for (let i = 0; i < 120 && !target; i++) {
        await sleep(250);
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        } catch { /* not listening yet */ }
    }
    if (!target) { browser.kill(); throw new Error('chromium did not expose a debugging target'); }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let nextId = 1;
    const pending = new Map();
    ws.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve: ok, reject: no } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? no(new Error(JSON.stringify(msg.error))) : ok(msg.result);
        }
    };
    const send = (method, params = {}) => new Promise((ok, no) => {
        const id = nextId++;
        pending.set(id, { resolve: ok, reject: no });
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
        return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    // Pin the viewport so the output is exactly 1920x1080 regardless of window chrome.
    await send('Emulation.setDeviceMetricsOverride', {
        width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
    });

    for (let i = 0; i < 80; i++) {
        if (await evaluate('typeof window.__seek === "function"')) break;
        await sleep(100);
    }
    const duration = await evaluate('window.__duration');
    if (!duration) throw new Error('trailer.html did not expose __duration');
    const frames = Math.round(duration * FPS);
    console.log(`duration: ${duration.toFixed(2)}s  ->  ${frames} frames @ ${FPS}fps`);

    const enc = spawn(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y',
        // `-vcodec mjpeg` is required: image2pipe cannot probe the codec from a live
        // pipe here, and without it ffmpeg opens the output with no stream at all.
        '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
        // This build compiles VP8 in as `libvpx`; `libvpx-vp8` is not a valid name here.
        '-c:v', 'libvpx', '-b:v', '5M', '-crf', '10',
        '-deadline', 'good', '-cpu-used', '2', '-auto-alt-ref', '0',
        '-pix_fmt', 'yuv420p', '-f', 'webm', OUT,
    ], { stdio: ['pipe', 'ignore', 'inherit'] });

    const write = buf => new Promise((ok, no) => {
        enc.stdin.write(buf, err => (err ? no(err) : ok()));
    });

    for (let f = 0; f < frames; f++) {
        await evaluate(`window.__seek(${(f / FPS).toFixed(6)})`);
        const shot = await send('Page.captureScreenshot', {
            format: 'jpeg', quality: QUALITY, captureBeyondViewport: false,
        });
        await write(Buffer.from(shot.data, 'base64'));
        if (f % 48 === 0 || f === frames - 1) {
            process.stdout.write(`\r  frame ${f + 1}/${frames}`);
        }
    }
    process.stdout.write('\n');

    enc.stdin.end();
    const code = await new Promise(r => enc.on('close', r));
    ws.close();
    browser.kill();
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
    console.log(`wrote ${OUT}`);
}

main().catch(err => { console.error(String(err)); process.exit(1); });
