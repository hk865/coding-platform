/**
 * The two request builders.
 *
 * Pure rows (A5): the builders take built arguments and return the graph write
 * the adapter hands the owner; nothing here reaches a store, platform or Host.
 */
import { describe, expect, it } from 'vitest';
import type { RespondMessageV1 } from '../../src/core/work-graph/model/message-payload.js';
import {
  respondSessionMessageRequest, sendSessionMessageRequest,
} from '../../src/core/work-graph/model/tool-commit-arguments.js';

const RECIPIENT = { projectId: 'project-1', sessionId: 'session-recipient' };
const MESSAGE_REF = {
  aggregateType: 'SessionMessage' as const,
  projectId: 'project-1', workspaceId: 'workspace-1', messageId: 'message-1',
};
const OTHER_MESSAGE_REF = {
  aggregateType: 'SessionMessage' as const,
  projectId: 'project-1', workspaceId: 'workspace-1', messageId: 'message-2',
};
const TASK_REF = { projectId: 'project-1', goalId: 'goal-1', taskId: 'task-1' };
const EXPECTED = { planRevision: 2, pointerRevision: 'none' as const, dispatchSequence: 7 };

describe('send builder', () => {
  it('copies the four new fields into input and keeps the empty meta pin list', () => {
    expect(sendSessionMessageRequest({
      recipient: RECIPIENT, text: 'question',
      expected: EXPECTED, taskRef: TASK_REF, followupOf: MESSAGE_REF, deadlineMs: 2500,
    }, 'request-send-1')).toStrictEqual({
      input: {
        recipient: RECIPIENT, text: 'question',
        expected: EXPECTED, taskRef: TASK_REF, followupOf: MESSAGE_REF, deadlineMs: 2500,
      },
      meta: { requestId: 'request-send-1', expected: [] },
    });
  });
});

describe('respond builder', () => {
  const arms: readonly { arm: string; input: RespondMessageV1; rebuilt: Record<string, unknown> }[] = [
    { arm: 'text', input: { messageRef: MESSAGE_REF, expectedRevision: 3, text: 'the answer' },
      rebuilt: { messageRef: MESSAGE_REF, text: 'the answer' } },
    { arm: 'reject', input: { messageRef: OTHER_MESSAGE_REF, expectedRevision: 3, reject: true, reason: 'not mine' },
      rebuilt: { messageRef: OTHER_MESSAGE_REF, reject: true, reason: 'not mine' } },
  ];
  it.each(arms)('$arm is flat with the version only in meta.expected', ({ input, rebuilt }) => {
    const request = respondSessionMessageRequest(input, 'request-respond-1');
    expect(request.input).toStrictEqual(rebuilt);
    expect(Object.keys(request.input)).toEqual(Object.keys(rebuilt));
    expect(request.meta).toStrictEqual({
      requestId: 'request-respond-1',
      expected: [{ ref: input.messageRef, revision: 3 }],
    });
  });
});
