/**
 * 8C G1 W1 — the repair write path.
 *
 * The accepted write is the real `record_note` tool in a scripted Work Run: the
 * Runtime builds the work context and command id, the tool parses the model's
 * JSON and the note service runs the pinned trial, then commits once. The
 * person's route is the same owner; a person or secretary repair is `forbidden`.
 * Reads are the public `notes/list`, `platform.notes.readNote` and
 * `platform.notes.listCurrentVersions`; no store is read and no context, pin,
 * receipt or head/version is built by hand (the pin comes from the public
 * architecture read through the production `catalogPinOf`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogPinOf } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { CatalogRepairOpV1, NoteDraftV1, RepairInputV1 } from '../../src/contracts/note.js';
import type { WriteNoteInput, WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import * as noteTools from '../../src/core/agent-runtime/note-tool.js';
import type { SessionWorkLinkRef } from '../../src/contracts/core/identity.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { S7A_REPLY_TOOLS, sessionOf } from '../helpers/S7A-fixture.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';

type Backend = 'memory' | 'sqlite';
type World = { world: S6AHostWorld; main: S6ACardsWorkspace; goal: GoalRef; task: TaskTriple;
  line: S6ASession; link: SessionWorkLinkRef; pin: ArchitectureCatalogPinV1 };

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

async function pinOf(world: S6AHostWorld): Promise<ArchitectureCatalogPinV1> {
  const read = await world.platform.architecture.readArchitectureRevision(world.humanContext(),
    { selection: { kind: 'current' } });
  if (read.status !== 'ready') throw new Error(`W1: the current architecture is not readable: ${JSON.stringify(read)}`);
  return catalogPinOf(read.value);
}

async function openRepairWorld(backend: Backend, label: string): Promise<World> {
  const world = await openS6AHostWorld({ backend,
    extraBindings: [{ binding: S7A_REPLY_TOOLS.binding, mergeTools: ['record_note'] }] });
  worlds.push(world);
  await world.setResumeOnStartup(false);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const goal = (await main.createGoal(`w1-goal-${label}`, `W1 repair ${label}`)).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label: `w1-${label}`,
    taskIds: [`w1-task-${label}`], role: S6A_WORK_ROLE.templateId });
  const created = await createS6BLine(main, { label: `w1-line-${label}`, role: S6A_WORK_ROLE, tasks });
  const line = await sessionOf(world, created);
  const card = await world.readSession(line.ref);
  const link = card.links.find(entry => entry.until === null && entry.ref.relation === 'responsible');
  if (link === undefined) throw new Error('W1: the line has no open responsible link');
  return { world, main, goal, task: tasks[0]!, line, link: link.ref, pin: await pinOf(world) };
}

/**
 * Declare `s6a-ui` under `s6a-core` through the catalog owner, so the next note
 * repair can delete a real containment child. The pin and both scope revisions
 * are the public reads taken immediately before the write.
 */
async function declareContainment(world: World): Promise<void> {
  const ctx = world.main.humanContext();
  const current = await world.world.platform.architecture.readArchitectureRevision(ctx,
    { selection: { kind: 'current' } });
  if (current.status !== 'ready' || current.value.catalog === null) {
    throw new Error(`W1: the current architecture is not readable: ${JSON.stringify(current)}`);
  }
  const registration = await world.main.route('workspaces/registration', {
    projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId }) as
    { status?: string; value?: { project: { revision: number }; workspace: { revision: number } } };
  if (registration.status !== 'ready' || registration.value === undefined) {
    throw new Error(`W1: the workspace registration is not ready: ${JSON.stringify(registration)}`);
  }
  const revised = await world.world.platform.architecture.reviseArchitectureCatalog(ctx, {
    meta: { requestId: 'w1-declare-containment', expected: [
      { ref: { aggregateType: 'Project', projectId: S6A_SCOPE.projectId },
        revision: registration.value.project.revision },
      { ref: { aggregateType: 'Workspace', projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId },
        revision: registration.value.workspace.revision },
    ] },
    input: {
      expected: { catalogRef: current.value.catalog.ref,
        baseline: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest } },
      ops: [{ op: 'set_parent', moduleId: 's6a-ui', parentId: 's6a-core' }],
      responsibilityMoves: [], reason: 'W1 declares a containment child',
    },
  });
  if (revised.status !== 'committed') {
    throw new Error(`W1: the containment revision did not commit: ${JSON.stringify(revised)}`);
  }
}

function repairInput(pin: ArchitectureCatalogPinV1, ops: CatalogRepairOpV1[],
  responsibilityMoves: RepairInputV1['responsibilityMoves'] = []): RepairInputV1 {
  return { pin, ops, responsibilityMoves };
}

function repairDraftOf(pin: ArchitectureCatalogPinV1, ops: CatalogRepairOpV1[], options: {
  structural?: boolean; repair?: RepairInputV1; kind?: 'repair' | 'convention'; anchorModule?: string;
  responsibilityMoves?: RepairInputV1['responsibilityMoves'] } = {}): NoteDraftV1 {
  return {
    kind: options.kind ?? 'repair', topic: `w1-${ops.map(op => op.op).join('-')}`,
    conclusion: 'W1 repair conclusion', anchor: { kind: 'module', moduleId: options.anchorModule ?? 's6a-core' },
    extraAnchors: [], facts: [], basisFiles: [], structural: options.structural ?? false,
    replaces: [], contradicts: [], coexistWith: [], body: 'W1 repair body',
    ...(options.kind === 'convention' ? {} : { repair: options.repair ?? repairInput(pin, ops, options.responsibilityMoves) }),
  } as NoteDraftV1;
}

async function runRepairNoteTool(world: World, calls: readonly Record<string, unknown>[]): Promise<ModelRequest[]> {
  await world.world.scripted.script(world.line, [
    ...calls.map(call => ({ kind: 'calls' as const, calls: [{ callId: String(call['callId']), name: 'record_note',
      args: call['args'] as Record<string, unknown> }] })),
    { kind: 'text', text: 'W1 answer' },
  ]);
  const claim = await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
    flowId: `w1-${calls.length}-${String(calls[0]?.['callId'] ?? 'none')}`, sessionHint: world.line.ref,
    kind: 'select_work', taskId: world.task.taskId }, 'claim_task');
  await driveWorkflow(world.world.ag2b, claim, { stopBefore: 'open_checks' });
  return world.world.scripted.requests(world.line);
}

/**
 * A3: the test's delegating wrapper around the REAL note owner the tool factory
 * receives. It records the Runtime's own context/request and, on the first
 * write, asks the same owner twice with that same context: one byte-identical
 * replay and one changed repair. The frozen Kernel refuses a reused ToolCall id
 * inside one Run (`runner_internal: 重复 ToolCall`), so the receipt replay is
 * observed here at the owner the tool already used, not by a second tool call.
 */
function captureReplay(change: (input: WriteNoteInput) => WriteNoteInput): {
  first(): WriteNoteResult | undefined; replay(): WriteNoteResult | undefined; conflict(): WriteNoteResult | undefined;
  restore(): void } {
  const original = noteTools.createNoteTools;
  let first: WriteNoteResult | undefined;
  let replay: WriteNoteResult | undefined;
  let conflict: WriteNoteResult | undefined;
  const spy = vi.spyOn(noteTools, 'createNoteTools').mockImplementation(config => original({
    ...config,
    notes: { ...config.notes, writeNote: async (ctx, input) => {
      first = await config.notes.writeNote(ctx, input);
      if (replay === undefined) {
        replay = await config.notes.writeNote(ctx, input);
        conflict = await config.notes.writeNote(ctx, change(input));
      }
      return first;
    } },
  }));
  return { first: () => first, replay: () => replay, conflict: () => conflict, restore: () => spy.mockRestore() };
}

type ToolOutcome = { status: string; output: readonly { kind: string; value?: unknown }[] };
function toolOutcomes(requests: readonly ModelRequest[], callId: string): ToolOutcome[] {
  const last = requests.at(-1);
  if (last === undefined) throw new Error('W1: the Session served no model request');
  return last.messages.flatMap(message => message.role === 'tool' && message.callId === callId
    ? [message.result as ToolOutcome] : []);
}
function toolJson(outcome: ToolOutcome): Record<string, unknown> {
  const block = outcome.output.find(candidate => candidate.kind === 'json');
  if (block === undefined) throw new Error('W1: the tool result has no JSON output');
  return block.value as Record<string, unknown>;
}
function writeOf(outcome: ToolOutcome): Record<string, unknown> {
  return (toolJson(outcome)['write'] ?? {}) as Record<string, unknown>;
}
async function listedRepairNotes(world: World, anchorModule = 's6a-core'): Promise<Record<string, unknown>[]> {
  const response = await world.world.post('notes/list', { scope: S6A_SCOPE,
    input: { anchor: { kind: 'module', moduleId: anchorModule }, limit: 100, cursor: null } }) as
    { body?: Record<string, unknown> };
  const answer = response.body ?? response as Record<string, unknown>;
  const value = answer['value'] as { items?: Record<string, unknown>[] } | undefined;
  if (answer['status'] !== 'ready' || value?.items === undefined) {
    throw new Error(`W1: notes/list is not ready: ${JSON.stringify(answer)}`);
  }
  return value.items;
}

describe('S8C W1 repair write', () => {
  it('W1: the tool writes the platform structural and the payload reaches both read projections', async () => {
    const world = await openRepairWorld('memory', 'projections');
    const ops: CatalogRepairOpV1[] = [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 repaired core' }];
    const requests = await runRepairNoteTool(world, [{ callId: 'w1-projections', args: {
      op: 'write', ...repairDraftOf(world.pin, ops, { structural: true }) } }]);
    const outcomes = toolOutcomes(requests, 'w1-projections');
    expect(outcomes).toHaveLength(1);
    const write = writeOf(outcomes[0]!);
    expect(write).toMatchObject({ status: 'staged', confirmedByUser: false });
    expect(write['structural']).toBeUndefined();

    const items = await listedRepairNotes(world);
    const item = items.find(candidate => candidate['kind'] === 'repair');
    if (item === undefined) throw new Error('W1: notes/list has no repair item');
    expect(item).toMatchObject({ kind: 'repair' });
    expect((item['repair'] as Record<string, unknown>)['structural']).toBe(false);
    expect(String(item['label'])).not.toContain('!');
    const noteId = String(item['noteId']);
    const version = Number(item['version']);

    const versions = await world.world.platform.notes.listCurrentVersions(world.world.humanContext(),
      { anchor: { kind: 'module', moduleId: 's6a-core' }, limit: 100, cursor: null });
    if (versions.status !== 'ready') throw new Error('W1: current versions are not readable');
    const current = versions.value.items.find(candidate => candidate.noteId === noteId);
    if (current === undefined) throw new Error('W1: the current version is missing');
    expect(current.structural).toBe(false);
    expect(current.repair?.structural).toBe(false);

    const history = await world.world.platform.notes.readNote(world.world.humanContext(), { noteId, version });
    expect(history.status).toBe('ready');
    if (history.status !== 'ready') return;
    expect(history.value.repair).toMatchObject({ structural: false, pin: world.pin,
      ops: [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 repaired core' }] });
  });

  it('W1: a repair that deletes a containment child is staged by the real tool', async () => {
    const world = await openRepairWorld('memory', 'child-delete');
    await declareContainment(world);
    const pin = await pinOf(world.world);
    const requests = await runRepairNoteTool(world, [{ callId: 'w1-child-delete', args: { op: 'write',
      ...repairDraftOf(pin, [{ op: 'remove_module', moduleId: 's6a-ui' }], { anchorModule: 's6a-core' }) } }]);
    const outcomes = toolOutcomes(requests, 'w1-child-delete');
    expect(outcomes).toHaveLength(1);
    expect(writeOf(outcomes[0]!)).toMatchObject({ status: 'staged', confirmedByUser: false });

    const items = await listedRepairNotes(world);
    const item = items.find(candidate => candidate['kind'] === 'repair');
    if (item === undefined) throw new Error('W1: notes/list has no repair item');
    const history = await world.world.platform.notes.readNote(world.world.humanContext(),
      { noteId: String(item['noteId']), version: Number(item['version']) });
    if (history.status !== 'ready') throw new Error('W1: the staged repair is not readable');
    expect(history.value.repair).toMatchObject({ pin, ops: [{ op: 'remove_module', moduleId: 's6a-ui' }] });
  });

  it.each(['memory', 'sqlite'] as const)('W1 %s: the same command input replays and a changed input conflicts',
    async backend => {
      const world = await openRepairWorld(backend, `replay-${backend}`);
      const first: CatalogRepairOpV1[] = [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 replay one' }];
      const changed: CatalogRepairOpV1[] = [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 replay two' }];
      const capture = captureReplay(input => ({ ...input, note: {
        ...input.note, repair: { ...(input.note as Extract<NoteDraftV1, { kind: 'repair' }>).repair,
          ops: changed } } }));
      let requests: ModelRequest[];
      try {
        requests = await runRepairNoteTool(world, [{ callId: 'w1-replay', args: { op: 'write', ...repairDraftOf(world.pin, first) } }]);
      } finally { capture.restore(); }
      const toolWrite = writeOf(toolOutcomes(requests, 'w1-replay')[0]!);
      expect(toolWrite).toMatchObject({ status: 'staged' });
      expect(capture.first()).toMatchObject({ status: 'staged' });
      expect(capture.replay()).toEqual(capture.first());
      expect(capture.conflict()).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'idempotency_conflict' });
      const items = await listedRepairNotes(world);
      expect(items.filter(candidate => candidate['kind'] === 'repair')).toHaveLength(1);
    });

  it('W1: the tool refuses repair on a convention and a repair without its payload', async () => {
    const world = await openRepairWorld('memory', 'early');
    const convention = repairDraftOf(world.pin, [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 no' }],
      { kind: 'convention' }) as Record<string, unknown>;
    const missing = repairDraftOf(world.pin, [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 missing' }]);
    const missingArgs = { ...missing } as Record<string, unknown>;
    delete missingArgs['repair'];
    const requests = await runRepairNoteTool(world, [
      { callId: 'w1-convention', args: { op: 'write', ...convention,
        repair: repairInput(world.pin, [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 no' }]) } },
      { callId: 'w1-missing', args: { op: 'write', ...missingArgs } },
    ]);
    const conventionWrite = writeOf(toolOutcomes(requests, 'w1-convention')[0]!);
    expect(conventionWrite).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'only a repair note carries a repair payload' });
    const missingWrite = writeOf(toolOutcomes(requests, 'w1-missing')[0]!);
    expect(missingWrite).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'a repair note requires a repair payload' });
    expect(await listedRepairNotes(world)).toEqual([]);
  });

  it('W1: the person route refuses a valid repair and refuses a missing payload as invalid', async () => {
    const world = await openRepairWorld('memory', 'route');
    const valid = repairDraftOf(world.pin, [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 human' }]);
    const forbidden = await world.world.post('notes/write', { scope: S6A_SCOPE, input: {
      commandId: 'w1-human-repair', note: valid, expectedPointerRevision: null, goalId: null } }) as
      { body?: Record<string, unknown> };
    const forbiddenBody = forbidden.body ?? forbidden as Record<string, unknown>;
    expect((forbiddenBody['write'] as Record<string, unknown>)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const missing = { ...valid } as Record<string, unknown>;
    delete missing['repair'];
    const invalid = await world.world.post('notes/write', { scope: S6A_SCOPE, input: {
      commandId: 'w1-human-missing', note: missing, expectedPointerRevision: null, goalId: null } }) as
      { body?: Record<string, unknown> };
    const invalidBody = invalid.body ?? invalid as Record<string, unknown>;
    expect((invalidBody['write'] as Record<string, unknown>)).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await listedRepairNotes(world)).toEqual([]);
  });

  describe('rejects: repair responsibility moves', () => {
    const CASES: readonly { label: string; ops: CatalogRepairOpV1[];
      moves: (link: SessionWorkLinkRef) => RepairInputV1['responsibilityMoves'] }[] = [
      { label: 'an empty destination list', ops: [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 empty' }],
        moves: link => [{ link, to: { kind: 'modules', destinations: [] } }] },
      { label: 'a duplicate destination', ops: [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 duplicate' }],
        moves: link => [{ link, to: { kind: 'modules', destinations: [
          { projectId: S6A_SCOPE.projectId, moduleId: 's6a-ui' }, { projectId: S6A_SCOPE.projectId, moduleId: 's6a-ui' }] } }] },
      { label: 'a standby object inside the destinations', ops: [
        { op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 standby' }],
        moves: link => [{ link, to: { kind: 'modules', destinations: [{ kind: 'standby' }] } as never }] },
      { label: 'a destination outside the trial catalog', ops: [{ op: 'remove_module', moduleId: 's6a-ui' }],
        moves: link => [{ link, to: { kind: 'modules', destinations: [{ projectId: S6A_SCOPE.projectId,
          moduleId: 's6a-ui' }] } }] },
    ];
    it.each(CASES)('W1: $label is refused invalid', async testCase => {
      const world = await openRepairWorld('memory', `moves-${String(CASES.indexOf(testCase))}`);
      const requests = await runRepairNoteTool(world, [{ callId: 'w1-moves', args: { op: 'write', ...repairDraftOf(world.pin,
        testCase.ops, { responsibilityMoves: testCase.moves(world.link) }) } }]);
      const write = writeOf(toolOutcomes(requests, 'w1-moves')[0]!);
      expect(write).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await listedRepairNotes(world)).toEqual([]);
    });

    it('W1: a module added by the same ops can be a destination', async () => {
      const world = await openRepairWorld('memory', 'moves-added');
      const added = { ref: { projectId: S6A_SCOPE.projectId, moduleId: 'w1-added' }, name: 'W1 added',
        responsibility: 'W1 added module', paths: ['src/w1-added'], interfaces: [] };
      const ops: CatalogRepairOpV1[] = [{ op: 'add_module', module: added }];
      const requests = await runRepairNoteTool(world, [{ callId: 'w1-moves-added', args: { op: 'write', ...repairDraftOf(world.pin, ops, {
        responsibilityMoves: [{ link: world.link, to: { kind: 'modules', destinations: [
          { projectId: S6A_SCOPE.projectId, moduleId: 'w1-added' }] } }] }) } }]);
      const write = writeOf(toolOutcomes(requests, 'w1-moves-added')[0]!);
      expect(write).toMatchObject({ status: 'staged' });
      const items = await listedRepairNotes(world);
      expect(items.filter(item => item['kind'] === 'repair')).toHaveLength(1);
    });
  });

  it('W1: the tool text carries the repair explanation and empty parameters', async () => {
    const world = await openRepairWorld('memory', 'pack');
    const requests = await runRepairNoteTool(world, [{ callId: 'w1-pack', args: { op: 'write',
      ...repairDraftOf(world.pin, [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'W1 pack' }]) } }]);
    const tool = requests.at(-1)?.tools.find(candidate => candidate.name === 'record_note');
    expect(tool?.description).toContain('{ pin, ops, responsibilityMoves }');
    expect(tool?.description).toContain('computes `structural`');
    expect(PLATFORM_PROMPT_PACK_V1.tools['record_note'].parameters).toEqual({});
    expect(PLATFORM_PROMPT_PACK_V1.tools['propose_architecture_revision'].parameters).toEqual({});
    expect(PLATFORM_PROMPT_PACK_V1.tools['propose_architecture_revision'].description)
      .toContain('{ baseCatalogPin, ops, responsibilityMoves, reason, operationRef? }');
  });
});
