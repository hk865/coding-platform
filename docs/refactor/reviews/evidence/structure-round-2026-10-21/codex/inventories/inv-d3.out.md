只读盘点已完成；未改文件，未运行测试、构建、git 或网络操作。

有两点应先写进任务书：**冻结后的 D3 已大于原结构审查的估量；“组装器变薄、每组不超过 1,200 行、不同组不编辑同一文件”三个条件无法同时满足。** 原估量只计算约 760 行渲染、700 行事实读取及 84 行 guide 的搬移；冻结规格又明确加入完整平台包和渲染器。依据：`.lead-ref/d84-refute-D.out.md:7`、`docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:284–296`。当前组装器的工厂直到 `src/core/agent-runtime/context-assembler.ts:1669` 才开始，结束于 `:2036`；压薄时，单个旧文件的删除量就超过一组预算。

下面把“文字一段”定义为表中的一个**迁移文字族**，不是一个字符串字面量。“已有字节覆盖”表示至少一个分支有独立字面期望的完整输出或完整输出单元相等断言，**不表示该族所有分支均已覆盖**。

**1．每一族要搬的文字**

表中：

- “字符串表”指 `resources/prompts/platform/strings.json`；含插值的事实句，保留代码拼接，把固定前缀、后缀、标签分别搬入字符串表，不增加另一套格式语法。
- “工具文件”指 `resources/prompts/platform/tools/<name>.json`。
- 除明确写出的换行外，不补末尾换行；不做 `trim`、换行统一或标点修正。
- “无”指未找到独立完整字节断言；包含断言、长度断言、引用生产常量构造期望不算。

| # | 文字族、当前位置、发出函数 | 连接和条件 | 去处 | 现有独立字节证据 |
|---|---|---|---|---|
| 1 | Work、Query 前言；`src/core/agent-runtime/context-assembler.ts:98–100`，由 `renderContext` 发出 | 前言内部一个空行；其后再接 `\n\n`；无结尾 LF | 字符串表，主模板取槽位 | 无。现有期望引用生产 `WORK_CONTEXT_PRELUDE`：`tests/runtime/S3-context-assembler.test.ts:459–463` |
| 2 | 主段标题、Question、Context omissions；`src/core/agent-runtime/context-assembler.ts:82–92`、`:349`、`:1996` | 普通段为标题＋`\n`＋正文；段间 `\n\n`；Question 是 Goal 正文内部的单 LF 子段 | 字符串表；三个主模板控制段序 | `tests/runtime/S3-context-assembler.test.ts:600–609`、`:744–759`；Question 尚无完整独立期望 |
| 3 | “另有 N 条，用‘看’读”；`renderContext`：`src/core/agent-runtime/context-assembler.ts:298`、`:345`、`:370`；`renderAttentionChanges`：`:570–572` | 普通省略行前 LF；兜底带 `${sectionName}: `；attention 放入 JSON 的 `hint`，仍用原 `JSON.stringify` | 字符串表 | Context 分支：`tests/runtime/S3-context-assembler.test.ts:744–759`；attention JSON 无完整字节期望 |
| 4 | Runtime binding、Role specification 及角色字段标签；`rolePayload`，`src/core/agent-runtime/context-assembler.ts:623–660` | 段内 LF，四块间双 LF；tools/writeScope 用 `, `；材料和输出用 `; `；保留 `(none)`、原 JSON 序列化 | 字符串表 | 无 |
| 5 | 五种平台角色的 label、purpose；`platformRoleProfile`，`src/core/agent-runtime/role-profiles.ts:19–73` | 原样返回短句；不搬职责枚举、template id 或 revision | 字符串表 | 字面表 `tests/work-graph/S3-role-profiles.test.ts:83–98`，相等断言 `:164–173` |
| 6 | Goal、Task、Query focus/plan 的字段标签及缺省短语；`goalPayload`、`taskPayload`、`queryFocusLines`、`queryPlanSummary`，`src/core/agent-runtime/context-assembler.ts:734–743`、`:787–829`、`:904–918` | 字段 LF；列表沿用逗号或 canonical JSON；保留 `(未声明)`、`未定义`、`(none)`、`null` 的不同拼法 | 字符串表 | 无 |
| 7 | 当前理解的 scope 标签、版本尾缀、不可作现行结论和缺理解提示；`withNoteVersion`、`understandingSourceLabel`、`understandingLine`，`src/core/agent-runtime/context-assembler.ts:676–718` | `（noteId vN）` 紧接标签；按 eligible、scope、pointer/body 条件分支；正文原样插入 | 字符串表 | 无。现有相关检查是包含断言：`tests/runtime/S4C2-assembly.test.ts:237–238`、`:426` |
| 8 | 理解/规范的空值及项目省略提示；`notesGoalText`，`src/core/agent-runtime/context-assembler.ts:721–731` | 理解最多三条，规范随后，LF 连接；保留 `(not_implemented)`、`(none)` 和“读项目” | 字符串表 | 无 |
| 9 | 初始化回答格式完整 guide；`INITIAL_COORDINATION_RESPONSE_GUIDE`，`src/core/agent-runtime/query-preparation.ts:50–133`；使用处 `:309–311` | guide 是整块原文，JSON 示例空格、引号、换行全部保留；仅 initial_coordination 在问题后加 `\n\n`＋guide | `initial-planning-answer` 模板 | 无。`tests/work-graph/R5b-initial-plan.test.ts:271` 引用生产常量；`:445` 检查示例结构 |
| 10 | 简报标题、“继续之前”标题及四条固定说明；`renderContinuationBriefZh`，`src/contracts/continuation-brief.ts:343–349`、`:382–384` | 首行为标题；第二行 marker；尾块前一空行；LF 连接，无末尾 LF；**保留文件可能变化那句** | `continuation-brief` 模板 | `tests/runtime/K3-15-blocked-sentence-pure.test.ts:23–56` |
| 11 | 简报失败类、发起者、停止者、工具结果、副作用、等待及 checkpoint 标签；`src/contracts/continuation-brief.ts:336–340`、`:351–360`，由简报辅助函数使用 | 枚举到中文字面的映射不变；枚举本身不搬 | 字符串表 | `tests/contracts/A2-rework-contract-helpers.test.ts:491–493`；完整简报样本见 `tests/runtime/K3-15-blocked-sentence-pure.test.ts:23–56` |
| 12 | 简报摘要及“上一次执行、停在哪里、工具调用、检查、重新入队、工作区、已接受输入”的固定片段；`briefBodyZh`，`src/contracts/continuation-brief.ts:563–700` | section 先空行再 `### `；列表原顺序；null、空数组、来源 hops、暂停、预算、等待、工作区状态各保留原分支 | 字符串表；正文作为模板槽位 | 普通分支完整样本：`tests/runtime/K3-15-blocked-sentence-pure.test.ts:27–49` |
| 13 | 简报结束方式、四种接续方式、单个工具调用标签；`endingZh`、`continuityZh`、`toolCallZh`，`src/contracts/continuation-brief.ts:941–982` | 原句号、括号；工具调用字段用 `;`；按 outcome/origin/session 状态分支 | 字符串表 | 普通结束及接续样本：`tests/runtime/K3-15-blocked-sentence-pure.test.ts:28–32` |
| 14 | 简报超长省略、截断、无值和多项提示；`omittedLine` 及 clip/list 辅助，`src/contracts/continuation-brief.ts:503–505`、`:544–560` | 保留 `……` 与 `…` 的区别；现有字符截断、`\r\n|\n` 后两空格缩进、`、` 连接和 caps 不变 | 字符串表 | 截断样本被完整输出锁住：`tests/runtime/K3-35-renderer-boundary-pure.test.ts:185–225`、`:267–277`；超长正文省略句仍需补对照 |
| 15 | 异常锚点原因、混合改动警告、结尾、标题和省略句；`src/contracts/continuation-brief.ts:703–749` | 原锚点次序；按改动已知/未知分支；块间 LF；省略行仍按现有预算删减 | 字符串表；异常块槽位 | `tests/runtime/K3-35-renderer-boundary-pure.test.ts:185–197`、`:267–277` |
| 16 | 接续简报中的 K3 核对、处置、文件/摘录/批注、作用对象、平台条目及拦截警告；`src/contracts/continuation-brief.ts:765–842`、`:883–925` | 现有映射、条目顺序、可选行、60 字附言裁剪、必留行和预算优先级不变 | 字符串表；复核块槽位 | `tests/runtime/K3-35-renderer-boundary-pure.test.ts:200–225`、`:267–277`；处置变体见 `tests/runtime/K3-15-disposition-effects-pure.test.ts:197–221` |
| 17 | 批准方法的“方案、目录”文字；`approvedMethodLinesZh`，`src/contracts/continuation-brief.ts:864–870` | cwd 缺省 `.`；cwd 和 command 的换行都加两空格；命令不裁剪 | 字符串表 | `tests/runtime/K3-16-approved-method-lines.test.ts:16–20` |
| 18 | “被拦的命令”标题、每条状态、已声明形式和额外条数提示；`blockedCommandLinesZh`，`src/contracts/continuation-brief.ts:517–542` | alias＋runId 前八位；声明形式去重、UTF-8 裁到 160 字节、最多三种；最多 16 条；保留请求工具名 | 字符串表；被拦块槽位 | 无完整独立输出期望；现有容量断言见 `tests/runtime/K3-15-blocked-omission.test.ts:87`、`:106` |
| 19 | 独立 K3 输入共用前言、工作区采集及已写结论；`renderUnknownCallReviewZh`，`src/contracts/core/prepared-execution.ts:97–124` | LF 行数组；块间空行；`是/否`、`（无）`、`、` 及另有条数保持原样 | 两个 K3 模板＋字符串表 | `tests/runtime/K3-16-proposal-input.test.ts:134–153`、`:202–228` |
| 20 | K3 review 调用列表、未展开/截断警告及两问；`src/contracts/core/prepared-execution.ts:155–172` | 每项一至两行；同批 `、#`；最后两问，无结尾 LF | `unknown-call-review` 模板＋字符串表 | 普通分支完整期望：`tests/runtime/K3-16-proposal-input.test.ts:202–228` |
| 21 | K3 proposal 指导、原命令、摘要标记、附言、批注和平台条目；`src/contracts/core/prepared-execution.ts:128–153` | targets/platformTargets 数字排序；命令 LF 缩进；personText 仅非 null 且非空出现；批注 path 缺省“记录” | `unknown-call-proposal` 模板＋字符串表 | `tests/runtime/K3-16-proposal-input.test.ts:134–153` |
| 22 | 咨询消费指导；`createConsultationConsumer` 内消费路径，`src/business/workflow/consultation.ts:447` | 单行插入 messageId 和 `JSON.stringify(sourceRef)`；isolated inquiry 或 response 分支仍直接用 question | `consultation-received-input` 模板 | 无 |
| 23 | “用户答复”前缀；`formatDecisionResponseInput`，`src/core/agent-runtime/execution-inputs.ts:58–59` | 固定 `用户答复\n`＋原 `canonicalJson(body)`；不补末尾 LF | `user-decision-response` 模板 | `tests/runtime/S5-user-message-tools.test.ts:164–170`、`:188`、`:209` |
| 24 | 缺输入提醒；`missingInputReminder`，`src/core/agent-runtime/context-assembler.ts:831–846` | 单行；无上游、无运行记录、运行状态及可选 outcome 各保留；英文标点和空格不改 | 字符串表 | 无 |
| 25 | 未加载/未接入及架构提醒不可用；Work 配方，`src/core/agent-runtime/context-assembler.ts:1712–1726`、`:1746–1747` | 目标正文或独立 reminder row；仍在现有能力/事实条件下产生 | 字符串表 | 无 |
| 26 | “当前理解该更新了”；`optionalRowsFromExtensions`，`src/core/agent-runtime/context-assembler.ts:852–887`，文字在 `:884` | 单行＋原 anchorKey；不改变 reminder key 和排序 | 字符串表 | 无 |
| 27 | 架构提醒类别、移动/发现句、相对时间、未观测及省略句；`architectureReminderRowEntries` 及辅助，`src/core/agent-runtime/architecture-reminders.ts:26–31`、`:95–158`、`:188–204` | 原分钟/小时/天阈值；“不确定”条件后缀；先排序再取十条；省略行最后 | 字符串表 | `tests/work-graph/S8A-L8-reminders-public.test.ts:26–31`、`:66`、`:111–113`、`:129–144` |
| 28 | 一般注记的 stale/conflict/sourceUnavailable 警告；`generalWarningLabel`，`src/core/work-graph/notes/note-read-model.ts:1880–1886` | 优先级 stale → conflict → sourceUnavailable；单行，不拆警告和 conclusion | 字符串表 | stale 完整标签：`tests/work-graph/S4C2-memory-material.test.ts:150`；另外两种需补对照 |
| 29 | 注记类型名、锚点名称及“已删”；`renderNoteHeader`，`src/contracts/note.ts:109–133` | `<类名>(<锚点>)<!>：<结论>`；structural 才有 `!`；symbol/deleted 条件不变 | 字符串表 | `tests/work-graph/S4A-note-history.test.ts:318–339` |
| 30 | 四个白板工具说明；`createWhiteboardTools`/`definitionFor`，`src/core/agent-runtime/whiteboard-tools.ts:433–445` | 每个说明是一个完整字符串，无 LF | `query_task_graph`、`query_ready_tasks`、`propose_future_plan`、`apply_future_plan` 四个工具文件 | 无 |
| 31 | 白板参数说明，包括大段 draft 格式；`src/core/agent-runtime/whiteboard-tools.ts:197–199`、`:220–243` | `.describe` 内容逐字搬；draft 中现有换行保留；共享 pin 说明在使用它的工具文件中原样保存 | 相应白板工具文件 | 无 |
| 32 | record_note 说明；`createNoteTools` 使用的说明，`src/core/agent-runtime/note-tool.ts:187–199`、`:307–308` | 字符串片段直接相加；片段末尾空格就是分隔符 | `record_note.json` | 无 |
| 33 | project_source 说明；`createProjectSourceTool`，`src/core/agent-runtime/project-source-tool.ts:228–237` | 单个长字符串；不能按源文件排版插入 LF | `project_source.json` | 无 |
| 34 | 八个探索工具说明；`createExplorationTools`，`src/core/agent-runtime/exploration-tools.ts:167–209` | `read_source`、`cpp_index`、`python_index`、`code_index`、`source_excerpt`、`list_files`、`search`、`symbols` 各一字符串 | 八个工具文件 | 无 |
| 35 | list_files/search 的 prefix 参数说明；`src/core/agent-runtime/exploration-tools.ts:179`、`:186` | 两段文字不同，不能合成一个近似说明 | 两个对应工具文件 | 无 |
| 36 | 只读命令工具说明；`createReadonlyCommandTool`，`src/core/agent-runtime/readonly-command-tool.ts:242`、`:354–359` | 六段直接相加；保留句间空格和 `git's` | 对应工具文件 | 无；片段包含断言见 `tests/runtime/K-readonly-command.test.ts:531–535` |
| 37 | 只读命令 command/cwd/timeout 参数说明；`src/core/agent-runtime/readonly-command-tool.ts:59–62` | 原 `.describe` 字符串；不改 schema 链的顺序 | 同一工具文件 | 无 |
| 38 | 六个邮箱工具说明；`definitionFor`，`src/core/agent-runtime/communication-tools.ts:45–52`、`:384–391` | 今天是 `Session mailbox: ${name}`；文件中存六份最终展开文字 | 六个邮箱工具文件 | 无 |
| 39 | 三个用户决定工具说明；`decisionDefinitionFor`，`src/core/agent-runtime/communication-tools.ts:59–63`、`:480–486` | 今天是 `User decision: ${name}`；文件中存三份最终展开文字 | `send_user_message`、`read_user_decision`、`record_decision_application` | 无 |
| 40 | look_graph/find_graph 说明；`createGraphTools`/`definitionFor`，`src/core/agent-runtime/graph-tools.ts:326–334`、`:503` | 原单字符串，内嵌反引号、引号、路径语法不动 | 两个工具文件 | 无 |
| 41 | Session 发现两个工具说明；`createSessionDiscoveryTools` 内定义，`src/core/agent-runtime/session-discovery-tools.ts:132–139` | 原 name 条件选择变成等价静态取值；不改变工具生成条件 | `find_related_sessions`、`read_session_card` | 无 |
| 42 | record_unknown_call_review 说明及参数说明；`reviewDefinition`，`src/core/agent-runtime/unknown-call-review-tools.ts:51–59`、`:209–216` | 原字符串相加的空格不改；四处参数说明保留 | `record_unknown_call_review.json` | 无 |
| 43 | propose_safer_method 说明及参数说明；`proposalDefinition`，`src/core/agent-runtime/unknown-call-review-tools.ts:68–74`、`:295–303` | 原字符串相加；四处参数说明保留 | `propose_safer_method.json` | 无 |
| 44 | request_command_rerun 说明及参数说明；定义路径，`src/core/agent-runtime/command-rerun-tools.ts:39–44`、`:203–209` | 五处参数说明，包括可选对象自身的说明；原字符串相加 | `request_command_rerun.json` | 无 |
| 45 | 书记提醒完整正文；`runScribeReminderCheck`，`src/app/host.ts:1374`、`:1434–1435`；marker 在 `:190` | 单行；两个 `String(count)`；anchor 首二十个用 `、`；空 anchor 仍保留“锚点：” | `scribe-reminder` 模板；marker 放字符串表且恢复逻辑共用 | 无完整字节断言；恢复识别依赖前缀：`src/app/host.ts:1342` |

第 28、29、31、35、37、39、44、45 项尤其容易漏掉。工具包应包括 **31 个工具文件**，不是只按 F15 列举的工具类别取几个代表。工具名称的现有来源分别见上述第 30–44 行。

不搬的内容和边界：

- Kernel 基础提示词、内置工具说明、`resources/skills/platform-*`，规格明确留给 PC；依据 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:297–305`。`vendor/coding-agent/dist` 不编辑。
- 格式版本、协议 marker、JSON 字段名、枚举值、工具名称和错误消息继续留在代码。尤其 `[attention s3-v1]` 和 continuation marker 同时承担协议识别，不能作为可编辑文案：`src/core/agent-runtime/context-assembler.ts:532`、`src/contracts/continuation-brief.ts:299–303`。书记 marker 虽搬入固定平台字符串表，但恢复识别必须取同一个值：`src/app/host.ts:190`、`:1342`。
- 已安装 RoleSpec、用户正文、注记正文、命令、证据和理由都是槽位数据，不能搬成平台文案；现有插入路径见 `src/core/agent-runtime/context-assembler.ts:636–648`、`src/contracts/core/prepared-execution.ts:139–146`。
- `renderUnderstandingBody` 的五段正文格式属于**存储内容格式**，此次由结构 C1 纯搬函数即可，不扩大为可编辑提示词。它用于验证和写入正文：`src/core/work-graph/notes/note-service.ts:352–353`、`:393–397`、`:1482`。
- `LOCAL_WORKBENCH_GUIDANCE` 目前是本地 Role 身份摘要输入，直接消费点是 `sha256Hex`，不应顺手改为模型提示模板：`src/app/runtime-configuration.ts:92–107`。

**2．建议的十个模板和槽位**

模板全部在 `resources/prompts/platform/templates/`；`pack.json` 中版本均为 1、`extends: null`。包形状依据冻结接口 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:340–347`。

“必填”针对**已格式化槽位**，不针对原始业务字段。比如 role 原始正文可以为空，但 `## Runtime context\n` 使 role 槽位非空。

| 模板 id | 槽位：必填/可选及填充者 | 配方 |
|---|---|---|
| `work-input` | 必填 `role`：完整标题＋正文。可选 `prelude`：原调用参数，模板仍固定输出其后的双 LF；可选 `goal/task/footprint/notes/reminders/inputs/continuation/unknown_call_review`：代码完成裁剪后传入，存在时自带前导 `\n\n` | 普通 Work、接续 Work、K3 review/proposal-purpose Work；旧 `renderContext` 也通过此模板兼容任意 prelude |
| `query-planning-input` | 必填 `role`；可选 `prelude/goal/task/footprint`。goal 已含 Question；task 是 plan summary；footprint 是顶层模块卡 | 现有 planning Query |
| `query-copy-input` | 必填 `role`；可选 `prelude/goal/task`。goal 已含 Question；task 是 focus 行 | 现有其余 Query/copy |
| `initial-planning-answer` | 无槽位，84 行原文整体保存 | initial_coordination 准备阶段追加 |
| `continuation-brief` | 必填 `marker`；可选 `body/bodyOmission/anomalies/review/blocked/blockedOmission`；各槽位携带现有布局需要的前导 LF；标题及固定尾块在模板内 | `renderContinuationBriefZh` 已有预算算法选出各块后调用 |
| `unknown-call-review` | 必填 `workspaceLines/writtenLines`，空集合仍有原“（无）”；可选 `items`，包含原行间 LF | K3 phase=review |
| `unknown-call-proposal` | 必填 `workspaceLines/writtenLines`；可选 `targets/personNote/annotations/platformTargets`；每个存在块携带原前导 LF | K3 phase=proposal |
| `consultation-received-input` | 必填 `messageId/sourceJson`，后者保持原 `JSON.stringify` 结果 | 原咨询消费指导分支 |
| `user-decision-response` | 必填 `bodyJson`，由原 `canonicalJson` 产生 | 用户决定答复输入 |
| `scribe-reminder` | 必填 `marker/pendingCount/updateDueCount`；可选 `anchors`，由原截取和 join 产生；“锚点：”在模板中无条件保留 | Host 书记提醒 |

主模板实际可以用相邻槽位表达当前布局，例如：

```text
{{prelude}}

{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{reminders}}{{inputs}}{{continuation}}{{unknown_call_review}}
```

文件末尾不能因编辑器习惯多一个 LF。完整标题和前导分隔符由槽位构造，因此不会因空正文错误地省掉一个存在的段。当前 `goal/task` 是判断 `null`，后缀也是判断 null/undefined，而不是判断字符串是否为空：`src/core/agent-runtime/context-assembler.ts:325–334`、`:377–390`。

P1 的三种构造**足以表达这些输出**，但必须保留以下适配规则：

1. **空但存在的后缀**：旧 `continuationSuffix: ''` 仍加两个 LF，并生成零长度 section。必须传入值为 `"\n\n"` 的槽位，不能直接用 `{{#continuation}}` 判断原正文；依据 `src/core/agent-runtime/context-assembler.ts:377–381`。
2. **省略标记不是可选正文**：没有一行能装入时，原实现把 omissions 附到最后一个必需段，并扩大该段区间；不能把它换成独立 section。依据 `src/core/agent-runtime/context-assembler.ts:338–358`。
3. **循环、排序和预算留在代码**：模板语言没有这些能力；原算法还会扫描所有前缀长度，不能改为“第一次超限就停”。依据 `src/core/agent-runtime/context-assembler.ts:275–310`。
4. **槽位内容不再解析**：用户正文里的 `{{x}}`、命令中的花括号只是数据；只解析模板源。语法限制针对模板正文，依据规格 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:83–88`。
5. **整行块标记去掉自身换行**：保留正文原有 LF，不能对展开结果清理空行。平台 v1 不需要为了展示语法而人为加入 tool 条件。
6. **不能给现有指导增加工具守卫**：例如当前 proposal 指导无条件提到 `propose_safer_method`；改成工具不存在就隐藏，会改变字节。现状：`src/contracts/core/prepared-execution.ts:128–130`。
7. **sectionRanges 按 UTF-8 累积**：通用渲染器记录槽位落点；适配器扣掉槽位携带的分隔符，再恢复旧 section 元数据。不能用全文搜索定位重复正文；旧区间算法见 `src/core/agent-runtime/context-assembler.ts:313–321`、`:366–390`。

因此，没有“现有文字无法由三构造表达”的地方；**无法纯靠模板语言完成的是裁剪、排序、列表展开和 section 元数据归属**。这些仍在纯代码层。若任务书要求连这些也挪进模板，便超出 P1。

**3．拆分模块和调用配方**

下面都是建议路径。为避免 DSH 重写类型，已导出函数须照原签名搬；新导出的原私有函数也保留原参数、返回联合和可选字段。

| 建议模块 | 导出及签名约束 | 从当前文件搬什么 |
|---|---|---|
| `src/contracts/prompts/prompt-pack.ts` | `PromptPackManifestV1` 按冻结接口；`ResolvedPromptPackV1` 是只读的模板正文、字符串和工具文字数据 | 新增；冻结形状见规格 `:340–347` |
| `src/contracts/prompts/render-template.ts` | `renderTemplate(resolved: ResolvedPromptPackV1, templateId: string, slots: Readonly<Record<string,string>>, finalToolNames: readonly string[]): {text: string; sectionRanges: …}`；ranges 明定为 UTF-8 槽位区间 | 新增；函数入口按规格 `:377–378`；D3 只接固定 v1，不接配置、路由或继承解析 |
| `src/contracts/prompts/platform-pack.generated.ts` | `PLATFORM_PROMPT_PACK_V1: ResolvedPromptPackV1`，静态只读数据 | 从资源生成；运行时不读磁盘 |
| `src/core/agent-runtime/context-types.ts` | 原样导出 `ArchitectureReminderReadPort`、`ContextAssemblerDependencies`、`AssembledContextV1`、`ContextAssembler`；内部用 `OptionalRow`、`OptionalSectionName`、时钟类型 | `src/core/agent-runtime/context-assembler.ts:108–156`、`:162–167`、`:594` |
| `src/core/agent-runtime/context-support.ts` | `utf8Bytes(string):number`；`byKey({key},{key}):number`；`messageOf(unknown):string`；`isRecord(unknown):value is Record<string,unknown>`；`rejected(code,reason):CoreRejection`；`mapRead(ReadResult<unknown>):CoreRejection`；`canonical(unknown,string):string`；`sortedSources(readonly ContextSourceV1[]):ContextSourceV1[]` | `src/core/agent-runtime/context-assembler.ts:169–189`、`:212–224`；不合并错误分支 |
| `src/core/agent-runtime/context-rendering.ts` | 原 `renderContext(input):{input,sections,residentBytes,totalBytes}`；`renderAttentionChanges(AttentionChangesV1):string`；全部原格式常量；内部模板选择入口；`assembleSections` 保留原参数形状 | `src/core/agent-runtime/context-assembler.ts:79–100`、`:266–395`、`:532–588`、`:935–951` |
| `src/core/agent-runtime/context-fact-text.ts` | `effectiveDuty(role,configuration,sessionRole):{duty}\|{rejection}`；`rolePayload(role,permissions,duty,number):string`；`goalPayload(GoalSnapshot,number,ContextExtensionsV1):string`；`taskPayload(PlanRevisionSnapshot,TaskExecutionRecord,graph):string|null`；`queryFocusLines(QueryPreparationFacts,graph):string|null`；`queryPlanSummary(PlanRevisionSnapshot):string` | 角色/任务纯格式化：`src/core/agent-runtime/context-assembler.ts:596–829`、`:904–918` |
| 同上 | `notImplementedExtensions():ContextExtensionsV1`；`noteSourcesOf(notes,readonly NoteIndexRowV1[]):ContextSourceV1[]`；`declarationsForTask(plan,string):InputDeclarationV1[]`；`missingInputReminder(selection,readonly TaskExecutionRecord[]):OptionalRow`；`optionalRowsFromExtensions(extensions):{footprint;notes;reminders}`；`annotations(extensions):ContextAssemblyBindingV1['extensions']`；`topLevelModuleCards(architecture):OptionalRow[]` | `src/core/agent-runtime/context-assembler.ts:191–210`、`:233–259`、`:757–785`、`:831–900`、`:921–933`；只在需要跨模块调用处导出 |
| `src/core/agent-runtime/context-review-input.ts` | 原 `ReviewCommandFactV1`、`REVIEW_COMMAND_MAX_BYTES`；`buildUnknownCallReviewInputV1(input):UnknownCallReviewInputV1`；`trimUnknownCallReviewInput(UnknownCallReviewInputV1):UnknownCallReviewInputV1|null`；build 参数完整照搬 | `src/core/agent-runtime/context-assembler.ts:140`、`:402–526` |
| `src/core/agent-runtime/context-workspace-facts.ts` | 原 `BriefWorkspaceFactsOutcome`；`briefWorkspaceFactsFor(deps,now,record,signal):Promise<BriefWorkspaceFactsOutcome>`；`readReviewCaptureChanges(deps,review|null):Promise<CapturedPathV1[]|null>`；`unknownCallReviewFilesFor(deps,record,previous,review|null,signal):Promise<ReadonlyMap<…>|null|'cancelled'>` | `src/core/agent-runtime/context-assembler.ts:967–1124`；classify/baseline helper 留私有 |
| `src/core/agent-runtime/context-history-facts.ts` | 原 `readKernelCommandFacts(deps,{signal?},{session,calls}):Promise<ReadResult<ReadonlyMap<string,KernelCommandFactV1>>>`；`sessionBasisForContext(deps,record,basis,signal):Promise<SessionBasisOutcome>`；`reviewSessionBasis(deps,record,original,signal):Promise<sessionBasis|undefined|'cancelled'>`；原 `archiveOriginSkipsHistorySeed(…) : boolean`、`runEnteredKernel(…) : boolean` | `src/core/agent-runtime/context-assembler.ts:959–965`、`:1126–1345`、`:1452–1470` |
| `src/core/agent-runtime/context-review-recipe.ts` | `assembleReviewForContext(deps,ctx,record,{reviewRef,phase,round}):Promise<{ok:true;review;text;sessionBasis}|{ok:false;rejection}>`；`reviewCommandFacts` 私有 | `src/core/agent-runtime/context-assembler.ts:1347–1442` |
| `src/core/agent-runtime/context-continuation-recipe.ts` | 原 `readTaskBlockedCommands(deps,ctx,{task,workspace,afterRunBlocked,reviews?}):Promise<ReadResult<ContinuationBlockedCommandLineV1[]>>`；`assembleBriefForContext(deps,now,ctx,record,taskReviews?):Promise<{ok:true;brief;sessionBasis;anomalyAnchorRefs}|{ok:false;rejection}>` | `src/core/agent-runtime/context-assembler.ts:1484–1663` |
| `src/core/agent-runtime/context-work-recipe.ts` | `assembleWorkContext(deps,clock: (()=>string)|undefined,ctx,input):Promise<ReadResult<AssembledContextV1>>`；input 照内部 assembleTask，含 `taskReviews?` | `src/core/agent-runtime/context-assembler.ts:1672–1950` |
| `src/core/agent-runtime/context-query-recipe.ts` | `assembleQueryContext(deps,ctx,input):Promise<ReadResult<AssembledContextV1>>`；input 照原 assembleQuery | `src/core/agent-runtime/context-assembler.ts:1952–2024` |

`context-assembler.ts` 只留下旧路径转出口、`createContextAssembler(deps):ContextAssembler`、一次获取原 clock 的位置，以及 `readAttentionGraph` 的原能力检查和委派。依据：`src/core/agent-runtime/context-assembler.ts:1669–1670`、`:2026–2035`。

这里有一个容易“顺手修正”的签名差异：公开 `ContextAssembler.assembleTask` 没有 `taskReviews`，内部实现有。此次保持公开形状，内部配方继续接收它，不能借拆分扩展公开接口。依据：`src/core/agent-runtime/context-assembler.ts:143–147`、`:1672–1677`。

调用配方须明确：

| 调用 | 原行为及冻结要求 |
|---|---|
| Work | 保留 duty 检查 → graph facts → 提醒 → 上游输入事实 → 输入正文 → 接续/复核 → 渲染和 binding 的顺序。不能并发这些读取，也不能先预取所有事实。当前位置：`src/core/agent-runtime/context-assembler.ts:1684–1706`、`:1736–1775`、`:1790–1851`、`:1859–1948` |
| Query planning | **同时**满足 graph facts 非 null 和 execution.kind=initial_coordination 才走 planning；Goal 内追加 Question，task 用 plan summary，footprint 用顶层模块卡。`src/core/agent-runtime/context-assembler.ts:1993–2011` |
| Query copy | 上述条件不成立就仍为 copy；focus 行保留原顺序，不增加 inputs、一般注记或提醒。`src/core/agent-runtime/context-assembler.ts:1997–2023` |
| secretary | D3 不新增独立秘书调用配方。当前 Query 分流只产生 planning/copy，duty 另存；不能看到 secretary duty 就改 callKind。`src/core/agent-runtime/context-assembler.ts:1962–1969`、`:2011–2012`。秘书新模板明确归 6A：规格 `:306` |
| K3 review/proposal | 是 Work purpose 的两种尾段，不改成新 Query/review callKind；按 phase 选两个 K3 模板。现有 review 读取与构造顺序：`src/core/agent-runtime/context-assembler.ts:1394–1441`；Work binding：`:1929–1932`；测试锁定 work：`tests/runtime/K3-review-preparation.test.ts:206` |

必须保留旧路径的导出：

| 导出 | 已有测试导入证据 |
|---|---|
| `CONTEXT_FORMAT_VERSION`、`CONTEXT_SECTION_HEADERS`、`CONTEXT_SECTION_ORDER`、两个 prelude、`createContextAssembler`、`renderContext`、`renderAttentionChanges` | `tests/runtime/S3-context-assembler.test.ts:58–60` |
| `buildUnknownCallReviewInputV1`、`trimUnknownCallReviewInput` | `tests/runtime/K3-16-proposal-input.test.ts:21–23`、`tests/runtime/K3-review-input-pure.test.ts:16–18` |
| `readKernelCommandFacts` | `tests/helpers/B2-crr-world.ts:24`、`tests/runtime/K3-B3-runtime-fail-closed.test.ts:19` |
| `ContextAssemblerDependencies`、`ContextAssembler`、`ArchitectureReminderReadPort` | `tests/runtime/S3-context-assembler.test.ts:44`、`tests/helpers/WP1-units-fixture.ts:41`、`tests/helpers/S8A-L8-reminder-world.ts:24` |
| `INITIAL_COORDINATION_RESPONSE_GUIDE`，仍从 query-preparation 导出 | `tests/runtime/S3-context-assembler.test.ts:45`、`tests/work-graph/R5b-initial-plan.test.ts:30` |

除此之外，**当前已导出的其余符号也全部转出口**，包括 `briefWorkspaceFactsFor`、`BriefWorkspaceFactsOutcome`、`readTaskBlockedCommands`、`archiveOriginSkipsHistorySeed`、`runEnteredKernel`、`ReviewCommandFactV1`、`REVIEW_COMMAND_MAX_BYTES`；原声明见 `src/core/agent-runtime/context-assembler.ts:140`、`:402`、`:967–974`、`:1452–1490`。这样无需为了搬家修改生产消费者。

`renderContinuationBriefZh`、`approvedMethodLinesZh` 和 `renderUnknownCallReviewZh` 的旧出口也不变。这次只替换文案来源，不顺带完成后续 B4 的整个合同文件拆分；B4 的独立边界见 `.lead-ref/d84-condensed.md:24`。

**4．字节证明**

现有独立证据覆盖上表 **18 族**：2、3、5、10–17、19–21、23、27–29。覆盖的是表中列出的样本和输出单元。

尤其不能误算：

- CA01 的结构和段标题是字面期望，但 prelude 来自生产常量：`tests/runtime/S3-context-assembler.test.ts:459–463`、`:600–609`。
- 初始化 guide 的包含断言也引用生产常量：`tests/runtime/S3-context-assembler.test.ts:845–848`。
- 简报容量满足、substring 存在，不等于完整 bytes 相同；已有完整极限对照应保留作为强证据：`tests/runtime/K3-35-renderer-boundary-pure.test.ts:267–281`。

建议 lead 做一次**不落入测试树的旧/新差分程序**。这是后续验收方案，本轮未执行：

1. 基线必须是 **SC 合入后的旧 D3 树**，候选是同一 SC 基线上的新 D3。通过一次性 stdin 程序加载两份构建产物，逐输入比较 UTF-8 `Buffer`；不改测试或断言。
2. 纯 renderer 输入矩阵：
   - `renderContext`：空/非空 prelude；role 空正文；goal/task 的 null、空串、普通文本；四种 optional 单独及组合；notes 逆序与其他行逆序；预算 0、标记刚能放下、每个候选前缀字节长度的前一/正好/后一；continuation/review 的 absent、null、空串、非空及两者同在。必要性来自原 null 判断、排序和逐前缀预算：`src/core/agent-runtime/context-assembler.ts:275–310`、`:325–390`。
   - 简报：枚举分支、空与非空列表、四种 session continuity、各 workspace 状态；anomalies/review/blocked 的所有有无组合；16 KiB 附近、160 字节声明形式、16 条被拦命令边界；沿用现有普通和极限样本输入。边界算法见 `src/contracts/continuation-brief.ts:382–560`。
   - K3：review/proposal；expanded/truncated/unexpanded；空命令、cwd null/空/多行；personText null/空/非空；乱序 targets；空/非空 annotations、platformTargets；summary 回退。依据 `src/contracts/core/prepared-execution.ts:97–172`。
   - 所有事实格式化：五种 duty、resolved/legacy role、注记各状态/锚点、提醒时间阈值两侧、空锚点和二十个以上锚点；覆盖上表未独立锁字节的各族。
   - 注入 `\r\n`、单 LF、中文、emoji、组合字符、`{{slot}}`、反引号、空格尾缀，证明只做原有转换。
3. 对所有 **31 个工具**，比较最终 name、description、送给 Kernel 的完整参数 schema JSON，保持字段和工具列表顺序；不仅比较字符串表。参数说明是 schema 的一部分，现有 `.describe` 位置见上表第 31、35、37、42–44 行。
4. 对 Work、planning、copy、接续、K3 两阶段分别跑确定性准备夹具，比较：
   - 完整 input bytes；
   - binding、sections、所有 digest；
   - manifest/event/body 实际写入 bytes；
   - 每次 store 调用的名称、参数、顺序、次数；
   - 成功/拒绝返回的 own keys、undefined/null/缺字段区别。
5. 在每个既有读取点注入 rejected、not_found、not_ready、throw、cancel，比较返回和截止前的调用日志。尤其保留 `readContinuationBasis.call(deps.executions, …)` 的接收者：`src/core/agent-runtime/context-assembler.ts:1573`。

差分报告应输出第一处不同的 UTF-8 offset、旧新长度和邻近十六进制字节，并单独报告结构字段及读取轨迹差异。不能先 canonicalize 完整对象后才比较，否则会掩盖字段顺序或字段缺失差异。

**5．资源、构建和读取方式**

建议采用：**资源文件是真实源，构建期生成静态包，运行期同步取静态只读数据。**

理由是这里不仅 AgentRuntime 使用文案，Contracts 中的纯 renderer、注记标题也使用它；Contracts 不能反向依赖 Runtime，跨 `src` 的相对 import 也被禁止。现有边界检查：`scripts/check-boundaries.mjs:453`、`:469`。

具体需要：

- `runtime-assets.json` 加入 pack.json、strings.json、十个模板、31 个工具 JSON，**每个文件一个原始字节 SHA-256**。现有 Skills 已按文件登记：`runtime-assets.json:15–52`。
- 当前哈希循环已经能检查任意登记资源的路径、物理文件、symlink 和哈希，无需重写：`scripts/check-boundaries.mjs:231–247`。
- 在检查脚本增加一个很窄的“包引用闭包”核对：pack 引用的每个文件都在清单中；生成模块与资源内容一致。不增加产品加载/保存验证路由。
- 新建构建辅助脚本，例如 `scripts/build-platform-prompts.mjs`：路径从脚本自身 URL 解析到仓库 `resources/prompts/platform/`，不使用 cwd、工作区根、父仓库或 Host 用户数据目录。
- 生成 `src/contracts/prompts/platform-pack.generated.ts`，由脚本维护，不手改；build 前只检查它与资源是否一致。当前 build 只有 tsc，需要加这一步：`package.json:11`。
- 运行时 renderer 不做 fs I/O、不 await、不按 mtime 刷新、不读取 Host 设置；模块加载后的静态数据即 v1 固定包，不改变 prepare 的 store 读取数及异步顺序。
- 资源仍随发行物带上。现有隔离构建复制整个仓库，仅排除 node_modules、git 和根 dist，因此 resources 会进入隔离目录；无需为此改复制规则：`scripts/verify-isolated.mjs:13–14`。如果将来另做 dist-only 包，必须显式带上 resources 和 runtime-assets；当前 package 是 private，现有 build 本身不负责该发行打包：`package.json:3`、`:11`。

现有 Skills 路径依据自身模块位置、而非 cwd，思路可沿用，但相对层级不能照抄；Skills 当前位于 app 层：`src/app/runtime-configuration.ts:78–82`。

**如果任务书坚持“每次 prepare 从磁盘实时读平台包”，严格的零新增错误路径无法成立。** 文件缺失、JSON 解析失败或读取失败都需要新处理；完整 P1 的坏包拒绝和每次解析属于 PC，规格已分开：`docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:90–101`、`:301–305`。D3 应收窄为固定、随版本构建的 v1，不能悄悄引入运行时 loader。

**6．大小、分组及交叉文件**

估量按新增＋删除、搬移计两次，包含平台资源及生成物，不含测试改动。以下是工程估量，不是已生成 diff。

| 部分/文件所有权组 | 独占文件范围 | 估计新增＋删除 |
|---|---|---:|
| G1：包格式、renderer、字符串和资源检查 | `src/contracts/prompts/prompt-pack.ts`、`render-template.ts`；`resources/prompts/platform/pack.json`、`strings.json`；生成脚本；`runtime-assets.json`、`scripts/check-boundaries.mjs`、`package.json` | 800–1,100 |
| G2：组装纯代码 | 新 `context-types.ts`、`context-support.ts`、`context-rendering.ts`、`context-fact-text.ts`、`context-review-input.ts` | 650–850 |
| G3：事实读取及子配方 | 新 `context-workspace-facts.ts`、`context-history-facts.ts`、`context-continuation-recipe.ts`、`context-review-recipe.ts` | 700–900 |
| G4：唯一旧组装器接线组 | 旧 `context-assembler.ts`；新 Work/Query recipe；三个主输入模板；最终 `platform-pack.generated.ts` | **2,400–2,800** |
| G5：简报及 K3 文字迁移 | `src/contracts/continuation-brief.ts`、`src/contracts/core/prepared-execution.ts`；brief/review/proposal 三个模板 | 650–850 |
| G6：其余文字消费者 | 上表其余 runtime 工具文件、31 个工具 JSON、role-profiles、query-preparation、execution-inputs、consultation、architecture-reminders、note.ts、note-read-model、host；guide/consultation/user-response/scribe 四个模板 | 700–1,000 |
| 合计 | 六个文件所有权组 | **5,900–7,500** |

顺序及冻结点：

- **G1 先冻结**：包 schema、全部模板 id、全部字符串 key、工具 JSON 字段、十张槽位表、renderer 的 sectionRanges 语义。后组不得要求 G1 文件再次编辑。
- **G2 冻结**：旧 renderer 兼容入口、事实格式化和 section 归属接口。
- **G3 冻结**：读取函数的完整返回联合、取消传播、依赖形状和调用次数。
- **G5/G6 完成文案接入**；分别只编辑自己的模板、消费者和工具资源。
- **G4 最后**：删除旧实现、转出口、接 Work/Query 配方，并生成最终静态包。中间新增模块尚未接入，不应声称整轮验收已通过；生产可达性要求所有新声明最终被生产入口触达，不能改 allowlist 绕过：`tests/architecture/production-reach.test.ts:92–107`。

**这不是六个全部符合 600–1,200 行的组：G4 是明确例外。** 严格满足该上限只能允许多个串行组编辑 `context-assembler.ts`；坚持文件互不重叠，就必须允许这个较大接线组。不能通过少算删除行解决。

原六项合计约 4,400–5,600 行的预算应重新核定。原 D3 3,200–3,800 行加其他五项的估量，来自 `.lead-ref/d84-condensed.md:13–19`；本次冻结的完整文字迁移和平台包已经超出那份 D3 原估量。

与 SC 的交叉：

- **本方案唯一同改文件是 `package.json`**：SC 加 `test:scale`，D3 增构建资源一致性检查。SC 的要求见 `.lead-ref/sc-book.md:34–39`，D3 当前 build 位置为 `package.json:11`。
- SC 的生产接缝文件完整列在 `.lead-ref/sc-book.md:56–80`：  
  `src/core/work-graph/persistence/lookup-all.ts`；  
  `src/core/work-graph/views/decision-read-model.ts`；  
  `src/core/work-graph/tasks/plan-readers.ts`；  
  `src/core/work-graph/tasks/planning-question-reader.ts`；  
  `src/core/work-graph/tasks/command-rerun-request-service.ts`；  
  `src/core/work-graph/views/automatic-rework-notices.ts`；  
  `src/core/work-graph/views/context-extensions.ts`；  
  `src/core/work-graph/views/undelivered-reply-notices.ts`；  
  `src/core/work-graph/views/work-line-reader.ts`。  
  D3 不编辑这些文件，不把 SC 新增分页参数顺手传进生产调用。SC 明定生产省略参数、保持默认：`.lead-ref/sc-book.md:46–50`。

与其他五项的交叉：

| 项 | 同改文件和处理 |
|---|---|
| D2 | **`src/core/agent-runtime/query-preparation.ts`**：D3 搬 guide，D2 涉及 Query 工具资格筛选；当前位置分别为 `:50–133`、`:141–143`、`:212`。整轮将该文件交同一个所有者，一次完成两项，避免两个组分别编辑。D3 不必改 D2 的 driver/run-loop 装配文件；D2 范围依据 `.lead-ref/d84-condensed.md:18` |
| 结构 C1 | **`src/core/work-graph/notes/note-read-model.ts`**：D3 搬 warning 文案，C1 去读写依赖环；当前点是 `:1880–1886` 和 `:58`。同样一人负责该文件。`note-service.ts` 只归 C1；不把持久正文模板化，相关写入见 `src/core/work-graph/notes/note-service.ts:1482` |
| B1 | 按冻结的 decision/line-settings 三事件试验，无同改文件；范围为 `.lead-ref/d84-condensed.md:14` |
| C2 | 按活动稳定窗口提取，无同改文件；范围为 `.lead-ref/d84-condensed.md:16` |
| A6 | 按 Run/Query 共享活动替换策略提取，无同改文件；范围为 `.lead-ref/d84-condensed.md:13` |

**7．必须写进任务书的八项风险及裁定建议**

1. **组大小和总量冲突。** 接受 G4 大组，或放宽“不同组不碰同一文件”；重新估整轮预算。不能删减冻结文案范围来维持旧估量。
2. **运行时读包改变错误行为。** D3 使用构建期静态 v1；实时解析、坏包拒绝、选包和编辑全部留 PC。依据规格 `:90–101`、`:301–305`。
3. **空值和换行改变字节。** 保留 null/undefined/空串区别、双 LF 分隔、无末尾 LF，以及空但存在后缀的 section；依据 `src/core/agent-runtime/context-assembler.ts:325–394`。
4. **预算、段区间和摘要被间接改变。** 不重写裁剪算法，不把省略块独立成段；注记 source digest 使用的标签也要逐字保留。依据 `src/core/agent-runtime/context-assembler.ts:239–247`、`:308–310`、`:338–355`。
5. **文案具有第二用途。** 书记前缀参与恢复识别，批准命令文字参与字节预算，不能只改“发给模型”的那一边。依据 `src/app/host.ts:1342`、`src/contracts/continuation-brief.ts:864–870`、`tests/runtime/K3-16-approved-method-lines.test.ts:23–48`。
6. **读取数量、接收者和取消时机漂移。** 不并发化、不共享新缓存、不省掉原读取；传入 `reviews: []` 的立即返回、原 `.call` 和 now 时机都保留。依据 `src/core/agent-runtime/context-assembler.ts:975`、`:1492–1494`、`:1573`。
7. **导出及边界破坏。** 旧路径全部转出口；共享纯 renderer 放 Contracts；不改生产可达性 allowlist，不加仅为检查而调用的假入口。依据 `scripts/check-boundaries.mjs:469`、`tests/architecture/production-reach.test.ts:99–105`。
8. **借迁移提前实现 PC/6A。** 不加 secretary 配方、不改 callKind、不引入工具守卫导致文本消失、不增加 prepared 字段或 `invalid` 分支、不删旧文件提醒。D3 禁改旧断言已明确写入规格 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:469–475`；秘书模板属于 `:306`。

上述窄拆不需要状态写入，也不需要修改任何状态迁移。任何为接模板而新增状态提交、改 manifest 格式或要求修改旧测试的方案，都应退出 D3，按对应 PC/6A 范围另做。

文字 45 段，模板 10 个，现有字节测试覆盖 18 段，组 6 个，估计行数 5900–7500，风险 8