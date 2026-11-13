import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import type { ToolCommitLookupInput, ToolCommitLookupResult } from '../../../contracts/unknown-call-review.js';
import type { PreparedCommit, RecordGuard } from '../../record-store/ports.js';
import type { HostSendCommitLookupInput, SessionMessageSendInputV1, HostOutboxItemV1, HostOutboxKeysetV1, HostOutboxStoredItemV1, HostSystemOutboxRef, SessionMessageHostOutboxV1 } from '../model/communication-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { SessionMessageSendInput, SendUserMessageInput } from '../model/tool-commit-arguments.js';
import type { HostSystemOutboxAppendedEventV1, HostSystemOutboxPendingV1 } from '../sessions/message-record-codecs.js';
import type { MailboxContext, Unknown, MailboxScope } from './mailbox-types.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { WorkspaceScopeShape } from '../../../contracts/data-format-refs.js';
import { canonicalJson, canonicalOf, sha256Hex } from '../../../contracts/fingerprint.js';
import { isNonNeg as isNonNegativeInt, isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { normalizeRespondMessageInput, normalizeSendMessageInput } from '../model/message-payload.js';
import { ackSessionMessageRequest, respondSessionMessageRequest, sendSessionMessageRequest, sendUserMessageRequest, toolCommitLookupResult, toolCommitLookupUnknownTool, toolCommitRequestId, withdrawSessionMessageRequest } from '../model/tool-commit-arguments.js';
import { commandKeys } from '../persistence/command-executor.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { lookupCommittedReceiptByIdentity } from '../persistence/receipt-lookup.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { decodeHostSystemOutboxRecord, encodeHostSystemOutboxAppendedEvent, encodeHostSystemOutboxRecord, checkHostSystemOutboxBody, S2C_HOST_OUTBOX_LOOKUP } from '../sessions/message-record-codecs.js';
import { isNonZeroPlatformCursor } from '../sessions/session-record-codecs.js';
import { eventIdOf as trustedEventIdOf } from '../sessions/trusted-context.js';
import { ownContext, ownWrite, normalizeMessageRef, senderIdentityOf, identityKeyOf, fingerprintOf } from './mailbox-common.js';
import { replaySessionMessageReceipt } from './mailbox-write.js';

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

/** The Host outbox record is keyed by `(source.position, branch)`: a retry re-writes the same item, never a second. */
function hostSystemOutboxRefOf(workspace: WorkspaceScope, item: HostOutboxStoredItemV1): HostSystemOutboxRef {
  const key = canonicalJson({ position: item.source.position, branch: item.branch } as unknown as JsonValue);
  return {
    aggregateType: 'HostSystemOutbox', projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    outboxId: 'host-system-outbox-' + sha256Hex(key),
  };
}

/** The read's `after` is the page's OWN `(order, refKey)` keyset; `null` reads from the start. */
function hostOutboxAfterOf(raw: unknown):
{ ok: true; value: HostOutboxKeysetV1 | null } | { ok: false; rejection: CoreRejection } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (!isObject(raw) || Object.keys(raw).some((key) => key !== 'order' && key !== 'refKey')) {
    return { ok: false, rejection: reject('invalid', 'readHostSystemOutbox after must be a complete ordered keyset or null') };
  }
  const order = raw['order'];
  if (!isNonZeroPlatformCursor(order) || !nonEmpty(raw['refKey'])) {
    return { ok: false, rejection: reject('invalid', 'readHostSystemOutbox after must be a complete ordered keyset or null') };
  }
  return { ok: true, value: { order, refKey: raw['refKey'] as string } };
}

/**
 * K3 L4: the Run record's `origin.sessionRef` is a `SessionAggregateRef`
 * (`aggregateType: 'Session'`), while the live `sendMessage` bound a plain
 * `SessionRef`; the Run ref keeps its `Run` tag on both sides. Normalize the
 * two refs so the rebuilt request id, sender identity and scope hash exactly
 * the identity the original Run committed.
 */
function normalizedLookupOrigin(origin: ToolCommitLookupInput['origin']): ToolCommitLookupInput['origin'] {
  return {
    runRef: { aggregateType: 'Run', projectId: origin.runRef.projectId, goalId: origin.runRef.goalId, runId: origin.runRef.runId },
    sessionRef: { projectId: origin.sessionRef.projectId, sessionId: origin.sessionRef.sessionId },
    generation: origin.generation,
    workspaceId: origin.workspaceId,
  };
}

// ---- the Host system outbox --------------------------------------------

/**
 * Read the Host system sender's own outbox in `since` order. The input is
 * validated first, then only the trusted Host is admitted; the ordered index
 * advances by the FULL `(order, refKey)` keyset, never the last cursor alone,
 * and each decoded item carries its own `(since, ordinal)` page position. An
 * empty page is a legal `{items: [], next: null}`; a damaged record is
 * `unavailable` and a store failure maps through the existing mapping.
 */
export async function readHostSystemOutbox(mailbox: MailboxContext, ctx: CoreCallContext, input: {
  workspace: WorkspaceScope; after: HostOutboxKeysetV1 | null; limit: number;
}): Promise<ReadResult<{ items: HostOutboxItemV1[]; next: HostOutboxKeysetV1 | null }>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  const raw = input as unknown as Unknown | null | undefined;
  if (!isObject(raw)) return reject('invalid', 'readHostSystemOutbox requires an input object');
  if (Object.keys(raw).some((key) => key !== 'workspace' && key !== 'after' && key !== 'limit')) {
    return reject('invalid', 'readHostSystemOutbox does not accept extra fields');
  }
  const workspaceProblem = checkShape(WorkspaceScopeShape, raw['workspace'], 'stored');
  if (workspaceProblem !== null) {
    return reject('invalid', `readHostSystemOutbox requires a complete WorkspaceScope: ${workspaceProblem}`);
  }
  if (owned.principal.kind !== 'host') {
    return reject('forbidden', 'the Host system outbox is readable only by the trusted Host');
  }
  const workspace = structuredClone(raw['workspace']) as WorkspaceScope;
  if (workspace.projectId !== owned.projectId || workspace.workspaceId !== owned.workspaceId) {
    return reject('forbidden', 'the Host system outbox workspace is not the caller scope');
  }
  const limit = raw['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return reject('invalid', 'readHostSystemOutbox limit must be an integer between 1 and 100');
  }
  const after = hostOutboxAfterOf(raw['after']);
  if (!after.ok) return after.rejection;
  if (owned.signal.aborted) return reject('cancelled', 'the Host system outbox read was cancelled');
  let page;
  try {
    page = await mailbox.records.lookupOrdered({
      index: S2C_HOST_OUTBOX_LOOKUP,
      values: [workspace.projectId, workspace.workspaceId],
      direction: 'asc',
      limit,
      ...(after.value === null ? {} : { after: after.value }),
    });
  } catch {
    return reject('unavailable', 'the Host system outbox lookup failed');
  }
  if (page.status !== 'ready') return sessionStoreFailureToRejection(page);
  const items: HostOutboxItemV1[] = [];
  for (const record of page.value.records) {
    const decoded = decodeHostSystemOutboxRecord(record);
    if (decoded.status !== 'decoded') {
      return reject('unavailable', `a Host system outbox candidate is damaged: ${decoded.reason}`);
    }
    const stored = decoded.value;
    if (canonicalOf(stored.ref) !== record.refKey
      || stored.ref.projectId !== workspace.projectId || stored.ref.workspaceId !== workspace.workspaceId) {
      return reject('unavailable', 'a Host system outbox candidate disagrees with the requested workspace');
    }
    items.push({ ...stored.item, page: { cursor: stored.since, ordinal: stored.ordinal } });
  }
  return { status: 'ready', value: { items, next: page.value.next } };
}

/**
 * Append one saved delivery item as one record commit. Only the trusted Host is
 * admitted; the returned `WriteResult` is the Store's own, so a caller can
 * tell "not committed" and must not send or advance. The record is written
 * once, before the send/card read, with the saved input; there is no update
 * path and no `delivered` flag.
 */
export async function appendHostSystemOutbox(mailbox: MailboxContext, ctx: CoreCallContext, request: GraphWrite<{
  workspace: WorkspaceScope; item: HostOutboxStoredItemV1;
}>): Promise<WriteResult<SessionMessageHostOutboxV1>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  if (owned.principal.kind !== 'host') {
    return reject('forbidden', 'the Host system outbox is writable only by the trusted Host');
  }
  if (owned.signal.aborted) return reject('cancelled', 'the Host system outbox append was cancelled before validation');
  const write = ownWrite<{ workspace: WorkspaceScope; item: HostOutboxStoredItemV1 }>(request);
  if (!write.ok) return write.rejection;
  const raw = write.input as unknown as Unknown | null | undefined;
  if (!isObject(raw)) return reject('invalid', 'appendHostSystemOutbox requires an input object');
  if (Object.keys(raw).some((key) => key !== 'workspace' && key !== 'item')) {
    return reject('invalid', 'appendHostSystemOutbox does not accept extra fields');
  }
  const workspaceProblem = checkShape(WorkspaceScopeShape, raw['workspace'], 'stored');
  if (workspaceProblem !== null) {
    return reject('invalid', `appendHostSystemOutbox requires a complete WorkspaceScope: ${workspaceProblem}`);
  }
  const workspace = structuredClone(raw['workspace']) as WorkspaceScope;
  if (workspace.projectId !== owned.projectId || workspace.workspaceId !== owned.workspaceId) {
    return reject('forbidden', 'the Host system outbox workspace is not the caller scope');
  }
  const item = structuredClone(raw['item']) as HostOutboxStoredItemV1;
  const ref = hostSystemOutboxRefOf(workspace, item);
  const record: HostSystemOutboxPendingV1 = { ref, schemaVersion: 1, revision: 1, workspace, item,
    ordinal: 0, since: null };
  const recordProblem = checkHostSystemOutboxBody(record, 'pending');
  if (recordProblem !== null) return reject('invalid', `appendHostSystemOutbox item is invalid: ${recordProblem}`);
  const refKey = canonicalJson(ref as unknown as JsonValue);
  const senderIdentity = senderIdentityOf({ kind: 'host', actor: { ...owned.principal.actor } });
  const identityKey = identityKeyOf('host-system-outbox', workspace, senderIdentity, write.requestId);
  const fingerprint = fingerprintOf('host-system-outbox', workspace, senderIdentity, record, write.expected);
  const guards: RecordGuard[] = [{ refKey, expectedRevision: null }];
  for (const pin of write.expected) {
    if (!isObject(pin) || !isObject(pin.ref) || !isNonNegativeInt(pin.revision)) {
      return reject('invalid', 'appendHostSystemOutbox requires complete, non-negative-integer version pins');
    }
    const pinKey = canonicalOf(pin.ref);
    if (pinKey === null) return reject('invalid', 'a Host system outbox version pin ref is not canonicalizable JSON');
    guards.push({ refKey: pinKey, expectedRevision: pin.revision === 0 ? null : pin.revision });
  }
  const merged = mergeGuards(guards);
  if (!merged.ok) return merged.rejection;
  const event: HostSystemOutboxAppendedEventV1 = {
    eventId: trustedEventIdOf(identityKey, 'HostSystemOutboxAppended'),
    eventType: 'HostSystemOutboxAppended', schemaVersion: 1, occurredAt: mailbox.deps.now(), hostOutbox: record,
  };
  const prepared: PreparedCommit = {
    identityKey, fingerprint, guards: merged.guards,
    records: [encodeHostSystemOutboxRecord(record)],
    claims: [], indexGuards: [], indexChanges: [],
    events: [encodeHostSystemOutboxAppendedEvent(event)],
    commitCursorBindings: [{ refKey, field: 'since' }],
  };
  if (owned.signal.aborted) return reject('cancelled', 'the Host system outbox append was cancelled before commit');
  let receipt;
  try {
    receipt = await mailbox.records.commit(prepared);
  } catch {
    return reject('unavailable', 'the Host system outbox commit failed before completing');
  }
  if (receipt.status !== 'committed') return sessionStoreFailureToRejection(receipt);
  return {
    status: 'committed', value: { ...record, since: receipt.cursor }, replayed: receipt.replayed, cursor: receipt.cursor,
  };
}

// ---- L4 lookupToolCommit -------------------------------------------------

/**
 * K3 L4: the sender identity the original Run recorded, rebuilt from the
 * trusted `origin` (the Run record's provenance) rather than from the ctx of
 * the reconcile caller. `senderIdentityOf` ignores the Role binding, so the
 * four `origin` fields reproduce exactly what `sendMessage` committed.
 */
function workRunSenderIdentityOf(mailbox: MailboxContext, origin: ToolCommitLookupInput['origin']): Unknown {
  return {
    kind: 'work_run',
    sessionRef: { projectId: origin.sessionRef.projectId, sessionId: origin.sessionRef.sessionId },
    runRef: { aggregateType: 'Run', projectId: origin.runRef.projectId, goalId: origin.runRef.goalId, runId: origin.runRef.runId },
    generation: origin.generation,
  };
}

/**
 * K3 L4: the read-only committed-receipt lookup for the four row-4 mailbox
 * tools. It reuses the SAME pure "arguments -> owner request" functions and
 * the SAME module-level identity/fingerprint helpers as the real owner
 * methods, then asks `lookupCommit`; it never writes and never opens a body.
 */
export const lookupToolCommit: (
  mailbox: MailboxContext, ctx: CoreCallContext, input: ToolCommitLookupInput,
) => Promise<ToolCommitLookupResult> = async (
  mailbox: MailboxContext, ctx: CoreCallContext, input: ToolCommitLookupInput,
): Promise<ToolCommitLookupResult> => {
  const owned = ownContext(ctx);
  if (!owned.ok) return { status: 'undetermined', reason: owned.rejection.reason };
  const args = input.arguments;
  if (!isObject(args)) return { status: 'undetermined', reason: 'invalid_arguments' };
  // K3 L4: rebuild the whole lookup identity from the ORIGINAL Run's
  // provenance, not from the reconcile caller's ctx/principal.
  const origin = normalizedLookupOrigin(input.origin);
  const requestId = toolCommitRequestId({ ...input, origin });
  let operation: string;
  let payload: Unknown;
  let expected: readonly VersionPin[];
  try {
    switch (input.toolName) {
      case 'send_session_message': {
        const request = sendSessionMessageRequest(args as unknown as SessionMessageSendInput, requestId);
        // The one normalized payload is the fingerprint's payload on both the
        // write and this lookup, so the same arguments hash identically.
        const normalized = normalizeSendMessageInput(request.input);
        if (normalized.status !== 'ready') throw new Error('invalid_arguments');
        operation = 'send';
        expected = request.meta.expected;
        payload = normalized.value;
        break;
      }
      case 'ack_session_message': {
        const input2 = args as unknown as { messageRef: SessionMessageRef; expectedRevision: number };
        const request = ackSessionMessageRequest(input2, requestId);
        operation = 'ack';
        expected = request.meta.expected;
        payload = { messageRef: request.input.messageRef };
        break;
      }
      case 'respond_session_message': {
        const normalized = normalizeRespondMessageInput(args);
        if (normalized.status !== 'ready') throw new Error('invalid_arguments');
        const request = respondSessionMessageRequest(normalized.value, requestId);
        operation = 'respond';
        expected = request.meta.expected;
        payload = request.input;
        break;
      }
      case 'send_user_message': {
        const request = sendUserMessageRequest(args as unknown as SendUserMessageInput, requestId);
        operation = 'user-send';
        expected = request.meta.expected;
        const wire = request.input;
        payload = {
          goalRef: wire.goalRef, intent: wire.intent, text: wire.text,
          needsReply: wire.needsReply, waitAfterSend: wire.waitAfterSend,
          options: wire.options, objects: wire.objects,
          ...(wire.forwardedFrom === undefined ? {} : { forwardedFrom: wire.forwardedFrom }),
        };
        break;
      }
      case 'withdraw_session_message': {
        // The withdraw write is one R2 command (`message.withdraw`): reuse its
        // commandKeys, principal and `{messageRef}` fingerprint, never the send
        // identity algorithm above.
        const normalized = normalizeMessageRef((args as { messageRef?: unknown }).messageRef);
        if (!normalized.ok) throw new Error('invalid_arguments');
        const ref = normalized.ref;
        if (ref.projectId !== origin.runRef.projectId || ref.workspaceId !== origin.workspaceId) {
          throw new Error('invalid_arguments');
        }
        const request = withdrawSessionMessageRequest({ messageRef: ref }, requestId);
        const keys = commandKeys({
          operation: 'message.withdraw',
          scope: { projectId: origin.runRef.projectId, workspaceId: origin.workspaceId },
          principal: principalIdentity({ kind: 'work_run', runRef: origin.runRef }),
          commandId: request.meta.requestId,
          fingerprintInput: { messageRef: ref },
        });
        return toolCommitLookupResult(await mailbox.records.lookupCommit(keys));
      }
      default:
        return toolCommitLookupUnknownTool(input.toolName);
    }
  } catch {
    return { status: 'undetermined', reason: 'invalid_arguments' };
  }
  // K3 L4: the committed row belongs to the ORIGINAL Run, so both the sender
  // identity and the identity/fingerprint scope come from `input.origin` (the
  // Run record's provenance). A Host reconcile ctx must not substitute the
  // Host principal's identity here.
  const senderIdentity = workRunSenderIdentityOf(mailbox, origin);
  const scope: MailboxScope = { projectId: origin.runRef.projectId, workspaceId: origin.workspaceId };
  const identityKey = identityKeyOf(operation, scope, senderIdentity, requestId);
  const fingerprint = fingerprintOf(operation, scope, senderIdentity, payload, expected);
  let lookup: Awaited<ReturnType<typeof mailbox.records.lookupCommit>>;
  try {
    lookup = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  } catch {
    return { status: 'undetermined', reason: 'the mailbox receipt lookup failed' };
  }
  return toolCommitLookupResult(lookup);
};

// ---- D-L1-3 Host-send receipt read ---------------------------------------

/** The Host send's own committed-receipt read: identity-only, so a recipient that changed since the send never
 * changes the answer; it never writes and carries no Run origin. */
export const lookupHostSendCommit: (
  mailbox: MailboxContext, ctx: CoreCallContext, input: HostSendCommitLookupInput,
) => Promise<ToolCommitLookupResult> = async (
  mailbox: MailboxContext, ctx: CoreCallContext, input: HostSendCommitLookupInput,
): Promise<ToolCommitLookupResult> => {
  const owned = ownContext(ctx);
  if (!owned.ok) return { status: 'undetermined', reason: owned.rejection.reason };
  if (owned.principal.kind !== 'host') return { status: 'undetermined', reason: 'not_a_host_send' };
  try {
    const write = ownWrite<SessionMessageSendInputV1['input']>({
      input: input.arguments as SessionMessageSendInputV1['input'],
      meta: { requestId: input.requestId, expected: [] } });
    if (!write.ok) return { status: 'undetermined', reason: write.rejection.reason };
    // Argument validation only; the identity is the original send's, never a current payload.
    const send = normalizeSendMessageInput(write.input);
    if (send.status !== 'ready') return { status: 'undetermined', reason: 'invalid_arguments' };
    const senderIdentity = senderIdentityOf({ kind: 'host', actor: { ...owned.principal.actor } });
    const identityKey = identityKeyOf('send', input.scope, senderIdentity, input.requestId);
    if (mailbox.deps.commitIdentities === undefined) {
      return { status: 'undetermined', reason: 'the commit-identity read is not configured' };
    }
    // Identity-only replay: the existing commit identity answers even when the recipient changed.
    const found = await lookupCommittedReceiptByIdentity(mailbox.deps.commitIdentities, identityKey);
    if (found.status === 'found') {
      return { status: 'committed', cursor: found.receipt.cursor as CommitCursor,
        eventIds: [...found.receipt.eventIds] };
    }
    if (found.status === 'missing') return { status: 'not_committed' };
    return { status: 'undetermined', reason: found.reason };
  } catch {
    return { status: 'undetermined', reason: 'the mailbox receipt lookup failed' };
  }
};

/**
 * The Host send's real message ref (X-3): the same identity-only receipt read, then the receipt's own event replayed.
 * A Host send's id comes from the sender's scope while its record lives in the recipient line's workspace, so a ref
 * built from the request id alone is right only when the two are one workspace. Only the Host reads its own sends
 * (safety: the receipt is the Host's own). `not_found` is "never sent"; a failed read is its rejection.
 */
export const readHostSendMessageRef = async (
  mailbox: MailboxContext, ctx: CoreCallContext, input: { requestId: string; scope: WorkspaceScope },
): Promise<ReadResult<SessionMessageRef>> => {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  if (owned.principal.kind !== 'host') return reject('forbidden', 'only the Host reads its own send receipt');
  if (mailbox.deps.commitIdentities === undefined) {
    return reject('unsupported', 'the commit-identity read is not configured');
  }
  const identityKey = identityKeyOf('send', input.scope,
    senderIdentityOf({ kind: 'host', actor: { ...owned.principal.actor } }), input.requestId);
  const found = await lookupCommittedReceiptByIdentity(mailbox.deps.commitIdentities, identityKey);
  if (found.status === 'missing') return { status: 'not_found' };
  if (found.status !== 'found') return reject('unavailable', found.reason);
  const replayed = await replaySessionMessageReceipt(mailbox.records, found.receipt);
  if (replayed.status !== 'committed') return replayed;
  return { status: 'ready', value: { ...replayed.value.ref } };
};
