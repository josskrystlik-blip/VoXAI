/**
 * VoxAI - Séries de réunions (phase 1, version A).
 *
 * Une série regroupe les enregistrements d'une réunion récurrente (« Point projet Alpha »),
 * ses participants (noms, e-mails, alias) et sa page Confluence parente. Elle permet à la
 * personne désignée de tout faire en deux clics après la réunion : publication sous la page
 * de la série, puis e-mail aux participants avec les destinataires préremplis.
 *
 * Toutes les données restent dans la base locale du navigateur (routes /api/series de db.js).
 */
(function () {
  'use strict';

  const LAST_KEY = 'voxai_last_series';
  const TYPES = { weekly: 'Point d’équipe hebdo', steering: 'Comité de pilotage', other: 'Autre' };
  const $ = (id) => document.getElementById(id);

  const S = { list: [], filter: '', editing: null };

  const remember = (id) => { try { localStorage.setItem(LAST_KEY, id || ''); } catch { /* indisponible */ } };
  const recall = () => { try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; } };
  const get = (id) => S.list.find(s => s.id === id) || null;

  async function reload() {
    try { S.list = await (await fetch('/api/series')).json(); } catch { S.list = []; }
    renderSelectors();
    return S.list;
  }

  // ==========================================================================
  // Sélecteurs : écran d'enregistrement, filtre de la liste, page d'un enregistrement
  // ==========================================================================

  const options = (selected, emptyLabel) =>
    `<option value="">${escapeHtml(emptyLabel)}</option>` +
    S.list.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === selected ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');

  function renderSelectors() {
    const rec = $('seriesSelect');
    if (rec) {
      const current = rec.value || recall();
      rec.innerHTML = options(get(current) ? current : '', 'Sans série') + '<option value="__new__">＋ Nouvelle série…</option>';
    }
    const filter = $('seriesFilter');
    if (filter) {
      filter.innerHTML = `<option value="">Toutes les séries</option><option value="__none__" ${S.filter === '__none__' ? 'selected' : ''}>Hors série</option>` +
        S.list.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === S.filter ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
      filter.classList.toggle('hidden', S.list.length === 0);
    }
    renderDetail();
  }

  function selectedId() {
    const v = ($('seriesSelect') || {}).value || '';
    return get(v) ? v : '';
  }

  /** Titre proposé : « <série> — <date> » quand une série est choisie. */
  function defaultTitle() {
    const s = get(selectedId());
    return s ? `${s.name} — ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : '';
  }

  function matchesFilter(rec) {
    if (!S.filter) return true;
    if (S.filter === '__none__') return !rec.series_id;
    return rec.series_id === S.filter;
  }

  /** Page d'un enregistrement : série rattachée + bouton « Envoyer aux participants ». */
  function renderDetail() {
    const rec = state.activeRecording;
    const sel = $('detailSeriesSelect');
    if (!sel || !rec) return;
    sel.innerHTML = options(rec.series_id || '', 'Sans série');
    const series = get(rec.series_id);
    const send = $('sendParticipantsBtn');
    send.classList.toggle('hidden', !series || series.participants.length === 0);
    if (series) send.title = `Envoyer le compte rendu aux ${series.participants.length} participant(s) de « ${series.name} »`;
  }

  // ==========================================================================
  // E-mail aux participants (S5)
  // ==========================================================================

  function buildParticipantsEmail(rec, series) {
    const s = rec.summary || {};
    const text = (i) => (i && typeof i === 'object') ? (i.text || '') : String(i ?? '');
    const date = new Date(rec.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const lines = ['Bonjour à tous,', '', `Voici le compte rendu de la réunion « ${series.name} » du ${date}.`, ''];
    if (s.executive) lines.push('**Résumé**', s.executive, '');
    const decisions = (s.decisions || []).map(text).filter(Boolean);
    if (decisions.length) lines.push('**Décisions**', ...decisions.map(d => `- ${d}`), '');
    const actions = (s.action_items || []).filter(a => a && a.task);
    if (actions.length) {
      lines.push('**Actions**', ...actions.map(a => `- ${a.status === 'done' ? '[fait] ' : ''}${a.task}${a.assignee ? ` — ${a.assignee}` : ''}${a.deadline ? ` (${a.deadline})` : ''}`), '');
    }
    if (rec.confluence_page && rec.confluence_page.url) lines.push(`Compte rendu complet : ${rec.confluence_page.url}`, '');
    lines.push('Bonne journée,');
    return {
      subject: `Compte rendu — ${series.name} — ${date}`,
      body: lines.join('\n'),
      to: series.participants.map(p => p.email).filter(Boolean)
    };
  }

  function sendToParticipants() {
    const rec = state.activeRecording;
    const series = rec && get(rec.series_id);
    if (!series) return;
    if (!rec.summary) { showToast("Analysez d'abord l'enregistrement : le compte rendu est vide.", '⚠️'); return; }
    const missing = series.participants.filter(p => !p.email).map(p => p.name);
    if (missing.length && !confirm(`Sans adresse e-mail, non destinataires : ${missing.join(', ')}.\n\nCréer l'e-mail quand même ? (Ajoutez leurs adresses dans la série pour la prochaine fois.)`)) return;
    if (!rec.confluence_page) showToast("Astuce : publiez d'abord dans Confluence pour ajouter le lien dans l'e-mail.", '📘');
    openInMailClient(buildParticipantsEmail(rec, series));
  }

  // ==========================================================================
  // Fenêtre de gestion des séries (S1)
  // ==========================================================================

  function modal(show) {
    const m = $('seriesModal');
    m.classList.toggle('hidden', !show);
    m.style.display = show ? 'flex' : 'none';
  }

  function renderList() {
    const list = $('seriesList');
    list.innerHTML = S.list.length
      ? S.list.map(s => `<button type="button" class="series-item ${S.editing && S.editing.id === s.id ? 'series-item-active' : ''}" data-id="${escapeHtml(s.id)}">
          <span class="font-semibold">${escapeHtml(s.name)}</span>
          <span class="text-[11px] text-slate-400">${escapeHtml(TYPES[s.type] || '')} · ${s.participants.length} participant(s)${s.confluence_parent ? ' · 📘' : ''}</span>
        </button>`).join('')
      : '<p class="text-[11px] text-slate-500 p-2">Aucune série pour l’instant.</p>';
  }

  function participantRow(p = { name: '', email: '', aliases: [] }) {
    const row = document.createElement('div');
    row.className = 'series-participant flex gap-2 items-center';
    row.innerHTML = `
      <input type="text" class="sp-name flex-1 min-w-0 bg-slate-900/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500" placeholder="Nom" maxlength="120">
      <input type="email" class="sp-email flex-1 min-w-0 bg-slate-900/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500" placeholder="prenom.nom@entreprise.fr" maxlength="254">
      <button type="button" class="sp-remove p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5 transition text-xs" title="Retirer ce participant">✕</button>`;
    row.querySelector('.sp-name').value = p.name;
    row.querySelector('.sp-email').value = p.email;
    row.dataset.aliases = JSON.stringify(p.aliases || []);
    row.querySelector('.sp-remove').addEventListener('click', () => row.remove());
    return row;
  }

  function renderParent() {
    const p = S.editing && S.editing.confluence_parent;
    $('seriesParentLabel').textContent = p ? `${p.title || p.id} (espace ${p.spaceKey})` : 'Aucune — choix à chaque publication';
    $('seriesParentClear').classList.toggle('hidden', !p);
  }

  function edit(series) {
    S.editing = series ? JSON.parse(JSON.stringify(series)) : { id: null, name: '', type: 'weekly', participants: [], confluence_parent: null };
    $('seriesFormTitle').textContent = series ? `Modifier « ${series.name} »` : 'Nouvelle série';
    $('seriesName').value = S.editing.name;
    $('seriesType').value = S.editing.type;
    const box = $('seriesParticipants');
    box.innerHTML = '';
    (S.editing.participants.length ? S.editing.participants : [undefined]).forEach(p => box.appendChild(participantRow(p)));
    $('seriesDeleteBtn').classList.toggle('hidden', !series);
    $('seriesFormStatus').textContent = '';
    renderParent();
    renderList();
    $('seriesForm').classList.remove('hidden');
    $('seriesName').focus();
  }

  function readForm() {
    const participants = [...document.querySelectorAll('#seriesParticipants .series-participant')].map(row => ({
      name: row.querySelector('.sp-name').value.trim(),
      email: row.querySelector('.sp-email').value.trim(),
      aliases: JSON.parse(row.dataset.aliases || '[]')
    })).filter(p => p.name || p.email);
    return { name: $('seriesName').value.trim(), type: $('seriesType').value, participants, confluence_parent: S.editing.confluence_parent };
  }

  async function save() {
    const data = readForm();
    const status = $('seriesFormStatus');
    status.className = 'text-[11px] text-rose-400';
    if (!data.name) { status.textContent = 'Le nom de la série est obligatoire.'; return; }
    const noName = data.participants.filter(p => !p.name);
    if (noName.length) { status.textContent = 'Chaque participant doit avoir un nom.'; return; }
    const badEmail = data.participants.filter(p => p.email && !RECIPIENT_RE.test(p.email));
    if (badEmail.length) { status.textContent = `Adresse invalide : ${badEmail.map(p => p.email).join(', ')}`; return; }
    const names = data.participants.map(p => p.name.toLowerCase());
    if (new Set(names).size !== names.length) { status.textContent = 'Deux participants portent le même nom.'; return; }
    const res = await fetch(S.editing.id ? `/api/series/${encodeURIComponent(S.editing.id)}` : '/api/series', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const saved = await res.json();
    if (!res.ok) { status.textContent = saved.error || 'Enregistrement impossible.'; return; }
    await reload();
    if (!S.editing.id && $('seriesSelect')) { $('seriesSelect').value = saved.id; remember(saved.id); }
    S.editing = saved;
    edit(saved);
    status.className = 'text-[11px] text-emerald-400';
    status.textContent = '✓ Série enregistrée';
    showToast(`Série « ${saved.name} » enregistrée`, '🗂️');
  }

  async function remove() {
    if (!S.editing || !S.editing.id) return;
    if (!confirm(`Supprimer la série « ${S.editing.name} » ?\n\nSes enregistrements sont conservés (ils deviennent « sans série »).`)) return;
    await fetch(`/api/series/${encodeURIComponent(S.editing.id)}`, { method: 'DELETE' });
    if (S.filter === S.editing.id) S.filter = '';
    S.editing = null;
    $('seriesForm').classList.add('hidden');
    await reload();
    await loadRecordings();
    if (state.activeRecording) {
      state.activeRecording.series_id = (await (await fetch(`/api/recordings/${state.activeRecording.id}`)).json()).series_id || null;
      renderDetail();
    }
    renderList();
    showToast('Série supprimée, enregistrements conservés', '🗑️');
  }

  async function openManager(seriesId) {
    await reload();
    modal(true);
    if (seriesId === '__new__') edit(null);
    else if (get(seriesId)) edit(get(seriesId));
    else { S.editing = null; $('seriesForm').classList.add('hidden'); renderList(); }
  }

  // ==========================================================================
  // Mise en place
  // ==========================================================================

  function setup() {
    const recSel = $('seriesSelect');
    recSel.addEventListener('change', () => {
      if (recSel.value === '__new__') { recSel.value = ''; openManager('__new__'); return; }
      remember(recSel.value);
    });
    $('seriesFilter').addEventListener('change', (e) => { S.filter = e.target.value; renderRecordingsList(); });
    $('seriesManageBtn').addEventListener('click', () => openManager());
    $('detailSeriesSelect').addEventListener('change', async (e) => {
      const rec = state.activeRecording;
      if (!rec) return;
      const res = await fetch(`/api/recordings/${rec.id}/series`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series_id: e.target.value || null })
      });
      if (!res.ok) { showToast('Rattachement impossible', '⚠️'); renderDetail(); return; }
      rec.series_id = e.target.value || null;
      renderDetail();
      loadRecordings();
      showToast(rec.series_id ? `Rattaché à « ${get(rec.series_id).name} »` : 'Détaché de la série', '🗂️');
    });
    $('sendParticipantsBtn').addEventListener('click', sendToParticipants);

    $('seriesCloseBtn').addEventListener('click', () => modal(false));
    $('seriesModal').addEventListener('click', (e) => { if (e.target.id === 'seriesModal') modal(false); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('seriesModal').classList.contains('hidden') && $('confluenceModal').classList.contains('hidden')) modal(false);
    });
    $('seriesNewBtn').addEventListener('click', () => edit(null));
    $('seriesList').addEventListener('click', (e) => {
      const item = e.target.closest('.series-item');
      if (item) edit(get(item.dataset.id));
    });
    $('seriesAddParticipant').addEventListener('click', () => {
      const row = participantRow();
      $('seriesParticipants').appendChild(row);
      row.querySelector('.sp-name').focus();
    });
    $('seriesSaveBtn').addEventListener('click', save);
    $('seriesDeleteBtn').addEventListener('click', remove);
    $('seriesParentPick').addEventListener('click', async () => {
      if (!window.VoxConfluence || !VoxConfluence.isConfigured()) {
        showToast('Configurez d’abord Confluence (⚙️ Paramètres)', '📘');
        return;
      }
      const picked = await VoxConfluence.pickLocation(S.editing.confluence_parent);
      if (picked) { S.editing.confluence_parent = picked; renderParent(); }
    });
    $('seriesParentClear').addEventListener('click', () => { S.editing.confluence_parent = null; renderParent(); });

    // Le détail d'un enregistrement change : on met à jour la série affichée
    document.addEventListener('voxai:recording-shown', renderDetail);
    reload();
  }

  window.VoxSeries = { reload, get, selectedId, defaultTitle, matchesFilter, buildParticipantsEmail, list: () => S.list };
  document.addEventListener('voxai:config-loaded', setup, { once: true });
})();
