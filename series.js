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
    const follow = $('seriesFollowBtn');
    if (follow) follow.classList.toggle('hidden', S.list.length === 0);
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
    // « Publier et envoyer » : série avec page Confluence et participants, Confluence configuré
    const both = $('publishSendBtn');
    if (both) {
      both.classList.toggle('hidden', !(series && series.confluence_parent && series.participants.length
        && window.VoxConfluence && VoxConfluence.isConfigured()));
    }
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
      lines.push('**Actions**', ...actions.map(a => `- ${a.status === 'done' ? '[fait] ' : ''}${a.task}${a.assignee ? ` — ${a.assignee}` : ''}${a.deadline ? ` (${deadlineInfo(a.deadline).long})` : ''}`), '');
    }
    const followup = (s.action_followup || []).filter(f => f && f.task);
    if (followup.length) {
      lines.push('**Suivi des actions précédentes**', ...followup.map(f =>
        `- ${f.status === 'done' ? '[terminée] ' : '[en cours] '}${f.task}${f.assignee ? ` — ${f.assignee}` : ''}${f.note ? ` : ${f.note}` : ''}`), '');
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

  // ==========================================================================
  // Phase 2 : suivi des actions d'une réunion à l'autre et brief avant réunion
  // ==========================================================================

  const F = { seriesId: '', data: null, tab: 'actions', followup: [] };
  const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const actionKey = (recId, task) => `${recId}\u0000${task}`;

  async function fetchActions(seriesId) {
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(seriesId)}/actions`);
      if (res.ok) return await res.json();
    } catch { /* base indisponible */ }
    return { meetings: [], actions: [] };
  }

  /** Clôture (ou rouvre) une action d'une réunion de la série, retrouvée par son texte si besoin. */
  async function setActionDone(a, done) {
    const res = await fetch(`/api/recordings/${encodeURIComponent(a.rec_id)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: a.index, task: a.task, done })
    });
    if (!res.ok) { showToast("Action introuvable : la synthèse d'origine a peut-être été modifiée.", '⚠️'); return false; }
    const { index } = await res.json();
    const rec = state.activeRecording;
    if (rec && rec.id === a.rec_id && rec.summary && rec.summary.action_items[index]) {
      rec.summary.action_items[index].status = done ? 'done' : 'todo';
      renderSummaryTab(rec.summary);
    }
    return true;
  }

  // --- Bloc « Suivi des actions précédentes » de la synthèse ------------------

  async function renderFollowup() {
    const card = $('followupCard');
    const rec = state.activeRecording;
    const items = (rec && rec.summary && Array.isArray(rec.summary.action_followup)) ? rec.summary.action_followup : [];
    if (!card) return;
    if (!items.length) { card.classList.add('hidden'); F.followup = []; return; }
    const shownId = rec.id;
    const current = new Map();
    if (rec.series_id) {
      for (const a of (await fetchActions(rec.series_id)).actions) current.set(actionKey(a.rec_id, a.task), a);
    }
    if (!state.activeRecording || state.activeRecording.id !== shownId) return; // autre enregistrement ouvert entre-temps
    F.followup = items.map(f => ({ ...f, source: current.get(actionKey(f.rec_id, f.task)) || null }));
    const toClose = F.followup.filter(f => f.status === 'done' && f.source && f.source.status !== 'done');
    $('followupList').innerHTML = F.followup.map((f, i) => {
      const closed = f.source && f.source.status === 'done';
      const badge = f.status === 'done'
        ? '<span class="follow-badge follow-badge-done">✅ Terminée selon la réunion</span>'
        : '<span class="follow-badge follow-badge-progress">🔄 En cours</span>';
      const origin = f.source ? `réunion du ${escapeHtml(fmtDate(f.source.meeting_date))}` : 'action d’origine introuvable';
      const action = closed
        ? '<span class="follow-badge follow-badge-closed">Clôturée</span>'
        : (f.source ? `<button type="button" class="followup-toggle shrink-0 px-2 py-1 rounded-lg text-[11px] font-semibold ${f.status === 'done' ? 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10'} transition" data-i="${i}">Clôturer</button>` : '');
      return `<div class="follow-row ${closed ? 'follow-done' : ''}">
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">${badge}<span class="follow-task font-medium">${escapeHtml(f.task)}</span>${refChips(f.refs)}</div>
            <div class="text-[11px] text-slate-400 mt-1">👤 ${escapeHtml(f.assignee || 'Non assigné')} · ${origin}${f.note ? ` — ${escapeHtml(f.note)}` : ''}</div>
          </div>
          ${action}
        </div>`;
    }).join('');
    const all = $('followupApplyAll');
    all.classList.toggle('hidden', toClose.length < 2);
    all.textContent = `Clôturer les ${toClose.length} actions terminées`;
    card.classList.remove('hidden');
  }

  async function closeFollowup(list) {
    let n = 0;
    for (const f of list) if (await setActionDone(f.source, true)) n++;
    if (n) showToast(n > 1 ? `${n} actions clôturées` : 'Action clôturée', '✅');
    renderFollowup();
  }

  // --- Fenêtre « Suivi de série » -------------------------------------------

  function followModal(show) {
    const m = $('followModal');
    m.classList.toggle('hidden', !show);
    m.style.display = show ? 'flex' : 'none';
    if (!show) $('seriesFollowBtn').focus();
  }

  async function openFollow(seriesId) {
    F.seriesId = get(seriesId) ? seriesId : (get(S.filter) ? S.filter : (get(recall()) ? recall() : (S.list[0] || {}).id || ''));
    if (!F.seriesId) { showToast('Créez d’abord une série de réunions', '🗂️'); return; }
    $('followSeries').innerHTML = S.list.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === F.seriesId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
    followModal(true);
    await loadFollow();
  }

  async function loadFollow() {
    F.data = await fetchActions(F.seriesId);
    renderFollowActions();
    renderBrief();
  }

  function followTab(tab) {
    F.tab = tab;
    for (const [btn, pane, name] of [['followTabActions', 'followPaneActions', 'actions'], ['followTabBrief', 'followPaneBrief', 'brief']]) {
      $(btn).classList.toggle('follow-tab-active', tab === name);
      $(btn).setAttribute('aria-selected', String(tab === name));
      $(pane).classList.toggle('hidden', tab !== name);
    }
  }

  function followupLine(f) {
    if (!f) return '';
    const label = f.status === 'done' ? '✅ signalée terminée' : '🔄 en cours';
    return `<div class="text-[11px] text-slate-400 mt-1">${label} le ${escapeHtml(fmtDate(f.meeting_date))}${f.note ? ` — ${escapeHtml(f.note)}` : ''}</div>`;
  }

  function renderFollowActions() {
    const { actions, meetings } = F.data;
    const showDone = $('followShowDone').checked;
    const open = actions.filter(a => a.status !== 'done');
    const late = open.filter(a => deadlineInfo(a.deadline, a.status).overdue).length;
    $('followOpenCount').textContent = `(${open.length}${late ? ` · ${late} en retard` : ''})`;
    const visible = showDone ? actions : open;
    if (!visible.length) {
      $('followActionsList').innerHTML = `<p class="text-xs text-slate-400 italic">${meetings.length ? 'Aucune action ouverte : tout est à jour 🎉' : 'Aucune réunion dans cette série pour l’instant.'}</p>`;
      return;
    }
    const groups = new Map();
    for (const a of visible) {
      if (!groups.has(a.rec_id)) groups.set(a.rec_id, []);
      groups.get(a.rec_id).push(a);
    }
    // Réunions de la plus récente à la plus ancienne
    $('followActionsList').innerHTML = [...groups.values()].reverse().map(list => `
      <section>
        <button type="button" class="follow-open-rec text-xs font-bold text-indigo-300 hover:underline mb-2 text-left" data-rec="${escapeHtml(list[0].rec_id)}">${escapeHtml(list[0].meeting_title)}${list[0].meeting_title.includes(fmtDate(list[0].meeting_date)) ? '' : ` <span class="font-normal text-slate-400">· ${escapeHtml(fmtDate(list[0].meeting_date))}</span>`}</button>
        <div class="space-y-1.5">
          ${list.map(a => `
            <label class="follow-row ${a.status === 'done' ? 'follow-done' : ''} cursor-pointer">
              <input type="checkbox" class="follow-check mt-0.5 accent-indigo-500" data-i="${actions.indexOf(a)}" ${a.status === 'done' ? 'checked' : ''}>
              <div class="flex-1 min-w-0 text-xs">
                <span class="follow-task text-slate-200">${escapeHtml(a.task)}</span>
                <div class="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-slate-400">
                  <span>👤 ${escapeHtml(a.assignee || 'Non assigné')}</span>
                  ${deadlineChips(a.deadline, a.status)}
                </div>
                ${followupLine(a.followup)}
              </div>
            </label>`).join('')}
        </div>
      </section>`).join('');
  }

  // --- Brief avant réunion ---------------------------------------------------

  /** Brief construit localement : rappel de la dernière réunion analysée + actions ouvertes par responsable. */
  function buildBrief(series, data) {
    const last = [...data.meetings].reverse().find(m => m.has_summary);
    const open = data.actions.filter(a => a.status !== 'done');
    const lines = ['Bonjour à tous,', '', `En préparation de la prochaine réunion « ${series.name} », voici où nous en sommes.`, ''];
    if (last) {
      const lastActions = data.actions.filter(a => a.rec_id === last.id);
      const rec = data.summaries && data.summaries[last.id];
      lines.push(`**Dernière réunion : ${fmtDate(last.date)}**`);
      if (rec && rec.executive) lines.push(rec.executive);
      if (rec && rec.decisions && rec.decisions.length) lines.push('', '**Décisions prises**', ...rec.decisions.map(d => `- ${d}`));
      if (!rec && lastActions.length) lines.push(`${lastActions.length} action(s) décidée(s).`);
      lines.push('');
    }
    if (open.length) {
      lines.push(`**Actions ouvertes (${open.length})**`);
      // En retard d'abord, puis par responsable, puis de la plus ancienne à la plus récente
      const owner = (a) => a.assignee || 'Non assigné';
      const late = (a) => (deadlineInfo(a.deadline, a.status).overdue ? 0 : 1);
      const sorted = [...open].sort((x, y) => late(x) - late(y) || owner(x).localeCompare(owner(y), 'fr') || x.meeting_date.localeCompare(y.meeting_date));
      const lateCount = open.filter(a => !late(a)).length;
      if (lateCount) lines.push(`⏰ ${lateCount} action(s) en retard.`);
      for (const a of sorted) {
        const d = deadlineInfo(a.deadline, a.status);
        const extra = [d.long ? `échéance ${d.long}${d.overdue ? ', EN RETARD' : ''}` : '', `décidée le ${fmtDate(a.meeting_date)}`,
          a.followup ? (a.followup.status === 'done' ? 'signalée terminée, à confirmer' : 'en cours') : ''].filter(Boolean).join(', ');
        lines.push(`- **${owner(a)}** : ${a.task} (${extra})`);
      }
      lines.push('', 'Merci de venir avec un point d’avancement sur vos actions.', '');
    } else {
      lines.push('Aucune action ouverte : tout est à jour.', '');
    }
    lines.push('Bonne journée,');
    return {
      subject: `Préparation — ${series.name}`,
      body: lines.join('\n'),
      to: series.participants.map(p => p.email).filter(Boolean)
    };
  }

  async function renderBrief() {
    const series = get(F.seriesId);
    if (!series) return;
    // Résumé et décisions de la dernière réunion analysée
    const last = [...F.data.meetings].reverse().find(m => m.has_summary);
    F.data.summaries = {};
    if (last) {
      try {
        const rec = await (await fetch(`/api/recordings/${encodeURIComponent(last.id)}`)).json();
        const s = rec.summary || {};
        F.data.summaries[last.id] = {
          executive: s.executive || '',
          decisions: (s.decisions || []).map(d => (d && typeof d === 'object') ? d.text : String(d || '')).filter(Boolean)
        };
      } catch { /* synthèse indisponible : le brief se limite aux actions */ }
    }
    F.brief = buildBrief(series, F.data);
    $('followBriefPreview').innerHTML = markdownToHtml(F.brief.body);
  }

  function sendBrief() {
    const series = get(F.seriesId);
    if (!series || !F.brief) return;
    if (!F.brief.to.length && !confirm('Aucun participant de la série n’a d’adresse e-mail.\n\nCréer l’e-mail sans destinataire ?')) return;
    openInMailClient(F.brief);
  }

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
    $('publishSendBtn').addEventListener('click', () => {
      const rec = state.activeRecording;
      if (!rec || !rec.summary) { showToast("Analysez d'abord l'enregistrement : le compte rendu est vide.", '⚠️'); return; }
      // L'e-mail part après la publication, avec le lien de la page qui vient d'être créée
      VoxConfluence.open({
        after: () => {
          const target = getMailTarget();
          // Onglet à ouvrir, ou e-mail trop long pour un lien mailto (copie du corps) : il faut un clic
          const rec2 = state.activeRecording, series = rec2 && get(rec2.series_id);
          const tooLong = target === 'mailto' && series && !mailtoUrl(buildParticipantsEmail(rec2, series)).bodyIncluded;
          if (target === 'web' || target === 'gmail' || tooLong) return { label: '✉️ Créer l’e-mail aux participants', run: sendToParticipants };
          sendToParticipants(); // Outlook (fichier .eml) ou messagerie par défaut : ouverture directe
          return null;
        }
      });
    });

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

    // Phase 2 : suivi des actions et brief avant réunion
    $('seriesFollowBtn').addEventListener('click', () => openFollow(S.filter));
    $('followCloseBtn').addEventListener('click', () => followModal(false));
    $('followModal').addEventListener('click', (e) => { if (e.target.id === 'followModal') followModal(false); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('followModal').classList.contains('hidden')) followModal(false);
    });
    $('followSeries').addEventListener('change', (e) => { F.seriesId = e.target.value; loadFollow(); });
    $('followTabActions').addEventListener('click', () => followTab('actions'));
    $('followTabBrief').addEventListener('click', () => followTab('brief'));
    $('followShowDone').addEventListener('change', renderFollowActions);
    $('followActionsList').addEventListener('change', async (e) => {
      const box = e.target.closest('.follow-check');
      if (!box) return;
      const a = F.data.actions[Number(box.dataset.i)];
      if (!a || !(await setActionDone(a, box.checked))) { box.checked = !box.checked; return; }
      a.status = box.checked ? 'done' : 'todo';
      renderFollowActions();
      renderBrief();
    });
    $('followActionsList').addEventListener('click', (e) => {
      const btn = e.target.closest('.follow-open-rec');
      if (!btn) return;
      followModal(false);
      selectRecording(btn.dataset.rec);
    });
    $('followBriefCopy').addEventListener('click', () => F.brief && copyRich(F.brief.body, 'Brief'));
    $('followBriefSend').addEventListener('click', sendBrief);
    $('followupList').addEventListener('click', (e) => {
      const btn = e.target.closest('.followup-toggle');
      if (!btn) return;
      const f = F.followup[Number(btn.dataset.i)];
      if (f && f.source) closeFollowup([f]);
    });
    $('followupApplyAll').addEventListener('click', () =>
      closeFollowup(F.followup.filter(f => f.status === 'done' && f.source && f.source.status !== 'done')));

    // Le détail d'un enregistrement change : on met à jour la série affichée
    document.addEventListener('voxai:recording-shown', renderDetail);
    reload();
  }

  window.VoxSeries = { reload, get, selectedId, defaultTitle, matchesFilter, buildParticipantsEmail, buildBrief, renderFollowup, list: () => S.list };
  document.addEventListener('voxai:config-loaded', setup, { once: true });
})();
