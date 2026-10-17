/**
 * Slice 4C-2 U6: the finite decision coordinator dispatches step ② on
 * `input.source.kind`. A provided `DecisionApplicationAdapter` is called after
 * the answer commit and its receipt/`NoteDispositionResult` receipt is recorded;
 * a kind without an adapter and a non-conflict goal_conflict selection keep the
 * historical `answered` result.
 */
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionApplicationReceiptV1, SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { DecisionSelectionV1, DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { ResolveDecisionInputV1, ResolveDecisionReadV1 } from '../../src/business/workflow/contracts.js';
import type { GoalSettingsPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { createDecisionActions, type DecisionApplicationAdapter } from '../../src/business/workflow/decision-actions.js';

const ctx = (): CoreCallContext => ({
  projectId: 'P', workspaceId: 'W',
  principal: { kind: 'host', actor: { kind: 'human', id: 'operator' } },
  materialReader: { kind: 'host', projectId: 'P', workspaceId: 'W', actor: { kind: 'human', id: 'operator' } },
  signal: new AbortController().signal,
});

const MESSAGE_REF: SessionMessageRef = {
  aggregateType: 'SessionMessage', projectId: 'P', workspaceId: 'W', messageId: 'M1',
};
const answerMessage: SessionMessage = { ref: MESSAGE_REF, revision: 1 } as unknown as SessionMessage;

const sourceOf = (kind: DecisionSourceV1['kind']): DecisionSourceV1 => ({
  kind, key: `${kind}:key`, goalRef: { aggregateType: 'Goal', projectId: 'P', goalId: 'G' }, pins: [],
});

const request = (source: DecisionSourceV1, selection: DecisionSelectionV1): GraphWrite<ResolveDecisionInputV1> => ({
  input: { source, selection, text: '', annotations: [] },
  meta: { requestId: 'u6', expected: [] },
});

type Harness = {
  actions: ReturnType<typeof createDecisionActions>;
  calls: string[];
  recorded: DecisionApplicationReceiptV1[];
};

function harness(decisionApplications?: Partial<Record<DecisionSourceV1['kind'], DecisionApplicationAdapter>>): Harness {
  const calls: string[] = [];
  const recorded: DecisionApplicationReceiptV1[] = [];
  const actions = createDecisionActions({
    goalSettings: {} as unknown as GoalSettingsPort,
    decisionMessages: {
      async answerDecision() {
        calls.push('answer');
        return { status: 'committed', value: answerMessage, replayed: false, cursor: makeCommitCursor(1) };
      },
      async readDecisionAnswer() {
        return { status: 'not_found' } as ReadResult<{ message: SessionMessage | null; body: null }>;
      },
      async recordDecisionApplication(_ctx, write: GraphWrite<{ messageRef: SessionMessageRef;
        receipt: DecisionApplicationReceiptV1 }>) {
        calls.push('application');
        recorded.push(write.input.receipt);
        return { status: 'committed', value: { ...answerMessage, revision: 2 }, replayed: false,
          cursor: makeCommitCursor(3) } satisfies WriteResult<SessionMessage>;
      },
    },
    ...(decisionApplications === undefined ? {} : { decisionApplications }),
  });
  return { actions, calls, recorded };
}

function resolve(h: Harness, source: DecisionSourceV1, selection: DecisionSelectionV1):
Promise<ReadResult<ResolveDecisionReadV1>> {
  return h.actions.resolveDecision(ctx(), request(source, selection));
}

describe('S4C2 U6 decision application dispatch', () => {
  it('dispatches a provided adapter by source kind and records its receipt after the answer commit', async () => {
    const receipt: DecisionApplicationReceiptV1 = { identityKey: 'note-answer', fingerprint: 'f'.repeat(64),
      cursor: makeCommitCursor(2) };
    let sawAnswerRef: SessionMessageRef | null = null;
    let adapterKind: string | null = null;
    const h = harness({ note_review: {
      async apply(_ctx, input) {
        h.calls.push(`adapter:${input.source.kind}`);
        adapterKind = input.source.kind;
        sawAnswerRef = input.answerRef;
        return { status: 'ready', value: { action: null, receipt } };
      },
    } });
    const result = await resolve(h, sourceOf('note_review'), { kind: 'option', optionId: 'accept' });
    expect(result).toMatchObject({ status: 'ready', value: { state: 'applied', application: { status: 'committed' } } });
    expect(adapterKind).toBe('note_review');
    expect(sawAnswerRef).toEqual(MESSAGE_REF);
    expect(h.recorded).toEqual([receipt]);
    expect(h.calls).toEqual(['answer', 'adapter:note_review', 'application']);
  });

  it('records the formal receipt of a done NoteDispositionResult action', async () => {
    const receipt: DecisionApplicationReceiptV1 = { identityKey: 'note-disposition', fingerprint: 'a'.repeat(64),
      cursor: makeCommitCursor(4) };
    const h = harness({ note_review: {
      async apply() {
        return { status: 'ready', value: {
          action: { status: 'done', noteId: 'note-1', version: 2, state: 'reviewed', receipt },
          receipt: null,
        } };
      },
    } });
    const result = await resolve(h, sourceOf('note_review'), { kind: 'option', optionId: 'accept' });
    expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    expect(h.recorded).toEqual([receipt]);
  });

  it('answers a source kind with no adapter without calling the application writer', async () => {
    const h = harness();
    const result = await resolve(h, sourceOf('note_review'), { kind: 'option', optionId: 'accept' });
    expect(result).toEqual({ status: 'ready', value: { answer: { status: 'committed', value: answerMessage,
      replayed: false, cursor: makeCommitCursor(1) }, action: null, application: null, state: 'answered' } });
    expect(h.calls).toEqual(['answer']);
  });

  it('keeps a non-conflict selection on goal_conflict answered', async () => {
    const h = harness({});
    const result = await resolve(h, sourceOf('goal_conflict'), { kind: 'other' });
    expect(result).toMatchObject({ status: 'ready', value: { action: null, application: null, state: 'answered' } });
    expect(h.calls).toEqual(['answer']);
  });

  it('leaves a rejected adapter result pending application', async () => {
    const h = harness({ note_review: {
      async apply() {
        return { status: 'ready', value: { action: { status: 'rejected', code: 'source_stale',
          reason: 'the note changed' }, receipt: null } };
      },
    } });
    const result = await resolve(h, sourceOf('note_review'), { kind: 'option', optionId: 'accept' });
    expect(result).toMatchObject({ status: 'ready', value: { application: null,
      action: { status: 'rejected', code: 'source_stale' }, state: 'application_not_recorded' } });
    expect(h.calls).toEqual(['answer']);
  });
});
