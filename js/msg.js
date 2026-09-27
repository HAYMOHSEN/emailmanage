/* ============================================================
   msg.js — Outlook .msg parser (OLE2/CFB compound file), with
   compressed-RTF decoding and RTF→HTML de-encapsulation.
   Dependency-free.
   ============================================================ */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------
     Compound File Binary (CFB) reader
     ------------------------------------------------------------ */
  const ENDOFCHAIN = 0xFFFFFFFE, FREESECT = 0xFFFFFFFF, NOSTREAM = 0xFFFFFFFF;

  class CFB {
    constructor(buffer) {
      this.buf = buffer;
      this.dv = new DataView(buffer);
      this.u8 = new Uint8Array(buffer);
      const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
      for (let i = 0; i < 8; i++) if (this.u8[i] !== sig[i]) throw new Error('Not an OLE compound file');
      this.sectorShift = this.dv.getUint16(0x1E, true);
      this.miniShift = this.dv.getUint16(0x20, true);
      this.sectorSize = 1 << this.sectorShift;
      this.miniSize = 1 << this.miniShift;
      this.numFat = this.dv.getUint32(0x2C, true);
      this.firstDir = this.dv.getUint32(0x30, true);
      this.miniCutoff = this.dv.getUint32(0x38, true);
      this.firstMiniFat = this.dv.getUint32(0x3C, true);
      this.numMiniFat = this.dv.getUint32(0x40, true);
      this.firstDifat = this.dv.getUint32(0x44, true);
      this.numDifat = this.dv.getUint32(0x48, true);
      this.readFat();
      this.readDirectory();
      this.readMiniFat();
    }
    sectorOffset(sid) { return (sid + 1) * this.sectorSize; }
    readFat() {
      const entriesPerSector = this.sectorSize / 4;
      const fatSectors = [];
      for (let i = 0; i < 109 && i < this.numFat; i++) {
        const s = this.dv.getUint32(0x4C + i * 4, true);
        if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
      }
      let difat = this.firstDifat, guard = 0;
      while (difat !== ENDOFCHAIN && difat !== FREESECT && guard++ < this.numDifat + 1) {
        const off = this.sectorOffset(difat);
        if (off + this.sectorSize > this.buf.byteLength) break;
        for (let i = 0; i < entriesPerSector - 1; i++) {
          const s = this.dv.getUint32(off + i * 4, true);
          if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
        }
        difat = this.dv.getUint32(off + (entriesPerSector - 1) * 4, true);
      }
      this.fat = [];
      for (const fs of fatSectors) {
        const off = this.sectorOffset(fs);
        for (let i = 0; i < entriesPerSector; i++) {
          if (off + i * 4 + 4 > this.buf.byteLength) { this.fat.push(FREESECT); continue; }
          this.fat.push(this.dv.getUint32(off + i * 4, true));
        }
      }
    }
    chain(start, table) {
      const out = [];
      let s = start, guard = 0;
      while (s !== ENDOFCHAIN && s !== FREESECT && s !== NOSTREAM && guard++ < 1e6) {
        if (s >= table.length) break;
        out.push(s);
        s = table[s];
      }
      return out;
    }
    readChainBytes(start, size) {
      const sectors = this.chain(start, this.fat);
      const out = new Uint8Array(size);
      let pos = 0;
      for (const s of sectors) {
        if (pos >= size) break;
        const off = this.sectorOffset(s);
        const len = Math.min(this.sectorSize, size - pos, this.buf.byteLength - off);
        if (len <= 0) break;
        out.set(this.u8.subarray(off, off + len), pos);
        pos += len;
      }
      return pos < size ? out.subarray(0, pos) : out;
    }
    readDirectory() {
      const dirBytes = this.readChainBytes(this.firstDir, this.chain(this.firstDir, this.fat).length * this.sectorSize);
      const dv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
      this.entries = [];
      for (let off = 0; off + 128 <= dirBytes.byteLength; off += 128) {
        const nameLen = dv.getUint16(off + 64, true);
        let name = '';
        for (let i = 0; i + 1 < Math.min(nameLen, 64); i += 2) {
          const c = dv.getUint16(off + i, true);
          if (c === 0) break;
          name += String.fromCharCode(c);
        }
        const type = dv.getUint8(off + 66);
        const size = dv.getUint32(off + 120, true) + (this.sectorShift > 9 ? dv.getUint32(off + 124, true) * 4294967296 : 0);
        this.entries.push({
          name, type, left: dv.getInt32(off + 68, true), right: dv.getInt32(off + 72, true), child: dv.getInt32(off + 76, true),
          start: dv.getUint32(off + 116, true), size
        });
      }
      this.root = this.entries[0];
    }
    readMiniFat() {
      const miniFatBytes = this.readChainBytes(this.firstMiniFat, this.chain(this.firstMiniFat, this.fat).length * this.sectorSize);
      const dv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
      this.miniFat = [];
      for (let i = 0; i + 4 <= miniFatBytes.byteLength; i += 4) this.miniFat.push(dv.getUint32(i, true));
      this.miniStream = this.root ? this.readChainBytes(this.root.start, this.root.size) : new Uint8Array(0);
    }
    readStream(entry) {
      if (!entry || entry.type !== 2) return new Uint8Array(0);
      if (entry.size < this.miniCutoff) {
        const sectors = this.chain(entry.start, this.miniFat);
        const out = new Uint8Array(entry.size);
        let pos = 0;
        for (const s of sectors) {
          if (pos >= entry.size) break;
          const off = s * this.miniSize;
          const len = Math.min(this.miniSize, entry.size - pos, this.miniStream.length - off);
          if (len <= 0) break;
          out.set(this.miniStream.subarray(off, off + len), pos);
          pos += len;
        }
        return pos < entry.size ? out.subarray(0, pos) : out;
      }
      return this.readChainBytes(entry.start, entry.size);
    }
    children(entry) {
      const out = [];
      const visit = (idx, depth) => {
        if (idx < 0 || idx >= this.entries.length || depth > 5000) return;
        const e = this.entries[idx];
        if (!e || e.type === 0) return;
        visit(e.left, depth + 1);
        out.push(e);
        visit(e.right, depth + 1);
      };
      if (entry) visit(entry.child, 0);
      return out;
    }
  }

  /* ------------------------------------------------------------
     Property helpers
     ------------------------------------------------------------ */
  const utf16 = new TextDecoder('utf-16le');

  function codepageLabel(cp) {
    const map = { 1256: 'windows-1256', 1252: 'windows-1252', 1250: 'windows-1250', 1251: 'windows-1251', 1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1257: 'windows-1257', 1258: 'windows-1258', 65001: 'utf-8', 20127: 'windows-1252', 28591: 'windows-1252', 28596: 'iso-8859-6', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 1200: 'utf-16le', 20866: 'koi8-r', 28605: 'iso-8859-15' };
    return map[cp] || 'windows-1252';
  }

  function decodeAnsi(bytes, codepage) {
    try { return new TextDecoder(codepageLabel(codepage)).decode(bytes); } catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }

  function stripNul(s) { return s.replace(/\u0000+$/g, ''); }

  function readStorage(cfb, storageEntry, defaultCodepage) {
    const props = {};        // key: 'XXXX' (prop id hex, upper) -> value
    const streams = {};      // raw bytes by full 8-hex tag
    const substorages = [];
    for (const e of cfb.children(storageEntry)) {
      if (e.type === 2) {
        let m = e.name.match(/^__substg1\.0_([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})$/);
        if (m) {
          const id = m[1].toUpperCase(), type = m[2].toUpperCase();
          streams[id + type] = e;
          continue;
        }
        if (e.name === '__properties_version1.0') streams.__props = e;
      } else if (e.type === 1) {
        substorages.push(e);
      }
    }
    // fixed-size properties
    let codepage = defaultCodepage;
    const fixed = {};
    if (streams.__props) {
      const b = cfb.readStream(streams.__props);
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let headerLen = 8;
      if (storageEntry === cfb.root) headerLen = 32;
      else if (/^__attach_/.test(storageEntry.name) || /^__recip_/.test(storageEntry.name)) headerLen = 8;
      else headerLen = 24; // embedded message
      for (let off = headerLen; off + 16 <= b.byteLength; off += 16) {
        const tag = dv.getUint32(off, true);
        const type = tag & 0xFFFF, id = (tag >>> 16).toString(16).toUpperCase().padStart(4, '0');
        let val;
        switch (type) {
          case 0x0002: val = dv.getInt16(off + 8, true); break;
          case 0x0003: val = dv.getInt32(off + 8, true); break;
          case 0x000B: val = dv.getUint16(off + 8, true) !== 0; break;
          case 0x0004: val = dv.getFloat32(off + 8, true); break;
          case 0x0005: val = dv.getFloat64(off + 8, true); break;
          case 0x0014: val = dv.getUint32(off + 8, true) + dv.getUint32(off + 12, true) * 4294967296; break;
          case 0x0040: { const lo = dv.getUint32(off + 8, true), hi = dv.getUint32(off + 12, true); const ft = hi * 4294967296 + lo; val = ft ? new Date(ft / 10000 - 11644473600000) : null; break; }
          default: continue;
        }
        fixed[id] = val;
      }
    }
    if (fixed['3FDE']) codepage = fixed['3FDE'];
    else if (fixed['3FFD']) codepage = fixed['3FFD'];
    const getString = (id) => {
      if (streams[id + '001F']) return stripNul(utf16.decode(cfb.readStream(streams[id + '001F'])));
      if (streams[id + '001E']) return stripNul(decodeAnsi(cfb.readStream(streams[id + '001E']), codepage));
      return null;
    };
    const getBinary = (id) => streams[id + '0102'] ? cfb.readStream(streams[id + '0102']) : null;
    const getFixed = (id) => fixed[id];
    const hasStorage = (id) => cfb.children(storageEntry).find(e => e.type === 1 && e.name.toUpperCase() === ('__SUBSTG1.0_' + id + '000D'));
    return { props, streams, substorages, codepage, getString, getBinary, getFixed, hasStorage, entry: storageEntry };
  }

  /* ------------------------------------------------------------
     Compressed RTF (LZFu) — MS-OXRTFCP
     ------------------------------------------------------------ */
  const RTF_DICT = '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx';

  function decompressRtf(bytes) {
    if (!bytes || bytes.length < 16) return new Uint8Array(0);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const compSize = dv.getUint32(0, true), rawSize = dv.getUint32(4, true), compType = dv.getUint32(8, true);
    if (compType === 0x414C454D) { // MELA (uncompressed)
      return bytes.subarray(16, 16 + rawSize);
    }
    if (compType !== 0x75465A4C) throw new Error('Unknown RTF compression');
    const dict = new Uint8Array(4096);
    for (let i = 0; i < RTF_DICT.length; i++) dict[i] = RTF_DICT.charCodeAt(i);
    let wp = RTF_DICT.length;
    const out = new Uint8Array(rawSize + 4096);
    let op = 0, ip = 16;
    const end = Math.min(bytes.length, compSize + 4);
    while (ip < end) {
      const ctrl = bytes[ip++];
      for (let bit = 0; bit < 8 && ip < end; bit++) {
        if (ctrl & (1 << bit)) {
          if (ip + 1 >= bytes.length) return out.subarray(0, op);
          const b1 = bytes[ip++], b2 = bytes[ip++];
          const offset = (b1 << 4) | (b2 >> 4);
          const len = (b2 & 0x0F) + 2;
          if (offset === wp) return out.subarray(0, op);
          for (let i = 0; i < len; i++) {
            const c = dict[(offset + i) % 4096];
            if (op < out.length) out[op++] = c;
            dict[wp] = c; wp = (wp + 1) % 4096;
          }
        } else {
          const c = bytes[ip++];
          if (op < out.length) out[op++] = c;
          dict[wp] = c; wp = (wp + 1) % 4096;
        }
      }
    }
    return out.subarray(0, op);
  }

  /* ------------------------------------------------------------
     RTF tokenizer + HTML de-encapsulation (MS-OXRTFEX) + text
     ------------------------------------------------------------ */
  function rtfToHtmlOrText(rtfBytes, defaultCodepage) {
    const latin = new TextDecoder('latin1').decode(rtfBytes);
    const isHtml = /\\fromhtml1?\b/.test(latin.slice(0, 2000));
    const isText = /\\fromtext\b/.test(latin.slice(0, 2000));
    let cpMatch = latin.match(/\\ansicpg(\d+)/);
    let codepage = cpMatch ? parseInt(cpMatch[1], 10) : defaultCodepage;
    let decoder;
    try { decoder = new TextDecoder(codepageLabel(codepage)); } catch (e) { decoder = new TextDecoder('windows-1252'); }

    const out = [];
    let pendingBytes = [];
    const flushBytes = () => { if (pendingBytes.length) { emit(decoder.decode(new Uint8Array(pendingBytes)), true); pendingBytes = []; } };

    // state stack
    const stack = [];
    let st = { htmlrtf: false, dest: 'body', uc: 1, skipDest: false, inHtmlTag: false };
    let skipChars = 0;

    const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    function emit(text, isBodyText) {
      if (st.skipDest) return;
      if (st.htmlrtf && !st.inHtmlTag) return;
      if (isHtml && !st.inHtmlTag && isBodyText) out.push(escapeHtml(text));
      else out.push(text);
    }

    let i = 0;
    const n = latin.length;
    while (i < n) {
      const ch = latin[i];
      if (ch === '{') {
        flushBytes();
        stack.push(st);
        st = Object.assign({}, st, { inHtmlTag: false });
        // check for destination marker right after group start
        const m = latin.slice(i + 1, i + 40).match(/^\\\*\\([a-zA-Z]+)(-?\d+)?/);
        if (m) {
          const word = m[1];
          if (word === 'htmltag') { st.inHtmlTag = true; st.skipDest = false; }
          else if (word === 'mhtmltag') { st.skipDest = true; }
          else { st.skipDest = true; }
          i += 1 + m[0].length;
          if (latin[i] === ' ') i++;
          continue;
        }
        i++;
        continue;
      }
      if (ch === '}') {
        flushBytes();
        if (stack.length) st = stack.pop();
        i++;
        continue;
      }
      if (ch === '\\') {
        const next = latin[i + 1];
        if (next === "'") {
          const hex = latin.substr(i + 2, 2);
          if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
            if (!(st.skipDest || (st.htmlrtf && !st.inHtmlTag))) {
              if (skipChars > 0) { skipChars--; } else pendingBytes.push(parseInt(hex, 16));
            }
            i += 4;
            continue;
          }
          i += 2; continue;
        }
        if (next === '\\' || next === '{' || next === '}') { flushBytes(); if (skipChars > 0) skipChars--; else emit(next, true); i += 2; continue; }
        if (next === '~') { flushBytes(); if (skipChars > 0) skipChars--; else emit(' ', true); i += 2; continue; }
        if (next === '-' || next === '_' ) { i += 2; continue; }
        if (next === '\r' || next === '\n') { flushBytes(); emit('\r\n', true); i += 2; continue; }
        const m = latin.slice(i + 1, i + 40).match(/^([a-zA-Z]+)(-?\d+)?/);
        if (!m) { i += 2; continue; }
        flushBytes();
        const word = m[1], param = m[2] !== undefined ? parseInt(m[2], 10) : null;
        i += 1 + m[0].length;
        if (latin[i] === ' ') i++;
        switch (word) {
          case 'htmlrtf': st.htmlrtf = param !== 0; break;
          case 'uc': st.uc = param == null ? 1 : param; break;
          case 'u': {
            let code = param == null ? 0 : param;
            if (code < 0) code += 65536;
            emit(String.fromCharCode(code), true);
            skipChars = st.uc;
            break;
          }
          case 'par': case 'line': emit(isHtml ? '\r\n' : '\n', false); break;
          case 'tab': emit('\t', false); break;
          case 'ansicpg': break;
          case 'fonttbl': case 'colortbl': case 'stylesheet': case 'info': case 'pict': case 'object': case 'fldinst': case 'header': case 'footer': case 'generator': case 'themedata': case 'colorschememapping': case 'latentstyles': case 'datastore': case 'xmlnstbl': case 'listtable': case 'listoverridetable': case 'rsidtbl': case 'mmathPr': case 'pntext': case 'htmlbase': case 'operator': case 'footnote':
            st.skipDest = true; break;
          case 'bullet': emit('•', true); break;
          case 'endash': emit('–', true); break;
          case 'emdash': emit('—', true); break;
          case 'lquote': emit('‘', true); break;
          case 'rquote': emit('’', true); break;
          case 'ldblquote': emit('“', true); break;
          case 'rdblquote': emit('”', true); break;
          case 'emspace': case 'enspace': emit(' ', true); break;
          default: break;
        }
        continue;
      }
      if (ch === '\r' || ch === '\n') { i++; continue; }
      // plain text run
      let j = i;
      while (j < n && latin[j] !== '\\' && latin[j] !== '{' && latin[j] !== '}' && latin[j] !== '\r' && latin[j] !== '\n') j++;
      const run = latin.slice(i, j);
      if (!(st.skipDest || (st.htmlrtf && !st.inHtmlTag))) {
        for (let k = 0; k < run.length; k++) {
          if (skipChars > 0) { skipChars--; continue; }
          pendingBytes.push(run.charCodeAt(k) & 0xff);
        }
      }
      i = j;
    }
    flushBytes();
    const result = out.join('');
    return { html: isHtml ? result : null, text: isHtml ? null : result, isText };
  }

  /* ------------------------------------------------------------
     .msg → normalized email
     ------------------------------------------------------------ */
  function parseMessageStorage(cfb, storageEntry, isTop) {
    const s = readStorage(cfb, storageEntry, 1252);
    const codepage = s.codepage;
    const subject = s.getString('0037') || s.getString('0E1D') || '';
    const senderName = s.getString('0C1A') || s.getString('0042') || '';
    let senderAddr = s.getString('5D01') || s.getString('5D02') || s.getString('0C1F') || s.getString('0065') || '';
    if (senderAddr && !/@/.test(senderAddr)) {
      // Exchange DN – try to extract SMTP from headers
      senderAddr = '';
    }
    const headersRaw = s.getString('007D') || '';
    let headers = {};
    if (headersRaw) {
      headersRaw.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach(l => {
        const k = l.indexOf(':');
        if (k > 0) headers[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim();
      });
      if (!senderAddr && headers['from']) {
        const p = global.MimeParser.parseAddressList(headers['from'])[0];
        if (p) senderAddr = p.address;
      }
    }
    // recipients
    const to = [], cc = [];
    for (const sub of s.substorages) {
      if (!/^__recip_version1\.0_#/i.test(sub.name)) continue;
      const r = readStorage(cfb, sub, codepage);
      const name = r.getString('3001') || '';
      let addr = r.getString('39FE') || r.getString('3003') || '';
      if (addr && !/@/.test(addr)) addr = '';
      const type = r.getFixed('0C15');
      const rec = { name: name || addr.split('@')[0], address: addr.toLowerCase() };
      if (type === 2) cc.push(rec); else if (type === 3) { /* bcc */ } else to.push(rec);
    }
    if (!to.length && headers['to']) to.push(...global.MimeParser.parseAddressList(headers['to']));
    if (!cc.length && headers['cc']) cc.push(...global.MimeParser.parseAddressList(headers['cc']));

    // bodies
    let textBody = s.getString('1000') || '';
    let htmlBody = null;
    const htmlBytes = s.getBinary('1013');
    if (htmlBytes && htmlBytes.length) {
      htmlBody = decodeAnsi(htmlBytes, s.getFixed('3FDE') || codepage);
      // if it looks like UTF-8, re-decode
      if (/charset=["']?utf-8/i.test(htmlBody.slice(0, 2000))) { try { htmlBody = new TextDecoder('utf-8').decode(htmlBytes); } catch (e) { /* keep */ } }
    }
    if (!htmlBody) {
      const rtfComp = s.getBinary('1009');
      if (rtfComp && rtfComp.length > 16) {
        try {
          const rtf = decompressRtf(rtfComp);
          const conv = rtfToHtmlOrText(rtf, codepage);
          if (conv.html && conv.html.trim()) htmlBody = conv.html;
          else if (!textBody && conv.text) textBody = conv.text;
        } catch (e) { /* ignore RTF issues */ }
      }
    }
    if (!textBody && htmlBody) textBody = global.MimeParser.htmlToText(htmlBody);

    // attachments
    const attachments = [];
    for (const sub of s.substorages) {
      if (!/^__attach_version1\.0_#/i.test(sub.name)) continue;
      const a = readStorage(cfb, sub, codepage);
      const method = a.getFixed('3705');
      const hidden = a.getFixed('7FFE') === true;
      const name = a.getString('3707') || a.getString('3704') || a.getString('3001') || 'attachment';
      const mime = a.getString('370E') || guessMime(name);
      const cid = (a.getString('3712') || '').replace(/^<|>$/g, '');
      if (method === 5) {
        const embedded = a.hasStorage('3701');
        if (embedded) {
          try {
            const inner = parseMessageStorage(cfb, embedded, false);
            const eml = buildEml(inner);
            attachments.push({ name: (inner.subject || name).replace(/[\\/:*?"<>|]/g, '_') + '.eml', type: 'message/rfc822', size: eml.length, cid: '', inline: false, bytes: eml });
          } catch (e) { /* skip */ }
        }
        continue;
      }
      const data = a.getBinary('3701');
      if (!data) continue;
      attachments.push({ name, type: mime, size: data.length, cid, inline: !!cid, hidden, bytes: data });
    }
    const importanceVal = s.getFixed('0017');
    const prio = s.getFixed('0026');
    const date = s.getFixed('0E06') || s.getFixed('0039') || s.getFixed('3007') || null;
    return {
      subject: subject.replace(/\s+/g, ' ').trim(),
      from: { name: senderName || senderAddr.split('@')[0], address: senderAddr.toLowerCase() },
      replyTo: headers['reply-to'] ? (global.MimeParser.parseAddressList(headers['reply-to'])[0] || null) : null,
      to, cc,
      date: date ? new Date(date).toISOString() : (headers['date'] ? safeDate(headers['date']) : null),
      messageId: s.getString('1035') || headers['message-id'] || '',
      textBody: textBody || '', htmlBody, attachments,
      flags: {
        importance: importanceVal === 2 || prio === 1 ? 'high' : (importanceVal === 0 || prio === -1 ? 'low' : 'normal'),
        automated: !!headers['list-unsubscribe'] || !!headers['list-id'] || (headers['precedence'] || '').toLowerCase() === 'bulk'
      },
      source: 'msg'
    };
  }

  function safeDate(v) { const d = new Date(v.replace(/\([^)]*\)/g, '')); return isNaN(d) ? null : d.toISOString(); }

  function guessMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip', txt: 'text/plain', csv: 'text/csv', ics: 'text/calendar', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook', mp4: 'video/mp4', mp3: 'audio/mpeg' };
    return map[ext] || 'application/octet-stream';
  }

  // Build a simple RFC822 file from a parsed (embedded) message so it can be re-opened
  function buildEml(m) {
    const enc = new TextEncoder();
    const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/(.{76})/g, '$1\r\n'); };
    const encWord = (s) => /^[\x20-\x7e]*$/.test(s) ? s : '=?utf-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
    const addr = (a) => a.address ? (a.name ? `${encWord(a.name)} <${a.address}>` : a.address) : encWord(a.name);
    const boundary = 'b_' + Math.random().toString(36).slice(2);
    let s = '';
    s += `From: ${addr(m.from)}\r\n`;
    if (m.to.length) s += `To: ${m.to.map(addr).join(', ')}\r\n`;
    if (m.cc.length) s += `Cc: ${m.cc.map(addr).join(', ')}\r\n`;
    s += `Subject: ${encWord(m.subject)}\r\n`;
    if (m.date) s += `Date: ${new Date(m.date).toUTCString()}\r\n`;
    s += 'MIME-Version: 1.0\r\n';
    s += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    s += `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(enc.encode(m.textBody || ''))}\r\n`;
    if (m.htmlBody) s += `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(enc.encode(m.htmlBody))}\r\n`;
    for (const a of m.attachments) {
      s += `--${boundary}\r\nContent-Type: ${a.type}; name="${encWord(a.name)}"\r\nContent-Disposition: attachment; filename="${encWord(a.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(a.bytes)}\r\n`;
    }
    s += `--${boundary}--\r\n`;
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function parseMsg(arrayBuffer) {
    const cfb = new CFB(arrayBuffer);
    return parseMessageStorage(cfb, cfb.root, true);
  }

  global.MsgParser = { parseMsg, decompressRtf, rtfToHtmlOrText, CFB };
})(window);
