/* ============================================================
   app.js — core: state, settings, import pipeline, inbox list,
   detail view (message tab), modals, toasts, notifications.
   ============================================================ */
(function (global) {
  'use strict';
  const { t } = I18N;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const APP_VERSION = '2.0.0';
  const SUPPORT_EMAIL = 'haymohsen@gmail.com';
  const DEFAULT_SETTINGS = {
    lang: null, theme: 'system', myName: '', myRole: '', signature: '', officeHours: '', myAddresses: [],
    vipSenders: [], customKeywords: [], dueHours: { 1: 6, 2: 24, 3: 72, 4: 168 }, reminderMinutes: 60, followUpDays: 3,
    notifications: false, ai: { provider: 'anthropic', apiKey: '', model: '', baseUrl: '' }, templates: [], autoBackup: false,
    onboarded: false, sort: 'priority', filter: 'all', replyTone: 'formal', replyAll: false
  };

  const App = {
    state: {
      emails: [], settings: null, view: 'inbox', filter: 'all', sort: 'priority', search: '', selectedId: null, checked: new Set(),
      tab: 'message', allowRemote: new Set(), blobUrls: [], filesCache: new Map(), lastDeleted: null
    },
    $, $$, t, APP_VERSION, SUPPORT_EMAIL
  };
  const S = App.state;

  /* ---------- utils ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const AVATAR_COLORS = ['#2f5bea', '#7b3fe4', '#0b7285', '#e8590c', '#c2255c', '#2b8a3e', '#5f3dc4', '#1098ad', '#d9480f', '#364fc7'];
  const avatarColor = (s) => AVATAR_COLORS[parseInt(hash(s || '?'), 36) % AVATAR_COLORS.length];
  const initials = (name, addr) => {
    let n = (name || addr || '?').trim().replace(/^(dr\.?|prof\.?|eng\.?|mr\.?|mrs\.?|ms\.?|د\.|م\.|أ\.د\.|أ\.|الدكتور|الدكتورة|المهندس|المهندسة|الأستاذ|الأستاذة|السيد|السيدة)\s+/i, '');
    if (!name && addr) n = addr.split('@')[0].replace(/[._-]+/g, ' ');
    const parts = n.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = (w) => (/^ال./.test(w) ? w[2] : w[0]);
    if (parts.length === 1) return /[؀-ۿ]/.test(parts[0]) ? first(parts[0]) : parts[0].slice(0, 2).toUpperCase();
    return (first(parts[0]) + first(parts[parts.length - 1])).toUpperCase();
  };
  const locale = () => (I18N.getLang() === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB');
  const isOpen = (e) => e.status === 'todo' || e.status === 'drafting';
  const isSnoozed = (e) => !!e.snoozedUntil && new Date(e.snoozedUntil) > new Date();
  const isVip = (e) => {
    const addr = (e.from && e.from.address || '').toLowerCase(); if (!addr) return false;
    const dom = addr.split('@')[1] || '';
    return (S.settings.vipSenders || []).some(v => { v = v.toLowerCase().trim(); return v === addr || (v.startsWith('@') && v.slice(1) === dom); });
  };
  const debounce = (fn, ms) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; };
  const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  function fmtDateTime(iso, opts) {
    if (!iso) return '—';
    try { return new Intl.DateTimeFormat(locale(), opts || { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch (e) { return String(iso); }
  }
  function fmtRelDay(iso) {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const time = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(d);
    if (sameDay) return t('today') + ' ' + time;
    if (d.toDateString() === y.toDateString()) return t('yesterday') + ' ' + time;
    const tm = new Date(now); tm.setDate(tm.getDate() + 1);
    if (d.toDateString() === tm.toDateString()) return t('tomorrow') + ' ' + time;
    const opts = d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
    return new Intl.DateTimeFormat(locale(), opts).format(d) + ' ' + time;
  }
  function remainingText(ms) {
    const abs = Math.abs(ms);
    const m = Math.floor(abs / 60000), h = Math.floor(abs / 3600000), d = Math.floor(abs / 86400000);
    if (abs < 3600000) return t('t_minutes', { n: Math.max(1, m) });
    if (abs < 86400000) return t('t_hours_min', { h, m: m - h * 60 });
    if (d < 7) return t('t_days_hours', { d, h: h - d * 24 });
    return t('t_days', { n: d });
  }
  function dueInfo(e) {
    // returns {cls, text, ms}
    if (e.status === 'replied') return { cls: 'ok', text: t('replied_on', { t: fmtRelDay(e.repliedAt) }), icon: 'check' };
    if (e.status === 'awaiting') {
      if (!e.followUpAt) return { cls: '', text: t('status_awaiting'), icon: 'clock' };
      const ms = new Date(e.followUpAt) - Date.now();
      return ms < 0 ? { cls: 'soon', text: t('follow_up_overdue', { t: remainingText(ms) }), icon: 'bell' } : { cls: '', text: t('follow_up_in', { t: remainingText(ms) }), icon: 'bell' };
    }
    if (isSnoozed(e)) return { cls: '', text: t('snoozed_until', { t: fmtRelDay(e.snoozedUntil) }), icon: 'snooze' };
    if (!e.dueAt) return { cls: 'none', text: t('no_due'), icon: 'clock' };
    const ms = new Date(e.dueAt) - Date.now();
    if (ms < -60000) return { cls: 'overdue', text: t('overdue_by', { t: remainingText(ms) }), icon: 'clock', ms };
    if (ms < 60000) return { cls: 'overdue', text: t('due_now'), icon: 'clock', ms };
    const cls = ms < 4 * 3600000 ? 'urgent' : ms < 24 * 3600000 ? 'soon' : 'ok';
    return { cls, text: t('due_in', { t: remainingText(ms) }), icon: 'clock', ms };
  }
  const icon = (name, cls) => `<svg class="ic ${cls || ''}"><use href="#i-${name}"/></svg>`;
  Object.assign(App, { esc, uid, avatarColor, initials, locale, isOpen, isSnoozed, isVip, debounce, fmtSize, fmtDateTime, fmtRelDay, remainingText, dueInfo, icon });

  /* ---------- settings ---------- */
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('em.settings') || '{}'); } catch (e) { s = {}; }
    const merged = Object.assign({}, DEFAULT_SETTINGS, s);
    merged.dueHours = Object.assign({}, DEFAULT_SETTINGS.dueHours, s.dueHours || {});
    merged.ai = Object.assign({}, DEFAULT_SETTINGS.ai, s.ai || {});
    if (!merged.lang) merged.lang = (navigator.language || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
    if (!Array.isArray(merged.priorities) || merged.priorities.length < 2) {
      merged.priorities = JSON.parse(JSON.stringify(Engine.DEFAULT_PRIORITIES));
      merged.priorities.forEach(l => { if (s.dueHours && s.dueHours[l.id]) l.hours = +s.dueHours[l.id]; });
    }
    merged.priorities.forEach((l, i) => { l.id = Number(l.id); l.name = l.name || {}; if (typeof l.name === 'string') l.name = { en: l.name, ar: l.name }; if (l.minScore !== null && l.minScore !== undefined) l.minScore = Number(l.minScore); if (i === merged.priorities.length - 1) l.minScore = null; });
    S.settings = merged;
    return merged;
  }
  /* ---------- priority levels ---------- */
  function prios() { return Engine.priorityLevels(S.settings); }
  function prio(id) { const l = prios(); return l.find(x => String(x.id) === String(id)) || l[l.length - 1]; }
  function prioRank(id) { const l = prios(); const i = l.findIndex(x => String(x.id) === String(id)); return i === -1 ? l.length - 1 : i; }
  function prioName(id) { const l = prio(id); const lang = I18N.getLang(); return (l.name && (l.name[lang] || l.name.en || l.name.ar)) || String(id); }
  function prioShort(id) { return (I18N.getLang() === 'ar' ? 'أ' : 'P') + (prioRank(id) + 1); }
  function prioColor(id) { return prio(id).color || '#6f7d94'; }
  function applyPriorityStyles() {
    let st = document.getElementById('prioStyles');
    if (!st) { st = document.createElement('style'); st.id = 'prioStyles'; document.head.appendChild(st); }
    st.textContent = prios().map(l => { const c = l.color || '#6f7d94'; const id = Number(l.id); return `.pill.p${id}{background:color-mix(in srgb, ${c} 15%, var(--surface));color:${c}}\n.email-item.p${id}::before,.kcard.p${id}::before{background:${c}}\n.seg button.active.p${id}{color:${c}}`; }).join('\n');
  }
  Object.assign(App, { prios, prio, prioRank, prioName, prioShort, prioColor, applyPriorityStyles });
  // Emails whose level no longer exists get the nearest remaining level (manual) or are re-scored (automatic)
  async function reassignPriorities(removedRank) {
    const l = prios();
    for (const e of S.emails) {
      const exists = l.some(x => String(x.id) === String(e.priority));
      if (e.priorityManual && !exists) { e.priority = l[Math.min(removedRank || 0, l.length - 1)].id; }
      if (!e.priorityManual) { const sc = Engine.scoreEmail(e, S.settings); e.priority = sc.priority; e.priorityAuto = sc.priority; e.reasons = sc.reasons; e.score = sc.score; }
      else if (!l.some(x => String(x.id) === String(e.priorityAuto))) { const sc = Engine.scoreEmail(e, S.settings); e.priorityAuto = sc.priority; }
      await DB.putEmail(e);
    }
  }
  App.reassignPriorities = reassignPriorities;
  function saveSettings() { localStorage.setItem('em.settings', JSON.stringify(S.settings)); }
  App.saveSettings = saveSettings;

  function applyLang() {
    const lang = S.settings.lang;
    I18N.setLang(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    $('#searchInput').placeholder = t('search_placeholder');
    $('#btnLangText').textContent = t('lang_switch');
    $('#btnTheme').title = t('theme_switch');
    document.title = t('appName');
  }
  function applyTheme() {
    const th = S.settings.theme;
    const dark = th === 'dark' || (th === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    $('#btnTheme').innerHTML = icon(dark ? 'sun' : 'moon');
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#161a24' : '#2f5bea';
  }
  App.applyLang = applyLang; App.applyTheme = applyTheme;

  /* ---------- toasts / modals / popovers ---------- */
  function toast(msg, type, action) {
    const root = $('#toastRoot');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { action.fn(); el.remove(); };
    root.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, action ? 6000 : 3200);
  }
  function modal(opts) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal ${opts.size || ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(opts.title || '')}</h3><button class="icon-btn sm" data-close>${icon('x')}</button></div>
      <div class="modal-body">${opts.body || ''}</div>
      ${opts.footer ? `<div class="modal-foot">${opts.footer}</div>` : ''}</div>`;
    root.classList.add('show');
    const close = () => { root.classList.remove('show'); root.innerHTML = ''; document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    root.querySelector('[data-close]').onclick = close;
    root.onclick = (e) => { if (e.target === root && opts.dismissable !== false) close(); };
    return { el: root.querySelector('.modal'), close };
  }
  function confirmDialog(message, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const m = modal({
        title: opts.title || t('confirm'), body: `<p style="margin:6px 0 4px">${esc(message)}</p>`,
        footer: `<button class="btn" data-cancel>${t('cancel')}</button><button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(opts.okLabel || t('ok'))}</button>`,
        onClose: () => resolve(false)
      });
      m.el.querySelector('[data-cancel]').onclick = () => m.close();
      m.el.querySelector('[data-ok]').onclick = () => { resolve(true); m.close(); };
    });
  }
  let popoverEl = null;
  function closePopover() { if (popoverEl) { popoverEl.remove(); popoverEl = null; document.removeEventListener('mousedown', onDocDown, true); } }
  function onDocDown(e) { if (popoverEl && !popoverEl.contains(e.target)) closePopover(); }
  function popover(anchor, html) {
    closePopover();
    const el = document.createElement('div');
    el.className = 'popover'; el.innerHTML = html;
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    let left = rtl ? r.right - el.offsetWidth : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - el.offsetWidth - 8));
    let top = r.bottom + 6;
    if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - el.offsetHeight - 6);
    el.style.left = left + 'px'; el.style.top = top + 'px';
    popoverEl = el;
    setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
    return el;
  }
  Object.assign(App, { toast, modal, confirmDialog, popover, closePopover });

  /* ---------- persistence ---------- */
  async function saveEmail(e) { e.updatedAt = new Date().toISOString(); await DB.putEmail(e); App.scheduleAutoBackup && App.scheduleAutoBackup(); }
  App.saveEmail = saveEmail;
  App.getEmail = (id) => S.emails.find(e => e.id === id);

  /* ---------- import pipeline ---------- */
  function fingerprint(p) {
    if (p.messageId) return 'mid:' + p.messageId.trim();
    return 'h:' + hash((p.from && p.from.address || '') + '|' + (p.subject || '') + '|' + (p.date || '') + '|' + (p.textBody || '').slice(0, 200));
  }
  function snippetOf(text) { return (text || '').replace(/\s+/g, ' ').trim().slice(0, 160); }

  async function addParsedEmail(parsed) {
    const fp = fingerprint(parsed);
    if (S.emails.some(e => e.fingerprint === fp)) return { dup: true };
    const scored = Engine.scoreEmail(parsed, S.settings);
    const due = Engine.suggestDue(scored.priority, scored.dates, S.settings);
    const id = uid();
    const atts = [], files = [];
    for (const a of parsed.attachments || []) {
      const aid = uid();
      atts.push({ id: aid, name: a.name, type: a.type || 'application/octet-stream', size: a.size || (a.bytes ? a.bytes.length : 0), cid: a.cid || '', inline: !!a.inline });
      files.push({ id: aid, emailId: id, name: a.name, type: a.type || 'application/octet-stream', blob: new Blob([a.bytes || new Uint8Array(0)], { type: a.type || 'application/octet-stream' }) });
    }
    const textBody = parsed.textBody || (parsed.htmlBody ? MimeParser.htmlToText(parsed.htmlBody) : '');
    const email = {
      id, fingerprint: fp, subject: parsed.subject || '', from: parsed.from || { name: '', address: '' }, replyTo: parsed.replyTo || null,
      to: parsed.to || [], cc: parsed.cc || [], date: parsed.date || null, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      textBody, htmlBody: parsed.htmlBody || null, snippet: snippetOf(textBody), attachments: atts,
      priority: scored.priority, priorityAuto: scored.priority, priorityManual: false, score: scored.score, reasons: scored.reasons,
      status: 'todo', dueAt: due.toISOString(), repliedAt: null, snoozedUntil: null, followUpAt: null,
      tags: [], notes: '', draft: null, lang: Engine.detectLang((parsed.subject || '') + ' ' + textBody), source: parsed.source || 'eml',
      flags: parsed.flags || { importance: 'normal', automated: false }, notified: {}, pointsDone: []
    };
    if (files.length) await DB.putFiles(files);
    await DB.putEmail(email);
    S.emails.push(email);
    if (App.scheduleAutoBackup) App.scheduleAutoBackup();
    if (App.Sync) App.Sync.nudgeAfterImport();
    return { email };
  }
  App.addParsedEmail = addParsedEmail;

  async function parseFile(file) {
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const isCfb = u8.length > 8 && u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0;
    const name = (file.name || '').toLowerCase();
    if (isCfb) return MsgParser.parseMsg(buf);
    if (name.endsWith('.msg')) throw new Error('bad msg');
    if (name.endsWith('.txt')) return MimeParser.parsePastedText(new TextDecoder().decode(u8));
    const parsed = MimeParser.parseEml(buf);
    if (!parsed.subject && !parsed.from.address && !parsed.textBody && !parsed.htmlBody) {
      // not really an email — treat as pasted text
      return MimeParser.parsePastedText(new TextDecoder().decode(u8));
    }
    return parsed;
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let ok = 0, dup = 0, fail = 0, lastId = null;
    for (const f of files) {
      const lname = (f.name || '').toLowerCase();
      if (!/\.(eml|msg|txt)$/.test(lname) && !/message\/rfc822|ms-outlook/.test(f.type || '')) {
        // still try if no extension
        if (/\.[a-z0-9]{1,5}$/.test(lname)) { toast(t('unsupported_file', { f: f.name }), 'error'); fail++; continue; }
      }
      try {
        const parsed = await parseFile(f);
        const r = await addParsedEmail(parsed);
        if (r.dup) dup++; else { ok++; lastId = r.email.id; }
      } catch (e) { console.error('import failed', f.name, e); fail++; toast(t('import_failed', { f: f.name }), 'error'); }
    }
    if (ok) toast(t('imported_n', { n: ok }), 'success');
    if (dup) toast(t('duplicate_skipped', { n: dup }));
    if (ok) { S.filter = 'all'; if (S.view !== 'inbox') App.showView('inbox'); App.select(lastId); }
    App.renderAll();
  }
  App.importFiles = importFiles;

  async function importPasted(text, from, subject) {
    const parsed = MimeParser.parsePastedText(text || '');
    if (from) { const a = MimeParser.parseAddressList(from)[0]; if (a) parsed.from = a; }
    if (subject) parsed.subject = subject;
    if (!parsed.textBody && !parsed.subject) return false;
    const r = await addParsedEmail(parsed);
    if (r.dup) { toast(t('duplicate_skipped', { n: 1 })); return true; }
    toast(t('imported_n', { n: 1 }), 'success');
    S.filter = 'all'; App.select(r.email.id); App.renderAll();
    return true;
  }
  App.importPasted = importPasted;

  async function loadSamples() {
    const list = SAMPLES();
    let n = 0, last = null;
    for (const p of list) { const r = await addParsedEmail(p); if (!r.dup) { n++; last = r.email.id; } }
    toast(t('imported_n', { n }), 'success');
    S.filter = 'all'; if (S.view !== 'inbox') App.showView('inbox');
    if (last) App.select(last);
    App.renderAll();
  }
  App.loadSamples = loadSamples;

  /* ---------- email mutations ---------- */
  async function setPriority(e, p, manual) {
    e.priority = p; e.priorityManual = manual === true && p !== e.priorityAuto;
    await saveEmail(e); App.renderList(); App.renderDetailHead(); App.updateCounts();
  }
  async function setStatus(e, st) {
    if (e.status === st) return;
    e.status = st;
    if (st === 'replied') { e.repliedAt = new Date().toISOString(); e.snoozedUntil = null; }
    if (st === 'awaiting') { if (!e.followUpAt) { const d = new Date(); d.setDate(d.getDate() + (S.settings.followUpDays || 3)); d.setHours(10, 0, 0, 0); e.followUpAt = d.toISOString(); } }
    if (st === 'todo' || st === 'drafting') { e.repliedAt = null; }
    await saveEmail(e); App.renderAll();
  }
  async function setDue(e, iso) { e.dueAt = iso; e.notified = {}; await saveEmail(e); App.renderList(); App.renderDetailHead(); App.updateCounts(); }
  async function setSnooze(e, iso) { e.snoozedUntil = iso; await saveEmail(e); App.renderAll(); }
  async function deleteEmail(e) {
    const idx = S.emails.indexOf(e); if (idx === -1) return;
    S.emails.splice(idx, 1);
    const files = await DB.getFilesFor(e.id);
    await DB.deleteEmail(e.id);
    if (App.Sync) App.Sync.noteDeleted(e.id);
    if (S.selectedId === e.id) S.selectedId = null;
    S.checked.delete(e.id);
    App.renderAll();
    toast(t('deleted'), '', { label: t('undo'), fn: async () => { S.emails.push(e); if (files.length) await DB.putFiles(files); await DB.putEmail(e); if (App.Sync) App.Sync.undoDeleted(e.id); App.renderAll(); toast(t('restored'), 'success'); } });
  }
  async function toggleVip(e) {
    const addr = (e.from.address || '').toLowerCase(); if (!addr) return;
    const list = S.settings.vipSenders || [];
    const i = list.findIndex(v => v.toLowerCase().trim() === addr);
    if (i >= 0) list.splice(i, 1); else list.push(addr);
    S.settings.vipSenders = list; saveSettings();
    // rescore automatic priorities for this sender
    for (const m of S.emails) {
      if ((m.from.address || '').toLowerCase() === addr && !m.priorityManual) {
        const sc = Engine.scoreEmail(m, S.settings); m.priority = sc.priority; m.priorityAuto = sc.priority; m.reasons = sc.reasons; m.score = sc.score; await DB.putEmail(m);
      }
    }
    App.renderAll();
  }
  Object.assign(App, { setPriority, setStatus, setDue, setSnooze, deleteEmail, toggleVip });

  /* ---------- filtering / sorting ---------- */
  function visibleEmails() {
    const q = S.search.trim().toLowerCase();
    const now = new Date();
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    let list = S.emails.filter(e => {
      switch (S.filter) {
        case 'all': return e.status !== 'replied' && !isSnoozed(e);
        case 'today': return isOpen(e) && !isSnoozed(e) && e.dueAt && new Date(e.dueAt) <= todayEnd;
        case 'overdue': return isOpen(e) && !isSnoozed(e) && e.dueAt && new Date(e.dueAt) < now;
        case 'top': return isOpen(e) && String(e.priority) === String(prios()[0].id) && !isSnoozed(e);
        case 'vip': return e.status !== 'replied' && isVip(e);
        case 'snoozed': return isSnoozed(e);
        case 'awaiting': return e.status === 'awaiting';
        case 'replied': return e.status === 'replied';
        default: return true;
      }
    });
    if (q) list = list.filter(e => [e.subject, e.from.name, e.from.address, e.snippet, (e.textBody || '').slice(0, 5000), (e.tags || []).join(' '), e.notes || '', (e.noteItems || []).map(n => n.text || n.name || '').join(' ')].join('\n').toLowerCase().includes(q));
    const cmp = {
      priority: (a, b) => prioRank(a.priority) - prioRank(b.priority) || dueCmp(a, b) || dateCmp(a, b),
      due: (a, b) => dueCmp(a, b) || prioRank(a.priority) - prioRank(b.priority),
      date: dateCmp,
      sender: (a, b) => (a.from.name || a.from.address || '').localeCompare(b.from.name || b.from.address || '') || dateCmp(a, b)
    }[S.sort] || ((a, b) => 0);
    return list.sort(cmp);
  }
  function dueCmp(a, b) { const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity, db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity; return da - db; }
  function dateCmp(a, b) { return new Date(b.date || b.addedAt) - new Date(a.date || a.addedAt); }
  App.visibleEmails = visibleEmails;

  /* ---------- rendering: shell ---------- */
  function showView(v) {
    S.view = v;
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
    $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show');
    if (v === 'board') App.renderBoard();
    if (v === 'stats') App.renderStats();
    if (v === 'settings') App.renderSettings();
  }
  App.showView = showView;

  function updateCounts() {
    const open = S.emails.filter(e => isOpen(e) && !isSnoozed(e));
    const overdue = open.filter(e => e.dueAt && new Date(e.dueAt) < new Date()).length;
    const c = $('#countInbox');
    c.textContent = open.length ? String(open.length) : '';
    c.classList.toggle('danger', overdue > 0);
    if (navigator.setAppBadge) { try { overdue ? navigator.setAppBadge(overdue) : navigator.clearAppBadge(); } catch (e) { /* ignore */ } }
  }
  App.updateCounts = updateCounts;

  function renderFilters() {
    const now = new Date(); const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const open = S.emails.filter(e => isOpen(e) && !isSnoozed(e));
    const counts = {
      all: S.emails.filter(e => e.status !== 'replied' && !isSnoozed(e)).length,
      today: open.filter(e => e.dueAt && new Date(e.dueAt) <= todayEnd).length,
      overdue: open.filter(e => e.dueAt && new Date(e.dueAt) < now).length,
      top: open.filter(e => String(e.priority) === String(prios()[0].id)).length,
      vip: S.emails.filter(e => e.status !== 'replied' && isVip(e)).length,
      awaiting: S.emails.filter(e => e.status === 'awaiting').length,
      snoozed: S.emails.filter(isSnoozed).length,
      replied: S.emails.filter(e => e.status === 'replied').length
    };
    const defs = [['all', 'filter_all'], ['today', 'filter_today'], ['overdue', 'filter_overdue'], ['top', null], ['vip', 'filter_vip'], ['awaiting', 'filter_awaiting'], ['snoozed', 'filter_snoozed'], ['replied', 'filter_replied']];
    $('#filters').innerHTML = defs.map(([k, label]) => `<button class="chip clickable ${S.filter === k ? 'active' : ''}" data-filter="${k}">${label ? t(label) : esc(prioName(prios()[0].id))}${counts[k] ? ` <span style="opacity:.7">${counts[k]}</span>` : ''}</button>`).join('');
    const sel = $('#sortSelect');
    sel.innerHTML = [['priority', 'sort_priority'], ['due', 'sort_due'], ['date', 'sort_date'], ['sender', 'sort_sender']].map(([k, l]) => `<option value="${k}" ${S.sort === k ? 'selected' : ''}>${t(l)}</option>`).join('');
  }

  function renderList() {
    const list = visibleEmails();
    const root = $('#emailList');
    $('#listCount').textContent = list.length ? `${list.length} ${t('of_total', { n: S.emails.length })}` : '';
    root.classList.toggle('selecting', S.checked.size > 0);
    if (!S.emails.length) {
      root.innerHTML = `<div class="list-empty">${icon('inbox', 'lg')}<h3>${t('empty_title')}</h3><p>${t('empty_sub')}</p>
        <div class="empty-actions"><button class="btn btn-primary sm" data-act="import">${icon('upload', 'sm')}${t('btn_import')}</button><button class="btn sm" data-act="restore">${icon('folder', 'sm')}${t('restore_short')}</button><button class="btn sm" data-act="samples">${icon('zap', 'sm')}${t('btn_samples')}</button></div></div>`;
      renderBulkBar(); return;
    }
    if (!list.length) { root.innerHTML = `<div class="list-empty">${icon('check-circle', 'lg')}<h3>${t('all_caught_up')}</h3><p>${t('all_caught_up_sub')}</p></div>`; renderBulkBar(); return; }
    root.innerHTML = list.map(e => {
      const di = dueInfo(e);
      const name = e.from.name || e.from.address || t('sender_unknown');
      const st = e.status !== 'todo' ? `<span class="pill st-${e.status}">${t('status_' + e.status)}</span>` : '';
      const tags = (e.tags || []).slice(0, 3).map(tg => `<span class="pill tag">${esc(tg)}</span>`).join('');
      const att = e.attachments.filter(a => !a.inline).length;
      const nc = App.noteCount ? App.noteCount(e) : 0;
      return `<div class="email-item p${e.priority} ${S.selectedId === e.id ? 'selected' : ''} ${S.checked.has(e.id) ? 'checked' : ''} ${e.status === 'replied' ? 'done' : ''}" data-id="${e.id}" tabindex="0">
        <input type="checkbox" class="check" ${S.checked.has(e.id) ? 'checked' : ''} aria-label="select">
        <div class="avatar" style="background:${avatarColor(e.from.address || name)}">${esc(initials(e.from.name, e.from.address))}</div>
        <div style="min-width:0">
          <div class="row1"><span class="sender" dir="auto">${esc(name)}</span>${isVip(e) ? `<span class="pill vip sm">${icon('star', 'sm')}</span>` : ''}<span class="when">${esc(fmtRelDay(e.date || e.addedAt))}</span></div>
          <div class="subject" dir="auto">${esc(e.subject || t('no_subject'))}</div>
          <div class="snippet" dir="auto">${esc(e.snippet || '')}</div>
          <div class="row3"><span class="pill p${e.priority}">${prioShort(e.priority)} · ${esc(prioName(e.priority))}</span><span class="due ${di.cls}" data-due-for="${e.id}">${icon(di.icon, 'sm')}<span>${esc(di.text)}</span></span>${st}${att ? `<span class="att">${icon('clip', 'sm')}${att}</span>` : ''}${nc ? `<span class="att" title="${t('tab_notes')}">${icon('edit', 'sm')}${nc}</span>` : ''}${tags}</div>
        </div></div>`;
    }).join('');
    renderBulkBar();
  }
  function renderBulkBar() {
    const bar = $('#bulkBar');
    if (!S.checked.size) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    bar.innerHTML = `<span>${t('n_selected', { n: S.checked.size })}</span><span class="spacer"></span>
      <button class="btn xs" data-bulk="priority">${icon('flag', 'sm')}${t('bulk_priority')}</button>
      <button class="btn xs" data-bulk="status">${icon('check', 'sm')}${t('bulk_status')}</button>
      <button class="btn xs btn-danger" data-bulk="delete">${icon('trash', 'sm')}${t('bulk_delete')}</button>
      <button class="icon-btn sm" data-bulk="clear">${icon('x', 'sm')}</button>`;
  }
  function updateCountdowns() {
    $$('[data-due-for]').forEach(el => {
      const e = App.getEmail(el.getAttribute('data-due-for')); if (!e) return;
      const di = dueInfo(e);
      el.className = 'due ' + (el.classList.contains('lg') ? 'lg ' : '') + di.cls;
      el.innerHTML = `${icon(di.icon, 'sm')}<span>${esc(di.text)}</span>`;
    });
  }
  App.renderList = renderList; App.renderFilters = renderFilters; App.updateCountdowns = updateCountdowns;

  // keep whatever is typed in the composer before a re-render wipes the DOM
  function flushDraft() {
    const e = App.getEmail(S.selectedId); const body = $('#cBody');
    if (e && body) e.draft = { to: ($('#cTo') || {}).value || '', subject: ($('#cSubject') || {}).value || '', body: body.value };
  }
  App.flushDraft = flushDraft;
  function renderAll() {
    flushDraft();
    renderFilters(); renderList(); updateCounts(); renderDetail();
    if (S.view === 'board') App.renderBoard();
    if (S.view === 'stats') App.renderStats();
    if (App.Sync) App.Sync.renderStatus();
  }
  App.renderAll = renderAll;

  function select(id) {
    flushDraft();
    if (id !== S.selectedId) S.tab = 'message';
    S.selectedId = id;
    $('#inboxLayout').classList.toggle('show-detail', !!id);
    renderList(); renderDetail();
  }
  App.select = select;

  /* ---------- rendering: detail ---------- */
  function revokeBlobs() { S.blobUrls.forEach(u => URL.revokeObjectURL(u)); S.blobUrls = []; }
  async function getAttachmentUrl(email, att) {
    const key = email.id + ':' + att.id;
    if (S.filesCache.has(key)) return S.filesCache.get(key);
    const f = await DB.getFile(att.id);
    if (!f) return null;
    const url = URL.createObjectURL(f.blob);
    S.blobUrls.push(url); S.filesCache.set(key, url);
    return url;
  }
  App.getAttachmentUrl = getAttachmentUrl;

  function renderDetail() {
    const pane = $('#detailPane');
    const e = App.getEmail(S.selectedId);
    revokeBlobs(); S.filesCache.clear();
    if (!e) {
      pane.innerHTML = `<div class="detail-empty"><div><svg class="art" viewBox="0 0 200 160" fill="none"><defs><linearGradient id="g1" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#2f5bea"/><stop offset="1" stop-color="#7b3fe4"/></linearGradient></defs><rect x="30" y="40" width="140" height="90" rx="14" fill="url(#g1)" opacity=".12"/><rect x="45" y="55" width="110" height="70" rx="10" stroke="url(#g1)" stroke-width="3"/><path d="M45 62l55 38 55-38" stroke="url(#g1)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="150" cy="120" r="22" fill="var(--surface)" stroke="url(#g1)" stroke-width="3"/><path d="M150 108v12l8 5" stroke="url(#g1)" stroke-width="3" stroke-linecap="round"/></svg>
        <h3>${S.emails.length ? t('select_email') : t('empty_title')}</h3><p>${S.emails.length ? t('kb_help') : t('empty_sub')}</p>
        ${!S.emails.length ? `<div class="empty-help"><div class="h"><div class="ico">${icon('mail', 'sm')}</div><div>${t('empty_outlook')}</div></div><div class="h"><div class="ico">${icon('mail', 'sm')}</div><div>${t('empty_new_outlook')}</div></div><div class="h"><div class="ico">${icon('mail', 'sm')}</div><div>${t('empty_gmail')}</div></div></div>
        <div class="empty-actions"><button class="btn btn-primary" data-act="import">${icon('upload')}${t('btn_import')}</button><button class="btn" data-act="paste">${icon('paste')}${t('btn_paste')}</button><button class="btn" data-act="samples">${icon('zap')}${t('btn_samples')}</button></div>` : ''}
        </div></div>`;
      return;
    }
    pane.innerHTML = `<div class="detail-scroll" id="detailScroll">
      <div class="detail-head" id="detailHead"></div>
      <div class="tabs" id="detailTabs"></div>
      <div id="tabContent"></div></div>`;
    renderDetailHead(); renderTabs(); renderTabContent();
  }
  App.renderDetail = renderDetail;

  function renderDetailHead() {
    const e = App.getEmail(S.selectedId); const head = $('#detailHead'); if (!e || !head) return;
    const di = dueInfo(e);
    const name = e.from.name || e.from.address || t('sender_unknown');
    const reasons = (e.reasons || []).map(r => `<span class="chip">${t('reason_' + r)}</span>`).join('');
    head.innerHTML = `
      <div class="detail-title">
        <button class="icon-btn sm" id="btnBack" title="${t('back')}">${icon('arrow-left', 'flip-rtl')}</button>
        <h2 dir="auto">${esc(e.subject || t('no_subject'))}</h2>
        <div class="title-actions">
          <button class="icon-btn sm ${isVip(e) ? 'active' : ''}" data-h="vip" title="${isVip(e) ? t('unmark_vip') : t('mark_vip')}">${icon('star')}</button>
          <button class="icon-btn sm" data-h="snooze" title="${t('snooze')}">${icon('snooze')}</button>
          ${e.dueAt ? `<button class="icon-btn sm" data-h="calendar" title="${t('add_to_calendar')}">${icon('calendar')}</button>` : ''}
          <button class="icon-btn sm" data-h="print" title="${t('print_email')}">${icon('print')}</button>
          <button class="icon-btn sm" data-h="delete" title="${t('delete_email')}" style="color:var(--danger)">${icon('trash')}</button>
        </div></div>
      <div class="detail-sender">
        <div class="avatar lg" style="background:${avatarColor(e.from.address || name)}">${esc(initials(e.from.name, e.from.address))}</div>
        <div class="who"><div class="name" dir="auto">${esc(name)} ${isVip(e) ? `<span class="pill vip">${icon('star', 'sm')} ${t('vip')}</span>` : ''}${e.flags && e.flags.importance === 'high' ? `<span class="pill p1">!</span>` : ''}</div><div class="addr">${esc(e.from.address || '')}</div></div>
        <div class="dates"><div>${t('detail_date')}: ${esc(fmtDateTime(e.date || e.addedAt))}</div><div>${t('detail_added')}: ${esc(fmtRelDay(e.addedAt))}${App.Features && App.Features.senderCount(e) > 1 ? ` · <button class="linkish" data-h="sender">${t('sender_count', { n: App.Features.senderCount(e) })}</button>` : ''}</div></div>
      </div>
      <div class="detail-controls">
        <div class="ctrl"><span class="ctrl-label">${t('priority')}</span><div class="seg" data-h="priority">${prios().map(l => `<button class="${String(e.priority) === String(l.id) ? 'active p' + l.id : ''}" data-p="${l.id}" title="${esc(prioName(l.id))}"><span class="dot" style="color:${esc(l.color)}"></span>${prioShort(l.id)}</button>`).join('')}</div><span class="inline-note">${esc(prioName(e.priority))}</span>${e.priorityManual ? `<button class="btn xs btn-ghost" data-h="resetp" title="${t('reset_priority')}">${icon('refresh', 'sm')}${t('auto')}</button>` : ''}</div>
        <div class="ctrl"><span class="ctrl-label">${t('status')}</span><button class="pill st-${e.status}" style="height:28px;padding:0 10px;cursor:pointer;border:0;font-size:12px" data-h="status">${t('status_' + e.status)} ${icon('chevron', 'sm')}</button></div>
        <div class="ctrl"><span class="ctrl-label">${t('deadline')}</span><button class="due lg ${di.cls}" data-h="due" data-due-for="${e.id}">${icon(di.icon, 'sm')}<span>${esc(di.text)}</span></button>${e.dueAt && e.status !== 'replied' ? `<span class="inline-note">${esc(fmtDateTime(e.dueAt))}</span>` : ''}</div>
        <div class="ctrl" style="flex:1;min-width:200px"><span class="ctrl-label">${t('tags')}</span><div class="tags-edit" data-h="tags">${(e.tags || []).map(tg => `<span class="pill tag">${esc(tg)}<span class="x" data-tag="${esc(tg)}">${icon('x', 'sm')}</span></span>`).join('')}<input placeholder="${t('add_tag')}" data-h="tagInput"></div></div>
      </div>
      ${reasons ? `<div class="reasons"><span class="ctrl-label" style="align-self:center">${t('reasons')}:</span>${reasons}</div>` : ''}
      <dl class="meta-grid">
        ${e.to.length ? `<dt>${t('detail_to')}</dt><dd dir="auto">${esc(e.to.map(a => a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address || a.name).join(', '))}</dd>` : ''}
        ${e.cc.length ? `<dt>${t('detail_cc')}</dt><dd dir="auto">${esc(e.cc.map(a => a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address || a.name).join(', '))}</dd>` : ''}
        ${e.attachments.length ? `<dt>${t('detail_attachments')}</dt><dd>${t('attachments_n', { n: e.attachments.length })}</dd>` : ''}
      </dl>`;
  }
  App.renderDetailHead = renderDetailHead;

  function renderTabs() {
    const e = App.getEmail(S.selectedId); const el = $('#detailTabs'); if (!e || !el) return;
    el.innerHTML = [['message', 'tab_message', 'mail'], ['reply', 'tab_reply', 'reply'], ['notes', 'tab_notes', 'edit']].map(([k, l, ic]) =>
      `<button class="${S.tab === k ? 'active' : ''}" data-tab="${k}">${icon(ic)}${t(l)}${k === 'reply' && e.draft && e.draft.body ? `<span class="badge">${t('draft_badge')}</span>` : ''}${k === 'notes' && App.noteCount && App.noteCount(e) ? `<span class="badge info">${App.noteCount(e)}</span>` : ''}</button>`).join('');
  }
  App.renderTabs = renderTabs;

  function renderTabContent() {
    const e = App.getEmail(S.selectedId); const el = $('#tabContent'); if (!e || !el) return;
    if (S.tab === 'message') renderMessageTab(e, el);
    else if (S.tab === 'reply') App.renderReplyTab(e, el);
    else App.renderNotesTab(e, el);
  }
  App.renderTabContent = renderTabContent;

  function attachmentChip(e, a) {
    const ext = (a.name.split('.').pop() || '').toLowerCase();
    const cls = /pdf/.test(ext) ? 'pdf' : /docx?|rtf|odt/.test(ext) ? 'doc' : /xlsx?|csv/.test(ext) ? 'xls' : /pptx?/.test(ext) ? 'ppt' : /png|jpe?g|gif|webp|bmp|svg/.test(ext) ? 'img' : /zip|rar|7z/.test(ext) ? 'zip' : /eml|msg/.test(ext) ? 'eml' : '';
    const editable = App.Editor && App.Editor.kindOf(a) !== 'other';
    return `<div class="att-chip ${a.editedFrom ? 'edited' : ''}" data-att="${a.id}" title="${esc(a.name)}">
      <div class="ico ${cls}">${esc(ext.slice(0, 4) || 'file')}</div>
      <div style="min-width:0"><div class="att-name" dir="auto">${esc(a.name)}</div><div class="att-size">${fmtSize(a.size)}${a.inline ? ' · inline' : ''}${a.editedFrom ? ` · <span class="edited-badge">${t('edited_badge')}</span>` : ''}</div></div>
      <div class="att-actions">
        <button class="icon-btn sm" data-attact="${editable ? 'edit' : 'view'}" title="${editable ? t('edit_attachment') : t('view_attachment')}">${icon(editable ? 'edit' : 'external', 'sm')}</button>
        <button class="icon-btn sm" data-attact="save" title="${t('save_attachment')}">${icon('download', 'sm')}</button>
        <button class="icon-btn sm" data-attact="more" title="${t('more')}">${icon('more', 'sm')}</button>
      </div></div>`;
  }
  App.attachmentChip = attachmentChip;

  function linkify(text) {
    return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:)!?"'])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }
  async function renderMessageTab(e, el) {
    const allowRemote = S.allowRemote.has(e.id);
    const atts = e.attachments;
    const attHtml = atts.length ? `<div class="attachments">${atts.map(a => App.attachmentChip(e, a)).join('')}<div class="att-hint">${icon('info', 'sm')}${t('attachments_hint')}</div></div>` : '';
    el.innerHTML = `<div class="card paper-wrap"><div id="remoteBar"></div><div class="paper" id="paper"></div>${attHtml}</div>`;
    const paper = $('#paper');
    if (e.htmlBody) {
      const blobMap = {};
      for (const a of atts) if (a.cid) { const u = await getAttachmentUrl(e, a); if (u) blobMap[a.cid] = u; }
      const built = buildSrcdoc(e.htmlBody, blobMap, allowRemote);
      if (built.hasRemote && !allowRemote) $('#remoteBar').innerHTML = `<div class="remote-bar">${icon('shield', 'sm')}<span>${t('remote_images_blocked')}</span><button class="btn xs" data-h="loadimages">${icon('image', 'sm')}${t('load_images')}</button></div>`;
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      iframe.setAttribute('title', 'message');
      iframe.srcdoc = built.srcdoc;
      iframe.onload = () => {
        try {
          const d = iframe.contentDocument;
          const fit = () => { const h = Math.max(d.body.scrollHeight, d.body.offsetHeight); iframe.style.height = Math.min(20000, Math.max(120, h + 8)) + 'px'; };
          fit();
          if (window.ResizeObserver) new ResizeObserver(fit).observe(d.body);
          d.querySelectorAll('img').forEach(im => im.addEventListener('load', fit));
        } catch (err) { iframe.style.height = '600px'; }
      };
      paper.appendChild(iframe);
    } else if (e.textBody) {
      paper.innerHTML = `<div class="plain-body" dir="auto">${linkify(e.textBody)}</div>`;
    } else {
      paper.innerHTML = `<div class="plain-body" style="color:var(--muted)">${t('no_body')}</div>`;
    }
  }

  function buildSrcdoc(html, blobMap, allowRemote) {
    let hasRemote = false;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,form,input,button,select,textarea,meta,link,base,frame,frameset,applet,audio,video,noscript,svg').forEach(n => n.remove());
    const styles = Array.from(doc.querySelectorAll('style')).map(s => s.textContent || '').join('\n');
    doc.querySelectorAll('style').forEach(s => s.remove());
    doc.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(a => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || ((n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action' || n === 'formaction') && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value))) el.removeAttribute(a.name);
      });
      const tag = el.tagName;
      if (tag === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      if (tag === 'IMG') {
        const src = el.getAttribute('src') || '';
        if (/^cid:/i.test(src)) { const cid = src.slice(4).replace(/^<|>$/g, ''); const u = blobMap[cid] || blobMap[cid.toLowerCase()]; if (u) el.setAttribute('src', u); else el.removeAttribute('src'); }
        else if (/^(https?:)?\/\//i.test(src)) { if (!allowRemote) { hasRemote = true; el.setAttribute('data-blocked', src); el.removeAttribute('src'); el.setAttribute('alt', el.getAttribute('alt') || ''); } }
        else if (!/^data:image\//i.test(src)) el.removeAttribute('src');
        el.removeAttribute('srcset');
      }
      if (el.hasAttribute('background')) { if (!allowRemote) { hasRemote = true; el.removeAttribute('background'); } }
      const st = el.getAttribute('style');
      if (st && /url\s*\(/i.test(st)) { if (!allowRemote) { hasRemote = true; el.setAttribute('style', st.replace(/url\s*\([^)]*\)/gi, 'none')); } }
      if (st && /expression\s*\(/i.test(st)) el.removeAttribute('style');
    });
    let css = styles.replace(/@import[^;]+;/gi, '');
    if (!allowRemote && /url\s*\(/i.test(css)) { hasRemote = true; css = css.replace(/url\s*\([^)]*\)/gi, 'none'); }
    const bodyHtml = doc.body ? doc.body.innerHTML : html;
    const csp = `default-src 'none'; img-src data: blob:${allowRemote ? ' https: http:' : ''}; style-src 'unsafe-inline'; font-src data:;`;
    const srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
      html,body{margin:0;padding:0;background:#fff;color:#1b1f2a}
      body{padding:20px 22px;font-family:"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;word-wrap:break-word;overflow-wrap:anywhere;overflow-x:auto}
      img{max-width:100%;height:auto} table{max-width:100% !important} pre{white-space:pre-wrap} a{color:#2f5bea} blockquote{border-inline-start:3px solid #d3dae6;margin:8px 0;padding:4px 12px;color:#4b5567}
      ${css}</style></head><body dir="auto">${bodyHtml}</body></html>`;
    return { srcdoc, hasRemote };
  }
  App.buildSrcdoc = buildSrcdoc;

  /* ---------- attachments actions ---------- */
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function saveBlobAs(blob, name) {
    if (window.showSaveFilePicker) {
      try {
        const ext = '.' + (name.split('.').pop() || 'bin').toLowerCase();
        const fh = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.slice(1).toUpperCase(), accept: { [blob.type || 'application/octet-stream']: [ext] } }] });
        const w = await fh.createWritable(); await w.write(blob); await w.close();
        toast(t('saved_to', { f: fh.name }), 'success'); return true;
      } catch (err) { if (err && err.name === 'AbortError') return false; /* fall back to download */ }
    }
    downloadBlob(blob, name); return true;
  }
  App.downloadBlob = downloadBlob; App.saveBlobAs = saveBlobAs;

  async function attachmentAction(e, attId, act, anchor) {
    const a = e.attachments.find(x => x.id === attId); if (!a) return;
    const ext = (a.name.split('.').pop() || '').toLowerCase();
    if (act === 'more') {
      const el = popover(anchor, `
        <button class="item" data-a="newtab">${icon('external', 'sm')}${t('open_new_tab')}</button>
        <button class="item" data-a="saveas">${icon('folder', 'sm')}${t('save_to_folder')}</button>
        <button class="item" data-a="upload">${icon('upload', 'sm')}${t('upload_edited')}</button>
        ${/^(eml|msg)$/.test(ext) ? `<button class="item" data-a="import">${icon('inbox', 'sm')}${t('btn_import')}</button>` : ''}
        ${a.editedFrom ? `<div class="sep"></div><button class="item danger" data-a="delete">${icon('trash', 'sm')}${t('delete_version')}</button>` : ''}`);
      el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { closePopover(); attachmentAction(e, attId, b.dataset.a, anchor); });
      return;
    }
    if (act === 'upload') {
      const inp = document.createElement('input'); inp.type = 'file';
      inp.onchange = async () => { const f = inp.files[0]; if (f) await App.addAttachmentVersion(e, a, f, f.name, f.type); };
      inp.click(); return;
    }
    if (act === 'delete') {
      if (!(await confirmDialog(t('delete_confirm_version'), { danger: true, okLabel: t('delete') }))) return;
      e.attachments = e.attachments.filter(x => x.id !== a.id);
      await DB.deleteFile(a.id); await saveEmail(e); renderTabContent(); renderDetailHead(); renderList(); return;
    }
    const f = await DB.getFile(a.id); if (!f) { toast(t('file_missing'), 'error'); return; }
    if (act === 'import') {
      const file = new File([f.blob], a.name, { type: ext === 'msg' ? 'application/vnd.ms-outlook' : 'message/rfc822' });
      return importFiles([file]);
    }
    if (act === 'edit' || act === 'view') { if (App.Editor) return App.Editor.open(e, a); act = 'newtab'; }
    if (act === 'newtab') {
      const url = URL.createObjectURL(f.blob); S.blobUrls.push(url);
      const w = window.open(url, '_blank', 'noopener');
      if (!w) { const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove(); }
      return;
    }
    if (act === 'saveas') return saveBlobAs(f.blob, a.name);
    downloadBlob(f.blob, a.name);
  }
  App.attachmentAction = attachmentAction;

  // Store an edited/uploaded version of an attachment next to the original
  async function addAttachmentVersion(e, base, blob, name, type, extra) {
    const id = uid();
    const rec = Object.assign({ id, name, type: type || blob.type || 'application/octet-stream', size: blob.size, cid: '', inline: false, editedFrom: base.editedFrom || base.id, version: 1 }, extra || {});
    const siblings = e.attachments.filter(x => x.editedFrom === rec.editedFrom);
    rec.version = siblings.length + 1;
    await DB.putFile({ id, emailId: e.id, name, type: rec.type, blob });
    const idx = e.attachments.findIndex(x => x.id === base.id);
    e.attachments.splice(idx + 1 + siblings.length, 0, rec);
    await saveEmail(e);
    if (S.selectedId === e.id) { renderTabContent(); renderDetailHead(); }
    renderList();
    toast(t('saved_as', { f: name }), 'success');
    return rec;
  }
  async function updateAttachmentVersion(e, rec, blob, extra) {
    rec.size = blob.size; Object.assign(rec, extra || {});
    await DB.putFile({ id: rec.id, emailId: e.id, name: rec.name, type: rec.type, blob });
    await saveEmail(e);
    if (S.selectedId === e.id) renderTabContent();
    toast(t('saved_as', { f: rec.name }), 'success');
    return rec;
  }
  App.addAttachmentVersion = addAttachmentVersion; App.updateAttachmentVersion = updateAttachmentVersion;

  /* ---------- deadline popover ---------- */
  function dueQuickOptions() {
    const now = new Date();
    const at = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
    const addH = (h) => new Date(now.getTime() + h * 3600e3);
    const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
    const d3 = new Date(now); d3.setDate(d3.getDate() + 3);
    const wk = new Date(now); wk.setDate(wk.getDate() + 7);
    const list = [];
    if (at(now, 17) > now) list.push(['q_today_eod', at(now, 17)]);
    list.push(['q_4h', addH(4)], ['q_24h', addH(24)], ['q_tomorrow', at(tmr, 10)], ['q_3d', at(d3, 12)], ['q_week', at(wk, 12)]);
    return list;
  }
  function toLocalInput(d) { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); }
  function openDuePopover(anchor, e) {
    const opts = dueQuickOptions();
    const el = popover(anchor, `${opts.map(([k, d]) => `<button class="item" data-due="${d.toISOString()}">${icon('clock', 'sm')}<span>${t(k)}</span><span style="margin-inline-start:auto;color:var(--muted);font-size:11.5px">${esc(fmtRelDay(d.toISOString()))}</span></button>`).join('')}
      <div class="sep"></div><div class="custom"><label class="ctrl-label">${t('q_custom')}</label><input type="datetime-local" class="input" id="dueCustom" value="${e.dueAt ? toLocalInput(e.dueAt) : ''}"><button class="btn sm btn-primary" id="dueApply">${t('save')}</button></div>
      ${e.dueAt ? `<div class="sep"></div><button class="item danger" data-due="">${icon('x', 'sm')}${t('clear')}</button>` : ''}`);
    el.querySelectorAll('[data-due]').forEach(b => b.onclick = () => { setDue(e, b.dataset.due || null); closePopover(); });
    el.querySelector('#dueApply').onclick = () => { const v = el.querySelector('#dueCustom').value; if (v) { setDue(e, new Date(v).toISOString()); } closePopover(); };
  }
  function openSnoozePopover(anchor, e) {
    const now = new Date();
    const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1); tmr.setHours(8, 0, 0, 0);
    const nw = new Date(now); nw.setDate(nw.getDate() + ((7 - nw.getDay()) % 7 || 7)); nw.setHours(8, 0, 0, 0);
    const opts = [['snooze_1h', new Date(now.getTime() + 3600e3)], ['snooze_3h', new Date(now.getTime() + 3 * 3600e3)], ['snooze_tomorrow', tmr], ['snooze_next_week', nw]];
    const el = popover(anchor, `${opts.map(([k, d]) => `<button class="item" data-sn="${d.toISOString()}">${icon('snooze', 'sm')}<span>${t(k)}</span><span style="margin-inline-start:auto;color:var(--muted);font-size:11.5px">${esc(fmtRelDay(d.toISOString()))}</span></button>`).join('')}
      ${isSnoozed(e) ? `<div class="sep"></div><button class="item danger" data-sn="">${icon('x', 'sm')}${t('unsnooze')}</button>` : ''}`);
    el.querySelectorAll('[data-sn]').forEach(b => b.onclick = () => { setSnooze(e, b.dataset.sn || null); closePopover(); });
  }
  function openStatusPopover(anchor, e) {
    const el = popover(anchor, ['todo', 'drafting', 'replied', 'awaiting'].map(s => `<button class="item" data-st="${s}"><span class="dot" style="width:10px;height:10px;border-radius:50%;background:var(--s-${s})"></span>${t('status_' + s)}${e.status === s ? `<span style="margin-inline-start:auto">${icon('check', 'sm')}</span>` : ''}</button>`).join('')
      + (e.status === 'awaiting' ? `<div class="sep"></div><div class="custom"><label class="ctrl-label">${t('followup_label')}</label><input type="datetime-local" class="input" id="fuCustom" value="${e.followUpAt ? toLocalInput(e.followUpAt) : ''}"><button class="btn sm btn-primary" id="fuApply">${t('save')}</button></div>` : ''));
    el.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { setStatus(e, b.dataset.st); closePopover(); });
    const fu = el.querySelector('#fuApply'); if (fu) fu.onclick = async () => { const v = el.querySelector('#fuCustom').value; e.followUpAt = v ? new Date(v).toISOString() : null; e.notified = {}; await saveEmail(e); App.renderAll(); closePopover(); };
  }
  Object.assign(App, { openDuePopover, openSnoozePopover, openStatusPopover, toLocalInput });

  /* ---------- paste modal ---------- */
  function openPasteModal() {
    const m = modal({
      title: t('paste_title'), size: 'lg',
      body: `<p class="inline-note" style="margin:0">${t('paste_hint')}</p>
        <div class="form-row"><div class="field"><label>${t('paste_from')}</label><input class="input" id="pFrom"></div><div class="field"><label>${t('paste_subject')}</label><input class="input" id="pSubject"></div></div>
        <div class="field"><textarea class="textarea" id="pText" style="min-height:220px" placeholder="${esc(t('paste_placeholder'))}" dir="auto"></textarea></div>`,
      footer: `<button class="btn" data-cancel>${t('cancel')}</button><button class="btn btn-primary" data-ok>${icon('upload')}${t('paste_import')}</button>`
    });
    m.el.querySelector('[data-cancel]').onclick = m.close;
    m.el.querySelector('[data-ok]').onclick = async () => {
      const ok = await importPasted(m.el.querySelector('#pText').value, m.el.querySelector('#pFrom').value, m.el.querySelector('#pSubject').value);
      if (ok) m.close();
    };
    setTimeout(() => m.el.querySelector('#pText').focus(), 50);
  }
  App.openPasteModal = openPasteModal;

  function openOnboarding() {
    const m = modal({
      title: t('onboarding_title'), size: 'lg', dismissable: true,
      body: `<div class="onb-steps">${[1, 2, 3].map(n => `<div class="onb-step"><div class="n">${n}</div>${t('onboarding_' + n)}</div>`).join('')}</div><p class="inline-note" style="margin:6px 0 0">${t('about_text')}</p>`,
      footer: `<button class="btn" data-samples>${icon('zap')}${t('onboarding_samples')}</button><button class="btn btn-primary" data-ok>${t('onboarding_start')}</button>`,
      onClose: () => { S.settings.onboarded = true; saveSettings(); }
    });
    m.el.querySelector('[data-ok]').onclick = m.close;
    m.el.querySelector('[data-samples]').onclick = () => { m.close(); loadSamples(); };
  }

  /* ---------- notifications ---------- */
  function notify(title, body) {
    if (!S.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    try { const n = new Notification(title, { body, icon: 'icons/icon-192.png', tag: 'em-' + hash(title + body) }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) { /* ignore */ }
  }
  async function checkDeadlines() {
    const now = Date.now(); const lead = (S.settings.reminderMinutes || 60) * 60000;
    let changed = false;
    for (const e of S.emails) {
      e.notified = e.notified || {};
      if (isOpen(e) && !isSnoozed(e) && e.dueAt) {
        const due = new Date(e.dueAt).getTime();
        if (now >= due && !e.notified.overdue) { notify(t('notif_overdue'), t('notif_body', { s: e.subject, f: e.from.name || e.from.address })); e.notified.overdue = true; changed = true; }
        else if (now >= due - lead && now < due && !e.notified.soon) { notify(t('notif_due_soon'), t('notif_body', { s: e.subject, f: e.from.name || e.from.address })); e.notified.soon = true; changed = true; }
      }
      if (e.status === 'awaiting' && e.followUpAt && now >= new Date(e.followUpAt).getTime() && !e.notified.followup) { notify(t('notif_followup'), t('notif_body', { s: e.subject, f: e.from.name || e.from.address })); e.notified.followup = true; changed = true; }
      if (changed) await DB.putEmail(e);
      changed = false;
    }
    updateCountdowns(); updateCounts();
  }
  App.notify = notify;

  /* ---------- global events ---------- */
  function bindEvents() {
    $$('.nav-item').forEach(b => b.onclick = () => showView(b.dataset.view));
    $('#btnMenu').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
    $('#scrim').onclick = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };
    $('#btnLang').onclick = () => { S.settings.lang = S.settings.lang === 'ar' ? 'en' : 'ar'; saveSettings(); applyLang(); renderAll(); if (S.view === 'settings') App.renderSettings(); };
    $('#btnTheme').onclick = () => { const dark = document.documentElement.getAttribute('data-theme') === 'dark'; S.settings.theme = dark ? 'light' : 'dark'; saveSettings(); applyTheme(); if (S.view === 'settings') App.renderSettings(); };
    $('#btnImport').onclick = () => $('#fileInput').click();
    $('#fileInput').onchange = (ev) => { importFiles(ev.target.files); ev.target.value = ''; };
    $('#btnPaste').onclick = openPasteModal;
    $('#btnSamples').onclick = loadSamples;
    const ss = $('#syncStatus'); if (ss) ss.onclick = () => { const Y = App.Sync; if (!Y) return; if (!Y.state.dir) Y.askToProtect(true); else if (Y.state.status === 'needs-permission' || Y.state.status === 'error') Y.allow(); else showView('settings'); };
    $('#searchInput').addEventListener('input', debounce((ev) => { S.search = ev.target.value; renderList(); }, 150));
    $('#sortSelect').onchange = (ev) => { S.sort = ev.target.value; S.settings.sort = S.sort; saveSettings(); renderList(); };
    $('#filters').onclick = (ev) => { const b = ev.target.closest('[data-filter]'); if (!b) return; S.filter = b.dataset.filter; renderFilters(); renderList(); };
    // list clicks
    $('#emailList').addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]');
      if (act) { const a = act.dataset.act; if (a === 'import') $('#fileInput').click(); else if (a === 'restore') { if (App.Sync) App.Sync.openRestore(); } else if (a === 'samples') loadSamples(); else if (a === 'paste') openPasteModal(); return; }
      const item = ev.target.closest('.email-item'); if (!item) return;
      if (ev.target.classList.contains('check')) { if (ev.target.checked) S.checked.add(item.dataset.id); else S.checked.delete(item.dataset.id); renderList(); return; }
      select(item.dataset.id);
    });
    $('#bulkBar').addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-bulk]'); if (!b) return;
      const ids = Array.from(S.checked); const emails = ids.map(App.getEmail).filter(Boolean);
      if (b.dataset.bulk === 'clear') { S.checked.clear(); renderList(); }
      else if (b.dataset.bulk === 'delete') { if (await confirmDialog(t('delete_many_confirm', { n: ids.length }), { danger: true, okLabel: t('delete') })) { for (const e of emails) { S.emails.splice(S.emails.indexOf(e), 1); await DB.deleteEmail(e.id); } S.checked.clear(); if (ids.includes(S.selectedId)) S.selectedId = null; renderAll(); } }
      else if (b.dataset.bulk === 'priority') { const el = popover(b, prios().map(l => `<button class="item" data-p="${l.id}"><span class="dot" style="width:10px;height:10px;border-radius:50%;background:${esc(l.color)}"></span>${prioShort(l.id)} · ${esc(prioName(l.id))}</button>`).join('')); el.querySelectorAll('[data-p]').forEach(x => x.onclick = async () => { for (const e of emails) { e.priority = +x.dataset.p; e.priorityManual = e.priority !== e.priorityAuto; await DB.putEmail(e); } closePopover(); renderAll(); }); }
      else if (b.dataset.bulk === 'status') { const el = popover(b, ['todo', 'drafting', 'replied', 'awaiting'].map(s => `<button class="item" data-st="${s}"><span class="dot" style="width:10px;height:10px;border-radius:50%;background:var(--s-${s})"></span>${t('status_' + s)}</button>`).join('')); el.querySelectorAll('[data-st]').forEach(x => x.onclick = async () => { for (const e of emails) { await setStatus(e, x.dataset.st); } closePopover(); renderAll(); }); }
    });
    // detail pane delegation
    $('#detailPane').addEventListener('click', async (ev) => {
      const e = App.getEmail(S.selectedId);
      const act = ev.target.closest('[data-act]');
      if (act) { const a = act.dataset.act; if (a === 'import') $('#fileInput').click(); else if (a === 'restore') { if (App.Sync) App.Sync.openRestore(); } else if (a === 'samples') loadSamples(); else if (a === 'paste') openPasteModal(); return; }
      if (!e) return;
      const tab = ev.target.closest('[data-tab]'); if (tab) { S.tab = tab.dataset.tab; renderTabs(); renderTabContent(); const sc = $('#detailScroll'), tb = $('#detailTabs'); if (sc && tb) sc.scrollTo({ top: tb.offsetTop - 4, behavior: 'smooth' }); return; }
      if (ev.target.closest('#btnBack')) { S.selectedId = null; $('#inboxLayout').classList.remove('show-detail'); renderList(); renderDetail(); return; }
      const attBtn = ev.target.closest('[data-attact]');
      if (attBtn) { const chip = attBtn.closest('[data-att]'); attachmentAction(e, chip.dataset.att, attBtn.dataset.attact, attBtn); return; }
      const chipClick = ev.target.closest('.att-chip');
      if (chipClick) { attachmentAction(e, chipClick.dataset.att, 'edit', chipClick); return; }
      const h = ev.target.closest('[data-h]'); if (!h) return;
      const k = h.dataset.h;
      if (k === 'priority') { const b = ev.target.closest('[data-p]'); if (b) setPriority(e, +b.dataset.p, true); }
      else if (k === 'resetp') { e.priority = e.priorityAuto; e.priorityManual = false; await saveEmail(e); renderList(); renderDetailHead(); }
      else if (k === 'status') openStatusPopover(h, e);
      else if (k === 'due') openDuePopover(h, e);
      else if (k === 'snooze') openSnoozePopover(h, e);
      else if (k === 'vip') toggleVip(e);
      else if (k === 'calendar') App.Features.calendarEvent(e);
      else if (k === 'print') App.Features.printEmail(e);
      else if (k === 'sender') App.Features.showSender(e);
      else if (k === 'delete') { if (await confirmDialog(t('delete_confirm'), { danger: true, okLabel: t('delete') })) deleteEmail(e); }
      else if (k === 'tags') { const x = ev.target.closest('[data-tag]'); if (x) { e.tags = e.tags.filter(tg => tg !== x.dataset.tag); await saveEmail(e); renderDetailHead(); renderList(); } }
      else if (k === 'loadimages') { S.allowRemote.add(e.id); renderTabContent(); }
    });
    $('#detailPane').addEventListener('keydown', async (ev) => {
      if (ev.target.matches('[data-h="tagInput"]') && ev.key === 'Enter') {
        const e = App.getEmail(S.selectedId); const v = ev.target.value.trim(); if (!e || !v) return;
        if (!e.tags.includes(v)) e.tags.push(v); await saveEmail(e); renderDetailHead(); renderList(); $('[data-h="tagInput"]').focus();
      }
    });
    // keyboard shortcuts
    document.addEventListener('keydown', (ev) => {
      if (App.Editor && App.Editor.state.open) return; // the attachment editor handles its own keys
      if (ev.target.matches('input, textarea, select, [contenteditable]')) { if (ev.key === 'Escape') ev.target.blur(); return; }
      if ($('#modalRoot').classList.contains('show')) return;
      const e = App.getEmail(S.selectedId);
      const list = visibleEmails();
      if (ev.key === '/') { ev.preventDefault(); $('#searchInput').focus(); }
      else if (ev.key === 'j' || ev.key === 'k' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (S.view !== 'inbox' || !list.length) return; ev.preventDefault();
        const i = list.findIndex(x => x.id === S.selectedId); const dir = (ev.key === 'j' || ev.key === 'ArrowDown') ? 1 : -1;
        const n = list[Math.max(0, Math.min(list.length - 1, i + dir))]; if (n) { select(n.id); const it = $(`.email-item[data-id="${n.id}"]`); if (it) it.scrollIntoView({ block: 'nearest' }); }
      }
      else if (e && ev.key === 'r') { S.tab = 'reply'; renderTabs(); renderTabContent(); }
      else if (e && /^[1-9]$/.test(ev.key) && prios()[+ev.key - 1]) setPriority(e, prios()[+ev.key - 1].id, true);
      else if (e && ev.key === 'e') setStatus(e, e.status === 'replied' ? 'todo' : 'replied');
      else if (e && ev.key === 'Delete') { confirmDialog(t('delete_confirm'), { danger: true, okLabel: t('delete') }).then(ok => ok && deleteEmail(e)); }
      else if (ev.key === 'Escape') { closePopover(); }
    });
    // drag & drop
    let dragDepth = 0;
    const overlay = $('#dropOverlay');
    const hasFiles = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).some(x => x === 'Files' || x === 'text/plain');
    document.addEventListener('dragenter', (ev) => {
      if (!hasFiles(ev)) return; ev.preventDefault(); dragDepth++;
      const notesMode = !!(S.selectedId && S.view === 'inbox' && S.tab === 'notes' && $('#notesCard'));
      overlay.querySelector('h2').textContent = notesMode ? t('drop_notes_title') : t('drop_title');
      overlay.querySelector('p').textContent = notesMode ? t('drop_notes_sub') : t('drop_sub');
      overlay.classList.add('show');
    });
    document.addEventListener('dragover', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
    document.addEventListener('dragleave', (ev) => { if (!hasFiles(ev)) return; dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) overlay.classList.remove('show'); });
    document.addEventListener('drop', async (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault(); dragDepth = 0; overlay.classList.remove('show');
      // ignore drops that originated from inside the app (kanban)
      if (ev.dataTransfer.getData('application/x-em-card')) return;
      const files = [];
      if (ev.dataTransfer.items && ev.dataTransfer.items.length) {
        for (const it of Array.from(ev.dataTransfer.items)) { if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); } }
      }
      if (!files.length && ev.dataTransfer.files && ev.dataTransfer.files.length) files.push(...Array.from(ev.dataTransfer.files));
      const cur = App.getEmail(S.selectedId);
      const notesZone = cur && S.view === 'inbox' && S.tab === 'notes' && $('#notesCard');
      if (notesZone && cur) { if (files.length) return App.addNoteFiles(cur, files); const txt = ev.dataTransfer.getData('text/plain'); if (txt && txt.trim()) { cur.noteItems = cur.noteItems || []; cur.noteItems.push({ id: uid(), kind: 'text', text: txt.trim(), createdAt: new Date().toISOString() }); await saveEmail(cur); App.renderTabContent(); } return; }
      if (files.length) return importFiles(files);
      const text = ev.dataTransfer.getData('text/plain');
      if (text && text.trim().length > 20) importPasted(text);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'system') applyTheme(); });
    window.addEventListener('resize', () => { $('#inboxLayout').classList.toggle('show-detail', !!S.selectedId); });
  }

  /* ---------- init ---------- */
  async function init() {
    loadSettings();
    S.sort = S.settings.sort || 'priority';
    applyLang(); applyTheme(); applyPriorityStyles();
    try { S.emails = await DB.getAllEmails(); } catch (err) { console.error(err); S.emails = []; }
    S.emails.forEach(e => { e.tags = e.tags || []; e.attachments = e.attachments || []; e.notified = e.notified || {}; e.noteItems = e.noteItems || []; });
    bindEvents();
    renderAll();
    setInterval(checkDeadlines, 30000);
    checkDeadlines();
    setTimeout(() => { if (App.Features) App.Features.dailyAgenda(); }, 2500);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) { navigator.serviceWorker.register('sw.js').catch(() => { }); }
    if (!S.settings.onboarded) setTimeout(openOnboarding, 300);
    if (App.initBackup) App.initBackup();
    // PWA: files opened with the app (file handler) and shortcut hashes
    if ('launchQueue' in window && window.launchQueue.setConsumer) {
      window.launchQueue.setConsumer(async (params) => {
        if (!params.files || !params.files.length) return;
        const files = [];
        for (const h of params.files) { try { files.push(await h.getFile()); } catch (e) { /* ignore */ } }
        importFiles(files);
      });
    }
    const h = (location.hash || '').replace('#', '');
    if (['board', 'stats', 'settings'].includes(h)) showView(h);
  }
  document.addEventListener('DOMContentLoaded', init);
  global.App = App;
})(window);
