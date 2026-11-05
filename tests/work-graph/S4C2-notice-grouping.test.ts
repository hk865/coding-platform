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
  type NoticeLineV1,
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
    itemKey: input.itemKey, category: input.category, subject: { kind: 'goal', goalRef: input.goalRef },
    position: pos(input.n, input.itemKey), summary: input.itemKey,
    objects: input.objects ?? [], rework: null,
    ...(input.noteClass === undefined ? {} : { noteClass: input.noteClass }),
  };
}

/** The same notice with the project subject (a goal-less note's notice). */
function projectItem(input: {
  itemKey: string; category: NoticeCategoryV1; n: number;
  noteClass?: 'user_affected' | 'structural' | 'scribe_result';
  objects?: DecisionObjectV1[];
}): NoticeItemV1 {
  return {
    itemKey: input.itemKey, category: input.category,
    subject: { kind: 'project', projectRef: { projectId: 'p1' } },
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
      itemKey: 'note_review_scribe:p1/g1', category: 'note_review', subject: { kind: 'goal', goalRef: g1 },
      position: pos(6, 's3'), summary: '书记整理 · 3 条注记',
      objects: [object('s1.ts'), object('s2.ts'), object('s3.ts')], rework: null,
      members: [
        { itemKey: 's1', position: pos(4, 's1') },
        { itemKey: 's2', position: pos(5, 's2') },
        { itemKey: 's3', position: pos(6, 's3') },
      ],
    };
    const foldedG2: NoticeItemV1 = {
      itemKey: 'note_review_scribe:p1/g2', category: 'note_review', subject: { kind: 'goal', goalRef: g2 },
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

  it('S4C2-N2b folds a project’s scribe results into one project line, apart from a Goal’s', () => {
    const g1 = goal('g1');
    const projectSubject = { kind: 'project' as const, projectRef: { projectId: 'p1' } };
    const p1 = projectItem({ itemKey: 'ps1', category: 'note_review', n: 1, noteClass: 'scribe_result', objects: [object('ps1.ts')] });
    const p2 = projectItem({ itemKey: 'ps2', category: 'note_review', n: 2, noteClass: 'scribe_result', objects: [object('ps2.ts')] });
    const g1Line = item({ itemKey: 'gs1', category: 'note_review', goalRef: g1, n: 3, noteClass: 'scribe_result', objects: [object('gs1.ts')] });

    const foldedProject: NoticeItemV1 = {
      itemKey: 'note_review_scribe_project:p1', category: 'note_review', subject: projectSubject,
      position: pos(2, 'ps2'), summary: '书记整理 · 2 条注记',
      objects: [object('ps1.ts'), object('ps2.ts')], rework: null,
      members: [
        { itemKey: 'ps1', position: pos(1, 'ps1') },
        { itemKey: 'ps2', position: pos(2, 'ps2') },
      ],
    };
    const foldedGoal: NoticeItemV1 = {
      itemKey: 'note_review_scribe:p1/g1', category: 'note_review', subject: { kind: 'goal', goalRef: g1 },
      position: pos(3, 'gs1'), summary: '书记整理 · 1 条注记',
      objects: [object('gs1.ts')], rework: null,
      members: [{ itemKey: 'gs1', position: pos(3, 'gs1') }],
    };

    const grouped = groupNotices([p1, p2, g1Line], 'user_affected_per_goal');
    expect(grouped).toEqual([foldedProject, foldedGoal]);
    expect(grouped.map(line => line.itemKey))
      .toEqual(['note_review_scribe_project:p1', 'note_review_scribe:p1/g1']);
    expect(grouped[0]!.subject).toEqual(projectSubject);
  });

  it('S4C2-N2c keeps a project’s own-line notice as its own line', () => {
    const userLine = projectItem({ itemKey: 'pu', category: 'note_review', n: 1, noteClass: 'user_affected' });
    const structuralLine = projectItem({ itemKey: 'pst', category: 'note_review', n: 2, noteClass: 'structural' });
    const absentLine = projectItem({ itemKey: 'pa', category: 'note_review', n: 3 });
    const scribeLine = projectItem({ itemKey: 'ps', category: 'note_review', n: 4, noteClass: 'scribe_result' });
    const folded: NoticeItemV1 = {
      itemKey: 'note_review_scribe_project:p1', category: 'note_review',
      subject: { kind: 'project', projectRef: { projectId: 'p1' } },
      position: pos(4, 'ps'), summary: '书记整理 · 1 条注记', objects: [], rework: null,
      members: [{ itemKey: 'ps', position: pos(4, 'ps') }],
    };

    const grouped = groupNotices([userLine, structuralLine, absentLine, scribeLine], 'user_affected_per_goal');
    expect(grouped).toEqual([userLine, structuralLine, absentLine, folded]);
    expect(grouped[0]).not.toHaveProperty('members');
    expect(grouped[1]).not.toHaveProperty('members');
    expect(grouped[2]).not.toHaveProperty('members');
  });

  it('S4C2-N2d keeps the project fold of project "x" apart from the fold of Goal "x" in project "project"', () => {
    const goalLine: NoticeItemV1 = { itemKey: 'gx', category: 'note_review',
      subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: 'project', goalId: 'x' } },
      position: pos(1, 'gx'), summary: 'gx', objects: [], rework: null, noteClass: 'scribe_result' };
    const projectLine: NoticeItemV1 = { itemKey: 'px', category: 'note_review',
      subject: { kind: 'project', projectRef: { projectId: 'x' } },
      position: pos(2, 'px'), summary: 'px', objects: [], rework: null, noteClass: 'scribe_result' };
    expect(groupNotices([goalLine, projectLine], 'user_affected_per_goal').map((line) => line.itemKey))
      .toEqual(['note_review_scribe:project/x', 'note_review_scribe_project:x']);
  });
});

describe('S4C2-N3 seenThroughOfNotices over shown members', () => {
  const g1 = goal('g1');
  const p1 = pos(1, 'a1');
  const p3 = pos(3, 'a3');
  const all: NoticeItemV1[] = [
    item({ itemKey: 'a1', category: 'note_review', goalRef: g1, n: 1, noteClass: 'scribe_result' }),
    item({ itemKey: 'a2', category: 'note_review', goalRef: g1, n: 2 }),
    item({ itemKey: 'a3', category: 'note_review', goalRef: g1, n: 3, noteClass: 'scribe_result' }),
  ];
  const lineAt2: NoticeItemV1 = item({ itemKey: 'a2', category: 'note_review', goalRef: g1, n: 2 });
  const foldedLine13: NoticeItemV1 = {
    itemKey: 'note_review_scribe:p1/g1', category: 'note_review', subject: { kind: 'goal', goalRef: g1 },
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

  it('S4C2-N4c advances a project line over the project members it shows, like a Goal’s', () => {
    const projectAll: NoticeItemV1[] = [
      projectItem({ itemKey: 'q1', category: 'note_review', n: 1, noteClass: 'scribe_result' }),
      projectItem({ itemKey: 'q2', category: 'note_review', n: 2 }),
      projectItem({ itemKey: 'q3', category: 'note_review', n: 3, noteClass: 'scribe_result' }),
    ];
    const projectLineAt2 = projectAll[1]!;
    const foldedProject: NoticeItemV1 = {
      itemKey: 'note_review_scribe_project:p1', category: 'note_review',
      subject: { kind: 'project', projectRef: { projectId: 'p1' } },
      position: pos(3, 'q3'), summary: '书记整理 · 2 条注记', objects: [], rework: null,
      members: [{ itemKey: 'q1', position: pos(1, 'q1') }, { itemKey: 'q3', position: pos(3, 'q3') }],
    };
    expect(seenThroughOfNotices(projectAll, [projectLineAt2, foldedProject])).toEqual({ note_review: pos(3, 'q3') });
    expect(seenThroughOfNotices(projectAll, [projectLineAt2])).toEqual({});
  });
});

describe('S4C2-N5 groupNotices summary (7D2 O3a)', () => {
  // v4 :4412–:4416, :4426–:4452, :4458–:4459; book :872–:876. T15 is 900 000 ms after T0, T15x 900 001 ms.
  const T0 = '2026-11-04T08:00:00.000Z';
  const T15 = '2026-11-04T08:15:00.000Z';
  const T15x = '2026-11-04T08:15:00.001Z';
  const T5 = '2026-11-04T08:05:00.000Z';
  const P = '{"kind":"project","projectRef":{"projectId":"p1"}}';
  const a = projectItem({ itemKey: 'pa', category: 'project_notice', n: 1 });
  const b = projectItem({ itemKey: 'pb', category: 'project_notice', n: 2 });
  const c = projectItem({ itemKey: 'pc', category: 'project_notice', n: 3 });
  const g = item({ itemKey: 'pg', category: 'project_notice', goalRef: goal('g1'), n: 2 });
  const m = item({ itemKey: 'm1', category: 'member_notice', goalRef: goal('g1'), n: 1 });

  const ab: NoticeLineV1 = {
    itemKey: `notice_summary:${P}:pa`, category: 'project_notice',
    subject: { kind: 'project', projectRef: { projectId: 'p1' } },
    position: pos(2, 'pb'), summary: '2 条自动调整', objects: [], rework: null,
    members: [{ itemKey: 'pa', position: pos(1, 'pa') }, { itemKey: 'pb', position: pos(2, 'pb') }],
    memberViews: [a, b],
  };

  /* Named mutation: the boundary uses `>=` (exactly 900 000 ms also opens a new window) → items 1, 2 go red. */
  it.each<[n: number, name: string, items: NoticeItemV1[], at: [string, string][], expected: NoticeLineV1[]]>([
    [1, '同类同主体在窗口内合成一行；正好 900 000 毫秒仍在前一个窗口', [a, b], [['pa', T0], ['pb', T15]], [ab]],
    [2, '超过 900 000 毫秒开新窗口（从窗口第一条算）', [a, b, c], [['pa', T0], ['pb', T15], ['pc', T15x]], [ab, c]],
    [3, '不同主体各自成窗', [a, g], [['pa', T0], ['pg', T5]], [a, g]],
    [4, '没有时间的原样一行', [m], [], [m]],
  ])('S4C2-N5 O3a-R4 #%s %s', (_n, _name, items, at, expected) => {
    expect(groupNotices(items, 'summary', new Map(at))).toEqual(expected);
  });
});
