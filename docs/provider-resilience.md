# Provider Resilience Configuration — Task 14 (2026-11-12)

## 1. تصنيف الأعطال (`src/arena/provider-failures.ts`)

`classifyFailure(err, ctx)` يعيد `ProviderFailure` دائمًا:
`{ code, phase, sent, confirmedResult, retryable, markUnconfirmed, retryAfterMs? }`

**الرموز العشرة:** AUTH_REQUIRED · RATE_LIMITED · QUOTA_EXHAUSTED · NETWORK_TIMEOUT · NETWORK_UNKNOWN_AFTER_SEND · GENERATION_STALLED · UI_SELECTOR_CHANGED · CONVERSATION_RESTORE_FAILED · PROVIDER_UNAVAILABLE · PROFILE_OWNER_UNAVAILABLE.

**قاعدة أساسية مطبقة:** لا يصبح أي خطأ retryable دون فحص المرحلة وعلامة الإرسال.
- pre-send + إثبات عدم التنفيذ → retryable (NETWORK_TIMEOUT/PROVIDER_UNAVAILABLE فقط).
- إرسال ممكن + نتيجة غير قابلة للإثبات → `markUnconfirmed: true` وretryable دائمًا false (NETWORK_UNKNOWN_AFTER_SEND).
- AUTH/QUOTA/RATE بعد إرسال ممكن → الرمز يبقى + unconfirmed، بلا إعادة إرسال.
- عبارات "rate limit" النصية الغامضة **ليست دليلًا** → PROVIDER_UNAVAILABLE. الدليل المقبول: رمز واضح (`rate_limit_error`)، HTTP 429، أو page marker مؤكد.
- `parseRetryAfter`: ثوانٍ موجبة أو تاريخ HTTP مستقبلي فقط؛ يُرفض السالب/الصفر/الضخم/التاريخ الماضي/غير القابل للتحليل. الحد الأقصى للاحترام: 10 دقائق افتراضيًا (`DEFAULT_RETRY_AFTER_MAX_WAIT_MS`).

## 2. Circuit Breaker (`src/arena/circuit-breaker.ts`)

| الإعداد | المصدر | الافتراضي |
|---|---|---|
| `threshold` | `EMO_BREAKER_THRESHOLD` | 5 |
| `recoveryMs` | `EMO_BREAKER_RECOVERY_MS` | 30_000 |
| `storePath` | `EMO_BREAKER_STATE_PATH` | `~/.arena-webbridge/state/breaker-state.json` |

- المفتاح: `(providerId, profileDir)` — المعزول لكل مفتاح.
- CLOSED → OPEN (عتبة) → HALF_OPEN (probe واحد بإيجار pid+token+TTL عبر `ProcessLock`) → CLOSED عند النجاح.
- **لا يلغي الطلبات الجارية أبدًا** (لا واجهة إلغاء موجودة أساسًا).
- AUTH_REQUIRED / QUOTA_EXHAUSTED / RATE_LIMITED **لا تُحسب** نحو الفتح (قرار سياسة: لا تُعالج بالتكرار أو التبديل).
- أخطاء إدخال المستخدم/الأدوات غير معروفة الرمز → تُتجاهل بـ`record()`.
- ملف الحالة لا يُنشأ بالقراءة — بوابة خامل تترك مجلد state كما هو.

## 3. مهلات المزود (`Config.providerTimeoutsMs`)

| الحقل | المعنى | الافتراضي المحافظ |
|---|---|---|
| `accept` | قبول الإرسال (إدخال composer) | 30_000 |
| `stall` | أقصى صمت أثناء التوليد → GENERATION_STALLED | 90_000 |
| `total` | سقف الطلب كاملًا | 300_000 |

**المهلة الإجمالية لا تعيد تنفيذ رسالة سبق إرسالها أبدًا** — تُصنف unconfirmed.
(هذه قيم معلنة؛ ربط فرضها على مستوى كل driver يبقى تدريجيًا وموثقًا لكل مهمة.)

## 4. `/health` (محلي فقط)

- مقاطع: `gateway` (alive/uptime/browserServiceRunning) · `profileOwnership` · `ipc` · `providers` (لكل مسار: breakerState, lastFailureCode/At, lastSuccessAt, **providerState: 'not_checked' دائمًا**) · `broker` (running/completed/failed/unconfirmed) · `requests` (inFlight, queuedWaiting).
- **لا يرسل رسالة اختبار إلى ChatGPT أو أي مزود** — لا استدعاء driver داخل المعالج.
- لا مفاتيح API/Bearer/Cookies/محتوى محادثة/أسرار IPC في الاستجابة.
- الفرق معلن: `not_checked` ≠ متاح.

## 5. التشخيص الموحد (`buildDiagnostics`)

requestId · sessionKey (مُنقّح إلى 24 حرفًا) · providerId · profileId · ownerInstanceId · workerId · epoch · failureCode · phase · requestState · durationMs · sent · confirmed — مع إزالة أي حقل باسم مفتاح/توكن/كوكي/سر وبقائية تعتيم Bearer/sk- داخل القيم، وحذف حقول محتوى المحادثة.
