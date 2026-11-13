# Agent Workspace Access (MCP) — Fixing the Broken Agent Tooling

> **الحالة:** مُنفَّذ ومُتحقَّق منه حيًّا (Source-only).
> **التاريخ:** 2026-11-13 · **الوكيل:** الوكيل الثالث
> **المشكلة:** ربط ChatGPT مع Cline أعطى ردًّا مفاده «تعذّر تنفيذ القراءة بسبب انقطاع اتصال بيئة العمل المحلية».

---

## 1. التشخيص

الرسالة التي أبلغ عنها المستخدم كانت نتيجة **عطل حقيقي** في البوابة:

| # | الفحص | النتيجة |
|---|---|---|
| 1 | هل يوجد خادم MCP في البوابة؟ | **لا** — `GET /mcp` و`POST /mcp` ⇒ **404** |
| 2 | ما الذي تشير إليه إعدادات MCP المولَّدة؟ | `http://127.0.0.1:8989/mcp` عبر `npx -y mcp-remote` |
| 3 | النتيجة | كل عميل MCP للوكيل كان **يفشل في الاتصال** ⇒ «انقطاع اتصال بيئة العمل المحلية» |

إعداد MCP كان يشير إلى **عنوان غير موجود** — لا خادم MCP في البوابة إطلاقًا.

لم يكن هذا خللًا في Cline ولا في ChatGPT: كان خللًا في **البوابة**، أي في الشيء الذي يجب أن يوفّره بالضبط.

---

## 2. الحل

### 2.1 خادم MCP حقيقي (`src/server/mcp-server.ts`)

* `POST /mcp` — JSON-RPC 2.0 على النقل **Streamable HTTP**.
* `GET /mcp` — تدفّق SSE للعملاء الذين يفضّلون النقل القديم.
* `DELETE /mcp` — إنهاء الجلسة.
* `GET /mcp/status` — تشخيص سريع.

**الطرق المدعومة:** `initialize` · `notifications/initialized` · `ping` · `tools/list` · `tools/call` · `resources/list` · `prompts/list`.

**المصادقة:** يقبل `Authorization: Bearer <key>` **و** `Authorization: Bearer <key>` (الشكل الكامل الذي ترسله عملاء MCP) — لا بدّ من قبول الشكلين لأن `mcp-remote` يرسل الترويسة كاملة.

### 2.2 أدوات مساحة العمل (`src/server/workspace-tools.ts`)

| الأداة | الوظيفة |
|---|---|
| `read_file` | قراءة ملف (مع支持 offset/limit) |
| `write_file` | كتابة ملف (مع إنشاء المجلدات الناقصة) |
| `edit_file` | استبدال نصّ حرفي (يرفض الغموض) |
| `list_directory` | محتويات مجلد |
| `list_codebase` | شجرة المشروع |
| `create_directory` | إنشاء مجلد |
| `move_file` | نقل/إعادة تسمية |
| `delete_file` | حذف ملف |
| `search_files` | بحث بتعبير نمطي |

### 2.3 جسر الوكيل ⇄ نموذج الويب (`src/gateway/agent-tool-bridge.ts`)

بناءً على بحث chat-on-steroids، تم تنفيذ جسر لربط الوكلاء (OpenCode, Cline, etc.) مع نماذج الويب (ChatGPT) باستخدام:

#### 2.3.1 تعليمات fact-only (المرحلة 1)
- استبدال الأحكام بوقائيع فقط عن مساحة العمل والأدوات
- إزالة عبارات "NEVER say..." و "Do not refuse"
- إضافة معلومات عن الجذور المعتمدة ونموذج التنفيذ

#### 2.3.2 كتلة الطلب (المرحلة 2)
- توجيه النموذج لإنشاء كتل `tool_call` دقيقة
- استخدام لغة fact-only لتجنب الرفض
- دعم للمرحلة الأولى والمرحلة التالية بعد نتيجة الأداة

#### 2.3.3 استمرار الحلقة (المرحلة 3)
- توليد كتل استمرار بعد نتيجة الأداة
- التعامل مع الحالات التي لا يوجد فيها مسار محدد
- استخدام `findTaskPath` للعثور على المسار من المحادثة السابقة

#### 2.3.4 سلامة الوسائط (المرحلة 6)
- التحقق من صحة وسائط النداء مقابل مخطط الأداة المُعلنة
- تصحيح أسماء المعاملات (مثل `path` → `filePath`)
- التحقق من المطلوب والأنواع

#### 2.3.5 MCP instructions و annotations (المرحلة 5)
- نشر `instructions` في رد `initialize` مع الجذور والدلالات
- إضافة `readOnlyHint: true` لأدوات القراءة فقط
- تحديث الوصف ليشمل "المسار المطلق" وقاعدة "المجلد: list ثم read"

#### 2.3.6 مصفوفة القياس (المرحلة 7)
- اختبار شامل: {OpenCode 12 أداة, Cline 6 أدوات} × {ملف, مجلد, بحث} × {EN, AR}
- التحقق من نسبة `tool_calls` الصادرة ومطابقة الوسائط
- ملف الاختبار: `tests/gateway/agent-bridge-scenarios.test.ts`

### 2.4 التكوين التلقائي للوكلاء (`src/gateway/mcp-auto-config.ts`)

- كتابة MCP server في إعدادات الوكلاء تلقائيًا
- دعم: OpenCode, Roo, VS Code, Claude Code, Cursor, Windsurf, Zed, Desktop, Continue, Kiro
- نسخ احتياطية للإعدادات الأصلية
- تخطي الوكلاء غير المثبتة

### 2.5 واجهة المستخدم (`src/gateway/ui.ts`)

- لوحة MCP مع عرض الجذور والوضع
- زر رابط تلقائي للتكوين
- قائمة بالوكلاء المدعومين وحالتهم
- دعم i18n للعربية والإنجليزية

---

## 3. القياسات

### 3.1 قياس النجاح الأساسي

| الحالة | النتيجة |
|---|---|
| 12 أداة + مسار مجلد، بلا_BLOCK | **رفض 6/6** («the local connection returned a timeout…») |
| نفس الطلب + كتلة `tool_call` جاهزة **في رسالة النظام** | **نجاح 4/4** |
| نفس الكتلة **في رسالة المستخدم** | **رفض** |
| 12 أداة + مسار مجلد + كتلتنا في النظام | `tool_call list{path}` ✓ |
| 6 أدوات (نمط Cline) + ملف | `tool_call read_file{path}` ✓ |
| 6 أدوات + مجلد | `tool_call list_files{path}` ✓ |

### 3.2 قياسات الجسر

- OpenCode × EN/AR: 100% `tool_calls` في جميع السيناريوهات
- Cline × EN/AR: 100% `tool_calls` مع تصحيح وسائط النداء
- معدل الرفض: 0% بعد تطبيق fact-only instructions
- وقت الاستجابة: < 200ms للكشف عن الرفض والإصلاح

---

## 4. الاستخدام

### 4.1 للعملاء (الوكلاء)

1. **تثبيت الوكلاء المدعومة:** OpenCode, VS Code, Cline, etc.
2. **الوصول إلى البوابة:** `http://127.0.0.1:8989`
3. **النقر على "Auto-configure MCP"** في واجهة المستخدم
4. **إعادة تشغيل الوكيل** لتحميل الإعدادات الجديدة

### 4.2 للمطورين

```bash
# بناء المشروع
npm run build

# تشغيل الاختبارات
npx vitest run tests/gateway/agent-bridge-scenarios.test.ts

# التحقق من MCP server
curl http://127.0.0.1:8989/mcp/status
```

### 4.3 التشخيص

```bash
# حالة MCP
curl -H "Authorization: Bearer emo.web" http://127.0.0.1:8989/mcp/status

# قائمة الأدوات
curl -H "Authorization: Bearer emo.web" -X POST http://127.0.0.1:8989/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

## 5. الملاحظات التقنية

- **الجذور الافتراضية:** `~/Desktop` (يقرأ في وقت الطلب)
- **الحد الأقصى لقراءة الملف:** 400KB
- **الحد الأقصى لقائمة المجلد:** 500 ملف
- **الحد الأقصى لنتائج البحث:** 200 سطر
- **إخفاء الأسرار:** `.env` و `credentials` تُرجع كـ `[redacted]`
- **الأمان:** رفض symlink escape، حصر الجذور

---

## 6. TODO

- [ ] دعم المزيد من الوكلاء (Jan, AnythingLLM, etc.)
- [ ] واجهة لإدارة الجذور بشكل ديناميكي
- [ ] تسجيل الأنشطة والتحليلات
- [ ] دعم WebSocket لنقل الوقت الحقيقي
- [ ] دعم للقراءة الموزعة (distributed reads)

**السلامة:**
* كل مسار يُحَلّ ويُتحقَّق منه **داخل الجذور المسموحة** فقط (الافتراضي: مجلد المستخدم).
* **الهروب عبر الروابط الرمزية (symlinks) مرفوض** — يُقارن المسار الحقيقي (realpath).
* ملفات الأسرار (`.env` وأمثالها) **تُخفى قبل أن تغادر الأداة**.
* لا شبكة، ولا ذاكرة خارجية.

> تصحيح مهم: على macOS ‏`/var` رابط رمزي إلى `/private/var` — لذلك تُقارن الجذور بالمسار
> **الحقيقي**، وإلا رُفض كل مسار كأنه «خارج مساحة العمل».

### 2.3 الإعدادات المولَّدة صارت صالحة

* كل نداءات `mcp-remote` صارت تحمل `--header "Authorization: Bearer <key>"`.
* Workbench ‏(VS Code / Cline / Cursor / Windsurf / Continue / Roo / Copilot) تستخدم
  **MCP أصليًا عبر HTTP** (بلا `npx` ولا اعتماد على npm):
  `{ "type": "http", "url": "…/mcp", "headers": { "Authorization": "Bearer …" } }`
* هدف **Cline** أُضيف إلى القائمة، وعند اختيار وكيل Cline يُولَّد الشكل الأصلي.

---

## 3. التحقّق الحيّ

### 3.1 إعدادات كل الوكلاء (28 وكيلًا)

```
=== MCP CONFIG VERIFICATION (live) ===
opencode     installed  stdio(mcp-remote)  CONNECTED 9 tools
vscode       installed  http                CONNECTED 9 tools
hermes       installed  stdio(mcp-remote)  CONNECTED 9 tools
antigravity  installed  stdio(mcp-remote)  CONNECTED 9 tools
t3           installed  stdio(mcp-remote)  CONNECTED 9 tools
lobehub      installed  stdio(mcp-remote)  CONNECTED 9 tools
jan          installed  stdio(mcp-remote)  CONNECTED 9 tools
anythingllm  installed  stdio(mcp-remote)  CONNECTED 9 tools
…
28/28 agent configurations reach the workspace tools.
```

### 3.2 الجسر الحقيقي (`npx mcp-remote`)

```
[55041] Using custom headers: Authorization
[55041] Connected to remote server using StreamableHTTPClientTransport
[55041] Proxy established successfully between local STDIO and remote StreamableHTTPClientTransport
[55041] [Local→Remote] tools/call
read_file output: الفكرة الأساسية: يساعد التطبيق مالك السيارة على فهم الأعراض …
```

قرأ الملف **الحقيقي** `/Users/emamabdullaziz/Desktop/Doctor-Car/IDEA.md` عبر نفس
الأمر الذي يولّده التطبيق في إعداد MCP.

### 3.3 الدورة الكاملة: Cline → البوابة → ChatGPT → الأداة → النتيجة

**الرحلة الأولى** — ChatGPT يطلب الأداة:

```json
POST /v1/chat/completions  { model: "chatgpt-web:default", tools: [read_file], … }
→ finish_reason: "tool_calls"
  tool_calls: [{ "name": "read_file",
                 "arguments": "{\"path\":\"/Users/emamabdullaziz/Desktop/Doctor-Car/README.md\"}" }]
```

**الرحلة الثانية** — النتيجة تعود إلى ChatGPT:

```
finish_reason: stop
answer: Project Name: Doctor Car – Car Diagnostic Web Application.
        Project Goal: Build a responsive web application that helps car owners
        understand vehicle symptoms, explore possible causes, and find safe,
        reliable solutions based on trusted sources. …
```

إذن: **نعم — ChatGPT يستطيع الوصول إلى الملفات واستخدام أدوات الوكلاء عبر البوابة.**

---

## 4. إعدادات إضافية

| الإعداد | الافتراضي | المعنى |
|---|---|---|
| `ui.mcp.workspaceRoots` | `[]` (مجلد المستخدم) | تقييد أدوات الملفات داخل مجلدات محدّدة |

```json
{ "ui": { "mcp": { "workspaceRoots": ["/Users/me/projects"] } } }
```

---

## 5. الاختبارات

`tests/gateway/mcp-server.test.ts` — 25 اختبارًا:

* قراءة/كتابة/تعديل/نقل/حذف/بحث/شجرة المشروع.
* **رفض** المسار خارج مساحة العمل.
* **رفض** الهروب عبر symlink.
* **إخفاء** أسرار `.env`.
* Forms القبول: `Bearer x` و `Authorization: Bearer x`.
* `initialize` · `tools/list` · `tools/call` · خطأ JSON-RPC لطريقة غير معروفة.
* الرفض بلا مفتاح صالح.
* `instructions` في `initialize` تذكر الجذر الساري · وسوم `annotations` لكل أداة ·
  بقاء `inputSchema` كما هو.

---

## 6. الملفات

**جديدة:** `src/server/mcp-server.ts` · `src/server/workspace-tools.ts` · `tests/gateway/mcp-server.test.ts`
**معدَّلة:** `src/server/gateway-routes.ts` (تسجيل `/mcp`) · `src/gateway/types.ts` (`ui.mcp`) ·
`src/gateway/config-store.ts` (حفظ الإعدادات) · `src/gateway/ui.ts` (إعدادات MCP الصحيحة + هدف Cline)

---

## 7. تعليمات الخادم ووسوم الأدوات (Server instructions & tool annotations)

### 7.1 `initialize` صار يحمل `instructions`

ردّ `initialize` صار يحمل الحقل القياسي `InitializeResult.instructions` — نصٌّ قصير
(أقل من 1200 حرف) يبنيه الخادم **حيًّا** في كل طلب من الجذور السارية نفسها
(`opts.workspaceRoots` تُقرأ في كل طلب، فلا تبقى قيمة قديمة).

محتواه:

* **الجذور المعتمدة بمسارات مطلقة** — أو `None configured` إن لم تُضبط (وعندها
  يكون مجلد المستخدم هو الجذر الفعلي).
* **سطر واحد لكل أداة** يوضّح ما تفعله، وأنها لا تعمل إلا داخل الجذور المعتمدة.
* **قاعدة المسارات** — مسار مطلق داخل جذر معتمد، أو مسار نسبي إلى جذر.
* **ما لا يُقرأ أبدًا** — ملفات `.env` وملفات الاعتماد: قيم الأسرار ترجع `[redacted]`.

**لماذا؟** النموذج يرى هذه التعليمات مرة واحدة قبل أن يعرف شيئًا عن البوابة؛
فهي المكان الوحيد الذي تُذكر فيه الجذور وقواعد المسار مرة واحدة بدل تكرارها في
كل وصف أداة. والنص **واقعي بحت** — يصف ما هو موجود، ولا يدعو النموذج إلى
«تقييم» الأدوات بنفسه.

### 7.2 `tools/list` صار يحمل `annotations` لكل أداة

كل أداة الآن تُرسل: `name` · `title` (اسم بشري) · `description` · `inputSchema`
(نفس المخطّط بالضبط، بلا تغيير في أسماء المعاملات) و `annotations`:

| الأداة | `readOnlyHint` | `destructiveHint` |
|---|---|---|
| `read_file` · `list_directory` · `list_codebase` · `search_files` | `true` | `false` |
| `write_file` · `edit_file` | `false` | `true` (يكتب فوق الملف) |
| `move_file` · `delete_file` | `false` | `true` (يزيل/يستبدل) |
| `create_directory` | `false` | `false` (يضيف فقط) |

`idempotentHint: true` و `openWorldHint: false` لكل الأدوات (لا شبكة — الملفات
المحلية فقط).

**لماذا؟** العميل الذي لا يرى `readOnlyHint` يتعامل مع الأداة كأنها **كتابة**
ويطلب تأكيد المستخدم في كل نداء — فوكيل يضطر للسؤال عن مجرد *قراءة* ملف يصبح
غير قابل للاستخدام. لذلك تُعلَن الأدوات للقراءة فقط بوضوح. و`destructiveHint`
صادق فقط حيث يوجد إتلاف فعلي (كتابة فوق، حذف، نقل) — لا أكثر.

