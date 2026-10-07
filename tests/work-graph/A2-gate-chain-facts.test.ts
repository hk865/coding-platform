/**
 * A.2 step 5.9, part 2: a gate's own round chain in the read model (docs/refactor/STATE-MACHINES-SPEC.md
 * §4 P20, TASK-15, TASK-30, the gate rows of TD-8 `TaskRow.failure`, the GV table; §2 GOAL-27/GOAL-30 gate
 * reasons; §9 VD-14, VD-15) through the real plan service (`queryTaskGraph`, `queryGoalDisplay`) and the
 * real evidence and completion owners, on the R3e fixture (memory and SQLite).
 *
 * - `readCanonicalTaskFacts` reads the gate's chain (`VerificationRoundByTask`) in the same window: the gate
 *   projects from its head (P20, `detail.gate`, `ordinal`), not `pending`; its failure facts come from the
 *   head with the anchored producer Run, and the GV verdict decides: GV-3′ (open), GV-5 (required work in
 *   scope unsatisfied: `gate_fix_in_progress`), GV-9 (FAIL head: `reverify{onlyIfSourceChanged}`), GV-8
 *   (`source_unchanged` refusal: `stopped/gate_needs_fix`, the Goal NEEDS_DECISION), GV-4 (PASS head).
 * - TASK-15: the gate completes only from P20 `verifying(awaiting_completion)` with its chain head; the
 *   FAILed predecessor's evidence leaves the fold with the chain (VD-5).
 * - An invalid gate chain (two slot-less legacy roots) is P20 `blocked/round_ambiguous` and GV-2; with its work
 *   satisfied the Goal shows GOAL-30 `not_reworkable` only, never `awaiting_gate` (GOAL-27: no chain yet).
 * - GV-5 counts only required, active work in the gate's scope: a fix Task an operator adds (W16) and then
 *   cancels unsatisfied leaves the FAIL gate at GV-9 again, without `gate_fix_in_progress`.
 * - A row of the gate's chain lookup that names another subject refuses the whole read (`unavailable`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import type { CheckProcessObservation, RoundSnapshot } from '../../src/contracts/verification.js';
import type { EvidencePort, ReverifyOutcomeV1, ReverifyRoundInput } from '../../src/core/work-graph/model/evidence-contracts.js';
import { encodeVerificationRoundSnapshot } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { chainEvidenceIds } from '../../src/core/work-graph/state/verification-machine.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import {
  createR3eEvidenceFixture, R3E_GATE_TASK_ID, R3E_WORK_TASK_ID, type R3eEvidenceFixture,
} from '../helpers/R3e-evidence-fixture.js';

const KINDS = ['memory', 'sqlite'] as const;
const fixtures: R3eEvidenceFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

async function openFixture(kind: 'memory' | 'sqlite' = 'memory'): Promise<R3eEvidenceFixture> {
  const fixture = await createR3eEvidenceFixture(kind, COMPLETION_RECORD_SCHEMAS);
  fixtures.push(fixture);
  return fixture;
}

function executed(exitCode: number): CheckProcessObservation {
  const text = exitCode === 0 ? 'R3E_OK\n' : 'R3E_FAILED\n';
  return { kind: 'executed', startedAt: B2_AT, finishedAt: B2_AT, exitCode, signal: null, timedOut: false, cancelled: false,
    stdout: { text, totalBytes: Buffer.byteLength(text), truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { workspaceRevision: 'r3e-workspace-revision-1', changedPaths: [] }, sandboxProfileVersion: 'bwrap-m3-v4' };
}

/** An evidence owner over the fixture's ledger with the successor-round dependencies. */
function reverifier(fixture: R3eEvidenceFixture): EvidencePort {
  let sequence = 0;
  return createEvidenceService({ records: fixture.records, materials: fixture.materials,
    executions: createRunStateReader({ records: fixture.records }), workspaceHost: fixture.workspaceHost,
    source: new VerificationWorkspaceReader(),
    configurationFor: scope => scope.projectId === fixture.scope.projectId && scope.workspaceId === fixture.scope.workspaceId
      ? fixture.configuration : undefined,
    automationPolicy: () => ({ ...DEFAULT_TASK_AUTOMATION_POLICY }),
    now: () => B2_AT, newId: () => `a2-gate-facts-${++sequence}` });
}

const gateSubject = (fixture: R3eEvidenceFixture) => ({ ...fixture.subject, taskId: R3E_GATE_TASK_ID });

async function open(fixture: R3eEvidenceFixture, gate: boolean): Promise<RoundSnapshot> {
  const opened = await fixture.evidence.openVerification(fixture.ctx, gate
    ? fixture.openRequest({ subject: gateSubject(fixture), gateSubject: 'goal' }) : fixture.openRequest());
  if (opened.status !== 'committed') throw Error(`the round must open: ${JSON.stringify(opened)}`);
  return opened.value;
}

async function latest(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref']): Promise<RoundSnapshot> {
  const read = await fixture.evidence.readVerification(fixture.ctx, ref);
  if (read.status !== 'ready') throw Error('the round must be readable');
  return read.value;
}

/** Formal begin/record of every check with the given exit code, then the finalize. */
async function finish(fixture: R3eEvidenceFixture, ref: RoundSnapshot['ref'], exitCode: number): Promise<RoundSnapshot> {
  let round = await latest(fixture, ref);
  for (const check of round.checks) {
    const begin = await fixture.evidence.beginCheck(fixture.ctx, fixture.beginRequest(round, check.checkId));
    if (begin.status !== 'committed') throw Error(`begin ${check.checkId} must commit: ${JSON.stringify(begin)}`);
    round = await latest(fixture, ref);
    const recorded = await fixture.evidence.recordCheckResult(fixture.ctx,
      fixture.recordRequest(round, check.checkId, begin.value.invocationId, executed(exitCode)));
    if (recorded.status !== 'committed') throw Error(`record ${check.checkId} must commit`);
    round = recorded.value;
  }
  const finalized = await fixture.evidence.finalizeChecks(fixture.ctx, fixture.finalizeRequest(round));
  if (finalized.status !== 'committed') throw Error(`finalize must commit: ${JSON.stringify(finalized)}`);
  return finalized.value.snapshot;
}

function reverifyRequest(round: RoundSnapshot, requestId: string, extra: Omit<ReverifyRoundInput, 'predecessorRoundRef'> = {},
  refusalRevision?: number): GraphWrite<ReverifyRoundInput> {
  return { input: { predecessorRoundRef: round.ref, ...extra }, meta: { requestId, expected: [
    { ref: round.ref, revision: round.revision },
    ...(refusalRevision === undefined ? [] : [{ ref: { aggregateType: 'TaskReworkRefusal' as const, projectId: round.ref.projectId,
      goalId: round.ref.goalId, taskId: round.ref.taskId, operation: 'reverify' as const, subjectId: round.ref.roundId },
    revision: refusalRevision }]),
  ] } };
}

function reverified(result: WriteResult<ReverifyOutcomeV1>): RoundSnapshot {
  if (result.status !== 'committed' || result.value.kind !== 'reverified') throw Error(`a successor must commit: ${JSON.stringify(result)}`);
  return result.value.round;
}

async function row(fixture: R3eEvidenceFixture, taskId: string) {
  const graph = await fixture.b2.base.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef });
  if (graph.status !== 'ready') throw Error(`the task graph must be readable: ${JSON.stringify(graph)}`);
  const found = graph.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (found === undefined) throw Error(`task ${taskId} is not in the graph`);
  return found;
}

async function display(fixture: R3eEvidenceFixture) {
  const read = await fixture.b2.base.plans.queryGoalDisplay!(fixture.ctx, { goalRef: fixture.goalRef });
  if (read.status !== 'ready') throw Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}

async function complete(fixture: R3eEvidenceFixture, taskId: string, roundRef: RoundSnapshot['ref'], requestId: string) {
  const goal = await fixture.b2.base.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (goal.status !== 'ready') throw Error('the Goal must be readable');
  return fixture.b2.base.goals.completeTask(fixture.ctx, {
    input: { taskRef: { ...fixture.subject, taskId }, planRef: fixture.planRef, roundRef }, meta: { requestId, expected: [
      { ref: fixture.goalRef, revision: goal.value.goal.revision },
      { ref: { aggregateType: 'TaskReduction', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId, taskId },
        revision: 0 }] } });
}

function automationCtx(fixture: R3eEvidenceFixture): CoreCallContext {
  const actor = { ...WORKFLOW_AUTOMATION_ACTOR };
  return { projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId, actor },
    signal: new AbortController().signal };
}

describe.each(KINDS)('%s', (kind) => {
  it('P20, TASK-30, the gate failure facts and GV-3′/5/9/8/4 through queryTaskGraph and the Goal display; TASK-15 completes from the head', async () => {
    const fixture = await openFixture(kind);
    const owner = reverifier(fixture);
    // No chain: P16 and no failure facts.
    expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'pending' });
    expect(await row(fixture, R3E_GATE_TASK_ID)).not.toHaveProperty('failure');

    // TASK-30: the root opens on the producer; the gate is verifying from its own head (GV-3′: nothing to do).
    const g1 = await open(fixture, true);
    expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'verifying',
      phaseCause: { code: 'verification_running', detail: { gate: true, ordinal: 1 } },
      failure: { subjectKind: 'gate', runRef: fixture.subjectRunRef, failureClass: null, requeueActors: [],
        round: { roundRef: g1.ref, status: 'open', ordinal: 1 }, automation: { verdict: { kind: 'none' } } } });
    expect(await display(fixture)).toMatchObject({ causes: expect.arrayContaining([{ code: 'gate_verifying', gateTaskId: R3E_GATE_TASK_ID }]) });

    // FAIL: P20 failed; the required work in its scope is not satisfied yet, so GV-5 (gate_fix_in_progress).
    const g1Final = await finish(fixture, g1.ref, 1);
    expect(g1Final).toMatchObject({ outcome: 'FAIL' });
    // `roundFailureFacts` lists the failing checks by checkId.
    const failingChecks = [...g1Final.checks].sort((left, right) => (left.checkId < right.checkId ? -1 : 1))
      .map(check => ({ checkId: check.checkId, phase: 'finished', outcome: 'FAIL', cause: null, reportRef: check.reportRef }));
    expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'failed',
      phaseCause: { code: 'check_failed', detail: { gate: true, ordinal: 1 } },
      failure: { subjectKind: 'gate', runRef: fixture.subjectRunRef, failureClass: 'check_failed',
        run: { outcome: 'completed' }, round: { roundRef: g1Final.ref, revision: g1Final.revision, outcome: 'FAIL', failingChecks },
        reverifyActors: ['human', 'system', 'agent'], automation: { verdict: { kind: 'none' } } } });
    expect(await display(fixture)).toMatchObject({ causes: expect.arrayContaining([
      { code: 'gate_fix_in_progress', gateTaskId: R3E_GATE_TASK_ID, failingChecks }]) });

    // The work passes and completes; GV-9: a re-verification only if the source changed (pending automation).
    const work = await finish(fixture, (await open(fixture, false)).ref, 0);
    expect(await complete(fixture, R3E_WORK_TASK_ID, work.ref, 'a2-gate-facts-work')).toMatchObject({ status: 'committed' });
    expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ failure: { automation: { verdict: { kind: 'reverify',
      roundRef: g1Final.ref, needsFinalize: false, onlyIfSourceChanged: true, failureClass: 'check_failed', retryAfterRefusal: false } } } });
    expect(await display(fixture)).toMatchObject({ phase: 'RUNNING', causes: expect.arrayContaining([{ code: 'auto_rework_pending',
      taskId: R3E_GATE_TASK_ID, operation: 'reverify', failureClass: 'check_failed' }]) });

    // The automation's request with the gate-fix condition: nothing changed → source_unchanged → GV-8 gate_needs_fix.
    expect(await owner.reverifyRound!(automationCtx(fixture), reverifyRequest(g1Final, 'a2-gate-facts-auto',
      { onlyIfSourceChanged: true }))).toMatchObject({ status: 'committed', value: { kind: 'refused',
      refusal: { code: 'source_unchanged', requestedBy: WORKFLOW_AUTOMATION_ACTOR } } });
    expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ failure: { automation: {
      lastReverifyRefusal: { code: 'source_unchanged', revision: 1, stale: false },
      verdict: { kind: 'stopped', reason: 'gate_needs_fix', detail: { operation: 'reverify', failingChecks } } } } });
    expect(await display(fixture)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
      cause: { code: 'gate_needs_fix', taskId: R3E_GATE_TASK_ID, detail: { failingChecks } } });

    // The operator fixes the work and re-verifies ("重新验收"): the successor stays on the anchored producer.
    await writeFile(join(fixture.workspaceRoot, 'src', 'input.txt'), 'r3e verification source v2 (gate fixed)\n');
    const g2 = reverified(await owner.reverifyRound!(fixture.ctx, reverifyRequest(g1Final, 'a2-gate-facts-operator', {}, 1)));
    expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'verifying',
      phaseCause: { code: 'verification_running', detail: { gate: true, ordinal: 2, predecessorRoundRef: g1Final.ref } },
      failure: { runRef: fixture.subjectRunRef, round: { roundRef: g2.ref, ordinal: 2, autoCount: 0 } } });

    // GV-4: a PASS head awaits its completion; TASK-15 completes only with the head, excluding R1's evidence.
    const g2Final = await finish(fixture, g2.ref, 0);
    expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'verifying',
      phaseCause: { code: 'awaiting_completion', detail: { gate: true, ordinal: 2 } }, failure: { automation: { verdict: { kind: 'none' } } } });
    expect(await complete(fixture, R3E_GATE_TASK_ID, g1Final.ref, 'a2-gate-facts-old')).toMatchObject({ status: 'rejected',
      code: 'incomplete', reason: 'the specified round is not the head of the gate round chain' });
    const completed = await complete(fixture, R3E_GATE_TASK_ID, g2Final.ref, 'a2-gate-facts-gate');
    if (completed.status !== 'committed') throw Error(`the gate must complete from its head: ${JSON.stringify(completed)}`);
    for (const id of chainEvidenceIds(g1Final)) expect(completed.value.effectiveEvidenceIds).not.toContain(id);
    expect(completed.value.blockingEvidenceIds).toEqual([]);
    expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'satisfied' });
    expect(await row(fixture, R3E_GATE_TASK_ID)).not.toHaveProperty('failure');
  }, 120_000);
});

it('an invalid gate chain (two slot-less legacy roots) projects P20 blocked/round_ambiguous, reads GV-2 and is GOAL-30, never awaiting_gate', async () => {
  const fixture = await openFixture();
  const finalized = await finish(fixture, (await open(fixture, true)).ref, 1);
  // Two pre-A.2 gate roots: no chain and no slot.
  const legacy = (roundId: string): RoundSnapshot => {
    const root: RoundSnapshot = { ...finalized, ref: { ...finalized.ref, roundId } };
    delete root.chain;
    return root;
  };
  const otherFixture = await openFixture();
  // The work in the gate's scope is satisfied: without a chain the gate would be awaiting_gate.
  const otherWork = await finish(otherFixture, (await open(otherFixture, false)).ref, 0);
  expect(await complete(otherFixture, R3E_WORK_TASK_ID, otherWork.ref, 'a2-gate-legacy-work')).toMatchObject({ status: 'committed' });
  expect(await display(otherFixture)).toMatchObject({ phase: 'RUNNING', causes: [{ code: 'awaiting_gate', gateTaskId: R3E_GATE_TASK_ID }] });
  const roots = [legacy('a2-gate-legacy-1'), legacy('a2-gate-legacy-2')];
  // The gate of a fresh fixture only holds the two legacy roots.
  const moved = roots.map(root => ({ ...root, subject: gateSubject(otherFixture), subjectRunRef: { ...otherFixture.subjectRunRef },
    ref: { ...root.ref, projectId: otherFixture.scope.projectId, workspaceId: otherFixture.scope.workspaceId,
      goalId: otherFixture.goalRef.goalId, taskId: R3E_GATE_TASK_ID, runId: otherFixture.subjectRunRef.runId } }));
  expect(await otherFixture.b2.base.commitRaw(moved.map(encodeVerificationRoundSnapshot))).toMatchObject({ status: 'committed' });
  expect(await row(otherFixture, R3E_GATE_TASK_ID)).toMatchObject({ effectivePhase: 'blocked',
    phaseCause: { code: 'round_ambiguous', detail: { gate: true } },
    failure: { subjectKind: 'gate', failureClass: null, notReworkableCause: 'round_ambiguous', round: null,
      automation: { verdict: { kind: 'stopped', reason: 'not_reworkable', detail: { cause: 'round_ambiguous' } } } } });
  // GOAL-27: `awaiting_gate` only means no chain yet; the invalid chain is GOAL-30's not_reworkable alone.
  expect(await display(otherFixture)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    causes: [{ code: 'not_reworkable', taskId: R3E_GATE_TASK_ID, detail: { cause: 'round_ambiguous' } }] });
}, 60_000);

/** W16 (the existing plan evolution): the current Plan with the fix Task `FIX` in the goal gate's scope, at `disposition`. */
const FIX = 'r3e-gate-fix';
async function adoptFixTask(fixture: R3eEvidenceFixture, disposition: 'active' | 'cancelled', prefix: string): Promise<void> {
  const graph = await fixture.b2.base.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef });
  const goal = await fixture.b2.base.plans.queryGoal(fixture.ctx, fixture.goalRef);
  if (graph.status !== 'ready' || goal.status !== 'ready') throw Error('the Goal and its graph must be readable');
  const plan = graph.value.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${prefix}-plan`, planRevision: plan.planRevision + 1, goalId: fixture.goalRef.goalId,
    stages: structuredClone(plan.stages),
    tasks: [...structuredClone(plan.tasks.filter(task => task.taskId !== FIX)), { taskId: FIX, title: 'Repair the gate failure',
      requirementLevel: 'required', taskKind: 'work', disposition, phase: 'pending', scope: { kind: 'goal' } }],
    assignments: [...structuredClone((plan.assignments ?? []).filter(assignment => assignment.taskId !== FIX)),
      { taskId: FIX, role: 'builder', instruction: 'Repair the gate failure' }],
    obligations: plan.obligations.map(obligation => ({ ...structuredClone(obligation),
      taskIds: [...obligation.taskIds.filter(taskId => taskId !== FIX), FIX] })),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [],
  };
  const expected = [{ ref: fixture.goalRef, revision: goal.value.goal.revision }];
  const proposed = await fixture.b2.base.plans.proposePlan(fixture.ctx, { meta: { requestId: `${prefix}-propose`, expected },
    input: { goalRef: fixture.goalRef, basedOn: plan.ref, draft, reason: { text: `the gate fix Task is ${disposition}`, sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw Error(`the proposal failed: ${JSON.stringify(proposed)}`);
  const applied = await fixture.b2.base.plans.applyPlanChange(fixture.ctx, { meta: { requestId: `${prefix}-apply`, expected },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw Error(`the adoption failed: ${JSON.stringify(applied)}`);
}

it('GV-5 counts only active required work in the gate scope: a cancelled fix Task leaves the FAIL gate at GV-9', async () => {
  const fixture = await openFixture();
  const g1 = await finish(fixture, (await open(fixture, true)).ref, 1);
  const work = await finish(fixture, (await open(fixture, false)).ref, 0);
  expect(await complete(fixture, R3E_WORK_TASK_ID, work.ref, 'a2-gate-gv5-work')).toMatchObject({ status: 'committed' });
  // An operator adds a required fix Task: the fix is in progress (GV-5), nothing is re-verified.
  await adoptFixTask(fixture, 'active', 'a2-gate-gv5-add');
  expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ failure: { automation: { verdict: { kind: 'none' } } } });
  expect(await display(fixture)).toMatchObject({ phase: 'RUNNING',
    causes: expect.arrayContaining([expect.objectContaining({ code: 'gate_fix_in_progress', gateTaskId: R3E_GATE_TASK_ID })]) });
  // ... and cancels it unsatisfied: no fix is in progress any more; GV-9 re-verifies if the source changed.
  await adoptFixTask(fixture, 'cancelled', 'a2-gate-gv5-cancel');
  expect(await row(fixture, FIX)).toMatchObject({ disposition: 'cancelled', definition: { requirementLevel: 'required' } });
  expect(await row(fixture, FIX)).not.toMatchObject({ effectivePhase: 'satisfied' });
  expect(await row(fixture, R3E_GATE_TASK_ID)).toMatchObject({ failure: { automation: { verdict: { kind: 'reverify',
    roundRef: g1.ref, needsFinalize: false, onlyIfSourceChanged: true, failureClass: 'check_failed' } } } });
  const shown = await display(fixture);
  expect(shown.causes.map(cause => cause.code)).not.toContain('gate_fix_in_progress');
  expect(shown).toMatchObject({ phase: 'RUNNING', causes: expect.arrayContaining([{ code: 'auto_rework_pending',
    taskId: R3E_GATE_TASK_ID, operation: 'reverify', failureClass: 'check_failed' }]) });
}, 60_000);

it('a gate chain row that names another subject refuses the whole read (unavailable), never a guessed chain', async () => {
  const fixture = await openFixture();
  const finalized = await finish(fixture, (await open(fixture, true)).ref, 1);
  // Indexed under the gate (`ref.taskId`), but its subject is the work Task.
  const foreign: RoundSnapshot = { ...finalized, ref: { ...finalized.ref, roundId: 'a2-gate-foreign' },
    subject: { ...finalized.subject, taskId: R3E_WORK_TASK_ID } };
  expect(await fixture.b2.base.commitRaw([encodeVerificationRoundSnapshot(foreign)])).toMatchObject({ status: 'committed' });
  expect(await fixture.b2.base.plans.queryTaskGraph(fixture.ctx, { goalRef: fixture.goalRef })).toEqual({ status: 'rejected',
    code: 'unavailable', reason: `round a2-gate-foreign does not belong to gate ${R3E_GATE_TASK_ID}` });
}, 60_000);
