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

/* GAPA1 1b T9 (frozen card A §1b): the explanation box's action table. Each
   stop action says which of the step's fields the box words go to:
   `note` (requeue, task-level continue, reverify, note), `reason` (attest,
   defer, cancel, restore, fix), or `null` (the Goal-level continue, the
   withdraw, 去主对话说). `noteBox` is true only on `goal_cause` cards that
   carry an action; conflict and candidate cards have no box.
   Today red: `wordsField` and `noteBox` do not exist yet. */
const GAPA_GOAL = { aggregateType: 'Goal' as const, projectId: 'p', goalId: 'g' };
const GAPA_GOAL_PIN = { ref: GAPA_GOAL, revision: 2 };
const GAPA_TASK = { projectId: 'p', goalId: 'g', taskId: 't' };
const GAPA_TASK_PIN = { ref: { aggregateType: 'Task' as const, projectId: 'p', goalId: 'g', taskId: 't' } };

function gapaStopCard(stop: string | null, extra: Partial<DecisionCardV1> = {}): DecisionCardV1 {
  const key = stop === null ? '{"kind":"goal_cause","code":"interrupted_pending_resume"}' : '';
  return makeCard({
    cardKey: 'stop', state: 'waiting_answer', actions: ['answer'], taskRef: GAPA_TASK,
    source: { kind: 'goal_cause', key, subject: { kind: 'goal', goalRef: GAPA_GOAL },
      pins: [GAPA_GOAL_PIN] },
    ...extra,
  });
}

function gapaStopRow(stop: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: GAPA_TASK_PIN.ref, definition: { title: 't', taskKind: 'work' }, effectivePhase: 'blocked',
    disposition: 'active', phaseCause: {},
    failure: {
      automation: { verdict: { kind: 'stopped', reason: stop, detail: { operation: 'reverify' } } },
      requeueActors: ['human'], reverifyActors: ['human'], round: { ordinal: 1 },
    },
    ...extra,
  };
}

function gapaCardView(card: DecisionCardV1, graph: Record<string, unknown> | null): DecideCard {
  const data = adaptDecide({
    ...sourceOf([], graph === null ? {} : { g: graph }),
    queue: [{ ...makeQueue([]), waitingAnswer: [card] }],
  }, { ...UI, tab: 'open', selectedCardKey: card.cardKey });
  if (data.card === null) throw new Error('GAPA1 T9: the stop card did not open');
  return data.card;
}

/** Every action's `wordsField`, primary included. */
function gapaWords(view: DecideCard): Record<string, unknown> {
  const acts = [...view.acts, ...(view.primary === null ? [] : [view.primary])] as
    Array<{ key: string; wordsField?: unknown }>;
  return Object.fromEntries(acts.map((act) => [act.key, act.wordsField]));
}

describe('GAPA1 1b T9 the explanation box action table', () => {
  it.each([
    ['auto_rework_cap_reached', gapaStopCard('auto_rework_cap_reached', { withdrawableChecks: ['c1'] }),
      gapaStopRow('auto_rework_cap_reached'),
      { requeue: 'note', defer: 'reason', cancel: 'reason', fix: 'reason', reverify: 'note', withdraw: null }],
    ['no_new_basis', gapaStopCard('no_new_basis', { withdrawableChecks: ['c1'] }), gapaStopRow('no_new_basis'),
      { note: 'note', requeue: 'note', defer: 'reason', cancel: 'reason', withdraw: null }],
    ['unknown_outcome', gapaStopCard('unknown_outcome'), gapaStopRow('unknown_outcome'),
      { attest: 'reason', defer: 'reason', cancel: 'reason' }],
    ['task_paused', gapaStopCard('task_paused'), gapaStopRow('task_paused'),
      { continue: 'note', cancel: 'reason', defer: 'reason' }],
    ['task_cancelled', gapaStopCard('task_cancelled'), gapaStopRow('task_cancelled'),
      { restore: 'reason', defer: 'reason', cancel: 'reason' }],
    ['verification_uncovered', gapaStopCard('verification_uncovered'), gapaStopRow('verification_uncovered'),
      { speak: null, defer: 'reason', cancel: 'reason' }],
  ] as const)('T9 %s names each action’s words field', (_label, card, row, expected) => {
    /* 具名改坏（每个表项一条，删哪一条哪个表项红）: requeue/note/reverify/continue 改成
       'reason'，attest/defer/cancel/restore/fix 改成 'note'，withdraw/speak 改成 'note'；
       目标级 continue 改成 'note' 时下面那一行红。 */
    expect(gapaWords(gapaCardView(card, { tasks: [row] }))).toEqual(expected);
  });

  it('T9 the Goal-level continue is null and the card keeps a box', () => {
    const view = gapaCardView(gapaStopCard(null), null);
    expect(gapaWords(view)).toEqual({ continue: null });
    expect((view as unknown as { noteBox?: boolean }).noteBox).toBe(true);
  });

  it.each([
    ['a conflict card', makeCard({ cardKey: 'conflict', source: { kind: 'goal_conflict', key: '',
      subject: { kind: 'goal', goalRef: GAPA_GOAL }, pins: [GAPA_GOAL_PIN] } })],
    ['a candidate card', { ...makeCard({ cardKey: 'candidate', actions: ['answer', 'adopt', 'abandon'],
      source: { kind: 'candidate', key: 'candidate', subject: { kind: 'goal', goalRef: GAPA_GOAL },
        pins: [GAPA_GOAL_PIN] } }), candidateStatus: 'candidate' } as unknown as DecisionCardV1],
  ] as const)('T9 %s has no explanation box', (_label, card) => {
    const view = gapaCardView(card, null);
    expect((view as unknown as { noteBox?: boolean }).noteBox).toBe(false);
  });
});

/* GAPA1 1a T4 (frozen card A §1a): the stale candidate still draws 采用, greyed,
   with one of the four reason sentences as its tip. One entry per literal; each
   entry fails alone when the mapping falls back to 已过期.
   具名改坏: 把 `staleReason` 原样当提示 → 前三条红；把每条都写“已过期” → 第四条之外全红。 */
describe('GAPA1 1a T4 the stale candidate tip', () => {
  it.each([
    ['basedOn is not the active Plan pointer', '计划已经变了，这份候选不能直接采用'],
    ['来源已撤回', '来源已撤回'],
    ['来源不可读', '来源暂时读不到'],
    ['something else', '已过期'],
  ] as const)('T4 %s reads as %s', (reason, tip) => {
    const goalRef = { aggregateType: 'Goal' as const, projectId: 'p', goalId: 'g' };
    const card = {
      ...makeCard({ cardKey: 'candidate', state: 'waiting_answer', actions: ['answer', 'regenerate', 'abandon'],
        source: { kind: 'candidate', key: 'candidate', subject: { kind: 'goal', goalRef },
          pins: [{ ref: goalRef, revision: 2 },
            { ref: { aggregateType: 'PlanProposal', projectId: 'p', workspaceId: 'w', proposalId: 'proposal-1' },
              revision: 3 }] } }),
      candidateStatus: 'stale', staleReason: reason,
    } as unknown as DecisionCardV1;
    const data = adaptDecide({ ...sourceOf([]),
      queue: [{ ...makeQueue([]), waitingAnswer: [card] }] },
    { ...UI, tab: 'open', selectedCardKey: 'candidate' });
    const view = data.card as DecideCard;
    const adopt = [...view.acts, ...(view.primary === null ? [] : [view.primary])]
      .find((act) => act.label === '采用');
    expect(adopt, 'the stale candidate still draws 采用').toBeDefined();
    expect(adopt!.off).toBe('true');
    expect(adopt!.tip).toBe(tip);
  });
});
