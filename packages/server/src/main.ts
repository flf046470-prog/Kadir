import { createServer } from 'node:http';
import process from 'node:process';
import { validateCatalog, validateGadgets } from '@kc/core';
import { AccountService } from './accounts.js';
import { loadConfig } from './config.js';
import { attachGateway } from './gateway.js';
import { createHttpHandler } from './http.js';
import { Leaderboard } from './leaderboard.js';
import { createStorage } from './storage.js';
import { DevReceiptVerifier, PurchaseService } from './purchases.js';
import { createReceiptVerifier } from './receipts.js';
import { RoomManager } from './rooms.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // A malformed store catalog must never reach players — fail fast at boot instead.
  const problems = validateCatalog();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[store] ${problem.itemId}: ${problem.problem}`);
    throw new Error(`Store catalog invalid (${problems.length} problems)`);
  }

  // Same for gear. This is the check that keeps "money buys time, not power" true in production
  // rather than only in the test suite: a gadget with no coin price refuses to boot the server.
  const gearProblems = validateGadgets();
  if (gearProblems.length > 0) {
    for (const problem of gearProblems) console.error(`[gadgets] ${problem.gadgetId}: ${problem.problem}`);
    throw new Error(`Gadget catalog invalid (${gearProblems.length} problems)`);
  }

  // File storage is correct for one writer; anything scaled needs the SQL drivers, because a
  // profile save and a leaderboard submit are both read-modify-write over a file and two
  // instances doing that concurrently lose one of the writes.
  const storage = await createStorage({ dataDir: config.dataDir, databaseUrl: config.databaseUrl });
  const accounts = new AccountService(storage.saves, config.sessionSecret);
  const leaderboard = new Leaderboard(storage.leaderboard);

  const rooms = new RoomManager(config, accounts, leaderboard);
  // Store credentials decide which platforms can be verified at all. A store with none
  // configured is absent from the routing table, so its receipts are refused rather than
  // accepted unverified.
  const receiptVerifier = createReceiptVerifier(
    {
      metaAppId: config.stores.metaAppId,
      metaAppSecret: config.stores.metaAppSecret,
      steamAppId: config.stores.steamAppId,
      steamWebApiKey: config.stores.steamWebApiKey,
      playPackageName: config.stores.playPackageName,
    },
    config.allowDevPurchases ? new DevReceiptVerifier(true) : null,
  );
  const purchases = new PurchaseService(receiptVerifier);

  const server = createServer(createHttpHandler({ config, accounts, rooms, leaderboard, purchases }));
  const wss = attachGateway(server, config, accounts, rooms);
  rooms.start();

  const flushTimer = setInterval(() => void leaderboard.flush(), 30_000);
  flushTimer.unref?.();

  server.listen(config.port, config.host, () => {
    console.log(`Kangaroo Chase server listening on http://${config.host}:${config.port}`);
    console.log(`  websocket : ws://${config.host}:${config.port}/ws`);
    console.log(`  tick rate : ${config.tickRate} Hz, snapshots ${config.snapshotRate} Hz`);
    console.log(`  storage   : ${storage.description}`);
    console.log(`  receipts  : ${receiptVerifier.platforms.join(', ') || 'NONE — all purchases will be refused'}`);
    if (config.sessionSecret === 'dev-only-insecure-secret') {
      console.warn('  WARNING: using the development session secret. Set KC_SESSION_SECRET in production.');
    }
  });

  const shutdown = async (): Promise<void> => {
    console.log('shutting down…');
    rooms.stop();
    clearInterval(flushTimer);
    await leaderboard.flush();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref?.();
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
