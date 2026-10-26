# src/contracts/prompts：提示词包格式、模板渲染与选包合并的契约层

## 负责什么，不负责什么
- 只放提示词包格式（清单、字符串表、模板、工具说明）、代码侧槽表、模板解析/渲染、继承链校验与合并、冻结提示词集和请求记录的形状。
- 纯契约：无 IO、无时钟、不读磁盘、不选模型、不调用 Kernel；读包/写包、设置路由在 `src/app/`，上下文装配在 `src/core/agent-runtime/`。
- 依赖只能是 `src/contracts/`（check-boundaries 的 Contracts 规则）：不得 import `src/core`、`src/app`、`src/business`、`src/composition`。
- 模板渲染与选包各只有一份正本，就是本目录；上层只能消费，不得复制第二份。

## 文件
- `pack-string.ts` — 从已解析包里取一个固定字符串；缺键是包缺陷，抛错而不是回退。
- `platform-pack.generated.ts` — 由 `resources/prompts/platform/` 经 `scripts/build-platform-prompts.mjs` 生成的平台包常量，运行时直接引用，不读盘。
- `platform-skills.ts` — 平台 Skill 的 id/title/kind/priority/templateId 清单；包只提供文字，身份与选择优先级留在代码里。
- `prompt-pack.ts` — 包清单、链条目、解析结果、`PromptPackSourcePort` 和生成平台包的来源实现。
- `prompt-set.ts` — 冻结的提示词集、模型请求事实、内容类型常量、严格解码、工具说明规范正文/摘要与正文校验。
- `render-template.ts` — 三种模板构造的解析与渲染、槽的 UTF-8 字节范围、渲染错误类型；`secretary-round` 的三个 `task_*` 槽是同一个 `task` 段，必须相邻且保持内部顺序；两个交接模板 `handoff-write-understanding-secretary` 和 `handoff-brief-secretary` 各只有一个 `task_round` 槽，渲染出来是秘书轮 task 段开头的一段材料。
- `resolve-pack.ts` — 继承链（请求包在前、`platform` 最后）的校验与合并，收集全部问题且不抛错。
- `slot-tables.ts` — 代码拥有的槽表：包可以改文字，不能增删槽或改必填性。除 `secretary-round` 的三个 task 槽外，`handoff-write-understanding-secretary` 与 `handoff-brief-secretary` 各有一行必填的 `task_round`。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `renderTemplate` | `src/contracts/prompts/render-template.ts:387` | 按代码槽表渲染一个模板，返回文本和每个 section 的字节范围；槽值原样插入。 | 所有模板渲染：上下文装配、接续简报、审查/提案、设置预览。不要另写替换器。 |
| `packString` | `src/contracts/prompts/pack-string.ts:4` | 取已解析包里的一个固定字符串；缺键抛错，不回落默认文字。 | 渲染器、准备执行读固定文案时；不要另写查表 |
| `parseTemplateV1` | `src/contracts/prompts/render-template.ts:279` | 只解析模板，收齐槽、必填槽和输入模板段序等可独立判定的问题；`secretary-round` 的三个 `task_*` 槽都必须出现（值可空），块分开或换序也算问题。 | 选包校验或需要一次报告多个模板问题时；真正出文字用 `renderTemplate`。 |
| `contextSectionOfSlot` | `src/contracts/prompts/render-template.ts:53` | 把一个槽名投影到它所属的段；`task_round`/`task_batched`/`task_earlier` 都是 `task`。 | 段序计算与校验；不要另写槽到段的映射。 |
| `PromptRenderError` | `src/contracts/prompts/render-template.ts:21` | 模板非法、必填槽为空、段序非法的错误类型，带 `code`/`templateId`/`slot`。 | 把渲染失败映射成 `invalid`，或按 code 收集问题。 |
| `resolvePromptPackV1` | `src/contracts/prompts/resolve-pack.ts:79` | 校验并合并整条包链，最近包覆盖，返回 templates/strings/tools 及 origins/toolOrigins；从不抛错。 | 唯一的选包与继承合并入口；app 读盘后调它。 |
| `createPlatformPromptPackSource` | `src/contracts/prompts/prompt-pack.ts:73` | 只提供生成平台包的 `PromptPackSourcePort`；其他包 id 返回 invalid。 | 没有设置目录的 Host/组合根；有磁盘包时由 app 提供另一个 source。 |
| `PromptPackSourcePort` | `src/contracts/prompts/prompt-pack.ts:64` | 准备执行时取已解析包的端口。 | 运行时只依赖这个端口，不直接读包文件。 |
| `decodePromptSetV1` | `src/contracts/prompts/prompt-set.ts:131` | 严格解码 `PromptSetV1`：未知或缺失字段返回 null；工具名唯一且按 en 升序。 | 读清单/请求记录时；所有清单 loader 共用。 |
| `promptSelectionOf` | `src/contracts/prompts/prompt-set.ts:115` | 从 BoundModel 读 modelId/promptPack/reasoningReplay；没有 selection 时用 configuration.revision、platform、current_run。 | 准备执行选包时；不要另读 selection。 |
| `canonicalToolTextBody` | `src/contracts/prompts/prompt-set.ts:230` | 工具说明的规范正文：description + 按名排序的 parameters。 | 存工具说明或计算 digest 时。 |
| `promptToolTextDigest` | `src/contracts/prompts/prompt-set.ts:238` | 规范工具说明正文的 sha256。 | 冻结集和编辑路由核对同一份工具说明。 |
| `checkPromptBody` | `src/contracts/prompts/prompt-set.ts:249` | 校验存储正文的 content type、digest、UTF-8 大小与 ref 一致，返回正文或 null。 | 读任何冻结提示词正文（模板、字符串表、base、Skill、工具说明）时。 |
| `PROMPT_TEXT_CONTENT_TYPE`、`PROMPT_TOOL_SPECS_CONTENT_TYPE`、`PROMPT_TOOL_TEXT_CONTENT_TYPE` | `src/contracts/prompts/prompt-set.ts:14`、`src/contracts/prompts/prompt-set.ts:16`、`src/contracts/prompts/prompt-set.ts:18` | 三类提示词正文的内容类型常量。 | 写/读 artifact 正文时按类型区分。 |
| `PLATFORM_PROMPT_PACK_V1` | `src/contracts/prompts/platform-pack.generated.ts:4` | 平台包（清单 schemaVersion 1，含 Work/Query 第 2 版模板、两个秘书模板与两个交接模板）的只读解析结果。 | 没有自定义包时的默认包、测试默认值；不要运行时从 resources 现读。 |
| `PLATFORM_SKILLS` | `src/contracts/prompts/platform-skills.ts:6` | 五个平台 Skill 的 id/title/kind/priority/templateId。 | agent-runtime 构造或校验平台 Skill 时。 |
| `TEMPLATE_SLOTS` | `src/contracts/prompts/slot-tables.ts:17` | 每个模板的槽与必填性（代码契约）；两个交接模板各只有一行必填的 `task_round`。 | 包编辑器、解析、渲染校验；包不能改这张表。 |
| 包与解析类型 | `src/contracts/prompts/prompt-pack.ts:9` | `PromptPackManifestV1`、`PromptPackChainEntryV1`、`ResolvedPromptPackV1`、`PromptPackValidationV1`、`PromptPackProblemV1`、`TemplateSlotTableV1`、`ToolTextV1`。 | app 读盘、组合根接线和解析结果传递。 |
| `PromptTextsV1` | `src/contracts/prompts/prompt-set.ts:26` | 渲染器需要的最小文本面：templates + strings。 | 任何渲染入口的类型；resolved pack 结构上满足它。 |
| 请求记录类型 | `src/contracts/prompts/prompt-set.ts:35` | `ModelRequestPromptFactsV1`、`QueryRequestPromptFactsV1`、`PromptRecordRequestV1`。 | 冻结每次模型请求的 digest、删除量和输出上限。 |
| 记录读取类型 | `src/contracts/prompts/prompt-set.ts:64` | `PromptRecordReadResultV1`、`PromptRecordReadV1`、`PromptSetV1`。 | 请求记录读取端口与清单里的 prompt set。 |

## 内部用
无。`TemplateNodeV1`、`SlotRangeV1`、`TemplateParseV1` 是解析/渲染结果的公开形状，其余导出都在上表。

## 不要做
- 不要在 `app`/`agent-runtime` 另写模板替换或包合并；只调 `renderTemplate`、`parseTemplateV1`、`resolvePromptPackV1`（同类错误见 CS-11、FP-17：另写一份局部实现）。
- 不要手改 `platform-pack.generated.ts`；改 `resources/prompts/platform/` 后按脚本重建，生成物是冻结的运行时字节。
- 不要在包里加槽、改必填性或绕过 `TEMPLATE_SLOTS`；包只能改文字。
- 不要把选包或渲染失败吞成默认文字；按 `PromptRenderError.code` 或问题列表上报 `invalid`。
- 不要因为缺 `selection` 就猜模型或包；`promptSelectionOf` 的缺省只用于测试构造的模型。
- 不要让包携带代码、路由或模型绑定；包只有模板、字符串表和工具说明。
- 没有独立的“选包”路由：选包设置走 `models/save` 的 `promptPack`，模型选择走 `models/select`（都在 `src/app/`）；本层只校验、合并和渲染，不发布路由。
