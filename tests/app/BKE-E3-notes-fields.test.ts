/**
 * BK-E3 (notes list fields): the row's `lastChange`, `notes/list` with a body, the row's `basisFiles`, and the
 * `notes/read` route. Every state comes from the public notes routes of a real Host: `notes/write`,
 * `notes/withdraw`, `notes/list` and `notes/read`, over real workspace files and the
 * Host's frozen clock. Nothing here reads a record store or writes a record by hand.
 *
 * E3-01…E3-05 are green after the first round of production. The three rows added by the second round are red on
 * the behaviours R-N3/R-N4 and the new HTTP inputs still owe: a filed note's new basis path has no digest and is
 * dropped from the row, `notes/read` attaches a body from another note or the head version, and a `body: null`
 * request throws. Every read is a public route or the platform's public knowledge reconcile; no record is read or
 * written by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { NoteDraftV1, NoteSourceV1 } from '../../src/contracts/note.js';
import type { NoteItemV1, NoteReadRequestV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { fileNoteWithoutRecord } from '../helpers/KLS2-knowledge-lines.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_AT, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

type ListAnswer = { status: 'ready'; value: { items: NoteItemV1[] } }
  | { status: 'rejected'; code: string; reason: string };
type WriteAnswer = { write: { status: string; noteId?: string; version?: number } };
type DispositionAnswer = { status: string; noteId?: string; version?: number };
type ReadNoteAnswer = ReadResult<NoteItemV1>;

const MODULE_CORE = { kind: 'module', moduleId: 's6a-core' } as const;
const OPERATOR_SOURCE: NoteSourceV1 = { kind: 'user', principalId: 's6a-operator' };

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/** `openS6AHostWorld` + the project's two pointers (the governance's public reads and writes). */
async function openNotesWorld(backend: 'memory' | 'sqlite'): Promise<S6AHostWorld> {
  const world = await openS6AHostWorld({ backend });
  worlds.push(world);
  world.clock.set(S6A_AT);
  await ensureProjectPointers(world);
  return world;
}

/** One general note draft; the E3 rows override the anchor/basis/relations they need. */
function draft(overrides: Partial<NoteDraftV1> & { topic: string }): NoteDraftV1 {
  return { kind: 'decision', conclusion: `${overrides.topic} 结论`, body: `${overrides.topic} 正文`,
    anchor: MODULE_CORE, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

/** A person's `notes/write`; throws on anything but an accepted write so a broken setup names itself. */
async function writeNote(world: S6AHostWorld, commandId: string, note: NoteDraftV1):
Promise<{ noteId: string; version: number }> {
  const answer = (await world.post('notes/write', plain(S6A_SCOPE, {
    commandId, note, expectedPointerRevision: null, goalId: null }))).body as WriteAnswer;
  const write = answer.write;
  if (write.status !== 'accepted' || write.noteId === undefined || write.version === undefined) {
    throw new Error(`BKE-E3: notes/write ${commandId} was not accepted: ${JSON.stringify(answer)}`);
  }
  return { noteId: write.noteId, version: write.version };
}

/** `notes/list` by one anchor; `state` is the request union's explicit state override (e.g. `withdrawn`). */
async function listRows(world: S6AHostWorld, anchor: NoteDraftV1['anchor'], extra: {
  state?: 'withdrawn'; body?: { noteId: string; version?: number; cursor: string | null };
} = {}): Promise<NoteItemV1[]> {
  const answer = (await world.post('notes/list', plain(S6A_SCOPE, {
    anchor, limit: 100, cursor: null,
    ...(extra.state === undefined ? {} : { state: extra.state }),
    ...(extra.body === undefined ? {} : { body: extra.body }),
  }))).body as ListAnswer;
  if (answer.status !== 'ready') {
    throw new Error(`BKE-E3: notes/list was not ready: ${JSON.stringify(answer)}`);
  }
  return answer.value.items;
}

async function noteRowOf(world: S6AHostWorld, anchor: NoteDraftV1['anchor'], noteId: string,
  extra: { state?: 'withdrawn'; body?: { noteId: string; version?: number; cursor: string | null } } = {}):
Promise<NoteItemV1> {
  const row = (await listRows(world, anchor, extra)).find(item => item.noteId === noteId);
  if (row === undefined) throw new Error(`BKE-E3: notes/list has no ${noteId}`);
  return row;
}

describe('BK-E3 notes list fields', () => {
  it('E3-01 the row\'s lastChange is the write that made the current version', async () => {
    // Green after the first round: the row takes the current version's `change`/`at` (R-N1, row E3-01).
    // Named mutation: take `at` from the head's `since` cursor instead of the version's `at` (or answer
    // `lastChange` only with a version number): this row goes red.
    const world = await openNotesWorld('memory');
    world.clock.set(S6A_AT);
    const written = await writeNote(world, 'bke-e3-01-write', draft({ topic: 'bke-e3-01' }));

    const row = await noteRowOf(world, MODULE_CORE, written.noteId);
    expect(row.lastChange).toEqual({ kind: 'write', by: OPERATOR_SOURCE, reason: null, at: S6A_AT });
  }, 300_000);

  it('E3-02 after a withdraw the row\'s lastChange is that withdraw, with its reason and time', async () => {
    // Green after the first round: the current (second) version is the withdraw, so `kind`/`reason`/`at` come from
    // it (R-N1, row E3-02). Named mutation: read `versions[0]` (the first version) instead of the current head:
    // `kind` stays `write` and this row goes red.
    const world = await openNotesWorld('memory');
    world.clock.set(S6A_AT);
    const written = await writeNote(world, 'bke-e3-02-write', draft({ topic: 'bke-e3-02' }));

    const withdrawAt = '2026-10-23T09:05:00.000Z';
    const reason = 'E3-02：这条注记撤下的原文理由';
    world.clock.set(withdrawAt);
    const withdrawn = (await world.post('notes/withdraw', plain(S6A_SCOPE, {
      commandId: 'bke-e3-02-withdraw', noteId: written.noteId, expectedVersion: written.version,
      reason,
    }))).body as DispositionAnswer;
    expect(withdrawn.status).toBe('done');

    const row = await noteRowOf(world, MODULE_CORE, written.noteId, { state: 'withdrawn' });
    expect(row.lastChange).toEqual({ kind: 'withdraw', by: OPERATOR_SOURCE, reason, at: withdrawAt });
  }, 300_000);

  it('E3-03 notes/list carries the note body only when the request asks for it', async () => {
    // Green after the first round: the first branch passes `body` to the lookup's paged read, and the read
    // without `body` stays as it is (R-N2, row E3-03). Named mutation: delete the `body` member from
    // `listNotes`' lookup request: the with-body read loses `body` and this row goes red (the without-body
    // read still passes).
    const world = await openNotesWorld('sqlite');
    const body = 'e3-03-body '.repeat(200); // 2,400 ASCII bytes > the 2,048-byte page
    const written = await writeNote(world, 'bke-e3-03-write', draft({ topic: 'bke-e3-03', body }));

    const withBody = await noteRowOf(world, MODULE_CORE, written.noteId,
      { body: { noteId: written.noteId, cursor: null } });
    expect(withBody.body?.text).toBe(body.slice(0, 2048));
    expect(typeof withBody.body?.next).toBe('string');

    await world.reopen();

    const reread = await noteRowOf(world, MODULE_CORE, written.noteId,
      { body: { noteId: written.noteId, cursor: null } });
    expect(reread.body?.text).toBe(body.slice(0, 2048));
    expect(typeof reread.body?.next).toBe('string');
    expect(await noteRowOf(world, MODULE_CORE, written.noteId)).not.toHaveProperty('body');
  }, 300_000);

  it('E3-04 the row\'s basisFiles are the written basis, not every observed file', async () => {
    // Green after the first round: the row carries `head.basis.files.map(f => f.path)`, so `observedFiles`
    // alone cannot stand in for the basis (R-N3, row E3-04). Named mutation: `basisFiles:
    // observedFiles.map(f => f.path)` (or the first N observed paths): the second, extra-anchored file appears
    // and this row goes red.
    const world = await openNotesWorld('memory');
    await writeFile(join(world.root, 'src/second.ts'), 'export const second = 2;\n');
    const written = await writeNote(world, 'bke-e3-04-write', draft({
      topic: 'bke-e3-04',
      anchor: { kind: 'file', path: 'src/module.ts' },
      extraAnchors: [{ kind: 'file', path: 'src/second.ts' }],
      basisFiles: ['src/module.ts'],
    }));

    const row = await noteRowOf(world, { kind: 'file', path: 'src/module.ts' }, written.noteId);
    expect(row.basisFiles).toEqual(['src/module.ts']);
    expect(row.observedFiles.map(file => file.path)).toEqual(
      expect.arrayContaining(['src/module.ts', 'src/second.ts']));
  }, 300_000);

  it('E3-05 notes/read answers the other note by id, with the contradiction it names', async () => {
    // Green after the first round: `notes/read` is published and reads by `noteId`, and the row carries the stored
    // `contradicts` across the SQLite reopen (R-N4, row E3-05). Named mutation: take the route parameter as
    // `anchor` instead of `noteId` (the row's input has no anchor): the read is not ready and this row goes red.
    const world = await openNotesWorld('sqlite');
    // The pair shares one file slot through their extra anchors, but their primary anchors differ, so no single
    // anchor lists the other: the read by id is what finds it. The first write cannot name the second (its id
    // does not exist yet), so the later write carries the contradiction that names the first.
    const first = await writeNote(world, 'bke-e3-05-first', draft({
      topic: 'bke-e3-05-first',
      anchor: { kind: 'project' },
      extraAnchors: [{ kind: 'file', path: 'src/module.ts' }],
    }));
    const second = await writeNote(world, 'bke-e3-05-second', draft({
      topic: 'bke-e3-05-second',
      anchor: MODULE_CORE,
      extraAnchors: [{ kind: 'file', path: 'src/module.ts' }],
      contradicts: [first.noteId],
    }));

    await world.reopen();

    const input: NoteReadRequestV1 = { noteId: second.noteId };
    const read = (await world.post('notes/read', plain(S6A_SCOPE, input))).body as ReadNoteAnswer;
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value.noteId).toBe(second.noteId);
    expect(read.value.contradicts).toContain(first.noteId);
  }, 300_000);

  it('E3-06 a basis path added to a filed note\'s file is on its notes/list row (R-N3)', async () => {
    // Today green: the path a person adds to the note file is on the row (R-N3, row E3-04's field), so
    // `overlaidHead` (note-knowledge.ts:123-135) no longer drops a basis path the record has no digest for.
    // Named mutation: the row takes only the digest-backed subset: the new path is missing and this row goes red.
    // Not executed.
    const world = await openNotesWorld('memory');
    await writeFile(join(world.root, 'src/basis.ts'), 'export const basis = 1;\n');
    await writeFile(join(world.root, 'src/added-basis.ts'), 'export const added = 2;\n');
    const written = await writeNote(world, 'bke-e3-06-write', draft({
      topic: 'bke-e3-06', anchor: { kind: 'file', path: 'src/module.ts' }, basisFiles: ['src/basis.ts'],
    }));

    // The KLS2B edit of a note file: parse the JSON header, change one field, write the file back.
    const notePath = join(world.root, `.workbench/notes/${S6A_SCOPE.workspaceId}/${written.noteId}.md`);
    const text = readFileSync(notePath, 'utf8');
    const lines = text.split('\n');
    const header = JSON.parse(lines.slice(1, lines.indexOf('---')).join('\n')) as { basisFiles: string[] };
    header.basisFiles = [...header.basisFiles, 'src/added-basis.ts'];
    writeFileSync(notePath,
      [lines[0], JSON.stringify(header, null, 2), ...lines.slice(lines.indexOf('---'))].join('\n'));

    const row = await noteRowOf(world, { kind: 'file', path: 'src/module.ts' }, written.noteId);
    expect(row.basisFiles).toContain('src/added-basis.ts');
  }, 300_000);

  const V1 = 'bke-e3-07 version one body';
  const V2 = 'bke-e3-07 version two body';
  const HEADLESS_BODY = 'bke-e3-07 headless body';
  type ReadIds = { first: string; second: string; headless: string };
  const readCases: [string, (ids: ReadIds) => NoteReadRequestV1,
    'v1' | 'invalid' | 'headless' | 'cursor_mismatch'][] = [
    ['inherits the outer version when the body names none', ids => (
      { noteId: ids.first, version: 1, body: { noteId: ids.first, cursor: null } }), 'v1'],
    ['refuses a body version different from the outer one', ids => (
      { noteId: ids.first, version: 1, body: { noteId: ids.first, version: 2, cursor: null } }), 'invalid'],
    ['refuses a body that names another note', ids => (
      { noteId: ids.first, body: { noteId: ids.second, cursor: null } }), 'invalid'],
    // Today RED: expected { status: 'rejected', code: 'invalid' } for outer version 99 whose body names the other
    // note; actual { status: 'not_found' } because the outer version is read before the two layers are compared —
    // 施工方生产返工今天不在这棵树上. Named mutation: compare the body target only after the outer version read
    // (as today): this entry goes red. Not executed.
    ['refuses a body that names another note when the outer version does not exist', ids => (
      { noteId: ids.first, version: 99, body: { noteId: ids.second, version: 1 } }), 'invalid'],
    ['reads the body of a note that is only a file', ids => (
      { noteId: ids.headless, body: { noteId: ids.headless, cursor: null } }), 'headless'],
    // Today RED: expected { status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' } for the string cursor
    // "null" on a file-only note; actual HTTP 500 { status: 'rejected', code: 'unavailable' } because `JSON.parse`
    // yields null and the next member access throws — 施工方生产返工今天不在这棵树上. Named mutation: index the
    // parsed cursor without first checking it is an object (as today): this entry goes red. Not executed.
    ['refuses a string "null" body cursor on a file-only note', ids => (
      { noteId: ids.headless, body: { noteId: ids.headless, cursor: 'null' } }), 'cursor_mismatch'],
  ];

  it.each(readCases)('E3-07 notes/read %s (R-N4)', async (_label, requestOf, expectation) => {
    // Today green for the original four variants: the body target is compared with the outer request, and a
    // file-only note's body pages from its file (R-N4, row E3-05's route). Today red only for the two new variants
    // above (outer version 99 naming another note; the string "null" cursor), whose production rework is not in
    // this tree. Named mutation: leave the body read on `body.noteId`/`body.version` without the outer comparison:
    // the first three variants go red. Not executed.
    const world = await openNotesWorld('memory');
    const first = await writeNote(world, 'bke-e3-07-first', draft({
      topic: 'bke-e3-07', body: V1, anchor: { kind: 'file', path: 'src/module.ts' },
    }));
    const notePath = join(world.root, `.workbench/notes/${S6A_SCOPE.workspaceId}/${first.noteId}.md`);
    const text = readFileSync(notePath, 'utf8');
    const edited = text.replace(V1, V2);
    expect(edited).not.toBe(text);
    writeFileSync(notePath, edited);
    // The second `notes/write` supersedes the first and writes its head from the edited file, so the first note's
    // version 2 carries V2 while version 1 keeps V1.
    const second = await writeNote(world, 'bke-e3-07-replacement', draft({
      topic: 'bke-e3-07-replacement', body: 'bke-e3-07 replacement body',
      anchor: { kind: 'file', path: 'src/module.ts' }, replaces: [first.noteId],
    }));
    const headless = 'bke-e3-07-headless';
    expect(await fileNoteWithoutRecord({ root: world.root, caller: world.humanContext(),
      workspaceId: S6A_SCOPE.workspaceId, knowledge: world.platform.knowledge, noteId: headless,
      note: { kind: 'decision', source: OPERATOR_SOURCE, topic: 'bke-e3-07-headless',
        conclusion: 'bke-e3-07 headless conclusion', body: HEADLESS_BODY,
        anchor: { kind: 'file', path: 'src/module.ts' }, extraAnchors: [], structural: false, facts: [],
        basisFiles: [], replaces: [], contradicts: [], coexistWith: [] } }))
      .toMatchObject({ status: 'ready', value: { issues: [] } });

    const answer = (await world.post('notes/read', plain(S6A_SCOPE,
      requestOf({ first: first.noteId, second: second.noteId, headless })))).body as ReadNoteAnswer;
    if (expectation === 'invalid') {
      expect(answer).toMatchObject({ status: 'rejected', code: 'invalid' });
      return;
    }
    if (expectation === 'cursor_mismatch') {
      expect(answer).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });
      return;
    }
    expect(answer.status).toBe('ready');
    if (answer.status !== 'ready') return;
    expect(answer.value.body?.text).toBe(expectation === 'v1' ? V1 : HEADLESS_BODY);
    expect(answer.value.version).toBe(expectation === 'v1' ? 1 : null);
  }, 300_000);

  it.each([
    ['notes/read', 'read'],
    ['notes/list', 'list'],
  ] as const)('E3-08 %s refuses a null body as invalid, not an HTTP 500', async (route, kind) => {
    // R-P1 (E3): a `body` that is not a note target is refused as `invalid`, never thrown into an HTTP 500.
    // Named mutation: drop `noteBodyProblem` from `parseCoreRouteRequest`: both rows go red at the 500.
    const world = await openNotesWorld('memory');
    const written = await writeNote(world, 'bke-e3-08-write', draft({ topic: 'bke-e3-08' }));
    const input = kind === 'read'
      ? { noteId: written.noteId, body: null }
      : { anchor: MODULE_CORE, limit: 100, cursor: null, body: null };
    const answer = await world.post(route, plain(S6A_SCOPE, input));
    // The body is a request-shape check in `parseCoreRouteRequest`, whose `invalid` the server answers as 400.
    expect(answer.httpStatus).toBe(400);
    expect(answer.body).toMatchObject({ status: 'rejected', code: 'invalid' });
  }, 300_000);
});
