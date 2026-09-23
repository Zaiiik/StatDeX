import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = path => readFileSync(join(root, path), 'utf8');
const errors = [];
const warnings = [];

const requiredFiles = [
  'index.html',
  'service-worker.js',
  'manifest.webmanifest',
  'notification-badge.png',
  'icon-192.png',
  'icon-512.png',
  'admin/index.html',
  'admin/service-worker.js',
  'admin/manifest.webmanifest',
  'assets/subscription-4w.webp',
  'assets/subscription-1y.webp',
  'assets/subscription-lifetime.webp',
  ...['recrue', 'apprenti', 'confirme', 'competiteur', 'elite', 'legende', 'monarque']
    .map(name => `assets/power-rank-${name}.webp`),
  ...['eveille', 'chasseur', 'spartan', 'shadow', 'sentinelle', 'eclipse', 'empereur']
    .map(name => `assets/xp-rank-${name}.png`)
];

for (const path of requiredFiles) {
  if (!existsSync(join(root, path))) errors.push(`Fichier requis absent : ${path}`);
}

const index = read('index.html');
const serviceWorker = read('service-worker.js');
const adminIndex = read('admin/index.html');
const adminServiceWorker = read('admin/service-worker.js');

for (const path of ['manifest.webmanifest', 'admin/manifest.webmanifest']) {
  try {
    JSON.parse(read(path));
  } catch (error) {
    errors.push(`${path} invalide : ${error.message}`);
  }
}

function compileJavaScript(source, label) {
  try {
    new Function(source);
  } catch (error) {
    errors.push(`${label} : ${error.message}`);
  }
}

const scriptTags = [...index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const inlineScripts = scriptTags.filter(match => {
  const attributes = match[1];
  return !/\bsrc\s*=/.test(attributes)
    && !/type\s*=\s*["'](?:application\/json|importmap)["']/i.test(attributes);
});

inlineScripts.forEach((match, position) => {
  compileJavaScript(match[2], `Script inline ${position + 1}`);
});
compileJavaScript(serviceWorker, 'service-worker.js');
compileJavaScript(adminServiceWorker, 'admin/service-worker.js');

const assetReferences = [...new Set(
  [...index.matchAll(/(?:["'(]|url\(["']?)(\.?\/?assets\/[A-Za-z0-9._/-]+|\.\/(?:manifest\.webmanifest|icon-(?:192|512)\.png|notification-badge\.png))/g)]
    .map(match => match[1].replace(/^\.\//, ''))
)];
for (const path of assetReferences) {
  if (!existsSync(join(root, path))) errors.push(`Référence locale introuvable : ${path}`);
}

const version = pattern => index.match(pattern)?.[1] ?? null;
const versions = {
  app: version(/const APP_VERSION='([^']+)'/),
  public: version(/const V17111_PUBLIC_VERSION='([^']+)'/),
  title: version(/<title>LEVELING-APP — V([^ <]+)/),
  serviceWorker: serviceWorker.match(/const CACHE='leveling-app-v([0-9-]+)'/)?.[1]?.replaceAll('-', '.') ?? null,
  admin: adminIndex.match(/const ADMIN_CURRENT_APP_VERSION='([^']+)'/)?.[1] ?? null
};
const canonicalVersion = versions.app;
for (const [name, value] of Object.entries(versions)) {
  if (!value) errors.push(`Version ${name} introuvable`);
  else if (canonicalVersion && value !== canonicalVersion) warnings.push(`Version ${name}=${value}, attendue=${canonicalVersion}`);
}

const dataImages = [...index.matchAll(/data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g)]
  .map(match => match[2]);
const dataImageHashes = new Map();
for (const data of dataImages) {
  const hash = createHash('sha256').update(data).digest('hex');
  dataImageHashes.set(hash, (dataImageHashes.get(hash) ?? 0) + 1);
}
const duplicateDataImages = [...dataImageHashes.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);

const metrics = {
  indexBytes: Buffer.byteLength(index),
  lines: index.split(/\r?\n/).length,
  styleBlocks: (index.match(/<style\b/gi) ?? []).length,
  scriptBlocks: scriptTags.length,
  inlineScripts: inlineScripts.length,
  importantRules: (index.match(/!important/g) ?? []).length,
  inlineStyleAttributes: (index.match(/\sstyle\s*=/gi) ?? []).length,
  inlineClickHandlers: (index.match(/\sonclick\s*=/gi) ?? []).length,
  eventListeners: (index.match(/addEventListener\s*\(/g) ?? []).length,
  timeouts: (index.match(/setTimeout\s*\(/g) ?? []).length,
  intervals: (index.match(/setInterval\s*\(/g) ?? []).length,
  mutationObservers: (index.match(/new\s+MutationObserver\s*\(/g) ?? []).length,
  bodyObservers: (index.match(/\.observe\(document\.body/g) ?? []).length,
  embeddedDataImages: dataImages.length,
  uniqueDataImages: dataImageHashes.size,
  duplicateDataImages
};

const nonRegressionBudgets = {
  indexBytes: 8_429_350,
  styleBlocks: 103,
  scriptBlocks: 55,
  importantRules: 3_593,
  eventListeners: 170,
  timeouts: 174,
  intervals: 7,
  mutationObservers: 3,
  bodyObservers: 1,
  duplicateDataImages: 14
};

let guardsPassed = 0;
for (const [name, maximum] of Object.entries(nonRegressionBudgets)) {
  if (metrics[name] <= maximum) guardsPassed += 1;
  else errors.push(`Régression ${name} : ${metrics[name]} > ${maximum}`);
}

if (/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2["']/.test(index)) {
  warnings.push('Le SDK Supabase CDN reste fixé seulement sur la version majeure @2.');
}

console.log(`LEVELING-APP static audit — ${guardsPassed}/${Object.keys(nonRegressionBudgets).length} garde-fous respectés`);
console.log(JSON.stringify({ versions, metrics }, null, 2));

for (const warning of warnings) console.warn(`AVERTISSEMENT : ${warning}`);
for (const error of errors) console.error(`ERREUR : ${error}`);

if (errors.length) process.exitCode = 1;
