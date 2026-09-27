import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const builder = join(root, 'scripts', 'build-native-bridge.mjs');
const bundlePath = join(root, 'native-ads.js');
const runBuild = mode => spawnSync(
  process.execPath,
  [builder, `--mode=${mode}`, '--out=native-ads.js'],
  { cwd: root, encoding: 'utf8' },
);

const production = runBuild('production');
if (production.status !== 0) throw new Error(production.stderr || production.stdout);

try {
  const bundle = readFileSync(bundlePath, 'utf8');
  assert.ok(bundle.includes('ca-app-pub-4735235739133080/9050394392'));
  assert.ok(bundle.includes('ca-app-pub-4735235739133080/2189472575'));
  assert.ok(!bundle.includes('ca-app-pub-3940256099942544/5224354917'));
  assert.ok(!bundle.includes('ca-app-pub-3940256099942544/1033173712'));
} finally {
  const test = runBuild('test');
  if (test.status !== 0) throw new Error(`Impossible de restaurer le bundle de test : ${test.stderr || test.stdout}`);
}

const restored = readFileSync(bundlePath, 'utf8');
assert.ok(restored.includes('ca-app-pub-3940256099942544/5224354917'));
assert.ok(restored.includes('ca-app-pub-3940256099942544/1033173712'));
assert.ok(!restored.includes('ca-app-pub-4735235739133080/9050394392'));
assert.ok(!restored.includes('ca-app-pub-4735235739133080/2189472575'));

console.log('LEVELING-APP build modes — production isolée, bundle de travail restauré en test');
