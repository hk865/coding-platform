/** A5: row 19's generation read, live grant rule and command transition; every expected value is a rule literal. */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  QueryJobIntentV1, QueryJobRef, QueryJobSnapshot, QueryRunRef, QuerySubmissionBindingV1,
  RequestUnderstandingCommandV1, SecretaryRoundMaterialV1,
} from '../../src/contracts/query-job.js';
import {
  currentUnderstandingGeneration, liveUnderstandingGrants, transitionUnderstandingCommand,
  type UnderstandingOperationFactsV1,
} from '../../src/core/work-graph/state/request-rounds.js';

const AT = '2026-10-25T00:00:00.000Z';
const SINCE = 'c0000000001' as CommitCursor;
const ROOT: QueryJobRef = { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' };
const OLD: SessionRef = { projectId: 'p1', sessionId: 's-old' };
const OP1: OperationRef = { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' };
const OP2: OperationRef = { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-2' };

const goal = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: 'p1', goalId });

function command(input: {
  operation?: OperationRef; generation?: number; state?: RequestUnderstandingCommandV1['state'];
  goals?: GoalRef[]; requestRoot?: QueryJobRef;
}): RequestUnderstandingCommandV1 {
  const operation = input.operation ?? OP1;
  const generation = input.generation ?? 3;
  return {
    kind: 'request_understanding',
    commandId: `${operation.operationId}:understanding:${String(generation)}`,
    operation,
    generation,
    requestRoot: input.requestRoot ?? ROOT,
    goals: (input.goals ?? [goal('g1')]).map((goalRef) => ({
      goalRef, pointer: { aggregateType: 'CurrentPointer', projectId: 'p1', anchorKey: `goal:${goalRef.goalId}` },
      pointerRevision: 2,
    })),
    checkedRound: null,
    state: input.state ?? 'live',
  };
}

function material(queryJobId: string, carried: RequestUnderstandingCommandV1 | null): SecretaryRoundMaterialV1 {
  return {
    ref: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId },
    revision: 1,
    runRef: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId, runId: `qr-${queryJobId}` },
    runRevision: 1,
    since: SINCE,
    text: `round ${queryJobId}`,
    selectedIdea: null,
    relatedCards: [],
    command: carried,
  };
}

function facts(input: {
  operation?: OperationRef; generation?: number | null; source?: SessionRef; ownsRoot?: boolean;
}): UnderstandingOperationFactsV1 {
  return {
    operation: input.operation ?? OP1,
    generation: input.generation === undefined ? 3 : input.generation,
    source: input.source ?? OLD,
    ownsRoot: input.ownsRoot ?? true,
  };
}

const OP1_FACTS = facts({ operation: OP1, generation: 3 });
const OP2_FACTS = facts({ operation: OP2, generation: 2, ownsRoot: false });

describe('liveUnderstandingGrants', () => {
  it('keeps the live command of the working example and drops the closed, consumed and moved-away ones', () => {
    const materials = [
      material('qj-9', command({ operation: OP1, generation: 3, goals: [goal('g1'), goal('g2')] })),
      material('qj-4', command({ operation: OP1, generation: 3, state: 'closed' })),
      material('qj-6', command({ operation: OP2, generation: 2, state: 'consumed' })),
      material('qj-8', command({ operation: OP2, generation: 2 })),
    ];
    expect(liveUnderstandingGrants({
      materials, requestRoot: ROOT, operations: [OP1_FACTS, OP2_FACTS],
    })).toEqual([goal('g1'), goal('g2')]);
  });

  it.each([
    { label: 'closed', carried: command({ state: 'closed' }), operationFacts: OP1_FACTS },
    { label: 'consumed', carried: command({ state: 'consumed' }), operationFacts: OP1_FACTS },
    { label: 'a generation mismatch', carried: command({ generation: 4 }), operationFacts: OP1_FACTS },
    { label: 'a null current generation', carried: command({}), operationFacts: facts({ generation: null }) },
    { label: 'a source that no longer owns the root', carried: command({}), operationFacts: facts({ ownsRoot: false }) },
    { label: 'another request root', carried: command({ requestRoot: { ...ROOT, queryJobId: 'qj-2' } }),
      operationFacts: OP1_FACTS },
    { label: 'no operation fact at all', carried: command({}), operationFacts: facts({ operation: OP2 }) },
  ])('drops a $label command', ({ carried, operationFacts }) => {
    expect(liveUnderstandingGrants({
      materials: [material('qj-9', carried)], requestRoot: ROOT, operations: [operationFacts],
    })).toEqual([]);
  });

  it('keeps one entry per goal and follows round-then-batch order', () => {
    const materials = [
      material('qj-9', command({ operation: OP1, goals: [goal('g2'), goal('g1')] })),
      material('qj-4', command({ operation: OP1, goals: [goal('g1')] })),
      material('qj-6', command({ operation: OP2, generation: 2, goals: [goal('g3')] })),
    ];
    expect(liveUnderstandingGrants({
      materials, requestRoot: ROOT, operations: [facts({ operation: OP2, generation: 2 }), OP1_FACTS],
    })).toEqual([goal('g2'), goal('g1'), goal('g3')]);
  });

  it('ignores a material with no command', () => {
    expect(liveUnderstandingGrants({
      materials: [material('qj-9', null), material('qj-4', command({}))], requestRoot: ROOT,
      operations: [OP1_FACTS],
    })).toEqual([goal('g1')]);
  });
});

describe('currentUnderstandingGeneration', () => {
  const handoff = (generations: number[]) => ({
    action: { kind: 'handoff' as const,
      progress: { understanding: generations.map((generation) => ({ generation, requestRoot: ROOT, round: null })) } },
  });

  it.each([
    { label: 'takes the greatest record', operation: handoff([1, 4, 2]), expected: 4 },
    { label: 'has no record', operation: handoff([]), expected: null },
    { label: 'is a create arm', operation: { action: { kind: 'create' as const } }, expected: null },
    { label: 'is an archive arm', operation: { action: { kind: 'secretary_archive' as const } }, expected: null },
  ])('$label', ({ operation, expected }) => {
    expect(currentUnderstandingGeneration(operation)).toBe(expected);
  });
});

describe('transitionUnderstandingCommand', () => {
  const INTENT = { schemaVersion: 1, intentId: 'intent-1', correlationId: 'corr-1', question: 'what next?' } as unknown as QueryJobIntentV1;
  const SUBMISSION: QuerySubmissionBindingV1 = { schemaVersion: 1, identityKey: 'submit-key', fingerprint: 'f'.repeat(64), eventId: 'evt-1' };
  const RUN: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'qr-1' };
  const COMMAND = command({});
  function job(state: RequestUnderstandingCommandV1['state'], commandId = COMMAND.commandId): QueryJobSnapshot {
    return {
      ref: ROOT, revision: 4, schemaVersion: 1, submission: SUBMISSION, since: SINCE,
      job: {
        schemaVersion: 1, queryJobId: 'qj-1', projectId: 'p1', workspaceId: 'w1', goalId: null, intent: INTENT,
        status: 'pending', runRef: RUN, answerRefs: [], closeReason: null, submittedAt: AT, updatedAt: AT,
        requestRoot: ROOT, roundKind: 'request', requestGoalId: null, assignedSession: null, routing: null,
        relatedMessageRef: null, absorbedInto: null, absorbedRounds: [], selectedIdea: null, goalAttribution: null,
        relatedCardRefs: [], enteredSession: null, intakeSession: null, receipt: null,
        understanding: { ...COMMAND, commandId, state },
      },
    };
  }

  it.each([
    ['live', 'closed'], ['live', 'consumed'], ['closed', 'consumed'],
  ] as [RequestUnderstandingCommandV1['state'], 'closed' | 'consumed'][])('moves %s -> %s and copies every immutable field',
    (from, to) => {
      const before = job(from);
      const after = transitionUnderstandingCommand(before, { commandId: COMMAND.commandId, to, occurredAt: AT });
      expect(after.revision).toBe(5);
      expect(after.job.understanding).toEqual({ ...COMMAND, state: to });
      expect(after.job).toEqual({ ...before.job, understanding: { ...COMMAND, state: to }, updatedAt: AT });
      expect(before.job.understanding).toEqual({ ...COMMAND, state: from });
    });

  it.each([
    ['consumed', 'closed'], ['consumed', 'consumed'], ['closed', 'closed'],
  ] as [RequestUnderstandingCommandV1['state'], 'closed' | 'consumed'][])('refuses %s -> %s', (from, to) => {
    const before = job(from);
    expect(() => transitionUnderstandingCommand(before, { commandId: COMMAND.commandId, to, occurredAt: AT }))
      .toThrow(/transitionUnderstandingCommand/);
    expect(before.job.understanding).toEqual({ ...COMMAND, state: from });
  });

  it('refuses a job that carries no such commandId', () => {
    const before = job('live', 'op-1:understanding:9');
    expect(() => transitionUnderstandingCommand(before, { commandId: COMMAND.commandId, to: 'closed', occurredAt: AT }))
      .toThrow(/transitionUnderstandingCommand/);
    expect(before.job.understanding).toEqual({ ...COMMAND, commandId: 'op-1:understanding:9', state: 'live' });
  });
});
