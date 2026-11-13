# Live Web Model Discovery & Change Notifications

> **الحالة:** مُنفَّذ ومُختبَر (Source-only — لم يُبنَ ولم يُنشر بعد).
> **التاريخ:** 2026-11-13 · **الوكيل:** الوكيل الثالث · **الأولوية:** عالية
> **المهمة:** أن تصبح مزودات Web قادرة على اكتشاف نماذجها **من موقع المزوّد نفسه**،
> ومقارنتها بما سبق، وإعلام المستخدم بالتغييرات — بدل قائمة ثابتة تُقدَّم كأنها «مجلوبة».

---

## 1. لماذا؟

قبل هذه المهمة، زر «جلب النماذج» في صفحة المزودين كان:

* يقرأ **كتالوجًا ثابتًا** داخل المحوّل (`canonicalModels`) ويعرضه كأنه «تم الجلب»؛
* **يدمج** القوائم (union) فلا تُحذف أي معرّف قديم أبدًا؛
* يبتلع أخطاء الجلب ويرجع `HTTP 200` + رسالة نجاح؛
* زر «فحص الاتصال» كان **قراءة كوكي من القرص** تُعرض كـ«Connected».

المهمة السابقة (مراجعة Providers & Models) أصلحت الشفافية بالكامل، لكنها كانت
محدودة عمدًا: **لا يوجد مزود Web يملك نقطة `models`**، فلم يكن هناك اكتشاف حيّ
ممكن. هذه المهمة تبني تلك الطبقة فعلًا.

---

## 2. المعمارية

```
src/gateway/discovery/
├── types.ts             العقد: WebModelDiscoveryAdapter · DiscoveredWebModel · ModelDiscoveryResult
├── adapters.ts          15 Adapter لكل مزود (selectors ونقاط دخول مُثبَتة ميدانيًا)
├── dom-strategy.ts      استخراج من DOM: picker · pagination · virtual scroll · login-wall · dismiss
├── network-strategy.ts  قراءة قائمة النماذج من طلب الموقع نفسه (observed + replay)
├── embedded-strategy.ts كتالوج مدمج في بيانات صفحة الموقع (embedded JSON state)
├── runner.ts            جلسة متصفح آمنة: Profile + OwnershipLedger + headless/headed
├── snapshot-store.ts    حفظ Snapshots دائم (كتابة ذرّية) — ~/.arena-webbridge/
├── diff-engine.ts       مقارنة + قاعدة «فحصان متتاليان» لتأكيد الحذف
├── notification-store.ts مركز إشعارات دائم (read/unread + منع تكرار)
├── scheduler.ts         فحص دوري موزّع + jitter + backoff + قفل بين العمليات
└── service.ts           المنسّق: scan → diff → persist → notify → report
```

### تدفّق الفحص الواحد

```
runner.run()                 ← متصفح headless/headed على بروفايل المزود نفسه
   ├─ OwnershipLedger.claim  ← لا Fellahة مع عملية أخرى (وإلا: deferred)
   ├─ driverRunning?        ← جلسة حيّة ⇒ deferred (لا متصفح ثانٍ)
   ├─ launchPersistentContext(نفس البروفايل)
   ├─ strategies بالترتيب: dom → network
   │     يُفضَّل النتيجة التي تحمل معرّفات ثابتة
   └─ استخراج + تصنيف الأخطاء
        ↓
service.discover()
   ├─ snapshotStore.saveSuccessful()   ← لا يستبدل لقطة ناجحة عند الفشل
   ├─ diffSnapshots()                  ← added/removed/renamed/metadata/restored
   ├─ notifications.notify()          ← إشعار واحد لكل تغيير (dedupe)
   └─ report → card + routes
```

---

## 3. استخراج Model IDs

الأولوية (لا يُختلق معرّف من اسم عرض):

| # | القاعدة |
|---|---|
| 1 | المعرّف يُقرأ من سمة ثابتة في الـDOM: `data-model-id` · `data-mode-id` · `data-value` · `data-model-slug` · `slug` · `model_id` |
| 2 | بلا معرّف ثابت ⇒ `identityConfidence: 'display-name-only'` — **ولا يُعرض كقابل للتنفيذ** |
| 3 | القائمة الفارغة/التالفة = **فشل** (لا نجاح) |
| 4 | النتيجة التي تحمل معرّفات ثابتة **تتقدّم** على نتيجة أسماء فقط |

**مصادر معرّفات مثبتة ميدانيًا:**

| المزوّد | السمة | مثال |
|---|---|---|
| claude-web | `data-model-id` | `claude-sonnet-5-5` |
| chatgpt-web | `slug` (من `/backend-api/models`) | `gpt-5-6` |
| arena-browser | `data-model-id` (cmdk-item) | `019b24bb-5caf-71c3-b854-37d0c7086f21` |
| kimi-web | `id` (من `GetAvailableModels`) | `k3d1-agent` |
| kiwi-web | `id` (من `/v1/models`) | `nemotron-3-ultra` |
| qwen-web | `id` (من `/api/v2/models/`) | `qwen3.7-plus` |
| zai-web | `data-value` | `glm-5.3` |
| gemini-web | `data-mode-id` | `argon` |
| minimax-web | `model_id` | `MiniMax-M3.1-Flash` |

---

## 4. اكتشاف التغييرات

`diff-engine.ts` — خمسة أنواع:

| النوع | متى يُطلق |
|---|---|
| `model_added` | معرّف ظهر ولم يكن موجودًا |
| `model_removed` | غاب في **فحصين كاملين متتاليين** (فحص ناقص لا يُنتج حذفًا) |
| `model_renamed` | نفس المعرّف + اسم عرض مختلف (وغير مؤكد بلا معرّف ثابت) |
| `model_metadata_changed` | تغيّرت بيانات يقارنها النظام |
| `model_restored` | نموذج غاب ثم عاد |

**قواعد ملزمة:** الفحص الأول = **baseline** (بلا إشعارات) · الفشل لا يُنتج تغييرات ·
نفس التغيير لا يُبلَّغ مرتين.

---

## 5. Snapshots والإشعارات

| الملف | المحتوى |
|---|---|
| `~/.arena-webbridge/provider-model-snapshots.json` | آخر قائمة ناجحة لكل مزوّد + `snapshotHash` + `snapshotVersion` + `completeness` |
| `~/.arena-webbridge/provider-model-notifications.json` | كل الإشعارات + `read` + `dedupeKey` |

الكتابة **ذرّية** (tmp + rename) · لا تُخزَّن أي مفاتيح أو كوكيز · الفشل أو
النتيجة الناقصة **لا يستبدل** لقطة ناجحة.

---

## 6. Scheduler

| الإعداد | القيمة |
|---|---|
| الفترة | كل **12 ساعة** (`ui.discovery.intervalMs`) |
| التوزيع | موزّع على المزودات + jitter (لا 15 فحصًا متزامنًا) |
| Concurrency | 1 (قابل للضبط حتى 4) |
| Timeout | 120 ثانية لكل مزوّد |
| Backoff | أُسّي حتى 6 ساعات على `rate_limited` / `provider_unavailable` |
| Deferred | **ليس فشلًا** — يُعاد في الدورة التالية بلا backoff |
| عبر العمليات | `ProcessLock('provider-model-discovery-sweep')` — نسخة واحدة فقط |
| بعد إعادة التشغيل | `lastSuccessAt` محفوظ ⇒ لا يُعاد فحص الجميع دفعة واحدة |

---

## 7. أمان الجلسات

* الفحص يستخدم **بروفايل المزود نفسه** (ليقرأ ما يراه المستخدم) في متصفح
  **headless** (أو headed إن كان المزوّد معرّفًا هكذا) ⇒ **لا تبويب نشط تتأثر**.
* **لا يُرسل أي رسالة**، ولا يكتب كوكيًا، ولا يُسجّل خروجًا، ولا يفتح جلسة بديلة.
* إذا كان الدرايفر حيًّا (يملك البروفايل) ⇒ `deferred` فورًا.
* `OwnershipLedger` يمنع ادّعاء البروفايل من عمليتين.
* قفل Chrome على القرص هو الحاجز الأخير.

---

## 8. واجهة المستخدم

كل بطاقة مزوّد تعرض الآن:

* حالة **Live Discovery**: Active / Unsupported / Needs Login / Deferred / Error / Never scanned
* عدد النماذج المكتشفة · عدد الجديد · آخر فحص ناجح · المصدر · عدد التغييرات غير المقروءة
* أزرار: **Discover Models** · **Check for Changes** · **View Changes**
* مركز إشعارات (جرس + عداد غير مقروء + قائمة تغييرات + رابط مباشر للبطاقة)

زر «تحديث النماذج» (المستعار من لوحة الإعدادات) بقي قادرًا على تبديل ما هو
مميّز/غير مميّز — وهو الآن يعمل على قائمة الاكتشاف الحيّ.

---

## 9. نتائج Live Acceptance

> منفصلة تمامًا عن اختبارات Mock/Unit. مُنفَّذة على **نسخ مؤقتة معزولة** من
> البروفايلات (لأن البروفايلات الحقيقية لا تُفتح أثناء الفحص) وبوضع **headed**
> حيث ترفض المواقع المتصفح headless.

| المزوّد | الاستراتيجية | النتيجة الحية | معرّفات ثابتة | ملاحظة |
|---|---|---|---|---|
| arena-browser | DOM (`cmdk-item`) | ✅ 18 نموذج | 18 | `data-model-id` (معرّفات UUID داخلية) |
| claude-web | DOM (`data-model-id`) | ✅ 13 | 13 | `claude-sonnet-5-5` … — يحتاج headed |
| kimi-web | Network (`GetAvailableModels`) | ✅ 11 | 11 | `k3d1-agent`, `k28-instant` … |
| kiwi-web | Network (`/v1/models`) | ✅ 5 | 5 | `nemotron-3-ultra` … |
| chatgpt-web | Network (`/backend-api/models`) | ✅ 4 | 4 | `gpt-5-6`, `gpt-6` … — يحتاج headed |
| mistral-web | Embedded (`vcw_model_catalog`) | ✅ 4 | 4 | `mistral-large-4-0`, `zai-glm-5-3` … |
| zai-web | DOM (`data-value`) | ✅ 3 | 3 | `glm-5.3`, `glm-5.2` … |
| qwen-web | Network (`/api/v2/models/`) | ✅ 3 | 3 | `qwen3.7-plus`, `qwen3.8-max` … |
| deepseek-web | Network (`settings?scope=model`) | ✅ 3 | 3 | `default`/Instant, `expert`, `vision` |
| gemini-web | DOM (`data-mode-id`) | ✅ 2 | 2 | `argon`, `cf41b0e0…` |
| minimax-web | Network (`/minimax-cloud/api/v1/config`) | ✅ 2 | 2 | `MiniMax-M3.1-Flash`, `MiniMax-M3` |
| tencent-ai-web | Network (`modelTabInfo`) | ✅ 2 | 2 | `hy4-g`/Hy4, `hy3-g`/Hy3 — على `aistudio.tencent.ai` |
| grok-web | DOM (`menuitemcheckbox`) | ✅ 5 | **0** | أسماء أوضاع فقط (Fast/Build/Auto/Expert/Heavy) ⇒ `display-name-only` |
| longcat-web | — | ⛔ | — | **يتطلب رقمًا صينيًا** — الواجهة تُستخدم بلا حساب مؤقتًا |
| llm7-web | — | ⛔ | — | الموقع لا يستجيب (`ERR_CONNECTION_TIMED_OUT`) |

**المجموع: 13 من 15 مزودًا** يُكتشف نماذجها حيًّا (75 نموذجًا، منها 71 بمعرّف ثابت)،
والمزوّدان المتبقيان **يُعلان عائقهما بدقّة** — لا رجوع صامت إلى قائمة ثابتة:

* **longcat-web** — التسجيل يتطلب **رقمًا صينيًا**؛ الواجهة تُستخدم مؤقتًا بلا حساب،
  لذلك لا يمكن إثبات قائمة نماذجها. الحل: توفير رقم صيني ثم إعادة الفحص.
* **llm7-web** — الموقع لا يستجيب من هذه الشبكة؛ `replayPaths: ['/v1/models']`
  جاهزة إن عاد الموقع.

### العوائق المتبقية والحل المطلوب

| المزوّد | العائق | الحل |
|---|---|---|
| longcat-web | التسجيل يتطلب **رقمًا صينيًا** | توفير الرقم ثم إعادة الفحص (الـadapter جاهز) |
| llm7-web | الموقع لا يستجيب (`ERR_CONNECTION_TIMED_OUT`) | تحقق من التوفر — الـreplay جاهز |

### الجلسات المستخدمة في الفحص الحيّ

| المزوّد | البروفايل | الكوكيز المحفوظة |
|---|---|---|
| tencent-ai-web | `tencent-aistudio-profile` | `hunyuan_token`, `hunyuan_user` |
| grok-web | `grok-profile` | `sa-user-id`, `sa-user-id-v2/v4` |
| deepseek-web | `deepseek-profile` | `ds_session_id`, `smidV2` |
| mistral-web | `mistral-profile` | `browser-session-id`, kratos browser cookie |
| longcat-web | `longcat-profile` | `logan_session_token` (بلا تسجيل) |

> الكوكيز محفوظة على القرص داخل البروفايل ⇒ **لا حاجة لإعادة تسجيل الدخول**.

---

## 10. اختبارات TDD

| الملف | التغطية |
|---|---|
| `tests/gateway/discovery/strategies.test.ts` | الكتالوج المدمج · استخراج `modelName`/`model_type` ·ismiss الـconsent · عناصر Grok |
| `tests/gateway/discovery/adapters.test.ts` | لكل مزود **fixture خاص به**: استخراج المعرّفات، أسماء العرض، pagination، virtual scroll، قائمة فارغة، picker مفقود، جدار دخول، paywall، تغيّر Selector، انقطاع الشبكة |
| `tests/gateway/discovery/diff-engine.test.ts` | الأنواع الخمسة + baseline + قاعدة الحذف المؤكد + تأكيد إعادة التسمية |
| `tests/gateway/discovery/stores.test.ts` | Snapshots (ذرّية، دائمة، لا تُستبدل عند الفشل، بلا أسرار) + الإشعارات (دائمة، read/unread، منع تكرار) |
| `tests/gateway/discovery/service.test.ts` | خط الخدمة كاملًا + Scheduler (تلقائي/يدوي/تأجيل/backoff/قفل/إعادة تشغيل) |
| `tests/gateway/discovery-routes.test.ts` | مسارات HTTP: discover · notifications · read · read-all · status |
| `tests/gateway/provider-ui.test.ts` | تنفيذ **سكربت الواجهة الحقيقي** داخل `vm`: أزرار الاكتشاف، مركز الإشعارات، منع الضغط المزدوج |

**إجمالي الاختبارات:** 819 ناجح (0 فاشل) — منها 92 جديدة لهذه المهمة.

### عيوب حقيقية كشفتها الاختبارات وأُصلحت

1. **انكماش القائمة** عند توسيع pagination (زر «More» كان يُغلق الـpicker ويمسح القائمة).
2. **فقد المعرّفات** في استخراج الشبكة (الكائن المفرد غير المُغلَّف>array).
3. **ازدواج القائمة** عند دمج أكثر من selector (أُضيفت قاعدة: الـselector الثانوي يساهم بمعرّفات ثابتة جديدة فقط).
4. **كشف «Log in» كجدار دخول** (إنذار كاذب يُخفي اكتشافات ناجحة) — صار الجدار يُكتشف بـURL/كلمة مرور/نموذج دخول فقط.
5. **اختيار الاستراتيجية** كان يوقف عند أول نتيجة — صار يفضّل النتيجة ذات المعرّفات الثابتة.
6. **`urlPatterns` فارغة** كانت تعني «طابق أي استجابة» ⇒ اختراع نماذج من URLs غير النماذج (تم إصلاحها).

---

## 11. ملففات Symptom: مزوّد Tencent

كان `tencent-ai-webDriver` **يعيد كتابة** `aistudio.tencent.ai` إلى
`yuanbao.tencent.com/chat`، أي أن المزوّد كان يشير لمنتج مختلف عن الموقع
الذي يعمل عليه المستخدم. تم:

* `src/arena/providers.ts` → `defaultBaseUrl: 'https://aistudio.tencent.ai/'` و`profileDir: 'tencent-aistudio-profile'`
* `src/arena/tencent-ai-web-driver.ts` → إزالة إعادة الكتابة
* `src/gateway/discovery/adapters.ts` → `entryUrl: 'https://aistudio.tencent.ai/'`
* `~/.arena-webbridge/gateway.json` → `baseUrl` + `userDataDir` محدَّثان

---

## 12. حدود التنفيذ

* **لم يُبنَ** (`npm run build` لم يُنفَّذ) · **لم يُنشر** · **لم تُعدَّل** `dist/`.
* **Gateway 8989 لم يُمس** — PID 86948 يعمل بنفس binaries.
* **لم تُنفَّذ أي أوامر Git** أثناء التطوير (الحفظ المحلي تم بناءً على طلب صريح من المستخدم).
* **الملفات المشتركة لم تُعدَّل**: `src/server/app.ts` · `src/server/tool-interpreter.ts` ·
  `src/server/tool-pipeline-logger.ts` · `src/arena/web-drivers.ts` ·
  `src/protocol/request-broker.ts` · `src/sessions/*`.
* البروفايلات الحقيقية **لم تُفتح** أثناء الفحوص الحية (استُخدمت نسخ معزولة حُذفت بعدها).

---

## 13. حالة النظام

| البند | الحالة |
|---|---|
| Gateway 8989 | **لم يُمس** |
| PID 86948 | **لم يتغيّر** |
| `dist/` | **لم يُبنَ ولم يُستبدل** |
| Git | حفظ محلي فقط (لا push) — بملفات الوكيل الثالث فقط |
| البروفايلات | لم تُفتح أثناء الفحص؛ نسخ مؤقتة معزولة حُذفت |
| `gateway.json` | تغيّر واحد: `tencent-ai-web` → aistudio + بروفايله |
