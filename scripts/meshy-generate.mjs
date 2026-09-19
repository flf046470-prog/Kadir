#!/usr/bin/env node
/**
 * Generate environment prop geometry with Meshy, and cache it.
 *
 * This script spends real money, so it is written to be careful rather than clever:
 *
 *  - **Never regenerates what is already cached.** Meshy is not deterministic; a second run of
 *    the same prompt returns a different mesh. The .glb files under `assets/meshy/` are therefore
 *    source, not build output, and they are committed. Losing them means paying again for
 *    something different.
 *  - **Respects a budget cap** and refuses to start a task it cannot afford, so an interrupted
 *    run cannot quietly drain an account.
 *  - **Records provenance** for every file — prompt, task id, date, credit cost — because six
 *    months from now "where did this rock come from and may we ship it?" is a question somebody
 *    will have to answer.
 *
 * Preview mode only. It returns geometry with no materials and no textures, which is what is
 * wanted: colour is applied afterwards from the game's palette in `tools/blender/props.py`. Refine
 * would attach a 1-2 MB texture per prop and clash with the flat-shaded art.
 *
 *   MESHY_API_KEY=... npm run assets:meshy [-- --budget 900] [-- --only rock] [-- --dry-run]
 *
 * The key is read from the environment and never written anywhere.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const API = 'https://api.meshy.ai/openapi';
const MANIFEST = 'tools/meshy/props.json';
const CACHE = 'assets/meshy';
const PROVENANCE = path.join(CACHE, 'provenance.json');
/** Observed cost of one preview task. Used to refuse work we cannot pay for. */
const CREDITS_PER_TASK = 20;
/** Meshy queues tasks server-side; a handful in flight keeps it busy without tripping limits. */
const CONCURRENCY = 4;
const POLL_MS = 10_000;
const MAX_POLLS = 90;

const key = process.env.MESHY_API_KEY;
if (!key) {
  console.error('MESHY_API_KEY is not set. Export it for this shell only — do not put it in a file.');
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const budget = Number(flag('budget', '100000'));
const only = flag('only', null);
const dryRun = args.includes('--dry-run');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} → ${res.status} ${text.slice(0, 200)}`);
  return body;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
mkdirSync(CACHE, { recursive: true });
const provenance = existsSync(PROVENANCE) ? JSON.parse(readFileSync(PROVENANCE, 'utf8')) : { files: {} };

/** Every (prop, variant) this manifest asks for, with the file it would land in. */
const wanted = [];
for (const prop of manifest.props) {
  if (only && prop.id !== only) continue;
  for (let v = 1; v <= prop.variants; v++) {
    const name = `${prop.id}-${v}.glb`;
    wanted.push({
      name,
      file: path.join(CACHE, name),
      polycount: prop.polycount,
      prompt: `${prop.prompt}, ${manifest.style}`,
    });
  }
}

const cached = wanted.filter((w) => existsSync(w.file));
const todo = wanted.filter((w) => !existsSync(w.file));

console.log(`manifest: ${wanted.length} props — ${cached.length} cached, ${todo.length} to generate`);

const { balance } = await api('/v1/balance');
const affordable = Math.floor(Math.min(balance, budget) / CREDITS_PER_TASK);
console.log(`balance: ${balance} credits, budget cap ${budget} → ${affordable} task(s) affordable at ${CREDITS_PER_TASK} each`);

const batch = todo.slice(0, affordable);
if (batch.length < todo.length) {
  console.log(`NOTE: ${todo.length - batch.length} prop(s) left for a later run — not enough credits or budget.`);
}
if (dryRun || batch.length === 0) {
  for (const w of batch) console.log(`  would generate ${w.name} @ ${w.polycount} tris`);
  console.log(dryRun ? 'dry run — nothing spent.' : 'nothing to do.');
  process.exit(0);
}

console.log(`\ngenerating ${batch.length} prop(s), about ${batch.length * CREDITS_PER_TASK} credits\n`);

let done = 0;
const failures = [];

async function generate(item) {
  const created = await api('/v2/text-to-3d', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'preview',
      prompt: item.prompt,
      negative_prompt: manifest.negative,
      art_style: 'realistic',
      should_remesh: true,
      target_polycount: item.polycount,
      topology: 'triangle',
    }),
  });
  const id = created.result;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_MS);
    const task = await api(`/v2/text-to-3d/${id}`);
    if (task.status === 'SUCCEEDED') {
      const url = task.model_urls?.glb;
      if (!url) throw new Error('succeeded with no glb url');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download → ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      // A truncated or HTML response would be silently cached and then fail much later, in the
      // browser, as "not valid JSON" — so the magic is checked before anything is written.
      if (bytes.subarray(0, 4).toString() !== 'glTF') throw new Error('downloaded file is not a GLB');
      writeFileSync(item.file, bytes);
      provenance.files[item.name] = {
        taskId: id,
        prompt: item.prompt,
        negativePrompt: manifest.negative,
        targetPolycount: item.polycount,
        credits: CREDITS_PER_TASK,
        generatedAt: new Date().toISOString(),
        source: 'Meshy AI text-to-3d preview',
      };
      writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`);
      console.log(`ok   ${item.name.padEnd(20)} ${(bytes.length / 1024).toFixed(0)} KB   (${++done}/${batch.length})`);
      return;
    }
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`${task.status}: ${JSON.stringify(task.task_error ?? {})}`);
    }
  }
  throw new Error(`gave up after ${(MAX_POLLS * POLL_MS) / 1000}s`);
}

// A small worker pool: enough to keep Meshy busy, few enough not to look like abuse.
const queue = [...batch];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await generate(item);
      } catch (err) {
        failures.push(`${item.name}: ${err.message}`);
        console.log(`FAIL ${item.name.padEnd(20)} ${err.message}`);
      }
    }
  }),
);

const after = await api('/v1/balance');
const files = readdirSync(CACHE).filter((f) => f.endsWith('.glb'));
console.log(`\n${files.length}/${wanted.length} props cached in ${CACHE}`);
console.log(`balance: ${balance} → ${after.balance} (spent ${balance - after.balance})`);
if (failures.length) {
  console.log(`\n${failures.length} failure(s) — re-run to retry only these:`);
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length && files.length === 0 ? 1 : 0);
