/**
 * G's release proof (book 7a:436–:444): the B-13 proof the trusted entry writes and
 * the typed decoder P's proof table holds. A direct `messages/release` approval
 * writes no proof.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { DecisionApplicationV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { EncodedDomainEvent } from '../../record-store/ports.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import type {
  MessageCommandWritePort, MessageReleaseApplicationInputV1, MessageReleasePort, S5RecordPort,
  SessionMessageCommitCompanions, SessionMessageWriteCommandV1,
} from '../model/decision-contracts.js';
import { commandKeys, executeWriteCommand, type WriteCommand } from '../persistence/command-executor.js';
import type { MessageReleaseDecidedChangeV1 } from '../state/message-machine.js';
import { messageReleaseAnswerCommand, messageReleaseAnswerFacts } from '../tasks/message-release-answer.js';
import {
  eventIdOf, judge, messageWriteResult, readSessionMessageRecord, refusalOf, releaseDecidedChange,
  releaseDecidedResult,
} from './mailbox-service.js';
import { sessionMessageReleaseDecidedEventFromEvent } from '../sessions/message-record-codecs.js';

/** Called after a committed approval through the trusted entry (a replay included; arming twice is harmless). */
export type MessageReleaseApprovedHookV1 = (approved: { messageRef: SessionMessageRef; goalRef: GoalRef }) => void;

/** B-13: the proof the trusted entry writes. It points at the decision answer (`7a:440–:443`). */
export function messageReleaseChangeProof(input: {
  answerRef: SessionMessageRef;
  /** The answer's canonical source pins (`UserMessageResponseV1.decision.source`). */
  capturedPins: VersionPin[];
  before: VersionPin;
  after: VersionPin;
}): DecisionChangeProofV1 {
  return {
    acknowledgementRef: input.answerRef,
    capturedPins: input.capturedPins,
    changes: [{ before: input.before, after: input.after }],
    basisRebases: [],
  };
}

/** The row P's proof table holds; the same shape as `ProofEvent` (`decision-application.ts:44–:48`). */
export function decodeMessageReleaseProofEvent(event: EncodedDomainEvent):
  { actor: DecisionApplicationV1['actor']; appliedAt: string; proof: DecisionChangeProofV1 | null }
  | ReadResult<never> {
  const decoded = sessionMessageReleaseDecidedEventFromEvent(event);
  if (decoded.status !== 'decoded') {
    return rejectedWithCurrent('unavailable',
      `the SessionMessageReleaseDecided event is damaged: ${decoded.reason}`);
  }
  if (decoded.value.actor.kind !== 'host') {
    return rejectedWithCurrent('unavailable',
      'the SessionMessageReleaseDecided event is damaged: its actor is not the trusted Host');
  }
  return { actor: decoded.value.actor.actor, appliedAt: decoded.value.occurredAt, proof: decoded.value.proof };
}

export type MessageReleaseApplicationDependencies = {
  records: S5RecordPort;
  writes: Pick<MessageCommandWritePort, 'prepare'>;
  now(): string;
};

type ReleaseDecision = { before: SessionMessage; change: MessageReleaseDecidedChangeV1; at: string };

/** The trusted internal entry (B-12/B-13, `7a:436–:443`). L publishes it; G-late's recovery calls it. */
export function createMessageReleaseApplication(deps: MessageReleaseApplicationDependencies):
  Pick<MessageReleasePort, 'applyMessageRelease'> {
  return {
    async applyMessageRelease(ctx: CoreCallContext, input: MessageReleaseApplicationInputV1):
    ReturnType<MessageReleasePort['applyMessageRelease']> {
      const saved = await readSessionMessageRecord(deps.records, ctx.signal, input.answerRef);
      if (saved.status === 'not_found') {
        return rejectedWithCurrent('not_found', 'the requested record does not exist');
      }
      if (saved.status === 'not_ready') {
        return rejectedWithCurrent('incomplete', 'the requested record is not readable at the required watermark');
      }
      if (saved.status !== 'ready') return saved;
      const answer = saved.value;
      const facts = messageReleaseAnswerFacts(answer);
      const derived = messageReleaseAnswerCommand(answer);
      if (facts === null || derived === null) {
        return answer.response !== null && 'decision' in answer.response
          && answer.response.sender.actor.kind === 'system'
          ? rejectedWithCurrent('forbidden', 'only the person may approve or deny a release')
          : rejectedWithCurrent('invalid', 'the saved answer is not a message release decision');
      }
      // The person's identity is the saved answer's, never the bound context's; the context keeps only the
      // scope, signal and write facade it already had.
      const principal = { kind: 'host' as const, actor: { kind: 'human' as const, id: facts.actor.id } };
      const releaseCommand: WriteCommand<SessionMessage, ReleaseDecision, CoreRejection, SessionMessage, SessionMessage> = {
        operation: derived.operation,
        scope: derived.scope,
        principal: derived.principal,
        commandId: derived.commandId,
        fingerprintInput: derived.fingerprintInput,
        read: async () => {
          const target = await readSessionMessageRecord(deps.records, ctx.signal, facts.messageRef);
          if (target.status === 'not_found') {
            return rejectedWithCurrent('not_found', 'the requested record does not exist');
          }
          if (target.status === 'not_ready') {
            return rejectedWithCurrent('incomplete', 'the requested record is not readable at the required watermark');
          }
          return target.status === 'ready' ? { status: 'ready', facts: target.value } : target;
        },
        decide: (message) => {
          const { decided, ctx: guardCtx } = judge(principal, message,
            { type: 'message_release_decided', allow: facts.allow }, {});
          if (!decided.ok) return { refuse: refusalOf(decided, guardCtx) };
          const at = deps.now();
          const before: VersionPin = { ref: message.ref, revision: message.revision };
          const after: VersionPin = { ref: message.ref, revision: message.revision + 1 };
          const proof = messageReleaseChangeProof({
            answerRef: facts.answerRef, capturedPins: facts.capturedPins, before, after,
          });
          return {
            decision: { before: message, change: releaseDecidedChange(message, facts.allow, at, proof), at },
          };
        },
        build: async (decision, keys) => {
          const command: SessionMessageWriteCommandV1 = {
            operation: 'message.release',
            messageRef: decision.before.ref,
            before: decision.before,
            expectedRevision: decision.before.revision,
            event: {
              eventId: eventIdOf(keys.identityKey, 'SessionMessageReleaseDecided'),
              occurredAt: decision.at,
              requestId: derived.commandId,
              projectId: derived.scope.projectId,
              workspaceId: derived.scope.workspaceId,
              actor: { kind: 'host', actor: { kind: 'human', id: facts.actor.id } },
            },
            change: decision.change,
          };
          const companions: SessionMessageCommitCompanions = { records: [], events: [], guards: [], claims: [] };
          return deps.writes.prepare(ctx, command, companions);
        },
        result: releaseDecidedResult,
      };
      const result = messageWriteResult(await executeWriteCommand(deps.records, releaseCommand));
      return result.status === 'committed'
        ? { ...result, receipt: { ...commandKeys(derived), cursor: result.cursor } }
        : result;
    },
  };
}
