/* ============================================================
   reply.js — reply tab: points to address, smart replies,
   AI replies, composer, templates, mailto.
   ============================================================ */
(function (global) {
  'use strict';
  const App = global.App;
  const { t } = I18N;
  const S = App.state;
  const { $, $$, esc, icon, debounce, toast } = App;

  const replyState = { lang: null, tone: null, intent: null, aiResults: [], aiBusy: false, aiError: '', open: new Set() };

  function aiConfigured() { const ai = S.settings.ai || {}; return !!(ai.apiKey || (ai.provider === 'custom' && ai.baseUrl)); }

  function replyAddress(e) { const a = e.replyTo && e.replyTo.address ? e.replyTo : e.from; return a && a.address ? a.address : ''; }
  function replySubject(e) { const s = e.subject || ''; return /^\s*(re|رد)\s*:/i.test(s) ? s : 'Re: ' + s; }

  function currentDraft(e) {
    return e.draft || { to: replyAddress(e), subject: replySubject(e), body: '' };
  }

  function renderReplyTab(e, el) {
    if (!replyState.lang || replyState.forId !== e.id) { replyState.lang = e.lang || 'en'; replyState.tone = S.settings.replyTone || 'formal'; replyState.intent = null; replyState.aiResults = []; replyState.aiError = ''; replyState.open = new Set(); replyState.forId = e.id; }
    const draft = currentDraft(e);
    const points = Engine.extractPoints(e);
    const done = new Set(e.pointsDone || []);
    el.innerHTML = `
      <div class="card" style="margin-bottom:14px"><div class="card-head"><h3>${icon('list')}${t('points_title')}</h3><span class="spacer"></span>${points.length ? `<span class="chip sm">${points.filter((p, i) => done.has(i)).length}/${points.length}</span>` : ''}</div>
        <div class="card-body">${points.length ? `<div class="points">${points.map((p, i) => `<label class="point ${done.has(i) ? 'done' : ''}"><input type="checkbox" data-point="${i}" ${done.has(i) ? 'checked' : ''}><span class="kind ${p.kind}">${p.kind === 'question' ? '?' : '!'}</span><span dir="auto">${esc(p.text)}</span></label>`).join('')}</div>` : `<div class="inline-note">${t('points_empty')}</div>`}</div></div>

      <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>${icon('zap')}${t('smart_title')}</h3><div class="sub">${t('smart_sub')}</div></div></div>
        <div class="card-body">
          <div class="suggest-controls">
            <div class="ctrl"><span class="ctrl-label">${t('intent')}</span><select class="sel" id="intentSel">${['meeting', 'request', 'question', 'deadline', 'thanks', 'invitation', 'issue', 'student', 'followup', 'general'].map(i => `<option value="${i}">${t('intent_' + i)}</option>`).join('')}</select></div>
            <div class="ctrl"><span class="ctrl-label">${t('tone')}</span><div class="seg sm" id="toneSeg">${['formal', 'friendly', 'brief'].map(x => `<button data-tone="${x}" class="${replyState.tone === x ? 'active' : ''}">${t('tone_' + x)}</button>`).join('')}</div></div>
            <div class="ctrl"><span class="ctrl-label">${t('reply_lang')}</span><div class="seg sm" id="langSeg">${['en', 'ar'].map(x => `<button data-lang="${x}" class="${replyState.lang === x ? 'active' : ''}">${t('lang_' + x)}</button>`).join('')}</div></div>
          </div>
          <div class="suggestions" id="smartList"></div>
        </div></div>

      <div class="card" style="margin-bottom:14px"><div class="card-head"><div><h3>${icon('sparkles')}${t('ai_title')}</h3><div class="sub">${t('ai_sub')}</div></div></div>
        <div class="card-body">
          ${aiConfigured() ? `<div class="ai-row"><input class="input" id="aiInstr" placeholder="${esc(t('ai_instructions_placeholder'))}" dir="auto"><button class="btn btn-grad" id="aiGen">${icon('sparkles')}${t('ai_generate')}</button></div>` : `<div class="inline-note">${t('ai_not_configured')} <a href="#" data-goto="settings">${t('nav_settings')} →</a></div>`}
          <div id="aiOut" style="margin-top:12px"></div>
        </div></div>

      <div class="card"><div class="card-head"><h3>${icon('reply')}${t('tab_reply')}</h3><span class="spacer"></span><span class="inline-note">${t('reply_suggest_hint')}</span></div>
        <div class="card-body composer">
          <div class="form-row">
            <div class="field"><label>${t('reply_to')}</label><input class="input" id="cTo" value="${esc(draft.to)}"></div>
            <div class="field"><label>${t('reply_subject')}</label><input class="input" id="cSubject" value="${esc(draft.subject)}" dir="auto"></div>
          </div>
          ${e.cc && e.cc.length ? `<label class="switch"><input type="checkbox" id="cReplyAll" ${S.settings.replyAll ? 'checked' : ''}><span>${t('detail_cc')}: ${esc(e.cc.map(a => a.address || a.name).join(', '))}</span></label>` : ''}
          <div class="composer-toolbar">
            <select class="sel" id="tplSel"><option value="">${t('insert_template')}…</option>${allTemplates(replyState.lang).map((tp, i) => `<option value="${i}">${esc(tp.title)}</option>`).join('')}</select>
            <span class="spacer"></span>
            <div class="ai-tools" id="aiTools" ${aiConfigured() ? '' : 'hidden'}><span class="lbl">${icon('sparkles', 'sm')} AI</span>${['improve', 'shorter', 'formal', 'friendly', 'grammar', 'answer', 'translate_ar', 'translate_en'].map(a => `<button class="btn xs" data-refine="${a}">${t('ai_' + a)}</button>`).join('')}</div>
          </div>
          <div class="field"><textarea class="textarea reply" id="cBody" dir="auto" placeholder="${t('reply_body')}">${esc(draft.body)}</textarea></div>
          <div id="cError"></div>
          <div class="composer-toolbar">
            <button class="btn btn-primary" id="cMailto">${icon('send')}${t('open_mail_app')}</button>
            <button class="btn" id="cCopy">${icon('copy')}${t('copy')}</button>
            <button class="btn" id="cSave">${icon('check')}${t('save_draft')}</button>
            <span class="spacer"></span>
            ${e.status === 'replied' ? `<button class="btn" id="cReopen">${icon('refresh')}${t('reopen')}</button>` : `<button class="btn" id="cAwait">${icon('clock')}${t('mark_awaiting')}</button><button class="btn btn-success" id="cReplied">${icon('check-circle')}${t('mark_replied')}</button>`}
          </div>
          <div class="inline-note">${t('mailto_hint')}</div>
        </div></div>`;

    // points
    $$('[data-point]', el).forEach(cb => cb.onchange = async () => { const i = +cb.dataset.point; const set = new Set(e.pointsDone || []); if (cb.checked) set.add(i); else set.delete(i); e.pointsDone = Array.from(set); await App.saveEmail(e); cb.closest('.point').classList.toggle('done', cb.checked); });

    // smart replies
    const sel = $('#intentSel', el);
    const gen = () => {
      const r = Engine.smartReplies(e, { lang: replyState.lang, tone: replyState.tone, intent: replyState.intent, myName: S.settings.myName, officeHours: S.settings.officeHours, due: e.dueAt, settings: S.settings });
      if (!replyState.intent) { replyState.intent = r.intent; }
      sel.value = replyState.intent;
      $('#smartList', el).innerHTML = r.replies.map((rp, i) => `<div class="suggestion ${replyState.open.has(i) ? 'open' : ''}" data-i="${i}"><h4><span class="n">${i + 1}</span>${esc(rp.title)}</h4><p dir="auto">${esc(rp.body)}</p><button class="btn xs btn-primary use" data-use="${i}">${icon('check', 'sm')}${t('use_reply')}</button></div>`).join('');
      $$('.suggestion', el).forEach(card => {
        card.onclick = (ev) => {
          if (ev.target.closest('[data-use]')) { insertBody(e, r.replies[+ev.target.closest('[data-use]').dataset.use].body); return; }
          const i = +card.dataset.i; if (replyState.open.has(i)) replyState.open.delete(i); else replyState.open.add(i); card.classList.toggle('open');
        };
      });
    };
    sel.onchange = () => { replyState.intent = sel.value; gen(); };
    $$('#toneSeg button', el).forEach(b => b.onclick = () => { replyState.tone = b.dataset.tone; S.settings.replyTone = replyState.tone; App.saveSettings(); $$('#toneSeg button', el).forEach(x => x.classList.toggle('active', x === b)); gen(); });
    $$('#langSeg button', el).forEach(b => b.onclick = () => { replyState.lang = b.dataset.lang; $$('#langSeg button', el).forEach(x => x.classList.toggle('active', x === b)); gen(); fillTemplateSelect(el); });
    gen();

    // AI
    const aiBtn = $('#aiGen', el);
    if (aiBtn) aiBtn.onclick = () => generateAi(e, el);
    renderAiOut(e, el);
    $$('[data-refine]', el).forEach(b => b.onclick = () => refineAi(e, el, b.dataset.refine));
    const goto = $('[data-goto="settings"]', el); if (goto) goto.onclick = (ev) => { ev.preventDefault(); App.showView('settings'); };

    // composer
    const body = $('#cBody', el), to = $('#cTo', el), subj = $('#cSubject', el);
    const save = debounce(() => saveDraft(e, el, false), 700);
    [body, to, subj].forEach(x => x.addEventListener('input', save));
    $('#tplSel', el).onchange = (ev) => { const i = ev.target.value; if (i === '') return; const tp = allTemplates(replyState.lang)[+i]; insertBody(e, Engine.fillTemplate(tp.body, e, replyState.lang, { myName: S.settings.myName, due: e.dueAt, settings: S.settings })); ev.target.value = ''; };
    $('#cCopy', el).onclick = async () => { saveDraft(e, el, false); try { await navigator.clipboard.writeText(body.value); toast(t('copied'), 'success'); } catch (err) { body.select(); document.execCommand('copy'); toast(t('copied'), 'success'); } };
    $('#cSave', el).onclick = () => saveDraft(e, el, true);
    $('#cMailto', el).onclick = () => { saveDraft(e, el, false); openMailto(e, el); if (e.status === 'todo') { App.setStatus(e, 'drafting'); } };
    const rep = $('#cReplied', el); if (rep) rep.onclick = () => { saveDraft(e, el, false); App.setStatus(e, 'replied'); };
    const aw = $('#cAwait', el); if (aw) aw.onclick = () => { saveDraft(e, el, false); App.setStatus(e, 'awaiting'); };
    const ro = $('#cReopen', el); if (ro) ro.onclick = () => App.setStatus(e, 'todo');
    const ra = $('#cReplyAll', el); if (ra) ra.onchange = () => { S.settings.replyAll = ra.checked; App.saveSettings(); };
  }

  function allTemplates(lang) {
    const builtIn = Engine.TEMPLATES.map(tp => ({ title: tp[lang].title, body: tp[lang].body }));
    const custom = (S.settings.templates || []).filter(tp => !tp.lang || tp.lang === lang).map(tp => ({ title: tp.title, body: tp.body }));
    return custom.concat(builtIn);
  }
  function fillTemplateSelect(el) {
    const sel = $('#tplSel', el); if (!sel) return;
    sel.innerHTML = `<option value="">${t('insert_template')}…</option>` + allTemplates(replyState.lang).map((tp, i) => `<option value="${i}">${esc(tp.title)}</option>`).join('');
  }

  function insertBody(e, text) {
    const body = $('#cBody'); if (!body) return;
    if (S.settings.signature && !text.includes(S.settings.signature)) text = text + '\n\n' + S.settings.signature;
    body.value = text; body.focus();
    saveDraft(e, body.closest('#tabContent'), false);
    body.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (e.status === 'todo') App.setStatus(e, 'drafting');
  }

  async function saveDraft(e, el, announce) {
    const body = $('#cBody', el), to = $('#cTo', el), subj = $('#cSubject', el);
    if (!body) return;
    e.draft = { to: to.value, subject: subj.value, body: body.value };
    await App.saveEmail(e);
    App.renderTabs();
    if (announce) toast(t('draft_saved'), 'success');
  }

  function openMailto(e, el) {
    const to = $('#cTo', el).value.trim(), subject = $('#cSubject', el).value, body = $('#cBody', el).value;
    const ra = $('#cReplyAll', el);
    const params = [];
    params.push('subject=' + encodeURIComponent(subject));
    if (ra && ra.checked && e.cc && e.cc.length) params.push('cc=' + encodeURIComponent(e.cc.map(a => a.address).filter(Boolean).join(',')));
    params.push('body=' + encodeURIComponent(body.replace(/\r?\n/g, '\r\n')));
    const url = 'mailto:' + to.replace(/[^A-Za-z0-9@._+\-,;]/g, encodeURIComponent) + '?' + params.join('&');
    const a = document.createElement('a'); a.href = url; a.target = '_self'; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- AI ---------- */
  function renderAiOut(e, el) {
    const out = $('#aiOut', el); if (!out) return;
    if (replyState.aiBusy) { out.innerHTML = `<div class="inline-note" style="display:flex;align-items:center;gap:8px"><span class="spinner"></span>${t('ai_generating')}</div>`; return; }
    if (replyState.aiError) { out.innerHTML = `<div class="inline-error">${esc(t('ai_error', { e: replyState.aiError }))}</div>`; return; }
    if (!replyState.aiResults.length) { out.innerHTML = ''; return; }
    out.innerHTML = `<div class="suggestions">${replyState.aiResults.map((rp, i) => `<div class="suggestion open" data-ai="${i}"><h4><span class="n">${icon('sparkles', 'sm')}</span>${esc(rp.title || ('#' + (i + 1)))}</h4><p dir="auto">${esc(rp.body)}</p><button class="btn xs btn-primary use" data-useai="${i}">${icon('check', 'sm')}${t('use_reply')}</button></div>`).join('')}</div>`;
    $$('[data-useai]', out).forEach(b => b.onclick = () => insertBody(e, replyState.aiResults[+b.dataset.useai].body));
  }
  async function generateAi(e, el) {
    const instr = ($('#aiInstr', el) || {}).value || '';
    replyState.aiBusy = true; replyState.aiError = ''; renderAiOut(e, el);
    try {
      replyState.aiResults = await Engine.aiReplies(S.settings.ai, e, { lang: replyState.lang, tone: replyState.tone, myName: S.settings.myName, role: S.settings.myRole, instructions: instr });
    } catch (err) { replyState.aiError = err.message === 'NO_KEY' ? t('ai_not_configured') : (err.message || String(err)); replyState.aiResults = []; }
    replyState.aiBusy = false; renderAiOut(e, el);
  }
  async function refineAi(e, el, action) {
    const body = $('#cBody', el); if (!body || !body.value.trim()) { body && body.focus(); return; }
    const btns = $$('[data-refine]', el); btns.forEach(b => b.disabled = true);
    const errEl = $('#cError', el); errEl.innerHTML = `<div class="inline-note" style="display:flex;align-items:center;gap:8px"><span class="spinner"></span>${t('ai_generating')}</div>`;
    try {
      const txt = await Engine.aiRefine(S.settings.ai, body.value, action, e, { lang: action === 'translate_ar' ? 'ar' : action === 'translate_en' ? 'en' : replyState.lang });
      if (txt) { body.value = txt; saveDraft(e, el, false); }
      errEl.innerHTML = '';
    } catch (err) { errEl.innerHTML = `<div class="inline-error">${esc(t('ai_error', { e: err.message || String(err) }))}</div>`; }
    btns.forEach(b => b.disabled = false);
  }

  App.renderReplyTab = renderReplyTab;
  App.aiConfigured = aiConfigured;
})(window);
