/**
 * Secretary line names (slice-6 spec L6, "秘书名字"): a secretary line is named
 * `秘书 N`, N being its Session's place in the creation order of the
 * workspace's secretary Sessions. Archived secretaries keep their number, a
 * read-only copy of a secretary takes none, and a Session of another duty takes
 * none, and so does a Session whose legacy-template role resolves to no duty
 * (it is certainly not a secretary; the numbers stay complete). The Goal's
 * owners on the graph hover stay the secretary lines whose latest Query
 * targets that Goal, whatever their name.
 *
 * Steps, all public: Sessions created through `sessions/create` with the clock
 * set before each creation, a read-only copy through the real consultation
 * path, `sessions/archive-line`, a plain Query claimed on a secretary,
 * `plans/propose` + `plans/apply` on both Goals, then `lines/list`,
 * `lines/archived` and `graph/hover`. Memory and SQLite.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { LineBriefV1, LineNameV1, LineRowV1 } from '../../src/contracts/work-line.js';
import { ag2bPlanDraft, createAG2bSession, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { seedS6AMemory } from '../helpers/S6A-memory-fixture.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_GOAL_2, S6A_PLAIN_ROLE, S6A_SCOPE, type S6ASession, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';

const worlds: S6ARequestWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

function readyValue<T>(body: unknown, what: string): T {
  const answer = body as { status?: unknown; value?: unknown };
  if (answer.status !== 'ready') throw new Error(`${what} is not readable: ${JSON.stringify(body)}`);
  return answer.value as T;
}

function committedValue(body: unknown, what: string): Record<string, unknown> {
  const answer = body as { status?: unknown; value?: unknown };
  if (answer.status !== 'committed') throw new Error(`${what} did not commit: ${JSON.stringify(body)}`);
  return answer.value as Record<string, unknown>;
}

async function activeRows(world: S6ARequestWorld): Promise<LineRowV1[]> {
  return readyValue<{ rows: LineRowV1[] }>((await world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body,
    'lines/list').rows;
}

async function archivedRows(world: S6ARequestWorld): Promise<LineRowV1[]> {
  return readyValue<{ rows: LineRowV1[] }>((await world.post('lines/archived', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, page: { limit: 10 } }))).body, 'lines/archived').rows;
}

function nameOf(rows: readonly LineRowV1[], session: S6ASession): LineNameV1 | undefined {
  return rows.find(row => row.key.sessionId === session.ref.sessionId)?.name;
}

/** The secretary name of a line whose latest Query is on `goal` (null: no Query). */
function secretaryName(ordinal: number, goal: GoalRef | null): LineNameV1 {
  return { source: 'secretary_ordinal', primary: `秘书 ${String(ordinal)}`, ordinal, extraCount: 0, tasks: [],
    goalRef: goal, complete: true };
}

/** `plans/propose` + `plans/apply` of a one-work plan on `goal` (the Goal is at revision 1). */
async function adoptPlan(world: S6ARequestWorld, goal: GoalRef, label: string): Promise<void> {
  const draft = { ...ag2bPlanDraft([`${label}-work`]), planId: `${label}-plan`, planRevision: 1, goalId: goal.goalId };
  const proposed = committedValue((await world.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft, reason: { text: `names plan ${label}`, sources: [] },
  }, `${label}-propose`, [{ ref: goal, revision: 1 }]))).body, `plans/propose ${label}`);
  committedValue((await world.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed['ref'], expectedProposalRevision: proposed['revision'], decisionRefs: [],
  }, `${label}-apply`, [{ ref: goal, revision: 1 }]))).body, `plans/apply ${label}`);
}

async function goalOwners(world: S6ARequestWorld, goal: GoalRef): Promise<LineBriefV1[]> {
  const hover = readyValue<{ groups: { node: { kind: string }; owners: LineBriefV1[] }[] }>(
    (await world.post('graph/hover', plain(S6A_SCOPE, { goalRef: goal }))).body, `graph/hover ${goal.goalId}`);
  const group = hover.groups.find(entry => entry.node.kind === 'goal');
  if (group === undefined) throw new Error(`graph/hover ${goal.goalId} has no goal group`);
  return group.owners;
}

describe.each(['memory', 'sqlite'] as const)('secretary names (%s)', (backend) => {
  it('number the secretaries by creation; an archived one keeps its number; a copy and an executor take none', async () => {
    const world = await openS6ARequestWorld({ backend });
    worlds.push(world);
    const first = await world.createSecretary('s6a-names-first', { at: '2026-10-23T09:01:00.000Z' });
    const work = await world.createWorkSession('s6a-names-work', { at: '2026-10-23T09:02:00.000Z' });
    const second = await world.createSecretary('s6a-names-second', { at: '2026-10-23T09:03:00.000Z' });
    world.clock.set('2026-10-23T09:04:00.000Z');
    const { copy } = await world.makeReadonlyCopy(second, 's6a-names-copy');
    const third = await world.createUnprofiledSecretary('s6a-names-third', { at: '2026-10-23T09:05:00.000Z' });
    await world.archive(first);

    const active = await activeRows(world);
    expect(nameOf(active, second)).toEqual(secretaryName(2, null));
    expect(nameOf(active, third)).toEqual(secretaryName(3, null));
    expect(nameOf(active, work)).toEqual({ source: 'duty_only', primary: 'executor', ordinal: null, extraCount: 0,
      tasks: [], goalRef: null, complete: true });
    // The copy is not a line of its own: it rides on its source's line.
    expect(nameOf(active, copy)).toBeUndefined();
    expect(nameOf(await archivedRows(world), first)).toEqual(secretaryName(1, null));

    // A secretary created later takes the next number; the earlier ones keep theirs.
    const fourth = await world.createSecretary('s6a-names-fourth', { at: '2026-10-23T09:06:00.000Z' });
    const after = await activeRows(world);
    expect(nameOf(after, second)).toEqual(secretaryName(2, null));
    expect(nameOf(after, fourth)).toEqual(secretaryName(4, null));
  });

  it('skip a Session whose legacy role resolves to no duty: the numbers stay complete', async () => {
    const world = await openS6ARequestWorld({ backend });
    worlds.push(world);
    const first = await world.createSecretary('s6a-names-before-unknown', { at: '2026-10-23T09:01:00.000Z' });
    world.clock.set('2026-10-23T09:02:00.000Z');
    // The plain profile's role is a legacy template that is neither a platform template nor a Work binding role:
    // its duty resolves to unknown.
    await createAG2bSession(world.ag2b, 's6a-names-unknown-duty', S6A_PLAIN_ROLE);
    const second = await world.createSecretary('s6a-names-after-unknown', { at: '2026-10-23T09:03:00.000Z' });

    const rows = await activeRows(world);
    expect(nameOf(rows, first)).toEqual(secretaryName(1, null));
    expect(nameOf(rows, second)).toEqual(secretaryName(2, null));
    expect(rows.find(row => row.key.sessionId === second.ref.sessionId)?.problem).toBeNull();
  });

  it('keep the goal owners of the hover: the secretary lines whose latest Query is on that Goal', async () => {
    const world = await openS6ARequestWorld({ backend });
    worlds.push(world);
    // A plan adoption needs the project's active CompletionPolicy and architecture.
    await seedS6AMemory(world, { architecture: true, policy: true, notes: false });
    await adoptPlan(world, S6A_GOAL_1, 's6a-names-goal-1');
    await adoptPlan(world, S6A_GOAL_2, 's6a-names-goal-2');
    await world.createSecretary('s6a-names-idle', { at: '2026-10-23T09:01:00.000Z' });
    const busy = await world.createSecretary('s6a-names-busy', { at: '2026-10-23T09:02:00.000Z' });
    await world.occupy(busy);

    const owners = await goalOwners(world, S6A_GOAL_1);
    expect(owners.map(owner => owner.key.sessionId)).toEqual([busy.ref.sessionId]);
    expect(owners[0]!.name).toEqual(secretaryName(2, S6A_GOAL_1));
    expect(await goalOwners(world, S6A_GOAL_2)).toEqual([]);
  });
});
