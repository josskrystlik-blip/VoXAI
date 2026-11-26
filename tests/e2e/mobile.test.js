/**
 * VoxAI — tests de bout en bout : mise en page sur mobile (liste en tiroir) et colonne repliable
 * sur ordinateur.
 * Lancement : node tests/e2e/mobile.test.js
 */
'use strict';

const { devices } = require('playwright');
const { AUDIO, startServer, createRunner, assert, launchBrowser, gemini } = require('./lib');

const CONFIG = { provider: 'gemini', gemini_api_key: 'cle-test' };

async function open(browser, base, contextOptions) {
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
  const g = gemini();
  await context.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.hostname === '127.0.0.1') return r.continue();
    if (u.hostname === 'generativelanguage.googleapis.com') return g.handler(r);
    return r.abort();
  });
  await context.addInitScript(() => localStorage.setItem('voxai_onboarded', 'test'));
  const page = await context.newPage();
  page.jsErrors = [];
  page.on('pageerror', e => page.jsErrors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
  await page.evaluate(c => fetch('/api/config', { method: 'POST', body: JSON.stringify(c) }), CONFIG);
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
  await page.waitForTimeout(400);
  await page.evaluate(() => { try { closeSettingsModal(); } catch {} });
  return { context, page };
}

/** Le tiroir est-il visible à l'écran (dans la fenêtre, non masqué) ? */
const drawerShown = (page) => page.evaluate(() => {
  const r = document.getElementById('sidebar').getBoundingClientRect();
  return getComputedStyle(document.getElementById('sidebar')).visibility === 'visible' && r.right > 10 && r.left > -10;
});

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launchBrowser();
  const t = createRunner('Tests de bout en bout : mobile (tiroir) et colonne repliable');

  await t.scenario('Téléphone : dictaphone en plein écran, liste en tiroir, rien ne déborde', async () => {
    const { context, page } = await open(browser, base, devices['iPhone 13']);
    const width = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth }));
    assert(width.doc <= width.vw, `défilement horizontal : ${width.doc} > ${width.vw}`);
    assert(!(await drawerShown(page)), 'liste affichée par-dessus le dictaphone au démarrage');
    assert(await page.evaluate(() => document.getElementById('sidebar').inert), 'liste fermée encore accessible au clavier');
    const rec = await page.evaluate(() => document.getElementById('mainRecordBtn').getBoundingClientRect());
    assert(rec.left >= 0 && rec.right <= 390, 'bouton d’enregistrement hors de l’écran');
    // Ouverture du tiroir
    assert(await page.getAttribute('#sidebarToggle', 'aria-expanded') === 'false', 'état du bouton');
    await page.click('#sidebarToggle');
    await page.waitForTimeout(300);
    assert(await drawerShown(page) && await page.isVisible('#sidebarScrim') && await page.getAttribute('#sidebarToggle', 'aria-expanded') === 'true', 'tiroir non ouvert');
    assert(await page.evaluate(() => document.getElementById('sidebar').contains(document.activeElement)), 'focus non placé dans le tiroir');
    // Fermeture par le voile, puis par Échap (focus rendu au bouton)
    await page.click('#sidebarScrim', { position: { x: 370, y: 400 } });
    await page.waitForTimeout(300);
    assert(!(await drawerShown(page)), 'voile : tiroir non fermé');
    await page.click('#sidebarToggle');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert(!(await drawerShown(page)) && await page.evaluate(() => document.activeElement.id) === 'sidebarToggle', 'Échap : tiroir non fermé ou focus perdu');
    // Import depuis le tiroir : il se referme, la fiche s'affiche en plein écran
    await page.click('#sidebarToggle');
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForFunction(() => state.activeRecording && state.activeRecording.status === 'completed', null, { timeout: 15000 });
    await page.waitForTimeout(300);
    assert(!(await drawerShown(page)), 'tiroir resté ouvert après l’import');
    assert(await page.textContent('#sidebarCount') === '1', 'compteur d’enregistrements');
    const fiche = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, btn: document.getElementById('publishConfluenceBtn').getBoundingClientRect().right }));
    assert(fiche.doc <= 390 && fiche.btn <= 390, `fiche : débordement (${JSON.stringify(fiche)})`);
    // Choisir un enregistrement dans la liste referme le tiroir
    await page.click('#sidebarToggle');
    await page.click('#sidebarClose');
    await page.click('#sidebarToggle');
    await page.click('#recordingsList .recording-item');
    await page.waitForTimeout(300);
    assert(!(await drawerShown(page)) && await page.isVisible('#detailsView'), 'tiroir resté ouvert après le choix d’un enregistrement');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Ordinateur : colonne repliable, choix mémorisé', async () => {
    const { context, page } = await open(browser, base, { viewport: { width: 1360, height: 900 } });
    assert(await page.isVisible('#sidebar') && await page.getAttribute('#sidebarToggle', 'aria-expanded') === 'true', 'colonne visible par défaut');
    assert(await page.isHidden('#sidebarScrim') && !(await page.evaluate(() => document.getElementById('sidebar').inert)), 'voile ou colonne inaccessible sur ordinateur');
    const before = await page.evaluate(() => document.querySelector('main').getBoundingClientRect().width);
    await page.click('#sidebarToggle');
    assert(await page.isHidden('#sidebar') && await page.getAttribute('#sidebarToggle', 'aria-expanded') === 'false', 'colonne non repliée');
    const after = await page.evaluate(() => document.querySelector('main').getBoundingClientRect().width);
    assert(after > before + 250, `espace non récupéré : ${before} → ${after}`);
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    assert(await page.isHidden('#sidebar'), 'repli non mémorisé');
    await page.click('#sidebarToggle');
    assert(await page.isVisible('#sidebar'), 'colonne non rouverte');
    // Passage en largeur mobile : tiroir fermé, liste hors de portée du clavier
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    assert(!(await drawerShown(page)) && await page.evaluate(() => document.getElementById('sidebar').inert), 'passage en mobile');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await browser.close();
  server.close();
  t.finish();
})().catch(err => { console.error(err); process.exit(1); });
