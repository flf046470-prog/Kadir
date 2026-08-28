import { createServer } from 'node:http';
import process from 'node:process';
import { validateCatalog } from '@kc/core';
import { AccountService } from './accounts.js';
import { loadConfig } from './config.js';
import { attachGateway } from './gateway.js';
import { createHttpHandler } from './http.js';
import { Leaderboard } from './leaderboard.js';
import { FileSaveStore } from './persistence.js';
import { DevReceiptVerifier, PurchaseService } from './purchases.js';
import { RoomManager } from './rooms.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // A malformed store catalog must never reach players — fail fast at boot instead.
  const problems = validateCatalog();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`[store] ${problem.itemId}: ${problem.problem}`);
    throw new Error(`Store catalog invalid (${problems.length} problems)`);
  }

  const saveStore = new FileSaveStore(config.dataDir);
  const accounts = new AccountService(saveStore, config.sessionSecret);
  const leaderboard = new Leaderboard(config.dataDir);
  await leaderboard.load();

  const rooms = new RoomManager(config, accounts, leaderboard);
  const purchases = new PurchaseService(new DevReceiptVerifier(process.env.NODE_ENV !== 'production'));

  const server = createServer(createHttpHandler({ config, accounts, rooms, leaderboard, purchases }));
  const wss = attachGateway(server, config, accounts, rooms);
  rooms.start();

  const flushTimer = setInterval(() => void leaderboard.flush(), 30_000);
  flushTimer.unref?.();

  server.listen(config.port, config.host, () => {
    console.log(`Kangaroo Chase server listening on http://${config.host}:${config.port}`);
    console.log(`  websocket : ws://${config.host}:${config.port}/ws`);
    console.log(`  tick rate : ${config.tickRate} Hz, snapshots ${config.snapshotRate} Hz`);
    console.log(`  data dir  : ${config.dataDir}`);
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
