/**
 * The module rule and the catalog pin through the plan owner's public entries (L10), and the initialization answer's
 * containment and root module (L11). Every state comes from tests/helpers/S8B-catalog-steps.ts's public steps; an
 * expected pin is built from the public current-revision read (`world.pin()`), never written by hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureCatalogPinV1, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import { parseInitialPlanningResponseV2 } from '../../src/contracts/initial-planning-parse.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { QueryJobAnswerRef } from '../../src/contracts/query-job.js';
import * as catalogService from '../../src/core/work-graph/architecture/catalog-service.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { decodePlanProposalRecord, encodePlanProposal } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { committed, ready } from '../helpers/S1-runtime-scenario-fixture.js';
import {
  BACKENDS, holdAdoption, openAgentWorld, openCatalogWorld, R4C_MODULE, S8B_POLICY, type Backend,
} from '../helpers/S8B-catalog-steps.js';
import type { W2PlanDraftV2 } from '../helpers/W2-whiteboard-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: { close(): Promise<void> }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  const left = commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});
async function catalogWorld(backend: Backend = 'memory') {
  const world = await openCatalogWorld(backend);
  worlds.push(world);
  return world;
}
async function agentWorld(backend: Backend = 'memory') {
  const world = await openAgentWorld(backend);
  worlds.push(world);
  return world;
}

/** A module of `projectId` owning `paths` (its own directory by default). */
function catalogModule(projectId: string, moduleId: string, paths = [`src/${moduleId}`]): ModuleDefinition {
  return { ref: { projectId, moduleId }, name: moduleId, responsibility: `Own ${moduleId}`, paths, interfaces: [] };
}

/** One required work task `work-<i>` per scope (a module id, or `null` for the stage), a goal gate, one obligation. */
function planBody(scopes: (string | null)[]) {
  const work = scopes.map((_, index) => `work-${index}`);
  return {
    schemaVersion: 2 as const, stages: [{ stageId: 'build', title: 'Build' }],
    tasks: [
      ...scopes.map((moduleRef, index) => ({ taskId: work[index]!, stageId: 'build', title: `Work ${index}`,
        requirementLevel: 'required' as const, taskKind: 'work' as const, disposition: 'active' as const,
        phase: 'pending' as const, executionIntent: 'request_execution' as const,
        scope: moduleRef === null ? { kind: 'stage' as const, stageId: 'build' }
          : { kind: 'module' as const, stageId: 'build', moduleRef } })),
      { taskId: 'gate', title: 'Goal gate', requirementLevel: 'required' as const, taskKind: 'gate' as const,
        disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } },
    ],
    assignments: work.map(taskId => ({ taskId, role: 'builder', instruction: `Do ${taskId}` })),
    obligations: [{ obligationId: 'deliver', title: 'Deliver', requirementLevel: 'required' as const,
      taskIds: [...work, 'gate'], verificationRequirements: [{ requirementId: 'static',
        requirementLevel: 'required' as const, kind: 'static', description: 'The static check passes' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}
function scopedDraft(goal: GoalRef, scopes: (string | null)[]): PlanRevisionDraft {
  return { ...planBody(scopes), planId: 's8b-plan', planRevision: 1, goalId: goal.goalId };
}
/** The initialization answer: a plan over `scopes` and, when given, the setup suggesting `architecture`. */
function answerOf(scopes: string[], architecture?: unknown) {
  return { schemaVersion: 2, kind: 'plan', summary: 'The initial plan', plan: planBody(scopes),
    ...(architecture === undefined ? {} : { setup: { architecture, completionPolicy: S8B_POLICY, checks: [
      { checkId: 's8b-check', kind: 'static', command: 'node --test', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }] } }) };
}
/** The Agent world's future draft gains one optional `plan_only` intent `work-0` on `moduleRef`, without acceptance. */
function withIntent(moduleRef: string): (draft: W2PlanDraftV2) => W2PlanDraftV2 {
  return draft => ({ ...draft,
    stages: [...draft.stages, { stageId: 'agent', title: 'Agent stage' }],
    tasks: [...draft.tasks, { taskId: 'work-0', stageId: 'agent', title: 'A module intent', requirementLevel: 'optional',
      taskKind: 'work', disposition: 'active', phase: 'pending', executionIntent: 'plan_only',
      scope: { kind: 'module', stageId: 'agent', moduleRef } }] });
}
const unknownModule = (reason: string) => ({ status: 'rejected', code: 'invalid', reason });

type Entry = 'host' | 'replacement' | 'answer' | 'agent';
/** Proposes a draft whose one work task names `module` through `entry`: the result, the pin the candidate must carry
 * (the public read, or `null` with no active catalog) and the public reads a refusal must leave as they were. */
async function proposeThrough(entry: Entry, catalog: boolean, module: string) {
  if (entry === 'agent') {
    const world = await agentWorld();
    const goal = () => world.plans.queryGoal(world.ctx, world.goalRef);
    const before = await goal();
    const result = await world.proposeAsWorkRun(world.futureDraft('s8b-agent-plan', withIntent(module)), world.planRef);
    return { result, pin: await world.pin(), unchanged: async () => expect(await goal()).toEqual(before) };
  }
  const world = await catalogWorld();
  const goal = await world.goal('s8b-goal');
  const projectId = world.scope.projectId;
  let pin: ArchitectureCatalogPinV1 | null = null;
  if (catalog) {
    await world.adopt([catalogModule(projectId, 'core')]);
    pin = await world.pin();
  }
  const detail = () => world.platform.plans.queryGoal(world.ctx, goal);
  if (entry === 'answer') {
    const { answerRef } = await world.answer(goal, answerOf([module]));
    const before = await detail();
    const { result } = await world.proposeFromAnswer(answerRef);
    return { result, pin, unchanged: async () => expect(await detail()).toEqual(before) };
  }
  if (entry === 'host') {
    const before = await detail();
    const { result } = await world.propose({ goal, draft: scopedDraft(goal, [module]) });
    return { result, pin, unchanged: async () => expect(await detail()).toEqual(before) };
  }
  const requestRef = await world.requestRoot(goal);
  committed((await world.propose({ goal, draft: scopedDraft(goal, ['core']), requestRef })).result);
  const head = await world.head(goal, requestRef);
  const { result } = await world.propose({ goal, draft: scopedDraft(goal, [module]), requestRef, replaceHead: true });
  return { result, pin, unchanged: async () => expect(await world.head(goal, requestRef)).toEqual(head) };
}

describe('B01-propose: every propose entry pins the active catalog and refuses an unknown module', () => {
  it.each([
    { entry: 'host', catalog: true, module: 'core', refused: null },
    { entry: 'host', catalog: true, module: 'ghost', refused: 'unknown_module: work-0=ghost' },
    { entry: 'host', catalog: false, module: 'core', refused: null },
    { entry: 'replacement', catalog: true, module: 'core', refused: null },
    { entry: 'replacement', catalog: true, module: 'ghost', refused: 'unknown_module: work-0=ghost' },
    { entry: 'replacement', catalog: false, module: 'core', refused: null },
    { entry: 'answer', catalog: true, module: 'core', refused: null },
    { entry: 'answer', catalog: true, module: 'ghost', refused: 'unknown_module: work-0=ghost' },
    { entry: 'answer', catalog: false, module: 'core', refused: null },
    { entry: 'agent', catalog: true, module: R4C_MODULE, refused: null },
    { entry: 'agent', catalog: true, module: 'ghost', refused: 'unknown_module: work-0=ghost' },
  ] as const)('$entry, catalog $catalog, module $module', async ({ entry, catalog, module, refused }) => {
    const { result, pin, unchanged } = await proposeThrough(entry, catalog, module);
    if (refused !== null) {
      expect(result).toEqual(unknownModule(refused));
      await unchanged();
      return;
    }
    if (result.status !== 'committed') throw new Error(JSON.stringify(result));
    expect(result.value.catalogPin).toEqual(pin);
  });

  it.each(BACKENDS)('a replay after a catalog revision answers the original candidate and pin (%s)', async (backend) => {
    const world = await catalogWorld(backend);
    const goal = await world.goal('s8b-goal');
    await world.adopt([catalogModule(world.scope.projectId, 'core')]);
    const pin = await world.pin();
    const first = await world.propose({ goal, draft: scopedDraft(goal, ['core']) });
    await world.addModule(catalogModule(world.scope.projectId, 'extra'));
    expect((await world.pin()).catalogRef.revision).toBe(2);
    const catalogReads = vi.spyOn(catalogService, 'readCurrentCatalogWindow');
    const replay = await world.platform.plans.proposePlan(world.ctx, first.request);
    expect(replay).toEqual({ ...first.result, replayed: true });
    expect(committed(replay).catalogPin).toEqual(pin);
    expect(catalogReads).not.toHaveBeenCalled();
  });
});

describe('B01-adopt-initial: the catalog governance selects judges a module task, whatever the candidate pin', () => {
  it.each([
    { name: 'a null-pin candidate naming an unknown module is refused', early: true, scopes: ['ghost'], revise: false,
      refused: 'unknown_module: work-0=ghost', reads: 1 },
    { name: 'a null-pin candidate naming a catalog module is adopted and bound', early: true, scopes: ['core'],
      revise: false, refused: null, reads: 1 },
    { name: 'a pinned candidate whose catalog gained a module is adopted against the current one', early: false,
      scopes: ['core'], revise: true, refused: null, reads: 1 },
    { name: 'a draft without a module task reads no catalog', early: false, scopes: [null], revise: false,
      refused: null, reads: 0 },
  ] as const)('$name', async ({ early, scopes, revise, refused, reads }) => {
    const world = await catalogWorld();
    const goal = await world.goal('s8b-goal');
    const proposeScopes = async () => committed((await world.propose({ goal, draft: scopedDraft(goal, [...scopes]) })).result);
    const nullPinned = early ? await proposeScopes() : null;
    await world.governance();
    await world.adopt([catalogModule(world.scope.projectId, 'core')]);
    const proposedPin = await world.pin();
    const candidate = nullPinned ?? await proposeScopes();
    if (revise) await world.addModule(catalogModule(world.scope.projectId, 'extra'));
    const governed = await world.pin();
    const before = await world.platform.plans.queryGoal(world.ctx, goal);
    const catalogReads = vi.spyOn(catalogService, 'readRevisionByRef');
    const adopted = (await world.apply(candidate)).result;
    expect(catalogReads.mock.calls.map(([, ref]) => ref)).toEqual(reads ? [governed.baseline.ref] : []);
    catalogReads.mockRestore();
    if (refused !== null) {
      expect(adopted).toEqual(unknownModule(refused));
      expect(await world.platform.plans.queryGoal(world.ctx, goal)).toEqual(before);
      return;
    }
    expect(candidate.catalogPin).toEqual(early ? null : proposedPin);
    expect(proposedPin.baseline.ref.revision).toBe(1);
    expect(governed.baseline.ref.revision).toBe(revise ? 2 : 1);
    expect(committed(adopted).effectiveArchitectureBaseline).toEqual(governed.baseline);
  });
});

describe('B01-adopt-future: a future module intent is checked against the catalog active at adoption', () => {
  it.each(['host', 'agent'] as const)('%s adopts a plan_only intent without acceptance on a catalog module', async (adopter) => {
    const world = await agentWorld();
    const draft = world.futureDraft('s8b-future-plan', withIntent(R4C_MODULE));
    const goalPin = async () => [{ ref: world.goalRef, revision: ready(await world.plans.queryGoal(world.ctx, world.goalRef)).goal.revision }];
    const candidate = committed(adopter === 'agent' ? await world.proposeAsWorkRun(draft, world.planRef)
      : await world.plans.proposePlan(world.ctx, { meta: { requestId: 's8b-host-future', expected: await goalPin() },
        input: { goalRef: world.goalRef, basedOn: world.planRef, draft, reason: { text: 'a module intent', sources: [] } } }));
    const adopted = adopter === 'agent' ? await world.applyAsWorkRun(candidate.ref, candidate.revision)
      : await world.plans.applyPlanChange(world.ctx, { meta: { requestId: 's8b-host-apply', expected: await goalPin() },
        input: { proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [] } });
    expect(committed(adopted).tasks.find(task => task.taskId === 'work-0')?.scope)
      .toEqual({ kind: 'module', stageId: 'agent', moduleRef: R4C_MODULE });
  });

  it.each(BACKENDS)('a catalog revision between the adoption read and its commit is a revision conflict (%s)', async (backend) => {
    const world = await agentWorld(backend);
    const candidate = committed(await world.proposeAsWorkRun(world.futureDraft('s8b-race-plan', withIntent(R4C_MODULE)),
      world.planRef));
    const goal = () => world.plans.queryGoal(world.ctx, world.goalRef);
    const before = await goal();
    const hold = holdAdoption('agent adoption');
    const applying = world.applyAsWorkRun(candidate.ref, candidate.revision);
    try {
      await hold.reached;
      await world.addModule(catalogModule(world.scope.projectId, 'raced'));
    } finally {
      hold.release();
      await applying;
    }
    expect(await applying).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await goal()).toEqual(before);
  });
});

it.each(BACKENDS)('B01-old-plan: an adopted plan reads and replays unchanged after a catalog revision (%s)', async (backend) => {
  const world = await catalogWorld(backend);
  const goal = await world.goal('s8b-goal');
  await world.governance();
  await world.adopt([catalogModule(world.scope.projectId, 'core')]);
  const adoption = await world.apply(committed((await world.propose({ goal, draft: scopedDraft(goal, ['core']) })).result));
  const plan = committed(adoption.result);
  const read = async () => {
    const graph = ready(await world.platform.plans.queryTaskGraph(world.ctx, { goalRef: goal, planRef: plan.ref }));
    return { plan: graph.plan, tasks: graph.tasks };
  };
  const before = await read();
  await world.addModule(catalogModule(world.scope.projectId, 'extra'));
  expect(await read()).toEqual(before);
  expect(await world.platform.plans.applyPlanChange(world.ctx, adoption.request)).toEqual({ ...adoption.result, replayed: true });
});

/** The provider requests' text the model saw (system prompt and non-tool messages). */
function renderedText(requests: readonly { systemPrompt: string; messages: readonly { role: string; content?: unknown }[] }[]): string {
  return requests.map(request => [request.systemPrompt, ...request.messages
    .flatMap(message => message.role === 'tool' ? [] : [String(message.content)])].join('\n')).join('\n');
}
/** `setup.architecture` of the saved answer, read publicly and parsed by the one answer parser. */
async function savedArchitecture(world: Awaited<ReturnType<typeof catalogWorld>>, answerRef: QueryJobAnswerRef) {
  const parsed = parseInitialPlanningResponseV2(ready(await world.platform.queries.readQueryAnswer(world.ctx, answerRef)).answer.answer);
  if (parsed.status !== 'parsed' || parsed.response.kind !== 'plan' || parsed.response.setup === undefined) {
    throw new Error(JSON.stringify(parsed));
  }
  return parsed.response.setup.architecture;
}

const CONTAINMENT: { name: string; pairs?: [string, string][] }[] = [
  { name: 'a declared parent is kept', pairs: [['root', 'src-a']] },
  { name: 'an absent containment stays absent (unknown)' },
  { name: 'an explicit empty list is kept (flat)', pairs: [] },
];
it.each(CONTAINMENT)('B03-containment: $name', async ({ pairs }) => {
  const world = await catalogWorld();
  const goal = await world.goal('s8b-goal');
  const projectId = world.scope.projectId;
  const modules = [catalogModule(projectId, 'root', ['.']), catalogModule(projectId, 'src-a', ['src/a'])];
  const catalog = { requireDag: true, dependencies: [], modules, ...(pairs === undefined ? {} : { containment: {
    parentOf: pairs.map(([parent, child]) => ({ parent: { projectId, moduleId: parent },
      child: { projectId, moduleId: child } })) } }) };
  const { answerRef, requests } = await world.answer(goal, answerOf(['root'], { baselineId: 's8b-answer-baseline',
    description: 'The answer boundary', constraints: [], catalog }));
  expect(renderedText(requests)).toContain('containment is OPTIONAL: give a parent/child pair only when the real '
    + 'sources show that one module contains the other; omit containment when you do not know (an omitted containment '
    + 'means unknown, never flat); an explicit {parentOf:[]} means every module is flat');
  await world.adoptInitial(await savedArchitecture(world, answerRef));
  expect((await world.architecture()).catalog.catalog).toStrictEqual(catalog);
});

it('B05a-root: a single root module is adopted as given, and a plan on it proposes and adopts', async () => {
  const world = await catalogWorld();
  const goal = await world.goal('s8b-goal');
  const root = catalogModule(world.scope.projectId, 'root', ['.']);
  const { answerRef } = await world.answer(goal, answerOf(['root'], { baselineId: 's8b-root-baseline',
    description: 'One root module', constraints: [], catalog: { requireDag: true, dependencies: [], modules: [root] } }));
  await world.adoptInitial(await savedArchitecture(world, answerRef));
  const adopted = (await world.architecture()).catalog.catalog;
  expect(Object.keys(adopted).sort()).toEqual(['dependencies', 'modules', 'requireDag']);
  expect(adopted.modules.map(module => Object.keys(module).sort()))
    .toEqual([['interfaces', 'name', 'paths', 'ref', 'responsibility']]);
  expect(adopted.modules).toEqual([root]);
  const proposed = (await world.proposeFromAnswer(answerRef)).result;
  if (proposed.status !== 'committed') throw new Error(JSON.stringify(proposed));
  const candidate = proposed.value;
  expect(candidate.catalogPin).toEqual(await world.pin());
  await world.governance();
  expect((await world.apply(candidate)).result).toMatchObject({ status: 'committed' });
});

describe('the candidate pin in the PlanProposal codec (OQ9 a)', () => {
  const pinOf = (projectId: string) => ({
    catalogRef: { aggregateType: 'ArchitectureCatalog' as const, projectId, baselineId: 'b', revision: 1 },
    baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision' as const, projectId, baselineId: 'b', revision: 1 },
      digest: 'a'.repeat(64) } });
  const goalRef = { aggregateType: 'Goal' as const, projectId: 'p', goalId: 'g' };
  const candidateWithPin = (catalogPin: ArchitectureCatalogPinV1 | null | undefined) => ({ kind: 'candidate_v2' as const,
    ref: { aggregateType: 'PlanProposal' as const, projectId: 'p', workspaceId: 'w', proposalId: 'c' }, revision: 1,
    schemaVersion: 2 as const, goalRef, basedOn: null, draft: scopedDraft(goalRef, ['core']),
    reason: { text: 'codec', sources: [] }, status: 'candidate' as const, issues: [], catalogPin }) as PlanProposal;
  it.each([
    { name: 'a pin of this project', pin: pinOf('p'), problem: null },
    { name: 'no active catalog (null)', pin: null, problem: null },
    { name: 'an absent pin', pin: undefined, problem: 'PlanProposalCatalogPinV1.catalogPin is invalid' },
    { name: 'a pin of another project', pin: pinOf('q'), problem: 'candidate_v2.catalogPin must name a catalog of this project' },
  ])('$name', ({ pin, problem }) => {
    expect(decodePlanProposalRecord(encodePlanProposal(candidateWithPin(pin)))).toEqual(problem === null
      ? { status: 'decoded', value: candidateWithPin(pin) } : { status: 'invalid', reason: `PlanProposal is invalid: ${problem}` });
  });
});
