/**
 * K3 UR7 rework 1 (answer 7 / Codex item 6): the failed-card set covers BOTH
 * card kinds. The ordinary advance continues after a failed
 * `command_rerun_request` ② exactly as after a failed `unknown_call_review` ②;
 * a later failure never overwrites an earlier one; a named-Task advance keeps
 * its waiting rules; the set is never a public advance input.
 *
 * The world is the real K3 review-card fixture: real Plan/Goal/Session/claim
 * owners, real RUN-20/RUN-22 review records, the real CRR owner and the real
 * public card answers. The two failures are injected at the store commits that
 * the real owners use (fault injection only).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type {
  FailedCardRefV1, WorkflowAdvanceInput, WorkflowAdvanceInternal, WorkflowAdvanceResult,
} from '../../src/business/workflow/contracts.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import { createCollaborationDriver } from '../../src/app/collaboration-driver.js';
import type { WorkflowDependencies, WorkflowHostConfiguration, WorkflowPort } from '../../src/business/workflow/ports.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import type { RegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import type { EvidencePort } from '../../src/core/work-graph/model/evidence-contracts.js';
import {
  createCommandRerunRequestApplicationAdapter,
} from '../../src/business/workflow/decision-actions.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createCommandRerunRequestService } from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import { commandSha256 } from '../../src/core/work-graph/state/command-normalization.js';
import {
  adoptReorderedPlan, createDriverSettledWaiter, createK3NeedsDecisionRecord, interceptDispositionCommits,
  openK3ReviewCardWorld, reviewServiceOver, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import {
  blockedRecord, crrCardOf, CRR_COMMAND, reviewCardOf, workRunCtx,
} from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { messageAt } from '../helpers/S5-application-support.js';
import {
  GOAL_B, WORKSPACE_SCOPE,
} from '../helpers/S5-decision-fixture.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';

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
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

function unsupported(reason: string) {
  return { status: 'rejected' as const, code: 'unsupported' as const, reason };
}

function selectWork(taskId?: string, answers?: WorkflowAdvanceInput['answers']): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: GOAL_B, flowId: 'k3-ur7-crr-flow', sessionHint: null, kind: 'select_work',
    ...(taskId === undefined ? {} : { taskId }), ...(answers === undefined ? {} : { answers }) };
}

function hasKey(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key);
}

/** The real public ① answer for a UCR / CRR card (no ②). */
async function answerUcrCard(world: K3ReviewCardWorld, record: UnknownCallReviewV1, requestId: string) {
  const card = await reviewCardOf(world, record);
  const answered = await world.decisions.answerDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
      text: '', annotations: [] },
    meta: { requestId, expected: card.source.pins },
  });
  expect(answered).toMatchObject({ status: 'committed' });
  if (answered.status !== 'committed') throw new Error(JSON.stringify(answered));
  return answered.value.ref;
}

async function answerCrrCard(world: K3ReviewCardWorld, requestId: string) {
  const card = await crrCardOf(world);
  const answered = await world.decisions.answerDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'allow_rerun' },
      text: '', annotations: [] },
    meta: { requestId, expected: card.source.pins },
  });
  expect(answered).toMatchObject({ status: 'committed' });
  if (answered.status !== 'committed') throw new Error(JSON.stringify(answered));
  return answered.value.ref;
}

/** One REAL `request_command_rerun` write; handles the current reply contract's wrapper. */
async function requestRerunOf(
  world: K3ReviewCardWorld, record: UnknownCallReviewV1, requestId: string,
): Promise<CommandRerunRequestV1> {
  const ctx = await workRunCtx(world, record);
  const written = await world.commandRerun.requestRerun(ctx, {
    input: { task: record.task, runRef: record.runRef, command: CRR_COMMAND,
      reason: 'the migration must really run' } as never,
    meta: { requestId, expected: [] },
  });
  expect(written.status).toBe('committed');
  if (written.status !== 'committed') throw new Error(JSON.stringify(written));
  const value = written.value as unknown as Record<string, unknown>;
  if (typeof value === 'object' && value !== null && 'request' in value
    && typeof value['request'] === 'object' && value['request'] !== null) {
    return value['request'] as unknown as CommandRerunRequestV1;
  }
  return written.value as unknown as CommandRerunRequestV1;
}

/**
 * The real records port with the NEXT matching card-application commit failing
 * `unavailable`. The UCR event is the real `disposition_applied` change; the
 * CRR event is the real `CommandRerunRequestChanged`. Both are produced by the
 * real owners on their normal write path; the test only makes the commit fail.
 */
function failingCardCommits(
  records: K3ReviewCardWorld['records'],
  faults: { ucr?: string; crr?: string },
): K3ReviewCardWorld['records'] {
  const ucrReason = faults.ucr;
  const crrReason = faults.crr;
  // The CRR check stays the inner wrapper: the UCR disposition check runs first,
  // exactly as the one wrapper this replaces did.
  const withCrr = crrReason === undefined ? records : {
    ...records,
    async commit(batch: Parameters<K3ReviewCardWorld['records']['commit']>[0]) {
      if (batch.events.some(event => event.eventType === 'CommandRerunRequestChanged')) {
        return { status: 'rejected' as const, code: 'unavailable' as const, reason: crrReason };
      }
      return records.commit(batch);
    },
  } as K3ReviewCardWorld['records'];
  if (ucrReason === undefined) return withCrr;
  return interceptDispositionCommits(withCrr,
    async () => ({ status: 'rejected', code: 'unavailable', reason: ucrReason }));
}

/** The real CRR owner over `records` (same deps the fixture uses; wrapped store for faults). */
function crrServiceOver(world: K3ReviewCardWorld, records: K3ReviewCardWorld['records']) {
  let sequence = 0;
  return createCommandRerunRequestService({
    records,
    listTaskReviews: async (ctx, { goalRef, taskId }) => {
      const page = await world.reviews.listReviews(ctx, { workspace: WORKSPACE_SCOPE,
        filter: { goalRef, taskId }, page: { limit: 200 } });
      return page.status === 'ready' ? { status: 'ready' as const, value: page.value.items } : page;
    },
    readTaskClosure: async (_ctx, task) => readTaskClosure(records,
      { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
    recognize: async (_ctx, { records: read, command }) => {
      const sha = commandSha256(command);
      for (const record of read) {
        for (const blocked of record.blockedCommands) {
          if (blocked.commandSha256 === sha) {
            return { status: 'ready' as const, value: { reviewRunId: blocked.reviewRunId, alias: blocked.alias,
              commandSha256: sha, match: { kind: 'exact' as const, ...(blocked.actions[0] === undefined
                ? {} : { action: blocked.actions[0] }) } } };
          }
        }
      }
      return { status: 'ready' as const, value: null };
    },
    now: () => world.fixture.now(), eventId: () => `k3-ur7-crr-${String(++sequence)}` });
}

/** Real owners plus the Workflow's decision seams; execution/checks are doubles. */
function assemble(world: K3ReviewCardWorld, options: {
  records?: K3ReviewCardWorld['records'];
  reviews?: WorkflowDependencies['unknownCallReviews'];
  commandRerun?: ReturnType<typeof createCommandRerunRequestService>;
  countCrrApply?: () => void;
} = {}): { workflow: WorkflowPort; crrApplies: () => number } {
  const f = world.fixture;
  const reviews = options.reviews ?? world.reviews;
  const commandRerun = options.commandRerun ?? world.commandRerun;
  let crrApplies = 0;
  const { authority } = createMaterialRecordReaders(f.records);
  const runtime: RuntimeExecutionPort = {
    capabilities: async () => unsupported('K3 UR7 rework never reads capabilities'),
    createSession: async () => unsupported('K3 UR7 rework never creates a Session'),
    readSessionHistory: async () => unsupported('K3 UR7 rework never reads Session history'),
    readExecutionHistory: async () => unsupported('K3 UR7 rework never reads execution history'),
    readTaskExecutionHistory: async () => unsupported('K3 UR7 rework never reads task history'),
    prepareExecution: async () => unsupported('K3 UR7 rework stops before prepare'),
    startRun: async () => unsupported('K3 UR7 rework stops before start'),
    observeRun: async () => unsupported('K3 UR7 rework never observes'),
  };
  const evidence: EvidencePort = {
    openVerification: async () => unsupported('K3 UR7 rework does not open checks'),
    readVerification: async () => unsupported('K3 UR7 rework does not read checks'),
    beginCheck: async () => unsupported('K3 UR7 rework does not begin checks'),
    recordCheckResult: async () => unsupported('K3 UR7 rework does not record checks'),
    finalizeChecks: async () => unsupported('K3 UR7 rework does not finalize checks'),
  };
  const checks: RegisteredCheckRunner = { runRegisteredCheck: async () => unsupported('K3 UR7 rework does not run checks') };
  const configuration: WorkflowHostConfiguration = {
    consumerId: 'k3-ur7-crr-consumer',
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
    decisionApplications: {
      unknown_call_review: {
        async apply(ctx, input) {
          const action = await (reviews as NonNullable<WorkflowDependencies['unknownCallReviews']>).applyDisposition(
            ctx, { input: { source: input.source, selection: input.selection,
              decisionMessageRef: input.answerRef },
            meta: { requestId: input.requestId, expected: input.expected } });
          return { status: 'ready', value: { action, receipt: null } };
        },
      },
      command_rerun_request: createCommandRerunRequestApplicationAdapter({
        async applyAnswer(ctx, request) {
          crrApplies += 1;
          options.countCrrApply?.();
          return commandRerun.applyAnswer(ctx, request);
        },
      }),
    },
    messages: {
      readMessage: async (_ctx: CoreCallContext, ref: SessionMessageRef) => {
        try {
          return { status: 'ready' as const, value: await messageAt(world.fixture.records, ref) };
        } catch {
          return { status: 'rejected' as const, code: 'unavailable' as const, reason: 'the answer message is not readable' };
        }
      },
      readMessageBody: async () => ({ status: 'rejected' as const, code: 'unsupported' as const, reason: 'unused' }),
    } as unknown as NonNullable<WorkflowDependencies['messages']>,
  };
  const workflow = createWorkflow(dependencies);
  return { workflow, crrApplies: () => crrApplies };
}

describe.each(['memory', 'sqlite'] as const)('K3 UR7 (answer 7): the failed-card set covers both card kinds (%s)', kind => {
  it('a failed command_rerun_request ② continues the ordinary advance and carries the request ref', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-e', 'k3-ur7-crr-fail',
      [{ callId: 'k3-ur7-crr-call', command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, 'k3-ur7-crr-request');
    // Another Task's card is already answered, so the ordinary selection after
    // the failed CRR card is another `apply_review_disposition` (the continuous
    // selection keeps the carried set beside that successor).
    const otherRecord = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    // The cards are answered AFTER the reordered Plan is adopted: the UCR
    // answer pins the Goal content basis, so it must be the final one.
    await adoptReorderedPlan(world, { planId: 'PUR7', requestIdPrefix: 'k3-ur7-reorder',
      reasonText: 'K3 UR7 failed-card set reordered Tasks' });
    const answerRef = await answerCrrCard(world, 'k3-ur7-crr-answer');
    await answerUcrCard(world, otherRecord, 'k3-ur7-crr-other-answer');

    const records = failingCardCommits(world.fixture.records, { crr: 'injected command_rerun_request ② failure' });
    const commandRerun = crrServiceOver(world, records);
    const assembled = assemble(world, { records, commandRerun });
    const answers = [{ kind: 'command_rerun_request' as const, requestRef: request.ref,
      answerMessageRef: answerRef }];

    const advanced = await assembled.workflow.advanceWork(world.fixture.ctx, selectWork(undefined, answers));
    expect(advanced.status).toBe('ready');
    if (advanced.status !== 'ready') throw new Error(JSON.stringify(advanced));
    expect(advanced.value.state).toBe('advance');
    expect(advanced.value.next).not.toBeNull();
    expect(advanced.value.reason).toContain('injected command_rerun_request ② failure');
    // The failed card's discriminated ref is carried beside the continuing next.
    expect(advanced.value.failedCardRefs).toEqual<FailedCardRefV1[]>([
      { kind: 'command_rerun_request', requestRef: request.ref },
    ]);
    // The legacy UCR projection stays empty: this is not a review record ref.
    expect(advanced.value).not.toHaveProperty('failedReviewRefs');
    expect(assembled.crrApplies()).toBe(1);

    // A second advance of the same continuous selection is handed the same
    // answer again; the failed request is excluded, so ② is never tried twice.
    const again = await assembled.workflow.advanceWork(world.fixture.ctx, selectWork(undefined, answers),
      { failedCardRefs: advanced.value.failedCardRefs ?? [] });
    expect(again.status).toBe('ready');
    if (again.status !== 'ready') throw new Error(JSON.stringify(again));
    expect(again.value.state).toBe('advance');
    expect(assembled.crrApplies()).toBe(1);
  }, 120_000);

  it('a later CRR failure never overwrites the earlier UCR failure; both refs stay in the set', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const ucrRecord = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    const crrRecord = await blockedRecord(world, 'k3-20-b', 'k3-ur7-mixed-crr',
      [{ callId: 'k3-ur7-mixed-call', command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, crrRecord, 'k3-ur7-mixed-request');
    // A third Task's card is already answered (not handed over), so the
    // selection continues to another `apply_review_disposition` and the union
    // set is observable beside it.
    const otherRecord = await createK3NeedsDecisionRecord(world, 'k3-20-c');
    // Answer after the reordered Plan is adopted (the UCR answer pins its content).
    await adoptReorderedPlan(world, { planId: 'PUR7', requestIdPrefix: 'k3-ur7-reorder',
      reasonText: 'K3 UR7 failed-card set reordered Tasks' });
    const ucrAnswer = await answerUcrCard(world, ucrRecord, 'k3-ur7-mixed-ucr-answer');
    const crrAnswer = await answerCrrCard(world, 'k3-ur7-mixed-crr-reanswer');
    await answerUcrCard(world, otherRecord, 'k3-ur7-mixed-other-answer');

    const records = failingCardCommits(world.fixture.records, {
      ucr: 'injected unknown_call_review ② failure',
      crr: 'injected command_rerun_request ② failure',
    });
    const reviews = reviewServiceOver(world, records, { eventIdPrefix: 'k3-ur7-review-' });
    const commandRerun = crrServiceOver(world, records);
    const assembled = assemble(world, { records, reviews, commandRerun });

    const advanced = await assembled.workflow.advanceWork(world.fixture.ctx, selectWork(undefined, [
      { kind: 'unknown_call_review', reviewRef: ucrRecord.ref, answerMessageRef: ucrAnswer },
      { kind: 'command_rerun_request', requestRef: request.ref, answerMessageRef: crrAnswer },
    ]));
    expect(advanced.status).toBe('ready');
    if (advanced.status !== 'ready') throw new Error(JSON.stringify(advanced));
    expect(advanced.value.state).toBe('advance');
    expect(advanced.value.next).not.toBeNull();
    // Both kinds remain; the later CRR failure appended instead of replacing.
    expect(advanced.value.failedCardRefs).toEqual<FailedCardRefV1[]>([
      { kind: 'unknown_call_review', reviewRef: ucrRecord.ref },
      { kind: 'command_rerun_request', requestRef: request.ref },
    ]);
    // The first failure text still wins.
    expect(advanced.value.reason).toContain('injected unknown_call_review ② failure');
    expect(advanced.value.reason).not.toContain('injected command_rerun_request ② failure');
    // F-077: the ordinary selection continued; there is ONE failed-card
    // expression (`failedCardRefs`, asserted above) and the old public
    // `failedReviewRefs` projection is no longer produced.
    expect(advanced.value).not.toHaveProperty('failedReviewRefs');
  }, 120_000);

  it('a named-Task advance with the same failed CRR card still returns waiting', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-e', 'k3-ur7-named',
      [{ callId: 'k3-ur7-named-call', command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, 'k3-ur7-named-request');
    const answerRef = await answerCrrCard(world, 'k3-ur7-named-reanswer');
    const records = failingCardCommits(world.fixture.records, { crr: 'injected named ② failure' });
    const commandRerun = crrServiceOver(world, records);
    const assembled = assemble(world, { records, commandRerun });

    const advanced = await assembled.workflow.advanceWork(world.fixture.ctx,
      selectWork('k3-20-e', [{ kind: 'command_rerun_request', requestRef: request.ref,
        answerMessageRef: answerRef }]));
    expect(advanced).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null } });
    if (advanced.status !== 'ready') throw new Error(JSON.stringify(advanced));
    expect(advanced.value.reason).toContain('injected named ② failure');
  }, 120_000);

  it('the Host driver carries the CRR failed ref across steps and never puts it in the public input', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-e', 'k3-ur7-driver-crr',
      [{ callId: 'k3-ur7-driver-call', command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, 'k3-ur7-driver-request');
    const otherRecord = await createK3NeedsDecisionRecord(world, 'k3-20-a');
    await adoptReorderedPlan(world, { planId: 'PUR7', requestIdPrefix: 'k3-ur7-reorder',
      reasonText: 'K3 UR7 failed-card set reordered Tasks' });
    const answerRef = await answerCrrCard(world, 'k3-ur7-driver-crr-reanswer');
    await answerUcrCard(world, otherRecord, 'k3-ur7-driver-other-answer');

    const records = failingCardCommits(world.fixture.records, { crr: 'injected driver CRR ② failure' });
    const commandRerun = crrServiceOver(world, records);
    const assembled = assemble(world, { records, commandRerun });
    const answers = [{ kind: 'command_rerun_request' as const, requestRef: request.ref,
      answerMessageRef: answerRef }];

    type Call = { input: WorkflowAdvanceInput; internal: WorkflowAdvanceInternal | undefined;
      result: WorkflowAdvanceResult };
    const calls: Call[] = [];
    let driver: ReturnType<typeof createCollaborationDriver> | null = null;
    const realAdvance = assembled.workflow.advanceWork.bind(assembled.workflow);
    const narrowedWorkflow = {
      async advanceWork(ctx: CoreCallContext, input: WorkflowAdvanceInput,
        internal?: WorkflowAdvanceInternal): Promise<WorkflowAdvanceResult> {
        if (calls.length >= 10) {
          void driver?.stop(ctx, { goalRef: GOAL_B });
          const capped: WorkflowAdvanceResult = { status: 'ready', value: {
            state: 'waiting', receipt: null, next: null, reason: 'K3 UR7 driver cap' } };
          calls.push({ input: structuredClone(input), internal: undefined, result: capped });
          return capped;
        }
        const result = await realAdvance(ctx, input, internal);
        calls.push({ input: structuredClone(input),
          internal: internal === undefined ? undefined : structuredClone(internal),
          result: structuredClone(result) });
        return result;
      },
    } as unknown as WorkflowPort;
    const unused = async (..._args: unknown[]): Promise<never> => {
      throw new Error('the K3 UR7 CRR driver test never calls this dependency');
    };
    const waiter = createDriverSettledWaiter({ failureText: 'the K3 UR7 CRR driver did not settle' });
    driver = createCollaborationDriver({
      workflow: narrowedWorkflow, runtime: unused, sessions: unused,
      executions: { readExecution: unused },
      mailbox: { readMessage: unused, readOutbox: unused }, controls: unused, profiles: [],
      onChange: waiter.onChange,
    } as unknown as Parameters<typeof createCollaborationDriver>[0]);
    try {
      const started = await driver.start(world.fixture.ctx, { advance: selectWork(undefined, answers), queryProfileIds: [] });
      expect(started.status).toBe('ready');
      const settled = await waiter.waitForSettledDriver(driver, world.fixture.ctx);

      // The first step carries the CRR failure; a LATER step is handed the SAME
      // discriminated ref through the internal argument (not the public input).
      expect(calls[0]?.internal?.failedCardRefs).toBeUndefined();
      const carried = calls.filter(call => call.internal?.failedCardRefs?.some(card =>
        card.kind === 'command_rerun_request'
        && card.requestRef.requestId === request.ref.requestId));
      expect(carried.length).toBeGreaterThan(0);
      const ordinary = carried.find(call => call.input.kind === 'select_work');
      expect(ordinary).toBeDefined();
      expect(ordinary?.result).toMatchObject({ status: 'ready', value: { state: 'advance' } });
      if (ordinary?.result.status !== 'ready') throw new Error(JSON.stringify(ordinary?.result));
      expect(ordinary.result.value.next).not.toBeNull();
      // The set never travels inside a public input a caller could send back.
      for (const call of calls) {
        expect(hasKey(call.input, 'failedCardRefs')).toBe(false);
        expect(hasKey(call.input, 'failedReviewRefs')).toBe(false);
      }
      // The failed CRR card is applied once; the driver never re-hands it.
      expect(assembled.crrApplies()).toBe(1);
      expect(settled.state).not.toBe('failed');
    } finally {
      await driver.close();
    }
  }, 120_000);
});
