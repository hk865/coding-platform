import { describe, expect, it } from 'vitest';
import { adaptDecide, cardReplyOf, needsOption, type DecideCard, type DecideSource, type DecideUi, type DecisionCardV1, type DecisionQueueReadV1 } from '../../src/ui/adapters/decide.js';
import type { NavData } from '../../src/ui/adapters/nav.js';

/** D48-1, D49-16 and Y13's “已答复、待落实” split, on hand-built route values. */
const UI: DecideUi = { tab: 'done', goalFilter: null, selectedCardKey: null, factsOpen: false,
  step: null, form: {}, lineKey: null };
const makeCard = (overrides: Partial<DecisionCardV1>): DecisionCardV1 => ({
  cardKey: 'card', source: { kind: 'goal_cause', key: '', subject: { kind: 'goal',
    goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' } }, pins: [] },
  state: 'closed', subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' } },
  senderSessionRef: null, requestRef: null, objects: [], options: [], answer: null, application: null,
  openedAt: null, taskRef: null, runRef: null, readOnly: false, actions: ['answer'], closedReason: null,
  ...overrides,
});
const makeQueue = (cards: DecisionCardV1[]): DecisionQueueReadV1 => ({
  waitingAnswer: [], answeredPendingApplication: [], history: cards, notices: [],
  counts: { waitingAnswer: 0, answeredPendingApplication: cards.length, notices: {} }, countsComplete: true,
  nextCursor: null, sourceCursor: null, seenThrough: {}, displayToken: null, capabilities: [],
});
const sourceOf = (cards: DecisionCardV1[], tasks: Record<string, unknown> = {}): DecideSource => ({
  nav: { goals: [], lines: [], archived: [] } as unknown as NavData,
  scope: { projectId: 'p', workspaceId: 'w' }, workspaceRevision: 1, queue: [makeQueue(cards)], tasks,
  selectedGoalId: null,
});

describe('E3D-15 cards', () => {
  it('D48-1 a closed card says why it closed', () => {
    const data = adaptDecide(sourceOf([makeCard({ cardKey: 'closed', closedReason: 'source_resolved' })]), UI);
    expect(data.history[0]!.sub).toBe('已关闭：来源已解决');
    const cancelled = adaptDecide(sourceOf([makeCard({ cardKey: 'cancelled', closedReason: 'goal_cancelled' })]), UI);
    expect(cancelled.history[0]!.sub).toBe('已关闭：目标已取消');
  });

  it('Y13 the done tab splits 已答复、待落实 before 已处理', () => {
    const data = adaptDecide(sourceOf([
      makeCard({ cardKey: 'pending', state: 'answered_pending_application' }),
      makeCard({ cardKey: 'applied', state: 'applied' }),
    ]), UI);
    expect(data.sections.map((section) => section.name)).toEqual(['已答复、待落实', '已处理']);
    expect(data.history).toHaveLength(2);
  });

  it.each([
    ['planning_question', false],
    ['action_release', true],
    ['goal_conflict', true],
  ] as const)('Y7 needsOption follows the server for %s', (kind, expected) => {
    const card = makeCard({
      source: { kind, key: '', subject: { kind: 'goal',
        goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' } }, pins: [] },
      options: [{ id: 'approve', label: '批准', effect: 'apply' }],
    });
    expect(needsOption(card)).toBe(expected);
  });

  /* Lead 11-25: one cardReplyOf for Decide and the main card; the server refuses
     an annotation on a conflict card, so it gets the words box only. */
  it.each([
    ['goal_conflict', 0],
    ['structural_proposal', 1],
  ] as const)('Y11 cardReplyOf gives %s %i annotation fields', (kind, fields) => {
    const card = makeCard({
      source: { kind, key: '', subject: { kind: 'goal',
        goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' } }, pins: [] },
      objects: [{ kind: 'file', workspace: { projectId: 'p', workspaceId: 'w' }, path: 'src/a.ts', digest: null, label: 'src/a.ts' }],
    });
    expect(cardReplyOf(card).annotations).toHaveLength(fields);
  });

  it('D49-16 a release card from an older plan reads stale and says the current plan', () => {
    const release = makeCard({
      cardKey: 'release', state: 'waiting_answer', closedReason: null,
      source: { kind: 'action_release', key: '', subject: { kind: 'goal',
        goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' } }, pins: [] },
      taskRef: { projectId: 'p', goalId: 'g', taskId: 't' },
      options: [{ id: 'approve', label: '批准', effect: 'apply' }, { id: 'deny', label: '拒绝', effect: 'reject' }],
      actions: ['answer'], actionRelease: { action: 'dispatch',
        requester: { session: { projectId: 'p', sessionId: 's' }, duty: 'adviser' }, reason: 'go',
        planVersion: { planRevision: 2 }, preferredLine: null, stopRun: null, blockedBy: [],
        targetLoopBlockers: 'not_read', claimedPlanRef: null },
    });
    const data = adaptDecide({
      ...sourceOf([], { g: { plan: { planRevision: 3 } } }),
      queue: [{ ...makeQueue([]), waitingAnswer: [release] }],
    }, { ...UI, tab: 'open', selectedCardKey: 'release' });
    const view = data.card as DecideCard;
    expect(view.stale).toBe(true);
    expect(view.facts.find((fact) => fact.k === '请求时的计划版本')?.v)
      .toBe('计划第 2 版（已过期：现在是计划第 3 版）');
    const same = adaptDecide({
      ...sourceOf([], { g: { plan: { planRevision: 2 } } }),
      queue: [{ ...makeQueue([]), waitingAnswer: [release] }],
    }, { ...UI, tab: 'open', selectedCardKey: 'release' });
    expect((same.card as DecideCard).stale).toBe(false);
    expect((same.card as DecideCard).facts.find((fact) => fact.k === '请求时的计划版本')?.v).toBe('计划第 2 版');
  });
});
