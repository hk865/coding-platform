/**
 * KLS-2b platform rows (level 2): a note's knowledge fields are read from its file, its run-time and check results
 * from the project's record; the anchor and text searches find notes through the index; a failed index step never
 * fails a write; the read points that pick candidates (similar notes, a scribe's managed scope, neighbours) and a
 * write that supersedes a note use the file's knowledge. The world is `openKLS2AWorld` (a real platform over a real
 * git root); B15 ② is the S4A scope fixture's region scribes; B11 wraps the real index with `KLS2B-index-fault.ts`.
 * Prior states come from public writes and from a person editing or deleting a note file; every assertion reads a
 * public owner or the files. The anchor and text searches (B04, B05, B06, B09) and B11 run on memory and SQLite;
 * every other row runs on memory.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { SemanticLinkV1 } from '../../src/contracts/semantic-layer.js';
import type { MemoryFindRequest, WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import { openKLS2AWorld, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { faultOnceIndexFactory } from '../helpers/KLS2B-index-fault.js';
import { createS4ANoteScopeFixture } from '../helpers/S4A-note-scope-fixture.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function knowledgeWorld(options: Parameters<typeof openKLS2AWorld>[0] = {}): Promise<KLS2AWorld> {
  const world = await openKLS2AWorld(options);
  closers.push(() => world.close());
  return world;
}

const notePath = (noteId: string): string => `.workbench/notes/ws/${noteId}.md`;

/** The JSON header of a note file: the lines between the version line and the first `---` line. */
function headerOf(text: string | null): Record<string, unknown> {
  if (text === null) throw new Error('no note file');
  const lines = text.split('\n');
  return JSON.parse(lines.slice(1, lines.indexOf('---')).join('\n')) as Record<string, unknown>;
}

/** A person's edit of one note file: `from` must be in it. */
function editNote(world: KLS2AWorld, noteId: string, from: string, to: string): void {
  const text = world.file(notePath(noteId));
  if (text === null || !text.includes(from)) throw new Error(`the note file ${noteId} has no ${from}`);
  world.edit(notePath(noteId), text.replace(from, to));
}

/**
 * The catalog every row adopts: `core` (with the interface `api`), `billing`, `ops` and `empty`, which no note names.
 * The link rows' evidence files sit in `core` and `billing`; `src/x.ts` is B04's file anchor.
 */
async function adoptCatalog(world: KLS2AWorld): Promise<void> {
  const projectId = world.projectId;
  const moduleDef = (moduleId: string, interfaces: { id: string; description: string; paths: string[] }[] = []) =>
    ({ ref: { projectId, moduleId }, name: moduleId, responsibility: `own ${moduleId}`, paths: [`src/${moduleId}`], interfaces });
  const adopted = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
    meta: { requestId: 'kls2b-adopt', expected: await world.scopePins() },
    input: { baselineId: 'kls2b-baseline', description: 'd', constraints: [], catalog: { requireDag: true, dependencies: [],
      modules: [moduleDef('core', [{ id: 'api', description: 'core api', paths: ['src/core'] }]), moduleDef('billing'),
        moduleDef('ops'), moduleDef('empty')] } } });
  expect(adopted, JSON.stringify(adopted)).toMatchObject({ status: 'committed' });
  mkdirSync(join(world.root, 'src/core'), { recursive: true });
  mkdirSync(join(world.root, 'src/billing'), { recursive: true });
  world.edit('src/core/service.ts', 'export function save() { return "ledger.json"; }\n');
  world.edit('src/billing/ledger.ts', 'export function load() { return "ledger.json"; }\n');
  world.edit('src/x.ts', 'export const x = 1;\n');
}

function noteDraft(overrides: Partial<NoteDraftV1>): NoteDraftV1 {
  return { kind: 'decision', topic: 'kls2b', conclusion: 'c', body: 'b', anchor: { kind: 'module', moduleId: 'core' },
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
    ...overrides } as NoteDraftV1;
}

/** `core` writes `ledger.json` and `billing` reads it: a `data` link with its two evidence roles. */
const dataLink = (topic: string): NoteDraftV1 => noteDraft({ kind: 'link', topic, conclusion: 'core 写 billing 读',
  extraAnchors: [{ kind: 'module', moduleId: 'billing' }],
  link: { relation: 'data', key: { kind: 'literal', text: 'ledger.json' },
    evidence: [{ role: 'emit', at: { path: 'src/core/service.ts' } }, { role: 'receive', at: { path: 'src/billing/ledger.ts' } }] },
} as Partial<NoteDraftV1>);

function noteIdOf(result: WriteNoteResult): string {
  if (result.status === 'rejected') throw new Error(`the note write was refused: ${JSON.stringify(result)}`);
  return result.noteId;
}

/** One public note write of the world's Host caller; any refusal fails the row with its body. */
async function written(world: KLS2AWorld, commandId: string, note: NoteDraftV1, goalId: string | null = null): Promise<string> {
  return noteIdOf(await world.platform.notes.writeNote(world.ctx(), { commandId, note, expectedPointerRevision: null, goalId }));
}

async function itemOf(world: KLS2AWorld, input: { noteId: string; version?: number }) {
  const read = await world.platform.notes.readNote(world.ctx(), input);
  if (read.status !== 'ready') throw new Error(`the note ${input.noteId} is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

async function linksOn(world: KLS2AWorld, moduleId: string): Promise<SemanticLinkV1[]> {
  const read = await world.platform.notes.readSemanticLinks(world.ctx(),
    { scope: { kind: 'module', moduleId }, cursor: null, limit: 100 });
  if (read.status !== 'ready') throw new Error(`the semantic links of ${moduleId} are not ready: ${JSON.stringify(read)}`);
  return read.value.items;
}

async function idsByAnchor(world: KLS2AWorld, anchor: NoteAnchorV1): Promise<string[]> {
  const page = await world.platform.notes.listByAnchor(world.ctx(), { anchor, limit: 20, cursor: null });
  if (page.status !== 'ready') throw new Error(`the notes on ${JSON.stringify(anchor)} are not ready: ${JSON.stringify(page)}`);
  return page.value.items.map(item => item.noteId);
}

async function found(world: KLS2AWorld, request: Omit<MemoryFindRequest, 'v' | 'op'>) {
  const read = await world.platform.notes.memoryFind(world.ctx(), { v: 1, op: 'find', ...request });
  if (read.status !== 'ready') throw new Error(`the find is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

it('B01 a semantic link read takes the relation from the file and the verification from the record', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const noteId = await written(world, 'kls2b-b01', dataLink('kls2b-b01'));
  const before = (await linksOn(world, 'core')).find(item => item.noteId === noteId);
  editNote(world, noteId, '"relation": "data"', '"relation": "message"');
  const after = (await linksOn(world, 'core')).find(item => item.noteId === noteId);
  expect(after?.relation).toBe('message');
  expect(after?.verification).toEqual(before?.verification);
});

it('CR5 an evidence role a person changed in the file is read, and its place keeps the recorded digest', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const noteId = await written(world, 'kls2b-cr5', dataLink('kls2b-cr5'));
  const before = (await itemOf(world, { noteId })).link!.evidence[0]!;
  editNote(world, noteId, '"role": "emit"', '"role": "use"');
  expect((await itemOf(world, { noteId })).link!.evidence[0]).toEqual({ ...before, role: 'use' });
});

it('CR4 the project semantic pages read a link\'s relation, a flow\'s steps and each step\'s link from their files', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const first = await written(world, 'kls2b-cr4-a', dataLink('kls2b-cr4-a'));
  const second = await written(world, 'kls2b-cr4-b', dataLink('kls2b-cr4-b'));
  const flow = await written(world, 'kls2b-cr4-flow', noteDraft({ kind: 'flow', topic: 'kls2b-cr4-flow',
    flow: { steps: [{ link: first }, { link: second }] } } as Partial<NoteDraftV1>));
  editNote(world, first, '"relation": "data"', '"relation": "message"');
  // The person swaps the flow's two steps.
  editNote(world, flow, `"link": "${first}"`, '"link": "kls2b-cr4-swap"');
  editNote(world, flow, `"link": "${second}"`, `"link": "${first}"`);
  editNote(world, flow, '"link": "kls2b-cr4-swap"', `"link": "${second}"`);
  const project = { scope: { kind: 'project' as const }, cursor: null, limit: 20 };
  const links = await world.platform.notes.readSemanticLinks(world.ctx(), project);
  const flows = await world.platform.notes.readSemanticFlows(world.ctx(), project);
  if (links.status !== 'ready' || flows.status !== 'ready') throw new Error(`CR4 reads: ${JSON.stringify({ links, flows })}`);
  expect({
    relation: links.value.items.find(item => item.noteId === first)?.relation,
    steps: flows.value.items.find(item => item.noteId === flow)?.steps.map(step => [step.link, step.item?.relation]),
  }).toEqual({ relation: 'message', steps: [[second, 'data'], [first, 'message']] });
});

it('CR4 a link a person turned into another kind in its file leaves the project link page, and as a flow step it is not current on the flow page and in the note read', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const first = await written(world, 'kls2b-cr4k-a', dataLink('kls2b-cr4k-a'));
  const second = await written(world, 'kls2b-cr4k-b', dataLink('kls2b-cr4k-b'));
  const flow = await written(world, 'kls2b-cr4k-flow', noteDraft({ kind: 'flow', topic: 'kls2b-cr4k-flow',
    flow: { steps: [{ link: first }, { link: second }] } } as Partial<NoteDraftV1>));
  const text = world.file(notePath(first))!;
  const lines = text.split('\n');
  const header: Record<string, unknown> = { ...headerOf(text), kind: 'decision' };
  delete header['link'];
  world.edit(notePath(first), ['--- knowledge-note@1', JSON.stringify(header, null, 2), ...lines.slice(lines.indexOf('---'))].join('\n'));
  const project = { scope: { kind: 'project' as const }, cursor: null, limit: 20 };
  const links = await world.platform.notes.readSemanticLinks(world.ctx(), project);
  const flows = await world.platform.notes.readSemanticFlows(world.ctx(), project);
  if (links.status !== 'ready' || flows.status !== 'ready') throw new Error(`CR4 reads: ${JSON.stringify({ links, flows })}`);
  const read = await world.platform.notes.readNote(world.ctx(), { noteId: flow });
  const notCurrent = { link: first, item: null, problem: 'not_current' };
  expect({ links: links.value.items.map(item => item.noteId),
    firstStep: flows.value.items.find(item => item.noteId === flow)?.steps[0],
    readStep: read.status === 'ready' ? read.value.flow?.steps[0] : read })
    .toEqual({ links: [second], firstStep: notCurrent, readStep: notCurrent });
});

it('CR9 a project semantic page reads only the files of its own notes: a bad file past the page does not fail it', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  // Two links on no common anchor, so reading one never reads the other's file for the check's own derivations.
  mkdirSync(join(world.root, 'src/ops'), { recursive: true });
  mkdirSync(join(world.root, 'src/empty'), { recursive: true });
  world.edit('src/ops/w.ts', 'export function w() { return "cr9.json"; }\n');
  world.edit('src/empty/r.ts', 'export function r() { return "cr9.json"; }\n');
  const opsLink = noteDraft({ kind: 'link', topic: 'kls2b-cr9-b', conclusion: 'ops 写 empty 读',
    anchor: { kind: 'module', moduleId: 'ops' }, extraAnchors: [{ kind: 'module', moduleId: 'empty' }],
    link: { relation: 'data', key: { kind: 'literal', text: 'cr9.json' },
      evidence: [{ role: 'emit', at: { path: 'src/ops/w.ts' } }, { role: 'receive', at: { path: 'src/empty/r.ts' } }] },
  } as Partial<NoteDraftV1>);
  const [first, second] = [await written(world, 'kls2b-cr9-a', dataLink('kls2b-cr9-a')),
    await written(world, 'kls2b-cr9-b', opsLink)].sort();
  world.edit(notePath(second!), 'not a note file');
  const page = await world.platform.notes.readSemanticLinks(world.ctx(), { scope: { kind: 'project' }, cursor: null, limit: 1 });
  expect(page.status === 'ready' ? page.value.items.map(item => item.noteId) : page).toEqual([first]);
});

it('CR5 a link file whose evidence role is not one of the seven roles is a bad file: reading the note is unavailable', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const noteId = await written(world, 'kls2b-cr5r', dataLink('kls2b-cr5r'));
  editNote(world, noteId, '"role": "emit"', '"role": "not-a-role"');
  expect(await world.platform.notes.readNote(world.ctx(), { noteId })).toMatchObject({ status: 'rejected', code: 'unavailable' });
});

it('CR9 a module semantic page reads only the files of its own notes: a bad file of the module past the page does not fail it', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  // Two links on files `core` owns, with no common anchor, so the page's own check never reads the other's file.
  mkdirSync(join(world.root, 'src/ops'), { recursive: true });
  world.edit('src/core/other.ts', 'export function other() { return "cr9m.json"; }\n');
  world.edit('src/ops/w.ts', 'export function w() { return "cr9m.json"; }\n');
  const fileLink = (topic: string, from: string, to: string, receive: string, key: string): NoteDraftV1 => noteDraft({
    kind: 'link', topic, conclusion: `${from} 写 ${to} 读`, anchor: { kind: 'file', path: from },
    extraAnchors: [{ kind: 'module', moduleId: to }], link: { relation: 'data', key: { kind: 'literal', text: key },
      evidence: [{ role: 'emit', at: { path: from } }, { role: 'receive', at: { path: receive } }] } } as Partial<NoteDraftV1>);
  const [first, second] = [
    await written(world, 'kls2b-cr9m-a', fileLink('kls2b-cr9m-a', 'src/core/service.ts', 'billing', 'src/billing/ledger.ts', 'ledger.json')),
    await written(world, 'kls2b-cr9m-b', fileLink('kls2b-cr9m-b', 'src/core/other.ts', 'ops', 'src/ops/w.ts', 'cr9m.json')),
  ].sort();
  world.edit(notePath(second!), 'not a note file');
  const page = await world.platform.notes.readSemanticLinks(world.ctx(),
    { scope: { kind: 'module', moduleId: 'core' }, cursor: null, limit: 1 });
  expect(page.status === 'ready' ? page.value.items.map(item => item.noteId) : page).toEqual([first]);
});

it('CR8 a link file whose relation is not one of the six relations is a bad file: reading the note is unavailable', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const noteId = await written(world, 'kls2b-cr8', dataLink('kls2b-cr8'));
  editNote(world, noteId, '"relation": "data"', '"relation": "not-a-relation"');
  expect(await world.platform.notes.readNote(world.ctx(), { noteId })).toMatchObject({ status: 'rejected', code: 'unavailable' });
});

describe.each(['memory', 'sqlite'] as const)('the index searches (%s)', storage => {
  it('B04 a note is found from each of its five anchors; a declared module no note names is an empty page', async () => {
    const world = await knowledgeWorld({ storage });
    await adoptCatalog(world);
    const anchors: NoteAnchorV1[] = [{ kind: 'module', moduleId: 'core' }, { kind: 'module', moduleId: 'billing' },
      { kind: 'file', path: 'src/x.ts' }, { kind: 'interface', moduleId: 'core', interfaceId: 'api' },
      { kind: 'module', moduleId: 'ops' }];
    const noteId = await written(world, 'kls2b-b04', noteDraft({ anchor: anchors[0]!, extraAnchors: anchors.slice(1) }));
    for (const anchor of anchors) expect(await idsByAnchor(world, anchor), JSON.stringify(anchor)).toContain(noteId);
    expect(await world.platform.notes.listByAnchor(world.ctx(),
      { anchor: { kind: 'module', moduleId: 'empty' }, limit: 20, cursor: null }))
      .toMatchObject({ status: 'ready', value: { items: [], complete: true } });
  });

  it('B05 the write and the find normalize the text the same way (NFC, ASCII lower case)', async () => {
    const world = await knowledgeWorld({ storage });
    await adoptCatalog(world);
    // The body's é is decomposed (e + U+0301); the term's is one code point.
    const noteId = await written(world, 'kls2b-b05', noteDraft({ body: 'CAFé 写入顺序' }));
    const ids = async (term: string) => (await found(world, { terms: [term], limit: 20, cursor: null })).items
      .map(item => item.noteId);
    expect(await ids('Café')).toContain(noteId);
    expect(await ids('cafe')).not.toContain(noteId);
  });

  it('B06 the find merges the knowledge and the work notes by note id, a bounded page at a time', async () => {
    // The Host's note id generator (A8): the three module notes get n1, n3, n4 and the goal note n2, so the first
    // page needs one hit from each source.
    const noteIds = ['b06-n1', 'b06-n3', 'b06-n4', 'b06-n2'];
    const world = await knowledgeWorld({ storage, platform: { noteNewId: () => noteIds.shift()! } });
    await adoptCatalog(world);
    for (const index of [1, 2, 3]) {
      await written(world, `kls2b-b06-${String(index)}`,
        noteDraft({ topic: `kls2b-b06-${String(index)}`, body: 'quiescent module' }));
    }
    await written(world, 'kls2b-b06-goal', noteDraft({ kind: 'pitfall', topic: 'kls2b-b06-goal',
      body: 'quiescent goal', anchor: { kind: 'goal', goalId: world.goalRef.goalId } }), world.goalRef.goalId);
    const request = { terms: ['quiescent'], match: 'all' as const, limit: 2 };
    const first = await found(world, { ...request, cursor: null });
    expect(first.items.map(item => item.noteId)).toEqual(['b06-n1', 'b06-n2']);
    expect(first.next).not.toBeNull();
    const second = await found(world, { ...request, cursor: first.next });
    expect(second.items.map(item => item.noteId)).toEqual(['b06-n3', 'b06-n4']);
    expect(second.complete).toBe(true);
  });

  it('B09 a link is found from the module it points to', async () => {
    const world = await knowledgeWorld({ storage });
    await adoptCatalog(world);
    const noteId = await written(world, 'kls2b-b09', dataLink('kls2b-b09'));
    expect((await linksOn(world, 'billing')).find(item => item.noteId === noteId)?.relation).toBe('data');
  });

  it('B11 a failed index step does not fail the write', async () => {
    const fault = faultOnceIndexFactory();
    const world = await knowledgeWorld({ storage, platform: { knowledgeIndexFactory: fault.factory } });
    await adoptCatalog(world);
    fault.arm();
    const first = await world.platform.notes.writeNote(world.ctx(), { commandId: 'kls2b-b11-1',
      note: noteDraft({ topic: '索引坏了也写' }), expectedPointerRevision: null, goalId: null });
    expect(first).toMatchObject({ status: 'accepted' });
    expect(fault.failed()).toBe(1);
    const noteId = noteIdOf(first);
    expect(world.file(notePath(noteId))).not.toBeNull();
    expect((await itemOf(world, { noteId })).topic).toBe('索引坏了也写');
    expect(await world.platform.notes.writeNote(world.ctx(), { commandId: 'kls2b-b11-2',
      note: noteDraft({ topic: '第二条' }), expectedPointerRevision: null, goalId: null }))
      .toMatchObject({ status: 'accepted' });
  });
});

it('B12 the current version is read from the file, a named version from its record', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const noteId = await written(world, 'kls2b-b12', noteDraft({ conclusion: '原来的' }));
  editNote(world, noteId, '"conclusion": "原来的"', '"conclusion": "改过的"');
  expect((await itemOf(world, { noteId })).conclusion).toBe('改过的');
  expect((await itemOf(world, { noteId, version: 1 })).conclusion).toBe('原来的');
});

it('B13 a knowledge note whose file is gone is unavailable, not absent', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const noteId = await written(world, 'kls2b-b13', noteDraft({}));
  rmSync(join(world.root, notePath(noteId)));
  const read = await world.platform.notes.readNote(world.ctx(), { noteId });
  expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect((read as { reason: string }).reason).toContain(noteId);
});

describe('B15 the candidate read points use the knowledge in the files', () => {
  it('① a similar-note hint compares the conclusion a person wrote into the file', async () => {
    const world = await knowledgeWorld();
    await adoptCatalog(world);
    const a = await written(world, 'kls2b-b15-a', noteDraft({ topic: 'A', conclusion: '甲乙丙丁' }));
    editNote(world, a, '"conclusion": "甲乙丙丁"', '"conclusion": "写入顺序先事件后文件"');
    const b = await written(world, 'kls2b-b15-b', noteDraft({ topic: 'B', conclusion: '写入顺序先事件后文件' }));
    // The write route's check: the same owner, asked for the similar notes.
    const checked = await world.platform.notes.checkNotes(world.ctx(), { items: [{ noteId: b, version: 1 }], withSimilar: true });
    if (checked.status !== 'ready') throw new Error(`the check is not ready: ${JSON.stringify(checked)}`);
    expect((checked.value[0]!.similar ?? []).map(similar => similar.noteId)).toContain(a);
  });

  it('② a scribe\'s managed scope reads the anchor a person moved in the replaced note\'s file', async () => {
    const f = await createS4ANoteScopeFixture('memory');
    closers.push(() => f.close());
    // A replaced note must share an anchor with its successor: A also names S's file.
    const a = noteIdOf(await f.write(f.workCtx(f.scribes.sa.runRef), noteDraft({ topic: 'kls2b-b15-a',
      anchor: { kind: 'file', path: 'src/a/x.ts' }, extraAnchors: [{ kind: 'file', path: 'src/a/one/x.ts' }] }), null));
    const s = noteIdOf(await f.write(f.workCtx(f.scribes.sa.runRef), noteDraft({ topic: 'kls2b-b15-s',
      anchor: { kind: 'file', path: 'src/a/one/x.ts' }, replaces: [a] }), null));
    expect(await f.review(f.scribes.sa1, s, 'review'))
      .toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope' });
    const file = join(f.root, `.workbench/notes/${f.scope.workspaceId}/${a}.md`);
    await writeFile(join(f.root, 'src/a/one/y.ts'), 'export const y = 1;\n');
    const text = readFileSync(file, 'utf8');
    const moved = text.replace('"path": "src/a/x.ts"', '"path": "src/a/one/y.ts"');
    expect(moved).not.toBe(text);
    await writeFile(file, moved);
    expect(await f.review(f.scribes.sa1, s, 'review')).toMatchObject({ status: 'done', state: 'reviewed' });
  });
});

it('B17 the subject takes its anchors from its file before its neighbours are picked', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  // A relation must share an anchor with its target, so S starts on core and ops; T contradicts it on ops, U on core.
  const s = await written(world, 'kls2b-b17-s', noteDraft({ topic: 'kls2b-b17-s',
    extraAnchors: [{ kind: 'module', moduleId: 'ops' }] }));
  const t = await written(world, 'kls2b-b17-t', noteDraft({ topic: 'kls2b-b17-t',
    anchor: { kind: 'module', moduleId: 'ops' }, contradicts: [s] }));
  const u = await written(world, 'kls2b-b17-u', noteDraft({ topic: 'kls2b-b17-u', contradicts: [s] }));
  // A person takes ops off S in its file.
  editNote(world, s, '  "extraAnchors": [\n    {\n      "kind": "module",\n      "moduleId": "ops"\n    }\n  ],',
    '  "extraAnchors": [],');
  const read = await world.platform.notes.memoryNeighbors(world.ctx(), { v: 1, op: 'neighbors', noteId: s, limit: 20, cursor: null });
  if (read.status !== 'ready') throw new Error(`the neighbours are not ready: ${JSON.stringify(read)}`);
  const ids = read.value.items.map(item => item.noteId);
  expect(ids).toContain(u);
  expect(ids).not.toContain(t);
});

it('B18 superseding a note keeps the knowledge a person edited into its file', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const a = await written(world, 'kls2b-b18-a', noteDraft({ topic: 'kls2b-b18', conclusion: '旧' }));
  editNote(world, a, '"conclusion": "旧"', '"conclusion": "人改的"');
  const b = await world.platform.notes.writeNote(world.ctx(), { commandId: 'kls2b-b18-b',
    note: noteDraft({ topic: 'kls2b-b18', conclusion: '新', replaces: [a] }), expectedPointerRevision: null, goalId: null });
  expect(b).toMatchObject({ status: 'accepted' });
  expect((await itemOf(world, { noteId: a })).storedState).toBe('superseded');
  expect(headerOf(world.file(notePath(a)))['conclusion']).toBe('人改的');
});

it('B19 (code review 3) a review card whose file a person pointed at another note shows that note; the queue stays '
  + 'ready', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  await world.claimExecutorRun();
  const goalId = world.goalRef.goalId;
  const a = await written(world, 'kls2b-b19-a', noteDraft({ topic: 'kls2b-b19-a', conclusion: '用户的 A' }), goalId);
  const b = await written(world, 'kls2b-b19-b', noteDraft({ topic: 'kls2b-b19-b', conclusion: '用户的 B' }), goalId);
  const p = await world.platform.notes.writeNote(world.ctx('work_run'), { commandId: 'kls2b-b19-p',
    note: noteDraft({ topic: 'kls2b-b19-p', conclusion: '相反的结论', contradicts: [a] }), expectedPointerRevision: null, goalId });
  expect(p).toMatchObject({ status: 'pending_review' });
  const pending = noteIdOf(p);
  // A person points the waiting note at B instead of A in its file.
  editNote(world, pending, `"contradicts": [\n    "${a}"\n  ]`, `"contradicts": [\n    "${b}"\n  ]`);
  const queue = await world.platform.decisions.queryDecisionQueue(world.ctx(), {
    workspace: { projectId: world.projectId, workspaceId: world.workspaceId }, sections: ['waiting_answer'], page: { limit: 100 } });
  if (queue.status !== 'ready') throw new Error(`the decision queue is not ready: ${JSON.stringify(queue)}`);
  const cards = queue.value.waitingAnswer.filter(card => card.source.kind === 'note_review');
  expect(cards.map(card => card.objects.map(object => object.kind === 'aggregate'
    ? (object.pin.ref as { noteId?: string }).noteId : null))).toEqual([[pending, b]]);
});

it('B13② a version read of a note whose file is gone is unavailable, not the stored version', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  const noteId = await written(world, 'kls2b-b13b', noteDraft({}));
  rmSync(join(world.root, notePath(noteId)));
  const read = await world.platform.notes.readNote(world.ctx(), { noteId, version: 1 });
  expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect((read as { reason: string }).reason).toContain(noteId);
});

it('B18② a relation is checked with the knowledge a person put in its note file', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  await world.claimExecutorRun();
  const a = await written(world, 'kls2b-b18b-a', noteDraft({ topic: 'kls2b-b18b-a', conclusion: '旧' }));
  editNote(world, a, '"moduleId": "core"', '"moduleId": "billing"');
  const b = await world.platform.notes.writeNote(world.ctx('work_run'), { commandId: 'kls2b-b18b-b',
    note: noteDraft({ topic: 'kls2b-b18b-b', conclusion: '新', replaces: [a] }), expectedPointerRevision: null, goalId: null });
  expect(b).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
});

it('B18③ accepting a pending replacement writes back the knowledge in the replaced note file', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  await world.claimExecutorRun();
  const a = await written(world, 'kls2b-b18c-a', noteDraft({ topic: 'kls2b-b18c', conclusion: '旧' }));
  editNote(world, a, '"conclusion": "旧"', '"conclusion": "人改的"');
  const b = await world.platform.notes.writeNote(world.ctx('work_run'), { commandId: 'kls2b-b18c-b',
    note: noteDraft({ topic: 'kls2b-b18c', conclusion: '新', replaces: [a] }), expectedPointerRevision: null, goalId: null });
  expect(b).toMatchObject({ status: 'pending_review' });
  const accepted = await world.platform.notes.reviewNote(world.ctx(), { commandId: 'kls2b-b18c-accept',
    noteId: noteIdOf(b), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '收下' });
  expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
  expect((await itemOf(world, { noteId: a })).storedState).toBe('superseded');
  expect(headerOf(world.file(notePath(a)))['conclusion']).toBe('人改的');
});

it('B13③ a waiting note that contradicts a current one is unavailable when its file is gone', async () => {
  const world = await knowledgeWorld();
  await adoptCatalog(world);
  await world.claimExecutorRun();
  const a = await written(world, 'kls2b-b13c-a', noteDraft({ topic: 'kls2b-b13c-a' }));
  const b = await world.platform.notes.writeNote(world.ctx('work_run'), { commandId: 'kls2b-b13c-b',
    note: noteDraft({ topic: 'kls2b-b13c-b', contradicts: [a] }), expectedPointerRevision: null, goalId: null });
  expect(b).toMatchObject({ status: 'pending_review' });
  const bId = noteIdOf(b);
  rmSync(join(world.root, notePath(bId)));
  const read = await world.platform.notes.readNote(world.ctx(), { noteId: bId });
  expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect((read as { reason: string }).reason).toContain(bId);
});
