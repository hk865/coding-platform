任务 A：**OK，未发现新增必须修复项。**

- **F1**：窗口的显式取消和 signal 均保留，经 `reviewSessionBasis` 传到 prepare。[context-assembler.ts:1138](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1138)、[context-assembler.ts:1244](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1244)、[context-assembler.ts:1413](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1413)。
- **F2**：根解析的显式取消、正文及文件读取后的 signal 都会终止接续准备。[context-assembler.ts:1087](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1087)、[context-assembler.ts:1117](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1117)、[context-assembler.ts:1640](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1640)。
- **F3**：根解析取消会传播；根解析和基线读取后的 signal 检查都位于 baseline put 前。[execution-preparation.ts:156](D:/cxt/k3-merge-review/src/core/agent-runtime/execution-preparation.ts:156)、[execution-preparation.ts:174](D:/cxt/k3-merge-review/src/core/agent-runtime/execution-preparation.ts:174)、[execution-preparation.ts:511](D:/cxt/k3-merge-review/src/core/agent-runtime/execution-preparation.ts:511)。

指定区间内，其余 K3 读取未发现把**受支持的显式取消**降成事实或 `null`：命令窗口、审阅记录、原 Run 和请求分页均保留取消码。正文和文件字节端口本身没有取消结果，按 signal 判断，符合 §13.8。[context-assembler.ts:1292](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1292)、[context-assembler.ts:1400](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1400)、[context-assembler.ts:1530](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1530)、[ports.ts:28](D:/cxt/k3-merge-review/src/core/record-store/ports.ts:28)、[continuation-diff-reads.ts:24](D:/cxt/k3-merge-review/src/core/workspace/continuation-diff-reads.ts:24)。

调用序号按代码计数，计数窗口仅覆盖被测 prepare：

| 行 | 精确命中位置及计数依据 | 指定变异必须失败的断言 |
|---|---|---|
| T1 | 第 **1** 次 `withStore`：先 session-basis，再 command-facts；每个窗口的 header/page 读取位于同一次 `withStore` 内。正常预检断言共两次。[context-assembler.ts:1413](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1413)、[session-operations.ts:918](D:/cxt/k3-merge-review/src/core/agent-runtime/session-operations.ts:918) | **M-F1** 删除 `:1144` 的取消分支，只保留非 ready → undefined；新文件 **:141** 的 cancelled 断言失败。 |
| T2 | 第 **2** 次 `resolveRoot`：第一次是 workspace facts，第二次是 review files；空写范围排除后续 baseline root。[context-assembler.ts:1616](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1616)、[context-assembler.ts:1640](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:1640) | **M-F2** 删除 `:1089` 的显式取消分支；新文件 **:189** 的 cancelled 断言失败。 |
| T3 | 第 **1** 次 `resolveRoot`：普通首次 Work prepare，没有接续读取，非空写范围进入基线。[execution-preparation.ts:509](D:/cxt/k3-merge-review/src/core/agent-runtime/execution-preparation.ts:509) | **M-F3** 删除 `:158` 的显式取消分支；新文件 **:233** 的 cancelled 断言失败。 |
| T3b | 同 T3；真实 root 返回前 abort，仍返回真实 ready。 | **M-F3b** 同时删除 `:159`、`:174` 的 signal 检查；新文件 **:234** 的 baseline put＝0 断言失败，实际会计到 1。 |

任务 B 补丁如下。四行均覆盖 memory、SQLite；沿用默认 30 秒超时。未写文件、未运行命令、测试或变异；下述失败位置是待 lead 在 WSL 验证的预期。

```diff
diff --git a/tests/runtime/K3-merge-cancel-propagation.test.ts b/tests/runtime/K3-merge-cancel-propagation.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/runtime/K3-merge-cancel-propagation.test.ts
@@ -0,0 +1,238 @@
+/**
+ * Slice 8 §13.8 / K3 merge M1: cancellation through PUBLIC prepare.
+ * Prior facts come from the shared public Run/review/requeue harness.
+ * Faults/counts wrap real dependencies; the existing §5.1 tool seams only
+ * hold the original Run in flight. No database reads or constructed facts.
+ * Counters cover the faulting prepare only, after any ready control.
+ */
+import { afterEach, describe, expect, it, vi } from 'vitest';
+import { StoreError, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
+import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
+import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
+import { createContextAssembler } from '../../src/core/agent-runtime/context-assembler.js';
+import {
+  createExecutionPreparation, loadPreparedManifest,
+  PREPARED_MANIFEST_CONTENT_TYPE, WORKSPACE_BASELINE_CONTENT_TYPE,
+} from '../../src/core/agent-runtime/execution-preparation.js';
+import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
+import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
+import {
+  readContinuationBaselineBlob, readContinuationCurrentFile,
+} from '../../src/core/workspace/continuation-diff-reads.js';
+import { openK3ReviewCardWorld, createK3PendingReview } from '../helpers/K3-proposal-round.js';
+import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
+import { createK3_35Runtime } from '../helpers/K3-35-runtime.js';
+import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
+import { mixedEditSeam } from '../helpers/K3-mixed-seams.js';
+import { shellSeam } from '../helpers/K3-tool-seams.js';
+import { GOAL_B, PLAN_B2 } from '../helpers/S5-decision-fixture.js';
+
+const seams = vi.hoisted(() => ({
+  shell: undefined as unknown as typeof shellSeam,
+  edit: undefined as unknown as typeof mixedEditSeam,
+}));
+vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
+  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
+  return { ...actual, createShellToolDefinition:
+    (sandbox: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
+      seams.shell.definition(actual.createShellToolDefinition, sandbox) };
+});
+vi.mock('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js', async (importOriginal) => {
+  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js')>();
+  return { ...actual, createEditToolDefinition:
+    (workspace: Parameters<typeof actual.createEditToolDefinition>[0]): ToolDefinition =>
+      seams.edit.definition(actual.createEditToolDefinition as never, workspace as never) };
+});
+seams.shell = shellSeam;
+seams.edit = mixedEditSeam;
+
+type World = Awaited<ReturnType<typeof openK3ReviewCardWorld>>;
+type Harness = Awaited<ReturnType<typeof openRealRunHarness>>;
+const cleanup: Array<() => Promise<void>> = [];
+afterEach(async () => {
+  shellSeam.release();
+  mixedEditSeam.release();
+  for (const close of cleanup.splice(0).reverse()) await close();
+});
+
+async function open(kind: 'memory' | 'sqlite') {
+  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
+  cleanup.push(() => world.close());
+  const harness = await openRealRunHarness(world, { gitWorkspace: true });
+  cleanup.push(() => harness.closeUnion());
+  return { world, harness };
+}
+
+function preparationFor(world: World, harness: Harness, claim: TaskClaim, writeScope: readonly string[]) {
+  const executions = createRunStateReader({ records: world.records });
+  const { deps: real } = createK3_35Runtime(world, {
+    model: createScriptedModel([{ kind: 'text', text: 'unused by prepare' }]),
+    tools: ['read'], writeScope, now: harness.now, eventId: harness.eventId,
+    newId: harness.newId, kernelStores: harness.kernelStores,
+    workspaceRevision: async () => {
+      const read = await executions.readExecution(world.fixture.ctx, claim.runRef);
+      if (read.status !== 'ready') throw new Error('the claimed Run must be readable');
+      return read.value.run.workspaceSnapshot.revision;
+    },
+  });
+  const readTaskClosure = real.readTaskClosure;
+  if (readTaskClosure === undefined) throw new Error('the real closure reader is missing');
+  const source = new VerificationWorkspaceReader();
+  const puts = { manifest: 0, baseline: 0 };
+  const deps = {
+    ...real, readTaskClosure,
+    bodies: {
+      read: real.bodies.read.bind(real.bodies),
+      async put(input: Parameters<typeof real.bodies.put>[0]) {
+        if (input.contentType === PREPARED_MANIFEST_CONTENT_TYPE) puts.manifest += 1;
+        if (input.contentType === WORKSPACE_BASELINE_CONTENT_TYPE) puts.baseline += 1;
+        return real.bodies.put(input);
+      },
+    },
+    workspaceSource: {
+      captureDigest: (root: string) => source.captureDigest(root),
+      capture: (root: string) => source.capture(root),
+      readBaselineBlob: readContinuationBaselineBlob,
+      readCurrentFile: readContinuationCurrentFile,
+    },
+  };
+  return { deps, puts, prepare(ctx: CoreCallContext) {
+    return createExecutionPreparation(deps, createContextAssembler(deps)).prepare(ctx,
+      { runRef: claim.runRef, requestId: 'k3-merge-cancel-prepare' });
+  } };
+}
+
+describe.each(['memory', 'sqlite'] as const)('K3 merge cancellation (%s)', kind => {
+  it('T1 / M-F1: only the review session-basis window answers cancelled', async () => {
+    const { world, harness } = await open(kind);
+    const review = await createK3PendingReview(world);
+    const session = await world.fixture.createS5Session('merge-review-session');
+    const claim = await world.fixture.claimRun({ requestId: 'merge-review-claim',
+      goalRef: GOAL_B, planRef: PLAN_B2, taskId: review.task.taskId, sessionRef: session,
+      review: { reviewRef: review.ref, expectedRevision: review.revision, phase: 'review' } });
+    const p = preparationFor(world, harness, claim, []);
+    const controller = new AbortController();
+    const ctx = { ...world.fixture.ctx, signal: controller.signal };
+    const realStores = p.deps.kernelStores;
+    let storeUses = 0;
+    let cancelFirst = false;
+    p.deps.kernelStores = { ...realStores, async withStore(adapterId, use) {
+      storeUses += 1;
+      // #1: lastTerminalBoundary; #2: reviewCommandFacts. Each window uses
+      // withStore once (its header/page reads are INSIDE that callback).
+      if (cancelFirst && storeUses === 1) throw new StoreError('cancelled', 'T1 window cancelled');
+      return realStores.withStore(adapterId, use);
+    } };
+    const control = await p.prepare(ctx);
+    if (control.status !== 'ready') throw new Error(JSON.stringify(control));
+    expect(await loadPreparedManifest(world.fixture.bodies, control.value)).toMatchObject({
+      status: 'ready', value: { manifest: { sessionBasis: {
+        sourceKernelSessionId: expect.any(String), throughPosition: null,
+      } } },
+    });
+    expect(storeUses).toBe(2);
+    storeUses = 0;
+    p.puts.manifest = 0;
+    cancelFirst = true;
+    expect(ctx.signal.aborted).toBe(false);
+    const result = await p.prepare(ctx);
+    expect(ctx.signal.aborted).toBe(false);
+    // M-F1 must fail HERE: the real later command window stays ready.
+    expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
+    expect(p.puts.manifest).toBe(0);
+    expect(storeUses).toBe(1);
+  });
+
+  it('T2 / M-F2: only the continuation review-file root answers cancelled', async () => {
+    const { world, harness } = await open(kind);
+    const session = await world.fixture.createS5Session('merge-edit-session');
+    const original = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2,
+      taskId: 'k3-20-a', requestId: 'merge-edit-claim' });
+    mixedEditSeam.arm();
+    const running = await harness.prepareAndStart(original, {
+      model: createScriptedModel([{ kind: 'calls', calls: [{ callId: 'merge-edit', name: 'edit',
+        args: { mode: 'replace', path: 'src/module.ts',
+          oldText: 'SCENARIO_GIT_BASELINE', newText: 'MERGE_EDIT' } }] }]),
+      tools: ['write'], writeScope: ['.'], blockOnShell: false,
+    });
+    try {
+      await Promise.race([mixedEditSeam.waitForCall(), running.started.then(result => {
+        throw new Error('the Run ended before its edit: ' + JSON.stringify(result));
+      })]);
+      const review = await harness.createRecord(original);
+      expect(review).toMatchObject({ status: 'resolved', items: [
+        { kind: 'file_edit', summary: { paths: ['src/module.ts'] } },
+      ] });
+    } finally {
+      mixedEditSeam.release();
+      await running.started;
+    }
+    const requeue = await harness.requeue(original, 'compare the interrupted edit');
+    const nextSession = await world.fixture.createS5Session('merge-continuation-session');
+    const claim = await harness.claimRun({ sessionRef: nextSession, planRef: PLAN_B2,
+      taskId: original.task.taskId, requeueRef: requeue.ref, requestId: 'merge-continuation-claim' });
+    const p = preparationFor(world, harness, claim, []);
+    const realHost = p.deps.workspaceHost;
+    let roots = 0;
+    p.deps.workspaceHost = { ...realHost, async resolveRoot(ref) {
+      roots += 1;
+      // #1 is briefWorkspaceFactsFor; #2 is unknownCallReviewFilesFor.
+      if (roots === 2) return { status: 'rejected', code: 'cancelled', reason: 'T2 review-file root cancelled' };
+      return realHost.resolveRoot(ref);
+    } };
+    const controller = new AbortController();
+    const ctx = { ...world.fixture.ctx, signal: controller.signal };
+    expect(ctx.signal.aborted).toBe(false);
+    const result = await p.prepare(ctx);
+    expect(ctx.signal.aborted).toBe(false);
+    // M-F2 must fail HERE: [] writeScope excludes a later baseline root.
+    expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
+    expect(p.puts.manifest).toBe(0);
+    expect(roots).toBe(2);
+  });
+
+  it.each([
+    { row: 'T3', mutation: 'M-F3', abort: false },
+    { row: 'T3b', mutation: 'M-F3b', abort: true },
+  ])('$row / $mutation: baseline cancellation stores neither baseline nor manifest', async ({ row, abort }) => {
+    const { world, harness } = await open(kind);
+    const session = await world.fixture.createS5Session('merge-baseline-session');
+    const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2,
+      taskId: 'k3-20-a', requestId: 'merge-baseline-claim' });
+    const p = preparationFor(world, harness, claim, ['.']);
+    // Prove the real git baseline is capturable; prepare alone binds no Run.
+    const control = await p.prepare(world.fixture.ctx);
+    if (control.status !== 'ready') throw new Error(JSON.stringify(control));
+    expect(await loadPreparedManifest(world.fixture.bodies, control.value)).toMatchObject({
+      status: 'ready', value: { manifest: {
+        permissions: { writeScope: ['.'] }, workspaceBaseline: { status: 'captured' },
+      } },
+    });
+    expect(p.puts).toEqual({ manifest: 1, baseline: 1 });
+    p.puts.manifest = 0;
+    p.puts.baseline = 0;
+    const controller = new AbortController();
+    const ctx = { ...world.fixture.ctx, signal: controller.signal };
+    const realHost = p.deps.workspaceHost;
+    let roots = 0;
+    p.deps.workspaceHost = { ...realHost, async resolveRoot(ref) {
+      const result = await realHost.resolveRoot(ref);
+      // Fresh Work Run: no continuation/review-file roots; baseline is #1.
+      if (++roots !== 1) return result;
+      expect(result.status).toBe('ready');
+      expect(ctx.signal.aborted).toBe(false);
+      if (!abort) return { status: 'rejected', code: 'cancelled', reason: 'T3 baseline root cancelled' };
+      controller.abort();
+      return result;
+    } };
+    expect(ctx.signal.aborted).toBe(false);
+    const result = await p.prepare(ctx);
+    expect(ctx.signal.aborted).toBe(abort);
+    // M-F3 fails the result assertion; M-F3b reaches the later manifest guard
+    // and fails the baseline-put assertion (one body was already written).
+    expect(result, row).toMatchObject({ status: 'rejected', code: 'cancelled' });
+    expect(p.puts.baseline, row).toBe(0);
+    expect(p.puts.manifest, row).toBe(0);
+    expect(roots).toBe(1);
+  });
+});
```

任务 A 必须修复数：**0**。  
测试行／变异：**T1 → M-F1；T2 → M-F2；T3 → M-F3；T3b → M-F3b**。