/**
 * VoxAI — tests de bout en bout : enregistrer une visioconférence (Meet, Teams, Zoom) sur le même poste.
 * Le micro et le son de la réunion (fenêtre « Partager » du navigateur, getDisplayMedia) sont mélangés
 * dans une seule piste.
 *
 * Simulations : micro = son pur de 500 Hz, réunion = son pur de 3 000 Hz. L'audio enregistré est relu
 * dans la base du navigateur et analysé (Goertzel) pour vérifier que les deux sources y sont.
 * Lancement : node tests/e2e/visio.test.js
 */
'use strict';

const { startServer, createRunner, assert, launchBrowser, gemini, openApp, waitAnalysed } = require('./lib');

const CONFIG = { provider: 'gemini', gemini_api_key: 'cle-test' };
const HINT = 'visioconférence captée sur le poste';

/** Micro et partage d'écran simulés ; window.__display.mode : ok | noaudio | deny | silent. */
function fakeCapture({ noDisplay = false } = {}) {
  const tone = (freq, gain) => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g).connect(dest);
    osc.start();
    return dest.stream;
  };
  window.__display = { mode: 'ok', calls: [], streams: [] };
  window.__mics = [];
  navigator.mediaDevices.getUserMedia = async () => { const s = tone(500, 0.3); window.__mics.push(s); return s; };
  if (noDisplay) { navigator.mediaDevices.getDisplayMedia = undefined; return; }
  navigator.mediaDevices.getDisplayMedia = async (constraints) => {
    window.__display.calls.push(constraints);
    if (window.__display.mode === 'deny') throw new DOMException('Permission denied', 'NotAllowedError');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 16, 16);
    const stream = new MediaStream(canvas.captureStream(1).getVideoTracks());
    if (window.__display.mode !== 'noaudio') tone(3000, window.__display.mode === 'silent' ? 0 : 0.3).getAudioTracks().forEach(t => stream.addTrack(t));
    window.__display.streams.push(stream);
    return stream;
  };
}

/** Amplitude de quelques fréquences dans l'audio enregistré (lu dans IndexedDB, décodé, Goertzel). */
function tones(page, recId, freqs) {
  return page.evaluate(async ({ recId, freqs }) => {
    const db = await new Promise((ok, ko) => { const r = indexedDB.open('voxai'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const files = await new Promise((ok, ko) => { const r = db.transaction('files').objectStore('files').index('recording_id').getAll(recId); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const audio = await new AudioContext().decodeAudioData(await files[0].blob.arrayBuffer());
    const data = audio.getChannelData(0);
    const sr = audio.sampleRate;
    const from = Math.floor(data.length * 0.2), to = Math.floor(data.length * 0.8); // hors attaque et fin
    const out = {};
    for (const f of freqs) {
      const k = 2 * Math.cos(2 * Math.PI * f / sr);
      let s1 = 0, s2 = 0;
      for (let i = from; i < to; i++) { const s0 = data[i] + k * s1 - s2; s2 = s1; s1 = s0; }
      const n = to - from;
      out[f] = Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) * 2 / n;
    }
    return out;
  }, { recId, freqs });
}

async function open(browser, base, g, opts = {}) {
  const app = await openApp(browser, base, { gemini: g, config: CONFIG });
  await app.context.addInitScript(fakeCapture, opts);
  await app.page.reload();
  await app.page.waitForFunction(() => typeof state !== 'undefined' && state.config && window.__display);
  await app.page.waitForTimeout(300);
  await app.page.evaluate(() => { try { closeSettingsModal(); } catch {} });
  return app;
}

const toast = (page) => page.textContent('#toastMessage');
const width = (page, id) => page.$eval(id, el => parseFloat(el.style.width) || 0);

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launchBrowser();
  const t = createRunner('Tests de bout en bout : enregistrer une visioconférence (micro + son de la réunion)');

  await t.scenario('Micro + son de la visio : les deux voix dans la même piste, niveaux affichés, consigne d’analyse', async () => {
    const g = gemini();
    const { context, page } = await open(browser, base, g);
    assert(await page.isChecked('input[name="captureSource"][value="mic"]'), 'micro seul par défaut');
    await page.click('#captureMeetingLabel');
    assert(/Partager l’audio/.test(await page.textContent('#captureHint')), `aide : ${await page.textContent('#captureHint')}`);
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.isRecording);
    const c = await page.evaluate(() => window.__display.calls[0]);
    assert(c.video === true && c.audio.echoCancellation === false && c.systemAudio === 'include', `options du partage : ${JSON.stringify(c)}`);
    assert(await page.evaluate(() => window.__display.streams[0].getVideoTracks()[0].enabled === false), 'image du partage utilisée');
    assert(await page.isVisible('#captureLevels') && /micro \+ son de la réunion/.test(await page.textContent('#recordStatusText')), 'indicateurs et statut de la visio');
    assert(await page.isDisabled('input[name="captureSource"][value="mic"]'), 'source modifiable pendant l’enregistrement');
    await page.waitForTimeout(2500);
    assert(await width(page, '#levelMic') > 0 && await width(page, '#levelMeeting') > 0, 'niveaux « Vous » et « Réunion »');
    await page.click('#mainRecordBtn');
    await waitAnalysed(page);
    const rec = await page.evaluate(() => state.activeRecording);
    assert(rec.capture === 'visio', 'source non enregistrée');
    assert(JSON.stringify(g.analyses[0]).includes(HINT), 'consigne « visioconférence » absente de l’analyse');
    const a = await tones(page, rec.id, [500, 3000, 1700]);
    assert(a[500] > 0.02 && a[3000] > 0.02, `voix absentes de l’enregistrement : micro ${a[500].toFixed(3)}, réunion ${a[3000].toFixed(3)}`);
    assert(a[1700] < a[500] / 5, `bruit inattendu : ${JSON.stringify(a)}`);
    assert(await page.evaluate(() => window.__display.streams[0].getTracks().every(tr => tr.readyState === 'ended')), 'partage non arrêté à la fin');
    // Choix mémorisé, sélecteur de nouveau disponible
    await page.click('#newRecordBtn');
    assert(await page.isEnabled('input[name="captureSource"][value="mic"]') && await page.isHidden('#captureLevels'), 'dictaphone non réinitialisé');
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    assert(await page.isChecked('input[name="captureSource"][value="meeting"]'), 'choix non mémorisé');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Partage sans son : enregistrement non démarré, message clair ; micro seul ensuite', async () => {
    const g = gemini();
    const { context, page } = await open(browser, base, g);
    await page.click('#captureMeetingLabel');
    await page.evaluate(() => { window.__display.mode = 'noaudio'; });
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => /Aucun son partagé/.test(document.querySelector('#toastMessage').textContent));
    assert(!(await page.evaluate(() => state.isRecording)) && (await page.textContent('#recordStatusText')).trim() === 'Prêt à enregistrer', `enregistrement démarré sans le son de la réunion : ${await page.evaluate(() => state.isRecording)} « ${await page.textContent('#recordStatusText')} »`);
    assert(await page.evaluate(() => window.__mics[0].getTracks().every(tr => tr.readyState === 'ended')), 'micro resté ouvert');
    // Micro seul : rien n'est demandé au partage, pas de consigne « visio »
    await page.click('label:has(input[name="captureSource"][value="mic"])');
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.isRecording);
    assert(await page.isHidden('#captureLevels'), 'indicateurs visio en micro seul');
    await page.waitForTimeout(2200);
    await page.click('#mainRecordBtn');
    await waitAnalysed(page);
    const rec = await page.evaluate(() => state.activeRecording);
    assert(await page.evaluate(() => window.__display.calls.length) === 1 && !rec.capture && !JSON.stringify(g.analyses[0]).includes(HINT), 'micro seul');
    const a = await tones(page, rec.id, [500, 3000]);
    assert(a[500] > 0.02 && a[3000] < 0.005, `micro seul : ${JSON.stringify(a)}`);
    await context.close();
  });

  await t.scenario('Partage annulé : retour à l’état prêt, sans erreur', async () => {
    const { context, page } = await open(browser, base, gemini());
    await page.click('#captureMeetingLabel');
    await page.evaluate(() => { window.__display.mode = 'deny'; });
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => /Partage annulé/.test(document.querySelector('#toastMessage').textContent));
    assert(!(await page.evaluate(() => state.isRecording)) && await page.isEnabled('input[name="captureSource"][value="meeting"]'), 'état après annulation');
    assert(await page.evaluate(() => (state.recordings || []).length) === 0 && page.jsErrors.length === 0, 'enregistrement créé ou erreur');
    await context.close();
  });

  await t.scenario('Partage arrêté pendant la visio : l’enregistrement continue avec le micro', async () => {
    const { context, page } = await open(browser, base, gemini());
    await page.click('#captureMeetingLabel');
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.isRecording);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__display.streams[0].getTracks().forEach(tr => { tr.stop(); tr.dispatchEvent(new Event('ended')); }));
    await page.waitForFunction(() => /Partage du son de la visio arrêté/.test(document.querySelector('#toastMessage').textContent));
    assert(await page.evaluate(() => state.isRecording), 'enregistrement interrompu');
    await page.waitForTimeout(1500);
    assert(await width(page, '#levelMeeting') === 0, 'niveau de la réunion après l’arrêt du partage');
    await page.click('#mainRecordBtn');
    await waitAnalysed(page);
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Réunion muette, pause, reprise et annulation en mode visio', async () => {
    const { context, page } = await open(browser, base, gemini());
    await page.click('#captureMeetingLabel');
    await page.evaluate(() => { window.__display.mode = 'silent'; });
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.isRecording);
    await page.waitForFunction(() => /Aucun son de la réunion depuis 10 s/.test(document.querySelector('#toastMessage').textContent), null, { timeout: 15000 });
    await page.click('#pauseRecordBtn');
    assert(await page.evaluate(() => state.mediaRecorder.state) === 'paused', 'pause');
    await page.click('#pauseRecordBtn');
    assert(await page.evaluate(() => state.mediaRecorder.state) === 'recording', 'reprise');
    await page.click('#cancelRecordBtn');
    await page.waitForTimeout(800);
    assert(await page.evaluate(() => (state.recordings || []).length) === 0, 'enregistrement créé malgré l’annulation');
    assert(await page.evaluate(() => window.__display.streams[0].getTracks().every(tr => tr.readyState === 'ended')), 'partage non arrêté après l’annulation');
    assert(await page.isHidden('#captureLevels') && page.jsErrors.length === 0, 'interface après l’annulation');
    await context.close();
  });

  await t.scenario('Navigateur sans capture du son (Firefox, Safari) : option désactivée, micro seul', async () => {
    const { context, page } = await open(browser, base, gemini(), { noDisplay: true });
    await page.evaluate(() => localStorage.setItem('voxai_capture_source', 'meeting'));
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    assert(await page.isDisabled('input[name="captureSource"][value="meeting"]') && await page.isChecked('input[name="captureSource"][value="mic"]'), 'option disponible sans getDisplayMedia');
    assert(/Non disponible dans ce navigateur/.test(await page.textContent('#captureHint')), `motif : ${await page.textContent('#captureHint')}`);
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => state.isRecording);
    await page.waitForTimeout(1500);
    await page.click('#mainRecordBtn');
    await waitAnalysed(page);
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await browser.close();
  server.close();
  t.finish();
})().catch(err => { console.error(err); process.exit(1); });
