/**
 * A.2 step 5.4b (C6, LA-2): W3's relaxed Plan guard and the material grant rule
 * by basis (docs/refactor/STATE-MACHINES-SPEC.md §3.3 point 5, §6 RUN-02/RUN-04,
 * §6.1 contract (g)).
 *
 * 1. The pure `entryPlanVerdict` and `executionDefinitionsAgree` over hand-built
 *    accepted Plans: same Plan, a Plan that carries the Task unchanged (with and
 *    without a basis hop, and after another Task's disposition-only change), an
 *    excluded / missing / deferred / gate Task, a Plan of another Goal, a claim
 *    Plan that is not older, a missing basis source and a basis match whose
 *    definition differs.
 * 2. `authorizeRuntimeEntry` and `beginRuntimeEntry` over the real claim
 *    fixture and real Plan adoptions (W16): a claim on P1 authorizes after an
 *    unrelated adoption to P2 (the event names P2, the commit pins it, the Run
 *    and Attempt keep P1), a fresh begin after another adoption needs no Plan
 *    read, an adoption committed between the authorization's reads and its
 *    commit is a Goal@rev `revision_conflict` that a re-read authorizes, and a
 *    store that cannot return the active Plan gives `unavailable` (with the
 *    verdict reason) and zero writes. `readEntryPlanVerdict` reads and pins the
 *    basis source of a claim Plan two adoptions back.
 * 3. `createTaskCarriedUnchanged`, the predicate the composition root injects
 *    into `materials/`.
 *
 * Not driven through the service: `changed`. On clean data a Task with a Run
 * keeps its execution definition and basis (I-22), so only a forged Plan
 * reaches it (AGENTS.md rule 4); the pure verdict and the Run machine cover it,
 * and the service maps it on the same branch as `unavailable`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask,
} from '../../src/contracts/plan.js';
import { executionEntryAuthorizedEventFromEvent } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import {
  createTaskCarriedUnchanged, readEntryPlanVerdict,
} from '../../src/core/work-graph/tasks/entry-plan-reader.js';
import { planRevisionRefKey } from '../../src/core/work-graph/tasks/plan-record-codecs.js';
import {
  entryPlanVerdict, executionDefinitionsAgree, frozenTaskDefinitionsAgree, planTaskFacts, taskOriginVerdict,
} from '../../src/core/work-graph/tasks/plan-task-basis.js';
import { b2Key, createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';

// ------------------------------------------------------------------------ //
// 1. The pure verdict                                                        //
// ------------------------------------------------------------------------ //

const P = 'ep-project';
const goalRef: GoalRef = { aggregateType: 'Goal', projectId: P, goalId: 'ep-goal' };
const planRef = (planId: string): PlanRevisionRef => ({ aggregateType: 'PlanRevision', projectId: P, planId });
const task = (taskId: string, over: Partial<RuntimeTask> = {}): RuntimeTask => ({
  taskId, title: `Task ${taskId}`, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
  scope: { kind: 'goal' }, ...over,
});

/** An accepted v2 Plan; `basis` maps taskId → planId (absent: every Task is its own basis). */
function plan(planId: string, planRevision: number, tasks: RuntimeTask[], options: {
  basis?: Record<string, string>; instructions?: Record<string, string>; goalId?: string;
} = {}): PlanRevisionSnapshot {
  return {
    schemaVersion: 2, ref: planRef(planId), revision: 1, goalRef: { ...goalRef, goalId: options.goalId ?? goalRef.goalId },
    planId, planRevision, acceptedAt: '2026-10-05T00:00:00.000Z',
    effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'ep-policy', revision: 1 },
      digest: 'a'.repeat(64) },
    effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P, baselineId: 'ep-baseline',
      revision: 1 }, digest: 'b'.repeat(64) },
    stages: [], tasks,
    assignments: tasks.filter(item => item.taskKind === 'work')
      .map(item => ({ taskId: item.taskId, role: 'builder', instruction: options.instructions?.[item.taskId] ?? `Do ${item.taskId}` })),
    obligations: [{ obligationId: 'ep-obligation', title: 'Deliver', requirementLevel: 'required',
      taskIds: tasks.map(item => item.taskId),
      verificationRequirements: [{ requirementId: 'ep-check', requirementLevel: 'required', kind: 'static', description: 'Check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
    ...(options.basis === undefined ? {} : { taskStateBasis: { schemaVersion: 1,
      entries: Object.entries(options.basis).sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([taskId, id]) => ({ taskId, planRef: planRef(id) })) } }),
  };
}

const P1 = plan('p1', 1, [task('t1'), task('t2')]);
/** An unrelated adoption: t3 added, t1 and t2 inherit P1 as their basis. */
const P2 = plan('p2', 2, [task('t1'), task('t2'), task('t3')], { basis: { t1: 'p1', t2: 'p1', t3: 'p2' } });
const sources = (...plans: PlanRevisionSnapshot[]) => new Map(plans.map(item => [planRevisionRefKey(item.ref), item]));
const verdictOf = (claimPlan: PlanRevisionSnapshot, activePlan: PlanRevisionSnapshot, taskId = 't1',
  basisSources = sources()) => entryPlanVerdict({ claimPlan, activePlan, basisSources, taskId, goalRef });

describe('entryPlanVerdict (C6, §6.1 contract (g))', () => {
  it('is active_plan for the same Plan and carried_unchanged for an unrelated adoption', () => {
    expect(verdictOf(P1, P1)).toEqual({ kind: 'active_plan' });
    expect(verdictOf(P1, P2)).toEqual({ kind: 'carried_unchanged', activePlanRef: P2.ref });
    // One more unrelated adoption: the claim on P2 names basis P1, which is read as a source.
    const P3 = plan('p3', 3, [task('t1'), task('t2'), task('t3'), task('t4')],
      { basis: { t1: 'p1', t2: 'p1', t3: 'p2', t4: 'p3' } });
    expect(verdictOf(P2, P3, 't1', sources(P1))).toEqual({ kind: 'carried_unchanged', activePlanRef: P3.ref });
    expect(verdictOf(P1, P3, 't1')).toEqual({ kind: 'carried_unchanged', activePlanRef: P3.ref });
    // Without the basis source the chain cannot be verified.
    expect(verdictOf(P2, P3, 't1')).toMatchObject({ kind: 'unavailable',
      reason: expect.stringContaining('basis source p1 for task t1 is missing') });
  });

  it('is changed when the active Plan changed, removed, deferred or never ran the Task as work', () => {
    // t1 changed (W16 re-bases a changed Task): the origin is excluded.
    const changedT1 = plan('p2c', 2, [task('t1'), task('t2')], { basis: { t1: 'p2c', t2: 'p1' }, instructions: { t1: 'Do it differently' } });
    expect(verdictOf(P1, changedT1)).toMatchObject({ kind: 'changed',
      reason: 'the Goal active Plan p2c changed the basis or the execution definition of task t1' });
    const withoutT1 = plan('p2m', 2, [task('t2')], { basis: { t2: 'p1' } });
    expect(verdictOf(P1, withoutT1)).toMatchObject({ kind: 'changed', reason: 'the Goal active Plan p2m no longer has task t1' });
    // A disposition-only change that keeps the basis (C7, 5.10): the definitions agree, the Task is not active.
    const deferred = plan('p2d', 2, [task('t1', { disposition: 'deferred' }), task('t2')], { basis: { t1: 'p1', t2: 'p1' } });
    expect(verdictOf(P1, deferred)).toMatchObject({ kind: 'changed',
      reason: 'task t1 is not an active work Task in the Goal active Plan p2d' });
    const withGate = plan('p1g', 1, [task('t1'), task('g', { taskKind: 'gate' })]);
    const gateCarried = plan('p2g', 2, [task('t1'), task('g', { taskKind: 'gate' })], { basis: { t1: 'p1g', g: 'p1g' } });
    expect(verdictOf(withGate, gateCarried, 'g')).toMatchObject({ kind: 'changed',
      reason: 'task g is not an active work Task in the Goal active Plan p2g' });
    // A claim Plan that is not older than the active Plan.
    expect(verdictOf(P2, P1)).toMatchObject({ kind: 'changed', reason: 'the claim Plan p2 is not older than the Goal active Plan p1' });
  });

  it('stays carried_unchanged when a later Plan only changes another Task\'s disposition (P1 → P2 → P3)', () => {
    // P3 defers t2 only. Today's W16 re-bases t2 on P3; C7 (5.10) keeps its basis P1. Either way t1 is carried.
    const rebased = plan('p3', 3, [task('t1'), task('t2', { disposition: 'deferred' }), task('t3')],
      { basis: { t1: 'p1', t2: 'p3', t3: 'p2' } });
    const inherited = plan('p3k', 3, [task('t1'), task('t2', { disposition: 'deferred' }), task('t3')],
      { basis: { t1: 'p1', t2: 'p1', t3: 'p2' } });
    for (const P3 of [rebased, inherited]) {
      expect(verdictOf(P1, P3), P3.planId).toEqual({ kind: 'carried_unchanged', activePlanRef: P3.ref });
      expect(verdictOf(P2, P3, 't1', sources(P1)), P3.planId).toEqual({ kind: 'carried_unchanged', activePlanRef: P3.ref });
      // The deferred t2 itself is not carried as an active work Task.
      expect(verdictOf(P1, P3, 't2'), P3.planId).toMatchObject({ kind: 'changed' });
    }
  });

  it('is unavailable for another Goal, a missing basis entry or a basis whose definition differs', () => {
    expect(verdictOf(plan('other', 1, [task('t1')], { goalId: 'other-goal' }), P2))
      .toMatchObject({ kind: 'unavailable', reason: 'plan other does not belong to goal ep-goal' });
    const noEntry = plan('p2n', 2, [task('t1'), task('t2')], { basis: { t2: 'p1' } });
    expect(verdictOf(P1, noEntry)).toMatchObject({ kind: 'unavailable',
      reason: 'accepted Plan p2n carries a taskStateBasis without task t1' });
    // The basis claims P1 but the definition differs: damaged history, not a change.
    const corrupt = plan('p2x', 2, [task('t1'), task('t2')], { basis: { t1: 'p1', t2: 'p1' }, instructions: { t1: 'Forged' } });
    expect(verdictOf(P1, corrupt)).toMatchObject({ kind: 'unavailable',
      reason: 'basis source p1 and referrer p2x disagree on task t1' });
  });
});

describe('executionDefinitionsAgree (§3.3)', () => {
  it('ignores the disposition and replacedByTaskId and nothing else', () => {
    const definitionOf = (item: PlanRevisionSnapshot, taskId = 't1') => planTaskFacts(item).definitions.get(taskId)!;
    const deferred = plan('p2d', 2, [task('t1', { disposition: 'superseded', replacedByTaskId: 't2' }), task('t2')]);
    expect(executionDefinitionsAgree({ left: definitionOf(P1), right: definitionOf(deferred) })).toBe(true);
    expect(frozenTaskDefinitionsAgree({ left: definitionOf(P1), right: definitionOf(deferred) })).toBe(false);
    const phase = plan('p2p', 2, [task('t1', { phase: 'ready' }), task('t2')]);
    expect(executionDefinitionsAgree({ left: definitionOf(P1), right: definitionOf(phase) })).toBe(false);
    const instruction = plan('p2i', 2, [task('t1'), task('t2')], { instructions: { t1: 'Other' } });
    expect(executionDefinitionsAgree({ left: definitionOf(P1), right: definitionOf(instruction) })).toBe(false);
  });

  it('lets a Run on the claim Plan describe a Task whose disposition alone changed (taskOriginVerdict)', () => {
    const deferred = plan('p2d', 2, [task('t1', { disposition: 'deferred' }), task('t2')], { basis: { t1: 'p1', t2: 'p1' } });
    const selected = planTaskFacts(deferred);
    const origin = planTaskFacts(P1);
    const index = new Map([[planRevisionRefKey(P1.ref), origin], [planRevisionRefKey(deferred.ref), selected]]);
    expect(taskOriginVerdict({ origin, selected, selectedBasis: P1.ref, selectedDefinition: selected.definitions.get('t1')!,
      taskId: 't1', index, goalRef })).toEqual({ status: 'accepted' });
  });
});

// ------------------------------------------------------------------------ //
// 2. W3 / W4 through the services                                            //
// ------------------------------------------------------------------------ //

const fixtures: B2ExecutionFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

async function open(): Promise<B2ExecutionFixture> {
  const f = await createB2ExecutionFixture('sqlite');
  fixtures.push(f);
  return f;
}

/** A real W16 future-only adoption on the fixture Goal adding one unrelated plan_only Task. */
async function adoptUnrelated(f: B2ExecutionFixture, suffix: string): Promise<PlanRevisionSnapshot> {
  const base = f.base;
  const graph = await base.plans.queryTaskGraph(base.ctx, { goalRef: base.goalRef });
  if (graph.status !== 'ready') throw new Error(`task graph: ${JSON.stringify(graph)}`);
  const current = graph.value.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `ep-plan-${suffix}`, planRevision: current.planRevision + 1, goalId: base.goalRef.goalId,
    stages: structuredClone(current.stages),
    tasks: [...structuredClone(current.tasks), { taskId: `ep-future-${suffix}`, title: 'Unrelated future intent',
      requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
      executionIntent: 'plan_only' }],
    assignments: structuredClone(current.assignments ?? []), obligations: structuredClone(current.obligations),
    taskHierarchy: structuredClone(current.taskHierarchy), executionDag: structuredClone(current.executionDag),
    taskRelations: current.schemaVersion === 2 ? structuredClone(current.taskRelations ?? []) : [],
    inputRequirements: current.schemaVersion === 2 ? structuredClone(current.inputRequirements ?? []) : [],
  };
  const proposed = await base.plans.proposePlan(base.ctx, { meta: { requestId: `ep-propose-${suffix}`, expected: [await base.goalPin()] },
    input: { goalRef: base.goalRef, basedOn: current.ref, draft, reason: { text: 'An unrelated future-only edit', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) throw new Error(`proposal: ${JSON.stringify(proposed)}`);
  const applied = await base.plans.applyPlanChange(base.ctx, { meta: { requestId: `ep-apply-${suffix}`, expected: [await base.goalPin()] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`adoption: ${JSON.stringify(applied)}`);
  return applied.value;
}

describe('W3 / W4 with an older claim Plan (RUN-02, RUN-04; C6)', () => {
  it('authorizes a claim on P1 after an unrelated adoption, names P2 in the event and pins it', async () => {
    const f = await open();
    const prepared = await f.buildPrepared();
    const p2 = await adoptUnrelated(f, 'p2');
    const before = await f.read();
    const result = await f.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'ep-authorize', expected: [await f.pin()] } });
    expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') return;
    // The Run, its Attempt, its claim and envelope keep P1.
    const after = await f.read();
    expect(after.run.planRef).toEqual(f.base.planRef);
    expect(after.attempt.planRef).toEqual(f.base.planRef);
    expect(after.outbox.claim.planRef).toEqual(f.base.planRef);
    expect(after.run.executionAuthorization).toMatchObject({ schemaVersion: 2, generation: 1, phase: 'authorized' });
    expect(after.run.revision).toBe(before.run.revision + 1);
    const at = await f.base.records.eventAt(result.cursor);
    if (at.status !== 'ready') throw new Error('the authorization event must be readable');
    expect(executionEntryAuthorizedEventFromEvent(at.value.event)).toMatchObject({ status: 'decoded',
      value: { activePlanRef: p2.ref, permit: result.value } });
    // The same request replays the original permit after a later adoption (the fingerprint has no active Plan).
    await adoptUnrelated(f, 'p3');
    expect(await f.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'ep-authorize', expected: [{ ref: f.claim.runRef, revision: before.run.revision }] } }))
      .toEqual({ ...result, replayed: true });
    // RUN-04 reads no Plan: the fresh begin after P3 enters.
    const begun = await f.entry.beginRuntimeEntry(f.ctx, { input: { permit: result.value, kernel: f.kernel },
      meta: { requestId: 'ep-begin', expected: [await f.pin()] } });
    expect(begun, JSON.stringify(begun)).toMatchObject({ status: 'committed', value: { authorization: { phase: 'entering' } } });
  });

  it('writes no activePlanRef for a claim on the active Plan (today\'s event)', async () => {
    const f = await open();
    const result = await f.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared: await f.buildPrepared(), consumerId: 'runtime-a' },
      meta: { requestId: 'ep-authorize-active', expected: [await f.pin()] } });
    if (result.status !== 'committed') throw new Error(JSON.stringify(result));
    const at = await f.base.records.eventAt(result.cursor);
    if (at.status !== 'ready') throw new Error('the authorization event must be readable');
    const decoded = executionEntryAuthorizedEventFromEvent(at.value.event);
    expect(decoded.status).toBe('decoded');
    if (decoded.status === 'decoded') expect('activePlanRef' in decoded.value).toBe(false);
  });

  it('an adoption between the authorization reads and its commit conflicts on Goal@rev; a re-read authorizes', async () => {
    const f = await open();
    const prepared = await f.buildPrepared();
    const p2 = await adoptUnrelated(f, 'p2');
    let intervened = false;
    let p3: PlanRevisionSnapshot | null = null;
    const records = { ...f.base.records, async commit(batch: Parameters<typeof f.base.records.commit>[0]) {
      if (!intervened) {
        intervened = true;
        // The commit pins the Plans the carried verdict read: the active P2 and the claim Plan P1 (its basis).
        expect(batch.guards).toEqual(expect.arrayContaining([{ refKey: b2Key(p2.ref), expectedRevision: 1 },
          { refKey: b2Key(f.base.planRef), expectedRevision: 1 }]));
        p3 = await adoptUnrelated(f, 'p3');
      }
      return f.base.records.commit(batch);
    } };
    const before = await f.read();
    const raced = await f.ports(records).entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'ep-authorize-raced', expected: [await f.pin()] } });
    expect(intervened).toBe(true);
    expect(raced).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const after = await f.read();
    expect(after.run).toEqual(before.run); expect(after.attempt).toEqual(before.attempt);
    expect(after.outbox).toEqual(before.outbox); expect(after.session).toEqual(before.session);
    // The driver re-reads and authorizes under P3.
    const retried = await f.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'ep-authorize-retried', expected: [await f.pin()] } });
    expect(retried).toMatchObject({ status: 'committed', replayed: false });
    if (retried.status !== 'committed' || p3 === null) throw new Error('the retry must commit after the adoption');
    const at = await f.base.records.eventAt(retried.cursor);
    if (at.status !== 'ready') throw new Error('the authorization event must be readable');
    expect(executionEntryAuthorizedEventFromEvent(at.value.event))
      .toMatchObject({ value: { activePlanRef: (p3 as PlanRevisionSnapshot).ref } });
  });

  it('refuses unavailable with the verdict reason and writes nothing when the store cannot return the active Plan', async () => {
    const f = await open();
    const prepared = await f.buildPrepared();
    const p2 = await adoptUnrelated(f, 'p2');
    const p2Key = planRevisionRefKey(p2.ref);
    let commits = 0;
    // A read fault, not a forged record: the store answers the active Plan as missing; nothing stored changes.
    const records: typeof f.base.records = { ...f.base.records,
      async readMany(keys) {
        const read = await f.base.records.readMany(keys);
        if (read.status !== 'ready' || !keys.includes(p2Key)) return read;
        return { ...read, value: { ...read.value, records: read.value.records.filter(record => record.refKey !== p2Key),
          missing: [...read.value.missing, p2Key] } };
      },
      async commit(batch) {
        commits += 1;
        return f.base.records.commit(batch);
      } };
    const before = await f.read();
    const refused = await f.ports(records).entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'ep-authorize-unreadable', expected: [await f.pin()] } });
    expect(refused).toEqual({ status: 'rejected', code: 'unavailable',
      reason: 'the Task basis in the Goal active Plan cannot be resolved (the Goal active Plan ep-plan-p2 is missing)' });
    expect(commits).toBe(0);
    expect(await f.read()).toEqual(before);
    // With the store answering again, the same claim is authorized under P2.
    const retried = await f.entry.authorizeRuntimeEntry(f.ctx, { input: { prepared, consumerId: 'runtime-a' },
      meta: { requestId: 'ep-authorize-readable', expected: [await f.pin()] } });
    expect(retried).toMatchObject({ status: 'committed', replayed: false });
  });

  it('readEntryPlanVerdict reads and pins the basis source a claim Plan names (claim P2, basis P1, active P3)', async () => {
    const f = await open();
    const p2 = await adoptUnrelated(f, 'p2');
    const p3 = await adoptUnrelated(f, 'p3');
    const taskId = f.claim.task.taskId;
    const p1Guard = { refKey: planRevisionRefKey(f.base.planRef), expectedRevision: 1 };
    const p2Guard = { refKey: planRevisionRefKey(p2.ref), expectedRevision: 1 };
    const p3Guard = { refKey: planRevisionRefKey(p3.ref), expectedRevision: 1 };
    expect(await readEntryPlanVerdict(f.base.records, { goalRef: f.base.goalRef, taskId, claimPlan: p2, activePlanRef: p3.ref }))
      .toEqual({ status: 'ready', verdict: { kind: 'carried_unchanged', activePlanRef: p3.ref }, guards: [p3Guard, p1Guard] });
    // The materials predicate also pins the claim Plan it read.
    expect(await createTaskCarriedUnchanged(f.base.records)({ goalRef: f.base.goalRef, taskId, fromPlanRef: p2.ref,
      toPlanRef: p3.ref })).toEqual({ status: 'carried', guards: [p2Guard, p3Guard, p1Guard] });
  });

  it('readEntryPlanVerdict: no active Plan is changed, the claim Plan active_plan, a missing one unavailable', async () => {
    const f = await open();
    const claimPlan = (await f.read()).plan;
    expect(await readEntryPlanVerdict(f.base.records, { goalRef: f.base.goalRef, taskId: f.claim.task.taskId, claimPlan,
      activePlanRef: null })).toEqual({ status: 'ready', verdict: { kind: 'changed', reason: 'the Goal has no active Plan' }, guards: [] });
    expect(await readEntryPlanVerdict(f.base.records, { goalRef: f.base.goalRef, taskId: f.claim.task.taskId, claimPlan,
      activePlanRef: f.base.planRef })).toEqual({ status: 'ready', verdict: { kind: 'active_plan' }, guards: [] });
    expect(await readEntryPlanVerdict(f.base.records, { goalRef: f.base.goalRef, taskId: f.claim.task.taskId, claimPlan,
      activePlanRef: planRef('ep-no-such-plan') })).toMatchObject({ status: 'ready', guards: [],
      verdict: { kind: 'unavailable', reason: 'the Goal active Plan ep-no-such-plan is missing' } });
  });
});

describe('createTaskCarriedUnchanged (LA-2)', () => {
  it('answers carried with the Plans it read, not_carried for another Task and unavailable for a missing Plan', async () => {
    const f = await open();
    const p2 = await adoptUnrelated(f, 'p2');
    const carried = createTaskCarriedUnchanged(f.base.records);
    const taskId = f.claim.task.taskId;
    expect(await carried({ goalRef: f.base.goalRef, taskId, fromPlanRef: f.base.planRef, toPlanRef: p2.ref })).toEqual({
      status: 'carried', guards: [
        { refKey: planRevisionRefKey(f.base.planRef), expectedRevision: 1 },
        { refKey: planRevisionRefKey(p2.ref), expectedRevision: 1 },
      ] });
    expect(await carried({ goalRef: f.base.goalRef, taskId, fromPlanRef: p2.ref, toPlanRef: p2.ref }))
      .toEqual({ status: 'carried', guards: [{ refKey: planRevisionRefKey(p2.ref), expectedRevision: 1 }] });
    // The new Task is not in the claim Plan: its origin cannot be read there.
    expect(await carried({ goalRef: f.base.goalRef, taskId: 'ep-future-p2', fromPlanRef: f.base.planRef, toPlanRef: p2.ref }))
      .toMatchObject({ status: 'unavailable' });
    expect(await carried({ goalRef: f.base.goalRef, taskId, fromPlanRef: planRef('ep-no-such-plan'), toPlanRef: p2.ref }))
      .toMatchObject({ status: 'unavailable', reason: expect.stringContaining('not_found') });
    expect(await carried({ goalRef: f.base.goalRef, taskId, fromPlanRef: p2.ref, toPlanRef: f.base.planRef }))
      .toMatchObject({ status: 'not_carried' });
  });
});
