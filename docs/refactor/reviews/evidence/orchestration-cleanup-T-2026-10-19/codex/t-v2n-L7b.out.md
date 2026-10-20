只读核对完成。以下文件名默认相对于 `tests/work-graph/`；`helpers/` 默认相对于 `tests/helpers/`。表按共同证据合并，JSON 展开全部组内调用位置。`line` 数组中的每个行号分别计数；同一位置的草稿和签发字段分节计数，夹具内部同类值的多次执行不重复计数。

“v2 允许”只判定列出的输入值，不代表整条测试合规。后续内部读写明确记在第一表，不另列本轮范围外的旧 F3；依据为 `.lead-ref/books/test-rule-sheet-v2.md:28`、`.lead-ref/books/test-rule-sheet-v2.md:30`、`.lead-ref/books/test-rule-sheet-v2.md:43`。

第一节：A1 草稿与外来值

计划 owner 均为真实路由绑定的 `plans.proposePlan`；采用入口是 `plans.applyPlanChange`，见 `src/app/core-routes.ts:388`、`src/app/core-routes.ts:389`。

| 位置／JSON 注记 | owner、契约及来源 | 后续是否只走公开步骤 | 判定 |
|---|---|---|---|
| JSON 中 P0：基础、B2 及其调用者 | `plans.proposePlan`；完整草稿，`helpers/task-claim-fixture.ts:323`、`helpers/task-claim-fixture.ts:344`；第二计划见 `helpers/B2-execution-fixture.ts:151`、`helpers/B2-execution-fixture.ts:160` | 否。公开采用见 `helpers/task-claim-fixture.ts:350`、`helpers/B2-execution-fixture.ts:163`；随后直接登记 Session 见 `helpers/task-claim-fixture.ts:370` | v2 允许 |
| JSON 中 P5：S5、S2A 队列及其调用者 | `plans.proposePlan`；完整草稿，`helpers/S5-decision-fixture.ts:723`、`helpers/S5-decision-fixture.ts:738`；多任务和通知追加计划见 `helpers/S2A-notices-support.ts:162`、`helpers/S2A-notices-support.ts:175`、`helpers/S5-queue-support.ts:317`、`helpers/S5-queue-support.ts:326` | 否。公开采用见 `helpers/S5-decision-fixture.ts:744`；后续手写进入事实及结果见 `helpers/S5-decision-fixture.ts:851`、`helpers/S5-decision-fixture.ts:880` | v2 允许 |
| JSON 中 PT：轨道、时间线、活动夹具 | `plans.proposePlan`；完整初始及后续版本草稿。提议／采用见 `helpers/S2B-track-fixture.ts:281`、`helpers/S2B-track-fixture.ts:288`；`helpers/S2B-task-timeline-fixture.ts:295`、`helpers/S2B-task-timeline-fixture.ts:302`、`helpers/S2B-task-timeline-fixture.ts:333`、`helpers/S2B-task-timeline-fixture.ts:343`；`helpers/S2B-activity-fixture.ts:364`、`helpers/S2B-activity-fixture.ts:372` | 否。内部进入事实、读取及检查结果见 `helpers/S2B-track-fixture.ts:350`、`helpers/S2B-activity-fixture.ts:443`、`helpers/S2B-task-timeline-fixture.ts:233`、`helpers/S2B-task-timeline-fixture.ts:670` | v2 允许 |
| JSON 中 PL：工作线夹具 | `plans.proposePlan`；完整草稿，`helpers/S2C-L-line-support.ts:295`、`helpers/S2C-L-line-support.ts:334`；真实采用在 `helpers/S2C-L-line-support.ts:341` | 否。直接登记 Session 见 `helpers/S2C-L-line-support.ts:245`；手写执行事实见 `helpers/S2C-L-runs-support.ts:145`、`helpers/S2C-L-runs-support.ts:169` | v2 允许 |
| JSON 中 PD：节点详情夹具 | `plans.proposePlan`；完整草稿、真实提议和采用，`helpers/S2C-D-node-support.ts:269`、`helpers/S2C-D-node-support.ts:281`、`helpers/S2C-D-node-support.ts:284` | 否。直接登记 Session、内部读取 pin 见 `helpers/S2C-D-node-support.ts:300`、`helpers/S2C-D-node-support.ts:355` | v2 允许 |
| `S2B-r2-s-yielded.test.ts:39`；`S2C-lines-read-only.test.ts:283`，JSON 中 PH | `plans.proposePlan`；完整场景草稿，真实 HTTP 提议／采用，`helpers/AG2b-collaboration-fixture.ts:461`、`helpers/AG2b-collaboration-fixture.ts:464` | 是。前者继续真实 advance、consultation 和读取，`S2B-r2-s-yielded.test.ts:51`、`:59`、`:65`、`:79`；执行读取实际走 HTTP，`helpers/A2-restart-fixture.ts:130`。后者继续公开只读路由，`S2C-lines-read-only.test.ts:293`、`:304` | v2 允许 |
| JSON 中 PG：S3 图上下文追加草稿 | `plans.proposePlan`；完整草稿，`S3-graph-context.test.ts:464`、`:488`、`:815`；真实采用见 `S3-graph-context.test.ts:472`、`:496` | 否。基础夹具仍含 P0 的内部 Session 登记，入口为 `S3-graph-context.test.ts:382` | v2 允许 |
| JSON 中 PW：W1、W2 未来计划／白板 | `plans.proposePlan`；完整正常草稿及提议体，`W1-future-plan.test.ts:263`、`:340`；`helpers/W2-whiteboard-fixture.ts:285`、`:294`、`:298`、`:309`；`W2-future-intent.test.ts:108` | 否。真实采用见 `W1-future-plan.test.ts:344`、`helpers/W2-whiteboard-fixture.ts:303`、`:313`、`W2-future-intent.test.ts:111`；内部读取见 `W1-future-plan.test.ts:330`、`helpers/W2-whiteboard-fixture.ts:265`、`W2-future-intent.test.ts:97` | v2 允许 |
| JSON 中 PR：S5R2 历史计划 | `plans.proposePlan`；完整草稿，`helpers/S5R2-a-support.ts:70`、`:82`；公开读提议／采用见 `helpers/S5R2-a-support.ts:92`、`:98` | 否。内部读取见 `helpers/S5R2-a-support.ts:66`、`:68`、`:97`、`:105` | v2 允许 |
| `S3-context-inputs.test.ts:459`；`S3-prepared-context-admission.test.ts:315` | `plans.proposePlan`；结构完整，但携带测试计算的 artifact digest，分别来自 `S3-context-inputs.test.ts:116`、`:119` 和 `S3-prepared-context-admission.test.ts:91`、`:313` | 后续公开采用不修复签发来源问题，见 `S3-context-inputs.test.ts:465` | F1 |
| `W1-future-plan.test.ts:604`、`:606` | `plans.proposePlan`；强转注入平台派生 `taskStateBasis`，或强转 `schemaVersion:3`，见 `W1-future-plan.test.ts:602`、`:603`、`:605` | 不能当完整契约输入；拒绝分支没有因此获得 A6 豁免，A6 条件见 `.lead-ref/books/test-rule-sheet-v1.md:45` | F1 |
| `S2B-r2-s-yielded.test.ts:38` | `send_session_message`；虽然声明处有强转及空 recipient，实际执行前补成完整 SessionRef，见 `S2B-r2-s-yielded.test.ts:44`；真实参数契约见 `src/core/agent-runtime/communication-tools.ts:309` | 是，随后真实发信、查询回应、接续及时间线读取，见该文件 `:51`、`:59`、`:65`、`:79` | v2 允许 |
| `S2B-32-task-timeline-fold.test.ts:58` | `send_session_message`／`respond_session_message`；两份完整参数分别在 `helpers/S2B-task-timeline-fixture.ts:516`、`:537`；回应 revision 来自真实读消息 `:530` | 发信、回应和接续均真实，见该 helper `:513`、`:534`、`:552`；整套夹具仍有内部读取 `:233` | v2 允许 |
| `S2B-32-task-timeline-fold.test.ts:125`；`S2B-r2-v-real-runs.test.ts:71`、`:101`、`:134`、`:165` | `read`；完整 `{path}` 参数，时间线来源在 `helpers/S2B-task-timeline-fixture.ts:400`。`read` 只要求 path，其余字段可选，见 `vendor/coding-agent/dist/tools/builtin/read/read-tool.js:11`、`:15`、`:16`、`:17` | 真实工具／Runtime 后续，见 `helpers/S2B-be1-platform-fixture.ts:303`、`:305`、`:308`；初始夹具的内部步骤不获豁免 | v2 允许 |
| `S2B-r2-activity-run-ended-at.test.ts:55` | `s2b-r10-late-tool`；`{}` 送给测试替身，其宽松 schema 和 handler 不检查业务参数、直接返回测试结果，见 `helpers/S2B-runtime-tools-support.ts:36`、`:39`、`:42` | 后续真实启动、重启不能补出真实工具分支契约，见 `S2B-r2-activity-run-ended-at.test.ts:83`、`:89` | F1 |

第二节：A1 平台签发字段

| 位置／JSON 注记 | owner／字段 | 来源与判定 |
|---|---|---|
| JSON 中 I0 | `completionPolicies.activateCompletionPolicy`／`target.digest` | 基础安装返回 `contentDigest` 原样使用，`helpers/task-claim-fixture.ts:252`、`:259`。v2 允许 |
| JSON 中 I5 | 同上 | S5 安装返回值原样使用，`helpers/S5-decision-fixture.ts:638`、`:647`；多任务追加政策见 `helpers/S2A-notices-support.ts:153`；通知追加政策见 `helpers/S5-queue-support.ts:306`。v2 允许 |
| JSON 中 ID | 同上 | 节点夹具真实安装结果原样使用，`helpers/S2C-D-node-support.ts:211`、`:219`。v2 允许 |
| `S2B-r2-s-yielded.test.ts:39`；`S2C-lines-read-only.test.ts:283` | 同上 | 真实 HTTP 安装结果原样使用，`helpers/AG2b-collaboration-fixture.ts:446`、`:451`。v2 允许 |
| `S2C-lines-attention.test.ts:218`；`S2C-lines-page.test.ts:46`；`S2C-lines-tiers.test.ts:157`；`S2C-lines-walk.test.ts:67` | 同上 | 检查政策安装回执原样摘要，`helpers/S2C-L-check-support.ts:139`、`:150`。v2 允许 |
| `S3-context-inputs.test.ts:392`；`S3-graph-context.test.ts:437` | 同上 | 直接使用 `installed.value.contentDigest`。v2 允许 |
| JSON 中 FT | 同上，静态政策 digest | 安装之后重新计算，未使用安装返回摘要，`helpers/S2B-runtime-steps-fixture.ts:170`、`:184`。F1 |
| JSON 中 FA | 同上，静态政策 digest | 安装之后重新计算，`helpers/S2B-activity-fixture.ts:401`、`:415`。F1 |
| JSON 中 R | `runtime.startRun`／`prepared` | 真实准备步骤返回后原样转交，`helpers/S2B-runtime-steps-fixture.ts:348`、`:357`。v2 允许 |
| `S2B-r2-v-real-runs.test.ts:76`、`:106`、`:139`、`:170`；`S2B-r2-activity-run-ended-at.test.ts:83` | 同上 | 前者来自 `helpers/S2B-be1-platform-fixture.ts:303`、`:305`；后者来自 `helpers/S2B-be2-reconcile-support.ts:98`、`:100`。v2 允许 |
| `S2B-r2-activity-run-ended-at.test.ts:52` | 角色激活／创建 Session 的 `pin.digest` | 来自真实安装回执，`helpers/B2-runtime-fixture.ts:195`、`:197`、`:198`、`:209`。v2 允许 |
| `S2B-r2-v-real-runs.test.ts:64`、`:96`、`:127`、`:158` | 同上 | 安装回执形成 pin 后原样激活、创建 Session，`helpers/S2B-be1-platform-fixture.ts:189`、`:193`、`:194`、`:219`、`:224`。v2 允许 |
| `S3-role-profiles.test.ts:189`、`:233`、`:265`、`:277`、`:304` | `roles.readRoleSpec`／`pin.digest` | 分别来自该文件 `:181`、`:186`、`:229`、`:232`、`:258`、`:274`、`:286`、`:289` 的安装回执；没有从角色记录重建。v2 允许 |
| `WP2-message-duties.test.ts:73`、`:145`、`:158`、`:313`、`:333`、`:523`、`:540` | 角色激活／创建 Session 的 `pin.digest` | 该文件 `:65` 安装，`:72` 取返回 `contentDigest`，后续原样使用。v2 允许 |
| JSON 中 C | 队列、轨道、时间线、工作线、节点详情、图、未知调用清单的 cursor | 真实前页返回后原样续用；逐调用位置及来源在 JSON。跨查询复用而被拒绝的原样 cursor 仍按来源判定，例 `S3-graph-context.test.ts:1123`、`:1125`。v2 允许 |
| `S2A-notices-since.test.ts:104`；`S5-notices.test.ts:173`、`:192`、`:215`、`:259`、`:269`；`WP2-undelivered-notices.test.ts:174` | `markNoticesSeen`／`displayToken`、`seenThrough` | 来自真实外层页，分别见 `S2A-notices-since.test.ts:102`；`S5-notices.test.ts:170`、`:179`、`:209`、`:256`、`:261`；`helpers/WP2-notices-fixture.ts:115`、`:121`、`:122`。v2 允许；S5 上游固定 source 的旧 F4 不因此消失，见 `S5-notices.test.ts:35` |
| `S2C-pins.test.ts:216`、`:227`、`:244`、`:254` | 同上 | `S2C-pins.test.ts:51` 自造 position，`:52` 直接 issue token，`:58` 转交。F1 |
| `S5-notices.test.ts:189` | `markNoticesSeen`／`seenThrough` | 自造 `pos(12,'r12')`，构造器在 `S5-notices.test.ts:33`；拒绝不自动满足 A6。F1 |
| `S5-decision-application.test.ts:198,221,241,263,273,286,297,355,377,389,402,411,417,429,437,451`；`S2A-queue-card-semantics.test.ts:78` | `recordDecisionApplication`／receipt | 从捕获的 commit 重建 identityKey、fingerprint、cursor，分别见 `S5-decision-application.test.ts:34`、`:39` 和 `S2A-queue-card-semantics.test.ts:60`、`:63`；前者 `:389` 还替换 cursor。F1 |
| `unknown-call-review-list.test.ts:157`；`S2C-lines-counts.test.ts:137`；`S2C-node-detail-bounded.test.ts:249`、`:254`、`:258` | 清单／节点读取的 cursor | 分别使用手造记录 refKey、假字面量、测试自行编码值，见 `unknown-call-review-list.test.ts:152`、`:154`；`S2C-lines-counts.test.ts:137`；`S2C-node-detail-bounded.test.ts:249`、`:252`。F1 |
| `S3-context-inputs.test.ts:459`；`S3-prepared-context-admission.test.ts:315` | `plans.proposePlan`／artifact digest | 测试计算或手造，见 `S3-context-inputs.test.ts:116`、`:119`；`S3-prepared-context-admission.test.ts:91`。F1 |
| `S3-context-inputs.test.ts:914`、`:985` | `taskInputs.readTaskInputs`／candidateKey 指纹 | 测试调用 hash 重算，见 `S3-context-inputs.test.ts:128`、`:912`、`:983`。F1 |
| `S5-goal-cause-at-least-cursor.test.ts:30`、`:41`、`:50`、`:59`、`:62` | `causes.readGoalDecisionCauses`／atLeastCursor | 来源是手造 commit 回执或测试构造的水位，见该文件 `:20`、`:22`、`:29`、`:50`、`:57`。F1 |
| `WP2-undelivered-notices.test.ts:375`、`:384`、`:518`、`:540` | `undeliveredReplyNotices.readPage`／cursor | 真实前页返回后原样使用，见该文件 `:367`、`:375`、`:521`、`:544`。v2 允许 |
| `WP2-undelivered-notices.test.ts:407`、`:427`、`:434`、`:455` | 同上／cursor、atLeastCursor | 测试编码、字面量或自造水位，见该文件 `:397`、`:398`、`:399`、`:426`、`:434`、`:455`。F1 |
| `S2B-32-task-timeline-fold.test.ts:58` | `claims.claimTask`／`consumedWait.responseRef.digest` | 真实 `readMessage` 返回的 `response.bodyRef` 原样用于接续，`helpers/S2B-task-timeline-fixture.ts:545`、`:550`。v2 允许 |

第三节：Record-store 测试

| 范围 | 结果 |
|---|---|
| `.lead-ref/groups/L7b-files.txt:1` 至 `.lead-ref/groups/L7b-files.txt:84` | 本组无 `tests/record-store/*`；不把上层测试的旧手造记录重新列成这一节实例。适用边界见 `.lead-ref/books/test-rule-sheet-v2.md:38`、`:43`。 |

第四节：A7

| 命名 helper | 本组直接及跨文件调用结果 | 边界依据 |
|---|---|---|
| `buildNoteTools` | 无实例 | `.lead-ref/books/test-rule-sheet-v2.md:45`、`:47` |
| `damageKernel` | 无实例 | `.lead-ref/books/test-rule-sheet-v2.md:50`、`:51`、`:52`、`:58` |
| `process-sandbox-standin.ts` 的 `probe` | 无实例，包括 `executeChecks:true` 越界调用也未发现 | `.lead-ref/books/test-rule-sheet-v2.md:59`、`:60`、`:64` |

无实例文件：

- `tests/work-graph/goal-independent.test.ts`：公开普通输入与旧 store seed，见 `goal-independent.test.ts:47`、`:50`。
- `tests/work-graph/material-readers.test.ts`：旧手造 store 状态，见 `material-readers.test.ts:63`；不属于本轮新增判定。

JSON 中 P0/P5/PT/PL/PD/PH/PG/PW/PR、I0/I5/ID、FT/FA、R、C 均使用上述表的定义；`同文件` 指该对象的 `file`。

```json
[
{"section":"1","file":"S2A-notices-since.test.ts","line":[59],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S2A-notices-workspace.test.ts","line":[22,26,28,49,52,53],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5；含多任务追加计划"},
{"section":"1","file":"S2A-queue-bounds.test.ts","line":[26],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S2A-queue-card-semantics.test.ts","line":[23],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S2A-queue-derived-cards.test.ts","line":[20],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S2A-queue-goal-runs.test.ts","line":[35],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S2A-queue-request-candidates.test.ts","line":[31],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S2A-queue-window.test.ts","line":[15],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S2B-30-track-bars.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT轨道"},
{"section":"1","file":"S2B-31-task-timeline-main.test.ts","line":[21,23],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT时间线"},
{"section":"1","file":"S2B-32-task-timeline-fold.test.ts","line":[41,57,77,96,118,138,139,141,143,165,166,168,170,181,182,184,186,188,201,211,230],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT时间线"},
{"section":"1","file":"S2B-33-task-timeline-pagination.test.ts","line":[21,24,45,48,56,59,63,70,73,83,86,99,102],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT时间线"},
{"section":"1","file":"S2B-34-executed-files.test.ts","line":[22,221],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT轨道"},
{"section":"1","file":"S2B-activity-calendar-tasks.test.ts","line":[21],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT活动"},
{"section":"1","file":"S2B-activity-calendar.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT活动"},
{"section":"1","file":"S2B-activity-read-faults.test.ts","line":[21],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT活动"},
{"section":"1","file":"S2B-r2-27-moving-window.test.ts","line":[76,94,97,113,157,160],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT轨道及时间线"},
{"section":"1","file":"S2B-r2-activity-run-ended-at.test.ts","line":[52],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0；helpers/S2B-runtime-store-fixture.ts:75"},
{"section":"1","file":"S2B-r2-calendar-boundaries.test.ts","line":[16],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT活动"},
{"section":"1","file":"S2B-r2-calendar-same-task.test.ts","line":[22],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT活动"},
{"section":"1","file":"S2B-r2-conflict-catalog.test.ts","line":[40],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S2B-r2-keyed-cap.test.ts","line":[15],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT活动"},
{"section":"1","file":"S2B-r2-never-entered.test.ts","line":[17],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT活动"},
{"section":"1","file":"S2B-r2-r3-track-pagination.test.ts","line":[23],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT轨道"},
{"section":"1","file":"S2B-r2-r4-bound-workspace.test.ts","line":[27,43,46],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT轨道及时间线"},
{"section":"1","file":"S2B-r2-r5-not-entered.test.ts","line":[19],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT轨道"},
{"section":"1","file":"S2B-r2-r7-keyed-read-cap.test.ts","line":[19,50,53],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT轨道及时间线"},
{"section":"1","file":"S2B-r2-s-preentry-control.test.ts","line":[24,27],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT时间线"},
{"section":"1","file":"S2B-r2-v-real-runs.test.ts","line":[64,96,127,158],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0；后续真实Runtime，helpers/S2B-be1-platform-fixture.ts:303、305、308"},
{"section":"1","file":"S2B-r2-workspace-binding.test.ts","line":[24],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT活动"},
{"section":"1","file":"S2B-r3-consultation-cap.test.ts","line":[23],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT轨道"},
{"section":"1","file":"S2B-r4-session-workspace.test.ts","line":[32,38],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT轨道及活动"},
{"section":"1","file":"S2B-run-activity-read.test.ts","line":[18],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PT活动"},
{"section":"1","file":"S2B-r2-s-yielded.test.ts","line":[39],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"PH；后续公开"},
{"section":"1","file":"S2C-lines-attention.test.ts","line":[24,31,45,75,110,143,164,188,219,239],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-controls.test.ts","line":[33,43,60,74,109,166,185,209,231,252],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-conversation.test.ts","line":[48],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-copies.test.ts","line":[34],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-counts.test.ts","line":[27,34,52,64,78,96],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-d1.test.ts","line":[26,33,59,74,89,101],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL；buildD1在helpers/S2C-L-line-support.ts:625"},
{"section":"1","file":"S2C-lines-done-evidence.test.ts","line":[33,40,58,68,85,102,120,139,155,167,178,195,241,264,283],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-failure.test.ts","line":[61,124,147,175,188,201],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-identification.test.ts","line":[34,135],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-latest-generation.test.ts","line":[23,30,87],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-names.test.ts","line":[27,43,59,70,80,124],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-page.test.ts","line":[47,91,131,157,179,220],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-paused-continue.test.ts","line":[35,45],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-read-only.test.ts","line":[87,94,127,147,157,170,208,232,255],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL、PD；夹具后续非全公开"},
{"section":"1","file":"S2C-lines-read-only.test.ts","line":[283],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"PH；后续公开"},
{"section":"1","file":"S2C-lines-scale.test.ts","line":[43],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL；规模夹具同样含内部执行事实"},
{"section":"1","file":"S2C-lines-task-anchors.test.ts","line":[27,37,58],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-tiers.test.ts","line":[28,43,51,67,129,158,182],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-waiting-reply.test.ts","line":[27,34,49,66,83],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-lines-walk.test.ts","line":[60,68,154],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PL"},
{"section":"1","file":"S2C-node-detail-anomalies.test.ts","line":[98,143,163],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"PD"},
{"section":"1","file":"S2C-node-detail-bounded.test.ts","line":[78,99,144,191,210,243],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"PD"},
{"section":"1","file":"S2C-node-detail-executions.test.ts","line":[20],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"PD"},
{"section":"1","file":"S2C-node-detail-hover.test.ts","line":[21,107,125,143,174,185],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"PD"},
{"section":"1","file":"S2C-node-detail-next-kinds.test.ts","line":[130],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"PD"},
{"section":"1","file":"S2C-node-detail-task.test.ts","line":[22,101,125],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"PD"},
{"section":"1","file":"S2C-pins.test.ts","line":[29],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0；helpers/S2C-P-pins-fixture.ts:90"},
{"section":"1","file":"S3-context-inputs.test.ts","line":[275],"owner":"plans.proposePlan","value":"完整初始草稿","verdict":"v2 允许","note":"P0"},
{"section":"1","file":"S3-context-inputs.test.ts","line":[459],"owner":"plans.proposePlan","value":"带自造artifact指纹的草稿","verdict":"F1","note":"同文件:116、119；后续真实apply在:465不修复来源"},
{"section":"1","file":"S3-graph-context.test.ts","line":[382,464,488,815],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PG"},
{"section":"1","file":"S3-prepared-context-admission.test.ts","line":[225,762],"owner":"plans.proposePlan","value":"完整初始草稿","verdict":"v2 允许","note":"P0"},
{"section":"1","file":"S3-prepared-context-admission.test.ts","line":[315],"owner":"plans.proposePlan","value":"带自造artifact指纹的草稿","verdict":"F1","note":"同文件:91手造OLD_A，:313放入草稿"},
{"section":"1","file":"S5-decision-application.test.ts","line":[27],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S5-decision-queue.test.ts","line":[52,160],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5；:160经helpers/S5-queue-support.ts:270进入P0"},
{"section":"1","file":"S5-goal-cause-at-least-cursor.test.ts","line":[16],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S5-goal-settings.test.ts","line":[90,183,234],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5；追加提议真实，采用见同文件:238"},
{"section":"1","file":"S5-notices.test.ts","line":[32,139,226,242,284],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5；含noticeWork追加草稿"},
{"section":"1","file":"S5-request-candidates.test.ts","line":[31,55],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5；候选构造见helpers/S5-decision-fixture.ts:938、946"},
{"section":"1","file":"S5-user-messages.test.ts","line":[24],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"S5R2-queue-history.test.ts","line":[22,30,35,47,50,60,63,78,79,95,98,113,171,194],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5、PR"},
{"section":"1","file":"UCR-settle-review.test.ts","line":[60],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0"},
{"section":"1","file":"unknown-call-review-list.test.ts","line":[40,199,229],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0"},
{"section":"1","file":"W1-future-plan.test.ts","line":[263,340],"owner":"plans.proposePlan","value":"完整正常草稿","verdict":"v2 允许","note":"PW；不含另列:604、606的强转异常"},
{"section":"1","file":"W2-agent-whiteboard.test.ts","line":[39,125,140,161,174,224,234,254,266,283,294,298,304,309,333,352,368,376,412,446,498,510],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PW"},
{"section":"1","file":"W2-future-intent.test.ts","line":[108,116,137,147,167,195,201,328,333,347,359,379,407,456,463,480,502],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0、PW"},
{"section":"1","file":"WP1-context-anomalies.test.ts","line":[296],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0；跨文件异常读取夹具进入B2"},
{"section":"1","file":"WP1-goal-content-entry.test.ts","line":[56,64,80,82,92,104,118],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0；追加草稿经真实提议、采用"},
{"section":"1","file":"WP2-context-extensions.test.ts","line":[223,269,298,329],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5；:298追加草稿，后续内部seed在:319"},
{"section":"1","file":"WP2-message-duties.test.ts","line":[49],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P5"},
{"section":"1","file":"WP2-undelivered-notices.test.ts","line":[33],"owner":"plans.proposePlan","value":"完整计划草稿","verdict":"v2 允许","note":"P0；helpers/WP2-notices-fixture.ts:76进入S1/B2"},
{"section":"1","file":"S2B-r2-s-yielded.test.ts","line":[38],"owner":"send_session_message","value":"工具参数","verdict":"v2 允许","note":"同文件:44在执行前补全recipient；后续公开"},
{"section":"1","file":"S2B-32-task-timeline-fold.test.ts","line":[58],"owner":"send_session_message/respond_session_message","value":"完整工具参数","verdict":"v2 允许","note":"helpers/S2B-task-timeline-fixture.ts:516、537；真实回应、接续；夹具仍有内部读取:233"},
{"section":"1","file":"S2B-32-task-timeline-fold.test.ts","line":[125],"owner":"read","value":"path工具参数","verdict":"v2 允许","note":"helpers/S2B-task-timeline-fixture.ts:400；真实read及后续时间线"},
{"section":"1","file":"S2B-r2-v-real-runs.test.ts","line":[71,101,134,165],"owner":"read","value":"path工具参数","verdict":"v2 允许","note":"helpers/S2B-be1-platform-fixture.ts:303、305、308；后续公开活动读取"},
{"section":"1","file":"S2B-r2-activity-run-ended-at.test.ts","line":[55],"owner":"s2b-r10-late-tool","value":"空工具参数","verdict":"F1","note":"helpers/S2B-runtime-tools-support.ts:36、39、42；替身忽略参数并返回自造结果"},
{"section":"1","file":"W1-future-plan.test.ts","line":[604,606],"owner":"plans.proposePlan","value":"强转非契约草稿","verdict":"F1","note":"同文件:602、603、605；taskStateBasis/schemaVersion=3；不满足A6"},

{"section":"2","file":"S2A-notices-since.test.ts","line":[104],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"公开页返回原样使用；同文件:102"},
{"section":"2","file":"S2A-queue-bounds.test.ts","line":[78],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"C；公开前页nextCursor原样续用"},
{"section":"2","file":"S2B-30-track-bars.test.ts","line":[140,143],"owner":"activity.readTrackBars","value":"cursor","verdict":"v2 允许","note":"C；first.next/second.next原样续用"},
{"section":"2","file":"S2B-33-task-timeline-pagination.test.ts","line":[30,35,65],"owner":"activity.readTaskStateTimeline","value":"cursor","verdict":"v2 允许","note":"C；公开前页next原样续用"},
{"section":"2","file":"S2B-r2-activity-run-ended-at.test.ts","line":[83],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"helpers/S2B-be2-reconcile-support.ts:98、100；真实prepareExecution返回原样"},
{"section":"2","file":"S2B-r2-r3-track-pagination.test.ts","line":[74],"owner":"activity.readTrackBars","value":"cursor","verdict":"v2 允许","note":"C；同文件:66的first.next原样"},
{"section":"2","file":"S2C-lines-conversation.test.ts","line":[75,134,154],"owner":"lines.readWorkLinePage","value":"cursor","verdict":"v2 允许","note":"C；真实页签发外层游标；历史替身不获豁免"},
{"section":"2","file":"S2C-lines-counts.test.ts","line":[162],"owner":"lines.listArchivedLines","value":"cursor","verdict":"v2 允许","note":"C；同文件:159的first.nextCursor"},
{"section":"2","file":"S2C-lines-page.test.ts","line":[100,182,214,225,245,251,269],"owner":"lines.readWorkLinePage","value":"cursor","verdict":"v2 允许","note":"C；公开前页nextCursor原样续用"},
{"section":"2","file":"S2C-lines-scale.test.ts","line":[73],"owner":"lines.listArchivedLines","value":"cursor","verdict":"v2 允许","note":"C；公开前页nextCursor原样续用"},
{"section":"2","file":"S2C-node-detail-bounded.test.ts","line":[125,161,224],"owner":"nodeDetail.readNodeDetail","value":"afterCursor","verdict":"v2 允许","note":"C；公开前页nextCursor原样续用"},
{"section":"2","file":"S3-graph-context.test.ts","line":[901,1125,1138],"owner":"graph.lookGraph/findGraph","value":"afterCursor","verdict":"v2 允许","note":"C；公开返回见同文件:899、1123、1135"},
{"section":"2","file":"S5-decision-queue.test.ts","line":[286],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"C；公开前页nextCursor见同文件:282、287"},
{"section":"2","file":"S5-notices.test.ts","line":[173,192,215,259,269],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"同文件:170、179、209、256、261公开页原样；:173、192的上游F4不获豁免"},
{"section":"2","file":"S5R2-queue-history.test.ts","line":[233],"owner":"decisions.queryDecisionQueue","value":"cursor","verdict":"v2 允许","note":"C；公开前页nextCursor原样续用，续页参数见同文件:239"},
{"section":"2","file":"unknown-call-review-list.test.ts","line":[107,188],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"v2 允许","note":"C；公开前页nextCursor见同文件:104、183"},
{"section":"2","file":"S5-decision-application.test.ts","line":[198,221,241,263,273,286,297,355,377,389,402,411,417,429,437,451],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"同文件:34、39从捕获commit重建；:389又替换cursor；:53统一转交"},
{"section":"2","file":"S2A-queue-card-semantics.test.ts","line":[78],"owner":"decisionMessages.recordDecisionApplication","value":"receipt","verdict":"F1","note":"同文件:60、63从截获提交重建；:79转交"},
{"section":"2","file":"S2C-pins.test.ts","line":[216,227,244,254],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"F1","note":"同文件:51手造position、:52直接issue、:58转交"},
{"section":"2","file":"unknown-call-review-list.test.ts","line":[157],"owner":"unknownCallReviews.listReviews","value":"cursor","verdict":"F1","note":"同文件:152、154、159；手造记录refKey充当游标"},
{"section":"2","file":"S3-context-inputs.test.ts","line":[459],"owner":"plans.proposePlan","value":"artifactRef.digest","verdict":"F1","note":"同文件:116、119测试计算"},
{"section":"2","file":"S3-prepared-context-admission.test.ts","line":[315],"owner":"plans.proposePlan","value":"artifactRef.digest","verdict":"F1","note":"同文件:91手造，:313放入草稿"},
{"section":"2","file":"S3-context-inputs.test.ts","line":[392],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"真实installed.value.contentDigest原样"},
{"section":"2","file":"S3-graph-context.test.ts","line":[437],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"真实installed.value.contentDigest原样"},
{"section":"2","file":"S5-notices.test.ts","line":[189],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"seenThrough","verdict":"F1","note":"同文件:33构造pos；调用自造pos(12,r12)，拒绝不自动满足A6"},
{"section":"2","file":"WP2-undelivered-notices.test.ts","line":[174],"owner":"workspaceDecisionSettings.markNoticesSeen","value":"displayToken/seenThrough","verdict":"v2 允许","note":"helpers/WP2-notices-fixture.ts:115、121、122；公开页原样"},
{"section":"2","file":"S2B-r2-s-yielded.test.ts","line":[39],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"helpers/AG2b-collaboration-fixture.ts:446、451；安装返回原样"},

{"section":"2","file":"S2B-30-track-bars.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-31-task-timeline-main.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-32-task-timeline-fold.test.ts","line":[41],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-33-task-timeline-pagination.test.ts","line":[21,45,56,70,83,99],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-34-executed-files.test.ts","line":[22],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-activity-calendar-tasks.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FA"},
{"section":"2","file":"S2B-activity-calendar.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FA"},
{"section":"2","file":"S2B-activity-read-faults.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FA"},
{"section":"2","file":"S2B-r2-27-moving-window.test.ts","line":[76,94,113,157],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-r2-calendar-boundaries.test.ts","line":[16],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FA"},
{"section":"2","file":"S2B-r2-calendar-same-task.test.ts","line":[22],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FA；经日历夹具"},
{"section":"2","file":"S2B-r2-keyed-cap.test.ts","line":[15],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FA"},
{"section":"2","file":"S2B-r2-never-entered.test.ts","line":[17],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FA"},
{"section":"2","file":"S2B-r2-r3-track-pagination.test.ts","line":[23],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-r2-r4-bound-workspace.test.ts","line":[27,43],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-r2-r5-not-entered.test.ts","line":[19],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-r2-r7-keyed-read-cap.test.ts","line":[19,50],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-r2-s-preentry-control.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT；经时间线夹具"},
{"section":"2","file":"S2B-r2-workspace-binding.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FA"},
{"section":"2","file":"S2B-r3-consultation-cap.test.ts","line":[23],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FT"},
{"section":"2","file":"S2B-r4-session-workspace.test.ts","line":[32,38],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":":32为FT，:38为FA"},
{"section":"2","file":"S2B-run-activity-read.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"静态策略target.digest","verdict":"F1","note":"FA"},

{"section":"2","file":"S2A-notices-since.test.ts","line":[59],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S2A-notices-workspace.test.ts","line":[22,26,28,49,52,53],"owner":"completionPolicies.activateCompletionPolicy","value":"初始或追加策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S2A-queue-bounds.test.ts","line":[26],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S2A-queue-card-semantics.test.ts","line":[23],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S2A-queue-derived-cards.test.ts","line":[20],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S2A-queue-goal-runs.test.ts","line":[35],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S2A-queue-request-candidates.test.ts","line":[31],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S2A-queue-window.test.ts","line":[15],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S2B-30-track-bars.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-31-task-timeline-main.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-32-task-timeline-fold.test.ts","line":[41],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-33-task-timeline-pagination.test.ts","line":[21,45,56,70,83,99],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-34-executed-files.test.ts","line":[22],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-activity-calendar-tasks.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-activity-calendar.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-activity-read-faults.test.ts","line":[21],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-27-moving-window.test.ts","line":[76,94,113,157],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-activity-run-ended-at.test.ts","line":[52],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-calendar-boundaries.test.ts","line":[16],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-calendar-same-task.test.ts","line":[22],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-conflict-catalog.test.ts","line":[40],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S2B-r2-keyed-cap.test.ts","line":[15],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-never-entered.test.ts","line":[17],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-r3-track-pagination.test.ts","line":[23],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-r4-bound-workspace.test.ts","line":[27,43],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-r5-not-entered.test.ts","line":[19],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-r7-keyed-read-cap.test.ts","line":[19,50],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-s-preentry-control.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-v-real-runs.test.ts","line":[64,96,127,158],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r2-workspace-binding.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r3-consultation-cap.test.ts","line":[23],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-r4-session-workspace.test.ts","line":[32,38],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2B-run-activity-read.test.ts","line":[18],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-attention.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-controls.test.ts","line":[33],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-conversation.test.ts","line":[48],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-copies.test.ts","line":[34],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-counts.test.ts","line":[27],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-d1.test.ts","line":[26],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-done-evidence.test.ts","line":[33],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-failure.test.ts","line":[61],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-identification.test.ts","line":[34],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-latest-generation.test.ts","line":[23],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-names.test.ts","line":[27],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-page.test.ts","line":[91],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-paused-continue.test.ts","line":[35],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-read-only.test.ts","line":[87,147,157,208,255],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0；节点夹具使用ID"},
{"section":"2","file":"S2C-lines-scale.test.ts","line":[43],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-task-anchors.test.ts","line":[27],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-tiers.test.ts","line":[28],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-waiting-reply.test.ts","line":[27],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-lines-walk.test.ts","line":[60],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S2C-node-detail-anomalies.test.ts","line":[98,143,163],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"ID"},
{"section":"2","file":"S2C-node-detail-bounded.test.ts","line":[78,99,144,191,210,243],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"ID"},
{"section":"2","file":"S2C-node-detail-executions.test.ts","line":[20],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"ID"},
{"section":"2","file":"S2C-node-detail-hover.test.ts","line":[21,107,125,143,174,185],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"ID"},
{"section":"2","file":"S2C-node-detail-next-kinds.test.ts","line":[130],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"ID"},
{"section":"2","file":"S2C-node-detail-task.test.ts","line":[22,101,125],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"ID"},
{"section":"2","file":"S2C-pins.test.ts","line":[29],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S3-context-inputs.test.ts","line":[275],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S3-graph-context.test.ts","line":[382],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S3-prepared-context-admission.test.ts","line":[225,762],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"S5-decision-application.test.ts","line":[27],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S5-decision-queue.test.ts","line":[52,160],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":":52为I5，:160为I0"},
{"section":"2","file":"S5-goal-cause-at-least-cursor.test.ts","line":[16],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S5-goal-settings.test.ts","line":[90],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S5-notices.test.ts","line":[32,139,226,242,284],"owner":"completionPolicies.activateCompletionPolicy","value":"初始或追加策略target.digest","verdict":"v2 允许","note":"I5；含noticeWork追加政策"},
{"section":"2","file":"S5-request-candidates.test.ts","line":[55],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S5-user-messages.test.ts","line":[24],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"S5R2-queue-history.test.ts","line":[22,194],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"UCR-settle-review.test.ts","line":[60],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"unknown-call-review-list.test.ts","line":[40,199,229],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"W2-agent-whiteboard.test.ts","line":[39],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"W2-future-intent.test.ts","line":[116,137,167,195,328,347,379,456,480],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"WP1-context-anomalies.test.ts","line":[296],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"WP1-goal-content-entry.test.ts","line":[56,64,80,92,104,118],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},
{"section":"2","file":"WP2-context-extensions.test.ts","line":[223,269,329],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"WP2-message-duties.test.ts","line":[49],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I5"},
{"section":"2","file":"WP2-undelivered-notices.test.ts","line":[33],"owner":"completionPolicies.activateCompletionPolicy","value":"初始策略target.digest","verdict":"v2 允许","note":"I0"},

{"section":"2","file":"S2C-lines-read-only.test.ts","line":[283],"owner":"completionPolicies.activateCompletionPolicy","value":"target.digest","verdict":"v2 允许","note":"helpers/AG2b-collaboration-fixture.ts:446、451；安装回执原样"},
{"section":"2","file":"S2C-lines-attention.test.ts","line":[218],"owner":"completionPolicies.activateCompletionPolicy","value":"检查策略target.digest","verdict":"v2 允许","note":"helpers/S2C-L-check-support.ts:139、150；安装回执原样"},
{"section":"2","file":"S2C-lines-page.test.ts","line":[46],"owner":"completionPolicies.activateCompletionPolicy","value":"检查策略target.digest","verdict":"v2 允许","note":"helpers/S2C-L-check-support.ts:139、150；安装回执原样"},
{"section":"2","file":"S2C-lines-tiers.test.ts","line":[157],"owner":"completionPolicies.activateCompletionPolicy","value":"检查策略target.digest","verdict":"v2 允许","note":"helpers/S2C-L-check-support.ts:139、150；安装回执原样"},
{"section":"2","file":"S2C-lines-walk.test.ts","line":[67],"owner":"completionPolicies.activateCompletionPolicy","value":"检查策略target.digest","verdict":"v2 允许","note":"helpers/S2C-L-check-support.ts:139、150；安装回执原样"},
{"section":"2","file":"S2B-31-task-timeline-main.test.ts","line":[27,32],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R"},
{"section":"2","file":"S2B-32-task-timeline-fold.test.ts","line":[58,79,98,102,121,123,125,213,232,236],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R；:58含发信、回信、接续三次真实准备"},
{"section":"2","file":"S2B-33-task-timeline-pagination.test.ts","line":[105],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R"},
{"section":"2","file":"S2B-r2-27-moving-window.test.ts","line":[98,161],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R"},
{"section":"2","file":"S2B-r2-r7-keyed-read-cap.test.ts","line":[56],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R"},
{"section":"2","file":"S3-context-inputs.test.ts","line":[586,597,660],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R"},
{"section":"2","file":"S3-graph-context.test.ts","line":[591,598],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R"},
{"section":"2","file":"S3-prepared-context-admission.test.ts","line":[399,648],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"R"},
{"section":"2","file":"S2B-r2-v-real-runs.test.ts","line":[76,106,139,170],"owner":"runtime.startRun","value":"prepared","verdict":"v2 允许","note":"helpers/S2B-be1-platform-fixture.ts:303、305；真实prepareExecution结果原样"},
{"section":"2","file":"S2B-r2-activity-run-ended-at.test.ts","line":[52],"owner":"roles.activateRoleSpec/runtime.createSession","value":"role pin.digest","verdict":"v2 允许","note":"helpers/B2-runtime-fixture.ts:195、197、198、209；真实安装回执"},
{"section":"2","file":"S2B-r2-v-real-runs.test.ts","line":[64,96,127,158],"owner":"roles.activateRoleSpec/sessions.create","value":"role pin.digest","verdict":"v2 允许","note":"helpers/S2B-be1-platform-fixture.ts:189、193、194、219、224；安装回执原样pin"},
{"section":"2","file":"S3-role-profiles.test.ts","line":[189,233,265,277,304],"owner":"roles.readRoleSpec","value":"pin.digest","verdict":"v2 允许","note":"同文件:181、186、229、232、258、274、286、289；安装回执原样摘要"},
{"section":"2","file":"WP2-message-duties.test.ts","line":[73,145,158,313,333,523,540],"owner":"roles.activateRoleSpec/sessions.create","value":"pin.digest","verdict":"v2 允许","note":"同文件:65、72；安装回执原样pin，没有从角色记录重建"},
{"section":"2","file":"S2C-lines-counts.test.ts","line":[137],"owner":"lines.listArchivedLines","value":"cursor","verdict":"F1","note":"自造not-a-real-cursor；拒绝不自动满足A6"},
{"section":"2","file":"S2C-node-detail-bounded.test.ts","line":[249,254,258],"owner":"nodeDetail.readNodeDetail","value":"afterCursor","verdict":"F1","note":"同文件:249字面量、:252自行base64url编码"},
{"section":"2","file":"S3-context-inputs.test.ts","line":[914,985],"owner":"taskInputs.readTaskInputs","value":"candidateKey指纹","verdict":"F1","note":"同文件:128自行hash；:912、983组装来源后重算"},
{"section":"2","file":"S5-goal-cause-at-least-cursor.test.ts","line":[30,41,50,59,62],"owner":"causes.readGoalDecisionCauses","value":"atLeastCursor","verdict":"F1","note":"同文件:20、22取手造commit回执；:29、50、57另行构造"},
{"section":"2","file":"WP2-undelivered-notices.test.ts","line":[375,384,518,540],"owner":"undeliveredReplyNotices.readPage","value":"cursor","verdict":"v2 允许","note":"同文件:367、375、521、544；公开前页nextCursor原样"},
{"section":"2","file":"WP2-undelivered-notices.test.ts","line":[407,427,434,455],"owner":"undeliveredReplyNotices.readPage","value":"cursor/atLeastCursor","verdict":"F1","note":"同文件:397、398、399、426测试编码；:434字面量；:455自造水位"},
{"section":"2","file":"S2B-32-task-timeline-fold.test.ts","line":[58],"owner":"claims.claimTask","value":"consumedWait.responseRef.digest","verdict":"v2 允许","note":"helpers/S2B-task-timeline-fixture.ts:545、550；公开readMessage返回bodyRef原样"}
]
```

v2 允许 547，F1 78，F3 0，A7 越界 0，文件 84/84；枚举完整