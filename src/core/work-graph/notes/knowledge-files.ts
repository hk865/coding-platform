/**
 * The knowledge-file rules a knowledge write and a recovery need and `knowledge/` cannot reach: which event of a
 * commit carries a file's content, a path's kind, the module a module file names, and a logged file rebuilt from the
 * event that carries it. The composition root hands the one `knowledgeFileRules` object to every write through
 * `KnowledgeWriteDeps.files`, next to the indexer.
 *
 * It lives in `notes/`, not `knowledge/`: the note file names and the architecture event types sit above
 * `knowledge/`, and `notes/` reaches both `architecture/` and `persistence/`.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import { projectModuleId, rawModuleId } from '../../../contracts/workspace-module-id.js';
import type { KnowledgeFileKind } from '../../record-store/knowledge-index-ports.js';
import type { DecodeResult, EncodedDomainEvent, EncodedRecord } from '../../record-store/ports.js';
import { ARCHITECTURE_FILE_PATH } from '../../../contracts/knowledge.js';
import { architectureFileOf, architectureFilesOf, moduleFileIdOf, moduleFileOf, projectedFileOf } from '../architecture/architecture-file.js';
import type { ArchitectureBaselineContentV1 } from '../architecture/catalog-contracts.js';
import {
  ARCHITECTURE_CATALOG_ADOPTED_EVENT, ARCHITECTURE_CATALOG_REVISED_EVENT, decodeArchitectureCatalogAdoptedEvent,
  decodeArchitectureCatalogRevisedEvent,
} from '../architecture/catalog-record-codecs.js';
import { knowledgeBaselineOf } from '../architecture/catalog-service.js';
import type {
  KnowledgeBaselineV1, KnowledgeFileRules, KnowledgeLineScope, KnowledgeRecordedArchitecture, NoteKnowledgeV1,
} from '../model/line-knowledge.js';
import {
  NOTE_DISPOSITION_CHANGED_EVENT_TYPE, NOTE_WRITTEN_EVENT_TYPE, decodeNoteHeadSnapshot, noteDispositionChangedEventFromEvent,
  noteHeadRefKey, noteWrittenEventFromEvent,
} from '../persistence/note-record-codecs.js';
import { noteFileBytes, noteFileKnowledgeOf, noteIdFromFilePath, noteOfFileBytes } from './note-file.js';

const NOTE_HEAD_EVENTS: readonly string[] = [NOTE_WRITTEN_EVENT_TYPE, NOTE_DISPOSITION_CHANGED_EVENT_TYPE];
const CATALOG_EVENTS: readonly string[] = [ARCHITECTURE_CATALOG_ADOPTED_EVENT, ARCHITECTURE_CATALOG_REVISED_EVENT];

/** The one rule of a path's kind (write log and index): a note file by its name, `architecture.json`, else a module file. */
export function knowledgeFileKindOf(path: string): KnowledgeFileKind {
  return noteIdFromFilePath(path) !== null ? 'note' : path === ARCHITECTURE_FILE_PATH ? 'architecture' : 'module';
}

/**
 * The indexer's parse of one knowledge file (`indexKnowledgeFile` keeps its rows from it): a note file's file-frame
 * parse, the same bytes in the project view the rows come from, or an architecture or module file's parse of its
 * path. A note's reason starts with its path; an architecture or module file's gets the path prepended when the
 * parser's reason does not start with it (the notice ids are computed from these reasons).
 */
export function knowledgeFileParseOf(scope: KnowledgeLineScope, path: string, bytes: Uint8Array):
  DecodeResult<{ parsed: unknown; viewed: NoteKnowledgeV1 | null }> {
  const noteId = noteIdFromFilePath(path);
  // The blob's parse is kept in the file frame: one blob reads the same in every workspace.
  const ownFrame = { workspaceId: scope.workspaceId, mainWorkspaceId: scope.workspaceId };
  if (noteId !== null) {
    const framed = noteOfFileBytes(bytes, ownFrame);
    const viewed = noteOfFileBytes(bytes, scope);
    if (framed.status !== 'decoded' || viewed.status !== 'decoded') {
      return { status: 'invalid',
        reason: `${path}: ${framed.status !== 'decoded' ? framed.reason : (viewed as { reason: string }).reason}` };
    }
    return { status: 'decoded', value: { parsed: framed.value, viewed: viewed.value } };
  }
  const file = knowledgeFileKindOf(path) === 'architecture'
    ? architectureFileOf(bytes, scope.workspaceId === scope.mainWorkspaceId) : moduleFileOf(path, bytes);
  if (typeof file === 'string') return { status: 'invalid', reason: file.startsWith(path) ? file : `${path}: ${file}` };
  return { status: 'decoded', value: { parsed: file, viewed: null } };
}

/** KC-2: whether these bytes read as the knowledge file at `path` on this line: the indexer's own parse, one file, not the graph. */
export function readsAsKnowledge(scope: KnowledgeLineScope, path: string, bytes: Uint8Array): boolean {
  return knowledgeFileParseOf(scope, path, bytes).status === 'decoded';
}

/** KC-2: the record key of a note file's head (`NoteHead`); null for an architecture or module file. */
export function noteHeadKeyOf(projectId: string, path: string): string | null {
  const noteId = noteIdFromFilePath(path);
  return noteId === null ? null : noteHeadRefKey({ aggregateType: 'NoteHead', projectId, noteId });
}

/**
 * The index in `events` of the event that carries this file's content: for a note file the last note event whose
 * head is that note, for an architecture or module file the last catalog adoption or revision. Every write point
 * commits such an event with its file changes, so none is a programming error and throws (the write point's commit
 * turns a throw into `unavailable`, nothing committed).
 */
function carrierEventIndex(events: readonly EncodedDomainEvent[], path: string): number {
  const noteId = noteIdFromFilePath(path);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (noteId === null ? CATALOG_EVENTS.includes(event.eventType)
      : NOTE_HEAD_EVENTS.includes(event.eventType) && headNoteIdOf(event) === noteId) return index;
  }
  throw new Error(`no event of this commit carries the knowledge file ${path}`);
}

function headNoteIdOf(event: EncodedDomainEvent): unknown {
  const body = JSON.parse(event.json) as { head?: { noteId?: unknown } };
  return body.head?.noteId;
}

/**
 * A write log's kind and module: a module file's own raw id from its bytes (the bytes written, or the bytes deleted)
 * turned into the project view in the line's workspace, as the read-back does; null for the other kinds, and for a
 * module file whose bytes name no module (KC-3: a repair deletes such a file; ruling Q4).
 */
function writeLogFileOf(scope: KnowledgeLineScope, path: string, bytes: Uint8Array):
{ kind: KnowledgeFileKind; moduleId: string | null } {
  const kind = knowledgeFileKindOf(path);
  if (kind !== 'module') return { kind, moduleId: null };
  const fileId = moduleFileIdOf(path, bytes);
  return { kind, moduleId: fileId.status === 'decoded'
    ? projectModuleId(scope.workspaceId, fileId.value, scope.mainWorkspaceId) : null };
}

/**
 * This line's part of a catalog at `target.path`: the architecture file or the module whose raw id is the target's
 * (`rawModuleId`: a second workspace logs the project view), null (deleted) when this line has none. The architecture
 * file never looks at the current bytes (split ruling 3).
 */
function catalogFileOf(catalog: AdoptedArchitecture, baseline: KnowledgeBaselineV1, scope: KnowledgeLineScope,
  target: { path: string; moduleId: string | null }): DecodeResult<Uint8Array | null> {
  const files = architectureFilesOf(catalog, baseline, scope);
  if (files.status !== 'decoded') return files;
  const rawId = target.moduleId === null ? null : rawModuleId(target.moduleId).moduleId;
  return { status: 'decoded', value: projectedFileOf(files.value, target.path, rawId) };
}

/**
 * [2C1-02], split ruling 3: a logged file rebuilt from the one event that carries it, by the write's own rules. A
 * note file: its event's head on the current file as the base (`noteFileKnowledgeOf`), so the person's paths without
 * a digest stay; a current file that does not read is `invalid`, never a rebuild without its base. The architecture
 * file: this line's part of the event's catalog (`architectureFilesOf`). A module file: the module whose raw id is
 * the log's (`rawModuleId`: a second workspace logs the project view), null (deleted) when this line has none.
 */
function knowledgeFileOfEvent(event: EncodedDomainEvent, scope: KnowledgeLineScope,
  target: { path: string; moduleId: string | null }, current: Uint8Array | null): DecodeResult<Uint8Array | null> {
  if (knowledgeFileKindOf(target.path) === 'note') {
    const note = event.eventType === NOTE_DISPOSITION_CHANGED_EVENT_TYPE ? noteDispositionChangedEventFromEvent(event)
      : noteWrittenEventFromEvent(event);
    if (note.status !== 'decoded') return note;
    const base = current === null ? null : noteOfFileBytes(current, scope);
    if (base !== null && base.status !== 'decoded') return base;
    return noteFileBytes(noteFileKnowledgeOf(note.value.head, base === null ? null : base.value), scope);
  }
  const committed = catalogOfEvent(event);
  if (committed.status !== 'decoded') return committed;
  return catalogFileOf(committed.value.catalog, knowledgeBaselineOf(committed.value.baseline), scope, target);
}

/**
 * KC-2 (121-106 ④): a knowledge file from the records alone, a bad file's third source. architecture.json or the
 * module whose raw id is the target's is this line's part of `architecture` (the rule `knowledgeFileOfEvent` uses,
 * without an event); a note file is its head with no file as a base (ruling 4-13, only here). Null when the record
 * has none.
 */
export function recordedFileOf(scope: KnowledgeLineScope, target: { path: string; moduleId: string | null },
  record: { architecture: KnowledgeRecordedArchitecture | null; noteHead: EncodedRecord | null }): DecodeResult<Uint8Array | null> {
  if (knowledgeFileKindOf(target.path) === 'note') {
    if (record.noteHead === null) return { status: 'decoded', value: null };
    const head = decodeNoteHeadSnapshot(record.noteHead);
    if (head.status !== 'decoded') return head;
    return noteFileBytes(noteFileKnowledgeOf(head.value, null), scope);
  }
  if (record.architecture === null) return { status: 'decoded', value: null };
  return catalogFileOf(record.architecture.catalog, record.architecture.baseline, scope, target);
}

/** The catalog and baseline an adoption (`catalog`, `baseline.content`) or a revision (under `revision`) committed. */
function catalogOfEvent(event: EncodedDomainEvent):
DecodeResult<{ catalog: AdoptedArchitecture; baseline: ArchitectureBaselineContentV1 }> {
  if (event.eventType === ARCHITECTURE_CATALOG_ADOPTED_EVENT) {
    const adopted = decodeArchitectureCatalogAdoptedEvent(event);
    return adopted.status !== 'decoded' ? adopted
      : { status: 'decoded', value: { catalog: adopted.value.catalog, baseline: adopted.value.baseline.content } };
  }
  const revised = decodeArchitectureCatalogRevisedEvent(event);
  return revised.status !== 'decoded' ? revised : { status: 'decoded',
    value: { catalog: revised.value.revision.catalog.catalog, baseline: revised.value.revision.baseline.content } };
}

/** The one rules object the composition root injects. */
export const knowledgeFileRules: KnowledgeFileRules = {
  carrierEventIndex, writeLogFileOf, knowledgeFileOfEvent, readsAsKnowledge, noteHeadKeyOf, recordedFileOf,
};
