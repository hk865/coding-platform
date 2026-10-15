/**
 * Slice 2B round-2 fix R2 (review item 2) — a RUN-08 retry must re-read the Run
 * and pin its CURRENT revision, while the pending event/activity input stays
 * byte-for-byte the same.
 *
 * Fixture (all through public calls, following `R4-control-runtime.test.ts:239`
 * for the real Kernel drain and `S2B-45-inprocess-run21-activity.test.ts` for
 * the store fixture):
 * - one real Runtime drives the real Turn with a controlled tool that ignores
 *   the delivered cancel; the Kernel's own drain timeout produces the formal
 *   `tool.outcome_unknown`, so the observer prepares the RUN-08 pending end;
 * - the WorkGraph entry port is wrapped once (same seam as `B2:553`) so the
 *   first `recordRunResult` fails after the pending item is stored: the counting
 *   is now suspended with the original event id/time and activity kept;
 * - a real `pause` control submission then advances the Run revision (the
 *   queued pause writes the Run's `controlState` pointer), so the saved pin is
 *   obsolete;
 * - the next `observeRun` on the SAME Runtime must re-read the Run and commit
 *   the SAME pending input with the current revision. Before the fix it retried
 *   the obsolete pin and the end commit was rejected with a revision conflict.
 *
 * The read is asserted through the public `readRunActivities` (L10); the two
 * submitted observations are compared for an identical event id/time and input.
 */
import { afterEach, expect, it } from 'vitest';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ExecutionEntryPort, HostInstanceFacts, TaskResultObservation } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { B2_AT } from '../helpers/B2-runtime-fixture.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { controlledTool } from '../helpers/S2B-runtime-tools-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const HOST_1: HostInstanceFacts = { hostInstanceId: 's2b-r2-host-1', lease: 'owned' };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

/** Install one controlled Kernel tool through the real public seam (as A2/R4). */
function withTool(kernel: RuntimeExecutionDependencies['kernel'], tool: ToolDefinition): RuntimeExecutionDependencies['kernel'] {
  return {
    ...kernel,
    runCodingAgent: (options) => kernel.runCodingAgent({ ...options,
      config: { ...options.config, tools: { ...options.config.tools, enabledNames: [...options.config.tools.enabledNames, tool.name] } },
      additionalTools: (workspace) => [...(options.additionalTools?.(workspace) ?? []), tool] }),
  };
}

function controlsOn(fx: S2BRuntimeStoreFixture) {
  let seq = 0;
  return createRunControlService({
    records: fx.claimFixture.records,
    authority: createMaterialRecordReaders(fx.claimFixture.records).authority,
    reads: createRunStateReader({ records: fx.claimFixture.records }),
    now: () => B2_AT,
    eventId: () => `s2b-r2-control-event-${++seq}`,
  });
}

/** The real Kernel drain timeout produces the formal outcome_unknown. */
function cancelIgnoringTool(name: string, entered: () => void, release: Promise<void>): ToolDefinition {
  return controlledTool(name, async (call) => {
    entered();
    // Deliberately ignore the cancellation signal: only the Kernel's own drain
    // timeout may end this call, producing the formal outcome_unknown result.
    await release;
    return { schemaVersion: 1, callId: call.callId, status: 'success', output: [{ kind: 'text', text: 'late result after the drain' }],
      effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
  });
}

type Submission = { requestId: string; input: TaskResultObservation; expected: readonly VersionPin[]; result?: string };

it('R2: a RUN-08 retry re-reads the Run revision and commits the SAME pending input after a control write advances it', async () => {
  const toolName = 's2b-r2-ignoring-tool';
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: CONTROL_RECORD_SCHEMAS,
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-r2-unknown', name: toolName, args: {} }] },
      { kind: 'text', text: 'must not run: the drain ends the Turn' },
    ],
  });
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1 });
  const baseEntry = deps.entry;

  // Same seam as `B2-runtime-execution.test.ts:553`: the first result commit is
  // lost, so the RUN-08 pending item is stored but not committed.
  const submissions: Submission[] = [];
  const entry: ExecutionEntryPort = {
    ...baseEntry,
    recordRunResult: async (ctx, request) => {
      const submission: Submission = { requestId: request.meta.requestId,
        input: structuredClone(request.input), expected: structuredClone(request.meta.expected) };
      submissions.push(submission);
      if (submissions.length === 1) {
        submission.result = 'rejected:unavailable';
        return { status: 'rejected', code: 'unavailable', reason: 'S2B-R2: the first RUN-08 result commit is lost' };
      }
      const result = await baseEntry.recordRunResult(ctx, request);
      submission.result = result.status === 'committed' ? 'committed'
        : `${result.status}:${'code' in result ? result.code : 'unknown'}`;
      return result;
    },
  };

  const runtime = createAgentRuntime({ ...deps, controls, entry,
    kernel: withTool(deps.kernel, cancelIgnoringTool(toolName, entered.resolve, release.promise)) });
  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-r2-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  // The caller's own abort starts the real Kernel drain. It is deliberately NOT
  // a control cancel: the Run's `controlState` pointer stays free, so a later
  // control write is still accepted (a queued cancel fences every new control).
  const runAbort = new AbortController();
  const running = runtime.port.startRun({ ...fx.ctx, signal: runAbort.signal },
    { prepared: prepared.value, consumerId: 's2b-r2-driver', requestId: 's2b-r2-start' });
  try {
    await entered.promise;
    runAbort.abort('s2b-r2 caller stop starts the Kernel drain');

    // The Kernel drain ends the Turn; the observer prepares the RUN-08 pending
    // end, attaches the activity and then the wrapped first commit fails.
    await running.catch(() => undefined);
    expect(submissions).toHaveLength(1);
    const first = submissions[0]!;
    expect(first.result).toBe('rejected:unavailable');

    const afterFirst = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
    expect(afterFirst.status).toBe('ready');
    if (afterFirst.status !== 'ready') return;
    expect(afterFirst.value.run.status, 'the failed commit leaves the Run not ended').not.toBe('ended');
    const staleRevision = afterFirst.value.run.revision;

    // A real control write advances the Run revision while the counting is suspended.
    const pauseSubmitted = await controls.submitControl(fx.ctx, {
      input: { runRef: fx.claim.runRef, kind: 'pause', reason: 'advance the Run revision while counting is suspended' },
      meta: { requestId: 's2b-r2-pause', expected: [{ ref: fx.claim.runRef, revision: staleRevision }] },
    });
    expect(pauseSubmitted).toMatchObject({ status: 'committed' });
    if (pauseSubmitted.status !== 'committed') return;

    const advanced = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
    expect(advanced.status).toBe('ready');
    if (advanced.status !== 'ready') return;
    expect(advanced.value.run.revision, 'the pause advanced the Run revision').toBeGreaterThan(staleRevision);

    // The retry must commit the SAME pending input with the CURRENT revision.
    await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
    expect(submissions.length).toBeGreaterThanOrEqual(2);
    const second = submissions[1]!;
    expect(second.result).toBe('committed');

    // The same pending item is retried: same request id, same event id/time and
    // the same input bytes (including the once-attached activity). Only the
    // expected pin moved to the CURRENT Run revision.
    expect(second.requestId).toBe(first.requestId);
    expect(second.input.event.eventId).toBe(first.input.event.eventId);
    expect(second.input.event.occurredAt).toBe(first.input.event.occurredAt);
    expect(canonicalJson(second.input as never)).toBe(canonicalJson(first.input as never));
    expect(first.expected[0]!.revision).toBe(staleRevision);
    expect(second.expected[0]!.revision).toBe(advanced.value.run.revision);
    expect(second.expected[0]!.revision).toBeGreaterThan(first.expected[0]!.revision);

    const ended = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
    expect(ended.status).toBe('ready');
    if (ended.status !== 'ready') return;
    expect(ended.value.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });

    const read = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value).toHaveLength(1);
    expect(read.value[0]).toMatchObject({
      runRef: fx.claim.runRef, status: 'counted', recordedBy: 'run_end',
      totals: { steps: 1, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: true, unresolvedCalls: 1,
    });
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 30_000);
