import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// A supervised QA preview serves the production build, including its actual
// client bundles. Regular `npm run dev` keeps Next's development runtime.
const supplied = process.argv.slice(2);
const supervised = supplied.includes('--strictPort');
const args = supplied.flatMap((argument) => {
  if (argument === '--strictPort') return [];
  if (argument === '--host') return ['--hostname'];
  return [argument];
});
let child;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child?.kill(signal));
function next(arguments_) {
  return new Promise((done) => {
    child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), ...arguments_], {
      stdio: 'inherit', env: process.env,
    });
    child.on('error', (error) => { console.error(error.message); done(1); });
    child.on('exit', (code) => done(code ?? 1));
  });
}
if (supervised) {
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  if (!existsSync(resolve('.next/BUILD_ID'))) {
    throw new Error('Run npm run build before starting the supervised production preview.');
  }
  process.exitCode = await next(['start', ...args]);
} else {
  process.exitCode = await next(['dev', ...args]);
}
