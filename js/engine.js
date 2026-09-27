/* ============================================================
   engine.js — language detection, priority scoring, date
   extraction, deadline suggestions, points-to-address,
   local smart replies, templates and optional AI providers.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- helpers ---------- */
  const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  function normalizeDigits(s) {
    return (s || '').replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d)).replace(/[۰-۹]/g, d => FA_DIGITS.indexOf(d));
  }
  function normalizeArabic(s) {
    return (s || '').replace(/[ً-ٰٟ]/g, '') // harakat
      .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  }
  function detectLang(text) {
    const t = (text || '').slice(0, 4000);
    const ar = (t.match(/[؀-ۿ]/g) || []).length;
    const la = (t.match(/[A-Za-z]/g) || []).length;
    if (ar === 0 && la === 0) return 'en';
    return ar / (ar + la) > 0.35 ? 'ar' : 'en';
  }
  function firstName(name, address) {
    let n = (name || '').trim();
    if (!n && address) n = address.split('@')[0].replace(/[._-]+/g, ' ');
    n = n.replace(/^(dr\.?|prof\.?|eng\.?|mr\.?|mrs\.?|ms\.?|د\.|م\.|أ\.د\.|أ\.|الدكتور|الدكتورة|المهندس|المهندسة|الأستاذ|الأستاذة|السيد|السيدة)\s+/i, '');
    if (/,/.test(n)) n = n.split(',')[1] || n; // "Last, First"
    n = n.trim();
    const parts = n.split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    let f = parts[0];
    if (/^[A-Z]\.$/.test(f) && parts[1]) f = parts[1];
    return f.charAt(0).toUpperCase() + f.slice(1);
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  // Name to use in a reply written in `lang` (handles Arabic names when replying in English)
  function nameFor(email, lang) {
    const name = (email.from && email.from.name) || '';
    const addr = (email.from && email.from.address) || '';
    if (lang === 'en' && /[\u0600-\u06FF]/.test(name)) {
      const parts = addr.split('@')[0].split(/[._\-]+/).filter(p => /^[a-z]+$/i.test(p));
      if (parts.length >= 2) return parts.map(p => p.length === 1 ? p.toUpperCase() + '.' : cap(p)).join(' ');
      if (parts.length === 1 && parts[0].length >= 3) return cap(parts[0]);
      return 'Colleague';
    }
    return firstName(name, addr) || (lang === 'ar' ? 'الزميل/ة' : 'there');
  }

  /* ---------- keyword sets ---------- */
  const KW = {
    urgent: ['urgent', 'urgently', 'asap', 'as soon as possible', 'immediately', 'right away', 'critical', 'emergency', 'time-sensitive', 'time sensitive', 'high priority', 'top priority', 'without delay', 'final notice', 'last chance', 'action required', 'response required', 'reply needed', 'need your reply', 'need your response',
      'عاجل', 'عاجله', 'مستعجل', 'مستعجله', 'ضروري', 'ضروريه', 'فوري', 'فوريه', 'فورا', 'طارئ', 'طارئه', 'بأسرع وقت', 'باسرع وقت', 'في أسرع وقت', 'في اسرع وقت', 'على وجه السرعه', 'مطلوب الرد', 'يرجى الرد', 'الرد ضروري', 'مهم جدا', 'اهميه قصوى', 'ذو اولويه', 'اولويه قصوى'],
    deadline: ['deadline', 'due date', 'due by', 'due on', 'by end of day', 'end of day', 'eod', 'cob', 'close of business', 'by tomorrow', 'by today', 'by monday', 'by tuesday', 'by wednesday', 'by thursday', 'by friday', 'by sunday', 'by saturday', 'no later than', 'at the latest', 'before the end of', 'within 24 hours', 'within 48 hours', 'by the end of this week', 'by this week', 'expires', 'last day', 'submission deadline', 'submit by',
      'الموعد النهائي', 'موعد نهائي', 'اخر موعد', 'آخر موعد', 'قبل نهايه', 'بحد اقصى', 'بحد أقصى', 'في موعد اقصاه', 'في موعد أقصاه', 'خلال 24 ساعه', 'خلال 48 ساعه', 'خلال يومين', 'قبل يوم', 'قبل غد', 'لا يتجاوز', 'هذا الاسبوع', 'نهايه الاسبوع', 'التسليم', 'تسليم', 'ينتهي', 'تنتهي', 'اخر يوم', 'آخر يوم'],
    request: ['please send', 'kindly send', 'could you', 'can you', 'would you', 'please provide', 'please share', 'please confirm', 'please review', 'please approve', 'please sign', 'please complete', 'please fill', 'i need', 'we need', 'request', 'requesting', 'looking forward to your reply', 'looking forward to hearing', 'awaiting your', 'waiting for your', 'let me know', 'your feedback', 'your approval', 'your input', 'your comments', 'rsvp',
      'ارجو', 'أرجو', 'يرجى', 'الرجاء', 'نرجو', 'هل يمكنك', 'هل يمكنكم', 'هل بامكانك', 'هل بإمكانك', 'ارسال', 'إرسال', 'تزويدي', 'تزويدنا', 'اعلامي', 'إعلامي', 'افادتي', 'إفادتي', 'بانتظار ردكم', 'بانتظار ردك', 'ننتظر ردكم', 'الموافقه', 'موافقتكم', 'موافقتك', 'اعتماد', 'التوقيع', 'مطلوب', 'نحتاج', 'احتاج', 'أحتاج', 'رايكم', 'رأيكم', 'ملاحظاتكم', 'التاكيد', 'التأكيد', 'تاكيد', 'تأكيد'],
    reminder: ['reminder', 'gentle reminder', 'friendly reminder', 'follow up', 'follow-up', 'following up', 'any update', 'still waiting', 'second request', 'have not received', "haven't received", 'did you get',
      'تذكير', 'للتذكير', 'متابعه', 'للمتابعه', 'اي جديد', 'أي جديد', 'هل هناك جديد', 'لم اتلق', 'لم أتلق', 'لم نتلق', 'ما زلت بانتظار', 'مازلت بانتظار', 'مره اخرى', 'مرة أخرى', 'الرساله السابقه'],
    automated: ['unsubscribe', 'newsletter', 'do not reply', 'do-not-reply', 'noreply', 'no-reply', 'notification', 'automatic', 'auto-generated', 'automated message', 'this is an automated', 'view in browser', 'manage your preferences',
      'الغاء الاشتراك', 'إلغاء الاشتراك', 'رساله اليه', 'رسالة آلية', 'لا ترد على هذه', 'لا تقم بالرد', 'نشره', 'نشرة', 'اشعار', 'إشعار']
  };
  const AUTOMATED_SENDER = /(no-?reply|do-?not-?reply|noreply|newsletter|notification|notifications|mailer|bounce|alerts?|digest|marketing|info@|support@|system@|automated)/i;

  function countHits(text, list) {
    let n = 0; const hits = [];
    for (const k0 of list) {
      const k = normalizeArabic(k0);
      const re = new RegExp('(^|[^\\p{L}])' + escapeRe(k) + '(?=$|[^\\p{L}])', 'iu');
      if (re.test(text)) { n++; hits.push(k); }
    }
    return { n, hits };
  }

  /* ---------- date extraction ---------- */
  const MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const MONTHS_EN_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];
  const MONTHS_AR = {
    'يناير': 0, 'كانون الثاني': 0, 'فبراير': 1, 'شباط': 1, 'مارس': 2, 'اذار': 2, 'آذار': 2, 'ابريل': 3, 'أبريل': 3, 'إبريل': 3, 'نيسان': 3, 'مايو': 4, 'ايار': 4, 'أيار': 4, 'يونيو': 5, 'حزيران': 5, 'يوليو': 6, 'تموز': 6, 'اغسطس': 7, 'أغسطس': 7, 'اب': 7, 'آب': 7, 'سبتمبر': 8, 'ايلول': 8, 'أيلول': 8, 'اكتوبر': 9, 'أكتوبر': 9, 'تشرين الاول': 9, 'تشرين الأول': 9, 'نوفمبر': 10, 'تشرين الثاني': 10, 'ديسمبر': 11, 'كانون الاول': 11, 'كانون الأول': 11
  };
  const WEEKDAYS_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const WEEKDAYS_AR = { 'الاحد': 0, 'الأحد': 0, 'الاثنين': 1, 'الإثنين': 1, 'الثلاثاء': 2, 'الاربعاء': 3, 'الأربعاء': 3, 'الخميس': 4, 'الجمعه': 5, 'الجمعة': 5, 'السبت': 6 };

  function atHour(d, h) { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function extractDates(text, ref) {
    ref = ref ? new Date(ref) : new Date();
    const src = normalizeDigits(text || '').slice(0, 8000);
    const low = src.toLowerCase();
    const found = [];
    const push = (d, m, kind) => { if (d && !isNaN(d)) found.push({ date: d, match: m, kind }); };
    const year = ref.getFullYear();
    let m;
    // ISO yyyy-mm-dd
    const isoRe = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
    while ((m = isoRe.exec(src))) push(atHour(new Date(+m[1], +m[2] - 1, +m[3]), 17), m[0], 'absolute');
    // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yy
    const dmyRe = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g;
    while ((m = dmyRe.exec(src))) {
      let d = +m[1], mo = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) push(atHour(new Date(y, mo - 1, d), 17), m[0], 'absolute');
    }
    // dd Month [yyyy] | Month dd[, yyyy]  (English)
    const monthAlt = MONTHS_EN.concat(MONTHS_EN_SHORT).join('|');
    const dMonRe = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + monthAlt + ')\\.?(?:,?\\s+(20\\d{2}))?\\b', 'gi');
    while ((m = dMonRe.exec(low))) { const mo = monthIndex(m[2]); if (mo >= 0) push(resolveYear(+m[1], mo, m[3] ? +m[3] : null, ref), m[0], 'absolute'); }
    const monDRe = new RegExp('\\b(' + monthAlt + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b', 'gi');
    while ((m = monDRe.exec(low))) { const mo = monthIndex(m[1]); if (mo >= 0) push(resolveYear(+m[2], mo, m[3] ? +m[3] : null, ref), m[0], 'absolute'); }
    // Arabic: dd Month [yyyy]
    const arMonthAlt = Object.keys(MONTHS_AR).map(escapeRe).join('|');
    const arRe = new RegExp('(\\d{1,2})\\s*(?:من\\s+)?(?:شهر\\s+)?(' + arMonthAlt + ')(?:\\s*(?:من\\s+)?(?:عام\\s+|سنه\\s+|سنة\\s+)?(20\\d{2}))?', 'g');
    while ((m = arRe.exec(src))) { const mo = MONTHS_AR[m[2]]; if (mo !== undefined) push(resolveYear(+m[1], mo, m[3] ? +m[3] : null, ref), m[0], 'absolute'); }
    // relative words
    const rel = [
      [/\b(today|tonight|this evening|end of (the )?day|eod|cob)\b/i, 0, 'today'], [/\b(tomorrow|tmrw)\b/i, 1, 'tomorrow'],
      [/(اليوم|نهاية اليوم|نهايه اليوم|قبل نهاية الدوام|قبل نهايه الدوام)/, 0, 'today'], [/(غدا|غداً|بكرا|بكرة|بكره|يوم غد|صباح الغد)/, 1, 'tomorrow'],
      [/\b(end of (this |the )?week|this week)\b/i, null, 'week'], [/(نهاية الأسبوع|نهاية الاسبوع|نهايه الاسبوع|هذا الأسبوع|هذا الاسبوع)/, null, 'week'],
      [/\b(next week)\b/i, null, 'nextweek'], [/(الأسبوع القادم|الاسبوع القادم|الأسبوع المقبل|الاسبوع المقبل)/, null, 'nextweek']
    ];
    for (const [re, days, kind] of rel) {
      const mm = src.match(re);
      if (!mm) continue;
      if (days !== null) push(atHour(addDays(ref, days), 17), mm[0], kind);
      else if (kind === 'week') { const dow = ref.getDay(); const thu = addDays(ref, (4 - dow + 7) % 7); push(atHour(thu, 17), mm[0], kind); }
      else if (kind === 'nextweek') { const dow = ref.getDay(); push(atHour(addDays(ref, ((7 - dow) % 7) + 7), 17), mm[0], kind); }
    }
    // weekdays
    for (let i = 0; i < 7; i++) {
      const re = new RegExp('\\b(?:on|by|next|this|coming|before)?\\s*' + WEEKDAYS_EN[i] + '\\b(?!,?\\s*(?:the\\s+)?\\d)', 'i');
      const mm = src.match(re);
      if (mm) { let diff = (i - ref.getDay() + 7) % 7; if (diff === 0) diff = 7; push(atHour(addDays(ref, diff), 17), mm[0], 'weekday'); }
    }
    for (const k in WEEKDAYS_AR) {
      const re = new RegExp('(?:يوم\\s+)?' + k + '(?:\\s+(?:القادم|المقبل))?(?!\\s*،?\\s*\\d)');
      const mm = src.match(re);
      if (mm) { let diff = (WEEKDAYS_AR[k] - ref.getDay() + 7) % 7; if (diff === 0) diff = 7; push(atHour(addDays(ref, diff), 17), mm[0], 'weekday'); }
    }
    // keep sensible dates: not more than 2 days in the past, within 400 days
    const now = ref.getTime();
    const ok = found.filter(f => f.date.getTime() > now - 2 * 864e5 && f.date.getTime() < now + 400 * 864e5);
    ok.sort((a, b) => a.date - b.date);
    const seen = new Set();
    return ok.filter(f => { const k = f.date.toDateString(); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function monthIndex(name) {
    name = name.toLowerCase().replace(/\.$/, '');
    let i = MONTHS_EN.indexOf(name); if (i >= 0) return i;
    i = MONTHS_EN_SHORT.indexOf(name); if (i >= 0) return i > 8 ? i - 1 : i; // 'sept' shares index
    if (name === 'sept') return 8;
    return -1;
  }
  function resolveYear(day, month, year, ref) {
    if (day < 1 || day > 31) return null;
    if (year) return atHour(new Date(year, month, day), 17);
    let d = atHour(new Date(ref.getFullYear(), month, day), 17);
    if (d.getTime() < ref.getTime() - 30 * 864e5) d = atHour(new Date(ref.getFullYear() + 1, month, day), 17);
    return d;
  }

  /* ---------- priority scoring ---------- */
  function scoreEmail(email, settings) {
    settings = settings || {};
    const subj = normalizeArabic((email.subject || '').toLowerCase());
    const body = normalizeArabic((email.textBody || '').slice(0, 6000).toLowerCase());
    const all = subj + '\n' + body;
    let score = 0;
    const reasons = [];
    const addr = (email.from && email.from.address || '').toLowerCase();
    const domain = addr.split('@')[1] || '';
    const custom = (settings.customKeywords || []).map(k => normalizeArabic(k.toLowerCase())).filter(Boolean);

    // automated / newsletters
    const autoHits = countHits(all, KW.automated);
    if ((email.flags && email.flags.automated) || AUTOMATED_SENDER.test(addr) || autoHits.n >= 2) {
      score -= 5; reasons.push('automated');
    }
    // header importance
    if (email.flags && email.flags.importance === 'high') { score += 3; reasons.push('importance_high'); }
    if (email.flags && email.flags.importance === 'low') { score -= 1; }
    // urgent keywords
    const uSubj = countHits(subj, KW.urgent.concat(custom));
    const uBody = countHits(body, KW.urgent.concat(custom));
    if (uSubj.n) { score += Math.min(6, 3 * uSubj.n); reasons.push('urgent_subject'); }
    if (uBody.n) { score += Math.min(4, 1.5 * uBody.n); reasons.push('urgent_body'); }
    // deadline phrases
    const dl = countHits(all, KW.deadline);
    if (dl.n) { score += Math.min(4, 2 * dl.n); reasons.push('deadline_phrase'); }
    // explicit dates
    const dates = extractDates(email.textBody || '', email.date || Date.now());
    const now = Date.now();
    const soon = dates.find(d => d.date.getTime() - now < 3 * 864e5);
    const week = dates.find(d => d.date.getTime() - now < 8 * 864e5);
    if (soon) { score += 2; reasons.push('date_soon'); }
    else if (week) { score += 1.2; reasons.push('date_week'); }
    // questions & requests
    const q = ((email.textBody || '').split(/\n(?:>|On .* wrote:|From: |-----Original Message-----)/)[0].match(/[?؟]/g) || []).length;
    if (q >= 3) { score += 2.5; reasons.push('questions'); }
    else if (q >= 1) { score += 1.5; reasons.push('questions'); }
    const rq = countHits(all, KW.request);
    if (rq.n) { score += Math.min(2, 0.75 * rq.n); reasons.push('request'); }
    const rm = countHits(all, KW.reminder);
    if (rm.n) { score += 1.5; reasons.push('reminder'); }
    // VIP senders
    const vips = (settings.vipSenders || []).map(v => v.toLowerCase().trim()).filter(Boolean);
    if (addr && vips.some(v => v === addr)) { score += 4; reasons.push('vip'); }
    else if (domain && vips.some(v => v.startsWith('@') ? v.slice(1) === domain : (v.includes('*') && domain.endsWith(v.replace('*', ''))))) { score += 2.5; reasons.push('vip_domain'); }
    // subject prefixes
    if (/^(re|رد|fw|fwd|إعادة توجيه)\s*:/i.test(email.subject || '')) { score += 0.5; }
    if (/\b(reminder|تذكير)\b/i.test(subj)) { score += 1; }
    // CC only (user not in To)
    const my = (settings.myAddresses || []).map(a => a.toLowerCase().trim()).filter(Boolean);
    if (my.length && email.to && email.to.length && !email.to.some(t => my.includes((t.address || '').toLowerCase())) && (email.cc || []).some(c => my.includes((c.address || '').toLowerCase()))) { score -= 1.5; reasons.push('cc_only'); }
    // age
    if (email.date) { const ageDays = (now - new Date(email.date).getTime()) / 864e5; if (ageDays > 3 && score > 0) { score += 1; reasons.push('waiting_long'); } }
    // attachments requiring action
    if ((email.attachments || []).some(a => /\.(docx?|xlsx?|pdf)$/i.test(a.name)) && rq.n) { score += 0.5; }

    let priority;
    if (score >= 8) priority = 1; else if (score >= 4.5) priority = 2; else if (score >= 1.5) priority = 3; else priority = 4;
    return { score: Math.round(score * 10) / 10, priority, reasons: Array.from(new Set(reasons)), dates };
  }

  function suggestDue(priority, dates, settings) {
    const hours = Object.assign({ 1: 6, 2: 24, 3: 72, 4: 168 }, settings && settings.dueHours || {});
    const now = new Date();
    let due = new Date(now.getTime() + (hours[priority] || 72) * 3600e3);
    // avoid landing in the middle of the night: push to 09:00 if between 21:00 and 07:00
    if (due.getHours() >= 21) { due = atHour(addDays(due, 1), 9); }
    else if (due.getHours() < 7) { due = atHour(due, 9); }
    if (dates && dates.length) {
      const d = dates[0].date;
      if (d.getTime() > now.getTime() + 3600e3 && d.getTime() < now.getTime() + 30 * 864e5) {
        let cand = atHour(addDays(d, -1), 15);
        if (cand.getTime() < now.getTime() + 2 * 3600e3) cand = new Date(Math.min(d.getTime(), now.getTime() + 4 * 3600e3));
        if (cand.getTime() < due.getTime()) due = cand;
      }
    }
    return due;
  }

  /* ---------- points to address ---------- */
  function extractPoints(email) {
    const text = (email.textBody || '').replace(/\r/g, '');
    // drop quoted replies
    const cut = text.split(/\n(?:>|On .* wrote:|From: |-----Original Message-----|في .* كتب)/)[0];
    const sentences = cut.split(/(?<=[.!?؟。])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 8 && s.length < 260);
    const points = [];
    const reqRe = /(please|kindly|could you|can you|would you|i need|we need|let me know|send|provide|share|confirm|review|approve|attach|submit|reply|respond|ارجو|أرجو|يرجى|الرجاء|نرجو|هل يمكن|هل بامكان|هل بإمكان|ارسال|إرسال|تزويد|اعلام|إعلام|افاد|إفاد|تاكيد|تأكيد|مراجعه|مراجعة|الموافقه|الموافقة|اعتماد|مطلوب|نحتاج|احتاج|أحتاج)/i;
    for (const s of sentences) {
      if (/[?؟]$/.test(s) || /[?؟]/.test(s)) points.push({ text: s, kind: 'question' });
      else if (reqRe.test(s)) points.push({ text: s, kind: 'request' });
      if (points.length >= 6) break;
    }
    return points;
  }

  /* ---------- intent detection ---------- */
  const INTENTS = {
    meeting: ['meeting', 'meet', 'call', 'appointment', 'schedule', 'zoom', 'teams', 'discussion', 'catch up', 'sync', 'available on', 'availability', 'calendar',
      'اجتماع', 'موعد', 'لقاء', 'مقابله', 'مكالمه', 'اتصال', 'زوم', 'تيمز', 'نلتقي', 'نجتمع', 'متاح', 'مناقشه'],
    invitation: ['invite', 'invitation', 'invited', 'workshop', 'conference', 'seminar', 'webinar', 'ceremony', 'event', 'keynote', 'panel', 'symposium', 'you are cordially',
      'دعوه', 'ندعوكم', 'يسرنا دعوتكم', 'ورشه', 'مؤتمر', 'ندوه', 'حفل', 'فعاليه', 'ملتقى', 'محاضره', 'تشرفنا بحضوركم'],
    issue: ['problem', 'issue', 'error', 'not working', 'doesn\'t work', 'does not work', 'failed', 'failure', 'complaint', 'complain', 'broken', 'bug', 'wrong', 'mistake', 'unable to', 'cannot access', 'can\'t access', 'delay in',
      'مشكله', 'خطأ', 'خطا', 'عطل', 'لا يعمل', 'شكوى', 'اشكاليه', 'إشكاليه', 'فشل', 'لم استطع', 'لم أستطع', 'لا استطيع', 'لا أستطيع', 'غير قادر', 'تاخير', 'تأخير'],
    student: ['student', 'grade', 'grades', 'mark', 'marks', 'exam', 'quiz', 'course', 'assignment', 'homework', 'lecture', 'registration', 'register', 'recommendation letter', 'reference letter', 'thesis', 'project supervision', 'absence', 'makeup', 'make-up', 'incomplete', 'gpa', 'semester', 'syllabus', 'attendance',
      'طالب', 'طالبه', 'علامه', 'علامات', 'درجه', 'درجات', 'امتحان', 'اختبار', 'كويز', 'مساق', 'ماده', 'واجب', 'محاضره', 'تسجيل', 'رساله توصيه', 'خطاب توصيه', 'مشروع التخرج', 'رساله الماجستير', 'غياب', 'تعويضي', 'الفصل الدراسي', 'معدل', 'الحضور', 'مشرف'],
    deadline: ['deadline', 'due', 'submit', 'submission', 'deliver', 'complete by', 'finish by', 'no later than', 'by end of', 'expected by', 'required by',
      'الموعد النهائي', 'موعد نهائي', 'اخر موعد', 'تسليم', 'التسليم', 'انجاز', 'إنجاز', 'بحد اقصى', 'قبل نهايه', 'لا يتجاوز', 'مطلوب انجاز'],
    request: ['please send', 'kindly send', 'could you send', 'can you send', 'please provide', 'please share', 'please attach', 'i need', 'we need', 'request', 'requesting', 'would like to request', 'copy of', 'document', 'report', 'file', 'form', 'certificate', 'letter', 'signature', 'sign', 'approve', 'approval',
      'ارجو ارسال', 'أرجو إرسال', 'يرجى ارسال', 'يرجى إرسال', 'الرجاء ارسال', 'تزويدي', 'تزويدنا', 'نرجو تزويدنا', 'مستند', 'وثيقه', 'تقرير', 'ملف', 'نموذج', 'شهاده', 'كتاب', 'خطاب', 'توقيع', 'موافقه', 'اعتماد', 'نسخه من', 'بحاجه الى', 'بحاجة إلى', 'نحتاج', 'احتاج', 'أحتاج', 'طلب'],
    followup: ['reminder', 'follow up', 'follow-up', 'following up', 'any update', 'still waiting', 'checking in', 'have not heard', 'haven\'t heard', 'have not received', 'haven\'t received', 'second request', 'circling back',
      'تذكير', 'للتذكير', 'متابعه', 'للمتابعه', 'اي جديد', 'أي جديد', 'هل هناك جديد', 'ما زلت بانتظار', 'مازلت بانتظار', 'لم اتلق', 'لم أتلق', 'لم نتلق', 'استفسر عن', 'أستفسر عن', 'مستجدات'],
    thanks: ['thank you', 'thanks', 'many thanks', 'appreciate', 'appreciated', 'grateful', 'gratitude', 'well done', 'congratulations', 'congrats',
      'شكرا', 'شكراً', 'اشكرك', 'أشكرك', 'اشكركم', 'أشكركم', 'ممتن', 'ممتنه', 'جزاك الله', 'جزاكم الله', 'بارك الله', 'مبارك', 'تهانينا', 'الف مبروك', 'ألف مبروك', 'تقديري', 'امتناني'],
    question: ['?', '؟', 'question', 'wondering', 'could you tell', 'could you clarify', 'clarification', 'clarify', 'how do', 'how can', 'what is', 'when is', 'where is', 'is it possible', 'would it be possible',
      'استفسار', 'سؤال', 'اسال', 'أسأل', 'اود ان اعرف', 'أود أن أعرف', 'هل', 'كيف', 'متى', 'اين', 'أين', 'ما هو', 'ما هي', 'توضيح', 'الاستفسار']
  };

  function detectIntent(email) {
    const subj = normalizeArabic((email.subject || '').toLowerCase());
    const body = normalizeArabic((email.textBody || '').slice(0, 5000).toLowerCase());
    const addr = (email.from && email.from.address || '').toLowerCase();
    const scores = {};
    for (const intent in INTENTS) {
      let s = 0;
      for (const k of INTENTS[intent]) {
        const kk = normalizeArabic(k);
        if (kk === '?' || kk === '؟') { const n = (body.match(/[?؟]/g) || []).length; s += Math.min(3, n) * 0.8; continue; }
        const re = new RegExp('(^|[^\\p{L}])' + escapeRe(kk) + '(?=$|[^\\p{L}])', 'iu');
        if (re.test(subj)) s += 2.2;
        if (re.test(body)) s += 1;
      }
      scores[intent] = s;
    }
    if (/(student|std|stu\.|alumni)/.test(addr)) scores.student += 3;
    if (/(\bre|\bرد)\s*:/i.test(email.subject || '') && scores.followup > 0) scores.followup += 1;
    // thanks only wins if it dominates and the mail is short
    if (scores.thanks > 0 && (email.textBody || '').length > 600) scores.thanks *= 0.4;
    let best = 'general', bestScore = 1.4;
    const order = ['followup', 'issue', 'meeting', 'invitation', 'student', 'deadline', 'request', 'question', 'thanks'];
    for (const i of order) if (scores[i] > bestScore) { best = i; bestScore = scores[i]; }
    return { intent: best, scores };
  }

  /* ---------- smart reply templates ---------- */
  const R = {
    en: {
      greet: { formal: 'Dear {name},', friendly: 'Hi {name},', brief: 'Hi {name},' },
      close: { formal: 'Best regards,\n{myName}', friendly: 'Best,\n{myName}', brief: 'Thanks,\n{myName}' },
      youAsked: 'You asked:\n{qs}\n\n',
      answerHere: '[Write your answer here]',
      statusHere: '[current status]',
      pointHere: '[the point to clarify]',
      onDate: ' on {date}',
      intents: {
        meeting: [
          ['Confirm', 'Thank you for your message regarding "{subject}". I would be glad to meet, and the proposed time works for me. Please let me know if there is anything you would like me to prepare in advance.'],
          ['Propose another time', 'Thank you for reaching out about "{subject}". Unfortunately, the suggested time does not work for me. Would {alt} be convenient for you instead? I am also happy to consider any other time that suits your schedule.'],
          ['Decline politely', 'Thank you for the invitation to meet regarding "{subject}". Unfortunately, I will not be able to attend due to prior commitments. If it helps, I am happy to share my input by email or join a follow-up session at a later date.']
        ],
        request: [
          ['Send what was requested', 'Thank you for your email regarding "{subject}". Please find the requested material attached/below. Should you need anything further, do not hesitate to let me know.'],
          ['Need more time', 'Thank you for your email regarding "{subject}". I have received your request and will send you the required material by {date}. If you need it sooner, please let me know and I will do my best to accommodate.'],
          ['Cannot provide', 'Thank you for your email regarding "{subject}". Unfortunately, I am unable to provide the requested material at this time. I would suggest contacting the relevant department, which should be able to assist you further.']
        ],
        question: [
          ['Answer', 'Thank you for your question regarding "{subject}". {youAsked}Please find my answer below:\n\n{answerHere}\n\nI hope this clarifies the matter; feel free to reach out if you have any further questions.'],
          ['Ask for details', 'Thank you for your question regarding "{subject}". To make sure I give you an accurate answer, could you please provide a few more details, for example {pointHere}? Once I have this information, I will get back to you promptly.'],
          ['Redirect', 'Thank you for your question regarding "{subject}". This matter falls outside my area of responsibility; the best contact would be [name/department], who will be able to give you a definitive answer.']
        ],
        deadline: [
          ['Confirm delivery', 'Thank you for your email regarding "{subject}". I confirm that I will complete the requested work and deliver it by {date}. I will keep you updated on progress and let you know immediately should any issue arise.'],
          ['Request extension', 'Thank you for your email regarding "{subject}". Due to current commitments, I would kindly request a short extension until {ext}. This will allow me to deliver work of the expected quality. I appreciate your understanding.'],
          ['Already completed', 'Thank you for your email regarding "{subject}". I am pleased to let you know that the requested work has already been completed; please find it attached. Let me know if any adjustments are needed.']
        ],
        thanks: [
          ['You are welcome', 'You are most welcome. It was a pleasure to help with "{subject}", and I am glad it was useful. Please do not hesitate to reach out again should you need anything in the future.'],
          ['Warm reply', 'Thank you for your kind words; they are much appreciated. I look forward to continuing our collaboration, and I wish you every success.'],
          ['Short note', 'Thank you — I really appreciate it. Wishing you all the best.']
        ],
        invitation: [
          ['Accept', 'Thank you for the kind invitation to "{subject}". I am pleased to confirm my attendance{onDate}. Please let me know if you need any information from my side, such as a short biography or a presentation title.'],
          ['Tentative', 'Thank you for the invitation to "{subject}". I am very interested in taking part; however, I need to confirm my schedule first. I will get back to you with a definite answer by {date}.'],
          ['Decline', 'Thank you for the invitation to "{subject}". Unfortunately, I will be unable to attend due to a prior commitment. I wish you a successful event and hope to join a future edition.']
        ],
        issue: [
          ['Acknowledge & fix', 'Thank you for bringing this to my attention, and I apologize for the inconvenience regarding "{subject}". I am looking into the matter now and will update you as soon as it is resolved, no later than {date}.'],
          ['Ask for details', 'Thank you for reporting this issue regarding "{subject}". To help me resolve it quickly, could you please share more details (for example, when it occurred, any error messages, and the steps you followed)? I will follow up as soon as I have this information.'],
          ['Escalate', 'Thank you for your message regarding "{subject}". I have forwarded the matter to the responsible team so that it can be handled properly. They will contact you directly, and I will follow up to make sure it is resolved.']
        ],
        student: [
          ['Answer the student', 'Thank you for your email regarding "{subject}". {youAsked}{answerHere}\n\nPlease review the course material and the syllabus, and let me know if anything remains unclear.'],
          ['Invite to office hours', 'Thank you for your email regarding "{subject}". This is best discussed in person; please come during my office hours ({hours}), or suggest a time that suits you. Bring any relevant documents so we can resolve the matter quickly.'],
          ['Refer to regulations', 'Thank you for your email regarding "{subject}". Please note that this matter is governed by the university regulations and the course policy, which I must apply equally to all students. I recommend reviewing the relevant policy, and I am happy to explain it further during office hours.']
        ],
        followup: [
          ['Apologize & update', 'Thank you for following up, and my apologies for the delayed reply regarding "{subject}". Here is a brief update: {statusHere}. I will send you the final outcome by {date}.'],
          ['Status update', 'Thank you for checking in regarding "{subject}". The matter is currently in progress: {statusHere}. I expect to have it finalized by {date} and will inform you as soon as it is done.'],
          ['Promise a date', 'Thank you for your reminder regarding "{subject}". I have not forgotten; I will send you a complete reply by {date}. I appreciate your patience.']
        ],
        general: [
          ['Acknowledge', 'Thank you for your email regarding "{subject}". I have received it and noted its contents.\n\n{answerHere}\n\nPlease let me know if you need anything further.'],
          ['Ask for clarification', 'Thank you for your email regarding "{subject}". Could you please clarify {pointHere}, so that I can respond appropriately? I will get back to you as soon as I receive your reply.'],
          ['Will get back', 'Thank you for your email regarding "{subject}". I am currently reviewing the matter and will get back to you with a full response by {date}.']
        ]
      }
    },
    ar: {
      greet: { formal: 'السلام عليكم ورحمة الله وبركاته،\n\nحضرة {name} المحترم،\n\nتحية طيبة وبعد،', friendly: 'مرحباً {name}،', brief: 'مرحباً {name}،' },
      close: { formal: 'وتفضلوا بقبول فائق الاحترام والتقدير،\n{myName}', friendly: 'مع أطيب التحيات،\n{myName}', brief: 'شكراً،\n{myName}' },
      youAsked: 'لقد سألتم عن:\n{qs}\n\n',
      answerHere: '[اكتب إجابتك هنا]',
      statusHere: '[الحالة الحالية]',
      pointHere: '[النقطة المطلوب توضيحها]',
      onDate: ' يوم {date}',
      intents: {
        meeting: [
          ['تأكيد الموعد', 'شكراً لرسالتكم بخصوص "{subject}". يسعدني الاجتماع بكم، والموعد المقترح مناسب لي. وإذا كان هناك ما ترغبون في أن أُعدّه مسبقاً فأرجو إعلامي.'],
          ['اقتراح موعد آخر', 'شكراً لتواصلكم بخصوص "{subject}". للأسف، الموعد المقترح لا يناسبني. هل يناسبكم {alt} بدلاً منه؟ ويسعدني كذلك النظر في أي موعد آخر يناسب جدولكم.'],
          ['اعتذار بلباقة', 'شكراً لدعوتكم للاجتماع بخصوص "{subject}". للأسف، لن أتمكن من الحضور بسبب ارتباطات سابقة. وإن كان ذلك مفيداً، يسعدني تقديم ملاحظاتي عبر البريد الإلكتروني أو الانضمام إلى جلسة لاحقة.']
        ],
        request: [
          ['إرسال المطلوب', 'شكراً لرسالتكم بخصوص "{subject}". تجدون المطلوب مرفقاً/أدناه. وإذا احتجتم إلى أي شيء آخر فلا تترددوا في إعلامي.'],
          ['طلب مهلة', 'شكراً لرسالتكم بخصوص "{subject}". استلمت طلبكم وسأزوّدكم بالمطلوب بحلول {date}. وإذا كنتم بحاجة إليه في وقت أقرب فأرجو إعلامي وسأبذل جهدي لتلبية ذلك.'],
          ['اعتذار عن التزويد', 'شكراً لرسالتكم بخصوص "{subject}". للأسف، لا يمكنني تزويدكم بالمطلوب في الوقت الحالي. وأقترح التواصل مع الجهة المختصة، إذ يمكنها مساعدتكم في هذا الشأن.']
        ],
        question: [
          ['الإجابة', 'شكراً لاستفساركم بخصوص "{subject}". {youAsked}وفيما يلي إجابتي:\n\n{answerHere}\n\nآمل أن يكون ذلك واضحاً، ولا تترددوا في التواصل معي لأي استفسار آخر.'],
          ['طلب تفاصيل', 'شكراً لاستفساركم بخصوص "{subject}". ولأتمكن من إعطائكم إجابة دقيقة، هل يمكنكم تزويدي بمزيد من التفاصيل، مثل {pointHere}؟ وبمجرد وصول هذه المعلومات سأرد عليكم في أقرب وقت.'],
          ['تحويل للجهة المختصة', 'شكراً لاستفساركم بخصوص "{subject}". هذا الموضوع خارج نطاق مسؤوليتي، والجهة الأنسب للإجابة هي [الاسم/القسم]، ويمكنها إعطاؤكم إجابة نهائية.']
        ],
        deadline: [
          ['تأكيد التسليم', 'شكراً لرسالتكم بخصوص "{subject}". أؤكد لكم أنني سأنجز المطلوب وأسلّمه بحلول {date}، وسأبقيكم على اطلاع بسير العمل، وسأعلمكم فوراً إن طرأ أي أمر.'],
          ['طلب تمديد', 'شكراً لرسالتكم بخصوص "{subject}". نظراً لارتباطاتي الحالية، أرجو التكرم بمنحي تمديداً قصيراً حتى {ext}، لأتمكن من إنجاز العمل بالجودة المطلوبة. وأقدّر تفهمكم.'],
          ['تم الإنجاز', 'شكراً لرسالتكم بخصوص "{subject}". يسرّني إعلامكم بأن المطلوب قد أُنجز فعلاً، وتجدونه مرفقاً. وأرجو إعلامي إن كانت هناك حاجة إلى أي تعديل.']
        ],
        thanks: [
          ['العفو', 'العفو، لا شكر على واجب. سعدت بالمساعدة في "{subject}"، ويسرّني أن ذلك كان مفيداً. ولا تترددوا في التواصل معي مرة أخرى متى احتجتم إلى أي شيء.'],
          ['رد ودّي', 'أشكركم على كلماتكم اللطيفة، وأقدّرها كثيراً. وأتطلع إلى استمرار تعاوننا، مع تمنياتي لكم بدوام التوفيق.'],
          ['رد مختصر', 'شكراً جزيلاً، وأقدّر ذلك كثيراً. مع أطيب التمنيات.']
        ],
        invitation: [
          ['قبول الدعوة', 'شكراً على الدعوة الكريمة لحضور "{subject}". يسرّني تأكيد حضوري{onDate}. وأرجو إعلامي إن كنتم بحاجة إلى أي معلومات من جهتي، مثل نبذة تعريفية أو عنوان العرض.'],
          ['رد مبدئي', 'شكراً على الدعوة لحضور "{subject}". يهمّني كثيراً المشاركة، غير أنني بحاجة إلى التأكد من جدولي أولاً، وسأوافيكم بردّ نهائي بحلول {date}.'],
          ['اعتذار', 'شكراً على الدعوة لحضور "{subject}". للأسف، لن أتمكن من الحضور بسبب ارتباط سابق. أتمنى لكم فعالية ناجحة، وآمل أن أشارك في نسخة قادمة.']
        ],
        issue: [
          ['اعتذار ومعالجة', 'شكراً لإعلامي بهذا الأمر، وأعتذر عن الإزعاج بخصوص "{subject}". أعمل على معالجته الآن، وسأوافيكم بالمستجدات فور حلّه، وفي موعد لا يتجاوز {date}.'],
          ['طلب تفاصيل', 'شكراً لإبلاغي بهذه المشكلة بخصوص "{subject}". ولمساعدتي على حلّها بسرعة، هل يمكنكم تزويدي بمزيد من التفاصيل (مثل وقت حدوثها، وأي رسائل خطأ ظهرت، والخطوات التي اتبعتموها)؟ وسأتابع معكم فور وصول هذه المعلومات.'],
          ['تحويل للجهة المسؤولة', 'شكراً لرسالتكم بخصوص "{subject}". لقد أحلتُ الموضوع إلى الجهة المسؤولة لمعالجته بالشكل المناسب، وستتواصل معكم مباشرة، وسأتابع من جهتي للتأكد من حلّه.']
        ],
        student: [
          ['إجابة الطالب', 'شكراً لرسالتك بخصوص "{subject}". {youAsked}{answerHere}\n\nأرجو مراجعة مادة المساق والخطة الدراسية، وإعلامي إن بقي أي أمر غير واضح.'],
          ['دعوة للساعات المكتبية', 'شكراً لرسالتك بخصوص "{subject}". من الأفضل مناقشة هذا الأمر شخصياً؛ أرجو الحضور خلال ساعاتي المكتبية ({hours})، أو اقتراح وقت يناسبك. ويرجى إحضار أي مستندات ذات صلة لنتمكن من حسم الموضوع بسرعة.'],
          ['الإحالة إلى التعليمات', 'شكراً لرسالتك بخصوص "{subject}". أودّ الإشارة إلى أن هذا الأمر تحكمه تعليمات الجامعة وسياسة المساق، والتي يجب تطبيقها بالتساوي على جميع الطلبة. وأنصح بمراجعة التعليمات ذات الصلة، ويسرّني توضيحها أكثر خلال الساعات المكتبية.']
        ],
        followup: [
          ['اعتذار وتحديث', 'شكراً لمتابعتكم، وأعتذر عن التأخر في الرد بخصوص "{subject}". وفيما يلي تحديث موجز: {statusHere}. وسأوافيكم بالنتيجة النهائية بحلول {date}.'],
          ['تحديث الحالة', 'شكراً لاستفساركم عن مستجدات "{subject}". العمل جارٍ حالياً: {statusHere}. وأتوقع الانتهاء منه بحلول {date}، وسأعلمكم فور إتمامه.'],
          ['وعد بموعد للرد', 'شكراً لتذكيركم بخصوص "{subject}". الموضوع قيد المتابعة، وسأرسل لكم رداً كاملاً بحلول {date}. وأقدّر صبركم.']
        ],
        general: [
          ['تأكيد الاستلام', 'شكراً لرسالتكم بخصوص "{subject}". استلمتها واطّلعت على محتواها.\n\n{answerHere}\n\nوأرجو إعلامي إن كنتم بحاجة إلى أي شيء آخر.'],
          ['طلب توضيح', 'شكراً لرسالتكم بخصوص "{subject}". هل يمكنكم توضيح {pointHere} لأتمكن من الرد بشكل مناسب؟ وسأعاود التواصل معكم فور استلام ردكم.'],
          ['سأعاود التواصل', 'شكراً لرسالتكم بخصوص "{subject}". أقوم حالياً بمراجعة الموضوع، وسأوافيكم برد كامل بحلول {date}.']
        ]
      }
    }
  };

  function fmtDate(d, lang, withTime) {
    try {
      const opts = { weekday: 'long', day: 'numeric', month: 'long' };
      if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
      return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', opts).format(d);
    } catch (e) { return d.toLocaleString(); }
  }
  function nextWorkingDay(from) {
    let d = addDays(from, 1);
    while (d.getDay() === 5 || d.getDay() === 6) d = addDays(d, 1); // Fri/Sat weekend
    return atHour(d, 11);
  }

  function smartReplies(email, opts) {
    opts = opts || {};
    const lang = opts.lang || detectLang((email.subject || '') + ' ' + (email.textBody || ''));
    const tone = opts.tone || 'formal';
    const L = R[lang] || R.en;
    const det = detectIntent(email);
    const intent = opts.intent || det.intent;
    const name = nameFor(email, lang);
    const myName = opts.myName || '';
    const subject = (email.subject || '').replace(/^\s*(re|fw|fwd|رد|إعادة توجيه)\s*:\s*/i, '').trim() || (lang === 'ar' ? 'رسالتكم' : 'your message');
    const due = opts.due ? new Date(opts.due) : suggestDue(3, [], opts.settings);
    const points = extractPoints(email).filter(p => p.kind === 'question').slice(0, 4);
    const qs = points.map(p => '• ' + p.text).join('\n');
    const dates = extractDates(email.textBody || '', email.date || Date.now());
    const vars = {
      name, myName, subject,
      date: fmtDate(due, lang, false),
      ext: fmtDate(addDays(due, 3), lang, false),
      alt: fmtDate(nextWorkingDay(new Date()), lang, true),
      hours: opts.officeHours || (lang === 'ar' ? 'الأحد–الخميس، 11:00–13:00' : 'Sunday–Thursday, 11:00–13:00'),
      youAsked: qs ? L.youAsked.replace('{qs}', qs) : '',
      answerHere: L.answerHere, statusHere: L.statusHere, pointHere: L.pointHere,
      onDate: dates.length ? L.onDate.replace('{date}', fmtDate(dates[0].date, lang, false)) : ''
    };
    const fill = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    const list = (L.intents[intent] || L.intents.general).map(([title, body]) => {
      let text = fill(body);
      if (tone === 'brief') {
        text = text.split(/(?<=[.!؟?])\s+/).slice(0, 2).join(' ');
      }
      const greet = fill(L.greet[tone] || L.greet.formal);
      const close = fill(L.close[tone] || L.close.formal);
      return { title, body: `${greet}\n\n${text}\n\n${close}`.replace(/\n{3,}/g, '\n\n').trim() };
    });
    return { intent, lang, tone, replies: list, points: extractPoints(email), dates };
  }

  /* ---------- quick templates ---------- */
  const TEMPLATES = [
    { id: 'ack', en: { title: 'Acknowledge receipt', body: 'Dear {name},\n\nThank you for your email. I have received it and will get back to you by {date}.\n\nBest regards,\n{myName}' }, ar: { title: 'تأكيد الاستلام', body: 'حضرة {name} المحترم،\n\nشكراً لرسالتكم. استلمتها وسأوافيكم بالرد بحلول {date}.\n\nمع فائق الاحترام،\n{myName}' } },
    { id: 'thanks', en: { title: 'Thank you', body: 'Dear {name},\n\nThank you very much for your message and for your support. It is much appreciated.\n\nBest regards,\n{myName}' }, ar: { title: 'شكر وتقدير', body: 'حضرة {name} المحترم،\n\nأشكركم جزيل الشكر على رسالتكم وعلى دعمكم، وأقدّر ذلك كثيراً.\n\nمع فائق الاحترام،\n{myName}' } },
    { id: 'extension', en: { title: 'Request more time', body: 'Dear {name},\n\nThank you for your email. Due to current commitments, I kindly request a short extension until {ext}. I appreciate your understanding.\n\nBest regards,\n{myName}' }, ar: { title: 'طلب مهلة إضافية', body: 'حضرة {name} المحترم،\n\nشكراً لرسالتكم. نظراً لارتباطاتي الحالية، أرجو التكرم بمنحي مهلة قصيرة حتى {ext}. وأقدّر تفهمكم.\n\nمع فائق الاحترام،\n{myName}' } },
    { id: 'decline', en: { title: 'Polite decline', body: 'Dear {name},\n\nThank you for your message. Unfortunately, I am unable to take this on at the moment due to prior commitments. I wish you every success.\n\nBest regards,\n{myName}' }, ar: { title: 'اعتذار بلباقة', body: 'حضرة {name} المحترم،\n\nشكراً لرسالتكم. للأسف، لا يمكنني تلبية هذا الطلب في الوقت الحالي بسبب ارتباطات سابقة. مع تمنياتي لكم بالتوفيق.\n\nمع فائق الاحترام،\n{myName}' } },
    { id: 'meeting', en: { title: 'Confirm a meeting', body: 'Dear {name},\n\nThank you. I confirm our meeting on {alt}. Please let me know if anything changes.\n\nBest regards,\n{myName}' }, ar: { title: 'تأكيد اجتماع', body: 'حضرة {name} المحترم،\n\nشكراً لكم. أؤكد موعد اجتماعنا {alt}. وأرجو إعلامي إن طرأ أي تغيير.\n\nمع فائق الاحترام،\n{myName}' } },
    { id: 'forward', en: { title: 'Forwarded to a colleague', body: 'Dear {name},\n\nThank you for your email. I have forwarded your request to the responsible colleague, who will contact you directly.\n\nBest regards,\n{myName}' }, ar: { title: 'تحويل إلى زميل', body: 'حضرة {name} المحترم،\n\nشكراً لرسالتكم. لقد حوّلت طلبكم إلى الزميل المختص، وسيتواصل معكم مباشرة.\n\nمع فائق الاحترام،\n{myName}' } },
    { id: 'ooo', en: { title: 'Out of office', body: 'Dear {name},\n\nThank you for your email. I am currently out of the office with limited access to email, and will respond upon my return on {date}. For urgent matters, please contact [colleague].\n\nBest regards,\n{myName}' }, ar: { title: 'خارج المكتب', body: 'حضرة {name} المحترم،\n\nشكراً لرسالتكم. أنا حالياً خارج المكتب مع إمكانية محدودة للوصول إلى البريد، وسأرد عليكم عند عودتي بتاريخ {date}. وللأمور العاجلة يرجى التواصل مع [الزميل].\n\nمع فائق الاحترام،\n{myName}' } }
  ];

  function fillTemplate(body, email, lang, opts) {
    opts = opts || {};
    const name = nameFor(email, lang);
    const due = opts.due ? new Date(opts.due) : suggestDue(3, [], opts.settings);
    const vars = { name, myName: opts.myName || '', date: fmtDate(due, lang, false), ext: fmtDate(addDays(due, 3), lang, false), alt: fmtDate(nextWorkingDay(new Date()), lang, true), subject: email.subject || '' };
    return body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  }

  /* ---------- AI providers (bring your own key) ---------- */
  const AI_DEFAULTS = {
    anthropic: { model: 'claude-sonnet-4-5', label: 'Anthropic Claude' },
    openai: { model: 'gpt-4o-mini', label: 'OpenAI' },
    gemini: { model: 'gemini-2.5-flash', label: 'Google Gemini' },
    custom: { model: '', label: 'OpenAI-compatible (custom URL)' }
  };

  async function aiComplete(cfg, system, user, maxTokens) {
    const provider = cfg.provider || 'anthropic';
    const model = cfg.model || AI_DEFAULTS[provider].model;
    const key = (cfg.apiKey || '').trim();
    if (!key && provider !== 'custom') throw new Error('NO_KEY');
    maxTokens = maxTokens || 1500;
    let res, text;
    if (provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
      });
      const j = await res.json();
      if (!res.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + res.status));
      text = (j.content || []).map(c => c.text || '').join('');
    } else if (provider === 'gemini') {
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } })
      });
      const j = await res.json();
      if (!res.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + res.status));
      text = ((j.candidates || [])[0] || {}).content; text = text && text.parts ? text.parts.map(p => p.text || '').join('') : '';
    } else {
      const base = provider === 'custom' ? (cfg.baseUrl || '').replace(/\/+$/, '') : 'https://api.openai.com/v1';
      if (!base) throw new Error('NO_URL');
      const headers = { 'content-type': 'application/json' };
      if (key) headers['authorization'] = 'Bearer ' + key;
      res = await fetch(base + '/chat/completions', {
        method: 'POST', headers,
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.7, max_tokens: maxTokens })
      });
      const j = await res.json();
      if (!res.ok) throw new Error((j.error && (j.error.message || j.error)) || ('HTTP ' + res.status));
      text = (((j.choices || [])[0] || {}).message || {}).content || '';
    }
    return (text || '').trim();
  }

  function emailContext(email) {
    const body = (email.textBody || '').slice(0, 7000);
    return `From: ${email.from ? (email.from.name + ' <' + email.from.address + '>') : ''}\nSubject: ${email.subject || ''}\nDate: ${email.date || ''}\n\n${body}`;
  }

  async function aiReplies(cfg, email, opts) {
    const lang = opts.lang === 'ar' ? 'Arabic' : 'English';
    const tone = opts.tone || 'formal';
    const system = `You draft professional email replies on behalf of ${opts.myName || 'the user'}${opts.role ? ' (' + opts.role + ')' : ''}. Write in ${lang}. Tone: ${tone}. Be concise, specific to the email, culturally appropriate, and never invent facts — leave [placeholders] for details only the user knows. Each reply must be complete: greeting, body, and sign-off with the user's name. Output ONLY a JSON array of exactly 3 objects with keys "title" (a 2–4 word label in ${lang}) and "body" (the reply text). No markdown, no commentary.`;
    const user = `Draft 3 alternative replies (e.g. accept/confirm, ask for details or more time, polite decline — choose what fits) to this email.${opts.instructions ? '\nExtra instructions from the user: ' + opts.instructions : ''}\n\n=== EMAIL ===\n${emailContext(email)}`;
    const text = await aiComplete(cfg, system, user, 2000);
    let arr = null;
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    if (s !== -1 && e > s) { try { arr = JSON.parse(text.slice(s, e + 1)); } catch (err) { arr = null; } }
    if (!Array.isArray(arr)) {
      arr = text.split(/\n-{3,}\n|\n#{1,3} /).filter(x => x.trim()).slice(0, 3).map((b, i) => ({ title: 'Reply ' + (i + 1), body: b.trim() }));
    }
    return arr.filter(x => x && x.body).map(x => ({ title: String(x.title || '').slice(0, 60), body: String(x.body) }));
  }

  async function aiRefine(cfg, draft, action, email, opts) {
    const lang = opts.lang === 'ar' ? 'Arabic' : 'English';
    const actions = {
      improve: 'Improve the wording, flow and professionalism of this draft while keeping its meaning and language. Return only the improved draft.',
      shorter: 'Make this draft significantly shorter while keeping its key points and courtesy. Return only the shortened draft.',
      formal: 'Rewrite this draft in a more formal, polished tone. Return only the rewritten draft.',
      friendly: 'Rewrite this draft in a warmer, friendlier (but still professional) tone. Return only the rewritten draft.',
      grammar: 'Fix spelling, grammar and punctuation only; do not change the meaning. Return only the corrected draft.',
      translate_ar: 'Translate this draft into natural, professional Arabic. Return only the translation.',
      translate_en: 'Translate this draft into natural, professional English. Return only the translation.',
      answer: `Using the original email below, complete the draft: replace any [placeholders] with sensible text where possible and make sure every question or request in the email is addressed. Keep the language ${lang}. Return only the completed draft.`
    };
    const system = 'You are a careful writing assistant for professional emails. Return only the requested email text, with no commentary and no markdown.';
    const user = `${actions[action] || actions.improve}\n\n=== DRAFT ===\n${draft}\n\n=== ORIGINAL EMAIL (for context) ===\n${emailContext(email)}`;
    return aiComplete(cfg, system, user, 1500);
  }

  global.Engine = { detectLang, firstName, nameFor, scoreEmail, suggestDue, extractDates, extractPoints, detectIntent, smartReplies, TEMPLATES, fillTemplate, AI_DEFAULTS, aiReplies, aiRefine, aiComplete, normalizeDigits, fmtDate };
})(window);
