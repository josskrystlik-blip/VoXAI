/**
 * VoxAI - Publication des comptes rendus dans Confluence.
 *
 * - Authentification par jeton d'accès personnel (PAT, Confluence Server / Data Center)
 *   ou par e-mail + jeton d'API (Confluence Cloud).
 * - Navigation dans les espaces et l'arborescence des pages, recherche par titre.
 * - Création d'une sous-page ou mise à jour (remplacement / ajout à la fin) d'une page existante.
 *
 * Les appels partent du navigateur. Si l'application est servie par l'image Docker avec
 * CONFLUENCE_URL défini, ils passent par le proxy du conteneur (/confluence/), ce qui évite
 * les blocages CORS ; sinon, ils vont directement à l'URL Confluence configurée.
 */
(function () {
  'use strict';

  // ============================================================================
  // Client REST Confluence (API v1, commune à Server/Data Center et Cloud)
  // ============================================================================

  let proxyEnabled = null;
  async function detectProxy() {
    if (proxyEnabled !== null) return proxyEnabled;
    // Fichier ouvert directement (file://) : pas de serveur, donc pas de proxy.
    if (location.protocol === 'file:') return (proxyEnabled = false);
    try {
      const res = await fetch('confluence-proxy.json', { cache: 'no-store' });
      proxyEnabled = res.ok && (await res.json()).enabled === true;
    } catch {
      proxyEnabled = false;
    }
    return proxyEnabled;
  }

  function isConfigured(cfg) {
    if (!cfg || !(cfg.confluence_token || '').trim()) return false;
    if (cfg.confluence_auth === 'basic' && !(cfg.confluence_email || '').trim()) return false;
    return !!(cfg.confluence_url || '').trim() || proxyEnabled === true;
  }

  async function apiBase(cfg) {
    if (await detectProxy()) return new URL('confluence', location.href).href.replace(/\/+$/, '') + '/rest/api';
    const url = (cfg.confluence_url || '').trim().replace(/\/+$/, '');
    if (!url) throw new Error("URL Confluence non renseignée (⚙️ Paramètres → Confluence).");
    return `${url}/rest/api`;
  }

  function authHeader(cfg) {
    const token = (cfg.confluence_token || '').trim();
    if (cfg.confluence_auth === 'basic') {
      const raw = new TextEncoder().encode(`${(cfg.confluence_email || '').trim()}:${token}`);
      return `Basic ${btoa(String.fromCharCode(...raw))}`;
    }
    return `Bearer ${token}`;
  }

  async function request(cfg, method, path, body) {
    const base = await apiBase(cfg);
    const isForm = body instanceof FormData; // pièce jointe : multipart, en-tête posé par le navigateur
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: authHeader(cfg),
          'X-Atlassian-Token': 'no-check',
          ...(body && !isForm ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
        credentials: 'omit'
      });
    } catch (err) {
      throw new Error(proxyEnabled
        ? `Confluence injoignable via le proxy du conteneur (${err.message}).`
        : `Confluence injoignable (${err.message}). Le serveur bloque probablement les appels venant de ${location.origin} (CORS) : utilisez l'image Docker avec CONFLUENCE_URL, ou demandez à l'administrateur d'autoriser cette origine.`);
    }
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(`Accès refusé par Confluence (HTTP ${res.status}) : vérifiez le jeton et vos droits sur l'espace.`), { status: res.status });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* réponse non JSON */ }
    if (!res.ok) {
      const msg = (data && (data.message || (data.data && data.data.errors && data.data.errors[0] && data.data.errors[0].message && data.data.errors[0].message.translation))) || text.slice(0, 300);
      throw Object.assign(new Error(`Confluence (HTTP ${res.status}) : ${msg}`), { status: res.status });
    }
    return data;
  }

  const enc = encodeURIComponent;

  const api = {
    async currentUser(cfg) {
      return request(cfg, 'GET', '/user/current');
    },

    async spaces(cfg) {
      const all = [];
      for (let start = 0; start < 1000; start += 100) {
        const page = await request(cfg, 'GET', `/space?limit=100&start=${start}`);
        all.push(...(page.results || []));
        if (!page._links || !page._links.next || (page.results || []).length === 0) break;
      }
      return all
        .map(s => ({ key: s.key, name: s.name, type: s.type }))
        .sort((a, b) => (a.type === b.type ? 0 : a.type === 'global' ? -1 : 1) || a.name.localeCompare(b.name, 'fr'));
    },

    async rootPages(cfg, spaceKey) {
      const res = await request(cfg, 'GET', `/space/${enc(spaceKey)}/content/page?depth=root&limit=200`);
      return (res.results || []).map(p => ({ id: p.id, title: p.title }));
    },

    async children(cfg, pageId) {
      const res = await request(cfg, 'GET', `/content/${enc(pageId)}/child/page?limit=200`);
      return (res.results || []).map(p => ({ id: p.id, title: p.title }));
    },

    async search(cfg, spaceKey, text) {
      const q = text.replace(/["\\]/g, ' ').trim();
      const cql = `space="${spaceKey.replace(/"/g, '')}" and type=page and title~"${q}"`;
      const res = await request(cfg, 'GET', `/content/search?cql=${enc(cql)}&limit=30`);
      return (res.results || []).map(p => ({ id: p.id, title: p.title }));
    },

    async getPage(cfg, id) {
      return request(cfg, 'GET', `/content/${enc(id)}?expand=version,body.storage,space`);
    },

    async createPage(cfg, { spaceKey, parentId, title, storage }) {
      return request(cfg, 'POST', '/content', {
        type: 'page',
        title: bmp(title).trim(),
        space: { key: spaceKey },
        ...(parentId ? { ancestors: [{ id: parentId }] } : {}),
        body: { storage: { value: storage, representation: 'storage' } }
      });
    },

    async updatePage(cfg, { id, title, storage, mode }) {
      const current = await api.getPage(cfg, id);
      const existing = (current.body && current.body.storage && current.body.storage.value) || '';
      const value = mode === 'append' ? `${existing}<hr />${storage}` : storage;
      return request(cfg, 'PUT', `/content/${enc(id)}`, {
        id,
        type: 'page',
        title: bmp(title || current.title).trim(),
        space: { key: current.space.key },
        version: { number: current.version.number + 1, message: 'Compte rendu publié par VoxAI' },
        body: { storage: { value, representation: 'storage' } }
      });
    },

    async attachments(cfg, pageId, filename) {
      const res = await request(cfg, 'GET', `/content/${enc(pageId)}/child/attachment?filename=${enc(filename)}&expand=version`);
      return (res && res.results) || [];
    },

    /** Ajoute la pièce jointe, ou en crée une nouvelle version si un fichier du même nom existe déjà. */
    async uploadAttachment(cfg, pageId, filename, blob, comment) {
      const form = () => {
        const f = new FormData();
        f.append('file', blob, filename);
        f.append('comment', comment);
        f.append('minorEdit', 'true');
        return f;
      };
      try {
        // Créer ou mettre à jour en un appel (Confluence Server / Data Center et Cloud)
        return await request(cfg, 'PUT', `/content/${enc(pageId)}/child/attachment`, form());
      } catch (err) {
        if (![404, 405].includes(err.status)) throw err;
        const [existing] = await api.attachments(cfg, pageId, filename);
        return existing
          ? request(cfg, 'POST', `/content/${enc(pageId)}/child/attachment/${enc(existing.id)}/data`, form())
          : request(cfg, 'POST', `/content/${enc(pageId)}/child/attachment`, form());
      }
    },

    async addLabels(cfg, id, labels) {
      if (!labels.length) return;
      await request(cfg, 'POST', `/content/${enc(id)}/label`, labels.map(name => ({ prefix: 'global', name })));
    }
  };

  function pageUrl(page) {
    const links = (page && page._links) || {};
    const url = links.base && links.webui ? String(links.base) + String(links.webui) : '';
    return /^https?:\/\//i.test(url) ? url : ''; // jamais de lien javascript: ou data:
  }

  // ============================================================================
  // Mise en forme du compte rendu (format de stockage Confluence)
  // ============================================================================

  /**
   * Caractères sur 4 octets (emojis…) retirés : les bases MySQL des installations Data Center
   * configurées en utf8 (configuration longtemps recommandée par Atlassian) les refusent et la
   * page ne serait pas créée (« Incorrect string value »).
   */
  const bmp = (str) => String(str ?? '').replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/\uFE0F/g, '').replace(/ {2,}/g, ' ').trim();

  function x(str) {
    return bmp(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Émoticônes Confluence (macro native, affichée partout) plutôt que des emojis. */
  const icon = (name) => `<ac:emoticon ac:name="${name}" />`;

  function transcriptFileName(rec) {
    return `Transcription - ${safeFileName(rec.title, 'Enregistrement')}.txt`;
  }

  /** Transcription intégrale en texte brut (pièce jointe). */
  function transcriptText(rec) {
    const multi = rec.files && rec.files.length > 1;
    const date = new Date(rec.created_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
    const head = [
      `Transcription intégrale — ${rec.title}`,
      `Enregistrement du ${date}, durée ${formatDuration(rec.duration || 0)}`,
      ...(multi ? [`Fichiers audio : ${rec.files.map((f, i) => `piste ${i + 1} = ${f.original_name}`).join(' ; ')}`] : []),
      'Générée par VoxAI.',
      ''
    ];
    const lines = (Array.isArray(rec.transcription) ? rec.transcription : []).map(t => {
      const ts = multi ? `Piste ${t.file_index || 1} • ${t.timestamp || '00:00'}` : (t.timestamp || '00:00');
      return `[${ts}] ${t.speaker || 'Orateur'} : ${t.text || ''}`;
    });
    return '\ufeff' + [...head, ...lines].join('\r\n') + '\r\n'; // BOM + CRLF : lisible tel quel sous Windows
  }

  function buildStorage(rec, { includeTranscript = true, attachTranscript = false } = {}) {
    const s = rec.summary || {};
    const text = (it) => (it && typeof it === 'object') ? (it.text || '') : String(it ?? '');
    const date = new Date(rec.created_at).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
    const multi = rec.files && rec.files.length > 1;
    let h = `<p><em>Compte rendu généré par VoxAI — enregistrement du ${x(date)}, durée ${x(formatDuration(rec.duration || 0))}${multi ? `, ${rec.files.length} fichiers audio` : ''}.</em></p>`;

    if (s.executive) h += `<h2>Résumé</h2><p>${x(s.executive)}</p>`;

    const decisions = s.decisions || [];
    if (decisions.length) h += `<h2>Décisions</h2><ul>${decisions.map(d => `<li>${x(text(d))}</li>`).join('')}</ul>`;

    const actions = s.action_items || [];
    if (actions.length) {
      h += `<h2>Plan d'action</h2><ac:task-list>${actions.map(a => {
        const meta = [a.assignee ? `responsable : ${x(a.assignee)}` : '', a.deadline ? `échéance : ${x(deadlineInfo(a.deadline).long)}` : ''].filter(Boolean).join(' — ');
        return `<ac:task><ac:task-status>${a.status === 'done' ? 'complete' : 'incomplete'}</ac:task-status><ac:task-body>${x(a.task)}${meta ? ` — ${meta}` : ''}</ac:task-body></ac:task>`;
      }).join('')}</ac:task-list>`;
    }

    // Phase 2 : actions des réunions précédentes dont il a été question
    const followup = (s.action_followup || []).filter(f => f && f.task);
    if (followup.length) {
      h += `<h2>Suivi des actions précédentes</h2><ul>${followup.map(f =>
        `<li>${f.status === 'done' ? `${icon('tick')} Terminée` : `${icon('information')} En cours`} — ${x(f.task)}${f.assignee ? ` (${x(f.assignee)})` : ''}${f.note ? ` : ${x(f.note)}` : ''}</li>`).join('')}</ul>`;
    }

    const keyPoints = s.key_points || [];
    if (keyPoints.length) h += `<h2>Points clés</h2><ul>${keyPoints.map(k => `<li>${x(text(k))}</li>`).join('')}</ul>`;

    const transcription = Array.isArray(rec.transcription) ? rec.transcription : [];
    if (attachTranscript && transcription.length) {
      h += `<p>Transcription intégrale en pièce jointe : <ac:link><ri:attachment ri:filename="${x(transcriptFileName(rec))}" /></ac:link></p>`;
    }
    if (includeTranscript && transcription.length) {
      const lines = transcription.map(t => {
        const ts = multi ? `Piste ${t.file_index || 1} • ${t.timestamp || '00:00'}` : (t.timestamp || '00:00');
        return `<p><strong>[${x(ts)}] ${x(t.speaker || 'Orateur')} :</strong> ${x(t.text)}</p>`;
      }).join('');
      h += `<h2>Transcription</h2><ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Afficher la transcription intégrale</ac:parameter><ac:rich-text-body>${lines}</ac:rich-text-body></ac:structured-macro>`;
    }
    return h;
  }

  // Étiquette Confluence : minuscules, lettres et chiffres (accents compris), tirets ; ni emoji ni ponctuation
  const toLabel = t => String(t).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}_\s-]/gu, '').trim()
    .replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');

  function labelsFor(rec, series) {
    const tags = (rec.summary && rec.summary.tags) || [];
    const labels = tags.map(toLabel).filter(Boolean);
    const seriesLabel = series ? toLabel(series.name).slice(0, 60) : '';
    return [...new Set(['voxai', ...(seriesLabel ? [seriesLabel] : []), ...labels])].slice(0, 20);
  }

  // ============================================================================
  // Paramètres (section Confluence de la fenêtre ⚙️)
  // ============================================================================

  const $ = (id) => document.getElementById(id);

  function readSettings() {
    return {
      confluence_url: $('confluenceUrl').value.trim(),
      confluence_auth: $('confluenceAuth').value,
      confluence_email: $('confluenceEmail').value.trim(),
      confluence_token: $('confluenceToken').value.trim()
    };
  }

  function updateAuthUI() {
    $('confluenceEmailRow').classList.toggle('hidden', $('confluenceAuth').value !== 'basic');
    $('confluenceTokenLabel').textContent = $('confluenceAuth').value === 'basic'
      ? "Mot de passe (Data Center) ou jeton d'API (Cloud)" : "Jeton d'accès personnel (PAT)";
  }

  async function fillSettings(cfg) {
    $('confluenceUrl').value = cfg.confluence_url || '';
    $('confluenceAuth').value = cfg.confluence_auth || 'pat';
    $('confluenceEmail').value = cfg.confluence_email || '';
    $('confluenceToken').value = cfg.confluence_token || '';
    $('confluenceTestStatus').textContent = '';
    updateAuthUI();
    const proxy = await detectProxy();
    $('confluenceProxyNote').classList.toggle('hidden', !proxy);
  }

  async function testSettings() {
    const status = $('confluenceTestStatus');
    status.textContent = 'Test en cours...';
    status.className = 'text-[11px] text-amber-400 animate-pulse';
    try {
      const user = await api.currentUser(readSettings());
      status.textContent = `✓ Connecté en tant que ${user.displayName || user.username || user.publicName || 'utilisateur'}`;
      status.className = 'text-[11px] text-emerald-400 font-semibold';
    } catch (err) {
      status.textContent = '✗ ' + err.message;
      status.className = 'text-[11px] text-rose-400';
    }
  }

  // ============================================================================
  // Fenêtre de publication
  // ============================================================================

  const ui = {
    cfg: null,
    spaces: [],
    spaceKey: '',
    target: null, // null = racine de l'espace, sinon { id, title }
    searchTimer: null
  };

  function modal(show) {
    const m = $('confluenceModal');
    m.classList.toggle('hidden', !show);
    m.style.display = show ? 'flex' : 'none';
  }

  function setStatus(msg, kind = 'info') {
    const el = $('cfStatus');
    const colors = { info: 'text-slate-400', ok: 'text-emerald-400', err: 'text-rose-400', busy: 'text-amber-400 animate-pulse' };
    el.className = `text-[11px] min-h-[16px] ${colors[kind] || colors.info}`;
    el.innerHTML = msg;
  }

  function renderSpaces(filter = '') {
    const f = filter.trim().toLowerCase();
    const list = ui.spaces.filter(s => !f || s.name.toLowerCase().includes(f) || s.key.toLowerCase().includes(f));
    $('cfSpaceSelect').innerHTML = list.length
      ? list.map(s => `<option value="${escapeHtml(s.key)}">${escapeHtml(s.name)} (${escapeHtml(s.key)})${s.type === 'personal' ? ' — personnel' : ''}</option>`).join('')
      : '<option value="">Aucun espace trouvé</option>';
    if (list.some(s => s.key === ui.spaceKey)) $('cfSpaceSelect').value = ui.spaceKey;
  }

  function nodeHtml(p) {
    return `<li data-id="${escapeHtml(p.id)}">
      <div class="cf-node">
        <button type="button" class="cf-toggle" title="Afficher les sous-pages">▸</button>
        <button type="button" class="cf-select" data-id="${escapeHtml(p.id)}" data-title="${escapeHtml(p.title)}">📄 ${escapeHtml(p.title)}</button>
      </div>
      <ul class="cf-children hidden"></ul>
    </li>`;
  }

  function highlightTarget() {
    document.querySelectorAll('#cfTree .cf-select, #cfRootBtn').forEach(b => b.classList.remove('cf-selected'));
    const sel = ui.target
      ? document.querySelector(`#cfTree .cf-select[data-id="${CSS.escape(ui.target.id)}"]`)
      : $('cfRootBtn');
    if (sel) sel.classList.add('cf-selected');
    $('cfTargetLabel').textContent = ui.target ? `📄 ${ui.target.title}` : `📁 Racine de l'espace ${ui.spaceKey}`;
    const updateRadio = document.querySelector('input[name="cfAction"][value="update"]');
    updateRadio.disabled = !ui.target;
    $('cfUpdateLabel').classList.toggle('opacity-40', !ui.target);
    if (!ui.target && updateRadio.checked) document.querySelector('input[name="cfAction"][value="create"]').checked = true;
    updateActionUI();
  }

  function selectTarget(target) {
    ui.target = target;
    highlightTarget();
  }

  async function loadTree() {
    const tree = $('cfTree');
    tree.innerHTML = '<li class="text-[11px] text-slate-500 p-2">Chargement des pages…</li>';
    try {
      const pages = await api.rootPages(ui.cfg, ui.spaceKey);
      tree.innerHTML = pages.length ? pages.map(nodeHtml).join('') : '<li class="text-[11px] text-slate-500 p-2">Aucune page dans cet espace.</li>';
      highlightTarget();
    } catch (err) {
      tree.innerHTML = '';
      setStatus(escapeHtml(err.message), 'err');
    }
  }

  async function toggleNode(li) {
    const childrenEl = li.querySelector(':scope > .cf-children');
    const btn = li.querySelector(':scope > .cf-node > .cf-toggle');
    if (!childrenEl.classList.contains('hidden')) {
      childrenEl.classList.add('hidden');
      btn.textContent = '▸';
      return;
    }
    childrenEl.classList.remove('hidden');
    btn.textContent = '▾';
    if (childrenEl.dataset.loaded) return;
    childrenEl.innerHTML = '<li class="text-[11px] text-slate-500 pl-6 py-1">Chargement…</li>';
    try {
      const kids = await api.children(ui.cfg, li.dataset.id);
      childrenEl.dataset.loaded = '1';
      childrenEl.innerHTML = kids.length ? kids.map(nodeHtml).join('') : '<li class="text-[11px] text-slate-500 pl-6 py-1">Aucune sous-page</li>';
      highlightTarget();
    } catch (err) {
      childrenEl.innerHTML = `<li class="text-[11px] text-rose-400 pl-6 py-1">${escapeHtml(err.message)}</li>`;
    }
  }

  async function runSearch() {
    const q = $('cfSearch').value.trim();
    if (q.length < 2) {
      if (!$('cfTree').dataset.searching) return;
      delete $('cfTree').dataset.searching;
      return loadTree();
    }
    $('cfTree').dataset.searching = '1';
    $('cfTree').innerHTML = '<li class="text-[11px] text-slate-500 p-2">Recherche…</li>';
    try {
      const results = await api.search(ui.cfg, ui.spaceKey, q);
      $('cfTree').innerHTML = results.length ? results.map(nodeHtml).join('') : '<li class="text-[11px] text-slate-500 p-2">Aucune page ne correspond.</li>';
      highlightTarget();
    } catch (err) {
      setStatus(escapeHtml(err.message), 'err');
    }
  }

  async function changeSpace(key) {
    ui.spaceKey = key;
    $('cfSearch').value = '';
    delete $('cfTree').dataset.searching;
    const last = ui.cfg.confluence_last_parent;
    ui.target = (last && last.spaceKey === key) ? { id: last.id, title: last.title } : null;
    if (key) await loadTree();
  }

  function updateActionUI() {
    const action = (document.querySelector('input[name="cfAction"]:checked') || {}).value;
    $('cfCreateOptions').classList.toggle('hidden', action !== 'create');
    $('cfUpdateOptions').classList.toggle('hidden', action !== 'update');
    $('cfPublishBtn').textContent = ui.mode === 'pick' ? 'Choisir cette page'
      : (action === 'update' ? 'Mettre à jour la page' : 'Créer la page') + (ui.after ? ' puis créer l’e-mail' : '');
  }

  function seriesOf(rec) {
    return rec && rec.series_id && window.VoxSeries ? VoxSeries.get(rec.series_id) : null;
  }

  /**
   * Ouvre la fenêtre. Mode « publish » : publication du compte rendu ouvert (préremplie
   * depuis sa série). Mode « pick » : choix d'une page (page parente d'une série).
   */
  async function open({ pick = false, preset = null, after = null } = {}) {
    const rec = state.activeRecording;
    if (!pick && !rec) return;
    ui.mode = pick ? 'pick' : 'publish';
    // « Publier et envoyer » : action lancée une fois la page publiée (e-mail aux participants)
    ui.after = pick ? null : after;
    ui.cfg = state.config || {};
    const series = pick ? null : seriesOf(rec);
    const parent = pick ? preset : (series && series.confluence_parent);
    await detectProxy();
    $('cfModalTitle').textContent = pick ? 'Choisir la page Confluence de la série'
      : ui.after ? 'Publier dans Confluence, puis envoyer aux participants' : 'Publier le compte rendu dans Confluence';
    $('cfActionBlock').classList.toggle('hidden', pick);
    $('cfOptionsBlock').classList.toggle('hidden', pick);
    $('cfNotConfigured').classList.toggle('hidden', isConfigured(ui.cfg));
    $('cfMain').classList.toggle('hidden', !isConfigured(ui.cfg));
    $('cfPublishBtn').classList.toggle('hidden', !isConfigured(ui.cfg));
    $('cfNoSummary').classList.toggle('hidden', pick || !!rec.summary);
    if (!pick) {
      const date = new Date(rec.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      $('cfTitle').value = series ? `${series.name} — ${date}` : (rec.title || 'Compte rendu');
      document.querySelector('input[name="cfAction"][value="create"]').checked = true;
    }
    updateActionUI();
    setStatus(parent && !pick ? `Série « ${escapeHtml(series.name)} » : publication sous sa page « ${escapeHtml(parent.title || parent.id)} ».` : '');
    modal(true);
    if (!isConfigured(ui.cfg)) return;

    $('cfSpaceSelect').innerHTML = '<option>Chargement des espaces…</option>';
    try {
      ui.spaces = await api.spaces(ui.cfg);
      const preferred = parent ? parent.spaceKey : ui.cfg.confluence_last_space;
      ui.spaceKey = ui.spaces.some(s => s.key === preferred) ? preferred : (ui.spaces[0] && ui.spaces[0].key) || '';
      $('cfSpaceFilter').value = '';
      renderSpaces();
      await changeSpace(ui.spaceKey);
      if (parent && parent.spaceKey === ui.spaceKey) selectTarget({ id: parent.id, title: parent.title || parent.id });
      else if (parent && !pick) setStatus("La page de la série n'est plus accessible (espace introuvable) : choisissez un emplacement.", 'err');
    } catch (err) {
      $('cfSpaceSelect').innerHTML = '';
      setStatus(escapeHtml(err.message), 'err');
    }
  }

  /** Choix d'une page parente ; résout { spaceKey, id, title } ou null si la fenêtre est fermée. */
  function pickLocation(preset) {
    return new Promise(resolve => {
      ui.pickResolve = resolve;
      open({ pick: true, preset });
    });
  }

  async function publish() {
    if (ui.mode === 'pick') {
      if (!ui.target) { setStatus("Choisissez une page (pas la racine de l'espace).", 'err'); return; }
      const picked = { spaceKey: ui.spaceKey, id: ui.target.id, title: ui.target.title };
      const resolve = ui.pickResolve;
      ui.pickResolve = null;
      modal(false);
      if (resolve) resolve(picked);
      return;
    }
    const rec = state.activeRecording;
    if (!rec || !ui.spaceKey) return;
    const action = document.querySelector('input[name="cfAction"]:checked').value;
    const hasTranscript = Array.isArray(rec.transcription) && rec.transcription.length > 0;
    const attach = $('cfAttachTranscript').checked && hasTranscript;
    const storage = buildStorage(rec, { includeTranscript: $('cfIncludeTranscript').checked, attachTranscript: attach });
    const btn = $('cfPublishBtn');
    btn.disabled = true;
    setStatus('Publication en cours…', 'busy');
    try {
      let page;
      if (action === 'update') {
        if (!ui.target) throw new Error('Sélectionnez la page à mettre à jour.');
        const mode = document.querySelector('input[name="cfUpdateMode"]:checked').value;
        page = await api.updatePage(ui.cfg, { id: ui.target.id, storage, mode });
      } else {
        const title = $('cfTitle').value.trim();
        if (!title) throw new Error('Indiquez un titre pour la nouvelle page.');
        page = await api.createPage(ui.cfg, { spaceKey: ui.spaceKey, parentId: ui.target && ui.target.id, title, storage });
      }
      if ($('cfAddLabels').checked) {
        try { await api.addLabels(ui.cfg, page.id, labelsFor(rec, seriesOf(rec))); } catch (err) { console.warn('[Confluence] étiquettes', err); }
      }

      // Transcription en pièce jointe, puis vérification auprès de Confluence
      let attachNote = '';
      if (attach) {
        const name = transcriptFileName(rec);
        const blob = new Blob([transcriptText(rec)], { type: 'text/plain;charset=utf-8' });
        setStatus('Page publiée — envoi de la transcription en pièce jointe…', 'busy');
        try {
          await api.uploadAttachment(ui.cfg, page.id, name, blob, 'Transcription intégrale (VoxAI)');
          const [stored] = await api.attachments(ui.cfg, page.id, name);
          const size = stored && stored.extensions && stored.extensions.fileSize;
          if (!stored) throw new Error('fichier absent de la page après envoi');
          if (size != null && Number(size) !== blob.size) throw new Error(`taille reçue ${size} octets au lieu de ${blob.size}`);
          attachNote = `<br>📎 Transcription jointe et vérifiée : <strong>${escapeHtml(name)}</strong> (${formatBytes(blob.size)})`;
        } catch (err) {
          attachNote = `<br><span class="text-amber-300">⚠️ La page est publiée, mais la transcription n'a pas pu être jointe : ${escapeHtml(err.message)}. Republiez en « Mettre à jour la page » pour réessayer.</span>`;
        }
      }
      // Mémorise l'emplacement pour la prochaine publication
      const memo = { confluence_last_space: ui.spaceKey, confluence_last_parent: ui.target ? { ...ui.target, spaceKey: ui.spaceKey } : null };
      await fetch('/api/config', { method: 'POST', body: JSON.stringify(memo) });
      Object.assign(state.config, memo);

      const url = pageUrl(page);
      if (url) {
        // Lien repris dans l'e-mail aux participants
        await fetch(`/api/recordings/${rec.id}/confluence`, { method: 'POST', body: JSON.stringify({ url, title: page.title }) });
        rec.confluence_page = { url, title: page.title };
      }
      setStatus(`✓ Page ${action === 'update' ? 'mise à jour' : 'créée'} : <strong>${escapeHtml(page.title)}</strong>` +
        (url ? ` — <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="underline text-indigo-300">Ouvrir dans Confluence ↗</a>` : '') + attachNote, 'ok');
      showToast(action === 'update' ? 'Page Confluence mise à jour !' : 'Compte rendu publié dans Confluence !', '📘');
      if (ui.after) {
        const after = ui.after;
        ui.after = null;
        updateActionUI();
        // Outlook Web / Gmail s'ouvrent dans un onglet : après l'attente de la publication, le
        // navigateur peut le bloquer. On propose alors un bouton (nouveau clic de l'utilisateur).
        const next = after(rec);
        if (next) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.id = 'cfAfterBtn';
          btn.className = 'mt-2 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 transition';
          btn.textContent = next.label;
          btn.addEventListener('click', () => { modal(false); next.run(); }, { once: true });
          $('cfStatus').append(document.createElement('br'), btn);
        }
      }
    } catch (err) {
      setStatus(escapeHtml(err.message), 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function setup() {
    $('confluenceAuth').addEventListener('change', updateAuthUI);
    $('confluenceTestBtn').addEventListener('click', testSettings);

    $('publishConfluenceBtn').addEventListener('click', () => open());
    // Le bouton « Publier » ne doit pas hériter d'un « Publier et envoyer » interrompu
    $('cfCloseBtn').addEventListener('click', () => { ui.after = null; });
    $('cfCancelBtn').addEventListener('click', () => { ui.after = null; });
    const close = () => {
      if (!$('confluenceModal').classList.contains('hidden') || ui.pickResolve) modal(false);
      if (ui.pickResolve) { const r = ui.pickResolve; ui.pickResolve = null; r(null); }
    };
    $('cfCloseBtn').addEventListener('click', close);
    $('cfCancelBtn').addEventListener('click', close);
    $('confluenceModal').addEventListener('click', (e) => { if (e.target.id === 'confluenceModal') close(); });
    // Échap ne ferme que cette fenêtre (pas la fiche de série ouverte dessous) : événement marqué traité
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('confluenceModal').classList.contains('hidden')) { e.preventDefault(); close(); } });
    $('cfOpenSettingsBtn').addEventListener('click', () => { modal(false); openSettingsModal(); $('confluenceSettings').scrollIntoView({ block: 'start' }); });

    $('cfSpaceFilter').addEventListener('input', (e) => renderSpaces(e.target.value));
    $('cfSpaceSelect').addEventListener('change', (e) => changeSpace(e.target.value));
    $('cfRootBtn').addEventListener('click', () => selectTarget(null));
    $('cfTree').addEventListener('click', (e) => {
      const toggle = e.target.closest('.cf-toggle');
      if (toggle) return toggleNode(toggle.closest('li'));
      const sel = e.target.closest('.cf-select');
      if (sel) selectTarget({ id: sel.dataset.id, title: sel.dataset.title });
    });
    $('cfSearch').addEventListener('input', () => {
      clearTimeout(ui.searchTimer);
      ui.searchTimer = setTimeout(runSearch, 350);
    });
    document.querySelectorAll('input[name="cfAction"]').forEach(r => r.addEventListener('change', updateActionUI));
    $('cfPublishBtn').addEventListener('click', publish);
  }

  window.VoxConfluence = { readSettings, fillSettings, buildStorage, labelsFor, transcriptText, transcriptFileName, pickLocation, open, isConfigured: () => isConfigured(state.config || {}), api };
  document.addEventListener('DOMContentLoaded', setup);
})();
