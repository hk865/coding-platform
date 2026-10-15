/**
 * Slice 2B BE1r shared runtime test tools (lead decision P6).
 *
 * These three items are copied UNCHANGED IN BEHAVIOUR from the test files that
 * define them. The originals are not exported and those files may not change,
 * so BE1r reuses the copies here. "Do not build new versions" means: the same
 * behaviour, no redesign.
 *
 *   - `blockingTool`  — `tests/runtime/A2-reconcile-runtime.test.ts` (line 128)
 *   - `restartedHost` — `tests/runtime/A2-reconcile-runtime.test.ts` (line 91),
 *     together with its private `read` helper (line 107)
 *   - `controlledTool` — `tests/runtime/R4-control-runtime.test.ts` (line 92)
 *
 * The task book named the tool files in the other order; the real definitions
 * live where the comments above say, so each copy names its actual original.
 */
import {
  reconcileRunAtStartup, type RunReconcileClassifierDependencies,
} from '../../src/core/agent-runtime/run-reconcile.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { HostInstanceFacts } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import { B2_AT, type B2RuntimeFixture } from './B2-runtime-fixture.js';
import {
  toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult,
} from '../../vendor/coding-agent/dist/public-api.js';

/**
 * A controlled Kernel tool (copied from `tests/runtime/A2-reconcile-runtime.test.ts:128`,
 * where it is described as "as `R4-control-runtime.test.ts`"): it only decides
 * WHEN a call settles.
 */
export function blockingTool(name: string, entered: () => void, release: Promise<void>): ToolDefinition {
  return {
    name, description: 'A.2 step 5.6 controlled runtime tool', inputSchema: z.object({}).loose(), effectClass: 'read_only',
    requiredCapabilities: ['workspace_read'], defaultTimeoutMs: 60_000, outputLimitBytes: 1_024, independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: async (call: Readonly<ToolCall>): Promise<ToolResult> => {
      entered();
      await release;
      return { schemaVersion: 1, callId: call.callId, status: 'success', output: [{ kind: 'text', text: 'the late tool result' }],
        effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
    } },
  };
}

/**
 * Test-only controlled Kernel tool (copied from
 * `tests/runtime/R4-control-runtime.test.ts:92`); it only controls WHEN a call settles.
 */
export function controlledTool(
  name: string,
  run: (call: Readonly<ToolCall>, signal: AbortSignal) => Promise<ToolResult>,
): ToolDefinition {
  return {
    name,
    description: 'R4.3a controlled runtime tool',
    inputSchema: z.object({}).loose(),
    effectClass: 'read_only',
    requiredCapabilities: ['workspace_read'],
    defaultTimeoutMs: 60_000,
    outputLimitBytes: 1_024,
    independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: (call, options) => run(call, options.signal) },
  };
}

/** Copied from `tests/runtime/A2-reconcile-runtime.test.ts:107` (private helper of `restartedHost`). */
async function read(fx: B2RuntimeFixture, deps: RuntimeExecutionDependencies = fx.deps) {
  const record = await deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  if (record.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(record)}`);
  return record.value;
}

/**
 * A restarted Host (copied from `tests/runtime/A2-reconcile-runtime.test.ts:91`):
 * fresh owners over the same stores under `host`, and the start-up classifier's
 * dependencies.
 */
export function restartedHost(fx: B2RuntimeFixture, host: HostInstanceFacts, controls: RunControlPort) {
  const deps = fx.rebuildDeps({ hostInstance: host, runReconcile: true });
  let seq = 0;
  const classifier: RunReconcileClassifierDependencies = {
    owner: createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores }), controls,
    entry: deps.entry, reconcile: deps.runReconcile!, now: () => B2_AT, newId: () => `a2-runtime-reconcile-${host.hostInstanceId}-${++seq}`,
  };
  const reconcile = async () => {
    const record = await read(fx, deps);
    const probe = await classifier.owner.probe({ session: record.session, signal: fx.ctx.signal });
    return reconcileRunAtStartup(classifier, fx.ctx, { record, hostInstanceId: host.hostInstanceId, probe });
  };
  return { deps, classifier, reconcile };
}
