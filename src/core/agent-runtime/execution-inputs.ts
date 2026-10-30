/**
 * Unified execution-input channel.
 *
 * One stable identity per ORIGINAL persisted source (SessionMessage ref + part)
 * is shared by ordinary mail, saved replies, steer and mechanical attention. The
 * Kernel reports these candidates at a real drained `before_model` boundary and
 * commits `run.input_accepted`; this module only READS applicable candidates and
 * excludes anything the safe point already reports as accepted in this Run, or
 * the original message already records as accepted by an earlier execution. It
 * never marks consumption and never writes "processed".
 *
 * The prior yielded Run's reply is read through the formal `consumedWait`
 * association (`readMessage`/`readMessageBody` are SESSION-scoped, so a new Run
 * in the same Session can read it). Session-scoped outbox discovery also
 * supplies asynchronous replies from earlier Runs through the same channel.
 */
import type { CommitCursor } from '../../contracts/command-event.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { UserDecisionBodyV1 } from '../../contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import { packString } from '../../contracts/prompts/pack-string.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import { renderDeliveryInput, type DeliveryInputV1 } from '../../contracts/prompts/delivery-input.js';
import { renderTemplate } from '../../contracts/prompts/render-template.js';
import type { SessionRecord as KernelSessionRecord } from '../../../vendor/coding-agent/dist/public-api.js';
import type { KernelExecutionBinding } from '../work-graph/model/execution-entry-contracts.js';
import type { ConsumedWaitV1, RunRef } from '../../contracts/dispatch.js';
import { seqOfCommitCursor } from '../../contracts/ledger.js';
import {
  deriveSessionInputId, type SessionMailboxPort, type SessionMessage,
} from '../work-graph/model/communication-contracts.js';
import { sessionMessageRefKey } from '../work-graph/sessions/message-record-codecs.js';
import {
  effectiveReplyHandler, messageConsumptionProblem, messageFactsOfRecord, waitFactsOfRecord, waitStateOf,
} from '../work-graph/state/message-machine.js';

export type InputPart = 'message' | 'response' | 'expiry';

export type SuppliedInput = {
  inputId: string;
  text: string;
  sourceRef: unknown;
};

export type InputSupply = (
  point: {
    sessionId: string | null;
    runId: string;
    turnId: string;
    afterEventSequence: number;
    acceptedInputIds: readonly string[];
  },
  options: Readonly<{ signal: AbortSignal }>,
) => Promise<readonly SuppliedInput[]>;

/** The stable identity of one persisted source part; never a time/random id. */
export function deriveInputId(messageRef: SessionMessage['ref'], part: InputPart): string {
  return deriveSessionInputId(messageRef, part);
}

/**
 * Slice 5 §4.6: the deterministic text a new user decision response supplies to
 * the asking Run. The fixed value is `'用户答复\n' + canonicalJson(body)`, so
 * the selection, the exact free text and every annotation reach the model
 * without a prose guess. It renders from the execution's frozen texts, never
 * the global pack. `createMailboxInputSupply` uses it for a decision response;
 * every other reply renders `wait-reply-delivery` instead, never its raw text.
 */
export function formatDecisionResponseInput(texts: PromptTextsV1, body: UserDecisionBodyV1,
  toolNames: readonly string[]): string {
  // The seventh input template, rendered from the execution's frozen texts; the
  // tool list is the one `renderDeliveryInput` takes, for the same reason.
  return renderTemplate(texts, 'user-decision-response',
    { bodyJson: canonicalJson(body as unknown as JsonValue) }, toolNames).text;
}

/**
 * The formal `UserDecisionBodyV1` of a message response whose metadata carries
 * the user's decision; `null` for every historical reply. The original free text
 * is read from the stored body, so the formatter receives exactly the saved
 * selection/text/annotations and never a re-derived guess.
 */
function decisionResponseBody(message: SessionMessage, text: string): UserDecisionBodyV1 | null {
  const response: unknown = message.response;
  if (response === null || typeof response !== 'object' || !('decision' in response)) return null;
  const decision = (response as { decision: {
    selection: UserDecisionBodyV1['selection']; annotations: UserDecisionBodyV1['annotations'];
  } }).decision;
  return { schemaVersion: 1, kind: 'user_decision_response', selection: decision.selection, text, annotations: decision.annotations };
}

function alreadyAcceptedBySource(message: SessionMessage, inputId: string): boolean {
  return (message.acceptedInputs ?? []).some(entry => entry.inputId === inputId);
}

/** Compare two plain Session refs without importing a wider identity helper. */
function sameSession(left: { projectId: string; sessionId: string }, right: { projectId: string; sessionId: string }): boolean {
  return left.projectId === right.projectId && left.sessionId === right.sessionId;
}

export type MailboxInputSupplyDependencies = {
  /**
   * Slice 1 §2.5 / §6 F82: the same channel also reads the replies whose
   * effective reply handler is this Session (`readRoutedReplies`), merged with
   * `readOutbox` under the one `deriveSessionInputId(messageRef, 'response')`
   * identity. Optional on the port, so an existing narrow double stays valid.
   */
  messages: Pick<SessionMailboxPort, 'readInbox' | 'readMessageBody' | 'readOutbox' | 'readMessage' | 'readRoutedReplies'>;
  /** The trusted Run context; the same identity the Kernel tool calls use. */
  context: () => CoreCallContext;
  sessionRef: SessionRef;
  runRef: RunRef | QueryRunRef;
  controlInputs?: InputSupply;
  /** The whole continuation (K's three-arm union); `intervention` carries no saved-reply arm. */
  consumedWait?: ConsumedWaitV1 | undefined;
  /** The expiry chain count; absent fails the expiry input closed. */
  expiryCount?: (ctx: CoreCallContext, input: { messageRef: SessionMessage['ref'] }) =>
    Promise<ReadResult<1 | 2 | 'incomplete'>>;
  /** The execution's frozen prompt texts (`readPromptTexts`); every input renders from them (P5, A-10). */
  texts: PromptTextsV1;
  /** The execution's frozen final tool list (`PromptSetV1.toolNames`), passed to every render. */
  toolNames: readonly string[];
  /** A secretary round's supply: only queued/default `notify` mail. Its reply/expiry is frozen in the round. */
  only?: 'notify';
};

export function createMailboxInputSupply(deps: MailboxInputSupplyDependencies): InputSupply {
  // Session records may carry aggregateType; mailbox addresses are plain refs.
  const sessionRef: SessionRef = { projectId: deps.sessionRef.projectId, sessionId: deps.sessionRef.sessionId };
  const sourceRef = (messageRef: SessionMessage['ref'], part: InputPart): unknown => ({
    kind: 'SessionMessage', messageRef: { ...messageRef }, part,
  });
  const readResponse = async (ctx: CoreCallContext, message: SessionMessage, seen: Set<string>,
    results: SuppliedInput[]): Promise<void> => {
    if (message === undefined) return;
    if (message.status !== 'responded' || message.response === null) return;
    if (messageConsumptionProblem(messageFactsOfRecord(message)) !== null) return;
    // SR7 §7.3.3: only a reply still bound to an open/answered wait is dropped
    // here, and only when an intervention or another Session's effective handler
    // takes it. A consumed, expired or wait-less reply is an ordinary late
    // reply and is supplied by the renderer below.
    const waitState = waitStateOf(message, waitFactsOfRecord(message));
    const handler = effectiveReplyHandler(message);
    if (message.waitAfterSend === true && (waitState.state === 'open' || waitState.state === 'answered')
      && (deps.consumedWait?.kind === 'intervention' || handler === null || !sameSession(handler, sessionRef))) return;
    // §2.5: the effective reply handler is the recorded `replyHandler` when set,
    // otherwise the original work_run sender. A transferred reply is supplied
    // only to the handler, never to the original sender (`readOutbox`).
    if (message.replyHandler != null && !sameSession(message.replyHandler.sessionRef, sessionRef)) return;
    const inputId = deriveInputId(message.ref, 'response');
    if (seen.has(inputId) || alreadyAcceptedBySource(message, inputId)) return;
    const body = await deps.messages.readMessageBody(ctx, { messageRef: message.ref, part: 'response' });
    if (body.status !== 'ready') throw new Error(`input body unavailable: ${body.status}`);
    const decisionBody = decisionResponseBody(message, body.value.text);
    let text: string;
    if (decisionBody !== null) {
      text = formatDecisionResponseInput(deps.texts, decisionBody, deps.toolNames);
    } else {
      // L-9: a non-decision reply renders the wait-reply template; its question
      // is the original message's body, which the reader may read.
      const question = await deps.messages.readMessageBody(ctx, { messageRef: message.ref, part: 'message' });
      if (question.status !== 'ready') throw new Error(`input body unavailable: ${question.status}`);
      text = renderDeliveryInput(deps.texts, {
        template: 'wait-reply-delivery', messageId: message.ref.messageId, question: question.value.text, body: body.value.text,
      }, deps.toolNames);
    }
    seen.add(inputId);
    results.push({ inputId, text, sourceRef: sourceRef(message.ref, 'response') });
  };
  const readMessagePart = async (ctx: CoreCallContext, message: SessionMessage, seen: Set<string>,
    results: SuppliedInput[]): Promise<void> => {
    if (messageConsumptionProblem(messageFactsOfRecord(message)) !== null) return;
    if (message.intent === 'inquiry') return;
    const inputId = deriveInputId(message.ref, 'message');
    if (seen.has(inputId) || alreadyAcceptedBySource(message, inputId)) return;
    const body = await deps.messages.readMessageBody(ctx, { messageRef: message.ref, part: 'message' });
    if (body.status !== 'ready') throw new Error(`input body unavailable: ${body.status}`);
    const slots = { messageId: message.ref.messageId, body: body.value.text };
    let text: string;
    if (message.sender.kind === 'host' && message.sender.actor.kind === 'human') {
      text = renderDeliveryInput(deps.texts, { template: 'intervention-delivery', ...slots }, deps.toolNames);
    } else {
      // L-8: a host system sender has no Session, so the pack's platform string
      // names it; work_run and secretary_round carry their Session id.
      const sender = message.sender.kind === 'host'
        ? packString(deps.texts, 'delivery.sender.platform')
        : message.sender.sessionRef.sessionId;
      const input: DeliveryInputV1 = message.intent === 'action_request'
        ? { template: 'action-request-delivery', ...slots, sender }
        : { template: 'notify-delivery', ...slots, sender };
      text = renderDeliveryInput(deps.texts, input, deps.toolNames);
    }
    seen.add(inputId);
    results.push({ inputId, text, sourceRef: sourceRef(message.ref, 'message') });
  };
  const compareInputCandidates = (
    left: { message: SessionMessage; cursor: () => CommitCursor },
    right: { message: SessionMessage; cursor: () => CommitCursor },
  ): number => {
    return seqOfCommitCursor(left.cursor()) - seqOfCommitCursor(right.cursor())
      || sessionMessageRefKey(left.message.ref).localeCompare(sessionMessageRefKey(right.message.ref));
  };

  return async (point, { signal }) => {
    if (signal.aborted) return [];
    const ctx = { ...deps.context(), signal };
    const results: SuppliedInput[] = [];
    // Start from the real safe point's accepted ids: a part the Kernel accepted
    // in an earlier boundary of this same Run is no longer offered, even before
    // the platform confirm writes its source record (book 7b:1202).
    const seen = new Set<string>(point.acceptedInputIds);
    const wait = deps.consumedWait;
    const intervention = wait?.kind === 'intervention';
    // A request round supplies only queued/default notify mail; it skips the
    // person pass, the whole continuation and the merged reply mail.
    const notifyOnly = deps.only === 'notify';

    // (a) The inbox is read once, to its end. A person's message is the
    //     intervention input; every execution supplies it before the continuation
    //     and ordinary mail, in the part's own commit order.
    const person: { message: SessionMessage; cursor: () => CommitCursor }[] = [];
    const agent: { message: SessionMessage; cursor: () => CommitCursor }[] = [];
    let inboxCursor: string | undefined;
    while (!signal.aborted) {
      const read = await deps.messages.readInbox(ctx, { recipient: sessionRef, page: { limit: 100, ...(inboxCursor === undefined ? {} : { cursor: inboxCursor }) } });
      if (read.status !== 'ready') throw new Error(`input index unavailable: ${read.status}`);
      const page = read.value;
      for (const [index, message] of page.items.entries()) {
        if (message.intent === 'inquiry') continue;
        if (notifyOnly && message.intent !== undefined && message.intent !== 'notify') continue;
        const candidate = {
          message,
          // The page's cursors are required and aligned with its items.
          cursor: (): CommitCursor => page.cursors[index]!,
        };
        if (message.sender.kind === 'host' && message.sender.actor.kind === 'human') person.push(candidate);
        else agent.push(candidate);
      }
      const next = page.nextCursor ?? undefined;
      if (next === undefined) break;
      if (next === inboxCursor) throw new Error('input cursor did not advance');
      inboxCursor = next;
    }
    if (!notifyOnly) {
      person.sort(compareInputCandidates);
      for (const candidate of person) {
        if (signal.aborted) return results;
        await readMessagePart(ctx, candidate.message, seen, results);
      }
    }

    // (b) The continuation. A wait's reply belongs to the original continuation
    //     or the effective handler execution, never to an intervention.
    if (!notifyOnly && wait !== undefined) {
      if (wait.kind === 'wait_reply') {
        const read = await deps.messages.readMessage(ctx, wait.messageRef);
        if (read.status !== 'ready') throw new Error(`saved wait message unavailable: ${read.status}`);
        const handler = effectiveReplyHandler(read.value);
        if (handler === null || !sameSession(handler, sessionRef))
          throw new Error('saved wait is not this Session\'s reply handler');
        await readResponse(ctx, read.value, seen, results);
      } else if (wait.kind === 'expiry') {
        const read = await deps.messages.readMessage(ctx, wait.messageRef);
        if (read.status !== 'ready') throw new Error(`saved wait message unavailable: ${read.status}`);
        // A withdrawn or unreleased wait supplies no expiry input; the execution
        // still reads its ordinary mail and control inputs.
        if (messageConsumptionProblem(messageFactsOfRecord(read.value)) === null) {
          if (read.value.sender.kind !== 'work_run' || !sameSession(read.value.sender.sessionRef, sessionRef))
            throw new Error('saved wait is not this Session\'s work_run wait');
          const inputId = deriveInputId(read.value.ref, 'expiry');
          if (!seen.has(inputId) && !alreadyAcceptedBySource(read.value, inputId)) {
            const body = await deps.messages.readMessageBody(ctx, { messageRef: read.value.ref, part: 'message' });
            if (body.status !== 'ready') throw new Error(`input body unavailable: ${body.status}`);
            const count = await deps.expiryCount?.(ctx, { messageRef: read.value.ref });
            if (count === undefined) throw new Error('the expiry input requires the expiry chain count');
            if (count.status !== 'ready' || count.value === 'incomplete')
              throw new Error(`expiry chain unavailable: ${
                count.status === 'rejected' ? count.code : count.status === 'ready' ? 'incomplete' : count.status}`);
            seen.add(inputId);
            results.push({
              inputId,
              text: renderDeliveryInput(deps.texts, {
                template: 'wait-expiry-delivery', messageId: read.value.ref.messageId,
                question: body.value.text, deadline: read.value.deadline as string, expiryCount: count.value,
              }, deps.toolNames),
              sourceRef: sourceRef(read.value.ref, 'expiry'),
            });
          }
        }
      }
    }

    // (c) The agent inbox, this Session's outbox and its handler-scoped replies
    //     merge into one commit order; a response takes its own `responseSince`.
    const merged: { message: SessionMessage; cursor: () => CommitCursor; response: boolean }[] =
      agent.map(candidate => ({ ...candidate, response: false }));
    const readOutbox = deps.messages.readOutbox;
    if (!notifyOnly && readOutbox !== undefined) {
      let cursor: string | undefined;
      while (!signal.aborted) {
        const read = await readOutbox(ctx, { senderSession: sessionRef, page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
        if (read.status !== 'ready') throw new Error(`input index unavailable: ${read.status}`);
        for (const message of read.value.items) {
          if (message.status !== 'responded' || message.response === null) continue;
          merged.push({ message, cursor: () => message.responseSince!, response: true });
        }
        const next = read.value.nextCursor ?? undefined;
        if (next === undefined) break;
        if (next === cursor) throw new Error('input cursor did not advance');
        cursor = next;
      }
    }
    const readRoutedReplies = deps.messages.readRoutedReplies;
    if (!notifyOnly && readRoutedReplies !== undefined) {
      let cursor: string | undefined;
      while (!signal.aborted) {
        const read = await readRoutedReplies(ctx, { handler: sessionRef, page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
        if (read.status !== 'ready') throw new Error(`input index unavailable: ${read.status}`);
        for (const message of read.value.items) {
          if (message.status !== 'responded' || message.response === null) continue;
          merged.push({ message, cursor: () => message.responseSince!, response: true });
        }
        const next = read.value.nextCursor ?? undefined;
        if (next === undefined) break;
        if (next === cursor) throw new Error('input cursor did not advance');
        cursor = next;
      }
    }
    merged.sort(compareInputCandidates);
    for (const candidate of merged) {
      if (signal.aborted) return results;
      if (candidate.response) {
        // The response renderer applies the one wait-bound drop rule; an
        // intervention never consumes an open/answered wait's reply.
        await readResponse(ctx, candidate.message, seen, results);
      } else {
        if (intervention && candidate.message.intent === 'action_request') continue;
        await readMessagePart(ctx, candidate.message, seen, results);
      }
    }

    if (deps.controlInputs !== undefined) {
      for (const item of await deps.controlInputs(point, { signal })) if (!seen.has(item.inputId)) { seen.add(item.inputId); results.push(item); }
    }
    return results;
  };
}

/**
 * K3 L13: the review/proposal round's input channel. It carries ONLY the
 * trusted control inputs for this round: Session letters and saved replies are
 * deliberately not supplied (they stay for the later continuation), so the
 * read-only round neither answers nor consumes them.
 */
export function createControlOnlyInputSupply(controlInputs: InputSupply): InputSupply {
  return async (point, { signal }) => {
    if (signal.aborted) return [];
    return controlInputs(point, { signal });
  };
}

/** Confirm only original committed Kernel input facts, not Host delivery. */
export async function confirmMailboxInputs(
  messages: Pick<SessionMailboxPort, 'recordInputAccepted'> | undefined,
  ctx: CoreCallContext, executionRef: RunRef | QueryRunRef,
  kernel: KernelExecutionBinding,
  decoded: readonly { position: number; record: KernelSessionRecord }[],
): Promise<boolean> {
  for (const item of decoded) {
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.type !== 'run.input_accepted' || event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    const source = event.payload.input.sourceRef as { kind?: string; messageRef?: SessionMessage['ref']; part?: InputPart } | null;
    if (source?.kind !== 'SessionMessage') continue;
    if (!source.messageRef || (source.part !== 'message' && source.part !== 'response' && source.part !== 'expiry')
      || event.payload.input.inputId !== deriveInputId(source.messageRef, source.part) || !messages?.recordInputAccepted) return false;
    try {
      const result = await messages.recordInputAccepted(ctx, {
        input: { messageRef: source.messageRef, part: source.part, executionRef, kernel: { ...kernel, position: item.position } },
        meta: { requestId: `input-accepted:${kernel.kernelSessionId}:${kernel.runId}:${item.position}`, expected: [] },
      });
      if (result.status !== 'committed') return false;
    } catch { return false; }
  }
  return true;
}
