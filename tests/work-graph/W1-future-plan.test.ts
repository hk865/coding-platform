/**
 * W1 behavior tests — future-task whiteboard revision (memory).
 *
 * These tests exercise the REAL public Plan entry points (`proposePlan` /
 * `applyPlanChange` / `queryTaskGraph` / `queryReadyTasks`) over the real
 * Memory RecordStore. These behavior tests were frozen before implementation;
 * the independent review then strengthened the existing scenarios to cover
 * basis-source integrity and the exact future-only authorization boundary.
 *
 * Every prior fact is produced by the product: Project/Workspace, the
 * completion policy and the architecture baseline by the public project
 * bootstrap (inside `createB2ExecutionFixture`); the Goal and every accepted
 * Plan by `createGoal` / `proposePlan` / `applyPlanChange`; Runs by the real
 * `claimTask`, the production prepare and the real Runtime start (a scripted
 * model held at the gate while a Run must stay running); C's formal reduction
 * by the real Runtime end, `openVerification`, `runRegisteredCheck`,
 * `finalizeChecks` and `completeTask`. No Run, Lease, check result, entered
 * fact or reduction is written by the test.
 *
 * BLOCKED (missing entry point): no public read returns C's TaskReduction
 * (revision, reducedAt, anchor, evidence ids); `TaskRow` carries none of them.
 * Scenario 1/2 therefore keeps the w2-base stored-bytes comparison of C's
 * Reduction record (`readJsons`) until such a read exists.
 *
 * The plan's required requirement kind is `static` (a registered command
 * check covers only the executable `static`/`dynamic` kinds), and the matching
 * policy is installed and activated through the public project bootstrap
 * before the first adoption. The registered check executes through the real
 * Kernel ProcessSandbox; a sandbox without `/usr/bin/bwrap` fails there.
 *
 * Specification: docs/refactor/tasks/W1-future-plan-skeleton.md §8.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import { createS2BRuntimeSteps, type S2BRunHandle, type S2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import type { Records } from '../helpers/task-claim-fixture.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createRegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { decodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { EncodedRecord, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { GoalRef, GoalSnapshot, VersionedRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { RunRef, RunSnapshot, TaskLeaseSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskReductionSnapshot } from '../../src/contracts/reduction.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { PlanProposal, PlanProposalRef, TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';

const AT = '2026-09-25T00:00:00.000Z';
// The accepted claim fixture's fixed scope; `setup` verifies it before use.
const projectId = 'r4c-claim-project';
const workspaceId = 'r4c-claim-workspace';
const actor = { kind: 'human' as const, id: 'w1-operator' };
const ctx: CoreCallContext = { projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal };

/** Every fixture of a row: the held Runs are released and the real backends
 * and temporary workspace are closed even when an assertion fails. */
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

type PlanDraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;
type SnapshotV2 = Extract<PlanRevisionSnapshot, { schemaVersion: 2 }>;

/** The extra record groups the real evidence and completion owners write. */
const W1_SCHEMAS: RecordBackendSchemas = {
  records: [...EVIDENCE_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records],
  events: [...EVIDENCE_RECORD_SCHEMAS.events, ...COMPLETION_RECORD_SCHEMAS.events],
  lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(COMPLETION_RECORD_SCHEMAS.lookups ?? [])],
};

const work = (taskId: string, title: string): RuntimeTask => ({ taskId, title,
  requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
const gate = (taskId: string, title: string): RuntimeTask => ({ taskId, title,
  requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } });
/** o-core/o-solo's required requirement is covered by the fixture's real
 * registered `static` command check (the only executable registered kind). */
const check = (requirementId: string) => ({ requirementId, requirementLevel: 'required' as const,
  kind: 'static', description: 'Tests pass' });

/** Source P1 already carries a required obligation (`o-solo`) whose ONLY
 * required carrier is B: a candidate that cancels or optionally replaces B
 * genuinely exercises the coverage rule instead of adding a new obligation. */
function initialDraft(): PlanDraftV2 {
  return { schemaVersion: 2, planId: 'w1-plan-1', planRevision: 1, goalId: 'goal-1', stages: [],
    tasks: [work('A', 'Task A'), work('B', 'Task B'), work('C', 'Task C'), gate('gate-goal', 'Goal gate')],
    assignments: [
      { taskId: 'A', role: 'builder', instruction: 'Run A' },
      { taskId: 'B', role: 'builder', instruction: 'Run B' },
      { taskId: 'C', role: 'builder', instruction: 'Run C' },
    ],
    obligations: [
      { obligationId: 'o-core', title: 'Deliver core', requirementLevel: 'required',
        taskIds: ['A', 'B', 'C', 'gate-goal'], verificationRequirements: [check('check-core')] },
      { obligationId: 'o-solo', title: 'Deliver B only', requirementLevel: 'required',
        taskIds: ['B'], verificationRequirements: [check('check-solo')] },
    ],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    taskRelations: [], inputRequirements: [] };
}

function editBDraft(): PlanDraftV2 {
  const base = initialDraft();
  return { ...base, planId: 'w1-plan-2', planRevision: 2,
    tasks: base.tasks.map(task => task.taskId === 'B' ? { ...task, title: 'Task B v2' } : task),
    assignments: (base.assignments ?? []).map(assignment => assignment.taskId === 'B'
      ? { ...assignment, instruction: 'Run B v2' } : assignment),
    taskRelations: [{ fromTaskId: 'A', toTaskId: 'B', kind: 'coordination', note: 'advisory follow-up' }] };
}

/** Only an advisory prompt edge to the running A: no execution definition of A
 * (or any Task) changes, so every basis must stay on the source Plan. */
function pureEdgeDraft(): PlanDraftV2 {
  const base = initialDraft();
  return { ...base, planId: 'w1-plan-edge', planRevision: 2,
    taskRelations: [{ fromTaskId: 'A', toTaskId: 'B', kind: 'coordination', note: 'advisory only' }] };
}

/** Split future B into B1/B2, superseding B without deleting it; the required
 * carrier of o-solo moves to B1, o-core membership is recomputed. */
function splitBDraft(): PlanDraftV2 {
  const base = initialDraft();
  const supersededB: RuntimeTask = { ...base.tasks[1]!, disposition: 'superseded', replacedByTaskId: 'B1' };
  return { ...base, planId: 'w1-plan-split', planRevision: 2,
    tasks: [base.tasks[0]!, supersededB, work('B1', 'Task B1'), work('B2', 'Task B2'), base.tasks[2]!, base.tasks[3]!],
    assignments: [
      { taskId: 'A', role: 'builder', instruction: 'Run A' },
      { taskId: 'B', role: 'builder', instruction: 'Run B (superseded)' },
      { taskId: 'B1', role: 'builder', instruction: 'Run B1' },
      { taskId: 'B2', role: 'builder', instruction: 'Run B2' },
      { taskId: 'C', role: 'builder', instruction: 'Run C' },
    ],
    obligations: [
      { obligationId: 'o-core', title: 'Deliver core', requirementLevel: 'required',
        taskIds: ['A', 'B1', 'B2', 'C', 'gate-goal'], verificationRequirements: [check('check-core')] },
      { obligationId: 'o-solo', title: 'Deliver B only', requirementLevel: 'required',
        taskIds: ['B1'], verificationRequirements: [check('check-solo')] },
    ] };
}

/** o-solo exists in the source and is carried by B alone; cancelling B leaves
 * that required obligation without any valid required carrier. */
function cancelSoleCarrierDraft(): PlanDraftV2 {
  const base = initialDraft();
  return { ...base, planId: 'w1-plan-cancel', planRevision: 2,
    tasks: base.tasks.map(task => task.taskId === 'B' ? { ...task, disposition: 'cancelled' } : task) };
}

/** Replace the required o-solo carrier with an OPTIONAL task. */
function optionalReplacementDraft(): PlanDraftV2 {
  const base = cancelSoleCarrierDraft();
  return { ...base, planId: 'w1-plan-optional', planRevision: 2,
    tasks: [...base.tasks, { ...work('B1', 'Optional replacement'), requirementLevel: 'optional' }],
    assignments: [...(base.assignments ?? []), { taskId: 'B1', role: 'builder', instruction: 'Optional B1' }],
    obligations: base.obligations.map(obligation => obligation.obligationId === 'o-core'
      ? { ...obligation, taskIds: ['A', 'C', 'gate-goal'] }
      : { ...obligation, taskIds: ['B1'] }) };
}

/** Silently rewrite o-solo's compiled verification body. */
function changedVerificationDraft(): PlanDraftV2 {
  const base = editBDraft();
  return { ...base, planId: 'w1-plan-verify', planRevision: 2,
    obligations: base.obligations.map(obligation => ({
      ...obligation,
      verificationRequirements: obligation.verificationRequirements.map(requirement => ({
        ...requirement, description: 'Weakened check' })),
    })) };
}

/** Introduce a new role/authorization through the whiteboard. */
function roleEscalationDraft(): PlanDraftV2 {
  const base = editBDraft();
  return { ...base, planId: 'w1-plan-role', planRevision: 2,
    assignments: (base.assignments ?? []).map(assignment => assignment.taskId === 'B'
      ? { ...assignment, role: 'privileged-admin' } : assignment) };
}

/** A new Task starts pending; a caller cannot invent a blocked execution state. */
function blockedNewTaskDraft(): PlanDraftV2 {
  const base = initialDraft();
  return { ...base, planId: 'w1-plan-blocked-new', planRevision: 2,
    tasks: [...base.tasks, { ...work('B1', 'Task B1'), phase: 'blocked' }],
    assignments: [...(base.assignments ?? []), { taskId: 'B1', role: 'builder', instruction: 'Run B1' }],
    obligations: base.obligations.map(obligation => obligation.obligationId === 'o-core'
      ? { ...obligation, taskIds: [...obligation.taskIds, 'B1'] } : obligation) };
}

/** A whiteboard edit cannot change the source's review-admission protocol. */
function changedReviewProtocolDraft(): PlanDraftV2 {
  return { ...editBDraft(), planId: 'w1-plan-review-protocol', reviewAdmissionProtocol: 'independent-review-v1' };
}

type W1Fixture = {
  b2: B2ExecutionFixture;
  ctx: CoreCallContext;
  records: Records;
  plans: B2ExecutionFixture['base']['plans'];
  goals: B2ExecutionFixture['base']['goals'];
  executions: ReturnType<typeof createRunStateReader>;
  steps: S2BRuntimeSteps;
  evidence: ReturnType<typeof createEvidenceService>;
  runner: ReturnType<typeof createRegisteredCheckRunner>;
  projectRef: B2ExecutionFixture['base']['projectRef'];
  workspaceRef: B2ExecutionFixture['base']['workspaceRef'];
  goalRef: GoalRef;
  plan: PlanRevisionSnapshot;
  planRef: PlanRevisionRef;
  initialProposalRef: PlanProposalRef;
  initialProposalRevision: number;
  currentGoal(): Promise<GoalSnapshot>;
  taskRow(taskId: string, onPlan?: PlanRevisionRef): Promise<TaskRow>;
  readRun(ref: RunRef): Promise<RunSnapshot>;
  /** BLOCKED (missing entry point): stored record bytes, kept from w2-base for
   * C's Reduction only; no public read returns a TaskReduction. */
  readJsons(refs: readonly object[]): Promise<Record<string, string>>;
  /** The public execution read: the exact Run and its current Lease. */
  execution(ref: RunRef): Promise<{ run: RunSnapshot; lease: TaskLeaseSnapshot | null }>;
  /** A real held Run: claimed, prepared and entered; the model request waits at
   * the helper's gate until the fixture closes or the Run is finished. */
  startHeld(taskId: string, onPlan?: PlanRevisionRef): Promise<{ claim: TaskClaim; run: RunSnapshot; handle: S2BRunHandle }>;
  /** A real ended Run (normal final reply, Runtime terminal fact). */
  endRun(taskId: string, onPlan?: PlanRevisionRef): Promise<RunSnapshot>;
  /** A real ended Run plus the real verification chain and C's formal reduction. */
  satisfy(taskId: string, onPlan?: PlanRevisionRef): Promise<{ run: RunSnapshot; reduction: TaskReductionSnapshot }>;
  /** The Plan a later proposal+apply produces from the accepted source. */
  adopt(draft: PlanRevisionDraft, requestId: string): Promise<PlanRevisionSnapshot>;
  /** A delegating records wrapper that counts commits and returns the real result. */
  countCommits(tag: string): { plans: ReturnType<typeof createPlanService>; commits: () => number };
  proposeChange(draft: PlanRevisionDraft, requestId: string): Promise<WriteResult<PlanProposal>>;
  applyChange(proposalRef: PlanProposal['ref'], revision: number, requestId: string,
    decisionRefs?: VersionedRef[]): Promise<WriteResult<PlanRevisionSnapshot>>;
  close(): Promise<void>;
};

async function setup(sourceDraft: PlanDraftV2 = initialDraft()): Promise<W1Fixture> {
  const b2 = await createB2ExecutionFixture('memory', W1_SCHEMAS);
  if (b2.base.scope.projectId !== projectId || b2.base.scope.workspaceId !== workspaceId) {
    throw new Error(`W1 fixture scope changed: ${JSON.stringify(b2.base.scope)}`);
  }
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'next-w1-future-plan-'));
  await mkdir(join(workspaceRoot, 'src'));
  await writeFile(join(workspaceRoot, 'src', 'w1.txt'), 'w1 verification source v1\n');
  const records = b2.base.records;
  const plans = b2.base.plans;
  const goals = b2.base.goals;
  const executions = createRunStateReader({ records });
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId: 'goal-1' };
  let sequence = 0;
  let clock = AT;
  const now = (): string => clock;
  const eventId = (): string => `w1-event-${++sequence}`;
  const newId = (): string => `w1-id-${++sequence}`;
  const requestId = (label: string): string => `w1-${label}-${++sequence}`;

  try {
    const steps = await createS2BRuntimeSteps({
      base: b2.base, bodies: b2.bodies, ctx, directory: b2.base.directory, scope: b2.base.scope,
      now, setClock: (at) => { clock = at; }, eventId, newId, consumerId: 'w1-future-plan-runtime',
    });
    // The plan's required requirement kind is `static`; install and activate the
    // matching policy through the public bootstrap before the first adoption so
    // the compiled round carries a real registered check.
    await steps.installStaticCompletionPolicy('w1-static-policy');

    const created = await goals.createGoal(ctx, { meta: { requestId: 'w1-create-goal',
      expected: [{ ref: b2.base.projectRef, revision: 1 }, { ref: b2.base.workspaceRef, revision: 1 }] },
      input: { goalId: goalRef.goalId, workspace: { projectId, workspaceId }, objective: 'W1 future whiteboard' } });
    if (created.status !== 'committed') throw new Error(`W1 fixture Goal creation failed: ${JSON.stringify(created)}`);
    const proposed = await plans.proposePlan(ctx, { meta: { requestId: 'w1-initial-propose', expected: [] },
      input: { goalRef, basedOn: null, draft: sourceDraft, reason: { text: 'Initial W1 plan', sources: [] } } });
    if (proposed.status !== 'committed') throw new Error(`W1 fixture initial proposal failed: ${JSON.stringify(proposed)}`);
    const adopted = await plans.applyPlanChange(ctx, { meta: { requestId: 'w1-initial-apply', expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    if (adopted.status !== 'committed') throw new Error(`W1 fixture initial adoption failed: ${JSON.stringify(adopted)}`);
    const plan = adopted.value;

    async function currentGoal(): Promise<GoalSnapshot> {
      const read = await plans.queryGoal(ctx, goalRef);
      if (read.status !== 'ready') throw new Error(`W1 fixture Goal read failed: ${JSON.stringify(read)}`);
      return read.value.goal;
    }
    async function taskRow(taskId: string, onPlan?: PlanRevisionRef) {
      const graph = await plans.queryTaskGraph(ctx, { goalRef, ...(onPlan === undefined ? {} : { planRef: onPlan }) });
      if (graph.status !== 'ready') throw new Error(`W1 fixture task graph read failed: ${JSON.stringify(graph)}`);
      const row = graph.value.tasks.find(task => task.ref.taskId === taskId);
      if (row === undefined) throw new Error(`W1 fixture task ${taskId} is not in the graph`);
      return row;
    }
    async function execution(ref: RunRef): Promise<{ run: RunSnapshot; lease: TaskLeaseSnapshot | null }> {
      const read = await executions.readExecution(ctx, ref);
      if (read.status !== 'ready') throw new Error(`W1 fixture execution read failed: ${JSON.stringify(read)}`);
      return { run: read.value.run, lease: read.value.lease };
    }
    async function readRun(ref: RunRef): Promise<RunSnapshot> {
      return (await execution(ref)).run;
    }
    async function readJsons(refs: readonly object[]): Promise<Record<string, string>> {
      const keys = refs.map(ref => canonicalJson(ref as unknown as JsonValue));
      const read = await records.readMany(keys);
      if (read.status !== 'ready') throw new Error(`W1 fixture read failed: ${JSON.stringify(read)}`);
      const out: Record<string, string> = {};
      for (const record of read.value.records) out[record.refKey] = record.json;
      return out;
    }

    async function claim(taskId: string, onPlan: PlanRevisionRef): Promise<TaskClaim> {
      const session = await b2.base.createSession(`w1-session-${taskId}-${++sequence}`);
      const goal = await currentGoal();
      const card = await b2.base.sessionsPort.readSession(ctx, session);
      if (card.status !== 'ready') throw new Error(`W1 fixture Session read failed: ${JSON.stringify(card)}`);
      const request: GraphWrite<ClaimTaskInput> = { input: {
        goalRef, planRef: onPlan, taskId, sessionRef: session,
        roleBinding: b2.base.roleBinding, budget: b2.base.budget },
      meta: { requestId: requestId(`claim-${taskId}`), expected: [
        { ref: goalRef, revision: goal.revision },
        { ref: b2.base.workspaceRef, revision: 1 },
        { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision },
      ] } };
      const claimed = await b2.base.service.claimTask(ctx, request);
      if (claimed.status !== 'committed') throw new Error(`W1 fixture claim failed: ${JSON.stringify(claimed)}`);
      return claimed.value;
    }

    async function startHeld(taskId: string, onPlan: PlanRevisionRef = plan.ref) {
      const claimed = await claim(taskId, onPlan);
      const handle = await steps.start(claimed, { at: AT,
        replies: [{ kind: 'text', text: `W1 ${taskId} is held at the real gate` }] });
      await handle.entered;
      return { claim: claimed, run: await readRun(claimed.runRef), handle };
    }

    async function endRun(taskId: string, onPlan: PlanRevisionRef = plan.ref): Promise<RunSnapshot> {
      const claimed = await claim(taskId, onPlan);
      const handle = await steps.start(claimed, { at: AT,
        replies: [{ kind: 'text', text: `W1 ${taskId} finished` }] });
      await steps.finish(handle, AT, 'completed');
      return readRun(claimed.runRef);
    }

    const configuration: TrustedCheckConfiguration = {
      configurationRevision: 'w1-checks-1', workspace: b2.base.workspaceRef, executor: actor,
      permissionRevision: 'w1-permission-1', sourceAccess: 'verification_workspace',
      processAccess: 'all_except_denied', deniedPrefixes: [],
      checks: [{ checkId: 'w1-static-check', kind: 'static', command: 'echo W1_CHECKS_OK',
        cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
    };
    const workspaceHost = {
      async resolveRoot(requested: { projectId: string; workspaceId: string }) {
        return requested.projectId === projectId && requested.workspaceId === workspaceId
          ? { status: 'ready' as const, value: { root: workspaceRoot, workspaceRevision: 1 } }
          : { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the W1 fixture workspace is not registered' };
      },
      async authorize(authCtx: CoreCallContext, requested: { projectId: string; workspaceId: string }) {
        return authCtx.principal.kind === 'host' && requested.projectId === projectId && requested.workspaceId === workspaceId
          ? { status: 'ready' as const, value: { subjectKey: 'host:w1', permissionRevision: 'w1-permission-1',
            allowsRead: () => true } }
          : { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the W1 Host does not authorize verification source' };
      },
    };
    const materials = createMaterialService({ bodies: b2.bodies,
      authority: createMaterialRecordReaders(records).authority, now });
    const evidence = createEvidenceService({ records, materials, executions, workspaceHost,
      source: new VerificationWorkspaceReader(), configuration, now, newId });
    const runner = createRegisteredCheckRunner({ evidence, workspaceHost, kernel, now });

    async function satisfy(taskId: string, onPlan: PlanRevisionRef = plan.ref): Promise<{ run: RunSnapshot; reduction: TaskReductionSnapshot }> {
      const run = await endRun(taskId, onPlan);
      const opened = await evidence.openVerification(ctx, {
        input: { subjectRunRef: run.ref, subject: { projectId, goalId: goalRef.goalId, taskId }, planRef: onPlan },
        meta: { requestId: requestId(`open-${taskId}`), expected: [] },
      });
      if (opened.status !== 'committed') throw new Error(`W1 round open failed: ${JSON.stringify(opened)}`);
      let round = opened.value;
      for (const check of round.checks) {
        const started = await runner.runRegisteredCheck(ctx, {
          input: { roundRef: round.ref, checkId: check.checkId },
          meta: { requestId: requestId(`run-${taskId}-${check.checkId}`), expected: [{ ref: round.ref, revision: round.revision }] },
        });
        if (started.status !== 'ready') throw new Error(`W1 registered check ${check.checkId} did not run: ${JSON.stringify(started)}`);
        round = started.value;
      }
      const finalized = await evidence.finalizeChecks(ctx, {
        input: { roundRef: round.ref },
        meta: { requestId: requestId(`finalize-${taskId}`), expected: [{ ref: round.ref, revision: round.revision }] },
      });
      if (finalized.status !== 'committed') throw new Error(`W1 finalize failed: ${JSON.stringify(finalized)}`);
      const goal = await currentGoal();
      const done = await goals.completeTask(ctx, {
        input: { taskRef: { projectId, goalId: goalRef.goalId, taskId }, planRef: onPlan,
          roundRef: finalized.value.snapshot.ref },
        meta: { requestId: requestId(`complete-${taskId}`), expected: [
          { ref: goalRef, revision: goal.revision },
          { ref: { aggregateType: 'TaskReduction', projectId, goalId: goalRef.goalId, taskId }, revision: 0 },
        ] },
      });
      if (done.status !== 'committed') throw new Error(`W1 completeTask failed: ${JSON.stringify(done)}`);
      return { run, reduction: done.value };
    }

    function proposeChange(draft: PlanRevisionDraft, request: string): Promise<WriteResult<PlanProposal>> {
      return plans.proposePlan(ctx, { meta: { requestId: request, expected: [] },
        input: { goalRef, basedOn: plan.ref, draft, reason: { text: 'W1 future-only change', sources: [] } } });
    }
    function applyChange(proposalRef: PlanProposal['ref'], revision: number, request: string,
      decisionRefs: VersionedRef[] = []): Promise<WriteResult<PlanRevisionSnapshot>> {
      return plans.applyPlanChange(ctx, { meta: { requestId: request, expected: [] },
        input: { proposalRef: proposalRef as PlanProposal['ref'], expectedProposalRevision: revision, decisionRefs } });
    }
    async function adopt(draft: PlanRevisionDraft, requestIdPrefix: string): Promise<PlanRevisionSnapshot> {
      const candidate = await proposeChange(draft, `${requestIdPrefix}-propose`);
      if (candidate.status !== 'committed') throw new Error(`W1 later proposal failed: ${JSON.stringify(candidate)}`);
      const applied = await applyChange(candidate.value.ref, candidate.value.revision, `${requestIdPrefix}-apply`);
      if (applied.status !== 'committed') throw new Error(`W1 later adoption failed: ${JSON.stringify(applied)}`);
      return applied.value;
    }
    function countCommits(tag: string): { plans: ReturnType<typeof createPlanService>; commits: () => number } {
      let commits = 0;
      const counted: Records = { ...records, async commit(prepared) {
        commits += 1;
        return records.commit(prepared);
      } };
      return { plans: planServiceOver(counted, tag), commits: () => commits };
    }

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await steps.close();
      await b2.close();
      await rm(workspaceRoot, { recursive: true, force: true });
    };
    cleanups.push(close);
    return {
      b2, ctx, records, plans, goals, executions, steps, evidence, runner,
      projectRef: b2.base.projectRef, workspaceRef: b2.base.workspaceRef,
      goalRef, plan, planRef: plan.ref,
      initialProposalRef: proposed.value.ref, initialProposalRevision: proposed.value.revision,
      currentGoal, taskRow, readRun, readJsons, execution, startHeld, endRun, satisfy, adopt, countCommits,
      proposeChange, applyChange, close,
    };
  } catch (error) {
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
    await b2.close().catch(() => undefined);
    throw error;
  }
}

function planServiceOver(records: Records, tag: string): ReturnType<typeof createPlanService> {
  let n = 0;
  return createPlanService({ records, now: () => AT, eventId: () => `w1-${tag}-${++n}` });
}

/** Soft-assert an adoption happened and return the snapshot for follow-ups.
 * A soft assertion lets every target invariant of a test run while the Stage 1
 * unsupported gap keeps the adoption red. */
function adoptedSnapshot(result: WriteResult<PlanRevisionSnapshot>): PlanRevisionSnapshot | null {
  expect.soft(result).toMatchObject({ status: 'committed' });
  return result.status === 'committed' ? result.value : null;
}

it('scenario 1/2: future-only B edit + prompt edge keep A running and C satisfied after real adoption', async () => {
  const f = await setup();
  // A is a real claimed, prepared and entered Run held at the Runtime gate.
  const runA = (await f.startHeld('A')).run;
  // C is a real claimed and ended Run; the formal reduction comes from the
  // registered check, the finalize and completeTask over that real Evidence.
  const { run: runC, reduction: reductionC } = await f.satisfy('C');
  const aBefore = await f.execution(runA.ref);
  const cBefore = await f.taskRow('C');
  // BLOCKED (missing entry point): C's Reduction has no public read; w2-base bytes.
  const before = await f.readJsons([reductionC.ref]);
  expect(cBefore).toMatchObject({ effectivePhase: 'satisfied', execution: runC.ref });

  const proposed = await f.proposeChange(editBDraft(), 'w1-s1-propose');
  expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed', value: { kind: 'candidate_v2', issues: [] } });
  if (proposed.status !== 'committed') throw new Error('W1 scenario 1 candidate failed to persist');

  // A public, unrelated ledger append after the apply's reads and immediately
  // before its adoption commit (the delegating wrapper returns the real result).
  let injected = false;
  let injectedGoal: WriteResult<GoalSnapshot> | null = null;
  const wrapped: Records = { ...f.records, async commit(prepared) {
    if (!injected && prepared.identityKey.startsWith('plan-apply:')) {
      injected = true;
      injectedGoal = await f.goals.createGoal(ctx, { meta: { requestId: 'w1-s1-unrelated-goal', expected: [
        { ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 }] },
        input: { goalId: 'w1-unrelated-goal', workspace: { projectId, workspaceId },
          objective: 'Unrelated public ledger append' } });
    }
    return f.records.commit(prepared);
  } };
  const wrappedPlans = planServiceOver(wrapped, 's1');
  const applied = await wrappedPlans.applyPlanChange(ctx, { meta: { requestId: 'w1-s1-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  expect(injected).toBe(true);
  expect(injectedGoal).toMatchObject({ status: 'committed' });

  // A's latest facts are read from the current accepted Plan; C stays satisfied.
  const graph = await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef });
  expect(graph, JSON.stringify(graph)).toMatchObject({ status: 'ready' });
  if (graph.status === 'ready') {
    expect(graph.value.tasks.find(task => task.ref.taskId === 'A')).toMatchObject({ effectivePhase: 'running', execution: runA.ref });
    expect(graph.value.tasks.find(task => task.ref.taskId === 'C')).toMatchObject({ effectivePhase: 'satisfied' });
  }
  const ready = await f.plans.queryReadyTasks(ctx, { goalRef: f.goalRef, includeBlocked: false, page: { limit: 20 } });
  expect(ready).toMatchObject({ status: 'ready' });
  if (ready.status === 'ready') expect(ready.value.items.map(item => item.task.ref.taskId)).not.toContain('A');

  const snapshot = adoptedSnapshot(applied);
  if (snapshot !== null) {
    expect(graph.status === 'ready' ? graph.value.plan.ref : null).toEqual(snapshot.ref);
    expect.soft(snapshot.planRevision).toBe(2);
    expect.soft(snapshot.tasks.find(task => task.taskId === 'B')?.title).toBe('Task B v2');
    expect.soft(snapshot.tasks.find(task => task.taskId === 'A')).toEqual(f.plan.tasks.find(task => task.taskId === 'A'));
    expect.soft(snapshot.tasks.find(task => task.taskId === 'C')).toEqual(f.plan.tasks.find(task => task.taskId === 'C'));
    expect.soft(snapshot.schemaVersion === 2 ? snapshot.taskRelations : [])
      .toContainEqual(expect.objectContaining({ fromTaskId: 'A', toTaskId: 'B' }));
    expect.soft(snapshot.schemaVersion === 2 ? snapshot.taskStateBasis : undefined)
      .toMatchObject({ schemaVersion: 1, entries: expect.arrayContaining([
        { taskId: 'A', planRef: f.planRef }, { taskId: 'B', planRef: snapshot.ref },
        { taskId: 'C', planRef: f.planRef }, { taskId: 'gate-goal', planRef: f.planRef }]) });
  }
  // Zero writes to the Run and its Lease, read publicly; C's projected row is unchanged.
  expect(await f.execution(runA.ref)).toEqual(aBefore);
  expect(await f.taskRow('C')).toEqual(cBefore);
  // BLOCKED (missing entry point): C's Reduction record bytes, as in w2-base.
  expect(await f.readJsons([reductionC.ref])).toEqual(before);

  // A pure advisory edge to the running A must adopt and must NOT reset any
  // task's basis (independent fixture so the source is still the active one).
  const g = await setup();
  const runGA = (await g.startHeld('A')).run;
  const gBefore = await g.execution(runGA.ref);
  const gProposed = await g.proposeChange(pureEdgeDraft(), 'w1-s1-edge-propose');
  expect(gProposed).toMatchObject({ status: 'committed' });
  if (gProposed.status !== 'committed') throw new Error('W1 pure-edge candidate failed to persist');
  const gSnapshot = adoptedSnapshot(await g.applyChange(gProposed.value.ref, gProposed.value.revision, 'w1-s1-edge-apply'));
  if (gSnapshot !== null) {
    expect.soft(gSnapshot.schemaVersion === 2 ? gSnapshot.taskStateBasis : undefined).toMatchObject({ schemaVersion: 1,
      entries: expect.arrayContaining(gSnapshot.tasks.map(task => ({ taskId: task.taskId, planRef: g.planRef }))) });
    expect.soft(gSnapshot.tasks.find(task => task.taskId === 'A')).toEqual(g.plan.tasks.find(task => task.taskId === 'A'));
  }
  // The pre-existing A Run is untouched by either attempt.
  expect(await g.execution(runGA.ref)).toEqual(gBefore);
});

it('scenario 4: a stale proposal revision or an inactive source is rejected with zero writes', async () => {
  const f = await setup();
  const proposed = await f.proposeChange(editBDraft(), 'w1-s4-propose');
  expect(proposed).toMatchObject({ status: 'committed' });
  if (proposed.status !== 'committed') throw new Error('W1 scenario 4 candidate failed to persist');
  const wrongRevision = f.countCommits('s4-rev');
  expect(await wrongRevision.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-s4-rev', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision + 1, decisionRefs: [] } }))
    .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(wrongRevision.commits()).toBe(0);

  // A later accepted Plan moves the active pointer; the old basedOn is stale.
  const later = await f.adopt({ ...editBDraft(), planId: 'w1-plan-later' }, 'w1-s4-later');
  const stale = await f.proposeChange(editBDraft(), 'w1-s4-stale');
  expect(stale).toMatchObject({ status: 'committed' });
  if (stale.status !== 'committed') throw new Error('W1 scenario 4 stale candidate failed to persist');
  const counted = f.countCommits('s4');
  const applied = await counted.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-s4-apply', expected: [] },
    input: { proposalRef: stale.value.ref, expectedProposalRevision: stale.value.revision, decisionRefs: [] } });
  // The failure MUST be the stale-source conflict; the stale candidate is never
  // auto-rebased and adopted.
  expect.soft(applied).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(counted.commits()).toBe(0);
  const goal = await f.currentGoal();
  expect(goal.activePlanRevision).toEqual(later.ref);
  // Zero write through public reads: the candidate stays a candidate and no
  // target Plan revision exists.
  expect(await f.plans.readPlanProposal(ctx, stale.value.ref))
    .toMatchObject({ status: 'ready', value: { status: 'candidate', revision: stale.value.revision } });
  expect(await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef,
    planRef: { aggregateType: 'PlanRevision', projectId, planId: 'w1-plan-2' } })).toMatchObject({ status: 'not_found' });
});

it('scenario 5: same-identity replay returns the original adoption, including a lookup-miss peer window', async () => {
  const f = await setup();
  // Existing initial-adoption replay is preserved and green.
  const initialReplay = await f.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-initial-apply', expected: [] },
    input: { proposalRef: f.initialProposalRef, expectedProposalRevision: f.initialProposalRevision, decisionRefs: [] } });
  expect.soft(initialReplay).toMatchObject({ status: 'committed', replayed: true, value: f.plan });

  const proposed = await f.proposeChange(editBDraft(), 'w1-s5-propose');
  expect(proposed).toMatchObject({ status: 'committed' });
  if (proposed.status !== 'committed') throw new Error('W1 scenario 5 candidate failed to persist');
  const first = await f.applyChange(proposed.value.ref, proposed.value.revision, 'w1-s5-apply');
  const snapshot = adoptedSnapshot(first);
  const replay = await f.applyChange(proposed.value.ref, proposed.value.revision, 'w1-s5-apply');
  expect.soft(replay).toMatchObject({ status: 'committed', replayed: true });
  if (snapshot !== null) expect.soft(replay).toMatchObject({ value: snapshot });
  const conflict = await f.applyChange(proposed.value.ref, proposed.value.revision, 'w1-s5-apply',
    [{ ref: f.goalRef, revision: 1 }]);
  expect.soft(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });

  // Controlled window: the original apply's idempotency lookup misses, a peer
  // with the SAME identity commits, then the original call must re-query the
  // exact receipt and restore that commit (not re-read the current Plan).
  const g = await setup();
  const candidate = await g.proposeChange(editBDraft(), 'w1-s5-window');
  expect(candidate).toMatchObject({ status: 'committed' });
  if (candidate.status !== 'committed') throw new Error('W1 scenario 5 window candidate failed to persist');
  const peer: { result: WriteResult<PlanRevisionSnapshot> | null } = { result: null };
  let windowEntered = false;
  const wrappedG: Records = { ...g.records, async lookupCommit(input) {
    const result = await g.records.lookupCommit(input);
    if (!windowEntered && result.status === 'rejected' && result.code === 'not_found'
      && input.identityKey.startsWith('plan-apply:')) {
      windowEntered = true;
      peer.result = await g.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-s5-window-apply', expected: [] },
        input: { proposalRef: candidate.value.ref, expectedProposalRevision: candidate.value.revision, decisionRefs: [] } });
    }
    return result;
  } };
  const original = await planServiceOver(wrappedG, 's5').applyPlanChange(ctx,
    { meta: { requestId: 'w1-s5-window-apply', expected: [] },
      input: { proposalRef: candidate.value.ref, expectedProposalRevision: candidate.value.revision, decisionRefs: [] } });
  expect(windowEntered).toBe(true);
  expect.soft(peer.result).toMatchObject({ status: 'committed' });
  expect.soft(original).toMatchObject({ status: 'committed', replayed: true });
  if (peer.result !== null && peer.result.status === 'committed') {
    expect.soft(original).toMatchObject({ value: peer.result.value });
  }
});

it('scenario 7: authorized split adopts from the source; coverage/role weakening is zero-write rejected', async () => {
  const split = await setup();
  await split.startHeld('A');
  const candidate = await split.proposeChange(splitBDraft(), 'w1-s7-split');
  expect(candidate).toMatchObject({ status: 'committed' });
  if (candidate.status !== 'committed') throw new Error('W1 scenario 7 split candidate failed to persist');
  const snapshot = adoptedSnapshot(await split.applyChange(candidate.value.ref, candidate.value.revision, 'w1-s7-split-apply'));
  if (snapshot !== null) {
    // The adopted source is the NEW split Plan, never the old P1.
    const goal = await split.currentGoal();
    expect.soft(goal.activePlanRevision).toEqual(snapshot.ref);
    expect.soft(snapshot.tasks.find(task => task.taskId === 'B')?.disposition).toBe('superseded');
    expect.soft(snapshot.tasks.find(task => task.taskId === 'B')?.replacedByTaskId).toBe('B1');
    expect.soft(snapshot.obligations).toContainEqual(expect.objectContaining({ obligationId: 'o-core',
      taskIds: expect.arrayContaining(['A', 'B1', 'B2', 'C', 'gate-goal']) }));
    expect.soft(snapshot.obligations).toContainEqual(expect.objectContaining({ obligationId: 'o-solo',
      taskIds: ['B1'] }));
  }

  // Each weakening candidate is based on its OWN fresh active source that
  // already carries the required B-only obligation, so it genuinely exercises
  // the coverage/authorization rule rather than being stale or unsupported-input.
  for (const [label, makeDraft, planId] of [
    ['cancel sole required carrier', cancelSoleCarrierDraft, 'w1-plan-cancel'],
    ['optional replacement', optionalReplacementDraft, 'w1-plan-optional'],
    ['rewritten verification body', changedVerificationDraft, 'w1-plan-verify'],
    ['new role/authorization', roleEscalationDraft, 'w1-plan-role'],
    ['new Task with fabricated blocked phase', blockedNewTaskDraft, 'w1-plan-blocked-new'],
    ['changed review-admission protocol', changedReviewProtocolDraft, 'w1-plan-review-protocol'],
  ] as const) {
    const f = await setup();
    const weakening = await f.proposeChange(makeDraft(), `w1-s7-${planId}`);
    expect(weakening, label).toMatchObject({ status: 'committed' });
    if (weakening.status !== 'committed') throw new Error(`W1 scenario 7 ${label} candidate failed to persist`);
    const counted = f.countCommits(`s7-${planId}`);
    const rejected = await counted.plans.applyPlanChange(ctx, { meta: { requestId: `w1-s7-${planId}-apply`, expected: [] },
      input: { proposalRef: weakening.value.ref, expectedProposalRevision: weakening.value.revision, decisionRefs: [] } });
    expect(rejected, label).toMatchObject({ status: 'rejected' });
    // A stale-source rejection is NOT an acceptable way to pass this case.
    expect(rejected.status === 'rejected' ? rejected.code : 'committed', label).not.toBe('revision_conflict');
    // Zero write: no commit at all; the source active pointer is unchanged and
    // no target Plan revision exists (all through public reads).
    expect(counted.commits(), label).toBe(0);
    expect((await f.currentGoal()).activePlanRevision, label).toEqual(f.planRef);
    expect(await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef,
      planRef: { aggregateType: 'PlanRevision', projectId, planId } }), label).toMatchObject({ status: 'not_found' });
    expect(await f.plans.readPlanProposal(ctx, weakening.value.ref), label)
      .toMatchObject({ status: 'ready', value: { status: 'candidate', revision: weakening.value.revision } });
  }

  // An existing role somewhere in the source does not authorize reassigning B.
  // Both roles are already admitted; the ONLY delta here is B's role.
  const twoRoles = initialDraft();
  twoRoles.assignments = twoRoles.assignments!.map(assignment => assignment.taskId === 'A'
    ? { ...assignment, role: 'reviewer' } : assignment);
  const reassignment = await setup(twoRoles);
  const roleDraft: PlanDraftV2 = { ...twoRoles, planId: 'w1-existing-role-reassignment', planRevision: 2,
    assignments: twoRoles.assignments.map(assignment => assignment.taskId === 'B'
      ? { ...assignment, role: 'reviewer' } : assignment) };
  const roleCandidate = await reassignment.proposeChange(roleDraft, 'w1-s7-existing-role');
  expect(roleCandidate).toMatchObject({ status: 'committed', value: { issues: [] } });
  if (roleCandidate.status !== 'committed') throw new Error('existing-role candidate failed to persist');
  const roleCounted = reassignment.countCommits('s7-role');
  const roleResult = await roleCounted.plans.applyPlanChange(ctx,
    { meta: { requestId: 'w1-s7-existing-role-apply', expected: [] },
      input: { proposalRef: roleCandidate.value.ref, expectedProposalRevision: roleCandidate.value.revision, decisionRefs: [] } });
  expect.soft(roleResult).toMatchObject({ status: 'rejected' });
  expect.soft(roleResult.status === 'rejected' ? roleResult.code : 'committed').not.toBe('revision_conflict');
  expect.soft(roleCounted.commits()).toBe(0);
  expect.soft((await reassignment.currentGoal()).activePlanRevision).toEqual(reassignment.planRef);
  expect.soft(await reassignment.plans.queryTaskGraph(ctx, { goalRef: reassignment.goalRef,
    planRef: { aggregateType: 'PlanRevision', projectId, planId: roleDraft.planId } }))
    .toMatchObject({ status: 'not_found' });
});

it('scenario 8: codec rejects broken shapes', async () => {
  const f = await setup();
  const callerBasis = { ...editBDraft(), taskStateBasis: { schemaVersion: 1,
    entries: [{ taskId: 'A', planRef: f.planRef }] } } as unknown as PlanRevisionDraft;
  expect(await f.proposeChange(callerBasis, 'w1-s8-caller')).toMatchObject({ status: 'rejected', code: 'invalid' });
  const unknownVersion = { ...editBDraft(), schemaVersion: 3 } as unknown as PlanRevisionDraft;
  expect(await f.proposeChange(unknownVersion, 'w1-s8-version')).toMatchObject({ status: 'rejected', code: 'invalid' });
  const base = f.plan;
  const recordFor = (taskStateBasis: unknown): EncodedRecord => ({
    refKey: canonicalJson(base.ref as unknown as JsonValue), schemaId: 'PlanRevisionSnapshot@1', revision: 1,
    json: JSON.stringify({ ...base, taskStateBasis }),
  });
  expect(decodePlanRevisionSnapshot(recordFor({ schemaVersion: 1, entries: [{ taskId: 'A', planRef: base.ref }] })))
    .toMatchObject({ status: 'invalid' });
  expect(decodePlanRevisionSnapshot(recordFor({ schemaVersion: 2, entries: [] }))).toMatchObject({ status: 'invalid' });
  expect(decodePlanRevisionSnapshot(recordFor({ schemaVersion: 1, entries: [
    { taskId: 'A', planRef: base.ref }, { taskId: 'A', planRef: base.ref }] }))).toMatchObject({ status: 'invalid' });
  expect(decodePlanRevisionSnapshot(recordFor({ schemaVersion: 1, entries: [
    { taskId: 'A', planRef: { ...base.ref, projectId: 'another-project' } }] }))).toMatchObject({ status: 'invalid' });
});

it('scenario 9: a changed Task with a Run is no longer future (zero writes)', async () => {
  const f = await setup();
  // B is a real, ended Run of the accepted source Plan; changing its execution
  // definition must be refused by the A6 untraced rule and write nothing.
  const runB = await f.endRun('B');
  const proposed = await f.proposeChange(editBDraft(), 'w1-s9-changed-run');
  expect(proposed).toMatchObject({ status: 'committed', value: { status: 'candidate', issues: [] } });
  if (proposed.status !== 'committed') throw new Error('W1 scenario 9 candidate failed to persist');
  const counted = f.countCommits('s9');
  const applied = await counted.plans.applyPlanChange(ctx, { meta: { requestId: 'w1-s9-changed-run-apply', expected: [] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  expect(applied).toEqual({ status: 'rejected', code: 'revision_conflict',
    reason: 'task B already has a Run and is no longer a future task' });
  // Zero write through the commit counter and public reads: the active pointer,
  // the candidate, the absent target and B's real Run are unchanged.
  expect(counted.commits()).toBe(0);
  expect((await f.currentGoal()).activePlanRevision).toEqual(f.planRef);
  expect(await f.plans.readPlanProposal(ctx, proposed.value.ref))
    .toMatchObject({ status: 'ready', value: { status: 'candidate', revision: proposed.value.revision } });
  expect(await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef,
    planRef: { aggregateType: 'PlanRevision', projectId, planId: 'w1-plan-2' } })).toMatchObject({ status: 'not_found' });
  const after = await f.execution(runB.ref);
  expect(after.run).toEqual(runB);
  expect(after.run.status).toBe('ended');
});

it('scenario 6 (memory): explicit old Plan excludes later Run + global Lease; active reads stay authoritative', async () => {
  const f = await setup();
  const plan1 = f.plan;
  const plan2 = await f.adopt(editBDraft(), 'w1-s6-later');
  // A real claimed, prepared and entered B Run on the later Plan; the claim
  // also holds the one global TaskLease.
  const runB2 = (await f.startHeld('B', plan2.ref)).run;

  const oldGraph = await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef, planRef: plan1.ref });
  expect(oldGraph, JSON.stringify(oldGraph)).toMatchObject({ status: 'ready' });
  if (oldGraph.status === 'ready') {
    expect(oldGraph.value.plan.ref).toEqual(plan1.ref);
    const oldB = oldGraph.value.tasks.find(task => task.ref.taskId === 'B');
    expect.soft(oldB?.execution).toBeNull();
    // The later Run's GLOBAL TaskLease must not leak as plan1's runId/leased
    // reason: a historical projection is not a current claim permission.
    expect.soft(oldB).toMatchObject({ eligibility: { eligible: true, reasons: [] } });
  }
  const activeGraph = await f.plans.queryTaskGraph(ctx, { goalRef: f.goalRef });
  expect(activeGraph).toMatchObject({ status: 'ready' });
  if (activeGraph.status === 'ready') {
    expect(activeGraph.value.plan.ref).toEqual(plan2.ref);
    expect(activeGraph.value.tasks.find(task => task.ref.taskId === 'B')).toMatchObject({
      effectivePhase: 'running', execution: runB2.ref, eligibility: { eligible: false } });
  }
  // ready still consults the ACTIVE plan: the running B is never a candidate.
  const ready = await f.plans.queryReadyTasks(ctx, { goalRef: f.goalRef, includeBlocked: false, page: { limit: 20 } });
  expect(ready).toMatchObject({ status: 'ready' });
  if (ready.status === 'ready') expect(ready.value.items.map(item => item.task.ref.taskId)).not.toContain('B');

  // Old records WITHOUT the basis field stay readable (a current v2 record).
  expect((plan1 as SnapshotV2).taskStateBasis).toBeUndefined();
});
