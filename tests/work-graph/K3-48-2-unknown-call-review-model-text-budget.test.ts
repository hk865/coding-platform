/**
 * K3 row K3-48 (二), the `record_unknown_call_review` half only (M3, L7/L14):
 * optional model text is admitted only when the WRITTEN record stays within
 * 512 KiB − R = `UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES`. A long evidence
 * write over budget returns `capacity` and leaves the record byte-identical; a
 * short evidence write is accepted. `propose_safer_method`'s half is group 4:
 * the integration row drives the real Run/review/settle/proposal chain, and the
 * exact L7 boundary of the WRITTEN proposal record lives in the pure A5 file
 * `tests/runtime/K3-48-2-proposal-budget-pure.test.ts` (F-046).
 *
 * The record is read back only through the public `readReview` port.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type {
  UnknownCallReviewRef, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  newUnknownCallReview, transitionUnknownCallReview,
  type UnknownCallReviewContextV1,
} from '../../src/core/work-graph/state/unknown-call-review.js';
import {
  decodeUnknownCallReview, encodeUnknownCallReview, encodeUnknownCallReviewChangedEvent, unknownCallReviewRefKey,
  UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE, UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION,
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { openK3ReviewCardWorld, answerK3Disposition, claimK3ReviewRound, endK3RunCompleted, recordK3Conclusion,
  k3SerializedBytes, settleK3Review, writeK3Proposal,
  type K3ReviewCardWorld, type K3Round,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { PLAN_B2 } from '../helpers/S5-decision-fixture.js';

// The real `shell` builtin needs bwrap; the §5.1 stand-in keeps the name and
// the process effect class and blocks in the test process (an injected
// dependency). `vi.mock` is hoisted per test file, so this file owns the calls.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(..._args: unknown[]) { void _args; }
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(_root: string, _workspace: unknown, options?: Record<string, unknown>): Promise<unknown> {
      if (options?.['workspaceMode'] !== 'read_only') {
        return { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: only read-only probing' };
      }
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shellSeam = shellSeam;

const AT = '2026-10-20T00:00:00.000Z';
// K3 L7 budget table: 512 KiB - reserve R (365,536) = 158,720. The literal is
// the spec's, so a drift in the production constant fails this test.
const B = 158_720;
const REVIEW_SCHEMAS: RecordBackendSchemas = {
  records: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records],
  events: [...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events],
  lookups: [...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? [])],
};
const UNAVAILABLE = {
  status: 'unavailable' as const, runBaselineKnown: false, reason: 'not_configured' as const, detail: 'k3-48-2',
};
const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * K3-48 (一)'s long-command builder: a 512-byte callId, a 512-byte command and
 * eight paths padded to `pathPad` (each <= 512 per the L7 contract), with the
 * legal 64-hex digest the strict codec requires.
 */
function processItem(alias: number, pathPad: number, firstPathShrink = 0) {
  const callId = `call-${String(alias).padStart(3, '0')}-` + 'c'.repeat(512 - 10);
  const command = 'echo ' + String(alias) + ' ' + 'x'.repeat(512 - 8);
  const paths = Array.from({ length: 8 }, (_, index) => {
    const pad = index === 0 ? pathPad - firstPathShrink : pathPad;
    return `/very/long/long/path/${String(alias)}/${String(index)}/`.padEnd(pad, 'p');
  });
  return {
    alias, callId, toolName: 'shell', kind: 'process' as const, contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command, cwd: null, mode: null, paths, pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending' as const, by: null },
  };
}

const FIXTURES: { b2: B2ExecutionFixture; close(): Promise<void> }[] = [];
const WORLDS: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  for (const open of FIXTURES.splice(0)) await open.close();
  for (const world of WORLDS.splice(0)) await world.close();
});

type Built = {
  b2: B2ExecutionFixture;
  records: B2ExecutionFixture['base']['records'];
  reviews: ReturnType<typeof createUnknownCallReviewService>;
  reviewRef: UnknownCallReviewRef;
  ctx: CoreCallContext;
};

/** The ids every exact-size builder fills; the padding never touches them. */
type ReviewRefs = {
  reviewRef: UnknownCallReviewRef;
  workspaceId: string;
  task: { projectId: string; goalId: string; taskId: string };
  originRunRef: RunRef;
  claimRunRef: RunRef;
  sessionId: string;
};

function ctxOf(revision: number, overrides: Partial<UnknownCallReviewContextV1> = {}): UnknownCallReviewContextV1 {
  return { expectedRevision: revision, updatedAt: AT, actor: { kind: 'human', id: 'u' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
    autonomy: 'after_plan_confirmation', incompleteCommandAliases: [], missingSelfCheckAliases: [],
    originalRunSelected: false, ...overrides };
}

/** The L9 creation record (no round yet) with `count` exact-size `processItem`s. */
function pendingReview(
  refs: ReviewRefs, count: number, pathPad: number, lastPathShrink = 0,
): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: refs.reviewRef, workspaceId: refs.workspaceId, task: refs.task, runRef: refs.originRunRef,
    sessionRef: { projectId: refs.reviewRef.projectId, sessionId: refs.sessionId },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'K3-48-2' },
    inventory: 'complete', inventoryProblem: null, itemsOmitted: 0, workspace: UNAVAILABLE,
    items: Array.from({ length: count }, (_, index) =>
      processItem(index + 1, pathPad, index === count - 1 ? lastPathShrink : 0)),
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null }, createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

/**
 * Builds the smallest item count whose 512-byte-field record reaches `target`:
 * the shared path pad is solved linearly (the builder's serialised size grows
 * by exactly 8 bytes per pad character per item), then the first path is
 * trimmed by the rounding remainder so the record is exactly `target` bytes.
 */
function exactSizedRecord(
  target: number,
  build: (count: number, pathPad: number, lastPathShrink: number) => UnknownCallReviewV1,
): UnknownCallReviewV1 {
  let count = 0;
  let pathPad = 0;
  for (let candidate = 1; candidate <= 31; candidate += 1) {
    const sample = build(candidate, 64, 0);
    const base = bytesOf(sample) - 8 * candidate * 64;
    const pad = Math.ceil((target - base) / (8 * candidate));
    if (pad >= 1 && pad <= 512) { count = candidate; pathPad = pad; break; }
  }
  if (count === 0) throw new Error('no legal item count reaches the near-threshold target');
  return build(count, pathPad, bytesOf(build(count, pathPad, 0)) - target);
}

/** Builds a `pending_review` record with one active round, padded so its serialised size is exactly `target`. */
async function fixture(kind: 'memory' | 'sqlite', target: number): Promise<Built> {
  const b2 = await createB2ExecutionFixture(kind, REVIEW_SCHEMAS);
  FIXTURES.push({ b2, close: () => b2.close() });
  await b2.enter();
  const records = b2.base.records;
  const runRef = b2.claim.runRef;
  const reviewRef: UnknownCallReviewRef = {
    aggregateType: 'UnknownCallReview', projectId: runRef.projectId, goalId: runRef.goalId, runId: 'k3-48-2-origin',
  };
  const refs: ReviewRefs = {
    reviewRef, workspaceId: b2.base.scope.workspaceId,
    task: { projectId: runRef.projectId, goalId: runRef.goalId, taskId: b2.claim.task.taskId },
    originRunRef: { aggregateType: 'Run', projectId: runRef.projectId, goalId: runRef.goalId, runId: reviewRef.runId },
    claimRunRef: runRef, sessionId: b2.claim.sessionRef.sessionId,
  };
  const record = exactSizedRecord(target, (count, pathPad, lastPathShrink) => {
    const pending = pendingReview(refs, count, pathPad, lastPathShrink);
    const claimed = transitionUnknownCallReview(pending, {
      kind: 'round_claimed', runRef, phase: 'review', round: 1,
    }, ctxOf(pending.revision));
    if (!claimed.ok) throw new Error(JSON.stringify(claimed));
    return claimed.next;
  });
  expect(bytesOf(record)).toBe(target);
  const refKey = unknownCallReviewRefKey(reviewRef);
  const receipt = await records.commit({
    identityKey: 'k3-48-2-setup', fingerprint: 'k3-48-2-setup-fp',
    guards: [{ refKey, expectedRevision: null }],
    records: [encodeUnknownCallReview(record)], claims: [], indexGuards: [], indexChanges: [],
    events: [encodeUnknownCallReviewChangedEvent({
      eventId: 'k3-48-2-setup-event', eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION, occurredAt: AT,
      identityKey: 'k3-48-2-setup', fingerprint: 'k3-48-2-setup-fp', actor: { kind: 'human', id: 'u' },
      requestId: 'k3-48-2-setup', change: 'round_claimed', review: record,
    })],
  });
  if (receipt.status !== 'committed') throw new Error(`setup commit failed: ${JSON.stringify(receipt)}`);
  let seq = 0;
  const reviews = createUnknownCallReviewService({
    records, lookups: records, reads: createRunStateReader({ records }),
    readReviewDisplays: async () => ({ status: 'not_found' }),
    now: () => AT, eventId: () => `k3-48-2-event-${String(++seq)}`,
  });
  const ctx: CoreCallContext = {
    projectId: b2.base.scope.projectId, workspaceId: b2.base.scope.workspaceId,
    principal: { kind: 'work_run', runRef, roleBinding: b2.run.roleBinding },
    materialReader: b2.ctx.materialReader, signal: b2.ctx.signal,
  };
  return { b2, records, reviews, reviewRef, ctx };
}

type ProposalBuilt = { world: K3ReviewCardWorld; record: UnknownCallReviewV1; round: K3Round };

/**
 * K3-48 (二) `propose_safer_method` half: the REAL `awaiting_proposal` record
 * with an active proposal round, reached through the shared public-step path
 * only. A Run is claimed, the production preparation starts it with ONE blocked
 * `shell` call, and RUN-20/RUN-22 build the record from the production draft
 * (`createRecord`). The real review round then concludes, ends by the model's
 * own final reply and settles; the real `resolveDecision` safer-method answer
 * leads to the real proposal-round claim.
 *
 * A non-read-only Kernel batch runs one call at a time, so the real record
 * holds the ONE blocked call. The 31-item near-boundary combination cannot be
 * produced by any public path; that arithmetic is the pure L7 test below.
 */
async function proposalFixture(kind: 'memory' | 'sqlite'): Promise<ProposalBuilt> {
  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
  WORLDS.push(world);
  const harness = await openRealRunHarness(world);
  const session = await world.fixture.createS5Session(`k3-48-2-record-session-${kind}`);
  const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId: 'k3-20-a',
    requestId: `k3-48-2-record-claim-${kind}` });
  // ONE blocked `shell` call: the Kernel executes a non-read-only batch one
  // call at a time, so the production draft (and the RUN-20/RUN-22 record built
  // from it) holds exactly this one process item.
  const recordRun = await harness.prepareAndStart(claim, {
    model: createScriptedModel([{ kind: 'calls', calls: [{
      callId: `k3-48-2-blocked-shell-${kind}`, name: 'shell', args: { command: 'printf k3-48-2 > a.txt' },
    }] }]),
    tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
  });
  let created: UnknownCallReviewV1;
  try {
    created = await harness.createRecord(claim);
  } finally {
    shellSeam.release();
    await recordRun.started.catch(() => undefined);
  }
  if (created.status !== 'pending_review') {
    throw new Error(`the real RUN-22 record must be pending_review: ${JSON.stringify(created.status)}`);
  }
  // The real review round: conclude the one process item (a possible crash
  // self-check makes settlement choose needs_decision), end the Run by the
  // model's own final reply, then settle through the public owner.
  const reviewRound = await claimK3ReviewRound(world, created, { phase: 'review' });
  const concluded = await recordK3Conclusion(world, reviewRound, {
    item: 1, verdict: 'done', evidence: 'K3-48-2: the blocked shell call ran',
    crashSuspicion: { verdict: 'possible', evidence: 'K3-48-2: the Kernel turn was blocked' },
  });
  await endK3RunCompleted(world, reviewRound.claim);
  const decided = await settleK3Review(world, concluded);
  if (decided.status !== 'needs_decision') {
    throw new Error(`the real review round must settle needs_decision: ${JSON.stringify(decided.status)}`);
  }
  const proposed = await answerK3Disposition(world, decided, 'safer_method', {
    text: 'K3-48-2: use a safer method',
  });
  if (proposed.status !== 'awaiting_proposal') {
    throw new Error(`the safer-method answer must await a proposal: ${JSON.stringify(proposed.status)}`);
  }
  const round = await claimK3ReviewRound(world, proposed, { phase: 'proposal' });
  return { world, record: round.record, round };
}

/**
 * F-067: a REAL public `awaiting_proposal` record whose body is near the
 * optional-text budget `B`, built only through the public steps.
 *
 * The record size that matters is the review record's serialised bytes; its
 * one real process item is bounded (a 512-byte callId / command / 8×512 path
 * sample), so the only real source of ~150 KB is the record's real workspace
 * capture: the capture stores up to 50 changed paths, and each real path may be
 * long. The world is a real git work tree (`gitWorkspace`), the Run records its
 * real start baseline (`prepareViaRuntime`), and the 50 long-named files are
 * written to disk AFTER that baseline, through `writeFile`. RUN-20/RUN-22 then
 * capture the real change set; nothing is constructed.
 */
async function nearBudgetProposalFixture(kind: 'memory' | 'sqlite'): Promise<ProposalBuilt> {
  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
  WORLDS.push(world);
  const harness = await openRealRunHarness(world, { gitWorkspace: true });
  const session = await world.fixture.createS5Session(`k3-48-2-near-${kind}`);
  const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId: 'k3-20-a',
    requestId: `k3-48-2-near-claim-${kind}` });
  const recordRun = await harness.prepareAndStart(claim, {
    model: createScriptedModel([{ kind: 'calls', calls: [{
      callId: `k3-48-2-near-shell-${kind}`, name: 'shell', args: { command: 'printf k3-48-2 > a.txt' },
    }] }]),
    tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true, prepareViaRuntime: true,
  });
  // Real files under the workspace root, written after the run-start baseline.
  for (let index = 0; index < 50; index += 1) {
    const relative = `${pathOfBytes(NEAR_BUDGET_PATH_BYTES - 4)}/f${String(index).padStart(2, '0')}`;
    await mkdir(dirname(join(world.fixture.base.directory, relative)), { recursive: true });
    await writeFile(join(world.fixture.base.directory, relative), 'k3-48-2 changed\n');
  }
  let created: UnknownCallReviewV1;
  try {
    created = await harness.createRecord(claim);
  } finally {
    shellSeam.release();
    await recordRun.started.catch(() => undefined);
  }
  if (created.status !== 'pending_review') {
    throw new Error(`the near-budget RUN-22 record must be pending_review: ${JSON.stringify(created.status)}`);
  }
  if (created.workspace.status !== 'captured' || created.workspace.sample.length !== 50) {
    throw new Error(`the near-budget record did not capture 50 real paths: ${JSON.stringify(created.workspace)}`);
  }
  const reviewRound = await claimK3ReviewRound(world, created, { phase: 'review' });
  const concluded = await recordK3Conclusion(world, reviewRound, {
    item: 1, verdict: 'done', evidence: 'K3-48-2: ran',
    crashSuspicion: { verdict: 'possible', evidence: 'K3-48-2: blocked' },
  });
  await endK3RunCompleted(world, reviewRound.claim);
  const decided = await settleK3Review(world, concluded);
  if (decided.status !== 'needs_decision') {
    throw new Error(`the near-budget review round must settle needs_decision: ${JSON.stringify(decided.status)}`);
  }
  const proposed = await answerK3Disposition(world, decided, 'safer_method', { text: 'K3-48-2: safer' });
  if (proposed.status !== 'awaiting_proposal') {
    throw new Error(`the near-budget safer-method answer must await a proposal: ${JSON.stringify(proposed.status)}`);
  }
  const round = await claimK3ReviewRound(world, proposed, { phase: 'proposal' });
  return { world, record: round.record, round };
}

/**
 * `NEAR_BUDGET_PATH_BYTES` is the hand-chosen relative length of each of the
 * 50 real changed paths. The capture sample is 50 paths, so the record body
 * grows by 50 bytes per path byte; the constant is tuned so the real
 * `awaiting_proposal` record lands in the one window where the real 1..512-byte
 * cwd can make the post-proposal precondition exactly `B - 2,000` bytes.
 */
const NEAR_BUDGET_PATH_BYTES = 3_022;
/** A short real safer command: the separate 5,120-byte approved-method budget includes the cwd. */
const NEAR_COMMAND = 'echo safer';

/** A relative path of exactly `length` UTF-8 bytes, each component <= 200 bytes. */
function pathOfBytes(length: number): string {
  const count = Math.ceil((length + 1) / 201);
  let remaining = length - (count - 1);
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const after = count - index - 1;
    const size = index === count - 1 ? remaining : Math.min(200, remaining - after);
    parts.push('p'.repeat(size));
    remaining -= size;
  }
  return parts.join('/');
}

function request(reviewRef: UnknownCallReviewRef, requestId: string, revision: number, evidence: string) {
  return {
    input: { reviewRef, item: 1, verdict: 'done' as const, evidence,
      crashSuspicion: { verdict: 'unlikely' as const, evidence: 'no crash' } },
    meta: { requestId, expected: [{ ref: reviewRef, revision }] },
  };
}

/** L7: a created record whose only variable is `argumentsDigest`, for the strict-decode case. */
function createdRecordWithDigest(digest: string): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' },
    workspaceId: 'w', task: { projectId: 'p', goalId: 'g', taskId: 't' },
    runRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' },
    sessionRef: { projectId: 'p', sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'u' }, reason: 'K3-48-2' },
    inventory: 'complete', inventoryProblem: null,
    items: [{ ...processItem(1, 64), argumentsDigest: digest }], itemsOmitted: 0,
    workspace: UNAVAILABLE,
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null }, createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

describe('K3-48 (二) optional model text admission', () => {
  it.each(['memory', 'sqlite'] as const)('K3-48 (二) %s: a long evidence write over budget is capacity and the record is byte-identical', async kind => {
    const fx = await fixture(kind, B - 1000);
    const before = await fx.reviews.readReview(fx.ctx, { ref: fx.reviewRef });
    if (before.status !== 'ready') throw new Error('setup record must be readable');
    const revision = before.value.revision;

    const over = await fx.reviews.recordConclusion(fx.ctx,
      request(fx.reviewRef, 'k3-48-2-long', revision, 'x'.repeat(1500)) as never);
    expect(over).toMatchObject({ status: 'rejected', code: 'capacity' });

    const after = await fx.reviews.readReview(fx.ctx, { ref: fx.reviewRef });
    if (after.status !== 'ready') throw new Error('the record must still be readable');
    expect(JSON.stringify(after.value)).toBe(JSON.stringify(before.value));

    const short = await fx.reviews.recordConclusion(fx.ctx,
      request(fx.reviewRef, 'k3-48-2-short', revision, 'y'.repeat(100)) as never);
    expect(short).toMatchObject({ status: 'committed', replayed: false });
    const accepted = await fx.reviews.readReview(fx.ctx, { ref: fx.reviewRef });
    if (accepted.status !== 'ready') throw new Error('the accepted record must be readable');
    expect(accepted.value.items[0]).toMatchObject({ alias: 1,
      observed: { verdict: 'done', by: 'review_round', evidence: 'y'.repeat(100) } });
  });

  it.each(['sqlite'] as const)('K3-48 (二) %s: a real awaiting_proposal record admits a 2,000-character rationale and the proposal is readable', async kind => {
    const fx = await proposalFixture(kind);
    const reviewRef = fx.record.ref;
    const before = await fx.world.reviews.readReview(fx.round.context, { ref: reviewRef });
    if (before.status !== 'ready') throw new Error('setup record must be readable');
    expect(before.value).toMatchObject({ status: 'awaiting_proposal', activeRound: { phase: 'proposal' } });
    // The real record holds the ONE blocked call the serial Kernel batch
    // reached: the 31-item near-boundary record of the old fixture is not
    // reachable through any public path.
    expect(before.value.items).toHaveLength(1);
    // This is the REAL record the public path produces; it is far below B, so
    // the exact L7 boundary arithmetic lives in the pure test below. This row
    // proves the real record admits the 2,000-character optional write and
    // stores the proposal.
    expect(k3SerializedBytes(before.value)).toBeLessThan(B - 2_000);
    const revision = before.value.revision;
    const rationale = '理'.repeat(2_000);

    const written = await writeK3Proposal(fx.world, fx.round, {
      item: 1, command: 'echo safer', cwd: null, rationale,
    });
    expect(written.revision).toBe(revision + 1);
    expect(written.proposals).toHaveLength(1);
    expect(written.proposals[0]).toMatchObject({ alias: 1, command: 'echo safer', cwd: null, rationale });

    const accepted = await fx.world.reviews.readReview(fx.round.context, { ref: reviewRef });
    if (accepted.status !== 'ready') throw new Error('the accepted record must be readable');
    expect(accepted.value.proposals.map(proposal => proposal.rationale)).toEqual([rationale]);
    expect(accepted.value.revision).toBe(revision + 1);
  }, 120_000);

  it.each([['memory', 457], ['sqlite', 376]] as const)('K3-48 (二) %s: the real near-budget proposal refuses 2,000 characters as capacity and admits 100', async (kind, cwdBytes) => {
    const fx = await nearBudgetProposalFixture(kind);
    const reviewRef = fx.round.record.ref;
    const before = await fx.world.reviews.readReview(fx.round.context, { ref: reviewRef });
    if (before.status !== 'ready') throw new Error('the near-budget record must be readable');
    expect(before.value).toMatchObject({ status: 'awaiting_proposal', activeRound: { phase: 'proposal' } });
    expect(before.value.proposals).toHaveLength(0);

    // F-067: the post-write precondition is FIXED, not derived from the
    // production record size. `PROPOSAL_JSON_BYTES` is the documented
    // `SaferMethodProposalV1` JSON with an empty cwd and rationale, hand-counted
    // field by field (the `proposals` array grows by exactly this object):
    //   {"proposalId":"ucr-proposal:<64 hex>"         93  = 1+14+77+1
    //    ,"callId":"<callId>                         11 + 25
    //    "                                            1   (closing quote)
    //    ,"alias":1                                  10
    //    ,"command":"echo safer"                     23
    //    ,"cwd":""                                    9
    //    ,"rationale":""                             15
    //    ,"roundRunRef":{...,"runId":"<runId>        76 + 8 ("s5-id-12")
    //    "}}                                          3
    //                                                = 274 bytes
    const callId = before.value.items[0]!.callId;
    const roundRunId = fx.round.claim.runRef.runId;
    const PROPOSAL_JSON_BYTES =
      93                            // { "proposalId":"ucr-proposal:<64 hex>"
      + 11 + callId.length          // ,"callId":"<callId>
      + 1                           // closing quote of callId
      + 10                          // ,"alias":1
      + 23                          // ,"command":"echo safer"
      + 9                           // ,"cwd":""
      + 15                          // ,"rationale":""
      + 76 + roundRunId.length      // ,"roundRunRef":{aggregateType,projectId,goalId,runId}
      + 3;                          // "}}
    expect(PROPOSAL_JSON_BYTES).toBe(274);
    // The record revision is 6 -> 7: one digit either way, so 0 bytes.
    const REVISION_BYTES = 0;
    // The cwd length is a literal per backend, chosen so that the written
    // record is exactly B - 2,000 = 156,720 bytes BEFORE the rationale text.
    // The precondition is asserted against that fixed literal; the pre-write
    // size below is only the independent after-the-fact check of it:
    //   memory: 155,989 + 274 + 457 = 156,720
    //   sqlite: 156,070 + 274 + 376 = 156,720
    // The backends differ by 81 bytes because the sqlite capture's notVisible
    // list adds four store names with their JSON quotes/comma:
    //   "artifacts.sqlite" 19 + "artifacts.sqlite-shm" 23
    //   + "artifacts.sqlite-wal" 23 + "ledger.sqlite" 16 = 81,
    // so the sqlite cwd is 81 bytes shorter (457 - 81 = 376).
    const BEFORE_TEXT = 156_720;
    expect(B - 2_000).toBe(BEFORE_TEXT);
    expect(k3SerializedBytes(before.value) + REVISION_BYTES + PROPOSAL_JSON_BYTES + cwdBytes)
      .toBe(BEFORE_TEXT);
    expect(cwdBytes).toBeGreaterThanOrEqual(1);
    expect(cwdBytes).toBeLessThanOrEqual(512);
    const cwd = pathOfBytes(cwdBytes);
    expect(Buffer.byteLength(cwd, 'utf8')).toBe(cwdBytes);
    await mkdir(join(fx.world.fixture.base.directory, cwd), { recursive: true });

    // The whole increment, hand-computed: the 2,000-character rationale is
    // 2,000 CJK code points x 3 UTF-8 bytes = 6,000 bytes (JSON emits them
    // verbatim), the `"rationale":""` field already exists so the text adds
    // exactly its bytes, and the revision stays one digit:
    //   156,720 + 6,000 + 0 (field) + 0 (revision) = 162,720 > B = 158,720.
    // The 100-character short text is 300 bytes: 156,720 + 300 = 157,020.
    const RATIONALE_TEXT_BYTES = 2_000 * 3;
    const RATIONALE_FIELD_BYTES = 0;
    const LONG_TOTAL = BEFORE_TEXT + RATIONALE_TEXT_BYTES + RATIONALE_FIELD_BYTES + REVISION_BYTES;
    expect(LONG_TOTAL).toBe(162_720);
    expect(162_720 - B).toBe(4_000);
    const long = await fx.world.reviews.recordProposal(fx.round.context, {
      input: { reviewRef, item: 1, command: NEAR_COMMAND, cwd, rationale: '稳'.repeat(2_000) },
      meta: { requestId: `k3-48-2-near-long-${kind}`, expected: [] },
    });
    expect(long).toMatchObject({ status: 'rejected', code: 'capacity' });
    // The refused write's own measured size: the hand-computed 156,720 + 6,000.
    expect((long as { reason?: string }).reason).toContain(String(LONG_TOTAL));
    const afterLong = await fx.world.reviews.readReview(fx.round.context, { ref: reviewRef });
    if (afterLong.status !== 'ready') throw new Error('the refused record must stay readable');
    expect(JSON.stringify(afterLong.value)).toBe(JSON.stringify(before.value));
    expect(k3SerializedBytes(afterLong.value)).toBe(k3SerializedBytes(before.value));

    const shortRationale = '短'.repeat(100);
    expect(Buffer.byteLength(shortRationale, 'utf8')).toBe(300);
    const SHORT_TOTAL = BEFORE_TEXT + 300 + RATIONALE_FIELD_BYTES + REVISION_BYTES;
    expect(SHORT_TOTAL).toBe(157_020);
    expect(SHORT_TOTAL).toBeLessThanOrEqual(B);
    const short = await fx.world.reviews.recordProposal(fx.round.context, {
      input: { reviewRef, item: 1, command: NEAR_COMMAND, cwd, rationale: shortRationale },
      meta: { requestId: `k3-48-2-near-short-${kind}`, expected: [] },
    });
    expect(short).toMatchObject({ status: 'committed', replayed: false });
    const accepted = await fx.world.reviews.readReview(fx.round.context, { ref: reviewRef });
    if (accepted.status !== 'ready') throw new Error('the accepted record must be readable');
    // The full read-back and the exact written size: 156,720 + 300.
    expect(k3SerializedBytes(accepted.value)).toBe(SHORT_TOTAL);
    expect(accepted.value.revision).toBe(before.value.revision + 1);
    expect(accepted.value.proposals).toHaveLength(1);
    expect(accepted.value.proposals[0]).toMatchObject({
      alias: 1, callId: before.value.items[0]!.callId, command: NEAR_COMMAND, cwd, rationale: shortRationale,
    });
  });

  it('K3-48 (二) codec: strict decode accepts only a 64-lowercase-hex argumentsDigest', () => {
    const legal = createdRecordWithDigest('d'.repeat(64));
    expect(decodeUnknownCallReview(encodeUnknownCallReview(legal))).toMatchObject({ status: 'decoded' });

    for (const illegal of ['digest', 'D'.repeat(64), 'd'.repeat(63), 'd'.repeat(65),`${'d'.repeat(63)}z`]) {
      const record = createdRecordWithDigest(illegal);
      const decoded = decodeUnknownCallReview(encodeUnknownCallReview(record));
      expect(decoded).toMatchObject({ status: 'invalid' });
    }
  });
});
