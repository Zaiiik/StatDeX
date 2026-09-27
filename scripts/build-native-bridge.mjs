import { build } from 'esbuild';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
const outArg = process.argv.find(arg => arg.startsWith('--out='));
const mode = modeArg?.split('=')[1] ?? 'test';
const outfile = resolve(root, outArg?.split('=')[1] ?? 'native-ads.js');
const adUnits = mode === 'production'
  ? {
      rewarded: 'ca-app-pub-4735235739133080/9050394392',
      interstitial: 'ca-app-pub-4735235739133080/2189472575',
    }
  : {
      rewarded: 'ca-app-pub-3940256099942544/5224354917',
      interstitial: 'ca-app-pub-3940256099942544/1033173712',
    };

if (!['test', 'production'].includes(mode)) {
  throw new Error(`Mode publicitaire invalide: ${mode}`);
}

await build({
  entryPoints: [resolve(root, 'src/native-ads.js')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  sourcemap: false,
  minify: mode === 'production',
  legalComments: 'none',
  define: {
    __LEVELING_ADS_MODE__: JSON.stringify(mode),
    __LEVELING_REWARDED_AD_ID__: JSON.stringify(adUnits.rewarded),
    __LEVELING_INTERSTITIAL_AD_ID__: JSON.stringify(adUnits.interstitial),
  },
});

console.log(`Bridge AdMob ${mode} -> ${outfile}`);
