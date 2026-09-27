/* ============================================================
   notes.js — rich notes per email: text notes, images, files
   and voice recordings (stored locally with the email).
   ============================================================ */
(function (global) {
  'use strict';
  const App = global.App;
  const { t } = I18N;
  const S = App.state;
  const { $, $$, esc, icon, toast, fmtSize, uid, debounce } = App;

  const REC = { rec: null, stream: null, chunks: [], start: 0, timer: null, emailId: null };

  function noteCount(e) { return (e.noteItems || []).length + (e.notes && e.notes.trim() ? 1 : 0); }
  App.noteCount = noteCount;

  function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`; }
  function kindForFile(file) {
    const type = (file.type || '').toLowerCase(); const ext = (file.name || '').split('.').pop().toLowerCase();
    if (/^image\//.test(type) || /^(png|jpe?g|gif|webp|bmp|svg)$/.test(ext)) return 'image';
    if (/^audio\//.test(type) || /^(mp3|wav|m4a|ogg|webm|opus|aac)$/.test(ext)) return 'audio';
    return 'file';
  }

  async function addNoteFile(e, blob, name, kind, extra) {
    const id = uid();
    const type = blob.type || 'application/octet-stream';
    await DB.putFile({ id, emailId: e.id, name, type, blob, note: true });
    e.noteItems = e.noteItems || [];
    e.noteItems.push(Object.assign({ id, kind, name, type, size: blob.size, createdAt: new Date().toISOString() }, extra || {}));
    await App.saveEmail(e);
    refresh(e);
    toast(t('note_added'), 'success');
    return e.noteItems[e.noteItems.length - 1];
  }
  async function addNoteFiles(e, files) {
    for (const f of Array.from(files || [])) { if (!f || !f.size && f.size !== 0) continue; await addNoteFile(e, f, f.name || ('file-' + stamp()), kindForFile(f)); }
  }
  App.addNoteFile = addNoteFile; App.addNoteFiles = addNoteFiles;

  async function addTextNote(e, text) {
    text = (text || '').trim(); if (!text) return;
    e.noteItems = e.noteItems || [];
    e.noteItems.push({ id: uid(), kind: 'text', text, createdAt: new Date().toISOString() });
    await App.saveEmail(e);
    refresh(e);
  }
  async function deleteNote(e, id) {
    const item = (e.noteItems || []).find(x => x.id === id); if (!item) return;
    if (!(await App.confirmDialog(t('note_delete_confirm'), { danger: true, okLabel: t('delete') }))) return;
    e.noteItems = e.noteItems.filter(x => x.id !== id);
    if (item.kind !== 'text') await DB.deleteFile(id);
    await App.saveEmail(e);
    refresh(e);
  }
  function refresh(e) {
    if (S.selectedId === e.id && S.tab === 'notes') { const el = $('#tabContent'); if (el) renderNotesTab(e, el); }
    App.renderTabs(); App.renderList();
  }

  /* ---------- voice recording ---------- */
  function recSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && global.MediaRecorder); }
  async function toggleRecord(e) {
    if (REC.rec) { try { REC.rec.stop(); } catch (err) { /* ignore */ } return; }
    if (!recSupported()) { toast(t('mic_unsupported'), 'error'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      REC.rec = rec; REC.stream = stream; REC.chunks = []; REC.start = Date.now(); REC.emailId = e.id;
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) REC.chunks.push(ev.data); };
      rec.onstop = async () => {
        clearInterval(REC.timer); REC.timer = null;
        stream.getTracks().forEach(tr => tr.stop());
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(REC.chunks, { type });
        const dur = Math.round((Date.now() - REC.start) / 1000);
        REC.rec = null; REC.stream = null; REC.chunks = [];
        updateRecUi();
        if (blob.size < 100) { toast(t('mic_empty'), 'error'); return; }
        const ext = /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
        const target = App.getEmail(REC.emailId) || e;
        await addNoteFile(target, blob, `${t('voice_note')} ${stamp()}.${ext}`, 'audio', { duration: dur });
      };
      rec.onerror = () => { toast(t('mic_error', { e: 'recorder' }), 'error'); };
      rec.start(250);
      REC.timer = setInterval(updateRecUi, 500);
      updateRecUi();
    } catch (err) {
      toast(t('mic_error', { e: err && err.name === 'NotAllowedError' ? t('mic_denied') : (err.message || err) }), 'error');
    }
  }
  function updateRecUi() {
    const btn = $('#noteRecord'), st = $('#recStatus'); if (!btn) return;
    if (REC.rec) {
      const s = Math.round((Date.now() - REC.start) / 1000);
      btn.classList.add('recording'); btn.innerHTML = `${icon('square', 'sm')}${t('stop_recording')}`;
      st.innerHTML = `<span class="rec-dot"></span> ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    } else { btn.classList.remove('recording'); btn.innerHTML = `${icon('mic', 'sm')}${t('record_voice')}`; st.innerHTML = ''; }
  }
  function fmtDur(sec) { if (!sec && sec !== 0) return ''; return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }

  /* ---------- render ---------- */
  async function renderNotesTab(e, el) {
    e.noteItems = e.noteItems || [];
    const items = e.noteItems.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    el.innerHTML = `<div class="card" id="notesCard">
      <div class="card-head"><div><h3>${icon('edit')}${t('tab_notes')}</h3><div class="sub">${t('notes_private_hint')}</div></div><span class="spacer"></span>${noteCount(e) ? `<span class="chip sm">${noteCount(e)}</span>` : ''}</div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:14px">
        <div class="field"><label>${t('quick_note')}</label><textarea class="textarea" id="notesArea" style="min-height:70px" placeholder="${t('notes_placeholder')}" dir="auto">${esc(e.notes || '')}</textarea></div>
        <div class="note-add" id="notesDrop">
          <textarea class="textarea" id="noteText" style="min-height:64px" placeholder="${t('note_text_placeholder')}" dir="auto"></textarea>
          <div class="composer-toolbar">
            <button class="btn sm btn-primary" id="noteAddText">${icon('plus', 'sm')}${t('add_note')}</button>
            <button class="btn sm" id="noteAddImage">${icon('image', 'sm')}${t('add_image')}</button>
            <button class="btn sm" id="noteAddFile">${icon('clip', 'sm')}${t('add_file')}</button>
            <button class="btn sm ${REC.rec ? 'recording' : ''}" id="noteRecord" ${recSupported() ? '' : 'disabled'}>${icon('mic', 'sm')}${t('record_voice')}</button><span class="rec-status" id="recStatus"></span>
            <input type="file" id="noteImageInput" accept="image/*" multiple hidden><input type="file" id="noteFileInput" multiple hidden>
          </div>
          <div class="inline-note">${t('notes_drop_hint')}</div>
        </div>
        <div class="note-list" id="noteList">${items.length ? '' : `<div class="inline-note">${t('notes_empty')}</div>`}</div>
      </div></div>`;
    const list = $('#noteList', el);
    for (const it of items) list.appendChild(await noteItemEl(e, it));
    updateRecUi();
    // bindings
    const ta = $('#notesArea', el);
    ta.addEventListener('input', debounce(() => { e.notes = ta.value; App.saveEmail(e); App.renderList(); App.renderTabs(); }, 600));
    const nt = $('#noteText', el);
    $('#noteAddText', el).onclick = () => { addTextNote(e, nt.value); };
    nt.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); addTextNote(e, nt.value); } });
    $('#noteAddImage', el).onclick = () => $('#noteImageInput', el).click();
    $('#noteAddFile', el).onclick = () => $('#noteFileInput', el).click();
    $('#noteImageInput', el).onchange = (ev) => { addNoteFiles(e, ev.target.files); ev.target.value = ''; };
    $('#noteFileInput', el).onchange = (ev) => { addNoteFiles(e, ev.target.files); ev.target.value = ''; };
    $('#noteRecord', el).onclick = () => toggleRecord(e);
    el.querySelector('#notesCard').addEventListener('paste', (ev) => {
      const files = Array.from((ev.clipboardData && ev.clipboardData.files) || []);
      if (files.length) { ev.preventDefault(); addNoteFiles(e, files); }
    });
    list.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-nact]'); if (!b) return;
      const row = b.closest('[data-note]'); const it = e.noteItems.find(x => x.id === row.dataset.note); if (!it) return;
      const act = b.dataset.nact;
      if (act === 'delete') return deleteNote(e, it.id);
      if (act === 'edit') return editTextNote(e, it, row);
      if (act === 'open') return openNoteFile(e, it);
      if (act === 'download') { const f = await DB.getFile(it.id); if (f) App.saveBlobAs(f.blob, it.name); return; }
    });
  }
  App.renderNotesTab = renderNotesTab;

  async function noteItemEl(e, it) {
    const row = document.createElement('div');
    row.className = 'note-item kind-' + it.kind; row.dataset.note = it.id;
    const when = App.fmtDateTime(it.createdAt);
    let body = '';
    if (it.kind === 'text') body = `<div class="note-text" dir="auto">${esc(it.text)}</div>`;
    else if (it.kind === 'image') { const url = await App.getAttachmentUrl(e, { id: it.id }); body = `<div class="note-img"><img src="${url || ''}" alt="${esc(it.name)}" data-nact="open"><div class="note-file-name" dir="auto">${esc(it.name)} · ${fmtSize(it.size)}</div></div>`; }
    else if (it.kind === 'audio') { const url = await App.getAttachmentUrl(e, { id: it.id }); body = `<div class="note-audio"><audio controls preload="metadata" src="${url || ''}"></audio><div class="note-file-name" dir="auto">${icon('mic', 'sm')} ${esc(it.name)}${it.duration ? ' · ' + fmtDur(it.duration) : ''} · ${fmtSize(it.size)}</div></div>`; }
    else body = `<button class="note-file" data-nact="open"><span class="ico">${esc((it.name.split('.').pop() || 'file').slice(0, 4))}</span><span class="nm" dir="auto">${esc(it.name)}</span><span class="sz">${fmtSize(it.size)}</span></button>`;
    row.innerHTML = `<div class="note-meta"><span class="note-kind">${icon(it.kind === 'text' ? 'edit' : it.kind === 'image' ? 'image' : it.kind === 'audio' ? 'mic' : 'clip', 'sm')}${t('note_kind_' + it.kind)}</span><span class="note-when">${esc(when)}</span><span class="spacer"></span>
      ${it.kind === 'text' ? `<button class="icon-btn sm" data-nact="edit" title="${t('edit')}">${icon('edit', 'sm')}</button>` : `<button class="icon-btn sm" data-nact="download" title="${t('save_attachment')}">${icon('download', 'sm')}</button>`}
      <button class="icon-btn sm" data-nact="delete" title="${t('delete')}" style="color:var(--danger)">${icon('trash', 'sm')}</button></div>${body}`;
    return row;
  }
  function editTextNote(e, it, row) {
    const box = row.querySelector('.note-text'); if (!box) return;
    box.innerHTML = `<textarea class="textarea" style="min-height:80px" dir="auto">${esc(it.text)}</textarea><div class="composer-toolbar" style="margin-top:8px"><button class="btn xs btn-primary" data-save>${t('save')}</button><button class="btn xs" data-cancel>${t('cancel')}</button></div>`;
    const ta = box.querySelector('textarea'); ta.focus();
    box.querySelector('[data-save]').onclick = async () => { it.text = ta.value.trim() || it.text; it.editedAt = new Date().toISOString(); await App.saveEmail(e); refresh(e); };
    box.querySelector('[data-cancel]').onclick = () => refresh(e);
  }
  function openNoteFile(e, it) {
    const att = { id: it.id, name: it.name, type: it.type, size: it.size };
    if (App.Editor) App.Editor.open(e, att, { note: it });
  }
  App.openNoteFile = openNoteFile;
})(window);
