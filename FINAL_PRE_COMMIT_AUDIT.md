# FINAL PRE-COMMIT AUDIT — EMO-AI-web

> **تحديث Task 10 (2026-11-12، بإذن صريح من المالك):** هذا التقرير كان في الأصل مراجعة قراءة فقط. بموجب Task 10 حدّثه المُنفّذ ليعكس إصلاحي النتيجتين البرمجيتين (Swarm `markSent` + `ProcessLock.release`)، ونتائج الاختبارات المحفوظة فعليًا، وتصحيح عدد الفئة A، وتصنيف ناتج `git diff --check`. كل ما عدا ذلك بقي كما هو دون تغيير تصنيفات B/C.

**التاريخ:** 2026-11-12
**نوع المهمة:** مراجعة وتحقق نهائي فقط — بلا أي تعديل كود، بلا commit/add/reset/clean/checkout، بلا إعادة بناء، بلا حذف أو إعادة تسمية.
**المرجع:** توجيه المالك (10 أقسام) + خطة v2 `docs/superpowers/plans/2026-11-12-emo-session-ownership-broker.md` + `IMPLEMENTATION_REPORT.md` (المعتمد مستنديًا).
**HEAD:** `c7c46f8` — لا يوجد أي commit يتضمن التنفيذ الحالي.

---

## 1. نطاق المراجعة وتاريخها

- نطاقها: مصدر Task 9 (ملكية Profile)، ProcessLock، Request Broker، طبقة الجلسات/TabScheduler، ارتباط الجلسات، الاختبارات، حالة Git (130 مُدخلاً بصيغة `-uall` / 91 مجمّعًا)، النسخ الاحتياطية.
- إثبات القراءة فقط: لقطة حالة قبل المراجعة محفوظة ومقارنة لقطة بعد المراجعة (§14). الوحيد الجديد هو هذا الملف نفسه.
- لم يُعاد التحقق الحي مع ChatGPT (حسب المهمة) — الاعتماد على الأدلة المحفوظة في `.superpowers/sdd/2026-11-12-emo-session-ownership-broker/`.
- أعيد تشغيل مجموعة الاختبارات أوفلاين مرة واحدة للتأكد (`npx vitest run`) و`tsc --noEmit` (بدون كتابة في `dist/`).

---

## 2. نتيجة مراجعة Task 9 (الأولوية القصوى)

**المصدر:** `src/sessions/ownership-ledger.ts` — دالة `claimProfile` (سطور 68–103)، `heartbeat` (106–116)، `releaseProfile` (119–128)، `pidAlive` (40–47). مواقع الاستدعاء: `src/arena/web-drivers.ts` (سطر 368 heartbeat، 1159 claim، 1112/1197 release). الهوية: `src/browser/browser-owner.ts` (`owner-${pid}-${uuid}` لكل عملية، epoch جديد عند كل تجسيد).

| حالة المالك | القرار في المصدر | الحكم |
|---|---|---|
| PID حي + heartbeat حديث | `busy` (سطر 96) | ✔ |
| PID حي + heartbeat متأخر | `busy` + `staleHeartbeat:true` + تحذير سجلّي (سطور 87–95) | ✔ |
| PID ميت + heartbeat حديث | `stolen` (سطور 80–85) | ✔ |
| PID ميت + heartbeat متأخر | `stolen` | ✔ |

التحقق بندًا بندًا:

1. **تأخر heartbeat وحده لا يمنح الاستيلاء** ✔ — الشرط الحاكم `if (ownerDead)` فقط (سطر 80)؛ `heartbeatStale` لم يبقَ شرط استيلاء، بل إشارة اشتباه. ملاحظة مهمة: شرط `heartbeatStale` (سطر 79) **محسوب لكنه غير مستخدم في أي قرار استيلاء** — استخدامه الوحيد هو التفريع التحذيري؛ لا منطق ميت، لكن قراءته كشرط قراءة فقط.
2. **EPERM لا تُعامل كدليل موت** ✔ — `pidAlive` يعيد `true` عند `EPERM` (سطر 45)؛ نفس المنطق في `process-lock.ts` سطر 53.
3. **التحرير للمالك الصحيح فقط** ✔ — `releaseProfile` يطابق `ownerInstanceId` (سطر 123)؛ استدعاء web-drivers يمرر `this.browserOwner.id` الذي يتغير مع كل تجسيد عملية.
4. **عملية قديمة لا تحرر ملكية أحدث** ✔ — نفس المطابقة تمنعها؛ هوية كل عملية فريدة (pid + uuid عشوائي)، لا يمكن لعملية معاد تشغيلها أن تطابق هوية سابقة.
5. **heartbeat لا يغير هوية المالك** ✔ — يحدّث `heartbeatAt` فقط، و`epoch` فقط إذا مُرّر صراحةً وبعد فحص ملكية (سطور 110–112).
6. **استعادة بعد الموت متزامنة آمنة** ✔ — دورة claim كاملة داخل `ProcessLock.withLock` على مسار السجل؛ عمليتان متنافستان تتنافسان على القفل نفسه (مثبت أيضًا باختبار `ownership-racer` بعمليتين حقيقيتين: ACQUIRED واحد بالضبط).
7. **PID-reuse** — قيد موثق (تقرير §5): قد يجعل مالكًا متوقفًا يبدو حيًا؛ المعالجة إجرائية يدوية (تحقق مشغّل + حذف مدخل السجل). ليس قابلاً للحسم على مستوى التطبيق — موثق لا مُصلح.
8. **السجل لا يُدمر بقراءة متزامنة أو عملية قديمة** ✔ للكتابات (كل RMW داخل القفل + `writeJsonAtomic` tmp+rename). **مع تحفظ موثق أدناه**: ملف سجل **تالف** يُقرأ `null` فتُعامَل قائمة المطالبات كفارغة، وأول claim جديد يعيد كتابة الملف كاملًا — أي أن تلفًا خارجيًا للملف يصفّر المطالبات بصمت. `writeJsonAtomic` يجعل التلف ذاتيًا شبه مستحيل (rename ذري)، فالسيناريو يتطلب تلاعبًا خارجيًا/عطل قرص. **التصنيف: منخفض — سلوك "استرداد صامت" مقبول عمليًا لكنه غير موثق نصًا في التعليق.**

**حكم Task 9:** السياسة المصححة سليمة ومطابقة لتوجيه المالك حرفيًا، ومثبتة باختبارين جديدين حقيقيين (حي+متأخر→busy؛ ميت+طازج→stolen) واختبار سباق العمليات. **ليس "مكتمل بلا تحفظ"** — التحفظان: PID-reuse (موثق) وسلوك التلف الصامت أعلاه.

---

## 3. نتيجة مراجعة ProcessLock

**المصدر:** `src/sessions/process-lock.ts`.

- **O_EXCL فائز واحد** ✔ — `fs.openSync(file, 'wx')` (سطر 87)؛ EEXIST هو الفشل الحصري الوحيد الذي تضمنه النواة بين العمليات.
- **عمليتان لا تستطيعان امتلاك قفل ميت بالتزامن** ✔ — مسار السرقة (سطور 92–108) ينتهي بـ`openSync('wx')` ثانية؛ الخاسر فيها يلتقط EEXIST في نفس الـtry الذي يعيد `null` بأمان. مثبت باختبار `lock-racer` بعمليتين حقيقيتين.
- **لا يُحذف قفل مملوك لغيره** ✔ — `release` يقرأ المحتوى ويحذف فقط إذا طابق `ownerInstanceId` (سطر 123). **تحفظ:** فرع الـcatch (سطور 124–125) يحذف الملف إذا كان غير قابل للقراءة حتى لو أعيدت كتابته حديثًا من مالك آخر — وصول هذا الفرع عمليًا شبه مستحيل (الـhandle لا يُحرَّر إلا أثناء امتلاك القفل، والسرقة تشترط موت المالك)، لكنه دفاع ناقص نظريًا. التصنيف: منخفض.
- **ملف قفل تالف/جزئي لا يستميل استيلاء متسرع** ✔ — JSON.parse يفشل → `return null` (سطور 106–107) بلا حذف ولا تخمين.
- **لا انسداد دائم** ✔ — ميت+قديم (5 ثوان) → سرقة؛ حي → انتظار حتى `waitTimeoutMs` (10 ث) ثم فشل صريح (لا تعليق). نافذة ما بين الإنشاء وكتابة المحتوى (ملف فارغ لحظيًا) تُقرأ كتلف → `null` → آمنة.

**حكم ProcessLock:** سليم. **ليس "مكتمل بلا تحفظ"** — التحفظ النظري في فرع الـcatch بالـrelease فقط.

---

## 4. نتيجة مراجعة Request Broker

**المصدر:** `src/protocol/request-broker.ts` + التوصيل في `src/server/app.ts` (سطور 352–415، 466، 525، 562، 607).

1. لا تنفيذ مزدوج لنفس `requestId` ✔ — begin تحت `ProcessLock` على مستوى المخزن؛ `running` → 409 (مثبت باختبار سباق `broker-racer` وسباقين حيين: 409 أثناء التنفيذ ثم replay مخزن).
2. النتيجة المكتملة لا تُعاد تنفيذها ✔ — `completed` + result ≤256KB → replay (`x-emo-replay: true` للـSSE).
3. **توقيت markSent محافظ** ✔ في **المسارات الأربعة الرئيسية** — يُستدعى مباشرة قبل كل `driver.sendMessage` (سطور 466، 525، 562، 607). **ملاحظة (بند 7 أدناه):** مسار **swarm streaming** لا يستدعيه.
4. فشل بعد الإرسال → unconfirmed ✔ — `fail` يقرأ علامة `sent` المُخزنة (سطر 212) ويحوّل دائمًا.
5. `retryable:true` لا يتجاوز الحجب ✔ — يُسجل تحذيرًا ويرقى إلى unconfirmed (سطور 214–220).
6. الاستمرار عبر إعادة التشغيل ✔ — علامة `sent` والحالة مخزّتان في ملف دائم (`markSentPersisted`)، وليس في الذاكرة.
7. نطاق المفتاح ✔ — `sha1(apiKeyScope \0 providerId \0 requestId)`؛ العملاء مختلفو المفاتيح لا يتصادمون.
8. JSON/SSE ✔ — JSON يعاد كما هو؛ SSE يبثّ النتيجة المخزنة كأجزاء مع علامة replay — **باعتبارها إعادة بث تسجيل وليست تنفيذًا حيًا** (موثق).
9. >256KB ✔ — لا يُخزَّن النتيجة، وإعادة الطلب تعطي 409 برسالة صريحة "too large to replay" (سطر 398) — لا إعادة جزئية مضللة.

**التحفظات المكتشفة (موثقة، غير مُصلحة):**
- **[متوسط-منخفض] مسار swarm streaming بلا markSent** (`app.ts` ~سطر 429–463): فشل منتصف البث يسجَّل `failed` (retryable) رغم أن أجزاءً بُثّت للعميل ووكلاء السوارم قد يكونوا نفّذوا إرسالات حقيقية — إعادة تنفيذ النسخة التالية ممكنة إذن. المسارات الأربعة الأخرى محمية. الإصلاح المقترح لاحقًا: استدعاء `markSent()` قبل بدء بث السوارم.
- **[توضيحي] الـBroker مفعّل في `/v1/chat/completions` فقط** — مسارا `/v1/messages` و`/v1beta/*` بلا idempotency على X-Request-Id (خارج نطاق الخطة، يستحق التوثيق في قائمة المخاطر المستقبلية).

---

## 5. نتيجة مراجعة Session Queue وTabScheduler

**المصدر:** `src/sessions/session-queue.ts`، `src/browser/tab-scheduler.ts`، `src/arena/tab-worker-pool.ts`، `src/arena/web-drivers.ts` (سطور 330–345، 355–380، 480–515، 680–730).

1. مسار تنفيذ وصفحة لكل جلسة ✔ — `sessionQueues.run(sessionKey, …)` + `tabScheduler.acquireFor(sessionKey)`.
2. Page تمر عبر السلسلة بلا مرجع مشترك ✔ — `const page = acquireFor(...)` محلي داخل `sendMessageSerialized`؛ الحالة لكل جلسة (`getOrCreateSession`) بلا حقل driver مشترك؛ `page.__session` للفحص.
3. تسلسل نفس الجلسة ✔ — tail-chain لكل مفتاح، والفاشل لا يسمم الخطوة التالية.
4. توازٍ بين الجلسات ✔ — خطوط مستقلة (مثبت بـ`session-pages`/`session-isolation` tests).
5. LRU لا يخلّي صفحة نشطة ✔ — `evictOne` يستثني `inFlight` والـlease النشط (من الجدول المرجعي لا الكائن الراكد).
6. `conversationUrl` يُحفظ قبل الإخلاء ✔ — `onEvict` قبل `page.close()` ثم `pool.release` (ترتيب إلزامي في الكود والتعليق).
7. الصفحة البديلة تستعيد المحادثة ✔ — `st.sessionChatUrl` → `page.goto` + `assertAuthenticated` (سطور 488–515)، مع سقوط آمن لجلسة جديدة عند فشل الاستعادة.
8. إغلاق Tab بلا فقد/تكرار ✔ — `release` في `finally` دائمًا؛ صفحة ميتة → نسيان الربط واكتساب صفحة جديدة؛ الطابور الدائم للجلسة يبقى مرجع التنفيذ.
9. لا انتظار دائم عند امتلاء الحد ✔ — بلا ضحية → منطق waiters في الـPool؛ `release` يُسلّم الصفحة لمنتظر (`pendingAcquisitions > 0`).
10. لا نظامان لإدارة الصفحات ✔ — Scheduler فوق Pool (لا pool ثانٍ)؛ الإخلاء يغلق الصفحة **قبل** `release` فيُصبح التحرير الثاني no-op لأن `busyTabs.get` يعيد undefined. **تحفظ نظري (منخفض):** طلبان لجلسات مختلفة عند الحد قد يختاران الضحية نفسها قبل حذفها من الخريطة (اختيار الضحية متزامن ثم await) — لو فشل `close` عند الأول، قد يمر تحريران لنفس الصفحة مع وجود waiter → إمكانية تسليم مزدوج. النافذة ضيقة جدًا وشرطها فشل close؛ موثقة هنا فقط.

**التحفظ الإضافي (منخفض):** في `session-queue.ts` سطور 23–27، "تنظيف" الخطوط المنتهية **لا يعمل فعليًا** (جسم الـthen لا يحذف المدخل) — الخريطة تنمو بمقدار عدد مفاتيح الجلسات الفريدة (ذاكرة هامشية)، و`isBusy` غير مستخدم في أي كود/اختبار (API ميت). أثر وظيفي: صفر حاليًا.

**اعتماد السائقين المستقلين على الطابور القديم — مثبت من المصدر:** `zai-web-driver.ts` سطر 27/45 يبني طابورًا خاصًا به (`this.queue`) ويتجاهل sessionKey؛ `claude-web-driver.ts` بلا أي sessionKey؛ وينطبق النمط على qwen/gemini-web/tencent — كما وثّق التقرير (حد معلن، لا نظامان متعارضان لأنهم بملفاتهم الخاصة).

---

## 6. نتيجة مراجعة Session Correlation

**المصدر:** `src/server/chat-session-key.ts` (منقول حرفيًا) — threading في `app.ts` (360، 528، 569، 608)، `anthropic-routes.ts` (196، 236)، `gemini-routes.ts` (361، 429)، `routing-driver.ts` (43–56 يمرر sessionKey للمزود المُوجَّه)، `swarm-coordinator.ts` (سطر 217–223: `swarm-${swarmId}-${role}-${id}` لكل وكيل).

- الرأس الصريح يغلب البصمة دائمًا ✔ (سطر 17–18: `if (header) return header`).
- رأسان مختلفان برسائل متطابقة = جلستان ✔ (الأولوية للرأس قبل أي fingerprint).
- مفاتيح Swarm لكل وكيل ✔ (منفصلة بالدور والمعرف).
- Fallback موثق ✔ (metadata.session_id ثم بصمة system+أول user — الاصطدام هنا هو **السلوك المقصود** لتجميع مهمة واحدة).
- لا تسرب بين Providers/Profiles/العملاء ✔ — المفتاح مشتق من العميل فقط (بلا api-key/profile)؛ وفصل المزود يحدث في `SessionRegistry` عبر `providerId` ومفتاح الطابور يمر عبر driver لكل مزود.
- `privacyMode` سلوكه محفوظ ✔ — الاستعادة والحفظ كلاهما مشروطان بـ`privacyMode !== true` (سطور 482، 490، 689–692)، والتطهير بعد كل دور كما كان.

---

## 7. الاختبارات والنتيجة (محدّث بعد Task 10)

- **التشغيل المؤكد الأخير (أوفلاين، 2026-11-12 بعد Task 10):** `tsc --noEmit` نظيف (exit 0)؛ **340 passed | 2 skipped (342)** في 35 ملف اختبار ناجح + 1 متخطى، المدة 4.09s. النتيجة الفعلية محفوظة في `test-results-final.txt`. ✔
- **[محلول — كان تباينًا]** الملف المحفوظ `test-results-final.txt` كان يحتوي نسخة ما قبل Task 9 (331/333). بتنفيذ Task 10 أُعيد حفظه بالنص الحي للتشغيل الكامل بعد Task 10 (340/342) — التناقض محلول، ونسخة الشجرة الاحتياطية الجديدة (task10) تتضمنه. الأرشيفات القديمة لم تُحذف.
- **إضافة Task 10:** 5 اختبارات `ProcessLock.release` (ملكية صحيحة/مالك مختلف/ملف تالف/تعذر التحقق/استعادة بعد رفض التحرير) + 3 اختبارات Swarm×Broker (`tests/server/swarm-stream-broker.test.ts`) — 8 اختبارات جديدة، والكل ناجح. العدد 340 = 332 (ما بعد Task 9) + 8.
- **الاختبارات الثلاثة بعمليات فرعية حقيقية** ✔ — `lock-racer.ts` (فائز واحد بالضبط لقفل بين عمليتين)، `ownership-racer.ts` (عمليتان حقيقيتان تتنافسان على نفس profile: ACQUIRED واحد والبقية BUSY بتفاصيل المالك، والفائز يبقى حيًا 1.5s)، `broker-racer.ts` (عمليتان على نفس مفتاح (scope,provider,requestId): ALLOWED واحد وDENIED بحالة). كلها تُنشئ عمليات Node حقيقية وتفحص ملف النتائج.
- 8/8 اختبارات ownership-ledger تشمل حالات المالك الأربع + EPERM + تحرير غير مالك.
- اختبار Task 10 يثبت سلوكيا: pre-send failure → `failed` (retry مسموح)؛ فشل بعد بدء السوارم → `unconfirmed`؛ إعادة نفس `X-Request-Id` → 409 دون تنفيذ ثانٍ (عدّاد التنفيذ 1 بالدلتا)؛ الطلب المكتمل يحتفظ بـReplay (`x-emo-replay: true`).
- الاختبارات التي **لم تُعَد** (بسبب المهمة): التحقق الحي مع ChatGPT (ممنوع) — يعتمد على أدلة `live-*.json` و`live-gateway.log` المحفوظة (موجودة ومفحوصة حساسيتها سابقًا: صفر بيانات اعتماد).
- **ملاحظة بيئة اختبار (شفافية):** مسار اختبار Task 10 يمرّ عبر `createServer` + `app.inject` مع محاكاة `SwarmCoordinator` (أوفلاين) وإعادة توجيه مخزن `RequestBroker` الحقيقي إلى مجلد مؤقت. مخزن المستخدم الحقيقي `~/.arena-webbridge/state/request-broker.json` تحقق من عدم المساس به (mtime 03:19 ثابت، مدخلان، بلا مفاتيح الاختبار).

---

## 8. قائمة المخاطر المعروفة (بقيت كما هي — لا إخفاء ولا إصلاح)

1. **Profile Owner Routing بين العمليات: جزئي معلن** — حصرية + رفض آمن 503 فقط، بلا قناة توجيه (§13).
2. استعادة مالك معلّق حي ظاهريًا = إجراء يدوي فقط؛ حالة PID-reuse حدية (تقرير §5/§7.5).
3. السائقون المستقلون على الطابور القديم (مثبت §5 أعلاه).
4. إعادة بث SSE المخزنة قطعة واحدة (توقيت أجزاء أصلي غير معاد).
5. `saveSessionState` القديمة تكتب بلا قفل (السجل الجديد هو المرجع) — مراقبة عند أي تغيير مستقبلي في سياسة الملكية.
6. **جديدة من هذا التدقيق:** مسار swarm-streaming بلا markSent (§4)؛ سلوك التلف الصامت لسجل الملكية (§2.8)؛ تباين ملف نتائج الاختبارات المحفوظ (§7)؛ تحفظان نظريان في ProcessLock/evictOne (§3، §5)؛ بلا idempotency في مساري Anthropic/Gemini (§4).

**لا يوجد خلل أمني أو سباق حرج جديد يتطلب إيقاف الاعتماد.** كل ما سبق موثق بالملف/الدالة/السيناريو ولم يُصلح (قيود المهمة).

---

## 9. جدول تصنيف تغييرات Git (A/B/C)

**المنهجية:** بصمة زمنية (birth/modification) لكل ملف + محتوى diff للملفات المتعقبة. نافذة جلسة التنفيذ: 11-12 بين 02:47 و03:36 (موثقة بأزمنة ملفات الخطة والأساس). كل ما سبق 02:47 من يوم 11-12 يعود لعمل المستخدم مساء 11-11/11-12 المبكر. المجموع: **130 مُدخلاً `-uall`** (73 غير متعقب، 34 معدلًا، 23 محذوفًا) = 91 مُدخلًا مجمّعًا (34 ?? / 23 D / 34 M) — مطابق لحالة ما قبل المراجعة.

### A — ملفات التنفيذ (مهام 1–10) خالصة

> **تصحيح العدد (Task 10):** العدد الصحيح لملفات A لمهام 1–9 هو **28** (وليس 31 كما ورد سابقًا في §10؛ الخطأ كان جمع «15 اختبارًا» بينما الفعلي 11 اختبارًا: 6 sessions + 1 protocol + 3 browser + 1 session-plumbing). ومع ملف اختبار Task 10 الجديد يصبح الإجمالي **29 ملف A**.

**القائمة الدقيقة لمسارات A (29 ملفًا):**

1. `src/sessions/process-lock.ts` (Task 1 + تقوية Task 10)
2. `src/sessions/durable-store.ts`
3. `src/sessions/session-registry.ts`
4. `src/sessions/ownership-ledger.ts`
5. `src/sessions/session-queue.ts`
6. `src/browser/browser-owner.ts`
7. `src/browser/tab-scheduler.ts`
8. `src/protocol/request-broker.ts`
9. `src/server/chat-session-key.ts`
10. `tests/sessions/durable-store.test.ts`
11. `tests/sessions/process-lock.test.ts` (+5 اختبارات Task 10)
12. `tests/sessions/session-registry.test.ts`
13. `tests/sessions/session-queue.test.ts`
14. `tests/sessions/session-isolation.test.ts`
15. `tests/sessions/ownership-ledger.test.ts`
16. `tests/protocol/request-broker.test.ts`
17. `tests/browser/browser-owner.test.ts`
18. `tests/browser/tab-scheduler.test.ts`
19. `tests/browser/session-pages.test.ts`
20. `tests/server/session-plumbing.test.ts`
21. `tests/server/swarm-stream-broker.test.ts` (Task 10 — جديد)
22. `tests/fixtures/lock-racer.ts`
23. `tests/fixtures/lock-serial.ts`
24. `tests/fixtures/ownership-racer.ts`
25. `tests/fixtures/broker-racer.ts`
26. `IMPLEMENTATION_BASELINE.md`
27. `IMPLEMENTATION_REPORT.md`
28. `docs/superpowers/plans/2026-11-12-emo-session-ownership-broker.md`
29. `src/arena/routing-driver.ts` (M نظيف: تمرير sessionKey حصرًا — Task 4)

*(خارج قائمة A أعلاه لكونه تقرير مراجعة/تسليم وليس كود تنفيذ: `FINAL_PRE_COMMIT_AUDIT.md` — ?? غير متعقب، قرار عرضه للمالك.)*

| الملف | الحالة في Git | التصنيف | سبب التصنيف | يحتاج فصلًا؟ |
|---|---|---|---|---|
| src/sessions/process-lock.ts | ?? | A | أُنشئ 11-12 02:53 (Task 1) + تقوية release في Task 10 | لا |
| src/sessions/durable-store.ts | ?? | A | 02:53 (Task 1) | لا |
| src/sessions/session-registry.ts | ?? | A | 02:57 (Task 2) | لا |
| src/sessions/ownership-ledger.ts | ?? | A | 02:53 + إصلاح Task 9 03:35 | لا |
| src/sessions/session-queue.ts | ?? | A | 03:09 (Task 5) | لا |
| src/browser/browser-owner.ts | ?? | A | 02:59 (Task 3) | لا |
| src/browser/tab-scheduler.ts | ?? | A | 03:13 (Task 6) | لا |
| src/protocol/request-broker.ts | ?? | A | 03:04 (Task 7) | لا |
| src/server/chat-session-key.ts | ?? | A | 03:03 (Task 4 — منقول حرفيًا) | لا |
| tests/sessions/*.test.ts (6: durable-store, process-lock, session-registry, session-queue, session-isolation, ownership-ledger) | ?? | A | 02:52–03:34 + 5 اختبارات Task 10 | لا |
| tests/protocol/request-broker.test.ts | ?? | A | 03:04 | لا |
| tests/browser/*.test.ts (3: browser-owner, tab-scheduler, session-pages) | ?? | A | 02:59–03:15 | لا |
| tests/fixtures/{lock-racer,lock-serial,ownership-racer,broker-racer}.ts | ?? | A | 02:54–03:04 | لا |
| tests/server/session-plumbing.test.ts | ?? | A | مولود 11-12 03:17 | لا |
| tests/server/swarm-stream-broker.test.ts | ?? | A | مولود 11-12 (Task 10) — اختبار مسار السوارم×Broker حصريًا | لا |
| IMPLEMENTATION_BASELINE.md | ?? | A | 02:47 | لا |
| IMPLEMENTATION_REPORT.md | ?? | A | 03:36 (بعد Task 9) | لا |
| docs/superpowers/plans/2026-11-12-emo-session-ownership-broker.md | ?? | A | 02:51 | لا |
| src/arena/routing-driver.ts | M | A | diff كاملًا 3+/2- = تمرير sessionKey حصرًا (Task 4) | لا (بحسب diff) |

### C — ملفات مختلطة (عمل المستخدم + تعديلات المهام معًا)

| الملف | الحالة في Git | التصنيف | سبب التصنيف | يحتاج فصلًا؟ |
|---|---|---|---|---|
| src/server/app.ts | M | C | diff 604+/38-: الأغلب عمل المستخدم السابق (swarm/security/anthropic+gemini routes/tool-interpreter) + توصيلي (Broker ~60 سطرًا + chatSessionKey، مtime 03:07) + إصلاحا Task 10 (markSent قبل السوارم ~سطر 447 + إنهاء SSE عند الخطأ ~سطر 477، مtime 04:11). | نعم — عند الحاجة لفصل |
| src/arena/web-drivers.ts | ?? | C | مولود 11-09 (عمل المستخدم) + تكاملاتي (Task 3 claim/heartbeat + Task 6 scheduler/lanes). غير متعقب = يُرفع كاملًا | التتبع أولًا؛ الفصل غير ممكن عمليًا |
| src/arena/tab-worker-pool.ts | ?? | C | مولود 11-11 11:25 (المستخدم) + إضافة capacity getter لـTask 6 | كاملة عند التتبع |
| src/server/anthropic-routes.ts | ?? | C | مولود 11-09 (المستخدم) + تمرير chatSessionKey (Task 4) | كاملة عند التتبع |
| src/server/gemini-routes.ts | ?? | C | مولود 11-09 + تمرير chatSessionKey | كاملة عند التتبع |
| src/server/swarm-coordinator.ts | ?? | C | مولود 11-11 (المستخدم) + مفاتيح لكل وكيل (Task 4) | كاملة عند التتبع |
| tests/server/anthropic-adapter.test.ts | ?? | C | مولود 11-09 (المستخدم) لكن mtime 03:18 خلال نافذة الجلسة وبلا أثر sessionKey فيه — لم أستطع إثبات ما تغيّر فيه (غير متعقب بلا خط أساس). **غير محسوم** | نعم — مراجعة يدوية قبل أي commit |
| tests/server/gemini-adapter.test.ts | ?? | C | نفس الحالة أعلاه | نعم |

### B — تغييرات المستخدم السابقة (خارج نطاق المهام — استُبعدت)

**معدلة (32):** .gitignore، README.md، package.json، scripts/login-zai-web.sh، src/arena/{claude,gemini,qwen,zai}-web-driver.ts، models.ts، providers.ts، selectors.ts، tencent-ai-web-driver.ts، src/browser/manager.ts، src/cli.ts، src/config.ts، src/emo-ai.ts، src/gateway/config-store.ts، provider-manager.ts (diff = عمل المستخدم: auth-detector/security/مسارات السائقين الجدد)، types.ts (diff = privacyMode — للمستخدم)، src/gateway/ui.ts (مسافات زائدة موثقة — آخر تعديل 11-11 16:27)، usage-tracker.ts، src/index.ts، src/server/gateway-routes.ts (1620+/10- للمستخدم)، openai-formatter.ts، src/types.ts (02:02، قبل الخطة)، tests/cli.test.ts، e2e.test.ts، tests/gateway/{config-store,provider-manager,server-auth-usage,usage-tracker}.test.ts، tests/server.test.ts (02:05، قبل الخطة).
**كلها mtime ≤ 11-11 19:33 أو ≤ 02:34 من 11-12 (قبل الخطة 02:51)، وdiffsها من عمل المستخدم (swarm/security/privacy/usage).**

**غير متعقبة (39):** tests/gateway/{api-keys,auth-and-lifecycle,multi-account,new-web-providers,security-redaction}.test.ts (11-08→11-11)، src/gateway/security.ts، auth-detector.ts (11-11)، tests/tab-worker-pool.test.ts (11-11 — اختبار المستخدم للـPool)، tests/server/{swarm-coordinator,tool-interpreter}.test.ts (11-11)، src/server/tool-interpreter.ts (02:34 — قبل الخطة)، src/server/{anthropic,gemini}-adapter.ts (11-10)، public/ (13 صورة/أيقونة)، emo-ai-logo/ (6)، scripts/EMO-AI (11-10)، EMO-AI-web.command (11-11)، docs/swarm-and-agentic-features.md (11-11).
**محذوفة (23):** القائمة في `deleted-files-for-commit-review.txt` — تقييم سابق: تنظيف سابق مقصود (18 سكربت inspect/capture قديم، 3 خطط 11-07 مستبدلة، IDEA.md، .command قديم) — صفر تقاطع مع مهام 1–9. B.

> **ملاحظة إجرائية:** `.superpowers/` في `.gitignore` (مثبت بـ`git check-ignore`) — سجل التنفيذ ونتائج الاختبارات والأدلة الحية **لن تُرفع في commit** ما لم تعدّل المالك `.gitignore` عمدًا.

### تصنيف ناتج `git diff --check` الكامل (أُعيد فحصه في Task 10)

- الناتج الكامل: **26 سطرًا**، كلها من نمط واحد: `src/gateway/ui.ts:<سطر>: trailing whitespace.`
- الملفات الفريدة في الناتج: **ملف واحد فقط** — `src/gateway/ui.ts` (26 موقع مسافات زائدة في نهاية الأسطر، أغلبها قوالب `innerHTML` مثل `const emptyMarkup = ` و`tr.innerHTML = `).
- التصنيف: **B — عمل المستخدم السابق** (آخر تعديل موثق 11-11 16:27، قبل نافذة جلسة المهام 02:47+). الملف **لم يُلمس إطلاقًا** في مهام 1–10، ولا يجوز تنظيفه ضمن هذا العمل (قيود صريحة من المالك).
- لا توجد تحذيرات conflict-marker ولا space-before-tab في أي ملف آخر. إجمالي: صفر تحذيرات من مهام التنفيذ.

---

## 10. الملفات المقترحة للـCommit التنفيذ (لائحة للمالك — القرار له)

**A كاملة (29 ملفًا):** القائمة الدقيقة في §A أعلاه (9 مصدر + 11 اختبار مهام 1–9 + 1 اختبار Task 10 + 4 fixtures + 3 مستندات + `src/arena/routing-driver.ts` M نظيف).

**C — تُرفع كاملة (الأسرع والأصوب عمليًا، لأنها غير متعقبة):** `src/arena/web-drivers.ts`، `tab-worker-pool.ts`، `src/server/anthropic-routes.ts`، `gemini-routes.ts`، `swarm-coordinator.ts` — **بشرط** أن يكون المالك مقبولًا برفع عمله السابق فيها مع تعديلات المهام (هي بلا خط أساس متعقب فلا فصل ممكن عمليًا).

**C متعقب:** `src/server/app.ts` — إن أراد المالك commit تنفيذًا فقط، يحتاج partial staging (`git add -p`) لفصل كتل الـBroker/chatSessionKey (+ إصلاحا Task 10) عن عمله السابق الأكبر؛ وإلا يُرفع كاملًا مع علمه بأنه يشمل عمله غير الملتزم سابقًا.

## 11. الملفات الواجب استبعادها من Commit التنفيذ

- **B معدلة (32)** — عمل المستخدم السابق، تُدار بقرار مستقل له.
- **B غير متعقبة (39)** — كما هي؛ التتبع قرار منفصل للمستخدم.
- **B محذوفة (23)** — تُلزم مع commit المستخدم للتنظيف، لا مع commit التنفيذ.
- `FINAL_PRE_COMMIT_AUDIT.md` — قرار عرضه/حفظه للمالك.
- `.superpowers/**` — gitignored (سجل/أدلة).
- `tests/server/{anthropic,gemini}-adapter.test.ts` — **تبقى خارج قائمة الجاهزية** حتى يحسم المالك مصدر تعديلهما (mtime 03:18 خلال نافذة الجلسة بلا أثر sessionKey — غير محسوم؛ تصنيف C).

## 12. الملفات المختلطة التي تحتاج Partial Staging مستقبلًا

- `src/server/app.ts` (الوحيد المتعقب المختلط فعلًا — كتل الـBroker/chatSessionKey القابلة للفصل بعلامات diff واضحة).
- ملفات C غير المتعقبة لا تحتاج staging جزئيًا (لا فصل ممكن) — تحتاج **قرار تتبع كامل** بدلًا من ذلك.
- `tests/server/{anthropic,gemini}-adapter.test.ts` — تحتاج مراجعة يدوية للمحتوى أولًا (غير محسومين).

## 13. تأكيد بقاء Profile Owner Routing جزئيًا

**مؤكد:** لا قناة توجيه بين العمليات — ما وُجد حصريًا: مطالبة/heartbeat/تحرير عبر سجل ملفات، رفض آمن 503 بتفاصيل المالك (`web-drivers.ts` سطر 1162–1166)، استيلاء بعد إثبات الموت فقط، وإجراء استعادة يدوي. أي صياغة "توجيه بين العمليات" في مستندات مستقبلية يجب أن تبقى بلاحقة "جزئي/حصري فقط".

## 14. تأكيد عدم تغيّر شجرة العمل وGit Index أثناء المراجعة

- لقطة `git status --porcelain=v1 -uall` + `diff --check` + `--stat` + `--name-status` محفوظة قبل المراجعة (‏/tmp/audit-before-*) ومطابقة بعدها.
- العمليات المنفذة: قراءة ملفات، `git status/diff` (قراءة)، `stat`، `tar -t/-xO` إلى stdout (بلا استخراج للشجرة)، `tsc --noEmit`، `npx vitest run` (اختبارات أوفلاين تستخدم مجلدات مؤقتة خارج المشروع).
- **الفرق الوحيد بعد المراجعة:** ملف جديد واحد — `FINAL_PRE_COMMIT_AUDIT.md` (هذا التقرير، مسموح صراحةً). لا تغيير في أي ملف موجود، ولا تغيير في الـIndex (لا add/reset إطلاقًا).
- **بعد Task 10 (فترة منفصلة موثقة):** تغييرات Task 10 مشروحة في §16 — ملفا مصدر (app.ts, process-lock.ts) + ملفا اختبار (جديد + إضافات) + هذا التقرير. الـIndex بقي فارغًا ولم يُنفذ أي commit/add/reset/clean/checkout.
- الأرشيفات: لم تُنقل ولم تُستبدل ولم تُحذف — فُحصت بالقراءة فقط (`tar -t` / `-xO`).

---

## 15. نقاط لم يمكن التحقق منها بالكامل (لأمانة الحكم)

1. حدود "عمل المستخدم السابق" داخل `app.ts` مُقدَّرة من diff+أزمنة، بلا commit وسيط يثبت الحدود سطرًا بسطر — التصنيف C هو الصحيح احتياطًا.
2. سبب تعديل `tests/server/{anthropic,gemini}-adapter.test.ts` خلال نافذة الجلسة (03:18) غير مفسَّر بمحتوى واضح (لا sessionKey فيهما) — **غير محسوم**، جُدولجيا في C.
3. ~~`test-results-final.txt` المحفوظ نسخة ما قبل Task 9~~ — **محلول في Task 10**: الملف أُعيد حفظه بنتيجة 340/342 الفعلية بعد Task 10، ونسخة الشجرة الاحتياطية الجديدة (task10) تتضمنه. الأرشيفات القديمة لم تُحذف.
4. التحقق الحي مع ChatGPT لم يُعاد (ممنوع) — الاعتماد على الأدلة المحفوظة، وهي لا تُحاكي سلوك اليوم الحالي لعناصر الموقع إن تغيّرت.
5. ~~سلوك الـrelease عند تلف ملف القفل (§3) غير مثبت باختبار~~ — **محلول في Task 10**: سلوك الـrelease عند التلف/الملكية غير القابلة للإثبات أصبح مثبتًا بـ5 اختبارات جديدة. يبقى سباق `evictOne` النظري (§5) تحليلًا مصدريًا غير مثبت باختبار — احتمال حدوثه شبه معدوم.

---

## 16. Task 10 — إغلاق ملاحظات التدقيق (النتيجة النهائية)

**النطاق:** إصلاح الملاحظتين البرمجيتين من هذا التدقيق فقط، دون أي commit أو `git add`، ودون خلط أعمال المستخدم السابقة.

### الإصلاح 1 — Swarm Streaming (`src/server/app.ts`)

- **المشكلة:** مسار السوارم المتدفق كان ينفّذ أول عملية ذات أثر خارجي حقيقي (`swarmCoordinator.executeAsChatCompletion`) **قبل** أي `markSent` — فشل بعدها كان يُسجل `failed` (retryable) رغم إمكانية أن الوكلاء أرسلوا فعلًا إلى محادثات الويب.
- **الإصلاح:** `brokerCtrl?.markSent()` فورًا **قبل** `executeAsChatCompletion` (~سطر 447) مع تعليق يوثق السبب. كل فشل قبل هذه النقطة يبقى `failed` (retry)، وكل فشل بعدها يتحول إلى `unconfirmed` بسياسة الـbroker (`retryable=true` بعد الإرسال يُرفض ويُسجل تحذيرًا).
- **إصلاح مكمل مكتشف أثناء الاختبار:** مسار خطأ السوارم المتدفق كان يستدعي `reply.status(500).send()` على reply مُخطف (hijacked) → اتصال معلق للأبد. الآن: إن بدأت SSE (`reply.raw.headersSent`) يُنهى البث بشكل نظيف (حدث `error` + `[DONE]` + `end`)؛ وإلا يبقى 500 العادي. (~سطر 477–500)
- **لم يتغير:** سلوك مسارات OpenAI/Anthropic/Gemini ومسار السوارم غير المتدفق.
- **دليل:** 3 اختبارات في `tests/server/swarm-stream-broker.test.ts` (كلها ناجحة): (1) المكتمل يحتفظ بـReplay ولا يُعاد تنفيذ مع نفس `X-Request-Id`؛ (2) فشل منتصف البث → SSE منتهٍ + الحالة `unconfirmed` + إعادة الطلب 409 + عدّاد التنفيذ 1 (بالدلتا)؛ (3) سياسة الـbroker: pre-send → retry مسموح، بعد `markSent` → `unconfirmed` رغم طلب retryable. إضافةً: تحقق حي أثناء التطوير (سكربتات مؤقتة حُذفت) أثبت تحذير `[request-broker] WARNING: retryable=true requested AFTER send…` والرفض 409.

### الإصلاح 2 — `ProcessLock.release` (`src/sessions/process-lock.ts`)

- **المشكلة:** الـrelease القديم كان يحذف الملف عند **أي** فشل قراءة/تحليل — فملف تالف أو أعيد إنشاؤه بمالك آخر كان يُحذف، وقد يسمح بامتلاك مزدوج.
- **الإصلاح:** الحذف **فقط** إذا أثبت محتوى الملف أن `ownerInstanceId` يطابق مالكنا. محتوى غير قابل للقراءة/تالف → تحذير `WARNING: cannot safely release…` ويُترك الملف (استعادة الميت عبر `staleTtlMs` تبقى ممكنة). ملكية مختلفة/مفقودة → تحذير `WARNING: lock … is not owned by …` ولا حذف. آلية O_EXCL وسرقة القفل الميت لم تُمس.
- **دليل:** 5 اختبارات جديدة في `tests/sessions/process-lock.test.ts` (11/11 ناجحة في الملف): ملكية صحيحة → حذف؛ مالك مختلف → لا حذف ويبقى محتواه؛ ملف تالف → لا حذف تلقائي؛ بدون `ownerInstanceId` → لا حذف؛ بعد رفض التحرير، سرقة المالك الميت (pid ميت) تعمل — الاستعادة لا تُسد أبدًا.

### الأدلة والتشغيل

- `tsc --noEmit`: نظيف (exit 0).
- `npx vitest run`: **340 passed | 2 skipped (342)**، 35 ملفًا ناجحًا + 1 متخطى، 4.09s — محفوظ فعليًا في `test-results-final.txt` (= 332 ما بعد Task 9 + 8 جديد).
- `dist` أعيد بناؤه (**مبرر ومثبت:** البوابة كانت تعمل من dist 03:36 وهو يفتقر لتقوية `ProcessLock` — 0 تطابق لسلسلة الإصلاح — والمصدر عُدل 04:08+). نسخة احتياطية للـdist القديم: `.superpowers/sdd/2026-11-12-emo-session-ownership-broker/dist-pre-task10-backup.tar.gz`. البوابة أُعيد تشغيلها من dist الجديد على `127.0.0.1:8989` و`/health` سليم.
- حماية بيانات المستخدم: مخزن الـBroker الحقيقي `~/.arena-webbridge/state/request-broker.json` تحقق أنه لم يُمس (mtime 03:19، مدخلان، بلا مفاتيح اختبار)؛ جميع الاختبارات على مجلدات مؤقتة.

### أثر Task 10 على التصنيف

- **A:** 28 (مهام 1–9، عدد مصحح) + 1 (`tests/server/swarm-stream-broker.test.ts`) = **29**. `tests/sessions/process-lock.test.ts` بقي A (اختبارات Task 10 تضاف لملف A قائم).
- **C:** بلا تغيير (8)؛ `app.ts` أضيفت له تفاصيل إصلاحي Task 10 في صفه فقط.
- **B:** بلا تغيير (94 تشمل 23 محذوفًا). ناتج `diff --check` (26 سطرًا، كلها `src/gateway/ui.ts`) = B كما وُثق في §9.
- حالة Git: HEAD `c7c46f8`، Index فارغ (0 staged)، 92 مُدخلًا مجمّعًا (35 ?? / 34 M / 23 D) — الفرق الوحيد عن ما قبل Task 10: ملف اختبار Task 10 الجديد + تقرير Task 10 في `.superpowers/` (gitignored).
