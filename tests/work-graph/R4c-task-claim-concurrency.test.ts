/** Independent review: same service instance concurrency and Store replay race. */
import { expect, it } from 'vitest';
import { createTaskClaimFixture, CLAIM_FIXTURE_AT } from '../helpers/task-claim-fixture.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { PreparedCommit } from '../../src/core/record-store/ports.js';
import type { TaskClaimFixture } from '../helpers/task-claim-fixture.js';


async function cancelUnentered(f: TaskClaimFixture, runRef: RunRef): Promise<number> {
  let seq = 0;
  const controls = createRunControlService({ records: f.records,
    authority: createMaterialRecordReaders(f.records).authority,
    reads: createRunStateReader({ records: f.records }),
    now: () => CLAIM_FIXTURE_AT, eventId: () => `r4c-concurrency-control-${++seq}` });
  const read = await createRunStateReader({ records: f.records }).readExecution(f.ctx, runRef);
  if (read.status !== 'ready') throw Error(`the old Run is not readable: ${JSON.stringify(read)}`);
  const result = await controls.submitControl(f.ctx, { input: { runRef, kind: 'cancel',
    reason: 'end the old Run before the new plan' },
    meta: { requestId: 'r4c-concurrency-cancel', expected: [{ ref: runRef, revision: read.value.run.revision }] } });
  if (result.status !== 'committed') throw Error(`cancel failed: ${JSON.stringify(result)}`);
  return result.value.runRevision;
}

/** B-08(e): the real requeue owner over the fixture's records and real source. */
function requeueService(f: TaskClaimFixture) {
  let seq = 0;
  return createTaskRequeueService({ records: f.records,
    reads: createRunStateReader({ records: f.records }),
    workspaceHost: { async resolveRoot() {
      return { status: 'ready', value: { root: f.directory, workspaceRevision: 1 } } as const;
    } },
    source: new VerificationWorkspaceReader(),
    materials: {
      async storeArtifact() { return { status: 'rejected', code: 'unsupported', reason: 'no new input is passed' } as const; },
      async openArtifact() { return { status: 'rejected', code: 'unsupported', reason: 'no new input is passed' } as const; },
    },
    messages: { async readMessage() { return { status: 'rejected', code: 'unsupported', reason: 'no new input is passed' } as const; } },
    now: () => CLAIM_FIXTURE_AT, eventId: () => `r4c-concurrency-requeue-${++seq}` });
}

it.each(['memory', 'sqlite'] as const)('%s: simultaneous identical requests return the first committed claim', async kind => {
  const f = await createTaskClaimFixture(kind);
  try {
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const commits: PreparedCommit[] = [];
    const service = f.makeService({ ...f.records, async commit(batch) {
      commits.push(structuredClone(batch)); if (commits.length === 2) release();
      await barrier; return f.records.commit(batch);
    } });
    const request = await f.buildRequest({ requestId: 'concurrent-same-request' });
    const outcomes = await Promise.all([service.claimTask(f.ctx, request), service.claimTask(f.ctx, request)]);
    expect(commits).toHaveLength(2);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['committed', 'committed']);
    const [a, b] = outcomes;
    if (a?.status !== 'committed' || b?.status !== 'committed') throw Error('same request was not replayed');
    expect(a.value).toEqual(b.value); expect(a.cursor).toBe(b.cursor);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const lost = commits.find(batch => batch.records.some(record => {
      const ref = JSON.parse(record.refKey); return ref.aggregateType === 'Run' && ref.runId !== a.value.runRef.runId;
    }));
    expect(lost).toBeDefined();
    const unpublished = lost!.records.filter(record =>
      ['Run', 'TaskAttempt', 'DispatchOutboxEntry'].includes(JSON.parse(record.refKey).aggregateType));
    expect(unpublished).toHaveLength(3);
    expect(await f.records.readMany(unpublished.map(record => record.refKey)))
      .toMatchObject({ status: 'ready', value: { records: [] } });
  } finally { await f.close(); }
});

it('one role resolver keeps concurrent projects read guards request-local', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    let arrivals = 0;
    const roles = createRoleConfigurationService({ records: { ...f.records, async readMany(keys) {
      const batch = await f.records.readMany(keys); arrivals++;
      if (arrivals === 2) release(); await barrier; return batch;
    } }, now: () => CLAIM_FIXTURE_AT, eventId: () => 'unused-read-event' });
    const other = { ...f.ctx, projectId: 'other-project', materialReader: {
      ...f.ctx.materialReader, projectId: 'other-project',
    } };
    const results = await Promise.all([f.ctx, other].map(ctx => roles.resolveRoleBindingFacts(ctx, {
      roleBinding: f.roleBinding, declaredPermissions: { tools: [], writeScope: [] },
    })));
    for (const [index, result] of results.entries()) {
      expect(result.result).toMatchObject({ status: 'ready', value: { status: 'absent' } });
      expect(result.guards.length).toBeGreaterThan(0);
      expect(new Set(result.guards.map(guard => JSON.parse(guard.refKey).projectId)))
        .toEqual(new Set([index === 0 ? f.scope.projectId : 'other-project']));
    }
  } finally { await f.close(); }
});

it('directed and whole-plan queries share the same current-plan task fold', async () => {
  const f = await createTaskClaimFixture('memory', CONTROL_RECORD_SCHEMAS);
  try {
    // B-08(e): the old Run (Plan@1) ends through the public control owner.
    const oldClaim = await f.service.claimTask(f.ctx, await f.buildRequest({ requestId: 'fold-old-claim' }));
    expect(oldClaim).toMatchObject({ status: 'committed' });
    if (oldClaim.status !== 'committed') return;
    const endedRevision = await cancelUnentered(f, oldClaim.value.runRef);
    // The new Plan@2 is a public propose body + apply, not an in-place rewrite.
    const plan = f.plan;
    const draft: PlanRevisionDraft = {
      schemaVersion: 2, planId: `${plan.planId}-next-${String(plan.planRevision + 1)}`,
      planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
      stages: structuredClone(plan.stages), tasks: plan.tasks.map(task => ({ ...task })),
      assignments: [...(plan.assignments ?? [])].map(entry => ({ ...entry })),
      obligations: plan.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds],
        verificationRequirements: obligation.verificationRequirements.map(requirement => ({ ...requirement })) })),
      taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
      ...(plan.schemaVersion === 2 ? {
        taskRelations: [...(plan.taskRelations ?? [])].map(relation => ({ ...relation })),
        inputRequirements: [...(plan.inputRequirements ?? [])].map(requirement => ({ ...requirement })),
      } : {}),
    };
    const proposed = await f.plans.proposePlan(f.ctx, { input: {
      goalRef: f.goalRef, basedOn: plan.ref, draft,
      reason: { text: 'Move the Task to the current plan', sources: [], affectedTaskIds: [] },
    }, meta: { requestId: 'fold-propose-plan', expected: [await f.goalPin()] } });
    expect(proposed).toMatchObject({ status: 'committed' });
    if (proposed.status !== 'committed') return;
    const applied = await f.plans.applyPlanChange(f.ctx, { input: {
      proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
    }, meta: { requestId: 'fold-apply-plan', expected: [await f.goalPin()] } });
    expect(applied).toMatchObject({ status: 'committed' });
    if (applied.status !== 'committed') return;
    // The current Run: the public requeue, then a claim under the new Plan.
    const requeued = await requeueService(f).requeueTask(f.ctx, { input: {
      taskRef: f.tasks.first, afterRunRef: oldClaim.value.runRef, reason: 'the Task moved to the current plan',
    }, meta: { requestId: 'fold-requeue', expected: [
      await f.goalPin(), { ref: oldClaim.value.runRef, revision: endedRevision }] } });
    expect(requeued).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') return;
    const session = await f.createSession('fold-current-session');
    const base = await f.buildRequest({ requestId: 'fold-current-claim',
      input: { sessionRef: session, planRef: applied.value.ref } });
    const claimed = await f.service.claimTask(f.ctx, { ...base, input: { ...base.input,
      requeueRef: requeued.value.requeue.ref,
      ...(requeued.value.requeue.budget === null ? {} : { budget: requeued.value.requeue.budget }) } });
    expect(claimed).toMatchObject({ status: 'committed' });
    if (claimed.status !== 'committed') return;

    const { readCanonicalTaskFacts } = await import('../../src/core/work-graph/tasks/plan-readers.js');
    const whole = await readCanonicalTaskFacts(f.records, f.goalRef, applied.value);
    const directed = await readCanonicalTaskFacts(f.records, f.goalRef, applied.value, f.tasks.first.taskId);
    expect(whole.status).toBe('ready'); expect(directed.status).toBe('ready');
    if (whole.status !== 'ready' || directed.status !== 'ready') throw Error('task facts unavailable');
    expect(directed.value.byTaskId.get(f.tasks.first.taskId))
      .toEqual(whole.value.byTaskId.get(f.tasks.first.taskId));
    expect(directed.value.byTaskId.size).toBe(1);
    // Both recorded Runs are folded: the ended Plan@1 Run and the current Plan@2 Run.
    expect(whole.value.runsByTaskId.get(f.tasks.first.taskId)?.map(run => run.ref.runId).sort())
      .toEqual([oldClaim.value.runRef.runId, claimed.value.runRef.runId].sort());
  } finally { await f.close(); }
});

it('a missing matrix does not allow an unaccounted role pointer to become an absence guard', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const roles = createRoleConfigurationService({ records: { ...f.records, async readMany(keys) {
      const read = await f.records.readMany(keys); if (read.status !== 'ready') return read;
      return { ...read, value: { ...read.value,
        missing: read.value.missing.filter(key => JSON.parse(key).aggregateType !== 'ProjectRoleSpecActive'),
      } };
    } }, now: () => CLAIM_FIXTURE_AT, eventId: () => 'unused-read-event' });
    const facts = await roles.resolveRoleBindingFacts(f.ctx, {
      roleBinding: f.roleBinding, declaredPermissions: { tools: [], writeScope: [] },
    });
    expect(facts.result).toMatchObject({ status: 'rejected', code: 'unavailable' });
  } finally { await f.close(); }
});

it('malformed non-JSON request metadata rejects rather than throwing through the port', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const request = await f.buildRequest();
    Object.assign(request.meta.expected[0]!.ref, { malformed: 1n });
    await expect(f.service.claimTask(f.ctx, request)).resolves.toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(f.spy.commits).toBe(0);
  } finally { await f.close(); }
});

it('replay verifies the returned event cursor against the original receipt', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const request = await f.buildRequest();
    expect(await f.service.claimTask(f.ctx, request)).toMatchObject({ status: 'committed' });
    const { makeCommitCursor, seqOfCommitCursor } = await import('../../src/contracts/ledger.js');
    const service = f.makeService({ ...f.records, async eventAt(cursor) {
      const event = await f.records.eventAt(cursor); if (event.status !== 'ready') return event;
      return { ...event, value: { ...event.value, cursor: makeCommitCursor(seqOfCommitCursor(cursor) + 1) } };
    } });
    expect(await service.claimTask(f.ctx, request)).toMatchObject({ status: 'rejected', code: 'unavailable' });
  } finally { await f.close(); }
});

it('cyclic request/ref values reject at the JSON boundary without escaping the port', async () => {
  const f = await createTaskClaimFixture('memory');
  try {
    const request = await f.buildRequest();
    const pin = request.meta.expected[0]!.ref; Object.assign(pin, { self: pin });
    await expect(f.service.claimTask(f.ctx, request)).resolves.toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(f.spy.commits).toBe(0);
  } finally { await f.close(); }
});
