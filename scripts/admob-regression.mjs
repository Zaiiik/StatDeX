import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');
const html = read('index.html');
const source = read('src/native-ads.js');
const bundle = read('native-ads.js');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const strings = read('android/app/src/main/res/values/strings.xml');
const serviceWorker = read('service-worker.js');
const migration = read('supabase/migrations/202609260001_rewarded_ad_claim_v1.sql');
const pkg = JSON.parse(read('package.json'));

const PROD_REWARDED = 'ca-app-pub-4735235739133080/9050394392';
const PROD_INTERSTITIAL = 'ca-app-pub-4735235739133080/2189472575';
const TEST_REWARDED = 'ca-app-pub-3940256099942544/5224354917';
const TEST_INTERSTITIAL = 'ca-app-pub-3940256099942544/1033173712';

const checks = [
  ['Capacitor 8 exact', () => pkg.dependencies['@capacitor/core'] === '8.5.2' && pkg.dependencies['@capacitor/android'] === '8.5.2'],
  ['AdMob 8 exact', () => pkg.dependencies['@capacitor-community/admob'] === '8.1.0'],
  ['Bridge chargé', () => html.includes('<script defer src="./native-ads.js"></script>')],
  ['Bundle Web en test', () => bundle.includes(TEST_REWARDED) && bundle.includes(TEST_INTERSTITIAL)],
  ['Aucun Ad Unit production dans le bundle test', () => !bundle.includes(PROD_REWARDED) && !bundle.includes(PROD_INTERSTITIAL)],
  ['Mode test explicite', () => bundle.includes('var ADS_MODE = "test"') && bundle.includes('initializeForTesting: !IS_PRODUCTION') && bundle.includes('isTesting: !IS_PRODUCTION')],
  ['Runtime Android protégé', () => source.includes("Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'")],
  ['UMP canRequestAds', () => source.includes('requestConsentInfo') && source.includes('showConsentForm') && source.includes('consent.canRequestAds === true')],
  ['Options confidentialité réelles', () => source.includes('showPrivacyOptionsForm') && html.includes('OPTIONS DE CONFIDENTIALITÉ PUBLICITAIRE')],
  ['Reward officiel seulement', () => source.includes('RewardAdPluginEvents.Rewarded') && source.includes('rewardEventReceived')],
  ['Reward 10 cristaux', () => html.includes('REWARDED_CRYSTALS=10') && source.includes('REWARD_CRYSTALS = 10')],
  ['Aucun ancien fallback à 15 cristaux', () => !html.includes('rewarded_ad_crystals||15')],
  ['Limite 3 par jour et utilisateur', () => html.includes('REWARDED_DAILY_LIMIT=3') && html.includes('leveling_rewarded_ads_v1_${rewardedUser()}_${rewardedDay()}')],
  ['Idempotence serveur', () => html.includes("REWARDED_RPC='claim_rewarded_ad_v1'") && html.includes('p_claim_id:claimId')],
  ['RPC Supabase authentifiée', () => migration.includes('create or replace function public.claim_rewarded_ad_v1') && migration.includes('grant execute on function public.claim_rewarded_ad_v1') && migration.includes('to authenticated') && migration.includes('from anon')],
  ['Sérialisation anti-double serveur', () => migration.includes('pg_advisory_xact_lock') && migration.includes("coalesce(v_reward, 0) <> 10")],
  ['Économie serveur fixée à 10 × 3', () => migration.includes('rewarded_ad_reward = 10') && migration.includes('rewarded_ads_daily_limit = 3')],
  ['Cooldown interstitiel 5 min', () => html.includes('const GAP=5*60*1000') && html.includes("['Bridge pubs 5 min',()=>window.LevelingAdsV214?.minGapMs===300000]")],
  ['Compte FREE éligible aux interstitiels', () => source.includes("['TRIAL', 'PASS', 'FREE'].includes(state)") && html.includes("['TRIAL','PASS','FREE'].includes(state())")],
  ['Garde POWER double niveau', () => html.includes('window.LevelingWorkoutGuard={isPowerSessionActive') && source.match(/isPowerSessionActive/g)?.length >= 2],
  ['Aucune pub de fin POWER', () => !html.includes("naturalBreak('workout_complete')")],
  ['Coupures naturelles limitées', () => html.includes("new Set(['navigation:profile','navigation:community','navigation:settings'])")],
  ['App ID Android', () => manifest.includes('com.google.android.gms.ads.APPLICATION_ID') && strings.includes('ca-app-pub-4735235739133080~7633370945')],
  ['Bridge PWA mis en cache', () => serviceWorker.includes("'./native-ads.js'")],
];

for (const [label, check] of checks) {
  assert.equal(Boolean(check()), true, label);
}

console.log(`LEVELING-APP AdMob regression — ${checks.length}/${checks.length} scénarios validés`);
