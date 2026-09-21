#!/usr/bin/env node
/**
 * Hostile-client check: attack a real server over a real socket and prove the room survives.
 *
 * The project's hardest rule is "never trust the client on critical data". Unit tests cover
 * `sanitizeIntent`, which is the part that was written *to be* trustworthy; what they do not
 * cover is the part nobody designed — what happens when a modified client sends something no
 * real client would ever send. That question cannot be answered by reading the code, because
 * every crash of this kind is somewhere the author was certain a value had a type.
 *
 * The stake is not one cheater's session. The simulation, every room, and the HTTP server share
 * one Node process: an uncaught throw on any socket's message handler ends the match for every
 * player on the box. So the pass condition is not "the attacker is rejected" — it is that a
 * bystander in the same room keeps receiving snapshots throughout, and is still receiving them
 * after the attacker has finished.
 *
 * Structure: a victim joins and starts playing, an attacker joins the same room and sends a
 * battery of malformed frames, and the victim's snapshot counter is read before and after. The
 * victim is the instrument; the attacker is only the stimulus.
 *
 * Usage: npm run build && npm run check:hostile
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

// Imported rather than written down. This was `const PROTOCOL = 2` for exactly as long as the
// protocol was 2: the version bump to 3 left the number here behind, the victim's hello was
// refused with `4001 protocol`, and a check whose whole subject is hostile input reported
// seventeen security failures for one stale literal. It is the same defect this project has
// already had twice — `VR_BINDINGS`' two lists, `Renderer.ts`'s two sun positions — and the same
// fix: one source, every caller reads it. Importing a TS source constant is why this script runs
// under `tsx` rather than plain `node`.
import { PROTOCOL_VERSION } from '@kc/net';

const PORT = 8873;
const base = `http://127.0.0.1:${PORT}`;
const wsBase = `ws://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['dist/server/main.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    KC_DATA_DIR: '/tmp/kc-hostile',
    KC_PUBLIC_DIR: path.resolve('dist/client'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

let serverExited = null;
server.on('exit', (code, signal) => {
  serverExited = `exit code=${code} signal=${signal}`;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(base);
    if (r.ok) break;
  } catch {}
  await sleep(150);
}
if (serverExited) {
  console.log(`server died before the test began: ${serverExited}`);
  console.log(serverLog.join(''));
  process.exit(1);
}

const failures = [];

/** A socket that counts what it receives, so a bystander can be used as a liveness probe. */
function connect(label) {
  const ws = new WebSocket(`${wsBase}/ws`);
  ws.binaryType = 'arraybuffer';
  const state = { label, ws, json: [], snapshots: 0, closed: null, open: false };
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') {
      try {
        state.json.push(JSON.parse(ev.data));
      } catch {
        state.json.push({ t: 'unparseable' });
      }
    } else {
      state.snapshots++;
    }
  });
  ws.addEventListener('close', (ev) => {
    state.open = false;
    state.closed = `${ev.code} ${ev.reason}`;
  });
  ws.addEventListener('error', () => {});
  // Resolve on open, on close, *and* on a timer: connecting to a server that has already died
  // fires neither reliably, and a harness that hangs reports nothing at all — which is the worst
  // possible outcome for a check whose entire job is to notice a dead server.
  state.ready = new Promise((resolve) => {
    const done = () => resolve();
    ws.addEventListener('open', () => {
      state.open = true;
      done();
    });
    ws.addEventListener('close', done);
    ws.addEventListener('error', done);
    setTimeout(done, 3000).unref?.();
  });
  return state;
}

function hello(name, extra = {}) {
  return JSON.stringify({
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    name,
    animalId: 'kangaroo',
    cosmetics: {},
    platform: 'pc',
    crossPlay: true,
    ...extra,
  });
}

/** An intent frame built by hand, so the attacker does not need the client's encoder. */
function intentFrame({ tick = 0, moveX = 0, moveZ = 0, yaw = 0, pitch = 0, buttons = 0, head = 160, voice = 0, mask = 0 } = {}) {
  const b = Buffer.alloc(13);
  b.writeUInt8(1, 0); // MsgType.Intent
  b.writeUInt32LE(tick >>> 0, 1);
  b.writeInt8(moveX, 5);
  b.writeInt8(moveZ, 6);
  b.writeInt16LE(yaw, 7);
  b.writeInt16LE(pitch, 9);
  b.writeUInt16LE(buttons, 11);
  // headHeight, voice and the hand mask follow; truncating here is itself one of the attacks.
  return Buffer.concat([b, Buffer.from([head, voice, mask])]);
}

// ---------------------------------------------------------------------------
// The victim: an ordinary player, in a private room the attacker can be steered into.
// A shared room matters — it is the difference between "the attacker hurt themselves" and
// "the attacker hurt everyone".
// ---------------------------------------------------------------------------
const victim = connect('victim');
await victim.ready;
if (!victim.open) {
  console.log('victim could not connect');
  console.log(serverLog.join(''));
  process.exit(1);
}
victim.ws.send(hello('Victim', { roomCode: 'new-private' }));
await sleep(1200);

const welcome = victim.json.find((m) => m.t === 'welcome');
const roomCode = welcome?.roomCode;
console.log(`victim: open=${victim.open} messages=${victim.json.map((m) => m.t).join(',')} room=${roomCode ?? 'unknown'}`);
// The victim is the instrument, not a subject. Every attack below is scored as "did the victim
// keep receiving snapshots", so a victim that never joined scores all of them as failures — and
// fourteen identical `victim +0 snapshots` lines bury the one fact that matters, which is that
// nothing was measured at all. Stop here and name the cause instead of reporting the wreckage.
//
// `victim.open` above is not this check: the WebSocket handshake succeeds and the server closes
// the socket *afterwards* if it dislikes the hello, so a refused client looks perfectly healthy
// at the point the connection is made. A `welcome` is the first evidence the victim is really
// in a room, which is the only state this check can measure anything from.
if (!roomCode) {
  const refusal = victim.json.find((m) => m.t === 'error');
  console.log('');
  console.log('the victim never joined a room, so no attack below would be measuring anything:');
  console.log(`  victim socket : ${victim.open ? 'open' : `closed(${victim.closed ?? 'never opened'})`}`);
  console.log(`  hello sent    : protocol ${PROTOCOL_VERSION}`);
  if (refusal) console.log(`  server replied: ${refusal.code} — ${refusal.message}`);
  console.log('');
  console.log('check:hostile — 1 failure:');
  console.log('  - the victim could not join, so the room was never put under attack');
  console.log('--- server log ---\n' + serverLog.join(''));
  server.kill();
  await sleep(200);
  process.exit(1);
}
// The victim asked for a private room with the create sentinel — the same thing the client's
// "Create with your own rules" button sends. A public room back means the sentinel was not
// honoured, which is a bug in its own right and would also put the attacker somewhere else.
if (welcome && welcome.isPrivate !== true) {
  failures.push(`the create-private sentinel produced a public room (isPrivate=${welcome.isPrivate})`);
}

// Keep the victim playing for the whole run: a silent client is eventually timed out, and a
// timeout during the attack would read as a crash it did not cause.
const victimPump = setInterval(() => {
  if (victim.open) victim.ws.send(intentFrame({ tick: Date.now() % 1000, moveX: 40 }));
}, 50);

await sleep(800);
const snapshotsBefore = victim.snapshots;

// ---------------------------------------------------------------------------
// The attacks. Each is (name, what the attacker does). A socket is built per attack so one
// attacker being disconnected does not mask the next attack.
// ---------------------------------------------------------------------------
const attacks = [
  [
    'truncated intent frame',
    // The frame claims to be an intent and then simply stops. Every read past the end is a
    // DataView bounds error; the question is whether it is caught or ends the process.
    async (a) => {
      for (let len = 1; len <= 15; len++) a.ws.send(intentFrame().subarray(0, len));
    },
  ],
  [
    'garbage binary',
    async (a) => {
      for (let i = 0; i < 40; i++) {
        const junk = Buffer.alloc(1 + (i % 300));
        for (let j = 0; j < junk.length; j++) junk[j] = (i * 37 + j * 91) & 0xff;
        a.ws.send(junk);
      }
      a.ws.send(Buffer.alloc(0));
    },
  ],
  [
    'hand mask set with no hand data',
    // The mask byte promises 26 more bytes that are not there. This is the read that walks
    // furthest off the end of the buffer.
    async (a) => {
      a.ws.send(intentFrame({ mask: 3 }));
      a.ws.send(intentFrame({ mask: 1 }));
      a.ws.send(intentFrame({ mask: 255 }));
    },
  ],
  [
    'extreme intent values',
    async (a) => {
      a.ws.send(intentFrame({ tick: 0xffffffff, moveX: 127, moveZ: -128, yaw: 32767, pitch: -32768, buttons: 0xffff, head: 255, voice: 255, mask: 0 }));
      a.ws.send(intentFrame({ tick: 0xffffffff, buttons: 0xffff }));
    },
  ],
  [
    'malformed JSON',
    async (a) => {
      a.ws.send('{');
      a.ws.send('not json at all');
      a.ws.send('[]');
      a.ws.send('null');
      a.ws.send('"a string"');
      a.ws.send('123');
      a.ws.send('{"t":}');
    },
  ],
  [
    'JSON with no recognised type',
    async (a) => {
      a.ws.send('{"t":"nonexistent"}');
      a.ws.send('{"t":null}');
      a.ws.send('{"t":{"nested":true}}');
      a.ws.send('{"t":["chat"]}');
      a.ws.send('{"nope":1}');
    },
  ],
  [
    'type-confused fields on every handler',
    // Each of these reaches a handler as a raw value: the gateway coerces `text` and `gadgetId`
    // but passes targetId, action, reason, kind, payload and modeId through untouched.
    async (a) => {
      const hostile = [null, 1e999, -1e999, {}, [], true, 0, { toString: 'not a function' }, ' '.repeat(10)];
      for (const v of hostile) {
        a.ws.send(JSON.stringify({ t: 'chat', text: v, channel: v }));
        a.ws.send(JSON.stringify({ t: 'voice', targetId: v, payload: v, kind: v }));
        a.ws.send(JSON.stringify({ t: 'moderate', action: v, targetId: v }));
        a.ws.send(JSON.stringify({ t: 'report', targetId: v, reason: v }));
        a.ws.send(JSON.stringify({ t: 'vote', modeId: v }));
        a.ws.send(JSON.stringify({ t: 'ready', ready: v }));
        a.ws.send(JSON.stringify({ t: 'shop', gadgetId: v }));
        a.ws.send(JSON.stringify({ t: 'equip', animalId: v, slot: v, cosmeticId: v }));
      }
    },
  ],
  [
    'Infinity and NaN through modeConfig',
    // JSON has no Infinity literal, but `1e999` parses to one — and a round length of Infinity
    // is a round that never ends.
    async (a, code) => {
      a.ws.send(
        hello('Hostile', {
          roomCode: 'new-private',
          modeConfig: {
            roundSeconds: 1e999,
            tagCooldown: -1e999,
            gadgets: { enabled: 'yes' },
            scoreLimit: { valueOf: 1 },
            nested: { deep: { deeper: Array(50).fill('x') } },
          },
        }),
      );
      void code;
    },
  ],
  [
    'unknown gadget id at the shop',
    async (a) => {
      for (const id of ['', 'not-a-gadget', '__proto__', 'constructor', 'toString', '../../etc/passwd', 'a'.repeat(5000)]) {
        a.ws.send(JSON.stringify({ t: 'shop', gadgetId: id }));
      }
    },
  ],
  [
    'prototype pollution through cosmetics',
    // `cosmetics` is spread into player state. A key of `__proto__` is the classic way to turn
    // a cosmetic into a change every object on the server can see.
    async (a) => {
      a.ws.send(
        hello('Polluter', {
          cosmetics: JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"hat":"x"}'),
        }),
      );
    },
  ],
  [
    'oversized chat',
    async (a) => {
      a.ws.send(JSON.stringify({ t: 'chat', text: 'A'.repeat(60_000) }));
      a.ws.send(JSON.stringify({ t: 'chat', text: ' [31m\n\r'.repeat(500) }));
    },
  ],
  [
    'claiming another player id',
    async (a) => {
      a.ws.send(JSON.stringify({ t: 'moderate', action: 'kick', targetId: 'Victim' }));
      a.ws.send(JSON.stringify({ t: 'moderate', action: 'ban', targetId: '*' }));
      a.ws.send(hello('Impostor', { token: 'forged.token.value' }));
      a.ws.send(hello('Impostor', { token: 'a'.repeat(9000) }));
    },
  ],
  [
    'second hello on one socket',
    async (a) => {
      a.ws.send(hello('Twice'));
      a.ws.send(hello('Thrice'));
    },
  ],
  [
    'flood',
    // Faster than the rate limit by two orders of magnitude, for a full second.
    async (a) => {
      for (let i = 0; i < 4000; i++) {
        a.ws.send(intentFrame({ tick: i, buttons: 0xffff }));
        if (i % 10 === 0) a.ws.send(JSON.stringify({ t: 'chat', text: `flood ${i}` }));
      }
    },
  ],
];

for (const [name, run] of attacks) {
  const attacker = connect(name);
  await attacker.ready;
  if (attacker.open) {
    // Join the victim's room where one exists, so the blast radius includes a bystander.
    attacker.ws.send(hello(`Atk-${name.slice(0, 8)}`, roomCode ? { roomCode } : {}));
    await sleep(400);
    try {
      await run(attacker, roomCode);
    } catch (err) {
      failures.push(`${name}: the attack script itself threw: ${err.message}`);
    }
  }
  await sleep(500);

  if (serverExited) {
    console.log(`FAIL ${name.padEnd(38)} SERVER DIED (${serverExited})`);
    failures.push(`${name}: SERVER DIED (${serverExited})`);
    break;
  }
  // A bystander who stopped receiving snapshots is the failure that matters, whether or not the
  // process is still technically alive.
  const before = victim.snapshots;
  await sleep(600);
  const delivered = victim.snapshots - before;
  const alive = victim.open && delivered > 0;
  console.log(`${alive ? 'ok  ' : 'FAIL'} ${name.padEnd(38)} victim +${delivered} snapshots, attacker ${attacker.open ? 'connected' : `closed(${attacker.closed})`}`);
  if (!alive) {
    failures.push(`${name}: victim stopped receiving snapshots (open=${victim.open} closed=${victim.closed})`);
  }
  try {
    attacker.ws.close();
  } catch {}
}

// ---------------------------------------------------------------------------
// After everything: is the server still serving new players, not merely still running?
// ---------------------------------------------------------------------------
clearInterval(victimPump);
await sleep(400);

let httpOk = false;
try {
  const r = await fetch(base);
  httpOk = r.ok;
} catch {}

const late = connect('late-joiner');
await late.ready;
let lateJoined = false;
if (late.open) {
  late.ws.send(hello('LateJoiner'));
  await sleep(1500);
  lateJoined = late.json.some((m) => m.t !== 'error') && late.open;
}
try {
  late.ws.close();
} catch {}
try {
  victim.ws.close();
} catch {}

console.log('');
console.log(`server process: ${serverExited ?? 'alive'}`);
console.log(`http still serving: ${httpOk}`);
console.log(`new player can still join: ${lateJoined}`);
console.log(`victim snapshots: ${snapshotsBefore} before the attacks, ${victim.snapshots} at the end`);

if (!httpOk) failures.push('HTTP server stopped responding');
if (!lateJoined) failures.push('a new player could no longer join after the attacks');
if (victim.snapshots <= snapshotsBefore) failures.push('the victim received no further snapshots after the attacks began');

// Prototype pollution leaves no trace on the wire; it shows up in this process only if the
// server and this script shared one, so ask the server instead — a polluted Object.prototype
// on its side would have shown as bizarre behaviour above. What is checkable here is that the
// attack did not pollute *this* process through the JSON we built, which would mean the payload
// was not hostile enough to be a real test.
if ({}.polluted !== undefined) failures.push('the harness polluted its own prototype; the payload never reached the server as data');

server.kill();
await sleep(200);

console.log('');
if (failures.length === 0) {
  console.log(`check:hostile — ${attacks.length} attacks, the room survived all of them.`);
  process.exit(0);
}
console.log(`check:hostile — ${failures.length} failure(s):`);
for (const f of failures) console.log(`  - ${f}`);
console.log('--- server log ---\n' + serverLog.join(''));
process.exit(1);
