/**
 * K3 contracts: the `UnknownCallReview` aggregate and its workspace capture
 * (spec §2). Pure data only; the state machine that writes it lives in
 * `core/work-graph/state/unknown-call-review.ts`.
 */
import type { ArtifactRef } from './artifact.js';
import type { ActorRef, CommitCursor } from './command-event.js';
import type { CoreCallContext } from './core/call-context.js';
import type { SessionRef } from './core/identity.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { RunRef, TaskTriple } from './dispatch.js';

export type UnknownCallReviewRef = {
  aggregateType: 'UnknownCallReview';
  projectId: string;
  goalId: string;
  runId: string;
};

/** L2: how this Host proves the previous executor is gone. */
export type HostTakeoverProofV1 =
  | { kind: 'hl01_no_lock' }
  | { kind: 'hl03_stale_lock'; previousInstanceId: string; previousPid: number }
  | { kind: 'memory_store' };

/** L3: the fixed table's kinds. */
export type UnknownCallKindV1 = 'read_only' | 'platform' | 'file_edit' | 'process';

/** Full arguments stay by reference in the immutable Kernel record (L7). */
export type KernelCallRefV1 = {
  adapterId: string;
  kernelSessionId: string;
  kernelRunId: string;
  turnId: string;
  /** <=512 UTF-8 bytes; a longer Kernel callId is an undecodable_call and is not stored (L7, L8). */
  callId: string;
  /** The assistant message position that declared the call. */
  declaredPosition: number;
  /** The `tool.started` position. */
  startedPosition: number | null;
};

export type CapturedPathV1 = { path: string; change: 'added' | 'modified' | 'deleted' | 'mode_changed' };

export type WorkspaceCaptureV1 =
  | {
      status: 'captured';
      runBaselineKnown: boolean;
      baseCommit: string;
      headNow: string;
      /** The full `WorkspaceChangeCaptureV1` body. */
      captureRef: ArtifactRef;
      changedCount: number;
      sample: CapturedPathV1[] /* <=50 */;
      /** git-ignored, fixed-ignored and protected prefixes; <=32. */
      notVisible: string[];
      notVisibleOmitted: number;
    }
  | {
      status: 'unavailable';
      runBaselineKnown: boolean;
      reason: 'not_git' | 'no_baseline' | 'unstable' | 'too_many_changes' | 'read_failed' | 'not_configured';
      detail: string /* <=500 */;
    };

export type PlatformLookupEvidenceV1 =
  | { kind: 'receipt'; cursor: CommitCursor; eventIds: string[] /* <=8 */ }
  | { kind: 'not_committed' }
  | { kind: 'lookup_failed'; reason: string /* <=500 */ };

/**
 * L4 (spec §2 lines 1065-1069): the read-only lookup every L3 row-4 owner may
 * publish. `ctx` is the trusted call context; `input.origin` is the original
 * Run's provenance rebuilt from the Run record. A committed hit names the
 * receipt; `not_committed` is the only authoritative "did not happen".
 */
export type ToolCommitLookupInput = {
  toolName: string;
  arguments: unknown;
  kernelCallId: string;
  origin: { runRef: RunRef; sessionRef: SessionRef; generation: number; workspaceId: string };
};

export type ToolCommitLookupResult =
  | { status: 'committed'; cursor: CommitCursor; eventIds: string[] }
  | { status: 'not_committed' }
  | { status: 'undetermined'; reason: string };

export type ToolCommitLookup = (
  ctx: CoreCallContext,
  input: ToolCommitLookupInput,
) => Promise<ToolCommitLookupResult>;

export type CrashSuspicionV1 = { verdict: 'unlikely' | 'possible' | 'undetermined'; evidence: string /* 1..1000 */ };

export type UnknownCallObservationV1 =
  /** read_only */
  | { verdict: 'no_review_needed'; by: 'platform' }
  /** platform */
  | { verdict: 'done' | 'not_done' | 'undetermined'; by: 'platform'; evidence: PlatformLookupEvidenceV1 }
  /** file_edit */
  | { verdict: 'compare_in_continuation'; by: 'platform' }
  /** process, no conclusion yet */
  | { verdict: 'pending'; by: null }
  | {
      verdict: 'done' | 'not_done' | 'partial' | 'undetermined';
      by: 'review_round' | 'settlement';
      evidence: string /* 1..2000 */;
      roundRunRef: RunRef | null;
      crashSuspicion: CrashSuspicionV1;
      /**
       * D6: when a command without its full text is re-judged undetermined at
       * settlement, the original model conclusion and self-check move here;
       * null otherwise.
       */
      reviewerConclusion: null | {
        verdict: 'done' | 'not_done' | 'partial' | 'undetermined';
        evidence: string /* 1..2000 */;
        crashSuspicion: CrashSuspicionV1;
      };
    };

export type UnknownCallReviewItemV1 = {
  /** 1..32, in Kernel order; displayed as #n (D8). */
  alias: number;
  callId: string /* <=512 UTF-8 bytes, L7 */;
  toolName: string;
  kind: UnknownCallKindV1;
  contained: boolean;
  kernel: KernelCallRefV1;
  /** sha256 of the normalised arguments. */
  argumentsDigest: string;
  summary: {
    command: string | null /* <=512 */;
    cwd: string | null;
    mode: 'replace' | 'create' | null;
    paths: string[] /* <=8, each <=512 */;
    pathsOmitted: number;
    truncated: boolean;
  };
  startedAt: string | null;
  observed: UnknownCallObservationV1;
};

export type UnknownCallReviewStatusV1 =
  | 'pending_review'
  | 'needs_decision'
  | 'awaiting_proposal'
  | 'awaiting_approval'
  | 'resolved';

/** L17: fixed order. */
export type UnknownCallDecisionReasonV1 =
  | 'inventory_incomplete'
  | 'review_stopped'
  | 'review_incomplete'
  | 'review_unavailable'
  | 'partial'
  | 'undetermined'
  | 'crash_possible'
  | 'crash_undetermined'
  | 'second_consecutive'
  | 'confirm_each_step'
  | 'proposal_missing'
  | 'proposal_declined';

export type UnknownCallInventoryProblemV1 =
  | 'kernel_unreadable'
  | 'kernel_unreadable_at_stop'
  | 'turn_not_found'
  | 'too_many_calls'
  | 'too_large'
  | 'undecodable_call';

export type SaferMethodProposalV1 = {
  proposalId: string;
  callId: string /* <=512 bytes, same as the item's callId */;
  alias: number;
  command: string /* 1..4000 UTF-8 bytes, verbatim */;
  cwd: string | null /* <=512 bytes */;
  rationale: string /* 1..2000 */;
  roundRunRef: RunRef;
};

/** L20 budget: all current proposals rendered by `approvedMethodLinesZh` must stay <=5,120 bytes. */
export const UNKNOWN_CALL_APPROVED_METHODS_MAX_BYTES = 5_120;

/**
 * K3 L19/T02: the exact reason the review owner refuses a disposition whose
 * answer captured different Goal content. It is the ONE marker that lets the
 * Workflow tell this content refusal apart from a Goal version race (a record
 * that really moved, or a Goal paused concurrently); a race reports the real
 * `revision_conflict` reason instead of the T02 sentence.
 */
export const UNKNOWN_CALL_REVIEW_T02_REASON = 'the Goal content changed since the answer captured it';

export type UnknownCallDispositionV1 = {
  choice: 'rerun_as_is' | 'safer_method' | 'skip_as_done' | 'handle_myself';
  /** direct: the "I'll handle it" pressed outside the card (UCR-15). */
  source: 'card' | 'direct';
  targets: string[] /* the callIds recorded as dispositionTargets (D7) */;
  answerMessageRef: SessionMessageRef | null;
  answeredRevision: number;
  appliedBy: ActorRef;
  appliedAt: string;
  text: string | null /* <=2000 */;
  /**
   * K3 L18: the answer's annotations in the answer's own order. `path: null`
   * names the record object; otherwise it is the file object's path. Slice 5's
   * ① limits (32 items, 2,048 bytes each, 16 KiB total) already bounded them;
   * the record clips nothing new. A disposition with no answer (direct hold,
   * approval) carries `[]`.
   */
  annotations: Array<{ path: string | null; text: string }>;
  approval: null | {
    decision: 'approve' | 'decline';
    answerMessageRef: SessionMessageRef;
    answeredRevision: number;
    appliedBy: ActorRef;
    appliedAt: string;
  };
  approvedMethods: Array<{ proposalId: string; callId: string; alias: number; command: string; cwd: string | null }> | null;
  /** Only handle_myself has this. */
  hold: 'held' | 'released' | null;
};

export type UnknownCallBlockedCommandV1 = {
  /** The record's origin Run (`reviewRef.runId`), L19a. */
  reviewRunId: string;
  alias: number;
  commandSha256: string;
  kernelCallRef: KernelCallRefV1;
  actions: Array<{ text: string; sha256: string }>;
  expansions: Array<{
    action: string;
    scriptName: string;
    scriptText: string;
    actions: Array<{ text: string; sha256: string }>;
    basis: { path: string; digest: string } | { status: 'unavailable'; reason: string };
  }>;
  truncated: boolean;
};

export type UnknownCallReviewV1 = {
  ref: UnknownCallReviewRef;
  schemaVersion: 1;
  revision: number;
  workspaceId: string;
  task: TaskTriple;
  runRef: RunRef;
  sessionRef: SessionRef;
  origin:
    | { kind: 'takeover_unresolved'; hostInstanceId: string; proof: HostTakeoverProofV1 }
    | { kind: 'human_attested'; attestedBy: ActorRef; reason: string /* <=2000 */ };
  inventory: 'complete' | 'incomplete';
  inventoryProblem: UnknownCallInventoryProblemV1 | null;
  items: UnknownCallReviewItemV1[] /* <=32 */;
  itemsOmitted: number;
  workspace: WorkspaceCaptureV1;
  streak: { priorAutoCleanup: boolean; priorUnknownProcess: boolean; resetRunRef: RunRef | null };
  status: UnknownCallReviewStatusV1;
  /** Derived: status is not resolved, or activeRound is not null -> yes (D4, writer-only). */
  open: 'yes' | 'no';
  decisionReasons: UnknownCallDecisionReasonV1[];
  /** process items plus unclear platform items; fixed at needs_decision / awaiting_approval (D7). */
  dispositionTargets: string[] | null;
  /** the process items within dispositionTargets (D7). */
  proposalTargets: string[] | null;
  /** 1 at creation; +1 on each UCR-10 entry into awaiting_proposal (L9, D2). */
  stateEntry: number;
  activeRound: null | {
    runRef: RunRef;
    phase: 'review' | 'proposal';
    round: number;
    stateEntry: number;
    startedRevision: number;
  };
  /** <=8; the empty slots are 8 - rounds.length (L9). The last runRef is the most recent holder (L12). */
  rounds: Array<{
    runRef: RunRef;
    phase: 'review' | 'proposal';
    round: number;
    stateEntry: number;
    result: 'finished' | 'unfinished' | 'stopped';
  }>;
  proposals: SaferMethodProposalV1[];
  /** L19a: written when the disposition is applied. */
  blockedCommands: UnknownCallBlockedCommandV1[];
  disposition: UnknownCallDispositionV1 | null;
  createdAt: string;
  updatedAt: string;
};

/** The draft handed to WorkGraph at settlement/attestation; platform items already resolved. */
export type UnknownCallReviewDraftV1 = Pick<
  UnknownCallReviewV1,
  'inventory' | 'inventoryProblem' | 'items' | 'itemsOmitted' | 'workspace'
>;

// ------------------------------------------------------------------------ //
// Workspace baseline artifacts (L5)                                         //
// ------------------------------------------------------------------------ //
/** At creation: state = headCommit tree, `present` replaces (or adds), `deleted` removes. */
export type WorkspaceBaselineEntryV1 =
  | { path: string; state: 'present'; mode: string; blobId: string }
  | { path: string; state: 'deleted' };

export type WorkspaceBaselineV1 = {
  schemaVersion: 1;
  headCommit: string;
  dirty: WorkspaceBaselineEntryV1[] /* <=2000 */;
  digest: string;
};

/** The full capture at settlement (immutable artifact; serialised <=256 KiB). */
export type WorkspaceChangeCaptureV1 = {
  schemaVersion: 1;
  baseCommit: string;
  headNow: string;
  runBaselineKnown: boolean;
  changed: CapturedPathV1[] /* <=2000 */;
  notVisible: string[];
  notVisibleOmitted: number;
  digestBefore: string;
  digestAfter: string;
};
