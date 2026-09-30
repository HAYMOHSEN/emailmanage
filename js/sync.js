/* ============================================================
   sync.js — backup & sync through a cloud folder
   Emails live in the browser's site storage, which is deleted together with
   browsing data. This module keeps a copy of everything in a folder the person
   chooses — ideally inside OneDrive, Google Drive or Dropbox — and merges what
   other PCs wrote there, so the same emails are available on every PC that
   shares the folder. Newest change per email wins; deletions travel as
   tombstones. Format: email-management-sync.json + files/<id> (binary), plus a
   single-file backup (email-management-backup.json, attachments inline) that
   phones can import.
   ============================================================ */
(function (global) {
  'use strict';
  const App = global.App;
  const { t } = I18N;
  const S = App.state;
  const { $, $$, esc, icon, toast } = App;

  const MANIFEST = 'email-management-sync.json';
  const LEGACY = 'email-management-backup.json';
  const FULL_EVERY = 10 * 60000;          // single-file backup at most every 10 min
  const PULL_EVERY = 3 * 60000;           // look for changes from other PCs
  const WRITE_DELAY = 3000;               // quiet time after a change
  const TOMB_KEEP = 90 * 86400000;        // remember deletions for 90 days
  const ASK_AGAIN = 7 * 86400000;

  const supported = typeof window.showDirectoryPicker === 'function';
  const st = { dir: null, status: 'off', lastSync: 0, lastPulledMod: 0, lastFull: 0, lastSavedAt: '', writing: false, queued: false, timer: 0, pulling: false, asked: false, known: null, deviceId: '' };

  const deviceId = () => { if (!st.deviceId) { st.deviceId = localStorage.getItem('em.deviceId') || ('dev-' + Math.random().toString(36).slice(2, 10)); localStorage.setItem('em.deviceId', st.deviceId); } return st.deviceId; };
  const tombstones = () => { try { return JSON.parse(localStorage.getItem('em.tombstones') || '{}') || {}; } catch (e) { return {}; } };
  const saveTombstones = (obj) => localStorage.setItem('em.tombstones', JSON.stringify(obj));
  const ms = (iso) => { const v = new Date(iso || 0).getTime(); return isNaN(v) ? 0 : v; };

  /* ---------- status ---------- */
  function statusText() {
    if (!supported) return t('folder_unsupported');
    switch (st.status) {
      case 'on': return t('sync_status_on', { f: st.dir ? st.dir.name : '' }) + (st.lastSync ? ' · ' + t('sync_last', { t: new Date(st.lastSync).toLocaleTimeString(I18N.getLang() === 'ar' ? 'ar' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) }) : '');
      case 'needs-permission': return t('sync_status_paused');
      case 'error': return t('sync_status_error');
      default: return t('sync_status_off');
    }
  }
  function isProtected() { return st.status === 'on' && !!st.dir; }
  function renderStatus() {
    const box = $('#syncStatus');
    if (box) {
      const warn = supported && !st.dir && S.emails.length > 0;
      box.hidden = !supported;
      box.className = 'sync-status ' + (st.status === 'on' ? 'on' : warn ? 'warn' : st.status === 'needs-permission' || st.status === 'error' ? 'paused' : '');
      box.innerHTML = `${icon(st.status === 'on' ? 'shield' : warn ? 'info' : 'folder')}<span class="txt"><strong>${esc(st.dir ? (st.status === 'on' ? t('sync_on_short') : t('sync_paused_short')) : (warn ? t('sync_not_protected') : t('sync_off_short')))}</strong><small>${esc(st.dir ? st.dir.name : (warn ? t('sync_protect_action') : t('sync_off_hint')))}</small></span>`;
    }
    const line = $('#bkStatus'); if (line) line.textContent = statusText();
    const nm = $('#bkName'); if (nm) nm.textContent = st.dir ? st.dir.name : '—';
  }
  function setStatus(s) { st.status = s; renderStatus(); }

  /* ---------- permission ---------- */
  async function permission(ask) {
    if (!st.dir) return 'none';
    try {
      let p = await st.dir.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted' && ask) p = await st.dir.requestPermission({ mode: 'readwrite' });
      return p;
    } catch (e) { return 'denied'; }
  }
  /* Runs from a click: ask for access, then catch up in both directions. */
  async function allow() {
    const p = await permission(true);
    if (p !== 'granted') return;
    setStatus('on');
    await pull();
    scheduleWrite(0);
  }

  /* ---------- folder ---------- */
  async function chooseFolder() {
    if (!supported) { toast(t('folder_unsupported'), 'error'); return false; }
    let dir = null;
    try { dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'em-backup', startIn: 'documents' }); } catch (e) { return false; }
    st.dir = dir; st.known = null; st.lastPulledMod = 0;
    try { await DB.kvSet('backupDir', dir); } catch (e) { /* session only */ }
    S.settings.autoBackup = true; S.settings.syncDismissed = 0; App.saveSettings();
    setStatus('on');
    const pulled = await pull();           // another PC may already keep its emails here
    await write(true);
    if (!pulled) toast(t('sync_enabled', { f: dir.name }), 'success');
    renderStatus();
    return true;
  }
  async function forgetFolder() {
    st.dir = null; st.known = null;
    try { await DB.kvDel('backupDir'); } catch (e) { /* nothing stored */ }
    S.settings.autoBackup = false; App.saveSettings();
    setStatus('off');
    toast(t('sync_forgotten'));
  }

  /* ---------- writing ---------- */
  function scheduleWrite(delay) {
    if (!st.dir || S.settings.autoBackup === false) return;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => write(false), delay === undefined ? WRITE_DELAY : delay);
  }
  async function knownFiles() {
    if (st.known) return st.known;
    const set = new Set();
    try { const d = await st.dir.getDirectoryHandle('files', { create: true }); for await (const [name, h] of d.entries()) if (h.kind === 'file') set.add(name); } catch (e) { /* empty */ }
    st.known = set;
    return set;
  }
  function cleanSettings() { const s = Object.assign({}, S.settings); s.ai = Object.assign({}, s.ai || {}, { apiKey: '' }); delete s.syncDismissed; return s; }
  async function write(announce) {
    if (!st.dir) return false;
    if (st.writing) { st.queued = true; return false; }
    st.writing = true;
    try {
      const p = await permission(announce);
      if (p !== 'granted') { setStatus('needs-permission'); if (announce) toast(t('backup_permission'), '', { label: t('allow'), fn: allow }); return false; }
      const known = await knownFiles();
      const filesDir = await st.dir.getDirectoryHandle('files', { create: true });
      const all = await DB.getAllFiles();
      const index = [];
      for (const f of all) {
        index.push({ id: f.id, emailId: f.emailId, name: f.name, type: f.type, size: f.blob ? f.blob.size : 0 });
        if (known.has(f.id)) continue;
        const fh = await filesDir.getFileHandle(f.id, { create: true });
        const w = await fh.createWritable(); await w.write(f.blob); await w.close();
        known.add(f.id);
      }
      const tomb = tombstones(); const cutoff = Date.now() - TOMB_KEEP;
      for (const id of Object.keys(tomb)) if (tomb[id] < cutoff) delete tomb[id];
      saveTombstones(tomb);
      const savedAt = new Date().toISOString();
      const manifest = { app: 'email-management', format: 2, version: App.APP_VERSION, deviceId: deviceId(), savedAt, settings: cleanSettings(), emails: S.emails, files: index, tombstones: tomb };
      const mh = await st.dir.getFileHandle(MANIFEST, { create: true });
      const mw = await mh.createWritable(); await mw.write(JSON.stringify(manifest)); await mw.close();
      st.lastSavedAt = savedAt;
      try { st.lastPulledMod = (await mh.getFile()).lastModified; } catch (e) { /* fine */ }
      if (announce || Date.now() - st.lastFull > FULL_EVERY) {
        // the single-file backup (attachments inline) that a phone or another browser can import
        const full = await App.buildExport();
        const fh = await st.dir.getFileHandle(LEGACY, { create: true });
        const fw = await fh.createWritable(); await fw.write(JSON.stringify(full)); await fw.close();
        st.lastFull = Date.now();
      }
      st.lastSync = Date.now();
      setStatus('on');
      if (announce) toast(t('backup_done', { f: st.dir.name }), 'success');
      return true;
    } catch (err) {
      setStatus(err && err.name === 'NotAllowedError' ? 'needs-permission' : 'error');
      if (announce) toast(t('backup_failed', { e: err.message || err }), 'error');
      return false;
    } finally {
      st.writing = false;
      if (st.queued) { st.queued = false; scheduleWrite(500); }
    }
  }

  /* ---------- reading & merging ---------- */
  async function readManifest() {
    let fh = null;
    try { fh = await st.dir.getFileHandle(MANIFEST); } catch (e) { return null; }
    const file = await fh.getFile();
    return { file, data: JSON.parse(await file.text()) };
  }
  async function fetchFiles(list) {
    const out = [];
    let dir = null;
    try { dir = await st.dir.getDirectoryHandle('files'); } catch (e) { return out; }
    for (const f of list) {
      try { const fh = await dir.getFileHandle(f.id); const blob = await fh.getFile(); out.push({ id: f.id, emailId: f.emailId, name: f.name, type: f.type, blob: new Blob([blob], { type: f.type || 'application/octet-stream' }) }); }
      catch (e) { /* file not synced yet: picked up on a later pull */ }
    }
    return out;
  }
  function mergeSettings(inc) {
    if (!inc) return;
    const cur = S.settings;
    ['vipSenders', 'customKeywords', 'myAddresses'].forEach(k => { if (Array.isArray(inc[k])) cur[k] = Array.from(new Set((cur[k] || []).concat(inc[k].filter(x => typeof x === 'string')))); });
    if (Array.isArray(inc.templates)) { cur.templates = cur.templates || []; inc.templates.forEach(tp => { if (tp && tp.title && !cur.templates.some(x => x.title === tp.title)) cur.templates.push(tp); }); }
    ['myName', 'myRole', 'signature', 'officeHours'].forEach(k => { if (!cur[k] && inc[k]) cur[k] = inc[k]; });
    App.saveSettings();
  }
  /* Merge the folder's copy into this PC. Returns the number of emails added or updated. */
  async function pull() {
    if (!st.dir || st.pulling) return 0;
    st.pulling = true;
    try {
      if ((await permission(false)) !== 'granted') { setStatus('needs-permission'); return 0; }
      const wasEmpty = S.emails.length === 0;
      const m = await readManifest();
      if (!m) {
        // a folder from the earlier version holds only the single-file backup
        try { const fh = await st.dir.getFileHandle(LEGACY); const n = await App.importJSON(await fh.getFile(), { silent: true }); if (n) { toast(t('sync_restored', { n, f: st.dir.name }), 'success'); return n; } } catch (e) { /* nothing there */ }
        return 0;
      }
      if (m.file.lastModified === st.lastPulledMod) return 0;
      st.lastPulledMod = m.file.lastModified;
      const data = m.data;
      if (!data || !Array.isArray(data.emails)) return 0;
      if (data.deviceId === deviceId() && data.savedAt === st.lastSavedAt) return 0;   // our own write
      const tomb = tombstones();
      for (const [id, ts] of Object.entries(data.tombstones || {})) tomb[id] = Math.max(tomb[id] || 0, ts);
      saveTombstones(tomb);
      const byId = new Map(S.emails.map(e => [e.id, e]));
      const fps = new Set(S.emails.map(e => e.fingerprint));
      const remoteFiles = data.files || [];
      let changed = 0, needWrite = false;
      for (const r of data.emails) {
        if (!r || !r.id) continue;
        if ((tomb[r.id] || 0) > ms(r.updatedAt)) continue;
        const l = byId.get(r.id);
        if (!l) {
          if (fps.has(r.fingerprint)) continue;
          r.tags = r.tags || []; r.attachments = r.attachments || []; r.notified = r.notified || {}; r.noteItems = r.noteItems || [];
          S.emails.push(r); byId.set(r.id, r); fps.add(r.fingerprint);
          await DB.putEmail(r);
          const fl = await fetchFiles(remoteFiles.filter(f => f.emailId === r.id)); if (fl.length) await DB.putFiles(fl);
          changed++;
        } else if (ms(r.updatedAt) > ms(l.updatedAt)) {
          for (const k of Object.keys(l)) if (!(k in r)) delete l[k];
          Object.assign(l, r);
          await DB.putEmail(l);
          const have = new Set((await DB.getFilesFor(r.id)).map(f => f.id));
          const fl = await fetchFiles(remoteFiles.filter(f => f.emailId === r.id && !have.has(f.id))); if (fl.length) await DB.putFiles(fl);
          changed++;
        } else if (ms(l.updatedAt) > ms(r.updatedAt)) needWrite = true;
      }
      const remoteIds = new Set(data.emails.map(e => e.id));
      for (const e of S.emails.slice()) {
        if ((tomb[e.id] || 0) > ms(e.updatedAt)) {           // deleted on another PC after our last change
          S.emails.splice(S.emails.indexOf(e), 1); await DB.deleteEmail(e.id); if (S.selectedId === e.id) S.selectedId = null; S.checked.delete(e.id); changed++;
        } else if (!remoteIds.has(e.id)) needWrite = true;    // only here: give it to the folder
      }
      mergeSettings(data.settings);
      st.lastSync = Date.now(); setStatus('on');
      if (changed) {
        App.renderAll();
        toast(wasEmpty ? t('sync_restored', { n: changed, f: st.dir.name }) : t('sync_pulled', { n: changed }), 'success');
      }
      if (needWrite) scheduleWrite(1500);
      return changed;
    } catch (err) {
      setStatus('error');
      return 0;
    } finally { st.pulling = false; }
  }

  /* ---------- deletions travel as tombstones ---------- */
  function noteDeleted(id) { const tomb = tombstones(); tomb[id] = Date.now(); saveTombstones(tomb); scheduleWrite(); }
  function undoDeleted(id) { const tomb = tombstones(); delete tomb[id]; saveTombstones(tomb); scheduleWrite(); }

  /* ---------- the "protect" step ---------- */
  function shouldAsk() {
    if (!supported || st.dir || st.asked || !S.emails.length) return false;
    return Date.now() - (S.settings.syncDismissed || 0) > ASK_AGAIN;
  }
  function askToProtect(force) {
    if (!force && !shouldAsk()) return;
    if ($('#modalRoot').classList.contains('show')) { setTimeout(() => askToProtect(false), 15000); return; }
    st.asked = true;
    const m = App.modal({
      title: t('sync_title'), size: 'md', dismissable: true,
      body: `<p style="margin:0 0 10px">${t('sync_body1')}</p><p style="margin:0 0 10px">${t('sync_body2')}</p><p class="inline-note" style="margin:0">${icon('info', 'sm')} ${t('sync_perm_hint')}</p>`,
      footer: `<button class="btn" data-later>${t('sync_later')}</button><button class="btn btn-primary" data-choose>${icon('folder')}${t('sync_choose')}</button>`,
      onClose: () => { if (!st.dir) { S.settings.syncDismissed = Date.now(); App.saveSettings(); } }
    });
    m.el.querySelector('[data-later]').onclick = m.close;
    m.el.querySelector('[data-choose]').onclick = async () => { const ok = await chooseFolder(); if (ok) m.close(); };
  }
  function nudgeAfterImport() { if (shouldAsk()) setTimeout(() => askToProtect(false), 2000); }

  /* ---------- restore (welcome / empty state) ---------- */
  function openRestore() {
    const m = App.modal({
      title: t('restore_title'), size: 'md', dismissable: true,
      body: `<p style="margin:0 0 12px">${t('restore_hint')}</p><input type="file" id="restoreFile" accept="application/json,.json" hidden>`,
      footer: `<button class="btn" data-file>${icon('upload')}${t('restore_file')}</button>${supported ? `<button class="btn btn-primary" data-folder>${icon('folder')}${t('restore_folder')}</button>` : ''}`
    });
    const fi = m.el.querySelector('#restoreFile');
    m.el.querySelector('[data-file]').onclick = () => fi.click();
    fi.onchange = async () => { if (fi.files[0]) { m.close(); await App.importJSON(fi.files[0]); } };
    const fb = m.el.querySelector('[data-folder]');
    if (fb) fb.onclick = async () => { const ok = await chooseFolder(); if (ok) m.close(); };
  }

  /* ---------- start ---------- */
  async function init() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
    if (!supported) { renderStatus(); return; }
    try { st.dir = await DB.kvGet('backupDir'); } catch (e) { st.dir = null; }
    if (!st.dir) { renderStatus(); setTimeout(() => askToProtect(false), 8000); return; }
    if (S.settings.autoBackup === false) S.settings.autoBackup = true;    // a chosen folder now always means "keep it current"
    const p = await permission(false);
    if (p === 'granted') { setStatus('on'); await pull(); }
    else { setStatus('needs-permission'); toast(S.emails.length ? t('backup_permission') : t('sync_restore_offer'), '', { label: t('allow'), fn: allow }); }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
    setInterval(pull, PULL_EVERY);
  }

  const Sync = { supported, init, chooseFolder, forgetFolder, allow, pull, write, scheduleWrite, noteDeleted, undoDeleted, askToProtect, nudgeAfterImport, openRestore, statusText, renderStatus, isProtected, state: st };
  App.Sync = Sync;
  App.scheduleAutoBackup = () => scheduleWrite();
  App.backupNow = () => write(true);
  App.initBackup = init;
})(window);
