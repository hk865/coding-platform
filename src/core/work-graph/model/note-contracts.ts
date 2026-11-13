// Slice 4 §2 (L1–L8, L18): the notes ports and value shapes delivered by 4A.
// Slice 4B declares the check port here (`NoteCheckPort`, L22) and its own
// constants; the six memory reads are still declared by the owning package.
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { NoteIndexRowV1, NotesUnderstandingRowV1, UnderstandingStatusV1 } from '../../../contracts/graph-context.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type {
  FlowPayloadV1, LinkInputV1, LinkVerificationV1, NoteAnchorV1, NoteDraftAnchorV1, NoteDraftV1, NoteFactV1,
  NoteHeadSnapshot, NoteKind, NoteReviewReason, NoteScopeV1, NoteSectionsV1, NoteSourceV1, NoteState, NoteVersionSnapshot,
  RepairInputV1, RepairPayloadV1,
} from '../../../contracts/note.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { LinkReadPayloadV1, NoteFlowReadV1 } from '../../../contracts/semantic-layer.js';
import type { ToolCommitLookup } from '../../../contracts/unknown-call-review.js';

// --------------------------------------------------------------------------
// Constants (spec §2; injectable initial values, DESIGN §9.3)
// --------------------------------------------------------------------------

export const NOTE_CONCLUSION_MAX_CODEPOINTS = 200;
export const NOTE_BODY_MAX_BYTES = 3072;
export const UNDERSTANDING_BODY_MAX_BYTES = 6144;
export const NOTE_FACTS_MAX = 16;
export const NOTE_BASIS_FILES_MAX = 32;
export const NOTE_BASIS_FILE_MAX_BYTES = 1024 * 1024;
export const NOTE_EXTRA_ANCHORS_MAX = 4;
export const NOTE_ANCHOR_QUOTA = 5;
export const NOTE_GOAL_QUOTA = 200;
export const MEMORY_PAGE_MAX = 100;
export const NOTE_EXISTING_TOPICS_MAX = 20;
export const NOTE_ANCHOR_CANDIDATES_MAX = 5;
export const NOTE_ANCHOR_CANDIDATE_SCAN = 2000;
// Slice 4B §2 constants (L11/L22/L23). All injectable, unmeasured initial values.
export const NOTE_READ_FILES_MAX = 256;
export const NOTE_READ_FACTS_MAX = 256;
/** One call parses at most this many distinct files on their own, the file anchors and the link gates together. */
export const NOTE_SYMBOL_RECHECK_MAX = 20;
/** One call's single-file parses read at most this much text in total; equal to `NOTE_BASIS_FILE_MAX_BYTES`, so any readable file fits. */
export const NOTE_READ_PARSE_BYTES_MAX = 1024 * 1024;
/** One second-tier check takes at most this many links. */
export const NOTE_LINK_VERIFY_MAX = 20;
/** How long an `agent` check waits for the second tier before it answers `budget`. */
export const NOTE_CHECK_DEADLINE_MS = 8_000;
/** More doubtful-only link lines than this in one input section fold into one line. */
export const NOTE_DOUBT_LINES_MAX = 3;
/** How long one call waits in total for its Python/C++ lookups, from the first one sent. */
export const NOTE_NATIVE_READ_WAIT_MS = 300;
// 8E L1 link constants (slice-8E spec §2). `NOTE_LINK_EVIDENCE_MAX` is also the
// write shape's evidence cap and takes no injectable field.
export const NOTE_LINK_EVIDENCE_MAX = 8;
export const NOTE_FLOW_CANDIDATE_MAX = 500;
export const NOTE_ANCHOR_LINK_QUOTA = 30;
export const NOTE_GOAL_LINK_QUOTA = 300;
export const NOTE_PROJECT_FLOW_QUOTA = 100;
// Slice 4B §2 constants of the memory reads (L10/L12). All injectable.
export const MEMORY_PAGE_DEFAULT = 20;
export const MEMORY_RESULT_MAX_BYTES = 48 * 1024;
export const NOTE_BODY_PAGE_BYTES = 2048;
export const MEMORY_TOPICS_MAX = 50;
// P14: the read model's own full-text bounds (distinct from the RecordStore port's).
export const TEXT_SEARCH_MAX_TERMS = 8;
export const TEXT_SEARCH_CANDIDATE_MAX = 1000;
export const NOTE_RANK_WEIGHT_TOPIC = 3;
export const NOTE_RANK_WEIGHT_CONCLUSION = 2;
export const NOTE_RANK_WEIGHT_BODY = 1;
export const NOTE_SIMILAR_MAX = 3;
export const NOTE_SIMILAR_MIN = 0.3;
// Slice 4C §11.2/§11.4 constants (C2.1/C2.4/C3.1). All injectable, unmeasured initial values.
export const PROJECT_UNDERSTANDING_BODY_MAX_BYTES = 4096;
export const FIND_RELATED_FILES_MAX = 32;
export const PROJECT_NORMS_CHECK_MAX = 10;
export const PROJECT_NORMS_MAX = 5;

// --------------------------------------------------------------------------
// Write side (L4–L8)
// --------------------------------------------------------------------------

export type NoteErrorCode = 'invalid' | 'forbidden' | 'not_found' | 'revision_conflict' | 'unavailable' | 'unsupported';

export type NoteAnchorCandidateV1 = { kind: NoteAnchorV1['kind']; id: string; displayName: string };
export type NoteCommitReceiptV1 = { identityKey: string; fingerprint: string; cursor: CommitCursor };

export type WriteNoteInput = { commandId: string; note: NoteDraftV1; expectedPointerRevision: number | null;
  goalId: string | null };

export type NoteExistingTopicV1 = { anchorKey: string; topic: string; count: number };
export type NoteSimilarV1 = { noteId: string; version: number; header: string; similarity: number };

export type WriteNoteResult =
  | { status: 'accepted' | 'pending_review' | 'staged'; noteId: string; version: number;
      reasons: NoteReviewReason[]; overQuota: boolean; confirmedByUser: boolean;
      warnings: ('symbol_unresolved' | 'anchor_ended' | 'evidence_unverifiable')[]; symbolProblems?: NoteSymbolProblemV1[]; existingTopics: NoteExistingTopicV1[] }
  | { status: 'rejected'; code: NoteErrorCode; reason: string; draft: WriteNoteInput;
      conflicts?: { noteId: string; version: number; conclusion: string }[];
      symbolCandidates?: { name: string; range: { startLine: number; endLine: number } }[];
      anchorCandidates?: NoteAnchorCandidateV1[]; candidatesUnavailable?: boolean;
      /** Only on `evidence_missing` / `evidence_outside_end`: every failing evidence index. */
      evidenceIndexes?: number[];
      pointer?: { noteId: string | null; revision: number | null } };

export type NoteDispositionResult =
  | { status: 'done'; noteId: string; version: number; state: NoteState; receipt: NoteCommitReceiptV1 }
  | { status: 'rejected'; code: NoteErrorCode; reason: string; noteId: string;
      pointer?: { noteId: string | null; revision: number | null } };

export interface NoteWritePort {
  writeNote(ctx: CoreCallContext, input: WriteNoteInput): Promise<WriteNoteResult>;
  reviewNote(ctx: CoreCallContext, input: { commandId: string; noteId: string; expectedVersion: number;
    expectedPointerRevision: number | null; verdict: 'review' | 'accept' | 'reject';
    resolution?: 'supersede' | 'coexist';
    reason: string | null }): Promise<NoteDispositionResult>;
  withdrawNote(ctx: CoreCallContext, input: { commandId: string; noteId: string; expectedVersion: number;
    reason: string | null }): Promise<NoteDispositionResult>;
  /** K3 L4: the read-only committed-receipt lookup for the `record_note` tool. */
  lookupToolCommit?: ToolCommitLookup;
}

// --------------------------------------------------------------------------
// The `record_note` model arguments and their ONE pure request builder
// --------------------------------------------------------------------------

/**
 * K3 (decision 72, U1): the shape of the `record_note` model arguments after the
 * strict schema. It lives here in `WorkGraph/model` so the tool handler
 * (`agent-runtime/note-tool.ts`) and the owner lookup (`notes/note-service.ts`)
 * share ONE builder, exactly as the mailbox/plan/decision builders live in
 * `tool-commit-arguments.ts`. The Kernel's parsed args are structurally
 * assignable, and the runtime schema still enforces the real shape.
 */
export type RecordNoteWriteArgs = {
  op: 'write';
  kind: NoteKind;
  topic: string;
  conclusion: string;
  anchor: NoteDraftAnchorV1;
  extraAnchors?: NoteDraftAnchorV1[];
  facts?: unknown[];
  basisFiles?: string[];
  replaces?: string[];
  contradicts?: string[];
  coexistWith?: string[];
  structural?: boolean;
  body?: string;
  sections?: NoteSectionsV1;
  repair?: RepairInputV1;
  /** The link's dedicated payload; the one payload-kind gate rejects it on another kind. */
  link?: LinkInputV1;
  /** The flow's dedicated payload; the one payload-kind gate rejects it on another kind. */
  flow?: FlowPayloadV1;
  expectedPointerRevision?: number | null;
};
export type RecordNoteReviewArgs = {
  op: 'review';
  noteId: string;
  expectedVersion: number;
  verdict: 'review' | 'accept' | 'reject';
  resolution?: 'supersede' | 'coexist';
  reason?: string | null;
  expectedPointerRevision?: number | null;
};
export type RecordNoteWithdrawArgs = {
  op: 'withdraw';
  noteId: string;
  expectedVersion: number;
  reason?: string | null;
};
export type RecordNoteArgs = RecordNoteWriteArgs | RecordNoteReviewArgs | RecordNoteWithdrawArgs;

/**
 * RW-14 (U1): the ONE pure builder from the accepted model args to the
 * `writeNote` / `reviewNote` / `withdrawNote` request objects. It is the only
 * place the model JSON becomes a request: the trusted `commandId` is injected,
 * absent lists/bodies/pointers take their defaults, and no model-supplied
 * identity (principal, goalId, plan/catalog revision) can enter.
 */
export type RecordNoteRequestV1 =
  | { op: 'write'; request: WriteNoteInput }
  | { op: 'review'; request: Parameters<NoteWritePort['reviewNote']>[1] }
  | { op: 'withdraw'; request: Parameters<NoteWritePort['withdrawNote']>[1] };

export function recordNoteRequestOf(args: RecordNoteArgs, commandId: string): RecordNoteRequestV1 {
  if (args.op === 'write') {
    const common = {
      topic: args.topic,
      conclusion: args.conclusion,
      anchor: args.anchor as NoteDraftAnchorV1,
      extraAnchors: (args.extraAnchors ?? []) as NoteDraftAnchorV1[],
      facts: (args.facts ?? []) as NoteFactV1[],
      basisFiles: args.basisFiles ?? [],
      structural: args.structural ?? false,
      replaces: args.replaces ?? [],
      contradicts: args.contradicts ?? [],
      coexistWith: args.coexistWith ?? [],
      // Keep a caller-supplied link/flow on every kind branch: a mismatched payload
      // must reach the one payload-kind gate instead of being silently dropped.
      ...(args.link === undefined ? {} : { link: args.link }),
      ...(args.flow === undefined ? {} : { flow: args.flow }),
    };
    const note: NoteDraftV1 = args.kind === 'understanding'
      ? { ...common, kind: 'understanding', sections: args.sections as NoteSectionsV1 }
      : args.kind === 'repair'
        ? { ...common, kind: 'repair', body: args.body as string, repair: args.repair as RepairInputV1 }
        : args.kind === 'link'
          ? { ...common, kind: 'link', body: args.body as string, link: args.link as LinkInputV1 }
          : args.kind === 'flow'
            ? { ...common, kind: 'flow', body: args.body as string, flow: args.flow as FlowPayloadV1 }
            : { ...common, kind: args.kind as Exclude<NoteKind, 'understanding' | 'repair' | 'link' | 'flow'>,
                body: args.body as string };
    return { op: 'write', request: { commandId, note,
      expectedPointerRevision: args.expectedPointerRevision ?? null, goalId: null } };
  }
  if (args.op === 'review') {
    return { op: 'review', request: { commandId, noteId: args.noteId, expectedVersion: args.expectedVersion,
      expectedPointerRevision: args.expectedPointerRevision ?? null, verdict: args.verdict,
      ...(args.resolution === undefined ? {} : { resolution: args.resolution }),
      reason: args.reason ?? null } };
  }
  return { op: 'withdraw', request: { commandId, noteId: args.noteId, expectedVersion: args.expectedVersion,
    reason: args.reason ?? null } };
}

/**
 * 4C-2 §2 item 4: the note card's application entry, exposed on the note
 * service so the composition root can pass it to `createNoteDecisionSource`.
 * It is shape-identical to `NoteDecisionSourcePort.applyNoteDecision`;
 * `model/decision-contracts.ts` imports it, so there is one declaration and no
 * reverse dependency from notes into decisions.
 */
export type NoteDecisionApplicationInputV1 = {
  commandId: string; cardId: string;
  optionId: 'accept' | 'reject' | 'supersede' | 'coexist';
  pin: { noteId: string; version: number };
  expectedPointerRevision: number | null;
  answerMessageRef: SessionMessageRef;
  conditions: string | null;
};

export interface NoteDecisionApplyPort {
  applyNoteDecision(ctx: CoreCallContext, input: NoteDecisionApplicationInputV1): Promise<NoteDispositionResult>;
}

// --------------------------------------------------------------------------
// Read side (4A minimal face; P1, P8, P9)
// --------------------------------------------------------------------------

export type NoteHintV1 = 'basis_outside_anchor' | 'file_module_mismatch' | 'deleted_path_unverified';

/** Who asked for a second-tier check; the analyzer serves them in this order after the write gate. */
export type NoteLinkVerifyV1 = { priority: 'run_end' | 'button' | 'agent' | 'background' };

/**
 * The second tier's `analysed` digests agree with the raw-byte digests read before it: every
 * analysed path that was also read there has the same digest. A single-file judgement made on bytes
 * that changed before the program was built must not stand for the new bytes.
 */
export function analysedDigestsMatch(analysed: readonly { path: string; digest: string }[],
  read: ReadonlyMap<string, string>): boolean {
  return analysed.every(entry => {
    const digest = read.get(entry.path);
    return digest === undefined || digest === entry.digest;
  });
}

/**
 * Slice 4B L22: the one derived-field implementation, injected into the note
 * read model (L18: `notes` never imports `views`). It writes no record. It keeps
 * two kinds of Host memory: the second tier's link conclusions with the doubtful
 * and broken link registers, and the single-file parse answers by text digest;
 * both only make later reads cheaper and are gone on restart. Both the six memory
 * reads and the write-after check call this same function.
 */
export interface NoteCheckPort {
  /**
   * Without `verifyLinks` this is the first tier only and never builds a program;
   * with it, the doubtful head-version links also go to the second tier.
   * `heldByRun` names the Run this read is for (`canonicalJson(runRef)`); a broken
   * link read in it is registered with that Run.
   */
  checkNotes(ctx: CoreCallContext, input: { items: { noteId: string; version: number }[]; withSimilar?: boolean;
    verifyLinks?: NoteLinkVerifyV1; heldByRun?: string }):
    Promise<ReadResult<NoteCheckV1[]>>;
}

/**
 * S2.5 (decision 66): the internal extension the read model injects. It hands
 * over heads and versions the read model already read in the current call, so
 * the check does not re-read them. Supplied heads never come from outside the
 * process; `platform.notes` exposes only `checkNotes`.
 */
export type NoteHeadCheckItemV1 = {
  head: NoteHeadSnapshot;
  version: number;
  snapshot?: NoteVersionSnapshot;
};

export interface NoteHeadCheckPort extends NoteCheckPort {
  checkHeads(ctx: CoreCallContext, input: {
    items: NoteHeadCheckItemV1[];
    /**
     * U-3 (spec §11.4/§11.5): goal/stage/project anchor keys whose
     * `UnderstandingStatusV1` the same check computes from the same per-call
     * caches (pointer, triggers, plan). `lookup` asks for its anchor here and
     * `understandingOf` no longer reads the pointer itself.
     */
    understandingAnchors?: string[];
    /** Seeded caches, keyed `${projectId}\0${anchorKey}` exactly as read. */
    anchorSets?: ReadonlyMap<string, NoteHeadSnapshot[]>;
    /**
     * Seeded plan windows, keyed `${projectId}\0${goalId}` exactly as the
     * check's per-call `caches.plans`. A caller that already resolved a goal's
     * active plan (e.g. a segmented `find`'s related scope) hands the READY
     * window over so the check does not read it again in the same call.
     * `null` is a ready "the goal has no active plan", not a failure.
     */
    planWindows?: ReadonlyMap<string, PlanRevisionSnapshot | null>;
    /**
     * Rework item 8 (spec §11.7): the pointers and pointed heads the caller
     * already read, keyed `${projectId}\u0000${anchorKey}` exactly as the
     * understanding caches. When an anchor is present here the check uses them
     * and skips its own pointer and head reads for that anchor.
     */
    understandingPointers?: ReadonlyMap<string, {
      pointer: { noteId: string | null; revision: number | null };
      head: NoteHeadSnapshot | null;
    }>;
    /**
     * [2B-16]: the anchors of filed notes with no record head. Only their anchors are checked, in the same call
     * and by the same rule as the items' slots; the answers come back in `anchorsOnly`, in this order.
     */
    anchorsOnly?: { anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[] }[];
  }): Promise<ReadResult<{ items: NoteCheckV1[]; understanding: UnderstandingStatusV1[]; anchorsOnly: NoteAnchorCheckV1[] }>>;
  /** 121-88: current notes whose main module or interface anchor is gone from the current catalog. */
  removedModuleNotes(ctx: CoreCallContext): Promise<ReadResult<readonly NoteRemovedModuleItemV1[]>>;
  /** The Host-memory queue of head-version links read `refs_pending` with no conclusion yet, by `noteId`. */
  doubtfulLinks(scope: { projectId: string; workspaceId: string }, max: number): { noteId: string; version: number }[];
  /** The Host-memory register of accepted/reviewed head-version links last read `broken`. */
  brokenLinks(scope: { projectId: string; workspaceId: string }): { noteId: string; version: number; heldByRun: string | null }[];
}

export type NoteFileOutcome = 'same' | 'changed' | 'deleted' | 'forbidden' | 'capacity' | 'unavailable' | 'unchecked';
export type NoteFileObservationV1 = { path: string; digest: string | null; outcome: NoteFileOutcome };

export type NoteCheckV1 = { noteId: string; version: number;
  // R3: every file the check read for this item, with its outcome.
  observedFiles: NoteFileObservationV1[];
  freshness: 'fresh' | 'stale' | 'unchecked'; changedFiles: { path: string; deleted: boolean }[]; staleReasons: string[];
  sourceUnavailable: boolean; invalid: boolean; conflicting: boolean; overQuota: boolean; updateDue: boolean | null;
  currentEligible: boolean;
  anchorStatus: 'live' | 'retired';
  anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted' | 'task_ended'
    | 'stage_not_in_current_plan' | 'symbol_missing')[];
  /** One entry per slot: the primary anchor first, then `extraAnchors` order. */
  anchorSlots: { status: 'live' | 'retired'; reasons: ('module_removed' | 'interface_removed' | 'file_deleted'
    | 'task_ended' | 'stage_not_in_current_plan' | 'symbol_missing')[] }[];
  /**
   * The link's read-time result: the first tier's, or the second tier's conclusion kept in memory. It is
   * `broken` or `unchecked` only at read time (`refs_pending` = the names are still there and the cross-file
   * references wait for the second tier); the stored write-time result is only verified/unverifiable.
   */
  linkVerification?: LinkVerificationV1;
  retiredExtraAnchors: string[];
  // R1: `invalid_file_digest` mirrors `invalid_commit_format` for a file fact
  // whose digest is not 64 lowercase hex (lead amends §2's reason list).
  unresolvedFacts: { index: number; reason: 'not_found' | 'version_ahead' | 'kind_mismatch'
    | 'invalid_commit_format' | 'invalid_file_digest' | 'forbidden' | 'unavailable' }[];
  uncheckedFacts: number[];
  hints: NoteHintV1[];
  similar?: NoteSimilarV1[] };

/** [2B-16]: the anchor fields of a filed note with no record head, by the same anchor check as a head's slots. */
export type NoteAnchorCheckV1 = Pick<NoteCheckV1, 'anchorStatus' | 'anchorRetiredReasons' | 'anchorSlots' | 'retiredExtraAnchors'>;

/** Slice 4C §2 (R-03): the `record_note` / `notes/write` return. A failed check never undoes the write. */
export type WriteNoteEnvelopeV1 = { write: WriteNoteResult;
  check: NoteCheckV1 | { status: 'unavailable'; reason: string } };

/** KLS-2b: this project's "needs verification" mark on the note file's current blob (none = current). */
export type NoteVerifyV1 = { state: 'needs_verification';
  reason: 'external_edit' | 'merged' | 'joined_existing_checkout' };
/** A repair as read: a note file this project has no record of has no pin. */
export type NoteRepairReadV1 = Omit<RepairPayloadV1, 'pin'> & { pin: ArchitectureCatalogPinV1 | null };

/**
 * `version`/`storedState` are null for a note file this project has no record of (it reads `unchecked`, cannot be
 * activated, disposed or current); `verify` is this project's mark on the file's blob.
 */
export type NoteItemV1 = { noteId: string; version: number | null; storedState: NoteState | null; kind: NoteKind; topic: string;
  topicKey: string; conclusion: string; anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[]; source: NoteSourceV1; goalId: string | null;
  replaces: string[]; contradicts: string[]; coexistWith: string[]; confirmedByUser: boolean;
  freshness: 'fresh' | 'stale' | 'unchecked'; changedFiles: { path: string; deleted: boolean }[];
  observedFiles: NoteFileObservationV1[]; staleReasons: string[];
  sourceUnavailable: boolean; invalid: boolean; conflicting: boolean; overQuota: boolean; updateDue: boolean | null;
  currentEligible: boolean; crossGoal: boolean;
  anchorStatus: 'live' | 'retired';
  anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted' | 'task_ended'
    | 'stage_not_in_current_plan' | 'symbol_missing')[];
  /** One entry per slot: the primary anchor first, then `extraAnchors` order; two slots on one key stay separate. */
  anchorSlots: NoteCheckV1['anchorSlots'];
  /** Present exactly on a `link` note. */
  link?: LinkReadPayloadV1;
  /** Present exactly on a `flow` note; only the read side's `expandFlowForHead` builds it. */
  flow?: NoteFlowReadV1;
  retiredExtraAnchors: string[];
  unresolvedFacts: NoteCheckV1['unresolvedFacts']; uncheckedFacts: number[]; hints: NoteHintV1[];
  matchedTerms: string[]; score: number;
  segment?: 'related' | 'project';
  sections?: NoteSectionsV1;
  repair?: NoteRepairReadV1;
  verify: NoteVerifyV1 | null;
  body?: { text: string; next: string | null } };

/** P9: goal/stage anchors only; `{ null, null }` when no pointer exists yet. */
export type NotePageV1 = { items: NoteItemV1[]; next: string | null; complete: boolean;
  pointer: { noteId: string | null; revision: number | null } | null };

export interface NoteReadPort {
  readNote(ctx: CoreCallContext, input: { noteId: string; version?: number }): Promise<ReadResult<NoteItemV1>>;
  listByAnchor(ctx: CoreCallContext, input: { anchor: NoteAnchorV1; limit: number; cursor: string | null }):
    Promise<ReadResult<NotePageV1>>;
  /** The current version of each note on one anchor; the overlap gate compares every `since` with the Run starts. */
  listCurrentVersions(ctx: CoreCallContext, input: { anchor: NoteAnchorV1; limit: number; cursor: string | null }):
    Promise<ReadResult<{ items: NoteVersionSnapshot[]; next: string | null; complete: boolean }>>;
}

// --------------------------------------------------------------------------
// Slice 4B L12: the six memory reads (G3)
// --------------------------------------------------------------------------

/**
 * P3: `updateDue` moves to 4C; 4B answers `null` with no trigger cursor. The
 * declaration now lives in `contracts/graph-context.ts` (a pure DTO, so it may
 * be imported by `contracts/`); re-exported here so every existing import site
 * keeps compiling. The `import type` above brings the name into this module's
 * own scope for the read results below.
 */
export type { UnderstandingStatusV1 } from '../../../contracts/graph-context.js';

export type MemoryLookupRequest = { v: 1; op: 'lookup'; anchor: NoteAnchorV1;
  body?: { noteId: string; version?: number; cursor: string | null }; limit: number; cursor: string | null };
export type MemoryNeighborsRequest = { v: 1; op: 'neighbors'; noteId: string; version?: number; limit: number; cursor: string | null };
export type MemoryHistoryRequest = { v: 1; op: 'history'; noteId: string;
  body?: { noteId: string; version?: number; cursor: string | null }; limit: number; cursor: string | null };
export type MemoryConflictsRequest = { v: 1; op: 'conflicts'; noteId?: string; anchor?: NoteAnchorV1; limit: number; cursor: string | null };
/**
 * Slice 4C §11.2: the requester a related-first find segments around.
 * `caller_task` is resolved from the caller. The resolved node carried in
 * `MemoryResultV1.related.node` also names the plan/catalog revision the key set
 * was built from (present only on resolved output).
 */
export type MemoryRelatedNodeV1 = { kind: 'task'; goalId: string; taskId: string; planRevision?: number }
  | { kind: 'module'; moduleId: string; catalogRevision?: number }
  | { kind: 'caller_task' };

/**
 * Slice 4C §11.2/RW-7: the strict union a `find` REQUEST accepts. `caller_task`
 * is an internal resolution of "not given in a work Run", NOT an accepted
 * request value, so it is absent here; this union carries no revision fields
 * (those are output-only on `MemoryRelatedNodeV1`).
 */
export type MemoryFindRelatedRequestV1 = { kind: 'task'; goalId: string; taskId: string }
  | { kind: 'module'; moduleId: string };

/**
 * Slice 4C §11.2/C2.2: the narrow port that resolves a work Run's own task and
 * bound plan in one read of the Run snapshot, from the trusted
 * `ctx.principal.runRef`. The composition root wires the concrete resolver; the
 * read model only reads it.
 */
export type NoteRunTaskResolver = (ctx: CoreCallContext) =>
  Promise<ReadResult<{ goalId: string; taskId: string; planRef: PlanRevisionRef }>>;
export type MemoryFindRequest = { v: 1; op: 'find'; terms?: string[]; match?: 'any' | 'all'; anchor?: NoteAnchorV1; pathPrefix?: string;
  kind?: NoteKind | 'general'; topic?: string; state?: NoteState;
  related?: MemoryFindRelatedRequestV1 | null; limit: number; cursor: string | null };
export type MemoryStaleRequest = { v: 1; op: 'stale'; goalId?: string; anchor?: NoteAnchorV1; limit: number; cursor: string | null };

export type MemoryReadBasis = { recordCursor: string | null; ruleVersion: number;
  observedFiles: NoteFileObservationV1[] };
/** Slice 4C §11.4: `find`'s first-page project header (understanding + selected norms). */
export type MemoryProjectHeaderV1 = {
  understanding: { noteId: string; version: number; pointerRevision: number; conclusion: string; currentEligible: boolean } | null;
  norms: { noteId: string; version: number; header: string }[];
  omitted: number;
};
export type MemoryResultV1 = { readBasis: MemoryReadBasis; items: NoteItemV1[]; warnings: string[];
  next: string | null; complete: boolean; ranking?: 'full' | 'partial';
  related?: { node: MemoryRelatedNodeV1; filesOmitted: number; filesUnknownRuns: number };
  boundary?: { relatedEnded: boolean; projectStartsAt: number | null };
  project?: MemoryProjectHeaderV1;
  coverage: { checkedItems: number; uncheckedItems: number; filesRead: number } };
export type MemoryLookupResultV1 = MemoryResultV1 & { understanding: UnderstandingStatusV1 | null;
  topics: { topic: string; count: number }[]; topicsComplete: boolean };
export type NoteHistoryItemV1 = NoteItemV1 & { change: NoteVersionSnapshot['change']; since: CommitCursor };
export type MemoryHistoryResultV1 = Omit<MemoryResultV1, 'items'> & { items: NoteHistoryItemV1[] };

/** Slice 4C C1.4: the `notes/list` request union (any other filter is `notes_list_filter_unsupported`). */
export type NoteListRequestV1 =
  | { anchor: NoteAnchorV1; state?: NoteState; limit: number; cursor: string | null }
  | { goalId: string | null; state: 'pending_review'; limit: number; cursor: string | null }
  | { goalId: string; state: 'accepted' | 'reviewed'; limit: number; cursor: string | null };
/** Slice 4C C1.4: rows carry the underlying read's L9 fields plus `label` from `renderNoteHeader`. */
export type NoteListResultV1 = { items: (NoteItemV1 & { label: string })[]; next: string | null; complete: boolean;
  readBasis: MemoryReadBasis; warnings: string[];
  coverage: { checkedItems: number; uncheckedItems: number; filesRead: number };
  understanding?: UnderstandingStatusV1 | null };

/**
 * R9/MF9: the three anchor-scoped reads (`lookup`, `conflicts`, `find`) answer
 * `not_found`/`anchor_not_found` with the resolver's bounded candidates when the
 * anchor itself does not exist now. It is a subtype of `CoreRejection`, so
 * `results.ts` and `ReadResult` consumers are unchanged.
 */
export type NoteAnchorNotFoundV1 = { status: 'rejected'; code: 'not_found'; reason: 'anchor_not_found';
  anchorCandidates?: NoteAnchorCandidateV1[]; candidatesUnavailable?: boolean };
export type NoteMemoryReadResult<T> = ReadResult<T> | NoteAnchorNotFoundV1;

export interface NoteMemoryReadPort {
  memoryLookup(ctx: CoreCallContext, input: MemoryLookupRequest): Promise<NoteMemoryReadResult<MemoryLookupResultV1>>;
  memoryNeighbors(ctx: CoreCallContext, input: MemoryNeighborsRequest): Promise<ReadResult<MemoryResultV1>>;
  memoryHistory(ctx: CoreCallContext, input: MemoryHistoryRequest): Promise<ReadResult<MemoryHistoryResultV1>>;
  memoryConflicts(ctx: CoreCallContext, input: MemoryConflictsRequest): Promise<NoteMemoryReadResult<MemoryResultV1>>;
  memoryFind(ctx: CoreCallContext, input: MemoryFindRequest): Promise<NoteMemoryReadResult<MemoryResultV1>>;
  memoryStale(ctx: CoreCallContext, input: MemoryStaleRequest): Promise<ReadResult<MemoryResultV1>>;
}

/** Slice 4B L19: the two version lists (P8; R14 amends `at` to `string | null`). */
export type VersionListPageV1 = {
  items: { revision: number; at: string | null; reason: string | null; reasonLabel: string }[];
  next: string | null;
  complete: boolean;
};

// --------------------------------------------------------------------------
// Scribe scope and duty (P1, P5, P6)
// --------------------------------------------------------------------------

/** P1: the per-scope current-note count (L7). Does not change NoteReadPort. */
export type { NoteScopeV1 } from '../../../contracts/note.js';
export interface NoteScopeReadPort {
  countCurrentNotes(ctx: CoreCallContext, input: { scope: NoteScopeV1 }):
    Promise<ReadResult<{ scope: NoteScopeV1; current: number }>>;
}

/** P5: the composition root passes the SAME resolver the Workflow gets. */
export type NoteDutyResolver = (role: RoleConfigurationRef, ctx: CoreCallContext) =>
  Promise<ReadResult<PlatformDutyV1 | 'unknown'>>;

// --------------------------------------------------------------------------
// Slice 4C §11.5: "update due" triggers, the memory material and the scribe
// to-dos. All ports are narrow and read-only; the pure fold lives in
// `notes/note-update-due.ts`.
// --------------------------------------------------------------------------

export type NoteUpdateDueTriggerKind = 'task_end' | 'rework' | 'archive' | 'plan';
export type NoteUpdateDueTriggerV1 = { key: string; at: string; kind: NoteUpdateDueTriggerKind; taskId: string | null };

export type NoteMemoryMaterialInputV1 = { goalId: string | null; stageId?: string | null; taskId?: string | null;
  /**
   * Rework ruling 9 (verifier "missed 3"): `includeInputs === false` means the
   * caller (a Query assembly) wants understanding + norms only; the read model
   * skips the related scope and the general part. Absent means `true`.
   */
  includeInputs?: boolean };
export type NoteMemoryMaterialV1 = {
  projectUnderstanding: NotesUnderstandingRowV1 | null;
  norms: NoteIndexRowV1[];
  normsOmitted: number;
  localUnderstanding: NotesUnderstandingRowV1[];   // goal row then stage row, at most 2
  general: NoteIndexRowV1[];
  reminders: { anchorKey: string; updateDue: boolean | null; latestTriggerCursor: string | null }[];
};
/** U8: one memory-material read per assembly; the caller picks the parts. A null goal reads the project material. */
export interface NoteMemoryMaterialPort {
  readMemoryMaterial(ctx: CoreCallContext, input: NoteMemoryMaterialInputV1): Promise<ReadResult<NoteMemoryMaterialV1>>;
}

export type NoteScribeTodoV1 = { identity: string; anchorKey: string; noteId: string | null; version: number | null;
  latestTriggerCursor: string | null; updateDue: boolean };
/** 121-88: a current note whose main anchor is a module — or an interface on a module — the current catalog no longer has. */
export type NoteModuleRemovedTodoV1 = {
  readonly identity: string;  // `${noteId}@${version}` (same as pending)
  readonly anchorKey: string; // `module:<moduleId>` or `interface:<moduleId>/<interfaceId>` (note-anchors.ts:408-416)
  readonly noteId: string;
  readonly version: number;
};
/** The check's read item before bucketing: one note, with its line and goal. */
export type NoteRemovedModuleItemV1 = NoteModuleRemovedTodoV1 & {
  readonly lineRef: string;
  readonly goalId: string | null;
};
export type NoteScribeTodosV1 = { goalId: string | null; pending: NoteScribeTodoV1[]; updateDueTodos: NoteScribeTodoV1[];
  moduleRemoved: NoteModuleRemovedTodoV1[]; immediate: boolean };
/** §11.5/U-4: the narrow port the Host reminder check uses. */
export interface NoteScribeTodoPort {
  readScribeTodos(ctx: CoreCallContext, input: { goalIds: string[] }): Promise<ReadResult<NoteScribeTodosV1[]>>;
  /**
   * Rework item 6/§11.7: the ledger cursor the reminder gate compares. It is a
   * record-store commit cursor, `null` before any commit (an empty read).
   */
  readLedgerCursor(ctx: CoreCallContext): Promise<ReadResult<string | null>>;
}

/** A Python syntax error in one anchor's file; `line` is one-based and `message` is `SyntaxError.msg`. */
export type SymbolProblemV1 = { path: string; line: number; message: string };
/** The same problem attributed to the draft field whose `symbolRequest` met it. */
export type NoteSymbolProblemV1 = SymbolProblemV1 & { field: string };
