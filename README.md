# VeloFind 🔍⚡

**Fast duplicate file finder for Windows — ابحث عن الملفات المكررة واحذفها بأمان**

VeloFind تطبيق سطح مكتب لـ Windows 10/11 يكتشف الملفات المتطابقة فعليًا (Exact Duplicates) عبر اختبارات متدرجة ذكية، ويعرضها في مجموعات واضحة مع إجراءات حذف آمنة وقابلة للتراجع — كل ذلك محليًا بالكامل على جهازك وبدون أي اعتماد على Everything أو `es.exe`.

---

## ✨ المزايا (الإصدار 0.2)

| الميزة | الوصف |
|---|---|
| 🎯 اكتشاف متدرج | الحجم → البصمة الجزئية (بداية+منتصف+نهاية) → البصمة الكاملة SHA-256 |
| ⚡ أداء بلا تجميد | الفحص وحساب البصمات داخل Worker Thread، قراءة متوازية محدودة |
| 💾 فهرسة دائمة | SQLite مع خطة بديلة JSON، وعدم إعادة فحص الملفات غير المتغيرة |
| ⏯️ إيقاف/استكمال | إيقاف مؤقت وإلغاء الفحص، واستكمال آخر فحص بفحص المتغير فقط |
| 🔒 أمان صارم | منع حذف كل نسخ المجموعة، حماية مجلدات النظام، إعادة تحقق من البصمة قبل الحذف |
| 🗑️ حذف آمن | سلة المحذوفات (افتراضي)، مجلد عزل مع تراجع، حذف نهائي بتأكيد صريح |
| 🔎 بحث متقدم | `invoice` · `*.jpg` · `ext:mp4` · `size:>100MB` · `path:C:\Users` · `duplicate` |
| 🎛️ تحديد تلقائي | الإبقاء على الأقدم/الأحدث/خارج التنزيلات، تحديد نسخ النسخ الاحتياطي فقط |
| 🌗 ثيم فاتح/داكن | واجهة عربية RTL كاملة بألوان هوية موحدة (#5B5FEF / #21C7A8) |
| 🧪 مُختبَر | 54 اختبار وحدة وتكامل (vitest) تغطي الخوارزمية والأمان والبحث والتخزين |

## 🚀 التشغيل

**المتطلبات:** Node.js 18+ (يُنصح 20+) و npm. للتشغيل الكامل: Windows 10/11 x64.

```bash
npm install        # يبني تلقائيًا وحدة better-sqlite3 لـ Electron (postinstall)
npm run dev        # تشغيل وضع التطوير
```

### أوامر الجودة

```bash
npm run typecheck  # فحص أنواع TypeScript (main + renderer)
npm run test       # تشغيل 54 اختبار
npm run build      # بناء الإنتاج إلى out/
```

> ملاحظة: يمكن التطوير على أي نظام، لكن FFI/USN Journal وسلة المحذوفات تعمل فعليًا على Windows فقط؛ بقية المنصات تستخدم الخطة البديلة `fs` تلقائيًا.

## 🤖 البناء عبر GitHub Actions — بلا تشغيل محلي

لا تحتاج لتشغيل Electron على جهازك إطلاقًا: ارفع المشروع إلى GitHub وسيبنيه الإجراءان التاليان تلقائيًا.

### الإجراءات المتوفرة (`.github/workflows/`)

| الملف | الاسم | متى يعمل | ماذا يفعل |
|---|---|---|---|
| `ci.yml` | CI — بوابة الجودة | كل push/PR على main | فحص الأنواع + 54 اختبارًا (سريع، على Linux) |
| `build-windows.yml` | Build Windows | كل push على main + يدويًا + الوسوم `v*` | بناء كامل على `windows-latest` وإنتاج المثبّت |

### خطوات الربط أول مرة

```bash
# داخل مجلد velofind (وهو جذر المستودع)
git init
git add .
git commit -m "VeloFind v0.2 — initial release"
git branch -M main
git remote add origin https://github.com/<اسم-حسابك>/velofind.git
git push -u origin main
```

### من أين أحمّل التطبيق بعد البناء؟

1. **Artifacts (لكل تشغيل):** تبويب **Actions** ← اختر أحدث تشغيل لـ *Build Windows* ← قسم **Artifacts** ← حمّل `VeloFind-Windows-x64` (يحوي المثبّت والنسخة المحمولة، ويُحفظ 30 يومًا).
2. **Releases (دائم):** أنشئ وسمًا وارفعه، وسيُنشر Release تلقائيًا بالملفات:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
   ثم تجدها في تبويب **Releases** في المستودع.

### مخرجات كل بناء

| الملف | الوصف |
|---|---|
| `VeloFind-Setup-0.2.0.exe` | مثبّت NSIS كامل (اختيار مجلد التثبيت + اختصارات سطح المكتب وقائمة ابدأ) |
| `VeloFind-Portable-0.2.0.exe` | نسخة محمولة تعمل بدون تثبيت |
| `latest.yml` | بيانات التحديث التلقائي (جاهزة لتفعيلها في v1.0) |

> ملاحظة التوقيع: المخرجات غير موقعة رقميًا (لا توجد شهادة Code Signing)، لذا قد يظهر تحذير SmartScreen عند أول تشغيل — اختر "More info ← Run anyway"، أو أضف شهادتك لاحقًا عبر أسرار المستودع.

## 🏗️ المعمارية — PRD §11 و§13

```text
┌──────────────────────────────────────────┐
│ React Renderer (RTL, Tailwind, Zustand)  │
│ HomePage · DuplicatePage · ScanPage …    │
└──────────────────┬───────────────────────┘
                   │ Electron IPC (عقد موثق)
┌──────────────────▼───────────────────────┐
│ Electron Main                            │
│ app · windows · ipc · tray · file-ops    │
│ worker-manager                           │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────▼───────────────────────┐
│ TypeScript Engine  (+ scan-worker.js)    │
│ scanner · duplicates · index · query     │
│ journal · persistence                    │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────▼───────────────────────┐
│ Windows API عبر koffi (FFI معزول)        │
│ kernel32 · ntfs/USN · file-metadata      │
└──────────────────────────────────────────┘
```

### بنية المجلدات

```text
src/
├── main/          app.ts · windows.ts · ipc.ts · tray.ts
│                  worker-manager.ts · file-operations.ts · settings.ts
├── engine/        engine-controller.ts · scan-worker.ts · concurrency.ts
│   ├── scanner/   directory-walker · file-scanner · scan-scheduler
│   ├── duplicates/ duplicate-detector · size-grouper · partial-hasher
│   │               full-hasher · duplicate-groups
│   ├── index/     file-index · memory-index · path-index · extension-index
│   ├── journal/   usn-reader · journal-state · journal-sync
│   ├── query/     query-parser · filters · sorter
│   ├── persistence/ persistence-manager (SQLite + JSON fallback)
│   └── platform/windows/ kernel32 · ntfs · file-metadata
├── renderer/      App · components/ · pages/ · stores/ · i18n/ · utils/
├── preload/       جسر contextBridge الآمن
└── shared/        types · ipc-contract · worker-protocol · constants
                   errors · safety · auto-select
tests/             54 اختبار (vitest)
resources/         الأيقونات المولدة
```

## 🔄 خط الفحص (5 مراحل)

1. **قراءة الملفات** — تجول مرن يتجاهل الروابط الرمزية ويفشل بهدوء مع تسجيل التحذيرات.
2. **التجميع حسب الحجم** — لا بصمة لأي ملف لا يشاركه أحد حجمه.
3. **البصمة الجزئية** — `hash(first+middle+last)` للملفات > 4MB فقط؛ اختلافها يلغي الحاجة للقراءة الكاملة.
4. **البصمة الكاملة** — SHA-256 متدفقة للمرشحين فقط، بالتوازي المحدود.
5. **تكوين المجموعات** — مع حساب المساحة القابلة للاسترداد وترتيبها تنازليًا.

الملفات التي لم يتغير حجمها وتاريخ تعديلها تُعاد بصماتها المحفوظة دون قراءة — هذا هو سر سرعة «استكمال آخر فحص».

## 🔒 قواعد الأمان المطبقة (PRD §17)

- ❌ لا يمكن تحديد/حذف جميع نسخ أي مجموعة — تُفرض في الواجهة **وفي** العملية الرئيسية.
- 🛡️ منع المساس بـ `C:\Windows` و`Program Files` و`(x86)` و`ProgramData`.
- 🔁 قبل أي حذف: تحقق حجم+mtime، و(اختياريًا) إعادة حساب SHA-256 لأي تغيير → **إيقاف العملية بالكامل**.
- ♻️ الافتراضي سلة المحذوفات؛ والعزل قابل للتراجع عبر سجل `file_operations`.
- ⚠️ الحذف النهائي: خيار متقدم بمربع تأكيد صريح.

## 🧪 USN Journal (تجريبي — v0.3 لاحقًا)

طبقة FFI معزولة (`koffi`) لقراءة USN Journal وMFT مكتوبة ومحمية ببوابة مزدوجة:

```bash
VELOFIND_ENABLE_USN=1  +  تفعيل الخيار من الإعدادات
```

أي فشل فيها يعني تحولًا تلقائيًا لإعادة الفحص عبر `fs` — حسب خطة تخفيف المخاطر PRD §28.

## 🗺️ خارطة الطريق

- **0.1 النموذج الأولي** ✅ فحص، بصمات، مجموعات، Recycle Bin
- **0.2 الأداء** ✅ Worker Threads، بصمة جزئية، SQLite، إيقاف/استكمال، فلاتر، داكن
- **0.3 الفهرسة المستمرة** 🟡 USN Journal مكتوب (تجريبي) + Tray جاهزان
- **0.4 تجربة الاستخدام** 🟢 التحديد التلقائي + العزل + التراجع جاهزة؛ المعاينات لاحقًا
- **1.0 المستقر** ⬜ مثبت NSIS، تحديثات تلقائية، توثيق المستخدم

## 📄 الرخصة

MIT
