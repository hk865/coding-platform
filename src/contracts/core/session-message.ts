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
import type { CoreRejection } from './results.js';
import type { SessionRef, VersionPin } from './identity.js';

export type SessionMessageRef = {
  aggregateType: 'SessionMessage';
  projectId: string;
  workspaceId: string;
  messageId: string;
};

/**
 * 发送方的显式通信意图。意图、是否需要回复、发送后是否立即等待是三件独立事实，
 * 不能由单一字段隐式表达，也不能让平台把通知自动升级成行动授权。
 */
export type SessionMessageIntentV1 = 'notify' | 'inquiry' | 'action_request' | 'decision_request';

/** 归一后的通信意图契约。 */
export type SessionMessageIntentFields = {
  intent?: SessionMessageIntentV1;
  needsReply?: boolean;
  waitAfterSend?: boolean;
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
/** The message's release state; the record's stored `delivery` is 7B's separate value. */
export type MessageReleaseV1 = 'awaiting' | 'approved' | 'released' | 'denied';
/** The derived delivery triple, recomputed on read and never stored. */
export type MessageDeliveryStateV1 = {
  delivery: 'queued' | 'delivered' | 'undelivered';
  deliveredTo: { executionRef: RunRef | QueryRunRef; acceptedAt: string } | null;
  evidence: 'accepted' | 'legacy_unknown' | null;
  undeliveredReason: 'recipient_archived' | 'recipient_retired' | null;
};
export type MessageReadDispositionV1 =
  | { kind: 'offerable' }
  | { kind: 'not_released'; release: 'awaiting' | 'approved' | 'denied' }
  | { kind: 'withdrawn' }
  | { kind: 'delivered'; evidence: 'accepted' | 'legacy_unknown' }
  | { kind: 'undelivered'; reason: 'recipient_archived' | 'recipient_retired' };

export type DecisionApplicationV1 = {
  schemaVersion: 1; actor: ActorRef; appliedAt: string;
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
