/**
 * The one send/respond payload.
 *
 * Pure rows (A5): the normalizers take built `unknown` input; nothing here
 * reaches a store, platform or Host, and no call reads a clock. The send
 * defaults are the mailbox owner's current ones
 * (`W/communication/mailbox-service.ts` `sendMessage`): `waitAfterSend` false,
 * and `needsReply` true only for an explicit true or an omitted value while
 * `waitAfterSend` is true.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeRespondMessageInput, normalizeSendMessageInput,
} from '../../src/core/work-graph/model/message-payload.js';

const RECIPIENT = { projectId: 'project-1', sessionId: 'session-recipient' };
const MESSAGE_REF = {
  aggregateType: 'SessionMessage' as const,
  projectId: 'project-1', workspaceId: 'workspace-1', messageId: 'message-1',
};
const GOAL_REF = { aggregateType: 'Goal' as const, projectId: 'project-1', goalId: 'goal-1' };
const TASK_REF = { projectId: 'project-1', goalId: 'goal-1', taskId: 'task-1' };
const EXPECTED = { planRevision: 2, pointerRevision: 'none' as const, dispatchSequence: 7 };

describe('send payload defaults and pass-through', () => {
  it.each([
    ['omitted optional fields keep their defaults', { recipient: RECIPIENT, text: 'status update' },
      { recipient: RECIPIENT, text: 'status update', intent: null, needsReply: false, waitAfterSend: false,
        expected: null, taskRef: null, followupOf: null, deadlineMs: null, goalRef: null }],
    ['omitted needsReply follows waitAfterSend, the mailbox owner default',
      { recipient: RECIPIENT, text: 'question', waitAfterSend: true },
      { recipient: RECIPIENT, text: 'question', intent: null, needsReply: true, waitAfterSend: true,
        expected: null, taskRef: null, followupOf: null, deadlineMs: null, goalRef: null }],
    ['given values pass through', {
      recipient: RECIPIENT, text: 'question', intent: 'inquiry', needsReply: true, waitAfterSend: true,
      expected: EXPECTED, taskRef: TASK_REF, followupOf: MESSAGE_REF, deadlineMs: 2500, goalRef: GOAL_REF,
    }, {
      recipient: RECIPIENT, text: 'question', intent: 'inquiry', needsReply: true, waitAfterSend: true,
      expected: EXPECTED, taskRef: TASK_REF, followupOf: MESSAGE_REF, deadlineMs: 2500, goalRef: GOAL_REF,
    }],
  ] as const)('%s', (_name, input, expected) => {
    expect(normalizeSendMessageInput(input)).toEqual({ status: 'ready', value: expected });
  });
});

describe('send payload deadlineMs is a finite number greater than 0', () => {
  it.each([
    ['0.5 (not an integer, not >= 1)', 0.5, 0.5],
    ['0', 0, null],
    ['-1', -1, null],
    ['NaN', Number.NaN, null],
    ['Infinity', Number.POSITIVE_INFINITY, null],
  ] as const)('%s', (_name, deadlineMs, accepted) => {
    const result = normalizeSendMessageInput({ recipient: RECIPIENT, text: 'question', deadlineMs });
    if (accepted === null) {
      expect(result).toEqual({ status: 'rejected', code: 'invalid', reason: expect.any(String) });
    } else {
      expect(result).toEqual({ status: 'ready', value: expect.objectContaining({ deadlineMs: accepted }) });
    }
  });
});

describe('respond payload: exactly one flat arm and the version kept', () => {
  it.each([
    ['text arm', { messageRef: MESSAGE_REF, expectedRevision: 4, text: 'the answer' },
      { messageRef: MESSAGE_REF, expectedRevision: 4, text: 'the answer' }],
    ['reject arm', { messageRef: MESSAGE_REF, expectedRevision: 4, reject: true, reason: 'not mine' },
      { messageRef: MESSAGE_REF, expectedRevision: 4, reject: true, reason: 'not mine' }],
    ['both arms', { messageRef: MESSAGE_REF, expectedRevision: 4, text: 'the answer', reject: true, reason: 'no' }, null],
    ['neither arm', { messageRef: MESSAGE_REF, expectedRevision: 4 }, null],
    ['reject false', { messageRef: MESSAGE_REF, expectedRevision: 4, reject: false, reason: 'no' }, null],
    ['reject without a reason', { messageRef: MESSAGE_REF, expectedRevision: 4, reject: true }, null],
    ['a text arm carrying a reason', { messageRef: MESSAGE_REF, expectedRevision: 4, text: 'the answer', reason: 'no' }, null],
    ['missing messageRef', { expectedRevision: 4, text: 'the answer' }, null],
    ['missing expectedRevision', { messageRef: MESSAGE_REF, text: 'the answer' }, null],
    ['expectedRevision 0', { messageRef: MESSAGE_REF, expectedRevision: 0, text: 'the answer' }, null],
    ['expectedRevision 1.5', { messageRef: MESSAGE_REF, expectedRevision: 1.5, text: 'the answer' }, null],
  ] as const)('%s', (_name, input, expected) => {
    const result = normalizeRespondMessageInput(input);
    if (expected === null) {
      expect(result).toEqual({ status: 'rejected', code: 'invalid', reason: expect.any(String) });
    } else {
      expect(result).toEqual({ status: 'ready', value: expected });
    }
  });
});
