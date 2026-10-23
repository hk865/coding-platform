建议保留 S-01，修正夹具接线。这里的主要差异不是 `test/test → deepseek/...`，而是 **Host 冻结了 `runtime-<sha16>`，启动替身却以 `ag2b-work-model@1` 作为回退 `modelId`**；两边的 provider、model、promptPack、reasoningReplay 相同。来源分别见 `tests/helpers/AG2b-collaboration-fixture.ts:277`、`src/app/runtime-configuration.ts:451`、`src/app/runtime-configuration.ts:474`、`tests/scenarios/harness.ts:791`、`src/contracts/prompts/prompt-set.ts:111`。

本次只读，没有修改文件、运行测试或构建、执行 Git 写操作或联网。下面的补丁是静态审阅建议；已有探针证明撤回检查能消除回归，不能当作此补丁已通过的证据。探针两批分别为 50、36 项通过，见 `.lead-ref/checks/pc1b-r1-s01-probe.log:5`、`.lead-ref/checks/pc1b-r1-s01-probe.log:8`。

**1. 生产路径**

`src/` 中真正构造这个模型对象的地方，以及允许外部模型流入检查的入口如下。

| 位置 | 对 `selection` 的处理 |
|---|---|
| `src/app/runtime-configuration.ts:427`、`src/app/runtime-configuration.ts:471` | 唯一从可序列化 Host 配置新建 `BoundModel` 的工厂。始终填写三个字段；`modelId` 来自显式配置或 `runtimeModelId`，另外两项有默认值。见 `src/app/runtime-configuration.ts:451`、`src/app/runtime-configuration.ts:474`。 |
| `src/app/runtime-configuration.ts:502` | 把上述模型放进 `ResolvedRuntimeConfiguration`，不另造模型；Work、Query 共用这个解析过程。见 `src/app/runtime-configuration.ts:504`、`src/app/runtime-configuration.ts:515`、`src/app/runtime-configuration.ts:520`。 |
| `src/app/host.ts:682` | 设置重建的**上游配置**，还不是 `BoundModel`；提供设置项 `modelId`，随后仍经过上述工厂。见 `src/app/host.ts:684`、`src/app/host.ts:783`。 |
| `src/core/agent-runtime/execution-preparation.ts:675` | 快照重建模型对象：原来有 `selection` 就复制，没有就继续没有；不会补齐。见 `src/core/agent-runtime/execution-preparation.ts:680`。 |
| `src/app/host.ts:140`、`src/app/host.ts:361` | 受信任的程序化 `runtime` 注入入口。包装 resolver，但没有要求或补齐 `selection`；配置收窄也保留原模型。见 `src/app/host.ts:368`、`src/app/runtime-configuration.ts:188`。 |
| `src/composition/create-platform.ts:249` | composition 的直接 `RuntimeHostBindings` 注入入口，传入运行时使用；没有补齐模型选择。见 `src/composition/create-platform.ts:1169`、`src/composition/create-platform.ts:1233`。 |
| `src/app/host-settings.ts:223` | resolver registry 固定、转交 resolver；不重建或补齐模型。Work、Query 分别见 `src/app/host-settings.ts:238`、`src/app/host-settings.ts:256`。 |

因此要分两层回答：

- **仓内标准 CLI／设置构建路径会填写 `selection`。** 初次构建和设置重建均调用同一工厂，见 `src/app/host.ts:444`、`src/app/host.ts:783`。
- **不能把“所有生产代码通路都不可能缺失”当成已证明事实。** 生产 API 保留程序化注入入口，`BoundModel.selection` 本身也是可选字段；程序化 Host 保留原绑定，不从设置重建。这样的 resolver 可以合法返回无 `selection` 的模型，并到达 Work／Query 检查。见 `src/core/agent-runtime/source-tool-ports.ts:25`、`src/app/host.ts:444`、`src/app/host.ts:454`、`src/core/agent-runtime/execution-driver.ts:585`、`src/core/agent-runtime/query-execution.ts:251`。

没有发现另一个仓内正常 Host 工厂主动生成无 `selection` 的模型；但上述公开注入通路意味着“只有测试可达”是当前调用习惯，不是类型或入口保证。`observed-model-run` 内的 Kernel 模型配置属于后续发送配置，不是本次检查的模型来源，见 `src/core/agent-runtime/observed-model-run.ts:379`。

**2. 16 个文件、32 项失败的来源**

先定义下表使用的三个来源：

- **H：真实 Host 准备绑定。** `HostScenario` 启动 `startAG2bHost`，其 Work 配置由真实 Host 工厂解析，得到显式 `selection`。见 `tests/scenarios/harness.ts:1029`、`tests/helpers/AG2b-collaboration-fixture.ts:277`、`src/app/runtime-configuration.ts:474`。
- **W：`openWorkRoot` 启动绑定。** 使用无 `selection` 的 `ag2bWorkRuntime`，因此回退到 `ag2b-work-model@1`。见 `tests/scenarios/support/common.ts:740`、`tests/scenarios/harness.ts:791`、`src/contracts/prompts/prompt-set.ts:111`。
- **R：`openReviewWorkRoot` 启动绑定。** 底层也是同一个 `ag2bWorkRuntime`，只增加只读命令授权，保留其模型。见 `tests/scenarios/support/review-work-root.ts:50`、`tests/scenarios/support/review-work-root.ts:59`。

下面逐项列出准备和启动位置。同一行列出的多个用例共享该行注明的准备／启动函数。

| 失败文件、用例 | 准备来源 | 启动来源 |
|---|---|---|
| `A8-host-restart-entry`：A8-1b | H；`tests/scenarios/A8-host-restart-entry.test.ts:57` | W；调用 `authorizeWithoutBegin` 于 `tests/scenarios/A8-host-restart-entry.test.ts:377`，实际开根、启动于 `tests/scenarios/support/common.ts:779`、`tests/scenarios/support/common.ts:784`。 |
| 同文件：A8-2d | H；`tests/scenarios/A8-host-restart-entry.test.ts:461` | W；开根 `tests/scenarios/A8-host-restart-entry.test.ts:468`，启动 `tests/scenarios/A8-host-restart-entry.test.ts:471`。 |
| `A8-host-restart`：A8-3b | H；`tests/scenarios/A8-host-restart.test.ts:155` | W；开根 `tests/scenarios/A8-host-restart.test.ts:163`，启动 `tests/scenarios/A8-host-restart.test.ts:166`。 |
| 同文件：A8-3j | H；`tests/scenarios/A8-host-restart.test.ts:225` | W；开根 `tests/scenarios/A8-host-restart.test.ts:233`，启动 `tests/scenarios/A8-host-restart.test.ts:236`。 |
| 同文件：A8-3h | H；`tests/scenarios/A8-host-restart.test.ts:355` | W；开根 `tests/scenarios/A8-host-restart.test.ts:371`，启动 `tests/scenarios/A8-host-restart.test.ts:374`。 |
| `C3-brief-idempotency`：C3-R1 | H，第二次准备；`tests/scenarios/C3-brief-idempotency.test.ts:114` | W，经 `authorizeWithoutBegin`；`tests/scenarios/C3-brief-idempotency.test.ts:124`。 |
| `C7-defer-reactivate`：TASK-19 与 ControlIntent 移动竞争 | H；`tests/scenarios/C7-defer-reactivate.test.ts:490` | W；开根 `tests/scenarios/C7-defer-reactivate.test.ts:499`，启动 `tests/scenarios/C7-defer-reactivate.test.ts:501`。 |
| `K-R-attested-facts-source`：L9/D2、L9/D12，共 2 项；入口 `tests/scenarios/K-R-attested-facts-source.test.ts:177`、`tests/scenarios/K-R-attested-facts-source.test.ts:207` | H，共用 `openAttestedEnteringRun`；`tests/scenarios/K-R-attested-facts-source.test.ts:121`、`tests/scenarios/K-R-attested-facts-source.test.ts:129` | W；开根 `tests/scenarios/K-R-attested-facts-source.test.ts:132`，启动 `tests/scenarios/K-R-attested-facts-source.test.ts:135`。 |
| `K3-06-mixed-batch`：file_edit、platform，共 2 项；`tests/scenarios/K3-06-mixed-batch.test.ts:160`、`tests/scenarios/K3-06-mixed-batch.test.ts:184` | H；两个调用选择 `prepareViaHost`，进入 `tests/scenarios/K3-06-mixed-batch.test.ts:135`。调用设置见 `tests/scenarios/K3-06-mixed-batch.test.ts:162`、`tests/scenarios/K3-06-mixed-batch.test.ts:188`。 | W；共用开根 `tests/scenarios/K3-06-mixed-batch.test.ts:129`，启动 `tests/scenarios/K3-06-mixed-batch.test.ts:137`。 |
| `K3-08-wait-reply`：（一）wait send 在途 | H；`tests/scenarios/K3-08-wait-reply.test.ts:90` | W；开根 `tests/scenarios/K3-08-wait-reply.test.ts:93`，启动 `tests/scenarios/K3-08-wait-reply.test.ts:96`。 |
| `K3-26-inventory-scenarios`：（二）Kernel 可读且无未决调用 | H；`tests/scenarios/K3-26-inventory-scenarios.test.ts:267` | W；开根 `tests/scenarios/K3-26-inventory-scenarios.test.ts:272`，启动 `tests/scenarios/K3-26-inventory-scenarios.test.ts:274`。 |
| `K3-29-recovery-continuation`：row 9 | **续接**由 H 准备；`tests/scenarios/K3-29-recovery-continuation.test.ts:417`、`tests/scenarios/K3-29-recovery-continuation.test.ts:426` | R；根创建于 `tests/scenarios/K3-29-recovery-continuation.test.ts:332`，续接启动于 `tests/scenarios/K3-29-recovery-continuation.test.ts:427`。 |
| `K3-R1-continuation-protection`：文件符号链接 | H；`tests/scenarios/K3-R1-continuation-protection.test.ts:168` | W；开根 `tests/scenarios/K3-R1-continuation-protection.test.ts:175`，启动 `tests/scenarios/K3-R1-continuation-protection.test.ts:178`。 |
| 同文件：目录符号链接 | H；`tests/scenarios/K3-R1-continuation-protection.test.ts:203` | W；开根 `tests/scenarios/K3-R1-continuation-protection.test.ts:210`，启动 `tests/scenarios/K3-R1-continuation-protection.test.ts:213`。 |
| 同文件：baseline_dirty | H；`tests/scenarios/K3-R1-continuation-protection.test.ts:239` | W；开根 `tests/scenarios/K3-R1-continuation-protection.test.ts:246`，启动 `tests/scenarios/K3-R1-continuation-protection.test.ts:249`。 |
| `K3-R1-file-change`：replace、create，共 2 项；`tests/scenarios/K3-R1-file-change.test.ts:188`、`tests/scenarios/K3-R1-file-change.test.ts:241` | H，共用 `driveSingleEdit`；`tests/scenarios/K3-R1-file-change.test.ts:150` | W；开根 `tests/scenarios/K3-R1-file-change.test.ts:157`，启动 `tests/scenarios/K3-R1-file-change.test.ts:161`。 |
| `K3-R1-restart-flows`：K3-01、K3-03，共 2 项；`tests/scenarios/K3-R1-restart-flows.test.ts:144`、`tests/scenarios/K3-R1-restart-flows.test.ts:239` | H，共用 `crashSendFlow`；`tests/scenarios/K3-R1-restart-flows.test.ts:88` | W；开根 `tests/scenarios/K3-R1-restart-flows.test.ts:93`，启动 `tests/scenarios/K3-R1-restart-flows.test.ts:95`。 |
| 同文件：K3-02 | H，`crashSendBeforeMessage`；`tests/scenarios/K3-R1-restart-flows.test.ts:113` | W；开根 `tests/scenarios/K3-R1-restart-flows.test.ts:118`，启动 `tests/scenarios/K3-R1-restart-flows.test.ts:122`。 |
| `K3-R1-second-cleanup`：second_auto_cleanup | H，失败的是 B 的准备；`tests/scenarios/K3-R1-second-cleanup.test.ts:192` | W；B 开根 `tests/scenarios/K3-R1-second-cleanup.test.ts:202`，启动 `tests/scenarios/K3-R1-second-cleanup.test.ts:206`。 |
| `K3-R1-session-not-closable`：session_not_closable | H；`tests/scenarios/K3-R1-session-not-closable.test.ts:70` | W；开根 `tests/scenarios/K3-R1-session-not-closable.test.ts:76`，启动 `tests/scenarios/K3-R1-session-not-closable.test.ts:78`。 |
| `K3-R1-workspace-capture`：缺失、重建、符号链接、可执行位、内容变化、存储 throw、存储 reject，共 7 项；入口依次为 `tests/scenarios/K3-R1-workspace-capture.test.ts:217`、`tests/scenarios/K3-R1-workspace-capture.test.ts:225`、`tests/scenarios/K3-R1-workspace-capture.test.ts:233`、`tests/scenarios/K3-R1-workspace-capture.test.ts:244`、`tests/scenarios/K3-R1-workspace-capture.test.ts:251`、`tests/scenarios/K3-R1-workspace-capture.test.ts:264` | H，共用 `runCase`；`tests/scenarios/K3-R1-workspace-capture.test.ts:169` | W；开根 `tests/scenarios/K3-R1-workspace-capture.test.ts:174`，启动 `tests/scenarios/K3-R1-workspace-capture.test.ts:178`。 |
| `invariants-fuzz`：最终 coverage 汇总，共 1 项；`tests/state/invariants-fuzz.test.ts:209` | H；`advanceTo` 驱动到 start 请求，`reach` 取出准备结果。见 `tests/scenarios/support/fuzz.ts:860`、`tests/scenarios/support/fuzz.ts:885`、`tests/scenarios/support/fuzz.ts:1371`。 | W，经 `authorizeWithoutBegin`；`tests/scenarios/support/fuzz.ts:1372`。未绑定 brief 后，相关计数和后续分支缺失，见 `tests/scenarios/support/fuzz.ts:1377`、`tests/scenarios/support/fuzz.ts:1381`；最终断言在 `tests/state/invariants-fuzz.test.ts:217`。 |

这些用例均应判为**接线意外，不应改成期待模型绑定变化的 `forbidden`**。各用例在制造重启、提交窗口、文件状态或续接条件；共同启动替身本来就声明模拟 AG2b Host 的绑定，见 `tests/scenarios/harness.ts:774`。当前拒绝发生在进入这些业务条件之前，见 `src/core/agent-runtime/execution-driver.ts:599`；这解释了随后“锁未拿到”和“模型没有进入”的断言失败，例如 `tests/scenarios/K-R-attested-facts-source.test.ts:140`、`tests/scenarios/K3-R1-workspace-capture.test.ts:182`。

两个容易误判的点：

- K3-29 row 9 的审查轮已经用同一 R 根准备、启动；失败的是随后 **H 准备 → R 启动**的续接。见 `tests/scenarios/K3-29-recovery-continuation.test.ts:403`、`tests/scenarios/K3-29-recovery-continuation.test.ts:406`、`tests/scenarios/K3-29-recovery-continuation.test.ts:417`、`tests/scenarios/K3-29-recovery-continuation.test.ts:427`。
- fuzz 是 **1 项 coverage 失败**，不能把相关种子或缺失计数另算失败用例。见 `.lead-ref/checks/full-pc1b-r1-vitest.txt:5616`、`tests/state/invariants-fuzz.test.ts:217`。

**3. 按原因分组、最小补丁和白名单**

| 共享入口 | 本次覆盖 |
|---|---|
| `ag2bWorkRuntime` 缺少与 Host 一致的显式身份，`tests/scenarios/harness.ts:791` | 根因覆盖全部 16 文件、32 项。 |
| `openWorkRoot`，以及它上面的 `authorizeWithoutBegin`，`tests/scenarios/support/common.ts:740`、`tests/scenarios/support/common.ts:779` | 上表除 K3-29 row 9 外的 15 文件、31 项。 |
| `openReviewWorkRoot`，`tests/scenarios/support/review-work-root.ts:50` | K3-29 row 9：1 文件、1 项。 |
| `preparationHost`／`S2B-runtime-steps-fixture` | 本次 16 文件中没有这一类新错配。L-04 已把 start 的模型配置传给 preparation，见 `tests/helpers/S2B-runtime-steps-fixture.ts:400`、`tests/helpers/S2B-runtime-steps-fixture.ts:405`。 |

建议给底层 helper 增加**可选 Work modelId**，只在 W、R 两个需要承接 H 准备结果的入口填写。其他直接调用者仍保持原默认值；Query 不改。这样不需要改变 `preparationHost` 的 `test/test` 默认值，也不需要修改任何失败测试正文。相关现状见 `tests/scenarios/harness.ts:779`、`tests/scenarios/harness.ts:809`、`tests/helpers/task-claim-fixture.ts:522`。

身份应从 **AG2b Host 的输入配置**计算，不从已冻结的 `promptSet` 抄回。原输入没有显式 `baseUrl`、`options` 或提示词选择字段，因此下面也不传这些字段；这是 Host 当前计算身份的同一输入，见 `tests/helpers/AG2b-collaboration-fixture.ts:277`、`src/app/runtime-configuration.ts:451`、`src/app/host.ts:815`。

```diff
--- a/tests/scenarios/harness.ts
+++ b/tests/scenarios/harness.ts
@@ -778,3 +778,3 @@
 export function ag2bWorkRuntime(model: () => ScriptedModel,
-  options: { tools?: readonly string[]; queryModel?: ScriptedModel } = {}): RuntimeHostBindings {
+  options: { tools?: readonly string[]; queryModel?: ScriptedModel; workModelId?: string } = {}): RuntimeHostBindings {
   const queryModel = options.queryModel;
@@ -790,4 +790,8 @@
         configurationRevision: 'ag2b-work-host@1',
         model: { configuration: { revision: 'ag2b-work-model@1', provider: 'deepseek', model: 'ag2b-scripted-work',
           baseUrl: 'http://127.0.0.1' }, client: model().client,
+          ...(options.workModelId === undefined ? {} : {
+            selection: { modelId: options.workModelId, promptPack: 'platform',
+              reasoningReplay: 'current_run' as const },
+          }),
         inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'scenario-counter' }) } },

--- a/tests/scenarios/support/common.ts
+++ b/tests/scenarios/support/common.ts
@@ -57,7 +57,8 @@
 import type { ModelRequest } from '../../../vendor/coding-agent/dist/public-api.js';
+import { runtimeModelId } from '../../../src/app/runtime-configuration.js';
 import { createScriptedModel, type ScriptedModel, type ScriptedReply } from '../../helpers/B2-runtime-fixture.js';
 import {
-  AG2B_AT, AG2B_CHECK_COMMAND, AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_WORK_ROLE,
+  AG2B_AT, AG2B_CHECK_COMMAND, AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_RESULT_FILE, AG2B_RESULT_TEXT, AG2B_SCOPE, AG2B_SECRET_VAR, AG2B_WORK_ROLE,
   AG2B_WORK_ROLE_BINDING, AG2B_WORK_TASK_ID, ag2bChecksConfiguration, corePost, graphWrite, permissionRevision, plain,
   seedAG2bWorkGraph, startAG2bHost, writeAG2bWorkspace, type AG2bHost,
 } from '../../helpers/AG2b-collaboration-fixture.js';
@@ -738,5 +739,7 @@
     kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
       databasePath: join(h.database, 'kernel.sqlite') }] },
     runtime: ag2bWorkRuntime(() => model, { ...(queryModel === undefined ? {} : { queryModel }),
+      workModelId: runtimeModelId({ provider: 'deepseek', model: 'ag2b-scripted-work',
+        secretEnvironmentVariable: AG2B_SECRET_VAR }),
       ...(tools === undefined ? {} : { tools }) }),
     ...(observer === undefined ? {} : { commitObserver: observer }),

--- a/tests/scenarios/support/review-work-root.ts
+++ b/tests/scenarios/support/review-work-root.ts
@@ -30,4 +30,4 @@
 import {
-  AG2B_AT, AG2B_CONSUMER_ID, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING,
+  AG2B_AT, AG2B_CONSUMER_ID, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_SECRET_VAR, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING,
   AG2B_WORK_TASK_ID, permissionRevision, plain,
 } from '../../helpers/AG2b-collaboration-fixture.js';
@@ -38,3 +38,3 @@
 import {
-  createWorkbenchRuntimeHostBindings, type WorkbenchRuntimeConfiguration,
+  createWorkbenchRuntimeHostBindings, runtimeModelId, type WorkbenchRuntimeConfiguration,
 } from '../../../src/app/runtime-configuration.js';
@@ -48,5 +48,8 @@
 export async function openReviewWorkRoot(h: HostScenario, model: ScriptedModel,
   observer?: RecordCommitObserver): Promise<Platform> {
-  const base = ag2bWorkRuntime(() => model, { tools: [...AG2B_WORK_TOOLS, 'run_readonly_command'] });
+  const base = ag2bWorkRuntime(() => model, { tools: [...AG2B_WORK_TOOLS, 'run_readonly_command'],
+    workModelId: runtimeModelId({ provider: 'deepseek', model: 'ag2b-scripted-work',
+      secretEnvironmentVariable: AG2B_SECRET_VAR }),
+  });
   const facts = { access: 'all_except_denied' as const, processSandboxOptions: {} };
   const runtime = {
```

这份补丁保留脚本模型、计数器、权限、故障注入和 Query 接线。W、R 的模型选择元数据会被校正；它们原来在同一根内准备／启动的调用者将同时使用校正后的身份，而其他 `ag2bWorkRuntime` 调用者因未传参数保持原值。依据是模型与授权分别构造的位置：`tests/scenarios/harness.ts:791`、`tests/scenarios/harness.ts:797`、`tests/scenarios/support/review-work-root.ts:59`。

返工 2 对此问题需要新增的白名单只有：

- `tests/scenarios/harness.ts:778`
- `tests/scenarios/support/common.ts:731`
- `tests/scenarios/support/review-work-root.ts:48`

**测试正文修改数为 0。** 原 L-04 的两个 helper 不再改；它们已完成的修复见 `tests/helpers/task-claim-fixture.ts:523`、`tests/helpers/S2B-runtime-steps-fixture.ts:405`，DSH 回报也明确未改 S3 正文，见 `.lead-ref/replies/pc1b-r1-reply.md:39`。

**4. 其他套件与规模批**

有其他调用者仍依赖无 `selection` 时两端的回退值一致。应区分“同一 resolver 的正常一致”和“跨 Host 接线碰巧一致”；不能仅因省略 `selection` 就认定还需改测试。规格明确允许该回退，见 `.lead-ref/books/pc1-book.md:299`。

直接相关的额外入口如下：

| 入口／用例 | 当前为什么不出现本次错配 |
|---|---|
| A8-Q3 | Query 在同一个 `openWorkRoot` 内准备、启动，两端均回退为 `ag2b-query-model@1`。见 `tests/scenarios/A8-host-restart-lease.test.ts:210`、`tests/scenarios/A8-host-restart-lease.test.ts:213`、`tests/scenarios/A8-host-restart-lease.test.ts:215`、`tests/scenarios/harness.ts:809`。 |
| S3 graph tools 的 AG2b 根 | Work／Query 包装器都委托同一个 base；Query 准备、启动使用同一 platform。见 `tests/runtime/S3-graph-tools.test.ts:1166`、`tests/runtime/S3-graph-tools.test.ts:1169`、`tests/runtime/S3-graph-tools.test.ts:1175`、`tests/runtime/S3-graph-tools.test.ts:1260`、`tests/runtime/S3-graph-tools.test.ts:1262`。 |
| 场景 platform 根、PlanBoard 根 | 自身 workflow 与 runtime 共享同一 `ag2bWorkRuntime`。见 `tests/scenarios/harness.ts:841`、`tests/scenarios/harness.ts:843`、`tests/scenarios/support/common.ts:618`、`tests/scenarios/support/common.ts:621`。 |
| Shell／review 公共流程 | `crashOneCommand` 在 shell 根准备并启动；`proposalRound` 在 review 根准备并启动。见 `tests/scenarios/support/review-card-round.ts:103`、`tests/scenarios/support/review-card-round.ts:104`、`tests/scenarios/support/review-card-round.ts:106`、`tests/scenarios/support/review-card-round.ts:144`、`tests/scenarios/support/review-card-round.ts:147`、`tests/scenarios/support/review-card-round.ts:155`。 |
| K3-35 两套独立准备／运行包装 | 两者都调用 `k3_35Configuration`，所以回退身份相同。见 `tests/helpers/K3-35-prepare.ts:75`、`tests/helpers/K3-35-runtime.ts:190`、`tests/helpers/K3-35-runtime.ts:92`。 |
| S2B runtime steps | 两端已经显式共用 model configuration；这是 L-04 修后的状态。见 `tests/helpers/S2B-runtime-steps-fixture.ts:385`、`tests/helpers/S2B-runtime-steps-fixture.ts:405`、`tests/helpers/S2B-runtime-steps-fixture.ts:408`。 |
| B2 runtime | 共用同一个 Host resolver，模型仍无 `selection`。见 `tests/helpers/B2-runtime-fixture.ts:158`、`tests/helpers/B2-runtime-fixture.ts:245`、`tests/helpers/B2-runtime-fixture.ts:305`。 |

上述 shell／review 家族在 16 文件之外的调用者也已检索，名单为：

- `tests/business/K3-41-release-hold.test.ts:105`；`tests/runtime/K3-35-review-input-size.test.ts:136`。
- `tests/scenarios/B2-09b-allowance-crash.test.ts:95`；`tests/scenarios/K3-05-review-round.test.ts:86`；`tests/scenarios/K3-09-restart-between-calls.test.ts:97`；`tests/scenarios/K3-10-review-round-cells.test.ts:111`；`tests/scenarios/K3-11-review-reasons-r2.test.ts:120`；`tests/scenarios/K3-12-14-review-round.test.ts:140`。
- `tests/scenarios/K3-15-card-hold.test.ts:60`；`tests/scenarios/K3-16-approval-round.test.ts:91`；`tests/scenarios/K3-16-proposal-round.test.ts:91`；`tests/scenarios/K3-17-review-answer-shape.test.ts:70`；`tests/scenarios/K3-18-one-card.test.ts:103`；`tests/scenarios/K3-19-review-unavailable.test.ts:90`。
- `tests/scenarios/K3-25-attestation-replay.test.ts:71`；`tests/scenarios/K3-27-review-claim-close.test.ts:123`；`tests/scenarios/K3-28-attested-continuation.test.ts:68`；`tests/scenarios/K3-29-disposition-recovery.test.ts:103`；`tests/scenarios/K3-29-maintenance-review-run.test.ts:79`；`tests/scenarios/K3-29-recovery-round.test.ts:177`；`tests/scenarios/K3-29-startup-variants.test.ts:85`。
- `tests/scenarios/K3-37-stopped-review-round.test.ts:104`；`tests/scenarios/K3-42-truncated-command.test.ts:168`；`tests/scenarios/K3-42-unexpanded-r2.test.ts:158`；`tests/scenarios/K3-44-crr-kind4.test.ts:154`；`tests/scenarios/K3-44-hold-restart.test.ts:69`；`tests/scenarios/K3-44-recovery-answers.test.ts:131`；`tests/scenarios/K3-45-review-incomplete-r2.test.ts:120`；`tests/work-graph/K3-18-review-card-queue.test.ts:103`。

另有调用这些根却不通过它们启动模型的地方，不能算新的 S-01 回归：重复回执写入、暂停续接的 Agent 写入、健康状态写入，分别见 `tests/scenarios/A4-duplicate-receipts.test.ts:447`、`tests/scenarios/C3-paused-continue-brief.test.ts:66`、`tests/scenarios/WP2-wiring-scenario.test.ts:195`、`tests/scenarios/WP2-wiring-scenario.test.ts:197`。

更广的检索还发现以下无 `selection` 的本地模型构造入口；它们继续使用回退协议，不需要为本次修复一律补字段：

- 独立 workflow／composition：`tests/composition/A2-requeue-platform.test.ts:112`、`tests/composition/A2-reverify-platform.test.ts:90`、`tests/composition/A2-verification-chain-platform.test.ts:114`、`tests/composition/R5c-workflow-platform.test.ts:100`、`tests/composition/S8A-L8-pass-capture.test.ts:95`、`tests/state/invariants.test.ts:120`。
- 共享 runtime：`tests/helpers/C2-runtime-platform-fixture.ts:139`、`tests/helpers/RL-query-fixture.ts:78`、`tests/helpers/S1-runtime-scenario-fixture.ts:184`、`tests/helpers/S2B-be1-platform-fixture.ts:246`、`tests/helpers/WP2-platform-support.ts:355`、`tests/helpers/WP2-platform-support.ts:372`、`tests/helpers/WP2-platform-support.ts:731`、`tests/helpers/WP2-platform-support.ts:747`。
- 其他场景 resolver：`tests/scenarios/support/gate.ts:177`、`tests/scenarios/support/plan.ts:263`、`tests/scenarios/support/plan.ts:534`、`tests/scenarios/support/rework.ts:158`、`tests/scenarios/support/S3-host.ts:123`、`tests/scenarios/support/S3-host.ts:141`。
- 局部 Query／runtime：`tests/runtime/K-readonly-command.test.ts:268`、`tests/runtime/R5b-query-session-loop.test.ts:142`、`tests/runtime/R5b-query-session-loop.test.ts:298`、`tests/runtime/S3-graph-tools.test.ts:901`、`tests/runtime/S4C-note-run-task-resolver.test.ts:155`、`tests/runtime/source-binding-migration.test.ts:299`、`tests/work-graph/R5b-initial-plan.test.ts:199`、`tests/work-graph/R5b-query-execution.test.ts:120`、`tests/app/S4C2-scribe-reminders.test.ts:419`。

规模批必须单独看：日常配置排除 `*.scale.test.ts`，规模配置单独包含它们，见 `package.json:13`、`vitest.config.ts:6`、`vitest.scale.config.ts:5`。

| 规模文件 | 是否走本次检查 |
|---|---|
| `tests/runtime/B2-401-world.scale.test.ts:48` | **会。** 经真实运行 harness 的 `prepareAndStart`，见 `tests/helpers/B2-401-world.ts:329`。准备和启动均使用 K3-35 配置，见 `tests/helpers/K3-35-prepare.ts:75`、`tests/helpers/K3-35-runtime.ts:190`。 |
| `tests/work-graph/unknown-call-review-list.scale.test.ts:143` | **会。** 同一真实运行 harness；`blockedRecord` 也走它，见 `tests/helpers/B2-crr-world.ts:138`、`tests/helpers/B2-crr-world.ts:152`。 |
| `tests/work-graph/WP2-context-extensions.scale.test.ts:141` | **会。** `realRuntime: true` 进入 S2B runtime steps；见 `tests/helpers/S5-decision-fixture.ts:970`、`tests/helpers/S5-decision-fixture.ts:983`。L-04 已使两端模型一致，见 `tests/helpers/S2B-runtime-steps-fixture.ts:405`。 |
| `tests/app/S2A-decision-routes.scale.test.ts:52`；`tests/work-graph/S2A-notices-attempt.scale.test.ts:20`；`tests/work-graph/S2A-notices-overbound.scale.test.ts:25`；`tests/work-graph/S2A-queue-bounds.scale.test.ts:26`；`tests/work-graph/S2A-queue-derived-cards.scale.test.ts:20`；`tests/work-graph/S2A-queue-request-candidates.scale.test.ts:31`；`tests/work-graph/S5R2-queue-history.scale.test.ts:23` | **这些入口不走。** 使用默认非真实 runtime 的 S5 fixture，默认值及 owner 层进入过程见 `tests/helpers/S5-decision-fixture.ts:515`、`tests/helpers/S5-decision-fixture.ts:891`；notices 包装见 `tests/helpers/S2A-notices-support.ts:44`。 |
| `tests/work-graph/S2C-lines-scale.scale.test.ts:38` | **不走。** 规模 fixture 直接调用 entry owner 的 authorize／begin，见 `tests/helpers/S2C-X-scale-fixture.ts:196`、`tests/helpers/S2C-X-scale-fixture.ts:201`。 |
| `tests/work-graph/WP2-undelivered-notices.scale.test.ts:17` | **不走。** fixture 直接 authorize／begin，见 `tests/helpers/WP2-notices-fixture.ts:155`、`tests/helpers/WP2-notices-fixture.ts:156`。 |

所以，静态追踪结果是：规模批有三条入口会触及检查，但没有发现它们存在本次 **H 身份 → AG2b 回退身份**的错配；这里没有声称规模批已重新执行通过。

**5. 改法 2 的代价**

恢复早退，会让无 `selection` 的启动绑定跳过**全部五项**比较，而不仅是容忍旧 fixture 的 modelId。准备时的回退规则本身不需要删除；问题是启动不再用同一规则核对。当前严格比较及回退分别见 `src/core/agent-runtime/execution-driver.ts:113`、`src/core/agent-runtime/query-execution.ts:92`、`src/contracts/prompts/prompt-set.ts:111`。

它会留下三件事：

1. **S-01 与 J-09 重新打开。** 冻结表要求始终比较五项，J-09 明确归入 S-01；见 `.lead-ref/books/pc1b-findings.md:37`、`.lead-ref/books/pc1b-findings.md:82`。删掉新增测试只是移除证据；该测试有意更换 revision、provider、model，正确结果就是 `forbidden` 和零模型调用，见 `tests/runtime/PC-send-start-check.test.ts:184`、`tests/runtime/PC-send-start-check.test.ts:192`。
2. **保留一个标准 Host 不使用的豁免分支。** 标准工厂始终填 selection；但程序化注入仍可触达，所以不宜称为被实现边界保证的“纯测试分支”。见 `src/app/runtime-configuration.ts:474`、`src/app/host.ts:444`、`src/core/agent-runtime/source-tool-ports.ts:25`。
3. **PC-2 继承分叉的启动契约和尚未修好的跨 Host 夹具。** PC-2 接入磁盘 prompt source 时，标准 Host 的选择继续受检查，无 selection 的注入模型却可绕过；届时仍要处理这批夹具身份一致性。PC-2 的 source 替换边界见 `.lead-ref/books/pc1-book.md:281`、`.lead-ref/books/pc1-book.md:538`；统一启动规则见 `.lead-ref/books/pc1-book.md:383`、`.lead-ref/books/pc1-book.md:387`。

这不等于当前标准 Host 会突然绕过检查；它的 selection 仍在。代价是接受一个与冻结规则不一致、而且生产注入接口没有封死的例外，见 `src/app/runtime-configuration.ts:474`、`src/app/host.ts:140`。

**6. 推荐**

选改法 1。现有证据支持把范围限定为两个 Host 替身入口及它们的底层可选参数：共同错误只有模型身份表达不一致，业务测试没有表达模型切换；而严格检查正是冻结 S-01 要求。依据分别是 `tests/scenarios/harness.ts:774`、`tests/scenarios/harness.ts:791`、`src/app/runtime-configuration.ts:474`、`.lead-ref/books/pc1b-findings.md:37`。

不建议用“无 selection 时只比 provider/model”作为改法 3：它仍漏掉冻结规则要求的 modelId、promptPack、reasoningReplay，不能关闭 J-09。见 `.lead-ref/books/pc1-book.md:383`、`.lead-ref/books/pc1b-findings.md:82`。

结论：改法 1（helper 3 个，测试文件 0 个）