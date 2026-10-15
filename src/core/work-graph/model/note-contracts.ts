// Slice 4 §2 (L1–L8, L18): the notes ports and value shapes delivered by 4A.
// The 4B/4C additions (six memory reads, NoteCheckPort, the tool envelope, the
// decision source) are not declared here yet: 4A delivers the write port, the
// minimal read port and the per-scope count (P1, P5, P9).
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type {
  NoteAnchorV1, NoteDraftV1, NoteKind, NoteReviewReason, NoteSectionsV1, NoteSourceV1, NoteState,
} from '../../../contracts/note.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';

// --------------------------------------------------------------------------
// Constants (spec §2; injectable initial values, DESIGN §9.3)
// --------------------------------------------------------------------------

export const NOTE_CONCLUSION_MAX_CODEPOINTS = 200;
export const NOTE_BODY_MAX_BYTES = 3072;
export const UNDERSTANDING_BODY_MAX_BYTES = 6144;
export const NOTE_FACTS_MAX = 16;
export const NOTE_BASIS_FILES_MAX = 32;
export const NOTE_BASIS_FILE_MAX_BYTES = 1024 * 1024;
export const NOTE_SYMBOL_HITS_MAX = 200;
export const NOTE_EXTRA_ANCHORS_MAX = 4;
export const NOTE_ANCHOR_QUOTA = 5;
export const NOTE_GOAL_QUOTA = 200;
export const MEMORY_PAGE_MAX = 100;
export const NOTE_EXISTING_TOPICS_MAX = 20;
export const NOTE_ANCHOR_CANDIDATES_MAX = 5;
export const NOTE_ANCHOR_CANDIDATE_SCAN = 2000;

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
      warnings: ('symbol_unresolved' | 'anchor_ended')[]; existingTopics: NoteExistingTopicV1[] }
  | { status: 'rejected'; code: NoteErrorCode; reason: string; draft: WriteNoteInput;
      conflicts?: { noteId: string; version: number; conclusion: string }[];
      symbolCandidates?: { name: string; range: { startLine: number; endLine: number } }[];
      anchorCandidates?: NoteAnchorCandidateV1[]; candidatesUnavailable?: boolean;
      pointer?: { noteId: string | null; revision: number | null } };

export type NoteDispositionResult =
  | { status: 'done'; noteId: string; version: number; state: NoteState; receipt: NoteCommitReceiptV1 }
  | { status: 'rejected'; code: NoteErrorCode; reason: string; noteId: string;
      pointer?: { noteId: string | null; revision: number | null } };

export interface NoteWritePort {
  writeNote(ctx: CoreCallContext, input: WriteNoteInput): Promise<WriteNoteResult>;
  reviewNote(ctx: CoreCallContext, input: { commandId: string; noteId: string; expectedVersion: number;
    expectedPointerRevision: number | null; verdict: 'review' | 'accept' | 'reject';
    reason: string | null }): Promise<NoteDispositionResult>;
  withdrawNote(ctx: CoreCallContext, input: { commandId: string; noteId: string; expectedVersion: number;
    reason: string | null }): Promise<NoteDispositionResult>;
}

// --------------------------------------------------------------------------
// Read side (4A minimal face; P1, P8, P9)
// --------------------------------------------------------------------------

export type NoteHintV1 = 'basis_outside_anchor' | 'file_module_mismatch' | 'deleted_path_unverified';

export type NoteFileOutcome = 'same' | 'changed' | 'deleted' | 'forbidden' | 'capacity' | 'unavailable' | 'unchecked';
export type NoteFileObservationV1 = { path: string; digest: string | null; outcome: NoteFileOutcome };

export type NoteCheckV1 = { noteId: string; version: number;
  freshness: 'fresh' | 'stale' | 'unchecked'; changedFiles: { path: string; deleted: boolean }[]; staleReasons: string[];
  sourceUnavailable: boolean; invalid: boolean; conflicting: boolean; overQuota: boolean; updateDue: boolean | null;
  currentEligible: boolean;
  anchorStatus: 'live' | 'retired';
  anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted' | 'task_ended'
    | 'stage_not_in_current_plan' | 'symbol_missing')[];
  retiredExtraAnchors: string[];
  unresolvedFacts: { index: number; reason: 'not_found' | 'version_ahead' | 'kind_mismatch'
    | 'invalid_commit_format' | 'forbidden' | 'unavailable' }[];
  uncheckedFacts: number[];
  hints: NoteHintV1[];
  similar?: NoteSimilarV1[] };

export type NoteItemV1 = { noteId: string; version: number; storedState: NoteState; kind: NoteKind; topic: string;
  topicKey: string; conclusion: string; anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[]; source: NoteSourceV1; goalId: string | null;
  replaces: string[]; contradicts: string[]; coexistWith: string[]; confirmedByUser: boolean;
  freshness: 'fresh' | 'stale' | 'unchecked'; changedFiles: { path: string; deleted: boolean }[];
  observedFiles: NoteFileObservationV1[]; staleReasons: string[];
  sourceUnavailable: boolean; invalid: boolean; conflicting: boolean; overQuota: boolean; updateDue: boolean | null;
  currentEligible: boolean; crossGoal: boolean;
  anchorStatus: 'live' | 'retired';
  anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted' | 'task_ended'
    | 'stage_not_in_current_plan' | 'symbol_missing')[];
  retiredExtraAnchors: string[];
  unresolvedFacts: NoteCheckV1['unresolvedFacts']; uncheckedFacts: number[]; hints: NoteHintV1[];
  matchedTerms: string[]; score: number;
  sections?: NoteSectionsV1;
  body?: { text: string; next: string | null } };

/** P9: goal/stage anchors only; `{ null, null }` when no pointer exists yet. */
export type NotePageV1 = { items: NoteItemV1[]; next: string | null; complete: boolean;
  pointer: { noteId: string | null; revision: number | null } | null };

export interface NoteReadPort {
  readNote(ctx: CoreCallContext, input: { noteId: string; version?: number }): Promise<ReadResult<NoteItemV1>>;
  listByAnchor(ctx: CoreCallContext, input: { anchor: NoteAnchorV1; limit: number; cursor: string | null }):
    Promise<ReadResult<NotePageV1>>;
}

// --------------------------------------------------------------------------
// Scribe scope and duty (P1, P5, P6)
// --------------------------------------------------------------------------

/** P1: the per-scope current-note count (L7). Does not change NoteReadPort. */
export type NoteScopeV1 = { kind: 'project' } | { kind: 'region'; moduleId: string } | { kind: 'goal'; goalId: string };
export interface NoteScopeReadPort {
  countCurrentNotes(ctx: CoreCallContext, input: { scope: NoteScopeV1 }):
    Promise<ReadResult<{ scope: NoteScopeV1; current: number }>>;
}

/** P5: the composition root passes the SAME resolver the Workflow gets. */
export type NoteDutyResolver = (role: RoleConfigurationRef, ctx: CoreCallContext) =>
  Promise<ReadResult<PlatformDutyV1 | 'unknown'>>;
