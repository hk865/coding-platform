已完成 G6 的只读核查，未修改文件、运行测试、构建或访问网络。下面的 `OK` 仅表示本组范围没有发现问题；按要求保留的 BLOCKED 不代表整项完成。

发现表如下。

| 编号 | 类别 | 位置 | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| G6-01 | 会出错 | `tests/scenarios/S3-context-and-inputs.test.ts:395` | TP-123 | 新前置在 `:322` 真实运行 tA，`:346` 为它增加模型回复；`:314` 仍返回全部请求，所以原来指向 tB 的 `requests[0]` 现在指向 tA。具体漏检：tA 输入正常、仅 tB 发给模型的当前输入丢失 `## Goal` 时，原断言失败，新断言仍通过（`:397`）。 | 记录 tA 完成后的请求起点，定位 tB 首次请求，检查其中当前 Turn 的最后一条 user 消息，保留 `## Goal` 字面期望。仅改成 `[1]` 后搜索全部 messages 仍会被同 Session 的 tA 历史满足；历史拼接见 `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:391`。 |
| G6-02 | 违规 | `tests/helpers/WP1-units-fixture.ts:512` | TP-009、TP-054 | 新增调用 assembler，并把其 binding 放进手造 manifest（`:525`）；assembler 的事实仍由 stub 返回（`:476`），随后继续手造 prepared（`:530`）。这是已禁止的“合法 binding 构造器”绕行，不是保留原样 BLOCKED；改正要求见 `.lead-ref/books/t-items-TP.md:70`、`:394`。 | 撤回本段新增的 assembler/binding 绕行，恢复该 BLOCKED 段；保留其他条目要求的字段迁移。待真实前置、真实 prepare 和 A2 start 拒绝路径冻结后整体转换。 |
| G6-03 | 违规 | `tests/helpers/task-claim-fixture.ts:652` | TP-009、TP-054 | 新 Query helper 直接读取 body store、解析并返回 manifest（`:654`）。这份数据实际进入 AD07 的 permissions 断言：`tests/work-graph/S3-prepared-context-admission.test.ts:714`、`:588`、`:589`，违反 F7（`.lead-ref/books/test-rule-sheet-v1.md:76`）。 | 使用 helper 已装配的真实 materials owner，经 `openArtifact(ctx, { ref: bundleRef, usage: 'current' })` 读取后解析，保留原断言；公开入口见 `src/core/work-graph/materials/material-service.ts:156`。 |
| G6-04 | 违规 | `tests/runtime/source-binding-migration.test.ts:306` | TP-030、TP-118 | 新转换的原始 submission 授权测试只建立 memory 后端（`:297`、`:306`），测试本身没有后端参数化（`:373`）。它检验真实 Query 服务保存的发起者和精确读取次数（`:382`、`:384`），属于服务层行，却缺少 SQLite，违反规则表 `:94`。 | 将同一测试和夹具参数化为 memory、SQLite；两个后端均使用真实共享后端、同一 A3 闸门及原发起者、读取次数断言。 |
| G6-05 | 违规 | `tests/scenarios/support/S5-decisions.ts:555` | TP-124 | 明确 BLOCKED、且明确“不只替换 prepare”的段落仍改成 `prepareTaskForReal`，并改变 policyRevision（`:537`）；手写 entered/result 仍在 `:573`、`:592`。违反 `.lead-ref/books/t-items-TP.md:917`；回执称“未动”也与代码不符（`.lead-ref/replies/t-reply-TP.md:200`）。 | 撤回 agentRequeue 的局部 prepare 转换及 policyRevision 改动，保持 BLOCKED；保留 TP-015、TP-125 在同文件的独立修改。 |
| G6-06 | 违规 | `tests/scenarios/S2C-K-legacy-provenance.test.ts:100` | TP-007、TP-062、TP-122 | 当前只保留单段、一个 Work、无 Query 的断言（`:102`—`:105`）。原双段场景的 indexed、所有 item 为 execution、任务列表精确等于 `[TASK_ID, TASK_ID]` 被删除，原位置见 `.lead-ref/base/tests/scenarios/S2C-K-legacy-provenance.test.ts:506`、`:510`、`:512`。书面改正要求保留 indexed 场景，没有授权删后半业务断言（`.lead-ref/books/t-items-TP.md:902`）。 | 用当前 continuation Session、真实 Work claim 和公开提交但未领取的 Query 重建双段前置，恢复上述三条断言；删除旧来历回填步骤。当前 continuation 读取仍存在于 `src/core/work-graph/views/work-line-reader.ts:2322`。 |
| G6-07 | 违规 | `tests/runtime/K3-34-tool-name-constants.test.ts:59` | TP-026 | `+13` 改成 `+12`，超出条目明确点名的 exploration 列表修改。`12` 本身是字面量，无法证明其形成过程；但整个期望明确依赖生产常量 `BUILTIN_TOOL_NAMES.size`，违反 F8（`.lead-ref/books/test-rule-sheet-v1.md:78`）。 | 改为独立手算的字面量 `15`，说明计算为三个 builtin、`edit/check` 两个保留名、删除 project_index 后十个探索名；保留成员断言。规格名字表见 `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:159`、`:171`，删除要求见 `.lead-ref/books/t-items-TP.md:190`。 |
| G6-08 | 违规 | `tests/scenarios/K-W-workflow-close.test.ts:233` | TP-121 | KA-07 源测试仍完整保留。目标已经补入 Kernel 开口、start 前停点及新 Run 占用断言（`tests/scenarios/WP1-wiring.test.ts:49`、`:68`），但未执行“迁移后删除源”的要求（`.lead-ref/books/t-book.md:54`）。 | 删除原 KA-07 整条，保留 WP1 合并目标、停点及规格标识。 |
| G6-09 | 不整洁 | `tests/helpers/WP2-duties-fixture.ts:6`；`tests/helpers/WP2-notices-fixture.ts:6` | TP-009、TP-054 | 转换后留下仅在 import 出现的符号：duties 的 `artifactBodyDigest`（`:6`）、`PreparedTaskExecution`（`:9`）、`MANIFEST_CONTENT_TYPE`（`:28`）、`WORKSPACE_REVISION`（`:30`）；notices 的 `PreparedQueryManifestV1`（`:6`）、`sha256Hex`（`:17`）、`QUERY_MANIFEST_CONTENT_TYPE`（`:35`）。 | 删除这些未用导入。 |
| G6-10 | 不整洁 | `tests/record-store/SP-text-scan.test.ts:12` | TQ-072、TQ-100、TQ-107 | 删除 SP-12 后，`mkdtemp`（`:12`）、`tmpdir`（`:13`）、`join`（`:14`）只剩导入。 | 删除这三个未用导入，保留仍使用的 `rm`。 |
| G6-11 | 不整洁 | `tests/helpers/task-claim-fixture.ts:191` | TP-107、TP-108 | 注释仍称 governance 是 trusted fixture seed，实际已通过公开 bootstrap 创建并采用架构（`:240`、`:244`、`:251`、`:257`、`:270`）。 | 将这句改为实际的公开 bootstrap 路径描述。 |
| G6-12 | 不整洁 | `tests/runtime/R4c-source-authority-guards.test.ts:279` | TP-115 | 标题仍写 `a trusted running seed can read`，实际已用真实 prepare/start 和模型闸门建立 running 状态（`:318`、`:322`、`:331`）。 | 将标题中的 seed 改为真实运行状态描述。 |

两个重点疑问没有另列发现：

- `permissions.policyRevision` 可选没有掩盖缺失的 Host 输入。正式 Host 配置只有 tools/writeScope 等字段（`src/core/agent-runtime/execution-contracts.ts:129`）；prepare 从 `run.roleBinding.policyRevision` 生成版本（`src/core/agent-runtime/execution-preparation.ts:397`）。两个帮助器的业务输入是 RunRef、配置和调用上下文，没有 prepared/binding 输入（`tests/helpers/task-claim-fixture.ts:548`、`:614`）。已证实的问题是 G6-03 的输出读取路径。
- RL 恰好只改了两个下界，当前为 9,900，两个 12,000 上界未动（`tests/kernel/RL-12-15-conditions.test.ts:360`、`:361`、`:403`、`:404`），符合 TQ-092 的明确动作（`.lead-ref/books/t-items-TQ.md:580`）。

逐项结果如下；包含本组核对的覆盖目标，均不代表跨组整项验收。

```text
TP-007: G6-06
TP-009: G6-02, G6-03, G6-09
TP-010: OK（src/contracts/core/prepared-execution.ts:189；BLOCKED 见下表）
TP-011: OK（tests/runtime/source-binding-migration.test.ts:150）
TP-014: OK（tests/runtime/S3-context-assembler.test.ts:102）
TP-015: OK（tests/scenarios/support/S5-decisions.ts:234）
TP-026: G6-07
TP-027: OK（.lead-ref/groups/G6.diff:2337、:3211）
TP-028: OK（tests/runtime/B1-kernel-assembly.test.ts:98；tests/runtime/B2-runtime-execution.test.ts:260）
TP-029: OK（tests/runtime/R4c-graph-history.test.ts:776、:839）
TP-030: G6-04
TP-031: OK（.lead-ref/groups/G6.diff:3119、:3320、:3421、:4403）
TP-040: OK（tests/runtime/R4c-graph-history.test.ts:32；tests/runtime/S3-context-assembler.test.ts:49）
TP-048: OK（tests/runtime/source-binding-migration.test.ts:150）
TP-050: OK（tests/helpers/task-claim-fixture.ts:322；.lead-ref/groups/G6.diff:903、:1125）
TP-051: OK（tests/helpers/graph-session-fixture.ts:396；tests/runtime/S3-context-assembler.test.ts:102）
TP-052: OK（tests/runtime/source-binding-migration.test.ts:211）
TP-054: G6-02, G6-03, G6-09
TP-056: OK（tests/runtime/K3-34-tool-name-constants.test.ts:50、:61）
TP-062: G6-06
TP-067: OK（tests/scenarios/S1-wait-copy-retirement.test.ts:196）
TP-074: OK（.lead-ref/groups/G6.diff:3211；由 TP-027 吸收删除）
TP-075: OK（tests/scenarios/K-W-workflow-close.test.ts:404）
TP-076: OK（tests/scenarios/WP1-wiring.test.ts:69；仅本组覆盖目标）
TP-077: OK（tests/scenarios/support/common.ts:454）
TP-080: OK（tests/runtime/A2-reconcile-runtime.test.ts:951、:965；tests/runtime/B2-runtime-execution.test.ts:233）
TP-083: OK（tests/helpers/task-claim-fixture.ts:103、:192）
TP-106: OK（tests/helpers/S5R2-d-support.ts:7；tests/runtime/S5R2-agent-application.test.ts:64）
TP-107: G6-11
TP-108: G6-11（seedRun 的 BLOCKED 部分见下表）
TP-109: OK（.lead-ref/groups/G6.diff:1885；tests/scenarios/A7-control.test.ts:110）
TP-110: OK（tests/runtime/K3-35-workspace-baseline-prepare.test.ts:3）
TP-111: OK（.lead-ref/groups/G6.diff:2337、:2374）
TP-112: OK（tests/runtime/R4c-graph-history.test.ts:839、:884）
TP-113: OK（.lead-ref/groups/G6.diff:2481）
TP-114: OK（.lead-ref/groups/G6.diff:2481）
TP-115: G6-12
TP-116: OK（.lead-ref/groups/G6.diff:2667；tests/runtime/K3-continuation-review-note.test.ts:321）
TP-117: OK（tests/runtime/source-binding-migration.test.ts:148、:174；BLOCKED 见下表）
TP-118: G6-04
TP-119: OK（tests/runtime/source-tool-lifecycle.test.ts:223）
TP-120: OK（tests/scenarios/K-W-workflow-close.test.ts:259、:271）
TP-121: G6-08
TP-122: G6-06
TP-123: G6-01
TP-124: G6-05
TP-125: OK（.lead-ref/groups/G6.diff:4295）
TQ-001: OK（tests/scenarios/S3-query-graph.test.ts:459）
TQ-072: G6-10
TQ-091: OK（tests/helpers/task-claim-fixture.ts:270；.lead-ref/groups/G6.diff:1147）
TQ-092: OK（tests/kernel/RL-12-15-conditions.test.ts:360、:403）
TQ-100: G6-10
TQ-101: OK（.lead-ref/groups/G6.diff:1147）
TQ-102: OK（tests/helpers/graph-session-fixture.ts:313）
TQ-103: OK（tests/helpers/graph-session-fixture.ts:398、:423；BLOCKED 见下表）
TQ-104: OK（tests/helpers/graph-session-fixture.ts:431；BLOCKED 见下表）
TQ-105: OK（.lead-ref/groups/G6.diff:1147）
TQ-106: OK（tests/helpers/graph-session-fixture.ts:63、:67、:85、:91）
TQ-107: G6-10
TQ-109: OK（.lead-ref/groups/G6.diff:1147；仅本组共享 helper 删除）
TQ-110: OK（.lead-ref/groups/G6.diff:1147；仅本组共享 helper 删除）
TQ-112: OK（tests/helpers/graph-session-fixture.ts:431；BLOCKED 见下表）
```

BLOCKED 和 partial 部分如下。这里区分“替代步骤未冻结”和“当前公开流程确实造不出原状态”。

| 条目 | 部分 | DSH 的理由是否成立 | 公开步骤可达性 |
|---|---|---|---|
| TP-010 | 删除 manifest.selectedTaskInputs | 成立：书面改正明确尚未冻结；字段仍保留（`.lead-ref/books/t-items-TP.md:78`；`src/contracts/core/prepared-execution.ts:189`）。 | 当前字段由真实 prepare 使用，不是不可达状态；等待删除决定。 |
| TP-054 | WP1 Runtime double | “这个 double 不能真实 prepare”成立：prepareExecution 被设为 forbidden（`tests/helpers/WP1-units-fixture.ts:558`）。但不能由此推出产品入口不可达，且新增绕行构成 G6-02。 | 真实 claim→prepare→start 可达，已有路径见 `tests/runtime/B2-runtime-execution.test.ts:225`。本测试的真实前置和 start 拒绝包装尚未冻结。 |
| TP-108 | seedRun 总体保留 | 成立：要求逐调用点冻结，helper 仍保留（`.lead-ref/books/t-items-TP.md:797`；`tests/helpers/task-claim-fixture.ts:451`）。 | 不能统一裁定为不可达，应按下面各用途区分。 |
| TP-108 | 同 Session 的第二个 Run | 原“公开认领造不出”的理由不成立；使用点在 `tests/runtime/R4c-graph-history.test.ts:146`。 | 可达：首 Run 真实结束后，同 Session claim 第二 Task，再 prepare/start，见 `tests/runtime/B2-runtime-execution.test.ts:225`。晚写较低历史终点等特殊子景仍需单独冻结（`tests/runtime/R4c-graph-history.test.ts:594`）。 |
| TP-108 | 无关联 Attempt/outbox 的 running Run | 原输入确实由 seed 制造（`tests/work-graph/R4c-execution-read.test.ts:212`）。 | 该精确状态不可由合法 claim 产生：claim 强制同时产生 lease、attempt、run、outbox、Session，并一起提交（`src/core/work-graph/tasks/claim-service.ts:479`、`:1272`）。 |
| TP-108 | 无关 Run/提交的规模前置 | 保留等待冻结成立，但不能称没有公开能力；调用见 `tests/work-graph/R4c-execution-read.test.ts:369`、`tests/work-graph/R4c-execution-history-index.test.ts:915`、`:917`。 | 可通过独立 Goal/Task 的公开 claim 产生无关执行；claim 的真实记录提交见 `src/core/work-graph/tasks/claim-service.ts:1272`。具体替代未冻结。 |
| TP-108 | Kernel identity 竞争与已占槽拒绝 | 两个用途共用 seed，需分开裁定（`tests/work-graph/R4c-execution-history-index.test.ts:268`、`:612`、`:656`）。 | 两份手造历史争同一空 identity 且允许成功，不属于 A1/A6；已占槽的拒绝可评估“真实执行前置＋一个被拒请求”。规则边界见 `.lead-ref/books/test-rule-sheet-v1.md:45`、`:57`。 |
| TP-108 | 同 Task 两个 running、再改 planRef | 原精确状态依赖 seed 和覆盖（`tests/work-graph/R4c-task-claim-concurrency.test.ts:63`、`:70`），尚未冻结的理由成立。 | 原地改写不是公开步骤。要保留计划折叠行为，应冻结“旧 Run 结束→新计划→当前 Run”的真实链，不能接受原地覆盖（`.lead-ref/books/test-rule-sheet-v1.md:61`）。 |
| TP-030、TP-118 | changed current execution；`:399` 红测 | 原因成立：保留的 facts 只有 load/events，没有 readQuerySubmission（`tests/runtime/source-binding-migration.test.ts:68`）；`:399` 初始化会触发精确 reader 缺失错误（`src/core/agent-runtime/source-capture-access.ts:632`）。这是静态核查，未运行测试。 | 原测试的执行请求原地改写在 `tests/runtime/source-binding-migration.test.ts:400`。正常 start 从已接受 Job 派生 question/budget（`src/core/work-graph/queries/query-execution.ts:1216`），真实结束则先命中“非 running”检查（`src/core/agent-runtime/source-capture-access.ts:592`），不能替代同一请求再校验分支（`:596`）。原精确篡改状态没有合规公开替代。 |
| TP-117 | 两个 state.set 消费者及共享 Work 前置 | 成立：终态、授权变化和 Reviewer 改写仍在原测试中（`tests/runtime/source-binding-migration.test.ts:148`、`:187`、`:196`）；书面改正要求逐断言冻结（`.lead-ref/books/t-items-TP.md:864`）。 | 真实 running/entered 和真实结束可达（`tests/runtime/R4c-source-authority-guards.test.ts:318`、`:331`、`:340`）；原地替换已接受授权或 Reviewer digest 的精确输入不能由这些生命周期步骤代替。 |
| TP-124 | Agent 发起 requeue | “完整路径未冻结”成立，但“代码未动”不成立，见 G6-05。 | 当前真实 Runtime 工具路径不可达：未知工具名在 start 被拒（`src/core/agent-runtime/execution-driver.ts:239`）；已有测试明确固定 requeue_task/reverify_round 的 prepare ready、start unsupported、模型调用为 0（`tests/runtime/C2-runtime-platform-tools.test.ts:234`）。 |
| TQ-091 | task-claim 的裸 baseline 闭合 | DSH 的旧结论已不适用于合并树：回执仍要求补 catalog（`.lead-ref/replies/t-reply-TQ.md:131`），当前已真实 adopt，输入包含 catalog（`tests/helpers/task-claim-fixture.ts:270`）。 | 已通过公开 adoptInitialArchitecture 到达；本组此部分已闭合。 |
| TQ-103 | seedAcceptedTask | 尚未冻结真实计划生成链的理由成立；当前仍手写 Goal/Plan（`tests/helpers/graph-session-fixture.ts:398`、`:423`）。 | 产品公开链可达：真实 Query 产生 Answer，再 planning_answer、adopt_initial_plan，见 `tests/business/R5b-initial-planning-workflow.test.ts:199`、`:292`、`:311`。需要冻结适用于本夹具的步骤，不是产品缺入口。 |
| TQ-104、TQ-112 | 占用、取消、责任链接及归档 | 依赖 TQ-103 的合法 Plan，保留 BLOCKED 的理由成立（`.lead-ref/replies/t-reply-TQ.md:36`）；overwriteSession 未转换（`tests/helpers/graph-session-fixture.ts:431`）。 | 可达路线已经书面确定：不带 openResponsibleLink 的 claim→busy→取消未进入 Run→原责任链接和归档步骤（`.lead-ref/books/t-items-TQ.md:672`、`:732`）。只有显式 true 才自动开链接，见 `src/core/work-graph/tasks/claim-service.ts:1013`。 |

同一发现表的 JSON：

```json
[
  {
    "id": "G6-01",
    "class": "会出错",
    "file": "tests/scenarios/S3-context-and-inputs.test.ts",
    "line": 395,
    "item": "TP-123",
    "problem": "真实运行 tA 的新前置产生首个模型请求（:322、:346），但 modelRequests 仍返回全部请求（:314），requests[0] 从 tB 改指 tA。仅 tB 当前模型输入丢失 ## Goal 时，原断言失败，新断言仍可通过（:397）。",
    "fix": "记录 tA 完成后的请求起点，检查 tB 首请求中当前 Turn 的最后一条 user 消息，保留 ## Goal 字面期望；不要搜索含 tA 历史的全部 messages。"
  },
  {
    "id": "G6-02",
    "class": "违规",
    "file": "tests/helpers/WP1-units-fixture.ts",
    "line": 512,
    "item": "TP-009, TP-054",
    "problem": "新增 assembler 调用的事实仍由 stub 返回（:476），其 binding 被填入手造 manifest（:525），随后手造 prepared（:530），绕过真实 prepare 要求，并改动了声明 BLOCKED 的部分。",
    "fix": "撤回该 BLOCKED 段新增的 assembler/binding 绕行，保留独立字段迁移；真实前置、prepare 和 A2 start 拒绝路径冻结后再整体转换。"
  },
  {
    "id": "G6-03",
    "class": "违规",
    "file": "tests/helpers/task-claim-fixture.ts",
    "line": 652,
    "item": "TP-009, TP-054",
    "problem": "直接读取 body store 并返回 manifest；tests/work-graph/S3-prepared-context-admission.test.ts:714 将其传给 :588、:589 的 permissions 断言，违反 F7。",
    "fix": "使用真实 materials.openArtifact 公开入口读取 bundleRef 后解析，保留原断言。"
  },
  {
    "id": "G6-04",
    "class": "违规",
    "file": "tests/runtime/source-binding-migration.test.ts",
    "line": 306,
    "item": "TP-030, TP-118",
    "problem": "新增真实 Query submission 授权测试只使用 memory，:373 没有后端参数化；:382、:384 检验服务层保存的发起者和读取次数，缺少规则要求的 SQLite。",
    "fix": "同一夹具和测试参数化为 memory、SQLite，保留真实共享后端、A3 闸门、发起者和单次读取断言。"
  },
  {
    "id": "G6-05",
    "class": "违规",
    "file": "tests/scenarios/support/S5-decisions.ts",
    "line": 555,
    "item": "TP-124",
    "problem": "明确 BLOCKED 的 agentRequeue 被局部改为 prepareTaskForReal，并修改 policyRevision（:537），而手写 entered/result 仍在 :573、:592；违反书面改正且与回执未动的说法不符。",
    "fix": "撤回 agentRequeue 的局部 prepare 转换及 policyRevision 改动，保持 BLOCKED，保留 TP-015、TP-125 的独立修改。"
  },
  {
    "id": "G6-06",
    "class": "违规",
    "file": "tests/scenarios/S2C-K-legacy-provenance.test.ts",
    "line": 100,
    "item": "TP-007, TP-062, TP-122",
    "problem": "只保留单段执行列表；删除了 base 同文件 :506、:510、:512 的双段 indexed、全部 execution 和两个 TASK_ID 断言，超出删除旧来历场景的授权。",
    "fix": "用当前 continuation Session、真实 Work claim 和公开提交但未领取的 Query 重建双段前置，恢复三条断言，不恢复旧回填步骤。"
  },
  {
    "id": "G6-07",
    "class": "违规",
    "file": "tests/runtime/K3-34-tool-name-constants.test.ts",
    "line": 59,
    "item": "TP-026",
    "problem": "将 BUILTIN_TOOL_NAMES.size + 13 改成 + 12，超出点名的 exploration 列表修改；12 虽是字面量，整个期望仍从生产常量推导，违反 F8。",
    "fix": "改为独立手算字面量 15，注明三个 builtin、edit/check 两个保留名和十个探索名的计算，保留成员断言。"
  },
  {
    "id": "G6-08",
    "class": "违规",
    "file": "tests/scenarios/K-W-workflow-close.test.ts",
    "line": 233,
    "item": "TP-121",
    "problem": "WP1-wiring.test.ts:49、:68 已补齐合并目标断言，但原 KA-07 仍完整保留，未执行任务书要求的迁移后删除源。",
    "fix": "删除原 KA-07 整条，保留 WP1 目标、停点及规格标识。"
  },
  {
    "id": "G6-09",
    "class": "不整洁",
    "file": "tests/helpers/WP2-duties-fixture.ts",
    "line": 6,
    "item": "TP-009, TP-054",
    "problem": "转换留下未用导入：本文件 :6 artifactBodyDigest、:9 PreparedTaskExecution、:28 MANIFEST_CONTENT_TYPE、:30 WORKSPACE_REVISION；tests/helpers/WP2-notices-fixture.ts:6 PreparedQueryManifestV1、:17 sha256Hex、:35 QUERY_MANIFEST_CONTENT_TYPE。",
    "fix": "删除列出的未用导入。"
  },
  {
    "id": "G6-10",
    "class": "不整洁",
    "file": "tests/record-store/SP-text-scan.test.ts",
    "line": 12,
    "item": "TQ-072, TQ-100, TQ-107",
    "problem": "删除 SP-12 后，:12 mkdtemp、:13 tmpdir、:14 join 只剩导入。",
    "fix": "删除这三个未用导入，保留仍使用的 rm。"
  },
  {
    "id": "G6-11",
    "class": "不整洁",
    "file": "tests/helpers/task-claim-fixture.ts",
    "line": 191,
    "item": "TP-107, TP-108",
    "problem": "注释仍称 governance 是 trusted fixture seed，实际 :240、:244、:251、:257、:270 已使用公开 bootstrap 和 adopt。",
    "fix": "将该句改为实际的公开 bootstrap 路径描述。"
  },
  {
    "id": "G6-12",
    "class": "不整洁",
    "file": "tests/runtime/R4c-source-authority-guards.test.ts",
    "line": 279,
    "item": "TP-115",
    "problem": "标题仍称 trusted running seed，实际 :318、:322、:331 已通过真实 prepare/start 和模型闸门建立 running 状态。",
    "fix": "将标题中的 seed 改为真实运行状态描述。"
  }
]
```

会出错 1，违规 7，不整洁 4，建议 0