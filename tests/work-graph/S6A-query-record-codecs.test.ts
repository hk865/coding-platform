/**
 * 6A-1 group C: the QueryJob/Answer record formats and the four 6A-1 index
 * declarations (book-6a §3.1, §3.2, §3.12).
 *
 * Pure A5 codec tests: no store, platform, Host, Workflow, Runtime or stub port.
 * Every expected literal below is hand-computed from book §3.2/§3.12 (the slots
 * shape is frozen there); nothing is read back from production output.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type {
  PendingQueryJobSnapshot,
  QueryJobAnswerSnapshot,
  QueryJobRef,
  QueryJobSnapshot,
  RequestUnderstandingCommandV1,
} from '../../src/contracts/query-job.js';
import {
  QUERY_BY_REQUEST_INDEX,
  QUERY_OPEN_BY_WORKSPACE_INDEX,
  QUERY_RAN_BY_SESSION_GOAL_INDEX,
  REQUEST_ROOTS_BY_GOAL_INDEX,
} from '../../src/core/work-graph/model/request-contracts.js';
import {
  decodeQueryJobAnswerSnapshot,
  decodeQueryJobSnapshot,
  encodeQueryJobAnswerSnapshot,
  encodeQueryJobSnapshot,
  queryManifestProblem,
  QUERY_JOB_RECORD_SCHEMAS,
  QUERY_JOB_SNAPSHOT_SCHEMA_ID,
} from '../../src/core/work-graph/queries/query-record-codecs.js';

const P = 'project-1';
const W = 'workspace-1';
const AT = '2026-10-23T00:00:00.000Z';
const cursor = (value: string): CommitCursor => value as CommitCursor;
const ref = (queryJobId: string): QueryJobRef => ({ aggregateType: 'QueryJob', projectId: P, workspaceId: W, queryJobId });
const session = (sessionId: string) => ({ projectId: P, sessionId });
const submission = { schemaVersion: 1 as const, identityKey: 'submit-identity-1',
  fingerprint: 'a'.repeat(64), eventId: 'submit-event-1' };
const root = ref('query-1');
const RUN_REF = { aggregateType: 'QueryRun' as const, projectId: P, workspaceId: W, queryJobId: 'query-1', runId: 'run-1' };

function intent() {
  return {
    schemaVersion: 1 as const, intentId: 'query-1', projectId: P, workspaceId: W, goalId: 'goal-1',
    question: 'Which module owns X?', focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
    multiTurn: { maxRounds: 1 }, correlationId: 'corr-1',
    execution: {
      kind: 'semantic_query' as const,
      roleBinding: { schemaVersion: 1 as const, bindingId: 'binding-1', templateId: 'advisor',
        templateRevision: '1', bindingVersion: 1, policyRevision: '1' },
      runtimeBudget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: 1,
        maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 },
    },
  };
}

/** A request root with every new §3.12 field populated. */
function requestJob(): QueryJobSnapshot {
  return {
    ref: root,
    revision: 1,
    schemaVersion: 1,
    since: cursor('c0000000002'),
    submission,
    job: {
      schemaVersion: 1, queryJobId: 'query-1', projectId: P, workspaceId: W, goalId: 'goal-1',
      intent: intent(), status: 'pending', runRef: RUN_REF, answerRefs: [], closeReason: null,
      submittedAt: AT, updatedAt: AT,
      requestRoot: root,
      roundKind: 'request',
      requestGoalId: 'goal-1',
      assignedSession: session('session-1'),
      routing: { from: session('session-1'), to: session('session-2'), reason: 'handoff' },
      relatedMessageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'message-1' },
      absorbedInto: ref('query-0'),
      absorbedRounds: [ref('query-3')],
      selectedIdea: { round: ref('query-2'), index: 2 },
      goalAttribution: 'goal-2',
      relatedCardRefs: [{ ref: { aggregateType: 'Goal', projectId: P, goalId: 'goal-2' }, revision: 4 }],
      enteredSession: session('session-3'),
      intakeSession: session('session-4'),
      receipt: { kind: 'submit', requestRoot: root, round: ref('query-3'), assignment: 'assigned',
        secretary: session('session-1'), created: true },
      understanding: null,
    },
  };
}

/** The same Job as a Query that is not a request (§3.1.1). */
function nonRequestJob(): QueryJobSnapshot {
  return {
    ref: root,
    revision: 1,
    schemaVersion: 1,
    since: cursor('c0000000005'),
    submission,
    job: {
      schemaVersion: 1, queryJobId: 'query-1', projectId: P, workspaceId: W, goalId: 'goal-1',
      intent: intent(), status: 'pending', runRef: RUN_REF, answerRefs: [], closeReason: null,
      submittedAt: AT, updatedAt: AT,
      requestRoot: null,
      roundKind: null,
      requestGoalId: null,
      assignedSession: null,
      routing: null,
      relatedMessageRef: null,
      absorbedInto: null,
      absorbedRounds: [],
      selectedIdea: null,
      goalAttribution: null,
      relatedCardRefs: [],
      enteredSession: null,
      intakeSession: null,
      receipt: null,
      understanding: null,
    },
  };
}

/** §3.2 frozen slots: derived from the Job, never client input. */
const REQUEST_SLOTS = {
  rootKey: '{"aggregateType":"QueryJob","projectId":"project-1","queryJobId":"query-1","workspaceId":"workspace-1"}',
  requestMark: 'request',
  rootMark: 'root',
  goalSlot: 'g:goal-1',
  enteredSlot: 's:{"projectId":"project-1","sessionId":"session-3"}',
};
const NONE_SLOTS = {
  rootKey: 'none', requestMark: 'none', rootMark: 'none', goalSlot: 'none', enteredSlot: 'none',
};
/** A follow-up/routing round points at the root but is not the root; no entry yet. */
const NON_ROOT_REQUEST_SLOTS = {
  rootKey: '{"aggregateType":"QueryJob","projectId":"project-1","queryJobId":"query-1","workspaceId":"workspace-1"}',
  requestMark: 'request',
  rootMark: 'none',
  goalSlot: 'g:goal-1',
  enteredSlot: 'none',
};
/** A request with no target Goal writes the named `no-goal` slot, not `none`. */
const NO_TARGET_REQUEST_SLOTS = {
  rootKey: '{"aggregateType":"QueryJob","projectId":"project-1","queryJobId":"query-1","workspaceId":"workspace-1"}',
  requestMark: 'request',
  rootMark: 'root',
  goalSlot: 'no-goal',
  enteredSlot: 'none',
};

/**
 * A follow-up on the root request: a round of its own (`query-5`, with its own
 * Run and receipt) whose `requestRoot` still names the root; not the root, no
 * entry. Its own ref differs from the root, so the root key can only come from
 * `requestRoot`.
 */
function followupJob(): QueryJobSnapshot {
  const job = requestJob();
  const own = ref('query-5');
  return {
    ...job,
    ref: own,
    job: {
      ...job.job, queryJobId: 'query-5', intent: { ...intent(), intentId: 'query-5' },
      runRef: { ...RUN_REF, queryJobId: 'query-5', runId: 'run-5' },
      roundKind: 'followup', assignedSession: null, intakeSession: null, enteredSession: null,
      receipt: { kind: 'select_idea', followupRound: own, secretary: null },
    },
  };
}

/**
 * A terminal routing round of its own (`query-4`): points at the root, creates
 * no Run, never enters.
 */
function routingJob(): QueryJobSnapshot {
  const job = requestJob();
  return {
    ...job,
    ref: ref('query-4'),
    job: {
      ...job.job, queryJobId: 'query-4', intent: { ...intent(), intentId: 'query-4' }, status: 'closed', runRef: null,
      closeReason: { code: 'not_entered', message: 'routing_round_created_closed', detail: null },
      roundKind: 'routing', assignedSession: null, intakeSession: null, enteredSession: null,
      routing: { from: null, to: session('session-2'), reason: 'assigned' },
      receipt: { kind: 'route', routingRound: ref('query-4') },
    },
  };
}

/** A request round with no target Goal. */
function noTargetRequestJob(): QueryJobSnapshot {
  const job = requestJob();
  return { ...job, job: { ...job.job, goalId: null, requestGoalId: null, enteredSession: null } };
}

function answerJob(): QueryJobAnswerSnapshot {
  return {
    ref: { aggregateType: 'QueryJobAnswer', projectId: P, workspaceId: W, queryJobId: 'query-1', answerId: 'answer-1' },
    revision: 1,
    schemaVersion: 1,
    answer: {
      schemaVersion: 1, answerId: 'answer-1', queryJobRef: root, runRef: RUN_REF, roundIndex: 0,
      answer: 'X is owned by module M.', sources: [], followsAnswerRef: null, stale: false, staleReason: null,
      answeredAt: AT,
      bodyRef: { kind: 'artifact', contentType: 'text/plain; charset=utf-8', digest: 'b'.repeat(64),
        sizeBytes: 21, source: { kind: 'workspace', refId: 'workspace-1', revision: '2' } },
      ideas: [
        { title: 'First idea', detail: 'The first detail' },
        { title: 'Second idea', detail: 'The second detail' },
      ],
      goalCardDrafts: [
        { objective: 'Ship C', completion: ['the suite is green'], autonomy: 'after_plan_confirmation', screening: null },
      ],
      planDraftIndex: null,
    },
  };
}

describe('QueryJob current format (§3.1.1, §3.3)', () => {
  it('round-trips a request Job with every new field and carries the derived request slots', () => {
    const job = requestJob();
    const encoded = encodeQueryJobSnapshot(job);
    expect(JSON.parse(encoded.json)).toMatchObject({ since: 'c0000000002', slots: REQUEST_SLOTS });
    expect(decodeQueryJobSnapshot(encoded)).toEqual({ status: 'decoded', value: job });
    expect(JSON.parse(encoded.json)).not.toHaveProperty('job.slots');
  });

  it('round-trips a non-request Job with null/[] fields and none slots', () => {
    const job = nonRequestJob();
    const encoded = encodeQueryJobSnapshot(job);
    expect(JSON.parse(encoded.json)).toMatchObject({ slots: NONE_SLOTS });
    expect(decodeQueryJobSnapshot(encoded)).toEqual({ status: 'decoded', value: job });
  });

  it('round-trips the internal understanding receipt arm', () => {
    const base = requestJob();
    const job: QueryJobSnapshot = {
      ...base,
      job: { ...base.job, receipt: { kind: 'understanding', round: root } },
    };
    expect(decodeQueryJobSnapshot(encodeQueryJobSnapshot(job))).toEqual({ status: 'decoded', value: job });
  });

  it('encodes the pending since placeholder a creator builds, but decode requires the bound cursor (§3.1.2)', () => {
    const pending: PendingQueryJobSnapshot = { ...requestJob(), since: null };
    const encoded = encodeQueryJobSnapshot(pending);
    expect(JSON.parse(encoded.json)).toMatchObject({ since: null });
    const result = decodeQueryJobSnapshot(encoded);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('since');
  });

  it.each([null, 'x', '0000000002', 'c000000000'])(
    'rejects a stored snapshot whose since is not a bound commit cursor: %s',
    (since) => {
      const encoded = encodeQueryJobSnapshot({ ...requestJob(), since: since as PendingQueryJobSnapshot['since'] });
      const result = decodeQueryJobSnapshot(encoded);
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') expect(result.reason).toContain('since');
    },
  );

  it('rejects a record without slots', () => {
    const body = JSON.parse(encodeQueryJobSnapshot(requestJob()).json) as { slots?: unknown };
    delete body.slots;
    const encoded = { ...encodeQueryJobSnapshot(requestJob()), json: JSON.stringify(body) };
    expect(decodeQueryJobSnapshot(encoded).status).toBe('invalid');
  });
});

describe('the stored understanding command', () => {
  const OPERATION = { aggregateType: 'CoreOperation' as const, projectId: P, operationId: 'op-1' };
  const GOAL = { aggregateType: 'Goal' as const, projectId: P, goalId: 'goal-1' };
  const POINTER = { aggregateType: 'CurrentPointer' as const, projectId: P, anchorKey: 'goal:goal-1' };
  const COMMAND: RequestUnderstandingCommandV1 = {
    kind: 'request_understanding',
    commandId: 'op-1:understanding:3',
    operation: OPERATION,
    generation: 3,
    requestRoot: root,
    goals: [{ goalRef: GOAL, pointer: POINTER, pointerRevision: 4 }],
    checkedRound: RUN_REF,
    state: 'live',
  };
  /** The pre-migration shape the one normalizer maps: `pointers`, `operationRef` and no `commandId`. */
  const OLD_COMMAND = {
    kind: 'request_understanding',
    operationId: 'op-1',
    operationRef: OPERATION,
    requestRoot: root,
    goals: [GOAL],
    pointers: [{ goalRef: GOAL, pointer: POINTER, revision: 4 }],
    checkedRound: RUN_REF,
    generation: 3,
    state: 'live',
  };
  const withCommand = (value: unknown): QueryJobSnapshot => ({
    ...requestJob(), job: { ...requestJob().job, understanding: value as RequestUnderstandingCommandV1 | null },
  });

  it('decodes a Job without the understanding field as null (its historical value)', () => {
    const encoded = encodeQueryJobSnapshot(requestJob());
    const body = JSON.parse(encoded.json) as { job: Record<string, unknown> };
    delete body.job['understanding'];
    expect(decodeQueryJobSnapshot({ ...encoded, json: JSON.stringify(body) }))
      .toEqual({ status: 'decoded', value: requestJob() });
  });

  it('maps the old shape once and a later encode writes only the new shape', () => {
    const decoded = decodeQueryJobSnapshot(encodeQueryJobSnapshot(withCommand(OLD_COMMAND)));
    expect(decoded).toEqual({ status: 'decoded', value: withCommand(COMMAND) });
    if (decoded.status !== 'decoded') return;
    const stored = JSON.parse(encodeQueryJobSnapshot(decoded.value).json) as { job: { understanding: unknown } };
    expect(stored.job.understanding).toEqual(COMMAND);
    expect(stored.job.understanding).not.toHaveProperty('pointers');
    expect(stored.job.understanding).not.toHaveProperty('operationRef');
  });

  it.each([
    ['an unknown key', { ...COMMAND, extra: true }],
    ['an unknown state', { ...COMMAND, state: 'paused' }],
    ['an operation that is not a CoreOperation ref', { ...COMMAND, operation: { ...OPERATION, aggregateType: 'Goal' } }],
    ['a goal entry without its pointer revision', { ...COMMAND, goals: [{ goalRef: GOAL, pointer: POINTER }] }],
  ] as [string, unknown][])('rejects a stored understanding command with %s', (_label, value) => {
    const result = decodeQueryJobSnapshot(encodeQueryJobSnapshot(withCommand(value)));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('understanding');
  });
});

describe('the stored request manifest’s required fields', () => {
  const MATERIAL = {
    ref: root, revision: 1, runRef: RUN_REF, runRevision: 1, since: 'c0000000002', text: 'do the thing',
    selectedIdea: null, relatedCards: [], command: null,
  };
  const BASE = {
    requestRoot: root, round: MATERIAL, batch: [], preparationCursor: 'c0000000008',
    effectiveGoalId: null, executionKind: 'semantic_query',
  };
  const FACTS = { ...BASE, briefRef: null, understandingGrants: [] };
  const manifest = (request: unknown) => ({
    contextAssembly: { callKind: 'secretary' }, goal: null, focusPlan: null, request,
  });

  it.each([
    ['no briefRef', { ...BASE, understandingGrants: [] }],
    ['no understandingGrants', { ...BASE, briefRef: null }],
    ['a malformed briefRef', { ...FACTS, briefRef: { aggregateType: 'CoreOperation', projectId: P } }],
    ['a non-GoalRef understanding grant', { ...FACTS, understandingGrants: [{ aggregateType: 'Goal', projectId: P }] }],
  ])('refuses a stored manifest with %s', (_label, request) => {
    expect(queryManifestProblem(manifest(request))).not.toBeNull();
  });
});

describe('the derived index slots (§3.2)', () => {
  const samples = [
    { name: 'root request', job: requestJob(), slots: REQUEST_SLOTS },
    { name: 'follow-up', job: followupJob(), slots: NON_ROOT_REQUEST_SLOTS },
    { name: 'routing round', job: routingJob(), slots: NON_ROOT_REQUEST_SLOTS },
    { name: 'no-target request', job: noTargetRequestJob(), slots: NO_TARGET_REQUEST_SLOTS },
    { name: 'plain Query', job: nonRequestJob(), slots: NONE_SLOTS },
  ];

  it.each(samples)('writes the literal slots of a $name and decodes them back', ({ job, slots }) => {
    const encoded = encodeQueryJobSnapshot(job);
    expect(JSON.parse(encoded.json).slots).toEqual(slots);
    expect(decodeQueryJobSnapshot(encoded)).toEqual({ status: 'decoded', value: job });
  });

  it.each(['rootKey', 'requestMark', 'rootMark', 'goalSlot', 'enteredSlot'] as const)(
    'rejects a record whose %s slot disagrees with the Job',
    (slot) => {
      const encoded = encodeQueryJobSnapshot(requestJob());
      const body = JSON.parse(encoded.json) as { slots: Record<string, string> };
      body.slots[slot] = 'none';
      const result = decodeQueryJobSnapshot({ ...encoded, json: JSON.stringify(body) });
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') expect(result.reason).toContain('slots');
    },
  );
});

describe('rejects: a QueryJob record missing a required current-format field (decision 79)', () => {
  const withJobFieldRemoved = (field: string): ReturnType<typeof encodeQueryJobSnapshot> => {
    const encoded = encodeQueryJobSnapshot(requestJob());
    const body = JSON.parse(encoded.json) as { job: Record<string, unknown> };
    delete body.job[field];
    return { ...encoded, json: JSON.stringify(body) };
  };

  // §3.12: every one of the fourteen 6A Job fields is required (decision 79).
  it.each([
    'requestRoot', 'roundKind', 'requestGoalId', 'assignedSession', 'routing', 'relatedMessageRef',
    'absorbedInto', 'absorbedRounds', 'selectedIdea', 'goalAttribution', 'relatedCardRefs',
    'enteredSession', 'intakeSession', 'receipt',
  ] as const)('rejects a Job without %s and names that field', (field) => {
    const result = decodeQueryJobSnapshot(withJobFieldRemoved(field));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain(field);
  });

  it('rejects an illegal roundKind', () => {
    const job = nonRequestJob();
    const bogus = { ...job, job: { ...job.job, roundKind: 'bogus' } } as unknown as QueryJobSnapshot;
    const result = decodeQueryJobSnapshot(encodeQueryJobSnapshot(bogus));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('roundKind');
  });
});

describe('rejects: a related card ref that is not a complete VersionedRef (§3.12)', () => {
  const withCardRef = (cardRef: unknown): QueryJobSnapshot => {
    const job = nonRequestJob();
    return { ...job, job: { ...job.job, relatedCardRefs: [cardRef] } } as unknown as QueryJobSnapshot;
  };
  const decodeCardRef = (cardRef: unknown) => decodeQueryJobSnapshot(encodeQueryJobSnapshot(withCardRef(cardRef)));

  it('rejects a Goal ref missing only its projectId', () => {
    const result = decodeCardRef({ ref: { aggregateType: 'Goal', goalId: 'goal-1' }, revision: 1 });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.reason).toContain('relatedCardRefs');
      expect(result.reason).toContain('projectId');
    }
  });

  it('rejects a Goal ref missing only its goalId', () => {
    const result = decodeCardRef({ ref: { aggregateType: 'Goal', projectId: P }, revision: 1 });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.reason).toContain('relatedCardRefs');
      expect(result.reason).toContain('goalId');
    }
  });

  it('rejects an unknown aggregateType', () => {
    const result = decodeCardRef({ ref: { aggregateType: 'MysteryCard', projectId: P, goalId: 'goal-1' }, revision: 1 });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('relatedCardRefs');
  });

  it('rejects a non-positive revision', () => {
    const result = decodeCardRef({ ref: { aggregateType: 'Goal', projectId: P, goalId: 'goal-1' }, revision: 0 });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('relatedCardRefs');
  });
});

const withClose = (code: string, detail: unknown): QueryJobSnapshot => {
  const job = nonRequestJob();
  return { ...job, job: { ...job.job, status: 'closed', closeReason: { code, message: 'closed', detail } } as QueryJobSnapshot['job'] };
};

describe('QueryJob close codec (§3.1.8)', () => {
  it.each(['too_long', 'empty', 'protocol'] as const)(
    'keeps invalid_answer detail %s across the codec',
    (detail) => {
      const job = withClose('invalid_answer', detail);
      expect(decodeQueryJobSnapshot(encodeQueryJobSnapshot(job))).toEqual({ status: 'decoded', value: job });
    },
  );

  it.each([null, 'dropped', 'no_binding'] as const)(
    'keeps cancelled detail %s across the codec',
    (detail) => {
      const job = withClose('cancelled', detail);
      expect(decodeQueryJobSnapshot(encodeQueryJobSnapshot(job))).toEqual({ status: 'decoded', value: job });
    },
  );

  it.each(['timeout', 'gap', 'failed', 'stale_source', 'not_entered'] as const)(
    'keeps a null detail on close code %s',
    (code) => {
      const job = withClose(code, null);
      expect(decodeQueryJobSnapshot(encodeQueryJobSnapshot(job))).toEqual({ status: 'decoded', value: job });
    },
  );

  it('rejects a close reason without detail', () => {
    const job = withClose('cancelled', null);
    const encoded = encodeQueryJobSnapshot(job);
    const body = JSON.parse(encoded.json) as { job: { closeReason: Record<string, unknown> } };
    delete body.job.closeReason['detail'];
    const result = decodeQueryJobSnapshot({ ...encoded, json: JSON.stringify(body) });
    expect(result.status).toBe('invalid');
  });

  it('rejects an illegal close detail', () => {
    const result = decodeQueryJobSnapshot(encodeQueryJobSnapshot(withClose('invalid_answer', 'verbose')));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('closeReason.detail');
  });
});

describe('rejects: a close detail that does not belong to its close code (§3.1.8)', () => {
  it.each([
    ['invalid_answer', null],
    ['invalid_answer', 'dropped'],
    ['invalid_answer', 'no_binding'],
    ['failed', 'protocol'],
    ['cancelled', 'too_long'],
  ] as const)('rejects %s with detail %s', (code, detail) => {
    const result = decodeQueryJobSnapshot(encodeQueryJobSnapshot(withClose(code, detail)));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('closeReason.detail');
  });
});

describe('QueryJobAnswer current format (§3.1.7)', () => {
  it('round-trips ideas and goal card drafts', () => {
    const answer = answerJob();
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(answer))).toEqual({ status: 'decoded', value: answer });
  });

  it('rejects an answer without ideas', () => {
    const answer = answerJob();
    const body = JSON.parse(encodeQueryJobAnswerSnapshot(answer).json) as { answer: Record<string, unknown> };
    delete body.answer['ideas'];
    const result = decodeQueryJobAnswerSnapshot({ ...encodeQueryJobAnswerSnapshot(answer), json: JSON.stringify(body) });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('ideas');
  });

  it('rejects an answer without goalCardDrafts', () => {
    const answer = answerJob();
    const body = JSON.parse(encodeQueryJobAnswerSnapshot(answer).json) as { answer: Record<string, unknown> };
    delete body.answer['goalCardDrafts'];
    const result = decodeQueryJobAnswerSnapshot({ ...encodeQueryJobAnswerSnapshot(answer), json: JSON.stringify(body) });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('goalCardDrafts');
  });
});

describe('the 6A-1 index declarations (book §3.2)', () => {
  it('names the four indexes', () => {
    expect(QUERY_BY_REQUEST_INDEX).toBe('s6-query-by-request');
    expect(QUERY_OPEN_BY_WORKSPACE_INDEX).toBe('s6-query-open-by-workspace');
    expect(REQUEST_ROOTS_BY_GOAL_INDEX).toBe('s6-request-roots-by-goal');
    expect(QUERY_RAN_BY_SESSION_GOAL_INDEX).toBe('s6-query-ran-by-session-goal');
  });

  it('declares each equality path in order and orders by since', () => {
    const lookups = QUERY_JOB_RECORD_SCHEMAS.lookups ?? [];
    const expected = [
      { name: 's6-query-by-request', paths: ['ref.projectId', 'ref.workspaceId', 'slots.rootKey'] },
      { name: 's6-query-open-by-workspace', paths: ['ref.projectId', 'ref.workspaceId', 'slots.requestMark', 'job.status'] },
      { name: 's6-request-roots-by-goal', paths: ['ref.projectId', 'ref.workspaceId', 'slots.rootMark', 'slots.goalSlot'] },
      { name: 's6-query-ran-by-session-goal', paths: ['ref.projectId', 'ref.workspaceId', 'slots.enteredSlot', 'slots.goalSlot'] },
    ] as const;
    for (const entry of expected) {
      expect(lookups.find(lookup => lookup.name === entry.name)).toEqual({
        name: entry.name, aggregateType: 'QueryJob', paths: entry.paths, orderBy: { path: 'since' },
      });
    }
    const snapshot = QUERY_JOB_RECORD_SCHEMAS.records.find(record => record.schemaId === QUERY_JOB_SNAPSHOT_SCHEMA_ID);
    expect(snapshot?.commitCursorFields).toEqual(['since']);
  });
});
