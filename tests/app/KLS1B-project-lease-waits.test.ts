/**
 * KLS-1b rows 07, 08 and 10: a live peer holds only project B's lease (A still
 * runs, B reads and refuses execution with `busy`), a wait registers the
 * project's own store head, and a project opened while the Host runs is usable
 * at once.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { acquireHostInstanceLease } from '../../src/app/host-instance-lease.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { waitFor } from '../scenarios/harness.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  hostProjectStoreDirectory, hostReconcile, openKLS1BTwoProjects,
  type KLS1BTwoProjects,
} from '../helpers/KLS1B-two-projects.js';

let fixture: KLS1BTwoProjects | undefined;

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
  await cleanupRestart();
});

const goalRef = (projectId: string, goalId: string) => ({ aggregateType: 'Goal' as const, projectId, goalId });
const phaseRef = (projectId: string, goalId: string) => ({ aggregateType: 'GoalPhase' as const, projectId, goalId });
const selectWorkForProject = (scope: CoreScope, goalId: string) => ({
  schemaVersion: 1 as const, goalRef: goalRef(scope.projectId, goalId), flowId: goalId,
  sessionHint: null, kind: 'select_work' as const,
});

describe('KLS-1b project lease, waits and a project opened while running', () => {
  it('07 keeps a live peer on B only: A runs, B reads and refuses execution with busy (SQLite only)', async () => {
    fixture = await openKLS1BTwoProjects({ backend: 'sqlite' });
    await fixture.close();
    const directory = await hostProjectStoreDirectory(fixture.B.projectId, fixture.rootB);
    const peer = await acquireHostInstanceLease({ directory, now: () => '2026-11-10T00:00:00.000Z' });
    expect(peer.lease).toBe('owned');
    try {
      await fixture.start();
      expect(hostReconcile(fixture.host, 'kls1b-a').lease).toBe('owned');
      expect(hostReconcile(fixture.host, fixture.B.projectId)).toMatchObject({ lease: 'held_by_other', report: null });

      const refused = await fixture.post(fixture.B, 'workflow/advance', plain(fixture.B, selectWorkForProject(fixture.B, 'kls1b-07')));
      expect(refused.body).toMatchObject({ status: 'rejected', code: 'busy' });
      const allowed = await fixture.post(fixture.A, 'workflow/advance', plain(fixture.A, selectWorkForProject(fixture.A, 'kls1b-07')));
      expect(allowed.body).not.toMatchObject({ code: 'busy' });
      const listB = await fixture.post(fixture.B, 'goals/list', plain(fixture.B, { workspace: fixture.B }));
      expect(listB.status).toBe(200);
    } finally {
      await peer.release();
    }
  }, 120_000);

  it('08 registers a wait at B’s own store head, not at A’s (memory)', async () => {
    fixture = await openKLS1BTwoProjects({ backend: 'memory' });
    for (let index = 1; index <= 100; index += 1) {
      const created = await fixture.createGoal(fixture.A, `kls1b-08-a-${index}`);
      expect(created.body.status).toBe('committed');
    }
    const created = await fixture.createGoal(fixture.B, 'kls1b-08');
    expect(created.body.status).toBe('committed');
    const goal = goalRef(fixture.B.projectId, 'kls1b-08');
    const phase = phaseRef(fixture.B.projectId, 'kls1b-08');
    const paused = await fixture.post(fixture.B, 'goals/control', graphWrite(fixture.B,
      { goalRef: goal, control: 'pause', reason: 'KLS-1b 08' }, 'kls1b-08-pause',
      [{ ref: goal, revision: 1 }, { ref: phase, revision: 0 }]));
    expect(paused.body.status).toBe('committed');
    const started = await fixture.post(fixture.B, 'workflow/driver-start', plain(fixture.B, {
      advance: selectWorkForProject(fixture.B, 'kls1b-08'), queryProfileIds: [],
    }));
    expect(started.body.status).toBe('ready');

    const read = () => fixture!.post(fixture!.B, 'workflow/driver-read', plain(fixture!.B, { goalRef: goal }));
    const parked = await waitFor(read, reply =>
      reply.body.status === 'ready' && reply.body.value.state === 'waiting_for_reply', 'KLS1B-08 parked');
    expect(parked.body.value.last.value.waitBasis.reasons).toEqual(['goal_state']);

    const resumed = await fixture.post(fixture.B, 'goals/control', graphWrite(fixture.B,
      { goalRef: goal, control: 'resume', reason: 'KLS-1b 08' }, 'kls1b-08-resume',
      [{ ref: goal, revision: 2 }, { ref: phase, revision: 0 }]));
    expect(resumed.body.status).toBe('committed');
    const woken = await waitFor(read, reply => reply.body.status === 'ready'
      && (reply.body.value.last?.value?.waitBasis?.reasons ?? []).includes('plan_adoption'), 'KLS1B-08 woken');
    expect(woken.body.value.state).toBe('waiting_for_reply');
    expect(woken.body.value.last.value.waitBasis.reasons).toEqual(['plan_adoption']);
  }, 180_000);

  it('10 a project opened while the Host runs is usable at once (memory)', async () => {
    fixture = await openKLS1BTwoProjects({ backend: 'memory' });
    const created = await fixture.createGoal(fixture.B, 'kls1b-10');
    expect(created.body.status).toBe('committed');
    const read = await fixture.post(fixture.B, 'goals/read', plain(fixture.B,
      { aggregateType: 'Goal', projectId: fixture.B.projectId, goalId: 'kls1b-10' }));
    expect(read.body.status).toBe('ready');
  }, 60_000);
});
