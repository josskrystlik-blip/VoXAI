/**
 * VoxAI — tests de bout en bout : dictaphone, import, synthèse, exports, sauvegarde.
 *
 * Micro simulé par Chromium, Gemini simulé, aucun accès Internet.
 * Lancement : node tests/e2e/dictaphone.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { AUDIO, ANALYSIS, startServer, createRunner, assert, launchBrowser, gemini, openApp, importAudio, waitAnalysed, recording } = require('./lib');

const CONFIG = { provider: 'gemini', gemini_api_key: 'cle-test' };
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const wav = fs.readFileSync(AUDIO);

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launchBrowser();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voxai-e2e-'));
  const t = createRunner('Tests de bout en bout : dictaphone, synthèse, exports, sauvegarde');

  await t.scenario('Dictaphone au micro : enregistrement, pause, reprise, arrêt puis analyse', async () => {
    const g = gemini();
    const { context, page, blocked } = await openApp(browser, base, { gemini: g, config: CONFIG });
    await page.fill('#recordTitleInput', 'Réunion au micro');
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.isRecording && state.mediaRecorder && state.mediaRecorder.state === 'recording');
    assert(await page.isVisible('#pauseRecordBtn') && await page.isVisible('#cancelRecordBtn'), 'boutons pause / annuler absents');
    await page.waitForFunction(() => document.querySelector('#recordTimer').textContent === '00:02', null, { timeout: 5000 });
    await page.click('#pauseRecordBtn');
    assert(await page.textContent('#recordStatusText') === 'Enregistrement en pause', 'statut de pause');
    assert(await page.evaluate(() => state.mediaRecorder.state) === 'paused', 'MediaRecorder non mis en pause');
    const paused = await page.textContent('#recordTimer');
    await page.waitForTimeout(1600);
    assert(await page.textContent('#recordTimer') === paused, 'le chronomètre avance pendant la pause');
    await page.click('#pauseRecordBtn');
    assert(/Enregistrement en cours/.test(await page.textContent('#recordStatusText')), 'reprise');
    await page.waitForTimeout(1200);
    await page.click('#mainRecordBtn');
    await waitAnalysed(page);
    const rec = await page.evaluate(() => state.activeRecording);
    assert(rec.duration >= 3 && rec.duration <= 5, `durée hors pause : ${rec.duration} s`);
    // Comportement actuel : hors série, le titre proposé par l'IA remplace le titre saisi
    assert(rec.title === ANALYSIS.title, `titre après analyse : ${rec.title}`);
    assert(g.analyses.length === 1, 'une seule analyse');
    assert(rec.file_size > 1000, `audio enregistré trop petit : ${rec.file_size} octets`);
    const part = g.analyses[0].contents[0].parts.find(p => p.inline_data);
    assert(/^audio\/(webm|mp4)/.test(part.inline_data.mime_type) && part.inline_data.data.length > 1000, 'audio non transmis à l’analyse');
    assert((await page.textContent('#summaryExecutive')).includes(ANALYSIS.summary.executive), 'synthèse non affichée');
    assert(await page.textContent('#detailStatusBadge') === 'Analysé par IA', 'badge de statut');
    assert(await page.textContent('#recordTimer') === '00:00' && await page.inputValue('#recordTitleInput') === '', 'dictaphone non réinitialisé');
    assert(blocked.length === 0 && page.jsErrors.length === 0, `requêtes bloquées ${blocked} / erreurs ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Annulation : rien n’est enregistré ni envoyé', async () => {
    const g = gemini();
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG });
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.isRecording);
    await page.waitForTimeout(1200);
    await page.click('#cancelRecordBtn');
    await page.waitForTimeout(1200); // un dernier morceau audio peut encore arriver
    assert(await page.evaluate(() => (state.recordings || []).length) === 0, 'enregistrement créé malgré l’annulation');
    assert(g.analyses.length === 0, 'audio envoyé à l’IA malgré l’annulation');
    assert(await page.textContent('#recordStatusText') === 'Prêt à enregistrer' && await page.isHidden('#pauseRecordBtn'), 'interface non réinitialisée');
    // Un nouvel enregistrement fonctionne ensuite normalement
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.isRecording);
    await page.waitForTimeout(1200);
    await page.click('#mainRecordBtn');
    await waitAnalysed(page);
    assert(await page.evaluate(() => state.recordings.length) === 1, 'enregistrement suivant');
    await context.close();
  });

  await t.scenario('Micro refusé : message clair, l’application reste utilisable', async () => {
    const { context, page } = await openApp(browser, base, { gemini: gemini(), config: CONFIG });
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => /Impossible d'accéder au microphone : Permission denied/.test(document.querySelector('#toastMessage').textContent));
    assert(!(await page.evaluate(() => state.isRecording)), 'état « enregistrement » malgré le refus');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Import de plusieurs fichiers : session à pistes, ajout d’une piste, relance de l’analyse', async () => {
    // Chaque piste est transcrite séparément, puis la synthèse porte sur la transcription complète
    const lines = { 'salle.wav': 'Côté salle, tout est prêt.', 'visio.wav': 'Côté visio, on vous entend.', 'telephone.wav': 'Au téléphone, je confirme.' };
    const g = gemini({
      analysis: (body) => {
        const name = JSON.stringify(body).match(/'([a-z]+\.wav)'/)[1];
        return { transcription: [{ speaker: name === 'salle.wav' ? 'Alice' : 'Bob', timestamp: '00:03', text: lines[name] }] };
      },
      synthesis: (body) => {
        const n = (JSON.stringify(body).match(/\[Piste \d+ •/g) || []).length;
        return { title: 'Atelier', summary: { executive: `Analyse conjointe de ${n} fichiers.`, decisions: [{ text: 'Format hybride retenu', refs: [2] }], key_points: [], tags: [], action_items: [] } };
      }
    });
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG });
    page.nextPrompt = 'Atelier salle + visio';
    await importAudio(page, [{ name: 'salle.wav', mimeType: 'audio/wav', buffer: wav }, { name: 'visio.wav', mimeType: 'audio/wav', buffer: wav }]);
    await waitAnalysed(page);
    let rec = await page.evaluate(() => state.activeRecording);
    assert(page.dialogs.some(d => d.includes('Titre pour cette analyse conjointe')), 'titre de la session demandé');
    assert(rec.title === 'Atelier', `titre après analyse : ${rec.title}`); // titre de l'IA (comportement actuel)
    assert(rec.files.length === 2 && await page.textContent('#detailFilesBadge') === '2 fichiers audio', 'deux pistes attendues');
    assert(g.analyses.length === 2 && g.analyses.every(a => a.contents[0].parts.filter(p => p.inline_data).length === 1), 'une transcription par piste attendue');
    assert(g.syntheses.length === 1 && ['Côté salle', 'Côté visio'].every(x => JSON.stringify(g.syntheses[0]).includes(x)), 'synthèse sur la transcription des deux pistes');
    assert(await page.$$eval('#trackPillsList .track-pill-btn', b => b.length) === 2, 'sélecteur de pistes');
    // Référence d'une décision → segment de la piste 2 : onglet transcription, piste 2 sélectionnée
    await page.click('#summaryDecisions .ref-chip');
    await page.waitForFunction(() => document.querySelector('#seg-1').classList.contains('seg-highlight'));
    assert(await page.isVisible('#tabContentTranscript') && await page.evaluate(() => state.activeFileIndex) === 1, 'saut vers le passage de la piste 2');
    assert((await page.textContent('#seg-1')).includes('Piste 2'), 'piste du passage affichée');
    // Ajout d'une troisième piste puis relance
    await page.setInputFiles('#addFileInput', { name: 'telephone.wav', mimeType: 'audio/wav', buffer: wav });
    await page.waitForFunction(() => state.activeRecording.files && state.activeRecording.files.length === 3, null, { timeout: 10000 });
    await page.click('#reprocessBtn');
    await page.waitForFunction(() => /3 fichiers/.test(document.querySelector('#summaryExecutive').textContent), null, { timeout: 15000 });
    assert(g.analyses.length === 5 && g.syntheses.length === 2, 'relance : trois pistes transcrites, nouvelle synthèse');
    rec = await page.evaluate(() => state.activeRecording);
    assert(rec.files.map(f => f.original_name).join() === 'salle.wav,visio.wav,telephone.wav', `pistes : ${rec.files.map(f => f.original_name)}`);
    await page.click('#trackPillsList .track-pill-btn[data-index="2"]');
    assert(await page.evaluate(() => state.activeFileIndex) === 2, 'choix de la piste 3');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadAudioBtn')]);
    assert(dl.suggestedFilename() === 'Atelier - piste 3 - telephone.wav', `nom du fichier téléchargé : ${dl.suggestedFilename()}`);
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Synthèse et transcription : orateurs, recherche, actions, copies, téléchargement', async () => {
    const { context, page } = await openApp(browser, base, { gemini: gemini(), config: CONFIG });
    const rec = await importAudio(page);
    // Renommer « Orateur 1 » partout
    await page.click('#tabTranscriptBtn');
    page.nextPrompt = 'Alice';
    await page.click('#speakersBar .speaker-rename-btn[data-speaker="Orateur 1"]');
    await page.waitForFunction(() => document.querySelector('#speakersBar').textContent.includes('Alice'));
    const fresh = await recording(page, rec.id);
    assert(fresh.transcription.filter(s => s.speaker === 'Alice').length === 2 && !fresh.transcription.some(s => s.speaker === 'Orateur 1'), 'orateur non renommé partout');
    // Recherche sans accents ni majuscules
    await page.fill('#searchTranscript', 'BUDGET EST VALIDE');
    assert(await page.textContent('#transcriptSearchInfo') === '1 occurrence dans 1 passage', `recherche : ${await page.textContent('#transcriptSearchInfo')}`);
    assert(await page.$$eval('.transcript-seg:not(.hidden)', s => s.length) === 1 && await page.$$eval('#transcriptTimeline mark, #transcriptTimeline .search-hit', m => m.length) >= 1, 'passage filtré et surligné');
    await page.fill('#searchTranscript', 'alice');
    assert(await page.textContent('#transcriptSearchInfo') === '2 passages (orateur)', `recherche par orateur : ${await page.textContent('#transcriptSearchInfo')}`);
    await page.fill('#searchTranscript', 'introuvable');
    assert(await page.textContent('#transcriptSearchInfo') === 'Aucun résultat', 'aucun résultat');
    await page.fill('#searchTranscript', '');
    // Copie de la transcription
    await page.click('#copyTranscriptBtn');
    await page.waitForTimeout(200);
    assert((await clip(page)).includes("[00:05] Bob: J'envoie le devis au fournisseur vendredi."), 'transcription copiée');
    // Action cochée : enregistrée
    await page.click('#tabSummaryBtn');
    await page.check('#summaryActions .action-check[data-index="0"]');
    await page.waitForTimeout(300);
    assert((await recording(page, rec.id)).summary.action_items[0].status === 'done', 'action non enregistrée comme faite');
    // Copie de la synthèse et export complet (Markdown)
    await page.click('#copySummaryBtn');
    await page.waitForTimeout(200);
    const summary = await clip(page);
    assert(summary.includes(ANALYSIS.summary.executive) && summary.includes('Budget de 120 k€ validé') && summary.includes('Envoyer le devis') && !summary.includes('Transcription Intégrale'), 'synthèse copiée');
    await page.click('#exportMarkdownBtn');
    await page.waitForTimeout(200);
    const md = await clip(page);
    assert(md.includes('Transcription Intégrale') && md.includes('**[00:00] Alice** : Bonjour à tous'), 'export Markdown complet');
    // Téléchargement de l'audio d'origine (identique au fichier importé)
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadAudioBtn')]);
    const bytes = fs.readFileSync(await dl.path());
    assert(dl.suggestedFilename() === 'Point projet Alpha.wav' && bytes.equals(wav), `audio téléchargé : ${dl.suggestedFilename()} (${bytes.length} octets)`);
    // Lecteur : clic sur un horodatage
    await page.click('#tabTranscriptBtn');
    await page.click('#seg-0 .timestamp-btn');
    await page.waitForTimeout(300);
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Erreur d’analyse : message affiché, relance réussie ensuite', async () => {
    const g = gemini();
    g.status = 400;
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG });
    const rec = await importAudio(page);
    assert(rec.status === 'error' && await page.textContent('#detailStatusBadge') === 'Erreur d’analyse', `statut : ${rec.status}`);
    assert(/Erreur IA/.test(await page.textContent('#toastMessage')), 'message d’erreur');
    g.status = null;
    await page.click('#reprocessBtn');
    await waitAnalysed(page);
    assert((await page.textContent('#summaryExecutive')).includes(ANALYSIS.summary.executive), 'relance');
    await context.close();
  });

  await t.scenario('Liste : recherche, nouvel enregistrement, suppression', async () => {
    let n = 0;
    const g = gemini({ analysis: () => ({ ...ANALYSIS, title: n++ ? 'Comité de pilotage' : 'Point projet Alpha' }) });
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG });
    await importAudio(page);
    await importAudio(page, { name: 'copil.wav', mimeType: 'audio/wav', buffer: wav });
    assert(await page.$$eval('#recordingsList .recording-item', i => i.length) === 2, 'deux enregistrements dans la liste');
    await page.fill('#searchRecordings', 'comite');
    await page.waitForTimeout(200);
    const visible = await page.$$eval('#recordingsList .recording-item', i => i.map(x => x.textContent));
    assert(visible.length === 1 && visible[0].includes('Comité de pilotage'), `recherche dans la liste : ${visible.length}`);
    await page.fill('#searchRecordings', '');
    await page.click('#newRecordBtn');
    assert(await page.isVisible('#recorderView') && await page.isHidden('#detailsView'), 'retour au dictaphone');
    await page.click('#recordingsList .recording-item >> nth=0');
    await page.waitForSelector('#detailsView:not(.hidden)');
    const title = await page.textContent('#detailTitle');
    await page.click('#deleteRecordBtn');
    await page.waitForFunction(() => state.recordings.length === 1);
    assert(page.dialogs.some(d => d.includes('Supprimer définitivement')), 'confirmation demandée');
    assert(await page.isVisible('#recorderView') && !(await page.textContent('#recordingsList')).includes(title), 'enregistrement supprimé');
    await context.close();
  });

  await t.scenario('Sauvegarde et restauration (fichier .voxai), rappel de sauvegarde', async () => {
    const { context, page } = await openApp(browser, base, { gemini: gemini(), config: CONFIG });
    const rec = await importAudio(page);
    await page.evaluate(() => openSettingsModal());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#backupExportBtn')]);
    assert(/^voxai-sauvegarde-\d{4}-\d\d-\d\d\.voxai$/.test(dl.suggestedFilename()), `nom de la sauvegarde : ${dl.suggestedFilename()}`);
    const file = path.join(tmp, dl.suggestedFilename());
    await dl.saveAs(file);
    // Tout effacer puis restaurer
    await page.evaluate(id => fetch('/api/recordings/' + id, { method: 'DELETE' }), rec.id);
    await page.evaluate(() => loadRecordings());
    assert(await page.evaluate(() => state.recordings.length) === 0, 'suppression avant restauration');
    await page.setInputFiles('#backupImportInput', file);
    await page.waitForFunction(() => state.recordings.length === 1);
    assert(/1 enregistrement restauré/.test(await page.textContent('#toastMessage')), `message : ${await page.textContent('#toastMessage')}`);
    const restored = await recording(page, rec.id);
    assert(restored.summary.executive === ANALYSIS.summary.executive && restored.transcription.length === 3, 'synthèse et transcription restaurées');
    await page.evaluate(id => { closeSettingsModal(); return selectRecording(id); }, rec.id);
    await page.waitForFunction(() => elements.audioElement.readyState >= 1 && elements.audioElement.duration > 0, null, { timeout: 5000 });
    const [audio] = await Promise.all([page.waitForEvent('download'), page.click('#downloadAudioBtn')]);
    assert(fs.readFileSync(await audio.path()).equals(wav), 'audio restauré différent de l’original');
    // Restaurer une seconde fois : rien n'est dupliqué
    await page.setInputFiles('#backupImportInput', file);
    await page.waitForFunction(() => /déjà présent/.test(document.querySelector('#toastMessage').textContent));
    assert(await page.evaluate(() => state.recordings.length) === 1, 'doublon créé');
    // Rappel : sauvegarde ancienne → bandeau, « Plus tard » → masqué
    await page.evaluate(() => { localStorage.setItem('voxai_last_backup', new Date(Date.now() - 10 * 86400000).toISOString()); });
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    await page.waitForTimeout(600);
    assert(await page.isVisible('#backupReminder'), 'rappel de sauvegarde absent');
    await page.click('#backupReminderLater');
    assert(await page.isHidden('#backupReminder'), 'rappel non masqué');
    await context.close();
  });

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  t.finish();
})().catch(err => { console.error(err); process.exit(1); });
