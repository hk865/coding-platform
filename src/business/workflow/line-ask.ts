/**
 * The person's `queries/ask`: one inquiry message, then the SAME 7B consultation
 * consumer. The question is a real saved message first, so a replay of the same
 * `commandId` returns the original message and the deterministic Query identity;
 * the consumer builds the read-only copy and drives the Query, unchanged.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import { consultationQueryRefs } from '../../contracts/query-job.js';
import { rejected } from '../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../contracts/validation/common.js';
import type { SessionDirectoryPort } from '../../core/work-graph/model/session-contracts.js';
import type { SessionMailboxPort } from '../../core/work-graph/model/communication-contracts.js';
import { sourceGoalRef } from '../../core/work-graph/queries/platform-facts.js';
import { queryTextProblem } from '../../core/work-graph/queries/query-job-service.js';
import type { ConsultationInput, ConsultationResult } from './contracts.js';
import type { LineAskCommandV1, LineAskResultV1 } from './ports.js';
import { ownContext } from './workflow.js';

export type LineAskDependencies = {
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
  messages: Pick<SessionMailboxPort, 'sendMessage'>;
  consult: (ctx: CoreCallContext, input: ConsultationInput) => Promise<ConsultationResult>;
};

function completeSessionRef(value: unknown): value is SessionRef {
  return isRecord(value) && nonEmpty(value['projectId']) && nonEmpty(value['sessionId']);
}

/**
 * The ONE public-input rule of `queries/ask` (ruling 34): the Host calls it
 * before its first Session read, and the Workflow calls it again for the same
 * input. Shape first, then the project; a foreign project is `forbidden` here
 * so the scoped Session reader can never hide it as `not_found`.
 */
export function lineAskInputRejection(projectId: string, input: unknown): CoreRejection | null {
  if (!isRecord(input)) return rejected('invalid', 'the command requires a commandId');
  if (!nonEmpty(input['commandId'])) return rejected('invalid', 'the command requires a commandId');
  const textProblem = queryTextProblem(input['question']);
  if (textProblem !== null) return rejected('invalid', `question ${textProblem}`);
  if (!completeSessionRef(input['sessionRef'])) return rejected('invalid', 'sessionRef must be a complete SessionRef');
  if (input['sessionRef'].projectId !== projectId) {
    return rejected('forbidden', 'the recipient Session belongs to another project');
  }
  return null;
}

export function createLineAsk(deps: LineAskDependencies):
  (ctx: CoreCallContext, input: LineAskCommandV1) => Promise<LineAskResultV1> {
  return async (ctx, input) => {
    const owned = ownContext(ctx);
    if ('rejection' in owned) return owned.rejection;
    const inputRejection = lineAskInputRejection(owned.projectId, input);
    if (inputRejection !== null) return inputRejection;

    const cardRead = await deps.sessions.readSession(owned.ctx, input.sessionRef);
    if (cardRead.status === 'not_found') return rejected('not_found', 'the requested record does not exist');
    if (cardRead.status !== 'ready') {
      return cardRead.status === 'rejected' ? cardRead
        : rejected('incomplete', `the requested record is not ready (${cardRead.status})`);
    }
    const card = cardRead.value;
    if (card.record.workspaceId !== owned.workspaceId) {
      return rejected('not_found', 'the recipient Session is outside the bound workspace');
    }
    const goalRef = sourceGoalRef(card);

    const sent = await deps.messages.sendMessage(owned.ctx, {
      input: {
        recipient: input.sessionRef, text: input.question, intent: 'inquiry', needsReply: true,
      },
      meta: { requestId: `queries-ask:${input.commandId}`, expected: [] },
    });
    if (sent.status !== 'committed') return sent;

    const messageRef = sent.value.ref;
    const consulted = await deps.consult(owned.ctx, {
      schemaVersion: 1, messageRef, goalRef,
      roleBinding: input.roleBinding, runtimeBudget: input.runtimeBudget,
      budget: input.budget, consumerId: input.consumerId,
    });
    if (consulted.status === 'not_found') return rejected('not_found', 'the requested record does not exist');
    if (consulted.status !== 'ready') {
      return consulted.status === 'rejected' ? consulted
        : rejected('incomplete', `the consultation is not ready (${consulted.status})`);
    }
    return { status: 'queued', round: consultationQueryRefs(messageRef).queryJobRef };
  };
}
