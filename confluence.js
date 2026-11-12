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
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: authHeader(cfg),
          'X-Atlassian-Token': 'no-check',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit'
      });
    } catch (err) {
      throw new Error(proxyEnabled
        ? `Confluence injoignable via le proxy du conteneur (${err.message}).`
        : `Confluence injoignable (${err.message}). Le serveur bloque probablement les appels venant de ${location.origin} (CORS) : utilisez l'image Docker avec CONFLUENCE_URL, ou demandez à l'administrateur d'autoriser cette origine.`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Accès refusé par Confluence (HTTP ${res.status}) : vérifiez le jeton et vos droits sur l'espace.`);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* réponse non JSON */ }
    if (!res.ok) {
      const msg = (data && (data.message || (data.data && data.data.errors && data.data.errors[0] && data.data.errors[0].message && data.data.errors[0].message.translation))) || text.slice(0, 300);
      throw new Error(`Confluence (HTTP ${res.status}) : ${msg}`);
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
        title,
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
        title: title || current.title,
        space: { key: current.space.key },
        version: { number: current.version.number + 1, message: 'Compte rendu publié par VoxAI' },
        body: { storage: { value, representation: 'storage' } }
      });
    },

    async addLabels(cfg, id, labels) {
      if (!labels.length) return;
      await request(cfg, 'POST', `/content/${enc(id)}/label`, labels.map(name => ({ prefix: 'global', name })));
    }
  };

  function pageUrl(page) {
    const links = (page && page._links) || {};
    return links.base && links.webui ? links.base + links.webui : '';
  }

  // ============================================================================
  // Mise en forme du compte rendu (format de stockage Confluence)
  // ============================================================================

  function x(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buildStorage(rec, { includeTranscript = true } = {}) {
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
        const meta = [a.assignee ? `👤 ${x(a.assignee)}` : '', a.deadline ? `📅 ${x(a.deadline)}` : ''].filter(Boolean).join(' — ');
        return `<ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>${x(a.task)}${meta ? ` — ${meta}` : ''}</ac:task-body></ac:task>`;
      }).join('')}</ac:task-list>`;
    }

    const keyPoints = s.key_points || [];
    if (keyPoints.length) h += `<h2>Points clés</h2><ul>${keyPoints.map(k => `<li>${x(text(k))}</li>`).join('')}</ul>`;

    const transcription = Array.isArray(rec.transcription) ? rec.transcription : [];
    if (includeTranscript && transcription.length) {
      const lines = transcription.map(t => {
        const ts = multi ? `Piste ${t.file_index || 1} • ${t.timestamp || '00:00'}` : (t.timestamp || '00:00');
        return `<p><strong>[${x(ts)}] ${x(t.speaker || 'Orateur')} :</strong> ${x(t.text)}</p>`;
      }).join('');
      h += `<h2>Transcription</h2><ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Afficher la transcription intégrale</ac:parameter><ac:rich-text-body>${lines}</ac:rich-text-body></ac:structured-macro>`;
    }
    return h;
  }

  function labelsFor(rec) {
    const tags = (rec.summary && rec.summary.tags) || [];
    const labels = tags
      .map(t => String(t).toLowerCase().normalize('NFC').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, ''))
      .filter(Boolean);
    return [...new Set(['voxai', ...labels])].slice(0, 20);
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
      ? "Jeton d'API Atlassian" : "Jeton d'accès personnel (PAT)";
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
    $('cfPublishBtn').textContent = action === 'update' ? 'Mettre à jour la page' : 'Créer la page';
  }

  async function open() {
    const rec = state.activeRecording;
    if (!rec) return;
    ui.cfg = state.config || {};
    await detectProxy();
    $('cfNotConfigured').classList.toggle('hidden', isConfigured(ui.cfg));
    $('cfMain').classList.toggle('hidden', !isConfigured(ui.cfg));
    $('cfPublishBtn').classList.toggle('hidden', !isConfigured(ui.cfg));
    $('cfNoSummary').classList.toggle('hidden', !!rec.summary);
    $('cfTitle').value = rec.title || 'Compte rendu';
    document.querySelector('input[name="cfAction"][value="create"]').checked = true;
    updateActionUI();
    setStatus('');
    modal(true);
    if (!isConfigured(ui.cfg)) return;

    $('cfSpaceSelect').innerHTML = '<option>Chargement des espaces…</option>';
    try {
      ui.spaces = await api.spaces(ui.cfg);
      const lastKey = ui.cfg.confluence_last_space;
      ui.spaceKey = ui.spaces.some(s => s.key === lastKey) ? lastKey : (ui.spaces[0] && ui.spaces[0].key) || '';
      $('cfSpaceFilter').value = '';
      renderSpaces();
      await changeSpace(ui.spaceKey);
    } catch (err) {
      $('cfSpaceSelect').innerHTML = '';
      setStatus(escapeHtml(err.message), 'err');
    }
  }

  async function publish() {
    const rec = state.activeRecording;
    if (!rec || !ui.spaceKey) return;
    const action = document.querySelector('input[name="cfAction"]:checked').value;
    const storage = buildStorage(rec, { includeTranscript: $('cfIncludeTranscript').checked });
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
        try { await api.addLabels(ui.cfg, page.id, labelsFor(rec)); } catch (err) { console.warn('[Confluence] étiquettes', err); }
      }
      // Mémorise l'emplacement pour la prochaine publication
      const memo = { confluence_last_space: ui.spaceKey, confluence_last_parent: ui.target ? { ...ui.target, spaceKey: ui.spaceKey } : null };
      await fetch('/api/config', { method: 'POST', body: JSON.stringify(memo) });
      Object.assign(state.config, memo);

      const url = pageUrl(page);
      setStatus(`✓ Page ${action === 'update' ? 'mise à jour' : 'créée'} : <strong>${escapeHtml(page.title)}</strong>` +
        (url ? ` — <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="underline text-indigo-300">Ouvrir dans Confluence ↗</a>` : ''), 'ok');
      showToast(action === 'update' ? 'Page Confluence mise à jour !' : 'Compte rendu publié dans Confluence !', '📘');
    } catch (err) {
      setStatus(escapeHtml(err.message), 'err');
    } finally {
      btn.disabled = false;
    }
  }

  function setup() {
    $('confluenceAuth').addEventListener('change', updateAuthUI);
    $('confluenceTestBtn').addEventListener('click', testSettings);

    $('publishConfluenceBtn').addEventListener('click', open);
    $('cfCloseBtn').addEventListener('click', () => modal(false));
    $('cfCancelBtn').addEventListener('click', () => modal(false));
    $('confluenceModal').addEventListener('click', (e) => { if (e.target.id === 'confluenceModal') modal(false); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal(false); });
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

  window.VoxConfluence = { readSettings, fillSettings, buildStorage, labelsFor, api };
  document.addEventListener('DOMContentLoaded', setup);
})();
