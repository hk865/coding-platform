// Slice 4 §2 (L1–L3, L6): the note contract. A note is stored as a mutable
// `NoteHead` (current version and state) plus an immutable `NoteVersion` per
// write or disposition; a `CurrentPointer` records the accepted understanding
// per goal/stage anchor. Names and shapes are frozen by the slice-4 spec §2.
import type { CommitCursor } from './command-event.js';
import type { SessionRef } from './core/identity.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { RunRef } from './dispatch.js';
import type { ContextSourceV1 } from './graph-context.js';
import type { PlatformDutyV1 } from './platform-duty.js';

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

type NoteDraftCommonV1 = { topic: string; conclusion: string; anchor: NoteDraftAnchorV1; extraAnchors: NoteDraftAnchorV1[];
  facts: NoteFactV1[]; basisFiles: string[]; structural: boolean; replaces: string[]; contradicts: string[];
  coexistWith: string[] };

/** Strict per-kind union: `understanding` gives sections and no body, every other kind the reverse. */
export type NoteDraftV1 =
  | NoteDraftCommonV1 & { kind: Exclude<NoteKind, 'understanding'>; body: string }
  | NoteDraftCommonV1 & { kind: 'understanding'; sections: NoteSectionsV1 };

export type NoteState = 'staged' | 'accepted' | 'reviewed' | 'pending_review' | 'rejected' | 'superseded' | 'withdrawn';

export type NoteSourceV1 =
  | { kind: 'agent'; sessionRef: SessionRef; runRef: RunRef | null; duty: PlatformDutyV1 }
  | { kind: 'user'; principalId: string }
  | { kind: 'platform' };

/** A fact points at a fixed version (DESIGN §3.3). */
export type NoteFactV1 =
  | Exclude<ContextSourceV1, { kind: 'note' }>
  | { kind: 'note'; noteId: string; version: number }
  | { kind: 'file'; path: string; digest: string }
  | { kind: 'commit'; sha: string };

export type NoteReviewReason = 'structural' | 'contradiction' | 'quota_full';

export type NoteBodyV1 = { kind: NoteKind; topic: string; topicKey: string; conclusion: string; body: string;
  sections?: NoteSectionsV1; anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[]; facts: NoteFactV1[];
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
  change: { kind: 'write' | 'review' | 'accept' | 'reject' | 'withdraw' | 'supersede' | 'coexist' | 'merge';
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
    convention: '约定', pitfall: '坑', tradeoff: '取舍', open_question: '待解问题', preference: '偏好',
    decision: '决定', understanding: '当前理解', repair: '修补',
  };
  const anchor = note.anchor;
  let display = '';
  switch (anchor.kind) {
    case 'module': display = `模块 ${anchor.moduleId}`; break;
    case 'interface': display = `接口 ${anchor.moduleId}/${anchor.interfaceId}`; break;
    case 'file': {
      const symbol = anchor.symbol === undefined ? '' : `#${anchor.symbol.qualifiedName}`;
      const deleted = anchor.deleted === true ? '（已删）' : '';
      display = `${anchor.path}${symbol}${deleted}`;
      break;
    }
    case 'goal': display = `目标 ${anchor.goalId}`; break;
    case 'stage': display = `阶段 ${anchor.stageId}`; break;
    case 'task': display = `任务 ${anchor.taskId}`; break;
    case 'project': display = '项目'; break;
  }
  const marker = note.structural ? '!' : '';
  return `${labels[note.kind]}(${display})${marker}：${note.conclusion}`;
}
