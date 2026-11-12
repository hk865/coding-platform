/**
 * The note file: a first line `--- knowledge-note@1`, a
 * key-sorted indented JSON header, a line `---`, then the body bytes exactly as
 * written (no trim, no added newline; a `---` inside the body is not escaped).
 * The note id is only the file name. Anchors are structured objects, never
 * anchor keys; only the three knowledge anchors go in a file (a goal, stage,
 * task or project anchor stays in the record), a file anchor carries no
 * resolved symbol, a file fact and the basis files carry no digest. A link
 * keeps only its locating input (relation, the ends' raw requests, the key and
 * each evidence's place), a flow only its step ids, a repair only its ops; the
 * resolved symbols, digests, analysis configuration, verification, pin and
 * responsibility moves stay in the record. Module ids and paths are written in
 * the file frame of the line's workspace. Pure.
 */
import { messageOf } from '../../../contracts/error-message.js';
import { sameJson } from '../../../contracts/fingerprint.js';
import { KNOWLEDGE_DIRECTORY } from '../../../contracts/knowledge.js';
import {
  NOTE_KINDS, isLinkEvidenceRole, isSemanticRelation, payloadKindProblem, type LinkEndRequestV1, type LinkPayloadV1, type NoteAnchorV1,
  type NoteBodyV1,
  type NoteHeadSnapshot, type NoteKind,
} from '../../../contracts/note.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import {
  fileModuleId, fileProjectPath, projectModuleIdOfFile, projectPathOfFile,
} from '../../../contracts/workspace-module-id.js';
import type { DecodeResult } from '../../record-store/ports.js';
import type { KnowledgeAnchorV1, KnowledgeLineScope, KnowledgeLinkV1, NoteKnowledgeV1 } from '../model/line-knowledge.js';
import { keysAre, prettyJson } from '../architecture/architecture-file.js';
import { reframeRepairOps } from '../architecture/catalog-service.js';
import { parseRepairOps } from '../architecture/repair-ops.js';
import {
  factProblem, noteAnchorProblem, sectionsProblem, sourceProblem,
} from '../persistence/note-record-codecs.js';

const FORMAT_LINE = '--- knowledge-note@1';
const HEADER_KEYS = ['anchor', 'extraAnchors', 'kind', 'source', 'topic', 'conclusion', 'structural', 'facts',
  'basisFiles', 'replaces', 'contradicts', 'coexistWith'] as const;
const NOTE_FILE_PATH = new RegExp(`^${KNOWLEDGE_DIRECTORY.replace('.', '\\.')}/notes/[^/]+/([^/]+)\\.md$`);
const encoder = new TextEncoder();

/** `.workbench/notes/<any>/<noteId>.md` → noteId; anything else is not a note file. */
export function noteIdFromFilePath(path: string): string | null {
  return NOTE_FILE_PATH.exec(path)?.[1] ?? null;
}

export function isKnowledgeAnchor(anchor: NoteAnchorV1): anchor is Extract<NoteAnchorV1, { kind: 'module' | 'interface' | 'file' }> {
  return anchor.kind === 'module' || anchor.kind === 'interface' || anchor.kind === 'file';
}

function knowledgeAnchorOf(anchor: NoteAnchorV1): KnowledgeAnchorV1 {
  switch (anchor.kind) {
    case 'module': return { kind: 'module', moduleId: anchor.moduleId };
    case 'interface': return { kind: 'interface', moduleId: anchor.moduleId, interfaceId: anchor.interfaceId };
    case 'file': return { kind: 'file', path: anchor.path, ...(anchor.deleted === true ? { deleted: true as const } : {}) };
    default: throw new Error(`a ${anchor.kind} anchor is not a knowledge anchor`);
  }
}

/** A link's locating input: no resolved symbol, digest, analysis configuration or verification. */
function knowledgeLinkOf(link: LinkPayloadV1): KnowledgeLinkV1 {
  const key = link.key === undefined || link.key === null ? null
    : link.key.kind === 'literal' ? { kind: 'literal' as const, text: link.key.text }
      : { kind: 'symbol' as const, path: link.key.path, symbolRequest: link.key.symbolRequest };
  return { relation: link.relation, ends: link.ends, key,
    evidence: link.evidence.map(entry => ({ role: entry.role, at: { path: entry.at.path,
      ...(entry.at.symbolRequest === undefined ? {} : { symbolRequest: entry.at.symbolRequest }),
      ...(entry.at.range === undefined ? {} : { range: entry.at.range }) } })) };
}

/** The knowledge fields of a written head (project view); the head's primary anchor is a knowledge anchor. */
export function noteKnowledgeOf(head: NoteBodyV1 & Pick<NoteHeadSnapshot, 'source'>): NoteKnowledgeV1 {
  return {
    kind: head.kind, source: head.source, topic: head.topic, conclusion: head.conclusion, body: head.body,
    ...(head.sections === undefined ? {} : { sections: head.sections }),
    anchor: knowledgeAnchorOf(head.anchor),
    extraAnchors: head.extraAnchors.filter(isKnowledgeAnchor).map(knowledgeAnchorOf),
    structural: head.structural,
    facts: head.facts.map(fact => fact.kind === 'file' ? { kind: 'file' as const, path: fact.path } : fact),
    basisFiles: head.basis.files.map(file => file.path),
    replaces: head.replaces, contradicts: head.contradicts, coexistWith: head.coexistWith,
    ...(head.link === undefined ? {} : { link: knowledgeLinkOf(head.link) }),
    ...(head.flow === undefined ? {} : { flow: { steps: head.flow.steps.map(step => ({ link: step.link })) } }),
    ...(head.repair === undefined ? {} : { repair: { ops: head.repair.ops } }),
  };
}

/**
 * [2C1-02], split ruling 3: a note file's knowledge from a written head, the one rule of a note write
 * (`noteFileWritesOf`) and of a recovery's rebuild (`knowledgeFileOfEvent`): the head's own knowledge, or, when the
 * note has a file, that file as the base (`rewrittenKnowledge`).
 */
export function noteFileKnowledgeOf(head: Parameters<typeof noteKnowledgeOf>[0], base: NoteKnowledgeV1 | null): NoteKnowledgeV1 {
  const knowledge = noteKnowledgeOf(head);
  return base === null ? knowledge : rewrittenKnowledge(knowledge, base);
}

/**
 * A platform rewrite of a note that has a file keeps the file as its base (ruling 8 F-20 甲). The overlay shows
 * every knowledge field from the file except the file and basis paths the record has no digest for, so a written
 * head differs from the file only where the command changed a field, or where it lacks those paths: when that is
 * all a list lacks, the file's list stays as it is.
 */
function rewrittenKnowledge(written: NoteKnowledgeV1, file: NoteKnowledgeV1): NoteKnowledgeV1 {
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

/** The same knowledge with every module id and path passed through the given frame change. */
function reframed(knowledge: NoteKnowledgeV1, id: (value: string) => string, path: (value: string) => string): NoteKnowledgeV1 {
  const anchor = (value: KnowledgeAnchorV1): KnowledgeAnchorV1 => value.kind === 'file'
    ? { kind: 'file', path: path(value.path), ...(value.deleted === true ? { deleted: true as const } : {}) }
    : value.kind === 'module' ? { kind: 'module', moduleId: id(value.moduleId) }
      : { kind: 'interface', moduleId: id(value.moduleId), interfaceId: value.interfaceId };
  const linkEnd = (value: LinkEndRequestV1): LinkEndRequestV1 => value.kind === 'file' ? { ...value, path: path(value.path) }
    : { ...value, moduleId: id(value.moduleId) };
  const link = knowledge.link;
  return {
    ...knowledge,
    anchor: anchor(knowledge.anchor),
    extraAnchors: knowledge.extraAnchors.map(anchor),
    facts: knowledge.facts.map(fact => fact.kind === 'file' ? { kind: 'file', path: path(fact.path) } : fact),
    basisFiles: knowledge.basisFiles.map(path),
    ...(link === undefined ? {} : { link: { ...link,
      ends: { from: linkEnd(link.ends.from), to: linkEnd(link.ends.to), via: link.ends.via === null ? null : linkEnd(link.ends.via) },
      key: link.key?.kind === 'symbol' ? { ...link.key, path: path(link.key.path) } : link.key,
      evidence: link.evidence.map(entry => ({ ...entry, at: { ...entry.at, path: path(entry.at.path) } })) } }),
    ...(knowledge.repair === undefined ? {} : { repair: { ops: reframeRepairOps(knowledge.repair.ops, id, path) } }),
  };
}

/** A note file's complete bytes; the file frame is `scope.workspaceId`. */
export function noteFileBytes(knowledge: NoteKnowledgeV1, scope: KnowledgeLineScope): DecodeResult<Uint8Array> {
  let framed: NoteKnowledgeV1;
  try {
    framed = reframed(knowledge, value => fileModuleId(value, scope.workspaceId, scope.mainWorkspaceId),
      value => fileProjectPath(value, scope.workspaceId, scope.mainWorkspaceId));
  } catch (error) {
    return { status: 'invalid', reason: `the note cannot be written in the file frame: ${messageOf(error)}` };
  }
  const { body, ...header } = framed;
  return { status: 'decoded', value: encoder.encode(`${FORMAT_LINE}\n${prettyJson(header)}---\n${body}`) };
}

function knowledgeAnchorProblem(value: unknown): string | null {
  const problem = noteAnchorProblem(value);
  if (problem !== null) return problem;
  const anchor = value as NoteAnchorV1;
  if (!isKnowledgeAnchor(anchor)) return `a ${anchor.kind} anchor is not a knowledge anchor`;
  return anchor.kind === 'file' && anchor.symbol !== undefined ? 'a file anchor in a note file carries no symbol' : null;
}

function endProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'a link end must be an object';
  if (value['kind'] === 'file') {
    return keysAre(value, ['kind', 'path'], ['symbolRequest', 'deleted']) && nonEmpty(value['path']) ? null
      : 'a file end carries a non-empty path and an optional symbolRequest';
  }
  if (value['kind'] === 'module') return keysAre(value, ['kind', 'moduleId']) && nonEmpty(value['moduleId']) ? null
    : 'a module end carries exactly a non-empty moduleId';
  return value['kind'] === 'interface' && keysAre(value, ['kind', 'moduleId', 'interfaceId']) && nonEmpty(value['moduleId'])
    && nonEmpty(value['interfaceId']) ? null : 'a link end is a module, interface or file';
}

/** The locating input only: relation, ends, key and each evidence's place (no digest, symbol or verification). */
function linkProblem(value: unknown): string | null {
  if (!isRecord(value) || !keysAre(value, ['relation', 'ends', 'key', 'evidence'])) {
    return 'link carries exactly relation, ends, key and evidence';
  }
  if (!isSemanticRelation(value['relation'])) return 'link.relation is not one of the six relations';
  const ends = value['ends'];
  if (!isRecord(ends) || !keysAre(ends, ['from', 'to', 'via'])) return 'link.ends carries exactly from, to and via';
  for (const end of [ends['from'], ends['to'], ...(ends['via'] === null ? [] : [ends['via']])]) {
    const problem = endProblem(end);
    if (problem !== null) return `link.ends: ${problem}`;
  }
  const key = value['key'];
  if (key !== null && !(isRecord(key) && (key['kind'] === 'literal' ? keysAre(key, ['kind', 'text']) && nonEmpty(key['text'])
    : key['kind'] === 'symbol' && keysAre(key, ['kind', 'path', 'symbolRequest']) && nonEmpty(key['path'])))) {
    return 'link.key is null, a literal text or a symbol path and request';
  }
  if (!Array.isArray(value['evidence']) || !value['evidence'].every(entry => isRecord(entry) && keysAre(entry, ['role', 'at'])
    && isLinkEvidenceRole(entry['role']) && isRecord(entry['at']) && keysAre(entry['at'], ['path'], ['symbolRequest', 'range'])
    && nonEmpty(entry['at']['path']))) {
    return 'every link.evidence entry carries exactly one of the seven roles and its place';
  }
  return null;
}

function flowProblem(value: unknown): string | null {
  return isRecord(value) && keysAre(value, ['steps']) && Array.isArray(value['steps'])
    && value['steps'].every(step => isRecord(step) && keysAre(step, ['link']) && nonEmpty(step['link']))
    ? null : 'flow carries exactly its steps, each a link note id';
}

function repairFileProblem(value: unknown): string | null {
  if (!isRecord(value) || !keysAre(value, ['ops'])) return 'repair carries exactly its ops';
  const parsed = parseRepairOps(value['ops']);
  return parsed.ok ? null : `repair.ops: ${parsed.problem.reason}`;
}

function headerProblem(header: Record<string, unknown>): string | null {
  if (!keysAre(header, HEADER_KEYS, ['sections', 'link', 'flow', 'repair'])) {
    return `the header carries exactly ${HEADER_KEYS.join(', ')} and the kind's own optional field`;
  }
  const kind = header['kind'];
  if (!NOTE_KINDS.includes(kind as NoteKind)) return 'the kind is not recognized';
  const payload = payloadKindProblem(header, kind as string, 'header');
  if (payload !== null) return payload;
  const fileForm = header['link'] !== undefined ? linkProblem(header['link'])
    : header['flow'] !== undefined ? flowProblem(header['flow'])
      : header['repair'] !== undefined ? repairFileProblem(header['repair']) : null;
  if (fileForm !== null) return fileForm;
  if (!nonEmpty(header['topic']) || !nonEmpty(header['conclusion'])) return 'topic and conclusion must be non-empty';
  if (typeof header['structural'] !== 'boolean') return 'structural must be a boolean';
  if ((header['sections'] !== undefined) !== (kind === 'understanding')) return 'sections are exactly for an understanding';
  if (header['sections'] !== undefined) {
    const sections = sectionsProblem(header['sections']);
    if (sections !== null) return sections;
  }
  const anchor = knowledgeAnchorProblem(header['anchor']);
  if (anchor !== null) return `anchor: ${anchor}`;
  if (!Array.isArray(header['extraAnchors'])) return 'extraAnchors must be an array';
  for (const extra of header['extraAnchors']) {
    const problem = knowledgeAnchorProblem(extra);
    if (problem !== null) return `extraAnchors: ${problem}`;
  }
  const source = sourceProblem(header['source'], 'source');
  if (source !== null) return source;
  if (!Array.isArray(header['facts'])) return 'facts must be an array';
  for (const fact of header['facts']) {
    const problem = isRecord(fact) && fact['kind'] === 'file'
      ? (keysAre(fact, ['kind', 'path']) && nonEmpty(fact['path']) ? null : 'a file fact carries exactly a non-empty path')
      : factProblem(fact);
    if (problem !== null) return `facts: ${problem}`;
  }
  for (const field of ['basisFiles', 'replaces', 'contradicts', 'coexistWith'] as const) {
    const list = header[field];
    if (!Array.isArray(list) || !list.every(entry => typeof entry === 'string')
      || (field === 'basisFiles' && !list.every(nonEmpty))) return `${field} must be a string list`;
  }
  return null;
}

/** A note file's bytes back to the project-view knowledge; the file frame is `scope.workspaceId`. */
export function noteOfFileBytes(bytes: Uint8Array, scope: KnowledgeLineScope): DecodeResult<NoteKnowledgeV1> {
  const invalid = (reason: string): DecodeResult<never> => ({ status: 'invalid', reason });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalid('the note file is not UTF-8');
  }
  if (!text.startsWith(`${FORMAT_LINE}\n`)) return invalid(`the first line must be ${FORMAT_LINE}`);
  const headerStart = FORMAT_LINE.length + 1;
  let lineStart = headerStart;
  let closing = -1;
  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? text.length : newline;
    if (text.slice(lineStart, lineEnd) === '---') { closing = lineStart; break; }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  if (closing < 0) return invalid('the header has no closing --- line');
  let header: unknown;
  try {
    header = JSON.parse(text.slice(headerStart, closing));
  } catch {
    return invalid('the header is not JSON');
  }
  if (!isRecord(header)) return invalid('the header is not a JSON object');
  const problem = headerProblem(header);
  if (problem !== null) return invalid(problem);
  const bodyStart = closing + 3 < text.length ? closing + 4 : text.length;
  const knowledge = { ...(header as Omit<NoteKnowledgeV1, 'body'>), body: text.slice(bodyStart) } as NoteKnowledgeV1;
  try {
    return { status: 'decoded', value: reframed(knowledge,
      value => projectModuleIdOfFile(value, scope.workspaceId, scope.mainWorkspaceId),
      value => projectPathOfFile(value, scope.workspaceId, scope.mainWorkspaceId)) };
  } catch (error) {
    return invalid(`a reference cannot be read in the file frame: ${messageOf(error)}`);
  }
}
