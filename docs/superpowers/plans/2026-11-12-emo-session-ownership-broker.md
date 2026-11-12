# دمج Browser Ownership + Session Correlation + Request Broker في EMO-AI-web (v2 — بعد مراجعة المالك)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native). Steps use checkbox syntax.

**Goal:** نقل ثلاث آليات من chat-on-steroids: ملكية المتصفح/Lease، الربط الدائم للجلسات، وRequest Broker بـ claim-once حقيقي بين العمليات — مع طابور لكل جلسة وسياسة ملكية profile معلنة.

**Architecture:** طبقات جديدة صغيرة تُدمج في `BaseWebDriver`/`app.ts`/`provider-manager.ts`. لا استبدال لـ Playwright ولا لـ Tool Bridge. كل السجلات الدائمة عبر قفل بين-العمليات (process-lock) + كتابة ذرية.

**Tech Stack:** TypeScript (ESM)، Fastify، Playwright، vitest. بلا اعتماديات جديدة.

**Spec:** تعليمات المالك (الرسالة الأخيرة) — هي السلطة الملزمة عند تعارض — + `IMPLEMENTATION_BASELINE.md`.

## Global Constraints

- 266 اختباراً حالياً + 2 skipped يجب أن تظل ناجحة بعد كل مهمة.
- لا حذف لـ `tab-worker-pool.ts` — يُعاد استخدامه أو يُوثَّق سبب عدم صلاحيته بوضوح (لا نظامان متوازيان).
- لا تسجيل أسرار/كوكيز/توكنز.
- المعرّف الصريح يتفوق دائماً على البصمة؛ رأسان صريحان مختلفان = جلستان **حتى لو تطابقت الرسائل**.
- فشل الدور لا يمسح الحالة الدائمة؛ privacyMode يعطّل الاستمرار.
- بعد احتمال وصول الرسالة إلى ChatGPT، الفشل **ليس** retryable تلقائياً — يصبح `unconfirmed` إلا إذا ثبت العكس.

## Review Focus

1. **عملية وحيدة تنجح من بين عمليتين متنافستين في اللحظة نفسها** — اختبار بعمليتين حقيقيتين (child processes)، لا mocks: Task 1/5.
2. **timeout أثناء التوليد** → `unconfirmed` بلا إعادة تنفيذ أعمى: Task 5.
3. **ملف حالة تالف**: تجاهل هادئ وإصلاح بالكتابة التالية: Task 1.
4. **إغلاق تبويب جلسة أثناء طابورها** بلا فقد الطلبات ولا تنفيذ مكرر: Task 6.
5. **جلستان تعملان فعلاً بالتوازي على صفحتين مختلفتين** (اختبار تزامن حقيقي يتحقق من هوية الصفحة المستخدمة، لا من حجم Map): Task 6.

---

### Task 1: قفل بين-العمليات + مخزن JSON ذري

**Files:**
- Create: `src/sessions/process-lock.ts`
- Create: `src/sessions/durable-store.ts`
- Test: `tests/sessions/process-lock.test.ts`, `tests/sessions/durable-store.test.ts`

**Interfaces (Produces):**
- `class ProcessLock` — `async withLock(resource: string, fn: () => Promise<T>, opts?): Promise<T>`:
  - قفل ملف حصري عبر `open(lockPath, 'wx')` (**O_EXCL** — الفوز بحصرية الإنشاء يضمن حصرية الملكية بين العمليات على نفس الملف).
  - Spin-retry بجitter (نافذة افتراضية 10 ثوانٍ) ثم `throw` فاضح.
  - الملف يضم `{pid, ownerInstanceId, acquiredAt}`؛ **استيلاء على قفل ميت فقط**: عمره > staleTtl (5 ثوانٍ) وpid أصله ميت (`process.kill(pid,0)`).
  - تحرير دائماً بـ finally.
- `readJson<T>(file): T | null` / `writeJsonAtomic(file, value)` — كتابة عبر tmp+rename داخل نفس الدليل.

**Steps:**
- [ ] 1. اختبارات in-process: قفل حصري (ثانية متوازية تُرفض/تنتظر)؛ تحرير بـ finally عند خطأ الدالة؛ استيلاء على قفل ميت (pid ميت مكتوب يدوياً)؛ قفل حي لعملية حية لا يُستولى عليه. **اختبار بين-عمليتين حقيقيتين**: spawn عمليتي `node` (سكربت مؤقت في tests/fixtures) تحاولان `withLock` على نفس المورد وتكتبان سطر نتيجة؛ فوز **واحدة بالضبط**. قراءة/كتابة ذرية: تالف → null؛ tmp يُنظَّف.
- [ ] 2. شغّل → FAIL → نفّذ → PASS.

### Task 2: Session Registry بإصدارات (كتابة عبر القفل)

**Files:**
- Create: `src/sessions/session-registry.ts`
- Modify: `src/arena/web-drivers.ts` — `saveSessionState` يحدّث السجل عبر `withLock` (read-modify-write ذري بين العمليات)، `restoreSessionState` يقرأه احتياطاً.
- Test: `tests/sessions/session-registry.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `interface EmoSessionRecord { sessionKey; providerId; profileId; conversationUrl; conversationId: string|null; lastRequestId: string|null; savedAt: number; version: number }`
  - `class SessionRegistry(storePath?)` — `async upsert(rec)`, `get(providerId, sessionKey)`, `attachRequest(providerId, sessionKey, requestId)`.
  - التخزين `~/.arena-webbridge/state/session-registry.json` (حد 5000، إزعاج LRU). **upsert عبر ProcessLock**: قراءة → مقارنة version (كتابة بنسخة أقدم من المخزنة تُرفض بصمت مع سجل) → كتابة ذرية، كل ذلك داخل القفل.
  - `conversationId` من رابط `/c/<uuid>` إن وُجد.

**Steps:**
- [ ] 1. اختبارات: upsert/get؛ رفض نسخة أقدم؛ persistence عبر instance جديد؛ قصّ فوق الحد؛ تكامل: saveSessionState في السائق يكتب سجلاً صحيحاً (mock driver).
- [ ] 2. شغّل → FAIL → نفّذ → PASS.

### Task 3: Browser Owner + Ownership Ledger (سياسة حصرية معلنة)

**Files:**
- Create: `src/browser/browser-owner.ts`
- Create: `src/sessions/ownership-ledger.ts`
- Modify: `src/arena/web-drivers.ts` — ensurePage/sendMessageSerialized.
- Test: `tests/browser/browser-owner.test.ts`, `tests/sessions/ownership-ledger.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ProcessLock`, `readJson`, `writeJsonAtomic`).
- Produces:
  - `class BrowserOwner` — `id` (instanceInstanceId+pid+uuid)، `epoch` (يتجدد عند إنشاء context)، `bumpEpoch()`, `verify(page, epoch)`.
  - `class OwnershipLedger(storePath?)` — ملف `~/.arena-webbridge/state/profile-ownership.json`، المدخل: `{profileDir, ownerInstanceId, pid, epoch, heartbeatAt}`.
    - `claimProfile(profileDir, ownerId)`: عبر ProcessLock — بلا مدخل → acquired؛ مدخل بpid ميت أو heartbeat أقدم من 30 ثانية → stolen (مع سجل)؛ غير ذلك → busy مع تفاصيل المالك.
    - `heartbeat(profileDir, ownerId)` (يُستدعى مع كل طلب) و`releaseProfile(profileDir, ownerId)` — **التحرير فقط من المالك نفسه** (رفض من غيره).
  - **السياسة المعلنة (حصرية):** عملية واحدة تملك كل profile؛ العملية الأخرى ترفض الطلب بأمان 503 مع `{ownerInstanceId, pid, heartbeatAt}` وتلميح إعادة المحاولة. **توجيه الطلبات بين العمليات غير منفذ** — يُوثَّق في التقرير كـ"جزئي" ولا يُعلن مكتملاً أبداً.
  - Lease داخل العملية: `acquireLease(resource, ttlMs=5min)/verifyLease/releaseLease/renewLease`.

**Steps:**
- [ ] 1. اختبارات Ledger: claim أول → acquired؛ pid ميت → stolen؛ heartbeat منتهي → stolen؛ حي → busy مع تفاصيل المالك؛ release من مالك آخر → مرفوض؛ من المالك → حر. Owner: epoch ثابت/يتجدد؛ verify بعد close → false. **اختبار عمليتين حقيقيتين** على نفس profile: واحدة acquired والأخرى busy.
- [ ] 2. شغّل → FAIL → نفّذ → PASS.
- [ ] 3. تكامل web-drivers: ensurePage عند إنشاء context → `bumpEpoch()` + claim (busy → خطأ 503 فاضح)؛ heartbeat مع كل sendMessageSerialized؛ verify قبل الإرسال وبعد waitForResponse.

### Task 4: عزل الجلسات (بصيغة مصححة)

**Files:**
- Create: `src/server/chat-session-key.ts` (نقل `chatSessionKey` من app.ts دون تغيير سلوك)
- Test: `tests/sessions/session-isolation.test.ts`

**Steps:**
- [ ] 1. اختبارات (mock driver عبر createServer): رأسان صريحان مختلفان + رسائل متطابقة → **جلسة** (sendMessage بمفتاحين مختلفين)؛ رأس صريح يتفوق على البصمة؛ غياب الرأس → بصمة مستقرة؛ طلبان بالبصمة نفسها من عميلين مختلفين (بدون رأس) → جلستان إذا عمّا أول-رسائل مختلفة، ومفتاح واحد إذا تطابقت تماماً (سلوك موثق بالبصمة — القيد المعلن).

### Task 5: Request Broker (واجهة صريحة المصائر)

**Files:**
- Create: `src/protocol/request-broker.ts`
- Modify: `src/server/app.ts` — `/v1/chat/completions` فقط.
- Test: `tests/protocol/request-broker.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `type RequestOutcome = 'completed'|'failed'|'unconfirmed'`
  - مفتاح النطاق: `idempotencyKey = sha1(apiKeyScope + providerId + X-Request-Id)` — عميلان (مفاتيح API مختلفة) بنفس القيمة لا يصطدمان.
  - `class RequestBroker` — `async begin(key, sessionKey): Begin` حيث `Begin = {allowed:true, complete(result), fail({retryable}), markUnconfirmed(reason)} | {allowed:false, state, result?}`.
    - التصنيف الآلي: بعد استدعاء `markSent()` الداخلي (يُستدعى عند قبول الإرسال للويب)، أي مسار خطأ يصبح `unconfirmed` **حتى لو** مرر المتصل `{retryable:true}` (يُسجل تجاوزاً). قبل الإرسال، fail(retryable) → `failed` ويسمح إعادة المحاولة.
    - الحالات محفوظة عبر ProcessLock في `~/.arena-webbridge/state/request-broker.json` (TTL 24h، حد 2000).
    - **إعادة النتيجة**: completed مع نتيجة ≤256KB → تُعاد للعميل (JSON: نفس الجسم؛ SSE: **إعادة بث النتيجة المخزنة** كسلسلة chunks مع `x-emo-replay: true` وتوثيق أنها إعادة بث مخزنة لا تنفيذ حي؛ النتيجة الأكبر من الحد → 409 مع `state:'completed'` وشرح). unconfirmed → 409 مع `{state:'unconfirmed', reason}` وتعليمات الفحص.
  - لا رأس `X-Request-Id` → لا idempotency (التداخل opt-in) لكن requestId يُولَّد ويُسجل دائماً.

**Steps:**
- [ ] 1. اختبارات: begin/complete → إعادة تعيد النتيجة؛ fail قبل الإرسال retryable → إعادة مسموحة؛ markSent ثم fail → **unconfirmed** وإعادة مرفوضة حتى لو retryable:true (تجاوز يُسجل)؛ markUnconfirmed → مرفوض؛ SSE replay يعيد البث المخزن؛ نطاق العميل يفصل المفاتيح؛ **اختبار عمليتين حقيقيتين** بنفس requestId في اللحظة نفسها → واحدة فقط تنفذ.
- [ ] 2. شغّل → FAIL → نفّذ → PASS.
- [ ] 3. تكامل app.ts: `markSent()` بعد قبول الإرسال في المسار الثلاثة (stream/no-tools/non-stream) — الربط عبر تمرير callback أو حالة مشتركة بسيطة.

### Task 6: صفحة لكل جلسة عبر Scheduler (إعادة استخدام TabWorkerPool)

**Files:**
- Create: `src/browser/tab-scheduler.ts`
- Modify: `src/arena/web-drivers.ts` — استبدال `queue` الواحد بقائمة لكل جلسة + صفحة لكل جلسة عبر Scheduler؛ **تمرير كائن Page الخاص بالجلسة عبر سلسلة العمليات كاملة** (sendMessageSerialized توقيعه يستقبل Page؛ كل الدوال المساعدة تأخذ page معاملاً — sendOnce/waitForResponse/clearComposer/fillComposer).
- Test: `tests/browser/tab-scheduler.test.ts`, `tests/sessions/session-queue.test.ts`

**Interfaces:**
- Consumes: Task 3 (leases)، `src/arena/tab-worker-pool.ts` (يُعاد استخدامه كما هو للسقف والانتظار).
- Produces:
  - `class TabScheduler` فوق `TabWorkerPool` (سبب التركيب: Pool يدير سقف الصفحات والwaiters والمواصفات مجرّبة باختباراتها؛ Scheduler يضيف ما يفتقده): `binding = Map<sessionKey, {tab, leaseId, lastUsedAt, inFlight}>`.
    - `async acquireFor(sessionKey)`: صفحة الجلسة المرتبطة إن حية (renewLease) → وإلا acquire من الPool.
    - **سياسة الإخلاء LRU**: عند امتلاء الحد، تُطرد أقدم جلسة **بلا طلب قيد التنفيذ وبلا lease نشط** — قبل التحرير: حفظ conversationUrl في SessionState + releaseLease؛ الجلسة المُبعدة تعيد الربط من conversationUrl عند طلبها التالي.
    - `release(sessionKey)` بعد انتهاء الطلب (يحدّث lastUsedAt؛ لا يحرر الصفحة ما دامت في الحد).
  - في BaseWebDriver: `sendMessage` ينفذ عبر `SessionQueue.run(providerId::sessionKey, ...)` ثم `scheduler.acquireFor(sessionKey)` → `sendMessageSerialized(page, ...)`؛ **لا استخدام لهذا.page في مسار الجلسة إطلاقاً** (يبقى للمسار القديم/السائقين المستقلين).

**Steps:**
- [ ] 1. اختبارات Scheduler (mock context/Pool كما في tab-worker-pool.test.ts): إعادة ربط نفس الجلسة بنفس الصفحة؛ إخلاء LRU لجلسة خاملة **لا** يطرد جلسة بطلب قيد التنفيذ/lease نشط؛ حفظ conversationUrl قبل الإخلاء.
- [ ] 2. اختبارات تزامن (mock pages تسجل هويتها): جلستان متزامنتان تنفذان **في اللحظة نفسها** على صفحتين مختلفتين؛ الجلسة الثالثة بحد=2 تنتظر؛ طلبان لنفس sessionKey عبر مسارين (محاكاة) يتسلسلان؛ إغلاق صفحة أثناء طابورها → استبدال بلا فقد ولا تنفيذ مكرر.
- [ ] 3. شغّل → FAIL → نفّذ → PASS. (السائقون المستقلون يبقون على السلوك القديم — حد موثق.)

### Task 7: توصيل sessionKey في كل المسارات

**Files:**
- Modify: `src/server/anthropic-routes.ts` (186/229)، `src/server/gemini-routes.ts` (351/422)، `src/server/swarm-coordinator.ts` (202)، `src/arena/routing-driver.ts` (55).
- Test: `tests/server/session-plumbing.test.ts`

**Interfaces:**
- Consumes: `chatSessionKey` من `src/server/chat-session-key.ts` (Task 4).
- Swarm key: `swarm-<swarmId>-<role>-<agentId|workerInstanceId>` — هوية العامل نفسه ضمن النطاق، حتى لا تندمج عدة وكلاء من الدور نفسه.

**Steps:**
- [ ] 1. اختبار: Anthropic/Gemini برأس صريح → المفتاح الصحيح يصل driver (المعامل الخامس)؛ Swarm مفتاح لكل agent.
- [ ] 2. شغّل → FAIL → نفّذ (5 مواضع تمرير) → PASS.

### Task 8: Regression + تحقق حي + التقرير

**Files:**
- Create: `IMPLEMENTATION_REPORT.md` (أقسام §10 كاملة)

**Steps:**
- [ ] 1. `npx vitest run` → 266+ قديمة + الجديدة كلها ناجحة.
- [ ] 2. تحقق حي: مهمة عبر OpenCode → session ثابت + دلتا + استعادة بعد إعادة تشغيل البوابة؛ إعادة X-Request-Id أثناء running → 409.
- [ ] 3. التقرير: Profile Owner Routing = **جزئي (سياسة حصرية معلنة + رفض آمن؛ بلا قناة توجيه بين العمليات)** — لا يُعلن مكتمل.

## Rollback

الطبقات الجديدة ملفات منفصلة؛ الرجوع = إزالة الاستيرادات وإعادة `queue` الواحدة في web-drivers.ts. ملفات الحالة الجديدة لا تقرأها النسخة القديمة — حذفها آمن.
