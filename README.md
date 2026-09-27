# Email Management — إدارة الرسائل البريدية

A privacy-first web app (PWA) for the Microsoft Store: drag emails in, get them prioritized automatically, set a reply deadline with a live countdown, and draft replies with smart (offline) suggestions or your own AI key.

تطبيق ويب (PWA) لمتجر مايكروسوفت: اسحب رسائلك إليه، فيرتّب أولويتها تلقائياً، ويحدّد موعداً للرد مع عدّاد تنازلي، ويجهّز لك ردوداً ذكية (بدون إنترنت) أو عبر مفتاح الذكاء الاصطناعي الخاص بك.

---

## النشر على GitHub Pages ثم متجر مايكروسوفت

1. أنشئ مستودعاً عاماً على GitHub باسم `email-management` (أو أي اسم) وارفع **جميع** ملفات هذا المجلد كما هي (index.html في الجذر).
2. Settings ▸ Pages ▸ Source: **Deploy from a branch** ▸ Branch: `main` / `(root)` ▸ Save.
3. افتح الرابط `https://<username>.github.io/email-management/` وتأكد أن التطبيق يعمل (الأحرف الكبيرة/الصغيرة في اسم المستودع مهمة).
4. اذهب إلى **pwabuilder.com**، الصق الرابط، ثم **Package for stores ▸ Windows**، وأدخل بيانات التطبيق من Partner Center (Package ID / Publisher ID / Publisher display name).
5. ارفع ملف `.msixbundle` الناتج في Partner Center مع لقطات الشاشة والوصف.

كل تحديث لاحق = رفع الملفات المعدّلة إلى GitHub فقط؛ التطبيق المثبّت من المتجر يحدّث نفسه تلقائياً.

## كيف يستورد التطبيق الرسائل؟

| المصدر | الطريقة |
|---|---|
| Outlook (سطح المكتب) | اسحب الرسالة مباشرة إلى نافذة التطبيق (تصل كملف ‎.msg). إن لم يعمل السحب في نسختك: احفظ الرسالة (File ▸ Save As ▸ .msg) ثم اسحب الملف. |
| Outlook الجديد / Outlook على الويب | اسحب الرسالة إلى سطح المكتب (تتحول إلى ‎.eml) ثم أفلتها في التطبيق. |
| Gmail | افتح الرسالة ▸ ⋮ ▸ **Download message** ثم اسحب ملف ‎.eml. أو انسخ النص واستخدم **لصق رسالة**. |
| أي ملف | زر **استيراد رسائل** يقبل ‎.eml و ‎.msg (عدة ملفات دفعة واحدة). |

## الميزات

- ترتيب الأولوية تلقائياً (حرجة / عالية / عادية / منخفضة) مع شرح السبب، وإمكانية التعديل اليدوي.
- موعد للرد مقترح تلقائياً حسب الأولوية والتواريخ المذكورة في الرسالة، مع عدّاد تنازلي يتغير لونه، وتنبيهات سطح المكتب قبل الموعد وعند التأخر.
- عرض كامل للرسالة (HTML والصور المضمّنة والمرفقات) داخل إطار معزول وآمن، مع حجب الصور الخارجية افتراضياً.
- **ردود ذكية محلية**: يتعرّف التطبيق على نوع الرسالة (اجتماع، طلب مستند، استفسار، مهمة بموعد، شكر، دعوة، مشكلة، استفسار طالب، متابعة) ويقترح 3 ردود بأسلوب رسمي/ودّي/مختصر بالعربية أو الإنجليزية، بالإضافة إلى قائمة «نقاط يجب الرد عليها».
- **ردود بالذكاء الاصطناعي** (اختياري): مفتاح API خاص بك (Anthropic Claude / OpenAI / Google Gemini / أي خدمة متوافقة مع OpenAI)، لتوليد 3 ردود وتحسين المسودة (اختصار، أكثر رسمية، تصحيح لغوي، ترجمة، إكمال الإجابات).
- قوالب جاهزة وقوالب خاصة بك، فتح الرد في تطبيق البريد بنقرة (mailto)، نسخ، حفظ مسودة، تعليم كـ«تم الرد» أو «بانتظار ردهم» مع تذكير بالمتابعة.
- لوحة Kanban بالسحب والإفلات، إحصائيات، وسوم، بحث، تأجيل (Snooze)، مرسلون مهمون (VIP)، اختصارات لوحة المفاتيح.
- عربي/إنجليزي بالكامل (RTL)، مظهر فاتح/داكن، يعمل دون اتصال، وكل البيانات على جهاز المستخدم فقط.
- نسخ احتياطي إلى مجلد يختاره المستخدم (تلقائي أو يدوي) + تصدير/استيراد JSON.

## Structure

```
index.html        app shell
css/styles.css    design system (light/dark, RTL)
js/i18n.js        Arabic / English strings
js/db.js          IndexedDB storage (emails, attachments)
js/mime.js        .eml (MIME) parser
js/msg.js         Outlook .msg parser (OLE/CFB, compressed RTF, RTF→HTML)
js/engine.js      priority scoring, date extraction, smart replies, AI providers
js/samples.js     demo emails
js/app.js         core UI (inbox, detail, popovers, notifications, import)
js/reply.js       reply tab (points, smart/AI replies, composer)
js/extras.js      board, statistics, settings, backup
manifest.json     PWA manifest (file handler for .eml/.msg)
sw.js             service worker (offline)
icons/            app icons
```
