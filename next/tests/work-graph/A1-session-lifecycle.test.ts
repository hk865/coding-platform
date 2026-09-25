/**
 * A1 Session lifecycle behavior tests (skeleton phase).
 *
 * Every link/archive/reactivate result is produced by the formal new service;
 * tests never seed a successful lifecycle record to prove the operation. Real
 * Memory/SQLite stores, the real Session directory and the real formal catalog
 * are used. The skeleton returns `unsupported`, so these tests fail RED with
 * that reason until the implementation phase begins.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkLinkRelation, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { randomUUID } from 'node:crypto';
import {
  createGraphSessionFixture, GRAPH_MODULE_ONE, GRAPH_MODULE_TWO, linkRequest, lifecycleRequest, commitBarrier,
  type GraphSessionFixture,
} from '../helpers/graph-session-fixture.js';

const fixtures: GraphSessionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function make(kind: 'memory' | 'sqlite'): Promise<GraphSessionFixture> {
  const fixture = await createGraphSessionFixture(kind);
  fixtures.push(fixture);
  return fixture;
}
function moduleTarget(fixture: GraphSessionFixture, moduleId: string): WorkLinkTarget {
  return { kind: 'module', ref: fixture.moduleRef(moduleId) };
}

describe.each(['memory', 'sqlite'] as const)('A1 Session lifecycle over real %s RecordStore', kind => {
  it('activates, closes and reopens a Module link while preserving original replay and input identity', async () => {
    const fixture = await make(kind);
    const adopted = await fixture.adopt('adopt-link');
    expect(adopted.status).toBe('committed');
    const session = await fixture.createSession('link-module');
    const target = moduleTarget(fixture, GRAPH_MODULE_ONE);

    const openRequest = await linkRequest(fixture, session, target, 'responsible', true, 'link-open');
    const opened = await fixture.lifecycle.linkSessionWork(fixture.ctx, openRequest);
    expect(opened.status).toBe('committed');
    if (opened.status !== 'committed') return;
    expect(opened.value.until).toBeNull();

    const closed = await fixture.lifecycle.linkSessionWork(fixture.ctx, await linkRequest(fixture, session, target, 'responsible', false, 'link-close'));
    expect(closed.status).toBe('committed');
    if (closed.status !== 'committed') return;
    expect(closed.value.until).not.toBeNull();
    expect(closed.value.since).toEqual(opened.value.since);

    const reopened = await fixture.lifecycle.linkSessionWork(fixture.ctx, await linkRequest(fixture, session, target, 'responsible', true, 'link-reopen'));
    expect(reopened.status).toBe('committed');
    if (reopened.status !== 'committed') return;
    expect(reopened.value.until).toBeNull();

    const card = await fixture.sessionsPort.readSession(fixture.ctx, session);
    expect(card.status).toBe('ready');
    if (card.status !== 'ready') return;
    expect(card.value.links).toHaveLength(1);
    expect(reopened.value.revision).toBe(opened.value.revision + 2);
    expect(reopened.value.since).toBe(reopened.cursor);
    expect(reopened.value.since).not.toBe(opened.value.since);
    // The original result is event-backed, even after close/reopen changed the
    // current record. Record count must not grow per historical interval.
    const replay = await fixture.lifecycle.linkSessionWork(fixture.ctx, openRequest);
    expect(replay).toEqual({ ...opened, replayed: true });
    const conflict = await fixture.lifecycle.linkSessionWork(fixture.ctx,
      { ...openRequest, input: { ...openRequest.input, active: false } });
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });

  it('links a Task target only through the real accepted Goal/Plan membership', async () => {
    const fixture = await make(kind);
    const { taskRef } = await fixture.seedAcceptedTask();
    const session = await fixture.createSession('link-task');
    const linked = await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, { kind: 'task', ref: taskRef }, 'responsible', true, 'link-task-open'));
    expect(linked.status).toBe('committed');
    const missing = await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, { kind: 'task', ref: { ...taskRef, taskId: 'not-in-plan' } }, 'responsible', true, 'link-task-missing'));
    expect(missing).toMatchObject({ status: 'rejected', code: 'not_found' });
  });

  it('does not write an unknown Module target', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-unknown-module');
    const session = await fixture.createSession('unknown-module');
    const result = await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, moduleTarget(fixture, 'not-in-catalog'), 'responsible', true, 'link-unknown'));
    expect(result).toMatchObject({ status: 'rejected', code: 'not_found' });
    const card = await fixture.sessionsPort.readSession(fixture.ctx, session);
    expect(card.status).toBe('ready');
    if (card.status === 'ready') expect(card.value.links.filter(link => link.until === null)).toHaveLength(0);
  });

  it('rejects a Module target from another project scope', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-cross-scope');
    const session = await fixture.createSession('cross-scope');
    const foreign: WorkLinkTarget = { kind: 'module', ref: { projectId: 'other-project', moduleId: GRAPH_MODULE_ONE } };
    const result = await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, foreign, 'responsible', true, 'link-cross-scope'));
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.code).toBe('forbidden');
  });

  it('refuses to follow a digest-inconsistent catalog record', async () => {
    const fixture = await make(kind);
    await fixture.seedTamperedArchitectureBaseline();
    const session = await fixture.createSession('tampered-catalog');
    const result = await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, moduleTarget(fixture, GRAPH_MODULE_ONE), 'responsible', true, 'link-tampered'));
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.code).toBe('unavailable');
  });

  it('keeps WorkContext unsupported instead of writing a fabricated association', async () => {
    const fixture = await make(kind);
    const session = await fixture.createSession('work-context');
    const work: WorkLinkTarget = { kind: 'work', ref: { aggregateType: 'WorkContextBinding',
      projectId: fixture.projectId, workspaceId: fixture.workspaceId, workId: 'work-1' } };
    const result = await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, work, 'responsible', true, 'link-work'));
    expect(result).toMatchObject({ status: 'rejected', code: 'unsupported' });
  });

  it('archive rejects occupancy and an unresolved responsible Task obligation', async () => {
    const fixture = await make(kind);
    const { taskRef } = await fixture.seedAcceptedTask();
    const session = await fixture.createSession('archive-guard');
    const runRef: RunRef = { aggregateType: 'Run', projectId: fixture.projectId, goalId: taskRef.goalId, runId: 'run-1' };
    await fixture.overwriteSession(session, (record: SessionRecord): SessionRecord => ({ ...record,
      occupancy: { kind: 'execution', executionRef: runRef, generation: record.revision } }));
    const busy = await fixture.lifecycle.archiveSession(fixture.ctx, await lifecycleRequest(fixture, session, 'archive-busy'));
    expect(busy).toMatchObject({ status: 'rejected', code: 'busy' });

    await fixture.overwriteSession(session, (record: SessionRecord): SessionRecord => ({ ...record, occupancy: null }));
    const responsible = await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, { kind: 'task', ref: taskRef }, 'responsible', true, 'link-responsible'));
    expect(responsible.status).toBe('committed');
    const blocked = await fixture.lifecycle.archiveSession(fixture.ctx, await lifecycleRequest(fixture, session, 'archive-blocked'));
    expect(blocked.status).toBe('rejected');
    if (blocked.status === 'rejected') expect(['dependency_blocked', 'busy', 'revision_conflict']).toContain(blocked.code);

    await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, { kind: 'task', ref: taskRef }, 'responsible', false, 'close-responsible'));
    const archived = await fixture.lifecycle.archiveSession(fixture.ctx, await lifecycleRequest(fixture, session, 'archive-ok'));
    expect(archived.status).toBe('committed');
    if (archived.status === 'committed') expect(archived.value.lifecycle).toBe('archived');
  });

  it('archives and reactivates an idle Module-bound Session without touching health or history', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-archive-idle');
    const session = await fixture.createSession('idle-module');
    await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, moduleTarget(fixture, GRAPH_MODULE_ONE), 'responsible', true, 'idle-link'));

    const before = await fixture.sessionsPort.readSession(fixture.ctx, session);
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') return;
    const healthBefore = before.value.record.health;
    const cursorBefore = before.value.record.historyCursor;

    const archived = await fixture.lifecycle.archiveSession(fixture.ctx, await lifecycleRequest(fixture, session, 'idle-archive'));
    expect(archived.status).toBe('committed');
    if (archived.status !== 'committed') return;
    expect(archived.value.lifecycle).toBe('archived');
    expect(archived.value.health).toBe(healthBefore);
    expect(archived.value.historyCursor).toBe(cursorBefore);
    expect(archived.value.archivedAt).not.toBeNull();
    // The module relation is history, not unfinished work: it is retained.
    expect(archived.value.occupancy).toBeNull();
    const retained = await fixture.sessionsPort.readSession(fixture.ctx, session);
    expect(retained.status).toBe('ready');
    if (retained.status === 'ready') {
      expect(retained.value.links.some(entry => entry.ref.target.kind === 'module' && entry.until === null)).toBe(true);
    }

    const hidden = await fixture.sessionsPort.findSessions(fixture.ctx,
      { workspace: fixture.scope, includeArchived: false, page: { limit: 10 } });
    expect(hidden.status).toBe('ready');
    if (hidden.status === 'ready') expect(hidden.value.items.map(card => card.record.ref.sessionId)).not.toContain(session.sessionId);
    const history = await fixture.sessionsPort.readSession(fixture.ctx, session);
    expect(history.status).toBe('ready');

    const reactivated = await fixture.lifecycle.reactivateSession(fixture.ctx,
      await lifecycleRequest(fixture, session, 'idle-reactivate', 'work resumed'));
    expect(reactivated.status).toBe('committed');
    if (reactivated.status !== 'committed') return;
    expect(reactivated.value.lifecycle).toBe('active');
    expect(reactivated.value.archivedAt).toBeNull();
    expect(reactivated.value.health).toBe(healthBefore);
    expect(reactivated.value.occupancy).toBeNull();
    const visibleAgain = await fixture.sessionsPort.findSessions(fixture.ctx,
      { workspace: fixture.scope, includeArchived: false, page: { limit: 10 } });
    expect(visibleAgain.status).toBe('ready');
    if (visibleAgain.status === 'ready') expect(visibleAgain.value.items.map(card => card.record.ref.sessionId)).toContain(session.sessionId);
  });

  it('serializes a competing link/archive pair to exactly one success', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-compete');
    const session = await fixture.createSession('compete');
    const target = moduleTarget(fixture, GRAPH_MODULE_TWO);
    const linkInput = await linkRequest(fixture, session, target, 'investigated', true, 'compete-link');
    const archiveInput = await lifecycleRequest(fixture, session, 'compete-archive');
    const barrier = commitBarrier(fixture.records);
    const service = createSessionLifecycleService({ records: barrier.records, lookups: barrier.records });
    const [link, archive] = await Promise.all([
      barrier.run(() => service.linkSessionWork(fixture.ctx, linkInput)),
      barrier.run(() => service.archiveSession(fixture.ctx, archiveInput)),
    ]);
    expect(barrier.arrivals).toBe(2);
    expect([link, archive].filter(result => result.status === 'committed')).toHaveLength(1);
    expect([link, archive].filter(result => result.status === 'rejected')).toHaveLength(1);
  });

  it('never half-writes a failed link', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-half-write');
    const session = await fixture.createSession('half-write');
    const before = await fixture.sessionsPort.readSession(fixture.ctx, session);
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') return;
    const request = await linkRequest(fixture, session, moduleTarget(fixture, GRAPH_MODULE_ONE), 'responsible', true, 'half-write-request');
    const horizon = await fixture.records.readMany([]);
    fixture.resetSpy();
    fixture.failNextWrite();
    const failed = await fixture.lifecycle.linkSessionWork(fixture.ctx, request);
    expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(fixture.injectedFailures).toBe(1);
    expect(fixture.spy.prepared).toHaveLength(1);
    const after = await fixture.sessionsPort.readSession(fixture.ctx, session);
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    expect(after.value.record.revision).toBe(before.value.record.revision);
    expect(after.value.links).toHaveLength(before.value.links.length);
    expect(await fixture.records.readMany([])).toEqual(horizon);
    const batch = fixture.spy.prepared[0]!;
    expect(await fixture.records.lookupCommit({ identityKey: batch.identityKey, fingerprint: batch.fingerprint }))
      .toMatchObject({ status: 'rejected', code: 'not_found' });
    const retry = await fixture.lifecycle.linkSessionWork(fixture.ctx, request);
    expect(retry).toMatchObject({ status: 'committed', replayed: false });
  });

  it('coordinates archive with the existing real Task claim through Session CAS', async () => {
    const f = await make(kind);
    const task = await f.seedAcceptedTask();
    const sessionRef = await f.createSession('claim-race');
    const archive = await lifecycleRequest(f, sessionRef, 'race-archive');
    const barrier = commitBarrier(f.records);
    const service = createSessionLifecycleService({ records: barrier.records, lookups: barrier.records });
    const roles = createRoleConfigurationService({ records: barrier.records,
      now: () => '2026-09-25T00:00:00.000Z', eventId: randomUUID });
    const claims = createTaskClaimService({ records: barrier.records, roles,
      now: () => '2026-09-25T00:00:00.000Z', newId: randomUUID });
    const claim = { input: { goalRef: task.goalRef, planRef: task.planRef, taskId: task.taskRef.taskId, sessionRef,
      roleBinding: { schemaVersion: 1 as const, bindingId: 'a1-binding', templateId: 'builder', templateRevision: '1',
        bindingVersion: 1, policyRevision: 'legacy-template' }, budget: { tokenBudget: 100000, deadline: null } },
      meta: { requestId: 'race-claim', expected: [...archive.meta.expected,
        { ref: task.goalRef, revision: 2 }, { ref: f.workspaceRef, revision: 1 }] } };
    const results = await Promise.all([
      barrier.run(() => service.archiveSession(f.ctx, archive)),
      barrier.run(() => claims.claimTask(f.ctx, claim)),
    ]);
    expect(barrier.arrivals).toBe(2);
    expect(results.filter(r => r.status === 'committed')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const read = await f.sessionsPort.readSession(f.ctx, sessionRef);
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.record.lifecycle === 'archived' && read.value.record.occupancy !== null).toBe(false);
    if (results[0]!.status === 'committed') {
      const failedClaim = f.spy.prepared.find(batch => batch.records.some(row => JSON.parse(row.refKey).aggregateType === 'Run'));
      expect(failedClaim).toBeDefined();
      const freshKeys = failedClaim!.records.filter(row => JSON.parse(row.refKey).aggregateType !== 'Session').map(row => row.refKey);
      expect(await f.records.readMany(freshKeys)).toMatchObject({ status: 'ready', value: { records: [] } });
    }
  });

  it('replays archive after reactivation without changing current lifecycle or health', async () => {
    const f = await make(kind);
    const session = await f.createSession('archive-replay');
    const request = await lifecycleRequest(f, session, 'archive-replay');
    const original = await f.lifecycle.archiveSession(f.ctx, request);
    expect(original.status).toBe('committed');
    expect(await f.lifecycle.reactivateSession(f.ctx, await lifecycleRequest(f, session, 'reactivate-replay')))
      .toMatchObject({ status: 'committed' });
    const before = await f.sessionsPort.readSession(f.ctx, session);
    expect(await f.lifecycle.archiveSession(f.ctx, request)).toEqual({ ...original, replayed: true });
    expect(await f.sessionsPort.readSession(f.ctx, session)).toEqual(before);
  });

  it('copies lifecycle requests before awaiting a Store read', async () => {
    const f = await make(kind);
    await f.adopt('adopt-input-isolation');
    const session = await f.createSession('input-isolation');
    const request = await linkRequest(f, session, moduleTarget(f, GRAPH_MODULE_ONE), 'responsible', true, 'owned-input');
    const original = structuredClone(request);
    let mutated = false;
    const mutate = () => { if (!mutated) { mutated = true; request.input.active = false;
      request.input.target = moduleTarget(f, 'not-in-catalog'); } };
    const records = { ...f.records,
      async lookupCommit(input: Parameters<typeof f.records.lookupCommit>[0]) { mutate(); return f.records.lookupCommit(input); },
      async readMany(keys: readonly string[]) { mutate(); return f.records.readMany(keys); } };
    const service = createSessionLifecycleService({ records, lookups: records });
    const result = await service.linkSessionWork(f.ctx, request);
    expect(mutated).toBe(true);
    expect(result).toMatchObject({ status: 'committed', value: { ref: { target: original.input.target }, until: null } });
  });
});
