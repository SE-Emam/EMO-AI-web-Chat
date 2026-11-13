# توثيق موجه الوكلاء وميزات الوكالة الذكية (Swarm & Agentic Architecture)

> **مشروع:** Arena WebBridge / EMO.ai (`arena-web-api`)  
> **الإصدار:** 0.2.0 (Agentic Release)  
> **تاريخ التحديث:** نوفمبر 2026

---

## 📖 جدول المحتويات
1. [نظرة عامة](#نظرة-عامة)
2. [معمارية موجه الوكلاء (Swarm Coordinator)](#معمارية-موجه-الوكلاء-swarm-coordinator)
3. [أدوار الوكلاء الفرعيين (Subagents Roles)](#أدوار-الوكلاء-الفرعيين-subagents-roles)
4. [أنماط التشغيل (Execution Modes)](#أنماط-التشغيل-execution-modes)
5. [دعم استدعاء الأدوات (Tool Calling Support)](#دعم-استدعاء-الأدوات-tool-calling-support)
6. [بركة التبويبات المتوازية (Tab Worker Pool)](#بركة-التبويبات-المتوازية-tab-worker-pool)
7. [الحماية الأمنية وفلترة الأسرار (Secret Redaction)](#الحماية-الأمنية-وفلترة-الأسرار-secret-redaction)
8. [طرق الاستخدام وواجهات البرمجة (API & CLI Reference)](#طرق-الاستخدام-وواجهات-البرمجة-api--cli-reference)

---

## نظرة عامة

يقدم هذا التحديث نقلة نوعية لمشروع **Arena WebBridge**؛ حيث تم تحويله من مجرد "وسيط دردشة فردي" (Single-turn Web Proxy) إلى **منظومة وكلاء ذاتية القيادة (Autonomous Multi-Agent Orchestrator)** مستوحاة من أفضل ممارسات مشاريع الوكلاء الرائدة (مثل Chat On Steroids و Codex).

يتيح النظام للمطورين:
* استغلال اشتراكات الويب للمزودين (ChatGPT Plus, Claude Pro, Gemini, DeepSeek, etc.) لإنجاز مهام برمجية ضخمة بالتوازي دون دفع تكاليف الـ API الباهظة.
* استخدام بيئات تطوير ذكية مثل **Cursor** و **Cline** مع واجهات الويب مع دعم كامل لاستدعاء الأدوات (`tool_calls`).
* تشغيل فرق عمل متوازية تفكر، تبرمج، تدقق، وتختبر الكود في نفس الوقت.

---

## معمارية موجه الوكلاء (Swarm Coordinator)

الموجه مسؤول عن إدارة دورة حياة المهمة البرمجية بالكامل:

```
[User / Developer / IDE]
          │
          ▼
   [Goal Ingestion] ────> تفكيك الهدف آلياً إلى شرائح مهام فرعية (Task Slices)
          │
          ├───> [Architect Subagent] ──> تخطيط المعمارية وهياكل البيانات
          ├───> [Coder Subagent]     ──> كتابة الكود البرمجي بالكامل
          ├───> [Reviewer Subagent]  ──> فحص الأمان والثغرات وجودة الكود
          └───> [Tester Subagent]    ──> كتابة اختبارات الوحدة والتكامل
          │
          ▼
 [Unified Deliverable Synthesis] ──> تقرير موحد يجمع المعمارية، الكود، التدقيق، والاختبارات
```

---

## أدوار الوكلاء الفرعيين (Subagents Roles)

| الدور | الاسم الوظيفي | التوجيه الافتراضي | المهام الرئيسية |
| :--- | :--- | :--- | :--- |
| **`architect`** | المهندس المعماري | `deepseek-r1` / `o1` / `o3-mini` | تحليل المتطلبات، اختيار الأنماط المعمارية، تصميم هياكل البيانات والـ API contracts. |
| **`coder`** | مهندس التنفيذ | `claude-3-7-sonnet` / `gpt-4o` / `qwen-2.5-max` | كتابة كود إنتاجي نظيف، معالجة الأخطاء، استخدام الأنواع الصارمة في TypeScript/Python. |
| **`reviewer`** | مدقق الأمان والجودة | `claude-3-7-sonnet` / `deepseek-chat` | التدقيق الأمني (OWASP، حقن المدخلات، Race conditions)، واقتراح تحسينات الأداء. |
| **`tester`** | مهندس الاختبارات | `gemini-2.0-flash` / `haiku` | كتابة اختبارات الوحدة (Unit tests)، والتكامل (Integration tests)، والحالات الشاذة. |

---

## أنماط التشغيل (Execution Modes)

1. **النمط التلقائي الهجين (`auto`):**
   - ينفذ مرحلة التصميم أولاً، ثم يسلم المخرجات للمبرمج، ثم يشغل المدقق والمختبر بالتوازي لتوفير الوقت مع ضمان جودة الكود.
2. **النمط التسلسلي الخطي (`pipeline`):**
   - يمرر مخرجات كل وكيل كـ Context للوكيل الذي يليه في خط إنتاج متصل.
3. **النمط المتوازي الكامل (`parallel`):**
   - يطلق كافة الوكلاء في نفس اللحظة عبر `Promise.allSettled` لتوليد وجهات نظر متعددة وسريعة للهدف.

---

## دعم استدعاء الأدوات (Tool Calling Support)

* **الملف المسؤول:** [`src/server/tool-interpreter.ts`](../src/server/tool-interpreter.ts)
* **كيف يعمل:**
  1. عند وصول طلب `/v1/chat/completions` يحتوي على مصفوفة `tools`، يقوم المترجم بحقن تعريفات الأدوات تلقائياً في برومبت النظام كتعليمات صارمة.
  2. يقوم النموذج بإخراج طلب استدعاء مهيكل:
     ```tool_call
     {"name": "read_file", "arguments": {"path": "src/index.ts"}}
     ```
  3. يعترض السيرفر هذا النص ويحوله إلى كائن `tool_calls` قياسي في رد الـ OpenAI API مع `finish_reason: "tool_calls"`.

---

## بركة التبويبات المتوازية (Tab Worker Pool)

* **الملف المسؤول:** [`src/arena/tab-worker-pool.ts`](../src/arena/tab-worker-pool.ts)
* **الميزة:**
  - إدارة بركة تبويبات متزامنة (حتى 3 أو 4 صفحات) داخل نفس جلسة المتصفح والـ Profile.
  - تمكين معالجة عدة طلبات في نفس الوقت بالتوازي التام دون انتظار تسلسلي.
  - **التلخيص التلقائي (Auto-Compaction):** عند وصول أي تبويب إلى 15 دورة حوار، يقوم النظام بتصفير الجلسة وبدء محادثة جديدة لتجنب بطء الذاكرة وامتلاء حد السياق.

---

## الحماية الأمنية وفلترة الأسرار (Secret Redaction)

* **الملف المسؤول:** [`src/gateway/security.ts`](../src/gateway/security.ts)
* **الميزة:**
  - فحص البرومبتات قبل خروجها للمتصفح والتعرف الآلي على:
    - مفاتيح OpenAI و Anthropic و Google و AWS و GitHub.
    - المفاتيح والشهادات الخاصة (RSA/EC Private Keys).
    - أسرار ملفات البيئة (`.env`).
  - إخفاؤها واستبدالها محلياً بـ `{{REDACTED_SECRET_X}}`.
  - استعادة القيم الأصلية محلياً عند عودة الرد من النموذج قبل تسليمه للعميل.

---

## طرق الاستخدام وواجهات البرمجة (API & CLI Reference)

### 1. من سطر الأوامر (CLI):
```bash
# تشغيل فريق الوكلاء بهدف محدد:
npx webbridge swarm "ابنِ نظام Rate Limiter باستخدام Redis مع اختبارات الوحدة"

# تحديد نمط التشغيل:
npx webbridge swarm "مراجعة الكود واكتشاف الثغرات" --mode parallel
```

### 2. عبر OpenAI API (/v1/chat/completions):
يمكن لأي أداة (مثل Cursor أو Python SDK) استخدام الوكلاء باختيار النماذج التالية:
* `swarm:auto`
* `swarm:fullstack`
* `swarm:pipeline`
* `swarm:parallel`

أو بإضافة الهيدر:
```http
X-Emo-Subagents: true
```

### 3. عبر المسار المخصص (/v1/agents/swarm):
```bash
curl -X POST http://127.0.0.1:8989/v1/agents/swarm \
  -H "Content-Type: application/json" \
  -d '{
    "goal": "تصميم وبرمجة وحدة المصادقة JWT",
    "mode": "auto"
  }'
```

### 4. واجهة التحكم الرسومية (Gateway Web UI):
افتح **`http://localhost:8989/`** في المتصفح وانتقل إلى تبويب:  
**`🚀 موجه الوكلاء (Swarm)`** لتجربة إطلاق الوكلاء ومتابعة مخرجاتهم الحية عبر المتصفح.
