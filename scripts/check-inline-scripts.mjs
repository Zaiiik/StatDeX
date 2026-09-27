import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]))
  .filter(match => !/type\s*=\s*["'](?:application\/json|importmap)["']/i.test(match[1]))
  .map(match => match[2]);

for (const [position, source] of scripts.entries()) {
  const result = spawnSync(process.execPath, ['--check', '-'], {
    cwd: root,
    input: source,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(`Script inline ${position + 1}\n${result.stderr}`);
    process.exit(1);
  }
}

console.log(`LEVELING-APP node --check — ${scripts.length}/${scripts.length} scripts inline valides`);
