import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
const mode = modeArg?.split('=')[1] ?? 'test';

if (!['test', 'production'].includes(mode)) {
  throw new Error(`Mode publicitaire invalide: ${mode}`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of [
  'index.html',
  'manifest.webmanifest',
  'service-worker.js',
  'icon-192.png',
  'icon-512.png',
  'notification-badge.png',
]) {
  await cp(resolve(root, file), resolve(dist, file));
}
await cp(resolve(root, 'assets'), resolve(dist, 'assets'), { recursive: true });

const bridge = spawnSync(
  process.execPath,
  [resolve(root, 'scripts/build-native-bridge.mjs'), `--mode=${mode}`, '--out=dist/native-ads.js'],
  { cwd: root, stdio: 'inherit' },
);
if (bridge.status !== 0) process.exit(bridge.status ?? 1);

console.log(`Web Android préparé dans dist/ en mode ${mode}.`);
