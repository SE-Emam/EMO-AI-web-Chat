# Provider Capabilities Matrix — Task 13 (2026-11-12)

> **مصدر هذه المصفوفة:** الكود + الاختبارات القابلة لإعادة التشغيل (`tests/arena/driver-capabilities.test.ts`) — لا افتراضات. كل صف هنا مُعلن من `getCapabilities()` في السائق نفسه.
> **نمط الجلسة قيمة معلنة:** `'per-session-page' | 'serialized-per-session' | 'single-session-only' | 'unsupported'` — لا تجاهل صامت لـ`sessionKey` إطلاقًا.

| السائق | sessionSupport | persistentConversation | streaming | toolCalling (على مستوى السائق) | القيود الفعلية |
|---|---|---|---|---|---|
| `chatgpt-web` (`ChatGPTWebDriver` → `BaseWebDriver`) | `per-session-page` | نعم (SessionState + SessionRegistry — استعادة رابط المحادثة بعد إعادة تشغيل البوابة) | نعم (onChunk deltas) | لا (مفسّر الأدوات على مستوى المسار) | صفحات لكل جلسة عبر TabScheduler فوق TabWorkerPool؛ نفس الجلسة = مسار تسلسلي، جلسات مختلفة = صفحات متوازية |
| `tencent-ai-web` (`TencentAiWebDriver` → `BaseWebDriver`) | `per-session-page` | نعم (يرث آلية chatgpt-web كاملة) | نعم | لا | نفس القيود أعلاه؛ ويصفّي `aistudio.tencent.ai` إلى `yuanbao.tencent.com/chat` |
| `grok-web` / `kimi-web` / `minimax-web` (→ `BaseWebDriver`) | `per-session-page` | نعم (الآلية نفسها) | نعم | لا | تُعلن تلقائيًا بوراثة `BaseWebDriver.getCapabilities()` |
| `zai-web` (`ZaiWebDriver`) | `serialized-per-session` | لا | نعم (onChunk deltas بالاستطلاع) | لا | **صفحة مشتركة واحدة:** طلبات نفس الجلسة **وجلسات مختلفة** تتسلسل جميعًا؛ كل طلب يبدأ محادثة جديدة ويحمل تاريخ المحادثة كاملًا في البرومبت (السياق يُستعاد لكل طلب، لا رابط محادثة محفوظ)؛ CAPTCHA الأليون تُحل يدويًا في النافذة المرئية (تصميم أمني) |
| `qwen-web` (`QwenWebDriver`) | `serialized-per-session` | لا | نعم | لا | نفس قيود zai-web (صفحة مشتركة، محادثة جديدة لكل طلب، تاريخ كامل في البرومبت) |
| `gemini-web` (`GeminiWebDriver`) | `serialized-per-session` | لا | نعم | لا | نفس قيود zai-web |
| `claude-web` (`ClaudeWebDriver`) | `serialized-per-session` | لا | نعم | لا | نفس قيود zai-web (تنقل إلى `/new` لكل طلب) |

## ما لم يُدّعَ (حدود صريحة)

1. **لا استعادة رابط محادثة ويب للسائقين المستقلين الأربعة** (zai/qwen/gemini/claude): لا تمرير sessionKey إلى صفحة محادثة قائمة ولا حفظ `conversationUrl` — لأن تدفقها الحالي يبدأ محادثة جديدة لكل طلب. أي ادعاء بالعكس كان سيخالف قاعدة «كل قدرة تُعلن بعد اختبار» — لذلك صُنّفت `persistentConversation: false`.
2. **لا فرض TabScheduler على بنية غير متوافقة:** السائقون الأربعة أبقوا صفحتهم الواحدة، وقُدِّم `sessionKey` حتى أعمق طبقة (`SerializedSessionSendQueue`) مع تسلسل آمن — لا صفحات مشتركة متوازية تُنشأ بالقوة.
3. **toolCalling = false على مستوى السائق:** السائقون لا يفرّكون استدعاءات أدوات بأنفسهم؛ مفسّر الأدوات يعمل على مستوى المسارات (app.ts) ولم يُمس.
4. لم تُعدَّل Selectors ولا تسجيل الدخول ولا بيانات جلسات حقيقية.

## تدفق sessionKey عبر الطبقات (بعد Task 13)

```
المسارات (OpenAI/Anthropic/Gemini) → RoutingDriver → driver.sendMessage(…, sessionKey)
  ├─ BaseWebDriver (chatgpt/tencent/…) → SessionQueue(sessionKey) → TabScheduler.acquireFor(sessionKey) → صفحة الجلسة + SessionState دائم
  └─ المستقلون (zai/qwen/gemini/claude) → SerializedSessionSendQueue(sessionKey) → صفحة واحدة متسلسلة + تاريخ كامل في البرومبت
```
