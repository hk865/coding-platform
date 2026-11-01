# 计划闭环（PL）规格
lead，2026-11-01。设计唯一依据：`plan-loop-design.md`（v4 定稿，685 行；第 18 节用户答复不改）。代码、测试的行号按 合并树 `5a1ec32` 的合并树 `5a1ec32`（有 Q、L1、F2、T，没有 H、L2）。文档行号按 `docs/` 同一副本。

状态：**已冻结（11-01）**。Codex 两轮全审（37 条、22 条）加一次快速核对（8 条），lead 审 §21、§22 后冻结。之后的修改走偏差，不再审这一层。

---
## 0. 一页说明（给用户）
**一句话。** 计划从“人采用一次”变成闭环：执行中发现缺口或偏差，参谋写下一段或改计划；候选先过机械诊断，再过审阅；目标循环按自治级别自动采用或转成候选卡；采用后回到执行。人能看到每一段的任务书、改动和用量。

**要解决什么（设计 §1）。** 闭环下半圈（执行、检查、同义务返工、完成）已通，上半圈（分层细化、核对分解、偏差回计划、并发顺序）没通。根因是计划只有“采用”一个入口，没有把“发现缺口 → 规划 → 核对 → 再采用”做成产品流程。

**怎么改（设计 §4、§5–§7）。**
- 规划输出“阶段骨架 + 第一段”；阶段 gate 按阶段验收；有活动的必需 `plan_only` 任务时，平台发一条系统 `action_request`（系统轮）给参谋，模型只写这一段，平台合并成完整草稿。
- 候选统一由目标循环处理：机械诊断（只查“每条必需验证要求都有注册检查覆盖；`reviewer` 类在第 9 片前算不覆盖”）→ 审阅（`pass` / `fix`，最多改 3 次）→ 自动采用 / 转候选卡。
- 偏差统一走一条路：执行者上报、平台发现（超 2 倍线、`budget_exhausted`、返工上限、`no_new_basis`）都发 `deviation:` 系统轮或转卡；只挡那一支，不新造停止机制，不做硬刹车。
- 任务书就是细化提案：每任务的 `assignment.instruction`，接口写模块注记，阶段说明只作说明；新增可选 `estimatedLines`；采用和转卡时导出 Markdown 到工作区外。
- 三个读数是累计 token、上下文增长量、改动行数（v3 §4.2）；阶段线 2,000 行或 0.6B token 只提醒；任务 2 倍线分 `growth`（上下文增长量过 `sizeClass` 的 2 倍线）和 `lines`（改动行数超 `estimatedLines` 的 2 倍）两条，开参谋轮并告诉人，不停任务；阈值可配置、不挡采用。

**不改什么。**
- 执行、检查、同义务返工、完成归约不变；执行结果的审阅不变（第 9 片）。
- 不加持久状态、不加记录种类、不加层级；不自动拆目标；不新增 Agent 角色；不做硬刹车；不做通用工作流。
- 三条公开路由的输入/返回格式不变；`{{task}}` 的来源不变（仍是 `instruction`）。

**边界变化（D8，已由用户定）。** 所有 agent 候选要审阅 `pass` 才自动采用，这是“采用前的模型审批”，改变了 `PRODUCT.md:319`、`:325` 的边界；PRODUCT 的改稿归 lead（设计 §12.1）。执行结果的审阅、D15 的首个方案审阅只管计划候选和首个方案，不碰完成证据。

**不做（本规格只写依赖）。** 真实的参谋线、审阅线（7D2 的 `role_line_add` 加审阅者）和第 5、6 步的真实模型验收只写依赖，不写做法；设计 §11 的 MVP 之后项只列在 §18。

---
## 0.1 范围和读法
本规格覆盖设计 §13 的第 2、3、4 步：

| 步 | 内容 | 本规格 |
|---|---|---|
| 2 | 三个读数 | §13.2、§10.3 |
| 3 | PL-1：系统轮、触发、阶段 gate、分段输出、任务书、目标循环、诊断、审阅轮 | §5、§6 |
| 4 | PL-2：偏差 | §7、§8、§10 |

读法：章节号沿用设计，本规格只写 §5、§6、§7、§8、§10、§13.2、§15、§21、§22；其余章节是设计或其他片，不在本规格。先看 §1 的现状和落点；PL-1 从 §5 读到 §6；PL-2 从 §7 读到 §10；三个读数在 §13.2（§10 是它的尺子）；§15 是业务流程测试（设计行 53 条 + 规格新增 12 条）；清单 A 在 §5.9.1，清单 B 在 §15.8；规格新定和偏差的逐条明细只在末尾 §21、§22；§18 是不做；§19 是依赖和 7D1 的串行落地。

本规格不写：设计 §11 的 MVP 之后项的做法、第 5、6 步（真实参谋线/审阅线、真实模型验收）的做法、6C L13 和 8C 的改法、执行结果审阅的改法。
## 1. 现状与改动位置核对
核对对象：合并树 `5a1ec32`的 `src/`、`tests/`、`resources/`；文档另注为 `docs/`。行号都是 tree 内容行号；tree 没有 `.git`，按文件内容找。
### 1.1 基线（Q/L1/F2/T 在、H/L2 不在）

| 组 | 在/不在 | 证据（符号或文件） |
|---|---|---|
| Q | 在 | `src/core/agent-runtime/request-read-tools.ts:27` `export const READ_REQUESTS_TOOL_NAME = 'read_requests'`；`src/core/agent-runtime/tool-group-assembly.ts:654` 把 `read_requests` 选进 Query 工具；`tests/runtime/S7C1-Q-read-requests.test.ts` 在 |
| L1 | 在 | `src/contracts/goal-decisions.ts:226` `message_release` 卡源；`src/core/work-graph/model/communication-contracts.ts:122` `release: MessageReleaseV1 \| null`；`src/core/work-graph/communication/mailbox-service.ts:4936` `releaseMessage`；`tests/business/S7C-L1-gate-sources.test.ts` 等 6 个 `S7C-L1-*` 测试在 |
| F2 | 在 | `src/core/work-graph/communication/mailbox-service.ts:2644` `sendMessage`（可信发送身份/回执路径）；`:917` `dispatchCurrentOf`；`tests/contracts/S7C-f2-pack.test.ts` 在 |
| T | 在 | `src/core/agent-runtime/handoff-tools.ts:79` `createHandoffTools`；`:25` `HandoffRequestPort`；`src/core/agent-runtime/execution-contracts.ts:346-347` 的可选 `handoffs`；`tests/runtime/S7C-T-tools.test.ts`、`S7C-T-adapters.test.ts` 在 |
| H | 不在 | `src/core/agent-runtime/handoff-tools.ts:2` 写明 `requestHandoff (B/handoff-tool-entry.ts, H) owns all of them`；tree 中没有 `handoff-tool-entry.ts`，也没有 `requestHandoff` 的实现（只有 `HandoffRequestPort` 类型和注释） |
| L2 | 不在（按 7C-2 的分组） | `src/core/agent-runtime/handoff-tools.ts:23-24` 写明 `T declares it so T compiles before H's file merges, and L2 passes the real function at composition`；`src/core/agent-runtime/execution-driver.ts:636` 只做可选展开，`src/composition/create-platform.ts` 没有给 `handoffs` 赋值 |

**L2 同名提醒：** 7A 另有一个「L2 派工三版核对和序号」；那一套在 tree 里已有（`src/core/work-graph/tasks/dispatch-basis.ts:64` `createDispatchBasisReader`、`mailbox-service.ts:135` `firstDispatch/nextDispatch`）。本报告的「L2 不在」指 7C-2 里接 `requestHandoff` 的那一组，不是 7A 的 L2。lead 合并时要按任务书的组名再确认一次。
### 1.2 第 2 节/第 12 节逐行核对（只留落点）

| 设计行 | 落点/现状 | 对规格的影响 |
|---|---|---|
| 2.1 | `workflow.ts:1929-1940` 的 `unfinishedWork`/`waiting`，`:570` 的 `plan_only`；没有开轮代码 | 触发条件按 1929-1940，不引 1770 |
| 2.2 | `intervention.ts:178`、`:296-303`、`:320-336`；`apply_future_plan` 无实现 | 采用只引 178/320-336，不把 274-281 当采用处 |
| 2.4 | `host.ts:1219-1252` 发布执行者+秘书两份 binding；`:427-431` 没有 `propose_future_plan` | `adviser_creation` 归 7D2（N14/N24） |
| 2.5 | `query-observation.ts:50`/`:164`/`:526`/`:546`、`query-record-codecs.ts:578`、`runtime-configuration.ts:122` | C-1：规划工具 256 KiB、秘书 16 KiB、观察器按 `answerShape`（5.2.7、5.3.5） |
| 2.14 | `consumable-sessions.ts:200` 的 `resumeOfferOf`（W2a 已落地） | 不是待修；按 `:193-224` 写 |
| 12.1/12.2 | `workflow.ts:1502`（`selectNext`）、`intervention.ts:296-303`/`:178-345` | 候选分支和采用移出落这两处 |
| 12.3 | `verification-plan.ts:61`、`plan-validation.ts:46` | 机械诊断新建纯函数，不伪造已采用快照 |
| 12.4/12.5 | `answer-tools.ts:56-71`/`:382-399`/`:560`、`query-observation.ts:50`、`query-record-codecs.ts:578`、`runtime-configuration.ts:122` | 审阅工具和长度落这些文件 |
| 12.10/12.11 | `host.ts:1149-1173`/`:1219-1252`/`:372-441`、`goal-wait-wakes.ts:161-203` | 内建发布和重启重建；不新造视图 |
| 12.13/12.14 | `host.ts` 采用/卡路径、`plan.ts:34-67` | 导出函数和 `estimatedLines` 都加在现有文件 |
### 1.4 事实变化清单
行号移动不放在这里（见 1.2/1.3）；只列内容变了、行号对不上的地方。v3 原文已在 lead 笔记的 `goal-layering-design.md`。

1. **第 2 节第 9 行的“派工门只判版本、审查和等待”内容变宽。** `task-gate.ts:193-644` 除 review/自动返工/确认外，还判 unknown-call review 和 L46 阻塞；L1 的 module overlap 在 `workflow.ts:1564-1620`。规格不把门写成只有三类判断。
2. **第 2 节第 14 行已是 W2a 的现状。** `consumable-sessions.ts:200` 的 `resumeOfferOf` 已在（`bf54754b`），`:193-224` 就是“claimed/prepared 时按 `sourceMessageRef` 提供、不是队头”；不是待修项。
3. **`DESIGN.md:517` 错位。** 设计 6.1 引的 `DESIGN.md:517` 现在是“各记录写入方检查权限”，对应句在 `:520`。
4. **`host.ts:1829`、`runtime-configuration.ts:481` 错位。** 内建发布路径在 `host.ts:1149-1173`（profile builder）和 `:1219-1252`（binding 发布），不在设计引的这两行。
5. **`plan-service.ts:2991` 错位。** 模块存在校验在 `:3003-3014`（`draftHasModuleTask` → `moduleFactOf`），拒绝文案在 `plan-validation.ts:647-648`。
6. **`intervention.ts:75`、`:104` 已移位/语义变了。** `:79` 才是 `addressed = message.taskRef ?? facts.value.latestWork?.task ?? null`；`:104` 是 completed Goal 分支的 `readMessageBody`。“`taskRef` 只作规划上下文、不进领取”落 `:79` 和后续分支。
7. **`slice-7-SPEC.md:42`、`:491` 错位（文档旁证）。** 6A 共用建线入口在 `:48`；`:491` 是空行，`role-lines/open` 的 `RoleLineOpenDutyV1` 在 `:497`。代码侧不受影响。
### 1.5 缺失依据
仍缺的只有目录（工作区没有 `impl/`、`codex2/` 下的对应文件）：
- `impl/lines/7c/frozen/7c1/7c1-<g>-drill-rulings.md`、`frozen/7c2/7c2-f2-drill-rulings.md`（HANDOFF 106/107 引用的开工裁定）。
- `codex2/egrp/GLIinventory.out.md`。
- `impl/sgl/gli-out/gli-inventory.md`。

### 1.6 对 B/C/D 的约束
- **必须用：** B 用 `src/core/work-graph/views/consumable-sessions.ts:81-89`（`offerKindOf`）、`src/business/workflow/intervention.ts:178` 和 `:296-303`、`resources/prompts/platform/templates/skill-platform-work.txt:24-26`、`src/app/host.ts:1219-1252` 与 `:427-431`；C 用 `src/business/workflow/workflow.ts:1929-1940`、`src/business/workflow/task-gate.ts:193`、`src/core/work-graph/evidence/verification-plan.ts:61`、`src/core/work-graph/tasks/plan-validation.ts:46`、`docs/refactor/HANDOFF.md:1722`、`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:247`；D 用 `src/business/workflow/workflow.ts:613`/`:2488-2504`、`src/core/work-graph/state/plan-machine.ts:677-696`、`src/core/work-graph/state/control-intent-machine.ts:185`/`:200`、`src/core/work-graph/tasks/control-service.ts:601`。
- **不能用：** `workflow.ts:1770`、`intervention.ts:274-281`（当自动采用）、`host.ts:424`、`host.ts:1829`、`runtime-configuration.ts:481`、`runtime-configuration.ts:121`、`communication-tools.ts:357`、`tool-group-assembly.ts:562`、`context-fact-text.ts:255/259`、`task-gate.ts:40`（当判定函数）、`slice-7-SPEC.md:42/491`、`DESIGN.md:517`（当自动采用句）、`plan-service.ts:2991`（当模块校验），以及 `7c1-start-rulings-v2.md`、`7c2-start-rulings-v2.md`、`run-iv2.md`、`goal-layering-design.md` 的旧行号（这些文档现在都在 ``，按新副本核）。


---
## 5. 分解：系统轮、触发、阶段 gate、分段输出、任务书
**依据。** 设计 `plan-loop-design.md:117`-`:200`（第 5 节），以及 `:39`-`:60`（第 2 节第 1、3、4、5、12、13 行）、`:203`-`:274`（6.1、6.4、6.5 的被引部分）、`:276`-`:344`（第 7 节，只引不写）、`:346`-`:357`（第 8 节）、`:366`-`:373`（第 10 节）、`:428`-`:451`（第 12 节）、`:491`-`:506`（第 14 节）、`:547`-`:579`（第 16、17 节）、`:582`-`:604`（第 18 节 D2、D3、D4、D7）、`:631`-`:685`（第 21 节）。代码按 合并树 `5a1ec32` 的 `src/`、`tests/`、`resources/`（合并树 `5a1ec32`：有 Q、L1、F2、T，没有 H、L2）。tree 没有 `.git`，行号按文件内容核；设计里的行号移位的，按内容找并注在改动位置一节。

**边界。** 本节写第 5 节。第 6 节的候选诊断、目标循环的完整候选处理和审阅轮由 C 写；第 7 节的偏差判断和回复由 D 写；第 8 节的并发顺序由 D 写。本节遇到这些接口只写“由 C/D 填”的引用，不重定义。第 10 节的阶段线和 2 倍线是 D 的读数，本节只写任务书里的 `estimatedLines` 字段和它怎样被写进计划。

**依据版本。** v3 `goal-layering-design.md` 第 4 节、5.1–5.5、5.8–5.9 和第 9 节已进本切片；v4 `plan-loop-design.md` 第 10 节把阶段线改成“预估行数合计 2,000 行，或累计 0.6B token”，代替 v3 的 1,500 万增长量。v4 与 v3 冲突时按 v4 第 1 页：v3 第 4 节、5.1–5.5、5.8、5.9 仍有效；5.6/5.7 由 v4 第 6/7 节改写。本节按这两份原文写，不再用“四句反推”。

---
### 5.1 目标采用、触发、分段输出（设计 `:119`-`:123`）
#### 5.1.1 计划草稿的形状：骨架 + 第一段
**目标采用时**（人采用第一版，`DESIGN.md:517`、决定 15、35）平台拿到的是一份完整的 `PlanRevisionDraft`（`src/contracts/plan.ts:221`）。（目标 gate 的现有校验只在“有未声明 explicit intent 的必需 work”时要求 `missing_active_required_goal_gate`；本设计的计划通常显式声明 intent，所以目标 gate 由参谋写、不是平台强制，`plan-validation.ts:101`-`:104` 的现有分支不动。）其中：

| 部分 | 内容 | 谁写 |
|---|---|---|
| 阶段骨架 | `stages: PlanStage[]`，每段有 `stageId`、`title`、可选 `description`（`src/contracts/plan.ts:148`-`:152`） | 模型 |
| 第一段 | 第一段的 `tasks`（`request_execution`）、`assignments`、覆盖它们的 `obligations`/`verificationRequirements`、它们之间的 `executionDag`/`taskHierarchy`/`taskRelations`/`inputRequirements` | 模型 |
| 后续段占位 | 每个后续段至少一条**必需、活动、`executionIntent: 'plan_only'` 的 work 任务**（下称“段占位”），它可以只有标题、`stageId`/`scope`、意图、`sizeClass`；按 `RuntimeTask` 的既有规则可以没有 assignment/验收/依赖 | 模型 |
| 阶段 gate | **每段一条** `taskKind: 'gate'`、`scope: { kind: 'stage', stageId }` 的任务；它的验收义务就是这一段的验收。骨架的每个阶段都有它（设计 `:121`）；平台沿用现有校验、不新增入图 gate，缺了由审阅者指出，见 5.1.3 | 模型 |
| 目标 gate | 有未声明 explicit intent 的必需 work 时，现有校验要求至少一条必需、活动、`scope: { kind: 'goal' }` 的 gate（`missing_active_required_goal_gate`，`src/core/work-graph/tasks/plan-validation.ts:101`-`:104`）；本设计的计划通常显式声明 intent，所以目标 gate 由参谋写、不是平台强制 | 模型 |

**段占位的规则是“规格新定”的（N5）。** 依据：设计 `:121` 的“骨架 + 第一段”、`:1921`-`:1922` 的“required plan_only future node”、第 2 节第 1 行的“未细化的必需任务”。没有段占位，`required` 集合里就没有“未细化”的事实，`:1932` 的 gap 不会出现，后续段永远不会被触发。占位任务不新造任务种类、状态或记录：它就是现有 `RuntimeTask` + `executionIntent: 'plan_only'`（`src/contracts/plan.ts:46`-`:56`）。后续段也可以有目标级（不带 `stageId`）的 `plan_only` 占位；那时 `refine:` 的请求号用占位任务的 `taskId`（见 5.1.4、5.2.2）。

**占位任务带档位。** 每个段占位带 `sizeClass: 'small' | 'medium' | 'large' | 'explore'`（v3 §4.3），表示这一段的预估大小；它是 `RuntimeTask` 的可选字段，随任务定义冻结（5.1.1 末段），不是新记录。没有档位的占位只累计、不提醒。

**已执行任务的定义冻结。** 已有 Run、TaskLease 或正式任务归约的任务，`RuntimeTask` 的字段（含 `title`、`phase`、`scope`、`executionIntent`、`assignment`、输入、以及 `taskIds` 列它的义务语义）不能改；只能改 `disposition`/`replacedByTaskId`，要用替代任务（`plan-machine.ts:1345` 一带的 future 分支、`plan-validation.ts:501` 的 `unsupported_execution_change`、`plan-machine.ts:599`-`:611` 的 trace 规则）。本节的分段合并和导出都不碰这些任务；被碰时由现有校验拒绝，不新造检查。

**`estimatedLines` 随任务定义冻结。** 它是 `RuntimeTask` 的字段（5.3.2），所以自动进入 `FrozenTaskDefinition`（`src/core/work-graph/tasks/plan-task-basis.ts:62`-`:67` 的 `task` 整对象）。已执行任务的预估行数不能改；要改就是替代任务。这是加字段的直接后果，不是新规则。
#### 5.1.2 模型只输出这一段，平台合并成完整草稿
**谁合并、在哪合并。** 每次 `intervention_planning` 的规划答案（refine / planfix / planresume；deviation 的“改计划”也是同一种答案）先走现有 `parseInitialPlanningResponseV2` + `normalizeInitialPlanningResponseV2`（`src/core/work-graph/tasks/initial-plan.ts`、`src/contracts/initial-planning-parse.ts`），得到一份带新 `planId`、`goalId`、`origin` 的 `PlanRevisionDraft`；`planRevision` 由调用方改成这次来源正式计划的 `planRevision + 1`（normalize 自己给 1；`planOnIdleLine` 的 `targetPlanRevision` 也是这么覆盖的，`intervention.ts:294`-`:299` 一带）。这份 draft 的 `stages`/`tasks` 可以只覆盖这一段。**合并前先剥掉 normalize 在这一轮新生成的 `origin`**（`const { origin: _segmentOrigin, ...segmentWithoutOrigin } = normalized.draft;`），再调用**一个纯函数** `mergeStageRefinement(base, segmentWithoutOrigin)` 并到 base 上，得到完整草稿，最后 `plans.proposePlan`。base 接的是**两种计划共有的结构**：refine/deviation 用目标当前已采用的 `PlanRevisionSnapshot`（`plans.queryGoal` + `plans.queryTaskGraph` 读到的 plan）；planfix 用被审的那一版候选的 `draft`（`PlanRevisionDraft`，与 snapshot 共有合并所需的字段，不是声明的 snapshot）；**planresume 按 6.3.1 的来源链取 `fixBase`**：原 Query 是返修轮时用它（那一版待修候选的 `draft`），没有 `fixBase` 才用活动计划 snapshot。写候选时 `basedOn` 按 base 分开取，不从 base 上读同名成员：base 是活动计划 `PlanRevisionSnapshot` 时取它的 `ref`（`PlanRevisionSnapshot.ref`，`PlanRevisionRef`）；base 是返修或返修续轮的父候选时取父候选的 `basedOn`（`PlanProposal.basedOn`，`PlanRevisionRef | null`）。snapshot 和 draft 两种类型都没有 `basedOn` 字段，不能照写；也不用目标指针另算。结果**保留 base 的 `reviewAdmissionProtocol`**；`origin` 只在 base 是已采用 snapshot 时沿用 base 的，base 是候选 draft 时不带 `origin`（候选自己的来源不是这条计划版本的采用来源）；`segment` 的 `origin` 永远不进结果。`planId`/`planRevision` 取 segment 的新值（`planId` 必须不同于来源，`plan-machine.ts:1342`）。未来采用由现有 `plan-commit-compiler.ts:393` 在 source 有 `origin` 时回写 `source.origin`，合并器不重建来源证明。采用仍是目标循环的唯一入口（设计 `:67`），本节不写采用。

**签名（新建，建议路径 `src/core/work-graph/tasks/stage-segment.ts`）：**
```ts
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { CoreRejection } from '../../../contracts/core/results.js';

/**
 * 把“这一段”的 draft 并进 base，得到完整草稿。
 * - base 接 PlanRevisionSnapshot 或 PlanRevisionDraft（两者共有的结构）；调用方已剥掉 segment 的 origin。
 * - 结果保留 base 的 reviewAdmissionProtocol；origin 只在 base 是已采用 snapshot 时沿用，base 是候选 draft 时不带。
 * - 调用方已剥掉 segment 的 origin；planId/planRevision 取 segment 的新值；未来采用由 compiler 回写 source.origin。
 * - 段集合 = segment.stages 的 stageId ∪ segment.tasks 的 stageId/scope.stageId。
 *   segment 一个段也不命名、也没有任务 → `invalid`。
 * - stages：按 stageId 替换 base 的同名段；新段按 segment 顺序追加；其余 base 段保持原顺序。
 * - tasks：按 taskId 替换 base 的同名任务；新任务按 segment 顺序追加；base 的其他任务
 *   原样保留。**不删任务**（计划协议要求保留 taskId，用 disposition 表达删除；
 *   `plan-task-basis.ts:58`-`:60` 的注释）。
 * - assignments：按 taskId 替换/追加，其余保留。
 * - obligations：按 obligationId 替换/追加，其余保留。段内任务的义务必须由 segment
 *   提供；漏了由现有 `dangling_task_ref`/`task_removed` 校验拒绝，合并器不补。
 * - taskHierarchy.parentOf：base 中 childTaskId 属于 segment 任务的边去掉，其余保留；
 *   追加 segment 的边。
 * - executionDag.dependsOn：base 中 taskId 属于 segment 任务的边去掉，其余保留；
 *   追加 segment 的边。
 * - taskRelations / inputRequirements：按 fromTaskId / consumerTaskId 同规则。
 * - 不合成、不改写任何 instruction；不变量、不重排（顺序按 base 后 segment）。
 */
export function mergeStageRefinement(base: PlanRevisionSnapshot | PlanRevisionDraft,
  segment: Omit<PlanRevisionDraft, 'origin'>):
  { status: 'merged'; draft: PlanRevisionDraft } | CoreRejection;
```

**拒绝。** `segment.stages` 与 `segment.tasks` 都为空 → `rejected('invalid', 'the segment names no stage and no task')`（`src/contracts/core/rejections.ts`）。其余不合法的合并结果交给现有的 plan codec、`validatePlanDraft`（`plan-validation.ts:46`）、`plan-machine` 的 future 分支拒绝；合并器不重述这些规则。

**合并规则（v3 §5.5，优先于按 taskId 的一般替换）：**

| 情况 | 做法 |
|---|---|
| 一个占位细化成一个任务 | 沿用原占位 `taskId`，把 `executionIntent` 改成 `request_execution`，补全 assignment/验收/依赖 |
| 一个占位细化成多个任务 | 原占位设为 `superseded`，新增实际任务；原任务不物理删除，用 `disposition`/`replacedByTaskId` 表达 |
| 已有 gate 和义务 | 保持原语义，不改定义；段内任务的新义务由 segment 提供，漏了由现有 `dangling_task_ref`/`task_removed` 拒绝 |
| 其他任务/段 | 按 taskId 替换/追加，其余 base 任务原样保留；`instruction` 不合成、不改写 |

**合法性全部由现有校验判。** 合并函数只做合并：段集合、任务、assignment、义务、依赖边按上述规则并进 base；结果交给 `validatePlanDraft`、plan codec、`plan-machine` 的 future 分支。合并器不重述、不新增校验，也不因为“没有 gate”拒绝。

**为什么不是“整份替换”。** 设计 `:121` 的“模型只输出这一段”和 `:609` 的“一版约 1.8 MB、每次修订存一版”要求答案小、平台补齐；整份替换会让模型每次都重写全部任务，且会把别的段的 `plan_only` 占位误删。

**为什么仍按 taskId 定位。** 段占位是现有 `plan_only` 任务；模型可以复用它的 taskId 改成 `request_execution`，也可以新增任务并把它标 `superseded`。这和计划协议的“任务不物理删除”一致；合并函数名用 v3 的 `mergeStageRefinement`；第一稿的旧名是 `mergeStageDraft`，只在名字对照时保留这一处，正文不再用旧名。

#### 5.1.3 阶段 gate 按阶段验收
**形状（沿用现有 gate，不改）。** 阶段 gate 就是现有 gate 任务：`taskKind: 'gate'` + `scope: { kind: 'stage', stageId }`。它的验收由现有 gate 归约产生，不新增状态、记录或校验：
- `gateCoveredTaskIds(tasks, gate)`（`src/core/work-graph/state/decision-policy.ts:153`）是唯一的覆盖算法：
  - `gate.taskKind !== 'gate'` → `[]`；
  - `scope.kind === 'goal'` → 全部 `work` 任务；
  - `scope.kind === 'stage'` → `task.taskKind === 'work' && task.scope.kind !== 'goal' && task.scope.stageId === scope.stageId`；
  - `scope.kind === 'module'` → 同一 `stageId` 且 `scope.kind === 'module'` 且 `moduleRef` 相等的 `work` 任务。

  所以阶段 gate 覆盖的 work = 这一段的阶段级任务 + 这一段的模块级任务；它不覆盖目标级 work，不覆盖别的阶段，也不覆盖任何 gate（包括它自己）。
- 读模型 `plan-service.ts:2485`-`:2489` 的 `gateCoverage` 直接委托给这个函数（`coveredTaskIds` 在 `:2104` 写进任务行），所以读模型显示的覆盖与 Workflow 的调度不会分成两套规则；阶段 gate 的结论仍来自正式检查：`advanceGate`（`workflow.ts:1156`）走 `open_checks` → 现有 `run_check` → `finalize_checks` 的归约；`plan-validation.ts` 只要求“新 gate 必须至少承载一条新增的验收义务”（`:571`-`:582`）以及全计划至少一个目标 gate（`:89`-`:99`），不把“每段都有 gate”做成入图校验，也不参与调度。**规划规则仍要求骨架的每个阶段有一条阶段 gate 及其义务**（设计 `:121`）；平台沿用现有校验、不新增入图 gate，缺 gate 由审阅者按 6.3 指出、参谋补，不由平台静默取消这一段的验收。阶段 gate 的义务仍按现有规则挂在它承载的义务上；覆盖只按 `scope` 算，不按义务的 `taskIds` 算。两者不一致时以 `scope` 为准，这是现有 `gateCoveredTaskIds` 的语义。

**调度（B-D4 已定，按这里施工）。** 今天 Workflow 只在全部必需 work 都满足后才推进任何 gate（`workflow.ts:1931`-`:1948`）：后续段的必需 `plan_only` 占位是 `unfinishedWork` 的一员，所以第一段的 gate 要等所有段都细化并完成才跑。这会把“按阶段验收”退化成“按目标验收”。改法只有一处选择条件，不加新机制、不加新校验：

1. 把 `unfinishedWork` 的计算（`:1931` 的 `required.filter(...)`）留在原位；
2. 在 `if (unfinishedWork.length > 0)`（`:1932`）**之前**插入阶段 gate 的选择；
3. 原来 `:1946` 的 `gateTask` 只选 `scope.kind === 'goal'` 的 gate（目标 gate），仍在 `unfinishedWork.length === 0` 之后；模块 gate 和阶段 gate 用同一条件，跟下面的选择走（G-D3）；
4. `required.every(...)` 的目标完成检查不变，仍检查全部必需任务（含阶段 gate）和目标 gate。

选择条件写成：
```ts
// :1931 附近，unfinishedWork 之后、if (unfinishedWork.length > 0) 之前。
const coveredGate = required.find((task) => task.taskKind === 'gate'
  && task.scope.kind !== 'goal'
  && task.disposition === 'active'
  && unsatisfied(task)
  && !gateCoveredTaskIds(graph.plan.tasks, task)
    .some((taskId) => unfinishedWork.some((work) => work.taskId === taskId))
  && !(base.taskId === null && base.activeTaskIds?.has(task.taskId) === true));
if (coveredGate !== undefined) {
  return await advanceGate(owned, base, roundWaitBasis, graph, coveredGate);
}
```

`unsatisfied` 用现有的 `graph.tasks` 行（`:1926`-`:1929`）：行不存在或 `effectivePhase !== 'satisfied'` 都是未满足。`workflow.ts` 现在没有 import `gateCoveredTaskIds`，从 `../..` 的 `core/work-graph/state/decision-policy.js` 加这个具名 import；它是纯函数，不新增依赖、不新增记录。

**为什么是“和 `unfinishedWork` 取交集”，不是 `gateFixInProgress`。** `gateFixInProgress`（`decision-policy.ts:172`-`:181`）是 GV-5 读模型判“gate 还在进行”的规则，它只数 `required && active` 的覆盖任务；Workflow 的选择要按 v3 5.2 的“这个阶段的**必需**普通任务全部满足”，所以直接和 `unfinishedWork`（`required && carriesWork && taskKind === 'work' && 未满足`）取交集。两者的差别只有“必需的 deferred 覆盖任务”：`gateFixInProgress` 不挡，`unfinishedWork` 挡。阶段验收按后者，和现有 gap 的 `required_task_deferred:` 语义一致；读模型的 GV-5 文案不改。

**什么时候选。** 同时满足：
- 它是 `required` 的 gate（`required` 已排除 `cancelled`/`superseded`）；它自己是 `active`（deferred 的 stage gate 不推进，留给目标级等待）；它自己还没有 `satisfied`；它覆盖的必需 work 没有一条在 `unfinishedWork` 里（覆盖集里的 optional、cancelled、superseded 不挡）；这一趟没有正在推进它的活 Run（`base.activeTaskIds` 不含它）；这一趟不是显式选任务（`base.taskId === null`；显式选任务在 `:1903` 已经返回，不会走到这里）。

**什么时候不选。** 上面任一条件不满足就不选，继续走原来的分支：
- 覆盖的必需 work 还有未完成 → 落回 `unfinishedWork.length > 0` 的 gap/等待（后续段占位、在跑的任务、被挡的任务都按现有原因写）；gate 自己 deferred/optional/cancelled/superseded/已满足 → 不选；gate 正被活 Run 推进 → 不选，这一趟落回普通等待；那条 Run 的下一次 `advanceGate` 会接着读链头；没有 `scope.kind === 'stage'` 的 gate → 不选，第一段就没有阶段 gate，按目标 gate 的旧规则走。

**目标 gate 仍只在全部必需 work 满足后选。** `unfinishedWork.length === 0` 之后，`:1946` 只找 `scope.kind === 'goal'` 的未满足 gate，按计划顺序取第一条。`required.every((task) => !unsatisfied(task))` 才提出目标完成；它数的是全部 `required` 任务（包括 stage gate、目标 gate、模块 gate），不是只看 work。`base.activeTaskIds` 的跳过规则原样保留。

**`advanceGate` 的 producer 要按覆盖过滤。** `advanceGate` 现在取“全目标第一条已满足且有 Run 的 work”作为 `subjectRunRef`（`workflow.ts:1177`-`:1180`）。目标 gate 这样没问题；阶段 gate 会拿错段落的 Run 当锚，第二段以后的 gate 尤其明显。同一处加一个条件，不新增函数、不新增记录：
```ts
const covered = gateCoveredTaskIds(graph.plan.tasks, gateTask);
const producer = graph.tasks.find((row) => row.definition.taskKind === 'work'
  && row.effectivePhase === 'satisfied' && row.execution !== null
  && (gateTask.scope.kind === 'goal' || covered.includes(row.ref.taskId)));
```

目标 gate 的 `covered` 是全部 work，行为和今天完全一样；阶段/模块 gate 只拿自己覆盖的已满足 work 当 producer。找不到 producer 时仍是现有的 `waiting`：`the goal gate <id> has no ended ordinary producer Run yet`，不新造原因。

**出口（全部是现有 `advanceGate` 的出口，不加分支）。**

1. gate 行有失败事实且 `verdict.kind === 'reverify'`、`needsFinalize` 为假、`deps.evidence.reverifyRound` 在：`reverifyRoundStep` 的 `perform`。
2. gate 行有失败事实且 `verdict.kind === 'stopped'`、`headFinalizedNonPass(row)`：`waiting`，原因是 `<verdict.reason>: the goal gate <id> is not re-verified automatically; <gateStopAdvice>`。任务已停，平台不自动解除。
3. `readChainHead` 读失败或读回来是等待：原样 `waiting`；已有 round 由 `continueRoundChain` 续（`run_check`/`finalize_checks`）。
4. 没有已结束的普通 producer Run：`waiting`（上一条的文字）。
5. 其余：`open_checks` 的 `perform`，`subjectRunRef` 是上面的 producer，`subject` 是 gate 自己，`planRef` 是当前正式计划，`gateSubject` 是 `gateTask.scope.kind`（阶段 gate 就是 `'stage'`）。

`open_checks` 之后的检查运行、通过、失败、返修都走现有的任务门/证据归约；检查失败会把 gate 行变成失败事实，下一次 `advanceGate` 落到第 1/2 条。没有任何新的结果码：写入被拒是现有 `CoreRejection`（`src/contracts/core/rejections.ts`）原样向上返回；等待是现有 `waiting`；检查失败是现有任务失败事实。

**走法。**
- **冷启动，目标已采用“骨架 + 第一段”。** 计划 = 骨架 + 第一段的任务/指派/义务/依赖 + 后续段每段一个必需 `plan_only` 占位。第一段的任务执行、检查、返工，Run 结束并归约后，`unfinishedWork` 里只剩后续段的占位。旧代码在这里返回 gap，第一段的 gate 永远排不上；新代码先在 `:1932` 之前看到第一段的 stage gate：它 required、active、未满足，覆盖集只含第一段的 work，和 `unfinishedWork` 没有交集，于是 `advanceGate` 开第一段的正式检查。**第一段的 gate 因此可以在第二段还没细化时先过。**
- **第二段只有 `plan_only` 占位（还没细化）。** 占位是 `required && work && unsatisfied`，在 `unfinishedWork` 里，但它属于第二段，不在第一段 gate 的覆盖集里；所以它不挡第一段 gate，却仍然是 gap 的原因（`reasons` 里有 `plan_only:<stageId>`），第一段 gate 过后目标照常发 `refine:`（5.1.4）。gate 通过和细化请求是两件事，顺序是 gate 先、细化后；细化不会因为 gate 还没过而被拖住，gate 也不会因为占位而等整份计划。
- **第二段已经细化，Run 正在跑。** 第二段的 Run 和第一段的 gate 检查可以并行：Workflow 一趟只返回一个可推进步骤，下一趟回来时两边的既有步骤都还在；`advanceGate` 只读第一段覆盖的 work 和 gate 自己的链，不读第二段 Run 的状态。第一段 gate 不因为第二段在跑而等，第二段 Run 也不因为 gate 检查而被取消或重开。若第二段的任务声明了 `gate-result` 依赖，它自己在输入解析处等 gate 的检查输出（见下一条），不是 Workflow 替它等。
- **gate 过后的出口：下游 `gate-result` 依赖。** 下游任务在 `executionDag.dependsOn` 里写 `{ taskId, dependsOnId: <gateTaskId>, requires: { kind: 'gate-result', label: <checkId> } }`。`resolveGate`（`src/core/work-graph/tasks/context-input-service.ts:530`）读 gate 的 round 链，`requires.label` 必须精确等于被选中的 checkId（`state/context-input.ts:170`-`:174`）。gate 还没通过时，round 链为空或没有 final 的检查结果，下游的输入选择是 `missingSelection(..., 'no_applicable_round')`，任务不满足派工条件；gate 通过后，同一个解析拿到检查输出，任务按现有 `prepare`/`start` 开跑。这里不加新的依赖闭包，也不把“gate 已满足”写成领取条件；依赖仍然是真实的版本化输入依赖。
- **没有下游依赖。** gate 通过只表示这一段的验收完成；目标继续按现有顺序走：还有后续段占位就发 `refine:`（5.1.4），没有可推进工作就按现有 gap/等待登记，全部必需任务和目标 gate 都满足才提目标完成。别的阶段没有声明 `gate-result` 依赖的任务不被 gate 挡（这是现有规则，也是 §22 的 D-V1 的边界；不在本节加闭包）。
- **重启后重算。** 选择不持久化：重启后 `selectNext` 用同一份正式计划、同一批任务行和新的 `base.activeTaskIds` 重算，结果和重启前同一版一致。`advanceGate` 先 `readChainHead`：已经开了 round 就续（`run_check`/`finalize_checks`）或等，不会因为重启再开一个 round；没有 round 才 `open_checks`。`open_checks` 的写身份仍由现有 `graphWrite`/`requestIdFor` 生成，重放按现有回执规则处理；这里不为 gate 选择加任何“已选过”的记录。
- **绑定晚于启动。** 阶段 gate 的选择只读计划、任务行、Run 和 gate 自己的链，不读 Session、职责或 Query profile；所以目标启动时没有参谋/审阅线也照常过 gate。绑定晚到只影响 `refine:` 的收件人解析（5.5.3：每次发送时 `resolveDutyRecipient`，没有就 `no_recipient`，不发给秘书），不影响已经能推进的 gate。
- **失败/拒绝。** 检查失败 → gate 行的失败事实，下一次 `advanceGate` 走第 1/2 条（reverify 或 stopped+建议），任务/Run 的停因仍是现有的；`open_checks`/`run_check`/`finalize_checks` 的写入被拒 → 现有 `CoreRejection` 原样返回给驱动，下一趟重读重试（现有 Workflow 推进语义，不是新的重试机制）；等待 → 现有 `waiting`；没有 producer → 现有等待文字。没有新的错误码，也没有新的“gate 卡住”状态。

**不做的。**
- 不为阶段 gate 新增持久状态、调度记录、优先级队列或“已选/已开”标记；不因为某段没有 stage gate 拒绝计划，也不为它补 gate；不把目标 gate 前移，不让它和阶段 gate 一起在 `unfinishedWork` 之前选；不新增依赖闭包，不改 `resolveGate` 的匹配规则；不把 module gate 前移。裁定只写阶段 gate；模块 gate 仍在 `unfinishedWork.length === 0` 之后选。若某段用模块 gate 做更细的验收，后续段的必需占位仍会挡住它，这是本节的残留，列在 §22 的 G-D3（未决）：按同一条件扩到 `scope.kind === 'module'` 即可，同样不是新机制。
#### 5.1.4 什么时候发细化（触发）
**条件（v3 §5.4）：** Workflow 这一轮走到等待结果，**没有可推进的步骤**，且存在**活动的、必需的、`plan_only` 的普通任务**。
- **延期不算。** `disposition: 'deferred'` 的占位不触发，保持不推进；**自动返工和重新检查先走。** 它们本身是可推进步骤，现有选择会先返回它们，不会被细化抢走；**有任务在跑也可能触发。** 上一段最后几个任务在跑时提前细化下一段，和“每一波施工时演练下一波”是同一个做法；不额外加“没有在跑的 Run”条件；**已有更具体出口的等待不被抢。** `wait_reply`、检查、卡等已有明确下一步的等待仍走原出口；细化只加在目标级等待结果的共同收口。

**实现：不新增等待分支。** 在目标级等待结果的共同收口附加 `refinement`：
```
result = collected ?? gap;
return attachRefinement(result);
```
- 这样覆盖 L46 的卡/等待、收集等待和普通缺口；等待原因和唤醒依据照旧合并，不丢其中一支；`reasons`/`recordKinds` 仍由 `goalWaitBasisOf`（`src/business/workflow/task-gate.ts:176`）组。加两项现有开放字段：`reasons` 追加 `plan_only:<stageId>`（段占位）或 `plan_only_task:<taskId>`（目标级占位）；`recordKinds` 追加 `'SessionMessage'`（`PlanProposal` 已在现有列表，`workflow.ts:1938`-`:1940`）。

**动作，顺序不能换（v3 §5.4）：**

1. 驱动用**读前游标**登记等待，再让现有 Goal 等待队列 **drain 一次**，处理登记前已发生的提交。
2. 找这个目标的参谋：7D2 之前用 `resolveDutyRecipient`，7D2 之后换成 L35。
3. 用 `systemActionRequest` 发一条带 `goalRef` 的 `action_request`，文字写明要细化的阶段或任务；请求号固定为 `refine:<goalId>:<stageId|taskId>:<planRevision>`（有 `stageId` 用段号；目标级占位用 `taskId`）。
4. 同一版计划只发一次；细化后还有占位任务时，新版本会再发。没有参谋时按 M-4 用 `goal_cause` 卡（code `no_adviser`）给人，**不发秘书**（不是 `adviser_creation`）；等待依据加 `Session`，建线后能重新触发。
5. 重启中断还没被人解除时，`handleIntervention` 已经会拒绝，消息留在队列里（决定 97-9），不另写。
6. 不做超时重发。参谋没动静时，目标显示“等参谋细化”，人可以直接干预。

**多个段。** `ordered` 是计划顺序（`orderTasks`，`workflow.ts:551`）；第一条段占位就是“下一段”。同一版里只发一条；下一段要等这次登记被叫醒（见 5.2.2 的“同一版一次”）。


**类型（新建在 `src/business/workflow/` 或 `src/app/` 的纯函数模块；建议 `src/business/workflow/plan-round.ts`）：**
```ts
import type { GoalWaitBasisV1 } from './contracts.js';
import type { GoalSnapshot } from '../../contracts/ledger.js';

/** 共同收口里第一条“required + active + work + plan_only”任务；undefined = 这次等待没有 plan_only 标记。 */
export type PlanOnlyTargetV1 = { stageId: string | null; taskId: string | null };
export function planOnlyTargetOf(basis: GoalWaitBasisV1 | undefined): PlanOnlyTargetV1 | undefined {
  const task = basis?.reasons.find(reason => reason.startsWith('plan_only_task:'));
  if (task !== undefined) {
    const taskId = task.slice('plan_only_task:'.length);
    return taskId.length === 0 ? undefined : { stageId: null, taskId };
  }
  const token = basis?.reasons.find(reason => reason === 'plan_only:' || reason.startsWith('plan_only:'));
  if (token === undefined) return undefined;
  const stageId = token.slice('plan_only:'.length);
  return stageId.length === 0 ? undefined : { stageId, taskId: null };
}
```

`planOnlyTargetOf` 只读 `reasons`：`plan_only:<stageId>` 给段占位，`plan_only_task:<taskId>` 给目标级占位；没有这两种标记就是 `undefined`（不是“没有段”）。它的调用者 `refinementRoundOf`（签名在 5.2.2）在 `target === undefined` 或计划版本为 null 时返回 null；否则返回 `{kind:'refine', goalRef, planRevision, stageId: target.stageId, taskId: target.taskId}`。请求号有 `stageId` 用段号，否则用 `taskId`。

---
### 5.2 系统轮（设计 `:125`-`:145`）
**定义。** 系统轮是平台（Host 系统身份）发出的 `action_request`：收件方是一条已有的规划/审阅线；这一轮只读，用现有 `intervention_planning` Query 链路跑；请求号决定这一轮做什么、同一版只发一次；消息一定结束；有候选就结束在“候选已写入”，不等采用。审阅轮和规划轮的答案都按 FA 的做法走提交工具：模型填表，工具从冻结的 manifest/QueryRun 上下文填固定成员、生成现有协议文本；接受后屏障在工具结果提交处结束 Turn；模型只写文字时仍按 FA 的 `formalAnswerOf` 读最后的文本。设计 `:127` 的“v3 的细化请求改成通用的系统轮”就是这条。
#### 5.2.1 总表

| 前缀 | 谁发 | 收件线 | 这一轮做什么 | 请求号 | 答案形状 / 提交工具 | 同一版只发一次 | 结束 |
|---|---|---|---|---|---|---|---|
| `refine:` | 目标循环（C 的 Host 系统身份；本节给构造函数） | 目标参谋：7D2 前 `resolveDutyRecipient({ workspace, duty: 'adviser' })`，7D2 后 L35（`slice-7-SPEC.md:307`-`:310`） | 写下一段的任务书；模型只输出这一段，平台用 `mergeStageRefinement` 合并（5.1.2/5.5） | `refine:<goalId>:<stageId|taskId>:<planRevision>`：有段用 `stageId`，目标级占位用那条 `plan_only` 占位任务的 `taskId` | `plan_round` / `submit_plan_round`；plan 正文 256 KiB | 请求号含计划版本和段/任务；同一版同一段/任务一条 | 候选已写入即结束（关联答案）；不等采用 |
| `deviation:` | 平台偏差发现处（D 的 7.1；Host 或 Workflow 的 Run 结束处） | 同上（参谋） | 判断偏差（D 的 7.3；`kind` 是 `growth \| lines \| budget \| stop`；本节只给前缀和收件） | `deviation:<goalId>:<taskId>:<kind>:<planRevision>`（设计 `:291` 原样；D 的 `deviationRequestId` 也用它，不另造格式） | `plan_round` / `submit_plan_round`；plan 正文 256 KiB | 同上；同一任务同一版已有 `stop`/`budget` 时，软线 `growth`/`lines` 不再发轮 | 有候选结束在候选已写入；没有候选时这一轮结束并关联答案（D 判断写进“请知悉”） |
| `planreview:` | 目标循环（C） | 审阅线：duty `reviewer`（`src/contracts/platform-duty.ts:6`）；没有审阅线转候选卡，不跳过（设计 `:251`） | 审候选（C 的 6.3）；带机械诊断（C 的 6.2） | `planreview:<proposalId>:<proposalRevision>`（设计 `:222`） | `plan_review` / `submit_plan_review`；答案 16 KiB | 候选号 + 候选版本；同一版候选一条 | 结论保存即结束；结论只对这一版有效 |
| `planfix:` | 目标循环（C） | 参谋（duty `adviser`） | 按审阅意见改候选（C 的 6.1） | `planfix:<proposalId>:<proposalRevision>`（设计 `:326` 的写法） | `plan_round` / `submit_plan_round`；plan 正文 256 KiB | 候选号 + 候选版本；返修上限 3 由 C 数，不进请求号 | 新候选已写入即结束 |
| `planresume:` | 目标循环（C；本节给请求号和 Query 形状） | 原规划线：原消息 M 的收件线（参谋或秘书；正文的 `originalQueryRef` 是原规划 Query 的源消息，见 5.2.2/5.2.3） | 人答完问题卡后接着规划（设计 `:143`-`:145`）；正文只带请求头和原 Query 引用，原问题与逐卡答复在准备输入时装配；开新 Query | `planresume:<goalId>:<queryJobId>`（Query 号是原规划轮的 `QueryJob` 号，不是本轮新 Query；见 N10） | `plan_round` / `submit_plan_round`；plan 正文 256 KiB；Host 系统轮消息和 Query `question` 64 KiB（回复 16 KiB） | 同一轮 Query 一条；这一轮的卡都答完才发（设计 `:612`） | 候选已写入时只关联 R；最终回答、提案被拒或采用成功后才关联 M（M 只有一个回复槽，见 N9/C-25） |
| `overlap-note:`（既有，不是系统轮） | N 门（`src/core/work-graph/tasks/overlap-gates.ts:241`） | 目标参谋；没有参谋时秘书（`:222`-`:233`） | 写模块接口约定；它走同一条消费路径（设计 `:137`） | `overlap-note:<canonical gateRef>:<basisDigest>`（既有） | `text`（不挂提交工具）；注记写完后交最后的文本 | 现有 N 门的 gate + basis | 规划 Query 结束即结束 |

**关于 N 的约定请求。** 它不是本节新造的系统轮；前缀 `overlap-note` 是 `overlap-gates.ts:148` 的既有常量。它由 Host 自动上下文发出（`automationContext`，发送身份不是 `SYSTEM_ROUND_ACTOR`）、收件是参谋或秘书，和系统轮共用 `handleIntervention` 的规划分支（5.2.4）。它没有 `plan_only` 触发，也不改请求号格式；它不挂提交工具（答案形状 `text`），但按 5.2.8 的“可信规划来源 + duty”进 planning 注记准入，见 5.2.7 的发送身份判据和 5.2.8 的注记准入。

**目标参谋缺失时（`refine:`/`deviation:`/`planfix:`/`planresume:`）。** 不发系统轮，也不转给秘书；目标循环用现有 `goal_cause` 卡源（code `no_adviser`，affected = [Goal pin]）给人，专用 `adviser_creation` 卡归 7D2（M-4，103-1）。`overlap-note:` 行里的“没有参谋时秘书”是 N 门既有路径，不属于这套系统轮，本段不改。没有收件人不是错误，目标保持等待；绑定晚于启动时下一趟按新线重试。
#### 5.2.2 请求号：每段是什么、从哪取
**类型和请求号（`src/contracts/plan-round.ts`；发送/细化函数在 `src/business/workflow/plan-round.ts`）：**
```ts
import type { GoalRef } from '../../contracts/ledger.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { CoreRejection } from '../../contracts/core/results.js';

export type SystemRoundKind = 'refine' | 'deviation' | 'planreview' | 'planfix' | 'planresume';

/** `refine:` 的目标：有段用段号；目标级占位用那条占位任务的 taskId。 */
export type RefinementTargetV1 =
  | { kind: 'stage'; stageId: string }
  | { kind: 'task'; taskId: string };

/** `deviation:` 的四种偏差；软线两条（growth/lines）与硬停因两条（budget/stop）分开。 */
export type DeviationRoundKind = 'growth' | 'lines' | 'budget' | 'stop';

export type SystemRoundV1 =
  | { kind: 'refine'; goalRef: GoalRef; target: RefinementTargetV1; planRevision: number }
  | { kind: 'deviation'; goalRef: GoalRef; taskId: string; cause: DeviationRoundKind; planRevision: number }
  | { kind: 'planreview'; goalRef: GoalRef; proposalId: string; proposalRevision: number }
  | { kind: 'planfix'; goalRef: GoalRef; proposalId: string; proposalRevision: number }
  | { kind: 'planresume'; goalRef: GoalRef; queryJobId: string; originalMessageRef: SessionMessageRef };

/** 成功给一个非空请求号；缺 id、空串、非正整数版本 → invalid。 */
export function systemRoundRequestId(round: SystemRoundV1): { status: 'ready'; value: string } | CoreRejection;

/** gap 等待 → 一条 refine；没有 plan_only 标记、没有活动计划版本或没有目标 → null。纯函数。 */
export function refinementRoundOf(input: {
  basis: GoalWaitBasisV1 | undefined;
  goalRef: GoalRef;
  planRevision: number | null;
  /** 段来自 planOnlyStageOf；目标级占位来自计划里那条必需 plan_only 任务的 taskId。 */
  target: RefinementTargetV1 | null;
}): SystemRoundV1 | null;
```

**放置。** `SystemRoundKind`/`RefinementTargetV1`/`DeviationRoundKind`/`SystemRoundV1`/`SystemRoundHeadV1`、`systemRoundRequestId` 和 5.2.6 的读取纯函数放 `src/contracts/plan-round.ts`（contracts 只依赖 contracts，AgentRuntime/Host 也能 import）；`refinementRoundOf`、`systemRoundSendInput`、`planningAnswerShapeOf`、`sendSystemRound` 放 `src/business/workflow/plan-round.ts` / `src/app/system-round.ts`。`SystemRoundHeadV1` 也用这里的 `DeviationRoundKind`，不另写一个字符串联合。

**每段：**

| 前缀 | 段 | 从哪取 | 校验 |
|---|---|---|---|
| `refine:` | `goalId` | `goal.ref.goalId`（`GoalSnapshot`） | 非空 |
| | `planRevision` | 目标活动计划的 `PlanRevisionSnapshot.planRevision`（`Goal.activePlanRevision` 是 `PlanRevisionRef`，只带 `planId`；版本号从计划读或 C 的候选读给；没有活动计划就不发） | 正整数安全整数 |
| | `target` | `planOnlyStageOf(waitBasis)` 的段 → `{kind:'stage',stageId}`；`basis` 是目标级 `plan_only:` 时，取计划里那条必需占位任务的 `taskId` → `{kind:'task',taskId}`（5.1.1/N5）；两者都没有 → 不发 | 非空 |
| `deviation:` | `goalId` / `taskId` / `kind` / `planRevision` | D 的 7.1：任务三元组、停因种类（`growth`/`lines`/`budget`/`stop`）、当时的计划版本 | 非空 / 正整数 |
| `planreview:` | `proposalId` / `proposalRevision` | 候选的 `PlanProposalRef.proposalId`、`PlanProposal.revision`（C 读候选时给） | 非空 / 正整数 |
| `planfix:` | 同上 | 被改的那一版候选（`planreview:` 审的那一版） | 同上 |
| `planresume:` | `goalId` / `queryJobId` | 原规划轮的 `QueryJobRef.queryJobId`（从那一轮的已答问题/Query 读，`interventionPlanningQueryRefs(M).queryJobRef.queryJobId` 是同一身份，`src/contracts/query-job.ts:104`） | 非空 |

**`planresume:` 的 `originalMessageRef` 不进请求号。** 它取原 QueryJob 的 `intent.execution.sourceMessageRef`（原规划轮的源消息），只写进正文第二行的 `originalQueryRef`（5.2.3），供准备阶段算原 Query 对、读原问题和逐卡答复；请求号仍是 `planresume:<goalId>:<queryJobId>`。

**`refine:` 的请求号拼法。** `systemRoundRequestId({kind:'refine',goalRef,target,planRevision})` 就是 `refine:<goalId>:<stageId|taskId>:<planRevision>`：`target.kind === 'stage'` 用 `stageId`，`'task'` 用 `taskId`；两个 id 都在第三段，不省略、不加方括号。这是 v3 §5.4 的固定顺序，不是“计划版本在前、段号可选”。

**`deviation:` 的 `kind` 和 `deviationRequestId`。** `SystemRoundV1` 的 deviation 臂用 `cause: DeviationRoundKind` 存这个值（外层判别式已经叫 `kind`，不重名）；`deviationRequestId(round)` 直接调本节 `systemRoundRequestId`，把 `round.cause` 写进请求号的 `<kind>` 段，不另造格式。`cause` 只有 `growth`/`lines`/`budget`/`stop` 四种。`growth` 是任务上下文增长量过该任务 `sizeClass` 的 2 倍线（v3 §4.3 的四档）；**任务没有 `sizeClass` 时只累计、不发 `growth` 轮**。`lines` 是 `changedLines.added + deleted > 2 × estimatedLines`；任务没有 `estimatedLines` 时 `lines` 也不发（缺省是未知，不是 0）。两条软线各自独立的请求号（`cause` 不同），不合并成一条。同一任务同一版已经发过 `stop`/`budget` 时，`growth`/`lines` 不再发轮——硬停因已经让人看过，软线不重复打扰；反过来，软线已经发过不挡硬停因的轮。这个判据由 D 的发现处读现有活动/停因事实得出，不进请求号、不加记录。

**拒绝。** 统一用现有 `rejected('invalid', …)`（`src/contracts/core/rejections.ts`）：`'<字段> is empty'`、`'<字段> must be a positive safe integer'`。不新造错误码。

**同一版只发一次的判据。** 不做去重表、不加记录：

1. `SessionMessage` 的 `messageId` = `sha256(senderIdentity, scope, requestId)`（`src/core/work-graph/communication/mailbox-service.ts:1232`-`:1253` 的 `identityKeyOf`/`messageIdOf`）。同一发送身份、同一 scope、同一请求号 → 同一 `messageRef`。
2. `intervention_planning` 的 QueryJob/QueryRun id = `sha256(messageRef)`（`src/contracts/query-job.ts:104`-`:114` 的 `interventionPlanningQueryRefs`）。同一消息 → 同一 Query 对。
3. 请求号里带了“这一版”的分量：计划版本/段或任务、候选号 + 候选版本、原 Query 号。换了版本、段/任务或候选就是新号；同一版重复调用只重放同一个消息、同一个 Query。
4. **目标循环可以每趟都调用发送**：同一请求号的重发在 mailbox 是 committed 回放（`mailbox-service.ts:2693` 一带的 identity），不会多一条。想少做一次无用功时，先用 `lookupHostSendCommit`（`mailbox-service.ts:4682`；`workflow.ts:1493`-`:1500` 的 `readSuggestionReceipt` 是同一用法）按 requestId/scope/arguments 读回执：`committed` 就不发；`not_committed`/`undetermined` 再发。回执读不是“同一版一次”的必要条件，只是省一次空写。

**同一版一次不覆盖“同一目标多段”。** 每段的请求号带 `stageOrTaskId`（段号或目标级占位任务号），第一次细化的计划版本是 v，采用后是 v+1；下一段的号不同。若第一段的候选没有采用，版本不变，同一段/任务不会再发；这是设计 `:578` 的“同一版只发一次”。
#### 5.2.3 载荷形状：复用 `action_request` 的现有字段，不新增消息字段
系统轮的消息就是现有 `SessionMessageSendInputV1`（`src/core/work-graph/model/communication-contracts.ts:281`-`:293`），用现有字段：

| 字段 | 值 | 说明 |
|---|---|---|
| `recipient` | 解析出的参谋/审阅者/原规划线 `SessionRef` | 每次发送时解析，不缓存 |
| `text` | 第一行 `systemRoundRequestId(round)`；其余按这一轮的任务写（见下） | 模型从正文第一行看这一轮做什么；消费侧只在 `planOnIdleLine` 读正文时解析首行选 base（M-1），`offerKindOf`/授权不解析。Host 系统轮正文可到 64 KiB（按 `isSystemRoundSender`，见 5.2.7）；回复和普通消息 16 KiB |
| `intent` | `'action_request'` | 系统轮的动作意图；不是 `notify`（`notify` 不开轮） |
| `needsReply` | `true` | 收件方要交一个语义答复（候选、问题或审阅结论）；`waitAfterSend` 不设（Host 没有可让出的 Run） |
| `goalRef` | `round.goalRef` | 设计 `:139` 的“用 `message.goalRef`”；`goalRef` 非空，消息服务会校验它和收件轮的有效目标一致（`mailbox-service.ts:2797`-`:2800`） |
| `taskRef` | 只有 `deviation:` 填被判断的任务；其余不填 | `deviation:` 的任务必须在同一 Goal 里（`mailbox-service.ts:2804`-`:2808`）。**不填 taskRef 的系统轮不会进领取分支**（5.2.4） |
| `followupOf` | 只有 `planresume:` 填原消息 `M` | 现有字段；邮箱校验它是同一对 Session 之间的消息（`mailbox-service.ts:2810`-`:2818` 的 `followupConnects`，Host 发送者按收件方一边判）。续轮用它把 R 和原 M 连起来；`M` 取 6.3.1 来源链的 `rootMessage`（最初执行者 M），不是中间那条 R；`repliesToMessageRef` **继承原 Query 的值，没有才用 `rootMessage`**（N9/C-25/C-33）；发送侧的文本上限**不用它判**，按 `isSystemRoundSender(sender)` 选 16/64 KiB（5.3.5 #1） |
| `expected` | 在 `meta.expected: []` | Host 发送不需要 dispatch basis（`mailbox-service.ts:2824` 只对非 Host 的 `action_request` 读 basis；`host-notices.ts:20` 的 `systemNotifyRequest` 同写法） |

**签名：**
```ts
import type { SessionMessageSendInputV1 } from '../../core/work-graph/model/communication-contracts.js';
import type { SessionRef } from '../../contracts/core/identity.js';

/** 一个系统轮的完整发送请求；不写消息服务、不读事实。 */
export function systemRoundSendInput(input: {
  round: SystemRoundV1;
  recipient: SessionRef;
  text: string;                       // 第一行必须是 systemRoundRequestId(input.round)
  taskRef?: { projectId: string; goalId: string; taskId: string }; // 只有 deviation
  followupOf?: SessionMessageRef;    // 只有 planresume
}): { status: 'ready'; value: SessionMessageSendInputV1 } | CoreRejection;
```

`systemRoundSendInput` 还检查 `text` 的第一行严格等于 `systemRoundRequestId(round)`；不等 → `rejected('invalid', 'the system round text must start with its request id')`。这是发送前的格式错误，不是语义判断。

**正文第一行之后写什么：**

| 轮 | 正文（首行之下） |
|---|---|
| `refine:` | 目标、计划 `planId@planRevision`、要细化的段（`target.kind === 'stage'` 时 `stageId`；`'task'` 时那条 `plan_only` 占位任务的 `taskId`）；“只输出这一段：stages 可以只给这一段，tasks/assignments/obligations/依赖只给这一段和它改到的任务；平台会并进完整草稿”；“任务书写进每个任务的 `assignment.instruction`，段总说明写 `PlanStage.description`；每个任务给 `estimatedLines` 和可选的 `sizeClass`（`small`/`medium`/`large`/`explore`）”；“答案用 `submit_plan_round` 填”。 |
| `deviation:` | D 的 7.1 正文：偏差种类（`growth`/`lines`/`budget`/`stop`）、任务、事实、受影响任务；软线 `growth` 是任务上下文增长量过该档 2 倍线，`lines` 是 `changedLines.added+deleted > 2 × estimatedLines`，两条独立请求号；三种答复（改计划/回答/问人）由 D 定；要写计划时用 `submit_plan_round`。 |
| `planreview:` | C 的 6.3 正文：候选、机械诊断、这一版要审什么；结论用 C 的 `submit_plan_review` 填；写文字时按同一 JSON 形状。 |
| `planfix:` | C 的 6.1 正文：上一轮 `planreview:` 的结论和意见；改这一版候选；返修上限 3；答案用 `submit_plan_round` 填。 |
| `planresume:` | 首行 `systemRoundRequestId(round)`；下一行 `originalQueryRef: <canonicalJson(round.originalMessageRef)>`；再下一行固定请求语（“人已答完这一轮的问题卡；接着原规划轮写下一步：只输出这一段/这一版，平台会合并”）。**不带原问题全文、不带逐卡答复正文**；两者由准备阶段按 `originalQueryRef` 装配进模型输入（5.3.5 #8）。 |

**`SystemRoundKind` 在发送侧定；读取侧只在 `planOnIdleLine` 已读正文时解析首行选 base/收尾（M-1）。** `offerKindOf` 和授权分支按发信身份 + 收件线职责（5.2.4），不解析正文。提交工具的选择也不解析正文：它按 QueryJob intent 上冻结的 `answerShape`（5.2.7），这个值在 Query 创建时由 `planOnIdleLine` 按发信身份 + 收件线职责算出，不由模型给。这是对设计 `:140`（“按发信身份和收件线职责判断”）和 `:139`（“不新增消息字段。前缀在已有的请求号里”）的落地；见偏差 D3、N8 与 M-1。
#### 5.2.4 消费侧：`offerKindOf`、`proveInterventionSource`、`handleIntervention`
**（1）`offerKindOf`（`src/core/work-graph/views/consumable-sessions.ts:81`-`:89`）**

在 `decision_request` 之后、`work_run`/`secretary_round` 之前加一支：
```ts
if (message.sender.kind === 'host' && message.sender.actor.kind === 'system'
  && message.intent === 'action_request') return 'action_request';
```
- 不看 `release`：Host 系统发送不是 agent 的受放行请求；`messageConsumptionProblem` 只拒 `awaiting`/`approved`/`denied`（`message-machine.ts:1060`-`:1066`），`release: null` 照常可服务；不把 Host 系统 `action_request` 判成 `person_message`：`person_message` 仍然只给 Host 人类发送者（`:85`）；收件方的 `busy` 仍按现有 `busyReasonOf`（`:91`-`:127`）判；系统轮不绕过占用、健康、归档。空闲消费仍只给每个 Session 开一轮（`host.ts:1825`-`:1908`）。

**（2）`proveInterventionSource`（`src/core/work-graph/tasks/initial-plan-answer.ts:74`-`:113`）**

在“人”与“已放行的 agent `action_request`”之外接受 Host 系统 `action_request`：
```ts
const systemRequest = message.sender.kind === 'host' && message.sender.actor.kind === 'system'
  && message.intent === 'action_request';
if (!person && !releasedRequest && !systemRequest) return { status: 'ready', value: null };
```

其余条件不变：`sourceMessageRef` 的 scope、Goal 相等、消息未撤回未拒绝、`message.goalRef` 等于被证明的 Goal。理由：refine/planfix/planresume/planreview 的 Query 来源都是 Host 系统 R；不放这一支，`readInitialPlanAnswerFacts` 的 `source` 证明返回 null，规划/审阅答案读不出来，候选或结论写不出来。见偏差 D2。

**（3）`handleIntervention`（`src/business/workflow/intervention.ts:58`-`:120`）**

入口顺序保持：读消息 → scope 检查 → `withdrawnAt` → `associate_answer` 完成步 → 收件线 facts → 目标/显示 → 已完成目标的新请求 → 现有任务领取 → 规划。

在 `const line = message.recipient;` 之后（`:74` 一带）解析收件线职责：
```ts
// WorkflowDependencies 已有 sessionDuty（ports.ts:97/152）；intervention.ts 的 Pick 加 'sessionDuty'。
const dutyRead = deps.workflow.sessionDuty === undefined
  ? null : await deps.workflow.sessionDuty(facts.value.session.role, owned.ctx);
// ReadResult 的 not_found/not_ready 不是 HandleInterventionResult；统一走现有 asRejection，
// 保留 revision_conflict/source_stale 的实际语义，不新增错误码（PLS-30/C-31）。
if (dutyRead !== null && dutyRead.status !== 'ready')
  return asRejection(dutyRead, 'the intervention line duty');
const duty = dutyRead !== null && dutyRead.value !== 'unknown' ? dutyRead.value : null;
const systemRound = message.sender.kind === 'host' && message.sender.actor.kind === 'system'
  && message.intent === 'action_request';
const planningLine = duty === 'adviser' || duty === 'reviewer';
// 提交工具的冻结形状：只看可信的发送身份 + 收件线职责，不看正文、不解析请求号。
const answerShape = planningAnswerShapeOf(message, duty);
```

`planningAnswerShapeOf` 的规则（纯函数，放 `src/business/workflow/plan-round.ts`；`SYSTEM_ROUND_ACTOR` 从 `src/contracts/plan-round.ts` 取）：
```ts
export type PlanningAnswerShapeV1 = 'plan_round' | 'plan_review' | 'text';

/** plan-round 系统轮 + 收件线：参谋/秘书 → plan_round，审阅者 → plan_review；Host 的其他自动发送（overlap-note）→ text；人/agent 发给参谋/秘书的规划请求 → plan_round。 */
export function planningAnswerShapeOf(
  message: Pick<SessionMessage, 'sender' | 'intent'>,
  duty: PlatformDutyV1 | null,
): PlanningAnswerShapeV1;
```
- 只有 `sender.kind === 'host'`、`sender.actor.kind === 'system'`、`sender.actor.id === SYSTEM_ROUND_ACTOR.id`、`intent === 'action_request'` 且 duty 是 `adviser`/`secretary`/`reviewer` 时才不是 `text`；`overlap-note:` 走 `automationContext`，发送身份是 `WORKFLOW_AUTOMATION_ACTOR`（`src/contracts/task-requeue.ts:44`），不是 `host:plan-round`，所以是 `text`；没有正文前缀判断；`planresume:` 的收件线若原来是秘书，发送身份仍是 `host:plan-round`，所以仍是 `plan_round`，不会误挂 `submit_secretary_answer`。**这个函数只定答案工具形状**；N 的注记准入另按 5.2.8 的“可信规划来源 + duty”判，不因为这里是 `text` 就丢注记工具。

`planOnIdleLine` 建 Query 时把 `answerShape` 写进冻结的 `execution`：
```ts
execution: {
  kind: 'intervention_planning',
  sourceMessageRef: { ...message.ref },
  answerShape,                       // 新字段，见 5.2.7；text 时可省略
  roleBinding: input.roleBinding,
  runtimeBudget: input.runtimeBudget,
},
```

审阅分支不建候选：`duty === 'reviewer'` 时走 C 的 6.3 审阅入口，用同一 `planOnIdleLine` 的 Query 创建骨架，但 `answerShape = 'plan_review'`，答案读完只写结论、`proposePlan` 不调用。

**分支（按顺序）：**

| 情况 | 走哪 | `taskRef` | 领取 |
|---|---|---|---|
| `associate_answer` 完成步 | 现有 `associateAnswer`；默认只回 R。`planresume:` 的 M 只在最终回答、提案被拒或采用成功后回（C-25）；人的普通消息没有执行者 wait，按原收尾关联、不做 M 的延后；M 的关联用 R 的 Query（`queryMessageRef`/`replyToMessageRef` 两参数） | 不用 | 不领 |
| 已完成 Goal 的 dead line | 现有 `requestNewGoal`（`:168`-`:176`） | 不用 | 不领 |
| `systemRound` 或 `duty === 'adviser'` 或 `duty === 'reviewer'` | 规划分支：`reviewer` 转 C 的审阅入口（`answerShape='plan_review'`）；其余走 `planOnIdleLine`（`:178`，`answerShape` 按上） | **只作规划上下文**：`addressed` 不取 `latestWork`；系统轮不填就不填 | **不领**；不调用 `claimFirstReady`（`:345`） |
| 收件线是 `executor` 或 `secretary`，且不是系统轮 | 今天的路径：`addressed = message.taskRef ?? latestWork`，未完成任务领取；否则 `planOnIdleLine` | 可决定领取 | 现行 |
| `sessionDuty` 未装配 / `unknown`（老窄装配） | 非系统轮按今天的路径；系统轮仍按“只作上下文、不领”；`answerShape` 只有系统轮可能是 plan 形状，duty 读不到时按 `text`（不猜审阅） | 系统轮不领 | 系统轮不领 |
- **“不走 `latestWork` 回退”。** 今天的 `addressed = message.taskRef ?? facts.value.latestWork?.task ?? null`（`:79`）会把“发给参谋线的行动请求”当成“让这条线继续它的上一个任务”。规划线/系统轮分支改成 `addressed = message.taskRef`；`goalRef` 用 `message.goalRef`（设计 `:139`）。现有的领取块 `if (addressed !== null) {…}`（`:96`-`:115`）要包在 `if (!systemRound && !planningLine && addressed !== null)` 里；否则 `deviation:` 带 `taskRef` 时仍会走领取。`message.goalRef` 为空时走现有 `queued`/`no_task`（`:117` 一带），不猜；**“不走 `claimFirstReady`”。** 规划分支写候选/写审阅结论后返回，不调用 `:345` 的 `claimFirstReady`，也不调用 `:320`-`:336` 的 `applyPlanChange`。采用移出到目标循环（C 的 6.1，设计 `:203`-`:205`）；本节只保证参谋/审阅/系统轮这条分支不领、不采用；**执行者/审阅者发给参谋的普通 `action_request`。** 它们没有前缀，收件线是 `adviser`（或 `reviewer`），所以走同一分支；`taskRef` 进规划上下文，不进领取。设计 `:140` 的“按发信身份和收件线职责判断这不是让这条线继续任务”就是这张表；**`planOnIdleLine` 的收尾。** 现有四收尾不变（`:260`-`:343`）：无效答案、无答案、问题卡、候选。规划的 Query 仍是那条 `intervention_planning`：`interventionPlanningQueryRefs(message.ref)`、`sourceMessageRef = message.ref`、`focusTaskRefs: []`、`budget: input.budget`（`:178`-`:260`）。**加三处**：
  1. 消息带 `followupOf` 时（本规格只有 `planresume:` 会带），`intent.execution` 加 `repliesToMessageRef`：**继承原 Query 的 `repliesToMessageRef`**（多次问人时一路继承最初执行者的 M），不是复制当次 `followupOf`；原 Query 没有该值时才用 6.3.1 来源链的 `rootMessage`（最初执行者 M，不是中间那条 R）。`question` 用正文（首行请求号 + `originalQueryRef` 引用 + 固定请求语；原问题全文和逐卡答复正文都不进正文，准备阶段按引用装配，见 5.3.5 #8）。不解析前缀。
  2. 建 Query 时写 `execution.answerShape`（`planningAnswerShapeOf` 的结果；`plan_review` 只由审阅分支用）。这是 Query 创建时的平台决定，不是准备阶段从正文推。
  3. 答案形成 draft 后、`proposePlan` 前剥掉 segment 的 `origin`，调用 `mergeStageRefinement(base, segmentWithoutOrigin)`（v3 §5.5；5.1.2 的签名）；base 由 C 的候选/目标读给出，本节只要求“refine/deviation 用活动计划的 snapshot，planfix 用被审候选的 draft，planresume 用 6.3.1 来源链的 `fixBase`（原 Query 是返修轮时），没有 `fixBase` 才用活动计划 snapshot；结果保留 base 的来源证明”，`basedOn` 按 5.1.2 分开取：base 是活动计划 snapshot 时取它的 `ref`；base 是 `fixBase`（被审候选的 draft）时取父候选的 `basedOn`。候选的 `PlanChangeReason` 从答案根的 `reason` 读（`{text, affectedTaskIds?}`，缺省用 `{text: summary, affectedTaskIds: []}`），平台补 `sources: []` 后原样交给 `proposePlan`；不另建影响记录。
- **两种收尾（设计 `:142`、`:311`；PLS-06/PLT-10/C-25）。** 规划 Query 的答案落成后，Host 的 `consumeIdle` 调 `handleIntervention(..., completion: 'associate_answer', replyToOriginal: <boolean>)`（`host.ts:1870`-`:1880`）；这个布尔值按下一段的规则算，不是直接把 `reason` 传下去。**系统消息 R 可以结束**：候选写入（`progressed: proposal`）、最终回答、问题卡都只把答案关联回 R；**执行者原消息 M 不在候选待决、问人期间回复**。M 的回复只发生在三种终态：最终文字/无效答案的回答、提案被拒（`declined`）、采用成功（含早已 `accepted` 的候选，返回 `answer_ready` 且 `reason:'adopted'`）。Host **按真实发送者和执行者的 open wait** 决定 `replyToOriginal`，不按 `reason` 单判：`executorWait && candidateOrQuestions` 才延后回 M（`candidateOrQuestions` = `reason` 是 `candidate` 或 `questions`）（`executorWait` = 这条收尾要回的 M 是执行者 `work_run`/`secretary_round` 发的、它的 wait 仍 `open` 且 `response===null`；M 取 `repliesToMessageRef ?? 6.3.1 来源链的 rootMessage`）；`answered`/`invalid_plan`/`declined`/`adopted` 照旧回 M。**人的普通消息没有执行者 wait**，不管 `reason` 是 `candidate` 还是 `questions` 都按原收尾结束（关联答案或撤回），不套“执行者保持等待”的例外；**Host 系统 R** 同样按原收尾结束，R 的结束不等于 M 的回复。**M 只有一个回复槽**：`associateAnswer` 先读消息现状，已有同答案的回复就返回 `responded`（幂等），已有别的回复返回 `source_stale`，绝不第二次覆盖；候选待决期间 M 的 wait 保持 `open`，不被提前解除。**没有 R 的原始执行者消息不关联**：`replyToOriginal=false` 且消息本身就是 Query 来源（`planresume:` 还没出现）时，`associateAnswer` 直接返回 `responded` 的空操作，不写 M；只有 `planresume:` 的 R 才在候选写入/问题卡时被关联。**M 的关联必须用 R 的 Query**：`interventionPlanningQueryRefs(R)`，不是 `interventionPlanningQueryRefs(M)`；`associateAnswer` 拆成 `queryMessageRef`/`replyToMessageRef` 两个参数，现有单参数调用传同一个值。审阅轮同样只关联回 `planreview:` 消息，不写候选。没有答案/无效答案/问题卡沿用现有三种收尾（`host.ts:1858`-`:1886`）：通知（`questions` 不发）+ 关联，或通知 + 撤回。**不把“消息有回复”当作闭环完成**：M 仍在等时，R 的结束只是系统轮结束；闭环由采用/最终回答收尾（6.1、7.3、7.3.1）。

**（4）审阅分支的接缝。** `duty === 'reviewer'` 的 `planreview:` 由 C 的 6.3 写（Query、答案工具、结论读取、`planreview:` 的请求号 C 已用本节 `systemRoundRequestId` 的格式）。本节只规定：收件线按 duty `reviewer` 解析；**审阅 Query 仍走本节 `handleIntervention` 的 Query 创建路径**，`execution.kind` 仍是 `intervention_planning`，`execution.answerShape` 写 `'plan_review'`；答案工具由 5.2.7 的冻结形状挂上；审阅结论不写检查证据、不碰完成归约（设计 `:248`）。没有审阅线时不跳过、转候选卡（设计 `:251`）。
#### 5.2.5 系统轮的发送者
**身份。** “Host 系统身份”在本规格落成一个固定常量，放 `src/contracts/plan-round.ts`（读取侧也要用它算 messageRef，并用于 `planningAnswerShapeOf` 的判据）；`src/app/system-round.ts` 只放 `sendSystemRound` 的发送/回执包装：
```ts
/** 系统轮的唯一发送身份；固定 id 才能让同一请求号得到同一 messageId。 */
export const SYSTEM_ROUND_ACTOR = Object.freeze({ kind: 'system' as const, id: 'host:plan-round' });
```
- 现有平台自动化身份有 `WORKFLOW_AUTOMATION_ACTOR`（`src/contracts/task-requeue.ts:44`，`workflow:auto-rework`）、`HOST_RECONCILE_ACTOR`（`src/app/startup-reconcile.ts:75`）、`GOAL_FAN_OUT_ACTOR`（`:47`）。它们各有语义（自动返工、启动核对、目标 fan-out），借来当系统轮发送者会让历史和界面把规划请求读成返工/核对。**本规格的五个系统轮（`refine:`/`deviation:`/`planreview:`/`planfix:`/`planresume:`）都经 `sendSystemRound(systemRoundContext(scope, signal), request)` 发送**，包括 Workflow 选择步骤里的偏差发信（7.1.4），不用 `automationContext`；`WORKFLOW_AUTOMATION_ACTOR`/`automationContext` 只留普通返工（`requeue_task`/`reverify_round`/`suggest_member` 等）和 `overlap-note:` 这类非系统轮。`overlap-note:` 继续用 `WORKFLOW_AUTOMATION_ACTOR`，所以它和系统轮在 `answerShape` 上也自然分开。新增一个固定 id 不是新字段、状态或记录；列在 N7，lead 可改回复用哪个常量；发送上下文 = Host 的 scope 上下文 + `SYSTEM_ROUND_ACTOR`（形状同 `host.ts:1126` 的 `principal`/`materialReader`）。不要用 UI 的操作者 human 身份发系统轮：那会变成 `person_message`，消费侧开的是人干预路径，不是系统轮。

**签名（`systemRoundContext` 也放 `src/contracts/plan-round.ts`：纯上下文构造，`business/workflow` 也能 import，偏差发送步骤用它）：**
```ts
export function systemRoundContext(scope: { projectId: string; workspaceId: string },
  signal: AbortSignal): CoreCallContext;

export async function sendSystemRound(ctx: CoreCallContext, deps: {
  messages: Pick<SessionMessageCommandPort, 'sendMessage' | 'lookupHostSendCommit'>;
}, input: { round: SystemRoundV1; recipient: SessionRef; text: string;
  taskRef?: TaskTriple; followupOf?: SessionMessageRef }):
  Promise<SendMessageResultV1 | { status: 'skipped'; reason: 'already_committed' } | CoreRejection>;
```

`sendSystemRound` 的出口：`systemRoundSendInput` 拒绝 → 原拒绝；`lookupHostSendCommit` 返回 `committed` → 回执读只给 cursor/eventIds，不给 messageRef，**所以跳过发送时返回一个专用的 `{ status: 'skipped'; reason: 'already_committed' }`**，不伪造 `SendMessageResultV1`。回执读失败（`undetermined`）照发；发送的拒绝原样返回。这个专用结果只给目标循环看，不新增消息状态。
#### 5.2.6 请求号在读取侧怎么用（合并定法 M-1，偏差 D3 的落法）
设计第 5.2 节说“前缀在已有的请求号里”，但代码的消息记录不带 `requestId`（偏差 D3）。为了不新增消息字段、也不靠全表扫描，读取侧这样走：

1. 请求号仍是发送的 `meta.requestId`，并原样放在正文第一行（N8）。
2. `messageId` 是 `session-message-` + `sha256(canonical({projectId, workspaceId, sender, requestId}))`（`src/core/work-graph/communication/mailbox-service.ts:1251`）。把这段算式提成一个纯函数，和 mailbox 共用：
```ts
// src/contracts/plan-round.ts（纯；Workflow、AgentRuntime、Host 都能 import）
export const SYSTEM_ROUND_ACTOR = Object.freeze({ kind: 'system' as const, id: 'host:plan-round' });

/** 与 mailbox 的 messageIdOf 同一算式；Host 发送者用 {kind:'host', actor}。 */
export function hostMessageId(scope: { projectId: string; workspaceId: string },
  actor: { kind: 'human'; id: string } | { kind: 'system'; id: string }, requestId: string):
  { status: 'ready'; value: string } | CoreRejection;

/** 系统轮的 messageRef；同一请求号永远同一 ref，不需要先发送。 */
export function systemRoundMessageRef(scope: { projectId: string; workspaceId: string },
  requestId: string): { status: 'ready'; value: SessionMessageRef } | CoreRejection;

/** 正文首行的请求号 → 轮种和原文段；不是已知前缀 → null（按普通规划处理，不是错误）。
 *  读侧只拿轮种/原文段，不把 refine 的 stageOrTaskId 猜成段或任务；工具选择不读它。 */
export type SystemRoundHeadV1 =
  | { kind: 'refine'; goalId: string; stageOrTaskId: string; planRevision: number }
  | { kind: 'deviation'; goalId: string; taskId: string; cause: DeviationRoundKind; planRevision: number }
  | { kind: 'planreview'; proposalId: string; proposalRevision: number }
  | { kind: 'planfix'; proposalId: string; proposalRevision: number }
  | { kind: 'planresume'; goalId: string; queryJobId: string };
export function systemRoundOfText(text: string): SystemRoundHeadV1 | null;
```

`systemRoundOfText` 只解析首行的段，不还原成完整的 `SystemRoundV1`：`refine:` 的第三段可能是段号，也可能是目标级占位任务的 taskId，读侧没有足够事实区分，也不需要在读取侧区分；`planOnIdleLine` 只用 `head.kind` 选 base/收尾。审阅轮准备阶段用同一解析取 `planreview:` 的 `proposalId`/`proposalRevision`（6.3.2），也只用于候选身份，不用于工具选择。

3. 读取侧算 ref，不发送：`systemRoundMessageRef(scope, requestId)` → `interventionPlanningQueryRefs(messageRef)`（`src/contracts/query-job.ts:104`）→ `readQueryJob`/`readQueryAnswer`（`src/core/work-graph/queries/contracts.ts:275`、`:284`）。`not_found` 只在“消息回执不是 `committed`”时表示这一轮还没发；消息已提交而 Query `not_found` 是建 Query 的窗口，按 `waiting` 等，不重发；Query 已终态却没有合法结论按 `terminal_invalid` 转卡（6.1.2 步 5、C-21）。
4. `planOnIdleLine` 本来就要读正文建 Query 的 question；它用 `systemRoundOfText` 取首行的 `kind`，只用来选 base 和收尾：`refine`/`deviation` 用活动计划；`planfix` 用被审候选；`planresume` 用 6.3.1 来源链的 `fixBase`（原 Query 是返修轮时），没有才用活动计划。`refine` 的第三段是段号还是占位任务号，这里不猜。`offerKindOf`、`proveInterventionSource` 和授权分支都不解析正文。
5. **`planfix:`/`planresume:` 的来源和 `completedFixes`：** 返修写新的独立候选；同一来源链（6.3.1 的 `planSourceLineageOf`）**跨两种首行**读：`planfix:` 读父候选的 `{proposalId, proposalRevision}` 和它的 `sourceMessageRef`，`planresume:` 读原 QueryJob 的 `execution.sourceMessageRef`（原 Query 可能就是返修 Query）。由这条链取得 `rootMessage`、`fixRound`/`fixBase` 和后继关系；候选/卡读取按后继关系排除旧候选。`completedFixes` 数同一 `basedOn` 上**已经写出候选的 planfix 轮**：每轮按链上那条 `planfix:` 消息的身份去重，直接写出的候选和经 `planresume:` 续出的候选都归同一轮；不沿 `replaces` 走、不读正文其余部分、不加字段、不改 Query 来源（6.3.4）。
6. `planresume:` 请求号用原规划轮的 `QueryJob` 号；**正文/`question` 只带请求头 + `originalQueryRef`（原 Query 的源消息引用），原问题和逐卡答复在准备输入时装配（5.3.5 #8）**；`followupOf` = 6.3.1 来源链的 `rootMessage`（最初执行者 M）；`repliesToMessageRef` **继承原 Query 的 `repliesToMessageRef`，没有才用 `rootMessage`**，不复制当次 `followupOf`，否则多次问人会丢最初执行者的 M。
7. `SYSTEM_ROUND_ACTOR` 和 `systemRoundContext` 放 `src/contracts/plan-round.ts`（Workflow 也能 import）；`src/app/system-round.ts` 只放 `sendSystemRound` 的发送/回执包装。mailbox 的 `messageIdOf` 改成调用 `hostMessageId`，算式只留一份。
8. **提交工具的选择不在这一层。** 读取侧不按 `systemRoundRequestId` 或正文首行选答案工具；工具的准入只读 QueryJob intent/准备清单里冻结的 `answerShape`（5.2.7）。请求号只用于消息/Query 身份和幂等。

出口：`hostMessageId`/`systemRoundMessageRef` 对空 id、非正整数版本 → `rejected('invalid', …)`；`systemRoundOfText` 未知前缀 → `null`。
#### 5.2.7 普通 Query 的提交工具（C-1，取代 B-D1）
今天 `intervention_planning` 是 `manifest.request === null` 的普通 Query，`query-preparation.ts:356` 和 `query-execution.ts:355` 在 request 为 null 时把 `answerTools` 置 null，`answer-tools.ts:71` 的 `answerToolsOf` 也只映射请求轮的两种 `executionKind`。所以审阅轮和规划轮都拿不到提交工具，只能写文字。这一小节把准入改成“按 Query 自己的冻结答案形状挂工具”，并同时把 256 KiB 从观察器/持久层挪到规划轮这个工具上（取代 B-D1）。

**（1）两个字段、一个纯函数。**
```ts
// src/contracts/query-job.ts（纯；Workflow、AgentRuntime、Host 都能 import）
export type QueryAnswerShapeV1 = 'secretary' | 'initial' | 'plan_round' | 'plan_review';
export type PlanningAnswerShapeV1 = 'plan_round' | 'plan_review' | 'text';

// QueryJobIntentV1.execution 的 intervention_planning 臂加可选字段：
//   answerShape?: PlanningAnswerShapeV1;  // 缺省 = 'text'；只能由建 Query 的平台代码写
// PreparedQueryManifestV1 加字段（新清单必写）：
//   answerShape: QueryAnswerShapeV1 | null;

/** 准备/启动共用的唯一映射；requestExecutionKind 非 null 时就是今天的请求轮映射。 */
export function queryAnswerShapeOf(
  execution: QueryJobIntentV1['execution'],
  requestExecutionKind: SecretaryRequestManifestV1['executionKind'] | null,
): QueryAnswerShapeV1 | null;
```

| 字段 | 类型 | 谁写 | 谁读 |
|---|---|---|---|
| `QueryJobIntentV1.execution.answerShape` | `PlanningAnswerShapeV1`，可选，只在 `intervention_planning` 上出现 | Query 创建处的平台代码：`planOnIdleLine` 用 `planningAnswerShapeOf(message, duty)` 算；审阅分支传 `plan_review` | 准备阶段 `query-preparation.ts` 复制进清单；Query 记录 codec 用 `validQueryExecution` 校验；模型不写、不可见 |
| `PreparedQueryManifestV1.answerShape` | `QueryAnswerShapeV1 \| null`，新清单必写 | `query-preparation.ts` 从已冻结的 `execution`/`request` 复制一次 | 启动 `query-execution.ts`（`finalToolNamesOf` 的 `answerTools`、`createAnswerTools`）、观察器 `query-observation.ts`、审阅读取 |

`queryAnswerShapeOf` 的规则只有三条：

1. `requestExecutionKind !== null`（请求轮）→ `semantic_query` = `secretary`，`initial_coordination` = `initial`。这是今天的映射，原样。
2. 非请求、`execution.kind === 'intervention_planning'` → `execution.answerShape === 'plan_review'` 给 `plan_review`；`'plan_round'` 给 `plan_round`；`'text'` 或缺省给 `null`。
3. 其余非请求 Query → `null`。

`validQueryExecution` 增加：`answerShape` 只允许出现在 `intervention_planning` 上；值只能是 `'plan_round' | 'plan_review' | 'text'`；别的 kind 带它 → `false`。Query 记录 codec 已经在 `src/core/work-graph/queries/query-record-codecs.ts:271` 调它，所以持久层和提交入口同一条校验，不另写第二份。

**（2）形状从哪来（防伪造、重启、旧清单）。**
- **在哪算。** 只在 Query 创建处算一次：`handleIntervention` 读到收件线 duty 后调用 `planningAnswerShapeOf(message, duty)`。判据是**发送身份 + 收件线职责**：
  - `host` 系统身份且 `actor.id === SYSTEM_ROUND_ACTOR.id` 的 `action_request`：收件 duty `reviewer` → `plan_review`；收件 duty `adviser`/`secretary` → `plan_round`；其他 duty → `text`。
  - `host` 系统身份但 `actor.id !== SYSTEM_ROUND_ACTOR.id`（例如 `overlap-note:` 的 `workflow:auto-rework`）→ `text`。
  - 人、`work_run`、`secretary_round` 发给 `adviser`/`secretary` 的 `action_request` → `plan_round`（它也是规划轮，走 `planOnIdleLine`，不是秘书请求轮）；发给 `reviewer` 的 → `text`（审阅只由系统轮开）。
  
  **注记准入与这个形状分开。** `overlap-note:` 的 N 轮（`automationContext` 的 `workflow:auto-rework`，Host 系统 `action_request`、收件参谋/秘书）形状是 `text`、不挂 `submit_plan_round`，但它按 5.2.8 的“可信规划来源 + duty”进 planning 注记准入；不因为形状是 `text` 就丢掉注记工具，也不因为要注记就改成 `plan_round`。
  
  **不解析正文，不解析请求号**；`planreview:` 前缀仍用于消息/Query 身份和幂等，不用于选工具。
- **怎么防伪造。** 模型不能写 `QueryJobIntentV1`、`PreparedQueryManifestV1` 或 `promptSet.toolNames`；`execution.answerShape` 只由平台代码在创建 Query 时写；`validQueryExecution` 限定 kind 和枚举；启动时 `finalToolNamesOf` 用冻结的 `manifest.answerShape` 重新算出工具名，再和清单里冻结的 `promptSet.toolNames` 逐项比，不一致 → `forbidden`（`query-execution.ts:373`-`:377`）。正文里写什么前缀都改不了工具表。
- **重启后怎么重建。** 不需要重建：`QueryJobV1.intent.execution.answerShape` 和 `PreparedQueryManifestV1.answerShape` 都是持久记录/持久 manifest 的一部分。重启后 Host 读 QueryJob/QueryRun 和 manifest，按原值启动；同一 Query 的 Kernel Turn 已结束就按观察器读答案，不会重新准备。**不保留旧清单的兼容读取**：本规格发布前没有已投产的旧清单，开发库和夹具按当前格式重建；新清单必写 `answerShape`，读侧缺这个字段按清单损坏处理（`unavailable`），不回推、不猜旧工具表。
- **绑定晚于启动。** 形状在 Query 创建时冻结，不等审阅线/参谋线后来创建；已存在的 Query 不会因为后来建线改形状。后建的线只会收到之后新建的 Query。
- **Run 还在跑。** 形状与 Run 无关；系统轮可以在 Run 在跑时发（5.5.4），规划/审阅 Query 都只读，不领取、不改在跑的任务。

**（3）工具表：一个形状对应一组名字。**

| `answerShape` | 冻结的工具名 | 表单（模型填） | 平台填的固定成员 | 正文上限 |
|---|---|---|---|---|
| `secretary` | `submit_secretary_answer` | 今天的 `{ body, ideas, goalCardDrafts? }` | `schemaVersion:1`、每个 goal draft 的 ref | 16 KiB |
| `initial` | `submit_initial_plan`、`submit_initial_questions` | 今天的 v2 plan/questions 表单 | `schemaVersion:2`、`kind`、`plan.schemaVersion`、`tasks[].phase:'pending'`、`requireDag`、每个 ref 的 project | 16 KiB |
| `plan_round` | `submit_plan_round`（新，一个工具） | `{ answerKind:'plan' \| 'questions', summary, plan?, questions?, reason? }`；plan 表单复用 `submit_initial_plan` 的 `plan` 子表单（任务带可选的 `sizeClass`、`estimatedLines` 和已有的 `replacedByTaskId`；plan 顶层带已有的 `inputRequirements`），questions 复用 `submit_initial_questions` 的 `{summary, questions}`；`reason` 是 `{ text, affectedTaskIds? }` | `schemaVersion:2`、`kind:'plan' \| 'needs_decision'`、`plan.schemaVersion:2`、`tasks[].phase:'pending'`；不填 `setup`、不填 `goalCardDrafts`/`planDraftIndex`（规划轮有 Goal） | **256 KiB** |
| `plan_review` | `submit_plan_review`（新） | `{ verdict:'pass' \| 'fix', findings?:[{taskId:string \| null, text:string}] }`；`pass` 可省 findings，工具写空数组；`fix` 必须有至少一条 | `schemaVersion:1`、`kind:'plan_review'`、`pass` 缺省时的 `findings:[]` | 16 KiB |
- `submit_plan_round` 的根 schema 用**一个 strict 对象**，不是根 union（Kernel 会摊平根 union，见 `answer-tools.ts:14`-`:16`）：`answerKind` 枚举 + 可选 `plan`/`questions`/`reason`；`answerProblems` 的 `plan_round` 分支要求恰好一支：`plan` 时 `questions` 不出现，`questions` 时数组非空、`plan` 不出现。`plan` 子 schema 直接用 `planSchema`（`answer-tools.ts:257`），任务字段加 `sizeClass: z.enum(['small','medium','large','explore']).optional()`、`estimatedLines: z.number().int().min(1).optional()`，并补上**已有领域字段** `replacedByTaskId: z.string().min(1).nullable().optional()`；plan 顶层补 `inputRequirements: z.array(...).optional()`（元素形状照 `TaskInputRequirementV2`：`requirementId`/`consumerTaskId`/`kind:'artifact'`/`artifactRef`，strict）。`reason` 是 strict `{ text: string, affectedTaskIds?: string[] }`，**只做通道，不复制领域类型**；答案协议类型 `InitialPlanningResponseV2` 加可选的 `reason?: { text: string; affectedTaskIds?: string[] }`（只在 `plan` 分支出现，不写进 `PlanRevisionDraft`）。不复制第二份 plan schema。`buildAnswerText` 的 `filledPlan` 原样展开任务，所以 `replacedByTaskId`/`inputRequirements` 原样进 v2 plan；`reason` 原样写进答案根（`parseInitialPlanningResponseV2` 不判它、不丢它），`planOnIdleLine` 组候选时读 `parsed.response.reason`，补 `sources: []` 后作为 `PlanProposal.reason` 交给 `proposePlan`；不另建影响记录。`estimatedLines` 是 5.3.2 的字段，`sizeClass` 是 v3 §4.3 的档位；10.3 的 2 倍线用它们。`RuntimeTask.sizeClass?` 与 `estimatedLines` 同批加在 plan 契约（5.3.1/5.3.2 的字段表）；本工具 schema 只透传，不另造运行时字段。缺 `reason` 时平台用 `{ text: summary, sources: [], affectedTaskIds: [] }`，候选若改了带 Run/归约的任务，`plan-machine.ts:695` 的 `reason.affectedTaskIds must list traced task` 会原样拒绝，平台不替模型补语义。
- `submit_plan_review` 的 schema：根 strict 对象，`verdict` 枚举，`findings` 可选数组（元素 strict `{taskId: string|null, text: string}`）；不用 transform；`fix` 至少一条 finding 由 `answerProblems` 判（schema 不表达跨字段规则），`pass` 的 findings 不作限制；`planReviewAnswerText` 对缺省 findings 写 `[]`，所以 `answer.answer` 里总是有数组。
- 两个新工具都写 `effectClass:'read_only'`、`requiredCapabilities:['workspace_read']`、`independentReadOnly:false`，和 FA 三个工具同一条（`answer-tools.ts:598`-`:619`）；**write-free**：Kernel transcript 是唯一记录，无 command id、无幂等键、无 `requestIdForCall`。
- `buildAnswerText` 改成按 `answerShape` 分派（请求轮两支行为不变；`plan_round` 生成 v2 plan/needs_decision 但不带 `setup`；`plan_review` 生成 `{"schemaVersion":1,"kind":"plan_review",...}`）。工具接受和观察器重建都调这一个函数，保证接受与落盘一致。
- `answerProblems` 的签名改成 `(shape, form, built, facts: SecretaryPreparationFactsV1 | null)`：`secretary`/`initial` 仍用今天的请求事实检查；`plan_round` 用 `parseInitialPlanningResponseV2(built)` 作唯一格式门，并在同一处兑现**短结论**：`response.summary` 必须非空、`Buffer.byteLength(summary,'utf8') <= 16 * 1024`，否则 `invalid` 加一条 problem（`the plan summary must be non-empty and at most 16 KiB of UTF-8`）；分段合并/计划校验仍在 `mergeStageRefinement`/`proposePlan`，不在工具里预演；`plan_review` 用 `parsePlanReviewAnswer(built)` 加 `fix` 非空规则。`createAnswerTools` 只在 `secretary`/`initial` 时要求 `deps.secretaryFacts`，另两种形状不读项目事实。
- 接受：`success(callId,{status:'accepted'})`，callId 进 `acceptedAnswerCallIds`，`createAnswerToolBarrier` 在本组结果提交后 `yield`，结束 Turn。拒绝：超界 `capacity`；形状/内容 `invalid`（`problems` 原样，模型同一轮改完再交）；事实读失败 `unavailable`（只可能发生在两种请求轮形状）。工具被拒时不进 `acceptedCallIds`，本轮继续；若最终没有接受提交，观察器按 `extractAnswer` 读最后的文本（FA 的写文字退路）。

**（4）16 KiB / 64 KiB / 256 KiB 的分界（取代 B-D1）。** 完整定值表、每一处谁判、超界走哪个现有结果，只在 **5.3.5** 写一处；这里只留结论：**只有规划答案要 256 KiB**——`submit_plan_round` 拼出的 `answer.answer` 和持久答案 codec 是 256 KiB；所有回复正文（系统轮 R 和执行者 M 一样）和规划轮的纯文字退路是 16 KiB；Host 系统轮的消息正文和它的 Query `question` 是 64 KiB（`planresume:` 的正文只有请求头 + 原 Query 引用；原问题和逐卡答复在准备输入时装配，不占 `question` 的字节）；普通消息和普通 Query 的 `question` 仍是 16 KiB。`submit_secretary_answer`/`submit_initial_*`/`submit_plan_review` 16 KiB。规划轮的输出预留按 `planningOutputReserveTokens(contextWindowTokens) = min(131072, ⌊contextWindowTokens/2⌋)`（5.3.5 #6；请求侧和 Host 侧同一个函数），普通 profile 仍 16384，**不改窗口本身**。**放宽只认 Host 系统轮身份（`isSystemRoundSender(sender)`），不看 `followupOf`**；长度函数一份，发送和读取用同一个判断（5.3.5 #1）。**不碰 Artifact/manifest/材料存储的上限**：消息正文 64 KiB 远小于 `ARTIFACT_MAX_SIZE_BYTES`（`artifact.ts:6`），256 KiB 只在答案记录里，消息只放短结论（5.3.5 envelope 段）。

**（5）工具表在准备和启动两边怎么对齐。**
- 准备（`query-preparation.ts`）：先算 `shape = queryAnswerShapeOf(execution, secretaryFacts === null ? null : secretaryFacts.executionKind)`；把它写进 `finalToolNamesOf({ ..., answerTools: shape })`，得到 `toolNames` 并冻结进 `promptSet.toolNames`；同时把同一个 `shape` 写进 manifest 的 `answerShape`。两处是同一个值，不是两次独立判断。**追加指南与工具形状分开判**（PLS-20）：`shape === 'plan_round'` 时附 `initial-planning-answer`；`shape === 'plan_review'` 时附 C 的 `plan-review-input`，**不附** `initial-planning-answer`（否则审阅模型会被要求写计划）；`shape === null` 时**不按形状一刀切**——非请求、`execution.kind === 'initial_coordination'` 的普通 Query 仍附今天的 `initial-planning-answer`（`query-preparation.ts:380` 的现有行为，`context-query-recipe.ts:101` 的 `planning` 模板也照旧选 `query-planning-input`），其余 `null` 不附。判据是“这张 Query 的具体规划用途”，不是只把 `null` 当“没有指南”。
- 启动（`query-execution.ts`）：从 manifest 读 `shape = manifest.answerShape`（新清单必写；缺失/损坏 `unavailable`，不回退）；`finalToolNamesOf({ ..., answerTools: shape })` 得到 `startToolNames`；和 `manifest.promptSet.toolNames` 逐项比，不一致 → `rejected('forbidden', 'the prepared tool list no longer fits this Run')`（`:373`-`:377`）。`submitNames = answerSubmitNamesIn(frozenToolNames)` 从冻结名字取；`createAnswerTools` 也按同一个 `shape` 建，不再用 `manifest.request === null` 或 `manifest.request!.executionKind`。**`createAnswerTools` 的 config 改成以 `shape` 为准**：`executionKind`/`hasGoal`/`goalLess` 只在 `secretary`/`initial` 形状上读（`manifest.request!` 仍只在这两个形状上解引用）；`plan_round`/`plan_review` 不读这三个字段，`deps.secretaryFacts` 也不是必需。
- **不保留旧清单兼容。** 没有 `legacyAnswerShapeOf`、没有按 `manifest.request` 回推形状的读侧 fallback；新 Query 一律显式写 `answerShape`，开发库和夹具按当前清单格式重建（PLS-27）。
- 观察器（`query-observation.ts`）：`submitNames` 仍从 `manifest.promptSet.toolNames` 取；`submittedAnswerArgumentsOf` 有提交就取第一条成功参数，`buildAnswerText(shape, ...)` 重建正文；`formalAnswerOf` 的 `RequestAnswerFormat` 改成冻结的 `shape`（不再是 `isRequestRound(job)`），普通 Query 的 `request === null` 不再影响工具答案的读取。文字退路仍是 `extractAnswer` + `formalAnswerOf` 旧读法，只是 bound 按 shape 选。
- 审阅结论的读取：审阅 Query 的答案仍写在 `QueryJobAnswer.answer`（普通 Query 的答案记录），目标循环用 `readQueryJob`/`readQueryAnswer` 读，再 `parsePlanReviewAnswer`；不需要新读口、不新增记录。

**（6）走法：起点、重启、绑定晚于启动、Run 在跑。**

1. **冷启动/第一次发审阅或 refine。** 目标循环发系统轮 → 收件线 Host `consumeIdle` → `handleIntervention` 读到 duty → `planningAnswerShapeOf` 算形状 → `planOnIdleLine` 建 `intervention_planning` Query，`execution.answerShape` 冻结 → 准备把同一形状写进 manifest 和工具表 → 启动按 manifest 挂 `submit_plan_round` 或 `submit_plan_review`。模型填表提交；工具生成协议文本；屏障结束 Turn；观察器写 `answer.answer`；Host 关联回消息；目标循环读答案。
2. **重启。** QueryJob intent 和 manifest 都在持久层；重启后重驱按原 `answerShape` 准备/启动。已启动的 Query 走观察器读答案；未启动的 Query 用原 manifest，不重算形状；清单缺字段按损坏处理，不回退旧行为（PLS-27）。
3. **绑定晚于启动。** 形状在 Query 创建时定；之后建审阅线/参谋线只影响新 Query。没有审阅线时不建审阅 Query、转候选卡（6.3.4）；没有参谋线时 `refine:` 不发（5.5.3）。
4. **Run 在跑。** 系统轮仍可发；规划/审阅 Query 只读、不领取、不改在跑任务。采用动到在跑任务是 `busy`（6C L13）；本节不加“没有在跑的 Run”条件。
5. **工具表不一致。** 准备和启动用同一个 `queryAnswerShapeOf`/manifest 值；若 Host/Role/read-only 上限在两步之间变化，`finalToolNamesOf` 的结果不同，启动返回 `forbidden`，不进入 Query，也不悄悄退回文字。`manifest.answerShape` 本身被改（只可能改库）也走这条比较，不另写防御。

#### 5.2.8 规划 Query 的注记准入和 owner 来源（C-1 的另一半；PLS-02、PLT-03/04）
**两条准入分开。** `answerShape` 管提交工具（5.2.7），注记准入管 `record_note`；只放宽前者，规划轮写注记仍会被 owner 拒：规划 Query 是普通 Query，`requestRoot === null`，`secretaryNoteAdmission` 直接返回 `{class:'none'}`（`secretary-note.ts:31`-`:44`），`note-service.ts:145` 的 `query_run` 分支走 `resolveSecretaryQueryRun`，后者要求 `requestProfile`/`prepared` 是秘书请求轮（`secretary-query-run.ts:84`）且 `requestRoot !== null`（`:115`），规划轮两条都不满足。

**（1）工具侧：第三个准入类。** `secretaryNoteAdmission` 旁边加纯函数 `planningNoteAdmission`：
```ts
export function planningNoteAdmission(input: {
  answerShape: QueryAnswerShapeV1 | null;  // 冻结的 manifest.answerShape
  effectiveGoalId: string | null;          // manifest.goal?.ref.goalId（准备侧用 readPreparationFacts 的 goal）
  planRef: PlanRevisionRef | null;         // manifest.focusPlan?.ref（准备侧用同一个 facts）
  /** 只在 manifest.answerShape === null 且 execution.kind==='intervention_planning' 时读源消息算；其余形状为 false。 */
  hostSystemPlanningSource: boolean;
}): QueryNoteAdmissionV1;
```
`answerShape` 是 `plan_round`/`plan_review`，或 `answerShape === null` 且 `hostSystemPlanningSource && effectiveGoalId !== null`（`overlap-note:` 的 N 轮；它的 `execution.answerShape` 是 `'text'`，清单按 5.2.7 记成 `null`）时，返回 `{class:'planning', kinds: NOTE_GENERAL_KINDS, withdraw:true, grantedGoalIds: []}`；其余返回 `{class:'none'}`。**注记准入与答案工具形状分开**：N 的答案形状仍是 `text`（清单 `null`），不挂 `submit_plan_round`，但按参谋/秘书职责进 planning 注记准入。`hostSystemPlanningSource` 只在 `answerShape === null && execution.kind === 'intervention_planning'` 时算：用 `messages.readMessage`（准备和启动的依赖里都有这个只读口）读 `execution.sourceMessageRef`，判 `sender.kind==='host' && sender.actor.kind==='system' && message.intent==='action_request'`；读失败/读口缺席按 `unavailable`，不折成 false。其他形状不读消息，不多一次读。`QueryNoteAdmissionV1` 加这一臂。准备/启动两处都按**同一形状值 + 这一条 Host 系统来源**选（准备侧是刚由 `queryAnswerShapeOf` 算出、随后写进 `manifest.answerShape` 的值；启动侧只读清单；与提交工具同一个形状值，不再看 `requestRoot`）：**请求轮仍走原 `secretaryNoteAdmission`**（`secretaryFacts !== null` / 清单的 `request`）；非请求轮走 `planningNoteAdmission`。`query-preparation.ts:337` 今天用 `secretaryFacts===null` 一刀切的地方按这条分派，`query-execution.ts:331` 同样；准备侧 Goal/计划取 `readPreparationFacts` 已给的 `goal`/`focusPlan`，启动侧取冻结的 `manifest.goal`/`manifest.focusPlan`。`finalToolNamesOf` 只把 `noteNames` 的判据从 `class === 'secretary'` 改成 `class !== 'none'`；**邮箱和 `create_member` 仍只认 `class === 'secretary'`**（`tool-group-assembly.ts:641`、`:650`），不借注记准入放开通信或建成员。规划轮只给六种 general 注记，不给 `understanding`/`repair`（N11）。

**（2）owner 侧：一个新的可信 resolver，不改原 resolver。** 新建 `src/core/work-graph/tasks/planning-query-run.ts`（与 `secretary-query-run.ts` 同目录、同读法），导出 `createPlanningQueryRun`，返回 `PlanningQueryRunV1`：
```ts
// 与 SecretaryQueryRunV1 同形，差别只有 duty 和来源字段（不读 requestRoot/request_understanding）。
export type PlanningQueryRunV1 = {
  principal: Extract<CorePrincipal, { kind: 'query_run' }>;
  session: SessionRef;
  duty: 'adviser' | 'secretary';        // 实际读到的 Session duty
  scope: WorkspaceScope;
  round: QueryJobRef;
  run: QueryRunRef;
  effectiveGoalId: string | null;       // manifest.goal?.ref.goalId
  planRef: PlanRevisionRef | null;      // manifest.focusPlan?.ref
  sessionGeneration: number;
  goals: readonly GoalRef[];            // 恒为 []：规划轮不读 request_understanding
};
// NoteQueryRunSourcePort = { resolveNoteQueryRun(ctx): Promise<
//   { status:'ready'; value: { kind:'secretary'; round: SecretaryQueryRunV1 }
//     | { kind:'planning'; round: PlanningQueryRunV1 } } | CoreRejection> }
```
`notes/` 不能 import `queries/`，所以 `notes/note-service.ts` 的 `query_run` 分支改用 `tasks/` 里的薄分派 `resolveNoteQueryRun(ctx)`。**分派复用原 resolver 的 QueryRun→QueryJob→manifest 读取链，不往 QueryRun 复制字段**：按 principal 的 `queryRunRef` 单记录读 QueryRun，再按 `run.queryJobRef` 读 QueryJob 的 `intent.execution`，按 `prepared.bundleRef`/`inputDigest` 读 manifest；`shape = manifest.answerShape`（`'text'`/缺省在清单里是 `null`，其余与 `intent.execution.answerShape` 同值）。`plan_round`/`plan_review` 交规划 resolver；`null` 时再读 `execution.sourceMessageRef`，是 Host 系统 `action_request` 就交规划 resolver（N 轮），否则交**原样未改**的 `resolveSecretaryQueryRun`；`secretary`/`initial` 也交原 resolver。这次读只做分派，不做准入；两个 resolver 各自仍完整校验。`NoteServiceDependencies` 用 `queryRun: NoteQueryRunSourcePort` 取代单一的 `secretaryQueryRun`（组合根 `create-platform.ts:1205`、`:2301` 相应装配）。

规划 resolver 的准入（全部来自存储，不看输入）：
- **可信来源。** 只接 `principal.kind === 'query_run'`；按 `principal.queryRunRef` 单记录读 QueryRun，读失败/解码失败 `unavailable`。`execution.phase === 'entered'`、`execution.prepared !== null`；读 QueryJob 得 `intent.execution.kind === 'intervention_planning'` 且 `sourceMessageRef !== null`；`shape = manifest.answerShape`（`'text'`/缺省是 `null`），且与 `intent.execution.answerShape` 一致。`shape` 是 `plan_round`/`plan_review`，或 `shape === null` 且 `intent.execution.answerShape` 是 `'text'`/缺省、源消息是 Host 系统 `action_request`（N 轮）才算规划来源；否则 `forbidden`。
- **职责。** 按 `execution.sessionRef` 读 Session，再用同一 `deps.duties(session.role, ctx)` 读 duty；`adviser`/`secretary` 放行，`reviewer`/`unknown`/其他 `forbidden`。duty 读失败或非 ready 一律 `unavailable`（沿用 `secretary-query-run.ts:124` 的失败口径，不折成“无身份”）。
- **Goal 和冻结计划。** **Goal 读冻结的 `manifest.goal?.ref.goalId`**（没有 Goal 时 `effectiveGoalId = null`；规划轮一定有 Goal，但一律按清单读，**不读 `prepared.requestEffectiveGoalId`**——那个字段对普通 Query 固定为 null），**`planRef` 读 `manifest.focusPlan?.ref`**（经 `loadQueryManifest` 按 bundleRef/inputDigest 读，owner/字节/digest/形状都校验）；**不要求 `requestRoot`**（规划轮是普通 Query），也不读请求材料和 `request_understanding` 授权：`goals = []`。stage 锚点缺 `planRef`、锚点超出 `effectiveGoalId` 仍由 `note-service.ts:1187`-`:1206` 的现有 scope 拒绝。
- **种类。** 在进 `secretaryNoteScope` 之前，规划臂对 `draft.kind === 'understanding'` 或 `'repair'` 返回 `forbidden`（N11 的六种 general 之外不写）；其余交给同一 scope，不复制第二份范围规则。
- **Caller 的 duty 真实传递。** `note-service.ts:145` 的 `resolveCaller` 改成走 `deps.queryRun.resolveNoteQueryRun(ctx)`，把返回值里的 `duty`、`effectiveGoalId`、`planRef`、`session` 原样放进 `Caller`，**不再硬编码 `duty:'secretary'`**：`PlanningQueryRunV1` 的 duty 是实际读到的 `'adviser' \| 'secretary'`，秘书请求轮仍是 `'secretary'`。`NoteQueryRunSourcePort` 的返回值是两种 round 的联合，按 resolver 的标签区分；`resolveCaller` 不猜。`noteWriteAuthority`/`secretaryNoteScope` 的现有判据不变（规划臂已在进 scope 前拒 `understanding`/`repair`）。
- **不连带放开。** 秘书请求轮仍走原 `resolveSecretaryQueryRun`，它的返回值、错误码和调用方（发信/邮箱）都不变；规划 resolver 只被注记 owner 使用，不发信、不建成员、不开邮箱。原 resolver 不删、不改语义、不接规划 Query。

**（3）与 `planreview:` 的关系。** 审阅轮也是 `intervention_planning` Query，`manifest.answerShape==='plan_review'`，所以审阅者所在的线**如果 duty 是 adviser/secretary** 也能写注记；`reviewer` duty 仍不能写（审阅只读，`noteWriteAuthority`/duty 判据原样）。这条不放宽审阅者的提交工具，也不改审阅答案。

**（4）测试口径。** A-06 之外补 G-05 的注记变体：规划轮经公开 `notes/write` 写一条 `convention` 成功；同轮写 `understanding` 被 `forbidden`；秘书请求轮写注记仍成功；同一 Query 的 `messages/send` 仍不带邮箱工具。**N 轮变体**：参谋/秘书收到 `overlap-note:`（Host 系统 `action_request`、`answerShape='text'`）后，工具表有 `record_note`、**没有** `submit_plan_round`，经公开 `notes/write` 写一条 `convention` 成功；同一 Query 的 `messages/send` 仍不带邮箱工具。`notes/write` 与 `messages/*` 的入口见 15.2。


---
### 5.3 任务书放在哪（设计 `:147`-`:196`）
#### 5.3.1 A 形式的完整字段表
用户已定 A（设计 `:149`、`:162`、D7 `:591`）：任务书就是细化提案，不另建文档体系。字段表：

| 任务书内容 | 计划记录的字段 | 现有/新增 | 说明 |
|---|---|---|---|
| 段标题、这一段的总说明、顺序、取舍理由 | `PlanStage.title` / `PlanStage.description`（`src/contracts/plan.ts:148`-`:152`） | 现有 | `description` 只给人和审阅者看；**不进 `{{task}}`**（5.3.4） |
| 任务标题 | `RuntimeTask.title`（`plan.ts:37`） | 现有 | |
| 要改哪些文件、模块范围 | `RuntimeTask.scope`（`goal` / `stage` / `module`，`plan.ts:8`-`:12`）+ `instruction` 里的路径 | 现有 | 模块任务用 `{ kind: 'module', stageId, moduleRef }`；文件清单写 `instruction` |
| 执行意图 | `RuntimeTask.executionIntent`（`plan.ts:56`） | 现有 | 这一段的任务是 `request_execution`；后续段占位是 `plan_only` |
| 要改什么、先看什么、怎么做、伪代码、复用什么、哪些错误不会发生、要点名的记忆、接口约定名字、执行必需的共用内容 | `assignments[].instruction`（`src/contracts/initial-planning.ts:8`-`:12`，`PlanTaskAssignment`） | 现有 | 任务书正文**只有一个家**：每个任务的 `instruction`。接口约定的正文在模块注记（下），这里只写名字 |
| 接口约定 | 模块锚点上的 `record_note`：`kind: 'convention'`、话题“接口约定”（现有注记种类，`src/contracts/note.ts`） | 现有 | 决定 89；`instruction` 写“用模块 X 上的接口约定”；平台不把注记正文抄进任务书 |
| 要看哪些记忆 | `{{notes}}` 按模块自动带上；要点名的写进 `instruction` | 现有 | 不新增字段 |
| 验收 | `AcceptanceObligation` + `verificationRequirements`（`plan.ts:160`-`:181`） | 现有 | 检查覆盖仍由任务门/完成策略判；本节不改 |
| 依赖 | `executionDag.dependsOn`（`plan.ts:183`-`:190`） | 现有 | 真实版本化输入/输出依赖；`taskRelations` 只是建议 |
| 替代关系 | `RuntimeTask.replacedByTaskId`（`plan.ts:63`） | 现有 | 被替代任务指向同义务/同验收的接手任务；`plan-machine.ts:695` 的守卫要求 `reason.affectedTaskIds` 同时列出被改的 traced 任务 |
| 精确输入 | `inputRequirements`（`PlanRevisionDraft`，`plan.ts:194`、`:223`） | 现有 | `requirementId`/`consumerTaskId`/`kind:'artifact'`/`artifactRef`；和依赖分开，不是派工前置 |

**替代流程的提交通道。** 规划轮要表达“用新任务替代旧任务”时，模型在 `submit_plan_round` 的同一个表单里填：任务上的 `replacedByTaskId`（旧任务 `disposition:'superseded'` 时指向接手任务）、plan 顶层的 `inputRequirements`、根的 `reason{text, affectedTaskIds}`。这三样都是已有领域字段/类型，不新造记录、不新造影响清单；`buildAnswerText` 不丢它们，`planOnIdleLine` 把 `reason` 交给 `proposePlan`（补 `sources: []`），候选的 `draft` 里保留任务和输入，`plan-machine.ts:695` 用 `affectedTaskIds` 做既有守卫。字段缺省就是空/未列，平台不猜语义。
| 预估改动行数 | `RuntimeTask.estimatedLines` | **新增可选** | 见 5.3.2；行数 2 倍线读它 |
| 任务档位 | `RuntimeTask.sizeClass` | **新增可选** | `small` / `medium` / `large` / `explore`；占位也带；没有档位只累计、不提醒；见 10.3 |
| 这一段用到的共用内容 | 由模型展开写进每个需要它的任务的 `instruction` | 现有字段 | 平台不合成、不改写；重复由模型负责（设计 `:609` 已说明会有重复） |

**没有别的字段。** 阶段说明、顺序、取舍、复用什么、哪些错误不会发生，全部落在上表的字段里，不新增 `taskBook`、`description` 之外的文档字段，也不新记录种类。设计 `:179`“除预估行数外不加结构字段”。

**规划轮的提交工具就按这张表填。** `submit_plan_round` 的 plan 子表单和 `submit_initial_plan` 共用 `planSchema`（`answer-tools.ts:257`），字段就是上表这些：`stages`/`tasks`/`assignments`/`obligations`/`taskHierarchy`/`executionDag`/`taskRelations`/`inputRequirements`，任务里带 `estimatedLines`（5.3.2）、可选的 `sizeClass` 和已有的 `replacedByTaskId`。工具不要求 `setup`（规划轮不是首次安装），也不收 `goalCardDrafts`/`planDraftIndex`（规划轮有 Goal）；平台只填 `schemaVersion:2`、`kind:'plan'|'needs_decision'`、`plan.schemaVersion:2` 和 `tasks[].phase:'pending'`。**替代流程的字段走同一个表单**：`replacedByTaskId` 和 `inputRequirements` 是已有领域字段，原样从表单进 v2 plan；根上的 `reason{text,affectedTaskIds?}` 原样写进答案、由 `planOnIdleLine` 交给 `proposePlan`，不另建影响记录。写文字退路仍是同一个 v2 形状，目标循环按同一解析器读。
#### 5.3.2 `estimatedLines`
```ts
// src/contracts/plan.ts 的 RuntimeTask 加：
/** 任务书里模型给的改动行数预估；缺省 = 未知（不是 0）。正整数安全整数。 */
estimatedLines?: number;
```
- **格式：** 出现时必须是非空、正整数、安全整数（`Number.isSafeInteger` 且 ≥ 1）。校验加在持久 codec 的 `runtimeTaskIssues`（`src/core/work-graph/persistence/plan-record-codecs.ts:328`-`:345`）：`estimatedLines must be a positive safe integer when present`。这是格式校验，不是语义判断；计划校验器不加新规则；**缺省：** 不写 = 未知。D 的 2 倍线只在有预估时比较；不能把缺省当 0（设计 `:284` 的“超 2 倍”没有基准时不触发）；**冻结：** 随 `RuntimeTask` 进入 `FrozenTaskDefinition`（`plan-task-basis.ts:62`-`:67`），已执行任务不能改；要改就是替代任务（5.1.1）；**写的人：** 细化提案的模型；审阅者看它合不合理；平台在行数 2 倍线读它；**行数 2 倍线是软线：** 已确认的 `changedLines.added + deleted > 2 × estimatedLines` 时，开参谋轮并告诉人；任务不停。没有预估、读数不完整时不触发，不拿未知或 0 当超线（v4 §10；7.1、7.2）；**档位不是行数：** `sizeClass` 判增长量，`estimatedLines` 判行数；两者各自触发，不互相替代；**`sizeClass` 的格式：** 出现时必须是 `small` | `medium` | `large` | `explore`；持久 codec 在 `runtimeTaskIssues` 同处拒其他值；随 `RuntimeTask` 冻结。缺省 = 未分档，只累计、不提醒。
#### 5.3.3 怎么展开到各任务的 `instruction`
- **模型展开，平台不展开。** 规划答案里，每个 `request_execution` 任务的 `assignment.instruction` 必须能独立执行：执行必需的共用内容（共同的约定、共同的输入、共同的验收口径）由模型写进每一个需要它的任务的 `instruction`。`mergeStageRefinement` 原样复制 `instruction`，不拼段说明、不拼注记、不去重；**`{{task}}` 拿到什么。** `context-fact-text.ts:231` 的 `taskPayload` 现有行：任务标题、`context.task.instruction` + `assignment.instruction` 全文（`:258`）、plan/workspace/definitionPlan、阶段标题 + stageId（`:262`）、模块、requirement/disposition/phase、义务、验收、上游/下游、失败说明。**不改这个函数**；`instruction` 进 `{{task}}` 已经是全文，放宽答案上限后长任务书自然到执行者；**阶段说明不进 `{{task}}`。** 阶段行只拼 `stage.title` 和 `stage.stageId`，没有 `description`（`:262`）。保持原样：`PlanStage.description` 不受执行定义冻结保护（第 2 节第 18 行），进了 `{{task}}` 会让同一任务的后续 Run 拿到不同内容，冻结就不成立（设计 `:186`）。执行必需的内容写进 `instruction`，不写进段说明；**Agent 查找。** 现有 `find` 已把任务说明算在内（`graph-context-reader.ts:1869` 一带的 `taskCardOf(... assignment?.instruction ...)`）；不改，不另建任务书查询。
#### 5.3.4 导出 Markdown
**为什么是导出物。** 设计 `:190`-`:195`：源头是计划版本，文件是导出物，丢了可重建；目录在工作区外，不进 Git，不动工作区版本，所以不影响检查和版本核对。

**触发和失败落点见 6.4.3。** 本节只定写哪、文件名、渲染和失败返回：每个涉及的 `stageId` 一份；采用后和转卡时由 Host 的 `adoptAndExport` 调；失败返回 `failed`，进这次采用的“请知悉”或卡，不挡采用、不重试、不抛错（C-9/N12；文字和去重在 6.4.3）。

**类型与函数（新建；建议纯渲染 `src/core/work-graph/views/taskbook-markdown.ts`，文件写入 `src/app/taskbook-export.ts`）：**
```ts
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../../contracts/plan.js';

/** 渲染一段的任务书；段不存在 → null（调用方跳过，不是用户错误）。纯函数，只读计划。 */
export function renderTaskbookMarkdown(
  plan: PlanRevisionDraft | PlanRevisionSnapshot, stageId: string): string | null;

/** 相对 `<settingsDirectory>/taskbooks` 的路径：
 *  `<projectId>/<workspaceId>/<goalId>/goal-<goalId>__plan-<planId>__stage-<stageId>__rev-<planRevision>.md`
 *  planId 是这一版计划的现有唯一 id（同 basedOn 的多个候选也各不相同）；同一候选重复导出仍覆盖自己的文件。
 *  每个 id 用 encodeURIComponent 保持单段；不读写工作区。 */
export function taskbookRelativePath(input: {
  projectId: string; workspaceId: string; goalId: string; stageId: string;
  planId: string; planRevision: number }): string;

export type TaskbookExportV1 =
  | { status: 'written'; path: string }
  | { status: 'skipped'; reason: 'no_settings_directory' }
  | { status: 'failed'; reason: string };

/** 写一份；目录不存在就建；任何 fs 失败都返回 failed，不抛。 */
export async function exportTaskbook(input: {
  root: string | null;                 // <settingsDirectory>/taskbooks；null = settings 未启用
  plan: PlanRevisionDraft | PlanRevisionSnapshot;
  stageId: string;
  scope: { projectId: string; workspaceId: string; goalId: string };
}): Promise<TaskbookExportV1>;

/** Host 包装：每个 stage 一份；写前做导出根的工作区隔离检查（下面“目录”段），
 *  命中就整批 failed、一份都不写；没有 settingsDirectory 整批 skipped。 */
export async function exportTaskbooksForPlan(input: {
  root: string | null;
  workspaceRoots: readonly string[];   // Host 已注册的每个工作区根
  plan: PlanRevisionDraft | PlanRevisionSnapshot;
  scope: { projectId: string; workspaceId: string; goalId: string };
}): Promise<TaskbookExportV1[]>;
```
- **目录：** `<settingsDirectory>/taskbooks`。`settingsDirectory` 是 Host 现有设置目录（`host.ts:467`-`:469`；默认在 SQLite 账本旁，`host.ts:468`；memory 且没有显式目录时没有）。**只凭 prompt 目录通过不等于导出根安全**：Host 今天只把每个工作区根和 `promptsRoot` 做一次实路径比较（`host.ts:317`-`:323` 的 `assertRootOutsidePrompts`，用 `isPathWithin`），`settingsDirectory` 本身没有和工作区根比过；工作区根取 `<settingsDirectory>/taskbooks` 时这条检查照样通过，导出会直接写进工作区。所以 `exportTaskbooksForPlan` 在写任何文件之前，对导出根和**每个**工作区根做实路径隔离检查（工作区根取 Host 已注册的 `workspace.root` 的实路径）：先取 `realpath(settingsDirectory)`（Host 启动时已建出它和 `prompts`）拼上 `taskbooks` 段，用同一个 `isPathWithin(workspaceRootReal, taskbookRootReal)`（`src/app/prompt-packs.ts:32`）判；**命中（导出根等于或落在任一工作区根内）就整批返回 `failed`**，reason 写 `the taskbook root is inside the workspace <root>`，**连目录都不建**，一份都不写。通过后才 `mkdir` 导出根、再取一次 `realpath` 复核（防链接变化），这次取不到实路径也按 `failed`，不当成未配置。`skipped` 只留给没有 `settingsDirectory`（memory 测试），不新造结果码。没有 `settingsDirectory` 的 Host 返回 `skipped`，采用照常；**多工作区：** 路径包含 `projectId/workspaceId`，同项目多工作区不互相覆盖；目标本身属于一个工作区（`goal.workspaceRef`），一个目标一个目录；**文件名：** `goal-<goalId>__plan-<planId>__stage-<stageId>__rev-<planRevision>.md`。`planId` 是现有唯一 id，必须进路径：同一 `basedOn` 的多个候选有相同的目标、阶段和目标 `planRevision`，只靠这三样会互相覆盖（`plan-machine.ts:1342` 要求目标 `planId` 不同；`plan.ts:203` 的 `planId` 正在 draft 上）。同一候选重复导出仍写回自己的路径、覆盖自己的文件；不加索引、不加记录、不建“任务书列表”。**内容：** 段标题 + `description`；每个任务：标题、taskId、范围、`estimatedLines`、依赖、验收、`instruction` 全文。就是“E3 任务详情显示同样的内容”（设计 `:194`）的同一份渲染，E3 可复用 `renderTaskbookMarkdown` 或它的行渲染；**失败：** `exportTaskbook` 捕获 fs 错误返回 `failed`；调用方把 `path`（`written` 时是绝对路径，`join(root, taskbookRelativePath(...))`）交给“请知悉”/卡的投影；投影按文件现状（`exportBooks`，6.4.3）写“已导出/未写出/不完整”，不把 fs 原因落记录，也不改变采用结果；**不做的：** 不写 manifest/索引文件，不建“任务书列表”，不把导出物当 Artifact，不做原子临时文件/回滚（设计没写；重跑同一版本会覆盖）。见清单 B。
#### 5.3.5 规划轮和审阅轮的提交工具与正文长度
**边界。** 答案工具的形状、准入和工具表由 C-1/AT 的 5.2.7、6.3.3 定；本节只定**正文/消息/问题的字节上限、token 上限、按什么选、谁传、超界走哪个现有结果**。选长度的唯一依据是冻结的 `answerShape`（`secretary|initial|plan_round|plan_review`），不是 `config.kind`/`manifest.request.executionKind`。**只有一样要 256 KiB：规划答案本身**；消息和问题不跟着放宽，回复一律是短结论。

**定值表（一处写全）。**

| 正文/消息 | 上限 | 谁判（语义所在） | 超界走哪个现有结果 |
|---|---|---|---|
| `submit_plan_round` 拼出的 `answer.answer`（规划轮，`plan`/`questions` 两支） | **256 KiB** | `answer-tools.ts` 的提交工具，按 `answerShape==='plan_round'` | 工具 `capacity`；模型可在同一轮再调；不产生答案 |
| 规划轮的纯文字退路（没有接受提交时的最终文本） | **16 KiB** | `query-observation.ts`，按 `answerShape==='plan_round'` | `too_long` → `gap`；不产生答案（PLS-34 的口径） |
| `submit_secretary_answer` | **16 KiB** | 工具，`answerShape==='secretary'`；请求轮观察器同一上限 | 工具 `capacity`；观察器 `too_long` → `failed` + `answerCheck.detail='too_long'` |
| `submit_initial_plan` / `submit_initial_questions` | **16 KiB** | 工具，`answerShape==='initial'` | 工具 `capacity` |
| `submit_plan_review`（审阅结论） | **16 KiB** | 工具，`answerShape==='plan_review'`；文字退路由 `parsePlanReviewAnswer`（6.3.3） | 工具 `capacity`；文字退路 `too_long`→`gap`/无合法结论；不产生合法结论 |
| 普通 Session 消息（`messages/send`、`respond`、用户消息、决定正文） | **16 KiB** | mailbox 发送/存储 + 消息体 codec | `capacity`；读回损坏走现有 body 不可读原因 |
| Host 系统轮消息（`refine:`/`deviation:`/`planreview:`/`planfix:`/`planresume:`，以及任何 `isSystemRoundSender(sender)` 的发送） | **64 KiB** | mailbox 发送/存储 + 消息体 codec，按 `isSystemRoundSender(sender)` 选（`sender`，不看 `followupOf`） | `capacity`；目标登记保留，下一轮再发（不截断、不分片） |
| 普通 Query 的 `question` | **16 KiB** | `queryTextProblem`（无 kind） | `invalid`（`intent.question must be at most 16 KiB of UTF-8` 一类） |
| `intervention_planning` 规划 Query 的 `question`（含 refine/deviation/planreview/planfix/planresume） | **64 KiB** | 同一个 `queryTextProblem`，按 `execution.kind` 选 | `invalid`（reason 写 64 KiB） |
| 普通 Query 的答案（`semantic_query`、非规划普通 Query） | **16 KiB** | 观察器，`answerShape===null` | `too_long` → `gap` |
| 规划 Query 的答案（`intervention_planning`） | **256 KiB** | 观察器，`answerShape==='plan_round'`；只有 `submit_plan_round` 的答案正文能到这里 | `too_long` → `gap`；不产生答案 |
| 持久层答案正文 `answer.answer` | **256 KiB** | `query-record-codecs.ts` 的 `answerIssues` | 记录校验 issue（`answer.answer exceeds 256 KiB`）；不是新结果码 |

**所有回复都是短结论，按冻结形状派生（PLS-14/16、PLT-12）。** 系统轮的回复 R 和执行者对原消息的回复 M 走同一个 16 KiB 普通消息上限，**不复制计划全文、不复制审阅 JSON**；正文按发起回复的 Query 的冻结 `answerShape` 从已存答案派生，只有这一处正本 `planningReplyTextOf({ shape, answerText, queryJobId })`（纯函数，放 `src/contracts/plan-round.ts`；解析器复用 `parseInitialPlanningResponseV2`/`parsePlanReviewAnswer`）：

| 冻结形状 | 回复正文 | 依据 |
|---|---|---|
| `plan_round`（`plan`/`questions` 两支） | 规划答案的 `answer.summary`（接受时已保证非空、≤16 KiB UTF-8） | 5.2.7 的 `answerProblems` |
| `plan_review` | `pass` → `审阅通过`；`fix` → `审阅要求返修：<n> 条意见，见 Query <queryJobId>`（`n = findings.length`） | 6.3.3 的解析结果 |
| 形状是 `plan_round` 但走文字退路 | 已保存、非空且 ≤16 KiB 的退路文本**保留原文**作为回复；退路文本能解析成合法 `plan`/`needs_decision` 答案时才取 `summary` | 5.2.7（3）、PLS-34 |
| 形状是 `plan_review` 但走文字退路 | 按 `parsePlanReviewAnswer` 取 `verdict`，套 `审阅通过`/`审阅要求返修：<n> 条意见，见 Query <queryJobId>`；解析不出 = `terminal_invalid`，**不造回复**、转候选卡 | 6.3.3 |
| `text`（`overlap-note:` 的 N 轮、普通规划文字退路、普通 Query） | 原有 `formalAnswerOf` 读到的最终文本，≤16 KiB | 原有退路 |

普通咨询答案（`secretary`/`initial`）的回复不变。完整计划留在 `QueryJobAnswer.answer` 和候选里，读口是 `queries/read`/`queries/answer` 与 `plans/proposal`；消息只告诉对方“改了什么/结论是什么、去哪读全文”。**答案接受 ≠ 闭环成功**：工具把 256 KiB 答案写进持久层，只证明答案存得下；消息回复如果跟着复制全文，会撞消息上限，消息结束不了、执行者永远等不到收尾。所以关联路径（7.3.3、§6.4）只按上表派生回复，不再承诺无条件复制全文。

**envelope 段。** 256 KiB 判的是 `answer.answer` 的字节，它只存答案记录，不进消息体；Host 系统轮消息正文上限 64 KiB，回复 16 KiB，JSON envelope 加头部后仍在 64 KiB 内有富余，不会先撞 `artifact.ts:6` 的 `ARTIFACT_MAX_SIZE_BYTES`。**不碰 Artifact、manifest 和材料存储的上限**，也不为消息/答案再定义一套编码后的容器上限。边界测试按消息正文的 64 KiB 和答案正文的 256 KiB 分别算，不把两个数混成一个。

**为什么规划答案要 131072 token，以及唯一的输出预留公式（PLS-13）。** 256 KiB = 262,144 字节；中文/JSON 按约 2 bytes/token 估正好 131,072 token。**规划轮的输出预留只有一个公式：`planningOutputReserveTokens(contextWindowTokens) = min(131_072, floor(contextWindowTokens / 2))`**（纯函数放 `src/contracts/runtime-budget.ts`，请求侧和 Host 侧都调它，正本只此一处）。规划 Query 的 `runtimeBudget.perResponseTokens` 就是这个函数的返回值；普通 profile 仍是 **16384**（`DEFAULT_RUNTIME_BUDGET.perResponseTokens=4096`；`LOCAL_WORKBENCH_BUDGET` 抬到 16384，`runtime-configuration.ts:122`）。Host 的上限按同一个函数、同一个窗口放开（`host.ts` 的 `consumeIdle` 按 `sessionRole` 选 profile，`intervention.ts:201`-`:204` 冻结进 `execution.runtimeBudget`，`query-preparation.ts:118` 的 `tightenRuntimeBudget` 取 `Math.min(requested, host)`），不能只改请求侧。**不改窗口本身**：窗口只决定预留的大小——本地 deepseek 的 `1_000_000`（`host.ts:340`-`:344` 的 `localWorkbenchBudget`）得 131,072，默认窗口 128,000（`runtime-budget.ts:19`）得 64,000；两者都是合法规划窗口。`fits` 是 `输入计量 + 输出预留 <= contextWindowTokens`（`model-budget.ts:100`）；输入加预留装不下时在发请求前抛 `ContextCapacityExceeded`（`:128`），这一轮按现有失败收尾，**不把截断的规划请求发给模型**，不新增处理。A-05 用两个窗口各证一次请求确实到达模型并有真实 usage/答案（1,000,000 → 131,072；128,000 → 64,000），不是只观察配置值。`MAX_RESPONSE_TOKENS=393216`（`runtime-budget.ts:23`）容得下两种预留，不改总上限。


**逐处代码点。**

1. **消息正文：`message-record-codecs.ts:124`。** `SESSION_MESSAGE_MAX_TEXT_BYTES=16 KiB` 保留；新增 `SYSTEM_ROUND_MESSAGE_MAX_TEXT_BYTES=64 KiB`、`isSystemRoundSender(sender)`（`sender.kind==='host' && sender.actor.kind==='system' && sender.actor.id===SYSTEM_ROUND_ACTOR.id`，即 N7 的 `host:plan-round`；`workflow:auto-rework` 等自动化身份不算）和**唯一长度正本** `sessionMessageTextBound({ sender, part, original })`：`part==='message'` 按本条 `sender` 选 16/64 KiB；`part==='response'` **一律 16 KiB**，不看原消息是不是系统轮。`original` 只供消费分支核对“回复的是哪条消息”，不改长度。`mailbox-service.ts:762` 的 `normalizeText` 收 `maxBytes`；`sendMessage`（`:2656`）按本条 `owned.principal` 选；`sendUserMessage`（`:4380`）、`respond`（`:3534`）固定 16 KiB；`storeBody`（`:5084`）用本条 `sender` 选。`readQueryAnswerFacts`（`:2287`）的 `bodyBounded` 用 `part` 区分：Query 的来源消息是 `message` 部分（按该消息 `sender`，系统轮可 64 KiB），回复是 `response` 部分（固定 16 KiB）；`message-body-envelope.ts:217` 同一判据（`part==='response'` 固定 16，`part==='message'` 按本条 sender）。**发送和读取用同一个 `sessionMessageTextBound`，不按 `followupOf` 判**（PLS-15）。失败：发送/存储超界 `capacity`；读回超界现有“stored message body text is invalid”；回复超界 `guard_failed`/`capacity`，消息不提交。
2. **Query 问题：`query-job-service.ts:84`-`:96`。** `MAX_QUESTION_BYTES=16 KiB` 保留；新增 `PLANNING_MAX_QUESTION_BYTES=64 KiB`。`queryTextProblem(text, executionKind?)`：`intervention_planning` 64 KiB，其余（含缺省）16 KiB。`submitQueryJob` 在 `:263` 传；`intent.execution` 今天在 `:291` 读，把只读 `kind` 的窄读提到 `:263` 前。`request-service.ts:355`/`:388` 是人入口，保持 16 KiB。失败 `invalid`，reason 用选中的上限。
3. **答案观察：`query-observation.ts:50`、`:156`-`:166`、`:187`-`:205`、`:498`-`:505`。** `MAX_ANSWER_BYTES=16 KiB` 保留；新增 `PLANNING_MAX_ANSWER_BYTES=256 KiB`。**两条路分开取 bound**：已接受的工具答案（`:498` 另一支）按 `manifest.answerShape`，`plan_round` 用 256 KiB，`plan_review`/`secretary`/`initial`/`null` 用 16 KiB；**纯文字退路 `extractAnswer` 对所有形状都用 16 KiB**（规划轮的退路也按 16 KiB 判，≤16 KiB 的退路原文保留为回复，PLS-34/PLT-12）。不再用 `isRequestRound(job)`。工具答案拼出文本超 256 KiB 折成 `too_long`。失败：普通 Query 和规划轮的文字退路 `too_long` → `gap`；请求轮 `failed` + `answerCheck.detail='too_long'`；16 KiB 请求轮的 reason 仍是现有的 `the secretary answer is over the 16 KiB answer bound`。
4. **持久答案：`query-record-codecs.ts:578`。** `16 KiB` 改成 `256 KiB`，issue 文字 `answer.answer exceeds 256 KiB`。持久层不知道 `answerShape`，只保证规划答案存得下；普通答案 16 KiB 的语义在观察器/工具/审阅解析器上已判过。`bodyRef`、digest、`answer.answer` 全文相等的校验（`initial-plan-answer.ts:266`、`:383`）不看字节上限。
5. **提交工具：`answer-tools.ts:571` 一带。** 改成按 **`answerShape` + 工具名** 选 `answerBoundBytes(shape, call.name)`：
   - `submit_plan_round` → **256 KiB**（`shape==='plan_round'`）；
   - `submit_secretary_answer` → 16 KiB（`secretary`）；
   - `submit_initial_plan`/`submit_initial_questions` → 16 KiB（`initial`）；
   - `submit_plan_review` → 16 KiB（`plan_review`）。

   `createAnswerTools` 从 `manifest.answerShape` 取形状，不再要求 `manifest.request !== null`，也不读 `config.kind`/`executionKind`。失败：`rejectedResult(callId,{status:'rejected',code:'capacity',reason:'the answer over the <n> answer bound; shorten the body or the plan'})`；不记 accepted，屏障不结束，模型同轮改小再交。`answer-tools.ts:611` 的 `outputLimitBytes:64 KiB` 是工具**返回**上限，不改、不拿它当答案上限。
6. **规划 Query 的 profile token 和窗口：`runtime-configuration.ts:122`、`host.ts:340`-`:344`、`model-budget.ts:100`。** 默认 `LOCAL_WORKBENCH_BUDGET.perResponseTokens=16384` 不改；规划轮 profile 的 `perResponseTokens = planningOutputReserveTokens(contextWindowTokens)`（唯一公式，`src/contracts/runtime-budget.ts`），用这条线自己的实际模型窗口算：本地 `deepseek` 的 `1_000_000`（`:340`-`:344`）→ 131,072，默认 `128_000` → 64,000。Host 解析到的该线配置用**同一个函数和同一个窗口**（`host.ts` 的 `consumeIdle` 按 `sessionRole` 选 profile，`intervention.ts:201`-`:204` 冻结进 `execution.runtimeBudget`，`query-preparation.ts:118` 的 `tightenRuntimeBudget` 取 `Math.min(requested, host)`）；只改请求侧不够。**不改 `contextWindowTokens`**：窗口只决定预留，输入加预留装不下时 `fits`（`model-budget.ts:100`）为假，在发请求前抛 `ContextCapacityExceeded`（`:128`），这一轮按现有失败收尾，**不发截断的请求**。普通 Query 的 profile 仍 16384。超过 `MAX_RESPONSE_TOKENS` 是配置校验，不是本轮结果。
7. **审阅轮的 16 KiB 在哪判。** 审阅轮是 `intervention_planning` Query，**question** 走 64 KiB；**answer** 不是规划答案：`submit_plan_review` 固定 16 KiB，文字退路也按 16 KiB 判（超界 `too_long`→`gap`）。观察器的 256 KiB 只可能来自 `submit_plan_round`，审阅形状不会走到；超界或没有合法结论按“本轮没有可用审阅结论”处理（6.1.3 的 `terminal_invalid`），不采用。审阅轮 question 64/答案 16 的差异见 §22 G-D7。
8. **`planresume:` 的正文只带引用（G-D1 的落法，PLT-13）。** 消息正文和 Query 的 `question` = 首行请求号 + 一行 `originalQueryRef: <canonicalJson(originalMessageRef)>` + 固定请求语；**不带原问题全文、不带逐卡答复正文、不带 256 KiB 的规划答案**。原问题取原规划 Query 的 `question`（按引用读），逐卡答复在准备阶段装配：准备读 `originalQueryRef` → `interventionPlanningQueryRefs(originalMessageRef)` 得原 QueryJob/QueryRun → `readQueryExecution` 读原 Job 的 `intent.question` 和 `answerRefs.at(-1)` → `readQueryAnswer` 读原 `needs_decision` 答案的 `questions` → 用现有问题 reader `readPlanningQuestions`（`src/core/work-graph/tasks/planning-question-reader.ts:176`、`:201`，与 6.1.6/3b 同一读；`goalRef` 用本轮冻结的 `manifest.goal.ref`）按页读到含该 `answerRef` 的卡（或读完），按 `questionIndex` 选中对应卡，把它的**完整 `card.source`**（`kind:'planning_question'`，`pins`/`goalBases` 由问题 reader 按原答案事实构造，准备阶段不自行拼 source、不重读、不补）原样传给现有 `decisionMessages.readDecisionAnswer({source: card.source})` 取已存答复正文；问题 reader 缺席/`not_available` 按 `unsupported`，读完仍没有对应卡按 `not_found`，都不拿空卡当已答 → 按卡顺序把“原问题 + 第 i 问/答”追加进准备输入（`preparedInput += savedAnswers`）。读失败（原 Job/答案/卡答复）原样 `unavailable`/`not_found`，不拿空答复当已答；`queryExecution`/`decisionMessages` 读口缺席按 `unsupported`。**64 KiB 只约束保存的请求正文**（这一小段头 + 引用），不约束装配后的模型输入；装配后的输入装不下走现有容量出口（`ContextCapacityExceeded`），不截断、不分片、不加 ref 字段。消息发送超界仍 `capacity`，Query 提交超界仍 `invalid`；它们只由这一小段正文决定，与卡数、答复长短、原问题大小无关。**重启**：原 Query、原答案和逐卡答复都在持久层，未准备的 `planresume:` Query 由同一引用重装配；已准备的用清单里冻结的输入，不重读、不改正文、不新建记录。


**不做的。** 不新造错误码（只用 `capacity`、`invalid`、`too_long`、`gap`、`failed`）；不改普通消息/普通问题/秘书答案/审阅答案/所有回复的 16 KiB；不把持久 codec 的 256 KiB 当消息或回复许可；不给 Artifact、manifest、材料存储加新上限；不在观察器解析请求号/消息前缀选长度；不用 `followupOf` 判长度；不复制计划全文进消息；不改 `outputLimitBytes`、`MAX_RESPONSE_TOKENS`、`SESSION_MESSAGE_MAX_TEXT_BYTES` 的普通值；不重写 5.2/6.3 的工具形状和准入。
### 5.4 参谋技能（设计 `:197`-`:199`）
改 `resources/prompts/platform/templates/skill-platform-adviser.txt`（现有；`contracts/prompts/platform-pack.generated.ts` 的 `skill-platform-adviser` 是它的生成物，重新生成，不手改生成物）。写进技能：

1. **任务边界（v3 第 6 节末）。** 一个任务一件事；不把两个不相干的改动塞进一条 `instruction`；任务的 `scope` 和它改的文件一致。
2. **任务书模板。** 固定七段：范围（改哪些文件/模块）、先看什么（记忆、来源、图）、怎么做（步骤；难点才写伪代码，R42）、接口（名字 + “用模块锚点上的接口约定”）、验收（义务/检查）、不做什么（边界、不会发生的错误清单式的“不要为 X 加防御”）、复用什么（`src/...:行` + 名字，或“没有现成，搜过什么”）。用户 11-01 的 R46/R207；设计 `:179` 的“范围、先看什么、怎么做、接口、验收、不做什么、复用什么”。
3. **档位。** 用 v3 §4.3 的四档（`small` 1M/2M、`medium` 2.5M/5M、`large` 4M/8M、`explore` 4M/8M；前是提醒线，后是 2 倍线），按上下文增长量判；占位任务也要带档位。档位怎么影响任务粒度由参谋按审阅意见收敛。预估行数 `estimatedLines` 按设计 `:176`/D3 写，不确定时说明不确定，不编一个精确数；行数超 2 倍是软线，开参谋轮 + 告诉人，不停任务（v4 §10）。
4. **接口约定。** 写模块锚点上的 `convention`，话题固定“接口约定”（`skill-platform-work.txt` 的现有格式）；同一模块同时有几个任务时，指明唯一负责的任务和共享件的名字/接口/文件；改约定前先读现行、用 `replaces` 取代。规划轮现在能写注记（5.3.5），所以细化时就直接记，不写“之后有权写的那一轮落实”。
5. **依赖和并行。** 用 `executionDag` 写真实版本化输入/输出依赖；`taskRelations` 只写建议；重叠模块先定约定再派工（第 8 节）；不在计划里写“按顺序”来代替真实依赖。
6. **只输出这一段。** 细化请求只写这一段的 stages/tasks/assignments/obligations/依赖；不重抄别的段；不删任务（用 disposition）；复用占位任务的 taskId 或新增并标 superseded。
7. **第 7 节的三种答复。** 执行者在等：改计划/回答/问人；系统软超线（`growth` 或 `lines`）：改计划/回答（判断写“请知悉”）/问人；已有停因（`budget`/`stop`）：改计划/问人，不写“回答能解除停因”。正文由 D 的 7.3 写；本节只把“答复的格式和后果”放进技能，让参谋知道什么时候写候选、什么时候回复原消息、什么时候出卡。
8. **执行者上报的收件人。** 执行者用现有发信找它认到的参谋线（技能里用 `find_related_sessions` 认人），带 `waitAfterSend: true`；执行者不是 Host，不能调 `resolveDutyRecipient`。平台侧的系统轮和通知才按 L35（7D2 前 `resolveDutyRecipient`）。见 D-V2。
9. **不写全的后果。** 审阅轮会看任务书够不够让执行者不猜（C 的 6.3）；平台不查（设计 `:179`）。

**输入模板。** `intervention-planning.txt`（现有，`{{prelude}}{{role}}{{goal}}{{plan}}{{message}}`）不改结构；`initial-planning-answer` 指南（`resources/prompts/platform/templates/initial-planning-answer.txt`）加两条：`estimatedLines` 字段；当请求说“只这一段”时只输出这一段、平台会合并。指南同时服务初始规划和规划轮，所以两句都写成条件句。审阅的输入模板由 C 的新模板负责。

---
### 5.5 走法：真实调用顺序
#### 5.5.1 冷启动（目标已采用第一版）
1. 人采用第一版计划（6C/初始化；不在本节）。计划 = 骨架 + 第一段的任务/assignment/义务/依赖 + 后续段每段一个必需 `plan_only` 占位（5.1.1）。
2. 采用提交成功，现有 `startGoalDriver` 启目标循环（`host.ts:2273`-`:2277` 的初始化采用路径；DRV 的目标驱动）。
3. 第一趟决定：目标循环取读前游标 → `advanceWork(select_work)`（`workflow.ts:1502`）。Workflow 选中第一段的任务 → `perform` 的 `claim`/`prepare`/`start`；不返回 gap，**不发系统轮**。
4. 第一段执行、检查、返工（现有链路）。这一段没有可推进工作时，Workflow 走到 `workflow.ts:1931`-`:1941` 的 gap（后续段的 `plan_only` 占位是 `unfinishedWork` 的一员）→ `waiting`，`reasons` 含 `plan_only:<stageId>`，`recordKinds` 含 `SessionMessage`、`PlanProposal`。
5. 目标循环用第 3 步的读前游标 `register(basis, cursor)`（`src/app/goal-wait-wakes.ts:83`-`:94`）。**先登记，后 drain，再发**。
6. 让现有 Goal 等待队列 **drain 一次**，处理登记前已发生的提交（v3 §5.4 第 1 步）；然后 `planOnlyTargetOf(basis)` 得阶段或任务；读目标活动计划的快照得 `planRevision`（`Goal.activePlanRevision` 只是 `PlanRevisionRef`，不含版本号）；`systemRoundRequestId({kind:'refine', goalId, planRevision, stageId|taskId})`；`resolveDutyRecipient` 得参谋线；`sendSystemRound`（`lookupHostSendCommit` 已提交就跳过）；把 `Session` 并进等待依据。结束这一趟。
7. Host 的 `consumeIdle` 下一批看到参谋线的 Host 系统 `action_request`（`consumable-sessions.ts:81`-`:89` 的新支）→ `handleIntervention`。收件线 duty `adviser` → 规划分支：`planOnIdleLine` 建/续 `intervention_planning` Query（`intervention.ts:178`-`:260`），claim → prepare → enter。
8. 参谋轮的 Query 结束：`parseInitialPlanningResponseV2` + `normalize` → 剥掉 segment 的 `origin` → `mergeStageRefinement(activePlan, segmentWithoutOrigin)` → `proposePlan`（候选，`status: candidate`）。Host 关联答案到 R（消息结束）；`PlanProposal` 提交叫醒目标。
9. 目标循环读候选（C 的 6.1），同一轮也读规划问题（C 的 6.1.2 步 3b）：有 `allAnswered && !resumeMessageExists` 的组 → 先登记 `plan_resume_pending` → 发 `planresume:`；有候选 → 有审阅线就 `planreview:`，没有就记候选卡，`automatic` 且审阅 `pass` 就采用。**候选卡/审中/返修已发（`wait: fix`）/待改/`busy` 不立刻结束这一趟**：先继续第 3 步选任务，别的分支能推进就推进；只有没有别的可推进步骤时才带着候选依据返回 `waiting`。采用后新版本的任务可派，回到第 3 步。
10. 采用/转卡时 C 调 `exportTaskbook`（5.3.4）；路径进“请知悉”/卡。执行者的 `{{task}}` 从新版本的 `assignment.instruction` 拿全文。
#### 5.5.2 重启
- **`resumeOnStartup: 'auto'`：** Host 启动重驱每个 active Goal（`host.ts:1641`-`:1652` 一带）。第一趟重读：若系统轮还没发/没提交，gap 还在 → 重新登记 → 发（同一请求号，若上一次已提交则 `lookupHostSendCommit` 跳过）；若候选已写入，C 的重建（设计 `:230`）登记这个目标，重驱读到候选后走 6.1；若 Query 已终态但收尾没写，按下一段的恢复读续做（不靠普通供给）。
- **`ask`/`off`：** 有待处理 `GoalInterruption` 的目标被持有（97-9；设计 `:230`、`:501`），启动重建不登记，目标不醒；人启动目标驱动后照常走。
- **发出去、还没回：** 目标等待登记在内存，重启即丢；`createGoalWaitRebuild`（`goal-wait-wakes.ts:161`-`:203`）今天只扫 Work 等待和已放行 action，不扫“已发未回的系统轮”。**不新增记录**：靠 `auto` 的启动重驱再读一次 gap 并重新登记（读前游标 + 已提交回执跳过），就能等到回复/候选。这是“重启后重新登记”的落法；`ask`/`off` 仍由 97-9 挡住。若 lead 要求重建也扫这一类，需要一个“收件箱里的未回 Host 系统 action_request”读，本节不新造（见 §22 的 G-D1，本节不新造）。
- **发出去、回了、终态收尾还没写（PLT-02/09/C-26）：** 这是重启最容易漏的窗口。`resumeOfferOf`（`consumable-sessions.ts:200`-`:225`）只供给 `claimed`/`prepared` 的 Query，Query 已 `settled` 就不再恢复；已投递的源消息又被 `deliveryEligibility` 的 `delivered` 排除（`message-machine.ts:1193`）。**不靠重新投递源消息，也不新建 Query 或恢复记录。** 恢复入口**不以 Session 占用定位**：正常终态提交同时清空占用（`query-run-recovery.ts:443`-`:448`、`session-availability.ts:849`-`:858`），而 `settlementOfferOf` 只按源消息算。`readConsumableSessions` 的**已有邮箱遍历**（`offersOf` 的 inbox 循环）每见到一条能作干预来源的消息（Host 系统 R、执行者 M、人的普通 `action_request`）就以它为准调 `interventionPlanningQueryRefs(source)`，加一个只读的 `settlementOfferOf(source, scope)`（只多一个注入的候选/消息读依赖，不新增记录/状态）；**`offerOf` 返回 null 时再问它**，命中就作为这条消息的 `action_request` 报价，源消息不变：Query 已终态（`answered`/`closed`）再按确定性身份读 `proposalRef = planProposalIdFor({goalId, requestId:'intervention:<messageKey>:propose'})` 和现有 `readPlanProposal`，按消息事实判缺失收尾。覆盖**五类终态**，不是只看候选：
  1. **规划答案（plan；候选可能已写）** → 报价，走同一 `planOnIdleLine` 用原 Query 写确定性候选；候选 `accepted` → 只补 R（M 的回复归 6.1.6 的已采用恢复）；候选 `not_adopted` → 按 `answer_ready declined` 收尾（该回 M 就回）；候选已写（仍是 `candidate`，或已因 `basedOn` 变化成 `stale`）的，不写第二个候选、不重发正文、不重开模型轮，但**不一律不报价**：源消息是 Host 系统 R 或人的普通消息且缺回复时，仍走同一 `handleIntervention`/`planOnIdleLine` 恢复同一 Query 的关联收尾（R 关联答案，人的普通消息按原收尾结束）；只有执行者 M 按 5.2.4 的 `executorWait` 有意延后，等采用/最终回答再回。
  2. **问题（`needs_decision`）** → 报价，走同一 `planOnIdleLine` 的 `answer_ready(questions)` 原收尾（关联 R；M 按 5.2.4 的 `executorWait` 规则），不开新模型轮。
  3. **文字回答/无效答案** → 报价，只补原收尾（R 按原收尾关联；M 按终态回），不写候选。
  4. **审阅（`plan_review`）** → 按 5.2.4(3) 的 `duty==='reviewer'`/`answerShape==='plan_review'` 收尾：只关联 `planreview:` 的 R，不写候选、不再审；结论仍由目标循环按 6.1.2 步 5 读同一条 Query。
  5. **无答案收尾**：Query `closed` 且没有答案 → 报价，走现有 `no_answer` 收尾（固定通知 + 撤回源消息），不重开模型轮、不重投正文。
  源消息已有同答案回复且候选已终结 → 不报价。Host 走的仍是现有 `handleIntervention`；`planOnIdleLine` 按 `interventionPlanningQueryRefs(source)` 读回同一条 Query，`proposePlan`/`respondFromQueryAnswer` 的固定 `requestId` 让重放返回原回执，不产生第二个候选、第二条回复；**不重新投递正文、不重开模型轮**。`createGoalWaitRebuild` 只登记候选/续轮/已采用未回复这些 Goal 的等待依据（`PlanProposal`/`SessionMessage`，6.1.6），不写恢复记录；终态收尾由上面的扫描直接给报价。
#### 5.5.3 绑定晚于启动
- **收件人每次发送时解析，不缓存：** 7D2 前 `resolveDutyRecipient({ workspace: {projectId, workspaceId}, duty: 'adviser' })`（`src/core/work-graph/sessions/duty-recipient.ts:27`-`:60`）；7D2 后换成 L35 的负责线（目标参谋 → 模块区域参谋 → creator → 人；`slice-7-SPEC.md:307`-`:310`）。只换这一个调用。
- **第一次趟没有参谋：** 不发消息，也**不发给秘书**（决定 103-1；设计 `:123`、`:503`）。目标保持登记；按 M-4 出 `goal_cause` 卡（code `no_adviser`，affected=[Goal pin]）给人，专用 `adviser_creation` 卡归 7D2 的 `role_line_add`/L36。**`no_adviser` 不是 Workflow 返回 waiting 时自动出现的卡**：现有 `readGoalDecisionCauses`（`goal-decision-reader.ts:78`、`:280`、`:442`）只认 `DECISION_CAUSE_CODES` 里的持久 display/automation cause，不认识它。本规格在**现有 goal_cause 读取里派生**：同一个 `readGoalDecisionCauses` 读完 display/automation 后，若 Goal `active`、且（a）计划里还有必需、活动、`plan_only` 的 work（细化需求），或（b）**有偏差需求**——用共享的偏差事实读 `readDeviationFacts(goalRef)` 组出 `DeviationInputV1` 后调同一个 `deviationsOfGoal`（`src/contracts/plan-deviation.ts` 的纯判定；`DeviationInputV1`/`DeviationV1`/`DeviationTaskFactsV1` 等输入/返回类型也在同一文件，Workflow 的 `selectNext` 与 WorkGraph 的 `readGoalDecisionCauses` 引用同一正本），返回非空（`growth`/`lines`/`budget`/`stop` 四值都算；**不另写一份只含停因的近似条件**），再读 `resolveDutyRecipient({duty:'adviser'})`；返回 `null` 时追加一条 `goal_cause`/`no_adviser`（`affected:[Goal pin]`，`taskRef:null`，`runRef:null`，`action:null`）。**不新增持久 cause、不写记录、不改 `DecisionSourceV1.kind`**：队列读（`createGoalCauseCardSource`，`decision-read-model.ts:254`）和答卡来源重核（`decision-service` 的 source recheck）都调同一个 `readGoalDecisionCauses`，共用这一个判据；收件人读失败原样返回 `CoreRejection`，不折成“没有参谋”。**卡源和 Workflow 共用同一份偏差事实判定**：读口 `readDeviationFacts(goalRef)` 放 `src/core/work-graph/tasks/goal-deviation-facts.ts`，一次读 Goal/活动计划/`queryTaskGraph`、按 Goal 分页的 `executions.listExecutions`、每批 ≤200 个 `RunRef` 的 `readRunActivities`（PLS-23）、以及 Host 有效 `planLoopLimits`，返回 `DeviationInputV1`（类型从 `contracts/plan-deviation.ts` 引用，I/O 留在 WorkGraph）；`selectNext` 和 `readGoalDecisionCauses` 都只调它，再调同一个 contracts 纯函数 `deviationsOfGoal`，不各自拼输入、不各自判停因；卡源这一轮已经读到的 TaskRow 可以作为可选入参传给同一函数，避免第二次读图，判据不变。真实装配在 `src/composition/create-platform.ts` 把同一个实例注入两处；`WorkflowDependencies`/`GoalDecisionCauseReaderDependencies` 上写成可选只为旧双打，运行时缺实现给 `unsupported`。读失败（`unavailable`/`not_found`/`not_ready`）原样返回，不折成“没有偏差”；偏差需求只按 `deviationsOfGoal` 的返回判，读数不全时它按 7.5 的规则不返回该 `kind`，卡源不另行补判、不写近似条件。之后：
  - 人建参谋线（7D2 的建线入口；PL-1 期间只留缝），建线后目标重读 gap，用同一请求号再触发；同一版只发一次；
  - 建线前的等待依据已含 `Session`，建线的 `SessionMessage` 提交能叫醒目标。
- 有参谋但收件线不健康/归档：`resolveDutyRecipient` 只取 `lifecycle === 'active'`；`findSessions`/职责读失败原样传播，不猜、不降级到秘书。
#### 5.5.4 Run 还在跑
- 有 Run 能推进时，Workflow 返回的是 `start`/`observe`/`run_check` 那一步（`workflow.ts:1701`-`:1770` 一带），不是 gap；**不发 refine**。这满足“执行这一段 → 下一段”的次序。
- Run 在等（让出回复、等检查、等卡）时，目标可能没有别的可推进工作；这时 Workflow 走到目标级等待结果的**共同收口**，可能是 gap、可能是 `collected`、也可能是 L46 的卡闭包。只要等待里存在活动的必需 `plan_only` 普通任务，就附加 `refinement` 并发 `refine:`——规划只读，不碰在跑的 Run；采用时按当时版本判（动到在跑任务是 `busy`，6C L13，D 的 7.4）。**本节的触发不额外加“没有在跑的 Run”条件**；加了会挡住“边跑边细化下一段”的合法情况。`wait_reply`、检查等已有更具体出口的等待仍走原出口，不被细化抢。
- **同一个目标多段：** 每次共同收口只发第一条段占位；采用后计划版本 +1，下一段的请求号不同；旧请求/旧候选留在记录里，按 `basedOn`/版本判 stale（C/D）。不并发发两段的 refine：一趟决定只发一条，下一趟要等这次登记被叫醒。


---
### 5.6 每个函数的出口

| 函数 | 成功 | 拒绝/空 |
|---|---|---|
| `systemRoundRequestId` | `{ status: 'ready'; value: <非空请求号> }` | `rejected('invalid', '<字段> is empty' \| '<字段> must be a positive safe integer')` |
| `systemRoundSendInput` | `{ status: 'ready'; value: SessionMessageSendInputV1 }` | 同上；`text` 首行不等于请求号 → `rejected('invalid', 'the system round text must start with its request id')`（规格新定，N8） |
| `sendSystemRound` | `SendMessageResultV1`（`committed` 且 `sendStatus: 'sent' \| 'awaiting_release'`），或跳过 `{status:'skipped'; reason:'already_committed'}` | mailbox 的 `SendRejectionV1` 原样；`lookupHostSendCommit` 的 `undetermined` 不拒，照发 |
| `planOnlyStageOf` | `string`（段）/ `null`（目标级） | `undefined`（不是 plan_only gap） |
| `refinementRoundOf`（C 用；本节定义） | `SystemRoundV1`（`kind:'refine'`） | `null`（没有 plan_only 标记 / 没有活动计划） |
| `mergeStageRefinement` | `{ status:'merged'; draft }`（保留 base 的 `reviewAdmissionProtocol`；base 是 snapshot 时沿用其 `origin`，是 draft 时不带；`planId`/`planRevision` 取 segment） | `rejected('invalid', 'the segment names no stage and no task')`；其余交给现有 plan 校验 |
| `planningNoteAdmission` | `{class:'planning', kinds: 六种 general, withdraw:true, grantedGoalIds: []}` | `{class:'none'}`（形状不是 `plan_round`/`plan_review`，且不是 Host 系统 `action_request` 的 `text` 规划轮）；源消息读失败/读口缺席 `unavailable` |
| `resolveNoteQueryRun`（`tasks/` 的薄分派） | 按 QueryRun→QueryJob→manifest 的冻结 `answerShape` + 源消息的 Host 系统身份交规划或原秘书 resolver | 读 QueryRun/QueryJob/manifest 失败或解码失败 `unavailable`；两个 resolver 的拒绝原样 |
| `resolvePlanningQueryRun` | `{status:'ready'; value: PlanningQueryRunV1}`（duty `adviser`/`secretary`，Goal 取 `manifest.goal.ref.goalId`、冻结计划取 `manifest.focusPlan.ref`） | `forbidden`（不是规划轮/职责不对）；`unavailable`（读失败、绑定损坏） |
| `renderTaskbookMarkdown` | `string` | `null`（未知 stage） |
| `taskbookRelativePath` | `string`（输入含 `goalId`、`planId`、`stageId`、`planRevision`） | 无（id 用 `encodeURIComponent`；空 id 由调用方/计划校验保证） |
| `exportTaskbook` | `{status:'written'; path}` / `{status:'skipped'; reason:'no_settings_directory'}` | `{status:'failed'; reason}`（任何 fs 错误；不抛） |
| `exportTaskbooksForPlan`（建议名；Host 包装用） | `TaskbookExportV1[]`（每个 stage 一条；`skipped`/`failed` 折在结果里，不抛） | 无（失败也是一种结果）；**导出根落在任一工作区根内/等于工作区根**时整批 `failed`（每段一条，不写文件） |
| `sessionMessageTextBound` / `isSystemRoundSender` | `number`（`message` 部分：普通 16 KiB / Host 系统轮 64 KiB；`response` 部分一律 16 KiB）/ `boolean` | 无 |
| `planningOutputReserveTokens(contextWindowTokens)` | `number` = `min(131072, floor(contextWindowTokens/2))`（唯一输出预留公式；窗口非法由现有预算校验先拒） | 无（纯函数；不读配置、不改窗口） |
| `queryTextProblem`（加 execution kind 参数） | `null`（在选中的上限内） | 现有 reason 字符串（`must be at most 16 KiB/64 KiB of UTF-8`） |
| `answerBoundBytes(shape, call.name)`（`answerShape` + 工具名） | `number`（16 KiB 或 256 KiB） | 无 |
| `planningReplyTextOf({shape, answerText, queryJobId})` | `string`（按 5.3.5 的表：规划答案能解析出合法 `plan`/`questions` 时取 `summary`；`plan_round` 的文字退路保留已保存原文；审阅取 `审阅通过`/`审阅要求返修：<n> 条意见…`；`text` 取原文本） | `null`（只给 `plan_review` 的终态无效答案：不造回复，走原终态；`plan_round` 的非空 ≤16 KiB 文字退路不返回 `null`）；结果超 16 KiB 按上表来源不可能，若出现走 5.3.5 的回复上限拒绝 |
| `planResumeOriginalQueryOfText(text)` | `SessionMessageRef`（`question` 第二行的 `originalQueryRef`） | `null`（没有这一行/不是完整 ref）；只给准备阶段装配用，不选工具 |
| `exportBooks`（6.4.3 的读口） | `{status:'not_configured'}` / `{status:'ready'; stages: TaskbookFileStatusV1[]}` | `{status:'unavailable'; reason}`（缺读口/探针失败；单段读不到仍按 `missing`，不抛给通知） |
| `handleIntervention`（本节新增的出口） | 规划分支：现有 `progressed`（`stage:'query'\|'proposal'`）、`awaiting_decision`、`answer_ready`（`reason: answered\|invalid_plan\|questions\|candidate\|declined\|adopted`）、`no_answer`；审阅分支由 C 定；系统轮/规划线**不返回 `claimed`**；`associate_answer` 的 `replyToOriginal` 按真实发送者 + 执行者 open wait 决定（C-25） | 现有 `rejected` 闭集（`unsupported`/`forbidden`/`source_stale`/`busy`/`invalid`/`unavailable`/`revision_conflict`/`not_found`，`src/contracts/core/results.ts:16`）；`sessionDuty` 等 `ReadResult` 的 `not_found`/`not_ready` **经既有 `asRejection` 映射**（`intervention.ts:57`），不直接当干预结果返回，也不静默降级；**不新增错误码**（PLS-30/C-31） |
| `offerKindOf` | 现有五种 + Host 系统 `action_request` | `null`（不服务） |
| `settlementOfferOf`（5.5.2 的恢复读；consumable view 内） | 以遍历到的源消息算确定性 Query；Query 已终态且收尾缺失时给 `action_request` 报价（覆盖问题、文字回答、审阅、无答案收尾、规划答案的候选/关联收尾五类，含候选已写但 R 未关联）；**不看 Session 占用** | `null`（Query 不存在/未终态、正常等待或已收尾）；读 Query/候选/消息失败原样 `CoreRejection`，不猜 |
| `proveInterventionSource` | 现有 `{sourceMessageRef, guards}` | `null`（不是来源）/读失败原样 |
| `planningAnswerShapeOf` | `'plan_round' \| 'plan_review' \| 'text'`（纯；只看发送身份 + 收件 duty） | 不拒绝；不认识的组合给 `'text'` |
| `deviationsOfGoal`（7.5；`src/contracts/plan-deviation.ts`） | `DeviationV1[]`（按 `kind` 各自判断、各自去重；空数组 = 没有要发的） | 不拒绝（纯函数）；`growth` 缺 `sizeClass`/读数不全不返回，`lines` 缺 `estimatedLines`/读数不全不返回；硬停因存在时不返回软线 |
| `readDeviationFacts(goalRef)`（5.5.3 的共享偏差事实读；`tasks/goal-deviation-facts.ts`） | `ReadResult<DeviationInputV1>`（类型见 `src/contracts/plan-deviation.ts`；Goal/活动计划/TaskRow、按 Goal 的执行列表和每批 ≤200 的 Run 活动、Host 有效 `planLoopLimits` 一次读齐） | Goal/计划 `not_found` 原样；`not_ready` 原样；缺读口 `unsupported`；执行列表/Run 活动读失败 `unavailable`；不折成“没有偏差” |
| `queryAnswerShapeOf` | `'secretary' \| 'initial' \| 'plan_round' \| 'plan_review'` / `null` | 不拒绝；非请求非规划一律 `null` |
| `buildAnswerText`（扩参） | 按 `answerShape` 给 `string`；请求轮两支与今天逐字相同 | 无（纯构造；长度由调用方判） |
| `answerProblems`（扩参） | `AnswerProblem[]`（空 = 接受）；`plan_round` 用 `parseInitialPlanningResponseV2`，`plan_review` 用 `parsePlanReviewAnswer` | 不抛；拒绝原因为一句话/`problems` |
| `planReviewAnswerText` | `string`（`{schemaVersion:1,kind:'plan_review',...}`） | 无 |
| `parsePlanReviewAnswer` | `{status:'parsed', verdict, findings}` | `{status:'rejected', reason}`（含 `fix` 空 findings；`pass` 的 findings 只做结构校验，不因非空拒绝） |
| `createAnswerTools`（扩参） | `AnswerToolsHandle`；四个形状的工具组 | `createAnswerTools` 本身不拒；调用方缺 owner 时 `unsupported` |

---
### 5.7 改动位置

| # | 位置（tree 行号） | 改什么 | 规模 |
|---|---|---|---|
| 1 | `src/business/workflow/workflow.ts:1931`-`:1948`（gap 等待 + gate 选择）；`:1156`-`:1183`（`advanceGate` 的 producer） | 在 `waiting` 的 `reasons` 加 `plan_only:<stageId>`/`plan_only:`，`recordKinds` 加 `SessionMessage`；新增一个纯 helper 取第一条 required+active+work+plan_only 的 `stageId`（建议同文件 `:558` 一带，复用 `orderTasks`）。**并在 `if (unfinishedWork.length > 0)` 之前插阶段 gate 选择**：`required` 里 `taskKind==='gate' && scope.kind==='stage' && disposition==='active' && 未满足`，且 `gateCoveredTaskIds` 与 `unfinishedWork` 无交集，且不在 `base.activeTaskIds`；选中就 `advanceGate`。`:1946` 的 `gateTask` 只选 `scope.kind !== 'stage'`（目标 gate 仍只在全部必需 work 满足后选）。`advanceGate` 的 producer（`:1177`）按 gate 覆盖过滤。 | 小 |
| 2 | 新建 `src/business/workflow/plan-round.ts`（建议）；`src/contracts/plan-round.ts` | `SystemRoundKind`、`SystemRoundV1`、`systemRoundRequestId`、`systemRoundSendInput`、`planOnlyStageOf`、`refinementRoundOf`、`SYSTEM_ROUND_ACTOR`、`systemRoundContext`、`planResumeOriginalQueryOfText`/`planningReplyTextOf` | 中 |
| 3 | 新建 `src/app/system-round.ts`（建议） | `sendSystemRound`（发送 + 可选回执跳过），只做发送包装，不另造发送身份 | 中 |
| 4 | `src/core/work-graph/views/consumable-sessions.ts:81`-`:89` | `offerKindOf` 加 Host 系统 `action_request` 支 | 小 |
| 5 | `src/core/work-graph/tasks/initial-plan-answer.ts:74`-`:113` | `proveInterventionSource` 接受 Host 系统 `action_request` | 小 |
| 6 | `src/business/workflow/intervention.ts:58`-`:120`、`:178`-`:343` | `handleIntervention` 按 duty/系统身份分支；`addressed` 不用 `latestWork`；规划分支不 `claimFirstReady`、不采用；`planresume` 冻结 `prev.repliesToMessageRef ?? lineage.rootMessage`（6.3.1），base 取 `fixBase.draft`、`basedOn` 取 `fixBase.basedOn`（没有 `fixBase` 才用活动计划 snapshot/其 `ref`）；答案前 `mergeStageRefinement`；`associate_answer` 按 `executorWait && candidateOrQuestions` 才延后 M，人的普通消息和 R 按原收尾结束；已 `accepted` 的候选返回 `answer_ready reason:'adopted'`（先补 M 回复，下一轮再 claim） | 中 |
| 7 | `src/business/workflow/ports.ts:97`、`:152` | `intervention.ts` 的 `WorkflowDependencies` Pick 加 `sessionDuty`（类型已存在，只加 Pick） | 小 |
| 8 | `src/contracts/query-job.ts:259`-`:295`、`:357`-`:363` | `intervention_planning` 执行臂加可选 `repliesToMessageRef?: SessionMessageRef` 和 `answerShape?: 'plan_round' \| 'plan_review' \| 'text'`；校验只在这两臂允许、必须是完整 ref/已知枚举 | 小 |
| 9 | `src/core/work-graph/communication/mailbox-service.ts:1102`-`:1116` | `consultationBindingOf` 的 `intervention_planning` 臂：被回复的消息等于 `sourceMessageRef` **或** `repliesToMessageRef`（出现时）；结论仍精确相等 | 小 |
| 10 | 新建 `src/core/work-graph/tasks/stage-segment.ts`（建议） | `mergeStageRefinement` | 中 |
| 11 | `src/contracts/plan.ts:36`-`:60` | `RuntimeTask.estimatedLines?: number` | 小 |
| 12 | `src/core/work-graph/persistence/plan-record-codecs.ts:328`-`:345` | `runtimeTaskIssues` 校验 `estimatedLines`（正整数安全整数） | 小 |
| 13 | `resources/prompts/platform/templates/initial-planning-answer.txt`、`skill-platform-adviser.txt`；`src/contracts/prompts/platform-pack.generated.ts` 重生成 | `estimatedLines`、只输出这一段、任务书模板/档位/接口约定/三种答复/`refine_future` 的说明 | 中 |
| 14 | `src/core/agent-runtime/query-observation.ts:50`、`:156`-`:205`、`:477`-`:505` | `RequestAnswerFormat` 改成冻结的 `answerShape`（不再用 `isRequestRound`）；`submitted !== null` 时按形状 `buildAnswerText`；已接受工具答案按形状选 16/256 KiB，**文字退路一律 16 KiB**；请求轮 `parseSecretaryAnswer` 不变，plan/review 存正文由目标循环解析 | 小 |
| 15 | `src/core/work-graph/queries/query-record-codecs.ts:578` | 持久上限 256 KiB（只保证规划答案存得下；普通答案的语义上限仍在 #14；秘书/审阅工具仍 16 KiB） | 小 |
| 16 | `src/contracts/runtime-budget.ts`；`src/app/runtime-configuration.ts:121`-`:122`、`src/app/host.ts:340`-`:344` | 加纯函数 `planningOutputReserveTokens(contextWindowTokens) = min(131072, floor(contextWindowTokens/2))`（唯一正本）；规划轮 profile 的 `perResponseTokens` 和 Host 上限都用它、都取同一个窗口（本地 deepseek 的 1,000,000 → 131072，默认 128000 → 64000）；**不改 `contextWindowTokens`** | 小 |
| 17 | `src/core/work-graph/state/secretary-note.ts:13`-`:58` | 加 `planning` 臂 + `planningNoteAdmission`；六种 general、`withdraw:true`、`grantedGoalIds:[]`；`secretary` 臂不变 | 小 |
| 18 | `src/core/agent-runtime/tool-group-assembly.ts:579`、`:641`、`:650`；`query-preparation.ts:337`；`query-execution.ts:331`；新建 `src/core/work-graph/tasks/planning-query-run.ts`；`notes/note-service.ts:88`、`:145`；`src/composition/create-platform.ts:1205`、`:2301` | 规划轮的注记工具准入（`class!=='none'` 才给 `record_note`，邮箱/建成员仍只认 `secretary`）；按冻结 `answerShape` + 源消息的 Host 系统身份选准入（N 的 `text` 轮也进 planning）；新增规划 resolver 和 `resolveNoteQueryRun` 薄分派（QueryRun→QueryJob→manifest 读取链，Goal 取 `manifest.goal.ref.goalId`），秘书请求轮仍走原 `resolveSecretaryQueryRun` | 中 |
| 19 | 新建 `src/core/work-graph/views/taskbook-markdown.ts`、`src/app/taskbook-export.ts`（建议） | `renderTaskbookMarkdown`、`taskbookRelativePath`、`exportTaskbook`、`exportTaskbooksForPlan`、`exportBooks` | 中 |
| 19a | `src/core/agent-runtime/answer-tools.ts:53`、`:571`-`:575` | `answerBoundBytes(shape, call.name)`：`submit_plan_round` 256 KiB；`submit_secretary_answer`/`submit_plan_review` 16 KiB；超界 `capacity` | 小 |
| 20 | `src/app/host.ts` 的 `consumeIdle`（`:1855`、`:1880` 附近）、`adoptInitialization`（`:2273`-`:2281`）、`:2307` 附近的关闭等待、`plans/apply` 的 bindings 覆盖、C 的 `adopt_plan` 装配 | 允许改这些**既有调用点**：系统轮消费进 `offer.kind` 分支、恢复报价进同一循环、采用导出接 `adoptAndExport`、目标循环启动/重建接启动路径、导出的异步工作纳入关闭等待；每项仍一个新函数、集中注册，不重命名 7D1 的方法（PLS-31/C-32） | 小（C 接线） |
| 20a | 新建 `src/core/work-graph/views/plan-adoption-notices.ts`；`src/composition/create-platform.ts:1445`；`src/core/work-graph/model/decision-contracts.ts:177` | `plan_adoption` 通知源、`exportBooks` 读口注入、类别；`summary` 加每段任务书的 `written/missing/incomplete` 一行 | 中 |
| 21 | `src/core/work-graph/views/graph-context-reader.ts:1869` | 不改；`find` 已经带 `instruction` | 0 |
| 22 | `src/contracts/query-job.ts` 的 `QueryJobIntentV1.execution`、`PreparedQueryManifestV1`（`src/contracts/core/prepared-execution.ts:278`） | 加 `PlanningAnswerShapeV1`/`QueryAnswerShapeV1`、`execution.answerShape?`、`manifest.answerShape`，以及 `queryAnswerShapeOf`；`validQueryExecution` 校验 kind/枚举 | 小 |
| 23 | `src/business/workflow/plan-round.ts`（新，建议） | `PlanningAnswerShapeV1`、`planningAnswerShapeOf`；按发送身份 + 收件 duty 选形状 | 小 |
| 24 | `src/core/agent-runtime/query-preparation.ts:337`-`:360`、`:380` | 准备时算 `queryAnswerShapeOf`，同一个值写 `finalToolNamesOf` 的 `answerTools` 和 `manifest.answerShape`；不再用 `secretaryFacts === null` 判；**追加指南与形状分开判**：`plan_round` 附 `initial-planning-answer`，`plan_review` 只附 `plan-review-input`，`null` 中普通非请求 `initial_coordination` 仍附 `initial-planning-answer`，其余 `null` 不附 | 小 |
| 25 | `src/core/agent-runtime/query-execution.ts:325`-`:360`、`:388`-`:420`、`:523`-`:563` | 启动只读 `manifest.answerShape`（缺失按清单损坏 `unavailable`，**不做旧清单回退**），`finalToolNamesOf` 和 `createAnswerTools` 都按形状；去掉 `manifest.request!` 的假设 | 中 |
| 26 | `src/core/agent-runtime/answer-tools.ts:56`-`:99`、`:151`、`:257`-`:388`、`:399`、`:560`-`:622` | `ANSWER_TOOL_NAMES` 加 `submit_plan_round`/`submit_plan_review`；`answerShape` 分派；`plan_round` 256 KiB、`plan_review`/`secretary`/`initial` 16 KiB；`answerProblems` 扩参；`submit_plan_round` 的 plan/questions 判别；`planSchema` 接通已有 `replacedByTaskId`/`inputRequirements`，根加 `reason` 通道 | 中 |
| 27 | `src/contracts/plan-review.ts`（新） | `PlanReviewFormV1`、`planReviewAnswerText`、`parsePlanReviewAnswer`；`schemaVersion`/`kind` 固定 | 小 |
| 28 | `src/core/work-graph/sessions/message-record-codecs.ts:124`、`message-body-envelope.ts:217`、`mailbox-service.ts:762`、`:2287`、`:5084` | 加 `SYSTEM_ROUND_MESSAGE_MAX_TEXT_BYTES = 64 * 1024`、`isSystemRoundSender` 和唯一的 `sessionMessageTextBound({sender,part,original})`；`message` 部分按本条 sender 16/64，`response` 部分一律 16；发送/读取同一函数，不看 `followupOf` | 小 |
| 29 | `src/core/work-graph/queries/query-job-service.ts:84`、`:94`、`:263` | `queryTextProblem(text, executionKind?)`：`intervention_planning` 64 KiB，其余 16 KiB；`submitQueryJob` 传 `intent.execution?.kind` | 小 |
| 30 | `resources/prompts/platform/tools/submit_plan_round.json`、`submit_plan_review.json`（新）；`pack.json` 的 `tools`；生成的 `platform-pack.generated.ts` | 两个工具的说明和参数文本；生成物重生成，不手改 | 小 |
| 31 | `src/contracts/prompts/slot-tables.ts`、`resources/prompts/platform/templates/plan-review-input.txt`（新） | 审阅输入模板的槽和正文；生成物重生成 | 小 |
| 32 | `src/core/work-graph/tasks/goal-decision-reader.ts:78`、`:280`、`:442`；`src/core/work-graph/views/decision-read-model.ts:254` | 在现有 `readGoalDecisionCauses` 末尾按“细化/偏差需求 + `resolveDutyRecipient('adviser')===null`”派生 `goal_cause/no_adviser`；加一个只读收件人依赖；队列读和答卡来源重核共用；不新增持久 cause | 小 |
| 33 | `src/app/host-settings.ts:1271`-`:1290`、`:762`、`:1573`；`src/app/host-settings-types.ts:38`；`src/app/system-round.ts` / 组合根 | `planLoopLimits` 的 `saved/effective/defaults`、`plan-loop-limits/save` 的校验/持久化/读取，以及把 `effective` 注入 `deviationsOfGoal` 的 `input.limits`；E3 只接页面，不新建设置记录 | 中 |
| 34 | `src/core/work-graph/views/consumable-sessions.ts:193`-`:225`（`settlementOfferOf`）；`src/app/host.ts:1855`-`:1880` | 终态恢复**以遍历到的源消息为准**（不算 Session 占用）：算 `interventionPlanningQueryRefs(source)`、读终态、按确定性 `proposalRef`/`readPlanProposal` 和消息事实补收尾；覆盖问题、文字回答、审阅、无答案收尾、规划答案的候选/关联收尾（含候选已写、R 未关联）；不改普通 `deliveryEligibility`，不新建 Query/恢复记录 | 中 |
| 35 | `src/business/workflow/workflow.ts:169`-`:172`、`:239`-`:245`、`:2606`-`:2618`；`:2691`-`:2701` 的偏差发送步骤 | 取消身份改由候选+Run 决定、不含 Run revision；提交前 `controlIntentRefFor`+`readControl`：本次 `queued`（围栏已成立）或 `applied` 续采用，权威 `not_found` 才提交，`superseded`/`outcome_unknown`/读失败保留实际出口；`revision_conflict` 同一 `requestId` 重试；**偏差发信改走 `sendSystemRound(systemRoundContext(...), request)` 的固定身份**（5.2.5），`automationContext` 只留普通返工/N 请求 | 小 |
| 36 | `src/core/agent-runtime/query-preparation.ts:360` 一带（`planresume:` 分支）；`src/contracts/plan-round.ts` 的 `originalQueryRef` 解析 | 准备 `planresume:` Query 时按 `originalQueryRef` 读原 Query 的原问题和 `needs_decision` 答案，用同一问题 reader 返回的完整 `card.source` 按 `answerRef`/`questionIndex` 选中后原样传给 `decisionMessages.readDecisionAnswer({source: card.source})` 取已存答复，按卡顺序追加进准备输入；准备阶段不拼 source、不重读或补 pins/goalBases；不改消息正文、不加字段、不新增记录 | 小 |

**共享文件提醒。** `host.ts`、`answer-tools.ts`、`workflow.ts`、`intervention.ts`、`plan*.ts` 与 7D1/6C 的改动重叠；本节按“共享文件串行落地”交给 lead 排序。`platform-pack.generated.ts` 是生成物，只重生成，不手改。

---
### 5.8 阶段结束
阶段的必需任务和阶段 gate 都满足时，出一条“请知悉”，不挡工作（v3 §5.8）：
- 这一段用了多少：累计 token、上下文增长量、改动行数；有未知或不全时写明“未知/不全”，不写 0（10.4、13.2.3）。
- 完成了哪些任务：按当前计划版本的 `taskId` 列，已完成/被替代分开。
- 返工几次：这一段任务的返工次数之和；接续 Run 不计返工次数。
- 下一阶段的预估档位：占位任务的 `sizeClass`（没有档位写“未分档”）。
- 阶段线如果超了：把 `Σ estimatedLines > 2,000` 或阶段累计 token `> 0.6B` 的数字一并写进这条“请知悉”；只提醒，不挡下一阶段（v4 §10）。
- 投影走现有“请知悉”（6.4），**由 `plan_notice` 通知源生产**：阶段 gate 按现有 `gateCoveredTaskIds`/`advanceGate` 归约到 `satisfied` 后，源按该 stage gate 的已终结验证轮（现有 `VerificationRound` 的 `since` 是提交游标，`S2B_ROUND_BY_GOAL_LOOKUP` 按 Goal 可读）出**一条**；`itemKey = stage-end:<planId>:<planRevision>:<stageId>`，`position` 用该轮的 `since`；同一阶段同一版一条，重放/再读不重复。内容按上面六项从现有计划、TaskRow、RunActivity 和 gate 覆盖关系算，不新增记录、不发模型轮、不出卡；读失败 `unavailable`（不写成“没有”），没有已满足的 stage gate 不产生项。阶段结束不是任务完成，也不是目标完成。
### 5.9 目标层
目标只累计，在目标栏显示，不设默认上限（v3 §5.9）：
- **读数：** 目标累计 token、上下文增长量、改动行数 = 目标下全部 Run 之和；不按 Session 去重，子 agent 的 Run 也计入（10.4、10.5）。
- **显示：** 目标栏显示三个读数；有未知/不全时写明，不写 0。
- **上限：** 不设默认上限，也不因为目标累计大就自动停/自动采用；阶段线只提醒，不是目标上限。
- **人手动设目标上限**留到 MVP 之后；本规格不写目标级硬刹车。
- **目标完成：** 仍按现有规则检查全部必需任务和目标 gate；目标层读数不参与完成判定。
#### 5.9.1 复用清单（施工用，已并进各节）
设计 §16 已有复用清单；本规格各节的代码点已写清复用了谁。这里只留四处最容易漏的：计划摘要 `queryPlanSummary`（`context-fact-text.ts:363`，规划轮的 `plan` 段就是它）、任务说明 `taskCardOf(... assignment?.instruction ...)`（`graph-context-reader.ts:1869`）、阶段 gate 的 `gateCoveredTaskIds`/`advanceGate`（`decision-policy.ts:153`、`workflow.ts:1156`）、答案构造 `buildAnswerText`/`MAX_ANSWER_BYTES`（`answer-tools.ts:151`、`query-observation.ts:50`）。其余复用点见 5.2.2/5.2.4/5.3.4/5.6/6.1/6.3/7.1/7.3。
### 5.14 会与 C/D 冲突的名字（保留冲突提醒）
- 本节定义、C 可能也要用的：`SystemRoundKind`、`SystemRoundV1`、`systemRoundRequestId`、`systemRoundSendInput`、`planOnlyStageOf`、`refinementRoundOf`、`SYSTEM_ROUND_ACTOR`、`systemRoundContext`、`sendSystemRound`、`planningReplyTextOf`。C 的 6.1 如果要发 `planreview:`/`planfix:`，直接用这些名字，不另起 `planReviewRequestId`。
- 本节定义、D 可能也要用的：`deviation` 的请求号格式（设计 `:291`）和 `systemRoundRequestId` 的 `deviation` 臂；D 的 7.1 不要另写一份前缀拼接。D 的 `2 倍线` 读 `RuntimeTask.estimatedLines`（本节字段），不要另立 `estimatedLines` 的副本。
- 本节定义、E 可能也要用的：`renderTaskbookMarkdown`、`exportTaskbook`、`taskbookRelativePath`（测试 PL-46/PL-47）；E 的完整测试行用这些公开入口，不读库。
- 可能与 7D1/7C 重名的：`planningNoteAdmission`（`secretary-note.ts`）、`mergeStageRefinement`（`tasks/`）、`taskbook-*`（`app/`/`views/`）。7D1 若也动 `host.ts`/`answer-tools.ts`，按共享文件串行落地。


---
## 6. 核对：目标循环、诊断、审阅轮、状态和让人知道
**依据。** 设计 `plan-loop-design.md`（v4 定稿，685 行）。代码按 合并树 `5a1ec32` 的 `src/`、`tests/`、`resources/`（合并树 `5a1ec32`：有 Q、L1、F2、T，没有 H、L2）；tree 没有 `.git`，行号按文件内容核过。引用设计写 `plan-loop-design.md:行`，引用代码写 `src/...:行`。

**边界。** 第 5 节的系统轮（前缀、请求号总表、Query 创建、消费、`repliesToMessageRef`）在 B；第 7 节的偏差入口和"取消让出的 Run"在 D。本部分只引用，不重定义：系统轮怎么被消费、`planfix:` / `planresume:` 的消费分支以 B 为准；替代在等的执行者时的先取消后采用以 D 为准（`plan-loop-design.md:320`-`:327`）。本部分给的是**目标循环这一侧**：候选从哪来、每轮读什么、按什么顺序、发什么、怎么读结论、采用还是转卡、投影什么、状态落在哪。

**一句话。** 目标循环（Workflow 的目标级决定 + Host 的驱动）每轮先看这个目标最新的一份未采用候选：读候选和正式计划 → 机械诊断 → 有审阅线就发 `planreview:<proposalId>:<revision>` 并登记等待 → 回来看这一版的确切结论 → `pass` 且诊断无问题且 `refine_future` 判 `automatic` 才由平台身份采用，其余转候选卡；采用后由通知投影出一条"请知悉"，再回到派工。

---
### 6.1 目标循环统一处理候选
#### 6.1.1 候选的五个入口，哪些进这个循环
**候选**就是一份还没采用的计划修改，记录是现有的 `PlanProposal`（`src/core/work-graph/state/plan-machine.ts:92`-`:107`；`src/core/work-graph/model/plan-contracts.ts:38`）。`PlanProposal` 已经能表达全部五个入口，不加记录，也不加区分类型的字段（`plan-loop-design.md:207`、`:263`）。

| # | 入口 | 谁写、什么时候 | 记录上的样子 | 本循环处理 |
|---|---|---|---|---|
| 1 | 人的请求槽（6C L7） | 秘书请求轮：人发起、秘书回答，请求轮把答案变成候选（`src/core/work-graph/tasks/plan-service.ts:1133`-`:1199` 的 request-candidate 分支；`src/core/work-graph/tasks/plan-readers.ts:614` `readRequestCandidateHead`） | `requestRef` 指向一个 **request round**（`isRequestRound`，`src/contracts/query-job.ts:492`：`job.job.roundKind !== null`） | **不处理**，仍由人采用（`plan-loop-design.md:209`） |
| 2 | Work Run 的 `propose_future_plan` | Work Run 调工具（`src/core/agent-runtime/whiteboard-tools.ts:207`、`:289`），Plan 服务写候选；`submittedBy` 是委派证明 | `submittedBy` 有；`sourceMessageRef === null`；`requestRef === null`；`basedOn` 是当前活动计划 | 处理（设计测试 28） |
| 3 | 细化（`refine:`） | 参谋规划轮的答案被写成候选，写者带本轮 Query 和来源消息 | `sourceMessageRef` = 那条系统轮消息；`requestRef` = 规划轮 QueryJob；`basedOn` 是当前活动计划 | 处理 |
| 4 | 返修（`planfix:`） | 同上；来源消息是 `planfix:<proposalId>:<revision>`，写的是新的独立候选 | 同 3，来源消息首行是 `planfix:`；`basedOn` 仍是被审候选的 `basedOn` | 处理（见 6.3.4 的独立候选和来源链） |
| 5 | 首个方案 | 初始化 / 6C L7：`proposeInitialPlanFromAnswer`（`src/core/work-graph/tasks/plan-service.ts:1703`-`:1776`），或人请求轮的首份计划（`:1133`-`:1199`） | `basedOn === null` | **不处理**，由人采用（决定 15；`plan-loop-design.md:255`） |
- **`planresume:` 写出的候选**（人答完规划问题卡后的续轮，`plan-loop-design.md:143`-`:145`）和 3、4 同形：`sourceMessageRef` 是那条续轮消息。它走本节的同一行，续轮本身见 §5.2；**区分办法（`plan-loop-design.md:209`）。** 不能只看 `requestRef`：干预候选也填它。本规格用两条事实：`basedOn === null` → 首个方案，排除；否则读 `requestRef` 指的 QueryJob，`isRequestRound`（`src/contracts/query-job.ts:492`）为真 → 人的请求槽，排除。`sourceMessageRef` 用来认出系统轮/干预的来源消息是哪种发信身份（人、Host 系统、Work Run/秘书轮），不单独当请求槽的判据；**来源链跨 `planfix:`/`planresume:` 两种首行**（6.3.1）：续轮写出的是返修那条待修候选的后继（`fixBase` 指向它），不是新的独立链。依据：设计原文"两者用 `sourceMessageRef` 和 Query 来源区分"；request round 就是"请求槽"这一侧在代码里的唯一稳定特征（`plan-loop-design.md:209`）。
#### 6.1.2 一轮的读（顺序就是设计的顺序）
一轮从"叫醒"开始，到"派工"或"等"结束。每一步谁调用谁：

| 步 | 做什么 | 谁调谁 | 读前游标 |
|---|---|---|---|
| 1 | 叫醒 | Host 的 `goal_waits` 队列排空 → `collaborationDriver.wake(goalRef)`（`src/app/goal-wait-wakes.ts:235`-`:240`；`src/app/wake-loop.ts`）；或人/路由 `workflow/driver-start`（`src/app/host.ts:1674`-`:1689`）；或 Run 看守交回后驱动自己再来一趟 | — |
| 2 | 采游标 | 驱动在**事实读之前**采一次 `dependencies.observedCursor()`（`src/app/collaboration-driver.ts:1082`） | 这是本节所有登记用的"读前游标" |
| 3 | 读目标与候选 | Workflow 的目标级决定调 `deps.plans.queryGoal(goalRef)`（`src/business/workflow/workflow.ts:1505`；返回 `GoalDetail`，含 `pendingPlan`，`src/core/work-graph/model/plan-contracts.ts:66`） | 同上 |
| 3b | 读规划问题，决定要不要续轮 | 调 `deps.planCandidates(scope, ctx, goalRef)`（6.1.6；带 `goalRef` 只读这个目标），它用现有问题 reader 枚举问题身份、经现有决定答案读取取得已存答复，**只把有本闭环来源（`intervention_planning` 且 `execution.sourceMessageRef` 存在）的问题组**按原 QueryJob 分组（其他初始化/普通 `initial_coordination` 问题保留原读和原流程，不进组、不报错）；每组 `allAnswered === true` 且 `resumeMessageExists === false` 时，用 `systemRoundRequestId({kind:'planresume', goalRef, queryJobId, originalMessageRef})` 算请求号、`systemRoundMessageRef` 算消息；**先登记**（步 7），再由步 8 发。`allAnswered === false`、`resumeMessageExists === true`、或读失败（原样保留 `CoreRejection`，不折成“已答”或“未答”）都不发 | 同上；这条分支和候选读在同一轮，候选没有立即动作也照走 |
| 4 | 读正式计划 | 需要差异时 `deps.plans.queryTaskGraph`（`workflow.ts:1530`），得到活动 `PlanRevisionSnapshot` 和 Task 行 | 同上 |
| 5 | 读候选的审阅结论 | 只为**这一版**算 `planreview:<proposalId>:<revision>`（6.3.1），用 `systemRoundRequestId({kind:'planreview',...})`/`systemRoundMessageRef` 算出这条消息和 `interventionPlanningQueryRefs`（`src/contracts/query-job.ts:104`）的 Query 对，**不发送**；先看消息回执：`committed` 且 Query `not_found` → `waiting`，不重发；`not_committed` 且 Query `not_found` → `not_sent`，步 8 才发；Query 未结束（`pending`/`running`）→ `waiting`；`answered` → `readQueryAnswer` 后 `parsePlanReviewAnswer`，成功给 `decided`，失败给 `terminal_invalid`；`closed` 且无合法结论 → `terminal_invalid`。`readQueryJob`/`readQueryAnswer`（`src/core/work-graph/queries/contracts.ts:275`、`:284`）本身失败原样保留，不折成 `not_sent` | 同上；登记在发请求之前（步 7） |
| 5b | 读返修轮的状态 | 只在审阅结论是 `fix` 且 `completedFixes < 3` 时，为这一版算 `planfix:<proposalId>:<revision>`（6.3.1），用 `systemRoundRequestId`/`systemRoundMessageRef` 算消息和 `interventionPlanningQueryRefs` 的 Query 对，**不发送**；调 `deps.planFixRead(goalRef, proposalRef, revision)`（6.7.1）得三态。`planFixRead` 从这条 `planfix:` 消息/Query 起读，**遇答案是 `questions` 时不停在原 Query**：用 3b 的同一组问题事实（问题 reader + `readDecisionAnswer`）判卡是否全答；全答后用 `systemRoundRequestId({kind:'planresume', goalRef, queryJobId:<当前 Query 的 jobId>, originalMessageRef:<当前 Query 的 execution.sourceMessageRef>})`/`systemRoundMessageRef` 算续轮消息和 `interventionPlanningQueryRefs` 的 Query 对，继续读；续轮再问人时同样沿 `planresume:<goalId>:<queryJobId>` 往下走，直到最后一轮。三态以**最后一轮的状态和收尾**判，不以原 `planfix:` Query 的结束判：`not_sent` = 回执 `not_committed` 且原 Query `not_found`；`waiting` = 已发（含回执已 `committed`、Query 还没建出）且最后一轮未终态、或问题卡未全答/续轮还没建出、或最后一轮已终态但该轮源消息的收尾未完成（等收尾写候选或关联）；`terminal` = 最后一轮已终态、收尾完成仍没有后继候选（后继候选已写出时旧候选已被 6.3.1 排除，不走到本读）。**收尾是否完成看该轮源消息的 `response`/撤回；答案形状用现有 `parseInitialPlanningResponseV2` 判（与 `planOnIdleLine` 同一条解析），只看 plan/questions/其他，不把答案当正文重投。** 读失败原样保留，不折成 `not_sent` | 同上；`skipped` 也按已发读这条 Query |
| 6 | 机械诊断 | 调 6.2 的纯函数；输入是候选的 `draft.obligations`、候选的 `catalogPin`、检查覆盖、政策的 `requirementKinds` | — |
| 7 | 登记等待 | 驱动拿到带 `waitBasis` 的结果，用步 2 的游标 `waits.register(value.waitBasis, cursorAtRead)`（`src/app/collaboration-driver.ts:1124`）；`register` 是合并语义、保留较早游标（`src/app/goal-wait-wakes.ts:86`-`:96`） | 早于发请求 |
| 8 | 发审阅 / 发返修 / 发续轮 / 采用 | 步 1 的结果是 `advance` + `next: perform(<系统轮发信步骤>)`（6.1.4）；发信经 B 的 §5.2.5：`sendSystemRound(systemRoundContext(scope, signal), request)`（固定发送身份 `host:plan-round`），不照抄 `automationContext`；步骤名以 B 的 §5.2 为准；3b 的 `planresume:` 也在这一步发。**`sendSystemRound` 的 `skipped`（回执已 `committed`）显式接住**：不把它当新的可推进动作，也不伪造 `committed`；按已发读同一确定性消息/Query（审阅回步 5 的 `waiting`/结论，返修按步 5b 沿 `planfix:` 与它经 `planresume:` 续出的最后一轮读 `waiting`），然后继续选任务（6.1.5） | 已登记 |
| 9 | 读确切结论 | 下一轮回到步 3-5b；Query 已 `answered` 就读 6.3.3 的正文解析；返修按步 5b 读 `planfix:` 及其 `planresume:` 续轮的最后一轮 | — |
| 10 | 采用 / 转卡 | 采用走 `plans.applyPlanChange` 的平台身份（`src/core/work-graph/model/plan-contracts.ts:230`；今天同一个调用在 `src/business/workflow/intervention.ts:325`）；转卡只记下 `card` 的原因和卡来源，不写任何东西（6.1.5），**不在这里返回整趟 `waiting`** | — |
| 11 | "请知悉" | 采用提交之后由通知投影在下次读时出（6.4）；采用/转卡时 Host 导出任务书（6.4.3） | — |
| 12 | 派工 | 采用后同一次目标级选择继续往下选任务，返回下一条 `perform`（`prepare`/`start` 等，`src/business/workflow/contracts.ts:92`-`:93`），驱动开看守跑 Run；**候选转卡/审中/`wait: fix`（返修已发、等答卡或等新候选）/待改/`busy` 也走这一步**，能选到任务就返回 `perform`，选不到才在第 10 步保留的候选依据上合并成 `waiting` | — |

**为什么"登记在发请求之前"。** 依据 `plan-loop-design.md:228`（"用读前游标登记等待…然后才发请求，顺序同 v3 5.4"）。落地办法：驱动在发系统轮请求的那一步之前，先用本步的读前游标把这份 `waitBasis` 登记一次（步 7、步 8 的先后），下一次选择返回同一个依据的 `waiting` 时 `register` 合并、保留较早游标（`src/app/goal-wait-wakes.ts:86`-`:96`），不会重复标记，也不会漏掉"请求发出去、回答立刻回来"那种时序。

**读前游标只用一次。** 一轮的登记都用步 2 采的那一个；不在读完后再采新游标（DRV 的同一规则，`src/app/collaboration-driver.ts:1082` 的注释）。重启时没有内存里的游标，重建从记录读到的 `readThrough` 就是那一轮的事实水位（6.1.6）。

**重放不是第二次请求。** 步 5/5b 的重放只为拿到那条早已存在（或本轮将要发）的消息 ref：`sendMessage` 的 `meta.requestId` 相同、参数相同，回执是原消息（`replayed`），不新增记录、不新增唤醒；`sendSystemRound` 先读回执并返回 `skipped` 时同样按已发算，不重发。真正决定"发不发"的是 6.1.3 的 `request_review`/`request_fix`（返修还要看 5b 的三态），发信仍在步 8。

**"最新"取哪一份。** 设计说"每轮先看这个目标最新的 agent 候选"（`plan-loop-design.md:209`）。`queryGoal` 里的 `pendingPlan` 走的是 `findPendingProposal`（`src/core/work-graph/tasks/plan-readers.ts:555`），它按 **refKey 最小**选，不是按时间最新；同 `basedOn` 上同时有两份未采用候选时它会给出错的那份。这条按"偏差 2"报；本规格的读法：先按 6.3.1 的来源链（`planfix:` 父候选 + `planresume:` 原 Query 的 `sourceMessageRef`，两种首行都走）**排除已有后继的旧候选**（返修写的是新独立候选，旧版不写 `replaces`；续轮写出的候选也把 `fixBase` 当后继起点），剩下的同一 `basedOn` 上的 agent 候选按读模型已有的链位置比较取最新（`src/core/work-graph/views/decision-read-model.ts:2329` 一带的 `compareProposalChainPositions`），该读由一个窄读口提供（§21 的 C-11 `latestAgentCandidate`），不改 `queryGoal`。候选卡组卡时也按同一条来源链跳过已有后继的旧候选，否则人打开旧卡会读到已被返修版接替的版本。
#### 6.1.3 纯函数：这张表只有一个实现
新文件 `src/core/work-graph/state/plan-candidate.ts`（`state` 是纯子模块：只 import `src/contracts` 和本目录，`src/core/work-graph/state/README.md:6`）。**动作只在这一节**，函数是它唯一的实现；6.5 的派生状态只归类（`plan-loop-design.md:263`）。
```ts
// ---- 事实（调用方读齐后传入，纯函数不读存储） ----
export type PlanCandidateSourceV1 = 'agent_proposal' | 'refine' | 'fix' | 'planresume' | 'other';

export type PlanReviewReadV1 =
  | { status: 'not_sent' }
  | { status: 'waiting' }
  | { status: 'decided'; verdict: PlanReviewVerdictV1; findings: readonly PlanReviewFindingV1[] }
  | { status: 'terminal_invalid'; reason: string };  // 终态无答案/格式坏：转卡，不重发

/** 这一版（`proposalRef` + `revision`）的返修轮读取结果；三态互斥，见 6.1.2 步 5b。 */
export type PlanFixReadV1 =
  | { status: 'not_sent' }
  | { status: 'waiting' }                           // 已发：最后一轮 Query 未终态，或问题卡未全答/续轮未建，或终态但收尾没写完
  | { status: 'terminal' };                         // 最后一轮终态、收尾完成、仍没有后继候选：转卡

export type PlanCandidateFactsV1 = {
  proposal: {
    ref: PlanProposalRef;
    revision: number;
    basedOn: PlanRevisionRef | null;
    source: PlanCandidateSourceV1;
    /** `reason.affectedTaskIds`，模型自己写的；缺省为 []。 */
    affectedTaskIds: readonly string[];
  };
  /** 这一版（`proposalRef` + `revision`）的审阅读取结果；四态互斥，见 6.1.2 步 5。 */
  review: PlanReviewReadV1;
  /** 这一版已经发出的返修轮读取结果；只在 `review` 判 `fix` 时读（否则 null），见 6.1.2 步 5b。 */
  fix: PlanFixReadV1 | null;
  /** 同一 `basedOn` 上已经写出候选的 planfix 轮数（按链上 `planfix:` 消息身份去重，续轮写出的候选也归那一轮）。见 6.3.4 的数法与 §22 C-D8。 */
  completedFixes: number;
  /** `decisionActionPolicy({ action: 'refine_future', actorClass: 'system', autonomy, ... })`，`src/core/work-graph/state/decision-policy.ts:31`。 */
  adoptionPolicy: 'automatic' | 'automatic_notice' | 'needs_decision' | 'user_only';
  /** 这个工作区此刻有没有审阅线（`resolveDutyRecipient({ duty: 'reviewer' })` 非 null，见 6.3.1）。 */
  hasReviewLine: boolean;
  /** 6.2 的输出；空数组 = 诊断无问题；null = 检查覆盖读不到（不判自动采用，见 6.2 末）。 */
  diagnosis: readonly PlanDiagnosisFindingV1[] | null;
};

export type PlanCandidateDecisionV1 =
  | { action: 'request_review'; requestId: string }
  | { action: 'request_fix'; requestId: string; rounds: number }
  | { action: 'adopt' }
  | { action: 'card';
      reason: 'no_review_line' | 'fix_cap' | 'fix_invalid' | 'not_automatic' | 'diagnosis' | 'adoption_rejected' | 'review_invalid' }
  | { action: 'wait'; reason: 'busy' | 'review' | 'fix' };

/** 对应下面的判据表；采用出口的两行不在纯函数里，见 6.1.4。 */
export function decidePlanCandidate(facts: PlanCandidateFactsV1): PlanCandidateDecisionV1;
```

对应表（`plan-loop-design.md:211`-`:220`）：

| 设计行 | 判据（从上到下，先中先出） | 决定 |
|---|---|---|
| 没发，有审阅线 | `review.status === 'not_sent'` 且 `hasReviewLine` | `request_review` |
| 没发，没有审阅线 | `review.status === 'not_sent'` 且 `!hasReviewLine` | `card: no_review_line` |
| 已发、Query 未结束 | `review.status === 'waiting'` | `wait: review`（6.5 的“审中”，不重发） |
| 终态但没有合法结论 | `review.status === 'terminal_invalid'` | `card: review_invalid`（原因写进卡；不重发、不重审） |
| 审阅 `fix`，到上限 | `review.status === 'decided'` 且 `verdict === 'fix'` 且 `completedFixes >= 3` | `card: fix_cap`（先于返修读取判，已发未回的也不重发） |
| 审阅 `fix`，返修没发 | 同上且 `completedFixes < 3` 且 `fix?.status === 'not_sent'` | `request_fix`（`rounds = completedFixes + 1`） |
| 审阅 `fix`，返修已发/等答卡/等候选 | 同上且 `fix?.status === 'waiting'` | `wait: fix`（不重发；合并依据继续选任务） |
| 审阅 `fix`，返修终态无后继候选 | 同上且 `fix?.status === 'terminal'` | `card: fix_invalid`（转卡写原因；不重发、不重审） |
| `pass`，诊断无问题，`refine_future` 判 `automatic` | `review.status === 'decided'` 且 `verdict === 'pass'` 且 `diagnosis !== null` 且 `diagnosis.length === 0` 且 `adoptionPolicy === 'automatic'` | `adopt` |
| `pass`，其余情况 | 同上不成立 | `card`：`not_automatic`（策略不是 `automatic`）/ `diagnosis`（有 finding 或诊断读不到） |
| 采用回 `busy` | 不在本函数；采用出口 | `wait: busy`（6.1.4） |
| 采用被拒绝（越界、过期） | 不在本函数；采用出口 | `card: adoption_rejected`（6.1.4） |
- **四态互斥，不再压成 `null`。** `not_sent` 只表示消息回执 `not_committed` 且 Query `not_found`；`waiting` 表示消息已提交但 Query 未结束（含 Query 尚未建出来的窗口）；`terminal_invalid` 表示 Query 已终态却没有可解析的合法结论。**`terminal_invalid` 只转卡，永不重发同一请求**，否则终态坏答案不会重跑，候选会永久等审阅。读 Query/答案本身失败（`unavailable` 等）原样返回，不折成 `not_sent`。**`pass` 且 `findings` 非空不挡自动采用。** 设计只以"诊断无问题"和策略 `automatic` 为自动采用的条件（`plan-loop-design.md:217`-`:218`）；`findings` 是给人和参谋看的意见。要改成"有 finding 就转卡"是产品改动，不在本规格；**审阅 `fix` 时不看诊断。** 诊断的问题随审阅意见一起发（6.2、`plan-loop-design.md:234`），不单独为诊断开返修（PL-03）；**`automatic_notice` 走哪行。** `decisionActionPolicy` 对 `refine_future` 只回 `automatic` 或 `needs_decision`（`src/core/work-graph/state/decision-policy.ts:42`-`:43`），所以"每步确认"落到 `card: not_automatic`；`automatic_notice` 不是本动作的返回值，但类型保留，判断写成"只有 `automatic` 才自动采用"，不写成"只有 `needs_decision` 才转卡"。
- **返修只在没发时发。** `request_fix` 只在 `fix?.status === 'not_sent'` 返回；`waiting` 表示这一版已经发过（回执 `committed`，或 `sendSystemRound` 返回 `skipped`），且最后一轮（`planfix:` 本身或它经 `planresume:` 续出的轮）还没有给出终态后继：Query 未终态、卡没全答、续轮未建，或终态但收尾没写完；不再选发送步骤，按 6.1.5 合并依据继续选任务；`terminal` 表示最后一轮已终态、收尾完成而没有后继候选（无效答案、无答案或纯文字回答），转 `fix_invalid`，不重发。**不以原 `planfix:` Query 的结束判三态**：问人后续轮还在跑时是 `waiting`，不是 `terminal`。**后继候选已写出的旧候选由 6.3.1 的来源链排除，不走这一行。** `completedFixes` 只数已经写出候选的返修轮（直接写出或经 `planresume:` 续出都算同一轮），当前这轮没写出候选不计（6.3.4）。读 Query/消息/候选/问题/答案失败原样返回，不折成 `not_sent`。
- **`skipped` 不是新动作。** `sendSystemRound` 返回 `{status:'skipped', reason:'already_committed'}` 时，这一步已经做过：按已发读同一确定性消息/Query，把结果并进 6.1.5 的 `wait: review`/`wait: fix`，不当成 `committed` 再推进一步，也不重发。
#### 6.1.4 采用这一步：谁调、返回什么、拒绝怎么归
**谁调谁。** 目标级选择返回 `advance` + `next: { kind: 'perform', operation: { kind: 'adopt_plan', request } }`（新步骤，名字是规格新定，见 §21），请求就是 `plans.applyPlanChange` 的现有参数（`src/business/workflow/contracts.ts` 的 `WorkflowCalls` 加一项，类型直接取 `PlanTaskPort['applyPlanChange']` 的第二参数，沿用 `suggest_member`/`request_overlap_note` 的写法，`src/business/workflow/contracts.ts:157`、`:164`）。调用时用 `automationContext(owned)`（`src/business/workflow/workflow.ts:670`-`:675`），身份是 `WORKFLOW_AUTOMATION_ACTOR`，owner 由此判 `system`，不是人：
```ts
applyPlanChange(automationContext(owned), {
  input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] },
  meta: {
    // 固定身份：同一候选版本重试不会多采用一次。
    requestId: `plan-adopt:${proposal.ref.proposalId}:${proposal.revision}`,
    expected: [
      { ref: goal.ref, revision: goal.revision },
      { ref: proposal.ref, revision: proposal.revision },
    ],
  },
})
```

**采用这一步的出口（一个判断点，仍在 6.1）：**

| 结果 | 动作 | 依据 |
|---|---|---|
| `committed`（含 `replayed`） | 先按 7.3.1 第 5 步补发候选来源消息的唯一回复（执行者 M；人的普通消息已在候选写入时按原收尾结束，已有同答案回复则幂等返回）；再交回决定循环：同一次目标级选择继续选任务，出下一条 `perform`；采用提交后 Host 导出（6.4.3），通知投影在下次读时出"请知悉" | 设计 `:217`、`:219`、`:321`；DRV 的"交回决定循环" |
| `busy` | 保留候选，不写、不转卡；返回 `waiting` + 候选等待依据（含 `Run`、`TaskLease`、`SessionMessage`、`VerificationRound`、`Evidence`、`TaskRequeue`、`PlanProposal`、`PlanRevision`），等相关 Run 和等待的事实，下一轮重试 | 设计 `:219`（PL-06）；`src/core/work-graph/state/plan-machine.ts:663`、`:677`-`:681`、`:689` |
| 其他拒绝（`forbidden`/`revision_conflict`/`invalid`/`source_stale`/`unavailable`/`not_found`） | 转候选卡：返回 `waiting` + 候选卡来源 + 原因；不重试第二次 | 设计 `:220`；`CoreError` 闭集 `src/contracts/core/results.ts:16` |
| 候选在提交前已被替换/消失（`not_found`，或重读后 `basedOn` 不再指向活动计划） | 本候选不再是待决候选；不转卡，回到步 3 重读 | `src/core/work-graph/state/plan-machine.ts:157`-`:176`（`derivePlanProposalStatus`） |

**发信这一步的出口（`planreview:` / `planfix:`）：**

| 结果 | 动作 | 依据 |
|---|---|---|
| `committed`（含 `replayed`） | 登记后按 6.1.5 先继续选任务；能推进就返回 `perform`，没有其他可推进步骤才带 `wait: review`/`wait: fix` 返回 `waiting` | 6.1.5 |
| `skipped`（`reason:'already_committed'`） | **显式接住，不当成新的可推进动作**：不重发、不伪造 `committed`；按已发读同一确定性消息/Query 得 `wait: review`/`wait: fix`，再按 6.1.5 继续选任务 | 5.2.5；PLS-11/PLT-06/C-22 |
| `planfix:` 没有参谋线（`resolveDutyRecipient('adviser')` 为 null） | 转卡，`reason` 写 `review_fix`（这是发信出口的结果，不是纯函数的返回值），候选留给人；不发给秘书 | 103-1（`plan-loop-design.md:503`）；6.3.4 |
| 发信被拒绝（`forbidden`/`not_found`/`invalid`/`unavailable`） | 转卡，`reason` 写 `review_fix` 和原原因；不重试第二次 | `CoreError` 闭集 `src/contracts/core/results.ts:16` |
- **采用出口的两行（`busy` 和其他拒绝）不放进纯函数。** `busy` 和其他拒绝是"采用这一步"的结果；这个结果不在任何记录里，也没有内部参数承载（本规格不加内存字段，见 §21 的"不加"), 所以 `decidePlanCandidate` 的输入里没有"上次采用被拒"这一项。同一节的采用出口处理这两行，判断点仍只有 6.1 这一处。这条与设计 `:263` 的字面"整张表是一个纯函数"有出入，列在偏差 3；**`not_found` 的候选**：`readPlanProposal` 的 `not_found` 也归到上一行（候选不在了），不当成采用被拒；**替代在等的执行者**：候选采纳后要替代某个让出的 Run 时，"先取消让出的 Run、再采用、再回复"是 §7.3 的出口（D 写，`plan-loop-design.md:320`-`:327`）；本节只做采用这一下，不重复取消和回复。采用成功、替代、转卡这三种结果里，本节负责"采用成功"和"转卡"，"替代"的收尾在 D。
#### 6.1.5 出口形状

| 决定的动作 | Workflow 返回 | 谁接着做 |
|---|---|---|
| `request_review` | `advance`，`next: perform(<发系统轮>)`，`value.waitBasis` = 6.1.5 的依据（下面的代码块）；驱动先用本步游标登记，再执行该步骤。发完读同一确定性 Query：未结束就 `wait: review`，已结束就同一轮读结论；`skipped` 也按已发读这条 Query | Host 驱动发信；审阅线被消费（B 的 §5.2） |
| `request_fix` | 同上，请求号 `planfix:<proposalId>:<revision>`；**只在 5b 的 `not_sent` 才返回发送步骤**。发完不马上结束整趟：按 5b 沿 `planfix:` 与它经 `planresume:` 续出的最后一轮读 `wait: fix`，合并依据继续选任务；`skipped` 同样按已发进 `wait: fix`，不当成新的可推进动作 | 参谋线被消费（B 的 §5.2）；新候选的 `PlanProposal` 提交叫醒目标（`src/app/goal-wait-wakes.ts:31`-`:37`） |
| `request_resume`（3b 的续轮） | 同上，请求号 `planresume:<goalId>:<queryJobId>`；先登记 `plan_resume_pending`，再发；发完返回 `waiting`，等新候选 | 原规划线被消费（B 的 §5.2）；新候选写回后由候选分支接着处理 |
| `adopt` | `advance`，`next: perform(adopt_plan)`；不登记（提交本身会叫醒/继续） | Host 驱动执行采用 |
| `card` | **不立刻返回 `waiting`**：先回到同一次目标级选择继续选任务；选到 `perform` 就返回它。只有在没有其他可推进步骤时，才返回 `waiting`，`next: null`，`waitBasis` = 候选等待依据与本次选任务的等待依据合并（`reasons` 并入候选原因，游标取较早），`source` = 候选卡来源（`{kind:'candidate', key, subject, pins}`，形状照 `src/core/work-graph/views/decision-read-model.ts:1868` 一带），`reason` 写清哪一行 | 卡本来就在队列里（`src/core/work-graph/views/decision-read-model.ts:1844`）；Host 导出任务书；其他分支不被这张卡挡住 |
| `wait: busy` / `wait: review` / `wait: fix` | 同 `card` 的“先继续选任务、没有可推进步骤才等”的返回形状，但 `source` 不填卡来源（候选还没转卡），`reason` 写 `busy`/`review`/`fix` 与细节 | Run 结束/等待变化的提交叫醒目标后重试；审阅答复或返修新候选提交叫醒 |

**候选不阻断其他分支。** 候选处理在目标级选择之前跑，但 `card`/`wait` 只表示“这一条暂时没有立即动作”，不是整个 Goal 的结束。先继续现有的选任务流程：另一条分支能领取或接续新 Run 就照常返回 `perform`；只有整趟没有别的可推进步骤时，才把候选依据并进 `waiting`（设计 `:296`、`:298`“只挡那一支”）。这样审中、返修已发（`wait: fix`）、待改、待人或 `busy` 不会挡住别的段、别的任务或后来建出的线；`request_fix` 也不会每趟重选发送步骤把别的任务挤掉。

**等待依据（一处定义）。** 候选相关的等待统一用一个依据：
```ts
// 在 workflow.ts 里用现成的构造器，不手写对象。
goalWaitBasisOf(goal,
  ['plan_review_pending', 'plan_fix_pending', 'plan_fix_sent', 'plan_adoption_busy', 'plan_candidate_waiting', 'plan_resume_pending'],
  ['PlanProposal', 'PlanRevision', 'SessionMessage', 'Session',
   'Run', 'TaskLease', 'VerificationRound', 'Evidence', 'TaskRequeue'])
```
- `SessionMessage`：审阅回复、答卡提交（设计 `:228`-`:229`）；`PlanProposal`：参谋/Work Run 写新候选（设计 `:229`）；`PlanRevision`：别处采用了新计划，候选过期；`Session`：审阅线/参谋线晚于启动才建出来（5.5.3 的"绑定晚于启动"）；`Run`/`TaskLease`/`VerificationRound`/`Evidence`/`TaskRequeue`：`busy` 重试要等的"相关 Run 和等待的事实"（设计 `:219`）；六个 `reasons` 是等待理由的标签（字符串，不是记录），沿用现有 `plan_adoption`/`goal_state` 的写法；`plan_fix_sent` 是“返修已发、等答卡或新候选”的标签，`plan_resume_pending` 同时覆盖 3b 的续轮登记；lead 可以改名，不影响语义；构造器是 `goalWaitBasisOf`（`src/business/workflow/task-gate.ts:176`）；`register` 只按 `recordKinds` 和读前游标标记（`src/app/goal-wait-wakes.ts:102`-`:113`），多写几种 kind 只多几次唤醒，不会误判。
#### 6.1.6 叫醒和重启重建
**叫醒的三条路（都不新增机制）：**

1. 审阅轮结束时对 `planreview:` 消息写回复：同一个 `SessionMessage` 记录的 revision 提交，`SessionMessage` 在 `GOAL_WAIT_WAKE_AGGREGATE_TYPES` 里（`src/app/goal-wait-wakes.ts:31`-`:37`），驱动登记过就标记。
2. 参谋/Work Run 写新候选：`PlanProposal` 也在同一张表里（`:32`），登记过就标记。
3. Host 的 `consumeIdle` 处理完审阅轮的回复并关联答案后，队列排空调 `wake`（`src/app/host.ts:1874`-`:1880`、`src/app/goal-wait-wakes.ts:239`）。

**重启重建加一步。** `createGoalWaitRebuild` 今天两半：Work 等待（`src/app/goal-wait-wakes.ts:176`-`:183`）和已放行的行动请求（`:188`-`:200`）。各半都先问 `held`（`:178`、`:193`；97-9）。加第三半，同一个窄读也供每轮的 3b 用：
```ts
// 新注入的窄读：只读现有事实，不加记录、不加索引。
export type PlanningQuestionGroupV1 = {
  queryJobRef: QueryJobRef;
  /** 原规划轮的消息；只从本闭环的 intervention_planning execution.sourceMessageRef 读。 */
  originalMessageRef: SessionMessageRef;
  total: number;
  answered: number;
  /** 这一组问题全部有已存答复（total > 0 且 answered === total）；不是“卡还在 waiting_answer”。 */
  allAnswered: boolean;
  /** planresume: 消息或它的 Query 已经存在。 */
  resumeMessageExists: boolean;
};

deps.planCandidates(scope, ctx, goalRef?): Promise<
  | { status: 'ready'; goals: readonly {
        goalRef: GoalRef;
        pending: { proposalRef: PlanProposalRef; basedOn: PlanRevisionRef | null } | null;
        /** 只含本闭环来源的 intervention_planning 问题组；其他规划问题不进这里、也不算读失败。 */
        questionGroups: readonly PlanningQuestionGroupV1[];
        readThrough: CommitCursor | null }[] }
  | CoreRejection>;
```
- 实现：`goalRef` 给出时只读这个 Goal，否则按工作区枚举**没结束的 Goal**（`active`；`paused` 由 97-9 的 `held` 处理，人启动后进恢复；现成的 `listGoals`，`src/core/work-graph/tasks/reconcile-reads.ts:39`、`:99`；索引 `GOAL_BY_WORKSPACE_INDEX`）。**`completed`/`cancelled` 的 Goal 不读**：那里没有还在等 M 的执行者，不用补回复。每个 Goal 用 `findPendingProposal`（`src/core/work-graph/tasks/plan-readers.ts:555`）读候选；用现有 `readPlanningQuestions`（`src/core/work-graph/tasks/planning-question-reader.ts:176`、`:201`）**只枚举问题身份和它的 `DecisionSourceV1`**，不要拿它返回的 `state`/`answer` 当答复——那张卡始终是 `waiting_answer`、`answer:null`。**自动续轮分支只处理有本闭环来源的问题组**：按卡的 `source.pins` 找原 QueryJob，`execution.kind === 'intervention_planning'` 且 `execution.sourceMessageRef` 存在才收进 `questionGroups`；初始化/普通 `initial_coordination` 等没有来源的规划问题**保留原读和原流程**，不进组、不当读失败——一张历史问题不能拒绝整个 Goal 的候选读（PLT-14）。对进组的每张卡调现有 `readDecisionAnswer({source: card.source})`（`src/core/work-graph/communication/decision-service.ts:843`；由组合根以目标卡的正式读身份注入），`message !== null` 才算这一问有答案；按卡 `source.pins` 里的 `QueryJobAnswer.queryJobId` 分组，原消息取原 QueryJob 的 `intent.execution.sourceMessageRef`；用 `systemRoundRequestId({kind:'planresume',...})` + `systemRoundMessageRef`/Query 读判 `resumeMessageExists`。**读失败原样保留**：问题枚举、进组卡的答案读、消息/Query 读任一步返回 `CoreRejection`，整条 `planCandidates` 返回它，不折成“没有待答/没有未续轮”；**不进组的规划问题不参与这条读**。
- `readThrough` 取这些读的批次水位；登记：`registry.register({ projectId, goalId, recordKinds: [<候选依据的 kinds>, 'SessionMessage', 'PlanProposal'], reasons: ['restart'] }, readThrough)`，和现有两半同一个 `register`（`:86`）；`held` 的目标照样跳过（97-9 不绕过）；`ask`/`off` 档下有待处理中断的 Goal 不登记，等人 `workflow/driver-start`（`plan-loop-design.md:230`、`:501`）；只登记“有候选、或有 `allAnswered === false` 的问题组、或有 `allAnswered === true && resumeMessageExists === false` 的问题组、或有已采用候选但源消息未回复”的 Goal，不登记全部 Goal（否则每个 Goal 都会在启动时被拉起一次，改变 97-9 的静默）。这第三半的读是新增的窄口，列在 §21（C-11 的 `planCandidates`）；它与 3b 共用同一组事实，偏差 2 里说明为什么 `queryGoal` 的单条不够。**终态收尾缺失不靠 Goal 登记**：`settlementOfferOf` 在每次 `readConsumableSessions` 扫描时按源消息直接给报价（5.5.2，含候选已写、R 未关联的情况），目标没被登记也会被 Host 消费。
- **崩溃窗口的续做（PLT-02/09/C-26）。** 第三半和 3b 不能只读 pending 候选：`findPendingProposal` 只给 `candidate`，采用后候选已 `accepted`，不会再进 pending；Query 已 `settled` 也不会被 `resumeOfferOf` 供给。每个 Goal 用 `acceptedCandidatesOf(goalRef)` 读**这个 Goal 的所有已采用候选**（不是只读活动计划那一版：P2 采用后回复失败、人又采用 P3，再重启时 P2 的未回复 M 必须仍在恢复集合里）；对每一条已采用候选，按 6.3.1 的来源链 + `repliesToMessageRef` 找到它要收尾的 M（`sourceMessageRef === null` 的初始化/请求槽候选跳过——没有在等 M 的执行者），若 M 仍是 open wait、`response===null`，就登记这个 Goal，并让目标循环**只补回复**（`respondFromQueryAnswer`，固定 `intervention:<messageKey>:respond` 身份，不再采用、不再 propose）。这条读不加记录：`acceptedCandidatesOf` 是 6.7.1 的窄读；恢复时按已有 `intervention_planning` Query、确定性 `proposalRef` 和消息事实续做，**不依赖重新投递源消息，不新建 Query 或恢复记录**。

---
### 6.2 机械诊断
**规则只有一条**（`plan-loop-design.md:236`）：每条**必需**验证要求都有已注册的检查能覆盖；`reviewer` 类在第 9 片之前算不覆盖。它防的是"任务采用后永远完不成"（`plan-loop-design.md:49`）。义务映射、依赖环、模块存在现有校验已经查（`:238`），不重复。文件是否存在、任务书写没写全、重叠模块有没有约定，**不做**（`:240`），交审阅者，N 门在派工时兜底。

**算法复用。** `compileVerificationPlan`（`src/core/work-graph/evidence/verification-plan.ts:61`）里的覆盖循环（`:85`-`:114`）抽成一个纯函数，**不能伪造已采用快照**（`:236`）。抽出来的位置：`src/contracts/verification.ts`（`state/` 只能 import contracts，`src/core/work-graph/state/README.md:6`），`verification-plan.ts` 改成调用它，编译结果逐字节不变（`planDigest` 的输入不变）。
```ts
// src/contracts/verification.ts
export type VerificationCoverageV1 = {
  /** 与今天 `compileVerificationPlan` 的 `checks` 同形：每个覆盖能力一条，带它的 coverage。 */
  checks: VerificationCheckPlan[];
  /** 与今天编译结果里的 `uncovered` 同形、同序。 */
  uncovered: { obligationId: string; requirementId: string; kind: VerificationCheckKind }[];
  /** 必需义务一条必需验证要求都没有：今天编译器的 `invalid`；诊断不重复报它（那一条归 plan 校验）。 */
  emptyRequiredObligation: string | null;
};

export function compileVerificationCoverage(input: {
  obligations: readonly AcceptanceObligation[];
  /** 政策已解析的 `requirementKinds`，不是内置默认。 */
  requirementKinds: readonly string[];
  /** 只读的已注册检查能力。 */
  checks: readonly CheckCapabilityV1[];
}): VerificationCoverageV1;
```

**诊断纯函数（`state/`）：**
```ts
// src/core/work-graph/state/plan-candidate.ts
export type PlanDiagnosisFindingV1 = {
  obligationId: string;
  requirementId: string;
  kind: VerificationCheckKind;
  code: 'no_registered_check' | 'reviewer_not_supported';
  /** 给审阅者和人看的一句话；纯文本，不含引用。 */
  message: string;
};

/** 只读事实；不读存储、不看时钟、不调工具。找不到问题返回 []。 */
export function diagnosePlanCandidate(input: {
  /** 候选的草案（义务和验证要求都在里面）。 */
  candidate: Pick<PlanRevisionDraft, 'obligations'>;
  /** 候选按哪个 catalog 检查的（`PlanProposal.catalogPin`）；只作为审阅输入的事实，不在这里查模块存在。 */
  catalogPin: ArchitectureCatalogPinV1 | null;
  /** 政策的 `requirementKinds`。 */
  requirementKinds: readonly string[];
  /** 已注册检查能力（Host 的受信检查配置，`src/core/work-graph/evidence/evidence-service.ts:992` 的同一来源）。 */
  checks: readonly CheckCapabilityV1[];
}): PlanDiagnosisFindingV1[];
```
- `code: 'reviewer_not_supported'` 只对 `kind === 'reviewer'` 的必需要求出（第 9 片前）；其余未被覆盖的要求是 `no_registered_check`。依据：`plan-loop-design.md:236`、`:49`。
- **诊断失败不单独返修（PL-03）。** 诊断只在两处出现：审阅输入（6.3.2）和候选卡（6.4 / 6.5）；有 finding 时候选**不能自动采用**（6.1.3 的表），审阅者看得到并可以让参谋改；改不了就转卡（`:234`）。不另开诊断返修循环。
- **`emptyRequiredObligation` 不进 finding。** 那种草案已被 plan 校验拒绝、根本写不成候选（`verification-plan.ts:86`-`:89` 的 `invalid`），不是诊断的对象；这里写明只是让复用的函数保留原判定。
- **输入里的检查覆盖从哪来。** 今天只有 Evidence 的 `RoundPreparation` 有它（`evidence-service.ts:992` 由 `configuration.checks` 造能力）。Workflow 的 `WorkflowHostConfiguration`（`src/business/workflow/ports.ts:64`-`:72`）没有它。规格给一个窄读口：`checks: (scope) => readonly CheckCapabilityV1[] | null`（复用 `CheckConfigurationResolver` 的现有形状，`src/core/work-graph/evidence/evidence-service.ts:812`），由组合根注入。读不到时**不**出空 finding、也**不**当成"无问题"：`diagnosis` 传 `null`，6.1.3 的 `adopt` 行不成立，走 `card`（`reason: 'diagnosis'`），卡上写"检查覆盖读不到"。依据：设计原则 5"读不到写未知"，以及"有 finding 不能自动采用"（`:234`）不能退化成"读不到就能自动采用"。这条是规格新定（§21 的 C-12）。

---
### 6.3 审阅轮
#### 6.3.1 审阅线、请求号、绑定
**线从哪来（D9，PL-10）。** 审阅者是单独的第五种职责（`plan-loop-design.md:244`）；平台档已经有它：`role-profiles.ts:54`-`:62` 的 `reviewer`（`responsibility: ['verification']`，`behaviorSkillId: 'platform-reviewer'`），工作台运行配置也认 `'reviewer'` 这个行为/绑定（`src/app/runtime-configuration.ts:72`、`:150`-`:160`）。**建线**归 7D2 的 `role_line_add`：现有入口都不收审阅者（`member_creation` 只支持执行者，`role-lines/open` 只收秘书、参谋、书记），7D2 的 `role_line_add` 要加审阅者，底下走 6A 的共用建线入口；7D2 之前用外部配置或人手动建线（`plan-loop-design.md:251`）。内建设置发布路径要补参谋、审阅者的 binding、Query profile 和只读工具（`:251`）——都在 7D2，不在本段。

**本段的依赖边界。** 本段只消费三件事，别的不碰：

1. 一个“找审阅线”的读：复用 `resolveDutyRecipient`（`src/core/work-graph/sessions/duty-recipient.ts:22`-`:29`），它的 duty 联合今天只有 `'adviser' | 'secretary' | 'scribe'`，加 `'reviewer'`（一行；非 scribe 分支本来就按 duty 相等筛，`:43`-`:55`）。这是 L35/7D2 的收件人，PL 先用到；没有返回就是“没有审阅线”。
2. 一条能收 `action_request` 的只读 Query 线：审阅轮的 Query 由 B 的 §5.2 消费路径创建（同一个 `intervention_planning` 臂，`src/business/workflow/intervention.ts:177`-`:342` 是今天的先例），Query profile 就是审阅线自己的 `WorkbenchQueryProfile`（Host 的 `consumeIdle` 按 `sessionRole` 选 profile，`src/app/host.ts:1840`-`:1845`）。
3. 回信：审阅轮结束时把正式答案关联回 `planreview:` 消息，走现成的 `associate_answer`（`src/business/workflow/intervention.ts:136`-`:160`；Host 在 `src/app/host.ts:1874`-`:1880` 调）。`SessionMessage` 提交叫醒目标（6.1.6）。

**不做什么。** 审阅不写证据、不碰完成归约（`plan-loop-design.md:248`）；不是检查证据；不新增记录种类；不让审阅线写候选（审阅只出结论，`plan-loop-design.md:247`）。

**审阅轮的身份是冻结的 `answerShape`，不是正文前缀。** 今天审阅轮是 `intervention_planning` 普通 Query，只有请求号 `planreview:` 能说明它是审阅；消息记录不存 `requestId`（`state/message-machine.ts:220`-`:292`），`messageId` 是哈希（`mailbox-service.ts:1251`-`:1255`），所以读取侧不能靠前缀选工具。定法（C-17）：
- **在哪算。** Query 创建处的平台代码算一次。`handleIntervention` 读到收件线 duty 后调用 `planningAnswerShapeOf(message, duty)`（§5.2.4）：`host` 系统的 `SYSTEM_ROUND_ACTOR`（`id: 'host:plan-round'`）且消息是 `action_request` 时，收件 duty `reviewer` → `'plan_review'`；duty `adviser`/`secretary` → `'plan_round'`；其他 Host 自动发送（`overlap-note:` 的 `workflow:auto-rework`）→ `'text'`；人和 agent 发给参谋/秘书的规划请求 → `'plan_round'`，发给审阅者的 → `'text'`。`planOnIdleLine` 把结果写进 `QueryJobIntentV1.execution.answerShape`；准备阶段原样复制进 `PreparedQueryManifestV1.answerShape`；启动只读清单。**不解析正文、不解析请求号。**
- **怎么防伪造。** 模型不能写 QueryJob intent、准备清单或 `promptSet.toolNames`；`validQueryExecution`（`src/contracts/query-job.ts:354`）只允许 `intervention_planning` 带 `'plan_round' | 'plan_review' | 'text'` 这个字段；启动时 `finalToolNamesOf` 用同一个 `answerShape` 重算工具名，和清单冻结的 `promptSet.toolNames` 逐项比，不一致 → `forbidden`（`query-execution.ts:373`-`:377`）。正文写什么、请求号叫什么，都改不了工具表。请求号仍只负责消息/Query 身份和同一版只发一次（6.3.1 后半）。
- **重启后怎么重建。** 不重建：`execution.answerShape` 和 `manifest.answerShape` 都在持久记录里；重启读原值启动。**不保留旧清单兼容**：清单缺 `answerShape` 按损坏处理（`unavailable`），不用 `legacyAnswerShapeOf`、不按 `manifest.request` 回推；审阅轮在本规格之后创建，一定有 `'plan_review'`。不靠正文或请求号补算（PLS-27）。
- **绑定晚于启动。** 形状在 Query 创建时冻结；之后建审阅线不会改已创建 Query 的形状。没有审阅线时根本不建审阅 Query（6.3.4）。

**请求号（`plan-loop-design.md:222`、`:574`）。**
```
planreview:<proposalId>:<proposalRevision>
```

| 段 | 从哪取 |
|---|---|
| 前缀 | 固定字面量 `planreview:`（§5.2 的前缀表） |
| `proposalId` | 候选的 `PlanProposalRef.proposalId`（`src/core/work-graph/state/plan-machine.ts:59` 的 ref 形状；值由 `planProposalIdFor` 决定，含 project/workspace/goal/requestId 的哈希，`src/core/work-graph/tasks/plan-service.ts:396`-`:398`，所以全项目唯一，不加 goalId） |
| `proposalRevision` | 候选记录的 `revision`（`src/core/work-graph/state/plan-machine.ts:93`；新候选是 1，被采用后 +1，`acceptProposalRecord` `:141`-`:143`）。**已采用候选读它当时的审阅结论时取 `revision - 1`（接受前版本，6.4.2）；候选尚未采用时仍取当前 `revision`**，不按接受后的 +1 重算 |
**构造和解析只走统一正本。** 这一段不新增 `planReviewRequestId`/`parsePlanReviewRequestId`：构造直接调 5.2.2 的 `systemRoundRequestId({kind:'planreview', goalRef, proposalId: proposal.ref.proposalId, proposalRevision: proposal.revision})`；读取直接调 5.2.6 的 `systemRoundOfText`（它已经能给出 `proposalId`/`proposalRevision`）。需要便捷名字时只做无规则的薄包装，不复制格式串、不另写解析器（M-1 只留一份）。

**“旧结论不用在新候选上”怎么证（PL-02）。** 三段都是确定的：请求号含 `(proposalId, revision)`；消息 id 由 `(projectId, workspaceId, 发信身份, requestId)` 哈希（`src/core/work-graph/communication/mailbox-service.ts:1251`-`:1255`）；审阅 Query 的 Job/Run id 由消息 ref 哈希（`interventionPlanningQueryRefs`，`src/contracts/query-job.ts:104`-`:112`）。所以换一版候选就换一条消息、换一对 Query，目标循环**只读它按当前候选算出来的那一对**，别的版本的答案在身份上就到不了这里。测试 43 的具名变异见 §15 的 PL-43。

**同一来源链跨两种首行（`planfix:` 和 `planresume:`；D13、D14，对设计第 7.3 节的偏差）。** 返修请求号仍是 `planfix:<proposalId>:<revision>`，指“要改的那一版候选”。参谋这一轮写成**新的独立候选**：新的 `planId`/`proposalId`，`basedOn` 是被审候选的 `basedOn`（同一条正式计划），`sourceMessageRef` 是这条 `planfix:` 消息；`planfix → 问人 → planresume → 新候选` 时，续轮写出的也是同一条链上的**新独立候选**，`basedOn` 是 `fixBase.basedOn`，`sourceMessageRef` 是那条 `planresume:` 消息。都不写 `replaces`、不走候选替换事件、不改 Query 来源、不加字段。**来源链的唯一定义（`src/core/work-graph/tasks/plan-lineage.ts`，建议）：**
```ts
export type PlanSourceLineageV1 = {
  /** 链上最初的源消息（执行者 M 或最初的系统 R）；续轮冻结 repliesToMessageRef/followupOf 时用它。 */
  rootMessage: SessionMessageRef;
  /** 链上跨过的最近一条 planfix: 轮；没有就是 null。按它给 completedFixes 的轮去重。 */
  fixRound: SessionMessageRef | null;
  /** 那一轮要修的候选；没有 fixRound 就是 null。planresume 的合并 base 和 basedOn 取它。 */
  fixBase: PlanProposal | null;
};
/** 从一条源消息（候选的 sourceMessageRef 或 planresume 消息）沿链读到 root；读失败原样返回。 */
export function planSourceLineageOf(source: SessionMessageRef): Promise<ReadResult<PlanSourceLineageV1>>;
```
- 走法：读消息正文首行，用 `systemRoundOfText` 取 `kind`；`planfix` → 读父候选 `{proposalId, proposalRevision}`（`readPlanProposal`），**第一次遇到时**记 `fixRound = 这条 planfix: 消息`、`fixBase = 父候选`（`??=`，继续往回不覆盖），再从**父候选的 `sourceMessageRef`** 继续；`planresume` → 用 `head.queryJobId` 读原 QueryJob，取 `execution.sourceMessageRef`，再从它继续（原 Query 可能正是返修 Query，于是下一步就是 `planfix:`）；其他首行 → 到此为止，当前消息是 `rootMessage`。每一步都往更早的提交走，不会回环；消息/候选/Query 任一读失败原样返回，不猜。`fixRound`/`fixBase` 是链上**最近**的那一轮（第一次遇到的），`rootMessage` 是最早的那条。
- **后继关系：** 候选 B 的 `planSourceLineageOf(B.sourceMessageRef).fixBase` 指向候选 A，就说明 B 接替 A；`latestAgentCandidate` 和候选卡按这个关系**排除已有后继的旧候选**，直接写出的返修候选和经 `planresume:` 续出的候选都算。旧版只被排除，不改记录、不写 `replaces`。合并 base 取 `fixBase.draft`，`basedOn` 取 `fixBase.basedOn`（6.1.2 步 3 之后的 planresume 分支、5.1.2）。返回身份仍不解析正文其余部分、不加字段（M-1）。

**续轮 `planresume:` 怎么用 `repliesToMessageRef`（B 的 5.2）。** 本段不定义它。目标循环只用一条事实：候选的 `sourceMessageRef` 若是 `planresume:` 消息，则来源和“回答”的比较按 §5.2/§7.3 的 `repliesToMessageRef` 精确比（`plan-loop-design.md:145`、`:327`）；审阅请求号永远不带 `planresume:`。**续轮冻结 `prev.repliesToMessageRef ?? lineage.rootMessage`**：新 Query 继承原 Query 的 `repliesToMessageRef`，原 Query 没有才用来源链的 `rootMessage`（最初执行者 M），不是复制这条 R 的 `followupOf`；否则 `planfix → 问人 → planresume` 会把原 planfix Query 缺的 `repliesToMessageRef` 落成中间那条 R，采用/回复时找不到仍在等的 M（PLT-06/C-25/C-33）。
#### 6.3.2 审阅输入模板
**谁渲染、什么时候。** 审阅轮的 Query 的 `question` 是请求正文（和干预轮同一条路：`intent.question`，`src/business/workflow/intervention.ts:201`）；准备阶段把审阅模板渲染后附在问题后面（和 `initial-planning-answer` 今天附在 `intervention_planning` 后面同一位置，`src/core/agent-runtime/query-preparation.ts:368`-`:380`）。**准备阶段按冻结的 `answerShape` 选指南：** `plan_review` 只附 `plan-review-input`，不附 `initial-planning-answer`；`plan_round` 只附 `initial-planning-answer`；两者都不附在普通 Query 上。模板 id `plan-review-input`，文件 `resources/prompts/platform/templates/plan-review-input.txt`，槽表加在 `src/contracts/prompts/slot-tables.ts`（现有 `intervention-planning` 的六槽旁边，`:45`-`:50`）：
```
'plan-review-input': {
  prelude: { required: false }, role: { required: true }, goal: { required: true },
  plan: { required: false }, candidate: { required: true },
  diagnosis: { required: true }, message: { required: true },
}
```

**正文（照 `unknown-call-review.txt` 的简洁度）：**
```
## 计划候选审阅
这一轮只审计划，不执行任务、不改工作区、不写证据。
**审阅范围：只审这一版新写或改动的任务书、义务和依赖差异。已采用的目标、阶段骨架和已采用的段是依据，不是被审对象；不要重审它们。发现上层缺陷时按第 7 节另走。**
## 目标与已采用计划（依据）
{{goal}}
{{plan}}
## 这一版的候选（这一版新写内容的完整任务书、义务和依赖差异）
{{candidate}}
## 机械诊断（平台只判事实；不是入图门槛）
{{diagnosis}}
## 请求
{{message}}
## 你要回答
1. 任务边界是否合适；2. 任务书够不够让执行者不猜（范围、先看什么、怎么做、接口、验收、不做什么、复用什么）；
3. 依赖和并行安排；4. 前提对不对；5. 有没有漏掉义务；6. 有没有该复用的。
结论只能是 pass 或 fix；fix 时每条 finding 写清哪个任务、要改什么。
用 `submit_plan_review` 填这张表：`verdict` 和 `findings` 是你要填的全部；`schemaVersion`/`kind` 由工具填。
如果这一轮没有这个工具（例如夹具直接写文字），按同一 JSON 形状交出全文，目标循环同样解析。
```

**各槽的事实来源：**

| 槽 | 来源 | 复用 |
|---|---|---|
| `role` | 本轮的角色/职责文本 | 现成的 Query 配方（`src/core/agent-runtime/context-query-recipe.ts` 的 role 槽） |
| `goal` | 目标行 | 现成的 `goal` 槽 |
| `plan` | 已采用计划（`manifest.focusPlan`）的**依据**：段骨架（标题、stageId、description）、每个任务的标题/scope/disposition、义务（含 taskIds/verificationRequirements）、`executionDag.dependsOn`、`inputRequirements`；任务书 `instruction` 只作背景，不是被审对象 | 现成的 `task`/`plan` 槽写法（`query-planning-input.txt`、`intervention-planning.txt`），外加 `deriveFuturePlanDelta` 的 source 侧事实 |
| `candidate` | 这一版新写内容的**完整任务书**，不是摘要：新增/改动任务的 `assignment.instruction` 全文、`estimatedLines`/`sizeClass`、新增/改动的义务和验证要求、`executionDag.dependsOn`/`taskRelations`/`inputRequirements` 的差异（新增/删除/替换的边和端点），外加 `deriveFuturePlanDelta` 的新增/改动/取消/只改处置四组 taskId 清单。只列这一版动到的任务；已采用段不重抄 | `deriveFuturePlanDelta`（`src/core/work-graph/tasks/plan-validation.ts:348`）定改动集；`taskCardOf(... assignment?.instruction ...)`（`graph-context-reader.ts:1869`）取全文；`queryPlanSummary`（`context-fact-text.ts:363`）只用于 `plan` 背景 |
| `diagnosis` | 6.2 的输出（空写“无”） | 新渲染，纯文本行 |
| `message` | 请求正文 | 现成 |

**候选怎么被准备阶段读到。** 审阅轮的请求号里有 `proposalId`（6.3.1），准备阶段从自己的 project/workspace 和这个 id 组 `PlanProposalRef`，用现成的 `plans.readPlanProposal` 读候选（`PlanTaskPort.readPlanProposal`，`src/core/work-graph/model/plan-contracts.ts:228`；装配依赖里已有可选的 `plans`，`src/core/agent-runtime/context-types.ts:39`-`:41`）。**`proposalId`/`revision` 从 `systemRoundOfText(record.job.job.intent.question)` 的首行取**（这是 M-1 允许的“读正文时解析首行”的同一解析；这里只用于候选身份，不用于工具选择）；首行解析不到、或候选读不到，这一轮准备失败（`invalid`/`unavailable`/`not_found`），不拿已采用计划或“最新候选”冒充。**64 KiB 只约束保存的请求正文（`planreview:` 消息和 Query 的 `question`）**；候选槽是准备阶段从 `readPlanProposal` 读出来再渲染的，不占 `question` 的字节，也不因为候选大就拒绝这一轮：完整候选随准备输入一起装配，装不下时走现有容量出口（5.3.5 的 `ContextCapacityExceeded`），不截断、不退回标题摘要，也不把已采用计划冒充成候选。

**为什么诊断放进请求正文。** 6.2 说“随候选写进审阅输入”（`plan-loop-design.md:234`）；诊断的输入（检查覆盖）只有 Workflow 这一侧读得到（6.2 末），所以由目标循环把 finding 行写进 `planreview:` 的正文，模板原样显示；准备阶段不重算诊断。
#### 6.3.3 审阅答案工具（冻结的 `submit_plan_review`）
**工具名和 schema。** 审阅轮冻结 `submit_plan_review`（名字是规格新定；设计只给“答案工具”）。工具在 `src/core/agent-runtime/answer-tools.ts`，和 FA 的三个 submit 工具同一个工厂、同一条接受/屏障路径。
- **参数（Kernel schema）**：根对象，strict，`{ verdict: enum(['pass','fix']), findings?: array(object({ taskId: string|null, text: string })) }`。`findings` 可省：`pass` 省了就是空数组，`fix` 省了由内容检查拒。和 `answerSchemaFor`（`answer-tools.ts:382`）、`buildSchemas`（`whiteboard-tools.ts:190`-`:217`）同一写法：无 transform、不把根 union 交给 Kernel。
- **平台填的固定成员**：`schemaVersion: 1`、`kind: 'plan_review'`、`pass` 缺省时的 `findings: []`。**模型填**：`verdict`、`findings`（可省）。工具不接受模型给 `schemaVersion`/`kind`/`reviewer`/`reasons`/`affectedTaskIds`。
- **接受后写进 `QueryJobAnswer.answer` 的正文**（恰好一个 JSON 对象）：
```json
{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}
```

或
```json
{"schemaVersion":1,"kind":"plan_review","verdict":"fix","findings":[{"taskId":"task-3","text":"把先看什么写进 instruction"}]}
```

`taskId: null` = 计划级意见；非 null 指向候选里的任务。`findings` 的元素形状设计没给，这是规格新定（§21 的 C-2）；解析器不校验 taskId 是否真的在候选里（审阅意见可以指向被删掉的旧任务，这是语义，不是形状）。

**校验和出口（照 FA 的 `executeSubmit` 四步，`answer-tools.ts:562`-`:606`）：**

1. `planReviewAnswerText(form)` 生成上面的文本（`src/contracts/plan-review.ts`，纯函数）。
2. 长度：`Buffer.byteLength(text,'utf8') > MAX_ANSWER_BYTES`（16 KiB）→ `rejectedResult(callId, { status:'rejected', code:'capacity', reason:'…' }, …)`。**审阅答案仍 16 KiB**；不放宽。
3. 形状/内容：`answerProblems('plan_review', form, text, null)` 调 `parsePlanReviewAnswer(text)`。解析器严格拒绝：不是恰好一个 JSON 对象（前后有任何文字/代码框）；`schemaVersion !== 1`；`kind !== 'plan_review'`；有未知成员；`verdict` 不在枚举；`findings` 不是数组；某条 finding 不是对象、`text` 空或不是字符串、`taskId` 既不是字符串也不是 `null`；**`fix` 的 findings 为空**。`pass` 带 findings 是允许的，只做结构校验。拒绝是一句话或 `problems`，原样给人和参谋看；工具返回 `{status:'rejected', code:'invalid', problems}`。
4. 接受：`success(callId,{status:'accepted'})`，callId 进 `acceptedAnswerCallIds`；`createAnswerToolBarrier`（`answer-tools.ts:528`）在本组结果提交后 `yield`，Turn 结束。工具被拒时不进 accepted，本轮继续；模型按返回的 problems 改完再交，同一轮可多次调用。
5. 事实读失败：审阅工具不读 `secretaryFacts`，只读冻结的 manifest/QueryRun 上下文（项目号）；没有“读项目事实失败”的出口。写 `answer.answer` 仍走观察器现有的 `storeArtifact` + 答案记录（`query-observation.ts:526`、`:540`-`:560`），不新增存储。

**工具怎么进冻结工具表（C-1 的落法）。**
- Query 创建：`handleIntervention` 的 reviewer 分支走 §5.2 的 `planOnIdleLine` 骨架，`planningAnswerShapeOf` 返回 `'plan_review'`，写进 `execution.answerShape`（`QueryJobIntentV1` 的 `intervention_planning` 臂，5.2.7）。
- 准备：`queryAnswerShapeOf(execution, null)` 得 `'plan_review'`，`finalToolNamesOf({ ..., answerTools:'plan_review' })` 选 `submit_plan_review`，冻结进 `promptSet.toolNames`；同一值写进 `manifest.answerShape`。
- 启动：`manifest.answerShape` 为 `'plan_review'`，`finalToolNamesOf` 重新算出同一个名字，和冻结名单逐项比；不一致 → `forbidden`。`answerSubmitNamesIn(frozenToolNames)` 得到 `['submit_plan_review']`，`createAnswerTools` 按 `plan_review` 建工具；不再要求 `manifest.request !== null`。
- 观察器：`submittedAnswerArgumentsOf(runState, submitNames)` 取第一条成功的提交参数；`buildAnswerText('plan_review', submitted, {projectId})` 重建同一条协议文本；`answer.answer` 就是上面的 JSON。**`parseSecretaryAnswer` 不加 review 分支**：审阅答案不是秘书 v1/v2 协议，硬塞进去会多一个不属于它的格式；审阅的解析只在 `src/contracts/plan-review.ts` 一处，目标循环读答案时调用。
- 读取：目标循环只为这一版候选算 `planreview:<proposalId>:<revision>`，用 `systemRoundMessageRef`（5.2.6/M-1）算消息和 `interventionPlanningQueryRefs` 的 Query 对，**不发送**；`readQueryJob`/`readQueryAnswer` 读正文；`parsePlanReviewAnswer` 两条生产路（工具提交、写文字）都吃。

**写文字的退路（FA 的 `formalAnswerOf` 保留）。** 一轮结束时若 `submit_plan_review` 没有接受提交，观察器仍读最后的非空 assistant 文本，按 16 KiB 截断规则：≤16 KiB 的文本原样存进 `answer.answer`；超过 16 KiB 走普通 Query 的现有 `gap`（不是 `invalid`，不新造结果）。目标循环对文字答案同样调 `parsePlanReviewAnswer`：解析成功就用；解析失败 = 这一轮终态没有可用结论，按 6.1.3 的 `terminal_invalid` **转候选卡**并写原因，**不造回复、不重发同一请求、不重审**。工具拒绝后模型继续写文字也走这条路。

**`reviews` 的落点。** 计划审阅结论**不写** Task 行的 `reviews` 字段（那是 unknown-call review 记录，`plan-service.ts:892` 的 `facts.reviewsByTaskId`），也不写证据、不碰完成归约（`plan-loop-design.md:248`）。结论只存在于 `QueryJobAnswer.answer`（和它回复的 `planreview:` 消息）；目标循环读它、采用/转卡时用；UI/卡的“审阅结论”从这条答案重算，不另建卡表。

**回复消息只写短结论。** 审阅轮收尾时发给 `planreview:` 原消息的回复按 5.3.5 的 `planningReplyTextOf` 派生：`pass` → `审阅通过`；`fix` → `审阅要求返修：<n> 条意见，见 Query <queryJobId>`（`n = findings.length`）。**不复制 16 KiB 的结论 JSON 全文、不复制候选任务书**；明细由 `queries/read`/`queries/answer` 读同一条答案。回复走普通消息 16 KiB 上限（5.3.5），审阅答案本身仍是 16 KiB，两者都不放宽。

**工具拒绝、没有审阅线、重启。**
- **工具拒绝**：`capacity`/`invalid`/`problems` 原样给模型，模型同一轮改完再交；屏障只在接受时结束 Turn。没有接受提交时文字退路仍在（上一段）。
- **没有审阅线**：不建审阅 Query、不挂工具、不发 `planreview:`；候选转卡 `no_review_line`（6.3.4）。不发明“审阅通过”。
- **重启**：`execution.answerShape='plan_review'` 和 `manifest.answerShape` 都是持久事实；重启后重驱仍挂 `submit_plan_review`，已答的 Query 直接读原答案，不重发、不重审（97-9 的 `ask`/`off` 仍先等人 `workflow/driver-start`）。
- **审阅轮中候选被替换**：旧答案只对旧 `(proposalId, revision)` 有效；目标循环按当前候选算新 Query 对，读不到就是“没审过”，重新走审阅。旧候选若不是被返修版接替，而只是 `basedOn` 不再指向活动计划，卡仍按 `derivePlanProposalStatus` 读成 `stale`（`plan-machine.ts:157`-`:176`）；被来源链接替的旧候选（`planfix:` 或 `planresume:` 首行都算）按 6.3.1 从待决集合排除，不改记录、不写 `replaces`。
#### 6.3.4 返修、3 次上限、没线、每步确认
- **`fix` 之后发 `planfix:`。** 请求号 `planfix:<proposalId>:<revision>`（6.3.1），收件是参谋线（`resolveDutyRecipient({duty:'adviser'})`，`workflow.ts:1470` 的现成用法）；正文带审阅的 findings 和诊断的 finding 行。**发之前先读同一确定性消息/Query（6.1.2 步 5b）：只有 `not_sent` 才发；`waiting`（已发、最后一轮未终态、等答卡/续轮或等新候选）合并依据继续选任务，不重发；`terminal`（最后一轮终态、收尾完成、无后继候选）转 `fix_invalid` 卡。** **不改 Query 的来源、不加字段**（`plan-loop-design.md:326`）。参谋轮按 §5.2.7 冻结 `submit_plan_round`，答案仍是 v2 plan/questions；`planfix:` 这一轮的 `answerShape` 是 `plan_round`，不是 `plan_review`（发送身份是系统轮、收件 duty 是参谋）。
- **3 次上限（D13）。数法：** `completedFixes` = 同一 `basedOn` 上**已经写出候选的 planfix 轮数**。按 6.3.1 的来源链把每个候选归到它跨过的 `fixRound`（那条 `planfix:` 消息的身份），**每轮去重**：直接写出的返修候选和 `planfix → 问人 → planresume` 续出的候选都归同一轮；只数有候选写成的轮。`completedFixes < 3` 才发下一次（6.1.3 的 `request_fix`，`rounds = completedFixes + 1`）；当前这次审阅的 `fix` 还没有写出候选，**不**计作已完成返修。不新增 `fixOf` 字段、不沿 `replaces`、不读正文其余部分（M-1；偏差见 §22 C-D8）。
- **没审阅线 → 转卡，不跳过**（`plan-loop-design.md:251`，测试 25）：`hasReviewLine === false` 时 `card: no_review_line`，不发明“审阅通过”，也不建空审阅 Query。
- **「每步确认」**（L36）：审完不是自动采用，而是转卡带结论。落法就是 6.1.3 的 `not_automatic` 行（`refine_future` 在 `every_step` 下是 `needs_decision`，`decision-policy.ts:42`）。
- **已有代码工作区首个方案审一次（D15，6C L7）**：第一版完整方案出来后审一次，意见交给写方案的秘书并写在卡上；不挡人采用；之后改稿由人带到收敛，不每轮审；空工程不审（`plan-loop-design.md:255`，测试 52、53）。**本段只给规则**：这段的“首个方案”是 `basedOn === null` 的候选；“工作区已有代码”的判定归 6C L7（设计原文“落在 6C L7”），本段不实现、不引新读。**注意**：首个方案不经过 6.1 的自动采用（决定 15），所以审阅只影响卡上的意见，不影响采用。
- **审阅结束叫醒目标**：回复 `SessionMessage` 提交（6.1.6 的第 1 条）；目标没有可推进工作、也没有在跑的 Run 时照样走得到（设计测试 42）。
- **重启在审阅轮中（97-9）**：`ask`/`off` 档下有待处理中断的 Goal 不登记唤醒（`goal-wait-wakes.ts:178`、`:193`），人 `workflow/driver-start` 之后 `onStarted` 清中断（`src/app/host.ts:817`-`:820`），下一轮读到原结论，不重复采用（测试 41）。**不重发**：请求号固定，重发只回放原消息（6.3.1）；同一版候选只有一个审阅 Query（`interventionPlanningQueryRefs` 的哈希确定）；冻结的 `answerShape` 让重启后的工具表仍是同一张。
- **候选被新候选替换**：旧结论只对旧 `(proposalId, revision)` 有效（6.3.1 的身份链）；目标循环的读按当前候选算 Query 对，读不到就是“没审过”，重新走审阅。被返修版/续轮版接替的旧候选按 6.3.1 的来源链从候选/卡读取中排除；只因 `basedOn` 不再指向活动计划的旧卡仍按 `derivePlanProposalStatus` 读成 `stale`（`plan-machine.ts:157`-`:176`），都不改记录。

---
### 6.4 让人知道（“请知悉”）
#### 6.4.1 出现位置
- **采用后**（`plan-loop-design.md:257`-`:259`）：读模型的通知里出 **1 条**，类别是 `plan_adoption`（名字是规格新定，见 §21）；内容是“改了什么、影响哪些任务、审阅结论、任务书导出结果”。采用状态只写“已采用”，不写采用者；审阅结论按 6.4.2 读确切四态；差异、影响任务和任务书三行照下。人和自动化同一条。任务书那一行是本节新加的，见 6.4.3。
- **转候选卡时**不另出通知：候选卡本身已经在队列里（`decision-read-model.ts:1844`）。候选卡后端事实是 **tracked 公开平台方法** `readCandidateCard(goalRef, proposalRef)`（内部实现沿用候选卡组卡路径的 `candidateCardFacts`，不新造找卡扫描），冻结路由 **`decisions/candidate-card`**；返回 `{ card: DecisionCardV1; diagnosis; exactReview; exportRead }`，四样事实各自可读、失败各写一行；**`decisions/card` 原样保留**给只读 `DecisionCardV1` 的调用方，不改它的返回形状、不改 `DecisionCardV1` 字段、不新造卡类型。四样是：`card`（现有卡、pins、`candidateStatus`/`staleReason`）+ `diagnosis`（6.2 输出；读不到写“检查覆盖读不到”）+ `exactReview`（候选未采用时按当前 `(proposalId, revision)` 读；已采用时按 `revision - 1` 读接受前版本，同 6.4.2；四态照 6.1.2 步 5；`not_sent` 写“尚未审阅”，`waiting` 写“审阅中”，`terminal_invalid` 写“审阅结论无效：<reason>”，读取失败写“审阅结论读不到：<reason>”）+ `exportRead`（`exportBooks` 的 `written`/`missing`/`incomplete`/`not_configured`/`unavailable`，6.4.3；候选阶段传候选的 draft，见 6.4.3）。候选卡不是采用，没有“这次采用”的通知；界面呈现归 E3，本节只保证这四样通过公开入口可读、失败有明确一行，不把读不到折成空。接线三处：`create-platform.ts` 的 platform/world 公开方法、`core-routes.ts` 的冻结路由、`WorkflowDependencies` 的可选依赖 `readCandidateCard`（真实装配必接；缺依赖 `unsupported`，不折成空）。
- **阶段结束时**出同一条“请知悉”，由 `plan_notice` 通知源生产：内容按 5.8 的六项（token/增长量/行数、完成任务、返工次数、下一阶段档位、阶段线超线），`itemKey=stage-end:<planId>:<planRevision>:<stageId>`，`position` 用该 stage gate 已终结验证轮的 `since`；同一阶段同一版一条，重放不重复。读不到计划/TaskRow/回合/RunActivity 时整条 `unavailable`，不写成“没有阶段结束”；没有已满足的 stage gate 不产生项。
- **偏差“不改计划”时**也出同一条“请知悉”，同一个 `plan_notice` 源：按 `deviation:` 的确定性请求号找到源消息和 `intervention_planning` Query，读现有 `readQueryJob`/`readQueryAnswer`；只有这一轮的答案是“回答”分支（既没有 `plan` 也没有 `questions`，即参谋明确不改计划）才产生项；文字答案不区分目标循环是否判成 `invalid_plan`，一律按“不改计划”处理。内容 = 7.1.1 的停因/超线事实 + “不改计划”的判断 + 这一轮答案的短文字原文（已存、非空、≤16 KiB，不截断，不复制计划全文），`itemKey=deviation-notice:<goalId>:<requestId>`，`position` 用源 R 完成关联时提交的回执 cursor——身份固定为 `intervention:<messageKey>:respond`（`sessionMessageRefKey(源 R)`，`src/business/workflow/intervention.ts:155`），复用 `readCommitByIdentity` 读这条回复提交的回执 `cursor`（身份键的算法见 6.4.2；实现见 `sqlite-record-store.ts:535`、`in-memory-record-store.ts:449`）；**不是 Query 的创建 `since`**（`QueryJob.since` 是创建提交）：较早创建、晚答的 Query 也以这条回复提交的 cursor 定位，不会落到已看过的游标之前。不重发、不建卡、不写记录。Query/回执读失败 `unavailable`；还没终态/还没答案/回执未提交不产生项；同一 `itemKey` 只一条。
- **类别和人的读取。** 这两类“请知悉”用新类别 `plan_notice`，它是现有 `noticeSources`/`NOTICE_CATEGORIES` 投影机制内的类别（不是复用 `plan_adoption`，也不是新记录）：注册到 `create-platform.ts` 的 `noticeSources` 后，人的队列读（`decisions/queue` 的 `notices`、`main/read`）按 Goal 读到它；它和 `member_notice` 走同一个队列读和同一个 `seenThrough` 游标机制，只是类别不同；**不发 Session 的 `notify` 来充当人的投影**（发给参谋 Session 的 `notify` 不会自动进人的通知读）。类别要同时加在类型联合、读模型的 `NOTICE_CATEGORIES` 列表和持久层的允许类别表三处，缺一处会被读模型或 settings codec 拒绝。
- **人采用也出同一条**：首个方案（`initialization/adopt`）、请求槽、转卡后（`plans/apply`）都提交一次 `PlanRevisionAccepted`，读模型用同一类别、同一 `itemKey` 规则出 1 条（决定 15 的“说明修改”和 103-1 的一般规则，`plan-loop-design.md:259`）。“采用后”是它的第一次出现，不是唯一一次。
- **不新造卡**：导出失败不变成一张新卡，也不只写日志；它只进这条“请知悉”（候选卡阶段则进卡文本，见 6.4.3）。
- **旧候选不进卡**：候选卡组卡时按 6.3.1 的来源链（`planfix:` 父候选 + `planresume:` 原 Query 的 `sourceMessageRef`），跳过已经有后继的旧候选；人打开旧卡的路径不会读到被返修版/续轮版接替的那一版。`derivePlanProposalStatus` 的 `stale` 归类不变。
#### 6.4.2 谁写、字段
**不写记录，走投影**（`plan-loop-design.md:259`）：新增一个 `DecisionNoticeSourcePort`，类别 `plan_adoption`，写法照 `automatic_rework` 的投影（`src/core/work-graph/views/automatic-rework-notices.ts:60`-`:74`）。接口现成：`src/core/work-graph/model/decision-contracts.ts:473`-`:480`；条目现成：`:383`-`:400`（`NoticeItemV1`）。文件建议新建 `src/core/work-graph/views/plan-adoption-notices.ts`，在 `src/composition/create-platform.ts:1445` 的 `noticeSources` 注册；`NOTICE_CATEGORIES` 的三处（`src/contracts/goal-decisions.ts:56`-`:59`、`src/core/work-graph/views/decision-read-model.ts:176`、`src/core/work-graph/persistence/record-codecs.ts:232`）都要加 `'plan_adoption'` 和 `'plan_notice'`，只加一处会在读模型或 settings codec 处被拒。

| `NoticeItemV1` 成员 | 这条通知填什么 | 来源 |
|---|---|---|
| `itemKey` | `plan-adoption:<planRef.planId>:<planRevision>` | 采用提交的活动计划版本 |
| `category` | `'plan_adoption'` | §21 C-7 |
| `subject` | `{ kind:'goal', goalRef }` | 采用提交的 Goal |
| `position` | `{ kind:'commit', cursor: <PlanRevisionAccepted 的提交游标>, itemKey }` | 有序读的游标 |
| `summary` | 一句话：`已采用 · 计划 v<planRevision> · 改 <n> 个任务（<ids>）`；后面**按确切审阅四态接一句**：`decided pass` → ` · 审阅 pass`（只有这一种接 pass），`decided fix` → ` · 审阅要求返修`，`not_sent` → ` · 尚未审阅`，`waiting` → ` · 审阅中`，`terminal_invalid` → ` · 审阅结论无效：<reason>`，读取失败 → ` · 审阅结论读不到：<reason>`；不按候选来源接 pass；再接 6.4.3 的任务书一行 | 接受提交的 `position` 游标 + 确切审阅答案（6.1.2 步 5；采用后按候选的 `revision - 1` 读接受前版本）+ 差异 + 导出物现状（6.4.3） |
| `objects` | `{kind:'aggregate', pin: PlanRevision, label:'adopted-plan'}`、`{kind:'aggregate', pin: PlanProposal, label:'candidate'}`、`{kind:'aggregate', pin: Goal, label:'goal'}` | 采用提交（`PlanRevisionAccepted` 的 `payload.planRevision` 和 proposal） |
| `rework` | `null` | 不是返工 |
| `actions` | 不带 | 无动作 |
- **“改了什么”** = `deriveFuturePlanDelta(source, target)`（`src/core/work-graph/tasks/plan-validation.ts:348`）：新增/改动/取消/只改处置四组；target 是采用的 `PlanRevisionSnapshot`，source 是它的 `basedOn` 那一版（候选记录里有 `basedOn`，`plan-machine.ts:96`）。
- **“影响哪些任务”** = 候选的 `reason.affectedTaskIds`（`plan-machine.ts:76`；模型自己写的，平台不补语义，`plan-loop-design.md:329`-`:330`）+ 上面差异里动到的 taskId。两者并列写，不合并成一个“影响范围”。
- **“审阅结论”读确切事实，不按候选来源推**（PLT-17）。通知不区分采用者：采用状态只写“已采用”，审阅结论写确切的四态。审阅按该候选的**接受前版本**读：`acceptedCandidatesOf(goalRef)` 读回的 accepted 候选 `revision` 已是接受后（@1 → @2，`acceptProposalRecord` 的 `revision + 1`，`plan-machine.ts:141`-`:143`），所以 `(proposalId, proposalRevision)` 取 `proposal.revision - 1`；候选尚未采用（候选卡/审阅中）仍取当前 `revision`。按这一对读 6.1.2 步 5 的四态：`decided` 且 `verdict === 'pass'` 才写“审阅 pass”；`decided fix` 写“审阅要求返修”；`not_sent` 写“尚未审阅”；`waiting` 写“审阅中”；`terminal_invalid` 写“审阅结论无效：<reason>”；读取失败写“审阅结论读不到：<reason>”。接受事件的提交游标仍只用于 `position`（C-8）；事件读不到按 `unavailable`，不猜。不按候选来源推、不加读口、不新增字段。
- **阶段结束和偏差“不改计划”的投影**（PLT-16）。同一个 `plan_notice` 类别下由 `createPlanNoticeSource({ records, plans, rounds, runs, activities, deviations, queries, commitIdentities })` 的两个只读分支生产：`stage-end:<planId>:<planRevision>:<stageId>` 用 stage gate 已终结验证轮的 `since` 和 5.8 六项；`deviation-notice:<goalId>:<requestId>` 用确定性 `deviation:` Query 的答案（按目标循环同一个 `parseInitialPlanningResponseV2` 口径判：`plan` → 有候选、`needs_decision` → 有卡，两者都不产生项；文字退路 = “回答”分支，才产生“不改计划”项；偏差项原样带这一轮的短文字答案，已存、非空、≤16 KiB、不截断）和源 R 的回复提交游标——固定身份 `intervention:<messageKey>:respond` 的已提交回执 `cursor`：邮箱的回复提交是 `respond_from_query_answer` 臂（`mailbox-service.ts:3653`），身份键按现有 `identityKeyOf('respond_from_query_answer', scope, senderIdentity, 请求号)` 算（`:1232`-`:1236`；`senderIdentityOf` 取答案的 QueryRun sender，`:1212`），该式由 mailbox 导出为只读薄函数（输入源 R 和固定请求号，内部取答案的 QueryRun sender）、通知源只调它（不复制哈希）；再 `readCommitByIdentity`（`src/core/record-store/ports.ts:206`-`:211`）读 `receipt.cursor`；不新增持久字段；不是 Query 的 `since`。两者都只读、不写记录、不建卡、不重发。**三种出口**：读失败 → `unavailable`（source 返回拒绝，队列写“读不到”，不折成空）；没有事实（stage gate 未满足 / Query 未终态 / 答案是 plan 或 questions）→ 不产生项；同一 `itemKey` 只合并成一条（stage gate 被再次验证时仍取最早归约到 `satisfied` 的那一轮 `since`，不换位置、不追加），重放/再读不追加。源在 `src/core/work-graph/views/plan-notices.ts`，注册到 `create-platform.ts` 的 `noticeSources`；人的 `decisions/queue` notices 直接读到，不需要另发 `notify`。注入的读口就是现有读：`records`（按 Goal 读 `PlanRevision`/`SessionMessage`/`VerificationRound`）、`plans.queryTaskGraph`、`S2B_ROUND_BY_GOAL_LOOKUP`（`VerificationRound` 记录，`since` 是游标）、PLS-23 的 `executions.listExecutions` + `readRunActivities`、`readDeviationFacts`、`readQueryJob`/`readQueryAnswer`、`commitIdentities`（`RecordCommitIdentityPort.readCommitByIdentity`；现有存储成员，不新增持久字段）；真实装配必接，某个分支需要而缺读口时该分支 `unsupported`，读失败 `unavailable`，都不折成“没有”。
- **怎么从采用的计划找到候选**：通知源拿采用提交的 `PlanRevisionRef`，用新窄读 `acceptedCandidatesOf(goalRef)` 读完这个 Goal 的所有已采用候选，再挑 `planRevisionTargetOf(proposal) === planRef` 的那一条（`src/core/work-graph/state/plan-machine.ts:225`-`:227` 的 `planRevisionTargetOf`；读走 `PLAN_PROPOSAL_LOOKUP_INDEX`，`src/core/work-graph/persistence/plan-record-codecs.ts:64`）。找到才写 `affectedTaskIds` 和差异的 source；找不到按“未知”写，不猜。这条候选已 `accepted`、`proposal.revision` 是接受后的版本；审阅结论按上一段的 `revision - 1` 读接受前版本，不按这个 revision 算 `planreview:`。
- **`PlanRevision` 的有序读和接受事件**：今天只有按 Goal 的有序索引（`src/core/work-graph/persistence/plan-record-codecs.ts:1116` 的 `s2b-plan-revision-by-goal`）。**`PlanRevisionSnapshot` 只有 `acceptedAt`，不带自己的 `since`**；通知项的 `position` 从同一次接受的 `PlanRevisionAccepted` 事件取（提交游标就是 `position` 的 cursor；读口用读模型已注入的 `lookupCommit`+`eventAt` 按该次采用的提交回执读这一条事件）；事件本身只用来取 `position`。`itemKey` 仍按 `plan-adoption:<planId>:<planRevision>`。事件读不到按 `unavailable` 写一行，不读记录自身的游标、不猜。**不新增 project 索引**：决定队列按 subject 分组，通知源按目标读，跨目标排序仍用同一个提交游标合并；代价是每个有采用的目标各读一次，可接受。
- **任务书那一行不落在记录里**：`summary` 的导出结果由通知源在每次读时调 `exportBooks`（6.4.3）按文件现状算。投影仍然只读、不写、不重试；这一行不是持久字段。
#### 6.4.3 任务书导出：何时、失败怎么让人知道
**何时。** 采用提交之后；转候选卡时（`plan-loop-design.md:191`、`:441`）。由 Host 在处理采用/转卡的结果时做，不在投影里做；写哪、写什么、路径和文件名是 §5.3.4 的正文，本节只定“何时、结果怎么进通知、失败文字、去重”。

**调用点（三个，走同一个包装）。** 在 `host.ts` 加 `adoptAndExport(adopt)`：`committed`（含 `replayed`）后启动一次 `exportTaskbooksForPlan`（Host 传 `root` 和已注册的每个工作区根，5.3.4 的隔离检查在写前做），**采用路径不等它**（失败不 rethrow、不回滚，采用结果原样返回）；这个异步工作登记进 Host 的关闭等待，进程退出前等它结束，不丢写、不把半写的任务书当成功（PLS-31/C-32）。三个调用点：人采用首份（`:2273`-`:2281` 的 `adoptInitialization` 包装，`committed` 后、`startGoalDriver` 前）、人采用后续（`plans/apply` 的 bindings 覆盖成同一包装；`core-routes.ts:859` 现在直接绑 `applyPlanChange`）、自动采用（C 的 `adopt_plan` 在 Host 装配时传同一包装）。

**同一版重复采用/重试。** 每次 `committed`（包括 `replayed`）都调用一次导出，同一版本同一路径覆盖写。这不是“导出失败后的重试”：没有失败驱动的重试、退避、队列或“稍后再试”的记录；重放同一个采用只是同一次采用的回执，覆盖写是幂等的。采用结果、状态、版本都不因为导出再写一次而变。

**导出结果怎么进通知（不写记录）。** 新窄读 `exportBooks`，放在 `src/app/taskbook-export.ts` 或它的读口，Host 注入给通知源；通知源不碰 `settingsDirectory` 本身：
```ts
export type TaskbookFileStatusV1 =
  | { state: 'written'; stageId: string; path: string; bytes: number }
  | { state: 'incomplete'; stageId: string; path: string; actualBytes: number; expectedBytes: number }
  | { state: 'missing'; stageId: string; path: string };

export type TaskbookExportReadV1 =
  | { status: 'not_configured' }                       // 没有 settingsDirectory
  | { status: 'ready'; stages: readonly TaskbookFileStatusV1[] }
  | { status: 'unavailable'; reason: string };        // 缺读口/探针本身失败；不折成“未配置”

export type TaskbookExportReadPort = {
  read(input: { plan: PlanRevisionSnapshot | PlanRevisionDraft; scope: { projectId: string; workspaceId: string; goalId: string } })
    : Promise<TaskbookExportReadV1>;
};
```
- **候选阶段的输入是 draft，不是 snapshot（PLT-11）。** 候选卡读的是候选的 `PlanRevisionDraft`（还没采用、没有 `ref`/`acceptedAt`），所以 `read` 的 `plan` 是 `PlanRevisionSnapshot | PlanRevisionDraft` 的联合：探针只取两者共有的 `planId`/`planRevision`/`stages`/`tasks` 和 `renderTaskbookMarkdown` 需要的段/任务书内容，**不要求 `ref`/`acceptedAt`**；期望路径和期望字节数按同一 `planId`/`planRevision`/`stageId` 算。这是 TypeScript 的入参联合，不是新字段、不是新记录；候选阶段和采用阶段的失败行/三态相同。`renderTaskbookMarkdown` 的入参也按同一联合冻结，不复制第二份草稿类型。
- **成功/失败的判定。** `exportBooks` 在 Host 侧做探针（它在 `src/app`，能同时用 `taskbookRelativePath` 和纯渲染 `renderTaskbookMarkdown`）：对传入的 `plan`（`PlanRevisionSnapshot | PlanRevisionDraft`）的每个 `stages[].stageId` 算期望路径和期望字节数；文件不存在/读不到 → `missing`；存在但 `actualBytes < expectedBytes` → `incomplete`（写到一半、被截断）；`actualBytes >= expectedBytes` → `written`。**不保存导出结果**：通知每次读重算，所以投影不写、崩溃后可重建；代价是文件被外部删除或改动后，通知会从“已导出”变成“未写出/不完整”，文字不声称具体 fs 原因。
- **通知在哪个函数生成。** `createPlanAdoptionNoticeSource({ records, exports })` 的 `readPage`（`plan-adoption-notices.ts`）读按 Goal 的 `PlanRevision` 记录，逐条组 `NoticeItemV1`；`summaryOf(adoption, candidate, exportRead)` 是唯一的文本构造。它先调 `deps.exports.read({ plan, scope })`，再把结果拼进 `summary`；不读审阅 Query、不发消息、不写记录。
- **失败文字（逐 stage 一行，用 `；` 连接）。**
  - `written`：`任务书 <stageId> 已导出（<path>）`；
  - `missing`：`任务书 <stageId> 导出失败：未写出（<path>）；采用不受影响，不自动重试`；
  - `incomplete`：`任务书 <stageId> 导出不完整（<path>，<actualBytes>/<expectedBytes> 字节）；采用不受影响`；
  - `not_configured`：`任务书未导出：没有设置目录`；
  - `unavailable`：`任务书状态读不到：<reason>`（读口或探针本身失败，不说成“未配置”）。
  多段时每段各自一行；一段失败不会盖掉别的段已导出的路径。精确的 fs 原因（`ENOTDIR`/`EACCES` 等）不在通知里，因为不落记录；现有 Host 没有日志设施，本节不为它新增日志，通知是失败的唯一必需落点。
- **失败不挡采用。** `exportTaskbooksForPlan` 先做 5.3.4 的导出根隔离检查，再捕获每个 stage 的 fs 异常，返回 `failed`（`TaskbookExportV1`，§5.3.4）；包装不 rethrow、不回滚、不改 `committed` 的 receipt，也不把采用改成 `busy`/拒绝。自动采用照常继续，下一段照常可派；人采用照常返回 `committed`。测试 46/47 与本节一致。
- **转候选卡。** 候选卡阶段也调一次 `exportTaskbooksForPlan`（§5.3.4），输入是候选的 `PlanRevisionDraft`（不是已采用 snapshot）；卡文本用同一个 `exportBooks` 的三态行。卡不是通知，不产生 `plan_adoption` 条目；人批准前能读路径或失败行。
- **同一版重复采用/重试时通知不重复。** `itemKey` 固定为 `plan-adoption:<planId>:<planRevision>`；`PlanRevisionAccepted` 每个计划版本一次，`plans/apply` 的重放返回同一 receipt，不追加第二个接受事件；即使有两个同版本的接受事件，通知合并（`compareNoticePositions`/`mergeNoticePages`，`views/notice-position.ts`）按 `itemKey` 和位置去重，读出来仍是一条。导出可能因为重放再覆盖写一次，但通知仍是一条，`position` 仍是同一个提交游标。
- **不做的。** 不写 Notification/新记录、不建“导出记录”、不建新卡、不重试、不做原子临时文件/回滚（设计没写）；导出物丢了按计划版本重建（`plan-loop-design.md:193`）。不把失败原因塞进 `NoticeItemV1` 的新字段；`summary` 是唯一新增的文本落点。
### 6.5 对象和状态
**不加持久状态，不加记录**（`plan-loop-design.md:263`）。每一类东西落在现有的记录/字段上：

| 东西 | 落在哪 | 谁写 |
|---|---|---|
| 候选 | `PlanProposal`（现有；`candidate_v2`，`src/core/work-graph/state/plan-machine.ts:92`-`:107`） | 现有写者（Plan 服务） |
| 候选版本 | `PlanProposal.revision`（`:93`） | `acceptProposalRecord`（`:141`）只在采用时 +1 |
| 候选来源 | `PlanProposal.sourceMessageRef`（`:107`）、`submittedBy`（`:105`）、`requestRef`（`:98`）、`basedOn`（`:96`） | 现有写者 |
| 影响清单 | `PlanProposal.reason.affectedTaskIds`（`:69`-`:76`） | 模型（propose 时） |
| 机械诊断 | **不落记录**；纯函数，读时重算（6.2） | — |
| 审阅结论 | 审阅轮的 Query 答案正文与记录（现有 `QueryJobAnswerV1`，`src/contracts/query-job.ts`；`readQueryAnswer`） | 审阅轮观察器（现有） |
| 审阅轮状态 | 审阅 Query 的 `QueryJob`/`QueryRun` 记录（现有：`status`、`answerRefs`、`executionState.phase`） | 现有 Query 写者 |
| 审阅轮请求 | `SessionMessage`（现有；请求号在消息身份里，记录不带 `requestId`） | 目标循环的发送步骤 |
| "请知悉" | `NoticeItemV1` 投影（不落记录） | 新的通知投影（6.4） |
| 采用/转卡的结果 | 采用：`PlanRevision` + Goal 指针 + `PlanProposal.status='accepted'`；转卡：无写 | 现有 Plan 服务 |

**派生状态只归类**（PL4-03；`plan-loop-design.md:265`-`:271`）：

| 派生状态 | 归哪些情况 | 从哪些现有事实算 |
|---|---|---|
| 待审 | 候选待决（`findPendingProposal`），这一版审阅读取是 `not_sent`，有审阅线 | 候选记录 + 6.1.2 步 5 的 `not_sent` + 审阅线存在 |
| 审中 | 这一版有审阅 Query，读取是 `waiting` | `readQueryJob` 的 `run.run.status`/`executionState.phase`；6.1.2 步 5 的 `waiting` |
| 待改 | 审阅 `fix`，没到上限；返修没发或已发等新候选 | `parsePlanReviewAnswer` 的 `fix` + `completedFixes < 3` + 6.1.2 步 5b 的 `not_sent`/`waiting` |
| 待采用 | 6.1 的 `adopt` 行；`busy` 时留在这里 | `pass` + 诊断空 + `automatic`；`busy` 的最后一次采用结果 |
| 待人 | 6.1 转卡的各行（含 `review_invalid`/`fix_invalid`） | `card` 的 `reason` |
| 已采用未回复 | 采用提交成功，但候选来源消息（沿 6.3.1 来源链/`repliesToMessageRef`）仍是 open wait、`response===null` | `acceptedCandidatesOf` + 源消息 wait/response（6.1.6、7.3.1 第 8 步） |
- 这六个**不是持久状态、不是新字段**；它们是 6.1 那张表的结果归类，读的时候从上面的事实算。目标显示沿用 `CHANGE_PENDING`（`plan-loop-design.md:273`）：候选待决期间不算当前工作失效。

---
### 6.7 改动位置

#### 6.7.1 七个窄读、候选卡公开入口和计划通知的出口契约
**装配。** 七个读口由组合根 `src/composition/create-platform.ts` 实际注入；`WorkflowDependencies` 上仍可写成可选，只为旧的双打不破，**运行时缺依赖不能折成空**：缺实现给 `rejected('unsupported', '<read> is not wired')`，读失败给既有 `rejected('unavailable', …)`，`ReadResult` 的 `not_ready`/`not_found` 原样保留。只有“枚举完成且确实没有”才是空。

| 读口 | 返回形状 | 空/缺省的真实含义 | 失败映射 |
|---|---|---|---|
| `latestAgentCandidate(goalRef)` | `ReadResult<PlanProposal \| null>` | `ready(null)` 只在**枚举完成**、排除请求槽候选、首个方案、以及按 6.3.1 来源链（`planfix:`/`planresume:` 两种首行）已有后继的旧候选之后，确实没有待决 agent 候选 | Goal `not_found` 原样；`not_ready` 原样；缺依赖 `unsupported`；读失败 `unavailable` |
| `completedFixes(goalRef, basedOn)` | `ReadResult<number>` | `ready(0)` 只在同一 `basedOn` 的候选枚举完成且没有写出候选的 planfix 轮；按 6.3.1 的 `fixRound` 去重后计数；不是“没读到” | Goal/计划 `not_found` 原样；`not_ready` 原样；缺依赖 `unsupported`；读失败 `unavailable` |
| `planFixRead(goalRef, proposalRef, revision)` | `ReadResult<PlanFixReadV1>`（`not_sent`/`waiting`/`terminal`） | `not_sent` 只在回执 `not_committed` 且原 `planfix:` Query `not_found`；`waiting` = 已发（含回执已 `committed`、Query 还没建出）且最后一轮（`planfix:` 或它经 `planresume:` 续出的轮）未终态、问题卡没全答或续轮没建，或最后一轮终态但收尾没写完；`terminal` = 最后一轮已终态、收尾完成仍没有后继候选；**读最后一轮的 Query/收尾，不以原 `planfix:` Query 的结束判**；不是“没读到” | Goal `not_found` 原样；`not_ready` 原样；缺依赖 `unsupported`；回执/Query/消息/问题/答案读失败 `unavailable` |
| `checks(scope)` | `ReadResult<readonly CheckCapabilityV1[] \| null>` | `ready(null)` = 没有检查配置（6.2 的 `diagnosis` 传 `null`，不判自动采用）；`ready([])` = 配置存在但为空（诊断无 finding） | 缺 resolver `unsupported`；读失败 `unavailable`；`not_ready` 原样 |
| `planCandidates(scope, ctx, goalRef?)` | `ReadResult<{ goals: readonly {...}[] }>` | `ready({goals: []})` 只在工作区枚举完成且没有未结束的 Goal；`questionGroups: []` 只在该 Goal 没有**本闭环来源**（`intervention_planning` + `sourceMessageRef`）的问题组（其他规划问题保留原读，不算空、不算失败）；`pending: null` 只在候选读完成且没有待决候选 | 缺依赖 `unsupported`；进组问题的枚举/答案/消息/Query 读失败 `unavailable` 或原 `CoreRejection`；`not_ready` 原样；没有来源的普通规划问题不参与、不拒绝整条读 |
| `acceptedCandidatesOf(goalRef)` | `ReadResult<readonly PlanProposal[]>` | `ready([])` 只在 by-Goal 候选枚举完成且这个 Goal 没有 `status==='accepted'` 的候选；**不按 `activePlanRevision` 过滤**，所有已采用候选都返回；`not_found` 只给 Goal 本身不存在 | 缺依赖 `unsupported`；读失败 `unavailable`（记录不一致按 codec 现有 issue 拒绝） |
| `exportBooks(input)` | `{status:'not_configured'} \| {status:'ready'; stages: TaskbookFileStatusV1[]} \| {status:'unavailable'; reason}` | `not_configured` 只在没有 `settingsDirectory`；`ready` 里单段文件不存在/偏短分别是 `missing`/`incomplete`，不是读口失败 | 缺依赖/探针本身读失败 `unavailable`（通知写“任务书状态读不到”，不折成“未配置”） |
| `readCandidateCard(goalRef, proposalRef)`（公开平台方法；`candidateCardFacts` 是内部实现，路由见表下 5a） | `ReadResult<{ card: DecisionCardV1; diagnosis: ... \| null; exactReview: ...; exportRead: TaskbookExportReadV1 }>` | 候选 `not_found` = 权威不存在，读模型不出卡；四样事实各自缺失按 6.4.1 的文字出口写，不把整张卡折成空 | 卡本身读失败 `unavailable`；诊断/审阅/导出子读失败各自保留 `null`/`unavailable`/`terminal_invalid`，卡仍可读并写明原因；缺实现 `unsupported`（真实装配必接） |

- 七个读口都不新造“找候选/找卡”的扫描：`latestAgentCandidate`/`completedFixes`/`acceptedCandidatesOf` 复用 by-Goal 的候选枚举；`planCandidates` 复用问题 reader + 决定答案读；`planFixRead` 复用 `systemRoundRequestId`/`systemRoundMessageRef`/`interventionPlanningQueryRefs`、消息回执读、问题 reader + `readDecisionAnswer`，以及续轮 `planresume:` 的同一组确定性消息/Query 读；`exportBooks` 复用 `taskbookRelativePath`/`renderTaskbookMarkdown`。
- **`acceptedCandidatesOf` 还用于崩溃恢复（PLT-09/C-27）**：采用成功后候选已退出 pending 集合，`latestAgentCandidate` 读不到它；恢复读完这个 Goal 的**所有已采用候选**（不限定活动计划那一版），再用 6.3.1 来源链/`repliesToMessageRef` 找各自的源消息。源消息仍 open、`response===null` 时**只补回复**，不再采用、不再 propose。
- **失败映射统一走既有 `asRejection`（PLS-30/C-31）。** 这些读口返回的 `ReadResult` 里 `not_found`/`not_ready` 是读层状态；Workflow 把它们交给 6.1/6.7 的调用方时由 `asRejection` 转成干预结果并保留 `revision_conflict`/`source_stale` 的实际语义，不新增错误码，也不把 `not_ready` 直接当 `rejected` 返回。

| # | 位置（tree 行号） | 改什么 | 归属 |
|---|---|---|---|
| 1 | `src/business/workflow/workflow.ts:1502`-`:1540` 的目标级入口；`:1517`-`:1520` 的 `plan_adoption` 等待 | 在目标级选择前加 6.1 的一轮（读候选、读规划问题、诊断、审阅、采用/转卡）；候选 `card`/`wait` 只记下依据，**继续 `selectNext` 选任务**，没有可推进步骤才合并依据返回 `waiting` | 本段 |
| 2 | `src/core/work-graph/state/plan-candidate.ts`（新，纯） | `decidePlanCandidate`、`diagnosePlanCandidate` 和两个类型（6.1.3、6.2） | 本段 |
| 3 | `src/contracts/verification.ts`（新函数） | 从 `compileVerificationPlan` 抽出 `compileVerificationCoverage`；`src/core/work-graph/evidence/verification-plan.ts:85`-`:114` 改为调用 | 本段 |
| 4 | `src/business/workflow/contracts.ts` 的 `WorkflowCalls`（`:89`-`:170`） | 加"发系统轮请求"的步骤（与 B 合，名字以 §5.2 为准）和 `adopt_plan: PlanTaskPort['applyPlanChange']`；返回结果的 `waitBasis` 允许在 `advance` 上出现 | 本段 + B |
| 5 | `src/business/workflow/ports.ts`、`src/business/workflow/contracts.ts` | 新的窄读：`latestAgentCandidate`、`completedFixes`、`checks`（6.2 末）、`planCandidates`（6.1.6/3b）、`planFixRead`（6.1.2 步 5b）、`acceptedCandidatesOf`（6.1.6、6.4.2）、`exportBooks`（6.4.3）；都做成可选（旧的双打不破），真实装配必接；出口契约见 6.7.1 | 本段 |
| 5a | `src/core/work-graph/views/decision-read-model.ts` 的候选卡组卡路径（`:1844`、`:1866` 一带）；`candidateCardFacts` 的实现放同一文件或 `plan-readers.ts` 的候选读旁；`src/app/core-routes.ts:595` 一带加冻结路由 `decisions/candidate-card`（binding `readCandidateCard`，`kind:'plain'`，DTO 同步 `src/app/core-http-types.ts`）；`src/composition/create-platform.ts` 的 platform/world 方法 `readCandidateCard`；`src/business/workflow/ports.ts` 的 `WorkflowDependencies` 可选依赖 `readCandidateCard` | 候选卡后端事实装配成 tracked 公开方法：`card + diagnosis + exactReview + exportRead`；诊断/审阅/导出子读失败各写明确一行，不折成空、不改 `DecisionCardV1` 字段、不新造找卡扫描；`decisions/card` 原样保留；真实装配必接，缺依赖 `unsupported`；界面只读它 | 本段（E3 只接界面） |
| 6 | `src/core/work-graph/model/plan-contracts.ts:226`-`:296` 的 `PlanTaskPort`；`src/core/work-graph/tasks/plan-readers.ts:555`/`:656`、`src/core/work-graph/tasks/plan-lineage.ts`（新） | 不加写方法；新的读口在 Workflow 的依赖里，Plan 服务的实现从 `plan-readers.ts` 接；`planFixRead`/`acceptedCandidatesOf` 和 6.3.1 的 `planSourceLineageOf` 也在 `tasks/` 落地 | 本段 |
| 7 | `src/contracts/plan-review.ts`（新）；`src/core/agent-runtime/answer-tools.ts:56`、`:71`、`:151`、`:382`、`:560` | 审阅答案的类型、正文构造、解析（contracts）；`submit_plan_review` 的名字、schema、接受（answer-tools）；16 KiB 上限 | 本段 |
| 8 | `src/core/agent-runtime/query-preparation.ts:337`-`:360`、`src/core/agent-runtime/query-execution.ts:325`-`:360`、`:388`-`:420`、`:523`-`:563`；`src/core/agent-runtime/query-observation.ts:470`-`:505` | 审阅轮按冻结的 `manifest.answerShape='plan_review'` 挂工具，不再要求 request round；观察器按形状重建审阅正文；准备阶段把 `plan-review-input` 附在问题后 | 本段（与 B 的 §5.2 交界） |
| 9 | `src/contracts/prompts/slot-tables.ts:45`-`:50` 一带；`resources/prompts/platform/pack.json` 的 `templates`；`templates/plan-review-input.txt`（新）；生成的 `src/contracts/prompts/platform-pack.generated.ts` | 审阅输入模板 | 本段 |
| 10 | `src/core/agent-runtime/context-types.ts:54`（`ContextTemplateId`）、`context-query-recipe.ts` | 新模板的渲染和槽的事实读取（候选、差异、诊断） | 本段 |
| 11 | `src/contracts/plan-round.ts`（5.2.2/5.2.6） | 不新增请求号函数；`planreview:` 直接调 `systemRoundRequestId`，读首行调 `systemRoundOfText`；需要便捷名字只做无规则薄包装 | 本段 |
| 12 | `src/core/work-graph/state/decision-policy.ts:42` | 不改；只消费 `refine_future` 的判定（6.1.3） | — |
| 13 | `src/app/goal-wait-wakes.ts:160`-`:202` 的 `createGoalWaitRebuild`；`:39`-`:54` 的 `GoalWaitWakes` 类型 | 重启重建第三半（候选、已答未续轮、已采用未回复）；`register` 的 kinds；不写恢复记录 | 本段 |
| 14 | `src/app/collaboration-driver.ts:1082`、`:1120`-`:1124`（以及 `:1182`、`:1214` 的任务看守同类处） | `advance` 上的 `waitBasis` 在发系统轮请求之前登记；别的登记路径不变 | 本段 |
| 15 | `src/core/work-graph/views/plan-adoption-notices.ts`（新）；`src/contracts/goal-decisions.ts:56`-`:59` | `plan_adoption` 通知源和类别；`readPage` 调 `exportBooks` 把每段任务书的 `written/missing/incomplete` 写进 `summary`；导出结果不落记录 | 本段 |
| 16 | `src/core/work-graph/persistence/plan-record-codecs.ts:1116` 一带 | 不加索引；通知源按目标读 `PlanRevision`，`position` 用接受事件的提交游标（C-8）；事件读不到 `unavailable`（C-36） | 本段 |
| 17 | `src/app/host.ts` 的 `consumeIdle`（`:1855`、`:1880`）、`adoptInitialization`（`:2273`-`:2281`）、`:2307` 的关闭等待、`plans/apply` 的 bindings 覆盖、C 的 `adopt_plan` 装配 | 允许改这些既有调用点：系统轮/恢复报价进消费循环，采用走同一个 `adoptAndExport`，导出异步工作纳入关闭等待；不改采用结果、不重试、不写记录（PLS-31/C-32） | 本段（5.3 的正文另定） |
| 18 | `src/core/work-graph/sessions/duty-recipient.ts:22`-`:24` | duty 联合加 `'reviewer'` | 本段（L35/7D2 的线由 7D2 建） |
| 19 | `src/core/work-graph/tasks/goal-decision-reader.ts:78`、`:280`、`:442`；`src/core/work-graph/views/decision-read-model.ts:254`；`src/core/work-graph/tasks/goal-deviation-facts.ts`（新）；`src/contracts/plan-deviation.ts`（新） | 在现有 goal_cause 读取里按细化需求或**共享 `readDeviationFacts` + `deviationsOfGoal` 的偏差需求**（`growth`/`lines`/`budget`/`stop` 都算）+ 参谋收件人派生 `no_adviser`；卡源与 `selectNext` 共用同一读口（`tasks/goal-deviation-facts.ts`）和同一 contracts 纯函数（`plan-deviation.ts` 是唯一正本），只有权威无收件人才派生，读失败原样；不新增持久 cause/记录（PLS-17/C-28/PLT-15） | 本段 |
| 20 | `src/core/work-graph/views/plan-notices.ts`（新）；`src/composition/create-platform.ts` 的 `noticeSources`；`src/contracts/goal-decisions.ts:56`-`:59`、`decision-read-model.ts:176`、`persistence/record-codecs.ts:232` 的 `NOTICE_CATEGORIES`；`src/core/work-graph/communication/mailbox-service.ts`（导出 `respond_from_query_answer` 身份薄函数，不复制哈希） | `plan_notice` 投影源：阶段结束（stage gate 已终结验证轮的 `since` + 5.8 六项）和偏差“不改计划”（确定性 `deviation:` Query 的“回答”分支 + 源 R 的 `intervention:<messageKey>:respond` 已提交回执 cursor（身份键见 6.4.2），`readCommitByIdentity`，不是 Query 的 `since`）；稳定 `itemKey`、读失败 `unavailable`、无事实不产生项、同 `itemKey` 一条；不新增记录、不靠 Session `notify`（PLT-16） | 本段 |

---
## 7. 执行中的偏差
### 7.1 入口
设计 `plan-loop-design.md:279`-`:292` 的表有六行；按 v3 第 4 节和 v4 第 10 节重判后，`growth`（上下文增长量过 2 倍）和 `lines`（改动行数超过任务书预估 2 倍）必须分成两种偏差，各自触发。归成下表：

| # | 偏差 | `kind` | 谁发现 | 今天在哪 | 本设计 |
|---|---|---|---|---|---|
| 1 | 前提错、任务书和代码对不上、范围不够 | —（不是系统轮） | 执行者 | 现有发信 + 让出：`src/core/agent-runtime/communication-tools.ts:479`-`:490`（`waitAfterSend` 先存消息，工具组屏障提交 `run.yielded`）、`:580` | 技能写明“不猜，发 `action_request` 给参谋，让出”（5.4）；消息进 5.2 的规划轮，`taskRef` 只作规划上下文，不进领取分支（`src/business/workflow/intervention.ts:75`、`:96`-`:130`） |
| 2 | 两个任务矛盾 | —（同上） | 执行者、审阅者 | 同上 | 同上（E09） |
| 3 | 任务过提醒线（按上下文增长量） | —（`notify`，不是偏差系统轮） | 平台 | 没有；本规格加读数（10.4、13.2） | 给参谋一条 `notify`，同一任务同一条线只发一次；不开模型轮 |
| 4 | 任务过 2 倍线（按上下文增长量） | `growth` | 平台 | 没有；本规格加读数（10.4、13.2） | 系统轮 `deviation:…:growth:…`，开参谋轮；轮结束参谋不改计划时以 `plan_notice` 告诉人；任务不停 |
| 5 | 改动行数超过任务书预估的 2 倍 | `lines` | 平台 | 没有；本规格加读数（10.4、13.2） | 系统轮 `deviation:…:lines:…`，开参谋轮；轮结束参谋不改计划时以 `plan_notice` 告诉人；任务不停 |
| 6 | Run `budget_exhausted` | `budget` | 平台 | `src/core/work-graph/state/task-failure.ts:956`（AV-11，`stopped('budget_exhausted')`）；Run 的 `budget.tokenBudget` 在 `src/contracts/dispatch.ts:65` | 系统轮；任务已停 |
| 7 | 到返工上限、`no_new_basis` | `stop` | 平台 | `task-failure.ts:948`（AV-8，`auto_rework_cap_reached`）、`:951`（AV-9，`no_new_basis`） | 系统轮；任务已停；停因码写进正文 |
- **第 3、4、5 项不是同一条。** 提醒线看任务增长量到该档提醒线；2 倍线看增长量到该档 2 倍线；行数线看已确认的 `changedLines.added + deleted > 2 × estimatedLines`。任务没有 `sizeClass` 时，第 3、4 项都只累计、不提醒；行数线不依赖档位，只依赖 `estimatedLines`；**第 3 项是 `notify`，不是偏差。** 告诉参谋“这个任务到提醒线了”，不开模型轮；第 4、5 项才发 `deviation:` 开轮；**第 1、2 项是执行者/审阅者的普通 `action_request`，不是 `deviation:` 系统轮**，所以 `kind` 为空。第 4–7 项才是平台的系统轮；**告诉人不靠给参谋 Session 的 `notify`，走 `plan_notice` 投影（6.4.1/6.4.2）**：偏差轮结束后参谋明确“不改计划”时出一条；给参谋的提醒线 `notify` 只到参谋线，不算人的请知悉。B03 写“意图是 `notify` 的请知悉永不开模型轮”（`docs/MVP-BEHAVIOR.md:113`）。不为提醒加消息种类、字段或轮。

**D-V1：依赖不是领取条件。** 设计 `:299` 说“依赖它的任务按现有规则被挡（`MVP-BEHAVIOR.md` B03 第三段）”，但本树的 `executionDag.dependsOn` 是软排序，明确不设“上游完成”门（`src/business/workflow/task-order.ts:1`-`:10`；`src/core/work-graph/tasks/eligibility.ts:26`-`:29`）。现有唯一的挡截是 L46 的卡/等待传递闭包（`src/business/workflow/task-gate.ts:109`-`:172` 的 `formalDependencies`/`closeBranches`），它只覆盖“等自动返工确认/等卡”的任务；普通失败、返工上限、预算耗尽、软超线都不在 `blocks` 里，**不挡正式依赖它的任务**。本规格**不加新闭包**：依赖不是领取条件，现有挡截就是 L46 的传递闭包。这是对设计第 7 节的偏差，由 lead 改设计。

**D-V2：上报收件人分两侧。** 平台侧的系统轮和通知按 L35（7D2 前用 `resolveDutyRecipient`，`src/core/work-graph/sessions/duty-recipient.ts:22`-`:29`；用法同 `workflow.ts:1470`）；执行者按技能找参谋线（`find_related_sessions`，`src/contracts/prompts/platform-pack.generated.ts` 的技能正文）。执行者不是 Host，不能调 `resolveDutyRecipient`；设计 `:292` 的“收件人按 L35”只读成“平台侧按 L35”。见 7.1.2。
#### 7.1.1 系统轮的请求号和字段（B 的 5.2 负责发送）
```
deviation:<goalId>:<taskId>:<kind>:<planRevision>
```

| 字段 | 怎么取 | 依据 |
|---|---|---|
| `goalId` | 这个任务所属目标：`TaskRow.ref.goalId`（`src/core/work-graph/model/plan-contracts.ts:111`） | 设计 `:291` |
| `taskId` | `TaskRow.ref.taskId` | 同上 |
| `kind` | `growth` \| `lines` \| `budget` \| `stop`；`stop` 的正文写 `auto_rework_cap_reached` 或 `no_new_basis` | v3 §4.3；v4 §10；D-2、D-3 |
| `planRevision` | 触发这条偏差的 Run 的 `planRef`（`src/contracts/dispatch.ts:251`）读出的 `PlanRevisionSnapshot.planRevision`（`src/contracts/plan.ts:248`）；没有 Run 的 `stop` 用这一轮读到的当前计划的 `planRevision` | 设计 `:291`“同一版”；D-4 |

**载荷只用现有消息字段**（设计 `:141`“不新增消息字段”）。发送步骤构造 `SystemRoundV1` 的 `deviation` 臂（`{kind:'deviation', goalRef, taskId, cause, planRevision}`），经 5.2.5 的固定发送身份发出——**发送者是 `SYSTEM_ROUND_ACTOR`（`host:plan-round`），不是 `automationContext` 的 `workflow:auto-rework`**；工具选择、消费分支和确定性消息读取都按这个身份：
```ts
// SystemRoundV1 的 deviation 臂由 5.2.2 定义；发送只走 5.2.5 的固定身份：
//   const input = systemRoundSendInput({ round, recipient, text, taskRef });
//   deps.messages.sendMessage(systemRoundContext(scope, signal), input.value)
// input 的 text = 下面四项；intent = 'action_request'；goalRef/taskRef 按 5.2.3 填；
// meta.expected = []（Host 身份）。
```
`taskRef` 只作规划上下文；5.2 明确它不进领取分支。请求号、收件人和正文都不变。

正文 `text` 的内容按设计 `:303` 的四项，不新造第五项（**消息正文和它的 Query `question` 都是 Host 系统轮，按 5.3.5 走 64 KiB；不因为放宽到 64 KiB 就把计划全文塞进来**）：

1. 这个任务用了多少：Run 的 `usage.totals.inputTokens + outputTokens`（10.4 的 `runUsageOf`）；软超线还要写任务累计增长量（10.4 的 `runGrowthOf`），读不到写“未知+原因”。
2. 改了哪些文件多少行：`facts.changedFiles` 的 `definite`/`possible`（`src/contracts/run-activity.ts:36`-`:40`）和 `facts.changedLines`（10.4）；读不全写“至少 N 行/未知”。
3. 任务书在哪：计划版本 + `taskId` + 5.3 的导出 Markdown 路径；导出失败写“计划版本 + taskId”（设计 `:193`“导出失败不挡采用，只提示”）。
4. 停因（只有 `budget`/`stop`）：`budget_exhausted` 的 `minTokenBudgetExclusive`（`task-failure.ts:957`）或停因码；`growth`/`lines` 没有停因。

**同一版只发一次**靠 Host 发信的确定性身份：`src/core/work-graph/communication/mailbox-service.ts:2693`-`:2699`（`identityKeyOf('send', …, requestId)` 先查回执，重放返回原消息）。不新增去重记录。`growth` 和 `lines` 各有请求号，各自最多一次；同一任务同一版已有 `stop`/`budget` 硬停因时，`growth`/`lines` 不再发轮，只写进“请知悉”。
#### 7.1.2 收件人和执行者的上报
- **平台侧的系统轮和告诉人**：先 `resolveDutyRecipient` 找 `duty:'adviser'`（`src/core/work-graph/sessions/duty-recipient.ts:22`-`:29`；用法同 `workflow.ts:1470`）。没有参谋时**不发给秘书**，出 `goal_cause` 卡（code `no_adviser`；103-1；设计 `:123`、`:503`；专用 `adviser_creation` 卡归 7D2）。这张卡由 5.5.3 的 `readGoalDecisionCauses` 派生：有细化需求（必需活动 `plan_only` work）或偏差需求（共用 `readDeviationFacts` + `deviationsOfGoal` 返回非空，覆盖 `growth`/`lines`/`budget`/`stop`；不另写只含停因的近似条件）、且参谋收件人读回 `null`；队列读和答卡来源重核共用同一条判据，不新增持久 cause（PLS-17/C-28/PLT-15）。7D2 的 L35 之后换同一处调用的收件人，调用形状不变（设计 `:292`、`:475`）；**执行者自己的上报**：用现有 `send_session_message` 发给它认到的参谋线（技能里用 `find_related_sessions` 认人），带 `waitAfterSend: true`（`communication-tools.ts:479`-`:490`）。执行者不是 Host，不能调 `resolveDutyRecipient`；设计 `:292` 的“收件人按 L35”只应读成“平台侧发信按 L35”，见偏差 D-V2；**让出只挡它自己**（设计 `:296`）：Run 已 `yielded`，等待是消息上的一条 open wait（`src/core/work-graph/state/message-machine.ts:1145`-`:1152`），别的任务照常推进。
#### 7.1.3 什么时候不发

| 情况 | 不发什么 | 依据 |
|---|---|---|
| 同一 `deviation:<…>:<kind>:<planRevision>` 已提交 | 不重发；Host 发信重放原回执 | `mailbox-service.ts:2693`-`:2699`；设计 `:291` |
| 目标不是 `active`（暂停/取消） | 不发；选择本来就不选工作 | `workflow.ts:1511`-`:1512`（`goal_state` 等待） |
| 任务在当前正式计划里不是 `active`（被替代、取消、延后） | 不发系统轮，只告诉人；已执行的用替代任务 | 设计 `:331`；D-11 |
| 行数读数不完整（`changedLines.complete === false`） | 不发 `lines`；请知悉写“未知+原因” | 设计原则“读不到写未知”（`:64`）；10.4 |
| 增长量读数不完整、任务没有 `sizeClass` | 不发 `growth`；只累计 | v3 §4.3；10.4 |
| 同一任务同一版已有 `stop`/`budget` | 不发 `growth`/`lines`；软线写进“请知悉” | D-5（按 kind 重判）；10.5 |
| 执行者的前提错/矛盾 | 不发 `deviation:`；走 5.2 的普通 `action_request` 规划轮 | 设计 `:279`-`:282` |
| 第二次返工 | 仍是 7C-2 的通知，不改；偏差只在到上限/`no_new_basis` 时发 | 设计 `:290`（决定 42） |
| 没有参谋 | 不发秘书；出 `goal_cause` 卡，code `no_adviser` | 设计 `:123`、`:503`；M-4 |
#### 7.1.4 触发位置
设计 `:440`、`:448` 把“平台发现的偏差发系统轮”放在 `host.ts`、Run 结束处；本树 Run 结束的结算在 `src/core/work-graph/tasks/run-reconcile-service.ts:740`（`recordedBy: 'run_end'`，同一次提交写 `RunActivity`）。规格把**判定**放进目标循环的选择前一步，**发送**仍走 5.2 的 Host 系统发信：
- `selectNext`（`src/business/workflow/workflow.ts:1502`）在 release 步骤之后、任务选择之前，调同一个 `readDeviationFacts`（`tasks/goal-deviation-facts.ts`；这一轮已读的 `queryTaskGraph`（`Row.failure`）/RunActivity 作为可选入参），再调 `deviationsOfGoal`（7.5）；有未发的偏差就返回一个 `perform(sendSystemRound)`，`sendSystemRound: SessionMailboxPort['sendMessage']`，入参是 `SystemRoundV1` 的 `deviation` 臂（§5.2）；执行走 5.2.5 的固定发送身份 `sendMessage(systemRoundContext(scope, signal), request)`，`committed` 后回到选择；**普通返工和 N 请求仍用原身份**（`automationContext`）。发送成功后再选任务；同一轮不改计划、不采用。目标循环的候选处理仍在 C 的 6.1；**只在 Run 边界判。** Run 进行中只由 Runtime 判 Run 上限；不在 Run 中间读任务级增长量/行数，也不因为软线打断 Run（v3 §5.7）。
### 7.2 只挡那一支
**出口表（不新造停止机制）。** 设计 `:296`-`:301`、`:303`；v3 §5.7；v4 §10。

| 情况 | 谁停的 | 任务/Run 现在怎样 | 出路（只用现有入口） |
|---|---|---|---|
| 执行者上报并让出 | 执行者自己 | Run `yielded`；消息 wait `open`；只挡它自己 | 7.3 的三种答复；或人用 `controls/submit` 暂停/继续、`goals/control` |
| 软超线：任务增长量过 2 倍线 | 没人停 | 任务照常推进；Run 可能已结束 | 开参谋轮；轮后不改计划时 `plan_notice` 告诉人；参谋不改计划就照常走（设计 `:298`、`:543`；v4 `:372`） |
| 软超线：改动行数超过预估 2 倍 | 没人停 | 任务照常推进；Run 可能已结束 | 同上；行数只是读数，不是停因（v4 `:373`） |
| 提醒线：任务增长量到该档提醒线 | 没人停 | 任务照常推进 | 只给参谋一条 `notify`；不开模型轮 |
| 阶段线：预估行数合计过 2,000 行，或累计过 0.6B token | 没人停 | 候选/阶段照常推进 | 只提醒，写进“请知悉”/卡；不挡采用、不开轮（v4 `:370`） |
| 已有停因：返工上限、`no_new_basis`、`budget_exhausted` | 平台（Task 已停） | Task 停在停因上；Run 已结束 | 参谋改计划（替代任务）或问人；人用现有重排/重查/加预算入口：`tasks/requeue`（`core-routes.ts:543`）、`request_recheck`、`goals/control` |
| 依赖它的任务 | 现有规则 | 见 D-V1：本树只有 L46 的传递闭包会挡正式依赖；普通停因、软超线不挡下游 | 等它恢复/换计划；没有新机制 |
| 别的任务 | — | 不受影响 | 照常推进 |
- **两条软超线都不停任务。** 增长量过 2 倍和行数过 2 倍都是“开参谋轮”；轮后参谋不改计划时由 `plan_notice` 告诉人。`growth` 和 `lines` 各自一条偏差，各自最多一次；同一任务同一版已有 `stop`/`budget` 时不再发软线轮。
- **告诉人时带什么（D6）**：7.1.1 的四项（用了多少、改了哪些文件多少行、任务书在哪、停因）；偏差轮结束后参谋明确“不改计划”时，这四项以 `plan_notice` 投影出现（6.4.2），不是给参谋的 `notify`。人看得到改动靠现有 `RunActivity.changedFiles`/`changedLines` 和 `graph/detail`（`src/app/core-routes.ts:614`），不新开视图。
- **D-V1：依赖不是领取条件。** 本树 `executionDag.dependsOn` 只是软排序，不设“上游完成”门；唯一挡下游的是 L46 的卡/等待传递闭包（`task-gate.ts:109`-`:172`）。软超线和普通停因都不在 `blocks` 里，下游照常被选，缺输入时在消费处失败。本规格不加新闭包；这是对设计第 7 节的偏差，由 lead 改设计。

**三种状态下怎么暂停（设计 `:303`）：**

1. **Run 在跑**：`controls/submit` 提交 `pause`（路由 `src/app/core-routes.ts:463`；服务 `src/core/work-graph/tasks/control-service.ts:601`，指针 `pointerAfterSubmit`，`src/core/work-graph/state/control-intent-machine.ts:185`-`:188`）。继续用 `resume`（`controlSubmitProblem:200`-`:208` 只允许 paused 的指针继续）。
2. **Run 让出、在等**：同上，`controls/submit` 的 `pause` 作为等待的续作围栏排队（`src/core/work-graph/state/run-machine.ts:1906`-`:1922`）；不要用 `waits/dispose`（设计 `:323`，第 2 节第 17 行）。
3. **Run 已结束、下一个还没开**：把任务设为延后，走计划草稿（`docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md:227`）：`Disposition` 里的 `deferred`（`src/contracts/plan.ts:6`），经 `plans/proposePlan` + `applyPlanChange`（`src/core/work-graph/tasks/plan-service.ts:1450`）。或者暂停整个目标：`goals/control`（`core-routes.ts:546`）。
- **义务唯一承担者不能设延后**：`src/core/work-graph/tasks/plan-validation.ts:514`-`:521`（`hasRequiredCarrier` 要求候选里还有 `active` 的必需承担者）。这种情况下只有两条路：暂停整个目标（`goals/control`）或改计划加替代承担者；不为这个角落加新机制（设计 `:303`，PL3-01）。
- **D14：任务书级改动不单独出卡。** 自动采用、人知悉、可干预；参谋觉得重大就问人（设计 `:596`）。改目标、验收、范围和加预算仍要人（7.4）。
- **不做硬刹车**：平台不替人停任务，参谋也不（设计 `:303`、`:372`；v4 §10）。阶段线和 2 倍线只提醒/开轮；Run 上限由 Runtime 的现有预算拒绝，是已有的硬边界，不是本规格新造。
### 7.3 参谋的答复
一个规划轮。**三种答复 × 三种来源**（设计 `:307`-`:313`）：

| 答复 | 执行者发来的（在等） | 系统，软超线（`lines`，任务照常推进） | 系统，已有停因（`budget`/`stop`） |
|---|---|---|---|
| **改计划** | 写候选，进第 6 节。**先不回复真实发送者是执行者的 M，执行者继续等**；人的普通消息按原收尾结束；候选的结果见下表 | 写候选，进第 6 节；任务不停 | 同左；采用后是替代任务，不是解除停因 |
| **回答** | 按 5.3.5 的 `planningReplyTextOf` 从已存答案派生短结论（规划答案能解析出合法 `plan`/`questions` 时取 `summary`，`plan_round` 的文字退路保留已保存原文，审阅取定义的短结论、解析不出按 `terminal_invalid` 不回复，`text` 取原文本，均 ≤16 KiB）作为对原消息的回复（Host 关联：`src/business/workflow/intervention.ts:139`-`:165` 的 `respondFromQueryAnswer`；只有 `work_run` 能发文字回复，`mailbox-service.ts:3506`）；完整答案留在 Query 答案里，执行者按需读；原 wait 变 `responded` | 这一轮结束，判断写进给人的"请知悉"；不开新 Run、不改任务 | **不适用**：回复解除不了返工上限、`no_new_basis`、`budget_exhausted`（设计 `:312`、`:643`）。不给原消息回复，判断写进"请知悉"，任务仍停；要人用重排、重查、加预算入口 |
| **问人** | 出卡；这一支继续等；别的继续 | 出卡；任务不停 | 出卡；人用现有的重排/重查/加预算入口（设计 `:313`；`tasks/requeue`、`request_recheck`） |
- **“改计划”和“问人”期间都只延后执行者 M 的回复，不是所有原消息都不回。** 判据是 5.2.4 的 `executorWait && candidateOrQuestions`：真实发送者是执行者（`work_run`/`secretary_round`）且它的 wait 仍 `open` 才延后；**人对闲线发的普通消息和 Host 系统 R 按原收尾结束**（PL-01 的“候选待人时原消息已经结束”）。只有“回答”这一行、提案被拒、或采用成功后才回 M；M 只有一个回复槽，提前回一次就会让采用/续轮的第二次回复撞 `source_stale`。续轮按 §5.2/6.3.1 冻结 `prev.repliesToMessageRef ?? lineage.rootMessage`（不是复制当次 `followupOf`），多次问人仍能找到最初的 M（PLT-06/C-25/C-33）。

**执行者在等时，候选的结果**（设计 `:317`-`:321`）：

| 结果 | 动作 |
|---|---|
| 采用，原任务不动 | 采用后回复，执行者在新 Run 继续。`plan-machine.ts:677`-`:681` 只挡"被改动的已执行任务"的未消费等待；候选不碰这个任务时不触发 |
| 采用，原任务被替代 | 先取消这个让出的 Run，再采用，然后回复原消息收尾。自动档由平台做（下面），卡上由人做 |
| 转候选卡 | 继续等，人处理；不回复 |
#### 7.3.1 平台取消让出的 Run（D14 的唯一放开）
**只限两个条件同时成立：**

1. 候选明确替代这个任务：候选的 `reason.affectedTaskIds` 含 `taskId`（`src/core/work-graph/state/plan-machine.ts:76`、`:630`-`:639`），且草稿把这个任务设为 `superseded` 并给 `replacedByTaskId`（`src/contracts/plan.ts:58`-`:59`）；不是"只是动到"。
2. 等待的消息就是候选的来源消息：候选的 `sourceMessageRef`（`src/core/work-graph/tasks/plan-service.ts:1136`-`:1139`，`isInterventionSource` 已校验）与这条 wait 的消息 ref 精确相同。

**身份和 pin（PLT-08/C-27）。** 用平台自动化 actor `WORKFLOW_AUTOMATION_ACTOR`（`src/contracts/task-requeue.ts:44`），但**取消身份只由候选 `(proposalId, proposalRevision)` 和 `runRef` 决定，不含 Run revision**。这样取消已经提交、重读拿到新 Run revision 时仍是同一个控制意图，不会生成第二个身份再撞 `busy`。pin 仍用这次判据里读到的同一个 Run 版本，只作为 `expected`。写法照现有 `cancelReviewRoundStep`（`workflow.ts:239`-`:245`：`runRef` + `kind:'cancel'` + `expected:[{ref: run.ref, revision: run.revision}]`），执行照 `cancel_review_round`（`workflow.ts:2606`-`:2618`：`controls.submitControl(automationContext(...))`）。`controls/submit` 的输入只收 `runRef`/`kind`/`reason`（`control-service.ts:135`-`:146`），pin 规则在 `:174`-`:189`。**提交前先读既有控制意图**：复用 `controlIntentRefFor(WORKFLOW_AUTOMATION_ACTOR, scope, requestId)`（`control-service.ts:161`）和 `controls.readControl`（`:780`）；按第 3 步的真实状态判——本次 `queued`/`applied` 才跳过取消、续采用，权威 `not_found` 才提交，`superseded`/`outcome_unknown`/读失败保留实际出口。
```ts
// workflow.ts，WorkflowCalls 加一项：cancel_yielded_wait: RunControlPort['submitControl']
export function cancelYieldedWaitStep(base: Base, proposal: PlanProposalRef,
  run: RunSnapshot, reason: string): WorkflowOperation {
  // 身份 = 候选 + Run；不把 run.revision 放进 requestId。
  const requestId = 'wf-auto:cancel-yielded:' + sha256Hex(canonicalJson({
    schemaVersion: 1, goalRef: base.goalRef,
    proposalId: proposal.proposalId, proposalRevision: proposal.revision, runRef: run.ref,
  }));
  return { kind: 'cancel_yielded_wait', request: {
    input: { runRef: run.ref, kind: 'cancel' as const, reason },
    meta: { requestId, expected: [{ ref: run.ref, revision: run.revision }] },
  } };
}
```

**顺序（先取消、再采用、再回复）：**

1. 6.1 读到候选和这一版的事实（Goal、TaskRow、Run、wait 的消息、指针）。
2. 判人停在先：读 Run 的指针意图，用 `stopRequesterOf`（`src/core/work-graph/state/task-failure.ts:104`）和 `reworkFenceOf`（`:148`-`:154`）。若 `human_only`（人暂停/取消过），**不提交取消**，候选转卡（PL3-03；设计 `:325`）。必须显式判：`controlSubmitProblem`（`control-intent-machine.ts:200`-`:208`）允许 paused→cancel，所以不先判就会盖掉人的停止指针（`task-failure.ts:130` 的 `reworkStopOf`）。
3. **先读既有取消意图**：算上面的 `requestId` 和 `controlIntentRefFor`，读 `controls.readControl` 和这次判据里的 Run 快照，按真实控制快照和 Run 指针判（状态只有 `queued`/`applied`/`superseded`/`outcome_unknown`，`control-intent.ts:101`-`:110`）；**Run 的 `controlState.desiredState` 已是 `cancelled`（第 2 步已排除人的停止）也说明围栏成立，不再提交**：
   - **权威 `not_found`**（控制读完成、确实没有这次意图）→ 才提交 `cancel_yielded_wait`。`committed`/`replayed` 继续；`revision_conflict` 用**同一 `requestId`** 重读 Run 并重试（控制服务按同一 intent 重放），不生成第二个取消身份；`busy`/`forbidden`/`source_stale`/`unavailable`/`not_found` 一律不采用，转卡写原因。
   - **本次 `queued`**（revision 1、无 observation）→ 取消围栏已经成立（yielded wait 的续作排在队列里、不拉起 Run）→ 不重复提交，直接进第 4 步续采用。让出窗口的取消恰好保持 `queued`，这是最需要恢复的情况，不能漏。
   - **本次 `applied`**（revision≥2，observation 匹配）→ 已生效 → 进第 4 步续采用。
   - **本次 `superseded`/`outcome_unknown`** → 不猜、不采用，保留实际出口：`superseded` 按 6.1 的采用拒绝转卡写原因；`outcome_unknown` 保留候选、不重发，等下一次 Run/控制提交的事实变化再读。
   - **读失败**（`unavailable`/`not_ready`）→ 原样保留实际出口，不折成 `not_found`、不提交取消。
   **不使用不存在的错误码 `stale`**（PLS-30/C-31）。
4. 采用：`plans.applyPlanChange`（`plan-service.ts:1450`），pin 候选 revision 和 Goal revision（同 `intervention.ts:325`-`:335` 的写法）。让出的 Run 的指针已经是 `cancelled`，`plan-machine.ts:677`-`:681` 的忙判据放行（它看 `controlState.desiredState !== 'cancelled'`）。
5. 回复原消息收尾：**只在采用成功后**，用 6.3.1 的来源链找仍在等的执行者 M（`repliesToMessageRef ?? lineage.rootMessage`；`planfix:` 父候选链和 `planresume:` 原 Query 的 `sourceMessageRef` 都走这条链），`respondFromQueryAnswer` 按 5.3.5 的 `planningReplyTextOf` 从已保存答案派生短结论（规划答案取 `summary`，≤16 KiB）作为这条消息的**唯一**回复（`mailbox-service.ts:3594`；`intervention.ts:139`-`:165` 的幂等写法）；**不复制计划全文**，全文继续由 Query 答案和候选读取；消息变 `responded`，原 wait 关闭，执行者在新 Run 继续。已有同答案回复 → `responded`；已有别的回复 → `source_stale`；不第二次覆盖。
6. **取消失败/采用失败的出口（设计 `:610` 留规格，D-13）：**
   - 取消没提交：不采用，转候选卡（6.1 的"采用被拒绝"一行），写明取消被拒的码。
   - 取消提交了、采用被拒：候选按 6.1 的 `busy` 行保留重试；**其他拒绝**转卡写原因。此时让出的 Run 本来已结束，取消把它的续作围栏置成 `cancelled`；wait 仍 `open`，但这条等待不会再拉起一个 Run。任务停在系统取消上（不是人的停止：`stopRequesterOf` 判 `system`，围栏 `none`）。人可走 `tasks/requeue`、替代任务或暂停整个目标。**不自动回复、不自动重试第二次取消、不加新机制。**
   - 取消后采用一直没成功：目标循环按 6.1 的 `busy` 重试规则等事实变化；不重发取消（同一请求号）。
7. **取消仍是 queued 作为续作围栏**：yielded wait 的控制意图排队（`run-machine.ts:1906`-`:1922`），不把 Run 拉起来；`cancelled` 的指针不能直接 resume（`control-intent-machine.ts:202`）。
8. **三个崩溃窗口的恢复（PLT-08/C-27）。** 恢复读取先覆盖“取消已提交、采用未提交”“取消+采用都提交、回复未提交”两种：前者按第 3 步读同一 `controlIntentRefFor`，本次 `queued`/`applied` 就续采用、权威 `not_found` 才提交、其他终态/读失败保留实际出口；后者按 6.1.6 的 `acceptedCandidatesOf` + 源消息 open wait 读出来，**随后只补回复**，不再采用、不再 propose。取消 queued 但采用未提交时，候选仍在 pending，6.1 正常重读并复用同一取消身份重试；采用后候选退出 pending 集合也不会让回复永远补不上。全程不新增恢复记录、不改 Run 控制语义。

**返修/续轮的来源（同一来源链，跨两种首行）。** 返修写的是新独立候选，续轮写出的也是同一条链上的新独立候选；两者都用 6.3.1 的 `planSourceLineageOf` 从 `sourceMessageRef` 走：`planfix:` 读父候选，`planresume:` 读原 QueryJob 的 `execution.sourceMessageRef`（原 Query 可能正是返修 Query），直到链上第一条非这两种首行的消息。由这条链得到 `rootMessage`、`fixRound`/`fixBase`：平台取消的放开和采用后回复都拿 **`rootMessage`**（仍在等的执行者 M）与等待的消息精确比较；`fixBase` 只用于确认候选替代的是哪一版。不依赖 `replaces`、不改 Query 的来源、不加字段、不给所有 `planfix:` 候选取消权；候选/Query 的读取复用现有 `readPlanProposal` 和 Query 读（设计 `:326`；PL3-04）。

**续轮（`planresume:`）的回复。** 候选的来源消息是 `planresume:` 时同样用 `rootMessage`（最初执行者 M）和等待的消息精确比较；`repliesToMessageRef` 是 B 的 5.2 加的唯一定义（`prev.repliesToMessageRef ?? lineage.rootMessage`），采用/回复只认这个值，不认中间 R 的 `followupOf`（设计 `:327`、`:328`；PLT-07/C-33）。回复按 5.3.5 的 `planningReplyTextOf` 从续轮保存好的答案派生（规划答案取 `summary`），完整答案仍在 Query 记录里。
#### 7.3.2 消息等候选期间不再提供给这条线
设计 `:328`、`:611` 说"沿用哪个现有状态，规格定"。**定法：不新增状态。** 两个现有事实合起来已经够了：

1. 等待消息的 `message` 部分已经进入规划 Query 的 `acceptedInputs`（`src/core/work-graph/state/message-machine.ts:185`-`:198`；`evidence:'query_entered'`，`consumesWait:false`）。`deliveryEligibility` 对 `part:'message'` 见到 delivered 就返回 `{offerable:false, reason:'delivered'}`（`:1182`-`:1196`），不会再供给。
2. 这一轮还没结束的候选是 Goal 里 pending 的 `PlanProposal`（`findPendingProposal`，`src/core/work-graph/tasks/plan-readers.ts:555`）。只要它还在、且 `sourceMessageRef` 就是这条消息，5.2 的消费分支对这条消息返回"已有候选在等"，不再开一轮；这是读现有两个事实（候选 + 来源消息）的纯判断，不加记录、不改消息状态。**唯一例外是 5.5.2 的 `settlementOfferOf`**：它只在 Query 已终态（`settled`）、问题/文字回答/审阅/无答案收尾或候选确实缺收尾时给恢复报价，让现有 `handleIntervention` 续做终态，不把消息正文交给模型重开一轮。

`wait` 本身保持 `open`（`waitStateOf`，`message-machine.ts:1145`-`:1152`），只有回复（`responded`）、`waitCancelledAt`、撤回、过期或被消费才关闭；规格不改它。回复按 5.3.5 的 `planningReplyTextOf` 从保存好的答案派生短结论（规划答案能解析出合法 `plan`/`questions` 时取 `summary`，`plan_round` 的文字退路保留已保存原文；完整答案仍由 Query 答案读取，`intervention.ts:260` 的 `answerRefs.at(-1)` 只取它）。
#### 7.3.3 影响清单和已执行的任务
- `reason.affectedTaskIds` 写进候选（字段正本 `plan-machine.ts:76`，上限和形状 `:1142`-`:1162`），加一句话说明（`reason.text`）。第 2 节第 16 行说干预路径今天没填，补齐在同一处；平台不算语义影响（设计 `:330`：平台给差异，模型给判断）；差异计算复用 `src/core/work-graph/tasks/plan-validation.ts:348` 的 `deriveFuturePlanDelta`；已执行的任务不改执行定义，用替代任务（`plan-machine.ts:599`-`:611`：有 Run 的任务只能改 `disposition`/`replacedByTaskId`；设计 `:331`）。
### 7.4 范围内和范围外

| 改动 | 走哪 | 代码/依据 |
|---|---|---|
| 只细化占位、新增任务 | 第 6 节，自动档可自动采用 | `workflow.ts:1611`（`plan_only` 不选）；设计 `:337` |
| 动到已细化的任务，包括已执行的要换做法 | 第 6 节，自动档可自动采用，人知悉、可干预；已执行的用替代任务 | `plan-machine.ts:599`-`:611`；设计 `:338`、`:596` |
| 动到在跑的任务 | 采用前先停，决定 102-4，归 6C L13；之前是 `busy`，等它结束再采用，不抢 | `plan-machine.ts:663`（未结束的 Run → `busy`）；设计 `:339` |
| 改目标、验收、范围 | 6C L13，人答复，带完整影响清单 | `docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:247`；设计 `:340` |
| 动到正式架构 | 8C 结构改动，两档都出卡，D14 不改变这一条 | 设计 `:341`、`:488` |
| 要加预算 | 人，`tasks/requeue`（决定 62） | `task-failure.ts:957`（AV-11 要求更大的预算）；设计 `:342` |

**E09 的限定场景和完整验收分开（设计 `:344`、`:476`）：** 限定场景由这条路走完——执行者上报 → 参谋解释 → 需要时人决定 → 正式版本 → 替代任务带着新定义进入受影响上下文。**完整验收**还要 6C（改目标、验收、在跑切换）和第 8 片（正式架构变更）；本规格不写它们的做法，只写依赖。
### 7.5 类型和函数出口
```ts
// src/contracts/plan-deviation.ts（纯表；不读 I/O；Workflow 与 WorkGraph 共用这一正本）
export type DeviationKindV1 = 'growth' | 'lines' | 'budget' | 'stop';
export type DeviationStopReasonV1 = 'auto_rework_cap_reached' | 'no_new_basis';

export type DeviationV1 = {
  kind: DeviationKindV1;
  goalRef: GoalRef;
  taskRef: TaskTriple;
  planRevision: number;
  runRef: RunRef | null;                  // growth/lines/budget 必有；stop 取 failure.runRef
  stopReason: DeviationStopReasonV1 | null;
  usage: RunUsageReadingV1 | null;        // 10.4 的 Run 用量/增长量读数
  lines: LineReadingV1 | null;            // 10.4 的行数读数
  estimatedLines: number | null;
};

export type DeviationInputV1 = {
  goal: { ref: GoalRef; desiredState: 'active' | 'paused' | 'cancelled' };
  plan: { planRevision: number; tasks: readonly DeviationTaskFactsV1[] };
  runs: readonly { runRef: RunRef; facts: RunActivityFactsV1 }[];
  /** Host 设置的有效值（10.3）；不落记录，每轮由 Host 注入。 */
  limits: PlanLoopLimitsV1;
};

export type DeviationTaskFactsV1 = {
  taskId: string;
  disposition: 'active' | 'deferred' | 'cancelled' | 'superseded';
  /** 计划里已有的档位；growth 只在这个字段存在时判，缺省只累计（10.3）。 */
  sizeClass?: TaskSizeClassV1;
  estimatedLines?: number;
  stageId?: string;
  failure: Pick<TaskFailureFactsV1, 'runRef' | 'automation'> | null;
};

/** 按每个 kind 分别判断和去重：growth/lines/budget/stop 各有自己的条件与请求号；空数组 = 没有要发的。 */
export function deviationsOfGoal(input: DeviationInputV1): DeviationV1[];

/** 设计 :291 的请求号。 */
export function deviationRequestId(d: DeviationV1): string;

/** 7.1.1 的四项正文；没有导出路径时写计划版本+taskId。 */
export function deviationText(d: DeviationV1, taskBookPath: string | null): string;
```

`src/contracts/plan-deviation.ts` 是共享偏差纯表的唯一正本：`deviationsOfGoal`、`deviationRequestId`、`deviationText` 和它们的输入/返回类型都在这里，Workflow 的 `selectNext` 与 WorkGraph 的 `readGoalDecisionCauses` 引用同一份；纯函数不读 I/O。读事实的 `readDeviationFacts` 是 I/O，留在 `src/core/work-graph/tasks/goal-deviation-facts.ts`，只引用这里的类型。

出口：`deviationsOfGoal` 是纯函数，不拒绝，没有偏差返回 `[]`；每个 `kind` 单独判、单独去重（同一任务同一版同一 `kind` 最多一条，不是整版只留一条）；`growth` 只在 `sizeClass` 存在且增长量完整时判，`lines` 只在 `estimatedLines` 存在且行数完整时判，`budget`/`stop` 按各自失败事实；同一任务同一版已有 `stop`/`budget` 时不再返回 `growth`/`lines`（软线信息只写“请知悉”，不发轮，7.1.3）。`deviationRequestId` 对任何 `DeviationV1` 都返回上面的请求号；`deviationText` 缺读数写“未知+原因”、不写 0；`runUsageOf`/`lineReadingOf` 未知时 `tokens:null` 或 `complete:false`，不抛；`runGrowthOf`/`lineOverrun`/`stageOverLine` 读数不完整/没预估返回 `null`/`false`；`sendSystemRound`/`cancel_yielded_wait` 的拒绝沿用现有 `CoreError`（`invalid`/`forbidden`/`busy`/`source_stale`/`revision_conflict`/`unavailable`/`not_found`），经 `asRejection` 或 `waiting(receipt, "<code>: <reason>")` 归一（同 `suggest_member`/`cancel_review_round`，`workflow.ts:2697`-`:2699`、`:2614`-`:2616`），**不使用不存在的 `stale`**。

### 7.7 两条走法（软超线、已停因）
#### 7.7.1 软超线（`growth` / `lines`）
1. **Run 正常结束。** 结算的同一提交写 `RunActivity`（`run-reconcile-service.ts:740`），里面有 `facts.usage`（累计 token 和逐请求输入）和 `facts.changedLines`（10.4 的读数 C）。Run 不在中间被打断。
2. **目标循环下一趟读。** `selectNext`（`workflow.ts:1502`）之前，读当前正式计划图和任务行，拿这个任务在当前版的 `sizeClass`、`estimatedLines`（任务不在当前版或不是 `active` 就不发，D-11）；**用公开的 `executions.listExecutions`（`ExecutionReadPort`，`ports.ts:112`/`:122`；`execution-read-contracts.ts:43`/`:101`）按 Goal/Task 分页到底**得到 Run 列表，再以每批不超过 200 个 `RunRef` 调 `readRunActivities`；空集合直接返回空聚合，不调活动读，失败保持失败（PLS-23）。
3. **算两条软线。** 任务增长量 = 这个任务全部 Run 的增长量之和（10.4 的 `runGrowthOf`）；任务行数 = 已确认 `changedLines.added + deleted` 之和。
   - `sizeClass` 存在且增长量完整：到该档 2 倍线 → `growth` 偏差；到提醒线未到 2 倍线 → 只给参谋 `notify`。
   - `estimatedLines` 存在且行数完整：`added + deleted > 2 × estimatedLines` → `lines` 偏差；等于 2 倍不触发（严格大于）。
   - 读数未知/不全：不判超线，正文写“未知/不全”，不写 0。
4. **发系统轮。** `deviationsOfGoal` 返回未发的 `growth`/`lines`；`selectNext` 返回 `perform(sendSystemRound)`，Host 以系统身份发 `deviation:<goalId>:<taskId>:<kind>:<planRevision>` 给参谋。没有参谋时出 `goal_cause` 卡（code `no_adviser`），不发秘书（M-4）；判据是 5.5.3 的“细化或偏差需求 + 权威无收件人”，`growth`/`lines` 也走同一判据。同一版同一任务同一 `kind` 只发一次；`growth` 和 `lines` 是两条独立偏差，各有请求号。
5. **告诉人。** 偏差轮结束后，参谋明确“不改计划”（答案既不是 plan 也不是 questions）时，`plan_notice` 投影出一条 `deviation-notice:<goalId>:<requestId>`（7.1.1 的四项 + “不改计划”）；不开模型轮。同一任务同一版已有 `stop`/`budget` 时，软线不发轮，只写进“请知悉”。
6. **参谋轮。** 改计划 → 候选进第 6 节；不改 → 这一轮结束，判断写进“请知悉”；问人 → 出卡。任务在第 4–6 步期间照常推进，别的任务也继续（设计 `:298`、`:543`；v4 §10）。不做硬刹车。
7. **阶段线不在这条路里。** 阶段预估行数合计过 2,000 行或累计过 0.6B token 只提醒，写进“请知悉”/卡，不挡采用、不发偏差轮（v4 §10）。
#### 7.7.2 已有停因（`budget` / `stop`）
1. **停因出现。** Run 结束（`budget_exhausted`）或 Task 的失败事实给出 `stopped`（`task-failure.ts:948`、`:951`、`:956`）；Run 结束的结算写 `RunActivity`，Task 的失败事实从 `queryTaskGraph` 的 `row.failure` 读出（工作流已读的计划图，不另开 Store 读）。
2. **目标循环读。** 读 `row.failure.automation.verdict`；任务已经停了。
3. **按失败事实取硬停因。** 同一任务同一版的 `row.failure.automation.verdict` 只给一个硬停因：`stopped` 的停因码决定 `stop`，`budget_exhausted` 决定 `budget`；**不是跨 kind 的 `stop > budget` 优先级**，同一个 `kind` 才去重。软线不再发，`growth`/`lines` 的信息写进同一条正文或“请知悉”。
4. **发 `deviation:`。** 正文四项，第三项是任务书在哪；偏差轮结束后参谋明确“不改计划”时由 `plan_notice` 投影出一条（6.4.1/6.4.2）。没有参谋时出 `goal_cause` 卡，code `no_adviser`，不发秘书；判据是 5.5.3 的“细化或偏差需求 + 权威无收件人”，`budget`/`stop` 与软线共用同一份偏差事实。
5. **参谋轮。** 改计划 → 候选（替代任务）→ 6.1 的诊断/审阅/采用；采用前按 7.3.1 先取消让出的 Run（只有执行者在等时才需要）；回答 → 不适用，判断写进“请知悉”，任务仍停；问人 → 出卡。
6. **人用现有入口。** `tasks/requeue`（加预算/人工重排）、`request_recheck`、`goals/control`（7.2）；平台不自动解除停因，也不另造停止。
7. **依赖只按 D-V1。** 依赖不是领取条件；本树只有 L46 的传递闭包会挡下游。普通停因不挡依赖它的任务，下游缺输入时在消费处失败。本规格不加新闭包；这是对设计第 7 节的偏差，由 lead 改设计。
## 8. 并发顺序
### 8.1 什么不变
- **波由 `executionDag` 算**：选择顺序是稳定的 Kahn 拓扑排序（`src/business/workflow/task-order.ts:1`-`:40`，`orderTasksByDependency`；调用点 `workflow.ts:1308`、`:1557`）。它只改选择顺序，**不是**上游完成门（`:5`-`:10`；`src/core/work-graph/tasks/eligibility.ts:26`-`:29`）。
- **L16 不重叠**：同一目标里，后一个任务的模块和正在跑的任务重叠时，先开模块门，不直接派（`src/business/workflow/workflow.ts:1752`-`:1800`；`slice-7-SPEC.md:105`、`:206`）。
- **N 门处理重叠**：`open_overlap_gate` + `request_overlap_note`（`workflow.ts:1783`-`:1799`；服务 `src/core/work-graph/tasks/overlap-gates.ts`）。
- **决定 49 的约定在先**：接口约定是参谋/秘书的注记（`convention`，挂在模块锚点上），不是平台语义判断；门只判"有没有晚于冲突 Run 开工的注记"，不判内容（`overlap-gates.ts:89`-`:101`）。
- **不做事前并发证明**（设计 `:36`）：门和注记只覆盖同一模块的重叠，别的并发照常。
### 8.2 参谋在并发上只做两件事
细化的那一段里写好 `executionDag` 依赖和模块（`RuntimeTask.stageId`/`scope.moduleRef`，`src/contracts/plan.ts:36`、`:8`-`:15`），并用 5.3 第 2 条在规划轮写接口约定（`noteAdmission` 放宽，`src/core/agent-runtime/tool-group-assembly.ts:641`、`:650`）。平台不替它排并行，也不做事前证明。
### 8.3 PL-11：规划期的注记不能让 N 门提前满足
门的判据（`overlap-gates.ts:89`-`:101`）：有一条 `accepted`/`reviewed` 的 `convention`/`decision` 注记，挂在同一模块锚点上，且注记的 `since`（提交位置）**严格晚于**每个冲突 Run 的 `startCursor`（`compareCursors(note.since, cursor) > 0`）。冲突 Run 的 `startCursor` 取 `RunSnapshot.startedSince`（`workflow.ts:1763`-`:1775`）。

所以：

1. 规划期写的注记发生在冲突 Run 开工之前，`since` 更早，门仍是 `not_satisfied`。
2. 实际请求到来后（`open_overlap_gate` 已经记下 `running` 的 `startCursor`），Host 发注记请求（`overlap-gates.ts:215`-`:245`，请求号 `overlap-note:<gate key>:<basisDigest>`，收件人先参谋、后秘书）。
3. 参谋/秘书的**这一轮**核对并更新注记（新版本 `since` 更晚）；`NoteVersion`/`NoteHead` 的提交在等待聚合里（`src/app/goal-wait-wakes.ts:31`-`:34`），会叫醒目标。
4. 下一趟选择重读门；`checkOverlapGate` 满足后才派第二个任务。**规划期的注记不能省掉第 2、3 步。**
### 8.4 两个接缝缺口由 5.2/5.3 解决
1. 系统发的 `action_request` 不进空闲消费（第 2 节第 3 行；`src/core/work-graph/views/consumable-sessions.ts:80`-`:89`：只有 `work_run`/`secretary_round` 的 `action_request` 算 `action_request`，Host 系统的落到 `null`；`notify` 单列，不开轮）。5.2 的 `offerKindOf`/`proveInterventionSource` 接纳 Host 系统身份；**同时 5.2.7 在 Query 创建时冻结 `answerShape`，让规划轮挂 `submit_plan_round`、审阅轮挂 `submit_plan_review`**。只做前者不做后者，审阅/规划 Query 能开起来，但模型没有提交工具，只能写文字；C-1 要求两者都有。
2. 规划轮写不了注记（第 2 节第 12 行；`tool-group-assembly.ts:641`、`:650` 只给 `noteAdmission.class === 'secretary'`）。5.3 第 2 条（G 的 5.3.5）把 `noteAdmission` 放进参谋规划轮；**它和 5.2.7 的提交工具是两条独立的准入，不能用一个代替另一个**：注记臂管 `record_note`，`answerShape` 管提交工具。

**没有参谋时，秘书可以在请求轮写注记**（冻结裁定 `7c1-start-rulings-v2.md:1810`；PL-12）：N 的注记请求本来就先参谋、后秘书（`overlap-gates.ts:215`-`:237`），这条路不受影响；本规格不改秘书分支。没有参谋也没有秘书时，门的 `noteRequest` 记 `{recipient:null, reason:'no_adviser_or_secretary'}`（`:237`），门保持 pending；5.1 的 `goal_cause` 卡（code `no_adviser`）照旧（103-1），不发给秘书；`adviser_creation` 归 7D2。
### 8.5 谁先谁后
**冷启动（目标已采用，Host 启动驱动）：**

1. Host 建目标驱动（DRV，`src/app/collaboration-driver.ts`），`selectWork` 读 Goal、计划、任务行。
2. `selectNext` 按 `orderTasksByDependency` 排候选（波）。
3. 选第一个可派任务：建/复用 Session → 领取 → 准备（pin 计划、权限、预算）→ 启动；把这一步交给这个任务的看守，**不等 Run**（DRV §3.2）。
4. 同一次推进继续问 `select_work`：第二个候选如果和第一个 Run 模块重叠，开 N 门（8.3 第 1 步）；不重叠就按 L16 再派一个（并行）。
5. 门请求的收件人在**请求那一刻**解析（先参谋、后秘书）；绑定晚于任务启动不影响这条请求的去处。

**重启（97-9）：**

1. Host 启动时按 97-9 给有没做完必需工作的 active Goal 写 `GoalInterruption`，`ask`/`off` 档下不登记唤醒（`src/app/goal-wait-wakes.ts`；`host.ts` 的重建）。
2. 人用 `workflow/driver-start` 启动目标，`onStarted` 清中断；目标循环从记录重推，**不重派已经在跑的 Task**（DRV 的 `activeTaskIds`）。
3. 在跑的 Run 保留它的 `planRef`、权限和预算；新计划采用不改它在跑的执行定义，要换做法只能替代任务（`plan-machine.ts:599`-`:611`）。已结束的 Run 先走读事实（RunActivity/失败事实），再走偏差和候选。
4. 重启发生在审阅轮中：按 97-9 等人；解除后从原候选/Query 续接，不重复采用（设计测试 41）。
5. **重启发生在“Query 已 settled、候选或回复未写”或“已采用、回复未写”时（PLT-02/08/09/C-26/C-27）：** 不靠 `resumeOfferOf`（只供给 `claimed`/`prepared`），也不靠重新投递源消息；按 5.5.2 的 `settlementOfferOf` 和 6.1.6 的 `acceptedCandidatesOf` 读现有 Query/候选/消息事实，续做终态：该写候选的写确定性候选，候选已写但 R 未关联的只补关联 R（不写第二个候选），该回 R 的只回 R，已采用而未回 M 的**只补回复**（所有已采用候选都查，不只活动计划那一版）。不新建 Query 或恢复记录；控制取消先读 `controlIntentRefFor`，本次 `queued`/`applied` 直接续采用，`not_found` 才提交。

**绑定晚于启动：**
- 任务的 `planRef`、`roleBinding`、预算在领取时定下（`RunSnapshot.planRef`、`roleBinding`、`budget`，`src/contracts/dispatch.ts:251`-`:253`）。之后新建或换的参谋/秘书/审阅线**不改**已在跑的 Run；N 门的注记请求在请求时解析收件人（`overlap-gates.ts:215`-`:237`），所以绑定晚于任务启动也能收到；收件人为空时门保持 pending，出卡；执行者的上报按它自己认到的线发（7.1.2），不受后来绑定影响。

**Run 还在跑：**
- 改到它的候选：`busy`（`plan-machine.ts:663`），等 Run 结束再采用，不抢（设计 `:339`；6C 前）；同模块的第二个任务：N 门挡着，先写/更新注记；不重叠的照常并行；目标循环不守着 Run（DRV 的决定循环），Run 结束的看守把结果交回；偏差在 Run 结束、事实读到时判（7.1.4），不在 Run 还在跑时判。

**Run 已结束：**

1. Run 结束的结算同一次提交写 `RunActivity`（`run-reconcile-service.ts:740`）。
2. 目标循环读事实：失败/停因 → `deviation:`（7.1）；正常结束 → 行数 2 倍检查（10.3）。
3. 候选处理（6.1）：诊断、审阅、采用；采用提交成功后先补候选来源消息（执行者 M）的唯一回复，再继续选任务（7.3.1）；采用回 `busy` 就保留候选、等 Run 或等待变化后重试。
4. 都推进不了才登记等待；等待的提交类型见 `goal-wait-wakes.ts:31`-`:34`。重启后按 5.5.2/6.1.6 的恢复读续做“已终态未写收尾”（问题/文字回答/审阅/无答案/候选未写或已写但 R 未关联）和“已采用未回复”（所有已采用候选），只补缺的终态。
## 10. 层、尺子和预算
依据 v3 `goal-layering-design.md` 第 4 节、5.7、5.8、5.9，以及 v4 `plan-loop-design.md:366`-`:373`（第 10 节）。v4 第 10 节改四处：阶段线改成“预估行数合计 2,000 行，或累计 0.6B token”，代替 v3 的 1,500 万增长量；Run 上限初值 4 亿、可配到 6 亿；2 倍线从“请人看”改成“开参谋轮 + 告诉人”；任务书的预估行数超 2 倍也走同一条路。

**三个读数不是三个层。** 三个读数是**累计 token、上下文增长量、改动行数**（v3 §4.2）。Run、任务、阶段、目标只是同一组读数上的聚合层；不要把“Run 用量 / 阶段用量 / 任务行数”当成三个读数。
### 10.1 三层
只用现有三层，不加层、不加记录种类（v3 §4.1；v4 `:33`、`:105`-`:113`）：

| 层 | 是什么 | 代码 | 尺子 |
|---|---|---|---|
| 目标 Goal | 整个产品 | `GoalSnapshot`（`src/contracts/ledger.ts`） | 只累计、目标栏显示；不设默认上限 |
| 阶段 Stage | 切片 | `PlanStage`（`src/contracts/plan.ts:148`）；任务用 `stageId` 归属（`:36`） | 阶段线：预估行数合计 2,000 行，或累计 0.6B token；只提醒 |
| 任务 Task | 组 | `RuntimeTask`（`src/contracts/plan.ts:34`）；`sizeClass?`、`estimatedLines?` | 任务档位提醒线 / 任务 2 倍线；软超线不停任务 |
| Run | 一次执行 | `RunSnapshot`（`src/contracts/dispatch.ts:222`） | Run 上限（Runtime 的现有硬边界，不是三个读数之一） |
- **Run 不是一层。** 它是读数的最小事实单位；任务、阶段、目标都是它的聚合。
- **波不是一层。** 波是 `executionDag` 里能同时开工的一批任务，不落记录。
- **更大的工程拆成多个目标**，按决定 49 的标准；先不做阶段嵌套。
- **小目标不用分。** 一个阶段放得下时，骨架就是完整计划，行为与今天相同（v3 §4.1、§5.1）。
### 10.2 三把尺子

| 尺子 | 回答什么 | 定义 | 单位 |
|---|---|---|---|
| 累计 token | 花了多少 | 输入加输出；含重发历史、含缓存；不扣缓存 | token |
| 上下文增长量 | 工作量多大 | 一次 Run 里相邻两次请求的输入上涨量之和，再加最后一次请求的输出；第一次请求的输入不计 | token |
| 改动行数 | 产出多少 | 一次 Run 里已确认的 `edit` 调用的增删行之和，用 `lineDelta` 算 | 行 |

**上下文增长量的算法（v3 §4.2）。** 输入序列 100、180、90、150，增长量 = 80 +（下降不计，记 0）+ 60 = 140，再加最后一次请求的输出。
- **只累加上涨。** 输入下降不计；之后再涨才计。同一步里新增和裁剪互相抵消时会少计，所以这是工作量的近似读数，不是精确账；**第一次输入不计。** 同一 Session 连做两个任务时，第二个任务的第一个 Run 第一次输入不计，所以不会把第一个任务的历史算进来；**能直接相加。** 任务是它的 Run 之和，阶段是任务之和，目标是全部之和；不按 Session 去重。每个成员的 Run 都计入，包括子 agent；**缓存和重发照计。** 累计 token 用 `usage.totals.inputTokens + outputTokens`，不减去 `cachedInputTokens`，也不因重发去重；**有未知时跳过并标“不全”。** 某次请求没报用量，就跳过它参与的那一段，读数标 `complete:false`，文字写“不全”；不把它当 0。

**改动行数的算法。**
- 成功的 `edit`：`mode:'create'` 按 `newText` 的行数记新增，`mode:'replace'` 用 `lineDelta(oldText, newText)` 记增删；`shell` 也可能改文件，但算不到可靠行数：出现 `shell`、未知结果、被拒绝的调用、非 `create`/`replace` 的模式，都标 `complete:false`，不补 0；沿用现有 `command_ran` 的“不全”口径；被拒绝的调用不算；不明副作用标“不全”；行数只从这个 Run 自己的 Kernel `edit` 记录算，不读工作区快照，避免把并行 Run 的写入算进来；`lineDelta` 现在在 `src/app/attention-observer.ts:124`，`core/agent-runtime` 不能反向 import `app`；落地时原样挪到 `src/contracts/line-delta.ts`，`attention-observer.ts` 改为导入，不写第二份（D-18）。
### 10.3 任务档位、阈值和三条线
计划里的任务加一个可选字段 `sizeClass`（v3 §4.3）。没有档位时只累计，不提醒。下表是默认值；判定用 Host 当前有效的 `planLoopLimits`（10.3 末，可由 `plan-loop-limits/save` 改）。

| 档 `sizeClass` | 提醒线 | 请人看的线（2 倍） | 对应实测 |
|---|---|---|---|
| `small` | 1M | 2M | 约中位数 |
| `medium` | 2.5M | 5M | 75% 到 90% 分位之间 |
| `large` | 4M | 8M | 90% 分位以上 |
| `explore` | 4M | 8M | 探索方向 |
- **按上下文增长量判。** 任务档位的两条线都是增长量，不是累计 token、不是行数；**档位由参谋选、平台对账。** 占位任务也带档位，表示这一段的预估大小；细化时参谋按实际粒度收敛。没有 `sizeClass` 的任务只累计、不提醒；**探索不加新字段。** 一路方向就是一个 `explore` 任务，并行探索就是几个并行任务。提醒线在探索里是额度：到线先交现有结论，参谋提建议，由人决定加不加（决定 62）；**行数线独立。** 任务书写 `estimatedLines` 时，已确认的改动行数 `> 2 × estimatedLines` 也触发同一条路；没有预估、读数不完整时不触发（不拿未知或 0 当超线）。

**三条线的动作不同：**

| 线 | 判据 | 动作 | 停不停任务 |
|---|---|---|---|
| 任务提醒线 | 任务增长量 ≥ 该档提醒线 | 给参谋一条 `notify`，同一任务同一条线只发一次；不开模型轮 | 不停 |
| 任务 2 倍线（增长量） | 任务增长量 ≥ 该档 2 倍线 | 系统轮 `deviation:<goalId>:<taskId>:growth:<planRevision>`，开参谋轮；轮后不改计划时以 `plan_notice` 告诉人 | 不停 |
| 改动行数 2 倍线 | 已确认 `changedLines.added + deleted > 2 × estimatedLines` | 系统轮 `deviation:<goalId>:<taskId>:lines:<planRevision>`，开参谋轮；轮后不改计划时以 `plan_notice` 告诉人 | 不停 |
| 阶段线 | 阶段内 `Σ estimatedLines > 2,000`，或阶段累计 token `> 600,000,000` | 只提醒：写进这次“请知悉”/候选卡；不挡采用、不开轮、不停任务 | 不停 |
| Run 上限 | Run 累计 token 到 `budget.tokenBudget` | 现有路径：任务记 `budget_exhausted`，Goal 按现有规则显示 | 已由 Runtime 停 |

**阶段线不是硬线。** “预估行数合计 2,000 行”是计划里这一段任务的 `estimatedLines` 之和；“累计 0.6B token”是这一段所有已结束 Run 的累计 token。两条任一超过只提醒，可配置。v4 第 10 节明确用这两条代替 v3 的 1,500 万增长量；不要再把“1,500 万增长量”当阶段线。阶段读数不完整（有任务没写 `estimatedLines`，或有 Run 用量未知/不全）时，已知部分照常显示并标“不全”，不拿已知部分当完整超线去提醒。

**阈值放 Host 设置，可配置。** 默认值如下，全部是初值：
```ts
// src/contracts/plan-loop-limits.ts
export type TaskSizeClassV1 = 'small' | 'medium' | 'large' | 'explore';

export type PlanLoopLimitsV1 = {
  schemaVersion: 1;
  taskReminderTokens: Record<TaskSizeClassV1, number>;   // 1M / 2.5M / 4M / 4M
  taskTwoTimesTokens: Record<TaskSizeClassV1, number>;  // 2M / 5M / 8M / 8M
  lineMultiplier: number;                                // 2
  stageLineBudget: number;                               // 2_000
  stageTokenBudget: number;                              // 600_000_000
};

export const DEFAULT_PLAN_LOOP_LIMITS: Readonly<PlanLoopLimitsV1> = Object.freeze({
  schemaVersion: 1,
  taskReminderTokens: { small: 1_000_000, medium: 2_500_000, large: 4_000_000, explore: 4_000_000 },
  taskTwoTimesTokens: { small: 2_000_000, medium: 5_000_000, large: 8_000_000, explore: 8_000_000 },
  lineMultiplier: 2,
  stageLineBudget: 2_000,
  stageTokenBudget: 600_000_000,
});
```
- **值进现有 Host 设置体系（PLS-26/C-30，裁定：只补后端，不写界面）。** 值进 `HostSettingsSnapshot`（`src/app/host-settings-types.ts:38`）的一个 `planLoopLimits` 字段：`{ saved: PlanLoopLimitsV1 | null; effective: PlanLoopLimitsV1; defaults: PlanLoopLimitsV1 }`。保存入口按现有 `run-budget/save` 的形状加 `plan-loop-limits/save`（`src/app/host-settings.ts:1271`-`:1290`、路由表 `:1573`；快照构造 `:762`）：输入 `{ planLoopLimits: PlanLoopLimitsV1 | null }`，`null` 删键恢复默认。**校验**：`schemaVersion===1`，四个 `TaskSizeClassV1` 键齐全无多余，所有数为正安全整数，`taskTwoTimesTokens[k] >= taskReminderTokens[k]`，`lineMultiplier >= 1`，`stageLineBudget`/`stageTokenBudget` 为正安全整数；不合法 `invalid`，不落盘。**持久化**：写现有设置文件，失败回滚内存值并 `unavailable`，和 `run-budget/save` 一样先 `persist()` 再 `notify()`；保存后 `notify()` 失败返回“已保存但 Host 未确认，重试同一保存”，不写第二份记录。**读取和生效**：`snapshotOf` 发布 `saved/effective/defaults`；Host 组装时把 `effective` 注入 Workflow 的偏差判定和阶段线读数（`deviationsOfGoal` 的 `input.limits`，见 7.5），下一次目标选择立即用新值，已领取的 Run 保持旧预算。E3 只接页面，不新建设置记录，不改 `run-budget/save` 的 Run 上限。测试可以注入小值，写法同 `ACTIVITY_READ_RECORD_CAP`（`src/contracts/run-activity.ts:24`）；Run 上限已有 `run-budget/save`，默认 4 亿、可配到 6 亿（`host-settings-types.ts:15`-`:19`）。
### 10.4 三个读数怎么算
三个读数都从 Run 结束写入的 `RunActivity` 读，都是“读现有事实，不新增记录”（只有行数往现有 `RunActivityFactsV1` 加一个字段）。

**（1）累计 token。**
- 来源：`RunActivitySnapshot.facts.usage.totals.inputTokens + outputTokens`（`src/contracts/run-activity.ts:42`-`:62`；tally 在 `src/core/agent-runtime/run-activity-tally.ts:252`-`:279`）；含重发历史、含缓存；不扣 `cachedInputTokens`，不按 Session 去重；`usage.complete === false` 或 `usage.omitted > 0`：已知部分照常显示，标“不全”；判定线不触发；`status:'unknown'`：读数未知，显示“未知+原因”，不显示 0（新记录必写完整字段，不保留旧版本解码；PLS-27）。

**（2）上下文增长量。**
```ts
// 纯函数；输入是 RunActivityFactsV1.usage
export type RunGrowthReadingV1 = { tokens: number | null; complete: boolean };

export function runGrowthOf(usage: RunModelUsageV1): RunGrowthReadingV1 {
  // 看不到最后一段（第 257 次起被截掉）：不补算。
  if (usage.omitted > 0) return { tokens: null, complete: false };
  const requests = usage.requests;
  if (requests.length === 0) return { tokens: null, complete: false };
  let complete = usage.complete;
  let sum = 0;
  // 第一次请求的 inputTokens 不计：从 i = 1 开始看相邻上涨。
  for (let i = 1; i < requests.length; i += 1) {
    const prev = requests[i - 1]!;
    const cur = requests[i]!;
    if (prev.usageStatus !== 'reported' || cur.usageStatus !== 'reported') {
      complete = false;                    // 跳过这一段，不跨过未知去接下一段
      continue;
    }
    sum += Math.max(0, (cur.inputTokens ?? 0) - (prev.inputTokens ?? 0));
  }
  const last = requests[requests.length - 1]!;
  if (last.usageStatus !== 'reported') return { tokens: null, complete: false };
  // 只有一次请求时 sum = 0，正好等于最后一次输出。
  return { tokens: sum + (last.outputTokens ?? 0), complete };
}
```
- 请求数上界是 `RUN_USAGE_REQUESTS_CAP = 256`（`src/contracts/run-activity.ts:18`）。第 257 次起进 `usage.omitted`，增长量标“不全”，不补算；一次 Run 的第一次输入不计，所以同一 Session 的第二个任务不会带上一个任务的历史；输入下降不计；增长量是工作量近似值；裁剪造成少计时标“不全”或按已知值显示，不另做精确账。

**（3）改动行数。**
- `RunActivityFactsV1.changedLines` 是唯一新增的持久字段：`{ added: number; deleted: number; complete: boolean }`（D-6）；在 `tallyTurnActivity` 的同一个 Turn 窗口里，对成功的 `edit` 调用求和：`create` 按 `newText` 行数，`replace` 用挪到 `src/contracts/line-delta.ts` 的 `lineDelta`；`shell` 编辑、未知结果、被拒绝的调用、其他模式：`complete:false`，不补 0；规则版本 1 → 2，版本 2 必写必校验，旧版本记录按损坏拒绝（`unavailable` 一类现有结果），开发库和夹具按当前格式重建，没有 `changedLines` 的版本 2 记录同样按损坏拒绝、不当未知处理；行数不是“改过的文件数”；`facts.changedFiles` 只给路径，不给行数。
### 10.5 聚合、判定和读取时机
**聚合。** 三个读数都按 Run 算，再沿层相加：

| 层 | 累计 token | 上下文增长量 | 改动行数 |
|---|---|---|---|
| 任务 | 这个任务全部 Run 的累计 token 之和（含返工、接续、子 agent） | 同一组 Run 的增长量之和 | 同一组 Run 的已确认行数之和 |
| 阶段 | 这个阶段全部任务的累计 token 之和 | 同一组任务的增长量之和 | 同一组任务的行数之和 |
| 目标 | 这个目标全部 Run 的累计 token 之和 | 全部 Run 的增长量之和 | 全部 Run 的行数之和 |
- 任务归属看 Run 的 `claim/planRef` 指向的计划版本里的 `taskId`；任务定义冻结，`stageId` 不变；阶段只收 `stageId` 相同的任务；`stageId` 为空的 Goal 范围任务不进阶段线，只进目标累计；未知向上一层传：某个 Run 未知，它的任务/阶段/目标读数标“不全”；不能一边标不全、一边拿已知部分当完整数去过线；**不按 Session 去重。** 同一 Session 接续多个任务，各 Run 各计各的；这正是“包括子 agent”的口径。

**判定（Run 边界，不在 Run 中间打断）：**

1. Run 结束，`run-reconcile-service.ts:740` 的同一提交写 `RunActivity`（`recordedBy:'run_end'`）。
2. 目标循环下一趟在 `selectNext`（`src/business/workflow/workflow.ts:1502`）之前读：当前计划图（`queryTaskGraph`）；**Run 列表用公开的 `executions.listExecutions` 分页到底**（`ExecutionReadPort`，`ports.ts:112`/`:122`；`execution-read-contracts.ts:43`/`:101`；`page.limit` 1–100，`nextCursor` 到 `null` 为止），再以每批不超过 200 个 `RunRef` 读这些 Run 的 `RunActivity`（`readRunActivities`，`src/core/work-graph/views/activity-read-model.ts:1154`）。空集合直接返回空聚合，不调活动读；失败保持失败，不折成空。
3. 先算 Run 读数，再加成任务、阶段、目标；纯函数，不落第二份记录。
4. 任务增长量对档位提醒线/2 倍线；任务行数对 `2 × estimatedLines`；阶段对 2,000 行或 0.6B token。
5. 阶段线只写进“请知悉”/候选卡；任务 2 倍线（growth）和行数 2 倍线（lines）发系统轮并告诉人；任务不停，别的分支继续。
6. 同一任务同一版：`growth` 和 `lines` 是两条独立偏差，各自最多一次；同一任务已有 `stop`/`budget` 硬停因时，软超线不再发轮，只写进“请知悉”（硬停因已经让任务停了，软线没有可开的轮）。
7. 读数未知或不全：不提醒、不判超线，显示“未知/不全”；不拿 0、不拿已知下限冒充完整数。
8. Run 上限由 Runtime 的现有预算拒绝（`src/core/agent-runtime/model-budget.ts:125`-`:147`）决定，读数只负责“用了多少”；本规格不改这条硬边界。

**64 倍校准（v3 §4.2 的实测）。** 282 次 DSH 运行的实测：累计 token 约是上下文增长量的 64 倍；0.6B 约折 940 万增长量（0.6B / 64 = 9,375,000）。
- 这是换算和校准，不是仅供界面展示的常量：它用来把阶段线 0.6B 讲回 v3 的增长量口径（约 940 万），用来核对档位阈值和实测分位（中位数 0.93M、75% 1.63M、90% 3.18M、95% 6.22M、最大 32.8M），也用来在偏差正文里同时写 token 和增长量；判定仍用各自单位：任务档位用增长量，阶段 token 线用累计 token；不把 64 倍变成第二个阈值，也不因为“只是展示”把它删掉；实测算上了每个 Session 的第一次输入，平台按 Run 计时不算，读数会略小；这是一个项目、一个模型的数据，只作初值。

**不做硬刹车。** 阶段线和 2 倍线都不停任务；任务层没有硬上限，让出等待后的接续 Run 不计返工次数，多次接续能超过任何固定倍数。硬刹车要新造整条出卡、答复、解除、重启重读的闭环，第一版不做（D6）。加额度归人（决定 62）：沿用 `tasks/requeue` 带更大预算的现有路径。

**目标层只累计。** 目标栏显示累计 token、增长量、行数；不设默认上限。人手动设目标上限留到 MVP 之后（v3 §5.9）。
## 13.2 第 2 步：三个读数
设计 `plan-loop-design.md:472` 把第 2 步叫“三个读数”，无依赖，7C 之后可并行。本节的“第 2 步”指目标循环/偏差判断在 **Run 结束、`RunActivity` 已写入之后**的那一步；不是“再做一个读数服务”。三个读数是累计 token、上下文增长量、改动行数；Run/任务/阶段/目标只是它们的聚合层。
### 13.2.1 真实顺序
1. **Run 结束。** `run-reconcile-service.ts:740` 一带的结算把 `RunActivity` 与 Run 的收尾写进同一个提交；`recordedBy:'run_end'`。`facts.usage` 是逐请求的 `RunModelUsageV1`，`facts.changedFiles` 是路径，`facts.changedLines` 是这次新加的行数读数。
2. **目标循环下一趟读计划。** `selectNext`（`src/business/workflow/workflow.ts:1502`）之前，这一轮已经读了当前正式计划图和任务行（`queryTaskGraph`）；不再为读数重读计划。
3. **按任务取 Run 列表。** 用公开的 `executions.listExecutions`（`ExecutionReadPort`，`ports.ts:112`/`:122`；`execution-read-contracts.ts:43`/`:101`）按 Goal/Task 分页到底（`page.limit` 1–100，`nextCursor` 到 `null` 为止），得到这个任务的全部 Run。**不调内部 `readCanonicalTaskFacts`，也不向 Workflow 注入 RecordStore**；节点详情 `views/node-detail-reader.ts` 继续用它自己的读，与本路径无关。
4. **取这些 Run 的 Activity。** 把 RunRef 按每批不超过 200 个分开，逐批调 `readRunActivities`（`src/core/work-graph/views/activity-read-model.ts:1154`，一次 1–200 个 `RunRef`）读出 `RunActivityFactsV1`。**空集合直接返回空聚合**（不调 `readRunActivities`，它拒 0 个）；任一批失败原样返回失败，不折成空。这是唯一的追加读；不加记录、不加索引。
5. **算 Run 读数。** 三个纯函数：`runUsageOf`（累计 token）、`runGrowthOf`（增长量）、`lineReadingOf`（行数）。任一不完整就带 `complete:false`。
6. **加层。** 任务 = 它全部 Run 之和；阶段 = `stageId` 相同的任务之和；目标 = 全部 Run 之和。`stageId` 为空的 Goal 范围任务只进目标。未知向上一层传。
7. **对线。** 任务增长量对 Host 有效 `planLoopLimits` 的提醒线/2 倍线；任务行数对 `lineMultiplier × estimatedLines`；阶段对 `Σ estimatedLines` 的 `stageLineBudget` 或累计 `stageTokenBudget`。阶段线只提醒；任务的 growth/lines 2 倍线发系统轮并告诉人；任务不停。
8. **写进事实。** 系统轮的正文和“请知悉”用同一组读数；未知写“未知+原因”，不全写“至少/不全”，不写 0。偏差的请求号带 `kind` 和 `planRevision`，同一版同一任务每种 `kind` 最多一条。
### 13.2.2 三个读数怎么取
本节不重复公式：累计 token、上下文增长量、改动行数的定义和算法只在 10.2/10.4 写一处。这里只记读哪些现有读、按什么顺序读：
- 累计 token：`RunActivityFactsV1.usage.totals.inputTokens + outputTokens`；`usage.complete === false`/`usage.omitted > 0` 标不全（10.4（1））；上下文增长量：`runGrowthOf(usage.requests)`；第一次输入不计，只累加上涨 + 最后一次输出，`omitted > 0` 返回 `null`（10.4（2））；改动行数：`facts.changedLines.added + deleted`；只有成功的 `edit` 计入，`shell`/未知/被拒 → `complete:false`（10.4（3））；三者都从 Run 结束写下的 `RunActivity` 读，不新读库、不新算第二份。
### 13.2.3 未知怎么标

| 情况 | 读数 | 文字 | 过线 |
|---|---|---|---|
| `status:'unknown'`（`turn_not_found`/`kernel_unreadable` 等） | `null` | “未知：<reason>” | 不触发 |
| `usage.complete === false` | 已知累计值 | “至少 N，不全” | 不触发 |
| `usage.omitted > 0` | 增长量 `null`；累计只含保留的 256 条 | “不全（超出保留上限）” | 不触发 |
| 某次请求 `usageStatus:'unknown'` | 增长量跳过该段并标不全；累计跳过该请求 | “不全” | 不触发 |
| `changedLines.complete === false` | 已知 added/deleted | “至少 N 行/不全” | 行数 2 倍线不触发 |
| 任务没有 `estimatedLines` | — | “未预估” | 行数线不触发 |
| 阶段有任务没 `estimatedLines`，或阶段 token 不全 | 已知合计 | “至少 N/不全” | 阶段线不判超线，只显示 |
| 任务没有 `sizeClass` | 增长量照常累计 | “未分档” | 提醒线/2 倍线都不触发 |
### 13.2.4 和三条线怎么比
判据、阈值和动作只在 10.3/10.5 写一处；这里只列第 2 步读到线之后怎么用：
- 任务提醒线：增长量 ≥ Host 有效 `planLoopLimits.taskReminderTokens[sizeClass]` → 给参谋 `notify`，不开轮（10.3）；任务 2 倍线：`growth`（增长量 ≥ `taskTwoTimesTokens[sizeClass]`）和 `lines`（`added + deleted > lineMultiplier × estimatedLines`，严格大于）各发一条系统轮并告诉人；两条独立，同一 Run 同时命中就各发一次；任务不停；阶段线：`Σ estimatedLines > stageLineBudget` 或阶段累计 token `> stageTokenBudget` 只写“请知悉”/候选卡，不挡采用、不开轮；同一任务同一版已有 `stop`/`budget` 硬停因时，软线不再开轮，只写进“请知悉”；64 倍是换算/校准（0.6B ≈ 940 万增长量），不是第二个阈值；判定仍用各自单位（10.5）；所有判定在 Run 边界；Run 进行中只看 Run 上限。
### 13.2.5 落点

| 处 | 改什么 | 依据 |
|---|---|---|
| `src/contracts/run-activity.ts` | `RunActivityFactsV1` 加 `changedLines: { added; deleted; complete }`；`RUN_ACTIVITY_RULE_VERSION` 1 → 2；**新格式必写、必校验，不保留旧版本兼容**（发布前无旧数据，开发库和夹具按当前格式重建） | 10.4；D-6；PLS-27 |
| `src/contracts/line-delta.ts`（移动） | `lineDelta` 从 `src/app/attention-observer.ts:124` 原样挪到低层；`attention-observer.ts` 改为导入；单测跟着挪 | 10.2；D-18 |
| `src/core/agent-runtime/run-activity-tally.ts` | `tallyTurnActivity` 对成功的 `edit` 求和（复用挪过的 `lineDelta`） | 10.4 |
| `src/core/work-graph/persistence/run-activity-codecs.ts` | 校验新字段和版本 2；**不保留旧版本解码**，旧版本记录按损坏拒绝 | 同上；PLS-27 |
| `src/business/workflow/*` 的读数装配 | 用公开的 `executions.listExecutions` 分页到底取 Run，再以每批 ≤200 个 `RunRef` 调 `readRunActivities`；空集合返回空聚合，失败保持失败；不调 `readCanonicalTaskFacts`、不注入 Store | PLS-23；`ports.ts:112`/`:122`；`execution-read-contracts.ts:43`/`:101` |
| `src/core/work-graph/model/plan-loop-readings.ts`（新，纯） | `runUsageOf`/`runGrowthOf`/`lineReadingOf`/`stageReadingOf`/`lineOverrun`/`stageOverLine` | 10.4、10.5 |
| `src/contracts/plan-loop-limits.ts`（新） | `PlanLoopLimitsV1`、默认值、`GROWTH_UNIT_TOKENS`、`growthUnitsOf` | 10.3、10.5 |
| 6.1 的“请知悉”/卡 | 阶段线文字（只提醒）；growth/lines 的系统轮（PL-2） | 10.3、10.5 |
| E3（之后） | `activity/runs` 和 `graph/detail` 显示三个读数 | 设计 `plan-loop-design.md:489` |

第 2 步本身不依赖 PL-1；PL-2 的 `growth`/`lines` 轮依赖它（设计 `plan-loop-design.md:474`）。
## 15. 业务流程测试
本节只写测试规格：**设计行 53 条（PL-01…PL-53）+ 规格新增 13 条（A-01/A-02/A-03/A-05/A-06/A-09/A-10、G-01/G-02/G-05/G-08/G-12/G-13）**。其中 v3 第 9 节 1–21 共 21 条，v4 第 15 节 22–53 共 32 条；A/G 是第二稿按裁定补的，G-13 是第三稿补的 Host 设置测试。每条给入口、前置、步骤、观察量、一个具名变异、期望来源；不改代码、不写测试代码、不跑测试、不写行数预算。

行号按 合并树 `5a1ec32`的文件内容核对；设计引用写 v3/v4 的节号或行号。v3 第 19 条的原文写“累计和增长量都对”，但 tree 的 `RUN_USAGE_REQUESTS_CAP = 256`（`src/contracts/run-activity.ts:18`）把第 257 次起的请求放进 `usage.omitted`，所以本行落成“256 内精确、超出标不全、不误报”，差异见 `report.md`。
### 15.1 口径
只走公开入口（`core-routes.ts` 冻结表、`world.platform` 公开方法），不构造状态机节点、不读 store、不断言私有字段；期望值来自设计或手算，不从被测系统读回；每行一个具名变异，指到一处生产判断；测试名以行号开头；冷启动/重启/绑定晚于启动/Run 在跑只在设计明确写出时进步骤。

### 15.2 公开入口和夹具
**入口分组（准确名字，行号按 `core-routes.ts`）。** G1 目标循环/Workflow：`workflow/advance`→`advanceWork`、`driver-start/read/stop`、`handleIntervention`、`consumeIdle`、`main/read`（525/527-529/631）；G2 启动/重启：`createLocalWorkbenchHost`、`runStartupReconcile`、`createGoalWaitRebuild`、`host/reconcile-report`（454/554）；G3 控制：`controls/submit`/`read`、`goals/control`、`tasks/requeue`（463/464/546/543）；G4 计划/卡：`plans/proposal`/`propose`/`apply`/`request-candidate`、`goals/read`、`tasks/query`、`decisions/queue`/`card`/`candidate-card`/`answer`（485/483/484/592/473/486/594-596；`decisions/candidate-card` 是 PLT-11 的冻结入口，复合结果从它读，`decisions/card` 原样保留）；G5 消息：`messages/send`/`outbox`/`inbox`/`read`/`body`（499-503）；G6 用量：`activity/runs`、`executions/read`/`list`（602/530/534）；G7 导出/工作区：`plans/apply`/`decisions/queue` 触发、`workspaces/registration`（529）。

**夹具配方（只列公开步骤；优先用现有 helper）：**

| 配方 | 怎么造 | 现成可复用 |
|---|---|---|
| F0 基础目标世界 | `openS6AHostWorld({ backend:'memory' })`；`governS6B`；`s6aCardsWorkspace`；`goals/create`；`plans/propose` + `plans/apply` 采用“骨架 + 第一段 + 必需 `plan_only` 占位”；`createS6BLine` 建参谋线和秘书线 | `S6A-host-fixture.ts:438`、`S6B1-fixture.ts:62`、`:71`、`:88`、`S6A-cards-fixture.ts:178` |
| F1 候选世界 | F0 + 参谋线跑一轮规划 Query；`sendS7A2PersonMessage`；`scripted.script(adviser,[{kind:'text', text: planAnswer}])`；`awaitProposal` | `S7A2-fixture.ts:120`、`IV-host-fixture.ts:155`、`S7B-V-fixture.ts:89`、`:115`、`S6A-host-fixture.ts:621` |
| F2 审阅世界 | F1 + 审阅线（`reviewer` 的 `sessions/create`/`extraBindings`）；审阅答案走 `submit_plan_review`（C 的 6.3） | `S6A-request-fixture.ts:311`；`role-profiles.ts` 的 `platformRoleProfile` |
| F3 偏差世界 | F0 + 让任务到返工上限/`no_new_basis`/`budget_exhausted`，或 Run 结束在 `yielded` | `C8-auto-rework-cap.test.ts`、`C8-budget.test.ts`、`S7B-V-fixture.ts` |
| F4 N 门世界 | F0 + 两个同模块会重叠任务；一条 Run 在跑；规划轮先写模块注记；第二个任务派工 | `S7C-L1-overlap.test.ts`、`S7C1-member-fixture.ts:261`、`S6A-commit-barrier.ts:133` |
| F5 导出世界 | F0 + Host 设置指定工作区外的任务书目录；采用和转卡各一次；失败用真实 `ENOTDIR`/`EACCES`，不 mock；**隔离变体：工作区根 = `<settingsDirectory>/taskbooks`（或导出根落在任一工作区根内），真实磁盘、不 mock** | `host.ts:454` |
| F6 重启世界 | F2 + SQLite；审阅 Query 已开、未答时 `world.crash()`；同目录起新 Host；`resumeOnStartup` 默认 `ask` | `S6A-host-fixture.ts:381`、`S6B3-fixture.ts:902`、`:912` |
### 15.3 v3 第 9 节 1–21
**PL-01 人对闲置线干预，目标没有未完成任务可领** （v3 §9-1） 入口：`messages/send`（`core-routes.ts:499`）发人的消息给闲置参谋线；`workflow.handleIntervention`（`workflow.ts:3039`）；`queries/read`（`:517`）；`plans/proposal`（`:485`）；`messages/read`（`:502`）。
- 前置：F1；目标没有未完成的普通任务可领；参谋线闲置；人的消息是一条普通 `action_request`（不是系统轮）。
- 步骤：1）人发消息；2）Host `consumeIdle` 把它供给参谋线；3）`handleIntervention` 走规划分支；4）规划 Query 走到终态并写候选或被采用；5）读消息和候选。
- 观察量：`queries/read` 只有这一轮规划 Query；`plans/proposal` 的候选是 `accepted` 或 `candidate`（二选一，按自治档）；**人的普通消息没有执行者 wait，在候选/问题卡待决时 `response` 就已关联、不再被供给**；心跳再来一趟不新建第二轮。
- 具名变异：Host 仍按 `reason=candidate/questions` 单判不回复（不读发送者和执行者 wait）；本行会在“人的消息永远不结束/下一趟又开一轮”处红。
- 期望来源：v3 §9-1；v3 §5.3；5.2.4 的“消息一定结束”。
**PL-02 规划答案是 `needs_decision`；提案被拒绝** （v3 §9-2） 入口：`queries/read`（`:517`）；`decisions/queue`/`decisions/card`（`:594`、`:595`）；`messages/outbox`（`:501`）；`workflow.handleIntervention`。
- 前置：F1；三个变体：规划答案要人 decision；提案被现有校验拒绝（如 `dangling_task_ref`）；执行者 M 让出等回复时同一答案。人的普通原消息另作对照。
- 步骤：1）规划 Query 结束；2）Host 收尾；3）读问题卡/拒绝原因；4）再让心跳跑一趟；5）读这条线后面的请求；6）读人的原消息和执行者 M 的 `response`。
- 观察量：问题或原因在 `decisions/card`/`messages/outbox` 可见；同一 Query 不被心跳重开；这条线后面的请求能被消费，不被堵住；**问题卡出现时人的普通原消息已按原收尾结束（`response` 已关联），只有执行者 M 的 wait 仍 open；提案被拒时只回执行者 M**。
- 具名变异：把 `needs_decision` 收尾写成“保持 Query 打开、等下一次心跳”；本行会在“重复进入/堵住后面的请求”处红。
- 期望来源：v3 §9-2；v3 §5.3“按终态收尾”。
**PL-03 两阶段目标：第一阶段完成，第二阶段只有占位任务** （v3 §9-3，v4 §15 加审阅轮） 入口：`workflow/driver-start`（`:527`）；`workflow/advance`（`:525`）；审阅入口（`submit_plan_review`，C 的 6.3）；`plans/apply`（`:484`）；`main/read`（`:631`）。
- 前置：F0/F2；目标已采用骨架 + 第一段；第二段唯一活动必需 `plan_only` 占位带 `sizeClass`；第一段任务已 `satisfied`；审阅线存在；自动档。
- 步骤：1）第一段完成；2）阶段 gate 按覆盖工作先过；3）目标循环在共同收口登记等待并发 `refine:` 给参谋；4）参谋只输出第二段，平台 `mergeStageRefinement` 合并；5）目标循环发 `planreview:`；6）审阅回 `pass`；7）平台按现行规则采用；8）第二段开工；9）读“请知悉”。
- 观察量：第一段阶段 gate 先 `satisfied`，不被第二段占位挡住；参谋线恰有一条 `refine:`；审阅线恰有一条 `planreview:`；`plans/proposal` 最终 `accepted`；第二段有 Run；`main/read` 有采用和影响说明。
- 具名变异：删掉“审阅 `pass` 才自动采用”的判断，`planreview:` 未回就 `plans/apply`；本行会在“采用前没有审阅结论”处红。
- 期望来源：v3 §9-3；v3 §5.2（阶段 gate 按阶段验收）；v4 §15 第 3 条改动；v4 §6.3。
**PL-04 同上，「每步确认」** （v3 §9-4） 入口：`goals/settings/set`（`:582`）；`workflow/advance`（`:525`）；`decisions/card`/`decisions/candidate-card`（`:595`、`:596`）；`plans/apply`（`:484`）。
- 前置：F2；目标自治档 `every_step`；第二段细化的候选已 `pass`（确切 `decided pass`）、诊断无问题。
- 步骤：1）审阅 `pass`；2）目标循环不自动采用，转候选卡；3）人读卡；4）人用卡上的 proposal ref `plans/apply`。
- 观察量：`plans/proposal` 在审阅后仍 `candidate`；`decisions/candidate-card` 的 `exactReview` 是 `decided pass`，`decisions/card` 仍只返回裸卡；活动计划在人采用前不变；采用后只前进一版；人 `plans/apply` 采用后 `plan_adoption` 的 `summary` 是“已采用 · 计划 v<planRevision> · 改 … · 审阅 pass”（审阅按接受前 `revision - 1` 读），不写“人采用/自动采用”；采用前没有采用通知。
- 具名变异：把 `every_step` 的 `refine_future` 结果从 `needs_decision` 改成 `automatic`；本行会在“自动采用/没有卡”处红。
- 期望来源：v3 §9-4；v3 §5.6；v4 §6.1 的 `refine_future`；C-23/C-36。
**PL-05 参谋线还有未完成的 Work 时收到细化请求** （v3 §9-5） 入口：`messages/send`/Host 系统轮；`workflow.handleIntervention`（`workflow.ts:3039`）；`sessions/executions`（`:563`）；`queries/read`（`:517`）；`tasks/query`（`:486`）。
- 前置：F0；参谋线自己有一个未完成 Work W；目标发出 `refine:` 给这条线；参谋线可消费。
- 步骤：1）`refine:` 到参谋线；2）`handleIntervention` 按收件 duty `adviser` 进规划分支；3）W 不被领取；4）开规划 Query。
- 观察量：W 没有新 claim/Run；参谋线的 `latestWork` 没有被当成 `addressed`；`queries/read` 有规划 Query；没有“先去领 W”的分支。
- 具名变异：恢复 `addressed = message.taskRef ?? latestWork` 并进入领取块；本行会在“W 被领取/没有规划 Query”处红。
- 期望来源：v3 §9-5；v3 §5.4 的消费侧；5.2.4 的“不走 `latestWork` 回退”。
**PL-06 没有参谋，建线后** （v3 §9-6） 入口：`workflow/advance`（`:525`）；`decisions/queue`（`:594`）；`messages/inbox`/`outbox`（`:500`、`:501`）；`sessions/find`（`:490`）；`sessions/create`（建线后）。
- 前置：F0，但目标没有参谋线（也没有区域参谋）；存在活动的必需 `plan_only` 占位；秘书线存在。
- 步骤：1）目标循环要发 `refine:`，找不到参谋；2）出 `goal_cause` 卡，code `no_adviser`；3）不发秘书；4）人建参谋线；5）目标重读 gap，重新触发。
- 观察量：`decisions/queue` 的卡 `source.kind === 'goal_cause'` 且 code `no_adviser`（不是 `adviser_creation`）；秘书的 `messages/outbox` 没有这条系统轮；建线后同一版能再触发一次 `refine:`，不是永远停住。
- 具名变异：把无参谋的 fallback 改成发秘书；本行会在“秘书收到系统轮”处红。
- 期望来源：v3 §9-6；v3 §5.4 第 5 步；M-4/裁定 B-D6；103-1。
**PL-07 重启、重复唤醒** （v3 §9-7） 入口：`createLocalWorkbenchHost`（`host.ts:454`）；`runStartupReconcile`（`startup-reconcile.ts:320`）；`workflow/driver-start`（`:527`）；`messages/outbox`（`:501`）；`host/reconcile-report`（`:554`）。
- 前置：F6（SQLite）；`refine:` 已发出、还没回；或同一 gap 被连续唤醒两趟；`resumeOnStartup` 默认 `ask`。
- 步骤：1）同一 gap 连跑两趟；2）读消息数；3）Host 重启，仍有未解除的 `GoalInterruption`；4）人不启动，再跑心跳；5）人 `workflow/driver-start` 后重读。
- 观察量：同一版恰有一条 `refine:`、一对 `intervention_planning` Query；未解除中断时不开新轮、不自动采用；人启动后同一请求号不重发（回执已提交则跳过）。
- 具名变异：把 `createGoalWaitRebuild` 的 held 判断删掉，让中断中的目标直接登记唤醒；本行会在“人没启动就开轮”处红。
- 期望来源：v3 §9-7；v3 §5.4 重启；决定 97-9；5.2.2 的“同一版一次”。
**PL-08 登记等待前已发生计划提交** （v3 §9-8） 入口：`workflow/advance`（`:525`）；`workflow/driver-read`（`:528`）；`plans/propose`/`plans/apply`（`:483`、`:484`）；`messages/send`。
- 前置：F0；目标循环用读前游标登记等待；在“读”和“登记”之间先提交一次 `PlanProposal` 或计划变更；登记后 drain 一次。
- 步骤：1）目标循环读游标；2）提交候选/计划；3）登记等待；4）drain；5）读驱动是否被叫醒。
- 观察量：登记存在；登记前的提交被 drain 处理，不丢唤醒；目标下一趟读到候选/新计划；不会因为“登记晚于提交”永远等。
- 具名变异：把登记改成“读完之后再取游标”（或删掉 drain）；本行会在“提交早于登记时不醒”处红。
- 期望来源：v3 §9-8；v3 §5.4 的动作顺序第 1 步；`goal-wait-wakes.ts:86` 的 `register`。
**PL-09 提案删除必需义务** （v3 §9-9） 入口：`plans/propose`（`:483`）；`plans/proposal`（`:485`）；`plans/apply`（`:484`）；`decisions/card`（`:595`）；`tasks/query`（`:486`）。
- 前置：F1；候选把一条必需义务删掉，或改变有执行痕迹的定义；诊断可先存成带诊断的候选。
- 步骤：1）候选写入；2）读候选状态和诊断；3）目标循环尝试自动采用；4）读拒绝；5）人读卡。
- 观察量：候选可以是 `candidate` 且带诊断；`plans/apply` 回拒绝（现有 `unsupported_execution_change`/`dangling_task_ref` 一类），活动计划不变；卡上有拒绝原因；人也不能绕过。
- 具名变异：让 `applyPlanChange` 接受删除必需义务的候选；本行会在“采用成功/活动计划变了”处红。
- 期望来源：v3 §9-9；v3 §5.6 的非法提案；`plan-validation.ts:501`、`plan-service.ts:3024`。
**PL-10 阶段合计超线** （v3 §9-10，v4 §15 改成只提醒） 入口：`plans/propose`/`plans/apply`（`:483`、`:484`）；`workflow/advance`（`:525`）；`main/read`（`:631`）；`decisions/card`（`:595`）。
- 前置：F1/F2；阶段 `Σ estimatedLines > 2_000`，或阶段累计 token `> 0.6B`；候选其他方面合法、审阅 `pass`、自动档。
- 步骤：1）阶段读数超线；2）目标循环采用/转卡；3）读“请知悉”/卡；4）读活动计划。
- 观察量：超线数字写进“请知悉”/卡，有“不全/未知”时写明；阶段线**不挡采用**——自动档仍 `accepted`，或按原规则转卡；没有因为阶段线开系统轮/停任务。
- 具名变异：让阶段超线把自动采用改成“必须人采用”；本行会在“采用被挡/多出一张卡”处红。
- 期望来源：v3 §9-10；v4 §15 第 10 条改动；v4 §10 阶段线“只提醒，可配置”；10.3。
**PL-11 任务过提醒线、过 2 倍线** （v3 §9-11，v4 §15 改成 2 倍线开参谋轮） 入口：`activity/runs`（`:602`）；`messages/outbox`（`:501`）；`workflow.handleIntervention`（`workflow.ts:3039`）；`main/read`（`:631`）；`workflow/advance`（`:525`）。
- 前置：F0；任务 A 的 `sizeClass: 'small'`（提醒线 1M，2 倍线 2M）；同目标 B 可继续；A 的 Run 正常结束，增长量先 1.2M、后 2.1M。
- 步骤：1）1.2M 时 Run 结束；2）读参谋的 `notify`；3）2.1M 时 Run 结束；4）读 `deviation:…:growth:…` 和人通知；5）读 A/B 状态。
- 观察量：1.2M 时参谋只收到一条 `notify`，没有模型轮；2.1M 时参谋收到一条 `growth` 系统轮并开轮，人收到“请知悉”；`deviation:…:growth:…` 的发送 actor 是 `host:plan-round`（不是 `workflow:auto-rework`），消费出的 Query `answerShape='plan_round'`、工具表有 `submit_plan_round`，目标循环按同一确定性 Query 读回；同一任务同一版提醒线只一次、2 倍线只一次；A 不停、B 继续。
- 具名变异：偏差用 `automationContext` 发（发送者成 `workflow:auto-rework`）；本行在“消费 Query 形状/工具表/读回对不上”处红。
- 期望来源：v3 §9-11；v3 §4.3；v4 §15 第 11 条改动；v4 §10 的 2 倍线；5.2.5/N7/PLT-05。
**PL-12 用量读不到；shell 改文件** （v3 §9-12） 入口：`activity/runs`（`:602`）；`main/read`（`:631`）；`workflow/advance`（`:525`）。
- 前置：F0；一个 Run 的某次请求 `usageStatus:'unknown'`；另一个 Run 用 `shell` 改了文件；任务有 `sizeClass`、`estimatedLines`。
- 步骤：1）Run 结束；2）读 `activity/runs`；3）读“请知悉”/偏差文字；4）看是否触发过线。
- 观察量：累计 token 标“不全”或“至少 N”；增长量标“不全”/未知；行数 `complete:false` 并写“至少 N 行/不全”；三个读数都不写 0；不因为不全触发提醒线/2 倍线。
- 具名变异：把 unknown 的用量按 0 累加、并把 `complete` 置 true；本行会在“显示 0/误触发”处红。
- 期望来源：v3 §9-12；v3 §4.2 的“读不到写未知”；10.4、13.2.3。
**PL-13 一个 Run 超过上限** （v3 §9-13） 入口：`workflow/advance`（`:525`）；`executions/read`（`:530`）；`tasks/query`（`:486`）；`tasks/requeue`（`:543`）；`activity/runs`（`:602`）。
- 前置：F0；任务 A 的 Run 累计 token 到 `budget.tokenBudget`；同目标 B 可继续；A 是必需任务。
- 步骤：1）A 的下一次请求被 Runtime 预算拒绝；2）Run 结束；3）读 A 的停因；4）人用 `tasks/requeue` 给更大预算；5）读 B。
- 观察量：A 记 `budget_exhausted`（`task-failure.ts:956`），不是任务级硬刹车；人加预算后 A 能继续；B 不受影响；偏差系统轮按 7.1 发 `budget`（若启用）。
- 具名变异：把 Run 预算拒绝改成“整个目标停住”；本行会在“B 也停”处红。
- 期望来源：v3 §9-13；v4 §10 的 Run 上限；决定 62；`model-budget.ts:125`-`:147`。
**PL-14 阶段完成** （v3 §9-14） 入口：`workflow/advance`（`:525`）；`main/read`（`:631`）的 notices；`decisions/queue`（`:594`）的 notices；`plans/proposal`（`:485`）；`goals/read`（`:473`）。
- 前置：F0；一个阶段的必需任务和阶段 gate 都满足；该 stage gate 已有已终结的验证轮；下一阶段存在占位；目标 active。
- 步骤：1）阶段归约完成、gate 验证轮终结；2）目标循环继续；3）从 `main/read`/`decisions/queue` 读 notices；4）读下一阶段是否被挡；5）同版再读一次；6）另做 gate 轮读失败变体。
- 观察量：notices 里出一条 `plan_notice` 的 `stage-end:<planId>:<planRevision>:<stageId>`，写 token、增长量、行数（未知/不全写明）、完成任务、返工次数、下一阶段预估档位；`position` 来自 stage gate 已终结验证轮的 `since`；同版再读/重启不追加；gate 轮读失败时 `unavailable`，不折成空；不挡下一阶段细化/开工；没有额外卡或停因。
- 具名变异：把阶段结束通知做成“必须人确认才继续”的卡；本行会在“下一阶段被挡”处红。
- 期望来源：v3 §9-14；v3 §5.8；6.4 的“请知悉”；C-35/PLT-16。
**PL-15 单阶段小目标** （v3 §9-15） 入口：`workflow/driver-start`（`:527`）；`plans/apply`（`:484`）；`workflow/advance`（`:525`）；`executions/list`（`:534`）。
- 前置：F0；目标只有一个阶段，任务写全；没有后续 `plan_only` 占位；自动档。
- 步骤：1）人采用完整计划；2）目标循环派工；3）任务完成；4）目标完成归约。
- 观察量：行为与今天相同：不出现 `refine:`；不因“没有骨架”多出等待；任务/目标按现有规则完成；阶段线只作为提示（若超）。
- 具名变异：把“没有 plan_only 也要发 refine”写进目标循环；本行会在“多出一条 refine/目标被挡”处红。
- 期望来源：v3 §9-15；v3 §4.1“小目标不用分”；v3 §5.1。
**PL-16 占位任务和 L46 被挡、和别的等待同时存在** （v3 §9-16） 入口：`workflow/advance`（`:525`）；`workflow/driver-read`（`:528`）；`tasks/query`（`:486`）；`decisions/queue`（`:594`）；`messages/outbox`（`:501`）。
- 前置：F0；目标同时有：活动的必需 `plan_only` 占位、L46 的卡/等待闭包、另一条普通等待；没有可推进步骤。
- 步骤：1）Workflow 走到共同收口；2）附加 `refinement`；3）目标循环登记等待并 drain；4）发 `refine:`；5）读等待依据。
- 观察量：细化照常触发；`workflow/driver-read` 的等待依据同时含 `plan_only:<stageId>`、L46 的 `l46_blocked:` 和别的等待原因；唤醒依据合并，不丢其中一支；没有新增等待分支/记录。
- 具名变异：把 `attachRefinement` 只加在 `gap` 分支，L46/收集等待分支不附加；本行会在“L46 同时存在时不触发”处红。
- 期望来源：v3 §9-16；v3 §5.4“共同收口 `result = collected ?? gap`”；5.1.4。
**PL-17 有任务在跑时存在占位任务** （v3 §9-17） 入口：`workflow/advance`（`:525`）；`executions/read`（`:530`）；`messages/outbox`（`:501`）；`main/read`（`:631`）。
- 前置：F0；第一段最后一个任务正在跑（Run `entered`，模型请求按住）；下一段唯一占位；Workflow 这一趟没有可推进步骤。
- 步骤：1）按住 A 的模型请求；2）目标循环读到共同收口；3）发 `refine:`；4）参谋细化；5）A 结束；6）读 A 和细化结果。
- 观察量：`refine:` 在 A 还在跑时就发出；A 的 Run 不受影响（没有取消/暂停/改定义）；细化候选写入；采用时按当时版本判（动到在跑任务是 `busy`）。
- 具名变异：在触发条件加“没有在跑的 Run”；本行会在“A 在跑时不细化”处红。
- 期望来源：v3 §9-17；v3 §5.4“有任务在跑时也可能触发”；5.5.4。
**PL-18 延期的占位任务；没有阶段的占位任务** （v3 §9-18） 入口：`plans/propose`/`plans/apply`（`:483`、`:484`）；`workflow/advance`（`:525`）；`messages/outbox`（`:501`）；`tasks/query`（`:486`）。
- 前置：F0；两个变体：(a) 唯一占位 `disposition:'deferred'`；(b) 占位没有 `stageId`（目标级）。
- 步骤：(a) 把占位设为 deferred，跑目标循环；(b) 恢复/新建无阶段占位，跑目标循环，读请求号。
- 观察量：(a) deferred 不触发 `refine:`，目标按现有 `required_task_deferred:` 等待；(b) 无阶段占位的等待标记是 `plan_only_task:<taskId>`，请求号是 `refine:<goalId>:<taskId>:<planRevision>`，不是空段号；细化能定位到该任务。
- 具名变异：把 `deferred` 也算进触发条件；或让无阶段占位必须带 `stageId` 才发；本行会在“deferred 误触发/无阶段不发”处红。
- 期望来源：v3 §9-18；v3 §5.4“延期不算”；5.1.4。
**PL-19 一次 Run 超过 256 次请求** （v3 §9-19） 入口：`activity/runs`（`:602`）；`main/read`（`:631`）；`workflow/advance`（`:525`）。
- 前置：F0；脚本模型让一个 Run 发 256 次和 257 次请求两个变体，前 256 次都报 usage。
- 步骤：1）256 次请求的 Run 结束，读累计/增长量；2）257 次请求的 Run 结束，读累计/增长量/`usage.omitted`；3）看是否触发过线。
- 观察量：256 次时累计 = 逐请求 input+output 之和、增长量 = 相邻上涨 + 最后输出，数值精确；257 次时 `omitted > 0`，累计只含保留的 256 条并标“不全”，增长量 `null`/标“不全”，不误触发提醒线/2 倍线。
- 具名变异：把 `RUN_USAGE_REQUESTS_CAP` 从 256 改大却仍按“只看保留请求”算完整；本行会在“257 次仍标精确/误触发”处红。
- 期望来源：v3 §9-19；`src/contracts/run-activity.ts:18`；10.4、13.2.3。
**PL-20 同一 Session 连做两个任务；Run 内发生裁剪；只有一次请求** （v3 §9-20） 入口：`activity/runs`（`:602`）；`workflow/advance`（`:525`）；`executions/read`（`:530`）。
- 前置：F0；同一 Session 先做任务 A 再做 B；B 的 Run 输入序列有下降；另有一个 Run 只有一次请求。
- 步骤：1）A 结束；2）B 在同一个 Session 开 Run；3）读 B 的增长量；4）读单请求 Run 的增长量。
- 观察量：B 的第一次输入不计，不含 A 的历史；输入下降记 0，不倒扣；单请求 Run 的增长量等于它的输出；累计 token 仍含 B 的全部输入/输出。
- 具名变异：把 B 的第一次输入也计入增长量（或把下降当负数扣）；本行会在“B 带上 A 的历史/下降被扣”处红。
- 期望来源：v3 §9-20；v3 §4.2“第一次输入不计、下降不计”；10.4。
**PL-21 计划已有几百个任务时细化；一对一和一对多** （v3 §9-21） 入口：`plans/propose`（`:483`）；`plans/proposal`（`:485`）；`plans/apply`（`:484`）；`workflow/advance`（`:525`）。
- 前置：F1；当前计划有几百个任务；两个变体：一个占位细化成一个任务；一个占位细化成多个任务；模型答案只给这一段。
- 步骤：1）参谋答案只含这一段；2）`parseInitialPlanningResponseV2` 解析；3）`mergeStageRefinement` 合并到 base；4）`plans/propose`；5）读草稿/候选；6）采用后读任务。
- 观察量：模型答案里没有别的段；base 其他段的任务/占位/依赖还在；1:1 时沿用原 taskId 并改成 `request_execution`；1:many 时原任务 `superseded`、新增实际任务；已有 gate/义务语义不变；合并后的草稿过现有 `validatePlanDraft`，候选可写入。**来源字段按 base 断言**：合并结果的 `origin`/`reviewAdmissionProtocol` 来自 base；segment 新生成的 `origin` 不出现；planfix 的 base 是被审候选的 draft 时，结果不带候选自己的 `origin`（候选来源不是这条计划版本的采用来源）。
- 具名变异：让合并按“整段替换”而不是按 taskId/占位规则合并；本行会在“别的段占位丢了/原任务 id 没沿用”处红。
- 期望来源：v3 §9-21；v3 §5.5 的合并规则；5.1.2。
### 15.4 v4 第 15 节 22–53
**PL-22 两段目标，第二段细化，审阅 `pass`，自动档** （v4 §15-22） 入口：`workflow/driver-start`（`:527`）；`workflow/advance`（`:525`）；`planreview:`/`submit_plan_review`；`plans/apply`（`:484`）；`main/read`（`:631`）；`decisions/candidate-card`（`:596`）。
- 前置：F0/F2；目标已采用骨架 + 第一段；第二段唯一活动必需 `plan_only` 占位；审阅线存在；自动档；第一段任务已 `satisfied`。
- 步骤：1）冷启动后驱动目标；2）第一段跑完；3）目标循环发 `refine:`；4）参谋写候选；5）目标循环发 `planreview:`；6）审阅回 `pass`；7）平台采用；8）第二段开工；9）读“请知悉”。
- 观察量：候选 `accepted`；`goals/read` 的 `activePlanRevision` 是候选那版；第二段有新 Run；`main/read` 有采用、差异、影响任务；恰一条 `refine:`、一条 `planreview:`；`plan_adoption` 的 `summary` 含“已采用”和“审阅 pass”，且该版 `exactReview` 必须是 `decided pass`（采用后按 accepted 候选的 `revision - 1` 读接受前版本）；审阅无效/读不到时 `summary` 不写 pass。
- 具名变异：删掉“审阅 `pass` 才自动采用”，未回就 `plans/apply`；本行在“采用前没有审阅结论”处红。
- 期望来源：v4 §15-22；v4 §6.1；v3 §5.1。
**PL-23 审阅 `fix` 两轮后 `pass`（含问人续轮、终态变体）** （v4 §15-23） 入口：目标循环发 `planreview:`/`planfix:`；`queries/read`（`:517`）；`plans/proposal`（`:485`）；`plans/apply`（`:484`）；`messages/outbox`（`:501`）；`decisions/queue`/`card`（`:594`、`:595`）。
- 前置：F2；候选 `P1@1`；审阅先回两次 `{verdict:'fix'}`、第三次 `pass`；每次返修写新的独立候选（新 `planId`/`proposalId`，`basedOn` 沿用同一条正式计划，不写 `replaces`），新候选的 `proposalRevision` 都是 1；自动档；返修上限 3 未到。另有四个单独世界：返修已发、新候选还没写；`planfix:` 终态无后继候选；`planfix:` 先问人、答完卡后续轮还在跑；`P2` 的 fix 轮先问人、答完卡再 `planresume:` 续出 `P3`（不混入主世界计数）。
- 步骤：1）`P1@1` 审阅 `fix`；2）发 `systemRoundRequestId({kind:'planfix',proposalId:P1,proposalRevision:1})`；3）新候选未写时再推一趟：不发第二条同号 `planfix:`，这一趟仍能 `perform` 别的任务；4）参谋写 `P2@1`；5）`P2@1` 审阅 `fix` 并发 `planfix:<P2>:1`；6）参谋写 `P3@1`；7）`P3@1` 审阅 `pass`；8）采用 `P3`；9）问人续轮世界：`P2` 轮答案先 `questions`→卡答完→登记后发 `planresume:`→续出 `P3`；`planresume:` 仍在跑时再推一趟，`planFixRead` 必须读 `waiting`（不能因原 `planfix:` Query 已终态读成 `terminal`）；10）终态世界：`planfix:` 终态无后继候选→`fix_invalid` 卡、不重发；另做 `planfix:` 先 `questions`、卡答完后续轮仍在跑的变体，三态仍是 `waiting`。
- 观察量：主世界恰两条 `planfix:`；两条的 `proposalId` 分别来自 `P1`、`P2`，`proposalRevision` 都是 1（`systemRoundRequestId` 的正本形状，不是手工拼串）；三条 `planreview:` 分别对 `P1@1`/`P2@1`/`P3@1`；新候选未写那一趟没有第二条同号 `planfix:` 且仍能推进别的任务；最终 accepted 的候选 `proposalRevision` 不是 3；采用后活动计划只前进一版（`P3` 接受后为 @2，不是 `P3@3`）；采用通知的审阅按 `P3` 的接受前 `revision - 1`（即 `planreview:<P3>:1`）读，不按接受后的 @2 读；没有第 3 条 `planfix:`。问人续轮世界：续轮 base 是待修候选 `P2`（不是活动计划），`P3` 的 `basedOn` 等于 `P2` 的 `basedOn`，旧候选 `P2` 被 6.3.1 来源链排除，`P3` 仍要自己的 `planreview:<P3>:1`；续轮 Query 的 `repliesToMessageRef` 是最初执行者 M（不是中间 R 的 `followupOf`）；`planFixRead` 沿 `planresume:<goalId>:<planfix QueryJobId>` 读续轮；续轮在跑 → `waiting`，续轮终态无候选 → `terminal`，都不以原 `planfix:` Query 的结束事实判；续轮在跑时没有第二条 `planfix:`、没有 `fix_invalid` 卡。终态世界：`fix_invalid` 卡出现、没有重发同一条 `planfix:`。
- 具名变异：让 `planFixRead` 只看原 `planfix:` Query 的结束、不沿 `planresume:` 续轮；本行在“续轮在跑却读成 `terminal`/出 `fix_invalid` 卡”处红（另有“已发后重发/挤掉别的任务”）。
- 期望来源：v4 §15-23；v4 §6.1；6.3.1/6.3.4；C-33/C-34；`plan-machine.ts:141`、`:1579`。
**PL-24 审阅 `fix` 到上限** （v4 §15-24） 入口：`planreview:`/`planfix:`；`decisions/queue`/`card`/`candidate-card`（`:594`–`:596`）；`messages/outbox`（`:501`）。
- 前置：F2；候选 `P1@1`；预置同一 `basedOn` 上连续 4 次 `fix`；上限 3；自动档；另做一个“第 4 次 `fix` 前已有在飞的 `planfix:`”变体。
- 步骤：1）`P1@1` `fix`；2）前三次 `planfix:` 各写一个新的 `@1` 独立候选（`P2@1`、`P3@1`、`P4@1`），每次审阅都 `fix`；3）第四次读到 `fix` 时 `completedFixes === 3`，不再发第 4 条，转候选卡；4）人读卡；5）变体：第 4 次 `fix` 前已有在飞的 `planfix:`，也先转 `fix_cap`。
- 观察量：恰 3 条 `planfix:`、恰 4 条 `planreview:`（`P1@1`…`P4@1`，各一条）；候选卡从 `decisions/candidate-card` 读，`card` 和 `exactReview` 都在、findings 是最后一轮 `P4@1` 的意见；变体里第 4 次 `fix` 仍不发出、先转 `fix_cap`；活动计划不变；没有自动采用；没有第 4 条 `planfix:`。
- 具名变异：把返修上限从 3 改成 4；本行在“第 4 条发出/没有卡”处红。
- 期望来源：v4 §15-24；v4 §6.1 的返修上限；6.3.4 的 `completedFixes`；C-23/C-34。
**PL-25 没有审阅线** （v4 §15-25） 入口：`workflow/advance`（`:525`）；`plans/proposal`（`:485`）；`decisions/queue`/`card`/`candidate-card`（`:594`–`:596`）；`messages/outbox`（`:501`）。
- 前置：F1，但不建审阅线（`extraBindings` 无 reviewer）；候选已写入、诊断无问题、自动档。
- 步骤：1）参谋写候选；2）目标循环读到没有审阅线；3）不发 `planreview:`，转候选卡；4）人从 `decisions/candidate-card` 读卡。
- 观察量：参谋线收件箱没有 `planreview:`；候选卡经 `decisions/candidate-card` 可读，`card`/`diagnosis`/`exactReview`（这里“尚未审阅”）/`exportRead` 四样都在，子读失败各自写明确一行、不折成空；活动计划不变；没有自动采用；卡上 proposal ref 仍可被人 `plans/apply`。
- 具名变异：让新路由 `decisions/candidate-card` 只返回 `DecisionCardV1`（复合结果读不到）；本行在“诊断/审阅/导出四样缺失”处红。
- 期望来源：v4 §15-25；v4 §6.1；6.3；C-23/PLT-11。
**PL-26 「每步确认」** （v4 §15-26） 入口：`goals/settings/set`（`:582`）；`workflow/advance`（`:525`）；`decisions/card`/`candidate-card`（`:595`、`:596`）；`plans/apply`（`:484`）。
- 前置：F2；目标 `every_step`；候选诊断无问题；审阅 `pass`。
- 步骤：1）`pass`；2）不自动采用，转卡；3）人从 `decisions/candidate-card` 读卡；4）人 `plans/apply`。
- 观察量：审阅后仍 `candidate`；`decisions/candidate-card` 的 `exactReview` 是 `decided pass`；人采用前活动计划不变，采用后前进一版；人采用后 `plan_adoption` 的 `summary` 是“已采用 · 计划 v<planRevision> · 改 … · 审阅 pass”（因为 `exactReview` 确切是 `decided pass`；审阅按接受前 `revision - 1` 读），不写“人采用/自动采用”；采用前没有采用通知。
- 具名变异：把 `every_step` 的 `refine_future` 从 `needs_decision` 改成 `automatic`；本行在“自动采用/没有卡”处红。
- 期望来源：v4 §15-26；v4 §6.1；6.3；C-36。
**PL-27 候选义务写了 `reviewer` 或没有注册检查覆盖** （v4 §15-27） 入口：`plans/propose`（`:483`）；`plans/proposal`（`:485`）；`decisions/card`/`candidate-card`（`:595`、`:596`）；审阅 Query 的 `queries/read`/`messages/body`（`:517`、`:503`）。
- 前置：F2；候选带一个 `required` 义务，验证要求是 `reviewer` 类，或没有注册检查能覆盖；诊断命中 `uncovered`。
- 步骤：1）候选写入；2）目标循环算诊断；3）诊断随审阅输入发送；4）审阅者看到；5）不自动采用；6）转候选卡，卡上带诊断；7）人从 `decisions/candidate-card` 读四样。
- 观察量：卡和审阅请求都能看到“未覆盖/`reviewer` 不覆盖”；`plans/proposal` 不出现 `accepted`；没有“先采用、之后永远完不成”的路径。卡经 `decisions/candidate-card` 可读：`card`/诊断 finding、确切审阅结论、拒绝原因（`diagnosis`）与 `exportRead` 的导出路径/失败行都在，四样各自可读、读不到的各自写明确一行，不折成空。
- 具名变异：让诊断对 `reviewer`/未覆盖返回空；本行在“诊断没命中/仍自动采用”处红。
- 期望来源：v4 §15-27；v4 §6.2；第 9 片只影响采用后能否完成，不影响本行；C-23。
**PL-28 Work Run 里 `propose_future_plan` 提的候选** （v4 §15-28） 入口：Work Run 的工具 `propose_future_plan`（`src/core/agent-runtime/whiteboard-tools.ts` → `plans/propose` `:483`）；`workflow/advance`（`:525`）；审阅入口。
- 前置：F0/F2；一个已完成第一段的 Work Run；授权带 `propose_future_plan`；审阅线存在；自动档。
- 步骤：1）Work Run 用真实工具提交 v2 未来修订；2）回执 `committed`；3）目标循环读到这个 agent 候选；4）诊断、`planreview:`、`pass`、自动采用；5）第二段开工。
- 观察量：候选就是回执指向的那版（proposal ref/revision 对上）；`status` 从 `candidate` 到 `accepted`；审阅线一条 `planreview:`；第二段 Run 存在；`plan_adoption` 的 `summary` 含“已采用”和“审阅 pass”，审阅按采用前 `revision - 1` 读。
- 具名变异：目标循环只筛选带 `sourceMessageRef` 的候选，让工具提案永不进审阅；本行在“候选没被审阅/没被采用”处红。
- 期望来源：v4 §15-28；v4 §6.1。
**PL-29 人的请求槽里的候选** （v4 §15-29） 入口：`requests/submit`（`core-routes.ts:626`）→ 秘书`plans/propose`；`plans/request-candidate`（`:592`）；`plans/proposal`（`:485`）；`workflow/advance`（`:525`）。
- 前置：F0；人是请求提交者；秘书写了一份带 `requestRef` 的候选；目标循环同时看到一个普通 agent 候选。
- 步骤：1）人的请求产生候选；2）目标循环跑一轮；3）读两份候选的状态/活动计划。
- 观察量：请求槽候选仍 `candidate`，`plans/request-candidate` 读作 head；活动计划不变；目标循环没有 `plans/apply` 动它；只有普通 agent 候选走审阅/采用。
- 具名变异：把候选筛选改成“只要 `candidate` 就采用”；本行在“人的请求槽候选被自动采用”处红。
- 期望来源：v4 §15-29；v4 §6.1。
**PL-30 任务书含长 `instruction`，答案 100 KiB** （v4 §15-30） 入口：规划 Query 的 `queries/read`/答案提交（`:517`）；`plans/proposal`（`:485`）；`plans/apply`（`:484`）；Work Run 的真实模型请求（`S6A-host-fixture.ts:322` 的 `requests(session)`）。
- 前置：F2；规划轮答案中某任务 `assignment.instruction` 是 100 KiB 可搜索字符串（102,400 bytes）；规划轮上限 256 KiB；该任务被采用并开 Run；同一 100 KiB 候选另走一次 `planreview:`，保存的 `question` 只有请求语（≤64 KiB）。
- 步骤：1）提交 100 KiB 答案；2）观察器/持久校验接受；3）候选写入；4）审阅/采用；5）Work Run 开跑；6）读模型输入；7）同一候选发 `planreview:` 并准备；8）读保存的 `question` 和审阅模型输入。
- 观察量：候选 `instruction` 长度和 `Buffer.byteLength` 都是 102,400；模型输入含完整字符串（长度和片段哈希对上），不是 16 KiB 截断；`{{task}}` 只有 `instruction`，不并入阶段说明；审阅准备成功、模型输入含完整候选、保存的 `question` 仍 ≤64 KiB 且只有请求语，不因候选大返回 `invalid`。
- 具名变异：让准备阶段按 `question` 的 64 KiB 判候选槽（候选大就拒绝审阅轮）；本行在“100 KiB 候选被误拒/审阅输入缺候选”处红。
- 期望来源：v4 §15-30；5.3.5；N1；C-15/PLT-01。
**PL-31 已开跑的任务之后计划又改，它的 `definitionPlan` 不变** （v4 §15-31） 入口：`workflow/advance`（`:525`）；`plans/propose`/`plans/apply`（`:483`、`:484`）；`executions/read`（`:530`）。
- 前置：F0；任务 A 的 Run 已 `entered` 且在跑（模型请求按住）；提出并采用计划 v2，v2 只改 B/新增 C，不动 A 的执行定义。
- 步骤：1）开 A；2）按住 A 的请求；3）提出 v2 并采用；4）读 A 的 `executions/read`；5）读 C 的后续 Run。
- 观察量：A 的 `run.claim.planRef`/`plan.ref` 仍是 v1（`definitionPlan`）；A 的 `instruction` 不随 v2 改；C 用 v2；若 v2 改 A 的执行定义，`plans/apply` 应拒绝。
- 具名变异：让 `plans/apply` 重写已开跑 Run 的 `claim.planRef`；本行在“A 变成 v2”处红。
- 期望来源：v4 §15-31；5.3；v4 §9。
**PL-32 执行者发现前提错，上报并让出** （v4 §15-32） 入口：执行者真实工具 `send_session_message`（`communication-tools.ts:357`）→ `messages/send`（`:499`）；Host `consumeIdle`（`host.ts:1825`）；`workflow.handleIntervention`（`workflow.ts:3039`）；`queries/read`（`:517`）。
- 前置：F0；A 在跑，B 也可派/在跑；A 按技能发 `action_request` 给参谋并让出（Run `yielded`，原消息等待）；参谋线闲置。
- 步骤：1）A 发消息并让出；2）Host 消费，参谋开规划 Query；3）B 继续；4）A 的等待保留。
- 观察量：B 的 Run 不停；`queries/read` 有 A 这一轮；A 的 `messages/read` 仍等待；目标没有整体停。
- 具名变异：让任一任务让出时把整个目标设为停/等待所有任务；本行在“B 也停”处红。
- 期望来源：v4 §15-32；v4 §7.1；v4 §7.2。
**PL-33 参谋答“不用改计划”** （v4 §15-33） 入口：`workflow.handleIntervention`（`workflow.ts:3039`）；`messages/outbox`/`read`/`body`（`:501`、`:502`、`:503`）；`executions/read`（`:530`）。
- 前置：F0；A 让出等回复；参谋 Query 答案是“不改计划，照原样继续”。
- 步骤：1）参谋回答；2）Host/邮箱把回答关联到 A 的原消息；3）A 的等待收到回复；4）A 在新 Run 继续；5）读 Run。
- 观察量：`messages/outbox` 有对原消息的回复，回复身份精确对上 A 的原消息；A 出现新 Run；活动计划不变；没有候选。
- 具名变异：把回复绑到参谋 Query 自己的消息/最新消息；本行在“原消息没有回复/执行者不被唤醒”处红。
- 期望来源：v4 §15-33；v4 §7.3；5.2.4 的关联。
**PL-34 参谋答改计划，替代执行者在等的任务** （v4 §15-34） 入口：执行者 `send_session_message`/让出；`workflow.handleIntervention`；`controls/submit`（`:463`）；`plans/propose`/`plans/apply`（`:483`、`:484`）；`messages/outbox`（`:501`）；`main/read`（`:631`）。
- 前置：F0；A 让出等回复；参谋候选由 `submit_plan_round` 表单构造，显式带任务上的 `replacedByTaskId`、plan 顶层的 `inputRequirements`、根上的 `reason{text,affectedTaskIds:['A']}`；诊断无问题、审阅 `pass`、自动档；等待来源就是这条消息。
- 步骤：1）参谋用 `submit_plan_round({answerKind:'plan',summary,plan,reason})` 提交替代候选；2）读候选，断言 `replacedByTaskId`/`inputRequirements`/`reason.affectedTaskIds` 原样进候选；3）审阅 `pass`；4）目标循环确认候选替代的正是 A 的等待来源；5）平台 `controls/submit` 取消 A 让出的 Run；6）`plans/apply` 采用；7）回复 A 原消息；8）读“请知悉”和任务图。
- 观察量：`replacedByTaskId`、`inputRequirements`、`reason.affectedTaskIds` 三项原样可读；缺 `affectedTaskIds` 时按 `plan-machine.ts:695` 原样拒绝（平台不替模型补语义）；A 的让出 Run 控制状态 `cancelled`；候选 `accepted`；A 原消息收到回复；影响清单含 A/被替代任务；原任务 A 仍在计划里，替代任务新增；没有“先采用后取消”的 `busy`。取消/采用失败只出现 `revision_conflict`/`source_stale`/`busy`/`forbidden`/`invalid`/`unavailable`/`not_found`，**不出现不存在的 `stale`**；职责读的 `not_found`/`not_ready` 经 `asRejection` 成为 `rejected`，不把 `ReadResult` 原样当干预结果。
- 具名变异：删掉采用前的平台取消（或放到采用之后）；本行在“采用回 `busy`/没有取消”处红。
- 期望来源：v4 §15-34；v4 §7.3.1；D14；5.2.7(3)、6.7.1 的 `asRejection`。
**PL-35 参谋答问人** （v4 §15-35） 入口：`workflow.handleIntervention`；`decisions/queue`/`card`/`answer`（`:594`–`:596`）；`workflow/advance`（`:525`）；`executions/list`（`:534`）。
- 前置：F0；A 让出等回复；参谋答案是“问人”；A 的等待保留；B 可继续；另加一支人的普通消息发给闲置参谋线（不是执行者 M，没有执行者 wait）。
- 步骤：1）参谋回答问人；2）Host 出问题卡；3）A 这一支继续等；4）B 继续；5）人读卡；6）人答复后 A 按新答案继续（本行可只到“卡出现、B 不停”）；7）另起一支：人发普通消息，参谋也答“问人”，读人的原消息和执行者 M 的 response。
- 观察量：`decisions/queue` 有 `planning_question` 卡；A 原消息未回复、Run 仍让出；B 的新 Run/完成不受影响；卡 pins/来源指向这一轮 Query；**人的普通消息在问题卡出现时就按原收尾结束（`response` 已关联、不再被供给），只有执行者 M 的 wait 保持 open、终态后才一条回复**。
- 具名变异：把“问人”当“回答”直接回复 A，或把目标整体停住；本行在“没有卡/这一支不该继续”处红。
- 期望来源：v4 §15-35；v4 §7.3；D10。
**PL-36 到返工上限；`no_new_basis`；`budget_exhausted`** （v4 §15-36） 入口：`workflow/advance`/Run 结束处；`workflow.handleIntervention`；`messages/outbox`（`:501`）；`tasks/query`（`:486`）；`tasks/requeue`（`:543`）；`executions/read`（`:530`）；`activity/runs`（`:602`）。
- 前置：F3；三个变体各一个目标世界：(a) 返工上限；(b) `no_new_basis`；(c) `budget_exhausted`；每个世界都有参谋线；同一任务先在同一 `kind` 上于 v1 触发一次停因；随后采用一版只动别的任务、不改这个任务执行定义的 v2；再用公开重排入口 `tasks/requeue`（现有入口，不新造）让同一任务在 v2 上**实际产生第二个 Run**（`budget` 变体用同一入口加预算后继续，把新预算仍设成会在该 Run 内耗尽的小值），这个 Run 再次形成**同 `kind`** 停因；参谋答“不改计划”或只给建议。
- 步骤：1）v1 上停因发生，发一次 `deviation:<goalId>:<taskId>:<kind>:<planRevision=v1>`；2）同一版重复推进/重放；3）采用 v2（不动该任务执行定义）；4）人走 `tasks/requeue`（`budget` 变体同入口加预算）让同一任务在 v2 上开第二个 Run，`executions/read` 读它的 `claim.planRef` 是 v2；5）第二个 Run 再次形成同 `kind` 停因，发第二条 `deviation:…:<planRevision=v2>`；6）参谋答“不改计划”；7）读任务状态和出箱。
- 观察量：每个变体在 v1 和 v2 上**各恰 1 条**对应 `deviation:`（共 2 条），两条身份的 `planRevision` 分别是 v1/v2、`messageId` 不同；第二条来自 v2 上那个**实际产生的新 Run** 的 `planRef`，不是“采用 v2 只动别的任务”本身产生的（只采用 v2 那一趟 0 条新请求）；同一版重复推进只回放原回执，不发第二条；重排确实开了新 Run（`executions/read`/`tasks/query` 有它，不是改写旧 Run）；`deviation:` 的发送 actor 是 `host:plan-round`，消费 Query 的 `answerShape='plan_round'`、工具表有 `submit_plan_round`，目标循环按同一确定性 Query 读回；参谋不改计划时停因仍在，任务仍停；人仍可走重排/重查/加预算；没有“回复即解除”。
- 具名变异：把 `deviation:` 请求号里的 `<planRevision>` 去掉；本行在“v2 上的第二个 Run 与 v1 同一请求、被当重放、只发一条”处红。
- 期望来源：v4 §15-36；v4 §7.1、7.1.1 的 D-4（`<planRevision>` 取触发 Run 的 `planRef`）；`src/contracts/dispatch.ts:251`；`mailbox-service.ts:2693`；5.2.2 的 `systemRoundRequestId`；`tasks/requeue` 是现有重排/加预算入口（PL-13、PL-50）。
**PL-37 改到在跑的任务：6C 前 `busy`** （v4 §15-37） 入口：`plans/propose`/`plans/apply`（`:483`、`:484`）；`executions/read`（`:530`）；`workflow/advance`（`:525`）。
- 前置：F0；A 的 Run 在跑且 `entered`；候选只走**处置替代**：把 A 设为 `disposition:'superseded'` 并给 `replacedByTaskId` 指向 A'，带 `reason.affectedTaskIds:['A']`，不改 A 的 `assignment`/执行定义；自动档。
- 步骤：1）A 在跑时尝试采用；2）`plans/apply` 回 `busy`；3）候选保留；4）A 的 Run 结束、任务尚未 `satisfied`（可替代）；5）目标循环重试并采用；6）A' 开工。
- 观察量：第一次 `busy`，活动计划不变，候选仍 `candidate`；Run 结束后的第二次 `committed`，活动计划前进一版，A 的旧执行定义不变、只改处置，A' 是新任务且有 Run；没有候选丢失/被抢；没有“改已运行任务定义再等 busy 后成功”的路径（那条会被执行痕迹守卫拒绝）。
- 具名变异：让 `applyPlanChange` 不看运行中的 Run；本行在“在跑时仍采用成功”处红。
- 期望来源：v4 §15-37；v4 §7.4；`plan-machine.ts:599`-`:611`、`:663`；6C L13 后改成“先停再采用”，本行只锁 6C 前。
**PL-38 没有参谋时发生偏差** （v4 §15-38） 入口：`workflow.handleIntervention`（`workflow.ts:3039`）/Host 偏差系统轮；`decisions/queue`/`card`（`:594`、`:595`）；`messages/outbox`（`:501`）；`sessions/find`（`:490`）；`activity/runs`（`:602`）。
- 前置：F3；目标没有参谋线（也没有区域参谋）；偏差需求覆盖 `growth`/`lines`/`budget`/`stop` 四值（另加有必需 `plan_only` 细化需求的一支）；没有 Workflow 返回的 waiting 卡，也没有持久 `no_adviser` cause；秘书线存在；另做“参谋收件人读失败”和“先建参谋线再跑”两个对照。
- 步骤：1）四值偏差/细化需求各触发一次系统轮判定；2）Host 找参谋收件人，权威读回 `null`；3）`readGoalDecisionCauses` 按“细化/偏差需求 + `resolveDutyRecipient('adviser')===null`”派生 `goal_cause/no_adviser`；4）`decisions/queue` 读卡，`decisions/card` 再核来源；5）秘书不被当收件人；6）人读卡；7）收件人读失败变体：读口返回 `unavailable`/`not_ready`，断言 `CoreRejection` 原样、不折成卡；8）建参谋线对照：`deviation:` 的发送 actor 是 `host:plan-round`，消费 Query 的 `answerShape='plan_round'`、工具表有 `submit_plan_round`，目标循环按同一确定性 Query 读回。
- 观察量：`decisions/queue` 的卡是 `goal_cause` 且 code `no_adviser`（不是 `adviser_creation`），由 `readGoalDecisionCauses` 从细化/偏差需求（`growth`/`lines`/`budget`/`stop` 四值都算）+ 权威 `resolveDutyRecipient('adviser')===null` 派生；只有权威 `null` 才出卡，收件人读失败原样返回 `CoreRejection`、不折成“没有参谋”；队列读和答卡来源重核得到同一个 `source.key`；秘书 `messages/inbox/outbox` 没有这条系统轮；卡上有给人看的去向；建线对照里系统轮身份/工具表/读回三处成立。
- 具名变异：让卡源只按三个停因（`auto_rework_cap_reached`/`no_new_basis`/`budget_exhausted`）判；本行在“`growth`/`lines` 不出卡”处红。
- 期望来源：v4 §15-38；v3 §5.4 第 5 步；M-4 裁定；103-1；C-28/C-D10；5.2.5/N7。
**PL-39 规划轮写了接口约定，第二个重叠任务派工** （v4 §15-39） 入口：`workflow/advance`（`:525`）；`goals/overlap-gates`（`:550`）；`goals/overlap-release`（`:549`）；`notes/list`/`notes/write`（`:618`）；`messages/*`。
- 前置：F4；A 在跑；B 与 A 同模块；规划轮在 A 开工前写过一条模块注记（`since` 早于 A 的 `startCursor`）；现在派 B；N 的请求是 `overlap-note:`（Host 系统 `action_request`、`workflow:auto-rework`），这轮冻结 `answerShape='text'`，不是 `plan_round`。
- 步骤：1）派 B；2）N 门打开，判注记不满足；3）门发 `overlap-note:` 约定请求；4）参谋核对并更新注记（晚于 A 开工游标）；5）门重核；6）B 开工；7）读这一轮的工具表。
- 观察量：第一次 `not_satisfied`；参谋线一条约定请求；`answerShape='text'`，工具表有 `record_note`、没有 `submit_plan_round`/邮箱/建成员；`notes/list` 出现新版本，`since`/锚点正确；重核后 `satisfied`，B 有 Run；没有用 `overlap-release` 绕过。
- 具名变异：让注记准入只看 `answerShape`（`text` → none）；本行在“N 的 text 轮写不了注记/门不满足”处红。
- 期望来源：v4 §15-39；v4 §8；v4 §6.2；5.2.8/N11/PLT-04。
**PL-40 闲线参谋收到 N 的约定请求** （v4 §15-40） 入口：Host `consumeIdle`（`host.ts:1825`）；`workflow.handleIntervention`；`goals/overlap-gates`（`:550`）；`notes/list`（`:618`）。
- 前置：F4；参谋线闲置；N 门已打开并发出系统约定请求；注记还没有晚于冲突 Run 开工的版本；另有一支秘书请求轮（`answerShape='secretary'`）写同类注记作对照。
- 步骤：1）第二个同模块任务派工；2）Host 把系统 `action_request` 供给闲置参谋线；3）参谋开 Query（`answerShape='text'`）；4）写/更新注记；5）N 门重核；6）第二个任务开工；7）秘书请求轮也写一次注记。
- 观察量：参谋 `queries/read` 有这一轮；工具表有 `record_note`、没有 `submit_plan_round`；owner 侧按“冻结形状 + 源消息 Host 系统身份 + 收件 duty”分派到规划 resolver，duty `adviser` 能写；`notes/list` 有新现行注记；门从 `not_satisfied` 变 `satisfied`；第二任务有 Run；系统请求没被 `notify` 吞掉；秘书请求轮的注记仍成功（仍走原 `resolveSecretaryQueryRun`）。
- 具名变异：把系统身份 `action_request` 从 `offerKindOf` 删掉；本行在“没有 Query/注记/门不满足”处红。
- 期望来源：v4 §15-40；5.2；5.2.8；v4 §8；N11/PLT-04。
**PL-41 重启发生在审阅轮中** （v4 §15-41） 入口：`createLocalWorkbenchHost`（`host.ts:454`）；`runStartupReconcile`（`startup-reconcile.ts:320`）；`createGoalWaitRebuild`（`goal-wait-wakes.ts:160`）；`host/reconcile-report`（`:554`）；`workflow/driver-start`（`:527`）；`queries/read`（`:517`）；`messages/read`（`:502`）；`planCandidates`/`settlementOfferOf`/`acceptedCandidatesOf`（6.1.6、6.7.1）。
- 前置：F6（SQLite）；三个变体：(a) 审阅 Query 已开、模型请求按住、未回答；(b) 原规划 Query 已 `settled`、对应收尾未写，含问题/文字回答/审阅/无答案收尾/候选未写或已写但 R 未关联五支；(c) 候选已 `accepted`、M 未回，另做“P2 采用后回复失败、人又采用 P3，再重启”的支。旧 Host 停在对应崩溃点；`resumeOnStartup` 默认 `ask`；目标有未完成必需工作；`completed`/`cancelled` Goal 不进恢复集合；另有一个没有本闭环来源的历史规划问题。
- 步骤：1）在对应点 `crash()`（先等 `reached`）；2）同目录起新 Host；3）启动核对写 `GoalInterruption`/报告；重建只按问题 reader 枚举**有本闭环来源**（`intervention_planning` 且 `execution.sourceMessageRef` 存在）的问题身份、逐卡 `readDecisionAnswer` 取已存答复，并用 `settlementOfferOf` 从邮箱遍历到的源消息读原 Query 和缺失收尾，用 `acceptedCandidatesOf(goalRef)` 读**全部**已采用候选；4）人 `workflow/driver-start`；5）解除后读审阅回答/候选/回复；6）读活动计划；7）P2/P3 支读 P2 的 M 和 P3 的 M；8）读 `plan_adoption` 的 `position` 和重启后再读一次（不读 actor）。
- 观察量：人启动前没有新审阅 Query、没有采用；报告显示中断/等人；启动后 (a) 原结论只读一次，`plans/apply` 只提交一次，同一候选没有第二轮审阅；(b) 由 `settlementOfferOf` 从原 Query/源消息续写确定性候选/回复，覆盖问题/文字回答/审阅/无答案收尾/候选未写或已写但 R 未关联五支，不靠重新投递源消息，不重开模型轮，不新建 Query 或恢复记录，**不以 Session 被 settled Query 占用为定位条件**；`planCandidates` 只收有来源的问题组，历史无来源问题不返回整口 `CoreRejection`；(c) 由 `acceptedCandidatesOf(goalRef)` 找到**所有**已采用候选（不只活动计划那一版），只补 M 回复，不再采用、不再 propose，M 恰好一条回复；P2/P3 支里 P2 的 M 仍被补回复，`completed`/`cancelled` Goal 不在恢复集合；`plan_adoption` 的 `position` 来自同一次接受提交的 `PlanRevisionAccepted`，通知不区分采用者、不读 actor，重启后再读不重复；三个变体活动计划都只前进一版。
- 具名变异：让 `settlementOfferOf` 仍要求 Session 被 settled Query 占用（不以邮箱遍历到的源消息定位）；本行在“问题/文字回答/审阅/无答案收尾/候选未写或已写但 R 未关联补不上”处红。
- 期望来源：v4 §15-41；v4 §6.1；决定 97-9；5.5.2/6.1.6 的 C-26/C-27；PLT-02/09/14/17。
**PL-42 审阅结束时目标没有任何可推进工作，也没有在跑的 Run** （v4 §15-42） 入口：`goal-wait-wakes` 的登记/排空；`workflow/advance`（`:525`）；`workflow/driver-read`（`:528`）。
- 前置：F2；目标等审阅，没有可派工任务、没有在跑的 Run；审阅 Query 已开未答；目标循环发 `planreview:` 前用读前游标登记，依据含 `SessionMessage` 和 `PlanProposal`。
- 步骤：1）审阅回答并提交；2）`SessionMessage` 提交触发 `goal_waits`；3）Host 排空后调一次 `advanceWork`/驱动；4）目标读到结论；5）按 22/23/24 分支继续。
- 观察量：`driver-read` 的 `last` 非空，且是审阅提交引起的推进；候选结论被读到；没有在跑的 Run 也能推进；重启后同一目标登记（重启见 41）。若审阅后候选是 `card`/审中/待改/`busy`，目标循环先继续选任务，能推进就返回 `perform`，只有没有别的可推进步骤才带着合并后的依据返回 `waiting`。
- 具名变异：把审阅等待依据从 `['SessionMessage','PlanProposal']` 改成 `['Goal']`；本行在“审阅回答后不被叫醒”处红。
- 期望来源：v4 §15-42；v4 §6.1。
**PL-43 审阅后候选被新候选替换** （v4 §15-43） 入口：`plans/propose`（`:483`）；`plans/proposal`（`:485`）；审阅 Query `queries/read`/`messages/body`（`:517`、`:503`）；`messages/outbox`（`:501`）。
- 前置：F2；候选 `P1@1` 在审阅中；审阅回答前参谋又写 `P2@1`（新的独立候选，新 `planId`/`proposalId`，`basedOn` 基于同一正式计划，不写 `replaces`）；`P1` 结论随后到；另加续轮变体：同一执行者 M 的问题两次问人后发 `planresume:`，续轮写出的 `P3` 是 `P2` 的后继（`basedOn=fixBase.basedOn`）。
- 步骤：1）`P1@1` 审阅中；2）`P2@1` 独立写入；3）`P1` 回答提交；4）目标循环读结论；5）读 `P2` 状态与审阅请求；6）续轮变体：两次问人后建新 Query，读 `repliesToMessageRef`；7）读问题卡/候选待决期间 M 的 wait 和回复，最终回答/采用后再读一次；8）续轮变体读 `P3` 的 `basedOn` 和旧候选是否仍进候选/卡。
- 观察量：`P1` 结论不落到 `P2`；`P2` 仍 `candidate`，需要自己的 `planreview:<P2>:1`；活动计划不变；没有把 `P1` `pass` 当 `P2` 通过。旧结论只对旧 `(proposalId, revision)` 有效；候选/卡读取按 6.3.1 来源链（`planfix:` 父候选 + `planresume:` 原 Query 的 `sourceMessageRef`，两种首行都走）排除被接替的旧候选；旧候选只被排除，**不写 `replaces`**。续轮变体：新 Query 的 `repliesToMessageRef` 仍是最初执行者 M（不是中间 R 的 `followupOf`）；`P3` 的 `basedOn` 等于 `P2` 的 `basedOn`，旧候选 `P2` 被排除，`P3` 仍要自己的 `planreview:`；问题卡/候选待决时 M 的 wait 仍 `open`、M 无回复；最终回答/采用后 M 恰好一条回复，第二次回复不覆盖。
- 具名变异：让 planresume 一律以活动计划为 base（不读 `fixBase`）；本行在“丢待修候选/旧候选不被排除/`basedOn` 错”处红。
- 期望来源：v4 §15-43；v4 §6.1；v4 §17；6.3.1/6.3.4；C-25/C-33 的续轮来源。
**PL-44 采用回 `busy`** （v4 §15-44） 入口：`plans/apply`（`:484`）；`goal-wait-wakes` 的 `Run`/`TaskLease`/`SessionMessage` 提交；`workflow/advance`（`:525`）；`plans/proposal`（`:485`）；`decisions/queue`（`:594`）。
- 前置：F1；候选已 `pass`、诊断无问题、自动档；候选动到的任务正好有未结束 Run 或未消费让出等待；`plans/apply` 回 `busy`；候选没转卡。另加两个恢复变体：(b) 取消已提交、采用未提交时重启；(c) 取消+采用都提交、回复未提交，另做 P2 采用后回复失败、人又采用 P3、再重启的支。
- 步骤：1）第一次采用得 `busy`；2）候选保持 `candidate`；3）让阻塞的 Run 结束/等待被消费；4）`goal_waits` 的提交叫醒目标；5）重试 `plans/apply`；6）(b) 在取消提交后、采用前重启，先读同一 `controlIntentRefFor` 的既有 intent 再续采用；7）(c) 在采用后、回复前重启，按 `acceptedCandidatesOf` + 源消息 open wait 只补回复；8）P2/P3 支读 P2 的 M 和 P3 的 M。
- 观察量：第一次 `busy`；活动计划不变；候选仍 `candidate`；提交后同一候选 `accepted`，只产生一版采用；没有第二次采用同一候选。(b) 复用一个取消身份，不生成第二个、不再次撞 `busy`；本次 `queued` 取消围栏成立时直接续采用、不再提交，权威 `not_found` 才提交，`superseded`/`outcome_unknown`/读失败保留实际出口；全文不再出现已删除的两个旧控制状态名；(c) 不再采用、不再 propose，只补 M 回复且只有一条；用 `acceptedCandidatesOf` 覆盖所有已采用候选，P2/P3 支里 P2 的 M 仍被补回复，`completed`/`cancelled` Goal 不进恢复集合；两者都不新建 Query/恢复记录；采用成功后 `plan_adoption` 只写“已采用”和确切审阅结论，不区分采用者。候选 `card`/审中/待改/`busy` 时先继续选任务，能推进就推进，只有没有别的可推进步骤才带着合并后的依据返回 `waiting`。
- 具名变异：把本次 `queued` 当成“没有 intent”（再提交一次取消）；本行在“第二次提交/撞 `busy`/覆盖人的停止指针”处红。
- 期望来源：v4 §15-44；v4 §6.1；7.3.1 第 3/8 步；C-26/C-27/C-36；PLT-08/09。
**PL-45 执行者发给参谋长消息带 `taskRef`，参谋线有未完成 Work** （v4 §15-45） 入口：执行者真实工具发 `action_request`；`workflow.handleIntervention`（`workflow.ts:3039`）；`sessions/executions`（`:563`）；`queries/read`（`:517`）；`tasks/query`（`:486`）。
- 前置：F0；参谋线自己有一个未完成 Work W；A 发消息给参谋，带 `taskRef: W`；A 让出；参谋线可消费。
- 步骤：1）A 发消息；2）Host 消费；3）`handleIntervention` 按发信身份和收件线 duty 判断“请参谋处理问题”，`taskRef` 只作上下文；4）开规划 Query；5）W 不被领取。
- 观察量：W 没有新 claim/Run；参谋 `queries/read` 有规划 Query；A 的消息得到规划处理；没有“参谋去领 W”的分支。
- 具名变异：恢复 `addressed = message.taskRef ?? ...` 并进入领取块；本行在“W 被领取/没有规划 Query”处红。
- 期望来源：v4 §15-45；5.2；v4 §7.1。
**PL-46 一段任务书被采用；候选转卡** （v4 §15-46） 入口：`plans/apply`（`:484`）；`decisions/queue`/`card`/`candidate-card`（`:594`–`:596`）；`main/read`（`:631`）；`workspaces/registration`（`:529`）；真实文件读取。
- 前置：F5；任务书目录在工作区外、真实磁盘；一段任务书被采用；另一个候选转卡；两处内容可区分（不同目标/阶段/计划版本）；导出前读一次工作区版本；另加隔离变体：工作区根 = `<settingsDirectory>/taskbooks`（或导出根落在任一工作区根内），真实磁盘、不 mock。
- 步骤：1）采用一段任务书；2）Host 导出，路径写进“请知悉”；3）读文件；4）候选转卡；5）再导出，路径写进卡；6）读文件；7）再读工作区版本；8）完整读入、按片段搜索；9）隔离变体：同一采用/转卡再跑一次。
- 观察量：两份 Markdown 都存在、UTF-8 可读、非空；含完整 `instruction` 和任务/阶段/版本标识；片段搜索命中；文件名含目标/阶段/计划版本，并含唯一 `planId`；不同候选同阶段同 revision 的导出路径不互相覆盖；同一候选重复导出只覆盖自己的文件；工作区 revision 不变；工作区里没有多出导出文件。候选转卡时经 `decisions/candidate-card` 的 `exportRead` 读（`written`/`missing`/`incomplete`/`not_configured`/`unavailable`），失败行可读、不折成空；`exportRead` 的输入是候选 draft（未采用），路径按 `planId`/`planRevision`/`stageId` 算，不要求 `ref`/`acceptedAt`。采用/转卡走同一个 `adoptAndExport`；系统轮消费/恢复报价接在 `consumeIdle` 的既有 `offer.kind` 分支，关闭时等导出异步工作。隔离变体：`plans/apply` 仍 `committed`，工作区里没有多出任务书，`main/read` 写“未写出”，`decisions/queue` 没有新卡。
- 具名变异：只凭 `promptsRoot` 通过就跳过导出根检查（不比较工作区根）；本行在“隔离变体仍写出任务书/工作区多文件”处红。
- 期望来源：v4 §15-46；5.3.4；N12；N2/PLT-22；C-23。
**PL-47 导出失败** （v4 §15-47） 入口：`plans/apply`（`:484`）；`decisions/queue`（`:594`）；`main/read`（`:631`）；`decisions/candidate-card`（`:596`）；真实文件系统故障（`ENOTDIR`/`EACCES`）和导出根隔离失败。
- 前置：F5；导出根设成必然失败的真实路径；候选已 `pass`、诊断无问题、自动档；采用将要发生；另加隔离失败一支（导出根命中工作区根）。
- 步骤：1）采用；2）导出失败；3）读采用结果和活动计划；4）读“请知悉”/卡；5）读工作区版本；6）隔离失败支同法跑一遍。
- 观察量：`plans/apply` 仍 `committed`，活动计划前进一版；候选不是 `not_adopted`；提示写出失败原因；工作区版本不变；不重试到卡死；人自己采用时也发这一条提示（裁定 C-9/N12）；隔离失败也走现有 `failed` 出口、不新造结果码。若此时转候选卡，`decisions/candidate-card` 的 `exportRead` 必须是 `unavailable`/`incomplete` 并带失败行，不能折成 `not_configured` 或空白；它的输入是候选 draft（未采用），不要求 `ref`/`acceptedAt`。
- 具名变异：把导出失败包成采用失败（回滚/回错误）；本行在“采用没成功/活动计划没变”处红。
- 期望来源：v4 §15-47；5.3.4；裁定 C-9/N12；N2/PLT-22；C-23。
**PL-48 改动行数超过预估 2 倍；增长量过 2 倍线** （v4 §15-48） 入口：`plans/propose` 的 `estimatedLines`；Run 结束处的行数/增长量读数；`workflow.handleIntervention`；`activity/runs`（`:602`）；`messages/outbox`（`:501`）；`workflow/advance`（`:525`）；`main/read`（`:631`）。
- 前置：F0；任务 A 的 `estimatedLines: 10`、`sizeClass:'small'`（提醒线 1M，2 倍线 2M）；脚本模型用真实 `edit` 在 A 的 Run 里净增 21 行（2 倍 = 20，21 才“超过”），增长量先 1.2M、后 2.1M；B 可继续；A 的 Run 正常结束（不是已有停因）；另做 20 行边界；`deviationsOfGoal` 的输入带 A 的 `sizeClass` 和 Host 有效 `limits`。
- 步骤：1）A 跑完，增长量 1.2M；2）读参谋 `notify`；3）增长量 2.1M，读 `deviation:…:growth:…`；4）21 行，读 `deviation:…:lines:…`；5）同一版重放这两个 `kind`；6）20 行边界不触发；7）参谋轮结束、答案是文字退路时读人的 `plan_notice`；`plan`/`questions` 分支再各跑一次。
- 观察量：1.2M 只发一条 `notify`、不开轮；2.1M 发 1 条 `growth`；21 行发 1 条 `lines`；`DeviationKindV1` 的 `growth` 和 `lines` 两支都可达（与 PL-36 的 `budget`/`stop` 合起来四值可达）；同一个 `kind` 在同一任务同一版只一条，不同 `kind` 不互相压掉（`growth` 和 `lines` 可同版共存）；A 没有新增停因、不停，B 不受影响；20 行时 0 条 `lines` 系统轮；参谋答文字退路时人从 `decisions/queue` notices / `main/read` 读到 `plan_notice` 的 `deviation-notice:<goalId>:<requestId>`；`plan`/`questions` 分支不出这条；`plan_notice` 读失败 `unavailable`，不折成空。
- 具名变异：把行数比较从 `>` 改成 `>=`；本行边界在“20 行误报”处红；或删掉行数读数只数文件，21 行不触发。
- 期望来源：v4 §15-48；v4 §7.1；v4 §7.5 的 `DeviationInputV1`；v4 §10 的“行数不只是读数”；C-35/PLT-16。
**PL-49 候选动到已细化的任务，自动档** （v4 §15-49） 入口：`plans/propose`/`plans/apply`（`:483`、`:484`）；`workflow/advance`（`:525`）；`main/read`（`:631`）；`tasks/query`（`:486`）。
- 前置：F1；目标已有一段被细化并执行过的任务 A：A 的 Run 已结束、任务尚未 `satisfied`（可替代），执行定义冻结；候选由 `submit_plan_round` 表单构造，显式带 A 的 `disposition:'superseded'`/`replacedByTaskId:A'`、plan 顶层 `inputRequirements`、根 `reason.affectedTaskIds:['A']`；诊断无问题、审阅 `pass`、自动档。
- 步骤：1）参谋用 `submit_plan_round` 提交候选；2）断言 `replacedByTaskId`/`inputRequirements`/`affectedTaskIds` 原样进候选，缺失时按 `plan-machine.ts:695` 拒绝；3）审阅 `pass`；4）自动采用；5）读活动计划和 A/A' 行；6）读“请知悉”；7）人按需 `goals/control` 或改计划。
- 观察量：活动计划前进一版；A 原执行定义不变、只改处置；A' 是新任务且开工有 Run；notice 写出“改了什么 + 影响哪些任务”；`goals/control` 仍可暂停目标；人的干预不被自动采用挡住；没有把“已 `satisfied`”当替代前置（那种情况不进入本行）。
- 具名变异：在“请知悉”投影里删掉 `affectedTaskIds`/影响清单；本行在“notice 没有影响清单”处红。
- 期望来源：v4 §15-49；v4 §6.1；v4 §6.4；v4 §7.4；5.2.7(3)、7.3.3；`plan-machine.ts:599`-`:611`、`:695`。
**PL-50 人要暂停这个任务：Run 在跑；Run 已结束；唯一承担者** （v4 §15-50） 入口：`controls/submit`/`read`（`:463`、`:464`）；Run 已结束时 `plans/propose`/`plans/apply` 设延后（`:483`、`:484`）；`goals/control`（`:546`）；`tasks/query`（`:486`）；`tasks/requeue`（`:543`）只在加预算/人工重排处用。
- 前置：F0；同目标 A/B，A 要暂停，B 可继续。三个变体：(a) A 的 Run 在跑；(b) A 的 Run 已结束、下一个还没开；(c) A 是某项必需义务的唯一承担者。
- 步骤：(a) `controls/submit` pause 再 `controls/read`；(b) 用计划草稿把 A 设 `deferred`，`plans/apply` 采用，读 disposition，再恢复；(c) 先试 (b) 的设延后，读拒绝；再 `goals/control` 暂停整个目标，或改计划换承担者。
- 观察量：(a) pause 意图/已应用，A 的 Run 不再进入，B 照常；(b) A 是 `deferred`，B 继续，恢复后 A 的下一个 Run 接得上；(c) `plans/apply` 回 `invalid`（`required obligation ... no longer has a valid active required carrier`），活动计划不变；`goals/control` 成功；没有“新增替代任务冒充暂停”/“平台硬刹车”。
- 具名变异：删掉 `plan-validation.ts:521` 的“必需义务必须有 active required 承担者”检查；本行 (c) 在“设延后被错误接受”处红。
- 期望来源：v4 §15-50；v4 §7.2；PL3-01。
**PL-51 软超线，参谋不改计划** （v4 §15-51） 入口：`activity/runs`（`:602`）；`workflow.handleIntervention`；`workflow/advance`（`:525`）；`main/read`（`:631`）；`decisions/queue`（`:594`）的 notices；`tasks/query`（`:486`）。
- 前置：F0；任务 A 的 `sizeClass:'small'`、`estimatedLines` 存在；两个软线分支：增长量过 2M 发 `growth`，行数超 2 倍发 `lines`；参谋答“不改计划/只作判断”；A 没有既有停因；另加一个已有 `stop`/`budget` 的变体；`deviationsOfGoal` 的输入带 `sizeClass` 和 Host 有效 `limits`。
- 步骤：1）`growth` 和 `lines` 两个软超线各出现一次；2）Host 发对应系统轮；3）参谋答“不改计划”；4）目标循环照常选任务；5）A 继续跑；6）人从 `decisions/queue` notices / `main/read` 读“请知悉”；7）已有 `stop`/`budget` 时重跑同一判定；8）只发参谋 Session 的 `notify`、不产生 `plan_notice` 时再读人的队列；9）同一 `itemKey` 重放一次。
- 观察量：两个软线分支都可达，A 的 `effectivePhase` 仍是 `running`/`pending`，不被设 stopped/deferred；notice 明确读 `decisions/queue` 的 `plan_notice`、itemKey 是 `deviation-notice:<goalId>:<requestId>`；只发参谋 Session 的 `notify` 时人的队列读不到，不算通过；同一 `itemKey` 重放只一条；Query 读失败 `unavailable`，不折成空；没有新候选/采用；参谋出箱没有第二条同 `kind` 的同版 `deviation:`；A 没有既有停因时 B 继续。已有 `stop`/`budget` 时软线**不发轮**、只写请知悉，不新增 `growth`/`lines`；不同 `kind` 不互相压掉。
- 具名变异：让“参谋不改计划”的分支把 A 停下（写停因或 `deferred`）；本行在“任务没有继续”处红。
- 期望来源：v4 §15-51；v4 §7.2；v4 §7.3；v4 §7.5；v4 §10 的“不做硬刹车”；C-35/PLT-16。
**PL-52 已有代码的工作区，第一版完整方案** （v4 §15-52） 入口：第一版方案的 `plans/propose`/`initialization/adopt`（`:483`、`:591`）；`planreview:`；`decisions/card`（`:595`）；`plans/apply`（`:484`）；`workflow/advance`（`:525`）。
- 前置：F0 的 workspace 是已有代码的真实目录（至少一个源文件）；第一版完整方案（不是骨架）；审阅线存在；“已有代码”由真实文件判定，不靠标志位。
- 步骤：1）提交第一版完整方案；2）发一次 `planreview:`；3）审阅出 `fix`/`pass`；4）意见写进卡；5）人 `plans/apply` 采用（走 `adoptInitialization`，`:2273` 附近），不被 `fix` 挡；6）改稿不自动再发审阅，除非人要求；7）关闭 Host，确认 `:2307` 附近的关闭等待会等导出异步工作。
- 观察量：`planreview:` 恰 1 条；卡带 findings；人采用成功，活动计划前进；改稿后没有第二条 `planreview:`；没有“先 pass 才让人采用”的门。采用确实走 `adoptInitialization`，系统轮消费/恢复报价仍接在 `consumeIdle` 的既有 `offer.kind` 分支（`:1855`、`:1880` 附近）；关闭时等导出异步工作（`:2307` 附近）；共享文件仍串行，rebase 不重排等待登记。
- 具名变异：把第一版完整方案的采用条件改成“审阅 `pass` 才能采用”；本行在“人采用被挡”处红。
- 期望来源：v4 §15-52；v4 §6.3；设计 `plan-loop-design.md:255`（首案审一次、空工程不审的判定和实现归 6C L7）；D15；6C L7。
**PL-53 空工程的第一版方案** （v4 §15-53） 入口：第一版方案的 `plans/propose`/`initialization/adopt`（`:483`、`:591`）；`plans/proposal`（`:485`）；`messages/outbox`（`:501`）；`plans/apply`（`:484`）。
- 前置：F0 的 workspace 是真实空目录（没有源文件）；第一版完整方案写入；审阅线存在且可用。
- 步骤：1）提交第一版方案；2）目标循环检查工作区是否有代码；3）空工程不发 `planreview:`；4）人采用。
- 观察量：审阅线收件箱 0 条 `planreview:`；候选卡/采用路径正常；人 `plans/apply` 成功；没有因为“有审阅线”就审。
- 具名变异：把“已有代码才审”改成“有审阅线就审”；本行在“空工程也发审阅”处红。
- 期望来源：v4 §15-53；v4 §6.3；设计 `plan-loop-design.md:255`（首案审一次、空工程不审的判定和实现归 6C L7）；D15；6C L7。
### 15.5 计数和依赖
**计数：** 设计行 53 条 = v3 第 9 节 1–21（21 条）+ v4 第 15 节 22–53（32 条）；规格新增 13 条 = A-01/A-02/A-03/A-05/A-06/A-09/A-10 + G-01/G-02/G-05/G-08/G-12/G-13；合计 66 条。53 条不是全部。v3 第 3、10、11 条已按 v4 第 15 节的三处改动落：第 3 条加审阅轮，第 10 条只提醒，第 11 条的 2 倍线开参谋轮。测试行改动只改六项内容，不增删测试行。

**依赖（只写依赖，不写做法）：**
- **L2：** PL-02 的偏差入口和并发顺序依赖它。
- **第 2 步读数（三个读数）：** PL-11、PL-19、PL-48、PL-51 的提醒线/2 倍线/行数判定依赖它。
- **7D2：** 行 22–29、32–35、38–43、45、52、53 的真实参谋线/审阅线依赖它；7D2 前只能用外部配置和 `sessions/create` 过渡。
- **第 9 片：** 行 27 只测“诊断命中、不自动采用、转卡”，不依赖第 9 片。
- **7D1（共享文件落地顺序，不是行为依赖）：** 行 22、31、46、47、49、51、52 的共享 `host.ts`、决定契约/读模型、提示词包和“请知悉”投影按 §19.2 串行落地；它不改变行本身，也不要求这些行等 7D1 才能开始。
- **6C L7：** PL-52、PL-53 的“工作区已有代码首案审一次、空工程不审”判定和实现归 6C L7（设计 `plan-loop-design.md:255`）；本片只锁依赖，不把首案判定另加进 PL、不加字段。没有它时这两行只能验到第一版方案的提交/采用路径，“审不审”的触发判不了。
- **已拆除的等待：** 行 37、49、50 不再等 6C（行 37 只锁 6C 前 `busy`，行 49/50 用现有替代/设延后/暂停入口）；行 33/34 的普通回复接续不再等 H（回复只走现有 `respondFromQueryAnswer` 和消息关联）。
### 15.6 规格新增测试（A-01…A-10、G-01…G-13 中的 13 条）
这 13 条是第二稿按裁定、第三稿补 G-13 后进 §15 的规格新增行：A 组补 C-1 的提交工具与答案形状，G 组补阶段 gate、正文长度、导出失败和 Host 设置。六项字段与 15.3/15.4 相同；总数是“设计 53 条 + 规格新增 13 条”。其余 A/G 场景由相邻 PL 行覆盖：A-04→PL-02/PL-30，A-07→PL-03，A-08→PL-07/PL-41，G-03→PL-21，G-04→PL-07，G-06→PL-12，G-07→PL-06/PL-38，G-09/G-10/G-11→PL-46/PL-47。夹具优先复用 15.2 的 F0–F6，不新造记录、不读 store。

**A-01 审阅轮挂 `submit_plan_review`，`pass` 走工具** 入口：`sessions/create` 建审阅线（duty `reviewer`）+ `workflow/driver-start`；Host 模型闸门记录本次 Query 的工具表；`queries/read` 读答案。
- 前置：一个活动目标、一份已采用计划、一个 `candidate` 候选；审阅线 active；Host 配置有审阅 profile。
- 步骤：驱动目标循环 → 读到候选、没有审阅结论 → 用 `systemRoundRequestId({kind:'planreview',goalRef,proposalId,proposalRevision})` 算请求号并发出（不另建 parser）→ Host 消费审阅线 → 准备/启动审阅 Query → 闸门让模型只调一次 `submit_plan_review`，`verdict:'pass'`、`findings:[]`。
- 观察量：本次 Query 的模型工具表含 `submit_plan_review`，不含 `submit_plan_round`/`submit_secretary_answer`；`answer.answer` 恰好是 `{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}`；`planreview:` 消息被关联回复，**回复正文是 `审阅通过`（`planningReplyTextOf` 的 `plan_review` pass 文案），不是答案 JSON**；候选仍 `candidate`（采用由 6.1 的下一轮按 `pass`+诊断+autonomy 判，不在本轮）。审阅输入含这一版新写任务的完整 `instruction`、新增/改动义务和验证要求、以及 `executionDag.dependsOn`/`taskRelations`/`inputRequirements` 的差异；模板明确“只审改动，已采用内容作依据不重审”。
- 具名变异：让审阅回复照抄答案 JSON（不按 `planningReplyTextOf` 的 `plan_review` 文案派生）；本行在“回复不是 `审阅通过`/超 16 KiB”处红。
- 期望来源：C-1；6.3.3；5.2.7 的工具表；5.3.5 的 `planningReplyTextOf`；`answer-tools.ts:382` 的 schema 写法；PLT-12。
**A-02 审阅 `fix` 走工具；空 findings 被拒** 入口：同 A-01 的审阅线、候选和 Host 模型闸门。
- 前置：同 A-01；模型准备给 `fix`；审阅输入同 A-01 带完整任务书、义务和依赖差异，并受“只审改动”的模板限制。
- 步骤：先调 `submit_plan_review({verdict:'fix',findings:[]})`，读工具结果；**不换 Query**，在同一 Turn 里再调 `submit_plan_review({verdict:'fix',findings:[{taskId:'<候选里的 taskId>',text:'把先看什么写进 instruction'}]})`；然后让目标循环读结论；另起一轮调 `submit_plan_review({verdict:'pass',findings:[{taskId:null,text:'可选意见'}]})`，读接受结果和后续采用判断。
- 观察量：第一次工具结果是 `rejected`/`invalid`，但同一 Query 仍能收到第二次调用、最终答案来自第二次提交（拒绝没有结束 Turn；不读私有 `acceptedCallIds`）；第二次 `success`/`accepted`，屏障在结果提交后 `yield`；`answer.answer` 的 `verdict` 是 `fix`、`findings` 至少一条；目标循环发下一条 `planfix:<proposalId>:<revision>`，参谋轮的工具表是 `submit_plan_round` 而不是 `submit_plan_review`；`planreview:` 的回复正文是 `审阅要求返修：<n> 条意见，见 Query <queryJobId>`（n=findings.length），不复制 JSON。`pass` 带非空 findings 仍被接受，且不因此挡 6.1 的自动采用（只按诊断和 autonomy 判）。
- 具名变异：删掉 `answerProblems('plan_review')` 的 `fix` 非空检查（空 findings 被接受）；或把 `planfix:` 的 `answerShape` 写成 `plan_review`。
- 期望来源：6.3.3 的接受/拒绝四步；6.3.4 的 `planfix:`；C-2 的答案形状；`answer-tools.ts:563`、`:594`；`tests/RULES.md:27`。
**A-03 审阅写文字退路仍可解析** 入口：同 A-01 的审阅线；Host 模型闸门让模型**不调工具**，只输出最后一段 assistant 文本。
- 前置：同 A-01；审阅 Query 仍冻结了 `submit_plan_review`（工具在，但模型这一轮没用）；三个变体：(a) 最后文本是合法 `pass`/`fix` 形状；(b) `pass` 带非空 findings；(c) 终态坏答案（不是恰好一个 JSON 对象/字段坏）。
- 步骤：(a) 模型最后文本写同一 JSON 形状（`kind:'plan_review'`、`pass` 或 `fix`）→ Query 结束 → 观察器读最后的非空文本 → 目标循环读答案；(b) 同法写 `pass` 带 findings → 读接受结果；(c) 写坏形状 → Query 终态 → 目标循环读结论并转卡；再跑一趟心跳看重发/重审。
- 观察量：(a) `answer.answer` 是这段文字（≤16 KiB）原样；`parsePlanReviewAnswer` 解析成功；没有 `tool_result` 成功提交也照样有关联回复；目标循环按 `pass`/`fix` 走 6.1 的表，不把正文猜成 `pass`。(b) `pass` 带非空 findings 仍接受，不因此挡自动采用。(c) 终态没有合法结论时转候选卡（`review_invalid`），不重发同一请求、不重审同一候选、不采用；卡上写原因。
- 具名变异：让观察器在 `submitted === null` 时返回 `gap` 或要求必须有提交（文字退路消失）；或让终态坏答案触发重发/重审；本行在“文字退路消失/重发重审”处红。
- 期望来源：FA 的 `formalAnswerOf` 文字退路（5.2.7（3））；6.3.3“写文字的退路”；6.1.3 的 `terminal_invalid`。
**A-05 规划轮挂 `submit_plan_round`，256 KiB 的 plan 能存能读（窗口两格 / summary 16 KiB）** 入口：目标驱动走到 `plan_only:` gap → `refine:` → 参谋线 Host 消费 → Host 模型闸门 → `queries/read`/`plans/proposal`；`main/read` 读回复正文。
- 前置：活动目标、已采用计划、后续段 `plan_only` 占位；参谋线 active；两个窗口格：`contextWindowTokens=1_000_000` 一格（`perResponseTokens=131072`）、`contextWindowTokens=128_000` 一格（`perResponseTokens=64000`），两格都由 `planningOutputReserveTokens(contextWindowTokens)` 算、**不改窗口本身**；每格完整输入 + 预留装得下（装不下走现有 `ContextCapacityExceeded`，请求不发）。
- 步骤：1）两格各准备/启动规划 Query；2）闸门让模型调一次 `submit_plan_round({answerKind:'plan',summary,plan,reason:{text,affectedTaskIds}})`，其中某个 `assignment.instruction` 约 100 KiB（>16 KiB 且 <256 KiB），任务带 `estimatedLines:40`、`sizeClass:'medium'` 和 `replacedByTaskId`，plan 顶层带 `inputRequirements`；3）再提交 `summary` 约 30 KiB 且 plan <256 KiB 的同形答案；4）另提交 `summary` ≤16 KiB 的同形答案；5）工具接受 → 观察器落答案 → 目标循环 `mergeStageRefinement`/`proposePlan` 读答案；6）读回复正文。
- 观察量：模型工具表含 `submit_plan_round`，不含 `submit_plan_review`；**两格都真的到达模型并有真实 `usage`/答案返回**（不是只读配置值），`perResponseTokens` 分别是 131072/64000；工具结果 `accepted`；`answer.answer` 是 v2 `kind:'plan'`，正文字节数等于提交的表单构成长度（100 KiB 不是 16 KiB）；`readInitialPlanAnswerFacts` 读回 `answerText` 与 `answer.answer.answer` 全文相等、digest 相等；候选写入，`assignment.instruction` 全文、`estimatedLines:40`、`sizeClass:'medium'`、`replacedByTaskId`/`inputRequirements` 和根 `reason` 都原样保留；30 KiB `summary` 被 `answerProblems` 判 `invalid`、不产生候选；≤16 KiB `summary` 的答案被接受，回复正文等于该 `summary`（不复制计划全文）。
- 具名变异：删掉 `answerProblems` 的 `plan_round` summary 16 KiB 检查（30 KiB summary 被接受）；本行在“30 KiB summary 通过/回复正文不是 summary”处红。
- 期望来源：C-1/B-D1 的取代；5.2.7（3）（4）；5.3.5 的规划轮 256 KiB / `planningReplyTextOf`；N1/G-N2 的窗口公式；C-18/PLT-12；`initial-plan-answer.ts:266` 的全文/digest 比对。
**A-06 `submit_secretary_answer` 仍是 16 KiB；文字退路也按 16 KiB** 入口：人的请求轮（`semantic_query`）→ 秘书线 Host 消费 → Host 模型闸门；规划轮文字退路；普通 Query；`queries/read`。
- 前置：一个请求轮 Query，`manifest.answerShape='secretary'`；模型可调 `submit_secretary_answer`；另加三个同公开请求路径的变体：规划轮不提交工具、纯文字退路 >16 KiB；请求轮同一长度文字；普通 Query 同一长度文字。
- 步骤：1）先调 `submit_secretary_answer({body:'<约 100 KiB 的正文>',ideas:[]})`；2）再调一次 15 KiB 的正文；3）规划轮不调工具，让最终文本超过 16 KiB；4）请求轮同样写超长文字；5）普通 Query 同样写超长文字。
- 观察量：第一次工具结果 `rejected`/`capacity`，`answer.answer` 没有 100 KiB 的答案；第二次 `accepted`，16 KiB 的答案能存能读；`answerShape` 仍是 `secretary`，没有因为规划轮放宽而变宽。3）规划轮纯文字退路 >16 KiB → 观察 `too_long`，**不产生答案**；请求轮 `failed` + `answerCheck.detail='too_long'`；普通 Query 落 `gap`。三处都不按规划答案的上限判（规划答案的上限只属于 `submit_plan_round` 的已接受工具答案和持久答案）。
- 具名变异：让 `submit_secretary_answer` 也用 `PLANNING_MAX_ANSWER_BYTES`；或让观察器对 `secretary` 选规划答案的 bound；或把纯文字退路改回按规划 bound 判。
- 期望来源：C-1 的“`submit_secretary_answer` 仍是 16 KiB”；5.2.7（4）；5.3.5 #3 的定值表；`answer-tools.ts:571`；`query-observation.ts:498`。
**A-09 规划轮的问题分支：`answerKind:'questions'` 走工具** 入口：`refine:` 规划 Query → Host 模型闸门 → `workflow/driver-read`/卡。
- 前置：活动目标、后续段 `plan_only` 占位；模型这一轮要问人，不写计划。
- 步骤：模型调 `submit_plan_round({answerKind:'questions',summary,questions:['…']})` → 工具接受 → 目标循环读答案。
- 观察量：`answer.answer` 是 v2 `kind:'needs_decision'`、`questions` 非空；不是 `kind:'plan'`；目标循环出问题卡（不写候选、不采用）；工具表仍只有 `submit_plan_round`，没有 `submit_initial_questions`。
- 具名变异：让 `submit_plan_round` 的 `questions` 分支构造成 plan 文本；或允许空 `questions` 通过（`parseInitialPlanningResponseV2` 的空数组规则）。
- 期望来源：C-1 的“一个工具写计划或问题”；`submit_initial_questions` 的 `questions` 非空规则；6.1 的问题卡出口。
**A-10 `planresume:` 只带引用；续轮最终回答/候选回最初 M** 入口：一轮问题卡答完 → 目标驱动发 `planresume:` → Host 消费原规划线 → `messages/read`/`body`（`:502`、`:503`）读消息、`queries/read`（`:517`）读 Query 的 `question`；Host 夹具的模型请求记录（`S6A-host-fixture.ts:322`）读准备输入；`plans/proposal`（`:485`）读候选；`messages/outbox`/`read` 读最初 M 的 response；`executions/read`（`:530`）读执行者接续；普通消息/普通 Query 和没有本闭环来源的历史规划问题作对照。
- 前置：原规划轮有 `needs_decision` 答案；原问题 + 5 张卡**各 16 KiB** 答复（合计 80 KiB，已超过 64 KiB）；`planresume:` 正文/`question` 只含请求头 + `originalQueryRef: <canonicalJson(originalMessageRef)>`（实测只有几百字节，不带原问题全文、不带逐卡答复正文、不带 256 KiB 规划答案）；原规划线 active；参谋续轮能交最终文字回答或采用候选；最初执行者 M 是原计划的 `work_run` 发送者、wait 仍 open；另有一个历史初始化/普通 `initial_coordination` 规划问题，它没有本闭环来源消息。
- 步骤：1）所有问题卡答完、还没有 `planresume:` 消息时，目标循环先登记 `plan_resume_pending`，再发 `planresume:`（`followupOf=M`，正文只带请求头 + `originalQueryRef`）；2）建新 Query（`execution.kind='intervention_planning'`，`question` 同这小正文）；3）读消息体和 Query；读准备输入，确认原问题 + 5 组问答在模型输入里；4）重复调用一次，读请求号；5）续轮让参谋交 `plan` 候选或纯文字最终回答（纯文字用一段非 v2 JSON、可逐字比对的 ≤16 KiB 文本；`questions` 只作再次问人的对照），公开读最初 M 的 response 和执行者接续；6）另起未准备就重启的变体（F6）；7）再跑历史无来源问题：`planCandidates`/普通 Query 不被整口拒绝；8）做一次问题/答案/消息读失败变体。
- 观察量：`planresume:` 消息和 Query 都成功，正文/`question` 只有请求头 + `originalQueryRef`、没有逐卡答复，不出现 `capacity`/`invalid`；准备输入含原问题和 5 组问答（逐卡答复来自准备装配，不在保存正文里）；Query 的 `answerShape` 是 `plan_round`、工具表是 `submit_plan_round`；续轮最终回答/采用后，**最初 M 的 response 恰好一条、内容来自续轮结果**（`planningReplyTextOf`：规划答案能解析成合法 `plan`/`questions` 时取 `summary`；`plan_round` 的文字退路（已保存、非空、≤16 KiB）逐字保留原文，不复制全文），执行者 wait 关闭并在新 Run 继续；重复调用只回放同一请求号/同一条消息；未准备就重启时按同一 `originalQueryRef` 重装配成功；历史无来源问题使 `planCandidates` 仍 `ready`、普通 Query/原请求流程不被拒、不返回一整口 `unsupported`；问题枚举、答案读、消息/Query 读失败原样保留，不折成已答/未答。
- 具名变异：让采用/最终回答后不按 6.3.1 来源链给最初执行者 M 写回复（只把答案关联回续轮 R、漏掉这次最终关联）；本行在“M 没有唯一回复/执行者不继续”处红。
- 期望来源：A-10；6.1.6、7.3.1 的最终关联；PLT-13/B-D5（正文只带 `originalQueryRef`，逐卡答复在准备输入装配）；5.2.3、5.3.5 #8；PLS-08/N27（无来源问题不整口拒绝）；5.2.4/C-25（M 只有一个回复槽）；7.3.2。
**G-01 阶段 gate 和模块 gate 先于后续段占位通过** （B-D4、G-D3；v3 `:125`；一行两格：`stage`、`module`，具名变异是选择条件只认 `stage`） 入口：`workflow/driver-start`（`src/app/core-routes.ts:527`）启动目标；`workflow/advance`（`:525`）由驱动推进；`tasks/query`（`:486`）读任务行；`plans/proposal`（`:485`）和 `goals/read`（`:473`）读版本。
- 前置：F0（冷启动 Host；memory）；目标已采用“骨架 + 第一段 + 后续段每段一个必需 `plan_only` 占位”；第一段的任务全部 `satisfied`，第一段最后一个 Run 已结束并归约；第二段只有那个必需 `plan_only` 占位，还没有任何细化候选；第一段有一个 `scope.kind==='stage'`、`required`、`active` 的 gate。
- 步骤：1）`workflow/driver-start` 驱动；2）让第一段任务执行、检查、结束（用真实 Run/检查步骤，不手写 phase）；3）连续 `workflow/advance`，直到 `tasks/query` 的第一段 gate 变成 `satisfied`；4）在同一个推进窗口里读 `plans/proposal`/`goals/read`；5）继续推进，读参谋线 `messages/outbox`（`:501`）。
- 观察量：第一段 gate 在**第二段仍是 `plan_only`、没有任何细化候选被采用**时就已经走到 `satisfied`；`goals/read.activePlanRevision` 仍是第一版；第二段占位仍是 `plan_only`（`tasks/query`）；之后参谋线收件箱出现 `refine:`（首行 `refine:<goalId>:<stageId>:<planRevision>`）。顺序是 gate 先、refine 后，不是 refine 先、gate 后。模型输出的骨架**每个阶段都有 stage gate**；缺 gate 的变体只作为审阅 finding/候选卡出现，不是入图校验拒绝；平台调度断言不变。
- 具名变异：把 5.1.3 的阶段 gate 选择整段移回 `workflow.ts:1936` 的 `if (unfinishedWork.length > 0)` 之后（即恢复旧顺序）；本行在第一段 gate 被第二段占位挡住、永远到不了 `satisfied` 处红。
- 期望来源：v3 5.2“阶段 scope 的 gate，在这个阶段的必需普通任务全部满足时就可以被选中，不等整个目标”；v3 第 9 节第 3 条“第一阶段完成，第二阶段只有占位任务 → 阶段 gate 先过”；B-D4；5.1.3。
**G-02 目标 gate 仍等全部必需 work** （B-D4） 入口：同 G-01 的 `workflow/driver-start`/`workflow/advance`/`tasks/query`；`graph/detail`（`core-routes.ts:614`）读 gate 的检查 round。
- 前置：F0；计划同时有第一段的 stage gate 和 `scope.kind==='goal'` 的必需目标 gate；第一段任务全部 `satisfied`；第二段有一个**已细化、可执行、还没完成**的必需 `request_execution` 任务（不是 `plan_only`），所以 `unfinishedWork` 非空；第二段任务没有 `gate-result` 依赖。
- 步骤：1）驱动目标；2）第一段完成、stage gate 打开并检查；3）在第二段任务未完成时读目标 gate；4）让第二段任务完成；5）再读目标 gate。
- 观察量：第二段任务未完成时，目标 gate 仍 `pending`/`ready`，没有 `open_checks` 的 round（`graph/detail` 的 round 为空）；`workflow/driver-read` 的 `last` 是第二段任务的推进/等待，不是目标 gate；第二段任务完成后目标 gate 才打开检查。stage gate 的通过不提前满足目标 gate。每个阶段的骨架都带自己的 stage gate；缺 gate 的模型输出只进审阅 finding/候选卡，不是入图校验拒绝；平台调度断言不变。
- 具名变异：把 `workflow.ts:1946` 的 `scope.kind !== 'stage'` 去掉，并把这条 gate 选择移到 `unfinishedWork.length > 0` 之前（让目标 gate 也走新前置分支）；本行在“第二段未完成就开目标 gate”处红。
- 期望来源：v3 5.2“目标 scope 的 gate 规则不变。Goal 完成仍检查全部必需任务和目标 gate”；B-D4；5.1.3。
**G-05 规划答案 100 KiB 与 256 KiB 边界；文字退路 16 KiB** （B-D5、C-1、PLS-34；v3 5.5） 入口：`workflow/driver-start`/`workflow/advance`；`messages/inbox`（`:500`）/`messages/body`（`:503`）或 `queries/read`（`:517`）/`queries/answer`（`:522`）读规划 Query 的答案；`plans/proposal`（`:485`）读候选；Host 消费循环 `consumeIdle`（`host.ts:1825`）。
- 前置：F1（已有参谋线和规划 Query 的消费路径）；规划线的 `perResponseTokens = planningOutputReserveTokens(contextWindowTokens)`（唯一正本），窗口本身不改；完整输入 + 预留装得下（装不下走现有 `ContextCapacityExceeded`，不把窗口改大来迁就 131072）；脚本让参谋在本轮调用 `submit_plan_round`，表单里放一个 100 KiB 的 `instruction`；另有两次运行分别把拼出的 `answer.answer` 调到正好 262,144 字节和 262,145 字节（按 UTF-8 字节手算 filler，不按字符数）；再有一个没有提交工具的规划轮，最终文本是 16 KiB + 1 字节；最后做规划轮注记变体、文字退路回复和秘书请求轮对照。
- 步骤：1）发 `refine:`，Host 消费，参谋提交 100 KiB 的规划答案；2）读 `queries/answer` 和 `plans/proposal`；3）同法提交正好 256 KiB 的答案；4）同法提交 256 KiB + 1 字节的答案；5）没有提交工具的规划轮让最终文本是 16 KiB + 1 字节；6）采用/收尾时读回复正文；7）规划轮分别写 `convention`（stage 锚点）/`understanding` 注记；8）文字退路的规划答案、N 的 `text` 轮和普通咨询各读一次回复正文；9）再看秘书请求轮和邮箱工具表。
- 观察量：100 KiB 和正好 256 KiB 都被接受，`queries/read` 的 `answer.answer` UTF-8 字节数等于提交值，候选是 `candidate`，`answer.bodyRef.digest` 与 `answer.answer` 的 sha256 一致；256 KiB + 1 字节的工具体提交得到 `capacity`（不产生答案/候选）；没有提交工具的那一轮超过 **16 KiB** 时观察器给 `too_long`（普通 Query 落 `gap`、不产生答案），不是 256 KiB。采纳/收尾时回复正文 ≤16 KiB 且按 `planningReplyTextOf` 派生：规划答案能解析出合法 `plan`/`questions` 时取 `summary`；`plan_round` 的文字退路保留已保存原文（不是解析出的 `summary`，也不复制答案全文），`plan_review` 文字退路解析不出不造回复；N 的 `text` 轮回复取原文本；普通咨询答案不变。规划轮 **stage 锚点 `convention` 写入成功**（该轮 `prepared.requestEffectiveGoalId` 是 null，Goal 只能来自 `manifest.goal.ref.goalId`）、同一 Query 的 Goal `understanding` 被 `forbidden`；秘书请求轮仍成功；邮箱工具仍没有。边界是 `>` 不是 `>=`：正好 262,144 字节通过。
- 具名变异：把窗口改大来迁就 131072（不从 `planningOutputReserveTokens(contextWindowTokens)` 取预留、不改 `contextWindowTokens`）；本行在“`fits` 失败、请求发不出/两格预留不对”处红。
- 期望来源：B-D5；C-1；5.3.5 的定值表与 #2/#3；5.2.7（4）/5.2.8 的注记准入；G-N2/N1 的窗口公式；v3 5.5“答案形状不变，数组里只放这一段”；设计 `:183` 的 256 KiB 建议。手算：256 × 1024 = 262,144 字节；131,072 token × 2 bytes/token ≈ 262,144 字节。
**G-08 导出失败进这次采用的“请知悉”（人工采用也发）** （C-9/N12） 入口：`plans/apply`（`:484`）做人采用；`main/read`（`:631`）读“请知悉”；`goals/read`（`:473`）读活动计划；真实文件系统读任务书目录。
- 前置：F5；Host 设置给了 `settingsDirectory`，其中 `taskbooks` 是一个**普通文件**（不是目录），使导出真实 `ENOTDIR`；目标有一个可采用的候选/首份计划；人调用 `plans/apply`；另加隔离失败一支（导出根命中工作区根）。
- 步骤：1）人 `plans/apply` 采用；2）读返回值；3）`main/read` 读通知；4）直接读 `settingsDirectory/taskbooks` 路径；5）确认没有新卡；6）隔离失败支同法跑一遍。
- 观察量：`plans/apply` 返回 `committed`（不是 `failed`/`busy`）；`goals/read.activePlanRevision` 前进；`main/read` 的 notices 里恰好 1 条 `plan_adoption`，`summary` 含 `任务书 <stageId> 导出失败：未写出（<path>）；采用不受影响，不自动重试`（或 `导出不完整`，按文件现状）；`decisions/queue` 没有新增“导出失败”卡；文件确实不存在。**人工采用也出这条通知**，不是只有自动采用才出。隔离失败也写同一条“未写出”行。若同一失败出现在候选卡，`decisions/candidate-card` 的 `exportRead` 也要有这条失败行。
- 具名变异：让 `plan_adoption` 通知源不调 `exportBooks`、只写已存在的路径（或把导出失败只写 Host 日志）；本行在通知没有失败行处红。
- 期望来源：C-9/N12“任务书导出失败要让人知道：写进这次采用的‘请知悉’；人自己采用时也发这一条。不重试”；设计 `:193`；5.3.4；6.4.3；N2/PLT-22。
**G-12 下一段 Run 在跑时第一段 gate 仍能先过** （B-D4；v3 `:131`） 入口：`workflow/driver-start`/`workflow/advance`；`tasks/query`（`:486`）；`executions/read`（`:530`）；`graph/detail`（`:614`）。
- 前置：F0；第一段任务全部 `satisfied`；第二段**已经细化**，第二段的一个任务有正在跑的 Run（`entered`，模型请求按住）；第一段有 stage gate。
- 步骤：1）让第二段 Run 在跑并按住；2）推进目标；3）读第一段 gate；4）读第二段 Run；5）放开第二段 Run。
- 观察量：第一段 stage gate 仍能 `open_checks`/`satisfied`，不被第二段在跑的 Run 挡住；第二段 Run 没有被取消、重开或改写 `claim.planRef`；两个步骤都在推进（gate 检查和 Run 观察/检查），不是二选一。gate 选择不读“全目标有没有在跑的 Run”。每个阶段的骨架都带自己的 stage gate；缺 gate 的变体作为审阅 finding/候选卡，不是入图校验拒绝；平台调度断言不变。
- 具名变异：在阶段 gate 的选择条件里加一条“`base.activeTaskIds` 为空才选”；本行在第二段 Run 在跑时 gate 不被选处红。
- 期望来源：B-D4；5.1.3 的“第二段已经细化，Run 正在跑”；v3 5.4“有任务在跑时也可能触发……上一阶段最后几个任务在跑时，提前细化下一阶段”；v3 第 9 节第 17 条。
**G-13 Host 设置 `plan-loop-limits/save` 的校验、持久化、读取和生效** （PLS-26/C-30） 入口：`plan-loop-limits/save`（`host-settings.ts:1271`-`:1290`、路由 `:1573`）；`snapshotOf`（`:762`）；`workflow/advance` 的偏差判定（`deviationsOfGoal.input.limits`）；`executions/read`（`:530`）看已领取 Run 的预算。
- 前置：F0；Host 设置文件可写；一个合法的 `PlanLoopLimitsV1`；任务 A 带 `sizeClass:'small'`，增长量可控；另有一个已领取、尚未结束的 Run。
- 步骤：1）保存非法值（缺键、非正安全整数、`taskTwoTimesTokens[k] < taskReminderTokens[k]`、`lineMultiplier < 1`）→ 读结果；2）保存 `null` → 读 `snapshotOf`；3）让 `persist()` 失败 → 读内存值和磁盘；4）让 `notify()` 失败 → 读返回文案并重试同一保存；5）保存合法小值 → 读 `snapshotOf.saved/effective/defaults`；6）让下一次偏差判定用新值触发；7）读已领取 Run 的预算。
- 观察量：非法值返回 `invalid`、不落盘、`effective` 不变；`null` 恢复默认并发布 `saved:null`/`effective:defaults`；`persist` 失败返回 `unavailable`，内存值回滚、磁盘仍是旧值；`notify` 失败返回“已保存但 Host 未确认，重试同一保存”，不写第二份记录；`snapshotOf` 的 `saved`/`effective`/`defaults` 三态可读；下一次偏差判定立即用新值（例如降低 2 倍线后 A 触发 `growth`）；已领取的 Run 保持旧预算，不被新设置改写。页面不测（归 E3）。
- 具名变异：让 `plan-loop-limits/save` 跳过校验直接写内存（或 `persist` 失败后不回滚）；本行在“非法值被保存/persist 失败后内存仍是新值”处红。
- 期望来源：PLS-26/C-30；10.3 的设置段；`host-settings.ts:1271`-`:1290`、`:762`、`:1573`；7.5 的 `DeviationInputV1.limits`。
### 15.7 分组和条数
- v3 第 9 节 1–21：21 条（PL-01…PL-21）；v4 第 15 节 22–53：32 条（PL-22…PL-53）；规格新增：13 条（A-01/A-02/A-03/A-05/A-06/A-09/A-10、G-01/G-02/G-05/G-08/G-12/G-13）。合计 66 条，其中设计行 53 条。PL-52/PL-53 的“已有代码首案审一次、空工程不审”判定和实现归 6C L7（§15.5、§19.1），本片不另加首案判定/字段。
- 按主题：系统轮/触发/合并/阶段 gate（PL-01、03、05–08、16–18、21；G-01、G-02、G-12）；答案工具/长度（A-01、A-02、A-03、A-05、A-06、A-09、A-10；G-05）；目标循环/审阅/诊断（PL-02、04、09、22–29、41–45、52–53）；偏差/停因（PL-11–13、32–38、48、51）；任务书/导出/通知（PL-14、46、47、49；G-08）；读数/并发/重启（PL-07、12、19、20、31、41）；Host 设置（G-13）。
### 15.8 清单 B：不会发生的错误（唯一一份）
只列 11 条最容易被误写成防御的情况；其余同类（同模块并发、规划期注记、持租约 Host、改库造环等）按现有类型/门/记录保证，不写测试。

| 情况 | 为什么不会发生 / 不处理 | 依据 |
|---|---|---|
| 同一系统轮被发两次、开两轮 | 同一发送身份 + 同一请求号 → 同一 messageId；同一消息只开一对 Query | `mailbox-service.ts:1232`-`:1253`；`query-job.ts:104` |
| 审阅结论用到别的候选 | `planreview:` 请求号/Query 号含 `proposalId` + `proposalRevision` | 设计 `:222`、`:574` |
| 系统轮循环开轮（自己的消息叫醒自己） | 登记在发送前；下一趟读到 gap 不变、回执已提交就跳过，不是循环；不写防自唤醒守卫 | 设计 `:228` |
| 自动采用跳过审阅 | 目标循环是唯一入口；`adopt` 行要求 `review.verdict === 'pass'` | 6.1.3 |
| 两个候选同时被采用 | `expectedProposalRevision` + `meta.expected` 的 Goal/Proposal 版本；`plan-adopt:` 固定身份重放同一回执 | 6.1.4；`plan-machine.ts` 的 adoption guards |
| 审阅正文超过 16 KiB | 工具写前按同一限拒绝；文字退路由解析器判 `too_long` | `query-observation.ts:50`；`query-record-codecs.ts:578`；6.3.3 |
| 导出失败挡住采用 | 设计明说不挡；失败进“请知悉”，不回滚/不重试/不新造卡 | 设计 `:193`；6.4.3 |
| 行数读数把别人的改动算进来 | 只取这个 Run 的 Kernel `edit` 调用，不读工作区快照 | 10.3 |
| 没有参谋时把偏差发给秘书 | 统一 `goal_cause` code `no_adviser`；`adviser_creation` 只在 7D2 | M-4；103-1 |
| 阶段超线挡住采用 | 只提醒；阶段读数不接采用判断 | 设计 `:224` |
| 同一个目标并发两段细化 | 一趟只发一条；下一条要等这次登记被叫醒；采用后版本变，旧候选 stale | 5.5.4 |

**明确不做：** 不为这些情况加防御、加测试、加记录。
## 18. 不做
设计 §11 的 MVP 之后项、以及本规格明确不碰的事，只列在这里，不写成任务：

| # | 不做 | 依据 |
|---|---|---|
| 1 | 按标签发布产物（方案 A 不依赖它） | 设计 §11 |
| 2 | 第二次返工就开参谋轮（第二次仍是 7C-2 的通知） | 设计 §11、§7.1；决定 42 |
| 3 | 平台算下游影响范围（平台给差异，模型给判断） | 设计 §11、§7.3；`slice-6-SPEC.md:428` |
| 4 | 重叠模块有没有约定的诊断 | 设计 §6.2、§11 |
| 5 | 自动换线 | 设计 §11、§9 |
| 6 | 架构书的可视化 | 设计 §11.1 |
| 7 | 任务硬刹车、目标上限、每档行数参考、阶段嵌套 | 设计 §11、D6 |
| 8 | 只读报告见证（B06）的做法（相邻但不在本设计；MVP 门槛前另开片） | 设计 §11 |
| 9 | 真实的参谋线、审阅线怎么建（7D2 的 `role_line_add`、内建 binding、Query profile、只读工具） | 设计 §13 第 5 步；本规格只写依赖 |
| 10 | 真实模型验收（细化、审阅、偏差、替代任务的限定场景） | 设计 §13 第 6 步；本规格只写依赖 |
| 11 | 改目标、验收、范围、在跑切换、加预算的做法（6C L13） | 设计 §7.4、§14；决定 102-4 |
| 12 | 正式架构变更的做法（8C 两档都出卡） | 设计 §7.4、§14 |
| 13 | 执行结果审阅的改法（第 9 片） | 设计 §6.3；D8、D15 只管计划候选和首个方案 |
| 14 | 为“不会发生”的错误加防御或测试 | 本规格 §15 清单 B；`reuse-and-impossible.md` |

---
## 19. 依赖和 7D1 的串行落地
### 19.1 依赖（只写依赖，不写做法）

| 依赖 | 用到哪 | 没有它时 |
|---|---|---|
| 7C-1 L1 | 任务书展开、已执行定义冻结、计划来源和影响（设计 §13 第 3 步） | PL-1 的“已执行任务不改定义、用替代任务”没有底 |
| 7C-2 L2 | PL-2 的偏差入口和并发顺序 | PL-2 不开工 |
| 第 2 步（三个读数） | PL-2 的 2 倍线要增长量和行数（设计 §13 第 4 步） | “过 2 倍线”只能做行数一半 |
| 7D2 `role_line_add`（加审阅者）和内建 binding | 真实的参谋线、审阅线；PL 的端到端 | 审阅线只能靠外部配置或人手动建；没有审阅线时按 §7 转候选卡，不跳过 |
| 7D2 L35 | 执行者上报的收件人（7D2 前用 `resolveDutyRecipient`） | PL-2 的“执行者上报”只能走旧收件人 |
| 6C L13 | 改目标、验收、范围、在跑切换、加预算 | 这些只出依赖说明，不在本规格做；D14 不改变这一条 |
| 6C L7 | PL-52/PL-53 的“已有代码首案审一次、空工程不审”判定和实现（设计 `plan-loop-design.md:255`） | 这两行只能验到第一版方案的提交/采用路径；“审不审”的触发判不了。保留设计原归属，本片不另加首案判定/字段 |
| 第 8 片 8C | 正式架构变更（两档都出卡） | 动到正式架构时按 8C 的卡，不在本规格做 |
| 第 9 片 | 审阅线可复用；执行结果的审阅不变 | 计划候选审阅可用；执行结果审阅仍归第 9 片 |
| 7D1 | `host.ts`、决定契约、决定读模型、提示词包（§19.2） | PL-1 与 7D1 共享文件串行落地，见下 |
### 19.2 7D1 共享文件的串行落地
四个共享面必须串行落地，不能两片各改一半再合；建议 7D1 先落，PL-1 在它的落地树上 rebase。
- **`host.ts`（本树 2,344 行）。** 7D1 先落角色线共享基础、`WorkLinkTarget` 的 `goal`/`project`、项目主体卡源/请知悉、`role-scope:` 占位；PL-1 在它的落地树上**必须改函数内部的既有调用点**，不能只在文件尾部追加：`consumeIdle` 的 Host 系统轮消费（`:1855`、`:1880` 附近）、`adoptInitialization`/`plans/apply` 的初始化采用（`:2273` 附近）、以及 `:2307` 附近的关闭等待。允许的最小改动就是这些调用点：把系统轮消费接进 `offer.kind` 分支、把采用导出接进 `adoptAndExport`、把目标循环启动/重建接进启动路径、把导出的异步工作纳入 Host 关闭等待；每项仍是一个新函数、集中注册，不重命名 7D1 的方法。7D1 若后落，rebase 不得重排 PL-1 的等待登记和唤醒订阅；两片仍按共享文件串行，先跑现有测试再改自己的最小块。
- **决定契约（`goal-decisions.ts`、`decision-contracts.ts`）。** 7D1 拥有 `DecisionSubjectV1` 项目主体、`notifyProject` 和项目卡源；PL-1 不新增 `DecisionSourceV1.kind`、不新增主体种类。候选卡复用现有 `candidate` 源，审阅结论走答案/消息；候选号/版本/诊断/审阅结论放卡的内容/引脚，不放进 subject。两片都不改 `DecisionSubjectShape` 字段名；PL-1 若必须加契约字段，先停、交 lead。
- **决定读模型（`decision-read-model.ts` 及读口）。** 7D1 先落项目主体分组/排序/请知悉读口；PL-1 之后加候选卡和审阅结论读法，复用 `decisionSubjectKey`、`decisionSourceKey`、`notice-position`，不另写“按目标找卡”读口、不新建卡表/计数/水位；诊断和结论从候选/Query 答案读，不从读模型反推。读口测试都经公开路由，不读库。
- **提示词包（`pack.json`、`strings.json`、`templates/`）。** 同一时刻只有一个片拥有。7D1 先落职责/角色线条目；PL-1 rebase 后只加规划、审阅、参谋技能和三种答复条目，不改 7D1 的条目和版本号。每条目带自己的 `version`，改文字就升版本，不手改生成物；主仓有 `runtime-assets.json`/哈希重生成就按主仓步骤重跑。两片的提示词测试分别过，合入前跑全量和规模批。
- **提交顺序。** 后落的一片先跑共享文件的现有测试再改自己的块；两片不得在同一提交里改同一共享文件的不同段落。

## 21. 规格新定的（总表）
本节是全文唯一的“规格新定”总表；ID 沿用原编号，冲突时在“内容”里写明谁取代谁，落点写节号。

| ID | 内容 | 落点 | 依据 |
|---|---|---|---|
| N1 | **只有规划答案 256 KiB**：`submit_plan_round` 的 `answer.answer` 和持久答案 codec；`submit_secretary_answer`/`submit_initial_*`/`submit_plan_review` 和所有回复、规划轮文字退路 16 KiB；Host 系统轮消息正文和它的 Query `question` 64 KiB；普通消息/普通 Query 的 `question` 16 KiB；**规划轮输出预留 = `min(131072, ⌊contextWindowTokens/2⌋)`（唯一函数 `planningOutputReserveTokens`，请求侧和 Host 侧同用），普通 16384；不改窗口本身**。**取代 B-D1 的“三处一起改”和第一轮 B-D5 的“消息/问题 256 KiB”**。 | 5.2.7、5.3.5 | 设计 `:183`；C-1；B-D5；spec-rulings-2/3 |
| N2 | 任务书目录 `<settingsDirectory>/taskbooks/<projectId>/<workspaceId>/<goalId>/…`，文件名含目标、现有的唯一 `planId`、阶段和 `planRevision`，id 用 `encodeURIComponent`；同一候选重复导出覆盖自己的文件，不加索引；没有设置目录就跳过。**导出根和每个工作区根用 `isPathWithin` 做实路径隔离检查**：命中（等于或落在工作区根内）整批 `failed`、不写；不能只凭 `promptsRoot` 通过就跳过；`skipped` 只给没有设置目录。 | 5.3.4 | 设计 `:190`-`:192`、`:614`；PLS-24；PLT-22 |
| N3 | `RuntimeTask.estimatedLines` 可选、正整数安全整数；缺省=未知（不是 0）；随 `RuntimeTask` 冻结。 | 5.3.2 | 设计 `:176`、D3；`plan-task-basis.ts:62` |
| N4 | 分段合并规则：段集合 = segment 的 stages ∪ tasks 的 stage；按 taskId/obligationId/边键替换或追加；不删任务、不改 instruction。合并器接两种计划共有的结构；调用前剥掉 segment 的 `origin`。结果保留 base 的 `reviewAdmissionProtocol`；`origin` 只在 base 是已采用 snapshot 时沿用，base 是候选 draft 时不带；`planId`/`planRevision` 取 segment 的新值；未来采用由 compiler 回写 `source.origin`，不重建来源证明。 | 5.1.2 | 设计 `:121`、`:609`；`initial-plan.ts:112`；`plan-validation.ts:494`；`plan-commit-compiler.ts:393` |
| N5 | 后续段每段至少一条必需、活动、`plan_only` work 占位；也允许目标级占位；目标级占位用 `taskId` 进 `refine:` 请求号。 | 5.1.1、5.1.4 | 设计 `:121`、`:1921`-`:1922` |
| N6 | gap 等待的 `reasons` 加 `plan_only:<stageId>`（目标级为空），`recordKinds` 加 `SessionMessage`/`PlanProposal`；触发加在目标级等待结果的共同收口。 | 5.1.4 | 设计 `:121`、`:228`；v3 §5.4 |
| N7 | 系统轮发送身份固定 `{kind:'system', id:'host:plan-round'}`（`SYSTEM_ROUND_ACTOR`）。本规格五个系统轮（`refine:`/`deviation:`/`planreview:`/`planfix:`/`planresume:`）都经 `sendSystemRound(systemRoundContext(...), request)` 发送，**偏差发信也在内**；`workflow:auto-rework` 只留普通返工和 `overlap-note:` 等非系统轮。 | 5.2.5、7.1.4 | 设计 `:139`；`mailbox-service.ts:1232`；PLT-05 |
| N8 | 请求号原样作为消息正文第一行；消费按发信身份 + 收件线 duty + `followupOf` 分支，不按前缀解析。 | 5.2.6 | 设计 `:127`、`:139`-`:140`；M-1 |
| N9 | 续轮冻结 `prev.repliesToMessageRef ?? lineage.rootMessage`（6.3.1 来源链）：继承原 Query 的 `repliesToMessageRef`，原 Query 没有（例如原 Query 是 planfix 轮）才用链上最初的执行者 M，不是复制当次 `planresume:` 的 `followupOf`；邮箱检查接受 `sourceMessageRef`（R）或 `repliesToMessageRef`（M）。 | 5.2.3、5.2.4、6.3.1 | 设计 `:145`、`:327`；PLS-06/PLT-07/C-33 |
| N10 | `planresume:` 请求号带原规划轮 `QueryJob` 号；一轮的卡都答完才发。**正文/`question` 只带请求头 + `originalQueryRef`（原规划轮的源消息引用）；原问题全文和逐卡答复在准备输入时装配**，不把答复正文塞进保存的请求正文。 | 5.2.2、5.3.5 #8 | 设计 `:612`、`:143`；PLT-13 |
| N11 | 规划轮可写六种 general 注记，`withdraw:true`，不含 `understanding`/`repair`；参谋或秘书的 `intervention_planning` 轮都适用。**注记准入按“可信规划来源 + duty”判，不看答案工具形状**：`plan_round`/`plan_review`，以及 Host 系统 `action_request` 的 `text` 轮（N 的 `overlap-note:`）都进 planning；`text` 轮仍不挂 `submit_plan_round`，邮箱/建成员仍只认秘书请求轮。 | 5.2.8 | 设计 `:184`；`secretary-note.ts:13`-`:29`；PLT-04 |
| N12 | 每个涉及的 stage 导出一份；采用/转卡都导；失败在“请知悉”/卡上多一行，不改结果。 | 5.3.4、6.4.3 | 设计 `:190`-`:194` |
| N13 | 骨架每段有一条阶段 gate 及其义务（模型写、审阅者查）；平台不新增入图 gate、不校验每段都有 gate，有 gate 就按现有归约验收；调度按 B-D4。 | 5.1.3 | 设计 `:121`、`:179` |
| N14 | 没有参谋时 PL-1 不发秘书；用现有 `goal_cause` 卡源（code `no_adviser`，affected=[Goal pin]）给人；专用 `adviser_creation` 归 7D2。 | 5.1.4、7.1.2 | 设计 `:123`、`:503`；M-4 |
| N15 | 系统轮“同一版一次”不强制回执读；先用 `lookupHostSendCommit` 可省一次空写，`undetermined` 照发。 | 5.2.2 | 设计 `:578` |
| N16 | `RuntimeTask.sizeClass?` 四档（`small`/`medium`/`large`/`explore`），占位也带；没有档位只累计、不提醒。 | 5.1.1、5.3.1、10.3 | v3 §4.3 |
| N17 | 上下文增长量 = 相邻请求输入上涨之和 + 最后一次输出；第一次输入不计；`usage.omitted>0`/`complete:false` 标不全。 | 10.4、13.2.2 | v3 §4.2 |
| N18 | 任务 2 倍线分 `growth`（sizeClass）和 `lines`（estimatedLines）两种偏差，各自请求号；硬停因存在时软线不发轮。 | 7.1、7.2、10.3 | v3 §4.3；v4 §10 |
| N19 | 阶段线 = 预估行数合计 2,000 行或累计 0.6B token；只提醒、可配置，代替 v3 的 1,500 万增长量。 | 10.3、13.2.4 | v4 §10 |
| N20 | 64 倍是换算/校准（282 次运行实测），不是仅供界面展示的常量；0.6B ≈ 940 万增长量。 | 10.5、13.2.4 | v3 §4.2；v4 §10 |
| N21 | 合并函数用 `mergeStageRefinement`；1:1 沿用 taskId 改 `request_execution`，1:many 原任务 `superseded`、新增任务。 | 5.1.2、5.2.4 | v3 §5.5 |
| N22 | 阶段结束“请知悉”写 token/增长量/行数、完成任务、返工次数、下一阶段档位；不挡工作。由 `plan_notice` 投影源按 stage gate 已终结验证轮出 `stage-end:<planId>:<planRevision>:<stageId>`，不靠 Session `notify`、不新增记录（PLT-16）。 | 5.8、6.4 | v3 §5.8 |
| N23 | 触发在目标级等待结果的共同收口附加 `refinement`；等待标记 `plan_only:<stageId>`/`plan_only_task:<taskId>`；登记 → drain → 找参谋 → 发 → 合并依据。 | 5.1.4、5.5.1 | v3 §5.4 |
| N24 | 无参谋统一 `goal_cause` code `no_adviser`，不发秘书；`adviser_creation` 只在 7D2 说明里。 | 5.1.4、7.1.2、7.2 | M-4；103-1 |
| N25 | 阈值进 Host 设置（`planLoopLimits`）：本片补齐现有设置体系内的校验、持久化、读取和生效（`plan-loop-limits/save`，`saved/effective/defaults`，注入偏差判定）；E3 只接页面，不新建设置记录。 | 10.3 | v4 §10；设计 `:370`；PLS-26/C-30 |
| N26 | 目标层只累计、在目标栏显示、不设默认上限；目标完成仍按现有规则。 | 5.9、10.5 | v3 §5.9 |
| N27 | 每轮候选读旁加规划问题续轮：用问题 reader 枚举身份、经现有决定答案读取取已存答复；**只收有本闭环来源的 `intervention_planning` 问题组**（其他初始化/普通 `initial_coordination` 问题保留原读和原流程，不因没有来源拒绝整条候选读），按原 QueryJob 分组；`allAnswered && !resumeMessageExists` 才登记 `plan_resume_pending` 后发 `planresume:`；回答读取失败原样返回，不折成已答/未答。 | 6.1.2 步 3b、6.1.6 | 设计 `:143`-`:145`、`:230`；PLT-07/08/14 |
| C-1 | 审阅轮和规划轮答案都走提交工具：审阅轮冻结 `submit_plan_review`；规划轮冻结 `submit_plan_round`（一个工具，`answerKind:'plan'|'questions'`）；写文字只作 FA 退路。**取代第一稿“审阅轮只能用同形 JSON 正文”**。 | 5.2.7、6.3.3 | C-1 裁定 |
| C-2 | 审阅答案形状 `{schemaVersion:1,kind:'plan_review',verdict:'pass'|'fix',findings:[{taskId:string|null,text:string}]}`；`findings` 元素形状是规格新定。 | 6.3.3 | 设计 `:247` |
| C-3 | 请求号只有一个正本：`systemRoundRequestId`/`systemRoundOfText` 放 `src/contracts/plan-round.ts`；`planreview:`/`planfix:` 不另写拼接或解析，便捷名字只能做无规则薄包装；答案纯函数放 `contracts/plan-review.ts`。 | 5.2.2、5.2.6、6.3.1、6.3.3 | 设计 `:222`、`:247`；M-1 |
| C-4 | 采用步骤 `WorkflowCalls.adopt_plan`，`requestId=plan-adopt:<proposalId>:<revision>`。 | 6.1.4 | 设计 `:217`、`:219` |
| C-5 | 发系统轮请求是 `WorkflowCalls` 的成员，复用 `SessionMailboxPort['sendMessage']`。 | 6.1.4 | 设计 `:222`、`:228` |
| C-6 | 等待依据含 `Session`，让晚建的审阅线能叫醒目标。 | 6.1.5 | 设计 `:228`、`:230` |
| C-7 | 采用通知类别 `plan_adoption`；阶段结束/偏差“不改计划”另用 `plan_notice`（C-35），两者都在现有 `NoticeItemV1` 投影机制内。 | 6.4.1 | 设计 `:259`、`:441`；PLT-16 |
| C-8 | 不加“按项目的有序索引”；通知源按目标读 `PlanRevision`，`position` 取同一次接受的 `PlanRevisionAccepted` 事件提交游标（记录自身不带 `since`；事件只用于 `position`）；事件读不到 `unavailable`。 | 6.4.2 | 设计 `:441`、`:259`；PLT-17 |
| C-9 | 导出失败不只写日志：写进这次采用的 `plan_adoption` 通知（`summary`），人自己采用也发；不写卡、不重试、不回滚。**取代第一稿“一行 Host 日志”**。 | 6.4.3 | C-9/N12 裁定 |
| C-10 | 任务书目录归 §5.3；通知/卡只写路径和状态。 | 6.4.3 | 设计 `:614` |
| C-11 | `latestAgentCandidate`/`completedFixes`/`checks`/`planCandidates`/`planFixRead`/`acceptedCandidatesOf`/`exportBooks` 七个窄读，都做成可选依赖；真实装配必接，缺依赖走 `unsupported`/`unavailable`，只有枚举完成且确实没有才是空；`latestAgentCandidate` 和候选卡按 6.3.1 来源链（`planfix:`/`planresume:` 两种首行）排除已有后继的旧候选；`planCandidates` 只收有本闭环来源的问题组；不新造“找候选/找卡”的扫描。出口契约见 6.7.1。 | 6.7、6.7.1 | 6.1/6.2/6.4 |
| C-12 | 诊断读不到检查覆盖：`diagnosis` 传 `null`（不是空数组），不判自动采用，转卡，`reason` 写 `diagnosis`。 | 6.2 | 设计原则 5 |
| C-13 | `busy`/其他采用拒绝的出口在 6.1.4；判断点仍只有一处，不把采用出口的 `busy`/其他拒绝塞进纯函数。 | 6.1.3、6.1.4 | 设计 `:263` |
| C-14 | `reviewer` 加进 duty 联合；审阅线用现有建线入口。 | 6.3.1 | L35；设计 `:251`、`:485` |
| C-15 | 审阅输入模板 id `plan-review-input`、七槽、正文见 6.3.2；`candidate` 给这一版新写内容的完整任务书、义务和依赖差异，`plan` 给已采用目标/骨架/段的依据，模板明确只审改动、不重审已采用内容。**64 KiB 只约束保存的请求正文（`planreview:` 消息和 `question`），不约束候选槽**；完整候选随准备输入装配，装不下走现有容量出口，不因候选大拒绝审阅轮。 | 6.3.2 | 设计 `:245`、`:249`；PLT-01 |
| C-16 | 没参谋线时审阅 `fix` 的出口转卡，不造 `adviser_creation`。 | 6.3.4 | 103-1；设计 `:503` |
| C-17 | 审阅/规划轮答案形状冻结在 `QueryJobIntentV1.execution.answerShape`（`plan_round|plan_review|text`，只 `intervention_planning`），创建时由 `planningAnswerShapeOf` 按发送身份 + 收件 duty 算，准备复制到 `manifest.answerShape`，启动只读清单；不解析正文/请求号。**读取侧复用 QueryRun→QueryJob→manifest 链：形状读 Job intent/`manifest.answerShape`，不往 QueryRun 复制字段；Goal 读 `manifest.goal.ref.goalId`，计划读 `manifest.focusPlan.ref`**。 | 5.2.7、5.2.8、6.3.1 | C-1；`query-execution.ts:373`-`:377`；PLT-03 |
| C-18 | 规划轮一个 `submit_plan_round`，根对象带 `answerKind:'plan'|'questions'` 和可选 `reason{text,affectedTaskIds?}`；plan 复用 `submit_initial_plan` 的 `plan` 子表单（带 `sizeClass`/`estimatedLines` 和已有的 `replacedByTaskId`；顶层带已有的 `inputRequirements`），questions 复用 `submit_initial_questions`；plan 正文 256 KiB；接受后屏障结束 Turn；`reason` 从表单原样到候选；**`answerProblems` 的 `plan_round` 分支要求 `summary` 非空且 ≤16 KiB UTF-8**；回复按 5.3.5 的冻结形状派生：规划答案能解析出合法 `plan`/`questions` 时取 `summary`，`plan_round` 的文字退路保留已保存原文；不复制计划全文。 | 5.2.7、5.3.5、5.3.1 | C-1；设计 `:247`、`:183`；PLS-03/PLT-12 |
| C-19 | 长度只认真实发送身份：`sessionMessageTextBound({sender,part,original})`，Host 系统轮（`isSystemRoundSender`）的 `message` 部分 64 KiB，`response` 部分和普通消息一律 16 KiB；规划 Query 的 `question` 按 `execution.kind==='intervention_planning'` 到 64 KiB（`planresume:` 只放请求头 + 原 Query 引用）；规划工具答案和持久记录 256 KiB；**不用 `followupOf` 判**。 | 5.2.7、5.3.5 | C-1/B-D5；PLS-15；PLT-13 |
| C-20 | 工具表不一致仍 `forbidden`：准备和启动用同一个 `queryAnswerShapeOf`，启动和 `promptSet.toolNames` 逐项比；不退回文字。 | 5.2.7 | C-1；`query-execution.ts:373` |
| C-21 | 审阅读取四态 `not_sent`/`waiting`/`decided`/`terminal_invalid`，按 Query 实际状态分支，不再压成 `null`；终态无合法结论只转卡 `review_invalid`，不重发、不重审。 | 6.1.2 步 5、6.1.3 | PLS-10 |
| C-22 | 候选 `card`/`wait`（含 `wait: fix`、`skipped` 的已发返修）不立刻返回整个 Goal 的 `waiting`：继续同一次选任务，能推进就返回 `perform`；没有其他可推进步骤才合并候选依据返回 `waiting`；返修只在没发时选发送步骤，已发不重发、不挤掉别的任务。 | 6.1.4、6.1.5 | 设计 `:296`、`:298`；PLS-11/PLT-06 |
| C-23 | 候选卡后端事实是 tracked 公开平台方法 `readCandidateCard(goalRef, proposalRef)` + `core-routes.ts` 冻结路由 `decisions/candidate-card`，返回 `{card: DecisionCardV1, diagnosis, exactReview, exportRead}`；内部 `candidateCardFacts` 复用候选卡组卡路径、不新造找卡扫描；`decisions/card` 原样保留；`exportBooks` 的输入同时接候选 draft；不改 `DecisionCardV1` 字段、不新造卡类型，界面归 E3。 | 6.4.1、6.7.1、15.2 G4 | PLS-18/PLT-11 |
| C-24 | 七个窄读的真实装配和出口契约（返回形状、空/缺省、失败映射）；运行时缺依赖 `unsupported`、读失败 `unavailable`，只有枚举完成且确实没有才是空；`latestAgentCandidate`/卡按 6.3.1 来源链排除已有后继的旧候选；`acceptedCandidatesOf` 返回 Goal 的全部已采用候选；`planCandidates` 只收有来源的规划问题组。注记准入/规划 resolver 另见 5.2.8（不在这七个读口里）。 | 6.7.1、5.2.8 | PLS-22、PLT-03/04/09/14 |
| C-25 | 两种收尾：系统消息 R 可以结束；**只有 `executorWait && candidateOrQuestions` 才延后回执行者 M**（`executorWait` = 要回的 M 是 `work_run`/`secretary_round` 发的且 wait 仍 open；M 取 `repliesToMessageRef ?? 6.3.1 来源链的 rootMessage`），人的普通消息和系统 R 按原收尾结束。M 只在最终回答、提案被拒、采用成功后回复，只有一个回复槽（同答案幂等，异答案 `source_stale`）。续轮冻结 `prev.repliesToMessageRef ?? lineage.rootMessage`，不复制当次 `followupOf`。 | 5.2.3、5.2.4、7.3、7.3.1 | PLT-06/10；设计 `:142`、`:143`、`:311` |
| C-26 | 重启恢复：Query 已终态但收尾未写时，**从已有邮箱遍历的源消息**算确定性 `intervention_planning` Query（不以 Session 占用定位；正常终态提交会清空占用），按已有 Query、确定性 `proposalRef` 和消息事实续做终态。`settlementOfferOf` 覆盖问题、文字回答、审阅、无答案收尾、规划答案的候选/关联收尾五类（含候选已写但 R 未关联）：补 R、补候选或只补缺的收尾；候选已写（`candidate`/`stale`）时不写第二个候选，R／人的普通消息按原收尾结束，只有执行者 M 按 `executorWait` 延后，**不重新投递正文、不重开模型轮**，不新建 Query/恢复记录。 | 5.5.2、6.1.6 | PLT-02/09；`query-run-recovery.ts:443`、`session-availability.ts:849`、`consumable-sessions.ts:212` |
| C-27 | 取消身份绑定候选 `(proposalId, revision)` 和 `runRef`、不含 Run revision；提交前用 `controlIntentRefFor`+`readControl` 读既有意图，按真实状态判：本次 `queued`（围栏已成立）或 `applied` 直接续采用，权威 `not_found` 才提交，`superseded`/`outcome_unknown`/读失败保留实际出口。恢复读取用 `acceptedCandidatesOf` 覆盖 Goal 的**所有**已采用候选（不只活动计划那一版），随后只补回复；Goal 范围仍是没结束的 Goal（`completed`/`cancelled` 不读）。不新增恢复记录。 | 7.3.1、6.1.6、8.5 | PLT-08/09/12；`workflow.ts:169`、`control-intent.ts:101`、`control-intent-machine.ts:202`、`plan-readers.ts:599` |
| C-28 | `goal_cause/no_adviser` 在现有 `readGoalDecisionCauses` 中派生：有细化需求（必需活动 `plan_only` work）或偏差需求（同一个 `readDeviationFacts` 组出 `DeviationInputV1`、同一个 `deviationsOfGoal`（`src/contracts/plan-deviation.ts` 的纯判定，输入/返回类型同文件）返回非空，覆盖 `growth`/`lines`/`budget`/`stop`；不另写只含停因的近似条件），且 `resolveDutyRecipient('adviser')` 读完为 `null`；卡源与 `selectNext` 共用同一读口（`tasks/goal-deviation-facts.ts`）和同一 contracts 纯函数（两模块引用同一正本），队列读和答卡来源重核共用判据，不新增持久 cause/字段；偏差事实/收件人读失败原样返回，不折成“没有偏差/没有参谋”。 | 5.5.3、7.1.2、6.7.1 | PLS-17/PLT-15；`goal-decision-reader.ts:78`、`:280`、`:442` |
| C-29 | `DeviationKindV1` 直接复用四值 `growth|lines|budget|stop`；`DeviationInputV1` 携带现有 `sizeClass` 和 Host 有效 `limits`；按每个 `kind` 分别判断和去重；有硬停因时软线不发轮。 | 7.5、7.1.3、10.3 | PLS-21；规格 `:1369`、`:1549`、`:1557`、`:1579` |
| C-30 | `planLoopLimits` 在现有 Host 设置体系内补齐校验、持久化、读取和生效（`plan-loop-limits/save`、`saved/effective/defaults`、注入 `deviationsOfGoal`）；E3 只接页面，不新建设置记录。 | 10.3、7.5 | PLS-26；`host-settings.ts:1277` |
| C-31 | 错误统一经现有映射：保留 `revision_conflict`/`source_stale` 的实际语义；职责读等 `ReadResult` 的 `not_found`/`not_ready` 用既有 `asRejection` 转成干预结果；不新增错误码，不使用不存在的 `stale`。 | 5.2.4、5.6、6.7.1、7.5 | PLS-30；`results.ts:16`、`intervention.ts:57` |
| C-32 | `host.ts` 保留共享文件串行和 rebase 要求；允许改 `consumeIdle`（`:1855`、`:1880`）、初始化采用（`:2273`）、关闭等待（`:2307`）附近的最小调用点；导出等异步工作纳入 Host 关闭等待。 | 5.7、19.2 | PLS-31；`host.ts:1855`、`:1880`、`:2273`、`:2307` |
| C-33 | **同一来源链跨两种首行**：`planSourceLineageOf(sourceMessageRef)` 从候选/续轮消息走链——`planfix:` 读父候选，`planresume:` 读原 QueryJob 的 `execution.sourceMessageRef`——得到 `rootMessage`、`fixRound`、`fixBase`。planresume 的 base 取 `fixBase.draft`、`basedOn` 取 `fixBase.basedOn`（没有 `fixBase` 才用活动计划 snapshot/其 `ref`）；`repliesToMessageRef` 冻结 `prev.repliesToMessageRef ?? lineage.rootMessage`；后继关系（`fixBase` 指向旧候选）用于排除旧候选和给 `completedFixes` 按轮去重。不加字段、不沿 `replaces`。 | 6.3.1、5.1.2、5.2.4、5.2.6、7.3.1 | PLS-04/PLT-06/07；设计 `:326`、`:327` |
| C-34 | **返修读取三态**：`PlanFixReadV1`（`not_sent`/`waiting`/`terminal`）由 `planFixRead` 从同一确定性 `planfix:` 消息/Query 起读，遇 `questions` 沿 `planresume:<goalId>:<queryJobId>` 继续读续轮，按最后一轮的状态和收尾得；只 `not_sent` 返回 `request_fix` 发送步骤，`waiting` 走 `wait: fix` 并继续选任务，`terminal`（最后一轮终态、收尾完成、无后继候选）转 `fix_invalid` 卡；`sendSystemRound` 的 `skipped` 显式接住、按已发读同一条 Query，不当成新的可推进动作。 | 6.1.2 步 5b、6.1.3、6.1.4、6.1.5、6.3.4、6.7.1 | PLT-06；设计 `:219`、`:222` |
| C-35 | 阶段结束和偏差“不改计划”的“请知悉”由 `plan_notice` 通知源生产（现有 `noticeSources`/`NOTICE_CATEGORIES` 投影机制内的新类别，不复用 `plan_adoption`；见 §22 C-D11）：阶段结束按 stage gate 已终结验证轮的 `since` 出 `stage-end:<planId>:<planRevision>:<stageId>`，内容按 5.8 六项；偏差按确定性 `deviation:` Query 的“回答”分支（没有 `plan` 也没有 `questions`）出 `deviation-notice:<goalId>:<requestId>`，`position` 取源 R 的固定身份 `intervention:<messageKey>:respond` 已提交回执 cursor（`readCommitByIdentity`；身份键算法见 6.4.2），不是 Query 的 `since`；内容 = 偏差事实 + “不改计划” + 这一轮答案的短文字原文（≤16 KiB，不截断）。读失败 `unavailable`、无事实不产生项、同 `itemKey` 一条；人的 `decisions/queue` notices 直接读到，不新增记录、不靠给 Session 的 `notify`。 | 5.8、6.4.1、6.4.2、6.7.1 | PLT-16 |
| C-36 | 采用通知只写“已采用”和确切审阅结论，人和自动化同一条；采用状态不写采用者。`position` 取同一次接受提交的事件游标（C-8），事件只用于位置。审阅按 accepted 候选的**接受前版本**读：`(proposalId, proposalRevision)` 取 `proposal.revision - 1`（`acceptProposalRecord` 接受后 +1，`plan-machine.ts:141`-`:143`）；候选未采用时仍用当前 `revision`。四态按这一对读（`not_sent`/`waiting`/`decided`/`terminal_invalid`），读不到写“审阅结论读不到”；事件读不到 `unavailable`，不按候选来源猜、不加读口。 | 6.4.2 | PLT-17/PLT-08（第 1 问裁定）；`plan-machine.ts:141` |
| D-1 | 任务 2 倍线分 `growth`（上下文增长量过 sizeClass 的 2 倍线）和 `lines`（`changedLines.added+deleted > 2×estimatedLines`）两条独立偏差，各自请求号。**取代第一稿“合并为 lines”**；按 v3 重判。 | 7.1、7.2、10.3 | v3 §4.3；v4 §10 |
| D-2 | 偏差 `kind` 四值 `growth|lines|budget|stop`；`SystemRoundV1` 的 deviation 臂用 `cause`，外层判别式仍叫 `kind`。 | 7.1.1 | 设计 `:291`；v3 §4.3 |
| D-3 | 返工上限和 `no_new_basis` 合为一个 `stop`，正文写停因码。 | 7.1.1 | 设计 `:286`；`task-failure.ts:948`、`:951` |
| D-4 | `<planRevision>` 取触发 Run 的 `planRef` 读出的版本；没有 Run 的 `stop` 用当前计划版本。 | 7.1.1 | 设计 `:291` |
| D-5 | 同一任务同一版**每种 kind** 最多一条；已有 `stop`/`budget` 时软线不发轮。**取代第一稿“同一任务同一版只留一条”**。 | 7.1.3、10.5 | 设计 `:291`；v3 §4.3 |
| D-6 | 行数读数写进现有 `RunActivityFactsV1.changedLines`（`edit` 的 create/replace 求和；shell/未知 → `complete:false`；**版本 2 必写必校验，旧版本记录按损坏拒绝（`unavailable` 一类现有结果），开发库和夹具按当前格式重建**；tally 版本 1→2）。**这是 `RunActivity` 范围内唯一新增的持久字段**；`sizeClass`/`estimatedLines` 是计划字段，不是同类新增。 | 7.1.1、10.3 | 设计 `:373`、`:387`、`:440` |
| D-7 | 三个读数 = 累计 token / 上下文增长量 / 改动行数；Run/任务/阶段/目标只是同一组读数的聚合层。**取代第一稿“Run 用量/阶段用量/任务改动行数”**。 | 10.1、10.4、13.2 | v3 §4.2 |
| D-8 | 阶段线 = Σ`estimatedLines` 2,000 行或阶段累计 token 0.6B；只提醒、可配置。 | 10.3 | v4 §10 |
| D-10 | `GROWTH_UNIT_TOKENS=64` + `growthUnitsOf` 是换算/校准，不是仅供界面展示；0.6B ≈ 940 万增长量。 | 10.5、13.2.4 | v3 §4.2 |
| D-12 | 平台取消的身份 = `WORKFLOW_AUTOMATION_ACTOR` + `wf-auto:` 请求号 + pin Run revision。 | 7.3.1 | 设计 `:324`、`:449` |
| D-13 | 取消后采用失败的出口：不自动回复、不重发取消；候选按 6.1 的 `busy` 保留/其他拒绝转卡；人走 `tasks/requeue`、替代任务或暂停目标。 | 7.3.1 | 设计 `:303`、`:610` |
| D-14 | 消息等候选期间不再供给 = `findPendingProposal` + `sourceMessageRef` 相同，加 message 的 delivered。 | 7.3.2 | 设计 `:328`、`:611` |
| D-15 | 系统停因 + “回答”不回复；判断写进“请知悉”。 | 7.1.3、7.2 | 设计 `:312`、`:313`、`:643` |
| D-16 | 依赖挡截按 D-V1：依赖不是领取条件，本树只有 L46 的传递闭包挡下游；不加新闭包。 | 7.2、7.7 | 设计 `:299`；B03；D-V1 |
| D-17 | 偏差判定在 `selectNext` 的选择前一步，发送走 5.2 的 Host 系统发信（`sendSystemRound`），触发在目标级等待结果的共同收口。 | 7.1.4 | 设计 `:440`、`:448` |
| D-18 | `lineDelta` 挪到 `src/contracts/line-delta.ts`，不复制（core 不能反向 import app）。 | 10.3、13.2.5 | `src/AGENTS.md`；决定 90-8 |
| G-N1 | 阶段 gate 在 `unfinishedWork.length>0` 之前选，只等 `gateCoveredTaskIds` 覆盖的必需 work；模块 gate 同一条件；目标 gate 仍在全部必需 work 满足后选；`advanceGate` 的 producer 按覆盖过滤。 | 5.1.3、5.6、5.7 | B-D4；v3 §5.2 |
| G-N2 | 规划答案 256 KiB；秘书工具/审阅工具/所有回复/规划轮文字退路 16 KiB；普通消息/普通问题 16 KiB；Host 系统轮消息和 `intervention_planning` 问题 64 KiB；**规划轮输出预留 = `min(131072, ⌊contextWindowTokens/2⌋)`（请求侧和 Host 侧同一个 `planningOutputReserveTokens`），普通 16384；不改窗口本身**；答案 256 KiB 不变。 | 5.3.5 | B-D5；C-1；spec-rulings-2/3 |
| G-N3 | 持久答案 codec 放宽到 256 KiB（只对规划答案）；普通答案 16 KiB 的语义留在普通 Query 观察器、请求轮工具、审阅解析器；消息 codec 按 `sessionMessageTextBound` 的 `part` 和本条 `sender` 选 16/64 KiB，回复一律 16。 | 5.3.5 | C-1；D3；PLS-15 |
| G-N4 | 导出失败进 `plan_adoption` 的 `summary`，读时用 `exportBooks` 探针按文件现状算 `written|missing|incomplete`；不写记录、不写卡、不写日志。 | 6.4.3 | C-9/N12 |
| G-N5 | 导出调用点统一成 Host 的 `adoptAndExport`：人首份、人后续、自动采用三处；`committed`（含重放）调一次，失败不改采用结果。 | 6.4.3 | G 报告 3 |
| G-N6 | 同一版通知按 `itemKey=plan-adoption:<planId>:<planRevision>` 去重；重放不产生第二条。 | 6.4.2、6.4.3 | G 报告 3 |
| G-N7 | 软超线不改阶段 gate 的覆盖判定：超线任务仍是必需活动 work，gate 等它自己满足。 | 5.1.3、7.2 | G 报告 1 |

---


D-19–D-22 是 v3 重判后与设计/第一稿的偏差，列在 §22，不在本表重复。
## 22. 偏差（总表）
本节是全文唯一的“偏差”总表；每条一句话，保留关键代码点和落法。没有未决项；G-D1 已由第三稿裁定解决。D-1–D-8、D-10、D-12–D-18 是规格新定，见 §21；D-9、D-11、V-1→D-V1、V-2→D-V2 在下面。

| ID | 设计怎么说 | 代码/现状 | 影响 | 落法/建议 |
|---|---|---|---|---|
| B-D1 | 设计 `:181` 说普通答案 16 KiB 不变，`:183` 说规划答案放宽；第一稿写成“三处一起改”。 | `answer-tools.ts:571` 只在 request round 存在；规划轮是普通 Query，没有提交工具。 | 规划轮写不了 256 KiB 的答案，三段 16 KiB 限制互相矛盾。 | **已由第三稿按 lead 裁定解决（C-1）**：256 KiB 只放到规划轮工具 `submit_plan_round` 和持久答案；消息、问题、回复全部按 16/64 KiB 分开，秘书/审阅仍 16 KiB（N1/C-18/C-19）。 |
| B-D2 | 设计 `:143`-`:145` 要求 `planresume:` 的 Query 来源是 Host 系统 `action_request`。 | `proveInterventionSource`（`initial-plan-answer.ts:105`-`:109`）只接受人或已放行 agent 的 `action_request`。 | refine/planfix/planresume 的答案读不出，候选永远写不出。 | 加 `systemRequest` 一支（5.2.4），其余条件不变；规格已按此写。 |
| B-D3 | 设计 `:139` 说前缀在已有请求号里，消费侧按前缀分支。 | `SessionMessageRecord` 不存 `requestId`；`messageId` 是 sender+scope+requestId 的哈希。 | 消费侧无法按前缀分支。 | 按发信身份 + 收件线 duty + `followupOf` 分支；前缀只作正文首行和发送请求号（N8）。 |
| B-D4 | 设计 `:121`：阶段 gate 按阶段验收。 | `workflow.ts:1931`-`:1945` 在全部必需 work 满足后才选 gate；后续段 `plan_only` 占位永远未满足。 | 阶段 gate 退化成“最后统一验收”，用户看不到每段结论。 | **已裁定**：阶段 gate 前移，只等 `gateCoveredTaskIds` 覆盖的必需 work；目标 gate 不变（5.1.3、G-N1）。 |
| B-D5 | 设计 `:143`-`:145` 要求续轮带原问题和已存答案；`:613` 问 16 KiB 放宽后其他消费者。 | 消息 16 KiB（`message-record-codecs.ts:124`）、Query question 16 KiB（`query-job-service.ts:84`）。 | 原问题 + 已存答案可能超 16 KiB，续轮发不出去。 | **已由第三稿按 lead 裁定解决、第四稿按 PLT-13 修正**：第一轮的“消息/问题 256 KiB”不成立；Host 系统轮消息和规划 `question` 到 64 KiB；`planresume:` 的正文/`question` 只带请求头 + 原 Query 引用，原问题全文和逐卡答复在准备输入时装配（不占 64 KiB）；回复 16 KiB；完整答案仍在 Query 答案/候选（5.3.5 #8）。 |
| B-D6 | 设计 `:123`：没有参谋时出 `adviser_creation` 卡，不发秘书。 | `DecisionSourceV1` 有 `adviser_creation` 臂，但 `src/` 没有生产者；专用卡归 7D2。 | PL-1 期间没有参谋的目标只能停在等待。 | **M-4 已裁定**：用现有 `goal_cause` code `no_adviser` 给人，不发秘书；专用卡归 7D2（N14/N24）。 |
| C-D1 | 设计 `:247`：审阅用答案工具提交，形状校验照 `answer-tools.ts`。 | 答案工具只在 request round 创建（`query-preparation.ts:356`、`query-execution.ts:528`），`answerToolsOf` 只映射两种 `executionKind`。 | 审阅者只能写纯文本，`submit_plan_review` 永不进工具表。 | **C-1 已裁定**：加 `execution.answerShape`，审阅 Query 冻结 `plan_review`，准备/启动按清单挂 `submit_plan_review`（C-17）。 |
| C-D2 | 设计 `:326`：`planfix:` 沿链往回读；`:223` 说读现有候选和 Query。 | 消息不存 `requestId`，前缀不可逆；`queryGoal.pendingPlan` 走 `findPendingProposal`，按 refKey 最小选，不是最新。 | 返修链和 3 次上限数不出；同 `basedOn` 两份候选时拿错。 | 返修写新独立候选；上一版身份从 `sourceMessageRef` 首行 `systemRoundOfText` 取，`completedFixes` 数同一 `basedOn` 上已完成 planfix 轮数；`latestAgentCandidate` 按首行后继关系排除旧候选、取最新；不改 `queryGoal`（C-11、C-D8）。 |
| C-D3 | 设计 `:263`：第 6.1 节的表是一个纯函数。 | `busy`/其他采用拒绝是“采用这一步”的结果，不落记录，纯函数拿不到。 | 照字面写要加“上次采用被拒”的持久/内存字段。 | 认可 6.1.3 + 6.1.4 的分法：判断点一处，动作仍在 6.1（C-13）。 |
| C-D4 | 设计 `:259`、`:441`：自动采用后出“请知悉”，走投影，不新增记录。 | 通知源按有序索引读；`PlanRevision` 只有按 Goal 的索引，没有按 project 的。 | 不加索引要为每个 Goal 各读一遍。 | **C-8**：不加索引；通知源按目标读，位置用接受提交游标；代价是每目标各读一次。 |
| C-D5 | 设计 `:193`：导出失败不挡采用，只提示。 | 没有通用“提示”面；`host-notices` 只发固定文案 `notify`。 | 不写清楚就静默失败。 | **C-9/N12 已裁定**：写进这次采用的 `plan_adoption` 通知 `summary`，人采用也发；不重试、不回滚、不新造卡（6.4.3）。 |
| C-D6 | 第一稿说 16 KiB 要“三处一起改”。 | `answer-tools.ts:571` 只在 request round。 | 秘书上限与规划答案混在一起。 | **已由第三稿按 lead 裁定解决**：规划答案 256 KiB，秘书/审阅 16 KiB；消息、问题、回复按 16/64 分开；持久层只放答案（N1/C-19）。 |
| C-D7 | 设计 `:139` 说不新增消息字段。 | `SessionMessageRecord` 不存 `requestId`/`execution.kind`。 | `planresume:` 的长度不能按请求号判。 | **已由第三稿按 lead 裁定解决**：按 `sessionMessageTextBound({sender,part,original})` 判，只有 Host 系统轮 `message` 部分到 64 KiB，回复一律 16；不用 `followupOf`（5.2.7、5.3.5 #1）。 |
| C-D8 | 设计 `:326`：返修沿 `replaces` 链往回读；返修上限 3；`:327` 只说续轮按 `repliesToMessageRef`。 | 新 planfix Query 有新 requestRef，现有替换只认该 request 自己的 head；候选本身没有向前的 `replaces` 字段；`plan-service.ts:1148`、`:1162` 的替换协议不适用；`plan-machine.ts:1564`、`:1582` 的 `proposal_replaced` 也不该被这条链触发。`planfix → 问人 → planresume → 新候选` 时：续轮如果一律以活动计划为 base 会丢掉待修候选；新候选首行是 `planresume:`，旧候选不再被排除；原 planfix Query 没有 `repliesToMessageRef`，续轮会把中间 R 当成原 M。 | 按 `replaces` 落不了返修，也数不出已完成的返修轮；跨 `planfix:`/`planresume:` 的续轮会断链。 | **偏差**：返修写新的独立候选，`basedOn` 沿用被审候选的来源计划。**同一来源链跨两种首行**（`planSourceLineageOf`）：`planfix:` 读父候选，`planresume:` 读原 QueryJob 的 `execution.sourceMessageRef`；由链取 `rootMessage`、`fixRound`、`fixBase`。planresume 的 base 取 `fixBase.draft`、`basedOn` 取 `fixBase.basedOn`（没有 `fixBase` 才用活动计划 snapshot/其 `ref`）；`repliesToMessageRef` 冻结 `prev.repliesToMessageRef ?? lineage.rootMessage`；后继关系排除已有后继的旧候选；`completedFixes` 按 `fixRound` 去重数已写出候选的轮。**不加字段**、不改 Query 来源、不沿 `replaces`（6.3.1、6.3.4、7.3.1、C-33）。 |
| C-D9 | 设计 `:142`-`:145`、`:317`-`:328` 只写“消息一定结束、执行者在等时例外”，没有写崩溃后 Query 已终态、收尾未写时怎么续，也没写恢复以什么定位。 | `resumeOfferOf` 只供给 `claimed`/`prepared`（`consumable-sessions.ts:212`）；已投递源消息被 `deliveryEligibility` 的 `delivered` 排除（`message-machine.ts:1193`）；**正常终态提交同时清空 Session 占用**（`query-run-recovery.ts:443`-`:448`、`session-availability.ts:849`-`:858`），所以“Session 仍被已 settled Query 占用”的入口到不了；采用后候选退出 pending 集合，只读 `activePlanRevision` 会漏掉被后来版本接替的已采用候选。 | 重启后问题、文字回答、审阅、无答案收尾和候选/回复都可能永远补不上；P2 采用后回复失败、人又采用 P3，再重启时 P2 的 M 不在恢复集合里。 | **偏差**：恢复**以邮箱遍历到的源消息定位**，不以 Session 占用定位；`settlementOfferOf` 按源消息算确定性 `intervention_planning` Query，读终态和缺失收尾，覆盖问题/文字回答/审阅/无答案/规划答案的候选与关联收尾（含候选已写但 R 未关联）五类，只补收尾；候选已写（`candidate`/`stale`）时不写第二个候选，R／人的普通消息按原收尾结束，只有执行者 M 按 `executorWait` 延后，**不重新投递正文、不重开模型轮**。已采用候选用 `acceptedCandidatesOf(goalRef)` 读 Goal 的**全部**已采用候选，只补 M 回复；Goal 范围仍是没结束的 Goal（`completed`/`cancelled` 不读）。不新建 Query/恢复记录（5.5.2、6.1.6、7.3.1、C-26/C-27）。 |
| C-D10 | 设计 `:123`、`:503` 只说没有参谋时出 `goal_cause/no_adviser`，没说卡源怎么生产。 | Workflow 返回 `waiting` 不会自动产生这种卡；现有 `readGoalDecisionCauses` 只认持久 display/automation cause，不认识 `no_adviser`；它也没有偏差事实读，若卡源只按 `auto_rework_cap_reached`/`no_new_basis`/`budget_exhausted` 判，`growth`/`lines` 超线且没有参谋时不会出卡。 | 没有参谋的细化/偏差需求可能连卡都不出，目标静默等待；只按三个停因判会漏掉两张软线。 | **偏差**：在现有 `readGoalDecisionCauses` 末尾按“细化需求或共享 `readDeviationFacts`+`deviationsOfGoal`（`src/contracts/plan-deviation.ts` 的纯判定，类型同文件）的偏差需求（四值都算）+ 参谋收件人为 null”派生；卡源与 `selectNext` 共用同一读口（`tasks/goal-deviation-facts.ts`）和同一 contracts 纯函数（两模块引用同一正本）；只有权威无收件人才派生，读失败原样返回；不新增持久 cause/字段（5.5.3、7.1.2、C-28）。 |
| C-D11 | 设计 `:372` 只要求阶段结束/偏差不改计划时“请知悉”，没有给通知类别和投影来源；`plan_adoption` 只由采用触发。 | 现有通知源只有采用/返工/成员等类别，没有“阶段结束”或“偏差文字答案”的投影；给参谋 Session 的 `notify` 不会自动进人的 `member_notice` 读。 | 两种情况可能没有采用，因而没有通知，人看不到。 | **偏差**：在现有 `noticeSources`/`NOTICE_CATEGORIES` 投影机制内新增类别 `plan_notice`，由 `createPlanNoticeSource` 从 stage gate 已终结验证轮的 `since` 和确定性 `deviation:` Query 的“回答”分支（`position` 取源 R 的固定身份 `intervention:<messageKey>:respond` 已提交回执 cursor，`readCommitByIdentity`，不用 Query 的 `since`）出稳定 `itemKey` 的项（偏差项带这一轮答案的短文字原文，≤16 KiB）；不新增记录/字段，不靠 Session `notify`（5.8、6.4.1、6.4.2、C-35）。 |
| 接缝 | 设计 `:247`：审阅答案走工具，目标循环读正文。 | 目标循环可用 `readQueryJob`+`readQueryAnswer`，但审阅 Query 必须由 5.2 消费路径创建。 | 若 5.2 只发消息不建 Query，审阅永远没结论。 | 5.2 明确审阅轮按 `intervention_planning` 臂建 Query；6.3 按同一臂写；这是接缝，不是分歧。 |
| D-9 | 设计 `:370` 说阈值可配置；N25 说进 Host 设置。 | 第一稿打算只做常量 + 注入，不开设置路由。 | 用户改阶段线/2 倍线只能改代码。 | 阈值进 `planLoopLimits`（Host 设置），本片按现有设置体系补齐校验、持久化、读取和生效（`plan-loop-limits/save`，`saved/effective/defaults`）；E3 只接页面，不另造记录（N25/C-30）。 |
| D-11 | 设计 `:331`：已执行的用替代任务，偏差只对当前计划。 | 候选/偏差可能指向已 `superseded`/非活动任务。 | 给旧任务发轮会堵住参谋线、也改不了现行计划。 | 偏差只对当前正式计划里 `active` 的任务发；否则只告诉人（7.1.3）。 |
| D-V1 | 设计 `:299`：依赖它的任务按现有规则被挡（B03）。 | `executionDag.dependsOn` 只是软排序（`task-order.ts:1`-`:10`、`eligibility.ts:26`-`:29`）；只有 L46 的卡/等待闭包挡下游（`task-gate.ts:109`-`:172`）。 | 软超线/停因场景下游可能缺输入失败，与 B03 期望不一致。 | 不加新闭包；依赖不是领取条件；写清现有挡截就是 L46 传递闭包，记成对设计第 7 节的偏差，lead 改设计（7.1、7.2、7.7）。 |
| D-V2 | 设计 `:292`：执行者上报的收件人按 L35（7D2 前 `resolveDutyRecipient`）。 | `resolveDutyRecipient` 是 Workflow/Host 侧读；执行者的 `send_session_message` 只能填它知道的 Session。 | 读成“执行者调 `resolveDutyRecipient`”会写出不存在的能力。 | 平台侧按 L35；执行者按技能找参谋线，带 `waitAfterSend:true`；不调 `resolveDutyRecipient`（5.4、7.1.2）。 |
| D-19 | v3 §9-19：超过 256 次请求，累计和增长量都对。 | `RUN_USAGE_REQUESTS_CAP=256`（`run-activity.ts:18`），第 257 次起进 `usage.omitted`。 | 累计只含保留的 256 条，增长量看不到最后一段。 | 落成“256 内精确、超出标不全、不误报”；PL-19 按此写；不改记录形状。 |
| D-20 | 第一稿 D-8/D-10 把阶段线写成 1,500 万增长量、64 倍仅供界面展示。 | v4 §10 已改成 2,000 行或 0.6B token；v3 §4.2 的 64 倍是实测换算。 | 口径混用会让提醒线算错。 | 阶段线 2,000/0.6B 只提醒；64 倍是校准（N19/N20/D-8/D-10）。 |
| D-21 | 第一稿 D-7：三个读数 = Run 用量/阶段用量/任务改动行数。 | v3 §4.2：三个读数是累计 token/上下文增长量/改动行数。 | 把聚合层当读数，公式会重复也读不对。 | 按 v3 改；Run/阶段/任务只是聚合层（N17/D-7）。 |
| D-22 | 第一稿 D-5：同一任务同一版只留一条偏差。 | v3 §4.3 分 `growth`/`lines` 两条软线。 | 只留一条会丢掉增长量 2 倍线。 | 每种 `kind` 最多一条；硬停因存在时软线不发轮（N18/D-1/D-5）。 |
| G-D1 | 设计 `:143`-`:145` 的续轮要带原问题和已存答案。 | 正文若照抄完整规划答案会到 256 KiB；原问题 + 五张卡各 16 KiB 答复 + 请求头更大，去掉原问题仍超 64 KiB。 | 消息发不出、Query 提交被拒、答卡续轮卡死。 | **已由第三稿按 lead 裁定解决、第四稿按 PLT-13 改成只带引用**：正文/`question` = 请求头 + `originalQueryRef`（原 Query 的源消息引用），原问题和逐卡答复正文都不进正文；准备阶段按引用读原 Query 的原问题、`needs_decision` 答案和逐卡 `readDecisionAnswer`，把 `savedAnswers` 追加进准备输入。64 KiB 只约束保存的正文，装配后的输入装不下走现有容量出口；不截断、不分片、不加 ref 字段（5.3.5 #8）。 |
| G-D2 | 设计 `:259` 说通知写“自动采用/人采用”。 | `PlanRevisionSnapshot` 只有 `acceptedAt`/`origin`，没有接受 actor；同一次接受提交的 `PlanRevisionAccepted` 事件不用来区分采用者。 | 按候选来源推会制造假事实；按 actor 分标签会把同一条采用写成两种。 | **已按裁定解决**：通知只写“已采用”和确切审阅四态，人和自动化同一条；`PlanRevisionAccepted` 只用于 `position`，事件读不到 `unavailable`；不读 actor、不加读口、不新增字段（6.4.2、C-36）。 |
| G-D3 | 设计 §5.2 只要求阶段 gate 按阶段验收。 | 模块 gate 原来在全部必需 work 满足后才选；后续段必需占位会挡住某段的模块 gate。 | 用模块 gate 做更细验收时，后续段占位会挡住它。 | **lead 已裁定**：模块 gate 和阶段 gate 用同一条件，只等它覆盖的工作（5.1.3、G-N1）；不是新机制。 |
| G-D4 | 设计 `:193`：导出失败只提示。 | Host 没有日志设施；通知只写三态/路径，不落文件系统的错误原因。 | 文件被外部删除或改动，也读成失败或不完整。 | **lead 已裁定**：不做。通知只写三态和路径，够人判断，不为精确错误码加记录。 |
| G-D5 | v3 §5.2：阶段 gate 等“必需普通任务全部满足”。 | 选择用 `unfinishedWork` 交集，deferred 的必需覆盖任务会挡；GV-5 的 `gateFixInProgress` 只数 active。 | 两者对 deferred 不同。 | 选择按 v3，读模型文案不改（5.1.3）。 |
| G-D6 | B-D4 只写“选择条件”。 | `advanceGate` 的 producer 原取全目标第一条已满足且有 Run 的 work。 | 第二段以后的 stage gate 会拿错段的 Run 当 `subjectRunRef`。 | 同一处加 `gateTask.scope.kind==='goal' || covered.includes(row.ref.taskId)`；目标 gate 行为不变（5.1.3）。 |
| G-D7 | 审阅轮是 `intervention_planning` Query。 | 它的 question 走 64 KiB；答案工具/解析器 16 KiB。 | 容易把审阅答案也当成 256 KiB。 | **已由第三稿按 lead 裁定解决**：审阅 question 64 KiB、答案 16 KiB；文字退路也 16 KiB，超界 `too_long`→`gap`，没有合法结论转卡（`terminal_invalid`），不采用（5.3.5 #7、6.3.3）。 |
| G-D8 | 设计 `:183` 说规划答案 256 KiB。 | 256 KiB 的答案只存 `QueryJobAnswer.answer`；消息正文上限 64 KiB，回复 16 KiB。 | 旧写法把“消息正文 256 KiB”和 Artifact envelope 混成一个边界，实际上消息根本不到 256 KiB。 | **已由第三稿按 lead 裁定解决**：envelope 段不再单独定义；256 KiB 只判 `answer.answer` 字节，消息/回复按 16/64 KiB 分别判，不碰 `artifact.ts:6` 的 `ARTIFACT_MAX_SIZE_BYTES`（5.3.5 envelope 段）。 |
| G-D9 | 设计 `:143`-`:145`、`:183` 把答案文本当作回复内容。 | 规划答案可到 256 KiB，回复消息只有 16 KiB；复制全文必然超界；审阅答案是 JSON、文字退路又未必有 summary。 | 答案接受不等于闭环成功，消息结束不了。 | **偏差（第三稿新定、第四稿按 PLT-12 补形状）**：回复正文只在 5.3.5 按冻结形状派生（`planningReplyTextOf`）：规划答案能解析出合法 `plan`/`questions` 时取 `summary`，`plan_round` 的文字退路（已保存、非空、≤16 KiB）保留原文，审阅取 `审阅通过`/`审阅要求返修：<n> 条意见…`、解析不出按 `terminal_invalid` 不造回复，`text` 退路取原文本；系统轮 R 和执行者 M 一样，完整计划只在 Query 答案和候选；回复构造不再承诺无条件复制全文（5.3.5、7.3、7.3.1、6.3.3）。 |
