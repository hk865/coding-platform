/**
 * Unified execution-input channel.
 *
 * One stable identity per ORIGINAL persisted source (SessionMessage ref + part)
 * is shared by ordinary mail, saved replies, steer and mechanical attention. The
 * Kernel reports these candidates at a real drained `before_model` boundary and
 * commits `run.input_accepted`; this module only READS applicable candidates and
 * excludes anything the original message already records as accepted by an
 * earlier execution. It never marks consumption and never writes "processed".
 *
 * The prior yielded Run's reply is read through the formal `consumedWait`
 * association (`readMessage`/`readMessageBody` are SESSION-scoped, so a new Run
 * in the same Session can read it). Session-scoped outbox discovery also
 * supplies asynchronous replies from earlier Runs through the same channel.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import type { UserDecisionBodyV1 } from '../../contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../../contracts/prompts/render-template.js';
import type { SessionRecord as KernelSessionRecord } from '../../../vendor/coding-agent/dist/public-api.js';
import type { KernelExecutionBinding } from '../work-graph/model/execution-entry-contracts.js';
import type { RunRef } from '../../contracts/dispatch.js';
import { deriveSessionInputId, type SessionMailboxPort, type SessionMessage } from '../work-graph/model/communication-contracts.js';

export type InputPart = 'message' | 'response';

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
 * without a prose guess. `createMailboxInputSupply` uses this formatter for a
 * new user response and keeps the historical raw `body.text` for an old reply.
 * Part 1 fixes the signature only; Part 2 supplies the canonical encoding.
 */
export function formatDecisionResponseInput(body: UserDecisionBodyV1): string {
  return renderTemplate(PLATFORM_PROMPT_PACK_V1, 'user-decision-response',
    { bodyJson: canonicalJson(body as unknown as JsonValue) }, []).text;
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
  /** The exact prior yielded Run + saved wait message this Run consumes. */
  consumedWait?: { runRef: RunRef; messageRef: SessionMessage['ref'] } | undefined;
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
    // §2.5: the effective reply handler is the recorded `replyHandler` when set,
    // otherwise the original work_run sender. A transferred reply is supplied
    // only to the handler, never to the original sender (`readOutbox`).
    if (message.replyHandler != null && !sameSession(message.replyHandler.sessionRef, sessionRef)) return;
    const inputId = deriveInputId(message.ref, 'response');
    if (seen.has(inputId) || alreadyAcceptedBySource(message, inputId)) return;
    const body = await deps.messages.readMessageBody(ctx, { messageRef: message.ref, part: 'response' });
    if (body.status !== 'ready') throw new Error(`input body unavailable: ${body.status}`);
    const decisionBody = decisionResponseBody(message, body.value.text);
    seen.add(inputId);
    results.push({ inputId, text: decisionBody === null ? body.value.text : formatDecisionResponseInput(decisionBody),
      sourceRef: sourceRef(message.ref, 'response') });
  };
  const readMessagePart = async (ctx: CoreCallContext, message: SessionMessage, seen: Set<string>,
    results: SuppliedInput[]): Promise<void> => {
    if (message.intent === 'inquiry') return;
    const inputId = deriveInputId(message.ref, 'message');
    if (seen.has(inputId) || alreadyAcceptedBySource(message, inputId)) return;
    const body = await deps.messages.readMessageBody(ctx, { messageRef: message.ref, part: 'message' });
    if (body.status !== 'ready') throw new Error(`input body unavailable: ${body.status}`);
    seen.add(inputId);
    results.push({ inputId, text: body.value.text, sourceRef: sourceRef(message.ref, 'message') });
  };

  return async (point, { signal }) => {
    if (signal.aborted) return [];
    const ctx = { ...deps.context(), signal };
    const results: SuppliedInput[] = [];
    const seen = new Set<string>();

    // 1. The exact saved reply the prior yielded Run bound, read by its ORIGINAL
    //    message identity (Session-scoped), not by scanning another Run's outbox.
    if (deps.consumedWait !== undefined) {
      const read = await deps.messages.readMessage(ctx, deps.consumedWait.messageRef);
      if (read.status !== 'ready') throw new Error(`saved wait message unavailable: ${read.status}`);
      if (read.value.sender.kind !== 'work_run' || read.value.sender.sessionRef.sessionId !== deps.sessionRef.sessionId
        || read.value.sender.sessionRef.projectId !== deps.sessionRef.projectId
        || read.value.sender.runRef.projectId !== deps.consumedWait.runRef.projectId
        || read.value.sender.runRef.goalId !== deps.consumedWait.runRef.goalId
        || read.value.sender.runRef.runId !== deps.consumedWait.runRef.runId) throw new Error('saved wait does not belong to the original Session/Run');
      await readResponse(ctx, read.value, seen, results);
    }

    // 2. Saved replies addressed back to this Session, including earlier Runs.
    const readOutbox = deps.messages.readOutbox;
    if (readOutbox !== undefined) {
      let cursor: string | undefined;
      // Read to the real end of the source; a non-advancing cursor stops us.
      while (!signal.aborted) {
        const read = await readOutbox(ctx, { senderSession: sessionRef, page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
        if (read.status !== 'ready') throw new Error(`input index unavailable: ${read.status}`);
        for (const message of read.value.items) {
          if (signal.aborted) return results;
          await readResponse(ctx, message, seen, results);
        }
        const next = read.value.nextCursor ?? undefined;
        if (next === undefined) break;
        if (next === cursor) throw new Error('input cursor did not advance');
        cursor = next;
      }
    }

    // 2b. Slice 1 §2.5: replies whose effective reply handler is this Session (a
    //     wait transferred to it). The same `readResponse`, the same original
    //     messageRef and the same `deriveSessionInputId(...,'response')` identity
    //     as the outbox, so a page that repeats a candidate is supplied once.
    const readRoutedReplies = deps.messages.readRoutedReplies;
    if (readRoutedReplies !== undefined) {
      let cursor: string | undefined;
      while (!signal.aborted) {
        const read = await readRoutedReplies(ctx, { handler: sessionRef, page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
        if (read.status !== 'ready') throw new Error(`input index unavailable: ${read.status}`);
        for (const message of read.value.items) {
          if (signal.aborted) return results;
          await readResponse(ctx, message, seen, results);
        }
        const next = read.value.nextCursor ?? undefined;
        if (next === undefined) break;
        if (next === cursor) throw new Error('input cursor did not advance');
        cursor = next;
      }
    }

    // 3. Ordinary mail addressed to this execution's Session.
    let cursor: string | undefined;
    while (!signal.aborted) {
      const read = await deps.messages.readInbox(ctx, { recipient: sessionRef, page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
      if (read.status !== 'ready') throw new Error(`input index unavailable: ${read.status}`);
      for (const message of read.value.items) {
        if (signal.aborted) return results;
        await readMessagePart(ctx, message, seen, results);
      }
      const next = read.value.nextCursor ?? undefined;
      if (next === undefined) break;
      if (next === cursor) throw new Error('input cursor did not advance');
      cursor = next;
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
    if (!source.messageRef || (source.part !== 'message' && source.part !== 'response')
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
