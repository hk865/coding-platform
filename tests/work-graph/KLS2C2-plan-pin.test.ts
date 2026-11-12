/**
 * KLS-2c-2 (test writer), K24–K27: the knowledge pin of a plan candidate ([2C2-01]–[2C2-03], fourth-round ruling),
 * read from the answer of the plan owner's public propose (`plans.proposePlan`, published as `plans/propose`).
 * Memory only (S3): `openKLS2AWorld` (git roots) and the S8D fixture without git; the architecture from the public
 * adoption; a person edits files and commits with real git. Expected values by hand: `lineRef` = JSON [workspace,
 * branch] ('' when not git), `head` = `git rev-parse HEAD`, minimal fields as adopted, K26's hash over `git hash-object`.
 * New name used: the plan record pin `KnowledgePinV1` ({ lines }), read through `unknown`, so the file type-checks on
 * both trees; while the candidate carries `{catalogRef, baseline}` every row is red in `pinLines`.
 */
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { openKLS2AWorld, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { fixture as platformFixture } from '../helpers/S8D-platform-fixture.js';
import { gitIn } from '../scenarios/support/git-workspace.js';

/** One line of a plan's pin ([2C2-01]; SEAM-2C2 `KnowledgeLinePinV1`). */
type PinLine = { lineRef: string; contentHash: string; head: string | null; dirty: boolean; modules: unknown };
/** One workspace of a platform, called as the Host's operator. */
type Caller = { platform: KLS2AWorld['platform']; ctx: CoreCallContext; scope: WorkspaceScope };

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });

async function gitWorld(workspaces?: string[]): Promise<KLS2AWorld> {
  const world = await openKLS2AWorld(workspaces === undefined ? {} : { workspaces });
  closers.push(() => world.close());
  return world;
}
const callerIn = (world: KLS2AWorld, workspaceId = world.workspaceId): Caller =>
  ({ platform: world.platform, ctx: world.ctx('host', workspaceId), scope: { projectId: world.projectId, workspaceId } });

const HEX64 = expect.stringMatching(/^[0-9a-f]{64}$/);
/** [2C2-01]: a module's minimal fields, as `adoptModules` adopts it in the main workspace (no containment, no edges). */
const minimalOf = (moduleId: string) =>
  ({ moduleId, paths: [`src/${moduleId}`], responsibility: `own ${moduleId}`, contains: [], dependsOn: [] });
/** The line key by hand: the workspace and the branch, a JSON array. */
const lineKeyOf = (workspaceId: string, branch: string): string => JSON.stringify([workspaceId, branch]);
const gitHead = (root: string): string => gitIn(root, 'rev-parse', 'HEAD').trim();
const gitBranch = (root: string): string => gitIn(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();

async function registrationPins(caller: Caller) {
  const read = await caller.platform.projects.readWorkspaceRegistration(caller.ctx, caller.scope);
  if (read.status !== 'ready') throw new Error(`KLS2C2: the registration read failed: ${JSON.stringify(read)}`);
  return [{ ref: read.value.project.ref, revision: read.value.project.revision },
    { ref: read.value.workspace.ref, revision: read.value.workspace.revision }];
}

/** The public initial adoption: one module per id, on `src/<id>` of the caller's (main) workspace, `own <id>`. */
async function adoptModules(caller: Caller, moduleIds: string[]): Promise<void> {
  const adopted = await caller.platform.architecture.adoptInitialArchitecture(caller.ctx, {
    meta: { requestId: 'kls2c2-adopt', expected: await registrationPins(caller) },
    input: { baselineId: 'kls2c2-baseline', description: 'KLS2C2', constraints: [], catalog: { requireDag: true,
      dependencies: [], modules: moduleIds.map(moduleId => ({ ref: { projectId: caller.scope.projectId, moduleId },
        name: moduleId, responsibility: `own ${moduleId}`, paths: [`src/${moduleId}`], interfaces: [] })) } } });
  if (adopted.status !== 'committed') throw new Error(`KLS2C2: the adoption did not commit: ${JSON.stringify(adopted)}`);
}

/** A Goal in the caller's workspace (`goals.createGoal`). */
async function goalIn(caller: Caller, goalId: string): Promise<GoalRef> {
  const created = await caller.platform.goals.createGoal(caller.ctx, { meta: { requestId: goalId,
    expected: await registrationPins(caller) }, input: { goalId, workspace: caller.scope, objective: 'KLS2C2 pin' } });
  if (created.status !== 'committed') throw new Error(`KLS2C2: the Goal was not created: ${JSON.stringify(created)}`);
  return created.value.ref;
}

/** A draft whose one required work Task is on `moduleRef` (the caller's frame), with a gate and a `test` obligation. */
const draftOn = (goalId: string, moduleRef: string): PlanRevisionDraft => ({ schemaVersion: 2, planId: 'kls2c2-plan',
  planRevision: 1, goalId, stages: [{ stageId: 's1', title: 'Stage one' }],
  tasks: [
    { taskId: 't1', stageId: 's1', title: 'Work one', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'module', stageId: 's1', moduleRef } },
    { taskId: 'g1', title: 'Gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active',
      phase: 'pending', scope: { kind: 'goal' } },
  ],
  assignments: [{ taskId: 't1', role: 'platform-executor', instruction: 'Work one' }],
  obligations: [{ obligationId: 'o1', title: 'Deliver', requirementLevel: 'required', taskIds: ['t1', 'g1'],
    verificationRequirements: [{ requirementId: 'v1', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } });

let proposals = 0;
/** `plans.proposePlan` of `draftOn` on the Goal; the lines of the candidate's pin. */
async function pinLines(caller: Caller, goal: GoalRef, moduleRef: string): Promise<PinLine[]> {
  const read = await caller.platform.plans.queryGoal(caller.ctx, goal);
  if (read.status !== 'ready') throw new Error(`KLS2C2: the Goal read failed: ${JSON.stringify(read)}`);
  const proposed = await caller.platform.plans.proposePlan(caller.ctx, { meta: { requestId: `kls2c2-propose-${++proposals}`,
    expected: [{ ref: goal, revision: read.value.goal.revision }] }, input: { goalRef: goal, basedOn: null,
    draft: draftOn(goal.goalId, moduleRef), reason: { text: 'KLS2C2 pin', sources: [] } } });
  if (proposed.status !== 'committed') throw new Error(`KLS2C2: the plan was not proposed: ${JSON.stringify(proposed)}`);
  const pin = (proposed.value as unknown as { catalogPin: unknown }).catalogPin;
  expect(pin, 'the candidate carries the plan record pin { lines }').toMatchObject({ lines: expect.any(Array) });
  return (pin as { lines: PinLine[] }).lines;
}

/** [2C2-01] by hand: sha256 hex over the sorted `<path>\0<git blob id>\n` lines (`git hash-object`, not `src`). */
function expectedContentHash(root: string, paths: readonly string[]): string {
  const lines = paths.map(path => `${path}\0${gitIn(root, 'hash-object', '--', path).trim()}\n`).sort();
  return createHash('sha256').update(lines.join(''), 'utf8').digest('hex');
}

it('K24 the content hash counts the architecture files only: a person\'s note edit keeps it, a module file edit '
  + 'moves it', async () => {
  const world = await gitWorld();
  const caller = callerIn(world);
  await adoptModules(caller, ['core']);
  const noted = await world.platform.notes.writeNote(caller.ctx, { commandId: 'kls2c2-k24-note', expectedPointerRevision: null,
    goalId: world.goalRef.goalId, note: { kind: 'decision', topic: 'kls2c2-k24', conclusion: 'k24 的结论', body: 'b',
      anchor: { kind: 'file', path: 'README.md' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
      replaces: [], contradicts: [], coexistWith: [] } as NoteDraftV1 });
  if (noted.status !== 'accepted') throw new Error(`KLS2C2: the note was not accepted: ${JSON.stringify(noted)}`);
  const p1 = await pinLines(caller, world.goalRef, 'core');
  const notePath = `.workbench/notes/${world.workspaceId}/${noted.noteId}.md`;
  world.edit(notePath, `${world.file(notePath)}\n人在正文后面加了一段\n`);
  const p2 = await pinLines(caller, world.goalRef, 'core');
  // 具名改坏：[2C2-01] 的文件集合把 notes/** 也算进去 → 红在这一句。
  expect(p2[0]!.contentHash).toBe(p1[0]!.contentHash);
  const modulePath = `.workbench/modules/${world.files('.workbench/modules')[0]!}`;
  world.edit(modulePath, `${JSON.stringify({ ...JSON.parse(world.file(modulePath)!) as object,
    responsibility: 'own core, edited by a person' }, null, 2)}\n`);
  const p3 = await pinLines(caller, world.goalRef, 'core');
  expect(p3[0]!.contentHash).not.toBe(p1[0]!.contentHash);
});

describe('K25 a line\'s pin is clean, dirty, not git, or one line per workspace the plan reaches', () => {
  it.each<[string, () => Promise<{ lines: PinLine[]; expected: unknown[] }>]>([
    // 具名改坏：clean 时也填 modules → 只这一条红。
    ['① adopted and committed by the person: clean, the HEAD, no modules', async () => {
      const world = await gitWorld();
      const caller = callerIn(world);
      await adoptModules(caller, ['core']);
      gitIn(world.root, 'add', '--', '.workbench');
      gitIn(world.root, 'commit', '-q', '-m', 'the person commits the architecture');
      return { lines: await pinLines(caller, world.goalRef, 'core'), expected: [{ lineRef: lineKeyOf(world.workspaceId,
        gitBranch(world.root)), contentHash: HEX64, head: gitHead(world.root), dirty: false, modules: null }] };
    }],
    ['② three modules adopted, not committed, the plan on `core` only: dirty, `core`\'s minimal fields only', async () => {
      const world = await gitWorld();
      const caller = callerIn(world);
      await adoptModules(caller, ['core', 'web', 'db']);
      return { lines: await pinLines(caller, world.goalRef, 'core'), expected: [{ lineRef: lineKeyOf(world.workspaceId,
        gitBranch(world.root)), contentHash: HEX64, head: gitHead(world.root), dirty: true, modules: [minimalOf('core')] }] };
    }],
    ['③ a folder that is not git: no head, dirty, the minimal fields', async () => {
      const fx = await platformFixture('memory', 'kls2c2-plain', [['README.md', '# kls2c2\n']]);
      closers.push(() => fx.close());
      const caller: Caller = { platform: fx.platform, ctx: fx.ctx, scope: fx.scope };
      await adoptModules(caller, ['core']);
      return { lines: await pinLines(caller, await goalIn(caller, 'kls2c2-plain-goal'), 'core'), expected: [{
        lineRef: lineKeyOf(fx.scope.workspaceId, ''), contentHash: HEX64, head: null, dirty: true,
        modules: [minimalOf('core')] }] };
    }],
    // 具名改坏：[2C2-02] 只钉 Goal 所在工作区那条线 → 只这一条红（lines 只有一条）。
    ['④ the Goal in `ws2` (committed), its Task on the main workspace\'s `core` (not committed): two lines by lineRef',
      async () => {
        const world = await gitWorld(['ws', 'ws2']);
        await adoptModules(callerIn(world), ['core']);
        // KLS2A world: each workspace's git root is `<its temporary directory>/<workspace id>`.
        const ws2Root = join(dirname(world.root), 'ws2');
        gitIn(ws2Root, 'add', '-A');
        gitIn(ws2Root, 'commit', '-q', '--allow-empty', '-m', 'the person commits ws2');
        const ws2 = callerIn(world, 'ws2');
        // The caller's frame (ws2) names the main workspace's module with its prefix.
        return { lines: await pinLines(ws2, await goalIn(ws2, 'kls2c2-ws2-goal'), '/@ws:ws/core'), expected: [
          { lineRef: lineKeyOf('ws', gitBranch(world.root)), contentHash: HEX64, head: gitHead(world.root), dirty: true,
            modules: [minimalOf('core')] },
          { lineRef: lineKeyOf('ws2', gitBranch(ws2Root)), contentHash: HEX64, head: gitHead(ws2Root), dirty: false,
            modules: null },
        ] };
      }],
  ])('%s', async (_entry, propose) => {
    const { lines, expected } = await propose();
    expect(lines).toEqual(expected);
  });
});

it('K26 the content hash is sha256 over the sorted `<path>\\0<blob id>\\n` lines of the two architecture files',
  async () => {
    const world = await gitWorld();
    const caller = callerIn(world);
    await adoptModules(caller, ['core']);
    const files = ['.workbench/architecture.json',
      ...world.files('.workbench/modules').map(name => `.workbench/modules/${name}`)];
    if (files.length !== 2) throw new Error(`KLS2C2: not one architecture file and one module file: ${files.join(', ')}`);
    const [line] = await pinLines(caller, world.goalRef, 'core');
    // 具名改坏：分隔符 \0 改成 ':' → 红在这一句。
    expect(line!.contentHash).toBe(expectedContentHash(world.root, files));
  });

it('K27 architecture files git ignores and nobody committed count as dirty', async () => {
  const world = await gitWorld();
  const caller = callerIn(world);
  // The line `settings/knowledge-local` writes (KLS2A2 H2), written here by the person.
  appendFileSync(join(world.root, '.git', 'info', 'exclude'), '.workbench/\n');
  await adoptModules(caller, ['core']);
  if (gitIn(world.root, 'status', '--porcelain', '--', '.workbench') !== '') {
    throw new Error('KLS2C2: `.workbench/` is not ignored');
  }
  const [line] = await pinLines(caller, world.goalRef, 'core');
  // 具名改坏：dirty 只看 git status（被忽略的未跟踪文件不在里面）→ 红在这一句。
  expect(line!.dirty).toBe(true);
});
