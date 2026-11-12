/**
 * VoxAI - Transcription en direct (brouillon) pendant l'enregistrement.
 *
 * Utilise la reconnaissance vocale du navigateur (Web Speech API, Chrome / Edge).
 * Attention : le navigateur envoie l'audio à son service de reconnaissance
 * (Google pour Chrome, Microsoft pour Edge). La fonction est donc désactivée
 * par défaut et s'active d'un clic ; le choix est mémorisé dans ce navigateur.
 *
 * Le texte obtenu est un brouillon : l'analyse IA finale (après l'arrêt) reste
 * la transcription de référence, avec les orateurs et les horodatages précis.
 */
(function () {
  'use strict';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const STORAGE_KEY = 'voxai_live_transcript';

  const live = {
    rec: null,
    active: false,   // une session d'enregistrement est en cours
    paused: false,
    segments: [],    // [{ t: secondes, text }]
    interim: '',
    errors: 0,
    fatal: false
  };

  const $ = (id) => document.getElementById(id);

  function enabled() {
    try { return localStorage.getItem(STORAGE_KEY) === 'on'; } catch { return false; }
  }

  function setEnabled(on) {
    try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* stockage indisponible */ }
  }

  function langCode() {
    let hint = '';
    try { hint = (state.config && state.config.language_hint) || ''; } catch { /* app.js pas encore chargé */ }
    const map = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', nl: 'nl-NL' };
    return map[hint] || (hint.includes('-') ? hint : '') || navigator.language || 'fr-FR';
  }

  function elapsed() {
    try { return state.recordElapsedSec || 0; } catch { return 0; }
  }

  function setStatus(text, kind = 'info') {
    const el = $('liveStatus');
    if (!el) return;
    const colors = { info: 'text-slate-500', on: 'text-emerald-400', warn: 'text-amber-400', err: 'text-rose-400' };
    el.className = `text-[10px] ${colors[kind] || colors.info}`;
    el.textContent = text;
  }

  function render() {
    const box = $('liveBox');
    if (!box) return;
    if (!live.segments.length && !live.interim) {
      box.innerHTML = `<span class="text-slate-500 italic">${live.active ? 'Parlez, le texte apparaît ici…' : ''}</span>`;
      return;
    }
    box.innerHTML = live.segments.map(s =>
      `<p><span class="live-ts">${formatDuration(s.t)}</span>${escapeHtml(s.text)}</p>`).join('') +
      (live.interim ? `<p class="live-interim">${escapeHtml(live.interim)}</p>` : '');
    box.scrollTop = box.scrollHeight;
  }

  function createRecognition() {
    const r = new SR();
    r.lang = langCode();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (event) => {
      live.errors = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) live.segments.push({ t: Math.max(0, elapsed() - Math.ceil(text.split(/\s+/).length / 2.5)), text });
        else interim += (interim ? ' ' : '') + text;
      }
      live.interim = interim;
      render();
    };

    r.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        live.fatal = true;
        setStatus('Reconnaissance vocale refusée par le navigateur ou bloquée par votre organisation.', 'err');
        return;
      }
      live.errors++;
      if (event.error === 'network') setStatus('Service de reconnaissance injoignable (connexion Internet requise).', 'warn');
      else setStatus(`Erreur de reconnaissance : ${event.error}`, 'warn');
      if (live.errors >= 3) live.fatal = true;
    };

    // Chrome arrête la reconnaissance après un silence ou ~1 min : on relance tant que l'enregistrement continue
    r.onend = () => {
      live.interim = '';
      render();
      if (live.active && !live.paused && !live.fatal && enabled()) {
        setTimeout(() => { if (live.active && !live.paused && !live.fatal) safeStart(); }, 250);
      } else if (!live.fatal && live.active) {
        setStatus(live.paused ? 'En pause' : 'Arrêtée');
      }
    };
    return r;
  }

  function safeStart() {
    try {
      if (!live.rec) live.rec = createRecognition();
      live.rec.start();
      setStatus(`En écoute (${live.rec.lang})`, 'on');
    } catch (err) {
      // InvalidStateError : déjà démarrée
      if (err.name !== 'InvalidStateError') setStatus(`Impossible de démarrer : ${err.message}`, 'err');
    }
  }

  function safeStop() {
    if (!live.rec) return;
    try { live.rec.stop(); } catch { /* déjà arrêtée */ }
  }

  // ==========================================================================
  // API utilisée par app.js
  // ==========================================================================

  window.VoxLive = {
    supported: !!SR,

    start() {
      live.active = true;
      live.paused = false;
      live.segments = [];
      live.interim = '';
      live.errors = 0;
      live.fatal = false;
      live.rec = null;
      if (!SR || !enabled()) return;
      $('liveBox').classList.remove('hidden');
      render();
      safeStart();
    },

    pause() {
      live.paused = true;
      safeStop();
    },

    resume() {
      live.paused = false;
      if (SR && enabled() && !live.fatal) safeStart();
    },

    /** Arrête et renvoie le texte du brouillon (avec horodatages approximatifs). */
    stop() {
      live.active = false;
      safeStop();
      const finalText = live.segments.map(s => `[${formatDuration(s.t)}] ${s.text}`).join('\n')
        + (live.interim ? `${live.segments.length ? '\n' : ''}[${formatDuration(elapsed())}] ${live.interim}` : '');
      live.interim = '';
      return finalText.trim();
    },

    cancel() {
      live.active = false;
      live.segments = [];
      live.interim = '';
      safeStop();
      this.reset();
    },

    reset() {
      const box = $('liveBox');
      if (box) { box.innerHTML = ''; box.classList.add('hidden'); }
      setStatus(SR ? (enabled() ? 'Activée' : '') : '');
    }
  };

  function setup() {
    const toggle = $('liveToggle');
    if (!toggle) return;
    if (!SR) {
      toggle.disabled = true;
      $('liveToggleLabel').classList.add('opacity-50');
      setStatus('Non disponible dans ce navigateur : utilisez Chrome ou Edge.', 'warn');
      return;
    }
    toggle.checked = enabled();
    setStatus(enabled() ? 'Activée' : '');
    toggle.addEventListener('change', () => {
      setEnabled(toggle.checked);
      if (!live.active) { setStatus(toggle.checked ? 'Activée' : ''); return; }
      if (toggle.checked) {
        live.fatal = false;
        $('liveBox').classList.remove('hidden');
        render();
        if (!live.paused) safeStart();
      } else {
        safeStop();
        setStatus('Désactivée');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', setup);
})();
