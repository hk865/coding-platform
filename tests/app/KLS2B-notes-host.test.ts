/**
 * KLS-2b Host rows (level 1, memory): a repair note's ops live in its file and a person's edit decides what the
 * check round binds (B03, the 8C repair world's real Work Run, check round and the platform's own activator); a
 * second-workspace Work Run's `record_note` names its own module in its caller frame (B07, the XWS2A world after the
 * person approves the join's coarse split); and in the two-workspace XWS2P world a Plan proposed in the second
 * workspace takes its module ids once (B08), the current architecture read merges each workspace's files (B14), and a
 * note's extra anchor on the other workspace's module is found from there (B16). Every state comes from a public route,
 * the scripted model calling a real tool, or a person editing a file; every read is a public route or owner.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogRepairOpV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import { openS8CRepairWorld, type S8CRepairWorld } from '../helpers/S8C-repair-world.js';
import { openXWS2AWorld, XWS2A_MODULE_ID } from '../helpers/XWS2A-world.js';
import {
  addXWS2PSecondModule, listXWS2PNotes, openXWS2PWorld, readXWS2PCatalog, writeXWS2PNote, xws2pModuleId,
  xws2pProjectPath, type XWS2PWorld,
} from '../helpers/XWS2P-world.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(closers.splice(0).map(close => close()));
});

/** The JSON header of a note file: the lines between the version line and the first `---` line. */
function headerOf(text: string): Record<string, unknown> {
  const lines = text.split('\n');
  return JSON.parse(lines.slice(1, lines.indexOf('---')).join('\n')) as Record<string, unknown>;
}

async function xws2p(): Promise<XWS2PWorld> {
  const world = await openXWS2PWorld();
  closers.push(() => world.close());
  return world;
}

describe('B03 a repair note\'s ops are in its file; a person\'s edit decides what the check round binds', () => {
  const DUTY: CatalogRepairOpV1[] = [{ op: 'set_responsibility', moduleId: 's6a-core', text: '甲' }];
  const repairWorld = async (label: string): Promise<S8CRepairWorld> => {
    const target = await openS8CRepairWorld({ label });
    closers.push(() => target.close());
    return target;
  };
  const responsibility = async (target: S8CRepairWorld): Promise<string | undefined> => {
    const read = await target.world.platform.architecture.readArchitectureRevision(target.world.humanContext(),
      { selection: { kind: 'current' } });
    if (read.status !== 'ready') throw new Error(`the current architecture is not ready: ${JSON.stringify(read)}`);
    return read.value.catalog.catalog.modules.find(module => module.ref.moduleId === 's6a-core')?.responsibility;
  };
  const fileOf = (target: S8CRepairWorld, noteId: string): string =>
    join(target.world.root, `.workbench/notes/${S6A_SCOPE.workspaceId}/${noteId}.md`);
  const editDuty = (path: string): void => {
    const text = readFileSync(path, 'utf8');
    const edited = text.replace('"text": "甲"', '"text": "乙"');
    expect(edited).not.toBe(text);
    writeFileSync(path, edited);
  };
  const activate = (target: S8CRepairWorld, staged: { noteId: string; version: number }) =>
    target.owner.activateRepair(target.world.humanContext(), {
      commandId: `activate:${staged.noteId}:${String(staged.version)}`, noteId: staged.noteId, expectedVersion: staged.version });

  it('① edited after the round passed: the round no longer binds the note', async () => {
    const target = await repairWorld('kls2b-b03-after');
    const adopted = await responsibility(target);
    const staged = await target.writeRepair({ ops: DUTY });
    await target.pass(staged);
    const repair = headerOf(readFileSync(fileOf(target, staged.noteId), 'utf8'))['repair'] as Record<string, unknown>;
    expect(repair).toEqual({ ops: [{ op: 'set_responsibility', moduleId: 's6a-core', text: '甲' }] });
    editDuty(fileOf(target, staged.noteId));
    expect(await activate(target, staged)).toMatchObject({ status: 'source_stale', reason: 'round_changed' });
    expect(await responsibility(target)).toBe(adopted);
  }, 300_000);

  it('② edited before the round opened: the round binds the edit and the activation applies it', async () => {
    const target = await repairWorld('kls2b-b03-before');
    const staged = await target.writeRepair({ ops: DUTY });
    editDuty(fileOf(target, staged.noteId));
    await target.pass(staged);
    expect(await activate(target, staged)).toMatchObject({ status: 'activated' });
    expect(await responsibility(target)).toBe('乙');
  }, 300_000);
});

it('B07 a second-workspace Run\'s record_note names its own module bare and it lands in the project view', async () => {
  const world = await openXWS2AWorld({ backend: 'memory' });
  closers.push(() => world.close());
  await world.approveCoarse();
  const { line } = await world.workRun({ label: 'kls2b-b07', replies: [
    { kind: 'calls', calls: [{ callId: 'kls2b-b07-note', name: 'record_note', args: {
      op: 'write', kind: 'decision', topic: 'kls2b-b07', conclusion: 'B07: the second workspace module', body: 'B07',
      anchor: { kind: 'module', moduleId: XWS2A_MODULE_ID }, extraAnchors: [], structural: false,
      replaces: [], contradicts: [], coexistWith: [], expectedPointerRevision: null } }] },
    { kind: 'text', text: 'B07 done' },
  ] });
  const receipt = jsonOf(await world.base.world.scripted.requests(line), 'kls2b-b07-note') as
    { write: { status: string; noteId?: string } };
  expect(receipt.write.status, JSON.stringify(receipt)).not.toBe('rejected');
  const noteId = receipt.write.noteId!;
  const second = world.second.scope.workspaceId;
  expect((await world.notes({ kind: 'module', moduleId: xws2pModuleId(second, XWS2A_MODULE_ID) }))
    .map(item => item.noteId)).toContain(noteId);
  const header = headerOf(readFileSync(join(await world.secondRoot(), `.workbench/notes/${second}/${noteId}.md`), 'utf8'));
  expect(header['anchor']).toEqual({ kind: 'module', moduleId: XWS2A_MODULE_ID });
  // The bare id read in the main workspace's frame is the main workspace's module, not this one.
  const bare = await world.base.world.post('notes/list', plain(S6A_SCOPE,
    { anchor: { kind: 'module', moduleId: XWS2A_MODULE_ID }, limit: 100, cursor: null }));
  const body = bare.body as { status?: string; value?: { items?: NoteItemV1[] } };
  expect((body.status === 'ready' ? body.value?.items ?? [] : []).map(item => item.noteId)).not.toContain(noteId);
}, 300_000);

it('B08 a Plan proposed in the second workspace takes its module ids from its frame once', async () => {
  const world = await xws2p();
  expect(await addXWS2PSecondModule(world, { moduleId: 'second-mod', name: 'second-mod', summary: 'second module' }))
    .toMatchObject({ status: 'committed' });
  const second = s6aCardsWorkspace(world.world, world.second.scope);
  const goal = (await second.createGoal('kls2b-b08-goal', 'KLS2B B08')).ref;
  const stage = { stageId: 'kls2b-b08-stage', title: 'B08 stage' };
  const moduleRefs: Record<string, string> = {
    'kls2b-b08-own': 'second-mod',
    'kls2b-b08-main': xws2pModuleId(world.main.scope.workspaceId, 's6a-core'),
  };
  const base = ag2bPlanDraft(Object.keys(moduleRefs));
  const draft: PlanRevisionDraft = { ...base, planId: 'kls2b-b08-plan', goalId: goal.goalId, stages: [stage],
    tasks: base.tasks.map(task => task.taskKind === 'work'
      ? { ...task, stageId: stage.stageId, scope: { kind: 'module' as const, stageId: stage.stageId, moduleRef: moduleRefs[task.taskId]! } }
      : task) };
  const proposed = await second.post('plans/propose', graphWrite(second.scope, { goalRef: goal, basedOn: null, draft,
    reason: { text: 'KLS2B B08', sources: [] } }, 'kls2b-b08-propose')) as
    { status?: string; value?: { ref: unknown; revision: number } };
  expect(proposed, JSON.stringify(proposed)).toMatchObject({ status: 'committed' });
  const applied = await second.post('plans/apply', graphWrite(second.scope, { proposalRef: proposed.value!.ref,
    expectedProposalRevision: proposed.value!.revision, decisionRefs: [] }, 'kls2b-b08-apply'));
  expect(applied, JSON.stringify(applied)).toMatchObject({ status: 'committed' });
  const plan = await second.activePlan(goal);
  const taskModuleRef = (taskId: string) => {
    const scope = plan?.tasks.find(task => task.taskId === taskId)?.scope;
    return scope?.kind === 'module' ? scope.moduleRef : null;
  };
  expect(taskModuleRef('kls2b-b08-own')).toBe(xws2pModuleId(world.second.scope.workspaceId, 'second-mod'));
  expect(taskModuleRef('kls2b-b08-main')).toBe('s6a-core');
}, 300_000);

it('B14 the current architecture of two workspaces reads each workspace\'s files', async () => {
  const world = await xws2p();
  const current = readyValue<ArchitectureRevision>(await world.world.dispatch('architecture/read', world.main.ctx,
    plain(world.main.scope, { selection: { kind: 'current' } })), 'the current architecture');
  const pin: ArchitectureCatalogPinV1 = { catalogRef: current.catalog.ref,
    baseline: { ref: current.baseline.ref, digest: current.baseline.contentDigest } };
  const registration = readyValue<{ project: { revision: number }; workspace: { revision: number } }>(
    await world.world.dispatch('workspaces/registration', world.second.ctx, plain(world.second.scope, world.second.scope)),
    'the second workspace registration');
  const projectId = world.second.scope.projectId;
  // The second workspace's caller frame: its own module bare, the main workspace's prefixed.
  const revised = await world.world.dispatch('architecture/revise', world.second.ctx, graphWrite(world.second.scope, {
    expected: pin, responsibilityMoves: [], reason: 'KLS2B B14',
    ops: [
      { op: 'add_module', module: { ref: { projectId, moduleId: 'second-mod' }, name: 'second-mod',
        responsibility: '第二工作区', paths: [xws2pProjectPath(world.second.scope.workspaceId, 'src')], interfaces: [] } },
      { op: 'add_dependency', from: { projectId, moduleId: 'second-mod' },
        to: { projectId, moduleId: xws2pModuleId(world.main.scope.workspaceId, 's6a-core') }, reason: 'svc 调 core' },
    ],
  }, 'kls2b-b14-revise', [
    { ref: { aggregateType: 'Project', projectId }, revision: registration.project.revision },
    { ref: { aggregateType: 'Workspace', ...world.second.scope }, revision: registration.workspace.revision },
  ]));
  expect(revised, JSON.stringify(revised)).toMatchObject({ status: 'committed' });
  const folder = join(world.second.root, '.workbench/modules');
  const name = readdirSync(folder).find(file =>
    (JSON.parse(readFileSync(join(folder, file), 'utf8')) as { id?: string }).id === 'second-mod');
  if (name === undefined) throw new Error('the second workspace has no second-mod module file');
  const body = JSON.parse(readFileSync(join(folder, name), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(folder, name), `${JSON.stringify({ ...body, responsibility: '外部' }, null, 2)}\n`);
  const read = await readXWS2PCatalog(world);
  const secondMod = xws2pModuleId(world.second.scope.workspaceId, 'second-mod');
  expect(read.catalog.catalog.modules.find(module => module.ref.moduleId === secondMod)?.responsibility).toBe('外部');
  expect(read.catalog.catalog.dependencies).toContainEqual({ from: { projectId, moduleId: secondMod },
    to: { projectId, moduleId: 's6a-core' }, reason: 'svc 调 core' });
}, 300_000);

it('B16 a main-workspace note with an extra anchor on the second workspace\'s module is found from there', async () => {
  const world = await xws2p();
  expect(await addXWS2PSecondModule(world, { moduleId: 'second-mod', name: 'second-mod', summary: 'second module' }))
    .toMatchObject({ status: 'committed' });
  const secondMod = xws2pModuleId(world.second.scope.workspaceId, 'second-mod');
  const note: NoteDraftV1 = { kind: 'decision', topic: 'kls2b-b16', conclusion: 'B16', body: 'B16',
    anchor: { kind: 'module', moduleId: 's6a-core' }, extraAnchors: [{ kind: 'module', moduleId: secondMod }],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [] };
  const written = await writeXWS2PNote(world, world.main, note, 'kls2b-b16');
  expect(written.write).toMatchObject({ status: 'accepted' });
  const noteId = (written.write as { noteId: string }).noteId;
  expect(readFileSync(join(world.main.root, `.workbench/notes/${world.main.scope.workspaceId}/${noteId}.md`), 'utf8'))
    .toContain('"topic": "kls2b-b16"');
  const listed = await listXWS2PNotes(world, world.second, { kind: 'module', moduleId: secondMod });
  if (listed.status !== 'ready') throw new Error(`the notes on ${secondMod} are not ready: ${JSON.stringify(listed)}`);
  expect(listed.value.items.map(item => item.noteId)).toContain(noteId);
}, 300_000);
