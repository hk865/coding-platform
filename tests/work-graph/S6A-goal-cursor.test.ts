/**
 * A created Goal reads back
 * with its creation cursor, unchanged by a desired-state change and a plan
 * adoption, and a replay returns the same cursor. Public Host routes on memory
 * and SQLite; every expected cursor is the create result's own.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import {
  openS6ARequestWorld, S6A_SCOPE,
  type S6ABackend, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { seedS6AMemory } from '../helpers/S6A-memory-fixture.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';

const worlds: S6ARequestWorld[] = [];

async function openGoalWorld(backend: S6ABackend): Promise<S6ARequestWorld> {
  const world = await openS6ARequestWorld({ backend });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  const openWorlds = worlds.splice(0);
  await Promise.all(openWorlds.map(world => world.close()));
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function expectCommitted(body: unknown, what: string): Record<string, unknown> {
  const answer = asRecord(body);
  if (answer['status'] !== 'committed') throw new Error(`${what} did not commit: ${JSON.stringify(body)}`);
  return { ...answer, value: asRecord(answer['value']) };
}

function readyValue(body: unknown, what: string): Record<string, unknown> {
  const answer = asRecord(body);
  if (answer['status'] !== 'ready') throw new Error(`${what} is not readable: ${JSON.stringify(body)}`);
  return asRecord(answer['value']);
}

const PROJECT_REF = { aggregateType: 'Project' as const, projectId: S6A_SCOPE.projectId };
const WORKSPACE_REF = { aggregateType: 'Workspace' as const, projectId: S6A_SCOPE.projectId,
  workspaceId: S6A_SCOPE.workspaceId };
const goalRefOf = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId });
const phaseRefOf = (goalId: string) => ({ aggregateType: 'GoalPhase' as const, projectId: S6A_SCOPE.projectId, goalId });

function createBody(goalId: string, requestId: string): ReturnType<typeof graphWrite> {
  return graphWrite(S6A_SCOPE, { goalId, workspace: S6A_SCOPE, objective: `Y goal ${goalId}` }, requestId,
    [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }]);
}

async function goalReadOf(world: S6ARequestWorld, goalId: string): Promise<Record<string, unknown>> {
  return asRecord(readyValue((await world.post('goals/read', plain(S6A_SCOPE, goalRefOf(goalId)))).body, 'goals/read')['goal']);
}

describe.each(['memory', 'sqlite'] as const)('Y goal cursor (%s)', backend => {
  it('goals/create returns the goal and its cursor, goals/read shows the same cursor, and a replay keeps it', async () => {
    const world = await openGoalWorld(backend);
    const goalId = 's6a-y-goal-cursor';
    const created = expectCommitted((await world.post('goals/create', createBody(goalId, 's6a-y-create'))).body, 'goals/create');
    const cursor = created['cursor'];
    expect(typeof cursor).toBe('string');

    expect(created['value']).toMatchObject({ ref: goalRefOf(goalId), revision: 1, since: cursor });
    expect(await goalReadOf(world, goalId)).toMatchObject({ ref: goalRefOf(goalId), revision: 1, since: cursor });

    // The same command identity replays the original create: same cursor, nothing written twice.
    const replayed = expectCommitted((await world.post('goals/create', createBody(goalId, 's6a-y-create'))).body, 'the replay');
    expect(replayed['replayed']).toBe(true);
    expect(replayed['cursor']).toBe(cursor);
    expect(replayed['value']).toMatchObject({ ref: goalRefOf(goalId), since: cursor });
    expect(await goalReadOf(world, goalId)).toMatchObject({ revision: 1, since: cursor });
  });

  it('a desired-state change keeps the creation cursor', async () => {
    const world = await openGoalWorld(backend);
    const goalId = 's6a-y-goal-control';
    const created = expectCommitted((await world.post('goals/create', createBody(goalId, 's6a-y-control-create'))).body, 'goals/create');
    const cursor = created['cursor'];

    const paused = expectCommitted((await world.post('goals/control', graphWrite(S6A_SCOPE,
      { goalRef: goalRefOf(goalId), control: 'pause', reason: 'Y goal cursor row' }, 's6a-y-pause',
      [{ ref: goalRefOf(goalId), revision: 1 }, { ref: phaseRefOf(goalId), revision: 0 }]))).body, 'goals/control');
    expect(asRecord(paused['value'])['goal']).toMatchObject({ desiredState: 'paused', revision: 2, since: cursor });
    // The public read of the moved Goal carries the same cursor.
    expect(await goalReadOf(world, goalId)).toMatchObject({ desiredState: 'paused', revision: 2, since: cursor });
  });

  it('a plan adoption keeps the creation cursor', async () => {
    const world = await openGoalWorld(backend);
    const goalId = 's6a-y-goal-plan';
    const created = expectCommitted((await world.post('goals/create', createBody(goalId, 's6a-y-plan-create'))).body, 'goals/create');
    const cursor = created['cursor'];
    // A plan adoption needs the project's active CompletionPolicy and architecture.
    await seedS6AMemory(world, { architecture: true, policy: true, notes: false });

    const draft = { ...ag2bPlanDraft(['s6a-y-plan-work']), planId: 's6a-y-plan', planRevision: 1, goalId };
    const proposed = expectCommitted((await world.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: goalRefOf(goalId), basedOn: null, draft, reason: { text: 'Y goal cursor plan', sources: [] },
    }, 's6a-y-propose', [{ ref: goalRefOf(goalId), revision: 1 }]))).body, 'plans/propose');
    expect(asRecord(proposed['value'])['issues']).toEqual([]);
    const applied = expectCommitted((await world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: asRecord(proposed['value'])['ref'],
      expectedProposalRevision: asRecord(proposed['value'])['revision'],
      decisionRefs: [],
    }, 's6a-y-apply', [{ ref: goalRefOf(goalId), revision: 1 }]))).body, 'plans/apply');

    // Adoption moved the pointer and raised the Goal revision; the creation cursor did not move.
    expect(asRecord(applied['value'])).toMatchObject({ goalRef: goalRefOf(goalId),
      ref: { aggregateType: 'PlanRevision', projectId: S6A_SCOPE.projectId, planId: 's6a-y-plan' } });
    expect(await goalReadOf(world, goalId)).toMatchObject({ revision: 2,
      activePlanRevision: { aggregateType: 'PlanRevision', projectId: S6A_SCOPE.projectId, planId: 's6a-y-plan' },
      since: cursor });
  });
});
