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
  await loadRecordings();
  setupEventListeners();
  initCanvas();

  // Si pas de clé d'API Gemini et provider Gemini, ouvrir les réglages pour guider l'utilisateur
  if (state.config.provider === 'gemini' && !state.config.gemini_api_key) {
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
    elements.providerDot.className = 'w-2 h-2 rounded-full bg-purple-400 animate-pulse';
    const model = state.config.local_llm_model || state.config.on_prem_llm_model || 'Local';
    elements.providerName.textContent = `LLM Local (${model})`;
  }
}

function openSettingsModal() {
  if (!state.config) return;
  state.modalProvider = (state.config.provider === 'local' || state.config.provider === 'on_prem') ? 'on_prem' : 'gemini';
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
  const sttMode = state.config.local_stt_mode || 'cloud';
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

async function testConnection() {
  elements.testConnStatus.textContent = 'Test en cours...';
  elements.testConnStatus.className = 'text-xs text-amber-400 truncate max-w-[280px] animate-pulse';

  const selectedSttRadio = document.querySelector('input[name="local_stt_mode"]:checked');
  const localSttMode = selectedSttRadio ? selectedSttRadio.value : 'cloud';

  const payload = {
    provider: state.modalProvider === 'on_prem' ? 'local' : 'gemini',
    gemini_api_key: elements.geminiApiKeyInput.value.trim(),
    gemini_model: elements.geminiModelSelect.value,
    local_llm_url: elements.onPremLlmUrl.value.trim(),
    local_llm_model: elements.onPremLlmModel.value.trim(),
    local_stt_mode: localSttMode,
    on_prem_llm_url: elements.onPremLlmUrl.value.trim(),
    on_prem_llm_model: elements.onPremLlmModel.value.trim(),
    on_prem_stt_url: elements.onPremSttUrl.value.trim(),
    on_prem_stt_model: elements.onPremSttModel.value.trim() || 'whisper-1',
    on_prem_stt_api_key: elements.onPremSttApiKey.value.trim(),
    local_llm_api_key: elements.localLlmApiKey.value.trim()
  };

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
  const selectedSttRadio = document.querySelector('input[name="local_stt_mode"]:checked');
  const localSttMode = selectedSttRadio ? selectedSttRadio.value : 'cloud';
  const localLlmModel = elements.onPremLlmModel.value.trim() || 'llama3.2';
  const localLlmUrl = elements.onPremLlmUrl.value.trim() || 'http://localhost:11434/v1';

  const payload = {
    provider: state.modalProvider === 'on_prem' ? 'local' : 'gemini',
    gemini_api_key: elements.geminiApiKeyInput.value.trim(),
    gemini_model: elements.geminiModelSelect.value,
    local_llm_url: localLlmUrl,
    local_llm_model: localLlmModel,
    local_stt_mode: localSttMode,
    on_prem_llm_url: localLlmUrl,
    on_prem_llm_model: localLlmModel,
    on_prem_stt_url: elements.onPremSttUrl.value.trim(),
    on_prem_stt_model: elements.onPremSttModel.value.trim() || 'whisper-1',
    on_prem_stt_api_key: elements.onPremSttApiKey.value.trim(),
    local_llm_api_key: elements.localLlmApiKey.value.trim(),
    ...(window.VoxConfluence ? VoxConfluence.readSettings() : {})
  };

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
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

async function startRecording() {
  try {
    state.audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Web Audio Setup for Waveform
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.audioContext.createMediaStreamSource(state.audioStream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    source.connect(state.analyser);

    // MediaRecorder Setup
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else mimeType = ''; // par défaut du navigateur
    }

    state.mediaRecorder = mimeType ? new MediaRecorder(state.audioStream, { mimeType }) : new MediaRecorder(state.audioStream);
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
    elements.recordStatusText.textContent = 'Enregistrement en cours... Cliquez pour terminer et analyser';
    elements.recordStatusText.className = 'text-xs text-rose-400 font-medium animate-pulse';

    // Start Timer
    state.recordTimerInterval = setInterval(() => {
      if (!state.isPaused) {
        state.recordElapsedSec++;
        elements.recordTimer.textContent = formatDuration(state.recordElapsedSec);
      }
    }, 1000);

    // Start Waveform render loop
    visualizeWaveform();

    // Transcription en direct (brouillon) si activée
    if (window.VoxLive) VoxLive.start();

  } catch (err) {
    console.error('Erreur accès micro:', err);
    showToast("Impossible d'accéder au microphone : " + err.message, '⚠️');
  }
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
  const customTitle = elements.recordTitleInput.value.trim() || 'Conversation du ' + new Date().toLocaleDateString('fr-FR');

  const liveText = state.liveText || '';
  state.liveText = '';
  resetRecorderUI();
  if (window.VoxLive) VoxLive.reset();
  elements.recordTitleInput.value = '';

  await uploadAndProcessAudio(audioBlob, customTitle, duration, mimeType, liveText);
}

async function uploadAndProcessAudio(blob, title, duration, mimeType, liveText = '') {
  showToast('Enregistrement de l’audio en local...', '⏳');

  try {
    const uploadRes = await fetch('/api/recordings/upload', {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'X-Audio-Duration': duration.toString(),
        'X-Audio-Title': encodeURIComponent(title)
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
  const defaultTitle = `Session groupée (${files.length} enregistrements)`;
  const title = prompt("Titre pour cette analyse conjointe :", defaultTitle) || defaultTitle;

  showToast(`Création de la session pour ${files.length} fichiers...`, '⏳');

  try {
    // 1. Créer la session
    const createRes = await fetch('/api/recordings/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
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
  } catch (err) {
    console.error('Erreur chargement recordings:', err);
  }
}

function renderRecordingsList() {
  const query = elements.searchRecordings.value.toLowerCase().trim();
  const list = elements.recordingsList;
  list.innerHTML = '';

  const filtered = state.recordings.filter(r => {
    return r.title.toLowerCase().includes(query);
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
      statusBadge = '<span class="text-[10px] text-amber-400 animate-pulse">⏳ Analyse...</span>';
    } else if (rec.status === 'error') {
      statusBadge = '<span class="text-[10px] text-red-400">✗ Erreur</span>';
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

  // Render Tabs
  renderSummaryTab(rec.summary);
  renderTranscriptTab(rec.transcription);
  renderChatTab(rec.chat_history || []);
}

function renderSummaryTab(summary) {
  if (!summary || typeof summary !== 'object') {
    elements.summaryExecutive.textContent = "Cet enregistrement n'a pas encore été analysé par l'IA. Cliquez sur 'Relancer IA' ci-dessus.";
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
        <input type="checkbox" class="action-check mt-0.5 accent-indigo-500 rounded">
        <div class="flex-1">
          <span class="text-slate-200 block">${escapeHtml(a.task)}${refChips(a.refs)}</span>
          <div class="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
            <span class="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">👤 ${escapeHtml(a.assignee || 'Tous')}</span>
            ${a.deadline ? `<span class="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">📅 ${escapeHtml(a.deadline)}</span>` : ''}
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
  showToast(`« ${oldName} » renommé en « ${newName} »`, '✏️');
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
    const timestamp = seg.timestamp || '00:00';
    const text = escapeHtml(seg.text || '');
    const fileIdx = seg.file_index || 1;
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
        <p class="text-xs text-slate-200 leading-relaxed">${text}</p>
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

function appendChatMessage(role, content) {
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
    // Markdown simple (gras, listes) ; le texte est échappé avant mise en forme
    div.innerHTML = `<div class="chat-md">${markdownToHtml(content)}</div>`;
    div.appendChild(buildChatActions(content));
  }
  elements.chatMessages.appendChild(div);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
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
  } catch (err) {
    showToast('Copie impossible : ' + err.message, '⚠️');
  }
}

/** Lien mailto ; les liens trop longs étant tronqués par certaines messageries, le corps est alors omis. */
function mailtoUrl(email) {
  const subject = encodeURIComponent(email.subject);
  const body = encodeURIComponent(stripMarkdown(email.body));
  const fits = subject.length + body.length <= 1800;
  return { url: fits ? `mailto:?subject=${subject}&body=${body}` : `mailto:?subject=${subject}`, bodyIncluded: fits };
}

/** Lien de rédaction Outlook sur le web (Microsoft 365). */
function outlookWebUrl(email) {
  const subject = encodeURIComponent(email.subject);
  const body = encodeURIComponent(stripMarkdown(email.body));
  const fits = subject.length + body.length <= 7000;
  const url = `https://outlook.office.com/mail/deeplink/compose?subject=${subject}${fits ? `&body=${body}` : ''}`;
  return { url, bodyIncluded: fits };
}

/** Fenêtre de rédaction Gmail (compte Google connecté dans le navigateur). */
function gmailUrl(email) {
  const subject = encodeURIComponent(email.subject);
  const body = encodeURIComponent(stripMarkdown(email.body));
  const fits = subject.length + body.length <= 7000;
  const url = `https://mail.google.com/mail/?view=cm&fs=1&su=${subject}${fits ? `&body=${body}` : ''}`;
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
    'To: ',
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

function downloadEml(email) {
  const blob = new Blob([buildEml(email)], { type: 'message/rfc822' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  // Nom de fichier en ASCII (accents et tirets typographiques mal gérés par certains navigateurs)
  const safeName = email.subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2010-\u2015]/g, '-').replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  a.download = `${safeName || 'Compte rendu'}.eml`;
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

function getMailTarget() {
  try { return MAIL_TARGETS[localStorage.getItem('voxai_mail_target')] ? localStorage.getItem('voxai_mail_target') : 'desktop'; }
  catch { return 'desktop'; }
}

function setMailTarget(target) {
  try { localStorage.setItem('voxai_mail_target', target); } catch { /* stockage indisponible */ }
}

function openInMailClient(email, target = getMailTarget()) {
  if (target === 'desktop') return downloadEml(email);
  const { url, bodyIncluded } = target === 'web' ? outlookWebUrl(email) : target === 'gmail' ? gmailUrl(email) : mailtoUrl(email);
  if (!bodyIncluded) {
    copyRich(email.body, 'Corps de l’e-mail').then(() =>
      showToast('E-mail long : le corps est copié, collez-le dans le message (Ctrl+V)', '✉️'));
  }
  if (target === 'web' || target === 'gmail') window.open(url, '_blank', 'noopener');
  else window.location.href = url;
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
  Object.entries(MAIL_TARGETS).forEach(([key, t]) => {
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

async function triggerAIProcessing(recId) {
  showToast('Analyse de l’audio en cours par l’IA...', '🧠');
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
      showToast('Analyse IA terminée avec succès !', '🎉');
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
      s.action_items.forEach(a => md += `- [ ] **${a.task}** (Assigné : ${a.assignee || 'Tous'}, Échéance : ${a.deadline || 'N/A'})\n`);
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
      const title = file.name.replace(/\.[^/.]+$/, '');
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
      elements.chatInput.value = chip.textContent.trim();
      sendChatMessage();
    });
  });

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
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
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

// Start
document.addEventListener('DOMContentLoaded', init);
