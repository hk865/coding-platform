// src/core/work-graph/communication/message-apply.ts — 7A §3.5 (S7-MSG-09) and §3.13 `message.apply`
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { canonicalOf } from '../../../contracts/fingerprint.js';
import type { ApplicationProofV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import type { MessageCommandWritePort, S5RecordPort } from '../model/decision-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import { executeWriteCommand, type WriteCommand } from '../persistence/command-executor.js';
import { sameRef } from '../state/ref-equality.js';
import { applicationProofProblem, sessionMessageFromEvent } from '../sessions/message-record-codecs.js';
import { sessionMessageRefProblem } from '../tasks/codec-shape-checks.js';
import { decodeProofEvent, readFormalReceiptEvent, type EffectProofV1 } from './decision-application.js';
import {
  eventIdOf, mapReadResult, messageVersionAgainstReceipt, messageWriteResult, ownContext,
  readSessionMessageRecord, type Owned,
} from './mailbox-service.js';

/**
 * 7A §3.5 (S7-MSG-09): the caller's own statement of the effect. `messageRef` and `proof` are compared with the formal
 * receipt; never trusted. `commandId` is `meta.requestId` (`book-7a.md:228`'s `commandId`, the tree's `GraphWrite`
 * mapping, `W/model/task-contracts.ts:28`).
 */
export type MessageApplyInput = { messageRef: SessionMessageRef; proof: ApplicationProofV1 };

export type MessageApplyDependencies = {
  /** The receipt facts, the message read and the one commit (§3.13 `message.apply`'s facts read). */
  records: S5RecordPort;
  /** The ONE message commit writer's non-committing `prepare` (§3.11, `book-7a.md:450–:455`). */
  messageWrites: MessageCommandWritePort;
  /** This commit's own `occurredAt`; `appliedAt` is never the clock (`book-7a.md:251`). */
  now: () => string;
};

/**
 * D8-23 (§3.12 L's publication): the one method L's assembly publishes as `platform.messages.applyMessage`. P declares
 * the type here and L uses this name verbatim (D8-27); it is **not** `SessionMessageCommandPort`
 * (`W/model/communication-contracts.ts:364`), whose required members the mailbox owner implements (rd7a2c-02).
 */
export type MessageApplyPort = {
  applyMessage(ctx: CoreCallContext, request: GraphWrite<MessageApplyInput>): Promise<WriteResult<SessionMessage>>;
};

type ApplyFacts = { message: SessionMessage; appliedAt: string; effect: EffectProofV1 };
type ApplyDecision = { before: SessionMessage; appliedAt: string; at: string };

/**
 * `book-7a.md:247–:249`: the apply's own codes for the shared receipt check — a receipt whose identity, fingerprint or
 * cursor the formal facts do not support is the caller's `invalid` (a receipt that is not found is the same
 * disagreement), and only a read that failed is `unavailable`. `readFormalReceiptEvent` keeps its own codes for the old
 * decision caller (`readApplicationReceiptFacts`, `decision-application.ts:160`), so this mapping lives here and only
 * here (rd7a2b-03).
 */
function applyReceiptProblem(failure: CoreRejection): CoreRejection {
  const code = failure.code === 'incomplete' || failure.code === 'revision_conflict' ? 'invalid' : 'unavailable';
  return { ...failure, code };
}

/**
 * `book-7a.md:247–:248`: a commit the store's idempotency slot holds under another fingerprint is that same
 * disagreement, not "unavailable" — the store answers `idempotency_conflict` (`record-store/in-memory-record-store.ts:443–:445`)
 * and `mapStoreFailure`'s default turns every unknown code into `unavailable` (`decision-application.ts:35–:42`). The
 * apply wraps the ONE lookup port on its way into the shared check, so the shared check and its old decision caller keep
 * their codes, the mismatch reaches `applyReceiptProblem` as `revision_conflict`, and no receipt is queried twice
 * (rd7a2b-13). The `current` list the store's refusal shape requires never leaves this wrapper: `mapStoreFailure`
 * projects `revision_conflict` with `rejectedWithCurrent` and drops it.
 */
function applyRecords(records: S5RecordPort): Pick<S5RecordPort, 'lookupCommit' | 'eventAt'> {
  return {
    eventAt: (cursor) => records.eventAt(cursor),
    lookupCommit: async (input) => {
      const lookup = await records.lookupCommit(input);
      return lookup.status === 'rejected' && lookup.code === 'idempotency_conflict'
        ? { status: 'rejected' as const, code: 'revision_conflict' as const, reason: lookup.reason, current: [] }
        : lookup;
    },
  };
}

/** `book-7a.md:247–:251`: the input's shape is checked FIRST — before the command's identity material is read, so a
 * `null` or partial `input` (the route guarantees only the key, `core-routes.ts:653–:690`, the test at `:663`) never
 * reaches the destructuring or the fingerprint and answers `invalid` instead (rd7a2b-14). The two shape rules are the
 * stored ones (rd7a2c-26): `sessionMessageRefProblem` (`tasks/codec-shape-checks.ts:14`) and the exported
 * `applicationProofProblem`. */
function applyInputOf(input: unknown): MessageApplyInput | CoreRejection {
  const raw = input as { messageRef?: unknown; proof?: unknown } | null | undefined;
  const refProblem = sessionMessageRefProblem(raw?.messageRef, 'applyMessage messageRef');
  if (refProblem !== null) return reject('invalid', refProblem);
  // `book-7a.md:228`: this entry always carries the caller's effect. The `null` arm `applicationProofProblem` admits is
  // the stored message's "no proof yet" slot, never this call's input.
  if (raw?.proof === null || raw?.proof === undefined) return reject('invalid', 'applyMessage requires the effect proof');
  const proofProblem = applicationProofProblem(raw.proof);
  if (proofProblem !== null) return reject('invalid', proofProblem);
  return { messageRef: raw.messageRef as SessionMessageRef, proof: raw.proof as ApplicationProofV1 };
}

/** `book-7a.md:247–:251`: the shape was checked at the entry (§5.2.1's `applyInputOf`); here the receipt is read and its
 * failure is the failure (never "not applied"), then the decoded effect is compared with the caller's. Module-scope,
 * taking the owner's dependencies, so `createMessageApplyOwner` stays a factory over one bag (`D8-27`). */
async function readApplyFactsOf(deps: MessageApplyDependencies, owned: Owned, input: MessageApplyInput):
Promise<{ status: 'ready'; facts: ApplyFacts } | CoreRejection> {
  const { messageRef: ref, proof } = input;
  const loaded = mapReadResult(await readSessionMessageRecord(deps.records, owned.signal, ref));
  // rd7a2b-10: `mapReadResult` already answers a missing message `not_found` (`book-7a.md:249`) and `not_ready`
  // `incomplete` (`mailbox-service.ts:180–:184`), so the arms left here are `ready` and that rejection; the tree's own
  // narrowing names the second (`:2725`, `message-release.ts:111`) and no arm is written for the two it has turned.
  if (loaded.status !== 'ready') return loaded as CoreRejection;
  const checked = await readFormalReceiptEvent(applyRecords(deps.records), proof.receipt);       // :229–:232, the one copy
  if (checked.status !== 'ready') return applyReceiptProblem(checked as CoreRejection);
  const decoded = decodeProofEvent(checked.value.event, checked.value.commit);
  if ('status' in decoded) return decoded as CoreRejection;                                      // the decoder's own refusal
  const effect = decoded.effect;
  if (effect === undefined) return reject('invalid', 'the receipt is not one of the effect events');
  if (effect.kind !== proof.effect.kind) return reject('invalid', 'the receipt is not the effect kind the caller names');
  if (canonicalOf(effect.ref) !== canonicalOf(proof.effect.ref)) return reject('invalid', 'the receipt names another effect ref');
  if (effect.acknowledgement === undefined) return reject('invalid', 'the effect carries no acknowledgement');   // :248
  if (canonicalOf(effect.acknowledgement) !== canonicalOf(ref)) return reject('invalid', 'the effect acknowledges another message'); // :247
  return { status: 'ready', facts: { message: loaded.value, appliedAt: decoded.appliedAt, effect } };
}

/** `book-7a.md:239–:240`: a Work caller must equal the decoded party; the person may act on behalf; the Host system is
 * never a party by itself. `party` is `RunRef | null` (§5.2.2, D8-17). */
function partyProblem(principal: CorePrincipal, party: RunRef | null): CoreRejection | null {
  if (principal.kind === 'host' && principal.actor.kind === 'human') return null;
  if (principal.kind === 'work_run' && party !== null && sameRef(principal.runRef, party)) return null;
  return reject('forbidden', 'only the effect\'s own Run or the person may apply its message');
}

/** §3.13 `message.apply`'s original-result projection: the stored application, restored from its own event. */
const appliedResult = {
  eventType: 'SessionMessageApplied' as const,
  schemaVersion: 1 as const,
  decode: sessionMessageFromEvent,
  validate: messageVersionAgainstReceipt,
  project: (decoded: SessionMessage) => decoded,
};

export function createMessageApplyOwner(deps: MessageApplyDependencies): MessageApplyPort {
  // rd7a2b-07: the entry's own bindings — `owned` from the context, the checked input, and the command id from `meta`
  // (`W/model/task-contracts.ts:28`), never from `input`.
  async function applyMessage(ctx: CoreCallContext, write: GraphWrite<MessageApplyInput>): Promise<WriteResult<SessionMessage>> {
    const owned = ownContext(ctx);
    if (!owned.ok) return owned.rejection;
    const checked = applyInputOf(write.input);                        // rd7a2b-14: the shape first, `invalid` on a miss
    if ('status' in checked) return checked;
    const { messageRef: ref, proof } = checked;
    // The five change points of `W/persistence/command-executor.ts:86–:103`.
    const command: WriteCommand<ApplyFacts, ApplyDecision, CoreRejection, SessionMessage, SessionMessage> = {
      operation: 'message.apply',
      scope: { projectId: owned.projectId, workspaceId: owned.workspaceId },
      principal: principalIdentity(owned.principal),
      commandId: write.meta.requestId,
      fingerprintInput: { messageRef: ref, proof },                     // the caller's effect is identity material
      read: () => readApplyFactsOf(deps, owned, checked),
      decide: (facts) => {
        const problem = partyProblem(owned.principal, facts.effect.party);
        if (problem !== null) return { refuse: problem };
        return { decision: { before: facts.message, appliedAt: facts.appliedAt, at: deps.now() } };
      },
      // D8-16 (c): the event keeps the message writer's own actor — the envelope's `actor: MessageSender`
      // (`W/model/decision-contracts.ts:196`) written through `lifecycleEventOf` (`mailbox-service.ts:356`, `:365`).
      build: (decision, keys) => deps.messageWrites.prepare(ctx, {
        operation: 'message.apply', messageRef: decision.before.ref, before: decision.before,
        expectedRevision: decision.before.revision,
        event: { eventId: eventIdOf(keys.identityKey, 'SessionMessageApplied'), occurredAt: decision.at,
          requestId: write.meta.requestId, projectId: owned.projectId, workspaceId: owned.workspaceId,
          actor: decision.before.sender },
        change: { kind: 'applied', appliedAt: decision.appliedAt, proof },
      }, { records: [], events: [], guards: [], claims: [] }),
      result: appliedResult,
    };
    return messageWriteResult(await executeWriteCommand(deps.records, command));
  }
  return { applyMessage };
}
