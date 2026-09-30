/* ============================================================
   extras.js — Kanban board, statistics, settings, backup.
   ============================================================ */
(function (global) {
  'use strict';
  const App = global.App;
  const { t } = I18N;
  const S = App.state;
  const { $, $$, esc, icon, toast, dueInfo, isOpen, isSnoozed, avatarColor, initials, fmtRelDay } = App;

  /* ---------- board ---------- */
  function renderBoard() {
    const root = $('#board'); if (!root) return;
    const cols = ['todo', 'drafting', 'replied', 'awaiting'];
    const q = S.search.trim().toLowerCase();
    const emails = S.emails.filter(e => !q || [e.subject, e.from.name, e.from.address].join(' ').toLowerCase().includes(q));
    root.innerHTML = cols.map(st => {
      const list = emails.filter(e => e.status === st).sort((a, b) => App.prioRank(a.priority) - App.prioRank(b.priority) || (new Date(a.dueAt || 8e15) - new Date(b.dueAt || 8e15)));
      return `<div class="col" data-col="${st}"><div class="col-head"><span class="dot" style="background:var(--s-${st})"></span>${t('status_' + st)}<span class="cnt">${list.length}</span></div>
        <div class="col-body">${list.map(e => { const di = dueInfo(e); return `<div class="kcard p${e.priority}" draggable="true" data-id="${e.id}"><div class="ks" dir="auto">${esc(e.subject || t('no_subject'))}</div><div class="kf" dir="auto">${esc(e.from.name || e.from.address)}</div><div class="kr"><span class="pill p${e.priority}" title="${esc(App.prioName(e.priority))}">${App.prioShort(e.priority)}</span><span class="due ${di.cls}" data-due-for="${e.id}">${icon(di.icon, 'sm')}<span>${esc(di.text)}</span></span></div></div>`; }).join('')}</div></div>`;
    }).join('');
    $$('.kcard', root).forEach(card => {
      card.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('application/x-em-card', card.dataset.id); ev.dataTransfer.setData('text/plain', card.dataset.id); ev.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('click', () => { App.showView('inbox'); S.filter = 'all'; App.renderFilters(); App.select(card.dataset.id); });
    });
    $$('.col', root).forEach(col => {
      col.addEventListener('dragover', (ev) => { if (Array.from(ev.dataTransfer.types).includes('application/x-em-card')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; col.classList.add('over'); } });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', (ev) => { const id = ev.dataTransfer.getData('application/x-em-card'); if (!id) return; ev.preventDefault(); ev.stopPropagation(); col.classList.remove('over'); const e = App.getEmail(id); if (e) App.setStatus(e, col.dataset.col); });
    });
  }
  App.renderBoard = renderBoard;

  /* ---------- statistics ---------- */
  function renderStats() {
    const root = $('#stats'); if (!root) return;
    const all = S.emails;
    if (!all.length) { root.innerHTML = `<div class="list-empty">${icon('chart', 'lg')}<h3>${t('nav_stats')}</h3><p>${t('stats_empty')}</p></div>`; return; }
    const now = new Date(); const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const open = all.filter(e => isOpen(e) && !isSnoozed(e));
    const overdue = open.filter(e => e.dueAt && new Date(e.dueAt) < now);
    const dueToday = open.filter(e => e.dueAt && new Date(e.dueAt) <= todayEnd && new Date(e.dueAt) >= now);
    const replied = all.filter(e => e.status === 'replied' && e.repliedAt);
    const onTime = replied.filter(e => !e.dueAt || new Date(e.repliedAt) <= new Date(e.dueAt));
    const avgMs = replied.length ? replied.reduce((s, e) => s + Math.max(0, new Date(e.repliedAt) - new Date(e.date || e.addedAt)), 0) / replied.length : 0;
    const avgTxt = replied.length ? (avgMs < 3600e3 ? Math.round(avgMs / 60000) + ' ' + t('minutes_short') : avgMs < 86400e3 ? (avgMs / 3600e3).toFixed(1) + ' ' + t('hours_short') : (avgMs / 86400e3).toFixed(1) + ' ' + t('days_short')) : '—';
    const levels = App.prios();
    const byP = levels.map(l => open.filter(e => String(e.priority) === String(l.id)).length);
    const byS = ['todo', 'drafting', 'replied', 'awaiting'].map(s => all.filter(e => e.status === s).length);
    const senders = {};
    all.forEach(e => { const k = e.from.address || e.from.name || '?'; senders[k] = senders[k] || { name: e.from.name || e.from.address, n: 0, replied: 0 }; senders[k].n++; if (e.status === 'replied') senders[k].replied++; });
    const top = Object.values(senders).sort((a, b) => b.n - a.n).slice(0, 6);
    // replies per week (last 8 weeks)
    const weeks = [];
    for (let i = 7; i >= 0; i--) { const start = new Date(now); start.setDate(start.getDate() - start.getDay() - i * 7); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 7); weeks.push({ start, end, n: replied.filter(e => { const d = new Date(e.repliedAt); return d >= start && d < end; }).length }); }
    const maxW = Math.max(1, ...weeks.map(w => w.n));
    const bar = (label, v, max, color) => `<div class="bar-row"><span class="lbl" dir="auto">${esc(label)}</span><div class="track"><div class="fill" style="width:${max ? Math.round(v / max * 100) : 0}%;background:${color}"></div></div><span class="val">${v}</span></div>`;
    root.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="v">${all.length}</div><div class="l">${t('stats_total')}</div></div>
        <div class="kpi primary"><div class="v">${open.length}</div><div class="l">${t('stats_open')}</div></div>
        <div class="kpi danger"><div class="v">${overdue.length}</div><div class="l">${t('stats_overdue')}</div></div>
        <div class="kpi"><div class="v">${dueToday.length}</div><div class="l">${t('stats_due_today')}</div></div>
        <div class="kpi success"><div class="v">${replied.length}</div><div class="l">${t('stats_replied')}</div></div>
        <div class="kpi"><div class="v">${replied.length ? Math.round(onTime.length / replied.length * 100) + '%' : '—'}</div><div class="l">${t('stats_on_time')}</div></div>
        <div class="kpi"><div class="v">${avgTxt}</div><div class="l">${t('stats_avg')}</div></div>
        <div class="kpi"><div class="v">${all.filter(e => e.status === 'awaiting').length}</div><div class="l">${t('status_awaiting')}</div></div>
      </div>
      <div class="stats-grid">
        <div class="card"><div class="card-head"><h3>${icon('flag')}${t('stats_by_priority')}</h3></div><div class="card-body bars">${levels.map((l, i) => bar(App.prioName(l.id), byP[i], Math.max(1, ...byP), l.color)).join('')}</div></div>
        <div class="card"><div class="card-head"><h3>${icon('board')}${t('stats_by_status')}</h3></div><div class="card-body bars">${['todo', 'drafting', 'replied', 'awaiting'].map((s, i) => bar(t('status_' + s), byS[i], Math.max(1, ...byS), `var(--s-${s})`)).join('')}</div></div>
        <div class="card"><div class="card-head"><h3>${icon('user')}${t('stats_top_senders')}</h3></div><div class="card-body bars">${top.map(s => bar(s.name, s.n, top[0].n, 'var(--accent)')).join('')}</div></div>
        <div class="card"><div class="card-head"><h3>${icon('chart')}${t('stats_last_weeks')}</h3></div><div class="card-body"><div class="cols-chart">${weeks.map(w => `<div class="c"><div class="b" style="height:${Math.round(w.n / maxW * 100)}%"><span>${w.n || ''}</span></div><div class="x">${new Intl.DateTimeFormat(App.locale(), { day: 'numeric', month: 'short' }).format(w.start)}</div></div>`).join('')}</div></div></div>
      </div>`;
  }
  App.renderStats = renderStats;

  /* ---------- settings ---------- */
  function renderSettings() {
    const root = $('#settings'); if (!root) return;
    const s = S.settings; const ai = s.ai || {};
    const notifState = !('Notification' in window) ? 'unsupported' : Notification.permission === 'granted' && s.notifications ? 'enabled' : Notification.permission === 'denied' ? 'blocked' : 'off';
    root.innerHTML = `<div class="settings-grid">
      <div class="card"><div class="card-head"><h3>${icon('settings')}${t('settings_general')}</h3></div><div class="card-body form">
        <div class="form-row">
          <div class="field"><label>${t('settings_language')}</label><select class="input" data-set="lang"><option value="en" ${s.lang === 'en' ? 'selected' : ''}>English</option><option value="ar" ${s.lang === 'ar' ? 'selected' : ''}>العربية</option></select></div>
          <div class="field"><label>${t('settings_theme')}</label><select class="input" data-set="theme">${['system', 'light', 'dark'].map(x => `<option value="${x}" ${s.theme === x ? 'selected' : ''}>${t('theme_' + x)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>${t('settings_notifications')}</label>
          <div class="status-line ${notifState === 'enabled' ? 'ok' : notifState === 'blocked' ? 'bad' : ''}">${icon('bell', 'sm')}<span>${notifState === 'enabled' ? t('notifications_enabled') : notifState === 'blocked' ? t('notifications_blocked') : notifState === 'unsupported' ? t('notifications_unsupported') : ''}</span>${notifState === 'off' || notifState === 'enabled' ? `<label class="switch" style="margin-inline-start:auto"><input type="checkbox" id="notifToggle" ${s.notifications && Notification.permission === 'granted' ? 'checked' : ''}><span>${t('enable_notifications')}</span></label>` : ''}</div></div>
        <div class="field"><label>${t('settings_reminder')}</label><select class="input" data-set="reminderMinutes">${[15, 30, 60, 120, 240, 1440].map(m => `<option value="${m}" ${+s.reminderMinutes === m ? 'selected' : ''}>${m < 60 ? t('t_minutes', { n: m }) : t('t_hours', { n: m / 60 })}</option>`).join('')}</select></div>
        <div class="kbd-help">${t('kb_help')}</div>
      </div></div>

      <div class="card"><div class="card-head"><h3>${icon('user')}${t('settings_profile')}</h3></div><div class="card-body form">
        <div class="field"><label>${t('settings_name')}</label><input class="input" data-set="myName" value="${esc(s.myName)}"></div>
        <div class="field"><label>${t('settings_role')}</label><input class="input" data-set="myRole" value="${esc(s.myRole)}"></div>
        <div class="field"><label>${t('settings_signature')}</label><textarea class="textarea" data-set="signature" style="min-height:80px">${esc(s.signature)}</textarea><span class="hint">${t('default_signature_hint')}</span></div>
        <div class="field"><label>${t('settings_office_hours')}</label><input class="input" data-set="officeHours" value="${esc(s.officeHours)}"></div>
        <div class="field"><label>${t('settings_my_addresses')}</label><textarea class="textarea" data-set-list="myAddresses" style="min-height:64px">${esc((s.myAddresses || []).join('\n'))}</textarea></div>
      </div></div>

      <div class="card"><div class="card-head"><h3>${icon('flag')}${t('settings_priority')}</h3></div><div class="card-body form">
        <div class="field"><label>${t('settings_vip')}</label><textarea class="textarea" data-set-list="vipSenders" style="min-height:90px">${esc((s.vipSenders || []).join('\n'))}</textarea></div>
        <div class="field"><label>${t('settings_keywords')}</label><textarea class="textarea" data-set-list="customKeywords" style="min-height:70px">${esc((s.customKeywords || []).join('\n'))}</textarea></div>
      </div></div>

      <div class="card wide"><div class="card-head"><div><h3>${icon('flag')}${t('settings_levels')}</h3><div class="sub">${t('settings_levels_help')}</div></div><span class="spacer"></span><button class="btn sm" id="lvlAdd">${icon('plus', 'sm')}${t('add_level')}</button><button class="btn sm btn-ghost" id="lvlReset">${icon('refresh', 'sm')}${t('reset_levels')}</button></div>
        <div class="card-body"><div class="levels" id="levels">${renderLevelRows()}</div></div></div>

      <div class="card"><div class="card-head"><div><h3>${icon('sparkles')}${t('settings_ai')}</h3><div class="sub">${t('settings_ai_help')}</div></div></div><div class="card-body form">
        <div class="form-row">
          <div class="field"><label>${t('settings_ai_provider')}</label><select class="input" data-ai="provider">${Object.keys(Engine.AI_DEFAULTS).map(p => `<option value="${p}" ${ai.provider === p ? 'selected' : ''}>${Engine.AI_DEFAULTS[p].label}</option>`).join('')}</select></div>
          <div class="field"><label>${t('settings_ai_model')}</label><input class="input" data-ai="model" value="${esc(ai.model || '')}" placeholder="${esc((Engine.AI_DEFAULTS[ai.provider] || {}).model || '')}"></div>
        </div>
        <div class="field"><label>${t('settings_ai_key')}</label><input class="input" type="password" data-ai="apiKey" value="${esc(ai.apiKey || '')}" autocomplete="off"></div>
        <div class="field" ${ai.provider === 'custom' ? '' : 'hidden'} id="aiUrlField"><label>${t('settings_ai_url')}</label><input class="input" data-ai="baseUrl" value="${esc(ai.baseUrl || '')}" placeholder="https://api.example.com/v1"></div>
        <div style="display:flex;gap:8px;align-items:center"><button class="btn sm" id="aiTest">${icon('key', 'sm')}${t('ai_test')}</button><span class="status-line" id="aiTestOut"></span></div>
      </div></div>

      <div class="card wide"><div class="card-head"><div><h3>${icon('edit')}${t('settings_templates')}</h3><div class="sub">${esc(t('template_hint'))}</div></div><span class="spacer"></span><button class="btn sm" id="tplAdd">${icon('plus', 'sm')}${t('add_template')}</button></div>
        <div class="card-body form" id="tplList">${(s.templates || []).map((tp, i) => `<div class="template-item"><span class="pill tag">${tp.lang === 'ar' ? 'AR' : 'EN'}</span><span class="t" dir="auto">${esc(tp.title)}</span><span class="b" dir="auto">${esc(tp.body)}</span><button class="icon-btn sm" data-tpl-edit="${i}">${icon('edit', 'sm')}</button><button class="icon-btn sm" data-tpl-del="${i}" style="color:var(--danger)">${icon('trash', 'sm')}</button></div>`).join('') || `<div class="inline-note">—</div>`}</div></div>

      <div class="card wide"><div class="card-head"><div><h3>${icon('shield')}${t('settings_backup')}</h3><div class="sub">${t('sync_folder_hint')}</div></div></div><div class="card-body form">
        <div class="sync-card ${App.Sync && App.Sync.isProtected() ? 'on' : ''}"><div class="status-line" id="bkStatus">${esc(App.Sync ? App.Sync.statusText() : '')}</div><p class="inline-note" style="margin:6px 0 0">${t('where_data')}</p></div>
        <div class="field"><label>${t('backup_folder')}</label><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn sm btn-primary" id="bkChoose">${icon('folder', 'sm')}${App.Sync && App.Sync.state.dir ? t('choose_other_folder') : t('choose_folder')}</button><span class="pill tag" id="bkName">—</span>${App.Sync && App.Sync.state.dir ? `<button class="btn sm" id="bkNow">${icon('refresh', 'sm')}${t('sync_now')}</button><button class="btn sm" id="bkForget">${icon('x', 'sm')}${t('sync_forget')}</button>` : ''}</div></div>
        <div class="field"><label>${t('export_import')}</label><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="bkExport">${icon('download', 'sm')}${t('export_json')}</button><button class="btn sm" id="bkImport">${icon('upload', 'sm')}${t('import_json')}</button><input type="file" id="bkFile" accept="application/json,.json" hidden><button class="btn sm" id="bkCsv">${icon('list', 'sm')}${t('export_csv')}</button></div><p class="inline-note" style="margin:6px 0 0">${t('sync_phone_hint')}</p></div>
        <div><button class="btn sm btn-danger" id="bkClear">${icon('trash', 'sm')}${t('clear_all')}</button></div>
      </div></div>

      <div class="card"><div class="card-head"><h3>${icon('info')}${t('settings_about')}</h3></div><div class="card-body form"><p style="margin:0;font-size:13px;color:var(--text-2)">${t('about_text')}</p><div class="inline-note">${t('version')} ${App.APP_VERSION} · ${t('installed_hint')}</div><div style="display:flex;gap:14px;flex-wrap:wrap"><a href="privacy.html" target="_blank" rel="noopener">${t('privacy_policy')}</a><a href="mailto:${App.SUPPORT_EMAIL}?subject=${encodeURIComponent('Email Management ' + App.APP_VERSION)}">${t('contact_developer')}</a></div></div></div>
    </div>`;

    // bindings
    $$('[data-set]', root).forEach(inp => inp.addEventListener('change', () => {
      const k = inp.dataset.set; let v = inp.value;
      if (k === 'reminderMinutes') v = +v;
      S.settings[k] = v; App.saveSettings();
      if (k === 'lang') { App.applyLang(); App.renderAll(); renderSettings(); }
      if (k === 'theme') App.applyTheme();
      toast(t('saved'), 'success');
    }));
    $$('[data-set-list]', root).forEach(inp => inp.addEventListener('change', async () => {
      S.settings[inp.dataset.setList] = inp.value.split(/\n|,/).map(x => x.trim()).filter(Boolean); App.saveSettings();
      if (inp.dataset.setList === 'vipSenders' || inp.dataset.setList === 'customKeywords' || inp.dataset.setList === 'myAddresses') await rescoreAll();
      toast(t('saved'), 'success');
    }));
    bindLevelEditor(root);
    $$('[data-ai]', root).forEach(inp => inp.addEventListener('change', () => {
      S.settings.ai[inp.dataset.ai] = inp.value.trim(); App.saveSettings();
      if (inp.dataset.ai === 'provider') { $('#aiUrlField', root).hidden = inp.value !== 'custom'; $('[data-ai="model"]', root).placeholder = (Engine.AI_DEFAULTS[inp.value] || {}).model || ''; }
      toast(t('saved'), 'success');
    }));
    const nt = $('#notifToggle', root);
    if (nt) nt.onchange = async () => {
      if (nt.checked) { const p = await Notification.requestPermission(); S.settings.notifications = p === 'granted'; if (p === 'granted') App.notify(t('appName'), t('notifications_enabled')); }
      else S.settings.notifications = false;
      App.saveSettings(); renderSettings();
    };
    $('#aiTest', root).onclick = async () => {
      const out = $('#aiTestOut', root); out.className = 'status-line'; out.innerHTML = `<span class="spinner"></span>`;
      try { await Engine.aiComplete(S.settings.ai, 'Reply with the single word OK.', 'ping', 20); out.className = 'status-line ok'; out.textContent = t('ai_test_ok'); }
      catch (err) { out.className = 'status-line bad'; out.textContent = t('ai_test_fail', { e: err.message === 'NO_KEY' ? t('settings_ai_key') : err.message }); }
    };
    $('#tplAdd', root).onclick = () => editTemplate(-1);
    $$('[data-tpl-edit]', root).forEach(b => b.onclick = () => editTemplate(+b.dataset.tplEdit));
    $$('[data-tpl-del]', root).forEach(b => b.onclick = () => { S.settings.templates.splice(+b.dataset.tplDel, 1); App.saveSettings(); renderSettings(); });
    // backup & sync
    $('#bkChoose', root).onclick = async () => { if (await App.Sync.chooseFolder()) renderSettings(); };
    const bkNow = $('#bkNow', root); if (bkNow) bkNow.onclick = async () => { await App.Sync.pull(); await App.Sync.write(true); };
    const bkForget = $('#bkForget', root); if (bkForget) bkForget.onclick = async () => { await App.Sync.forgetFolder(); renderSettings(); };
    $('#bkCsv', root).onclick = () => App.Features.exportCsv();
    $('#bkExport', root).onclick = exportJSON;
    $('#bkImport', root).onclick = () => $('#bkFile', root).click();
    $('#bkFile', root).onchange = (ev) => { if (ev.target.files[0]) importJSON(ev.target.files[0]); ev.target.value = ''; };
    $('#bkClear', root).onclick = async () => { if (await App.confirmDialog(t('clear_all_confirm'), { danger: true, okLabel: t('delete') })) { await DB.clearAll(); localStorage.removeItem('em.settings'); location.reload(); } };
    if (App.Sync) App.Sync.renderStatus();
  }
  App.renderSettings = renderSettings;

  /* ---------- priority level editor ---------- */
  function renderLevelRows() {
    const L = S.settings.priorities;
    return `<div class="level-head"><span></span><span>${t('level_color')}</span><span>${t('level_name_en')}</span><span>${t('level_name_ar')}</span><span>${t('level_hours')}</span><span>${t('level_min_score')}</span><span></span></div>` +
      L.map((l, i) => `<div class="level-row" data-i="${i}">
        <span class="pill p${l.id}">${App.prioShort(l.id)}</span>
        <input type="color" data-lv="color" value="${esc(l.color || '#6f7d94')}" title="${t('level_color')}">
        <input class="input" data-lv="en" value="${esc(l.name.en || '')}" placeholder="Name">
        <input class="input" data-lv="ar" value="${esc(l.name.ar || '')}" placeholder="الاسم" dir="rtl">
        <input class="input" type="number" min="1" max="2000" data-lv="hours" value="${esc(l.hours)}">
        ${i < L.length - 1 ? `<input class="input" type="number" step="0.5" data-lv="minScore" value="${esc(l.minScore == null ? '' : l.minScore)}">` : `<span class="inline-note">${t('level_fallback')}</span>`}
        <span class="level-actions"><button class="icon-btn sm" data-lv-act="up" ${i === 0 ? 'disabled' : ''} title="↑">${icon('chevron', 'sm')}</button><button class="icon-btn sm" data-lv-act="down" ${i === L.length - 1 ? 'disabled' : ''} title="↓">${icon('chevron', 'sm')}</button><button class="icon-btn sm" data-lv-act="del" ${L.length <= 2 ? 'disabled' : ''} style="color:var(--danger)" title="${t('delete')}">${icon('trash', 'sm')}</button></span>
      </div>`).join('');
  }
  function normalizeLevels() {
    const L = S.settings.priorities;
    L.forEach((l, i) => { l.hours = Math.max(1, +l.hours || 72); if (i === L.length - 1) l.minScore = null; else if (l.minScore === '' || l.minScore === null || l.minScore === undefined || isNaN(+l.minScore)) l.minScore = null; else l.minScore = +l.minScore; if (!l.name.en && !l.name.ar) l.name.en = 'Level ' + (i + 1); });
    // thresholds must decrease with rank: fill gaps sensibly
    for (let i = 0; i < L.length - 1; i++) { if (L[i].minScore === null) { const prev = i > 0 ? L[i - 1].minScore : 10; const next = L[i + 1].minScore; L[i].minScore = next !== null && next !== undefined && i + 1 < L.length - 1 ? (prev + next) / 2 : Math.max(0, prev - 2); } }
  }
  async function levelsChanged(removedRank) {
    normalizeLevels(); App.saveSettings(); App.applyPriorityStyles();
    await App.reassignPriorities(removedRank);
    App.renderAll(); renderSettings(); toast(t('saved'), 'success');
  }
  function bindLevelEditor(root) {
    const L = S.settings.priorities;
    $$('.level-row [data-lv]', root).forEach(inp => inp.addEventListener('change', () => {
      const i = +inp.closest('.level-row').dataset.i; const l = L[i]; const k = inp.dataset.lv;
      if (k === 'en' || k === 'ar') l.name[k] = inp.value.trim(); else if (k === 'color') l.color = inp.value; else if (k === 'hours') l.hours = +inp.value; else if (k === 'minScore') l.minScore = inp.value === '' ? null : +inp.value;
      levelsChanged();
    }));
    $$('.level-row [data-lv-act]', root).forEach(b => b.onclick = async () => {
      const i = +b.closest('.level-row').dataset.i; const act = b.dataset.lvAct;
      if (act === 'up' && i > 0) { [L[i - 1], L[i]] = [L[i], L[i - 1]]; }
      else if (act === 'down' && i < L.length - 1) { [L[i + 1], L[i]] = [L[i], L[i + 1]]; }
      else if (act === 'del') { if (L.length <= 2) return; if (!(await App.confirmDialog(t('delete_level_confirm', { n: App.prioName(L[i].id) }), { danger: true, okLabel: t('delete') }))) return; L.splice(i, 1); }
      levelsChanged(act === 'del' ? i : undefined);
    });
    $('#lvlAdd', root).onclick = () => {
      const id = Math.max(0, ...L.map(l => +l.id)) + 1;
      const last = L[L.length - 1];
      L.splice(L.length - 1, 0, { id, name: { en: 'New level', ar: 'مستوى جديد' }, color: '#0b7285', hours: Math.round((+last.hours || 168) / 2), minScore: null });
      levelsChanged();
    };
    $('#lvlReset', root).onclick = async () => {
      if (!(await App.confirmDialog(t('reset_levels_confirm'), { danger: true, okLabel: t('ok') }))) return;
      S.settings.priorities = JSON.parse(JSON.stringify(Engine.DEFAULT_PRIORITIES)); levelsChanged(0);
    };
  }

  async function rescoreAll() {
    for (const e of S.emails) {
      if (e.priorityManual) continue;
      const sc = Engine.scoreEmail(e, S.settings); e.priority = sc.priority; e.priorityAuto = sc.priority; e.reasons = sc.reasons; e.score = sc.score; await DB.putEmail(e);
    }
    App.renderAll();
  }

  function editTemplate(i) {
    const tp = i >= 0 ? S.settings.templates[i] : { title: '', body: '', lang: I18N.getLang() };
    const m = App.modal({
      title: t(i >= 0 ? 'edit' : 'add_template'), size: 'lg',
      body: `<div class="form-row"><div class="field"><label>${t('template_title')}</label><input class="input" id="tpTitle" value="${esc(tp.title)}" dir="auto"></div><div class="field"><label>${t('settings_language')}</label><select class="input" id="tpLang"><option value="en" ${tp.lang !== 'ar' ? 'selected' : ''}>English</option><option value="ar" ${tp.lang === 'ar' ? 'selected' : ''}>العربية</option></select></div></div>
        <div class="field"><label>${t('template_body')}</label><textarea class="textarea" id="tpBody" style="min-height:200px" dir="auto">${esc(tp.body)}</textarea><span class="hint">${esc(t('template_hint'))}</span></div>`,
      footer: `<button class="btn" data-cancel>${t('cancel')}</button><button class="btn btn-primary" data-ok>${t('save')}</button>`
    });
    m.el.querySelector('[data-cancel]').onclick = m.close;
    m.el.querySelector('[data-ok]').onclick = () => {
      const v = { title: m.el.querySelector('#tpTitle').value.trim(), body: m.el.querySelector('#tpBody').value, lang: m.el.querySelector('#tpLang').value };
      if (!v.title || !v.body) return;
      S.settings.templates = S.settings.templates || [];
      if (i >= 0) S.settings.templates[i] = v; else S.settings.templates.push(v);
      App.saveSettings(); m.close(); renderSettings();
    };
  }

  /* ---------- export / import (the folder backup and sync live in sync.js) ---------- */
  async function buildExport() {
    const files = await DB.getAllFiles();
    const b64 = async (blob) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); };
    const outFiles = [];
    for (const f of files) outFiles.push({ id: f.id, emailId: f.emailId, name: f.name, type: f.type, data: await b64(f.blob) });
    const settings = Object.assign({}, S.settings); settings.ai = Object.assign({}, settings.ai, { apiKey: '' });
    return { app: 'email-management', version: App.APP_VERSION, exportedAt: new Date().toISOString(), settings, emails: S.emails, files: outFiles };
  }
  async function exportJSON() {
    const data = await buildExport();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = 'email-management-' + new Date().toISOString().slice(0, 10) + '.json';
    if (window.showSaveFilePicker) {
      try { const fh = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] }); const w = await fh.createWritable(); await w.write(blob); await w.close(); toast(t('backup_done', { f: name }), 'success'); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  App.buildExport = buildExport;
  async function importJSON(file, opts) {
    opts = opts || {};
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.emails)) throw new Error('format');
      let n = 0;
      const existing = new Set(S.emails.map(e => e.id));
      const fps = new Set(S.emails.map(e => e.fingerprint));
      const files = [];
      for (const f of data.files || []) { const bin = atob(f.data || ''); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); files.push({ id: f.id, emailId: f.emailId, name: f.name, type: f.type, blob: new Blob([u8], { type: f.type || 'application/octet-stream' }) }); }
      const keep = new Set();
      for (const e of data.emails) { if (existing.has(e.id) || fps.has(e.fingerprint)) continue; S.emails.push(e); await DB.putEmail(e); keep.add(e.id); n++; }
      const fl = files.filter(f => keep.has(f.emailId)); if (fl.length) await DB.putFiles(fl);
      if (data.settings) {
        const cur = S.settings, inc = data.settings;
        ['vipSenders', 'customKeywords', 'myAddresses'].forEach(k => { if (Array.isArray(inc[k])) cur[k] = Array.from(new Set((cur[k] || []).concat(inc[k].filter(x => typeof x === 'string')))); });
        if (Array.isArray(inc.templates)) { cur.templates = cur.templates || []; inc.templates.forEach(tp => { if (tp && tp.title && !cur.templates.some(x => x.title === tp.title)) cur.templates.push(tp); }); }
        ['myName', 'myRole', 'signature', 'officeHours'].forEach(k => { if (!cur[k] && inc[k]) cur[k] = inc[k]; });
        App.saveSettings();
      }
      if (!opts.silent) { toast(t('import_done', { n }), 'success'); renderSettings(); }
      App.renderAll();
      if (n && App.scheduleAutoBackup) App.scheduleAutoBackup();
      return n;
    } catch (err) { if (!opts.silent) toast(t('import_failed', { f: file.name }), 'error'); return 0; }
  }
  App.importJSON = importJSON;
})(window);
