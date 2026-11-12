# IMPLEMENTATION_BASELINE.md — خط الأساس قبل دمج آليات Chat-on-steroids

> تاريخ الفحص: 2026-11-12. نتيجة الاختبارات الفعلية قبل أي تعديل:
> `npx vitest run` → **266 passed | 2 skipped (268)** — 23 ملف اختبار ناجح، 1 متخطى.

## 1. خريطة الملفات والوظائف الحالية

| الوظيفة | الملف | الملاحظات الدقيقة |
|---|---|---|
| نقطة تشغيل الخادم (Gateway) | `src/emo-ai.ts` | منفذ 8989 على 127.0.0.1، `createServer({mode:'gateway', manager,...})`، إغلاق نظيف على SIGINT/SIGTERM |
| نقطة تشغيل قديمة (CLI) | `src/cli.ts:158-245` | `createServer(driver, config)` بوضع direct-driver عبر `RoutingDriver` — لا يمرر sessionKey |
| استقبال `/v1/chat/completions` | `src/server/app.ts:315` | مسارا JSON وSSE داخله |
| استخراج `sessionKey` | `src/server/app.ts:37-47` `chatSessionKey()` | أولوية `X-Chat-Session-ID` → `metadata.session_id` → بصمة sha1 (النظام+أول رسالة user) |
| إنشاء/استعادة جلسة ChatGPT | `src/arena/web-drivers.ts` `sendMessageSerialized` (سطر ~311) | متابعة بالبادئة (`msgKey` سطر 364)، استئناف رابط المحادثة المحفوظ (سطر 430)، دلتا فقط (سطر 465) |
| صفحات Playwright | `src/arena/web-drivers.ts` `ensurePage` (سطر 1045) | سياق دائم واحد + صفحة واحدة لكل سائق، reuse عند عدم الإغلاق |
| Tab Worker Pool | `src/arena/tab-worker-pool.ts` | **كود ميت** — لا يستورده أي ملف في `src/`، يُغطى فقط بـ `tests/tab-worker-pool.test.ts` |
| Browser Profiles | `src/arena/providers.ts:31-45` (`profileDir`)، `src/gateway/config-store.ts:26` | `~/.arena-webbridge/<provider>-profile` لكل مزود؛ حسابات إضافية: `<id>-profile-<accId>` (provider-manager.ts:413) |
| إطلاق المتصفح | `launchPersistentContext` في `src/browser/manager.ts:91-129` و`web-drivers.ts:1058-1072` | قناة chrome مع fallback إلى chromium، أعلام مضادة للكشف، تنظيف `SingletonLock` اليتيم (`cleanupStaleProfileLocks`) |
| تبديل الحسابات | `provider-manager.ts` `switchAccount` (سطر 440) | `stop()` لتحرير قفل الملف الشخصي ثم إعادة توجيه `userDataDir`؛ التشغيل الكسول عند الطلب التالي |
| توزيع النماذج | `provider-manager.ts` facade (سطر 1115-1155) | الراوتر: `sendRouterGroupMessage` → `sendToRouterTarget` → `sendToWebTarget` → `driver.sendMessage(..., sessionKey)` |
| Tool Calling | `src/server/tool-interpreter.ts` | مصدر وحيد للتحليل `parseToolCallsFromResponse`، حقن التعليمات، محاولة تصحيحية عند الرد المشوّه (web-drivers.ts ~569) |
| حالة الجلسة الدائمة | `web-drivers.ts:186-282` | `SessionState {lastSentMessages, sessionChatUrl, restored}`، ملفات `~/.arena-webbridge/state/driver-sessions/<id>__<hash>.json`، TTL 7 أيام |
| SSE والأخطاء | `src/server/app.ts:425-560` | hijack + writeHead يدوي، abort عبر AbortSignal |

## 2. دورة الطلب الحالية (من HTTP حتى الرد)

```
HTTP → Fastify (auth key) → buildMessages/redactSecrets
     → injectToolsInstruction (إذا tools) → chatSessionKey(request, body, messages)
     → ProviderManager facade.sendMessage(model, messages, onChunk, signal, sessionKey)
     → (راوتر؟) → sendToWebTarget → switchAccount/start (withLock) → driver.sendMessage
     → BaseWebDriver.queue (سلسلة promise واحدة — تسلسل كامل لكل سائق)
     → sendMessageSerialized: getOrCreateSession(sessionKey) → فحص متابعة بالبادئة
       → (متابعة؟) delta فقط | (جديد؟) prompt كامل → sendOnce (تحقق قبول) → waitForResponse
       → parseToolCalls → formatToolCallChunks/Response → حفظ الحالة بعد النجاح فقط
```

## 3. التعامل مع الطلبات المتزامنة اليوم

- **قفل واحد لكل سائق**: `queue` promise-chain في `web-drivers.ts:197/303` يسلّط كل الطلبات (من كل sessionKeys) على **صفحة واحدة** بالترتيب — آمن لكن بلا توازٍ بين الجلسات، وكل تبديل مهمة = تنقّل بين محادثات.
- **قفل Provider**: `withLock` (provider-manager.ts:620) يغلف دورة الحياة فقط (start/stop/refresh/login) — `sendMessage` يعمل خارجه عمداً.
- **لا توجد**: ملكية متصفح، lease، requestId، claim-once، طابور لكل جلسة، epoch.
- Swarm/Subagents: كل الوكلاء يصبّون في قائمة السائق نفسها.

## 4. ثغرات مؤكدة (تم التحقق منها عملياً في هذه الجلسة، ليست افتراضات)

1. **مسارات بلا sessionKey**: `/v1/messages` (Anthropic)، `/v1beta/*` (Gemini)، Swarm، `RoutingDriver` — كلها تسقط في `'default'` فتختلط محادثات عملاء مختلفين على نفس المزود.
2. **لا requestId ولا claim-once**: إعادة إرسال العميل بعد انقطاع نفّذت برومبتاً كاملاً في محادثة جديدة (12272 حرفاً) رغم أن المحادثة السابقة سليمة — تكرار تنفيذ محتمل لأمر أُرسل فعلاً.
3. **مسح الحالة عند أي فشل** (كان في `catch`): حول كل فشل عابر إلى جلسة جديدة مكلفة — أُصلح في هذه الجلسة (الحالة الآن تنجو من الفشل)، ويوثّق هنا كقرار معماري معتمد.
4. **انتظار أعمى 300 ثانية** عند "قبول بلا نشاط توليد" — أُضيف حارس صمت 60 ثانية مع تلميح سقف الاستخدام من نص الصفحة (منشور في dist).
5. **كتابة غير ذرية**: `fs.writeFileSync` مباشرة في `saveSessionState` — خطر تلف الملف عند انهيار أثناء الكتابة.
6. **TabWorkerPool ميت**: مبدأ "لا تحذفه" مطبق، لكنه غير مدمج؛ التوازي بين الجلسات غير موجود.
7. **لا epoch**: اكتشاف إعادة تشغيل المتصفح يعتمد على `page.isClosed()` فقط.

## 5. قرارات معمارية سارية (لا تُكسر)

- تحديد الجلسة: معرّف صريح (`X-Chat-Session-ID`/`metadata.session_id`) أولوية دائمة؛ البصمة fallback فقط.
- الرسالة الاصطناعية للجسر (nudge + tool-results note) لا تُخزَّن ولا تُقارن أبداً (`isBridgeNote`).
- فشل الدور لا يمسح الحالة الدائمة (self-healing بفحص البادئة).
- `tool_call_id` يُحفظ، تعدد tool_calls مدعوم، مطابقة أسماء دقيقة بلا تخمين.
- privacyMode يعطّل كل آليات الاستمرار (سلوك مقصود).

## 6. نتيجة الاختبارات قبل التعديل (فعلية)

```
Test Files  23 passed | 1 skipped (24)
     Tests  266 passed | 2 skipped (268)
Duration    2.63s
```

مجموعات الاختبار الحالية: 11 في `tests/` الجذر، 10 في `tests/gateway/`، 4 في `tests/server/` (انظر خريطة المستكشف في سياق الجلسة). لا يوجد اختبار حالياً لـ: requestId/idempotency، lease/ownership، طوابير لكل جلسة، استعادة بعد إغلاق التبويب.
