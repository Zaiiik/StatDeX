import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');
const html = read('index.html');
const billingSource = read('src/native-billing.js');
const androidBuild = read('android/app/build.gradle');
const mainActivity = read('android/app/src/main/java/com/nextlvldigital/levelingapp/MainActivity.java');
const plugin = read('android/app/src/main/java/com/nextlvldigital/levelingapp/LevelingBillingPlugin.java');
const migration = read('supabase/migrations/20260928160356_google_play_billing_and_account_deletion.sql');
const verifier = read('supabase/functions/google-play-verify-purchase/index.ts');
const playShared = read('supabase/functions/_shared/google-play.ts');
const deleteFunction = read('supabase/functions/delete-account/index.ts');
const rtdn = read('supabase/functions/google-play-rtdn/index.ts');

const checks = [
  ['Play Billing 9.1', () => androidBuild.includes('com.android.billingclient:billing:9.1.0')],
  ['Version Android alignée', () => androidBuild.includes('versionName "22.1.5"')],
  ['Plugin natif enregistré', () => mainActivity.includes('registerPlugin(LevelingBillingPlugin.class)')],
  ['Aucun droit accordé localement', () => !plugin.includes('acknowledgePurchase') && !plugin.includes('consumeAsync')],
  ['Compte d’achat masqué', () => plugin.includes('setObfuscatedAccountId(accountId)') && billingSource.includes("crypto.subtle.digest('SHA-256'")],
  ['Restauration INAPP et SUBS', () => plugin.includes('BillingClient.ProductType.INAPP') && plugin.includes('BillingClient.ProductType.SUBS')],
  ['Catalogue authentifié côté serveur', () => billingSource.includes("callFunction('google-play-products'") && verifier.includes('authenticatedUser(req)')],
  ['Validation Google côté serveur', () => playShared.includes('androidpublisher.googleapis.com') && playShared.includes('GOOGLE_PLAY_ACCOUNT_MISMATCH')],
  ['Jetons jamais stockés en clair', () => migration.includes('purchase_token_hash') && !migration.includes('purchase_token text')],
  ['RLS et accès service uniquement', () => migration.includes('alter table public.google_play_products enable row level security') && migration.includes('revoke all on table public.google_play_products from public, anon, authenticated')],
  ['Idempotence cristaux', () => migration.includes('crystal_transactions_google_play_ref_uidx') && playShared.includes('google-play:${tokenHash}:${product.product_id}')],
  ['RTDN authentifié', () => rtdn.indexOf('RTDN_NOT_AUTHENTICATED') < rtdn.indexOf('RTDN_IDENTITY_NOT_CONFIGURED') && rtdn.includes('RTDN_INVALID_AUDIENCE')],
  ['RTDN rejouable après échec', () => rtdn.includes('["processed", "ignored"]') && rtdn.includes('RTDN_EVENT_RETRY_FAILED')],
  ['Stripe Web préservé', () => html.includes("v17111CallStripeFunction('create-checkout'") && html.includes("v17111CallStripeFunction('create-billing-portal'")],
  ['Android passe par Google Play', () => html.includes("window.LevelingBilling.purchasePlan(planId)") && html.includes("window.LevelingBilling.openSubscriptionCenter()")],
  ['Suppression confirmée côté serveur', () => deleteFunction.includes('DELETE_LEVELING_ACCOUNT') && deleteFunction.includes('delete_leveling_user_data_service')],
  ['Identité supprimée en dernier', () => deleteFunction.indexOf('delete_leveling_user_data_service') < deleteFunction.indexOf('admin.auth.admin.deleteUser')],
  ['Fonctions internes non publiques', () => migration.includes('revoke all on function public.delete_leveling_user_data_service(uuid) from public, anon, authenticated')],
  ['Aucun secret serveur dans le pont client', () => !/service_role|private_key|GOOGLE_PLAY_SERVICE_ACCOUNT_JSON/i.test(billingSource)],
];

for (const [label, check] of checks) assert.equal(Boolean(check()), true, label);

console.log(`LEVELING-APP Play Billing/account deletion — ${checks.length}/${checks.length} scénarios validés`);
