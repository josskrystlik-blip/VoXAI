/**
 * VoxAI — tests de sécurité dans le navigateur (Playwright, Chromium).
 *
 * Chaque scénario injecte des charges malveillantes partout où des données externes
 * entrent dans l'application (fichier de sauvegarde, réponses de l'IA, noms d'orateurs,
 * Confluence, e-mails) et vérifie :
 *   - qu'aucun élément HTML n'est injecté dans la page (échappement) ;
 *   - qu'aucun code ne s'exécute (window.__xss, boîtes de dialogue) ;
 *   - que la page ne plante pas (erreurs JavaScript) ;
 *   - que la politique de sécurité (CSP) bloque bien les scripts en ligne et eval().
 *
 * Aucun accès Internet : Gemini et Confluence sont simulés, toute autre requête est bloquée
 * et comptée comme un échec.
 *
 * Lancement : node tests/security/browser.test.js   (Playwright doit être disponible)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const AUDIO = path.join(__dirname, 'fixtures', 'silence.wav');

// Charges d'attaque : balises, sortie d'attribut, gestionnaires d'événements, URL javascript:
const XSS = `"><img src=x data-xss onerror="window.__xss=(window.__xss||0)+1">`;
const XSS2 = `<svg data-xss onload="window.__xss=(window.__xss||0)+1"></svg>`;
const XSS_ATTR = `' onmouseover='window.__xss=1' data-xss='`;
const XML_INJECT = `</p><ac:structured-macro ac:name="html"><ac:plain-text-body><![CDATA[<script>alert(1)</script>]]></ac:plain-text-body></ac:structured-macro><p>`;

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

/** Contexte navigateur isolé, Internet bloqué, Gemini / Confluence simulés. */
async function openApp(browser, baseUrl, { gemini, confluence, servers = {} } = {}) {
  // Service worker (PWA) désactivé : les requêtes restent visibles et simulables par les tests
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 }, acceptDownloads: true, serviceWorkers: 'block' });
  const blocked = [];
  const geminiUrls = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
    if (url.hostname === 'generativelanguage.googleapis.com' && gemini) {
      geminiUrls.push(route.request().url());
      const body = JSON.parse(route.request().postData() || '{}');
      const text = await gemini(body, route.request());
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) });
    }
    if (url.hostname === 'confluence.test' && confluence) return confluence(route);
    if (servers[url.hostname]) return servers[url.hostname](route);
    blocked.push(url.href);
    return route.abort();
  });
  // L'assistant de démarrage (premier lancement) ne doit pas masquer l'interface testée
  await context.addInitScript(() => { try { localStorage.setItem('voxai_onboarded', 'test'); } catch {} });
  const page = await context.newPage();
  page.jsErrors = [];
  page.dialogs = [];
  page.on('pageerror', e => page.jsErrors.push(e.message));
  page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  await page.goto(baseUrl);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
  await page.waitForTimeout(800); // ouverture automatique éventuelle des réglages
  await page.evaluate(() => { try { closeSettingsModal(); } catch {} });
  return { context, page, blocked, geminiUrls };
}

/** Vérifications communes : rien d'injecté, rien d'exécuté, aucune erreur. */
async function assertClean(page, where) {
  const injected = await page.evaluate(() => document.querySelectorAll('[data-xss], img[src="x"], svg[onload], [onmouseover], [onerror]').length);
  const executed = await page.evaluate(() => window.__xss);
  assert(injected === 0, `${where} : ${injected} élément(s) HTML injecté(s) dans la page`);
  assert(executed === undefined, `${where} : code injecté exécuté (window.__xss=${executed})`);
  assert(page.dialogs.length === 0, `${where} : boîte de dialogue inattendue (${page.dialogs.join(' | ')})`);
  assert(page.jsErrors.length === 0, `${where} : erreur(s) JavaScript : ${page.jsErrors.join(' | ')}`);
}

/** Fichier .voxai malveillant (même format que l'export). */
function maliciousBackup() {
  const id = 'rec_evil_1';
  const audio = fs.readFileSync(AUDIO);
  const manifest = {
    app: 'VoxAI', version: 1,
    recordings: [
      {
        id, title: `Réunion ${XSS}`, created_at: XSS, duration: XSS, status: XSS, filename: 'x.wav',
        transcription: [
          { file_index: `1"><img src=x data-xss onerror="window.__xss=1">`, file_name: XSS, speaker: XSS2, timestamp: `00:00"><img src=x data-xss onerror="window.__xss=1">`, text: XSS },
          { file_index: { evil: true }, speaker: { toString: 1 }, timestamp: 42, text: ['tableau'] },
          null, 'texte brut'
        ],
        summary: {
          executive: XSS, executive_refs: ['1', XSS, 999],
          key_points: [XSS, { text: XSS2, refs: [XSS] }, 42, null],
          decisions: [{ text: XSS_ATTR }],
          action_items: [{ task: XSS, assignee: XSS2, deadline: XSS_ATTR, status: XSS, refs: [1] }, { task: { o: 1 } }],
          tags: [XSS, { o: 1 }, 7]
        },
        live_transcript: XSS
      },
      { id: '../../evil', title: 'identifiant invalide' },
      { id: { o: 1 }, title: 'identifiant objet' },
      'pas un objet'
    ],
    files: [
      { recording_id: id, filename: 'rec_evil_1_a.wav', original_name: XSS, mime_type: 'audio/wav', type: 'audio/wav', offset: 0, size: audio.length, duration: 3 },
      { recording_id: id, filename: '../../../etc/passwd', type: 'text/html', offset: 0, size: 10 },
      { recording_id: id, filename: 'neg.wav', offset: -5, size: 10 }
    ],
    chat: [
      { recording_id: id, role: 'assistant', content: `${XSS}\n**gras** ${XSS2}` },
      { recording_id: id, role: 'system', content: 'rôle non autorisé' },
      { recording_id: 'autre', role: 'user', content: 'autre enregistrement' }
    ]
  };
  const json = Buffer.from(JSON.stringify(manifest));
  return Buffer.concat([Buffer.from(`VOXAI-BACKUP 1\n${json.length}\n`), json, audio]);
}

// ---------------------------------------------------------------------------
// Scénarios
// ---------------------------------------------------------------------------

(async () => {
  const defaultsCloudOff = JSON.stringify({ config: { provider: 'local', local_llm_url: 'http://127.0.0.1:9/v1' }, policy: { disable_cloud: true } });
  const server = await startServer();
  const serverPolicy = await startServer({ '/voxai-defaults.json': defaultsCloudOff });
  const base = `http://127.0.0.1:${server.address().port}/`;
  const basePolicy = `http://127.0.0.1:${serverPolicy.address().port}/`;
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'voxai-sec-'));
  console.log('Tests de sécurité VoxAI (navigateur)');

  await scenario('Sauvegarde .voxai malveillante : rien d’injecté, données invalides écartées', async () => {
    const { context, page, blocked } = await openApp(browser, base);
    const file = path.join(tmp, 'evil.voxai');
    fs.writeFileSync(file, maliciousBackup());
    await page.evaluate(() => openSettingsModal());
    await page.setInputFiles('#backupImportInput', file);
    await page.waitForTimeout(800);
    const recs = await page.evaluate(() => fetch('/api/recordings').then(r => r.json()));
    assert(recs.length === 1 && recs[0].id === 'rec_evil_1', `seul l'enregistrement valide doit être importé (reçu ${recs.map(r => r.id).join(', ')})`);
    const rec = await page.evaluate(() => fetch('/api/recordings/rec_evil_1').then(r => r.json()));
    assert(rec.transcription.every(s => /^[\d:.]+$/.test(s.timestamp) && Number.isInteger(s.file_index)), 'horodatages / pistes non normalisés');
    assert(rec.files.length === 1, `fichiers invalides importés (${rec.files.map(f => f.filename).join(', ')})`);
    assert(rec.chat_history.every(m => ['user', 'assistant'].includes(m.role)), 'rôle de discussion non autorisé importé');
    assert(rec.summary.executive_refs.every(n => Number.isInteger(n)), 'références non numériques conservées');
    await page.evaluate(() => closeSettingsModal());
    await page.evaluate(() => selectRecording('rec_evil_1'));
    for (const tab of ['summary', 'transcript', 'chat']) {
      await page.evaluate(t => switchTab(t), tab);
      await page.waitForTimeout(150);
      await assertClean(page, `onglet ${tab}`);
    }
    await page.evaluate(() => switchTab('transcript'));
    await page.fill('#searchTranscript', XSS);
    await page.waitForTimeout(150);
    await page.click('#assistantToggleBtn');
    await page.waitForTimeout(300);
    await page.hover('#detailTitle').catch(() => {});
    await assertClean(page, 'après import');
    assert((await page.textContent('#detailTitle')).includes('<img'), 'le titre doit s’afficher comme du texte');
    assert(blocked.length === 0, `requêtes externes : ${blocked.join(', ')}`);
    await context.close();
  });

  await scenario('Réponses de l’IA malveillantes (analyse) : affichées comme du texte', async () => {
    const analysis = {
      title: `Titre ${XSS}`,
      transcription: [{ file_index: XSS, speaker: XSS2, timestamp: XSS, text: XSS, file_name: XSS }, { speaker: 'Bob', timestamp: '00:02', text: 'ok' }],
      summary: { executive: XSS, executive_refs: [1], key_points: [{ text: XSS, refs: [1] }], decisions: [XSS_ATTR], action_items: [{ task: XSS, assignee: XSS2, deadline: XSS, refs: [2] }], tags: [XSS2] }
    };
    const { context, page } = await openApp(browser, base, { gemini: () => JSON.stringify(analysis) });
    await page.evaluate(() => fetch('/api/config', { method: 'POST', body: JSON.stringify({ gemini_api_key: 'test-key' }) }));
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForFunction(() => document.querySelector('#detailTitle').textContent.includes('Titre'), null, { timeout: 15000 });
    for (const tab of ['summary', 'transcript']) { await page.evaluate(t => switchTab(t), tab); await page.waitForTimeout(150); }
    await page.click('#summaryDecisions .ref-chip, #summaryExecutive .ref-chip').catch(() => {});
    await assertClean(page, 'analyse IA');
    const stored = await page.evaluate(() => state.activeRecording.transcription[0]);
    assert(stored.timestamp === '00:00' && stored.file_index === 1, 'la réponse de l’IA doit être normalisée avant stockage');
    await context.close();
  });

  await scenario('Réponses de l’IA malveillantes (assistant + correction de synthèse)', async () => {
    let recId = null;
    const { context, page } = await openApp(browser, base, {
      gemini: (body) => {
        if (body.contents[0].parts.some(p => p.inline_data)) {
          return JSON.stringify({ title: 'Réunion', transcription: [{ speaker: 'A', timestamp: '00:00', text: 'ok' }], summary: { executive: 'ok', key_points: [], decisions: [], action_items: [], tags: [] } });
        }
        return `${XSS}\n- **liste** ${XSS2}\n[lien](javascript:window.__xss=1)\n\nObjet : ${XSS}\n\n` +
          '```voxai-summary\n' + JSON.stringify({ recording_id: recId, title: `T ${XSS}`, summary: { executive: XSS, decisions: [{ text: XSS2, refs: ['x', 1] }], action_items: [{ task: XSS, assignee: XSS_ATTR }], key_points: [], tags: [XSS] } }) + '\n```';
      }
    });
    await page.evaluate(() => fetch('/api/config', { method: 'POST', body: JSON.stringify({ gemini_api_key: 'test-key' }) }));
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForFunction(() => document.querySelector('#detailTitle').textContent === 'Réunion', null, { timeout: 15000 });
    recId = await page.evaluate(() => state.activeRecording.id);
    await page.evaluate(() => switchTab('chat'));
    await page.fill('#chatInput', 'Corrige la synthèse');
    await page.press('#chatInput', 'Enter');
    await page.waitForSelector('#chatMessages .proposal-apply', { timeout: 10000 });
    await assertClean(page, 'proposition affichée');
    await page.click('#chatMessages .proposal-apply');
    await page.waitForTimeout(500);
    await page.evaluate(() => switchTab('summary'));
    await assertClean(page, 'correction appliquée');
    const hrefs = await page.$$eval('#chatMessages a', as => as.map(a => a.getAttribute('href')));
    assert(!hrefs.some(h => /^\s*javascript:/i.test(h || '')), 'lien javascript: créé dans le chat');
    await page.click('#assistantToggleBtn');
    await page.fill('#assistantInput', 'question');
    await page.press('#assistantInput', 'Enter');
    await page.waitForTimeout(800);
    await assertClean(page, 'assistant global');
    await context.close();
  });

  await scenario('Renommage d’orateur avec un nom malveillant', async () => {
    const { context, page } = await openApp(browser, base, {
      gemini: () => JSON.stringify({ title: 'R', transcription: [{ speaker: 'Orateur 1', timestamp: '00:00', text: 'Bonjour Orateur 1' }], summary: { executive: 'Orateur 1 parle', key_points: [], decisions: [], action_items: [{ task: 't', assignee: 'Orateur 1' }], tags: [] } })
    });
    await page.evaluate(() => fetch('/api/config', { method: 'POST', body: JSON.stringify({ gemini_api_key: 'test-key' }) }));
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForFunction(() => document.querySelector('#detailTitle').textContent === 'R', null, { timeout: 15000 });
    await page.evaluate(() => switchTab('transcript'));
    page.removeAllListeners('dialog');
    page.once('dialog', d => d.accept(XSS));
    await page.click('#speakersBar .speaker-rename-btn');
    await page.waitForTimeout(500);
    page.on('dialog', d => { page.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    await page.evaluate(() => switchTab('summary'));
    await assertClean(page, 'renommage');
    await context.close();
  });

  await scenario('Confluence : titres malveillants, lien javascript:, injection XML dans la page', async () => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const created = [];
    const confluence = async route => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const send = (o) => route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
      if (url.pathname.endsWith('/user/current')) return send({ displayName: XSS });
      if (url.pathname.endsWith('/space')) return send({ results: [{ key: 'EV', name: XSS, type: 'global' }], _links: {} });
      if (url.pathname.includes('/content/page')) return send({ results: [{ id: '1', title: XSS2 }, { id: '2', title: XSS_ATTR }] });
      if (url.pathname.endsWith('/child/attachment') && req.method() === 'GET') return send({ results: [] });
      if (url.pathname.endsWith('/child/attachment')) return send({ results: [{ id: 'a1' }] });
      if (url.pathname.endsWith('/rest/api/content') && req.method() === 'POST') {
        created.push(JSON.parse(req.postData()));
        return send({ id: '9', title: XSS, _links: { base: 'javascript:window.__xss=1//', webui: '/x' } });
      }
      if (url.pathname.endsWith('/label')) return send({});
      return send({ results: [] });
    };
    const { context, page } = await openApp(browser, base, {
      confluence,
      gemini: () => JSON.stringify({ title: `Titre ${XML_INJECT}`, transcription: [{ speaker: XML_INJECT, timestamp: '00:00', text: XML_INJECT }], summary: { executive: XML_INJECT, key_points: [XML_INJECT], decisions: [XML_INJECT], action_items: [{ task: XML_INJECT, assignee: XML_INJECT }], tags: ['t'] } })
    });
    await page.evaluate(() => fetch('/api/config', { method: 'POST', body: JSON.stringify({ gemini_api_key: 'k', confluence_url: 'https://confluence.test', confluence_token: 'pat', confluence_auth: 'pat' }) }));
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForFunction(() => document.querySelector('#detailTitle').textContent.startsWith('Titre'), null, { timeout: 15000 });
    await page.click('#publishConfluenceBtn');
    await page.waitForSelector('#cfTree .cf-select', { timeout: 8000 });
    await assertClean(page, 'arborescence Confluence');
    await page.click('#cfPublishBtn');
    await page.waitForFunction(() => /créée|HTTP|⚠️/.test(document.querySelector('#cfStatus').textContent), null, { timeout: 8000 });
    await assertClean(page, 'publication Confluence');
    const links = await page.$$eval('#cfStatus a', as => as.map(a => a.getAttribute('href')));
    assert(links.length === 0, `lien non http(s) proposé : ${links.join(', ')}`);
    const storage = created[0].body.storage.value;
    assert(!/<ac:structured-macro ac:name="html"/.test(storage), 'macro HTML injectée dans la page Confluence (injection XML)');
    assert(!/<script/i.test(storage), 'balise <script> brute dans la page Confluence');
    await context.close();
  });

  await scenario('Séries : noms piégés et adresses e-mail malveillantes', async () => {
    const { context, page } = await openApp(browser, base, {
      gemini: () => JSON.stringify({ title: 'R', transcription: [{ speaker: XSS, timestamp: '00:00', text: 'ok' }], summary: { executive: 'ok', decisions: [], action_items: [], key_points: [], tags: [] } })
    });
    await page.evaluate(() => fetch('/api/config', { method: 'POST', body: JSON.stringify({ gemini_api_key: 'test-key' }) }));
    const created = await page.evaluate(x => fetch('/api/series', { method: 'POST', body: JSON.stringify({
      name: `Série ${x.XSS}`, type: x.XSS,
      participants: [
        { name: x.XSS2, email: 'bob@corp.fr\r\nBcc: espion@exemple.com', aliases: ['Orateur 3', x.XSS] },
        { name: 'Alice', email: 'alice@corp.fr' },
        { name: 'alice', email: 'doublon@corp.fr' }
      ],
      confluence_parent: { spaceKey: '"><img src=x>', id: '1 OR 1=1', title: x.XSS }
    }) }).then(r => r.json()), { XSS, XSS2 });
    assert(created.type === 'weekly', `type non validé : ${created.type}`);
    assert(created.participants.length === 2, `doublon de participant accepté (${created.participants.length})`);
    assert(created.participants[0].email === '', `adresse piégée conservée : ${JSON.stringify(created.participants[0].email)}`);
    assert(!created.participants[0].aliases.includes('Orateur 3'), 'alias générique « Orateur N » mémorisé');
    assert(created.confluence_parent === null, 'page Confluence parente invalide acceptée');
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    await page.waitForTimeout(600);
    await page.selectOption('#seriesSelect', created.id);
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForFunction(() => state.activeRecording && state.activeRecording.status === 'completed', null, { timeout: 15000 });
    await page.evaluate(() => switchTab('transcript'));
    await page.click('#seriesManageBtn');
    await page.click(`#seriesList .series-item[data-id="${created.id}"]`);
    await page.waitForTimeout(300);
    await assertClean(page, 'séries (fenêtre, sélecteurs, enregistrement)');
    const eml = await page.evaluate(() => buildEml({ subject: 'CR', body: 'x', to: ['ok@corp.fr', 'bob@corp.fr\r\nBcc: espion@exemple.com', 'a@b.fr, c@d.fr'] }));
    const headers = eml.split('\r\n\r\n')[0].split('\r\n');
    assert(!headers.some(h => /^Bcc:/i.test(h)), `en-tête injecté par un destinataire : ${headers.join(' | ')}`);
    assert(headers.includes('To: ok@corp.fr'), `destinataires inattendus : ${headers.find(h => h.startsWith('To:'))}`);
    const mailto = await page.evaluate(() => mailtoUrl({ subject: 'CR', body: 'x', to: ['ok@corp.fr', 'x@y.fr?bcc=espion@exemple.com'] }).url);
    assert(!/bcc/i.test(mailto), `paramètre injecté dans le lien mailto : ${mailto}`);
    await context.close();
  });

  await scenario('Suivi des actions (phase 2) : réponses de l’IA et suivi piégés', async () => {
    let n = 0;
    const { context, page } = await openApp(browser, base, {
      gemini: () => JSON.stringify(n++ === 0
        ? { title: 'R1', transcription: [{ speaker: 'A', timestamp: '00:00', text: 'ok' }], summary: { executive: XSS, decisions: [{ text: XSS2 }], key_points: [], tags: [],
            action_items: [{ task: XSS, assignee: XSS2, deadline: XSS_ATTR, refs: [1] }, { task: 'Action saine', assignee: 'Bob' }] } }
        : { title: 'R2', transcription: [{ speaker: 'A', timestamp: '00:00', text: 'ok' }], summary: { executive: 'ok', decisions: [], key_points: [], tags: [], action_items: [],
            action_followup: [
              { id: 'A1', status: XSS, note: XSS, refs: [XSS, 1] },
              { id: 'A2', status: 'done', note: XSS2, rec_id: '../../evil', index: -1 },
              { id: XSS, status: 'done' }, { id: 'A99', status: 'done' }, 'texte', null] } })
    });
    await page.evaluate(() => fetch('/api/config', { method: 'POST', body: JSON.stringify({ gemini_api_key: 'test-key' }) }));
    const series = await page.evaluate(() => fetch('/api/series', { method: 'POST', body: JSON.stringify({ name: 'Suivi', participants: [{ name: 'Bob', email: 'bob@corp.fr' }] }) }).then(r => r.json()));
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    await page.waitForTimeout(600);
    await page.selectOption('#seriesSelect', series.id);
    for (let i = 0; i < 2; i++) {
      await page.setInputFiles('#fileUploadInput', AUDIO);
      // Réunion 1 : résumé piégé ; réunion 2 : « ok »
      await page.waitForFunction(expected => state.activeRecording && state.activeRecording.status === 'completed'
        && state.activeRecording.summary && state.activeRecording.summary.executive === expected, i === 0 ? XSS : 'ok', { timeout: 15000 });
      await page.waitForTimeout(1100);
    }
    const rec = await page.evaluate(() => state.activeRecording);
    const fu = rec.summary.action_followup || [];
    assert(fu.length === 2, `suivi : ${fu.length} élément(s) au lieu de 2 (identifiants inconnus ou piégés acceptés)`);
    assert(fu.every(f => f.rec_id !== '../../evil' && f.index >= 0), 'référence d’action fournie par l’IA acceptée telle quelle');
    assert(fu[0].status === 'in_progress', `statut non validé : ${fu[0].status}`);
    // Suivi falsifié via une correction de synthèse : références invalides écartées
    const corrected = await page.evaluate(x => fetch(`/api/recordings/${x.id}/summary`, { method: 'POST', body: JSON.stringify({ summary: { executive: 'ok', action_items: [],
      action_followup: [{ rec_id: '../x', index: 0, task: 'a' }, { rec_id: x.id, index: '1', task: 'b' }, { rec_id: x.id, index: 2, task: x.XSS, note: x.XSS, status: x.XSS }] } }) }).then(r => r.json()), { id: rec.id, XSS });
    assert(corrected.summary.action_followup.length === 1 && corrected.summary.action_followup[0].status === 'in_progress',
      `suivi falsifié accepté : ${JSON.stringify(corrected.summary.action_followup)}`);
    await page.evaluate(id => selectRecording(id), rec.id);
    await page.waitForTimeout(500);
    await page.click('#seriesFollowBtn');
    await page.waitForTimeout(500);
    await page.check('#followShowDone');
    await page.click('#followTabBrief');
    await page.waitForTimeout(500);
    await assertClean(page, 'suivi des actions (synthèse, fenêtre de suivi, brief)');
    await context.close();
  });

  await scenario('100 % sur site : aucune requête vers Google, même avec une clé Gemini enregistrée', async () => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const calls = { llm: 0, whisper: 0 };
    const reply = (route, body) => route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const { context, page, geminiUrls } = await openApp(browser, base, {
      gemini: () => { throw new Error('Gemini ne doit pas être appelé'); },
      servers: {
        'llm.corp.test': (route) => { calls.llm++; return reply(route, { choices: [{ message: { content: JSON.stringify({ title: 'R', summary: { executive: 'sur site', decisions: [], key_points: [], tags: [], action_items: [] } }) } }] }); },
        'whisper.corp.test': (route) => { calls.whisper++; return reply(route, { text: 'bonjour' }); }
      }
    });
    await page.evaluate(() => { localStorage.setItem('voxai_onboarded', '1'); return fetch('/api/config', { method: 'POST', body: JSON.stringify({
      provider: 'local', local_llm_url: 'https://llm.corp.test/v1', local_llm_model: 'gpt-oss-120b',
      on_prem_stt_url: 'https://whisper.corp.test/v1', gemini_api_key: 'cle-gemini-presente' }) }); });
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    await page.waitForTimeout(600);
    assert(await page.isDisabled('#liveToggle'), 'transcription en direct (audio vers Google / Microsoft) disponible en mode 100 % sur site');
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForFunction(() => state.activeRecording && state.activeRecording.status !== 'processing' && state.activeRecording.summary, null, { timeout: 15000 });
    assert(geminiUrls.length === 0, `requête(s) vers Google : ${geminiUrls.join(' | ')}`);
    assert(calls.whisper >= 1 && calls.llm >= 1, `serveurs internes non utilisés (Whisper ${calls.whisper}, LLM ${calls.llm})`);
    await context.close();
  });

  await scenario('Clé du LLM jamais envoyée à un autre serveur (Whisper)', async () => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const auth = { llm: [], whisper: [] };
    const record = (who, route) => { if (route.request().method() !== 'OPTIONS') auth[who].push(route.request().headers().authorization || ''); };
    const { context, page } = await openApp(browser, base, {
      servers: {
        'llm.corp.test': (route) => { record('llm', route); return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'pong' } }] }) }); },
        // Serveur Whisper au CORS minimal (pas d'Access-Control-Allow-Headers) : doit fonctionner sans clé
        'whisper.corp.test': (route) => route.request().method() === 'OPTIONS'
          ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
          : (record('whisper', route), route.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"text":""}' }))
      }
    });
    const test = (cfg) => page.evaluate(c => fetch('/api/test-connection', { method: 'POST', body: JSON.stringify(c) }).then(r => r.json()), cfg);
    const cfg = { provider: 'local', local_stt_mode: 'local', local_llm_url: 'https://llm.corp.test/v1', local_llm_model: 'm', local_llm_api_key: 'cle-llm-secrete', on_prem_stt_url: 'https://whisper.corp.test/v1' };
    const r = await test(cfg);
    assert(r.success, `test de connexion en échec : ${r.message}`);
    assert(auth.whisper.length === 1 && !auth.whisper.some(h => h.includes('cle-llm-secrete')), `clé du LLM envoyée au serveur Whisper : ${JSON.stringify(auth.whisper)}`);
    // Même serveur pour le LLM et Whisper : la clé du LLM est réutilisée
    await test({ ...cfg, on_prem_stt_url: 'https://llm.corp.test/v1' });
    assert(auth.llm.filter(h => h === 'Bearer cle-llm-secrete').length === 3, `clé non réutilisée sur le même serveur : ${JSON.stringify(auth.llm)}`);
    await context.close();
  });

  await scenario('E-mail long via la messagerie par défaut : jamais de message vide', async () => {
    const { context, page } = await openApp(browser, base);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const res = await page.evaluate(async () => {
      const steps = [];
      const write = navigator.clipboard.write.bind(navigator.clipboard);
      navigator.clipboard.write = (items) => { steps.push('copie'); return write(items); };
      window.launchMailto = (url) => steps.push('ouverture:' + url);
      const body = 'Bonjour à tous,\n\n' + 'Compte rendu détaillé enrichi par l’assistant. '.repeat(60);
      await openInMailClient({ subject: 'CR', body, to: ['alice@corp.fr'] }, 'mailto');
      return { steps, clip: await navigator.clipboard.readText() };
    });
    const open = res.steps.findIndex(s => s.startsWith('ouverture:'));
    assert(res.steps[0] === 'copie' && open === 1, `le corps doit être copié AVANT d'ouvrir la messagerie : ${res.steps.map(s => s.slice(0, 20)).join(' → ')}`);
    assert(/body=.+/.test(res.steps[open]), 'lien mailto sans corps : la messagerie ouvrirait un message vide');
    assert(res.clip.startsWith('Bonjour à tous'), 'corps absent du presse-papiers');
    await context.close();
  });

  await scenario('E-mail .eml : pas d’injection d’en-tête par l’objet', async () => {
    const { context, page } = await openApp(browser, base);
    const eml = await page.evaluate(() => buildEml({ subject: 'CR\r\nBcc: espion@exemple.com\r\nX-Evil: 1', body: 'Bonjour\r\n\r\n--fin' }));
    const headers = eml.split('\r\n\r\n')[0].split('\r\n');
    assert(!headers.some(h => /^(Bcc|X-Evil):/i.test(h)), `en-tête injecté : ${headers.join(' | ')}`);
    await context.close();
  });

  await scenario('CSP : scripts en ligne et eval() bloqués', async () => {
    const { context, page } = await openApp(browser, base);
    const csp = await page.$eval('meta[http-equiv="Content-Security-Policy"]', m => m.content);
    const scriptSrc = (csp.split(';').map(d => d.trim()).find(d => d.startsWith('script-src')) || '');
    assert(scriptSrc === "script-src 'self'", `script-src doit être limité à 'self' (reçu : ${scriptSrc})`);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<img src="x" onerror="window.__csp=1"><div id="t"></div>'));
    await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__csp2=1'; document.body.appendChild(s); });
    await page.waitForTimeout(400);
    const inline = await page.evaluate(() => [window.__csp, window.__csp2]);
    assert(inline[0] === undefined && inline[1] === undefined, `script en ligne exécuté malgré la CSP (${inline})`);
    // eval() : Playwright exécute son code par le canal de débogage, qui ignore la CSP par conception ;
    // on vérifie donc la directive elle-même (ni 'unsafe-eval' ni 'unsafe-inline' pour les scripts).
    assert(!/unsafe-eval/.test(csp), "la CSP ne doit pas autoriser 'unsafe-eval'");
    assert(/default-src 'self'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp), 'directives de base manquantes');
    await context.close();
  });

  await scenario('Politique « sans cloud » impossible à contourner', async () => {
    const { context, page, geminiUrls } = await openApp(browser, basePolicy, { gemini: () => 'ne doit pas être appelé' });
    await page.evaluate(() => fetch('/api/config', { method: 'POST', body: JSON.stringify({ provider: 'gemini', gemini_api_key: 'k', local_stt_mode: 'cloud' }) }));
    const cfg = await page.evaluate(() => fetch('/api/config').then(r => r.json()));
    assert(cfg.provider === 'local' && cfg.local_stt_mode === 'local' && !cfg.gemini_api_key, `politique contournée : ${cfg.provider}/${cfg.local_stt_mode}`);
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForTimeout(2500);
    assert(geminiUrls.length === 0, 'Gemini appelé malgré la politique');
    assert(await page.isDisabled('#liveToggle'), 'la transcription en direct (cloud) doit être désactivée');
    await context.close();
  });

  await scenario('Clé d’API jamais dans l’URL, aucune ressource externe au chargement', async () => {
    const { context, page, blocked, geminiUrls } = await openApp(browser, base, {
      gemini: () => JSON.stringify({ title: 'R', transcription: [], summary: { executive: 'ok' } })
    });
    assert(blocked.length === 0, `ressources externes chargées : ${blocked.join(', ')}`);
    await page.evaluate(() => fetch('/api/config', { method: 'POST', body: JSON.stringify({ gemini_api_key: 'cle-secrete-123' }) }));
    await page.setInputFiles('#fileUploadInput', AUDIO);
    await page.waitForTimeout(1500);
    assert(geminiUrls.length > 0, 'Gemini aurait dû être appelé');
    assert(!geminiUrls.some(u => u.includes('cle-secrete-123')), 'clé d’API présente dans l’URL (journaux, historique)');
    await context.close();
  });

  await browser.close();
  server.close();
  serverPolicy.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scénarios réussis`);
  process.exit(failed.length ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
