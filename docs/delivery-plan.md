# خطة التسليم — الوكلاء + الأدوات + الملفات المحلية

المشروع: **EMO.ai gateway** (بوابة محلية على `http://127.0.0.1:8989`).
المرجع المُدقَّق: [`totec448-spec/chat-on-steroids`](https://github.com/totec448-spec/chat-on-steroids)
(قُرئ عبر الشبكة، بدون استنساخ) + [openclaw/openclaw](https://github.com/openclaw/openclaw).

الهدف: **كل الوكلاء المسجَّلون يعملون مع كل المزوّدات، ويستخدمون الأدوات، ويقرأون ويكتبون
ملفات الجهاز فعليًا** — بلا جملة «بيئة الملفات غير متصلة» وبلا حلقة فارغة.

---

## ١. ماذا يفعل chat-on-steroids فعلًا (وفرقه الجوهري عنا)

| | chat-on-steroids (CoS) | مشروعنا |
|---|---|---|
| منفّذ الأداة | التطبيق نفسه (خادم MCP حقيقي) | الوكيل على جهاز المستخدم (OpenCode / Roo / Cline / OpenClaw…) |
| استدعاء النموذج للأداة | **MCP أصلي**: CoS يشغّل خادم MCP ويضعه في ChatGPT عبر «Plugins → Add → Add custom MCP server» (عبر نفق) | **بروتوكول نصي**: النموذج يكتب ```tool_call``` والعميل ينفّذه |
| التوجيه | تعليمات «Core» غنية مبنية على تعليمات Codex، **وققائق فقط** | `TOOL CALLING MODE` + كتلتنا |
| نتيجة الأداة | MCP أصلي + `x-request-id` (wfr_…) لربط النداء بالمحادثة | رسالة `role: tool` من العميل |

**الدروس المنقولة (وهي الخطة):**

1. **الحقيقة فقط، لا الأحكام** — CoS: «ChatGPT's safety check reads rules about blocks,
   approvals, "authority", "guards" … Every line here says what is so, nothing about how to
   judge it» (`src/main/mcp/instructions.ts`). صياغة «NEVER say… / Do not refuse» عندنا هي
   حكم لا واقعة، وهي بالضبط ما يجعل النموذج يجيب برفض.
2. **اذكر أدواتك فقط** — كل موصل في CoS يذكر أدواته هو فقط (`instructions.ts:8-10`).
3. **وقائع البيئة قبل الطلب** — الجذور المعتمدة ودلالة كل أداة (`instructions.ts:90-104`).
4. **تعليمات الخادم تُنشر عند `initialize`** (`mcp/tools.ts:43-51`).
5. **`readOnlyHint`** — بلاه تعتبر ChatGPT الأداة كتابةً وتطلب تأكيدًا لكل نداء (`mcp/kernel.ts:23-25`).
6. **نص نتيجة الأداة يُعامَل كغير موثوق** ما لم يُقدَّم كإخراج العميل (`session/input.ts`, #1231).
7. **تعليمات الخادم تُقرأ مرة، و`tools/list` يُعاد كل دور** (`codex/tool-specs.ts:58-60`) —
   يفسّر لماذا الكتلة في رسالة النظام تُنفَّذ (٤/٤) ونفسها في رسالة المستخدم تُهمَل.
8. **رفض مكتوب بنوع ثابت** (`TOOL_DISABLED: …`) يعيده النموذج حرفيًا بدل أن يخترع عطلًا
   (`mcp/kernel.ts:1637-1648`).
9. **حقن التعليمات مع نص المستخدم في رسالة واحدة** (`shared/user-prompt.ts`, `[[COS_CONTEXT:n]]`).

---

## ٢. القياسات الحية على البوابة (أساس كل قرار)

| الحالة | النتيجة |
|---|---|
| ١٢ أداة + مسار مجلد، بلا حيلة | **رفض ٦/٦** («the local connection returned a timeout…») |
| الكتلة `tool_call` جاهزة **في رسالة النظام** | **نجاح ٤/٤** |
| نفس الكتلة **في رسالة المستخدم** | **رفض** |
| OpenCode ١٢ أداة + مجلد | `list{path}` ✓ |
| Cline ٦ أدوات + ملف | `read_file{path}` ✓ |
| Cline ٦ أدوات + مجلد | `list_files{path}` ✓ |
| كتلة + «كتلة البيئة» (وقائع إضافية) | **رفض** → الكتلة_ENV تُعطَّل افتراضيًا |

⇒ القاعدة: **الكتلة في رسالة النظام، مطابقة لمسار الطلب، وحدها**.

---

## ٣. الخطة التنفيذية والمراحل

| # | المرحلة | الملفات | الحالة |
|---|---|---|---|
| ١ | **جسر الأدوات**: قراءة الأدوات المُعلنة، اختيار الأداة+المعامل، بناء كتلة الطلب | `src/gateway/agent-tool-bridge.ts` | ✅ |
| ٢ | **الوقائع** (اختياري): الجذور والأدوات — مُقاس غير فعّال ⇒ خلف مفتاح | `src/gateway/agent-instructions.ts` | ✅ |
| ٣ | **دور الإصلاح**: تصحيح واحد في نفس المحادثة (رسالة النظام) | `provider-manager.ts` | ✅ |
| ٤ | **إصلاح الوسائط**: `path` بدل `filePath`… ليُنفَّذ النداء أول مرة | `agent-tool-bridge.ts` | ✅ |
| ٥ | **استمرار الحلقة**: نتيجة الأداة تُقدَّم كإخراج العميل | `agent-instructions.ts` | ✅ |
| ٦ | **خادم MCP على نمط CoS**: `instructions` عند initialize + `annotations.readOnlyHint` + وصف أدوات | `src/server/mcp-server.ts`, `workspace-tools.ts` | ✅ |
| ٧ | **رفض مكتوب بنوع ثابت** | `workspace-tools.ts` | ✅ |
| ٨ | **ربط MCP تلقائي لكل الوكلاء** (١١ ملف إعداد، نسخ احتياطية، تخطّي غير المثبّت) | `src/gateway/mcp-auto-config.ts` + `gateway-routes.ts` | ✅ |
| ٩ | **OpenClaw**: كشف + ربط (مزوّد openai-completions + MCP) | `gateway-routes.ts` | ✅ |
| ١٠ | **معرّف نموذج بلا نقطتين** (`chatgpt-web-default` → `chatgpt-web:default`) | `provider-manager.ts` | ✅ |
| ١١ | **مصفوفة الوكلاء**: ٢٩ وكيلًا — كلهم يُربطون بالبوابة (اختبار) | `tests/gateway/agent-matrix.test.ts` | ✅ ٣٢/٣٢ |
| ١٢ | **حارس «وقائع فقط»** (نسخة من اختبار CoS) | `tests/gateway/agent-instructions.test.ts` | ✅ |
| ١٣ | **مصفوفة القياس الحي** (سيناريوهات × وكلاء × EN/AR) | `scripts/agent-bridge-check.ts` | ✅ |
| ١٤ | **توثيق** | `docs/` | ✅ |
| ١٥ | **التزام محلي** (بلا push) | git | ⏳ |

### مفاتيح التشغيل

| مفتاح | القيمة | المعنى |
|---|---|---|
| `ui.agentBridge.environmentBlock` | `false` | نشر وقائع البيئة في رسالة النظام (مُقاس: يضرّ ⇒ معطّل) |
| `ui.agentBridge.repairRefusals` | `true` | دور الإصلاح عند ردّ يشبه الرفض |
| `ui.mcp.workspaceRoots` | `~/Desktop` | الجذور المعتمدة لأدوات الملفات |

---

## ٤. الوكلاء المدعومون (٢٩)

OpenCode · **OpenClaw** · Claude Code · Claude Desktop · Cursor · VS Code (+Cline/Continue/Roo/Copilot)
· Windsurf · Zed · Jan · AnythingLLM · LibreChat · LobeHub · Gemini CLI · Codex · T3 Code ·
Antigravity · Hermes · PI · AlphaCode · Kiro · Python SDK · OpenWebUI · Dify · Flowise · n8n ·
Continue · Roo Code · Aider · SillyTavern

- كلهم: `POST /api/gateway/agents/:id/auto-configure` (المزوّد + المفتاح).
- الذين يدعمون MCP additionally: `POST /api/gateway/mcp/auto-configure` (خادم الملفات).
- OpenClaw: `~/.openclaw/openclaw.json` ⇒ `models.providers.emo` (openai-completions) +
  `agents.defaults.model.primary` + `mcp.servers.emo`.

---

## ٥. حدود العمل

**لا نلمس**: `src/server/app.ts` · `src/server/tool-interpreter.ts` · `src/server/tool-pipeline-logger.ts` ·
`src/arena/web-drivers.ts` · `src/protocol/request-broker.ts` · `src/sessions/*` (مشتركة).

**نلمس**: `src/gateway/*` · `src/server/gateway-routes.ts` · `src/server/mcp-server.ts` ·
`src/server/workspace-tools.ts` · `scripts/*` · `docs/*` · `tests/gateway/*`.

---

## ٦. معيار القبول

1. `POST /v1/chat/completions` بأدوات الوكيل → `finish_reason: tool_calls` ووسائط مطابقة للمخطط.
2. الدورة: نداء → نتيجة من العميل → نداء تالٍ (لا حلقة فارغة).
3. خادم MCP: `initialize` يحمل `instructions`، و`tools/list` يحمل `annotations`، والملفات
   تُقرأ من الجذور المعتمدة فقط، و`.env` محجوب.
4. كل وكيل في المصفوفة يُربط بالبوابة (اختبار آلي) — ٣٢/٣٢.
5. `npx vitest run` كامل أخضر · `npx tsc --noEmit` نظيف · البناء يعمل · البوابة ترتفع.
6. التوثيق محدث والالتزام محلي (بلا push).
