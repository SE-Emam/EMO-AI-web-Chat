# EMO-AI-web — Multi-Gateway Routing + Unified Broker + Independent Drivers + Provider Resilience

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native inline — أسلوب المالك المعتمد من المرحلة السابقة). Steps use checkbox (`- [ ]`) syntax for tracking.
> **قيد مالك ملزم:** لا Commit، لا `git add`، لا reset/clean/checkout في أي خطوة — كل خطوات Commit في القالب تستبدل بـ«تشغيل الاختبارات + توثيق النتيجة».

**Goal:** Gateway يستطيع توجيه الطلبات بأمان بين عمليتي Gateway على ملف profile واحد، مع Idempotency موحدة عبر OpenAI/Anthropic/Gemini، وإدارة جلسات موحدة للسائقين المستقلين، وتعامل آمن مع أعطال ChatGPT الخارجية.

**Architecture:** قناة IPC محلية (loopback HTTP 127.0.0.1 + رمز عشوائي لكل عملية) بين مالكي profiles؛ سجل الملكية الملفي هو دفتر الحقيقة المشترك؛ RequestBroker مخزنه على القرص أصلًا فيُعاد استخدامه كسجل مشترك بين العمليتين مع **حجز تنفيذ ذري لمرة واحدة**. طبقة helpers موحدة للـBroker تحفظ صيغة كل بروتوكول عبر محولات مستقلة. تصنيف أخطاء Provider + Circuit Breaker + Health موسع.

**Tech Stack:** Node 24 (fetch مدمج)، `node:http` للقناة المحلية، Fastify (الـGateway الحالي)، Playwright (لم يُمس)، Vitest + child processes حقيقية.

**Spec:** أمر المالك «خطة المرحلة التالية» + التعديلات الإلزامية الخمسة على مراجعة الخطة (2026-11-12) + المراجع الأصلية totec448-spec/chat-on-steroids (مبادئ: epoch لكل تجسيد، claim لا يُعاد تنفيذها أبدًا، أول إثبات يفوز، رفض المتناقض).

**خط الأساس المثبت (2026-11-12):** HEAD `a42785c`، Index فارغ، `340 passed | 2 skipped (342)`، `tsc` نظيف. النسخ: `emo-ai-web-backup-2026-11-12-phase2-baseline.tar.gz` + `emo-ai-web-git-backup-2026-11-12-phase2-baseline.tar.gz`. لقطة الحالة: `git-status-phase2-baseline.txt` (75 مُدخلًا). نتائج: `test-results-phase2-baseline.txt`.

## Global Constraints (من أمر المالك — حرفية ملزمة)

1. لا إعادة بناء من الصفر؛ لا استبدال Playwright/Profiles/Tool Bridge؛ لا حذف TabWorkerPool/TabScheduler.
2. PID حي = ملكية مشغولة مهما تأخر Heartbeat (قاعدة Task 9) — تأخر Heartbeat تحذير فقط.
3. لا إعادة تنفيذ رسالة ChatGPT عند نتيجة إرسال غير مؤكدة (`unconfirmed` لا retry).
4. لا تجاوز حدود الاستخدام/الحماية/CAPTCHA/تسجيل الدخول؛ لا إرسال رسائل حية لحساب المستخدم دون تفويض صريح.
5. لا تغيير بيانات جلسات ChatGPT الحقيقية بغرض الاختبار.
6. لا خلط أعمال المستخدم السابقة (فئة B) مع تنفيذ المرحلة؛ لا تحسين تنسيق لملفات المستخدم.
7. لا أسرار في Logs (API keys/bearer/cookies/محتوى المحادثة الكامل/أسرار IPC).
8. `/health` لا يرسل رسالة اختبار إلى ChatGPT.
9. كل قدرة تُعلن مكتملة فقط بعد اختبار قابل لإعادة التشغيل أو تُصنف «غير متحقق منها».
10. التقسيم زمني: Task 11 ← 12 ← 13 ← 14 ← 15، وتقرير مختصر بعد كل Task. **تنفيذ تسلسلي فقط — Task 12 لا يبدأ قبل إغلاق Task 11 (قرار المالك).**

## Review Focus (مدخلات يوحي بها الأمر ولا تغطيها اختبارات المهمة الواحدة — الأرجح أولًا)

1. **أمر IPC قديم بعد موت المالك وإعادة توليد profile لعملية جديدة** — epoch لم يعد صالحًا يجب أن يُرفض حتى لو كانت الحمولة سليمة. الاختبار: Task 11 اختبار 12.
2. **نفس `X-Request-Id` مع Payload مختلف (بما فيها الأدوات وإعدادات التوليد والبروتوكول)** — يجب Conflict صريح بصيغة البروتوكول، لا Replay صامت. الاختبار: Task 12 اختبار 6 لكل بروتوكول.
3. **موافقة معلنة لقيود السائق المستقل** — driver لا يدعم الاستمرار يجب أن يعلن نمطه، لا أن يزيفه. الاختبار: مصفوفة `docs/provider-capabilities.md` مقابل اختبارات Task 13.
4. **Rate limit مع `Retry-After` موثوق** — احترامه حرفيًا دون محاولات موازية ولا تبديل حساب/مزود صامت. الاختبار: Task 14 fixtures.
5. **عميل يقطع SSE بين العمليتين بعد قبول التنفيذ** — لا إلغاء أثر خارجي بصورة غير آمنة؛ `unconfirmed` عند الغموض، والقرار من المخزن الدائم لا من وصول الحدث. الاختبار: Task 11 اختبارات 8/10.

---

## Task 11 — التوجيه الحقيقي بين عمليات Gateway (IPC)

### القرارات المقفلة (بعد تعديلات المالك الإلزامية الخمسة)

- **النقل (موافق عليه):** loopback HTTP (`127.0.0.1`، منفذ عابر لكل عملية) عبر `node:http` + `fetch`. سبب الاختيار: SSE وchunked مدمجان، توافق كامل مع بنية Fastify/Node، بلا منفذ عام.
- **المصادقة (موافق عليه بشروط):** رمز عشوائي 32 بايت (`crypto.randomBytes(32).toString('hex')`) لكل عملية، يُرسل في ترويسة `x-emo-ipc-token` ويُتحقق منه **بمقارنة ثابتة الزمن** (`timingSafeEqual` مع حماية اختلاف الطول). الرمز + endpoint يُكتبان في ملف جانبي لكل profile: `~/.arena-webbridge/state/owner-ipc/<sha1(profileDir)>.json` بصلاحية `0600` على POSIX (Windows: ACLs الافتراضية لملف المستخدم — فرق المنصات موثق). لا يُعلن endpoint في سجل الملكية قبل أن يستمع السيرفر فعليًا.
- **حجز التنفيذ الذري (تعديل إلزامي 1):** `RequestBroker.attachForExecution(key, executor)` — عملية ذرية تحت ProcessLock داخل المخزن المشترك: أول استدعاء فقط يحجز التنفيذ ويسجل `ExecutionAttachment` على المدخل الدائم:
  ```ts
  interface ExecutionAttachment {
    executorInstanceId: string;   // هوية عملية المالك (browserOwner.id)
    executorEpoch: string;        // epoch المالك وقت الحجز
    executorPid: number;
    forwardId: string;            // معرف أمر الـIPC الفريد من المستقبل
    executionToken: string;       // رمز يضبّت تحديثات الحالة لاحقًا
    attachedAt: number;
    sentAt: number | null;        // متى بدأ الإرسال الفعلي (markSent)
  }
  ```
  ربط الحجز بـ`key` + `forwardId` + هوية المالك المقصود. الاستدعاء المكرر (IPC مكرر أو عملية أخرى) → `already_attached` **ولا تنفيذ ثانٍ**؛ إعادة إرسال نفس الأمر بنفس `forwardId` من نفس المنفذ → إقرار idempotent بنفس الحجز (لا تنفيذ جديد). **كل تحديث حالة لاحق** (markSent/complete/fail/markUnconfirmed عبر controller المرفق) يتحقق من `executorInstanceId` + `executionToken` قبل الكتابة. `brokerKey` يُحسب في المستقبل ويُمرر — لا `begin()` عند المالك أبدًا.
- **تعطل المالك (حقيقة دائمة على القرص):** `settleForwardFailure(key, {executorPid})`: لا إرفاق → `failed(retryable)`؛ إرفاق بلا `sentAt` ومنفذ ميت فعليًا (فحص `pidAlive`) → مسح الإرفاق + `failed(retryable)`؛ إرفاق مع `sentAt` → `unconfirmed`؛ إرفاق ومنفذ حي → `unconfirmed` (التنفيذ قد يكون جاريًا). **مهلة IPC وحدها لا تسمح بإعادة تنفيذ أبدًا** — القرار دائمًا من حالة المخزن الدائمة، لا من كائن في الذاكرة.
- **`accepted` (تعديل إلزامي 2):** الترتيب: (1) حجز ذري محفوظ على القرص → (2) إرسال `accepted` → (3) بدء التنفيذ. ضياع الحدث عبر الشبكة ليس دليلًا على عدم القبول: أي انقطاع قبل `accepted` → فحص حالة الـBroker المحفوظة (`settleForwardFailure`) قبل تحديد أمان إعادة المحاولة.
- **نقطة التدخل (تعديل إلزامي 3):** التوجيه عند **اختيار Provider/Profile الفعليين** — `OwnerRoutingDriver` يأخذ **Resolver ديناميكي** `resolve(): ArenaDriver` يُستدعى لكل طلب (لا نسخة ثابتة)، فيغطي `manager.getActiveDriver()` بعد تبديل الحسابات، ومسارات `RoutingDriver`، ومسار `start()` (الاختبارات تغطي start وتبديل الحسابات لا sendMessage فقط). `ProfileBusyError` (كائن خطأ بنيوي: profileDir/ownerInstanceId/pid/heartbeatAt/staleHeartbeat) يُضاف إلى غير القابل للفشل-over في `RoutingDriver` — تعارض ملكية لا يبدّل مزودًا صامتًا.
- **هوية الـProfile والمخزن (تعديل إلزامي 4):** مسار الـprofile يُوحَّد بـ`realpathSync` (fallback `path.resolve`) قبل أي claim/تسجيل/توجيه. التوجيه **يُرفض صراحةً** إن لم تثبت العمليتان اشتراكهما في نفس مخزن الـBroker ونفس جذر الحالة (بصمة المخزن تُكتب في الملف الجانبي ويقارنها المستقبل) — لا ادعاء بـIdempotency مشتركة زائفة.
- **تحصين قناة HTTP:** `127.0.0.1` فقط؛ رفض أي endpoint غير loopback ورفض Redirects؛ حد حجم الطلب (افتراضي 16MB → 413)؛ لا تسجيل للرمز أو محتوى المحادثة؛ صلاحيات الملف `0600` POSIX مع توثيق فرق Windows.
- **Backpressure صريح + مهل غير ثابتة:** الكتابة تتحقق `write() === false` → انتظار `drain` قبل مقطع تالٍ (طرفا القناة). مهلة خمول قابلة للضبط (افتراضي 10 دقائق بين المقاطع، تُصفَّر مع كل مقطع) — لا مهلة إجمالية ثابتة تقطع التوليد الطويل النشط (المهل الكلية تأتي من Task 14 القابلة للتهيئة).
- **دورة الطلب:** `POST /emo-ipc/v1/execute` بجسم JSON `{protocolVersion, profileDir, ownerInstanceId, epoch, forwardId, broker:{key, apiKeyScope, providerId, requestId}, model, messages, sessionKey, stream}`. الرد chunked: `accepted` (بعد الحجز الذري) → `{type:'chunk'}`… → `{type:'done', content}` / `{type:'error',…}`. المالك يدخل طابور الجلسة الخاص بـsessionKey عند **نفسه** وينفذ على صفحة الجلسة الصحيحة — لا محادثة جديدة لمجرد اختلاف الـGateway.
- **Epoch:** كل أمر يحمل epoch المالك كما قرأه المستقبل من السجل؛ عدم التطابق مع سجل الملكية الحالي → 409 `stale_epoch` بلا تنفيذ. قاعدة Task 9 محفوظة حرفيًا.

### الملفات

- Create: `src/ipc/profile-owner-transport.ts` — سيرفر loopback (`startOwnerIpcServer`) + عميل (`forwardToOwner`) + إدارة ملف الرمز 0600 + normalization للمسارات + تحقق اشتراك المخزن.
- Create: `src/ipc/profile-owner-router.ts` — `OwnerRoutingDriver` (Resolver ديناميكي) + `ProfileOwnerRouter` (تسجيل endpoint عند claim، إبطال عند release/توقف، `forwardAndExecute` يربط `attachForExecution`/`settleForwardFailure`).
- Modify: `src/sessions/ownership-ledger.ts` — `ipcEndpoint`/`protocolVersion`/`startedAt` (اختيارية، توافق خلفي) + `updateIpcEndpoint` + normalization بالـrealpath.
- Modify: `src/protocol/request-broker.ts` — `ExecutionAttachment` + `attachForExecution` الذرية + `settleForwardFailure` + `markUnconfirmedByKey` + حقل `fingerprint` (يُفعَّل في Task 12).
- Modify: `src/arena/web-drivers.ts` — `ProfileBusyError` المنظمة (بدل رسالة نصية) دون تغيير سلوك الرفض الحالي.
- Modify: `src/arena/routing-driver.ts` — `ProfileBusyError` غير قابل للفشل-over.
- Modify: `src/server/app.ts` (C — يُفصل في التقرير) — غلاف الـResolver عند تفعيل IPC.
- Test: `tests/ipc/profile-owner-ipc.test.ts` + fixtures: `tests/fixtures/ipc-owner-process.ts`، `tests/fixtures/ipc-gateway-process.ts` (عمليتا Node حقيقيتان بـmock driver، بلا Playwright/شبكة).

### الخطوات

- [ ] **1. اختبار فاشل (وحدة transport):** سيرفر حقيقي على 127.0.0.1 + ملف رمز 0600؛ بلا رمز → 401؛ برمز خاطئ → 401 (مقارنة ثابتة الزمن)؛ برمز صحيح → accepted؛ طلب > حد الحجم → 413؛ endpoint غير loopback → رفض. Run: `npx vitest run tests/ipc/profile-owner-ipc.test.ts` Expected: FAIL (وحدات غير موجودة).
- [ ] **2. تنفيذ transport** بالتوقيعات: `startOwnerIpcServer(opts:{profileDir, ownerInstanceId, epoch, stateRoot, brokerStorePath, hooks:{validate(cmd), execute(cmd,onChunk,signal), onAccepted()}}): Promise<{endpoint, token, close()}>`، و`forwardToOwner(endpoint, token, payload, {onChunk?, signal?, idleTimeoutMs?}): Promise<{content, accepted}>` مع drain صريح ورفض redirect.
- [ ] **3. اختبار فاشل (ledger الموسع):** `updateIpcEndpoint` يكتب الحقول الثلاثة؛ قراءة سجل قديم بلاها لا تنكسر؛ normalization بالـrealpath لمسارين مترادفين.
- [ ] **4. اختبار فاشل (attachForExecution الذرية):** على مخزن مشترك مؤقت: `begin(key)` ثم `attachForExecution` → controller يعمل؛ استدعاءان متزامنان → واحد فقط ينجح والآخر `already_attached`؛ نفس `forwardId` من نفس المنفذ → idempotent بنفس token؛ `settleForwardFailure`: بلا إرفاق→retryable، إرفاق بلا sentAt وpid ميت→retryable بعد مسح الإرفاق، إرفاق مع sentAt→unconfirmed، إرفاق وpid حي→unconfirmed؛ تحديث حالة برمز/هوية خاطئة → رفض صامت موثق.
- [ ] **5. اختبار فاشل (OwnerRoutingDriver):** Resolver ديناميكي (تبديل السائق بين طلبين)؛ التقاط ProfileBusyError مع مالك حي endpoint حي → توجيه → النتيجة؛ busy بلا endpoint → إعادة إطلاق كما هي؛ ProfileBusyError لا يُفشل-over في RoutingDriver؛ مسار start() يمر بالغلاف.
- [ ] **6. مصفوفة الاختبارات الـ14 (child processes حقيقية):** بند بند من أمر المالك في `tests/ipc/profile-owner-ipc.test.ts` — عمليتا Gateway (owner/receiver) على ledger وbroker مؤقتين بmock driver: (1–5) توجيه أساسي ونتيجة تعود وبلا context ثانٍ؛ (6) طلبان متزامنان جلستين مختلفتين؛ (7) جلستان بالتوازي؛ (8) SSE عبر العمليتين بترتيب مقاطع صحيح؛ (9) موت المالك قبل markSent → retryable بعد settle؛ (10) موت بعد markSent → unconfirmed؛ (11) مالك حي heartbeat متأخر → busy فقط + توجيه يعمل؛ (12) epoch قديم → 409 stale_epoch بلا تنفيذ؛ (13) موت فعلي → استعادة الملكية بآلية Task 9؛ (14) إعادة إرسال نفس الأمر → تنفيذ واحد.
- [ ] **7. تشغيل المجموعة + Regression كامل** (`tsc --noEmit` + `npx vitest run`) — Expected: 340 السابقة + الجديدة كلها ناجحة.
- [ ] **8. توثيق + تقرير Task 11** — تحديث `IMPLEMENTATION_REPORT.md` §5 (جزئي ← الدليل الفعلي) وتقرير مختصر للمالك.

**معيار القبول:** عمليتا Gateway حقيقيتان (child processes، mock driver): واحدة تملك الـprofile، الثانية تستقبل → ينفذ عند المالك مرة واحدة (attachForExecution ذري)، SSE يعبر القناة، epoch القديم يُرفض، موت المالك قبل/بعد الإرسال يعطي retryable/unconfirmed من المخزن الدائم، وتبديل الحسابات وstart يمران بالـResolver الديناميكي.

---

## Task 12 — Request Broker موحد (OpenAI + Anthropic + Gemini)

### القرارات المقفلة

- **الطبقة المشتركة:** `src/server/request-broker-helpers.ts` — `extractRequestId(headers)`, `brokerScope(apiKeyScope, providerId)`, `payloadFingerprint(body, protocol): string`، و`runBrokeredRequest<T>()` غلاف دورة الحياة: `begin → (replay | execute(fn) | conflict | denied)`. صفر تكرار لمنطق الـBroker داخل الـRouters.
- **Fingerprint (تعديل إلزامي):** البصمة تشمل **كل ما يغير نتيجة التنفيذ**: model + الرسائل/prompt/contents **+ الأدوات (tools/tool_choice) + إعدادات التوليد (temperature/max_tokens/top_p…) + response_format/ما يقابلها في كل بروتوكول + نوع البروتوكول نفسه** — sha256 ثابت الشكل بعد تطبيع ترتيب المفاتيح. نفس `X-Request-Id` مع أي اختلاف → Conflict `idempotency_key_reused_with_different_request` بترميز 409 بصيغة البروتوكول الأصلي، لا Replay لنتيجة غير مطابقة. مدخل قديم بلا fingerprint → يُقبل (توافق خلفي موثق).
- **البروتوكولات:** Replay بصيغة أصله. القرار: تخزين replay payload بصيغة البروتوكول الأصلي في `complete()` (حقل اختياري `nativeReplay`)؛ المحول يبني منها مباشرة، وإلا يبني من المحتوى النصي (فروق التوقيت/التقطيع موثقة).
- **Tool calling:** `toolCalls` المحفوظة تُعاد بصيغة كل بروتوكول مع الحفاظ على `tool_call_id`/ربط النتائج؛ لا إعادة تنفيذ أدوات عند replay.

### الملفات

- Create: `src/server/request-broker-helpers.ts`
- Modify: `src/server/anthropic-routes.ts` (C)، `src/server/gemini-routes.ts` (C)، `src/protocol/request-broker.ts` (fingerprint/nativeReplay)
- Test: `tests/server/unified-broker.test.ts` (+ تعزيز `tests/protocol/request-broker.test.ts`)

### الخطوات

- [ ] 1. اختبارات helpers فاشلة (fingerprint شامل، ثابت الترتيب، conflict، دورة الحياة) → تنفيذ → نجاح.
- [ ] 2. تكامل Anthropic: العشرة اختبارات (JSON/SSE/running-deny/completed-replay/stream-interrupt→unconfirmed/pre-send-retry/conflict/scope isolation/tool calls/restart).
- [ ] 3. تكامل Gemini: نفس العشرة.
- [ ] 4. اختبار مشترك: المسارات الثلاثة تستخدم `runBrokeredRequest` نفسها مع محولات منفصلة.
- [ ] 5. Regression + تقرير Task 12.

---

## Task 13 — توحيد إدارة الجلسات للسائقين المستقلين

### القرارات المقفلة

- **أولًا الفحص ثم الشفافية:** مصفوفة `docs/provider-capabilities.md` تُملأ من الكود + اختبارات فعلية، لا افتراض.
- **`DriverCapabilities` ليست booleans فقط (تعديل إلزامي):** نمط الجلسة قيمة معلنة:
  ```ts
  type SessionSupport = 'per-session-page' | 'serialized-per-session' | 'single-session-only' | 'unsupported';
  interface DriverCapabilities {
    sessionSupport: SessionSupport;
    persistentConversation: boolean;
    streaming: boolean;
    toolCalling: boolean;
    notes: string; // قيود فعلية قصيرة
  }
  ```
  driver لا يدعم العزل/الاستعادة إما يطبق مسارًا آمنًا (serialized-per-session مع عزل حالة واستعادة سياق حيث يدعم) أو **يرفض الاستخدام المتعدد بوضوح** — لا تجاهل صامت لـsessionKey إطلاقًا.
- **نطاق التنفيذ الآمن:** تمرير `sessionKey` حتى آخر طبقة + تسلسل آمن لكل driver بلا صفحات مشتركة + حفظ/استعادة رابط المحادثة حيث يدعمه الـdriver. **لا فرض TabScheduler** على بنية غير متوافقة. ممنوع: تعديل Selectors/تسجيل الدخول؛ ادعاء دعم غير موجود.

### الملفات

- Create: `docs/provider-capabilities.md`
- Modify: `src/arena/{zai,qwen,gemini,claude,tencent}-web-driver.ts` + `src/arena/web-drivers.ts` (الصفوف بالضبط بعد الفحص الفعلي)
- Test: `tests/arena/driver-capabilities.test.ts`

### الخطوات

- [ ] 1. فحص مصدري (أسئلة §A العشرة) → مسودة المصفوفة.
- [ ] 2. اختبارات فاشلة لما يُنفذ → تنفيذ → نجاح (عزل/تسلسل/تمرير sessionKey/إعلان النمط).
- [ ] 3. إغلاق المصفوفة من نتائج الاختبارات.
- [ ] 4. Regression + تقرير Task 13.

---

## Task 14 — Provider Resilience وHealth Monitoring

### القرارات المقفلة

- **التصنيف:** `src/arena/provider-failures.ts` — `ProviderFailure` (الأسماء العشرة) + `classifyFailure(err, phase)` بمراحل: pre-send/post-send/awaiting/restore/quota. التمييز RATE_LIMITED/QUOTA_EXHAUSTED عند دليل فقط؛ وإلا `PROVIDER_UNAVAILABLE` غير مؤكد.
- **Rate limits (تعديل إلزامي مؤكد):** `RATE_LIMITED` → لا إعادة إرسال تلقائية ولا محاولات متوازية؛ احترام `Retry-After` الموثوق حرفيًا؛ بلا دليل → انتظار محافظ محدود؛ `AUTH_REQUIRED`/`QUOTA_EXHAUSTED` → **لا تبديل حساب/Provider صامت أبدًا** (التبديل فقط بإعداد صريح من المستخدم) — والفشل-over في `RoutingDriver` معطَّل لهذه الرموز.
- **Circuit breaker:** `src/arena/circuit-breaker.ts` لكل (providerId, profileDir): عتبة قابلة للضبط → open → half-open → إغلاق بعد نجاح؛ لا يلغي الجلسات الجارية؛ الحالة في `/health`.
- **Timeouts متدرجة قابلة للتهيئة** في `Config`: `providerTimeoutsMs {accept, stall, total}` (هنا تأتي مهلة الإجمالي التي لم يفرضها Task 11).
- **Health:** `/health` يوسع JSON بمقاطع §F من مصادر محلية فقط — بلا رسالة اختبار إلى ChatGPT.
- **Diagnostics:** حقول §G كاملة بلا أسرار.

### الملفات

- Create: `src/arena/provider-failures.ts`، `src/arena/circuit-breaker.ts`
- Modify: `src/arena/web-drivers.ts`، `src/server/app.ts` (C — /health فقط)، `src/config.ts` (M — افتراضيات)
- Test: `tests/arena/provider-failures.test.ts`، `tests/arena/circuit-breaker.test.ts`، `tests/gateway/health-endpoint.test.ts`

### الخطوات

- [ ] 1. اختبارات تصنيف فاشلة → تنفيذ → نجاح.
- [ ] 2. اختبارات breaker فاشلة (فتح/half-open/إغلاق/لا يمس جلسة جارية) → تنفيذ → نجاح.
- [ ] 3. تكامل: فشل post-send مصنف → `unconfirmed` (لا محادثة جديدة، لا إعادة إرسال) — اختبار.
- [ ] 4. `/health` الموسع + اختبار محلي.
- [ ] 5. Regression + تقرير Task 14.

---

## Task 15 — التكامل والاختبارات الشاملة

- [ ] 1. سيناريوهات Gateway §6-A (عمليتان حقيقيتان + mock driver، تعافي بعد إعادة تشغيل).
- [ ] 2. سيناريوهات البروتوكولات §6-B (ثلاثة مسارات × JSON/SSE + تكرار + تعارض + unconfirmed).
- [ ] 3. سيناريوهات السائقين §6-C + أعطال §6-D بfixtures (لا Rate limit حقيقي على حساب ChatGPT أبدًا).
- [ ] 4. Regression النهائي: توقع ≥ 340 + كل الجديد؛ حفظ `test-results-final.txt` (نسخة المرحلة).
- [ ] 5. تحديث `IMPLEMENTATION_REPORT.md` + `FINAL_PRE_COMMIT_AUDIT.md` (تصنيف A/B/C الجديد، Routing مكتمل/جزئي بالدليل) + تقرير المرحلة النهائي (مكتمل/مثبت/Mock-only/جزئي/غير منفذ/مخاطر) + عرض الحالة على المالك **دون commit**.

---

## Self-Review (منفذ بعد تعديلات المالك)

- **التعديلات الخمسة مدمجة:** (1) attachForExecution ذرية لمرة واحدة + هوية منفذ تُتحقق في كل تحديث + قاعدة «مهلة ≠ إذن إعادة» على القرص — في القرارات والخطوة 4؛ (2) accepted بعد الحجز الدائم + فحص المخزن بعد أي انقطاع — في القرارات والخطوة 4/6؛ (3) Resolver ديناميكي عند اختيار Provider/Profile + تغطية start/تبديل الحسابات/RoutingDriver — في القرارات والخطوة 5؛ (4) realpath + تحقق اشتراك المخزن + timing-safe + loopback-only + 413 + صلاحيات منصة + backpressure صريح + بلا مهلة ثابتة — في القرارات والخطوتين 1/2؛ (5) ExecutionAttachment دائم يفصل حجز/وصول/بدء إرسال/انتهاء — في القرارات والخطوة 4.
- **تعديلات 12–14:** fingerprint شامل بالأدوات والإعدادات والبروتوكول — في Task 12؛ أنماط الجلسة الأربعة — في Task 13؛ Retry-After وعدم التبديل الصامت — في Task 14.
- **الخطوات:** كل خطوة إجراء واحد قابل للفحص؛ الأجسام محذوفة عمدًا (التوقيعات والاختبارات تحسمها).
- **الاتساق:** `attachForExecution`/`settleForwardFailure`/`ProfileBusyError`/`OwnerRoutingDriver`/`payloadFingerprint`/`classifyFailure`/`ExecutionAttachment` أسماء موحدة عبر المهام.
- **تغطية الأمر:** §2–§9 مغطاة بندًا بندًا؛ الفجوة الوحيدة المقصودة: تحديد صفوف Task 13 بعد الفحص الفعلي (الأمر نفسه يشترطه).
