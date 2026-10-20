/**
 * K3 row K3-26 (R4 owner, L7/L8/L9): the `UnknownCallReview` record storage and
 * read side.
 *
 * The strict `UnknownCallReview@1` snapshot codec is exercised directly; the
 * read owner is read back through the public read port (the same instance the
 * `unknown-call-reviews/read` route binds); the RUN-22 owner
 * (`resolveUnknownRun`) and the RUN-25 owner (`reconcileRun`) create their
 * record in the SAME commit. Every expected value is a literal from L8/L9;
 * nothing is read from the database to verify a record.
 *
 * The prior state every RUN-22 row needs — a Run that really ended
 * `outcome_unknown` with the Kernel's own recorded calls — is reached through
 * the shared real-Run harness: a public claim, the production preparation, the
 * Runtime start whose §5.1 `shell` call is held by the real serial Kernel, and
 * the platform's start-up RUN-20 assembly over that Turn. The successful
 * record/card rows go one step further through the SAME harness:
 * `createRecord`/`replayRecord` run the public RUN-22, whose draft reader is the
 * Host's own, so the test never builds a draft/classification the owner
 * accepts. A built draft is only the REFUSED input of a row (the over-512-byte
 * item, a kind that disagrees with L3, …). Combinations the real one-call Turn
 * cannot reach (an `undecodable_call` record that still lists a 512-byte item;
 * the 32-item `too_large` draft) are pure construction tests in
 * `tests/runtime/K3-26-unknown-call-review-pure.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type {
  UnknownCallInventoryProblemV1, UnknownCallReviewDraftV1, UnknownCallReviewItemV1, UnknownCallReviewV1,
  WorkspaceCaptureV1,
} from '../../src/contracts/unknown-call-review.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { SessionMappingProbe } from '../../src/core/agent-runtime/session-operations.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteRecordStore from '../../src/core/record-store/sqlite-record-store.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { newUnknownCallReview } from '../../src/core/work-graph/state/unknown-call-review.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readCanonicalTaskFacts, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import { leaseReleasedForContinuation } from '../../src/core/work-graph/state/review-lease.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import {
  decodeUnknownCallReview, encodeUnknownCallReview, unknownCallReviewRefKey,
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { decisionSourceKey, type DecisionOptionV1 } from '../../src/contracts/goal-decisions.js';
import {
  createDecisionReadModel, createUnknownCallReviewCardSource,
} from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import { blockedRecordWithClaim, requeueBlockedRecord } from '../helpers/B2-crr-world.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { GOAL_B, PLAN_B2, WORKSPACE_REVISION } from '../helpers/S5-decision-fixture.js';
import {
  claimK3ReviewRound, createK3PendingReview, endK3RunCompleted, openK3ReviewCardWorld,
  readK3Review, recordK3Conclusion, settleK3Review, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { openRealRunHarness, type K3_35RealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell` (the real blocked record's one call is held by it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const AT = '2026-10-20T00:00:00.000Z';
const REVIEW_SCHEMAS: RecordBackendSchemas = {
  records: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records,
    ...SESSION_MESSAGE_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records,
    ...COMPLETION_RECORD_SCHEMAS.records],
  events: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events,
    ...SESSION_MESSAGE_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
    ...COMPLETION_RECORD_SCHEMAS.events],
  lookups: [...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
    ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []), ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? []),
    ...(COMPLETION_RECORD_SCHEMAS.lookups ?? [])],
};

function sampleRecord(): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' },
    workspaceId: 'w',
    task: { projectId: 'p', goalId: 'g', taskId: 't' },
    runRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' },
    sessionRef: { projectId: 'p', sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'by hand' },
    inventory: 'complete', inventoryProblem: null, items: [], itemsOmitted: 0,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'test' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

function processItem(alias: number): UnknownCallReviewItemV1 {
  const callId = `call-${String(alias)}`;
  return {
    alias, callId, toolName: 'shell', kind: 'process', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command: 'echo hi', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}

/** The L3-ordered first item, with a chosen recorded callId. */
function itemWithCallId(callId: string): UnknownCallReviewItemV1 {
  const base = processItem(1);
  return { ...base, callId, kernel: { ...base.kernel, callId } };
}

const UNAVAILABLE_WORKSPACE: WorkspaceCaptureV1 = {
  status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'k3-26',
};

describe('K3-26 record codec', () => {
  it('K3-26: an UnknownCallReview@1 snapshot round-trips through the strict decoder', () => {
    const record = sampleRecord();
    const encoded = encodeUnknownCallReview(record);
    expect(encoded.schemaId).toBe('UnknownCallReview@1');
    expect(encoded.refKey).toBe(unknownCallReviewRefKey(record.ref));
    const decoded = decodeUnknownCallReview(encoded);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') throw new Error(decoded.reason);
    expect(decoded.value).toEqual(record);
  });

  it('K3-26: an unknown field, a bad revision or a mismatched key is invalid, never guessed', () => {
    const encoded = encodeUnknownCallReview(sampleRecord());
    const body = JSON.parse(encoded.json) as Record<string, unknown>;
    expect(decodeUnknownCallReview({ ...encoded, json: JSON.stringify({ ...body, extra: 1 }) }).status).toBe('invalid');
    expect(decodeUnknownCallReview({ ...encoded, revision: 2 }).status).toBe('invalid');
    expect(decodeUnknownCallReview({ ...encoded, refKey: 'other' }).status).toBe('invalid');
    expect(decodeUnknownCallReview({ ...encoded, schemaId: 'UnknownCallReview@2' }).status).toBe('invalid');
  });

  it.each(['memory', 'sqlite'] as const)('K3-26 (%s): the read port answers not_found for an absent key and invalid for a bad record', async kind => {
    const directory = kind === 'sqlite' ? await mkdtemp(join(tmpdir(), 'k3-26-read-')) : null;
    const backend = kind === 'memory'
      ? createInMemoryRecordBackend({ schemas: REVIEW_SCHEMAS })
      : sqliteRecordStore.createSqliteRecordBackend({ schemas: REVIEW_SCHEMAS, path: join(directory!, 'ledger.sqlite') });
    try {
      const ctx = {} as CoreCallContext;
      const ref = { aggregateType: 'UnknownCallReview' as const, projectId: 'p', goalId: 'g', runId: 'r' };
      expect(await createUnknownCallReviewService({ records: backend.records,
        now: () => AT, eventId: () => 'k3-26-read-absent' }).readReview(ctx, { ref }))
        .toEqual({ status: 'not_found' });
      // A store that hands back a tampered body is fail-closed: the reader
      // decodes strictly and never trusts the key.
      const encoded = encodeUnknownCallReview(sampleRecord());
      const tampered = { ...encoded, json: JSON.stringify({ ...sampleRecord(), revision: 9 }) };
      const wrapped = {
        ...backend.records,
        async readMany() {
          return { status: 'ready' as const, value: { records: [tampered], missing: [], readThrough: null } };
        },
      };
      expect(await createUnknownCallReviewService({ records: wrapped,
        now: () => AT, eventId: () => 'k3-26-read-tampered' }).readReview(ctx, { ref }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
      if (directory !== null) await rm(directory, { recursive: true, force: true });
    }
  });
});

// --------------------------------------------------------------------------
// Owner-level RUN-22 (memory and SQLite): the precondition is the real RUN-20
// --------------------------------------------------------------------------

/** Anything the shared `afterEach` must close (and un-block) at the end of a row. */
type Closeable = { close(): Promise<void> };

type ReviewWorldFixture = {
  world: K3ReviewCardWorld;
  harness: K3_35RealRunHarness;
  reconcile: ReturnType<typeof createRunReconcileService>;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  /** Runs whose §5.1 shell is still held; `close` releases and awaits them first. */
  pending: Array<() => Promise<void>>;
  close(): Promise<void>;
};

/**
 * The owner services over the SAME shared world/records the real Host path
 * writes. The Host RUN-20 assembly is the fixture's `harness.reconcileUnknown`
 * (a lazily opened platform over `world.records`), never a test-built
 * classification.
 */
async function reviewWorldFixture(kind: 'memory' | 'sqlite'): Promise<ReviewWorldFixture> {
  const world = await openK3ReviewCardWorld(kind);
  const records = world.records;
  const reads = createRunStateReader({ records });
  let seq = 0;
  const reconcile = createRunReconcileService({ records, reads,
    hostInstance: { hostInstanceId: 'k3-26-host', lease: 'owned',
      takeover: { kind: 'hl03_stale_lock', previousInstanceId: 'previous-host', previousPid: 42 } },
    now: () => AT, eventId: () => `k3-26-event-${String(++seq)}` });
  const reviews = createUnknownCallReviewService({ records, reads,
    readReviewDisplays: async () => ({ status: 'ready', value: new Map([[1, 'full']]) }),
    now: () => AT, eventId: () => `k3-26-review-event-${String(++seq)}` });
  const harness = await openRealRunHarness(world);
  const pending: Array<() => Promise<void>> = [];
  return { world, harness, reconcile, reviews, pending,
    async close() {
      shellSeam.release();
      for (const release of pending.splice(0)) await release();
      await harness.closeUnion();
      await world.close();
    } };
}

type PendingUnknown = { claim: TaskClaim; run: RunSnapshot; release(): Promise<void> };

/**
 * The real Host RUN-20 precondition: the shared harness claims/prepares/starts
 * ONE Run whose scripted model declares the one started `shell` call; §5.1
 * holds it and the platform's start-up assembly classifies the in-flight Turn
 * (`tool_calls_unresolved` with the Kernel's recorded callId), or — with a
 * fault-injected explicit probe — `kernel_unreadable`. The shell stays held
 * until the row's `resolveUnknownRun` has run: releasing it first would let the
 * Runtime record the result and move the Run revision under the attestation.
 */
async function unknownRun(
  f: ReviewWorldFixture, label: string,
  options: { callId: string; command?: string; probe?: SessionMappingProbe },
): Promise<PendingUnknown> {
  const sessionRef = await f.world.fixture.createS5Session(`${label}-session`);
  const claim = await f.harness.claimRun({ sessionRef, planRef: PLAN_B2, taskId: 'k3-20-a',
    requestId: `${label}-claim` });
  const started = await f.harness.prepareAndStart(claim, {
    model: createScriptedModel([{ kind: 'calls', calls: [{ callId: options.callId, name: 'shell',
      args: { command: options.command ?? `echo ${label}` } }] }]),
    tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
  });
  const release = async (): Promise<void> => {
    shellSeam.release();
    await started.started.catch(() => undefined);
  };
  f.pending.push(release);
  const unknown = await f.harness.reconcileUnknown(claim,
    options.probe === undefined ? {} : { probe: options.probe });
  // The precondition really is a Run the platform ended `outcome_unknown`.
  if (unknown.status !== 'ended' || unknown.outcome !== 'outcome_unknown') {
    throw new Error(`the RUN-20 precondition must end outcome_unknown: ${JSON.stringify({
      status: unknown.status, outcome: unknown.outcome })}`);
  }
  return { claim, run: unknown, release };
}

/**
 * The platform's real recognition path for a recorded callId: `createRecord` is
 * RUN-20 then the public RUN-22, whose draft reader is the Host's own. No draft,
 * item or event is assembled here; the §5.1 shell is released only after the
 * public RUN-22 has committed.
 */
async function hostRecord(
  f: ReviewWorldFixture, label: string,
  options: { callId: string; command?: string; replayRequestId?: string },
): Promise<{
  claim: TaskClaim; record: UnknownCallReviewV1;
  replay?: Awaited<ReturnType<K3_35RealRunHarness['replayRecord']>>;
}> {
  const sessionRef = await f.world.fixture.createS5Session(`${label}-session`);
  const claim = await f.harness.claimRun({ sessionRef, planRef: PLAN_B2, taskId: 'k3-20-a',
    requestId: `${label}-claim` });
  const started = await f.harness.prepareAndStart(claim, {
    model: createScriptedModel([{ kind: 'calls', calls: [{ callId: options.callId, name: 'shell',
      args: { command: options.command ?? `echo ${label}` } }] }]),
    tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
  });
  try {
    if (options.replayRequestId !== undefined) {
      const replayed = await f.harness.replayRecord(claim, { requestId: options.replayRequestId });
      return { claim, record: replayed.record, replay: replayed };
    }
    const record = await f.harness.createRecord(claim);
    return { claim, record };
  } finally {
    shellSeam.release();
    await started.started.catch(() => undefined);
  }
}

/** RUN-20(ii): the Kernel is unreadable, so the Run ends `outcome_unknown`. */
async function unknownKernelUnreadable(f: ReviewWorldFixture, label: string): Promise<PendingUnknown> {
  return unknownRun(f, label, { callId: `${label}-call`,
    probe: { verdict: 'damaged', activeRunId: null, reason: 'the K3-26 Kernel is unreadable' } });
}

function draftOf(inventory: 'complete' | 'incomplete', problem: UnknownCallInventoryProblemV1 | null,
  items: UnknownCallReviewItemV1[], itemsOmitted: number): UnknownCallReviewDraftV1 {
  return { inventory, inventoryProblem: problem, items, itemsOmitted, workspace: UNAVAILABLE_WORKSPACE };
}

// --------------------------------------------------------------------------
// K3-26 (七)(八)(九): the same owner store, read through the real decision read
// model + the `unknown_call_review` card source (the production composition).
// --------------------------------------------------------------------------

const FOUR_OPTIONS: readonly DecisionOptionV1[] = [
  { id: 'rerun_as_is', label: '照原样重跑', effect: 'apply' },
  { id: 'safer_method', label: '换个稳妥的跑法再跑', effect: 'apply' },
  { id: 'skip_as_done', label: '跳过，当作已做', effect: 'apply' },
  { id: 'handle_myself', label: '我来处理', effect: 'apply' },
];
const THREE_OPTIONS: readonly DecisionOptionV1[] = [FOUR_OPTIONS[0]!, FOUR_OPTIONS[2]!, FOUR_OPTIONS[3]!];

/** The literal L18 summary of the record's one aggregate object. */
function summaryOf(record: UnknownCallReviewV1): string {
  return `核对记录 ${record.runRef.runId.slice(0, 8)}：需要你决定`;
}

/** The real card source + read model over the SAME owner records. */
function cardReads(f: ReviewWorldFixture) {
  const records = f.world.records;
  const cardSource = createUnknownCallReviewCardSource({ records, reviews: f.reviews });
  return createDecisionReadModel({ records, cardSources: [cardSource], noticeSources: [],
    conflicts: createGoalConflictAssembler({ records,
      catalog: createArchitectureCatalogService({ records }),
      executedFiles: createGoalExecutedFilesReader({ records }) }),
    positions: createNoticePositionComparator(), displayTokens: createNoticeDisplayToken(new Uint8Array(32)) });
}

/** The queue's review cards, filtered from the real read model. */
async function reviewCards(f: ReviewWorldFixture) {
  const readModel = cardReads(f);
  const read = await readModel.queryDecisionQueue(f.world.fixture.ctx, { workspace: f.world.fixture.base.scope,
    sections: ['waiting_answer', 'history'], page: { limit: 100 } });
  if (read.status !== 'ready') throw new Error(`the decision queue read failed: ${JSON.stringify(read)}`);
  return { readModel, cards: read.value.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review') };
}

/** K3-26 card assertions shared by (七)(八)(九): one card, the record pin, options. */
async function expectReviewCard(f: ReviewWorldFixture, record: UnknownCallReviewV1,
  options: readonly DecisionOptionV1[]): Promise<void> {
  const { readModel, cards } = await reviewCards(f);
  expect(cards).toHaveLength(1);
  const card = cards[0]!;
  expect(card.source.key).toBe(decisionSourceKey({ kind: 'unknown_call_review',
    reviewRef: record.ref, revision: record.revision }));
  expect(card.state).toBe('waiting_answer');
  expect(card.source.pins).toHaveLength(3);
  expect(card.source.pins[0]).toEqual({ ref: record.ref, revision: record.revision });
  // The record object is the card's one object here (the workspace was unavailable).
  expect(card.objects).toEqual([{ kind: 'aggregate',
    pin: { ref: record.ref, revision: record.revision }, label: summaryOf(record) }]);
  expect(card.options).toEqual(options);
  expect(card.closedReason).toBeNull();
  expect(card.readOnly).toBe(false);
  expect(card.actions).toEqual(['answer']);
  const byKey = await readModel.readDecisionCard(f.world.fixture.ctx, { source: card.source });
  expect(byKey).toMatchObject({ status: 'ready', value: { state: 'waiting_answer',
    source: { kind: 'unknown_call_review', key: card.source.key },
    options: [...options], closedReason: null, readOnly: false, actions: ['answer'] } });
  if (byKey.status !== 'ready') throw new Error('the card must read by its source key');
  expect(byKey.value.source.pins).toHaveLength(3);
  expect(byKey.value.source.pins[0]).toEqual({ ref: record.ref, revision: record.revision });
}

const fixtures: Closeable[] = [];
afterEach(async () => { shellSeam.release(); for (const fixture of fixtures.splice(0)) await fixture.close(); });

describe('K3-26 owner resolveUnknownRun', () => {
  it.each(['memory', 'sqlite'] as const)('K3-26 (七) %s: a complete draft with 33 items is over the 32-item limit and writes nothing', async kind => {
    const f = await reviewWorldFixture(kind);
    fixtures.push(f);
    const u = await unknownKernelUnreadable(f, `k3-26-complete-${kind}`);
    const items = Array.from({ length: 33 }, (_, index) => processItem(index + 1));
    const result = await f.reconcile.resolveUnknownRun(f.world.fixture.ctx, { input: {
      runRef: u.claim.runRef, reason: 'checked by hand', kernelTurnOpen: false, inputsConfirmed: true,
      review: draftOf('complete', null, items, 0) },
      meta: { requestId: `k3-26-complete-${kind}`, expected: [{ ref: u.claim.runRef, revision: u.run.revision }] } });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.reviews.readReview(f.world.fixture.ctx, { runRef: u.claim.runRef })).toEqual({ status: 'not_found' });
    await u.release();
  });

  it.each(['memory', 'sqlite'] as const)('K3-26 (八) %s: an undecodable_call draft is needs_decision', async kind => {
    const f = await reviewWorldFixture(kind);
    fixtures.push(f);
    // The Kernel really recorded a 513-byte callId. The Host's own draft reader
    // cannot list it, so the public RUN-22 attests `incomplete/undecodable_call`
    // with no items: the draft is read, never built. The replay call below uses
    // the same public RUN-22 request identity the first attestation committed.
    const { claim, record, replay } = await hostRecord(f, `k3-26-undecodable-${kind}`, {
      callId: 'x'.repeat(513), replayRequestId: `k3-26-undecodable-${kind}`,
    });
    expect(record).toMatchObject({ inventory: 'incomplete', inventoryProblem: 'undecodable_call',
      status: 'needs_decision', decisionReasons: ['inventory_incomplete'] });
    // (八) card: no items -> no proposalTargets -> the three L18 options.
    await expectReviewCard(f, record, THREE_OPTIONS);
    // Both spellings name the same aggregate key.
    expect(await f.reviews.readReview(f.world.fixture.ctx, { ref: { aggregateType: 'UnknownCallReview',
      projectId: claim.runRef.projectId, goalId: claim.runRef.goalId, runId: claim.runRef.runId } }))
      .toEqual({ status: 'ready', value: record });
    // L8/A8: the receipt is resolved before the pins/state are compared, so the
    // same request replays even though the first attestation moved the Run.
    if (replay === undefined) throw new Error('the RUN-22 replay result is missing');
    expect(replay.replay).toEqual({ ...replay.first, replayed: true });
  });

  it.each(['memory', 'sqlite'] as const)('K3-26 (九) %s: the real draft of a 513-byte recorded callId is undecodable_call and the id is nowhere', async kind => {
    const f = await reviewWorldFixture(kind);
    fixtures.push(f);
    const long = 'x'.repeat(513);
    // The Kernel really recorded this 513-byte id (the started call). The Host's
    // own draft reader cannot list it (L7/L8), so RUN-22 attests
    // `incomplete/undecodable_call` with no item — no draft is built here.
    const { record } = await hostRecord(f, `k3-26-undecodable-long-${kind}`, { callId: long });
    expect(record).toMatchObject({ revision: 1, inventory: 'incomplete', inventoryProblem: 'undecodable_call',
      itemsOmitted: 0, status: 'needs_decision', decisionReasons: ['inventory_incomplete'] });
    expect(record.items).toEqual([]);
    // The over-long callId is in neither the record nor the card (L7/L8, L18).
    expect(JSON.stringify(record)).not.toContain(long);
    const before = await reviewCards(f);
    expect(JSON.stringify(before.cards)).not.toContain(long);
    await expectReviewCard(f, record, THREE_OPTIONS);
  });

  it.each(['memory', 'sqlite'] as const)('K3-26 (八) %s: an item kind that disagrees with L3 is invalid and writes nothing', async kind => {
    const f = await reviewWorldFixture(kind);
    fixtures.push(f);
    const u = await unknownKernelUnreadable(f, `k3-26-kind-${kind}`);
    const wrong = { ...processItem(1), kind: 'read_only' as const };
    const result = await f.reconcile.resolveUnknownRun(f.world.fixture.ctx, { input: {
      runRef: u.claim.runRef, reason: 'checked by hand', kernelTurnOpen: false, inputsConfirmed: true,
      review: draftOf('complete', null, [wrong], 0) },
      meta: { requestId: `k3-26-kind-${kind}`, expected: [{ ref: u.claim.runRef, revision: u.run.revision }] } });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.reviews.readReview(f.world.fixture.ctx, { runRef: u.claim.runRef })).toEqual({ status: 'not_found' });
    await u.release();
  });

  it.each(['memory', 'sqlite'] as const)('K3-26 (六) %s: a complete inventory when the Kernel was unreadable at stop is invalid', async kind => {
    const f = await reviewWorldFixture(kind);
    fixtures.push(f);
    const u = await unknownKernelUnreadable(f, `k3-26-unreadable-complete-${kind}`);
    const result = await f.reconcile.resolveUnknownRun(f.world.fixture.ctx, { input: {
      runRef: u.claim.runRef, reason: 'checked by hand', kernelTurnOpen: false, inputsConfirmed: true,
      review: draftOf('complete', null, [], 0) },
      meta: { requestId: `k3-26-unreadable-complete-${kind}`,
        expected: [{ ref: u.claim.runRef, revision: u.run.revision }] } });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.reviews.readReview(f.world.fixture.ctx, { runRef: u.claim.runRef })).toEqual({ status: 'not_found' });
    await u.release();
  });

  it.each(['memory', 'sqlite'] as const)('K3-26 (六) %s: a complete inventory missing a recorded unresolved call is invalid', async kind => {
    const f = await reviewWorldFixture(kind);
    fixtures.push(f);
    const u = await unknownRun(f, `k3-26-recorded-missing-${kind}`, { callId: 'call-1' });
    const result = await f.reconcile.resolveUnknownRun(f.world.fixture.ctx, { input: {
      runRef: u.claim.runRef, reason: 'checked by hand', kernelTurnOpen: false, inputsConfirmed: true,
      review: draftOf('complete', null, [itemWithCallId('call-2')], 0) },
      meta: { requestId: `k3-26-recorded-missing-${kind}`,
        expected: [{ ref: u.claim.runRef, revision: u.run.revision }] } });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.reviews.readReview(f.world.fixture.ctx, { runRef: u.claim.runRef })).toEqual({ status: 'not_found' });
    await u.release();
  });

  it.each(['memory', 'sqlite'] as const)('K3-26 (六) %s: a too_large inventory lists recorded calls and counts the rest in itemsOmitted', async kind => {
    const f = await reviewWorldFixture(kind);
    fixtures.push(f);
    // The real serial Kernel started exactly the one blocked shell call.
    const u = await unknownRun(f, `k3-26-toolarge-${kind}`, { callId: 'call-1' });
    const notRecorded = await f.reconcile.resolveUnknownRun(f.world.fixture.ctx, { input: {
      runRef: u.claim.runRef, reason: 'checked by hand', kernelTurnOpen: false, inputsConfirmed: true,
      // The only error this input proves is the unrecorded call-9: a wrong
      // itemsOmitted would be a SECOND error and could mask it.
      review: draftOf('incomplete', 'too_large', [itemWithCallId('call-9')], 0) },
      meta: { requestId: `k3-26-toolarge-item-${kind}`,
        expected: [{ ref: u.claim.runRef, revision: u.run.revision }] } });
    expect(notRecorded).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.reviews.readReview(f.world.fixture.ctx, { runRef: u.claim.runRef })).toEqual({ status: 'not_found' });

    const wrongCount = await f.reconcile.resolveUnknownRun(f.world.fixture.ctx, { input: {
      runRef: u.claim.runRef, reason: 'checked by hand', kernelTurnOpen: false, inputsConfirmed: true,
      review: draftOf('incomplete', 'too_large', [processItem(1)], 1) },
      meta: { requestId: `k3-26-toolarge-count-${kind}`,
        expected: [{ ref: u.claim.runRef, revision: u.run.revision }] } });
    expect(wrongCount).toMatchObject({ status: 'rejected', code: 'invalid' });
    await u.release();
  });

  it.each(['memory', 'sqlite'] as const)('K3-26 (九) %s: a draft item callId over 512 bytes is invalid and writes nothing', async kind => {
    const f = await reviewWorldFixture(kind);
    fixtures.push(f);
    const long = 'x'.repeat(513);
    const exactly = 'y'.repeat(512);
    // (a) The over-long item is the REFUSED input; the Run and its one recorded
    // call are real (exactly 512 bytes), reached through the shared public steps.
    const u = await unknownRun(f, `k3-26-callid-${kind}`, { callId: exactly });
    const pin = [{ ref: u.claim.runRef, revision: u.run.revision }];
    const base = processItem(1);
    const oversize: UnknownCallReviewItemV1 = { ...base, callId: long, kernel: { ...base.kernel, callId: long } };
    expect(await f.reconcile.resolveUnknownRun(f.world.fixture.ctx, { input: { runRef: u.claim.runRef, reason: 'x',
      kernelTurnOpen: false, inputsConfirmed: true, review: draftOf('complete', null, [oversize], 0) },
      meta: { requestId: `k3-26-callid-long-${kind}`, expected: pin } }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await f.reviews.readReview(f.world.fixture.ctx, { runRef: u.claim.runRef })).toEqual({ status: 'not_found' });
    await u.release();
  });

  it.each(['memory', 'sqlite'] as const)('K3-26 (九) %s: a real 512-byte callId is listed by the Host draft', async kind => {
    const f = await reviewWorldFixture(kind);
    fixtures.push(f);
    const exactly = 'y'.repeat(512);
    // The 512-byte path IS reachable: the id is decodable, so the Host's own
    // draft lists the real recorded call and the public RUN-22 commits it.
    const { record } = await hostRecord(f, `k3-26-callid-listed-${kind}`, { callId: exactly });
    expect(record).toMatchObject({ inventory: 'complete', inventoryProblem: null, status: 'pending_review',
      items: [{ alias: 1, callId: exactly, toolName: 'shell', kind: 'process', contained: true }] });
    expect(Buffer.byteLength(record.items[0]!.callId, 'utf8')).toBe(512);
  });
});

// --------------------------------------------------------------------------
// Owner-level RUN-25 (memory and SQLite): a REAL entered Run + the Host's own
// takeover classification over the real Kernel Turn. The takeover proof is a
// Host input; no record, item, event or entered fact is written by the test.
// --------------------------------------------------------------------------

const TAKEOVER = { kind: 'hl03_stale_lock', previousInstanceId: 'previous-host', previousPid: 42 } as const;

type OwnerFixture = {
  world: K3ReviewCardWorld;
  harness: K3_35RealRunHarness;
  reconcile: ReturnType<typeof createRunReconcileService>;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  close(): Promise<void>;
};

async function ownerFixture(kind: 'memory' | 'sqlite'): Promise<OwnerFixture> {
  const world = await openK3ReviewCardWorld(kind);
  // RUN-25 records a real run-start baseline and captures the work tree, so the
  // world's temp root is the real git work-tree top level (the platform still
  // produces the baseline and the capture itself).
  const harness = await openRealRunHarness(world, { gitWorkspace: true, takeover: TAKEOVER });
  const records = world.records;
  const reads = createRunStateReader({ records });
  let seq = 0;
  const reconcile = createRunReconcileService({ records, reads,
    hostInstance: { hostInstanceId: 'k3-26-host', lease: 'owned', takeover: TAKEOVER },
    now: () => AT, eventId: () => `k3-26-event-${String(++seq)}` });
  return { world, harness, reconcile, reviews: world.reviews,
    async close() {
      shellSeam.release();
      await harness.closeUnion();
      await world.close();
    } };
}

/** The REAL entered Run: public claim → production prepare → Runtime start holding §5.1's shell. */
async function startedUnknownRun(f: OwnerFixture, label: string, callId: string) {
  const sessionRef = await f.world.fixture.createS5Session(`${label}-session`);
  const claim = await f.harness.claimRun({ sessionRef, planRef: PLAN_B2, taskId: 'k3-20-a',
    requestId: `${label}-claim` });
  const started = await f.harness.prepareAndStart(claim, {
    model: createScriptedModel([{ kind: 'calls', calls: [{
      callId, name: 'shell', args: { command: `echo ${label}` } }] }]),
    tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
    // RUN-25 needs the Host's run-start baseline in the prepared manifest.
    prepareViaRuntime: true,
  });
  return { claim, started };
}

async function releaseStarted(
  started: Awaited<ReturnType<K3_35RealRunHarness['prepareAndStart']>>['started'],
): Promise<void> {
  shellSeam.release();
  await started.catch(() => undefined);
}

/**
 * F-041 fault injection: fail ONE RUN-25 commit (the batch that creates the
 * review record) and delegate every later commit unchanged. A memory platform
 * shares `world.records`, so wrapping that port is enough; a SQLite platform
 * opens its own backend, so the factory is wrapped for the one
 * `createTargetPlatform` call the platform makes (the same shape
 * `openRealRunHarness` uses for the memory factory).
 */
function failNextRun25Commit(kind: 'memory' | 'sqlite', world: K3ReviewCardWorld, reason: string): {
  used(): boolean; restore(): void;
} {
  let armed = true;
  let used = false;
  const isRun25 = (batch: Parameters<K3ReviewCardWorld['records']['commit']>[0]): boolean =>
    batch.records.some(record => record.schemaId === 'UnknownCallReview@1');
  const fail = (): { status: 'rejected'; code: 'unavailable'; reason: string } => {
    armed = false;
    used = true;
    return { status: 'rejected', code: 'unavailable', reason };
  };
  if (kind === 'memory') {
    const original = world.records.commit.bind(world.records);
    const spy = vi.spyOn(world.records, 'commit').mockImplementation(async batch =>
      (armed && isRun25(batch) ? fail() : original(batch)));
    return { used: () => used, restore: () => spy.mockRestore() };
  }
  const original = sqliteRecordStore.createSqliteRecordBackend;
  const spy = vi.spyOn(sqliteRecordStore, 'createSqliteRecordBackend').mockImplementation((options) => {
    const backend = original(options);
    return {
      ...backend,
      records: {
        ...backend.records,
        async commit(batch) {
          return armed && isRun25(batch) ? fail() : backend.records.commit(batch);
        },
      },
    } as ReturnType<typeof original>;
  });
  return { used: () => used, restore: () => spy.mockRestore() };
}

describe('K3-26 owner reconcileRun', () => {
  it.each(['memory', 'sqlite'] as const)('K3-26: RUN-25 creates the review record in the same commit and reads back', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const { claim, started } = await startedUnknownRun(f, `k3-26-run25-${kind}`, 'call-1');
    try {
      // The Host's own start-up classification, with the takeover proof as its
      // input, ends the Run crashed and writes the review record in that commit.
      const run = await f.harness.reconcileUnknown(claim, { takeover: TAKEOVER });
      expect(run, JSON.stringify(run)).toMatchObject({ status: 'ended', outcome: 'crashed' });
      const read = await f.reviews.readReview(f.world.fixture.ctx, { runRef: claim.runRef });
      expect(read, JSON.stringify(read)).toMatchObject({ status: 'ready', value: {
        schemaVersion: 1, revision: 1, inventory: 'complete', inventoryProblem: null,
        status: 'pending_review', open: 'yes', decisionReasons: [],
        origin: { kind: 'takeover_unresolved', hostInstanceId: 'k3-35-platform-host', proof: TAKEOVER },
        workspace: { status: 'captured', runBaselineKnown: true },
        items: [{ alias: 1, callId: 'call-1', toolName: 'shell', kind: 'process', contained: true,
          observed: { verdict: 'pending', by: null } }],
      } });
      if (read.status !== 'ready') throw new Error('the RUN-25 record must be readable');
      // The Run end and the record are the SAME commit's facts.
      const execution = await createRunStateReader({ records: f.world.records })
        .readExecution(f.world.fixture.ctx, claim.runRef);
      expect(execution).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'crashed',
        reconciliation: { observation: { kind: 'takeover_unresolved', proof: TAKEOVER,
          reviewRef: read.value.ref } } } } });
    } finally {
      await releaseStarted(started.started);
    }
  });

  it.each(['memory', 'sqlite'] as const)('K3-26: one injected failure on RUN-25\'s single commit leaves no partial Run end or review record; the retry writes both together', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const { claim, started } = await startedUnknownRun(f, `k3-26-run25-fault-${kind}`, 'call-1');
    const reads = createRunStateReader({ records: f.world.records });
    const failure = failNextRun25Commit(kind, f.world, `injected RUN-25 commit failure (${kind})`);
    try {
      const before = await reads.readExecution(f.world.fixture.ctx, claim.runRef);
      if (before.status !== 'ready') throw new Error('the in-flight Run must read');
      // The one RUN-25 commit fails. Its batch is the Run end plus the review
      // record; nothing of it may become durable.
      await expect(f.harness.reconcileUnknown(claim, { takeover: TAKEOVER }))
        .rejects.toThrow(/the record's RUN-20 did not book the blocked call/);
      expect(failure.used(), 'the injected failure hit the RUN-25 commit').toBe(true);
      expect(await f.reviews.readReview(f.world.fixture.ctx, { runRef: claim.runRef })).toEqual({ status: 'not_found' });
      const afterFailure = await reads.readExecution(f.world.fixture.ctx, claim.runRef);
      expect(afterFailure).toEqual(before);
      expect(afterFailure).toMatchObject({ status: 'ready', value: { run: { status: 'running', outcome: null } } });

      // The retry commits the Run end and the review record together.
      const run = await f.harness.reconcileUnknown(claim, { takeover: TAKEOVER });
      expect(run).toMatchObject({ status: 'ended', outcome: 'crashed' });
      const review = await f.reviews.readReview(f.world.fixture.ctx, { runRef: claim.runRef });
      expect(review).toMatchObject({ status: 'ready', value: { revision: 1, status: 'pending_review',
        origin: { kind: 'takeover_unresolved', proof: TAKEOVER } } });
      if (before.status !== 'ready' || review.status !== 'ready') throw new Error('the retry facts must read');
      const afterRetry = await reads.readExecution(f.world.fixture.ctx, claim.runRef);
      expect(afterRetry).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'crashed',
        revision: before.value.run.revision + 1,
        reconciliation: { observation: { reviewRef: review.value.ref } } } } });
    } finally {
      failure.restore();
      await releaseStarted(started.started);
    }
  });

  it.each(['memory', 'sqlite'] as const)('K3-47 (一) %s: the same RUN-25 request replays the original receipt; a moved revision is revision_conflict', async kind => {
    const f = await ownerFixture(kind);
    fixtures.push(f);
    const { claim, started } = await startedUnknownRun(f, `k3-47-run25-${kind}`, 'call-1');
    try {
      const { report, replayReport, run } = await f.harness.reconcileUnknownTwice(claim, { takeover: TAKEOVER });
      expect(report).toMatchObject({ status: 'reconciled', row: 'W-26', reason: 'takeover_unresolved',
        autoCleanup: { applied: true } });
      // The second call keeps the SAME pre-commit revision, so it can only be the
      // owner's recorded receipt; a fresh pin check would answer revision_conflict.
      expect(replayReport).toEqual(report);
      const before = await f.reviews.readReview(f.world.fixture.ctx, { runRef: claim.runRef });
      expect(before).toMatchObject({ status: 'ready', value: { revision: 1, status: 'pending_review' } });

      // The moved-revision half is the REFUSED input (a) over the real Run.
      const stale = await f.reconcile.reconcileRun(f.world.fixture.ctx, { input: {
        runRef: claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'k3-26-host' },
        probe: 'ready',
        result: { kind: 'unknown', cause: 'tool_calls_unresolved', unresolvedToolCallIds: ['call-1'],
          observedThroughPosition: 5,
          turn: { terminal: false, inFlightToolCallIds: ['call-1'], lastPosition: 5, kernelPaused: false,
            entered: null, acceptedSteers: [], inputsConfirmed: true } } },
        meta: { requestId: `k3-47-run25-stale-${kind}`,
          expected: [{ ref: claim.runRef, revision: run.revision + 5 }] } });
      expect(stale).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      // No record change and no second Run commit.
      expect(await f.reviews.readReview(f.world.fixture.ctx, { runRef: claim.runRef })).toEqual(before);
      const after = await createRunStateReader({ records: f.world.records })
        .readExecution(f.world.fixture.ctx, claim.runRef);
      expect(after).toMatchObject({ status: 'ready', value: { run: { revision: run.revision } } });
    } finally {
      await releaseStarted(started.started);
    }
  });
});

// --------------------------------------------------------------------------
// K3-47 (四): a review claim (TASK-03r / ATT-16r) really re-holds the lease
// --------------------------------------------------------------------------

/**
 * The real pending record plus its real public claim: the shared blocked-record
 * path (public claim → production preparation → Runtime start with §5.1's
 * held `shell` → the platform's RUN-20/RUN-22 over the real Kernel Turn). No
 * draft, item, event or record is built here.
 */
async function pendingRecordWithClaim(world: K3ReviewCardWorld, label: string) {
  const outcome = await blockedRecordWithClaim(world, 'k3-20-a', label,
    [{ callId: `${label}-call`, command: `echo ${label}` }], { dispose: false });
  expect(outcome.record).toMatchObject({ status: 'pending_review', revision: 1 });
  return outcome;
}

/** An ordinary claim request of the record's Task, like K3-47-claim-gate's. */
async function reviewClaimRequest(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1, requestId: string,
) {
  const base = world.fixture.b2.base;
  const ctx = world.fixture.ctx;
  const sessionRef = await world.fixture.createS5Session(`k3-47-4-session-${requestId}`);
  const goal = await base.plans.queryGoal(ctx, GOAL_B);
  if (goal.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(goal)}`);
  const session = await base.sessionsPort.readSession(ctx, sessionRef);
  if (session.status !== 'ready') throw new Error(`the Session is not readable: ${JSON.stringify(session)}`);
  return {
    input: { goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef,
      roleBinding: base.roleBinding, budget: base.budget,
      review: { reviewRef: record.ref, expectedRevision: record.revision, phase: 'review' as const } },
    meta: { requestId, expected: [
      { ref: GOAL_B, revision: goal.value.goal.revision },
      { ref: world.fixture.base.workspaceRef, revision: WORKSPACE_REVISION },
      { ref: plainSessionRefToAggregate(sessionRef), revision: session.value.record.revision },
    ] },
  };
}

/** The durable record of one ended Run (the review lease is read through it). */
async function executionOf(world: K3ReviewCardWorld, ref: RunSnapshot['ref']) {
  const read = await createRunStateReader({ records: world.records }).readExecution(world.fixture.ctx, ref);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value;
}

describe('K3-47 (四) owner review claim', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-47 (四) %s: a P6 review claim re-holds the lease, writes UCR-03 and creates the review Run',
    async kind => {
      const world = await openK3ReviewCardWorld(kind);
      fixtures.push(world);
      const { record, claim: originalClaim } = await pendingRecordWithClaim(world, `k3-47-4-p6-${kind}`);
      const request = await reviewClaimRequest(world, record, `k3-47-4-p6-claim-${kind}`);
      const claimed = await world.fixture.b2.base.service.claimTask(world.fixture.ctx, request);
      expect(claimed, JSON.stringify(claimed)).toMatchObject({ status: 'committed', replayed: false });
      if (claimed.status !== 'committed') return;
      const claim = claimed.value;
      // UCR-03 in the SAME commit: the record's activeRound is the new Run, revision 2.
      expect(await world.reviews.readReview(world.fixture.ctx, { ref: record.ref })).toMatchObject({ status: 'ready', value: {
        revision: 2, status: 'pending_review', open: 'yes',
        activeRound: { runRef: claim.runRef, phase: 'review', round: 1, stateEntry: 1, startedRevision: 1 },
      } });
      // The new Run is a review-purpose Run.
      const reviewRun = await executionOf(world, claim.runRef);
      expect(reviewRun.run.purpose).toEqual({ kind: 'unknown_call_review', reviewRef: record.ref, phase: 'review', round: 1 });
      // ATT-16r really re-held the Task lease (read through the public execution read).
      const original = await executionOf(world, originalClaim.runRef);
      expect(original.lease).toMatchObject({ holderRunId: claim.runRef.runId });
      expect(original.lease?.release).toBeUndefined();
    },
  );

  it.each(['memory', 'sqlite'] as const)(
    'K3-47 (四) %s: an ordinary review claim replays the same receipt without a second round',
    async kind => {
      const world = await openK3ReviewCardWorld(kind);
      fixtures.push(world);
      const { record } = await pendingRecordWithClaim(world, `k3-47-4-replay-${kind}`);
      const request = await reviewClaimRequest(world, record, `k3-47-4-replay-claim-${kind}`);
      const first = await world.fixture.b2.base.service.claimTask(world.fixture.ctx, request);
      expect(first).toMatchObject({ status: 'committed', replayed: false });
      const replay = await world.fixture.b2.base.service.claimTask(world.fixture.ctx, request);
      expect(replay).toEqual({ ...first, replayed: true });
      expect(await world.reviews.readReview(world.fixture.ctx, { ref: record.ref })).toMatchObject({ status: 'ready',
        value: { revision: 2, activeRound: { round: 1 } } });
    },
  );

  it.each(['memory', 'sqlite'] as const)(
    'K3-47 (四) %s: a P4 review claim (a covering TaskRequeue after R) also re-holds the lease',
    async kind => {
      const world = await openK3ReviewCardWorld(kind);
      fixtures.push(world);
      const { record, claim: originalClaim } = await pendingRecordWithClaim(world, `k3-47-4-p4-${kind}`);
      // The real public requeue of the original Run, so the Task projects P4.
      await requeueBlockedRecord(world, originalClaim, 'continue after the crash');
      const request = await reviewClaimRequest(world, record, `k3-47-4-p4-claim-${kind}`);
      const claimed = await world.fixture.b2.base.service.claimTask(world.fixture.ctx, request);
      expect(claimed, JSON.stringify(claimed)).toMatchObject({ status: 'committed', replayed: false });
      if (claimed.status !== 'committed') return;
      expect(await world.reviews.readReview(world.fixture.ctx, { ref: record.ref })).toMatchObject({ status: 'ready', value: {
        revision: 2, activeRound: { runRef: claimed.value.runRef, phase: 'review', round: 1 },
      } });
      const original = await executionOf(world, originalClaim.runRef);
      expect(original.lease).toMatchObject({ holderRunId: claimed.value.runRef.runId });
      expect(original.lease?.release).toBeUndefined();
    },
  );
});

// --------------------------------------------------------------------------
// K3-47 (三): a review round releases the lease; the continuation requeue
// (afterRun R) commits and the claim carrying its requeueRef re-holds
// --------------------------------------------------------------------------

describe('K3-47 (三) review lease release', () => {
  const worlds: K3ReviewCardWorld[] = [];
  afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

  /** The record's Goal ref (the real Task triple the blocked Run was claimed on). */
  function goalRefOf(record: UnknownCallReviewV1) {
    return { aggregateType: 'Goal' as const, projectId: record.task.projectId, goalId: record.task.goalId };
  }

  /** The active Plan snapshot of the record's Goal (the facts read needs it). */
  async function planOf(world: K3ReviewCardWorld, record: UnknownCallReviewV1) {
    const goalRef = goalRefOf(record);
    const window = await readGoalPlanWindow(world.records, goalRef);
    if (window.status !== 'ready' || window.plan === null) throw new Error('the active Plan is not readable');
    return { goalRef, plan: window.plan };
  }

  /** A human requeue after the original Run, so the Task projects P4. */
  async function requeueAfterOrigin(world: K3ReviewCardWorld, record: UnknownCallReviewV1, requestId: string) {
    const ctx = world.fixture.ctx;
    const base = world.fixture.b2.base;
    const { goalRef } = await planOf(world, record);
    const goal = await base.plans.queryGoal(ctx, goalRef);
    if (goal.status !== 'ready') throw new Error('the Goal must be readable');
    const reads = createRunStateReader({ records: world.records });
    const run = await reads.readExecution(ctx, record.runRef);
    if (run.status !== 'ready') throw new Error('the Run must be readable');
    let seq = 0;
    const materialReads = createMaterialRecordReaders(world.records);
    const service = createTaskRequeueService({
      records: world.records, reads: createRunStateReader({ records: world.records }),
      workspaceHost: { async resolveRoot() {
        return { status: 'ready', value: { root: world.fixture.base.directory, workspaceRevision: 1 } };
      } },
      source: { async captureDigest() { return { status: 'ready', sourceDigest: 'a'.repeat(64) }; } },
      materials: createMaterialService({ bodies: world.fixture.bodies, authority: materialReads.authority,
        now: () => world.fixture.now() }),
      messages: { async readMessage() { return { status: 'not_found' }; } },
      now: () => world.fixture.now(), eventId: () => `k3-47-3-requeue-event-${++seq}`,
    });
    const result = await service.requeueTask(ctx, {
      input: { taskRef: record.task, afterRunRef: record.runRef, reason: 'continue after the round' },
      meta: { requestId, expected: [
        { ref: goalRef, revision: goal.value.goal.revision },
        { ref: record.runRef, revision: run.value.run.revision },
      ] },
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    if (result.status !== 'committed' || result.value.kind !== 'requeued') throw new Error('the requeue must commit');
    return result.value.requeue;
  }

  /** All the way through the review round's release and the human requeue of R. */
  async function releasedLease(kind: 'memory' | 'sqlite') {
    // The real record: a public claim/prepare/Runtime start with the §5.1 shell
    // stand-in, the production RUN-20/RUN-22 Host read of that Kernel Turn, then
    // the Runtime's own end. No draft, terminal event or record is built here.
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const record = await createK3PendingReview(world, { taskId: 'k3-20-a',
      label: `k3-47-3-${kind}`, callId: `k3-47-3-call-${kind}`, command: 'echo k3-47-3' });
    expect(record).toMatchObject({ status: 'pending_review', revision: 1 });
    const { goalRef, plan } = await planOf(world, record);
    const taskId = record.task.taskId;
    const originalRunRef = record.runRef;
    // The review claim + production preparation + Runtime start (UCR-03), the
    // same shared steps the K3 proposal fixture uses (a fresh real Session, so
    // the round's Kernel identity slot is its own: K3-27's "new Session").
    const round = await claimK3ReviewRound(world, record, { phase: 'review' });
    const roundRunRef = round.claim.runRef;
    // The review round is never the Task's selected Run (L10).
    const facts = await readCanonicalTaskFacts(world.records, goalRef, plan, taskId);
    if (facts.status !== 'ready') throw new Error(JSON.stringify(facts));
    expect(facts.value.byTaskId.get(taskId)?.execution).toEqual(originalRunRef);
    expect((facts.value.runsByTaskId.get(taskId) ?? []).map(run => run.ref.runId))
      .toContain(roundRunRef.runId);
    // A NORMAL review end, not a cancellation: record the conclusion through the
    // public owner, end the round completed through the Runtime's own terminal,
    // then settle the record `resolved`.
    const recorded = await recordK3Conclusion(world, round, {
      item: 1, verdict: 'done', evidence: 'the command finished',
      crashSuspicion: { verdict: 'unlikely', evidence: 'no trace of a crash' },
      requestId: `k3-47-3-record-${kind}`,
    });
    expect(recorded.items[0]?.observed).toMatchObject({ verdict: 'done', by: 'review_round' });
    const current = await readK3Review(world, record.ref);
    const ended = await endK3RunCompleted(world, round.claim);
    expect(ended).toMatchObject({ status: 'ended', outcome: 'completed' });
    const settled = await settleK3Review(world, current, { cause: 'round_ended',
      requestId: `k3-47-3-settle-${kind}` });
    expect(settled).toMatchObject({ status: 'resolved', activeRound: null, decisionReasons: [] });
    const released = await createRunStateReader({ records: world.records })
      .readExecution(world.fixture.ctx, originalRunRef);
    if (released.status !== 'ready') throw new Error('the original Run must be readable');
    expect(released.value.lease?.release).toMatchObject({ runRef: roundRunRef });
    const afterRelease = await readCanonicalTaskFacts(world.records, goalRef, plan, taskId);
    if (afterRelease.status !== 'ready') throw new Error(JSON.stringify(afterRelease));
    expect(afterRelease.value.leasesByTaskId.get(taskId)?.release?.runRef).toEqual(roundRunRef);
    const releasingRun = (afterRelease.value.runsByTaskId.get(taskId) ?? [])
      .find(run => run.ref.runId === roundRunRef.runId);
    expect(releasingRun?.purpose).toEqual({ kind: 'unknown_call_review', reviewRef: record.ref,
      phase: 'review', round: 1 });
    expect(leaseReleasedForContinuation({ release: { runRef: roundRunRef },
      releasingRunPurpose: releasingRun?.purpose ?? null }, originalRunRef)).toBe(true);
    const requeue = await requeueAfterOrigin(world, record, `k3-47-3-requeue-${kind}`);
    return { world, record, goalRef, plan, originalRunRef, roundRunRef, requeue };
  }

  it.each(['memory', 'sqlite'] as const)(
    'K3-47 (三) %s: requeueTask (afterRun R) commits after a review round releases the lease',
    async kind => {
      const { requeue, originalRunRef } = await releasedLease(kind);
      expect(requeue.ref.afterRunId).toBe(originalRunRef.runId);
    },
  );

  it.each(['memory', 'sqlite'] as const)(
    'K3-47 (三) %s: the requeue claim carrying its requeueRef re-holds the lease',
    async kind => {
      const { world, record, goalRef, plan, originalRunRef, requeue } = await releasedLease(kind);
      const base = world.fixture.b2.base;
      const ctx = world.fixture.ctx;
      const sessionRef = await world.fixture.createS5Session(`k3-47-3-rehold-${kind}`);
      const goal = await base.plans.queryGoal(ctx, goalRef);
      if (goal.status !== 'ready') throw new Error('the Goal must be readable');
      const session = await base.sessionsPort.readSession(ctx, sessionRef);
      if (session.status !== 'ready') throw new Error('the Session must be readable');
      const claimed = await base.service.claimTask(ctx, {
        input: { goalRef, planRef: plan.ref, taskId: record.task.taskId, sessionRef,
          roleBinding: base.roleBinding, budget: base.budget, requeueRef: requeue.ref },
        meta: { requestId: `k3-47-3-rehold-claim-${kind}`, expected: [
          { ref: goalRef, revision: goal.value.goal.revision },
          { ref: world.fixture.base.workspaceRef, revision: WORKSPACE_REVISION },
          { ref: plainSessionRefToAggregate(sessionRef), revision: session.value.record.revision },
        ] },
      });
      expect(claimed, JSON.stringify(claimed)).toMatchObject({ status: 'committed', replayed: false });
      if (claimed.status !== 'committed') return;
      const reheld = await createRunStateReader({ records: world.records })
        .readExecution(ctx, originalRunRef);
      if (reheld.status !== 'ready') throw new Error('the original Run must be readable');
      expect(reheld.value.lease).toMatchObject({ holderRunId: claimed.value.runRef.runId });
      expect(reheld.value.lease?.release).toBeUndefined();
    },
  );
});
