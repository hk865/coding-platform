/**
 * KLS-3a1 gap rows (7D2 GAPKLS3A1, Astra reply §I "Where a test should break" 1 and 4). Every expectation is a literal
 * from that reply; every read is a public answer or the checkout's files (no store reads).
 * A1: a recovery item noticed on `main` is refused `revision_conflict` after the same folder switches to `kls3a1-b`.
 * A2: a `pending` write log left on `main` does not block the architecture read or a note write on `kls3a1-b`.
 * A3: reconcile on `kls3a1-b` does not judge `main`'s log (`unconfirmed: 0`, no project notice).
 * D1: two repositories race the workspace's first line: one `committed`, the other `invalid` (memory and SQLite).
 * A1 rides the real Host (`openKLS2CHost`); A2/A3 `openKLS2AWorld` with the Host's `knowledgeWriteHold` seam
 * (`armedSeam('committed').fail()`); D1 `projects.registerLine`, the entry the Host calls when it opens a folder.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { kls3a1Checkout, openKLS2AWorld, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import {
  armedSeam, kls2cAdopt, kls2cNoticesAtLeast, kls2cRecover, kls2cWrittenNote, openKLS2CHost, type KLS2CHost,
} from '../helpers/KLS2C-knowledge-host.js';
import { expectedLine, must, registerLine } from '../helpers/KLS3A1-gap-world.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openXWS2AWorld, XWS2A_ADVISER_TOOLS, xws2aModuleInProject, type XWS2AWorld } from '../helpers/XWS2A-world.js';
import { gitIn, initGitWorkspace } from '../scenarios/support/git-workspace.js';

const worlds: (KLS2CHost | KLS2AWorld | XWS2AWorld)[] = [];
afterEach(async () => { for (const world of worlds.splice(0).reverse()) await world.close(); });

const NOTE: NoteDraftV1 = { kind: 'decision', topic: 'kls3a1-a2', conclusion: 'c', body: 'b',
  anchor: { kind: 'module', moduleId: 'core' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
  replaces: [], contradicts: [], coexistWith: [] } as NoteDraftV1;

/** `core` adopted; then one revision fails after its records commit (a `pending` log on `main`); then the folder is on `kls3a1-b`. */
async function pendingOnMain(): Promise<KLS2AWorld> {
  const seam = armedSeam('committed');
  const world = await openKLS2AWorld({ platform: { knowledgeWriteHold: seam.seam } });
  worlds.push(world);
  expect(await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
    meta: { requestId: 'kls3a1-adopt', expected: await world.scopePins() },
    input: { baselineId: 'kls3a1-baseline', description: 'd', constraints: [], catalog: { requireDag: true, dependencies: [],
      modules: [{ ref: { projectId: world.projectId, moduleId: 'core' }, name: 'core', responsibility: 'own core',
        paths: ['src/core'], interfaces: [] }] } } })).toMatchObject({ status: 'committed' });
  const current = must('architecture read', await world.platform.architecture.readArchitectureRevision(world.ctx(),
    { selection: { kind: 'current' } }));
  seam.fail();
  await world.platform.architecture.reviseArchitectureCatalog(world.ctx(), {
    meta: { requestId: 'kls3a1-revise', expected: await world.scopePins() },
    input: { expected: { catalogRef: current.catalog.ref, baseline: { ref: current.baseline.ref,
      digest: current.baseline.contentDigest } }, ops: [{ op: 'set_responsibility', moduleId: 'core', text: 'core 的新职责' }],
    responsibilityMoves: [], reason: 'KLS3A1' } }).catch(() => null);
  gitIn(world.root, 'checkout', '-q', '-b', 'kls3a1-b');
  return world;
}

describe('A1 recover checks the branch too (recover.ts:68): a notice from branch A, the folder now on B', () => {
  it('A1 a `knowledge_reverted` item on `main` after checkout `kls3a1-b`: revision_conflict, the note stays absent', async () => {
    /* Named mutation: `recover.ts:68` drops `|| line.line.branch !== row.branch` — the answer is `committed` and the
     * note file is written back. */
    const world = await openKLS2CHost({ storage: 'memory', git: true });
    worlds.push(world);
    await kls2cAdopt(world, ['core']);
    const { path } = await kls2cWrittenNote(world, 'kls3a1-a1', 'kls3a1-a1');
    await world.idle();
    world.remove(path);
    const [notice] = await kls2cNoticesAtLeast(world, 'knowledge_reverted', 1);
    if (notice === undefined) throw new Error('KLS3A1: no knowledge_reverted notice');
    world.git(['checkout', '-q', '-b', 'kls3a1-b']);
    expect(await kls2cRecover(world, notice.noticeId, 1))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict', reason: '检出的分支已经变了' });
    expect(world.read(path)).toBeNull();
  });
});

describe('A2 a pending write log on branch A does not block branch B (write-log.ts:47)', () => {
  it('A2 the architecture reads ready (`own core`) and a note write is accepted on `kls3a1-b`', async () => {
    /* Named mutation: `write-log.ts:47` pushes every decoded log (drops `=== line.line.branch`) — the read answers
     * `unavailable` (`有未确认的知识写`) and the note write is rejected. */
    const world = await pendingOnMain();
    const read = await world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } });
    const written = await world.platform.notes.writeNote(world.ctx(), { commandId: 'kls3a1-a2', note: NOTE,
      expectedPointerRevision: null, goalId: null });
    expect([read.status === 'ready' ? read.value.catalog.catalog.modules.map(module => module.responsibility) : read,
      written.status]).toEqual([['own core'], 'accepted']);
  });
});

describe('A3 reconcile on branch B does not judge branch A\'s log (reconcile.ts:232)', () => {
  it('A3 reconcile on `kls3a1-b` leaves `main`\'s pending log alone: unconfirmed 0 and no project notice', async () => {
    /* Named mutation: `reconcile.ts:232` drops `log.branch === branch` — `unconfirmed: 1` and the notice
     * `平台有 1 次写没确认落盘`. */
    const world = await pendingOnMain();
    const reconciled = await world.platform.knowledge.reconcile(world.ctx(), world.workspaceId, 'idle');
    const queue = await world.platform.decisions.queryDecisionQueue(world.ctx(), {
      workspace: { projectId: world.projectId, workspaceId: world.workspaceId },
      sections: ['notices'], categories: ['project_notice'], page: { limit: 50 } });
    expect([reconciled.status === 'ready' ? reconciled.value.unconfirmed : reconciled,
      queue.status === 'ready' ? queue.value.notices.map(item => item.summary) : queue]).toEqual([0, []]);
  });
});

describe('D1 two repositories race the first line (line-service.ts:111, :114)', () => {
  it.each(['memory', 'sqlite'] as const)('D1 %s: one registration commits, the loser is `invalid` "another repository"', async storage => {
    /* Named mutations: `:111` (`ledgerHorizon: decision.horizon`) — both commit and two lines exist; `:114`
     * (`retryable: { horizon: true }`) — the loser answers a horizon conflict, not `invalid`. */
    const world = await openKLS2AWorld({ storage });
    worlds.push(world);
    const other = join(dirname(world.root), 'other');
    mkdirSync(other);
    await initGitWorkspace(other);
    const pins = await world.scopePins();
    const answers = await Promise.all([registerLine(world, world.root, 'kls3a1-d1-a', world.workspaceId, pins),
      registerLine(world, other, 'kls3a1-d1-b', world.workspaceId, pins)]);
    expect(answers.map(answer => answer.status === 'committed' ? 'committed' : answer.code).sort())
      .toEqual(['committed', 'invalid']);
    const lines = must('readLines', await world.platform.projects.readLines(world.ctx(),
      { workspaceId: world.workspaceId })).lines;
    expect(lines).toEqual([expectedLine(world, lines[0]!.folder)]);
    const invalid = answers.find(answer => answer.status === 'rejected');
    expect(JSON.stringify(invalid)).toContain('another repository');
  });
});

describe('B1 a second-workspace Run finds the project region line, not another workspace Session (session-directory.ts:1970, session-discovery-tools.ts:197)', () => {
  it('B1 the find_related_sessions result names the second-mod region line and not the investigated-only main line', async () => {
    /* Named mutations: `session-directory.ts:1970` drops the `args.regionMain !== null && openResponsible && ...`
     * disjunct — the region line's id disappears; drops only `openResponsible &&` — the investigated-only id leaks;
     * `session-discovery-tools.ts:197` drops `projectRegionLines: true` — the region line's id disappears. */
    const world = await openXWS2AWorld({ backend: 'memory', secondOpenOptions: { writeAllowed: true },
      adviserTools: [...XWS2A_ADVISER_TOOLS, 'find_related_sessions'] });
    worlds.push(world);
    const ws2 = world.second.scope.workspaceId;
    const projectId = world.base.world.scope.projectId;
    const moduleRef = { projectId, moduleId: xws2aModuleInProject(ws2) };
    await world.waitCoarseAnswered();
    await world.approveCoarse();
    const region = await world.scriptRegionProposal();
    const card = await world.base.world.readSession(world.adviser.ref);
    const investigated = graphWrite(S6A_SCOPE, { sessionRef: world.adviser.ref, relation: 'investigated',
      target: { kind: 'module', ref: moduleRef }, active: true }, 'kls3a1-b1-investigated',
    [{ ref: card.record.ref, revision: card.record.revision },
      { ref: { ...world.adviser.ref, aggregateType: 'SessionWorkLink', target: { kind: 'module', ref: moduleRef },
        relation: 'investigated' }, revision: 0 }]);
    const linked = await world.base.world.post('sessions/link', investigated);
    expect((linked.body as { status?: string }).status).toBe('committed');
    const { line } = await world.workRun({ label: 'kls3a1-b1', replies: [
      { kind: 'calls', calls: [{ callId: 'b1', name: 'find_related_sessions', args: {
        target: { kind: 'module', ref: { projectId, moduleId: 'second-mod' } }, page: { limit: 20 } } }] },
      { kind: 'text', text: 'b1' }] });
    const last = (await world.base.world.scripted.requests(line)).at(-1);
    if (last === undefined) throw new Error('B1: no model request after find_related_sessions');
    const seen = JSON.stringify(last);
    expect(seen).toContain(region.ref.sessionId);
    expect(seen).not.toContain(world.adviser.ref.sessionId);
  }, 180_000);
});

/** The b/c world: two workspaces, both catalog modules adopted, a real executor Run and line in each, and
 * `core` assigned to main's line then ws2's raw `core` assigned to ws2's line through the public owner. */
async function r16bWorld(options: { main?: boolean } = {}): Promise<{ world: KLS2AWorld; mainLine: { projectId: string; sessionId: string };
  ws2Ref: { projectId: string; sessionId: string }; ws2Scope: { projectId: string; workspaceId: string };
  mainAnswer: { status: string } | null; ws2Answer: { status: string } }> {
  const kernelDir = mkdtempSync(join(tmpdir(), 'kls3a1-r16b-'));
  const projectId = 'kls2a-project';
  const world = await openKLS2AWorld({ workspaces: ['ws', 'ws2'], platform: { kernelStores: { entries: [
    { adapterId: 'kls3a1-kernel-main', storeKey: 'kls3a1-main-store', workspace: { projectId, workspaceId: 'ws' },
      databasePath: join(kernelDir, 'main.sqlite') },
    { adapterId: 'kls3a1-kernel-ws2', storeKey: 'kls3a1-ws2-store', workspace: { projectId, workspaceId: 'ws2' },
      databasePath: join(kernelDir, 'ws2.sqlite') },
  ] } } });
  try {
    worlds.push(world);
    const main = world.workspaceId;
    const ws2 = 'ws2';
    const mainScope = { projectId, workspaceId: main };
    const ws2Scope = { projectId, workspaceId: ws2 };
    const ws2Core = `/@ws:${encodeURIComponent(ws2)}/core`;
    must('adoptInitialArchitecture', await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
      meta: { requestId: 'kls3a1-r16b-adopt', expected: await world.scopePins() },
      input: { baselineId: 'kls3a1-r16b', description: 'R16 b', constraints: [], catalog: { requireDag: true, dependencies: [],
        modules: [
          { ref: { projectId, moduleId: 'core' }, name: 'core', responsibility: 'own main core', paths: ['src/core'], interfaces: [] },
          { ref: { projectId, moduleId: ws2Core }, name: 'ws2 core', responsibility: 'own ws2 core',
            paths: ['src/core'], interfaces: [] },
        ] } } }));
    await world.claimExecutorRun();
    const workCtx = world.ctx('work_run');
    const principal = workCtx.principal;
    if (principal.kind !== 'work_run') throw new Error('R16b: the executor context is not a Work Run');
    const mainRun = principal.runRef;
    const mainExecution = must('readExecution', await world.platform.executions.readExecution(world.ctx(), mainRun));
    const mainLine = { projectId, sessionId: mainExecution.session.ref.sessionId };
    // A second, ws2-scoped Goal/Plan/Run: `requestAssignment` reads its caller Run under the ws2 claim workspace.
    const ws2Goal = { aggregateType: 'Goal' as const, projectId, goalId: 'kls3a1-r16b-ws2-goal' };
    must('createGoal ws2', await world.platform.goals.createGoal(world.ctx('host', ws2), {
      meta: { requestId: 'kls3a1-r16b-ws2-goal', expected: await world.scopePins(ws2) },
      input: { goalId: ws2Goal.goalId, workspace: ws2Scope, objective: 'R16 b ws2 Goal' } }));
    const draft = { schemaVersion: 2 as const, planId: 'kls3a1-r16b-ws2-plan', planRevision: 1, goalId: ws2Goal.goalId,
      stages: [{ stageId: 's1', title: 'Stage one' }],
      tasks: [
        { taskId: 'w1', stageId: 's1', title: 'Work', requirementLevel: 'required' as const,
          taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } },
        { taskId: 'g1', title: 'Gate', requirementLevel: 'required' as const, taskKind: 'gate' as const,
          disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } },
      ],
      assignments: [{ taskId: 'w1', role: 'platform-executor', instruction: 'R16 b' }],
      obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required' as const, taskIds: ['w1', 'g1'],
        verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required' as const, kind: 'test' as const,
          description: 'Tests pass' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
    const before = must('queryGoal ws2', await world.platform.plans.queryGoal(world.ctx('host', ws2), ws2Goal));
    const proposed = must('proposePlan ws2', await world.platform.plans.proposePlan(world.ctx('host', ws2), {
      meta: { requestId: 'kls3a1-r16b-ws2-propose', expected: [{ ref: ws2Goal, revision: before.goal.revision }] },
      input: { goalRef: ws2Goal, basedOn: null, draft, reason: { text: 'R16 b', sources: [] } } }));
    const afterProposal = must('queryGoal ws2', await world.platform.plans.queryGoal(world.ctx('host', ws2), ws2Goal));
    const plan = must('applyPlanChange ws2', await world.platform.plans.applyPlanChange(world.ctx('host', ws2), {
      meta: { requestId: 'kls3a1-r16b-ws2-apply', expected: [{ ref: ws2Goal, revision: afterProposal.goal.revision }] },
      input: { proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] } }));
    const binding = { schemaVersion: 1 as const, bindingId: 'kls2a-executor-binding', templateId: 'platform-executor',
      templateRevision: 's3.1', bindingVersion: 1, policyRevision: 'legacy-template' };
    const created = must('createSession ws2', await world.platform.runtime.createSession(world.ctx('host', ws2), {
      workspace: ws2Scope, role: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' },
      recommendedRefs: [], initialLinks: [], meta: { requestId: 'kls3a1-r16b-ws2-line', expected: [] } }));
    const ws2Ref = { projectId, sessionId: created.ref.sessionId };
    const sessionCard = must('readSession ws2', await world.platform.sessions.readSession(world.ctx('host', ws2), ws2Ref));
    const claimed = must('claimTask ws2', await world.platform.claims.claimTask(world.ctx('host', ws2), {
      meta: { requestId: 'kls3a1-r16b-ws2-claim', expected: [
        { ref: ws2Goal, revision: (await world.platform.plans.queryGoal(world.ctx('host', ws2), ws2Goal) as {
          status: string; value?: { goal: { revision: number } } }).value!.goal.revision },
        (await world.scopePins(ws2))[1]!,
        { ref: { aggregateType: 'Session', ...ws2Ref }, revision: sessionCard.record.revision },
      ] },
      input: { goalRef: ws2Goal, planRef: plan.ref, taskId: 'w1', sessionRef: ws2Ref, roleBinding: binding,
        budget: { tokenBudget: 100000, deadline: null } } }));
    const ws2Run = claimed.runRef;
    const assign = async (label: string, ctx: ReturnType<typeof world.ctx>, line: { projectId: string; sessionId: string },
      moduleId: string, run: typeof ws2Run) => await world.platform.moduleMaintainers.requestAssignment(ctx, {
      commandId: `kls3a1-r16b-${label}`, caller: { kind: 'work', actor: { kind: 'agent', id: 'kls3a1-r16b', runRef: run },
        session: line, run }, moduleRef: { projectId, moduleId }, line, reason: 'KLS3A1 R16 b' });
    const mainAnswer = options.main === false ? null : await assign('main', world.ctx(), mainLine, 'core', mainRun);
    const ws2Answer = await assign('ws2', world.ctx('host', ws2), ws2Ref, 'core', ws2Run);
    return { world, mainLine, ws2Ref, ws2Scope, mainAnswer, ws2Answer };
  } catch (error) {
    await world.close();
    worlds.splice(worlds.indexOf(world), 1);
    throw error;
  }
}

describe('R16 b one project-view module held by each workspace (module-maintainer-service.ts:744)', () => {
  it('R16b ws2\'s raw `core` opens ws2\'s view line and main keeps its own `core` line', async () => {
    /* Named mutation: `:744` drops the `scopesInProjectView`/project-view conversion — ws2's raw `core` names
     * main's `core`, so the ws2 assignment is refused (`revision_conflict`, the executor scope is held) instead of
     * `assigned`. */
    const { world, mainLine, ws2Ref, ws2Scope, mainAnswer, ws2Answer } = await r16bWorld();
    if (mainAnswer === null) throw new Error('R16b: the main assignment is missing');
    expect([mainAnswer.status, ws2Answer.status]).toEqual(['assigned', 'assigned']);
    const mainHolder = must('maintainerOf main', await world.platform.moduleMaintainers.maintainerOf(world.ctx(), {
      workspace: { projectId: world.projectId, workspaceId: world.workspaceId },
      module: { projectId: world.projectId, moduleId: 'core' } }));
    const ws2Holder = must('maintainerOf ws2', await world.platform.moduleMaintainers.maintainerOf(world.ctx('host', 'ws2'),
      { workspace: ws2Scope, module: { projectId: world.projectId, moduleId: `/@ws:${encodeURIComponent('ws2')}/core` } }));
    expect(mainHolder).toMatchObject({ status: 'assigned', line: { sessionId: mainLine.sessionId } });
    expect(ws2Holder).toMatchObject({ status: 'assigned', line: { sessionId: ws2Ref.sessionId } });
  }, 180_000);
});

describe('R16 c the maintainer notice shows the raw module id (module-maintainer-service.ts:718)', () => {
  it('R16c one `模块维护者：core ← ` notice, and no project-view id in the summaries', async () => {
    /* Named mutation: `:718` drops `rawModuleRef(...)` — the summary becomes `模块维护者：/@ws:<ws2>/core ← …`. */
    const { world, ws2Answer } = await r16bWorld({ main: false });
    expect(ws2Answer.status).toBe('assigned');
    const queue = await world.platform.decisions.queryDecisionQueue(world.ctx(), {
      workspace: { projectId: world.projectId, workspaceId: world.workspaceId },
      sections: ['notices'], categories: ['project_notice'], page: { limit: 50 } });
    if (queue.status !== 'ready') throw new Error(`R16c queue: ${JSON.stringify(queue)}`);
    const summaries = queue.value.notices.map(item => item.summary).filter(summary => summary.includes('模块维护者：'));
    expect(summaries.filter(summary => summary.startsWith('模块维护者：core ← '))).toHaveLength(1);
    expect(summaries).not.toContain(expect.stringContaining('/@ws:'));
  }, 180_000);
});

describe('G11 the Goal command fingerprint carries `lineFolder` (command-event.ts:105)', () => {
  it('G11 the same requestId with another line folder is `idempotency_conflict`, and the original folder replays', async () => {
    /* Named mutation: `command-event.ts:105` deletes the `lineFolder` spread — the same requestId with a different
     * folder replays the original Goal instead of answering `idempotency_conflict`. */
    const world = await openKLS2AWorld();
    worlds.push(world);
    const wt = join(dirname(world.root), 'kls3a1-g11-wt');
    gitIn(world.root, 'worktree', 'add', '-q', '-b', 'kls3a1-g11', wt);
    gitIn(wt, 'commit', '--allow-empty', '-q', '-m', 'g11');
    await registerLine(world, world.root, 'kls3a1-g11-main');
    await registerLine(world, wt, 'kls3a1-g11-wt');
    const mainFolder = kls3a1Checkout(world.root).line.folder;
    const wtFolder = kls3a1Checkout(wt).line.folder;
    const create = async (lineFolder: string) => await world.platform.goals.createGoal(world.ctx(), {
      meta: { requestId: 'kls3a1-g11-goal', expected: await world.scopePins() },
      input: { goalId: 'kls3a1-g11-goal', workspace: { projectId: world.projectId, workspaceId: world.workspaceId },
        objective: 'KLS3A1 g11', lineFolder } });
    const first = await create(mainFolder);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') throw new Error(`G11 first create: ${JSON.stringify(first)}`);
    expect(await create(wtFolder)).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await create(mainFolder)).toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor,
      value: { ref: first.value.ref, objective: 'KLS3A1 g11' } });
  });
});
