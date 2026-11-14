/**
 * KLS-3a1 (test writer, decision 117): a line = a folder + a branch, on the data side. Rows 3A1-02..06, 3A1-09 and
 * 3A1-11 of the start rulings draft §3 with the lead's 11-13 rulings (KLS-3a §9), on `openKLS2AWorld`'s real git
 * roots, through the public owners: `projects.registerLine` (what the Host calls when it opens a folder; until KLS-3b
 * the only step that adds a second line to a workspace), `projects.readLines` (behind `workspaces/lines`),
 * `goals.createGoal` (`goals/create`), `runtime.createSession` (`sessions/create`), `sessions.readSession`/
 * `findSessions`, `plans.queryGoal` (`goals/read`) and `decisions.queryGoalConflicts` (`goals/conflicts`). Memory
 * only: no row is about storage (S3). Expected values come from the rulings and the test's own git (`kls3a1Checkout`):
 * - the line key is `canonicalJson([workspaceId, folder])` (ruling 2): `JSON.stringify([workspaceId, folder])`;
 * - `goals/create`/`sessions/create` take an optional `lineFolder`; without it the workspace's main line, the
 *   earliest created (ruling 1);
 * - a `lineFolder` that is not a line of the workspace is refused `not_found`: a product rule (a line is a part of its
 *   workspace; guessing one would put the work into the wrong folder; draft §5 refusal 2).
 *
 * Red today (7c862a02): `projects.registerLine` and `readLines` do not exist (each row stops at its first
 * registration with a TypeError), and Goals and Sessions carry no `lineRef`. Green when KLS-3a1 lands the line record
 * with its owner, `lineFolder` on the two creates and the line check in the conflict pairing.
 */
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { kls3a1Checkout, openKLS2AWorld, registerKLS2ALine, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { addGitWorktree, gitIn } from '../scenarios/support/git-workspace.js';

const worlds: KLS2AWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

async function openLineWorld(workspaces?: string[]): Promise<KLS2AWorld> {
  const world = await openKLS2AWorld(workspaces === undefined ? {} : { workspaces });
  worlds.push(world);
  return world;
}

/** The value of a successful answer; any other answer stops the row with its body. */
function must<T>(label: string, answer: { status: string; value?: T }): T {
  if (!['committed', 'completed', 'ready'].includes(answer.status)) throw new Error(`${label}: ${JSON.stringify(answer)}`);
  return answer.value as T;
}

/** A second checkout of the world's repository (`addGitWorktree`, branch `wt`), with one commit of its own. */
function addWorktree(world: KLS2AWorld): string {
  const folder = addGitWorktree(world.root, join(dirname(world.root), 'wt'), 'wt');
  gitIn(folder, 'commit', '--allow-empty', '-q', '-m', 'kls3a1 worktree work');
  return folder;
}

/** The line record the rulings give for `folder` (the clock's `createdAt` aside). */
function expectedLine(world: KLS2AWorld, folder: string) {
  const { line, head } = kls3a1Checkout(folder);
  return { ref: { aggregateType: 'Line', projectId: world.projectId, workspaceId: world.workspaceId,
    lineRef: JSON.stringify([world.workspaceId, line.folder]) },
  revision: 1, ...line, forkPoint: head, status: 'open', createdAt: expect.any(String), closedAt: null };
}

/** A Goal's or Session's `lineRef` for `folder`: the line's repository, folder and branch. */
function folderLineRef(folder: string): { repoKey: string; folder: string; branch: string } {
  const { repoKey, folder: real, branch } = kls3a1Checkout(folder).line;
  return { repoKey, folder: real, branch };
}

async function lines(world: KLS2AWorld): Promise<unknown[]> {
  return must('readLines', await world.platform.projects.readLines(world.ctx(), { workspaceId: world.workspaceId })).lines;
}

const goalRefOf = (world: KLS2AWorld, goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: world.projectId, goalId });

async function goalOnLine(world: KLS2AWorld, goalId: string, lineFolder?: string) {
  return await world.platform.goals.createGoal(world.ctx(), {
    meta: { requestId: `kls3a1-goal-${goalId}`, expected: await world.scopePins() },
    input: { goalId, workspace: { projectId: world.projectId, workspaceId: world.workspaceId },
      objective: `KLS3A1 ${goalId}`, ...(lineFolder === undefined ? {} : { lineFolder }) } });
}

async function sessionOnLine(world: KLS2AWorld, label: string, lineFolder?: string) {
  return await world.platform.runtime.createSession(world.ctx(), {
    workspace: { projectId: world.projectId, workspaceId: world.workspaceId },
    role: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' },
    recommendedRefs: [], initialLinks: [], meta: { requestId: `kls3a1-session-${label}`, expected: [] },
    ...(lineFolder === undefined ? {} : { lineFolder }) });
}

async function sessionsFound(world: KLS2AWorld) {
  return must('findSessions', await world.platform.sessions.findSessions(world.ctx(), {
    workspace: { projectId: world.projectId, workspaceId: world.workspaceId }, includeArchived: false,
    page: { limit: 50 } })).items;
}

/** `core` (paths `src/core`) adopted, so the rows' Plans can be adopted. */
async function adoptCore(world: KLS2AWorld): Promise<void> {
  must('adoptInitialArchitecture', await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
    meta: { requestId: 'kls3a1-adopt', expected: await world.scopePins() },
    input: { baselineId: 'kls3a1-baseline', description: 'KLS3A1', constraints: [], catalog: { requireDag: true,
      dependencies: [], modules: [{ ref: { projectId: world.projectId, moduleId: 'core' }, name: 'core',
        responsibility: 'own core', paths: ['src/core'], interfaces: [] }] } } }));
}

/** A Goal (on `lineFolder`'s line, or the default) and its Plan, whose one work Task plans `src/core/a.ts`. */
async function goalPlanningCoreFile(world: KLS2AWorld, goalId: string, lineFolder?: string): Promise<void> {
  must(`createGoal ${goalId}`, await goalOnLine(world, goalId, lineFolder));
  const goalRef = goalRefOf(world, goalId);
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: `${goalId}-plan`, planRevision: 1, goalId,
    stages: [{ stageId: 's1', title: 'Stage one' }],
    tasks: [
      { taskId: 't1', stageId: 's1', title: 'Work one', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, plannedFiles: ['src/core/a.ts'] },
      { taskId: 'g1', title: 'Gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 't1', role: 'platform-executor', instruction: 'Work one' }],
    obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required', taskIds: ['t1', 'g1'],
      verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const goalPins = async () => [{ ref: goalRef,
    revision: must('queryGoal', await world.platform.plans.queryGoal(world.ctx(), goalRef)).goal.revision }];
  const proposed = must('proposePlan', await world.platform.plans.proposePlan(world.ctx(), {
    meta: { requestId: `${goalId}-propose`, expected: await goalPins() },
    input: { goalRef, basedOn: null, draft, reason: { text: goalId, sources: [] } } }));
  must('applyPlanChange', await world.platform.plans.applyPlanChange(world.ctx(), {
    meta: { requestId: `${goalId}-apply`, expected: await goalPins() },
    input: { proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] } }));
}

/** The conflict cards' Goal pairs (`goals/conflicts`), each `a + b`, sorted. */
async function conflictPairs(world: KLS2AWorld): Promise<string[]> {
  const read = must('queryGoalConflicts', await world.platform.decisions.queryGoalConflicts(world.ctx(),
    { workspace: { projectId: world.projectId, workspaceId: world.workspaceId } }));
  return read.cards.map(card => (card.source.goalBases ?? []).map(basis => basis.goalRef.goalId).sort().join(' + ')).sort();
}

describe('KLS-3a1 the lines of one workspace', () => {
  it('3A1-02 a worktree of the repository is a second line: same repository, its own folder and branch; main first', async () => {
    /* Named mutation: `registerLine` writes the workspace's main folder instead of `line.folder` — the worktree's line
     * reads the main folder (or is taken for the main line), so the list differs. */
    const world = await openLineWorld();
    const worktree = addWorktree(world);
    must('main line', await registerKLS2ALine(world, world.root, 'kls3a1-02-main'));
    must('worktree line', await registerKLS2ALine(world, worktree, 'kls3a1-02-wt'));
    expect(await lines(world)).toEqual([expectedLine(world, world.root), expectedLine(world, worktree)]);
  });

  it('3A1-09 registering the same checkout again keeps the one line as it was (revision 1, first createdAt)', async () => {
    /* Named mutation: `registerLine` always writes a new record — the second call is refused by the line's guard or
     * bumps the revision, and the list is not the first record alone. */
    const world = await openLineWorld();
    const first = must('first registration', await registerKLS2ALine(world, world.root, 'kls3a1-09-first'));
    must('second registration', await registerKLS2ALine(world, world.root, 'kls3a1-09-again'));
    expect(first).toEqual(expectedLine(world, world.root));
    expect(await lines(world)).toEqual([first]);
  });

  it('3A1-11 two clones of one repository, both on `main`, are two lines keyed by folder; their Goals do not pair', async () => {
    /* Named mutations: the key back to `[workspaceId, branch]` — the clone's line has the main line's key and does not
     * register beside it; the conflict pairing compares `lineRef.branch` — both are `main`, one card. */
    const world = await openLineWorld();
    const clone = join(dirname(world.root), 'clone');
    gitIn(dirname(world.root), 'clone', '-q', world.root, clone);
    must('main line', await registerKLS2ALine(world, world.root, 'kls3a1-11-main'));
    must('clone line', await registerKLS2ALine(world, clone, 'kls3a1-11-clone'));
    expect(await lines(world)).toEqual([expectedLine(world, world.root), expectedLine(world, clone)]);
    await adoptCore(world);
    await goalPlanningCoreFile(world, 'kls3a1-11-main');
    await goalPlanningCoreFile(world, 'kls3a1-11-clone', folderLineRef(clone).folder);
    expect(await conflictPairs(world)).toEqual([]);
  });
});

describe('KLS-3a1 Goals and Sessions bind to a line', () => {
  it.each([
    /* Named mutation: `newGoalSnapshot` writes `lineRef: null` — the Goal reads null. */
    ['3A1-03 `lineFolder` = the worktree folder: the Goal is on the worktree line', 'worktree'],
    /* Named mutation: `lineForWrite` answers null without a `lineFolder` (or the latest line) — not the main line. */
    ['3A1-04 no `lineFolder`: the Goal is on the main line, the earliest created', 'default'],
  ] as const)('%s', async (_name, which) => {
    const world = await openLineWorld();
    const worktree = addWorktree(world);
    must('main line', await registerKLS2ALine(world, world.root, 'kls3a1-gl-main'));
    must('worktree line', await registerKLS2ALine(world, worktree, 'kls3a1-gl-wt'));
    must('createGoal', await goalOnLine(world, 'kls3a1-goal', which === 'worktree' ? worktree : undefined));
    const goal = must('queryGoal', await world.platform.plans.queryGoal(world.ctx(), goalRefOf(world, 'kls3a1-goal'))).goal;
    expect(goal.lineRef).toEqual(folderLineRef(which === 'worktree' ? worktree : world.root));
  });

  it('3A1-05 `sessions/create` with `lineFolder`: the Session is on that line, and `sessions/find` returns it as stored', async () => {
    /* Named mutation: `createSessionRecord` writes `lineRef: null` — both reads give null. */
    const world = await openLineWorld();
    const worktree = addWorktree(world);
    must('main line', await registerKLS2ALine(world, world.root, 'kls3a1-05-main'));
    must('worktree line', await registerKLS2ALine(world, worktree, 'kls3a1-05-wt'));
    await world.platform.kernelStores.registerCurrent!({ adapterId: 'kls3a1-05-line', storeKey: 'kls3a1-05-line',
      workspace: { projectId: world.projectId, workspaceId: world.workspaceId },
      databasePath: join(dirname(world.root), 'kls3a1-05-line.sqlite'), lineFolder: worktree });
    const created = must('createSession', await sessionOnLine(world, 'kls3a1-05', worktree));
    const ref = { projectId: created.ref.projectId, sessionId: created.ref.sessionId };
    const card = must('readSession', await world.platform.sessions.readSession(world.ctx(), ref));
    expect(card.record.lineRef).toEqual(folderLineRef(worktree));
    expect((await sessionsFound(world)).map(found => [found.record.ref.sessionId, found.record.lineRef]))
      .toEqual([[ref.sessionId, folderLineRef(worktree)]]);
  });

  it('3A1-06 conflicts pair only within a line: two Goals on the main line make one card, the worktree Goal none', async () => {
    /* Named mutation: drop the line comparison in the conflict pairing (`goal-conflicts.ts`) — the worktree Goal pairs
     * with both main Goals, three cards. */
    const world = await openLineWorld();
    const worktree = addWorktree(world);
    must('main line', await registerKLS2ALine(world, world.root, 'kls3a1-06-main'));
    must('worktree line', await registerKLS2ALine(world, worktree, 'kls3a1-06-wt'));
    await adoptCore(world);
    await goalPlanningCoreFile(world, 'kls3a1-06-a');
    await goalPlanningCoreFile(world, 'kls3a1-06-b');
    await goalPlanningCoreFile(world, 'kls3a1-06-w', worktree);
    expect(await conflictPairs(world)).toEqual(['kls3a1-06-a + kls3a1-06-b']);
  });
});

describe('rejects: a `lineFolder` that is not a line of the workspace (product rule, draft §5 refusal 2)', () => {
  // The folder is the second workspace's line: it exists in the project, but not in this workspace. A line is a part
  // of its workspace; guessing one would put the Goal or the Session into the wrong folder.
  it.each([
    /* Named mutation: `readLine` looks the folder up in the whole project — the Goal is created on `ws2`'s line. */
    ['goals/create', async (world: KLS2AWorld, folder: string) => await goalOnLine(world, 'kls3a1-outside', folder),
      async (world: KLS2AWorld) => (await world.platform.plans.queryGoal(world.ctx(), goalRefOf(world, 'kls3a1-outside'))).status,
      'not_found'],
    /* Named mutation: `sessions/create` skips the line check and falls back to the main line — a Session is created. */
    ['sessions/create', async (world: KLS2AWorld, folder: string) => await sessionOnLine(world, 'kls3a1-outside', folder),
      async (world: KLS2AWorld) => (await sessionsFound(world)).length, 0],
  ] as const)('%s', async (_route, create, after, unchanged) => {
    const world = await openLineWorld(['ws', 'ws2']);
    const second = join(dirname(world.root), 'ws2');
    must('main line', await registerKLS2ALine(world, world.root, 'kls3a1-r-main'));
    must('ws2 line', await registerKLS2ALine(world, second, 'kls3a1-r-ws2', 'ws2'));
    expect(await create(world, folderLineRef(second).folder)).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(await after(world)).toBe(unchanged);
  });
});
