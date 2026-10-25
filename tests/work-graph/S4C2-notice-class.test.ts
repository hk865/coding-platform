/**
 * S4C2-U9-adjacent: the pure `noticeClass` classification (task book §2 item 5,
 * lead ruling 7 precedence user_affected > structural > scribe_result) and the
 * `newNoteVersionRecord` fourth argument. Expected values are hand-computed
 * literals from the book; nothing is recomputed the way the module computes it.
 */
import { describe, expect, it } from 'vitest';
import type { NoteHeadSnapshot, NoteSourceV1, NoteVersionSnapshot } from '../../src/contracts/note.js';
import {
  newNoteVersionRecord,
  noticeClassOf,
  type NoteNoticeClassFactsV1,
} from '../../src/core/work-graph/state/note-machine.js';

const USER: NoteSourceV1 = { kind: 'user', principalId: 'u1' };
const EXECUTOR: NoteSourceV1 = {
  kind: 'agent', sessionRef: { projectId: 'p1', sessionId: 's-exec' }, runRef: null, queryRunRef: null, duty: 'executor' };
const SCRIBE: NoteSourceV1 = {
  kind: 'agent', sessionRef: { projectId: 'p1', sessionId: 's-scribe' }, runRef: null, queryRunRef: null, duty: 'scribe' };
const PLATFORM: NoteSourceV1 = { kind: 'platform' };

type ChangeKind = NoteVersionSnapshot['change']['kind'];
function change(kind: ChangeKind, by: NoteSourceV1): NoteVersionSnapshot['change'] {
  return { kind, by, reason: null, decisionMessageRef: null };
}
function facts(input: {
  kind: ChangeKind; by: NoteSourceV1; state?: NoteHeadSnapshot['state']; noteKind?: NoteHeadSnapshot['kind'];
  structural?: boolean; userAffected?: boolean; sideEffect?: boolean;
}): NoteNoticeClassFactsV1 {
  return {
    change: change(input.kind, input.by),
    state: input.state ?? 'accepted',
    kind: input.noteKind ?? 'pitfall',
    structural: input.structural ?? false,
    userAffected: input.userAffected ?? false,
    sideEffect: input.sideEffect ?? false,
  };
}

describe('S4C2-U9 noticeClassOf', () => {
  it('S4C2-U9 a user write and a user disposition are never notices', () => {
    expect(noticeClassOf(facts({ kind: 'write', by: USER }))).toBeNull();
    expect(noticeClassOf(facts({ kind: 'withdraw', by: USER }))).toBeNull();
    expect(noticeClassOf(facts({ kind: 'accept', by: USER, structural: true }))).toBeNull();
  });

  it('S4C2-U9 a platform version is never a notice', () => {
    expect(noticeClassOf(facts({ kind: 'accept', by: PLATFORM }))).toBeNull();
  });

  it('S4C2-U9 a plain executor write and a review are not notices', () => {
    expect(noticeClassOf(facts({ kind: 'write', by: EXECUTOR }))).toBeNull();
    expect(noticeClassOf(facts({ kind: 'review', by: SCRIBE }))).toBeNull();
    expect(noticeClassOf(facts({ kind: 'review', by: EXECUTOR }))).toBeNull();
  });

  it('S4C2-U9 an agent structural ordinary accepted write is structural', () => {
    expect(noticeClassOf(facts({ kind: 'write', by: EXECUTOR, structural: true }))).toBe('structural');
    expect(noticeClassOf(facts({ kind: 'accept', by: SCRIBE, structural: true }))).toBe('structural');
    expect(noticeClassOf(facts({ kind: 'write', by: EXECUTOR, structural: true, noteKind: 'understanding' })))
      .toBeNull();
    expect(noticeClassOf(facts({ kind: 'write', by: EXECUTOR, structural: false }))).toBeNull();
  });

  it('S4C2-U9 a scribe accept, reject, withdraw, supersede or coexist is scribe_result', () => {
    expect(noticeClassOf(facts({ kind: 'accept', by: SCRIBE }))).toBe('scribe_result');
    expect(noticeClassOf(facts({ kind: 'reject', by: SCRIBE, state: 'rejected' }))).toBe('scribe_result');
    expect(noticeClassOf(facts({ kind: 'withdraw', by: SCRIBE, state: 'withdrawn' }))).toBe('scribe_result');
    expect(noticeClassOf(facts({ kind: 'supersede', by: SCRIBE, state: 'superseded' }))).toBe('scribe_result');
    expect(noticeClassOf(facts({ kind: 'coexist', by: SCRIBE }))).toBe('scribe_result');
    expect(noticeClassOf(facts({ kind: 'merge', by: SCRIBE }))).toBe('scribe_result');
  });

  it('S4C2-U9 a side-effect target version carries no class', () => {
    expect(noticeClassOf(facts({ kind: 'supersede', by: SCRIBE, state: 'superseded', sideEffect: true }))).toBeNull();
    expect(noticeClassOf(facts({ kind: 'withdraw', by: SCRIBE, state: 'withdrawn', sideEffect: true }))).toBeNull();
  });

  it('S4C2-U9 replacing a user note is user_affected and outranks structural', () => {
    expect(noticeClassOf(facts({ kind: 'write', by: EXECUTOR, userAffected: true }))).toBe('user_affected');
    expect(noticeClassOf(facts({ kind: 'accept', by: SCRIBE, userAffected: true }))).toBe('user_affected');
    expect(noticeClassOf(facts({ kind: 'withdraw', by: EXECUTOR, userAffected: true, state: 'withdrawn' })))
      .toBe('user_affected');
    expect(noticeClassOf(facts({ kind: 'write', by: EXECUTOR, structural: true, userAffected: true })))
      .toBe('user_affected');
    expect(noticeClassOf(facts({ kind: 'accept', by: SCRIBE, structural: true, userAffected: true })))
      .toBe('user_affected');
  });
});

describe('S4C2-U9 newNoteVersionRecord noticeClass', () => {
  const head = {
    kind: 'pitfall', topic: 't', topicKey: 't', conclusion: 'c', body: 'b', anchor: { kind: 'project' },
    extraAnchors: [], facts: [], basis: { planRevision: null, catalogRevision: null, files: [] }, structural: false,
    replaces: [], contradicts: [], coexistWith: [], ref: { aggregateType: 'NoteHead', projectId: 'p1', noteId: 'n1' },
    noteId: 'n1', version: 2, state: 'accepted', goalId: 'g1', source: EXECUTOR, stagedRunKey: null,
    reviewReasons: [], confirmedByUser: false, anchorKey0: 'project', anchorKey1: null, anchorKey2: null,
    anchorKey3: null, anchorKey4: null, createdAt: '2026-01-01T00:00:00.000Z', since: null,
  } as unknown as Parameters<typeof newNoteVersionRecord>[0];
  const change: NoteVersionSnapshot['change'] = { kind: 'accept', by: SCRIBE, reason: 'r', decisionMessageRef: null };

  it('S4C2-U9 writes the given class and defaults to null', () => {
    expect(newNoteVersionRecord(head, change, '2026-01-01T00:00:01.000Z', 'scribe_result').noticeClass)
      .toBe('scribe_result');
    expect(newNoteVersionRecord(head, change, '2026-01-01T00:00:01.000Z').noticeClass).toBeNull();
    expect(newNoteVersionRecord(head, { ...change, kind: 'write', by: USER }, 'at', null).noticeClass).toBeNull();
  });
});
