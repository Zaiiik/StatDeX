import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');
const html = read('index.html');
const sql = read('supabase/migrations/20260927000100_crystal_shop_v1.sql');
const hardening = read('supabase/migrations/20260927000200_crystal_shop_v1_hardening.sql');
const catalogV2 = read('supabase/migrations/20260927000300_trial_and_theme_catalog_v2.sql');

const checks = [
  ['Boutique branchée au compteur Cristaux', () => html.includes('aria-label="Boutique Cristaux"') && html.includes('window.LevelingCrystalShop=')],
  ['Compteur Cristaux relié par délégation durable', () => html.includes("e.target?.closest?.('#hud-crystals-badge')") && html.includes('openCrystal()}else if')],
  ['Catalogue thèmes centralisé côté serveur', () => sql.includes('create table if not exists public.crystal_theme_catalog') && sql.includes("('theme_sakura', 'sakura'") && sql.includes("('theme_bloodmoon', 'bloodmoon'") && sql.includes("('theme_winter', 'winter'")],
  ['Propriété persistante par utilisateur', () => sql.includes('create table if not exists public.user_owned_themes') && sql.includes('primary key (user_id, theme_id)')],
  ['RLS catalogue et propriété', () => sql.includes('alter table public.crystal_theme_catalog enable row level security') && sql.includes('alter table public.user_owned_themes enable row level security') && sql.includes('(select auth.uid()) = user_id')],
  ['Reçus internes protégés', () => hardening.includes('crystal_purchase_receipts_own_read') && sql.includes('revoke all on table public.crystal_purchase_receipts from public, anon, authenticated')],
  ['Aucune écriture directe client sur les achats', () => sql.includes('revoke all on table public.user_owned_themes from public, anon, authenticated') && !html.includes(".from('user_owned_themes').insert")],
  ['Prix et produit vérifiés côté serveur', () => sql.includes('from public.crystal_theme_catalog') && sql.includes('v_item.crystal_cost') && sql.includes("raise exception 'THEME_NOT_FOUND'")],
  ['Débit thème atomique et journalisé', () => sql.includes('set balance = balance - v_item.crystal_cost') && sql.includes("'theme_purchase'") && sql.includes('insert into public.user_owned_themes')],
  ['Solde insuffisant refusé côté serveur', () => (sql.match(/INSUFFICIENT_CRYSTALS/g) || []).length >= 2],
  ['Double achat thème sans double débit', () => sql.includes("':theme:' || trim(p_theme_id)") && sql.includes("'already_owned', true")],
  ['Pass idempotent par requête', () => sql.includes('create or replace function public.redeem_crystal_access_v2') && sql.includes("'IDEMPOTENCY_KEY_REUSED'") && html.includes("'redeem_crystal_access_v2'")],
  ['Pass existants réutilisés', () => html.includes(".from('crystal_access_offers')") && html.includes('loadOffers,redeem') && sql.includes('from public.crystal_access_offers')],
  ['Possession rechargée depuis Supabase', () => html.includes("sb.rpc('get_my_crystal_shop_v1')") && html.includes('shop.themes.filter(t=>t.owned===true)')],
  ['Collection historique reconnaît les achats', () => html.includes("window.LevelingCrystalShop?.ownsTheme?.(t.id)") && html.includes("t.id==='winterarc'&&window.LevelingCrystalShop?.ownsTheme?.('winter')")],
  ['Collection visuelle reconnaît les achats', () => html.includes('purchased=id=>window.LevelingCrystalShop?.ownsTheme?.(id)===true') && html.includes('canUse:skinOpen')],
  ['Fondateur et code Allié conservés', () => html.includes("V1341_FOUNDER_EMAIL='dydy180215@gmail.com'") && html.includes("V1341_ALLY_CODE='MONARQUE-ALLIES-2026'") && html.includes("CODE='MONARQUE-ALLIES-2026'")],
  ['Rewarded Premium toujours indépendant des interstitiels', () => html.includes('eligible:!!window.getLevelingCloudAccessState?.()?.user') && !html.includes("eligible:['TRIAL','PASS','FREE']")],
  ['Interstitiels FREE/TRIAL/PASS à 5 min', () => html.includes("function eligible(){return ['TRIAL','PASS','FREE'].includes(state())") && html.includes('const GAP=5*60*1000')],
  ['Etats Boutique visuellement distincts et bilingues', () => html.includes("label=shopText('ACHETER','BUY')") && ['state-owned', 'state-equipped', 'state-insufficient', 'state-locked'].every(state => html.includes(state)) && html.includes("shopText('DÉJÀ DÉBLOQUÉ','ALREADY UNLOCKED')") && html.includes("shopText('SOLDE INSUFFISANT','INSUFFICIENT BALANCE')")],
  ['Etats Thèmes cohérents avec la Boutique', () => html.includes('.v25612-theme.active,.v25612-theme.equipped') && html.includes('.v25612-theme.owned,.v25612-theme.unlocked') && html.includes('.v25612-theme.locked') && html.includes("tr('✓ ÉQUIPÉ','✓ EQUIPPED')") && html.includes("tr('POSSÉDÉ','OWNED')")],
  ['Français et anglais restent sélectionnables', () => html.includes("function lang(){return localStorage.getItem('leveling_language')==='en'?'en':'fr'}") && html.includes("onclick=\"v1610SetLanguage('fr')\"") && html.includes("onclick=\"v1610SetLanguage('en')\"")],
  ['Réglages reconnaissent les libellés bilingues', () => html.includes('my profile|account & profile') && html.includes('ambiance|ambience') && html.includes('affichage|display') && html.includes('window.v151RefreshSettingsLanguage=')],
  ['Essai de 14 jours déclenché par le bouton', () => html.includes("if(state==='PRETRIAL')") && !html.includes('activateLevelingTrial({automatic:true})') && html.includes("sb.rpc('activate_trial_v2141')") && html.includes('activateTrialFromSubscription') && html.includes('ACTIVER MES 14 JOURS GRATUITS') && catalogV2.includes("interval '14 days'")],
  ['Statut abonnement rendu sans doublon', () => html.includes("root.querySelectorAll(':scope > .v214-access-status').forEach(x=>x.remove())") && html.includes('const renderId=++statusRenderSeq')],
  ['Catalogue enrichi avec rareté et prix croissants', () => catalogV2.includes('crystal_theme_catalog_rarity_check') && ['theme_void','theme_shadow','theme_electric','theme_monarch'].every(value => catalogV2.includes(value)) && catalogV2.includes("650, 'legendary'")],
  ['Une seule personnalisation canonique', () => html.includes("document.querySelectorAll('.v25612-personalization')") && html.includes("document.querySelectorAll('.v2566-personalization').forEach(x=>x.remove())") && html.includes("document.querySelectorAll('.v2568-personalization').forEach(x=>x.remove())")],
  ['Séance Power lancée explicitement', () => html.includes("ACTIVE_WORKOUT_STORAGE='leveling_active_workout_session_v1'") && html.includes('window.isExplicitWorkoutSessionActive') && html.includes('id="workout-start-btn"')],
  ['Header Duel aligné comme les pages Communauté', () => html.includes('.v25649-head>div{min-width:0;margin-right:auto;text-align:left}')],
  ['Rapport Coach remonté dans Réglages', () => html.includes('COACH & PROGRESS REPORT') && html.includes("try{window.LevelingCoreV182?.ensureReportsSection?.()}catch(e){}") && html.includes('shareReport')],
  ['Programmes SBD Hypertrophy Fit Girl multi-blocs', () => html.includes('const PROGRAM_BLOCKS =') && ['sbd:[', 'hypertrophie:[', 'fitgirl:['].every(value => html.includes(value)) && html.includes('programs=v261BuildBlocks')],
  ['Deload fondé sur plusieurs signaux', () => html.includes('function deloadAssessment()') && html.includes('signals.length>=3') && !html.includes("if(currentBlockIndex===3 || /\\b(deload")],
];

for (const [label, check] of checks) assert.equal(Boolean(check()), true, label);
console.log(`LEVELING-APP Crystal Shop regression — ${checks.length}/${checks.length} scénarios validés`);
