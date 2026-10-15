/**
 * Slice 4A W2 (NE1): rows N-11…N-19 reached through `platform.notes` on both
 * backends, except the two storage-boundary interleaved-commit doubles of
 * N-07/N-14 which live in `S4A-note-concurrency.test.ts`. Expected values are
 * literal, hand-computed from spec §4/§5.2; the database is never read to
 * answer an assertion.
 */
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1, SymbolLocatorV1 } from '../../src/contracts/note.js';
import { renderNoteHeader } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';
import { createS4ANoteScopeFixture, type S4ANoteScopeFixture } from '../helpers/S4A-note-scope-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;
const FILE_B = { kind: 'file', path: 'src/b/y.ts' } as const;

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion',
    anchor: FILE_A, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body',
    ...overrides,
  } as NoteDraftV1;
}

function understanding(anchor: NoteDraftAnchorV1, overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: 'a', decided: 'b', open: 'c', next: 'd', risks: 'e' };
  return { kind: 'understanding', topic: 'understanding', conclusion: 'current', anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], sections,
    ...overrides } as NoteDraftV1;
}

async function withFixture<T>(kind: S4ANoteFixtureKind, options: { anchorQuota?: number; goalQuota?: number } = {},
  body: (fixture: S4ANoteFixture) => Promise<T>): Promise<T> {
  const fixture = await createS4ANoteFixture(kind, options);
  try { return await body(fixture); } finally { await fixture.close(); }
}
const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

/** Item 5 (2): a second real host human over the same fixture project. */
function hostAs(f: S4ANoteFixture, id: string): CoreCallContext {
  const base = f.ctx();
  const actor = { kind: 'human' as const, id };
  return { ...base, principal: { kind: 'host', actor },
    materialReader: { ...(base.materialReader as { kind: 'host'; projectId: string; workspaceId?: string }), actor } };
}

/** The N-20 setup (a real cancelled task `t2` of the agent's own goal). */
async function withScopeFixture<T>(kind: S4ANoteFixtureKind, body: (f: S4ANoteScopeFixture) => Promise<T>): Promise<T> {
  const fixture = await createS4ANoteScopeFixture(kind);
  try { return await body(fixture); } finally { await fixture.close(); }
}

describe('S4A N-12 replay', () => {
  it.each(KINDS)('N-12 %s replays the original write receipt after a later disposition', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const commandId = 's4a-n12-write';
      const first = await f.write(ctx, general({ topic: 'replay topic' }), null, { commandId });
      if (first.status === 'rejected') throw Error('unreachable');
      const noteId = first.noteId;
      const scribe = await f.claimRun('n12-scribe', 't3', 'scribe');
      const review = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-n12-review', noteId,
        expectedVersion: first.version, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(review).toMatchObject({ status: 'done', state: 'reviewed' });
      const replay = await f.write(ctx, general({ topic: 'replay topic' }), null, { commandId });
      expect(replay).toEqual(first);
      // the replay wrote no new version: version 2 is the review, version 3 is absent
      expect((await f.platform.notes.readNote(ctx, { noteId, version: 2 })).status).toBe('ready');
      expect((await f.platform.notes.readNote(ctx, { noteId, version: 3 })).status).toBe('not_found');
    });
  });

  it.each(KINDS)('N-12 %s a write replay returns the original result verbatim', async kind => {
    await withFixture(kind, { anchorQuota: 2 }, async f => {
      const ctx = f.ctx();
      const moduleA = { kind: 'module', moduleId: 'A' } as const;
      await f.write(ctx, general({ topic: 'a', anchor: moduleA }), null, { commandId: 'n12-a' });
      await f.write(ctx, general({ topic: 'b', anchor: moduleA }), null, { commandId: 'n12-b' });
      const first = await f.write(ctx, general({ topic: 'c', anchor: moduleA }), null, { commandId: 'n12-c' });
      if (first.status === 'rejected') throw Error('unreachable');
      expect(first).toEqual({ status: 'accepted', noteId: first.noteId, version: 1, reasons: [], overQuota: true,
        confirmedByUser: true, warnings: [], existingTopics: [
          { anchorKey: 'module:A', topic: 'a', count: 1 },
          { anchorKey: 'module:A', topic: 'b', count: 1 },
        ] });
      // A later write must neither change the original answer nor leak its topic.
      await f.write(ctx, general({ topic: 'd', anchor: moduleA }), null, { commandId: 'n12-d' });
      const replay = await f.write(ctx, general({ topic: 'c', anchor: moduleA }), null, { commandId: 'n12-c' });
      expect(replay).toEqual(first);
      expect((await f.platform.notes.readNote(ctx, { noteId: first.noteId, version: 2 })).status).toBe('not_found');
    });

    // Second case (the N-20 setup): the stored `anchor_ended` warning replays too.
    await withScopeFixture(kind, async f => {
      const work = f.workCtx(f.scribes.executor.runRef);
      const draft = general({ topic: 'n12-ended', anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't2' } });
      const first = await f.write(work, draft, 's4a-goal', { commandId: 'n12-ended' });
      if (first.status === 'rejected') throw Error('unreachable');
      expect(first).toMatchObject({ status: 'accepted', warnings: ['anchor_ended'] });
      const replay = await f.write(work, draft, 's4a-goal', { commandId: 'n12-ended' });
      expect(replay).toEqual(first);
    });
  });

  it.each(KINDS)('N-12 %s the same commandId from another caller is a new command', async kind => {
    await withFixture(kind, {}, async f => {
      const moduleA = { kind: 'module', moduleId: 'A' } as const;
      const u1 = hostAs(f, 'u1');
      const u2 = hostAs(f, 'u2');
      const draft = general({ topic: 'n12-x', conclusion: 'the shared conclusion', anchor: moduleA });
      const written = await f.write(u1, draft, null, { commandId: 'n12-x' });
      if (written.status === 'rejected') throw Error('unreachable');
      const n1 = written.noteId;
      const conflicting = await f.write(u2, draft, null, { commandId: 'n12-x' });
      expect(conflicting).toEqual({ status: 'rejected', code: 'invalid', reason: 'same_topic_unresolved',
        conflicts: [{ noteId: n1, version: 1, conclusion: 'the shared conclusion' }],
        draft: { commandId: 'n12-x', note: draft, expectedPointerRevision: null, goalId: null } });
      const page = await f.platform.notes.listByAnchor(u1, { anchor: moduleA, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toHaveLength(1);
      expect(page.value.items[0]!.noteId).toBe(n1);
      expect(page.value.items[0]!.source).toEqual({ kind: 'user', principalId: 'u1' });
      const other = await f.write(u2, general({ topic: 'n12-y', anchor: moduleA }), null, { commandId: 'n12-y' });
      if (other.status === 'rejected') throw Error('unreachable');
      expect(other.status).toBe('accepted');
      expect(other.noteId).not.toBe(n1);
    });
  });

  it.each(KINDS)('N-12 %s a disposition replay returns its original receipt', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const written = await f.write(ctx, general({ topic: 'n12 disposition' }), null, { commandId: 'n12-dw' });
      if (written.status === 'rejected') throw Error('unreachable');
      const noteId = written.noteId;
      const scribe = await f.claimRun('n12-disposition', 't3', 'scribe');
      const reviewed = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 'n12-r', noteId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(reviewed).toMatchObject({ status: 'done', noteId, version: 2, state: 'reviewed' });
      const replayReview = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 'n12-r', noteId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(replayReview).toEqual(reviewed);
      const withdrawn = await f.platform.notes.withdrawNote(ctx, { commandId: 'n12-w', noteId, expectedVersion: 2,
        reason: 'n12 withdraw' });
      expect(withdrawn).toMatchObject({ status: 'done', noteId, version: 3, state: 'withdrawn' });
      const replayReviewed = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 'n12-r', noteId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(replayReviewed).toEqual(reviewed);
      const replayWithdrawn = await f.platform.notes.withdrawNote(ctx, { commandId: 'n12-w', noteId, expectedVersion: 2,
        reason: 'n12 withdraw' });
      expect(replayWithdrawn).toEqual(withdrawn);
      expect((await f.platform.notes.readNote(ctx, { noteId, version: 4 })).status).toBe('not_found');
    });
  });

  it.each(KINDS)('N-12 %s the same commandId with a different note is an idempotency conflict', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      expect((await f.write(ctx, general({ topic: 'n12-conflict-a' }), null, { commandId: 'n12-conflict' })).status)
        .toBe('accepted');
      const second = await f.write(ctx, general({ topic: 'n12-conflict-b' }), null, { commandId: 'n12-conflict' });
      expect(second).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'idempotency_conflict' });
      expect((second as unknown as { noteId?: unknown }).noteId).toBeUndefined();
    });
  });
});

describe('S4A N-11 history', () => {
  it.each(KINDS)('N-11 %s reads three immutable versions of a written, reviewed, withdrawn note', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const written = await f.write(ctx, general({ topic: 'history', conclusion: 'first conclusion' }), null);
      if (written.status === 'rejected') throw Error('unreachable');
      const noteId = written.noteId;
      const scribe = await f.claimRun('n11-scribe', 't3', 'scribe');
      const reviewed = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-n11-review', noteId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(reviewed).toMatchObject({ status: 'done', state: 'reviewed' });
      const withdrawn = await f.platform.notes.withdrawNote(ctx, { commandId: 's4a-n11-withdraw', noteId,
        expectedVersion: 2, reason: 'no longer true' });
      expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn' });
      const v1 = await f.platform.notes.readNote(ctx, { noteId, version: 1 });
      const v2 = await f.platform.notes.readNote(ctx, { noteId, version: 2 });
      const v3 = await f.platform.notes.readNote(ctx, { noteId, version: 3 });
      if (v1.status !== 'ready' || v2.status !== 'ready' || v3.status !== 'ready') throw Error('unreachable');
      expect([v1.value.storedState, v2.value.storedState, v3.value.storedState])
        .toEqual(['accepted', 'reviewed', 'withdrawn']);
      expect([v1.value.conclusion, v2.value.conclusion, v3.value.conclusion])
        .toEqual(['first conclusion', 'first conclusion', 'first conclusion']);
    });
  });

  it.each(KINDS)('N-11 %s a later text change bumps the head but leaves the old version unchanged', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const older = await f.write(ctx, general({ topic: 'immutable', conclusion: 'original text' }), null);
      if (older.status === 'rejected') throw Error('unreachable');
      const olderId = older.noteId;
      const newer = await f.write(ctx, general({ topic: 'immutable', conclusion: 'changed text',
        replaces: [olderId] }), null);
      expect(newer.status).toBe('accepted');
      const head = await f.platform.notes.readNote(ctx, { noteId: olderId });
      const oldVersion = await f.platform.notes.readNote(ctx, { noteId: olderId, version: 1 });
      if (head.status !== 'ready' || oldVersion.status !== 'ready') throw Error('unreachable');
      expect(head.value.storedState).toBe('superseded');
      expect(head.value.version).toBe(2);
      expect(oldVersion.value.storedState).toBe('accepted');
      expect(oldVersion.value.conclusion).toBe('original text');
    });
  });

  it.each(KINDS)('N-11 %s historical versions carry confirmedByUser derived from change.by', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      // v1: an agent writes it (change.by.kind 'agent') -> not confirmed.
      const run = await f.claimRun('n11-confirmed');
      const written = await f.write(f.workCtx(run), general({ topic: 'confirmed' }), 's4a-goal');
      if (written.status === 'rejected') throw Error('unreachable');
      const noteId = written.noteId;
      // v2: the user reviews it (change.kind 'review', change.by.kind 'user') -> confirmed.
      const reviewed = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-n11-confirm-review', noteId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(reviewed).toMatchObject({ status: 'done', state: 'reviewed' });
      // v3: the user withdraws it -> confirmation carries forward.
      const withdrawn = await f.platform.notes.withdrawNote(ctx, { commandId: 's4a-n11-confirm-withdraw', noteId,
        expectedVersion: 2, reason: 'done' });
      expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn' });
      const v1 = await f.platform.notes.readNote(ctx, { noteId, version: 1 });
      const v2 = await f.platform.notes.readNote(ctx, { noteId, version: 2 });
      const v3 = await f.platform.notes.readNote(ctx, { noteId, version: 3 });
      const head = await f.platform.notes.readNote(ctx, { noteId });
      if (v1.status !== 'ready' || v2.status !== 'ready' || v3.status !== 'ready' || head.status !== 'ready') {
        throw Error('unreachable');
      }
      expect([v1.value.confirmedByUser, v2.value.confirmedByUser, v3.value.confirmedByUser, head.value.confirmedByUser])
        .toEqual([false, true, true, true]);
    });
  });
});

describe('S4A N-13 repair', () => {
  it.each(KINDS)('N-13 %s an agent repair is staged, withdrawable and not acceptable in 4A', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const run = await f.claimRun('n13');
      const repair = await f.write(f.workCtx(run), general({ kind: 'repair', topic: 'fix the seam' }), 's4a-goal');
      if (repair.status === 'rejected') throw Error('unreachable');
      expect(repair).toMatchObject({ status: 'staged' });
      const noteId = repair.noteId;
      const item = await f.platform.notes.readNote(ctx, { noteId });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.storedState).toBe('staged');
      // the user cannot accept it in 4A (S4-NOTE-09 is slice 8)
      const accept = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-n13-accept', noteId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: 'apply the repair' });
      expect(accept).toMatchObject({ status: 'rejected', code: 'invalid' });
      // the author withdraws it
      const withdrawn = await f.platform.notes.withdrawNote(f.workCtx(run), { commandId: 's4a-n13-withdraw',
        noteId, expectedVersion: 1, reason: 'not needed' });
      expect(withdrawn).toMatchObject({ status: 'done', noteId, version: 2, state: 'withdrawn' });
      const stored = await f.platform.notes.readNote(ctx, { noteId });
      if (stored.status !== 'ready') throw Error('unreachable');
      expect(stored.value.storedState).toBe('withdrawn');
      expect(stored.value.version).toBe(2);
    });
  });
});

describe('S4A N-15 kinds and replaces_kind_mismatch', () => {
  it.each(KINDS)('N-15 %s accepts all eight kinds and refuses a cross-family replaces', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const generalKinds = ['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision'] as const;
      for (const [index, noteKind] of generalKinds.entries()) {
        const result = await f.write(ctx, general({ kind: noteKind, topic: `kind-${String(index)}` }), null);
        expect(result.status).toBe('accepted');
      }
      const understandingResult = await f.write(ctx, understanding({ kind: 'goal', goalId: 's4a-goal' },
        { topic: 'kind-understanding' }), 's4a-goal');
      expect(understandingResult.status).toBe('accepted');
      if (understandingResult.status === 'rejected') throw Error('unreachable');
      const run = await f.claimRun('n15-repair');
      const repairResult = await f.write(f.workCtx(run), general({ kind: 'repair', topic: 'kind-repair' }), 's4a-goal');
      expect(repairResult).toMatchObject({ status: 'staged' });

      // open_question replaced by decision: accepted, old superseded
      const question = await f.write(ctx, general({ kind: 'open_question', topic: 'q-topic' }), null);
      if (question.status === 'rejected') throw Error('unreachable');
      const decision = await f.write(ctx, general({ kind: 'decision', topic: 'q-topic',
        replaces: [question.noteId] }), null);
      expect(decision.status).toBe('accepted');
      const oldQuestion = await f.platform.notes.readNote(ctx, { noteId: question.noteId });
      if (oldQuestion.status !== 'ready') throw Error('unreachable');
      expect(oldQuestion.value.storedState).toBe('superseded');

      // a decision cannot replace an understanding, nor the reverse
      const uId = understandingResult.noteId;
      const decisionOnGoal = await f.write(ctx, general({ kind: 'decision', topic: 'cross-d',
        anchor: { kind: 'goal', goalId: 's4a-goal' } }), 's4a-goal');
      if (decisionOnGoal.status === 'rejected') throw Error('unreachable');
      const reverse = await f.write(ctx, general({ kind: 'decision', topic: 'cross',
        anchor: { kind: 'goal', goalId: 's4a-goal' }, replaces: [uId] }), 's4a-goal');
      expect(reverse).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'replaces_kind_mismatch' });
      const dId = decisionOnGoal.noteId;
      const forward = await f.write(ctx, understanding({ kind: 'goal', goalId: 's4a-goal' },
        { topic: 'cross-u', replaces: [dId] }), 's4a-goal');
      expect(forward).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'replaces_kind_mismatch' });
    });
  });
});

describe('S4A N-16 header rendering', () => {
  const symbol: SymbolLocatorV1 = { language: 'typescript', qualifiedName: 'run',
    signatureDigest: 'a'.repeat(64), range: { startLine: 1, endLine: 2 }, fileDigest: 'b'.repeat(64) };
  const cases: [string, Parameters<typeof renderNoteHeader>[0], string][] = [
    ['module', { kind: 'pitfall', anchor: { kind: 'module', moduleId: 'M1' }, structural: false,
      conclusion: '不要重试' }, '坑(模块 M1)：不要重试'],
    ['interface', { kind: 'convention', anchor: { kind: 'interface', moduleId: 'M1', interfaceId: 'I1' },
      structural: false, conclusion: '先判空' }, '约定(接口 M1/I1)：先判空'],
    ['file', { kind: 'pitfall', anchor: { kind: 'file', path: 'src/a.ts' }, structural: false,
      conclusion: '会越界' }, '坑(src/a.ts)：会越界'],
    ['file-symbol', { kind: 'pitfall', anchor: { kind: 'file', path: 'src/a.ts', symbol }, structural: false,
      conclusion: '会越界' }, '坑(src/a.ts#run)：会越界'],
    ['goal', { kind: 'decision', anchor: { kind: 'goal', goalId: 'g1' }, structural: false,
      conclusion: '拆分' }, '决定(目标 g1)：拆分'],
    ['stage', { kind: 'decision', anchor: { kind: 'stage', goalId: 'g1', planRevision: 1, stageId: 's1' },
      structural: false, conclusion: '先做读取' }, '决定(阶段 s1)：先做读取'],
    ['task', { kind: 'pitfall', anchor: { kind: 'task', goalId: 'g1', taskId: 't1' }, structural: false,
      conclusion: '接口会变' }, '坑(任务 t1)：接口会变'],
    ['project', { kind: 'convention', anchor: { kind: 'project' }, structural: false,
      conclusion: '都用 POSIX 路径' }, '约定(项目)：都用 POSIX 路径'],
    ['structural', { kind: 'decision', anchor: { kind: 'task', goalId: 'g1', taskId: 't1' }, structural: true,
      conclusion: '先冻结接口' }, '决定(任务 t1)!：先冻结接口'],
  ];
  it.each(cases)('N-16 %s renders the exact header line', (_name, note, expected) => {
    expect(renderNoteHeader(note)).toBe(expected);
  });
});

describe('S4A N-17 topicKey', () => {
  it.each(KINDS)('N-17 %s normalizes the topicKey and keeps the original topic', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const padded = await f.write(ctx, general({ topic: '  Auth  Flow ', anchor: FILE_A }), null);
      if (padded.status === 'rejected') throw Error('unreachable');
      const paddedItem = await f.platform.notes.readNote(ctx, { noteId: padded.noteId });
      if (paddedItem.status !== 'ready') throw Error('unreachable');
      expect(paddedItem.value.topicKey).toBe('auth flow');
      expect(paddedItem.value.topic).toBe('  Auth  Flow ');

      const plain = await f.write(ctx, general({ topic: 'auth flow', anchor: FILE_B }), null);
      if (plain.status === 'rejected') throw Error('unreachable');
      const plainItem = await f.platform.notes.readNote(ctx, { noteId: plain.noteId });
      if (plainItem.status !== 'ready') throw Error('unreachable');
      expect(plainItem.value.topicKey).toBe('auth flow');

      const chinese = await f.write(ctx, general({ topic: '认证流程', anchor: { kind: 'module', moduleId: 'A' } }), null);
      if (chinese.status === 'rejected') throw Error('unreachable');
      const chineseItem = await f.platform.notes.readNote(ctx, { noteId: chinese.noteId });
      if (chineseItem.status !== 'ready') throw Error('unreachable');
      expect(chineseItem.value.topicKey).toBe('认证流程');
      expect(chineseItem.value.topicKey).not.toBe('auth flow');

      expect(await f.write(ctx, general({ topic: '   ', anchor: { kind: 'module', moduleId: 'B' } }), null))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await f.write(ctx, general({ topic: 'a'.repeat(41), anchor: { kind: 'project' } }), null))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    });
  });
});

describe('S4A N-18 existingTopics', () => {
  it.each(KINDS)('N-18 %s lists the other current topics and refuses a relation-free repeat', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const moduleA = { kind: 'module', moduleId: 'A' } as const;
      expect((await f.write(ctx, general({ topic: 'a', anchor: moduleA }), null)).status).toBe('accepted');
      expect((await f.write(ctx, general({ topic: 'b', anchor: moduleA }), null)).status).toBe('accepted');
      const fresh = await f.write(ctx, general({ topic: 'c', anchor: moduleA }), null);
      expect(fresh).toMatchObject({ status: 'accepted', existingTopics: [
        { anchorKey: 'module:A', topic: 'a', count: 1 },
        { anchorKey: 'module:A', topic: 'b', count: 1 },
      ] });
      const repeat = await f.write(ctx, general({ topic: 'a', anchor: moduleA }), null);
      expect(repeat).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'same_topic_unresolved' });
      expect((repeat as unknown as { existingTopics?: unknown }).existingTopics).toBeUndefined();
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: moduleA, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items.map(item => item.topic)).toEqual(['a', 'b', 'c']);
    });
  });

  it.each(KINDS)('N-18 %s existingTopics follows the new-topic condition and the latest spelling', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const moduleA = { kind: 'module', moduleId: 'A' } as const;
      const moduleB = { kind: 'module', moduleId: 'B' } as const;
      const n1 = await f.write(ctx, general({ topic: 'Alpha', anchor: moduleA }), null);
      expect(n1.status).toBe('accepted');
      const n2 = await f.write(ctx, general({ topic: 'alpha', anchor: moduleA, coexistWith: [idOf(n1)] }), null);
      expect(n2.status).toBe('accepted');
      const n3 = await f.write(ctx, general({ topic: 'beta', anchor: moduleA }), null);
      expect(n3.status).toBe('accepted');
      const n4 = await f.write(ctx, general({ topic: 'gamma', anchor: moduleB }), null);
      expect(n4.status).toBe('accepted');
      const n5 = await f.write(ctx, general({ topic: 'delta', anchor: moduleB }), null);
      expect(n5.status).toBe('accepted');
      const fresh = await f.write(ctx, general({ topic: 'gamma', anchor: moduleA, extraAnchors: [moduleB],
        coexistWith: [idOf(n4)] }), null);
      if (fresh.status === 'rejected') throw Error('unreachable');
      expect(fresh.status).toBe('accepted');
      expect(fresh.existingTopics).toEqual([
        { anchorKey: 'module:A', topic: 'alpha', count: 2 },
        { anchorKey: 'module:A', topic: 'beta', count: 1 },
      ]);
    });
  });
});

describe('S4A N-19 understanding sections', () => {
  it.each(KINDS)('N-19 %s stores the five sections and enforces the strict per-kind union', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const goal = { kind: 'goal', goalId: 's4a-goal' } as const;
      const allNone: NoteSectionsV1 = { status: '无', decided: '无', open: '无', next: '无', risks: '无' };
      const accepted = await f.write(ctx, understanding(goal, { topic: 'u-sections', sections: allNone }),
        's4a-goal', { expectedPointerRevision: null });
      if (accepted.status === 'rejected') throw Error('unreachable');
      expect(accepted.status).toBe('accepted');
      const item = await f.platform.notes.readNote(ctx, { noteId: accepted.noteId });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.sections).toEqual(allNone);
      // The rendered body of the all-"无" sections is this exact literal; 4A does
      // not expose the stored body (P8: no body paging), so its exact rendering is
      // pinned by the byte boundary below.
      const fixed = Buffer.byteLength('现状\n无\n\n已定\n无\n\n未决\n无\n\n下一步\n无\n\n风险\n无', 'utf8');
      expect(fixed).toBe(61);
      const stage = { kind: 'stage', goalId: 's4a-goal', stageId: 's1' } as const;
      const pad = (extra: number): NoteSectionsV1 => ({ status: 'a'.repeat(6144 - fixed + 3 + extra),
        decided: '无', open: '无', next: '无', risks: '无' });
      const ok6144 = await f.write(ctx, understanding(stage, { topic: 'u-6144', sections: pad(0) }),
        's4a-goal', { expectedPointerRevision: null });
      expect(ok6144.status).toBe('accepted');
      const bad6145 = await f.write(ctx, understanding(stage, { topic: 'u-6145', sections: pad(1) }),
        's4a-goal', { expectedPointerRevision: null });
      expect(bad6145).toMatchObject({ status: 'rejected', code: 'invalid' });

      // wrong channel for the kind
      const pitfallSections = { ...general({ topic: 'bad-sections' }), sections: allNone } as unknown as NoteDraftV1;
      expect(await f.write(ctx, pitfallSections, null)).toMatchObject({ status: 'rejected', code: 'invalid' });
      const understandingBody = { ...understanding(goal, { topic: 'bad-body' }), body: 'x' } as unknown as NoteDraftV1;
      expect(await f.write(ctx, understandingBody, 's4a-goal')).toMatchObject({ status: 'rejected', code: 'invalid' });
      const emptySection = understanding(goal, { topic: 'bad-empty',
        sections: { status: '', decided: '无', open: '无', next: '无', risks: '无' } });
      expect(await f.write(ctx, emptySection, 's4a-goal')).toMatchObject({ status: 'rejected', code: 'invalid' });
    });
  });
});

describe('S4A N-08 pointer discriminating cases', () => {
  it.each(KINDS)('N-08 %s accepting a pending general note on a goal anchor leaves the pointer', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const goal = { kind: 'goal', goalId: 's4a-goal' } as const;
      const agent = await f.claimRun('n08h-pointer');
      const u1 = await f.write(f.workCtx(agent), understanding(goal, { topic: 'u-pointer' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(u1.status).toBe('accepted');
      const u1Id = idOf(u1);
      const pitfall = await f.write(f.workCtx(agent), general({ topic: 'pitfall-pointer', anchor: goal,
        structural: true }), 's4a-goal');
      expect(pitfall).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
      const accepted = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-n08h-accept', noteId: idOf(pitfall),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '收下结构性坑' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: goal, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.pointer).toEqual({ noteId: u1Id, revision: 1 });
      const u1Item = await f.platform.notes.readNote(ctx, { noteId: u1Id });
      if (u1Item.status !== 'ready') throw Error('unreachable');
      expect(u1Item.value.storedState).toBe('accepted');
    });
  });
});

describe('S4A N-06 accepting a pending replacement', () => {
  it.each(KINDS)('N-06 %s accepting a pending replacement supersedes its target in that commit', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const x = await f.write(ctx, general({ topic: 'n06-x', anchor: FILE_A }), null);
      expect(x.status).toBe('accepted');
      const xId = idOf(x);
      const agent = await f.claimRun('n06h-replacement');
      const replacement = await f.write(f.workCtx(agent), general({ kind: 'decision', topic: 'n06-y',
        anchor: FILE_A, structural: true, replaces: [xId] }), 's4a-goal');
      expect(replacement).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
      const beforeAccept = await f.platform.notes.readNote(ctx, { noteId: xId });
      if (beforeAccept.status !== 'ready') throw Error('unreachable');
      expect(beforeAccept.value.storedState).toBe('accepted');
      const accepted = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-n06h-accept', noteId: idOf(replacement),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '收下替换' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
      const afterAccept = await f.platform.notes.readNote(ctx, { noteId: xId });
      if (afterAccept.status !== 'ready') throw Error('unreachable');
      expect(afterAccept.value.storedState).toBe('superseded');
    });
  });
});
