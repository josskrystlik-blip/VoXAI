/**
 * VoxAI — tests de bout en bout : application installable (PWA) et utilisation hors ligne.
 *
 * Service worker actif, réseau coupé par Playwright, micro simulé, LLM et Whisper simulés.
 * Lancement : node tests/e2e/hors-ligne.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, AUDIO, startServer, createRunner, assert, launchBrowser, gemini, llmServer, whisperServer, openApp } = require('./lib');

const ON_PREM = { provider: 'local', local_llm_url: 'https://llm.corp.test/v1', local_llm_model: 'gpt-oss-120b', on_prem_stt_url: 'https://whisper.corp.test/v1' };
const SW_SOURCE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const VERSION = SW_SOURCE.match(/const VERSION = '([^']+)'/)[1];
const APP_FILES = JSON.parse(SW_SOURCE.match(/const APP_FILES = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));

async function controlled(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller && typeof state !== 'undefined' && state.config);
}

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launchBrowser();
  const t = createRunner('Tests de bout en bout : application installable et hors ligne');

  await t.scenario('Application installable : manifeste, icônes, fichiers en cache, ouverture sans réseau', async () => {
    const { context, page } = await openApp(browser, base, { serviceWorkers: 'allow', config: ON_PREM });
    await controlled(page);
    const manifest = await page.evaluate(async () => {
      const href = document.querySelector('link[rel=manifest]').href;
      const m = await (await fetch(href)).json();
      const icons = await Promise.all(m.icons.map(i => fetch(new URL(i.src, href)).then(r => r.ok && r.headers.get('content-type'))));
      return { name: m.name, display: m.display, start: m.start_url, icons };
    });
    assert(manifest.name.startsWith('VoxAI') && manifest.display === 'standalone' && manifest.icons.length >= 3 && manifest.icons.every(Boolean), `manifeste : ${JSON.stringify(manifest)}`);
    const cache = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys[0]);
      return { keys, files: (await c.keys()).map(r => new URL(r.url).pathname) };
    });
    assert(JSON.stringify(cache.keys) === JSON.stringify([`voxai-${VERSION}`]), `caches : ${cache.keys}`);
    const missing = APP_FILES.filter(f => !cache.files.includes('/' + (f === './' ? '' : f)));
    assert(missing.length === 0, `fichiers absents du cache : ${missing.join(', ')}`);
    assert(await page.textContent('#appVersion') === VERSION, `version affichée (${await page.textContent('#appVersion')}) ≠ version du cache (${VERSION})`);
    // Ouverture sans réseau, styles et polices compris
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    assert((await page.title()).startsWith('VoxAI'), 'page non chargée hors ligne');
    assert(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Plus Jakarta') && document.fonts.check('16px "Plus Jakarta Sans"')), 'styles ou polices absents hors ligne');
    assert(await page.isVisible('#offlineBadge'), 'badge « hors ligne »');
    // Les appels à l'IA ne sont jamais servis par le cache
    assert(!cache.files.some(f => f.startsWith('/api') || f.startsWith('/confluence/')), 'données ou relais Confluence en cache');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Dictaphone hors ligne : enregistrements en attente, puis analyse au retour du réseau', async () => {
    const llm = llmServer();
    const whisper = whisperServer();
    const g = gemini();
    const { context, page } = await openApp(browser, base, { serviceWorkers: 'allow', config: ON_PREM, gemini: g, servers: { 'llm.corp.test': llm.handler, 'whisper.corp.test': whisper.handler } });
    await controlled(page);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    // Enregistrement au micro sans réseau
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.isRecording);
    await page.waitForTimeout(2200);
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.activeRecording && state.activeRecording.status === 'pending', null, { timeout: 15000 });
    const rec = await page.evaluate(() => state.activeRecording);
    assert(rec.duration >= 2 && rec.file_size > 1000, `enregistrement conservé : ${rec.duration} s, ${rec.file_size} octets`);
    assert(await page.textContent('#detailStatusBadge') === 'En attente d’analyse (hors ligne)', 'badge « en attente »');
    // Import d'un fichier sans réseau
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForFunction(() => (state.recordings || []).filter(r => r.status === 'pending').length === 2, null, { timeout: 15000 });
    assert(/2 enregistrements en attente/.test(await page.textContent('#pendingTitle')) && await page.isDisabled('#pendingRunBtn'), 'bandeau hors ligne');
    assert(whisper.calls + llm.calls.length + g.analyses.length === 0, 'requête envoyée sans réseau');
    // Retour du réseau
    await context.setOffline(false);
    await page.waitForFunction(() => !document.querySelector('#pendingRunBtn').disabled);
    assert(await page.isHidden('#offlineBadge') && /Analyser les 2 maintenant/.test(await page.textContent('#pendingRunBtn')), 'bandeau en ligne');
    await page.click('#pendingRunBtn');
    await page.waitForFunction(() => state.recordings.every(r => r.status === 'completed'), null, { timeout: 20000 });
    assert(await page.isHidden('#pendingBanner') && whisper.calls === 2 && g.analyses.length === 0, `analyses : Whisper ${whisper.calls}, Google ${g.analyses.length}`);
    // La liste est mise à jour avant la fiche ouverte (selectRecording) : attendre l'affichage
    await page.waitForFunction(() => document.querySelector('#summaryExecutive').textContent.includes('Synthèse produite sur site.'), null, { timeout: 10000 });
    await context.close();
  });

  await t.scenario('Réseau coupé pendant l’analyse en attente : les suivantes restent en attente', async () => {
    const llm = llmServer();
    const whisper = whisperServer();
    const { context, page } = await openApp(browser, base, { config: ON_PREM, servers: { 'llm.corp.test': llm.handler, 'whisper.corp.test': whisper.handler } });
    await context.setOffline(true);
    for (const name of ['a.wav', 'b.wav']) {
      await page.setInputFiles('#fileUploadInput', { name, mimeType: 'audio/wav', buffer: fs.readFileSync(AUDIO) });
      await page.waitForFunction(n => (state.recordings || []).filter(r => r.status === 'pending').length === n, name === 'a.wav' ? 1 : 2, { timeout: 15000 });
    }
    await context.setOffline(false);
    await page.waitForFunction(() => !document.querySelector('#pendingRunBtn').disabled);
    whisper.down = true; // serveur injoignable dès la première analyse
    await page.click('#pendingRunBtn');
    await page.waitForFunction(() => !state.pendingRunning && /Réseau de nouveau indisponible/.test(document.querySelector('#toastMessage').textContent), null, { timeout: 15000 });
    assert(await page.evaluate(() => state.recordings.filter(r => r.status === 'pending').length) === 2, 'enregistrements perdus ou en erreur');
    await context.close();
  });

  await t.scenario('Mise à jour de l’application : nouvelle version installée sans recharger la page', async () => {
    let next = null; // nouvelle version de sw.js publiée par le serveur
    const srv = await startServer({ '/sw.js': () => next && { type: 'application/javascript', body: next } });
    const { context, page } = await openApp(browser, `http://127.0.0.1:${srv.address().port}/`, { serviceWorkers: 'allow', config: ON_PREM });
    await controlled(page);
    await page.evaluate(() => { window.__sansRechargement = true; });
    next = SW_SOURCE.replace(`const VERSION = '${VERSION}'`, "const VERSION = 'v99.0.0'");
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    await page.waitForFunction(() => /VoxAI a été mis à jour/.test(document.querySelector('#toastMessage').textContent), null, { timeout: 15000 });
    assert(await page.evaluate(() => window.__sansRechargement === true), 'page rechargée automatiquement (un enregistrement aurait pu être perdu)');
    const keys = await page.evaluate(() => caches.keys());
    assert(JSON.stringify(keys) === '["voxai-v99.0.0"]', `ancien cache non supprimé : ${keys}`);
    await context.close();
    srv.close();
  });

  await browser.close();
  server.close();
  t.finish();
})().catch(err => { console.error(err); process.exit(1); });
