/**
 * `G2-archive-release` (book :2017, `:250-264`, `:312-317`, §3.6): both formal archive commits merge the one
 * release plan. A direct `sessions/archive` closes the line's responsible goal/project links and an adviser's
 * module link, frees their claims and its holder. The handoff/retire formal commit does the same; a full handoff's
 * commit moves the holder to the borrowing successor, an `existing` successor only releases. The holder is read
 * through the public admission consequence: the seat it frees is taken by a new adviser, or stays taken by the
 * successor.
 * Named mutation (not run here): delete the release contribution at the step commit
 * (`src/core/work-graph/sessions/session-lifecycle.ts:1401`); the direct archive stays green and the step case
 * reddens on the surviving link/holder.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionAggregateRef, SessionRef, SessionWorkLinkRef, VersionPin, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, governS6B } from '../helpers/S6B1-fixture.js';
import { driveS6BHandoff } from '../helpers/S6B2-fixture.js';
import { committed, setS7AAutonomy } from '../helpers/S7A-fixture.js';

let opened: S6AHostWorld | undefined;
afterEach(async () => {
  await opened?.close();
  opened = undefined;
});

const ADVISER = platformRoleProfile('adviser').template;
const project = { projectId: S6A_SCOPE.projectId };
const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function openWorld(backend: 'memory' | 'sqlite'): Promise<S6AHostWorld> {
  opened = await openS6AHostWorld({ backend });
  await governS6B(opened, s6aCardsWorkspace(opened, S6A_SCOPE), opened.goals);
  return opened;
}

const targetOf = (goal: S6AHostWorld['goals']['first'], kind: 'goal' | 'module' | 'project'): WorkLinkTarget =>
  kind === 'module'
    ? { kind, ref: { projectId: project.projectId, moduleId: 's6a-core' } }
    : kind === 'goal' ? { kind, ref: goal } : { kind, ref: project };

/** The person's limits read and set, pinned by the read's revision. */
async function setAdviserOpen(world: S6AHostWorld, open: number): Promise<void> {
  const read = asRecord((await world.post('projects/role-limits', plain(S6A_SCOPE,
    { projectRef: { projectId: project.projectId } }))).body);
  expect(read['status']).toBe('ready');
  committed(await world.post('projects/role-limits/set', plain(S6A_SCOPE, {
    commandId: `g2-release-open-${String(open)}`, expectedRevision: asRecord(read['value'])['revision'],
    open: { adviser: open },
  })), 'the adviser limit');
}

/** The counted create with the seat decision, as the public route's real caller sends it. */
async function createAdviser(world: S6AHostWorld, label: string, tasks: readonly TaskTriple[] = []):
Promise<{ body: Record<string, unknown>; ref: SessionRef | null }> {
  const principal = world.humanContext().principal;
  if (principal.kind !== 'host') throw new Error('G2-archive-release: the world has no Host actor');
  const answer = await world.post('sessions/create', plain(S6A_SCOPE, {
    workspace: { ...S6A_SCOPE }, role: ADVISER, recommendedRefs: [],
    initialLinks: tasks.map(ref => ({ target: { kind: 'task' as const, ref }, relation: 'responsible' as const })),
    meta: { requestId: `g2-release-${label}`, expected: [] },
    creation: { duty: 'adviser', scope: { kind: 'project' as const }, reason: 'adviser_needed',
      creator: principal.actor },
  }));
  const body = asRecord(answer.body);
  if (body['status'] !== 'completed') return { body, ref: null };
  const ref = asRecord(body['value'])['ref'] as SessionAggregateRef;
  return { body, ref: { projectId: ref.projectId, sessionId: ref.sessionId } };
}

async function mustCreate(world: S6AHostWorld, label: string, tasks: readonly TaskTriple[] = []): Promise<SessionRef> {
  const created = await createAdviser(world, label, tasks);
  if (created.body['status'] !== 'completed') throw new Error(`${label}: ${JSON.stringify(created.body)}`);
  if (created.ref === null) throw new Error(`G2-archive-release: ${label} created no Session`);
  return created.ref;
}

/** One open `responsible` link through the real route, pinned by the card and the link's current revision. */
async function openLink(world: S6AHostWorld, line: SessionRef, workTarget: WorkLinkTarget,
  requestId: string): Promise<void> {
  const card = await world.readSession(line);
  const linkRef: SessionWorkLinkRef = { ...card.record.ref, aggregateType: 'SessionWorkLink',
    target: workTarget, relation: 'responsible' };
  const existing = card.links.find(link => canonicalKey(link.ref) === canonicalKey(linkRef));
  const expected: VersionPin[] = [
    { ref: card.record.ref, revision: card.record.revision },
    { ref: linkRef, revision: existing?.revision ?? 0 },
  ];
  committed(await world.post('sessions/link', graphWrite(S6A_SCOPE, {
    sessionRef: line, target: workTarget, relation: 'responsible', active: true,
  }, requestId, expected)), `the ${workTarget.kind} link`);
}

async function archive(world: S6AHostWorld, line: SessionRef, requestId: string): Promise<void> {
  const card = await world.readSession(line);
  const body = (await world.post('sessions/archive', graphWrite(S6A_SCOPE,
    { sessionRef: line, reason: 'G2 archive release' }, requestId,
    [{ ref: card.record.ref, revision: card.record.revision }]))).body;
  if (asRecord(body)['status'] !== 'committed') throw new Error(JSON.stringify(body));
}

/** The source's only open responsible task link, as the handoff assignment names it. */
function openTaskOf(card: Awaited<ReturnType<S6AHostWorld['readSession']>>): TaskTriple {
  const link = card.links.find(entry => entry.until === null && entry.ref.relation === 'responsible'
    && entry.ref.target.kind === 'task');
  if (link === undefined || link.ref.target.kind !== 'task') throw new Error('G2-archive-release: no open task link');
  return link.ref.target.ref;
}

async function handoff(world: S6AHostWorld, source: SessionRef, tasks: readonly TaskTriple[],
  target: { kind: 'create'; duty: 'adviser' } | { kind: 'existing'; session: SessionRef }, commandId: string):
Promise<void> {
  const accepted = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
    commandId, workspace: { ...S6A_SCOPE }, source, trigger: 'manual',
    assignments: [{ target, tasks: [...tasks] }],
  });
  if (accepted.status !== 'committed') throw new Error(JSON.stringify(accepted));
  expect(await driveS6BHandoff(world, { operation: accepted.value.operation }))
    .toMatchObject({ progress: { stage: 'finished' } });
}

async function prepareSource(world: S6AHostWorld, main: S6ACardsWorkspace, label: string):
Promise<{ source: SessionRef; task: TaskTriple }> {
  const goal = (await main.createGoal(`g2-release-${label}-goal`, `G2 release ${label} goal`)).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label: `g2-release-${label}`,
    taskIds: [`g2-release-${label}-task`], role: ADVISER.templateId });
  const source = await mustCreate(world, `${label}-source`, [tasks[0]!]);
  await setS7AAutonomy(world, goal, 'after_plan_confirmation');
  await openLink(world, source, targetOf(goal, 'goal'), `g2-release-${label}-goal-link`);
  return { source, task: openTaskOf(await world.readSession(source)) };
}

describe.each(['memory', 'sqlite'] as const)('G2-archive-release (%s): one release plan, two formal commits', backend => {
  it('a direct sessions/archive closes the adviser goal and module links, frees their claims and releases the holder', async () => {
    const world = await openWorld(backend);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await setAdviserOpen(world, 1);
    const goal = (await main.createGoal('g2-release-direct-goal', 'G2 release direct goal')).ref;
    const line = await mustCreate(world, 'direct');
    await openLink(world, line, targetOf(goal, 'goal'), 'g2-release-direct-goal-link');
    await openLink(world, line, targetOf(goal, 'module'), 'g2-release-direct-module-link');

    await archive(world, line, 'g2-release-direct-archive');
    const archived = await world.readSession(line);
    for (const kind of ['goal', 'module'] as const) {
      expect(archived.links.find(entry => entry.ref.target.kind === kind)?.until).not.toBeNull();
    }

    // The seat and the claims are free: a fresh adviser is admitted and opens the same goal and module scopes.
    const taker = await mustCreate(world, 'taker');
    await openLink(world, taker, targetOf(goal, 'goal'), 'g2-release-taker-goal');
    await openLink(world, taker, targetOf(goal, 'module'), 'g2-release-taker-module');
  }, 300_000);

  it('a full handoff archive step closes the source goal link and moves its holder to the borrowing successor once', async () => {
    const world = await openWorld(backend);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await setAdviserOpen(world, 1);
    const { source, task } = await prepareSource(world, main, 'full');
    await handoff(world, source, [task], { kind: 'create', duty: 'adviser' }, 'g2-release-full-accept');

    const archived = await world.readSession(source);
    expect(archived.record.lifecycle).toBe('archived');
    expect(archived.links.find(entry => entry.ref.target.kind === 'goal')?.until).not.toBeNull();
    // The borrowing successor holds the one seat: a further adviser create stays at the cap.
    expect((await createAdviser(world, 'full-after')).body)
      .toMatchObject({ status: 'rejected', code: 'capacity', reason: 'at_cap: adviser has 1 holder(s) and 0 reservation(s) against open limit 1' });
  }, 300_000);

  it('an existing successor takes the plain release: the source seat is freed without moving to it', async () => {
    const world = await openWorld(backend);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await setAdviserOpen(world, 2);
    const { source, task } = await prepareSource(world, main, 'existing');
    const existing = await mustCreate(world, 'existing-target');
    await handoff(world, source, [task], { kind: 'existing', session: existing }, 'g2-release-existing-accept');

    expect((await world.readSession(source)).record.lifecycle).toBe('archived');
    // The moved seat would keep the cap full; the plain release lets the next adviser in.
    expect((await createAdviser(world, 'existing-after')).body).toMatchObject({ status: 'completed' });
  }, 300_000);
});
