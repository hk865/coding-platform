/**
 * D6 (Q frozen row; 121-146/R6 U1-U2): `adaptDecide` names the sources this read could not read, with the card
 * words, and `counts.complete` follows the card-source rule, not the queue's `countsComplete`. A notice source that
 * is not connected is not "unreadable"; `note_review` is a card here even though it is also a notice category.
 * Today the row is red because `unreadable` does not exist and `counts.complete` still copies `countsComplete`.
 */
import { describe, expect, it } from 'vitest';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { adaptDecide, type DecideSource, type DecideUi } from '../../src/ui/adapters/decide.js';
import type { NavData } from '../../src/ui/adapters/nav.js';

type Capabilities = DecisionQueueReadV1['capabilities'];

function sourceOf(capabilities: Capabilities): DecideSource {
  return {
    nav: { goals: [] } as unknown as NavData,
    scope: { projectId: 'q-d6-p', workspaceId: 'q-d6-w' },
    workspaceRevision: 1,
    queue: [{
      waitingAnswer: [], answeredPendingApplication: [], history: [], notices: [],
      counts: { waitingAnswer: 0, answeredPendingApplication: 0, notices: {} }, countsComplete: false,
      nextCursor: null, sourceCursor: null, seenThrough: {}, displayToken: null,
      capabilities,
    }],
    tasks: {},
    selectedGoalId: null,
  };
}

const UI: DecideUi = { tab: 'open', goalFilter: null, selectedCardKey: null, factsOpen: false,
  step: null, form: {}, lineKey: null };

describe('D6 adaptDecide unreadable sources and count completeness', () => {
  it.each<{ name: string; capabilities: Capabilities; unreadable: string[]; complete: boolean }>([
    { name: 'a failed card source plus a disconnected notice source',
      capabilities: [{ source: 'candidate', availability: 'read_failed', reason: 'injected' },
        { source: 'second_expiry', availability: 'not_available' }],
      unreadable: ['计划候选'], complete: false },
    { name: 'only note_review failed', capabilities: [{ source: 'note_review', availability: 'read_failed' }],
      unreadable: ['注记'], complete: false },
    { name: 'only second_expiry is disconnected',
      capabilities: [{ source: 'second_expiry', availability: 'not_available' }],
      unreadable: [], complete: true },
  ])('names $name', ({ capabilities, unreadable, complete }) => {
    const data = adaptDecide(sourceOf(capabilities), UI);
    expect(data.unreadable).toEqual(unreadable);
    expect(data.counts.complete).toBe(complete);
  });
});
