/**
 * A.2 step 5.10 (C7) at the plan owner: the future-only delta split, the `replacedByTaskId` rule and the
 * W16 adoption of disposition-only Tasks over the real plan service and the real Memory RecordStore
 * (docs/refactor/STATE-MACHINES-SPEC.md §3.3 PLAN-05 and point 6, the 任务定义守卫表, §3.4, §4 TASK-18/19,
 * TD-4; the W1-future-plan S11–S19 cases of §3.6, here in their own file).
 *
 * - `deriveFuturePlanDelta`: a disposition-only Task is neither changed nor unchanged; changing anything
 *   else (title, assignment, carried obligations) is a changed Task; `dispositionChanges` lists every
 *   disposition that moves; a Task whose only execution change is leaving an obligation is a
 *   `carrierRemovals` entry (the untraced rule's hint).
 * - `validateFutureObligationCoverage`: `replacedByTaskId` of a Task whose disposition changes.
 * - The plan owner: an untraced disposition-only Task keeps its source definition and basis and is recorded
 *   (`traced:false`); a later unrelated adoption carries the record; a traced superseded Task may name a
 *   new replacement (recorded `from === to`), and an explicit `replacedByTaskId: null` where the source has
 *   none is no change; a traced Task leaving an obligation is refused with the hint; a traced Task whose Run
 *   is live or ended unknown is `busy`, a satisfied one `invalid`; a gate cannot change its disposition;
 *   deferring the only carrier of a required obligation is `invalid`. Every refusal writes nothing. A paused
 *   Goal still adopts (W16 is no rework).
 * - Guard 7 and guard 9 by adopter class (§1 `reworkActorClassOf(principal, actor)`): a Host started as
 *   `kind:'system'` is an operator (class `human`) and supersedes a human-stopped Task; the platform
 *   automation actor (class `system`) may not, nor add a parallel carrier beside it. A human stop committed
 *   between the guard 9 read and the commit moves the carrier's pinned Run: `revision_conflict`, and read
 *   again `forbidden` (§3.6 PLAN-05 守卫 9 race).
 * - An Agent (`apply_future_plan`, the W2 fixture's entered Run): cannot change its own running Task
 *   (`busy`); defers a sibling whose Run ended (recorded with the agent actor); may neither change a
 *   human-stopped sibling (guard 7) nor add a carrier beside it (guard 9), while an operator adopts the same
 *   candidate.
 *
 * Fixture note: every reachable Run is produced by `claimTask`, production prepare and the real Runtime
 * start/finish; a human stop is the real `submitControl` + delivery; a satisfied Task is the real
 * `openVerification` → `runRegisteredCheck` → `finalizeChecks` → `completeTask` chain. No Run, Lease,
 * Reduction or human-stop fact is written by the test where that public chain exists.
 *
 * Guard 2's unknown outcome is a real Run held at the model gate whose Kernel database is moved aside, then
 * the restarted Host's start-up reconcile (RUN-20(ii)): the Run ends `outcome_unknown` and keeps its Lease.
 * The guard-9 race is a real operator cancel (`submitControl`) of the carrier's running Run while the
 * adoption commit waits at an A3 wrapper. Refusal rows sit in `rejects:` blocks with a public read before
 * and after; every service-layer row runs on the memory and the SQLite record backend.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import { createS2BRuntimeSteps, type S2BRunHandle, type S2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import { cleanupRestart, moveKernelAside } from '../helpers/A2-restart-fixture.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { PlanProposal, PlanTaskPort, TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ClaimFixtureKind, Records, TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createInitializationBindingReader } from '../../src/core/work-graph/tasks/goal-confirm-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { reconcileRunAtStartup } from '../../src/core/agent-runtime/run-reconcile.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { readGoalPhase } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createRegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { deriveFuturePlanDelta, validateFutureObligationCoverage } from '../../src/core/work-graph/tasks/plan-validation.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createW2WhiteboardFixture, type W2WhiteboardFixture } from '../helpers/W2-whiteboard-fixture.js';

const AT = '2026-10-06T00:00:00.000Z';
// The accepted claim fixture's fixed scope; `setup` verifies it before use.
const projectId = 'r4c-claim-project';
const workspaceId = 'r4c-claim-workspace';
const actor = { kind: 'human' as const, id: 'a2-c7-operator' };
const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'a2-c7-goal' };
/** A Host call context acting as `as` (the operator by default). */
const hostCtx = (as: Extract<ActorRef, { kind: 'human' | 'system' }>): CoreCallContext => ({ projectId, workspaceId,
  principal: { kind: 'host', actor: as }, materialReader: { kind: 'host', projectId, workspaceId, actor: as },
  signal: new AbortController().signal });
const ctx = hostCtx(actor);
/** The platform automation actor (rework class `system`) and a Host operator started as `kind:'system'` (class `human`). */
const automation = hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR });
const hostOperator = { kind: 'system' as const, id: 'a2-c7-host-op' };
type DraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;
type SnapshotV2 = Extract<PlanRevisionSnapshot, { schemaVersion: 2 }>;

/** Extra record groups the real evidence/completion/control owners write; the claim fixture owns the rest. */
const A2_SCHEMAS: RecordBackendSchemas = {
  records: [...EVIDENCE_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records],
  events: [...(EVIDENCE_RECORD_SCHEMAS.events ?? []), ...(COMPLETION_RECORD_SCHEMAS.events ?? []),
    ...(CONTROL_RECORD_SCHEMAS.events ?? [])],
  lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(COMPLETION_RECORD_SCHEMAS.lookups ?? []),
    ...(CONTROL_RECORD_SCHEMAS.lookups ?? [])],
};

const work = (taskId: string, title = `Task ${taskId}`): RuntimeTask => ({ taskId, title, requirementLevel: 'required',
  taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
/** The fixture's only executable registered check kind is `static`. */
const check = (requirementId: string) => ({ requirementId, requirementLevel: 'required' as const, kind: 'static',
  description: 'Tests pass' });

/** A and B are work, the gate carries o-core with them; B alone carries o-solo. */
function initialDraft(): DraftV2 {
  return { schemaVersion: 2, planId: 'c7-plan-1', planRevision: 1, goalId: goalRef.goalId, stages: [],
    tasks: [work('A'), work('B'), { ...work('gate'), title: 'Goal gate', taskKind: 'gate' }],
    assignments: [{ taskId: 'A', role: 'builder', instruction: 'Run A' }, { taskId: 'B', role: 'builder', instruction: 'Run B' }],
    obligations: [
      { obligationId: 'o-core', title: 'Deliver core', requirementLevel: 'required', taskIds: ['A', 'B', 'gate'],
        verificationRequirements: [check('check-core')] },
      { obligationId: 'o-solo', title: 'Deliver B only', requirementLevel: 'required', taskIds: ['B'],
        verificationRequirements: [check('check-solo')] },
    ],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
}
/** The future revision of `source` with `edit` applied. */
function futureDraft(source: PlanRevisionSnapshot, planId: string, edit: (draft: DraftV2) => DraftV2): DraftV2 {
  const base = initialDraft();
  return edit({ ...base, planId, planRevision: source.planRevision + 1, tasks: structuredClone(source.tasks),
    assignments: structuredClone(source.assignments ?? []), obligations: structuredClone(source.obligations) });
}
const disposed = (draft: DraftV2, taskId: string, patch: Partial<RuntimeTask>): DraftV2 =>
  ({ ...draft, tasks: draft.tasks.map(task => task.taskId === taskId ? { ...task, ...patch } : task) });

/** Every fixture of a row is closed even when an assertion fails (held Runs are released by `steps.close`). */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  await cleanupRestart();
});

type Proposal = { n: number; ref: PlanProposal['ref']; revision: number };

type Fixture = {
  b2: B2ExecutionFixture;
  steps: S2BRuntimeSteps;
  plans: TaskClaimFixture['plans'];
  records: Records;
  plan: PlanRevisionSnapshot;
  propose(draft: PlanRevisionDraft, basedOn: PlanRevisionSnapshot | null, affectedTaskIds?: string[],
    caller?: CoreCallContext): Promise<Proposal>;
  apply(proposal: Proposal, requestId: string, caller?: CoreCallContext,
    over?: PlanTaskPort): Promise<WriteResult<PlanRevisionSnapshot>>;
  adopt(draft: PlanRevisionDraft, basedOn: PlanRevisionSnapshot | null, affectedTaskIds?: string[],
    caller?: CoreCallContext): Promise<WriteResult<PlanRevisionSnapshot>>;
  activePlan(): Promise<PlanRevisionRef | null>;
  row(taskId: string): Promise<TaskRow | undefined>;
  pauseGoal(): Promise<void>;
  planServiceOver(records: Records): PlanTaskPort;
  readRun(ref: RunRef): Promise<RunSnapshot>;
  /** A real claimed and entered Run, held at the Runtime's model gate. */
  startHeld(taskId: string, onPlan?: PlanRevisionRef): Promise<{ claim: TaskClaim; run: RunSnapshot; handle: S2BRunHandle }>;
  /** A real claimed Run that ends with a normal final reply. */
  endRun(taskId: string, onPlan?: PlanRevisionRef): Promise<RunSnapshot>;
  /** A real claimed Run a human stops through `submitControl` + delivery. */
  stopRun(taskId: string, onPlan?: PlanRevisionRef): Promise<RunSnapshot>;
  /** A real ended Run plus the real check chain and the formal reduction. */
  satisfy(taskId: string, onPlan?: PlanRevisionRef): Promise<RunSnapshot>;
  /**
   * A real claimed Run held at the model gate, its Kernel database moved aside, then the restarted Host's
   * start-up reconcile (RUN-20(ii)); answers the execution record read after it.
   */
  unknownOutcome(taskId: string, onPlan?: PlanRevisionRef): Promise<TaskExecutionRecord>;
  close(): Promise<void>;
};

async function setup(kind: ClaimFixtureKind): Promise<Fixture> {
  const b2 = await createB2ExecutionFixture(kind, A2_SCHEMAS);
  const base = b2.base;
  if (base.scope.projectId !== projectId || base.scope.workspaceId !== workspaceId) {
    throw new Error(`A2 C7 fixture scope changed: ${JSON.stringify(base.scope)}`);
  }
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-a2-c7-'));
  await mkdir(join(workspaceRoot, 'src'));
  await writeFile(join(workspaceRoot, 'src', 'a2-c7.txt'), 'a2 c7 verification source v1\n');
  const records = base.records;
  const plans = base.plans;
  const goals = base.goals;
  const executions = createRunStateReader({ records });
  let sequence = 0;
  let clock = AT;
  const now = (): string => clock;
  const eventId = (): string => `a2-c7-event-${++sequence}`;
  const newId = (): string => `a2-c7-id-${++sequence}`;
  const requestId = (label: string): string => `a2-c7-${label}-${++sequence}`;
  let steps!: S2BRuntimeSteps;
  try {
    steps = await createS2BRuntimeSteps({
      base, bodies: b2.bodies, ctx, directory: base.directory, scope: base.scope,
      now, setClock: (at) => { clock = at; }, eventId, newId, consumerId: 'a2-c7-runtime',
    });
    // The plan's required requirement kind is `static`; install and activate the
    // matching policy through the public bootstrap before the first adoption.
    await steps.installStaticCompletionPolicy('a2-c7-static-policy');

    const created = await goals.createGoal(ctx, { meta: { requestId: 'a2-c7-create-goal',
      expected: [{ ref: base.projectRef, revision: 1 }, { ref: base.workspaceRef, revision: 1 }] },
      input: { goalId: goalRef.goalId, workspace: { projectId, workspaceId }, objective: 'C7 disposition changes' } });
    if (created.status !== 'committed') throw new Error(`A2 C7 Goal creation failed: ${JSON.stringify(created)}`);
    let requests = 0;
    /** Proposes `draft` on the active Plan as `caller` (the operator by default). */
    async function propose(draft: PlanRevisionDraft, basedOn: PlanRevisionSnapshot | null, affectedTaskIds?: string[],
      caller: CoreCallContext = ctx): Promise<Proposal> {
      const n = ++requests;
      const proposed = await plans.proposePlan(caller, { meta: { requestId: `c7-propose-${n}`, expected: [] },
        input: { goalRef, basedOn: basedOn?.ref ?? null, draft,
          reason: { text: `C7 change ${n}`, sources: [], ...(affectedTaskIds === undefined ? {} : { affectedTaskIds }) } } });
      if (proposed.status !== 'committed') throw new Error(`A2 C7 proposal ${n} failed: ${JSON.stringify(proposed)}`);
      return { n, ref: proposed.value.ref, revision: proposed.value.revision };
    }
    /** Applies a proposed candidate as `caller` (the operator by default). */
    const apply = (proposal: Proposal, requestId: string, caller: CoreCallContext = ctx, over: PlanTaskPort = plans) =>
      over.applyPlanChange(caller, { meta: { requestId, expected: [] },
        input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] } });
    /** Proposes `draft` on the active Plan and applies it, both as `caller` (the operator by default). */
    async function adopt(draft: PlanRevisionDraft, basedOn: PlanRevisionSnapshot | null, affectedTaskIds?: string[],
      caller: CoreCallContext = ctx) {
      const proposed = await propose(draft, basedOn, affectedTaskIds, caller);
      return apply(proposed, `c7-apply-${proposed.n}`, caller);
    }
    const initial = await adopt(initialDraft(), null);
    if (initial.status !== 'committed') throw new Error(`A2 C7 initial adoption failed: ${JSON.stringify(initial)}`);
    const plan = initial.value;

    async function currentGoal() {
      const read = await plans.queryGoal(ctx, goalRef);
      if (read.status !== 'ready') throw new Error(`A2 C7 Goal read failed: ${JSON.stringify(read)}`);
      return read.value.goal;
    }
    async function activePlan(): Promise<PlanRevisionRef | null> {
      return (await currentGoal()).activePlanRevision;
    }
    async function row(taskId: string): Promise<TaskRow | undefined> {
      const graph = await plans.queryTaskGraph(ctx, { goalRef });
      if (graph.status !== 'ready') throw new Error(`the graph must be readable: ${JSON.stringify(graph)}`);
      return graph.value.tasks.find(candidate => candidate.ref.taskId === taskId);
    }
    async function readRun(ref: RunRef): Promise<RunSnapshot> {
      const read = await executions.readExecution(ctx, ref);
      if (read.status !== 'ready') throw new Error(`A2 C7 Run read failed: ${JSON.stringify(read)}`);
      return read.value.run;
    }

    /** A real claim over a fresh mapped Session and the current Goal/Workspace/Session pins. */
    async function claim(taskId: string, onPlan: PlanRevisionRef = plan.ref): Promise<TaskClaim> {
      const session = await base.createSession(`a2-c7-session-${taskId}-${++sequence}`);
      const goal = await currentGoal();
      const card = await base.sessionsPort.readSession(ctx, session);
      if (card.status !== 'ready') throw new Error(`A2 C7 Session read failed: ${JSON.stringify(card)}`);
      const request: GraphWrite<ClaimTaskInput> = { input: {
        goalRef, planRef: onPlan, taskId, sessionRef: session,
        roleBinding: base.roleBinding, budget: base.budget },
      meta: { requestId: requestId(`claim-${taskId}`), expected: [
        { ref: goalRef, revision: goal.revision },
        { ref: base.workspaceRef, revision: 1 },
        { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision },
      ] } };
      const claimed = await base.service.claimTask(ctx, request);
      if (claimed.status !== 'committed') throw new Error(`A2 C7 claim failed: ${JSON.stringify(claimed)}`);
      return claimed.value;
    }
    async function startHeld(taskId: string, onPlan: PlanRevisionRef = plan.ref) {
      const claimed = await claim(taskId, onPlan);
      const handle = await steps.start(claimed, { at: AT,
        replies: [{ kind: 'text', text: `A2 C7 ${taskId} is held at the real gate` }] });
      await handle.entered;
      return { claim: claimed, run: await readRun(claimed.runRef), handle };
    }
    async function endRun(taskId: string, onPlan: PlanRevisionRef = plan.ref): Promise<RunSnapshot> {
      const claimed = await claim(taskId, onPlan);
      const handle = await steps.start(claimed, { at: AT,
        replies: [{ kind: 'text', text: `A2 C7 ${taskId} finished` }] });
      await steps.finish(handle, AT, 'completed');
      return readRun(claimed.runRef);
    }
    async function stopRun(taskId: string, onPlan: PlanRevisionRef = plan.ref): Promise<RunSnapshot> {
      const claimed = await claim(taskId, onPlan);
      const handle = await steps.start(claimed, { at: AT,
        replies: [{ kind: 'text', text: `A2 C7 ${taskId} stopped` }] });
      await steps.finish(handle, AT, 'cancelled');
      return readRun(claimed.runRef);
    }

    const configuration: TrustedCheckConfiguration = {
      configurationRevision: 'a2-c7-checks-1', workspace: base.workspaceRef, executor: actor,
      permissionRevision: 'a2-c7-permission-1', sourceAccess: 'verification_workspace',
      processAccess: 'all_except_denied', deniedPrefixes: [],
      checks: [{ checkId: 'a2-c7-static-check', kind: 'static', command: 'echo A2_C7_CHECKS_OK',
        cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
    };
    const workspaceHost = {
      async resolveRoot(requested: { projectId: string; workspaceId: string }) {
        return requested.projectId === projectId && requested.workspaceId === workspaceId
          ? { status: 'ready' as const, value: { root: workspaceRoot, workspaceRevision: 1 } }
          : { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the A2 C7 fixture workspace is not registered' };
      },
      async authorize(authCtx: CoreCallContext, requested: { projectId: string; workspaceId: string }) {
        return authCtx.principal.kind === 'host' && requested.projectId === projectId && requested.workspaceId === workspaceId
          ? { status: 'ready' as const, value: { subjectKey: 'host:a2-c7', permissionRevision: 'a2-c7-permission-1',
            allowsRead: () => true } }
          : { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the A2 C7 Host does not authorize verification source' };
      },
    };
    const materials = createMaterialService({ bodies: b2.bodies,
      authority: createMaterialRecordReaders(records).authority, now });
    const evidence = createEvidenceService({ records, materials, executions, workspaceHost,
      source: new VerificationWorkspaceReader(), configuration, now, newId });
    const runner = createRegisteredCheckRunner({ evidence, workspaceHost, kernel, now });

    async function satisfy(taskId: string, onPlan: PlanRevisionRef = plan.ref): Promise<RunSnapshot> {
      const run = await endRun(taskId, onPlan);
      const opened = await evidence.openVerification(ctx, {
        input: { subjectRunRef: run.ref, subject: { projectId, goalId: goalRef.goalId, taskId }, planRef: onPlan },
        meta: { requestId: requestId(`open-${taskId}`), expected: [] },
      });
      if (opened.status !== 'committed') throw new Error(`A2 C7 round open failed: ${JSON.stringify(opened)}`);
      let round = opened.value;
      for (const check of round.checks) {
        const started = await runner.runRegisteredCheck(ctx, {
          input: { roundRef: round.ref, checkId: check.checkId },
          meta: { requestId: requestId(`run-${taskId}-${check.checkId}`), expected: [{ ref: round.ref, revision: round.revision }] },
        });
        if (started.status !== 'ready') throw new Error(`A2 C7 registered check ${check.checkId} did not run: ${JSON.stringify(started)}`);
        round = started.value;
      }
      const finalized = await evidence.finalizeChecks(ctx, {
        input: { roundRef: round.ref },
        meta: { requestId: requestId(`finalize-${taskId}`), expected: [{ ref: round.ref, revision: round.revision }] },
      });
      if (finalized.status !== 'committed') throw new Error(`A2 C7 finalize failed: ${JSON.stringify(finalized)}`);
      const goal = await currentGoal();
      const done = await goals.completeTask(ctx, {
        input: { taskRef: { projectId, goalId: goalRef.goalId, taskId }, planRef: onPlan,
          roundRef: finalized.value.snapshot.ref },
        meta: { requestId: requestId(`complete-${taskId}`), expected: [
          { ref: goalRef, revision: goal.revision },
          { ref: { aggregateType: 'TaskReduction', projectId, goalId: goalRef.goalId, taskId }, revision: 0 },
        ] },
      });
      if (done.status !== 'committed') throw new Error(`A2 C7 completeTask failed: ${JSON.stringify(done)}`);
      return run;
    }

    /**
     * Guard 2 (RUN-20(ii)): the Host is abandoned with a real Run held at the model gate (its Kernel Turn
     * open), the mapped Kernel database is moved aside (`tests/helpers/A2-restart-fixture.ts` `moveKernelAside`),
     * and the restarted Host reconciles at start-up over the same stores, as
     * `tests/helpers/S2B-runtime-tools-support.ts` `restartedHost`: a new Host instance holding the instance
     * lease, its Kernel Store registry for the same configured store (`S2B-runtime-steps-fixture.ts:219-220`),
     * the real probe (`missing`) and `reconcileRunAtStartup`. Unlike `restartedHost`, which rebuilds `entry` under
     * the new Host, the `entry` passed here is the B2 fixture's (`b2.entry`): it is not used on this W-14 missing
     * path (`src/core/agent-runtime/run-reconcile.ts:303-308`; only the Kernel-terminal branch records through
     * it, `:397`).
     */
    async function unknownOutcome(taskId: string, onPlan: PlanRevisionRef = plan.ref): Promise<TaskExecutionRecord> {
      const held = await startHeld(taskId, onPlan);
      await moveKernelAside(base.directory);
      const hostInstanceId = 'a2-c7-restarted-host';
      const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
        storeKey: 'r4c-claim-kernel-store', workspace: base.scope, databasePath: join(base.directory, 'kernel.sqlite') }] });
      const owner = createSessionHistoryCursorOwner({ kernelStores });
      const reconcile = createRunReconcileService({ records, reads: executions,
        hostInstance: { hostInstanceId, lease: 'owned' }, now, eventId });
      const executionRecord = async (): Promise<TaskExecutionRecord> => {
        const read = await executions.readExecution(ctx, held.claim.runRef);
        if (read.status !== 'ready') throw new Error(`A2 C7 Run read failed: ${JSON.stringify(read)}`);
        return read.value;
      };
      const before = await executionRecord();
      const probe = await owner.probe({ session: before.session, signal: ctx.signal });
      const report = await reconcileRunAtStartup({ owner, controls: steps.controls, entry: b2.entry, reconcile, now, newId },
        ctx, { record: before, hostInstanceId, probe });
      if (report.status !== 'reconciled') throw new Error(`A2 C7 start-up reconcile did not book the Run: ${JSON.stringify(report)}`);
      return executionRecord();
    }

    /** GOAL-04: the operator pauses the Goal, pinning the Goal and its GoalPhase as read (decision 29). */
    async function pauseGoal(): Promise<void> {
      const read = await plans.queryGoal(ctx, goalRef);
      if (read.status !== 'ready') throw new Error('the Goal must be readable');
      const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: goalRef.projectId, goalId: goalRef.goalId };
      const phase = await readGoalPhase(records, phaseRef);
      if (phase.status !== 'ready') throw new Error('the GoalPhase must be readable');
      const paused = await goals.setGoalControl(ctx, { meta: { requestId: 'c7-pause-goal',
        expected: [{ ref: goalRef, revision: read.value.goal.revision }, { ref: phaseRef, revision: phase.snapshot?.revision ?? 0 }] },
        input: { goalRef, control: 'pause', reason: null } });
      if (paused.status !== 'committed' || paused.value.desiredState !== 'paused') throw new Error(`C7 pause failed: ${JSON.stringify(paused)}`);
    }
    const planServiceOver = (target: Records): PlanTaskPort =>
      createPlanService({ records: target, bindings: createInitializationBindingReader({ records: target }), now, eventId });

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await steps.close();
      await b2.close();
      await rm(workspaceRoot, { recursive: true, force: true });
    };
    cleanups.push(close);
    return { b2, steps, plans, records, plan, propose, apply, adopt, activePlan, row, pauseGoal, planServiceOver,
      readRun, startHeld, endRun, stopRun, satisfy, unknownOutcome, close };
  } catch (error) {
    await steps?.close().catch(() => undefined);
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
    await b2.close().catch(() => undefined);
    throw error;
  }
}

describe('deriveFuturePlanDelta and the replacedByTaskId rule (pure, §3.3)', () => {
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: 'a2-c7-policy', revision: 1 };
  const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId, baselineId: 'a2-c7-baseline', revision: 1 };
  const source = { ...initialDraft(), ref: { aggregateType: 'PlanRevision', projectId, planId: 'c7-plan-1' }, revision: 1,
    goalRef, acceptedAt: AT, effectiveCompletionPolicy: { ref: policyRef, digest: 'a'.repeat(64) },
    effectiveArchitectureBaseline: { ref: architectureRef, digest: 'b'.repeat(64) } } as unknown as SnapshotV2;
  const draft = (edit: (draft: DraftV2) => DraftV2) => futureDraft(source, 'c7-plan-2', edit);
  const deltaOf = (target: DraftV2) => {
    const result = deriveFuturePlanDelta(source, target);
    if (result.status !== 'supported') throw new Error(result.reason);
    return result.delta;
  };

  it('only the disposition (or replacedByTaskId) differs → disposition-only, with the change listed', () => {
    expect(deltaOf(draft(target => disposed(target, 'A', { disposition: 'deferred' })))).toMatchObject({
      changedTaskIds: [], addedTaskIds: [], dispositionOnlyTaskIds: ['A'],
      dispositionChanges: [{ taskId: 'A', from: 'active', to: 'deferred', replacedByTaskId: null }], carrierRemovals: [] });
    // An explicit null where the source has no replacement is no change.
    expect(deltaOf(draft(target => disposed(target, 'A', { replacedByTaskId: null })))).toMatchObject({
      changedTaskIds: [], dispositionOnlyTaskIds: [], dispositionChanges: [] });
    // A superseded Task naming a new replacement is a disposition change from superseded to superseded (§3.3).
    const supersededA = { ...source, tasks: source.tasks.map(task => task.taskId === 'A'
      ? { ...task, disposition: 'superseded' as const, replacedByTaskId: 'B' } : task) } as SnapshotV2;
    const repointed = futureDraft(supersededA, 'c7-plan-2', target => disposed(target, 'A', { replacedByTaskId: null }));
    expect(deriveFuturePlanDelta(supersededA, repointed)).toMatchObject({ status: 'supported', delta: { changedTaskIds: [],
      dispositionOnlyTaskIds: ['A'], dispositionChanges: [{ taskId: 'A', from: 'superseded', to: 'superseded', replacedByTaskId: null }] } });
  });

  it('anything else changed (title, assignment, carried obligation) is a changed Task, its disposition change listed too', () => {
    expect(deltaOf(draft(target => disposed(target, 'A', { disposition: 'cancelled', title: 'Task A v2' })))).toMatchObject({
      changedTaskIds: ['A'], dispositionOnlyTaskIds: [], dispositionChanges: [{ taskId: 'A', from: 'active', to: 'cancelled' }],
      carrierRemovals: [] });
    expect(deltaOf(draft(target => ({ ...target, assignments: target.assignments!.map(assignment => assignment.taskId === 'A'
      ? { ...assignment, instruction: 'Run A differently' } : assignment) })))).toMatchObject({ changedTaskIds: ['A'], dispositionOnlyTaskIds: [] });
  });

  it('a Task that leaves an obligation is changed and named for the hint', () => {
    const left = draft(target => ({ ...disposed(target, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }),
      tasks: [...disposed(target, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }).tasks, work('B2')],
      obligations: target.obligations.map(obligation => obligation.obligationId === 'o-solo' ? { ...obligation, taskIds: ['B2'] } : obligation) }));
    expect(deltaOf(left)).toMatchObject({ changedTaskIds: ['B'], addedTaskIds: ['B2'], dispositionOnlyTaskIds: [],
      carrierRemovals: [{ taskId: 'B', obligationIds: ['o-solo'] }] });
    // Leaving an obligation AND changing the title: still named (§3.3 无痕规则: leaving an obligation is refused with the hint).
    const more = draft(() => ({ ...left, tasks: left.tasks.map(task => task.taskId === 'B' ? { ...task, title: 'Task B v2' } : task) }));
    expect(deltaOf(more)).toMatchObject({ changedTaskIds: ['B'], carrierRemovals: [{ taskId: 'B', obligationIds: ['o-solo'] }] });
    // A title change alone leaves no obligation.
    expect(deltaOf(draft(target => disposed(target, 'B', { title: 'Task B v2' }))).carrierRemovals).toEqual([]);
  });

  it.each<[string, Partial<RuntimeTask>, RegExp | null]>([
    ['superseded naming itself', { disposition: 'superseded', replacedByTaskId: 'A' }, /must name another work task of the target plan, not A/],
    ['superseded naming no task of the target', { disposition: 'superseded', replacedByTaskId: 'nope' }, /not nope/],
    ['superseded naming a gate (another kind)', { disposition: 'superseded', replacedByTaskId: 'gate' }, /not gate/],
    ['deferred naming a replacement', { disposition: 'deferred', replacedByTaskId: 'B' }, /only a superseded task names a replacement/],
    ['superseded naming another work task', { disposition: 'superseded', replacedByTaskId: 'B' }, null],
    ['superseded without a replacement', { disposition: 'superseded', replacedByTaskId: null }, null],
  ])('replacedByTaskId: %s', (_name, patch, problem) => {
    const target = draft(base => disposed(base, 'A', patch));
    const coverage = validateFutureObligationCoverage({ source, target, delta: deltaOf(target) });
    if (problem === null) {
      expect(coverage).toEqual({ status: 'supported' });
      return;
    }
    expect(coverage).toMatchObject({ status: 'rejected', issues: [expect.objectContaining({ path: 'tasks[A].replacedByTaskId',
      code: 'unsupported_execution_change', message: expect.stringMatching(problem) })] });
  });
});

/** Every service-layer row runs on both record backends (rule sheet v1, "Every row also"). */
const BACKENDS: readonly ClaimFixtureKind[] = ['memory', 'sqlite'];

describe.each(BACKENDS)('W16 disposition-only adoptions at the plan owner (C7, TASK-18/19) [%s]', kind => {
  it('an untraced Task changes only its disposition: source definition and basis kept, recorded traced:false, carried on', async () => {
    const f = await setup(kind);
    const deferred = await f.adopt(futureDraft(f.plan, 'c7-plan-2', draft => disposed(draft, 'A', { disposition: 'deferred', title: 'Task A v2' })),
      f.plan);
    // A title change too makes A a changed (untraced) Task: it takes the candidate definition and a new basis, and is recorded.
    if (deferred.status !== 'committed' || deferred.value.schemaVersion !== 2) throw new Error(JSON.stringify(deferred));
    expect(deferred.value.tasks.find(task => task.taskId === 'A')).toMatchObject({ disposition: 'deferred', title: 'Task A v2' });
    expect(deferred.value.taskStateBasis?.entries).toContainEqual({ taskId: 'A', planRef: deferred.value.ref });
    expect(deferred.value.dispositionRecord?.entries).toEqual([expect.objectContaining({ taskId: 'A', from: 'active', to: 'deferred',
      traced: false, setIn: deferred.value.ref, actor, reason: { text: 'C7 change 2', sources: [], affectedTaskIds: [] } })]);

    // Disposition only: the source definition with the new disposition, the basis inherited.
    const restored = await f.adopt(futureDraft(deferred.value, 'c7-plan-3', draft => disposed(draft, 'A', { disposition: 'active' })),
      deferred.value);
    if (restored.status !== 'committed' || restored.value.schemaVersion !== 2) throw new Error(JSON.stringify(restored));
    expect(restored.value.tasks.find(task => task.taskId === 'A')).toEqual({ ...deferred.value.tasks.find(task => task.taskId === 'A'),
      disposition: 'active' });
    expect(restored.value.taskStateBasis?.entries).toContainEqual({ taskId: 'A', planRef: deferred.value.ref });
    const latest = expect.objectContaining({ taskId: 'A', from: 'deferred', to: 'active', traced: false, setIn: restored.value.ref });
    expect(restored.value.dispositionRecord?.entries).toEqual([latest]);
    expect(await f.row('A')).toMatchObject({ disposition: 'active', dispositionChange: { from: 'deferred', to: 'active' } });

    // An unrelated adoption (a new Task) carries the record unchanged.
    const unrelated = await f.adopt(futureDraft(restored.value, 'c7-plan-4', draft => ({ ...draft, tasks: [...draft.tasks, work('C')],
      assignments: [...(draft.assignments ?? []), { taskId: 'C', role: 'builder', instruction: 'Run C' }],
      obligations: draft.obligations.map(obligation => obligation.obligationId === 'o-core'
        ? { ...obligation, taskIds: [...obligation.taskIds, 'C'] } : obligation) })), restored.value);
    if (unrelated.status !== 'committed' || unrelated.value.schemaVersion !== 2) throw new Error(JSON.stringify(unrelated));
    expect(unrelated.value.dispositionRecord).toEqual(restored.value.dispositionRecord);
    expect(await f.row('B')).not.toHaveProperty('dispositionChange');
  });

  it('a traced Task (ended Run, released lease) is superseded through TASK-19; listed, its basis and records stay', async () => {
    const f = await setup(kind);
    const run = await f.endRun('B');
    const replace = futureDraft(f.plan, 'c7-plan-2', draft => ({ ...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }),
      tasks: [...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }).tasks, work('B2')],
      assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
      obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B2'] })) }));
    expect(await f.adopt(replace, f.plan)).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'reason.affectedTaskIds must list traced task B' });
    const adopted = await f.adopt(replace, f.plan, ['B']);
    if (adopted.status !== 'committed' || adopted.value.schemaVersion !== 2) throw new Error(JSON.stringify(adopted));
    expect(adopted.value.taskStateBasis?.entries).toContainEqual({ taskId: 'B', planRef: f.plan.ref });
    expect(adopted.value.dispositionRecord?.entries).toEqual([expect.objectContaining({ taskId: 'B', from: 'active',
      to: 'superseded', replacedByTaskId: 'B2', traced: true })]);
    expect(await f.row('B')).toMatchObject({ disposition: 'superseded', execution: run.ref,
      dispositionChange: { traced: true, replacedByTaskId: 'B2' } });

    // An explicit `replacedByTaskId: null` on the traced, unlisted A (the source has none) is no change.
    await f.endRun('A', adopted.value.ref);
    const noop = await f.adopt(futureDraft(adopted.value, 'c7-plan-3', draft => disposed(draft, 'A', { replacedByTaskId: null })),
      adopted.value);
    if (noop.status !== 'committed' || noop.value.schemaVersion !== 2) throw new Error(JSON.stringify(noop));
    expect(noop.value.tasks.find(task => task.taskId === 'A')).toEqual(adopted.value.tasks.find(task => task.taskId === 'A'));
    expect(noop.value.dispositionRecord).toEqual(adopted.value.dispositionRecord);

    // Naming a new replacement is a disposition change of a traced Task (TASK-19, listed), recorded superseded → superseded.
    const repoint = futureDraft(noop.value, 'c7-plan-4', draft => ({ ...disposed(draft, 'B', { replacedByTaskId: 'B3' }),
      tasks: [...disposed(draft, 'B', { replacedByTaskId: 'B3' }).tasks, work('B3')],
      assignments: [...(draft.assignments ?? []), { taskId: 'B3', role: 'builder', instruction: 'Run B3' }],
      obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B3'] })) }));
    expect(await f.adopt(repoint, noop.value)).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'reason.affectedTaskIds must list traced task B' });
    const repointed = await f.adopt(repoint, noop.value, ['B']);
    if (repointed.status !== 'committed' || repointed.value.schemaVersion !== 2) throw new Error(JSON.stringify(repointed));
    expect(repointed.value.tasks.find(task => task.taskId === 'B')).toEqual({ ...f.plan.tasks.find(task => task.taskId === 'B'),
      disposition: 'superseded', replacedByTaskId: 'B3' });
    expect(repointed.value.taskStateBasis?.entries).toContainEqual({ taskId: 'B', planRef: f.plan.ref });
    const latest = expect.objectContaining({ taskId: 'B', from: 'superseded', to: 'superseded', replacedByTaskId: 'B3', traced: true,
      setIn: repointed.value.ref });
    expect(repointed.value.dispositionRecord?.entries).toEqual([latest]);
    expect(await f.row('B')).toMatchObject({ disposition: 'superseded', dispositionChange: latest });
  });

  it('a paused Goal still adopts a traced disposition change (W16 is a plan adoption, not a rework; S17)', async () => {
    const f = await setup(kind);
    await f.endRun('B');
    await f.pauseGoal();
    const deferB = futureDraft(f.plan, 'c7-plan-2', draft => ({ ...disposed(draft, 'B', { disposition: 'deferred' }),
      tasks: [...disposed(draft, 'B', { disposition: 'deferred' }).tasks, work('B2')],
      assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
      obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B2'] })) }));
    expect(await f.adopt(deferB, f.plan, ['B'])).toMatchObject({ status: 'committed',
      value: { dispositionRecord: { entries: [expect.objectContaining({ taskId: 'B', from: 'active', to: 'deferred', traced: true })] } } });
  });

  describe('rejects: TASK-19 and the untraced rule refuse a traced Task, zero writes', () => {
    it.each<[string, (f: Fixture) => Promise<{ runId: string }>, (seeded: { runId: string }) => object]>([
      ['a running Run (guard 1)', async f => ({ runId: (await f.startHeld('B')).run.ref.runId }),
        seeded => ({ code: 'busy', reason: `task B still has an unfinished execution: run ${seeded.runId} is running` })],
      // RUN-20(ii): the restarted Host ends the held Run `outcome_unknown` and the Lease stays held, so guard 4
      // would refuse too; guard 2 runs before it and names the unknown outcome.
      ['an unknown outcome (guard 2)', async f => {
        const record = await f.unknownOutcome('B');
        expect(record.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
        expect(record.lease).not.toBeNull();
        expect(record.lease?.release).toBeUndefined();
        return { runId: record.run.ref.runId };
      }, seeded => ({ code: 'busy', reason: `task B: resolve the unknown outcome of run ${seeded.runId} first` })],
      ['a satisfied Task (guard 5)', async f => ({ runId: (await f.satisfy('B')).ref.runId }),
        () => ({ code: 'invalid', reason: 'task B is satisfied; the disposition of a satisfied task is final' })],
    ])('TASK-19 refuses %s, zero writes', async (_name, seed, refusal) => {
      const f = await setup(kind);
      const seeded = await seed(f);
      const cancelB = futureDraft(f.plan, 'c7-plan-2', draft => ({ ...disposed(draft, 'B', { disposition: 'cancelled' }),
        tasks: [...disposed(draft, 'B', { disposition: 'cancelled' }).tasks, work('B2')],
        assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
        obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B2'] })) }));
      const before = await f.activePlan();
      expect(before).toEqual(f.plan.ref);
      expect(await f.adopt(cancelB, f.plan, ['B'])).toMatchObject({ status: 'rejected', ...refusal(seeded) });
      expect(await f.activePlan()).toEqual(f.plan.ref);
    });

    it('a traced Task that leaves an obligation is changed: the untraced rule refuses it and says how to keep it', async () => {
      const f = await setup(kind);
      await f.endRun('B');
      const moved = futureDraft(f.plan, 'c7-plan-2', draft => ({ ...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }),
        tasks: [...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }).tasks, work('B2')],
        assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
        obligations: draft.obligations.map(obligation => obligation.obligationId === 'o-solo' ? { ...obligation, taskIds: ['B2'] }
          : { ...obligation, taskIds: [...obligation.taskIds, 'B2'] }) }));
      const before = await f.activePlan();
      expect(before).toEqual(f.plan.ref);
      expect(await f.adopt(moved, f.plan, ['B'])).toEqual({ status: 'rejected', code: 'revision_conflict',
        reason: 'task B already has a Run and is no longer a future task; a traced task may change only its disposition or '
          + 'replacedByTaskId: keep it in obligations[o-solo].taskIds and add the replacement task as another carrier' });
      expect(await f.activePlan()).toEqual(f.plan.ref);
    });
  });

  it('a gate never changes its disposition; deferring the only carrier of a required obligation is invalid', async () => {
    const f = await setup(kind);
    expect(await f.adopt(futureDraft(f.plan, 'c7-plan-2', draft => disposed(draft, 'gate', { disposition: 'cancelled' })), f.plan))
      .toMatchObject({ status: 'rejected', code: 'invalid', reason: expect.stringContaining('source gate task gate changed its definition') });
    expect(await f.adopt(futureDraft(f.plan, 'c7-plan-2b', draft => disposed(draft, 'B', { disposition: 'deferred' })), f.plan))
      .toMatchObject({ status: 'rejected', code: 'invalid',
        reason: expect.stringContaining('required obligation o-solo no longer has a valid active required carrier') });
    expect(await f.activePlan()).toEqual(f.plan.ref);
  });
});

describe.each(BACKENDS)('guards 7 and 9 by the adopter class (§1 reworkActorClassOf(principal, actor); LA-3) [%s]', kind => {
  /** B superseded by a new B2 that joins every obligation. */
  const supersedeB = (source: PlanRevisionSnapshot, planId: string) => futureDraft(source, planId, draft => ({
    ...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }),
    tasks: [...disposed(draft, 'B', { disposition: 'superseded', replacedByTaskId: 'B2' }).tasks, work('B2')],
    assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
    obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'B2'] })) }));
  /** B kept and a parallel carrier B2 added to o-solo, whose only active work carrier is B. */
  const parallelToB = (source: PlanRevisionSnapshot, planId: string) => futureDraft(source, planId, draft => ({ ...draft,
    tasks: [...draft.tasks, work('B2')],
    assignments: [...(draft.assignments ?? []), { taskId: 'B2', role: 'builder', instruction: 'Run B2' }],
    obligations: draft.obligations.map(obligation => obligation.obligationId === 'o-solo'
      ? { ...obligation, taskIds: [...obligation.taskIds, 'B2'] } : obligation) }));

  it('guard 9: a carrier no human stopped is no limit: the automation actor adds a parallel carrier beside it', async () => {
    const f = await setup(kind);
    await f.endRun('B');
    // B ended unfenced: the automation actor adds B2 beside it.
    const unfenced = await f.adopt(parallelToB(f.plan, 'c7-plan-2'), f.plan, undefined, automation);
    expect(unfenced).toMatchObject({ status: 'committed' });
  });

  describe('rejects: a human stop fences the automation actor (guards 7 and 9); an operator adopts', () => {
    it('a human-stopped Task: the automation actor may not supersede it (guard 7); a Host started as kind:system is an operator (S21)', async () => {
      const f = await setup(kind);
      await f.stopRun('B');
      const candidate = await f.propose(supersedeB(f.plan, 'c7-plan-2'), f.plan, ['B'], automation);
      const before = await f.activePlan();
      expect(before).toEqual(f.plan.ref);
      expect(await f.apply(candidate, 'c7-s21-auto', automation)).toEqual({ status: 'rejected', code: 'forbidden',
        reason: 'only an operator may change the disposition of task B: a human paused or cancelled it' });
      expect(await f.activePlan()).toEqual(f.plan.ref);
      // The same candidate adopted by a Host operator whose actor is kind:'system' (not an automation actor): class human.
      const adopted = await f.apply(candidate, 'c7-s21-host-op', hostCtx(hostOperator));
      if (adopted.status !== 'committed' || adopted.value.schemaVersion !== 2) throw new Error(JSON.stringify(adopted));
      expect(adopted.value.dispositionRecord?.entries).toEqual([expect.objectContaining({ taskId: 'B', to: 'superseded', traced: true,
        actor: hostOperator })]);
    });

    it('guard 9: the automation actor may not add a carrier beside a human-stopped one; the operator may', async () => {
      const f = await setup(kind);
      await f.stopRun('B');
      const before = await f.activePlan();
      expect(before).toEqual(f.plan.ref);
      expect(await f.adopt(parallelToB(f.plan, 'c7-plan-2'), f.plan, undefined, automation)).toEqual({ status: 'rejected',
        code: 'forbidden', reason: 'obligation o-solo: a human stopped this work; only an operator may add the parallel carrier B2' });
      // Nothing changed between the refusal and the operator adoption.
      expect(await f.activePlan()).toEqual(f.plan.ref);
      // The operator is never limited by guard 9.
      expect(await f.adopt(parallelToB(f.plan, 'c7-plan-2'), f.plan)).toMatchObject({ status: 'committed' });
    });

    it('a human stop between the guard 9 read and the adoption commit moves the carrier\'s pinned Run: revision_conflict, zero writes; a re-read is forbidden', async () => {
      const f = await setup(kind);
      // B's real Run is running and nobody stopped it when guard 9 reads it.
      const { run } = await f.startHeld('B');
      const candidate = await f.propose(parallelToB(f.plan, 'c7-plan-2'), f.plan, undefined, automation);
      const before = await f.activePlan();
      expect(before).toEqual(f.plan.ref);
      let raced = false;
      const racing: typeof f.records = { ...f.records, async commit(prepared) {
        if (!raced && prepared.identityKey.startsWith('plan-apply:')) {
          raced = true;
          // A3: the adoption commit waits while the operator really cancels B's running Run, pinned at the
          // revision a public read returns now.
          const current = await f.readRun(run.ref);
          const stopped = await f.steps.controls.submitControl(ctx, {
            input: { runRef: run.ref, kind: 'cancel', reason: 'an operator stopped it' },
            meta: { requestId: 'c7-g9-race-cancel', expected: [{ ref: run.ref, revision: current.revision }] } });
          if (stopped.status !== 'committed') throw new Error(`A2 C7 race cancel failed: ${JSON.stringify(stopped)}`);
        }
        return f.records.commit(prepared);
      } };
      // Guard 9 read B (its only active work carrier) unfenced and pinned its Run: the cancel moved that Run, so the pin is stale.
      expect(await f.apply(candidate, 'c7-g9-race-1', automation, f.planServiceOver(racing)))
        .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(raced).toBe(true);
      expect(await f.activePlan()).toEqual(f.plan.ref);
      // Read again, B is fenced: guard 9.
      expect(await f.apply(candidate, 'c7-g9-race-2', automation)).toEqual({ status: 'rejected', code: 'forbidden',
        reason: 'obligation o-solo: a human stopped this work; only an operator may add the parallel carrier B2' });
      expect(await f.activePlan()).toEqual(f.plan.ref);
    });
  });
});

describe.each(BACKENDS)('an Agent adoption (W2 apply_future_plan, adopter class agent) [%s]', kind => {
  describe('rejects: an Agent cannot change its own running Task', () => {
    it('cannot change the disposition of its own running Task (TASK-19 guard 1: busy), zero writes', async () => {
      const f = await createW2WhiteboardFixture(kind);
      try {
        const draft = f.futureDraft('c7-w2-defer-own', base => ({ ...base,
          tasks: base.tasks.map(task => task.taskId === 'implement-a' ? { ...task, disposition: 'deferred' as const } : task) }));
        const proposed = await f.proposeAsWorkRun(draft, f.planRef, { requestId: 'c7-w2-defer-own' });
        if (proposed.status !== 'committed') throw new Error(`C7 W2 own-task proposal failed: ${JSON.stringify(proposed)}`);
        const candidate = proposed.value;
        const before = await f.goalPin();
        expect(await f.applyAsWorkRun(candidate.ref, candidate.revision, { requestId: 'c7-w2-defer-own-apply' })).toMatchObject({
          status: 'rejected', code: 'busy', reason: expect.stringMatching(/^task implement-a still has an unfinished execution: run .* is running$/) });
        expect(await f.goalPin()).toEqual(before);
      } finally {
        await f.close();
      }
    });
  });

  /** The W2 fixture with every ControlIntent group, so a real human stop can be submitted. */
  const W2_CONTROL_SCHEMAS = { records: CONTROL_RECORD_SCHEMAS.records, events: CONTROL_RECORD_SCHEMAS.events,
    lookups: CONTROL_RECORD_SCHEMAS.lookups };
  const implementC: RuntimeTask = { taskId: 'implement-c', title: 'Implement C', requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' };

  /** The shared S2B Runtime over the W2 fixture's own real backend: sibling Runs are real claims + real starts. */
  async function siblingRuntime(f: W2WhiteboardFixture): Promise<S2BRuntimeSteps> {
    let sequence = 0;
    let clock = AT;
    return createS2BRuntimeSteps({
      base: f.base, bodies: f.b2.bodies, ctx: f.base.ctx, directory: f.base.directory, scope: f.base.scope,
      now: () => clock, setClock: (at) => { clock = at; },
      eventId: () => `a2-c7-w2-event-${++sequence}`, newId: () => `a2-c7-w2-id-${++sequence}`,
      consumerId: 'a2-c7-w2-sibling',
    });
  }
  /** A Host adoption of a future revision that detaches implement-b from implement-a, so it can really be claimed. */
  async function detachSibling(f: W2WhiteboardFixture, requestIdBase: string, edit?: (draft: DraftV2) => DraftV2) {
    const draft = f.futureDraft(requestIdBase, base => edit === undefined
      ? { ...base, executionDag: { dependsOn: [] } }
      : edit({ ...base, executionDag: { dependsOn: [] } }));
    const proposed = await f.proposeAsHost(draft, f.planRef, { requestId: requestIdBase });
    if (proposed.status !== 'committed') throw new Error(JSON.stringify(proposed));
    const applied = await f.applyAsHost(proposed.value.ref, proposed.value.revision, { requestId: `${requestIdBase}-apply` });
    if (applied.status !== 'committed' || applied.value.schemaVersion !== 2) throw new Error(JSON.stringify(applied));
    return applied.value;
  }
  /**
   * A real sibling Run of `taskId` on `planRef`: the formal claim over a fresh
   * Session, the production prepare/start, and either a normal final reply or
   * the real `submitControl` cancel (`stopped`). No Run/Lease is hand-written.
   */
  async function endSibling(f: W2WhiteboardFixture, steps: S2BRuntimeSteps, taskId: string,
    planRef: PlanRevisionRef, stopped: boolean): Promise<void> {
    const session = await f.base.createSession(`a2-c7-w2-sibling-${taskId}-${stopped ? 'stopped' : 'ended'}`);
    const goal = await f.goalPin(f.goalRef);
    const card = await f.base.sessionsPort.readSession(f.base.ctx, session);
    if (card.status !== 'ready') throw new Error(`C7 W2 sibling Session read failed: ${JSON.stringify(card)}`);
    const request: GraphWrite<ClaimTaskInput> = { input: {
      goalRef: f.goalRef, planRef, taskId, sessionRef: session,
      roleBinding: f.base.roleBinding, budget: f.base.budget },
    meta: { requestId: `a2-c7-w2-claim-${taskId}-${stopped ? 'stopped' : 'ended'}`, expected: [
      goal,
      { ref: f.base.workspaceRef, revision: 1 },
      { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision },
    ] } };
    const claimed = await f.base.service.claimTask(f.base.ctx, request);
    if (claimed.status !== 'committed') throw new Error(`C7 W2 sibling claim failed: ${JSON.stringify(claimed)}`);
    const handle = await steps.start(claimed.value, { at: AT,
      replies: [{ kind: 'text', text: `A2 C7 W2 sibling ${taskId}` }] });
    await steps.finish(handle, AT, stopped ? 'cancelled' : 'completed');
  }
  /** The Agent's own `propose_future_plan` on `basedOn`, with `reason.affectedTaskIds` when given. */
  async function proposeAsAgent(f: W2WhiteboardFixture, draft: PlanRevisionDraft, basedOn: PlanRevisionSnapshot, requestId: string,
    affectedTaskIds?: string[]) {
    const request = await f.buildAgentProposeRequest(f.goalRef, basedOn.ref, draft, basedOn.ref, { requestId });
    const proposed = await f.plans.proposePlan(f.ctxWork, { meta: request.meta, input: { ...request.input,
      reason: { text: 'C7 Agent change', sources: [], ...(affectedTaskIds === undefined ? {} : { affectedTaskIds }) } } });
    if (proposed.status !== 'committed') throw new Error(`C7 Agent proposal ${requestId} failed: ${JSON.stringify(proposed)}`);
    return proposed.value;
  }

  it('defers a sibling whose Run ended (TASK-19, class agent): committed, recorded with the agent actor, shown on the row', async () => {
    const f = await createW2WhiteboardFixture(kind, { ...W2_CONTROL_SCHEMAS, lookups: W2_CONTROL_SCHEMAS.lookups ?? [] });
    const steps = await siblingRuntime(f);
    try {
      // The sibling is detached from implement-a through the public future revision, then really claimed and ended.
      const p2 = await detachSibling(f, 'c7-w2-detach-b');
      await endSibling(f, steps, 'implement-b', p2.ref, false);
      const draft = f.futureDraftFor(p2, 'c7-w2-defer-b', base => ({ ...base,
        tasks: base.tasks.map(task => task.taskId === 'implement-b' ? { ...task, disposition: 'deferred' as const } : task) }));
      const candidate = await proposeAsAgent(f, draft, p2, 'c7-w2-defer-b', ['implement-b']);
      const applied = await f.applyAsWorkRun(candidate.ref, candidate.revision, { requestId: 'c7-w2-defer-b-apply' });
      if (applied.status !== 'committed' || applied.value.schemaVersion !== 2) throw new Error(JSON.stringify(applied));
      const entry = expect.objectContaining({ taskId: 'implement-b', from: 'active', to: 'deferred', traced: true,
        actor: expect.objectContaining({ kind: 'agent', runRef: f.claim.runRef }) });
      expect(applied.value.dispositionRecord?.entries).toEqual([entry]);
      const graph = await f.plans.queryTaskGraph(f.ctxHost, { goalRef: f.goalRef });
      if (graph.status !== 'ready') throw new Error(JSON.stringify(graph));
      expect(graph.value.tasks.find(row => row.ref.taskId === 'implement-b')).toMatchObject({ disposition: 'deferred',
        dispositionChange: entry });
    } finally {
      await steps.close();
      await f.close();
    }
  });

  /**
   * The human-stopped sibling world: the operator first gives implement-b (still untraced) an obligation it
   * alone carries, and detaches it so it can be claimed; its Run is on P2, where its execution definition
   * (now carrying obligation-b) has its basis, and a real human stop ends it.
   */
  async function stoppedSiblingWorld(f: W2WhiteboardFixture, steps: S2BRuntimeSteps) {
    const p2 = await detachSibling(f, 'c7-w2-own-b', base => ({ ...base, obligations: [...base.obligations,
      { obligationId: 'obligation-b', title: 'Deliver B', requirementLevel: 'required', taskIds: ['implement-b'],
        verificationRequirements: [{ requirementId: 'check-b', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }] }));
    await endSibling(f, steps, 'implement-b', p2.ref, true);
    return { p2, pins: await f.callerPins(f.goalRef, p2.ref) };
  }

  describe('rejects: a human-stopped sibling fences the Agent (guards 7 and 9); an operator adopts', () => {
    it('may not change a human-stopped sibling (guard 7), zero writes', async () => {
      const f = await createW2WhiteboardFixture(kind, { ...W2_CONTROL_SCHEMAS, lookups: W2_CONTROL_SCHEMAS.lookups ?? [] });
      const steps = await siblingRuntime(f);
      try {
        const { p2, pins } = await stoppedSiblingWorld(f, steps);
        const before = await f.goalPin();
        // Guard 7: an Agent may not supersede what a human stopped.
        const supersede = f.futureDraftFor(p2, 'c7-w2-supersede-b', base => ({ ...base,
          tasks: [...base.tasks.map(task => task.taskId === 'implement-b'
            ? { ...task, disposition: 'superseded' as const, replacedByTaskId: 'implement-c' } : task), implementC],
          assignments: [...(base.assignments ?? []), { taskId: 'implement-c', role: 'builder', instruction: 'Implement C' }],
          obligations: base.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, 'implement-c'] })) }));
        const superseding = await proposeAsAgent(f, supersede, p2, 'c7-w2-supersede-b', ['implement-b']);
        expect(await f.applyAsWorkRun(superseding.ref, superseding.revision, { requestId: 'c7-w2-supersede-b-apply', expected: pins }))
          .toEqual({ status: 'rejected', code: 'forbidden',
            reason: 'only an operator may change the disposition of task implement-b: a human paused or cancelled it' });
        expect(await f.goalPin()).toEqual(before);
      } finally {
        await steps.close();
        await f.close();
      }
    });

    it('may not add a carrier beside a human-stopped sibling (guard 9), zero writes; an operator adopts the same candidate', async () => {
      const f = await createW2WhiteboardFixture(kind, { ...W2_CONTROL_SCHEMAS, lookups: W2_CONTROL_SCHEMAS.lookups ?? [] });
      const steps = await siblingRuntime(f);
      try {
        const { p2, pins } = await stoppedSiblingWorld(f, steps);
        const before = await f.goalPin();
        // Guard 9: nor keep it and add a parallel carrier to the obligation it alone carries.
        const parallel = f.futureDraftFor(p2, 'c7-w2-parallel-b', base => ({ ...base, tasks: [...base.tasks, implementC],
          assignments: [...(base.assignments ?? []), { taskId: 'implement-c', role: 'builder', instruction: 'Implement C' }],
          obligations: base.obligations.map(obligation => obligation.obligationId === 'obligation-b'
            ? { ...obligation, taskIds: [...obligation.taskIds, 'implement-c'] } : obligation) }));
        const adding = await proposeAsAgent(f, parallel, p2, 'c7-w2-parallel-b');
        expect(await f.applyAsWorkRun(adding.ref, adding.revision, { requestId: 'c7-w2-parallel-b-apply', expected: pins }))
          .toEqual({ status: 'rejected', code: 'forbidden',
            reason: 'obligation obligation-b: a human stopped this work; only an operator may add the parallel carrier implement-c' });
        expect(await f.goalPin()).toEqual(before);

        // The operator adopts the same candidate through plans/apply (class human: guard 9 does not apply).
        expect(await f.applyAsHost(adding.ref, adding.revision, { requestId: 'c7-w2-parallel-b-host', expected: pins }))
          .toMatchObject({ status: 'committed' });
      } finally {
        await steps.close();
        await f.close();
      }
    });
  });
});
