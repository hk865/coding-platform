/**
 * Slice 4A L2/L2a/L4: the note anchor keys, the pure `topicKey` normalizer and
 * the write-time anchor gate (L2a classes 1–4). Class 1 (format), class 2
 * (object exists, with the deterministic candidate list), class 3 is split: the
 * own-goal / scribe-scope half is applied by `note-service.ts`/`scribe-scope.ts`,
 * and class 4 (task ended) is reported as the `anchor_ended` warning. The
 * platform computes every key from trusted ids; a model display name is never
 * stored.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { AdoptedArchitecture, ModuleDefinition } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureBaselinePin } from '../../../contracts/governance.js';
import type {
  LinkEndRequestV1, NoteAnchorV1, NoteDraftAnchorV1, NoteFactV1, SymbolLocatorV1, SymbolRequestV1,
} from '../../../contracts/note.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import { sha256Hex } from '../../../contracts/fingerprint.js';
import {
  isSafeProjectPath, isSafeWorkspaceRelativePath, normalizeProjectPath, normalizeRequestProjectPath,
  resolveStoredProjectPath, splitWorkspacePath,
} from '../../../contracts/workspace-path.js';
import { isPos, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { NoteAnchorCandidateV1, NoteSymbolProblemV1, SymbolProblemV1 } from '../model/note-contracts.js';
import type {
  CaptureSummary, ReferenceAnalyzerPort, SourceHit, SourceProvider, WorkspaceResult, WorkspaceToolsPort,
} from '../../workspace/ports.js';
import type { NativeSingleFilePort } from '../../workspace/native-single-file.js';
import { navigationItemsOf, type NavItemV1 } from '../../workspace/single-file-syntax.js';
import { languageOfPath } from '../../workspace/architecture-language-provider.js';
import type { WorkspaceToolsHandle } from '../../workspace/workspace-tools.js';
import type { ArchitectureCatalogPort, CatalogModuleFacts } from '../architecture/catalog-contracts.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { readCatalogModuleFacts } from '../architecture/catalog-service.js';
import { endpointIdentityOf } from './link-evidence.js';
import type { GoalPlanWindow } from '../tasks/plan-readers.js';
import type { AnchorGoalPlanFacts } from './note-anchor-facts.js';
import { readAnchorGoalFacts } from './note-anchor-facts.js';
import {
  NOTE_ANCHOR_CANDIDATES_MAX, NOTE_ANCHOR_CANDIDATE_SCAN, NOTE_BASIS_FILE_MAX_BYTES,
  NOTE_CONCLUSION_MAX_CODEPOINTS,
} from '../model/note-contracts.js';
import { platformCheckContext } from '../model/platform-check-context.js';

/**
 * The narrow workspace surface the anchor gate needs: the existence read and
 * the write's capture + path query for missing-file candidates. The composition
 * root fills the trusted workspace revision the capture request requires; the
 * note module never sees or supplies one.
 */
export type NoteAnchorWorkspace = Pick<WorkspaceToolsPort, 'readWorkspace'> & {
  /** One access for a whole list of working-tree paths: the read side's gate files come in one batch. */
  readWorkspaceFiles: WorkspaceToolsHandle['readWorkspaceFiles'];
  capture?(ctx: CoreCallContext, request: { provider: SourceProvider }): Promise<WorkspaceResult<CaptureSummary>>;
  querySource?: WorkspaceToolsPort['querySource'];
  /** Best-effort release of the missing-file candidates' one text capture after use. */
  releaseCapture?: WorkspaceToolsPort['releaseCapture'];
  /** The second tier's reference check (one program per request, on the analysis thread). */
  verify?: ReferenceAnalyzerPort['verify'];
  /** The Python/C++ single-file lookup of one file's functions and classes. */
  lookup?: NativeSingleFilePort['lookup'];
};

export type NoteAnchorFactsDeps = {
  records: GoalRecordTransactionPort;
  /** Candidate/containment catalog read; absent in narrow doubles keeps class 1–2 shape checks working. */
  architecture?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  /**
   * The per-call module-facts reader over an already-read
   * current catalog window. Absent in narrow doubles keeps the fresh read, so
   * several module/interface targets of one note call share ONE window.
   */
  catalogModuleFacts?: (ctx: CoreCallContext, moduleId: string) => Promise<ReadResult<CatalogModuleFacts>>;
  /**
   * The reason-facts path only needs "retired", not the
   * candidate list, so it turns this on and `candidatesFor` answers plain
   * `notFound()` without a second candidate-catalog read. The write/dispose
   * path never sets it.
   */
  skipCandidates?: boolean;
  /**
   * Set ONLY on the reason-facts path (like `skipCandidates`).
   * It feeds the call's ONE memoized Goal→Plan window into the task-target
   * decision, so several task targets share it instead of re-reading the Goal.
   * Absent keeps the fresh reads and the write path's Workspace gate.
   */
  goalPlanWindow?: (ctx: CoreCallContext, goalId: string) => Promise<GoalPlanWindow>;
  /** File existence + missing-file candidates; absent keeps the narrow doubles compiling. */
  workspace?: NoteAnchorWorkspace;
  /** The project's main workspace (its `start_lines` operation); absent treats the caller's workspace as main. */
  mainWorkspaceOf?: (projectId: string) => Promise<ReadResult<string | null>>;
};

export type NoteAnchorFailure = { status: 'rejected'; code: 'invalid' | 'forbidden' | 'unavailable';
  reason: string; field: string | null;
  anchorCandidates?: NoteAnchorCandidateV1[]; candidatesUnavailable?: boolean;
  /** L14: the same-name hits when the symbol request is ambiguous. */
  symbolCandidates?: { name: string; range: { startLine: number; endLine: number } }[] };

export type ResolvedNoteAnchors = {
  /** Main anchor first, then the extra anchors in write order. */
  anchors: NoteAnchorV1[];
  /** L3: five scalar slots; slot 0 is the main anchor, the rest are extras, `null` when unused. */
  keys: [string, string | null, string | null, string | null, string | null];
  /**
   * L11/L14: the plan revision of the note's goal — the Run-bound plan
   * for an agent, the goal's current accepted plan for a user (`null` when the
   * caller has no goal or that goal has no accepted plan).
   */
  basisPlanRevision: number | null;
  /**
   * L11/L14: the catalog baseline revision. For an agent it is the
   * revision pinned by the bound plan (`null` when the baseline has no catalog
   * record); for a user it is the current active baseline (`null` when none).
   */
  basisCatalogRevision: number | null;
  /** L2a class 4: at least one task anchor names a cancelled/superseded Task. */
  anchorEnded: boolean;
  /** L14: a file anchor carried a `symbolRequest` that did not resolve to one locator. */
  symbolUnresolved: boolean;
  /** A Python syntax error only affects the anchors on that file; another anchor still resolves. */
  symbolProblems: NoteSymbolProblemV1[];
  /** The project's main workspace, resolved once for this write's request/store split. */
  mainWorkspaceId: string;
};

/** L2 (rule 21): NFC, ASCII lowercase, every Unicode White_Space run folds to one U+0020, trimmed. */
export function topicKeyOf(topic: string): string {
  return topic.normalize('NFC').replace(/\p{White_Space}+/gu, ' ').trim()
    .replace(/[A-Z]/g, letter => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/** L2a candidate normalization: NFC + ASCII lowercase, no whitespace folding. */
function normalizeCandidate(value: string): string {
  return value.normalize('NFC').replace(/[A-Z]/g, letter => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/** Code-point Levenshtein distance (bounded work is not needed for the small candidate set). */
function levenshtein(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  let previous = b.map((_, index) => index + 1);
  previous = [0, ...previous];
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

type CandidateSeed = { kind: NoteAnchorV1['kind']; id: string; displayName: string };

/** L2a class 2 candidate ranking: name equal, id prefix, contains, then id Levenshtein ≤2. */
function rankCandidates(seeds: readonly CandidateSeed[], given: string): NoteAnchorCandidateV1[] {
  const normalizedGiven = normalizeCandidate(given);
  const ranked: { candidate: NoteAnchorCandidateV1; rank: number; distance: number }[] = [];
  for (const seed of seeds) {
    const id = normalizeCandidate(seed.id);
    const display = normalizeCandidate(seed.displayName);
    let rank: number | null = null;
    let distance = 0;
    if (display === normalizedGiven) rank = 1;
    else if (id.startsWith(normalizedGiven) || normalizedGiven.startsWith(id)) rank = 2;
    else if (id.includes(normalizedGiven) || display.includes(normalizedGiven)) rank = 3;
    else {
      distance = levenshtein(id, normalizedGiven);
      if (distance <= 2) rank = 4;
    }
    if (rank === null) continue;
    ranked.push({ candidate: { kind: seed.kind, id: seed.id, displayName: seed.displayName }, rank, distance });
  }
  ranked.sort((left, right) => left.rank !== right.rank ? left.rank - right.rank
    : left.distance !== right.distance ? left.distance - right.distance
      : left.candidate.id.localeCompare(right.candidate.id));
  return ranked.slice(0, NOTE_ANCHOR_CANDIDATES_MAX).map(entry => entry.candidate);
}

function moduleSeeds(catalog: AdoptedArchitecture): CandidateSeed[] {
  const seeds: CandidateSeed[] = [];
  for (const module of catalog.modules) {
    seeds.push({ kind: 'module', id: module.ref.moduleId, displayName: module.name });
    for (const entry of module.interfaces) {
      seeds.push({ kind: 'interface', id: `${module.ref.moduleId}/${entry.id}`, displayName: entry.id });
    }
  }
  return seeds;
}

/**
 * The candidate catalog read is allowed to FAIL, and a failure is
 * reported as `candidatesUnavailable`, never as "no catalog / no candidates".
 * `ok: true, catalog: null` stays the real "no catalog adopted" answer.
 */
type CandidateCatalog = { ok: true; catalog: AdoptedArchitecture | null } | { ok: false };

async function readCandidateCatalog(ctx: CoreCallContext, deps: NoteAnchorFactsDeps): Promise<CandidateCatalog> {
  if (deps.architecture === undefined) return { ok: true, catalog: null };
  try {
    const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    if (read.status !== 'ready') return { ok: false };
    return { ok: true, catalog: read.value.catalog.catalog };
  } catch {
    return { ok: false };
  }
}

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

/** L2a class 2 file candidates: same basename first, then the nearest existing parent directory by distance. */
function fileCandidates(paths: readonly string[], given: string): NoteAnchorCandidateV1[] {
  const normalizedGiven = normalizeCandidate(given);
  const givenBase = basename(given);
  const unique = [...new Set(paths)];
  const sameName = unique.filter(candidate => basename(candidate) === givenBase)
    .sort((left, right) => left.localeCompare(right));
  const segments = given.split('/');
  const parents: string[] = [];
  for (let end = segments.length - 1; end >= 1; end -= 1) parents.push(segments.slice(0, end).join('/'));
  parents.push('');
  let nearest: string | null = null;
  for (const parent of parents) {
    if (parent === '' || unique.some(candidate => candidate.startsWith(`${parent}/`))) { nearest = parent; break; }
  }
  const others = unique.filter(candidate => !sameName.includes(candidate)
    && (nearest === null || nearest === '' || candidate.startsWith(`${nearest}/`)))
    .map(candidate => ({ candidate, distance: levenshtein(normalizeCandidate(candidate), normalizedGiven) }))
    .sort((left, right) => left.distance !== right.distance ? left.distance - right.distance
      : left.candidate.localeCompare(right.candidate));
  const ordered = [...sameName, ...others.map(entry => entry.candidate)];
  return ordered.slice(0, NOTE_ANCHOR_CANDIDATES_MAX).map(path => ({ kind: 'file', id: path, displayName: path }));
}

async function missingFileCandidates(ctx: CoreCallContext, path: string, workspace: NoteAnchorWorkspace):
Promise<{ candidates: NoteAnchorCandidateV1[]; unavailable: boolean }> {
  const captureSource = workspace.capture;
  const querySource = workspace.querySource;
  if (captureSource === undefined || querySource === undefined) return { candidates: [], unavailable: true };
  let capture: CaptureSummary;
  try {
    const captured = await captureSource(ctx, { provider: 'text' });
    if (captured.status !== 'ready') return { candidates: [], unavailable: true };
    capture = captured.value;
  } catch {
    return { candidates: [], unavailable: true };
  }
  try {
    const paths: string[] = [];
    let cursor: string | null = null;
    while (paths.length < NOTE_ANCHOR_CANDIDATE_SCAN) {
      let page: Awaited<ReturnType<WorkspaceToolsPort['querySource']>>;
      try {
        page = await querySource(ctx, { capture: capture.ref, query: { kind: 'paths' }, cursor, limit: 500 });
      } catch {
        return { candidates: [], unavailable: true };
      }
      if (page.status !== 'ready') return { candidates: [], unavailable: true };
      for (const hit of page.value.items as readonly SourceHit[]) {
        if (hit.kind === 'file') paths.push(hit.file.path);
      }
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    return { candidates: fileCandidates(paths.slice(0, NOTE_ANCHOR_CANDIDATE_SCAN), path), unavailable: false };
  } finally {
    // Best-effort release: the capture is the Host's shared pool's, and a failed release never
    // changes the candidates.
    try { await workspace.releaseCapture?.(ctx, capture.ref); } catch { /* best-effort */ }
  }
}

// --------------------------------------------------------------------------
// L14 write-side symbol resolution
// --------------------------------------------------------------------------

/**
 * L14: fold every whitespace run in the hit's range text to one space, then
 * sha256. Exported for 4B's L23 re-resolution to reuse the exact rule.
 */
export function signatureDigestOf(text: string): string {
  return sha256Hex(text.replace(/\s+/g, ' '));
}

/** The one-based UTF-16 line/column slice of a file's text (end column exclusive). */
export function symbolRangeText(content: string, start: { line: number; column: number },
  end: { line: number; column: number }): string {
  const lines = content.split('\n');
  if (start.line === end.line) return lines[start.line - 1]!.slice(start.column - 1, end.column - 1);
  const parts = [lines[start.line - 1]!.slice(start.column - 1)];
  for (let line = start.line + 1; line < end.line; line += 1) parts.push(lines[line - 1]!);
  parts.push(lines[end.line - 1]!.slice(0, end.column - 1));
  return parts.join('\n');
}

/** One named item of a single-file walk: the one-based UTF-16 span of its name. */
type SymbolCandidate = { name: string; start: { line: number; column: number }; end: { line: number; column: number } };

/** One symbol request's pick among a file's items; a resolved pick keeps the chosen item as the walk gave it. */
export type SymbolPick<T extends SymbolCandidate> =
  | { status: 'unresolved'; problem?: SymbolProblemV1 }
  | { status: 'ambiguous'; candidates: { name: string; range: { startLine: number; endLine: number } }[] }
  | { status: 'resolved'; symbol: SymbolLocatorV1; item: T };

/**
 * L14's one match over a single file's items, every language alike: the items of the requested
 * name (and of the requested name lines, when a range is given), ordered by start line and column.
 * Exactly one stores the locator: its name lines, the sha256 of the decoded text (the read side
 * compares the decoded text, never the raw bytes) and the signature digest of the name span; none
 * is `unresolved`; two or more are `ambiguous`.
 */
export function pickSymbol<T extends SymbolCandidate>(request: SymbolRequestV1, text: string,
  found: readonly T[]): SymbolPick<T> {
  const matches = found.filter(item => item.name === request.name && (request.range === undefined
    || (item.start.line === request.range.startLine && item.end.line === request.range.endLine)))
    .sort((left, right) => left.start.line - right.start.line || left.start.column - right.start.column);
  if (matches.length === 0) return { status: 'unresolved' };
  if (matches.length >= 2) {
    return { status: 'ambiguous', candidates: matches.map(item =>
      ({ name: item.name, range: { startLine: item.start.line, endLine: item.end.line } })) };
  }
  const item = matches[0]!;
  return { status: 'resolved', item, symbol: { language: request.language, qualifiedName: item.name,
    range: { startLine: item.start.line, endLine: item.end.line }, fileDigest: sha256Hex(text),
    signatureDigest: signatureDigestOf(symbolRangeText(text, item.start, item.end)) } };
}

/** A TS/JS file's pick from its single-file navigation items: one parse of the text, no pages, no hit cap. */
export function pickTypeScriptSymbol(path: string, request: SymbolRequestV1, text: string): SymbolPick<NavItemV1> {
  return pickSymbol(request, text, navigationItemsOf(path, text));
}

type SymbolRejection = { status: 'rejected'; code: 'unavailable'; reason: string };
type SymbolResolution = SymbolPick<SymbolCandidate> | SymbolRejection;

/** A symbol's working-tree file: `not_found` is no hit; any other read failure rejects the write (R10). */
async function symbolFileText(ctx: CoreCallContext, path: string, workspace: NoteAnchorWorkspace):
Promise<{ status: 'ready'; text: string; digest: string } | { status: 'unresolved' } | SymbolRejection> {
  const read = await workspace.readWorkspace(ctx, { workspace: { aggregateType: 'Workspace',
    projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, path, maxBytes: NOTE_BASIS_FILE_MAX_BYTES,
    version: { kind: 'working_tree' } });
  if (read.status === 'ready') return { status: 'ready', text: read.value.content, digest: read.value.digest };
  return read.code === 'not_found' ? { status: 'unresolved' }
    : { status: 'rejected', code: 'unavailable', reason: read.reason };
}

/**
 * L14: a general note's `symbolRequest`, found in its working-tree file on its own (no capture, no
 * program). `typescript` picks among a TS/JS file's navigation items. `python` and `cpp` go to the
 * single-file lookup (`mode: 'write'`; a hit is stored whether or not the parse was exact) unless
 * the path's extension names another known language: then the request is a slip and the file is
 * not read for it; a path of no known language (a script without extension) is looked up. Any other
 * language is `unresolved`, and so are a file the working tree does not have and a lookup that does
 * not support the file. Any other read or lookup failure rejects the write (`unavailable`), never a
 * silent `unresolved` (R10).
 */
export async function resolveSymbol(ctx: CoreCallContext, path: string, request: SymbolRequestV1,
  workspace: NoteAnchorWorkspace | undefined): Promise<SymbolResolution> {
  if (workspace === undefined) return { status: 'unresolved' };
  const language = request.language;
  const pathLanguage = languageOfPath(path);
  if (language === 'typescript') {
    if (pathLanguage !== 'typescript') return { status: 'unresolved' };
    const read = await symbolFileText(ctx, path, workspace);
    return read.status === 'ready' ? pickTypeScriptSymbol(path, request, read.text) : read;
  }
  const lookup = workspace.lookup;
  if ((language !== 'python' && language !== 'cpp') || (pathLanguage !== 'other' && pathLanguage !== language)
    || lookup === undefined) return { status: 'unresolved' };
  const read = await symbolFileText(ctx, path, workspace);
  if (read.status !== 'ready') return read;
  const found = await lookup(ctx, { language, path, text: read.text, digest: read.digest, mode: 'write' });
  if (found.status === 'unsupported') return { status: 'unresolved' };
  if (found.status === 'syntax_error') {
    return { status: 'unresolved', problem: { path, line: found.line, message: found.message } };
  }
  if (found.status === 'unavailable') return { status: 'rejected', code: 'unavailable', reason: found.reason };
  return pickSymbol(request, read.text, found.symbols);
}

/** L2 (rule 4.1): the topic is 1–40 code points and carries no newline. */
export function topicProblem(topic: unknown): string | null {
  if (typeof topic !== 'string') return 'the topic must be a string';
  if (/[\n\r]/.test(topic)) return 'the topic may not contain a newline';
  if ([...topic].length < 1 || [...topic].length > 40) return 'the topic must be 1–40 code points';
  if (topicKeyOf(topic).length === 0) return 'the topic normalizes to an empty topicKey';
  return null;
}

/** Rule 4.1: the conclusion is 1–200 code points. */
export function conclusionProblem(conclusion: unknown): string | null {
  if (typeof conclusion !== 'string') return 'the conclusion must be a string';
  const length = [...conclusion].length;
  if (length < 1 || length > NOTE_CONCLUSION_MAX_CODEPOINTS) return 'the conclusion must be 1–200 code points';
  return null;
}

/** The canonical anchor key of L2. The file key carries the path only (never the symbol). */
export function anchorKeyOf(anchor: NoteAnchorV1): string {
  switch (anchor.kind) {
    case 'module': return `module:${anchor.moduleId}`;
    case 'interface': return `interface:${anchor.moduleId}/${anchor.interfaceId}`;
    case 'file': return `file:${normalizeProjectPath(anchor.path)}`;
    case 'goal': return `goal:${anchor.goalId}`;
    case 'stage': return `stage:${anchor.goalId}/${String(anchor.planRevision)}/${anchor.stageId}`;
    case 'task': return `task:${anchor.goalId}/${anchor.taskId}`;
    case 'project': return 'project';
  }
}

export function moduleRefOf(projectId: string, moduleId: string): ModuleRef {
  return { projectId, moduleId };
}

function anchorFactsFailure(read: { status: 'rejected'; code: string; reason: string }, field: string): NoteAnchorFailure {
  return { status: 'rejected', code: read.code === 'forbidden' ? 'forbidden' : 'unavailable',
    reason: read.reason, field };
}

type GoalPlanEntry = { current: AnchorGoalPlanFacts | null; bound?: AnchorGoalPlanFacts;
  effectiveArchitectureBaseline: ArchitectureBaselinePin | null };

function isAnchorFailure(value: GoalPlanEntry | NoteAnchorFailure): value is NoteAnchorFailure {
  return 'status' in value;
}

/**
 * The catalog revision of the basis, from the caller's binding — the
 * Run-bound plan's pinned baseline for an agent, the current active baseline for
 * a user. A read failure is `unavailable`, never a silent `null`.
 */
async function basisCatalogRevisionOf(ctx: CoreCallContext, deps: NoteAnchorFactsDeps,
  isAgent: boolean, baseline: ArchitectureBaselinePin | null):
Promise<{ ok: true; value: number | null } | { ok: false; code: 'unavailable'; reason: string }> {
  if (deps.architecture === undefined) return { ok: true, value: null };
  if (isAgent) {
    if (baseline === null) return { ok: true, value: null };
    const ref = baseline.ref;
    const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'revision', ref } });
    if (read.status === 'ready') {
      return { ok: true, value: read.value.baseline.ref.revision };
    }
    return { ok: false, code: 'unavailable',
      reason: read.status === 'rejected' ? read.reason : 'the pinned catalog revision is not readable' };
  }
  const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  if (read.status === 'ready') {
    return { ok: true, value: read.value.baseline.ref.revision };
  }
  // A project with no adopted catalog is a real "none", not a failure.
  if (read.status === 'not_found') return { ok: true, value: null };
  return { ok: false, code: 'unavailable',
    reason: read.status === 'rejected' ? read.reason : 'the current catalog revision is not readable' };
}

/**
 * L2a classes 1–2 and 4: validate the shape of the submitted anchors, check that
 * the object exists and resolve the stored `NoteAnchorV1` plus its five keys.
 * Each goal is read once (current accepted plan) and, for an agent, the
 * Run-bound plan is read once for its own goal; a run-goal stage takes the bound
 * revision and must exist in both plans. A cancelled/superseded Task anchor is
 * resolved and reported through `anchorEnded`.
 */
export async function resolveNoteAnchors(ctx: CoreCallContext, input: {
  main: NoteDraftAnchorV1;
  extraAnchors: readonly NoteDraftAnchorV1[];
  goalId: string | null;
  facts?: readonly NoteFactV1[];
  /** The Run-bound plan for a work_run caller; `null`/absent for a user. */
  boundPlanRef?: PlanRevisionRef | null;
  /** Read path: existence checks need no L11/L14 basis, so skip those reads. */
  includeBasis?: boolean;
  /** L2: the duplicate rule. `'path'` (default) is the old eight kinds; `'end'` is only for `kind === 'link'` (book :895, :229–232). */
  duplicateIdentity?: 'path' | 'end';
  /** L2: `false` makes this step store the plain file anchor and the raw
   * request only. A link's ends and key are then resolved by §3.7's
   * `checkLinkDraft` in field order (including `from`); the default `true`
   * keeps the old eight kinds' per-anchor resolution (book :253–254, :895). */
  resolveSymbols?: boolean;
}, deps: NoteAnchorFactsDeps): Promise<{ status: 'ok'; value: ResolvedNoteAnchors } | NoteAnchorFailure> {
  const requestWorkspaceId = ctx.workspaceId ?? '';
  let mainWorkspaceId = requestWorkspaceId;
  if (deps.mainWorkspaceOf !== undefined) {
    const main = await deps.mainWorkspaceOf(ctx.projectId);
    // A failed main read refuses the anchors as `unavailable`; a ready `null`
    // (no workspace yet) keeps the caller's workspace as main.
    if (main.status !== 'ready') {
      return { status: 'rejected', code: 'unavailable',
        reason: main.status === 'rejected' ? main.reason : 'the main workspace cannot be read', field: 'anchor' };
    }
    mainWorkspaceId = main.value ?? requestWorkspaceId;
  }
  const rawDrafts: NoteDraftAnchorV1[] = [input.main, ...input.extraAnchors];
  for (const [index, draft] of rawDrafts.entries()) {
    const field = index === 0 ? 'anchor' : `extraAnchors[${String(index - 1)}]`;
    const problem = anchorFormatProblem(draft, field);
    if (problem !== null) return problem;
  }
  // Qualify every file anchor to the project path before any key, duplicate
  // check or read: a bare request path joins the caller's workspace, a prefixed
  // one names its own, and a main-workspace prefix/alias is refused.
  const drafts: NoteDraftAnchorV1[] = [];
  for (const [index, draft] of rawDrafts.entries()) {
    const field = index === 0 ? 'anchor' : `extraAnchors[${String(index - 1)}]`;
    if (draft.kind !== 'file') { drafts.push(draft); continue; }
    try {
      drafts.push({ ...draft, path: normalizeRequestProjectPath(requestWorkspaceId, draft.path, mainWorkspaceId) });
    } catch {
      return { status: 'rejected', code: 'invalid', reason: `anchor_invalid: ${field}.path`, field };
    }
  }

  // Class 1 duplicate check, on the canonical key (the stage version does not exist yet,
  // so a stage duplicate is compared by goal+stage id). A link compares endpoint
  // identities instead, so two anchors in one file with different symbols are distinct.
  const duplicateIdentity = input.duplicateIdentity ?? 'path';
  const seen = new Set<string>();
  for (const draft of drafts) {
    const key = duplicateIdentity === 'end'
      // The anchor-kind shape already passed for a link, so the draft is module/interface/file.
      ? endpointIdentityOf(draft as LinkEndRequestV1)
      : draftKeyWithoutVersion(draft);
    if (seen.has(key)) return { status: 'rejected', code: 'invalid',
      reason: 'an extra anchor repeats the main anchor', field: 'extraAnchors' };
    seen.add(key);
  }

  // One read per goal through the narrow anchor-facts reader. The
  // Run-bound plan is read once, for the agent's own (run) goal only.
  const isAgent = input.boundPlanRef !== undefined && input.boundPlanRef !== null;
  const boundPlanRef = isAgent ? input.boundPlanRef! : null;
  const goalPlans = new Map<string, GoalPlanEntry>();
  async function goalPlanFacts(goalId: string, field: string): Promise<GoalPlanEntry | NoteAnchorFailure> {
    const cached = goalPlans.get(goalId);
    if (cached !== undefined) return cached;
    const bound = isAgent && goalId === input.goalId ? boundPlanRef : null;
    const read = await readAnchorGoalFacts(deps.records, ctx, goalId, bound,
      deps.goalPlanWindow === undefined ? undefined : () => deps.goalPlanWindow!(ctx, goalId));
    if (read.status === 'not_found') {
      return { status: 'rejected', code: 'invalid', reason: 'anchor_not_found', field };
    }
    if (read.status === 'rejected') return anchorFactsFailure(read, field);
    if (read.status !== 'ready') {
      return { status: 'rejected', code: 'unavailable', reason: 'the anchor facts are not readable', field };
    }
    const entry: GoalPlanEntry = { current: read.value.current,
      effectiveArchitectureBaseline: read.value.effectiveArchitectureBaseline,
      ...(read.value.bound === undefined ? {} : { bound: read.value.bound }) };
    goalPlans.set(goalId, entry);
    return entry;
  }

  const anchors: NoteAnchorV1[] = [];
  let anchorEnded = false;
  let symbolUnresolved = false;
  const symbolProblems: NoteSymbolProblemV1[] = [];
  for (const [index, draft] of drafts.entries()) {
    const field = index === 0 ? 'anchor' : `extraAnchors[${String(index - 1)}]`;
    const resolved = await resolveOne(ctx, draft, field, deps, goalPlanFacts,
      { isAgent, runGoalId: input.goalId, facts: input.facts ?? [], mainWorkspaceId,
        ...(input.resolveSymbols === undefined ? {} : { resolveSymbols: input.resolveSymbols }) });
    if (resolved.status === 'rejected') return resolved;
    if (resolved.ended) anchorEnded = true;
    if (resolved.symbolUnresolved === true) symbolUnresolved = true;
    if (resolved.symbolProblem !== undefined) symbolProblems.push(resolved.symbolProblem);
    anchors.push(resolved.value);
  }

  let basisPlanRevision: number | null = null;
  let basisCatalogRevision: number | null = null;
  if (input.includeBasis !== false) {
    let basisBaseline: ArchitectureBaselinePin | null = null;
    if (input.goalId !== null) {
      const entry = await goalPlanFacts(input.goalId, 'anchor');
      if (isAnchorFailure(entry)) return entry;
      const basisPlan = isAgent ? (entry.bound ?? null) : entry.current;
      basisPlanRevision = basisPlan === null ? null : basisPlan.planRevision;
      basisBaseline = entry.effectiveArchitectureBaseline;
    }
    const catalog = await basisCatalogRevisionOf(ctx, deps, isAgent, basisBaseline);
    if (!catalog.ok) return { status: 'rejected', code: catalog.code, reason: catalog.reason, field: 'anchor' };
    basisCatalogRevision = catalog.value;
  }

  const keys = anchors.map(anchorKeyOf);
  return { status: 'ok', value: {
    anchors,
    keys: [keys[0]!, keys[1] ?? null, keys[2] ?? null, keys[3] ?? null, keys[4] ?? null],
    basisPlanRevision,
    basisCatalogRevision,
    anchorEnded,
    symbolUnresolved,
    symbolProblems,
    mainWorkspaceId,
  } };
}

function draftKeyWithoutVersion(draft: NoteDraftAnchorV1): string {
  switch (draft.kind) {
    case 'module': return `module:${draft.moduleId}`;
    case 'interface': return `interface:${draft.moduleId}/${draft.interfaceId}`;
    case 'file': return `file:${normalizeProjectPath(draft.path)}`;
    case 'goal': return `goal:${draft.goalId}`;
    case 'stage': return `stage:${draft.goalId}/?/${draft.stageId}`;
    case 'task': return `task:${draft.goalId}/${draft.taskId}`;
    case 'project': return 'project';
  }
}

/** The one path normalization the key uses (a leading `./` is dropped; class 1 already rejected the rest). */
export function normalizePath(path: string): string {
  let value = path;
  while (value.startsWith('./')) value = value.slice(2);
  return value;
}

/**
 * L14: the file anchor's `symbolRequest` shape (class 1).
 * `{ language, name, range? }` with non-empty strings and, when given, a
 * positive-integer range with `startLine ≤ endLine`; no extra keys. Returns the
 * failing subpath (L2a "指出字段"), or `null` when the shape is fine.
 */
function symbolRequestProblem(request: unknown): string | null {
  if (!isRecord(request)) return 'symbolRequest';
  if (Object.keys(request).some(key => key !== 'language' && key !== 'name' && key !== 'range')) {
    return 'symbolRequest';
  }
  if (!nonEmpty(request['language'])) return 'symbolRequest.language';
  if (!nonEmpty(request['name'])) return 'symbolRequest.name';
  const range = request['range'];
  if (range === undefined) return null;
  if (!isRecord(range)) return 'symbolRequest.range';
  if (Object.keys(range).some(key => key !== 'startLine' && key !== 'endLine')) {
    return 'symbolRequest.range';
  }
  if (!isPos(range['startLine'])) return 'symbolRequest.range.startLine';
  if (!isPos(range['endLine'])) return 'symbolRequest.range.endLine';
  if (range['startLine'] > range['endLine']) return 'symbolRequest.range.startLine';
  return null;
}

/**
 * L2a class 1 (anchor shape only): a submitted draft anchor must be an object
 * with a recognized kind and non-empty string ids; a file anchor needs a safe
 * relative path and `deleted` either absent or exactly `true`, plus a valid
 * `symbolRequest` shape. Object existence is class 2 and
 * stays in `resolveOne`.
 */
export function anchorFormatProblem(draft: unknown, field: string): NoteAnchorFailure | null {
  // L2a class 1 "指出字段": a shape failure names the exact field path in its
  // reason (`anchor_invalid: extraAnchors[1].path`), so it is distinct from
  // class 2's object-existence `anchor_not_found`.
  const bad = (subpath: string | null): NoteAnchorFailure => ({
    status: 'rejected', code: 'invalid',
    reason: subpath === null ? `anchor_invalid: ${field}` : `anchor_invalid: ${field}.${subpath}`, field,
  });
  if (!isRecord(draft)) return bad(null);
  switch (draft['kind']) {
    case 'module':
      return nonEmpty(draft['moduleId']) ? null : bad('moduleId');
    case 'interface':
      if (!nonEmpty(draft['moduleId'])) return bad('moduleId');
      return nonEmpty(draft['interfaceId']) ? null : bad('interfaceId');
    case 'file':
      if (!isSafeProjectPath(draft['path'])) return bad('path');
      if (splitWorkspacePath(draft['path']).path === '.') return bad('path');
      if (draft['deleted'] !== undefined && draft['deleted'] !== true) return bad('deleted');
      if (draft['symbolRequest'] !== undefined) {
        const problem = symbolRequestProblem(draft['symbolRequest']);
        if (problem !== null) {
          return { status: 'rejected', code: 'invalid',
            reason: `anchor_invalid: ${field}.${problem}`, field: `${field}.symbolRequest` };
        }
      }
      return null;
    case 'goal':
      return nonEmpty(draft['goalId']) ? null : bad('goalId');
    case 'stage':
      if (!nonEmpty(draft['goalId'])) return bad('goalId');
      return nonEmpty(draft['stageId']) ? null : bad('stageId');
    case 'task':
      if (!nonEmpty(draft['goalId'])) return bad('goalId');
      return nonEmpty(draft['taskId']) ? null : bad('taskId');
    case 'project':
      return null;
    default:
      return bad('kind');
  }
}

async function resolveOne(ctx: CoreCallContext, draft: NoteDraftAnchorV1, field: string, deps: NoteAnchorFactsDeps,
  goalPlanFacts: (goalId: string, field: string) => Promise<GoalPlanEntry | NoteAnchorFailure>,
  context: { isAgent: boolean; runGoalId: string | null; facts: readonly NoteFactV1[];
    mainWorkspaceId: string; resolveSymbols?: boolean }):
Promise<{ status: 'ok'; value: NoteAnchorV1; ended: boolean; symbolUnresolved?: boolean;
  symbolProblem?: NoteSymbolProblemV1 } | NoteAnchorFailure> {
  const notFound = (candidates?: NoteAnchorCandidateV1[], unavailable?: boolean): NoteAnchorFailure => ({
    status: 'rejected', code: 'invalid', reason: 'anchor_not_found', field,
    ...(candidates === undefined ? {} : { anchorCandidates: candidates }),
    ...(unavailable === true ? { candidatesUnavailable: true } : {}),
  });
  // A rejected store read passes through (forbidden stays
  // forbidden, everything else is unavailable); the candidate list is only
  // built for a real `not_found`, and a failed candidate catalog read says so.
  const passThrough = (code: string, reason: string): NoteAnchorFailure => ({
    status: 'rejected', code: code === 'forbidden' ? 'forbidden' : 'unavailable', reason, field,
  });
  const unavailableFacts = (): NoteAnchorFailure => ({
    status: 'rejected', code: 'unavailable', reason: 'the anchor facts are not readable', field,
  });
  const candidatesFor = async (given: string): Promise<NoteAnchorFailure> => {
    // The reason facts only need the retired verdict, so the
    // card-source path builds no candidate list and reads no catalog here.
    if (deps.skipCandidates === true) return notFound();
    const catalogRead = await readCandidateCatalog(ctx, deps);
    if (!catalogRead.ok) return notFound(undefined, true);
    return notFound(catalogRead.catalog === null ? undefined : rankCandidates(moduleSeeds(catalogRead.catalog), given));
  };
  // One catalog read per note call; the seam carries the
  // caller's per-call window cache, the fallback keeps narrow doubles working.
  const moduleFactsOf = (moduleId: string): Promise<ReadResult<CatalogModuleFacts>> =>
    deps.catalogModuleFacts === undefined
      ? readCatalogModuleFacts(deps.records, ctx, moduleRefOf(ctx.projectId, moduleId))
      : deps.catalogModuleFacts(ctx, moduleId);
  switch (draft.kind) {
    case 'module': {
      const facts = await moduleFactsOf(draft.moduleId);
      if (facts.status === 'rejected') return passThrough(facts.code, facts.reason);
      if (facts.status === 'not_found') return candidatesFor(draft.moduleId);
      if (facts.status !== 'ready') return unavailableFacts();
      return { status: 'ok', value: { kind: 'module', moduleId: draft.moduleId }, ended: false };
    }
    case 'interface': {
      const facts = await moduleFactsOf(draft.moduleId);
      if (facts.status === 'rejected') return passThrough(facts.code, facts.reason);
      if (facts.status === 'not_found') return candidatesFor(`${draft.moduleId}/${draft.interfaceId}`);
      if (facts.status !== 'ready') return unavailableFacts();
      if (!facts.value.module.interfaces.some(entry => entry.id === draft.interfaceId)) {
        return candidatesFor(`${draft.moduleId}/${draft.interfaceId}`);
      }
      return { status: 'ok', value: { kind: 'interface', moduleId: draft.moduleId, interfaceId: draft.interfaceId }, ended: false };
    }
    case 'file': {
      const path = normalizeProjectPath(draft.path);
      const anchor: Extract<NoteAnchorV1, { kind: 'file' }> = { kind: 'file', path,
        ...(draft.deleted === true ? { deleted: true as const } : {}) };
      const problem = await checkFileAnchor(ctx, anchor, context.facts, deps, field, context.mainWorkspaceId);
      if (problem !== null) return problem;
      // The stored path names its own workspace; the symbol read uses that
      // workspace's context and relative path, not the caller's.
      const stored = resolveStoredProjectPath(path, context.mainWorkspaceId);
      const wctx = { ...ctx, workspaceId: stored.workspaceId };
      // L14: resolution runs after the class-2 existence check. The
      // symbolRequest is write-only; only the resolved locator is stored.
      if (draft.symbolRequest !== undefined && context.resolveSymbols !== false) {
        const resolution = await resolveSymbol(wctx, stored.path, draft.symbolRequest, deps.workspace);
        if (resolution.status === 'rejected') {
          return { status: 'rejected', code: resolution.code, reason: resolution.reason, field };
        }
        if (resolution.status === 'ambiguous') {
          return { status: 'rejected', code: 'invalid', reason: 'symbol_ambiguous', field,
            symbolCandidates: resolution.candidates };
        }
        if (resolution.status === 'resolved') anchor.symbol = resolution.symbol;
        else return { status: 'ok', value: anchor, ended: false, symbolUnresolved: true,
          ...(resolution.problem === undefined ? {} : { symbolProblem: { field, ...resolution.problem } }) };
      }
      return { status: 'ok', value: anchor, ended: false, symbolUnresolved: false };
    }
    case 'goal': {
      const entry = await goalPlanFacts(draft.goalId, field);
      if (isAnchorFailure(entry)) return entry;
      return { status: 'ok', value: { kind: 'goal', goalId: draft.goalId }, ended: false };
    }
    case 'stage': {
      const entry = await goalPlanFacts(draft.goalId, field);
      if (isAnchorFailure(entry)) return entry;
      if (entry.current === null || !entry.current.stageIds.includes(draft.stageId)) return notFound();
      const runGoal = context.isAgent && draft.goalId === context.runGoalId;
      // R5: an agent's stage must exist in BOTH the bound plan (what the key
      // names) and the current plan (L2), else the key names nothing.
      if (runGoal) {
        if (entry.bound === undefined || !entry.bound.stageIds.includes(draft.stageId)) return notFound();
        return { status: 'ok', value: { kind: 'stage', goalId: draft.goalId,
          planRevision: entry.bound.planRevision, stageId: draft.stageId }, ended: false };
      }
      return { status: 'ok', value: { kind: 'stage', goalId: draft.goalId,
        planRevision: entry.current.planRevision, stageId: draft.stageId }, ended: false };
    }
    case 'task': {
      const entry = await goalPlanFacts(draft.goalId, field);
      if (isAnchorFailure(entry)) return entry;
      if (entry.current === null) return notFound();
      const task = entry.current.tasks.find(candidate => candidate.taskId === draft.taskId);
      if (task === undefined) return notFound();
      return { status: 'ok', value: { kind: 'task', goalId: draft.goalId, taskId: draft.taskId },
        ended: task.disposition === 'cancelled' || task.disposition === 'superseded' };
    }
    case 'project':
      return { status: 'ok', value: { kind: 'project' }, ended: false };
  }
}

/** L2a classes 2/4: the live/deleted file anchor check and the missing-file candidates. */
async function checkFileAnchor(ctx: CoreCallContext, anchor: Extract<NoteAnchorV1, { kind: 'file' }>,
  facts: readonly NoteFactV1[], deps: NoteAnchorFactsDeps, field: string,
  mainWorkspaceId: string): Promise<NoteAnchorFailure | null> {
  // R2: without a workspace the existence is unknown, never admitted.
  if (deps.workspace === undefined) {
    return { status: 'rejected', code: 'unavailable', reason: 'the file anchor cannot be read', field };
  }
  const workspace = deps.workspace;
  // A bare stored path is the MAIN workspace, never the caller's; a prefixed
  // one names its own workspace. The read context follows the resolved
  // workspace because the workspace capture checks `ctx.workspaceId`.
  const resolved = resolveStoredProjectPath(anchor.path, mainWorkspaceId);
  const wctx = { ...ctx, workspaceId: resolved.workspaceId };
  const read = await workspace.readWorkspace(wctx, { workspace: { aggregateType: 'Workspace',
    projectId: wctx.projectId, workspaceId: resolved.workspaceId }, path: resolved.path, maxBytes: 1,
    version: { kind: 'working_tree' } });
  let exists = false;
  let missing = false;
  if (read.status === 'ready') exists = true;
  else if (read.code === 'capacity') exists = true;
  // R2: a `forbidden` read says nothing about existence; it is never "missing".
  else if (read.code === 'forbidden') return { status: 'rejected', code: 'invalid', reason: 'anchor_forbidden', field };
  else if (read.code === 'not_found') missing = true;
  else return { status: 'rejected', code: 'unavailable', reason: 'the file anchor cannot be read', field };
  if (anchor.deleted === true) {
    if (exists) return { status: 'rejected', code: 'invalid', reason: 'file_exists', field };
    if (missing && facts.length === 0) return { status: 'rejected', code: 'invalid', reason: 'deleted_needs_fact', field };
    if (missing) return null;
    return { status: 'rejected', code: 'unavailable', reason: 'the deleted file anchor cannot be checked', field };
  }
  if (exists) return null;
  if (missing) {
    const candidates = await missingFileCandidates(wctx, resolved.path, workspace);
    return { status: 'rejected', code: 'invalid', reason: 'anchor_not_found', field,
      anchorCandidates: candidates.candidates, ...(candidates.unavailable ? { candidatesUnavailable: true } : {}) };
  }
  return { status: 'rejected', code: 'unavailable', reason: 'the file anchor cannot be read', field };
}

/**
 * The notes' workspace reads (a file anchor's existence, candidates and symbol, a basis file's digest, a note's
 * freshness) are read-only checks the platform makes for the caller. The Host authorizes a workspace read only for
 * its own principal, so a Run's check reads under this fixed internal identity (`platformCheckContext`); the write,
 * its admission, quotas and stored author, and every non-workspace read, stay the caller's.
 */
const NOTE_CHECK_ACTOR: { kind: 'system'; id: string } = Object.freeze({ kind: 'system', id: 'note-workspace-check' });

export function noteCheckWorkspace(workspace: NoteAnchorWorkspace): NoteAnchorWorkspace {
  const checking = (ctx: CoreCallContext): CoreCallContext => platformCheckContext(ctx, NOTE_CHECK_ACTOR);
  const { capture, querySource, releaseCapture, verify, lookup } = workspace;
  const checked: NoteAnchorWorkspace = { readWorkspace: (ctx, input) => workspace.readWorkspace(checking(ctx), input),
    readWorkspaceFiles: (ctx, input) => workspace.readWorkspaceFiles(checking(ctx), input) };
  if (capture !== undefined) checked.capture = (ctx, input) => capture(checking(ctx), input);
  if (querySource !== undefined) checked.querySource = (ctx, input) => querySource(checking(ctx), input);
  if (releaseCapture !== undefined) checked.releaseCapture = (ctx, ref) => releaseCapture(checking(ctx), ref);
  if (verify !== undefined) checked.verify = (ctx, req) => verify(checking(ctx), req);
  if (lookup !== undefined) checked.lookup = (ctx, input) => lookup(checking(ctx), input);
  return checked;
}

// `ModuleDefinition` is re-exported for the scope math to share the same catalog shape.
export type { ModuleDefinition };
