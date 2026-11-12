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
import type { DecodeResult, EncodedDomainEvent } from '../../record-store/ports.js';
import { ARCHITECTURE_FILE_PATH } from '../../../contracts/knowledge.js';
import { architectureFilesOf, moduleFileIdOf } from '../architecture/architecture-file.js';
import type { ArchitectureBaselineContentV1 } from '../architecture/catalog-contracts.js';
import {
  ARCHITECTURE_CATALOG_ADOPTED_EVENT, ARCHITECTURE_CATALOG_REVISED_EVENT, decodeArchitectureCatalogAdoptedEvent,
  decodeArchitectureCatalogRevisedEvent,
} from '../architecture/catalog-record-codecs.js';
import { knowledgeBaselineOf } from '../architecture/catalog-service.js';
import type { KnowledgeFileRules, KnowledgeLineScope } from '../model/line-knowledge.js';
import {
  NOTE_DISPOSITION_CHANGED_EVENT_TYPE, NOTE_WRITTEN_EVENT_TYPE, noteDispositionChangedEventFromEvent, noteWrittenEventFromEvent,
} from '../persistence/note-record-codecs.js';
import { noteFileBytes, noteFileKnowledgeOf, noteIdFromFilePath, noteOfFileBytes } from './note-file.js';

const NOTE_HEAD_EVENTS: readonly string[] = [NOTE_WRITTEN_EVENT_TYPE, NOTE_DISPOSITION_CHANGED_EVENT_TYPE];
const CATALOG_EVENTS: readonly string[] = [ARCHITECTURE_CATALOG_ADOPTED_EVENT, ARCHITECTURE_CATALOG_REVISED_EVENT];

/** The one rule of a path's kind (write log and index): a note file by its name, `architecture.json`, else a module file. */
export function knowledgeFileKindOf(path: string): KnowledgeFileKind {
  return noteIdFromFilePath(path) !== null ? 'note' : path === ARCHITECTURE_FILE_PATH ? 'architecture' : 'module';
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
 * turned into the project view in the line's workspace, as the read-back does; null for the other kinds. The platform
 * only writes module files it built and deletes ones it parsed, so bytes that do not parse are a programming error and throw.
 */
function writeLogFileOf(scope: KnowledgeLineScope, path: string, bytes: Uint8Array):
{ kind: KnowledgeFileKind; moduleId: string | null } {
  const kind = knowledgeFileKindOf(path);
  if (kind !== 'module') return { kind, moduleId: null };
  const fileId = moduleFileIdOf(path, bytes);
  if (fileId.status !== 'decoded') throw new Error(`the module file ${path} does not name its module: ${fileId.reason}`);
  return { kind, moduleId: projectModuleId(scope.workspaceId, fileId.value, scope.mainWorkspaceId) };
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
  const files = architectureFilesOf(committed.value.catalog, knowledgeBaselineOf(committed.value.baseline), scope);
  if (files.status !== 'decoded') return files;
  if (target.path === ARCHITECTURE_FILE_PATH) return { status: 'decoded', value: files.value.architecture };
  const moduleId = target.moduleId === null ? null : rawModuleId(target.moduleId).moduleId;
  return { status: 'decoded', value: files.value.modules.find(module => module.moduleId === moduleId)?.bytes ?? null };
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
export const knowledgeFileRules: KnowledgeFileRules = { carrierEventIndex, writeLogFileOf, knowledgeFileOfEvent };
