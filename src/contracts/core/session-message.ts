// C1 shared address contract.
//
// This is the ONLY C1 declaration that lives in the shared `contracts/` layer:
// `ledger.ts` widens its closed `AggregateRef` union with this reference, so the
// address must be importable without pulling in WorkGraph modules. All other
// SessionMailbox DTOs stay in `core/work-graph/model/communication-contracts.ts`.
//
// A SessionMessage is addressed by its FULL aggregate ref. `messageId` alone is
// never an address and never an authorization: project/workspace scope is part
// of the identity, exactly like every other persisted aggregate ref.
import type { ArtifactRef } from '../artifact.js';
import type { ActorRef, CommitCursor } from '../command-event.js';
import { canonicalJson, sha256Hex } from '../fingerprint.js';
import type { RunRef, SourceRefV1 } from '../dispatch.js';
import type {
  DecisionAnnotationV1,
  DecisionObjectV1,
  DecisionOptionV1,
  DecisionSelectionV1,
  DecisionSourceV1,
  GoalControlRebaseV1,
} from '../goal-decisions.js';
import type { AggregateRef, DispatchCurrentV1 } from '../ledger.js';
import type { QueryRunRef } from '../query-job.js';
import type { ReworkActorV1 } from '../task-requeue.js';
import type { CoreRejection, WriteResult } from './results.js';
import type { SessionRef, VersionPin } from './identity.js';

export type SessionMessageRef = {
  aggregateType: 'SessionMessage';
  projectId: string;
  workspaceId: string;
  messageId: string;
};

/**
 * The trusted entry a Host human message was written from. Only the direct-intervention entry carries B20 rights;
 * agent and platform messages never carry it. The Host writes it at the entry, never from model input.
 */
export type MessageEntryV1 = 'person_intervention';

/**
 * Who writes the message's one reply slot: the original line, or the formal answer to a consultation copy. A copy
 * question is `copy` from intake, so the original line is never offered it.
 */
export type MessageAnsweredByV1 = 'line' | 'copy';

/** The independent send facts: a reply need, a yield, the wake choice, and the two persisted entry facts. */
export type SessionMessageSendFields = {
  needsReply?: boolean;
  waitAfterSend?: boolean;
  wake?: boolean;
  answeredBy?: MessageAnsweredByV1;
  entry?: MessageEntryV1;
};

/**
 * A user recipient is NOT a Session: it carries the workspace address of the
 * operator it belongs to and never a Session id (spec §2.3). The workspace
 * fields are the real ownership scope, not a fabricated Session.
 */
export type UserMessageRecipientV1 = {
  kind: 'user'; projectId: string; workspaceId: string;
};

/** A message is addressed either to a Session or to the workspace's user. */
export type MessageRecipient = SessionRef | UserMessageRecipientV1;

/**
 * Trusted host sender for a user-facing decision/notification message. It is
 * shape-identical to the model's `MessageHostSender`; the model keeps a
 * compatibility alias so the body value does not change (spec §2.3).
 */
export type DecisionHostSenderV1 = {
  kind: 'host';
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
};

/** The decision metadata a `decision_request` (or synthetic answer) message carries. */
export type DecisionMessageMetadataV1 = {
  schemaVersion: 1; source: DecisionSourceV1;
  objects: DecisionObjectV1[]; options: DecisionOptionV1[];
  syntheticAnswer: boolean; forwardedFrom: SessionMessageRef | null;
};

/**
 * The user's answer lives in the original message's response slot. Its
 * `decision.source` is the canonical source/pins THIS answer was taken against,
 * not the question-time metadata (spec §2.3).
 */
export type UserMessageResponseV1 = {
  sender: DecisionHostSenderV1;
  bodyRef: ArtifactRef; sourceRef: SourceRefV1; respondedAt: string;
  decision: {
    selection: DecisionSelectionV1; source: DecisionSourceV1;
    annotations: DecisionAnnotationV1[];
    requiresApplication: boolean;
  };
};

export type DecisionApplicationReceiptV1 = {
  identityKey: string; fingerprint: string; cursor: CommitCursor;
};

/**
 * 7A §3.5 item 2: an effect owner's committed result carries the receipt a message proof cites. Present exactly
 * when the call carried an acknowledgement and the effect committed (first success, replay, recovery); absent on
 * a call without one (whose result is unchanged), on a committed policy refusal and on every rejection.
 */
export type EffectWriteResultV1<T> =
  | (Extract<WriteResult<T>, { status: 'committed' }> & { proofReceipt?: DecisionApplicationReceiptV1 })
  | CoreRejection;

/** The message's effect proof; never shares the old `application` field. */
export type ApplicationProofV1 = {
  receipt: DecisionApplicationReceiptV1;
  effect: {
    kind: 'claim_created' | 'proposal_created' | 'requeue' | 'recheck' | 'member_created';
    ref: AggregateRef;
  };
};
/** The send's rejection; `dispatchCurrent` is the one consistent read's values plus its own cursor. */
export type SendRejectionV1 = CoreRejection & { dispatchCurrent?: DispatchCurrentV1 };

// The pure DTOs that cross layers: `W/state`, `W/views` and `C/work-line.ts` all name them, so they are
// declared in C and only re-exported by the model; C imports no W module.
/** The derived delivery triple, recomputed on read and never stored. */
export type MessageDeliveryStateV1 = {
  delivery: 'queued' | 'delivered' | 'undelivered';
  deliveredTo: { executionRef: RunRef | QueryRunRef; acceptedAt: string } | null;
  evidence: 'accepted' | null;
  undeliveredReason: 'recipient_archived' | 'recipient_retired' | null;
};
export type MessageReadDispositionV1 =
  | { kind: 'offerable' }                    // the original line may still deliver it
  | { kind: 'answered' }                    // a formal reply is saved; it is never offered again
  | { kind: 'copy' }                        // a copy question, consumed only by its copy identity
  | { kind: 'withdrawn' }
  | { kind: 'delivered'; evidence: 'accepted' }
  | { kind: 'undelivered'; reason: 'recipient_archived' | 'recipient_retired' };

/**
 * The round's formal `no_answer` conclusion, read beside the message: the other side ended this round without a
 * reply. It is its own fact, never a disposition: a reply, a withdrawal and Kernel acceptance keep their own facts,
 * and the sender's unanswered state and original deadline are unchanged (the wait still expires on its own).
 */
export type MessageRoundEndingV1 = { kind: 'no_answer' };

/** The closing reasons of a finished intervention round. `questions` sends no notice: the cards carry them. */
export const INTERVENTION_CLOSING_REASONS = [
  'invalid_plan', 'declined', 'no_answer', 'answered', 'candidate', 'adopted',
] as const;
export type InterventionClosingReasonV1 = (typeof INTERVENTION_CLOSING_REASONS)[number];

/**
 * The ONE fixed platform identity of the Host's automatic notices (a finished round's close-out, an expiry, a
 * "please note"): a system actor, never the configured operator and never an agent line. It is deliberately not
 * `SYSTEM_ROUND_ACTOR`: a notice is not a round, opens none, and must not read as one; its sender, its receipt and
 * every reader of that receipt use this one identity.
 */
export const PLATFORM_NOTICE_ACTOR = Object.freeze({ kind: 'system' as const, id: 'host:platform-notice' });

/**
 * The fixed identity of one round's closing notice: the source message's canonical key plus the round's frozen
 * source part. A card-answer round hashes `{ messageRef, part }` exactly as `interventionPlanningQueryRefs` does,
 * so its notice never collides with the message round's; the default keeps the existing identity. One declaration:
 * the notice writer and every receipt reader import this one.
 */
export function interventionClosingNoticeRequestId(messageRef: SessionMessageRef,
    reason: InterventionClosingReasonV1, part: 'message' | 'decision_answer' = 'message'): string {
  const key = part === 'message' ? canonicalJson(messageRef as never)
    : sha256Hex(canonicalJson({ messageRef, part } as never));
  return `intervention:${key}:notice:${reason}`;
}

export type DecisionApplicationV1 = {
  // `actor` 是落实这次决定的那次提交的 actor；批准参谋规划轮的返工请求时是那一轮（Q10a，返工这一族的形状）。
  schemaVersion: 1; actor: ReworkActorV1; appliedAt: string;
  receipt: DecisionApplicationReceiptV1;
  changes: { before: VersionPin; after: VersionPin }[]; basisRebases?: GoalControlRebaseV1[];
};

/** Pure discriminator: true only for the user recipient, never derived from ids. */
export function isUserMessageRecipient(recipient: MessageRecipient): recipient is UserMessageRecipientV1 {
  // A SessionRef has no `kind`; only the user address carries it. The check is
  // structural and never derives the recipient from project/workspace ids.
  return typeof recipient === 'object' && recipient !== null
    && (recipient as { kind?: unknown }).kind === 'user';
}
