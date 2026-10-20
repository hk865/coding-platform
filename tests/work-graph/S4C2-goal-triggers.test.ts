/**
 * S4C2-3 (spec §11.5, U-9): the three-step `readGoalTriggerRecords` reader over
 * real facts only.
 *
 * - 3a: the Goal and its Plans come from the real `createGoal` / `proposePlan` /
 *   `applyPlanChange` (two adoptions before the claim, at literal times before
 *   the fixed claim/completion clock, so the active Plan's revision 2 and its
 *   time both differ from the reduction's revision 1 at `AT`); the Task's Run is
 *   claimed by the real claim owner,
 *   prepared and started by the real Runtime (a scripted model held at the
 *   shared S2B gate), and formally completed through `openVerification` →
 *   `runRegisteredCheck` (a real registered `static` command check) →
 *   `finalizeChecks` → `completeTask`. The satisfied TaskReduction is the
 *   completion owner's own write; no reduction record is hand-encoded.
 * - 3c: three consecutive real Plan adoptions (p1, cancel t2, inherit) make the
 *   active Plan inherit t2's disposition from an older Plan; T2 must use that
 *   first terminal source Plan's acceptedAt.
 * - 3d: a real crashed Run is requeued by `claims.requeueTask`; a real
 *   `workflow.archiveLine` writes the archive-origin requeue; a real claim with
 *   that archive requeue ref is the `claimed` filter. Both the trigger list and
 *   `claimedArchiveKeys` are read from the production reader over the same real
 *   store. The composition's opt-in advancing clock gives the rework requeue,
 *   the Plan adoption and the archive requeue three different instants; the
 *   rework's, the Plan's and the archive's are read back from their own
 *   records through a public read.
 *
 * No lookup port, record or snapshot is hand-built: every prior fact is written
 * by a production owner, and platform-issued times are the values those public
 * steps returned (or a public task-timeline or task-graph read), never
 * recomputed here.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { ArchiveTaskChoiceV1 } from '../../src/contracts/core/session-archive.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { createRegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { readGoalTriggerRecords } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import { createS2BRuntimeSteps, type S2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import {
  createWP2Platform, preparedBundle, type WP2PlatformFixture,
} from '../helpers/WP2-platform-support.js';
import type { Records } from '../helpers/task-claim-fixture.js';

// A4: wrap the real SQLite backend factory only to keep its real records port
// for the production reader under test. The wrapper returns the real backend
// unchanged; it changes no value and is not a stand-in for the platform.
const captureSqliteBackend = vi.hoisted(() => ({ records: undefined as Records | undefined }));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>();
  return { ...actual, createSqliteRecordBackend: (options: Parameters<typeof actual.createSqliteRecordBackend>[0]) => {
    const backend = actual.createSqliteRecordBackend(options);
    captureSqliteBackend.records = backend.records;
    return backend;
  } };
});

const AT = '2026-09-24T00:00:00.000Z';
// 3a adopts both of its Plans at literal times before the fixed claim/completion
// clock `AT`, so the chain stays causally ordered and no Plan time equals the
// reduction's `reducedAt` (AT).
const P1_AT = '2026-09-22T00:00:00.000Z';
const P1_NEXT_AT = '2026-09-23T00:00:00.000Z';
const P2_AT = '2026-10-02T00:00:00.000Z';
const P3_AT = '2026-10-03T00:00:00.000Z';
const GOAL = 's4c2-trigger-goal';
const T1 = 't1';
const T2 = 't2';
const actor = { kind: 'human' as const, id: 's4c2-trigger-operator' };

/** The extra record groups the real evidence and completion owners write. */
const TRIGGER_SCHEMAS = {
  records: [...EVIDENCE_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records],
  events: [...EVIDENCE_RECORD_SCHEMAS.events, ...COMPLETION_RECORD_SCHEMAS.events],
  lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(COMPLETION_RECORD_SCHEMAS.lookups ?? [])],
};

const byKey = (left: { key: string }, right: { key: string }): number =>
  left.key < right.key ? -1 : left.key > right.key ? 1 : 0;

const work = (taskId: string): RuntimeTask => ({ taskId, title: `Task ${taskId}`,
  requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
const gate = (taskId: string): RuntimeTask => ({ taskId, title: `Gate ${taskId}`,
  requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });

function planDraft(goalId: string, planId: string, planRevision: number, tasks: RuntimeTask[]): PlanRevisionDraft {
  return { schemaVersion: 2, planId, planRevision, goalId, stages: [],
    tasks,
    assignments: tasks.filter(task => task.taskKind === 'work')
      .map(task => ({ taskId: task.taskId, role: 'builder', instruction: `Run ${task.taskId}` })),
    obligations: [{ obligationId: 'o-trigger', title: 'Deliver the trigger subject', requirementLevel: 'required',
      taskIds: tasks.map(task => task.taskId),
      verificationRequirements: [{ requirementId: 'v-trigger', requirementLevel: 'required', kind: 'static',
        description: 'Registered static command check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

// ---------------------------------------------------------------------------
// 3a / 3c: real Goal + Plan adoptions, real Runtime completion chain
// ---------------------------------------------------------------------------

type PlanFixture = {
  b2: B2ExecutionFixture;
  ctx: CoreCallContext;
  records: Records;
  goalRef: GoalRef;
  plans: ReturnType<typeof createPlanService>;
  steps: S2BRuntimeSteps;
  evidence: ReturnType<typeof createEvidenceService>;
  runner: ReturnType<typeof createRegisteredCheckRunner>;
  adopt(draft: PlanRevisionDraft, label: string, basedOn: PlanRevisionRef | null, at: string): Promise<PlanRevisionSnapshot>;
  satisfy(taskId: string, planRef: PlanRevisionRef): Promise<TaskReductionSnapshot>;
  close(): Promise<void>;
};

async function setupPlans(): Promise<PlanFixture> {
  const b2 = await createB2ExecutionFixture('memory', TRIGGER_SCHEMAS);
  const root = await mkdtemp(join(tmpdir(), 'next-s4c2-triggers-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'trigger.txt'), 's4c2 trigger verification source\n');
  const records = b2.base.records;
  const ctx: CoreCallContext = { projectId: b2.base.scope.projectId, workspaceId: b2.base.scope.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: b2.base.scope.projectId, workspaceId: b2.base.scope.workspaceId, actor },
    signal: new AbortController().signal };
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: b2.base.scope.projectId, goalId: GOAL };
  let sequence = 0;
  const eventId = (): string => `s4c2-trigger-event-${++sequence}`;
  const newId = (): string => `s4c2-trigger-id-${++sequence}`;
  const requestId = (label: string): string => `s4c2-trigger-${label}-${++sequence}`;
  const planClock = { at: P1_AT };

  try {
    const steps = await createS2BRuntimeSteps({
      base: b2.base, bodies: b2.bodies, ctx, directory: b2.base.directory, scope: b2.base.scope,
      now: () => AT, setClock: () => undefined, eventId, newId, consumerId: 's4c2-trigger-runtime',
    });
    // The trigger Plan's required requirement is `static`; install and activate
    // the matching policy through the public bootstrap before the first adoption.
    await steps.installStaticCompletionPolicy('s4c2-trigger-static-policy');

    const created = await b2.base.goals.createGoal(ctx, { meta: { requestId: requestId('create-goal'),
      expected: [{ ref: b2.base.projectRef, revision: 1 }, { ref: b2.base.workspaceRef, revision: 1 }] },
      input: { goalId: GOAL, workspace: b2.base.scope, objective: 'S4C2 trigger subject' } });
    if (created.status !== 'committed') throw new Error(`S4C2 trigger Goal creation failed: ${JSON.stringify(created)}`);

    const plans = createPlanService({ records, now: () => planClock.at, eventId });

    async function currentGoal(): Promise<GoalSnapshot> {
      const read = await b2.base.plans.queryGoal(ctx, goalRef);
      if (read.status !== 'ready') throw new Error(`S4C2 trigger Goal read failed: ${JSON.stringify(read)}`);
      return read.value.goal;
    }

    async function claim(taskId: string, planRef: PlanRevisionRef): Promise<TaskClaim> {
      const session = await b2.base.createSession(`s4c2-trigger-session-${taskId}-${++sequence}`);
      const goal = await currentGoal();
      const card = await b2.base.sessionsPort.readSession(ctx, session);
      if (card.status !== 'ready') throw new Error(`S4C2 trigger Session read failed: ${JSON.stringify(card)}`);
      const request: GraphWrite<ClaimTaskInput> = { input: {
        goalRef, planRef, taskId, sessionRef: session, roleBinding: b2.base.roleBinding, budget: b2.base.budget },
      meta: { requestId: requestId(`claim-${taskId}`), expected: [
        { ref: goalRef, revision: goal.revision },
        { ref: b2.base.workspaceRef, revision: 1 },
        { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision },
      ] } };
      const claimed = await b2.base.service.claimTask(ctx, request);
      if (claimed.status !== 'committed') throw new Error(`S4C2 trigger claim failed: ${JSON.stringify(claimed)}`);
      return claimed.value;
    }

    const configuration: TrustedCheckConfiguration = {
      configurationRevision: 's4c2-trigger-checks-1', workspace: b2.base.workspaceRef, executor: actor,
      permissionRevision: 's4c2-trigger-permission-1', sourceAccess: 'verification_workspace',
      processAccess: 'all_except_denied', deniedPrefixes: [],
      checks: [{ checkId: 's4c2-trigger-check', kind: 'static', command: 'echo S4C2_TRIGGER_OK',
        cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
    };
    const workspaceHost = {
      async resolveRoot(requested: { projectId: string; workspaceId: string }) {
        return requested.projectId === b2.base.scope.projectId && requested.workspaceId === b2.base.scope.workspaceId
          ? { status: 'ready' as const, value: { root, workspaceRevision: 1 } }
          : { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the S4C2 trigger workspace is not registered' };
      },
      async authorize(authCtx: CoreCallContext, requested: { projectId: string; workspaceId: string }) {
        return authCtx.principal.kind === 'host'
          && requested.projectId === b2.base.scope.projectId && requested.workspaceId === b2.base.scope.workspaceId
          ? { status: 'ready' as const, value: { subjectKey: 'host:s4c2-trigger', permissionRevision: 's4c2-trigger-permission-1',
            allowsRead: () => true } }
          : { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the S4C2 trigger Host does not authorize verification source' };
      },
    };
    const executions = createRunStateReader({ records });
    const materials = createMaterialService({ bodies: b2.bodies,
      authority: createMaterialRecordReaders(records).authority, now: () => AT });
    const evidence = createEvidenceService({ records, materials, executions, workspaceHost,
      source: new VerificationWorkspaceReader(), configuration, now: () => AT, newId });
    const runner = createRegisteredCheckRunner({ evidence, workspaceHost, kernel, now: () => AT });

    async function adopt(draft: PlanRevisionDraft, label: string, basedOn: PlanRevisionRef | null,
      at: string): Promise<PlanRevisionSnapshot> {
      planClock.at = at;
      const proposed = await plans.proposePlan(ctx, { meta: { requestId: requestId(`${label}-propose`), expected: [] },
        input: { goalRef, basedOn, draft, reason: { text: `S4C2 trigger adoption ${label}`, sources: [] } } });
      if (proposed.status !== 'committed') throw new Error(`S4C2 trigger ${label} proposal failed: ${JSON.stringify(proposed)}`);
      planClock.at = at;
      const applied = await plans.applyPlanChange(ctx, { meta: { requestId: requestId(`${label}-apply`), expected: [] },
        input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
      if (applied.status !== 'committed') throw new Error(`S4C2 trigger ${label} adoption failed: ${JSON.stringify(applied)}`);
      return applied.value;
    }

    async function satisfy(taskId: string, planRef: PlanRevisionRef): Promise<TaskReductionSnapshot> {
      const claimed = await claim(taskId, planRef);
      const handle = await steps.start(claimed, { at: AT,
        replies: [{ kind: 'text', text: `S4C2 trigger ${taskId} completed` }] });
      await steps.finish(handle, AT, 'completed');
      const opened = await evidence.openVerification(ctx, {
        input: { subjectRunRef: claimed.runRef, subject: claimed.task, planRef },
        meta: { requestId: requestId(`open-${taskId}`), expected: [] },
      });
      if (opened.status !== 'committed') throw new Error(`S4C2 trigger round open failed: ${JSON.stringify(opened)}`);
      let round = opened.value;
      for (const check of round.checks) {
        const started = await runner.runRegisteredCheck(ctx, {
          input: { roundRef: round.ref, checkId: check.checkId },
          meta: { requestId: requestId(`run-${taskId}-${check.checkId}`), expected: [{ ref: round.ref, revision: round.revision }] },
        });
        if (started.status !== 'ready') throw new Error(`S4C2 trigger check ${check.checkId} did not run: ${JSON.stringify(started)}`);
        round = started.value;
      }
      const finalized = await evidence.finalizeChecks(ctx, {
        input: { roundRef: round.ref },
        meta: { requestId: requestId(`finalize-${taskId}`), expected: [{ ref: round.ref, revision: round.revision }] },
      });
      if (finalized.status !== 'committed') throw new Error(`S4C2 trigger finalize failed: ${JSON.stringify(finalized)}`);
      const goal = await currentGoal();
      const done = await b2.base.goals.completeTask(ctx, {
        input: { taskRef: { projectId: b2.base.scope.projectId, goalId: goalRef.goalId, taskId }, planRef,
          roundRef: finalized.value.snapshot.ref },
        meta: { requestId: requestId(`complete-${taskId}`), expected: [
          { ref: goalRef, revision: goal.revision },
          { ref: { aggregateType: 'TaskReduction', projectId: b2.base.scope.projectId, goalId: goalRef.goalId, taskId }, revision: 0 },
        ] } });
      if (done.status !== 'committed') throw new Error(`S4C2 trigger completeTask failed: ${JSON.stringify(done)}`);
      return done.value;
    }

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await steps.close();
      await b2.close();
      await rm(root, { recursive: true, force: true });
    };
    cleanups.push(close);
    return { b2, ctx, records, goalRef, plans, steps, evidence, runner, adopt, satisfy, close };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    await b2.close().catch(() => undefined);
    throw error;
  }
}

it('S4C2-3a: T1 reads a satisfied TaskReduction as task_end#r<revision> at reducedAt', async () => {
  const f = await setupPlans();
  const p1 = await f.adopt(planDraft(f.goalRef.goalId, 's4c2-trigger-plan-1', 1, [work(T1), gate('g1')]),
    'p1', null, P1_AT);
  expect(p1.acceptedAt).toBe(P1_AT);
  // A second public adoption before the claim: the active Plan is revision 2, so
  // a reader that took `task_end`'s revision from the Plan would key it `#r2`.
  const plan = await f.adopt(planDraft(f.goalRef.goalId, 's4c2-trigger-plan-2', 2, [work(T1), gate('g1')]),
    'p2', p1.ref, P1_NEXT_AT);
  expect(plan).toMatchObject({ planRevision: 2, acceptedAt: P1_NEXT_AT });
  const reduction = await f.satisfy(T1, plan.ref);
  // The completion owner wrote the Task's first reduction (revision 1) at the
  // fixture's fixed clock AT, which is not the Plan's time P1_NEXT_AT.
  expect(reduction).toMatchObject({ planRef: plan.ref, phase: 'satisfied', revision: 1, reducedAt: AT });
  const result = await readGoalTriggerRecords(f.records, f.goalRef, plan);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect([...result.triggers].sort(byKey)).toEqual([
    { key: 'plan:p2', at: P1_NEXT_AT, kind: 'plan', taskId: null },
    { key: 'task_end:t1#r1', at: AT, kind: 'task_end', taskId: 't1' },
  ]);
  expect([...result.claimedArchiveKeys]).toEqual([]);
});

it('S4C2-3c: T2 uses the FIRST terminal source plan acceptedAt when setIn is an older plan', async () => {
  const f = await setupPlans();
  const p1 = await f.adopt(planDraft(f.goalRef.goalId, 's4c2-trigger-plan-1', 1, [work(T1), work(T2), gate('g1')]),
    'p1', null, P1_AT);
  const cancelT2 = p1.tasks.map(task => task.taskId === T2 ? { ...task, disposition: 'cancelled' as const } : task);
  const p2 = await f.adopt(planDraft(f.goalRef.goalId, 's4c2-trigger-plan-2', 2, cancelT2), 'p2', p1.ref, P2_AT);
  const p3 = await f.adopt(planDraft(f.goalRef.goalId, 's4c2-trigger-plan-3', 3, p2.tasks), 'p3', p2.ref, P3_AT);
  // The setup itself is real: the cancellation was first made in p2, and p3 only
  // inherits that compiler-owned disposition entry.
  expect(p2.tasks.find(task => task.taskId === T2)?.disposition).toBe('cancelled');
  expect(p2.acceptedAt).toBe(P2_AT);
  expect(p3.acceptedAt).toBe(P3_AT);
  const dispositions = p3.schemaVersion === 2 ? p3.dispositionRecord?.entries ?? [] : [];
  expect(dispositions).toContainEqual(expect.objectContaining({ taskId: T2, to: 'cancelled', setIn: p2.ref }));
  expect(dispositions.find(entry => entry.taskId === T2)?.setIn).not.toEqual(p3.ref);

  const result = await readGoalTriggerRecords(f.records, f.goalRef, p3);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  expect([...result.triggers].sort(byKey)).toEqual([
    { key: 'plan:p3', at: P3_AT, kind: 'plan', taskId: null },
    { key: 'task_end:t2@p2', at: P2_AT, kind: 'task_end', taskId: 't2' },
  ]);
});

// ---------------------------------------------------------------------------
// 3d: real requeue + real archive on the public composition
// ---------------------------------------------------------------------------

/**
 * The WP2 composition on its real SQLite store, with the trusted Host model
 * call failing before its reply so the single started Run ends `crashed`. The
 * opt-in advancing clock (+1 s per platform `now()`) gives each real write its
 * own instant.
 * The outer backend-factory wrapper (A4) captures that ONE real backend so the
 * production reader under test gets its records port; it changes no value and
 * every fact still comes from the public owners below.
 */
async function createTriggerComposition(): Promise<{ f: WP2PlatformFixture; records: Records }> {
  const f = await createWP2Platform({
    kind: 'sqlite', duty: 'executor', ownedHost: true, advancingClock: true,
    scriptedReplies: [{ kind: 'text', text: 'S4C2 trigger reply' }],
    beforeReply: async () => { throw new Error('the S4C2 trigger model call fails'); },
  });
  const records = captureSqliteBackend.records;
  if (records === undefined) throw new Error('the S4C2 trigger composition did not build its real SQLite backend');
  return { f, records };
}

/** One public claim of the composition's Task in the given Session. */
async function claimInComposition(f: WP2PlatformFixture, sessionRef: SessionRef, taskId: string,
  requeueRef: TaskRequeueRef | undefined, requestId: string): Promise<RunRef> {
  const graph = await f.platform.plans.queryTaskGraph(f.ctx, { goalRef: f.goalRef });
  if (graph.status !== 'ready') throw new Error(`S4C2 trigger task graph read failed: ${JSON.stringify(graph)}`);
  const goal = await f.platform.plans.queryGoal(f.ctx, f.goalRef);
  if (goal.status !== 'ready') throw new Error(`S4C2 trigger Goal read failed: ${JSON.stringify(goal)}`);
  const workspace = await f.platform.projects.readWorkspaceRegistration(f.ctx, f.scope);
  if (workspace.status !== 'ready') throw new Error(`S4C2 trigger workspace read failed: ${JSON.stringify(workspace)}`);
  const card = await f.platform.sessions.readSession(f.ctx, sessionRef);
  if (card.status !== 'ready') throw new Error(`S4C2 trigger Session read failed: ${JSON.stringify(card)}`);
  const claimed = await f.platform.claims.claimTask(f.ctx, {
    input: { goalRef: f.goalRef, planRef: graph.value.plan.ref, taskId, sessionRef,
      roleBinding: f.roleBinding, budget: f.fixture.budget,
      ...(requeueRef === undefined ? {} : { requeueRef }) },
    meta: { requestId, expected: [
      { ref: f.goalRef, revision: goal.value.goal.revision },
      { ref: f.fixture.workspaceRef, revision: workspace.value.workspace.revision },
      { ref: plainSessionRefToAggregate(sessionRef), revision: card.value.record.revision },
    ] },
  });
  if (claimed.status !== 'committed') throw new Error(`S4C2 trigger claim failed: ${JSON.stringify(claimed)}`);
  return claimed.value.runRef;
}

it('S4C2-3d: T3 makes one rework trigger per requeue; archiveOrigin replaces it with archive', async () => {
  const { f, records } = await createTriggerComposition();
  cleanups.push(() => f.close());
  const claim = f.claim;
  if (claim === null || f.runRef === null) throw new Error('the composition has no first claim');
  const reworkTaskId = claim.task.taskId;

  // A real crashed Run, then the real requeue owner writes the rework.
  const { prepared } = await preparedBundle(f, f.runRef, 's4c2-trigger-rework-prepare');
  const started = await f.platform.runtime.startRun(f.ctx, { prepared,
    consumerId: 's4c2-trigger-driver', requestId: 's4c2-trigger-rework-start' });
  if (started.status !== 'ready') throw new Error(`S4C2 trigger start failed: ${JSON.stringify(started)}`);
  const crashed = await f.platform.executions.readExecution(f.ctx, f.runRef);
  if (crashed.status !== 'ready') throw new Error(`S4C2 trigger Run read failed: ${JSON.stringify(crashed)}`);
  expect(crashed.value.run).toMatchObject({ status: 'ended', outcome: 'crashed' });
  const goal = await f.platform.plans.queryGoal(f.ctx, f.goalRef);
  if (goal.status !== 'ready') throw new Error(`S4C2 trigger Goal read failed: ${JSON.stringify(goal)}`);
  const requeueTask = f.platform.claims.requeueTask;
  if (requeueTask === undefined) throw new Error('the platform does not expose the requeue owner');
  const requeued = await requeueTask.call(f.platform.claims, f.ctx, {
    input: { taskRef: claim.task, afterRunRef: f.runRef, reason: 'S4C2 trigger rework', newInputRefs: [] },
    meta: { requestId: 's4c2-trigger-requeue', expected: [
      { ref: f.goalRef, revision: goal.value.goal.revision },
      { ref: f.runRef, revision: crashed.value.run.revision }] },
  });
  expect(requeued).toMatchObject({ status: 'committed' });
  if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
    throw new Error(`S4C2 trigger requeue: ${JSON.stringify(requeued)}`);
  }
  const reworkRequeueRef = requeued.value.requeue.ref;
  const firstCard = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
  if (firstCard.status !== 'ready') throw new Error(`S4C2 trigger first Session read failed: ${JSON.stringify(firstCard)}`);
  const role: RoleConfigurationRef = firstCard.value.record.role;

  // A real Plan adoption adds an independent work Task whose Run can be
  // archived without a requeue ref of its own.
  const firstGraph = await f.platform.plans.queryTaskGraph(f.ctx, { goalRef: f.goalRef });
  if (firstGraph.status !== 'ready') throw new Error(`S4C2 trigger task graph read failed: ${JSON.stringify(firstGraph)}`);
  const basePlan = firstGraph.value.plan;
  if (basePlan.schemaVersion !== 2) throw new Error(`S4C2 trigger Plan is not v2: ${JSON.stringify(basePlan)}`);
  const archiveTaskId = 's4c2-trigger-archive-task';
  const adoptedDraft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 's4c2-trigger-plan-2', planRevision: basePlan.planRevision + 1, goalId: f.goalRef.goalId,
    stages: basePlan.stages,
    tasks: [...basePlan.tasks, { taskId: archiveTaskId, title: 'Archive subject', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [...(basePlan.assignments ?? []),
      { taskId: archiveTaskId, role: 'builder', instruction: 'Archive subject' }],
    obligations: basePlan.obligations.map(obligation => ({ ...obligation,
      taskIds: [...obligation.taskIds, archiveTaskId] })),
    taskHierarchy: basePlan.taskHierarchy, executionDag: basePlan.executionDag,
    taskRelations: basePlan.taskRelations ?? [], inputRequirements: basePlan.inputRequirements ?? [],
  };
  const proposed = await f.platform.plans.proposePlan(f.ctx, {
    input: { goalRef: f.goalRef, basedOn: basePlan.ref, draft: adoptedDraft,
      reason: { text: 'S4C2 trigger archive subject', sources: [] } },
    meta: { requestId: 's4c2-trigger-archive-plan-propose', expected: [] },
  });
  if (proposed.status !== 'committed') throw new Error(`S4C2 trigger archive Plan proposal failed: ${JSON.stringify(proposed)}`);
  const applied = await f.platform.plans.applyPlanChange(f.ctx, {
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    meta: { requestId: 's4c2-trigger-archive-plan-apply', expected: [] },
  });
  if (applied.status !== 'committed') throw new Error(`S4C2 trigger archive Plan adoption failed: ${JSON.stringify(applied)}`);

  // The independent Task is claimed (no requeue ref), then a real
  // `workflow.archiveLine` stops that Run and writes the archive-origin requeue.
  const archiveSession = await f.platform.runtime.createSession(f.ctx, {
    workspace: f.scope, role, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 's4c2-trigger-archive-session', expected: [] },
  });
  if (archiveSession.status !== 'completed') throw new Error(`S4C2 trigger archive Session create failed: ${JSON.stringify(archiveSession)}`);
  const archiveSessionRef: SessionRef = { projectId: archiveSession.value.ref.projectId,
    sessionId: archiveSession.value.ref.sessionId };
  const archiveRunRef = await claimInComposition(f, archiveSessionRef, archiveTaskId, undefined,
    's4c2-trigger-claim-archive');
  const archiveCard = await f.platform.sessions.readSession(f.ctx, archiveSessionRef);
  if (archiveCard.status !== 'ready') throw new Error(`S4C2 trigger archive Session read failed: ${JSON.stringify(archiveCard)}`);
  const tasks: ArchiveTaskChoiceV1[] = [];
  const seen = new Set<string>();
  for (const link of archiveCard.value.links) {
    if (link.until !== null || link.ref.relation !== 'responsible') continue;
    const target = link.ref.target;
    if (target.kind !== 'task' && target.kind !== 'work') continue;
    const key = canonicalJson(target as unknown as JsonValue);
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({ target, disposition: { kind: 'drop' } });
  }
  const archived = await f.platform.workflow.archiveLine(f.ctx, {
    input: { sessionRef: archiveSessionRef, reason: 'S4C2 trigger archive', tasks, wait: null },
    meta: { requestId: 's4c2-trigger-archive', expected: [
      { ref: archiveCard.value.record.ref, revision: archiveCard.value.record.revision }] },
  });
  if (archived.status !== 'ready' || archived.value.state !== 'archived') {
    throw new Error(`the public archive did not finish: ${JSON.stringify(archived)}`);
  }

  const graph = await f.platform.plans.queryTaskGraph(f.ctx, { goalRef: f.goalRef });
  if (graph.status !== 'ready') throw new Error(`S4C2 trigger task graph read failed: ${JSON.stringify(graph)}`);
  const archiveRef = graph.value.tasks.find(task => task.ref.taskId === archiveTaskId)?.requeueRef;
  if (archiveRef === undefined || archiveRef.afterRunId !== archiveRunRef.runId) {
    throw new Error('the archived Task carries no matching real requeueRef');
  }

  // A real claim with the archive requeue ref is the claimed continuation the
  // reader's claimed filter must see.
  const continuationSession = await f.platform.runtime.createSession(f.ctx, {
    workspace: f.scope, role, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 's4c2-trigger-continuation-session', expected: [] },
  });
  if (continuationSession.status !== 'completed') throw new Error(`S4C2 trigger continuation Session create failed: ${JSON.stringify(continuationSession)}`);
  const continuationSessionRef: SessionRef = { projectId: continuationSession.value.ref.projectId,
    sessionId: continuationSession.value.ref.sessionId };
  const continuationRunRef = await claimInComposition(f, continuationSessionRef, archiveTaskId, archiveRef,
    's4c2-trigger-claim-continuation');
  const continuation = await f.platform.executions.readExecution(f.ctx, continuationRunRef);
  if (continuation.status !== 'ready') throw new Error(`S4C2 trigger continuation read failed: ${JSON.stringify(continuation)}`);
  expect(continuation.value.run.requeueRef).toEqual(archiveRef);

  // The rework and Plan trigger times are read back from their own source
  // records through a public read, used as returned: the rework requeue from the
  // `tasks/timeline` read (its `requeue` point names that TaskRequeue record),
  // the Plan from the graph read after checking it is this test's adoption.
  const timeline = await f.platform.timeline.readTaskStateTimeline(f.ctx, { goalRef: f.goalRef, cursor: null, limit: 50 });
  if (timeline.status !== 'ready') throw new Error(`S4C2 trigger timeline read failed: ${JSON.stringify(timeline)}`);
  const reworkPoint = timeline.value.tasks.find(task => task.taskId === reworkTaskId)?.segments
    .map(segment => segment.point).find(candidate => candidate?.kind === 'requeue');
  if (reworkPoint === undefined || reworkPoint === null) {
    throw new Error(`the timeline shows no requeue of ${reworkTaskId}: ${JSON.stringify(timeline.value)}`);
  }
  expect(reworkPoint.source).toEqual(reworkRequeueRef);
  const reworkAt = reworkPoint.at;
  expect(graph.value.plan.ref).toEqual(applied.value.ref);
  const planAt = graph.value.plan.acceptedAt;

  const result = await readGoalTriggerRecords(records, f.goalRef, graph.value.plan);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  const archiveKey = `archive:${archiveTaskId}/${archiveRunRef.runId}`;
  // The archive trigger's time is read back from its own source record through
  // the graph read after the archive, used as returned: the archive Task's
  // `rework.entries` item for the archive requeue (`ref` = `archiveRef`) and its
  // `requestedAt`.
  const archiveEntry = graph.value.tasks.find(task => task.ref.taskId === archiveTaskId)?.rework?.entries
    .find(entry => canonicalJson(entry.ref as unknown as JsonValue) === canonicalJson(archiveRef as unknown as JsonValue));
  if (archiveEntry === undefined) {
    throw new Error(`the graph read shows no rework entry for ${JSON.stringify(archiveRef)}: ${JSON.stringify(graph.value.tasks)}`);
  }
  const archiveAt = archiveEntry.requestedAt;
  // The rework requeue, the Plan adoption and the archive requeue are three
  // separate real writes on the advancing clock, so their instants differ.
  expect(reworkAt).not.toBe(planAt);
  expect(planAt).not.toBe(archiveAt);
  expect(reworkAt).not.toBe(archiveAt);
  expect([...result.triggers].sort(byKey)).toEqual([
    { key: archiveKey, at: archiveAt, kind: 'archive', taskId: archiveTaskId },
    // n counted from the adopts: the fixture's seed adopts planRevision 1
    // (task-claim-fixture), this test adopts once more, so n = 1 + 1 = 2.
    { key: 'plan:p2', at: planAt, kind: 'plan', taskId: null },
    { key: `rework:${reworkTaskId}/${f.runRef.runId}`, at: reworkAt, kind: 'rework', taskId: reworkTaskId },
  ]);
  // archiveOrigin replaces the rework trigger for its own Run: never both.
  expect(result.triggers.map(trigger => trigger.key)).not.toContain(`rework:${archiveTaskId}/${archiveRunRef.runId}`);
  expect([...result.claimedArchiveKeys]).toEqual([archiveKey]);
});
