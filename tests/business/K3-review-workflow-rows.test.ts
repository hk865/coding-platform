/**
 * K3 group 3 (§3.4 UR table / U4, L10/L12): the Workflow rows for review rounds.
 *
 * The Workflow is driven through its public `advanceWork` seam over the ONE K3
 * review-card world: the origin `pending_review` record and its Run come from a
 * real blocked Run, and every round/Run/Session/answer/held/card state is
 * reached through the public claim/prepare/start/Runtime-end/settle/answer/hold
 * owners (never a built record or an overwritten read). Rows whose input cannot
 * be produced by public steps are the pure input -> output rows below, with no
 * store. Expected steps and literal reasons come from §3.4 and L10; no database
 * is read to verify.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { DecisionSelectionV1, DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult, WorkflowOperation } from '../../src/business/workflow/contracts.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import { createCommandRerunRequestApplicationAdapter } from '../../src/business/workflow/decision-actions.js';
import type { WorkflowDependencies } from '../../src/business/workflow/ports.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readCanonicalTaskFacts, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import { blockedRecordWithClaim } from '../helpers/B2-crr-world.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { createK3_35Runtime } from '../helpers/K3-35-runtime.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { GOAL_B, PLAN_B2, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';
import {
  answerK3Disposition, claimK3ReviewRound, endK3RunCompleted, endK3RunUnfinished, k3RequestId,
  readK3Review, readK3ReviewCard, settleK3Review, writeK3Proposals,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { createSessionHealthService } from '../../src/core/work-graph/sessions/session-health.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';

// §5.1's stand-in `shell`, hoisted per test file (the real Run's one call uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const fixtures: B2ExecutionFixture[] = [];
const cardWorlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of cardWorlds.splice(0)) await world.close();
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

function unsupported(reason: string) {
  return { status: 'rejected' as const, code: 'unsupported' as const, reason };
}

type NoRecordWorld = {
  b2: B2ExecutionFixture;
  workflow: ReturnType<typeof createWorkflow>;
};

type AppliedApplication = {
  source: DecisionSourceV1;
  selection: DecisionSelectionV1;
  decisionMessageRef: SessionMessageRef;
  requestId: string;
  expected: readonly unknown[];
};

type RealWorld = {
  cardWorld: K3ReviewCardWorld;
  b2: B2ExecutionFixture;
  claim: TaskClaim;
  /** The ONE real `pending_review` record of this world (its current revision). */
  record: UnknownCallReviewV1;
  ctx: CoreCallContext;
  workflow: ReturnType<typeof createWorkflow>;
  capability: 'available' | 'unavailable';
  /** K3 UR0 fault injection: the review owner's read fails once per call. */
  reviewReadFails: boolean;
  /** K3 UR7 fault injection: the saved-answer read fails. */
  answerReadFails: boolean;
  /** Every `settleReview` call the Workflow makes through the real owner. */
  settleCalls: number;
  /** Every result the real `settleReview` owner returned through that wrapper. */
  settleResults: Array<Awaited<ReturnType<K3ReviewCardWorld['reviews']['settleReview']>>>;
  /** Every ② application request the Workflow's real adapter handled. */
  applied: AppliedApplication[];
  /** Every ③ application record the Workflow's real adapter committed. */
  recordedApplications: number;
  /** The real committed answer messages the handed-over refs name (K3 UR7b). */
  mailbox: Map<string, SessionMessage>;
};

/**
 * The Host start-up reconcile's own Session-health step: probe the Kernel
 * through the production history owner and let the SES-13 health owner record
 * the observed fact. The blocked origin Run is already over and its Kernel Turn
 * already terminal; only the Session's `kernel_turn_open` conclusion was left
 * behind by RUN-22. The probe is the real Kernel read (never a made-up verdict)
 * and the writer is the production owner, so the available Session UR1 claims
 * from is a platform fact.
 */
async function refreshOriginSession(world: K3ReviewCardWorld,
  sessionRef: SessionRef): Promise<void> {
  const harness = await openRealRunHarness(world);
  const kernelStores = harness.kernelStores;
  await harness.closeUnion();
  const { deps } = createK3_35Runtime(world, {
    model: createScriptedModel([]), tools: [], writeScope: [],
    now: world.fixture.now, eventId: () => world.fixture.newId(),
    newId: () => world.fixture.newId(), kernelStores,
    workspaceRevision: async () => {
      throw new Error('the UR1 origin health probe never prepares a Run');
    },
  });
  const card = await deps.sessions.readSession(world.fixture.ctx, sessionRef);
  if (card.status !== 'ready') throw new Error(`the origin Session is not readable: ${JSON.stringify(card)}`);
  const history = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores, kernel: deps.kernel });
  const probe = await history.probe({ session: card.value.record, signal: world.fixture.ctx.signal });
  if (probe.verdict !== 'ready') {
    throw new Error(`the origin Session Kernel is not ready: ${JSON.stringify(probe)}`);
  }
  if (card.value.record.health === 'available' && probe.activeRunId === null) return;
  const sessionHealth = createSessionHealthService({ records: world.records,
    hostInstance: { hostInstanceId: 'k3-rows-origin-host', lease: 'owned' },
    now: world.fixture.now, eventId: () => world.fixture.newId() });
  const written = await sessionHealth.recordSessionHealth(world.fixture.ctx, { sessionRef,
    probe: { verdict: 'ready', activeRunId: probe.activeRunId } });
  if (written.status !== 'observed' && written.status !== 'unchanged') {
    throw new Error(`the origin Session health was not observed: ${JSON.stringify(written)}`);
  }
}

/**
 * K3 UR9: the ONE real world with NO review record. The review read is the
 * production owner over the fixture's own records, so `not_found` is the
 * owner's answer, not a stand-in's; every other port is the real fixture port.
 */
async function makeWorld(kind: 'memory' | 'sqlite'): Promise<NoRecordWorld> {
  const b2 = await createB2ExecutionFixture(kind);
  fixtures.push(b2);
  const reads = createRunStateReader({ records: b2.base.records });
  const reviews = createUnknownCallReviewService({ records: b2.base.records, reads });
  const runtime: RuntimeExecutionPort = {
    capabilities: async () => unsupported('the review-row test never reads capabilities'),
    createSession: async () => unsupported('the review-row test stops before create_session'),
    readSessionHistory: async () => unsupported('no history'),
    readExecutionHistory: async () => unsupported('no history'),
    readTaskExecutionHistory: async () => unsupported('no history'),
    prepareExecution: async () => unsupported('the review-row test stops before prepare'),
    startRun: async () => unsupported('the review-row test stops before start'),
    observeRun: async () => unsupported('the review-row test never observes'),
    reviewCapability: async () => ({ status: 'available' }),
  };
  const evidence: EvidencePort = {
    openVerification: async () => unsupported('a review row never opens checks'),
    readVerification: async () => unsupported('no round read'),
    beginCheck: async () => unsupported('no begin'),
    recordCheckResult: async () => unsupported('no record'),
    finalizeChecks: async () => unsupported('no finalize'),
  };
  const checks: RegisteredCheckRunner = { runRegisteredCheck: async () => unsupported('no checks') };
  const { authority } = createMaterialRecordReaders(b2.base.records);
  const workflow = createWorkflow({
    tasks: b2.base.goals, plans: b2.base.plans, sessions: b2.base.sessionsPort,
    claims: b2.base.service, executions: reads, runtime, evidence, checks,
    sourceAuthority: createSourceAuthorityReader({ authority }),
    configuration: { consumerId: 'k3-review-rows-consumer', bindings: [{
      workspace: b2.base.scope,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: b2.base.roleBinding,
      budget: b2.base.budget,
    }] },
    unknownCallReviews: reviews as never,
  });
  return { b2, workflow };
}

/**
 * The real-origin world of every K3 review row: ONE real blocked Run through
 * the shared public steps (`blockedRecordWithClaim`: production claim/prepare/
 * Runtime start, the real Host RUN-20/RUN-22, then the Runtime's own end) gives
 * the `pending_review` record and the origin Run; the same Kernel probe and
 * SES-13 writer the Host start-up reconcile uses makes the origin Session
 * available, which is the state UR1 claims from. The review, Run, answer and
 * Session facts every row acts on are produced by real owners over this world's
 * records; only capability, binding and read-failure inputs are the test's.
 */
async function makeRealWorld(
  kind: 'memory' | 'sqlite',
  options: { noBinding?: boolean; runtime?: (cardWorld: K3ReviewCardWorld) => RuntimeExecutionPort } = {},
): Promise<RealWorld> {
  const cardWorld = await openK3ReviewCardWorld(kind);
  cardWorlds.push(cardWorld);
  const { record, claim } = await blockedRecordWithClaim(cardWorld, 'k3-20-a',
    `k3-rows-origin-${kind}`, [{ callId: `k3-rows-origin-call-${kind}`, command: 'npm run build' }],
    { dispose: false });
  await refreshOriginSession(cardWorld, claim.sessionRef);
  const b2 = cardWorld.fixture.b2;
  const records = cardWorld.records;
  const reads = createRunStateReader({ records });
  const { authority } = createMaterialRecordReaders(records);
  const realAuthority = createSourceAuthorityReader({ authority });
  const world: RealWorld = {
    cardWorld, b2, claim, record, ctx: cardWorld.fixture.ctx,
    workflow: undefined as unknown as ReturnType<typeof createWorkflow>,
    capability: 'available', reviewReadFails: false, answerReadFails: false,
    settleCalls: 0, settleResults: [], applied: [], recordedApplications: 0, mailbox: new Map(),
  };
  const runtime: RuntimeExecutionPort = options.runtime === undefined ? {
    capabilities: async () => unsupported('the review-row test never reads capabilities'),
    createSession: async () => unsupported('the review-row test stops before create_session'),
    readSessionHistory: async () => unsupported('no history'),
    readExecutionHistory: async () => unsupported('no history'),
    readTaskExecutionHistory: async () => unsupported('no history'),
    prepareExecution: async () => unsupported('the review-row test stops before prepare'),
    startRun: async () => unsupported('the review-row test stops before start'),
    observeRun: async () => unsupported('the review-row test never observes'),
    reviewCapability: async () => world.capability === 'available'
      ? { status: 'available' } : { status: 'unavailable', reason: 'switch off' },
  } : options.runtime(cardWorld);
  const evidence: EvidencePort = {
    openVerification: async () => unsupported('a review row never opens checks'),
    readVerification: async () => unsupported('no round read'),
    beginCheck: async () => unsupported('no begin'),
    recordCheckResult: async () => unsupported('no record'),
    finalizeChecks: async () => unsupported('no finalize'),
  };
  const checks: RegisteredCheckRunner = { runRegisteredCheck: async () => unsupported('no checks') };
  const dependencies: WorkflowDependencies = {
    tasks: b2.base.goals, plans: b2.base.plans, sessions: b2.base.sessionsPort,
    claims: b2.base.service, executions: reads, runtime, evidence, checks,
    configuration: { consumerId: 'k3-review-rows-consumer',
      bindings: options.noBinding === true ? [] : [{
        workspace: WORKSPACE_SCOPE,
        sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
        roleBinding: b2.base.roleBinding,
        budget: b2.base.budget,
      }] },
    goalSettings: createGoalSettingsService({ records, now: () => cardWorld.fixture.now(),
      newId: () => cardWorld.fixture.newId(), operatorActor: cardWorld.fixture.operatorActor }),
    // The real decision-message owner reads the saved answers and records ③;
    // the two ports are counted and only the saved-answer read has a fault.
    decisionMessages: {
      ...cardWorld.decisions,
      readDecisionAnswer: async (ctx: CoreCallContext, request: { source: DecisionSourceV1 }) =>
        world.answerReadFails
          ? { status: 'rejected' as const, code: 'unavailable' as const, reason: 'the saved answer is not readable' }
          : cardWorld.decisions.readDecisionAnswer(ctx, request),
      recordDecisionApplication: async (ctx: CoreCallContext,
        request: Parameters<K3ReviewCardWorld['decisions']['recordDecisionApplication']>[1]) => {
        world.recordedApplications += 1;
        return cardWorld.decisions.recordDecisionApplication(ctx, request);
      },
    } as never,
    applicationReceipt: cardWorld.applicationReceipt,
    // ② applies through the SAME real review owner the production wiring uses;
    // the test only records the request the Workflow derived from the answer.
    decisionApplications: { unknown_call_review: { apply: async (ctx, input) => {
      world.applied.push({ source: input.source, selection: input.selection,
        decisionMessageRef: input.answerRef, requestId: input.requestId, expected: [...input.expected] });
      const result = await cardWorld.reviews.applyDisposition(ctx, { input: {
        source: input.source, selection: input.selection, decisionMessageRef: input.answerRef },
        meta: { requestId: input.requestId, expected: [...input.expected] } });
      return { status: 'ready', value: { action: result, receipt: null } };
    } },
    // The real production adapter for the command-rerun kind (B3), so the
    // Workflow is wired exactly as production for every decision kind.
    command_rerun_request: createCommandRerunRequestApplicationAdapter(cardWorld.commandRerun) },
    // The handed-over ref names ONE real committed answer message of this world.
    messages: { readMessage: async (_ctx: CoreCallContext, ref: SessionMessageRef) => {
      const message = world.mailbox.get(ref.messageId);
      return message === undefined
        ? { status: 'not_found' as const }
        : { status: 'ready' as const, value: message };
    } } as never,
    sourceAuthority: realAuthority,
    unknownCallReviews: {
      readReview: async (ctx: CoreCallContext,
        request: Parameters<K3ReviewCardWorld['reviews']['readReview']>[1]) => {
        if (world.reviewReadFails) throw new Error('injected review read failure');
        return cardWorld.reviews.readReview(ctx, request);
      },
      settleReview: async (ctx: CoreCallContext,
        request: Parameters<K3ReviewCardWorld['reviews']['settleReview']>[1]) => {
        world.settleCalls += 1;
        const result = await cardWorld.reviews.settleReview(ctx, request);
        world.settleResults.push(result);
        return result;
      },
    } as never,
  };
  world.workflow = createWorkflow(dependencies);
  return world;
}

/**
 * F-026: the card source key written out as a literal (canonical JSON with
 * sorted keys), never produced by `decisionSourceKey`. Only the record's own
 * ids and revision are interpolated.
 */
function reviewSourceKeyOf(review: { ref: UnknownCallReviewV1['ref']; revision: number }): string {
  return `{"kind":"unknown_call_review","reviewRef":{"aggregateType":"UnknownCallReview",`
    + `"goalId":"${review.ref.goalId}","projectId":"${review.ref.projectId}",`
    + `"runId":"${review.ref.runId}"},"revision":${String(review.revision)}}`;
}

function selectTask(taskId: string | null): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: GOAL_B, flowId: 'k3-review-rows', sessionHint: null,
    kind: 'select_work', ...(taskId === null ? {} : { taskId }) };
}

/** A real public review claim (TASK-03r) that is NOT prepared or started. */
async function claimUnenteredRound(w: RealWorld,
  phase: 'review' | 'proposal' = 'review'): Promise<TaskClaim> {
  const f = w.cardWorld.fixture;
  const session = await f.createS5Session(`k3-rows-round-${phase}-${f.newId()}`);
  return await f.claimRun({ requestId: `k3-rows-round-claim-${f.newId()}`,
    goalRef: GOAL_B, planRef: PLAN_B2, taskId: w.record.task.taskId, sessionRef: session,
    review: { reviewRef: w.record.ref, expectedRevision: w.record.revision, phase } });
}

/** The real control owner's pre-entry pause on a claimed review round. */
async function pauseUnenteredRound(w: RealWorld, claim: TaskClaim): Promise<void> {
  const reads = createRunStateReader({ records: w.cardWorld.records });
  const current = await reads.readExecution(w.ctx, claim.runRef);
  if (current.status !== 'ready') throw new Error(`the claimed round is not readable: ${JSON.stringify(current)}`);
  const controls = createRunControlService({ records: w.cardWorld.records,
    authority: createMaterialRecordReaders(w.cardWorld.records).authority, reads,
    now: () => w.cardWorld.fixture.now(), eventId: () => w.cardWorld.fixture.newId() });
  const submitted = await controls.submitControl(w.ctx, { input: { runRef: claim.runRef, kind: 'pause',
    reason: 'the operator pauses the claimed review round before entry' },
    meta: { requestId: `k3-rows-pause-${claim.runRef.runId}`,
      expected: [{ ref: claim.runRef, revision: current.value.run.revision }] } });
  if (submitted.status !== 'committed') {
    throw new Error(`the pre-entry pause did not commit: ${JSON.stringify(submitted)}`);
  }
}

/** Real `settleReview{review_unavailable}` (L16 3) to the `needs_decision` card. */
async function reachNeedsDecision(w: RealWorld): Promise<UnknownCallReviewV1> {
  const settled = await settleK3Review(w.cardWorld, w.record, { cause: 'review_unavailable',
    requestId: k3RequestId(w.cardWorld, 'needs-decision') });
  w.record = settled;
  return settled;
}

/** The real chain to `awaiting_approval`: answer safer_method, proposal round, settle. */
async function reachAwaitingApproval(w: RealWorld): Promise<UnknownCallReviewV1> {
  await reachNeedsDecision(w);
  const proposed = await answerK3Disposition(w.cardWorld, w.record, 'safer_method', {
    text: 'K3 review rows: use a safer method',
    requestId: k3RequestId(w.cardWorld, 'safer-method') });
  const round = await claimK3ReviewRound(w.cardWorld, proposed, { phase: 'proposal' });
  const written = await writeK3Proposals(w.cardWorld, round);
  const current = await readK3Review(w.cardWorld, written.record.ref);
  await endK3RunCompleted(w.cardWorld, round.claim);
  const approved = await settleK3Review(w.cardWorld, current, { cause: 'round_ended',
    requestId: k3RequestId(w.cardWorld, 'awaiting-approval') });
  w.record = approved;
  return approved;
}

type SavedAnswer = { message: SessionMessage; source: DecisionSourceV1; selection: DecisionSelectionV1 };

/**
 * Commit ONLY the user's answer (①) through the real decision owner; the
 * card's ② is left to the step under test. The committed message is what the
 * Workflow later reads by its ref.
 */
async function answerSavedOnly(w: RealWorld, optionId: string): Promise<SavedAnswer> {
  const { card } = await readK3ReviewCard(w.cardWorld, w.record);
  const answered = await w.cardWorld.decisions.answerDecision(w.ctx, { input: {
    source: card.source, selection: { kind: 'option', optionId }, text: '', annotations: [] },
    meta: { requestId: k3RequestId(w.cardWorld, `answer-${optionId}`), expected: card.source.pins } });
  if (answered.status !== 'committed') throw new Error(`the answer did not commit: ${JSON.stringify(answered)}`);
  const message = answered.value;
  w.mailbox.set(message.ref.messageId, message);
  const response = message.response as { decision: { source: DecisionSourceV1;
    selection: DecisionSelectionV1 } } | null;
  if (response === null) throw new Error('the committed answer carries no decision response');
  return { message, source: response.decision.source, selection: response.decision.selection };
}

/** The real direct "I will handle it" (UCR-15) on the record's current revision. */
async function holdRecord(w: RealWorld): Promise<UnknownCallReviewV1> {
  // The claim wrote `activeRound`; the hold pins the record's CURRENT revision.
  const current = await readK3Review(w.cardWorld, w.record.ref);
  const held = await w.cardWorld.reviews.holdReview(w.ctx, { input: { reviewRef: current.ref, text: null },
    meta: { requestId: k3RequestId(w.cardWorld, 'hold'),
      expected: [{ ref: current.ref, revision: current.revision }] } });
  if (held.status !== 'committed') throw new Error(`the hold did not commit: ${JSON.stringify(held)}`);
  w.record = held.value;
  return held.value;
}

/**
 * K3 UR5: end a real entered review round with the production RUN-20 unknown
 * end. Only the claim-Session probe is injected as `missing` (fault injection);
 * the Run's `ended` + `outcome_unknown` facts are the reconcile owner's.
 */
async function reachUnknownReviewEnd(w: RealWorld): Promise<void> {
  const round = await claimK3ReviewRound(w.cardWorld, w.record);
  const harness = await openRealRunHarness(w.cardWorld);
  try {
    const unknown = await harness.reconcileUnknown(round.claim, { probe: { verdict: 'missing',
      activeRunId: null, reason: 'injected Kernel mapping failure' } });
    expect(unknown).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  } finally {
    await harness.closeUnion();
  }
  // The production RUN-20 end already closed the Run; release the Runtime's
  // gated model and let its own refused terminal settle the start promise.
  await endK3RunCompleted(w.cardWorld, round.claim).catch(() => undefined);
  w.record = await readK3Review(w.cardWorld, w.record.ref);
}

function selectInput(b2: B2ExecutionFixture, taskId: string | null,
  goalRef: typeof GOAL_B = b2.base.goalRef): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef, flowId: 'k3-review-rows', sessionHint: null,
    kind: 'select_work', ...(taskId === null ? {} : { taskId }) };
}

it.each(['memory', 'sqlite'] as const)('K3 UR0/U4 (%s): an unreadable record skips the task and waits with review_unreadable for a named task', async kind => {
  const w = await makeRealWorld(kind);
  w.reviewReadFails = true;
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null } });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(result.value.reason).toContain('review_unreadable');
});

it.each(['memory', 'sqlite'] as const)('K3 UR3a/U4 (%s): a claimed-but-unentered review round is prepared with the same claim', async kind => {
  const w = await makeRealWorld(kind);
  const round = await claimUnenteredRound(w);
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'perform', operation: { kind: 'prepare', request: { runRef: round.runRef } } } } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR3a/U4 (%s): a non-unadmitted starting review round (paused before entry) is skipped, not prepared', async kind => {
  const w = await makeRealWorld(kind);
  const round = await claimUnenteredRound(w);
  await pauseUnenteredRound(w, round);
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting',
    reason: expect.stringContaining('review_round_in_flight') } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR3/U4 (%s): an entered review round in flight is skipped', async kind => {
  const w = await makeRealWorld(kind);
  const round = await claimK3ReviewRound(w.cardWorld, w.record);
  try {
    const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
    expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting',
      reason: expect.stringContaining('review_round_in_flight') } });
  } finally {
    await endK3RunCompleted(w.cardWorld, round.claim);
  }
});

it.each(['memory', 'sqlite'] as const)('K3 UR4/U4 (%s): a review round ended with a known result settles it', async kind => {
  const w = await makeRealWorld(kind);
  const round = await claimK3ReviewRound(w.cardWorld, w.record);
  const ended = await endK3RunUnfinished(w.cardWorld, round.claim);
  expect(ended).toMatchObject({ status: 'ended', outcome: 'crashed' });
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'perform', operation: { kind: 'settle_review',
      request: { input: { cause: 'round_ended', reviewRef: w.record.ref } } } } } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR5/U4 (%s): a review round with an unknown outcome waits for attestation', async kind => {
  const w = await makeRealWorld(kind);
  await reachUnknownReviewEnd(w);
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting',
    reason: expect.stringContaining('review_round_unknown') } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR2/U4 (%s): a pending record with the read-only command switch off settles review_unavailable', async kind => {
  const w = await makeRealWorld(kind);
  w.capability = 'unavailable';
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'perform', operation: { kind: 'settle_review',
      request: { input: { cause: 'review_unavailable', reviewRef: w.record.ref } } } } } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR1/U4 (%s): a pending record with the capability available claims the review round', async kind => {
  const w = await makeRealWorld(kind);
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'perform', operation: { kind: 'claim_task', request: { input: {
      review: { reviewRef: w.record.ref, expectedRevision: w.record.revision, phase: 'review' } } } } } } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR1/U4 (%s): a busy continuation Session skips this Task with review_session_busy', async kind => {
  const w = await makeRealWorld(kind);
  // A real public claim of ANOTHER Task in the origin Run's claim Session leaves
  // that Session's occupancy a real execution fact.
  await w.cardWorld.fixture.claimRun({ requestId: `k3-rows-busy-session-${kind}`,
    goalRef: GOAL_B, planRef: PLAN_B2, taskId: 'k3-20-b', sessionRef: w.claim.sessionRef });
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting',
    reason: expect.stringContaining('review_session_busy') } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR1/U4 B2 (%s): no binding for the assignment role skips with review_binding_missing and keeps the record', async kind => {
  const w = await makeRealWorld(kind, { noBinding: true });
  const review = w.record;
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  // A missing model binding proves nothing about the read-only command, so the
  // gate skips: the named Task waits with the source and no review step is
  // planned (no claim, prepare, start or settle_review), the record stays.
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null } });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(result.value.reason).toContain('review_binding_missing');
  expect(w.settleCalls).toBe(0);
  expect(await readK3Review(w.cardWorld, review.ref)).toMatchObject({
    status: 'pending_review', revision: review.revision });
});

it.each(['memory', 'sqlite'] as const)('K3 UR9/U4 (%s): no record keeps today\'s path', async kind => {
  const w = await makeWorld(kind);
  const result = await w.workflow.advanceWork(w.b2.ctx, selectInput(w.b2, 'implement-a'));
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  // R is still a fresh claim with no ended Run, so the ordinary selection waits/skips;
  // the row itself must not be gated by any review reason.
  expect(result.value.reason ?? '').not.toContain('review_');
});

// -------------------------------------------------------------------------- //
// GROUP 4 (session A): UR8 held, UR6 cards and gatePerform's review gate
// -------------------------------------------------------------------------- //

it.each(['memory', 'sqlite'] as const)('K3 UR8 (%s): a held record without an active round is skipped and the named task waits unknown_call_review_held', async kind => {
  const w = await makeRealWorld(kind);
  await holdRecord(w);
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null } });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(result.value.reason).toContain('unknown_call_review_held');
});

it.each([
  { kind: 'memory' as const, status: 'needs_decision' as const },
  { kind: 'sqlite' as const, status: 'needs_decision' as const },
  { kind: 'memory' as const, status: 'awaiting_approval' as const },
  { kind: 'sqlite' as const, status: 'awaiting_approval' as const },
])('K3 UR6 ($kind/$status): a $status card skips the task and waits with the card\'s formal source',
  async ({ kind, status }) => {
    const w = await makeRealWorld(kind);
    if (status === 'needs_decision') await reachNeedsDecision(w);
    else await reachAwaitingApproval(w);
    const review = w.record;
    const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
    expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null } });
    if (result.status !== 'ready') throw new Error(JSON.stringify(result));
    expect(result.value.reason).toContain(`unknown_call_review_${status}`);
    expect((result.value as { source?: unknown }).source).toEqual({
      kind: 'unknown_call_review',
      key: reviewSourceKeyOf(review),
      goalRef: GOAL_B,
      pins: [{ ref: review.ref, revision: review.revision }],
    });
    expect(w.settleCalls).toBe(0);
  });

it.each(['memory', 'sqlite'] as const)('K3 L11 gatePerform (%s): a requeue_task on an unsettled record waits and writes nothing', async kind => {
  const w = await makeRealWorld(kind);
  await reachNeedsDecision(w);
  const operation = { kind: 'requeue_task' as const, request: {
    input: { taskRef: w.claim.task, afterRunRef: w.claim.runRef },
    meta: { requestId: 'k3-gate-perform', expected: [] } } };
  const result = await w.workflow.advanceWork(w.ctx, {
    schemaVersion: 1, goalRef: GOAL_B, flowId: 'k3-review-rows', sessionHint: null,
    kind: 'perform', operation } as unknown as WorkflowAdvanceInput);
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null } });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(result.value.reason).toContain('unknown_call_review_pending');
});

// -------------------------------------------------------------------------- //
// GROUP 4 (session B): UR7, UR7b and the apply_review_disposition step
// -------------------------------------------------------------------------- //

it.each(['memory', 'sqlite'] as const)('K3 UR7 (%s): an answered needs_decision card emits apply_review_disposition from the answer, writes nothing yet', async kind => {
  const w = await makeRealWorld(kind);
  await reachNeedsDecision(w);
  const review = w.record;
  const saved = await answerSavedOnly(w, 'rerun_as_is');
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance', next: { kind: 'perform',
    operation: { kind: 'apply_review_disposition', request: { input: {
      source: saved.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
      decisionMessageRef: saved.message.ref } } } } } });
  if (result.status !== 'ready' || result.value.next === null || result.value.next.kind !== 'perform') {
    throw new Error(JSON.stringify(result));
  }
  const request = result.value.next.operation.request as { input: unknown; meta: { requestId: string; expected: unknown[] } };
  expect(request.meta.expected).toEqual(saved.source.pins);
  expect(request.meta.requestId).toBeTruthy();
  // Selecting performs no write: the answer is only read; the card is not applied.
  expect(w.applied).toEqual([]);
  expect(w.recordedApplications).toBe(0);
  expect(await readK3Review(w.cardWorld, review.ref)).toMatchObject({
    status: 'needs_decision', revision: review.revision });
});

it.each(['memory', 'sqlite'] as const)('K3 UR7 (%s): the apply step performs ② then ③ and returns to the normal selection', async kind => {
  const w = await makeRealWorld(kind);
  await reachNeedsDecision(w);
  const saved = await answerSavedOnly(w, 'rerun_as_is');
  const selected = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  if (selected.status !== 'ready' || selected.value.next === null || selected.value.next.kind !== 'perform'
    || selected.value.next.operation.kind !== 'apply_review_disposition') {
    throw new Error(JSON.stringify(selected));
  }
  const perform = selected.value.next;
  const result = await w.workflow.advanceWork(w.ctx, perform);
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance',
    receipt: { kind: 'apply_review_disposition', result: { status: 'ready',
      value: { state: 'applied', application: { status: 'committed' } } } },
    next: { kind: 'select_work' } } });
  expect(w.applied).toHaveLength(1);
  expect(w.applied[0]).toMatchObject({ source: saved.source,
    selection: { kind: 'option', optionId: 'rerun_as_is' }, decisionMessageRef: saved.message.ref,
    requestId: (perform.operation.request as { meta: { requestId: string } }).meta.requestId });
  expect(w.recordedApplications).toBe(1);
  expect(await readK3Review(w.cardWorld, w.record.ref))
    .toMatchObject({ status: 'resolved', disposition: { choice: 'rerun_as_is', source: 'card' } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR7 (%s): a saved-answer read failure skips with review_unreadable and writes nothing', async kind => {
  const w = await makeRealWorld(kind);
  await reachNeedsDecision(w);
  w.answerReadFails = true;
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null } });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(result.value.reason).toContain('review_unreadable');
  expect(w.applied).toEqual([]);
});

it.each(['memory', 'sqlite'] as const)('K3 UR8 before UR7 (%s): a held record with an answer is never applied and never released', async kind => {
  const w = await makeRealWorld(kind);
  await reachNeedsDecision(w);
  // The person answered the card (①) but did not apply it; then took it over.
  await answerSavedOnly(w, 'handle_myself');
  await holdRecord(w);
  const result = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null } });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(result.value.reason).toContain('unknown_call_review_held');
  expect(w.applied).toEqual([]);
  expect(await readK3Review(w.cardWorld, w.record.ref)).toMatchObject({
    disposition: { choice: 'handle_myself', source: 'direct', hold: 'held' } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR7b (%s): an answers input performs apply_review_disposition and then select_work', async kind => {
  const w = await makeRealWorld(kind);
  await reachNeedsDecision(w);
  const saved = await answerSavedOnly(w, 'rerun_as_is');
  const review = w.record;
  const result = await w.workflow.advanceWork(w.ctx, { ...selectTask('k3-20-a'),
    answers: [{ kind: 'unknown_call_review', reviewRef: review.ref, answerMessageRef: saved.message.ref }] });
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance',
    receipt: { kind: 'apply_review_disposition', result: { status: 'ready',
      value: { state: 'applied', application: { status: 'committed' } } } },
    next: { kind: 'select_work' } } });
  expect(w.applied).toHaveLength(1);
  expect(w.applied[0]).toMatchObject({ source: saved.source, selection: saved.selection,
    decisionMessageRef: saved.message.ref });
  expect(w.applied[0]!.requestId).toMatch(/^wf-auto:card-application:/);
  expect(w.applied[0]!.expected).toEqual(saved.source.pins);
  expect(w.recordedApplications).toBe(1);
  expect(await readK3Review(w.cardWorld, review.ref)).toMatchObject({
    status: 'resolved', disposition: { choice: 'rerun_as_is', source: 'card' } });
});

it.each(['memory', 'sqlite'] as const)('K3 UR7b (%s): one unreadable answer keeps the failure visible, applies the rest and never throws', async kind => {
  const w = await makeRealWorld(kind);
  await reachNeedsDecision(w);
  const saved = await answerSavedOnly(w, 'rerun_as_is');
  const review = w.record;
  const result = await w.workflow.advanceWork(w.ctx, { ...selectTask('k3-20-a'),
    answers: [
      { kind: 'unknown_call_review', reviewRef: review.ref, answerMessageRef: { ...saved.message.ref, messageId: 'missing-answer' } },
      { kind: 'unknown_call_review', reviewRef: review.ref, answerMessageRef: saved.message.ref },
    ] });
  expect(result).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null } });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(result.value.reason).toContain('unavailable');
  expect(w.applied).toHaveLength(1);
  expect(w.applied[0]).toMatchObject({ source: saved.source });
});

function untouched<T extends object>(name: string): T {
  return new Proxy({}, { get: (_t, member) => () => { throw new Error(`${name}.${String(member)} must not be called`); } }) as T;
}

/**
 * F-054: the two Run entries the L10 rows perform return the REAL saved
 * `TaskExecutionRecord` of a Run the production Runtime already started and
 * ended (`claimK3ReviewRound` + `endK3Run*`/`reconcileUnknown`), read through
 * the public execution reader over the row's real backend. No snapshot is
 * built and every other entry is never called.
 */
function savedRunRuntime(
  records: K3ReviewCardWorld['records'], current: () => RunSnapshot['ref'] | null,
): RuntimeExecutionPort {
  const reads = createRunStateReader({ records });
  const readSaved = async (ctx: CoreCallContext) => {
    const ref = current();
    if (ref === null) {
      return { status: 'rejected' as const, code: 'unsupported' as const,
        reason: 'the L10 row has no review round Run' };
    }
    return await reads.readExecution(ctx, ref);
  };
  return {
    capabilities: async () => unsupported('the L10 row never reads capabilities'),
    createSession: async () => unsupported('the L10 row stops before create_session'),
    readSessionHistory: async () => unsupported('no history'),
    readExecutionHistory: async () => unsupported('no history'),
    readTaskExecutionHistory: async () => unsupported('no history'),
    prepareExecution: async () => unsupported('the L10 row never prepares'),
    startRun: async ctx => await readSaved(ctx),
    observeRun: async ctx => await readSaved(ctx),
    reviewCapability: async () => ({ status: 'available' }),
  };
}

/** A public perform body for the review-purpose Run rows (`start` / `observe`). */
function performRun(kind: 'start' | 'observe'): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: GOAL_B, flowId: 'k3-review-rows', sessionHint: null,
    taskId: 'k3-20-a', kind: 'perform',
    operation: { kind, request: { meta: { requestId: `k3-review-rows-${kind}`, expected: [] } } } as unknown as WorkflowOperation };
}

it.each(['memory', 'sqlite'] as const)('K3 UR7b (%s): another source kind is skipped (B3 adds it) and no disposition is applied', async kind => {
  const w = await makeRealWorld(kind);
  const world = w.cardWorld;
  // The Fixture's saved pending decision message is a REAL card of the
  // `message` source kind (a resolution-basis card, not a review card). Answer
  // it through the world's real decision service: no answer message is built.
  const pending = world.fixture.messages.decision;
  const source = pending.decision?.source;
  if (source === undefined) throw new Error('the fixture decision message has no captured source');
  // The S5 fixture saved this message before the K3 world adopted PLAN_B2, so
  // the real answer owner refreshes the captured Goal pins. The accepted pin
  // set is the card read a person would send: the message's own pin plus the
  // CURRENT Goal revisions, read through the real Plan owner (never the request).
  const acceptedPins = await Promise.all(source.pins.map(async pin => {
    const ref = pin.ref as { aggregateType?: unknown; projectId?: unknown; goalId?: unknown };
    if (ref.aggregateType !== 'Goal' || typeof ref.projectId !== 'string' || typeof ref.goalId !== 'string') return pin;
    const goalRead = await w.b2.base.plans.queryGoal(w.ctx,
      { aggregateType: 'Goal', projectId: ref.projectId, goalId: ref.goalId });
    if (goalRead.status !== 'ready') throw new Error(`the Goal is not readable: ${JSON.stringify(goalRead)}`);
    return { ref: pin.ref, revision: goalRead.value.goal.revision };
  }));
  const answered = await world.decisions.answerDecision(w.ctx, { input: { source,
    selection: { kind: 'option', optionId: 'accept' }, text: '', annotations: [] },
    meta: { requestId: k3RequestId(world, 'other-source-answer'),
      expected: [{ ref: pending.ref, revision: pending.revision }, ...acceptedPins] } });
  if (answered.status !== 'committed') throw new Error(`the answer did not commit: ${JSON.stringify(answered)}`);
  const message = answered.value;
  expect(message.response).toMatchObject({ decision: { source: { kind: 'message' } } });
  // The real saved-answer read returns the message the platform committed.
  expect(await world.decisions.readDecisionAnswer(w.ctx, { source })).toMatchObject({
    status: 'ready', value: { message: { ref: message.ref } } });
  w.mailbox.set(message.ref.messageId, message);
  const review = w.record;
  const result = await w.workflow.advanceWork(w.ctx, { ...selectTask('k3-20-a'),
    answers: [{ kind: 'unknown_call_review', reviewRef: review.ref, answerMessageRef: message.ref }] });
  expect(result).toMatchObject({ status: 'ready', value: { state: 'advance', receipt: null, next: { kind: 'select_work' } } });
  // The other kind never reaches ② or ③, and the review record is untouched.
  expect(w.applied).toEqual([]);
  expect(w.recordedApplications).toBe(0);
  expect(await readK3Review(world, review.ref)).toMatchObject({
    status: 'pending_review', revision: review.revision });
});

it.each(['memory', 'sqlite'] as const)('K3 L10 (%s): a review-purpose Run that ends goes to settle_review and never opens checks', async kind => {
  let savedRun: RunSnapshot['ref'] | null = null;
  const w = await makeRealWorld(kind, { runtime: world => savedRunRuntime(world.records, () => savedRun) });
  const round = await claimK3ReviewRound(w.cardWorld, w.record);
  const ended = await endK3RunCompleted(w.cardWorld, round.claim);
  expect(ended).toMatchObject({ status: 'ended', outcome: 'completed' });
  savedRun = round.claim.runRef;
  const review = await readK3Review(w.cardWorld, w.record.ref);
  // `evidence`/`checks` are unsupported above: a check round would surface it.
  for (const kind of ['start', 'observe'] as const) {
    const result = await w.workflow.advanceWork(w.ctx, performRun(kind));
    expect(result, kind).toMatchObject({ status: 'ready', value: { state: 'advance',
      next: { kind: 'perform', operation: { kind: 'settle_review',
        request: { input: { cause: 'round_ended', reviewRef: review.ref } } } } } });
  }
  // The Workflow plans the settlement and performs nothing else here.
  expect(w.settleCalls).toBe(0);
});

it.each(['memory', 'sqlite'] as const)('K3 A (%s): each settle_review request pins its record revision and gets its own identity', async kind => {
  let savedRun: RunSnapshot['ref'] | null = null;
  const w = await makeRealWorld(kind, { runtime: world => savedRunRuntime(world.records, () => savedRun) });
  const round = await claimK3ReviewRound(w.cardWorld, w.record);
  const ended = await endK3RunCompleted(w.cardWorld, round.claim);
  expect(ended).toMatchObject({ status: 'ended', outcome: 'completed' });
  savedRun = round.claim.runRef;
  const drive = async (label: string) => {
    const before = await readK3Review(w.cardWorld, w.record.ref);
    const result = await w.workflow.advanceWork(w.ctx, performRun('start'));
    expect(result, label).toMatchObject({ status: 'ready', value: { state: 'advance',
      next: { kind: 'perform', operation: { kind: 'settle_review' } } } });
    if (result.status !== 'ready' || result.value.state !== 'advance') throw new Error(JSON.stringify(result));
    const next = result.value.next;
    if (next === null || next.kind !== 'perform') throw new Error(JSON.stringify(next));
    if (next.operation.kind !== 'settle_review') throw new Error(JSON.stringify(next));
    const request = next.operation.request as { input: { reviewRef: unknown; cause: string };
      meta: { expected: unknown; requestId: string } };
    // The request pins the record revision read in the SAME window.
    expect(request.input).toMatchObject({ cause: 'round_ended', reviewRef: before.ref });
    expect(request.meta.expected).toEqual([{ ref: before.ref, revision: before.revision }]);
    return { request, next, before };
  };
  const first = await drive('first request');
  // Perform the first settle through the REAL owner: the record revision moves.
  const settled = await w.workflow.advanceWork(w.ctx, first.next);
  expect(settled).toMatchObject({ status: 'ready', value: { state: 'advance',
    receipt: { kind: 'settle_review', result: { status: 'committed' } } } });
  w.record = await readK3Review(w.cardWorld, w.record.ref);
  expect(w.record.revision).not.toBe(first.before.revision);
  const second = await drive('second request');
  expect(second.request.meta.expected).toEqual([{ ref: w.record.ref, revision: w.record.revision }]);
  expect(first.request.meta.requestId).toBeTruthy();
  expect(second.request.meta.requestId).not.toBe(first.request.meta.requestId);
});

it.each(['memory', 'sqlite'] as const)('K3 L10 (%s): a review-purpose Run with an unknown outcome waits with the normal-end reason', async kind => {
  let savedRun: RunSnapshot['ref'] | null = null;
  const w = await makeRealWorld(kind, { runtime: world => savedRunRuntime(world.records, () => savedRun) });
  await reachUnknownReviewEnd(w);
  const active = w.record.activeRound;
  if (active === null) throw new Error('the unknown review round left no active round');
  savedRun = active.runRef;
  const savedRead = await createRunStateReader({ records: w.cardWorld.records })
    .readExecution(w.ctx, active.runRef);
  if (savedRead.status !== 'ready') throw new Error(`the saved Run is not readable: ${JSON.stringify(savedRead)}`);
  expect(savedRead.value.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  for (const kind of ['start', 'observe'] as const) {
    const result = await w.workflow.advanceWork(w.ctx, performRun(kind));
    expect(result, kind).toMatchObject({ status: 'ready', value: { state: 'waiting',
      reason: `the Run ${active.runRef.runId} ended with outcome outcome_unknown` } });
    if (result.status !== 'ready' || result.value.state !== 'waiting') throw new Error(JSON.stringify(result));
    // An unknown end plans no settlement and no check round.
    expect(result.value.next).toBeNull();
  }
  expect(w.settleCalls).toBe(0);
});

it.each(['memory', 'sqlite'] as const)('K3 settle_review (%s): the owner receipt is preserved field for field and the next selection follows', async kind => {
  // F-045: the Workflow's receipt must carry the owner's whole result unchanged
  // (status, replayed, value and cursor), not only its status. The prior state
  // is a real review round: the public blocked record, the real review claim and
  // the Runtime's own completed end. The Workflow's own `select_work` plans the
  // settlement (UR4: an active round whose Run ended known, `workflow.ts`
  // reviewGate) and this row performs exactly the step it planned; the Runtime
  // port is the world's default one (start/observe unsupported), so no Run entry
  // is answered by a stand-in.
  const w = await makeRealWorld(kind);
  const round = await claimK3ReviewRound(w.cardWorld, w.record);
  await endK3RunCompleted(w.cardWorld, round.claim);
  const before = await readK3Review(w.cardWorld, w.record.ref);
  // Revision 2 = created at 1 (UCR-01) + 1 for the round claim (activeRound).
  expect(before).toMatchObject({ status: 'pending_review', revision: 2,
    activeRound: { runRef: round.claim.runRef } });
  expect(before.rounds).toEqual([]);
  const item = before.items[0];
  if (item === undefined || before.items.length !== 1) throw new Error('the K3 settle row needs its one process item');
  if (before.workspace.status !== 'unavailable') {
    throw new Error(`the K3 settle row expects the not_git capture: ${JSON.stringify(before.workspace)}`);
  }

  const selected = await w.workflow.advanceWork(w.ctx, selectTask('k3-20-a'));
  if (selected.status !== 'ready' || selected.value.next === null || selected.value.next.kind !== 'perform'
    || selected.value.next.operation.kind !== 'settle_review') {
    throw new Error(`the ended round did not plan settle_review: ${JSON.stringify(selected)}`);
  }
  // Selecting plans the settlement and performs nothing.
  expect(w.settleCalls).toBe(0);
  const performed = await w.workflow.advanceWork(w.ctx, selected.value.next);
  if (performed.status !== 'ready' || performed.value.state !== 'advance') throw new Error(JSON.stringify(performed));
  expect(performed).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'select_work' } } });
  expect(w.settleCalls).toBe(1);

  // Hand-computed from the fixed input above and the settled transition
  // (UCR-07, L15/L16/L17, SPEC §L16 line 409): a completed review round with no
  // conclusion turns the pending process item into `undetermined` with the
  // fixed evidence "核对轮没有给出结论" and the fixed self-check "没有自查依据"
  // (SPEC line 1872), adds the finished round, and yields `undetermined` +
  // `crash_undetermined` in the L17 order.
  // Platform-issued values are used as the public steps returned them: the
  // record ref (`w.record`, the blocked-record read), the origin Run, its Session
  // and Task (`w.claim`, the public claim), the Kernel call ref, the arguments
  // digest and the Kernel's wall-clock `tool.started` instant (`before`, the
  // public review read), and the commit cursor (the owner's committed result).
  const callId = `k3-rows-origin-call-${kind}`; // makeRealWorld's one declared call
  const expectedValue: UnknownCallReviewV1 = {
    ref: w.record.ref,
    schemaVersion: 1,
    // created 1 + round claimed 1 + settled 1.
    revision: 3,
    workspaceId: WORKSPACE_SCOPE.workspaceId,
    task: w.claim.task,
    runRef: w.claim.runRef,
    sessionRef: w.claim.sessionRef,
    // RUN-22 human attestation by the S5 fixture's operator, with the harness's
    // own attestation text (`K3-35-continuation-fixture.ts` hostRecord).
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' },
      reason: 'the K3-35 record Run was attested from the real draft' },
    // One declared call, within the 32-item cap (L7): complete, nothing omitted.
    inventory: 'complete',
    inventoryProblem: null,
    items: [{
      alias: 1, // the first call in Kernel order (D8)
      callId,
      toolName: 'shell', // the scripted model's one `shell` call (B2-crr-world)
      kind: 'process', // L3 table row 7: `shell` -> process, contained
      contained: true,
      kernel: item.kernel,
      argumentsDigest: item.argumentsDigest,
      // `npm run build` (13 bytes <= 512) with no cwd; a process call has no
      // mode and no paths.
      summary: { command: 'npm run build', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
      startedAt: item.startedAt,
      observed: {
        verdict: 'undetermined', by: 'settlement', evidence: '核对轮没有给出结论',
        roundRunRef: null,
        crashSuspicion: { verdict: 'undetermined', evidence: '没有自查依据' },
        reviewerConclusion: null,
      },
    }],
    itemsOmitted: 0,
    // The world's temp root is not a git work tree and the continuation prepare
    // wires no run-start baseline: `not_git`, baseline unknown. The spec fixes no
    // wording for `detail` (SPEC line 976, `string ≤500`), so the platform's text
    // is used as the public read returned it.
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_git',
      detail: before.workspace.detail },
    // The first record on this Task: no prior auto cleanup, no prior unknown
    // process, no reset.
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    status: 'needs_decision',
    open: 'yes',
    decisionReasons: ['undetermined', 'crash_undetermined'],
    // D7: the one process item is the disposition and the proposal target.
    dispositionTargets: [callId],
    proposalTargets: [callId],
    // 1 at creation; no awaiting_proposal entry happened.
    stateEntry: 1,
    activeRound: null,
    rounds: [{ runRef: round.claim.runRef, phase: 'review', round: 1, stateEntry: 1, result: 'finished' }],
    proposals: [],
    // L19a: written only when a disposition is applied; none is.
    blockedCommands: [],
    disposition: null,
    // RUN-22 created the record at the harness Host clock, minute 8
    // (`at(8)`, K3-continuation-pure-fixture); the settlement is written by the
    // K3 world's review owner, whose clock is the S5 fixture's T.
    createdAt: '2026-10-07T10:08:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
  };
  expect(w.settleResults).toHaveLength(1);
  const ownerResult = w.settleResults[0]!;
  if (ownerResult.status !== 'committed') throw new Error(`the settle owner did not commit: ${JSON.stringify(ownerResult)}`);
  expect(ownerResult.cursor).toEqual(expect.any(String));
  const expectedOwnerResult = {
    status: 'committed' as const, replayed: false, value: expectedValue,
    // The commit cursor is platform-issued (A1): the owner's committed result
    // as returned; the receipt must carry the same one.
    cursor: ownerResult.cursor,
  };
  // The owner's own result and the Workflow receipt, each compared whole and
  // separately with the independent literal.
  expect(ownerResult).toEqual(expectedOwnerResult);
  const receipt = performed.value.receipt as { kind: string; result: unknown };
  expect(receipt.result).toEqual(expectedOwnerResult);
  // The receipt carries that exact owner result, cursor included, unchanged.
  expect(receipt).toEqual({ kind: 'settle_review', result: ownerResult });
});

// -------------------------------------------------------------------------- //
// REAL OWNERS: UR7 hands ② the answer's captured source, not a minimal one
// -------------------------------------------------------------------------- //

it.each(['memory', 'sqlite'] as const)('K3 UR7 real owner (%s): a real answered card emits the captured source and ② applies (not invalid)', async kind => {
  const world = await openK3ReviewCardWorld(kind);
  cardWorlds.push(world);
  const f = world.fixture;
  const record = await world.createRecord('k3-20-a');
  const lookupSource: DecisionSourceV1 = { kind: 'unknown_call_review',
    key: reviewSourceKeyOf(record),
    goalRef: GOAL_B, pins: [] };
  const read = await world.readModel.readDecisionCard(f.ctx, { source: lookupSource });
  if (read.status !== 'ready') throw new Error(`the review card is not readable: ${JSON.stringify(read)}`);
  const card = read.value;
  const answered = await world.decisions.answerDecision(f.ctx, { input: { source: card.source,
    selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [] },
    meta: { requestId: 'k3-real-ur7:answer', expected: card.source.pins } });
  expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'committed' });

  const applied: unknown[] = [];
  const workflow = realOwnerWorkflow(world, { consumerId: 'k3-real-ur7',
    onApplied: result => { applied.push(result); } });

  const selected = await workflow.advanceWork(f.ctx, { schemaVersion: 1, goalRef: GOAL_B,
    flowId: 'k3-real-ur7', sessionHint: null, taskId: 'k3-20-a', kind: 'select_work' });
  expect(selected).toMatchObject({ status: 'ready', value: { state: 'advance',
    next: { kind: 'perform', operation: { kind: 'apply_review_disposition',
      request: { input: { decisionMessageRef: answered.status === 'committed' ? answered.value.ref : null } } } } } });
  if (selected.status !== 'ready' || selected.value.next === null || selected.value.next.kind !== 'perform') {
    throw new Error(JSON.stringify(selected));
  }
  const request = selected.value.next.operation.request as unknown as {
    input: { source: DecisionSourceV1 }; meta: { expected: readonly unknown[] } };
  // The three captured pins (record, original Run, Goal) and the Goal content
  // basis, exactly as the answer saved them — the minimal lookup source would
  // be refused `invalid` by the owner's L19 guard.
  expect(request.input.source.key).toBe(card.source.key);
  expect(request.input.source.goalRef).toEqual(card.source.goalRef);
  expect(request.input.source.pins).toEqual(card.source.pins);
  expect(request.input.source.pins).toHaveLength(3);
  expect(request.meta.expected).toEqual(card.source.pins);

  const performed = await workflow.advanceWork(f.ctx, selected.value.next);
  expect(performed).toMatchObject({ status: 'ready', value: { state: 'advance',
    receipt: { kind: 'apply_review_disposition', result: { status: 'ready',
      value: { state: 'applied', application: { status: 'committed' } } } },
    next: { kind: 'select_work' } } });
  expect(applied).toHaveLength(1);
  expect(applied[0]).toMatchObject({ status: 'committed' });
  const after = await world.reviews.readReview(f.ctx, { ref: record.ref });
  expect(after).toMatchObject({ status: 'ready', value: { status: 'resolved',
    disposition: { choice: 'rerun_as_is', source: 'card' } } });
  const afterCard = await world.readModel.readDecisionCard(f.ctx, { source: lookupSource });
  expect(afterCard).toMatchObject({ status: 'ready', value: { state: 'applied' } });
  const appliedBefore = await world.decisions.readDecisionAnswer(f.ctx, { source: card.source });
  if (appliedBefore.status !== 'ready' || appliedBefore.value.message === null) {
    throw new Error(JSON.stringify(appliedBefore));
  }
  const recordedApplication = appliedBefore.value.message.application;

  // K3-17 both apply orders: the Workflow applied first, so the user's retry of
  // the SAME `resolveDecision` request replays ① and ② (the original receipt)
  // and ③ does not record a second application.
  const retry = await world.decisionActions.resolveDecision(f.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
      text: '', annotations: [] },
    meta: { requestId: 'k3-real-ur7', expected: card.source.pins },
  });
  expect(retry, JSON.stringify(retry)).toMatchObject({ status: 'ready', value: { state: 'applied',
    answer: { status: 'committed', replayed: true },
    action: { status: 'committed', replayed: true },
    application: { status: 'committed' } } });
  // `world.decisionActions` owns the fixture's real ② adapter, so only the
  // Workflow's own adapter call is in `applied`; ②'s replay is proven by the
  // `replayed: true` action above.
  expect(applied).toHaveLength(1);
  const appliedAfter = await world.decisions.readDecisionAnswer(f.ctx, { source: card.source });
  if (appliedAfter.status !== 'ready' || appliedAfter.value.message === null) {
    throw new Error(JSON.stringify(appliedAfter));
  }
  expect(appliedAfter.value.message.application).toEqual(recordedApplication);
  expect(appliedAfter.value.message.revision).toBe(appliedBefore.value.message.revision);
  expect(await world.reviews.readReview(f.ctx, { ref: record.ref })).toEqual(after);
});

// -------------------------------------------------------------------------- //
// REAL OWNERS: K3-17 in REVERSE order (the person applies ② first, then UR7)
// -------------------------------------------------------------------------- //

type RealOwnerWorkflowOptions = {
  /** The Host consumer identity the Workflow configuration carries. */
  consumerId: string;
  /** Observe every real `applyDisposition` result the Workflow's adapter returns. */
  onApplied?: (result: Awaited<ReturnType<K3ReviewCardWorld['reviews']['applyDisposition']>>) => void;
  /** The real mailbox serving handed-over answer refs; defaults to the world's own. */
  messages?: WorkflowDependencies['messages'];
};

/** The one real-owner Workflow over the K3 review-card world (the ~747 pattern). */
function realOwnerWorkflow(world: K3ReviewCardWorld, options: RealOwnerWorkflowOptions): ReturnType<typeof createWorkflow> {
  const f = world.fixture;
  return createWorkflow({
    tasks: f.b2.base.goals, plans: f.b2.base.plans, sessions: f.b2.base.sessionsPort,
    claims: f.b2.base.service, executions: createRunStateReader({ records: f.records }),
    runtime: untouched('runtime'), evidence: untouched('evidence'), checks: untouched('checks'),
    sourceAuthority: untouched('sourceAuthority'),
    configuration: { consumerId: options.consumerId, bindings: [{
      workspace: f.base.scope,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: f.b2.base.roleBinding, budget: f.b2.base.budget }] },
    unknownCallReviews: world.reviews as never,
    // F-100: the SAME real Goal settings owner the decision coordinator uses.
    goalSettings: world.goalSettings,
    decisionMessages: world.decisions as never,
    decisionApplications: { unknown_call_review: { apply: async (ctx, input) => {
      const result = await world.reviews.applyDisposition(ctx, { input: { source: input.source,
        selection: input.selection, decisionMessageRef: input.answerRef },
        meta: { requestId: input.requestId, expected: [...input.expected] } });
      options.onApplied?.(result);
      return { status: 'ready', value: { action: result, receipt: null } };
    } } },
    applicationReceipt: world.applicationReceipt,
    // T3-034: the world's real committed answers, read through its ONE mailbox.
    messages: options.messages ?? world.mailbox,
  });
}

function reviewLookupSource(record: UnknownCallReviewV1): DecisionSourceV1 {
  return { kind: 'unknown_call_review',
    key: reviewSourceKeyOf(record),
    goalRef: GOAL_B, pins: [] };
}

function selectFor(flowId: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: GOAL_B, flowId, sessionHint: null, taskId: 'k3-20-a', kind: 'select_work' };
}

function theUr7Perform(result: WorkflowAdvanceResult): WorkflowAdvanceInput {
  if (result.status !== 'ready' || result.value.next === null || result.value.next.kind !== 'perform'
    || result.value.next.operation.kind !== 'apply_review_disposition') {
    throw new Error(`the Workflow did not select UR7: ${JSON.stringify(result)}`);
  }
  return result.value.next;
}

/** The committed answer message of a card source, read back through the owner. */
async function readAnswerOf(world: K3ReviewCardWorld, source: DecisionSourceV1) {
  const read = await world.decisions.readDecisionAnswer(world.fixture.ctx, { source });
  if (read.status !== 'ready' || read.value.message === null) throw new Error(JSON.stringify(read));
  return read.value.message;
}

/** One answered card whose UR7 request was already selected. */
async function answeredUr7Selection(world: K3ReviewCardWorld, flowId: string) {
  const f = world.fixture;
  const record = await world.createRecord('k3-20-a');
  const lookupSource = reviewLookupSource(record);
  const read = await world.readModel.readDecisionCard(f.ctx, { source: lookupSource });
  if (read.status !== 'ready') throw new Error(`the review card is not readable: ${JSON.stringify(read)}`);
  const card = read.value;
  const answered = await world.decisions.answerDecision(f.ctx, { input: { source: card.source,
    selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [] },
    meta: { requestId: `${flowId}:answer`, expected: card.source.pins } });
  if (answered.status !== 'committed') throw new Error(`the answer did not commit: ${JSON.stringify(answered)}`);
  // F-045: the no-double-apply baseline, taken before the FIRST target operation
  // (the person's ②/③ and the Workflow's later ③). Only ① has committed here.
  const message = await readAnswerOf(world, card.source);
  const baseline = { revision: message.revision, application: message.application ?? null };
  if (baseline.application !== null) throw new Error('the answer was already applied before the row under test');
  const workflow = realOwnerWorkflow(world, { consumerId: flowId });
  const selected = await workflow.advanceWork(f.ctx, selectFor(flowId));
  return { workflow, record, card, lookupSource, baseline, perform: theUr7Perform(selected) };
}

/** The card/record/Task facts after UR7 repaired ③: applied, resolved, no requeue, no extra commit. */
async function expectUr7Applied(
  world: K3ReviewCardWorld, flowId: string,
  context: Awaited<ReturnType<typeof answeredUr7Selection>>,
): Promise<void> {
  const f = world.fixture;
  // F-045: `context.baseline` was read before the person's first ②/③; this
  // read-back is the state the Workflow's later ③ must not advance.
  const beforeApply = await readAnswerOf(world, context.card.source);
  const commitsBefore = f.counts.commits;
  const performed = await context.workflow.advanceWork(f.ctx, context.perform);
  const commitsAfter = f.counts.commits;
  expect(performed, JSON.stringify(performed)).toMatchObject({ status: 'ready', value: { state: 'advance',
    receipt: { kind: 'apply_review_disposition', result: { status: 'ready',
      value: { state: 'applied', action: { status: 'committed', replayed: true },
        application: { status: 'committed' } } } },
    next: { kind: 'select_work' } } });

  const afterCard = await world.readModel.readDecisionCard(f.ctx, { source: context.lookupSource });
  expect(afterCard).toMatchObject({ status: 'ready', value: { state: 'applied' } });
  expect(await world.reviews.readReview(f.ctx, { ref: context.record.ref })).toMatchObject({ status: 'ready',
    value: { status: 'resolved', disposition: { choice: 'rerun_as_is', source: 'card' } } });

  const window = await readGoalPlanWindow(f.records, GOAL_B);
  if (window.status !== 'ready' || window.plan === null) throw new Error(JSON.stringify(window));
  const facts = await readCanonicalTaskFacts(f.records, GOAL_B, window.plan, 'k3-20-a');
  if (facts.status !== 'ready') throw new Error(JSON.stringify(facts));
  expect(facts.value.requeuesByTaskId.get('k3-20-a') ?? [], 'UR7 never requeues').toHaveLength(0);

  // F-045: exactly ONE ③ application exists relative to the pre-apply baseline.
  // When the person's ③ already recorded it, the Workflow's later ③ must add
  // neither a second application nor a message revision (and no commit).
  const afterApply = await readAnswerOf(world, context.card.source);
  expect(afterApply.application ?? null).not.toBeNull();
  expect(afterApply.revision).toBe(context.baseline.revision + 1);
  if (beforeApply.application != null) {
    expect(afterApply.application).toEqual(beforeApply.application);
    expect(afterApply.revision).toBe(beforeApply.revision);
    expect(commitsAfter, 'the later ③ writes nothing').toBe(commitsBefore);
  } else {
    // The person's ③ was refused; the Workflow records the ONE application.
    expect(commitsAfter).toBeGreaterThan(commitsBefore);
  }

  const commitsAfterSecondSelection = f.counts.commits;
  const again = await context.workflow.advanceWork(f.ctx, selectFor(flowId));
  expect(again.status).toBe('ready');
  expect(f.counts.commits, 'the second selection writes nothing').toBe(commitsAfterSecondSelection);
}

it.each(['memory', 'sqlite'] as const)('K3-17 reverse order (%s a): the person applies ② and ③ first; UR7 replays ② and records no second ③', async kind => {
  const world = await openK3ReviewCardWorld(kind);
  cardWorlds.push(world);
  const f = world.fixture;
  const context = await answeredUr7Selection(world, 'k3-17-rev-a');

  // The person is first: ① replays, ② commits for the person, ③ records.
  const first = await world.decisionActions.resolveDecision(f.ctx, {
    input: { source: context.card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
      text: '', annotations: [] },
    meta: { requestId: 'k3-17-rev-a', expected: context.card.source.pins },
  });
  expect(first, JSON.stringify(first)).toMatchObject({ status: 'ready', value: { state: 'applied',
    answer: { status: 'committed', replayed: true },
    action: { status: 'committed', replayed: false },
    application: { status: 'committed' } } });

  await expectUr7Applied(world, 'k3-17-rev-a', context);
});

it.each(['memory', 'sqlite'] as const)('K3-17 reverse order (%s b): the person’s ③ fails; UR7 replays ② and repairs ③ under the operator', async kind => {
  const world = await openK3ReviewCardWorld(kind);
  cardWorlds.push(world);
  const f = world.fixture;
  const context = await answeredUr7Selection(world, 'k3-17-rev-b');

  // The person's ② commits, then the injected ③ commit failure leaves the card
  // `answered_pending_application`.
  world.failNextApplicationCommit();
  const first = await world.decisionActions.resolveDecision(f.ctx, {
    input: { source: context.card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
      text: '', annotations: [] },
    meta: { requestId: 'k3-17-rev-b', expected: context.card.source.pins },
  });
  expect(first, JSON.stringify(first)).toMatchObject({ status: 'ready', value: {
    state: 'application_not_recorded',
    answer: { status: 'committed', replayed: true },
    action: { status: 'committed', replayed: false },
    application: { status: 'rejected', code: 'unavailable' } } });
  const pending = await world.readModel.readDecisionCard(f.ctx, { source: context.lookupSource });
  expect(pending).toMatchObject({ status: 'ready', value: { state: 'answered_pending_application' } });

  // UR7's ② replays the person's commit; ③ is booked under the Host operator,
  // so the slice-5 guard admits it and the card reaches history.
  await expectUr7Applied(world, 'k3-17-rev-b', context);
});

it.each(['memory', 'sqlite'] as const)('K3 UR7b (%s): two real handed-over answers whose ③ fail report the FIRST failure and still advance', async kind => {
  const world = await openK3ReviewCardWorld(kind);
  cardWorlds.push(world);
  const f = world.fixture;
  const answerOf = async (taskId: string, requestId: string) => {
    const record = await world.createRecord(taskId);
    const lookupSource = reviewLookupSource(record);
    const read = await world.readModel.readDecisionCard(f.ctx, { source: lookupSource });
    if (read.status !== 'ready') throw new Error(`the review card is not readable: ${JSON.stringify(read)}`);
    const card = read.value;
    const answered = await world.decisions.answerDecision(f.ctx, { input: { source: card.source,
      selection: { kind: 'option', optionId: 'rerun_as_is' }, text: '', annotations: [] },
      meta: { requestId, expected: card.source.pins } });
    if (answered.status !== 'committed') throw new Error(`the answer did not commit: ${JSON.stringify(answered)}`);
    return { record, card, message: answered.value };
  };
  // TWO answers created through the public card answer: different work tasks,
  // different cards, different request ids, no hand-made message/selection ref.
  const a = await answerOf('k3-20-a', 'k3-ur7b-real:answer-a');
  const b = await answerOf('k3-20-b', 'k3-ur7b-real:answer-b');

  const workflow = realOwnerWorkflow(world, { consumerId: 'k3-ur7b-real' });

  // ③ fails for BOTH, with distinct texts, in the order the answers are processed.
  world.failNextApplicationCommit('injected ③ failure one');
  world.failNextApplicationCommit('injected ③ failure two');
  const result = await workflow.advanceWork(f.ctx, { schemaVersion: 1, goalRef: GOAL_B,
    flowId: 'k3-ur7b-real', sessionHint: null, kind: 'select_work',
    answers: [
      { kind: 'unknown_call_review', reviewRef: a.record.ref, answerMessageRef: a.message.ref },
      { kind: 'unknown_call_review', reviewRef: b.record.ref, answerMessageRef: b.message.ref },
    ] });

  expect(result, JSON.stringify(result)).toMatchObject({ status: 'ready', value: { state: 'advance',
    receipt: { kind: 'apply_review_disposition' }, next: { kind: 'select_work' } } });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(result.value.reason).toContain('unavailable: injected ③ failure one');
  expect(result.value.reason).not.toContain('injected ③ failure two');
  // Both ② committed (both cards resolved) and both ③ were attempted: the real
  // answers are still unapplied, each with its own failed application.
  for (const answer of [a, b]) {
    expect(await world.reviews.readReview(f.ctx, { ref: answer.record.ref })).toMatchObject({
      status: 'ready', value: { status: 'resolved', disposition: { choice: 'rerun_as_is', source: 'card' } } });
    const saved = await world.decisions.readDecisionAnswer(f.ctx, { source: answer.card.source });
    if (saved.status !== 'ready' || saved.value.message === null) throw new Error(JSON.stringify(saved));
    expect(saved.value.message.application, '③ was attempted and did not commit').toBeNull();
  }
});

