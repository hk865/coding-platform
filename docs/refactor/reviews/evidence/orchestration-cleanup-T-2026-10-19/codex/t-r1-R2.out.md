仅依据提供的 diff、base、冻结裁定和源码做只读审查；未运行测试、构建或联网。确认以下 8 项。

| 编号 | 类别 | 位置（file:line） | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| R2-01 | 违规 | `tests/work-graph/R4c-execution-history-index.test.ts:649`、`:659`、`:667` | B-08(d) | occupied-slot 虽已放进 `rejects:`，前态仍由 `write()` 接受手造 Kernel identity 和位置；构造及写入在本文件 `:192`、`:301`、`:313`。拒绝后的不变检查仍走 `records.readMany`，`readRun()` 也是内部存储读取（`:155`）。因此没有完成 A6 要求的 A1 前态和公开不变读取。 | 第一 Run 经真实 prepare/start/finish 取得 locator，再在同 Session 公开 claim 第二 Task；仅拒绝请求携带第一 Run 的真实 identity。前后用公开 `readExecution` 比较第二 Run，保留 `busy` 和零变化断言。 |
| R2-02 | 违规 | `tests/work-graph/R4c-execution-read.test.ts:221`、`:222`、`:234` | B-09 | 新链调用的 `enter/end/retire` 仍造事实：`tests/helpers/S1-archive-service-fixture.ts:185` 手造 Kernel identity，`:191` 写 entered，`:205` 写手造终态事件，`:289` 直接提交 `{verdict:'missing'}`。这不是冻结行要求的真实结束及 Host probe。 | 接真实 Runtime 的启动、故障结束，再保留现有 requeue/claim；由真实 Kernel 依赖故障产生 Host probe 结果后 archive。保留当前 Session、Lease 断言。 |
| R2-03 | 违规 | `tests/work-graph/S3-prepared-context-admission.test.ts:593` | W1-09 | AD03 已使用另一 Task 的真实 Prepared，但拒绝后只有 `commitCount` 比较（`:595`、`:596`），没有 A6 要求的公开读取证明状态不变。 | 在冲突调用前后，通过公开执行读取比较涉及的 Run 状态；保留 `idempotency_conflict` 和原零提交断言。 |
| R2-04 | 违规 | `tests/work-graph/S3-prepared-context-admission.test.ts:625` | W1-26、B-07 | AD06 从 wave-1 的真实 `prepare` 改成新 `basePrepare`；后者在 `:488`～`:520` 按 `CHANGED` 重造 binding、manifest、envelope。基线调用在 `.lead-ref/base/tests/work-graph/S3-prepared-context-admission.test.ts:572`。lead 接受 BLOCKED 时明确要求保留 wave-1 形态，且单独批准 AD08 回 base（`.lead-ref/books/t-run-W1R1b.md:24`～`:28`）。这是改变拒绝输入的绕过，不是 R-2。 | 仅将 AD06 恢复为基线的 `fixture.prepare({ claim, input })`，保留原断言和已接受的 BLOCKED。`basePrepare` 只供 AD08；同步纠正本文件 `:481` 的注释及回复。 |
| R2-05 | 违规 | `tests/work-graph/S5-request-candidates.test.ts:282` | W1-28 | Q1 的 head 不变不能替代“新 proposal 没有 claim”。`src/core/work-graph/tasks/plan-readers.ts:579`～`:602` 只读 proposal 索引及记录，且 `:598` 跳过 `requestRef=null`。具体而言，RC09 的空 requestRef proposal 即使错误占有 claim，新断言仍可通过；基线 `:286` 的 no-claim 检查会失败。 | 按 W1-28 的 R-5，恢复无法由公开读取等价证明的 no-claim／存储不变断言及必要快照，将这些断言标为 BLOCKED；不得以 Q1 head 相等充当等价覆盖。 |
| R2-06 | 违规 | `tests/work-graph/S5-request-candidates.test.ts:277` | W1-28 | 基线 `:277` 保存、`:285` 比较的 `allocationCounts` 被删除。它检查 `newId/now/bodyPut` 调用，不是 F7 存储读取；计数定义在 `tests/helpers/S5-decision-fixture.ts:211`～`:224`。读取若额外分配 ID 或写 body，旧断言会失败，新例没有此检查。 | 在 `readPlanProposal` 前恢复计数快照，读后恢复原 `toEqual(allocations)`。 |
| R2-07 | 不整洁 | `tests/work-graph/S2B-r2-s-preentry-control.test.ts:9` | W1-16 | 恢复文件的注释仍说 fold 中的旧例保留作补充；本轮已删除该例，见 `.lead-ref/groups/R2.diff` 中对应删除块，当前 fold 在 `tests/work-graph/S2B-32-task-timeline-fold.test.ts:227` 已直接进入 order (b)。 | 删除“旧例仍保留”的两行注释。 |
| R2-08 | 不整洁 | `.lead-ref/replies/t-reply-W1R1.md:157` | B-11 | 引用的 `tests/state/plan-machine.test.ts:670`～`:672` 直接提供 `delta.status='unsupported'`，只检查拒绝结果的传递，未执行物理删除判定。删掉 `src/core/work-graph/tasks/plan-validation.ts:337` 的检查，该行仍会通过，因此这个 cover 说明不准确。 | 更正回复，明确此例只覆盖拒绝结果传递；物理删除判定的覆盖缺证交 L-2 后续处理。保留获准的删例，不恢复不可达场景。 |

逐行结论如下；BLOCKED 的“OK”仅表示遵守本轮保留裁定，不表示转换完成。

| 行 | 结论 |
|---|---|
| W1-02 | OK：R2 内仅删除旧 Operation 兼容段，Message／brief 断言保留（`tests/work-graph/S1-codecs-indexes.test.ts:255`）。 |
| W1-08 | OK：先取得旧 lookup 页，再 claim/prepare/start，且检查 gate 已触发（`tests/work-graph/R3c-plan-adoption.test.ts:297`、`:301`、`:326`）。 |
| W1-09 | R2-03。 |
| W1-16 | R2-07；五段时间断言原值已恢复，仍为双 backend（`tests/work-graph/S2B-r2-s-preentry-control.test.ts:26`、`:42`）。 |
| W1-19 | OK：通过 materials owner 读取；`historical_explanation` 符合已接受的 R-6（`tests/helpers/task-claim-fixture.ts:655`；`.lead-ref/books/t-run-W1R1b.md:21`）。 |
| W1-21 | OK：本轮变更清单未包含该文件；当前仍为一个 indexed execution，未冒充双段完成（`.lead-ref/r1-stat.txt:56`；`tests/scenarios/S2C-K-legacy-provenance.test.ts:102`）。 |
| W1-25 | OK，按已接受 BLOCKED 保留；上游 Run、Session 注册及 Workspace@5 仍在（`tests/work-graph/S3-prepared-context-admission.test.ts:230`、`:314`、`:386`）。 |
| W1-26 | R2-04；AD08 单独使用 base 路径符合裁定（`tests/work-graph/S3-prepared-context-admission.test.ts:648`）。 |
| W1-27 | OK：公开 adopt，原缺失 Module／无 Session 断言保留（`tests/work-graph/R4b-session-directory.test.ts:89`、`:296`、`:297`）。 |
| W1-28 | R2-05、R2-06。 |
| W1-29 | OK：题名包含 UT27/UT28（`tests/state/S1-dispatch.test.ts:109`）。 |
| W1-34 | OK：题名为 13 Sessions，注释为两个 archived heads（`tests/app/S2C-line-routes.test.ts:293`、`:298`）。 |
| W1-40 | OK：bootstrap 注释及 starting/running 题名已修正（`tests/helpers/task-claim-fixture.ts:190`；`tests/runtime/R4c-source-authority-guards.test.ts:279`）。 |
| W1-41 | OK：保留的手造 binding 辅助仍供获准的 AD08 base 路径使用（`tests/work-graph/S3-prepared-context-admission.test.ts:490`、`:648`）。 |
| W1-42 | OK：三个文件的题名与现存断言一致（`tests/work-graph/A1-architecture-catalog.test.ts:169`；`tests/work-graph/S2B-activity-calendar-tasks.test.ts:114`、`:135`；`tests/work-graph/S2B-activity-calendar.test.ts:215`）。 |
| W1-43 | OK：baseline/catalog 已由 `adoptInitialArchitecture` 创建并交给真实 graph reader（`tests/work-graph/S3-prepared-context-admission.test.ts:258`、`:334`）。 |
| B-02 | OK：旧无 chain 场景删例符合裁定；FORMAT 只补 `finalizedAt`，外国 subject 的完整拒绝断言保留（`tests/work-graph/A2-gate-chain-facts.test.ts:275`、`:276`）。 |
| B-07 | R2-04；其余按 W1-25、W1-26 的 BLOCKED 裁定处理。 |
| B-08 | R2-01；unmapped Run、空槽竞争删例有授权；scale 已公开 claim；planRef 改写已换为 cancel→新 Plan→requeue→claim（`tests/work-graph/R4c-execution-history-index.test.ts:919`；`tests/work-graph/R4c-task-claim-concurrency.test.ts:105`、`:137`、`:146`）。 |
| B-09 | R2-02。 |
| B-10 | OK：adopt→createGoal→propose→read→apply 完整；claim→busy→cancel→开关 link→archive 完整（`tests/helpers/graph-session-fixture.ts:398`、`:431`、`:433`；`tests/work-graph/A1-session-lifecycle.test.ts:133`、`:153`、`:168`、`:170`）。 |
| B-11 | R2-08；删例本身符合 R-4，物理删除确被拒绝（`src/core/work-graph/tasks/plan-validation.ts:337`）。 |
| B-12 | OK，部分 BLOCKED：IN04 前态被 claim 的 Workspace 检查禁止；其余 Run／Message 种子没有绕过改造（`src/core/work-graph/tasks/claim-service.ts:920`；`tests/work-graph/S3-context-inputs.test.ts:466`、`:479`）。 |
| B-13 | OK，IN11 BLOCKED：IN12 的 PASS→FAIL successor 不可达；IN11 原断言保留（`src/core/work-graph/state/verification-machine.ts:512`、`:632`；`tests/work-graph/S3-context-inputs.test.ts:763`）。 |

B-02 的 FORMAT 值也一致：codec 要求 finalized round 有 `finalizedAt`（`src/core/work-graph/persistence/evidence-record-codecs.ts:334`），writer 写本次 `deps.now()`（`src/core/work-graph/evidence/evidence-service.ts:1585`、`:1605`），该 fixture 的时钟就是 `B2_AT`（`tests/helpers/R3e-evidence-fixture.ts:163`）。

R2 涉及的行外配套变更核对：

- `S1-codecs-indexes` 的旧 Operation 段删除已获明确接受，范围没有扩展到 Message／brief（`.lead-ref/books/t-run-W1R1b.md:31`；`tests/work-graph/S1-codecs-indexes.test.ts:255`）。
- R4b 的两组 schema 注册服务于公开 adopt：治理记录使用正式四种 schema，替代原手写四种；catalog events 支持采用事件，没有放宽校验（`tests/work-graph/R4b-session-directory.test.ts:57`、`:60`；`src/core/work-graph/tasks/plan-readers.ts:322`）。
- 恢复 preentry-control 文件属于 W1-16 明确范围；除 R2-07 的旧注释外，没有额外扩张（`.lead-ref/t-w1-findings.md:84`；`tests/work-graph/S2B-r2-s-preentry-control.test.ts:26`）。

BLOCKED 核查如下。除 AD06 的实际绕过外，理由不足以证明不可达本身不计 finding。

| 行 | 部分 | DSH 理由是否属实 | 公开步骤可达性 |
|---|---|---|---|
| W1-21 | 同 Task、两个 Session 分段的 indexed 场景 | 当前例确实只创建一个 Session 并 claim 一次（`tests/scenarios/S2C-K-legacy-provenance.test.ts:38`、`:56`）。但“没有 Runtime 结束流程”不等于必须不可达。 | 公开 cancel→requeue→再次 claim 已有实例（`tests/work-graph/R4c-task-claim-concurrency.test.ts:109`、`:137`、`:146`）；Session 创建接受 continuation provenance（`src/core/work-graph/sessions/session-directory.ts:710`）。本轮仍遵守 lead 暂缓裁定。 |
| W1-25 | 上游 runA 及相连夹具 | 当前仍是手写 ended Run，确实没有接真实执行链（`tests/work-graph/S3-prepared-context-admission.test.ts:379`～`:387`）。 | ended Run 可由共享真实 start/finish 产生（`tests/helpers/S2B-runtime-steps-fixture.ts:317`、`:345`、`:369`）；这是夹具未接线，不是系统不可达。已接受 BLOCKED。 |
| W1-26 | AD06 | 当前前态仍手写 revoked（`tests/work-graph/S3-prepared-context-admission.test.ts:620`）；真实 reconcile 的 not-entered 分支存在（`src/core/agent-runtime/run-reconcile.ts:320`～`:322`）。 | 可走真实进入前故障→Host reconcile→revoked；本轮可暂缓，但当前改用 basePrepare 违反保留要求，见 R2-04。 |
| W1-26 | AD08 | 理由属实：真实 binding 的 sources 没有 Workspace，entry 只检查已有 Workspace source（`src/core/work-graph/views/graph-context-reader.ts:1010`；`src/core/work-graph/tasks/execution-entry-service.ts:1073`）。 | 真实 prepare 路径不能触发该 Workspace-source 拒绝；获准的 base 路径保留，产品缺口归 L-1（`.lead-ref/t-w1-findings.md:151`）。 |
| B-12 | 三个 Run 种子 | 种子确实没有 claim/outbox/entered 组合（`tests/work-graph/S3-context-inputs.test.ts:466`）；真实读取确实要求 outbox、Session（`src/core/work-graph/tasks/run-state-service.ts:526`、`:538`）。 | 公开 claim 产生组合，真实 start 到 entered，finish 到 ended；共享 helper 已实现（`tests/helpers/S2B-runtime-steps-fixture.ts:317`、`:326`、`:345`）。保留种子未发生绕过。 |
| B-12 | IN14 | running、entered、envelope 授权检查及 message ID 派生均属实（`src/core/work-graph/communication/mailbox-service.ts:750`、`:1329`、`:1361`、`:1369`）。 | entered Run 可达，C1 已在同一返工复用共享 Runtime 并公开读取（`tests/helpers/C1-mailbox-fixture.ts:141`～`:152`）。因此缺 Runtime 接线不能证明 send/reply 场景不可达；IN14 种子和断言仍保留（`tests/work-graph/S3-context-inputs.test.ts:479`、`:778`）。 |
| B-13 | IN11 | `openVerification` 确实公开读取 subject Run；当前裸 Run 会缺 claim-linked 数据（`src/core/work-graph/evidence/evidence-service.ts:1070`；`src/core/work-graph/tasks/run-state-service.ts:526`）。 | 所需 completed Run 可由真实 Runtime finish 产生（`tests/helpers/S2B-runtime-steps-fixture.ts:345`、`:369`）；所报理由不足以证明后续 verification 链不可达。原 round seed 和精确断言保持（`tests/work-graph/S3-context-inputs.test.ts:476`、`:763`）。 |

```json
[
  {
    "id": "R2-01",
    "class": "违规",
    "file": "tests/work-graph/R4c-execution-history-index.test.ts",
    "line": 649,
    "row": "B-08",
    "problem": "occupied-slot 的 A6 转换未完成：第一 Run 的 locator 仍由手造 Kernel identity/positions 写入；659、667、668 行仍通过内部存储读取证明不变。",
    "fix": "第一 Run 经真实 prepare/start/finish 取得 locator，同 Session 公开 claim 第二 Task；仅拒绝请求使用第一 Run 的真实 identity，前后通过 readExecution 比较，保留 busy 和零变化断言。"
  },
  {
    "id": "R2-02",
    "class": "违规",
    "file": "tests/work-graph/R4c-execution-read.test.ts",
    "line": 221,
    "row": "B-09",
    "problem": "所谓公开链仍调用手造事实的 enter/end/retire；S1-archive-service-fixture.ts:185、191、205、289 分别造 Kernel identity、entered、终态事件及 missing probe。",
    "fix": "使用真实 Runtime 启动和故障结束，保留公开 requeue/claim；让真实 Kernel 依赖故障产生 Host probe，再 archive，保留现有 Session/Lease 断言。"
  },
  {
    "id": "R2-03",
    "class": "违规",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "line": 593,
    "row": "W1-09",
    "problem": "AD03 拒绝后只有 commitCount 比较，缺少 A6 要求的公开读取证明状态不变。",
    "fix": "在冲突调用前后通过公开执行读取比较涉及的 Run，保留 idempotency_conflict 和原零提交断言。"
  },
  {
    "id": "R2-04",
    "class": "违规",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "line": 625,
    "row": "W1-26 / B-07",
    "problem": "AD06 从 wave-1 的真实 prepare 改用新 basePrepare 手造 CHANGED binding/manifest/envelope；t-run-W1R1b.md:24-28 只接受保留 wave-1 的 BLOCKED，单独允许 AD08 回 base。",
    "fix": "AD06 恢复基线 fixture.prepare 调用、原断言及 BLOCKED；basePrepare 只留给 AD08，并纠正相关注释和回复。"
  },
  {
    "id": "R2-05",
    "class": "违规",
    "file": "tests/work-graph/S5-request-candidates.test.ts",
    "line": 282,
    "row": "W1-28",
    "problem": "用 Q1 head 不变替代 proposal 无 claim。plan-readers.ts:579-602 不读取 claim，并跳过 requestRef=null proposal，错误 claim 存在时新断言仍可通过。",
    "fix": "恢复不能由公开读取等价证明的 no-claim/存储不变断言及必要快照，按 R-5 将这些断言标为 BLOCKED，撤销 head 相等可证明无 claim 的替代。"
  },
  {
    "id": "R2-06",
    "class": "违规",
    "file": "tests/work-graph/S5-request-candidates.test.ts",
    "line": 277,
    "row": "W1-28",
    "problem": "未经授权删除基线 allocationCounts 不变断言；该计数检查 newId/now/bodyPut 调用，不是 F7 存储读取。",
    "fix": "在 readPlanProposal 前恢复计数快照，读后恢复原 toEqual(allocations)。"
  },
  {
    "id": "R2-07",
    "class": "不整洁",
    "file": "tests/work-graph/S2B-r2-s-preentry-control.test.ts",
    "line": 9,
    "row": "W1-16",
    "problem": "注释仍说 fold 中旧例保留作补充，但本轮已经删除该例。",
    "fix": "删除旧例仍保留的两行注释。"
  },
  {
    "id": "R2-08",
    "class": "不整洁",
    "file": ".lead-ref/replies/t-reply-W1R1.md",
    "line": 157,
    "row": "B-11",
    "problem": "引用 plan-machine.test.ts:670 作物理删除判定的覆盖不准确；该例仅传入预制 unsupported delta 并验证拒绝传递，不执行 plan-validation.ts:337 的判定。",
    "fix": "更正覆盖说明，把物理删除判定的覆盖缺证交 L-2 后续处理；保持获准删例，不恢复不可达场景。"
  }
]
```

会出错 0，违规 6，不整洁 2，建议 0