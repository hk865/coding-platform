/**
 * R4c.2c behavior acceptance for the SourceAuthority exact-fact reader.
 *
 * The test reuses the real TaskClaim fixture (real RecordStore registration,
 * real Workspace/Run/Plan facts and the real commit path) and the existing
 * material record reader/decoder. No fixture, reader or codec is copied here.
 * Fault injection wraps the real `readMany` or its authority boundary; no successful end-to-end
 * result is mocked, and the exact reads stay on the real backend.
 */
import { afterEach, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { ReviewWorkRef } from '../../src/contracts/reviewer-work.js';
import type { EncodedRecord, RecordBatchRead, StoreResult } from '../../src/core/record-store/ports.js';
import type { MaterialAuthorityReads, MaterialCanonicalRef } from '../../src/core/work-graph/materials/record-ports.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { SourceCanonicalRef } from '../../src/core/work-graph/source-authority-ports.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { CLAIM_FIXTURE_AT, createTaskClaimFixture, type ClaimFixtureKind, type Records, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

const openFixtures: TaskClaimFixture[] = [];
const READER_SCHEMAS = {
  records: [...QUERY_JOB_RECORD_SCHEMAS.records, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.records],
  events: [...QUERY_JOB_RECORD_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: [...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []), ...(PROJECT_BOOTSTRAP_RECORD_SCHEMAS.lookups ?? [])],
};
async function openFixture(kind: ClaimFixtureKind): Promise<TaskClaimFixture> {
  const fixture = await createTaskClaimFixture(kind, READER_SCHEMAS);
  openFixtures.push(fixture);
  return fixture;
}
afterEach(async () => {
  await Promise.allSettled(openFixtures.splice(0).map(fixture => fixture.close()));
});

const canonical = (value: unknown): string => canonicalJson(value as JsonValue);

/** Counts one delegation per `load`; the reader under test may delegate but
 * never scans, and unrelated stored facts must not add delegations. */
function readerFor(authority: MaterialAuthorityReads) {
  const delegated: MaterialCanonicalRef[] = [];
  const port: MaterialAuthorityReads = {
    async load(ref) { delegated.push(ref); return authority.load(ref); },
  };
  return { reads: createSourceAuthorityReader({ authority: port }), delegations: () => delegated.length };
}
function readerForRecords(records: Records) {
  const physicalReads: string[][] = [];
  const observed = interceptReadMany(records, async (keys, real) => {
    physicalReads.push([...keys]);
    return real();
  });
  return { ...readerFor(createMaterialRecordReaders(observed).authority), physicalReads };
}

/** Overrides only the real `readMany`; every other port method stays intact. */
function interceptReadMany(
  base: Records,
  hook: (refKeys: readonly string[], real: () => Promise<StoreResult<RecordBatchRead>>) => Promise<StoreResult<RecordBatchRead>>,
): Records {
  return { ...base, readMany: refKeys => hook(refKeys, () => base.readMany(refKeys)) };
}

let claimSequence = 0;
let querySequence = 0;

type RealRunOptions = { requestId?: string; goalRef?: GoalRef; planRef?: PlanRevisionRef;
  taskId?: string; sessionRef?: SessionRef; runId?: string };

/** One real claim through the formal TaskClaimPort. A fixed first id lets two
 * Goals hold the same local runId without writing a Run record by hand. */
async function realRun(fixture: TaskClaimFixture, options: RealRunOptions = {}): Promise<RunRef> {
  const fixed = options.runId;
  let calls = 0;
  const service = fixed === undefined ? fixture.service : createTaskClaimService({
    records: fixture.records,
    roles: createRoleConfigurationService({ records: fixture.records, now: () => CLAIM_FIXTURE_AT,
      eventId: () => `source-role-event-${++claimSequence}` }),
    now: () => CLAIM_FIXTURE_AT,
    newId: () => (calls++ === 0 ? fixed : `source-fixed-id-${++claimSequence}`),
  });
  const request = await fixture.buildRequest({
    requestId: options.requestId ?? `source-claim-${++claimSequence}`,
    input: {
      ...(options.goalRef === undefined ? {} : { goalRef: options.goalRef }),
      ...(options.planRef === undefined ? {} : { planRef: options.planRef }),
      ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
      ...(options.sessionRef === undefined ? {} : { sessionRef: options.sessionRef }),
    },
  });
  const claimed = await service.claimTask(fixture.ctx, request);
  if (claimed.status !== 'committed') throw new Error(`the real claim did not commit: ${JSON.stringify(claimed)} pins=${JSON.stringify(request.meta.expected)}`);
  return claimed.value.runRef;
}

/** A second real Goal and its accepted Plan through the public owners. */
async function goalAndPlan(fixture: TaskClaimFixture, goalId: string, planId: string):
Promise<{ goalRef: GoalRef; planRef: PlanRevisionRef }> {
  const created = await fixture.goals.createGoal(fixture.ctx, {
    meta: { requestId: `source-goal-${goalId}`,
      expected: [{ ref: fixture.projectRef, revision: 1 }, { ref: fixture.workspaceRef, revision: 1 }] },
    input: { goalId, workspace: fixture.scope, objective: `Source authority Goal ${goalId}` },
  });
  if (created.status !== 'committed') throw new Error(`the second Goal did not commit: ${JSON.stringify(created)}`);
  const plan = fixture.plan;
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId, planRevision: 1, goalId,
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
  const proposed = await fixture.plans.proposePlan(fixture.ctx, {
    meta: { requestId: `source-propose-${planId}`, expected: [{ ref: created.value.ref, revision: 1 }] },
    input: { goalRef: created.value.ref, basedOn: null, draft,
      reason: { text: `Source authority plan ${planId}`, sources: [] } },
  });
  if (proposed.status !== 'committed') throw new Error(`the second Plan proposal did not commit: ${JSON.stringify(proposed)}`);
  const applied = await fixture.plans.applyPlanChange(fixture.ctx, {
    meta: { requestId: `source-apply-${planId}`, expected: [{ ref: created.value.ref, revision: 1 }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
  });
  if (applied.status !== 'committed') throw new Error(`the second Plan adoption did not commit: ${JSON.stringify(applied)}`);
  return { goalRef: created.value.ref, planRef: applied.value.ref };
}

/** A real Goal with no adopted Plan: the current initial-coordination Query shape. */
async function bareGoal(fixture: TaskClaimFixture, goalId: string, ctx: CoreCallContext = fixture.ctx,
  scope: WorkspaceScope = fixture.scope): Promise<GoalRef> {
  const workspaceRef = { aggregateType: 'Workspace' as const, ...scope };
  const created = await fixture.goals.createGoal(ctx, {
    meta: { requestId: `source-query-goal-${goalId}`,
      expected: [{ ref: fixture.projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId, workspace: scope, objective: `Source authority Query Goal ${goalId}` },
  });
  if (created.status !== 'committed') throw new Error(`the Query Goal did not commit: ${JSON.stringify(created)}`);
  return created.value.ref;
}

/** A second real Workspace in the same Project, plus its first Goal. */
async function secondWorkspace(fixture: TaskClaimFixture):
Promise<{ scope: WorkspaceScope; ctx: CoreCallContext; goalRef: GoalRef }> {
  const scope: WorkspaceScope = { projectId: fixture.scope.projectId,
    workspaceId: `${fixture.scope.workspaceId}-other` };
  const workspaceRef = { aggregateType: 'Workspace' as const, ...scope };
  const principal = fixture.ctx.principal;
  if (principal.kind !== 'host') throw new Error('the claim fixture must run as a Host actor');
  const ctx: CoreCallContext = { ...fixture.ctx, workspaceId: scope.workspaceId,
    materialReader: { kind: 'host', ...scope, actor: principal.actor } };
  let sequence = 0;
  const bootstrap = createProjectBootstrapServices({ records: fixture.records, now: () => CLAIM_FIXTURE_AT,
    eventId: () => `source-bootstrap-event-${++sequence}` });
  const registered = await bootstrap.projects.registerWorkspace(ctx, {
    input: { workspace: scope },
    meta: { requestId: 'source-register-other-workspace',
      expected: [{ ref: fixture.projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] },
  });
  if (registered.status !== 'committed') throw new Error(`the second Workspace did not commit: ${JSON.stringify(registered)}`);
  const created = await fixture.goals.createGoal(ctx, {
    meta: { requestId: 'source-goal-other-workspace',
      expected: [{ ref: fixture.projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { goalId: 'source-other-workspace-goal', workspace: scope,
      objective: 'Source authority in another workspace' },
  });
  if (created.status !== 'committed') throw new Error(`the other-workspace Goal did not commit: ${JSON.stringify(created)}`);
  return { scope, ctx, goalRef: created.value.ref };
}

type RealQueryOptions = { ctx?: CoreCallContext; scope?: WorkspaceScope; goalRef?: GoalRef;
  queryJobId?: string; runId?: string };

/** One real Query submit through `submitQueryJob`, which writes both records. */
async function realQueryRun(fixture: TaskClaimFixture, options: RealQueryOptions = {}): Promise<QueryRunRef> {
  const ctx = options.ctx ?? fixture.ctx;
  const scope = options.scope ?? fixture.scope;
  const goalRef = options.goalRef ?? await bareGoal(fixture, `source-query-goal-${++querySequence}`, ctx, scope);
  const queryJobId = options.queryJobId ?? `source-query-${++querySequence}`;
  const runId = options.runId ?? `source-query-run-${++querySequence}`;
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...scope, queryJobId };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...scope, queryJobId, runId };
  const goalRead = await fixture.plans.queryGoal(ctx, goalRef);
  if (goalRead.status !== 'ready') throw new Error(`the Query Goal read failed: ${JSON.stringify(goalRead)}`);
  const intent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: queryJobId, projectId: scope.projectId, workspaceId: scope.workspaceId,
    goalId: goalRef.goalId, question: `Source authority query ${queryJobId}`, focusTaskRefs: [],
    budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: queryJobId,
    execution: { kind: 'initial_coordination', roleBinding: fixture.roleBinding,
      runtimeBudget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
        maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 } },
  };
  let sequence = 0;
  const jobs = createQueryJobService({ records: fixture.records, now: () => CLAIM_FIXTURE_AT,
    eventId: () => `source-query-event-${++sequence}` });
  const submitted = await jobs.submitQueryJob(ctx, { input: { queryJobId, runId, intent },
    meta: { requestId: `source-query-submit-${++querySequence}`, expected: [
      { ref: fixture.projectRef, revision: 1 },
      { ref: { aggregateType: 'Workspace', ...scope }, revision: 1 },
      { ref: goalRef, revision: goalRead.value.goal.revision },
      { ref: queryJobRef, revision: 0 },
      { ref: queryRunRef, revision: 0 },
    ] } });
  if (submitted.status !== 'committed') throw new Error(`the real Query submit did not commit: ${JSON.stringify(submitted)}`);
  return submitted.value.run.ref;
}

it.each(['memory', 'sqlite'] as const)('%s: loads the exact Workspace/Run/QueryRun facts through one authority read each', async kind => {
  const fixture = await openFixture(kind);
  const run = await realRun(fixture, { requestId: 'exact-run' });
  const queryRun = await realQueryRun(fixture, { queryJobId: 'exact-query', runId: 'exact-query-run' });
  const { reads, delegations, physicalReads } = readerForRecords(fixture.records);

  await expect(reads.load(fixture.workspaceRef)).resolves.toMatchObject({ status: 'found', snapshot: { ref: fixture.workspaceRef } });
  await expect(reads.load(run)).resolves.toMatchObject({ status: 'found', snapshot: { ref: run } });
  await expect(reads.load(queryRun)).resolves.toMatchObject({ status: 'found', snapshot: { ref: queryRun } });
  expect(delegations()).toBe(3);
  expect(physicalReads).toEqual([[canonical(fixture.workspaceRef)], [canonical(run)], [canonical(queryRun)]]);
});

it.each(['memory', 'sqlite'] as const)('%s: a found result matches the full ref, not a same local id in another scope', async kind => {
  const fixture = await openFixture(kind);
  const here = await realRun(fixture, { requestId: 'shared-run', runId: 'shared-run' });
  // Two real Goals, two real Plans; the same local runId lives in both.
  const second = await goalAndPlan(fixture, 'shared-goal', 'shared-plan');
  const otherGoal = await realRun(fixture, { requestId: 'shared-run-other', runId: 'shared-run',
    goalRef: second.goalRef, planRef: second.planRef, taskId: fixture.tasks.first.taskId,
    sessionRef: fixture.sessions.second });
  // RunRef has no workspaceId: the same runId in another goal must stay a distinct fact.
  const queryHere = await realQueryRun(fixture, { queryJobId: 'shared-query', runId: 'shared-query-run' });
  const otherWorkspace = await secondWorkspace(fixture);
  const queryElsewhere = await realQueryRun(fixture, { ctx: otherWorkspace.ctx, scope: otherWorkspace.scope,
    goalRef: otherWorkspace.goalRef, queryJobId: 'shared-query', runId: 'shared-query-run' });
  const { reads } = readerForRecords(fixture.records);

  const loaded = await reads.load(here);
  expect(loaded).toMatchObject({ status: 'found', snapshot: { ref: here, task: { goalId: here.goalId } } });
  if (loaded.status !== 'found') return;
  expect(loaded.snapshot.ref).toEqual(here);
  await expect(reads.load(otherGoal)).resolves.toMatchObject({ status: 'found', snapshot: { ref: otherGoal } });
  await expect(reads.load(queryHere)).resolves.toMatchObject({ status: 'found', snapshot: { ref: queryHere } });
  await expect(reads.load(queryElsewhere)).resolves.toMatchObject({ status: 'found', snapshot: { ref: queryElsewhere } });
});

it.each(['memory', 'sqlite'] as const)('%s: a genuinely absent exact ref stays not_found', async kind => {
  const fixture = await openFixture(kind);
  const { reads } = readerForRecords(fixture.records);
  const absent: RunRef = { aggregateType: 'Run', projectId: fixture.scope.projectId, goalId: fixture.goalRef.goalId, runId: 'absent-run' };
  await expect(reads.load(absent)).resolves.toMatchObject({ status: 'not_found', ref: absent });
});

it('ReviewWork and QueryJob have no provider here: unsupported with zero delegation', async () => {
  const fixture = await openFixture('memory');
  const { reads, delegations, physicalReads } = readerForRecords(fixture.records);
  const review: ReviewWorkRef = { aggregateType: 'ReviewWork', projectId: fixture.scope.projectId,
    workspaceId: fixture.scope.workspaceId, goalId: fixture.goalRef.goalId, reviewId: 'review-1' };
  const job: QueryJobRef = { aggregateType: 'QueryJob', projectId: fixture.scope.projectId,
    workspaceId: fixture.scope.workspaceId, queryJobId: 'query-1' };
  await expect(reads.load(review)).resolves.toMatchObject({ status: 'unsupported' });
  await expect(reads.load(job)).resolves.toMatchObject({ status: 'unsupported' });
  expect(delegations()).toBe(0);
  expect(physicalReads).toEqual([]);
});

const faultCases: { label: string; wrap: (records: Records) => Records }[] = [
  { label: 'a thrown RecordStore error', wrap: records => interceptReadMany(records, async () => { throw Error('injected store failure'); }) },
  { label: 'an unaccounted request key', wrap: records => interceptReadMany(records,
    async () => ({ status: 'ready', value: { records: [], missing: [], readThrough: null } })) },
  { label: 'a rejected unreadable record', wrap: records => interceptReadMany(records,
    async () => ({ status: 'rejected', code: 'corrupt', reason: 'injected unreadable record' })) },
  { label: 'a damaged record body', wrap: records => interceptReadMany(records,
    async refKeys => ({ status: 'ready', value: { records: [{ refKey: refKeys[0]!, schemaId: 'RunSnapshot@1',
      revision: 1, json: '{ not json' }], missing: [], readThrough: null } })) },
];

for (const kind of ['memory', 'sqlite'] as const) {
  for (const fault of faultCases) {
    it(`${kind}: ${fault.label} stays unavailable`, async () => {
      const fixture = await openFixture(kind);
      const run = await realRun(fixture, { requestId: `fault-run-${fault.label}` });
      const { reads } = readerForRecords(fault.wrap(fixture.records));
      await expect(reads.load(run)).resolves.toMatchObject({ status: 'unavailable' });
    });
  }
}

it('a direct authority provider throw becomes unavailable after a real backend read', async () => {
  const fixture = await openFixture('sqlite');
  const run = await realRun(fixture, { requestId: 'provider-throw-run' });
  const authority = createMaterialRecordReaders(fixture.records).authority;
  let providerCalls = 0;
  let actualStatus: string | undefined;
  const { reads } = readerFor({
    async load(ref) {
      providerCalls += 1;
      const actual = await authority.load(ref);
      actualStatus = actual.status;
      // This exception is outside MaterialAuthority's readMany catch.
      throw Error('injected authority provider failure');
    },
  });
  await expect(reads.load(run)).resolves.toMatchObject({ status: 'unavailable' });
  expect(providerCalls).toBe(1);
  expect(actualStatus).toBe('found');
});

it.each(['memory', 'sqlite'] as const)('%s: fixes the caller ref before its first await and returns an isolated copy', async kind => {
  const fixture = await openFixture(kind);
  const run = await realRun(fixture, { requestId: 'copy-run' });
  const authority = createMaterialRecordReaders(fixture.records).authority;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const { reads } = readerFor({ async load(ref) { await waiting; return authority.load(ref); } });

  const mutable: RunRef = { ...run };
  const pending = reads.load(mutable);
  mutable.runId = 'mutated-after-call';
  release();
  const loaded = await pending;
  expect(loaded).toMatchObject({ status: 'found', snapshot: { ref: run } });
  if (loaded.status !== 'found') return;
  (loaded.snapshot as RunSnapshot).task.taskId = 'tampered-return';
  await expect(reads.load(run)).resolves.toMatchObject({ status: 'found', snapshot: { task: { taskId: fixture.tasks.first.taskId } } });
});

it.each(['memory', 'sqlite'] as const)('%s: not_found retains the original complete ref after caller mutation', async kind => {
  const fixture = await openFixture(kind);
  const { reads, physicalReads } = readerForRecords(fixture.records);
  const original: RunRef = { aggregateType: 'Run', projectId: fixture.scope.projectId,
    goalId: fixture.goalRef.goalId, runId: 'missing-before-mutation' };
  const mutable = { ...original };
  const pending = reads.load(mutable);
  mutable.goalId = 'changed-goal';
  mutable.runId = 'changed-run';
  await expect(pending).resolves.toEqual({ status: 'not_found', ref: original });
  expect(physicalReads).toEqual([[canonical(original)]]);
});

it.each(['memory', 'sqlite'] as const)('%s: adding unrelated facts adds no read to an exact load', async kind => {
  const fixture = await openFixture(kind);
  const run = await realRun(fixture, { requestId: 'count-run' });
  const { reads, delegations, physicalReads } = readerForRecords(fixture.records);

  const before = delegations();
  await reads.load(run);
  const afterFirst = delegations();
  await realRun(fixture, { requestId: 'unrelated-run', taskId: fixture.tasks.second.taskId,
    sessionRef: fixture.sessions.second });
  await realQueryRun(fixture, { queryJobId: 'unrelated-query', runId: 'unrelated-query-run' });
  await reads.load(run);
  const afterSecond = delegations();
  expect(afterFirst - before).toBe(1);
  expect(afterSecond - afterFirst).toBe(1);
  expect(physicalReads).toEqual([[canonical(run)], [canonical(run)]]);
});

it('a non-serializable ref is unavailable, never another fact', async () => {
  const fixture = await openFixture('memory');
  const run = await realRun(fixture, { requestId: 'legal-run-nonserializable' });
  const { reads } = readerForRecords(fixture.records);
  const nonSerializable = { ...run, extra: Number.NaN } as unknown as SourceCanonicalRef;
  await expect(reads.load(nonSerializable)).resolves.toMatchObject({ status: 'unavailable' });
});

it('an illegal ref member type is unavailable, never another fact', async () => {
  const fixture = await openFixture('memory');
  const run = await realRun(fixture, { requestId: 'legal-run-illegal-member' });
  const { reads } = readerForRecords(fixture.records);
  const illegalMember = { ...run, runId: 42 } as unknown as SourceCanonicalRef;
  const illegal = await reads.load(illegalMember);
  expect(illegal).not.toMatchObject({ status: 'found' });
  expect(illegal).toMatchObject({ status: 'unavailable' });
});
