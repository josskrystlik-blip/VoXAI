/**
 * VoxAI — tests fonctionnels de la publication dans Confluence (Playwright, Chromium).
 *
 * Un faux serveur Confluence (API REST v1) garde l'état des pages, de leurs versions et des
 * pièces jointes, et enregistre chaque requête. Les scénarios passent par l'interface, comme
 * un utilisateur, et vérifient ce que Confluence reçoit :
 *   - création d'une sous-page : emplacement, contenu, étiquettes, transcription jointe et vérifiée,
 *     lien enregistré sur le compte rendu, emplacement mémorisé ;
 *   - mise à jour d'une page existante (ajout à la fin / remplacement) : contenu conservé, version suivante ;
 *   - pièce jointe : repli quand l'envoi direct n'existe pas, nouvelle version d'un fichier existant,
 *     taille incorrecte signalée ;
 *   - erreurs (jeton refusé, erreur Confluence, serveur injoignable) : messages clairs ;
 *   - authentification Confluence Cloud (e-mail + jeton) et « Tester la connexion » ;
 *   - relais Confluence du conteneur Docker (/confluence/) ;
 *   - navigation (arborescence, recherche sans injection CQL), page parente d'une série,
 *     « Publier et envoyer ».
 *
 * Aucun accès Internet : Gemini et Confluence sont simulés, toute autre requête est bloquée.
 *
 * Lancement : node tests/e2e/confluence.test.js   (Playwright doit être disponible)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const AUDIO = path.join(ROOT, 'tests', 'security', 'fixtures', 'silence.wav');
const CF_HOST = 'confluence.test';
const CF_BASE = `https://${CF_HOST}/wiki`;

// ---------------------------------------------------------------------------
// Infrastructure : serveur statique local + mini-cadre de test
// ---------------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.wav': 'audio/wav' };

function startServer(extraRoutes = {}) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (extraRoutes[url]) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(extraRoutes[url]); }
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
async function scenario(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${String(err && err.stack || err).split('\n').slice(0, 3).join('\n      ')}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---------------------------------------------------------------------------
// Faux serveur Confluence (état + journal des requêtes)
// ---------------------------------------------------------------------------

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

/** Extrait le fichier d'un envoi multipart (nom et taille en octets). */
function multipartFile(req) {
  const type = req.headers()['content-type'] || '';
  const boundary = (type.match(/boundary=(.+)$/) || [])[1];
  const buf = req.postDataBuffer();
  if (!boundary || !buf) return null;
  const raw = buf.toString('latin1');
  const parts = raw.split(`--${boundary}`);
  for (const part of parts) {
    const name = (part.match(/filename="([^"]*)"/) || [])[1];
    if (name === undefined) continue;
    const start = part.indexOf('\r\n\r\n') + 4;
    const content = part.slice(start, part.lastIndexOf('\r\n'));
    return { filename: Buffer.from(name, 'latin1').toString('utf8'), size: Buffer.byteLength(content, 'latin1') };
  }
  return null;
}

class FakeConfluence {
  constructor() {
    this.log = [];
    this.down = false;          // serveur injoignable (erreur réseau / CORS)
    this.fail = {};             // « MÉTHODE /chemin » (expression régulière) → { status, body }
    this.attachPut = true;      // false : PUT …/child/attachment répond 404 (anciennes versions)
    this.wrongSize = false;     // taille renvoyée incorrecte après l'envoi de la pièce jointe
    this.nextId = 500;
    this.spaces = [
      { key: 'PROJ', name: 'Projet', type: 'global' },
      { key: '~alice', name: 'Alice', type: 'personal' },
      { key: 'ARCH', name: 'Archives', type: 'global' },
      { key: 'SECRET', name: 'Direction', type: 'global' }
    ];
    this.pages = {
      100: { id: '100', title: 'Réunions', space: 'PROJ', parent: null, version: 3, body: '<p>Index</p>' },
      101: { id: '101', title: 'Compte rendu existant', space: 'PROJ', parent: '100', version: 7, body: '<p>Ancien contenu</p>' },
      102: { id: '102', title: 'Réunions 2025', space: 'PROJ', parent: '100', version: 1, body: '' },
      200: { id: '200', title: 'Archives 2024', space: 'ARCH', parent: null, version: 1, body: '' }
    };
    this.attachments = {};      // pageId → [{ id, title, size, versions }]
    this.labels = {};           // pageId → [noms]
  }

  links(p) { return { base: CF_BASE, webui: `/spaces/${p.space}/pages/${p.id}` }; }
  calls(re) { return this.log.filter(c => re.test(`${c.method} ${c.path}`)); }

  async handle(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (this.down) return route.abort('failed');
    const url = new URL(req.url());
    const p = url.pathname.slice(url.pathname.indexOf('/rest/api') + '/rest/api'.length);
    const isJson = (req.headers()['content-type'] || '').includes('application/json');
    const entry = { method: req.method(), path: p, query: Object.fromEntries(url.searchParams), auth: req.headers().authorization || '', host: url.host, body: isJson ? JSON.parse(req.postData() || 'null') : null, file: isJson ? null : multipartFile(req) };
    this.log.push(entry);
    const send = (o, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });

    for (const [pattern, res] of Object.entries(this.fail)) {
      if (new RegExp(pattern).test(`${entry.method} ${p}`)) return send(res.body || {}, res.status);
    }
    const m = (re) => p.match(re);
    let r;
    if (p === '/user/current') return send({ displayName: 'Alice Martin', username: 'alice' });
    if (p === '/space') {
      // Pagination : un espace par page (vérifie que tous les espaces sont lus)
      const start = Number(url.searchParams.get('start') || 0) / 100;
      const slice = this.spaces.slice(start * 2, start * 2 + 2);
      return send({ results: slice, _links: start * 2 + 2 < this.spaces.length ? { next: '/rest/api/space?start=' + (start + 1) * 100 } : {} });
    }
    if ((r = m(/^\/space\/([^/]+)\/content\/page$/))) {
      return send({ results: Object.values(this.pages).filter(x => x.space === decodeURIComponent(r[1]) && !x.parent).map(x => ({ id: x.id, title: x.title })) });
    }
    if ((r = m(/^\/content\/(\d+)\/child\/page$/))) {
      return send({ results: Object.values(this.pages).filter(x => x.parent === r[1]).map(x => ({ id: x.id, title: x.title })) });
    }
    if (p === '/content/search') {
      const cql = url.searchParams.get('cql') || '';
      const space = (cql.match(/space="([^"]*)"/) || [])[1];
      const q = ((cql.match(/title~"([^"]*)"/) || [])[1] || '').trim().toLowerCase();
      return send({ results: Object.values(this.pages).filter(x => x.space === space && x.title.toLowerCase().includes(q)).map(x => ({ id: x.id, title: x.title })) });
    }
    if ((r = m(/^\/content\/(\d+)\/child\/attachment\/([^/]+)\/data$/)) && entry.method === 'POST') {
      const att = (this.attachments[r[1]] || []).find(a => a.id === r[2]);
      if (!att) return send({ message: 'Pièce jointe introuvable' }, 404);
      Object.assign(att, { size: entry.file.size, versions: att.versions + 1 });
      return send({ id: att.id, title: att.title });
    }
    if ((r = m(/^\/content\/(\d+)\/child\/attachment$/))) {
      const list = this.attachments[r[1]] = this.attachments[r[1]] || [];
      if (entry.method === 'GET') {
        const name = url.searchParams.get('filename');
        return send({ results: list.filter(a => !name || a.title === name).map(a => ({ id: a.id, title: a.title, version: { number: a.versions }, extensions: { fileSize: this.wrongSize ? a.size + 3 : a.size } })) });
      }
      if (entry.method === 'PUT' && !this.attachPut) return send({ message: 'Not Found' }, 404);
      const existing = list.find(a => a.title === entry.file.filename);
      if (existing && entry.method === 'POST') return send({ message: `Cannot add a new attachment with same file name as an existing attachment: ${existing.title}` }, 400);
      if (existing) Object.assign(existing, { size: entry.file.size, versions: existing.versions + 1 });
      else list.push({ id: `att${list.length + 1}`, title: entry.file.filename, size: entry.file.size, versions: 1 });
      return send({ results: [{ id: (existing || list[list.length - 1]).id }] });
    }
    if ((r = m(/^\/content\/(\d+)\/label$/))) {
      this.labels[r[1]] = (entry.body || []).map(l => l.name);
      return send({ results: entry.body });
    }
    if ((r = m(/^\/content\/(\d+)$/))) {
      const page = this.pages[r[1]];
      if (!page) return send({ message: 'Page introuvable' }, 404);
      if (entry.method === 'GET') {
        return send({ id: page.id, title: page.title, space: { key: page.space }, version: { number: page.version }, body: { storage: { value: page.body, representation: 'storage' } }, _links: this.links(page) });
      }
      if (entry.method === 'PUT') {
        const b = entry.body;
        if (!b.version || b.version.number !== page.version + 1) return send({ message: `Version must be incremented when updating a page. Current Version is: ${page.version}` }, 409);
        Object.assign(page, { title: b.title, version: b.version.number, body: b.body.storage.value });
        return send({ id: page.id, title: page.title, version: { number: page.version }, _links: this.links(page) });
      }
    }
    if (p === '/content' && entry.method === 'POST') {
      const b = entry.body;
      if (Object.values(this.pages).some(x => x.space === b.space.key && x.title === b.title)) {
        return send({ statusCode: 400, data: { errors: [{ message: { translation: 'Une page porte déjà ce titre dans cet espace.' } }] }, message: '' }, 400);
      }
      const page = { id: String(this.nextId++), title: b.title, space: b.space.key, parent: b.ancestors ? b.ancestors[0].id : null, version: 1, body: b.body.storage.value };
      this.pages[page.id] = page;
      return send({ id: page.id, title: page.title, version: { number: 1 }, _links: this.links(page) });
    }
    return send({ message: `Non simulé : ${entry.method} ${p}` }, 501);
  }
}

// ---------------------------------------------------------------------------
// Application : contexte isolé, compte rendu analysé, Confluence configuré
// ---------------------------------------------------------------------------

const SUMMARY = {
  title: 'Point projet Alpha',
  transcription: [
    { speaker: 'Alice', timestamp: '00:00', text: 'Bonjour à tous.' },
    { speaker: 'Bob', timestamp: '00:05', text: "J'envoie le devis vendredi." }
  ],
  summary: {
    executive: 'Lancement du projet validé.',
    decisions: [{ text: 'Budget de 120 k€ validé', refs: [1] }],
    key_points: ['Planning tenu'],
    tags: ['Projet Alpha', 'Budget'],
    action_items: [{ task: 'Envoyer le devis', assignee: 'Bob', deadline: '2026-11-27', refs: [2] }]
  }
};

const CONFIG = { gemini_api_key: 'cle-test', confluence_url: CF_BASE, confluence_auth: 'pat', confluence_token: 'pat-secret' };

async function openApp(browser, baseUrl, fake, { config = CONFIG } = {}) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 }, acceptDownloads: true, serviceWorkers: 'block' });
  const blocked = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/confluence/')) return fake.handle(route); // relais du conteneur
    if (url.hostname === '127.0.0.1' || url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
    if (url.hostname === 'generativelanguage.googleapis.com') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(SUMMARY) }] } }] }) });
    }
    if (url.hostname === CF_HOST) return fake.handle(route);
    blocked.push(url.href);
    return route.abort();
  });
  await context.addInitScript(() => { try { localStorage.setItem('voxai_onboarded', 'test'); localStorage.setItem('voxai_mail_target', 'desktop'); } catch {} });
  const page = await context.newPage();
  page.jsErrors = [];
  page.on('pageerror', e => page.jsErrors.push(e.message));
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(baseUrl);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
  await page.evaluate(c => fetch('/api/config', { method: 'POST', body: JSON.stringify(c) }), config);
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
  await page.waitForTimeout(500);
  await page.evaluate(() => { try { closeSettingsModal(); } catch {} });
  return { context, page, blocked };
}

/** Importe un enregistrement et attend l'analyse (Gemini simulé). */
async function analyse(page) {
  await page.setInputFiles('#fileUploadInput', AUDIO);
  await page.waitForFunction(() => state.activeRecording && state.activeRecording.status === 'completed', null, { timeout: 15000 });
  return page.evaluate(() => state.activeRecording.id);
}

async function openPublish(page, button = '#publishConfluenceBtn') {
  await page.click(button);
  await page.waitForSelector('#confluenceModal:not(.hidden)');
  await page.waitForFunction(() => document.querySelectorAll('#cfSpaceSelect option[value]').length > 1 || /HTTP|injoignable|refusé/.test(document.querySelector('#cfStatus').textContent), null, { timeout: 8000 });
}

async function chooseSpace(page, key) {
  await page.selectOption('#cfSpaceSelect', key);
  await page.waitForFunction(k => [...document.querySelectorAll('#cfTree .cf-select')].length > 0 || /Aucune page/.test(document.querySelector('#cfTree').textContent), key, { timeout: 8000 });
}

async function expand(page, id) {
  await page.click(`#cfTree li[data-id="${id}"] > .cf-node > .cf-toggle`);
  await page.waitForFunction(i => { const c = document.querySelector(`#cfTree li[data-id="${i}"] > .cf-children`); return c && c.dataset.loaded; }, id);
}

async function pick(page, id) {
  await page.click(`#cfTree .cf-select[data-id="${id}"]`);
}

async function publishAndWait(page) {
  await page.click('#cfPublishBtn');
  await page.waitForFunction(() => {
    const s = document.querySelector('#cfStatus');
    return !document.querySelector('#cfPublishBtn').disabled && /✓|HTTP|injoignable|refusé|Indiquez|Sélectionnez/.test(s.textContent) && !/en cours|envoi de la transcription/.test(s.textContent);
  }, null, { timeout: 10000 });
  return page.textContent('#cfStatus');
}

const recording = (page, id) => page.evaluate(i => fetch('/api/recordings/' + i).then(r => r.json()), id);
const config = (page) => page.evaluate(() => fetch('/api/config').then(r => r.json()));

// ---------------------------------------------------------------------------
// Scénarios
// ---------------------------------------------------------------------------

(async () => {
  const server = await startServer();
  const serverProxy = await startServer({ '/confluence-proxy.json': JSON.stringify({ enabled: true }) });
  const base = `http://127.0.0.1:${server.address().port}/`;
  const baseProxy = `http://127.0.0.1:${serverProxy.address().port}/`;
  const browser = await chromium.launch();
  console.log('Tests fonctionnels Confluence (navigateur)');

  await scenario('Création d’une sous-page : emplacement, contenu, étiquettes, pièce jointe vérifiée, lien enregistré', async () => {
    const fake = new FakeConfluence();
    const { context, page, blocked } = await openApp(browser, base, fake);
    const id = await analyse(page);
    await openPublish(page);
    const spaces = await page.$$eval('#cfSpaceSelect option', o => o.map(x => x.value));
    assert(spaces.length === 4, `espaces lus sur plusieurs pages de résultats : ${spaces.join(', ')}`);
    assert(spaces.indexOf('~alice') === 3, `espaces d'équipe d'abord, personnels ensuite : ${spaces.join(', ')}`);
    assert(await page.isDisabled('input[name="cfAction"][value="update"]'), '« Mettre à jour » doit être impossible à la racine de l’espace');
    await chooseSpace(page, 'PROJ');
    await pick(page, '100');
    await page.fill('#cfTitle', 'CR Point projet — 24 novembre');
    const status = await publishAndWait(page);
    assert(/Page créée/.test(status) && /jointe et vérifiée/.test(status), `statut inattendu : ${status}`);

    const [create] = fake.calls(/^POST \/content$/);
    assert(create.body.space.key === 'PROJ' && JSON.stringify(create.body.ancestors) === '[{"id":"100"}]', `emplacement : ${JSON.stringify(create.body)}`);
    assert(create.body.title === 'CR Point projet — 24 novembre', 'titre saisi non repris');
    assert(create.auth === 'Bearer pat-secret', `authentification PAT : ${create.auth}`);
    const storage = create.body.body.storage.value;
    for (const part of ['<h2>Résumé</h2><p>Lancement du projet validé.</p>', '<h2>Décisions</h2><ul><li>Budget de 120 k€ validé</li></ul>',
      '<ac:task-status>incomplete</ac:task-status><ac:task-body>Envoyer le devis — 👤 Bob — 📅 vendredi 27 novembre 2026</ac:task-body>',
      '<h2>Points clés</h2>', '<ri:attachment ri:filename="Transcription - Point projet Alpha.txt" />',
      "<p><strong>[00:05] Bob :</strong> J'envoie le devis vendredi.</p>", 'ac:name="expand"']) {
      assert(storage.includes(part), `contenu de la page : « ${part} » absent`);
    }
    const pageId = String(fake.nextId - 1);
    assert(JSON.stringify(fake.labels[pageId]) === '["voxai","projet-alpha","budget"]', `étiquettes : ${JSON.stringify(fake.labels[pageId])}`);
    const [att] = fake.attachments[pageId];
    const expectedSize = await page.evaluate(() => new Blob([VoxConfluence.transcriptText(state.activeRecording)]).size);
    assert(att.title === 'Transcription - Point projet Alpha.txt' && att.size === expectedSize, `pièce jointe : ${JSON.stringify(att)} (attendu ${expectedSize} octets)`);
    const link = await page.getAttribute('#cfStatus a', 'href');
    assert(link === `${CF_BASE}/spaces/PROJ/pages/${pageId}`, `lien proposé : ${link}`);
    const rec = await recording(page, id);
    assert(rec.confluence_page && rec.confluence_page.url === link, `lien non enregistré sur le compte rendu : ${JSON.stringify(rec.confluence_page)}`);
    const cfg = await config(page);
    assert(cfg.confluence_last_space === 'PROJ' && cfg.confluence_last_parent && cfg.confluence_last_parent.id === '100', `emplacement non mémorisé : ${JSON.stringify([cfg.confluence_last_space, cfg.confluence_last_parent])}`);

    // Réouverture : le dernier emplacement est proposé
    await page.click('#cfCloseBtn');
    await openPublish(page);
    await page.waitForSelector('#cfTree .cf-selected[data-id="100"]');
    assert(await page.inputValue('#cfSpaceSelect') === 'PROJ', 'dernier espace non proposé');
    assert(blocked.length === 0 && page.jsErrors.length === 0, `requêtes bloquées ${blocked} / erreurs ${page.jsErrors}`);
    await context.close();
  });

  await scenario('Options : sans transcription dans la page, sans pièce jointe, sans étiquettes', async () => {
    const fake = new FakeConfluence();
    const { context, page } = await openApp(browser, base, fake);
    await analyse(page);
    await openPublish(page);
    await chooseSpace(page, 'PROJ');
    await page.uncheck('#cfIncludeTranscript');
    await page.uncheck('#cfAttachTranscript');
    await page.uncheck('#cfAddLabels');
    const status = await publishAndWait(page);
    assert(/Page créée/.test(status) && !/jointe/.test(status), `statut : ${status}`);
    const [create] = fake.calls(/^POST \/content$/);
    assert(!create.body.ancestors, 'racine de l’espace : aucune page parente attendue');
    const storage = create.body.body.storage.value;
    assert(!storage.includes('<h2>Transcription</h2>') && !storage.includes('ri:attachment'), 'transcription présente malgré les options');
    assert(fake.calls(/attachment|label/).length === 0, `appels inattendus : ${fake.calls(/attachment|label/).map(c => c.method + ' ' + c.path)}`);
    await context.close();
  });

  await scenario('Mise à jour d’une page : ajout à la fin (ancien contenu conservé, version suivante)', async () => {
    const fake = new FakeConfluence();
    const { context, page } = await openApp(browser, base, fake);
    await analyse(page);
    await openPublish(page);
    await chooseSpace(page, 'PROJ');
    await expand(page, '100');
    await pick(page, '101');
    await page.check('input[name="cfAction"][value="update"]');
    assert(await page.textContent('#cfPublishBtn') === 'Mettre à jour la page', 'libellé du bouton');
    assert(await page.isChecked('input[name="cfUpdateMode"][value="append"]'), '« Ajouter à la fin » doit être le mode par défaut (pas de perte de contenu)');
    const status = await publishAndWait(page);
    assert(/Page mise à jour/.test(status), `statut : ${status}`);
    const [put] = fake.calls(/^PUT \/content\/101$/);
    assert(put.body.version.number === 8, `version envoyée : ${put.body.version.number} (attendue : 8)`);
    assert(put.body.title === 'Compte rendu existant' && put.body.space.key === 'PROJ', 'titre ou espace de la page modifiés');
    assert(fake.pages[101].body.startsWith('<p>Ancien contenu</p><hr />') && fake.pages[101].body.includes('<h2>Résumé</h2>'), `contenu : ${fake.pages[101].body.slice(0, 80)}`);
    assert(fake.calls(/^POST \/content$/).length === 0, 'une nouvelle page a été créée au lieu de mettre à jour');

    // Republier (pièce jointe déjà présente) : nouvelle version du fichier, page en version 9
    const status2 = await publishAndWait(page);
    assert(/jointe et vérifiée/.test(status2) && fake.pages[101].version === 9, `republication : ${status2}`);
    assert(fake.attachments[101].length === 1 && fake.attachments[101][0].versions === 2, `pièce jointe dupliquée : ${JSON.stringify(fake.attachments[101])}`);
    await context.close();
  });

  await scenario('Mise à jour d’une page : remplacement du contenu', async () => {
    const fake = new FakeConfluence();
    const { context, page } = await openApp(browser, base, fake);
    await analyse(page);
    await openPublish(page);
    await chooseSpace(page, 'PROJ');
    await expand(page, '100');
    await pick(page, '101');
    await page.check('input[name="cfAction"][value="update"]');
    await page.check('input[name="cfUpdateMode"][value="replace"]');
    await publishAndWait(page);
    assert(!fake.pages[101].body.includes('Ancien contenu') && fake.pages[101].body.startsWith('<p><em>Compte rendu généré par VoxAI'), `contenu : ${fake.pages[101].body.slice(0, 80)}`);
    assert(fake.pages[101].version === 8, `version : ${fake.pages[101].version}`);
    await context.close();
  });

  await scenario('Pièce jointe : repli quand l’envoi direct n’existe pas, nouvelle version d’un fichier existant', async () => {
    const fake = new FakeConfluence();
    fake.attachPut = false; // Confluence ancien : PUT …/child/attachment → 404
    fake.attachments[101] = [{ id: 'att1', title: 'Transcription - Point projet Alpha.txt', size: 5, versions: 1 }];
    const { context, page } = await openApp(browser, base, fake);
    await analyse(page);
    await openPublish(page);
    await chooseSpace(page, 'PROJ');
    await expand(page, '100');
    await pick(page, '101');
    await page.check('input[name="cfAction"][value="update"]');
    const status = await publishAndWait(page);
    assert(/jointe et vérifiée/.test(status), `statut : ${status}`);
    assert(fake.calls(/^POST \/content\/101\/child\/attachment\/att1\/data$/).length === 1, `nouvelle version via …/att1/data attendue : ${fake.calls(/attachment/).map(c => c.method + ' ' + c.path)}`);
    assert(fake.attachments[101][0].versions === 2 && fake.attachments[101][0].size > 5, 'fichier existant non mis à jour');

    // Page sans pièce jointe : création via POST …/child/attachment
    await page.click('#cfCloseBtn');
    await openPublish(page);
    await chooseSpace(page, 'PROJ');
    await page.fill('#cfTitle', 'Autre compte rendu');
    await publishAndWait(page);
    const newId = String(fake.nextId - 1);
    assert(fake.calls(new RegExp(`^POST /content/${newId}/child/attachment$`)).length === 1 && fake.attachments[newId].length === 1, 'repli de création de la pièce jointe');
    await context.close();
  });

  await scenario('Pièce jointe incomplète ou refusée : page publiée, problème signalé', async () => {
    const fake = new FakeConfluence();
    fake.wrongSize = true;
    const { context, page } = await openApp(browser, base, fake);
    const id = await analyse(page);
    await openPublish(page);
    await chooseSpace(page, 'PROJ');
    let status = await publishAndWait(page);
    assert(/Page créée/.test(status) && /n'a pas pu être jointe : taille reçue \d+ octets au lieu de \d+/.test(status), `taille incorrecte non signalée : ${status}`);
    assert((await recording(page, id)).confluence_page, 'le lien doit être enregistré : la page existe');

    fake.wrongSize = false;
    fake.fail = { 'PUT /content/\\d+/child/attachment$': { status: 413, body: { message: 'Fichier trop volumineux' } } };
    await page.fill('#cfTitle', 'Deuxième essai');
    status = await publishAndWait(page);
    assert(/Page créée/.test(status) && /Confluence \(HTTP 413\) : Fichier trop volumineux/.test(status), `erreur d’envoi non signalée : ${status}`);
    await context.close();
  });

  await scenario('Erreurs : jeton refusé, erreur Confluence, serveur injoignable', async () => {
    const fake = new FakeConfluence();
    fake.fail = { '^GET /space$': { status: 401, body: {} } };
    const { context, page } = await openApp(browser, base, fake);
    const id = await analyse(page);
    await openPublish(page);
    let status = await page.textContent('#cfStatus');
    assert(/Accès refusé par Confluence \(HTTP 401\) : vérifiez le jeton/.test(status), `401 : ${status}`);
    await page.click('#cfCloseBtn');

    fake.fail = {};
    await openPublish(page);
    await chooseSpace(page, 'PROJ');
    await page.fill('#cfTitle', 'Réunions'); // titre déjà pris dans l'espace
    status = await publishAndWait(page);
    assert(/Confluence \(HTTP 400\) : Une page porte déjà ce titre dans cet espace\./.test(status), `erreur Confluence : ${status}`);
    assert(!(await recording(page, id)).confluence_page, 'lien enregistré alors que la publication a échoué');
    assert(await page.isEnabled('#cfPublishBtn'), 'bouton resté désactivé après l’erreur');

    await page.fill('#cfTitle', '');
    status = await publishAndWait(page);
    assert(/Indiquez un titre/.test(status), `titre vide : ${status}`);

    fake.fail = { '^GET /content/101$': { status: 403, body: {} } };
    await expand(page, '100');
    await pick(page, '101');
    await page.check('input[name="cfAction"][value="update"]');
    status = await publishAndWait(page);
    assert(/Accès refusé par Confluence \(HTTP 403\)/.test(status) && fake.calls(/^PUT /).length === 0, `403 en mise à jour : ${status}`);

    // Erreurs pendant la navigation : sous-pages, recherche, arborescence
    fake.fail = { '^GET /content/102/child/page$': { status: 500, body: { message: 'Erreur interne' } }, '^GET /content/search$': { status: 500, body: { message: 'CQL invalide' } } };
    await page.click('#cfTree li[data-id="102"] > .cf-node > .cf-toggle');
    await page.waitForFunction(() => /Erreur interne/.test(document.querySelector('#cfTree li[data-id="102"] > .cf-children').textContent));
    await page.fill('#cfSearch', 'devis');
    await page.waitForFunction(() => /CQL invalide/.test(document.querySelector('#cfStatus').textContent));
    fake.fail = { '^GET /space/ARCH/content/page$': { status: 500, body: { message: 'Espace indisponible' } } };
    await page.fill('#cfSearch', '');
    await page.selectOption('#cfSpaceSelect', 'ARCH');
    await page.waitForFunction(() => /Espace indisponible/.test(document.querySelector('#cfStatus').textContent));
    await page.fill('#cfSpaceFilter', 'aucun-espace');
    assert(/Aucun espace trouvé/.test(await page.textContent('#cfSpaceSelect')), 'filtre sans résultat');
    await page.fill('#cfSpaceFilter', '');
    await chooseSpace(page, 'PROJ');
    await expand(page, '100');
    await pick(page, '101');
    await page.check('input[name="cfAction"][value="update"]');

    fake.fail = {};
    fake.down = true;
    status = await publishAndWait(page);
    assert(/Confluence injoignable .*CORS/.test(status), `serveur injoignable : ${status}`);
    assert(fake.pages[101].body === '<p>Ancien contenu</p>', 'page modifiée malgré les erreurs');
    assert(page.jsErrors.length === 0, `erreurs JavaScript : ${page.jsErrors}`);
    await context.close();
  });

  await scenario('Confluence Cloud (e-mail + jeton) et « Tester la connexion »', async () => {
    const fake = new FakeConfluence();
    const { context, page } = await openApp(browser, base, fake, { config: { ...CONFIG, confluence_auth: 'basic', confluence_email: 'élodie@corp.fr', confluence_token: 'jeton-api' } });
    await page.evaluate(() => openSettingsModal());
    await page.waitForTimeout(300);
    assert(await page.isVisible('#confluenceEmailRow'), 'champ e-mail masqué en mode Cloud');
    await page.click('#confluenceTestBtn');
    await page.waitForFunction(() => /✓|✗/.test(document.querySelector('#confluenceTestStatus').textContent));
    const ok = await page.textContent('#confluenceTestStatus');
    assert(ok.includes('Connecté en tant que Alice Martin'), `test de connexion : ${ok}`);
    const expected = 'Basic ' + Buffer.from('élodie@corp.fr:jeton-api', 'utf8').toString('base64');
    assert(fake.log[0].auth === expected, `en-tête Basic (UTF-8) : ${fake.log[0].auth} ≠ ${expected}`);

    // Jeton refusé : message d'erreur dans les paramètres
    await page.fill('#confluenceToken', 'mauvais');
    fake.fail = { '^GET /user/current$': { status: 401, body: {} } };
    await page.click('#confluenceTestBtn');
    await page.waitForFunction(() => /✗/.test(document.querySelector('#confluenceTestStatus').textContent));
    assert((await page.textContent('#confluenceTestStatus')).includes('HTTP 401'), 'refus non affiché');
    // Passage en PAT : le champ e-mail disparaît
    await page.selectOption('#confluenceAuth', 'pat');
    assert(await page.isHidden('#confluenceEmailRow'), 'champ e-mail visible en mode PAT');
    await context.close();
  });

  await scenario('Relais Confluence du conteneur : appels via /confluence/, jamais en direct', async () => {
    const fake = new FakeConfluence();
    const { context, page } = await openApp(browser, baseProxy, fake, { config: { ...CONFIG, confluence_url: '' } });
    const id = await analyse(page);
    await openPublish(page);
    assert(await page.isVisible('#cfMain'), 'Confluence considéré comme non configuré alors que le relais est actif');
    await chooseSpace(page, 'PROJ');
    const status = await publishAndWait(page);
    assert(/Page créée/.test(status), `statut : ${status}`);
    const hosts = [...new Set(fake.log.map(c => c.host))];
    assert(hosts.length === 1 && hosts[0].startsWith('127.0.0.1'), `appels hors du relais : ${hosts.join(', ')}`);
    assert((await recording(page, id)).confluence_page.url.startsWith(CF_BASE), 'lien de la page');

    fake.down = true;
    await page.fill('#cfTitle', 'Encore');
    assert(/injoignable via le proxy du conteneur/.test(await publishAndWait(page)), 'message du relais injoignable');
    await context.close();
  });

  await scenario('Non configuré : fenêtre explicative, aucun appel', async () => {
    const fake = new FakeConfluence();
    const { context, page } = await openApp(browser, base, fake, { config: { gemini_api_key: 'cle-test', confluence_url: CF_BASE, confluence_token: '' } });
    await analyse(page);
    await page.click('#publishConfluenceBtn');
    await page.waitForSelector('#confluenceModal:not(.hidden)');
    assert(await page.isVisible('#cfNotConfigured') && await page.isHidden('#cfMain') && await page.isHidden('#cfPublishBtn'), 'fenêtre « non configuré » attendue');
    await page.click('#cfOpenSettingsBtn');
    assert(await page.isHidden('#confluenceModal') && await page.isVisible('#confluenceSettings'), 'lien vers les paramètres');
    assert(fake.log.length === 0, 'appel à Confluence sans jeton');
    await context.close();
  });

  await scenario('Navigation : arborescence, recherche par titre sans injection CQL, autres espaces', async () => {
    const fake = new FakeConfluence();
    const { context, page } = await openApp(browser, base, fake);
    await analyse(page);
    await openPublish(page);
    await chooseSpace(page, 'PROJ');
    await expand(page, '100');
    const kids = await page.$$eval('#cfTree li[data-id="100"] .cf-children .cf-select', b => b.map(x => x.dataset.id));
    assert(JSON.stringify(kids) === '["101","102"]', `sous-pages : ${kids}`);
    await page.click('#cfTree li[data-id="100"] > .cf-node > .cf-toggle'); // replier
    assert(await page.isHidden('#cfTree li[data-id="100"] > .cf-children'), 'sous-pages non repliées');
    await page.click('#cfTree li[data-id="100"] > .cf-node > .cf-toggle'); // déplier : pas de second appel
    assert(fake.calls(/child\/page/).length === 1, 'sous-pages rechargées à chaque dépliage');

    // Recherche : guillemets et antislash neutralisés (pas de sortie de la requête CQL vers un autre espace)
    await page.fill('#cfSearch', 'Réunions" or space="SECRET" or title~"\\');
    await page.waitForFunction(() => document.querySelector('#cfTree').dataset.searching && !/Recherche…/.test(document.querySelector('#cfTree').textContent));
    const cql = fake.calls(/^GET \/content\/search$/).pop().query.cql;
    assert((cql.match(/"/g) || []).length === 4 && cql.startsWith('space="PROJ" and type=page and title~"'), `requête CQL : ${cql}`);
    await page.fill('#cfSearch', 'réunions 2025');
    await page.waitForFunction(() => document.querySelectorAll('#cfTree .cf-select').length === 1);
    await pick(page, '102');
    assert((await page.textContent('#cfTargetLabel')).includes('Réunions 2025'), 'page trouvée non sélectionnée');
    await page.fill('#cfSearch', 'zzz-introuvable');
    await page.waitForFunction(() => /Aucune page ne correspond/.test(document.querySelector('#cfTree').textContent));
    await page.fill('#cfSearch', '');
    await page.waitForFunction(() => !document.querySelector('#cfTree').dataset.searching && document.querySelector('#cfTree .cf-select[data-id="100"]'));

    // Filtre des espaces et autre espace
    await page.fill('#cfSpaceFilter', 'arch');
    assert(JSON.stringify(await page.$$eval('#cfSpaceSelect option', o => o.map(x => x.value))) === '["ARCH"]', 'filtre des espaces');
    await chooseSpace(page, 'ARCH');
    assert(await page.$$eval('#cfTree .cf-select', b => b.map(x => x.dataset.id).join()) === '200', 'pages de l’espace ARCH');
    await page.click('#cfRootBtn');
    assert((await page.textContent('#cfTargetLabel')).includes("Racine de l'espace ARCH"), 'retour à la racine');
    await context.close();
  });

  await scenario('Série : choix de la page parente, puis « Publier et envoyer » (e-mail avec le lien)', async () => {
    const fake = new FakeConfluence();
    const { context, page } = await openApp(browser, base, fake);
    // Choix de la page parente depuis la fiche d'une nouvelle série
    await page.click('#seriesManageBtn');
    await page.waitForSelector('#seriesModal:not(.hidden)');
    await page.waitForTimeout(400); // fin du chargement de la liste (sinon la fiche se referme)
    await page.click('#seriesNewBtn');
    await page.click('#seriesParentPick');
    await page.waitForFunction(() => document.querySelectorAll('#cfSpaceSelect option[value]').length > 1);
    assert((await page.textContent('#cfModalTitle')).includes('Choisir la page Confluence de la série') && await page.isHidden('#cfActionBlock'), 'mode « choix de page »');
    // Annuler avec Échap : rien n'est choisi, la fiche de la série en cours de saisie reste ouverte
    await page.fill('#seriesName', 'Série en cours de saisie');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert(await page.isHidden('#confluenceModal'), 'Échap n’a pas fermé le choix de page');
    assert(await page.isVisible('#seriesForm') && await page.inputValue('#seriesName') === 'Série en cours de saisie', 'Échap a aussi fermé la fiche de la série (saisie perdue)');
    assert((await page.textContent('#seriesParentLabel')).startsWith('Aucune'), 'annulation non respectée');
    await page.click('#seriesParentPick');
    await page.waitForFunction(() => document.querySelectorAll('#cfSpaceSelect option[value]').length > 1);
    await chooseSpace(page, 'PROJ');
    await page.click('#cfPublishBtn'); // racine : refusée
    assert(/Choisissez une page/.test(await page.textContent('#cfStatus')), 'racine acceptée comme page parente');
    await pick(page, '100');
    assert(await page.textContent('#cfPublishBtn') === 'Choisir cette page', 'libellé du bouton');
    await page.click('#cfPublishBtn');
    await page.waitForFunction(() => document.querySelector('#seriesParentLabel').textContent.includes('Réunions'));
    assert((await page.textContent('#seriesParentLabel')) === 'Réunions (espace PROJ)', 'page parente affichée');
    assert(fake.calls(/^(POST|PUT) /).length === 0, 'le choix de page ne doit rien publier');

    // Série enregistrée (avec participants) puis compte rendu rattaché
    const series = await page.evaluate(() => fetch('/api/series', { method: 'POST', body: JSON.stringify({ name: 'Point Alpha', participants: [{ name: 'Alice', email: 'alice@corp.fr' }, { name: 'Bob', email: 'bob@corp.fr' }], confluence_parent: { spaceKey: 'PROJ', id: '100', title: 'Réunions' } }) }).then(r => r.json()));
    await page.evaluate(id => localStorage.setItem('voxai_last_series', id), series.id);
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    await page.waitForTimeout(400);
    await page.evaluate(() => { try { closeSettingsModal(); } catch {} });
    const id = await analyse(page);
    await openPublish(page, '#publishSendBtn');
    await page.waitForSelector('#cfTree .cf-selected[data-id="100"]');
    assert((await page.textContent('#cfModalTitle')).includes('puis envoyer aux participants'), 'titre « Publier et envoyer »');
    assert((await page.inputValue('#cfTitle')).startsWith('Point Alpha — '), `titre proposé : ${await page.inputValue('#cfTitle')}`);
    assert(await page.textContent('#cfPublishBtn') === 'Créer la page puis créer l’e-mail', 'libellé du bouton');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#cfPublishBtn')]);
    const eml = fs.readFileSync(await download.path(), 'utf8');
    const pageId = String(fake.nextId - 1);
    const url = `${CF_BASE}/spaces/PROJ/pages/${pageId}`;
    const decoded = eml.split(/\r?\n\r?\n/).map(part => { try { return Buffer.from(part.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { return ''; } }).join('\n') + eml;
    assert(/^To: .*alice@corp\.fr.*bob@corp\.fr/m.test(eml), `destinataires : ${(eml.match(/^To: .*$/m) || [''])[0]}`);
    assert(decoded.includes(url), 'lien de la page Confluence absent de l’e-mail');
    assert(JSON.stringify(fake.calls(/^POST \/content$/)[0].body.ancestors) === '[{"id":"100"}]', 'page non créée sous la page de la série');
    assert(fake.labels[pageId].includes('point-alpha'), `étiquette de la série : ${fake.labels[pageId]}`);
    assert((await recording(page, id)).confluence_page.url === url, 'lien non enregistré');

    // « Publier » seul ensuite : n'enchaîne plus l'e-mail
    await page.click('#cfCloseBtn');
    await openPublish(page);
    assert(await page.textContent('#cfPublishBtn') === 'Créer la page', '« Publier » a hérité de « Publier et envoyer »');
    await page.click('#cfCloseBtn');

    // Outlook Web : l'onglet ne s'ouvre qu'au clic sur le bouton proposé après la publication
    await page.evaluate(() => localStorage.setItem('voxai_mail_target', 'web'));
    await openPublish(page, '#publishSendBtn');
    await page.waitForSelector('#cfTree .cf-selected[data-id="100"]');
    await page.fill('#cfTitle', 'Point Alpha — bis');
    let popups = 0;
    context.on('page', () => popups++);
    await page.click('#cfPublishBtn');
    await page.waitForSelector('#cfAfterBtn', { timeout: 10000 });
    assert(popups === 0, 'onglet ouvert sans clic de l’utilisateur (bloqué par le navigateur)');
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }), page.click('#cfAfterBtn')]);
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    assert(await page.isHidden('#confluenceModal'), 'fenêtre restée ouverte après le clic');
    await context.close();
  });

  await scenario('Contenu de la page : suivi des actions, actions terminées, plusieurs fichiers, étiquettes', async () => {
    const fake = new FakeConfluence();
    const { context, page } = await openApp(browser, base, fake);
    const out = await page.evaluate(() => {
      const rec = {
        title: 'Point', created_at: '2026-11-24T09:00:00.000Z', duration: 754,
        files: [{ original_name: 'salle.wav' }, { original_name: 'visio.wav' }],
        transcription: [{ file_index: 2, speaker: 'Chloé', timestamp: '01:02', text: 'Planning fait.' }],
        summary: {
          executive: 'R', decisions: ['Texte simple', { text: 'Objet' }],
          action_items: [{ task: 'Fait', status: 'done' }, { task: 'Sans échéance', assignee: 'Chloé', deadline: 'À définir' }],
          action_followup: [{ task: 'Réserver la salle', assignee: 'Alice', status: 'in_progress', note: 'pas encore' }, { task: 'Devis', status: 'done' }, { status: 'done' }],
          key_points: [{ text: 'Point objet' }], tags: ['Équipe Été', 'a b', '!!!', 'Équipe été']
        }
      };
      return {
        storage: VoxConfluence.buildStorage(rec, { includeTranscript: true, attachTranscript: true }),
        noTranscript: VoxConfluence.buildStorage(rec, { includeTranscript: false, attachTranscript: false }),
        labels: VoxConfluence.labelsFor(rec, { name: 'Comité de pilotage' }),
        file: VoxConfluence.transcriptText(rec)
      };
    });
    for (const part of ['12:34', '2 fichiers audio', '<li>Texte simple</li><li>Objet</li>',
      '<ac:task-status>complete</ac:task-status><ac:task-body>Fait</ac:task-body>', 'Sans échéance — 👤 Chloé — 📅 À définir',
      '<h2>Suivi des actions précédentes</h2><ul><li>🔄 En cours — Réserver la salle (👤 Alice) : pas encore</li><li>✅ Terminée — Devis</li></ul>',
      '<li>Point objet</li>', '[Piste 2 • 01:02] Chloé :']) {
      assert(out.storage.includes(part), `contenu : « ${part} » absent`);
    }
    assert(!out.noTranscript.includes('Transcription'), 'transcription présente sans l’option');
    assert(JSON.stringify(out.labels) === '["voxai","comité-de-pilotage","équipe-été","a-b"]', `étiquettes : ${JSON.stringify(out.labels)}`);
    assert(out.file.startsWith('﻿Transcription intégrale — Point') && out.file.includes('piste 2 = visio.wav') && out.file.includes('\r\n[Piste 2 • 01:02] Chloé : Planning fait.\r\n'), 'fichier de transcription');
    await context.close();
  });

  await browser.close();
  server.close();
  serverProxy.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scénarios réussis`);
  process.exit(failed.length ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
