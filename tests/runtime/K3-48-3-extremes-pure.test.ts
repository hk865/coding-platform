/**
 * K3 row K3-48 (三): the pure capacity extremes (rework item 2). Input -> output
 * only: no store is opened, no Run is reconciled and no record is committed.
 *
 *   1. The 32-item L7 maximum, at the spec's fixed creation budget
 *      B = 158,720 bytes, built by the production `newUnknownCallReview` and
 *      round-tripped through `encodeUnknownCallReview` / `decodeUnknownCallReview`.
 *      The data and the limits below use the spec literals, never the exported
 *      constants, so a wrongly raised production constant cannot loosen them; a
 *      separate row asserts the exported constants still equal those literals.
 *      The real serial Kernel path can hold at most ONE process call that needs
 *      review, so this record is constructed input, never a reachable scenario
 *      state (coordinator-mode "Allowed — pure functions").
 *   2. The B-boundary write arithmetic the owner row cannot reach: the
 *      `settled` record (UCR-08c, review_unavailable) is strictly larger than B
 *      and `admitUnknownCallReview` admits it as a required write while refusing
 *      it as optional text; `hold_applied` (UCR-15, the 2,000-character text)
 *      and `hold_released` (UCR-14) stay under the absolute 512 KiB (524,288-byte)
 *      ceiling. The same transitions are exercised at the owner level on a
 *      reachable one-item record in
 *      `tests/work-graph/K3-48-3-required-writes.test.ts`.
 *   3. The L7 per-path cap: a draft path of 513 characters is accepted by the
 *      state machine but the production RECORD codec refuses it, which is the
 *      store-schema validation a real commit runs. The owner scenario has no
 *      constructed draft; this is the category-(a) validation input.
 *
 * The 32 items and the 200 changed paths / 32 `notVisible` entries come from
 * the existing pure input builder `tests/helpers/K3-padded-review-record.ts`.
 */
import { describe, expect, it } from 'vitest';
import type {
  UnknownCallReviewItemV1, UnknownCallReviewRef, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS, decodeUnknownCallReview, encodeUnknownCallReview,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES, UNKNOWN_CALL_REVIEW_MAX_BYTES,
  admitUnknownCallReview, newUnknownCallReview, transitionUnknownCallReview,
  type UnknownCallReviewContextV1,
} from '../../src/core/work-graph/state/unknown-call-review.js';
import {
  K3_PADDED_AT, k3PaddedCallIds, k3PaddedItems, k3PaddedWorkspace,
} from '../helpers/K3-padded-review-record.js';

const PROJECT = 'P';
const GOAL = 'g1';
const WORKSPACE = 'W';
const TASK = 't1';
const AT = '2026-10-20T00:00:00.000Z';

const REF: UnknownCallReviewRef = {
  aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: GOAL, runId: 'k3-48-3-pure-run',
};
const RUN_REF = {
  aggregateType: 'Run' as const, projectId: PROJECT, goalId: GOAL, runId: REF.runId,
};
const UNAVAILABLE_WORKSPACE: UnknownCallReviewV1['workspace'] = {
  status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'k3-48-3 pure',
};

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

function buildRecord(
  items: UnknownCallReviewItemV1[],
  workspace: UnknownCallReviewV1['workspace'] = UNAVAILABLE_WORKSPACE,
  originReason = 'k3-48-3 pure capacity input',
  createdAt = AT,
): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: REF, workspaceId: WORKSPACE,
    task: { projectId: PROJECT, goalId: GOAL, taskId: TASK },
    runRef: RUN_REF,
    sessionRef: { projectId: PROJECT, sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: originReason },
    inventory: 'complete', inventoryProblem: null,
    items, itemsOmitted: 0,
    workspace,
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

/**
 * The L7 capacity input: 32 codec-legal process items and the padded capture.
 * The helper's hand-computed skeleton assumes the real Run's identity fields;
 * these pure stub identities are 192 JSON bytes shorter, so the unbounded
 * `origin.reason` carries the difference and the record lands exactly on B.
 */
function paddedRecord(): UnknownCallReviewV1 {
  const items = k3PaddedItems(k3PaddedCallIds());
  const workspace = k3PaddedWorkspace();
  const reason = 'k3-48-3 pure capacity input';
  const base = buildRecord(items, workspace, reason, K3_PADDED_AT);
  const deficit = 158_720 - bytes(base);
  expect(deficit).toBeGreaterThan(0);
  const padded = buildRecord(items, workspace, reason + 'x'.repeat(deficit), K3_PADDED_AT);
  expect(bytes(padded)).toBe(158_720);
  return padded;
}

function context(
  expectedRevision: number, overrides: Partial<UnknownCallReviewContextV1> = {},
): UnknownCallReviewContextV1 {
  return {
    expectedRevision, updatedAt: AT, actor: { kind: 'human', id: 'operator' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false,
    reviewUnavailable: false, autonomy: 'after_plan_confirmation',
    incompleteCommandAliases: [], missingSelfCheckAliases: [], originalRunSelected: false,
    ...overrides,
  };
}

function expectCodecLegal(record: UnknownCallReviewV1): void {
  const decoded = decodeUnknownCallReview(encodeUnknownCallReview(record));
  expect(decoded).toEqual({ status: 'decoded', value: record });
}

describe('K3-48 (三) pure codec/state-machine: the 32-item creation budget', () => {
  it('K3-48 (三): the 32-item record is exactly B bytes and round-trips through the record codec', () => {
    const created = paddedRecord();
    expect(created.items).toHaveLength(32);
    expect(created.items.map(item => item.alias)).toEqual(
      Array.from({ length: 32 }, (_unused, index) => index + 1));
    expect(created.workspace.status).toBe('captured');
    if (created.workspace.status === 'captured') {
      expect(created.workspace.notVisible).toHaveLength(32);
    }
    expect(bytes(created)).toBe(158_720);
    expect(bytes(JSON.parse(encodeUnknownCallReview(created).json))).toBe(158_720);
    expectCodecLegal(created);
    // At B, both optional text and the L7 required writes are admitted.
    expect(admitUnknownCallReview(created, { required: false })).toBeNull();
    expect(admitUnknownCallReview(created, { required: true })).toBeNull();
  });

  it('K3-48 (三): every required write past B is admitted and stays under 512 KiB', () => {
    const created = paddedRecord();

    // UCR-08c: settlement without a round is a required write, so its bytes
    // beyond B are admitted.
    const settled = transitionUnknownCallReview(created, { kind: 'settled' },
      context(created.revision, { reviewUnavailable: true }));
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    const decision = settled.next;
    expect(decision).toMatchObject({
      revision: 2, status: 'needs_decision', activeRound: null,
      decisionReasons: ['review_unavailable', 'undetermined', 'crash_undetermined'],
    });
    expect(bytes(decision)).toBeGreaterThan(158_720);
    expect(bytes(decision)).toBeLessThanOrEqual(524_288);
    expect(admitUnknownCallReview(decision, { required: true })).toBeNull();
    // The same record would be refused as optional model text.
    expect(admitUnknownCallReview(decision, { required: false }))
      .toMatchObject({ ok: false, code: 'capacity' });
    expectCodecLegal(decision);

    // UCR-15 with the L7 2,000-character text (three-byte characters).
    const text = '核'.repeat(2_000);
    const heldTransition = transitionUnknownCallReview(decision, {
      kind: 'hold_applied', answeredRevision: decision.revision, text,
    }, context(decision.revision));
    expect(heldTransition.ok).toBe(true);
    if (!heldTransition.ok) return;
    const held = heldTransition.next;
    expect(held).toMatchObject({
      revision: 3, status: 'resolved',
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held', text },
    });
    expect(bytes(held)).toBeLessThanOrEqual(524_288);
    expect(admitUnknownCallReview(held, { required: true })).toBeNull();
    expectCodecLegal(held);

    // UCR-14.
    const releasedTransition = transitionUnknownCallReview(held, { kind: 'hold_released' },
      context(held.revision));
    expect(releasedTransition.ok).toBe(true);
    if (!releasedTransition.ok) return;
    const released = releasedTransition.next;
    expect(released).toMatchObject({
      revision: 4, status: 'resolved',
      disposition: { choice: 'handle_myself', hold: 'released' },
    });
    expect(bytes(released)).toBeLessThanOrEqual(524_288);
    expect(admitUnknownCallReview(released, { required: true })).toBeNull();
    expectCodecLegal(released);
  });
});

describe('K3-48 (三) pure capacity: the exported constants are the spec literals', () => {
  it('K3-48 (三): the exported creation budget and record maximum are 158,720 / 524,288 bytes', () => {
    expect(UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES).toBe(158_720);
    expect(UNKNOWN_CALL_REVIEW_MAX_BYTES).toBe(524_288);
  });
});

describe('K3-48 (三) pure codec: the L7 per-path cap', () => {
  it('K3-48 (三): a 513-character draft path is refused by the production record codec', () => {
    const item = k3PaddedItems(['k3-48-3-call-1'])[0];
    if (item === undefined) throw new Error('the padded item is missing');
    const path = 'p'.repeat(513);
    const withLongPath: UnknownCallReviewItemV1 = {
      ...item,
      summary: { ...item.summary, command: 'echo hi', paths: [path], pathsOmitted: 0 },
    };
    // The state machine has no per-path guard; the refusal is the codec's (the
    // registered schema every real commit runs).
    const record = buildRecord([withLongPath]);
    expect(record.items[0]?.summary.paths).toEqual([path]);
    expect(bytes(record)).toBeLessThan(158_720);

    const encoded = encodeUnknownCallReview(record);
    const decoded = decodeUnknownCallReview(encoded);
    expect(decoded).toMatchObject({ status: 'invalid' });
    if (decoded.status === 'invalid') {
      expect(decoded.reason).toContain('review item 0.summary.paths must be at most 8 non-empty strings of at most 512 characters');
    }
    const schema = UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records[0];
    if (schema === undefined) throw new Error('the UnknownCallReview record schema is not registered');
    expect(schema.validate(encoded)).toMatchObject({
      status: 'invalid',
      reason: expect.stringContaining('review item 0.summary.paths'),
    });
  });
});
