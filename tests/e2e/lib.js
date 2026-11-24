/**
 * VoxAI — outils communs des tests de bout en bout (Playwright, Chromium).
 *
 * - serveur statique local (l'application telle qu'elle est publiée) ;
 * - mini-cadre de test (scénarios, assertions, bilan) ;
 * - application ouverte dans un contexte isolé : Internet bloqué, Gemini, LLM, Whisper et autres
 *   serveurs simulés, micro simulé (Chromium), reconnaissance vocale du navigateur simulée.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const AUDIO = path.join(ROOT, 'tests', 'security', 'fixtures', 'silence.wav');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function startServer(extraRoutes = {}) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      // Réponse imposée par le test : texte JSON, ou fonction → { type, body } (null : fichier normal)
      const extra = typeof extraRoutes[url] === 'function' ? extraRoutes[url]() : (extraRoutes[url] ? { type: 'application/json', body: extraRoutes[url] } : null);
      if (extra) { res.writeHead(200, { 'Content-Type': extra.type, 'Cache-Control': 'no-cache' }); return res.end(extra.body); }
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function createRunner(title) {
  const results = [];
  console.log(title);
  return {
    async scenario(name, fn) {
      try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ✓ ${name}`);
      } catch (err) {
        results.push({ name, ok: false, err });
        console.log(`  ✗ ${name}\n      ${String(err && err.stack || err).split('\n').slice(0, 3).join('\n      ')}`);
      }
    },
    finish() {
      const failed = results.filter(r => !r.ok);
      console.log(`\n${results.length - failed.length}/${results.length} scénarios réussis`);
      process.exit(failed.length ? 1 : 0);
    }
  };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

/** Navigateur avec micro simulé (son de test généré par Chromium, autorisation accordée). */
function launchBrowser() {
  return chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
}

/** Réponse d'analyse par défaut (Gemini) : transcription, synthèse avec décisions et actions. */
const ANALYSIS = {
  title: 'Point projet Alpha',
  transcription: [
    { speaker: 'Orateur 1', timestamp: '00:00', text: 'Bonjour à tous, on fait le point sur le projet.' },
    { speaker: 'Bob', timestamp: '00:05', text: "J'envoie le devis au fournisseur vendredi." },
    { speaker: 'Orateur 1', timestamp: '00:12', text: 'Parfait, le budget est validé.' }
  ],
  summary: {
    executive: 'Lancement du projet validé, devis à envoyer.',
    decisions: [{ text: 'Budget de 120 k€ validé', refs: [3] }],
    key_points: [{ text: 'Planning tenu', refs: [1] }],
    tags: ['Projet Alpha'],
    action_items: [{ task: 'Envoyer le devis', assignee: 'Bob', deadline: '2026-11-27', refs: [2] }]
  }
};

/**
 * Simulateur Gemini. analysis(body, n) → objet d'analyse (n = numéro de l'analyse) ;
 * chat(text, body) → réponse texte de l'assistant. Les requêtes sont journalisées.
 */
function gemini({ analysis = () => ANALYSIS, chat = () => 'Réponse de test.', status = null } = {}) {
  const g = { analyses: [], chats: [], status };
  g.handler = async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    const raw = JSON.stringify(body);
    if (g.status) return route.fulfill({ status: g.status, contentType: 'application/json', body: JSON.stringify({ error: { code: g.status, message: 'Erreur simulée' } }) });
    const isAnalysis = raw.includes('"inline_data"');
    let text;
    if (isAnalysis) {
      g.analyses.push(body);
      text = JSON.stringify(analysis(body, g.analyses.length - 1));
    } else {
      g.chats.push(body);
      const parts = (body.contents || []).flatMap(c => c.parts || []).map(p => p.text || '');
      text = chat(parts[parts.length - 1] || '', body, g.chats.length - 1);
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) });
  };
  return g;
}

/** Serveur LLM compatible OpenAI (sur site) : /v1/models, /api/tags, /v1/chat/completions. */
function llmServer({ models = ['gpt-oss-120b', 'mistral-small'], summary = null, reply = () => 'pong', down = false } = {}) {
  const s = { calls: [], down };
  s.handler = async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (s.down) return route.abort('failed');
    const url = new URL(req.url());
    const send = (o, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(o) });
    s.calls.push({ path: url.pathname, auth: req.headers().authorization || '', body: req.postData() ? JSON.parse(req.postData()) : null });
    if (url.pathname.endsWith('/api/tags')) return send({}, 404);
    if (url.pathname.endsWith('/models')) return send({ data: models.map(id => ({ id })) });
    if (url.pathname.endsWith('/chat/completions')) {
      const body = JSON.parse(req.postData() || '{}');
      const all = (body.messages || []).map(m => String(m.content)).join('\n');
      const content = all.includes('"summary"')
        ? JSON.stringify(summary || { title: 'Réunion sur site', summary: { executive: 'Synthèse produite sur site.', decisions: [{ text: 'Rien ne sort de l’entreprise' }], key_points: [], tags: ['SurSite'], action_items: [{ task: 'Valider l’installation', assignee: 'Alice', deadline: 'À définir' }] } })
        : reply(body);
      return send({ choices: [{ message: { content } }] });
    }
    return send({ error: 'inconnu' }, 404);
  };
  return s;
}

/** Serveur Whisper (sur site) : /v1/audio/transcriptions. */
function whisperServer({ text = 'Bonjour, ceci est une réunion transcrite sur site.', down = false } = {}) {
  const s = { calls: 0, down };
  s.handler = async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (s.down) return route.abort('failed');
    s.calls++;
    return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ text }) });
  };
  return s;
}

/** Reconnaissance vocale du navigateur simulée : window.__speech.say(texte, final). */
function fakeSpeechRecognition() {
  class FakeRecognition {
    constructor() { this.lang = ''; window.__speech.instances.push(this); }
    start() { this.running = true; window.__speech.active = this; window.__speech.starts++; }
    stop() { this.running = false; if (window.__speech.active === this) window.__speech.active = null; setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this.stop(); }
  }
  window.__speech = {
    instances: [], starts: 0, active: null,
    say(text, isFinal = true) {
      const r = window.__speech.active;
      if (!r || !r.onresult) return false;
      const result = [{ transcript: text }];
      result.isFinal = isFinal;
      r.onresult({ resultIndex: 0, results: [result] });
      return true;
    }
  };
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
}

/**
 * Ouvre l'application dans un contexte isolé.
 * options : servers { hôte: gestionnaire }, gemini (simulateur), config (réglages enregistrés avant
 * rechargement), defaults (voxai-defaults.json de l'administrateur), onboarded, serviceWorkers,
 * speech (reconnaissance vocale simulée), clipboard.
 */
async function openApp(browser, baseUrl, { servers = {}, gemini: gem = null, config = null, defaults = null, onboarded = true, serviceWorkers = 'block', speech = false, mailTarget = 'desktop' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 }, acceptDownloads: true, serviceWorkers, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  const blocked = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') {
      if (defaults && url.pathname.endsWith('/voxai-defaults.json')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(defaults) });
      return route.continue();
    }
    if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
    if (url.hostname === 'generativelanguage.googleapis.com' && gem) return gem.handler(route);
    if (servers[url.hostname]) return servers[url.hostname](route);
    blocked.push(url.href);
    return route.abort();
  });
  await context.addInitScript(({ onboarded, mailTarget }) => {
    try {
      if (onboarded) localStorage.setItem('voxai_onboarded', 'test');
      if (mailTarget && !localStorage.getItem('voxai_mail_target')) localStorage.setItem('voxai_mail_target', mailTarget);
    } catch { /* stockage indisponible */ }
  }, { onboarded, mailTarget });
  if (speech) await context.addInitScript(fakeSpeechRecognition);
  const page = await context.newPage();
  page.jsErrors = [];
  page.dialogs = [];
  page.on('pageerror', e => page.jsErrors.push(e.message));
  // Boîtes de dialogue : acceptées (prompt : réponse fournie par page.nextPrompt)
  page.on('dialog', d => { page.dialogs.push(d.message()); d.accept(d.type() === 'prompt' ? (page.nextPrompt ?? d.defaultValue()) : undefined).catch(() => {}); page.nextPrompt = undefined; });
  await page.goto(baseUrl);
  await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
  if (config) {
    await page.evaluate(c => fetch('/api/config', { method: 'POST', body: JSON.stringify(c) }), config);
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
  }
  await page.waitForTimeout(500);
  if (onboarded) await page.evaluate(() => { try { closeSettingsModal(); } catch {} });
  return { context, page, blocked };
}

/** Importe un fichier audio et attend la fin de l'analyse. */
async function importAudio(page, files = AUDIO) {
  const before = await page.evaluate(() => (state.recordings || []).length);
  await page.setInputFiles('#fileUploadInput', files);
  await page.waitForFunction(n => (state.recordings || []).length > n && state.activeRecording
    && ['completed', 'error', 'pending'].includes(state.activeRecording.status), before, { timeout: 20000 });
  return page.evaluate(() => state.activeRecording);
}

/** Attend qu'un enregistrement soit analysé (ou en erreur / en attente). */
function waitAnalysed(page, statuses = ['completed']) {
  return page.waitForFunction(s => state.activeRecording && s.includes(state.activeRecording.status), statuses, { timeout: 20000 });
}

/** Contenu texte d'un téléchargement. */
async function downloadText(download) {
  return fs.readFileSync(await download.path(), 'utf8');
}

/** Décode les parties base64 d'un e-mail .eml (corps encodé). */
function emlText(eml) {
  return eml + '\n' + eml.split(/\r?\n\r?\n/).map(part => { try { return Buffer.from(part.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { return ''; } }).join('\n');
}

/** Objet d'un e-mail .eml (encodé en =?UTF-8?B?…?= quand il contient des accents). */
function emlSubject(eml) {
  const line = (eml.match(/^Subject: (.*(?:\r?\n[ \t].*)*)/m) || ['', ''])[1];
  return line.replace(/\r?\n[ \t]/g, '').replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (m, b) => Buffer.from(b, 'base64').toString('utf8')).trim();
}

const recording = (page, id) => page.evaluate(i => fetch('/api/recordings/' + i).then(r => r.json()), id);
const getConfig = (page) => page.evaluate(() => fetch('/api/config').then(r => r.json()));

module.exports = { ROOT, AUDIO, CORS, ANALYSIS, startServer, createRunner, assert, launchBrowser, gemini, llmServer, whisperServer, openApp, importAudio, waitAnalysed, downloadText, emlText, emlSubject, recording, getConfig };
