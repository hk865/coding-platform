# WorkGraph 拆分方案重算（2026-10-07，任务 D 第 1 步）

> **2026-10-07 已执行（决定 40）：** 用户确认后按本方案做完了。X2 是 d91208e3，X1 是 58ea2fdc；18 个文件的搬移由本地 DSH 按 [TASK-D-PLAN](../dsh-ladder-2026-10-07/TASK-D-PLAN.md) 两阶段执行，和参考搬移逐字节一致，提交为 0cd45508（165 个文件 +392/−392 行，全量测试 216 个文件、5245 项全部通过）。在 58ea2fdc 上重算，总数和下文相同；只有 X2 让 3 处 import 改写从搬走的文件里挪到了不搬的 `evidence-service.ts`，所以分配是搬走的文件里 23 处、其它文件里 357 处（下文是 26 和 354）。把子模块规则写进 `module-target.json` 是验收后单独的一步，还没做。下文按提案时的原样保留。

> **状态：提案，等用户确认。** 本目录只有文档、脚本和测量输出，没有改 `src/`、`tests/`、`module-target.json`，没有调用模型，没有跑 DSH。搬移只在一份临时副本上做过，用来量数字和查边，量完副本已删。

**为什么做。** 决定 32、34：任务 D（WorkGraph 拆分，纯搬移）要在简化删减后的代码上重算方案，对照编排设计的结构部分（[DESIGN.md](../../../design/orchestration-2026-10/DESIGN.md) §7、[D-PLACEMENT.md](../../../design/orchestration-2026-10/D-PLACEMENT.md)），用户确认后才交给 DSH。10-02 的方案在 [workgraph-split-2026-10-02/TARGET-DAG.md](../workgraph-split-2026-10-02/TARGET-DAG.md)，bfb6075 上的搬移表草稿在 [dsh-ladder-2026-10-07/L3-MOVE-TABLE.md](../dsh-ladder-2026-10-07/L3-MOVE-TABLE.md)，执行做法在同目录的 [TASK-D-PLAN.md](../dsh-ladder-2026-10-07/TASK-D-PLAN.md)。

**量在哪个提交上。** `4404f4dc`（本目录提交前的 HEAD）。下文所有数字都是这个提交上的。

## 0. 结论

- **搬 18 个文件**：10-02 的 17 个（M1–M17）原样都还成立，另加 1 个（M18：第 6 步新加的 `communication/message-body-envelope.ts` 搬到 `sessions/`）。导出名都不变，7 个文件改名（按领域加前缀），其余 82 个文件不动。
- **子模块和 10-02 一样是 13 个**，层次按 DESIGN §7.2。改了三处：`state` 不依赖 WorkGraph 里任何东西；新加 `tasks → architecture`（设计要的，现在没用到）；新加 `model → state`（待你确认，见 §5 第 2 条）。设计里的 `notes`（L5.5）、`views`（L7）还没有文件，D 不建，只确认位置留着。
- **没有归属的文件 10 个**（10-02 之后新加、TARGET-DAG 没写到的，`state/` 的 13 个除外）：1 个建议搬（就是 M18），9 个建议留在原目录。
- **搬完后，检查器会拒绝的边**：按 10-02 的严格声明是 3 条，和 bfb6075 上是同样的 3 条；按本提案的声明（加了 `model → state`）是 2 条。都不能靠纯搬移解决，建议在 D 之前做两小步代码改动（X1、X2），之后是 0 条。
- **环**：搬完、再做 X1 和 X2 之后，子模块之间没有环。文件级还剩 2 个小环，都在一个子模块内部，每个都要靠一处只引用类型的 import 才成环（只算值引用就没有环）；搬移前就有，搬移改不了（§6）。
- **改动量**（推荐的 canonical 写法）：165 个文件 = 18 个搬走的 + 145 个改 import 的 + 2 个数据文件；380 处 import 路径改写（搬走的文件里 26 处、其它文件里 354 处）和 12 处路径字符串；测试文件 79 个。bfb6075 上是 157 个文件、358 处、15 处路径字符串。
- 在临时副本上做完 18 次搬移：`typecheck` 通过；模块级边界检查通过；把子模块规则写进副本的 `module-target.json` 后，边界检查报的正好是上面那几条边。

## 1. 从 10-02 到现在，WorkGraph 变了什么

文件数（`out/files-since-10-02.txt`）：

| 目录 | 10-02（a22ad30） | bfb6075 | 现在（4404f4dc） |
| --- | ---: | ---: | ---: |
| architecture | 8 | 8 | 8 |
| communication | 3 | 3 | 4 |
| configuration | 6 | 6 | 6 |
| evidence | 5 | 5 | 5 |
| materials | 9 | 9 | 5 |
| persistence | 7 | 8 | 8 |
| queries | 4 | 4 | 4 |
| sessions | 7 | 8 | 8 |
| state | 0 | 13 | 13 |
| tasks | 30 | 37 | 37 |
| 根目录两个单文件 | 2 | 2 | 2 |
| **合计** | **81** | **103** | **100** |

- **删掉的 4 个，都在 materials/，都是简化删的**：`grant-contracts.ts`、`grant-record-codecs.ts`、`grant-service.ts`（G1，060e769）；`material-facts-service.ts`（G3，77b517a）。
- **新加的 23 个**：
  - `state/` 13 个（任务 A 第 2 步，cbaed80）；
  - `persistence/rework-codecs.ts`（第 1 步，760e35c）；
  - `sessions/session-health.ts`（5.6，cf22f5a）；
  - `tasks/` 7 个：`requeue-service.ts`（5.4，b67111d）、`entry-plan-reader.ts`（5.4b，0543261）、`goal-control.ts`（5.5，d5ad9d5）、`reconcile-intents.ts`、`reconcile-reads.ts`、`run-reconcile-contracts.ts`、`run-reconcile-service.ts`（5.6，cf22f5a）；
  - `communication/message-body-envelope.ts`（第 6 步，a4417b2）。这是 bfb6075 之后唯一新加的文件。
- **规模**：10-02 是 81 个文件、37,403 行、250 条文件间 import；现在是 100 个文件、56,993 行、404 条（其中 136 条只引用类型）。行数按 `scripts/import-graph.mjs` 的算法，和 10-02 可比；用 `wc -l` 是 56,893。
- **目录之间**：现在 41 条目录边，68 个目录级基本环（只算值引用是 17 个）。除 `state/` 和两个根文件外的 9 个目录仍然互相缠成一团（`out/import-graph-before.md`）。
- **对 10-02 方案的影响**：
  - `materials → tasks` 这条边随材料授权删掉了，M1 少了一条理由，但 M1 仍然要搬（configuration、queries 和 model 里的其它契约都引用它）。
  - 17 次搬移的源文件都还在原路径，没有一次失效。
  - 新文件里只有 `message-body-envelope.ts` 留在原地会造成拒绝的边，所以多了 M18（§4）。

## 2. 目标子模块和允许的依赖

上层可以依赖下层，反过来不行。层号是 DESIGN §7.2 的。机器可读的版本是 `target.json`；`variants/target-strict.json` 是只差一处的对照（`model` 不依赖任何子模块，即 10-02 的原样）。行数按 import-graph 的算法，每个文件比 `wc -l` 多 1，和 §1 一致。

| 子模块 | 层 | 搬完后 文件 / 行 | 允许依赖 | 和 10-02 方案比 |
| --- | --- | ---: | --- | --- |
| model | L0 | 12 / 1,477 | state | **新加 `model → state`**，待确认（§5 第 2 条）；不加就和 10-02 一样无依赖 |
| state | L0 | 13 / 13,742 | — | 同。删掉 10-02 §8“需要时可以依赖 model”那句（D-PLACEMENT §6 第 4 条），`state` 只依赖 `src/contracts` |
| persistence | L1 | 9 / 4,814 | model | 同 |
| configuration | L2 | 5 / 3,081 | model, persistence | 同 |
| materials | L2 | 4 / 887 | model, persistence | 同。删了材料授权后只剩 4 个文件（X1 之后 5 个） |
| architecture | L2 | 8 / 2,987 | model, persistence | 同 |
| sessions | L3 | 9 / 4,556 | model, state, persistence, materials, architecture | 同 |
| source-authority-ports | L3 | 1 / 63 | materials | 同（单文件） |
| queries | L4 | 4 / 3,620 | model, state, persistence, materials, sessions | 同 |
| tasks | L5 | 31 / 17,299 | model, state, persistence, materials, **architecture**, sessions, queries | **新加 `tasks → architecture`**（D-PLACEMENT §3：检查“所属模块”、计划足迹要用）。现在没有文件用到 |
| source-authority-reader | L5 | 1 / 252 | source-authority-ports, materials, queries | 同（单文件） |
| evidence | L6 | 2 / 1,981 | model, state, persistence, architecture, tasks | 同 |
| communication | L6 | 1 / 2,234 | model, state, persistence, materials, sessions, queries, tasks | 同 |
| **合计** | | **100 / 56,993** | | |

**给设计留的位置**（`out/submodule-graph-after-X1-X2.txt` 末尾）：
- `notes`（L5.5，依赖 model、state、persistence、architecture、sessions、tasks；`evidence → notes`）：这些子模块都到不了 evidence、communication，所以加上不会成环。D 之后马上成立。
- `tasks → architecture`：X2 之后成立。只做 D、不做 X2 时，architecture → model → tasks 能走通，这时用这条边会成环。这也是建议 X2 放在 D 之前的一个理由。
- `views`（L7）：没有子模块在它上面，它可以读所有子模块。
- 这两个子模块在第一个文件落地时再声明（检查器要求声明的路径存在，D-PLACEMENT §3“写入时机”）。

**必须一直禁止的方向**（D-PLACEMENT §4、TARGET-DAG §9 第 5 点）：在 D 加 X1、X2 之后的图上逐条查过，都成立（`out/submodule-graph-after-X1-X2.txt` 的 “forbidden directions”）。只做 D 时，`sessions → tasks` 一条不成立，就是 §5 的第 3 条边。

**设计书和 10-02 方案不一致的地方，本提案怎么取：**
1. `state` 无依赖：照设计改（上表）。
2. `tasks → architecture`：照设计加。
3. `model → state`：设计（D-PLACEMENT §6 第 2 行）倾向修法 A，把类型挪到 `src/contracts`；本提案建议修法 B，原因见 §5 第 2 条。
4. X2：设计提出的拆分，本提案照做，给了具体做法（§5 第 1 条）。
5. 层次：DESIGN §7.2 就是 TARGET-DAG §1 加上 notes、views。只有一处例外：修法 B 让同在 L0 的 `model` 依赖 `state`，不是“只依赖更低的层”（`out/submodule-graph-after-X1-X2.txt` 第 74 行报的就是它）。选 B，就要把它写成 L0 内部的一条明确例外，见 §5 第 2 条。

**设计要、但不属于任务 D 的**（任务 D 只搬文件，TASK-D-PLAN §0）：
- 建 `notes/`、`views/` 和设计里的新记录、新字段（DESIGN §7.2“小件放哪”都落在现有子模块里，D 不碰）；
- X1、X2（修法 A 如果选它）这几步代码改动；
- 把子模块规则写进 `module-target.json`（10-02 §8 的片段，内容就是 `target.json` 的 `submodules`），D 验收之后单独做；
- 大文件拆分（10-02 §7 的 D.4）。现在超过 1,000 行的有 15 个，其中 6 个在 `state/`，行号全部要重算；
- WorkGraph 的公开入口文件（D-PLACEMENT §10，D 之后做）；
- 注释、测试标题、文档里的旧路径（初查 24 行，§7）。

## 3. 搬移清单

路径相对 `src/core/work-graph/`。“引用”是 `src/` 和 `tests/` 里直接 import 它的文件数 / 处数（`out/move-stats.txt`）。理由一栏写的是：不搬的话，哪条被拒绝的边会留下。

**进 model（12 个，共享契约，下沉到最底层）**

| # | 从 | 到 | 行 | 引用 | 理由 |
| --- | --- | --- | ---: | --- | --- |
| M1 | tasks/contracts.ts | model/task-contracts.ts | 112 | 47 / 49 | configuration、queries 和 model 里的其它契约都以类型引用它（configuration → tasks、queries → tasks） |
| M2 | tasks/claim-contracts.ts | model/claim-contracts.ts | 107 | 33 / 33 | persistence/execution-entry-codecs.ts:35 引用它（persistence → tasks） |
| M3 | tasks/execution-entry-contracts.ts | model/execution-entry-contracts.ts | 158 | 28 / 30 | persistence/execution-entry-codecs.ts:36、communication/contracts.ts:32 引用它 |
| M4 | tasks/execution-read-contracts.ts | model/execution-read-contracts.ts | 113 | 32 / 35 | M3、communication 和 evidence 的契约都引用它；不搬，model 就要依赖 tasks |
| M5 | tasks/execution-history-contracts.ts | model/execution-history-contracts.ts | 32 | 7 / 7 | persistence/execution-history-codecs.ts:35 引用它（persistence → tasks） |
| M6 | tasks/plan-contracts.ts | model/plan-contracts.ts | 238 | 42 / 45 | 现在只有 tasks 里的文件引用它，但 M13 之后 persistence/plan-record-codecs.ts:39 要引用它（persistence → tasks）。它带进 model 一条 model → state，见 §5 第 2 条 |
| M7 | configuration/contracts.ts | model/configuration-contracts.ts | 39 | 10 / 10 | M2、M3、tasks/execution-entry-service.ts:56 和 communication、queries 的契约都引用它（model → configuration、tasks → configuration、queries → configuration） |
| M8 | materials/contracts.ts | model/material-contracts.ts | 18 | 14 / 14 | M3、communication 和 evidence 的契约都引用它（model → materials） |
| M9 | sessions/contracts.ts | model/session-contracts.ts | 59 | 23 / 25 | communication/contracts.ts:31 引用它；不搬，model 就要依赖 sessions |
| M10 | communication/contracts.ts | model/communication-contracts.ts | 272 | 34 / 37 | queries/contracts.ts:42 和 tasks 的 4 个文件（claim-service、execution-read-contracts、requeue-service、run-state-service）引用它（queries → communication、tasks → communication） |
| M11 | evidence/contracts.ts | model/evidence-contracts.ts | 240 | 19 / 19 | M14 之后 persistence 的 evidence-record-codecs 要它的 `FinalizedChecks`（persistence → evidence）。它带进 model 一条 model → tasks，见 §5 第 1 条 |
| M12 | tasks/task-index.ts | model/task-index.ts | 77 | 3 / 3 | architecture/catalog-record-codecs.ts:25 引用它（architecture → tasks） |

**进 persistence（2 个，多个子模块共读的记录编码）**

| # | 从 | 到 | 行 | 引用 | 理由 |
| --- | --- | --- | ---: | --- | --- |
| M13 | tasks/plan-record-codecs.ts | persistence/plan-record-codecs.ts | 929 | 36 / 36 | queries/query-execution.ts:42、query-job-service.ts:58 引用它（queries → tasks） |
| M14 | evidence/evidence-record-codecs.ts | persistence/evidence-record-codecs.ts | 657 | 13 / 13 | tasks 的 completion、plan-readers、reconcile-reads、run-state-service 引用它（tasks → evidence） |

**进 sessions（2 个，消息的记录编码）**

| # | 从 | 到 | 行 | 引用 | 理由 |
| --- | --- | --- | ---: | --- | --- |
| M17 | communication/message-record-codecs.ts | sessions/message-record-codecs.ts | 584 | 13 / 13 | tasks 的 claim-service、execution-entry-service、run-state-service 和 queries/query-job-service.ts:57 引用它（tasks → communication、queries → communication）；它自己只依赖 sessions 的 session-record-codecs |
| **M18（新）** | communication/message-body-envelope.ts | sessions/message-body-envelope.ts | 79 | 2 / 2 | tasks/run-state-service.ts:51 引用它（tasks → communication）；它自己只依赖 M10、M17 搬走的两个文件。详见 §4 |

**进 tasks（2 个，跟着唯一或主要的使用方上移）**

| # | 从 | 到 | 行 | 引用 | 理由 |
| --- | --- | --- | ---: | --- | --- |
| M15 | persistence/model-request-codecs.ts | tasks/model-request-codecs.ts | 247 | 5 / 5 | 它以类型引用 tasks/model-call-contracts.ts（persistence → tasks），使用方是 tasks/model-call-service |
| M16 | evidence/coverage.ts | tasks/evidence-coverage.ts | 199 | 4 / 4 | tasks/completion.ts:60 引用它（tasks → evidence）；它自己依赖 tasks/plan-task-basis |

行数是 `wc -l`。7 个改名的（M1、M7–M11、M16）是因为 model/ 里会有 6 个 `contracts.ts`，`coverage.ts` 进 tasks/ 后含义不清，和 10-02 一样只改文件名、不改导出名。机器可读的清单是 `moves.json`，格式就是 TASK-D-PLAN §2 第 1 步要的（`id`、`from`、`to`）。

**不动的 82 个文件**（各在自己目录对应的子模块里）：
- state（13）：attempt-machine、control-intent-machine、goal-machine、message-machine、no-progress、plan-machine、query-run-recovery、run-machine、session-availability、task-failure、task-machine、transition、verification-machine
- persistence（7）：commit-compiler、control-record-codecs、execution-entry-codecs、execution-history-codecs、graph-repository、record-codecs、rework-codecs
- configuration（5）：project-bootstrap-contracts、project-bootstrap-record-codecs、project-bootstrap-service、role-memory-service、role-record-codecs
- materials（4）：applicability、material-service、record-ports、record-readers
- architecture（8）：architecture-delta、architecture-record-codecs、architecture-service、catalog-contracts、catalog-record-codecs、catalog-service、contracts、graph-index
- sessions（7）：lifecycle-contracts、lifecycle-record-codecs、session-directory、session-health、session-lifecycle、session-record-codecs、session-targets
- queries（4）：contracts、query-execution、query-job-service、query-record-codecs
- tasks（29）：claim-record-codecs、claim-service、completion-policy、completion-record-codecs、completion、control-contracts、control-service、eligibility、entry-plan-reader、execution-entry-service、execution-history-binding、execution-history-service、goal-control、initial-plan、model-call-contracts、model-call-service、plan-commit-compiler、plan-readers、plan-service、plan-task-basis、plan-validation、plan-write-admission、reconcile-intents、reconcile-reads、requeue-service、run-reconcile-contracts、run-reconcile-service、run-state-service、task-service
- evidence（2）：evidence-service、verification-plan
- communication（1）：mailbox-service
- 根目录：source-authority-ports.ts、source-authority-reader.ts

注意：`architecture/contracts.ts`、`queries/contracts.ts` 不动，但和搬走的几个 `contracts.ts` 同名。写任务书时要按 TASK-D-PLAN §4 第 2 条把它们列出来。

## 4. 没有归属的文件（请逐个确认）

10-02 之后新加、TARGET-DAG 没有写到的文件。`state/` 的 13 个不算在内，TARGET-DAG 已经声明了 `state` 子模块。每个文件的进出边见 `out/import-graph-before.md`。下表的“留在原目录”，都是在搬完后的图上查过：它们在原目录不会造成被拒绝的边。

| 文件 | 行 | 建议 | 为什么 |
| --- | ---: | --- | --- |
| communication/message-body-envelope.ts | 79 | **搬到 sessions/（M18）** | `tasks/run-state-service.ts:51` 要用它解出消息正文。留在 communication，就有一条 tasks → communication，这是必须禁止的方向，X1、X2 也解不掉（对照：`variants/without-M18/`）。它只依赖 communication 的契约（M10 进 model）和消息编码（M17 进 sessions），所以跟着消息编码走，放 sessions 不会产生新的边 |
| persistence/rework-codecs.ts | 321 | 留在 persistence | 返工事实的编解码。persistence/execution-entry-codecs 引用它，所以只能在 persistence 或更低；它不依赖 WorkGraph 里的任何文件 |
| sessions/session-health.ts | 136 | 留在 sessions | 只依赖 sessions 的两个编码和 `state/session-availability`；WorkGraph 里没有文件引用它（Host 用） |
| tasks/entry-plan-reader.ts | 65 | 留在 tasks | 只有 execution-entry-service 用它；它读计划 |
| tasks/goal-control.ts | 225 | 留在 tasks | 目标的暂停、继续、取消。DESIGN §7.2：目标设置写在 tasks |
| tasks/reconcile-intents.ts | 253 | 留在 tasks | 启动时的对账；execution-entry-service 和 run-reconcile-service 用它 |
| tasks/reconcile-reads.ts | 114 | 留在 tasks | 对账要读的计划、执行事实；依赖 tasks 的 plan-readers、run-state-service |
| tasks/requeue-service.ts | 855 | 留在 tasks | 重新入队；依赖 tasks 的领取、计划、执行入口；evidence-service 用它（evidence 在 tasks 上面，方向对） |
| tasks/run-reconcile-contracts.ts | 116 | 留在 tasks | 运行对账的契约。WorkGraph 里只有 run-reconcile-service 用它。它引用 state 的类型，放进 model 会多出 model → state；和留在 tasks 的 control-contracts、model-call-contracts 同类 |
| tasks/run-reconcile-service.ts | 665 | 留在 tasks | 运行对账服务；依赖 tasks 的执行入口、计划读取 |

## 5. 搬完后检查器会拒绝的边（请逐条确认处理办法）

搬完 18 个文件后，`out/submodule-graph-after-strict.txt` 用 10-02 的严格声明，报的是下面 3 条边，和 bfb6075 上 17 次搬移后的 3 条一样；`out/submodule-graph-after.txt` 用本提案的声明，报的是第 1、3 条。把声明写进副本的 `module-target.json` 后，`check:architecture` 报的也正好是这几行（`out/check-architecture-with-submodules*.txt`）。

三条都不能靠纯搬移解决：要么改代码（某个导出换文件），要么改声明。按 TASK-D-PLAN §0，它们都不交给 DSH。

**第 1 条：`model/evidence-contracts.ts:42 → tasks/plan-write-admission.ts`（只引用类型 `PlanDelegatedWriteDependencies`；model → tasks）**
- 这条边是 M11 带进来的。evidence/contracts.ts 里只有 `EvidenceServiceDependencies` 的 `delegatedWrites` 字段（第 235 行）用这个类型。
- 它还把 6 个文件连成一个环（环上有一处只引用类型，只算值引用时没有这个环），并且挡住 `tasks → architecture`（§2）。
- **建议 X2（D 之前做的一小步代码改动）**：把 `EvidenceServiceDependencies` 和只给它用的 `CheckConfigurationResolver`，从 evidence/contracts.ts 挪进 evidence/evidence-service.ts，放在用它的 `createEvidenceService` 旁边。tasks/plan-service.ts、tasks/requeue-service.ts 也是把自己的依赖类型写在服务文件里。
  - evidence-service.ts 本来就在第 79 行引用 plan-write-admission，所以没有新边。
  - 要改的 import 只有两处：evidence-service.ts:110 的 import，和 tests/work-graph/R3e-reverify.test.ts:61。
  - 导出名不变，但换了所在文件，所以不算纯搬移。
- 不建议的另一种做法：把整个 evidence/contracts.ts 搬进 tasks/ 而不是 model/。这是纯搬移，但证据服务的端口 `EvidencePort` 会放在 tasks 里，位置不对。

**第 2 条：`model/plan-contracts.ts:19 → state/goal-machine.ts`（只引用类型 `GoalDisplayV1`、`GoalResumeContinuationV1`、`GoalRunControlCapabilityV1`；model → state）**
- 这条边是 M6 带进来的。
- **建议修法 B：在声明里允许 `model → state`**，不改代码。
  - 不会成环：`state` 不依赖 WorkGraph 里的任何东西，检查器的纯目录规则也一直管着它。
  - model 和 state 都在 L0，state 仍是最底层。但这不是“只依赖更低的层”：B 要在层次规则里写一条 L0 内部的明确例外（`model` 可以依赖 `state`，反过来不行）。D-PLACEMENT §6 第 2 行也把 B 列为可选。
- **设计书倾向的修法 A**（D-PLACEMENT §6 第 2 行）：把类型挪到 `src/contracts`，让 model 保持无依赖。
  - 不是 3 个类型。`GoalDisplayV1` 还要带上它引用的 `GoalDisplayPhase`、`GoalDisplayRow`、`GoalDisplayCauseV1`、`GoalStopCauseCode`、`GoalRunStopV1`、`GoalRunStopStateV1`，一共至少 9 个导出类型。
  - 还要多处理一个依赖：`GoalDisplayCauseV1` 用到 `PlanProposalRef`（goal-machine.ts:833），它是从 `state/plan-machine.ts`（第 55 行）引进来的。挪到 `src/contracts` 时不能带着这个 import（契约层不能依赖 WorkGraph，`check-boundaries.mjs` 第 511 行会拒绝），要换成契约层已有的写法（例如 `PlanProposalSnapshot['ref']`），或者把它也挪过去。`code-steps.json` 原先没写这一点。
  - 它们都由 goal-machine 里的纯函数算出来，A 会把它们和算它们的函数分到两处。
  - 引用这些名字的 8 个文件（src 4 个、测试 4 个）可以不改：goal-machine.ts 从 `src/contracts` 引进来再原样导出，和它对 `GOAL_FAN_OUT_ACTOR` 的做法一样（第 62 行）；只有 `model/plan-contracts.ts` 改成直接从契约层引用。这一条原先写成“都要改 import”，说多了。
  - 严格声明下的 0 条模拟（`out/submodule-graph-after-X1-X2-A-strict.txt`）只改了 import 边，没有核对上面这个契约层依赖。
- **lead 仍建议 B**：不改代码，一行声明，加一条写明的例外。A 的改动比原先写的小，但多一个要另想写法的依赖，名字也会有两个出处。你要是希望层次规则不留例外、model 一点依赖都没有，就选 A；A 是 D 之前的第三步代码改动。

2026-10-07 补注：本节第 2 条、§2 第 5 点和 §5、§9 里写入子模块规则的时机，按 Codex（xhigh）对本方案的审查改过。它没找到必须改的问题，自己重数了 380 处改写、158 个文件，结果和 §7 一致；它的原文在 `out/codex-review.md`。

**第 3 条：`sessions/session-directory.ts:68 → tasks/run-state-service.ts`（值引用 `decodeRun`；sessions → tasks）**
- 这条边今天就有，不是搬移带来的。
- **建议 X1（10-02 方案 §4 原样，D 之前做）**：把 `decodeRun`、`Decoded<T>` 和 `RUN_VALIDATE` 的选择，从 tasks/run-state-service.ts 拆到新文件 materials/run-snapshot-decoder.ts，约 45 行。
  - `decodeRun` 只是 materials/record-readers 里 RunSnapshot 校验器外面的一层包装，所以放 materials。
  - 要改的 import：session-directory.ts:68、mailbox-service.ts:68、completion.ts:64、reconcile-reads.ts:24、run-state-service.ts 自己，还有测试 tests/state/invariants.ts:94、tests/work-graph/A2-step1-codecs.test.ts:90。
  - 新文件、导出换文件，所以是代码改动。

**做完之后。** D 加上 X1、X2（声明按修法 B），模拟出来是 0 条被拒绝的边，所有必须禁止的方向都成立（`out/submodule-graph-after-X1-X2.txt`）。模拟只改 import 边，代码改动本身由 `code-steps.json` 描述，要另行实现和审查。

**建议的顺序。**
1. lead 先做 X1、X2，各自审查后提交（如果选修法 A，A 也在这里做）。
2. 在那之后的提交 H 上，按 TASK-D-PLAN §2 重算数字。X1、X2 会改到几个 import，下面 §7 的数字会差几处。
3. 交给 DSH 做 18 次搬移。
4. D 验收之后，单独一步把子模块规则写进 `module-target.json`（不在 D 的补丁里，TASK-D-PLAN §0），审查后提交，边界检查马上通过。

如果先做 D、后做 X1、X2 也行，只是 D 验收时边界检查要先容忍这 2 条边，片段要等 X1、X2 做完再写。

## 6. 有没有环

**子模块之间**（`out/submodule-graph-*.txt` 的 “cycles”）：

| 时点 | 所有引用 | 只算值引用 |
| --- | --- | --- |
| 搬移前（按目录） | 9 个目录一团，68 个基本环 | 6 个目录一团，17 个基本环 |
| 只做 D | 1 团：architecture、materials、model、persistence、queries、sessions、tasks。全是 §5 的边造成的 | 1 团：queries、sessions、tasks（第 3 条边） |
| D + X1 + X2（声明按修法 B） | **无环** | **无环** |
| D + X1 + X2 + A（严格声明） | 无环 | 无环 |

**文件之间。** 有 3 个强连通分量，每个都至少有一处只引用类型；只算值引用时是 0 个。搬移改不了它们，因为搬移不改谁引用谁，搬移前就有。

- **6 个文件的那个**：evidence/contracts → tasks/plan-write-admission → … → evidence-record-codecs → evidence/contracts。X2 拆掉它。
- **model 里 3 个文件**：execution-read-contracts.ts:17 引用 communication 契约的 `SessionMessage`；communication/contracts.ts:32–33 又引用 execution-entry-contracts、execution-read-contracts 的类型。第 1 步（760e35c）带进来的。
- **state 里 2 个文件**：run-machine.ts:47 值引用 control-intent-machine；control-intent-machine.ts:44 反过来引用类型 `RunNode`、`RunPointer`。文件第 69 行的注释说明这是有意的。第 2 步（cbaed80）带进来的。

10-02 的图在文件级没有环，TARGET-DAG §9 第 2 点写的是“文件级仍然必须无环”。后两个是 10-02 之后新出现的，D 之后各在一个子模块内部，编译后不存在（只有类型）。

**建议：** 接受这两个；收尾检查里的“无环”按“子模块之间无环、文件之间没有值引用的环”来算。如果你要求文件级也一个环都没有，收尾时各做一次小的类型挪动（不属于 D）。

## 7. 数字（4404f4dc，`out/counts.txt`）

TASK-D-PLAN §3 两种写法都量了。推荐 canonical：搬走的文件里每个相对路径都按新位置重写。

| 项 | 本次（18 次搬移） | bfb6075（17 次，L3-MOVE-TABLE） |
| --- | --- | --- |
| 改动的文件 | 165 = 18 搬走 + 145 改 import + 2 数据文件 | 157 = 17 + 138 + 2 |
| import 路径改写，canonical | 380 处 / 158 个文件 = 搬走的文件里 26 处 / 13 个 + 其它文件 354 处 / 145 个 | 358 / 150 = 25 / 12 + 333 / 138 |
| import 路径改写，literal | 376 / 157 = 22 / 12 + 354 / 145 | 354 / 149 = 21 / 11 + 333 / 138 |
| 其它文件按位置分 | `src/` 68 个文件 204 处；`tests/` 77 个文件 150 处；`vitest.config.ts` 0 | — |
| 路径字符串 | 12 = `production-reach-allowlist.json` 5 + `state-writes.test.ts` 7 | 15 = 8 + 7 |
| 动到的测试文件 | 79 = 77 个只改 import + 2 个数据文件 | — |
| import 图 | 100 个文件，404 条 | 103 个文件，414 条 |

- **两种写法差的 4 处**：在 M14、M15、M16、M17 搬走的文件里，原写法 `../<自己目录>/x.js` 搬完后仍能解析到同一个文件（`out/listing-literal-drops.txt`）。
- **路径字符串**（`out/path-places.txt`）：
  - allowlist 里是 configuration/contracts.ts 5 处；
  - state-writes 里，完整路径 4 处（claim-contracts 1、plan-contracts 2、communication/contracts 1），`file:` 3 处（plan-record-codecs、evidence-record-codecs、message-record-codecs）。
- **H 上出现的 import 写法**（TASK-D-PLAN §2 第 7 步）：
  - `import … from`、`export … from`；
  - 类型位置的 `import('…')` 5 处：src/app/attention-observer.ts:438、:440，src/app/host.ts:946，communication/mailbox-service.ts:1538，tasks/plan-write-admission.ts:230；
  - 动态 `import()` 0 处，`vi.mock`、`vi.importActual`、`vi.doMock` 0 处，`vitest.config.ts` 0 处。
- **别的按路径点名 WorkGraph 文件的地方**：除了两个数据文件，没有（`out/path-strings.txt`）。tests/architecture/boundaries.test.ts 里的路径都是临时目录里的假文件；scripts/ 里只有一处 import 了 `dist/…/persistence/record-codecs.js`，那个文件不搬。
- **每一处改写**：`out/listing-canonical.txt`，380 + 12 = 392 行，格式就是 TASK-D-PLAN §4 第 5 条 dry run 的格式；`out/diff-stat.txt` 是副本上 `git diff -M --stat`。
- **副本上的检查**：
  - `typecheck` 退出码 0（`out/typecheck-after.txt`）；
  - 模块级 `check:architecture` 通过（`out/check-architecture-after.txt`）；
  - 写上子模块规则后，报的正好是 §5 的边。
- **旧名字**（D 之后的跟进，不属于 D；正式清单在 H 上按 TASK-D-PLAN §2 第 8 步做）：
  - 按旧路径点名的注释和测试标题 14 行（src 13、测试标题 1，`out/stale-by-path.txt`）；
  - 只写文件名的 10 行：state/message-machine.ts 里 8 处 `contracts.ts:NN`，`coverage.ts:NN` 2 处（`out/stale-by-name.txt`）；
  - 共 24 行，bfb6075 上是 38 行。

## 8. 怎么复现

`scripts/measure.sh <输出目录> [<提交>]`：在一个装好 `node_modules` 和 `vendor/coding-agent/node_modules` 的检出里运行。它把指定提交 `git archive` 到 `.taskd-scratch/copy`，在副本里依次做下面几步，最后删掉副本：

1. 列出 10-02 以来增删的文件（`files-since-10-02.txt`）；
2. 画搬移前的 import 图（`import-graph-before.md`、`submodule-graph-before.txt`），算每次搬移的引用数（`move-stats.txt`），列出引用方（`importers.txt`），做文本扫描（`scan-text.sh` → `path-places.txt`、`path-strings.txt`、`stale-by-*.txt`）；
3. 用参考脚本做搬移（`ladder/wg-move.mjs` → `wg-move.json`），列出每个文件该改什么（`ladder/mk-expected.mjs`），再分类计数（`expected-counts.json`、`counts.txt`、`listing-canonical.txt`、`listing-literal-drops.txt`、`diff-stat.txt`）；
4. 画搬移后的 import 图，按 `target.json` 和 `variants/target-strict.json` 检查（`import-graph-after.md`、`target-check-after.json`、`submodule-graph-after*.txt`）；用 `what-if.mjs` 把 `code-steps.json` 里 X1、X2（以及 A）的 import 变化加上，再检查一次；
5. 在副本上跑 `typecheck` 和边界检查，再把子模块规则写进副本的 `module-target.json` 检查一次（`check-architecture-*.txt`）。

另外，`MOVES=variants/moves-without-M18.json` 是不搬 M18 的对照，结果在 `variants/without-M18/`：多一条 tasks → communication，X1、X2 之后还在。

`scripts/ladder/` 是 DSH 分级测试的工具，从本次会话临时目录的 `dsh-ladder/_tools`、`_common` 原样复制，没有改过；哈希在 `SHA256SUMS`，`mk-expected.mjs`、`lib.mjs` 和 WSL `~/dsh-work/ladder/_common` 里的一致。

2026-10-07 这次是在会话的 WSL 槽里跑的。那里的 HEAD 是一个快照提交，叠在真实 HEAD 上，只多了本目录，所以 `<提交>` 用的是 `HEAD^`（= 4404f4dc）。每次约 25–30 秒。环境是 node v24.18.0、typescript 6.0.3。

## 9. 请你确认的

1. **子模块和允许的依赖**按 §2 的表（`target.json`），包括新加的 `tasks → architecture`。`notes`、`views` 留位置，等第一个文件落地时再声明。
2. **搬移清单**按 §3：M1–M18（`moves.json`），其余 82 个文件不动。
3. **没有归属的文件**按 §4：`communication/message-body-envelope.ts` 搬到 `sessions/`（M18）；`persistence/rework-codecs.ts`、`sessions/session-health.ts` 和 tasks/ 下 7 个文件留在原目录。
4. **第 1 条边**（model → tasks）：D 之前做 X2，把 `EvidenceServiceDependencies`、`CheckConfigurationResolver` 挪进 `evidence/evidence-service.ts`。
5. **第 2 条边**（model → state）：声明允许 `model → state`（修法 B，lead 建议）；或者按设计书做修法 A，把 9 个以上的显示类型挪到 `src/contracts`。
6. **第 3 条边**（sessions → tasks）：D 之前做 X1，`decodeRun` 拆到 `materials/run-snapshot-decoder.ts`。
7. **文件级两个靠类型引用才成的环**（model 里 3 个契约文件、state 里两个状态机）：接受，收尾的“无环”按子模块之间和值引用来算；或者收尾时拆掉。
8. **顺序**：X1、X2 先做，然后在新的提交上重算、交 DSH 搬移；D 验收以后，再单独一步写入子模块规则。
