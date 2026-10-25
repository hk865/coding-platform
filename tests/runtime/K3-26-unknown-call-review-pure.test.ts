/**
 * K3-26 pure record/card test (rework items 1 and 2): the combinations ONE real
 * serial Kernel Turn can never produce, as input -> output only.
 *
 * - the 32-item `too_many_calls` record and its four L18 options;
 * - an `incomplete/undecodable_call` record that nevertheless LISTS a 512-byte
 *   item: a listed call is decodable, so the real draft reader marks the Turn
 *   `undecodable_call` with NO item; one Turn cannot be both.
 *
 * Why this is not a stored scenario: the real serial Kernel runs a non-read-only
 * tool batch one call at a time and the §5.1 `shell` handler blocks the first
 * one, so a real Run records exactly ONE started call. A record committed to a
 * store and then read back would be a hand-written fact (K3 rework ledger,
 * "A name does not change what it is"). The platform's own constructor
 * (`newUnknownCallReview`), its strict codec and the pure card projection are
 * the input/output pair here: no store is opened, no Run is started and nothing
 * is committed. The real path for a listed 512-byte call lives in
 * `tests/work-graph/K3-26-unknown-call-review-storage.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type {
  UnknownCallReviewItemV1, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import { newUnknownCallReview } from '../../src/core/work-graph/state/unknown-call-review.js';
import {
  decodeUnknownCallReview, encodeUnknownCallReview,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { unknownCallReviewCardFacts, unknownCallReviewOptions } from '../../src/core/work-graph/tasks/unknown-call-review-card.js';

const PROJECT = 'P';
const GOAL = 'g1';
const WORKSPACE = 'W';
const TASK = 't1';
const AT = '2026-10-20T00:00:00.000Z';
const RUN_REF = { aggregateType: 'Run' as const, projectId: PROJECT, goalId: GOAL, runId: 'run-1234abcd' };

function processItem(alias: number): UnknownCallReviewItemV1 {
  const callId = `call-${String(alias)}`;
  return {
    alias, callId, toolName: 'shell', kind: 'process', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 'turn-1', callId,
      declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command: 'echo hi', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}

/** L7/L8: the maximum item count, `too_many_calls`, one item left out. */
function tooManyCallsRecord(): UnknownCallReviewV1 {
  const items = Array.from({ length: 32 }, (_, index) => processItem(index + 1));
  const built = newUnknownCallReview({
    ref: { aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: GOAL, runId: RUN_REF.runId },
    workspaceId: WORKSPACE, task: { projectId: PROJECT, goalId: GOAL, taskId: TASK }, runRef: RUN_REF,
    sessionRef: { projectId: PROJECT, sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: 'k3-26 pure' },
    inventory: 'incomplete', inventoryProblem: 'too_many_calls', items, itemsOmitted: 1,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured',
      detail: 'the pure K3-26 maximum test' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

describe('K3-26 pure 32-item too_many_calls record', () => {
  it('K3-26: the production constructor + codec keep all 32 aliases, itemsOmitted 1 and inventory_incomplete', () => {
    const record = tooManyCallsRecord();
    const encoded = encodeUnknownCallReview(record);
    expect(encoded.schemaId).toBe('UnknownCallReview@1');
    const decoded = decodeUnknownCallReview(encoded);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') throw new Error(decoded.reason);
    expect(decoded.value).toEqual(record);
    expect(decoded.value).toMatchObject({
      revision: 1, inventory: 'incomplete', inventoryProblem: 'too_many_calls', itemsOmitted: 1,
      status: 'needs_decision', open: 'yes', decisionReasons: ['inventory_incomplete'],
    });
    expect(decoded.value.items).toHaveLength(32);
    expect(decoded.value.items.map(item => item.alias))
      .toEqual(Array.from({ length: 32 }, (_, index) => index + 1));
    expect(decoded.value.items.every(item => item.kind === 'process')).toBe(true);
  });

  it('K3-26: the four L18 options follow from the decoded 32 process items', () => {
    const decoded = decodeUnknownCallReview(encodeUnknownCallReview(tooManyCallsRecord()));
    if (decoded.status !== 'decoded') throw new Error(decoded.reason);
    // The fixed L18 labels (spec line 66, the user's own words), as literals.
    expect(unknownCallReviewOptions(decoded.value)).toEqual([
      { id: 'rerun_as_is', label: '照原样重跑', effect: 'apply' },
      { id: 'safer_method', label: '换个稳妥的跑法再跑', effect: 'apply' },
      { id: 'skip_as_done', label: '跳过，当作已做', effect: 'apply' },
      { id: 'handle_myself', label: '我来处理', effect: 'apply' },
    ]);
  });
});

// -------------------------------------------------------------------------- //
// The inconsistent combination the real path cannot reach: `undecodable_call` //
// (a listed call is decodable) WITH the 512-byte call listed. Pure input.     //
// -------------------------------------------------------------------------- //

const CALL_ID_512 = 'y'.repeat(512);
const GOAL_SNAPSHOT: GoalSnapshot = {
  ref: { aggregateType: 'Goal', projectId: PROJECT, goalId: GOAL },
  workspaceRef: { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE },
  objective: 'K3-26 pure card', desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null,
  activePlanRevision: { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 'plan-1' }, revision: 4,
  settings: { schemaVersion: 1, autonomy: 'every_step', order: 0, waitForGoalRef: null, parallelRisks: [] },
  continuedFrom: null, copiedInterventions: [],
  since: 'c0000000001' as GoalSnapshot['since'],
};
const RUN = { ref: RUN_REF, revision: 3 } as unknown as RunSnapshot;

function listed512Item(): UnknownCallReviewItemV1 {
  const base = processItem(1);
  return { ...base, callId: CALL_ID_512, kernel: { ...base.kernel, callId: CALL_ID_512 } };
}

/** L8's inconsistent pair: inventoryProblem says the call is undecodable, yet the item is listed. */
function undecodableListedRecord(): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: { aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: GOAL, runId: RUN_REF.runId },
    workspaceId: WORKSPACE, task: { projectId: PROJECT, goalId: GOAL, taskId: TASK }, runRef: RUN_REF,
    sessionRef: { projectId: PROJECT, sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: 'k3-26 pure' },
    inventory: 'incomplete', inventoryProblem: 'undecodable_call', items: [listed512Item()], itemsOmitted: 0,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured',
      detail: 'the pure K3-26 512-listed test' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

describe('K3-26 pure undecodable_call record that lists a 512-byte call', () => {
  it('K3-26: the production constructor + codec keep the 512-byte item, itemsOmitted 0 and inventory_incomplete', () => {
    const record = undecodableListedRecord();
    expect(record).toMatchObject({
      revision: 1, inventory: 'incomplete', inventoryProblem: 'undecodable_call', itemsOmitted: 0,
      status: 'needs_decision', open: 'yes', decisionReasons: ['inventory_incomplete'],
    });
    expect(record.items).toHaveLength(1);
    expect(record.items[0]).toMatchObject({ alias: 1, callId: CALL_ID_512, toolName: 'shell', kind: 'process',
      contained: true, observed: { verdict: 'pending', by: null } });
    const decoded = decodeUnknownCallReview(encodeUnknownCallReview(record));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') throw new Error(decoded.reason);
    expect(decoded.value).toEqual(record);
  });

  it('K3-26: the pure card facts give it the aggregate object and the four L18 options', () => {
    const record = undecodableListedRecord();
    const facts = unknownCallReviewCardFacts({ record, goal: GOAL_SNAPSHOT, run: RUN, taskActive: true,
      fileDigests: new Map() });
    expect(facts.source.key).toBe(decisionSourceKey({ kind: 'unknown_call_review',
      reviewRef: record.ref, revision: record.revision }));
    expect(facts.source.pins).toHaveLength(3);
    expect(facts.source.pins[0]).toEqual({ ref: record.ref, revision: record.revision });
    expect(facts.revision).toBe(1);
    expect(facts.closedReason).toBeNull();
    // One aggregate object (the listed process item targets no file) and the
    // four fixed L18 options in order, exactly as the stored row asserted.
    expect(facts.objects).toEqual([{ kind: 'aggregate', pin: { ref: record.ref, revision: record.revision },
      label: `核对记录 ${RUN_REF.runId.slice(0, 8)}：需要你决定` }]);
    expect(facts.options).toEqual([
      { id: 'rerun_as_is', label: '照原样重跑', effect: 'apply' },
      { id: 'safer_method', label: '换个稳妥的跑法再跑', effect: 'apply' },
      { id: 'skip_as_done', label: '跳过，当作已做', effect: 'apply' },
      { id: 'handle_myself', label: '我来处理', effect: 'apply' },
    ]);
  });
});
