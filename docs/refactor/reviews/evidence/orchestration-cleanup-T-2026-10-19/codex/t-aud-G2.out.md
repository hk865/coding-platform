已静态核对 G2 的 89 个文件、327 个差异块，以及相关写入方和覆盖夹具。未修改文件，未运行测试、构建或网络操作。

未找到当前生产写入漏掉新增必填字段的路径，也未找到激活 baseline 却未同次提交 catalog 的路径。TP-165 的 Workspace 行为在 `t-base` 已存在，属于书面前提错误。

1. 发现表

| 编号 | 类别 | 位置（file:line） | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| G2-01 | 违规 | `src/core/work-graph/state/session-availability.ts:339`；`src/core/work-graph/sessions/session-directory.ts:958`；`src/core/work-graph/sessions/session-record-codecs.ts:660` | TP-007、TP-062、TP-122 | 新增了旧 accepted operation 的 provenance 补全。持久 action 缺失或为 null 仍能过 codec；创建 Session 时现在补成 `new`。旧结果是缺 provenance，新结果是凭空得到 `new`。书面保留的是**公开创建输入省略**时的默认值，不是旧持久操作的迁移。当前 admission 本来就无条件保存规范 provenance（`session-directory.ts:782`）。 | 让持久 `SessionOperationRecord.action.provenance` 必填且非空，operation codec 拒绝缺失/null；创建 Session 直接转抄该字段，删除内部兜底。保留公开 admission 的省略默认（`session-directory.ts:707`）。 |
| G2-02 | 违规 | `src/core/work-graph/queries/query-job-service.ts:279`；`src/core/work-graph/queries/query-record-codecs.ts:237` | TP-015 | 对显式 `execution:null` 或非对象输入，原拒绝文案 `intent.execution must be an object when present` 被改成 `intent.execution must be an object`。原文见 `.lead-ref/base/src/core/work-graph/queries/query-job-service.ts:280`、`.lead-ref/base/src/core/work-graph/queries/query-record-codecs.ts:238`。必填收紧不授权改变已有非法输入的文案。 | 恢复这两处既有拒绝文案；缺字段仍拒绝。 |
| G2-03 | 违规 | `tests/work-graph/S3-prepared-context-admission.test.ts:458`、`:572`、`:595` | TP-054、TP-165 | 替换共享 `prepare` 改坏了 BLOCKED 用例的前提。AD06 传入的 `CHANGED` 被忽略；已绑定 Run 的真实 prepare 直接恢复原 Prepared（`src/core/agent-runtime/execution-preparation.ts:340`），因此不再测试“不同 binding”。AD08 原 helper 注入 Workspace source（`.lead-ref/base/tests/work-graph/S3-prepared-context-admission.test.ts:383`），新 helper 没有该 source，却保留 `revision_conflict` 断言（当前 `:603`）。 | 隔离这两个 BLOCKED 用例，恢复其冻结的准备路径和输入；待 lead 冻结替代步骤后再迁移。不得改弱断言，也不得借 T 给生产 binding 新增 Workspace。 |
| G2-04 | 违规 | `tests/helpers/WP1-units-fixture.ts:510`、`:515`、`:530`、`:559` | TP-009、TP-054 | 已声明 BLOCKED 的 Runtime double 仍被改造：新增“生产 assembler＋手写 facts”所得 binding，再继续手造 manifest/Prepared，并由 Runtime stub 返回指定结果。手写 facts 的端口见 `:476`。这不是书面要求的真实 Task prepare，也不是保持 BLOCKED 原状；违反规则表 F1/F4。 | 撤回该 BLOCKED 子项新增的 assembler/binding 构造变更，保持冻结状态，待 lead 冻结真实 prepare 与拒绝触发步骤后整体转换。 |
| G2-05 | 不整洁 | `src/core/work-graph/state/run-machine.ts:20`、`:412`、`:930`、`:1931`、`:2202` | TP-109 | 注释仍描述已删除的 RUN-09..11 `R` 事件来源；事件现只接受 `U`（`:416`）。当前 RUN-16 同次提交结算 cancel/pause 的实际逻辑仍在（`:2219`），不是生产能力丢失。 | 删除过时的 `R` 事件入口说明，准确描述 RUN-16 同次提交结算。 |
| G2-06 | 不整洁 | `src/core/workspace/typescript-source-query.ts:12` | TP-026 | 注释仍称已删除的 `ProjectSourceIndex` 负责捕获、验证和响应整形。当前 analyzer 的构造方在 `src/core/workspace/capture.ts:682`。 | 删除对已删除类的职责说明，保留 analyzer 只消费冻结 snapshot 的准确描述。 |

以下是必填收紧的生产写入链核对结果。

| 对象 | 当前写入方及保证 |
|---|---|
| verification chain、槽 | 根轮次只由 `src/core/work-graph/state/verification-machine.ts:905` 构造，`:913` 无条件写 `rootRoundChain()`；后继由 `:629` 构造 chain。检查更新 `:959`、定案 `:1008` 保留原 chain。开根同时产生槽 claim（`:1563`）；后继在 `src/core/work-graph/evidence/evidence-service.ts:1692` 的同次提交写 round 和槽。生产 round 编码入口只有该文件 `:357`、`:1700`。 |
| evidence index、PASS gaps、可选 cause | `src/core/work-graph/state/verification-machine.ts:1047` 在零追加时不写索引；非零追加产生正 revision，唯一编码入口受 `write:true` 限制（`src/core/work-graph/evidence/evidence-service.ts:371`）。当前 fold 遇到 gaps 返回 INCONCLUSIVE（`verification-machine.ts:875`），定案使用该结果（`:1586`）。`incompleteCause` 仍可合法省略（`:892`、`:1615`）。 |
| round 的 since、finalizedAt | 新根在 `src/core/work-graph/evidence/evidence-service.ts:352` 写 since 占位并绑定本提交位置；后继同样处理（`:1700`）。定案无条件传入 `finalizedAt:admittedAt`（`:1605`），更新保留已存位置（`:314`）。 |
| Task/Query contextAssembly | Task 唯一新 manifest 构造在 `src/core/agent-runtime/execution-preparation.ts:527`，`:533` 无条件写 assembler binding，`:572` 保存。Query 唯一构造在 `src/core/agent-runtime/query-preparation.ts:337`，`:356` 无条件写 binding，`:366` 保存。已绑定 Task 的路径只是恢复已有 Prepared（`execution-preparation.ts:340`）。 |
| Goal digest | `src/core/agent-runtime/context-assembler.ts:1696` 读取 claim 对应 facts；`:1919` 将匹配 Goal source 的 digest 替换为 `goalContextDigestV1(facts.goal)`，`:1941` 写入 binding。没有匹配 Goal source 的情况仍按原规则处理；没有把 Work Goal 条件套给 Query。 |
| Goal 字段 | 新 Goal 在 `src/core/work-graph/state/goal-machine.ts:96`、`:97` 写 revision/requester；事件重建在 `src/core/work-graph/persistence/record-codecs.ts:839`、`:840` 写两字段。控制变更显式更新（`goal-machine.ts:129`），计划指针更新和设置更新展开保留（`:108`；`state/goal-settings-machine.ts:233`）。所有落盘入口为 `persistence/commit-compiler.ts:114`、`tasks/plan-commit-compiler.ts:245`、`:436`、`tasks/goal-control.ts:210`、`tasks/goal-settings-service.ts:433`、`:530`、`:712`、`:876`。以上路径均位于 `src/core/work-graph/`。 |
| Session provenance | 唯一创建 admission 在 `src/core/work-graph/sessions/session-directory.ts:704` 规范化输入，`:782` 无条件写入 accepted action；唯一 `createSessionRecord` 调用在 `:961`，落盘在 `:1003`。当前写入不会漏字段；G2-01 是额外保留并新增了旧操作补全。 |
| Message/回复位置 | `src/core/work-graph/communication/mailbox-service.ts:293` 的共同提交尾部为新 Message 和新回复绑定本提交位置（`:301`、`:309`、`:323`）；更新保留原位置（`:304`）。清理路径保留 Message 原 since（`:2969`），再于 `:2983` 写入。 |
| Requeue/Proposal/Note 位置 | Requeue 在 `src/core/work-graph/tasks/requeue-service.ts:1110` 创建 since 占位，`:1116` 同次绑定。Proposal 新建/替换在 `tasks/plan-service.ts:1421`、`:3352` 同次绑定；放弃和采纳保留原位置（`:2458`；`tasks/plan-commit-compiler.ts:245`、`:436`）。Note 新版本统一由 `state/note-machine.ts:294` 写位置占位；`notes/note-service.ts:703`、`:831`、`:1496`、`:1537` 的写入分别通过 `:890`、`:1558` 同次绑定。以上未写完整前缀的路径均位于 `src/core/work-graph/`。 |
| Session unavailable 位置 | 进入 unavailable 的两处构造在 `src/core/work-graph/state/session-availability.ts:392`、`:452`；已经 unavailable 时保留原位置（`:447`）。落盘绑定由 `sessions/session-health.ts:140`、`tasks/run-reconcile-service.ts:87`及`:756`、`queries/query-execution.ts:551`及`:587` 完成，均位于 `src/core/work-graph/`。 |
| authorization、dispatch、Attempt outcome | 授权新建/重新授权只写 V2（`src/core/work-graph/state/run-machine.ts:855`、`:951`）；其余更新展开保留 V2（`:867`、`:879`、`:894`、`:938`、`:963`、`:995`）。无授权的 starting/D7 仍合法（`:838`、`:935`）。当前 dispatch 的 entered/settled **仍写 V1**，已正确保留（`state/attempt-machine.ts:325`、`:332`、`:339`）；not_entered 写 V2（`:351`）。ended Attempt 的各构造均写 outcome（`:308`、`:317`、`:698`）。 |
| Plan/Proposal | Plan 两条编译路径都构造 schemaVersion 2（`src/core/work-graph/tasks/plan-commit-compiler.ts:157`、`:409`），在 `:245`、`:436` 落盘。Proposal 新建统一由 `state/plan-machine.ts:115` 构造 `candidate_v2`，调用点为 `tasks/plan-service.ts:1002`、`:1085`、`:1607`；状态更新保留其余字段（`state/plan-machine.ts:131`）。没有剩余当前 V1 writer。 |
| catalog | 初始 adoption 在 `src/core/work-graph/architecture/catalog-service.ts:547` 的一次 commit 中同时写 baseline（`:550`）、catalog（`:551`）和 active pointer（`:552`）；修订同样在 `:725` 的一次 commit 写三者（`:728`、`:729`、`:730`）。bootstrap 暴露 Project/Workspace 和 completion-policy 初始化，不另行激活 baseline（`configuration/project-bootstrap-service.ts:1125`）。初始 catalog 的显式 `since:null` 是当前合法格式（`catalog-service.ts:524`）。 |

Session 的其余落盘入口全部更新既有记录并保留 provenance：`src/core/work-graph/communication/mailbox-service.ts:2983`；`queries/query-execution.ts:982`、`:1524`、`:1631`；`sessions/session-health.ts:140`；`sessions/session-lifecycle.ts:417`、`:597`、`:992`、`:1183`、`:1339`；`sessions/session-responsibility-service.ts:174`、`:175`；`tasks/claim-service.ts:469`；`tasks/execution-entry-service.ts:925`。这些省略前缀的路径均位于 `src/core/work-graph/`。

其他必填收紧也有当前 writer：Query submission 由 `src/core/work-graph/state/query-run-recovery.ts:492` 无条件写入；permit 四个 pin 字段由 `src/core/work-graph/tasks/model-call-service.ts:144` 无条件写入；Note noticeClass 在 `src/core/work-graph/state/note-machine.ts:294` 构造，disposition 的 actor/proof 在 `src/core/work-graph/notes/note-service.ts:710`、`:842`、`:1544` 明确写值或 null。

两份共同编辑文件没有发现合并覆盖丢失：

- `src/core/work-graph/views/graph-context-reader.ts:579` 保留 TP 的 submission 收紧，`:902`、`:1135` 保留 Plan V2 收窄，`:795`、`:1632` 保留 TQ 的 catalog 非空读取。
- `src/core/work-graph/model/tool-commit-arguments.ts:22` 已删除 replyMode；`:175` 到 `:179` 间已删除 TQ 点名的 lookup helper。

2. 逐条结果

`OK` 限于 G2 差异及其静态依赖；绑定组合的其他测试不因此视为全部完成。BLOCKED/partial 状态另见下一表。

```text
TP-003: OK
TP-007: G2-01
TP-009: G2-04
TP-010: OK
TP-011: OK
TP-012: OK
TP-014: OK
TP-015: G2-02
TP-025: OK
TP-026: G2-06
TP-030: OK
TP-031: OK
TP-040: OK
TP-041: OK
TP-045: OK
TP-046: OK
TP-047: OK
TP-048: OK
TP-049: OK
TP-050: OK
TP-051: OK
TP-052: OK
TP-053: OK
TP-054: G2-03, G2-04
TP-055: OK
TP-057: OK
TP-058: OK
TP-059: OK
TP-060: OK
TP-061: OK
TP-062: G2-01
TP-063: OK
TP-064: OK
TP-065: OK
TP-066: OK
TP-067: OK
TP-068: OK
TP-081: OK
TP-085: OK
TP-090: OK
TP-097: OK
TP-098: OK
TP-109: G2-05
TP-119: OK
TP-122: G2-01
TP-126: OK
TP-128: OK
TP-129: OK
TP-130: OK
TP-132: OK
TP-133: OK
TP-135: OK
TP-136: OK
TP-137: OK
TP-138: OK
TP-139: OK
TP-140: OK
TP-141: OK
TP-143: OK
TP-152: OK
TP-153: OK
TP-154: OK
TP-155: OK
TP-157: OK
TP-158: OK
TP-159: OK
TP-161: OK
TP-162: OK
TP-163: OK
TP-164: OK
TP-165: G2-03
TP-166: OK
TP-167: OK
TP-168: OK
TP-170: OK
TP-171: OK
TP-172: OK
TP-173: OK
TQ-065: OK
TQ-066: OK
TQ-067: OK
TQ-068: OK
TQ-069: OK
TQ-070: OK
TQ-073: OK
TQ-074: OK
TQ-079: OK
TQ-080: OK
TQ-081: OK
TQ-082: OK
TQ-083: OK
TQ-084: OK
TQ-085: OK
TQ-086: OK
TQ-087: OK
TQ-088: OK
TQ-089: OK
TQ-090: OK
TQ-091: OK
TQ-093: OK
TQ-095: OK
TQ-097: OK
TQ-098: OK
TQ-099: OK
TQ-101: OK
TQ-105: OK
TQ-108: OK
TQ-109: OK
TQ-110: OK
TQ-111: OK
TQ-113: OK
```

3. BLOCKED 和 partial 部分

| 条目 | 部分 | DSH 理由是否属实 | 公开步骤可达性 |
|---|---|---|---|
| TP-010 | 删除 selectedTaskInputs | 属实：仍是当前 prepare 写入字段（`src/core/agent-runtime/execution-preparation.ts:531`），仍参与交叉校验（`src/core/work-graph/state/context-input.ts:334`）。 | 当前状态可由真实 prepare 到达；阻塞是删除决定尚未冻结，不是状态不可达。 |
| TP-025 | 无 chain、无槽的旧根 | 属实：保留用例仍删除 chain（`tests/work-graph/A2-gate-chain-facts.test.ts:224`；`tests/work-graph/R3e-reverify.test.ts:476`），新 codec 必拒绝（`src/core/work-graph/persistence/evidence-record-codecs.ts:321`）。 | 不可达：公开开根固定生成 chain，并同时占唯一槽（`src/core/work-graph/state/verification-machine.ts:913`、`:1563`）。 |
| TP-025／TP-065 | foreign-subject 用例的失败原因 | **DSH 归因不准确。** 该用例展开真实 finalized DTO，仍保留 chain（`tests/work-graph/A2-gate-chain-facts.test.ts:302`）；DTO 去掉 finalizedAt（`src/core/work-graph/persistence/evidence-record-codecs.ts:343`），再次编码后先被 `:335` 的 finalizedAt 检查拒绝。 | 原地篡改主体不是公开步骤（测试 `:303`、`:304`）。应由 lead 单独冻结该坏链输入，不能继续归为“缺 chain 的旧根”。 |
| TP-030 | changed current execution | 当前夹具确实在目标断言前失败：`tests/runtime/source-binding-migration.test.ts:399` 打开 reader，而缺 reader 会在 `src/core/agent-runtime/source-capture-access.ts:632` 拒绝。 | 原断言依赖在 `tests/runtime/source-binding-migration.test.ts:400` 原地改已接受 request。当前 request 在 entering 时写入（`src/core/work-graph/state/query-run-recovery.ts:558`），后续更新保留（`:568`、`:638`）；没有相同的公开原地改写步骤。 |
| TP-054／TP-081 | C1 entered seed | 只能确认 seed 被保留（`tests/helpers/C1-mailbox-fixture.ts:163`），不能从当前树证明“真实 start 只到 entering、0 次调用”的运行报告。 | entered 并非产品不可达：真实 driver 在 before_model 写 entered（`src/core/agent-runtime/execution-driver.ts:981`、`:1008`）；已有真实 start＋脚本模型闸门路径（`tests/helpers/S2B-runtime-steps-fixture.ts:282`、`:308`）。C1 的具体接线仍需修正后验看。 |
| TP-054 | WP1 Runtime double | “该 double 不提供真实 prepare”属实（`tests/helpers/WP1-units-fixture.ts:557`）；但据此绕行构造 binding 不合规，见 G2-04。 | 真实 Task prepare 本身可达（`tests/helpers/S2B-runtime-steps-fixture.ts:304`）。WF01/WF02 的指定拒绝目前由 stub 返回（`tests/helpers/WP1-units-fixture.ts:559`）；保持原断言的触发方案尚待冻结。 |
| TP-163 | running Run 同时开验证轮的 GR 世界 | 属实：当前书面世界要求相互冲突的前提；公开开轮要求主体 Run 已 ended/completed（`src/core/work-graph/state/verification-machine.ts:1202`、`:1203`）。 | 不可达。必须先由 lead 冻结可达 GR 世界及原断言映射。 |
| TP-165 | 上游 runA | 主回复的完成描述不准确；当前仍手造 ended Run 并 commitRaw（`tests/work-graph/S3-prepared-context-admission.test.ts:375`、`:382`），子回复也承认未转（`.lead-ref/replies/t-reply-TP-ctx.md:13`）。 | 可达：真实 claim 后 prepare/start，再让脚本模型结束；现有 Runtime 步骤入口见 `tests/helpers/S2B-runtime-steps-fixture.ts:304`、`:308`、`:327`。 |
| TP-165 | AD06 | 未进入故障及 Host reconcile 步骤未冻结；当前仍手写 revoked（`tests/work-graph/S3-prepared-context-admission.test.ts:567`）。共享 helper 又改变了“不同 binding”前提，见 G2-03。 | 真实未进入 reconcile 有状态入口（`src/core/work-graph/state/run-machine.ts:2215`）；但本用例所需的完整故障和不同绑定准备步骤尚未冻结。 |
| TP-165 | AD08 Workspace @7→@8 | **书误，且 t-base 已如此。** base 的 sources 只有 Goal/Plan/baseline/Run（`.lead-ref/base/src/core/work-graph/views/graph-context-reader.ts:1013`），当前相同（`src/core/work-graph/views/graph-context-reader.ts:1010`）。两版都只检查 binding 已有的 Workspace source（base `tasks/execution-entry-service.ts:1077`；当前 `src/core/work-graph/tasks/execution-entry-service.ts:1073`）。 | @7→@8 可由 setLinePins 到达（`tests/work-graph/S3-prepared-context-admission.test.ts:601`）；“真实 prepare 后仅因此产生该 revision_conflict”不可达。原测试靠手工注入 Workspace source。 |
| TQ-091 | R4b/S2B 裸 baseline 夹具 | DSH 的未闭合报告已被合并树修正：R4b 同次 seed 加入 catalog（`tests/work-graph/R4b-session-directory.test.ts:53`、`:100`）；task-claim 改用真实 adoption（`tests/helpers/task-claim-fixture.ts:270`）。 | 可达；生产 adoption 同次写三行（`src/core/work-graph/architecture/catalog-service.ts:547`）。不能把旧回复里的失败继续当当前缺陷。 |
| TQ-111 | 从当前 Plan 物理移除 Task 后关闭关联 | 属实：保留部分仍直接改 Plan/Goal（`tests/work-graph/A1-independent-review.test.ts:39`、`:48`）。 | 不可达：公开计划变更明确拒绝物理删除 Task（`src/core/work-graph/tasks/plan-validation.ts:338`）。另一半 catalog 竞争已采用公开 adopt/revise（测试 `:66`、`:83`）。 |

表中保留的阻塞本身不计发现；实际改动或绕行 BLOCKED 的两处计为 G2-03、G2-04。以上拒绝结论来自静态调用链，不是本轮运行结果。

4. JSON

```json
[
  {
    "id": "G2-01",
    "class": "违规",
    "file": "src/core/work-graph/state/session-availability.ts",
    "line": 339,
    "item": "TP-007、TP-062、TP-122",
    "problem": "持久 accepted operation 的 provenance 仍允许缺失/null，并新增补成 new 的旧格式迁移。书面只保留公开创建输入省略时的默认值；当前 admission 本来就总写规范 provenance。",
    "fix": "让持久 action.provenance 必填且非空，operation codec 拒绝缺失/null；创建 Session 直接转抄，删除内部兜底，保留公开 admission 的省略默认。"
  },
  {
    "id": "G2-02",
    "class": "违规",
    "file": "src/core/work-graph/queries/query-job-service.ts",
    "line": 279,
    "item": "TP-015",
    "problem": "显式 execution:null 或非对象的既有拒绝文案从 intent.execution must be an object when present 改为 intent.execution must be an object；query-record-codecs.ts:237 同样改变。",
    "fix": "恢复两处既有拒绝文案；缺字段仍拒绝。"
  },
  {
    "id": "G2-03",
    "class": "违规",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "line": 458,
    "item": "TP-054、TP-165",
    "problem": "共享 prepare 替换改变 BLOCKED 前提：AD06 的 CHANGED 输入被忽略，实际恢复原 Prepared；AD08 不再有原 helper 注入的 Workspace source，却保留 revision_conflict 断言。",
    "fix": "隔离 AD06/AD08，恢复冻结的准备路径和输入，待 lead 冻结替代步骤后再迁移；不得弱化断言或借 T 新增生产 Workspace source。"
  },
  {
    "id": "G2-04",
    "class": "违规",
    "file": "tests/helpers/WP1-units-fixture.ts",
    "line": 510,
    "item": "TP-009、TP-054",
    "problem": "声明 BLOCKED 后仍新增生产 assembler 加手写 facts 的 binding，继续手造 manifest/Prepared，并由 Runtime stub 返回指定结果；不是真实 prepare，也没有保持 BLOCKED 原状。",
    "fix": "撤回该 BLOCKED 子项新增的 assembler/binding 构造变更，保持冻结状态，待 lead 冻结真实 prepare 与拒绝触发步骤后整体转换。"
  },
  {
    "id": "G2-05",
    "class": "不整洁",
    "file": "src/core/work-graph/state/run-machine.ts",
    "line": 20,
    "item": "TP-109",
    "problem": "多处注释仍描述已删除的 RUN-09..11 R 事件来源；当前实际结算由 RUN-16 同次提交完成。",
    "fix": "删除过时 R 事件入口说明，准确描述 RUN-16 同次提交结算。"
  },
  {
    "id": "G2-06",
    "class": "不整洁",
    "file": "src/core/workspace/typescript-source-query.ts",
    "line": 12,
    "item": "TP-026",
    "problem": "注释仍把捕获、验证和响应整形职责归给已删除的 ProjectSourceIndex。",
    "fix": "删除对已删除类的职责说明，保留 analyzer 只消费冻结 snapshot 的准确描述。"
  }
]
```

会出错 0，违规 4，不整洁 2，建议 0