#!/usr/bin/env node
/**
 * Prove voice chat carries audio between two real players.
 *
 * Everything about voice was easy to believe and impossible to see: `VoiceChat` builds an
 * `RTCPeerConnection` per peer, the server relays offer/answer/ICE, and none of that appears in a
 * screenshot, a unit test or the existing smoke run. A mesh that negotiates and then carries
 * nothing looks exactly like one that works — the menu toggle is on, the mic indicator lights,
 * and the other player simply never hears anything.
 *
 * So this runs two browser pages against one server, puts them in the same private room, and
 * asserts bytes actually arrived on an inbound audio track. Chromium's fake media device supplies
 * a real, deterministic tone, so "bytesReceived > 0" means encoded audio crossed the connection
 * rather than a track being attached to silence.
 *
 * `RTCPeerConnection` is wrapped before any application code runs — the same trick the renderer
 * measurement uses on WebGL — because the game never exposes its peers and a check that reached
 * into internals would stop testing the thing players use.
 *
 * ICE needs no STUN here: both pages are in one browser talking to a server on loopback, so host
 * candidates alone complete the connection. That is also why this is worth having in CI while a
 * test against a real network would not be.
 *
 * Usage: npm run build && npm run check:voice
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('check:voice — playwright is not installed; skipping.');
  process.exit(0);
}

const PORT = 8894;
const server = spawn(process.execPath, ['dist/server/main.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    KC_DATA_DIR: '/tmp/kc-voice',
    KC_PUBLIC_DIR: path.resolve('dist/client'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  await sleep(150);
}

const errors = [];
const launch = {
  args: [
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    // A real encodable signal from a device that needs no hardware and no permission prompt.
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
};
if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(launch);

/** Collect every peer connection the page creates, before the page creates any. */
const WRAP = `
  window.__kcPeers = [];
  const Native = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...args) {
    const pc = new Native(...args);
    window.__kcPeers.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = Native.prototype;
`;

async function player(name) {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 640 },
    permissions: ['microphone'],
  });
  await context.addInitScript(WRAP);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(base, { waitUntil: 'load' });
  await sleep(1400);
  await page.locator('input[type=text]').first().fill(name);
  await page.locator('button', { hasText: 'Start' }).first().click();
  await sleep(2400);
  if (await page.locator('button', { hasText: 'Got it' }).count()) {
    await page.locator('button', { hasText: 'Got it' }).first().click();
    await sleep(1000);
  }
  return page;
}

const host = await player('VoiceHost');
const guest = await player('VoiceGuest');

// One private room, both players in it. Quick play would put them in separate rooms as often as not.
await host.locator('button', { hasText: 'Private room' }).first().click();
await sleep(500);
await host.locator('button', { hasText: 'Create a private room' }).first().click();
await sleep(4500);

const hudText = await host.evaluate(() => document.body.innerText);
const code = (hudText.match(/KANG-[A-Z0-9]{4}/) ?? [])[0] ?? null;
if (!code) {
  errors.push(`host never got a room code (hud=${JSON.stringify(hudText.slice(0, 200))})`);
} else {
  await guest.locator('button', { hasText: 'Private room' }).first().click();
  await sleep(500);
  await guest.locator('input[type=text]').first().fill(code);
  await guest.locator('button', { hasText: 'Join room' }).first().click();
  await sleep(6000);
}

/**
 * What the connection actually did.
 *
 * `bytesReceived` on an inbound audio track is the only claim worth making: a peer can reach
 * "connected" with no media attached at all, and an outbound-only reading proves the sender tried
 * rather than that the receiver got anything.
 */
async function voiceStats(page) {
  return page.evaluate(async () => {
    const peers = window.__kcPeers ?? [];
    let inboundBytes = 0;
    let inboundPackets = 0;
    let outboundBytes = 0;
    const states = [];
    for (const pc of peers) {
      states.push(pc.connectionState + '/' + pc.iceConnectionState + '/' + pc.signalingState);
      let report;
      try {
        report = await pc.getStats();
      } catch {
        continue;
      }
      report.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'audio') {
          inboundBytes += s.bytesReceived ?? 0;
          inboundPackets += s.packetsReceived ?? 0;
        }
        if (s.type === 'outbound-rtp' && s.kind === 'audio') outboundBytes += s.bytesSent ?? 0;
      });
    }
    return { peers: peers.length, states, inboundBytes, inboundPackets, outboundBytes };
  });
}

/**
 * Polled to a deadline rather than read once after a fixed sleep.
 *
 * ICE is a handshake with no promised duration, and the first version of this check slept ten
 * seconds and read the counters exactly once. That reported a peer stuck in "new" on runs where
 * negotiation simply had not finished yet — a real failure and a slow success are
 * indistinguishable from a single sample, and the first thing that teaches you is to distrust the
 * check rather than the code. Sampling until the condition holds reports the true state on a slow
 * run and still fails, at the deadline, on a broken one.
 */
const DEADLINE_MS = 30_000;
const started = Date.now();
let a;
let b;
for (;;) {
  a = await voiceStats(host);
  b = await voiceStats(guest);
  const done = [a, b].every((s) => s.peers > 0 && s.states.some((x) => x.startsWith('connected')) && s.inboundBytes > 0);
  if (done || Date.now() - started > DEADLINE_MS) break;
  await sleep(1000);
}

for (const [label, s] of [['host', a], ['guest', b]]) {
  console.log(
    `${label.padEnd(6)} peers=${s.peers} states=${JSON.stringify(s.states)} ` +
      `out=${s.outboundBytes}B in=${s.inboundBytes}B (${s.inboundPackets} packets)`,
  );
  if (s.peers === 0) errors.push(`[${label}] never created a peer connection — voice never started`);
  else if (!s.states.some((x) => x.startsWith('connected')))
    errors.push(`[${label}] no peer reached "connected" within ${DEADLINE_MS / 1000}s: ${JSON.stringify(s.states)}`);
  // The claim worth making: encoded audio crossed the wire and arrived. A connected peer with no
  // inbound bytes is exactly the silent-but-green failure this whole check exists to catch.
  else if (s.inboundBytes === 0) errors.push(`[${label}] peer connected but no audio arrived (0 bytes inbound)`);
}

await browser.close();
server.kill();

console.log(`console errors: ${errors.length}${errors.length ? `\n  - ${errors.join('\n  - ')}` : ''}`);
if (errors.length) console.log('--- server log ---\n' + serverLog.join(''));
process.exit(errors.length === 0 ? 0 : 1);
