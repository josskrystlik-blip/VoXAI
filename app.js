/**
 * VoxAI - Dictaphone Intelligent & Transcription IA
 * Logique client : Enregistrement WebAudio, Visualiseur d'ondes, API REST, Synthèse & Chat
 */

// State Application
let state = {
  recordings: [],
  activeRecording: null,
  config: null,
  activeTab: 'summary', // 'summary' | 'transcript' | 'chat'
  
  // Media Recorder State
  mediaRecorder: null,
  audioChunks: [],
  audioStream: null,
  audioContext: null,
  analyser: null,
  animFrameId: null,
  isRecording: false,
  isPaused: false,
  recordStartTime: 0,
  recordElapsedSec: 0,
  recordTimerInterval: null,
  activeFileIndex: 0,
  
  // Settings Form State
  modalProvider: 'gemini'
};

// DOM Elements
const elements = {
  // Views
  recorderView: document.getElementById('recorderView'),
  detailsView: document.getElementById('detailsView'),
  recordingsList: document.getElementById('recordingsList'),
  searchRecordings: document.getElementById('searchRecordings'),
  newRecordBtn: document.getElementById('newRecordBtn'),
  fileUploadInput: document.getElementById('fileUploadInput'),
  
  // Provider Header
  providerBadgeBtn: document.getElementById('providerBadgeBtn'),
  providerDot: document.getElementById('providerDot'),
  providerName: document.getElementById('providerName'),
  
  // Dictaphone Controls
  recordTitleInput: document.getElementById('recordTitleInput'),
  waveformCanvas: document.getElementById('waveformCanvas'),
  micPrompt: document.getElementById('micPrompt'),
  recordTimer: document.getElementById('recordTimer'),
  recordingDot: document.getElementById('recordingDot'),
  mainRecordBtn: document.getElementById('mainRecordBtn'),
  micIcon: document.getElementById('micIcon'),
  stopSquare: document.getElementById('stopSquare'),
  pauseRecordBtn: document.getElementById('pauseRecordBtn'),
  cancelRecordBtn: document.getElementById('cancelRecordBtn'),
  recordStatusText: document.getElementById('recordStatusText'),
  
  // Recording Details
  detailTitle: document.getElementById('detailTitle'),
  detailStatusBadge: document.getElementById('detailStatusBadge'),
  detailDate: document.getElementById('detailDate'),
  detailDuration: document.getElementById('detailDuration'),
  detailSize: document.getElementById('detailSize'),
  detailFilesBadge: document.getElementById('detailFilesBadge'),
  addFileInput: document.getElementById('addFileInput'),
  trackSelectorContainer: document.getElementById('trackSelectorContainer'),
  trackPillsList: document.getElementById('trackPillsList'),
  reprocessBtn: document.getElementById('reprocessBtn'),
  exportMarkdownBtn: document.getElementById('exportMarkdownBtn'),
  deleteRecordBtn: document.getElementById('deleteRecordBtn'),
  
  // Audio Player
  audioElement: document.getElementById('audioElement'),
  playerPlayBtn: document.getElementById('playerPlayBtn'),
  playerPlayIcon: document.getElementById('playerPlayIcon'),
  playerPauseIcon: document.getElementById('playerPauseIcon'),
  playerRewindBtn: document.getElementById('playerRewindBtn'),
  playerForwardBtn: document.getElementById('playerForwardBtn'),
  playerCurrentTime: document.getElementById('playerCurrentTime'),
  playerSeek: document.getElementById('playerSeek'),
  playerTotalTime: document.getElementById('playerTotalTime'),
  playerSpeed: document.getElementById('playerSpeed'),
  
  // Drag and Drop Overlay
  dragDropOverlay: document.getElementById('dragDropOverlay'),
  
  // Tabs & Contents
  tabSummaryBtn: document.getElementById('tabSummaryBtn'),
  tabTranscriptBtn: document.getElementById('tabTranscriptBtn'),
  tabChatBtn: document.getElementById('tabChatBtn'),
  tabContentSummary: document.getElementById('tabContentSummary'),
  tabContentTranscript: document.getElementById('tabContentTranscript'),
  tabContentChat: document.getElementById('tabContentChat'),
  
  // Summary Fields
  summaryExecutive: document.getElementById('summaryExecutive'),
  summaryDecisions: document.getElementById('summaryDecisions'),
  summaryActions: document.getElementById('summaryActions'),
  summaryKeyPoints: document.getElementById('summaryKeyPoints'),
  summaryTags: document.getElementById('summaryTags'),
  
  // Transcript Fields
  transcriptTimeline: document.getElementById('transcriptTimeline'),
  copyTranscriptBtn: document.getElementById('copyTranscriptBtn'),
  copySummaryBtn: document.getElementById('copySummaryBtn'),
  speakersBar: document.getElementById('speakersBar'),
  
  // Chat Fields
  chatMessages: document.getElementById('chatMessages'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  
  // Settings Modal
  settingsModal: document.getElementById('settingsModal'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  selectGeminiProvider: document.getElementById('selectGeminiProvider'),
  selectOnPremProvider: document.getElementById('selectOnPremProvider'),
  geminiConfigSection: document.getElementById('geminiConfigSection'),
  onPremConfigSection: document.getElementById('onPremConfigSection'),
  geminiApiKeyInput: document.getElementById('geminiApiKeyInput'),
  toggleApiKeyVisibility: document.getElementById('toggleApiKeyVisibility'),
  geminiModelSelect: document.getElementById('geminiModelSelect'),
  onPremLlmUrl: document.getElementById('onPremLlmUrl'),
  onPremLlmModel: document.getElementById('onPremLlmModel'),
  localModelSelect: document.getElementById('localModelSelect'),
  detectLocalModelsBtn: document.getElementById('detectLocalModelsBtn'),
  detectModelsStatus: document.getElementById('detectModelsStatus'),
  whisperLocalConfigContainer: document.getElementById('whisperLocalConfigContainer'),
  onPremSttUrl: document.getElementById('onPremSttUrl'),
  onPremSttModel: document.getElementById('onPremSttModel'),
  onPremSttApiKey: document.getElementById('onPremSttApiKey'),
  localLlmApiKey: document.getElementById('localLlmApiKey'),
  testConnBtn: document.getElementById('testConnBtn'),
  testConnStatus: document.getElementById('testConnStatus'),
  
  // Toast
  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toastIcon'),
  toastMessage: document.getElementById('toastMessage')
};

// ==============================================================================
// Initialisation
// ==============================================================================

async function init() {
  await loadConfig();
  // Les modules (transcription en direct…) attendent la configuration et la politique de l'administrateur
  document.dispatchEvent(new CustomEvent('voxai:config-loaded'));
  await loadRecordings();
  setupEventListeners();
  setupOffline();
  setupPwa();
  initCanvas();

  // Premier lancement : assistant de démarrage (IA, Confluence, première série)
  if (window.VoxOnboarding && VoxOnboarding.shouldAutoOpen()) {
    setTimeout(() => VoxOnboarding.open(), 400);
  } else if (state.config.provider === 'gemini' && !state.config.gemini_api_key && !cloudDisabled()) {
    // Sans clé d'API Gemini, ouvrir les réglages pour guider l'utilisateur
    setTimeout(() => {
      openSettingsModal();
      showToast('Bienvenue ! Configurez votre clé d’API Gemini pour démarrer.', '✨');
    }, 600);
  }
}

// ==============================================================================
// Gestion de la configuration
// ==============================================================================

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    state.config = await res.json();
    updateProviderBadge();
  } catch (err) {
    console.error('Erreur chargement config:', err);
  }
}

function updateProviderBadge() {
  if (!state.config) return;
  const isGemini = state.config.provider === 'gemini';
  
  if (isGemini) {
    elements.providerDot.className = 'w-2 h-2 rounded-full bg-emerald-400 animate-pulse';
    elements.providerName.textContent = `Cloud (${state.config.gemini_model || 'gemini-3.5-flash-lite'})`;
  } else {
    const model = state.config.local_llm_model || state.config.on_prem_llm_model || 'Local';
    const hybrid = state.config.local_stt_mode === 'cloud' && !cloudDisabled();
    elements.providerDot.className = `w-2 h-2 rounded-full ${hybrid ? 'bg-amber-400' : 'bg-purple-400'} animate-pulse`;
    elements.providerName.textContent = hybrid ? `LLM local (${model}) + transcription Google` : `🔒 100 % sur site (${model})`;
  }
}

function cloudDisabled() {
  return !!(state.config && state.config.policy && state.config.policy.disable_cloud);
}

/** Politique « sans cloud » (image Docker) : masque Gemini, le mode Hybride et l'explique. */
function applyCloudPolicyUI() {
  const off = cloudDisabled();
  elements.selectGeminiProvider.classList.toggle('hidden', off);
  elements.selectGeminiProvider.parentElement.classList.toggle('grid-cols-2', !off);
  const cloudCard = document.getElementById('sttModeCloudLabel');
  if (cloudCard) cloudCard.classList.toggle('hidden', off);
  const note = document.getElementById('cloudPolicyNote');
  if (note) note.classList.toggle('hidden', !off);
}

function openSettingsModal() {
  if (!state.config) return;
  applyCloudPolicyUI();
  refreshBackupInfo();
  state.modalProvider = (cloudDisabled() || state.config.provider === 'local' || state.config.provider === 'on_prem') ? 'on_prem' : 'gemini';
  updateModalProviderUI();
  
  elements.geminiApiKeyInput.value = state.config.gemini_api_key || '';
  elements.geminiModelSelect.value = state.config.gemini_model || 'gemini-3.5-flash-lite';
  
  const localUrl = state.config.local_llm_url || state.config.on_prem_llm_url || 'http://localhost:11434/v1';
  const localModel = state.config.local_llm_model || state.config.on_prem_llm_model || 'llama3.2';
  elements.onPremLlmUrl.value = localUrl;
  elements.onPremLlmModel.value = localModel;
  elements.onPremSttUrl.value = state.config.on_prem_stt_url || 'http://localhost:8000/v1';
  elements.onPremSttModel.value = state.config.on_prem_stt_model || 'whisper-1';
  elements.onPremSttApiKey.value = state.config.on_prem_stt_api_key || '';
  elements.localLlmApiKey.value = state.config.local_llm_api_key || '';
  if (window.VoxConfluence) VoxConfluence.fillSettings(state.config);

  // Configurer sélection de modèle
  if (elements.localModelSelect) {
    let found = false;
    for (let opt of elements.localModelSelect.options) {
      if (opt.value === localModel) {
        elements.localModelSelect.value = localModel;
        found = true;
        break;
      }
    }
    if (!found) {
      const opt = document.createElement('option');
      opt.value = localModel;
      opt.textContent = localModel;
      elements.localModelSelect.insertBefore(opt, elements.localModelSelect.firstChild);
      elements.localModelSelect.value = localModel;
    }
  }

  // Configurer mode STT
  const sttMode = cloudDisabled() ? 'local' : (state.config.local_stt_mode || 'local');
  const radio = document.querySelector(`input[name="local_stt_mode"][value="${sttMode}"]`);
  if (radio) radio.checked = true;

  if (elements.whisperLocalConfigContainer) {
    if (sttMode === 'local') {
      elements.whisperLocalConfigContainer.classList.remove('hidden');
    } else {
      elements.whisperLocalConfigContainer.classList.add('hidden');
    }
  }

  elements.testConnStatus.textContent = '';
  if (elements.detectModelsStatus) elements.detectModelsStatus.textContent = '';
  
  refreshSettingsDataFlows();
  elements.settingsModal.classList.remove('hidden');
  elements.settingsModal.classList.add('flex');
  elements.settingsModal.style.display = 'flex';
}

function closeSettingsModal() {
  elements.settingsModal.classList.remove('flex');
  elements.settingsModal.classList.add('hidden');
  elements.settingsModal.style.display = 'none';
}

function updateModalProviderUI() {
  const isGemini = state.modalProvider === 'gemini';
  if (isGemini) {
    elements.selectGeminiProvider.classList.add('active', 'bg-indigo-600', 'text-white', 'shadow-md');
    elements.selectGeminiProvider.classList.remove('text-slate-400');
    elements.selectOnPremProvider.classList.remove('active', 'bg-purple-600', 'bg-indigo-600', 'text-white', 'shadow-md');
    elements.selectOnPremProvider.classList.add('text-slate-400');
    elements.geminiConfigSection.classList.remove('hidden');
    elements.onPremConfigSection.classList.add('hidden');
  } else {
    elements.selectOnPremProvider.classList.add('active', 'bg-purple-600', 'text-white', 'shadow-md');
    elements.selectOnPremProvider.classList.remove('text-slate-400');
    elements.selectGeminiProvider.classList.remove('active', 'bg-indigo-600', 'text-white', 'shadow-md');
    elements.selectGeminiProvider.classList.add('text-slate-400');
    elements.onPremConfigSection.classList.remove('hidden');
    elements.geminiConfigSection.classList.add('hidden');
  }
  refreshSettingsDataFlows();
}

async function detectLocalModels() {
  const url = elements.onPremLlmUrl.value.trim();
  if (!url) {
    showToast('Veuillez renseigner l’URL de votre serveur local', '⚠️');
    return;
  }

  elements.detectModelsStatus.textContent = '⏳ Recherche des modèles en cours sur ' + url + '...';
  elements.detectModelsStatus.className = 'text-[11px] text-amber-400 animate-pulse mt-1';
  if (elements.detectLocalModelsBtn) elements.detectLocalModelsBtn.disabled = true;

  try {
    const key = elements.localLlmApiKey.value.trim();
    const res = await fetch(`/api/local-models?url=${encodeURIComponent(url)}&key=${encodeURIComponent(key)}`);
    const data = await res.json();
    if (elements.detectLocalModelsBtn) elements.detectLocalModelsBtn.disabled = false;

    if (data.success && data.models && data.models.length > 0) {
      elements.localModelSelect.innerHTML = '';
      data.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        elements.localModelSelect.appendChild(opt);
      });
      const customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.textContent = '✏️ Saisir manuellement un autre nom...';
      elements.localModelSelect.appendChild(customOpt);

      const currentModel = elements.onPremLlmModel.value.trim();
      if (data.models.includes(currentModel)) {
        elements.localModelSelect.value = currentModel;
      } else {
        elements.localModelSelect.value = data.models[0];
        elements.onPremLlmModel.value = data.models[0];
      }

      elements.detectModelsStatus.textContent = `✓ ${data.models.length} modèle(s) détecté(s) (${data.type || 'local'}) !`;
      elements.detectModelsStatus.className = 'text-[11px] text-emerald-400 font-semibold mt-1';
      showToast(`${data.models.length} modèles détectés avec succès !`, '🦙');
    } else {
      elements.detectModelsStatus.textContent = data.error || 'Aucun modèle détecté sur cette URL.';
      elements.detectModelsStatus.className = 'text-[11px] text-rose-400 mt-1';
      showToast('Aucun modèle détecté', '⚠️');
    }
  } catch (err) {
    if (elements.detectLocalModelsBtn) elements.detectLocalModelsBtn.disabled = false;
    elements.detectModelsStatus.textContent = 'Erreur détection: ' + err.message;
    elements.detectModelsStatus.className = 'text-[11px] text-rose-400 mt-1';
  }
}

/** Réglages IA tels qu'affichés dans la fenêtre des paramètres. */
function readAiForm() {
  const selectedSttRadio = document.querySelector('input[name="local_stt_mode"]:checked');
  const localLlmModel = elements.onPremLlmModel.value.trim() || 'llama3.2';
  const localLlmUrl = elements.onPremLlmUrl.value.trim() || 'http://localhost:11434/v1';
  return {
    provider: state.modalProvider === 'on_prem' ? 'local' : 'gemini',
    gemini_api_key: elements.geminiApiKeyInput.value.trim(),
    gemini_model: elements.geminiModelSelect.value,
    local_llm_url: localLlmUrl,
    local_llm_model: localLlmModel,
    local_stt_mode: cloudDisabled() ? 'local' : (selectedSttRadio ? selectedSttRadio.value : 'local'),
    on_prem_llm_url: localLlmUrl,
    on_prem_llm_model: localLlmModel,
    on_prem_stt_url: elements.onPremSttUrl.value.trim(),
    on_prem_stt_model: elements.onPremSttModel.value.trim() || 'whisper-1',
    on_prem_stt_api_key: elements.onPremSttApiKey.value.trim(),
    local_llm_api_key: elements.localLlmApiKey.value.trim()
  };
}

const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url || ''); } };

/**
 * Bilan de confidentialité : pour chaque traitement, où partent les données avec ces réglages.
 * cloud = true quand la donnée quitte l'entreprise.
 */
function dataFlows(cfg) {
  const policy = cloudDisabled();
  const gemini = !policy && cfg.provider === 'gemini';
  const hybrid = !policy && !gemini && cfg.local_stt_mode === 'cloud';
  const llm = cfg.local_llm_url || cfg.on_prem_llm_url;
  const flows = [
    { label: 'Audio → transcription', dest: gemini || hybrid ? 'Google (Gemini)' : `Whisper · ${hostOf(cfg.on_prem_stt_url)}`, cloud: gemini || hybrid },
    { label: 'Texte → synthèse et assistant', dest: gemini ? 'Google (Gemini)' : `LLM · ${hostOf(llm)}`, cloud: gemini },
    { label: 'Transcription en direct', dest: policy || (!gemini && !hybrid) ? 'Désactivée' : 'Navigateur → Google / Microsoft (si activée)', cloud: !(policy || (!gemini && !hybrid)) },
    { label: 'Comptes rendus publiés', dest: cfg.confluence_url ? `Confluence · ${hostOf(cfg.confluence_url)}` : 'Confluence non configuré', cloud: false },
    { label: 'Enregistrements et réglages', dest: 'Ce navigateur uniquement', cloud: false }
  ];
  return { flows, onPrem: !flows.some(f => f.cloud) };
}

function renderDataFlows(listEl, cfg) {
  if (!listEl) return;
  const { flows, onPrem } = dataFlows(cfg);
  listEl.innerHTML = flows.map(f => `<li><span class="data-flow-label">${escapeHtml(f.label)}</span><span class="data-flow-dest ${f.cloud ? 'data-flow-cloud' : 'data-flow-local'}">${f.cloud ? '☁️' : '🔒'} ${escapeHtml(f.dest)}</span></li>`).join('') +
    `<li class="data-flow-verdict ${onPrem ? 'data-flow-local' : 'data-flow-cloud'}">${onPrem ? '✅ 100 % sur site : rien ne quitte l’entreprise.' : '⚠️ Une partie des données part vers un service cloud.'}</li>`;
}

function refreshSettingsDataFlows() {
  renderDataFlows(document.getElementById('dataFlowList'), { ...state.config, ...readAiForm(), ...(window.VoxConfluence ? VoxConfluence.readSettings() : {}) });
}

async function testConnection() {
  elements.testConnStatus.textContent = 'Test en cours...';
  elements.testConnStatus.className = 'text-xs text-amber-400 truncate max-w-[280px] animate-pulse';
  const payload = readAiForm();

  try {
    const res = await fetch('/api/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      elements.testConnStatus.textContent = '✓ ' + data.message;
      elements.testConnStatus.className = 'text-xs text-emerald-400 truncate max-w-[280px] font-medium';
    } else {
      elements.testConnStatus.textContent = '✗ ' + data.message;
      elements.testConnStatus.className = 'text-xs text-rose-400 truncate max-w-[280px]';
    }
  } catch (err) {
    elements.testConnStatus.textContent = 'Erreur: ' + err.message;
    elements.testConnStatus.className = 'text-xs text-rose-400 truncate max-w-[280px]';
  }
}

async function saveSettings() {
  const payload = { ...readAiForm(), ...(window.VoxConfluence ? VoxConfluence.readSettings() : {}) };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      state.config = { ...state.config, ...payload };
      updateProviderBadge();
      document.dispatchEvent(new CustomEvent('voxai:config-changed'));
      closeSettingsModal();
      showToast('Configuration enregistrée avec succès !', '✅');
    }
  } catch (err) {
    showToast('Erreur enregistrement: ' + err.message, '⚠️');
  }
}

// ==============================================================================
// Enregistrement Audio (Dictaphone) & Waveform
// ==============================================================================

function initCanvas() {
  const canvas = elements.waveformCanvas;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  drawIdleWaveform();
}

function drawIdleWaveform() {
  const canvas = elements.waveformCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;

  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'light' ? '#cbd5e1' : '#334155';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ------------------------------------------------------------------------------
// Source audio : micro seul, ou micro + son de la visioconférence (Meet, Teams, Zoom sur ce poste).
// Le son de la réunion est capté par la fenêtre « Partager » du navigateur (getDisplayMedia), puis
// mélangé au micro dans une seule piste : la transcription garde l'ordre chronologique.
// ------------------------------------------------------------------------------
const CAPTURE_KEY = 'voxai_capture_source';

/** Capture du son d'un onglet ou du système : Chrome et Edge uniquement (ni Firefox ni Safari). */
function meetingCaptureReason() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') return 'Non disponible dans ce navigateur : utilisez Chrome ou Edge.';
  if (!/Chrome\/|Edg\//.test(navigator.userAgent)) return 'Le son d’une visio ne peut être capté qu’avec Chrome ou Edge.';
  return '';
}

function captureSource() {
  if (meetingCaptureReason()) return 'mic';
  try { return localStorage.getItem(CAPTURE_KEY) === 'meeting' ? 'meeting' : 'mic'; } catch { return 'mic'; }
}

function refreshCaptureUI() {
  const reason = meetingCaptureReason();
  const meetingRadio = document.querySelector('input[name="captureSource"][value="meeting"]');
  if (!meetingRadio) return;
  meetingRadio.disabled = !!reason;
  const mode = captureSource();
  document.querySelector(`input[name="captureSource"][value="${mode}"]`).checked = true;
  const hint = document.getElementById('captureHint');
  hint.textContent = reason
    ? `🎧 ${reason}`
    : mode === 'meeting'
      ? 'Au démarrage, choisissez l’onglet de la réunion (ou l’écran entier) et cochez « Partager l’audio ». Les voix des participants à distance seront enregistrées.'
      : 'Le micro seul ne capte pas les participants à distance d’une visio suivie au casque : choisissez « Micro + son de la visio ».';
}

/** Son de la réunion : fenêtre « Partager » du navigateur (onglet de la visio ou écran entier). */
async function acquireMeeting() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true, // exigé par Chrome ; l'image n'est ni enregistrée ni envoyée
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include'
  });
  stream.getVideoTracks().forEach(t => { t.enabled = false; });
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach(t => t.stop());
    throw Object.assign(new Error('Aucun son partagé'), { code: 'NO_AUDIO' });
  }
  return stream;
}

function onMeetingEnded() {
  if (!state.isRecording || state.meetingEnded) return;
  state.meetingEnded = true;
  if (state.meetingStream) state.meetingStream.getTracks().forEach(t => t.stop());
  document.getElementById('levelMeeting').style.width = '0%';
  showToast('Partage du son de la visio arrêté : l’enregistrement continue avec le micro seul.', '🎧');
}

async function startRecording() {
  if (state.isStarting || state.isRecording) return;
  state.isStarting = true;
  const mode = captureSource();
  // Contexte audio créé tout de suite (clic de l'utilisateur) : après la fenêtre « Partager »,
  // le navigateur pourrait le laisser en veille et l'enregistrement serait muet
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  let mic = null;
  let meeting = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    if (mode === 'meeting') {
      try {
        meeting = await acquireMeeting();
      } catch (err) {
        mic.getTracks().forEach(t => t.stop());
        audioContext.close();
        if (err.code === 'NO_AUDIO') {
          showToast('Aucun son partagé : relancez et cochez « Partager l’audio » (onglet de la visio ou écran entier), ou choisissez « Micro seul ».', '🎧');
        } else if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
          showToast('Partage annulé : enregistrement non démarré.', 'ℹ️');
        } else {
          showToast('Impossible de capter le son de la visio : ' + err.message, '⚠️');
        }
        return;
      }
    }
    if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {});

    state.audioStream = mic;
    state.meetingStream = meeting;
    state.meetingEnded = false;
    state.recordSource = meeting ? 'visio' : 'micro';
    state.audioContext = audioContext;
    const micSource = audioContext.createMediaStreamSource(mic);
    state.analyser = audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    let recordStream = mic;
    if (meeting) {
      // Mixage micro + réunion dans une seule piste, compresseur contre la saturation
      const meetingSource = audioContext.createMediaStreamSource(new MediaStream(meeting.getAudioTracks()));
      const compressor = audioContext.createDynamicsCompressor();
      const destination = audioContext.createMediaStreamDestination();
      state.levelMic = audioContext.createAnalyser();
      state.levelMeeting = audioContext.createAnalyser();
      state.levelMic.fftSize = state.levelMeeting.fftSize = 512;
      micSource.connect(state.levelMic);
      meetingSource.connect(state.levelMeeting);
      micSource.connect(compressor);
      meetingSource.connect(compressor);
      compressor.connect(destination);
      compressor.connect(state.analyser);
      recordStream = destination.stream;
      meeting.getTracks().forEach(t => t.addEventListener('ended', onMeetingEnded));
      state.meetingHeard = false;
      state.meetingWarned = false;
      document.getElementById('captureLevels').classList.remove('hidden');
    } else {
      micSource.connect(state.analyser);
    }

    // MediaRecorder Setup
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else mimeType = ''; // par défaut du navigateur
    }

    state.mediaRecorder = mimeType ? new MediaRecorder(recordStream, { mimeType }) : new MediaRecorder(recordStream);
    state.audioChunks = [];

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        state.audioChunks.push(e.data);
      }
    };

    state.mediaRecorder.onstop = handleRecordingStopped;

    state.recordCancelled = false;
    state.mediaRecorder.start(250); // morceaux de 250ms
    state.isRecording = true;
    state.isPaused = false;
    state.recordStartTime = Date.now();
    state.recordElapsedSec = 0;

    // UI Updates
    elements.micIcon.classList.add('hidden');
    elements.stopSquare.classList.remove('hidden');
    elements.recordingDot.classList.remove('hidden');
    elements.pauseRecordBtn.classList.remove('hidden');
    elements.cancelRecordBtn.classList.remove('hidden');
    elements.micPrompt.classList.add('hidden');
    document.querySelectorAll('input[name="captureSource"]').forEach(r => { r.disabled = true; });
    elements.recordStatusText.textContent = meeting
      ? 'Enregistrement de la visio en cours (micro + son de la réunion)... Cliquez pour terminer et analyser'
      : 'Enregistrement en cours... Cliquez pour terminer et analyser';
    elements.recordStatusText.className = 'text-xs text-rose-400 font-medium animate-pulse';

    // Start Timer
    state.recordTimerInterval = setInterval(() => {
      if (!state.isPaused) {
        state.recordElapsedSec++;
        elements.recordTimer.textContent = formatDuration(state.recordElapsedSec);
        // Réunion muette depuis 10 s : son probablement non partagé (onglet ou case « Partager l'audio »)
        if (state.levelMeeting && !state.meetingHeard && !state.meetingWarned && !state.meetingEnded && state.recordElapsedSec >= 10) {
          state.meetingWarned = true;
          showToast('Aucun son de la réunion depuis 10 s : avez-vous partagé le bon onglet (ou l’écran entier) avec « Partager l’audio » ?', '🎧');
        }
      }
    }, 1000);

    // Start Waveform render loop
    visualizeWaveform();

    // Transcription en direct (brouillon) si activée
    if (window.VoxLive) VoxLive.start();

  } catch (err) {
    console.error('Erreur accès micro:', err);
    if (mic) mic.getTracks().forEach(t => t.stop());
    if (meeting) meeting.getTracks().forEach(t => t.stop());
    if (audioContext.state !== 'closed') audioContext.close();
    showToast("Impossible d'accéder au microphone : " + err.message, '⚠️');
  } finally {
    state.isStarting = false;
  }
}

/** Niveau sonore (0 à 1) d'une source, d'après la forme du signal. */
function sourceLevel(analyser) {
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
  return Math.min(1, Math.sqrt(sum / data.length) * 4);
}

function visualizeWaveform() {
  if (!state.analyser || !state.isRecording) return;

  const canvas = elements.waveformCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.getBoundingClientRect().width;
  const h = canvas.getBoundingClientRect().height;

  const bufferLength = state.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  state.analyser.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, w, h);

  const numBars = 48;
  const barWidth = 4;
  const gap = (w - (numBars * barWidth)) / (numBars + 1);

  for (let i = 0; i < numBars; i++) {
    const dataIndex = Math.floor(i * (bufferLength / numBars));
    const value = dataArray[dataIndex] || 0;
    const barHeight = Math.max(4, (value / 255) * (h * 0.85));

    const x = gap + i * (barWidth + gap);
    const y = (h - barHeight) / 2;

    const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
    gradient.addColorStop(0, '#f43f5e');
    gradient.addColorStop(0.5, '#8b5cf6');
    gradient.addColorStop(1, '#6366f1');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, 2);
    ctx.fill();
  }

  // Visio : niveaux « Vous » et « Réunion »
  if (state.levelMic && state.levelMeeting) {
    const micLevel = sourceLevel(state.levelMic);
    const meetingLevel = state.meetingEnded ? 0 : sourceLevel(state.levelMeeting);
    if (meetingLevel > 0.02) state.meetingHeard = true;
    document.getElementById('levelMic').style.width = `${Math.round(micLevel * 100)}%`;
    document.getElementById('levelMeeting').style.width = `${Math.round(meetingLevel * 100)}%`;
  }

  state.animFrameId = requestAnimationFrame(visualizeWaveform);
}

function pauseRecording() {
  if (!state.mediaRecorder) return;
  if (!state.isPaused) {
    state.mediaRecorder.pause();
    state.isPaused = true;
    if (window.VoxLive) VoxLive.pause();
    elements.recordStatusText.textContent = 'Enregistrement en pause';
    elements.recordingDot.classList.add('hidden');
    elements.pauseRecordBtn.innerHTML = `
      <svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
      </svg>
    `;
  } else {
    state.mediaRecorder.resume();
    state.isPaused = false;
    if (window.VoxLive) VoxLive.resume();
    elements.recordStatusText.textContent = 'Enregistrement en cours...';
    elements.recordingDot.classList.remove('hidden');
    elements.pauseRecordBtn.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
    `;
  }
}

function cancelRecording() {
  if (!state.isRecording) return;
  state.audioChunks = [];
  state.recordCancelled = true; // l'arrêt des pistes déclenche encore onstop / un dernier morceau audio
  if (window.VoxLive) VoxLive.cancel();
  cleanUpRecordingStreams();
  resetRecorderUI();
  showToast('Enregistrement annulé', '❌');
}

function stopRecording() {
  if (!state.mediaRecorder || !state.isRecording) return;
  state.liveText = window.VoxLive ? VoxLive.stop() : '';
  state.mediaRecorder.stop();
  cleanUpRecordingStreams();
}

function cleanUpRecordingStreams() {
  state.isRecording = false;
  state.isPaused = false;
  if (state.recordTimerInterval) clearInterval(state.recordTimerInterval);
  if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
  if (state.audioStream) {
    state.audioStream.getTracks().forEach(track => track.stop());
  }
  if (state.meetingStream) {
    state.meetingStream.getTracks().forEach(track => track.stop());
    state.meetingStream = null;
  }
  state.levelMic = state.levelMeeting = null;
  if (state.audioContext && state.audioContext.state !== 'closed') {
    state.audioContext.close();
  }
}

function resetRecorderUI() {
  elements.micIcon.classList.remove('hidden');
  elements.stopSquare.classList.add('hidden');
  elements.recordingDot.classList.add('hidden');
  elements.pauseRecordBtn.classList.add('hidden');
  elements.cancelRecordBtn.classList.add('hidden');
  elements.micPrompt.classList.remove('hidden');
  elements.recordTimer.textContent = '00:00';
  elements.recordStatusText.textContent = 'Prêt à enregistrer';
  document.getElementById('captureLevels').classList.add('hidden');
  ['levelMic', 'levelMeeting'].forEach(id => { document.getElementById(id).style.width = '0%'; });
  document.querySelectorAll('input[name="captureSource"]').forEach(r => { r.disabled = false; });
  refreshCaptureUI();
  elements.recordStatusText.className = 'text-xs text-slate-400 font-medium';
  drawIdleWaveform();
}

async function handleRecordingStopped() {
  if (state.recordCancelled) {
    state.recordCancelled = false;
    state.audioChunks = [];
    return;
  }
  if (state.audioChunks.length === 0) {
    resetRecorderUI();
    return;
  }

  const mimeType = state.mediaRecorder.mimeType || 'audio/webm';
  const audioBlob = new Blob(state.audioChunks, { type: mimeType });
  const duration = state.recordElapsedSec;
  const customTitle = elements.recordTitleInput.value.trim()
    || (window.VoxSeries && VoxSeries.defaultTitle())
    || 'Conversation du ' + new Date().toLocaleDateString('fr-FR');

  const liveText = state.liveText || '';
  state.liveText = '';
  resetRecorderUI();
  if (window.VoxLive) VoxLive.reset();
  elements.recordTitleInput.value = '';

  await uploadAndProcessAudio(audioBlob, customTitle, duration, mimeType, liveText, state.recordSource);
}

async function uploadAndProcessAudio(blob, title, duration, mimeType, liveText = '', source = '') {
  showToast('Enregistrement de l’audio en local...', '⏳');

  try {
    const uploadRes = await fetch('/api/recordings/upload', {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'X-Audio-Duration': duration.toString(),
        'X-Audio-Title': encodeURIComponent(title),
        'X-Series-Id': (window.VoxSeries && VoxSeries.selectedId()) || '',
        'X-Audio-Source': source || ''
      },
      body: blob
    });

    const recordData = await uploadRes.json();
    if (liveText) {
      await fetch(`/api/recordings/${recordData.id}/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: liveText })
      });
    }
    await loadRecordings();
    
    // Basculer directement sur cet enregistrement
    await selectRecording(recordData.id);

    // Lancer automatiquement l'IA
    triggerAIProcessing(recordData.id);

  } catch (err) {
    showToast('Erreur envoi audio: ' + err.message, '⚠️');
  }
}

async function uploadBatchFilesAndProcess(files) {
  const defaultTitle = (window.VoxSeries && VoxSeries.defaultTitle()) || `Session groupée (${files.length} enregistrements)`;
  const title = prompt("Titre pour cette analyse conjointe :", defaultTitle) || defaultTitle;

  showToast(`Création de la session pour ${files.length} fichiers...`, '⏳');

  try {
    // 1. Créer la session
    const createRes = await fetch('/api/recordings/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, series_id: (window.VoxSeries && VoxSeries.selectedId()) || null })
    });
    const sessionData = await createRes.json();
    const recId = sessionData.id;

    // 2. Envoyer chaque fichier successivement
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      showToast(`Téléversement ${i + 1}/${files.length} : "${file.name}"...`, '📤');

      await fetch(`/api/recordings/${recId}/files`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'audio/webm',
          'X-Original-Filename': encodeURIComponent(file.name),
          'X-Audio-Duration': '0'
        },
        body: file
      });
    }

    await loadRecordings();
    await selectRecording(recId);

    // 3. Lancer l'analyse unifiée
    showToast(`Lancement de l'analyse conjointe des ${files.length} enregistrements...`, '🧠');
    triggerAIProcessing(recId);

  } catch (err) {
    showToast('Erreur lors de l’import groupé: ' + err.message, '⚠️');
  }
}

// ==============================================================================
// Gestion des Enregistrements (Liste & Détails)
// ==============================================================================

async function loadRecordings() {
  try {
    const res = await fetch('/api/recordings');
    state.recordings = await res.json();
    renderRecordingsList();
    checkBackupReminder();
    refreshPendingBanner();
    updateAssistantContext();
  } catch (err) {
    console.error('Erreur chargement recordings:', err);
  }
}

function renderRecordingsList() {
  const query = elements.searchRecordings.value.trim();
  const folded = foldWithMap(query).folded; // sans accents ni majuscules, comme dans la transcription
  const list = elements.recordingsList;
  list.innerHTML = '';

  const filtered = state.recordings.filter(r => {
    return foldWithMap(r.title || '').folded.includes(folded) && (!window.VoxSeries || VoxSeries.matchesFilter(r));
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="py-8 text-center text-xs text-slate-500">
        ${query ? 'Aucun résultat trouvé.' : 'Aucun enregistrement pour le moment.'}
      </div>
    `;
    return;
  }

  filtered.forEach(rec => {
    const isActive = state.activeRecording && state.activeRecording.id === rec.id;
    const item = document.createElement('div');
    item.className = `recording-item p-3 rounded-xl border border-transparent flex flex-col gap-1.5 ${isActive ? 'active' : ''}`;
    
    // Status Badge
    let statusBadge = '<span class="text-[10px] text-emerald-400">✓ Prêt</span>';
    if (rec.status === 'processing') {
      statusBadge = `<span class="text-[10px] text-amber-400 whitespace-nowrap shrink-0" data-progress="${escapeHtml(rec.id)}">⏳ ${escapeHtml(listProgressLabel(rec.id))}</span>`;
    } else if (rec.status === 'error') {
      statusBadge = '<span class="text-[10px] text-red-400">✗ Erreur</span>';
    } else if (rec.status === 'pending') {
      statusBadge = '<span class="text-[10px] text-sky-400" title="Enregistré hors ligne : analyse à lancer">⏳ En attente</span>';
    }

    const formattedDate = formatSimpleDate(rec.created_at);
    const duration = formatDuration(rec.duration || 0);
    const fileCount = rec.file_count || 1;
    const fileBadge = fileCount > 1 
      ? `<span class="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-medium">📚 ${fileCount} audios</span>` 
      : '';

    item.innerHTML = `
      <div class="flex items-center justify-between">
        <h4 class="text-xs font-semibold text-slate-200 truncate max-w-[170px]" title="${escapeHtml(rec.title)}">${escapeHtml(rec.title)}</h4>
        ${statusBadge}
      </div>
      <div class="flex items-center justify-between text-[11px] text-slate-400">
        <div class="flex items-center gap-1.5">
          <span>${formattedDate}</span>
          ${fileBadge}
        </div>
        <span class="font-mono">${duration}</span>
      </div>
    `;

    item.addEventListener('click', () => selectRecording(rec.id));
    list.appendChild(item);
  });
}

function selectAudioTrack(index) {
  const rec = state.activeRecording;
  if (!rec || !rec.files || !rec.files[index]) return;
  state.activeFileIndex = index;
  const file = rec.files[index];
  updateDownloadAudioBtn();

  VoxLocal.audioUrl(file.filename).then(u => { if (state.activeFileIndex === index) elements.audioElement.src = u; });
  elements.playerCurrentTime.textContent = '00:00';
  elements.playerTotalTime.textContent = formatDuration(file.duration || 0);
  elements.playerSeek.value = 0;
  
  // Highlight active track pill
  const pills = elements.trackPillsList.querySelectorAll('.track-pill-btn');
  pills.forEach((p, idx) => {
    if (idx === index) {
      p.className = 'track-pill-btn px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white shadow shrink-0 transition flex items-center gap-1.5';
    } else {
      p.className = 'track-pill-btn px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 shrink-0 transition flex items-center gap-1.5';
    }
  });
}

async function selectRecording(id) {
  try {
    const res = await fetch(`/api/recordings/${id}`);
    if (!res.ok) throw new Error('Enregistrement introuvable');
    const rec = await res.json();
    state.activeRecording = rec;

    // Basculer l'affichage
    elements.recorderView.classList.add('hidden');
    elements.detailsView.classList.remove('hidden');

    renderRecordingDetails();
    renderRecordingsList();
  } catch (err) {
    showToast('Erreur: ' + err.message, '⚠️');
  }
}

function renderRecordingDetails() {
  const rec = state.activeRecording;
  if (!rec) return;

  state.activeFileIndex = 0;
  const files = rec.files || [];
  const fileCount = files.length || 1;

  elements.detailTitle.textContent = rec.title;
  elements.detailDate.textContent = new Date(rec.created_at).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  elements.detailDuration.textContent = formatDuration(rec.duration || 0);
  elements.detailSize.textContent = formatBytes(rec.file_size || 0);

  // File Count Badge & Multi-track Selector
  if (fileCount > 1) {
    elements.detailFilesBadge.textContent = `${fileCount} fichiers audio`;
    elements.detailFilesBadge.className = 'px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium';
    elements.trackSelectorContainer.classList.remove('hidden');

    elements.trackPillsList.innerHTML = files.map((f, idx) => `
      <button type="button" class="track-pill-btn ${idx === 0 ? 'bg-indigo-600 text-white shadow font-semibold' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-medium'} px-2.5 py-1 rounded-lg text-xs shrink-0 transition flex items-center gap-1.5" data-index="${idx}">
        <span>🎵</span>
        <span class="max-w-[140px] truncate" title="${escapeHtml(f.original_name)}">${escapeHtml(f.original_name)}</span>
        <span class="font-mono text-[10px] text-slate-300">(${formatDuration(f.duration || 0)})</span>
      </button>
    `).join('');

    elements.trackPillsList.querySelectorAll('.track-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        selectAudioTrack(idx);
        elements.audioElement.play();
      });
    });
  } else {
    elements.detailFilesBadge.textContent = `1 fichier audio`;
    elements.detailFilesBadge.className = 'px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-medium';
    elements.trackSelectorContainer.classList.add('hidden');
    elements.trackPillsList.innerHTML = '';
  }

  // Status Badge
  if (rec.status === 'completed') {
    elements.detailStatusBadge.textContent = 'Analysé par IA';
    elements.detailStatusBadge.className = 'text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  } else if (rec.status === 'processing') {
    elements.detailStatusBadge.textContent = 'Analyse IA en cours...';
    elements.detailStatusBadge.className = 'text-xs px-2.5 py-0.5 rounded-full font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse';
  } else if (rec.status === 'error') {
    elements.detailStatusBadge.textContent = 'Erreur d’analyse';
    elements.detailStatusBadge.className = 'text-xs px-2.5 py-0.5 rounded-full font-medium bg-red-500/10 text-red-400 border border-red-500/20';
  } else if (rec.status === 'pending') {
    elements.detailStatusBadge.textContent = 'En attente d’analyse (hors ligne)';
    elements.detailStatusBadge.className = 'text-xs px-2.5 py-0.5 rounded-full font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20';
  } else {
    elements.detailStatusBadge.textContent = 'Non analysé';
    elements.detailStatusBadge.className = 'text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-700 text-slate-300';
  }

  // Audio Player setup
  const initialFile = (files.length > 0) ? files[0].filename : rec.filename;
  VoxLocal.audioUrl(initialFile).then(u => { if (state.activeRecording === rec) elements.audioElement.src = u; });
  elements.playerCurrentTime.textContent = '00:00';
  elements.playerTotalTime.textContent = formatDuration(rec.duration || 0);
  elements.playerSeek.value = 0;
  elements.playerPlayIcon.classList.remove('hidden');
  elements.playerPauseIcon.classList.add('hidden');

  updateDownloadAudioBtn();
  updateAssistantContext();
  renderAnalysisProgress();
  document.dispatchEvent(new CustomEvent('voxai:recording-shown'));

  // Render Tabs
  const search = document.getElementById('searchTranscript');
  if (search) search.value = '';
  renderSummaryTab(rec.summary);
  renderTranscriptTab(rec.transcription);
  renderChatTab(rec.chat_history || []);
}

function renderSummaryTab(summary) {
  if (!summary || typeof summary !== 'object') {
    const card = document.getElementById('followupCard');
    if (card) card.classList.add('hidden');
    const pending = state.activeRecording && state.activeRecording.status === 'pending';
    elements.summaryExecutive.textContent = pending
      ? "📴 Enregistré hors ligne : l'audio est conservé sur cet appareil. Lancez l'analyse (« Relancer IA » ou « Analyser maintenant ») dès que le réseau est revenu."
      : "Cet enregistrement n'a pas encore été analysé par l'IA. Cliquez sur 'Relancer IA' ci-dessus.";
    elements.summaryDecisions.innerHTML = '<li class="text-slate-500 italic">Aucune décision recensée.</li>';
    elements.summaryActions.innerHTML = '<p class="text-slate-500 italic">Aucune action requise.</p>';
    elements.summaryKeyPoints.innerHTML = '';
    elements.summaryTags.innerHTML = '';
    return;
  }

  // Résumé
  elements.summaryExecutive.innerHTML = summary.executive
    ? escapeHtml(summary.executive) + refChips(summary.executive_refs)
    : "Aucun résumé disponible.";

  // Décisions
  const decisions = summary.decisions || [];
  if (decisions.length > 0) {
    elements.summaryDecisions.innerHTML = decisions.map(d => `
      <li class="flex items-start gap-2 bg-slate-800/40 p-2 rounded-lg border border-slate-700/40">
        <span class="text-emerald-400 font-bold shrink-0">✓</span>
        <span>${escapeHtml(itemText(d))}${refChips(itemRefs(d))}</span>
      </li>
    `).join('');
  } else {
    elements.summaryDecisions.innerHTML = '<li class="text-slate-500 italic">Aucune décision spécifique mentionnée.</li>';
  }

  // Actions
  const actions = summary.action_items || [];
  if (actions.length > 0) {
    elements.summaryActions.innerHTML = actions.map((a, idx) => `
      <label class="flex items-start gap-2.5 bg-slate-800/40 p-2 rounded-lg border border-slate-700/40 cursor-pointer hover:bg-slate-800/70 transition">
        <input type="checkbox" class="action-check mt-0.5 accent-indigo-500 rounded" data-index="${idx}" ${a.status === 'done' ? 'checked' : ''}>
        <div class="flex-1">
          <span class="task-text text-slate-200 block">${escapeHtml(a.task)}${refChips(a.refs)}</span>
          <div class="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
            <span class="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">👤 ${escapeHtml(a.assignee || 'Tous')}</span>
            ${deadlineChips(a.deadline, a.status)}
          </div>
        </div>
      </label>
    `).join('');
  } else {
    elements.summaryActions.innerHTML = '<p class="text-slate-500 italic">Aucune tâche ou plan d\'action détecté.</p>';
  }

  // Points clés
  const keyPoints = summary.key_points || [];
  elements.summaryKeyPoints.innerHTML = keyPoints.map(kp => `<li>${escapeHtml(itemText(kp))}${refChips(itemRefs(kp))}</li>`).join('');

  // Tags
  const tags = summary.tags || [];
  elements.summaryTags.innerHTML = tags.map(t => `
    <span class="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-medium">#${escapeHtml(t)}</span>
  `).join('');

  // Suivi des actions des réunions précédentes (séries, phase 2)
  if (window.VoxSeries) VoxSeries.renderFollowup();
}

/**
 * Échéance d'une action : date AAAA-MM-JJ (analyses récentes) mise en forme et repérée en retard,
 * ou texte libre (anciennes analyses, « À définir ») affiché tel quel.
 */
function deadlineInfo(deadline, status) {
  const raw = String(deadline || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  // Date inexistante (31 février…) : affichée telle quelle, jamais reportée au mois suivant
  if (!date || isNaN(date) || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) {
    return { label: raw, long: raw, overdue: false, iso: '' };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sameYear = date.getFullYear() === today.getFullYear();
  return {
    label: date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }),
    long: date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    overdue: status !== 'done' && date < today,
    iso: raw
  };
}

/** Pastilles d'échéance (HTML) : date, et « En retard » si elle est dépassée. */
function deadlineChips(deadline, status) {
  const d = deadlineInfo(deadline, status);
  if (!d.label) return '';
  return `<span class="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300" ${d.iso ? `title="${escapeHtml(d.long)}"` : ''}>📅 ${escapeHtml(d.label)}</span>` +
    (d.overdue ? '<span class="deadline-overdue">⏰ En retard</span>' : '');
}

// Un élément de synthèse est soit une chaîne (anciennes analyses), soit { text, refs }
function itemText(item) {
  return (item && typeof item === 'object') ? (item.text || '') : String(item ?? '');
}

function itemRefs(item) {
  return (item && typeof item === 'object' && Array.isArray(item.refs)) ? item.refs : [];
}

/** Pastilles cliquables renvoyant vers les segments (numérotés à partir de 1) de la transcription. */
function refChips(refs) {
  const transcription = (state.activeRecording && state.activeRecording.transcription) || [];
  const isMulti = state.activeRecording && state.activeRecording.files && state.activeRecording.files.length > 1;
  const valid = [...new Set((refs || []).map(n => parseInt(n, 10)))]
    .filter(n => n >= 1 && n <= transcription.length)
    .sort((a, b) => a - b);
  if (!valid.length) return '';
  return ' ' + valid.map(n => {
    const seg = transcription[n - 1];
    const label = (isMulti ? `P${seg.file_index || 1} · ` : '') + (seg.timestamp || '00:00');
    const tip = `${seg.speaker || 'Orateur'} : ${(seg.text || '').slice(0, 140)}`;
    return `<button type="button" class="ref-chip" data-seg="${n - 1}" title="${escapeHtml(tip)}">↪ ${escapeHtml(label)}</button>`;
  }).join('');
}

/** Ouvre la transcription sur un segment, le met en évidence et positionne l'audio. */
function goToSegment(idx) {
  const rec = state.activeRecording;
  const seg = rec && rec.transcription && rec.transcription[idx];
  if (!seg) return;
  switchTab('transcript');
  const el = document.getElementById(`seg-${idx}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('seg-highlight');
    void el.offsetWidth; // relance l'animation
    el.classList.add('seg-highlight');
  }
  const isMulti = rec.files && rec.files.length > 1;
  const trackIdx = Math.max(0, (seg.file_index || 1) - 1);
  if (isMulti && state.activeFileIndex !== trackIdx && rec.files[trackIdx]) selectAudioTrack(trackIdx);
  const sec = parseTimestamp(seg.timestamp || '00:00');
  const audio = elements.audioElement;
  if (audio.readyState >= 1) audio.currentTime = sec;
  else audio.addEventListener('loadedmetadata', () => { audio.currentTime = sec; }, { once: true });
}

async function renameSpeaker(oldName) {
  const rec = state.activeRecording;
  if (!rec || !oldName) return;
  const newName = (prompt(`Nouveau nom pour « ${oldName} » :`, oldName) || '').trim();
  if (!newName || newName === oldName) return;
  const res = await fetch(`/api/recordings/${rec.id}/speakers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: oldName, to: newName })
  });
  const data = await res.json();
  if (!data.success) {
    showToast('Erreur : ' + (data.error || 'renommage impossible'), '⚠️');
    return;
  }
  // Rafraîchit uniquement les onglets, sans réinitialiser le lecteur audio
  const fresh = await (await fetch(`/api/recordings/${rec.id}`)).json();
  if (state.activeRecording !== rec) return;
  rec.transcription = fresh.transcription;
  rec.summary = fresh.summary;
  renderSummaryTab(rec.summary);
  renderTranscriptTab(rec.transcription);
  if (data.participant && data.participant.created) {
    showToast(`« ${newName} » ajouté aux participants de la série`, '👥');
    if (window.VoxSeries) VoxSeries.reload();
  } else {
    showToast(`« ${oldName} » renommé en « ${newName} »`, '✏️');
  }
}

// ==============================================================================
// Recherche dans la transcription (sans tenir compte des accents ni des majuscules)
// ==============================================================================

/** Texte « replié » (minuscules, sans accents) + correspondance vers les positions d'origine. */
function foldWithMap(text) {
  let folded = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const f = text[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (let k = 0; k < f.length; k++) { folded += f[k]; map.push(i); }
  }
  map.push(text.length);
  return { folded, map };
}

function highlightMatches(text, query) {
  const q = foldWithMap(query.trim()).folded;
  if (!q) return { html: escapeHtml(text), count: 0 };
  const { folded, map } = foldWithMap(text);
  let html = '', last = 0, count = 0, from = 0, idx;
  while ((idx = folded.indexOf(q, from)) !== -1) {
    const start = map[idx], end = map[idx + q.length];
    html += escapeHtml(text.slice(last, start)) + `<mark class="search-hit">${escapeHtml(text.slice(start, end))}</mark>`;
    last = end; from = idx + q.length; count++;
  }
  return { html: html + escapeHtml(text.slice(last)), count };
}

function applyTranscriptSearch() {
  const input = document.getElementById('searchTranscript');
  const info = document.getElementById('transcriptSearchInfo');
  const rec = state.activeRecording;
  const query = input ? input.value : '';
  const segs = (rec && Array.isArray(rec.transcription)) ? rec.transcription : [];
  let shown = 0, hits = 0;
  segs.forEach((seg, idx) => {
    const item = document.getElementById(`seg-${idx}`);
    if (!item) return;
    const textEl = item.querySelector('.seg-text');
    const t = highlightMatches(seg.text || '', query);
    const speakerHit = query.trim() && foldWithMap(seg.speaker || '').folded.includes(foldWithMap(query.trim()).folded);
    if (textEl) textEl.innerHTML = t.html;
    const match = !query.trim() || t.count > 0 || speakerHit;
    item.classList.toggle('hidden', !match);
    if (match) shown++;
    hits += t.count;
  });
  if (info) {
    info.textContent = query.trim()
      ? (!shown ? 'Aucun résultat'
        : hits ? `${hits} occurrence${hits > 1 ? 's' : ''} dans ${shown} passage${shown > 1 ? 's' : ''}`
        : `${shown} passage${shown > 1 ? 's' : ''} (orateur)`)
      : '';
  }
  const first = query.trim() && elements.transcriptTimeline.querySelector('.search-hit');
  if (first) first.scrollIntoView({ block: 'nearest' });
}

function renderSpeakersBar(transcription) {
  const bar = elements.speakersBar;
  if (!bar) return;
  const speakers = [...new Set((transcription || []).map(s => s.speaker).filter(Boolean))];
  if (!speakers.length) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }
  bar.classList.remove('hidden');
  bar.innerHTML = `<span class="text-[11px] text-slate-400 font-semibold mr-1">Orateurs :</span>` + speakers.map(name => `
    <button type="button" class="speaker-rename-btn" data-speaker="${escapeHtml(name)}" title="Renommer cet orateur partout">
      <span>${escapeHtml(name)}</span><span aria-hidden="true">✏️</span>
    </button>`).join('');
  bar.querySelectorAll('.speaker-rename-btn').forEach(btn =>
    btn.addEventListener('click', () => renameSpeaker(btn.dataset.speaker)));
}

function renderTranscriptTab(transcription) {
  const container = elements.transcriptTimeline;
  container.innerHTML = '';
  renderSpeakersBar(transcription);

  if (!transcription || !Array.isArray(transcription) || transcription.length === 0) {
    const draft = state.activeRecording && state.activeRecording.live_transcript;
    container.innerHTML = draft ? `
      <div class="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-slate-300 space-y-2">
        <div class="font-semibold text-amber-300">📝 Brouillon de la transcription en direct</div>
        <div class="text-[11px] text-slate-400">La transcription définitive (orateurs, horodatages précis) apparaîtra ici après l'analyse IA.</div>
        <div class="whitespace-pre-wrap leading-relaxed font-mono text-[11px] text-slate-200">${escapeHtml(draft)}</div>
      </div>
    ` : `
      <div class="p-8 text-center text-xs text-slate-500">
        Aucune transcription disponible pour cet enregistrement.
      </div>
    `;
    return;
  }

  const isMultiTrack = state.activeRecording && state.activeRecording.files && state.activeRecording.files.length > 1;

  transcription.forEach((seg, idx) => {
    const item = document.createElement('div');
    item.id = `seg-${idx}`;
    item.className = 'transcript-seg flex items-start gap-4 p-3 rounded-xl bg-slate-900/40 border border-slate-800/60 hover:border-slate-700/80 transition';
    
    const speakerName = escapeHtml(seg.speaker || `Orateur ${idx + 1}`);
    // Défense en profondeur : valeurs normalisées et échappées même si la base a été validée
    const timestamp = escapeHtml(/^[\d:.]{1,12}$/.test(String(seg.timestamp || '')) ? seg.timestamp : '00:00');
    const text = escapeHtml(seg.text || '');
    const fileIdx = Math.max(1, parseInt(seg.file_index, 10) || 1);
    const fileName = seg.file_name ? escapeHtml(seg.file_name) : `Piste ${fileIdx}`;

    item.innerHTML = `
      <div class="flex flex-col items-center gap-1 shrink-0">
        <button class="timestamp-btn px-2 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 font-mono text-xs border border-indigo-500/20 transition" data-time="${timestamp}" data-track="${fileIdx}">
          ▶ ${timestamp}
        </button>
        ${isMultiTrack ? `<span class="text-[10px] text-slate-400 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 max-w-[85px] truncate" title="${fileName}">Piste ${fileIdx}</span>` : ''}
      </div>
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-1">
          <button type="button" class="speaker-name-btn text-xs font-semibold text-slate-300 hover:text-indigo-300 transition" title="Cliquer pour renommer cet orateur">${speakerName}</button>
          ${isMultiTrack ? `<span class="text-[10px] text-indigo-400/80 italic">• ${fileName}</span>` : ''}
        </div>
        <p class="seg-text text-xs text-slate-200 leading-relaxed">${text}</p>
      </div>
    `;

    if (seg.speaker) {
      item.querySelector('.speaker-name-btn').addEventListener('click', () => renameSpeaker(seg.speaker));
    }

    // Click on timestamp jumps audio player (switching track if multi-track)
    const btn = item.querySelector('.timestamp-btn');
    btn.addEventListener('click', () => {
      if (isMultiTrack) {
        const targetTrackIdx = Math.max(0, fileIdx - 1);
        if (state.activeFileIndex !== targetTrackIdx && state.activeRecording.files[targetTrackIdx]) {
          selectAudioTrack(targetTrackIdx);
        }
      }
      const sec = parseTimestamp(timestamp);
      elements.audioElement.currentTime = sec;
      elements.audioElement.play();
    });

    container.appendChild(item);
  });
  applyTranscriptSearch();
}

function renderChatTab(history) {
  elements.chatMessages.innerHTML = `
    <div class="p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 text-xs text-slate-300">
      Bonjour ! Que souhaitez-vous savoir ou générer à partir de cette conversation ?
    </div>
  `;

  history.forEach(msg => {
    appendChatMessage(msg.role, msg.content);
  });
}

function appendChatMessage(role, content, container = elements.chatMessages) {
  const isUser = role === 'user';
  const div = document.createElement('div');
  div.className = `p-3 rounded-xl text-xs leading-relaxed max-w-[85%] ${
    isUser 
      ? 'ml-auto bg-indigo-600 text-white shadow' 
      : 'mr-auto bg-slate-800/70 text-slate-200 border border-slate-700/60'
  }`;
  if (isUser) {
    div.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
  } else {
    // Une éventuelle proposition de correction de la synthèse est retirée du texte et affichée à part
    const { text, proposal, invalid } = parseAssistantReply(content);
    // Markdown simple (gras, listes) ; le texte est échappé avant mise en forme
    div.innerHTML = `<div class="chat-md">${markdownToHtml(text || (proposal ? 'Voici la correction proposée :' : ''))}</div>`;
    if (proposal) div.appendChild(buildProposalCard(proposal));
    if (invalid) {
      const warn = document.createElement('p');
      warn.className = 'text-[11px] text-amber-400 mt-2';
      warn.textContent = "⚠️ La proposition de correction de l'IA est illisible : reformulez votre demande.";
      div.appendChild(warn);
    }
    if (text) div.appendChild(buildChatActions(text));
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ==============================================================================
// Corrections de la synthèse proposées par l'assistant (validées par l'utilisateur)
// ==============================================================================

/** Sépare le texte de la réponse et le bloc ```voxai-summary``` éventuel. */
function parseAssistantReply(content) {
  const match = String(content).match(/```\s*voxai-summary\s*([\s\S]*?)```/i);
  if (!match) return { text: content, proposal: null };
  const text = String(content).replace(match[0], '').trim();
  try {
    const raw = match[1].trim();
    const data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    if (!data || !data.recording_id || !data.summary || typeof data.summary !== 'object') throw new Error('incomplet');
    return { text, proposal: data };
  } catch {
    return { text, proposal: null, invalid: true };
  }
}

const itemTextOf = (i) => String((i && typeof i === 'object') ? (i.text || '') : (i || '')).trim();

/** Liste lisible des différences entre la synthèse actuelle et la proposition. */
function summaryChanges(current, proposed, currentTitle, proposedTitle) {
  const cur = current || {}, next = proposed || {};
  const changes = [];
  if (proposedTitle && proposedTitle.trim() && proposedTitle.trim() !== (currentTitle || '').trim()) {
    changes.push({ kind: 'edit', label: 'Titre', before: currentTitle, after: proposedTitle.trim() });
  }
  if ((cur.executive || '').trim() !== (next.executive || '').trim()) {
    changes.push({ kind: 'edit', label: 'Résumé exécutif', before: cur.executive || '', after: next.executive || '' });
  }
  const diffList = (label, a, b) => {
    const before = (a || []).map(itemTextOf).filter(Boolean), after = (b || []).map(itemTextOf).filter(Boolean);
    after.filter(t => !before.includes(t)).forEach(t => changes.push({ kind: 'add', label, after: t }));
    before.filter(t => !after.includes(t)).forEach(t => changes.push({ kind: 'del', label, before: t }));
  };
  diffList('Décision', cur.decisions, next.decisions);
  diffList('Point clé', cur.key_points, next.key_points);
  const describe = (a) => [a.task, a.assignee && `👤 ${a.assignee}`, a.deadline && `📅 ${a.deadline}`].filter(Boolean).join(' · ');
  const curActions = cur.action_items || [], nextActions = next.action_items || [];
  const key = (a) => String(a.task || '').trim().toLowerCase();
  nextActions.forEach(a => {
    const old = curActions.find(o => key(o) === key(a));
    if (!old) changes.push({ kind: 'add', label: 'Action', after: describe(a) });
    else if (describe(old) !== describe(a)) changes.push({ kind: 'edit', label: 'Action', before: describe(old), after: describe(a) });
  });
  curActions.filter(o => !nextActions.some(a => key(a) === key(o)))
    .forEach(o => changes.push({ kind: 'del', label: 'Action', before: describe(o) }));
  const tagsBefore = (cur.tags || []).join(', '), tagsAfter = (next.tags || []).join(', ');
  if (tagsBefore !== tagsAfter) changes.push({ kind: 'edit', label: 'Tags', before: tagsBefore, after: tagsAfter });
  return changes;
}

async function refreshAfterSummaryChange(recId) {
  await loadRecordings();
  if (state.activeRecording && state.activeRecording.id === recId) {
    const fresh = await (await fetch(`/api/recordings/${recId}`)).json();
    state.activeRecording.summary = fresh.summary;
    state.activeRecording.title = fresh.title;
    elements.detailTitle.textContent = fresh.title;
    renderSummaryTab(fresh.summary);
  }
}

function buildProposalCard(proposal) {
  const card = document.createElement('div');
  card.className = 'proposal-card';
  card.innerHTML = '<div class="proposal-head">✏️ Correction proposée de la synthèse</div><div class="proposal-body text-slate-400">Comparaison avec la synthèse actuelle…</div>';
  const body = card.querySelector('.proposal-body');

  (async () => {
    const res = await fetch(`/api/recordings/${encodeURIComponent(proposal.recording_id)}`);
    if (!res.ok) { body.textContent = "Enregistrement introuvable : la proposition ne peut pas être appliquée."; return; }
    const rec = await res.json();
    const changes = summaryChanges(rec.summary, proposal.summary, rec.title, proposal.title);
    const target = `<div class="proposal-target">Enregistrement : <strong>${escapeHtml(rec.title)}</strong></div>`;
    if (!changes.length) {
      body.innerHTML = target + '<p class="text-emerald-400">✓ La synthèse actuelle correspond déjà à cette proposition.</p>';
      return;
    }
    const icon = { add: '➕', del: '➖', edit: '✏️' };
    body.innerHTML = target + '<ul class="proposal-changes">' + changes.map(c => `<li class="proposal-${c.kind}">
        <span class="proposal-label">${icon[c.kind]} ${escapeHtml(c.label)}</span>
        ${c.before != null && c.kind !== 'add' ? `<span class="proposal-before">${escapeHtml(c.before || '(vide)')}</span>` : ''}
        ${c.after != null && c.kind !== 'del' ? `<span class="proposal-after">${escapeHtml(c.after || '(vide)')}</span>` : ''}
      </li>`).join('') + '</ul>';
    const bar = document.createElement('div');
    bar.className = 'proposal-actions';
    const btn = (label, cls, onClick) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.textContent = label; b.addEventListener('click', onClick);
      bar.appendChild(b); return b;
    };
    const apply = btn('✅ Appliquer la correction', 'proposal-apply', async () => {
      apply.disabled = true;
      const r = await fetch(`/api/recordings/${encodeURIComponent(proposal.recording_id)}/summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: proposal.summary, title: proposal.title })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { apply.disabled = false; showToast('Correction refusée : ' + (data.error || r.status), '⚠️'); return; }
      await refreshAfterSummaryChange(proposal.recording_id);
      bar.innerHTML = '<span class="text-emerald-400 font-semibold">✓ Correction appliquée</span>';
      btn('↩️ Annuler', 'proposal-ignore', async () => {
        const u = await fetch(`/api/recordings/${encodeURIComponent(proposal.recording_id)}/summary/undo`, { method: 'POST' });
        if (!u.ok) { showToast("Impossible d'annuler", '⚠️'); return; }
        await refreshAfterSummaryChange(proposal.recording_id);
        bar.innerHTML = '<span class="text-slate-400">↩️ Correction annulée : la synthèse précédente est rétablie.</span>';
        showToast('Synthèse précédente rétablie', '↩️');
      });
      showToast('Synthèse corrigée', '✏️');
    });
    btn('Ignorer', 'proposal-ignore', () => { bar.innerHTML = '<span class="text-slate-500">Proposition ignorée.</span>'; });
    card.appendChild(bar);
  })().catch(err => { body.textContent = 'Erreur : ' + err.message; });
  return card;
}

// ==============================================================================
// Assistant global : disponible partout, sur l'ensemble des réunions
// ==============================================================================

const assistant = { open: false, loaded: false, busy: false, loading: null };

function assistantEls() {
  return {
    panel: document.getElementById('assistantPanel'),
    messages: document.getElementById('assistantMessages'),
    input: document.getElementById('assistantInput'),
    context: document.getElementById('assistantContext')
  };
}

function updateAssistantContext() {
  const { context } = assistantEls();
  if (!context) return;
  const n = (state.recordings || []).length;
  const rec = state.activeRecording && !elements.detailsView.classList.contains('hidden') ? state.activeRecording : null;
  context.innerHTML = `Contexte : <strong>${n} enregistrement${n > 1 ? 's' : ''}</strong>` +
    (rec ? ` · ouvert : <strong>${escapeHtml(rec.title)}</strong>` : '');
}

async function loadAssistantHistory() {
  const { messages } = assistantEls();
  const history = await (await fetch('/api/assistant/history')).json();
  messages.innerHTML = `<div class="p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 text-xs text-slate-300">
    Bonjour ! Je connais toutes vos réunions enregistrées. Posez une question transversale, demandez un e-mail, ou signalez une erreur dans une synthèse pour que je la corrige.</div>`;
  history.forEach(m => appendChatMessage(m.role, m.content, messages));
  assistant.loaded = true;
}

function toggleAssistant(force) {
  const { panel, input } = assistantEls();
  assistant.open = typeof force === 'boolean' ? force : !assistant.open;
  panel.classList.toggle('hidden', !assistant.open);
  document.body.classList.toggle('assistant-open', assistant.open); // décale les notifications
  document.getElementById('assistantToggleBtn').setAttribute('aria-expanded', String(assistant.open));
  if (assistant.open) {
    updateAssistantContext();
    if (!assistant.loaded && !assistant.loading) assistant.loading = loadAssistantHistory().finally(() => { assistant.loading = null; });
    setTimeout(() => input.focus(), 50);
  }
}

async function sendAssistantMessage(e) {
  if (e) e.preventDefault();
  const { messages, input } = assistantEls();
  const msg = input.value.trim();
  if (!msg || assistant.busy) return;
  input.value = '';
  assistant.busy = true;
  // Historique en cours de chargement : l'attendre, sinon il effacerait la question affichée
  if (assistant.loading) await assistant.loading.catch(() => {});
  appendChatMessage('user', msg, messages);
  const loading = document.createElement('div');
  loading.className = 'p-3 rounded-xl text-xs mr-auto bg-slate-800/70 text-slate-400 border border-slate-700/60 animate-pulse';
  loading.textContent = "L'IA réfléchit…";
  messages.appendChild(loading);
  messages.scrollTop = messages.scrollHeight;
  const focus = state.activeRecording && !elements.detailsView.classList.contains('hidden') ? state.activeRecording.id : null;
  try {
    const res = await fetch('/api/assistant/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, focus_id: focus })
    });
    const data = await res.json();
    loading.remove();
    appendChatMessage('assistant', data.reply || ('Erreur : ' + (data.error || 'pas de réponse')), messages);
  } catch (err) {
    loading.remove();
    appendChatMessage('assistant', 'Erreur de communication : ' + err.message, messages);
  } finally {
    assistant.busy = false;
  }
}

function setupAssistant() {
  const { panel, input } = assistantEls();
  if (!panel) return;
  document.getElementById('assistantToggleBtn').addEventListener('click', () => toggleAssistant());
  document.getElementById('assistantCloseBtn').addEventListener('click', () => toggleAssistant(false));
  document.getElementById('assistantForm').addEventListener('submit', sendAssistantMessage);
  document.getElementById('assistantClearBtn').addEventListener('click', async () => {
    if (!confirm("Effacer la conversation de l'assistant global ?")) return;
    await fetch('/api/assistant/history', { method: 'DELETE' });
    loadAssistantHistory();
  });
  panel.querySelectorAll('.assistant-chip').forEach(chip => chip.addEventListener('click', () => {
    if (chip.dataset.prefill) { input.value = chip.dataset.prefill; input.focus(); return; }
    input.value = chip.textContent.trim();
    sendAssistantMessage();
  }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && assistant.open) toggleAssistant(false); });
}

// ==============================================================================
// Copie des réponses de l'assistant (et e-mails prêts à envoyer)
// ==============================================================================

/** Repère un e-mail rédigé par l'IA : ligne « Objet : … » (ou « Subject: … ») suivie du corps. */
function parseEmail(content) {
  const lines = String(content).replace(/\r/g, '').split('\n');
  const idx = lines.findIndex((l, i) => i < 6 && /^\s*[*_#>\s]*(objet|subject)\s*[*_]*\s*:/i.test(l));
  if (idx === -1) return null;
  const subject = stripMarkdown(lines[idx].replace(/^\s*[*_#>\s]*(objet|subject)\s*[*_]*\s*:\s*[*_]*\s*/i, '')).replace(/[*_]+\s*$/, '').trim();
  const body = lines.slice(idx + 1).join('\n').replace(/^\s*(-{3,}|\*{3,})\s*$/m, '').trim();
  return subject && body ? { subject, body } : null;
}

/** Texte brut sans syntaxe Markdown (gras, titres, code), listes conservées. */
function stripMarkdown(text) {
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^(\s*)[*+]\s+/gm, '$1- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Version HTML simple (gras, listes, paragraphes) pour un collage mis en forme dans Outlook / Gmail. */
function markdownToHtml(text) {
  const inline = s => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>');
  const out = [];
  let list = null;
  let para = [];
  const flushPara = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = []; };
  const closeList = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const raw of String(text).split('\n')) {
    const item = raw.match(/^\s*(?:[-*+•]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      const tag = /^\s*\d/.test(raw) ? 'ol' : 'ul';
      if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    closeList();
    const heading = raw.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (heading) { flushPara(); out.push(`<p><strong>${inline(heading[1])}</strong></p>`); }
    else if (raw.trim()) para.push(inline(raw));
    else flushPara();
  }
  flushPara();
  closeList();
  return out.join('');
}

async function copyRich(markdown, label) {
  const plain = stripMarkdown(markdown);
  try {
    if (window.ClipboardItem && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([markdownToHtml(markdown)], { type: 'text/html' })
      })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    showToast(`${label} copié !`, '📋');
    return true;
  } catch (err) {
    showToast('Copie impossible : ' + err.message, '⚠️');
    return false;
  }
}

/** Adresses de destinataires sûres : format strict, sans espace, virgule ni retour à la ligne. */
const RECIPIENT_RE = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
function recipientsOf(email) {
  return [...new Set((Array.isArray(email.to) ? email.to : []).map(a => String(a).trim()).filter(a => RECIPIENT_RE.test(a)))];
}

/** Corps mis dans le lien quand le message est trop long : le vrai corps est dans le presse-papiers. */
const PASTE_HINT = 'Le message complet a été copié par VoxAI : collez-le ici (Ctrl+V ou Cmd+V) à la place de ce texte.';

/** Lien mailto ; les liens trop longs étant tronqués par certaines messageries, le corps est alors
 *  remplacé par une consigne de collage (le corps complet est copié dans le presse-papiers). */
function mailtoUrl(email) {
  const to = recipientsOf(email).map(encodeURIComponent).join(',');
  const subject = encodeURIComponent(email.subject);
  const body = encodeURIComponent(stripMarkdown(email.body));
  const fits = to.length + subject.length + body.length <= 1800;
  return { url: `mailto:${to}?subject=${subject}&body=${fits ? body : encodeURIComponent(PASTE_HINT)}`, bodyIncluded: fits };
}

/** Lien de rédaction Outlook sur le web (Microsoft 365). */
function outlookWebUrl(email) {
  const subject = encodeURIComponent(email.subject);
  const body = encodeURIComponent(stripMarkdown(email.body));
  const fits = subject.length + body.length <= 7000;
  const to = recipientsOf(email).map(encodeURIComponent).join(',');
  const url = `https://outlook.office.com/mail/deeplink/compose?${to ? `to=${to}&` : ''}subject=${subject}&body=${fits ? body : encodeURIComponent(PASTE_HINT)}`;
  return { url, bodyIncluded: fits };
}

/** Fenêtre de rédaction Gmail (compte Google connecté dans le navigateur). */
function gmailUrl(email) {
  const subject = encodeURIComponent(email.subject);
  const body = encodeURIComponent(stripMarkdown(email.body));
  const fits = subject.length + body.length <= 7000;
  const to = recipientsOf(email).map(encodeURIComponent).join(',');
  const url = `https://mail.google.com/mail/?view=cm&fs=1${to ? `&to=${to}` : ''}&su=${subject}&body=${fits ? body : encodeURIComponent(PASTE_HINT)}`;
  return { url, bodyIncluded: fits };
}

function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{76}(?=.)/g, '$&\r\n');
}

/**
 * Brouillon .eml (en-tête X-Unsent) : Outlook (Windows / Mac) l'ouvre comme un nouveau
 * message prêt à envoyer, avec la mise en forme et sans limite de longueur.
 */
function buildEml(email) {
  const boundary = `voxai-${Date.now().toString(36)}`;
  const html = `<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${markdownToHtml(email.body)}</body></html>`;
  return [
    'X-Unsent: 1',
    `To: ${recipientsOf(email).join(', ')}`,
    `Subject: =?UTF-8?B?${base64Utf8(email.subject).replace(/\r\n/g, '')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(stripMarkdown(email.body)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Utf8(html),
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

/** Nom de fichier en ASCII (accents et tirets typographiques mal gérés par certains navigateurs). */
function safeFileName(text, fallback = 'fichier') {
  const name = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-').replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return name || fallback;
}

// ==============================================================================
// Téléchargement de l'enregistrement audio (piste en cours de lecture)
// ==============================================================================

function updateDownloadAudioBtn() {
  const btn = document.getElementById('downloadAudioBtn');
  const rec = state.activeRecording;
  if (!btn || !rec) return;
  const files = rec.files || [];
  const multi = files.length > 1;
  btn.title = multi
    ? `Télécharger la piste ${state.activeFileIndex + 1} sur ${files.length} (choisissez une autre piste pour la télécharger)`
    : "Télécharger l'enregistrement audio";
  btn.querySelector('span').textContent = multi ? `Piste ${state.activeFileIndex + 1}` : 'Audio';
  btn.disabled = !files.length && !rec.filename;
}

async function downloadCurrentAudio() {
  const rec = state.activeRecording;
  if (!rec) return;
  const files = rec.files || [];
  const file = files[state.activeFileIndex] || files[0];
  const filename = file ? file.filename : rec.filename;
  const url = await VoxLocal.audioUrl(filename);
  if (!url) {
    showToast('Fichier audio introuvable dans ce navigateur', '⚠️');
    return;
  }
  const ext = (String(filename).match(/\.[a-z0-9]{2,5}$/i) || ['.webm'])[0];
  let name = safeFileName(rec.title, 'Enregistrement');
  if (files.length > 1) name += ` - piste ${state.activeFileIndex + 1} - ${safeFileName(String(file.original_name || '').replace(/\.[^.]+$/, ''), 'audio')}`;
  const a = document.createElement('a');
  a.href = url; // URL locale (blob) réutilisée par le lecteur : rien ne sort du navigateur
  a.download = `${name}${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast(`Téléchargement : ${a.download}`, '⬇️');
}

function downloadEml(email) {
  const blob = new Blob([buildEml(email)], { type: 'message/rfc822' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safeFileName(email.subject, 'Compte rendu')}.eml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  showToast('Brouillon téléchargé : ouvrez le fichier .eml, Outlook crée le message prêt à envoyer', '📨');
}

const MAIL_TARGETS = {
  desktop: { label: 'Outlook (application)', hint: 'Fichier brouillon .eml : mise en forme conservée, sans limite de longueur' },
  web: { label: 'Outlook Web (Microsoft 365)', hint: 'Ouvre un nouveau message dans Outlook sur le web' },
  gmail: { label: 'Gmail', hint: 'Ouvre un nouveau message dans Gmail (texte simple)' },
  mailto: { label: 'Messagerie par défaut', hint: 'Lien mailto vers la messagerie configurée sur l’ordinateur (texte simple)' }
};

/** Messageries proposées : Gmail (service externe) est retiré sous la politique « sans cloud ». */
function mailTargets() {
  if (!cloudDisabled()) return MAIL_TARGETS;
  const { gmail, ...rest } = MAIL_TARGETS; // eslint-disable-line no-unused-vars
  return rest;
}

function getMailTarget() {
  try { return mailTargets()[localStorage.getItem('voxai_mail_target')] ? localStorage.getItem('voxai_mail_target') : 'desktop'; }
  catch { return 'desktop'; }
}

function setMailTarget(target) {
  try { localStorage.setItem('voxai_mail_target', target); } catch { /* stockage indisponible */ }
}

/** Ouvre la messagerie par défaut (isolé pour les tests). */
function launchMailto(url) { window.location.href = url; }

async function openInMailClient(email, target = getMailTarget()) {
  if (target === 'desktop') return downloadEml(email);
  const { url, bodyIncluded } = target === 'web' ? outlookWebUrl(email) : target === 'gmail' ? gmailUrl(email) : mailtoUrl(email);
  if (!bodyIncluded) {
    // Copier AVANT d'ouvrir la messagerie : une fois la page passée en arrière-plan,
    // le navigateur refuse l'accès au presse-papiers et le message resterait vide.
    const copied = await copyRich(email.body, 'Corps de l’e-mail');
    showToast(copied
      ? 'E-mail long : le corps est copié, collez-le dans le message (Ctrl+V)'
      : 'E-mail trop long pour ce lien et copie impossible : utilisez « Copier l’e-mail » ou la messagerie « Outlook (application) »', copied ? '✉️' : '⚠️');
  }
  if (target === 'web' || target === 'gmail') window.open(url, '_blank', 'noopener');
  else launchMailto(url);
}

/** Bouton « Créer le mail » + menu pour choisir la messagerie (choix mémorisé). */
function buildMailButton(email) {
  const wrap = document.createElement('span');
  wrap.className = 'mail-split';
  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'chat-action-btn mail-main';
  const refresh = () => {
    const t = getMailTarget();
    main.textContent = `✉️ Créer le mail · ${MAIL_TARGETS[t].label}`;
    main.title = MAIL_TARGETS[t].hint;
  };
  refresh();
  main.addEventListener('click', () => openInMailClient(email));

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'chat-action-btn mail-toggle';
  toggle.textContent = '▾';
  toggle.title = 'Choisir la messagerie';
  toggle.setAttribute('aria-haspopup', 'menu');

  const menu = document.createElement('div');
  menu.className = 'mail-menu hidden';
  menu.setAttribute('role', 'menu');
  Object.entries(mailTargets()).forEach(([key, t]) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.dataset.target = key;
    item.innerHTML = `<strong>${escapeHtml(t.label)}</strong><span>${escapeHtml(t.hint)}</span>`;
    item.addEventListener('click', () => {
      setMailTarget(key);
      menu.classList.add('hidden');
      document.querySelectorAll('.mail-split').forEach(w => w._refresh && w._refresh());
      openInMailClient(email, key);
    });
    menu.appendChild(item);
  });
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.mail-menu').forEach(m => m !== menu && m.classList.add('hidden'));
    menu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) menu.classList.add('hidden'); });

  wrap._refresh = refresh;
  wrap.append(main, toggle, menu);
  return wrap;
}

function buildChatActions(content) {
  const bar = document.createElement('div');
  bar.className = 'chat-actions';
  const email = parseEmail(content);
  const add = (label, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chat-action-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
  };
  if (email) {
    add('📋 Copier l’e-mail', 'Copie le corps du message, prêt à coller (mise en forme conservée)', () => copyRich(email.body, 'E-mail'));
    add('🏷️ Copier l’objet', email.subject, () => navigator.clipboard.writeText(email.subject).then(() => showToast('Objet copié !', '📋')));
    bar.appendChild(buildMailButton(email));
  } else {
    add('📋 Copier', 'Copier la réponse', () => copyRich(content, 'Réponse'));
  }
  return bar;
}

// ==============================================================================
// Déclencheurs IA (Traitement & Chat)
// ==============================================================================

// ==============================================================================
// Avancement de l'analyse IA : étapes publiées par db.js (événement « voxai:progress »)
// ==============================================================================

/** « 45 s », « 2 min 05 s », « 1 h 02 min ». */
function formatElapsed(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}

/** Pourcentage et étape en cours d'une analyse. */
function progressSummary(p) {
  if (!p || !p.steps.length) return { percent: 2, current: null };
  const total = p.steps.length;
  const done = p.steps.filter(x => x.status === 'done').length;
  const current = p.steps.find(x => x.status === 'running') || null;
  const part = current && current.sub ? (current.sub.current - 1) / current.sub.total : 0;
  const percent = p.done && p.ok ? 100 : Math.min(99, Math.max(2, Math.round(((done + part) / total) * 100)));
  return { percent, current };
}

function renderAnalysisProgress() {
  const box = document.getElementById('analysisProgress');
  if (!box) return;
  const rec = state.activeRecording;
  const p = rec && window.VoxProgress && window.VoxProgress[rec.id];
  const running = rec && (rec.status === 'processing' || (p && !p.done));
  box.classList.toggle('hidden', !running);
  if (!running) { clearInterval(state.progressTimer); state.progressTimer = null; return; }
  if (!state.progressTimer) state.progressTimer = setInterval(renderAnalysisProgress, 1000);

  const { percent, current } = progressSummary(p);
  const bar = document.getElementById('analysisProgressBar');
  bar.style.width = `${percent}%`;
  bar.classList.toggle('is-running', !!current);
  box.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(percent));
  document.getElementById('analysisProgressTitle').textContent = `🧠 Analyse IA en cours · ${percent} %`;
  document.getElementById('analysisProgressTime').textContent = p ? formatElapsed(Date.now() - p.started) : '';
  elements.detailStatusBadge.textContent = `Analyse IA en cours… ${percent} %`;

  const icon = { done: '✓', running: '⏳', failed: '✗', pending: '○' };
  const steps = p ? p.steps : [{ id: 'prep', label: 'Préparation de l’analyse', status: 'running', t0: Date.now() }];
  document.getElementById('analysisProgressSteps').innerHTML = steps.map(x => {
    const time = x.status === 'done' ? formatElapsed(x.ms) + (x.detail ? ` · ${x.detail}` : '')
      : x.status === 'running' ? `depuis ${formatElapsed(Date.now() - x.t0)}` : '';
    return `<li class="analysis-step analysis-step-${x.status}" data-step="${escapeHtml(x.id)}">
      <span class="analysis-step-icon" aria-hidden="true">${icon[x.status] || '○'}</span>
      <span class="analysis-step-label">${escapeHtml(x.label)}</span>
      <span class="analysis-step-time">${escapeHtml(time)}</span>
    </li>`;
  }).join('');
}

/** Libellé court de l'avancement pour la liste des enregistrements. */
function listProgressLabel(recId) {
  const p = window.VoxProgress && window.VoxProgress[recId];
  if (!p || p.done) return 'Analyse...';
  const { percent, current } = progressSummary(p);
  const what = current ? (/^Transcription/.test(current.label) ? 'transcription' : /^Synthèse/.test(current.label) ? 'synthèse' : 'enregistrement') : '';
  return `${percent} %${what ? ` · ${what}` : ''}`;
}

document.addEventListener('voxai:progress', (e) => {
  const p = e.detail;
  if (state.activeRecording && state.activeRecording.id === p.recId) renderAnalysisProgress();
  // Liste dessinée avant le début de l'analyse : l'enregistrement y passe « en cours »
  const r = (state.recordings || []).find(x => x.id === p.recId);
  if (r && !p.done && r.status !== 'processing') { r.status = 'processing'; renderRecordingsList(); }
  const badge = document.querySelector(`#recordingsList [data-progress="${CSS.escape(p.recId)}"]`);
  if (badge) badge.textContent = `⏳ ${listProgressLabel(p.recId)}`;
});

async function triggerAIProcessing(recId) {
  showToast('Analyse de l’audio en cours par l’IA...', '🧠');
  if (window.VoxProgress) delete window.VoxProgress[recId]; // avancement d'une analyse précédente
  if (state.activeRecording && state.activeRecording.id === recId) {
    state.activeRecording.status = 'processing';
    renderRecordingDetails();
  }

  try {
    const res = await fetch(`/api/recordings/${recId}/process`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Analyse IA terminée${data.duration_ms ? ` en ${formatElapsed(data.duration_ms)}` : ''} !`, '🎉');
      await selectRecording(recId);
      await loadRecordings();
    } else if (data.offline) {
      showToast('Hors ligne : enregistrement conservé, l’analyse se lancera quand vous le déciderez au retour du réseau.', '📴');
      await selectRecording(recId);
      await loadRecordings();
    } else {
      showToast('Erreur IA: ' + data.error, '⚠️');
      await selectRecording(recId);
    }
  } catch (err) {
    showToast('Erreur IA: ' + err.message, '⚠️');
    await selectRecording(recId);
  }
}

async function sendChatMessage(e) {
  if (e) e.preventDefault();
  const msg = elements.chatInput.value.trim();
  if (!msg || !state.activeRecording) return;

  elements.chatInput.value = '';
  appendChatMessage('user', msg);

  // Placeholder animation
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'chatLoading';
  loadingDiv.className = 'p-3 rounded-xl text-xs mr-auto bg-slate-800/70 text-slate-400 border border-slate-700/60 animate-pulse';
  loadingDiv.textContent = "L'IA réfléchit...";
  elements.chatMessages.appendChild(loadingDiv);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

  try {
    const res = await fetch(`/api/recordings/${state.activeRecording.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    const loader = document.getElementById('chatLoading');
    if (loader) loader.remove();

    if (data.reply) {
      appendChatMessage('assistant', data.reply);
    } else {
      appendChatMessage('assistant', 'Erreur: ' + (data.error || 'Pas de réponse'));
    }
  } catch (err) {
    const loader = document.getElementById('chatLoading');
    if (loader) loader.remove();
    appendChatMessage('assistant', 'Erreur de communication : ' + err.message);
  }
}

// ==============================================================================
// Lecteur Audio Intégré
// ==============================================================================

function setupAudioPlayer() {
  const audio = elements.audioElement;

  elements.playerPlayBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });

  audio.addEventListener('play', () => {
    elements.playerPlayIcon.classList.add('hidden');
    elements.playerPauseIcon.classList.remove('hidden');
  });

  audio.addEventListener('pause', () => {
    elements.playerPlayIcon.classList.remove('hidden');
    elements.playerPauseIcon.classList.add('hidden');
  });

  if (elements.playerRewindBtn) {
    elements.playerRewindBtn.addEventListener('click', () => {
      audio.currentTime = Math.max(0, audio.currentTime - 10);
    });
  }

  if (elements.playerForwardBtn) {
    elements.playerForwardBtn.addEventListener('click', () => {
      if (audio.duration) {
        audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
      }
    });
  }

  audio.addEventListener('timeupdate', () => {
    elements.playerCurrentTime.textContent = formatDuration(Math.floor(audio.currentTime));
    if (audio.duration) {
      elements.playerSeek.value = (audio.currentTime / audio.duration) * 100;
      elements.playerTotalTime.textContent = formatDuration(Math.floor(audio.duration));
    }
  });

  elements.playerSeek.addEventListener('input', (e) => {
    if (audio.duration) {
      audio.currentTime = (e.target.value / 100) * audio.duration;
    }
  });

  elements.playerSpeed.addEventListener('change', (e) => {
    audio.playbackRate = parseFloat(e.target.value);
  });
}

// ==============================================================================
// Gestion des Onglets
// ==============================================================================

function switchTab(tabName) {
  state.activeTab = tabName;

  const tabs = [
    { name: 'summary', btn: elements.tabSummaryBtn, content: elements.tabContentSummary },
    { name: 'transcript', btn: elements.tabTranscriptBtn, content: elements.tabContentTranscript },
    { name: 'chat', btn: elements.tabChatBtn, content: elements.tabContentChat }
  ];

  tabs.forEach(t => {
    if (t.name === tabName) {
      t.btn.classList.add('active', 'border-indigo-500', 'text-indigo-400');
      t.btn.classList.remove('border-transparent', 'text-slate-400');
      t.content.classList.remove('hidden');
    } else {
      t.btn.classList.remove('active', 'border-indigo-500', 'text-indigo-400');
      t.btn.classList.add('border-transparent', 'text-slate-400');
      t.content.classList.add('hidden');
    }
  });
}

// ==============================================================================
// Exports & Actions
// ==============================================================================

function buildSummaryMarkdown(rec) {
  let md = `# ${rec.title}\n`;
  md += `*Date : ${rec.created_at} | Durée totale : ${formatDuration(rec.duration || 0)}*\n`;
  if (rec.files && rec.files.length > 1) {
    md += `*Fichiers audio (${rec.files.length}) : ${rec.files.map((f, i) => `Piste ${i + 1}: ${f.original_name}`).join(' • ')}*\n`;
  }
  md += `\n`;

  if (rec.summary) {
    const s = rec.summary;
    md += `## 📌 Résumé Exécutif Consolidé\n${s.executive || ''}\n\n`;
    
    if (s.decisions && s.decisions.length) {
      md += `## 🎯 Décisions Clés\n`;
      s.decisions.forEach(d => md += `- ${itemText(d)}\n`);
      md += `\n`;
    }

    if (s.action_items && s.action_items.length) {
      md += `## ✅ Plan d'Action\n`;
      s.action_items.forEach(a => md += `- [${a.status === 'done' ? 'x' : ' '}] **${a.task}** (Assigné : ${a.assignee || 'Tous'}, Échéance : ${deadlineInfo(a.deadline).long || 'N/A'})\n`);
      md += `\n`;
    }

    if (s.action_followup && s.action_followup.length) {
      md += `## 🔁 Suivi des actions précédentes\n`;
      s.action_followup.forEach(f => md += `- ${f.status === 'done' ? '✅ Terminée' : '🔄 En cours'} — **${f.task}**${f.assignee ? ` (${f.assignee})` : ''}${f.note ? ` : ${f.note}` : ''}\n`);
      md += `\n`;
    }

    if (s.key_points && s.key_points.length) {
      md += `## 💡 Points Clés\n`;
      s.key_points.forEach(k => md += `- ${itemText(k)}\n`);
      md += `\n`;
    }

    if (s.tags && s.tags.length) {
      md += s.tags.map(t => `#${t}`).join(' ') + `\n\n`;
    }
  }
  return md;
}

function copySummaryOnly() {
  const rec = state.activeRecording;
  if (!rec || !rec.summary) {
    showToast('Aucun résumé à copier pour cet enregistrement.', '⚠️');
    return;
  }
  navigator.clipboard.writeText(buildSummaryMarkdown(rec).trim() + '\n').then(() => {
    showToast('Résumé copié !', '📋');
  });
}

function exportAsMarkdown() {
  const rec = state.activeRecording;
  if (!rec) return;

  let md = buildSummaryMarkdown(rec);

  if (rec.transcription && rec.transcription.length) {
    md += `## 📝 Transcription Intégrale\n\n`;
    rec.transcription.forEach(t => {
      const trackPrefix = (rec.files && rec.files.length > 1) ? `[Piste ${t.file_index || 1} • ${t.timestamp}]` : `[${t.timestamp}]`;
      md += `**${trackPrefix} ${t.speaker}** : ${t.text}\n\n`;
    });
  }

  navigator.clipboard.writeText(md).then(() => {
    showToast('Synthèse complète copiée dans le presse-papier !', '📋');
  });
}

// ==============================================================================
// Apparence : automatique (selon le système), clair ou sombre
// ==============================================================================

const THEMES = {
  auto: { icon: '🌓', label: 'Auto', title: 'Apparence : automatique (suit le réglage du système). Cliquer pour passer en clair.' },
  light: { icon: '☀️', label: 'Clair', title: 'Apparence : fond clair. Cliquer pour passer en sombre.' },
  dark: { icon: '🌙', label: 'Sombre', title: 'Apparence : fond sombre. Cliquer pour revenir en automatique.' }
};

function setupThemeToggle() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn || !window.VoxTheme) return;
  const order = ['auto', 'light', 'dark'];
  const refresh = () => {
    const t = THEMES[VoxTheme.get()] || THEMES.auto;
    document.getElementById('themeIcon').textContent = t.icon;
    document.getElementById('themeLabel').textContent = t.label;
    btn.title = t.title;
    btn.setAttribute('aria-label', t.title);
    if (!state.isRecording) drawIdleWaveform();
  };
  btn.addEventListener('click', () => {
    const next = order[(order.indexOf(VoxTheme.get()) + 1) % order.length];
    VoxTheme.set(next);
    showToast(`Apparence : ${THEMES[next].label.toLowerCase()}`, THEMES[next].icon);
  });
  document.addEventListener('voxai:theme', refresh);
  refresh();
}

// ==============================================================================
// Sauvegarde et restauration (toutes les données restent dans ce navigateur)
// ==============================================================================

async function refreshBackupInfo() {
  const el = document.getElementById('backupInfo');
  if (!el) return;
  const count = (state.recordings || []).length;
  let usage = '';
  try {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (est && est.usage != null) usage = ` · ${formatBytes(est.usage)} utilisés dans ce navigateur`;
  } catch { /* indisponible */ }
  el.textContent = `${count} enregistrement${count > 1 ? 's' : ''}${usage}`;
}

// ----------------------------------------------------------------------------
// Hors ligne : le dictaphone fonctionne toujours ; les enregistrements dont l'analyse
// n'a pas pu partir sont « en attente », et l'utilisateur lance l'analyse au retour du réseau.
// ----------------------------------------------------------------------------
function pendingRecordings() {
  return (state.recordings || []).filter(r => r.status === 'pending');
}

function refreshPendingBanner() {
  const box = document.getElementById('pendingBanner');
  if (!box) return;
  const list = pendingRecordings();
  box.classList.toggle('hidden', list.length === 0);
  if (!list.length) return;
  const online = navigator.onLine !== false;
  const n = list.length;
  document.getElementById('pendingTitle').textContent = `${online ? '📶' : '📴'} ${n} enregistrement${n > 1 ? 's' : ''} en attente d'analyse`;
  document.getElementById('pendingText').textContent = online
    ? 'Enregistrés hors ligne. Lancez l’analyse maintenant que le réseau est disponible.'
    : 'Ils sont conservés sur cet appareil et seront analysés au retour du réseau.';
  const btn = document.getElementById('pendingRunBtn');
  btn.disabled = !online || state.pendingRunning;
  btn.textContent = state.pendingRunning ? '⏳ Analyse en cours…' : `🧠 Analyser ${n > 1 ? `les ${n}` : ''} maintenant`.replace('  ', ' ');
}

/** Analyse les enregistrements en attente, un par un ; s'arrête si le réseau retombe. */
async function runPendingAnalyses() {
  const list = pendingRecordings();
  if (!list.length || state.pendingRunning) return;
  state.pendingRunning = true;
  refreshPendingBanner();
  let done = 0;
  try {
    for (const rec of list) {
      showToast(`Analyse ${done + 1}/${list.length} : « ${rec.title} »…`, '🧠');
      const res = await fetch(`/api/recordings/${rec.id}/process`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.offline) { showToast('Réseau de nouveau indisponible : analyses restantes en attente.', '📴'); break; }
      if (data.success) done++;
      else showToast(`« ${rec.title} » : ${data.error || 'erreur'}`, '⚠️');
    }
    if (done) showToast(`${done} enregistrement${done > 1 ? 's' : ''} analysé${done > 1 ? 's' : ''} !`, '🎉');
  } finally {
    state.pendingRunning = false;
    await loadRecordings();
    if (state.activeRecording && list.some(r => r.id === state.activeRecording.id)) await selectRecording(state.activeRecording.id);
  }
}

function updateConnectivity() {
  const offline = navigator.onLine === false;
  const badge = document.getElementById('offlineBadge');
  if (badge) { badge.classList.toggle('hidden', !offline); badge.classList.toggle('flex', offline); }
  refreshPendingBanner();
}

function setupOffline() {
  window.addEventListener('offline', () => {
    updateConnectivity();
    showToast('Hors ligne : le dictaphone fonctionne, l’analyse IA attendra le retour du réseau.', '📴');
  });
  window.addEventListener('online', () => {
    updateConnectivity();
    const n = pendingRecordings().length;
    showToast(n ? `Réseau rétabli : ${n} enregistrement${n > 1 ? 's' : ''} à analyser.` : 'Réseau rétabli.', '📶');
  });
  document.getElementById('pendingRunBtn').addEventListener('click', runPendingAnalyses);
  updateConnectivity();
}

/** Application installable et disponible hors ligne (service worker sw.js). */
function setupPwa() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // Nouvelle version installée alors qu'une autre était active : jamais de rechargement
        // automatique (un enregistrement peut être en cours)
        if (sw.state === 'activated' && state.swWasControlled) {
          showToast('VoxAI a été mis à jour : rechargez la page quand vous le souhaitez.', '✨');
        }
      });
    });
  }).catch(err => console.warn('[PWA] service worker non enregistré :', err));
  state.swWasControlled = !!navigator.serviceWorker.controller;

  const installBtn = document.getElementById('installAppBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installPrompt = e;
    installBtn.classList.remove('hidden');
  });
  installBtn.addEventListener('click', async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => null);
    state.installPrompt = null;
    installBtn.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    installBtn.classList.add('hidden');
    showToast('VoxAI est installé : il s’ouvre aussi sans réseau.', '📲');
  });
}

// ----------------------------------------------------------------------------
// Rappel de sauvegarde : toutes les données (réunions, séries, suivi des actions)
// ne vivent que dans ce navigateur. Rappel après 7 jours sans sauvegarde .voxai.
// ----------------------------------------------------------------------------
const BACKUP_KEY = 'voxai_last_backup';
const BACKUP_SNOOZE_KEY = 'voxai_backup_snooze';
const BACKUP_EVERY_DAYS = 7;
const BACKUP_SNOOZE_DAYS = 3;
const DAY_MS = 86400000;
function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } }

function checkBackupReminder() {
  const box = document.getElementById('backupReminder');
  if (!box) return;
  const recs = state.recordings || [];
  const now = Date.now();
  const last = Date.parse(lsGet(BACKUP_KEY));
  const snoozed = Date.parse(lsGet(BACKUP_SNOOZE_KEY));
  // Sans sauvegarde : on compte depuis le plus ancien enregistrement
  const oldest = recs.reduce((min, r) => Math.min(min, Date.parse(r.created_at) || now), now);
  const since = isNaN(last) ? oldest : last;
  const days = Math.floor((now - since) / DAY_MS);
  const show = recs.length > 0 && days >= BACKUP_EVERY_DAYS && !(snoozed > now);
  box.classList.toggle('hidden', !show);
  if (!show) return;
  document.getElementById('backupReminderText').textContent = isNaN(last)
    ? `Aucune sauvegarde : vos ${recs.length} enregistrement(s), séries et actions n'existent que dans ce navigateur. Un fichier .voxai les protège si le navigateur est vidé ou si vous changez de poste.`
    : `Dernière sauvegarde il y a ${days} jours. Un fichier .voxai protège vos réunions, séries et actions si le navigateur est vidé ou si vous changez de poste.`;
}

function setupBackup() {
  const exportBtn = document.getElementById('backupExportBtn');
  const importInput = document.getElementById('backupImportInput');
  if (!exportBtn || !importInput) return;

  document.getElementById('backupReminderSave').addEventListener('click', () => exportBtn.click());
  document.getElementById('backupReminderLater').addEventListener('click', () => {
    lsSet(BACKUP_SNOOZE_KEY, new Date(Date.now() + BACKUP_SNOOZE_DAYS * DAY_MS).toISOString());
    checkBackupReminder();
  });

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      const { blob, recordings } = await VoxLocal.exportBackup();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `voxai-sauvegarde-${new Date().toISOString().slice(0, 10)}.voxai`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      showToast(`Sauvegarde créée : ${recordings} enregistrement${recordings > 1 ? 's' : ''} (${formatBytes(blob.size)})`, '💾');
      lsSet(BACKUP_KEY, new Date().toISOString());
      checkBackupReminder();
    } catch (err) {
      showToast('Erreur de sauvegarde : ' + err.message, '⚠️');
    } finally {
      exportBtn.disabled = false;
    }
  });

  importInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { imported, skipped } = await VoxLocal.importBackup(file);
      await loadRecordings();
      refreshBackupInfo();
      showToast(`${imported} enregistrement${imported > 1 ? 's' : ''} restauré${imported > 1 ? 's' : ''}` +
        (skipped ? ` (${skipped} déjà présent${skipped > 1 ? 's' : ''}, ignoré${skipped > 1 ? 's' : ''})` : ''), '✅');
    } catch (err) {
      showToast('Restauration impossible : ' + err.message, '⚠️');
    }
  });
}

function copyTranscriptOnly() {
  const rec = state.activeRecording;
  if (!rec || !rec.transcription) return;

  const text = rec.transcription.map(t => `[${t.timestamp}] ${t.speaker}: ${t.text}`).join('\n\n');
  navigator.clipboard.writeText(text).then(() => {
    showToast('Transcription copiée !', '📋');
  });
}

async function deleteRecording() {
  const rec = state.activeRecording;
  if (!rec) return;

  if (!confirm(`Supprimer définitivement l'enregistrement "${rec.title}" ?`)) return;

  try {
    const res = await fetch(`/api/recordings/${rec.id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Enregistrement supprimé', '🗑️');
      state.activeRecording = null;
      elements.detailsView.classList.add('hidden');
      elements.recorderView.classList.remove('hidden');
      await loadRecordings();
    }
  } catch (err) {
    showToast('Erreur suppression: ' + err.message, '⚠️');
  }
}

// ==============================================================================
// Event Listeners
// ==============================================================================

function setupEventListeners() {
  // Dictaphone Mic Button
  elements.mainRecordBtn.addEventListener('click', () => {
    if (!state.isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  elements.pauseRecordBtn.addEventListener('click', pauseRecording);
  document.querySelectorAll('input[name="captureSource"]').forEach(r => r.addEventListener('change', () => {
    try { localStorage.setItem(CAPTURE_KEY, r.value); } catch { /* stockage indisponible */ }
    refreshCaptureUI();
  }));
  refreshCaptureUI();
  elements.cancelRecordBtn.addEventListener('click', cancelRecording);

  // New Recording & Switch back to Recorder
  elements.newRecordBtn.addEventListener('click', () => {
    state.activeRecording = null;
    elements.detailsView.classList.add('hidden');
    elements.recorderView.classList.remove('hidden');
    renderRecordingsList();
  });

  // Search input
  elements.searchRecordings.addEventListener('input', renderRecordingsList);

  // File Upload (Single or Multiple)
  elements.fileUploadInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    e.target.value = '';

    if (files.length === 1) {
      const file = files[0];
      const title = (window.VoxSeries && VoxSeries.defaultTitle()) || file.name.replace(/\.[^/.]+$/, '');
      await uploadAndProcessAudio(file, title, 0, file.type || 'audio/webm');
    } else {
      await uploadBatchFilesAndProcess(files);
    }
  });

  // Add Audio File to existing Session
  if (elements.addFileInput) {
    elements.addFileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length || !state.activeRecording) return;
      e.target.value = '';

      const recId = state.activeRecording.id;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        showToast(`Ajout de "${file.name}" (${i + 1}/${files.length})...`, '📤');
        await fetch(`/api/recordings/${recId}/files`, {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'audio/webm',
            'X-Original-Filename': encodeURIComponent(file.name),
            'X-Audio-Duration': '0'
          },
          body: file
        });
      }

      showToast(`${files.length} audio(s) ajouté(s). Cliquez sur "Relancer IA" pour réanalyser l'ensemble !`, '✅');
      await selectRecording(recId);
      await loadRecordings();
    });
  }

  // Details Actions
  elements.reprocessBtn.addEventListener('click', () => {
    if (state.activeRecording) triggerAIProcessing(state.activeRecording.id);
  });
  elements.exportMarkdownBtn.addEventListener('click', exportAsMarkdown);
  elements.copyTranscriptBtn.addEventListener('click', copyTranscriptOnly);
  document.getElementById('downloadAudioBtn').addEventListener('click', downloadCurrentAudio);

  // Actions du plan cochées : enregistrées dans la base locale
  elements.summaryActions.addEventListener('change', async (e) => {
    const box = e.target.closest('.action-check');
    const rec = state.activeRecording;
    if (!box || !rec || !rec.summary) return;
    const index = Number(box.dataset.index);
    const res = await fetch(`/api/recordings/${rec.id}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index, done: box.checked })
    });
    if (res.ok) rec.summary.action_items[index].status = box.checked ? 'done' : 'todo';
    else { box.checked = !box.checked; showToast("Impossible d'enregistrer l'action", '⚠️'); }
  });

  // Recherche dans la transcription
  const search = document.getElementById('searchTranscript');
  if (search) search.addEventListener('input', applyTranscriptSearch);

  // Sauvegarde / restauration des données
  setupBackup();
  setupThemeToggle();
  elements.copySummaryBtn.addEventListener('click', copySummaryOnly);
  elements.tabContentSummary.addEventListener('click', (e) => {
    const chip = e.target.closest('.ref-chip');
    if (!chip) return;
    e.preventDefault();
    e.stopPropagation();
    goToSegment(parseInt(chip.dataset.seg, 10));
  });
  elements.deleteRecordBtn.addEventListener('click', deleteRecording);

  // Tabs
  elements.tabSummaryBtn.addEventListener('click', () => switchTab('summary'));
  elements.tabTranscriptBtn.addEventListener('click', () => switchTab('transcript'));
  elements.tabChatBtn.addEventListener('click', () => switchTab('chat'));

  // Chat
  elements.chatForm.addEventListener('submit', sendChatMessage);
  document.querySelectorAll('.chat-prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.prefill) { elements.chatInput.value = chip.dataset.prefill; elements.chatInput.focus(); return; }
      elements.chatInput.value = chip.textContent.trim();
      sendChatMessage();
    });
  });
  setupAssistant();

  // Settings
  elements.openSettingsBtn.addEventListener('click', openSettingsModal);
  elements.providerBadgeBtn.addEventListener('click', openSettingsModal);
  elements.closeSettingsBtn.addEventListener('click', closeSettingsModal);
  elements.cancelSettingsBtn.addEventListener('click', closeSettingsModal);
  elements.saveSettingsBtn.addEventListener('click', saveSettings);

  // Fermeture en cliquant sur l'arrière-plan sombre du modal
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      closeSettingsModal();
    }
  });

  elements.selectGeminiProvider.addEventListener('click', () => {
    state.modalProvider = 'gemini';
    updateModalProviderUI();
  });
  elements.selectOnPremProvider.addEventListener('click', () => {
    state.modalProvider = 'on_prem';
    updateModalProviderUI();
  });

  elements.toggleApiKeyVisibility.addEventListener('click', () => {
    const input = elements.geminiApiKeyInput;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Local LLM Controls
  if (elements.detectLocalModelsBtn) {
    elements.detectLocalModelsBtn.addEventListener('click', detectLocalModels);
  }

  // Preset Buttons (Ollama, LM Studio, vLLM, etc.)
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      const model = btn.dataset.model;
      if (url) elements.onPremLlmUrl.value = url;
      if (model && model !== 'default' && model !== 'local-model') {
        elements.onPremLlmModel.value = model;
        if (elements.localModelSelect && [...elements.localModelSelect.options].some(o => o.value === model)) {
          elements.localModelSelect.value = model;
        }
      }
      if (btn.dataset.preset === 'enterprise') {
        elements.onPremLlmUrl.focus();
        elements.onPremLlmUrl.select();
        showToast("Renseignez l'URL du serveur IA de l'entreprise et votre clé d'API", '🏢');
      }
      if (url) detectLocalModels();
    });
  });

  // Local Model Select Dropdown Sync
  if (elements.localModelSelect) {
    elements.localModelSelect.addEventListener('change', (e) => {
      if (e.target.value === '__custom__') {
        elements.onPremLlmModel.focus();
        elements.onPremLlmModel.select();
      } else {
        elements.onPremLlmModel.value = e.target.value;
      }
    });
  }

  // STT Mode Toggle (Cloud vs Local Whisper)
  // Bilan de confidentialité recalculé à chaque changement de réglage
  document.getElementById('settingsModal').addEventListener('input', refreshSettingsDataFlows);
  document.getElementById('settingsModal').addEventListener('change', refreshSettingsDataFlows);

  document.querySelectorAll('input[name="local_stt_mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (elements.whisperLocalConfigContainer) {
        if (radio.value === 'local') {
          elements.whisperLocalConfigContainer.classList.remove('hidden');
        } else {
          elements.whisperLocalConfigContainer.classList.add('hidden');
        }
      }
    });
  });

  elements.testConnBtn.addEventListener('click', testConnection);

  // Drag and Drop Fullscreen Overlay
  if (elements.dragDropOverlay) {
    let dragCounter = 0;

    const hideOverlay = () => {
      dragCounter = 0;
      elements.dragDropOverlay.classList.remove('is-active');
      elements.dragDropOverlay.style.display = 'none';
    };

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      elements.dragDropOverlay.style.display = 'flex';
      elements.dragDropOverlay.classList.add('is-active');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        hideOverlay();
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      hideOverlay();

      const files = Array.from(e.dataTransfer.files).filter(f => {
        return f.type.startsWith('audio/') || /\.(mp3|wav|m4a|webm|ogg|aac|flac)$/i.test(f.name);
      });

      if (!files.length) {
        showToast('Veuillez déposer des fichiers audio valides (MP3, WAV, M4A, WebM...)', '⚠️');
        return;
      }

      if (files.length === 1) {
        const file = files[0];
        const title = file.name.replace(/\.[^/.]+$/, '');
        await uploadAndProcessAudio(file, title, 0, file.type || 'audio/webm');
      } else {
        await uploadBatchFilesAndProcess(files);
      }
    });

    // Clic pour fermer l'overlay
    elements.dragDropOverlay.addEventListener('click', hideOverlay);

    // Touche Escape pour fermer
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideOverlay();
        closeSettingsModal();
      }
    });
  }

  setupAudioPlayer();
  window.addEventListener('resize', initCanvas);
}

// ==============================================================================
// Utilitaires
// ==============================================================================

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function parseTimestamp(ts) {
  const parts = ts.split(':');
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  if (parts.length === 3) return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
  return 0;
}

function formatSimpleDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  if (str == null || str === '') return '';
  if (typeof str === 'object') str = ''; // jamais d'objet inattendu dans le HTML
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

let toastTimer = null;
function showToast(message, icon = '🔔') {
  elements.toastIcon.textContent = icon;
  elements.toastMessage.textContent = message;
  elements.toast.classList.add('toast-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove('toast-visible');
  }, 3500);
}

// ============================================================================
// Nouveautés : historique des versions (contenu statique dans index.html)
// ============================================================================
function setupVersions() {
  const modal = document.getElementById('versionsModal');
  const btn = document.getElementById('versionsBtn');
  if (!modal || !btn) return;
  const show = (open) => {
    modal.classList.toggle('hidden', !open);
    modal.style.display = open ? 'flex' : 'none';
    if (open) document.getElementById('versionsCloseBtn').focus();
    else btn.focus();
  };
  btn.addEventListener('click', () => show(true));
  document.getElementById('versionsCloseBtn').addEventListener('click', () => show(false));
  modal.addEventListener('click', (e) => { if (e.target === modal) show(false); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) show(false);
  });
}

// Start
document.addEventListener('DOMContentLoaded', init);
document.addEventListener('DOMContentLoaded', setupVersions);
