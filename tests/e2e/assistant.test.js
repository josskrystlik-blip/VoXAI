/**
 * VoxAI — tests de bout en bout : assistant IA (onglet d'un enregistrement et assistant global),
 * e-mails rédigés par l'IA, corrections de synthèse proposées puis validées, transcription en direct.
 *
 * Gemini et reconnaissance vocale du navigateur simulés, aucun accès Internet.
 * Lancement : node tests/e2e/assistant.test.js
 */
'use strict';

const { ANALYSIS, startServer, createRunner, assert, launchBrowser, gemini, llmServer, whisperServer, openApp, importAudio, waitAnalysed, downloadText, emlText, emlSubject, recording } = require('./lib');

const CONFIG = { provider: 'gemini', gemini_api_key: 'cle-test' };
const EMAIL = 'Objet : Compte rendu du point projet\n\nBonjour à tous,\n\nLe budget est **validé**.\n\n- Bob envoie le devis vendredi\n\nBonne journée,\nAlice';

/** Assistant simulé : la réponse dépend de la question. */
function assistantReplies(ctx) {
  return (text) => {
    if (/e-mail/i.test(text)) return EMAIL;
    if (/corrige/i.test(text)) {
      return 'Je corrige l’échéance et j’ajoute la décision oubliée.\n```voxai-summary\n' + JSON.stringify({
        recording_id: ctx.recId, title: 'Point projet Alpha (corrigé)',
        summary: { ...ANALYSIS.summary, decisions: [...ANALYSIS.summary.decisions, { text: 'Démarrage le 1er décembre' }], action_items: [{ task: 'Envoyer le devis', assignee: 'Bob', deadline: '2026-11-28' }] }
      }) + '\n```';
    }
    if (/cassé/i.test(text)) return 'Voici.\n```voxai-summary\n{ pas du json }\n```';
    if (/combien/i.test(text)) return `Il y a **${ctx.count || 1} réunion(s)** enregistrée(s).`;
    return 'Le devis part **vendredi**.';
  };
}

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launchBrowser();
  const t = createRunner('Tests de bout en bout : assistant IA, e-mails, corrections, transcription en direct');

  await t.scenario('Onglet Assistant d’un enregistrement : question, historique, suggestions', async () => {
    const ctx = {};
    const g = gemini({ chat: assistantReplies(ctx) });
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG });
    const rec = await importAudio(page);
    await page.click('#tabChatBtn');
    await page.fill('#chatInput', 'Quand part le devis ?');
    await page.click('#chatSendBtn');
    await page.waitForFunction(() => /vendredi/.test(document.querySelector('#chatMessages').textContent) && !document.querySelector('#chatLoading'));
    assert(await page.$eval('#chatMessages', el => el.innerHTML.includes('<strong>vendredi</strong>')), 'mise en forme Markdown de la réponse');
    const sent = JSON.stringify(g.chats[0]);
    assert(sent.includes(rec.id) && sent.includes("J'envoie le devis au fournisseur vendredi."), 'transcription et synthèse transmises à l’IA');
    // Réponse copiable
    await page.click('#chatMessages .chat-action-btn');
    await page.waitForTimeout(200);
    assert((await page.evaluate(() => navigator.clipboard.readText())).includes('Le devis part vendredi.'), 'réponse copiée (texte sans Markdown)');
    // Historique conservé
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    await page.evaluate(id => selectRecording(id), rec.id);
    await page.click('#tabChatBtn');
    assert((await page.textContent('#chatMessages')).includes('Quand part le devis ?'), 'historique perdu');
    // Suggestion de question en un clic
    await page.click('.chat-prompt-chip >> nth=0');
    await page.waitForFunction(() => document.querySelectorAll('#chatMessages > div').length === 5 && !document.querySelector('#chatLoading'));
    assert(g.chats.length === 2, 'suggestion non envoyée');
    // Erreur de l'IA : message dans la conversation
    g.status = 400;
    await page.fill('#chatInput', 'Encore une question');
    await page.click('#chatSendBtn');
    await page.waitForFunction(() => /Erreur/.test(document.querySelector('#chatMessages').lastElementChild.textContent));
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('E-mail rédigé par l’IA : copie, objet, choix de la messagerie (Outlook .eml, lien mailto)', async () => {
    const ctx = {};
    const { context, page } = await openApp(browser, base, { gemini: gemini({ chat: assistantReplies(ctx) }), config: CONFIG });
    await importAudio(page);
    await page.click('#tabChatBtn');
    await page.fill('#chatInput', 'Rédige un e-mail de compte rendu');
    await page.click('#chatSendBtn');
    await page.waitForSelector('#chatMessages .mail-split');
    const labels = await page.$$eval('#chatMessages .chat-actions button', b => b.map(x => x.textContent.trim()));
    assert(labels[0] === '📋 Copier l’e-mail' && labels[1] === '🏷️ Copier l’objet' && labels[2].startsWith('✉️ Créer le mail · Outlook (application)'), `boutons : ${labels.join(' | ')}`);
    await page.click('#chatMessages .chat-actions button >> nth=1');
    await page.waitForTimeout(200);
    assert(await page.evaluate(() => navigator.clipboard.readText()) === 'Compte rendu du point projet', 'objet copié');
    await page.click('#chatMessages .chat-actions button >> nth=0');
    await page.waitForTimeout(200);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(copied.startsWith('Bonjour à tous,') && !copied.includes('Objet') && !copied.includes('**'), `corps copié : ${copied.slice(0, 60)}`);
    // Outlook (application) : brouillon .eml
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#chatMessages .mail-main')]);
    const eml = await downloadText(dl);
    assert(emlSubject(eml) === 'Compte rendu du point projet' && emlText(eml).includes('<strong>validé</strong>'), 'brouillon .eml (HTML mis en forme)');
    // Messagerie par défaut : choix mémorisé, lien mailto avec le corps
    await page.evaluate(() => { window.__mailto = []; window.launchMailto = (u) => window.__mailto.push(u); });
    await page.click('#chatMessages .mail-toggle');
    await page.click('#chatMessages .mail-menu button[data-target="mailto"]');
    await page.waitForFunction(() => window.__mailto.length === 1);
    const url = await page.evaluate(() => window.__mailto[0]);
    assert(url.startsWith('mailto:?subject=Compte%20rendu%20du%20point%20projet&body=Bonjour%20%C3%A0%20tous'), `lien : ${url.slice(0, 90)}`);
    assert(await page.evaluate(() => localStorage.getItem('voxai_mail_target')) === 'mailto', 'choix non mémorisé');
    assert((await page.textContent('#chatMessages .mail-main')).includes('Messagerie par défaut'), 'libellé du bouton non mis à jour');
    await context.close();
  });

  await t.scenario('Correction de la synthèse proposée par l’IA : comparaison, application, annulation, refus', async () => {
    const ctx = {};
    const { context, page } = await openApp(browser, base, { gemini: gemini({ chat: assistantReplies(ctx) }), config: CONFIG });
    const rec = await importAudio(page);
    ctx.recId = rec.id;
    await page.click('#tabChatBtn');
    await page.fill('#chatInput', 'Corrige l’échéance du devis : samedi');
    await page.click('#chatSendBtn');
    await page.waitForSelector('#chatMessages .proposal-apply');
    const changes = await page.innerText('#chatMessages .proposal-changes');
    for (const part of ['Titre', 'Point projet Alpha (corrigé)', 'Décision', 'Démarrage le 1er décembre', 'Action', '📅 2026-11-28']) {
      assert(changes.includes(part), `comparaison : « ${part} » absent (${changes.replace(/\n/g, ' | ')})`);
    }
    assert(!(await page.textContent('#chatMessages')).includes('voxai-summary'), 'bloc technique affiché');
    await page.click('#chatMessages .proposal-apply');
    await page.waitForFunction(() => /Correction appliquée/.test(document.querySelector('#chatMessages .proposal-actions').textContent));
    let fresh = await recording(page, rec.id);
    assert(fresh.title === 'Point projet Alpha (corrigé)' && fresh.summary.decisions.length === 2 && fresh.summary.action_items[0].deadline === '2026-11-28', 'correction non enregistrée');
    assert(await page.textContent('#detailTitle') === 'Point projet Alpha (corrigé)' && (await page.textContent('#summaryDecisions')).includes('Démarrage le 1er décembre'), 'affichage non rafraîchi');
    // Annuler : la synthèse précédente est rétablie
    await page.click('#chatMessages .proposal-actions .proposal-ignore');
    await page.waitForFunction(() => /Correction annulée/.test(document.querySelector('#chatMessages .proposal-actions').textContent));
    fresh = await recording(page, rec.id);
    assert(fresh.title === ANALYSIS.title && fresh.summary.decisions.length === 1, 'annulation');
    // « Ignorer » une nouvelle proposition : rien ne change
    await page.fill('#chatInput', 'Corrige encore');
    await page.click('#chatSendBtn');
    await page.waitForFunction(() => { const c = document.querySelectorAll('#chatMessages .proposal-card'); return c.length === 2 && c[1].querySelector('.proposal-apply'); });
    await page.click('#chatMessages .proposal-card >> nth=1 >> .proposal-ignore');
    assert((await recording(page, rec.id)).summary.decisions.length === 1, 'proposition ignorée appliquée');
    // Proposition illisible : avertissement, rien d'appliqué
    await page.fill('#chatInput', 'Réponse cassé');
    await page.click('#chatSendBtn');
    await page.waitForFunction(() => /proposition de correction de l'IA est illisible/.test(document.querySelector('#chatMessages').textContent));
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Réponses longues : texte en plusieurs morceaux, raisonnement écarté, coupure signalée', async () => {
    let mode = 'morceaux';
    const g = gemini({
      chat: () => mode === 'morceaux'
        ? { parts: [
            { text: 'Je dois rédiger un e-mail à partir de la synthèse…', thought: true },
            { text: 'Objet : Synthèse du point d’équipe\n\nBonjour à tous,\n\nVoici les principaux points abord' },
            { text: 'és :\n\n- Budget de 120 k€ validé\n- Bob envoie le devis vendredi\n\nBonne journée,\nAlice' }] }
        : mode === 'limite'
          ? { parts: [{ text: 'Objet : Synthèse\n\nBonjour à tous,\n\nVoici les principaux points abord' }], finishReason: 'MAX_TOKENS' }
          : { parts: [], finishReason: 'SAFETY' }
    });
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG });
    await importAudio(page);
    await page.click('#tabChatBtn');
    await page.fill('#chatInput', 'Rédige un e-mail de synthèse pour les participants');
    await page.click('#chatSendBtn');
    await page.waitForSelector('#chatMessages .mail-split');
    const shown = await page.textContent('#chatMessages > div:last-child');
    assert(shown.includes('Voici les principaux points abordés :') && shown.includes('Bob envoie le devis vendredi') && shown.includes('Bonne journée'), `réponse tronquée : ${shown.slice(0, 160)}`);
    assert(!shown.includes('Je dois rédiger'), 'raisonnement du modèle affiché à la place de la réponse');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#chatMessages > div:last-child .mail-main')]);
    assert(emlText(await downloadText(dl)).includes('Bob envoie le devis vendredi'), 'e-mail incomplet');
    // Limite de longueur atteinte : la réponse partielle est signalée
    mode = 'limite';
    await page.fill('#chatInput', 'Rédige un autre e-mail');
    await page.click('#chatSendBtn');
    await page.waitForFunction(() => /Réponse interrompue/.test(document.querySelector('#chatMessages > div:last-child').textContent));
    // Aucune réponse (filtrage) : message clair, pas d'erreur JavaScript
    mode = 'vide';
    await page.fill('#chatInput', 'Encore');
    await page.click('#chatSendBtn');
    await page.waitForFunction(() => /aucune réponse/i.test(document.querySelector('#chatMessages > div:last-child').textContent));
    assert(/SAFETY/.test(await page.textContent('#chatMessages > div:last-child')), 'motif de l’absence de réponse');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('LLM de l’entreprise : réponse coupée par la limite du serveur signalée', async () => {
    const llm = llmServer({ reply: () => ({ content: 'Objet : Synthèse\n\nBonjour à tous,\n\nVoici les principaux points abord', finish_reason: 'length' }) });
    const w = whisperServer();
    const { context, page } = await openApp(browser, base, { servers: { 'llm.corp.test': llm.handler, 'whisper.corp.test': w.handler }, config: { provider: 'local', local_llm_url: 'https://llm.corp.test/v1', local_llm_model: 'gpt-oss-120b', on_prem_stt_url: 'https://whisper.corp.test/v1' } });
    await importAudio(page);
    await page.click('#tabChatBtn');
    await page.fill('#chatInput', 'Rédige un e-mail de synthèse pour les participants');
    await page.click('#chatSendBtn');
    await page.waitForFunction(() => /Réponse interrompue/.test(document.querySelector('#chatMessages > div:last-child').textContent));
    assert(/limite de longueur/.test(await page.textContent('#chatMessages > div:last-child')), 'cause non expliquée');
    await context.close();
  });

  await t.scenario('Assistant global : question sur toutes les réunions, réunion ouverte, effacement', async () => {
    const ctx = {};
    const g = gemini({ chat: assistantReplies(ctx) });
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG });
    const rec = await importAudio(page);
    await page.click('#assistantToggleBtn');
    await page.waitForSelector('#assistantPanel:not(.hidden)');
    assert((await page.textContent('#assistantContext')).includes('1 enregistrement') && (await page.textContent('#assistantContext')).includes('Point projet Alpha'), 'contexte affiché');
    await page.fill('#assistantInput', 'Combien de réunions ?');
    await page.press('#assistantInput', 'Enter');
    await page.waitForFunction(() => /réunion\(s\) enregistrée/.test(document.querySelector('#assistantMessages').textContent));
    const sent = JSON.stringify(g.chats[0]);
    assert(sent.includes(rec.id) && sent.includes('Lancement du projet validé'), 'synthèses de toutes les réunions transmises');
    // Échap ferme, la conversation est conservée
    await page.keyboard.press('Escape');
    assert(await page.isHidden('#assistantPanel'), 'Échap');
    await page.click('#assistantToggleBtn');
    assert((await page.textContent('#assistantMessages')).includes('Combien de réunions ?'), 'conversation perdue');
    await page.click('#assistantClearBtn');
    await page.waitForFunction(() => !document.querySelector('#assistantMessages').textContent.includes('Combien de réunions ?'));
    assert((await page.evaluate(() => fetch('/api/assistant/history').then(r => r.json()))).length === 0, 'historique non effacé');
    await context.close();
  });

  await t.scenario('Transcription en direct (navigateur) : activation, texte affiché, pause, reprise, brouillon conservé', async () => {
    const g = gemini();
    const { context, page } = await openApp(browser, base, { gemini: g, config: CONFIG, speech: true });
    assert(await page.isEnabled('#liveToggle') && !(await page.isChecked('#liveToggle')), 'désactivée par défaut');
    await page.click('#liveToggleLabel');
    assert(await page.textContent('#liveStatus') === 'Activée', 'statut « Activée »');
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => window.__speech.active);
    assert(await page.isVisible('#liveBox') && /En écoute/.test(await page.textContent('#liveStatus')), 'écoute non démarrée');
    await page.waitForTimeout(1100);
    await page.evaluate(() => window.__speech.say('Bonjour à tous', true));
    await page.evaluate(() => window.__speech.say('on commence', false));
    assert((await page.textContent('#liveBox')).includes('Bonjour à tous') && await page.textContent('#liveBox .live-interim') === 'on commence', 'texte en direct');
    // Arrêt du service par le navigateur (silence) : relance automatique
    const starts = await page.evaluate(() => window.__speech.starts);
    await page.evaluate(() => window.__speech.active.stop());
    await page.waitForFunction(n => window.__speech.starts > n, starts);
    // Pause / reprise
    await page.click('#pauseRecordBtn');
    await page.waitForFunction(() => !window.__speech.active);
    await page.click('#pauseRecordBtn');
    await page.waitForFunction(() => window.__speech.active);
    await page.evaluate(() => window.__speech.say('le budget est validé', true));
    await page.click('#mainRecordBtn');
    await waitAnalysed(page);
    const rec = await recording(page, await page.evaluate(() => state.activeRecording.id));
    assert(/^\[00:0\d\] Bonjour à tous\n\[00:0\d\] le budget est validé$/.test(rec.live_transcript), `brouillon conservé : ${JSON.stringify(rec.live_transcript)}`);
    assert(await page.isHidden('#liveBox') && await page.isChecked('#liveToggle'), 'interface après l’arrêt / choix mémorisé');
    // Reconnaissance refusée par le navigateur : message clair
    await page.click('#newRecordBtn');
    await page.click('#mainRecordBtn');
    await page.waitForFunction(() => window.__speech.active);
    await page.evaluate(() => window.__speech.active.onerror({ error: 'not-allowed' }));
    assert(/refusée par le navigateur/.test(await page.textContent('#liveStatus')), 'refus non signalé');
    await page.click('#cancelRecordBtn');
    // Désactivation
    await page.click('#liveToggleLabel');
    assert(await page.evaluate(() => localStorage.getItem('voxai_live_transcript')) === 'off', 'désactivation non mémorisée');
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await browser.close();
  server.close();
  t.finish();
})().catch(err => { console.error(err); process.exit(1); });
