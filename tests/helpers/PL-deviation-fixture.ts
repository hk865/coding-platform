/**
 * PL P7 deviation fixture: the real Host world plus the few steps the deviation
 * rows need. It composes `openPLReadingsWorld` (real Host, real Work grant,
 * public claim/drive) and the production readers; nothing here writes a record,
 * reads a store or invents a fact.
 *
 * P8 extends this file with the deviation send/notice steps; P7 keeps only the
 * facts reader and the card-source arm.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { systemRoundMessageRef } from '../../src/contracts/plan-round.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { DeviationInputV1 } from '../../src/contracts/plan-deviation.js';
import type { PlanLoopLimitsV1 } from '../../src/contracts/plan-loop-limits.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { RunActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { createActivityReadModel } from '../../src/core/work-graph/views/activity-read-model.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import { createDeviationFactsReader } from '../../src/core/work-graph/tasks/goal-deviation-facts.js';
import type { PLReadingsWorld } from './PL-readings-fixture.js';
import { openPLReadingsWorld, usage } from './PL-readings-fixture.js';
import type { S6AHostWorld, S6AReply } from './S6A-host-fixture.js';
import type { S6ASession } from './S6A-request-fixture.js';
import type { S6ACardsWorkspace } from './S6A-cards-fixture.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { advanceUntil, driveWorkflow, post, type AdvanceValue } from './A2-restart-fixture.js';
import { heartbeat, readBody, waitForResponse } from './IV-host-fixture.js';
import { createPLAdviserLine, installPLFailingCheck, openPLConsumptionWorld, seedPLSenderPlan } from
  './PL-consumption-fixture.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { S6A_SCOPE } from './S6A-request-fixture.js';
import { claimedRunOf, committed, ready } from './S7A-fixture.js';

export type PLDeviationTask = { taskId: string; sizeClass?: 'small' | 'medium' | 'large' | 'explore';
  estimatedLines?: number };

export type PLDeviationWorld = {
  readonly base: PLReadingsWorld;
  readonly world: PLReadingsWorld['world'];
  readonly main: ReturnType<typeof s6aCardsWorkspace>;
  readonly goal: GoalRef;
  readonly tasks: readonly { projectId: string; goalId: string; taskId: string }[];
  /** The production facts reader over the world's real records/executions/activities. */
  readDeviationFacts(ctx: CoreCallContext, limits?: PlanLoopLimitsV1): Promise<DeviationInputV1>;
  close(): Promise<void>;
};

const DEFAULT_LIMITS: PlanLoopLimitsV1 = {
  schemaVersion: 1,
  taskReminderTokens: { small: 1_000_000, medium: 2_500_000, large: 4_000_000, explore: 4_000_000 },
  taskTwoTimesTokens: { small: 2_000_000, medium: 5_000_000, large: 8_000_000, explore: 8_000_000 },
  lineMultiplier: 2, stageLineBudget: 2_000, stageTokenBudget: 600_000_000,
};

/** The production facts reader over the real owners; the test passes the call context. */
export function deviationFactsOf(base: { world: S6AHostWorld }, limits: PlanLoopLimitsV1 = DEFAULT_LIMITS) {
  const records = base.world.platform.disconnect.records;
  const activity = createActivityReadModel({ records, now: () => new Date().toISOString() });
  const reader = (ctx: CoreCallContext) => createDeviationFactsReader(ctx, {
    records,
    runs: base.world.platform.executions,
    activities: activity,
    files: createGoalExecutedFilesReader({ records }),
    limits: () => limits,
  });
  return {
    reader,
    async read(ctx: CoreCallContext, goalRef: GoalRef): Promise<DeviationInputV1> {
      const graph = await base.world.platform.plans.queryTaskGraph(ctx, { goalRef });
      if (graph.status !== 'ready') {
        throw new Error(`PL deviation: the Task graph was not ready: ${JSON.stringify(graph)}`);
      }
      const result = await reader(ctx)(goalRef, graph.value.tasks);
      if (result.status !== 'ready') {
        throw new Error(`PL deviation: the facts read was not ready: ${JSON.stringify(result)}`);
      }
      return result.value;
    },
  };
}

/**
 * Re-adopt the active Plan with the caller's `sizeClass`/`estimatedLines`, so a
 * soft line can be crossed by real Runs (an unexecuted Plan change is allowed).
 */
async function adoptSizedPlan(world: S6AHostWorld, goal: GoalRef,
  tasks: readonly PLDeviationTask[]): Promise<void> {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const plan = await main.activePlan(goal);
  if (plan === null) throw new Error('PL deviation: the base world has no active Plan');
  const byId = new Map(tasks.map(task => [task.taskId, task]));
  const draft: PlanRevisionDraft = {
    schemaVersion: 2,
    planId: `${plan.planId}-sized`,
    planRevision: plan.planRevision + 1,
    goalId: goal.goalId,
    stages: structuredClone(plan.stages),
    tasks: structuredClone(plan.tasks).map(task => {
      const wanted = byId.get(task.taskId);
      return wanted === undefined ? task : {
        ...task,
        ...(wanted.sizeClass === undefined ? {} : { sizeClass: wanted.sizeClass }),
        ...(wanted.estimatedLines === undefined ? {} : { estimatedLines: wanted.estimatedLines }),
      };
    }),
    assignments: structuredClone(plan.assignments ?? []),
    obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag),
    taskRelations: structuredClone(plan.taskRelations ?? []),
    inputRequirements: structuredClone(plan.inputRequirements ?? []),
  };
  const proposed = committed<{ ref: unknown; revision: number }>(await main.post('plans/propose', graphWrite(
    main.scope, {
      goalRef: goal, basedOn: plan.ref, draft,
      reason: { text: 'PL deviation sized plan', sources: [] },
    }, 'pl-deviation-sized-propose',
  )), 'the sized Plan proposal');
  committed(await main.post('plans/apply', graphWrite(main.scope, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, 'pl-deviation-sized-apply')), 'the sized Plan adoption');
}

/** Open the deviation world with the caller's Plan rows (and optional size facts). */
export async function openPLDeviationWorld(options: {
  tasks: readonly PLDeviationTask[];
}): Promise<PLDeviationWorld> {
  const base = await openPLReadingsWorld({ taskIds: options.tasks.map(task => task.taskId) });
  try {
    if (options.tasks.some(task => task.sizeClass !== undefined || task.estimatedLines !== undefined)) {
      await adoptSizedPlan(base.world, base.goal, options.tasks);
    }
    const facts = deviationFactsOf(base);
    return {
      base,
      world: base.world,
      main: s6aCardsWorkspace(base.world, S6A_SCOPE),
      goal: base.goal,
      tasks: base.tasks,
      readDeviationFacts: (ctx, limits) => deviationFactsOf(base, limits).read(ctx, base.goal),
      close: () => base.close(),
    };
  } catch (error) {
    await base.close().catch(() => undefined);
    throw error;
  }
}

/** A trusted check whose real command fails, so a normally ended Run leaves the Task active. */
export function plFailingChecks(): import('../../src/contracts/verification.js').TrustedCheckConfiguration {
  return installPLFailingCheck();
}

/**
 * One Task's real Runs driven from `select_work` until the Workflow stops: the
 * caller scripts one reply per Run; the real auto-requeue path creates each
 * following Run, and every claim receipt is returned in order.
 */
export async function drivePLTaskRunsToStop(world: PLReadingsWorld['world'], input: {
  goal: GoalRef; line: S6ASession; taskId: string; flowId: string; replies: readonly S6AReply[];
}): Promise<{ runs: RunRef[]; steps: AdvanceValue[] }> {
  await world.scripted.script(input.line, input.replies);
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: input.goal,
    flowId: input.flowId, sessionHint: input.line.ref, kind: 'select_work', taskId: input.taskId }, { receipts });
  const runs = receipts.flatMap(receipt => receipt.kind === 'claim_task' && receipt.result.status === 'committed'
    ? [receipt.result.value.runRef] : []);
  return { runs, steps };
}

/** The public `executions/read` answer's Run revision. */
export async function runRevisionOf(world: PLReadingsWorld['world'], runRef: RunRef): Promise<number> {
  const answer = await world.post('executions/read', plain(S6A_SCOPE, runRef));
  const body = answer.body as { status?: string; value?: { run?: { revision?: number } } };
  if (body.status !== 'ready' || body.value?.run?.revision === undefined) {
    throw new Error(`PL deviation: executions/read was not ready: ${JSON.stringify(answer.body)}`);
  }
  return body.value.run.revision;
}

/**
 * PL-36's world: the real consume Host (adviser binding/profile/consumer), one
 * adopted Work Plan with the caller's Tasks and one sender line, plus the same
 * production facts reader. The row drives a Task's real Run and the Goal loop
 * through public steps only.
 */
export type PLDeviationConsumptionWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly goal: GoalRef;
  readonly line: S6ASession;
  readonly tasks: readonly { projectId: string; goalId: string; taskId: string }[];
  readonly adviser: S6ASession;
  readDeviationFacts(ctx: CoreCallContext, limits?: PlanLoopLimitsV1): Promise<DeviationInputV1>;
  /** The public `activity/runs` read. */
  readRuns(runRefs: readonly RunRef[]): Promise<RunActivityViewV1[]>;
  /** One real Work Run on `taskId`: script, claim and drive to its end; returns the Run. */
  runTask(input: { line: S6ASession; taskId: string; flowId: string; replies: readonly S6AReply[] }): Promise<RunRef>;
  close(): Promise<void>;
};

export async function openPLDeviationConsumptionWorld(input: {
  label: string; taskIds: readonly string[];
  /** Size facts adopted before any Run (a revision bump on the seeded Plan). */
  sizes?: readonly PLDeviationTask[];
  /** The real write/edit/shell grant (PL-48/PL-51). */
  write?: boolean;
  /** The trusted check configuration a normally ended Run advances through. */
  checks?: boolean | import('../../src/contracts/verification.js').TrustedCheckConfiguration;
}): Promise<PLDeviationConsumptionWorld> {
  const world = await openPLConsumptionWorld({ label: input.label, write: input.write === true,
    ...(input.checks === undefined ? {} : { checks: input.checks }) });
  try {
    await heartbeat(world);
    const goal = world.goals.first;
    const seeded = await seedPLSenderPlan(world, { goal, label: input.label, taskIds: input.taskIds });
    if (input.sizes !== undefined) await adoptSizedPlan(world, goal, input.sizes);
    const adviser = await createPLAdviserLine(world, `${input.label}-adviser`);
    const readDeviationFacts = async (ctx: CoreCallContext, limits?: PlanLoopLimitsV1) =>
      await deviationFactsOf({ world }, limits).read(ctx, goal);
    return {
      world,
      main: s6aCardsWorkspace(world, S6A_SCOPE),
      goal,
      line: seeded.line,
      tasks: seeded.tasks,
      adviser,
      readDeviationFacts,
      async readRuns(runRefs) {
        const answer = await world.post('activity/runs', plain(S6A_SCOPE, { runRefs: [...runRefs] }));
        const body = answer.body as { status: string; value?: RunActivityViewV1[]; code?: string; reason?: string };
        if (body.status !== 'ready' || body.value === undefined) {
          throw new Error(`PL deviation: activity/runs was not ready: ${JSON.stringify(answer.body)}`);
        }
        return body.value;
      },
      async runTask(run) {
        await world.scripted.script(run.line, run.replies);
        const claimInput = await advanceUntil(world.ag2b, {
          schemaVersion: 1, goalRef: goal, flowId: run.flowId, sessionHint: run.line.ref,
          kind: 'select_work', taskId: run.taskId,
        }, 'claim_task');
        const receipts: WorkflowStepReceipt[] = [];
        await driveWorkflow(world.ag2b, claimInput, { stopBefore: 'claim_task', receipts });
        return claimedRunOf(receipts, run.taskId).run;
      },
      async close() { await world.close(); },
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The 21 edited lines both PL-48 and PL-51 use for the unchanged real edit. */
export const PL_LINES_21 = Array.from({ length: 21 }, (_, index) => `line ${String(index + 1)}`).join('\n');

export type PLSoftLinePair = {
  growthRef: SessionMessageRef;
  linesRef: SessionMessageRef;
  growthMessage: SessionMessage;
  linesMessage: SessionMessage;
  growthAnswer: string;
  linesAnswer: string;
};

/**
 * The one common scenario behind PL-48 and PL-51: a normally ended Run with
 * 2.1M growth and 21 real edited lines, then the growth and lines system rounds
 * answered with the adviser's plain "no plan change" text. It stops before the
 * person-notice reads, so each row keeps its own notice assertions.
 */
export async function runSoftLineDeviationPair(fixture: PLDeviationConsumptionWorld, input: {
  taskId: string; flowId: string; path: string; prefix: string;
  /** Runs after the growth round is committed and before its text answer. */
  beforeGrowthAnswer?: (fixture: PLDeviationConsumptionWorld) => Promise<void>;
}): Promise<PLSoftLinePair> {
  await fixture.runTask({ line: fixture.line, taskId: input.taskId, flowId: input.flowId, replies: [
    { kind: 'calls', calls: [{ callId: `${input.flowId}-read`, name: 'read', args: { path: 'src/module.ts' } }],
      usage: usage(0, 0) },
    { kind: 'calls', calls: [{ callId: `${input.flowId}-edit`, name: 'edit',
      args: { mode: 'create', path: input.path, newText: PL_LINES_21 } }], usage: usage(2_100_000, 0) },
    { kind: 'text', text: `${input.prefix} done`, usage: usage(0, 0) },
  ] });

  const growthRef = systemRoundMessageRef(S6A_SCOPE, `deviation:${fixture.goal.goalId}:${input.taskId}:growth:2`);
  const linesRef = systemRoundMessageRef(S6A_SCOPE, `deviation:${fixture.goal.goalId}:${input.taskId}:lines:2`);
  if (growthRef.status !== 'ready' || linesRef.status !== 'ready') {
    throw new Error('PL deviation: a soft-line request id has no message ref');
  }
  const step = async (flowId: string) => await advanceUntil(fixture.world.ag2b, {
    schemaVersion: 1, goalRef: fixture.goal, flowId, sessionHint: null, kind: 'select_work',
  }, 'send_system_round');
  const respondWithText = async (ref: SessionMessageRef, text: string): Promise<void> => {
    await fixture.world.scripted.script(fixture.adviser, [{ kind: 'text', text }]);
    await waitForResponse(fixture.world, ref);
    if (await readBody(fixture.world, ref, 'response') !== text) {
      throw new Error('PL deviation: the adviser answer was not saved as written');
    }
  };

  ready(await post(fixture.world.ag2b, 'workflow/advance', plain(S6A_SCOPE,
    await step(`${input.flowId}-growth`))), 'the growth round');
  const growthMessage = ready<SessionMessage>((await fixture.world.post('messages/read',
    plain(S6A_SCOPE, growthRef.value))).body, 'the growth message');
  const growthAnswer = `${input.prefix} growth: no plan change`;
  if (input.beforeGrowthAnswer !== undefined) await input.beforeGrowthAnswer(fixture);
  await respondWithText(growthRef.value, growthAnswer);

  ready(await post(fixture.world.ag2b, 'workflow/advance', plain(S6A_SCOPE,
    await step(`${input.flowId}-lines`))), 'the lines round');
  const linesMessage = ready<SessionMessage>((await fixture.world.post('messages/read',
    plain(S6A_SCOPE, linesRef.value))).body, 'the lines message');
  const linesAnswer = `${input.prefix} lines: no plan change`;
  await respondWithText(linesRef.value, linesAnswer);

  return { growthRef: growthRef.value, linesRef: linesRef.value, growthMessage, linesMessage, growthAnswer, linesAnswer };
}
