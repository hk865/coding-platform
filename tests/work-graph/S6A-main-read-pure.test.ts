/**
 * The main read's pure decisions (slice-6-SPEC L6; the R-12 row's rules):
 * which index slots a view reads and in which phase order, where a page cursor
 * resumes, how one page of 20 is cut and its continuation named, which input
 * the read accepts, which cards belong to a request (its rounds' cards and its
 * goal's own cards, the ones with no request) and to a page (deduplicated by
 * `cardKey`), the automatic-rework fold of the main read, and the seen advance a
 * Goal's page allows over the full member set of the workspace.
 *
 * A5: a pure file. Every input is a hand-built value and every expected value is
 * a literal or hand-computed from L6 and the rules the module comments state;
 * nothing reads a store.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { NoticePositionV1 } from '../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { DecisionCardV1, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { groupNotices, noticePage } from '../../src/core/work-graph/views/notice-grouping.js';
import {
  mainPageStep, mainReadPhases, mainReadStart, pageCards, parseMainReadInput, requestCards, type MainReadRowV1,
} from '../../src/core/work-graph/views/main-surface-read-model.js';

/** A commit cursor, hand-encoded: `c` and the sequence in ten digits. */
const at = (sequence: number): CommitCursor => ('c' + String(sequence).padStart(10, '0')) as CommitCursor;
const goal = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: 'p1', goalId });
const job = (queryJobId: string): QueryJobRef => ({ aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId });

function row(phase: 'goal' | 'pre', sequence: number): MainReadRowV1 {
  return { phase, since: at(sequence), rootKey: `root-${String(sequence)}` };
}

function card(cardKey: string, goalId: string, requestRef: QueryJobRef | null): DecisionCardV1 {
  return {
    cardKey, source: { kind: 'candidate', key: cardKey, subject: { kind: 'goal', goalRef: goal(goalId) }, pins: [] },
    state: 'waiting_answer', subject: { kind: 'goal', goalRef: goal(goalId) }, senderSessionRef: null, requestRef,
    objects: [], options: [], answerMessageRef: null,
    answer: null, application: null, candidateStatus: 'candidate', staleReason: null, closedReason: null,
    readOnly: false, actions: ['answer', 'adopt', 'abandon'],
  };
}

function request(rounds: string[], effectiveGoalId: string | null): { rounds: { ref: QueryJobRef }[]; effectiveGoalId: string | null } {
  return { rounds: rounds.map(id => ({ ref: job(id) })), effectiveGoalId };
}

function position(sequence: number, itemKey: string): NoticePositionV1 {
  return { kind: 'commit', cursor: at(sequence), itemKey };
}

function rework(itemKey: string, goalId: string, sequence: number): NoticeItemV1 {
  return {
    itemKey, category: 'automatic_rework', subject: { kind: 'goal', goalRef: goal(goalId) },
    position: position(sequence, itemKey),
    summary: `自动返工 · ${itemKey}`, objects: [{ kind: 'aggregate', pin: { ref: goal(goalId), revision: sequence }, label: itemKey }],
    rework: null,
  };
}

describe('the phases of a view and where a cursor resumes', () => {
  const first = { goalId: 'g1', since: at(5) };

  it('the first goal by creation reads its own slot, then the no-goal roots created before it', () => {
    expect(mainReadPhases({ goalId: 'g1', firstGoal: first })).toEqual([
      { phase: 'goal', goalSlot: 'g:g1', createdBefore: null, createdAfter: null },
      { phase: 'pre', goalSlot: 'no-goal', createdBefore: at(5), createdAfter: null },
    ]);
  });

  it('a later goal reads only its own slot', () => {
    expect(mainReadPhases({ goalId: 'g2', firstGoal: first })).toEqual([
      { phase: 'goal', goalSlot: 'g:g2', createdBefore: null, createdAfter: null },
    ]);
  });

  it('the no-goal view reads the no-goal roots created after the first goal, or all of them with no goal', () => {
    expect(mainReadPhases({ goalId: null, firstGoal: first })).toEqual([
      { phase: 'goal', goalSlot: 'no-goal', createdBefore: null, createdAfter: at(5) },
    ]);
    expect(mainReadPhases({ goalId: null, firstGoal: null })).toEqual([
      { phase: 'goal', goalSlot: 'no-goal', createdBefore: null, createdAfter: null },
    ]);
  });

  it('a cursor resumes in the phase it names; a pre cursor on a view without the section names no phase', () => {
    const firstView = mainReadPhases({ goalId: 'g1', firstGoal: first });
    const laterView = mainReadPhases({ goalId: 'g2', firstGoal: first });
    expect(mainReadStart(firstView, null)).toBe(0);
    expect(mainReadStart(firstView, { phase: 'goal', since: at(9), rootKey: 'root-9' })).toBe(0);
    expect(mainReadStart(firstView, { phase: 'pre', since: at(3), rootKey: 'root-3' })).toBe(1);
    expect(mainReadStart(laterView, { phase: 'pre', since: at(3), rootKey: 'root-3' })).toBeNull();
  });
});

describe('one page of 20', () => {
  it('21 rows: 20 shown, the continuation names the 20th', () => {
    const rows = Array.from({ length: 21 }, (_, index) => row('goal', 30 - index));
    const step = mainPageStep(rows, 20);
    expect(step.shown.map(entry => entry.rootKey)).toEqual(rows.slice(0, 20).map(entry => entry.rootKey));
    expect(step.next).toEqual({ phase: 'goal', since: at(11), rootKey: 'root-11' });
  });

  it('20 rows or fewer: everything shown, no continuation', () => {
    const rows = Array.from({ length: 20 }, (_, index) => row('goal', 30 - index));
    expect(mainPageStep(rows, 20)).toEqual({ shown: rows, next: null });
    expect(mainPageStep([], 20)).toEqual({ shown: [], next: null });
  });

  it('the pre-goal rows count within the 20 and the continuation carries their phase', () => {
    const rows = [
      ...Array.from({ length: 18 }, (_, index) => row('goal', 40 - index)),
      row('pre', 4), row('pre', 3), row('pre', 2),
    ];
    const step = mainPageStep(rows, 20);
    expect(step.shown.map(entry => `${entry.phase}:${entry.rootKey}`).slice(16)).toEqual([
      'goal:root-24', 'goal:root-23', 'pre:root-4', 'pre:root-3',
    ]);
    expect(step.shown).toHaveLength(20);
    expect(step.next).toEqual({ phase: 'pre', since: at(3), rootKey: 'root-3' });
  });
});

describe('the cards of a request and of a page', () => {
  const c1 = card('c1', 'g1', job('r1'));
  const c1Followup = card('c1-followup', 'g1', job('r1-f'));
  const c2 = card('c2', 'g1', job('r2'));
  const goalCause = card('goal-cause', 'g1', null);
  const other = card('other', 'g2', null);
  const noGoalOwn = card('no-goal-own', 'g2', job('n1'));
  const all = [c1, c1Followup, c2, goalCause, other, noGoalOwn];

  it('a goal request: its rounds’ cards and its goal’s own cards, never another request’s', () => {
    expect(requestCards(all, request(['r1', 'r1-f'], 'g1'), 'p1').map(entry => entry.cardKey))
      .toEqual(['c1', 'c1-followup', 'goal-cause']);
  });

  it('a no-goal request: only the cards that name one of its rounds', () => {
    expect(requestCards(all, request(['n1'], null), 'p1').map(entry => entry.cardKey)).toEqual(['no-goal-own']);
    expect(requestCards(all, request(['n2'], null), 'p1')).toEqual([]);
  });

  it('a page lists each card once and its requests reference them by key', () => {
    const page = pageCards(all, [request(['r2'], 'g1'), request(['r1', 'r1-f'], 'g1'), request(['n1'], null)], goal('g1'), 'p1');
    expect(page.cards.map(entry => entry.cardKey)).toEqual(['goal-cause', 'c2', 'c1', 'c1-followup', 'no-goal-own']);
    expect(page.cardKeys).toEqual([
      ['c2', 'goal-cause'],
      ['c1', 'c1-followup', 'goal-cause'],
      ['no-goal-own'],
    ]);
  });

  it('a goal page lists its goal’s own cards even when only no-goal requests are on it', () => {
    const page = pageCards(all, [request(['n1'], null)], goal('g1'), 'p1');
    expect(page.cards.map(entry => entry.cardKey)).toEqual(['goal-cause', 'no-goal-own']);
    expect(page.cardKeys).toEqual([['no-goal-own']]);
  });

  it('the no-goal view adds no goal’s cards of its own', () => {
    const page = pageCards(all, [request(['n2'], null)], null, 'p1');
    expect(page).toEqual({ cards: [], cardKeys: [[]] });
  });
});

describe('the main read input', () => {
  it('a cursor a page returned reads as itself', () => {
    const cursor = { phase: 'pre', since: at(7), rootKey: 'root-7' };
    expect(parseMainReadInput({ goalId: 'g1', cursor })).toEqual({ goalId: 'g1', cursor });
    expect(parseMainReadInput({ goalId: null, cursor: null })).toEqual({ goalId: null, cursor: null });
  });

  describe('rejects: the main read input', () => {
    it('a cursor with an empty root key is refused', () => {
      expect(parseMainReadInput({ goalId: 'g1', cursor: { phase: 'goal', since: at(7), rootKey: '' } }))
        .toBe('main/read requires cursor: null or the next cursor a page returned');
    });
  });
});

describe('the automatic-rework fold of the main read', () => {
  const n1 = rework('n1', 'g1', 10);
  const n2 = rework('n2', 'g2', 11);
  const n3 = rework('n3', 'g1', 12);

  it('one line per goal: "n 条自动返工", its members and their views, at the newest member', () => {
    expect(groupNotices([n1, n2, n3], 'main_conversation')).toEqual([
      { itemKey: 'automatic_rework_group:p1/g2', category: 'automatic_rework', subject: { kind: 'goal', goalRef: goal('g2') },
        position: position(11, 'n2'), summary: '1 条自动返工', objects: n2.objects, rework: null,
        members: [{ itemKey: 'n2', position: position(11, 'n2') }], memberViews: [n2] },
      { itemKey: 'automatic_rework_group:p1/g1', category: 'automatic_rework', subject: { kind: 'goal', goalRef: goal('g1') },
        position: position(12, 'n3'), summary: '2 条自动返工', objects: [...n1.objects, ...n3.objects], rework: null,
        members: [{ itemKey: 'n1', position: position(10, 'n1') }, { itemKey: 'n3', position: position(12, 'n3') }],
        memberViews: [n1, n3] },
    ]);
  });

  it('the queue’s grouping keeps them one by one', () => {
    expect(groupNotices([n1, n2, n3], 'user_affected_per_goal')).toEqual([n1, n2, n3]);
  });
});

describe('the seen advance of a goal’s page', () => {
  const n1 = rework('n1', 'g1', 10);
  const n2 = rework('n2', 'g2', 11);
  const n3 = rework('n3', 'g1', 12);

  it('positions 1 and 3 shown, 2 on another goal: the advance stops at 1', () => {
    const all = groupNotices([n1, n2, n3], 'main_conversation');
    const page = noticePage(all, [{ kind: 'goal', goalRef: goal('g1') }]);
    expect(page.lines.map(line => line.itemKey)).toEqual(['automatic_rework_group:p1/g1']);
    expect(page.seenThrough).toEqual({ automatic_rework: position(10, 'n1') });
  });

  it('the other goal’s page shows 2 but advances nothing while 1 is unseen', () => {
    const all = groupNotices([n1, n2, n3], 'main_conversation');
    expect(noticePage(all, [{ kind: 'goal', goalRef: goal('g2') }]).seenThrough).toEqual({});
  });

  it('a goal with no notice: no line, no advance', () => {
    const all = groupNotices([n1, n2, n3], 'main_conversation');
    expect(noticePage(all, [{ kind: 'goal', goalRef: goal('g3') }])).toEqual({ lines: [], seenThrough: {} });
  });
});
