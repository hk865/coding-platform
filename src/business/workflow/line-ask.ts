/**
 * The person's `queries/ask`: one inquiry message, then the SAME 7B consultation
 * consumer. The question is a real saved message first, so a replay of the same
 * `commandId` returns the original message and the deterministic Query identity;
 * the consumer builds the read-only copy and drives the Query, unchanged.
 *
 * 121-173 (NR-B 6): the platform's node-review draft asks the secretary through the same front and stops once the
 * consumer has accepted the Query (`createLineAskAccepted`).
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
import { lineAskRequestId } from '../../core/work-graph/state/task-node-commit.js';
import { queryTextProblem } from '../../core/work-graph/queries/query-job-service.js';
import type { ConsultationInput, ConsultationResult } from './contracts.js';
import type { ConsultationAccepted } from './consultation.js';
import type { LineAskAcceptedResultV1, LineAskCommandV1, LineAskResultV1 } from './ports.js';
import { ownContext } from './workflow.js';

export type LineAskDependencies = {
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
  messages: Pick<SessionMailboxPort, 'sendMessage'>;
  consult: (ctx: CoreCallContext, input: ConsultationInput) => Promise<ConsultationResult>;
};

/** The draft ask's front is the person's; the consumer comes as its two halves. */
export type LineAskAcceptedDependencies = Pick<LineAskDependencies, 'sessions' | 'messages'> & {
  accept: (ctx: CoreCallContext, input: ConsultationInput) => Promise<ConsultationResult | ConsultationAccepted>;
  drive: (ctx: CoreCallContext, step: ConsultationAccepted) => Promise<ConsultationResult>;
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

/** Both asks' one front: the input rule, the line read and the saved inquiry; returns the consultation it opens. */
async function askedConsultation(deps: Pick<LineAskDependencies, 'sessions' | 'messages'>, ctx: CoreCallContext,
  input: LineAskCommandV1): Promise<{ ctx: CoreCallContext; consultation: ConsultationInput } | CoreRejection> {
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
      recipient: input.sessionRef, text: input.question, needsReply: true,
      answeredBy: 'copy', wake: false,
    },
    meta: { requestId: lineAskRequestId(input.commandId), expected: [] },
  });
  if (sent.status !== 'committed') return sent;

  const messageRef = sent.value.ref;
  return { ctx: owned.ctx, consultation: {
    schemaVersion: 1, messageRef, goalRef,
    roleBinding: input.roleBinding, runtimeBudget: input.runtimeBudget,
    budget: input.budget, consumerId: input.consumerId,
  } };
}

/** A consultation result that is not `ready`, as the ask's rejection. */
function consultRejection(consulted: Exclude<ConsultationResult, { status: 'ready' }>): CoreRejection {
  if (consulted.status === 'not_found') return rejected('not_found', 'the requested record does not exist');
  return consulted.status === 'rejected' ? consulted
    : rejected('incomplete', `the consultation is not ready (${consulted.status})`);
}

export function createLineAsk(deps: LineAskDependencies):
  (ctx: CoreCallContext, input: LineAskCommandV1) => Promise<LineAskResultV1> {
  return async (ctx, input) => {
    const asked = await askedConsultation(deps, ctx, input);
    if ('status' in asked) return asked;
    const consulted = await deps.consult(asked.ctx, asked.consultation);
    if (consulted.status !== 'ready') return consultRejection(consulted);
    return { status: 'queued', round: consultationQueryRefs(asked.consultation.messageRef).queryJobRef };
  };
}

/**
 * 121-173 (NR-B 6): the platform's node-review draft. The same front, then the consumer's `accept` only: the real
 * Query is known before its model runs, and `drive` continues it for the caller to run detached. A consultation that
 * holds a Query with nothing for this call to drive (answered, ended, or not claimed) names that Query without
 * `drive`; once the question is saved, one that opened no Query, refused or waiting, is `failed` with the consumer's
 * reason and the question (NR-B r2-4).
 */
export function createLineAskAccepted(deps: LineAskAcceptedDependencies):
  (ctx: CoreCallContext, input: LineAskCommandV1) => Promise<LineAskAcceptedResultV1> {
  return async (ctx, input) => {
    const asked = await askedConsultation(deps, ctx, input);
    if ('status' in asked) return asked;
    const step = await deps.accept(asked.ctx, asked.consultation);
    const message = asked.consultation.messageRef;
    if (step.status === 'accepted') {
      return { status: 'accepted', round: step.query.job.ref, message,
        drive: async () => { await deps.drive(asked.ctx, step); } };
    }
    if (step.status !== 'ready') return { status: 'failed', reason: consultRejection(step).reason, message };
    const { query, reason, state } = step.value;
    if (query !== null) return { status: 'accepted', round: query.job.ref, message, drive: null };
    return { status: 'failed', reason: reason ?? `the consultation is ${state} without a Query`, message };
  };
}
