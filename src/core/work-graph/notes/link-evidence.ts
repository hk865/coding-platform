// W/notes/link-evidence.ts (L2): the one endpoint identity, module ownership,
// evidence range, literal-key bound and evidence-role table. The write-time gate
// below them finds symbols file by file and asks the second tier for references.
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type {
  LinkDraftV1, LinkEndRequestV1, LinkEvidenceRoleV1, LinkEvidenceStoredV1, LinkEvidenceV1,
  LinkKeyStoredV1, LinkPayloadV1, NoteAnchorV1, SemanticRelationV1, SymbolLocatorV1, SymbolRequestV1,
} from '../../../contracts/note.js';
import { sha256Hex } from '../../../contracts/fingerprint.js';
import type { ReferenceCheckResultV1, ReferenceQuestionV1, SourceHit } from '../../workspace/ports.js';
import { validateSourceQuery } from '../../workspace/ports.js';
import type { NavItemV1 } from '../../workspace/single-file-syntax.js';
import { TYPESCRIPT_CONFIG_FILES } from '../../workspace/typescript-source-query.js';
import { pathOwnershipOf } from '../../../contracts/path-ownership.js';
import { languageOfPath } from '../../workspace/architecture-language-provider.js';
import type { CurrentCatalogWindow } from '../architecture/catalog-service.js';
import { NOTE_BASIS_FILE_MAX_BYTES, analysedDigestsMatch, type WriteNoteResult } from '../model/note-contracts.js';
import { normalizePath, pickTypeScriptSymbol, type NoteAnchorWorkspace } from './note-anchors.js';

/** book :879. The catalog is the window read at write time; `catalog.activeRevision` is the stored catalogRevision. */
export type LinkDraftCheckInput = { draft: LinkDraftV1; anchors: NoteAnchorV1[];
  catalog: Extract<CurrentCatalogWindow, { status: 'ready' }> | null };

/** book :880. The workspace is note-anchors' narrow port, the platform-identity view `writeNote` holds. */
export type LinkDraftDeps = { workspace: NoteAnchorWorkspace };

/** book :881. Success carries warnings; rejection carries no draft, which writeNote adds. */
export type LinkDraftResult =
  | { status: 'ok'; anchors: NoteAnchorV1[]; link: LinkPayloadV1;
      warnings: ('symbol_unresolved' | 'evidence_unverifiable')[] }
  | Omit<Extract<WriteNoteResult, { status: 'rejected' }>, 'draft'>;

export type EndpointIdentityV1 = string;
export type ModuleOwnershipV1 = { moduleId: string; unresolved: null }
  | { moduleId: null; unresolved: 'ambiguous' | 'not_owned' };
export type EvidenceScopeV1 = { kind: 'ranges'; ranges: { startLine: number; endLine: number }[] }
  | { kind: 'whole_file' };

/**
 * Endpoint identity (N1, C13). Book :219–228 fixes the shapes: module `module:<id>`;
 * interface `interface:<id>/<id>`; file `file:<normalizePath(path)>`, plus the requested
 * name and range when a symbolRequest is given (verbatim, never the resolved line or
 * digest). The file+symbol separator is not frozen because identity is only ever
 * compared for equality, so an unambiguous JSON tuple is used here.
 */
export function endpointIdentityOf(request: LinkEndRequestV1): EndpointIdentityV1 {
  switch (request.kind) {
    case 'module': return `module:${request.moduleId}`;
    case 'interface': return `interface:${request.moduleId}/${request.interfaceId}`;
    case 'file': {
      const path = normalizePath(request.path);
      if (request.symbolRequest === undefined) return `file:${path}`;
      return `file:${JSON.stringify([path, request.symbolRequest.name,
        request.symbolRequest.range?.startLine ?? null, request.symbolRequest.range?.endLine ?? null])}`;
    }
  }
}

/** L7 module ownership (book :494–498, :897): reuse pathOwnershipOf; a tie is ambiguous, nobody is not_owned. */
export function moduleOfFile(path: string, catalog: AdoptedArchitecture | null): ModuleOwnershipV1 {
  if (catalog === null) return { moduleId: null, unresolved: 'not_owned' };
  const ownership = pathOwnershipOf(path,
    catalog.modules.map(module => ({ value: module.ref.moduleId, paths: module.paths })));
  if (ownership.status === 'owner') return { moduleId: ownership.owner, unresolved: null };
  return { moduleId: null, unresolved: ownership.status === 'tie' ? 'ambiguous' : 'not_owned' };
}

/**
 * Evidence scope (L3a, book :308–317, :897): every declaration span of the resolved
 * symbol → the caller's range → the whole file. When no span is recorded, fall back to
 * the lines of the hit's name, not the first declaration. Call only after a successful
 * resolution: an unresolved symbolRequest is evidence_missing/unverifiable first, never
 * a silent whole_file (which would widen C1's "no widening to the whole file").
 */
export function evidenceScopeOf(at: LinkEvidenceV1['at'],
  symbol: Extract<SourceHit, { kind: 'symbol' }> | undefined): EvidenceScopeV1 {
  if (symbol !== undefined) {
    const ranges = symbol.declarationRanges !== undefined && symbol.declarationRanges.length > 0
      ? symbol.declarationRanges
      : [{ startLine: symbol.location.start.line, endLine: symbol.location.end.line }];
    return { kind: 'ranges', ranges };
  }
  if (at.range !== undefined) return { kind: 'ranges', ranges: [at.range] };
  return { kind: 'whole_file' };
}

/** Literal-key bound (L1 rule; book :256–257, :326–329): the same text query: 1–512 code points, ≤2,048 UTF-8 bytes, no CR/LF. */
export function literalKeyProblem(text: string): string | null {
  return validateSourceQuery({ kind: 'text', text, caseSensitive: true });
}

/** L3a role table (book :391–401): every role of the relation at least once, no role outside it; the 1–8 count is L1's. */
const LINK_EVIDENCE_ROLES: Readonly<Record<SemanticRelationV1, readonly LinkEvidenceRoleV1[]>> = {
  injects: ['use', 'wire'],
  callback: ['wire', 'use'],
  calls: ['register', 'use'],
  data: ['emit', 'receive'],
  message: ['emit', 'receive'],
  spawns: ['launch', 'entry'],
};

export function evidenceRoleProblem(relation: SemanticRelationV1,
  roles: readonly LinkEvidenceRoleV1[]): string | null {
  const required = LINK_EVIDENCE_ROLES[relation];
  const outside = roles.find(role => !required.includes(role));
  if (outside !== undefined) return `${outside} is not an evidence role of ${relation}`;
  const missing = required.find(role => !roles.includes(role));
  if (missing !== undefined) return `${relation} needs a ${missing} evidence`;
  return null;
}

// --------------------------------------------------------------------------
// L2: the write-time evidence gate (book :896, :305–363)
// --------------------------------------------------------------------------

type LinkEndField = 'anchor' | 'extraAnchors[0]' | 'extraAnchors[1]' | 'link.key';
type ReferenceField = 'to' | 'via' | 'key';
type SymbolCheck =
  | { status: 'resolved'; symbol: SymbolLocatorV1; item: NavItemV1 }
  | { status: 'missing' }
  | { status: 'unsupported' }
  | { status: 'unavailable' }
  | { status: 'ambiguous'; candidates: { name: string; range: { startLine: number; endLine: number } }[] };
type TextRead =
  | { status: 'ready'; text: string; digest: string }
  | { status: 'missing' }
  | { status: 'forbidden' }
  | { status: 'unavailable' };

function workspaceRefOf(ctx: CoreCallContext): { aggregateType: 'Workspace'; projectId: string; workspaceId: string } {
  return { aggregateType: 'Workspace', projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' };
}

async function readText(ctx: CoreCallContext, workspace: NoteAnchorWorkspace, path: string): Promise<TextRead> {
  let read: Awaited<ReturnType<NoteAnchorWorkspace['readWorkspace']>>;
  try {
    read = await workspace.readWorkspace(ctx, { workspace: workspaceRefOf(ctx), path,
      maxBytes: NOTE_BASIS_FILE_MAX_BYTES, version: { kind: 'working_tree' } });
  } catch {
    return { status: 'unavailable' };
  }
  if (read.status === 'ready') return { status: 'ready', text: read.value.content, digest: read.value.digest };
  if (read.code === 'not_found') return { status: 'missing' };
  if (read.code === 'forbidden') return { status: 'forbidden' };
  return { status: 'unavailable' };
}

function evidenceOwnershipOf(path: string, catalog: AdoptedArchitecture | null) {
  if (catalog === null) return { status: 'none' as const };
  return pathOwnershipOf(path, catalog.modules.map(module => ({ value: module.ref.moduleId, paths: module.paths })));
}

function inModule(path: string, moduleId: string, catalog: AdoptedArchitecture | null): boolean {
  const ownership = evidenceOwnershipOf(path, catalog);
  if (ownership.status === 'owner') return ownership.owner === moduleId;
  if (ownership.status === 'tie') return ownership.owners.includes(moduleId);
  return false;
}

function interfacePathsOf(moduleId: string, interfaceId: string,
  catalog: AdoptedArchitecture | null): readonly string[] | null {
  if (catalog === null) return null;
  const module = catalog.modules.find(candidate => candidate.ref.moduleId === moduleId);
  const declared = module?.interfaces.find(candidate => candidate.id === interfaceId);
  return declared === undefined ? null : declared.paths;
}

/** An interface owns a path that equals one of its declared paths or sits under it. */
function underAnyPath(path: string, paths: readonly string[]): boolean {
  return paths.some(raw => {
    const stripped = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (stripped.length === 0) return false;
    if (stripped === '.') return path.length > 0;
    return path === stripped || path.startsWith(`${stripped}/`);
  });
}

function endContains(path: string, end: LinkEndRequestV1, catalog: AdoptedArchitecture | null): boolean {
  switch (end.kind) {
    case 'module': return inModule(path, end.moduleId, catalog);
    case 'interface': {
      const paths = interfacePathsOf(end.moduleId, end.interfaceId, catalog);
      return paths !== null && underAnyPath(path, paths);
    }
    case 'file': return path === normalizePath(end.path);
  }
}

/**
 * `entry` sits in the module the "to" belongs to: the module its id names for a
 * module or interface "to" (a tie that includes it counts), and for a file "to"
 * the module(s) that own it. An interface's declared paths are not the boundary.
 * A file "to" that no module owns cannot satisfy `entry` (book :318–325).
 */
function entryContained(path: string, to: LinkEndRequestV1, catalog: AdoptedArchitecture | null): boolean {
  if (to.kind === 'module' || to.kind === 'interface') return inModule(path, to.moduleId, catalog);
  // A file "to" contributes the module(s) that own it; a tie that includes a
  // module the evidence also sits in counts, an unowned file satisfies nothing.
  const ownership = evidenceOwnershipOf(normalizePath(to.path), catalog);
  if (ownership.status === 'owner') return inModule(path, ownership.owner, catalog);
  if (ownership.status === 'tie') return ownership.owners.some(moduleId => inModule(path, moduleId, catalog));
  return false;
}

function evidenceOutsideEnd(role: LinkEvidenceRoleV1, path: string,
  ends: { from: LinkEndRequestV1; to: LinkEndRequestV1; via: LinkEndRequestV1 | null },
  catalog: AdoptedArchitecture | null): boolean {
  switch (role) {
    case 'wire':
    case 'register': return false;
    case 'use':
    case 'emit':
    case 'launch': return !endContains(path, ends.from, catalog);
    case 'receive': return !endContains(path, ends.to, catalog);
    case 'entry': return !entryContained(path, ends.to, catalog);
  }
}

/** The relations whose link names a key; injects and callback name none. */
export function relationNeedsKey(relation: SemanticRelationV1): boolean { return relation !== 'injects' && relation !== 'callback'; }

/** The definitions one evidence of this role must reference (L3a). */
export function referenceFieldsOf(relation: SemanticRelationV1, role: LinkEvidenceRoleV1): ReferenceField[] {
  switch (relation) {
    case 'injects':
    case 'callback': return role === 'wire' ? ['to', 'via'] : ['via'];
    case 'calls': return role === 'register' ? ['to'] : [];
    default: return [];
  }
}

/** The definitions one evidence of this role must reference: L3a's fields, and the symbol key when the relation names one. */
export function partFieldsOf(relation: SemanticRelationV1, role: LinkEvidenceRoleV1,
  keyKind: LinkKeyStoredV1['kind'] | undefined): ReferenceField[] {
  return [...referenceFieldsOf(relation, role), ...(relationNeedsKey(relation) && keyKind === 'symbol' ? ['key' as const] : [])];
}

/** Some line of the scope contains the literal (a trailing CR is not part of the line). */
export function literalInScope(text: string, literal: string, scope: EvidenceScopeV1): boolean {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    if (scope.kind === 'ranges'
      && !scope.ranges.some(range => line >= range.startLine && line <= range.endLine)) continue;
    if (lines[index]!.replace(/\r$/, '').includes(literal)) return true;
  }
  return false;
}

/** Resolve one end/key/evidence request in its TS/JS file, from the write's one read of that file. */
async function checkSymbol(path: string, request: SymbolRequestV1,
  readOnce: (path: string) => Promise<TextRead>): Promise<SymbolCheck> {
  // The extension decides language support before any read failure, so
  // a known `language_unsupported` is never masked by IO.
  if (languageOfPath(path) !== 'typescript') return { status: 'unsupported' };
  const read = await readOnce(path);
  // A file the working tree does not have is no hit. A forbidden file only cannot be checked
  // here: an evidence file's own content read refuses the write (M1).
  if (read.status === 'missing') return { status: 'missing' };
  if (read.status !== 'ready') return { status: 'unavailable' };
  const picked = pickTypeScriptSymbol(path, request, read.text);
  return picked.status === 'unresolved' ? { status: 'missing' } : picked;
}

/** The link's one second-tier call, one group; an absent analyzer, a throw or a failed call answers nothing. */
async function referenceCheckOf(ctx: CoreCallContext, workspace: NoteAnchorWorkspace,
  questions: ReferenceQuestionV1[]): Promise<ReferenceCheckResultV1 | null> {
  if (workspace.verify === undefined) return null;
  try {
    const checked = await workspace.verify(ctx, { workspace: workspaceRefOf(ctx), priority: 'write', groups: [questions] });
    return checked.status === 'ready' ? checked.value : null;
  } catch {
    return null;
  }
}

/**
 * The configuration stored when the second tier gave none: the reference check's own rule, the
 * first root file of `TYPESCRIPT_CONFIG_FILES` the working tree has, with the sha256 of its
 * decoded text as the second tier reports it. A file that exists but cannot be read keeps its
 * path without a digest and ends the search.
 */
async function workingTreeConfigOf(readOnce: (path: string) => Promise<TextRead>):
Promise<LinkPayloadV1['analysisConfig']> {
  for (const path of TYPESCRIPT_CONFIG_FILES) {
    const read = await readOnce(path);
    if (read.status === 'missing') continue;
    return { path, digest: read.status === 'ready' ? sha256Hex(read.text) : null };
  }
  return { path: null, digest: null };
}

/**
 * L3b's one write-time evidence pass. Shape is already judged by
 * `writeInputProblem`; this function computes containment without a lookup,
 * resolves the ends and the key by field order and the evidence requests by
 * index, each in its single TS/JS file (one working-tree read per path), asks
 * the second tier once for every reference, then applies the result table in
 * order: ends/key → `evidence_outside_end` → evidence ambiguity →
 * `evidence_missing` → accept (`verified` or `unverifiable` plus warnings).
 */
export async function checkLinkDraft(ctx: CoreCallContext, input: LinkDraftCheckInput,
  deps: LinkDraftDeps): Promise<LinkDraftResult> {
  const draft = input.draft;
  const workspace = deps.workspace;
  const catalog = input.catalog?.catalog.catalog ?? null;
  const relation = draft.link.relation;
  const rawKey = draft.link.key ?? null;
  const ends = {
    from: draft.anchor as LinkEndRequestV1,
    to: draft.extraAnchors[0] as LinkEndRequestV1,
    via: (draft.extraAnchors[1] ?? null) as LinkEndRequestV1 | null,
  };
  // One working-tree read per path for the whole write: the ends, the key, the evidence, the
  // digests compared with the second tier's and the configuration all see the same bytes.
  const reads = new Map<string, Promise<TextRead>>();
  const readFileOnce = (path: string): Promise<TextRead> => {
    let read = reads.get(path);
    if (read === undefined) {
      read = readText(ctx, workspace, path);
      reads.set(path, read);
    }
    return read;
  };

  // 1. Containment first: no lookup, no read (book :318–325). Its refusal is
  // returned only after the ends/key row, which the table puts before it.
  const outside: number[] = [];
  draft.link.evidence.forEach((evidence, index) => {
    if (evidenceOutsideEnd(evidence.role, normalizePath(evidence.at.path), ends, catalog)) outside.push(index);
  });

  const needsKey = relationNeedsKey(relation);
  let analyzerUnavailable = false;

  // The resolved anchors replace the anchor step's plain file anchors.
  const anchors: NoteAnchorV1[] = input.anchors.map(anchor => ({ ...anchor }));
  const setSymbol = (slot: number, symbol: SymbolLocatorV1): void => {
    const anchor = anchors[slot];
    if (anchor?.kind === 'file') anchors[slot] = { ...anchor, symbol };
  };
  const plainFileAnchor = (slot: number): void => {
    const anchor = anchors[slot];
    if (anchor?.kind === 'file') {
      anchors[slot] = { kind: 'file', path: anchor.path,
        ...(anchor.deleted === true ? { deleted: true as const } : {}) };
    }
  };

  // The definitions the evidence must reference, as the second tier's question names X:
  // the file, the resolved name and its name line (which picks among same-name items).
  const definitions = new Map<ReferenceField, ReferenceQuestionV1['definition']>();
  const warnings: ('symbol_unresolved' | 'evidence_unverifiable')[] = [];
  let symbolUnresolved = false;
  let keyNotLiteral = false;
  let languageUnsupported = false;
  let forbiddenIndex: number | null = null;

  const requiredTo = relation === 'injects' || relation === 'callback' || relation === 'calls';
  const requiredVia = relation === 'injects' || relation === 'callback';

  const resolveEnd = async (end: LinkEndRequestV1 | null, field: LinkEndField, slot: number,
    required: boolean, referenceField: ReferenceField | null): Promise<LinkDraftResult | null> => {
    if (end === null || end.kind !== 'file' || end.symbolRequest === undefined) return null;
    const path = normalizePath(end.path);
    const check = await checkSymbol(path, end.symbolRequest, readFileOnce);
    if (check.status === 'ambiguous') {
      return { status: 'rejected', code: 'invalid', reason: `symbol_ambiguous: ${field}`,
        symbolCandidates: check.candidates };
    }
    if (check.status === 'unavailable') { analyzerUnavailable = true; return null; }
    if (check.status === 'unsupported') {
      // Another language is unanalysable today: keep the plain file anchor and
      // warn, never `link_end_unresolved` (spec :369, E-27).
      languageUnsupported = true;
      symbolUnresolved = true;
      plainFileAnchor(slot);
      return null;
    }
    if (check.status === 'missing') {
      if (required) return { status: 'rejected', code: 'invalid', reason: `link_end_unresolved: ${field}` };
      symbolUnresolved = true;
      plainFileAnchor(slot);
      return null;
    }
    setSymbol(slot, check.symbol);
    if (referenceField !== null) {
      definitions.set(referenceField, { path, name: check.symbol.qualifiedName, line: check.symbol.range.startLine });
    }
    return null;
  };

  // 2. Ends and key in field order: anchor → extraAnchors[0] → extraAnchors[1] → link.key.
  let failure = await resolveEnd(ends.from, 'anchor', 0, false, null);
  if (failure !== null) return failure;
  failure = await resolveEnd(ends.to, 'extraAnchors[0]', 1, requiredTo, 'to');
  if (failure !== null) return failure;
  failure = await resolveEnd(ends.via, 'extraAnchors[1]', 2, requiredVia, 'via');
  if (failure !== null) return failure;

  let storedKey: LinkKeyStoredV1 | null = null;
  if (needsKey && rawKey !== null) {
    if (rawKey.kind === 'literal') {
      storedKey = { kind: 'literal', text: rawKey.text };
    } else {
      const path = normalizePath(rawKey.anchor.path);
      const check = await checkSymbol(path, rawKey.anchor.symbolRequest, readFileOnce);
      if (check.status === 'ambiguous') {
        return { status: 'rejected', code: 'invalid', reason: 'symbol_ambiguous: link.key',
          symbolCandidates: check.candidates };
      }
      if (check.status === 'missing') {
        return { status: 'rejected', code: 'invalid', reason: 'link_end_unresolved: link.key' };
      }
      if (check.status === 'unsupported') {
        languageUnsupported = true;
        storedKey = { kind: 'symbol', path, symbolRequest: rawKey.anchor.symbolRequest };
      } else if (check.status === 'unavailable') {
        analyzerUnavailable = true;
        storedKey = { kind: 'symbol', path, symbolRequest: rawKey.anchor.symbolRequest };
      } else {
        storedKey = { kind: 'symbol', path, symbolRequest: rawKey.anchor.symbolRequest, symbol: check.symbol };
        definitions.set('key', { path, name: check.symbol.qualifiedName, line: check.symbol.range.startLine });
      }
    }
  }

  // A `null` key is a known "not a literal" before any evidence read: an IO
  // failure may add analyzer_unavailable but must not replace this reason.
  if (needsKey && rawKey === null) keyNotLiteral = true;

  // 3. `evidence_outside_end` (all failing indexes, ascending).
  if (outside.length > 0) {
    return { status: 'rejected', code: 'invalid', reason: 'evidence_outside_end', evidenceIndexes: outside };
  }

  // 4. Evidence symbolRequests by index; the first ambiguity is row 5.
  const evidenceSymbols: (Extract<SymbolCheck, { status: 'resolved' }> | undefined)[] = [];
  const evidenceSymbolMissing = new Set<number>();
  let ambiguousEvidence: { index: number; candidates: { name: string; range: { startLine: number; endLine: number } }[] } | null = null;
  for (const [index, evidence] of draft.link.evidence.entries()) {
    const request = evidence.at.symbolRequest;
    if (request === undefined) { evidenceSymbols.push(undefined); continue; }
    const check = await checkSymbol(normalizePath(evidence.at.path), request, readFileOnce);
    if (check.status === 'ambiguous') { ambiguousEvidence = { index, candidates: check.candidates }; break; }
    if (check.status === 'missing') { evidenceSymbolMissing.add(index); evidenceSymbols.push(undefined); continue; }
    if (check.status === 'unsupported') {
      languageUnsupported = true;
      evidenceSymbols.push(undefined); continue;
    }
    if (check.status === 'unavailable') {
      analyzerUnavailable = true;
      evidenceSymbols.push(undefined); continue;
    }
    evidenceSymbols.push(check);
  }
  if (ambiguousEvidence !== null) {
    return { status: 'rejected', code: 'invalid',
      reason: `symbol_ambiguous: link.evidence[${String(ambiguousEvidence.index)}].at.symbolRequest`,
      symbolCandidates: ambiguousEvidence.candidates };
  }

  // 5. Reads, literal keys and the reference questions. Missing indexes are
  // collected and returned only after every checkable item has had its say (row 6).
  const missing = new Set<number>(evidenceSymbolMissing);
  const fileDigests: (string | null)[] = draft.link.evidence.map(() => null);
  // Each question's evidence index and the raw-byte digests this write read for its two files.
  const questions: ReferenceQuestionV1[] = [];
  const asked: { index: number; read: Map<string, string> }[] = [];

  for (const [index, evidence] of draft.link.evidence.entries()) {
    if (evidenceSymbolMissing.has(index)) continue;
    const path = normalizePath(evidence.at.path);
    const isTs = languageOfPath(path) === 'typescript';
    // The references of this role (L3a) and, for a symbol key, the key's definition (8E :434).
    const fields = partFieldsOf(relation, evidence.role, rawKey?.kind);
    // A non-TS evidence that needs a symbol/reference check is unsupported
    // before any read or definition lookup, so IO cannot mask the language (book :333-334).
    if (!isTs && fields.length > 0) languageUnsupported = true;
    // The same read as its selector's: an unreadable selector file is the same failure here,
    // so a selector that could not be checked never falls back to `whole_file`.
    const content = await readFileOnce(path);
    // A forbidden workspace read still refuses the write (book :987).
    if (content.status === 'forbidden') { forbiddenIndex ??= index; continue; }
    // A file the working tree does not have is a definite miss (row 6 collects every definite miss).
    if (content.status === 'missing') { missing.add(index); continue; }
    if (content.status === 'unavailable') { analyzerUnavailable = true; continue; }
    fileDigests[index] = content.digest;
    const resolved = evidenceSymbols[index];
    const scope = evidenceScopeOf(evidence.at, resolved === undefined ? undefined
      : { kind: 'symbol', name: resolved.item.name, symbolKind: resolved.item.kind,
        location: { path, digest: resolved.symbol.fileDigest, start: resolved.item.start, end: resolved.item.end },
        declarationRanges: resolved.item.declarationRanges });
    if (evidence.at.range !== undefined && evidence.at.range.endLine > content.text.split('\n').length) {
      missing.add(index);
      continue;
    }

    if (needsKey && rawKey?.kind === 'literal' && !literalInScope(content.text, rawKey.text, scope)) missing.add(index);

    if (!isTs) continue;
    for (const field of fields) {
      const definition = definitions.get(field);
      if (definition === undefined) { analyzerUnavailable = true; continue; }
      const read = new Map([[path, content.digest]]);
      const definitionRead = await readFileOnce(definition.path);
      if (definitionRead.status === 'ready') read.set(definition.path, definitionRead.digest);
      questions.push({ definition, evidence: { path, ranges: scope.kind === 'whole_file' ? null : scope.ranges } });
      asked.push({ index, read });
    }
  }

  // The references go to the second tier once, unless there is no question or a forbidden
  // evidence read already refuses the write. A part whose files the second tier analysed with
  // other bytes than this write read (8E C2's race) is not judged, whatever it answered.
  let analysisConfig: LinkPayloadV1['analysisConfig'] = { path: null, digest: null };
  if (questions.length > 0 && forbiddenIndex === null) {
    const checked = await referenceCheckOf(ctx, workspace, questions);
    if (checked === null) {
      analyzerUnavailable = true;
      analysisConfig = await workingTreeConfigOf(readFileOnce);
    } else {
      if (checked.config !== null) analysisConfig = { path: checked.config.path, digest: checked.config.digest };
      asked.forEach((entry, position) => {
        const answer = checked.answers[0]![position]!;
        if (!analysedDigestsMatch(checked.analysed, entry.read)) analyzerUnavailable = true;
        else if (answer.status === 'not_found') missing.add(entry.index);
        // `unverifiable` (not in the project, project references, undecided) and `failed`.
        else if (answer.status !== 'found') analyzerUnavailable = true;
      });
    }
  }

  if (forbiddenIndex !== null) {
    return { status: 'rejected', code: 'invalid',
      reason: `evidence_invalid: link.evidence[${String(forbiddenIndex)}].at.path` };
  }
  if (missing.size > 0) {
    return { status: 'rejected', code: 'invalid', reason: 'evidence_missing',
      evidenceIndexes: [...missing].sort((left, right) => left - right) };
  }

  // 6. Accept; `key_not_literal` / `language_unsupported` / `analyzer_unavailable`
  // are the stored write-time verification, not a refusal.
  const verification: LinkPayloadV1['verification'] = keyNotLiteral
    ? { status: 'unverifiable', reason: 'key_not_literal' }
    : languageUnsupported
      ? { status: 'unverifiable', reason: 'language_unsupported' }
      : analyzerUnavailable
        ? { status: 'unverifiable', reason: 'analyzer_unavailable' }
        : { status: 'verified' };
  if (symbolUnresolved) warnings.push('symbol_unresolved');
  if (verification.status === 'unverifiable') warnings.push('evidence_unverifiable');

  const evidence: LinkEvidenceStoredV1[] = draft.link.evidence.map((entry, index) => {
    const symbol = evidenceSymbols[index]?.symbol;
    return {
      role: entry.role,
      at: {
        path: normalizePath(entry.at.path),
        ...(entry.at.symbolRequest === undefined ? {} : { symbolRequest: entry.at.symbolRequest }),
        ...(entry.at.range === undefined ? {} : { range: entry.at.range }),
        ...(symbol === undefined ? {} : { symbol }),
      },
      fileDigest: fileDigests[index] ?? null,
      digestBasis: 'raw_bytes',
    };
  });

  const link: LinkPayloadV1 = {
    relation,
    ends: { from: ends.from, to: ends.to, via: ends.via },
    key: storedKey,
    evidence,
    analysisConfig,
    verification,
  };
  return { status: 'ok', anchors, link, warnings };
}
