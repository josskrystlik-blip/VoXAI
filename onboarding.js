/**
 * VoxAI - Assistant de démarrage (prise en main).
 *
 * Cinq étapes : bienvenue, moteur d'IA (serveurs de l'entreprise ou Gemini, avec test),
 * Confluence (facultatif), première série (facultatif), bilan « où partent vos données ».
 * S'ouvre au premier lancement (aucun enregistrement) et depuis ⚙️ Paramètres.
 * Les réglages fixés par l'administrateur (image Docker) sont repris et la politique
 * « sans cloud » est respectée : Gemini et le mode Hybride ne sont alors pas proposés.
 */
(function () {
  'use strict';

  const DONE_KEY = 'voxai_onboarded';
  const LAST_STEP = 4;
  const $ = (id) => document.getElementById(id);
  const W = { step: 0, admin: {} };

  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };

  /** Réglages imposés ou proposés par l'administrateur (/voxai-defaults.json de l'image Docker). */
  async function adminDefaults() {
    if (location.protocol === 'file:') return {};
    try {
      const res = await fetch('voxai-defaults.json', { cache: 'no-store' });
      return res.ok ? ((await res.json()).config || {}) : {};
    } catch { return {}; }
  }

  function modal(show) {
    const m = $('wizardModal');
    m.classList.toggle('hidden', !show);
    m.style.display = show ? 'flex' : 'none';
  }

  // ---------------------------------------------------------------------------
  // Étape 1 : moteur d'IA
  // ---------------------------------------------------------------------------

  const provider = () => (cloudDisabled() ? 'local' : (document.querySelector('input[name="wzProvider"]:checked') || {}).value || 'local');

  function aiPayload() {
    const p = provider();
    if (p === 'gemini') return { provider: 'gemini', gemini_api_key: $('wzGeminiKey').value.trim() };
    const url = $('wzLlmUrl').value.trim();
    const model = $('wzLlmModel').value.trim();
    return {
      provider: 'local',
      local_llm_url: url, on_prem_llm_url: url,
      local_llm_model: model, on_prem_llm_model: model,
      local_llm_api_key: $('wzLlmKey').value.trim(),
      local_stt_mode: !cloudDisabled() && $('wzHybrid').checked ? 'cloud' : 'local',
      on_prem_stt_url: $('wzSttUrl').value.trim(),
      on_prem_stt_model: $('wzSttModel').value.trim() || 'whisper-1'
    };
  }

  function renderAiStep() {
    const p = provider();
    const hybrid = !cloudDisabled() && $('wzHybrid').checked;
    $('wzGeminiCard').classList.toggle('hidden', cloudDisabled());
    $('wzHybridRow').classList.toggle('hidden', cloudDisabled());
    $('wzLocalFields').classList.toggle('hidden', p !== 'local');
    $('wzGeminiFields').classList.toggle('hidden', p !== 'gemini');
    $('wzWhisperFields').classList.toggle('hidden', hybrid);
  }

  function fillAiStep() {
    const c = state.config || {};
    const a = W.admin;
    // Serveurs de l'entreprise proposés d'abord, sauf si Gemini est déjà configuré avec une clé
    const isLocal = cloudDisabled() || c.provider !== 'gemini' || !!a.local_llm_url || !c.gemini_api_key;
    document.querySelector(`input[name="wzProvider"][value="${isLocal ? 'local' : 'gemini'}"]`).checked = true;
    $('wzLlmUrl').value = c.local_llm_url && c.local_llm_url !== 'http://localhost:11434/v1' ? c.local_llm_url : (a.local_llm_url || '');
    $('wzLlmModel').value = c.local_llm_model && c.local_llm_model !== 'llama3.2' ? c.local_llm_model : (a.local_llm_model || '');
    $('wzLlmKey').value = c.local_llm_api_key || '';
    $('wzSttUrl').value = c.on_prem_stt_url && c.on_prem_stt_url !== 'http://localhost:8000/v1' ? c.on_prem_stt_url : (a.on_prem_stt_url || '');
    $('wzSttModel').value = c.on_prem_stt_model && c.on_prem_stt_model !== 'whisper-1' ? c.on_prem_stt_model : (a.on_prem_stt_model || '');
    $('wzHybrid').checked = !cloudDisabled() && c.local_stt_mode === 'cloud';
    $('wzGeminiKey').value = c.gemini_api_key || '';
    const note = $('wzAdminNote');
    const preset = a.local_llm_url
      ? `Votre administrateur a déjà renseigné les serveurs de l’entreprise (LLM : ${escapeHtml(hostOf(a.local_llm_url))}${a.on_prem_stt_url ? `, Whisper : ${escapeHtml(hostOf(a.on_prem_stt_url))}` : ''}). Vérifiez avec « Tester », puis continuez.`
      : '';
    const policy = cloudDisabled() ? '🔒 <strong>Mode 100 % interne imposé par votre administrateur</strong> : l’audio et les textes ne sont traités que par les serveurs de l’entreprise. ' : '';
    note.innerHTML = policy + preset;
    note.classList.toggle('hidden', !(policy || preset));
    $('wzTestAiStatus').textContent = '';
    renderAiStep();
  }

  async function testAi() {
    const status = $('wzTestAiStatus');
    status.textContent = 'Test en cours…';
    status.className = 'text-[11px] text-amber-400 animate-pulse';
    try {
      const res = await fetch('/api/test-connection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...state.config, ...aiPayload() }) });
      const data = await res.json();
      status.textContent = (data.success ? '✓ ' : '✗ ') + data.message;
      status.className = `text-[11px] ${data.success ? 'text-emerald-400' : 'text-rose-400'}`;
    } catch (err) {
      status.textContent = '✗ ' + err.message;
      status.className = 'text-[11px] text-rose-400';
    }
  }

  function validateAi() {
    const a = aiPayload();
    if (a.provider === 'gemini') return a.gemini_api_key ? '' : 'Renseignez la clé d’API Gemini (ou choisissez les serveurs de l’entreprise).';
    if (!/^https?:\/\//i.test(a.local_llm_url)) return 'Renseignez l’URL du LLM (http:// ou https://).';
    if (!a.local_llm_model) return 'Renseignez le nom du modèle (ex. gpt-oss-120b).';
    if (a.local_stt_mode === 'local' && !/^https?:\/\//i.test(a.on_prem_stt_url)) return 'Renseignez l’URL du serveur Whisper, ou cochez le mode Hybride.';
    return '';
  }

  // ---------------------------------------------------------------------------
  // Étape 2 : Confluence (facultatif)
  // ---------------------------------------------------------------------------

  function cfPayload() {
    return {
      confluence_url: $('wzCfUrl').value.trim().replace(/\/+$/, ''),
      confluence_auth: $('wzCfAuth').value === 'basic' ? 'basic' : 'pat',
      confluence_email: $('wzCfEmail').value.trim(),
      confluence_token: $('wzCfToken').value.trim()
    };
  }

  function fillCfStep() {
    const c = state.config || {};
    $('wzCfUrl').value = c.confluence_url || W.admin.confluence_url || '';
    $('wzCfAuth').value = c.confluence_auth === 'basic' ? 'basic' : 'pat';
    $('wzCfEmail').value = c.confluence_email || '';
    $('wzCfToken').value = c.confluence_token || '';
    $('wzCfEmailRow').classList.toggle('hidden', $('wzCfAuth').value !== 'basic');
    $('wzTestCfStatus').textContent = '';
  }

  async function testCf() {
    const status = $('wzTestCfStatus');
    status.textContent = 'Test en cours…';
    status.className = 'text-[11px] text-amber-400 animate-pulse';
    try {
      const user = await VoxConfluence.api.currentUser({ ...state.config, ...cfPayload() });
      status.textContent = `✓ Connecté en tant que ${user.displayName || user.username || user.publicName || 'utilisateur'}`;
      status.className = 'text-[11px] text-emerald-400';
    } catch (err) {
      status.textContent = '✗ ' + err.message;
      status.className = 'text-[11px] text-rose-400';
    }
  }

  // ---------------------------------------------------------------------------
  // Étape 3 : première série (facultatif)
  // ---------------------------------------------------------------------------

  /** « Alice Martin <alice@corp.fr> », « alice@corp.fr » ou « Bob » → { name, email }. */
  function parsePeople(text) {
    return String(text).split('\n').map(l => l.trim()).filter(Boolean).slice(0, 50).map(line => {
      const m = line.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
      if (m) return { name: m[1].trim() || m[2].split('@')[0], email: m[2] };
      if (/^[^\s@]+@[^\s@]+$/.test(line)) return { name: line.split('@')[0], email: line };
      return { name: line, email: '' };
    });
  }

  async function createSeries() {
    const name = $('wzSeriesName').value.trim();
    if (!name) return true; // étape facultative
    const res = await fetch('/api/series', { method: 'POST', body: JSON.stringify({ name, type: $('wzSeriesType').value, participants: parsePeople($('wzSeriesPeople').value) }) });
    if (!res.ok) { $('wizardError').textContent = 'Série non créée : ' + ((await res.json().catch(() => ({}))).error || res.status); return false; }
    const series = await res.json();
    lsSet('voxai_last_series', series.id);
    if (window.VoxSeries) await VoxSeries.reload();
    const select = $('seriesSelect');
    if (select) select.value = series.id;
    showToast(`Série « ${series.name} » créée`, '🗂️');
    $('wzSeriesName').value = '';
    $('wzSeriesPeople').value = '';
    return true;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  async function saveConfig(payload) {
    await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    state.config = { ...state.config, ...payload };
    updateProviderBadge();
    document.dispatchEvent(new CustomEvent('voxai:config-changed'));
  }

  function show(step) {
    W.step = step;
    document.querySelectorAll('#wizardModal .wizard-pane').forEach(p => p.classList.toggle('hidden', Number(p.dataset.pane) !== step));
    document.querySelectorAll('#wizardSteps li').forEach(li => {
      const n = Number(li.dataset.step);
      li.classList.toggle('current', n === step);
      li.classList.toggle('done', n < step);
    });
    $('wizardBackBtn').classList.toggle('invisible', step === 0);
    $('wizardLaterBtn').classList.toggle('hidden', step !== 2 && step !== 3);
    $('wizardNextBtn').textContent = step === 0 ? 'Commencer' : step === LAST_STEP ? 'C’est parti !' : step === 3 ? 'Créer et continuer' : 'Enregistrer et continuer';
    $('wizardError').textContent = '';
    if (step === 1) fillAiStep();
    if (step === 2) fillCfStep();
    if (step === 4) renderDataFlows($('wzDataFlows'), state.config || {});
  }

  async function next() {
    const err = $('wizardError');
    err.textContent = '';
    if (W.step === 1) {
      const problem = validateAi();
      if (problem) { err.textContent = problem; return; }
      await saveConfig(aiPayload());
    } else if (W.step === 2) {
      const cf = cfPayload();
      if (cf.confluence_url && !/^https?:\/\//i.test(cf.confluence_url)) { err.textContent = 'L’URL de Confluence doit commencer par http:// ou https://.'; return; }
      if (cf.confluence_url || cf.confluence_token) await saveConfig(cf);
    } else if (W.step === 3) {
      if (!(await createSeries())) return;
    } else if (W.step === LAST_STEP) {
      finish();
      return;
    }
    show(W.step + 1);
  }

  function finish() {
    lsSet(DONE_KEY, new Date().toISOString());
    modal(false);
  }

  async function open() {
    W.admin = await adminDefaults();
    show(0);
    modal(true);
  }

  function setup() {
    $('wizardNextBtn').addEventListener('click', next);
    $('wizardBackBtn').addEventListener('click', () => W.step > 0 && show(W.step - 1));
    $('wizardLaterBtn').addEventListener('click', () => show(W.step + 1));
    $('wizardSkipBtn').addEventListener('click', finish);
    $('wzTestAi').addEventListener('click', testAi);
    $('wzTestCf').addEventListener('click', testCf);
    $('wzCfAuth').addEventListener('change', () => $('wzCfEmailRow').classList.toggle('hidden', $('wzCfAuth').value !== 'basic'));
    document.querySelectorAll('input[name="wzProvider"]').forEach(r => r.addEventListener('change', renderAiStep));
    $('wzHybrid').addEventListener('change', renderAiStep);
    // Le message d'erreur disparaît dès que l'utilisateur corrige un champ
    $('wizardModal').addEventListener('input', () => { $('wizardError').textContent = ''; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('wizardModal').classList.contains('hidden')) finish(); });
    $('openWizardBtn').addEventListener('click', () => { closeSettingsModal(); open(); });
  }

  /** Premier lancement : aucun enregistrement et assistant jamais terminé. */
  function shouldAutoOpen() {
    return !lsGet(DONE_KEY) && !(state.recordings || []).length;
  }

  window.VoxOnboarding = { open, shouldAutoOpen, parsePeople };
  document.addEventListener('voxai:config-loaded', setup, { once: true });
})();
