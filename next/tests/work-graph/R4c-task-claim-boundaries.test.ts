/** Astra's independent boundary checks, frozen before DSH implementation. */
import { afterEach, expect, it } from 'vitest';
import { createTaskClaimFixture, CLAIM_FIXTURE_AT, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { roleSpecContentDigest, type RoleSpecContentV1, type RoleSpecPinV1 } from '../../src/contracts/role-spec.js';
import { coordinationPolicyContentDigest, type CoordinationPolicyContentV1 } from '../../src/contracts/human-role-collaboration.js';
import { revisionAssignments } from '../../src/contracts/plan.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import { decodeDispatchOutboxEntry, taskClaimedEventFromEvent } from '../../src/core/work-graph/tasks/claim-record-codecs.js';

const fixtures: TaskClaimFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function open(kind: 'memory' | 'sqlite') {
  const fixture = await createTaskClaimFixture(kind); fixtures.push(fixture); return fixture;
}
const key = (ref: object) => canonicalJson(ref as JsonValue);
const encode = (snapshot: { ref: object; revision: number }): EncodedRecord => ({
  refKey: key(snapshot.ref), schemaId: `${(snapshot.ref as { aggregateType: string }).aggregateType}Snapshot@1`,
  revision: snapshot.revision, json: JSON.stringify(snapshot),
});
const content: RoleSpecContentV1 = { schemaVersion: 1, label: 'Builder', purpose: 'Implement assigned work',
  responsibility: ['execution'], requiredMaterials: [{ kind: 'contract', reason: 'Read when consumed' }],
  optionalMaterials: [], permissions: { tools: ['read'], writeScope: 'none' },
  budget: { source: 'task-budget', scope: 'assigned-task' },
  requiredOutputs: [{ kind: 'implementation-result', reason: 'Actual results' }],
  exit: { success: 'Accepted result', stop: 'Budget exhausted', handoff: 'Remaining work' } };
async function installRole(f: TaskClaimFixture): Promise<RoleSpecPinV1> {
  const actor = f.ctx.materialReader.kind === 'host' ? f.ctx.materialReader.actor : null;
  if (!actor) throw Error('host fixture required');
  const installed = await f.roleService.installRoleSpec(f.ctx, { commandId: 'install-claim-role',
    commandType: 'InstallRoleSpecRevision', schemaVersion: 1, correlationId: 'claim-role', submittedAt: CLAIM_FIXTURE_AT,
    identity: { projectId: f.scope.projectId, actor, idempotencyKey: 'install-claim-role' },
    payload: { roleId: 'builder', revision: 1, content, contentDigest: roleSpecContentDigest(content, 'builder', 1) } });
  if (installed.status !== 'committed') throw Error(JSON.stringify(installed));
  const pin = { ref: installed.revisionRef, digest: installed.contentDigest };
  expect(await f.roleService.activateRoleSpec(f.ctx, { commandId: 'activate-claim-role',
    commandType: 'ActivateRoleSpecRevision', schemaVersion: 1, correlationId: 'claim-role', submittedAt: CLAIM_FIXTURE_AT,
    identity: { projectId: f.scope.projectId, actor, idempotencyKey: 'activate-claim-role' },
    aggregateId: 'builder', expectedRevision: 1, payload: { target: pin },
  })).toMatchObject({ status: 'committed' });
  return pin;
}
async function seedMatrix(f: TaskClaimFixture, pin: RoleSpecPinV1) {
  const projectId = f.scope.projectId; const policyId = 'claim-role-policy';
  const policy: CoordinationPolicyContentV1 = { schemaVersion: 1,
    budget: { maxAutonomousReworks: 0, maxClarifications: 0 },
    allowed: { inScopeRework: false, inScopeTesting: true },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision', note: 'Host decides' },
    roles: { catalog: { builder: pin }, coordinator: { roleId: 'builder', note: 'Coordinate' } } };
  const ref = { aggregateType: 'CoordinationPolicyRevision', projectId, policyId, revision: 1 };
  expect(await f.commitRaw([
    encode({ ref, revision: 1, ...{ schemaVersion: 1, policyId, contentRevision: 1, content: policy,
      contentDigest: coordinationPolicyContentDigest(policy, policyId, 1), installedAt: CLAIM_FIXTURE_AT } }),
    encode({ ref: { aggregateType: 'ProjectCoordinationPolicyActive', projectId }, revision: 1,
      ...{ projectId, activeRevision: ref } }),
  ])).toMatchObject({ status: 'committed' });
}

it.each(['memory', 'sqlite'] as const)('%s: role_spec exact pin succeeds; a different digest cannot borrow it', async kind => {
  const f = await open(kind); const pin = await installRole(f); await seedMatrix(f, pin);
  const good = await f.createSession('role-good', { kind: 'role_spec', pin });
  const bad = await f.createSession('role-bad', { kind: 'role_spec', pin: { ...pin, digest: 'f'.repeat(64) } });
  const denied = await f.service.claimTask(f.ctx, await f.buildRequest({ input: { sessionRef: bad } }));
  expect(denied).toMatchObject({ status: 'rejected', code: 'forbidden' });
  expect(f.spy.commits).toBe(0);
  const result = await f.service.claimTask(f.ctx, await f.buildRequest({ input: { sessionRef: good } }));
  expect(result).toMatchObject({ status: 'committed' });
});

it.each(['memory', 'sqlite'] as const)('%s: no-matrix absence is guarded against installing a matrix before commit', async kind => {
  const f = await open(kind); const pin = await installRole(f);
  let attempted: import('../../src/core/record-store/ports.js').PreparedCommit | undefined;
  const service = f.makeService({ ...f.records, async commit(batch) {
    attempted = batch; await seedMatrix(f, pin); return f.records.commit(batch);
  } });
  expect(await service.claimTask(f.ctx, await f.buildRequest()))
    .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(attempted).toBeDefined();
  const fresh = attempted!.records.filter(record => JSON.parse(record.json).ref.aggregateType !== 'Session');
  expect(await f.records.readMany(fresh.map(record => record.refKey)))
    .toMatchObject({ status: 'ready', value: { records: [], missing: expect.arrayContaining(fresh.map(r => r.refKey)) } });
});

it('replays before deadline/current Session checks and never calls the clock on replay', async () => {
  const f = await open('memory'); let clock = CLAIM_FIXTURE_AT; let clockCalls = 0;
  const service = f.makeService(undefined, () => { clockCalls++; return clock; });
  const request = await f.buildRequest({ input: { budget: { tokenBudget: 100, deadline: '2026-09-24T01:00:00.000Z' } } });
  const accepted = await service.claimTask(f.ctx, request);
  expect(accepted.status).toBe('committed'); if (accepted.status !== 'committed') return;
  clock = '2026-09-25T00:00:00.000Z'; const count = clockCalls;
  await f.overwriteSession(f.sessions.first, record => ({ ...record, health: 'unavailable' }));
  expect(await service.claimTask(f.ctx, request)).toEqual({ ...accepted, replayed: true });
  expect(clockCalls).toBe(count);
});

it('a Run in an older Plan still prevents a fresh claim, without a second scan', async () => {
  const f = await open('memory'); const ref = await f.seedRun(f.tasks.first.taskId, 'ended');
  const read = await f.records.readMany([key(ref)]); if (read.status !== 'ready') throw Error('read failed');
  const row = read.value.records[0]!; const body = JSON.parse(row.json);
  body.revision++; body.planRef = { ...f.planRef, planId: 'old-accepted-plan' };
  expect(await f.commitRaw([{ ...row, revision: body.revision, json: JSON.stringify(body) }],
    [{ refKey: row.refKey, expectedRevision: row.revision }])).toMatchObject({ status: 'committed' });
  expect(await f.service.claimTask(f.ctx, await f.buildRequest()))
    .toMatchObject({ status: 'rejected', code: 'busy' });
  expect(f.spy.commits).toBe(0);
  expect(f.spy.lookups).toHaveLength(1);
});

it('cancellation during awaited reads retains the original signal and leaves no claim', async () => {
  const f = await open('memory'); const controller = new AbortController(); let aborted = false;
  const records = { ...f.records, async readMany(keys: readonly string[]) {
    const value = await f.records.readMany(keys);
    if (!aborted) { aborted = true; controller.abort(); }
    return value;
  } };
  const service = f.makeService(records); const request = await f.buildRequest();
  expect(await service.claimTask({ ...f.ctx, signal: controller.signal }, request))
    .toMatchObject({ status: 'rejected', code: 'cancelled' });
  expect(await f.sessionsPort.readSession(f.ctx, f.sessions.first))
    .toMatchObject({ status: 'ready', value: { record: { occupancy: null } } });
});

it('decoders reject individually valid but cross-linked refs, and replay rejects a foreign actor event', async () => {
  const f = await open('memory'); const request = await f.buildRequest();
  const result = await f.service.claimTask(f.ctx, request);
  expect(result.status).toBe('committed'); if (result.status !== 'committed') return;
  const read = await f.records.readMany([key(result.value.outboxRef)]);
  if (read.status !== 'ready') throw Error('outbox unavailable'); const row = read.value.records[0]!;
  for (const mutate of [
    (body: any) => { body.claim.runRef.goalId = 'other-goal'; },
    (body: any) => { body.claim.sessionRef.projectId = 'other-project'; },
    (body: any) => { body.claim.outboxRef.attemptId = 'other-attempt'; },
    (body: any) => { body.claim.generation++; },
  ]) {
    const body = JSON.parse(row.json); mutate(body);
    expect(decodeDispatchOutboxEntry({ ...row, json: JSON.stringify(body) }).status).toBe('invalid');
  }
  const original = await f.records.eventAt(result.cursor);
  if (original.status !== 'ready') throw Error('event unavailable');
  const body = JSON.parse(original.value.event.json); body.eventId = 'different-id';
  expect(taskClaimedEventFromEvent({ ...original.value.event, json: JSON.stringify(body) }).status).toBe('invalid');
  const service = f.makeService({ ...f.records, async eventAt(cursor) {
    const actual = await f.records.eventAt(cursor); if (actual.status !== 'ready') return actual;
    const body = JSON.parse(actual.value.event.json); body.actor.id = 'another-host';
    return { ...actual, value: { ...actual.value, event: { ...actual.value.event, json: JSON.stringify(body) } } };
  } });
  expect(await service.claimTask(f.ctx, request)).toMatchObject({ status: 'rejected', code: 'unavailable' });
});

it('uses the accepted-snapshot assignment fallback without treating empty as absent', () => {
  const assignment = { taskId: 'a', role: 'builder', instruction: 'Do A' };
  const origin = { assignments: [assignment] } as NonNullable<import('../../src/contracts/plan.js').PlanRevisionSnapshot['origin']>;
  expect(revisionAssignments({ origin })).toEqual([assignment]);
  expect(revisionAssignments({ assignments: [], origin })).toEqual([]);
});
