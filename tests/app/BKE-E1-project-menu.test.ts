/**
 * BK-E1 项目菜单（后端）的写测试方新行：E1-01、E1-02、E1-04、E1-05、E1-06、E1-06b、E1-03、E1-07、E1-09，
 * 以及第 1 轮返工的反例 a–e（R-M1 名字、R-M1 失败后重试、R-M3 移出照原来拒绝、R-M4 已登记目录不再 `git init`、
 * R-M6 忘记以后开着的运行时的检查还在）。行表和规则见 `.dsh-ref/n1118/bke-rulings.md` §2、§3。
 *
 * 今天的状态：E1 第一轮生产已经在树上，E1-01…E1-09 的原有格（除本轮按整场行修掉的 E1-09 收尾断言外）为绿；
 * a–e 今天也为绿；f–h 的今天红写在各自格首（生产返工今天不在这棵树上），期望值来自裁定/运行单手算。
 *
 * 只走公开入口：Host 的 settings/core HTTP 路由、真实磁盘步骤、脚本化模型；没有读数据库，也没有手造记录。
 * 设置新字段/新路由都已在公开契约（`SettingsRoutes`）里，测试直接用真的类型。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COLDSTART_ROUTE_QUESTION, adoptColdStartGovernance, coldStartCoarseProposal, coldStartPlanText,
  openS7D2ColdStartWorld, readCurrentPin, readRegistrationPins,
} from '../helpers/S7D2-coldstart-world.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  openingLinesOf, openS6AHostWorld, type S6AHostWorld,
} from '../helpers/S6A-host-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { committedValue, readyValue } from '../helpers/S6A-memory-fixture.js';
import { graphWrite, plain, writeAG2bWorkspace } from '../helpers/AG2b-collaboration-fixture.js';
import {
  armS6B3SettingsFaultsAt, disposeS6B3SettingsWrapper, installS6B3SettingsSpy,
} from '../helpers/S6B3-fixture.js';
import { g8Check, g8ModelId, g8PlanForm, g8Steps, openG8Project, type G8Check } from '../helpers/G8-world.js';
import { cancelSecondGoal, openDwdWorld, remove, snapshotWorkspaces } from '../helpers/S7D2-DWD-world.js';
import { adviserWorkOf, openS7D2RoleLineWorld } from '../helpers/S7D2-role-line-world.js';
import { XWS2A_ADVISER_TOOLS } from '../helpers/XWS2A-world.js';
import { projectStoreLocation } from '../../src/composition/project-store-location.js';
import type { SettingsResponse, SettingsRoutes } from '../../src/app/host-settings-types.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { S6ASession } from '../helpers/S6A-request-fixture.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { QueryJobAnswerRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: Array<{ close(): Promise<void> }> = [];
const temporary: string[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }).catch(() => undefined);
});

/** The new scope a successful `workspaces/open` answers (`R-M1`/`R-M2`). */
function openedScope(answer: SettingsResponse<unknown>, what: string): CoreScope {
  if (answer.status !== 'ready') throw new Error(`BKE-E1: ${what} was refused: ${JSON.stringify(answer)}`);
  const value = answer.value as { scope?: CoreScope };
  const scope = value.scope;
  if (scope === undefined || scope.projectId === '' || scope.workspaceId === '') {
    throw new Error(`BKE-E1: ${what} answered no scope: ${JSON.stringify(answer)}`);
  }
  return scope;
}

/** One Host settings route that must answer `ready`, typed by its published route contract. */
async function settingsReady<K extends keyof SettingsRoutes>(world: S6AHostWorld, route: K,
  input: SettingsRoutes[K]['input'], what: string): Promise<SettingsRoutes[K]['value']> {
  return readyValue<SettingsRoutes[K]['value']>(await world.settings(route, input), what);
}

async function operationsOf(world: S6AHostWorld, scope: CoreScope): Promise<readonly RoleLineOperationReadV1[]> {
  return readyValue<readonly RoleLineOperationReadV1[]>((await world.post('role-lines/operations',
    plain(scope, { workspace: { projectId: scope.projectId, workspaceId: scope.workspaceId } }))).body,
  `role-lines/operations of ${scope.workspaceId}`);
}

/** The cold-start row's `depth` (E1-02's literal values; `depth` is on the `role_line` branch). */
function depthOf(row: RoleLineOperationReadV1): number | undefined {
  if (row.action !== 'role_line') throw new Error('BKE-E1: the operation is not a role line');
  return row.depth;
}

/** `sessions/read` in the workspace a new project's opening lines live in (the S6A world reads its own scope). */
async function readSessionAt(world: S6AHostWorld, scope: CoreScope,
  session: S6ASession | SessionRef): Promise<SessionCard> {
  const ref: SessionRef = 'aggregateRef' in session ? session.ref : session;
  return readyValue<SessionCard>((await world.post('sessions/read', plain(scope, ref))).body,
    `the session ${ref.sessionId}`);
}

/** A fresh empty directory; the caller may open it as a new project. */
async function emptyDirectory(prefix: string): Promise<string> {
  const path = realpathSync(await mkdtemp(join(tmpdir(), prefix)));
  temporary.push(path);
  return path;
}

/** The person's `architecture/revise` over the current public pin and the registration revisions. */
async function reviseCatalogOf(world: S6AHostWorld, scope: CoreScope, ops: readonly unknown[],
  requestId: string): Promise<void> {
  committedValue<Record<string, unknown>>((await world.post('architecture/revise', graphWrite(scope, {
    expected: await readCurrentPin(world, scope), ops, responsibilityMoves: [], reason: `BKE-E1: ${requestId}`,
  }, requestId, await readRegistrationPins(world, scope)))).body, `the catalog revision ${requestId}`);
}

/** The one new project a memory world opens through `workspaces/open`. */
async function openProject(world: S6AHostWorld, input: SettingsRoutes['workspaces/open']['input'],
  what: string): Promise<CoreScope> {
  return openedScope(await world.settings('workspaces/open', input), what);
}

/** The cold-start row of a new project, waiting until the start_lines' secretary step has born it. */
async function waitForColdStartRow(world: S6AHostWorld, scope: CoreScope): Promise<RoleLineOperationReadV1> {
  const operationId = `cold_start:${scope.projectId}`;
  const rows = await waitFor(async () => await operationsOf(world, scope),
    list => list.some(row => row.operation.operationId === operationId),
    `the cold_start row of ${scope.projectId}`);
  const row = rows.find(candidate => candidate.operation.operationId === operationId);
  if (row === undefined) throw new Error(`BKE-E1: no cold_start row in ${JSON.stringify(rows)}`);
  return row;
}

describe('BK-E1 project menu (backend rows)', () => {
  it('E1-01 creates an empty folder and opens it in one call, and refuses a second create of the same name', async () => {
    // Named mutation: delete the `mkdir` in `openWorkspaceImpl`, or make it `recursive: true`.
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const parent = await emptyDirectory('bke-e1-01-');
    const name = 'fresh-project';
    const path = join(parent, name);
    expect(existsSync(path)).toBe(false);

    const scope = await openProject(world, { path, create: { name }, writeAllowed: false, commandsAllowed: false },
      'the created project');

    expect(existsSync(path)).toBe(true);
    // R-M1's folder is empty when created; the open itself writes the platform's own `.workbench` (UNSPECIFIED:
    // the row says "empty", but today's open always adds this one directory). No user file is created.
    expect((await readdir(path)).filter(entry => entry !== '.workbench')).toEqual([]);
    expect(scope.workspaceId.length).toBeGreaterThan(0);

    const again = await world.settings('workspaces/open',
      { path, create: { name }, writeAllowed: false, commandsAllowed: false });
    expect(again.status).toBe('rejected');
    expect(again.status === 'rejected' ? again.code : null).toBe('invalid');
  }, 120_000);

  it('E1-02 passes exploration depths 1/2/3 to the registration and defaults to 2', async () => {
    // Named mutation: delete `explorationDepth` from the `registerWorkspace` input.
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    const cases: Array<{ depth: 1 | 2 | 3 | undefined; label: string }> = [
      { depth: 1, label: 'one' }, { depth: 2, label: 'two' }, { depth: 3, label: 'three' },
      { depth: undefined, label: 'default' },
    ];
    const roots = new Map<string, string>();
    for (const entry of cases) roots.set(entry.label, await emptyDirectory(`bke-e1-02-${entry.label}-`));
    const read: Array<{ label: string; depth: number | undefined }> = [];
    for (const entry of cases) {
      const scope = await openProject(world, {
        path: roots.get(entry.label)!,
        ...(entry.depth === undefined ? {} : { explorationDepth: entry.depth }),
        writeAllowed: false, commandsAllowed: false,
      }, `the ${entry.label} project`);
      read.push({ label: entry.label, depth: depthOf(await waitForColdStartRow(world, scope)) });
    }
    expect(read).toEqual([
      { label: 'one', depth: 1 }, { label: 'two', depth: 2 }, { label: 'three', depth: 3 },
      { label: 'default', depth: 2 },
    ]);
  }, 180_000);

  it('E1-04 directories reports whether the listed directory is a git repository and its drive reliability', async () => {
    // Named mutation: negate `gitCommonDir(canonical) !== null`.
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const gitRoot = await emptyDirectory('bke-e1-04-git-');
    execFileSync('git', ['init', '--quiet', gitRoot]);
    const plainRoot = await emptyDirectory('bke-e1-04-plain-');

    const gitRead = await settingsReady(world, 'directories', { path: gitRoot }, 'the git directory listing');
    const plainRead = await settingsReady(world, 'directories', { path: plainRoot }, 'the plain directory listing');

    expect(gitRead.isGitRepository).toBe(true);
    expect(gitRead.driveReliability).toBe('reliable');
    expect(plainRead.isGitRepository).toBe(false);
    expect(plainRead.driveReliability).toBe('reliable');
  }, 120_000);

  it('E1-05 projectStoreLocation names the reason code for a user-data store', async () => {
    // Named mutation: fill both `reasonCode` values with `null`.
    const root = await emptyDirectory('bke-e1-05-root-');
    const userDataRoot = await emptyDirectory('bke-e1-05-user-');
    const read = async (reliability: 'unreliable' | 'unknown'): Promise<Record<string, unknown>> => {
      const result = await projectStoreLocation('bke-e1-05-project', root, {
        mountReliability: async () => reliability,
        userDataRoot: () => userDataRoot,
      });
      if (result.status !== 'ready') throw new Error(`BKE-E1: the store location was refused: ${JSON.stringify(result)}`);
      return result.value as unknown as Record<string, unknown>;
    };
    expect(await read('unreliable')).toMatchObject({
      place: 'user-data', reasonCode: 'unreliable_drive',
    });
    expect(await read('unknown')).toMatchObject({
      place: 'user-data', reasonCode: 'unknown_drive',
    });
    expect((await read('unreliable'))['reason']).toEqual(expect.any(String));
    expect((await read('unknown'))['reason']).toEqual(expect.any(String));
  }, 60_000);

  it('E1-06 marks a missing folder and forgets the project, then reads it present again when the root is back (SQLite only)', async () => {
    // Named mutation: write `folderPresent` inverted, or keep the "every workspace missing" threshold. This opens
    // the project through `workspaces/open` (as the row does), so its root is a listed project on the restart and may
    // be absent without failing the Host start.
    const world = await openS6AHostWorld({ backend: 'sqlite' });
    worlds.push(world);
    const root = await emptyDirectory('bke-e1-06-project-');
    const project = await openProject(world, { path: root, writeAllowed: false, commandsAllowed: false },
      'the project E1-06 forgets');
    const away = `${root}-away`;
    temporary.push(away);
    const workspaceRowOf = (snapshot: SettingsRoutes['snapshot']['value']): SettingsRoutes['snapshot']['value']['workspaces'][number] | undefined =>
      snapshot.workspaces.find(row => row.scope.projectId === project.projectId);

    await rename(root, away);
    await world.reopen();
    let snapshot = await settingsReady(world, 'snapshot', {}, 'the snapshot after the move');
    expect(workspaceRowOf(snapshot)?.folderPresent).toBe(false);

    await rename(away, root);
    await world.reopen();
    snapshot = await settingsReady(world, 'snapshot', {}, 'the snapshot after the return');
    expect(workspaceRowOf(snapshot)?.folderPresent).toBe(true);
    const refused = await world.settings('projects/forget', { projectId: project.projectId });
    expect(refused.status).toBe('rejected');
    expect(refused.status === 'rejected' ? refused.code : null).toBe('invalid');

    await rename(root, away);
    await world.reopen();
    snapshot = await settingsReady(world, 'snapshot', {}, 'the snapshot before forget');
    expect(workspaceRowOf(snapshot)?.folderPresent).toBe(false);
    const forgotten = await world.settings('projects/forget', { projectId: project.projectId });
    expect(forgotten.status).toBe('ready');
    const after = await settingsReady(world, 'snapshot', {}, 'the snapshot after forget');
    expect(after.workspaces.some(row => row.scope.projectId === project.projectId)).toBe(false);
  }, 180_000);

  it('E1-06b forgets a project whose main folder is gone while the second workspace is still there (SQLite only)', async () => {
    // Named mutation: change the condition back to every workspace missing.
    const world = await openS6AHostWorld({ backend: 'sqlite' });
    worlds.push(world);
    const mainRoot = await emptyDirectory('bke-e1-06b-main-');
    const main = await openProject(world, { path: mainRoot, writeAllowed: false, commandsAllowed: false },
      'the project E1-06b forgets');
    const secondRoot = await emptyDirectory('bke-e1-06b-second-');
    const second = await openProject(world, {
      path: secondRoot, projectId: main.projectId, writeAllowed: false, commandsAllowed: false,
    }, 'the second workspace');
    let snapshot = await settingsReady(world, 'snapshot', {}, 'the two-workspace snapshot');
    expect(snapshot.workspaces.filter(row => row.scope.projectId === main.projectId)).toHaveLength(2);

    await rm(mainRoot, { recursive: true, force: true });
    await world.reopen();
    snapshot = await settingsReady(world, 'snapshot', {}, 'the snapshot with the main folder gone');
    const mainRow = snapshot.workspaces.find(row => row.scope.workspaceId === main.workspaceId);
    const secondRow = snapshot.workspaces.find(row => row.scope.workspaceId === second.workspaceId);
    expect(mainRow?.folderPresent).toBe(false);
    expect(secondRow?.folderPresent).toBe(true);

    const forgotten = await world.settings('projects/forget', { projectId: main.projectId });
    expect(forgotten.status).toBe('ready');
    const after = await settingsReady(world, 'snapshot', {}, 'the snapshot after forget');
    expect(after.workspaces.some(row => row.scope.projectId === main.projectId)).toBe(false);
    expect(existsSync(secondRoot)).toBe(true);
  }, 180_000);

  it('E1-03 reads main/inGraph on the main row and neither on the second workspace', async () => {
    // Named mutation: use `workspaces[0]` as the main workspace, or force `inGraph` true.
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    await cold.advanceTo('regions');
    const mainRow = await cold.coldStart();
    expect(mainRow.main).toBe(true);
    expect(mainRow.inGraph).toBe(true);

    const secondRoot = await emptyDirectory('bke-e1-03-second-');
    const second = openedScope(await cold.host.settings('workspaces/open', {
      path: secondRoot, projectId: S6A_SCOPE.projectId, writeAllowed: false, commandsAllowed: false,
    }), 'the second workspace');
    const rows = await waitFor(async () => await operationsOf(cold.host, second),
      list => list.some(row => row.action === 'role_line'), 'the second workspace join row');
    const join = rows.find(row => row.action === 'role_line');
    expect(join!.main).toBe(false);
    expect(join!.inGraph).toBe(false);
  }, 180_000);

  it('E1-07 reads awaitingTopLevelApproval while the coarse card waits and false after it is answered', async () => {
    // Named mutation: drop the "card unanswered" term and read only `actionPhase`.
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    await cold.advanceTo('coarse_split');
    await cold.waitFor('the coarse-split card', async () => (await cold.proposalCards()).length > 0);
    const waiting = await cold.coldStart();
    expect(waiting.actionPhase).toBe('coarse_split');
    expect(waiting.awaitingTopLevelApproval).toBe(true);

    await cold.approve((await cold.proposalCards())[0]!, 'bke-e1-07-approve');
    await cold.waitForPhase('regions');
    const answered = await cold.coldStart();
    expect(answered.awaitingTopLevelApproval).toBe(false);
  }, 180_000);

  it('E1-09 goes from a created project to the first initial architecture card that can be adopted', async () => {
    // Today: the created project opens and the cold start drives (R-M1/R-M2/R-M7 are on the tree); the row checks the
    // whole run to the first adoptable card. Named mutation: delete the existing `coldStart.drive` wiring
    // (`create-platform.ts`), so the project is created but no cold start ever happens.
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    const catalog = await settingsReady(world, 'snapshot', {}, 'the Host model catalog');
    const model = catalog.models[0];
    if (model === undefined) throw new Error('BKE-E1: the Host catalog has no model');
    const parent = await emptyDirectory('bke-e1-09-');
    const name = 'first-project';
    const root = join(parent, name);
    const scope = openedScope(await world.settings('workspaces/open', {
      path: root, create: { name }, modelId: model.id, writeAllowed: true, commandsAllowed: false,
    }), 'the E1-09 project');
    expect(existsSync(root)).toBe(true);
    expect(scope.workspaceId.length).toBeGreaterThan(0);

    const lines = await openingLinesOf({ post: (suffix, body) => world.post(suffix, body),
      readSession: session => readSessionAt(world, scope, session) }, scope);
    const cards = s6aCardsWorkspace(world, scope);
    // The shared cold-start plan assigns the S6A Work/adviser roles; this new project's built-in bindings serve
    // `local-workbench`, so the same plan's assignments name that served role (the public plan body).
    const plan = JSON.parse(coldStartPlanText('bke-e1-09')) as { plan: { assignments: Array<{ taskId: string;
      role: string; instruction: string }> } };
    plan.plan.assignments = plan.plan.assignments.map(assignment => ({ ...assignment, role: 'local-workbench' }));
    await world.scripted.script(lines.secretary, [{ kind: 'text', text: JSON.stringify(plan) }], scope);
    const initial = await cards.submit({ label: 'bke-e1-09-initial', goalId: null,
      text: 'BKE-E1: prepare the first plan', recipient: lines.secretary.ref });
    if (initial.secretary === null) throw new Error('BKE-E1: the initial request was not assigned');
    expect(initial.requestRoot.projectId).toBe(scope.projectId);
    const requestView = async (): Promise<RequestCoreViewV1> =>
      readyValue<RequestCoreViewV1>((await world.post('requests/read',
        plain(scope, { requestRoot: initial.requestRoot }))).body, 'the E1-09 request read');
    await waitFor(requestView, view => view.rounds.some(round => round.ref.queryJobId === initial.round.queryJobId
      && round.status === 'ended'), 'the initial plan round to end');
    const job = readyValue<QueryJobRecord>((await world.post('queries/read', plain(scope, initial.round))).body,
      'the initial plan Query');
    const answerRef = job.job.job.answerRefs.at(-1);
    if (answerRef === undefined) throw new Error('BKE-E1: the initial plan saved no answer');
    const answer = readyValue<{ answer: { answer: string } }>((await world.post('queries/answer',
      plain(scope, answerRef))).body, 'the initial plan answer');
    expect(answer.answer.answer).toContain('"kind"');

    // The cold start's adopted phase: the same public governance steps as the shared cold-start world
    // (`adoptColdStartGovernance`), run on this project's scope instead of the seed's `S6A_SCOPE`.
    await adoptColdStartGovernance(world, scope);
    const confirmed = committedValue<Record<string, unknown>>((await world.post('goals/confirm-draft', plain(scope, {
      commandId: 'bke-e1-09-confirm', round: initial.round, index: 0,
    }))).body, 'the draft confirmation');
    const goal = (confirmed['goal'] as { ref: GoalRef }).ref;
    const pin = readyValue<{ baseline: { ref: unknown; contentDigest: string }; catalog: { ref: unknown } }>(
      (await world.post('architecture/read', plain(scope, { selection: { kind: 'current' } }))).body,
      'the current architecture');
    const baseCatalogPin = { catalogRef: pin.catalog.ref,
      baseline: { ref: pin.baseline.ref, digest: pin.baseline.contentDigest } };
    await world.scripted.script(lines.secretary, [
      { kind: 'text', text: secretaryAnswer({ body: 'BKE-E1: split the map between the advisers' }) },
      { kind: 'text', text: secretaryAnswer({ body: 'split' }) },
    ], scope);
    await world.scripted.script(lines.adviser, [
      { kind: 'calls', calls: [{ callId: 'bke-e1-09-coarse', name: 'propose_architecture_revision',
        args: { baseCatalogPin, ops: coldStartCoarseProposal(scope.projectId).ops, responsibilityMoves: [],
          reason: 'coarse split' } }] },
      { kind: 'text', text: 'BKE-E1: the coarse split is proposed' },
    ], scope);
    committedValue<Record<string, unknown>>((await world.post('initialization/adopt', plain(scope, {
      commandId: 'bke-e1-09-adopt', expectedAnswerDigest: sha256Hex(answer.answer.answer),
      source: { kind: 'binding', answerRef, draftIndex: 0 }, expectedGoal: { ref: goal, revision: 1 },
    }))).body, 'the initialization adoption');

    // The route phase's question and the person's `split` continuation, then the coarse card.
    const route = await waitFor(requestView, view => view.rounds.some(round => round.input === COLDSTART_ROUTE_QUESTION),
      'the cold-start route question');
    const routeRound = route.rounds.find(round => round.input === COLDSTART_ROUTE_QUESTION);
    if (routeRound === undefined) throw new Error('BKE-E1: the route round disappeared');
    await waitFor(requestView, view => view.rounds.some(round => round.ref.queryJobId === routeRound.ref.queryJobId
      && round.status === 'ended'), 'the route round to end');
    const continuation = (await world.post('requests/submit', plain(scope, {
      commandId: 'bke-e1-09-split', goalId: null, text: 'split', continues: initial.requestRoot, recipient: null,
    }))).body as { status?: string; round?: { queryJobId: string } };
    expect(continuation.status).toBe('queued');
    const splitRound = continuation.round;
    if (splitRound === undefined) throw new Error('BKE-E1: the split continuation queued no round');
    await waitFor(requestView, view => view.rounds.some(round =>
      round.ref.queryJobId === splitRound.queryJobId && round.status === 'ended'), 'the split round to end');

    const card = await waitFor(async () => (await cards.readCards()).find(candidate =>
      candidate.source.kind === 'structural_proposal' && candidate.state === 'waiting_answer'),
    candidate => candidate !== undefined, 'the first initial architecture card');
    const adopted = (await world.post('decisions/answer', graphWrite(scope, {
      source: card!.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
    }, 'bke-e1-09-approve', card!.source.pins))).body as { status?: string;
      value?: { application?: { status?: string } } };
    expect(adopted.status).toBe('ready');
    expect(adopted.value?.application?.status).toBe('committed');
    // The row's own expectation is the whole cold start (`冷启动走完`), not one transient phase: after the first
    // adoption the drive may pass `regions` and `proposals` before this read, and the record ends `completed`.
    const rows = await waitFor(async () => await operationsOf(world, scope),
      list => list.some(row => row.action === 'role_line' && row.operation.operationId === `cold_start:${scope.projectId}`
        && row.phase === 'completed'), 'the cold start to finish after the first adoption');
    expect(rows.some(row => row.action === 'role_line' && row.operation.operationId === `cold_start:${scope.projectId}`
      && row.phase === 'completed')).toBe(true);
  }, 240_000);

  it('a R-M1 names a created project and its workspace by create.name, not by the separate name', async () => {
    // 今天绿：带 `create: { name: 'alpha' }` 同时给 `name: 'beta'` 时，快照读到的项目/工作区名仍是 `alpha`。
    // R-M1 要“名字同时是文件夹名和项目名”。具名变异（未执行）：保留先取 `request.name` 的写法。
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const parent = await emptyDirectory('bke-e1-a-');
    const root = join(parent, 'alpha');
    const answer = await world.settings('workspaces/open', {
      path: root, create: { name: 'alpha' }, name: 'beta', writeAllowed: false, commandsAllowed: false,
    });
    const scope = openedScope(answer, 'the alpha project');
    expect(scope.workspaceId.length).toBeGreaterThan(0);
    expect(existsSync(root)).toBe(true);

    const snapshot = await settingsReady(world, 'snapshot', {}, 'the snapshot of the created project');
    expect(snapshot.workspaces.find(row => row.scope.workspaceId === scope.workspaceId)?.name).toBe('alpha');
    const bootstrap = answer.status === 'ready' ? answer.value.bootstrap : null;
    expect(bootstrap?.workspaces.find(row => row.scope.workspaceId === scope.workspaceId)?.name).toBe('alpha');
  }, 120_000);

  it('b R-M1 after a settings write fails, the same open without create recovers the mounted scope', async () => {
    // 今天绿：失败后的提示是 `retry workspaces/open with the same path and without create`。具名变异（未执行）：
    // 把这两句原因改回 `retry the same open`。
    const restore = installS6B3SettingsSpy();
    const settingsDirectory = await mkdtemp(join(tmpdir(), 'bke-e1-b-settings-'));
    temporary.push(settingsDirectory);
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { settings: { settingsDirectory } } });
    worlds.push(world);
    try {
      const parent = await emptyDirectory('bke-e1-b-');
      const name = 'retry-project';
      const root = join(parent, name);
      const arm = armS6B3SettingsFaultsAt(settingsDirectory, 'before-notify');
      const first = await world.settings('workspaces/open', {
        path: root, create: { name }, writeAllowed: false, commandsAllowed: false,
      });
      arm.release();
      expect(first.status).toBe('rejected');
      expect(first.status === 'rejected' ? first.reason : '').toContain('without create');

      // The failed open left the folder and the mounted registration behind (R-M1 does not roll back); the mounted
      // scope is the one the retry must answer, read through the public snapshot.
      const mountedSnapshot = await settingsReady(world, 'snapshot', {}, 'the snapshot after the failed open');
      const mounted = mountedSnapshot.workspaces.find(row => row.root === realpathSync(root));
      if (mounted === undefined) throw new Error('BKE-E1: the failed open left no mounted workspace');
      const retried = openedScope(await world.settings('workspaces/open', {
        path: root, writeAllowed: false, commandsAllowed: false,
      }), 'the same open without create');
      expect(retried).toEqual(mounted.scope);
    } finally {
      await disposeS6B3SettingsWrapper();
      restore();
    }
  }, 120_000);

  it('c R-M3 removing a workspace reads the current knowledge files, so a broken file rejects the removal', async () => {
    // 今天绿：移出（`workspaces/remove`）读当前知识文件，坏文件回 `unavailable`。具名变异（未执行）：把移出的
    // facts 换回 `readRecordedCatalogWindow`。
    const world = await openDwdWorld({ backend: 'memory', withModule: true });
    worlds.push(world);
    const second = world.second.scope;
    // The removal itself requires no unfinished target on the workspace; the DWD rows cancel the second Goal first.
    await cancelSecondGoal(world);

    // KC-3's public way to break a knowledge file: a person writes invalid JSON over it, then the next real removal
    // reads the files again. The recorded catalog (the operations row's source) stays readable.
    await writeFile(join(world.base.world.root, '.workbench', 'architecture.json'), '{ "modules": [');
    const removed = await remove(world, 'remove', second);
    expect(removed.status).toBe('rejected');
    expect(removed.status === 'rejected' ? removed.code : null).toBe('unavailable');
    expect((await snapshotWorkspaces(world)).some(row => row.scope.workspaceId === second.workspaceId)).toBe(true);

    const operations = readyValue<readonly RoleLineOperationReadV1[]>((await world.base.world.post('role-lines/operations',
      plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body, 'the main workspace operations after the broken file');
    expect(operations.length).toBeGreaterThan(0);
  }, 240_000);

  it('d R-M4 does not git-init an already registered folder and still wires the first gitInit (SQLite only)', async () => {
    // 今天绿：已登记根先被认出，同一个普通目录第二次带 `gitInit: true` 打开回 `invalid`。具名变异（未执行）：
    // 保留“先 git init、后查已登记根”的顺序。
    // 今天绿的第一段：新目录首次带 `gitInit: true` 正常接线。它的具名变异（删掉 `gitInit` 的 `git init` 块）已在
    // 本副本上实际施加一次，本行红在 `isGitRepository === true`，结果记在回复里。
    const world = await openS6AHostWorld({ backend: 'sqlite' });
    worlds.push(world);

    // The first wiring, on a new empty folder: `gitInit: true` makes the folder a repository.
    const firstRoot = await emptyDirectory('bke-e1-d-first-');
    openedScope(await world.settings('workspaces/open', {
      path: firstRoot, gitInit: true, writeAllowed: false, commandsAllowed: false,
    }), 'the first git-init project');
    expect((await settingsReady(world, 'directories', { path: firstRoot }, 'the first git directory')).isGitRepository)
      .toBe(true);

    // A registered plain folder: its store is workspace-local, and a later `gitInit` must be refused before it changes
    // the folder, because that would change the store the next start looks for.
    const plainRoot = await emptyDirectory('bke-e1-d-plain-');
    const plain = openedScope(await world.settings('workspaces/open', {
      path: plainRoot, writeAllowed: false, commandsAllowed: false,
    }), 'the plain project');
    expect((await settingsReady(world, 'directories', { path: plainRoot }, 'the plain directory')).isGitRepository)
      .toBe(false);
    const before = await settingsReady(world, 'snapshot', {}, 'the snapshot before the refused git init');
    const beforeRow = before.workspaces.find(row => row.scope.workspaceId === plain.workspaceId);
    expect(beforeRow?.storeLocation?.place).toBe('workspace-local');

    const refused = await world.settings('workspaces/open', {
      path: plainRoot, gitInit: true, writeAllowed: false, commandsAllowed: false,
    });
    expect(refused.status).toBe('rejected');
    expect(refused.status === 'rejected' ? refused.code : null).toBe('invalid');
    expect((await settingsReady(world, 'directories', { path: plainRoot }, 'the still-plain directory')).isGitRepository)
      .toBe(false);

    // The same path without `gitInit` still opens the same scope, and a Host restart keeps the project and its store.
    const reopened = openedScope(await world.settings('workspaces/open', {
      path: plainRoot, writeAllowed: false, commandsAllowed: false,
    }), 'the plain project reopened without gitInit');
    expect(reopened).toEqual(plain);
    const later = await settingsReady(world, 'snapshot', {}, 'the snapshot after the refused git init');
    expect(later.workspaces.find(row => row.scope.workspaceId === plain.workspaceId)?.storeLocation)
      .toEqual(beforeRow?.storeLocation);

    await world.reopen();
    const restarted = await settingsReady(world, 'snapshot', {}, 'the snapshot after the Host restart');
    const restartedRow = restarted.workspaces.find(row => row.scope.workspaceId === plain.workspaceId);
    expect(restartedRow?.scope).toEqual(plain);
    expect(restartedRow?.folderPresent).toBe(true);
    expect(restartedRow?.storeLocation).toEqual(beforeRow?.storeLocation);
  }, 180_000);

  it('f R-M8 a frozen coarse batch whose adopted catalog moved states no roundsAfterApproval', async () => {
    // Today RED: `expected 4 to be undefined` — the card still reads `roundsAfterApproval` after the adopted catalog
    // moved; the source applies the batch ops to the current catalog and never compares `batch.baseCatalogPin` with
    // the window pin.
    // Named mutation: require `batch.baseCatalogPin` to equal the window pin before computing the number
    // (production rework is not on this tree — 未执行).
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    await cold.advanceTo('coarse_split');
    const before = await waitFor(async () => (await cold.proposalCards())[0], card => card !== undefined,
      'the coarse-split card before the catalog moves');
    // Default depth 2, two top-level modules in the batch (region, other): 1 + (2 - 1) × 2 = 3.
    expect(before!.roundsAfterApproval).toBe(3);

    await reviseCatalogOf(cold.host, S6A_SCOPE, [{ op: 'add_module', module: {
      ref: { projectId: S6A_SCOPE.projectId, moduleId: 'bke-e1-unrelated' }, name: 'bke-e1-unrelated',
      responsibility: 'an unrelated top-level module', paths: ['bke-e1-unrelated'], interfaces: [],
    } }], 'bke-e1-f-revise');
    const after = await waitFor(async () => (await cold.proposalCards()).find(card => card.cardKey === before!.cardKey),
      card => card !== undefined, 'the same coarse-split card after the catalog moved');
    expect(after!.roundsAfterApproval).toBeUndefined();
  }, 240_000);

  it('g R-M8 a joining workspace coarse card states the split rounds at depth 3', async () => {
    // Today RED: `expected undefined to be 7` — the card source only accepts `cold_start` exploration entries, so the
    // batch whose members name the `workspace_join` Query gets no number.
    // Named mutation: read the join record's depth/route/explorations as well (production rework is not on this tree —
    // 未执行).
    const world = await openS7D2RoleLineWorld({ backend: 'memory',
      extraBindings: [adviserWorkOf([...XWS2A_ADVISER_TOOLS], true)] });
    worlds.push(world);
    const asked = await world.world.settings('structural-approval/save',
      { projectId: S6A_SCOPE.projectId, value: { proposals: 'ask', repairs: 'ask' } });
    expect(asked.status).toBe('ready');
    const pin = await readCurrentPin(world.world);
    await world.world.scripted.script(world.lines.adviser, [{ kind: 'calls', calls: [{
      callId: 'bke-e1-g-join', name: 'propose_architecture_revision', args: { baseCatalogPin: pin,
        ops: [{ op: 'add_module', module: { ref: { projectId: S6A_SCOPE.projectId, moduleId: 'second-mod' },
          name: 'second-mod', responsibility: 'the joining workspace module', paths: ['src/second'], interfaces: [] } }],
        responsibilityMoves: [], reason: 'BKE-E1: the joining workspace coarse split' } }] },
    { kind: 'text', text: 'BKE-E1: the joining workspace coarse split is proposed' }]);

    const secondRoot = await emptyDirectory('bke-e1-g-second-');
    const second = openedScope(await world.world.settings('workspaces/open', { path: secondRoot,
      projectId: S6A_SCOPE.projectId, explorationDepth: 3, writeAllowed: false, commandsAllowed: false }),
    'the joining workspace');
    const joinId = `workspace_join:${second.workspaceId}`;
    await waitFor(async () => await operationsOf(world.world, second), rows => rows.some(row =>
      row.action === 'role_line' && row.operation.operationId === joinId
      && (row.explorations ?? []).some(entry => entry.segment === 'coarse_split')),
    'the joining workspace coarse-split exploration');
    const card = await waitFor(async () => (await world.cards()).find(candidate =>
      candidate.source.kind === 'structural_proposal' && candidate.state === 'waiting_answer'),
    candidate => candidate !== undefined, 'the joining workspace coarse card');
    // The project's catalog top level is `src` and `docs`; the join adds `second-mod`: M = 3. At depth 3 the split
    // takes 1 + (3 - 1) × M = 7 rounds.
    const topLevelModules = 3;
    expect(card!.roundsAfterApproval).toBe(1 + 2 * topLevelModules);
  }, 240_000);

  it('h R-M6 a new approval on a workspace with a hidden descriptor installs the approved checks', async () => {
    // Today RED: `expected [ 'bke-e1-old' ] to deeply equal [ 'bke-e1-new' ]` — saving the visible B descriptor leaves
    // the hidden same-scope descriptor in the list; the Host installs it last and its old checks replace the approval.
    // Named mutation: remove the hidden same-scope descriptor when saving (production rework is not on this tree —
    // 未执行).
    const world = await openS6AHostWorld({ backend: 'memory', defaultGoals: false,
      extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    const modelId = await g8ModelId(world);
    const mainRoot = await emptyDirectory('bke-e1-h-main-');
    await writeAG2bWorkspace(mainRoot);
    const main = openedScope(await world.settings('workspaces/open',
      { path: mainRoot, modelId, writeAllowed: false, commandsAllowed: false }), 'the main workspace A');
    const bRoot = await emptyDirectory('bke-e1-h-b-');
    await writeAG2bWorkspace(bRoot);
    const scope = openedScope(await world.settings('workspaces/open', { path: bRoot, projectId: main.projectId,
      modelId, writeAllowed: true, commandsAllowed: true }), 'the second workspace B');
    const installedChecks = async (): Promise<string[]> => {
      const answer = await world.post('verification/installed-checks', plain(scope, { scope }));
      return readyValue<{ checks: Array<{ checkId: string }> }>(answer.body,
        'the installed checks of B').checks.map(check => check.checkId);
    };
    // Before the first adoption every request is an initial-coordination round, so its saved Answer can carry the
    // setup checks `checks/approve` reads.
    const steps = g8Steps(world, scope, 'bke-e1-h');
    const secretary = await steps.line('bke-e1-h-checks-secretary');
    const askWithChecks = async (label: string, checks: readonly G8Check[]): Promise<QueryJobAnswerRef> => {
      const plan = g8PlanForm(label, 'local-workbench');
      plan['assignments'] = [];
      (plan['tasks'] as Array<Record<string, unknown>>)[0]!.executionIntent = 'plan_only';
      await world.scripted.script(secretary, [{ kind: 'calls', calls: [{
        callId: `${label}-initial`, name: 'submit_initial_plan', args: {
          summary: `${label} summary`, plan,
          goalCardDrafts: [{ objective: `${label} goal`, completion: [`${label} done`],
            autonomy: 'after_plan_confirmation', screening: null }], planDraftIndex: 0,
          setup: { architecture: { baselineId: `${label}-baseline`, description: 'BKE-E1 R-M6', constraints: [],
            catalog: { modules: [], dependencies: [] } },
          completionPolicy: { requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
          checks: [...checks] } } }] }], scope);
      const initial = await steps.ask(label, secretary);
      const job = await steps.read<QueryJobRecord>('queries/read', initial.round);
      const answerRef = job.job.job.answerRefs.at(-1);
      if (answerRef === undefined) throw new Error(`BKE-E1: the ${label} checks answer was not saved`);
      return answerRef;
    };
    const oldAnswer = await askWithChecks('bke-e1-h-old', [g8Check('bke-e1-old', 'all')]);
    const old = await world.settings('checks/approve', { scope,
      answerRef: oldAnswer, checks: [g8Check('bke-e1-old', 'all')] });
    expect(old.status).toBe('ready');
    expect(await installedChecks()).toEqual(['bke-e1-old']);
    const newAnswer = await askWithChecks('bke-e1-h-new', [g8Check('bke-e1-new', 'all')]);

    const away = `${bRoot}-away`;
    temporary.push(away);
    await rename(bRoot, away);
    const forgotten = await world.settings('projects/forget', { projectId: main.projectId });
    expect(forgotten.status).toBe('ready');
    // A is the main workspace and still present, so reopening it is the one missing step that clears the Host's
    // forget; B becomes visible again when its folder returns, while its hidden descriptor (with the old checks)
    // stays behind.
    openedScope(await world.settings('workspaces/open',
      { path: mainRoot, modelId, writeAllowed: false, commandsAllowed: false }), 'the reopened main workspace A');
    await rename(away, bRoot);
    const back = await settingsReady(world, 'snapshot', {}, 'the snapshot with B back');
    expect(back.workspaces.find(row => row.scope.workspaceId === scope.workspaceId)?.folderPresent).toBe(true);

    const approved = await world.settings('checks/approve', { scope,
      answerRef: newAnswer, checks: [g8Check('bke-e1-new', 'all')] });
    expect(approved.status).toBe('ready');
    const refreshed = await world.settings('automation/save', { autoReworkLimit: 3, resumeOnStartup: 'ask' });
    expect(refreshed.status).toBe('ready');
    expect(await installedChecks()).toEqual(['bke-e1-new']);
  }, 240_000);

  it('e R-M6 forgetting a project keeps the still-running workspace checks configuration', async () => {
    // 今天绿：刷新保留仍挂载工作区的配置来源，已批准检查不被清空。具名变异（未执行）：刷新只从已删掉的描述
    // 算 `configured`，不保留仍挂载工作区的配置来源。
    const project = await openG8Project('bke-e1-e', [g8Check('bke-e1-check', 'all')]);
    worlds.push(project);
    const scope = project.scope;
    const approved = await project.world.settings('checks/approve', {
      scope, answerRef: project.seedAnswer, checks: [g8Check('bke-e1-check', 'all')],
    });
    expect(approved.status).toBe('ready');
    const installedChecks = async (): Promise<string[]> => {
      const answer = await project.world.post('verification/installed-checks', plain(scope, { scope }));
      return readyValue<{ checks: Array<{ checkId: string }> }>(answer.body,
        'the installed checks of the main workspace').checks.map(check => check.checkId);
    };
    expect(await installedChecks()).toEqual(['bke-e1-check']);

    const secondRoot = await emptyDirectory('bke-e1-e-second-');
    openedScope(await project.world.settings('workspaces/open', {
      path: secondRoot, projectId: scope.projectId, writeAllowed: false, commandsAllowed: false,
    }), 'the second workspace of the forgot project');
    const away = `${secondRoot}-away`;
    temporary.push(away);
    await rename(secondRoot, away);

    const forgotten = await project.world.settings('projects/forget', { projectId: scope.projectId });
    expect(forgotten.status).toBe('ready');
    // A later write is a real refresh of the Host's configuration (no restart); the main workspace is still mounted.
    const saved = await project.world.settings('automation/save', { autoReworkLimit: 3, resumeOnStartup: 'ask' });
    expect(saved.status).toBe('ready');
    expect(await installedChecks()).toEqual(['bke-e1-check']);
  }, 240_000);
});
