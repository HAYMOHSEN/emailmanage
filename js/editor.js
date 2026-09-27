/* ============================================================
   editor.js — in-app attachment viewer & editor
   • PDF: render with pdf.js, annotate (pen, highlighter, text,
     rectangle, select/move, eraser, undo/redo), save a flattened
     copy with pdf-lib (annotations stay editable in the app).
   • Images: same annotation tools, export PNG/JPEG.
   • Text files: plain editor.
   • Other files: save / open / upload an edited version.
   ============================================================ */
(function (global) {
  'use strict';
  const App = global.App;
  const { t } = I18N;
  const S = App.state;
  const { $, $$, esc, icon, toast, fmtSize } = App;

  const FONT = '"Inter","IBM Plex Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif';
  const COLORS = ['#e03131', '#1c7ed6', '#2f9e44', '#f08c00', '#7b3fe4', '#ffd43b', '#1b1f2a', '#ffffff'];
  const TEXT_EXT = /^(txt|csv|tsv|md|markdown|json|log|xml|ini|cfg|yaml|yml|js|css|py|c|cpp|h|java|tex|srt|vtt)$/;
  const IMG_EXT = /^(png|jpe?g|gif|webp|bmp)$/;

  function extOf(name) { return (String(name || '').split('.').pop() || '').toLowerCase(); }
  function kindOf(a) {
    const ext = extOf(a.name); const type = (a.type || '').toLowerCase();
    if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
    if (IMG_EXT.test(ext) || /^image\/(png|jpeg|gif|webp|bmp)/.test(type)) return 'image';
    if (TEXT_EXT.test(ext) || (/^text\/(plain|csv|markdown|xml)/.test(type) && ext !== 'html' && ext !== 'htm') || type === 'application/json') return 'text';
    return 'other';
  }

  /* ---------- lazy libraries ---------- */
  let pdfjsLib = null, pdfLibP = null;
  async function loadPdfJs() {
    if (pdfjsLib) return pdfjsLib;
    const base = document.baseURI;
    const mod = await import(new URL('lib/pdfjs/pdf.min.mjs', base).href);
    mod.GlobalWorkerOptions.workerSrc = new URL('lib/pdfjs/pdf.worker.min.mjs', base).href;
    pdfjsLib = mod;
    return mod;
  }
  function loadPdfLib() {
    if (global.PDFLib) return Promise.resolve(global.PDFLib);
    if (!pdfLibP) pdfLibP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'lib/pdf-lib.min.js'; s.onload = () => res(global.PDFLib); s.onerror = () => { pdfLibP = null; rej(new Error('pdf-lib failed to load')); }; document.head.appendChild(s); });
    return pdfLibP;
  }

  /* ---------- state ---------- */
  const ED = { open: false, email: null, att: null, base: null, baseId: null, kind: 'other', pages: [], ann: [], zoom: 1, tool: 'pen', color: COLORS[0], hlColor: '#ffd43b', size: 3, fontSize: 18, undo: [], redo: [], sel: null, dirty: false, drawing: null, pdf: null, img: null, busy: false };
  let root = null;

  function buildDom() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'editor'; root.id = 'editor'; root.hidden = true;
    root.innerHTML = `
      <div class="ed-bar">
        <button class="icon-btn" data-ed="close" title="${t('close')}">${icon('x')}</button>
        <div class="ed-title"><div class="ed-name" id="edName" dir="auto"></div><div class="ed-meta" id="edMeta"></div></div>
        <div class="ed-tools" id="edTools">
          ${[['select', 'cursor', 'editor_select'], ['pen', 'pen', 'editor_pen'], ['hl', 'highlighter', 'editor_highlighter'], ['text', 'type', 'editor_text'], ['rect', 'square', 'editor_rect'], ['eraser', 'eraser', 'editor_eraser']].map(([k, ic, l]) => `<button data-tool="${k}" title="${t(l)}">${icon(ic)}</button>`).join('')}
          <span class="ed-vsep"></span>
          <button data-ed="undo" title="${t('editor_undo')} (Ctrl+Z)">${icon('undo')}</button>
          <button data-ed="redo" title="${t('editor_redo')} (Ctrl+Y)">${icon('redo')}</button>
        </div>
        <div class="ed-actions">
          <button class="btn sm" data-ed="download">${icon('download', 'sm')}<span>${t('download')}</span></button>
          <button class="btn sm btn-primary" data-ed="save">${icon('check', 'sm')}<span>${t('save_copy')}</span></button>
        </div>
      </div>
      <div class="ed-sub" id="edSub">
        <div class="ed-colors" id="edColors">${COLORS.map(c => `<button data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
        <label class="ed-range">${t('editor_size')} <input type="range" id="edSize" min="1" max="24" value="3"></label>
        <label class="ed-range">${t('editor_text_size')} <input type="range" id="edFont" min="10" max="60" value="18"></label>
        <span class="spacer"></span>
        <div class="ed-pagenav" id="edPageNav"></div>
        <div class="ed-zoom"><button class="icon-btn sm" data-ed="zoomout" title="${t('editor_zoom_out')}">${icon('zoom-out', 'sm')}</button><span id="edZoom">100%</span><button class="icon-btn sm" data-ed="zoomin" title="${t('editor_zoom_in')}">${icon('zoom-in', 'sm')}</button><button class="icon-btn sm" data-ed="fit" title="${t('editor_fit')}">${icon('maximize', 'sm')}</button></div>
      </div>
      <div class="ed-body" id="edBody"><div class="ed-pages" id="edPages"></div></div>
      <div class="ed-hint" id="edHint"></div>`;
    document.body.appendChild(root);
    // toolbar events
    root.querySelector('[data-ed="close"]').onclick = close;
    root.querySelector('[data-ed="save"]').onclick = save;
    root.querySelector('[data-ed="download"]').onclick = downloadCurrent;
    root.querySelector('[data-ed="undo"]').onclick = undo;
    root.querySelector('[data-ed="redo"]').onclick = redo;
    root.querySelector('[data-ed="zoomin"]').onclick = () => { ED.userZoomed = true; setZoom(ED.zoom * 1.2); };
    root.querySelector('[data-ed="zoomout"]').onclick = () => { ED.userZoomed = true; setZoom(ED.zoom / 1.2); };
    root.querySelector('[data-ed="fit"]').onclick = () => { ED.userZoomed = false; setZoom(fitZoom()); };
    window.addEventListener('resize', App.debounce(() => { if (ED.open && !ED.userZoomed && ED.pages.length) setZoom(fitZoom()); }, 200));
    $$('[data-tool]', root).forEach(b => b.onclick = () => setTool(b.dataset.tool));
    $$('[data-color]', root).forEach(b => b.onclick = () => { if (ED.tool === 'hl') ED.hlColor = b.dataset.color; else ED.color = b.dataset.color; $$('[data-color]', root).forEach(x => x.classList.toggle('active', x === b)); if (ED.sel) { const a = getSel(); if (a) { pushUndo(); a.color = b.dataset.color; redraw(ED.sel.page); syncTextEl(ED.sel.page, a); } } });
    $('#edSize', root).oninput = (ev) => { ED.size = +ev.target.value; };
    $('#edFont', root).oninput = (ev) => { ED.fontSize = +ev.target.value; const a = getSel(); if (a && a.type === 'text') { a.size = ED.fontSize; syncTextEl(ED.sel.page, a); ED.dirty = true; } };
    $('#edBody', root).addEventListener('scroll', () => { renderVisible(); updatePageNav(); });
    document.addEventListener('keydown', onKey);
    return root;
  }

  /* ---------- open / close ---------- */
  async function open(email, att, opts) {
    buildDom();
    ED.noteItem = opts && opts.note ? opts.note : null;
    ED.email = email; ED.att = att; ED.kind = kindOf(att); ED.ann = []; ED.undo = []; ED.redo = []; ED.sel = null; ED.dirty = false; ED.pages = []; ED.pdf = null; ED.img = null; ED.drawing = null; ED.userZoomed = false;
    root.hidden = false; ED.open = true; root.className = 'editor tool-' + ED.tool + ' kind-' + ED.kind;
    $('#edName').textContent = att.name;
    $('#edMeta').textContent = fmtSize(att.size) + (att.editedFrom ? ' · ' + t('edited_badge') : '');
    $('#edPages').innerHTML = `<div class="ed-loading"><span class="spinner"></span> ${t('loading')}</div>`;
    $('#edHint').textContent = '';
    // resolve the file to edit: editor-made versions keep the original as base + editable annotations
    let file = await DB.getFile(att.id);
    if (!file) { toast(t('file_missing'), 'error'); close(true); return; }
    ED.base = file.blob; ED.baseId = att.id;
    if (att.baseId && att.annotations && !ED.noteItem) {
      const b = await DB.getFile(att.baseId);
      if (b) { ED.base = b.blob; ED.baseId = att.baseId; ED.ann = JSON.parse(JSON.stringify(att.annotations)); }
    }
    try {
      if (ED.kind === 'pdf') await openPdf();
      else if (ED.kind === 'image') await openImage();
      else if (ED.kind === 'text') await openText();
      else openOther();
    } catch (err) {
      console.error(err);
      $('#edPages').innerHTML = `<div class="ed-other"><div class="inline-error">${esc(t('render_error', { e: err.message || err }))}</div></div>`;
      ED.kind = 'other'; renderOtherPanel(true);
    }
    updateToolbar();
  }
  function close(force) {
    if (!ED.open) return;
    if (ED.dirty && !force) { App.confirmDialog(t('unsaved_changes'), { danger: true, okLabel: t('close') }).then(ok => { if (ok) close(true); }); return; }
    ED.open = false; root.hidden = true; $('#edPages').innerHTML = '';
    if (ED.pdf) { try { ED.pdf.destroy(); } catch (e) { /* ignore */ } ED.pdf = null; }
    ED.pages = []; ED.ann = []; ED.img = null;
  }
  function updateToolbar() {
    const annotatable = ED.kind === 'pdf' || ED.kind === 'image';
    $('#edTools').hidden = !annotatable; $('#edSub').hidden = !annotatable;
    root.querySelector('[data-ed="save"]').hidden = ED.kind === 'other';
    $$('[data-tool]', root).forEach(b => b.classList.toggle('active', b.dataset.tool === ED.tool));
    const cur = ED.tool === 'hl' ? ED.hlColor : ED.color;
    $$('[data-color]', root).forEach(b => b.classList.toggle('active', b.dataset.color === cur));
    $('#edSize').value = ED.size; $('#edFont').value = ED.fontSize;
    $('#edHint').textContent = annotatable ? t('editor_hint_' + ED.tool) : '';
  }
  function setTool(tool) {
    ED.tool = tool; root.className = 'editor tool-' + tool + ' kind-' + ED.kind;
    if (tool !== 'select') setSel(null);
    updateToolbar();
  }

  /* ---------- PDF ---------- */
  async function openPdf() {
    const lib = await loadPdfJs();
    const data = new Uint8Array(await ED.base.arrayBuffer());
    const base = document.baseURI;
    ED.pdf = await lib.getDocument({ data, standardFontDataUrl: new URL('lib/pdfjs/standard_fonts/', base).href, wasmUrl: new URL('lib/pdfjs/wasm/', base).href, iccUrl: new URL('lib/pdfjs/iccs/', base).href, isEvalSupported: false, useSystemFonts: false }).promise;
    const pagesEl = $('#edPages'); pagesEl.innerHTML = '';
    for (let i = 1; i <= ED.pdf.numPages; i++) {
      const page = await ED.pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const p = makePage(i - 1, vp.width, vp.height); p.page = page; p.rotation = vp.rotation; p.view = page.view.slice();
      pagesEl.appendChild(p.wrap);
    }
    ED.zoom = fitZoom(); layoutPages();
  }
  function makePage(index, w, h) {
    const wrap = document.createElement('div'); wrap.className = 'epage'; wrap.dataset.page = index;
    wrap.innerHTML = `<canvas class="ecanvas"></canvas><canvas class="eoverlay"></canvas><div class="etexts"></div>`;
    const p = { index, w, h, wrap, canvas: wrap.querySelector('.ecanvas'), overlay: wrap.querySelector('.eoverlay'), texts: wrap.querySelector('.etexts'), renderedZoom: 0, rendering: false, page: null, rotation: 0, view: null };
    ED.pages[index] = p; ED.ann[index] = ED.ann[index] || [];
    bindPageEvents(p);
    return p;
  }
  function fitZoom() {
    const body = $('#edBody'); const avail = Math.max(320, body.clientWidth - 48);
    const w = Math.max(...ED.pages.map(p => p.w), 1);
    return Math.max(0.2, Math.min(1.4, avail / w));
  }
  function setZoom(z) { ED.zoom = Math.max(0.2, Math.min(4, z)); layoutPages(); }
  function layoutPages() {
    for (const p of ED.pages) {
      const W = Math.round(p.w * ED.zoom), H = Math.round(p.h * ED.zoom);
      p.wrap.style.width = W + 'px'; p.wrap.style.height = H + 'px';
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      p.overlay.width = Math.round(W * dpr); p.overlay.height = Math.round(H * dpr);
      rebuildTexts(p.index);
      redraw(p.index);
    }
    $('#edZoom').textContent = Math.round(ED.zoom * 100) + '%';
    renderVisible(); updatePageNav();
  }
  async function renderVisible() {
    const body = $('#edBody'); const top = body.scrollTop - 900, bottom = body.scrollTop + body.clientHeight + 900;
    for (const p of ED.pages) {
      if (!p.page && !ED.img) continue;
      const y = p.wrap.offsetTop; if (y + p.wrap.offsetHeight < top || y > bottom) continue;
      if (p.renderedZoom === ED.zoom || p.rendering || p.renderError) continue;
      p.rendering = true;
      const zoomAtStart = ED.zoom;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      try {
        if (p.page) {
          const vp = p.page.getViewport({ scale: zoomAtStart * dpr });
          p.canvas.width = Math.round(vp.width); p.canvas.height = Math.round(vp.height);
          await p.page.render({ canvasContext: p.canvas.getContext('2d'), viewport: vp }).promise;
        } else if (ED.img) {
          p.canvas.width = Math.round(p.w * zoomAtStart * dpr); p.canvas.height = Math.round(p.h * zoomAtStart * dpr);
          p.canvas.getContext('2d').drawImage(ED.img, 0, 0, p.canvas.width, p.canvas.height);
        }
        p.renderedZoom = zoomAtStart;
      } catch (err) { if (!(err && err.name === 'RenderingCancelledException')) { console.error(err); p.renderError = true; toast(t('render_error', { e: err.message || err }), 'error'); } }
      p.rendering = false;
      if (ED.open && p.renderedZoom !== ED.zoom) renderVisible();
    }
  }
  function updatePageNav() {
    if (!ED.pages.length) { $('#edPageNav').textContent = ''; return; }
    const body = $('#edBody'); const mid = body.scrollTop + body.clientHeight / 2;
    let cur = 0; ED.pages.forEach((p, i) => { if (p.wrap.offsetTop <= mid) cur = i; });
    $('#edPageNav').textContent = t('page_of', { a: cur + 1, b: ED.pages.length });
  }

  /* ---------- image ---------- */
  async function openImage() {
    const url = URL.createObjectURL(ED.base);
    ED.img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image')); im.src = url; });
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    const pagesEl = $('#edPages'); pagesEl.innerHTML = '';
    const p = makePage(0, ED.img.naturalWidth, ED.img.naturalHeight);
    pagesEl.appendChild(p.wrap);
    ED.zoom = fitZoom(); layoutPages();
  }

  /* ---------- text ---------- */
  async function openText() {
    const txt = await ED.base.text();
    $('#edPages').innerHTML = `<textarea class="textarea ed-textarea" id="edTextArea" dir="auto" spellcheck="false"></textarea>`;
    const ta = $('#edTextArea'); ta.value = txt;
    ta.addEventListener('input', () => { ED.dirty = true; });
  }

  /* ---------- other ---------- */
  function openOther() { renderOtherPanel(false); }
  function renderOtherPanel(afterError) {
    const a = ED.att; const ext = extOf(a.name);
    const el = document.createElement('div'); el.className = 'ed-other';
    const prevErr = afterError ? $('#edPages').querySelector('.inline-error') : null;
    $('#edPages').innerHTML = '';
    el.innerHTML = `${prevErr ? `<div class="inline-error" style="margin-bottom:14px">${prevErr.innerHTML}</div>` : ''}<div class="ed-other-ico">${esc(ext.slice(0, 5) || 'file')}</div>
      <h3 dir="auto">${esc(a.name)}</h3><p class="inline-note">${fmtSize(a.size)} · ${esc(a.type || '')}</p>
      <p>${t('other_type_hint')}</p>
      <div class="ed-other-actions">
        <button class="btn btn-primary" data-o="saveas">${icon('folder')}${t('save_to_folder')}</button>
        <button class="btn" data-o="download">${icon('download')}${t('download')}</button>
        <button class="btn" data-o="newtab">${icon('external')}${t('open_new_tab')}</button>
        <button class="btn" data-o="upload">${icon('upload')}${t('upload_edited')}</button>
      </div>`;
    $('#edPages').appendChild(el);
    $$('[data-o]', el).forEach(b => b.onclick = () => { const act = b.dataset.o; if (act === 'upload') { close(true); } App.attachmentAction(ED.email, a.id, act, b); });
  }

  /* ---------- annotations: drawing ---------- */
  function drawAnnotations(ctx, anns, k, withText) {
    for (const a of anns) {
      ctx.save();
      if (a.type === 'pen') {
        if (!a.points || a.points.length < 1) { ctx.restore(); continue; }
        ctx.globalAlpha = a.alpha == null ? 1 : a.alpha;
        if (a.blend) ctx.globalCompositeOperation = a.blend;
        ctx.strokeStyle = a.color; ctx.lineWidth = a.width * k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        const pts = a.points;
        ctx.moveTo(pts[0][0] * k, pts[0][1] * k);
        if (pts.length === 1) ctx.lineTo(pts[0][0] * k + 0.1, pts[0][1] * k);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * k, pts[i][1] * k);
        ctx.stroke();
      } else if (a.type === 'rect') {
        ctx.strokeStyle = a.color; ctx.lineWidth = a.width * k; ctx.lineJoin = 'round';
        const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), w = Math.abs(a.w), h = Math.abs(a.h);
        ctx.strokeRect(x * k, y * k, w * k, h * k);
      } else if (a.type === 'text' && withText) {
        ctx.fillStyle = a.color; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
        ctx.font = `${a.size * k}px ${FONT}`;
        ctx.direction = isRtl(a.text) ? 'rtl' : 'ltr';
        const lines = String(a.text || '').split('\n');
        lines.forEach((line, i) => ctx.fillText(line, (a.x + 4) * k, (a.y + 2) * k + i * a.size * 1.35 * k));
      }
      ctx.restore();
    }
  }
  const isRtl = (s) => /^[^A-Za-z؀-ۿ]*[؀-ۿ]/.test(String(s || ''));
  function redraw(pi) {
    const p = ED.pages[pi]; if (!p) return;
    const ctx = p.overlay.getContext('2d');
    const dpr = p.overlay.width / Math.max(1, p.wrap.clientWidth || (p.w * ED.zoom));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, p.overlay.width, p.overlay.height);
    const k = ED.zoom * dpr;
    drawAnnotations(ctx, ED.ann[pi] || [], k, false);
    if (ED.drawing && ED.drawing.page === pi) drawAnnotations(ctx, [ED.drawing.ann], k, false);
    // selection outline
    if (ED.sel && ED.sel.page === pi) {
      const a = getSel();
      if (a && a.type !== 'text') {
        const b = bounds(a);
        ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = '#2f5bea'; ctx.lineWidth = 1.5 * dpr;
        ctx.strokeRect((b.x - 4) * k, (b.y - 4) * k, (b.w + 8) * k, (b.h + 8) * k); ctx.restore();
      }
    }
  }
  function redrawAll() { ED.pages.forEach(p => redraw(p.index)); }
  function bounds(a) {
    if (a.type === 'pen') { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of a.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } const m = a.width / 2; return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m }; }
    if (a.type === 'rect') return { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) };
    if (a.type === 'text') { const el = a._el; if (el) return { x: a.x, y: a.y, w: el.offsetWidth / ED.zoom, h: el.offsetHeight / ED.zoom }; return { x: a.x, y: a.y, w: 40, h: a.size * 1.4 }; }
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  function hitTest(pi, x, y) {
    const anns = ED.ann[pi] || []; const tol = 6 / ED.zoom;
    for (let i = anns.length - 1; i >= 0; i--) {
      const a = anns[i];
      if (a.type === 'text' || a.type === 'rect') { const b = bounds(a); if (x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol) return i; }
      else if (a.type === 'pen') {
        const b = bounds(a); if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) continue;
        const r = a.width / 2 + tol; const pts = a.points;
        if (pts.length === 1) { if (Math.hypot(pts[0][0] - x, pts[0][1] - y) <= r) return i; continue; }
        for (let j = 1; j < pts.length; j++) if (distSeg(x, y, pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]) <= r) return i;
      }
    }
    return -1;
  }
  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1; const l2 = dx * dx + dy * dy;
    let tt = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; tt = Math.max(0, Math.min(1, tt));
    return Math.hypot(px - (x1 + tt * dx), py - (y1 + tt * dy));
  }

  /* ---------- text annotation DOM ---------- */
  function rebuildTexts(pi) {
    const p = ED.pages[pi]; if (!p) return; p.texts.innerHTML = '';
    for (const a of ED.ann[pi] || []) { if (a.type === 'text') { a._el = null; makeTextEl(pi, a); } }
  }
  function makeTextEl(pi, a) {
    const p = ED.pages[pi];
    const el = document.createElement('div');
    el.className = 'etext'; el.contentEditable = 'true'; el.spellcheck = false; el.dir = 'auto';
    el.dataset.ph = t('text_placeholder');
    el.innerText = a.text || '';
    a._el = el; p.texts.appendChild(el); syncTextEl(pi, a);
    el.addEventListener('input', () => { a.text = el.innerText.replace(/\n$/, ''); ED.dirty = true; });
    el.addEventListener('focus', () => { setSel({ page: pi, index: (ED.ann[pi] || []).indexOf(a) }); });
    el.addEventListener('blur', () => { if (!a.text || !a.text.trim()) { const idx = ED.ann[pi].indexOf(a); if (idx >= 0) { ED.ann[pi].splice(idx, 1); el.remove(); if (ED.sel && ED.sel.page === pi && ED.sel.index === idx) ED.sel = null; redraw(pi); } } });
    el.addEventListener('pointerdown', (ev) => {
      if (ED.tool === 'eraser') { ev.preventDefault(); ev.stopPropagation(); pushUndo(); const idx = ED.ann[pi].indexOf(a); if (idx >= 0) ED.ann[pi].splice(idx, 1); el.remove(); setSel(null); redraw(pi); return; }
      if (ED.tool !== 'select' && ED.tool !== 'text') return; // drawing tools pass through (pointer-events none anyway)
      if (document.activeElement === el) { ev.stopPropagation(); return; } // editing: let the caret work
      // drag to move
      ev.preventDefault(); ev.stopPropagation();
      setSel({ page: pi, index: ED.ann[pi].indexOf(a) });
      const start = { x: ev.clientX, y: ev.clientY, ax: a.x, ay: a.y }; let moved = false;
      const mv = (e2) => { const dx = (e2.clientX - start.x) / ED.zoom, dy = (e2.clientY - start.y) / ED.zoom; if (!moved && Math.hypot(dx, dy) * ED.zoom > 3) { moved = true; pushUndo(); } if (moved) { a.x = start.ax + dx; a.y = start.ay + dy; syncTextEl(pi, a); } };
      const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); if (!moved) { el.focus(); placeCaretEnd(el); } };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
    el.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') el.blur(); });
    return el;
  }
  function placeCaretEnd(el) { try { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* ignore */ } }
  function syncTextEl(pi, a) {
    const el = a._el; if (!el) return;
    el.style.left = (a.x * ED.zoom) + 'px'; el.style.top = (a.y * ED.zoom) + 'px';
    el.style.fontSize = (a.size * ED.zoom) + 'px'; el.style.color = a.color;
    el.style.padding = `${2 * ED.zoom}px ${4 * ED.zoom}px`;
    el.classList.toggle('selected', !!(ED.sel && ED.sel.page === pi && (ED.ann[pi] || [])[ED.sel.index] === a));
  }

  /* ---------- selection / undo ---------- */
  function getSel() { return ED.sel ? (ED.ann[ED.sel.page] || [])[ED.sel.index] : null; }
  function setSel(sel) {
    const prev = ED.sel; ED.sel = sel;
    if (prev) { redraw(prev.page); const a = (ED.ann[prev.page] || [])[prev.index]; if (a && a.type === 'text') syncTextEl(prev.page, a); }
    if (sel) { redraw(sel.page); const a = getSel(); if (a && a.type === 'text') { syncTextEl(sel.page, a); $('#edFont').value = a.size; } if (a) { ED.color = a.color; $$('[data-color]', root).forEach(x => x.classList.toggle('active', x.dataset.color === a.color)); } }
  }
  function serialize() { return JSON.stringify(ED.ann, (k, v) => (k === '_el' ? undefined : v)); }
  function pushUndo() { ED.undo.push(serialize()); if (ED.undo.length > 100) ED.undo.shift(); ED.redo = []; ED.dirty = true; }
  function restore(json) { ED.ann = JSON.parse(json); ED.sel = null; for (const p of ED.pages) { ED.ann[p.index] = ED.ann[p.index] || []; rebuildTexts(p.index); redraw(p.index); } }
  function undo() { if (!ED.undo.length) return; ED.redo.push(serialize()); restore(ED.undo.pop()); ED.dirty = true; }
  function redo() { if (!ED.redo.length) return; ED.undo.push(serialize()); restore(ED.redo.pop()); ED.dirty = true; }
  function deleteSel() { const a = getSel(); if (!a) return; pushUndo(); const pi = ED.sel.page; ED.ann[pi].splice(ED.sel.index, 1); if (a._el) a._el.remove(); ED.sel = null; redraw(pi); }

  /* ---------- pointer handling on pages ---------- */
  function bindPageEvents(p) {
    const ov = p.overlay;
    const pos = (ev) => { const r = p.wrap.getBoundingClientRect(); return { x: (ev.clientX - r.left) / ED.zoom, y: (ev.clientY - r.top) / ED.zoom }; };
    ov.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      const { x, y } = pos(ev); const pi = p.index;
      if (ED.tool === 'text') {
        ev.preventDefault(); // keep the browser from moving focus to the canvas
        const hit = hitTest(pi, x, y); const anns = ED.ann[pi];
        if (hit >= 0 && anns[hit].type === 'text') { setSel({ page: pi, index: hit }); setTimeout(() => { anns[hit]._el.focus(); placeCaretEnd(anns[hit]._el); }, 0); return; }
        pushUndo();
        const a = { type: 'text', x, y: y - ED.fontSize * 0.7, text: '', size: ED.fontSize, color: ED.color };
        anns.push(a); makeTextEl(pi, a); setSel({ page: pi, index: anns.length - 1 });
        setTimeout(() => a._el.focus(), 0);
        return;
      }
      if (ED.tool === 'select') {
        const hit = hitTest(pi, x, y);
        if (hit < 0) { setSel(null); return; }
        setSel({ page: pi, index: hit });
        const a = ED.ann[pi][hit]; if (a.type === 'text') { return; }
        ov.setPointerCapture(ev.pointerId);
        const start = { x, y, snap: JSON.parse(JSON.stringify(a, (k, v) => (k === '_el' ? undefined : v))) }; let moved = false;
        const mv = (e2) => { const q = pos(e2); const dx = q.x - start.x, dy = q.y - start.y; if (!moved && Math.hypot(dx, dy) * ED.zoom > 3) { moved = true; pushUndo(); } if (!moved) return; if (a.type === 'pen') a.points = start.snap.points.map(([px, py]) => [px + dx, py + dy]); else { a.x = start.snap.x + dx; a.y = start.snap.y + dy; } redraw(pi); };
        const up = () => { ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up); };
        ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
        return;
      }
      if (ED.tool === 'eraser') {
        const hit = hitTest(pi, x, y); if (hit < 0) return;
        pushUndo(); const a = ED.ann[pi][hit]; ED.ann[pi].splice(hit, 1); if (a._el) a._el.remove(); setSel(null); redraw(pi); return;
      }
      // drawing tools
      ov.setPointerCapture(ev.pointerId);
      let ann;
      if (ED.tool === 'pen') ann = { type: 'pen', points: [[x, y]], color: ED.color, width: ED.size, alpha: 1 };
      else if (ED.tool === 'hl') ann = { type: 'pen', points: [[x, y]], color: ED.hlColor, width: Math.max(10, ED.size * 4), alpha: 0.4, blend: 'multiply' };
      else if (ED.tool === 'rect') ann = { type: 'rect', x, y, w: 0, h: 0, color: ED.color, width: Math.max(1.5, ED.size) };
      else return;
      ED.drawing = { page: pi, ann };
      const mv = (e2) => {
        const q = pos(e2);
        if (ann.type === 'pen') { const last = ann.points[ann.points.length - 1]; if (Math.hypot(q.x - last[0], q.y - last[1]) * ED.zoom >= 1.5) ann.points.push([q.x, q.y]); }
        else { ann.w = q.x - ann.x; ann.h = q.y - ann.y; }
        redraw(pi);
      };
      const up = () => {
        ov.removeEventListener('pointermove', mv); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up);
        ED.drawing = null;
        const ok = ann.type === 'pen' ? ann.points.length >= 1 : (Math.abs(ann.w) > 2 && Math.abs(ann.h) > 2);
        if (ok) { pushUndo(); ED.ann[pi].push(ann); }
        redraw(pi);
      };
      ov.addEventListener('pointermove', mv); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    });
  }
  function onKey(ev) {
    if (!ED.open) return;
    const editing = document.activeElement && (document.activeElement.classList.contains('etext') || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT');
    if (ev.key === 'Escape') { if (editing) { document.activeElement.blur(); return; } ev.preventDefault(); close(); return; }
    if (editing) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); save(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { if (ED.sel) { ev.preventDefault(); deleteSel(); } return; }
    const tools = { v: 'select', p: 'pen', h: 'hl', t: 'text', r: 'rect', e: 'eraser' };
    if (tools[ev.key.toLowerCase()] && !ev.ctrlKey && !ev.metaKey && (ED.kind === 'pdf' || ED.kind === 'image')) setTool(tools[ev.key.toLowerCase()]);
  }

  /* ---------- export ---------- */
  function renderPageOverlay(p, k) {
    const c = document.createElement('canvas'); c.width = Math.round(p.w * k); c.height = Math.round(p.h * k);
    drawAnnotations(c.getContext('2d'), ED.ann[p.index] || [], k, true);
    return c;
  }
  function canvasToBlob(c, type, q) { return new Promise(res => c.toBlob(res, type, q)); }
  async function exportPdf() {
    const PDFLib = await loadPdfLib();
    const bytes = new Uint8Array(await ED.base.arrayBuffer());
    let doc;
    try { doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
    catch (e) { doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false, capNumbers: true }); }
    const pages = doc.getPages();
    for (const p of ED.pages) {
      const anns = ED.ann[p.index]; if (!anns || !anns.length || !pages[p.index]) continue;
      const c = renderPageOverlay(p, 2.5);
      const png = await canvasToBlob(c, 'image/png');
      const img = await doc.embedPng(await png.arrayBuffer());
      const page = pages[p.index];
      const rot = ((Math.round(page.getRotation().angle) % 360) + 360) % 360;
      const view = p.view || [0, 0, page.getWidth(), page.getHeight()];
      const vx0 = view[0], vy0 = view[1], W = view[2] - view[0], H = view[3] - view[1];
      const opts = { width: p.w, height: p.h };
      if (rot === 90) Object.assign(opts, { x: vx0 + W, y: vy0, rotate: PDFLib.degrees(90) });
      else if (rot === 180) Object.assign(opts, { x: vx0 + W, y: vy0 + H, rotate: PDFLib.degrees(180) });
      else if (rot === 270) Object.assign(opts, { x: vx0, y: vy0 + H, rotate: PDFLib.degrees(270) });
      else Object.assign(opts, { x: vx0, y: vy0 });
      page.drawImage(img, opts);
    }
    const out = await doc.save({ useObjectStreams: false });
    return new Blob([out], { type: 'application/pdf' });
  }
  async function exportImage() {
    const p = ED.pages[0];
    const c = document.createElement('canvas'); c.width = p.w; c.height = p.h;
    const ctx = c.getContext('2d'); ctx.drawImage(ED.img, 0, 0, p.w, p.h);
    drawAnnotations(ctx, ED.ann[0] || [], 1, true);
    const ext = extOf(ED.att.name);
    const jpeg = ext === 'jpg' || ext === 'jpeg';
    return canvasToBlob(c, jpeg ? 'image/jpeg' : 'image/png', 0.92);
  }
  async function buildOutput() {
    if (ED.kind === 'pdf') return { blob: await exportPdf(), ext: 'pdf' };
    if (ED.kind === 'image') { const b = await exportImage(); return { blob: b, ext: b.type === 'image/jpeg' ? 'jpg' : 'png' }; }
    if (ED.kind === 'text') { const ta = $('#edTextArea'); return { blob: new Blob([ta ? ta.value : ''], { type: ED.att.type || 'text/plain;charset=utf-8' }), ext: extOf(ED.att.name) || 'txt' }; }
    return null;
  }
  function editedName(name, ext) {
    const stem = name.replace(/\.[^.]+$/, '').replace(/\s*\((edited|معدّل|معدل)\)\s*$/i, '');
    return `${stem} (${t('edited_suffix')}).${ext}`;
  }
  async function save() {
    if (ED.busy || ED.kind === 'other') return;
    if (document.activeElement && document.activeElement.classList.contains('etext')) document.activeElement.blur();
    ED.busy = true; const btn = root.querySelector('[data-ed="save"]'); btn.disabled = true;
    try {
      const out = await buildOutput(); if (!out) return;
      const extra = (ED.kind === 'pdf' || ED.kind === 'image') ? { annotations: JSON.parse(serialize()), baseId: ED.baseId } : {};
      if (ED.noteItem) {
        // notes: overwrite the note's file in place, then reload so further edits build on the saved result
        const it = ED.noteItem;
        const newName = it.name.replace(/\.[^.]+$/, '') + '.' + out.ext;
        await DB.putFile({ id: it.id, emailId: ED.email.id, name: newName, type: out.blob.type, blob: out.blob, note: true });
        it.name = newName; it.type = out.blob.type; it.size = out.blob.size; it.editedAt = new Date().toISOString();
        await App.saveEmail(ED.email);
        toast(t('saved_as', { f: it.name }), 'success');
        ED.dirty = false;
        if (S.selectedId === ED.email.id) App.renderTabContent();
        const reopenAtt = { id: it.id, name: it.name, type: it.type, size: it.size };
        const email = ED.email; ED.open = false; root.hidden = true;
        return open(email, reopenAtt, { note: it });
      }
      if (ED.att.baseId && ED.att.annotations) {
        await App.updateAttachmentVersion(ED.email, ED.att, out.blob, extra);
      } else {
        const rec = await App.addAttachmentVersion(ED.email, ED.att, out.blob, editedName(ED.att.name, out.ext), out.blob.type, extra);
        ED.att = rec;
      }
      $('#edName').textContent = ED.att.name; $('#edMeta').textContent = fmtSize(ED.att.size) + ' · ' + t('edited_badge');
      ED.dirty = false;
    } catch (err) { console.error(err); toast(t('save_failed', { e: err.message || err }), 'error'); }
    finally { ED.busy = false; btn.disabled = false; }
  }
  async function downloadCurrent() {
    try {
      const out = (ED.kind === 'other') ? null : await buildOutput();
      if (out) return App.saveBlobAs(out.blob, ED.dirty || ED.att.annotations ? editedName(ED.att.name, out.ext) : ED.att.name);
      const f = await DB.getFile(ED.att.id); if (f) App.saveBlobAs(f.blob, ED.att.name);
    } catch (err) { toast(t('save_failed', { e: err.message || err }), 'error'); }
  }

  App.Editor = { open, close, kindOf, state: ED, _test: { setTool, pushUndo, redraw, exportPdf, exportImage, save, setZoom } };
})(window);
