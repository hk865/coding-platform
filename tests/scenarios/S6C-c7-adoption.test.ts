/**
 * 6C S3 (§2.2 of the frozen 6C rulings): a person may supersede a Task that already ran and give
 * the replacement the new acceptance.
 *
 * The world is the frozen C7 platform (`tests/scenarios/support/plan.ts` `c7Case`). The preconditions are public
 * steps: one future revision adds the second and the unrelated Task, the first Task runs to `satisfied`, and the
 * second is left with a `running` Run. The adoption is the published `plans/apply` (the PS wrapper). S7-1 lives in
 * `S6C-request-candidate.test.ts` because that world has a real request (lead T1).
 */
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { PlanChangeReason, PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { EvidenceSnapshot } from '../../src/contracts/evidence.js';
import {
  deriveFuturePlanDelta, validateFutureObligationCoverage,
} from '../../src/core/work-graph/tasks/plan-validation.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import { cleanupCommon } from '../scenarios/support/common.js';
import { cleanupPlan, c7Case } from '../scenarios/support/plan.js';
import { cleanupScenarios } from '../scenarios/harness.js';

type Platform = Awaited<ReturnType<typeof c7Case.openEnvironment>>['platform'];
type Environment = Awaited<ReturnType<typeof c7Case.openEnvironment>>;

const WORK_2 = 'work-2';
const WORK_3 = 'work-3';
const WORK_4 = 'work-4';
const WORK_5 = 'work-5';
const O2 = 'a2-disposition-acceptance-2';
const R2 = 'a2-disposition-static-2';

afterAll(async () => {
  await cleanupPlan();
  await cleanupCommon();
  await cleanupScenarios();
});

const optionalWork = (taskId: string, title: string): RuntimeTask => ({
  taskId, title, requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
  scope: { kind: 'goal' }, executionIntent: 'plan_only',
});

/** The C7 world with the book's P1: work-1 satisfied, work-2 running, work-3 unrelated. */
async function openP1(): Promise<{ env: Environment; finish: () => Promise<void>;
  p1: NonNullable<Awaited<ReturnType<typeof c7Case.activePlanRef>>>; work1Evidence: EvidenceSnapshot[] }> {
  // Two model replies: work-1's and work-2's. The second Run is started and left unobserved (`running`).
  const env = await c7Case.openEnvironment(2);
  const { platform, workspaceRoot } = env;
  const p1 = await c7Case.activePlanRef(platform);
  if (p1 === null) throw new Error('the C7 world has no active P1');
  // A file the registered static check (`test -f fixed.txt`) passes for work-1.
  await writeFile(join(workspaceRoot, 'fixed.txt'), '6C C7 acceptance\n');

  // Add work-2 (required, carried by O1) and work-3 (optional, unrelated) before running anything, so the
  // Goal cannot complete behind work-1.
  const added = await c7Case.nextDraft(platform, 's6c-c7-plan-2', draft => ({
    ...draft,
    tasks: [...draft.tasks, c7Case.work(WORK_2, 'The second work'), optionalWork(WORK_3, 'The unrelated work')],
    assignments: [...(draft.assignments ?? []),
      { taskId: WORK_2, role: 'builder', instruction: 'Do the second work' },
      { taskId: WORK_3, role: 'builder', instruction: 'Do the unrelated work' }],
    obligations: draft.obligations.map(obligation => obligation.obligationId === c7Case.OBLIGATION.obligationId
      ? { ...obligation, taskIds: [...obligation.taskIds, WORK_2] } : obligation),
  }));
  const candidate = await c7Case.proposed(platform, 's6c-c7-propose-2', added.source, added.draft,
    { text: 'Add the second and the unrelated work', sources: [] });
  const adopted = await c7Case.apply(platform, 's6c-c7-apply-2', candidate);
  if (adopted.status !== 'committed') throw new Error(`the precondition adoption failed: ${JSON.stringify(adopted)}`);

  // work-1 runs to `satisfied`; stop before the Workflow's automatic next selection.
  let selections = 0;
  const driven = await c7Case.drive(platform, c7Case.select('s6c-c7-run-1', 'work-1'), input => {
    if (input.kind !== 'select_work') return false;
    selections += 1;
    return selections > 1;
  });
  if (driven.next === null && driven.state !== 'waiting') {
    throw new Error(`work-1 did not leave the Workflow at the next selection: ${JSON.stringify(driven)}`);
  }
  expect(await c7Case.taskRow(platform, 'work-1')).toMatchObject({ effectivePhase: 'satisfied' });
  const finalized = driven.receipts.find(receipt => receipt.kind === 'finalize_checks');
  if (finalized?.kind !== 'finalize_checks' || finalized.result.status !== 'committed') {
    throw new Error(`work-1 did not finalize its checks: ${JSON.stringify(finalized)}`);
  }
  const work1Evidence = finalized.result.value.evidence;

  // work-2's start is held at its scripted model call: the Run is `running` with its live handle while the
  // person's adoption runs, exactly the PS-01 shape. The hold is released after the first (busy) apply.
  const gate = deferred();
  const reached = deferred();
  const original = env.scripted.client.stream.bind(env.scripted.client);
  let held = false;
  env.scripted.client.stream = async function* (request, options) {
    if (!held) { held = true; reached.resolve(); await gate.promise; }
    yield* original(request, options);
  };
  const driving = c7Case.drive(platform, c7Case.select('s6c-c7-run-2', WORK_2), c7Case.performs('open_checks'));
  await Promise.race([
    reached.promise,
    driving.then(() => { throw new Error('work-2 ended before its held model call'); }),
  ]);
  const row = await c7Case.taskRow(platform, WORK_2);
  if (row.execution === null) throw new Error('work-2 has no selected Run');
  expect((await c7Case.readRun(platform, row.execution)).run).toMatchObject({ status: 'running', outcome: null });
  let finished = false;
  const finish = async (): Promise<void> => {
    if (finished) return;
    finished = true;
    gate.resolve();
    await driving.catch(() => undefined);
  };
  return { env, finish, p1, work1Evidence };
}

/** The book's P2: work-1 → work-4, work-2 → work-5, O1 keeps its semantics and gains both carriers, O2 is new. */
async function p2Of(platform: Platform): Promise<{ source: PlanRevisionSnapshot; draft: PlanRevisionDraft;
  reason: PlanChangeReason }> {
  const next = await c7Case.nextDraft(platform, 's6c-c7-plan-3', draft => ({
    ...draft,
    tasks: [
      ...draft.tasks.map(task => task.taskId === 'work-1'
        ? { ...task, disposition: 'superseded' as const, replacedByTaskId: WORK_4 }
        : task.taskId === WORK_2
          ? { ...task, disposition: 'superseded' as const, replacedByTaskId: WORK_5 }
          : task),
      c7Case.work(WORK_4, 'Do the new acceptance'),
      c7Case.work(WORK_5, 'Replace the second work'),
    ],
    assignments: [...(draft.assignments ?? []),
      { taskId: WORK_4, role: 'builder', instruction: 'Do the new acceptance' },
      { taskId: WORK_5, role: 'builder', instruction: 'Replace the second work' }],
    obligations: [
      ...draft.obligations.map(obligation => obligation.obligationId === c7Case.OBLIGATION.obligationId
        ? { ...obligation, taskIds: [...obligation.taskIds, WORK_4, WORK_5] } : obligation),
      { obligationId: O2, title: 'Deliver the new acceptance', requirementLevel: 'required' as const,
        taskIds: [WORK_4],
        verificationRequirements: [{ requirementId: R2, requirementLevel: 'required' as const, kind: 'static' as const,
          description: 'Registered static command check 2' }] },
    ],
  }));
  return { source: next.source, draft: next.draft,
    reason: { text: '把 work-1 换成 work-4、work-2 换成 work-5，并给新验收', sources: [],
      affectedTaskIds: ['work-1', WORK_2] } };
}

/** The published `plans/apply` (PS wrapper) as the person. */
async function applyAsPerson(platform: Platform, requestId: string, proposal: { ref: PlanProposalRef; revision: number }) {
  return await c7Case.apply(platform, requestId, proposal);
}

/** The shared S3 world: P1 runs, P2 is proposed, the first apply stops work-2, and the second apply adopts P2. */
async function adoptShared() {
  const { env, finish, p1, work1Evidence } = await openP1();
  const p2 = await p2Of(env.platform);
  const candidate = await c7Case.proposed(env.platform, 's6c-c7-propose-person', p2.source, p2.draft, p2.reason);
  const runRow = await c7Case.taskRow(env.platform, WORK_2);
  if (runRow.execution === null) throw new Error('work-2 has no Run to wait for');
  const runBefore = await c7Case.readRun(env.platform, runRow.execution);
  const first = await applyAsPerson(env.platform, 's6c-c7-apply-person-1', candidate);
  const afterFirst = await c7Case.readRun(env.platform, runBefore.run.ref);
  const planAfterFirst = (await c7Case.graph(env.platform)).plan;
  await finish();
  await waitFor(async () => (await c7Case.readRun(env.platform, runBefore.run.ref)).run,
    run => run.status === 'ended', 'the affected work-2 Run to end');
  const second = await applyAsPerson(env.platform, 's6c-c7-apply-person-2', candidate);
  const work1 = await c7Case.taskRow(env.platform, 'work-1');
  const work4 = await c7Case.taskRow(env.platform, WORK_4);
  const goalPhase = (await c7Case.goalDisplay(env.platform)).phase;
  const planAfter = (await c7Case.graph(env.platform)).plan;
  if (work1.execution === null) throw new Error('work-1 has no Run whose evidence to read');
  const evidenceHead = await env.platform.evidence.queryRoundChainHead!(c7Case.ctx(),
    { subject: work1.ref, subjectRunRef: work1.execution });
  return { env, p1, p2, candidate, runBefore, first, afterFirst, planAfterFirst, second,
    work1, work4, goalPhase, planAfter, evidenceHead, work1Evidence };
}

// ---------------------------------------------------------------------------
// S3: the human adoption of P2
// ---------------------------------------------------------------------------

describe('S6C S3: a person supersedes tasks that ran', () => {
  describe('the shared human adoption of P2', () => {
    let shared: Awaited<ReturnType<typeof adoptShared>>;
    beforeAll(async () => { shared = await adoptShared(); }, 300_000);

    it('S3-1: the human adoption keeps work-1/work-2 definitions and only moves their disposition, keeps O1 and adds O2/R2 for work-4', async () => {
      const { second, p2, p1 } = shared;
      expect(second).toMatchObject({ status: 'committed' });
      if (second.status !== 'committed' || second.value.schemaVersion !== 2) {
        throw new Error(`the adoption did not commit: ${JSON.stringify(second)}`);
      }
      const adopted = second.value;
      expect(adopted.planRevision).toBe(p2.source.planRevision + 1);
      for (const [taskId, replacement] of [['work-1', WORK_4], [WORK_2, WORK_5]] as const) {
        const before = p2.source.tasks.find(task => task.taskId === taskId)!;
        const after = adopted.tasks.find(task => task.taskId === taskId)!;
        expect(after).toEqual({ ...before, disposition: 'superseded', replacedByTaskId: replacement });
      }
      expect(adopted.tasks.find(task => task.taskId === WORK_3)).toEqual(p2.source.tasks.find(task => task.taskId === WORK_3));
      expect(adopted.tasks.find(task => task.taskId === c7Case.GATE)).toEqual(p2.source.tasks.find(task => task.taskId === c7Case.GATE));
      for (const taskId of [WORK_4, WORK_5]) {
        expect(adopted.tasks.find(task => task.taskId === taskId)).toMatchObject({
          disposition: 'active', phase: 'pending', requirementLevel: 'required', taskKind: 'work',
        });
      }
      const o1Before = p2.source.obligations.find(obligation => obligation.obligationId === c7Case.OBLIGATION.obligationId)!;
      const o1After = adopted.obligations.find(obligation => obligation.obligationId === c7Case.OBLIGATION.obligationId)!;
      expect(o1After).toMatchObject({ title: o1Before.title, requirementLevel: o1Before.requirementLevel,
        verificationRequirements: o1Before.verificationRequirements });
      expect(o1After.taskIds).toEqual(expect.arrayContaining([...o1Before.taskIds, WORK_4, WORK_5]));
      expect(adopted.obligations.find(obligation => obligation.obligationId === O2)).toMatchObject({
        requirementLevel: 'required', taskIds: [WORK_4],
        verificationRequirements: [expect.objectContaining({ requirementId: R2, requirementLevel: 'required', kind: 'static' })],
      });
      // Disposition-only Tasks inherit their basis; work-1's definition was frozen in P1, work-2's in P2.
      expect(adopted.taskStateBasis?.entries).toEqual(expect.arrayContaining([
        { taskId: 'work-1', planRef: p1 }, { taskId: WORK_2, planRef: p2.source.ref },
      ]));
      expect(adopted.dispositionRecord?.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ taskId: 'work-1', from: 'active', to: 'superseded', replacedByTaskId: WORK_4, traced: true }),
        expect.objectContaining({ taskId: WORK_2, from: 'active', to: 'superseded', replacedByTaskId: WORK_5, traced: true }),
      ]));
    }, 240_000);

    it('S3-4: the first apply is busy/stopping_affected_work, PS stops only the running work-2 Run, and the second apply commits', async () => {
      const { first, afterFirst, runBefore, planAfterFirst, second, p2 } = shared;
      expect(first).toMatchObject({ status: 'rejected', code: 'busy', reason: 'stopping_affected_work' });
      expect(afterFirst.run.controlState).toMatchObject({ desiredState: 'cancelled' });
      expect(afterFirst.run.ref).toEqual(runBefore.run.ref);
      // Nothing was adopted and work-1's Run was not touched.
      expect(planAfterFirst.ref).toEqual(p2.source.ref);
      expect(second).toMatchObject({ status: 'committed', value: { planRevision: p2.source.planRevision + 1 } });
    }, 240_000);

    it('S3-5: the old evidence stays on the old revision and cannot satisfy the new O2/R2 acceptance; the Goal is not completed', async () => {
      const { second, work1, work4, goalPhase, planAfter, evidenceHead, p1, p2 } = shared;
      expect(second).toMatchObject({ status: 'committed' });
      // work-1 keeps its old completed Run and its reduction: the old evidence is neither deleted nor rolled back.
      expect(work1).toMatchObject({ effectivePhase: 'satisfied' });
      expect(work1.execution).not.toBeNull();
      // The old evidence (`ev-1`) still names work-1's old plan and its O1/R1 coverage, never the new O2/R2.
      if (evidenceHead.status !== 'ready') {
        throw new Error(`the work-1 evidence round is unreadable: ${JSON.stringify(evidenceHead)}`);
      }
      const evidence = evidenceHead.value;
      expect(evidence.evidenceRefs.length).toBeGreaterThan(0);
      expect(evidence).toMatchObject({ subject: work1.ref, subjectRunRef: work1.execution,
        adoptedPlanRef: p2.source.ref, taskBasisRef: p1 });
      const coverage = evidence.checks.flatMap(check => check.coverage);
      expect(coverage).toEqual(expect.arrayContaining([{
        obligationId: c7Case.OBLIGATION.obligationId,
        requirementId: c7Case.OBLIGATION.verificationRequirements[0]!.requirementId,
      }]));
      expect(coverage.some(entry => entry.obligationId === O2 || entry.requirementId === R2)).toBe(false);
      // The admitted Evidence itself (from work-1's public finalize_checks receipt): anchored on the plan work-1
      // ran under, covering O1/R1 and never O2/R2.
      const { work1Evidence } = shared;
      expect(work1Evidence.length).toBeGreaterThan(0);
      for (const admitted of work1Evidence) {
        expect(admitted.evidence.anchor.planRef).toEqual(p2.source.ref);
        expect(admitted.evidence.coverage).toEqual(expect.arrayContaining([{
          obligationId: c7Case.OBLIGATION.obligationId,
          requirementId: c7Case.OBLIGATION.verificationRequirements[0]!.requirementId,
        }]));
        expect(admitted.evidence.coverage.some(entry => entry.obligationId === O2 || entry.requirementId === R2))
          .toBe(false);
      }
      // The new required task carries O2/R2 and has no evidence of its own.
      const work4Obligations = planAfter.obligations.filter(obligation => obligation.taskIds.includes(WORK_4));
      expect(work4Obligations.map(obligation => obligation.obligationId)).toEqual(expect.arrayContaining([O2]));
      expect(work4Obligations.find(obligation => obligation.obligationId === O2)
        ?.verificationRequirements.map(requirement => requirement.requirementId)).toEqual([R2]);
      // The new required task has no Run and the Goal cannot be completed by the old evidence.
      expect(work4).toMatchObject({ effectivePhase: 'pending', execution: null });
      expect(goalPhase).not.toBe('COMPLETED');
      // The adopted plan carries the new O2/R2 acceptance and still carries O1/R1.
      expect(planAfter.obligations.map(obligation => obligation.obligationId).sort())
        .toEqual([c7Case.OBLIGATION.obligationId, O2].sort());
    }, 240_000);
  });

  it('S3-2: the same requirement id is refused; a changed requirement with a new id still needs an active required carrier', async () => {
    const source = pureSource();
    const cases: { name: string; target: PlanRevisionDraft; expected: 'obligation_semantics_changed' | 'obligation_task_mapping' | 'supported' }[] = [
      { name: 'same requirement id', target: pureTarget({ requirementId: 'r1', description: 'R1 changed' }), expected: 'obligation_semantics_changed' },
      { name: 'new requirement id, no active required carrier', target: pureTarget({ requirementId: 'r2', description: 'R2', taskIds: ['b'] }), expected: 'obligation_task_mapping' },
      { name: 'new requirement id, active required carrier', target: pureTarget({ requirementId: 'r2', description: 'R2', taskIds: ['a'] }), expected: 'supported' },
    ];
    for (const entry of cases) {
      const delta = deriveFuturePlanDelta(source, entry.target);
      if (delta.status !== 'supported') throw new Error(delta.reason);
      const coverage = validateCoverage({ source, target: entry.target, delta: delta.delta, personAdopts: true });
      if (entry.expected === 'supported') expect(coverage).toEqual({ status: 'supported' });
      else expect(coverage).toMatchObject({ status: 'rejected', issues: [expect.objectContaining({ code: entry.expected })] });
    }
  }, 30_000);

  it('S3-3: the platform automation adopting the same P2 is refused invalid', async () => {
    const { env, finish } = await openP1();
    try {
      const p2 = await p2Of(env.platform);
      const candidate = await c7Case.proposed(env.platform, 's6c-c7-propose-auto', p2.source, p2.draft, p2.reason,
        c7Case.automation());
      const automatic = await c7Case.apply(env.platform, 's6c-c7-apply-automatic', candidate, c7Case.automation());
      expect(automatic).toMatchObject({ status: 'rejected', code: 'invalid' });
      const after = await c7Case.graph(env.platform);
      expect(after.plan.ref).toEqual(p2.source.ref);
    } finally {
      await finish();
    }
  }, 180_000);

  it('S3-6: `plans/proposal` reads the adopted proposal with the actual adopter and revision+1', async () => {
    // §1.7.1's read is independent of S3: a plain next revision, adopted by the person, then read back.
    const env = await c7Case.openEnvironment(0);
    const next = await c7Case.nextDraft(env.platform, 's6c-c7-plan-adoptedby', draft => ({
      ...draft,
      tasks: draft.tasks.map(task => task.taskId === 'work-1' ? { ...task, title: 'The adopted-by work' } : task),
    }));
    const candidate = await c7Case.proposed(env.platform, 's6c-c7-propose-adoptedby', next.source, next.draft,
      { text: 'S3-6 adoptedBy', sources: [] });
    const second = await c7Case.apply(env.platform, 's6c-c7-apply-adoptedby', candidate);
    expect(second).toMatchObject({ status: 'committed' });
    type ProposalWithAdoption = { status: string; revision: number; adoptedBy?: { kind: string; id: string } };
    const proposal = await env.platform.plans.readPlanProposal(c7Case.ctx(), candidate.ref as never) as
      ReadResult<ProposalWithAdoption>;
    expect(proposal).toMatchObject({ status: 'ready', value: {
      status: 'accepted', revision: candidate.revision + 1,
      adoptedBy: expect.objectContaining({ kind: 'human', id: c7Case.operator.id }),
    } });
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The pure S3-2 data
// ---------------------------------------------------------------------------

function pureSource(): PlanRevisionSnapshot {
  return {
    schemaVersion: 2, ref: { aggregateType: 'PlanRevision', projectId: 's6c-s3-pure', planId: 's6c-s3-pure-plan' },
    revision: 1, goalRef: { aggregateType: 'Goal', projectId: 's6c-s3-pure', goalId: 's6c-s3-pure-goal' },
    planId: 's6c-s3-pure-plan', planRevision: 1, acceptedAt: '2026-10-23T00:00:00.000Z',
    effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: 's6c-s3-pure',
      policyId: 's6c-s3-pure-policy', revision: 1 }, digest: 'a'.repeat(64) },
    effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 's6c-s3-pure',
      baselineId: 's6c-s3-pure-baseline', revision: 1 }, digest: 'b'.repeat(64) },
    stages: [],
    tasks: [
      { taskId: 'a', title: 'A', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'b', title: 'B', requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'goal' }, executionIntent: 'plan_only' },
    ],
    assignments: [{ taskId: 'a', role: 'builder', instruction: 'Do A' }],
    obligations: [{ obligationId: 'o1', title: 'O1', requirementLevel: 'required', taskIds: ['a'],
      verificationRequirements: [{ requirementId: 'r1', requirementLevel: 'required', kind: 'static', description: 'R1' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  } as unknown as PlanRevisionSnapshot;
}

function pureTarget(input: { requirementId: string; description: string; taskIds?: string[] }): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 's6c-s3-pure-plan-2', planRevision: 2, goalId: 's6c-s3-pure-goal', stages: [],
    tasks: [
      { taskId: 'a', title: 'A', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'b', title: 'B', requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'goal' }, executionIntent: 'plan_only' },
    ],
    assignments: [{ taskId: 'a', role: 'builder', instruction: 'Do A' }],
    obligations: [{ obligationId: 'o1', title: 'O1', requirementLevel: 'required', taskIds: input.taskIds ?? ['a'],
      verificationRequirements: [{ requirementId: input.requirementId, requirementLevel: 'required', kind: 'static',
        description: input.description }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

type CoverageInput = Parameters<typeof validateFutureObligationCoverage>[0] & { personAdopts: boolean };

/** The extra `personAdopts` is passed structurally: the base implementation ignores an unknown key. */
const validateCoverage = (input: CoverageInput) => validateFutureObligationCoverage(input);
