/**
 * S4C2-N1..N4: the pure U9 notice grouping and the lead ruling 8 seenThrough
 * advance (slice 4C-2). Every expected value is a hand-computed literal from
 * the task book; nothing is recomputed the way the module computes it.
 */
import { describe, expect, it } from 'vitest';
import type {
  DecisionObjectV1,
  NoticeCategoryV1,
  NoticePositionV1,
} from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import {
  groupNotices,
  seenThroughOfNotices,
} from '../../src/core/work-graph/views/notice-grouping.js';

const goal = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: 'p1', goalId });
const pos = (n: number, itemKey: string): NoticePositionV1 =>
  ({ kind: 'commit', cursor: makeCommitCursor(n), itemKey });

function item(input: {
  itemKey: string; category: NoticeCategoryV1; goalRef: GoalRef; n: number;
  noteClass?: 'user_affected' | 'structural' | 'scribe_result';
  objects?: DecisionObjectV1[];
}): NoticeItemV1 {
  return {
    itemKey: input.itemKey, category: input.category, goalRef: input.goalRef,
    position: pos(input.n, input.itemKey), summary: input.itemKey,
    objects: input.objects ?? [], rework: null,
    ...(input.noteClass === undefined ? {} : { noteClass: input.noteClass }),
  };
}

const object = (path: string): DecisionObjectV1 =>
  ({ kind: 'file', workspace: { projectId: 'p1', workspaceId: 'w1' }, path, digest: null, label: path });

describe('S4C2-N1 groupNotices pass_through', () => {
  it('S4C2-N1 returns the items unchanged', () => {
    const goalRef = goal('g1');
    const items: NoticeItemV1[] = [
      item({ itemKey: 'm1', category: 'member_notice', goalRef, n: 1 }),
      item({ itemKey: 'n1', category: 'note_review', goalRef, n: 2, noteClass: 'scribe_result' }),
    ];
    expect(groupNotices(items, 'pass_through')).toEqual(items);
  });
});

describe('S4C2-N2 groupNotices user_affected_per_goal', () => {
  it('S4C2-N2 keeps own-line notes, folds scribe results per goal and passes other categories through', () => {
    const g1 = goal('g1');
    const g2 = goal('g2');
    const userLine = item({ itemKey: 'n1', category: 'note_review', goalRef: g1, n: 1, noteClass: 'user_affected' });
    const structuralLine = item({ itemKey: 'n2', category: 'note_review', goalRef: g1, n: 2, noteClass: 'structural' });
    const absentLine = item({ itemKey: 'n3', category: 'note_review', goalRef: g1, n: 3 });
    const s1 = item({ itemKey: 's1', category: 'note_review', goalRef: g1, n: 4, noteClass: 'scribe_result', objects: [object('s1.ts')] });
    const s2 = item({ itemKey: 's2', category: 'note_review', goalRef: g1, n: 5, noteClass: 'scribe_result', objects: [object('s2.ts')] });
    const s3 = item({ itemKey: 's3', category: 'note_review', goalRef: g1, n: 6, noteClass: 'scribe_result', objects: [object('s3.ts')] });
    const t1 = item({ itemKey: 't1', category: 'note_review', goalRef: g2, n: 7, noteClass: 'scribe_result', objects: [object('t1.ts')] });
    const member = item({ itemKey: 'm1', category: 'member_notice', goalRef: g1, n: 8 });

    const foldedG1: NoticeItemV1 = {
      itemKey: 'note_review_scribe:p1/g1', category: 'note_review', goalRef: g1,
      position: pos(6, 's3'), summary: '书记整理 · 3 条注记',
      objects: [object('s1.ts'), object('s2.ts'), object('s3.ts')], rework: null,
      members: [
        { itemKey: 's1', position: pos(4, 's1') },
        { itemKey: 's2', position: pos(5, 's2') },
        { itemKey: 's3', position: pos(6, 's3') },
      ],
    };
    const foldedG2: NoticeItemV1 = {
      itemKey: 'note_review_scribe:p1/g2', category: 'note_review', goalRef: g2,
      position: pos(7, 't1'), summary: '书记整理 · 1 条注记',
      objects: [object('t1.ts')], rework: null,
      members: [{ itemKey: 't1', position: pos(7, 't1') }],
    };

    const grouped = groupNotices(
      [userLine, structuralLine, absentLine, s1, s2, s3, t1, member],
      'user_affected_per_goal',
    );
    expect(grouped).toEqual([userLine, structuralLine, absentLine, foldedG1, foldedG2, member]);
    expect(grouped[0]).not.toHaveProperty('members');
    expect(grouped[1]).not.toHaveProperty('members');
    expect(grouped[2]).not.toHaveProperty('members');
    expect(grouped[5]).not.toHaveProperty('members');
  });
});

describe('S4C2-N3 seenThroughOfNotices over shown members', () => {
  const g1 = goal('g1');
  const p1 = pos(1, 'a1');
  const p2 = pos(2, 'a2');
  const p3 = pos(3, 'a3');
  const all: NoticeItemV1[] = [
    item({ itemKey: 'a1', category: 'note_review', goalRef: g1, n: 1, noteClass: 'scribe_result' }),
    item({ itemKey: 'a2', category: 'note_review', goalRef: g1, n: 2 }),
    item({ itemKey: 'a3', category: 'note_review', goalRef: g1, n: 3, noteClass: 'scribe_result' }),
  ];
  const lineAt2: NoticeItemV1 = item({ itemKey: 'a2', category: 'note_review', goalRef: g1, n: 2 });
  const foldedLine13: NoticeItemV1 = {
    itemKey: 'note_review_scribe:p1/g1', category: 'note_review', goalRef: g1,
    position: p3, summary: '书记整理 · 2 条注记', objects: [], rework: null,
    members: [{ itemKey: 'a1', position: p1 }, { itemKey: 'a3', position: p3 }],
  };

  it('S4C2-N3 advances to the highest member position when every member at or below it is shown', () => {
    expect(seenThroughOfNotices(all, [lineAt2, foldedLine13])).toEqual({ note_review: p3 });
  });

  it('S4C2-N4 leaves the category absent when an earlier member is not shown', () => {
    expect(seenThroughOfNotices(all, [lineAt2])).toEqual({});
  });

  it('S4C2-N4b falls back to the last displayed position for a category without members', () => {
    const m1 = item({ itemKey: 'm1', category: 'member_notice', goalRef: g1, n: 9 });
    expect(seenThroughOfNotices([m1], [m1])).toEqual({ member_notice: pos(9, 'm1') });
  });
});
