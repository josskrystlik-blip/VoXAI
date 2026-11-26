/**
 * VoxAI — tests de bout en bout : sessions à plusieurs pistes audio. L'analyse doit prendre en compte
 * TOUTES les pistes : chacune est transcrite, la synthèse porte sur la transcription complète, et une
 * piste sans transcription arrête l'analyse au lieu d'être ignorée.
 *
 * Gemini, Whisper et LLM de l'entreprise simulés, aucun accès Internet.
 * Lancement : node tests/e2e/pistes.test.js
 */
'use strict';

const fs = require('fs');
const { AUDIO, CORS, startServer, createRunner, assert, launchBrowser, gemini, openApp, importAudio } = require('./lib');

const wav = fs.readFileSync(AUDIO);
const track = (name) => ({ name, mimeType: 'audio/wav', buffer: wav });
const TRACKS = ['salle.wav', 'visio.wav', 'telephone.wav'];
const GEMINI = { provider: 'gemini', gemini_api_key: 'cle-test' };
const ON_PREM = { provider: 'local', local_llm_url: 'https://llm.corp.test/v1', local_llm_model: 'gpt-oss-120b', on_prem_stt_url: 'https://whisper.corp.test/v1' };

/** Nom de la piste demandée dans une requête de transcription Gemini. */
const trackOf = (body) => (JSON.stringify(body).match(/'([a-z]+\.wav)'/) || [])[1];

/** Importe plusieurs pistes (titre demandé) et attend la fin de l'analyse. */
async function importTracks(page, names) {
  page.nextPrompt = 'Réunion multi-pistes';
  return importAudio(page, names.map(track));
}

/** Serveur Whisper simulé : réponse par piste (dans l'ordre des requêtes), verbose_json ou non. */
function whisper(perTrack, { verbose = true } = {}) {
  const w = { calls: [] };
  w.handler = async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const raw = (req.postDataBuffer() || Buffer.alloc(0)).toString('latin1');
    const wantsVerbose = /name="response_format"\r\n\r\nverbose_json/.test(raw);
    w.calls.push({ verbose: wantsVerbose });
    if (wantsVerbose && !verbose) return route.fulfill({ status: 400, headers: CORS, contentType: 'application/json', body: '{"error":"response_format non pris en charge"}' });
    const n = w.calls.filter(c => c.verbose === wantsVerbose).length - 1;
    const segments = perTrack[Math.min(n, perTrack.length - 1)];
    const body = wantsVerbose ? { text: segments.map(s => s.text).join(' '), segments } : { text: segments.map(s => s.text).join(' ') };
    return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
  };
  return w;
}

/** LLM de l'entreprise simulé : enregistre chaque demande de synthèse (JSON). */
function llm(answer) {
  const l = { prompts: [], down: false };
  l.handler = async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (l.down) return route.abort('failed');
    const body = JSON.parse(req.postData() || '{}');
    const prompt = body.messages.map(m => m.content).join('\n');
    l.prompts.push(prompt);
    const content = answer(prompt, l.prompts.length - 1);
    return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }] }) });
  };
  return l;
}

const SUMMARY = (executive, refs = [1]) => ({ title: 'Réunion multi-pistes', summary: { executive, executive_refs: refs, decisions: [], key_points: [], tags: [], action_items: [] } });

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launchBrowser();
  const t = createRunner('Tests de bout en bout : sessions à plusieurs pistes audio');

  await t.scenario('Gemini, 3 pistes : chaque piste transcrite en entier, synthèse sur toutes les pistes', async () => {
    const said = { 'salle.wav': 'Budget validé en salle.', 'visio.wav': 'Côté visio, le planning glisse.', 'telephone.wav': 'Au téléphone : le fournisseur livre lundi.' };
    const g = gemini({
      analysis: (body) => ({ transcription: [{ speaker: 'Orateur 1', timestamp: '00:00', text: 'Début de piste.' }, { speaker: 'Orateur 2', timestamp: '00:41', text: said[trackOf(body)] }] }),
      synthesis: () => ({ title: 'Synthèse 3 pistes', summary: { executive: 'Budget, planning et livraison.', decisions: [{ text: 'Livraison lundi', refs: [6] }], key_points: [], tags: [], action_items: [] } })
    });
    const { context, page } = await openApp(browser, base, { gemini: g, config: GEMINI });
    const rec = await importTracks(page, TRACKS);
    assert(rec.status === 'completed', `statut : ${rec.status} ${rec.error_message || ''}`);
    // Une requête par piste, chacune avec son seul fichier audio
    assert(g.analyses.length === 3, `requêtes de transcription : ${g.analyses.length}`);
    g.analyses.forEach((a, i) => {
      assert(a.contents[0].parts.filter(p => p.inline_data).length === 1 && trackOf(a) === TRACKS[i] && JSON.stringify(a).includes(`piste ${i + 1} sur 3`), `requête ${i + 1} : mauvaise piste`);
    });
    // Synthèse : transcription complète des 3 pistes et consigne de couverture
    const prompt = JSON.stringify(g.syntheses[0]);
    assert(Object.values(said).every(x => prompt.includes(x)), 'texte d’une piste absent de la synthèse');
    assert(prompt.includes('La réunion comporte 3 pistes audio') && prompt.includes('couvrir TOUTES les pistes'), 'consigne de couverture absente');
    assert(['[Piste 1 •', '[Piste 2 •', '[Piste 3 •'].every(x => prompt.includes(x)), 'lignes des pistes non identifiées');
    // Transcription : 3 pistes, dans l'ordre, horodatages propres à chaque piste
    assert(JSON.stringify(rec.transcription.map(s => [s.file_index, s.timestamp])) === '[[1,"00:00"],[1,"00:41"],[2,"00:00"],[2,"00:41"],[3,"00:00"],[3,"00:41"]]', `transcription : ${JSON.stringify(rec.transcription.map(s => [s.file_index, s.timestamp]))}`);
    // La décision renvoie au passage de la piste 3
    await page.click('#summaryDecisions .ref-chip');
    await page.waitForFunction(() => document.querySelector('#seg-5').classList.contains('seg-highlight'));
    assert(await page.evaluate(() => state.activeFileIndex) === 2, 'piste 3 non sélectionnée');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Gemini : piste sans transcription ou trop longue → analyse arrêtée, piste nommée', async () => {
    let mode = 'vide';
    const g = gemini({
      analysis: (body) => trackOf(body) !== 'visio.wav' ? { transcription: [{ speaker: 'A', timestamp: '00:00', text: 'Bonjour.' }] }
        : mode === 'vide' ? { transcription: [] } : { parts: [{ text: '{"transcription": [{"speaker": "A", "text": "début' }], finishReason: 'MAX_TOKENS' }
    });
    // Réponse brute (coupure) renvoyée telle quelle par le simulateur
    const handler = g.handler;
    g.handler = async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (mode === 'longue' && trackOf(body) === 'visio.wav') {
        g.analyses.push(body);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"transcription": [{"speaker": "A", "text": "début' }] }, finishReason: 'MAX_TOKENS' }] }) });
      }
      return handler(route);
    };
    const { context, page } = await openApp(browser, base, { gemini: g, config: GEMINI });
    let rec = await importTracks(page, ['salle.wav', 'visio.wav']);
    assert(rec.status === 'error' && /aucune parole transcrite pour piste 2 \(« visio\.wav »\)/.test(rec.error_message), `piste vide : ${rec.status} ${rec.error_message}`);
    assert(g.syntheses.length === 0, 'synthèse produite malgré une piste manquante');
    mode = 'longue';
    await page.click('#reprocessBtn');
    await page.waitForFunction(() => state.activeRecording.status === 'error' && /trop longue/.test(state.activeRecording.error_message || ''), null, { timeout: 15000 });
    rec = await page.evaluate(() => state.activeRecording);
    assert(/piste 2 \(« visio\.wav »\) trop longue/.test(rec.error_message), `piste coupée : ${rec.error_message}`);
    await context.close();
  });

  await t.scenario('100 % sur site, 2 pistes : Whisper avec horodatages, synthèse sur les deux pistes', async () => {
    const w = whisper([
      [{ start: 0, text: 'Bonjour à tous.' }, { start: 4.2, text: 'On commence par le budget.' }, { start: 3725, text: 'Le budget est validé.' }],
      [{ start: 0, text: 'Ici la visio.' }, { start: 65, text: 'Le planning glisse de deux semaines.' }]
    ]);
    const l = llm(() => SUMMARY('Budget validé, planning décalé.', [3, 5]));
    const { context, page } = await openApp(browser, base, { config: ON_PREM, servers: { 'whisper.corp.test': w.handler, 'llm.corp.test': l.handler } });
    const rec = await importTracks(page, ['salle.wav', 'visio.wav']);
    assert(rec.status === 'completed', `statut : ${rec.status} ${rec.error_message || ''}`);
    assert(w.calls.length === 2 && w.calls.every(c => c.verbose), 'horodatages (verbose_json) non demandés');
    const segs = rec.transcription.map(s => [s.file_index, s.timestamp, s.speaker, s.text]);
    assert(JSON.stringify(segs) === JSON.stringify([
      [1, '00:00', 'Orateur (Piste 1)', 'Bonjour à tous. On commence par le budget.'],
      [1, '1:02:05', 'Orateur (Piste 1)', 'Le budget est validé.'],
      [2, '00:00', 'Orateur (Piste 2)', 'Ici la visio.'],
      [2, '01:05', 'Orateur (Piste 2)', 'Le planning glisse de deux semaines.']
    ]), `passages : ${JSON.stringify(segs)}`);
    assert(l.prompts.length === 1 && l.prompts[0].includes('[Piste 1 •') && l.prompts[0].includes('[Piste 2 •') && l.prompts[0].includes('couvrir TOUTES les pistes'), 'synthèse sans les deux pistes');
    assert(l.prompts[0].includes('Le planning glisse de deux semaines.') && l.prompts[0].includes('Le budget est validé.'), 'texte des pistes absent');
    await context.close();
  });

  await t.scenario('Whisper : passages horodatés (plus d’une heure), serveur sans horodatages', async () => {
    const long = Array.from({ length: 12 }, (_, i) => ({ start: i * 330 + 0.4, text: `Passage ${i + 1} : ` + 'on avance sur le sujet. '.repeat(8) }));
    const w = whisper([long, [{ start: 0, text: 'Piste deux.' }]]);
    const l = llm(() => SUMMARY('OK'));
    const { context, page } = await openApp(browser, base, { config: ON_PREM, servers: { 'whisper.corp.test': w.handler, 'llm.corp.test': l.handler } });
    const rec = await importTracks(page, ['salle.wav', 'visio.wav']);
    const p1 = rec.transcription.filter(s => s.file_index === 1);
    assert(p1.length === 12 && p1[1].timestamp === '05:30' && p1[11].timestamp === '1:00:30', `horodatages : ${p1.map(s => s.timestamp).join(', ')}`);
    assert(p1.every(s => s.text.length < 400 + 250), 'passages trop longs');
    // Clic sur un horodatage au-delà d'une heure : position de lecture correcte
    await page.click('#tabTranscriptBtn');
    assert((await page.textContent('#seg-11 .timestamp-btn')).includes('1:00:30'), 'horodatage affiché');
    // Serveur qui refuse verbose_json : nouvel essai sans horodatages
    const w2 = whisper([[{ start: 0, text: 'Texte sans horodatage.' }]], { verbose: false });
    const { context: c2, page: p2 } = await openApp(browser, base, { config: ON_PREM, servers: { 'whisper.corp.test': w2.handler, 'llm.corp.test': l.handler } });
    const rec2 = await importTracks(p2, ['salle.wav', 'visio.wav']);
    assert(rec2.status === 'completed' && w2.calls.length === 4 && rec2.transcription.length === 2 && rec2.transcription[1].file_index === 2, `repli sans verbose_json : ${rec2.status} ${JSON.stringify(rec2.transcription)}`);
    await c2.close();
    await context.close();
  });

  await t.scenario('100 % sur site, transcription longue : synthèse par parties (piste par piste) puis consolidation', async () => {
    // ~55 000 caractères par piste : trop pour une seule demande au LLM de l'entreprise
    const many = (label) => Array.from({ length: 150 }, (_, i) => ({ start: i * 20, text: `${label} ${i + 1} : ` + 'discussion détaillée du projet et des prochaines étapes. '.repeat(6) }));
    const w = whisper([many('Salle'), many('Visio')]);
    const l = llm((prompt, n) => /synthèses partielles/.test(prompt)
      ? SUMMARY('Synthèse consolidée des deux pistes.', [1, 200])
      : { summary: { executive: `Partie ${n + 1}`, decisions: [{ text: `Décision de la partie ${n + 1}`, refs: [] }], key_points: [], tags: [], action_items: [] } });
    const { context, page } = await openApp(browser, base, { config: ON_PREM, servers: { 'whisper.corp.test': w.handler, 'llm.corp.test': l.handler } });
    const rec = await importTracks(page, ['salle.wav', 'visio.wav']);
    assert(rec.status === 'completed' && rec.summary.executive === 'Synthèse consolidée des deux pistes.', `résultat : ${rec.status} ${rec.error_message || ''} ${rec.summary && rec.summary.executive}`);
    const partials = l.prompts.slice(0, -1);
    const final = l.prompts[l.prompts.length - 1];
    assert(partials.length >= 4 && /synthèses partielles/.test(final), `demandes au LLM : ${l.prompts.length}`);
    assert(partials.every(p => !(p.includes('Salle ') && p.includes('Visio '))), 'une partie mélange deux pistes');
    assert(partials.every(p => p.length < 48000), `partie trop longue : ${Math.max(...partials.map(p => p.length))} caractères`);
    // Chaque ligne de la transcription est passée dans une partie, et chaque partie dans la consolidation
    const n = rec.transcription.length;
    const seen = new Set(partials.flatMap(p => (p.match(/(?:^|""")#\d+ /gm) || []).map(x => Number(x.replace(/\D/g, '')))));
    assert(seen.size === n, `lignes envoyées au LLM : ${seen.size} / ${n}`);
    assert(partials.every((p, i) => final.includes(`Partie ${i + 1}`)) && final.includes('couvrir TOUTES les pistes'), 'synthèse partielle absente de la consolidation');
    await context.close();
  });

  await t.scenario('100 % sur site : piste vide ou LLM injoignable → jamais de synthèse incomplète', async () => {
    const w = whisper([[{ start: 0, text: 'Seule la salle parle.' }], []]);
    const l = llm(() => SUMMARY('OK'));
    const { context, page } = await openApp(browser, base, { config: ON_PREM, servers: { 'whisper.corp.test': w.handler, 'llm.corp.test': l.handler } });
    let rec = await importTracks(page, ['salle.wav', 'visio.wav']);
    assert(rec.status === 'error' && /piste 2 \(« visio\.wav »\)/.test(rec.error_message) && l.prompts.length === 0, `piste vide : ${rec.status} ${rec.error_message}`);
    // LLM injoignable pendant la synthèse : enregistrement en attente, pas « analysé » avec une synthèse vide
    const w2 = whisper([[{ start: 0, text: 'Salle.' }], [{ start: 0, text: 'Visio.' }]]);
    l.down = true;
    const { context: c2, page: p2 } = await openApp(browser, base, { config: ON_PREM, servers: { 'whisper.corp.test': w2.handler, 'llm.corp.test': l.handler } });
    rec = await importTracks(p2, ['salle.wav', 'visio.wav']);
    assert(rec.status === 'pending', `LLM injoignable : ${rec.status} (${rec.error_message})`);
    await c2.close();
    await context.close();
  });

  await t.scenario('Whisper qui refuse le WebM : fichier converti en MP3 puis renvoyé', async () => {
    const calls = [];
    const picky = async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const raw = (req.postDataBuffer() || Buffer.alloc(0)).toString('latin1');
      const name = (raw.match(/filename="([^"]+)"/) || [])[1] || '';
      const type = (raw.match(/name="file"; filename="[^"]+"\r\nContent-Type: ([^\r]+)/) || [])[1] || '';
      calls.push({ name, type, mp3: raw.includes('\r\n\r\n\xff\xfb') || /\r\n\r\n\xff[\xe0-\xff]/.test(raw) });
      if (!/\.mp3$/.test(name)) return route.fulfill({ status: 400, headers: CORS, contentType: 'application/json', body: '{"error":"Unsupported file format"}' });
      return route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ text: 'Converti.', segments: [{ start: 0, text: 'Converti.' }] }) });
    };
    const l = llm(() => SUMMARY('OK'));
    const { context, page } = await openApp(browser, base, { config: ON_PREM, servers: { 'whisper.corp.test': picky, 'llm.corp.test': l.handler } });
    // Ancien enregistrement au format WebM (fichier importé)
    const rec = await importAudio(page, { name: 'ancien.webm', mimeType: 'audio/webm', buffer: wav });
    assert(rec.status === 'completed' && rec.transcription[0].text === 'Converti.', `analyse : ${rec.status} ${rec.error_message || ''}`);
    assert(calls.length === 3 && calls.slice(0, 2).every(c => /\.webm$/.test(c.name)) && calls.slice(2).every(c => /\.mp3$/.test(c.name) && c.type === 'audio/mpeg' && c.mp3), `envois à Whisper : ${JSON.stringify(calls)}`);
    await context.close();
  });

  await t.scenario('Avancement de l’analyse : étapes, pourcentage, temps écoulé, liste des enregistrements', async () => {
    const pause = (ms) => new Promise(r => setTimeout(r, ms));
    const w = whisper([[{ start: 0, text: 'Salle.' }], [{ start: 0, text: 'Visio.' }]]);
    const l = llm(() => SUMMARY('OK'));
    const slow = (h) => async (route) => { if (route.request().method() !== 'OPTIONS') await pause(1500); return h(route); };
    const { context, page } = await openApp(browser, base, { config: ON_PREM, servers: { 'whisper.corp.test': slow(w.handler), 'llm.corp.test': slow(l.handler) } });
    // Toutes les étapes vues par l'interface (événements « voxai:progress »)
    await page.evaluate(() => { window.__steps = []; document.addEventListener('voxai:progress', e => window.__steps.push(e.detail.steps.map(x => `${x.status}:${x.label}`).join(' | '))); });
    page.nextPrompt = 'Réunion multi-pistes';
    await page.setInputFiles('#fileUploadInput', ['salle.wav', 'visio.wav'].map(track));
    await page.waitForSelector('#analysisProgress:not(.hidden)');
    await page.waitForFunction(() => document.querySelectorAll('#analysisProgressSteps .analysis-step').length === 4);
    const labels = await page.$$eval('#analysisProgressSteps .analysis-step-label', e => e.map(x => x.textContent));
    assert(labels[0] === 'Transcription piste 1/2 « salle.wav » (Whisper · whisper.corp.test) · 0,1 Mo' && labels[1].startsWith('Transcription piste 2/2 « visio.wav »')
      && labels[2] === 'Synthèse de la transcription complète (LLM gpt-oss-120b · llm.corp.test)' && labels[3] === 'Enregistrement du compte rendu', `étapes : ${labels.join(' | ')}`);
    // Piste 1 terminée, piste 2 en cours : 25 %, durée et nombre de passages affichés
    await page.waitForSelector('#analysisProgressSteps [data-step="track1"].analysis-step-running', { timeout: 10000 });
    assert(/· 25 %/.test(await page.textContent('#analysisProgressTitle')), `pourcentage : ${await page.textContent('#analysisProgressTitle')}`);
    assert(/^\d+ s · 1 passage$/.test(await page.textContent('[data-step="track0"] .analysis-step-time')), `étape terminée : ${await page.textContent('[data-step="track0"] .analysis-step-time')}`);
    assert(/^depuis \d+ s$/.test(await page.textContent('[data-step="track1"] .analysis-step-time')), 'temps de l’étape en cours');
    assert(/^\d+ s$/.test(await page.textContent('#analysisProgressTime')), 'temps total');
    assert(/⏳ 25 % · transcription/.test(await page.textContent('#recordingsList')), `liste : ${await page.textContent('#recordingsList')}`);
    assert(/Analyse IA en cours… 25 %/.test(await page.textContent('#detailStatusBadge')), 'badge de statut');
    // L'audio se télécharge sans attendre la fin de l'analyse
    assert(await page.isVisible('#analysisProgressDownload'), 'bouton de téléchargement absent du panneau');
    const [early] = await Promise.all([page.waitForEvent('download'), page.click('#analysisProgressDownload')]);
    assert(/piste 1 - salle\.wav$/.test(early.suggestedFilename()) && await page.evaluate(() => state.activeRecording.status) === 'processing', `téléchargement pendant l’analyse : ${early.suggestedFilename()}`);
    // Synthèse en cours, puis fin
    await page.waitForSelector('#analysisProgressSteps [data-step="synth"].analysis-step-running', { timeout: 10000 });
    assert(/· 50 %/.test(await page.textContent('#analysisProgressTitle')) && /50 % · synthèse/.test(await page.textContent('#recordingsList')), 'étape de synthèse');
    await page.waitForFunction(() => state.activeRecording.status === 'completed', null, { timeout: 15000 });
    await page.waitForSelector('#analysisProgress', { state: 'hidden' });
    assert(/Analyse IA terminée en \d+ s/.test(await page.textContent('#toastMessage')), `message de fin : ${await page.textContent('#toastMessage')}`);
    const last = await page.evaluate(() => window.__steps[window.__steps.length - 1]);
    assert(last.split(' | ').every(x => x.startsWith('done:')), `dernières étapes : ${last}`);
    // Relance : l'avancement repart de zéro (pas l'état de l'analyse précédente)
    await page.click('#reprocessBtn');
    await page.waitForSelector('#analysisProgress:not(.hidden)');
    assert(!/100 %/.test(await page.textContent('#analysisProgressTitle')), 'avancement précédent affiché');
    await page.waitForFunction(() => state.activeRecording.status === 'completed', null, { timeout: 15000 });
    // Échec : étape en erreur, panneau masqué, message d'erreur
    w.calls.length = 0;
    const failing = whisper([[{ start: 0, text: 'Salle.' }], []]);
    await context.route('https://whisper.corp.test/**', failing.handler);
    await page.click('#reprocessBtn');
    await page.waitForFunction(() => state.activeRecording.status === 'error', null, { timeout: 15000 });
    assert(await page.isHidden('#analysisProgress'), 'panneau visible après l’échec');
    const failed = await page.evaluate(() => window.__steps[window.__steps.length - 1]);
    assert(/failed:Transcription piste 2\/2/.test(failed), `étape en échec : ${failed}`);
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Avancement : réunion longue résumée par parties, analyse Gemini d’une piste', async () => {
    const many = (label) => Array.from({ length: 150 }, (_, i) => ({ start: i * 20, text: `${label} ${i + 1} : ` + 'discussion détaillée du projet et des prochaines étapes. '.repeat(6) }));
    const w = whisper([many('Salle'), many('Visio')]);
    const l = llm((prompt) => /synthèses partielles/.test(prompt) ? SUMMARY('Consolidée') : { summary: { executive: 'Partie', decisions: [], key_points: [], tags: [], action_items: [] } });
    const { context, page } = await openApp(browser, base, { config: ON_PREM, servers: { 'whisper.corp.test': w.handler, 'llm.corp.test': l.handler } });
    await page.evaluate(() => { window.__labels = new Set(); document.addEventListener('voxai:progress', e => e.detail.steps.forEach(x => window.__labels.add(x.label))); });
    await importTracks(page, ['salle.wav', 'visio.wav']);
    const labels = await page.evaluate(() => [...window.__labels]);
    assert(['partie 1/4, piste 1', 'partie 3/4, piste 2', 'consolidation des 4 parties'].every(x => labels.some(l2 => l2.includes(x))), `étapes des parties : ${labels.join(' | ')}`);
    // Gemini, une piste : une étape d'analyse puis l'enregistrement
    const g = gemini();
    const { context: c2, page: p2 } = await openApp(browser, base, { gemini: g, config: GEMINI });
    await p2.evaluate(() => { window.__last = null; document.addEventListener('voxai:progress', e => { window.__last = e.detail.steps.map(x => `${x.status}:${x.label}`); }); });
    await importAudio(p2, track('memo.wav'));
    const steps = await p2.evaluate(() => window.__last);
    assert(steps.length === 2 && /^done:Analyse par Gemini \(transcription et synthèse\) · audio de 0,1 Mo$/.test(steps[0]) && steps[1] === 'done:Enregistrement du compte rendu', `étapes Gemini : ${steps}`);
    await c2.close();
    await context.close();
  });

  await browser.close();
  server.close();
  t.finish();
})().catch(err => { console.error(err); process.exit(1); });
