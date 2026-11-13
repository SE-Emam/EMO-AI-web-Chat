# IMPLEMENTATION REPORT — Session Ownership, Correlation & Request Broker

**التاريخ:** 2026-11-12 (محدث بعد Task 10 — توحيدًا مع `FINAL_PRE_COMMIT_AUDIT.md` §16 بتوجيه المالك)
**الخطة:** `docs/superpowers/plans/2026-11-12-emo-session-ownership-broker.md` (v2 — بتصحيحات المالك الست)
**التنفيذ:** Native (inline, وكيل واحد) — بلا worktree/branch switch، بلا git commits (مستودع المستخدم يحتوي تغييرات غير ملتزمة سابقة).
**سجل التنفيذ:** `.superpowers/sdd/2026-11-12-emo-session-ownership-broker/progress.md`

> **قيد معلن (حكم المالك):** Profile Owner Routing بين العمليات **غير مكتمل**. المتاح حاليًا هو سياسة الحصرية المعلنة (عملية واحدة تملك كل profile) مع الرفض الآمن 503 عند تعارض الملكية وتفاصيل المالك الكاملة — **بلا قناة توجيه فعلية بين العمليات**. التفصيل في §5.

---

## 1. النتيجة النهائية للاختبارات (بعد Task 10)

| المجموعة | العدد |
|---|---|
| الاختبارات الأصلية | 266 ناجحة + 2 skipped — **محفوظة بالكامل** |
| اختبارات جديدة (Tasks 1–9) | 65 |
| اختبارات جديدة (Task 10) | 8 — (5 لـ`ProcessLock.release` + 3 لـSwarm×Broker) |
| **الإجمالي النهائي** | **340 passed \| 2 skipped (342)** — `npx vitest run`، 35 ملفًا ناجحًا + 1 متخطى، 4.09s (مؤكد 2026-11-12 بعد Task 10، محفوظ في `test-results-final.txt`) |
| TypeScript | `tsc --noEmit` نظيف بلا أخطاء |

### اختبارات متعددة العمليات (حقيقية — child processes، لا mocks)
1. **ProcessLock race** (`tests/sessions/process-lock.test.ts`): عمليتان حقيقيتان متنافستان على نفس المورد في اللحظة نفسها → **فائز واحد بالضبط**، والاختبار الثاني يثبت التسلسل (كلاهما ينفذ بالتتابع).
2. **Ownership race** (`tests/fixtures/ownership-racer.ts`): عمليتان حقيقيتان تطالبان بنفس profile → **ACQUIRED واحدة + BUSY واحدة بتفاصيل المالك**.
3. **Broker race** (`tests/fixtures/broker-racer.ts`): عمليتان حقيقيتان تطالبان بنفس `requestId` → **ALLOWED واحدة + DENIED واحدة**.

---

## 2. الملفات المتغيّرة

### جديدة (9 — منها واحد منقول من وحدة قائمة)
| الملف | الدور |
|---|---|
| `src/sessions/process-lock.ts` | قفل حصري بين العمليات (O_EXCL + steal لقفل ميت فقط) + `lockFilePathFor` — **+ تقوية Task 10:** الـrelease يحذف فقط عند إثبات مطابقة `ownerInstanceId`؛ تلف/تعذر القراءة/مالك آخر → تحذير وترك الملف (لا امتلاك مزدوج) |
| `src/sessions/durable-store.ts` | `readJson` (تالف → null) / `writeJsonAtomic` (tmp+rename) |
| `src/sessions/session-registry.ts` | سجل جلسات دائم بإصدارات (رفض كتابة أقدم) + كاش mtime + حد قابل للتضبيط |
| `src/sessions/ownership-ledger.ts` | مطالبة/heartbeat/تحرير ملكية profile (تحرير من المالك فقط) |
| `src/sessions/session-queue.ts` | طابور لكل sessionKey (تسلسل داخلي، توازٍ بين الجلسات) |
| `src/browser/browser-owner.ts` | هوية عملية + epoch للتجسيد + `verify(page, epoch)` |
| `src/browser/tab-scheduler.ts` | TabScheduler فوق TabWorkerPool + LeaseTable + إخلاء LRU |
| `src/protocol/request-broker.ts` | claim-once بإخراج صريح: `complete/fail({retryable})/markUnconfirmed/markSent` |
| `src/server/chat-session-key.ts` | `chatSessionKey` — **منقول حرفياً من app.ts** (استخراج دون تغيير سلوك؛ لا طبقة جديدة) |

### معدَّلة (7)
| الملف | التغيير |
|---|---|
| `src/arena/web-drivers.ts` | `ensureContext()` (مطالبة الملكية + epoch)؛ `sendMessage` على طوابير الجلسات؛ `sendMessageSerialized` تستقبل صفحة الجلسة من الـScheduler ولا تستخدم `this.session` المشترك (12 مرجعاً استُبدلت بمتغير محلي `st`)؛ heartbeat + verify قبل الإرسال وبعد الانتظار؛ `saveSessionState` يعكس البيانات في السجل الدائم؛ إخلاء يحفظ `conversationUrl` |
| `src/arena/tab-worker-pool.ts` | getter `capacity` فقط (يُعاد استخدامه كما هو — لا نظامان متوازيان) |
| `src/server/app.ts` | الـBroker مربوط في `/v1/chat/completions` فقط؛ `chatSessionKey` مستورد من الوحدة الجديدة — **+ Task 10:** `markSent()` قبل أول عملية ذات أثر فعلي في السوارم المتدفق (`executeAsChatCompletion`)؛ فشل منتصف البث يُنهي SSE بنظافة (حدث خطأ + `[DONE]`) بدل اتصال معلق؛ مسارات OpenAI/Anthropic/Gemini وغير المتدفق لم تُمس |
| `src/server/anthropic-routes.ts` | تمرير sessionKey (المعامل الخامس) في المسارين (سطرا 186/229 سابقاً) |
| `src/server/gemini-routes.ts` | تمرير sessionKey في المسارين (351/422 سابقاً) |
| `src/server/swarm-coordinator.ts` | مفتاح لكل وكيل: `swarm-<swarmId>-<role>-<sliceId>` |
| `src/arena/routing-driver.ts` | تمرير sessionKey إلى السائق المطابِق |

### اختبارات وfixtures جديدة
`tests/sessions/{process-lock,durable-store,session-registry,ownership-ledger,session-queue,session-isolation}.test.ts`، `tests/browser/{browser-owner,tab-scheduler,session-pages}.test.ts`، `tests/protocol/request-broker.test.ts`، `tests/server/session-plumbing.test.ts`، `tests/server/swarm-stream-broker.test.ts` (Task 10)، `tests/fixtures/{lock-racer,lock-serial,ownership-racer,broker-racer}.ts`.

**تعديل على اختبارين قديمين (موثق):** `tests/server/anthropic-adapter.test.ts` (موضع واحد) و`tests/server/gemini-adapter.test.ts` (4 مواضع) كانا يتحققان من عقد 4 معاملات بـ`toHaveBeenCalledWith` — حُدِّثا ليضيفا `expect.any(String)` كمعامل خامس؛ نمو العقد كان هدف Task 7 عمداً.

---

## 3. التحقق الحي (فعلي، ضد chatgpt-web الحقيقي)

جميع الخطوات على `127.0.0.1:8989` بعد إعادة بناء `dist/` وإعادة تشغيل البوابة:

1. **Claim-once أثناء التنفيذ:** طلب بمفتاح `X-Request-Id: live-req-001` ثم تكراره بعد 4 ثوانٍ أثناء التوليد → **409** `request_already_claimed` مع `state: "running"`. ✔
2. **ملكية الـProfile حية:** `~/.arena-webbridge/state/profile-ownership.json` أثناء التشغيل يحوي `{ownerInstanceId, pid, epoch, heartbeatAt}` ويُحدَّث heartbeat مع كل طلب. ✔
3. **إعادة النتيجة بعد الاكتمال:** تكرار نفس `X-Request-Id` بعد الاكتمال → **نفس `chatcmpl-41f19241…` المخزن** (إعادة بث النتيجة المحفوظة، لا تنفيذ جديد). ✔
4. **الدلتا عبر المسار الجديد (Task 6):** جلستان متعاقبتان (`live-task-9`) بنفس تاريخ العميل → السجل: `Continuing existing chat session (+1 message(s))… Prompt: 76 chars (delta)` — نفس المحادثة، والإجابة صحيحة من سياقها. ✔
5. **رفض الاستمرار الصحيح:** عميل أرسل رسالة واحدة بلا تاريخ (curl) → `Continuation check: no` — رفض ثابت ومتوقع. ✔
6. **الاستعادة بعد إعادة تشغيل البوابة:** `Restored persisted session state (4 message(s), chat: …/6af514ce…)` → `Continuing existing chat session (+1 message(s))` بنفس المحادثة، والإجابة صحيحة. ✔
7. **سجل الجلسات الدائم:** `session-registry.json` يوثق `sessionKey | providerId | conversationUrl | version` لكل جلسة. ✔

---

## 4. حالة المتطلبات الست للمالك

| # | المتطلب | الحالة |
|---|---|---|
| 1 | ذرية بين العمليات بجهاز اختبار عمليتين حقيقيتين | **مكتمل** — ProcessLock (O_EXCL) + 3 اختبارات سباق بعمليات حقيقية |
| 2 | Profile Owner Routing | **جزئي** — انظر §5 |
| 3 | سياسة تحرير الصفحات (LRU + حفظ URL + حماية قيد التنفيذ) | **مكتمل** — TabScheduler فوق TabWorkerPool الموجود |
| 4 | تمرير صفحة الجلسة عبر السلسلة كاملة + اختبار تزامن فعلي | **مكتمل** — لا `this.page`/`this.session` مشتركة في مسار الجلسة؛ إثبات على مستوى السائق (صفحتان مختلفتان أثناء تنفيذ متزامن) |
| 5 | واجهة Broker الصريحة + قاعدة "بعد الإرسال ليس retryable" + نطاق requestId | **مكتمل** — الفشل بعد `markSent` يُرقّى إلى unconfirmed حتى مع `retryable:true` (العلامة تُخزَّن فتصمد لإعادة التشغيل) |
| 6 | الرأس الصريح دائماً يفوز؛ مفتاح Swarm بهوية الوكيل | **مكتمل** — `swarm-<swarmId>-<role>-<sliceId>` |

---

## 5. Profile Owner Routing — **منفذ ومُختبَر بعمليات child حقيقية (Task 11) — التحقق الحي على منتج حقيقي غير منفذ**

> **تحديث Task 11 (2026-11-12):** قناة التوجيه بين العمليات **نُفِّذت بالكامل** وفق تعديلات المالك الإلزامية الخمسة، وأُثبتت بمصفوفة اختبارات **عمليات Node حقيقية** (12 اختبارًا تغطي بنود المالك الـ14) بmock driver — بلا Playwright ولا شبكة ولا رسائل حية. التحقق الحي (عمليتا Gateway حقيقيتان مع متصفح/ChatGPT على جهاز المستخدم) **لم يُنفذ** — يتطلب تفويضًا صريحًا.

**المعمارية المنفذة:**
- **القناة:** loopback HTTP على `127.0.0.1` (منفذ عابر) — `src/ipc/profile-owner-transport.ts`. المصادقة برمز عشوائي 32-byte لكل عملية في `x-emo-ipc-token`، مقارنة **ثابتة الزمن** (`timingSafeEqual` مع حماية الطول). الرمز + endpoint في ملف جانبي `state/owner-ipc/<sha1(profileDir)>.json` بصلاحية **0600** (POSIX؛ Windows: ACLs افتراضية — موثق). `413` عند تجاوز 16MB، رفض redirect (لا يتبع أبدًا)، رفض endpoint غير loopback عند العميل، حارس socket-level لـ127.0.0.1.
- **الحجز الذري (تعديل 1):** `RequestBroker.attachForExecution(key, executor)` — أول استدعاء فقط يحجز تحت ProcessLock ويسجل `ExecutionAttachment` الدائم (`executorInstanceId/executorEpoch/executorPid/forwardId/executionToken/attachedAt/sentAt`)؛ المكرر → `already_attached` بلا تنفيذ ثانٍ؛ نفس `forwardId` من نفس المنفذ → إقرار idempotent بنفس الرمز؛ كل تحديث حالة لاحق محمي بالإثبات (مطابقة فاشلة → تحذير بلا أسرار + no-op).
- **`accepted` (تعديل 2):** الترتيب: حجز ذري دائم → `accepted` → تنفيذ. ضياع الحدث ليس دليلًا: القرار بعد أي انقطاع من المخزن الدائم عبر `settleForwardFailure` — بلا إرفاق → `failed(retryable)`؛ إرفاق بلا `sentAt` + مالك ميت → مسح الإرفاق + `retryable`؛ `sentAt` مضبوط → `unconfirmed`؛ مالك حي → `unconfirmed`. `sentAt` المالك هو الدليل الحاسم (علم `sent` المحافظ للمستقبل قبل التوجيه لا يخفي فشل ما قبل الإرسال). مهلة IPC وحدها لا تعيد تنفيذًا أبدًا.
- **نقطة التدخل (تعديل 3):** `OwnerRoutingDriver` بـResolver **ديناميكي** يُستدعى لكل طلب — يغطي `getActiveDriver()` بعد تبديل الحسابات ومسارات `RoutingDriver`. `ProfileBusyError` بنيوي (`src/arena/profile-busy-error.ts`) غير قابل للفشل-over (لا تبديل مزود صامت على تعارض ملكية). ربط الإنتاج في `app.ts` (فئة C) + إدارة دورة حياة المالك `OwnerIpcManager` في `web-drivers.ts` (بعد claim ناجح؛ إيقاف عند الإغلاق؛ فشل البدء يتراجع إلى الرفض الآمن القديم).
- **هوية الموارد (تعديل 4):** `realpath` normalization لأقرب سلف موجود (عمليتان تسميان نفس الـprofile لا تصبحان حكمين)؛ بصمة المخزن الدائم في الملف الجانبي — عدم اشتراك العمليتين في نفس مخزن الـBroker → **رفض التوجيه** لا ادعاء زائف. Backpressure صريح (`write()===false` → `drain`) طرفَي القناة؛ مهلة خمول قابلة للضبط تُصفَّر مع كل مقطع — بلا مهلة إجمالية ثابتة.

**دليل الاختبار (قابل لإعادة التشغيل):** `npx vitest run tests/ipc/` — 25 اختبارًا (9 وحدة transport + 6 وحدة router + 10 مصفوفة عمليات حقيقية): بنود المالك 1–14 كاملة، منها: تنفيذ عند المالك مرة واحدة والنتيجة تعود للعميل؛ تسلسل نفس الجلسة وتوازي جلستين؛ SSE بترتيب مقاطع محفوظ عبر العمليتين؛ موت قبل الإرسال → `failed(retryable)` من المخزن الدائم ثم إعادة محاولة ناجحة؛ موت بعد الإرسال → `unconfirmed` والطلب المكرر مرفوض؛ heartbeat متأخر → `busy` مع العلم وقاعدة Task 9 محفوظة والتوجيه يعمل؛ epoch قديم → رفض بلا تنفيذ؛ الاستيلاء بعد موت مثبت → `stolen`؛ إعادة إرسال نفس الأمر → تنفيذ واحد + Replay من النتيجة المخزنة.

**ما نُفِّذ (المرحلة 1 — سياسة حصرية معلنة، ما زالت سارية كخط دفاع):**
- عملية واحدة فقط تملك كل profile (`claimProfile` عبر قفل بين العمليات).
- العملية الأخرى تُرفض بأمان: خطأ `503 profile in use by another gateway process` (الآن `ProfileBusyError` بنيوي) يتضمن `ownerInstanceId` و`pid` و`epoch` و`heartbeatAt` وتلميح إعادة المحاولة، ويُغلق الـcontext الذي أطلقته — وعند تفعيل التوجيه تُحوَّل إلى العملية المالكة بدل الرفض.
- **قاعدة الاستيلاء (مصحّحة بتوجيه المالك — 2026-11-12):** الاستيلاء فقط بعد **إثبات موت المالك** (pid ميت). تأخر heartbeat >30 ثانية **لا يمنح حق الاستيلاء** — قد تكون العملية حية تنفذ دور ChatGPT طويلاً. الحالة (حي + heartbeat متأخر) تُرفَض بـ`busy` مع إشارة تحذير `staleHeartbeat: true` ومراقبة سجلّية — وليست استيلاءً. لهذا وُجد اختبار عملية حقيقية: مالك حي + heartbeat متأخر 120 ثانية → busy لا stolen.
- التحرير من المالك نفسه فقط؛ heartbeat مع كل طلب.
- سجل الملكية يضم `ownerInstanceId` و`pid` و`epoch` و`heartbeatAt` — كلها متحقق عليها حياً (§3.2).

**آلية استعادة معلنة (لعملية متوقفة لا تزال حية ظاهرياً):** لا استيلاء تلقائي. المسار الآمن هو إجرائي: يتحقق المشغّل يدوياً أن العملية معلقة فعلاً، ثم يحذف ملف/مدخل السجل، فتطالب العملية الثانية بحرية. خط دفاع أخير موجود أصلًا: قفل Playwright singleton على دليل الـprofile يمنع إطلاق متصفحين على نفس الملفات. حالة حدية موثقة: إعادة استخدام الـpid من قبل نظام التشغيل قد تجعل مالكاً متوقفاً يبدو حياً — الاستعادة حينها تمر بالإجراء اليدوي أعلاه فقط.

**ما لم يُنفَّذ (بقي بعد Task 11):** التحقق الحي على منتج حقيقي — عمليتا Gateway فعلية على جهاز المستخدم مع متصفح/ChatGPT حقيقي. طبقة التوجيه نفسها منفذة ومُختبرة بعمليات child حقيقية (أعلاه). أي نشر فعلي يبدأ بعد تفويض المالك وتشغيل عمليتي Gateway حقيقيتين.

---

## 6. دلالات إعادة النتائج (موثقة)

- **JSON:** نتيجة مكتملة ≤256KB → تُعاد كما خُزِّنت (نفس body). أكبر من ذلك → 409 مع `state:'completed'` وشرح أن النتيجة أكبر من حد الإعادة.
- **SSE:** إعادة البث من النتيجة المخزنة مع رأس `x-emo-replay: true` — **إعادة بث مخزن، ليست تنفيذاً حياً**.
- **running → 409** مع `state:'running'`. **unconfirmed → 409** مع `reason` وتعليمات الفحص اليدوي؛ لا إعادة تنفيذ أعمى أبداً.
- **failed** ممكنة فقط قبل الإرسال — بعدها كل فشل يصبح unconfirmed تلقائياً (التجاوز يُسجَّل تحذيراً).
- **Swarm المتدفق (Task 10):** `markSent` يُطلق قبل `executeAsChatCompletion` — أول عملية يمكن أن تسبب أثرًا فعليًا في محادثات الوكلاء. فشل بعدها (منتصف البث بما فيه انقطاع العميل) → `unconfirmed` دائمًا، لأن انبعاث chunk لا يثبت ما فعله الوكلاء داخليًا؛ كل ما قبلها → `failed` (retry). عند الخطأ بعد بدء SSE يُنهى البث بنظافة (حدث `error` + `[DONE]`) — لا اتصال معلق.
- **النطاق:** `sha1(apiKeyScope + provider + X-Request-Id)` — عميلان بمفاتيح مختلفة لا يصطدمان. غياب الرأس = لا idempotency (opt-in) مع بقاء توليد الطلب وتسجيله.

## 7. القيود المعروفة المتبقية

1. **التوجيه بين العمليات: منفذ ومُختبَر بعمليات child حقيقية** (§5) — المتبقي: التحقق الحي على عمليتي Gateway حقيقيتين (يتطلب تفويض المالك).
2. **السائقون المستقلون** (zai/qwen/gemini/claude-web بملفاتهم الخاصة) يبقون على الطابور أحادي الصفحة القديم — حد موثق في الخطة؛ واجهة `ArenaDriver` تمرر sessionKey إليهم الآن لكنهم يتجاهلونها.
3. إعادة بث SSE المخزنة تعيد النتيجة النهائية كقطعة واحدة (ليس توقيت الأجزاء الأصلي) — مقصود وموثق.
4. ملفات حالة الجلسات تُكتب بالطريقة القديمة (متزامنة بلا قفل) بينما السجل الدائم والملكية والBroker عبر القفل — نافذة تضارب نظري ضيقة في `saveSessionState` لم تُغيَّر عمداً لأنها best-effort والسجل الجديد هو المرجع. **بقاؤها في قائمة المخاطر:** أي تغيير مستقبلي في سياسة الملكية يجب أن يراجع تداخل الكتابة هنا أولًا.
5. **استعادة مالك معلق لا يزال حياً ظاهرياً** تمر بإجراء يدوي موثق (تحقق المشغّل + حذف مدخل السجل) — لا استيلاء تلقائي؛ إعادة استخدام الـpid من OS حالة حدية يعالجها هذا الإجراء فقط (قفل Playwright singleton على دليل الـprofile خط دفاع أخير).
6. **سباق `evictOne` النظري** (تنظيف الخطوط المنتهية في `session-queue.ts` لا يعمل فعليًا + سباق الإخلاء النظري — تدقيق §5): تحليل مصدري دقيق بلا اختبار حتى الآن؛ يستحق اختبارًا مستقبليًا (توجيه المالك بعد Task 10).
7. **اختبار Swarm×Broker يقرأ حالة الـBroker بعد انتهاء `inject`** — تسجيل الحالة غير متزامن عن نهاية الاستجابة (سباق اختبار وليس عيب كود؛ الاختبار الأول ينتظر الحالة بـ`vi.waitFor` والثاني يقرأها بعد فشل مسجّل مسبقًا). ثلاث تشغيلات متتالية ناجحة (3/3 × 3)؛ الملاحظة موثقة في التقرير وسجل التنفيذ (توجيه المالك: تبقى مفتوحة للمراقبة).

## 8. Rollback

الطبقات الجديدة ملفات منفصلة؛ الرجوع = إزالة الاستيرادات وإعادة الطابور الواحد في `web-drivers.ts`. ملفات الحالة الجديدة (`session-registry.json`, `profile-ownership.json`, `request-broker.json`) لا تقرأها النسخة القديمة — حذفها آمن.

---

## 9. Task 12 — Unified Request Broker (OpenAI + Anthropic + Gemini)

> **تحديث Task 12 (2026-11-12):** طبقة Idempotency موحدة عبر المسارات الثلاثة فوق **الـRequestBroker نفسه** (نفس المخزن + ProcessLock + ExecutionAttachment + markSent/complete/fail/markUnconfirmed + حرس هوية الـexecutor من Task 11) — **لا broker موازٍ ولا مخزن جديد**.

### ما نُفِّذ

1. **`src/server/request-broker-helpers.ts` (جديد) — الطبقة المشتركة:** `payloadFingerprint` (sha256 كانوني: ترتيب مفاتيح ثابت، ترتيب arrays محفوظ، هوية البروتوكول مشمولة، لا أسرار)، `brokerScopedKey` (`brokerKey(apiKeyScope, '<protocol>:<providerId>', requestId)` — عزل بروتوكولي: استهلاك replay عبر البروتوكولات مستحيل بالبناء)، `beginBrokeredRequest` (دورة none/execute/replay/conflict/denied واحدة)، `completeBrokered/failBrokered/markSentBrokered/markUnconfirmedBrokered`. صفر منطق broker مكرر داخل الـRouters؛ محولات الردود بقت منفصلة لكل بروتوكول.
2. **`src/protocol/request-broker.ts`:** `begin(key, sessionKey, fingerprint?)` — مطابقة بصمة مختلفة على مدخل قائم (أي حالة) → `{allowed:false, conflict:true, reason:'idempotency_key_reused_with_different_request'}`؛ البصمة تُخزَّن في المدخل الجديد؛ مدخل `failed` يُفرج عن المطالبة كما قبل. توافق Task 11 كامل (attachForExecution/settleForwardFailure لم تُمس).
3. **`src/server/anthropic-routes.ts` + `src/server/gemini-routes.ts`:** الخيار `broker?`؛ المطالبة قبل أي وصول للسائق (فشل ما قبل الإرسال يحرر المطالبة)؛ `markSent` قبل كل `sendMessage` (مطابقة سياسة OpenAI/Task 10)؛ `complete` يخزن `{content, nativeReplay}` حيث `nativeReplay` هو **جسم البروتوكول الأصلي حرفيًا** (Anthropic: كائن `message` كامل؛ Gemini: كائن `candidates` كامل؛ التدفق: `{id, model, text}` يُعاد بناؤه بالمُنسِّقات الأصلية — فروق التقطيع موثقة). Replay JSON وSSE بصيغة أصله مع `x-emo-replay: true`. خطأ 409 بصيغة البروتوكول: conflict (`invalid_request_error` / `ABORTED` مع نص السبب) وdenied (`request_already_claimed` / `ALREADY_EXISTS` مع `state`/`reason`).
4. **`src/server/app.ts`:** تمرير نفس `requestBroker` إلى المسارين (سطران)؛ مسار OpenAI **لم يُلمس** (سلوكه وكلماته للردود كما هي؛ مفتاحه `brokerKey(scope, model, requestId)` بلا تغيير — لا تصادم مع المفاتيح البروتوكولية).

### الأدلة

- **النتيجة:** **429 passed | 2 skipped (431)** × 3 جولات متتالية (خط الأساس 382 + **49 اختبارًا جديدًا**)، `tsc --noEmit` نظيف، محفوظة في `test-results-task12.txt`. المخزن الحقيقي للمستخدم `~/.arena-webbridge/state/request-broker.json` (mtime 03:19) و`profile-ownership.json` (03:36) لم يُلمسا، و`state/owner-ipc/` فارغ.
- **الاختبارات الجديدة (49):** helpers 15 (بصمة كانونية شاملة لكل خيارات البروتوكولات الثلاثة + عزل النطاق + دورة الحياة + مدخل قديم + oversized + عابر للعمليات)؛ Anthropic 13 (العشرة الإلزامية + SSE-replay + unconfirmed + oversize + restart)؛ Gemini 13 (نفسها بصيغة أصله)؛ cross-protocol 3 (نفس X-Request-Id بين بروتوكولين → مطالبات مستقلة، أجسام لا تتقاطع؛ مدخل قديم بلا بصمة → replay دون ادعاء كشف فروق، وغير مرئي للبروتوكول الآخر)؛ **عمليات حقيقية** 5 (`tests/fixtures/broker-fingerprint-racer.ts`): سباق عمليتين بنفس المفتاح+البصمة → ALLOWED واحدة/DENIED:running واحدة، conflict عبر العمليات، replay بعد خروج العملية المنفذة (مكافئ إعادة تشغيل المالك) بنجاة nativeReplay، oversized عبر العمليات → DENIED `too large to replay` بلا نتيجة مخزنة، مدخل قديم عبر العمليات → replay دون كشف فروق.
- **الأدوات:** replay يحفظ الجسم الأصلي حرفيًا → معرفات الأدوات وربط النتائج محفوظة بالبناء، والسائق لا يُستدعى ثانيًا (Anthropic اختبار 10، Gemini اختبار 10). النتيجة المخزنة إعادة بثّ لا تنفيذ.
- **unconfirmed بعد markSent:** انقطاع SSE الحقيقي (خادم HTTP فعلي + fetch + abort عميل، اختبار 5 لكل بروتوكول) → unconfirmed → إعادة الإصدار 409 دون تنفيذ ثانٍ.

### قيود Task 12 المتبقية

1. ~~**مسار OpenAI لم يضف بصمة الفروق بعد**~~ — **أُغلق في Task 12.1 (2026-11-12):** مسار OpenAI يمر الآن عبر `payloadFingerprint(body, 'openai')` (بعد فرض نموذج المجموعة المُ Scoped) — نفس `X-Request-Id` مع payload مختلف → 409 صريح بنفس رمز السبب `idempotency_key_reused_with_different_request` عبر الواجهات الثلاث، ولا replay صامت ولا تنفيذ. مفتاح OpenAI بقى `brokerKey(scope, model, requestId)` بلا تغيير (لا يتامى مدخلات). المدخلات الجديدة تخزن البصمة (sha256-64hex، مُختبَر). المدخل القديم بلا بصمة يبقى replay كما كان (توافق موثق). ترويسة `x-emo-replay` أُضيفت لـreplay الـJSON غير المتدفق في OpenAI — عقد موحد عبر الواجهات الثلاث (الجسم لا يتغير). اختبارات: `tests/server/openai-fingerprint.test.ts` (4). 439 total.
2. فروق تقطيع/توقيت SSE في إعادة البث (قطعة واحدة) موثقة سلفًا (§7-3) وتنطبق على المسارات الثلاثة.
3. التحقق الحي على منتج حقيقي (Anthropic/Gemini حقيقيان) لم يُنفذ — مثل Task 11 يتطلب تفويض المالك.

---

## 10. Task 12.1 + Task 13 — توحيد دلالات X-Request-Id + إدارة جلسات السائقين المستقلين

> **تحديث (2026-11-12):** بتفويض المالك بعد إغلاق Task 12: **(1)** Task 12.1 — الدلالة نفسها لـX-Request-Id عبر الواجهات الثلاث (بصمة + Conflict صريح على OpenAI)؛ **(2)** Task 13 — إدارة جلسات السائقين المستقلين بإعلان قدرات صريح، بلا أي تحقق حي (يبقى خطوة تشغيلية مستقلة).

### Task 12.1 — ما نُفِّذ
- `src/server/app.ts`: `begin(..., payloadFingerprint(body, 'openai'))` + فرع `claim.conflict` (409 بنفس رمز السبب الموحد) + ترويسة `x-emo-replay` على replay JSON غير المتدفق.
- اختبارات: `tests/server/openai-fingerprint.test.ts` — conflict موحد، تخزين البصمة، legacy بلا بصمة → replay، replay مع بصمة محفوظة (باستثناء حقل `created` الزمني — سلوك Task 9 القائم).

### Task 13 — ما نُفِّذ (فحص مصدري أولًا ثم شفافية)
- **الفحص المصدري (من الكود):** `BaseWebDriver` (chatgpt-web، tencent-ai-web يرثه، إضافة grok/kimi/minimax) يملك آلية Task 6 كاملة (SessionQueue + TabScheduler صفحة لكل جلسة + SessionState دائم + استعادة رابط المحادثة). **zai/qwen/gemini/claude web** سائقون مستقلون: صفحة واحدة مشتركة، طابور وعد عالمي، محادثة جديدة لكل طلب، وsessionKey كان **يُتجاهل بصمت** (4 معاملات).
- **`src/arena/driver-capabilities.ts` (جديد):** `SessionSupport` كقيمة معلنة (4 أنماط) + `DriverCapabilities` + `SerializedSessionSendQueue` (نفس تسلسل الطابور القديم حرفيًا مع تمرير sessionKey وتوثيقه في السجل) + نصوص القيود القياسية.
- **السائقون الأربعة المستقلون:** `sendMessage(..., sessionKey = 'default')` — sessionKey **يصل أعمق طبقة** (مُختبَر عبر رصد `sendMessageSerialized`)؛ `getCapabilities()` تُعلن `serialized-per-session` / `persistentConversation: false` / `streaming: true` / `toolCalling: false` بملاحظات صريحة: الصفحة المشتركة تجعل الجلسات المختلفة تتسلسل أيضًا، والسياق يُستعاد لكل طلب بتاريخ كامل في البرومبت، ولا استعادة رابط محادثة ويب (لم يُدّعَ ما لا يوجد).
- **`BaseWebDriver.getCapabilities()`:** `per-session-page` / `persistentConversation: true` / `streaming: true` — موروثة لكل سائقين مجدولي الصفحات.
- **لا Selectors ولا تسجيل دخول ولا TabScheduler مفروض على بنية غير متوافقة** — حدود الموثقة في `docs/provider-capabilities.md`.
- **المصفوفة:** `docs/provider-capabilities.md` مملوءة من `getCapabilities()` + الاختبارات، بجدول «ما لم يُدّعَ» صريح.
- **إصلاح سباق اختباري (بلا إضعاف):** البند 11 من مصفوفة Task 11 (heartbeat متقادم) كان يتذبذب تحت حمل المجموعة لأن fixture المالك يكتب heartbeat كل 200ms ويطغى على القيمة المقادَمة؛ أصبح الفاصل قابلًا للتهيئة (`heartbeatIntervalMs`) والبند يطلق المالك بفاصل 10s — التأكيدات كما هي. 3 جولات كاملة متتالية خضراء بعدها.

### الأدلة (Task 12.1 + 13)
- **النتيجة:** **437 passed | 2 skipped (439)** × 3 جولات متتالية (Task 12: 431 + 12.1: 4 + Task 13: 4 = 439)، `tsc --noEmit` نظيف، محفوظة في `test-results-task13.txt`. المخزن الحقيقي للمستخدم لم يُلمس (mtimes 03:19/03:36)، و`owner-ipc/` فارغ. لا commit.
- **اختبارات جديدة (8):** `openai-fingerprint.test.ts` (4) + `arena/driver-capabilities.test.ts` (4: إعلانات القدرات لستة سائقين، تمرير sessionKey لأعمق طبقة في الأربعة، دلالات SerializedSessionSendQueue بما فيها منع التداخل عبر الجلسات وعدم تسمم المسار بالأخطاء).
- **المسار الوسطي:** `المسارات → RoutingDriver → driver.sendMessage(…, sessionKey)` يصل الآن إلى `SessionQueue+TabScheduler` (المجدولون) أو `SerializedSessionSendQueue` (المستقلون) — لا تجاهل صامت في أي طبقة.

---

## 11. Task 14 — Provider Resilience + Health Monitoring (2026-11-12)

> **تحديث (2026-11-12):** بتفويض المالك بعد اعتماد Task 12.1/13 (خط الأساس 437 passed | 2 skipped (439)). الهدف: تشخيص أعطال المزودين وحماية المحادثات من الضياع والتنفيذ المكرر — **ليس** تجاوز قيود ChatGPT أو إصلاح أعطاله الخارجية.

### ما نُفِّذ

**1) التصنيف المركزي — `src/arena/provider-failures.ts` (جديد):**
- الرموز العشرة + `ProviderFailure` {code, phase, sent, confirmedResult, retryable, markUnconfirmed, retryAfterMs?}.
- **القاعدة الأساسية:** لا retryability دون فحص المرحلة + `markSent`. pre-send بثبوت عدم التنفيذ → retryable (NETWORK_TIMEOUT/PROVIDER_UNAVAILABLE فقط)؛ إرسال ممكن + نتيجة غير قابلة للإثبات → `NETWORK_UNKNOWN_AFTER_SEND` + unconfirmed، بلا إعادة إرسال تلقائية أبدًا؛ timeout مع نتيجة مؤكدة → يبقى NETWORK_TIMEOUT غير unconfirmed؛ timeout مرحلة الاستعادة → CONVERSATION_RESTORE_FAILED (لا محادثة جديدة تلقائية)؛ abort قبل الإرسال → PROVIDER_UNAVAILABLE غير retryable، بعد إرسال → unconfirmed.
- **حد الثقة:** RATE_LIMITED/QUOTA_EXHAUSTED برمز واضح أو HTTP 429/402 أو page marker مؤكد فقط — **النص الغامض وحده → PROVIDER_UNAVAILABLE**؛ كود الحصة يتفوق على صياغة rate limit (الحصة ليست حدًا مؤقتًا).
- `parseRetryAfter` (ثوانٍ/تاريخ HTTP؛ يرفض سالب/صفر/ضخم/ماضٍ/غير قابل للتحليل؛ حد أقصى قابل للتهيئة 10 دقائق افتراضيًا) — القيمة الصالحة تظهر على الفشل `retryAfterMs` مع عدم إعادة الإرسال تلقائيًا (رسالة عميل توضح الوقت المقترح).
- `ProviderFailureError` (يحمل التصنيف عبر حدود المسارات) · `buildDiagnostics` (§G: requestId/sessionKey منقّح-24/providerId/profileId/ownerInstanceId/workerId/epoch/failureCode/phase/requestState/durationMs/sent/confirmed + إزالة حقول الأسرار ومحتوى المحادثة + تعتيم Bearer/sk-) · `ResilienceRegistry` (آخر فشل/نجاح لكل مزود لكل عملية).
- `BREAKER_COUNTABLE`: العائلة العابرة فقط — يستثني AUTH_REQUIRED/QUOTA_EXHAUSTED/RATE_LIMITED (سياسة، لا تُعالج بالتكرار أو التبديل).

**2) Circuit Breaker — `src/arena/circuit-breaker.ts` (جديد):**
- مفتاح `(providerId, profileDir)`؛ CLOSED→OPEN (عتبة)→HALF_OPEN (probe واحد)→CLOSED عند النجاح؛ فشل الـprobe يعيد الفتح.
- **بين العمليات:** probe بإيجار {pid, token, acquiredAt} في ملف حالة ذري (rename) تحت `ProcessLock` — عمليتان حقيقيتان تتسابقان على `startProbe` لمفتاح واحد → واحدة فقط تُمنح (اختبار child-process حقيقي)؛ إيجار ميت/منتهي يُستولى عليه لا جمود.
- **لا يلغي الطلبات الجارية أبدًا** (لا واجهة إلغاء)؛ الحالة دائمة عبر مثيلات/عمليات على نفس الملف؛ عزل كامل بين المفاتيح؛ الأخطاء غير العابرة (AUTH/QUOTA/RATE) وغير المعروفة (إدخال مستخدم/أدوات) لا تفتح الدائرة.
- قابل للتهيئة: `EMO_BREAKER_THRESHOLD` (5) / `EMO_BREAKER_RECOVERY_MS` (30s) / `EMO_BREAKER_STATE_PATH` (~/.arena-webbridge/state/breaker-state.json) — القراءة لا تنشئ الملف أبدًا.

**3) سياستها في `src/arena/routing-driver.ts` (تعديل):**
- بضعة ثوانٍ من النتيجة: RATE_LIMITED/AUTH_REQUIRED/QUOTA_EXHAUSTED/PROFILE_OWNER_UNAVAILABLE → **إعادة رمي فورية، لا failover** (لا تبديل مزود/حساب صامت؛ الحصص لا تُتجاوز بالتوجيه)؛ فشل بعد إرسال ممكن (sent=true) → لا failover (لا إرسال مكرر).
- الفشل العابر المثبت (pre-send retryable) → failover كما كان؛ الأخطاء العامة العادية تحافظ على سلوك failover القديم بالكامل (حارس انحدار).
- بوابة breaker قبل كل محاولة: مسار OPEN يُتخطى للطلبات الجديدة فقط؛ تسجيل آخر فشل/نجاح في ResilienceRegistry.

**4) القياسات + `/health` (`src/server/app.ts`، `usage-tracker.ts`، `session-queue.ts`، `request-broker.ts`):**
- `UsageTracker.inFlightCount()` و`SessionQueue.globalWaitingCount()` و`RequestBroker.countByState()` — قراءة فقط، إضافية.
- `/health` موسع من مصادر **محلية فقط**: gateway (alive/uptime/browserServiceRunning) · profileOwnership · ipc · providers (لكل مسار: breakerState/lastFailureCode/lastFailureAt/lastFailureSent/lastSuccessAt/**providerState: 'not_checked' دائمًا**) · broker counts (unconfirmed) · requests (inFlight/queuedWaiting) · ملاحظة صريحة «التحقق من المزود: not_checked — /health لا يرسل رسائل للمزودين». **لا رسالة اختبار إلى ChatGPT** (عدّاد استدعاءات driver ثابت خلال الطلب)، **بلا أسرار** في الاستجابة.
- اختباران قديمان كانا يقارنان جسم /health بالتطابق التام — حُدّثا للتحقق من الحقول الثابتة + وجود المقاطع الجديدة (بلا إضعاف: 200 + status + service + المقاطع).

**5) Config — `providerTimeoutsMs {accept: 30s, stall: 90s, total: 300s}` افتراضيات محافظة قابلة للتهيئة؛ المهلة الإجمالية لا تعيد تنفيذ رسالة مرسلة (توثيق: فرضها على مستوى كل driver يبقى تدريجيًا).**

**6) `getProfileDir?()` على عقد ArenaDriver + `BaseWebDriver` + السائقين المستقلين الأربعة** (نصف مفتاح breaker)؛ `cli.ts` يبني BreakerRegistry مشترك الملف + ResilienceRegistry ويمررهما لـRoutingDriver.

### الاختبارات (TDD: فشل أولًا للسبب الصحيح ثم تنفيذ)

| ملف | العدد | يغطي |
|---|---|---|
| `tests/arena/provider-failures.test.ts` | 38 | الرموز العشرة، المراحل (pre/post/awaiting/restore)، timeout معروف vs مجهول، Retry-After صالح/غير صالح، RATE vs QUOTA vs AUTH، BREAKER_COUNTABLE، buildDiagnostics بلا أسرار، ResilienceRegistry |
| `tests/arena/circuit-breaker.test.ts` | 12 | العتبة/الفتح/الرفض، عدم إلغاء الجاري، HALF_OPEN probe واحد، إغلاق عند النجاح، إعادة الفتح، استيلاء على إيجار ميت، استثناء السياسات، العزل، الديمومة، **سباق probe بعمليتين حقيقيتين** (fixture `tests/fixtures/breaker-probe-racer.ts`) |
| `tests/arena/routing-resilience.test.ts` | 9 | RATE/AUTH/QUOTA بلا تبديل صامت، sent=true بلا failover، ProfileBusyError كما هو، failover يبقى للعابر المثبت + الانحدار القديم، تخطي مسار OPEN، عدم إلغاء الجاري |
| `tests/gateway/health-endpoint.test.ts` | 4 | /health محلي فقط، لا استدعاء مزود، not_checked، breaker OPEN يظهر، بلا أسرار/محتوى |
| `tests/arena/resilience-metrics.test.ts` | 2 | inFlightCount وعداد الانتظار العام |

### الأدلة والنتائج
- **502 passed | 2 skipped (504)** × 3 جولات متتالية (437 أساس محفوظة كاملة + 65 جديد)، `tsc --noEmit` نظيف، محفوظة في `test-results-task14.txt`.
- المخزن الحقيقي: `request-broker.json` mtime **03:19 بلا لمس**؛ `owner-ipc/` فارغ؛ **لا ملف breaker-state.json** (القراءات لا تنشئه). ملاحظة أمانة: `profile-ownership.json` يتغير mtime بسبب **عملية gateway حية للمستخدم (pid 91170، تعمل منذ ~ساعتين) تجدد heartbeat الخاص بها** — ليست من اختبارات هذه المهمة (كلها مسارات مؤقتة).
- لا commit / لا add / لا reset — لا وثائق Selectors ولا تسجيل دخول مُعدّلة.

### Mock فقط (لم يُتحقق منه حيًّا) — صريح
- كل الأعطال (429/quota/auth/timeout/stall/selector) بـfixtures ومحاكاة — **لا rate limit حقيقي على أي حساب**.
- لم يُتحقق حيًّا: سلوك 429 حقيقي من ChatGPT/Anthropic/Gemini، Retry-After حقيقي، شكل أخطاء صفحات الحصص الفعلية، وفرض المهلات الثلاث داخل كل driver.
- منطق unconfirmed مربوط بالتصنيف وبـRoutingDriver؛ مسار إكمال `completeProbe` يُستدعى من التكامل عند توفر نقطة النجاح/الفشل (الاختبارات تغطي المنطق).

### المخاطر المتبقية
1. فرض `providerTimeoutsMs` داخل كل سائق web (قبول/خمول/إجمالي) تنفيذ تدريجي لاحق — القيم معلنة الآن.
2. أنماط الرسائل/الأكواد للكشف (AUTH/QUOTA/STALL) قابلة للتحسين بعد **تحقق حي مفوض** بأخطاء المنتجات الحقيقية.
3. RATE_LIMITED معلن للعميل برمز ووقت مقترح لكن **الانتظار التلقائي** (بدل الرفض الفوري) مقصودًا غير منفذ — الإرسال الآلي لا يتم إطلاقًا بعد إرسال ممكن.
4. حالات breaker عبر عمليات متعددة تعتمد على سلامة ملف الحالة (كتابة ذرية rename + قفل) — سلوك التلف الودي غير مُختبر شمولًا.

**توقّف هنا بانتظار قرار المالك قبل Task 15.**

---

## 12. P2 — Unsupported External Dependency Claims (2026-11-12)

> **نوع المهمة:** تحقيق + إصلاح محدود بـTDD. **Gateway 8989 ممنوع لمسه (التزمتُ).** P1 Deployment: HOLD (لم يُمس). P3/Task 15: لم يبدأ.
> **الهدف:** ألّا يختلق النموذج اعتمادًا على خدمة/عميل خارجي غير موجود ضمن الأدوات المعلنة في الطلب الحالي — دون تغيّر معمارية Tool Calling، ودون تنفيذ أي أداة داخل EMO.

### 1. السبب المثبت لسلوك النموذج
- **من جانب EMO: سليم.** العبارتان «Chat On Steroids» و«Tunnel Client» لا تظهران في أي نص يُرسل للنموذج (فحص مصدري كامل + مسح 23 نتيجة Broker + 9 ملفات جلسات سائق + ثنائية OpenCode: صفر ظهور). أداة `read` كانت تصل فعلًا (النموذج سماها بنفسه، وعرف أن `shell`/`patch` غير موجودتين).
- **من جانب النموذج/الحساب:** المنشأ من طرف النموذج — أول ذكر حدث في جلسة "هلا" (دردشة عادية) **قبل وجود أي ورود للعبارة في سياقها** (فحص آلي: صفر رسالة سابقة تحتويها في كل جلسات الظهور)؛ والاسم الكامل «Chat On Steroids» كان قد ظهر في سياق مستخدم سابق (رابط المستودع المرجعي) على حساب ChatGPT — أي استرجاع ذاكرة/معرفة تدريبية لا تلوث سياق EMO.

### 2. المصدر: تعليمات أم تاريخ أم سلوك نموذج؟
**سلوك نموذج + ذاكرة حساب** — لا تعليمات ولا تاريخ EMO. التفصيل في §3 أدناه. histories العميل (نُدوات تصحيحية نقلت السرد) ساءدت على **تثبيت** الانحراف بعد ظهوره، لا على إحداثه.

### 3. نتيجة مراجعة التعارض الزمني (§10) — قراءة فقط
توحيد الطوابع: كل الطوابع epoch-ms، و`date -r` (مصدر الحقيقة) = EET (UTC+2)، و`sqlite localtime` يطابقه تمامًا؛ و`sqlite 'utc'` بعد `localtime` يعطي انزياحًا مزدوجًا (خطأ ترتيب المُعدِّل لا خطأ بيانات). **التصحيح عن تقريري السابق:** رسالة «المستودع المرجعي» عند **02:43 EET** (قبل أول ذكر بـ3.8 ساعة) لا «بعده بـ3 دقائق» — كنت قد خلطت بين عرض UTC وEET. التسلسل الصحيح (EET): أمس 19:18 رابط المستودع → اليوم 02:43任务 المرجعي → 06:33–06:40 أول ذكر للنموذج → 06:48 مهمة إصلاح → 17:22–17:25 نُدوات تصحيحية → 18:21/18:33 طلبات الاعتماد → 18:40 مهمة التحقيق. كما تبيّن أن **ساعة النظام تغيّرت أثناء العمل** (06:52 → 19:12 EET)، فلم أعتمد على أي وقت مطلق — الترتيب فقط.

### 4. الملفات والدوال المعدّلة (مصدر المشروع + اختباراته فقط)
| الملف | التغيير |
|---|---|
| `src/server/tool-interpreter.ts` | (أ) سطران محايدان في تعليمات الأدوات؛ (ب) `detectUnsupportedDependencyClaim` (تصنيف + بصمة sha1-16 بلا نص خام)؛ (ج) `buildNeutralCorrectionMessage`؛ (د) `shouldAttemptNeutralCorrection` (سياسة المحاولة الواحدة)؛ (هـ) `deriveToolLifecycleState` + `isUnsupportedAssistantClaim` |
| `src/server/tool-pipeline-logger.ts` | أحداث جديدة: `tool_available_in_request`, `unsupported_dependency_claim_detected`, `neutral_correction_attempted`, `transport_failure_confirmed` |
| `src/server/app.ts` | ربط المسار OpenAI (JSON): تسجيل الأحداث، سياسة المحاولة التصحيحية الواحدة، تصحيح نصي محايد، **لا قناع لأخطاء النقل الحقيقية**، وبلا تصحيح عند وجود Tool Result حقيقي |
| `src/arena/tool-bridge-markers.ts` (جديد) | علامة مشتركة + `isNeutralCorrectionMessage` + `stripNeutralCorrections` |
| `src/arena/web-drivers.ts` | سطر واحد: رسالة التصحيح (أُصدرت من EMO) **لا تُخزَّن** في سجل العميل → بوابة الاستكمال لا تنكسر |
| `tests/server/tool-resilience-policy.test.ts` (جديد) | 36 اختبارًا (§8) |

### 5. الفرق بين التوجيه السابق والجديد
- **السابق:** "الأدوات متاحة… نفّذها عبر ```tool_call```" فقط — بلا حدّ معلن لما هو **غير** متاح، وبلا تمييز بين "فشل تنفيذ حقيقي" و"ادعاء اتصال".
- **الجديد (سطران محايدان، مرة واحدة لكل جلسة):** «الأدوات المعلنة في هذا الطلب هي مجموعة الأدوات الكاملة المتاحة حاليًا؛ والعميل المستدعي يوفّر بيئة تنفيذها ويعيد نتائجها الحقيقية» + «لا تطلب من المستخدم تثبيت أو تشغيل أو توصيل أي مكوّن خارجي ليس ضمن الأدوات المعلنة، ولا تدّعِ مشكلة اتصال لم تؤكدها نتيجة تنفيذ فعلية». **بدون** اسم أي مشروع خارجي و**بدون** تكرار نص الرفض الخاطئ.
- **التصحيح التصحيحي (محايد، لا يكرر الادعاء):** «الأدوات المعلنة متاحة الآن… إذا كانت المهمة تحتاج أداة فأصدر ```tool_call``` … لا تطلب أي مكوّن خارجي غير معلن ولا تذكر مشكلة اتصال لم تؤكدها نتيجة تنفيذ».

### 6. نتائج اختبارات TDD (36 اختبارًا جديدًا)
- **التعليمات:** تأكيد حدود المجموعة الكاملة، منع طلب مكوّن خارجي، **صفر** ظهور لاسم المشروع/نص الرفض، عدم التكرار (marker dedupe).
- **tool_choice:** `none` بلا حقن/تحليل/تصحيح؛ `auto` يسمح بإجابة عادية (بلا تصحيح)، ويسمح بمحاولة واحدة عند ادعاء عدم توفر البيئة، ولا يفرض Tool Call؛ `required` يفشل بخطأ البروتوكول بعد استنفاد المحاولة (ولا يمرّر الرفض كنجاح)؛ أداة محددة لا تقبل أداة أخرى (`specific_tool_not_called`).
- **الأخطاء:** ادعاء غياب أداة مع وجود `read` معلنة → ادعاء غير مثبت؛ ادعاء فشل اتصال بلا خطأ Dispatcher → غير مثبت؛ فشل نقل مؤكد → `TRANSPORT_FAILURE_CONFIRMED` (يُحفظ كخطأ حقيقي)؛ نجاح تنفيذ مؤكد → `TOOL_EXECUTION_CONFIRMED`؛ Tool Call غير صالح → خطأ بروتوكولي؛ Tool Result لا يصل → الحالة تبقى قبل التأكيد (بلا تأكيد زائف).
- **التاريخ:** ادعاء Assistant غير مدعوم يُكتشف فقط دون فشل تنفيذ مثبت؛ رسائل المستخدم/نتائج الأدوات/الرفض الأمني لا تُمس؛ الدالة **نقية** (لا تعدّل المُدخل).
- **التزامن/Idempotency:** جلستان منفصلتان (لا تداخل)، طلبان متزامنان (محاولة واحدة لكل طلب)، استدعاء واحد لا يُنفذ مرتين، وفشل مجهول المصير بعد الإرسال → نفس `X-Request-Id` **مرفوض 409** (لا إعادة إرسال عمياء) — مُختبَر على الـBroker الحقيقي (مخزن مؤقت).

### 7. عدد الاختبارات: قبل → بعد
`620 passed | 2 skipped (622)` → **`656 passed | 2 skipped (658)`** (‎+36 ملف جديد؛ صفر انحدار). ملاحظة: المستودع تحرّك **بشكل متزامن** من عمليتين خارجيتين (`tool-calling-pipeline.test.ts` 13:04، `graceful-shutdown.test.ts` 17:19) — خط الأساس قبل عملي كان 504؛ القياس قبل/بعد أعلاه على نفس الحالة.
`tsc --noEmit`: نظيف. ثلاث جولات متتالية خضراء. النتائج في `test-results-p2-tool-resilience.txt`.

### 8. الاختبار الحي (§9): `NOT_RUN`
غير متاح في هذه المرحلة: لا مزود حي معزول، والبوابة الحية تتطلب مفتاح API (لا أستخرجه)، وتشغيل اختبار حي يعني رسالة حقيقية لحساب المستخدم خارج "بيئة اختبار معزولة". **لم أستبدل ذلك بادعاء نجاح.** ما تم هو **قبول على مستوى المسار بنموذج محاكى (mock)**: أداة `read` فقط → ظهور تعريف الأداة → Tool Call ← Tool Result بالمعرّف الأصلي → استكمال النموذج — وبحث تأكيد أن دور `assistant` محفوظ وأن رسالة التصحيح مستثناة من سجل العميل.

### 9. تأكيد عدم مس Gateway 8989
لم أعدّله ولم أُعد تشغيله ولم أبنِ dist ولم أنفّذ git. العملية الحية الحالية (pid 86948) **أُعيد تشغيلها 19:15:55 من عمل متزامن خارجي** — أي أن تغييراتي (التي بدأت بعدها) غير محمّلة في العملية الجارية، وبيانات المستخدم لم تُمس. نسخ احتياطية للملفات المعدّلة في مجلد مؤقت خارج المستودع.

### 10. القيود والمخاطر
1. **السبب الجذري خارج EMO** (سلوك نموذج/ذاكرة حساب) → الإصلاح يقلّل الاستعداد ويوفّر مسار تعافٍ محايد، ولا يضمن زوال السلوك. الحالة النهائية تعكس ذلك.
2. المسار المتدفق (SSE): **لا** محاولة تصحيحية (الرد مُبثَّر مسبقًا) — التصنيف والتسجيل فقط.
3. مسارات Anthropic/Gemini لم تُمس (نطاق ChatGPT Web).
4. تعديل الـdriver (سطر واحد) لم يُختبر على متصفح حي — غلافه (helper نقي) مُختبَر.
5. إعادة الإرسال اليدوي لـ tool call سابق لنفس الطلب ممنوعة سياسيًا (لا تنفيذ مزدوج).

### 11. الحالة النهائية
**`MODEL_BEHAVIOR_STILL_UNSTABLE`** — تحصين EMOside مكتمل ومُختبَر (تعليمات محايدة + سياسة محاولة واحدة + تصنيف قائم على الأدلة + سجلات منظمة)، لكن السبب الجذري سلوك نموذج/ذاكرة حساب، **والاختبار الحي `NOT_RUN`**، فلا يصحّ ادعاء أن الدورة أصبحت مستقرة.

---

## 13. P2 — Finalization & Technical Handoff (2026-11-12)

> **الحالة:** P2 IMPLEMENTED — NOT DEPLOYED. المراجعةFin review أُجريت على الكود القائم **دون تغيير سلوك** (تعديل واحد: تصحيح تعليق مُثبت خطؤه).

### 1. السبب الذي تعالجه P2
ChatGPT Web sometimes يطلب تشغيل/فتح مكوّن خارجي غير موجود ضمن أدوات الطلب الحالي، رغم وصول الأدوات وتنفيذها فعليًا. P2 يعالج **عرض النموذج** للبيئة: (أ) تعليمات محايدة تُعلن حدود الأدوات المتاحة، (ب) سياسة محاولة تصحيحية واحدة مبنية على الأدلة لا على نص النموذج، (ج) فصل صريح بين «ادعاء» و«فشل نقل حقيقي»، (د) سجلات منظمة. السبب الجذري سلوك نموذج/ذاكرة حساب — خارج EMO.

### 2. الملفات والدوال المعدلة
`src/server/tool-interpreter.ts` · `src/server/tool-pipeline-logger.ts` · `src/server/app.ts` · `src/arena/tool-bridge-markers.ts` (جديد) · `src/arena/web-drivers.ts` (سطر واحد) · `tests/server/tool-resilience-policy.test.ts` (جديد، 36).

### 3. تعديل جديد بعد التقرير السابق
**نعم — تعديل واحد فقط، تعليق (بلا تغيير سلوك):** في فرع SSE داخل `app.ts` كان التعليق يدّعي «البث سلّم الرد قبل القرار» — وهو **مثبت خطأً**: هذا الفرع يجمع الرد كاملًا (`full += chunk`) ولا يكتب أي بايت للعميل قبل `ensureHeaders()` بعد قرار الأدوات. استُبدل التعليق بوصف دقيق: «النقطة الآمنة متاحة هنا تقنيًا، لكن P2 نطاقه المسار غير المتدفق». لم تُضَف أي وظيفة جديدة.

### 4. نتائج الاختبارات (أرقام جديدة فعلية بعد التجميد)
| الفحص | النتيجة |
|---|---|
| `npx vitest run tests/server/tool-resilience-policy.test.ts` | **36 passed (36)** |
| `npx vitest run` (كامل، 3 جولات متتالية) | **656 passed \| 2 skipped (658)** — 56 ملفًا ممرًّا + 1 متخطى |
| `npx tsc --noEmit` | نظيف (exit 0) |

لا انزياح عن الأرقام المرجعية؛ لا عمل متزامن بعدة الفحص (ملفا العمل الخارجي `tool-calling-pipeline`/`graceful-shutdown` مُدرجان أصلًا في العدّاد).

### 5. مراجعة البنود العشرة — كلها محقّقة
1) مرجع الأدوات = الطلب الحالي (سطر «complete, currently available toolset») ✓ · 2) ادعاء النموذج لا يُعامَل كفشل نقل (`transportFailureObserved` يُشتق من الأدلة، والادعاء يُسجّل كـ`unsupported_dependency_claim_detected`) ✓ · 3) فشل النقل الحقيقي لا يُخفى (يُعاد رميه في catch التصحيح مع `transport_failure_confirmed`) ✓ · 4) التصحيح لا يتجاوز tool_choice (none بلا حقن؛ auto بلا إجبار؛ required/specific ينتهيان بخطأ البروتوكول) ✓ · 5) محاولة واحدة لكل طلب (كتلة `if` واحدة، بلا حلقة) ✓ · 6) الرفض الأمني لا يتحول إلى استدعاء إجباري (لا تنفيذ داخل EMO أصلًا، والتصحيح مشروط) ✓ · 7) Tool Result حقيقي يمنع التصحيح (`hasToolResultEvidence`) ✓ · 8) Tool Call لا يُنفذ أكثر من مرة (لا تنفيذ في EMO + الأداة تُعاد مرة واحدة) ✓ · 9) رسائل التصحيح لا تكسر الاستمرارية (تُستثنى من السجل المخزن فقط، ودور assistant محفوظ للمحاذاة) ✓ · 10) البصمة SHA-1-16 فقط في السجل (بلا نص خام) ✓.

### 6. قيد Streaming — توثيق (§3)
- **مقصود؟** نعم كقرار نطاق: التصحيح مُطبَّق على المسار غير المتدفق فقط.
- **هل ببثٍ مبكر؟** **لا** — في فرع SSE **مع أدوات** الرد مُجمَّع بالكامل ولا يُكتب للعميل قبل قرار الأدوات، أي أن **نقطة آمنة موجودة تقنيًا** بلا إعادة تصميم بث. أما فرع SSE **بلا أدوات** فالبث حيّ، لكن لا عقد أدوات فيه فلا حاجة لتصحيح.
- **الأثر على OpenCode:** **معدوم عمليًا** — سجل البوابة الحيّ يُظهر مرور OpenCode على `chatgpt-web:default` بـ`stream=false` (10 طلبات) مقابل `stream=true` (طلب واحد) — أي أن الاستخدام الفعلي يمرّ بالمسار المُطبَّق.
- **خطر ظهور الرفض كإجابة نهائية:** **نعم** في مسار SSE (يُبثّ النص ثم `stop`)، وكذلك في المسار JSON إن فشل التصحيح نفسه (يُعاد نص النموذج). القاعدة: لا يُخفى فشل حقيقي ولا يُعاد تصنيفه، لكن يمكن للعميل رؤية نص الاعتماد كإجابة.
- **الحل الممكن بلا إعادة تصميم:** (أ) تطبيق نفس كتلة التصحيح في فرع SSE المُجمَّع (نقطة آمنة مثبتة)؛ (ب) في المسار JSON: عند اكتشاف ادعاء وفشل التصحيح، إرجاع خطأ/تحذير منظّم بدل نص الاعتماد كإجابة نهائية. **لم يُنفَّذ أيٌّ منهما** (freeze) — مُقترحان للمراجعة.

### 7. حدود الإصلاح
- السبب الجذري خارج EMO (سلوك نموذج/ذاكرة حساب) → يُقلَّل الاستعداد ولا يُضمن زوال السلوك.
- المسار المتدفق بلا محاولة تصحيحية (نطاق).
- مسارات Anthropic/Gemini لم تُمس.
- **تحذير مُصنَّف (غير مُصلَح):** صياغة رفض أمني مثل «I cannot access files for safety reasons» تُصنَّف `execution_channel_unavailable` → تُطلق نُدوة محايدة واحدة تحت `auto` (لا تنفيذ ولا إجبار). تحسين مقترح: استثناء نصوص الرفض الأمني من مسار التصحيح (يتطلب قرار مالك).
- **ملاحظة نظافة سجل (سابقة لـP2):** `app.ts` يسجّل ذيل الرد (‎`fullResponse.slice(-250)`‎) عند فشل تحليل tool_call — قد يعكس نص ادعاء في السجل؛ لم يُمسّ (سلوك سابق) ويُقترح تدقيقه.

### 8. الأدلة على عدم تعديل dist
أحدث ملف داخل `dist/` تاريخه **2026-11-12 17:58:51** — **قبل** تعديلات P2 المصدرية (19:36–20:05). لم يُنفَّذ أي build في هذه المهمة، و`dist/` لا يمسّه شيء من عملي.

### 9. الأدلة على عدم لمس Gateway 8989
العملية `pid 86948` قائمة منذ **19:15:55** (بلا إعادة تشغيل؛ uptime متزايد) و`/health` يعيد **200**. لم أعدّله ولم أوقفه ولم أبنِ ولم أنفّذ git. تعديلاتي (20:05) **غير محمّلة** في العملية الجارية — لن تُفعَّل إلا بإعادة تشغيل يقرّرها المالك.

### 10. الحالة
**`P2_SOURCE_READY_FOR_INTEGRATION_REVIEW`** — المصدر مكتمل ومُختبَر (36 اختبارًا جديدًا + كامل المجموعة + TypeScript نظيف)، بلا تغيير سلوك بعد التقرير السابق عدا تصحيح تعليق واحد، والاختبار الحي ما زال `NOT_RUN`.
