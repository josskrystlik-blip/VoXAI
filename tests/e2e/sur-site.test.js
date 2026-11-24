/**
 * VoxAI — tests de bout en bout : 100 % sur site (LLM et Whisper de l'entreprise),
 * assistant de démarrage, paramètres, réglages de l'administrateur, mode Hybride, pannes.
 *
 * LLM, Whisper, Gemini et Confluence simulés ; toute requête vers Google est comptée.
 * Lancement : node tests/e2e/sur-site.test.js
 */
'use strict';

const { CORS, startServer, createRunner, assert, launchBrowser, gemini, llmServer, whisperServer, openApp, importAudio, getConfig } = require('./lib');

const LLM = 'https://llm.corp.test/v1';
const STT = 'https://whisper.corp.test/v1';
const ON_PREM = { provider: 'local', local_llm_url: LLM, local_llm_model: 'gpt-oss-120b', on_prem_stt_url: STT, on_prem_stt_model: 'whisper-large-v3' };

/** Serveurs de l'entreprise simulés + Gemini « piège » (toute requête est comptée). */
function corp({ llm = {}, whisper = {} } = {}) {
  const l = llmServer(llm);
  const w = whisperServer(whisper);
  const g = gemini();
  const confluence = async (route) => route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: CORS })
    : route.fulfill({ headers: CORS, contentType: 'application/json', body: JSON.stringify({ displayName: 'Alice Martin' }) });
  return { l, w, g, servers: { 'llm.corp.test': l.handler, 'whisper.corp.test': w.handler, 'confluence.test': confluence } };
}

const statusDone = (sel) => (page) => page.waitForFunction(s => { const t = document.querySelector(s).textContent; return t && !/en cours/i.test(t); }, sel, { timeout: 10000 });

(async () => {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await launchBrowser();
  const t = createRunner('Tests de bout en bout : 100 % sur site, assistant de démarrage, paramètres');

  await t.scenario('Premier lancement : assistant de démarrage complet (serveurs de l’entreprise, Confluence, série)', async () => {
    const c = corp();
    const { context, page, blocked } = await openApp(browser, base, { servers: c.servers, gemini: c.g, onboarded: false });
    await page.waitForSelector('#wizardModal:not(.hidden)');
    assert(await page.isHidden('#settingsModal'), 'les paramètres ne doivent pas s’ouvrir en même temps');
    assert(await page.textContent('#wizardNextBtn') === 'Commencer', 'étape d’accueil');
    await page.click('#wizardNextBtn');
    assert(await page.isChecked('input[name="wzProvider"][value="local"]'), 'serveurs de l’entreprise proposés par défaut');
    await page.click('#wizardNextBtn');
    assert(/URL du LLM/.test(await page.textContent('#wizardError')), 'validation : URL du LLM manquante');
    await page.fill('#wzLlmUrl', LLM);
    assert(await page.textContent('#wizardError') === '', 'message d’erreur effacé à la saisie');
    await page.fill('#wzLlmModel', 'gpt-oss-120b');
    await page.click('#wizardNextBtn');
    assert(/serveur Whisper/.test(await page.textContent('#wizardError')), 'validation : Whisper manquant');
    await page.fill('#wzSttUrl', STT);
    await page.fill('#wzSttModel', 'whisper-large-v3');
    await page.click('#wzTestAi');
    await statusDone('#wzTestAiStatus')(page);
    const test = await page.textContent('#wzTestAiStatus');
    assert(/^✓ LLM « gpt-oss-120b » joignable .*Whisper « whisper-large-v3 » joignable .*Tout reste sur vos serveurs/.test(test), `test : ${test}`);
    await page.click('#wizardNextBtn');
    // Confluence : URL invalide refusée, test, puis enregistrement
    await page.waitForSelector('#wizardLaterBtn:not(.hidden)'); // étape facultative
    await page.fill('#wzCfUrl', 'ftp://wiki');
    await page.click('#wizardNextBtn');
    assert(/doit commencer par http/.test(await page.textContent('#wizardError')), 'URL Confluence invalide acceptée');
    await page.fill('#wzCfUrl', 'https://confluence.test/');
    await page.fill('#wzCfToken', 'pat-perso');
    await page.click('#wzTestCf');
    await statusDone('#wzTestCfStatus')(page);
    assert(await page.textContent('#wzTestCfStatus') === '✓ Connecté en tant que Alice Martin', 'test Confluence');
    await page.click('#wizardNextBtn');
    // Retour arrière puis avant : les réglages enregistrés sont repris
    await page.click('#wizardBackBtn');
    assert(await page.inputValue('#wzCfUrl') === 'https://confluence.test', 'Confluence enregistré (sans / final)');
    await page.click('#wizardNextBtn');
    // Première série
    await page.fill('#wzSeriesName', 'Point Alpha');
    await page.fill('#wzSeriesPeople', 'Alice Martin <alice@corp.fr>\nbob@corp.fr\nChloé');
    assert(await page.textContent('#wizardNextBtn') === 'Créer et continuer', 'libellé');
    await page.click('#wizardNextBtn');
    await page.waitForFunction(() => /100 % sur site/.test(document.querySelector('#wzDataFlows').textContent));
    const series = await page.evaluate(() => fetch('/api/series').then(r => r.json()));
    assert(JSON.stringify(series[0].participants.map(p => [p.name, p.email])) === '[["Alice Martin","alice@corp.fr"],["bob","bob@corp.fr"],["Chloé",""]]', `participants : ${JSON.stringify(series[0].participants)}`);
    await page.click('#wizardNextBtn');
    assert(await page.isHidden('#wizardModal'), 'assistant non fermé');
    const cfg = await getConfig(page);
    assert(cfg.provider === 'local' && cfg.local_stt_mode === 'local' && cfg.local_llm_url === LLM && cfg.on_prem_stt_model === 'whisper-large-v3' && cfg.confluence_token === 'pat-perso', `réglages : ${JSON.stringify(cfg)}`);
    assert(await page.textContent('#providerName') === '🔒 100 % sur site (gpt-oss-120b)', `badge : ${await page.textContent('#providerName')}`);
    assert(await page.$eval('#seriesSelect', s => s.options[s.selectedIndex].text) === 'Point Alpha', 'série présélectionnée');
    assert(await page.isDisabled('#liveToggle'), 'transcription en direct (audio vers Google) disponible en 100 % sur site');
    // Analyse : Whisper puis LLM, rien vers Google
    const rec = await importAudio(page);
    assert(rec.status === 'completed' && rec.series_id === series[0].id, `analyse : ${rec.status}`);
    assert(rec.transcription[0].text === 'Bonjour, ceci est une réunion transcrite sur site.' && rec.summary.executive === 'Synthèse produite sur site.', 'transcription Whisper et synthèse LLM');
    assert(c.w.calls === 2 && c.g.analyses.length + c.g.chats.length === 0, `Whisper ${c.w.calls} (test + analyse), Google ${c.g.analyses.length + c.g.chats.length}`);
    // Pas de réouverture au rechargement ; réouverture possible depuis les paramètres
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && state.config);
    await page.waitForTimeout(600);
    assert(await page.isHidden('#wizardModal'), 'assistant rouvert au rechargement');
    await page.evaluate(() => openSettingsModal());
    await page.click('#openWizardBtn');
    await page.waitForSelector('#wizardModal:not(.hidden)');
    assert(await page.isHidden('#settingsModal'), 'paramètres non fermés à l’ouverture de l’assistant');
    await page.keyboard.press('Escape');
    assert(await page.isHidden('#wizardModal'), 'Échap ferme l’assistant');
    assert(blocked.length === 0 && page.jsErrors.length === 0, `requêtes bloquées ${blocked} / erreurs ${page.jsErrors}`);
    await context.close();
  });

  await t.scenario('Assistant : « Passer », puis Gemini choisi (clé obligatoire)', async () => {
    const c = corp();
    const { context, page } = await openApp(browser, base, { servers: c.servers, gemini: c.g, onboarded: false });
    await page.waitForSelector('#wizardModal:not(.hidden)');
    await page.click('#wizardSkipBtn');
    assert(await page.isHidden('#wizardModal') && await page.evaluate(() => !!localStorage.getItem('voxai_onboarded')), '« Passer » doit fermer et mémoriser');
    await page.evaluate(() => openSettingsModal());
    await page.click('#openWizardBtn');
    await page.waitForSelector('#wizardModal:not(.hidden)');
    await page.click('#wizardNextBtn');
    await page.check('input[name="wzProvider"][value="gemini"]');
    assert(await page.isVisible('#wzGeminiFields') && await page.isHidden('#wzLocalFields'), 'champs Gemini');
    await page.click('#wizardNextBtn');
    assert(/clé d’API Gemini/.test(await page.textContent('#wizardError')), 'clé Gemini obligatoire');
    await page.fill('#wzGeminiKey', 'cle-gemini');
    await page.click('#wzTestAi');
    await statusDone('#wzTestAiStatus')(page);
    assert(/^✓ Connexion Gemini réussie/.test(await page.textContent('#wzTestAiStatus')), `test Gemini : ${await page.textContent('#wzTestAiStatus')}`);
    await page.click('#wizardNextBtn');
    await page.click('#wizardLaterBtn');
    await page.click('#wizardLaterBtn');
    assert(/Une partie des données quitte l’entreprise|⚠️/.test(await page.textContent('#wzDataFlows')), 'bilan : données envoyées chez Google signalées');
    await page.click('#wizardNextBtn');
    const cfg = await getConfig(page);
    assert(cfg.provider === 'gemini' && cfg.gemini_api_key === 'cle-gemini', 'Gemini enregistré');
    assert((await page.textContent('#providerName')).startsWith('Cloud'), 'badge Cloud');
    await context.close();
  });

  await t.scenario('Image Docker : réglages de l’administrateur et politique « sans cloud » appliqués partout', async () => {
    const c = corp();
    const defaults = { config: { ...ON_PREM }, policy: { disable_cloud: true } };
    const { context, page } = await openApp(browser, base, { servers: c.servers, gemini: c.g, onboarded: false, defaults, config: { gemini_api_key: 'CLE-PRESENTE', provider: 'gemini' } });
    await page.waitForSelector('#wizardModal:not(.hidden)');
    await page.click('#wizardNextBtn');
    const note = await page.textContent('#wzAdminNote');
    assert(/Mode 100 % interne imposé/.test(note) && /llm\.corp\.test/.test(note) && /whisper\.corp\.test/.test(note), `note de l’administrateur : ${note}`);
    assert(await page.isHidden('#wzGeminiCard') && await page.isHidden('#wzHybridRow'), 'Gemini et Hybride proposés malgré la politique');
    assert(await page.inputValue('#wzLlmUrl') === LLM && await page.inputValue('#wzSttModel') === 'whisper-large-v3', 'serveurs préremplis');
    await page.click('#wizardSkipBtn');
    // Paramètres : Gemini et Hybride indisponibles, messageries sans Gmail, direct coupé
    await page.evaluate(() => openSettingsModal());
    assert(await page.isVisible('#cloudPolicyNote'), 'note de politique dans les paramètres');
    assert(await page.evaluate(() => Object.keys(mailTargets()).join()) === 'desktop,web,mailto', 'Gmail proposé malgré la politique');
    assert(await page.isDisabled('#liveToggle') && /administrateur/.test(await page.textContent('#liveStatus')), 'transcription en direct');
    await page.click('#closeSettingsBtn');
    // Malgré provider « gemini » et une clé enregistrés : tout passe par les serveurs internes
    const rec = await importAudio(page);
    assert(rec.status === 'completed' && c.w.calls === 1 && c.l.calls.some(x => x.path.endsWith('/chat/completions')), 'analyse sur site');
    assert(c.g.analyses.length + c.g.chats.length === 0, 'requête vers Google malgré la politique');
    await context.close();
  });

  await t.scenario('Paramètres : LLM de l’entreprise, détection des modèles, test, enregistrement, analyse', async () => {
    const c = corp();
    const { context, page } = await openApp(browser, base, { servers: c.servers, gemini: c.g, config: { provider: 'gemini', gemini_api_key: 'cle-gemini' } });
    await page.click('#openSettingsBtn');
    await page.click('#selectOnPremProvider');
    assert(await page.isVisible('#onPremConfigSection') && await page.isHidden('#geminiConfigSection'), 'section serveurs de l’entreprise');
    await page.fill('#onPremLlmUrl', LLM);
    await page.fill('#localLlmApiKey', 'cle-llm');
    await page.click('#detectLocalModelsBtn');
    await page.waitForFunction(() => /modèle\(s\) détecté|Aucun|Erreur/.test(document.querySelector('#detectModelsStatus').textContent));
    assert((await page.textContent('#detectModelsStatus')).startsWith('✓ 2 modèle(s) détecté(s)'), `détection : ${await page.textContent('#detectModelsStatus')}`);
    assert(c.l.calls.find(x => x.path.endsWith('/models')).auth === 'Bearer cle-llm', 'clé envoyée pour la détection');
    await page.selectOption('#localModelSelect', 'mistral-small');
    assert(await page.inputValue('#onPremLlmModel') === 'mistral-small', 'modèle choisi recopié');
    await page.fill('#onPremSttUrl', STT);
    assert(/100 % sur site/.test(await page.textContent('#dataFlowList')), `bilan : ${await page.textContent('#dataFlowList')}`);
    await page.click('#testConnBtn');
    await statusDone('#testConnStatus')(page);
    assert(/^✓ LLM « mistral-small » joignable .*Whisper « whisper-1 » joignable/.test(await page.textContent('#testConnStatus')), `test : ${await page.textContent('#testConnStatus')}`);
    // Mode Hybride : signalé dans le bilan, Whisper masqué
    await page.check('input[name="local_stt_mode"][value="cloud"]');
    assert(await page.isHidden('#whisperLocalConfigContainer') && /Google/.test(await page.textContent('#dataFlowList')), 'Hybride signalé');
    await page.check('input[name="local_stt_mode"][value="local"]');
    await page.click('#saveSettingsBtn');
    await page.waitForSelector('#settingsModal', { state: 'hidden' });
    assert(await page.textContent('#providerName') === '🔒 100 % sur site (mistral-small)', `badge : ${await page.textContent('#providerName')}`);
    const rec = await importAudio(page);
    const chat = c.l.calls.filter(x => x.path.endsWith('/chat/completions')).pop();
    assert(rec.status === 'completed' && chat.body.model === 'mistral-small' && chat.auth === 'Bearer cle-llm', 'synthèse par le modèle choisi');
    assert(JSON.stringify(chat.body.messages).includes('Bonjour, ceci est une réunion transcrite sur site.'), 'transcription Whisper transmise au LLM');
    assert(c.g.analyses.length + c.g.chats.length === 0, 'requête vers Google');
    await context.close();
  });

  await t.scenario('Mode Hybride : transcription par Google, synthèse par le LLM, signalé', async () => {
    const c = corp();
    const { context, page } = await openApp(browser, base, { servers: c.servers, gemini: c.g, config: { ...ON_PREM, local_stt_mode: 'cloud', gemini_api_key: 'cle-gemini' } });
    assert(await page.textContent('#providerName') === 'LLM local (gpt-oss-120b) + transcription Google', `badge : ${await page.textContent('#providerName')}`);
    assert(await page.isEnabled('#liveToggle'), 'transcription en direct disponible en Hybride');
    const rec = await importAudio(page);
    assert(rec.status === 'completed' && c.g.analyses.length === 1 && c.w.calls === 0, 'transcription par Gemini');
    assert(rec.summary.executive === 'Synthèse produite sur site.' && rec.transcription[1].speaker === 'Bob', 'synthèse par le LLM à partir de la transcription Gemini');
    // Sans clé Gemini : message explicite
    await page.evaluate(() => fetch('/api/config', { method: 'POST', body: JSON.stringify({ gemini_api_key: '' }) }));
    await page.evaluate(() => loadConfig());
    await page.click('#reprocessBtn');
    await page.waitForFunction(() => state.activeRecording.status === 'error', null, { timeout: 10000 });
    assert(/clé d'API Gemini doit être configurée/.test(await page.textContent('#toastMessage')), `message : ${await page.textContent('#toastMessage')}`);
    await context.close();
  });

  await t.scenario('Pannes : Whisper ou LLM injoignables, aucun modèle détecté', async () => {
    const c = corp({ whisper: { down: true } });
    const { context, page } = await openApp(browser, base, { servers: c.servers, gemini: c.g, config: ON_PREM });
    await page.evaluate(() => openSettingsModal());
    await page.click('#testConnBtn');
    await statusDone('#testConnStatus')(page);
    assert(/^✗ LLM « gpt-oss-120b » joignable .*mais le serveur Whisper ne répond pas : https:\/\/whisper\.corp\.test\/v1 : Failed to fetch\. Vérifiez que le serveur Whisper/.test(await page.textContent('#testConnStatus')), `Whisper en panne : ${await page.textContent('#testConnStatus')}`);
    await page.click('#closeSettingsBtn');
    // Serveur injoignable (VPN absent, serveur arrêté…) : enregistrement conservé « en attente », jamais de repli vers Google
    const rec = await importAudio(page);
    assert(rec.status === 'pending' && /Serveur d'IA injoignable/.test(rec.error_message) && c.g.analyses.length === 0, `statut : ${rec.status}`);
    assert(await page.isVisible('#pendingBanner') && await page.isEnabled('#pendingRunBtn'), 'bandeau « en attente »');
    c.w.down = false;
    await page.click('#pendingRunBtn');
    await page.waitForFunction(() => state.recordings.every(r => r.status === 'completed'), null, { timeout: 10000 });
    assert(await page.isHidden('#pendingBanner'), 'bandeau non masqué après l’analyse');
    // LLM injoignable
    c.l.down = true;
    await page.evaluate(() => openSettingsModal());
    await page.click('#testConnBtn');
    await statusDone('#testConnStatus')(page);
    assert(/^✗ Impossible de joindre le modèle local 'gpt-oss-120b'/.test(await page.textContent('#testConnStatus')), `LLM en panne : ${await page.textContent('#testConnStatus')}`);
    await page.click('#detectLocalModelsBtn');
    await page.waitForFunction(() => !/Recherche/.test(document.querySelector('#detectModelsStatus').textContent), null, { timeout: 15000 });
    const detect = await page.textContent('#detectModelsStatus');
    assert(/^Aucun serveur LLM détecté sur https:\/\/llm\.corp\.test\/v1\..*autoriser l'origine/.test(detect), `détection sur un serveur en panne : ${detect}`);
    assert(page.jsErrors.length === 0, `erreurs : ${page.jsErrors}`);
    await context.close();
  });

  await browser.close();
  server.close();
  t.finish();
})().catch(err => { console.error(err); process.exit(1); });
