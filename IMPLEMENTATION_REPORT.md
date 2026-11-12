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

## 5. Profile Owner Routing — **جزئي (لا يُعتبر مكتملاً)**

**ما نُفِّذ (سياسة حصرية معلنة):**
- عملية واحدة فقط تملك كل profile (`claimProfile` عبر قفل بين العمليات).
- العملية الأخرى تُرفض بأمان: خطأ `503 profile in use by another gateway process` يتضمن `ownerInstanceId` و`pid` و`heartbeatAt` وتلميح إعادة المحاولة، ويُغلق الـcontext الذي أطلقته.
- **قاعدة الاستيلاء (مصحّحة بتوجيه المالك — 2026-11-12):** الاستيلاء فقط بعد **إثبات موت المالك** (pid ميت). تأخر heartbeat >30 ثانية **لا يمنح حق الاستيلاء** — قد تكون العملية حية تنفذ دور ChatGPT طويلاً. الحالة (حي + heartbeat متأخر) تُرفَض بـ`busy` مع إشارة تحذير `staleHeartbeat: true` ومراقبة سجلّية — وليست استيلاءً. لهذا وُجد اختبار عملية حقيقية: مالك حي + heartbeat متأخر 120 ثانية → busy لا stolen.
- التحرير من المالك نفسه فقط؛ heartbeat مع كل طلب.
- سجل الملكية يضم `ownerInstanceId` و`pid` و`epoch` و`heartbeatAt` — كلها متحقق عليها حياً (§3.2).

**آلية استعادة معلنة (لعملية متوقفة لا تزال حية ظاهرياً):** لا استيلاء تلقائي. المسار الآمن هو إجرائي: يتحقق المشغّل يدوياً أن العملية معلقة فعلاً، ثم يحذف ملف/مدخل السجل، فتطالب العملية الثانية بحرية. خط دفاع أخير موجود أصلًا: قفل Playwright singleton على دليل الـprofile يمنع إطلاق متصفحين على نفس الملفات. حالة حدية موثقة: إعادة استخدام الـpid من قبل نظام التشغيل قد تجعل مالكاً متوقفاً يبدو حياً — الاستعادة حينها تمر بالإجراء اليدوي أعلاه فقط.

**ما لم يُنفَّذ:** قناة توجيه فعلي بين العمليات (تحويل الطلب إلى العملية المالكة لتنفيذه هناك). العملية الثانية تُرفَض ولا تُوجَّه. هذه فجوة معروفة وموثقة؛ تحتاج IPC منفصلاً (مثلاً socket/queue مشترك) ولم تكن في نطاق هذه الدفعة.

---

## 6. دلالات إعادة النتائج (موثقة)

- **JSON:** نتيجة مكتملة ≤256KB → تُعاد كما خُزِّنت (نفس body). أكبر من ذلك → 409 مع `state:'completed'` وشرح أن النتيجة أكبر من حد الإعادة.
- **SSE:** إعادة البث من النتيجة المخزنة مع رأس `x-emo-replay: true` — **إعادة بث مخزن، ليست تنفيذاً حياً**.
- **running → 409** مع `state:'running'`. **unconfirmed → 409** مع `reason` وتعليمات الفحص اليدوي؛ لا إعادة تنفيذ أعمى أبداً.
- **failed** ممكنة فقط قبل الإرسال — بعدها كل فشل يصبح unconfirmed تلقائياً (التجاوز يُسجَّل تحذيراً).
- **Swarm المتدفق (Task 10):** `markSent` يُطلق قبل `executeAsChatCompletion` — أول عملية يمكن أن تسبب أثرًا فعليًا في محادثات الوكلاء. فشل بعدها (منتصف البث بما فيه انقطاع العميل) → `unconfirmed` دائمًا، لأن انبعاث chunk لا يثبت ما فعله الوكلاء داخليًا؛ كل ما قبلها → `failed` (retry). عند الخطأ بعد بدء SSE يُنهى البث بنظافة (حدث `error` + `[DONE]`) — لا اتصال معلق.
- **النطاق:** `sha1(apiKeyScope + provider + X-Request-Id)` — عميلان بمفاتيح مختلفة لا يصطدمان. غياب الرأس = لا idempotency (opt-in) مع بقاء توليد الطلب وتسجيله.

## 7. القيود المعروفة المتبقية

1. **التوجيه بين العمليات غير منفذ** (§5) — الرفض الآمن فقط.
2. **السائقون المستقلون** (zai/qwen/gemini/claude-web بملفاتهم الخاصة) يبقون على الطابور أحادي الصفحة القديم — حد موثق في الخطة؛ واجهة `ArenaDriver` تمرر sessionKey إليهم الآن لكنهم يتجاهلونها.
3. إعادة بث SSE المخزنة تعيد النتيجة النهائية كقطعة واحدة (ليس توقيت الأجزاء الأصلي) — مقصود وموثق.
4. ملفات حالة الجلسات تُكتب بالطريقة القديمة (متزامنة بلا قفل) بينما السجل الدائم والملكية والBroker عبر القفل — نافذة تضارب نظري ضيقة في `saveSessionState` لم تُغيَّر عمداً لأنها best-effort والسجل الجديد هو المرجع. **بقاؤها في قائمة المخاطر:** أي تغيير مستقبلي في سياسة الملكية يجب أن يراجع تداخل الكتابة هنا أولًا.
5. **استعادة مالك معلق لا يزال حياً ظاهرياً** تمر بإجراء يدوي موثق (تحقق المشغّل + حذف مدخل السجل) — لا استيلاء تلقائي؛ إعادة استخدام الـpid من OS حالة حدية يعالجها هذا الإجراء فقط (قفل Playwright singleton على دليل الـprofile خط دفاع أخير).
6. **سباق `evictOne` النظري** (تنظيف الخطوط المنتهية في `session-queue.ts` لا يعمل فعليًا + سباق الإخلاء النظري — تدقيق §5): تحليل مصدري دقيق بلا اختبار حتى الآن؛ يستحق اختبارًا مستقبليًا (توجيه المالك بعد Task 10).
7. **اختبار Swarm×Broker يقرأ حالة الـBroker بعد انتهاء `inject`** — تسجيل الحالة غير متزامن عن نهاية الاستجابة (سباق اختبار وليس عيب كود؛ الاختبار الأول ينتظر الحالة بـ`vi.waitFor` والثاني يقرأها بعد فشل مسجّل مسبقًا). ثلاث تشغيلات متتالية ناجحة (3/3 × 3)؛ الملاحظة موثقة في التقرير وسجل التنفيذ (توجيه المالك: تبقى مفتوحة للمراقبة).

## 8. Rollback

الطبقات الجديدة ملفات منفصلة؛ الرجوع = إزالة الاستيرادات وإعادة الطابور الواحد في `web-drivers.ts`. ملفات الحالة الجديدة (`session-registry.json`, `profile-ownership.json`, `request-broker.json`) لا تقرأها النسخة القديمة — حذفها آمن.
