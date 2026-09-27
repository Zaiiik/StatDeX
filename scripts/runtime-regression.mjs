import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profiles = [];
const baselineIndex = execFileSync('git', ['show', 'HEAD:index.html'], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const server = createServer(async (request, response) => {
  try {
    const parsedUrl = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(parsedUrl.pathname);
    if (pathname === '/index.html' && parsedUrl.searchParams.has('runtimeBaseline')) {
      response.setHeader('Content-Type', contentTypes['.html']);
      response.end(baselineIndex);
      return;
    }
    const requested = normalize(join(root, pathname === '/' ? 'index.html' : pathname.slice(1)));
    if (relative(root, requested).startsWith('..')) throw new Error('Chemin refusé');
    let body = await readFile(requested);
    if (extname(requested) === '.html' && parsedUrl.searchParams.get('runtimeLang') === 'en') {
      body = Buffer.from(body.toString('utf8').replace('<head>', '<head><script>localStorage.setItem("leveling_language","en")<\/script>'));
    }
    if (extname(requested) === '.html' && parsedUrl.searchParams.get('runtimeAction') === 'core') {
      const action = `<script>window.addEventListener('load',()=>setTimeout(()=>{try{window.LevelingCoreV182?.ensureReportsSection?.();window.v15BuildSettings?.();const root=document.documentElement,main=document.querySelector('#app-container > main');document.body.classList.add('v1422-modal-open','v1358-settings-open');root.dataset.scrollRecovered=String(window.repairLevelingScrollLock?.('runtime-test')===true&&!document.body.classList.contains('v1422-modal-open')&&!document.body.classList.contains('v1358-settings-open')&&getComputedStyle(main).overflowY==='auto');const tabs=['profile','workout','power','community','settings'];root.dataset.allTabs=String(tabs.every(name=>{switchTab(name);return document.getElementById('panel-'+name)?.classList.contains('active')&&getComputedStyle(main).overflowY==='auto'}));switchTab('settings');const settingPages=['subscription','account','personalization','tracking','leveling','privacy'],settingResults=settingPages.map(key=>{window.v15SelectSetting?.(key);const panel=document.getElementById('panel-settings'),content=key==='personalization'?panel?.querySelector('.v221-display-home:not([hidden])'):panel?.querySelector('.compact-setting-section.v151-active');return[key,panel?.dataset.v151Page===key&&panel.classList.contains('v151-page-open')&&!!content]});root.dataset.allSettings=String(settingResults.every(([,ok])=>ok));root.dataset.settingsFailures=settingResults.filter(([,ok])=>!ok).map(([key])=>key).join(',');switchTab('community');const communityPages=['profile','items','referral','activity','leaderboard','friends','team','achievements'];root.dataset.allCommunity=String(communityPages.every(name=>{switchCommunityPane(name);return document.getElementById('community-pane-'+name)?.classList.contains('active')}));switchCommunityPane('feed');root.dataset.communityUnlocked=String(!document.body.classList.contains('v2145-community-detail-open'));switchTab('profile');const trigger=document.getElementById('hud-crystals-badge');trigger?.click();root.dataset.shopOpened=String(document.getElementById('v2147-crystal-modal')?.classList.contains('show'));document.getElementById('v2147-crystal-close')?.click();root.dataset.shopClosed=String(!document.getElementById('v2147-crystal-modal')?.classList.contains('show'));trigger?.click();root.dataset.shopReopened=String(document.getElementById('v2147-crystal-modal')?.classList.contains('show'));root.dataset.trackingCard=String(!!document.querySelector('#v151-settings-menu [data-key="tracking"]'));root.dataset.programBlocks=['powerbuilding','sbd','hypertrophie','fitgirl'].map(k=>window.LevelingProgramArchitecture?.blocks?.(k)?.length||0).join(',');const originalProgram=activeProgramKey,originalBlock=currentBlockIndex;root.dataset.generatedBlocks=['powerbuilding','sbd','hypertrophie','fitgirl'].map(k=>{activeProgramKey=k;currentBlockIndex=0;return getPrograms().length}).join(',');activeProgramKey='powerbuilding';currentBlockIndex=0;root.dataset.realWeekday=String(v1618CalendarDayIndex()===((new Date().getDay()+6)%7));activeProgramKey=originalProgram;currentBlockIndex=originalBlock;root.dataset.coachReport=String(!!document.getElementById('v182-reports-settings')&&typeof window.LevelingCoreV182?.shareReport==='function');root.dataset.deload=String(typeof window.LevelingCoreV182?.deloadAssessment?.().recommended==='boolean');const lab=window.LevelingSystemLab?.run?.()||[],labRows=lab.flatMap(x=>x[1]||[]);root.dataset.systemLab=String(lab.length>0&&labRows.every(x=>x.ok===true));root.dataset.systemLabCount=String(labRows.length);root.dataset.systemLabFailures=labRows.filter(x=>!x.ok).map(x=>x.name).join('|')}catch(e){document.documentElement.dataset.coreActionError=String(e?.message||e)}},2600))<\/script>`;
      body = Buffer.from(body.toString('utf8').replace('<head>', `<head>${action}`));
    }
    response.setHeader('Content-Type', contentTypes[extname(requested)] || 'application/octet-stream');
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end('Not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

try {
  const render = async url => {
    const profile = await mkdtemp(join(tmpdir(), 'leveling-runtime-'));
    profiles.push(profile);
    return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--window-size=390,844',
      '--virtual-time-budget=8000',
      `--user-data-dir=${profile}`,
      '--dump-dom',
      url,
    ], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Chrome headless n’a pas terminé dans le délai imparti.'));
    }, 20_000);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    });
  };

  const baseline = await render(`http://127.0.0.1:${port}/index.html?runtimeBaseline=1`);
  const result = await render(`http://127.0.0.1:${port}/index.html`);
  const english = await render(`http://127.0.0.1:${port}/index.html?runtimeLang=en`);
  const interaction = await render(`http://127.0.0.1:${port}/index.html?runtimeAction=core`);

  if (result.code !== 0) throw new Error(`Chrome headless a quitté avec le code ${result.code}.`);
  if (english.code !== 0) throw new Error(`Chrome headless anglais a quitté avec le code ${english.code}.`);
  if (interaction.code !== 0) throw new Error(`Chrome headless interactions a quitté avec le code ${interaction.code}.`);
  if (!result.stdout.includes('<body')) throw new Error('DOM rendu absent.');

  const idCounts = html => {
    const counts = new Map();
    for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
      counts.set(match[1], (counts.get(match[1]) || 0) + 1);
    }
    return counts;
  };
  const baselineIds = idCounts(baseline.stdout);
  const currentIds = idCounts(result.stdout);
  const duplicateRegressions = [...currentIds]
    .filter(([id, count]) => count > 1 && count > (baselineIds.get(id) || 0));
  if (duplicateRegressions.length) {
    throw new Error(`Nouveaux IDs dupliqués dans le DOM rendu : ${duplicateRegressions.map(([id, count]) => `${id} x${count}`).join(', ')}`);
  }

  const runtimeErrors = `${result.stderr}\n${english.stderr}\n${interaction.stderr}`
    .split(/\r?\n/)
    .filter(line => /Uncaught|SyntaxError|ReferenceError|TypeError/i.test(line));
  if (runtimeErrors.length) throw new Error(`Erreur console/runtime : ${runtimeErrors.join(' | ')}`);

  const visibleMarkup = english.stdout
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const visibleText = visibleMarkup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const frenchUiPatterns = [
    /\b(?:Acheter|Possédé|Équipé|Verrouillé|Déverrouillé|Fermer|Annuler|Continuer|Paramètres|Déconnexion)\b/i,
    /\b(?:Solde insuffisant|Déjà débloqué|Séance terminée|Valider la séance|Retour au tableau)\b/i,
    /\b(?:Adresse e-mail|Mot de passe|Créer un compte|Se connecter)\b/i,
  ];
  const frenchText = frenchUiPatterns.find(pattern => pattern.test(visibleText));
  if (frenchText) {
    const match = visibleText.match(frenchText);
    const at = match?.index || 0;
    throw new Error(`Texte français visible restant : ${visibleText.slice(Math.max(0, at - 70), at + 120)}`);
  }
  const frenchAttributes = [...visibleMarkup.matchAll(/\s(?:placeholder|title|aria-label)="([^"]+)"/gi)]
    .map(match => match[1])
    .filter(value => frenchUiPatterns.some(pattern => pattern.test(value)));
  if (frenchAttributes.length) throw new Error(`Attribut français visible restant : ${frenchAttributes.slice(0, 5).join(' | ')}`);
  if (!/\<html[^>]+lang="en"/i.test(english.stdout) || !/\<html[^>]+lang="fr"/i.test(result.stdout)) {
    throw new Error('Le basculement Français / English ne met pas à jour la langue du document.');
  }
  if (!english.stdout.includes('data-lang="fr"') || !english.stdout.includes('data-lang="en"')) {
    throw new Error('Les deux choix de langue ne sont pas disponibles.');
  }
  for (const marker of ['data-scroll-recovered="true"', 'data-all-tabs="true"', 'data-all-settings="true"', 'data-all-community="true"', 'data-community-unlocked="true"', 'data-shop-opened="true"', 'data-shop-closed="true"', 'data-shop-reopened="true"', 'data-tracking-card="true"', 'data-program-blocks="4,4,4,4"', 'data-generated-blocks="4,4,4,4"', 'data-real-weekday="true"', 'data-coach-report="true"', 'data-deload="true"', 'data-system-lab="true"']) {
    if (!interaction.stdout.includes(marker)) throw new Error(`Interaction runtime absente : ${marker} · ${(interaction.stdout.match(/<html[^>]*>/i)||['état HTML indisponible'])[0]}`);
  }
  if (interaction.stdout.includes('data-core-action-error=')) throw new Error('Erreur pendant les interactions Boutique/Coach/Programmes.');

  const duplicateCount = [...currentIds].filter(([, count]) => count > 1).length;
  console.log(`LEVELING-APP runtime browser — 5 onglets, 6 pages Réglages, 8 pages Communauté, scroll mobile, DOM bilingue FR/EN, Boutique, Coach et 4×4 blocs validés, 0 nouvelle duplication d’ID (${duplicateCount} héritées)`);
} finally {
  await new Promise(resolve => server.close(resolve));
  await Promise.all(profiles.map(profile => rm(profile, { recursive: true, force: true })));
}
