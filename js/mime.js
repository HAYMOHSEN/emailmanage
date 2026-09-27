/* ============================================================
   mime.js — .eml (RFC 822 / MIME) parser, dependency-free.
   Produces a normalized email object used by the app.
   ============================================================ */
(function (global) {
  'use strict';

  const latin1 = new TextDecoder('latin1');

  function decodeBytes(bytes, charset) {
    charset = normalizeCharset(charset);
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch (e) {
      try { return new TextDecoder('utf-8').decode(bytes); } catch (e2) { return latin1.decode(bytes); }
    }
  }

  function normalizeCharset(cs) {
    if (!cs) return 'utf-8';
    cs = String(cs).trim().toLowerCase().replace(/^["']|["']$/g, '');
    const map = {
      'us-ascii': 'windows-1252', 'ascii': 'windows-1252', 'iso-8859-1': 'windows-1252',
      'latin1': 'windows-1252', 'cp1252': 'windows-1252', 'cp1256': 'windows-1256',
      'iso-8859-6': 'iso-8859-6', 'arabic': 'iso-8859-6', 'utf8': 'utf-8', 'unicode-1-1-utf-8': 'utf-8',
      'utf-16': 'utf-16le', 'ucs-2': 'utf-16le', 'unicode': 'utf-16le', 'x-unknown': 'utf-8', 'unknown-8bit': 'utf-8'
    };
    return map[cs] || cs;
  }

  function strToBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  /* ---------- transfer encodings ---------- */
  function decodeBase64(str) {
    const clean = str.replace(/[^A-Za-z0-9+/=]/g, '');
    try {
      return strToBytes(atob(clean));
    } catch (e0) {
      try { return strToBytes(atob(clean.replace(/=/g, ''))); } catch (e) { /* fallthrough */ }
      // tolerant decode chunk by chunk
      const out = [];
      for (let i = 0; i < clean.length; i += 4) {
        try { out.push(...strToBytes(atob(clean.substr(i, 4)))); } catch (e2) { /* skip */ }
      }
      return new Uint8Array(out);
    }
  }

  function decodeQP(str, isHeader) {
    if (isHeader) str = str.replace(/_/g, ' ');
    str = str.replace(/=\r?\n/g, '');
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c === 61 /* = */ && i + 2 < str.length) {
        const hex = str.substr(i + 1, 2);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; continue; }
      }
      out.push(c & 0xff);
    }
    return new Uint8Array(out);
  }

  /* ---------- RFC 2047 encoded words ---------- */
  const encWordRe = /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g;
  function decodeEncodedWords(str) {
    if (!str || str.indexOf('=?') === -1) return str || '';
    // remove whitespace between adjacent encoded words
    str = str.replace(/(\?=)\s+(=\?)/g, '$1$2');
    return str.replace(encWordRe, (m, charset, enc, text) => {
      try {
        const bytes = enc.toUpperCase() === 'B' ? decodeBase64(text) : decodeQP(text, true);
        return decodeBytes(bytes, charset.split('*')[0]);
      } catch (e) { return m; }
    });
  }

  /* ---------- header parsing ---------- */
  function splitHeadersBody(raw) {
    let idx = raw.search(/\r?\n\r?\n/);
    if (idx === -1) return { head: raw, body: '' };
    const m = raw.slice(idx).match(/^\r?\n\r?\n/);
    return { head: raw.slice(0, idx), body: raw.slice(idx + m[0].length) };
  }

  function parseHeaders(head) {
    const lines = head.split(/\r?\n/);
    const headers = [];
    for (const line of lines) {
      if (/^[ \t]/.test(line) && headers.length) {
        headers[headers.length - 1].value += ' ' + line.trim();
      } else {
        const i = line.indexOf(':');
        if (i > 0) headers.push({ name: line.slice(0, i).trim().toLowerCase(), value: line.slice(i + 1).trim() });
      }
    }
    const map = {};
    for (const h of headers) {
      if (!map[h.name]) map[h.name] = [];
      map[h.name].push(h.value);
    }
    return map;
  }

  function firstHeader(map, name) { return (map[name] && map[name][0]) || ''; }

  // Parses "type/subtype; param=value; param*=charset''value" (RFC 2231 aware)
  function parseParamHeader(value) {
    const result = { value: '', params: {} };
    if (!value) return result;
    const parts = [];
    let cur = '', inQ = false;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === '"') { inQ = !inQ; cur += ch; }
      else if (ch === ';' && !inQ) { parts.push(cur); cur = ''; }
      else cur += ch;
    }
    parts.push(cur);
    result.value = parts.shift().trim().toLowerCase();
    const cont = {};
    for (const p of parts) {
      const eq = p.indexOf('=');
      if (eq === -1) continue;
      let name = p.slice(0, eq).trim().toLowerCase();
      let val = p.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\(.)/g, '$1');
      const m = name.match(/^([^*]+)(?:\*(\d+))?(\*)?$/);
      if (!m) continue;
      const base = m[1], idx = m[2] !== undefined ? parseInt(m[2], 10) : -1, encoded = !!m[3];
      if (!cont[base]) cont[base] = [];
      cont[base].push({ idx, encoded, val });
    }
    for (const base in cont) {
      const pieces = cont[base].sort((a, b) => a.idx - b.idx);
      let charset = 'utf-8', out = '';
      pieces.forEach((pc, n) => {
        let v = pc.val;
        if (pc.encoded) {
          if (n === 0 || pc.idx <= 0) {
            const mm = v.match(/^([^']*)'[^']*'(.*)$/);
            if (mm) { charset = mm[1] || 'utf-8'; v = mm[2]; }
          }
          const bytes = [];
          for (let i = 0; i < v.length; i++) {
            if (v[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(v.substr(i + 1, 2))) { bytes.push(parseInt(v.substr(i + 1, 2), 16)); i += 2; }
            else bytes.push(v.charCodeAt(i) & 0xff);
          }
          out += decodeBytes(new Uint8Array(bytes), charset);
        } else {
          out += decodeEncodedWords(v);
        }
      });
      result.params[base] = out;
    }
    return result;
  }

  /* ---------- addresses ---------- */
  function parseAddressList(value) {
    value = decodeEncodedWords(value || '');
    const out = [];
    if (!value.trim()) return out;
    const items = [];
    let cur = '', inQ = false, depth = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === '"' && value[i - 1] !== '\\') inQ = !inQ;
      else if (!inQ && ch === '<') depth++;
      else if (!inQ && ch === '>') depth = Math.max(0, depth - 1);
      if ((ch === ',' || ch === ';') && !inQ && depth === 0) { items.push(cur); cur = ''; }
      else cur += ch;
    }
    items.push(cur);
    for (let item of items) {
      item = item.trim();
      if (!item) continue;
      let m = item.match(/^(.*?)<([^>]*)>\s*$/);
      let name = '', address = '';
      if (m) { name = m[1].trim(); address = m[2].trim(); }
      else if (/@/.test(item)) { address = item.replace(/^<|>$/g, '').trim(); }
      else { name = item; }
      name = name.replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim();
      if (!name && address) name = address.split('@')[0];
      out.push({ name, address: address.toLowerCase() });
    }
    return out;
  }

  /* ---------- body / parts ---------- */
  function decodeTransfer(body, encoding) {
    encoding = (encoding || '7bit').toLowerCase().trim();
    if (encoding === 'base64') return decodeBase64(body);
    if (encoding === 'quoted-printable') return decodeQP(body, false);
    return strToBytes(body);
  }

  function parsePart(raw, depth) {
    depth = depth || 0;
    const { head, body } = splitHeadersBody(raw);
    const headers = parseHeaders(head);
    const ct = parseParamHeader(firstHeader(headers, 'content-type') || 'text/plain; charset=us-ascii');
    const cd = parseParamHeader(firstHeader(headers, 'content-disposition'));
    const cte = firstHeader(headers, 'content-transfer-encoding');
    const part = {
      headers, type: ct.value || 'text/plain', params: ct.params, disposition: cd.value, dispParams: cd.params,
      contentId: (firstHeader(headers, 'content-id') || '').replace(/^<|>$/g, '').trim(), children: [], bytes: null, text: null
    };
    if (part.type.startsWith('multipart/') && ct.params.boundary && depth < 20) {
      const boundary = ct.params.boundary;
      const delimRe = new RegExp('(?:^|\\r?\\n)--' + escapeRe(boundary) + '(--)?[ \\t]*(?=\\r?\\n|$)', 'g');
      let m, last = null;
      const segs = [];
      while ((m = delimRe.exec(body))) {
        if (last !== null) segs.push(body.slice(last, m.index));
        if (m[1] === '--') { last = null; break; }
        last = m.index + m[0].length;
        if (m[0].length === 0) delimRe.lastIndex++;
      }
      if (last !== null) segs.push(body.slice(last)); // no closing delimiter
      for (const seg of segs) {
        const s = seg.replace(/^\r?\n/, '');
        if (s.trim()) part.children.push(parsePart(s, depth + 1));
      }
    } else if (part.type === 'message/rfc822' && depth < 20 && !isAttachment(part)) {
      part.children.push(parsePart(body, depth + 1));
      part.bytes = strToBytes(body);
    } else {
      part.bytes = decodeTransfer(body, cte);
      if (part.type.startsWith('text/')) {
        part.text = decodeBytes(part.bytes, ct.params.charset || guessCharset(part.bytes));
      }
    }
    return part;
  }

  function guessCharset(bytes) {
    // UTF-8 BOM / validity check
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'utf-8'; } catch (e) { return 'windows-1252'; }
  }

  function isAttachment(part) {
    return part.disposition === 'attachment' || !!(part.dispParams && part.dispParams.filename && part.disposition !== 'inline');
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function filenameOf(part) {
    return (part.dispParams && part.dispParams.filename) || (part.params && part.params.name) || '';
  }

  function extFromType(type) {
    const map = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'text/calendar': 'ics', 'message/rfc822': 'eml', 'application/zip': 'zip', 'text/plain': 'txt', 'text/html': 'html' };
    return map[type] || 'bin';
  }

  /* ---------- normalize ---------- */
  function collect(part, ctx) {
    if (part.type.startsWith('multipart/')) {
      if (part.type === 'multipart/alternative') {
        // pick best alternative: html > plain, but keep plain text too
        for (const c of part.children) collect(c, ctx);
      } else {
        for (const c of part.children) collect(c, ctx);
      }
      return;
    }
    const fname = filenameOf(part);
    if (part.type === 'text/html' && !isAttachment(part) && !fname) {
      if (!ctx.html) ctx.html = part.text; else ctx.html += '<hr>' + part.text;
      return;
    }
    if (part.type === 'text/plain' && !isAttachment(part) && !fname) {
      if (!ctx.text) ctx.text = part.text; else ctx.text += '\n\n' + part.text;
      return;
    }
    if (part.type === 'message/rfc822' && part.children.length && !isAttachment(part) && !fname) {
      // inline forwarded message – flatten
      const sub = normalize(part.children[0]);
      ctx.text = (ctx.text || '') + '\n\n----- Forwarded message -----\n' + sub.textBody;
      if (sub.htmlBody) ctx.html = (ctx.html || '') + '<hr>' + sub.htmlBody;
      for (const a of sub.attachments) ctx.attachments.push(a);
      return;
    }
    // attachment
    const name = fname || (part.type === 'message/rfc822' ? 'forwarded-message.eml' : ('attachment.' + extFromType(part.type)));
    ctx.attachments.push({
      name, type: part.type || 'application/octet-stream', size: part.bytes ? part.bytes.length : 0,
      cid: part.contentId || '', inline: part.disposition === 'inline' && !!part.contentId, bytes: part.bytes || new Uint8Array(0)
    });
  }

  function normalize(root) {
    const h = root.headers;
    const ctx = { html: null, text: null, attachments: [] };
    collect(root, ctx);
    const from = parseAddressList(firstHeader(h, 'from'))[0] || { name: '', address: '' };
    const replyTo = parseAddressList(firstHeader(h, 'reply-to'))[0] || null;
    const date = parseDate(firstHeader(h, 'date'));
    const importance = (firstHeader(h, 'importance') || '').toLowerCase();
    const xprio = (firstHeader(h, 'x-priority') || '').trim();
    const listUnsub = !!firstHeader(h, 'list-unsubscribe') || !!firstHeader(h, 'list-id');
    const precedence = (firstHeader(h, 'precedence') || '').toLowerCase();
    return {
      subject: decodeEncodedWords(firstHeader(h, 'subject')).replace(/\s+/g, ' ').trim(),
      from, replyTo,
      to: parseAddressList((h['to'] || []).join(', ')),
      cc: parseAddressList((h['cc'] || []).join(', ')),
      date: date ? date.toISOString() : null,
      messageId: firstHeader(h, 'message-id'),
      textBody: ctx.text != null ? ctx.text : (ctx.html ? htmlToText(ctx.html) : ''),
      htmlBody: ctx.html,
      attachments: ctx.attachments,
      flags: {
        importance: importance === 'high' || /^[12]\b/.test(xprio) ? 'high' : (importance === 'low' || /^[45]\b/.test(xprio) ? 'low' : 'normal'),
        automated: listUnsub || precedence === 'bulk' || precedence === 'list' || !!firstHeader(h, 'auto-submitted') && firstHeader(h, 'auto-submitted').toLowerCase() !== 'no'
      }
    };
  }

  function parseDate(v) {
    if (!v) return null;
    v = v.replace(/\([^)]*\)/g, '').trim();
    let d = new Date(v);
    if (isNaN(d)) { d = new Date(v.replace(/^[A-Za-z]{3},?\s*/, '')); }
    return isNaN(d) ? null : d;
  }

  function htmlToText(html) {
    if (!html) return '';
    let s = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|blockquote|pre)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ').replace(/<td[^>]*>/gi, ' ').replace(/<[^>]+>/g, '');
    const ta = typeof document !== 'undefined' ? document.createElement('textarea') : null;
    if (ta) { ta.innerHTML = s; s = ta.value; }
    else s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function parseEml(arrayBuffer) {
    const raw = latin1.decode(new Uint8Array(arrayBuffer));
    const root = parsePart(raw, 0);
    const email = normalize(root);
    email.source = 'eml';
    return email;
  }

  // Parse pasted / plain text into a pseudo email
  function parsePastedText(text) {
    const email = { subject: '', from: { name: '', address: '' }, to: [], cc: [], date: null, textBody: '', htmlBody: null, attachments: [], flags: { importance: 'normal', automated: false }, source: 'paste' };
    const lines = text.replace(/\r/g, '').split('\n');
    let bodyStart = 0;
    const headerRe = /^\s*(from|to|cc|subject|date|sent|المرسل|من|إلى|الى|الموضوع|التاريخ|نسخة)\s*[:：]\s*(.*)$/i;
    let seenHeader = false;
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      const m = lines[i].match(headerRe);
      if (m) {
        seenHeader = true;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === 'from' || key === 'المرسل' || key === 'من') email.from = parseAddressList(val)[0] || { name: val, address: '' };
        else if (key === 'to' || key === 'إلى' || key === 'الى') email.to = parseAddressList(val);
        else if (key === 'cc' || key === 'نسخة') email.cc = parseAddressList(val);
        else if (key === 'subject' || key === 'الموضوع') email.subject = val;
        else if (key === 'date' || key === 'sent' || key === 'التاريخ') { const d = parseDate(val); email.date = d ? d.toISOString() : null; }
        bodyStart = i + 1;
      } else if (seenHeader && lines[i].trim() === '') { bodyStart = i + 1; break; }
      else if (seenHeader) break;
    }
    email.textBody = lines.slice(bodyStart).join('\n').trim();
    if (!email.subject) email.subject = (email.textBody.split('\n')[0] || '').slice(0, 80);
    return email;
  }

  global.MimeParser = { parseEml, parsePastedText, decodeEncodedWords, parseAddressList, htmlToText, decodeBytes, normalizeCharset };
})(window);
