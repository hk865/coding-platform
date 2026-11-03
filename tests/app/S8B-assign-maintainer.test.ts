/**
 * The assign command, the claim race, the person route and the adviser's tool/card/notice.
 *
 * Every state is produced by a real entry: the person's `modules/assign-maintainer` route over the real HTTP server,
 * the real `sessions/link` / `sessions/archive-line` routes, the real `assign_module_maintainer` Work tool inside a
 * Work Run the Kernel started (the S7C world's scripted model), and the real `decisions/answer` route. The command
 * writes are counted through the rule sheet A3 delegating `script` wrapper (tests/helpers/write-command-fixture.ts),
 * installed at the real backend factory; nothing is checked by reading a store. The card source's `readCollection` /
 * `readByKey` are exercised over the operations those real tool calls created (R1's deleted card-source coverage).
 *
 * The two `vi.mock` lines are the frozen barrier's; `commitBarrier` holds a real prepared commit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleRef, SessionRef, VersionPin, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { SessionWorkLink } from '../../src/contracts/core/session.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { ModuleHoverV1 } from '../../src/contracts/work-line.js';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { DecisionCardV1, ResolveDecisionReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { MaintainerAssignmentOperationV1 } from '../../src/core/work-graph/model/session-contracts.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { CoreRouteRejectionError } from '../../src/app/core-routes.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { utf8ByteLength } from '../../src/contracts/utf8.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { readCollection, readByKey } from '../../src/core/work-graph/communication/decision-source/module-maintainer-assignment.js';
import { responsibleLinkRef } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import { driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimOf, openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import type { S6ASession } from '../helpers/S6A-request-fixture.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { draftFrom } from '../scenarios/support/common.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier, byIdentityPrefix } from '../helpers/S6A-commit-barrier.js';
import { openMaintainerWorld0, type MaintainerWorld } from '../helpers/S8B-maintainer-world.js';
import { committed } from '../helpers/S1-session-facts-fixture.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import { activatePolicy, S8B_POLICY } from '../helpers/S8B-catalog-steps.js';
import { changeLookupReceipt, script, type Step } from '../helpers/write-command-fixture.js';

/**
 * The backend factory's one probe: `lookupSteps` is read by the real `script` wrapper at call time, so a row can
 * inject a receipt without rebuilding the wrapper; `commits` / `lookups` count the real calls of the current backend.
 */
const probe = vi.hoisted(() => ({
  lookupSteps: [] as Step[],
  commits: null as null | (() => number),
  lookups: null as null | (() => number),
  backends: 0,
  scripted: false,
}));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const wrapper = await import('../helpers/write-command-fixture.js');
  const actual = await barrier.inMemoryBarrierModule(importOriginal);
  return { ...actual,
    createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
      const backend = actual.createInMemoryRecordBackend(options);
      probe.backends += 1;
      if (!probe.scripted) return backend;
      const commits = wrapper.script(backend.records, 'commit', []);
      const lookups = wrapper.script(commits.records, 'lookupCommit', probe.lookupSteps);
      probe.commits = commits.calls;
      probe.lookups = lookups.calls;
      // The fixture wraps the four write-executor calls; every other real port member stays.
      return { ...backend, records: { ...backend.records,
        commit: lookups.records.commit, lookupCommit: lookups.records.lookupCommit,
        readMany: lookups.records.readMany, eventAt: lookups.records.eventAt } };
    } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const wrapper = await import('../helpers/write-command-fixture.js');
  const actual = await barrier.sqliteBarrierModule(importOriginal);
  return { ...actual,
    createSqliteRecordBackend: (options: Parameters<typeof actual.createSqliteRecordBackend>[0]) => {
      const backend = actual.createSqliteRecordBackend(options);
      probe.backends += 1;
      if (!probe.scripted) return backend;
      const commits = wrapper.script(backend.records, 'commit', []);
      const lookups = wrapper.script(commits.records, 'lookupCommit', probe.lookupSteps);
      probe.commits = commits.calls;
      probe.lookups = lookups.calls;
      return { ...backend, records: { ...backend.records,
        commit: lookups.records.commit, lookupCommit: lookups.records.lookupCommit,
        readMany: lookups.records.readMany, eventAt: lookups.records.eventAt } };
    } };
});

const worlds: MaintainerWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close();
  probe.lookupSteps.length = 0;
  probe.scripted = false;
  expect(left).toEqual([]);
});

/** One real `goals/create` over the person route; W0 has no Goal, and the module hover is read per Goal. */
async function createAssignGoal(world: MaintainerWorld, goalId = 's8b-assign-goal'): Promise<GoalRef> {
  const registration = readyValue<{
    project: { ref: VersionPin['ref']; revision: number };
    workspace: { ref: VersionPin['ref']; revision: number };
  }>((await world.postRoute('workspaces/registration', plain(world.scope, world.scope))).body, 'the registration');
  committed((await world.postRoute('goals/create', graphWrite(world.scope,
    { goalId, workspace: { ...world.scope }, objective: `S8B assign ${goalId}` }, `s8b-assign-goal-${goalId}`, [
      { ref: registration.project.ref, revision: registration.project.revision },
      { ref: registration.workspace.ref, revision: registration.workspace.revision },
    ]))).body as WriteResult<unknown>);
  await activatePolicy(world.platform, world.ctx, S8B_POLICY, 's8b-assign-policy');
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: world.scope.projectId, goalId };
  const goalRead = readyValue<{ goal: { revision: number } }>(
    (await world.postRoute('goals/read', plain(world.scope, goalRef))).body, 'goals/read');
  const draft = { ...ag2bPlanDraft(), planId: `s8b-assign-plan-${goalId}`, goalId };
  const proposed = committed((await world.postRoute('plans/propose',
    graphWrite(world.scope, { goalRef, basedOn: null, draft, reason: { text: 'S8B assign plan', sources: [] } },
      `s8b-assign-propose-${goalId}`, [{ ref: goalRef, revision: goalRead.goal.revision }]))).body as WriteResult<{ ref: unknown; revision: number }>);
  committed((await world.postRoute('plans/apply', graphWrite(world.scope,
    { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    `s8b-assign-apply-${goalId}`))).body as WriteResult<unknown>);
  return goalRef;
}

async function hoverModule(world: MaintainerWorld, goal: GoalRef, moduleId: string): Promise<ModuleHoverV1> {
  const read = readyValue<{ modules: ModuleHoverV1[] }>(
    (await world.postRoute('graph/hover', plain(world.scope, { goalRef: goal }))).body, 'graph/hover');
  const found = read.modules.find((module) => module.module.moduleId === moduleId);
  if (found === undefined) throw new Error(`graph/hover has no module ${moduleId}: ${JSON.stringify(read.modules)}`);
  return found;
}

const moduleRef = (world: MaintainerWorld, moduleId: string): ModuleRef =>
  ({ projectId: world.projectId, moduleId });
const assignBody = (world: MaintainerWorld, moduleId: string, line: SessionRef, requestId: string) =>
  graphWrite(world.scope, { module: moduleRef(world, moduleId), line }, requestId);

async function assign(world: MaintainerWorld, moduleId: string, line: SessionRef, requestId: string) {
  const answer = await world.postRoute('modules/assign-maintainer', assignBody(world, moduleId, line, requestId));
  return { httpStatus: answer.httpStatus, body: answer.body };
}

const targetOf = (world: MaintainerWorld, moduleId: string): WorkLinkTarget => world.module(moduleId);
const exactScopeReason = (moduleId: string, winner: string): string =>
  `scope_owned: the executor scope {"kind":"region","moduleRef":{"moduleId":"${moduleId}","projectId":"${MAINTAINER_PROJECT}"}} is held by ${winner}`;
const MAINTAINER_PROJECT = 'p1';

describe('B02-assign-open (W0, memory)', () => {
  it('B02-assign-open: the person assignment opens L1\'s module link at revision 1 and the module reads L1', async () => {
    const world = await openMaintainerWorld0({ backend: 'memory' });
    worlds.push(world);
    const goal = await createAssignGoal(world);
    const module = targetOf(world, 'M');

    const answer = await assign(world, 'M', world.lines.L1.ref, 's8b-assign-open');
    expect(answer.httpStatus, JSON.stringify(answer.body)).toBe(200);
    const result = committed(answer.body as WriteResult<SessionWorkLink>);
    expect(result.replayed).toBe(false);
    expect(result.value).toMatchObject({
      ref: { target: module, relation: 'responsible' }, revision: 1, until: null,
    });
    expect(result.value.since).not.toBeNull();
    expect(result.value.since).toBe(result.cursor);

    const link = await world.readLink(world.lines.L1, module);
    expect(link).toMatchObject({ revision: 1, since: result.cursor, until: null });
    const hover = await hoverModule(world, goal, 'M');
    expect(hover.maintainer).toMatchObject({ status: 'assigned', line: { key: world.lines.L1.ref } });
  });
});

describe('B02-assign-transfer (W0, memory)', () => {
  it('B02-assign-transfer: the second assignment closes L1 at the move cursor and opens L2; L3 conflicts on L2', async () => {
    const world = await openMaintainerWorld0({ backend: 'memory' });
    worlds.push(world);
    const goal = await createAssignGoal(world);
    const module = targetOf(world, 'M');

    const first = committed((await assign(world, 'M', world.lines.L1.ref, 's8b-transfer-l1')).body as WriteResult<SessionWorkLink>);
    const l1Since = first.value.since;
    expect(first.cursor).toBe(l1Since);

    const second = committed((await assign(world, 'M', world.lines.L2.ref, 's8b-transfer-l2')).body as WriteResult<SessionWorkLink>);
    const assignCursor = second.cursor;

    const l1 = await world.readLink(world.lines.L1, module);
    expect(l1).toMatchObject({ revision: 2, since: l1Since, until: assignCursor });
    const l2 = await world.readLink(world.lines.L2, module);
    expect(l2).toMatchObject({ revision: 1, since: assignCursor, until: null });
    expect(second.value).toMatchObject({ revision: 1, since: assignCursor, until: null });

    const hover = await hoverModule(world, goal, 'M');
    expect(hover.maintainer).toMatchObject({ status: 'assigned', line: { key: world.lines.L2.ref } });

    const conflict = await world.link({ line: world.lines.L3, target: module, requestId: 's8b-transfer-l3' });
    expect(conflict.result).toMatchObject({
      status: 'rejected', code: 'revision_conflict',
      scopeOwned: { duty: 'executor',
        target: { kind: 'region', moduleRef: { projectId: 'p1', moduleId: 'M' } },
        holder: { projectId: 'p1', sessionId: world.lines.L2.ref.sessionId } },
      reason: exactScopeReason('M', world.lines.L2.ref.sessionId),
    });
    expect((conflict.result as { reason?: string }).reason)
      .toBe(exactScopeReason('M', world.lines.L2.ref.sessionId));
    expect(await world.readLink(world.lines.L3, module)).toBeUndefined();
  });
});

describe('B02-assign-refusals (W0, memory)', () => {
  let world: MaintainerWorld;
  let goal: GoalRef;
  let archived: SessionRef;

  it.each([
    ['a member principal', 'forbidden', async (opened: MaintainerWorld) => {
      try {
        return await opened.dispatch('modules/assign-maintainer', opened.member,
          assignBody(opened, 'M', opened.lines.L1.ref, 's8b-refusal-member'));
      } catch (error) {
        if (error instanceof CoreRouteRejectionError) return error.rejection;
        throw error;
      }
    }],
    ['a module absent from the catalog', 'not_found', async (opened: MaintainerWorld) =>
      (await assign(opened, 'Z', opened.lines.L1.ref, 's8b-refusal-module')).body],
    ['an adviser line', 'invalid', async (opened: MaintainerWorld) =>
      (await assign(opened, 'M', opened.lines.A1.ref, 's8b-refusal-adviser')).body],
    ['an archived line produced by a real archive', 'invalid', async (opened: MaintainerWorld) =>
      (await assign(opened, 'M', archived, 's8b-refusal-archived')).body],
  ])('%s is refused %s and writes nothing', async (_label, code, invoke) => {
    const opened = await openMaintainerWorld0({ backend: 'memory' });
    worlds.push(opened);
    world = opened;
    goal = await createAssignGoal(opened);
    const archivedLine = await opened.createMaintainerLine({
      label: 'R-arch', duty: 'executor', requestId: 's8b-refusal-arch-line' });
    const written = await opened.archiveLine({ line: archivedLine, tasks: [], requestId: 's8b-refusal-archive' });
    if (written.result.status !== 'ready') throw new Error(`the archive was refused: ${JSON.stringify(written.result)}`);
    archived = archivedLine.ref;

    const before = await hoverModule(opened, goal, 'M');
    const result = await invoke(opened) as { status?: string; code?: string };
    expect(result).toMatchObject({ status: 'rejected', code });
    const after = await hoverModule(opened, goal, 'M');
    expect(after.maintainer).toEqual(before.maintainer);
    expect(before.maintainer).toEqual({ status: 'none' });
  });
});

describe.each(['memory', 'sqlite'] as const)('B02-race (%s)', (backend) => {
  it('B02-race: one of the two concurrent assignments commits and the other names the winner', async () => {
    const world = await openMaintainerWorld0({ backend });
    worlds.push(world);
    const raceGoal = await createAssignGoal(world);
    const hold = commitBarrier.hold(byIdentityPrefix('modules.assignMaintainer:'), 'the L1 claim');
    const hold2 = commitBarrier.hold(byIdentityPrefix('modules.assignMaintainer:'), 'the L2 claim');
    const left = assign(world, 'M', world.lines.L1.ref, 's8b-race-l1');
    const right = assign(world, 'M', world.lines.L2.ref, 's8b-race-l2');
    await Promise.all([hold.reached, hold2.reached]);
    hold.release();
    hold2.release();
    const [first, second] = await Promise.all([left, right]);
    const answers = [first!.body, second!.body] as Array<Record<string, unknown>>;
    const committedAnswers = answers.filter((body) => body['status'] === 'committed');
    expect(committedAnswers).toHaveLength(1);
    const winner = committedAnswers[0]!['value'] as SessionWorkLink;
    const winnerId = winner.ref.sessionId;
    const loser = answers.find((body) => body['status'] !== 'committed')!;
    expect(loser).toMatchObject({
      status: 'rejected', code: 'revision_conflict',
      scopeOwned: { duty: 'executor',
        target: { kind: 'region', moduleRef: { projectId: 'p1', moduleId: 'M' } },
        holder: { projectId: 'p1', sessionId: winnerId } },
    });
    expect(String(loser['reason'])).toBe(exactScopeReason('M', winnerId));

    // Nothing else was written: only the winner's line has the open link, and the module reads it as its maintainer.
    const linkOf = async (line: SessionRef) => await world.readLink(line, targetOf(world, 'M'));
    expect(await linkOf(world.lines.L1.ref)).toEqual(winnerId === world.lines.L1.ref.sessionId ? winner : undefined);
    expect(await linkOf(world.lines.L2.ref)).toEqual(winnerId === world.lines.L2.ref.sessionId ? winner : undefined);
    expect(await world.findByTarget(targetOf(world, 'M'))).toHaveLength(1);
    const hover = await hoverModule(world, raceGoal, 'M');
    expect(hover.maintainer).toMatchObject({ status: 'assigned', line: { key: { sessionId: winnerId } } });
  });
});

describe('B02-assign-idempotent (W0)', () => {
  type IdemCase = { name: string; backend: 'memory' | 'sqlite' };
  it.each<IdemCase>([
    { name: '(a) a new command assigning the owner line again', backend: 'memory' },
    { name: '(b) the committed command replayed (memory)', backend: 'memory' },
    { name: '(b) the committed command replayed (sqlite)', backend: 'sqlite' },
    { name: '(c) the same command with a changed line', backend: 'memory' },
    { name: '(c) the same command with a changed line (sqlite)', backend: 'sqlite' },
    { name: 'an injected receipt whose link version disagrees', backend: 'memory' },
  ])('$name answers the rule and writes nothing new', async ({ name, backend }) => {
    probe.scripted = true;
    const world = await openMaintainerWorld0({ backend });
    worlds.push(world);
    const module = targetOf(world, 'M');
    const seed = committed((await assign(world, 'M', world.lines.L2.ref, 's8b-idem-seed')).body as WriteResult<SessionWorkLink>);
    const seedCursor = seed.cursor;

    if (name.startsWith('(a)')) {
      const before = probe.commits!();
      const answer = await assign(world, 'M', world.lines.L2.ref, 's8b-idem-new');
      const result = committed(answer.body as WriteResult<SessionWorkLink>);
      expect(result.replayed).toBe(true);
      expect(result.cursor).toBe(seedCursor);
      expect(result.value).toMatchObject({ revision: 1, since: seedCursor, until: null });
      expect(probe.commits!() - before).toBe(0);
      expect(await world.readLink(world.lines.L2, module)).toEqual(seed.value);
      return;
    }

    if (name.startsWith('(b)')) {
      const before = probe.commits!();
      const replay = committed((await assign(world, 'M', world.lines.L2.ref, 's8b-idem-seed')).body as WriteResult<SessionWorkLink>);
      expect(replay).toMatchObject({ replayed: true, cursor: seedCursor });
      expect(replay.value).toEqual(seed.value);
      expect(probe.commits!() - before).toBe(0);
      return;
    }

    if (name.startsWith('(c)')) {
      const before = probe.commits!();
      const changed = await assign(world, 'M', world.lines.L3.ref, 's8b-idem-seed');
      expect(changed.body).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      expect(probe.commits!() - before).toBe(0);
      expect(await world.readLink(world.lines.L3, module)).toBeUndefined();
      return;
    }

    // The injected receipt: the receipt lookup answers the real receipt, with the link version removed.
    const dropLinkVersion: Step = { patch: (value) => {
      const found = value as { status: 'ready'; value: { versions: { refKey: string; revision: number }[] } };
      return { ...found, value: { ...found.value,
        versions: found.value.versions.filter((entry) => !entry.refKey.includes('"SessionWorkLink"')) } };
    } };
    const before = probe.commits!();
    probe.lookupSteps[probe.lookups!()] = dropLinkVersion;
    const injected = await assign(world, 'M', world.lines.L2.ref, 's8b-idem-seed');
    expect(injected.body).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(probe.commits!() - before).toBe(0);
    expect(await world.readLink(world.lines.L2, module)).toEqual(seed.value);
  });
});

describe('R-route (W0, person HTTP)', () => {
  it('R-route: one modules/assign-maintainer POST answers the link round-trip and the module reads L1', async () => {
    const world = await openMaintainerWorld0({ backend: 'memory' });
    worlds.push(world);
    const goal = await createAssignGoal(world);
    const module = targetOf(world, 'M');
    const answer = await world.postRoute('modules/assign-maintainer', {
      scope: { ...world.scope },
      request: { input: { module: moduleRef(world, 'M'), line: world.lines.L1.ref },
        meta: { requestId: 's8b-route', expected: [] } },
    });
    expect(answer.httpStatus).toBe(200);
    const result = committed(answer.body as WriteResult<SessionWorkLink>);
    expect(result.value).toMatchObject({ ref: { target: module }, since: result.cursor, until: null });
    expect(result.value.since).not.toBeNull();
    const hover = await hoverModule(world, goal, 'M');
    expect(hover.maintainer).toMatchObject({ status: 'assigned', line: { key: world.lines.L1.ref } });
  });
});


// ---------------------------------------------------------------------------
// The adviser's real Work tool rows: a real Work Run on the S7C world.
// ---------------------------------------------------------------------------

const TOOL_WORLD_BACKEND = 'memory';

function createS7C1ToolWorld(configure: (configuration: WorkbenchRuntimeConfiguration) => void) {
  return openS7C1World({ backend: TOOL_WORLD_BACKEND, configure });
}

const ADVISER_ROLE = platformRoleProfile('adviser').template;
const EXECUTOR_ROLE = platformRoleProfile('executor').template;

/** Adds W0's modules M/M2/N to the S7C catalog through the real architecture owner. */
async function addAssignModules(target: S7C1World, extra: readonly ModuleDefinition[] = []): Promise<void> {
  const ctx = target.world.humanContext();
  const current = readyValue<ArchitectureRevision>(await target.world.platform.architecture
    .readArchitectureRevision(ctx, { selection: { kind: 'current' } }), 'the current architecture');
  const registration = readyValue<{
    project: { ref: VersionPin['ref']; revision: number };
    workspace: { ref: VersionPin['ref']; revision: number };
  }>(await target.main.route('workspaces/registration', { ...target.main.scope }), 'the registration');
  const moduleDefinition = (moduleId: string, path: string): ModuleDefinition => ({
    ref: { projectId: target.goal.projectId, moduleId }, name: `Module ${moduleId}`,
    responsibility: `Own ${moduleId}`, paths: [path], interfaces: [],
  });
  const revised = await target.world.platform.architecture.reviseArchitectureCatalog(ctx, {
    meta: { requestId: 's8b-assign-modules', expected: [
      { ref: registration.project.ref, revision: registration.project.revision },
      { ref: registration.workspace.ref, revision: registration.workspace.revision },
    ] },
    input: {
      expected: { catalogRef: current.catalog.ref,
        baseline: { ref: current.baseline.ref, digest: current.baseline.contentDigest } },
      ops: [moduleDefinition('M', 'm'), moduleDefinition('M2', 'm2'), moduleDefinition('N', 'n'), ...extra]
        .map(module => ({ op: 'add_module' as const, module })),
      responsibilityMoves: [], reason: 'S8B assign modules',
    },
  });
  if (revised.status !== 'committed') throw new Error(`the module catalog revision was refused: ${JSON.stringify(revised)}`);
}

/** One real Work Run on the adviser line that selects the assign tool task; the result is read from the model request. */
async function startAssignToolRun(target: S7C1World, input: {
  label: string; moduleId: string; line: S6ASession; callId: string;
  reason: string; replay?: boolean;
}): Promise<{ runRef: RunRef; execution: Awaited<ReturnType<typeof readExecution>>; call: { callId: string; name: string; args: Record<string, unknown> } }> {
  const caller = target.lines.adviser;
  if (caller === null) throw new Error('S8B tool row: the world has no adviser line');
  const plan = await target.main.activePlan(target.goal);
  if (plan === null) throw new Error('S8B tool row: the Goal has no adopted Plan');
  const taskId = `s8b-assign-${input.label}`;
  const toolTask = { taskId, title: `S8B assign ${input.label}`, requirementLevel: 'required' as const,
    taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
    scope: { kind: 'goal' as const }, executionIntent: 'request_execution' as const };
  const draft = draftFrom(plan, `s8b-assign-plan-${input.label}`, (draftPlan) => ({ ...draftPlan,
    tasks: [...draftPlan.tasks, toolTask],
    assignments: [...(draftPlan.assignments ?? []),
      { taskId, role: ADVISER_ROLE.templateId, instruction: `S8B assign ${input.label}` }],
    obligations: draftPlan.obligations.map((obligation) => ({ ...obligation,
      taskIds: [...obligation.taskIds, taskId] })) }));
  const proposed = committed(await target.main.post('plans/propose',
    graphWrite(target.main.scope, { goalRef: target.goal, basedOn: plan.ref, draft,
      reason: { text: `S8B assign ${input.label}`, sources: [] } }, `s8b-assign-propose-${input.label}`)) as WriteResult<{ ref: unknown; revision: number }>);
  committed(await target.main.post('plans/apply', graphWrite(target.main.scope,
    { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    `s8b-assign-apply-${input.label}`)) as WriteResult<unknown>);

  const call = { callId: input.callId, name: 'assign_module_maintainer', args: {
    moduleRef: { projectId: target.goal.projectId, moduleId: input.moduleId },
    sessionRef: { projectId: input.line.ref.projectId, sessionId: input.line.ref.sessionId },
    reason: input.reason,
  } };
  const replies: S6AReply[] = [{ kind: 'calls', calls: [call] }];
  if (input.replay === true) replies.push({ kind: 'calls', calls: [call] });
  replies.push({ kind: 'text', text: `S8B assign ${input.label} answer` });
  await target.world.scripted.script(caller, replies);
  const gate = await target.world.gates.toolCall(caller, 'assign_module_maintainer');
  const receipts: WorkflowStepReceipt[] = [];
  const driven = driveWorkflow(target.world.ag2b, { schemaVersion: 1, goalRef: target.goal,
    flowId: `s8b-assign-${input.label}`, sessionHint: caller.ref, kind: 'select_work', taskId },
  { stopBefore: 'open_checks', receipts });
  await gate.reached;
  gate.release();
  await driven;
  const runRef = claimOf(receipts);
  return { runRef, execution: await readExecution(target.world.ag2b, runRef), call };
}

/** The tool result the Runtime served the model for one call (the last when a replay repeats the call id). */
function toolResults(requests: readonly ModelRequest[], callId: string): unknown[] {
  const values: unknown[] = [];
  for (const request of requests) {
    for (const message of request.messages) {
      if (message.role !== 'tool' || message.callId !== callId) continue;
      const output = (message.result as { output?: readonly { kind: string; value?: unknown }[] }).output ?? [];
      const block = output.find((candidate) => candidate.kind === 'json');
      if (block !== undefined) values.push(block.value);
    }
  }
  return values;
}

async function readLinkOf(target: S7C1World, line: SessionRef, module: ModuleRef): Promise<SessionWorkLink | undefined> {
  const card = readyValue<{ links: SessionWorkLink[] }>(await target.main.route('sessions/read', line), 'the line read');
  const expected = canonicalKey(responsibleLinkRef(line, { kind: 'module', ref: module }));
  return card.links.find((link) => canonicalKey(link.ref) === expected);
}

async function pendingCards(target: S7C1World): Promise<DecisionCardV1[]> {
  const cards = await target.main.readCards();
  return cards.filter((card) => card.source.kind === 'module_maintainer_assignment' && card.state === 'waiting_answer');
}

function operationOfCard(card: DecisionCardV1): OperationRef {
  const pin = card.source.pins[0];
  if (pin === undefined) throw new Error(`the maintainer card has no source pin: ${JSON.stringify(card)}`);
  return pin.ref as OperationRef;
}

async function readOperation(target: S7C1World, ref: OperationRef): Promise<MaintainerAssignmentOperationV1> {
  return readyValue<MaintainerAssignmentOperationV1>(await target.main.route('sessions/operation', ref), 'the operation read');
}

describe('B02-tool-every-step (W0, adviser A1, every-step)', () => {
  it('B02-tool-every-step: the tool writes a waiting operation/card, approve proves the formal change and reject writes none', async () => {
    const target = await createS7C1ToolWorld((configuration) => {
      const adviser = configuration.bindings.find((binding) => binding.id === 's7c-adviser-binding');
      if (adviser === undefined) throw new Error('S8B tool row: no adviser binding');
      adviser.grant = { ...adviser.grant, tools: [...(adviser.grant.tools ?? []), 'assign_module_maintainer'] };
    });
    try {
      await addAssignModules(target);
      await setS7AAutonomy(target.world, target.goal, 'every_step');
      const L1 = await sessionOf(target.world, await createS6BLine(target.main,
        { label: 's8b-assign-L1', role: EXECUTOR_ROLE }));
      const L2 = await sessionOf(target.world, await createS6BLine(target.main,
        { label: 's8b-assign-L2', role: EXECUTOR_ROLE }));

      const first = await startAssignToolRun(target, { label: 'one', moduleId: 'M', line: L1,
        callId: 's8b-tool-one', reason: 'the first maintainer reason' });
      const firstResults = toolResults(await target.world.scripted.requests(target.lines.adviser!), 's8b-tool-one');
      const firstResult = firstResults.at(-1) as { status: string; cardKey: string };
      expect(firstResult, JSON.stringify(firstResult)).toMatchObject({ status: 'needs_decision' });
      expect(typeof firstResult.cardKey).toBe('string');

      const firstCard = (await pendingCards(target)).find((card) => card.cardKey === firstResult.cardKey);
      if (firstCard === undefined) throw new Error('the first card is not in the queue');
      const firstOperation = await readOperation(target, operationOfCard(firstCard));
      expect(firstOperation.action.progress.stage).toBe('awaiting_decision');
      expect(firstOperation.action.input.reason).toBe('the first maintainer reason');
      expect(firstOperation.action.input.moduleRef).toEqual({ projectId: target.goal.projectId, moduleId: 'M' });
      expect(firstOperation.action.input.line).toEqual(L1.ref);
      expect(firstCard.objects[0]!.label).toContain('the first maintainer reason');
      // The by-key read returns the same one card.
      const byKey = readyValue<DecisionCardV1>(await target.main.route('decisions/card', { source: firstCard.source }),
        'the by-key card');
      expect(byKey.cardKey).toBe(firstCard.cardKey);
      expect(byKey.source).toEqual(firstCard.source);

      // The R1 collection coverage: two pending operations in requestedAt order.
      target.world.clock.advance(1000);
      const second = await startAssignToolRun(target, { label: 'two', moduleId: 'M2', line: L2,
        callId: 's8b-tool-two', reason: 'the second maintainer reason' });
      const secondResult = (toolResults(await target.world.scripted.requests(target.lines.adviser!),
        's8b-tool-two').at(-1)) as { status: string; cardKey: string };
      expect(secondResult).toMatchObject({ status: 'needs_decision' });
      const secondCard = (await pendingCards(target)).find((card) => card.cardKey === secondResult.cardKey);
      if (secondCard === undefined) throw new Error('the second card is not in the queue');
      const secondOperation = await readOperation(target, operationOfCard(secondCard));
      expect(secondOperation.action.progress.stage).toBe('awaiting_decision');

      const records = target.world.platform.disconnect.records;
      const workspace = { projectId: target.goal.projectId, workspaceId: target.world.scope.workspaceId };
      const subject = { kind: 'project' as const, projectRef: { projectId: target.goal.projectId } };
      const collection = await readCollection(records, { workspace, subject });
      if (collection.status !== 'ready') throw new Error(`the collection read is not ready: ${JSON.stringify(collection)}`);
      expect(collection.value.map((item) => item.openedAt))
        .toEqual([firstOperation.requestedAt, secondOperation.requestedAt]);
      expect(collection.value.map((item) => item.operation.ref.operationId))
        .toEqual([firstOperation.ref.operationId, secondOperation.ref.operationId]);
      expect(collection.value).toHaveLength(2);

      // readByKey: the same card; a missing operation is ready null; a foreign project is forbidden.
      const same = await readByKey(records, { workspace, source: firstCard.source });
      expect(same.status === 'ready' && same.value !== null ? same.value.source.key : null).toBe(firstCard.cardKey);
      const missingSource: DecisionSourceV1 = { ...firstCard.source,
        key: decisionSourceKey({ kind: 'module_maintainer_assignment',
          operationRef: { aggregateType: 'CoreOperation', projectId: target.goal.projectId, operationId: 's8b-missing' } }) };
      const missing = await readByKey(records, { workspace, source: missingSource });
      expect(missing).toMatchObject({ status: 'ready', value: null });
      const foreign = await readByKey(records, { workspace: { projectId: 'other-project', workspaceId: workspace.workspaceId },
        source: firstCard.source });
      expect(foreign).toMatchObject({ status: 'rejected', code: 'forbidden' });

      // Approve the first card; the public application names the operation's version change.
      const approved = readyValue<ResolveDecisionReadV1>(await target.main.post('decisions/answer',
        graphWrite(target.main.scope, { source: firstCard.source,
          selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [] },
        's8b-answer-approve', firstCard.source.pins)), 'the approve answer');
      expect(approved.state).toBe('applied');
      expect(approved.application).toMatchObject({ status: 'committed' });
      if (approved.application === null || approved.application.status !== 'committed') {
        throw new Error(`the application did not commit: ${JSON.stringify(approved.application)}`);
      }
      const application = approved.application.value.application;
      expect(application).not.toBeNull();
      const before = firstOperation.revision;
      expect(application!.changes).toEqual([{ before: { ref: firstOperation.ref, revision: before },
        after: { ref: firstOperation.ref, revision: before + 1 } }]);

      const done = await readOperation(target, firstOperation.ref);
      expect(done.action.progress.stage).toBe('done');
      expect(done.action.progress.outcome).toMatchObject({ kind: 'assigned' });
      const link = await readLinkOf(target, L1.ref, { projectId: target.goal.projectId, moduleId: 'M' });
      expect(link).toMatchObject({ revision: 1, until: null });

      // A reject is a separate operation: no link, no receipt (the application is not recorded).
      const rejectedResult = (await target.main.post('decisions/answer', graphWrite(target.main.scope,
        { source: secondCard.source, selection: { kind: 'option', optionId: 'reject' }, text: '', annotations: [] },
        's8b-answer-reject', secondCard.source.pins))) as { status: string; value: ResolveDecisionReadV1 };
      expect(rejectedResult.status).toBe('ready');
      expect(rejectedResult.value.application).toBeNull();
      const rejected = await readOperation(target, secondOperation.ref);
      expect(rejected.action.progress.stage).toBe('rejected');
      expect(await readLinkOf(target, L2.ref, { projectId: target.goal.projectId, moduleId: 'M2' })).toBeUndefined();

      // Both terminal cards leave waiting_answer and are read as history closed by their source.
      const afterCards = await target.main.readCards();
      const stillWaiting = afterCards.filter((card) => card.source.kind === 'module_maintainer_assignment'
        && card.state === 'waiting_answer');
      expect(stillWaiting).toEqual([]);
      const history = afterCards.filter((card) => card.source.kind === 'module_maintainer_assignment'
        && card.closedReason === 'source_resolved');
      expect(history.map((card) => card.cardKey).sort()).toEqual([firstCard.cardKey, secondCard.cardKey].sort());
      for (const card of history) expect(card.closedReason).toBe('source_resolved');
      const terminalCollection = await readCollection(records, { workspace, subject });
      if (terminalCollection.status !== 'ready') throw new Error('the terminal collection is not ready');
      expect(terminalCollection.value.map((item) => item.closedReason)).toEqual(['source_resolved', 'source_resolved']);
      expect(await readLinkOf(target, L1.ref, { projectId: target.goal.projectId, moduleId: 'M' })).toBeDefined();
      expect(await readLinkOf(target, L2.ref, { projectId: target.goal.projectId, moduleId: 'M2' })).toBeUndefined();
    } finally {
      await target.close();
    }
  }, 180_000);
});

describe('R2-01 notice summary limit', () => {
  it('R2-01: a 512-byte module id still writes one notice whose summary is at most 512 UTF-8 bytes', async () => {
    const target = await createS7C1ToolWorld((configuration) => {
      const adviser = configuration.bindings.find((binding) => binding.id === 's7c-adviser-binding');
      if (adviser === undefined) throw new Error('S8B tool row: no adviser binding');
      adviser.grant = { ...adviser.grant, tools: [...(adviser.grant.tools ?? []), 'assign_module_maintainer'] };
    });
    try {
      const moduleId = 'm'.repeat(512);
      await addAssignModules(target, [{ ref: { projectId: target.goal.projectId, moduleId },
        name: 'Long module', responsibility: 'Own the long module', paths: ['long'], interfaces: [] }]);
      const L1 = await sessionOf(target.world, await createS6BLine(target.main,
        { label: 's8b-limit-L1', role: EXECUTOR_ROLE }));
      await startAssignToolRun(target, { label: 'limit', moduleId, line: L1,
        callId: 's8b-limit-call', reason: 'the long module reason' });
      const notices = await target.main.readNotices({ categories: ['project_notice'] });
      expect(notices.notices).toHaveLength(1);
      expect(utf8ByteLength(notices.notices[0]!.summary)).toBeLessThanOrEqual(512);
      expect(notices.notices[0]!.summary).toContain('m'.repeat(244));
      const link = await readLinkOf(target, L1.ref, { projectId: target.goal.projectId, moduleId });
      expect(link).toMatchObject({ revision: 1, until: null });
    } finally {
      await target.close();
    }
  });
});

describe('B02-tool-auto (W0, adviser A1, auto)', () => {
  it('B02-tool-auto: the auto call writes one notice for its operation; the same real call replayed keeps it one', async () => {
    const target = await createS7C1ToolWorld((configuration) => {
      const adviser = configuration.bindings.find((binding) => binding.id === 's7c-adviser-binding');
      if (adviser === undefined) throw new Error('S8B tool row: no adviser binding');
      adviser.grant = { ...adviser.grant, tools: [...(adviser.grant.tools ?? []), 'assign_module_maintainer'] };
    });
    try {
      await addAssignModules(target);
      const L1 = await sessionOf(target.world, await createS6BLine(target.main,
        { label: 's8b-auto-L1', role: EXECUTOR_ROLE }));
      // The default Goal autonomy is after_plan_confirmation (automatic).
      await startAssignToolRun(target, { label: 'auto', moduleId: 'M', line: L1,
        callId: 's8b-auto-call', reason: 'the automatic maintainer reason', replay: true });
      const results = toolResults(await target.world.scripted.requests(target.lines.adviser!), 's8b-auto-call');
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const result of results) {
        expect(result).toMatchObject({ status: 'assigned', line: L1.ref });
      }
      // The replay is the same request identity: exactly one notice remains.
      const notices = await target.main.readNotices({ categories: ['project_notice'] });
      expect(notices.notices).toHaveLength(1);
      const notice = notices.notices[0]!;
      expect(notice.category).toBe('project_notice');
      expect(notice.summary).toContain('M');
      expect(notice.summary).toContain(L1.ref.sessionId);

      // No maintainer card exists for the automatic operation.
      const cards = await target.main.readCards();
      expect(cards.filter((card) => card.source.kind === 'module_maintainer_assignment')).toEqual([]);
      const link = await readLinkOf(target, L1.ref, { projectId: target.goal.projectId, moduleId: 'M' });
      expect(link).toMatchObject({ revision: 1, until: null });
    } finally {
      await target.close();
    }
  }, 180_000);
});

