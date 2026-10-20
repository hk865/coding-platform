/**
 * Slice 4A W1 (NE1): the public `NoteWritePort`/`NoteReadPort` reached through
 * `platform.notes` on both backends. Expected values are literal, hand-computed
 * from spec §4/§5.2; the database and record store are never read.
 */
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

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
  const sections: NoteSectionsV1 = { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' };
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

describe('S4A N-01 format and limits', () => {
  it.each(KINDS)('N-01 %s accepts the boundary and refuses one past it with the draft', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const at = (n: number, extra: Partial<NoteDraftV1> = {}): NoteDraftV1 => general({
        topic: `t-${String(n)}`, anchor: FILE_A, ...extra });
      const ok200 = await f.write(ctx, at(1, { conclusion: 'c'.repeat(200) }), null);
      expect(ok200.status).toBe('accepted');
      const bad201 = await f.write(ctx, at(2, { conclusion: 'c'.repeat(201) }), null);
      expect(bad201).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect((bad201 as unknown as { draft: { note: NoteDraftV1 } }).draft.note.conclusion).toHaveLength(201);
      expect((await f.write(ctx, at(3, { body: 'x'.repeat(3072) }), null)).status).toBe('accepted');
      expect(await f.write(ctx, at(4, { body: 'x'.repeat(3073) }), null)).toMatchObject({ status: 'rejected', code: 'invalid' });
      const facts = Array.from({ length: 16 }, (_, i) => ({ kind: 'commit' as const, sha: 'a'.repeat(40 - String(i).length) + String(i) }));
      expect((await f.write(ctx, at(5, { facts }), null)).status).toBe('accepted');
      expect(await f.write(ctx, at(6, { facts: [...facts, { kind: 'commit', sha: 'b'.repeat(40) }] }), null))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
      const extras: NoteDraftAnchorV1[] = [
        { kind: 'module', moduleId: 'A' }, { kind: 'module', moduleId: 'A1' },
        { kind: 'module', moduleId: 'B' }, { kind: 'project' },
      ];
      expect((await f.write(ctx, at(7, { extraAnchors: extras }), null)).status).toBe('accepted');
      expect(await f.write(ctx, at(8, { extraAnchors: [...extras, { kind: 'module', moduleId: 'R' }] }), null))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
      const paths = Array.from({ length: 32 }, (_, i) => `basis-${String(i)}.txt`);
      await Promise.all(paths.map(path => writeFile(join(f.root, path), 'x')));
      expect((await f.write(ctx, at(9, { basisFiles: paths }), null)).status).toBe('accepted');
      expect(await f.write(ctx, at(10, { basisFiles: [...paths, 'basis-extra.txt'] }), null))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
      await writeFile(join(f.root, 'big.bin'), Buffer.alloc(2 * 1024 * 1024, 65));
      expect(await f.write(ctx, at(11, { basisFiles: ['big.bin'] }), null))
        .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'basis_file_too_large' });
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: FILE_A, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items.some(item => item.topic === 't-11')).toBe(false);
    });
  });

  it.each(KINDS)('N-01 %s understanding body 6,144 accepted / 6,145 refused', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      // The rendered body is 现状\n<status>\n\n已定\n<decided>\n\n未决\n<open>\n\n下一步\n<next>\n\n风险\n<risks>.
      const rendered = (status: string): string =>
        `现状\n${status}\n\n已定\nb\n\n未决\nc\n\n下一步\nd\n\n风险\ne`;
      const fixed = Buffer.byteLength(rendered(''), 'utf8');
      const sections = (status: string): NoteSectionsV1 => ({ status, decided: 'b', open: 'c', next: 'd', risks: 'e' });
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      const ok = await f.write(ctx, understanding(goalAnchor, { topic: 'u-ok', sections: sections('a'.repeat(6144 - fixed)) }),
        's4a-goal', { expectedPointerRevision: null });
      expect(ok.status).toBe('accepted');
      const bad = await f.write(ctx, understanding(goalAnchor, { topic: 'u-bad', sections: sections('a'.repeat(6145 - fixed)) }),
        's4a-goal', { expectedPointerRevision: null });
      expect(bad).toMatchObject({ status: 'rejected', code: 'invalid' });
    });
  });
});

describe('S4A N-02 anchors', () => {
  it.each(KINDS)('N-02 %s accepts each anchor kind and refuses missing or out-of-bounds ones', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const write = (n: number, anchor: NoteDraftAnchorV1) => f.write(ctx, general({ topic: `a-${String(n)}`, anchor }),
        'goalId' in anchor ? 's4a-goal' : null);
      expect((await write(1, { kind: 'module', moduleId: 'A' })).status).toBe('accepted');
      expect((await write(2, { kind: 'interface', moduleId: 'A', interfaceId: 'I1' })).status).toBe('accepted');
      expect((await write(3, FILE_A)).status).toBe('accepted');
      expect((await write(4, { kind: 'goal', goalId: 's4a-goal' })).status).toBe('accepted');
      const stageResult = await write(5, { kind: 'stage', goalId: 's4a-goal', stageId: 's1' });
      expect(stageResult.status).toBe('accepted');
      const stageItem = await f.platform.notes.readNote(ctx, { noteId: idOf(stageResult) });
      if (stageItem.status !== 'ready') throw Error('unreachable');
      expect(stageItem.value.anchor).toEqual({ kind: 'stage', goalId: 's4a-goal', planRevision: 1, stageId: 's1' });
      expect((await write(6, { kind: 'task', goalId: 's4a-goal', taskId: 't1' })).status).toBe('accepted');
      expect((await write(7, { kind: 'project' })).status).toBe('accepted');
      expect(await write(8, { kind: 'module', moduleId: 'Z' }))
        .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
      expect(await write(9, { kind: 'file', path: '../outside.ts' }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await write(10, { kind: 'stage', goalId: 's4a-goal', stageId: 's9' }))
        .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
      expect(await write(11, { kind: 'file', path: 'src/missing.ts' }))
        .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'anchor_not_found' });
      expect(await f.write(ctx, understanding({ kind: 'task', goalId: 's4a-goal', taskId: 't1' }), 's4a-goal',
        { expectedPointerRevision: null })).toMatchObject({ status: 'rejected', code: 'invalid' });
    });
  });
});

describe('S4A N-03 source and identity', () => {
  it.each(KINDS)('N-03 %s the platform fixes the source from the trusted context', async kind => {
    await withFixture(kind, {}, async f => {
      const run = await f.claimRun('n03');
      const agent = await f.write(f.workCtx(run), general({ topic: 'agent-note' }), 's4a-goal');
      expect(agent.status).toBe('accepted');
      const agentItem = await f.platform.notes.readNote(f.ctx(), { noteId: idOf(agent) });
      if (agentItem.status !== 'ready') throw Error('unreachable');
      expect(agentItem.value.source).toMatchObject({ kind: 'agent', runRef: { runId: run.runId } });
      const spoofed = { ...general({ topic: 'spoofed' }), source: { kind: 'user', principalId: 'attacker' } } as unknown as NoteDraftV1;
      const spoofedResult = await f.write(f.workCtx(run), spoofed, 's4a-goal');
      expect(spoofedResult.status).toBe('accepted');
      const spoofedItem = await f.platform.notes.readNote(f.ctx(), { noteId: idOf(spoofedResult) });
      if (spoofedItem.status !== 'ready') throw Error('unreachable');
      expect(spoofedItem.value.source.kind).toBe('agent');
      const userResult = await f.write(f.ctx(), general({ topic: 'user-note' }), null);
      expect(userResult.status).toBe('accepted');
      const userItem = await f.platform.notes.readNote(f.ctx(), { noteId: idOf(userResult) });
      if (userItem.status !== 'ready') throw Error('unreachable');
      expect(userItem.value.source).toEqual({ kind: 'user', principalId: 's4a-operator' });
      expect(await f.write(f.queryCtx(), general({ topic: 'query-note' }), null))
        .toMatchObject({ status: 'rejected', code: 'forbidden' });
    });
  });
});

describe('S4A N-04 same-topic admission', () => {
  it.each(KINDS)('N-04 %s contradiction, replacement, coexistence and the plain conflict', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const first = await f.write(ctx, general({ topic: 'shared topic', anchor: FILE_A }), null);
      const firstId = idOf(first);
      const agent = await f.claimRun('n04');
      const contradicts = await f.write(f.workCtx(agent), general({ topic: 'shared topic', anchor: FILE_A, contradicts: [firstId] }), 's4a-goal');
      expect(contradicts).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
      const replaces = await f.write(ctx, general({ topic: 'shared topic', anchor: FILE_A, replaces: [firstId] }), null);
      expect(replaces.status).toBe('accepted');
      const old = await f.platform.notes.readNote(ctx, { noteId: firstId });
      if (old.status !== 'ready') throw Error('unreachable');
      expect(old.value.storedState).toBe('superseded');
      // coexistence keeps both current and stores the evidence
      const target = await f.write(ctx, general({ topic: 'coexist topic', anchor: FILE_B }), null);
      const targetId = idOf(target);
      const coexist = await f.write(ctx, general({ topic: 'coexist topic', anchor: FILE_B, coexistWith: [targetId] }), null);
      expect(coexist.status).toBe('accepted');
      const coexistItem = await f.platform.notes.readNote(ctx, { noteId: idOf(coexist) });
      if (coexistItem.status !== 'ready') throw Error('unreachable');
      expect(coexistItem.value.coexistWith).toEqual([targetId]);
      const targetItem = await f.platform.notes.readNote(ctx, { noteId: targetId });
      if (targetItem.status !== 'ready') throw Error('unreachable');
      expect(targetItem.value.storedState).toBe('accepted');
      const plain = await f.write(ctx, general({ topic: 'coexist topic', anchor: FILE_B }), null);
      expect(plain).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'same_topic_unresolved' });
      expect((plain as unknown as { conflicts: { noteId: string }[] }).conflicts.some(c => c.noteId === targetId)).toBe(true);
      // a superseded note does not block the same topic any more
      const solo = await f.write(ctx, general({ topic: 'solo topic', anchor: { kind: 'module', moduleId: 'A' } }), null);
      const soloId = idOf(solo);
      await f.write(ctx, general({ topic: 'other topic', anchor: { kind: 'module', moduleId: 'A' }, replaces: [soloId] }), null);
      const afterSupersede = await f.write(ctx, general({ topic: 'solo topic', anchor: { kind: 'module', moduleId: 'A' } }), null);
      expect(afterSupersede.status).toBe('accepted');
    });
  });
});

describe('S4A N-05 shared anchors', () => {
  it.each(KINDS)('N-05 %s a relation needs a shared anchor key', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const onM = await f.write(ctx, general({ topic: 'm', anchor: FILE_A }), null);
      const noShare = await f.write(ctx, general({ topic: 'n', anchor: FILE_B, replaces: [idOf(onM)] }), null);
      expect(noShare).toMatchObject({ status: 'rejected', code: 'invalid' });
      const shared = await f.write(ctx, general({ topic: 'n2', anchor: FILE_B,
        extraAnchors: [FILE_A], replaces: [idOf(onM)] }), null);
      expect(shared.status).toBe('accepted');
    });
  });
});

describe('S4A N-06 structural/contradiction enters review without superseding', () => {
  it.each(KINDS)('N-06 %s a contradiction stays pending and the old note stays current', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const old = await f.write(ctx, general({ topic: 'old', anchor: FILE_A }), null);
      const oldId = idOf(old);
      const agent = await f.claimRun('n06');
      const fresh = await f.write(f.workCtx(agent), general({ topic: 'new', anchor: FILE_A, contradicts: [oldId] }), 's4a-goal');
      expect(fresh).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
      const freshItem = await f.platform.notes.readNote(ctx, { noteId: idOf(fresh) });
      if (freshItem.status !== 'ready') throw Error('unreachable');
      expect(freshItem.value.storedState).toBe('pending_review');
      expect(freshItem.value.contradicts).toEqual([oldId]);
      const oldItem = await f.platform.notes.readNote(ctx, { noteId: oldId });
      if (oldItem.status !== 'ready') throw Error('unreachable');
      expect(oldItem.value.storedState).toBe('accepted');
    });
  });
});

describe('S4A N-07 quota and overQuota', () => {
  it.each(KINDS)('N-07 %s the sixth current item on an anchor enters review with quota_full', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const ids: string[] = [];
      for (let i = 1; i <= 5; i += 1) {
        const result = await f.write(ctx, general({ topic: `q-${String(i)}`, anchor: FILE_A }), null);
        expect(result.status).toBe('accepted');
        ids.push(idOf(result));
      }
      const run = await f.claimRun('n07');
      const sixth = await f.write(f.workCtx(run), general({ topic: 'q-6', anchor: FILE_A }), 's4a-goal');
      expect(sixth).toMatchObject({ status: 'pending_review', reasons: ['quota_full'], overQuota: false });
      const sixthItem = await f.platform.notes.readNote(ctx, { noteId: idOf(sixth) });
      if (sixthItem.status !== 'ready') throw Error('unreachable');
      expect(sixthItem.value.overQuota).toBe(false);
      // projection: replacing a current item is admitted at a full anchor
      const replace = await f.write(ctx, general({ topic: 'q-replace', anchor: FILE_A, replaces: [ids[0]!] }), null);
      expect(replace.status).toBe('accepted');
      // the user never waits on quota; the result reports it and reads overQuota
      const user = await f.write(ctx, general({ topic: 'q-user', anchor: FILE_A }), null);
      expect(user).toMatchObject({ status: 'accepted', overQuota: true });
      const userItem = await f.platform.notes.readNote(ctx, { noteId: idOf(user) });
      if (userItem.status !== 'ready') throw Error('unreachable');
      expect(userItem.value.overQuota).toBe(true);
    });
  });

  it.each(KINDS)('N-07 %s an understanding is not held by the anchor quota', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      for (let i = 1; i <= 5; i += 1) {
        const result = await f.write(ctx, general({ topic: `q-${String(i)}`, anchor: goalAnchor }), 's4a-goal');
        expect(result.status).toBe('accepted');
      }
      const run = await f.claimRun('n07-understanding');
      const u = await f.write(f.workCtx(run), understanding(goalAnchor, { topic: 'u-anchor' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(u).toMatchObject({ status: 'accepted', reasons: [], overQuota: false });
      const uItem = await f.platform.notes.readNote(ctx, { noteId: idOf(u) });
      if (uItem.status !== 'ready') throw Error('unreachable');
      expect(uItem.value.overQuota).toBe(false);
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.pointer).toEqual({ noteId: idOf(u), revision: 1 });
    });
  });

  it.each(KINDS)('N-07 %s an understanding counts toward the goal activity', async kind => {
    await withFixture(kind, { goalQuota: 2 }, async f => {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      for (let i = 1; i <= 2; i += 1) {
        const result = await f.write(ctx, general({ topic: `q-${String(i)}`, anchor: FILE_A }), 's4a-goal');
        expect(result.status).toBe('accepted');
      }
      const run = await f.claimRun('n07-understanding-goal');
      const u = await f.write(f.workCtx(run), understanding(goalAnchor, { topic: 'u-goal' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(u).toMatchObject({ status: 'pending_review', reasons: ['quota_full'], overQuota: true });
      const uItem = await f.platform.notes.readNote(ctx, { noteId: idOf(u) });
      if (uItem.status !== 'ready') throw Error('unreachable');
      expect(uItem.value.storedState).toBe('pending_review');
      expect(uItem.value.overQuota).toBe(true);
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.pointer).toEqual({ noteId: null, revision: null });
    });
  });

  it.each(KINDS)('N-07 %s a repair reports overQuota from the goal quota', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      for (let i = 1; i <= 5; i += 1) {
        const result = await f.write(ctx, general({ topic: `q-${String(i)}`, anchor: FILE_A }), null);
        expect(result.status).toBe('accepted');
      }
      const run = await f.claimRun('n07-repair-default');
      const repair = await f.write(f.workCtx(run), general({ kind: 'repair', topic: 'q-repair-a', anchor: FILE_A }), 's4a-goal');
      expect(repair).toMatchObject({ status: 'staged', overQuota: false });
      const repairItem = await f.platform.notes.readNote(ctx, { noteId: idOf(repair) });
      if (repairItem.status !== 'ready') throw Error('unreachable');
      expect(repairItem.value.overQuota).toBe(false);
    });
    await withFixture(kind, { goalQuota: 2 }, async f => {
      const ctx = f.ctx();
      for (let i = 1; i <= 2; i += 1) {
        const result = await f.write(ctx, general({ topic: `q-${String(i)}`, anchor: FILE_B }), 's4a-goal');
        expect(result.status).toBe('accepted');
      }
      const run = await f.claimRun('n07-repair-goal');
      const repair = await f.write(f.workCtx(run), general({ kind: 'repair', topic: 'q-repair-b', anchor: FILE_A }), 's4a-goal');
      expect(repair).toMatchObject({ status: 'staged', overQuota: true });
      const repairItem = await f.platform.notes.readNote(ctx, { noteId: idOf(repair) });
      if (repairItem.status !== 'ready') throw Error('unreachable');
      expect(repairItem.value.storedState).toBe('staged');
      expect(repairItem.value.overQuota).toBe(true);
    });
  });

  it.each(KINDS)('N-07 %s a structural replacement at a full anchor has no quota_full', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const ids: string[] = [];
      for (let i = 1; i <= 5; i += 1) {
        const result = await f.write(ctx, general({ topic: `q-${String(i)}`, anchor: FILE_A }), null);
        expect(result.status).toBe('accepted');
        ids.push(idOf(result));
      }
      const run = await f.claimRun('n07-structural-replace');
      const structural = await f.write(f.workCtx(run),
        general({ topic: 'q-structural', anchor: FILE_A, structural: true, replaces: [ids[0]!] }), 's4a-goal');
      // C3.3/C3.4: the target is the user's, so the reason is `user_note_replaced`
      // (a general structural note no longer adds `structural`).
      expect(structural).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
      expect((structural as unknown as { reasons: string[] }).reasons).not.toContain('quota_full');
    });
  });

  it.each(KINDS)('N-07 %s a reviewed item still counts toward the goal activity', async kind => {
    await withFixture(kind, { goalQuota: 2 }, async f => {
      const ctx = f.ctx();
      const first = await f.write(ctx, general({ topic: 'g-1', anchor: FILE_A }), 's4a-goal');
      expect(first.status).toBe('accepted');
      const scribe = await f.claimRun('n07-scribe', 't3', 'scribe');
      const review = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-n07-review',
        noteId: idOf(first), expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(review).toMatchObject({ status: 'done', state: 'reviewed' });
      const second = await f.write(ctx, general({ topic: 'g-2', anchor: FILE_B }), 's4a-goal');
      expect(second.status).toBe('accepted');
      const run = await f.claimRun('n07-agent');
      const third = await f.write(f.workCtx(run), general({ topic: 'g-3', anchor: { kind: 'module', moduleId: 'A' } }), 's4a-goal');
      expect(third).toMatchObject({ status: 'pending_review', reasons: ['quota_full'] });
    });
  });

  it.each(KINDS)('N-07 %s a committed overQuota equals the read after the commit', async kind => {
    // (a) A structural replacement of one accepted item at an exactly-full goal
    // stays pending and supersedes nothing yet, so the committed population is
    // full + 1: the write result must already say overQuota true.
    await withFixture(kind, { goalQuota: 2 }, async f => {
      const ctx = f.ctx();
      const first = await f.write(ctx, general({ topic: 'full-a-1', anchor: FILE_A }), 's4a-goal');
      expect(first.status).toBe('accepted');
      expect((await f.write(ctx, general({ topic: 'full-a-2', anchor: FILE_A }), 's4a-goal')).status).toBe('accepted');
      const run = f.workCtx(await f.claimRun('n07-committed-a'));
      const structural = await f.write(run, general({ topic: 'full-a-3', anchor: FILE_A,
        structural: true, replaces: [idOf(first)] }), 's4a-goal');
      expect(structural).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'], overQuota: true });
      const item = await f.platform.notes.readNote(ctx, { noteId: idOf(structural) });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.overQuota).toBe(true);
    });
    // (b) An agent repair that replaces an accepted item ends staged and also
    // supersedes nothing yet, so the committed goal population is full + 1.
    await withFixture(kind, { goalQuota: 2 }, async f => {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      const generalNote = await f.write(ctx, general({ topic: 'full-b-1', anchor: FILE_A }), 's4a-goal');
      expect(generalNote.status).toBe('accepted');
      const run = f.workCtx(await f.claimRun('n07-committed-b'));
      const understandingNote = await f.write(run, understanding(goalAnchor, { topic: 'full-b-2' }),
        's4a-goal', { expectedPointerRevision: null });
      expect(understandingNote.status).toBe('accepted');
      const repair = await f.write(run, general({ kind: 'repair', topic: 'full-b-3', anchor: goalAnchor,
        replaces: [idOf(understandingNote)] }), 's4a-goal');
      expect(repair).toMatchObject({ status: 'staged', overQuota: true });
      const item = await f.platform.notes.readNote(ctx, { noteId: idOf(repair) });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.overQuota).toBe(true);
    });
    // (c) A plain accepted replacement supersedes its target in THIS commit, so
    // the result and the read agree the goal is exactly full, not over.
    await withFixture(kind, { goalQuota: 2 }, async f => {
      const ctx = f.ctx();
      // The superseded item is agent-written, so the user-protection reason does
      // not apply and the replacement is accepted directly (C3.3).
      const firstRun = f.workCtx(await f.claimRun('n07-committed-c-first'));
      const first = await f.write(firstRun, general({ topic: 'full-c-1', anchor: FILE_A }), 's4a-goal');
      expect(first.status).toBe('accepted');
      expect((await f.write(ctx, general({ topic: 'full-c-2', anchor: FILE_A }), 's4a-goal')).status).toBe('accepted');
      const run = f.workCtx(await f.claimRun('n07-committed-c', 't2'));
      const replacement = await f.write(run, general({ topic: 'full-c-3', anchor: FILE_A,
        replaces: [idOf(first)] }), 's4a-goal');
      expect(replacement).toMatchObject({ status: 'accepted', overQuota: false });
      const item = await f.platform.notes.readNote(ctx, { noteId: idOf(replacement) });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.overQuota).toBe(false);
    });
  });
});

describe('S4A N-14 same-topic conflict needs both notes current', () => {
  it.each(KINDS)('N-14 %s a withdrawn note is not in a same-topic conflict', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const a = await f.write(ctx, general({ topic: 't', anchor: FILE_A }), null);
      if (a.status === 'rejected') throw Error('unreachable');
      const withdrawn = await f.platform.notes.withdrawNote(ctx, { commandId: 's4a-n14-withdraw-a',
        noteId: idOf(a), expectedVersion: 1, reason: null });
      expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn' });
      const b = await f.write(ctx, general({ topic: 't', anchor: FILE_A }), null);
      if (b.status === 'rejected') throw Error('unreachable');
      expect(b.status).toBe('accepted');
      const aItem = await f.platform.notes.readNote(ctx, { noteId: idOf(a) });
      if (aItem.status !== 'ready') throw Error('unreachable');
      expect(aItem.value.conflicting).toBe(false);
      const bItem = await f.platform.notes.readNote(ctx, { noteId: idOf(b) });
      if (bItem.status !== 'ready') throw Error('unreachable');
      expect(bItem.value.conflicting).toBe(false);
    });
  });
});

describe('S4A N-08 current-understanding pointer race', () => {
  it.each(KINDS)('N-08 %s the second writer conflicts and succeeds after re-reading', async kind => {
    await withFixture(kind, {}, async f => {
      const run1 = await f.claimRun('n08-a');
      const run2 = await f.claimRun('n08-b', 't2');
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      const first = await f.write(f.workCtx(run1), understanding(goalAnchor, { topic: 'u-first' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(first.status).toBe('accepted');
      const second = await f.write(f.workCtx(run2), understanding(goalAnchor, { topic: 'u-second' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(second).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      expect((second as unknown as { pointer: { revision: number } }).pointer.revision).toBe(1);
      const retry = await f.write(f.workCtx(run2), understanding(goalAnchor, { topic: 'u-second' }), 's4a-goal',
        { expectedPointerRevision: 1 });
      expect(retry.status).toBe('accepted');
      const firstItem = await f.platform.notes.readNote(f.ctx(), { noteId: idOf(first) });
      if (firstItem.status !== 'ready') throw Error('unreachable');
      expect(firstItem.value.storedState).toBe('superseded');
      const page = await f.platform.notes.listByAnchor(f.ctx(), { anchor: { kind: 'goal', goalId: 's4a-goal' },
        limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.pointer).toEqual({ noteId: idOf(retry), revision: 2 });
    });
  });

  it.each(KINDS)('N-08 %s accepting a pending understanding checks the pointer revision', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      const agent = await f.claimRun('n08-structural');
      const pending = await f.write(f.workCtx(agent), understanding(goalAnchor, { topic: 'u-structural', structural: true }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(pending).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
      const stale = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-u-stale', noteId: idOf(pending),
        expectedVersion: 1, expectedPointerRevision: 99, verdict: 'accept', reason: 'merge' });
      expect(stale).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
      const accepted = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-u-accept', noteId: idOf(pending),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '合并后收下' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
    });
  });

  it.each(KINDS)('N-08 %s accepting a pending general note on a goal anchor leaves the pointer', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      const agent = await f.claimRun('n08-pointer-general');
      // Case A: no understanding yet. Accepting a pending general note on the goal
      // anchor must not create a current-understanding pointer (L8: only goal and
      // stage anchors HAVE a pointer; that is not the same as the pointer moving).
      // C3.4: a general structural note is accepted directly now, so the pending
      // note is made by replacing the user's note (C3.3 `user_note_replaced`).
      const seedA = await f.write(ctx, general({ topic: 'seed-a', anchor: goalAnchor }), 's4a-goal');
      const pitfallA = await f.write(f.workCtx(agent), general({ topic: 'p-a', anchor: goalAnchor,
        replaces: [idOf(seedA)] }), 's4a-goal');
      expect(pitfallA).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
      const acceptedA = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-n08-pa', noteId: idOf(pitfallA),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '收下结构性坑' });
      expect(acceptedA).toMatchObject({ status: 'done', state: 'accepted' });
      const pageA = await f.platform.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      if (pageA.status !== 'ready') throw Error('unreachable');
      expect(pageA.value.pointer).toEqual({ noteId: null, revision: null });

      // Case B: U1 is the current understanding. Accepting a pending general note
      // must leave the pointer and U1 alone (L6/S4-NOTE-05: only an understanding moves it).
      const u1 = await f.write(f.workCtx(agent), understanding(goalAnchor, { topic: 'u-b' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(u1.status).toBe('accepted');
      const u1Id = idOf(u1);
      const seedB = await f.write(ctx, general({ topic: 'seed-b', anchor: goalAnchor }), 's4a-goal');
      const pitfallB = await f.write(f.workCtx(agent), general({ topic: 'p-b', anchor: goalAnchor,
        replaces: [idOf(seedB)] }), 's4a-goal');
      expect(pitfallB).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
      const acceptedB = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-n08-pb', noteId: idOf(pitfallB),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '收下结构性坑' });
      expect(acceptedB).toMatchObject({ status: 'done', state: 'accepted' });
      const pageB = await f.platform.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      if (pageB.status !== 'ready') throw Error('unreachable');
      expect(pageB.value.pointer).toEqual({ noteId: u1Id, revision: 1 });
      const u1Item = await f.platform.notes.readNote(ctx, { noteId: u1Id });
      if (u1Item.status !== 'ready') throw Error('unreachable');
      expect(u1Item.value.storedState).toBe('accepted');
      expect(u1Item.value.version).toBe(1);
    });
  });

  it.each(KINDS)('N-08 %s a new understanding that replaces the current one supersedes it once', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      const run1 = await f.claimRun('n08-once-a');
      const run2 = await f.claimRun('n08-once-b', 't2');
      const u1 = await f.write(f.workCtx(run1), understanding(goalAnchor, { topic: 'u-once-1' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(u1.status).toBe('accepted');
      const u1Id = idOf(u1);
      // U2 declares replaces:[U1] AND U1 is the pointer target: one supersession, not two.
      const u2 = await f.write(f.workCtx(run2), understanding(goalAnchor, { topic: 'u-once-2', replaces: [u1Id] }),
        's4a-goal', { expectedPointerRevision: 1 });
      expect(u2.status).toBe('accepted');
      const u1Head = await f.platform.notes.readNote(ctx, { noteId: u1Id });
      if (u1Head.status !== 'ready') throw Error('unreachable');
      expect(u1Head.value.storedState).toBe('superseded');
      expect(u1Head.value.version).toBe(2);
      const u1v2 = await f.platform.notes.readNote(ctx, { noteId: u1Id, version: 2 });
      if (u1v2.status !== 'ready') throw Error('unreachable');
      expect(u1v2.value.storedState).toBe('superseded');
      expect(await f.platform.notes.readNote(ctx, { noteId: u1Id, version: 3 })).toMatchObject({ status: 'not_found' });
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.pointer).toEqual({ noteId: idOf(u2), revision: 2 });
    });
  });

  it.each(KINDS)('N-08 %s a structural understanding that replaces the current one supersedes it only on accept', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      const run1 = await f.claimRun('n08-structural-a');
      const run2 = await f.claimRun('n08-structural-b', 't2');
      const u1 = await f.write(f.workCtx(run1), understanding(goalAnchor, { topic: 'u-st-1' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(u1.status).toBe('accepted');
      const u1Id = idOf(u1);
      const u2 = await f.write(f.workCtx(run2), understanding(goalAnchor, { topic: 'u-st-2',
        replaces: [u1Id], structural: true }), 's4a-goal', { expectedPointerRevision: 1 });
      expect(u2).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
      const beforeAccept = await f.platform.notes.readNote(ctx, { noteId: u1Id });
      if (beforeAccept.status !== 'ready') throw Error('unreachable');
      expect(beforeAccept.value.storedState).toBe('accepted');
      const pageBefore = await f.platform.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      if (pageBefore.status !== 'ready') throw Error('unreachable');
      expect(pageBefore.value.pointer).toEqual({ noteId: u1Id, revision: 1 });
      const accepted = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-n08-structural-accept', noteId: idOf(u2),
        expectedVersion: 1, expectedPointerRevision: 1, verdict: 'accept', reason: '收下新理解' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
      const u1Head = await f.platform.notes.readNote(ctx, { noteId: u1Id });
      if (u1Head.status !== 'ready') throw Error('unreachable');
      expect(u1Head.value.storedState).toBe('superseded');
      expect(u1Head.value.version).toBe(2);
      expect(await f.platform.notes.readNote(ctx, { noteId: u1Id, version: 3 })).toMatchObject({ status: 'not_found' });
      const pageAfter = await f.platform.notes.listByAnchor(ctx, { anchor: goalAnchor, limit: 100, cursor: null });
      if (pageAfter.status !== 'ready') throw Error('unreachable');
      expect(pageAfter.value.pointer).toEqual({ noteId: idOf(u2), revision: 2 });
    });
  });
});

describe('S4A N-09 withdrawal of the current understanding', () => {
  it.each(KINDS)('N-09 %s withdrawal keeps the pointer on the withdrawn note', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const run = await f.claimRun('n09');
      const goalAnchor: NoteDraftAnchorV1 = { kind: 'goal', goalId: 's4a-goal' };
      const note = await f.write(f.workCtx(run), understanding(goalAnchor, { topic: 'u' }), 's4a-goal',
        { expectedPointerRevision: null });
      expect(note.status).toBe('accepted');
      const noteId = idOf(note);
      const withdrawn = await f.platform.notes.withdrawNote(f.workCtx(run), { commandId: 's4a-withdraw-n09', noteId,
        expectedVersion: 1, reason: 'superseded by a new direction' });
      expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn' });
      const item = await f.platform.notes.readNote(ctx, { noteId });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.storedState).toBe('withdrawn');
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: { kind: 'goal', goalId: 's4a-goal' },
        limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.pointer).toEqual({ noteId, revision: 1 });
      const other = await f.claimRun('n09-other', 't2');
      const refused = await f.platform.notes.withdrawNote(f.workCtx(other), { commandId: 's4a-withdraw-other', noteId,
        expectedVersion: 2, reason: null });
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    });
  });
});

describe('S4A N-10 review rules (non-scope cases)', () => {
  it.each(KINDS)('N-10 %s a project scribe reviews accepted to reviewed unchanged', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const writer = await f.claimRun('n10-writer');
      const note = await f.write(f.workCtx(writer), general({ topic: 'r1' }), 's4a-goal');
      const noteId = idOf(note);
      const scribe = await f.claimRun('n10-scribe', 't3', 'scribe');
      const reviewed = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-review-1', noteId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(reviewed).toMatchObject({ status: 'done', state: 'reviewed' });
      const item = await f.platform.notes.readNote(ctx, { noteId });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.storedState).toBe('reviewed');
      expect(item.value.confirmedByUser).toBe(false);
      const reject = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-review-2', noteId,
        expectedVersion: 2, expectedPointerRevision: null, verdict: 'reject', reason: 'no' });
      expect(reject).toMatchObject({ status: 'rejected' });
    });
  });

  it.each(KINDS)('N-10 %s a scribe may only disposition a quota_full pending note', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      for (let i = 1; i <= 5; i += 1) {
        await f.write(ctx, general({ topic: `k-${String(i)}`, anchor: FILE_A }), null);
      }
      const agent = await f.claimRun('n10-quota-writer');
      const pending = await f.write(f.workCtx(agent), general({ topic: 'k-6', anchor: FILE_A }), 's4a-goal');
      expect(pending).toMatchObject({ status: 'pending_review', reasons: ['quota_full'] });
      const scribe = await f.claimRun('n10-scribe2', 't3', 'scribe');
      const accepted = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-review-accept',
        noteId: idOf(pending), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '合并后收下' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
      // a second quota_full pending note can be rejected by the scribe
      const pending2 = await f.write(f.workCtx(agent), general({ topic: 'k-7', anchor: FILE_A }), 's4a-goal');
      expect(pending2).toMatchObject({ status: 'pending_review', reasons: ['quota_full'] });
      const rejected = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-review-reject',
        noteId: idOf(pending2), expectedVersion: 1, expectedPointerRevision: null, verdict: 'reject', reason: 'stale' });
      expect(rejected).toMatchObject({ status: 'done', state: 'rejected' });
    });
  });

  it.each(KINDS)('N-10 %s a scribe cannot accept a structural pending note', async kind => {
    await withFixture(kind, {}, async f => {
      const agent = await f.claimRun('n10-structural-writer');
      // C3.4: a general structural note is accepted directly, so the structural
      // pending note is an understanding (which keeps today's behaviour).
      const pending = await f.write(f.workCtx(agent), understanding({ kind: 'goal', goalId: 's4a-goal' },
        { topic: 's1', structural: true }), 's4a-goal', { expectedPointerRevision: null });
      expect(pending).toMatchObject({ status: 'pending_review', reasons: ['structural'] });
      const scribe = await f.claimRun('n10-scribe3', 't3', 'scribe');
      const refused = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-review-structural',
        noteId: idOf(pending), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: null });
      expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
      // the same holds for a declared contradiction
      const old = await f.write(f.ctx(), general({ topic: 'c-old', anchor: FILE_B }), null);
      const contra = await f.write(f.workCtx(agent), general({ topic: 'c-new', anchor: FILE_B, contradicts: [idOf(old)] }), 's4a-goal');
      expect(contra).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
      const refusedContradiction = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-review-contradiction',
        noteId: idOf(contra), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: null });
      expect(refusedContradiction).toMatchObject({ status: 'rejected', code: 'forbidden' });
    });
  });

  it.each(KINDS)('N-10 %s the user accepts a quota_full structural note and it stays accepted overQuota', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      for (let i = 1; i <= 5; i += 1) {
        await f.write(ctx, general({ topic: `u-${String(i)}`, anchor: FILE_A }), null);
      }
      const agent = await f.claimRun('n10-user-accept-writer');
      const pending = await f.write(f.workCtx(agent), general({ topic: 'u-6', anchor: FILE_A, structural: true }), 's4a-goal');
      expect(pending).toMatchObject({ status: 'pending_review', reasons: ['quota_full'] });
      const accepted = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-user-accept',
        noteId: idOf(pending), expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '合并后收下' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted' });
      const item = await f.platform.notes.readNote(ctx, { noteId: idOf(pending) });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.storedState).toBe('accepted');
      expect(item.value.overQuota).toBe(true);
    });
  });

  it.each(KINDS)('N-10 accepting a pending note supersedes its current replaces targets (N-06)', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const g1 = await f.write(ctx, general({ topic: 'r', anchor: FILE_A }), null);
      expect(g1.status).toBe('accepted');
      const g1Id = idOf(g1);
      const g0 = await f.write(ctx, general({ topic: 'r0', anchor: FILE_A }), null);
      expect(g0.status).toBe('accepted');
      const g0Id = idOf(g0);
      const withdrawn = await f.platform.notes.withdrawNote(ctx, { commandId: 's4a-n10-withdraw-g0', noteId: g0Id,
        expectedVersion: 1, reason: '未决已收掉' });
      expect(withdrawn).toMatchObject({ status: 'done', state: 'withdrawn' });
      const agent = await f.claimRun('n10-replaces-agent');
      const g2 = await f.write(f.workCtx(agent), general({ topic: 'r', anchor: FILE_A, structural: true,
        replaces: [g1Id, g0Id] }), 's4a-goal');
      expect(g2).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
      const beforeAccept = await f.platform.notes.readNote(ctx, { noteId: g1Id });
      if (beforeAccept.status !== 'ready') throw Error('unreachable');
      expect(beforeAccept.value.storedState).toBe('accepted');
      // L6/S4-NOTE-05: the accepting commit supersedes the current replaces targets.
      const accepted = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-n10-accept-g2', noteId: idOf(g2),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '收下替换' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted', version: 2 });
      const g1Head = await f.platform.notes.readNote(ctx, { noteId: g1Id });
      if (g1Head.status !== 'ready') throw Error('unreachable');
      expect(g1Head.value.storedState).toBe('superseded');
      expect(g1Head.value.version).toBe(2);
      const g1v2 = await f.platform.notes.readNote(ctx, { noteId: g1Id, version: 2 });
      if (g1v2.status !== 'ready') throw Error('unreachable');
      expect(g1v2.value.storedState).toBe('superseded');
      // G0 is withdrawn, not current: the accepting commit leaves it alone.
      const g0Head = await f.platform.notes.readNote(ctx, { noteId: g0Id });
      if (g0Head.status !== 'ready') throw Error('unreachable');
      expect(g0Head.value.storedState).toBe('withdrawn');
      expect(g0Head.value.version).toBe(2);
    });
  });
});

describe('S4A N-01 malformed input shapes', () => {
  const MODULE_A = { kind: 'module', moduleId: 'A' } as const;
  const malformed = (overrides: Record<string, unknown>): NoteDraftV1 => {
    const base = general({ topic: 'shape' }) as unknown as Record<string, unknown>;
    return { ...base, ...overrides } as unknown as NoteDraftV1;
  };
  it.each(KINDS)('N-01 %s malformed shapes are refused invalid with the draft, never thrown', async kind => {
    await withFixture(kind, {}, async f => {
      const run = await f.claimRun('n01-shape');
      const runCtx = f.workCtx(run);
      const noAnchor = { ...general({ topic: 'shape-1' }) } as unknown as Record<string, unknown>;
      delete noAnchor['anchor'];
      const noUAnchor = understanding({ kind: 'goal', goalId: 's4a-goal' },
        { topic: 'shape-2' }) as unknown as Record<string, unknown>;
      delete noUAnchor['anchor'];
      const noReplaces = { ...general({ topic: 'shape-4', anchor: MODULE_A }) } as unknown as Record<string, unknown>;
      delete noReplaces['replaces'];
      const cases: { label: string; note: unknown; expectedPointerRevision?: unknown; expectedReason?: string }[] = [
        { label: 'no-anchor', note: noAnchor },
        { label: 'understanding-no-anchor', note: noUAnchor },
        { label: 'string-extra', note: malformed({ anchor: MODULE_A, extraAnchors: ['module:A'] }) },
        { label: 'missing-replaces', note: noReplaces },
        { label: 'string-contradicts', note: malformed({ anchor: MODULE_A, contradicts: 'n1' }) },
        { label: 'module-no-id', note: malformed({ anchor: { kind: 'module' } }),
          expectedReason: 'anchor_invalid: anchor.moduleId' },
        { label: 'module-numeric-id', note: malformed({ anchor: { kind: 'module', moduleId: 5 } }) },
        { label: 'unknown-kind', note: malformed({ anchor: MODULE_A, kind: 'note' }) },
        { label: 'string-structural', note: malformed({ anchor: MODULE_A, structural: 'yes' }) },
        { label: 'deleted-false', note: malformed({ anchor: { kind: 'file', path: 'src/a/x.ts', deleted: false } }) },
        { label: 'bad-extra-path', note: malformed({ anchor: MODULE_A,
          extraAnchors: [{ kind: 'project' }, { kind: 'file', path: '../escape.ts' }] }),
          expectedReason: 'anchor_invalid: extraAnchors[1].path' },
        { label: 'string-pointer', note: understanding({ kind: 'goal', goalId: 's4a-goal' },
          { topic: 'shape-11' }), expectedPointerRevision: '1' },
      ];
      for (const testCase of cases) {
        const input = { commandId: `s4a-shape-${testCase.label}`, note: testCase.note as NoteDraftV1,
          expectedPointerRevision: (testCase.expectedPointerRevision ?? null) as number | null, goalId: 's4a-goal' };
        const result = await f.platform.notes.writeNote(runCtx, input);
        expect(result).toMatchObject({ status: 'rejected', code: 'invalid',
          ...(testCase.expectedReason === undefined ? {} : { reason: testCase.expectedReason }) });
        expect((result as unknown as { draft: unknown }).draft).toEqual(input);
      }
      // Cases 3, 4, 5, 8 and 9 hung on module A and wrote nothing.
      const page = await f.platform.notes.listByAnchor(f.ctx(), { anchor: MODULE_A, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toEqual([]);
      // Format before source (L4): a read-only copy with an unknown kind is `invalid`.
      const wrongKind = await f.platform.notes.writeNote(f.queryCtx(), { commandId: 's4a-shape-query',
        note: malformed({ anchor: MODULE_A, kind: 'note' }), expectedPointerRevision: null, goalId: null });
      expect(wrongKind).toMatchObject({ status: 'rejected', code: 'invalid' });
    });
  });
});

describe('S4A N-20 human goalId rules', () => {
  it.each(KINDS)('N-20 %s a human goalId null refuses goal, stage and task anchors', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const taskAnchor: NoteDraftAnchorV1 = { kind: 'task', goalId: 's4a-goal', taskId: 't1' };
      const refusals = [
        { kind: 'goal', goalId: 's4a-goal' },
        { kind: 'stage', goalId: 's4a-goal', stageId: 's1' },
        taskAnchor,
      ] as NoteDraftAnchorV1[];
      for (const anchor of refusals) {
        const result = await f.write(ctx, general({ anchor }), null);
        expect(result).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_goal' });
      }
      const mixed = await f.write(ctx, general({ anchor: { kind: 'module', moduleId: 'A' },
        extraAnchors: [taskAnchor] }), null);
      expect(mixed).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_goal' });
      const understandingResult = await f.write(ctx, understanding({ kind: 'goal', goalId: 's4a-goal' },
        { topic: 'u-null-goal' }), null, { expectedPointerRevision: null });
      expect(understandingResult).toMatchObject({ status: 'rejected', code: 'forbidden', reason: 'anchor_out_of_goal' });
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: taskAnchor, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toEqual([]);
    });
  });

  it.each(KINDS)('N-20 %s a non-null human goalId must name a goal in the project', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const missing = await f.write(ctx, general({ anchor: { kind: 'module', moduleId: 'A' } }), 'no-such-goal');
      expect(missing).toMatchObject({ status: 'rejected', code: 'invalid' });
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: { kind: 'module', moduleId: 'A' }, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toEqual([]);
      // L2a: a valid non-null goalId may still use any goal's anchors.
      const accepted = await f.write(ctx, general({ anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't1' } }), 's4a-goal');
      expect(accepted.status).toBe('accepted');
    });
  });
});

describe('S4A N-13 human repair refusal', () => {
  it.each(KINDS)('N-13 %s a human repair is refused forbidden with the draft and writes nothing', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const input = { commandId: 's4a-n13-human-repair',
        note: general({ kind: 'repair', topic: 'human repair', anchor: { kind: 'module', moduleId: 'A' } }),
        expectedPointerRevision: null, goalId: null };
      const result = await f.platform.notes.writeNote(ctx, input);
      expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect((result as unknown as { draft: unknown }).draft).toEqual(input);
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: { kind: 'module', moduleId: 'A' }, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toEqual([]);
    });
  });
});

describe('S4A N-09 same-Session authorship', () => {
  it.each(KINDS)('N-09 %s a later Run of the same Session is the author and may withdraw', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const { sessionRef } = await f.createSession('n09-same', 'executor');
      const r1 = await f.claimInSession('n09-same-1', sessionRef, 't1', 'executor');
      const written = await f.write(f.workCtx(r1), general({ topic: 'same-session' }), 's4a-goal');
      expect(written.status).toBe('accepted');
      const noteId = idOf(written);
      const execution = await f.platform.executions.readExecution(ctx, r1);
      if (execution.status !== 'ready') throw Error('unreachable');
      const cancelled = await f.platform.controls.submitControl(ctx, { input: { runRef: r1, kind: 'cancel', reason: 'n09' },
        meta: { requestId: 's4a-n09-cancel', expected: [{ ref: r1, revision: execution.value.run.revision }] } });
      expect(cancelled.status).toBe('committed');
      const r2 = await f.claimInSession('n09-same-2', sessionRef, 't2', 'executor');
      const withdrawn = await f.platform.notes.withdrawNote(f.workCtx(r2), { commandId: 's4a-n09-withdraw', noteId,
        expectedVersion: 1, reason: null });
      expect(withdrawn).toMatchObject({ status: 'done', version: 2, state: 'withdrawn' });
      const item = await f.platform.notes.readNote(ctx, { noteId });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.storedState).toBe('withdrawn');
    });
  });
});

describe('S4A N-10 accept and reject reason', () => {
  it.each(KINDS)('N-10 %s accepting or rejecting a pending note requires a reason', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      for (let i = 1; i <= 5; i += 1) await f.write(ctx, general({ topic: `rr-${String(i)}`, anchor: FILE_A }), null);
      const agent = await f.claimRun('n10-reason-agent');
      const pending = await f.write(f.workCtx(agent), general({ topic: 'rr-6', anchor: FILE_A }), 's4a-goal');
      expect(pending).toMatchObject({ status: 'pending_review', reasons: ['quota_full'] });
      const pendingId = idOf(pending);
      const scribe = await f.claimRun('n10-reason-scribe', 't3', 'scribe');
      const noReason = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-rr-null', noteId: pendingId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: null });
      expect(noReason).toMatchObject({ status: 'rejected', code: 'invalid' });
      const blank = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-rr-blank', noteId: pendingId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '   ' });
      expect(blank).toMatchObject({ status: 'rejected', code: 'invalid' });
      const item = await f.platform.notes.readNote(ctx, { noteId: pendingId });
      if (item.status !== 'ready') throw Error('unreachable');
      expect(item.value.storedState).toBe('pending_review');
      expect(item.value.version).toBe(1);
      const accepted = await f.platform.notes.reviewNote(f.workCtx(scribe), { commandId: 's4a-rr-accept', noteId: pendingId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '合并后收下' });
      expect(accepted).toMatchObject({ status: 'done', state: 'accepted', version: 2 });

      // C3.4: a general structural note is accepted directly now; the user's
      // reject-reason path is exercised through a `user_note_replaced` pending note.
      const seed = await f.write(ctx, general({ topic: 'rr-seed', anchor: FILE_B }), null);
      const structural = await f.write(f.workCtx(agent), general({ topic: 'rr-structural', anchor: FILE_B,
        replaces: [idOf(seed)] }), 's4a-goal');
      expect(structural).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
      const userNoReason = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-rr-user-null',
        noteId: idOf(structural), expectedVersion: 1, expectedPointerRevision: null, verdict: 'reject', reason: null });
      expect(userNoReason).toMatchObject({ status: 'rejected', code: 'invalid' });
      const userRejected = await f.platform.notes.reviewNote(ctx, { commandId: 's4a-rr-user-reject',
        noteId: idOf(structural), expectedVersion: 1, expectedPointerRevision: null, verdict: 'reject', reason: '不对' });
      expect(userRejected).toMatchObject({ status: 'done', state: 'rejected' });
    });
  });
});

describe('S4A N-01 fact pointer shapes', () => {
  it.each(KINDS)('N-01 %s a commit fact is stored as a pointer without format checks', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const short = await f.write(ctx, general({ topic: 'fact-short', anchor: FILE_A,
        facts: [{ kind: 'commit', sha: 'abc' }] }), null);
      expect(short.status).toBe('accepted');
      const shortItem = await f.platform.notes.readNote(ctx, { noteId: idOf(short) });
      if (shortItem.status !== 'ready') throw Error('unreachable');
      expect(shortItem.value.storedState).toBe('accepted');
      const upper = await f.write(ctx, general({ topic: 'fact-upper', anchor: FILE_B,
        facts: [{ kind: 'commit', sha: 'A'.repeat(40) }] }), null);
      expect(upper.status).toBe('accepted');
      const upperItem = await f.platform.notes.readNote(ctx, { noteId: idOf(upper) });
      if (upperItem.status !== 'ready') throw Error('unreachable');
      expect(upperItem.value.storedState).toBe('accepted');
    });
  });

  it.each(KINDS)('N-01 %s a commit fact whose sha is not a string is refused', async kind => {
    await withFixture(kind, {}, async f => {
      const ctx = f.ctx();
      const input = { commandId: 's4a-fact-shape',
        note: general({ topic: 'fact-bad', anchor: { kind: 'module', moduleId: 'A' },
          facts: [{ kind: 'commit', sha: 123 }] as never }), expectedPointerRevision: null, goalId: null };
      const result = await f.platform.notes.writeNote(ctx, input);
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect((result as unknown as { draft: unknown }).draft).toEqual(input);
      const page = await f.platform.notes.listByAnchor(ctx, { anchor: { kind: 'module', moduleId: 'A' }, limit: 100, cursor: null });
      if (page.status !== 'ready') throw Error('unreachable');
      expect(page.value.items).toEqual([]);
    });
  });
});
