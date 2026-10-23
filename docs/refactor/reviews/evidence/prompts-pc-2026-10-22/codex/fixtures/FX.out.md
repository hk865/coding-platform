四份补丁按 **J-04 → J-06 → J-08 → J-09** 顺序应用；正文引用的行号均指原树。基线清单首项为 `af84802`（`.lead-ref/commits.txt:1`）。本次仅静态核对，未修改文件、运行测试或构建、执行 git 写操作或联网。

## J-04

```diff
diff --git a/tests/helpers/PC2-pack-fixture.ts b/tests/helpers/PC2-pack-fixture.ts
--- a/tests/helpers/PC2-pack-fixture.ts
+++ b/tests/helpers/PC2-pack-fixture.ts
@@ -9,6 +9,7 @@
 import { lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
 import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
 import { vi } from 'vitest';
+import * as workflowModule from '../../src/business/workflow/workflow.js';
 import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
 import type {
   PreparedQueryExecution, PreparedQueryManifestV1, PreparedTaskManifestV1,
@@ -381,18 +382,27 @@
 
 /** Completed Work -> real inquiry derivation; also a standalone Query on the source Session. */
 export async function openPC2QueryHistoryFixture(options: PCOptions = {}) {
-  const fixture = await openPCWorkFixture({
-    ...options,
-    model: options.model ?? scriptedModel([
-      { text: 'PC2 completed history.' }, { text: 'PC2 derived answer.' }, { text: 'PC2 reused answer.' },
-    ]),
+  const createWorkflow = workflowModule.createWorkflow;
+  let workflowRuntime: Parameters<typeof createWorkflow>[0]['runtime'] | undefined;
+  const factorySpy = vi.spyOn(workflowModule, 'createWorkflow').mockImplementation(deps => {
+    workflowRuntime = deps.runtime;
+    return createWorkflow(deps);
   });
+  let fixture: Awaited<ReturnType<typeof openPCWorkFixture>>;
   try {
+    fixture = await openPCWorkFixture({
+      ...options,
+      model: options.model ?? scriptedModel([
+        { text: 'PC2 completed history.' }, { text: 'PC2 derived answer.' }, { text: 'PC2 reused answer.' },
+      ]),
+    });
+  } finally { factorySpy.mockRestore(); }
+  try {
     const { base, runtime } = fixture;
     const platform = base.platform;
     await fixture.work.prepare();
     ready(await fixture.work.start());
-    if (!runtime.readCompletedBoundary || !runtime.startQuery || !runtime.prepareQuery) {
+    if (!runtime.readCompletedBoundary || !workflowRuntime?.startQuery || !runtime.prepareQuery) {
       throw new Error('The Runtime has no public Query/history port');
     }
     const boundary = ready(await runtime.readCompletedBoundary(base.ctx, { sessionRef: base.sessionRef }));
@@ -408,11 +418,11 @@
       contextWindowTokens: 200_000, inputTokens: null, outputTokens: null,
       maxRequests: 8, maxToolCalls: 8, timeoutMs: 30_000, perResponseTokens: 512,
     };
-    const actualStart = runtime.startQuery.bind(runtime);
+    const actualStart = workflowRuntime.startQuery.bind(workflowRuntime);
     type StartArgs = Parameters<typeof actualStart>;
     const captured: StartArgs[] = [];
-    // Workflow uses this raw public Runtime port, not the composition wrapper.
-    const spy = vi.spyOn(runtime, 'startQuery').mockImplementation(async (ctx, request) => {
+    // Capture on the exact port passed to Workflow, including composition's copy.
+    const spy = vi.spyOn(workflowRuntime, 'startQuery').mockImplementation(async (ctx, request) => {
       captured.push([ctx, structuredClone(request)]);
       return { status: 'rejected', code: 'busy', reason: 'PC2 captured before Query start' };
     });
```

**调用者。** 搜索整个 `tests/`，目前该函数只有定义，没有调用者（`tests/helpers/PC2-pack-fixture.ts:383`）。补丁保持参数、返回接口和既有捕获后返回 `busy` 的方式，只更正捕获对象：composition 先展开复制 Runtime，再把副本交给 Workflow（`src/composition/create-platform.ts:1511`、`src/composition/create-platform.ts:1774`；原捕获及返回接口见 `tests/helpers/PC2-pack-fixture.ts:415`、`tests/helpers/PC2-pack-fixture.ts:474`）。

**解锁及返工步骤。** 解锁 J-04：打开夹具，检查派生 Query 的正式 `sessionBasis` 和原 Session 普通 Query 的历史判定，分别启动 `derived`、`reused`；对冻结 manifest、角色段末尾提醒及模型请求中的源历史作字面量断言。现有夹具已经完成真实 Work、询问消息、普通 Query 提交和领取，这些步骤无需替换（`tests/helpers/PC2-pack-fixture.ts:393`、`tests/helpers/PC2-pack-fixture.ts:400`、`tests/helpers/PC2-pack-fixture.ts:447`、`tests/helpers/PC2-pack-fixture.ts:456`；要求见 `.lead-ref/books/pc2-book.md:842`）。

**风险。** 工厂 spy 有模块级影响，构造仍须串行；补丁在构造成功或失败时都恢复工厂，原有 `startQuery` spy 的恢复继续保留。串行要求已有明确约束（`tests/helpers/PC-platform-fixture.ts:11`；原查询 spy 清理见 `tests/helpers/PC2-pack-fixture.ts:426`）。

## J-06

```diff
diff --git a/tests/helpers/PC-platform-fixture.ts b/tests/helpers/PC-platform-fixture.ts
--- a/tests/helpers/PC-platform-fixture.ts
+++ b/tests/helpers/PC-platform-fixture.ts
@@ -39,12 +39,13 @@
 import { readPromptTexts } from '../../src/core/agent-runtime/prompt-set-texts.js';
 import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
 import { ScriptedProvider, type ScriptedStep } from './PC-kernel-fixture.js';
-import { B2_AT } from './B2-runtime-fixture.js';
+import { B2_AT, createScriptedModel } from './B2-runtime-fixture.js';
 import { createWP2Platform, claimSuccessorRun } from './WP2-platform-support.js';
 import { createRLQueryFixture, rlQueryHostCtx } from './RL-query-fixture.js';
 import { openK3ReviewCardWorld, createK3PendingReview, k3RequestId } from './K3-proposal-round.js';
 import { openRealRunHarness } from './K3-35-continuation-fixture.js';
 import { createK3_35Runtime } from './K3-35-runtime.js';
+import { shellSeam } from './K3-tool-seams.js';
 import { GOAL_B, PLAN_B2 } from './S5-decision-fixture.js';
 
 export type PCReply = ScriptedStep;
@@ -551,23 +552,66 @@
  * The pending review is produced by RUN-20/RUN-22 over a real blocked Kernel
  * call; the new review round is claimed publicly and prepared separately.
  */
-export async function openPCK3ReviewFixture(options: PCOptions = {}) {
+export async function openPCK3ReviewFixture(
+  options: PCOptions & { sourceHistory?: 'empty' | 'completed_turn' } = {},
+) {
   const p = await parts(options);
   const world = await openK3ReviewCardWorld('memory', { realKernelCommandFacts: true })
     .catch(async error => { await p.skill.close(); throw error; });
   let harness: Awaited<ReturnType<typeof openRealRunHarness>> | undefined;
   let live: ReturnType<typeof runtimeModule.createAgentRuntime> | undefined;
   try {
-    const review = await createK3PendingReview(world, {
-      label: 'pc-pending-review', command: 'printf PC', callId: 'pc-pending-call',
-    });
+    let review: Awaited<ReturnType<typeof createK3PendingReview>>;
+    if (options.sourceHistory === 'completed_turn') {
+      harness = await openRealRunHarness(world);
+      const sourceSession = await world.fixture.createRealS5Session('pc-history-source');
+      const taskId = world.tasks[0]!;
+      const first = await harness.claimRun({
+        sessionRef: sourceSession, planRef: PLAN_B2, taskId,
+        requestId: k3RequestId(world, 'pc-history-claim'),
+      });
+      const completed = await harness.prepareAndStart(first, {
+        model: createScriptedModel([{ kind: 'text', text: 'PC completed source history.' }]),
+        tools: ['read'], writeScope: [], blockOnShell: false,
+      });
+      const ended = ready(await completed.started);
+      if (ended.run.status !== 'ended' || ended.run.outcome !== 'completed') {
+        throw new Error('PC: the source history turn did not complete');
+      }
+      const requeue = await harness.requeue(first, 'Create the PC blocked source Run');
+      const blocked = await harness.claimRun({
+        sessionRef: sourceSession, planRef: PLAN_B2, taskId, requeueRef: requeue.ref,
+        requestId: k3RequestId(world, 'pc-pending-claim'),
+      });
+      let running: Awaited<ReturnType<typeof harness.prepareAndStart>> | undefined;
+      try {
+        running = await harness.prepareAndStart(blocked, {
+          model: createScriptedModel([{ kind: 'calls', calls: [{
+            callId: 'pc-pending-call', name: 'shell', args: { command: 'printf PC' },
+          }] }]),
+          tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
+        });
+        await harness.createRecord(blocked);
+      } finally {
+        shellSeam.release();
+        await running?.started.catch(() => undefined);
+      }
+      review = ready(await world.reviews.readReview(world.fixture.ctx, { runRef: blocked.runRef }));
+      if (review.status !== 'pending_review' || review.items.length !== 1) {
+        throw new Error('PC: the blocked Run did not leave one pending review item');
+      }
+    } else {
+      review = await createK3PendingReview(world, {
+        label: 'pc-pending-review', command: 'printf PC', callId: 'pc-pending-call',
+      });
+    }
     const sessionRef = await world.fixture.createRealS5Session('pc-review-session');
     const claim = await world.fixture.claimRun({
       requestId: k3RequestId(world, 'pc-review-claim'),
       goalRef: GOAL_B, planRef: PLAN_B2, taskId: review.task.taskId, sessionRef,
       review: { reviewRef: review.ref, expectedRevision: review.revision, phase: 'review' },
     });
-    harness = await openRealRunHarness(world);
+    harness ??= await openRealRunHarness(world);
     let deps!: RuntimeExecutionDependencies;
     const opened = await injected(async () => createK3_35Runtime(world, {
       model: p.model, tools: ['read', 'run_readonly_command'], writeScope: [],
```

**调用者。** 四个直接调用点均未传新选项，继续走原来的空历史分支：

- `openPC2ReviewFixture`：`tests/helpers/PC2-pack-fixture.ts:352`。
- `tests/runtime/PC-joint-prepare-freeze.test.ts:285`。
- `tests/runtime/PC-prepare-review-freeze.test.ts:37`。
- `tests/work-graph/PC-entry-frozen-review.test.ts:49`。

经 `openPC2ReviewFixture` 间接调用的两处也保持不变：`tests/runtime/PC2-joint-history.test.ts:129`、`tests/runtime/PC2-review-shrink.test.ts:25`；包括已有空 seed 的字面量断言（`tests/runtime/PC2-joint-history.test.ts:136`）。

**解锁及返工步骤。** 解锁 J-06：直接调用 `openPCK3ReviewFixture({ sourceHistory: 'completed_turn' })`，准备审查 Run，读取冻结 manifest，断言 `sessionBasis.throughPosition` 非空且大于零、`takesSessionHistory === true`、角色段末尾提醒恰好一次；启动后检查请求含源轮次的文本。补丁复用公开领取、准备/启动、再排队及 RUN-20/RUN-22 路径，不填写 cursor、seed 或审查事实；生产 seed 正是从源 Run 之前最后一个已结束 Turn 推导（`tests/helpers/K3-35-continuation-fixture.ts:446`、`tests/helpers/K3-35-continuation-fixture.ts:462`、`tests/helpers/K3-35-continuation-fixture.ts:710`、`tests/helpers/K3-35-continuation-fixture.ts:669`；`src/core/agent-runtime/context-history-facts.ts:185`）。

**风险。** 必须保留测试端已有的 shell 模块 mock，并在识别记录之后释放、等待阻塞执行排空；否则夹具可能挂住。补丁沿用既有处理顺序，并复用同一个 harness 的 Run ID 流，避免第二次领取重复 ID（`tests/helpers/K3-tool-seams.ts:19`、`tests/helpers/B2-crr-world.ts:157`、`tests/helpers/B2-crr-world.ts:194`、`tests/helpers/B2-crr-world.ts:37`）。无需修改其他 helper。

## J-08

```diff
diff --git a/tests/helpers/PC-platform-fixture.ts b/tests/helpers/PC-platform-fixture.ts
--- a/tests/helpers/PC-platform-fixture.ts
+++ b/tests/helpers/PC-platform-fixture.ts
@@ -65,6 +65,8 @@
 
 export type PCOptions = PCBinding & {
   promptPacks?: PromptPackSourcePort;
+  /** Work resident-context budget; omitted keeps WP2's default. */
+  contextResidentBytes?: number;
   failPutContentType?: string;
   tools?: readonly string[];
   /** Bypass registry pinning deliberately, for PC-08's changing Host. */
@@ -447,6 +449,7 @@
   try {
     const opened = await injected(() => createWP2Platform({
       kind: 'sqlite', tools: options.tools ?? ['read'],
+      ...(options.contextResidentBytes === undefined ? {} : { contextResidentBytes: options.contextResidentBytes }),
       allowSourceRead: true, allowAnyRun: true, skillIds: [],
     }), p.options);
     const base = opened.value;
```

**调用者。** 以下是 `openPCWorkFixture` 的全部现有直接调用点；同一文件后续位置以 `:行号` 简写。它们均未设置这个新选项，因此仍不向 WP2 添加该字段，生产默认值仍为 4096（`tests/helpers/PC-platform-fixture.ts:447`、`src/core/agent-runtime/context-work-recipe.ts:73`）。这份清单也适用于 J-09 对该函数的修改。

| 调用者 | 原树调用点 |
|---|---|
| AG6 装配 | `tests/app/AG6-agent-assembly.test.ts:210` |
| PC2 路由联测 | `tests/app/PC2-joint-routes-prepare.test.ts:44` |
| `frozenPromptInputs` | `tests/helpers/PC-platform-fixture.ts:616` |
| Query 历史、入口夹具 | `tests/helpers/PC2-pack-fixture.ts:384`、`:494` |
| B1 装配 | `tests/runtime/B1-kernel-assembly.test.ts:187`、`:196`、`:208` |
| 冻结提示词辅助函数 | `tests/runtime/PC-frozen-prompt.ts:26` |
| 预算移除 | `tests/runtime/PC-joint-budget-removal.test.ts:62` |
| 冻结与 pin | `tests/runtime/PC-joint-freeze-and-pin.test.ts:50`、`:108` |
| 联合准备冻结 | `tests/runtime/PC-joint-prepare-freeze.test.ts:164`、`:261` |
| 记录与失败 | `tests/runtime/PC-joint-record-and-failure.test.ts:91`、`:169` |
| 模型预算预览 | `tests/runtime/PC-model-budget-preview.test.ts:45` |
| 架构提醒 | `tests/runtime/PC-prepare-architecture-reminders.test.ts:14` |
| 提示词准备冻结 | `tests/runtime/PC-prepare-prompt-freeze.test.ts:116` |
| 提示词正文存储失败 | `tests/runtime/PC-prepare-prompt-text-put-failure.test.ts:17` |
| Work/Query 记录读取 | `tests/runtime/PC-read-record-work-query.test.ts:43` |
| 发送冻结提示词 | `tests/runtime/PC-send-frozen-prompt.test.ts:123` |
| 平台包发送 | `tests/runtime/PC-send-platform-root.test.ts:129` |
| 启动核对 | `tests/runtime/PC-send-start-check.test.ts:44`、`:107`、`:125`、`:136`、`:147`、`:176`、`:276` |
| PC2 声明准备 | `tests/runtime/PC2-declaration-prepare.test.ts:17` |
| PC2 历史联测 | `tests/runtime/PC2-joint-history.test.ts:64` |
| PC2 包联测 | `tests/runtime/PC2-joint-packs.test.ts:43`、`:83`、`:125` |
| PC2 工具联测 | `tests/runtime/PC2-joint-tools.test.ts:71`、`:95`、`:175`、`:226` |
| PC2 工具文本冻结 | `tests/runtime/PC2-tool-texts-freeze.test.ts:30`、`:82` |
| W2 Skills | `tests/runtime/W2-role-skills.test.ts:74`、`:87` |
| 冻结接续入口 | `tests/work-graph/PC-entry-frozen-continuation.test.ts:42`、`:78` |

**解锁及返工步骤。** 解锁 J-08：用 `contextResidentBytes: 0` 打开 Work 夹具，经公开步骤完成首轮、建立四段各自的非空材料，再领取同 Session 接续并真正 `prepare()`；读取冻结 manifest，核对四段全部省略、各段省略计数、`residentBytes === 0`，以及角色范围内提醒恰好一次。现有测试只直接调用渲染器；准备链的四段输入及省略逻辑已有生产入口（`tests/runtime/PC2-joint-history.test.ts:150`、`tests/helpers/PC-platform-fixture.ts:466`、`src/core/agent-runtime/context-work-recipe.ts:293`、`src/core/agent-runtime/context-rendering.ts:267`）。

**风险。** `0` 必须原样透传，不能用真假判断退回默认值；还不能把“原本没有内容”算作“被预算省略”，生产只为非空段登记省略计数（`src/core/agent-runtime/context-work-recipe.ts:73`、`src/core/agent-runtime/context-rendering.ts:271`）。WP2 已声明并透传该字段，无需重复修改该层（`tests/helpers/WP2-platform-support.ts:96`、`tests/helpers/WP2-platform-support.ts:735`）。

## J-09

```diff
diff --git a/tests/helpers/PC-platform-fixture.ts b/tests/helpers/PC-platform-fixture.ts
--- a/tests/helpers/PC-platform-fixture.ts
+++ b/tests/helpers/PC-platform-fixture.ts
@@ -69,6 +69,8 @@
   contextResidentBytes?: number;
   failPutContentType?: string;
   tools?: readonly string[];
+  /** Opt in to the whole-workspace Work grant; tools remain explicitly selected. */
+  writable?: boolean;
   /** Bypass registry pinning deliberately, for PC-08's changing Host. */
   secondSelection?: Partial<Selection>;
 };
@@ -449,6 +451,7 @@
   try {
     const opened = await injected(() => createWP2Platform({
       kind: 'sqlite', tools: options.tools ?? ['read'],
+      ...(options.writable === undefined ? {} : { writable: options.writable }),
       ...(options.contextResidentBytes === undefined ? {} : { contextResidentBytes: options.contextResidentBytes }),
       allowSourceRead: true, allowAnyRun: true, skillIds: [],
     }), p.options);
diff --git a/tests/helpers/WP2-platform-support.ts b/tests/helpers/WP2-platform-support.ts
--- a/tests/helpers/WP2-platform-support.ts
+++ b/tests/helpers/WP2-platform-support.ts
@@ -60,6 +60,8 @@
   scriptedReplies?: readonly ScriptedReply[];
   beforeReply?: (request: import('../../vendor/coding-agent/dist/public-api.js').ModelRequest,
     index: number, signal: AbortSignal) => Promise<void>;
+  /** Whole-workspace Work grant; true overrides writeScope, without adding tools. */
+  writable?: boolean;
   writeScope?: string[];
   systemInstruction?: string | null;
   skillIds?: string[];
@@ -355,7 +357,8 @@
         model: { configuration: { revision: 'wp2-host-config@1', provider: 'deepseek', model: 'wp2-local-scripted', baseUrl: 'http://127.0.0.1' },
           client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'wp2-fixture-counter' }) } },
         budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 12, maxToolCalls: 16, timeoutMs: 30000, perResponseTokens: 512 },
-        tools: [...toolNames], writeScope: [...(options.writeScope ?? [])],
+        tools: [...toolNames], writeScope: [...(options.writable === true ? ['.'] : options.writeScope ?? [])],
+        ...(options.writable === true ? { shellWorkspaceAccess: 'all_except_denied' as const } : {}),
         ...(options.contextResidentBytes === undefined ? {} : { contextResidentBytes: options.contextResidentBytes }),
         hostTemplate: request.role.kind === 'legacy_template'
           ? { templateId: request.role.templateId, revision: request.role.templateRevision, digest: sha256Hex(systemInstruction ?? '') } : null,
@@ -557,7 +560,9 @@
     schemaVersion: 1, platformDuty: duty, label: 'WP2 platform role', purpose: 'WP2_PLATFORM_DUTY_PIN',
     responsibility: ['human_decision_support'],
     requiredMaterials: [{ kind: 'contract', reason: 'Read the assigned Plan/Task' }],
-    optionalMaterials: [], permissions: { tools: [...toolNames], writeScope: 'none' },
+    optionalMaterials: [], permissions: {
+      tools: [...toolNames], writeScope: options.writable === true ? 'workspace' : 'none',
+    },
     budget: { source: 'task-budget', scope: 'assigned-task' },
     requiredOutputs: [{ kind: 'answer-with-sources', reason: 'Report the actual result' }],
     exit: { success: 'Report result', stop: 'Stop on missing permission', handoff: 'Keep references' },
@@ -731,7 +736,9 @@
         model: { configuration: { revision: 'wp2-host-config@1', provider: 'deepseek', model: 'wp2-local-scripted', baseUrl: 'http://127.0.0.1' },
           client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'wp2-fixture-counter' }) } },
         budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 12, maxToolCalls: 16, timeoutMs: 30000, perResponseTokens: 512 },
-        tools: [...toolNames], writeScope: [...(options.writeScope ?? [])], hostTemplate: null,
+        tools: [...toolNames], writeScope: [...(options.writable === true ? ['.'] : options.writeScope ?? [])],
+        ...(options.writable === true ? { shellWorkspaceAccess: 'all_except_denied' as const } : {}),
+        hostTemplate: null,
         ...(options.contextResidentBytes === undefined ? {} : { contextResidentBytes: options.contextResidentBytes }),
         skills: { resourceRoot: C2_SKILL_ROOT, enabledIds: [...(options.skillIds ?? C2_SKILL_IDS)] },
         systemInstruction,
```

**调用者。** `openPCWorkFixture` 的全部调用者见 J-08 清单。`createWP2Platform` 的全部直接调用点如下；均未传 `writable`，所以原有 Role 权限、`writeScope` 和缺省 shell 配置保持不变（`tests/helpers/WP2-platform-support.ts:560`、`tests/helpers/WP2-platform-support.ts:358`、`tests/helpers/WP2-platform-support.ts:734`）。

- `tests/helpers/PC-platform-fixture.ts:447`。
- `tests/composition/WP2-wiring.test.ts:30`。
- `tests/runtime/S3-context-assembler.test.ts:635`、`:660`、`:882`。
- `tests/runtime/S4C2-assembly.test.ts:282`。
- `tests/runtime/S5-user-message-tools.test.ts:283`。
- `tests/scenarios/WP2-wiring-scenario.test.ts:76`。
- `tests/work-graph/S4C2-goal-triggers.test.ts:355`。
- `tests/work-graph/S4C2-update-due.test.ts:141`。

同时修改的私有函数 `createWP2MemoryPlatform` 只有一个调用者：`tests/helpers/WP2-platform-support.ts:544`。它采用 legacy template，因此只同步 Host 选项；SQLite 的 Role 仍经既有安装、激活入口形成权限（`tests/helpers/WP2-platform-support.ts:404`、`tests/helpers/WP2-platform-support.ts:565`、`tests/helpers/WP2-platform-support.ts:573`）。

**解锁及返工步骤。** 解锁 J-09／T-08：调用 `openPCWorkFixture({ writable: true, tools: ['read', 'write', 'shell'], ... })`，使用现有小包、空 Skills、空 Host instruction 和纯文本脚本回复，执行 `prepare()`、`start()`，核对冻结工具列表及实际请求的系统提示字面量 `ARESZ`。权限名使用 `write`，产品会映射成 Kernel 的 `edit`；现有该组合只有纯渲染测试（`src/core/work-graph/state/unknown-call-kinds.ts:44`、`tests/runtime/PC2-joint-tools.test.ts:54`、`tests/runtime/PC2-joint-tools.test.ts:61`、`tests/runtime/PC2-joint-tools.test.ts:71`）。

**风险。** 三处授权必须一致，否则准备阶段仍会拒绝：Role 只读与 Host 写权限冲突会拒绝，shell 还要求整工作区范围及明确的 `shellWorkspaceAccess`（`src/core/agent-runtime/execution-preparation.ts:256`、`src/core/agent-runtime/execution-preparation.ts:424`）。新选项为真时明确覆盖旧 `writeScope`，但不自动增加工具；Query 的空写入范围不改（`tests/helpers/WP2-platform-support.ts:375`、`tests/helpers/WP2-platform-support.ts:750`）。`read_source` 继续只在渲染器测试，不新增产品权限或注入点（`.lead-ref/books/pc2-chk2-rulings.md:28`）。

四行均仍需要夹具修改；其中 J-08 只是 WP2 层已具备能力，缺口在 PC 选项和透传（`tests/helpers/PC-platform-fixture.ts:65`、`tests/helpers/PC-platform-fixture.ts:447`、`tests/helpers/WP2-platform-support.ts:735`）。

补丁 4 个，涉及文件 3 个