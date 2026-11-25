**驱动漏了采用动作，d628 也确实存在。** `t1` 完成时，活动计划里的 `t2` 仍是必需的 `plan_only` 任务；能把它改成可执行任务的候选 `f420` 已经生成，驱动一次 `plans/apply` 都没发。模型漏写了两道阶段 gate。平台另把细化消息 d628 交给了错误的 Query。修复应落在候选卡操作和系统轮解析两处，`execution-inputs.ts` 已有正确的供给规则。以下依据源码、账本查询材料和最终驱动报告，只读核对，未改文件、未跑测试。

## A. 核对诊断

| 判断 | 核对结果 |
|---|---|
| **对，驱动漏采用是场景停住的直接操作原因。** | 首版 `dacf` 在事件 71 采用。事件 128 写入的 `f420` 以 `dacf` 为基准，把 `t2` 改为 `request_execution`，补了 s2 的 `g2`。快照里它仍是 `candidate`，整段 HTTP 的 `plans/apply` 为 **0**，唯一一次 `decisions/answer` 答的是建成员卡。`approve` 只从 `options` 选，空数组返回 `null`；`waitGoal` 随后只处理返工确认卡。真正缺少的是一次人对候选的采用。[候选快照](D:/cxt/p6dg3cx/.lead-ref/p6dg3/evidence.md:139) · [HTTP 计数](D:/cxt/p6dg3cx/.lead-ref/p6dg3/recon.md:221) · [approve](D:/cxt/p6dg3cx/scripts/acceptance/lib/flows.mjs:253) · [等待循环](D:/cxt/p6dg3cx/scripts/acceptance/lib/flows.mjs:364) |
| **对，平台当时应当等待。** | `t1` 有通过的核验轮和正式 `TaskCompleted`。`t2` 仍在 `unfinishedWork`，又没有可先运行的阶段 gate，所以选择器在 3260 行返回，走不到 3272 行的 Goal gate。仅删除 `g1 → t2` 的显式依赖也不会改变这一判断。没有 reviewer 时，候选交给人。最终报告实录为 `BLOCKED / no_dispatchable_work`、`plan_refine_pending`、`plan_candidate_waiting: no_review_line`，32 分钟静默后收场。[事件 157–166](D:/cxt/p6dg3cx/.lead-ref/p6dg3/evidence.md:103) · [必需工作与覆盖集](D:/cxt/p6dg3cx/src/business/workflow/task-gate.ts:240) · [选择顺序](D:/cxt/p6dg3cx/src/business/workflow/workflow.ts:3250) · [无审阅线决策](D:/cxt/p6dg3cx/src/core/work-graph/state/plan-candidate.ts:110) · [最终报告](D:/cxt/p6dg3cx/.lead-ref/intervention-notes.md:16) |
| **对，模型缺阶段 gate；把占位本身算错则是错。** | 模型首轮答案有 s1、s2、`t1`、`t2` 和 Goal gate `g1`，两段都没有阶段 gate。规格要求每段一道，同时明确要求后续段保留必需、活动的 `plan_only` 占位。`g1` 直接依赖 `t2` 是账本事实；没有找到“Goal gate 禁止直接依赖占位”的独立规则，不能据此增加平台拒绝条件。`f420` 补的是 s2 的门，材料也没有显示它补齐了 s1 的门。[模型原始答案摘录](D:/cxt/p6dg3cx/.lead-ref/p6dg3/recon.md:43) · [候选任务表](D:/cxt/p6dg3cx/.lead-ref/p6dg3/evidence.md:156) · [PL 规格 137–139 行](D:/cxt/p6dg3cx/docs/refactor/design/orchestration-2026-10/slices/slice-PL-SPEC.md:137) |
| **对，d628 是独立平台缺陷。** | `commandIdentity` 生成 `operation:hash`，确认草稿再加 `goal-confirm:`。真实首行因此有六段，`refine` 读侧只收四段。事件 123 记录 d628 被 `288067` 收作输入，而这个 Query 在事件 91 就已绑定 b2f。回复回了 b2f；d628 自己没有 Query，快照仍是 `pending / delivered / response:null`。`deviation`、`planresume` 同样受影响；本次实录命中的是 `refine`。[命令身份](D:/cxt/p6dg3cx/src/core/work-graph/persistence/command-executor.ts:37) · [Goal ID](D:/cxt/p6dg3cx/src/core/work-graph/tasks/goal-confirm-service.ts:338) · [解析器](D:/cxt/p6dg3cx/src/contracts/plan-round.ts:212) · [源 Query](D:/cxt/p6dg3cx/.lead-ref/p6dg3/evidence.md:51) · [消息归属](D:/cxt/p6dg3cx/.lead-ref/p6dg3/evidence.md:167) |

**说不清的有两件。** 第一，HTTP 记录没有保存当时 `decisions/queue` 的原始响应体。`options:[]`、`actions:['answer','adopt','abandon']` 是根据活动指针、候选状态、来源和读模型还原的。最终报告补证了 `no_review_line`，但没有补出原始卡 JSON。第二，没人实际调用过 `plans/apply`，所以可以判定驱动漏了一步，不能判定那一次调用必定提交，更不能判定随后整个 Goal 必定完成。另有一项已经能判清：材料早期推测的“60 分钟超时”已被最终报告的 **32 分钟 stalled** 更正。[卡片形成条件](D:/cxt/p6dg3cx/src/core/work-graph/views/decision-read-model.ts:2396) · [证据边界](D:/cxt/p6dg3cx/.lead-ref/p6dg3/recon.md:155) · [最终停止记录](D:/cxt/p6dg3cx/.lead-ref/intervention-notes.md:19)

## B. d628 的影响面和平台修法

### B1. 系统轮首行

下表的拼装行和拆读行均在 [src/contracts/plan-round.ts](D:/cxt/p6dg3cx/src/contracts/plan-round.ts:105)。十一种轮共用一个首行解析器，但字段来源不同。

| 轮 | 拼装 → 拆读 | 哪个字段可能含冒号，后果是什么 |
|---|---|---|
| `refine` | 117 → 216–221 | `goalId` 已实证。`stageId` 或占位 `taskId` 也只要求非空。当前多一段就返回 `null`；若一律从右数一个目标字段，`s:2` 又会被错读为 `2`。 |
| `deviation` | 127 → 223–229 | `goalId`、`taskId` 都可含冒号；右边确定的是原因枚举和版本。当前合法偏差轮可降成普通唤醒。另有两处按相同格式拼号，分别用于工作流查重和通知查回，均不拆号。[deviationRequestId](D:/cxt/p6dg3cx/src/contracts/plan-deviation.ts:107) · [工作流](D:/cxt/p6dg3cx/src/business/workflow/workflow.ts:3402) · [通知](D:/cxt/p6dg3cx/src/core/work-graph/views/plan-notices.ts:388) |
| `planresume` | 177 → **238–242** | 确认草稿的 `goalId` 同样使解析失败。正规原规划 Query 是 `intervention-planning-<hash>`；系统中也确有带冒号的其他 Query ID，不能据此把所有 Query ID 限成单段。失认会跳过原问题和逐卡答复的装配，并使来源链提前停下。诊断所指的 232 行实际是 `planreview/planfix`。[规划 Query ID](D:/cxt/p6dg3cx/src/contracts/query-job.ts:175) · [续轮准备](D:/cxt/p6dg3cx/src/core/agent-runtime/query-preparation.ts:747) · [来源链](D:/cxt/p6dg3cx/src/core/work-graph/tasks/plan-lineage.ts:673) |
| `planreview`、`planfix`、`checkreview` | 135、174/182 → 231–237、278–284 | 字段是 `proposalId` 和版本，首行没有 Goal ID。正式候选号是 `plan-proposal-<hash>`，当前生产者不会带入 Goal 的冒号。如果传入带冒号的候选号，写头允许、读头返回 `null`；`plan_review` 准备还会明确返回 `invalid`。没有本次命中证据。[候选号生成](D:/cxt/p6dg3cx/src/core/work-graph/tasks/plan-service.ts:429) · [准备时的拒绝](D:/cxt/p6dg3cx/src/core/agent-runtime/query-preparation.ts:590) |
| `execreview`、`ucr` | 140、147 → 244–258 | 前者读 `roundId`，后者读 Work `runId`、版本、阶段、摘要。正式工作路径分别分配新轮号和 Run 号，未发现确认草稿的 Goal ID 被代入。带冒号的自由 ID 会被固定段数拒收；已有契约测试还明确要求拒绝多段 `execreview` 和畸形 `ucr`，不宜顺手放宽。[轮号生成](D:/cxt/p6dg3cx/src/core/work-graph/evidence/evidence-service.ts:1349) · [Work Run 号生成](D:/cxt/p6dg3cx/src/core/work-graph/tasks/claim-service.ts:1595) · [既有负例](D:/cxt/p6dg3cx/tests/contracts/S9-shape-pure.test.ts:134) |
| `scr`、`cmdstop` | 152–157 → 259–268 | **另一处合法输入会被挡住。** `commandKey` 本身带冒号，不过入头前已做 SHA-256。真正裸写的是 `projectId`。项目注册和命令审查 subject 都只要求它非空，故 `p:1` 可写出五段首行，读侧却只收四段。相应的书记审查或停命令后参谋轮会失去专属身份。可独立修成末两段取 `reviewSeq`、摘要，中间整体取 `projectId`。[项目注册](D:/cxt/p6dg3cx/src/core/work-graph/configuration/project-bootstrap-service.ts:555) · [subject 契约](D:/cxt/p6dg3cx/src/contracts/scribe-review.ts:59) · [commandKey 拼装](D:/cxt/p6dg3cx/src/core/agent-runtime/running-commands.ts:52) |
| `crr` | 160–168 → 269–277 | `requestId=c2-tool:…` 已由中间段 `join(':')` 正确处理。若 **taskId** 也含冒号，裸首行读会把其后半段算进 `requestId`。正式可信读随后从第二行结构化 subject 还原请求、复算完整首行，再核对 Task，因此不能把裸首行的错分直接说成生产重跑错任务。[工具请求号](D:/cxt/p6dg3cx/src/core/work-graph/model/tool-commit-arguments.ts:74) · [复算 subject](D:/cxt/p6dg3cx/src/contracts/plan-round.ts:352) · [可信读](D:/cxt/p6dg3cx/src/core/work-graph/tasks/plan-lineage.ts:326) |

**还有一个读侧无法消除的边界。** 同一 workspace 里的 `(goalId='a:b', stageId='c')` 和 `(goalId='a', stageId='b:c')` 在同版都会写出 `refine:a:b:c:1`。已保存的单条消息可以用自己的 `goalRef` 拆对；两次发送若已经共用同一请求号，解析器不能为它们创造两个发送身份。此次 d628 有自己的发送记录，材料没有显示这种碰撞。[字段规则](D:/cxt/p6dg3cx/docs/refactor/design/orchestration-2026-10/slices/slice-PL-SPEC.md:395) · [发送身份规则](D:/cxt/p6dg3cx/docs/refactor/design/orchestration-2026-10/slices/slice-PL-SPEC.md:417)

### B2. `src/` 里其他组合键的拆读

按读写成对列出。这里的影响面是**有业务身份或协议字段要从文本取回**的地方；普通分词、HTML 标签、源代码词法和文件 basename 不涉及这类身份判断。

| 拼装 → 拆读 | 字段与结果 |
|---|---|
| `graph-context-reader.ts:172,174,178,182,185` → `attention-observer.ts:258–273` | **会认错。** 五种边用 `from->to`，部分还在 `to` 后附 `:kind[:label]`。读侧对五种边一律取目标端第一个冒号前的内容，连没有尾字段的父子边也截断。`task:a`、`module:a` 或跨工作区的 `/@ws:…` 做右端都会出错；端点含 `->` 也会错分。边的变化仍在，目标节点详情会漏报，或挂到碰巧同名的短 ID 上。[写边](D:/cxt/p6dg3cx/src/core/work-graph/views/graph-context-reader.ts:163) · [取端点并查详情](D:/cxt/p6dg3cx/src/app/attention-observer.ts:235) |
| `cold-start-service.ts:407–409,434–442,664–673` → 同文件 `419–438` | 探索 Query 组合了项目、区域模块和重试后缀。已存 `region` 时直接用结构化值；旧记录才剪后缀。已知的完整项目名前缀可含冒号。旧模块真名若为 `api:2`、`api:deeper`、`api:attempt:2` 会被错剪；`…:deeper:attempt:2` 按现有删除顺序还会残留 `:deeper`。后续可能探索错模块，空结果则明确拒绝。当前重试识别也按 `:attempt:N`、`:deeper` 后缀解释。[生成及兼容读](D:/cxt/p6dg3cx/src/core/work-graph/sessions/cold-start-service.ts:407) · [使用或拒绝](D:/cxt/p6dg3cx/src/core/work-graph/sessions/cold-start-service.ts:664) |
| `session-handoff-service.ts:406,1383` → `585,632,737–753` | `transfer:<assignmentIndex>:<taskIndex>` 的两项都是数组下标。外层 `operationId:stage:item:phase:generation` 先去掉调用者已知的完整 operation 前缀，再从右取 phase、generation，中间重新拼成 item。`root:<queryJobId>`、`choice:<queryJobId>` 也只剥已知前缀。带冒号的 operation、item、Query ID 都保留；两个 `split(':')` 读数字的位置没有混入 ID。[外层写](D:/cxt/p6dg3cx/src/core/work-graph/sessions/session-handoff-service.ts:406) · [外层读](D:/cxt/p6dg3cx/src/core/work-graph/sessions/session-handoff-service.ts:737) · [下标写](D:/cxt/p6dg3cx/src/core/work-graph/sessions/session-handoff-service.ts:1383) · [root 写](D:/cxt/p6dg3cx/src/core/work-graph/sessions/session-handoff-service.ts:1601) · [choice 读](D:/cxt/p6dg3cx/src/core/work-graph/sessions/session-handoff-service.ts:2025) |
| `note-anchors.ts:411–414`、`evidence-service.ts:1145` → `note-views.ts:986–997,1558,2032`、`note-read-model.ts:1620`、`context-fact-text.ts:103–111`、`activate-repair.ts:141`、`repair-approval-source.ts:178` | `goal:<id>` 保留整段；`stage:<goal>/<rev>/<stage>`、`interface:<module>/<interface>`、暂存修复 `<goal>/<run>` 按 `/` 拆，**冒号安全，斜杠有歧义**。例如 `interface:/@ws:…/…` 按首个 `/` 得到空模块，可把仍存在的接口列入“模块已消失”；含 `/` 的手工 Goal 可使修复查错 Run 并返回 `not_found`。阶段显示取最后一段，阶段号自身带 `/` 会显示残段。[锚点写法](D:/cxt/p6dg3cx/src/core/work-graph/notes/note-anchors.ts:409) · [接口模块判定](D:/cxt/p6dg3cx/src/core/work-graph/views/note-views.ts:2028) · [修复查 Run](D:/cxt/p6dg3cx/src/core/work-graph/views/repair-approval-source.ts:176) |
| `workspace-module-id.ts:22–26` → `34–44`；`workspace-path.ts:18,30–45` 及其 `qualifyProjectPath` | `/@ws:` 是固定前缀，workspace 和跨区模块 ID 用 `encodeURIComponent`，读侧按 `/` 分界后解码。这里能往返带冒号的 ID。普通工作区相对文件路径另有明确的禁冒号规则；把两种输入混为一谈会误报。[模块语法](D:/cxt/p6dg3cx/src/contracts/workspace-module-id.ts:1) · [路径语法](D:/cxt/p6dg3cx/src/contracts/workspace-path.ts:18) |
| `workflow.ts:2492` → `business/workflow/plan-round.ts:30–39`；`input-declaration-id.ts:14` → `context-input-service.ts:804`、`state/context-input.ts:198`、`context-support.ts:17` | `plan_only_task:<taskId>`、`plan_only:<stageId>`、`legacy:<requirementId>` 都只去固定前缀，余下完整保留。目标选择这一步能正确选到 `s:2`；丢失发生在系统轮读回。[选择标记](D:/cxt/p6dg3cx/src/business/workflow/workflow.ts:2492) · [目标读取](D:/cxt/p6dg3cx/src/business/workflow/plan-round.ts:30) · [声明 ID](D:/cxt/p6dg3cx/src/contracts/input-declaration-id.ts:13) |
| `exploration-followup.ts:35` → `exploration-followup-service.ts:75–77`；`command-executor.ts:37` → `member-service.ts:254`、`module-maintainer-service.ts:762` | 前者删除已知的 `exploration_followup:conflict:`，保留整段 notice ID。后者删除已知操作名，余下是摘要，原 `commandId` 已进入摘要。均不会因原 ID 中的冒号错分。[探索操作](D:/cxt/p6dg3cx/src/core/work-graph/state/exploration-followup.ts:34) · [修复通知读](D:/cxt/p6dg3cx/src/core/work-graph/sessions/exploration-followup-service.ts:71) · [命令身份](D:/cxt/p6dg3cx/src/core/work-graph/persistence/command-executor.ts:31) |
| `context-workspace-facts.ts:164` → `continuation-diff-reads.ts:75–80`；`server.ts:139` → `ui/host-client.ts:181–185`；`command-sandbox.ts:35–55,126–129` | Git 的 `<commit>:<path>` 只在第一个冒号处分开，左侧必须是对象 ID。SSE 的 `field:value` 也只拆第一个冒号，JSON 值内的 Goal ID 完整保留。网络端口和 IPv6 分组由地址语法及方括号定界。这三处没有平台 ID 段数假设。[Git](D:/cxt/p6dg3cx/src/core/workspace/continuation-diff-reads.ts:69) · [SSE](D:/cxt/p6dg3cx/src/ui/host-client.ts:181) · [地址](D:/cxt/p6dg3cx/src/app/command-sandbox.ts:126) |
| `exec-review-packet.ts:95,148,185`；`business/workflow/plan-round.ts:74–89` → `contracts/plan-round.ts:298,314,332,352,367`；`track-read-model.ts:286→314`；`notice-display-token.ts:37→42` | 带标签的 JSON 行取固定前缀后整体解析，执行审阅包还比较完整首行；`track:` 后也是完整 JSON。通知分页凭据用 `.` 分隔编码载荷和签名，载荷内 ID 不参与分段。底层 `c`/`h` 游标只读约定数字，见 `ledger.ts:142–149`、`core-routes.ts:1015–1023`。这些读法不会截短 Goal、request 或 command ID。[系统轮第二行](D:/cxt/p6dg3cx/src/contracts/plan-round.ts:298) · [轨道游标](D:/cxt/p6dg3cx/src/core/work-graph/views/track-read-model.ts:313) · [通知页编解码](D:/cxt/p6dg3cx/src/core/work-graph/views/notice-display-token.ts:36) |

界面侧还有三个容易混淆的地方。

- **架构详情确有另一组分隔符问题。** `ArchOverview.dc.html:999` 拼 `moduleId#interfaceId`，`:472,1740` 取第一个 `#` 前的内容作为模块；真实模块 ID 可含 `#`，会读错注记锚点。`:1110,1237` 拼 `E|层|起点|终点` 和端点对，`:1261,2005` 按 `|` 拆；ID 自带 `|` 会错分，详情可直接返回空。相同的 `#` 截断还出现在工作线区域展示的 `ArchOverview:2657`、`Chain:2041`、`Decide:6004`、`Done:4924`、`Main:6705`、`Member:2176`、`Plan:3589`。这些分隔符都不截冒号。[锚点读](D:/cxt/p6dg3cx/src/ui/boards/ArchOverview.dc.html:464) · [边详情读](D:/cxt/p6dg3cx/src/ui/boards/ArchOverview.dc.html:2004) · [工作线区域读](D:/cxt/p6dg3cx/src/ui/boards/Main.dc.html:6698)
- **原型的 `path:group` 字典读最后一个冒号。** `ArchOverview.dc.html:581→975`、`Decide:1497→1733`、`Done:3640→3876`、`Main:4940→5177`、`Plan:2057→2293` 都是内置文件分组字典。`ArchOverview:1026→1999` 的 `:files` 和 `Member:1233` 的 `HH:mm` 也是展示标记，均不读运行时 Goal ID。[内置字典](D:/cxt/p6dg3cx/src/ui/boards/ArchOverview.dc.html:975) · [目录标记](D:/cxt/p6dg3cx/src/ui/boards/ArchOverview.dc.html:1026)
- **带类型前缀的单 ID 保留余串。** `project_notice:` 在 `project-notice-notices.ts:82` 拼、`ui/boot.ts:1454,2966` 读；`module:` / `interface:` 在 `arch-overview.ts:833–838` 读；轨道条在 `task-map.ts:1886→1957` 只去类型前缀；规则焦点在 `Settings.dc.html:1006→1020` 只去第一个冒号。`auto-rework:<class>#<n>` 的两项是失败类别和计数，见 `workflow.ts:526→task-map.ts:1902`。命令面板在 `ui/boot.ts:222,1955→4151` 去掉调用者已知的完整 scope 前缀，不拆 `commandId`；其 scope 自身用了未转义的 `/` 和 `|`。[通知读取](D:/cxt/p6dg3cx/src/ui/boot.ts:2966) · [轨道条读取](D:/cxt/p6dg3cx/src/ui/adapters/task-map.ts:1957) · [命令面板读取](D:/cxt/p6dg3cx/src/ui/boot.ts:4151)

### B3. 最小平台补丁

补丁只修三个含 Goal 的轮头。固定尾段从右取，已存消息用 `message.goalRef.goalId` 确定左边界，中间的阶段、任务或 Query ID 整段保留。单参数契约调用仍可读旧格式和本次“Goal 含冒号、尾 ID 单段”的格式。**当 Goal 和尾 ID 都含冒号时，只有拿到消息 Goal 的读者能确定归属。** 接收方仍以固定发送者、Goal 工作区的发送回执、完整消息引用和适用的 Task 引用确认信任。[PL 字段约定](D:/cxt/p6dg3cx/docs/refactor/design/orchestration-2026-10/slices/slice-PL-SPEC.md:395) · [首行读取契约](D:/cxt/p6dg3cx/docs/refactor/design/orchestration-2026-10/slices/slice-PL-SPEC.md:588) · [回执及 Task 核验](D:/cxt/p6dg3cx/src/core/work-graph/tasks/plan-lineage.ts:342)

```diff
--- a/src/contracts/plan-round.ts
+++ b/src/contracts/plan-round.ts
@@ -205,4 +205,14 @@
 }
 
+// PL §5.2.2: the stored Goal fixes the boundary when both ids contain colons.
+function goalRoundIds(fields: readonly string[], messageGoalId?: string) {
+  const pair = fields.join(':');
+  const goalId = messageGoalId ?? fields.slice(0, -1).join(':');
+  const prefix = `${goalId}:`;
+  if (!nonEmpty(goalId) || !pair.startsWith(prefix)) return null;
+  const subjectId = pair.slice(prefix.length);
+  return nonEmpty(subjectId) ? { goalId, subjectId } : null;
+}
+
 /**
  * The head of a round from the text's FIRST line only. An unknown prefix (or a
@@ -210,22 +220,20 @@
  * as an ordinary planning message and returns `null`.
  */
-export function systemRoundOfText(text: string): SystemRoundHeadV1 | null {
+export function systemRoundOfText(text: string, messageGoalId?: string): SystemRoundHeadV1 | null {
   const firstLine = text.split('\n')[0] ?? '';
   const segments = firstLine.split(':');
   const [prefix] = segments;
   if (prefix === 'refine') {
-    if (segments.length !== 4) return null;
-    const [, goalId, stageOrTaskId, revision] = segments;
-    const planRevision = positivePlanRevisionOf(revision);
-    if (!nonEmpty(goalId) || !nonEmpty(stageOrTaskId) || planRevision === null) return null;
-    return { kind: 'refine', goalId, stageOrTaskId, planRevision };
+    const ids = goalRoundIds(segments.slice(1, -1), messageGoalId);
+    const planRevision = positivePlanRevisionOf(segments.at(-1));
+    if (ids === null || planRevision === null) return null;
+    return { kind: 'refine', goalId: ids.goalId, stageOrTaskId: ids.subjectId, planRevision };
   }
   if (prefix === 'deviation') {
-    if (segments.length !== 5) return null;
-    const [, goalId, taskId, cause, revision] = segments;
-    const planRevision = positivePlanRevisionOf(revision);
-    if (!nonEmpty(goalId) || !nonEmpty(taskId)
-      || !inList(cause, ['growth', 'lines', 'budget', 'stop']) || planRevision === null) return null;
-    return { kind: 'deviation', goalId, taskId, cause, planRevision };
+    const ids = goalRoundIds(segments.slice(1, -2), messageGoalId);
+    const cause = segments.at(-2);
+    const planRevision = positivePlanRevisionOf(segments.at(-1));
+    if (ids === null || planRevision === null || !inList(cause, ['growth', 'lines', 'budget', 'stop'])) return null;
+    return { kind: 'deviation', goalId: ids.goalId, taskId: ids.subjectId, cause, planRevision };
   }
   if (prefix === 'planreview' || prefix === 'planfix') {
@@ -237,8 +245,6 @@
   }
   if (prefix === 'planresume') {
-    if (segments.length !== 3) return null;
-    const [, goalId, queryJobId] = segments;
-    if (!nonEmpty(goalId) || !nonEmpty(queryJobId)) return null;
-    return { kind: 'planresume', goalId, queryJobId };
+    const ids = goalRoundIds(segments.slice(1), messageGoalId);
+    return ids === null ? null : { kind: 'planresume', goalId: ids.goalId, queryJobId: ids.subjectId };
   }
   if (prefix === 'execreview') {
--- a/src/core/work-graph/tasks/plan-lineage.ts
+++ b/src/core/work-graph/tasks/plan-lineage.ts
@@ -263,5 +263,5 @@
   const goalRef = message.goalRef;
   if (goalRef === null) return { status: 'ready', value: null };
-  const head = systemRoundOfText(text);
+  const head = systemRoundOfText(text, goalRef.goalId);
   if (head === null) return { status: 'ready', value: null };
 
@@ -269,5 +269,4 @@
   switch (head.kind) {
     case 'refine': {
-      if (head.goalId !== goalRef.goalId) return { status: 'ready', value: null };
       // The head carries no target kind; the target kind never changes the request id.
       round = { kind: 'refine', goalRef, target: { kind: 'stage', stageId: head.stageOrTaskId },
@@ -276,5 +275,4 @@
     }
     case 'deviation': {
-      if (head.goalId !== goalRef.goalId) return { status: 'ready', value: null };
       round = { kind: 'deviation', goalRef, taskId: head.taskId, cause: head.cause,
         planRevision: head.planRevision };
@@ -287,5 +285,5 @@
     case 'planresume': {
       const original = planResumeOriginalQueryOfText(text);
-      if (original === null || head.goalId !== goalRef.goalId) return { status: 'ready', value: null };
+      if (original === null) return { status: 'ready', value: null };
       round = { kind: 'planresume', goalRef, queryJobId: head.queryJobId, originalMessageRef: original };
       break;
```

**`execution-inputs.ts` 自然就对，不需要再加一层判断。** 正式装配把 `readSystemRoundSource` 接到上述可信读。Work 和 Query 扫邮箱时，都在构造普通输入**之前**执行 `if (isSystemRoundSender(...) && await systemRoundSource(...)) continue`。它不要求这封信自己的 Query 已存在。解析修好后，先到安全点的别轮会留下这封信。同一修复还恢复两项正常行为：有绑定等待时，这封信能以 `system_round` 身份获准开自己的轮；`planresume` 能装配原问题和人的答案。仅按 sender 一律跳过会误挡 `messages/forward` 的普通副本，因为副本保留 sender，却没有指向副本的原发送回执。[正式装配](D:/cxt/p6dg3cx/src/composition/create-platform.ts:1621) · [供给判断](D:/cxt/p6dg3cx/src/core/agent-runtime/execution-inputs.ts:161) · [邮箱循环](D:/cxt/p6dg3cx/src/core/agent-runtime/execution-inputs.ts:328) · [绑定等待的开轮条件](D:/cxt/p6dg3cx/src/app/host.ts:3215) · [转发副本规则](D:/cxt/p6dg3cx/src/core/work-graph/tasks/plan-lineage.ts:217)

**兼容读取和恢复旧现场是两件事。** 补丁让旧账本中保存的首行按原字节可读。对于这一次已经留下 `delivered` 事实的 d628，投递规则仍会拒绝再次报价，原因是 `delivered`。不能把补丁描述成“重启旧现场就会补开 Query”，也不应改写那次输入归属。[旧消息状态](D:/cxt/p6dg3cx/.lead-ref/p6dg3/evidence.md:169) · [投递判定](D:/cxt/p6dg3cx/src/core/work-graph/state/message-machine.ts:1057)

## C. 驱动修法和测试行

### C1. 驱动补丁

**选择采用。** intervention 的第一个 Goal 用来准备一个已完成目标，驱动在这里扮演人，卡上有正式 `adopt` 动作。按卡上展示的 Goal pin 和 Proposal pin 发 `plans/apply`，收到 `committed` 才记一条采用 note。一次成功会改变活动计划，下一张卡应从新队列读取。`busy` 或版本竞争交给下一次有界轮询；其他拒绝带平台原话结束准备。只有这个等待显式启用采用，以免把其他场景原本要观察的候选提前处理。[干预验收入口](D:/cxt/p6dg3cx/docs/refactor/design/orchestration-2026-10/slices/slice-9-SPEC.md:703) · [卡的 pins 和 actions](D:/cxt/p6dg3cx/src/core/work-graph/views/decision-read-model.ts:2410) · [正式界面的采用调用](D:/cxt/p6dg3cx/src/ui/boot.ts:1252) · [未结束执行的 busy 条件](D:/cxt/p6dg3cx/src/core/work-graph/state/plan-machine.ts:708)

补丁也纠正本次报告的归因。**可用候选要采用；首次 Goal 最终仍未完成，C-114 才记 `not-run`。** `check:null` 表示当前只在准备前置世界。仅删掉 `check:'completed-goal'` 会使 `broken()` 默认把失败记到第一条未判的 `ask-copy`，仍然记错。C-114 的正式判据保留在实际追加工作、确认新 Goal 并回读旧 Goal 的地方。[C-114 产品行为](D:/cxt/p6dg3cx/docs/MVP-BEHAVIOR.md:378) · [默认失败归属](D:/cxt/p6dg3cx/scripts/acceptance/lib/flows.mjs:49) · [未运行项收尾](D:/cxt/p6dg3cx/scripts/acceptance/lib/flows.mjs:100) · [真正的 C-114 检查](D:/cxt/p6dg3cx/scripts/acceptance/scenarios/int.mjs:445)

```diff
--- a/scripts/acceptance/lib/flows.mjs
+++ b/scripts/acceptance/lib/flows.mjs
@@ -48,4 +48,5 @@
  */
 export function broken(ctx, text, check) {
+  if (check === null) return new Abort('not-run', text); // A prerequisite stopped before any check ran.
   const rec = ctx.report.current;
   const target = check ?? rec?.planned.find(entry => !rec.results.has(entry.id))?.id;
@@ -331,4 +332,20 @@
 }
 
+function applyCandidate(project, goalPin, proposalPin) {
+  return project.host.client.write('plans/apply', project.scope, {
+    proposalRef: proposalPin.ref, expectedProposalRevision: proposalPin.revision, decisionRefs: [],
+  }, [goalPin]);
+}
+
+async function adoptCandidateCard(ctx, project, card, rec, check) {
+  const goal = card.source.pins.find(pin => pin.ref.aggregateType === 'Goal');
+  const proposal = card.source.pins.find(pin => pin.ref.aggregateType === 'PlanProposal');
+  const reply = await applyCandidate(project, goal, proposal);
+  if (reply.code === 'revision_conflict' || reply.code === 'busy') return false;
+  if (committed(reply) === null) throw broken(ctx, `plans/apply ${proposal.ref.proposalId}: ${said(reply)}`, check);
+  rec?.note(`人采用了候选 ${proposal.ref.proposalId}（版本 ${proposal.revision}）。`);
+  return true;
+}
+
 /**
  * Wait for the Goal to reach one of `until` (default: the terminal phases), answering waiting cards the way
@@ -340,5 +357,5 @@
  */
 export async function waitGoal(ctx, project, goalRef, { until = TERMINAL, timeoutMs, answer = approve, onPoll, rec = null, check,
-  committedAnswers = [], returnOnDecide = false }) {
+  committedAnswers = [], returnOnDecide = false, adoptCandidates = false }) {
   const answered = new Set();
   // 已调过“重新入队”的返工确认卡：每张只调一次，被拒也不再调。
@@ -363,4 +380,10 @@
     let open = pending.filter(card => card.source.kind !== 'message').length;
     for (const card of queue?.waitingAnswer ?? []) {
+      if (adoptCandidates && card.source.kind === 'candidate' && card.actions.includes('adopt')) {
+        open += 1;
+        // Adoption moves the Goal's plan pointer. Read the queue again before acting on another candidate.
+        if (await adoptCandidateCard(ctx, project, card, rec, check)) break;
+        continue;
+      }
       if (answered.has(card.cardKey)) { open += 1; continue; }
       const selection = answer(card);
@@ -701,7 +724,5 @@
   const goal = ready(await project.host.client.read('goals/read', project.scope, goalRef));
   if (goal === null) throw broken(ctx, `goals/read of ${goalRef.goalId} did not answer before plans/apply`, check);
-  const applied = await project.host.client.write('plans/apply', project.scope,
-    { proposalRef: candidate.head.ref, expectedProposalRevision: candidate.head.revision, decisionRefs: [] },
-    [{ ref: goalRef, revision: goal.goal.revision }]);
+  const applied = await applyCandidate(project, { ref: goalRef, revision: goal.goal.revision }, candidate.head);
   const plan = committed(applied);
   if (plan === null) throw broken(ctx, `plans/apply of ${goalRef.goalId}'s request candidate: ${said(applied)}`, check);
--- a/scripts/acceptance/scenarios/int.mjs
+++ b/scripts/acceptance/scenarios/int.mjs
@@ -120,6 +120,8 @@
   rec.facts.userCommand = [DONE_REQUEST, LONG_REQUEST];
   const done = await coldStart(ctx, project, DONE_REQUEST, rec);
-  const doneEnd = await waitGoal(ctx, project, done.goalRef, { timeoutMs: 60 * MINUTE, rec, check: 'completed-goal' });
-  if (doneEnd.display.phase !== 'COMPLETED') throw broken(ctx, `the first Goal ended ${doneEnd.display.phase}, not COMPLETED`, 'completed-goal');
+  const doneEnd = await waitGoal(ctx, project, done.goalRef, {
+    timeoutMs: 60 * MINUTE, rec, adoptCandidates: true, check: null,
+  });
+  if (doneEnd.display.phase !== 'COMPLETED') throw broken(ctx, `the first Goal ended ${doneEnd.display.phase}`, null);
   // The lines that worked on the completed Goal: the claim Sessions of its Runs (the one to message is picked when it is sent).
   const doneWorkers = new Set((await executions(project, done.goalRef)).map(claimSession).filter(Boolean));
```

### C2. 测试行

下面用 `goals/create` 指定字面量 Goal ID，使期望独立于生产哈希函数。Host 行以公开消息、Query、候选或报告为观察口。现有夹具已有阶段细化、真实令牌预算耗尽和同线安全点的做法。[A-05](D:/cxt/p6dg3cx/tests/runtime/A-05-plan-round.test.ts:69) · [预算偏差](D:/cxt/p6dg3cx/tests/work-graph/PL-13-run-budget-deviation.test.ts:28) · [同线收件](D:/cxt/p6dg3cx/tests/scenarios/FN-yielded-line-query-supply.test.ts:109)

| 行 | 公开步骤 | 字面量期望 | 抓住的改坏 |
|---|---|---|---|
| 带冒号 Goal 的 `refine` | 创建 `goal-confirm:goal.confirmDraft:a1`，建参谋线，采用含 s2 必需占位的第 1 版，启动 Goal driver；读参谋 inbox、消息正文和源 Query。 | 首行 `refine:goal-confirm:goal.confirmDraft:a1:s2:1`；公开首行读得到 `goalId='goal-confirm:goal.confirmDraft:a1'`、`stageOrTaskId='s2'`、`planRevision=1`；以该消息为源的规划 Query 数 `1`。 | 恢复固定四段，或只证明“发过信”而丢失轮身份。 |
| 带冒号 Goal 和 Task 的 `deviation` | 同一 Goal 建 `t:2`，采用第 1 版，运行预算设 `100000`，脚本模型报告 `150000`，让 Host 向已建的参谋线发偏差轮；读取消息及其 Query。 | 首行 `deviation:goal-confirm:goal.confirmDraft:a1:t:2:budget:1`；以消息 Goal 读回 `taskId='t:2'`、`cause='budget'`、`planRevision=1`，消息的 `taskRef.taskId='t:2'`。 | 恢复固定五段，或把 `t` 并入 Goal、只认任务 `2`。 |
| 旧格式回读 | 把已发布的旧首行字面量直接交给公开 `systemRoundOfText`，不调用生产拼装器生成期望。 | `refine:goal-1:stage-1:3` → `('refine','goal-1','stage-1',3)`；`deviation:goal-1:task-2:lines:4` → `('deviation','goal-1','task-2','lines',4)`；`planresume:goal-1:query-1` → `('planresume','goal-1','query-1')`。 | 修新格式时破坏旧数据或强制所有调用者提供 Goal。已有这些字面量，可直接保留原行。[既有契约行](D:/cxt/p6dg3cx/tests/contracts/PL-exit.test.ts:105) |
| `planresume` 带回人的答案 | 在带冒号 Goal 的参谋规划轮交一个问题“验收用什么？”，由人经 `decisions/answer` 回“运行 node --test”，等 Host 开续轮；读续轮信及模型收到的请求。 | 新续轮数 `1`，其输入同时含“验收用什么？”和“运行 node --test”；续轮信第二行以 `originalQueryRef: ` 开头。 | 只修 refine/deviation，或仅能认首行却没有装回原轮问答。[续轮规格](D:/cxt/p6dg3cx/docs/refactor/design/orchestration-2026-10/slices/slice-PL-SPEC.md:872) |
| 同线先有别的 Query | 先让普通建成员规划 Query 占住参谋线，再由 Goal driver 发带冒号 Goal 的 refine；让前一轮经过安全点并结束，然后推动 Host 消费。经 `messages/read`、`queries/read`、`plans/proposal` 核对。 | 前一 Query 对 refine 消息的 `part='message'` 接收数 `0`；以 refine 为源的 Query 数 `1`；其候选 `sourceMessageRef` 与 refine 消息相等，和建成员信相等的数量 `0`。 | 直接重现 d628；能抓到“解析测试绿了，正式供给仍吞信”。 |
| 转发副本仍可投递 | 将一封真实 refine 经 `messages/forward` 转给另一条正运行且可收答复请求的线，推进到安全点；分别读原件和副本。 | 该执行接收副本 `message` 数 `1`，接收原件数 `0`；以副本身份被认成原可信系统轮的数量 `0`。 | 在 `execution-inputs` 里见 `host:plan-round` 就一律跳过，把正常副本也挡住。 |
| 驱动采用与归因 | intervention 首个 Goal 采用含占位的 v1，不建 reviewer，由参谋提交能合法采用的细化候选；运行该 Goal 的等待，读公开 HTTP、计划版本和 notes。另设一行让前置 Goal 终止于 `FAILED`，在追加工作前收场。 | 成功行中该候选 `plans/apply` 提交 `1` 次、对该卡 `decisions/answer` 为 `0` 次、活动版本为 `2`、采用 note 为 `1` 条。前置失败行中 C-114 为 `uncovered (not-run)`，`ask-copy` 也没有被记 `fail`。 | 仍只认 `options`、重复采用、把拒绝写成已采用，或把准备失败栽到尚未执行的判据上。 |