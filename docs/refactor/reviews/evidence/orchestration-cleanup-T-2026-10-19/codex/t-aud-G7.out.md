只读核对完成；未修改文件，未运行测试、构建或网络操作。以下 `OK` 仅表示本组改动未发现问题，不表示 BLOCKED 项已经完成。

| 编号 | 类别 | 位置（file:line） | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| G7-01 | 违规 | `tests/state/run-machine.test.ts:969`；原例 `.lead-ref/base/tests/state/run-machine.test.ts:1015` | TP-133 | 整条旧授权测试删除时，连带删掉了条目明确要求保留的 `[EV.begin, CLAIMED]` 当前场景及精确 `forbidden/detail` 断言。现有 `tests/state/run-machine.test.ts:1580` 只测 `entryV2Binding`，不能替代该状态迁移断言。 | 恢复 never-bound CLAIMED → begin 这一例及原 code/detail 断言；不恢复 V1/pre-B2 子例。 |
| G7-02 | 会出错 | `tests/work-graph/R3c-plan-adoption.test.ts:291`、`:310` | TP-147 | 原输入是在查询取得旧页后、新 Run 出现的竞态；现版先 claim/start、等模型闸门，再查询。删除了注入确实发生的断言。即使查询漏掉“读页后新增 Run”，新版仍可凭查询前已经存在的 running Run 通过，原竞态失去覆盖。 | 恢复委托 lookup 闸门：取得真实旧页后，经真实流程 claim/prepare/start，再返回原页；恢复闸门触发断言及原图结果断言。 |
| G7-03 | 违规 | `tests/work-graph/R3c-plan-adoption.test.ts:197`；`tests/work-graph/R4c-source-authority-reader.test.ts:117`；`tests/work-graph/R4c-task-claim-boundaries.test.ts:118` | TP-147、TP-150、TP-151 | 三处转换仍将手工构造或从快照拼出的 `PlanRevisionDraft` 交 owner 接受，再继续测试，命中 F1。公开方法名称不构成豁免，A7 为空（`.lead-ref/books/test-rule-sheet-v1.md:53`、`:57`）。 | 撤回这些不合规的 Plan 前置转换并标 BLOCKED；冻结真实 Workflow／脚本模型生成提议的入口后再转换，保留原行为断言。 |
| G7-04 | 违规 | `tests/state/task-failure.test.ts:198`；`tests/state/task-machine.test.ts:130`、`:142`；`tests/state/verification-machine.test.ts:135`、`:515` | TP-025 | 被书面改正冻结的“两旧根”输入被直接或经共享底座改成两个带 chain 的当前根。书面改正要求先逐例冻结 VD-1、VD-15、GAP-52、P10、P20，不能自行选择新坏链输入（`.lead-ref/books/t-items-TP.md:184`）。 | 撤销对这些 BLOCKED 子例输入的改写，保留冻结状态；等 lead 逐例确定当前输入和保留断言。 |
| G7-05 | 违规 | `tests/work-graph/S3-context-inputs.test.ts:376`、`:498`、`:500` | TQ-115；TP-025/045 依赖 | IN11/IN12 明确 BLOCKED，却补了 root chain 和 `finalizedAt`，使手写轮次适应新存储格式。尤其新增编码器可选参数 `finalizedAt` 不属于删除符号造成的编译修正。 | 撤回这两个冻结前置的补字段；保持 BLOCKED，先冻结真实检查流程及逐断言映射。 |
| G7-06 | 违规 | `tests/work-graph/S3-prepared-context-admission.test.ts:233`、`:355`、`:377` | TP-165 | 要求转换的上游 ended Run 仍由 `commitRaw` 写入（`:382`）；新增真实 claim/prepare 没有产生这个 ended Run。新增 Session 又直接调用 `recordSessionCreated` 写 Host 事实；Workspace 也是先手写 @5，再公开推进 @7（`:343`）。这些没有完成书面改正指定的真实前置。 | 用真实初始化、Session/Runtime 流程产生上游 ended Run 和材料归属，并公开推进 Workspace 到 @7；删除对应 raw Run、手写 Host 注册事实及 @5 seed。 |
| G7-07 | 违规 | `tests/work-graph/S3-prepared-context-admission.test.ts:458`、`:572` | TP-165、TP-054 | AD06 虽保留原测试体，公共 `prepare` 已忽略传入的 `input: …CHANGED`。已绑定 Run 的真实 prepare 只重建原 Prepared（`src/core/agent-runtime/execution-preparation.ts:342`），因此原“另一 binding 必须 invalid”的输入被静默换成同一 binding，违反 BLOCKED 原样保留要求。 | 撤销影响 AD06 的共享 prepare 改写，连同依赖保持 BLOCKED；待故障、Host reconcile 和拒绝输入方案冻结后整体转换，不改 `invalid` 断言。 |
| G7-08 | 会出错 | `tests/work-graph/S3-prepared-context-admission.test.ts:469`、`:535` | TP-054、TP-165 | AD03 原输入为同 requestId、不同输入 T/T2，从而得到不同 manifest（`.lead-ref/base/tests/work-graph/S3-prepared-context-admission.test.ts:478`、`:482`）；现版保留同一个 manifest/binding，只改 `envelopeId`。即使 manifest 差异不再参与幂等检查，新版仍可因 envelope 差异通过，原行为失去覆盖。 | 恢复真正具有不同内容／摘要的两份准备结果，验证同 requestId 的 manifest 冲突；保留原 `idempotency_conflict` 和零提交断言，不以 envelopeId 差异代替。 |
| G7-09 | 违规 | `tests/work-graph/R4b-session-directory.test.ts:53`、`:100`、`:102` | TQ-091；lead-fix-r4b | lead 补丁手写 `ArchitectureCatalogRecord`，并入 `records.commit(seed)`。trusted seed 不是本轮允许形式，仍命中 F3；A7 没有该豁免（`.lead-ref/books/test-rule-sheet-v1.md:53`、`:64`）。 | 撤回新增 raw catalog seed；将该前置标 BLOCKED，冻结公开架构采用步骤后再落地。 |
| G7-10 | 违规 | `tests/work-graph/S5-request-candidates.test.ts:274`、`:277`、`:283`、`:286` | TP-169 | RC09 改为公开 propose 后，仍通过 `recordAt` 和 `storeSnapshot().claims` 断言底层记录、字段和领取状态，命中 F7；不能计为合法转换完成。 | 标 BLOCKED，先冻结公开读取／真实竞争操作与原字段、无领取断言的对应关系，再转换；不得直接删除原断言。 |
| G7-11 | 违规 | `tests/state/S1-dispatch.test.ts:109` | TP-127 | UT28 的输入和 busy 断言确由 UT27 覆盖，但合并后名称只保留 UT27，违反 merge-into 必须保留源规格行 ID 的要求（`.lead-ref/books/t-book.md:55`）。 | 将目标名称改为同时包含 UT27、UT28，保持现有断言。 |
| G7-12 | 不整洁 | `tests/work-graph/S3-prepared-context-admission.test.ts:177`、`:200`、`:206`、`:211`；`tests/work-graph/S5-goal-settings.test.ts:12`、`:21`、`:22`、`:39` | TP-054、TP-103、TP-164、TP-165 | 准备器转换后留下无调用的 `makeBinding`、`selectedOldA`、`missingEdge`、`workspaceSource` 等辅助代码；S5 留下仅导入的 PreparedTaskManifestV1、RoleSpecResolutionV1、TaskEnvelopeV1、MANIFEST_CONTENT_TYPE。 | 完成上述前置修正后，删除确实失去消费者的辅助代码和导入，不连带删除 BLOCKED 所需代码。 |
| G7-13 | 不整洁 | `tests/work-graph/A1-architecture-catalog.test.ts:169`；`tests/work-graph/S2B-activity-calendar.test.ts:215`；`tests/work-graph/S2B-activity-calendar-tasks.test.ts:114`、`:135`；`tests/state/command-normalization.test.ts:399` | TQ-110、TP-156、TP-157、TQ-085/086 | 名称仍宣称覆盖已删除的 digest inconsistency、legacy rounds、unknown/unresolvable Session 或旧 public projection，和剩余测试体不符。 | 只收窄名称，使其准确描述保留的测试内容。 |
| G7-14 | 违规 | `tests/work-graph/S2B-32-task-timeline-fold.test.ts:228`；删除证据 `.lead-ref/groups/G7.diff:4592` | TP-095、TP-160 | 冻结动作明确保留 r2 公开流程用例、删除 fold 旧段（`.lead-ref/books/t-items-TP.md:694`、`:1181`、`:1183`）；实际反向删除 r2 文件、搬入 fold。断言虽保留，合并方向没有书面授权。 | 将公开用例移回并保留 `S2B-r2-s-preentry-control.test.ts`，删除 fold 中对应重复用例，保持公开步骤及五段断言。 |

逐项结果如下；包含本组改动直接涉及的条目及其跨组依赖。

```text
TP-003: OK
TP-007: OK
TP-009: OK
TP-010: OK
TP-011: OK
TP-012: OK
TP-014: OK
TP-015: OK
TP-025: G7-04, G7-05
TP-026: OK
TP-031: OK
TP-040: OK
TP-041: OK
TP-045: G7-05
TP-046: OK
TP-048: OK
TP-049: OK
TP-050: OK
TP-051: OK
TP-052: OK
TP-053: OK
TP-054: G7-07, G7-08, G7-12
TP-055: OK
TP-056: OK
TP-058: OK
TP-059: OK
TP-061: OK
TP-062: OK
TP-063: OK
TP-064: OK
TP-065: OK
TP-066: OK
TP-067: OK
TP-068: OK
TP-085: OK
TP-090: OK
TP-091: OK
TP-093: OK
TP-094: OK
TP-095: G7-14
TP-096: OK
TP-097: OK
TP-098: OK
TP-100: OK
TP-103: G7-12
TP-105: OK
TP-108: OK
TP-109: OK
TP-125: OK
TP-126: OK
TP-127: G7-11
TP-128: OK
TP-129: OK
TP-130: OK
TP-131: OK
TP-132: OK
TP-133: G7-01
TP-134: OK
TP-135: OK
TP-136: OK
TP-137: OK
TP-138: OK
TP-139: OK
TP-140: OK
TP-141: OK
TP-142: OK
TP-143: OK
TP-144: OK
TP-145: OK
TP-146: OK
TP-147: G7-02, G7-03
TP-148: OK
TP-149: OK
TP-150: G7-03
TP-151: G7-03
TP-152: OK
TP-153: OK
TP-154: OK
TP-155: OK
TP-156: G7-13
TP-157: G7-13
TP-158: OK
TP-159: OK
TP-160: G7-14
TP-161: OK
TP-162: OK
TP-163: OK
TP-164: G7-12
TP-165: G7-06, G7-07, G7-08, G7-12
TP-166: OK
TP-167: OK
TP-168: OK
TP-169: G7-10
TP-170: OK
TP-171: OK
TP-172: OK
TP-173: OK
TQ-070: OK
TQ-074: OK
TQ-079: OK
TQ-081: OK
TQ-085: G7-13
TQ-086: G7-13
TQ-087: OK
TQ-088: OK
TQ-091: G7-09
TQ-101: OK
TQ-103: OK
TQ-104: OK
TQ-108: OK
TQ-109: OK
TQ-110: G7-13
TQ-111: OK
TQ-112: OK
TQ-113: OK
TQ-114: OK
TQ-115: G7-05
```

BLOCKED 和 partial 部分的裁定依据如下。

| 条目 | 部分 | DSH 的理由属实？ | 公开步骤可达性 |
|---|---|---|---|
| TP-010 | manifest selectedTaskInputs | 是，删除范围尚未冻结；当前测试仍保留该字段（`tests/state/context-input.test.ts:101`）。 | 真实 prepare 仍生成该内容，见 `src/core/agent-runtime/context-assembler.ts:1908`；不是不可达旧数据。 |
| TP-025 | A2 两个无 chain 根 | 是，测试明确删掉 chain 再 raw commit（`tests/work-graph/A2-gate-chain-facts.test.ts:224`、`:237`）。 | 不可达。当前根构造必写 chain，且开轮同时占槽（`src/core/work-graph/state/verification-machine.ts:905`、`:1549`）。属于旧形状，没有发现丢失当前 writer。 |
| TP-025 | R3e 无槽旧根 | 是，仍明确删除 chain 后提交（`tests/work-graph/R3e-reverify.test.ts:476`、`:477`）。 | 不可达，原因同上；当前 successor 也明确构造 chain（`src/core/work-graph/state/verification-machine.ts:629`）。 |
| TP-025 | A2 `:304` 的错 subject finalized 副本 | 若称为同一种“无 chain 旧根”，不属实。它保留 chain，却从公开轮次副本改了 subject，且编码时未带 finalizedAt（`tests/work-graph/A2-gate-chain-facts.test.ts:300`、`:303`、`:304`）。 | 该手写不一致记录不可由正常公开步骤产生；存储拒绝点是 finalizedAt 要求（`src/core/work-graph/persistence/evidence-record-codecs.ts:334`）。正常 finalized 写入由 evidence service 保留／写入 origin（`src/core/work-graph/evidence/evidence-service.ts:345`）。 |
| TP-025 | VD/GAP/P10 等两个旧根输入 | 尚未冻结的理由属实；但“保持不动”不属实，见 G7-04。 | 公开流程不能为同一槽制造两个根；纯坏链输入可以单独测试，但具体新输入必须先冻结（`src/core/work-graph/state/verification-machine.ts:1549`；`.lead-ref/books/t-items-TP.md:184`）。 |
| TP-054、TP-165 | AD06，memory/sqlite | AD06 尚未冻结故障链属实；声称保留原测试输入不属实，`prepare` 吞掉了 CHANGED，见 G7-07。 | **所测规则仍是当前行为**：revoked Run 只能沿用固定 binding，异 binding 返回 invalid（`src/core/work-graph/state/run-machine.ts:1454`、`:1514`）。真实未进入故障后经 Host reconcile 可到 revoked（`src/app/startup-reconcile.ts:330`；`src/core/agent-runtime/run-reconcile.ts:320`）；不能用手写撤销事实代替。 |
| TP-165 | AD08，memory/sqlite | “当前真实准备结果没有 Workspace source，因此不会因 pin 变化而冲突”的理由属实（`src/core/work-graph/views/graph-context-reader.ts:1010`；`src/core/work-graph/tasks/execution-entry-service.ts:1073`）。 | `setLinePins` 的 @7→@8 可达（`tests/work-graph/S3-prepared-context-admission.test.ts:601`）；但本准备路径没有产生测试声称的 Workspace@7 binding。该拒绝要求仍在当前规格 AD08（`docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md:743`），不能按旧数据退役。t-base 的 source 列表也未含 Workspace（`.lead-ref/base/src/core/work-graph/views/graph-context-reader.ts:1013`），不是本组新增产品回归。 |
| TP-165 | 上游 ended Run | “已完成真实上游 Run 转换”不属实，实际仍 raw seed（`tests/work-graph/S3-prepared-context-admission.test.ts:377`、`:382`）。 | 正常 claim→prepare→start→结束可达；新增代码只做到 prepare（同文件 `:362`、`:371`），见 G7-06。 |
| TP-091 | counted 活动行 | 属实，`writeActivity` 手写事实仍在（`tests/work-graph/S2B-activity-calendar-tasks.test.ts:42`、`:176`）。 | 真实 Runtime/Kernel 历史再经活动计数可产生 counted；进入前取消不能替代这条历史，原逐断言转换仍未冻结（`.lead-ref/replies/t-reply-TP.md:195`）。 |
| TP-108 | G7 两处 seedRun | 属实，消费者未转换（`tests/work-graph/R4c-execution-read.test.ts:212`、`:369`）。 | 测试中的无完整派工关联手写 Run 不能由正常 claim 产生；正常 claim 同批建立关联记录（`src/core/work-graph/tasks/claim-service.ts:1204`）。 |
| TP-146 | Kernel 槽冲突、零部分提交 | 属实，手写槽前置仍在（`tests/work-graph/B2-execution-entry.test.ts:171`）。 | 普通真实 Runtime 给不同 Run 派生不同 kernel.runId（`src/core/agent-runtime/execution-driver.ts:620`）；“同 Session 再启动一次”不能产生所需身份冲突，故障触发点仍待冻结。 |
| TP-148 | archived/unavailable Session 与新 lease holder | 属实，仍 overwrite Session 和 lease（`tests/work-graph/R4c-execution-read.test.ts:175`、`:187`）。 | 相应业务状态可经真实结束、重排、领取、Host 探测和归档产生；unavailable 需要真实 probe，不能由进入前取消替代（`src/core/work-graph/sessions/session-health.ts:5`、`:121`）。整条映射未冻结。 |
| TP-163 | GR 手写世界及 GR06/07 | 属实，仍使用手写世界和固定标识（`tests/work-graph/S3-graph-context.test.ts:388`、`:883`、`:899`）。 | running Run 同时拥有已打开验证轮的那部分不可达：开轮要求主体 ended/completed（`src/core/work-graph/state/verification-machine.ts:1200`）。其余 Session/Run 可真实产生，但尚无冻结的整体替代世界。 |
| TQ-103、TQ-104、TQ-112 | Session archive 前置 | 属实，仍依赖 accepted Plan 和 occupancy 覆写（`tests/work-graph/A1-session-lifecycle.test.ts:124`、`:127`、`:132`）。 | 合法 Plan 后的 claim、进入前取消、关闭关系、归档可以公开推进；当前手写 Plan 前置不满足允许形式，不能据此解除 BLOCKED（`.lead-ref/books/test-rule-sheet-v1.md:57`）。 |
| TQ-111 | 物理删除 Task 后的拒绝 | 属实，前置仍直接替换 Plan（`tests/work-graph/A1-independent-review.test.ts:48`）。 | 不可达：当前公开修订拒绝物理删除 Task，要求记录 disposition（`src/core/work-graph/tasks/plan-validation.ts:338`）。 |
| TQ-114 | Plan、Run、跨 Workspace 混合世界 | 属实，手写 Plan/Run 仍在（`tests/work-graph/S3-context-inputs.test.ts:432`、`:482`）。 | 普通 starting/ended Run 可经 Runtime 产生；把同一 Goal 的 Run 放到另一 Workspace 的前置不可由正常 claim 产生，Goal 与 scope 必须一致（`src/core/work-graph/tasks/claim-service.ts:920`）。 |
| TQ-114 | IN14 Message | 属实，仍有手写 replied Message 和固定 ID 断言（`tests/work-graph/S3-context-inputs.test.ts:494`、`:818`）。 | 发送→回复→关联决策可公开执行；原固定 Message ID 与精确断言的对应关系未冻结，不能仅换成 owner 写事实。 |
| TQ-115 | IN11 | 真实流程与旧 revision/report 不同的理由属实；但输入未保持原样，见 G7-05（`tests/work-graph/S3-context-inputs.test.ts:498`、`:786`）。 | open→begin→result→finalize 可达；旧手填 finalized@1、text/plain 报告不是这条真实流程的结果，精确映射待冻结。 |
| TQ-115 | IN12 | PASS→FAIL successor 不可达的理由属实；但 seed 被补字段，见 G7-05（`tests/work-graph/S3-context-inputs.test.ts:500`、`:797`）。 | 不可达：successor 要求 finalized non-PASS 前驱（`src/core/work-graph/state/verification-machine.ts:512`、`:631`）。 |

几个指定重点的结论补充如下：

- TP-161 的 `archived partial → exact 2` 正是授权改动；standby 6→5、总行数 9→8 和真实置顶 Session 也在授权内。未发现额外放宽（`tests/work-graph/S2C-lines-d1.test.ts:37`；`.lead-ref/books/t-items-TP.md:1188`）。
- R4b 补丁违反夹具规则，但剩余测试仍检查“不存在的 module target 不能成功注册 Session”，包括 not_found 和无 Session 结果；没有证据说该行为断言失效（`tests/work-graph/R4b-session-directory.test.ts:284`、`:294`、`:303`、`:304`）。
- W1/W2 三文件仅删除 V1 分支及其类型使用，回复列明了白名单外文件；未发现顺带改写当前分支断言。依据是 `.lead-ref/groups/G7.diff:5745`、`:5763`、`:5794` 和 `.lead-ref/replies/t-reply-TP.md:212`。`S3-context-inputs` 的 IN18 删除有 TQ-079 明确授权（`.lead-ref/books/t-items-TQ.md:488`）；其余争议补字段已列 G7-05。

```json
[
  {
    "id": "G7-01",
    "class": "违规",
    "file": "tests/state/run-machine.test.ts",
    "line": 969,
    "item": "TP-133",
    "problem": "删除旧授权测试时，连带删除明确要求保留的 never-bound CLAIMED→begin 场景及精确 forbidden/detail 断言；entryV2Binding 单测不能替代状态迁移断言。",
    "fix": "恢复单个 CLAIMED→begin 案例及原 code/detail 断言，不恢复 V1/pre-B2 子例。"
  },
  {
    "id": "G7-02",
    "class": "会出错",
    "file": "tests/work-graph/R3c-plan-adoption.test.ts",
    "line": 291,
    "item": "TP-147",
    "problem": "原读页后新增 Run 的竞态被改为查询前完成 claim/start；漏掉读页后新增 Run 的实现仍能通过新版，原竞态覆盖消失。",
    "fix": "恢复委托 lookup 闸门，在取得真实旧页后通过真实流程建立 Run，再返回旧页，并保留闸门触发及原结果断言。"
  },
  {
    "id": "G7-03",
    "class": "违规",
    "file": "tests/work-graph/R3c-plan-adoption.test.ts",
    "line": 197,
    "item": "TP-147, TP-150, TP-151",
    "problem": "本文件及 R4c-source-authority-reader.test.ts:117、R4c-task-claim-boundaries.test.ts:118 仍将手工构造的 PlanRevisionDraft 交 owner 接受后继续测试，违反 F1。",
    "fix": "撤回这些不合规 Plan 前置转换并标 BLOCKED，冻结真实 Workflow／脚本模型生成提议的入口后再转换，保留原行为断言。"
  },
  {
    "id": "G7-04",
    "class": "违规",
    "file": "tests/state/task-failure.test.ts",
    "line": 198,
    "item": "TP-025",
    "problem": "本文件及 task-machine.test.ts:130、142、verification-machine.test.ts:135、515 将已冻结的两个旧根输入直接或经共享底座改为带 chain 的当前根。",
    "fix": "撤销对 BLOCKED 子例输入的改写，待 lead 逐例冻结当前输入和保留断言。"
  },
  {
    "id": "G7-05",
    "class": "违规",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "line": 376,
    "item": "TQ-115; TP-025/045 依赖",
    "problem": "IN11/IN12 已 BLOCKED，却在本行及498、500补 root chain 和 finalizedAt，使手写轮次适应新存储格式；可选 finalizedAt 参数不属于删除符号的编译修正。",
    "fix": "撤回冻结前置的补字段，保持 BLOCKED，先冻结真实检查流程和逐断言映射。"
  },
  {
    "id": "G7-06",
    "class": "违规",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "line": 377,
    "item": "TP-165",
    "problem": "上游 ended Run 仍在382行 raw commit；新增真实 claim/prepare 没有产生它，355行仍手写 Host 注册事实，233行先手写 Workspace@5 再推进到@7。",
    "fix": "通过真实初始化、Session/Runtime 流程产生上游 ended Run 和材料归属，并公开推进 Workspace 到@7，删除对应手写事实。"
  },
  {
    "id": "G7-07",
    "class": "违规",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "line": 458,
    "item": "TP-165, TP-054",
    "problem": "共享 prepare 忽略 AD06 在572行传入的 CHANGED 输入，真实 prepare 对已绑定 Run 仅返回原 binding，使冻结的异 binding 拒绝场景被改成同 binding。",
    "fix": "撤销影响 AD06 的共享 prepare 改写，连同依赖保持 BLOCKED，待故障、Host reconcile 和拒绝输入方案冻结后整体转换，不改 invalid 断言。"
  },
  {
    "id": "G7-08",
    "class": "会出错",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "line": 469,
    "item": "TP-054, TP-165",
    "problem": "AD03 原同 requestId、不同 T/T2 manifest 被改成同一 manifest/binding 仅改 envelopeId；即使丢失 manifest 差异检查，新版仍可通过。",
    "fix": "使用真正具有不同内容／摘要的两份准备结果验证 manifest 幂等冲突，保留原冲突及零提交断言，不以 envelopeId 差异代替。"
  },
  {
    "id": "G7-09",
    "class": "违规",
    "file": "tests/work-graph/R4b-session-directory.test.ts",
    "line": 53,
    "item": "TQ-091; lead-fix-r4b",
    "problem": "新增手写 ArchitectureCatalogRecord 并在100、102行 raw commit；trusted seed 仍违反 F3，A7 没有豁免。",
    "fix": "撤回 raw catalog seed，将该前置标 BLOCKED，冻结公开架构采用步骤后再落地。"
  },
  {
    "id": "G7-10",
    "class": "违规",
    "file": "tests/work-graph/S5-request-candidates.test.ts",
    "line": 274,
    "item": "TP-169",
    "problem": "RC09 改公开 propose 后仍通过 recordAt、storeSnapshot().claims 断言底层记录和领取状态，违反 F7。",
    "fix": "标 BLOCKED，冻结公开读取／真实竞争操作与原字段和无领取断言的对应关系后再转换，不直接删除原断言。"
  },
  {
    "id": "G7-11",
    "class": "违规",
    "file": "tests/state/S1-dispatch.test.ts",
    "line": 109,
    "item": "TP-127",
    "problem": "UT28 合并到 UT27 后目标名称未保留源规格行 ID，违反 merge-into 命名要求。",
    "fix": "将目标测试名同时标明 UT27、UT28，保持断言。"
  },
  {
    "id": "G7-12",
    "class": "不整洁",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "line": 177,
    "item": "TP-054, TP-103, TP-164, TP-165",
    "problem": "准备器转换后留下无调用的 makeBinding、selectedOldA、missingEdge、workspaceSource 等代码；S5-goal-settings.test.ts:12、21、22、39 留下仅导入的类型和常量。",
    "fix": "完成前置修正后，删除确实失去消费者的辅助代码和导入，不删除 BLOCKED 所需代码。"
  },
  {
    "id": "G7-13",
    "class": "不整洁",
    "file": "tests/work-graph/A1-architecture-catalog.test.ts",
    "line": 169,
    "item": "TQ-110, TP-156, TP-157, TQ-085/086",
    "problem": "本文件、S2B-activity-calendar.test.ts:215、S2B-activity-calendar-tasks.test.ts:114、135、command-normalization.test.ts:399 的名称仍宣称覆盖已删除的测试内容。",
    "fix": "只收窄名称，使其准确描述保留的测试内容。"
  },
  {
    "id": "G7-14",
    "class": "违规",
    "file": "tests/work-graph/S2B-32-task-timeline-fold.test.ts",
    "line": 228,
    "item": "TP-095, TP-160",
    "problem": "冻结动作要求保留 r2 公开流程用例并删除 fold 旧段，实际反向删除 r2 文件、搬入 fold，没有书面授权。",
    "fix": "将公开用例移回并保留 S2B-r2-s-preentry-control.test.ts，删除 fold 中对应重复用例，保持公开步骤及五段断言。"
  }
]
```

会出错 2，违规 10，不整洁 2，建议 0