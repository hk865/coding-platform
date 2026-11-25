# P6 第二次补跑中途只读诊断：intervention 第一个目标停住

- **运行：** `7d2-p6dg3`，2026-11-25，只读诊断；代码/测试 0 改动、未提交代码、未起 Host、未调模型；为施工单核对，只提交流程单和本诊断。
- **代码树：** `/home/han001/dsh-work/slices/s97dp6dg3`，起点 `7d6ac222`；平台 `d5c975eb`（P6G 落地）加驱动六个提交；收尾 HEAD 见 `git log`（`5e0cf4f6`/`f0df1e91` 加文档提交）；`git diff --numstat 7dp6dg3-base HEAD` 只有 `.dsh-ref/form.md` 和本诊断文件。
- **材料：** `int` 账本 166 条事件（`.dsh-ref/p6/run-e/projects/int/.git/workbench/projects/4674b8efc6ad353c/ledger.sqlite`，`python3 -I` + `mode=ro`，未用 `immutable=1`；库无 WAL，最后事件就是提交态）；`iter`、`run-d-int` 同法；`checks-e/http.jsonl` 的 intervention 段 36 行。详细证据见 `.dsh-ref/out/p6dg3/evidence.md`、`codepath.md`、`recon.md`。

## 结论

**类别：驱动为主；模型计划不合规（次因：缺每段一条阶段 gate；s2 用 `plan_only` 占位本身允许，但 Goal gate 直接依赖未细化占位）；平台一处独立缺陷（d628，次因）；P6G 无关。**

**一句话根因。** `int` 的初始计划把 s2 的验证写成 required、active 的 `plan_only` 任务 `t2`，并把唯一的 Goal gate `g1` 挂在 `t2` 上；s1/s2 又都没有阶段 gate，所以 `t1` 在 11:01:42.291 完成后没有可先推进的 stage gate（`coveredGate` 为空），平台按规格把 `t2` 计入 `unfinishedWork`，普通选择在 `workflow.ts:3260` 返回 waiting，走不到 `workflow.ts:3272` 的 gate 分支，第二个 `VerificationRoundOpened` 因此没有发生。唯一能修好 `t2` 的候选 `plan-proposal-f420…` 已经在 11:00:47.675 写成 `candidate`；本 run 没有 reviewer 线，平台按规格把它转成候选卡（`options:[]`，`actions:['answer','adopt','abandon']`），但驱动 `waitGoal` 的 `approve` 只认 `options`，候选卡返回 `null`，`int` 首次 Goal 等待从不调 `plans/apply`，卡一直没人 adopt。**直接挡住的是“驱动没有采用候选卡”，不是 P6G；模型计划缺阶段 gate 是第二个直接层。**

**证据。** 采用计划 `initial-plan-dacf41b1…`（#71，10:59:17.821）：`t1` work/request_execution（s1）、`t2` work/**plan_only**（s2，required、无 assignment）、`g1` goal gate；**s1/s2 都没有阶段 gate**，`t2` 依赖 `t1`，`g1` 依赖 `t2`。细化轮 d628（#74，10:59:17.913）和候选 f420（#128，11:00:47.675，plan `initial-plan-ed8e7e…` rev2，basedOn dacf，`t2` 改 `request_execution`、加 s2 阶段门 `g2`）都在。全账本 `PlanRevisionAccepted` 只有 #71，针对 ed8e 的 0 行；候选拒绝/撤回 0 行。intervention HTTP 的 `core/plans/apply` 0 条，`decisions/answer` 只有 11:00:48.794 的 member_creation 卡；#128 之后没有任何 adopt。11:01:42.311 #165 `SessionResponsibilityChanged` 之后只有 #166 `ArchitectureSourceObserved`（11:01:42.411，auto-capture），#166 之后 0 条；没有第二次 `VerificationRoundOpened`、第二个 `TaskCompleted`、`GoalCompleted`。

**建议改法。**
1. **驱动（主，谁改：驱动组）。** 在 `scripts/acceptance/lib/flows.mjs` 的 `waitGoal` 里补候选卡分支：`selection === null` 后、`confirmsRework` 前，识别 `card.source.kind === 'candidate' && card.candidateStatus === 'candidate' && card.actions.includes('adopt')`，从 `card.source.pins` 取 Goal/Proposal pin，复用 `flows.mjs:703-705` 的 `plans/apply` 形状调一次；建议做成 `adoptCandidateCard(project, card, rec)`，只在 `int.mjs:122` 显式 `adoptCandidates: true` 时启用，避免改变 E08 等场景。若场景不想扮演“采用人”，至少把候选卡当“平台停在决定”返回 `stoppedFor`/记 not-run，不要 60 分钟记 fail。另修 `int.mjs:122` 的检查归属：首次 Goal 的等待不要挂 `check:'completed-goal'`（C-114 是“已完成 Goal 上再加工作”，真正的 C-114 分支在 `int.mjs:453`）。
2. **平台（独立次因，谁改：平台组）。** `refine:` 消息 d628 的首行是 `refine:goal-confirm:goal.confirmDraft:a224…:s2:1`，`src/contracts/plan-round.ts:212-220` 按 `split(':')` 固定要求 4 段，goalId 自带冒号后变成 6 段，`systemRoundOfText` 返回 null；`execution-inputs.ts:330-336` 因此不把 d628 当系统轮跳过，它被 288067 当普通输入收下，没有自己的 Query，候选 f420 的 `sourceMessageRef` 落成 b2f 而不是 d628。这违反 `slice-PL-SPEC.md:418/542/1054/335`。**同形不止 refine：** `systemRoundRequestId` 的 `refine`/`deviation`/`planresume` 都把 goalId 直接放进请求号（`plan-round.ts:117/127/177`），`systemRoundOfText` 分别固定 4/5/3 段（`:217/:224/:232`），带冒号的 goalId 三者都会失败；只修/只测 refine 不够。**最小改法：** `systemRoundOfText` 改从右解析（或允许 goalId 含冒号），三类一起改；并保证没有自己 Query 的 `host:plan-round` 系统轮不会被供给别的 Query。**测试行：** `tests/runtime/A-05-plan-round.test.ts` 加一条“`refine:goal-confirm:goal.confirmDraft:<hash>:s2:1` 能被 `trustedSystemRoundOfMessage` 认出”的纯解析行，并加 `deviation:`/`planresume:` 同形行（或一条从右解析的通用行覆盖三者）；或 `tests/scenarios/FN-yielded-line-query-supply.test.ts` 加“同一 adviser 线连续两条系统轮，后一条必须有自己的 Query、不能被前一条 Query 吞掉”；具名改坏：把固定段数改回 4（或把从右解析改回固定切分），该行应红。**这条不是本次停住的直接原因**：即使 d628 有自己的 Query，候选仍会因无 reviewer 线转卡，仍要驱动 adopt；采用 f420 后 `t2` 变可执行，d628 不再参与选择。
3. **模型（次因，谁改：模型/skill/lead）。** 初始计划是模型在冷启动规划轮的答案（`draft.origin.kind='model_coordination'`；驱动 `int.mjs`/`flows.mjs` 没有 `plan_only`/`s2`/`t2`/`g1` 字面量，HTTP 也没有 `plans/propose|apply`）。它有两处问题：**(a) 缺每段一条阶段 gate**——计划有 `s1`/`s2`，但只有 `g1` goal gate，没有任何 `scope.kind==='stage'` 的 gate；这违反 `MVP-BEHAVIOR.md:100`“每段写一条阶段 gate”和 `slice-PL-SPEC.md:138/220`“骨架的每个阶段都有它；缺了由审阅者指出、参谋补，平台不新增入图 gate”。本 run 没有 reviewer 线，没人指出；`coveredGate` 因此为空，`t1` 完成后不会先开 s1 阶段 gate，只能等 `t2`。**(b) `s2` 的验证写成 required `plan_only` 并让唯一 Goal gate 依赖它**——`plan_only` 占位本身允许（`MVP-BEHAVIOR.md:100/104`），但缺阶段 gate 使它在 `t1` 后没有可推进的 gate。模型应在初始规划里给每段写一条阶段 gate，并让 Goal gate 不直接依赖未细化占位；这是规划规则/质量，不是平台拒绝条件（平台按规格不校验每段 gate）。f420 的 `sourceMessageRef=b2f` 主要是 d628 解析缺陷的后果（d628 没有自己的 Query，288067 的 source 是 b2f）；不要把它单独记成模型路由错，除非平台修好解析后仍出现。
4. **平台主链不要动。** 不要为“没有 reviewer 线自动采用”加行为（`slice-PL-SPEC.md:342` 明写转卡）；不要把 required `plan_only` 从 `unfinishedWork` 排除；不要改 `advanceGate`/`completion-policy`。

**把握。** 驱动主因约 8.5/10；模型计划不合规（缺阶段 gate）约 8.5/10；d628 平台缺陷约 8/10；“d628 不是主因”约 7/10。**说不清：** `decisions/queue` 的原始响应体没有入日志（`http.jsonl` 只存 digest），候选卡在队列里是按 `candidateCard`/`readGoalCandidateCards` 的代码 + f420 的 `candidate` 状态推的；拷贝时运行还没到 32 分钟 `stalled` 线，最终 report 行没见到；d628 解析修好后是否还需要改输入供给，未实测；模型/驱动的归类边界取决于 lead 把“缺阶段 gate”记 model 还是记 reviewer/采用质量；规则本身是明确的（`MVP-BEHAVIOR.md:100`、`slice-PL-SPEC.md:138/220`）。

## 1. 证据顺序

### 1.1 从计划到最后一个事件（UTC）

| 时间 | event | 事实 |
|---|---|---|
| 10:59:17.753 | #68 `PlanProposalRecorded` | 首方案 `plan-proposal-2ff716a3…`，draft plan `initial-plan-dacf…`；`t2` 是 `plan_only`；`draft.origin.kind='model_coordination'`（冷启动规划轮的模型答案） |
| 10:59:17.821 | #71 `PlanRevisionAccepted` | 采用 **dacf** rev1：`t1` work/request_execution（s1）、`t2` work/**plan_only**（s2，required、无 assignment）、`g1` goal gate；**没有任何阶段 gate（s1/s2 都没有 `scope.kind='stage'` 的 gate）**；`t2` 依赖 `t1`，`g1` 依赖 `t2`；`taskHierarchy.parentOf: t1→t2` |
| 10:59:17.879 | #73 `SessionMessageSent` | `pick-suggest:t1:…`，msg b2f，发给 adviser；needsReply=true |
| 10:59:17.913 | #74 `SessionMessageSent` | 细化轮 `refine:goal-confirm:goal.confirmDraft:a224…:s2:1`，msg d628，发给 adviser；needsReply=true |
| 10:59:35.898 | #91 `QueryJobSubmitted` | `intervention-planning-288067…`，sourceMessageRef=**b2f**，answerShape `plan_round` |
| 11:00:47.455 | #123 `SessionMessageInputAccepted` | d628 被 288067 当普通输入收下；`consumesWait=false` |
| 11:00:47.574 | #124 `QueryJobAnswered` | 答案摘要“细化 s2：把 t2 从 plan_only 占位改为 s2 的真实执行任务…新增 s2 阶段门 g2…” |
| 11:00:47.675 | #128 `PlanProposalRecorded` | 候选 `plan-proposal-f420a53c…`，plan `initial-plan-ed8e7e…` rev2，basedOn dacf，sourceMessageRef=**b2f**，`affectedTaskIds:[t2,g2]`；status=`candidate` |
| 11:00:47.734 | #130 `SessionMessageResponded` | 回给 b2f；d628 无 response |
| 11:00:48.810–.940 | #131–#137 | 人答 `member_creation` 卡（approve）并应用；#134 建执行者线 `session-fbb1ac21…`；#135 `MemberCreated` |
| 11:00:48.970 | #138 `TaskClaimed` | `t1`，planRef=**dacf**（老计划），run `17f055d5…`，session `fbb1ac21…` |
| 11:01:41.586 | #156 `ExecutionRunResultRecorded` | `t1` Run ended/completed，exit 0；Lease 同事件释放 |
| 11:01:41.741–42.248 | #157–#162 | `t1` 自己的工作核验轮 `0e50a9f5…` 开轮、两条检查、finalize PASS |
| 11:01:42.291 | #164 `TaskCompleted` | `t1`，phase=satisfied，completion round `0e50a9f5…` |
| 11:01:42.311 | #165 `SessionResponsibilityChanged` | `t1` 执行线 `fbb1ac21…`，mode=terminal，closed link 到 `t1`，`terminalCause=satisfied`；是 `TaskCompleted` 的伴随写，不是阻断 |
| 11:01:42.411 | #166 `ArchitectureSourceObserved` | `host:auto-capture`；不是工作流事件；**最后一条** |
| 之后 | — | #166 之后 0 条；没有第二次 `VerificationRoundOpened`、第二个 `TaskCompleted`、`GoalCompleted` |

**“11:01:42 后没有新事件”的精确说法：** #165 之后还有 #166；#166 之后 0 条；最后一条工作流/任务类事件是 #165。把“之后没有新事件”读成字面 0 条会漏掉 #166；读成“没有工作流推进”则成立。

### 1.2 第二个提案的状态

- `plan-proposal-f420a53cf07cb555633698c4949b4af7`，draft plan `initial-plan-ed8e7e23c5b409a0fb834edddf2d7138` rev2，`basedOn=initial-plan-dacf41b1…`（活动计划），status=**`candidate`**，issues=[]。
- `PlanRevisionAccepted` 对 ed8e **0 行**；全账本 `PlanRevisionAccepted` 只有 #71（dacf）。`PlanProposal` 拒绝/撤回/not_adopted 事件 **0 行**。
- 所以：**待采用（pending candidate）**，不是被拒，也不是已接受；按产品语言是“等采取动作（adopt/abandon）的候选卡”，不是普通问人卡。

### 1.3 决策队列

- 正式 `needs_decision` 卡只有 `member_creation`（#131/#132/#137，11:00:48.810–.940，已 approve+applied）；全账本 `SessionMessageDecisionAnswered` 只有这 1 条；11:00:48.810 之后没有第二个 `SessionMessageDecisionAnswered`。
- `GoalAdviserQueue` 快照 `entries: []`（event 47 只是初始化期的队列变更），**不能**拿它当候选卡证据。
- 按读模型，live candidate 会生成 `waiting_answer` 候选卡：`decision-read-model.ts:2396` 的 `candidateCard`，`options:[]`（`:2424`），`actions:['answer','adopt','abandon']`（`:2415-2419`），`candidateStatus:'candidate'`；`readGoalCandidateCards` 枚举 Goal 的 live candidate（`:1570-1595`）。所以队列里**有一张等人的候选卡（f420）**，没有未答的正式问人卡。
- 证据强度：`http.jsonl` 对 `decisions/queue` 只记 digest，不记响应体；候选卡“实际出现在队列里”是读模型 + f420 状态推的，不是直接读到的。

### 1.4 驱动为什么不动它

- `waitGoal` 默认 `answer = approve`（`flows.mjs:341`）。
- `approve(card)` 只找 `card.options` 里 `effect==='apply'` 或第一个 option；候选卡 `options:[]`，返回 `null`（`flows.mjs:253-257`）。
- `confirmsRework(card)` 只认 `goal_cause` + `automation_confirmation_required`（`flows.mjs:264-265`），不认候选卡。
- `waitGoal` 在 `flows.mjs:364-375` 对 `selection === null` 直接 `continue`：不答、不 adopt、不计入 `open`；`plans/apply` 在首次 Goal wait 里从未调用。intervention HTTP 的 `core/plans/apply` **0 条**，`core/decisions/answer` 只有 11:00:48.794 的 member_creation approve。
- 因此候选 f420 从 #128 起一直停在“人采用”，目标停在 waiting；60 分钟超时或 32 分钟 `stalled`（`flows.mjs:25,409-441`）都会把 fail 记到 `int.mjs:122` 的 `check:'completed-goal'` 上，而真正的 C-114 分支在 `int.mjs:453`。

### 1.5 与 `run-d-int`、`iter` 的同一段对照

| 步骤 | 这一轮 `int` | `run-d-int` | `iter` 首个 Goal |
|---|---|---|---|
| 采用计划 | #71 10:59:17.821 **dacf** | #74 03:18:16.087 **d288** | #80 10:54:28.876 **af09** |
| 计划形状 | `t1` work；**`t2` work/plan_only（s2）**；`g1` goal gate；`g1` 依赖 `t2` | `t1` work；**`t2` goal gate** | `t1` work；**`g1` goal gate** |
| 细化轮 | #74 `refine:…:s2:1`（d628） | 无 | 无 |
| 叶子完成前的候选 | #128 11:00:47.675 **f420**（candidate，未 adopt） | #137 03:19:12.285 **f1b8**（candidate，未 adopt；下一节点是 gate） | 无 |
| 叶子 `TaskCompleted` | #164 11:01:42.291 | #157 03:19:30.943 | #164 10:55:50.005 |
| 第二个 `VerificationRoundOpened` | **无** | #159 03:19:31.040（+97 ms） | #166 10:55:50.082（+77 ms） |
| 第二个 `TaskCompleted` / `GoalCompleted` | **无** | #165/#166 03:19:31.434/.482 | #176/#177 10:55:50.710/.742 |

**对照说明：**
1. `dint` 证明“有未采用候选”本身不阻断：它的 f1b8 也是 candidate、也没 adopted，但下一节点是 gate，叶子完成后 97 ms 就开了第二核验轮，目标完成。
2. `iter` 证明“下一节点是 gate 且没有候选”可以照常完成：77 ms 开 g1 轮。
3. `int` 的唯一组合是：下一节点是 required/active/`plan_only`，同时细化候选在途且没人 adopt。`plan_only` 让 `unfinishedWork` 非空，普通选择在 `workflow.ts:3260` 返回 waiting，走不到 `:3272` 的 gate 选择；候选在途又按规格“候选在途不再发 refine”（`slice-PL-SPEC.md:14`）不再发第二轮细化。

### 1.6 第一个分岔点

- **形状分岔（最早）：** #71（10:59:17.821）采用的 dacf 把 s2 的 `t2` 写成 required/active/`plan_only`，并让唯一 Goal gate `g1` 依赖 `t2`。dint 的 `t2` 是 gate，iter 的 `g1` 是 gate。
- **缺失动作（决定性）：** #128（11:00:47.675）候选 f420 写入后，驱动没有 adopt 候选卡；这是第一处“谁在什么事件之后没做什么”。
- **事件后果：** #164/#165 之后，`t2` 仍是 plan_only，平台没有、也无法打开第二核验轮；没有第二个 `TaskCompleted`/`GoalCompleted`。

## 2. 代码路径

### 2.1 叶子 `t1` 的工作轮（本轮已发生）

```
collaboration-driver.runWithPump → workflow.advanceWork(start/observe)
  → workflow.ts:4463 normalEnd(run) ok
  → workflow.ts:4465 openChecksAfterRun
  → workflow.ts:4478 case 'open_checks' → evidence.openVerification
  → evidence-service.ts:1221 openVerification
  → verification-machine.ts:1350 transitionRound({kind:'round_opened'})
  → verification-machine.ts:1687 roundOnOpened → :1701 emit VerificationRoundOpened
```

`openChecksAfterRun` 条件（`workflow.ts:4294-4299`）：Goal 可读、`activePlanRevision !== null`；Run 已 `normalEnd`（`workflow.ts:793-799`：ended+completed+reconciliation done）。`openVerification` 再判 Goal active（`:1284`）、指针/Plan/任务 disposition（`:1288-1300`）、task basis（`:1303`）、subject Run 是正常结束的 work Run（`:1332`）、该 subject 没有已有 chain（`:1339`）。本轮全部通过。

### 2.2 叶子 `t1` 的 `TaskCompleted`（本轮已发生）

```
workflow.ts:4482 nextAfterRound → run_check
  → :4499 finalize_checks → :4522 evidence.finalizeChecks
  → :4532-4537 只有 applicable && PASS && gaps.length===0 才继续
  → :4544 completeTaskStep → :4546 complete_task → completion.ts:262 completeTaskFromHost
  → completion.ts:431 task_completed → :466 写 TaskCompleted
```

`completeTaskFromHost` 条件（`completion.ts:350-399`）：Goal pin 与 active Plan 一致；task 在选中计划里；`TaskReduction` pin 未动；`taskCompletionProjectionProblem`（相位必须 satisfied）；round finalized PASS 且 subject/producer 对得上；Evidence fold 满足 `evaluateTaskCompletion`（`:414-437`）。本轮 t1 全部命中。

### 2.3 第二轮：Goal gate `g1` 的核验轮（本轮没有发生）

这里没有“按 `taskHierarchy` 父任务开轮”的机制；对照 run 的第二轮是 **Goal gate `g1` 的 gate round**。

```
complete_task 提交（workflow.ts:4546-4552）
  → advancing(selectWorkStep(base))
  → Driver runDriver 的连续选择（collaboration-driver.ts:1147-1191）
  → workflow.advanceWork(select_work) → workflow.ts:3520 selectNext
  → workflow.ts:2994 selectOrdinary
  → task-gate.ts:233 goalL46Blocked
  → workflow.ts:3260 if (unfinishedWork.length > 0) return attachRefinement(waiting(...))  ← 本轮停在这里
  → （只有上面为空才到）workflow.ts:3272 gateTask = required goal gate && unsatisfied
  → :3275 advanceGate → :1870
  → :1887 readChainHead（gate 没有 chain）→ :1889 continueRoundChain（not_found → null）
  → :1892-1894 producer（work、satisfied、execution !== null）
  → :1898 openGateChecksStep → :396
  → :4478 open_checks → evidence.openVerification（同 2.1）
  → :1701 VerificationRoundOpened（gate subject=g1，producer=t1 的结束 Run）
```

**开 gate 轮的前置条件：**
1. Goal `desiredState==='active'`、有 active Plan（`workflow.ts:3528-3534`）。
2. 没有显式 task 选择（`base.taskId === null`；`:3236-3241`）。
3. 通过候选/问题/偏差预读，且普通选择返回 waiting（候选卡本身不阻断普通选择）。
4. `goalL46Blocked` 的 `unfinishedWork` 为空：所有 required、非 cancelled/superseded 的 work（**包括 `plan_only`**）都 `effectivePhase==='satisfied'`（`task-gate.ts:240-241`）。**本轮不满足。**
5. `coveredGate` 不存在（stage/module gate 先走；本轮没有 stage gate）。
6. `gateTask` 是 required、active、scope=goal、未 satisfied（`:3272-3274`）。
7. `advanceGate` 的 chain head 不是 open/finalized-non-PASS；没有 stopped/reverify 的 gate failure（`:1882-1888`）。
8. producer 存在：至少一个 satisfied 的 ordinary work 行，且 `execution !== null`（`:1892-1894`）。
9. `openVerification` 的 round-open 守卫通过（Goal active、active plan 指针、subject 在计划里 active、basis resolved、subject Run 是正式结束 work Run、无已有 chain）。
10. `g1` 不在 `base.activeTaskIds`（`:3274`）。

本轮：1、2 满足；3 有候选卡；4 因 t2 的 plan_only **失败**；5–10 未执行。

### 2.4 父/Goal gate 的 `TaskCompleted` 与 `GoalCompleted`（本轮没有发生）

如果 2.3 开了轮、检查 finalize PASS，走与 2.2 相同的 `finalize_checks → complete_task`；gate 多一条：`taskCompletionRoundProblem` 要求 round subject 是 gate、producer 是 same-Goal 的 ordinary work Run（`completion.ts:380-401`）。本轮没有 gate round，所以没有 gate 的 `TaskCompleted`。

```
selectOrdinary 的 gate 分支之后（workflow.ts:3278-3281）
  → required.every(!taskUnsatisfied) → completeGoalStep:498
  → workflow.ts:4554 complete_goal → completion.ts:496 completeGoalFromHost
  → state/goal-machine.ts:465 goalCompletionProblem
  → tasks/completion-policy.ts:171 evaluateGoalCompletion
  → completion.ts:601 写 GoalCompleted
```

条件：Goal active；GoalPhase pin 正确；active Plan 与 facts 同一；`evaluateGoalCompletion` 的 `completed===true`；所有 required work/gate 都有正式 `TaskReduction@1`、所有 required obligation 被满足（`completion-policy.ts:171-215`）。本轮 t2 没有 reduction（没有 claim/run/round），即使绕过 unfinishedWork，Goal completion owner 也会以 `incomplete: required task t2 is not formally satisfied` 拒绝。

### 2.5 条件表：哪些会让它不走，本轮是否命中

| # | 条件 | 代码位置 | int 是否命中 | 证据 |
|---|---|---|---|---|
| 1 | **required `plan_only` 未满足**，`unfinishedWork > 0` | `task-gate.ts:240-241`；`workflow.ts:3260-3265` | **命中（直接阻断）** | 计划 t2 是 required/active/plan_only；`TaskCompleted` 只有 t1；t2 无 claim/run/round；`selectOrdinary` 在 3260 返回 waiting |
| 2 | **有待采用的计划候选**（f420 没有 `PlanRevisionAccepted`） | `workflow.ts:3689-3860`；`plan-candidate.ts:103-139` | **命中（不是直接阻断，但没有修复路径）** | f420 status=candidate；accepted 0 行；候选卡 `no_review_line`；驱动不 adopt |
| 3 | **没有 reviewer 线**，候选只能转卡 | `plan-candidate.ts:110-112`；`workflow.ts:3727-3733`；`duty-recipient.ts:31-47` | **命中** | `RoleLineAllocation` 四职责、无 reviewer；事件 0 条含 reviewer；无 `PlanReviewRecorded` |
| 4 | **细化轮已 committed、消息仍 pending** | `workflow.ts:3051-3073`；`plan-round.ts:47-54` | **命中（形成最终 waiting 文本）** | d628 10:59:17.913 pending；`readHostSendReceipt` 认为 committed；`attachRefinement` 返回 `plan_refine_pending`，不写事件 |
| 5 | 成员刚建（`MemberCreationAccepted`→`MemberCreated`） | `workflow.ts:3177-3210`；`claim-service.ts` | **事件命中，但不是完成后的阻断** | #126/#127/#132/#135/#136；创建的是 t1 的执行线 `session-fbb1ac21…`，t1 随后 claim（#138）并完成；t2 是 plan_only，不走成员/领取门 |
| 6 | 处理权/责任变更（`SessionResponsibilityChanged`） | 事件 #165；来源 `session-fbb1ac21…` | **命中，但是伴随结果** | 它在 `TaskCompleted` 后 20 ms 发生，是 t1 执行线责任写；不参与 gate 的 producer/chain 判定 |
| 7 | P6G 领取：claim 即占线 | P6G 前的基线：`claim-service.ts:1611` 的 `occupancy_acquired` 同一次提交 | **命中（作为前提），但不是阻断** | t1 claim #138 后 `ExecutionEntryEntered` #141；本轮只有一个可执行任务，未出现“同线两个任务” |
| 8 | P6G 领取：busy 后重挑一次 | `workflow.ts:4397-4425` | **未命中** | 只有一次 `TaskClaimed`（#138），没有 busy/revision_conflict 的第二次 claim |
| 9 | P6G `wait_writer`/transfer 重读重试 | `session-handoff-service.ts`（P6G diff） | **未命中** | 账本 `SessionHandoffRecorded` 0 条、`SessionHandoffBrief` 0 条；本 run 没有换手 |
| 10 | 换手/交接 | `session-handoff-service.ts`、`business/workflow/session-handoff.ts` | **未命中** | 同上；无 handoff 事件 |
| 11 | 重排队 / `TaskRequeue` | `claim-service.ts`、`run-machine.ts`、`execution-inputs.ts` | **未命中** | 账本 `TaskRequeue` 0 条；t1 一次 Run 完成 |
| 12 | Goal 非 active / 无 adopted plan / Goal 已 COMPLETED | `workflow.ts:3528-3534,3558-3567` | **未命中** | Goal active；activePlanRevision 非空；没有 GoalCompleted |
| 13 | gate 已有 open/finalized-non-PASS chain，或 gate failure 判 stopped | `workflow.ts:1876-1889`；`continueRoundChain:1660-1695` | **未命中** | g1 没有任何 round；`TaskGraph` 里 g1 无 failure |
| 14 | 没有 producer（satisfied work + execution） | `workflow.ts:1892-1896` | **未命中（若走到会满足）** | t1 的 `TaskReduction@1` satisfied，`execution=17f055d5…`；只是被 #1 挡在前面 |
| 15 | 显式 task 选择 / activeTaskIds 把 gate 当作在跑 | `workflow.ts:3236-3241,3274` | **未命中** | 没有显式 task；g1 没有 Run |

### 2.6 P6G diff：没有带进这条路径的回归

- `git diff --name-only d5c975eb HEAD`：16 个文件，全在 `scripts/acceptance/`；`src/` 0 个。
- `git diff --stat 63ff3a0f d5c975eb -- src`：27 个文件，+728/−278；集中在 `claim-service.ts`、`session-handoff-service.ts`、`mailbox-*.ts`、`run-machine.ts`、`execution-inputs.ts`、`workflow.ts` 的 requeue/claim/handoff hunk。
- `session-chooser.ts`、`state/session-availability.ts`、`state/session-responsibility.ts` 在 P6G diff 为 **0 个文件**；`src/contracts/plan-round.ts` 也为 **0**。
- 本 run 没有 `SessionHandoffRecorded`、`TaskRequeue`、第二次 claim、busy 重挑；P6G 的 hunk 一个都没执行。**不是 P6G 回归。**

## 3. 结论：挡住的条件、类别、改法

### 3.1 挡住的条件

- **直接条件：** `t2` 是 required/active/`plan_only`，`goalL46Blocked` 把它算进 `unfinishedWork`，`selectOrdinary` 在 `workflow.ts:3260` 直接 waiting，走不到 `:3272` 的 Goal gate 分支；`g1` 的 gate round 因此不开。
- **为什么没被修好：** 唯一能修 t2 的候选 f420 是 `candidate`，没有 reviewer 线，平台按规格转成候选卡；驱动 `waitGoal` 不认 `options:[]` 候选卡，也不调 `plans/apply`，所以没人 adopt。候选在途又按规格不再发 refine。
- **不是平台主链违规：** required `plan_only` 不算完成（`completion-policy.ts:166-167,198-203`；`slice-PL-SPEC.md:222/277-278/897`）；没有 reviewer 线转卡（`slice-PL-SPEC.md:342`；`plan-candidate.ts:110-112`）；`attachRefinement` 对 committed 的 refine 返回 waiting（`workflow.ts:3040-3073`；`slice-PL-SPEC.md:601`）。这些都在规格内。
- **模型计划不合规（次因）：** 初始计划是模型冷启动规划轮的答案（`draft.origin.kind='model_coordination'`）。它有 `s1`/`s2` 却没有每段一条阶段 gate，违反 `MVP-BEHAVIOR.md:100`、`slice-PL-SPEC.md:138/220`；平台按规格不把“每段都有 gate”做成入图校验，缺 gate 由审阅者指出、参谋补，本 run 没有 reviewer 线，没人指出。它还把 s2 的验证写成 required `plan_only` 并让唯一 Goal gate 依赖它；`plan_only` 占位本身允许（`MVP-BEHAVIOR.md:100/104`），但缺阶段 gate 让 `t1` 完成后没有可先开的 stage gate，`coveredGate` 为空，只能等 `t2`。

### 3.2 类别

**驱动为主（直接原因）；模型计划不合规（次因：缺每段一条阶段 gate；s2 的 `plan_only` 占位本身允许，但 Goal gate 直接依赖未细化占位）；平台一处独立缺陷（d628，次因）；P6G 无关。**

### 3.3 驱动最小改法（平台主链不动）

- **文件/函数：** `scripts/acceptance/lib/flows.mjs` 的 `waitGoal`（`:341` 起）和 `approve`（`:253`）旁新增 `adoptCandidateCard(project, card, rec)`；在 `:364-375` 的 `selection === null` 分支接入；`int.mjs:122` 传 `adoptCandidates: true`。
- **调用形状：** 复用 `flows.mjs:703-705` 的 `plans/apply`；pins 用 `card.source.pins` 里的 Goal/Proposal，`decisionRefs: []`。
- **兜底：** 若场景不想扮演“采用人”，让 `waitGoal` 把候选卡当“平台停在决定”返回 `stoppedFor`/记 not-run，不要 60 分钟记 fail。
- **修检查归属：** `int.mjs:122` 首次 Goal 的等待不要挂 `check:'completed-goal'`；C-114 只在 `int.mjs:453` 判。
- **测试行：** int acceptance 回归——初始计划含 required `plan_only`、候选卡出现时，`waitGoal` 调一次 `plans/apply`，Goal 继续到 COMPLETED，不再超时；具名改坏：候选卡分支仍返回 `null`，该行应红在“未采用/超时”。另加一条“首次 Goal 未完成时 fail 不得记 C-114”。

### 3.4 平台独立缺陷（d628，次因）

- **事实：** d628 的首行是 `refine:goal-confirm:goal.confirmDraft:a224…:s2:1`；`src/contracts/plan-round.ts:212-220` 按 `split(':')` 固定要求 4 段，实际 6 段（goalId 自带两个冒号），`systemRoundOfText` 返回 null；`execution-inputs.ts:330-336` 因此不把 d628 当系统轮跳过，它被 288067 当普通输入收下，没有自己的 Query；候选 f420 的 `sourceMessageRef` 落成 b2f。
- **违反：** `slice-PL-SPEC.md:418`（QueryJob/QueryRun id = `sha256(messageRef)`，同一消息 → 同一 Query 对）、`:542`（`sourceMessageRef = message.ref`）、`:1054`（refine 候选的 `sourceMessageRef` 必须是那条系统轮消息、`requestRef` 必须是规划轮 QueryJob）、`:335`（系统轮消息一定结束；有候选就结束在“候选已写入”）。`deviation`/`planresume` 同形（`plan-round.ts:117/127/177` 对 `:217/:224/:232`），带冒号的 goalId 三者都会失败。
- **最小改法：** `systemRoundOfText` 从右解析（或允许 goalId 含冒号）；并保证没有自己 Query 的 `host:plan-round` 系统轮不会被供给别的 Query。
- **测试行：** `tests/runtime/A-05-plan-round.test.ts` 加“`refine:goal-confirm:goal.confirmDraft:<hash>:s2:1` 能被 `trustedSystemRoundOfMessage` 认出”的纯解析行；或 `tests/scenarios/FN-yielded-line-query-supply.test.ts` 加“同一 adviser 线连续两条系统轮，后一条必须有自己的 Query、不能被前一条 Query 吞掉”。具名改坏：恢复固定 4 段，该行应红。
- **不是主因：** 即使 d628 有自己的 Query，候选仍会因无 reviewer 线转卡，仍要驱动 adopt；采用 f420 后 t2 变可执行，d628 不再参与选择。**也不是 P6G 回归：** `src/contracts/plan-round.ts` 不在 P6G diff 里；这是既有的“按固定 4 段解析”假设被带冒号的 goalId 触发。

### 3.5 模型/skill（次因，规划规则）

- 初始计划是模型冷启动答案；`plan_only` 占位本身允许，但计划有 `s1`/`s2` 却没有每段一条阶段 gate，违反 `MVP-BEHAVIOR.md:100`、`slice-PL-SPEC.md:138/220`。应加一条规划规则/质量行：每段写一条阶段 gate（`scope.kind='stage'`），Goal gate 不直接依赖未细化的占位；不要把它写成平台拒绝条件（平台按规格不校验每段 gate）。
- f420 的 `sourceMessageRef=b2f` 主要是 d628 解析缺陷的后果：d628 没有自己的 Query，288067 的 source 是 b2f，模型只能答 288067。不要把它单独记成模型路由错；若平台修好 d628 解析后仍出现来源偏差，再考虑 skill 行。

## 4. 否定证据（命令与结果行数）

1. **事件计数（int，166 条）：** `PlanProposalRecorded 2`、`PlanRevisionAccepted 1`、`PlanReviewRecorded 0`、`PlanFixRecorded 0`、`TaskClaimed 1`、`TaskCompleted 1`、`VerificationRoundOpened 1`、`VerificationRoundFinalized 1`、`GoalCompleted 0`、`SessionHandoffRecorded 0`、`TaskRequeue 0`、`MemberCreationAccepted 1`、`MemberCreated 1`、`SessionResponsibilityChanged 1`、`QueryJobSubmitted 4`。`event_json` 含 `reviewer` 的行数 **0**。
2. **第二个提案：** `PlanRevisionAccepted` 对 ed8e **0 行**；全账本 accepted 仅 #71；`PlanProposal` 拒绝/撤回/not_adopted **0 行**；f420 `status=candidate`、`issues=[]`。
3. **最后事件：** `max(id)=166`、`occurredAt=11:01:42.411Z`；`id>164` 2 条（#165/#166）；`id>165` 1 条（#166）；`id>166` 0 条；`occurredAt > 11:01:42.411Z` 0 条。
4. **没有第二次开轮/完成：** 全账本 `VerificationRoundOpened` 1 条（#157，t1）、`TaskCompleted` 1 条（#164，t1）、`GoalCompleted` 0 条；`id>164` 的 `VerificationRoundOpened` 0 条。
5. **HTTP（intervention 段 36 行）：** `core/plans/apply` **0**；`core/decisions/answer` 只有 11:00:48.794 的 member_creation approve；`core/decisions/queue` 14 行；`core/goals/display` 14 行；`core/initialization/adopt` 1 行（第 455 行，10:59:17.338）。
6. **没有 refine Query：** 全账本 QueryJob 4 条（`60b4e654…`、`goal.confirmDraft:…:attribution`、`0b67fe54…`、`288067…`）；没有 `sourceMessageRef=d628` 的 Query；d628 快照 `status=pending`、`response=null`、`acceptedInputs` 只有 288067。
7. **驱动没有计划字面量：** `grep -c 'plan_only' scripts/acceptance/scenarios/int.mjs` → 0；`grep -c 'plan_only' scripts/acceptance/lib/flows.mjs` → 0；`int.mjs`/`flows.mjs` 的 `'s2'`、`'t2'`、`'g1'` 计数均 0；整个 `scripts/acceptance/` 只有 `cells/a1.mjs:5,33,54` 用 `plan_only`。
8. **P6G 不相关：** `git diff --name-only d5c975eb HEAD | wc -l` = 16（全 scripts/acceptance）；`git diff --name-only 63ff3a0f d5c975eb -- src | wc -l` = 27；`git diff --stat 63ff3a0f d5c975eb -- src/contracts/plan-round.ts` = 0。
9. **d628 解析：** `refine` 首行 `split(':')` 长度 6；`['refine','goal-confirm','goal.confirmDraft','a224…','s2','1']`；`refine` 期望 4、`deviation` 期望 5、`planresume` 期望 3。
10. **队列：** 全账本 `SessionMessageDecisionAnswered` 1 条（#131，11:00:48.810）；`GoalAdviserQueue` 快照 entries=[]；11:00:48.810 之后第二个 `SessionMessageDecisionAnswered` 0 条。

## 5. 说不清

1. **`decisions/queue` 的原始 body 未保存。** `http.jsonl` 只有 digest/input，没有卡载荷；候选卡在队列里是按 `candidateCard`/`readGoalCandidateCards` 的代码 + f420 的 candidate 状态 + 无 reviewer 线推出来的。没有直接看到 11:00:48.776 那次 queue 的 `waitingAnswer` JSON。
2. **最终报告行未见到。** 拷贝时运行还在继续（最后 HTTP 11:01:39.457，最后事件 11:01:42.411）；没有看到 `int.mjs:122` 最终是 32 分钟 `stalled` 还是 60 分钟 `timed out`，也没有看到报告把 `completed-goal` 记成什么。代码上 `endedEarly` 的 32 分钟静默分支会先于 60 分钟触发（`flows.mjs:25,409-441`），但未实测。
3. **候选卡的确切 `candidateWait.reason`/最终 `plan_refine_pending` 文本没有日志原文。** 是由 `decidePlanCandidate` 的 `no_review_line` 分支 + `attachRefinement` 的 waiting 文本推出来的；`workflow/driver-read` 在 intervention 段 0 次，驱动没有读到最终 wait 原因。
4. **d628 的归属缺陷是否是“唯一”的平台原因。** 解析失败与“288067 先建、d628 后被吞”两个事实都在；无法从账本区分如果只修解析、不改输入供给，d628 会不会在 288067 结束后开自己的 Query。最小改法同时点了解析和输入供给两处，是因为只修一处可能不够。
5. **模型计划不合规的边界。** 缺每段一条阶段 gate 是明确规则（`MVP-BEHAVIOR.md:100`、`slice-PL-SPEC.md:138/220`）；`plan_only` 占位本身允许。本文按规则记模型次因；若 lead 认为初始计划由人确认、采用责任完全在驱动，可把模型层降为“触发/质量提示”，但缺阶段 gate 这一条仍应在 skill 里补。
