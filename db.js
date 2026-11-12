/**
 * VoxAI - Backend local exécuté dans le navigateur.
 *
 * Remplace l'ancien serveur Python : toutes les routes /api/* sont interceptées
 * et servies depuis une base IndexedDB locale (enregistrements audio, transcriptions,
 * synthèses, historique de chat et configuration). Rien n'est stocké dans le cloud :
 * seuls les appels d'analyse IA partent vers le fournisseur choisi (Gemini ou LLM local).
 */
(function () {
  'use strict';

  const DB_NAME = 'voxai';
  const DB_VERSION = 1;

  const DEFAULT_CONFIG = {
    provider: 'gemini',
    gemini_api_key: '',
    gemini_model: 'gemini-3.5-flash-lite',
    local_llm_type: 'ollama',
    local_llm_url: 'http://localhost:11434/v1',
    local_llm_model: 'llama3.2',
    local_stt_mode: 'cloud',
    on_prem_llm_url: 'http://localhost:11434/v1',
    on_prem_llm_model: 'llama3.2',
    on_prem_stt_url: 'http://localhost:8000/v1',
    on_prem_stt_model: 'whisper-1',
    language_hint: 'fr'
  };

  // ============================================================================
  // IndexedDB
  // ============================================================================

  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config');
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) {
          const s = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
          s.createIndex('recording_id', 'recording_id');
          s.createIndex('filename', 'filename', { unique: true });
        }
        if (!db.objectStoreNames.contains('chat')) {
          const s = db.createObjectStore('chat', { keyPath: 'id', autoIncrement: true });
          s.createIndex('recording_id', 'recording_id');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Demande au navigateur de ne pas purger les données automatiquement
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    return dbPromise;
  }

  function reqP(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function tx(stores, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then(r => { result = r; }, err => { t.abort(); reject(err); });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction annulée'));
    });
  }

  const store = {
    get: (name, key) => tx([name], 'readonly', t => reqP(t.objectStore(name).get(key))),
    put: (name, value, key) => tx([name], 'readwrite', t => reqP(t.objectStore(name).put(value, key))),
    all: (name) => tx([name], 'readonly', t => reqP(t.objectStore(name).getAll())),
    byIndex: (name, index, value) => tx([name], 'readonly', t => reqP(t.objectStore(name).index(index).getAll(value))),
  };

  async function loadConfig() {
    const saved = await store.get('config', 'main');
    return { ...DEFAULT_CONFIG, ...(saved || {}) };
  }

  async function getFiles(recId) {
    const files = await store.byIndex('files', 'recording_id', recId);
    return files.sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
  }

  // ============================================================================
  // Utilitaires
  // ============================================================================

  function newRecId() {
    return `rec_${Math.floor(Date.now() / 1000)}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function extFromMime(mime) {
    if (/mp4|m4a/.test(mime)) return '.m4a';
    if (/wav/.test(mime)) return '.wav';
    if (/mp3|mpeg/.test(mime)) return '.mp3';
    if (/ogg/.test(mime)) return '.ogg';
    return '.webm';
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function getAudioDuration(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      const done = (d) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? Math.round(d) : 0); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(a.duration);
      a.onerror = () => done(0);
      setTimeout(() => done(0), 5000);
      a.src = url;
    });
  }

  function cleanJson(raw) {
    let text = String(raw || '').trim();
    if (text.startsWith('```json')) text = text.slice(7);
    if (text.startsWith('```')) text = text.slice(3);
    if (text.endsWith('```')) text = text.slice(0, -3);
    text = text.trim();
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s !== -1 && e !== -1) text = text.slice(s, e + 1);
    return JSON.parse(text);
  }

  function json(status, data) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function stripName(name) {
    return String(name || '').replace(/\.[^.]+$/, '');
  }

  // ============================================================================
  // Service IA (appels directs depuis le navigateur)
  // ============================================================================

  const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  function modelsWithFallbacks(primary, fallbacks) {
    const list = [primary];
    for (const f of fallbacks) if (!list.includes(f)) list.push(f);
    return list;
  }

  async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`Délai dépassé (${Math.round(ms / 1000)} s)`);
      throw err;
    } finally {
      clearTimeout(id);
    }
  }

  /** Appelle Gemini en essayant les modèles de secours en cas de 503/429/404. */
  async function geminiGenerate(cfg, payload, fallbacks, timeoutMs, { strict = true } = {}) {
    const apiKey = (cfg.gemini_api_key || '').trim();
    if (!apiKey) throw new Error('Clé API Gemini manquante. Veuillez la configurer dans les paramètres.');
    const models = modelsWithFallbacks(cfg.gemini_model || 'gemini-3.5-flash-lite', fallbacks);
    let lastErr = '';
    for (const m of models) {
      try {
        const res = await fetchWithTimeout(`${GEMINI_BASE}/${m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(payload)
        }, timeoutMs);
        if (!res.ok) {
          const body = await res.text();
          try { lastErr = JSON.parse(body).error.message || body; } catch { lastErr = body; }
          lastErr = `Modèle ${m} (HTTP ${res.status}): ${lastErr}`;
          if ([503, 429, 404].includes(res.status) || !strict) continue;
          throw Object.assign(new Error(lastErr), { fatal: true });
        }
        const data = await res.json();
        return { text: data.candidates[0].content.parts[0].text, model: m };
      } catch (err) {
        if (err.fatal) throw err;
        lastErr = err.message;
      }
    }
    throw new Error(lastErr || 'Échec de l’appel Gemini');
  }

  function localChatUrl(cfg) {
    const url = (cfg.local_llm_url || cfg.on_prem_llm_url || 'http://localhost:11434/v1').trim().replace(/\/+$/, '');
    const v1 = url.endsWith('/v1') ? url : `${url}/v1`;
    return { base: url, v1, chat: `${v1}/chat/completions`, model: cfg.local_llm_model || cfg.on_prem_llm_model || 'llama3.2' };
  }

  async function localChat(cfg, messages, temperature, timeoutMs) {
    const { chat, model } = localChatUrl(cfg);
    const res = await fetchWithTimeout(chat, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature })
    }, timeoutMs);
    if (!res.ok) throw new Error(`LLM local (HTTP ${res.status}): ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  const ANALYSIS_SCHEMA = (multi, firstName) => `{
  "title": "${multi ? 'Titre global représentatif de l\'ensemble de la session' : 'Titre concis et percutant de la conversation ou note'}",
  "language": "fr",
  "transcription": [
    {
      "file_index": 1,${multi ? `\n      "file_name": "${firstName}",` : ''}
      "speaker": "Orateur 1",
      "timestamp": "00:00",
      "text": "Texte fidèlement retranscrit..."
    }
  ],
  "summary": {
    "executive": "Résumé exécutif ${multi ? 'consolidé de l\'ensemble des enregistrements ' : 'de la conversation '}en 3 à 5 phrases synthétiques.",
    "key_points": ["Point clé 1 abordé avec détails", "Point clé 2..."],
    "decisions": ["Décision 1 validée pendant l'échange", "Décision 2..."],
    "action_items": [
      { "task": "Action concrète à réaliser", "assignee": "Personne concernée ou Non assigné", "deadline": "Échéance ou À définir", "status": "todo" }
    ],
    "tags": ["Tag1", "Tag2", "Tag3"]
  }
}`;

  async function audioParts(audioFiles, label) {
    const parts = [];
    for (let i = 0; i < audioFiles.length; i++) {
      const af = audioFiles[i];
      if (audioFiles.length > 1) {
        parts.push({ text: `=== ${label} ${i + 1}/${audioFiles.length} : '${af.name}' ===` });
      }
      parts.push({ inline_data: { mime_type: af.mime_type, data: await blobToBase64(af.blob) } });
    }
    return parts;
  }

  async function processWithGemini(audioFiles, cfg) {
    const multi = audioFiles.length > 1;
    const filesDesc = audioFiles.map(a => `'${a.name}'`).join(', ');
    const prompt = multi
      ? `Tu es l'analyste IA d'un dictaphone intelligent.
Tu as reçu ${audioFiles.length} enregistrements audio (${filesDesc}) appartenant à une MÊME session / réunion / discussion.
Analyse l'ensemble de ces enregistrements pour fournir :
1. Une transcription complète, chronologique et ordonnée de tous les enregistrements. Pour chaque prise de parole, indique impérativement :
   - 'file_index' : le numéro du fichier (1 pour le premier, 2 pour le deuxième, etc.)
   - 'file_name' : le nom du fichier audio correspondant
   - 'speaker' : l'interlocuteur
   - 'timestamp' : l'horodatage au sein de cet enregistrement (ex: 01:23)
   - 'text' : les propos tenus
2. Une synthèse globale et unifiée (résumé exécutif, points clés, décisions et plan d'action) qui consolide et synthétise TOUS les enregistrements sans omission.

Tu dois répondre EXCLUSIVEMENT avec un objet JSON valide (sans backticks markdown, sans texte autour) respectant exactement cette structure:

${ANALYSIS_SCHEMA(true, audioFiles[0].name)}

Règles impératives :
1. La transcription doit couvrir chaque fichier audio successivement et fidèlement.
2. Le résumé, les décisions et le plan d'action doivent couvrir l'ensemble des ${audioFiles.length} enregistrements de façon consolidée.
3. Réponds UNIQUEMENT avec le JSON pur.`
      : `Tu es l'analyste IA d'un dictaphone intelligent.
Analyse cet enregistrement audio de manière exhaustive.
Tu dois répondre EXCLUSIVEMENT avec un objet JSON valide (sans backticks markdown, sans texte autour) respectant exactement cette structure:

${ANALYSIS_SCHEMA(false)}

Règles impératives :
1. La transcription doit être fidèle mot pour mot avec horodatages réels et séparation des interlocuteurs si plusieurs voix parlent.
2. S'il n'y a qu'un seul orateur (ex: mémo vocal / dictée), utilise "Moi" ou "Orateur".
3. Les décisions et actions doivent être claires, concrètes et opérationnelles.
4. Réponds UNIQUEMENT avec le JSON pur.`;

    const parts = [{ text: prompt }, ...(await audioParts(audioFiles, 'ENREGISTREMENT'))];
    const { text } = await geminiGenerate(cfg, {
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, response_mime_type: 'application/json' }
    }, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'], 180000);
    return cleanJson(text);
  }

  async function transcribeWithGemini(audioFiles, cfg) {
    if (!(cfg.gemini_api_key || '').trim()) {
      throw new Error("Pour utiliser la transcription rapide Cloud avec votre LLM local, la clé d'API Gemini doit être configurée dans les paramètres (ou choisissez le mode 'Whisper Local' 100% hors-ligne).");
    }
    const multi = audioFiles.length > 1;
    const filesDesc = audioFiles.map(a => `'${a.name}'`).join(', ');
    const prompt = multi
      ? `Tu es un transcripteur audio professionnel de haute précision.
Transcris fidèlement mot à mot ces ${audioFiles.length} enregistrements audio (${filesDesc}) d'une même session.
Pour chaque segment de parole, indique file_index, file_name, speaker, timestamp, et text.
Réponds EXCLUSIVEMENT avec un JSON pur :
{"transcription": [{"file_index": 1, "file_name": "${audioFiles[0].name}", "speaker": "Orateur 1", "timestamp": "00:00", "text": "Texte fidèlement retranscrit..."}]}`
      : `Tu es un transcripteur audio professionnel de haute précision.
Transcris fidèlement mot à mot cet enregistrement audio.
Indique les orateurs distincts et les horodatages réels.
Réponds EXCLUSIVEMENT avec un JSON pur respectant cette structure exacte :
{"transcription": [{"file_index": 1, "speaker": "Orateur 1", "timestamp": "00:00", "text": "Texte fidèlement retranscrit..."}]}`;

    const parts = [{ text: prompt }, ...(await audioParts(audioFiles, 'PISTE'))];
    const { text } = await geminiGenerate(cfg, {
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, response_mime_type: 'application/json' }
    }, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], 120000, { strict: false });
    return cleanJson(text).transcription || [];
  }

  async function summarizeWithLocalLLM(transcription, audioFiles, cfg) {
    const { model } = localChatUrl(cfg);
    const multi = audioFiles.length > 1;
    const transcript = transcription.map(it => {
      const prefix = multi ? `[Piste ${it.file_index || 1} • ${it.timestamp || '00:00'}]` : `[${it.timestamp || '00:00'}]`;
      return `${prefix} ${it.speaker || 'Orateur'}: ${it.text || ''}`;
    }).join('\n');
    const filesDesc = audioFiles.map(a => `'${a.name}'`).join(', ');

    const prompt = `Tu es l'analyste IA d'un dictaphone intelligent.
Voici la transcription complète de ${audioFiles.length} enregistrement(s) (${filesDesc}) :

"""${transcript}"""

Analyse attentivement cette transcription et génère une synthèse consolidée et structurée.
Tu dois répondre EXCLUSIVEMENT avec un objet JSON valide (sans aucun commentaire, sans bloc markdown superflu) respectant exactement cette structure :

{
  "title": "Titre clair et représentatif de la session ou du sujet principal",
  "language": "fr",
  "summary": {
    "executive": "Résumé exécutif de l'échange ou de la note en 3 à 5 phrases synthétiques.",
    "key_points": ["Point clé 1 important abordé avec détails", "Point clé 2..."],
    "decisions": ["Décision validée pendant la discussion"],
    "action_items": [{"task": "Action concrète à accomplir", "assignee": "Personne concernée ou Non assigné", "deadline": "Échéance ou À définir", "status": "todo"}],
    "tags": ["Tag1", "Tag2", "Tag3"]
  }
}`;

    const fallbackTitle = audioFiles.length ? stripName(audioFiles[0].name) : 'Session analysée';
    try {
      const content = await localChat(cfg, [
        { role: 'system', content: 'Tu es un analyste IA de réunions et notes vocales. Tu réponds UNIQUEMENT par un objet JSON pur et valide, sans markdown.' },
        { role: 'user', content: prompt }
      ], 0.2, 180000);
      const parsed = cleanJson(content);
      parsed.transcription = transcription;
      if (!parsed.title) parsed.title = fallbackTitle;
      return parsed;
    } catch (err) {
      console.warn('[LLM local] Réponse non standard :', err);
      return {
        title: fallbackTitle,
        language: 'fr',
        transcription,
        summary: {
          executive: `Analyse réalisée par le modèle local (${model}). Consultez la transcription détaillée.`,
          key_points: ["Transcription complète disponible dans l'onglet Transcription."],
          decisions: [],
          action_items: [],
          tags: ['LocalLLM', model]
        }
      };
    }
  }

  async function transcribeWhisperLocal(af, sttUrl, sttModel) {
    const form = new FormData();
    form.append('model', sttModel || 'whisper-1');
    form.append('file', af.blob, af.filename);
    const res = await fetchWithTimeout(`${sttUrl}/audio/transcriptions`, { method: 'POST', body: form }, 90000);
    if (!res.ok) throw new Error(`Whisper local (HTTP ${res.status}): ${await res.text()}`);
    return (await res.json()).text || '';
  }

  async function processRecording(audioFiles, cfg) {
    if (cfg.provider === 'gemini') return processWithGemini(audioFiles, cfg);
    if ((cfg.local_stt_mode || 'cloud') === 'cloud') {
      const transcription = await transcribeWithGemini(audioFiles, cfg);
      return summarizeWithLocalLLM(transcription, audioFiles, cfg);
    }
    const sttUrl = (cfg.on_prem_stt_url || 'http://localhost:8000/v1').replace(/\/+$/, '');
    const transcription = [];
    for (let i = 0; i < audioFiles.length; i++) {
      transcription.push({
        file_index: i + 1,
        file_name: audioFiles[i].name,
        speaker: `Orateur (Piste ${i + 1})`,
        timestamp: '00:00',
        text: await transcribeWhisperLocal(audioFiles[i], sttUrl, cfg.on_prem_stt_model)
      });
    }
    return summarizeWithLocalLLM(transcription, audioFiles, cfg);
  }

  async function chatWithRecording(userMsg, transcriptStr, summaryStr, history, cfg) {
    const system = `Tu es l'assistant personnel de ce dictaphone.
L'utilisateur te pose des questions à propos de cet enregistrement vocal.

=== TRANSCRIPTION DE L'ENREGISTREMENT ===
${transcriptStr}

=== SYNTHÈSE DE L'ENREGISTREMENT ===
${summaryStr}

Réponds de manière précise, concise et serviable en te basant sur ce qui a été dit. Si l'information ne figure pas dans l'enregistrement, mentionne-le poliment.`;

    if (cfg.provider === 'gemini') {
      const contents = [
        { role: 'user', parts: [{ text: system }] },
        { role: 'model', parts: [{ text: 'Compris, je réponds à toutes vos questions concernant cet enregistrement.' }] },
        ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
        { role: 'user', parts: [{ text: userMsg }] }
      ];
      const { text } = await geminiGenerate(cfg, { contents },
        ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'], 30000);
      return text;
    }
    return localChat(cfg, [
      { role: 'system', content: system },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: userMsg }
    ], 0.3, 45000);
  }

  function corsHint(err) {
    const origin = location.origin;
    return `${err.message}. Si le serveur local est bien démarré, autorisez cette page dans sa configuration CORS (ex. Ollama : OLLAMA_ORIGINS="${origin}").`;
  }

  async function testConnection(cfg) {
    if (cfg.provider === 'gemini') {
      if (!(cfg.gemini_api_key || '').trim()) return { success: false, message: "La clé d'API Gemini n'est pas renseignée." };
      const requested = cfg.gemini_model || 'gemini-3.5-flash-lite';
      try {
        const { text, model } = await geminiGenerate(cfg, {
          contents: [{ parts: [{ text: 'Réponds uniquement par: OK' }] }]
        }, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], 12000);
        const note = model !== requested
          ? ` (Note: ${requested} étant temporairement saturé chez Google, bascule automatique sur ${model})` : '';
        return { success: true, message: `Connexion Gemini réussie avec ${model} ! Réponse: ${text.trim()}${note}` };
      } catch (err) {
        return { success: false, message: `Erreur Gemini: ${err.message}` };
      }
    }
    const { model, base } = localChatUrl(cfg);
    const t0 = performance.now();
    try {
      await localChat(cfg, [{ role: 'user', content: 'ping' }], 0, 12000);
      return { success: true, message: `Connexion au LLM local réussie (${model}) en ${Math.round(performance.now() - t0)} ms !` };
    } catch (err) {
      return { success: false, message: `Impossible de joindre le modèle local '${model}' sur ${base} : ${corsHint(err)}` };
    }
  }

  async function detectLocalModels(url) {
    const clean = (url || 'http://localhost:11434').trim().replace(/\/+$/, '');
    const root = clean.endsWith('/v1') ? clean.slice(0, -3) : clean;
    const v1 = clean.endsWith('/v1') ? clean : `${clean}/v1`;
    let lastErr = null;

    try {
      const res = await fetchWithTimeout(`${root}/api/tags`, { headers: { Accept: 'application/json' } }, 3000);
      if (res.ok) {
        const models = [...new Set(((await res.json()).models || []).map(m => m.name).filter(Boolean))].sort();
        if (models.length) return { success: true, models, type: 'ollama', server_url: v1 };
      }
    } catch (err) { lastErr = err; }

    for (const endpoint of [`${v1}/models`, `${clean}/models`]) {
      try {
        const res = await fetchWithTimeout(endpoint, { headers: { Accept: 'application/json' } }, 3000);
        if (!res.ok) continue;
        const models = [...new Set(((await res.json()).data || []).map(m => m.id).filter(Boolean))].sort();
        if (models.length) {
          const type = endpoint.includes('1234') ? 'lm_studio' : (endpoint.includes('11434') ? 'ollama' : 'vllm');
          return { success: true, models, type, server_url: v1 };
        }
      } catch (err) { lastErr = err; }
    }

    let error = `Aucun serveur LLM détecté sur ${url}. Vérifiez qu'Ollama (port 11434) ou LM Studio (port 1234) est bien actif.`;
    if (lastErr) error += ` Pensez aussi à autoriser l'origine ${location.origin} (CORS, ex. OLLAMA_ORIGINS).`;
    return { success: false, error, models: [] };
  }

  // ============================================================================
  // Routes /api/*
  // ============================================================================

  async function addFile(recId, blob, mime, originalName, duration) {
    if (!duration) duration = await getAudioDuration(blob);
    const filename = `${recId}_${Math.random().toString(16).slice(2, 8)}${extFromMime(mime)}`;
    const now = new Date().toISOString();
    return tx(['recordings', 'files'], 'readwrite', async t => {
      const recs = t.objectStore('recordings');
      const files = t.objectStore('files');
      const rec = await reqP(recs.get(recId));
      if (!rec) throw new Error('Session introuvable');
      const count = await reqP(files.index('recording_id').count(recId));
      files.add({
        recording_id: recId, filename, original_name: originalName, mime_type: mime,
        file_size: blob.size, duration, sort_order: count, created_at: now, blob
      });
      if (!rec.filename) { rec.filename = filename; rec.mime_type = mime; }
      rec.file_size = (rec.file_size || 0) + blob.size;
      rec.duration = (rec.duration || 0) + duration;
      recs.put(rec);
      return { filename, original_name: originalName, file_size: blob.size, duration };
    });
  }

  function publicFile(f) {
    const { blob, recording_id, created_at, ...rest } = f;
    return rest;
  }

  async function handle(method, path, query, req) {
    const seg = path.split('/').filter(Boolean); // ['api', 'recordings', id, ...]

    if (path === '/api/config') {
      if (method === 'GET') {
        const cfg = await loadConfig();
        const k = cfg.gemini_api_key;
        if (k) cfg.gemini_api_key_masked = k.length > 8 ? `${k.slice(0, 4)}...${k.slice(-4)}` : '***';
        return json(200, cfg);
      }
      const data = await req.json();
      const cfg = await loadConfig();
      for (const k of Object.keys(DEFAULT_CONFIG)) if (k in data) cfg[k] = data[k];
      if (cfg.local_llm_url) cfg.on_prem_llm_url = cfg.local_llm_url;
      if (cfg.local_llm_model) cfg.on_prem_llm_model = cfg.local_llm_model;
      await store.put('config', cfg, 'main');
      return json(200, { success: true, message: 'Configuration enregistrée avec succès !' });
    }

    if (path === '/api/local-models') {
      return json(200, await detectLocalModels(query.get('url') || 'http://localhost:11434/v1'));
    }

    if (path === '/api/test-connection') {
      const text = await req.text();
      return json(200, await testConnection(text ? { ...(await loadConfig()), ...JSON.parse(text) } : await loadConfig()));
    }

    if (path === '/api/recordings' && method === 'GET') {
      const [recs, files] = await Promise.all([store.all('recordings'), store.all('files')]);
      const counts = {};
      for (const f of files) counts[f.recording_id] = (counts[f.recording_id] || 0) + 1;
      const rows = recs
        .map(r => ({
          id: r.id, title: r.title, created_at: r.created_at, duration: r.duration,
          filename: r.filename, mime_type: r.mime_type, file_size: r.file_size,
          status: r.status, file_count: counts[r.id] || 0
        }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return json(200, rows);
    }

    if (path === '/api/recordings/create' && method === 'POST') {
      const data = await req.json().catch(() => ({}));
      const title = (data.title || '').trim() || 'Session groupée';
      const id = newRecId();
      await store.put('recordings', {
        id, title, created_at: new Date().toISOString(), duration: 0, filename: '',
        mime_type: 'audio/webm', file_size: 0, status: 'recorded', transcription: null,
        summary: null, error_message: null
      });
      return json(201, { id, title, status: 'recorded' });
    }

    if (path === '/api/recordings/upload' && method === 'POST') {
      const mime = req.headers.get('Content-Type') || 'audio/webm';
      const title = decodeURIComponent(req.headers.get('X-Audio-Title') || 'Nouvel enregistrement');
      const duration = parseInt(req.headers.get('X-Audio-Duration') || '0', 10) || 0;
      const blob = new Blob([await req.arrayBuffer()], { type: mime });
      const id = newRecId();
      await store.put('recordings', {
        id, title, created_at: new Date().toISOString(), duration: 0, filename: '',
        mime_type: mime, file_size: 0, status: 'recorded', transcription: null,
        summary: null, error_message: null
      });
      const f = await addFile(id, blob, mime, title, duration);
      return json(201, { id, title, filename: f.filename, duration: f.duration, status: 'recorded' });
    }

    if (seg[0] === 'api' && seg[1] === 'recordings' && seg[2]) {
      const recId = seg[2];
      const action = seg[3];

      if (!action && method === 'GET') {
        const rec = await store.get('recordings', recId);
        if (!rec) return json(404, { error: 'Enregistrement non trouvé' });
        const files = (await getFiles(recId)).map(publicFile);
        const chat = (await store.byIndex('chat', 'recording_id', recId))
          .sort((a, b) => a.id - b.id)
          .map(({ role, content, created_at }) => ({ role, content, created_at }));
        return json(200, { ...rec, files, chat_history: chat });
      }

      if (action === 'files' && method === 'POST') {
        const mime = req.headers.get('Content-Type') || 'audio/webm';
        const name = decodeURIComponent(req.headers.get('X-Original-Filename') || 'Enregistrement');
        const duration = parseInt(req.headers.get('X-Audio-Duration') || '0', 10) || 0;
        const blob = new Blob([await req.arrayBuffer()], { type: mime });
        try {
          return json(201, { success: true, file: await addFile(recId, blob, mime, name, duration) });
        } catch (err) {
          return json(404, { error: err.message });
        }
      }

      if (action === 'process' && method === 'POST') {
        const rec = await store.get('recordings', recId);
        if (!rec) return json(404, { error: 'Enregistrement non trouvé' });
        const files = await getFiles(recId);
        if (!files.length) return json(400, { error: 'Aucun fichier audio trouvé pour cette session.' });
        const audioFiles = files.map(f => ({
          blob: f.blob, mime_type: f.mime_type, name: f.original_name, filename: f.filename, duration: f.duration
        }));
        const cfg = await loadConfig();
        await store.put('recordings', { ...rec, status: 'processing', error_message: null });
        try {
          const result = await processRecording(audioFiles, cfg);
          const fresh = await store.get('recordings', recId);
          if (fresh) {
            await store.put('recordings', {
              ...fresh,
              title: result.title || fresh.title,
              transcription: result.transcription || [],
              summary: result.summary || {},
              status: 'completed'
            });
          }
          return json(200, { success: true, title: result.title, transcription: result.transcription, summary: result.summary });
        } catch (err) {
          const fresh = await store.get('recordings', recId);
          if (fresh) await store.put('recordings', { ...fresh, status: 'error', error_message: err.message });
          return json(500, { success: false, error: err.message });
        }
      }

      if (action === 'chat' && method === 'POST') {
        const { message = '' } = await req.json().catch(() => ({}));
        const userMsg = message.trim();
        if (!userMsg) return json(400, { error: 'Message vide' });
        const rec = await store.get('recordings', recId);
        if (!rec) return json(404, { error: 'Enregistrement non trouvé' });
        const history = (await store.byIndex('chat', 'recording_id', recId))
          .sort((a, b) => a.id - b.id).map(({ role, content }) => ({ role, content }));
        await store.put('chat', { recording_id: recId, role: 'user', content: userMsg, created_at: new Date().toISOString() });
        try {
          const reply = await chatWithRecording(
            userMsg,
            rec.transcription ? JSON.stringify(rec.transcription) : '',
            rec.summary ? JSON.stringify(rec.summary) : '',
            history, await loadConfig()
          );
          await store.put('chat', { recording_id: recId, role: 'assistant', content: reply, created_at: new Date().toISOString() });
          return json(200, { reply });
        } catch (err) {
          return json(500, { error: `Erreur IA Chat: ${err.message}` });
        }
      }

      if (method === 'DELETE') {
        await tx(['recordings', 'files', 'chat'], 'readwrite', async t => {
          const files = t.objectStore('files');
          const recs = t.objectStore('recordings');
          if (action === 'files' && seg[4]) {
            const f = await reqP(files.get(Number(seg[4])));
            if (f && f.recording_id === recId) {
              files.delete(f.id);
              const rec = await reqP(recs.get(recId));
              if (rec) {
                rec.file_size = Math.max(0, (rec.file_size || 0) - f.file_size);
                rec.duration = Math.max(0, (rec.duration || 0) - f.duration);
                recs.put(rec);
              }
            }
            return;
          }
          for (const key of await reqP(files.index('recording_id').getAllKeys(recId))) files.delete(key);
          const chat = t.objectStore('chat');
          for (const key of await reqP(chat.index('recording_id').getAllKeys(recId))) chat.delete(key);
          recs.delete(recId);
        });
        return json(200, { success: true });
      }
    }

    return json(404, { error: 'Route inconnue' });
  }

  // ============================================================================
  // Interception de fetch() pour les routes /api/*
  // ============================================================================

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    if (typeof input !== 'string' || !input.startsWith('/api/')) return nativeFetch(input, init);
    const url = new URL(input, location.origin);
    const req = new Request(url, init);
    try {
      return await handle(req.method.toUpperCase(), url.pathname, url.searchParams, req);
    } catch (err) {
      console.error('[VoxAI local]', err);
      return json(500, { success: false, error: err.message });
    }
  };

  // Une analyse interrompue (onglet fermé pendant le traitement) ne doit pas rester bloquée
  store.all('recordings').then(recs => Promise.all(recs
    .filter(r => r.status === 'processing')
    .map(r => store.put('recordings', { ...r, status: 'error', error_message: 'Analyse interrompue (page fermée). Relancez l’IA.' }))
  )).catch(() => {});

  // ============================================================================
  // Lecture audio : URL blob locale pour un fichier enregistré
  // ============================================================================

  const blobUrls = new Map();
  window.VoxLocal = {
    async audioUrl(filename) {
      if (!filename) return '';
      if (blobUrls.has(filename)) return blobUrls.get(filename);
      const db = await openDB();
      const f = await reqP(db.transaction('files').objectStore('files').index('filename').get(filename));
      if (!f) return '';
      const u = URL.createObjectURL(f.blob);
      blobUrls.set(filename, u);
      return u;
    },
    async storageEstimate() {
      return navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : null;
    }
  };
})();
