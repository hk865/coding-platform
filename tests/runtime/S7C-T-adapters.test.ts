/**
 * T-adapters (book-7c.md:1387): the `hand_off` adapter's one normalized payload
 * and its four frozen result arms.
 *
 * The context is the real Work `CoreCallContext` the fixture captures from the
 * driver's own `createMemberTools` factory call (T-06); no context is built
 * here. The port is T's structural `HandoffRequestPort` (H's `requestHandoff`
 * is not on this tree), so the row asserts the mapping into that seam, not the
 * owner's business facts (T+L2's real chain).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { CoreRejection } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import {
  createHandoffTools, type HandoffRequestPort,
} from '../../src/core/agent-runtime/handoff-tools.js';
import type {
  ToolCall, ToolDefinition, WorkspaceSandbox,
} from '../../vendor/coding-agent/dist/public-api.js';
import { openS7CToolWorld, type S7CToolStart, type S7CToolWorld } from '../helpers/S7C-t-fixture.js';

const OPERATION: OperationRef = { aggregateType: 'CoreOperation', projectId: 's7c-t-project', operationId: 'op-handoff-1' };

let world: S7CToolWorld;
let started: S7CToolStart;
let context: CoreCallContext;
let source: SessionRef;
let existing: SessionRef;
let tasks: TaskTriple[];

const signal = (): AbortSignal => new AbortController().signal;
const callOf = (argumentsValue: ToolCall['arguments']): ToolCall =>
  ({ schemaVersion: 1, callId: 'handoff-call-1', name: 'hand_off', arguments: argumentsValue });

function adapter(port: HandoffRequestPort): ToolDefinition {
  const handle = createHandoffTools({
    handoffs: port, context, sessionRef: source, duty: 'executor',
    requestIdForCall: () => 'trusted-command-1',
  });
  const [definition] = handle.create(null as unknown as WorkspaceSandbox);
  if (definition === undefined) throw new Error('the hand_off adapter built no definition');
  return definition;
}

const assignments = (): Array<{
  target: { kind: 'create'; duty: 'executor' } | { kind: 'existing'; session: SessionRef };
  tasks: TaskTriple[];
}> => [
  { target: { kind: 'create', duty: 'executor' }, tasks: [structuredClone(tasks[0]!)] },
  { target: { kind: 'existing', session: structuredClone(existing) }, tasks: [structuredClone(tasks[1]!)] },
];

beforeAll(async () => {
  // `create_member` in the grant is what makes the real driver construct its
  // factory, so the fixture can capture the Work context it actually passes.
  world = await openS7CToolWorld({ duty: 'executor', grantTools: ['read', 'create_member'], createMember: true });
  started = await world.start();
  if (started.context === null) throw new Error('the fixture captured no real Work context');
  context = started.context;
  source = world.line.ref;
  existing = (await world.world.createWorkSession('s7c-t-adapters-existing')).ref;
  tasks = [...world.tasks];
}, 120_000);

afterAll(async () => { if (world !== undefined) await world.world.close(); });

describe('T-adapters: the normalized hand_off payload', () => {
  it('maps the trusted caller, source, both targets and their tasks unchanged into the port', async () => {
    const received: Array<{ ctx: CoreCallContext; input: Parameters<HandoffRequestPort>[1] }> = [];
    const port: HandoffRequestPort = async (ctx, input) => {
      received.push({ ctx, input });
      return { status: 'accepted', operation: OPERATION };
    };
    const definition = adapter(port);
    const sent = assignments();
    const result = await definition.handler.execute(callOf({
      source, assignments: sent, reason: '交接 t1 和 t2',
    }), { signal: signal() });

    expect(result.status).toBe('success');
    expect(received).toHaveLength(1);
    const input = received[0]!.input;
    expect(input).toEqual({
      commandId: 'trusted-command-1',
      caller: {
        actor: { kind: 'agent', id: expect.stringMatching(/^session:/), runRef: started.run },
        session: source, run: started.run, duty: 'executor',
      },
      source,
      assignments: sent,
      reason: '交接 t1 和 t2',
    });
    // Both targets and their tasks arrive unchanged, one create and one existing.
    expect(input.assignments[0]!.target).toEqual({ kind: 'create', duty: 'executor' });
    expect(input.assignments[0]!.tasks).toEqual([tasks[0]!]);
    expect(input.assignments[1]!.target).toEqual({ kind: 'existing', session: existing });
    expect(input.assignments[1]!.tasks).toEqual([tasks[1]!]);
    expect(received[0]!.ctx.principal).toMatchObject({ kind: 'work_run', runRef: started.run });
  });
});

describe('T-adapters: the frozen result arms', () => {
  const needsDecisionText = '交接已登记，等人批准后再开始接手；这一轮不能继续交接，也不要重复提交。';
  const acceptedText = '交接已接受，接手会在批准后按阶段进行。';
  const rejected: CoreRejection = { status: 'rejected', code: 'forbidden', reason: 'the source Run lacks the understanding note' };
  const cancelledResult: CoreRejection = { status: 'rejected', code: 'cancelled', reason: 'the handoff request was cancelled' };
  const cases: ReadonlyArray<readonly [string, Awaited<ReturnType<HandoffRequestPort>>, {
    status: 'success' | 'error' | 'cancelled'; code?: string; message?: string; text?: string; value?: unknown;
  }]> = [
    ['incomplete', { status: 'incomplete', text: '缺少来源 Run 的理解注记' },
      { status: 'success', value: { status: 'incomplete', text: '缺少来源 Run 的理解注记' }, text: '缺少来源 Run 的理解注记' }],
    ['accepted', { status: 'accepted', operation: OPERATION },
      { status: 'success', value: { status: 'accepted', operation: OPERATION }, text: acceptedText }],
    ['needs_decision', { status: 'needs_decision', cardKey: 'card:handoff:1', operation: OPERATION },
      { status: 'success', value: { status: 'needs_decision', cardKey: 'card:handoff:1', operation: OPERATION },
        text: needsDecisionText }],
    ['a CoreRejection', rejected,
      { status: 'error', code: 'execution_failed', message: 'the source Run lacks the understanding note' }],
    ['cancelled', cancelledResult,
      { status: 'cancelled', message: 'the handoff request was cancelled' }],
  ];

  it.each(cases)('maps %s onto the frozen Kernel arm', async (_label, portResult, expected) => {
    const definition = adapter(async () => portResult);
    const result = await definition.handler.execute(callOf({
      source, assignments: assignments(), reason: '交接',
    }), { signal: signal() });

    expect(result.status).toBe(expected.status);
    if (expected.status === 'success') {
      const json = result.output.find((block: { kind: string; value?: unknown }) => block.kind === 'json');
      const text = result.output.find((block: { kind: string; text?: string }) => block.kind === 'text');
      expect(json?.kind === 'json' ? json.value : undefined).toEqual(expected.value);
      expect(text?.kind === 'text' ? text.text : undefined).toBe(expected.text);
      return;
    }
    if (expected.status === 'cancelled') {
      expect(result.status === 'cancelled' ? result.reason : undefined).toBe(expected.message);
      return;
    }
    expect(result.status === 'error' ? result.error : undefined)
      .toMatchObject({ code: expected.code, message: expected.message, retryable: false });
  });

  it('answers the frozen unconfirmed text when the owner throws', async () => {
    const definition = adapter(async () => { throw new Error('the commit outcome is unknown'); });
    const result = await definition.handler.execute(callOf({
      source, assignments: assignments(), reason: '交接',
    }), { signal: signal() });
    expect(result).toMatchObject({
      status: 'error',
      error: { code: 'execution_failed', retryable: false,
        message: 'the handoff request result is unconfirmed; do not retry under a new callId' },
    });
  });

  it('refuses arguments the strict schema does not accept before any port call', async () => {
    let called = 0;
    const definition = adapter(async () => { called += 1; return { status: 'accepted', operation: OPERATION }; });
    const result = await definition.handler.execute(callOf({
      source, assignments: [], reason: 'empty assignments',
    }), { signal: signal() });
    expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    expect(called).toBe(0);
  });
});
