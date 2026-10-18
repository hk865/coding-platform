/**
 * K3 row K3-14 (L14): the `record_unknown_call_review` review-round tool and
 * its registration seam.
 *
 * The tool binds the review record ref and the round Run from trusted config +
 * the `work_run` principal; the model supplies only the alias, verdict,
 * evidence and crash self-check. The adapter sends `expected: []` and never
 * pre-reads the record (Codex 7): the owner checks the receipt identity, reads
 * the current revision and guards it. Owner-level replay and
 * `idempotency_conflict` stay in the owner and are surfaced faithfully. The
 * STARTED review round (the driver registering the tool on a
 * `purpose.kind === 'unknown_call_review'` Run, overwrite, invalid alias and the
 * read-back) runs through the real prepare/start seam in
 * tests/scenarios/K3-12-14-review-round.test.ts (R2/R5).
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { newUnknownCallReview } from '../../src/core/work-graph/state/unknown-call-review.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import {
  createControlOnlyInputSupply, type InputSupply,
} from '../../src/core/agent-runtime/execution-inputs.js';
import {
  RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME, createUnknownCallReviewTools,
} from '../../src/core/agent-runtime/unknown-call-review-tools.js';
import { createB2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';

const projectId = 'k3-14-project';
const goalId = 'k3-14-goal';
const runRef: RunRef = { aggregateType: 'Run', projectId, goalId, runId: 'k3-14-round-run' };
const reviewRef: UnknownCallReviewRef = { aggregateType: 'UnknownCallReview', projectId, goalId, runId: 'k3-14-origin-run' };

function workRunContext(): CoreCallContext {
  return {
    projectId, workspaceId: 'k3-14-workspace',
    principal: { kind: 'work_run', runRef,
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: '1' } },
    materialReader: { kind: 'run', requester: runRef },
    signal: new AbortController().signal,
  };
}

type OwnerCall = { input: Record<string, unknown>; meta: Record<string, unknown> };

function toolHandle(owner: {
  revision?: number;
  read?: () => unknown;
  write?: (request: unknown) => unknown;
}) {
  const reads: unknown[] = [];
  const writes: OwnerCall[] = [];
  const reviews = {
    async readReview(_ctx: unknown, input: unknown) {
      reads.push(input);
      return owner.read === undefined
        ? { status: 'ready', value: { revision: owner.revision ?? 7 } }
        : owner.read();
    },
    async recordConclusion(_ctx: unknown, request: { input: Record<string, unknown>; meta: Record<string, unknown> }) {
      writes.push(request);
      return owner.write === undefined
        ? { status: 'committed', value: { revision: 8 }, replayed: false, cursor: 'k3-14-cursor' as CommitCursor }
        : owner.write(request);
    },
  } as never;
  const handle = createUnknownCallReviewTools({
    reviews, context: workRunContext(), reviewRef,
    requestIdForCall: call => `req:${call.callId}`,
  });
  const definition = handle.create({} as never).find(def => def.name === RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME);
  if (definition === undefined) throw new Error('record_unknown_call_review is not registered');
  return { definition, reads, writes };
}

const validArguments = {
  item: 1, verdict: 'done' as const, evidence: 'I ran it; output matched',
  crashSuspicion: { verdict: 'unlikely' as const, evidence: 'no crash left behind' },
};

async function execute(definition: ToolDefinition,
  args: unknown, callId = 'k3-14-call-1'): Promise<Record<string, unknown>> {
  return await definition.handler.execute(
    { schemaVersion: 1, callId, name: RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME, arguments: args as never },
    { signal: new AbortController().signal }) as Record<string, unknown>;
}

it('K3-14 the tool binds the review ref, the work_run round and the callId request id without pre-reading the record', async () => {
  const { definition, reads, writes } = toolHandle({});
  const result = await execute(definition, validArguments);
  expect(result).toMatchObject({ status: 'success' });
  // Codex 7 / L14: the adapter sends no record pin and never reads the record
  // first; the owner checks the receipt identity and reads the current revision
  // itself. `expected: []` is the production review-round shape.
  expect(reads).toEqual([]);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    input: { reviewRef, item: 1, verdict: 'done', evidence: 'I ran it; output matched',
      crashSuspicion: { verdict: 'unlikely', evidence: 'no crash left behind' } },
    meta: { requestId: 'req:k3-14-call-1', expected: [] },
  });
  const output = (result['output'] as Array<{ kind: string; value?: unknown }>)[0];
  expect(output).toMatchObject({ kind: 'json', value: { status: 'committed', replayed: false } });
});

it('K3-14 the tool surfaces the owner receipt and domain errors faithfully', async () => {
  const committed = toolHandle({ write: () => ({ status: 'committed', value: { revision: 9 }, replayed: true,
    cursor: 'k3-14-cursor' as CommitCursor }) });
  const replayed = await execute(committed.definition, validArguments);
  expect(replayed).toMatchObject({ status: 'success' });
  expect(((replayed['output'] as Array<{ value?: unknown }>)[0]?.value as { replayed?: boolean }).replayed).toBe(true);

  const conflict = toolHandle({ write: () => ({ status: 'rejected', code: 'idempotency_conflict',
    reason: 'the same request identity carries different content' }) });
  const rejected = await execute(conflict.definition, validArguments);
  expect(rejected).toMatchObject({ status: 'error', error: { code: 'execution_failed', retryable: false } });
  expect(((rejected['output'] as Array<{ value?: unknown }>)[0]?.value as { code?: string }).code)
    .toBe('idempotency_conflict');
});

it('K3-14 a non-process alias is invalid_arguments and writes nothing', async () => {
  const { definition, writes } = toolHandle({ write: () => ({ status: 'rejected', code: 'invalid',
    reason: 'the alias is not a process item' }) });
  const result = await execute(definition, { ...validArguments, item: 2 });
  expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
  expect(writes).toHaveLength(1);
});

it('K3-14 a malformed argument object is invalid_arguments and never reaches the owner', async () => {
  const { definition, reads, writes } = toolHandle({});
  const result = await execute(definition, { item: 1, verdict: 'done', evidence: 'x' });
  expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
  expect(reads).toEqual([]);
  expect(writes).toEqual([]);
});

it('K3-14 the review round input channel supplies only control inputs', async () => {
  const point = { sessionId: 's', runId: 'r', turnId: 't', afterEventSequence: 0, acceptedInputIds: [] };
  const seen: Array<{ point: unknown; aborted: boolean }> = [];
  const control: InputSupply = async (received, options) => {
    seen.push({ point: received, aborted: options.signal.aborted });
    return [{ inputId: 'control:1', text: 'pause', sourceRef: { kind: 'ControlIntent' } }];
  };
  const supply = createControlOnlyInputSupply(control);
  const items = await supply(point, { signal: new AbortController().signal });
  expect(items.map(item => item.inputId)).toEqual(['control:1']);
  expect(seen).toHaveLength(1);
  expect(seen[0]?.point).toEqual(point);
});

// --------------------------------------------------------------------------- //
// Driver registration: the tool is never registered on an ordinary Run.        //
// The positive review-phase case runs through the real review prepare/start     //
// seam in tests/scenarios/K3-12-14-review-round.test.ts (R2). The session-1     //
// test that injected a review `purpose` only AFTER an ordinary `prepare` and    //
// expected `startRun` to be ready is gone: R4 now correctly refuses it (the     //
// manifest carries the ordinary tool set, not the L13 set).                     //
// --------------------------------------------------------------------------- //

const fixtures: Array<Awaited<ReturnType<typeof createB2RuntimeFixture>>> = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

/**
 * A complete `UnknownCallReviewV1` for the review port double: the review-round
 * preparation reads it by `run.purpose.reviewRef`, so a narrow
 * `{ revision }` double fails closed as "not a complete review". `revision` is
 * fixed at 3 to match the round state after `round_claimed`.
 */
function completeReview(workspaceId: string): unknown {
  const built = newUnknownCallReview({
    ref: reviewRef, workspaceId,
    task: { projectId, goalId, taskId: 'k3-14-task' },
    runRef: { aggregateType: 'Run', projectId, goalId, runId: reviewRef.runId },
    sessionRef: { projectId, sessionId: 'k3-14-origin-session' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'k3-14-operator' }, reason: 'K3-14' },
    inventory: 'complete', inventoryProblem: null,
    items: [{
      alias: 1, callId: 'k3-14-kernel-call', toolName: 'shell', kind: 'process', contained: true,
      kernel: { adapterId: 'k3-14-kernel', kernelSessionId: 'k3-14-kernel-session', kernelRunId: 'k3-14-kernel-run',
        turnId: 'k3-14-kernel-turn', callId: 'k3-14-kernel-call', declaredPosition: 1, startedPosition: 1 },
      argumentsDigest: 'd'.repeat(64),
      summary: { command: 'echo k3-14', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
      startedAt: null, observed: { verdict: 'pending', by: null },
    }],
    itemsOmitted: 0,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'K3-14' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: '2026-10-20T00:00:00.000Z',
  } as never);
  if (!built.ok) throw new Error('the K3-14 review sample did not build: ' + JSON.stringify(built));
  return { ...(built.next as unknown as Record<string, unknown>), revision: 3 };
}

async function startedRuntime(ownerCalls: OwnerCall[]): Promise<{
  runtime: ReturnType<typeof createAgentRuntime>;
  fixture: Awaited<ReturnType<typeof createB2RuntimeFixture>>;
}> {
  const fixture = await createB2RuntimeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-14-driver-call', name: RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME,
      args: { item: 1, verdict: 'not_done', evidence: 'no trace', crashSuspicion: { verdict: 'possible', evidence: 'crash left no trace' } } }] },
    { kind: 'text', text: 'K3-14 review round finished' },
  ] });
  fixtures.push(fixture);
  const base = fixture.rebuildDeps();
  const deps: RuntimeExecutionDependencies = {
    ...base,
    unknownCallReviews: {
      async readReview() { return { status: 'ready', value: completeReview(fixture.scope.workspaceId) }; },
      async listReviews() { return { status: 'ready', value: { items: [], nextCursor: null, readThrough: null } }; },
      async recordConclusion(_ctx: unknown, request: never) {
        ownerCalls.push(request);
        return { status: 'committed', value: { revision: 4 }, replayed: false, cursor: 'k3-14-cursor' as CommitCursor };
      },
    } as never,
  };
  return { runtime: createAgentRuntime(deps), fixture };
}

it('K3-14 the driver never registers record_unknown_call_review on an ordinary Run', async () => {
  const ownerCalls: OwnerCall[] = [];
  const { runtime, fixture } = await startedRuntime(ownerCalls);
  const prepared = await runtime.port.prepareExecution(fixture.ctx, { runRef: fixture.claim.runRef, requestId: 'k3-14-prepare-2' });
  if (prepared.status !== 'ready') throw new Error('prepare failed: ' + JSON.stringify(prepared));
  await runtime.port.startRun(fixture.ctx, { prepared: prepared.value, consumerId: 'k3-14-consumer-2', requestId: 'k3-14-start-2' });
  expect(fixture.scripted.requests[0]?.tools.map(tool => tool.name)).not.toContain(RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME);
  expect(ownerCalls).toEqual([]);
});
