/**
 * KLS-2a-1 service rows S1–S10 (level 2): every architecture and note write point writes the line's
 * `.workbench/` files, and the public current read of a one-line project reads them. The world is
 * `openKLS2AWorld` (a real platform over real git roots, the Host's workspace list as the platform option);
 * S4 reuses the 8C worlds' public proposal-approval and repair-activation flows. Prior states come from public
 * writes and from a person editing or copying a file; assertions read the files (the product's output) and the
 * public reads, never a store. Only S5 (a receipt replay) is a storage row; every other row runs on memory.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdoptInitialArchitectureInput, ArchitectureCatalogPinV1, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { CatalogRepairOpV1, NoteDraftV1 } from '../../src/contracts/note.js';
import { catalogPinOf } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import type { KnowledgeLines, LineKnowledge } from '../../src/core/work-graph/model/line-knowledge.js';
import { openKLS2AWorld, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { openProposalWorld } from '../helpers/S8C-proposal-world.js';
import { openS8CRepairWorld, plain, repairCommits } from '../helpers/S8C-repair-world.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

const MODULES = '.workbench/modules';
const ARCHITECTURE = '.workbench/architecture.json';

/**
 * A3 wrapper (S11, S12, S14): the catalog service gets the platform's real knowledge lines. A row may arm one step
 * that runs when one of the service's lines next computes its architecture file changes (`writeModule`, where the
 * module files are read; the step runs first), steps that run one each after the next architecture file reads
 * (`readArchitecture`, before the read returns), and one step that runs when the repair activation next computes
 * its file changes (the module's `architectureWritePlansOf`, which the activation imports; the step runs first).
 * S15 arms one step that runs when the activation next computes its note file changes (`noteFileWritesOf`, which it
 * imports from the note service, where the note files are read; the step runs first).
 * The real result comes back unchanged; unarmed, every call is the real one.
 */
const knowledgeGate = vi.hoisted(() => ({ beforeModuleWrite: null as null | (() => Promise<void>),
  afterArchitectureRead: [] as (() => Promise<void>)[], beforeWritePlans: null as null | (() => Promise<void>),
  beforeNoteFileWrites: null as null | (() => Promise<void>) }));
vi.mock('../../src/core/work-graph/notes/note-service.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/work-graph/notes/note-service.js')>();
  return { ...actual,
    noteFileWritesOf: async (...args: Parameters<typeof actual.noteFileWritesOf>) => {
      const step = knowledgeGate.beforeNoteFileWrites;
      knowledgeGate.beforeNoteFileWrites = null;
      if (step !== null) await step();
      return actual.noteFileWritesOf(...args);
    } };
});
vi.mock('../../src/core/work-graph/architecture/catalog-service.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/work-graph/architecture/catalog-service.js')>();
  const gatedLine = (line: LineKnowledge): LineKnowledge => ({ ...line,
    async readArchitecture() {
      const read = await line.readArchitecture();
      const step = knowledgeGate.afterArchitectureRead.shift();
      if (step !== undefined) await step();
      return read;
    },
    async writeModule(input, baseline) {
      const step = knowledgeGate.beforeModuleWrite;
      knowledgeGate.beforeModuleWrite = null;
      if (step !== null) await step();
      return line.writeModule(input, baseline);
    } });
  const gatedLines = (lines: KnowledgeLines): KnowledgeLines => ({ ...lines,
    async line(caller, workspaceId) {
      const opened = await lines.line(caller, workspaceId);
      return opened.status === 'ready' ? { status: 'ready', value: gatedLine(opened.value) } : opened;
    },
    async project(caller) {
      const opened = await lines.project(caller);
      return opened.status === 'ready' ? { status: 'ready', value: opened.value.map(gatedLine) } : opened;
    } });
  return { ...actual,
    createArchitectureCatalogService: (stores: Parameters<typeof actual.createArchitectureCatalogService>[0]) =>
      actual.createArchitectureCatalogService({ ...stores, knowledge: gatedLines(stores.knowledge) }),
    architectureWritePlansOf: async (...args: Parameters<typeof actual.architectureWritePlansOf>) => {
      const step = knowledgeGate.beforeWritePlans;
      knowledgeGate.beforeWritePlans = null;
      if (step !== null) await step();
      return actual.architectureWritePlansOf(...args);
    } };
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  knowledgeGate.beforeModuleWrite = null;
  knowledgeGate.afterArchitectureRead.length = 0;
  knowledgeGate.beforeWritePlans = null;
  knowledgeGate.beforeNoteFileWrites = null;
  for (const close of closers.splice(0).reverse()) await close();
});

async function knowledgeWorld(options: Parameters<typeof openKLS2AWorld>[0] = {}): Promise<KLS2AWorld> {
  const world = await openKLS2AWorld(options);
  closers.push(() => world.close());
  return world;
}

const asFileText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The parsed JSON file `<root>/<rel>`; a missing file fails the row by name. */
function jsonFileOf(world: KLS2AWorld, rel: string, workspaceId?: string): Record<string, unknown> {
  const text = world.file(rel, workspaceId);
  if (text === null) throw new Error(`no file ${rel}`);
  return JSON.parse(text) as Record<string, unknown>;
}

/** Every module file of one line: its file name and its parsed body. */
function moduleFilesIn(world: KLS2AWorld, workspaceId?: string): { name: string; body: Record<string, unknown> }[] {
  return world.files(MODULES, workspaceId).map(name => ({ name, body: jsonFileOf(world, `${MODULES}/${name}`, workspaceId) }));
}

function moduleFileWithId(world: KLS2AWorld, id: string, workspaceId?: string): { name: string; body: Record<string, unknown> } {
  const found = moduleFilesIn(world, workspaceId).find(file => file.body['id'] === id);
  if (found === undefined) throw new Error(`no module file with id ${id}`);
  return found;
}

/** The JSON header of a note file: the lines between the version line and the first `---` line. */
function noteHeaderIn(text: string | null): Record<string, unknown> {
  if (text === null) throw new Error('no note file');
  const lines = text.split('\n');
  return JSON.parse(lines.slice(1, lines.indexOf('---')).join('\n')) as Record<string, unknown>;
}

function moduleNamed(projectId: string, moduleId: string, paths: string[]): ModuleDefinition {
  return { ref: { projectId, moduleId }, name: moduleId, responsibility: `own ${moduleId}`, paths, interfaces: [] };
}

/** The S1 adoption: `mod_a` contains `mod_b`, description `d`. */
async function twoModuleAdoption(world: KLS2AWorld, requestId: string): Promise<GraphWrite<AdoptInitialArchitectureInput>> {
  const projectId = world.projectId;
  return { meta: { requestId, expected: await world.scopePins() },
    input: { baselineId: 'kls2a-baseline', description: 'd', constraints: [], catalog: {
      requireDag: true, dependencies: [],
      modules: [moduleNamed(projectId, 'mod_a', ['src/a']), moduleNamed(projectId, 'mod_b', ['src/b'])],
      containment: { parentOf: [{ parent: { projectId, moduleId: 'mod_a' }, child: { projectId, moduleId: 'mod_b' } }] } } } };
}

async function adoptTwoModules(world: KLS2AWorld): Promise<void> {
  const adopted = await world.platform.architecture.adoptInitialArchitecture(world.ctx(),
    await twoModuleAdoption(world, 'kls2a-adopt'));
  expect(adopted, JSON.stringify(adopted)).toMatchObject({ status: 'committed' });
}

async function currentArchitecture(world: KLS2AWorld): Promise<ArchitectureRevision> {
  const read = await world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } });
  if (read.status !== 'ready') throw new Error(`the current architecture read is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

const moduleIdsOf = (revision: ArchitectureRevision): string[] =>
  revision.catalog.catalog.modules.map(module => module.ref.moduleId);

async function reviseWith(world: KLS2AWorld, ops: CatalogRepairOpV1[], expected: ArchitectureCatalogPinV1,
  requestId: string, workspaceId?: string) {
  return world.platform.architecture.reviseArchitectureCatalog(world.ctx('host', workspaceId), {
    meta: { requestId, expected: await world.scopePins(workspaceId) },
    input: { expected, ops, responsibilityMoves: [], reason: 'kls2a revision' } });
}

function noteIdOf(result: WriteNoteResult): string {
  if (result.status === 'rejected') throw new Error(`the note write was refused: ${JSON.stringify(result)}`);
  return result.noteId;
}

function noteDraft(overrides: Partial<NoteDraftV1>): NoteDraftV1 {
  return { kind: 'decision', topic: 'kls2a', conclusion: 'c', body: 'b', anchor: { kind: 'module', moduleId: 'mod_a' },
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
    ...overrides } as NoteDraftV1;
}

it('S1 the adoption writes one file per module and the public current read answers from them', async () => {
  const world = await knowledgeWorld();
  await adoptTwoModules(world);
  expect(world.files(MODULES)).toEqual([expect.stringMatching(/^[a-f0-9]{32}\.json$/),
    expect.stringMatching(/^[a-f0-9]{32}\.json$/)]);
  const read = await currentArchitecture(world);
  expect(moduleIdsOf(read)).toEqual(['mod_a', 'mod_b']);
  expect(read.baseline.content.description).toBe('d');
});

it('S2 the public current read takes the knowledge fields from the files', async () => {
  const world = await knowledgeWorld();
  await adoptTwoModules(world);
  const architecture = jsonFileOf(world, ARCHITECTURE);
  world.edit(ARCHITECTURE, asFileText({ ...architecture,
    baseline: { ...(architecture['baseline'] as Record<string, unknown>), description: '外部改的' } }));
  const moduleB = moduleFileWithId(world, 'mod_b');
  world.edit(`${MODULES}/${moduleB.name}`, asFileText({ ...moduleB.body, responsibility: '改过' }));
  const read = await currentArchitecture(world);
  expect(read.baseline.content.description).toBe('外部改的');
  expect(read.catalog.catalog.modules.find(module => module.ref.moduleId === 'mod_b')?.responsibility).toBe('改过');
});

it('S3 a revision rewrites the whole set: the removed module\'s file goes, a kept module keeps its file name', async () => {
  const world = await knowledgeWorld();
  await adoptTwoModules(world);
  const kept = moduleFileWithId(world, 'mod_a').name;
  const pin = catalogPinOf(await currentArchitecture(world));
  const revised = await reviseWith(world, [{ op: 'remove_module', moduleId: 'mod_b' }], pin, 'kls2a-s3');
  expect(revised, JSON.stringify(revised)).toMatchObject({ status: 'committed' });
  expect(world.files(MODULES)).toEqual([kept]);
  expect(moduleIdsOf(await currentArchitecture(world))).toEqual(['mod_a']);
});

describe('S4 the two 8C architecture write points write the module file too', () => {
  const NEW_DUTY: CatalogRepairOpV1[] = [{ op: 'set_responsibility', moduleId: 's6a-core', text: '新职责' }];
  it.each([
    ['① a structural proposal approved through its card', async (): Promise<string> => {
      const target = await openProposalWorld({ backend: 'memory' });
      closers.push(() => target.close());
      const [proposed] = await target.propose([{ baseCatalogPin: target.pin, ops: NEW_DUTY, reason: 'kls2a S4 proposal' }]);
      if (proposed?.status !== 'needs_decision') throw new Error(`the proposal needs no decision: ${JSON.stringify(proposed)}`);
      const answered = await target.answer(await target.cardByKey(proposed.cardKey), 'approve', 'kls2a-s4-approve');
      expect(answered.state).toBe('applied');
      return target.staff.world.root;
    }],
    ['② a repair note activated after its check passed', async (): Promise<string> => {
      const target = await openS8CRepairWorld({ label: 'kls2a-s4' });
      closers.push(() => target.close());
      const staged = await target.writeRepair({ ops: NEW_DUTY });
      await target.pass(staged);
      const activated = await target.owner.activateRepair(target.world.humanContext(), {
        commandId: `activate:${staged.noteId}:${staged.version}`, noteId: staged.noteId, expectedVersion: staged.version });
      expect(activated).toMatchObject({ status: 'activated' });
      return target.world.root;
    }],
  ] as [string, () => Promise<string>][])('%s', async (_label, flow) => {
    const folder = join(await flow(), MODULES);
    const bodies = existsSync(folder) ? readdirSync(folder)
      .map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')) as Record<string, unknown>) : [];
    expect(bodies.find(body => body['id'] === 's6a-core')?.['responsibility']).toBe('新职责');
  }, 300_000);
});

describe.each(['memory', 'sqlite'] as const)('S5 (%s) a replayed adoption', storage => {
  it('returns the original receipt and leaves a person\'s later edit on disk', async () => {
    const world = await knowledgeWorld({ storage });
    const request = await twoModuleAdoption(world, 'r1');
    const first = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), request);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    const moduleA = moduleFileWithId(world, 'mod_a');
    world.edit(`${MODULES}/${moduleA.name}`, asFileText({ ...moduleA.body, responsibility: '人改的' }));
    const second = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), request);
    expect(second).toEqual({ ...first, replayed: true });
    expect(moduleFileWithId(world, 'mod_a').body['responsibility']).toBe('人改的');
  });
});

it('S6 a knowledge note is written to its file; a note on a goal is not', async () => {
  const world = await knowledgeWorld();
  await adoptTwoModules(world);
  const onModule = await world.platform.notes.writeNote(world.ctx(), { commandId: 'kls2a-s6-module', note: noteDraft({
    kind: 'convention', topic: '写入顺序', conclusion: '先事件后文件' }), expectedPointerRevision: null, goalId: null });
  expect(onModule).toMatchObject({ status: 'accepted' });
  const moduleNoteId = noteIdOf(onModule);
  const text = world.file(`.workbench/notes/ws/${moduleNoteId}.md`);
  expect(text).not.toBeNull();
  expect(text!.split('\n')[0]).toBe('--- knowledge-note@1');
  expect(text).toContain('"topic": "写入顺序"');
  expect(text).not.toContain('"id"');
  const onGoal = await world.platform.notes.writeNote(world.ctx(), { commandId: 'kls2a-s6-goal', note: noteDraft({
    kind: 'pitfall', topic: '过程', anchor: { kind: 'goal', goalId: world.goalRef.goalId } }),
  expectedPointerRevision: null, goalId: world.goalRef.goalId });
  expect(onGoal).toMatchObject({ status: 'accepted' });
  expect(world.files('.workbench/notes/ws')).toEqual([`${moduleNoteId}.md`]);
});

it('S7 one revision from the second workspace writes every line of the project', async () => {
  const world = await knowledgeWorld({ workspaces: ['ws', 'ws2'] });
  const projectId = world.projectId;
  const adopted = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
    meta: { requestId: 'kls2a-s7-adopt', expected: await world.scopePins() },
    input: { baselineId: 'kls2a-s7-baseline', description: 'd', constraints: [], catalog: {
      requireDag: true, dependencies: [], modules: [moduleNamed(projectId, 'core', ['src'])] } } });
  expect(adopted, JSON.stringify(adopted)).toMatchObject({ status: 'committed' });
  const pin = catalogPinOf(await currentArchitecture(world));
  // The caller frame of ws2: its own module bare, the main workspace's prefixed.
  const revised = await reviseWith(world, [
    { op: 'add_module', module: moduleNamed(projectId, 'svc', ['src/x']) },
    { op: 'add_dependency', from: { projectId, moduleId: '/@ws:ws/core' }, to: { projectId, moduleId: 'svc' },
      reason: 'core 调 svc' },
  ], pin, 'kls2a-s7-revise', 'ws2');
  expect(revised, JSON.stringify(revised)).toMatchObject({ status: 'committed' });
  expect(moduleFilesIn(world, 'ws2').map(file => ({ id: file.body['id'], paths: file.body['paths'] })))
    .toEqual([{ id: 'svc', paths: ['src/x'] }]);
  expect((jsonFileOf(world, ARCHITECTURE)['crossWorkspace'] as Record<string, unknown>)['dependsOn'])
    .toEqual([{ from: 'core', reason: 'core 调 svc', to: '/@ws:ws2/svc' }]);
  expect([...moduleIdsOf(await currentArchitecture(world))].sort()).toEqual(['/@ws:ws2/svc', 'core']);
});

/** A person's note and an agent's note contradicting it, waiting on one review card that `coexist` resolves. */
async function coexistOnReview(world: KLS2AWorld, prefix: string,
  beforeResolve: (agentId: string) => void = () => undefined): Promise<{ mineId: string; agentId: string }> {
  await adoptTwoModules(world);
  await world.claimExecutorRun();
  const mine = await world.platform.notes.writeNote(world.ctx(), { commandId: `${prefix}-user`,
    note: noteDraft({ conclusion: '用户的结论' }), expectedPointerRevision: null, goalId: world.goalRef.goalId });
  expect(mine).toMatchObject({ status: 'accepted' });
  const mineId = noteIdOf(mine);
  const agent = await world.platform.notes.writeNote(world.ctx('work_run'), { commandId: `${prefix}-agent`,
    note: noteDraft({ conclusion: '相反的结论', contradicts: [mineId] }), expectedPointerRevision: null,
    goalId: world.goalRef.goalId });
  expect(agent).toMatchObject({ status: 'pending_review' });
  const agentId = noteIdOf(agent);
  beforeResolve(agentId);
  const queue = await world.platform.decisions.queryDecisionQueue(world.ctx(), {
    workspace: { projectId: world.projectId, workspaceId: world.workspaceId }, sections: ['waiting_answer'], page: { limit: 100 } });
  if (queue.status !== 'ready') throw new Error(`the decision queue is not ready: ${JSON.stringify(queue)}`);
  const cards = queue.value.waitingAnswer.filter(card => card.source.kind === 'note_review');
  expect(cards).toHaveLength(1);
  const card = cards[0]!;
  const resolve = world.platform.workflow.resolveDecision;
  if (resolve === undefined) throw new Error('the platform publishes no resolveDecision');
  expect(await resolve(world.ctx(), { input: { source: card.source, selection: { kind: 'option', optionId: 'coexist' },
    text: '', annotations: [] }, meta: { requestId: `${prefix}-coexist`, expected: card.source.pins } }))
    .toMatchObject({ status: 'ready', value: { state: 'applied' } });
  return { mineId, agentId };
}

it('S8 a card disposition that changes the relations rewrites the note file', async () => {
  const world = await knowledgeWorld();
  const { mineId, agentId } = await coexistOnReview(world, 'kls2a-s8');
  const header = noteHeaderIn(world.file(`.workbench/notes/ws/${agentId}.md`));
  expect(header['coexistWith']).toEqual([mineId]);
  expect(header['contradicts']).toEqual([]);
});

it('S8b a disposition keeps a file path a person added to the note file that the record has no digest for', async () => {
  const world = await knowledgeWorld();
  const pathOf = (agentId: string): string => `.workbench/notes/ws/${agentId}.md`;
  const { mineId, agentId } = await coexistOnReview(world, 'kls2b-s8b', agentId => {
    const text = world.file(pathOf(agentId))!;
    const lines = text.split('\n');
    const header = { ...noteHeaderIn(text), facts: [{ kind: 'file', path: 'src/a.ts' }] };
    world.edit(pathOf(agentId), [lines[0], JSON.stringify(header, null, 2), ...lines.slice(lines.indexOf('---'))].join('\n'));
  });
  const header = noteHeaderIn(world.file(pathOf(agentId)));
  expect(header['facts']).toEqual([{ kind: 'file', path: 'src/a.ts' }]);
  expect(header['coexistWith']).toEqual([mineId]);
});

it('S9 a revision plans from the current files and keeps a person\'s edit it did not reconcile', async () => {
  const world = await knowledgeWorld();
  await adoptTwoModules(world);
  const pin = catalogPinOf(await currentArchitecture(world));
  const moduleA = moduleFileWithId(world, 'mod_a');
  world.edit(`${MODULES}/${moduleA.name}`, asFileText({ ...moduleA.body, responsibility: '人改的' }));
  const revised = await reviseWith(world, [{ op: 'add_path', moduleId: 'mod_a', path: 'src/extra' }], pin, 'kls2a-s9');
  expect(revised, JSON.stringify(revised)).toMatchObject({ status: 'committed' });
  const after = moduleFileWithId(world, 'mod_a').body;
  expect(after['responsibility']).toBe('人改的');
  expect(after['paths']).toContain('src/extra');
});

describe('S10 a person\'s change to the module files and the public current read', () => {
  it('① (D3′) a path two module files claim reads as it is', async () => {
    const world = await knowledgeWorld();
    await adoptTwoModules(world);
    const moduleA = moduleFileWithId(world, 'mod_a');
    const moduleB = moduleFileWithId(world, 'mod_b');
    world.edit(`${MODULES}/${moduleB.name}`, asFileText({ ...moduleB.body, paths: moduleA.body['paths'] }));
    const read = await world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } });
    expect(read.status).toBe('ready');
    expect(moduleIdsOf((read as { value: ArchitectureRevision }).value)).toEqual(['mod_a', 'mod_b']);
    expect((read as { value: ArchitectureRevision }).value.catalog.catalog.modules
      .find(module => module.ref.moduleId === 'mod_b')?.paths).toEqual(['src/a']);
  });

  it('② a copied module file (two files, one id) makes the read unavailable and names both files', async () => {
    const world = await knowledgeWorld();
    await adoptTwoModules(world);
    const moduleA = moduleFileWithId(world, 'mod_a');
    const copy = `${'f'.repeat(32)}.json`;
    world.edit(`${MODULES}/${copy}`, world.file(`${MODULES}/${moduleA.name}`)!);
    const read = await world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } });
    expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect((read as { reason: string }).reason).toContain(moduleA.name);
    expect((read as { reason: string }).reason).toContain(copy);
  });

  it('③ a module path that leaves the workspace (`../outside`) makes the read unavailable and names the file', async () => {
    const world = await knowledgeWorld();
    await adoptTwoModules(world);
    const moduleA = moduleFileWithId(world, 'mod_a');
    world.edit(`${MODULES}/${moduleA.name}`, asFileText({ ...moduleA.body, paths: ['../outside'] }));
    const read = await world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } });
    expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect((read as { reason: string }).reason).toContain(moduleA.name);
  });
});

it('S11 (stack review 1) a module delete commits although an unrelated commit lands while its module files are read',
  async () => {
    const world = await knowledgeWorld();
    await adoptTwoModules(world);
    const pin = catalogPinOf(await currentArchitecture(world));
    knowledgeGate.beforeModuleWrite = async () => {
      const created = await world.platform.goals.createGoal(world.ctx(), {
        meta: { requestId: 'kls2a-s11-goal', expected: await world.scopePins() },
        input: { goalId: 'kls2a-s11-goal', workspace: { projectId: world.projectId, workspaceId: world.workspaceId },
          objective: '无关的目标' } });
      expect(created, JSON.stringify(created)).toMatchObject({ status: 'committed' });
    };
    const revised = await reviseWith(world, [{ op: 'remove_module', moduleId: 'mod_b' }], pin, 'kls2a-s11');
    expect(knowledgeGate.beforeModuleWrite).toBeNull();
    expect(revised, JSON.stringify(revised)).toMatchObject({ status: 'committed' });
    expect(moduleIdsOf(await currentArchitecture(world))).toEqual(['mod_a']);
  });

it('S12 (stack review 2) lines/list stays ready with an exact archived count when an architecture commit lands after '
  + 'its architecture read, before its window', async () => {
  const world = await knowledgeWorld();
  await adoptTwoModules(world);
  const pin = catalogPinOf(await currentArchitecture(world));
  knowledgeGate.afterArchitectureRead.push(
    // The list's read before its window: an architecture commit moves the catalog pointer, so the queue's window moves.
    async () => {
      const revised = await reviseWith(world, [{ op: 'add_path', moduleId: 'mod_a', path: 'src/s12' }], pin, 'kls2a-s12');
      expect(revised, JSON.stringify(revised)).toMatchObject({ status: 'committed' });
    },
    // The next architecture read: an unrelated commit lands while it runs.
    async () => {
      const created = await world.platform.goals.createGoal(world.ctx(), {
        meta: { requestId: 'kls2a-s12-goal', expected: await world.scopePins() },
        input: { goalId: 'kls2a-s12-goal', workspace: { projectId: world.projectId, workspaceId: world.workspaceId },
          objective: '无关的目标' } });
      expect(created, JSON.stringify(created)).toMatchObject({ status: 'committed' });
    });
  const listed = await world.platform.workLines.listWorkLines(world.ctx(),
    { workspace: { projectId: world.projectId, workspaceId: world.workspaceId } });
  expect(knowledgeGate.afterArchitectureRead).toEqual([]);
  expect(listed, JSON.stringify(listed)).toMatchObject({ status: 'ready',
    value: { counts: { archived: { status: 'exact', value: 0 } }, attentionProblem: null } });
});

it('S14 (quick check 5) a repair activation sent twice at once: the copy sent while the first holds the write queue '
  + 'computing its file changes answers the first activation', async () => {
  const target = await openS8CRepairWorld({ label: 'kls2a-s14' });
  closers.push(() => target.close());
  const staged = await target.writeRepair({ ops: [{ op: 'set_responsibility', moduleId: 's6a-core', text: '新职责' }] });
  await target.pass(staged);
  const input = { commandId: `activate:${staged.noteId}:${staged.version}`, noteId: staged.noteId,
    expectedVersion: staged.version };
  // KLS-2b [2B-06]: an activation's reads, file changes and commit run in the project's write queue, so the second
  // copy can no longer run inside the first. A holds the queue while it computes its file changes; B is sent then
  // (A has no receipt yet) and runs after A.
  let reached!: () => void;
  const held = new Promise<void>(resolve => { reached = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  knowledgeGate.beforeWritePlans = async () => { reached(); await gate; };
  const firstCall = target.owner.activateRepair(target.world.humanContext(), input);
  await held;
  const secondCall = target.owner.activateRepair(target.world.humanContext(), input);
  release();
  const first = await firstCall;
  expect(first, JSON.stringify(first)).toMatchObject({ status: 'activated' });
  expect(knowledgeGate.beforeWritePlans).toBeNull();
  expect(await secondCall).toEqual(first);
});

it('S15 (KLS-2b code review 1) a repair activation that removes a module commits although an unrelated commit lands '
  + 'while its note file is read', async () => {
  const target = await openS8CRepairWorld({ label: 'kls2b-s15' });
  closers.push(() => target.close());
  // R6b's path: the person approves the delete, the check passes, the Workflow's complete_task closes t1 and then
  // activates the repair.
  const staged = await target.writeRepair({ ops: [{ op: 'remove_module', moduleId: 's6a-core' }] });
  const card = await target.readRepairCard();
  expect((await target.answerRepairCard(card, 'approve', 'kls2b-s15-answer')).answer.status).toBe('committed');
  const outcome = await target.pass(staged);
  if (outcome.next === null || outcome.next.kind !== 'perform' || outcome.next.operation.kind !== 'complete_task') {
    throw new Error(`S15: the PASS did not stop before complete_task: ${JSON.stringify(outcome.next)}`);
  }
  knowledgeGate.beforeNoteFileWrites = async () => {
    await target.main.createGoal('kls2b-s15-goal', '无关的目标');
  };
  repairCommits.reset();
  await target.world.post('workflow/advance', plain(S6A_SCOPE, outcome.next));
  expect(knowledgeGate.beforeNoteFileWrites).toBeNull();
  // The activation that read its note file across the unrelated commit is the one that commits: no refused commit
  // left to a driver's later attempt.
  expect(repairCommits.identities().filter(identity => identity.startsWith('s4-note-activate:'))).toHaveLength(1);
  expect(await target.readModules()).toEqual(['s6a-ui']);
  expect(await target.readNote(staged.noteId)).toMatchObject({ version: 2, storedState: 'accepted' });
});

describe('rejects: S13 (stack review 3) an adoption path the read-back would refuse', () => {
  it('a module path that leaves the workspace (`../outside`) is invalid; nothing is committed or written and the '
    + 'current read is unchanged', async () => {
    const world = await knowledgeWorld();
    const readCurrent = () => world.platform.architecture.readArchitectureRevision(world.ctx(), { selection: { kind: 'current' } });
    const before = await readCurrent();
    const request = await twoModuleAdoption(world, 'kls2a-s13');
    const adopted = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), { ...request,
      input: { ...request.input, catalog: { ...request.input.catalog, modules: [
        moduleNamed(world.projectId, 'mod_a', ['../outside']), moduleNamed(world.projectId, 'mod_b', ['src/b'])] } } });
    expect(adopted, JSON.stringify(adopted)).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await readCurrent()).toEqual(before);
    expect(world.files(MODULES)).toEqual([]);
    expect(world.file(ARCHITECTURE)).toBeNull();
  });
});
