/**
 * KLS-2b: the one rule set between the knowledge files and the note reads.
 * `indexKnowledgeFile` is the only way a file's index rows change (the write
 * order after a commit, the reconciliation later); `noteDerivedRowsOf` gives a
 * note's anchor keys, text and edges; `overlayFileKnowledge` puts a note
 * file's knowledge over the record head (the runtime state, digests and
 * resolved symbols stay the record's). An unchanged file gives the record head
 * back as it is. A missing or bad file is `unavailable` (R8), never the record.
 *
 * It lives here, not in `knowledge/`: it needs the note and architecture file
 * parsers and the anchor keys, which sit above `knowledge/`.
 */
import { rejected } from '../../../contracts/core/rejections.js';
import { messageOf } from '../../../contracts/error-message.js';
import { sameJson } from '../../../contracts/fingerprint.js';
import type { LinkPayloadV1, NoteAnchorV1, NoteFactV1, NoteHeadSnapshot } from '../../../contracts/note.js';
import type {
  KnowledgeDerivedRows, KnowledgeEdgeKind, KnowledgeFileKind, KnowledgeIndex, KnowledgeIndexTx,
} from '../../record-store/knowledge-index-ports.js';
import { normalizeSearchText } from '../../record-store/lookup-index.js';
import type { DecodeResult, StoreResult } from '../../record-store/ports.js';
import { gitBlobId } from '../../workspace/workspace-change-capture.js';
import {
  lineRefKey, type KnowledgeAnchorV1, type LineKnowledge, type LineNoteFileV1, type LineNoteV1,
  type NoteKnowledgeV1,
} from '../model/line-knowledge.js';
import { ARCHITECTURE_FILE_PATH, architectureFileOf, moduleFileOf } from '../architecture/architecture-file.js';
import type { KnowledgeRead } from '../architecture/catalog-service.js';
import type { DecisionSourceAttempt } from '../model/decision-contracts.js';
import { anchorKeyOf, topicKeyOf } from './note-anchors.js';
import { isKnowledgeAnchor, noteIdFromFilePath, noteKnowledgeOf, noteOfFileBytes } from './note-file.js';

export function noteDerivedRowsOf(knowledge: NoteKnowledgeV1): KnowledgeDerivedRows {
  const edges: { toRef: string; kind: KnowledgeEdgeKind }[] = [];
  const link = knowledge.link;
  if (link !== undefined) edges.push({ toRef: endKeyOf(link.ends.from), kind: 'link_from' });
  for (const step of knowledge.flow?.steps ?? []) edges.push({ toRef: step.link, kind: 'flow_step' });
  return {
    anchorKeys: [knowledge.anchor, ...knowledge.extraAnchors].map(anchor => anchorKeyOf(anchor)),
    text: normalizeSearchText(`${knowledge.topic}\n${knowledge.conclusion}\n${knowledge.body}`),
    edges,
  };
}

/** A link end's anchor key (a file end without its symbol request). */
function endKeyOf(end: LinkPayloadV1['ends']['from']): string {
  return anchorKeyOf(end.kind === 'file' ? { kind: 'file', path: end.path } : end);
}

/**
 * One file's rows on this line from its current bytes: none when `bytes` is null; a file that does not parse
 * loses its current mapping (and a note its rows) and is `invalid` with its path; an architecture file maps
 * only its blob (no derived rows).
 */
export function indexKnowledgeFile(tx: KnowledgeIndexTx, line: LineKnowledge, path: string,
  bytes: Uint8Array | null): DecodeResult<{ kind: KnowledgeFileKind; blobSha: string | null }> {
  const lineRef = lineRefKey(line.scope, line.line);
  const noteId = noteIdFromFilePath(path);
  const kind: KnowledgeFileKind = noteId !== null ? 'note' : path === ARCHITECTURE_FILE_PATH ? 'architecture' : 'module';
  const drop = (): void => {
    tx.deleteFile(lineRef, path);
    if (noteId !== null) tx.clearNoteRows(lineRef, noteId);
  };
  if (bytes === null) {
    drop();
    return { status: 'decoded', value: { kind, blobSha: null } };
  }
  // The blob's parse is kept in the file frame: one blob reads the same in every workspace.
  const ownFrame = { workspaceId: line.scope.workspaceId, mainWorkspaceId: line.scope.workspaceId };
  let parsed: unknown;
  let rows: KnowledgeDerivedRows | null = null;
  if (noteId !== null) {
    const framed = noteOfFileBytes(bytes, ownFrame);
    const viewed = noteOfFileBytes(bytes, line.scope);
    if (framed.status !== 'decoded' || viewed.status !== 'decoded') {
      drop();
      return { status: 'invalid', reason: `${path}: ${framed.status !== 'decoded' ? framed.reason : (viewed as { reason: string }).reason}` };
    }
    parsed = framed.value;
    rows = noteDerivedRowsOf(viewed.value);
  } else {
    const file = kind === 'architecture'
      ? architectureFileOf(bytes, line.scope.workspaceId === line.scope.mainWorkspaceId) : moduleFileOf(path, bytes);
    if (typeof file === 'string') {
      drop();
      return { status: 'invalid', reason: file.startsWith(path) ? file : `${path}: ${file}` };
    }
    parsed = file;
  }
  const blobSha = gitBlobId(bytes, line.objectFormat);
  tx.setFile({ lineRef, path, blobSha, kind }, JSON.stringify(parsed));
  if (noteId !== null && rows !== null) tx.replaceNoteRows(lineRef, noteId, rows);
  return { status: 'decoded', value: { kind, blobSha } };
}

/** Where each note's file is now: every line of the project, by id (a note's file is on one line only). */
export async function notesAcrossLines(read: KnowledgeRead, noteIds: readonly string[]):
Promise<StoreResult<Map<string, { line: LineKnowledge; note: LineNoteFileV1 }>>> {
  const found = new Map<string, { line: LineKnowledge; note: LineNoteFileV1 }>();
  if (noteIds.length === 0) return { status: 'ready', value: found };
  const lines = await read.lines.project(read.caller);
  if (lines.status !== 'ready') return lines;
  for (const line of lines.value) {
    const notes = await line.readNoteFiles(noteIds.filter(noteId => !found.has(noteId)));
    if (notes.status !== 'ready') return notes;
    for (const note of notes.value) found.set(note.noteId, { line, note });
  }
  return { status: 'ready', value: found };
}

/**
 * The record head with the file's knowledge (kls2b-build [2B-18]); Q4: a file or basis path the record has
 * no digest for is left out of the checkable facts and the note reads `unchecked`.
 */
function overlaidHead(head: NoteHeadSnapshot, file: NoteKnowledgeV1): { head: NoteHeadSnapshot; unchecked: boolean } {
  const recorded = noteKnowledgeOf(head);
  if (sameJson(recorded, file)) return { head, unchecked: false };
  const recordedFiles = [head.anchor, ...head.extraAnchors].filter((anchor): anchor is Extract<NoteAnchorV1, { kind: 'file' }> =>
    anchor.kind === 'file');
  const withSymbol = (anchor: KnowledgeAnchorV1): NoteAnchorV1 => {
    const symbol = anchor.kind === 'file' ? recordedFiles.find(entry => entry.path === anchor.path)?.symbol : undefined;
    return symbol === undefined ? anchor : { ...anchor, symbol } as NoteAnchorV1;
  };
  const sameAnchors = sameJson(recorded.anchor, file.anchor) && sameJson(recorded.extraAnchors, file.extraAnchors);
  const anchor = sameAnchors ? head.anchor : withSymbol(file.anchor);
  const extraAnchors = sameAnchors ? head.extraAnchors
    : [...file.extraAnchors.map(withSymbol), ...head.extraAnchors.filter(entry => !isKnowledgeAnchor(entry))];
  let unchecked = false;
  const facts = file.facts.flatMap((fact): NoteFactV1[] => {
    if (fact.kind !== 'file') return [fact];
    const digest = head.facts.find(entry => entry.kind === 'file' && entry.path === fact.path);
    if (digest === undefined) unchecked = true;
    return digest === undefined ? [] : [digest];
  });
  const basisFiles = file.basisFiles.flatMap(path => {
    const digest = head.basis.files.find(entry => entry.path === path);
    if (digest === undefined) unchecked = true;
    return digest === undefined ? [] : [digest];
  });
  const keys = sameAnchors ? [head.anchorKey0, head.anchorKey1, head.anchorKey2, head.anchorKey3, head.anchorKey4]
    : [anchor, ...extraAnchors].map(entry => anchorKeyOf(entry));
  const { sections: _sections, link: _link, flow: _flow, repair: _repair, ...rest } = head;
  const result: NoteHeadSnapshot = {
    ...rest,
    kind: file.kind, source: file.source, topic: file.topic, topicKey: topicKeyOf(file.topic), conclusion: file.conclusion,
    body: file.body, ...(file.sections === undefined ? {} : { sections: file.sections }),
    anchor, extraAnchors, facts, basis: { ...head.basis, files: basisFiles }, structural: file.structural,
    replaces: [...file.replaces], contradicts: [...file.contradicts], coexistWith: [...file.coexistWith],
    anchorKey0: keys[0]!, anchorKey1: keys[1] ?? null, anchorKey2: keys[2] ?? null, anchorKey3: keys[3] ?? null,
    anchorKey4: keys[4] ?? null,
    ...(file.link === undefined ? {} : { link: linkOverlay(head.link, file.link) }),
    ...(file.flow === undefined ? {} : { flow: { steps: file.flow.steps.map(step => ({ link: step.link })) } }),
    ...(file.repair === undefined || head.repair === undefined ? {} : { repair: { ...head.repair, ops: file.repair.ops } }),
  };
  return { head: result, unchecked };
}

/** The file's locating input and roles, with the record's resolved symbols and digests where the place is the same. */
function linkOverlay(recorded: LinkPayloadV1 | undefined, file: NonNullable<NoteKnowledgeV1['link']>): LinkPayloadV1 {
  const key = file.key === null ? null : file.key.kind === 'literal' ? file.key
    : recorded?.key?.kind === 'symbol' && recorded.key.path === file.key.path && sameJson(recorded.key.symbolRequest, file.key.symbolRequest)
      ? { ...file.key, ...(recorded.key.symbol === undefined ? {} : { symbol: recorded.key.symbol }) } : file.key;
  return {
    relation: file.relation, ends: file.ends, key,
    evidence: file.evidence.map((entry, index) => {
      const old = recorded?.evidence[index];
      return old !== undefined && old.at.path === entry.at.path && sameJson({ ...old.at, symbol: null }, { ...entry.at, symbol: null })
        ? { ...old, role: entry.role } : { role: entry.role, at: entry.at, fileDigest: null, digestBasis: 'raw_bytes' as const };
    }),
    analysisConfig: recorded?.analysisConfig ?? { path: null, digest: null },
    verification: recorded?.verification ?? { status: 'unverifiable', reason: 'analyzer_unavailable' },
  };
}

/**
 * A platform rewrite of a note that has a file keeps the file as its base (ruling 8 F-20 甲). The overlay shows
 * every knowledge field from the file except the file and basis paths the record has no digest for, so a written
 * head differs from the file only where the command changed a field, or where it lacks those paths: when that is
 * all a list lacks, the file's list stays as it is.
 */
export function rewrittenKnowledge(written: NoteKnowledgeV1, file: NoteKnowledgeV1): NoteKnowledgeV1 {
  return { ...written,
    facts: onlyDropped(written.facts, file.facts, fact => fact.kind === 'file') ? file.facts : written.facts,
    basisFiles: onlyDropped(written.basisFiles, file.basisFiles, () => true) ? file.basisFiles : written.basisFiles };
}

/** `written` is `file` in order with only `droppable` entries left out. */
function onlyDropped<T>(written: readonly T[], file: readonly T[], droppable: (entry: T) => boolean): boolean {
  let at = 0;
  for (const entry of file) {
    if (at < written.length && sameJson(written[at], entry)) at += 1;
    else if (!droppable(entry)) return false;
  }
  return at === written.length;
}

/**
 * Where an overlaid head's knowledge came from: its line, its file's blob (the "needs verification" row's key)
 * and whether a file or basis path has no recorded digest (Q4: the note reads `unchecked`). Kept per head
 * object, so a read hands the head on and asks here instead of threading the file through every reader.
 */
export type NoteFileFacts = { lineRef: string; blobSha: string; uncheckedPaths: boolean };
const FILE_OF = new WeakMap<NoteHeadSnapshot, NoteFileFacts>();
export function noteFileFactsOf(head: NoteHeadSnapshot): NoteFileFacts | undefined { return FILE_OF.get(head); }

/** One record head with the knowledge of its file on `line`. */
export function headWithFile(head: NoteHeadSnapshot, line: LineKnowledge, note: LineNoteFileV1): NoteHeadSnapshot {
  const overlaid = overlaidHead(head, note.knowledge);
  FILE_OF.set(overlaid.head, { lineRef: lineRefKey(line.scope, line.line), blobSha: note.blobSha,
    uncheckedPaths: overlaid.unchecked });
  return overlaid.head;
}

/** The record heads with each knowledge-anchored head's file knowledge over it (found by id on every line). */
export async function overlayFileKnowledge(heads: readonly NoteHeadSnapshot[], read: KnowledgeRead):
Promise<StoreResult<NoteHeadSnapshot[]>> {
  const wanted = heads.filter(head => isKnowledgeAnchor(head.anchor)).map(head => head.noteId);
  if (wanted.length === 0) return { status: 'ready', value: [...heads] };
  const found = await notesAcrossLines(read, wanted);
  if (found.status !== 'ready') return found;
  const missing = wanted.filter(noteId => !found.value.has(noteId));
  if (missing.length > 0) return rejected('unavailable', `the note file of ${missing.join(', ')} is missing on every line`);
  return { status: 'ready', value: heads.map(head => {
    const entry = found.value.get(head.noteId);
    return entry === undefined ? head : headWithFile(head, entry.line, entry.note);
  }) };
}

/** A module, interface or file anchor key (a note on one has its file and index rows). */
export function isKnowledgeAnchorKey(key: string): boolean {
  return key.startsWith('module:') || key.startsWith('interface:') || key.startsWith('file:');
}

/**
 * The notes of `ids` on `line` with their record heads. When the caller already read every one of those heads
 * (a record lookup page that listed them), only the files are read; otherwise one `readMany` reads them all.
 */
export async function lineNotesOf(line: LineKnowledge, ids: readonly string[],
  known: ReadonlyMap<string, NoteHeadSnapshot>): Promise<StoreResult<LineNoteV1[]>> {
  if (!ids.every(noteId => known.has(noteId))) return line.readNotesById(ids);
  const files = await line.readNoteFiles(ids);
  return files.status !== 'ready' ? files
    : { status: 'ready', value: files.value.map(note => ({ ...note, head: known.get(note.noteId)! })) };
}

/** [2B-16]: a filed note this project has no record head of, with the line its file is on. */
export type HeadlessNote = { line: LineKnowledge; note: LineNoteFileV1 };

/** The note ids the index lists on each line of the project (`idsOf` asks one line's rows); a line with none is left out. */
export async function indexedNoteIds(read: KnowledgeRead,
  idsOf: (index: KnowledgeIndex, lineRef: string) => readonly string[]):
Promise<StoreResult<{ line: LineKnowledge; ids: readonly string[] }[]>> {
  const lines = await read.lines.project(read.caller);
  if (lines.status !== 'ready') return lines;
  const listed: { line: LineKnowledge; ids: readonly string[] }[] = [];
  for (const line of lines.value) {
    let ids: readonly string[];
    try {
      ids = idsOf(read.lines.write.indexOf(read.caller.projectId), lineRefKey(line.scope, line.line));
    } catch (error) {
      return rejected('unavailable', `the knowledge index cannot be read: ${messageOf(error)}`);
    }
    if (ids.length > 0) listed.push({ line, ids });
  }
  return { status: 'ready', value: listed };
}

/** [2B-17]: a note the index listed whose file is gone since makes the read unavailable with the ids. */
function goneFiles(line: LineKnowledge, ids: readonly string[], found: readonly { noteId: string }[]) {
  const gone = ids.filter(noteId => !found.some(note => note.noteId === noteId));
  return gone.length === 0 ? null
    : rejected('unavailable', `the indexed note files of ${gone.join(', ')} are missing on ${line.line.folder}`);
}

/** The files of notes the index listed on `line`, without their record heads ([2B-17] as `indexedNotes`). */
export async function indexedFilesOn(line: LineKnowledge, ids: readonly string[]): Promise<StoreResult<LineNoteFileV1[]>> {
  const files = await line.readNoteFiles(ids);
  if (files.status !== 'ready') return files;
  return goneFiles(line, ids, files.value) ?? files;
}

/**
 * The notes the index lists on each line of the project (`idsOf` asks one line's rows), read from their files
 * with their record heads (`known` ones are not read again): the ones with a head (overlaid) and the ones
 * without; one whose file is gone since it was indexed makes the read unavailable with the ids ([2B-17]).
 */
export async function indexedNotes(read: KnowledgeRead,
  idsOf: (index: KnowledgeIndex, lineRef: string) => readonly string[],
  known: ReadonlyMap<string, NoteHeadSnapshot> = new Map()):
Promise<StoreResult<{ heads: NoteHeadSnapshot[]; headless: HeadlessNote[] }>> {
  const listed = await indexedNoteIds(read, idsOf);
  if (listed.status !== 'ready') return listed;
  const heads: NoteHeadSnapshot[] = [];
  const headless: HeadlessNote[] = [];
  for (const { line, ids } of listed.value) {
    const notes = await lineNotesOf(line, ids, known);
    if (notes.status !== 'ready') return notes;
    const gone = goneFiles(line, ids, notes.value);
    if (gone !== null) return gone;
    for (const note of notes.value) {
      if (note.head !== null) heads.push(headWithFile(note.head, line, note));
      else headless.push({ line, note });
    }
  }
  return { status: 'ready', value: { heads, headless } };
}

/** `indexedNotes` for a caller that needs the state: only the notes with a record head. */
export async function indexedHeads(read: KnowledgeRead,
  idsOf: (index: KnowledgeIndex, lineRef: string) => readonly string[],
  known: ReadonlyMap<string, NoteHeadSnapshot> = new Map()): Promise<StoreResult<NoteHeadSnapshot[]>> {
  const notes = await indexedNotes(read, idsOf, known);
  return notes.status !== 'ready' ? notes : { status: 'ready', value: notes.value.heads };
}

/**
 * R-窗 (ruling 9), before a ledger read window is fixed: `heads` overlaid with their files, the filed ones kept in
 * the window attempt's cache under `key`; the overlaid heads are returned too.
 */
export async function prepareNoteFiles(attempt: DecisionSourceAttempt, key: string, heads: readonly NoteHeadSnapshot[],
  read: KnowledgeRead): Promise<StoreResult<NoteHeadSnapshot[]>> {
  const overlaid = await overlayFileKnowledge(heads, read);
  if (overlaid.status !== 'ready') return overlaid;
  const prepared = (attempt.cache.get(key) as Map<string, NoteHeadSnapshot> | undefined) ?? new Map();
  for (const head of overlaid.value) if (isKnowledgeAnchor(head.anchor)) prepared.set(head.noteId, head);
  attempt.cache.set(key, prepared);
  return overlaid;
}

/**
 * Inside the window: the record heads with the knowledge `prepareNoteFiles` read, no file read. `moved` when a filed
 * head was not prepared or its version moved since; `undefined` when nothing was prepared under `key` (a read outside
 * a window overlays the files itself).
 */
export function preparedHeads(attempt: DecisionSourceAttempt | undefined, key: string,
  heads: readonly NoteHeadSnapshot[]): NoteHeadSnapshot[] | 'moved' | undefined {
  const prepared = attempt?.cache.get(key) as Map<string, NoteHeadSnapshot> | undefined;
  if (prepared === undefined) return undefined;
  const shown: NoteHeadSnapshot[] = [];
  for (const head of heads) {
    const before = isKnowledgeAnchor(head.anchor) ? prepared.get(head.noteId) : head;
    if (before === undefined || before.version !== head.version) return 'moved';
    shown.push(before);
  }
  return shown;
}
