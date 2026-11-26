/**
 * VoxAI - Enregistrement et conversion en MP3.
 *
 * Le navigateur n'enregistre qu'en WebM (Opus), format refusé par certains serveurs Whisper.
 * Pendant l'enregistrement, le son est donc aussi encodé en MP3 au fil de l'eau :
 * AudioWorklet (pcm-worklet.js) → Web Worker (mp3-worker.js, encodeur LAME).
 * MP3 mono 48 kbit/s : environ 21 Mo par heure, compris par Whisper comme par Gemini.
 * Si l'encodage MP3 est impossible, l'enregistrement WebM sert de secours.
 */
(function () {
  'use strict';

  const KBPS = 48;
  const RATES = [24000, 22050, 16000];
  const supported = typeof window.AudioWorkletNode === 'function' && typeof window.Worker === 'function';

  /** Fréquence de sortie : la moitié de celle du micro (48 kHz → 24 kHz), largement assez pour la voix. */
  function outRateFor(inRate) {
    return RATES.find(r => Number.isInteger(inRate / r)) || 24000;
  }

  function encoder(inRate, outRate) {
    const worker = new Worker('mp3-worker.js');
    worker.postMessage({ type: 'init', inRate, outRate, kbps: KBPS });
    let failure = null;
    const finished = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.type === 'done') resolve(e.data.blob);
        else if (e.data.type === 'error') { failure = new Error(e.data.message); reject(failure); }
      };
      worker.onerror = (e) => { failure = new Error(e.message || 'encodeur MP3 indisponible'); reject(failure); };
    });
    finished.catch(() => {}); // erreur lue par end()
    return {
      push(f32) { if (!failure) worker.postMessage({ type: 'pcm', data: f32 }, [f32.buffer]); },
      async end() {
        if (failure) throw failure;
        worker.postMessage({ type: 'end' });
        try { return await finished; } finally { worker.terminate(); }
      },
      cancel() { worker.terminate(); }
    };
  }

  /**
   * Encodage MP3 en direct du son passant par `tap` (nœud Web Audio). `isPaused()` : les passages
   * en pause ne sont pas enregistrés, comme avec MediaRecorder.
   */
  async function startCapture(ctx, tap, isPaused = () => false) {
    if (!supported) throw new Error('AudioWorklet non disponible');
    await ctx.audioWorklet.addModule('pcm-worklet.js');
    const node = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const enc = encoder(ctx.sampleRate, outRateFor(ctx.sampleRate));
    node.port.onmessage = (e) => { if (!isPaused()) enc.push(e.data); };
    // Le nœud doit être relié à la sortie pour être traité : volume nul, rien n'est joué
    const mute = ctx.createGain();
    mute.gain.value = 0;
    tap.connect(node);
    node.connect(mute).connect(ctx.destination);
    const stop = () => { node.port.onmessage = null; try { tap.disconnect(node); } catch { /* déjà déconnecté */ } };
    return {
      finish() { stop(); return enc.end(); },
      cancel() { stop(); enc.cancel(); }
    };
  }

  /** Conversion d'un fichier audio existant (WebM, Ogg…) en MP3, par exemple pour un serveur Whisper. */
  async function fromBlob(blob) {
    const outRate = 24000;
    // Décodage directement à 24 kHz : le navigateur rééchantillonne
    const audio = await new OfflineAudioContext(1, 1, outRate).decodeAudioData(await blob.arrayBuffer());
    const enc = encoder(outRate, outRate);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
    const step = outRate * 10;
    for (let i = 0; i < audio.length; i += step) {
      const n = Math.min(step, audio.length - i);
      const mono = new Float32Array(n);
      for (const ch of channels) for (let k = 0; k < n; k++) mono[k] += ch[i + k] / channels.length;
      enc.push(mono);
    }
    return enc.end();
  }

  window.VoxMp3 = { supported, startCapture, fromBlob, outRateFor };
})();
