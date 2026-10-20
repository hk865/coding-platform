/**
 * K3 group 4 rework 2 (K3-46): a refused ② must not end an ordinary advance,
 * and the T02 Goal-content refusal must be told apart from a version race.
 *
 * The world is the real K3 review-card fixture (`openK3ReviewCardWorld`): real
 * Plan/Goal/Session/claim owners over the frozen S5 fixture, real review
 * records through RUN-20/RUN-22 and the real public card answer (①). The
 * Workflow is driven only through `createWorkflow(...).advanceWork`; the
 * execution/checks owners are the S5 doubles. Store faults are injected with a
 * wrapped records port (as K3-17 does), never by hand-made records.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type {
  WorkflowAdvanceInput, WorkflowAdvanceInternal, WorkflowAdvanceResult,
} from '../../src/business/workflow/contracts.js';
import {
  createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest, type CoreRoutePlatform,
} from '../../src/app/core-routes.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import type { WorkflowDependencies, WorkflowHostConfiguration, WorkflowPort } from '../../src/business/workflow/ports.js';
import { createCollaborationDriver } from '../../src/app/collaboration-driver.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import {
  adoptReorderedPlan, createDriverSettledWaiter, createK3NeedsDecisionRecord, interceptDispositionCommits,
  openK3ReviewCardWorld, reviewServiceOver, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import {
  GOAL_B, WORKSPACE_SCOPE,
} from '../helpers/S5-decision-fixture.js';
import { goalAt } from '../helpers/S5-application-support.js';
import { readGoalPhase } from '../../src/core/work-graph/tasks/plan-readers.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its first call so RUN-20/RUN-22 read a real
// unresolved call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

function unsupported(reason: string) {
  return { status: 'rejected' as const, code: 'unsupported' as const, reason };
}

function selectWork(taskId?: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: GOAL_B, flowId: 'k3-46-flow', sessionHint: null, kind: 'select_work',
    ...(taskId === undefined ? {} : { taskId }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The Task an advance's next operation targets (`claim_task` input or a step's `taskRef`). */
function targetTaskId(next: WorkflowAdvanceInput | null): string | null {
  if (next === null || next.kind !== 'perform') return null;
  const operation = next.operation as unknown as Record<string, unknown>;
  const request = operation['request'];
  if (isRecord(request)) {
    const input = request['input'];
    if (isRecord(input) && typeof input['taskId'] === 'string') return input['taskId'];
  }
  const taskRef = operation['taskRef'];
  if (isRecord(taskRef) && typeof taskRef['taskId'] === 'string') return taskRef['taskId'];
  return null;
}

async function cardOf(world: K3ReviewCardWorld, record: UnknownCallReviewV1) {
  const page = await world.cardSource.readPage(world.fixture.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
    page: { limit: 100 } });
  if (page.status !== 'ready') throw new Error(`the card page failed: ${JSON.stringify(page)}`);
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  const card = page.value.items.find(item => item.source.key === key);
  if (card === undefined) throw new Error(`the card ${key} is not on the source page`);
  return card;
}

/** The real public ① answer for the record's current card. */
async function answerCard(world: K3ReviewCardWorld, record: UnknownCallReviewV1, requestId: string) {
  const card = await cardOf(world, record);
  const answered = await world.decisions.answerDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
      text: 'K3-46 answer', annotations: [] },
    meta: { requestId, expected: card.source.pins },
  });
  expect(answered).toMatchObject({ status: 'committed' });
  if (answered.status !== 'committed') throw new Error(JSON.stringify(answered));
  return { card, answered };
}

/** The real review owner over `records` (a store-fault wrapper in the item-1/2 races). */
function reviewService(world: K3ReviewCardWorld, options: {
  records?: K3ReviewCardWorld['records'];
  countApply?: (count: number) => void;
} = {}) {
  const records = options.records ?? world.fixture.records;
  const base = records === world.fixture.records ? world.reviews
    : reviewServiceOver(world, records, { eventIdPrefix: 'k3-46-review-' });
  if (options.countApply === undefined) return base;
  let calls = 0;
  return { ...base, async applyDisposition(...args: Parameters<typeof base.applyDisposition>) {
    calls += 1;
    options.countApply?.(calls);
    return base.applyDisposition(...args);
  } };
}

/** The real owners plus the Workflow's decision seams; execution/checks are doubles. */
function assemble(world: K3ReviewCardWorld, options: {
  records?: K3ReviewCardWorld['records'];
  reviews?: WorkflowDependencies['unknownCallReviews'];
} = {}) {
  const f = world.fixture;
  const reviews = options.reviews ?? world.reviews;
  const { authority } = createMaterialRecordReaders(f.records);
  const runtime: RuntimeExecutionPort = {
    capabilities: async () => unsupported('K3-46 never reads capabilities'),
    createSession: async () => unsupported('K3-46 never creates a Session'),
    readSessionHistory: async () => unsupported('K3-46 never reads Session history'),
    readExecutionHistory: async () => unsupported('K3-46 never reads execution history'),
    readTaskExecutionHistory: async () => unsupported('K3-46 never reads task history'),
    prepareExecution: async () => unsupported('K3-46 stops before prepare'),
    startRun: async () => unsupported('K3-46 stops before start'),
    observeRun: async () => unsupported('K3-46 never observes'),
  };
  const evidence: EvidencePort = {
    openVerification: async () => unsupported('K3-46 does not open checks'),
    readVerification: async () => unsupported('K3-46 does not read checks'),
    beginCheck: async () => unsupported('K3-46 does not begin checks'),
    recordCheckResult: async () => unsupported('K3-46 does not record checks'),
    finalizeChecks: async () => unsupported('K3-46 does not finalize checks'),
  };
  const checks: RegisteredCheckRunner = { runRegisteredCheck: async () => unsupported('K3-46 does not run checks') };
  const configuration: WorkflowHostConfiguration = {
    consumerId: 'k3-46-consumer',
    bindings: [{
      workspace: WORKSPACE_SCOPE,
      sessionRole: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' },
      roleBinding: f.runRB.roleBinding,
      budget: f.runRA.budget,
    }],
  };
  const plans = createPlanService({ records: f.records, now: f.now, eventId: f.newId });
  const goalSettings = createGoalSettingsService({ records: f.records, now: f.now, newId: f.newId,
    operatorActor: f.operatorActor });
  const dependencies: WorkflowDependencies = {
    tasks: createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks,
    plans,
    sessions: createSessionDirectory({ records: f.records, lookups: f.records }),
    claims: createTaskClaimService({ records: f.records, now: f.now, newId: f.newId,
      roles: createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId }) }),
    executions: createRunStateReader({ records: f.records }),
    runtime, evidence, checks,
    sourceAuthority: createSourceAuthorityReader({ authority }),
    configuration, goalSettings,
    decisionMessages: world.decisions as unknown as NonNullable<WorkflowDependencies['decisionMessages']>,
    unknownCallReviews: reviews,
    applicationReceipt: world.applicationReceipt,
    decisionApplications: { unknown_call_review: {
      async apply(ctx, input) {
        if (reviews === undefined) return { status: 'ready', value: { action: null, receipt: null } };
        const action = await reviews.applyDisposition(ctx, { input: {
          source: input.source, selection: input.selection, decisionMessageRef: input.answerRef },
        meta: { requestId: input.requestId, expected: input.expected } });
        return { status: 'ready', value: { action, receipt: null } };
      },
    } },
  };
  return createWorkflow(dependencies);
}

/** A records port whose disposition commits keep failing `unavailable` (item 1). */
function failingDispositionRecords(
  records: K3ReviewCardWorld['records'], reason: string,
): K3ReviewCardWorld['records'] {
  return interceptDispositionCommits(records,
    async () => ({ status: 'rejected', code: 'unavailable', reason }));
}

/**
 * K3-46 item 1: the real records port with every disposition commit persistently
 * failing `unavailable`, whose text names the card's own Run (the event's
 * `review.ref.runId`) so the drive can prove which cards it reported.
 */
function failingDispositionRecordsPerCard(
  records: K3ReviewCardWorld['records'], prefix: string,
): K3ReviewCardWorld['records'] {
  return interceptDispositionCommits(records, async ({ event }) => {
    const body = JSON.parse(event.json) as { review?: { ref?: { runId?: unknown } } };
    const runId = typeof body.review?.ref?.runId === 'string' ? body.review.ref.runId : 'an unknown Run';
    return { status: 'rejected', code: 'unavailable', reason: `${prefix}: ${runId}` };
  });
}

/** The `UnknownCallReview` runIds an apply step's captured pins name. */
function applyReviewRunIds(input: WorkflowAdvanceInput): string[] {
  if (input.kind !== 'perform' || input.operation.kind !== 'apply_review_disposition') return [];
  const runIds: string[] = [];
  for (const pin of input.operation.request.meta.expected) {
    const ref = (pin as { ref?: { aggregateType?: unknown; runId?: unknown } }).ref;
    if (ref?.aggregateType === 'UnknownCallReview' && typeof ref.runId === 'string') runIds.push(ref.runId);
  }
  return runIds;
}

/** A records port that runs the real Goal pause right before the disposition commit (item 2 race). */
function pausedBeforeDisposition(
  world: K3ReviewCardWorld,
  onConflict: (reason: string) => void,
): K3ReviewCardWorld['records'] {
  const records = world.fixture.records;
  const goals = createGoalService({ records, now: world.fixture.now, eventId: world.fixture.newId }).tasks;
  let fired = false;
  const control = async (action: 'pause' | 'resume', requestId: string) => {
    const goal = await goalAt(records, GOAL_B);
    const phase = await readGoalPhase(records, { aggregateType: 'GoalPhase', projectId: GOAL_B.projectId,
      goalId: GOAL_B.goalId });
    if (phase.status !== 'ready') throw new Error(`the GoalPhase read failed: ${JSON.stringify(phase)}`);
    return goals.setGoalControl(world.fixture.ctx, {
      input: { goalRef: GOAL_B, control: action, reason: null },
      meta: { requestId, expected: [
        { ref: GOAL_B, revision: goal.revision },
        { ref: { aggregateType: 'GoalPhase', projectId: GOAL_B.projectId, goalId: GOAL_B.goalId },
          revision: phase.snapshot?.revision ?? 0 },
      ] },
    });
  };
  return interceptDispositionCommits(records, async ({ commit }) => {
    if (!fired) {
      fired = true;
      const paused = await control('pause', 'k3-46-goal-race-pause');
      expect(paused).toMatchObject({ status: 'committed', value: { desiredState: 'paused' } });
    }
    const result = await commit();
    if (result.status !== 'committed' && result.code === 'revision_conflict') onConflict(result.reason);
    return result;
  });
}

function ready(value: WorkflowAdvanceResult) {
  expect(value.status).toBe('ready');
  if (value.status !== 'ready') throw new Error(JSON.stringify(value));
  return value.value;
}

function hasFailedReviewRefs(value: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'failedReviewRefs');
}

function hasFailedCardRefs(value: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'failedCardRefs');
}

/**
 * The REAL public route layer over the assembled Workflow. Every platform group
 * the `workflow/advance` route does not touch is an inert stub (the K3-15
 * pattern); the workflow group is the real assembled owner, so the route's
 * plain `advanceWork(ctx, input)` is what runs and no internal argument is
 * forwarded.
 */
function routedWorkflowBindings(workflow: WorkflowPort) {
  const stubFn = async () => ({
    status: 'rejected' as const, code: 'unsupported' as const, reason: 'the K3-46 route test stub is not a real owner',
  });
  const stub = new Proxy({}, { get: () => stubFn });
  // Only `advanceWork` is real: the sibling `workflow/*` bindings the route does
  // not exercise answer the same inert stub as every unprovided group.
  const workflowGroup = new Proxy({ advanceWork: workflow.advanceWork.bind(workflow) },
    { get: (target, key) => key in target ? Reflect.get(target, key) : stubFn });
  const platform = new Proxy(
    { workflow: workflowGroup },
    { get: (target, key) => key in target ? Reflect.get(target, key) : stub },
  ) as unknown as CoreRoutePlatform;
  return createPlatformCoreRouteBindings(platform);
}

/** `parseCoreRouteRequest` + `dispatchCoreRoute` over the REAL `workflow/advance` route. */
function routeAdvance(
  bindings: ReturnType<typeof createPlatformCoreRouteBindings>,
  world: K3ReviewCardWorld,
  input: unknown,
): Promise<unknown> {
  const parsed = parseCoreRouteRequest('workflow/advance', {
    scope: { projectId: world.fixture.ctx.projectId, workspaceId: world.fixture.ctx.workspaceId },
    input,
  });
  if (!parsed.ok) throw new Error(`the K3-46 route request did not parse: ${parsed.rejection.reason}`);
  return dispatchCoreRoute(bindings, 'workflow/advance', world.fixture.ctx, parsed);
}

describe('K3-46 (一) a refused ② skips that review card in the ordinary advance', () => {
  it.each(['memory', 'sqlite'] as const)('K3-46 (一) (%s) ordinary: one advance claims task 2 and reports task 1\'s refused ② reason', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    await adoptReorderedPlan(world, { planId: 'PB3', requestIdPrefix: 'k3-46-reorder',
      reasonText: 'K3-46 reordered Tasks' });
    await answerCard(world, record, 'k3-46-ordinary-answer');

    let applies = 0;
    const records = failingDispositionRecords(world.fixture.records, 'injected ② commit failure');
    const workflow = assemble(world, { records,
      reviews: reviewService(world, { records, countApply: count => { applies = count; } }) });

    const selected = ready(await workflow.advanceWork(world.fixture.ctx, selectWork()));
    expect(selected.state).toBe('advance');
    expect(selected.next).toMatchObject({ kind: 'perform', operation: { kind: 'apply_review_disposition' } });
    if (selected.next === null) throw new Error('the ordinary selection returned no apply step');
    expect(selected.next.taskId).toBeUndefined();

    const advanced = ready(await workflow.advanceWork(world.fixture.ctx, selected.next));
    // The advance did not stop at the refused ②: it kept the apply receipt,
    // reported the first failure and selected the next ordinary Task.
    expect(advanced.state).toBe('advance');
    expect(advanced.receipt).toMatchObject({ kind: 'apply_review_disposition' });
    expect(advanced.reason).toContain('unavailable: ');
    expect(advanced.reason).toContain('injected ② commit failure');
    expect(advanced.next?.kind).toBe('perform');
    if (advanced.next?.kind !== 'perform') throw new Error(JSON.stringify(advanced.next));
    expect(advanced.next.operation.kind).not.toBe('apply_review_disposition');
    expect(targetTaskId(advanced.next)).toBe('k3-20-b');
    expect(applies).toBe(1);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-46 (一) (%s) designated: a refused ② on the designated Task still answers waiting with the reason', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    await answerCard(world, record, 'k3-46-designated-answer');

    const records = failingDispositionRecords(world.fixture.records, 'injected ② commit failure');
    const workflow = assemble(world, { records, reviews: reviewService(world, { records }) });

    const selected = ready(await workflow.advanceWork(world.fixture.ctx, selectWork('k3-20-a')));
    expect(selected.state).toBe('advance');
    expect(selected.next).toMatchObject({ kind: 'perform', taskId: 'k3-20-a',
      operation: { kind: 'apply_review_disposition' } });
    if (selected.next === null) throw new Error('the designated selection returned no apply step');

    const waited = ready(await workflow.advanceWork(world.fixture.ctx, selected.next));
    expect(waited.state).toBe('waiting');
    expect(waited.next).toBeNull();
    expect(waited.receipt).toMatchObject({ kind: 'apply_review_disposition' });
    expect(waited.reason).toMatch(/^unavailable: /);
    expect(waited.reason).toContain('injected ② commit failure');
  }, 120_000);
});

describe('K3-46 (二) the T02 refusal is told apart from a Goal version race', () => {
  it.each(['memory', 'sqlite'] as const)('K3-46 (二) (%s) race: a concurrent Goal pause reports the real revision_conflict reason, not T02', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    await answerCard(world, record, 'k3-46-race-answer');

    let rejectedReason: string | null = null;
    const records = pausedBeforeDisposition(world, (reason) => { if (rejectedReason === null) rejectedReason = reason; });
    const workflow = assemble(world, { records, reviews: reviewService(world, { records }) });

    const selected = ready(await workflow.advanceWork(world.fixture.ctx, selectWork('k3-20-a')));
    expect(selected.next).toMatchObject({ kind: 'perform', taskId: 'k3-20-a',
      operation: { kind: 'apply_review_disposition' } });
    if (selected.next === null) throw new Error('the designated selection returned no apply step');

    const waited = ready(await workflow.advanceWork(world.fixture.ctx, selected.next));
    expect(waited.state).toBe('waiting');
    expect(waited.next).toBeNull();
    expect(waited.receipt).toMatchObject({ kind: 'apply_review_disposition' });
    expect(waited.reason).not.toBe('目标的内容变了，这个答复不能落实');
    expect(rejectedReason).not.toBeNull();
    // The record store's frozen revision-conflict sentence, composed by the
    // Workflow as `<code>: <reason>`; written out instead of copying the
    // captured production reason.
    expect(waited.reason).toBe('revision_conflict: record version changed');
    expect(waited.reason).toContain('revision_conflict: ');
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-46 (二) (%s) T02: a real Plan adoption after the answer still waits with the T02 sentence', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    await answerCard(world, record, 'k3-46-t02-answer');
    // Adopt the reordered real Plan revision AFTER the answer captured @PB2.
    await adoptReorderedPlan(world, { planId: 'PB3', requestIdPrefix: 'k3-46-reorder',
      reasonText: 'K3-46 reordered Tasks' });

    const workflow = assemble(world);
    const selected = ready(await workflow.advanceWork(world.fixture.ctx, selectWork('k3-20-a')));
    expect(selected.next).toMatchObject({ kind: 'perform', taskId: 'k3-20-a',
      operation: { kind: 'apply_review_disposition' } });
    if (selected.next === null) throw new Error('the designated selection returned no apply step');

    const waited = ready(await workflow.advanceWork(world.fixture.ctx, selected.next));
    expect(waited.state).toBe('waiting');
    expect(waited.next).toBeNull();
    expect(waited.receipt).toMatchObject({ kind: 'apply_review_disposition' });
    expect(waited.reason).toBe('目标的内容变了，这个答复不能落实');
  }, 120_000);
});

describe('K3-46 (三) the continuous Host advance carries the failed cards and reaches claimable C', () => {
  it.each(['memory', 'sqlite'] as const)('K3-46 (三) (%s) continuous: A and B fail ② once each and C is claimed in one drive', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const recordA = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    const recordB = await createK3NeedsDecisionRecord(world, 'k3-20-b');
    await adoptReorderedPlan(world, { planId: 'PB3', requestIdPrefix: 'k3-46-reorder',
      reasonText: 'K3-46 reordered Tasks' });
    await answerCard(world, recordA, 'k3-46-continuous-answer-a');
    await answerCard(world, recordB, 'k3-46-continuous-answer-b');

    // The real blocked Runs for A and B leave their own Sessions' Kernel turns
    // open, and the fixture's two Sessions still hold b-work (running) and
    // b-work-2 (claimed); one real idle Session is what lets the same drive
    // claim C instead of stopping at a `create_session` step.
    await world.fixture.createS5Session('k3-46-continuous-c');

    const failureText = 'injected ② commit failure';
    const records = failingDispositionRecordsPerCard(world.fixture.records, failureText);
    const workflow = assemble(world, { records, reviews: reviewService(world, { records }) });

    type AdvanceCall = { input: WorkflowAdvanceInput; result: WorkflowAdvanceResult };
    const calls: AdvanceCall[] = [];
    let driver: ReturnType<typeof createCollaborationDriver> | null = null;
    const realAdvance = workflow.advanceWork.bind(workflow);
    const narrowedWorkflow = {
      // The book's continuous drive: the Host forwards each `next` itself. The
      // cap only keeps the RED (busy-looping) run bounded; GREEN settles at the
      // prepare refusal after five calls and never reaches it.
      async advanceWork(ctx: CoreCallContext, input: WorkflowAdvanceInput,
        internal?: WorkflowAdvanceInternal): Promise<WorkflowAdvanceResult> {
        if (calls.length >= 8) {
          void driver?.stop(ctx, { goalRef: GOAL_B });
          const capped: WorkflowAdvanceResult = { status: 'ready', value: {
            state: 'waiting', receipt: null, next: null, reason: 'K3-46 continuous drive cap' } };
          calls.push({ input: structuredClone(input), result: capped });
          return capped;
        }
        const result = await realAdvance(ctx, input, internal);
        calls.push({ input: structuredClone(input), result: structuredClone(result) });
        return result;
      },
    } as unknown as WorkflowPort;
    const unusedDriverPort = async (..._args: unknown[]): Promise<never> => {
      throw new Error('the K3-46 continuous driver test never calls this dependency');
    };

    const waiter = createDriverSettledWaiter({ failureText: 'the K3-46 continuous driver did not settle' });
    driver = createCollaborationDriver({
      workflow: narrowedWorkflow,
      runtime: unusedDriverPort,
      sessions: unusedDriverPort,
      executions: { readExecution: unusedDriverPort },
      mailbox: { readMessage: unusedDriverPort, readOutbox: unusedDriverPort },
      controls: unusedDriverPort,
      profiles: [],
      onChange: waiter.onChange,
    } as unknown as Parameters<typeof createCollaborationDriver>[0]);

    try {
      const started = await driver.start(world.fixture.ctx, { advance: selectWork(), queryProfileIds: [] });
      expect(started.status).toBe('ready');
      const settled = await waiter.waitForSettledDriver(driver, world.fixture.ctx);

      const runIdToTask = new Map([[recordA.ref.runId, 'k3-20-a'], [recordB.ref.runId, 'k3-20-b']]);
      const appliedTasks: string[] = [];
      const reasons: string[] = [];
      const cClaims: AdvanceCall[] = [];
      for (const call of calls) {
        if (call.result.status !== 'ready') continue;
        if (call.result.value.reason !== null) reasons.push(call.result.value.reason);
        if (call.result.value.receipt?.kind === 'apply_review_disposition') {
          for (const runId of applyReviewRunIds(call.input)) {
            const taskId = runIdToTask.get(runId);
            if (taskId !== undefined) appliedTasks.push(taskId);
          }
        }
        if (targetTaskId(call.input) === 'k3-20-c') cClaims.push(call);
      }

      // The drive reached claimable C before the (refused) prepare step ended it.
      expect(cClaims).toHaveLength(1);
      const cClaim = cClaims[0]!;
      expect(cClaim.result).toMatchObject({ status: 'ready', value: {
        receipt: { kind: 'claim_task', result: { status: 'committed' } } } });

      // Each failing card was applied exactly once (no A -> B -> A alternation),
      // and the failed refs were carried forward rather than rebuilt per card.
      expect(appliedTasks.sort()).toEqual(['k3-20-a', 'k3-20-b']);

      // Both cards' own failure texts were reported by the drive.
      const textA = `${failureText}: ${recordA.ref.runId}`;
      const textB = `${failureText}: ${recordB.ref.runId}`;
      expect(reasons.some(reason => reason.includes(textA))).toBe(true);
      expect(reasons.some(reason => reason.includes(textB))).toBe(true);

      // GREEN ends at the prepare refusal (five advances), waiting; the cap is
      // only the RED run's bounded stop and must never be the natural end.
      expect(settled.state).toBe('waiting');
      expect(calls.length).toBe(5);
    } finally {
      await driver.close();
    }
  }, 120_000);

});

describe('rejects: the failed-card set is never a public advance input', () => {
  it.each(['memory', 'sqlite'] as const)('K3-46 (三) (%s) input: every public failedReviewRefs is refused invalid, even a real same-project card', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    const workflow = assemble(world);

    // The set is not public input at all: an own key of ANY shape is refused
    // `invalid` and the reason names the key, so the caller learns it can never
    // be sent. The dangerous shape is a real card of this project; the other
    // field name the frozen Workflow also refuses is `failedCardRefs`.
    const publicInputs: { key: 'failedReviewRefs' | 'failedCardRefs'; value: unknown }[] = [
      { key: 'failedReviewRefs', value: 'not-an-array' },
      { key: 'failedReviewRefs', value: [{}] },
      { key: 'failedReviewRefs', value: [{ aggregateType: 'UnknownCallReview', projectId: 'another-project',
        goalId: GOAL_B.goalId, runId: 'R1' }] },
      { key: 'failedReviewRefs', value: [record.ref] },
      { key: 'failedReviewRefs', value: [] },
      { key: 'failedCardRefs', value: [] },
    ];
    for (const { key, value } of publicInputs) {
      const rejected = await workflow.advanceWork(world.fixture.ctx,
        { ...selectWork(), [key]: value } as unknown as WorkflowAdvanceInput);
      expect(rejected).toMatchObject({ status: 'rejected', code: 'invalid' });
      if (rejected.status !== 'rejected') throw new Error(JSON.stringify(rejected));
      expect(rejected.reason).toContain(key);
    }
    // Every refusal left the real card untouched (public read).
    expect(await world.reviews.readReview(world.fixture.ctx, { ref: record.ref })).toMatchObject({
      status: 'ready', value: { status: 'needs_decision', revision: record.revision } });
    // Without either key the same public advance still works, and no returned
    // `next` ever carries either field name.
    const fresh = await workflow.advanceWork(world.fixture.ctx, selectWork());
    expect(fresh.status).toBe('ready');
    if (fresh.status === 'ready' && fresh.value.next !== null) {
      expect(hasFailedReviewRefs(fresh.value.next)).toBe(false);
      expect(hasFailedCardRefs(fresh.value.next)).toBe(false);
    }
  }, 120_000);
});

describe('K3-46 (三) the public route cannot carry the failed cards', () => {
  it.each(['memory', 'sqlite'] as const)('K3-46 (三) (%s) route: a real answered card ref is refused invalid, then the card still applies without it', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    await answerCard(world, record, 'k3-46-route-answer');
    const workflow = assemble(world);
    const bindings = routedWorkflowBindings(workflow);

    // Forging a REAL same-project card that has an applicable answer must not
    // skip it: the public route refuses the key before anything is selected.
    const forged = await routeAdvance(bindings, world,
      { ...selectWork('k3-20-a'), failedReviewRefs: [record.ref] }) as WorkflowAdvanceResult;
    expect(forged).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (forged.status !== 'rejected') throw new Error(JSON.stringify(forged));
    expect(forged.reason).toContain('failedReviewRefs');

    // The same advance WITHOUT the key selects the card's apply step, and
    // performing that step through the route really applies the answer.
    const selected = ready(await routeAdvance(bindings, world, selectWork('k3-20-a')) as WorkflowAdvanceResult);
    expect(selected.next).toMatchObject({ kind: 'perform', taskId: 'k3-20-a',
      operation: { kind: 'apply_review_disposition' } });
    if (selected.next === null) throw new Error('the route returned no apply step');
    const applied = ready(await routeAdvance(bindings, world, selected.next) as WorkflowAdvanceResult);
    expect(applied.state).toBe('advance');
    expect(applied.receipt).toMatchObject({ kind: 'apply_review_disposition', result: {
      status: 'ready', value: { state: 'applied', application: { status: 'committed' } } } });
    expect(applied.reason).toBeNull();
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-46 (三) (%s) route: a failed apply hands the set beside a continuing next, never inside it', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const recordA = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    const recordB = await createK3NeedsDecisionRecord(world, 'k3-20-b');
    await adoptReorderedPlan(world, { planId: 'PB3', requestIdPrefix: 'k3-46-reorder',
      reasonText: 'K3-46 reordered Tasks' });
    await answerCard(world, recordA, 'k3-46-route-failure-answer-a');
    await answerCard(world, recordB, 'k3-46-route-failure-answer-b');
    const records = failingDispositionRecords(world.fixture.records, 'injected ② commit failure');
    const workflow = assemble(world, { records, reviews: reviewService(world, { records }) });
    const bindings = routedWorkflowBindings(workflow);

    // A is answered first in the reordered plan, so the ordinary selection hands
    // back A's apply step; performing it through the route fails A's ②.
    const selected = ready(await routeAdvance(bindings, world, selectWork()) as WorkflowAdvanceResult);
    expect(selected.next).toMatchObject({ kind: 'perform',
      operation: { kind: 'apply_review_disposition' } });
    if (selected.next === null) throw new Error('the ordinary selection returned no apply step');
    expect(applyReviewRunIds(selected.next)).toEqual([recordA.ref.runId]);

    const continued = ready(await routeAdvance(bindings, world, selected.next) as WorkflowAdvanceResult);
    expect(continued.receipt).toMatchObject({ kind: 'apply_review_disposition' });
    expect(continued.reason).toContain('injected ② commit failure');
    // Rework-3 lifetime: B's apply step is an `apply_review_disposition`
    // successor, so the failed A set is handed over BESIDE it — never inside a
    // next input a caller could send back.
    expect(continued.next).not.toBeNull();
    expect(hasFailedReviewRefs(continued.next)).toBe(false);
    expect(continued.failedCardRefs).toEqual([{ kind: 'unknown_call_review', reviewRef: recordA.ref }]);
    if (continued.next === null) throw new Error('the failed A advance returned no B apply step');
    if (continued.next.kind !== 'perform') throw new Error(JSON.stringify(continued.next));
    expect(continued.next.operation.kind).toBe('apply_review_disposition');
    expect(applyReviewRunIds(continued.next)).toEqual([recordB.ref.runId]);

    // B fails too; its successor is a claim/start step, NOT a continuation of
    // the selection, so the set is dropped and no next carries the key.
    // B's apply step is performed the way the Host driver does it: the internal
    // A set is forwarded with the step (the public route cannot carry it), so
    // the selection after B's failure excludes A and B and reaches C.
    const afterB = ready(await workflow.advanceWork(world.fixture.ctx, continued.next,
      { failedCardRefs: [{ kind: 'unknown_call_review', reviewRef: recordA.ref }] }));
    expect(afterB.receipt).toMatchObject({ kind: 'apply_review_disposition' });
    expect(afterB.next).not.toBeNull();
    expect(hasFailedReviewRefs(afterB.next)).toBe(false);
    expect(afterB).not.toHaveProperty('failedReviewRefs');
    if (afterB.next?.kind !== 'perform') throw new Error(JSON.stringify(afterB.next));
    expect(afterB.next.operation.kind).not.toBe('apply_review_disposition');
  }, 120_000);
});

