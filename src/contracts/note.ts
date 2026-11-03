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
  | 'understanding' | 'repair' | 'link' | 'flow';
/** The six general kinds, in spec order. */
export const NOTE_GENERAL_KINDS: readonly NoteKind[] =
  ['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision'];

/** The six general kinds are the one family; every other kind is separate. */
export function isGeneral(kind: string): boolean {
  return (NOTE_GENERAL_KINDS as readonly string[]).includes(kind);
}

/** The one complete kind list; the codec, service and tool group point at it. */
export const NOTE_KINDS: readonly NoteKind[] = [...NOTE_GENERAL_KINDS, 'understanding', 'repair', 'link', 'flow'];

/**
 * The one per-kind payload table: the kind's dedicated field and whether it is
 * required. 8C owns `repair`; 8E adds `link` and `flow` here.
 */
export const NOTE_PAYLOAD_KINDS: Readonly<Partial<Record<NoteKind, { field: string; required: boolean }>>> = {
  repair: { field: 'repair', required: true },
  link: { field: 'link', required: true },
  flow: { field: 'flow', required: true },
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
        if ((payloadKind === 'link' || payloadKind === 'flow') && label === undefined) return 'payload_kind_mismatch';
        return label === undefined
          ? `a ${payloadKind} note requires the ${entry.field} payload`
          : `${label}.${entry.field} is required for ${payloadKind}`;
      }
    } else if (present) {
      if ((payloadKind === 'link' || payloadKind === 'flow') && label === undefined) return 'payload_kind_mismatch';
      return label === undefined
        ? `the ${entry.field} payload is only for a ${payloadKind} note`
        : `${label}.${entry.field} is only for ${payloadKind}`;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// The link write-and-store contract (8E L1, spec §2)
// --------------------------------------------------------------------------

/** Direction = the runtime control or data flow: from → to. */
export type SemanticRelationV1 =
  | 'calls'     // from finds and calls to at runtime by name or path: registry, dynamic import, plugin, dlopen
  | 'injects'   // from knows one slot; elsewhere plugs to's implementation in at runtime; the slot is the "via"
  | 'callback'  // to hands its own function to from, which calls it back at runtime; the slot is the "via"
  | 'data'      // from writes and to reads the same data: file, table, body, configuration
  | 'message'   // from sends and to receives: topic, event, mailbox, HTTP
  | 'spawns';   // from starts to as a process: launch, child process

/** The name both sides share. */
export type LinkKeyV1 =
  | { kind: 'symbol'; anchor: { kind: 'file'; path: string; symbolRequest: SymbolRequestV1 } }
  | { kind: 'literal'; text: string };   // a name written literally in code: registry name, topic, path, program

export type LinkEvidenceRoleV1 = 'use' | 'wire' | 'register' | 'emit' | 'receive' | 'launch' | 'entry';
export type LinkEvidenceV1 = {
  role: LinkEvidenceRoleV1;
  // at most one of symbolRequest and range; neither means the whole file
  at: { path: string; symbolRequest?: SymbolRequestV1; range?: { startLine: number; endLine: number } };
};

/** Given at write time by `record_note` / `notes/write`. */
export type LinkInputV1 = {
  relation: SemanticRelationV1;
  key?: LinkKeyV1 | null;        // injects and callback give none; the others must, null when the name is built at runtime
  evidence: LinkEvidenceV1[];    // 1–8 entries (NOTE_LINK_EVIDENCE_MAX), roles per the evidence gate
};

/** The verification result. broken/unchecked only appear at read time; L1 never produces them. */
export type LinkVerificationV1 =
  | { status: 'verified' }
  | { status: 'broken'; missing: number[] }     // missing evidence indexes, 0-based; read time only
  | { status: 'unverifiable'; reason: 'key_not_literal' | 'language_unsupported' | 'analyzer_unavailable' }
  | { status: 'unchecked'; reason: 'budget' | 'unavailable' };   // read time only

/** Stored in `NoteBodyV1.link`: the raw selectors, resolved locations, file digests and the write-time result. */
export type LinkEvidenceStoredV1 = {
  role: LinkEvidenceRoleV1;
  at: {
    path: string;
    symbolRequest?: SymbolRequestV1;   // the raw selector given at write time; kept even when resolution failed
    range?: { startLine: number; endLine: number };   // the line range given at write time
    symbol?: SymbolLocatorV1;          // the resolved location; absent when resolution failed
  };
  fileDigest: string | null;           // raw_bytes of the worktree read at write time; null when unreadable
  digestBasis: 'raw_bytes';            // not directly comparable with captured decoded_utf8
};

/** The raw endpoint request: a file end carries symbolRequest; a module or interface end is itself. */
export type LinkEndRequestV1 = Extract<NoteDraftAnchorV1, { kind: 'module' | 'interface' | 'file' }>;

/** The stored symbol key: the request is kept verbatim and the resolved location is stored separately. */
export type LinkKeyStoredV1 =
  | { kind: 'symbol'; path: string; symbolRequest: SymbolRequestV1; symbol?: SymbolLocatorV1 }
  | { kind: 'literal'; text: string };

export type LinkPayloadV1 = {
  relation: SemanticRelationV1;
  /** Each end's raw request (via is null when absent). Resolved anchors live in the body's anchor/extraAnchors. */
  ends: { from: LinkEndRequestV1; to: LinkEndRequestV1; via: LinkEndRequestV1 | null };
  key?: LinkKeyStoredV1 | null;   // null for injects and callback
  evidence: LinkEvidenceStoredV1[];
  /** The captured `coverage.projectConfiguration` and the configuration digest; both null without a capture. */
  analysisConfig: { path: string | null; digest: string | null };
  verification: Extract<LinkVerificationV1, { status: 'verified' | 'unverifiable' }>;   // the write-time result
};

/** Stored in `NoteBodyV1.flow`: ordered steps, each the `noteId` of a `link` note; no versions. */
export type FlowPayloadV1 = { steps: { link: string }[] };

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

/**
 * Strict per-kind union: `understanding` gives sections, `repair` gives its payload,
 * `link` and `flow` give theirs, every other kind a body. The general arm excludes
 * all three too, so a dedicated payload cannot bypass the payload-kind gate.
 */
export type NoteDraftV1 =
  | NoteDraftCommonV1 & { kind: Exclude<NoteKind, 'understanding' | 'repair' | 'link' | 'flow'>; body: string }
  | NoteDraftCommonV1 & { kind: 'understanding'; sections: NoteSectionsV1 }
  | NoteDraftCommonV1 & { kind: 'repair'; body: string; repair: RepairInputV1 }
  | NoteDraftCommonV1 & { kind: 'link'; body: string; link: LinkInputV1 }
  | NoteDraftCommonV1 & { kind: 'flow'; body: string; flow: FlowPayloadV1 };

export type LinkDraftV1 = Extract<NoteDraftV1, { kind: 'link' }>;

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
  sections?: NoteSectionsV1; repair?: RepairPayloadV1; link?: LinkPayloadV1; flow?: FlowPayloadV1;
  anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[]; facts: NoteFactV1[];
  basis: { planRevision: number | null; catalogRevision: number | null; files: { path: string; digest: string }[] };
  structural: boolean; replaces: string[]; contradicts: string[];
  coexistWith: string[] };

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

/** The anchor's display text; the one switch all header forms share. */
function displayOfAnchor(anchor: NoteAnchorV1): string {
  switch (anchor.kind) {
    case 'module': return `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.modulePrefix']}${anchor.moduleId}`;
    case 'interface': return `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.interfacePrefix']}${anchor.moduleId}/${anchor.interfaceId}`;
    case 'file': {
      const symbol = anchor.symbol === undefined ? '' : `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.symbolPrefix']}${anchor.symbol.qualifiedName}`;
      const deleted = anchor.deleted === true ? PLATFORM_PROMPT_PACK_V1.strings['note.anchor.deletedSuffix'] : '';
      return `${anchor.path}${symbol}${deleted}`;
    }
    case 'goal': return `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.goalPrefix']}${anchor.goalId}`;
    case 'stage': return `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.stagePrefix']}${anchor.stageId}`;
    case 'task': return `${PLATFORM_PROMPT_PACK_V1.strings['note.anchor.taskPrefix']}${anchor.taskId}`;
    case 'project': return PLATFORM_PROMPT_PACK_V1.strings['note.anchor.project'];
  }
}

/**
 * `<类名>(<锚点显示>)<!>：<结论>` for the old kinds; a link renders
 * `<类名>·<关系>(<from>→<to>)：<结论>`, a flow `<类名>(<first from>)：<结论>`.
 * The `!` appears only for `structural`, which link and flow never are.
 */
export function renderNoteHeader(note: {
  kind: NoteKind;
  anchor: NoteAnchorV1;
  structural: boolean;
  conclusion: string;
  relation?: SemanticRelationV1;  // link
  to?: string;                    // the link's "to" display
  firstFrom?: string;             // the flow's first-step "from" display
}): string {
  // Display label per kind. The compiler is the checklist: every kind needs a label.
  const labels: Record<NoteKind, string> = {
    convention: PLATFORM_PROMPT_PACK_V1.strings['note.kind.convention'],
    pitfall: PLATFORM_PROMPT_PACK_V1.strings['note.kind.pitfall'],
    tradeoff: PLATFORM_PROMPT_PACK_V1.strings['note.kind.tradeoff'],
    open_question: PLATFORM_PROMPT_PACK_V1.strings['note.kind.open_question'],
    preference: PLATFORM_PROMPT_PACK_V1.strings['note.kind.preference'],
    decision: PLATFORM_PROMPT_PACK_V1.strings['note.kind.decision'],
    understanding: PLATFORM_PROMPT_PACK_V1.strings['note.kind.understanding'],
    repair: PLATFORM_PROMPT_PACK_V1.strings['note.kind.repair'],
    link: PLATFORM_PROMPT_PACK_V1.strings['note.kind.link'],
    flow: PLATFORM_PROMPT_PACK_V1.strings['note.kind.flow'],
  };
  const anchor = displayOfAnchor(note.anchor);
  if (note.kind === 'link' && note.relation !== undefined && note.to !== undefined) {
    const relationLabels: Record<SemanticRelationV1, string> = {
      calls: PLATFORM_PROMPT_PACK_V1.strings['note.relation.calls'],
      injects: PLATFORM_PROMPT_PACK_V1.strings['note.relation.injects'],
      callback: PLATFORM_PROMPT_PACK_V1.strings['note.relation.callback'],
      data: PLATFORM_PROMPT_PACK_V1.strings['note.relation.data'],
      message: PLATFORM_PROMPT_PACK_V1.strings['note.relation.message'],
      spawns: PLATFORM_PROMPT_PACK_V1.strings['note.relation.spawns'],
    };
    return `${labels.link}·${relationLabels[note.relation]}(${anchor}→${note.to})：${note.conclusion}`;
  }
  if (note.kind === 'flow' && note.firstFrom !== undefined) {
    return `${labels.flow}(${note.firstFrom})：${note.conclusion}`;
  }
  const marker = note.structural ? '!' : '';
  return `${labels[note.kind]}(${anchor})${marker}：${note.conclusion}`;
}

/**
 * The optional extras `renderNoteHeader` takes for a link or a flow, so the
 * call sites do not each re-derive them. A caller with a `NoteItemV1` projects
 * `kind`, `anchor`, `extraAnchors` and `link` only.
 */
export function headerExtrasOf(note: {
  kind: NoteKind;
  anchor: NoteAnchorV1;
  extraAnchors?: readonly NoteAnchorV1[];
  link?: { relation: SemanticRelationV1 };
}): { relation?: SemanticRelationV1; to?: string; firstFrom?: string } {
  if (note.kind === 'link' && note.link !== undefined) {
    const to = note.extraAnchors?.[0];
    return { relation: note.link.relation, ...(to === undefined ? {} : { to: displayOfAnchor(to) }) };
  }
  if (note.kind === 'flow') return { firstFrom: displayOfAnchor(note.anchor) };
  return {};
}

/** P1: the scribe scope a note count is taken over (L7): the project, one region or one goal. */
export type NoteScopeV1 = { kind: 'project' } | { kind: 'region'; moduleId: string } | { kind: 'goal'; goalId: string };
