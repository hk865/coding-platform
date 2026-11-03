// Slice 4 §2 (L1–L3, L6): the note contract. A note is stored as a mutable
// `NoteHead` (current version and state) plus an immutable `NoteVersion` per
// write or disposition; a `CurrentPointer` records the accepted understanding
// per goal/stage anchor. Names and shapes are frozen by the slice-4 spec §2.
import type { CommitCursor } from './command-event.js';
import type { ModuleRef, SessionRef, SessionWorkLinkRef } from './core/identity.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { RunRef } from './dispatch.js';
import type { ContextSourceV1 } from './graph-context.js';
import type { PlatformDutyV1 } from './platform-duty.js';
import type { QueryRunRef } from './query-job.js';
import { PLATFORM_PROMPT_PACK_V1 } from './prompts/platform-pack.generated.js';
import type { ArchitectureCatalogPinV1, CatalogInterfaceV1, ModuleDefinition } from './architecture-catalog.js';

/** P9: the three aggregate refs the ledger adds (`ledger.ts` `AggregateRef`). */
export type NoteHeadRef = { aggregateType: 'NoteHead'; projectId: string; noteId: string };
export type NoteVersionRef = { aggregateType: 'NoteVersion'; projectId: string; noteId: string; version: number };
export type CurrentPointerRef = { aggregateType: 'CurrentPointer'; projectId: string; anchorKey: string };

/** A file anchor's resolved symbol locator (L2, decision 49 · Q7). */
export type SymbolLocatorV1 = { language: string; qualifiedName: string; signatureDigest: string;
  range: { startLine: number; endLine: number }; fileDigest: string };
/** The write input asks for the symbol; the platform resolves it (L14). */
export type SymbolRequestV1 = { language: string; name: string; range?: { startLine: number; endLine: number } };

export type NoteAnchorV1 =
  | { kind: 'module'; moduleId: string }
  | { kind: 'interface'; moduleId: string; interfaceId: string }
  | { kind: 'file'; path: string; symbol?: SymbolLocatorV1; deleted?: true }
  | { kind: 'goal'; goalId: string }
  | { kind: 'stage'; goalId: string; planRevision: number; stageId: string }
  | { kind: 'task'; goalId: string; taskId: string }
  | { kind: 'project' };

/** Write input: file anchors carry the request, not the resolved locator; stage carries no planRevision. */
export type NoteDraftAnchorV1 =
  | { kind: 'module'; moduleId: string }
  | { kind: 'interface'; moduleId: string; interfaceId: string }
  | { kind: 'file'; path: string; symbolRequest?: SymbolRequestV1; deleted?: true }
  | { kind: 'goal'; goalId: string }
  | { kind: 'stage'; goalId: string; stageId: string }
  | { kind: 'task'; goalId: string; taskId: string }
  | { kind: 'project' };

/** Understanding-only sections; each is at least one code point (L4). */
export type NoteSectionsV1 = { status: string; decided: string; open: string; next: string; risks: string };

export type NoteKind = 'convention' | 'pitfall' | 'tradeoff' | 'open_question' | 'preference' | 'decision'
  | 'understanding' | 'repair';
/** The six general kinds, in spec order. */
export const NOTE_GENERAL_KINDS: readonly NoteKind[] =
  ['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision'];

/** The six general kinds are the one family; every other kind is separate. */
export function isGeneral(kind: string): boolean {
  return (NOTE_GENERAL_KINDS as readonly string[]).includes(kind);
}

/** The one complete kind list; the codec, service and tool group point at it. */
export const NOTE_KINDS: readonly NoteKind[] = [...NOTE_GENERAL_KINDS, 'understanding', 'repair'];

/**
 * The one per-kind payload table: the kind's dedicated field and whether it is
 * required. Only `repair` exists in 8C; 8E adds its own entries.
 */
export const NOTE_PAYLOAD_KINDS: Readonly<Partial<Record<NoteKind, { field: string; required: boolean }>>> = {
  repair: { field: 'repair', required: true },
};

/**
 * The one per-kind payload gate: a dedicated field is present exactly on its
 * kind and required there. A decoder passes its record path as `label`; the
 * service passes none. 8E adds entries to `NOTE_PAYLOAD_KINDS`, never a second
 * rule or message.
 */
export function payloadKindProblem(body: Record<string, unknown>, kind: string,
  label?: string): string | null {
  for (const [payloadKind, entry] of Object.entries(NOTE_PAYLOAD_KINDS)) {
    if (entry === undefined) continue;
    const present = body[entry.field] !== undefined;
    if (kind === payloadKind) {
      if (entry.required && !present) {
        return label === undefined
          ? `a ${payloadKind} note requires the ${entry.field} payload`
          : `${label}.${entry.field} is required for ${payloadKind}`;
      }
    } else if (present) {
      return label === undefined
        ? `the ${entry.field} payload is only for a ${payloadKind} note`
        : `${label}.${entry.field} is only for ${payloadKind}`;
    }
  }
  return null;
}

export type CatalogRepairOpV1 =
  | { op: 'set_responsibility'; moduleId: string; text: string }
  | { op: 'set_module_name'; moduleId: string; name: string }
  | { op: 'add_path'; moduleId: string; path: string }
  | { op: 'remove_path'; moduleId: string; path: string }
  | { op: 'add_interface'; moduleId: string; interface: CatalogInterfaceV1 }
  | { op: 'set_interface'; moduleId: string; interfaceId: string; description?: string; paths?: string[] }
  | { op: 'remove_interface'; moduleId: string; interfaceId: string }
  | { op: 'set_dependency_reason'; from: ModuleRef; to: ModuleRef; reason: string }
  | { op: 'add_module'; module: ModuleDefinition }
  | { op: 'remove_module'; moduleId: string }
  | { op: 'add_dependency'; from: ModuleRef; to: ModuleRef; reason: string }
  | { op: 'remove_dependency'; from: ModuleRef; to: ModuleRef }
  | { op: 'add_forbid_rule'; from: ModuleRef; to: ModuleRef; reason: string }
  | { op: 'remove_forbid_rule'; from: ModuleRef; to: ModuleRef }
  | { op: 'set_parent'; moduleId: string; parentId: string | null };

export type ResponsibilityMoveV1 = {
  link: SessionWorkLinkRef;
  to: { kind: 'standby' } | { kind: 'modules'; destinations: ModuleRef[] };
};

export type RepairInputV1 = {
  pin: ArchitectureCatalogPinV1;
  ops: CatalogRepairOpV1[];
  responsibilityMoves: ResponsibilityMoveV1[];
};

export type RepairPayloadV1 = RepairInputV1 & { structural: boolean };

type NoteDraftCommonV1 = { topic: string; conclusion: string; anchor: NoteDraftAnchorV1; extraAnchors: NoteDraftAnchorV1[];
  facts: NoteFactV1[]; basisFiles: string[]; structural: boolean; replaces: string[]; contradicts: string[];
  coexistWith: string[] };

/** Strict per-kind union: `understanding` gives sections, `repair` gives the payload, every other kind a body. */
export type NoteDraftV1 =
  | NoteDraftCommonV1 & { kind: Exclude<NoteKind, 'understanding' | 'repair'>; body: string }
  | NoteDraftCommonV1 & { kind: 'understanding'; sections: NoteSectionsV1 }
  | NoteDraftCommonV1 & { kind: 'repair'; body: string; repair: RepairInputV1 };

export type NoteState = 'staged' | 'accepted' | 'reviewed' | 'pending_review' | 'rejected' | 'superseded' | 'withdrawn';

/**
 * Who wrote a note. An agent source names the Work Run (`runRef`) or the secretary's QueryRun (`queryRunRef`) that
 * wrote it, or null; both come only from trusted execution facts, never from the model.
 */
export type NoteSourceV1 =
  | { kind: 'agent'; sessionRef: SessionRef; runRef: RunRef | null; queryRunRef: QueryRunRef | null; duty: PlatformDutyV1 }
  | { kind: 'user'; principalId: string }
  | { kind: 'platform' };

/** A fact points at a fixed version (DESIGN §3.3). */
export type NoteFactV1 =
  | Exclude<ContextSourceV1, { kind: 'note' }>
  | { kind: 'note'; noteId: string; version: number }
  | { kind: 'file'; path: string; digest: string }
  | { kind: 'commit'; sha: string };

export type NoteReviewReason = 'structural' | 'contradiction' | 'quota_full' | 'user_note_replaced';

export type NoteBodyV1 = { kind: NoteKind; topic: string; topicKey: string; conclusion: string; body: string;
  sections?: NoteSectionsV1; anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[]; facts: NoteFactV1[];
  basis: { planRevision: number | null; catalogRevision: number | null; files: { path: string; digest: string }[] };
  structural: boolean; replaces: string[]; contradicts: string[];
  coexistWith: string[]; repair?: RepairPayloadV1 };

export type NoteHeadSnapshot = NoteBodyV1 & { ref: NoteHeadRef; noteId: string; version: number; state: NoteState;
  goalId: string | null; source: NoteSourceV1; stagedRunKey: string | null;
  reviewReasons: NoteReviewReason[]; confirmedByUser: boolean;
  anchorKey0: string; anchorKey1: string | null; anchorKey2: string | null; anchorKey3: string | null; anchorKey4: string | null;
  createdAt: string; since: CommitCursor };

export type NoteVersionSnapshot = NoteBodyV1 & { ref: NoteVersionRef; noteId: string; version: number; state: NoteState;
  goalId: string | null; source: NoteSourceV1; reviewReasons: NoteReviewReason[];
  noticeClass: 'user_affected' | 'structural' | 'scribe_result' | null;
  change: { kind: 'write' | 'review' | 'accept' | 'activate' | 'reject' | 'withdraw' | 'supersede' | 'coexist' | 'merge';
            by: NoteSourceV1; reason: string | null; decisionMessageRef: SessionMessageRef | null };
  at: string; since: CommitCursor };

export type CurrentPointerSnapshot = { ref: CurrentPointerRef; anchorKey: string; noteId: string | null; revision: number };

/**
 * Pre-bind form the encoders take for the two `since`-carrying records: the
 * RecordStore fills the placeholder from the commit cursor (`commitCursorFields`).
 */
export type PendingNoteHeadSnapshot = Omit<NoteHeadSnapshot, 'since'> & { since: CommitCursor | null };
export type PendingNoteVersionSnapshot = Omit<NoteVersionSnapshot, 'since'> & { since: CommitCursor | null };

// --------------------------------------------------------------------------
// renderNoteHeader (spec §2; user 2026-10-15 第 1 条)
// --------------------------------------------------------------------------

/** `<类名>(<锚点显示>)<!>：<结论>`; the `!` appears only for `structural`. */
export function renderNoteHeader(note: { kind: NoteKind; anchor: NoteAnchorV1; structural: boolean; conclusion: string }): string {
  // Display label per kind. The first six are frozen by §2; understanding/repair are the spec's own names.
  const labels: Record<NoteKind, string> = {
    convention: PLATFORM_PROMPT_PACK_V1.strings['note.kind.convention'],
    pitfall: PLATFORM_PROMPT_PACK_V1.strings['note.kind.pitfall'],
    tradeoff: PLATFORM_PROMPT_PACK_V1.strings['note.kind.tradeoff'],
    open_question: PLATFORM_PROMPT_PACK_V1.strings['note.kind.open_question'],
    preference: PLATFORM_PROMPT_PACK_V1.strings['note.kind.preference'],
    decision: PLATFORM_PROMPT_PACK_V1.strings['note.kind.decision'],
    understanding: PLATFORM_PROMPT_PACK_V1.strings['note.kind.understanding'],
    repair: PLATFORM_PROMPT_PACK_V1.strings['note.kind.repair'],
  };
  const anchor = note.anchor;
  let display = '';
  switch (anchor.kind) {
    case 'module': display = `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.modulePrefix']}${anchor.moduleId}`; break;
    case 'interface': display = `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.interfacePrefix']}${anchor.moduleId}/${anchor.interfaceId}`; break;
    case 'file': {
      const symbol = anchor.symbol === undefined ? '' : `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.symbolPrefix']}${anchor.symbol.qualifiedName}`;
      const deleted = anchor.deleted === true ? PLATFORM_PROMPT_PACK_V1.strings['note.anchor.deletedSuffix'] : '';
      display = `${anchor.path}${symbol}${deleted}`;
      break;
    }
    case 'goal': display = `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.goalPrefix']}${anchor.goalId}`; break;
    case 'stage': display = `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.stagePrefix']}${anchor.stageId}`; break;
    case 'task': display = `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.taskPrefix']}${anchor.taskId}`; break;
    case 'project': display = PLATFORM_PROMPT_PACK_V1.strings['note.anchor.project']; break;
  }
  const marker = note.structural ? '!' : '';
  return `${labels[note.kind]}(${display})${marker}：${note.conclusion}`;
}
