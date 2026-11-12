# 只读报告见证（B06）规格

lead，2026-11-02。代码行号按 `6d91cf67`。PL-1、8C、第 9 片尚未合入，凡引它们的东西标“**该片合入后重指**”。

状态：2026-11-02 冻结（Codex 审一轮 11 条、快速核对两条；lead 逐行审）。排在第 9 片之后、E3 之前。生产估计 **750–1,070 行**，测试估计 **410–595 行**。

**路径简写。** `MVP` = `MVP-BEHAVIOR.md`；`DESIGN` = `refactor/design/orchestration-2026-10/DESIGN.md`；`LOOP` = 同目录 `plan-loop-design.md`；`V3` = 同目录 `goal-layering-design.md`；`S9` = 同目录 `slices/slice-9-SPEC.md`；`PL` = 同目录 `slices/slice-PL-SPEC.md`；`PRODUCT` = `PRODUCT.md`。代码路径相对 `src/`。

---

## 0 一页说明

**一句话。** B06 给检查轮加一种不跑进程的检查 `witness`：被见证的 Run 正式结束且 completed 后，平台从该 Run 的原执行历史、最终文字、来源和 `RunActivity` 机械判定五件事——**这个 Run 确实只读、确实读了要求读的路径、确实交了报告**。全部成立且来源匹配才 PASS。它不是独立审阅，也不把“报告非空”当成内容正确；不要求报告有固定段落，不改执行者的报告格式。

**为什么现在做。** B06 不在任何一片，但 MVP 门槛前必须做完（`DESIGN:1482`、`LOOP:50`、`:400`）；`explore` 也要靠它判完成（`LOOP:400`）。第 9 片只交执行结果审阅，不关闭 B06（`S9:575`、`:586`）。

**改什么（最小）。**

1. 计划要求可选带 `requiredReadPaths`；计划指南要求只读探索任务写一条 `kind:'witness'` 的 required 要求；**不新增硬校验**（W-2）。
2. 内置检查 `platform:witness`，不进 `TrustedCheckConfiguration.checks`；`VerificationCheckKind` 加 `witness`，`RoundCheckSnapshot.definition` 扩成命令/见证联合；`CheckExecutionTicket.definition` 仍只收命令（W-2）。
3. 见证结果仍走 `run_check`，由 runner 在进程/沙箱之前分派到 Evidence owner；**不新增 Workflow step**（W-6）。
4. `EvidencePort.recordWitness`：经 `WitnessFactsPort`（WorkGraph `model` 声明、Runtime 函数实现、组合根注入）取得已解码事实，核来源与 `RunActivity`，把最终文字按结构化 body `{roundRef, subjectRunRef, reportText}` 存成不可变 artifact，机械判定，一次提交写 Round/check/`reportRef`/`outcome`/`sourceStatus`/事件/回执（W-3、W-5）。
5. 持久化事件沿用原 `VerificationCheckResultRecorded`；只加内存态“见证臂”和 `pending→finished` 转移，`invocationId` 保持 null（W-5）。
6. finalize 的 verdict Evidence 对见证写 `source.runRef = round.subjectRunRef`，`summary.artifactRef = check.reportRef`；其余沿用（W-4）。
7. 读口沿用第一稿建议：`tasks/query` 补 `TaskReduction`，`graph/look` 补 round 的 `evidence` 关系，报告正文走 `materials/open`，不新增路由（W-7）。

**不改什么。** 不改 Workflow 步骤/`nextAfterRound`/完成链；不新增持久化事件、`EvidenceKind`、`EvidenceOutcome`、Task/Goal 状态；不改审阅、`ReviewWork`、`reviewerEvidence`；不做报告格式/内容判定；不做旧项目 policy 迁移；不改架构捕获触发（L-9 现状不动）；不做 UI/E3、保留期限、P1/P2/P3 分档。

**顺序。** 第 9 片之后、E3 之前（L-8）。共用文件串行，B06 在 9 的树上只加并列的 witness 分支。

---

## 1 语义（W-1）

### 1.1 见证证明的五件事

| # | 判据 | 已存事实 | 判不出时 |
| --- | --- | --- | --- |
| 1 | 被见证的 Run 正式结束，结果 `completed` | `RunSnapshot`（`openVerification` 已按此开轮，`verification-machine.ts:1201-1211`） | Run 未结束/非 completed → 见证不适用，INCONCLUSIVE |
| 2 | 有非空的实际最终文字 | Kernel `run.completed` 的 `finalMessageId` → transcript `assistant_message.content`（`handoff-brief-assembly.ts:390-400`） | 缺 message/空串/纯空白 → 已知缺项，FAIL |
| 3 | 至少一次成功的来源读取 | 经 `WitnessFactsPort`（实现留在 Runtime）读该 Run 的 `graph-execution-history`：native `read` 的 `tool.started` + `arguments.path` 与配对 `tool.completed` 的 `status:'success'`；或 `read_source` 的成功 JSON（自带 `path`） | 历史读不到/解不开 → 缺口（三态 `unknown`），INCONCLUSIVE |
| 4 | 要求里列的路径都读到了 | 同 3，先 `isSafeSourceRelativePath`，再逐条精确匹配成功的读取 `path` | 明确没读过 → FAIL；路径不可判 → `unknown`，INCONCLUSIVE |
| 5 | 工作区没有变化（effects 为 none） | 该 Run 的 `RunActivity`（`contracts/run-activity.ts:34`、`:38-41`、`:79`） | 记录缺失/坏/`unknown`/`possiblyIncomplete` → unknown，INCONCLUSIVE；非 Git → INCONCLUSIVE |

**第 5 条的语义。** 指“这个 Run 的 edit/shell 工具没有产生副作用”，不是“文件系统绝对没变”。今天没有 Run-before 基线（`verification-workspace-reader.ts:80`/`:86` 的 Git/非 Git capture，`:77` 明写不能证明 semantic no-change），只有 `RunActivity` 能归到被见证 Run；`round.sourceProof.changedFiles` 是开轮时相对当前 HEAD 的未提交改动，不能拿来判第 5 条。判定按 `RunActivity`：`definiteOmitted>0`、`definite` 路径非空或改动行（added/deleted 非 null 且 >0）→ `changed`；`possible` 路径非空、`possibleOmitted>0`、`possiblyIncomplete`、`turnTerminal!==true`、`unresolvedCalls>0` → `unknown`；其余 → `none`。`possible` 是声明/未确认，不能当已改；`definite` 才是确认的副作用。不要用 `changedLines.complete` 单独判 none（被拒的 shell 也会把它置 false）。非 Git 按 L-12 先看 `round.sourceProof.kind`：不是 `git-head-worktree` 一律 unknown → INCONCLUSIVE，不用 RunActivity 翻案；与其他已知缺项的优先级见 §7-L5。**Kernel 的逐工具 `effects`** 是 RunActivity 的原始事实，R3 的 tally 已在 Run 结束时把它固化成 RunActivity；本片不写第二份 tally。`CheckProcessObservation.effects` 是检查命令自己的 ProcessSandbox 结果，不用于被见证 Run。

**第 2 条的口径。** 只取 `finalMessageId` 命中的那条，不取“最后一条非空 assistant 文字”，避免把中间说明当报告；`assistant_message` 带 `toolCalls` 不单独判失败。非空按 `content.trim().length>0`；纯空白不算报告。现成 `handoff-brief-assembly` 不判非空，见证自己加。只有历史/解码/归约失败才是 `unknown`；缺 message / 空白是 `absent`（已知缺项）。

**第 3/4 条的口径。** 认两种结构化读取：native `read`（`call.name==='read'`，路径取 `call.arguments.path`，失败/取消/`outcome_unknown` 不算）；`read_source`（`call.arguments.path` + 成功 JSON 的 `output[0].value.path`，两者须一致；`truncated` 不影响“读到一次”的 A 口径）。`search`/`list_files`/`symbols` 不是逐文件读取，不认；`project_source` 只在 frozen source 出现，普通 Work 不依赖，本片不认。路径不 `resolve`/`normalize`，原样比较；进入判定前逐条调 `isSafeSourceRelativePath`（`workspace/path-validation.ts:3`）：`false` 记 `unknown` → INCONCLUSIVE，`true` 后按原字符串精确集合匹配。不自写绝对路径、分隔符、点段判断。“读到”的程度见 §7-L1。

**后注（121-54）：** 检查轮次里“Run 结束时改过的 Python 文件还有语法错就记 gap”归这里的 witness 做。**121-103 改：**这一臂不放在 witness：见证只用于只读任务，只读任务改了 `.py` 按 effects 已经 FAIL，放在这里永远不会触发。改成单独小包“检查轮的 Python 语法臂”，排 S9 G5 后。

### 1.2 结论映射

| 事实 | outcome | 说明 |
| --- | --- | --- |
| 1–5 全成立，且 `sourceStatus==='matched'` | `PASS` | 写 verdict Evidence；Task 可完成 |
| 报告缺失/空/纯空白 | `FAIL` | 已知缺项 |
| 零次成功读取 | `FAIL` | 已知缺项 |
| 某条 `requiredReadPaths` 明确不在成功读取里 | `FAIL` | 已知缺项 |
| `RunActivity` 明确 `changed` | `FAIL` | 已知缺项（写了文件） |
| Run 未结束/非 completed；非 Git；来源 changed/unavailable/permission_changed；`RunActivity` unknown；历史读不到/解不开；路径不可判（`isSafeSourceRelativePath` false） | `INCONCLUSIVE` | 来源不适用、unknown 或有缺口 |
| 其他都成立，但结构化 body 超过 `ARTIFACT_MAX_SIZE_BYTES`（256 KiB UTF-8 字节，含 JSON 信封，`artifact.ts:6`），`storeArtifact` 返回 `size_exceeded` | `INCONCLUSIVE` | 平台容量缺口，不是 Run 的已知缺项 |

**PASS 的写入层硬条件**（今天完成链不强制，见 §3-D10）：`outcome==='PASS'` 必须同时 `reportRef!==null`、`sourceStatus==='matched'`、五条全成立、`knownFailure`/`hasGap` 为空。否则 `recordWitness` 不得写 PASS。

**判定优先级（三态）。** 第 3–9 步先把每条事实写成 tagged union，不用 `null`/空数组表示 unknown。`knownFailure` 只由已知缺项算：`report.state==='absent'`、`reads.state==='known'` 且 `reads.paths.length===0`、某条 `path.state==='absent'`、`effects==='changed'`。`hasGap` 只由不适用/不可判算：`run.state!=='applicable'`、`report.state==='unknown'`、`reads.state==='unknown'`、某条 `path.state==='unknown'`、`source!=='matched'`、`effects==='unknown'`。顺序固定为 `knownFailure ? FAIL : hasGap ? INCONCLUSIVE : PASS`；两者同时命中时 FAIL 优先（L5）。非 Git 只让第 5 条 unknown（§7-L5）；`requiredReadPaths` 为空不构成 gap（L2）。

**不判什么。** 不判报告内容/文笔/是否“覆盖了哪条要求”；不判“模型说完成”；不判任务整体完成（完成归约在 `evaluateTaskCompletion`）；不判审阅要求。报告格式完全由执行者决定，平台不加段、不改提示词里的报告格式。

### 1.3 与审阅、命令检查的边界

- **审阅 ≠ 见证。** 审阅是起 reviewer 看执行结果；见证经 `WitnessFactsPort` 读历史事实、在 Evidence 内读来源，做机械判定。见证 capability 的 `coversKinds` 只有 `['witness']`，不可能满足 `reviewer` 要求；B06 不写 `reviewerEvidence`，不建角色线（`S9:570-575`）。
- **命令检查 ≠ 见证。** 见证不 `beginCheck`、不签 `CheckExecutionTicket`、不造 `CheckProcessObservation`、不模拟 exit code；不进入 `executing`。
- **保留 checkId。** `platform:witness` 是内置保留 id；Host 的 `setup.checks`/`TrustedCheckConfiguration.checks` 仍只放命令检查，不得注册同名命令。

---

## 2 范围与非目标

**范围。**

| 块 | 落点 | W |
| --- | --- | --- |
| 计划/政策/检查生成 | `plan.ts`、`verification.ts`、`verification-plan.ts`、`evidence-service.ts` 的 capability、`verification-machine.ts` 的 `pendingRoundChecks` | W-2 |
| 见证判定/报告物化 | `evidence-service.ts` 的 `recordWitness`、`witness-path-verdicts.ts` 路径三态、新纯函数 `witness-check.ts`、`model/witness-facts-contracts.ts` 端口、`agent-runtime/witness-facts.ts` 单函数 | W-3 |
| 状态/事件 | `verification-machine.ts` 的内存臂/转移、`changedCheck` 收口、admission/transition 共用 `guardCtx`；持久化事件/codec 不改 | W-5 |
| Evidence 入账 | `evidence-service.ts` 的 verdict 构造块 | W-4 |
| 执行分派 | `check-execution.ts` 的 runner 分派；Workflow 不改 | W-6 |
| 读口 | `plan-service.ts`/`plan-contracts.ts`、`graph-context-reader.ts`/`graph-context-contracts.ts`、`readEvidence` | W-7 |
| 测试 | 新 B06 业务流程测试 + owner 级重放 + 纯函数 | W-8 |

**非目标。** 不做独立审阅/ReviewWork/reviewer 线；不新增 `EvidenceKind`/`EvidenceOutcome`/`EvidenceSnapshot.revision`/Task/Goal 状态；不新增持久化事件/Workflow step/HTTP 路由；不把 witness 塞进 `RegisteredCommandCheck` 的空 `command`；不做报告格式/内容判定；不做旧项目 policy 迁移；不做保留期限；不用 P1/P2/P3 分档。

---

## 3 现状与偏差

### 3.1 现状（端到端 0 条）

| 能力 | 现状 | 位置 |
| --- | --- | --- |
| witness 种类/产出者/报告实体/入账口/测试 | 没有 | `S9:539`、`:553` |
| 检查定义 | `RoundCheckSnapshot.definition` 只收 `RegisteredCommandCheck`；ticket 也只收命令 | `verification.ts:117`、`:140` |
| 检查事件 | `check_result_recorded` 在内存态要求 `executing` + 非空 `invocationId` + observation；finished 的 `changedCheck` 对所有 change 读 `resourceCapHit`；admission 用 `RoundGuardContext` | `verification-machine.ts:335-350`、`:975-987`、`:1249-1297` |
| 计划编译 | 只按 `requirementLevel` 筛 required obligations，不按 subject task 过滤 | `verification-plan.ts:70` |
| 最终文字 | 只在 Kernel `assistant_message`；`finalMessageId` 取法已有，不判非空；binding 要取 `run.executionHistory.kernel`，历史页的 `executionIdentity` 只有 `{runId,turnId}` | `handoff-brief-assembly.ts:390-400`；`contracts/core/execution-history.ts:10`；`execution-history-contracts.ts:10` |
| 工作区 effects | `RunActivity` 有 changed files/lines，无 `effects` 字段；Evidence 未接 | `contracts/run-activity.ts:34-41`、`:79`；`evidence-service.ts:840-872` |
| 读口 | `tasks/query` 无 `TaskRow.reduction`；`graph/look` 无 `evidence` 关系；无 `readEvidence` | `plan-service.ts:1902-1940`；`graph-context-contracts.ts:77-83` |
| Workflow | `open_checks→run_check→finalize_checks→complete_task`，无 witness step（本片也不需要） | `workflow.ts:270-285`、`:2507-2553` |

### 3.2 偏差（唯一总表）

| ID | 设计/规格怎么说 | 代码/现状 | 影响 | 落法 |
| --- | --- | --- | --- | --- |
| D-1 | `S9:533`/`:579` 引 `DESIGN.md:1479` | 当前在 `:1482`（+3） | 行号差 | 本规格引 `:1482` |
| D-2 | `S9` 要求覆盖按 subject task 过滤（`S9:151`、`:281`）；完成归约已按 task 过滤（`completion-policy.ts:45`） | 编译器只按 required 过滤（`verification-plan.ts:70`） | 见证会把别的 task 的 witness 要求/路径带进本轮 | 本轮 witness 分支按 `obligation.taskIds.includes(subject.taskId)` 筛；命令分支不动 |
| D-3 | 第一稿假设“新项目 policy 默认”是生产常量 | 树里没有该常量；新项目实际默认是 initial-planning 提示词/sample 的 `["static"]`（`initial-planning-answer.txt:75`），`initialization-adoption.ts:242-249` 原样安装模型答案 | 加 `witness` 要改指南/schema，不是改常量 | 按 §5.1 改提示词/sample；旧项目不迁移 |
| D-4 | 裁定要求缺 witness 要求走“现有诊断 finding” | 计划期只有 closed code 的 `PlanValidationError`（`plan.ts:228`）和未合入的 PL-1 finding；没有可复用的开放 finding | 不加 `missing_witness_requirement` 时，平台无法在计划期自动点名 | 只写计划指南；不新增 code；轮期由现有 `RoundSnapshot.gaps`/完成 `requirementKey` 定位；见 §7-L3 |
| D-5 | `evidence.ts:65` 注释说 `runRef` 是“produced the report” | 唯一生产者固定写 null（`evidence-service.ts:1617`） | 没有“报告来自某个 Run”的 Evidence；纯文字 body 会跨项目共用先写者 origin | 见证写 `round.subjectRunRef`；报告 body 也带 `roundRef`/`subjectRunRef`（§5.2 第 10 步）；命令检查保持 null |
| D-6 | L-5 要复用原 check-result 事件 + `pending→finished` | 持久化事件可复用；内存 `CheckEvent` 的 `invocationId:string`、`observation`、`reportRef:ArtifactRef` 和 `CheckPhaseChange.finished.reportRef` 必填，admission/`withCheckPhase` 只认 executing；`changedCheck` 对所有 finished 读 `resourceCapHit` | 原样复用会拒绝 pending；新持久化事件也解决不了内存必填 | 只加内存见证臂和见证 finished change；`changedCheck` 在 `:987` 前按 `witness===true` 早退；admission/transition 共用 `guardCtx`；见 §4.2、§5.3 |
| D-7 | 第 5 条要“工作区没有变化” | `capture` 的 `runBaselineKnown:false`，明写不能证明 no-change（`verification-workspace-reader.ts:80`/`:86`、`:77`）；非 Git 给 `current-workspace-only`、`changedFiles:[]`、writeSummary“unknown, not empty”（`:78-82`） | 不能用 `capture`/`changedFiles` 判 none | 用 `RunActivity`；非 Git 按 L-12 INCONCLUSIVE |
| D-8 | 旧草稿说 native read 可取 path/revision/startLine/endLine | 当前树 Kernel 记录信封只有 `call.arguments.path` 和 `result.status`，没有 revision/行范围/字节数；vendor read 工具不在树内 | “整文件”判不出 | 本稿按“一次成功读 path”判；binding 取 `run.executionHistory.kernel`，页上的 `executionIdentity` 只作 Run/Turn 身份；见 §7-L1 |
| D-9 | `finalMessageId` 的现成取法不判非空（`handoff-brief-assembly.ts:396-400`） | 空串也会返回 | 空报告可能被当报告 | 见证加 `trim().length>0`；空/纯空白 FAIL |
| D-10 | 完成链今天不强制 witness 的 `reportRef!=null`、`sourceStatus==='matched'`、`Evidence.source.runRef!=null` | `finalizeChecks` 只复制已冻结的 `check.reportRef`；完成只看 finalized PASS + `evidenceRefs>0` | 可能写出 PASS 但报告 ref 为空的 Evidence | 守卫放 `recordWitness` 写入层：PASS 必须三条同时成立且 `knownFailure`/`hasGap` 为空；三态事实不用 null/空数组冒充 unknown |

---

## 4 模型

### 4.1 类型（最小新增）

```ts
// contracts/plan.ts
export type VerificationRequirement = {
  // ...existing: requirementId, requirementLevel, kind, description
  requiredReadPaths?: readonly string[];   // 只对 kind==='witness' 有意义
};

// contracts/verification.ts
export type VerificationCheckKind = 'static' | 'dynamic' | 'reviewer' | 'witness';

export type RegisteredWitnessCheck = {
  checkId: string;                          // 编译器固定写 'platform:witness'
  kind: 'witness';
  requiredReadPaths: readonly string[];
};

export type RoundCheckDefinition = RegisteredCommandCheck | RegisteredWitnessCheck;

// VerificationCheckPlan 增可选 requiredReadPaths（编译产物，供开轮时写 definition）
// RoundCheckSnapshot.definition: RoundCheckDefinition
// CheckExecutionTicket.definition: RegisteredCommandCheck（不动）
```

- **一个轮次一条 `platform:witness`。** 编译器把本轮 subject task 的所有 required witness 要求合并成一条 check：`coverage` 取并集，`requiredReadPaths` 去重取并集。一条 check 只有一个 outcome，所以任一要求缺项会让整条 FAIL/INCONCLUSIVE；**all-or-nothing，不承诺按 requirement 分判**。B06-W4 用只映射一条 witness 要求的轮来断言；多要求轮只断言整条 FAIL。
- **不改的持久化字段/状态。** `RoundCheckSnapshot` 的 `phase`/`invocationId`/`outcome`/`reportRef`/`sourceStatus`/`incompleteCause` 全部复用；见证 `invocationId` 恒为 null；不新增 RoundCheckSnapshot 的 witness 字段/状态。内存 `CheckEvent` 的 `witness` 判别字段只用于状态机（见 §4.2）。
- **`requiredReadPaths` 为空/缺失**：第 4 条没有要核的路径，算成立；第 3 条仍要求至少一次成功读取。探索任务开工时不一定知道该读哪些文件，这里判 INCONCLUSIVE 等于运行时的硬校验，任务又没法靠重做走出来（§7-L2）。
- **`satisfactionPath`** 沿用 `'predicate'`，不新增值；现树没有消费者读它（`verification-plan.ts:97-98`）。
- **事实端口（B06-02/B06-04）。** `WitnessFactsPort` 声明在 `core/work-graph/model/witness-facts-contracts.ts`（`WitnessFactsRequest` 为 `{runRef,kernel}`、`WitnessFactsPort.read`）。`WitnessFacts` 与 `WitnessCheckInput` 等三态类型放 `contracts/verification.ts`（`state` 只能 import contracts）。`kernel` 取 `subjectRun.executionHistory.kernel`，不取历史页的 `executionIdentity`。实现是 Runtime `core/agent-runtime/witness-facts.ts` 的 `readWitnessFacts` **一个函数**（读历史、`decodeKernelEntry`、`reduceTurnFromStart` 都在里面），组合根注入；Evidence 只拿 `WitnessFacts`，不 import Runtime。返回/输入形状见 §5.2。

### 4.2 事件与 phase

**持久化事件不改。** 仍写 `VerificationCheckResultRecorded`，`result: RoundSnapshot`；事件闭集、`EVIDENCE_RECORD_SCHEMAS.events`、codec、replay、round 闭合 keys 都不动（`evidence-record-codecs.ts:94-128`、`:534-574`、`:778-780`）。见证的 `invocationId:null` 在 `result.checks[]` 里已合法（`verification.ts:143`；`evidence-record-codecs.ts:181`）。

**内存态加见证臂（L-5 放不下的地方）。**

```ts
// verification-machine.ts，仅内存态
| { kind: 'check_result_recorded';
    witness: true;
    checkId: string;
    invocationId: null;
    witnessed: {
      outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
      reportRef: ArtifactRef | null;
      sourceStatus: 'matched' | 'changed' | 'unavailable' | 'permission_changed';
      incompleteCause?: RoundCheckIncompleteCause | null;
    } }
```

- `CheckEvent`/`CheckEventHead` 各加这一臂（head 为 `{kind,checkId,witness:true}`）；命令臂不变（仍 `invocationId:string`、`observation`、`reportRef:ArtifactRef`，不带 `witness`）。
- `CheckPhaseChange` 加见证专用 finished 臂，用 `witness:true` 判别；命令臂保留 `witness?:false` 且 `reportRef:ArtifactRef` 非空：
  ```ts
  | { phase:'finished'; witness:true; outcome; reportRef:ArtifactRef|null; sourceStatus; incompleteCause? }
  ```
  `withCheckPhase` 用 `const source = change.phase==='finished' && change.witness===true ? 'pending' : CHECK_PHASE_SOURCE[change.phase];`；命令臂仍走 `executing→finished`。
- `checkEventAdmission`：见证臂要求 round open、调用者是 executor、check 存在且 `definition.kind==='witness'`、pin 当前、`phase==='pending'`；跳过 invocation 相等检查。命令臂不变。
- `transitionCheck`：见证臂不调 `outcomeFor`（没有 process observation），直接用 `witnessed.outcome`，仍 `checkWritten(..., 'VerificationCheckResultRecorded')`。
- **`changedCheck` 的 finished 收口（B06-03）。** `changedCheck`（`verification-machine.ts:975`）的 finished 分支在 `withCause`（`:986`）之后、`resourceCapHit` 返回式（`:987`）之前按见证判别：`if (change.witness === true) return withCause;`。见证臂因此走完 `:981-983` 的 outcome/cause 校验、返回不带 `resourceCapHit` 的快照；命令臂原样执行 `:987`，语义不变。不给见证补 `resourceCapHit`。`CheckPhaseChange` 命令臂必须显式声明 `witness?: false`，否则 `change.witness` 在联合类型上不可访问。
- **不新增 `incompleteCause` 值。** 来源不匹配用现有 `source_not_matched`；其余 INCONCLUSIVE 用 null/省略。`finished + INCONCLUSIVE + cause:null` 已被类型/codec 接受（`verification.ts:125-136`；`evidence-record-codecs.ts:191-197`；`verification-machine.ts:981-982`）。

**为什么新持久化事件不是答案。** 加一个 `VerificationWitnessResultRecorded` 仍要改同一组内存 `CheckEvent`/`CheckPhaseChange` 必填字段，还要多改闭集/codec/replay；它不解决 D-6，只增加面。L-5 的“放不下”精确指：`verification-machine.ts:340-341` 的 `invocationId:string`/`observation`/`reportRef:ArtifactRef`、`:929` 的 `finished.reportRef`、`:945-970` 的 executing-only 来源、`:1276-1292` 的 admission、以及 `recordCheckResult` 的非空 invocation+observation（`evidence-service.ts:1370-1371`）。

### 4.3 Evidence 与完成折叠

- `finalizeChecks` 的 verdict 构造块（`evidence-service.ts:1610-1625`）只改 `source.runRef` 一处：`definition.kind==='witness' ? round.subjectRunRef : null`。`summary.artifactRef` 今天已等于 `check.reportRef`（`:1620`），不再改。
- `kind:'verdict'`、`EvidenceSnapshot.revision:1`、`coverage`/`anchor`/`verificationPlanRef` 全部复用；不新增 Evidence kind/字段。
- `finalizeRoundOutcome`/`foldVerdictChecks`/`evaluateTaskCompletion` 不加 witness 分支；witness 的 `coverage` 是普通 requirement coverage，缺证据走现有 `missingKeys` → `blocked`/`missing_evidence`，不学 reviewer 硬停。
- `reviewerEvidence` 不碰（传 undefined）。第 9 片前它被拒、9 后按 9 的路径处理；B06 不依赖它。
- **PASS 守卫在写入层**：见 §1.2；不要指望 finalize 兜底，finalize 只复制已冻结的 `reportRef`。

---

## 5 施工（W-2 到 W-7）

### 5.1 W-2：计划、政策、检查生成

**谁调/读/写/出口：**

| 谁 | 做什么 | 读 | 写 | 出口 |
| --- | --- | --- | --- | --- |
| 规划模型/参谋 | 在只读探索任务的 required obligation 上写 `kind:'witness'` + `requiredReadPaths` | 任务定义、政策、指南 | 计划候选 | 计划候选 |
| `validatePlanDraft` | 只做现有 `kind` 成员校验（`plan-validation.ts:136-140`） | 计划、政策 | 无 | ok / `unknown_requirement_kind`；**不加** witness 专用 code |
| `prepareRoundOpening` | 追加内置 witness capability，编译计划 | 政策、obligations、subject task | `verificationPlan` | round open |
| `compileVerificationPlan` | 为 subject task 的 witness 要求生成 `platform:witness` | capabilities、obligations | `VerificationCheckPlan[]` | checks/uncovered |
| `pendingRoundChecks` | 为 witness plan check 合成 definition（不查 `configuration.checks`） | plan check | `RoundCheckSnapshot[]` | round opened |

**步骤。**

1. **计划字段。** `VerificationRequirement` 加可选 `requiredReadPaths?: readonly string[]`；`answer-tools.ts:280-292` 的 `requirementSchema`（`.strict()`）加可选数组，`submit_initial_plan.json` 的 `plan.obligations` 说明加字段。不新增任务字段，不把路径放 `RuntimeTask`。
2. **计划指南。** 在 `resources/prompts/platform/templates/initial-planning-answer.txt:7`（obligations）后加一段：只读探索（PL-1 的 `sizeClass:'explore'`，且非 `plan_only`）的 required obligation，必须写一条 required `kind:'witness'` 的验证要求，知道必须读哪些文件时，用 `requiredReadPaths` 列出它们的 workspace-relative 路径；计划含 witness 要求时，`setup.completionPolicy.requirementKinds` 必须含 `witness`；报告就是执行者的最终文字，不要求固定段落。`plan_only` 不适用。PL-1 合入后重指 `sizeClass`/`PL:712`、`:724`、`:1897`。
3. **新项目 policy 默认。** 树里没有生产默认常量（D-3）。把 `initial-planning-answer.txt:75` 的 sample `["static"]` 改成 `["static","witness"]`，并同步 `submit_initial_plan.json:15` 的说明与 `tests/helpers/S6A-prompt-samples.ts` 的镜像文本；指南/schema 还要明写“计划含 witness 要求时 `setup.completionPolicy.requirementKinds` 必须含 `witness`”，新项目 happy path 测这条。`prompts/platform-pack.generated.ts` 用 `scripts/build-platform-prompts.mjs` 重建（脚本不在本快照，到有脚本的树重建）。旧项目按决定 79-1 不迁移、不补写、不加设置入口；旧 policy 没有 `witness` 时，带 witness 要求的计划按现有 `unknown_requirement_kind` 拒，属预期。
4. **内置 capability。** `prepareRoundOpening` 的能力表（`evidence-service.ts:992-993`）追加：
   ```ts
   { checkId: 'platform:witness', kind: 'witness', coversKinds: ['witness'], replayable: false }
   ```
   没有 witness 要求时编译器不会产出 witness check，`planDigest` 不变。
5. **编译器。** 在现有循环里，witness 要求只接受 `obligation.taskIds.includes(subject.taskId)`（D-2）；同一 `checkId` 合并 `coverage` 和 `requiredReadPaths`（去重）。命令分支保持现状，不做全局 task 过滤，避免改旧 plan 的 coverage/digest。`uncovered` 的 kind 类型包含 `'witness'`。`verificationPlan.checks`/`planDigest` 按过滤后的 witness 结果算。**多 task obligation**：witness 要求会进入每个 `taskIds` 映射的轮，这是计划作者共享该义务的结果，平台不做额外归属推断；计划指南要求把 witness 要求放在只映射该只读任务的 obligation 上。**gate** 不额外排除，按同一 `taskIds` 规则；只读 gate 可以用 witness，非只读 gate 由计划作者不要写 witness 要求。
6. **pendingRoundChecks。** `verification-machine.ts:884-895` 遇到 `planCheck.kind==='witness'`（或 `checkId==='platform:witness'`）时，不查 `configuration.checks`，直接构造 `{checkId:'platform:witness', kind:'witness', requiredReadPaths: planCheck.requiredReadPaths ?? []}`；`phase:'pending'`、`invocationId:null`、`outcome:null`、`reportRef:null`、`sourceStatus:null`。`roundOpenChecksProblem`（`:1237-1240`）对 witness 跳过“必须在 configuration 注册”的检查。**合成只放 `pendingRoundChecks`**；`buildOpenedRound`/`buildSuccessorRound`/`roundOnReverified` 都经它，不重复写；补 reverify/successor 的 witness 测试。
7. **Host 配置。** `TrustedCheckConfiguration.checks`/`CheckExecutionTicket.definition` 不动；只在 `validRegisteredCheck`/`validProposalCheck` 拒绝 `checkId==='platform:witness'`（保留 id，防同 id 命令影子）。
8. **不加硬校验。** 不新增 `missing_witness_requirement`，不加 `PLAN_VALIDATION_CODES`。缺 witness 要求时平台不拒；按 §7-L3 只写指南。`plan_only` 原样。

**出口。**

- 政策没有 `witness` → 现有 `unknown_requirement_kind`；
- 只读探索漏写 witness 要求 → **不拒**，没有 witness check；计划指南/审阅提示；
- 编译器没有 witness capability → 现有 `uncovered`；
- Host 注册 `platform:witness` → 校验拒绝。

### 5.2 W-3：见证读取与判定

**位置。** `EvidencePort.recordWitness`（`evidence-service.ts`）负责取事实、核来源/`RunActivity`、物化、判定、提交；outcome 折叠放 `core/work-graph/state/witness-check.ts`（只 import `contracts`、无 IO）；路径三态判据放 `evidence/witness-path-verdicts.ts`（只 import `isSafeSourceRelativePath` 和 contracts）。历史事实（最终文字、成功读取集合）由 Runtime 的 `WitnessFactsPort` 实现提供：`WitnessFactsPort` 声明在 `core/work-graph/model/witness-facts-contracts.ts`，实现是 `core/agent-runtime/witness-facts.ts` 的 `readWitnessFacts` **一个函数**，组合根注入。Evidence 只 import model 的端口类型和 contracts 的三态类型，**不 import** `agent-runtime`/vendor；不建新的 reader 类，不恢复已删的 `readonly-read-witness-reader.ts`。

**谁调/读/写/出口：**

| 谁 | 做什么 | 读 | 写 | 出口 |
| --- | --- | --- | --- | --- |
| `runRegisteredCheck` | 在 `phase!=='pending'` 早退后、读 configuration/建沙箱前，按 `definition.kind==='witness'` 分派 | round/check | 无 | 调 `recordWitness` |
| `recordWitness` | receipt-first、绑定 ctx、读 round/check/Run、取 `WitnessFacts`、核来源/effects、路径三态、物化、判定、写 check | round、check、subject Run、`WitnessFacts`、来源、`RunActivity`、body store | 报告 artifact、round finished + 事件 + 回执 | committed/rejected/invalid/unavailable |
| `WitnessFactsPort.read`（Runtime `readWitnessFacts`） | 读 subject Run 的历史、`decodeKernelEntry`、`reduceTurnFromStart`、收集成功读取 | Run locator、execution history | 无 | `WitnessFacts`（`report`/`reads` 三态） |
| `runWitnessCheck` | 纯函数：三态输入 → outcome | `WitnessCheckInput` | 无 | `WitnessCheckResult` |

```ts
recordWitness(
  ctx: CoreCallContext,
  request: GraphWrite<{ roundRef: VerificationRoundRef; checkId: string }>,
): Promise<WriteResult<RoundSnapshot>>;
```

`EvidenceServiceDependencies`（`evidence-service.ts:840-872`）在 `records`/`executions` 旁加必填 `witnessFacts: WitnessFactsPort`。生产组合根在 `create-platform.ts:1633` 的 `graphHistory` 之后构造 `const witnessFacts: WitnessFactsPort = { read: (ctx, request) => readWitnessFacts({ graphHistory }, ctx, request) };`，在 `:1659` 的 `createEvidenceService` 注入；`witnessFacts` 是内部依赖，**不发布**到 `platform`。生产只有一个构造点，缺依赖的分支走不到，所以都是必填：25 个构造调用补 `witnessFacts`（生产 1、测试 24），`EvidencePort.recordWitness` 也必填，测试双打补 13 处。`R3e-evidence-fixture.ts:325` 用可控 stub（B2 只有 locator/positions，没有真实 Kernel 记录）。`platform.evidence` 在 `recordCheckResult` 之后发布 `recordWitness`；在 `R3e-command-check-platform.test.ts:82` 的 `prepared()` 后断言 `typeof platform.evidence.recordWitness==='function'`。runner 依赖仍是完整 `EvidencePort`。

**`recordWitness` 的严格顺序。**

1. **receipt-first。** 在首次 await 前 `bindTrustedContext(ctx)`（同 `recordCheckResult`，`evidence-service.ts:1361-1363`）。identity = `identityKeyOf('b06-witness:', actor, scope.projectId, scope.workspaceId, owned.requestId)`；fingerprint = `fingerprintOf({kind:'b06-witness', roundRef, checkId, expected: owned.expected})`。先 `lookupReceipt`：`found` → `replayEvent` 返回原 `RoundSnapshot`（`replayed:true`、原 cursor、同一 value），不读事实/来源、不写 body；`failed` → 原 rejection；只有 `absent` 才继续。同 requestId 改 `meta.expected[0]` 的 `ref`/`revision` → fingerprint 不同 → `idempotency_conflict`（照 `recordCheckResult`，`evidence-service.ts:1379-1387`、`:485-494`、`:498-513`）。
2. **读 round/check，绑定守卫 ctx。** `checkRoundPin(owned.expected, input.roundRef)` 得 `checked.revision`（是 pin，不是 `round.revision`）；读 round 后构造**唯一** `guardCtx = roundCtx(round.executor, actor, checked.revision)`（`:254`）。`checkEventAdmission` 与 `transitionCheck` 共用 `guardCtx`；所有 IO 用绑定后的 `ownedCtx.ctx`，提交用 `ownedCtx.signal`；不得把 `CoreCallContext` 传给状态机。admission 见证臂：round open、调用者 executor、check 存在且 `definition.kind==='witness'`、pin 当前、`phase==='pending'`；跳过 invocation 相等检查。已 finished 的 check 由 runner 在 `check-execution.ts:143` 早退返回 ready；并发 writer 的 `busy` 让 `run_check` waiting，下一次 `select_work` 无 pending 即 finalize。
3. **读 subject Run。** 用 `deps.executions.readExecution(ownedCtx.ctx, round.subjectRunRef)`；非 `ready`/坏记录 → `run:{state:'unknown'}`，`report`/`reads`/`paths`/`effects` 记 `unknown`，`source:'unavailable'`，短路判 INCONCLUSIVE。`ready` 时 `const subjectRun = result.value.run`，要求 `status==='ended'`、`outcome==='completed'`；`reconciliation` 缺省或 `status==='done'`（与 `roundSubjectRunProblem` 一致，`verification-machine.ts:1203-1211`）。不满足 → `run:{state:'not_applicable'}`，`report`/`reads` 记 `unknown`，`paths` 全 `unknown`，`source:'unavailable'`，`effects:'unknown'`，**短路**，不再读历史/来源/`RunActivity`；判 INCONCLUSIVE（cause null），不是 rejection。满足 → `run:{state:'applicable'}`，并取 `const binding = subjectRun.executionHistory?.kernel`（完整 `KernelExecutionBinding` 四字段 `adapterId`/`kernelSessionId`/`runId`/`turnId`，`contracts/core/execution-history.ts:10`、`execution-entry-contracts.ts:34`）。`executionHistory===undefined` → 历史缺口：`report`/`reads` 记 `unknown`，不调 port；不得用 `executionAuthorization.kernel` 或页字段补 binding。
4. **取历史事实（port）。** `const facts = await deps.witnessFacts.read(ownedCtx.ctx,{runRef:round.subjectRunRef,kernel:binding})`。Runtime 实现从 `afterCursor:null` 起循环 `readTaskExecutionHistory(ctx,{runRef,afterCursor,limit:200})`，直到 `nextCursor===null`；不设页数上限。第一页 `executionIdentity` 只是 `{runId,turnId}`（`execution-history-contracts.ts:10`、`:23-27`），仅用于核对属于该 Run/Turn，**不能**当 binding。每页 `JSON.parse`/`decodeKernelEntry`；`null` → 缺口；`reduceTurnFromStart(decoded,binding)` 为 `null` → 缺口。读失败/解码失败/归约失败 → `report`/`reads` 的 `unknown`，不 rejection。**事实读取的 gap 不透传为 rejection**：除了 receipt 冲突、pin 过期、存储暂不可用这类基础设施错误，所有“读不到/解不开/判不出”都记 `unknown` 并继续提交。
5. **最终文字与成功读取（在 Runtime 实现内，同一批 pages）。** 最终文字：`RunState.outcome.kind==='completed'` 时取 `finalMessageId` 命中的 `assistant_message.content`（`handoff-brief-assembly.ts:390-400`）；无 message / `trim().length===0` → `report:{state:'absent'}`；结构坏或 outcome 非 completed → `unknown`。`present.text` 保留执行者原文，`trim()` 只用于判空，不裁剪落库。读取集合：实现内的 `successfulReadPathsOf(decoded)` 同批事件按 `callId` 配 `tool.started` 与 `tool.completed status==='success'`；native `read` 取 `arguments.path`；`read_source` 取成功 JSON 的 `output[0].value.path`，并要求与 `arguments.path` 一致；`truncated` 不参与 A 口径。成功 path 原样保留，不 `resolve`/`normalize`；解不开 → `reads:{state:'unknown'}`；`known.paths` 可为 `[]`（已知零读取）。
6. **路径三态（Evidence 侧）。** 进入纯判定前，对每条 `requiredReadPaths` 调 `isSafeSourceRelativePath(path)`（`workspace/path-validation.ts:3`）：`false` → 该条 `unknown`（**不是** `absent`）；`true` 且 `reads.state==='known'` → 在成功 path 的 `Set` 上精确 `has`，得 `present`/`absent`；`reads.state==='unknown'` → 该条 `unknown`。不做大小写/Unicode/realpath 归一，不另写绝对路径、分隔符、点段校验器。
7. **核来源。** 在 Evidence owner 内复用 `evaluateSource`（`evidence-service.ts:911-929`）：`resolveRoot`→`authorize`→比 permission revision→`capture`；`sourceStatus` 用现有四值。不是 `matched` 算 `hasGap`，cause 按 §5.2 的“纯函数输入/输出”写。
8. **核 effects。** 先看 `round.sourceProof.kind`；不是 `git-head-worktree` → unknown → INCONCLUSIVE（§7-L4；与其他缺项的优先级见 §7-L5）。否则用 Evidence 已有的 records 端口按 `runActivityRefKey({aggregateType:'RunActivity', projectId:round.subjectRunRef.projectId, goalId:round.subjectRunRef.goalId, runId:round.subjectRunRef.runId})` 读 `RunActivity`、`decodeRunActivitySnapshot` 解码；按 §1.1 判 `none|changed|unknown`。缺失/坏/未知 → INCONCLUSIVE；`changed` → FAIL。本片不现场补算，旧记录走现有 `activity/backfill`（14 天窗口）再由人重试。
9. **判定。** 装成 `WitnessCheckInput`（`run`/`report`/`reads`/`paths`/`source`/`effects`）；`runWitnessCheck(input)` 先算 `knownFailure`/`hasGap`，再按 `knownFailure ? FAIL : hasGap ? INCONCLUSIVE : PASS` 返回。只有五条全成立且 `sourceStatus==='matched'` 才 PASS；`knownFailure` 与 `hasGap` 的口径见 §1.2。
10. **物化报告（有文字时）。** `deps.materials.storeArtifact(ownedCtx.ctx,{contentType:REPORT_CONTENT_TYPE, body:JSON.stringify({roundRef:round.ref, subjectRunRef:round.subjectRunRef, reportText}), sources:[{kind:'plan-revision', refId:round.adoptedPlanRef.planId, revision:String(round.verificationPlan.planRevision)},{kind:'workspace', refId:round.configuration.workspace.workspaceId, revision:String(round.identity.workspaceRevision)}], origin:{kind:'platform_operation', projectId:round.subjectRunRef.projectId, workspaceId:round.configuration.workspace.workspaceId, requestId, actor:round.executor}})`。`REPORT_CONTENT_TYPE` = `application/vnd.coding-platform.verification-check-report+json;version=1`（`contracts/no-progress.ts:25`），不新造 content type；`reportText` 原样，`JSON.stringify` 只做语法转义。`materials/open` 返回原始 body 字符串，W12 自己 `JSON.parse`。`sources` 非空；`origin.actor` 必须等于 principal（`material-service.ts:278-283`）。按 `StoreArtifactResult` 的 `stored/rejected` 分支取 ref/replayed；`size_exceeded` 只把 PASS 改成 INCONCLUSIVE，FAIL 保持 FAIL，两种都 `reportRef:null`；不另查一遍大小；其他存储错误 → `unavailable` 拒绝（可重试）。
11. **写 check。** `transitionCheck(round,{kind:'check_result_recorded', witness:true, checkId, invocationId:null, witnessed:{outcome,reportRef,sourceStatus,incompleteCause}}, guardCtx)`（同一个 `guardCtx`）；一次 `commitRoundWrite` 写 round@rev+1、check finished、事件、回执。**不写 Evidence/index**（留给 finalize；否则 `roundOnFinalized` 的 `evidenceRefs.length!==admissions.length` 会 illegal，`verification-machine.ts:1578-1583`）。
12. **返回。** `WriteResult<RoundSnapshot>`；committed 的 value 是 finished check 的 round。

**报告 artifact 的归属限制（事实）。** Host 用 `platform_operation` 写出的 artifact `ownerRunRef` 为 null；读只能用 `historical_explanation`，`current` 一律 `source_stale`（`applicability.ts:38-47`、`:93-98`）。因此见证在同一个 `recordWitness` 里直接用已构造的结构化 body 和 `storeArtifact` 返回的 ref 判定，不重新 `openArtifact('current')`；报告归属由 `check.reportRef` + Evidence `source.runRef` 表达，不靠 artifact owner。正文是 commit 前写的 body store，不在 PreparedCommit；“同一次提交”只含 round/ref/event/receipt。崩溃重试留下的**同一 round 同结构** body 由 content-addressed first-writer-wins 复用，不作为业务记录；不同 round 即使 `reportText` 相同，body 的 `roundRef`/`subjectRunRef` 也不同，不复用先写者来源。

**纯函数输入/输出（类型放 `contracts/verification.ts`）。**

```ts
export type WitnessRunState =
  | { state: 'applicable' }
  | { state: 'not_applicable'; reason: string }
  | { state: 'unknown'; reason: string };

export type WitnessReport =
  | { state: 'present'; text: string }      // 执行者原文；空/纯空白不得进 present
  | { state: 'absent' }                     // 已知没有最终文字
  | { state: 'unknown'; reason: string };   // 历史/归约读不出

export type WitnessReadSet =
  | { state: 'known'; paths: readonly string[] }  // 可为空数组：已知零读取
  | { state: 'unknown'; reason: string };         // 绝不是空数组

export type WitnessPathVerdict = {
  path: string;
  state: 'present' | 'absent' | 'unknown';
};

export type WitnessFacts = {                 // WitnessFactsPort 的返回
  report: WitnessReport;
  reads: WitnessReadSet;
};

export type WitnessCheckInput = {
  run: WitnessRunState;
  report: WitnessReport;
  reads: WitnessReadSet;
  paths: readonly WitnessPathVerdict[];      // owner 已按 isSafeSourceRelativePath + 精确匹配算好
  source: 'matched' | 'changed' | 'unavailable' | 'permission_changed';
  effects: 'none' | 'changed' | 'unknown';
};

export type WitnessCheckResult = {
  outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  incompleteCause?: 'source_not_matched' | null;
  missingPaths: readonly string[];            // 只从 state==='absent' 过滤，返回值/测试用，不落新字段
};
```

`WitnessFactsPort` 与 request 放 `core/work-graph/model/witness-facts-contracts.ts`：

```ts
export type WitnessFactsRequest = {
  runRef: RunRef;
  kernel: KernelExecutionBinding;   // subjectRun.executionHistory.kernel
};
export interface WitnessFactsPort {
  read(ctx: CoreCallContext, request: WitnessFactsRequest): Promise<WitnessFacts>;
}
```

`WitnessFacts` 只含 Runtime 能证明的 `report`/`reads`；Run 适用性、`paths`、`source`、`effects` 由 Evidence owner 算进 `WitnessCheckInput`。`runWitnessCheck` 先算 `knownFailure = report.state==='absent' || (reads.state==='known' && reads.paths.length===0) || paths.some(p=>p.state==='absent') || effects==='changed'`；`hasGap = run.state!=='applicable' || report.state==='unknown' || reads.state==='unknown' || paths.some(p=>p.state==='unknown') || source!=='matched' || effects==='unknown'`；再按 `knownFailure ? FAIL : hasGap ? INCONCLUSIVE : PASS` 返回（等价于 `knownFailure ? FAIL : hasGap ? INCONCLUSIVE : runWitnessCheck(knownFacts).outcome`）。`requiredReadPaths.length===0` 不放进 `hasGap`（§7-L2）；来源不是 `matched` 不放进 `knownFailure`（§1.2）。先定 outcome，再定 cause：只有 `outcome==='INCONCLUSIVE' && run.state==='applicable' && source!=='matched'` 才写 `source_not_matched`，其余都是 null。FAIL 不带这个 cause，否则状态机会拒（`verification-machine.ts:981`）。

**失败映射。** 见 §1.2。**不要**把来源不匹配写成 `frozen_source_changed` 拒绝；那会变成 pending gap，而不是已判定的 INCONCLUSIVE（`workflow.ts:2518-2525`）。

### 5.3 W-5：状态、事件、codec

**谁调/读/写/出口：**

| 谁 | 做什么 | 读 | 写 | 出口 |
| --- | --- | --- | --- | --- |
| `recordWitness` | 提交 finished check | round/check | round@rev+1 + 事件 + 回执 | `committed`/`rejected` |
| `transitionCheck` | 见证臂 `pending→finished` | event/round | 下一 round | `RoundSnapshot` |
| `displayRoundStatus` | pending 的轮仍 incomplete | checks | 无 | 不变 |
| `finalizeRoundOutcome` | finished 计入 PASS/FAIL/INCONCLUSIVE | checks | 无 | 不变 |

**步骤。**

1. 持久化事件沿用 `VerificationCheckResultRecorded`；不改 `VERIFICATION_ROUND_EVENT_TYPES`、`EVIDENCE_RECORD_SCHEMAS.events`、`a2RoundEventProblem`、`roundSnapshotProblem`。事件闭集长度不变，老断言不改。
2. 内存 `CheckEvent`/`CheckEventHead` 加 §4.2 见证臂；`CheckPhaseChange` 加见证 finished 臂（`witness:true`、`reportRef` 可 null），命令臂显式 `witness?:false`；`withCheckPhase` 按 `witness===true` 取 `'pending'` 来源，命令臂仍走 `CHECK_PHASE_SOURCE`。`changedCheck` 在 `verification-machine.ts:986` 之后、`:987` 访问 `change.resourceCapHit` 之前收口：`if (change.witness === true) return withCause;`（§4.2）。
3. `checkEventAdmission` 在 `executingPhaseProblem` 之前分 witness：`phase==='pending'`、`definition.kind==='witness'`、跳过 invocation；仍查 open/executor/check/pin。**见证事件指向 command check 必须拒绝**（否则可伪造 command 结果）。
4. `transitionCheck` 的 `check_result_recorded` 加 witness case：不调 `outcomeFor`，直接写 `witnessed.outcome`；仍发原事件。传给 `transitionCheck` 的 ctx 必须是 §5.2 的 `guardCtx`（`RoundGuardContext`），不是 `CoreCallContext`。
5. `beginCheck` 在入口（`evidence-service.ts:1280`）先按 `definition.kind==='witness'` 返回 **`invalid`**（不是 `forbidden`），早于 `readRoundActivity`/`capture`；`:1344` 的 ticket 构造不再需要窄化。`recordCheckResult` 对 witness definition 同样拒绝（它要求非空 invocation + observation，`evidence-service.ts:1370-1371`）。
6. `incompleteCause` 不加新值；codec/continuation/no-progress 的闭集不动。
7. 重启：见证从不 `executing`，`startup-reconcile.ts:449-471` 只打断 `executing && invocationId!==null`，不会碰 pending/finished；不需要 VR-06 补账。

**不能怎么做。** 不能手写 round 字段绕状态机；不能给命令的 finished 放宽 `reportRef`/来源；不能为见证造 `CheckProcessObservation` 或 ticket；不能新增 `witnessing`/`witnessed` 状态；不能给见证 finished change 补 `resourceCapHit`，也不能让见证落入 `changedCheck` 的命令分支。

### 5.4 W-4：Evidence 入账

**谁调/读/写/出口：**

| 谁 | 做什么 | 读 | 写 | 出口 |
| --- | --- | --- | --- | --- |
| `finalizeChecks` | 折本轮 finished checks | round、plan、goal、run、source | Evidence + index + finalized round + 事件 + 回执 | `FinalizedChecks` |
| verdict 构造块 | 为 witness check 构造 verdict | check | `EvidenceV1` 候选 | admissions |
| `evaluateTaskCompletion` | 按 coverage 判完成 | effective set | 无 | satisfied/blocked/... |

**步骤。**

1. `finalizeChecks` 的 `source`（`evidence-service.ts:1617`）按 witness 写 `runRef:round.subjectRunRef`；`actor`/`checkId` 不变；`summary.artifactRef=check.reportRef` 原样；`summary.text` 仍 `check <id> <outcome>`；`coverage`/`anchor`/`verificationPlanRef` 不变。
2. `kind:'verdict'`、revision 1、index 追加、一次 commit（round+Evidence+index+`VerificationRoundFinalized`+receipt）全部复用（`evidence-service.ts:1635-1659`）。
3. `TaskCompletionAuditV1`/`TaskReductionSnapshot` 不加字段；witness Evidence 通过 `evidenceRefs` 被引用。
4. `evaluateTaskCompletion` 不改主干；witness FAIL/INCONCLUSIVE 使轮非 PASS，Workflow 不会进 `complete_task`；缺证据走现有 `missing_evidence`，带 `requirementKey`（`completion-policy.ts:102-136`）。**PASS + 完成归约通过 → Task `satisfied`，不需人工再确认**（U-2 a）。
5. `reviewerEvidence` 不碰；B06 不写。

**PASS 必要条件（最终）。** check PASS + `reportRef!=null` + `sourceStatus==='matched'` + 五条全成立 + `knownFailure`/`hasGap` 均为空 + 轮 finalize PASS + `gaps.length===0`。前五项（check PASS、`reportRef`、`sourceStatus`、五条、三态无缺口）在 `recordWitness` 写入时保证；后两项由现有 finalize/完成链保证。

### 5.5 W-6：执行分派（Workflow 不改）

**谁调/读/写/出口：**

| 谁 | 做什么 | 读 | 写 | 出口 |
| --- | --- | --- | --- | --- |
| `nextAfterRound` | 仍是第一个 pending → `run_check`；无 pending → finalize | checks | 无 | 不变 |
| `run_check` | 调 `runRegisteredCheck` | request | 无 | 不变 |
| `runRegisteredCheck` | 早退后按 definition 分派 witness | round/check | 无 | 调 `recordWitness` |
| `recordWitness` | 见 §5.2 | 见 §5.2 | 见 §5.2 | `WriteResult` → `ReadResult` |

**步骤。**

1. `check-execution.ts:138-143` 先读 round/check；`phase!=='pending'` 早退原样返回（已 finished 的见证不重判）。在 `:143` 之后、`:145` 读 configuration 之前加：
   ```ts
   if (check.definition.kind === 'witness') {
     const result = await deps.evidence.recordWitness(ctx, request);
     return result.status === 'committed'
       ? { status: 'ready', value: result.value }
       : result;   // 保留原 rejection
   }
   ```
   此时尚未 `WorkspaceSandbox.create`/`ProcessSandbox.probe`/`beginCheck`。
2. 返回 `WriteResult<RoundSnapshot>` 映射为 `ReadResult<RoundSnapshot>`：committed→ready，rejected→同一 `CoreRejection`。`run_check` 的 receipt（`workflow.ts:2517`）和 `nextAfterRound`（`:2527`）完全不变。
3. **不新增** `WorkflowCalls`/`performStep`/`nextAfterRound` 分支/VD-8 捷径；`finalize_checks` 仍是唯一 `complete_task` 前置。
4. `hasGap`（Run 不适用/历史/路径/来源/effects unknown）都写成 finished INCONCLUSIVE，不返回 VD-8 前缀拒绝；只有基础设施错误（receipt 冲突、pin 过期、存储暂不可用）才 rejection。
5. `beginCheck` 的 witness 拒绝见 §5.3；架构捕获触发（`create-platform.ts:1676-1685`）不改，witness PASS 走同一次 finalize，现状已覆盖。

### 5.6 W-7：公开读口（不新增路由）

| 段 | 今天 | 最小改法 |
| --- | --- | --- |
| Goal 完成 → task | `tasks/query` 的 `TaskGraph.completion` 有 GoalPhase（`plan-service.ts:1902-1940`） | 不动 |
| task → 采用轮/证据集 | `TaskReductionSnapshot` 有 `completion.roundRef/evidenceRefs`（`reduction.ts:52-73`），但 `TaskRow` 没有 | `TaskRow` 加 `reduction?: TaskReductionSnapshot`，在 `plan-service.ts:950` 的 `taskRow()` 从 `facts.reductionsByTaskId`（`plan-readers.ts:1055/1072` 的 map 声明）填入 |
| 轮 → check/证据 | `graph/look` 的 `checks` 已返回完整 `RoundSnapshot`（`graph-context-reader.ts:1665-1670`）；`evidenceRefs` 只有 id | `GraphLookRequestV1.relation` 闭集加 `'evidence'`（只对 round）；`NodeCardV1.evidence?: EvidenceV1[]`；新增 `EvidencePort.readEvidence`。`lookGraph` 分页后预读 `readEvidence` 再传给 `buildCard`（`buildCard` 是同步的） |
| 证据 → 报告正文 | `materials/open` 已有（`core-routes.ts:523`） | 不改；读 `historical_explanation`；body 是结构化 `{roundRef,subjectRunRef,reportText}`，展示取 `reportText`，W12 断言字段 |

**`readEvidence` 的作用域。** `EvidenceRef` 只有 `{aggregateType,projectId,evidenceId}`（`evidence.ts:4-8`），没有 workspaceId；不能照抄 `readVerification` 的 workspace 检查。实现要读 `EvidenceV1.subject.goalId` 的 Goal，核 Goal 的 workspace 绑定与当前 scope 一致；不一致 `forbidden`，坏记录 `unavailable`。注入 `GraphContextReaderDependencies` 的同一个 evidence 实例，并把 `readEvidence` 加进 `platform.evidence` 发布组（`create-platform.ts:2151-2163`）。不新增 `verification/read`/`evidence/read` 路由，不加 architecture allowlist。文件版本止于 `round.identity.workspaceRevision/sourceDigest`、`sourceProof.baseCommit/changedFiles`；逐文件 hash/diff 仍不提供。

### 5.7 冷启动、重启、Run 还在跑

| 起点 | 发生什么 | 见证的行为 | 依据 |
| --- | --- | --- | --- |
| 冷启动（无租约） | 不核对、不重驱 | pending 保留、finished 保留；另一个持租约 Host 或人推进 | `host.ts:1671` |
| 冷启动/重启（有租约，auto） | 只把 open 轮里 `executing && invocationId!==null` 的 check 改 `interrupted(host_restart)`；不 finalize、不跑 pending、不碰 finished | 见证从不 executing；pending 由启动重驱的 `select_work` 再选 `run_check`；finished 由 `finalize_checks` 折 | `startup-reconcile.ts:449-471`；`host.ts:1699-1715` |
| 重启（ask/off） | 同样 interrupt executing；不自动重驱 | 同上，等人 `workflow/advance`/`driver-start` | `host.ts:1703`；`workflow.ts:1058-1141` |
| 提交前崩溃（check 仍 pending） | 无 receipt/事件；报告 body 可能已写（`commitBarrier.hold(byIdentityPrefix('b06-witness:'))` 卡真实 commit 前） | 重试 `recordWitness`，从已持久化的 Run 历史/终态重算；同 round 同结构 body 复用；不需要 VR-06 | `evidence-service.ts:515-526`；`body-store.ts:27-46`；`S6A-commit-barrier.ts:133` |
| 已 finished、轮未 finalize | 核对不碰 finished | 下一次 `select_work` 无 pending → `finalize_checks`；不重跑见证 | `workflow.ts:278-284` |
| Run 还在跑 | `openVerification` 拒绝“has not formally ended”；Workflow 等 `normalEnd` | 不能见证；等 Run ended+completed（reconciliation 缺省或 done） | `evidence-service.ts:1121-1149`；`verification-machine.ts:1201-1211`；`workflow.ts:2492-2505` |
| Run 结束但非 completed，或 reconciliation 存在但未 done | 开轮拒绝；若已开轮后窗口变化，见证再核后 INCONCLUSIVE | 不能 PASS；按现有非 PASS 路径 | 同上 |
| 报告已产出、见证未入账 | 无补账 | pending 重跑读取同一 facts；不重跑执行者 | `verification-machine.ts:29-33` |

**幂等（owner 级，B06-09）。** `recordWitness` 必须先 receipt-first：同 actor/scope/requestId + 同 `roundRef/checkId/expected` 在 `checkRoundPin`、读 round/来源、写报告**之前**命中 `lookupReceipt`，直接回放原 `RoundSnapshot`（`replayed:true`、原 cursor、同一 value），不再读来源/不再物化；只有 `not_found` 才继续。同 requestId 换 pin（`meta.expected[0]` 的 `revision`/`ref`）→ fingerprint 不同 → `idempotency_conflict`，不得落到 pin/状态检查。这个行为由 W8b 直接调公开 `recordWitness` 证明：首次提交后改变来源，同 request 再调应回放；两个重启窗口证明不了它（提交前无 receipt；finished 后 runner 在 `check-execution.ts:143` 早退，根本不进 owner）。已 finished 的 check 由 runner 早退返回 ready；并发 `busy` 让 `run_check` waiting，下一次 `select_work` 无 pending 即 finalize。不靠 VR-06 补账。

---

## 6 测试（W-8）

**口径。** 一行一个真实业务流程，经公开入口：`workflow/advance`、`tasks/query`、`graph/look`、`materials/open`；计划/policy 行走 `submit_initial_plan`/`plans/propose`，不混入这四个读口。不读 store、不手调内部函数。业务版本用 memory；只有“实际重启”的行用 SQLite。**需要 PASS/effects/changed 的行必须显式建 Git 工作区**（`gitWorkspace:true` 或测试先 init Git 基线）；否则非 Git 第 5 条直接 INCONCLUSIVE。先写失败测试，再改实现；每行配一个具名改坏方式（删哪个分支/改哪个数组）。不用脚本模型的“渲染文本”冒充见证判定；PASS/FAIL 必须由 `runWitnessCheck` 的机械规则产生。重放优先用 `workflow/advance` 再推进同一轮；公开入口无 seam 的负例（损坏 `RunActivity`、缺 `finalMessageId`、路径不可判）允许 owner 级/纯函数测试并单独标注；owner 级同请求重放用公开 `recordWitness`，单独标 W8b。`read_source` 没有生产授予路径（`includeReadSource` 只在测试设置），所以 W1b 只能是 owner 级（真实工具 + 真实历史），不是公开业务流程。ProcessSandbox 用测试文件自己的 `vi.mock` spy（`probes/executes`），modelCalls 用 harness；都不作为业务读口断言。

### 6.1 验收行

| # | 行（谁在什么世界做什么） | 证明什么 | 让它变红的改坏方式 |
| --- | --- | --- | --- |
| B06-W1a | 真实平台（**Git 工作区**）：一个只读普通 Task，Run 实际用 native `read` 读了 `requiredReadPaths` 列的文件，最终文字非空；`workflow/advance` 走 `open_checks→run_check→finalize_checks→complete_task`；`tasks/query`/`graph/look`/`materials/open` 读回 | witness PASS；Evidence `kind:'verdict'`、`source.runRef=subjectRunRef`、`summary.artifactRef` 非 null；Task `satisfied`；check 快照 `invocationId:null`；测试文件的 `ProcessSandbox` spy `probes/executes` 为 0、modelCalls 无二次 | 删掉 `runRegisteredCheck` 在 `check-execution.ts:143` 之后、`:145` 之前的 `check.definition.kind==='witness'` 分派，让它落入命令路径（probe 先跑、`beginCheck` 以 `invalid` 拒绝、advance 停在 `run_check` waiting，不能 PASS/完成）；无条件 PASS 由 W2/W3/W4/W6/W7 负例行捕获，不写在本行 |
| B06-W1b | **owner 级（Git 工作区）**：用 `runObservedModel({sourceTools:{includeReadSource:true}})` 产生一次成功的 `read_source`（`output[0].value.path`）并落历史（或 owner fixture 的 graphHistory 返回该 records），再交给 `readWitnessFacts`/`recordWitness`；报告非空 | `WitnessFacts.reads.paths` 含该 path，witness PASS；不需要 workflow | 删 `readWitnessFacts` 的 `successfulReadPathsOf` 的 `read_source` arm（只留 native `read`） |
| B06-W2 | 同 W1a（Git，计划仍带 witness 要求），但 Run 成功写了文件（RunActivity `definite changed`） | witness FAIL；轮非 PASS；Task 不完成；不写 PASS Evidence | 删 `effects==='changed'` 的 FAIL 分支（`witness-check.ts`） |
| B06-W3 | 同 W1a，但报告非空、没有一次成功 `read`/`read_source` | witness FAIL；不完成 | 把“零成功读取”改成 PASS |
| B06-W4 | 同 W1a，但该轮**只映射一条** witness 要求；读到部分路径，`requiredReadPaths` 有一条明确没读 | witness FAIL；轮 gaps/blocker coverage 含该 requirement；不承诺路径级定位（`missingPaths` 不落库） | 删 `missingPaths.length>0` 的 FAIL 分支 |
| B06-W5 | 同 W1a，但工作区是非 Git | witness INCONCLUSIVE（第 5 条 unknown）；不完成；报告有文字时仍物化 | 让非 Git 用 capture/RunActivity 翻案成 PASS |
| B06-W5b | owner 级/纯函数：`RunActivity` 缺失/损坏/ruleVersion=1 | witness INCONCLUSIVE；不完成 | 让 unknown 走 PASS，或让缺失当 none |
| B06-W6 | 同 W1a，但最终文字为空/纯空白（脚本执行者可产生） | witness FAIL；`reportRef` 为 null | 去掉 `trim().length>0` |
| B06-W6b | owner 级/纯函数：Run completed 但 transcript 没有 `finalMessageId` 命中的 message | witness FAIL；`reportRef` 为 null | 把“缺 message”改成 INCONCLUSIVE 或 PASS |
| B06-W7 | Git：开轮后、见证前改工作区/来源；报告仍非空 | `sourceStatus:'changed'`；INCONCLUSIVE；不完成 | 删 `sourceStatus!=='matched'` 的 INCONCLUSIVE |
| B06-W8 | SQLite：测试文件顶部照 `S6A-commit-barrier.ts:282-296` 装两个 `vi.mock`；`commitBarrier.hold(byIdentityPrefix('b06-witness:'))` 卡真实 commit 前（`reached` 时用 `graph/look` 确认 check 仍 pending、无事件/回执），重启后重试；另一次用 `holdAfter` 卡 finished 后、finalize 前重启 | 不重跑执行者；pending 重试只产生一个 check/一份 Evidence；finished 后不再有新的 `run_check`，`finalize_checks` 紧随（`open_checks` replay 不计）；无 VR-06 补账 | 让 `startup-reconcile` 对 witness pending 也 interrupt，或让重试产生第二条 Evidence |
| B06-W8b | **owner 级**（Git）：首次 `recordWitness` 提交成功后改动一个已读文件（改变来源），用完全相同 request（同 requestId、同 `meta.expected`）再调公开 `recordWitness`；再以同 requestId 把 `expected[0].revision` 改为首次提交后的 revision | 第二次 `status:'committed'`、`replayed:true`、`value`/`cursor` 与首次相同；`source.capture`/`storeArtifact` 计数不增；冲突调用 `code:'idempotency_conflict'`；删 owner 的 `lookupReceipt`/`replayEvent` 即红 | 删 `recordWitness` 的 receipt-first 查找（或把它移到 pin/状态检查之后） |
| B06-W9 | PL-1 合入后：同一计划有 `sizeClass:'explore'` 的 work、普通 work、gate 三个任务，各自有 witness/命令要求；依次开轮（未合入前用 work/gate 两任务） | 每轮 `platform:witness` 的 coverage/requiredReadPaths 只含 `taskIds.includes(subject.taskId)` 的要求；共享 obligation 的要求按计划作者意图进入每个映射轮，不做额外推断 | 删 `compileVerificationPlan` 的 subject task 过滤 |
| B06-W10 | **Git 工作区**：计划同时有 `reviewer` 要求和 witness 要求；witness PASS | witness Evidence 的 coverage 只含 witness requirement；reviewer requirement 仍 uncovered/blocked；`reviewerEvidence` 不入账由 owner 断言 | 让 witness capability 的 `coversKinds` 含 `reviewer` |
| B06-W11 | 计划/policy 契约行：新项目 policy sample 含 `witness` 且带 witness 要求的计划通过；只读探索缺 witness 要求时计划**不被硬拒**；`plan_only` 不受影响；旧 policy + witness 要求 → `unknown_requirement_kind` | 指南/policy 生效；没有 `missing_witness_requirement`；旧项目不迁移 | 加回硬校验/`missing_witness_requirement`，或改旧 policy |
| B06-W12 | `tasks/query` GoalPhase → `TaskRow.reduction` → `graph/look` `checks`/`evidence` → `materials/open` 报告 | 四段可下钻；`materials/open` 返回 `status:'ready'`、`value.body` 是 JSON 字符串，`JSON.parse(value.body)` 恰为 `{roundRef, subjectRunRef, reportText}`，其中 `roundRef` 等于本轮 `round.ref`、`subjectRunRef` 等于 `round.subjectRunRef`、`reportText` 与最终文字逐字符相等（首尾空白也保留）；`reportRef` 与证据 `artifactRef` 同一；用 `historical_explanation`；不读库 | 把报告 body 改回裸 `reportText`（`JSON.parse`/字段断言红），或删 `TaskRow.reduction`/`graph/look` 的 `evidence` 关系 |
| B06-W13 | 同 W1a（Git），但 witness 要求没有 `requiredReadPaths` 或为空；Run 有一次成功 `read` | witness PASS；Task `satisfied` | 把空路径判成 INCONCLUSIVE |

### 6.2 老断言与新增负例

- **事件闭集/计数不改**（不新增持久化事件），`A2-verification-chain` 的命令链断言原样过。
- `beginCheck(witness)`、`recordCheckResult(witness)` 各一条拒绝测试（owner 级）；`checkEventAdmission` 必须拒绝“见证事件指向 command check”。
- `A10-check-recovery`、`R3e-command-check-platform` 不改；`completion-policy` 的 reviewer 测试归第 9 片。
- 不加 `tests/architecture/production-reach-allowlist.json` 条目（不新增路由）。
- 没有 `skip`/`todo`/`only`；不删测试文件；不减少后端。

### 6.3 测试估计

| 项 | 行数 |
| --- | --- |
| 主流程 + 写文件/没读/读不全/空报告/来源变化反例（memory，公开入口，Git） | 190–270 |
| W1b `read_source`（owner 级真实工具 + 真实历史） | 30–45 |
| 重启/崩溃/重放（W8、W8b） | 85–135 |
| 多任务/审阅边界/计划 policy（W9–W11） | 45–65 |
| 读口四段（W12） | 40–50 |
| owner 级/纯函数（坏 RunActivity、缺 message、beginCheck/recordCheckResult 拒绝） | 20–30 |
| **合计** | **410–595** |

---

## 7 已定（lead，2026-11-02）

- **L1 “读到”的程度。** 该 path 有一次成功读取就算读到。Kernel 记录判不出整文件或行范围（native read 有 2,000 行/64 KiB 上限，`PRODUCT:256`），不改工具授予，不改 Kernel。
- **L2 没列路径。** 第 4 条算成立，第 3 条照旧（§4.1）。计划指南只要求知道时列出。
- **L3 漏写 witness 要求。** 只写计划指南。平台不拒，也没有 witness check，任务可能按其他要求完成。这是接受的软缺口，靠计划审阅发现（`PRODUCT:325`）。
- **L4 `RunActivity` 缺失或旧版本。** INCONCLUSIVE，不现场重算，开轮前也不自动 backfill。旧 Run 走现有 `activity/backfill`（14 天窗口）后重试。
- **L5 非 Git 和已知缺项同时命中。** 已知缺项优先。L-12 只作用于第 5 条：非 Git 的 Run 报告空、零读取或缺路径仍 FAIL，其余第 5 条 unknown，INCONCLUSIVE。

---

## 8 依赖、顺序、共用文件

### 8.1 顺序

当前链（STATUS 11-01）：`7D1 ∥ PL-1 → 8B-2 → 8C → 8E-1/2 → PL-2 → 7D2-1 → 6C → 第 9 片 → E3`。B06 不在链里（`DESIGN:1482`），**排在第 9 片之后、E3 之前**（L-8）：

`… → 第 9 片 → B06 → E3`

**硬依赖：**

- **第 9 片**：`verification-machine.ts`/`evidence-service.ts`/`evidence-contracts.ts`/`completion-policy.ts`/`evidence-record-codecs.ts`/`workflow.ts`/`contracts.ts` 的 reviewer 分支先落；B06 只加并列 witness 分支，不改 9 的 reviewer 语义/`reviewerEvidence`。
- **8C**：`RoundSnapshot`/evidence codec 的 schema 先落；B06 的 `RegisteredWitnessCheck`/事件臂与它并列，不重写快照。
- **PL-1**：`sizeClass:'explore'`、`compileVerificationCoverage`（`contracts/verification.ts`，诊断和 `verification-plan.ts` 共用）、计划诊断。普通只读 Task 的 witness 不依赖 `sizeClass`。两处要跟着 PL-1 落：subject task 过滤留在 `compileVerificationPlan`，不进共用函数，诊断没有 subject；`planChecks`（`plan-readers.ts`，候选诊断的能力表）要带 `platform:witness`，否则候选诊断把 witness 要求报成没有覆盖。

**软依赖/边界：**

- **6C**：改目标/验收/范围后旧 witness 不能完成新义务；B06 用 `round.adoptedPlanRef`/anchor 绑版本。
- **7D2**：审阅线；B06 不建 Session/角色线，witness 不能满足 reviewer。
- **7D1/8B-2/8E**：只在提示词/路由表上有文本冲突；B06 不新增路由、不改 Host 配置。

### 8.2 共用文件

| 文件 | B06 改什么 | 同改片 |
| --- | --- | --- |
| `contracts/plan.ts`、`answer-tools.ts` | `requiredReadPaths?`、zod 可选字段、指南/schema | PL-1、6C |
| `contracts/verification.ts` | `witness` kind、`RegisteredWitnessCheck`、`RoundCheckDefinition`、plan check 路径；`WitnessFacts`/`WitnessCheckInput`/`WitnessCheckResult` 等三态类型 | PL-1、9、8C |
| `verification-plan.ts` | witness 分支 + subject task 过滤 | PL-1、9 |
| `evidence-service.ts` | 内置 capability、`recordWitness`（消费 `witnessFacts`、结构化 body、`guardCtx`）、finalize `runRef` | 9 |
| `evidence-contracts.ts` | `recordWitness`、`readEvidence` | 9 |
| `model/witness-facts-contracts.ts`（新） | `WitnessFactsPort`/`WitnessFactsRequest`；只 import contracts/model，不 import Runtime | —（新文件） |
| `agent-runtime/witness-facts.ts`（新） | `readWitnessFacts` 一个函数：分页、`decodeKernelEntry`、`reduceTurnFromStart`、成功读取集合、三态；不建 reader 类 | —（新文件） |
| `evidence/witness-path-verdicts.ts`（新） | `isSafeSourceRelativePath` + 精确匹配，产出逐条 `WitnessPathVerdict`；不放 state | —（新文件） |
| `verification-machine.ts` | 内存见证臂、pending→finished、`changedCheck` 收口、pendingRoundChecks、beginCheck 拒绝 | 9、8C |
| `check-execution.ts` | witness 分派 + `recordWitness` 缺省 guard | 9 |
| `plan-service.ts`/`plan-contracts.ts` | `TaskRow.reduction` | PL-1/6C |
| `graph-context-reader.ts`/`graph-context-contracts.ts` | `evidence` 关系、`NodeCardV1.evidence` | 9、7D1、8C |
| `create-platform.ts` | 用 `graphHistory` 构造 `witnessFacts` 注入、发布 `recordWitness`/`readEvidence` | 9/PL/7D2 |
| `initial-planning-answer.txt`、`submit_initial_plan.json`、generated pack | witness 指南/sample | PL-1 |
| `app/host.ts`、`app/core-routes.ts` | 本方案不改 | 7D1/7D2/PL/8C/8E |

### 8.3 能提前做（不冒充通过）

1. **纯判定 + 三态 RED 测试。** 用内存夹具测五条判据和 `knownFailure`/`hasGap`/PASS/FAIL/INCONCLUSIVE 映射；路径可判性用 `isSafeSourceRelativePath`，不自写校验器；不接 check/Evidence/Workflow。
2. **最终文字读取/报告物化原型。** 用 Runtime `readWitnessFacts` 单函数 + `MaterialPort.storeArtifact` 证明按 Run 取 `finalMessageId`、结构化 body、256 KiB 内报告、同 round body 复用；不落 check ref。
3. **W-7 契约测试。** `tasks/query` 的 `TaskReduction` 形状、`graph/look` `evidence` 关系；不动路由。
4. **不能提前：** `VerificationCheckKind`/capability/`pendingRoundChecks`/内存事件臂/`recordWitness`/finalize/runner 分派——碰 PL-1/9/8C 共用文件，必须等合入。

---

## 9 估计（生产）

口径：每处按“删除 + 新增”合计；下限按“只改决定点、其余复用”，上限按“解析/负例/注释都算”。没有量过，施工后回写实际。

| 处 | 内容 | 加删 |
| --- | --- | --- |
| W-2 计划/政策/检查生成 | 字段/zod/指南/sample、capability、编译器 witness 分支、`pendingRoundChecks`、`beginCheck` 拒绝 | 170–230 |
| W-3 读取 + 判定 + 物化 | `WitnessFactsPort` 实现（分页/解码/归约/binding）、final text 三态、读取集合、路径三态、source、RunActivity、`witness-check.ts`、结构化 body、`recordWitness` 提交 | 295–405 |
| W-5 状态/事件 | 内存见证臂、finished change、`changedCheck` 收口、admission、transition、`guardCtx` | 100–145 |
| W-4 Evidence | finalize `runRef` 一处 + PASS 守卫 | 15–25 |
| W-6 执行分派 | runner 分派 + 返回映射 | 25–35 |
| W-7 读口 | `TaskRow.reduction`、`readEvidence`、`graph/look` evidence、注入/发布 | 90–140 |
| 装配/提示词 | `create-platform` 构造/注入 `witnessFacts`、generated pack 重建、测试镜像文本 | 55–90 |
| **合计** | | **750–1,070** |

**测试：** 410–595（§6.3）。**总：1,160–1,665。**

**与第一稿的关系。** 第一稿 860–1,270；本稿删了固定覆盖段解析、新持久化事件/codec、Workflow step、policy 迁移、硬校验，加了事实端口/历史读取/RunActivity/结构化 body/三态判定，净减约 110–200 行。

---

## 10 复用清单 / 不设防

### 10.1 原样复用

| 东西 | 位置 | 怎么用 |
| --- | --- | --- |
| 检查轮/check 状态机 | `verification.ts:138-154`、`:219-239`；`verification-machine.ts:1599-1650` | 只加见证臂和 pending→finished；admission/transition 共用 `guardCtx`；`changedCheck` 收口 |
| 持久化 check-result 事件 | `evidence-record-codecs.ts:55-62`、`:94-128`、`:534-574` | 见证仍发 `VerificationCheckResultRecorded` |
| `finalizeChecks` 一次 commit | `evidence-service.ts:1610-1659` | Evidence/index/round/event/receipt 同 commit；结构化正文另写 |
| `TaskEvidenceIndex`/完成归约 | `verification-machine.ts:1047-1055`；`completion-policy.ts:59-176` | witness coverage 走现有折叠 |
| 现有结构化报告存法 | `evidence-service.ts:877-909`；`contracts/no-progress.ts:25` | 复用 `REPORT_CONTENT_TYPE` + `JSON.stringify({roundRef,subjectRunRef,reportText})`；不用纯文本 `text/markdown` |
| `MaterialPort.storeArtifact` | `material-contracts.ts:8-18`；`material-service.ts:122-155` | 结构化 body-first、内容寻址、256 KiB（含信封）、historical 读；同 round body 复用 |
| `graph-execution-history` | `graph-execution-history.ts:170-291` | 只在 Runtime `readWitnessFacts` 内分页读取；Evidence 经 `WitnessFactsPort` 拿结果；binding 取 `run.executionHistory.kernel`，页上 `executionIdentity` 只作 Run/Turn 身份 |
| `isSafeSourceRelativePath` | `workspace/path-validation.ts:3` | 唯一词法源相对路径判据；`recordWitness` 在构造 `paths` 前逐条调用：`false` → `unknown`，`true` → 与成功读取集合精确 `Set.has`；不另写绝对路径/分隔符/点段判断 |
| `RunActivity` + `decodeRunActivitySnapshot` | `contracts/run-activity.ts:34-89`；`run-activity-codecs.ts` | 第 5 条 effects |
| `evaluateSource` | `evidence-service.ts:911-929` | sourceStatus 四值 |
| Workflow `run_check` | `workflow.ts:2515-2530`；`check-execution.ts:143` | 见证分派，不改步骤 |
| `tasks/query`/`graph/look`/`materials/open` | `core-routes.ts:486`、`:576`、`:523` | W-7 公开读口 |

### 10.2 不设防

- 不防“审阅证据混进 witness”：B06 不写 `reviewerEvidence`；该参数由第 9 片负责。
- 不防“witness 满足 reviewer”：capability 只有 `witness`；coverage 不混。
- 不防“报告被改写”：artifact 不可变；报告正文只读。
- 不防“同一报告重复入账”：receipt-first + check 一次 finished + finalize 一次 commit；不同 round 即使文字相同也是不同 body（带 `roundRef`/`subjectRunRef`）；owner 级重放见 W8b。
- 不防“Run 还在跑时见证”：`openVerification` 已拒；Workflow 只在 `normalEnd` 后开轮。
- 不防“文件系统绝对没变”：本片只证 Run 工具副作用 none；没有基线就不宣称更强。
- 不防“旧项目没有 witness policy”：按 79-1 旧库重建，不迁移。

---

## 11 验收与门槛关闭

**B06 关闭的条件：**

1. W-2..W-7 落地；§6.1 的 B06-W1a–W13（含 W1b/W5b/W6b/W8b）按各行口径过；SQLite 只用于 W8 的两个重启窗口；无 `skip`/`todo`/`only`；表外老测试原样过。
2. 真实平台 E2E：一个只读普通 Task 通过 native `read` 实际读 required paths、产生非空最终文字，witness check（经 `run_check`）PASS，`complete_task` 成功；写文件、没读、unknown（Run 不适用/历史缺口/路径不可判，不得用 null/空数组冒充）三类反例按 §1.2 失败/不完成。`read_source` 的公开入口没有生产授予，由 W1b 的 owner 级真实工具行覆盖。
3. `explore`：PL-1 合入后，非 `plan_only` 的只读 explore 任务走同一链；漏写 witness 要求不被硬拒，也不冒充通过。
4. 边界：witness 不能满足 reviewer，B06 不写 `reviewerEvidence`；非 Git 的 effects 判据一律 INCONCLUSIVE（报告/读取的已知缺项仍按 FAIL）；事件闭集不变。
5. 读口：`tasks/query` → `TaskReduction` → `graph/look` `checks`/`evidence` → `materials/open` 四段可下钻；报告 body 是 `{roundRef,subjectRunRef,reportText}`，展示取 `reportText`；不读库。
6. 报告写“B06 已关闭”；不把第 9 片的审阅通过写成 B06 通过（`S9:575`）。

MVP 门槛只认最终一次完整运行；分段运行作附件（沿用 `S9:1056-1060`）。测试可以用脚本执行者产生报告文字，但 PASS/FAIL 必须由 `runWitnessCheck`（含 `knownFailure`/`hasGap`）的机械规则产生；MVP 关门用真实执行者，不能用脚本模型的渲染测试冒充（`S9:568`）。

