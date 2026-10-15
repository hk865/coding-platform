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
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { AdoptedArchitecture, ModuleDefinition } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureBaselinePin } from '../../../contracts/governance.js';
import type { NoteAnchorV1, NoteDraftAnchorV1, NoteFactV1, SymbolLocatorV1, SymbolRequestV1 } from '../../../contracts/note.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import { sha256Hex } from '../../../contracts/fingerprint.js';
import type { NoteAnchorCandidateV1 } from '../model/note-contracts.js';
import type {
  CaptureSummary, SourceHit, SourceProvider, WorkspaceResult, WorkspaceToolsPort,
} from '../../workspace/ports.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { readCatalogModuleFacts } from '../architecture/catalog-service.js';
import type { AnchorGoalPlanFacts } from './note-anchor-facts.js';
import { readAnchorGoalFacts } from './note-anchor-facts.js';
import {
  NOTE_ANCHOR_CANDIDATES_MAX, NOTE_ANCHOR_CANDIDATE_SCAN, NOTE_BASIS_FILE_MAX_BYTES,
  NOTE_CONCLUSION_MAX_CODEPOINTS, NOTE_SYMBOL_HITS_MAX,
} from '../model/note-contracts.js';

/**
 * The narrow workspace surface the anchor gate needs: the existence read and
 * the write's capture + path query for missing-file candidates. The composition
 * root fills the trusted workspace revision the capture request requires; the
 * note module never sees or supplies one.
 */
export type NoteAnchorWorkspace = Pick<WorkspaceToolsPort, 'readWorkspace'> & {
  capture?(ctx: CoreCallContext, request: { provider: SourceProvider }): Promise<WorkspaceResult<CaptureSummary>>;
  querySource?: WorkspaceToolsPort['querySource'];
  /** L14: best-effort release of the write's symbol capture after use. */
  releaseCapture?: WorkspaceToolsPort['releaseCapture'];
};

export type NoteAnchorFactsDeps = {
  records: GoalRecordTransactionPort;
  /** Candidate/containment catalog read; absent in narrow doubles keeps class 1–2 shape checks working. */
  architecture?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  /** File existence + missing-file candidates; absent keeps the narrow doubles compiling. */
  workspace?: NoteAnchorWorkspace;
};

export type NoteAnchorFailure = { status: 'rejected'; code: 'invalid' | 'forbidden' | 'unavailable';
  reason: string; field: string | null;
  anchorCandidates?: NoteAnchorCandidateV1[]; candidatesUnavailable?: boolean;
  /** Item 14/L14: the same-name hits when the symbol request is ambiguous. */
  symbolCandidates?: { name: string; range: { startLine: number; endLine: number } }[] };

export type ResolvedNoteAnchors = {
  /** Main anchor first, then the extra anchors in write order. */
  anchors: NoteAnchorV1[];
  /** L3: five scalar slots; slot 0 is the main anchor, the rest are extras, `null` when unused. */
  keys: [string, string | null, string | null, string | null, string | null];
  /**
   * Item 6/L11/L14: the plan revision of the note's goal — the Run-bound plan
   * for an agent, the goal's current accepted plan for a user (`null` when the
   * caller has no goal or that goal has no accepted plan).
   */
  basisPlanRevision: number | null;
  /**
   * Item 6/L11/L14: the catalog baseline revision. For an agent it is the
   * revision pinned by the bound plan (`null` when the baseline has no catalog
   * record); for a user it is the current active baseline (`null` when none).
   */
  basisCatalogRevision: number | null;
  /** L2a class 4: at least one task anchor names a cancelled/superseded Task. */
  anchorEnded: boolean;
  /** Item 14/L14: a file anchor carried a `symbolRequest` that did not resolve to one locator. */
  symbolUnresolved: boolean;
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
 * Item 3 fix 6: the candidate catalog read is allowed to FAIL, and a failure is
 * reported as `candidatesUnavailable`, never as "no catalog / no candidates".
 * `ok: true, catalog: null` stays the real "no catalog adopted" answer.
 */
type CandidateCatalog = { ok: true; catalog: AdoptedArchitecture | null } | { ok: false };

async function readCandidateCatalog(ctx: CoreCallContext, deps: NoteAnchorFactsDeps): Promise<CandidateCatalog> {
  if (deps.architecture === undefined) return { ok: true, catalog: null };
  try {
    const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    if (read.status !== 'ready') return { ok: false };
    return { ok: true, catalog: read.value.catalog === null ? null : read.value.catalog.catalog };
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
}

// --------------------------------------------------------------------------
// L14 write-side symbol resolution (item 14)
// --------------------------------------------------------------------------

/** The languages L14 resolves; anything else is `unsupported` → warning (R10). */
const SYMBOL_LANGUAGES: readonly SourceProvider[] = ['typescript', 'python', 'cpp'];

/**
 * Symbol-scan page size. The spec fixes only the total cap
 * (`NOTE_SYMBOL_HITS_MAX`); scanning in bounded pages is what proves the
 * cursor path (item 14 test (f)). The floor with the remaining budget keeps
 * the cap exact.
 */
const SYMBOL_SCAN_PAGE = 32;

/**
 * L14: fold every whitespace run in the hit's range text to one space, then
 * sha256. Exported for 4B's L23 re-resolution to reuse the exact rule.
 */
export function signatureDigestOf(text: string): string {
  return sha256Hex(text.replace(/\s+/g, ' '));
}

type SymbolHit = Extract<SourceHit, { kind: 'symbol' }>;

type SymbolResolution =
  | { status: 'resolved'; symbol: SymbolLocatorV1 }
  | { status: 'unresolved' }
  | { status: 'ambiguous'; candidates: { name: string; range: { startLine: number; endLine: number } }[] }
  | { status: 'rejected'; code: 'unavailable'; reason: string };

/** The one-based UTF-16 line/column slice of the frozen capture content. */
function rangeTextOf(content: string, hit: SymbolHit): string {
  const startLine = hit.location.start.line;
  const endLine = hit.location.end.line;
  const lines = content.split('\n');
  if (startLine === endLine) return lines[startLine - 1]!.slice(hit.location.start.column - 1, hit.location.end.column - 1);
  const parts = [lines[startLine - 1]!.slice(hit.location.start.column - 1)];
  for (let line = startLine + 1; line < endLine; line += 1) parts.push(lines[line - 1]!);
  parts.push(lines[endLine - 1]!.slice(0, hit.location.end.column - 1));
  return parts.join('\n');
}

function symbolCandidatesOf(hits: readonly SymbolHit[]): { name: string; range: { startLine: number; endLine: number } }[] {
  return hits.map(hit => ({ name: hit.name, range: { startLine: hit.location.start.line, endLine: hit.location.end.line } }));
}

/**
 * L14: one capture with the language's provider, then page `querySource` over
 * the file's symbols up to `hitsMax`, keeping the hits whose name (and range,
 * when given) match. Exactly one complete match stores the locator; 0/1 at the
 * cap and no match are `unresolved`; 2+ are `ambiguous` (ordered by start
 * line). A capture/query failure is a write rejection (`unavailable`), never
 * a silent `unresolved` (R10).
 */
export async function resolveSymbol(ctx: CoreCallContext, path: string, request: SymbolRequestV1,
  workspace: NoteAnchorWorkspace | undefined, hitsMax: number): Promise<SymbolResolution> {
  if (workspace === undefined || workspace.capture === undefined || workspace.querySource === undefined) {
    return { status: 'unresolved' };
  }
  if (!SYMBOL_LANGUAGES.includes(request.language as SourceProvider)) return { status: 'unresolved' };
  const provider = request.language as SourceProvider;
  let capture: CaptureSummary;
  try {
    const captured = await workspace.capture(ctx, { provider });
    if (captured.status !== 'ready') {
      if (captured.code === 'unsupported') return { status: 'unresolved' };
      return { status: 'rejected', code: 'unavailable', reason: captured.reason };
    }
    capture = captured.value;
  } catch {
    return { status: 'rejected', code: 'unavailable', reason: 'the symbol capture cannot be read' };
  }
  try {
    const matches: SymbolHit[] = [];
    let cursor: string | null = null;
    let scanned = 0;
    while (scanned < hitsMax) {
      const limit = Math.min(hitsMax - scanned, SYMBOL_SCAN_PAGE);
      let page: Awaited<ReturnType<WorkspaceToolsPort['querySource']>>;
      try {
        page = await workspace.querySource(ctx,
          { capture: capture.ref, query: { kind: 'symbols', path }, cursor, limit });
      } catch {
        return { status: 'rejected', code: 'unavailable', reason: 'the symbol scan cannot be read' };
      }
      if (page.status !== 'ready') {
        if (page.code === 'unsupported') return { status: 'unresolved' };
        return { status: 'rejected', code: 'unavailable', reason: page.reason };
      }
      for (const hit of page.value.items) {
        if (hit.kind !== 'symbol' || hit.name !== request.name) continue;
        if (request.range !== undefined
          && (hit.location.start.line !== request.range.startLine || hit.location.end.line !== request.range.endLine)) continue;
        matches.push(hit);
      }
      scanned += page.value.items.length;
      cursor = page.value.nextCursor;
      if (cursor === null) break;
    }
    const sorted = [...matches].sort((left, right) => left.location.start.line - right.location.start.line
      || left.location.start.column - right.location.start.column);
    // R10: stopping at the cap with more pages never stores a locator.
    if (cursor !== null) {
      return sorted.length >= 2
        ? { status: 'ambiguous', candidates: symbolCandidatesOf(sorted) }
        : { status: 'unresolved' };
    }
    if (sorted.length === 0) return { status: 'unresolved' };
    if (sorted.length >= 2) return { status: 'ambiguous', candidates: symbolCandidatesOf(sorted) };
    const hit = sorted[0]!;
    const read = await workspace.readWorkspace(ctx, { workspace: { aggregateType: 'Workspace',
      projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, path, maxBytes: NOTE_BASIS_FILE_MAX_BYTES,
      version: { kind: 'capture', capture: capture.ref } });
    if (read.status !== 'ready') {
      // R10(iii): only a file that is not in the capture is a success warning;
      // every other read failure (capacity, unavailable, ...) rejects the write.
      return read.code === 'not_found'
        ? { status: 'unresolved' }
        : { status: 'rejected', code: 'unavailable', reason: read.reason };
    }
    return { status: 'resolved', symbol: { language: request.language, qualifiedName: hit.name,
      range: { startLine: hit.location.start.line, endLine: hit.location.end.line },
      fileDigest: hit.location.digest, signatureDigest: signatureDigestOf(rangeTextOf(read.value.content, hit)) } };
  } finally {
    // Best-effort release: the locator is already computed, so a failed release
    // never changes the write's outcome.
    try { await workspace.releaseCapture?.(ctx, capture.ref); } catch { /* best-effort */ }
  }
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

/** L2a class 1/2: a normalized workspace-relative path (no backslash, drive, `.` or `..`). */
export function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  if (/[\\:\0]/.test(value)) return false;
  const segments = value.split('/');
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** The canonical anchor key of L2. The file key carries the path only (never the symbol). */
export function anchorKeyOf(anchor: NoteAnchorV1): string {
  switch (anchor.kind) {
    case 'module': return `module:${anchor.moduleId}`;
    case 'interface': return `interface:${anchor.moduleId}/${anchor.interfaceId}`;
    case 'file': return `file:${anchor.path}`;
    case 'goal': return `goal:${anchor.goalId}`;
    case 'stage': return `stage:${anchor.goalId}/${String(anchor.planRevision)}/${anchor.stageId}`;
    case 'task': return `task:${anchor.goalId}/${anchor.taskId}`;
    case 'project': return 'project';
  }
}

function moduleRefOf(projectId: string, moduleId: string): ModuleRef {
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
 * Item 6: the catalog revision of the basis, from the caller's binding — the
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
      return { ok: true, value: read.value.catalog === null ? null : read.value.baseline.ref.revision };
    }
    return { ok: false, code: 'unavailable',
      reason: read.status === 'rejected' ? read.reason : 'the pinned catalog revision is not readable' };
  }
  const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  if (read.status === 'ready') {
    return { ok: true, value: read.value.catalog === null ? null : read.value.baseline.ref.revision };
  }
  // A project with no adopted catalog is a real "none", not a failure.
  if (read.status === 'not_found') return { ok: true, value: null };
  return { ok: false, code: 'unavailable',
    reason: read.status === 'rejected' ? read.reason : 'the current catalog revision is not readable' };
}

/**
 * L2a classes 1–2 and 4: validate the shape of the submitted anchors, check that
 * the object exists and resolve the stored `NoteAnchorV1` plus its five keys.
 * Item 6: each goal is read once (current accepted plan) and, for an agent, the
 * Run-bound plan is read once for its own goal; a run-goal stage takes the bound
 * revision and must exist in both plans. A cancelled/superseded Task anchor is
 * resolved and reported through `anchorEnded`.
 */
export async function resolveNoteAnchors(ctx: CoreCallContext, input: {
  main: NoteDraftAnchorV1;
  extraAnchors: readonly NoteDraftAnchorV1[];
  goalId: string | null;
  facts?: readonly NoteFactV1[];
  /** Item 6: the Run-bound plan for a work_run caller; `null`/absent for a user. */
  boundPlanRef?: PlanRevisionRef | null;
  /** Read path: existence checks need no L11/L14 basis, so skip those reads. */
  includeBasis?: boolean;
  /** Item 14: the injectable symbol-scan cap; defaults to the spec's `NOTE_SYMBOL_HITS_MAX`. */
  symbolHitsMax?: number;
}, deps: NoteAnchorFactsDeps): Promise<{ status: 'ok'; value: ResolvedNoteAnchors } | NoteAnchorFailure> {
  const symbolHitsMax = input.symbolHitsMax ?? NOTE_SYMBOL_HITS_MAX;
  const drafts: NoteDraftAnchorV1[] = [input.main, ...input.extraAnchors];
  for (const [index, draft] of drafts.entries()) {
    const field = index === 0 ? 'anchor' : `extraAnchors[${String(index - 1)}]`;
    const problem = anchorFormatProblem(draft, field);
    if (problem !== null) return problem;
  }

  // Class 1 duplicate check, on the canonical key (the stage version does not exist yet,
  // so a stage duplicate is compared by goal+stage id).
  const seen = new Set<string>();
  for (const draft of drafts) {
    const key = draftKeyWithoutVersion(draft);
    if (seen.has(key)) return { status: 'rejected', code: 'invalid',
      reason: 'an extra anchor repeats the main anchor', field: 'extraAnchors' };
    seen.add(key);
  }

  // Item 6: one read per goal through the narrow anchor-facts reader. The
  // Run-bound plan is read once, for the agent's own (run) goal only.
  const isAgent = input.boundPlanRef !== undefined && input.boundPlanRef !== null;
  const boundPlanRef = isAgent ? input.boundPlanRef! : null;
  const goalPlans = new Map<string, GoalPlanEntry>();
  async function goalPlanFacts(goalId: string, field: string): Promise<GoalPlanEntry | NoteAnchorFailure> {
    const cached = goalPlans.get(goalId);
    if (cached !== undefined) return cached;
    const bound = isAgent && goalId === input.goalId ? boundPlanRef : null;
    const read = await readAnchorGoalFacts(deps.records, ctx, goalId, bound);
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
  for (const [index, draft] of drafts.entries()) {
    const field = index === 0 ? 'anchor' : `extraAnchors[${String(index - 1)}]`;
    const resolved = await resolveOne(ctx, draft, field, deps, goalPlanFacts,
      { isAgent, runGoalId: input.goalId, facts: input.facts ?? [], symbolHitsMax });
    if (resolved.status === 'rejected') return resolved;
    if (resolved.ended) anchorEnded = true;
    if (resolved.symbolUnresolved === true) symbolUnresolved = true;
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
  } };
}

function draftKeyWithoutVersion(draft: NoteDraftAnchorV1): string {
  switch (draft.kind) {
    case 'module': return `module:${draft.moduleId}`;
    case 'interface': return `interface:${draft.moduleId}/${draft.interfaceId}`;
    case 'file': return `file:${normalizePath(draft.path)}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Item 14/L14: the file anchor's `symbolRequest` shape (class 1).
 * `{ language, name, range? }` with non-empty strings and, when given, a
 * positive-integer range with `startLine ≤ endLine`; no extra keys. Returns the
 * failing subpath (L2a "指出字段"), or `null` when the shape is fine.
 */
function symbolRequestProblem(request: unknown): string | null {
  if (!isRecord(request)) return 'symbolRequest';
  if (Object.keys(request).some(key => key !== 'language' && key !== 'name' && key !== 'range')) {
    return 'symbolRequest';
  }
  if (!nonEmptyString(request['language'])) return 'symbolRequest.language';
  if (!nonEmptyString(request['name'])) return 'symbolRequest.name';
  const range = request['range'];
  if (range === undefined) return null;
  if (!isRecord(range)) return 'symbolRequest.range';
  if (Object.keys(range).some(key => key !== 'startLine' && key !== 'endLine')) {
    return 'symbolRequest.range';
  }
  if (!isPositiveSafeInteger(range['startLine'])) return 'symbolRequest.range.startLine';
  if (!isPositiveSafeInteger(range['endLine'])) return 'symbolRequest.range.endLine';
  if (range['startLine'] > range['endLine']) return 'symbolRequest.range.startLine';
  return null;
}

/**
 * L2a class 1 (anchor shape only): a submitted draft anchor must be an object
 * with a recognized kind and non-empty string ids; a file anchor needs a safe
 * relative path and `deleted` either absent or exactly `true`, plus a valid
 * `symbolRequest` shape (group GD's item 14). Object existence is class 2 and
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
      return nonEmptyString(draft['moduleId']) ? null : bad('moduleId');
    case 'interface':
      if (!nonEmptyString(draft['moduleId'])) return bad('moduleId');
      return nonEmptyString(draft['interfaceId']) ? null : bad('interfaceId');
    case 'file':
      if (!isSafeRelativePath(draft['path'])) return bad('path');
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
      return nonEmptyString(draft['goalId']) ? null : bad('goalId');
    case 'stage':
      if (!nonEmptyString(draft['goalId'])) return bad('goalId');
      return nonEmptyString(draft['stageId']) ? null : bad('stageId');
    case 'task':
      if (!nonEmptyString(draft['goalId'])) return bad('goalId');
      return nonEmptyString(draft['taskId']) ? null : bad('taskId');
    case 'project':
      return null;
    default:
      return bad('kind');
  }
}

async function resolveOne(ctx: CoreCallContext, draft: NoteDraftAnchorV1, field: string, deps: NoteAnchorFactsDeps,
  goalPlanFacts: (goalId: string, field: string) => Promise<GoalPlanEntry | NoteAnchorFailure>,
  context: { isAgent: boolean; runGoalId: string | null; facts: readonly NoteFactV1[]; symbolHitsMax: number }):
Promise<{ status: 'ok'; value: NoteAnchorV1; ended: boolean; symbolUnresolved?: boolean } | NoteAnchorFailure> {
  const notFound = (candidates?: NoteAnchorCandidateV1[], unavailable?: boolean): NoteAnchorFailure => ({
    status: 'rejected', code: 'invalid', reason: 'anchor_not_found', field,
    ...(candidates === undefined ? {} : { anchorCandidates: candidates }),
    ...(unavailable === true ? { candidatesUnavailable: true } : {}),
  });
  // Item 3 fix 6: a rejected store read passes through (forbidden stays
  // forbidden, everything else is unavailable); the candidate list is only
  // built for a real `not_found`, and a failed candidate catalog read says so.
  const passThrough = (code: string, reason: string): NoteAnchorFailure => ({
    status: 'rejected', code: code === 'forbidden' ? 'forbidden' : 'unavailable', reason, field,
  });
  const unavailableFacts = (): NoteAnchorFailure => ({
    status: 'rejected', code: 'unavailable', reason: 'the anchor facts are not readable', field,
  });
  const candidatesFor = async (given: string): Promise<NoteAnchorFailure> => {
    const catalogRead = await readCandidateCatalog(ctx, deps);
    if (!catalogRead.ok) return notFound(undefined, true);
    return notFound(catalogRead.catalog === null ? undefined : rankCandidates(moduleSeeds(catalogRead.catalog), given));
  };
  switch (draft.kind) {
    case 'module': {
      const facts = await readCatalogModuleFacts(deps.records, ctx, moduleRefOf(ctx.projectId, draft.moduleId));
      if (facts.status === 'rejected') return passThrough(facts.code, facts.reason);
      if (facts.status === 'not_found') return candidatesFor(draft.moduleId);
      if (facts.status !== 'ready') return unavailableFacts();
      return { status: 'ok', value: { kind: 'module', moduleId: draft.moduleId }, ended: false };
    }
    case 'interface': {
      const facts = await readCatalogModuleFacts(deps.records, ctx, moduleRefOf(ctx.projectId, draft.moduleId));
      if (facts.status === 'rejected') return passThrough(facts.code, facts.reason);
      if (facts.status === 'not_found') return candidatesFor(`${draft.moduleId}/${draft.interfaceId}`);
      if (facts.status !== 'ready') return unavailableFacts();
      if (!facts.value.module.interfaces.some(entry => entry.id === draft.interfaceId)) {
        return candidatesFor(`${draft.moduleId}/${draft.interfaceId}`);
      }
      return { status: 'ok', value: { kind: 'interface', moduleId: draft.moduleId, interfaceId: draft.interfaceId }, ended: false };
    }
    case 'file': {
      const path = normalizePath(draft.path);
      const anchor: Extract<NoteAnchorV1, { kind: 'file' }> = { kind: 'file', path,
        ...(draft.deleted === true ? { deleted: true as const } : {}) };
      const problem = await checkFileAnchor(ctx, anchor, context.facts, deps, field);
      if (problem !== null) return problem;
      // Item 14/L14: resolution runs after the class-2 existence check. The
      // symbolRequest is write-only; only the resolved locator is stored.
      if (draft.symbolRequest !== undefined) {
        const resolution = await resolveSymbol(ctx, path, draft.symbolRequest, deps.workspace, context.symbolHitsMax);
        if (resolution.status === 'rejected') {
          return { status: 'rejected', code: resolution.code, reason: resolution.reason, field };
        }
        if (resolution.status === 'ambiguous') {
          return { status: 'rejected', code: 'invalid', reason: 'symbol_ambiguous', field,
            symbolCandidates: resolution.candidates };
        }
        if (resolution.status === 'resolved') anchor.symbol = resolution.symbol;
        else return { status: 'ok', value: anchor, ended: false, symbolUnresolved: true };
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
  facts: readonly NoteFactV1[], deps: NoteAnchorFactsDeps, field: string): Promise<NoteAnchorFailure | null> {
  // Item 3 fix 6 / R2: without a workspace the existence is unknown, never admitted.
  if (deps.workspace === undefined) {
    return { status: 'rejected', code: 'unavailable', reason: 'the file anchor cannot be read', field };
  }
  const workspace = deps.workspace;
  const read = await workspace.readWorkspace(ctx, { workspace: { aggregateType: 'Workspace',
    projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, path: anchor.path, maxBytes: 1,
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
    const candidates = await missingFileCandidates(ctx, anchor.path, workspace);
    return { status: 'rejected', code: 'invalid', reason: 'anchor_not_found', field,
      anchorCandidates: candidates.candidates, ...(candidates.unavailable ? { candidatesUnavailable: true } : {}) };
  }
  return { status: 'rejected', code: 'unavailable', reason: 'the file anchor cannot be read', field };
}

// `ModuleDefinition` is re-exported for the scope math to share the same catalog shape.
export type { ModuleDefinition };
