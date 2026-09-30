/* ============================================================
   features.js — calendar export, print, CSV export, sender filter,
   daily agenda. Everything runs on the device.
   ============================================================ */
(function (global) {
  'use strict';
  const App = global.App;
  const { t } = I18N;
  const S = App.state;
  const { $, esc, icon, toast, isOpen, isSnoozed } = App;

  /* ---------- reply deadline → calendar (.ics) ---------- */
  const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);
  function calendarEvent(e) {
    if (!e.dueAt) return;
    const start = new Date(e.dueAt); const end = new Date(start.getTime() + 30 * 60000);
    const who = e.from.name ? `${e.from.name} <${e.from.address || ''}>` : (e.from.address || '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Email Management//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      'UID:' + e.id + '@email-management', 'DTSTAMP:' + icsDate(Date.now()), 'DTSTART:' + icsDate(start), 'DTEND:' + icsDate(end),
      'SUMMARY:' + icsText(t('ics_summary', { s: e.subject || t('no_subject') })),
      'DESCRIPTION:' + icsText(`${t('detail_from')}: ${who}\n${(e.snippet || '').slice(0, 300)}`),
      'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(t('ics_summary', { s: e.subject || '' })), 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
    const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' });
    App.downloadBlob(blob, 'reply-' + (e.subject || 'deadline').replace(/[^\w\u0600-\u06FF -]+/g, '').slice(0, 40).trim() + '.ics');
    toast(t('ics_saved'), 'success');
  }

  /* ---------- print the open email ---------- */
  async function printEmail(e) {
    const who = (a) => a.name && a.name !== a.address ? `${a.name} <${a.address}>` : (a.address || a.name || '');
    let body = '';
    if (e.htmlBody) {
      // inline images by content id come from the stored attachments
      const map = {};
      for (const a of (e.attachments || [])) { if (a.cid) { try { map[a.cid] = await App.getAttachmentUrl(e, a); } catch (err) { /* skip */ } } }
      body = e.htmlBody.replace(/src=["']cid:([^"']+)["']/gi, (m, cid) => map[cid] ? `src="${map[cid]}"` : 'src=""');
      if (!S.allowRemote.has(e.id)) body = body.replace(/src=["']https?:\/\/[^"']+["']/gi, 'src=""');
    } else body = `<pre style="white-space:pre-wrap;font:14px/1.5 Segoe UI,sans-serif">${esc(e.textBody || '')}</pre>`;
    const dir = /[\u0600-\u06FF]/.test((e.subject || '') + (e.textBody || '').slice(0, 200)) ? 'rtl' : 'ltr';
    const head = `<h2 style="margin:0 0 6px">${esc(e.subject || t('no_subject'))}</h2>
      <table style="font:13px Segoe UI,sans-serif;color:#333;border-collapse:collapse;margin-bottom:14px">
        <tr><td style="padding:2px 10px 2px 0;color:#777">${esc(t('detail_from'))}</td><td>${esc(who(e.from))}</td></tr>
        ${e.to && e.to.length ? `<tr><td style="padding:2px 10px 2px 0;color:#777">${esc(t('detail_to'))}</td><td>${esc(e.to.map(who).join(', '))}</td></tr>` : ''}
        ${e.cc && e.cc.length ? `<tr><td style="padding:2px 10px 2px 0;color:#777">${esc(t('detail_cc'))}</td><td>${esc(e.cc.map(who).join(', '))}</td></tr>` : ''}
        <tr><td style="padding:2px 10px 2px 0;color:#777">${esc(t('detail_date'))}</td><td>${esc(App.fmtDateTime(e.date || e.addedAt))}</td></tr>
        ${e.attachments && e.attachments.length ? `<tr><td style="padding:2px 10px 2px 0;color:#777">${esc(t('detail_attachments'))}</td><td>${esc(e.attachments.map(a => a.name).join(', '))}</td></tr>` : ''}
      </table><hr style="border:0;border-top:1px solid #ddd;margin:0 0 14px">`;
    const frame = document.createElement('iframe');
    frame.className = 'print-frame'; frame.setAttribute('aria-hidden', 'true');
    frame.srcdoc = `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(e.subject || '')}</title><style>body{margin:12mm;font-family:"Segoe UI",Tahoma,sans-serif;color:#111}img{max-width:100%}@page{margin:12mm}</style></head><body>${head}${body}<script>setTimeout(function(){window.focus();window.print();},250);<\/script></body></html>`;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 120000);
  }

  /* ---------- CSV of all emails ---------- */
  function exportCsv() {
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Subject', 'From', 'Address', 'Received', 'Priority', 'Status', 'Deadline', 'Replied', 'Tags', 'Attachments', 'Notes']];
    for (const e of S.emails) rows.push([e.subject, e.from.name, e.from.address, e.date || e.addedAt, App.prioName(e.priority), t('status_' + e.status), e.dueAt || '', e.repliedAt || '', (e.tags || []).join(' '), (e.attachments || []).length, (e.notes || '').replace(/\s+/g, ' ')]);
    const csv = '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n');
    App.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'email-management-' + new Date().toISOString().slice(0, 10) + '.csv');
    toast(t('csv_saved'), 'success');
  }

  /* ---------- sender ---------- */
  function senderCount(e) { const a = (e.from.address || '').toLowerCase(); if (!a) return 0; return S.emails.filter(x => (x.from.address || '').toLowerCase() === a).length; }
  function showSender(e) {
    const a = e.from.address || e.from.name; if (!a) return;
    S.filter = 'all'; S.search = a;
    const inp = $('#searchInput'); if (inp) inp.value = a;
    App.showView('inbox'); App.renderFilters(); App.renderList();
  }

  /* ---------- once a day: what is due ---------- */
  function dailyAgenda() {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('em.agendaDay') === today) return;
    const now = new Date(); const end = new Date(now); end.setHours(23, 59, 59, 999);
    const open = S.emails.filter(e => isOpen(e) && !isSnoozed(e) && e.dueAt);
    const overdue = open.filter(e => new Date(e.dueAt) < now).length;
    const due = open.filter(e => new Date(e.dueAt) >= now && new Date(e.dueAt) <= end).length;
    if (!overdue && !due) return;
    localStorage.setItem('em.agendaDay', today);
    const msg = t('agenda_body', { d: due, o: overdue });
    toast(msg, '', { label: t('show'), fn: () => { S.filter = overdue ? 'overdue' : 'today'; App.showView('inbox'); App.renderFilters(); App.renderList(); } });
    if (S.settings.notifications) App.notify(t('agenda_title'), msg);
  }

  App.Features = { calendarEvent, printEmail, exportCsv, senderCount, showSender, dailyAgenda };
})(window);
