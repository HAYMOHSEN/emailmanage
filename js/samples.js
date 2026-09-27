/* ============================================================
   samples.js — demo emails (used by "Try sample emails")
   ============================================================ */
(function (global) {
  'use strict';
  const enc = new TextEncoder();
  function daysAgo(d, h) { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(h || 9, 12, 0, 0); return x.toISOString(); }
  function inDays(d) { const x = new Date(); x.setDate(x.getDate() + d); return x; }
  function fmt(d, lang) { return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(d); }

  function makePng() {
    try {
      const c = document.createElement('canvas'); c.width = 320; c.height = 90;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 320, 90); grad.addColorStop(0, '#2f5bea'); grad.addColorStop(1, '#7b3fe4');
      g.fillStyle = grad; g.fillRect(0, 0, 320, 90);
      g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.fillText('Green Hydrogen Summit', 16, 40);
      g.font = '14px sans-serif'; g.fillText('Amman • 2026', 16, 66);
      const b64 = c.toDataURL('image/png').split(',')[1];
      const bin = atob(b64); const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }

  global.SAMPLES = function () {
    const png = makePng();
    const list = [
      {
        subject: 'URGENT: Accreditation self-study report — final input needed within 3 days',
        from: { name: 'Dean\'s Office – School of Applied Technical Sciences', address: 'dean.sats@university.edu' },
        to: [{ name: 'Faculty', address: 'faculty-me@university.edu' }], cc: [], date: daysAgo(0, 8),
        textBody: `Dear colleagues,

As discussed in the council meeting, the ABET self-study report must be submitted to the accreditation office by ${fmt(inDays(3), 'en')}.

Please send me the following as soon as possible:
1. Updated course files for your Fall courses (syllabus, sample exams, assessment rubrics).
2. The mapping of course learning outcomes to student outcomes.
3. Any evidence of continuous improvement actions taken since the last cycle.

Could you also confirm whether you will attend the mock visit on Sunday?

This is time-sensitive — the office cannot extend the deadline.

Best regards,
Dean's Office`,
        htmlBody: null, attachments: [], flags: { importance: 'high', automated: false }, source: 'sample'
      },
      {
        subject: 'استفسار عن علامة الامتحان النصفي – مساق المشغلات ME0354',
        from: { name: 'محمد خالد العمري', address: 'm.alomari@std.university.edu' },
        to: [{ name: 'Prof. Hani', address: 'me@university.edu' }], cc: [], date: daysAgo(1, 14),
        textBody: `السلام عليكم ورحمة الله وبركاته،

الأستاذ الدكتور،

أرجو التكرم بإعلامي بعلامتي في الامتحان النصفي لمساق المشغلات، إذ لم تظهر لي في النظام حتى الآن رغم ظهورها لبقية الزملاء.

كما أود الاستفسار: هل يمكنني مراجعة ورقة الامتحان خلال الساعات المكتبية؟ ومتى يكون الوقت المناسب لذلك؟

وشكراً جزيلاً لكم.

الطالب محمد العمري
الرقم الجامعي 20231234`,
        htmlBody: null, attachments: [], flags: { importance: 'normal', automated: false }, source: 'sample'
      },
      {
        subject: 'Invitation: Keynote speaker – Green Hydrogen & Power-to-X Summit 2026',
        from: { name: 'Lina Haddad', address: 'lina.haddad@h2summit.org' },
        to: [{ name: 'Prof. Hani', address: 'me@university.edu' }], cc: [], date: daysAgo(2, 11),
        textBody: `Dear Professor,

On behalf of the organizing committee, it is my pleasure to invite you to deliver a keynote at the Green Hydrogen & Power-to-X Summit, which will take place in Amman on ${fmt(inDays(40), 'en')}.

Your work on real-time simulation of microgrids and electrolyser integration would be of great interest to our audience of policymakers, utilities and researchers.

Could you kindly confirm your availability by ${fmt(inDays(10), 'en')}? We would be grateful if you could also share a short biography and a provisional talk title.

Warm regards,
Lina Haddad
Programme Director`,
        htmlBody: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1b1f2a;line-height:1.6"><img src="cid:banner@h2summit" alt="Green Hydrogen Summit" style="max-width:320px;border-radius:8px"><p>Dear Professor,</p><p>On behalf of the organizing committee, it is my pleasure to invite you to deliver a <strong>keynote</strong> at the Green Hydrogen &amp; Power-to-X Summit, which will take place in Amman on <strong>${fmt(inDays(40), 'en')}</strong>.</p><p>Your work on real-time simulation of microgrids and electrolyser integration would be of great interest to our audience of policymakers, utilities and researchers.</p><p>Could you kindly confirm your availability by <strong>${fmt(inDays(10), 'en')}</strong>? We would be grateful if you could also share a short biography and a provisional talk title.</p><p>Warm regards,<br>Lina Haddad<br><span style="color:#6b7280">Programme Director</span></p></div>`,
        attachments: png ? [{ name: 'banner.png', type: 'image/png', size: png.length, cid: 'banner@h2summit', inline: true, bytes: png }] : [],
        flags: { importance: 'normal', automated: false }, source: 'sample'
      },
      {
        subject: 'طلب اجتماع لمناقشة مشروع الشبكة الذكية المشترك',
        from: { name: 'د. سامر الخطيب', address: 's.khatib@university.edu' },
        to: [{ name: 'Prof. Hani', address: 'me@university.edu' }], cc: [{ name: 'Research Office', address: 'research@university.edu' }], date: daysAgo(1, 10),
        textBody: `الزميل العزيز،

تحية طيبة وبعد،

بخصوص مقترح مشروع الشبكة الذكية المشترك مع الشركة الوطنية للكهرباء، أقترح أن نعقد اجتماعاً قصيراً يوم ${fmt(inDays(2), 'ar')} الساعة 11:00 في مكتبي لمناقشة توزيع المهام والميزانية قبل إرسال المقترح.

هل يناسبك هذا الموعد؟ وإن لم يكن مناسباً فأرجو اقتراح موعد آخر خلال هذا الأسبوع.

مع خالص التقدير،
سامر`,
        htmlBody: null, attachments: [], flags: { importance: 'normal', automated: false }, source: 'sample'
      },
      {
        subject: 'Gentle reminder: review of manuscript #4521 (IEEE Trans. Smart Grid)',
        from: { name: 'IEEE Editorial Office', address: 'editor-tsg@ieee.org' },
        to: [{ name: 'Prof. Hani', address: 'me@university.edu' }], cc: [], date: daysAgo(4, 16),
        textBody: `Dear Reviewer,

This is a gentle reminder that your review of manuscript #4521, "Digital-twin-based protection coordination for islanded microgrids", is now 5 days overdue.

We have not yet received your report. Could you please submit it within the next 3 days, or let us know if you are unable to complete the review so that we can assign another reviewer?

Thank you for your continued support of the journal.

Kind regards,
Editorial Office`,
        htmlBody: null, attachments: [], flags: { importance: 'normal', automated: false }, source: 'sample'
      },
      {
        subject: 'تذكير: تسليم خطة المساق المحدثة قبل نهاية الأسبوع',
        from: { name: 'مكتب رئيس القسم', address: 'me.chair@university.edu' },
        to: [{ name: 'أعضاء الهيئة التدريسية', address: 'me-faculty@university.edu' }], cc: [], date: daysAgo(0, 12),
        textBody: `السادة أعضاء الهيئة التدريسية المحترمين،

للتذكير، يرجى تسليم خطة المساق المحدثة (Syllabus) لجميع المساقات التي تدرّسونها هذا الفصل قبل نهاية الأسبوع، وذلك وفق النموذج المرفق.

يرجى التأكد من تضمين مخرجات التعلم وأساليب التقييم وتوزيع العلامات.

مع الشكر والتقدير،
مكتب رئيس القسم`,
        htmlBody: null,
        attachments: [{ name: 'نموذج خطة المساق.txt', type: 'text/plain', size: 0, cid: '', inline: false, bytes: enc.encode('نموذج خطة المساق\n\n1. وصف المساق\n2. مخرجات التعلم\n3. أساليب التقييم وتوزيع العلامات\n4. المراجع\n') }],
        flags: { importance: 'normal', automated: false }, source: 'sample'
      },
      {
        subject: 'Thank you for the microgrid workshop!',
        from: { name: 'Rania Saleh', address: 'rania.saleh@energyco.jo' },
        to: [{ name: 'Prof. Hani', address: 'me@university.edu' }], cc: [], date: daysAgo(3, 9),
        textBody: `Dear Professor,

Thank you so much for the excellent workshop last week. Our engineers found the real-time simulation demo extremely useful, and several of them have already started applying the ideas to our pilot site.

We really appreciate the time and effort you put into it.

Best wishes,
Rania`,
        htmlBody: null, attachments: [], flags: { importance: 'normal', automated: false }, source: 'sample'
      },
      {
        subject: 'IEEE Power & Energy Society — Weekly Digest',
        from: { name: 'IEEE PES Newsletter', address: 'no-reply@newsletters.ieee.org' },
        to: [{ name: 'Prof. Hani', address: 'me@university.edu' }], cc: [], date: daysAgo(2, 6),
        textBody: `This week's highlights: new standards for DER interconnection, call for papers, and upcoming webinars.

View this email in your browser. To stop receiving these messages, click unsubscribe.`,
        htmlBody: null, attachments: [], flags: { importance: 'normal', automated: true }, source: 'sample'
      }
    ];
    list.forEach(e => e.attachments.forEach(a => { a.size = a.bytes ? a.bytes.length : 0; }));
    return list;
  };
})(window);
