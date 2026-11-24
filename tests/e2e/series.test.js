/**
 * VoxAI — tests de bout en bout : séries de réunions, suivi des actions, brief, échéances,
 * e-mail aux participants.
 *
 * Gemini simulé, aucun accès Internet.
 * Lancement : node tests/e2e/series.test.js
 */
'use strict';

const fs = require('fs');
const { AUDIO, startServer, createRunner, assert, launchBrowser, gemini, openApp, importAudio, waitAnalysed, downloadText, emlText, emlSubject, recording } = require('./lib');

const CONFIG = { provider: 'gemini', gemini_api_key: 'cle-test' };
const wav = fs.readFileSync(AUDIO);
const audio = (name) => ({ name, mimeType: 'audio/wav', buffer: wav });

/** Deux réunions d'une même série : la seconde fait le point sur les actions de la première. */
const MEETINGS = [
  {
    title: 'IA', transcription: [{ speaker: 'Alice', timestamp: '00:00', text: 'Bonjour.' }, { speaker: 'Bob', timestamp: '00:01', text: "J'envoie le devis." }],
    summary: {
      executive: 'Réunion 1 : lancement.', decisions: [{ text: 'Budget validé', refs: [1] }], key_points: [], tags: [],
      action_items: [
        { task: 'Envoyer le devis', assignee: 'Bob', deadline: '2026-11-27', refs: [2] },
        { task: 'Réserver la salle', assignee: 'Alice', deadline: '2020-01-10', refs: [1] },
        { task: 'Mettre à jour le planning', assignee: 'Chloé', deadline: 'À définir', refs: [1] }
      ]
    }
  },
  {
    title: 'IA', transcription: [{ speaker: 'Bob', timestamp: '00:00', text: 'Le devis est parti lundi.' }, { speaker: 'Alice', timestamp: '00:02', text: 'La salle, je cherche encore.' }, { speaker: 'Chloé', timestamp: '00:04', text: 'Planning fait.' }],
    summary: {
      executive: 'Réunion 2 : avancement.', decisions: [], key_points: [], tags: [],
      action_items: [{ task: 'Préparer la démo', assignee: 'Alice', deadline: '2026-12-03', refs: [2] }],
      action_followup: [
        { id: 'A1', status: 'done', note: 'Devis envoyé lundi', refs: [1] },
        { id: 'A2', status: 'in_progress', note: 'Salle pas encore trouvée', refs: [2] },
        { id: 'A3', status: 'done', note: 'Planning fait', refs: [3] },
        { id: 'A9', status: 'done', note: 'identifiant inventé par l’IA' }
      ]
    }
  }
];

async function newSeries(page, name, people) {
  await page.selectOption('#seriesSelect', '__new__');
  await page.waitForSelector('#seriesForm:not(.hidden)');
  await page.fill('#seriesName', name);
  for (let i = 0; i < people.length; i++) {
    if (i > 0) await page.click('#seriesAddParticipant');
    const row = (await page.$$('#seriesParticipants .series-participant'))[i];
    await (await row.$('.sp-name')).fill(people[i][0]);
    await (await row.$('.sp-email')).fill(people[i][1]);
  }
  await page.click('#seriesSaveBtn');
  await page.waitForFunction(() => /enregistrée|obligatoire|invalide|même nom|nom\./.test(document.querySelector('#seriesFormStatus').textContent));
  return page.textContent('#seriesFormStatus');
}

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launchBrowser();
  const t = createRunner('Tests de bout en bout : séries, suivi des actions, brief, e-mails');

  await t.scenario('Séries : création (contrôles de saisie), rattachement, filtre, modification, suppression', async () => {
    const { context, page } = await openApp(browser, base, { gemini: gemini(), config: CONFIG });
    assert(await page.isHidden('#seriesFilter') && await page.isHidden('#seriesFollowBtn'), 'filtre et suivi masqués sans série');
    // Contrôles de saisie
    let status = await newSeries(page, '', []);
    assert(status === 'Le nom de la série est obligatoire.', `nom vide : ${status}`);
    await page.fill('#seriesName', 'Point Alpha');
    await (await page.$('#seriesParticipants .sp-email')).fill('pas-une-adresse');
    await (await page.$('#seriesParticipants .sp-name')).fill('Alice');
    await page.click('#seriesSaveBtn');
    assert(/Adresse invalide : pas-une-adresse/.test(await page.textContent('#seriesFormStatus')), 'adresse invalide acceptée');
    await page.click('#seriesCloseBtn');
    status = await newSeries(page, 'Point Alpha', [['Alice', 'alice@corp.fr'], ['alice', 'a2@corp.fr']]);
    assert(status === 'Deux participants portent le même nom.', `doublon : ${status}`);
    await page.click('#seriesParticipants .series-participant:nth-child(2) .sp-remove');
    await page.click('#seriesAddParticipant');
    const rows = await page.$$('#seriesParticipants .series-participant');
    await (await rows[1].$('.sp-name')).fill('Bob');
    await (await rows[1].$('.sp-email')).fill('bob@corp.fr');
    await page.click('#seriesAddParticipant');
    await (await (await page.$$('#seriesParticipants .series-participant'))[2].$('.sp-name')).fill('Chloé');
    await page.click('#seriesSaveBtn');
    await page.waitForFunction(() => document.querySelector('#seriesFormStatus').textContent === '✓ Série enregistrée');
    assert((await page.textContent('#seriesList')).includes('3 participant(s)'), 'liste des séries');
    await page.click('#seriesCloseBtn');
    assert(await page.$eval('#seriesSelect', s => s.options[s.selectedIndex].text) === 'Point Alpha', 'série choisie pour le prochain enregistrement');
    // Enregistrement rattaché : titre daté conservé après l'analyse
    const rec = await importAudio(page, audio('r1.wav'));
    const series = await page.evaluate(() => fetch('/api/series').then(r => r.json()));
    assert(rec.series_id === series[0].id && /^Point Alpha — \d+ \w+ 2\d{3}$/.test(rec.title), `rattachement / titre : ${rec.title}`);
    assert(await page.isVisible('#sendParticipantsBtn'), 'bouton « Envoyer aux participants »');
    // Enregistrement hors série puis filtre de la liste
    await page.click('#newRecordBtn');
    await page.selectOption('#seriesSelect', '');
    await importAudio(page, audio('hors-serie.wav'));
    await page.selectOption('#seriesFilter', series[0].id);
    assert(await page.$$eval('#recordingsList .recording-item', i => i.length) === 1, 'filtre par série');
    await page.selectOption('#seriesFilter', '__none__');
    assert(await page.$$eval('#recordingsList .recording-item', i => i.length) === 1, 'filtre « hors série »');
    await page.selectOption('#seriesFilter', '');
    // Détacher puis rattacher depuis la page de l'enregistrement
    await page.evaluate(id => selectRecording(id), rec.id);
    await page.selectOption('#detailSeriesSelect', '');
    await page.waitForFunction(() => /Détaché/.test(document.querySelector('#toastMessage').textContent));
    assert((await recording(page, rec.id)).series_id === null && await page.isHidden('#sendParticipantsBtn'), 'détachement');
    await page.selectOption('#detailSeriesSelect', series[0].id);
    await page.waitForFunction(() => /Rattaché à « Point Alpha »/.test(document.querySelector('#toastMessage').textContent));
    // Modification : renommer la série, retirer un participant
    await page.click('#seriesManageBtn');
    await page.waitForSelector('#seriesModal:not(.hidden)');
    await page.waitForTimeout(300);
    await page.click(`#seriesList .series-item[data-id="${series[0].id}"]`);
    await page.fill('#seriesName', 'Point Alpha (hebdo)');
    await page.click('#seriesParticipants .series-participant:nth-child(3) .sp-remove');
    await page.click('#seriesSaveBtn');
    await page.waitForFunction(() => document.querySelector('#seriesFormStatus').textContent === '✓ Série enregistrée');
    const edited = (await page.evaluate(() => fetch('/api/series').then(r => r.json())))[0];
    assert(edited.name === 'Point Alpha (hebdo)' && edited.participants.length === 2, `modification : ${JSON.stringify(edited)}`);
    // Suppression : les enregistrements sont conservés, sans série
    await page.click('#seriesDeleteBtn');
    await page.waitForFunction(() => /Série supprimée/.test(document.querySelector('#toastMessage').textContent));
    assert(page.dialogs.some(d => d.includes('Ses enregistrements sont conservés')), 'confirmation');
    assert((await recording(page, rec.id)).series_id === null && await page.evaluate(() => state.recordings.length) === 2, 'enregistrements conservés');
    assert(await page.isHidden('#seriesFilter'), 'filtre encore visible sans série');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Suivi des actions d’une réunion à l’autre : prompt, suivi, clôture, fenêtre de suivi', async () => {
    const g = gemini({ analysis: (body, n) => MEETINGS[Math.min(n, 1)] });
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG });
    const series = await page.evaluate(() => fetch('/api/series', { method: 'POST', body: JSON.stringify({ name: 'Point Alpha', participants: [{ name: 'Alice', email: 'alice@corp.fr' }, { name: 'Bob', email: 'bob@corp.fr' }, { name: 'Chloé' }] }) }).then(r => r.json()));
    await page.evaluate(id => { localStorage.setItem('voxai_last_series', id); return VoxSeries.reload(); }, series.id);
    await page.selectOption('#seriesSelect', series.id);
    const r1 = await importAudio(page, audio('r1.wav'));
    const prompt1 = JSON.stringify(g.analyses[0]);
    assert(!prompt1.includes('Actions encore ouvertes'), 'première réunion : aucune action précédente');
    assert(/La réunion a eu lieu le/.test(prompt1) && prompt1.includes('AAAA-MM-JJ'), 'date de la réunion transmise (échéances datées)');
    assert(await page.isHidden('#followupCard'), 'bloc de suivi affiché sans action précédente');
    // Échéances : date longue, badge « en retard »
    const actions = await page.innerText('#summaryActions');
    assert(actions.includes('ven. 27 nov.') && await page.$$eval('#summaryActions .deadline-overdue', e => e.length) === 1, `échéances : ${actions.replace(/\n/g, ' | ')}`);
    await page.waitForTimeout(1100); // dates distinctes
    await page.click('#newRecordBtn');
    const r2 = await importAudio(page, audio('r2.wav'));
    const prompt2 = JSON.stringify(g.analyses[1]);
    assert(['A1 : Envoyer le devis — Bob', 'A2 : Réserver la salle — Alice', 'A3 : Mettre à jour le planning — Chloé'].every(x => prompt2.includes(x)) && prompt2.includes('action_followup'), 'actions ouvertes transmises à l’IA');
    await page.waitForSelector('#followupCard:not(.hidden)');
    const fu = r2.summary.action_followup;
    assert(fu.length === 3 && !fu.some(f => f.note.includes('inventé')), `suivi (identifiant inventé écarté) : ${JSON.stringify(fu)}`);
    assert(await page.$$eval('#followupList .follow-row', r => r.length) === 3, 'lignes de suivi');
    // « Clôturer les 2 » : les actions terminées sont cochées dans la réunion 1
    assert(/2/.test(await page.textContent('#followupApplyAll')), 'bouton de clôture groupée');
    await page.click('#followupApplyAll');
    await page.waitForFunction(id => fetch('/api/recordings/' + id).then(r => r.json()).then(r => r.summary.action_items.filter(a => a.status === 'done').length === 2), r1.id);
    await page.waitForSelector('#followupApplyAll', { state: 'hidden' });
    assert(await page.$$eval('#followupList .follow-badge-closed', e => e.length) === 2, 'actions marquées « clôturées »');
    // Fenêtre de suivi : actions ouvertes, cocher / décocher
    await page.click('#seriesFollowBtn');
    await page.waitForSelector('#followModal:not(.hidden)');
    await page.waitForTimeout(300);
    assert(/2/.test(await page.textContent('#followOpenCount')), `actions ouvertes : ${await page.textContent('#followOpenCount')}`);
    const rowsText = await page.innerText('#followActionsList');
    assert(rowsText.includes('Réserver la salle') && rowsText.includes('Préparer la démo') && !rowsText.includes('Envoyer le devis'), `liste : ${rowsText.replace(/\n/g, ' | ')}`);
    await page.check('#followShowDone');
    assert(await page.$$eval('#followActionsList .follow-row', e => e.length) === 4, 'actions terminées affichées');
    const idx = await page.$$eval('#followActionsList .follow-row', rows => rows.findIndex(r => r.textContent.includes('Réserver la salle')));
    await (await page.$$('#followActionsList .follow-check'))[idx].check();
    await page.waitForFunction(id => fetch('/api/recordings/' + id).then(r => r.json()).then(r => r.summary.action_items[1].status === 'done'), r1.id);
    assert(/1/.test(await page.textContent('#followOpenCount')), 'compteur après clôture');
    const idx2 = await page.$$eval('#followActionsList .follow-row', rows => rows.findIndex(r => r.textContent.includes('Réserver la salle')));
    await (await page.$$('#followActionsList .follow-check'))[idx2].uncheck();
    await page.waitForFunction(id => fetch('/api/recordings/' + id).then(r => r.json()).then(r => r.summary.action_items[1].status !== 'done'), r1.id);
    // Brief avant la réunion suivante : en retard d'abord, copie, envoi aux participants (.eml)
    await page.click('#followTabBrief');
    const brief = await page.innerText('#followBriefPreview');
    assert(brief.indexOf('Réserver la salle') < brief.indexOf('Préparer la démo') && /retard/i.test(brief), `brief : ${brief.replace(/\n/g, ' | ')}`);
    await page.click('#followBriefCopy');
    await page.waitForTimeout(200);
    assert((await page.evaluate(() => navigator.clipboard.readText())).includes('Réserver la salle'), 'brief copié');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#followBriefSend')]);
    const eml = await downloadText(dl);
    assert(/^To: alice@corp\.fr, bob@corp\.fr/m.test(eml) && emlText(eml).includes('Préparer la démo'), `brief envoyé : ${(eml.match(/^To: .*$/m) || [''])[0]}`);
    await page.keyboard.press('Escape');
    assert(await page.isHidden('#followModal'), 'Échap ne ferme pas la fenêtre de suivi');
    // Réunion 1 : pas de bloc de suivi
    await page.evaluate(id => selectRecording(id), r1.id);
    assert(await page.isHidden('#followupCard'), 'bloc de suivi sur la première réunion');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('E-mail aux participants : destinataires, contenu, participants sans adresse', async () => {
    const g = gemini({ analysis: (body, n) => MEETINGS[Math.min(n, 1)] });
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG });
    const series = await page.evaluate(() => fetch('/api/series', { method: 'POST', body: JSON.stringify({ name: 'Point Alpha', participants: [{ name: 'Alice', email: 'alice@corp.fr' }, { name: 'Bob', email: 'bob@corp.fr' }, { name: 'Chloé' }] }) }).then(r => r.json()));
    await page.evaluate(id => { localStorage.setItem('voxai_last_series', id); return VoxSeries.reload(); }, series.id);
    await page.selectOption('#seriesSelect', series.id);
    await importAudio(page, audio('r1.wav'));
    await page.waitForTimeout(1100);
    await page.click('#newRecordBtn');
    await importAudio(page, audio('r2.wav'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sendParticipantsBtn')]);
    assert(page.dialogs.some(d => d.includes('Sans adresse e-mail, non destinataires : Chloé')), 'participant sans adresse non signalé');
    const eml = await downloadText(dl);
    const body = emlText(eml);
    assert(/^To: alice@corp\.fr, bob@corp\.fr\r?$/m.test(eml), `destinataires : ${(eml.match(/^To: .*$/m) || [''])[0]}`);
    assert(/^Compte rendu — Point Alpha — \d+ \w+ 2\d{3}$/.test(emlSubject(eml)), `objet : ${emlSubject(eml)}`);
    for (const part of ['Réunion 2 : avancement.', 'Préparer la démo — Alice (jeudi 3 décembre 2026)', 'Suivi des actions précédentes', '[terminée] Envoyer le devis — Bob : Devis envoyé lundi', '[en cours] Réserver la salle — Alice']) {
      assert(body.includes(part), `e-mail : « ${part} » absent`);
    }
    await context.close();
  });

  await browser.close();
  server.close();
  t.finish();
})().catch(err => { console.error(err); process.exit(1); });
