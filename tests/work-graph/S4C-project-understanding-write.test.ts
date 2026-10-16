/**
 * Slice 4C-1 C3.1 (§11.4 write side, decision 67 item 3): the project current
 * understanding through the public `platform.notes` writer/reader. Expected
 * values are literal, hand-computed from PU-01, PU-02 (write half) and D-09.
 * The pointer CAS is observed through the writer's own rejection payload, so the
 * test stays on the write side (no database or record store reads).
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;
const PROJECT = { kind: 'project' } as const;

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion',
    anchor: FILE_A, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    ...overrides,
  } as NoteDraftV1;
}
function projectUnderstanding(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' };
  return { kind: 'understanding', topic: 'project-understanding', conclusion: 'current', anchor: PROJECT,
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [], sections, ...overrides } as NoteDraftV1;
}
async function withFixture<T>(kind: S4ANoteFixtureKind, options: { anchorQuota?: number; goalQuota?: number } = {},
  body: (fixture: S4ANoteFixture) => Promise<T>): Promise<T> {
  const fixture = await createS4ANoteFixture(kind, options);
  try { return await body(fixture); } finally { await fixture.close(); }
}
const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;
async function itemOf(f: S4ANoteFixture, noteId: string): Promise<{ storedState: string; goalId: string | null;
  anchor: NoteDraftAnchorV1; confirmedByUser: boolean; version: number }> {
  const read = await f.platform.notes.readNote(f.ctx(), { noteId });
  if (read.status !== 'ready') throw new Error(`note ${noteId} is not readable: ${JSON.stringify(read)}`);
  return read.value;
}
// The rendered five-section body, exactly as the writer renders it.
const rendered = (status: string): string => `现状\n${status}\n\n已定\nb\n\n未决\nc\n\n下一步\nd\n\n风险\ne`;
const FIXED_BODY_BYTES = Buffer.byteLength(rendered(''), 'utf8');
const sectionsOf = (status: string): NoteSectionsV1 => ({ status, decided: 'b', open: 'c', next: 'd', risks: 'e' });
const pointerPayloadOf = (result: { status: string }): { noteId: string | null; revision: number | null } | undefined =>
  (result as unknown as { pointer?: { noteId: string | null; revision: number | null } }).pointer;

describe('S4C PU-01: project understanding writers and shape', () => {
  it.each(KINDS)('PU-01 %s: the project scribe writes accepted and the user writes confirmed', async kind => {
    await withFixture(kind, {}, async f => {
      const scribe = f.workCtx(await f.claimRun('s4c-pu01-scribe', 't3', 'scribe'));
      const first = await f.write(scribe, projectUnderstanding({ topic: 'project-u' }), null,
        { expectedPointerRevision: null });
      expect(first).toMatchObject({ status: 'accepted', reasons: [], confirmedByUser: false });
      const firstItem = await itemOf(f, idOf(first));
      expect(firstItem.goalId).toBeNull();
      expect(firstItem.anchor).toEqual(PROJECT);

      // The pointer CAS still guards the second write and names the first note.
      const conflict = await f.write(scribe, projectUnderstanding({ topic: 'project-u2' }), null,
        { expectedPointerRevision: null });
      expect(conflict).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect(pointerPayloadOf(conflict)).toEqual({ noteId: idOf(first), revision: 1 });

      const user = await f.write(f.ctx(), projectUnderstanding({ topic: 'project-u3' }), null,
        { expectedPointerRevision: 1 });
      expect(user).toMatchObject({ status: 'accepted', confirmedByUser: true });
      expect((await itemOf(f, idOf(user))).goalId).toBeNull();
    });
  });

  it.each(KINDS)('PU-01 %s: an executor is refused project_understanding_scribe_only', async kind => {
    await withFixture(kind, {}, async f => {
      const executor = f.workCtx(await f.claimRun('s4c-pu01-exec'));
      const refused = await f.write(executor, projectUnderstanding({ topic: 'exec-u' }), null,
        { expectedPointerRevision: null });
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden',
        reason: 'project_understanding_scribe_only' });
    });
  });

  it.each(KINDS)('PU-01 %s: the body cap is 4,096 accepted and 4,097 refused, and extra anchors are refused', async kind => {
    await withFixture(kind, {}, async f => {
      const scribe = f.workCtx(await f.claimRun('s4c-pu01-body', 't3', 'scribe'));
      const ok = await f.write(scribe, projectUnderstanding({ topic: 'body-ok',
        sections: sectionsOf('a'.repeat(4096 - FIXED_BODY_BYTES)) }), null, { expectedPointerRevision: null });
      expect(ok.status).toBe('accepted');
      const bad = await f.write(scribe, projectUnderstanding({ topic: 'body-bad',
        sections: sectionsOf('a'.repeat(4097 - FIXED_BODY_BYTES)) }), null, { expectedPointerRevision: 1 });
      expect(bad).toMatchObject({ status: 'rejected', code: 'invalid' });
      const extra = await f.write(scribe, projectUnderstanding({ topic: 'extra',
        extraAnchors: [{ kind: 'module', moduleId: 'A' }] }), null, { expectedPointerRevision: 1 });
      expect(extra).toMatchObject({ status: 'rejected', code: 'invalid',
        reason: 'project_understanding_extra_anchors' });
    });
  });

  it.each(KINDS)('PU-01 %s: N-02 still refuses a task anchor for an understanding', async kind => {
    await withFixture(kind, {}, async f => {
      const taskAnchor: NoteDraftAnchorV1 = { kind: 'task', goalId: 's4a-goal', taskId: 't1' };
      const result = await f.write(f.ctx(), projectUnderstanding({ topic: 'task-u', anchor: taskAnchor }), null,
        { expectedPointerRevision: null });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    });
  });
});

describe('S4C PU-02 (write half) and D-09', () => {
  it.each(KINDS)('PU-02 %s: a project understanding takes no goal quota', async kind => {
    await withFixture(kind, { goalQuota: 1 }, async f => {
      // Fill the goal with one agent note first.
      const executor = f.workCtx(await f.claimRun('s4c-pu02-exec'));
      const goalNote = await f.write(executor, general({ topic: 'goal-note', anchor: FILE_A }), 's4a-goal');
      expect(goalNote.status).toBe('accepted');
      const scribe = f.workCtx(await f.claimRun('s4c-pu02-scribe', 't3', 'scribe'));
      const wrote = await f.write(scribe, projectUnderstanding({ topic: 'project-u' }), null,
        { expectedPointerRevision: null });
      expect(wrote).toMatchObject({ status: 'accepted', reasons: [], overQuota: false });
      const item = await itemOf(f, idOf(wrote));
      expect(item.goalId).toBeNull();
      expect(item.storedState).toBe('accepted');
    });
  });

  it.each(KINDS)('D-09 %s: a goal-less pending understanding stays pending and does not move the pointer', async kind => {
    await withFixture(kind, {}, async f => {
      const scribe = f.workCtx(await f.claimRun('s4c-d09-scribe', 't3', 'scribe'));
      const pending = await f.write(scribe,
        projectUnderstanding({ topic: 'project-structural', structural: true }), null,
        { expectedPointerRevision: null });
      expect(pending).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
      const item = await itemOf(f, idOf(pending));
      expect(item.goalId).toBeNull();
      expect(item.storedState).toBe('pending_review');
      // The pending note did not move the project pointer, so a fresh write with
      // `expectedPointerRevision: null` still succeeds.
      const after = await f.write(f.ctx(), projectUnderstanding({ topic: 'after-pending' }), null,
        { expectedPointerRevision: null });
      expect(after.status).toBe('accepted');
    });
  });
});
