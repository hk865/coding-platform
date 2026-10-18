/**
 * K3 row K3-16 (L20/section 2): the `propose_safer_method` proposal-round tool.
 *
 * The tool binds the record and the round Run from trusted config + the
 * `work_run` principal; the model supplies only the alias, command, cwd and
 * rationale. The owner owns replay, units and the 5,120-byte budget; this
 * adapter only preserves its outcome. `phase` chooses which one tool the
 * factory registers and defaults to the review tool.
 */
import { expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import {
  PROPOSE_SAFER_METHOD_TOOL_NAME, RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME, createUnknownCallReviewTools,
} from '../../src/core/agent-runtime/unknown-call-review-tools.js';

const projectId = 'k3-16-project';
const goalId = 'k3-16-goal';
const runRef: RunRef = { aggregateType: 'Run', projectId, goalId, runId: 'k3-16-proposal-run' };
const reviewRef: UnknownCallReviewRef = { aggregateType: 'UnknownCallReview', projectId, goalId, runId: 'k3-16-origin-run' };

function workRunContext(): CoreCallContext {
  return {
    projectId, workspaceId: 'k3-16-workspace',
    principal: { kind: 'work_run', runRef,
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: '1' } },
    materialReader: { kind: 'run', requester: runRef },
    signal: new AbortController().signal,
  };
}

type OwnerCall = { input: Record<string, unknown>; meta: Record<string, unknown> };

function toolHandle(owner: { write?: (request: OwnerCall) => unknown }, phase?: 'review' | 'proposal') {
  const writes: OwnerCall[] = [];
  const reviews = {
    async readReview() { return { status: 'ready', value: { revision: 7 } }; },
    async recordConclusion(_ctx: unknown, request: OwnerCall) {
      writes.push(request);
      return { status: 'committed', value: { revision: 8 }, replayed: false, cursor: 'k3-16-cursor' as CommitCursor };
    },
    async recordProposal(_ctx: unknown, request: OwnerCall) {
      writes.push(request);
      return owner.write === undefined
        ? { status: 'committed', value: { revision: 8 }, replayed: false, cursor: 'k3-16-cursor' as CommitCursor }
        : owner.write(request);
    },
  } as never;
  const handle = createUnknownCallReviewTools({
    reviews, context: workRunContext(), reviewRef,
    requestIdForCall: call => `req:${call.callId}`,
    ...(phase === undefined ? {} : { phase }),
  });
  const definitions = handle.create({} as never);
  return { handle, definitions, writes };
}

function definitionOf(definitions: ToolDefinition[], name: string): ToolDefinition {
  const definition = definitions.find(def => def.name === name);
  if (definition === undefined) throw new Error(`${name} is not registered`);
  return definition;
}

const validArguments = {
  item: 1, command: 'npm test -- --run', cwd: '/workspace', rationale: 'the old command raced the test run',
};

async function execute(definition: ToolDefinition,
  args: unknown, callId = 'k3-16-call-1'): Promise<Record<string, unknown>> {
  return await definition.handler.execute(
    { schemaVersion: 1, callId, name: definition.name, arguments: args as never },
    { signal: new AbortController().signal }) as Record<string, unknown>;
}

function outputValue(result: Record<string, unknown>): unknown {
  return (result['output'] as Array<{ kind: string; value?: unknown }> | undefined)?.[0]?.value;
}

it('K3-16 the factory registers the review tool by default and phase review, the proposal tool for phase proposal', () => {
  const byDefault = toolHandle({});
  expect(byDefault.handle.names).toEqual([RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME]);
  expect(byDefault.definitions.map(def => def.name)).toEqual([RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME]);

  const review = toolHandle({}, 'review');
  expect(review.handle.names).toEqual([RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME]);
  expect(review.definitions.map(def => def.name)).toEqual([RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME]);

  const proposal = toolHandle({}, 'proposal');
  expect(proposal.handle.names).toEqual([PROPOSE_SAFER_METHOD_TOOL_NAME]);
  expect(proposal.definitions.map(def => def.name)).toEqual([PROPOSE_SAFER_METHOD_TOOL_NAME]);
  expect(proposal.definitions[0]).toMatchObject({
    effectClass: 'workspace_write', requiredCapabilities: [], independentReadOnly: false,
    defaultTimeoutMs: 10_000, outputLimitBytes: 64 * 1024,
  });
});

it('K3-16 the proposal tool binds the trusted ref, the work_run round and the callId request id', async () => {
  const { definitions, writes } = toolHandle({}, 'proposal');
  const definition = definitionOf(definitions, PROPOSE_SAFER_METHOD_TOOL_NAME);
  const result = await execute(definition, validArguments);
  expect(result).toMatchObject({ status: 'success' });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    input: { reviewRef, item: 1, command: 'npm test -- --run', cwd: '/workspace',
      rationale: 'the old command raced the test run' },
    meta: { requestId: 'req:k3-16-call-1', expected: [] },
  });
  // The bounded receipt shape is exactly the review tool's.
  expect(outputValue(result)).toEqual({
    status: 'committed', item: 1, revision: 8, receipt: 'k3-16-cursor', replayed: false,
  });
});

it('K3-16 an absent cwd is sent as null', async () => {
  const { definitions, writes } = toolHandle({}, 'proposal');
  const definition = definitionOf(definitions, PROPOSE_SAFER_METHOD_TOOL_NAME);
  await execute(definition, { item: 2, command: 'echo ok', rationale: 'why' });
  expect(writes[0]).toMatchObject({ input: { item: 2, command: 'echo ok', cwd: null, rationale: 'why' } });
});

it('K3-16 an explicit null cwd is invalid_arguments (§2 says cwd?: string) and never reaches the owner', async () => {
  const { definitions, writes } = toolHandle({}, 'proposal');
  const definition = definitionOf(definitions, PROPOSE_SAFER_METHOD_TOOL_NAME);
  const result = await execute(definition,
    { item: 2, command: 'echo ok', cwd: null, rationale: 'why' });
  expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments', retryable: false } });
  expect(writes).toEqual([]);
});

it('K3-16 the proposal tool maps owner rejections faithfully', async () => {
  const invalid = toolHandle({ write: () => ({ status: 'rejected', code: 'invalid',
    reason: 'the proposal is not for an item in proposalTargets' }) }, 'proposal');
  const invalidResult = await execute(definitionOf(invalid.definitions, PROPOSE_SAFER_METHOD_TOOL_NAME), validArguments);
  expect(invalidResult).toMatchObject({ status: 'error', error: { code: 'invalid_arguments', retryable: false } });
  expect(String((invalidResult['error'] as { message?: string }).message))
    .toContain('the proposal is not for an item in proposalTargets');

  const capacity = toolHandle({ write: () => ({ status: 'rejected', code: 'capacity',
    reason: 'the approved-method lines exceed 5120 bytes' }) }, 'proposal');
  const capacityResult = await execute(definitionOf(capacity.definitions, PROPOSE_SAFER_METHOD_TOOL_NAME), validArguments);
  expect(capacityResult).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });
  const capacityMessage = String((capacityResult['error'] as { message?: string }).message);
  expect(capacityMessage).toContain('the approved-method lines exceed 5120 bytes');
  expect(capacityMessage).toMatch(/缩短/);
  expect(outputValue(capacityResult)).toMatchObject({ status: 'rejected', code: 'capacity' });

  const failed = toolHandle({ write: () => ({ status: 'rejected', code: 'unavailable', reason: 'store down' }) }, 'proposal');
  const failedResult = await execute(definitionOf(failed.definitions, PROPOSE_SAFER_METHOD_TOOL_NAME), validArguments);
  expect(failedResult).toMatchObject({ status: 'error', error: { code: 'execution_failed' } });

  const cancelled = toolHandle({ write: () => ({ status: 'rejected', code: 'cancelled', reason: 'aborted' }) }, 'proposal');
  const cancelledResult = await execute(definitionOf(cancelled.definitions, PROPOSE_SAFER_METHOD_TOOL_NAME), validArguments);
  expect(cancelledResult).toMatchObject({ status: 'cancelled' });
});

it('K3-16 a malformed proposal argument object arrives as invalid_arguments before the owner', async () => {
  const { definitions, writes } = toolHandle({}, 'proposal');
  const definition = definitionOf(definitions, PROPOSE_SAFER_METHOD_TOOL_NAME);
  for (const bad of [{ item: 0, command: 'x', rationale: 'r' },
    { item: 1, command: '', rationale: 'r' },
    { item: 1, command: 'x', rationale: '' },
    { item: 1, command: 'x', rationale: 'r', extra: true }]) {
    const result = await execute(definition, bad);
    expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
  }
  expect(writes).toEqual([]);
});
