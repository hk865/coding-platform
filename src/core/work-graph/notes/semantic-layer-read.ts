/**
 * Slice 8E L9: the semantic layer's read side. It answers two pages over the
 * same heads: `readSemanticLinks` and `readSemanticFlows`. A flow's steps are
 * the stored `link` note ids, so a page of flows is read through one head batch
 * and one merged check; the step expansion never opens a capture or builds a
 * TypeScript program.
 *
 * A page is read once from the scope's candidate heads, checked once through
 * the note check (so freshness, per-slot anchor statuses and the link
 * verification share one budget), and mapped with the stored payload. A failed
 * catalog/records/check read is never flattened into an empty page.
 *
 * `checkSemanticLinks` is the person's re-check of a few named notes: the same
 * note check with the second tier asked, answered as each item's read-time
 * link verification.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { LinkEndRequestV1, LinkVerificationV1, NoteAnchorV1, NoteHeadSnapshot } from '../../../contracts/note.js';
import type { NoteFlowReadV1, SemanticEndV1, SemanticFlowStepV1, SemanticFlowV1, SemanticLinkV1,
  SemanticPageV1, SemanticScopeV1 } from '../../../contracts/semantic-layer.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { NoteAnchorCheckV1, NoteCheckV1, NoteHeadCheckPort } from '../model/note-contracts.js';
import { NOTE_FLOW_CANDIDATE_MAX, NOTE_LINK_VERIFY_MAX } from '../model/note-contracts.js';
import { REQUEST_PAGE_SIZE } from '../model/request-contracts.js';
import type { NoteReadDependencies } from './note-read-model.js';
import type { ReadOutcome } from './note-base-reader.js';
import { S8E_NOTE_BY_KIND_STATE_LOOKUP, decodeNoteHeadSnapshot } from '../persistence/note-record-codecs.js';
import { encodeMemoryCursor, flowCheckOf, parseMemoryCursor, readSemanticCatalog } from './note-read-model.js';
import { interfaceKeysOf, mainWorkspaceOutcomeOf } from './note-related-scope.js';
import { moduleOfAnchor } from './scribe-scope.js';
import { readHeadBatch } from './note-batch-reader.js';
import { endpointIdentityOf, moduleOfFile } from './link-evidence.js';
import { normalizePath } from './note-anchors.js';
import { asOutcome, mapStoreFailure } from './store-failures.js';
import type { KnowledgeEdgeKind } from '../../record-store/knowledge-index-ports.js';
import { indexedFilesOn, indexedNoteIds, overlayFileKnowledge, type HeadlessNote } from './note-knowledge.js';
import type { LineKnowledge } from '../model/line-knowledge.js';

export type SemanticReadInput = {
  scope: SemanticScopeV1;
  cursor: string | null;
  limit: number;
};

export type SemanticReadDeps = Pick<NoteReadDependencies, 'records' | 'knowledge' | 'architecture' | 'mainWorkspaceOf'>
  & { check: NoteHeadCheckPort; flowCandidateMax?: number };

/** One item's read-time link verification, in the order asked; `null` when the note is not a link. */
type SemanticLinkChecks = { items: { noteId: string; version: number; verification: LinkVerificationV1 | null }[] };

export type SemanticLinksReader = {
  readSemanticLinks(ctx: CoreCallContext, input: SemanticReadInput):
    Promise<ReadResult<SemanticPageV1<SemanticLinkV1>>>;
  readSemanticFlows(ctx: CoreCallContext, input: SemanticReadInput):
    Promise<ReadResult<SemanticPageV1<SemanticFlowV1>>>;
  checkSemanticLinks(ctx: CoreCallContext, input: { items: { noteId: string; version: number }[] }):
    Promise<ReadResult<SemanticLinkChecks>>;
};

export function createSemanticLayerRead(deps: SemanticReadDeps): SemanticLinksReader {
  return {
    readSemanticLinks(ctx, input) {
      return readLinks(deps, ctx, input);
    },
    readSemanticFlows(ctx, input) {
      return readFlows(deps, ctx, input);
    },
    checkSemanticLinks(ctx, input) {
      return checkLinks(deps, ctx, input);
    },
  };
}

/** The three states the Host route reads, across goals. */
const VISIBLE_STATES: readonly NoteHeadSnapshot['state'][] = ['accepted', 'reviewed', 'pending_review'];
const LINK_KIND = 'link';
const FLOW_KIND = 'flow';
const LIMIT_MAX = 100;
const FLOW_LIMIT_MAX = 50;
const SCOPE_REASON = 'scope must be a project, a module or a file';

/**
 * The wire scope is a union the type checker cannot enforce on an HTTP body: a
 * project takes no other key, a module needs a non-empty module id and a file a
 * non-empty path. Extra keys are not rejected.
 */
function badScope(scope: unknown): boolean {
  if (!isRecord(scope)) return true;
  if (scope['kind'] === 'project') return false;
  if (scope['kind'] === 'module') return !nonEmpty(scope['moduleId']);
  if (scope['kind'] === 'file') return !nonEmpty(scope['path']);
  return true;
}

async function readLinks(
  deps: SemanticReadDeps,
  ctx: CoreCallContext,
  input: SemanticReadInput,
): Promise<ReadResult<SemanticPageV1<SemanticLinkV1>>> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > LIMIT_MAX) {
    return { status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' };
  }
  if (badScope(input.scope)) return { status: 'rejected', code: 'invalid', reason: SCOPE_REASON };
  const request = { scope: input.scope, kind: 'links', limit: input.limit };
  const cursor = parseMemoryCursor(ctx, input.cursor, 'semantic_links', request);
  if (!cursor.ok) return { status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' };
  const after = cursor.value.after;

  // L7: one catalog read for the page; an absent catalog is `null`, any other
  // failed read is `unavailable`, never an empty catalog.
  const catalogRead = await readSemanticCatalog(deps.architecture, ctx);
  if (!catalogRead.ok) return { status: 'rejected', code: catalogRead.code, reason: catalogRead.reason };
  const { catalog, revision: catalogRevision } = catalogRead.value;

  const candidates = await scopeHeads(deps, ctx, input.scope, after, input.limit + 1, catalog);
  if (!candidates.ok) return { status: 'rejected', code: candidates.code, reason: candidates.reason };
  // [2B-16]: the scope's filed links with no record head merge in by noteId; only their anchors are checked.
  const merged = mergedById(candidates.value);
  const hasMore = merged.length > input.limit;
  const filed = await pageFiles(deps, ctx, merged.slice(0, input.limit), LINK_KIND);
  if (!filed.ok) return { status: 'rejected', code: filed.code, reason: filed.reason };
  const page = filed.value;
  const heads = page.filter(isHeadEntry);
  const headless = page.filter((entry): entry is HeadlessNote => !isHeadEntry(entry));

  const checked = await deps.check.checkHeads(ctx, {
    items: heads.map(head => ({ head, version: head.version })),
    anchorsOnly: headless.map(({ note }) => ({ anchor: note.knowledge.anchor, extraAnchors: note.knowledge.extraAnchors })),
  });
  if (checked.status !== 'ready') {
    if (checked.status === 'rejected') return checked;
    return { status: 'rejected', code: 'unavailable', reason: 'the note check is not ready' };
  }
  const checks = new Map(heads.map((head, index) => [head.noteId, checked.value.items[index]!]));
  const anchorChecks = new Map(headless.map((entry, index) => [entry.note.noteId, checked.value.anchorsOnly[index]!]));
  const items = page.map(entry => isHeadEntry(entry) ? semanticLinkOf(entry, checks.get(entry.noteId)!, catalog)
    : headlessLinkOf(entry, anchorChecks.get(entry.note.noteId)!, catalog));
  const next = hasMore
    ? encodeMemoryCursor(ctx, 'semantic_links', request,
      { after: merged[input.limit - 1]!.noteId, recordCursor: null })
    : null;
  return { status: 'ready', value: { items, next, catalogRevision } };
}

/**
 * The flow page. Project scope pages the three visible flow states; module/file
 * scope first takes every link head of the scope in ANY state (a superseded or
 * withdrawn step still brings its flow into the range) and keeps the flows
 * whose files' steps cite one of them (each line's `flow_step` edges). The flow
 * heads are scanned in `noteId` order, bounded per page; the cursor carries the
 * scan position as well as the last result id. The page's flows and their step
 * links show their files' knowledge.
 */
async function readFlows(
  deps: SemanticReadDeps,
  ctx: CoreCallContext,
  input: SemanticReadInput,
): Promise<ReadResult<SemanticPageV1<SemanticFlowV1>>> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > FLOW_LIMIT_MAX) {
    return { status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' };
  }
  if (badScope(input.scope)) return { status: 'rejected', code: 'invalid', reason: SCOPE_REASON };
  const request = { scope: input.scope, kind: 'flows', limit: input.limit };
  const cursor = parseMemoryCursor(ctx, input.cursor, 'semantic_flows', request);
  if (!cursor.ok) return { status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' };
  const scanAfter = cursor.value.recordCursor ?? cursor.value.after;

  const catalogRead = await readSemanticCatalog(deps.architecture, ctx);
  if (!catalogRead.ok) return { status: 'rejected', code: catalogRead.code, reason: catalogRead.reason };
  const { catalog, revision: catalogRevision } = catalogRead.value;

  const flowCandidateMax = deps.flowCandidateMax ?? NOTE_FLOW_CANDIDATE_MAX;
  const cap = input.scope.kind === 'project'
    ? Math.min(input.limit + 1, flowCandidateMax) : flowCandidateMax;
  const scanned = await projectHeads(deps, ctx, scanAfter, cap, FLOW_KIND);
  if (!scanned.ok) return { status: 'rejected', code: scanned.code, reason: scanned.reason };
  const examined = scanned.value;
  let scopeLinks: string[] | null = null;
  // A module or file scope reads its link records; a step among them is not read again.
  let scopeLinkHeads = new Map<string, NoteHeadSnapshot>();
  if (input.scope.kind !== 'project') {
    const links = await scopeHeads(deps, ctx, input.scope, null, Number.POSITIVE_INFINITY, catalog, false);
    if (!links.ok) return { status: 'rejected', code: links.code, reason: links.reason };
    scopeLinks = mergedById(links.value).map(entry => entry.noteId);
    scopeLinkHeads = new Map(links.value.heads.map(head => [head.noteId, head]));
  }
  // [2B-16]: the flows with no record head, from each line's `flow_step` edges (to a scope link, or any in the
  // project) within the range this page scanned, merge in by noteId; they are never checked.
  const edges = await edgeNotes(deps, ctx, 'flow_step', scopeLinks, scanAfter, boundOf(examined, cap), examined);
  if (!edges.ok) return { status: 'rejected', code: edges.code, reason: edges.reason };
  const results = scopeLinks === null ? examined : examined.filter(head => edges.value.listed.has(head.noteId));
  const merged = mergedById({ heads: results, headless: edges.value.headless });

  const hasMore = merged.length > input.limit;
  const capped = !hasMore && examined.length === cap;
  const slice = merged.slice(0, input.limit);
  const filed = await pageFiles(deps, ctx, slice, FLOW_KIND);
  if (!filed.ok) return { status: 'rejected', code: filed.code, reason: filed.reason };
  const page = filed.value;
  const pageHeads = page.filter(isHeadEntry);
  const stepsOf = (entry: FiledEntry): { link: string }[] => (isHeadEntry(entry) ? entry.flow : entry.note.knowledge.flow)!.steps;

  // One batched read of the page's distinct step heads the scope read did not already read, their files' knowledge,
  // then one merged check for the flow heads and those step heads. A missing step head stays absent and expands to
  // `not_current`.
  const stepIds = [...new Set(page.flatMap(entry => stepsOf(entry).map(step => step.link)))];
  const batch = await readHeadBatch(deps.records, ctx.projectId, stepIds.filter(noteId => !scopeLinkHeads.has(noteId)),
    { requireAll: false });
  if (!batch.ok) {
    const failure = mapStoreFailure(batch);
    return { status: 'rejected', code: failure.code, reason: failure.reason };
  }
  const steps = await overlayFileKnowledge(stepIds.flatMap(noteId => {
    const head = scopeLinkHeads.get(noteId) ?? batch.value.get(noteId);
    return head === undefined ? [] : [head];
  }), { lines: deps.knowledge, caller: ctx });
  if (steps.status !== 'ready') return mapStoreFailure(steps);
  const stepHeads = steps.value;
  const checked = await deps.check.checkHeads(ctx, {
    items: [...pageHeads, ...stepHeads].map(head => ({ head, version: head.version })),
  });
  if (checked.status !== 'ready') {
    if (checked.status === 'rejected') return checked;
    return { status: 'rejected', code: 'unavailable', reason: 'the note check is not ready' };
  }

  const checkByStep = new Map<string, { head: NoteHeadSnapshot; check: NoteCheckV1 }>();
  stepHeads.forEach((head, index) => {
    checkByStep.set(head.noteId, { head, check: checked.value.items[pageHeads.length + index]! });
  });
  const checkOfFlow = new Map(pageHeads.map((head, index) => [head.noteId, checked.value.items[index]!]));
  const items = page.map(entry => {
    const steps = stepsOf(entry).flatMap(step => {
      const found = checkByStep.get(step.link);
      return found === undefined ? [] : [found];
    });
    const expanded = expandFlowForHead(ctx, { flow: isHeadEntry(entry) ? entry : entry.note.knowledge, steps, catalog });
    return isHeadEntry(entry) ? semanticFlowOf(entry, checkOfFlow.get(entry.noteId)!, expanded)
      : headlessFlowOf(entry, expanded);
  });

  let next: string | null = null;
  if (hasMore) {
    const last = merged[input.limit - 1]!.noteId;
    next = encodeMemoryCursor(ctx, 'semantic_flows', request, { after: last, recordCursor: last });
  } else if (capped && examined.length > 0) {
    next = encodeMemoryCursor(ctx, 'semantic_flows', request, {
      after: slice.length === 0 ? null : slice[slice.length - 1]!.noteId,
      recordCursor: examined[examined.length - 1]!.noteId,
    });
  }
  return { status: 'ready', value: { items, next, catalogRevision } };
}

/**
 * The person's re-check: one note check with the second tier asked at the
 * button's priority. The HTTP body is not type-checked, so anything but 1 to
 * `NOTE_LINK_VERIFY_MAX` entries is `invalid` before the check runs. A check
 * that is not ready (an unknown note id answers `not_found`) is returned as is.
 */
async function checkLinks(
  deps: SemanticReadDeps,
  ctx: CoreCallContext,
  input: { items: { noteId: string; version: number }[] },
): Promise<ReadResult<SemanticLinkChecks>> {
  const items = input?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > NOTE_LINK_VERIFY_MAX) {
    return { status: 'rejected', code: 'invalid', reason: `items must hold 1 to ${NOTE_LINK_VERIFY_MAX} entries` };
  }
  const checked = await deps.check.checkNotes(ctx, { items, verifyLinks: { priority: 'button' } });
  if (checked.status !== 'ready') return checked;
  return { status: 'ready', value: linkChecksOf(checked.value) };
}

/** The re-check answer from the check's rows: the read-time verification, `null` for a note that is not a link. */
export function linkChecksOf(rows: readonly NoteCheckV1[]): SemanticLinkChecks {
  return {
    items: rows.map(row => ({ noteId: row.noteId, version: row.version, verification: row.linkVerification ?? null })),
  };
}

/** [2B-16]: a filed note with no record head, as the index lists it: its line; the page reads its file. */
type HeadlessEntry = { line: LineKnowledge; noteId: string };
/** The heads a scope reads and, beside them, its filed notes with no record head ([2B-16]). */
type ScopeNotes = { heads: NoteHeadSnapshot[]; headless: HeadlessEntry[] };
type ScopeEntry = NoteHeadSnapshot | HeadlessEntry;
/** A page entry with the file it shows. */
type FiledEntry = NoteHeadSnapshot | HeadlessNote;
const isHeadEntry = (entry: ScopeEntry | FiledEntry): entry is NoteHeadSnapshot => !('line' in entry);

/** Both kinds of entry, by noteId. */
function mergedById(notes: ScopeNotes): ScopeEntry[] {
  return [...notes.heads, ...notes.headless]
    .sort((left, right) => left.noteId < right.noteId ? -1 : left.noteId > right.noteId ? 1 : 0);
}

/** The last id a page scan can reach: the cap-th head's when the scan stopped at its cap, else none. */
function boundOf(heads: readonly NoteHeadSnapshot[], cap: number): string | null {
  return heads.length === cap ? heads[heads.length - 1]!.noteId : null;
}

/**
 * The page's entries with the files they show, and nothing past the page read: the heads take their files'
 * knowledge ([2B-18]), the filed notes with no record head are read from their lines ([2B-17] for a file gone since
 * it was indexed). A head whose file now names another kind than the page's is left out.
 */
async function pageFiles(deps: SemanticReadDeps, ctx: CoreCallContext, page: readonly ScopeEntry[],
  kind: NoteHeadSnapshot['kind']): Promise<ReadOutcome<FiledEntry[]>> {
  const read = await overlayFileKnowledge(page.filter(isHeadEntry), { lines: deps.knowledge, caller: ctx });
  if (read.status !== 'ready') return asOutcome(read);
  const overlaid = new Map(read.value.map(head => [head.noteId, head]));
  const headless = page.filter((entry): entry is HeadlessEntry => !isHeadEntry(entry));
  const files = new Map<string, HeadlessNote>();
  for (const line of new Set(headless.map(entry => entry.line))) {
    const notes = await indexedFilesOn(line, headless.filter(entry => entry.line === line).map(entry => entry.noteId));
    if (notes.status !== 'ready') return asOutcome(notes);
    for (const note of notes.value) files.set(note.noteId, { line, note });
  }
  return { ok: true, value: page.flatMap((entry): FiledEntry[] => {
    if (!isHeadEntry(entry)) return [files.get(entry.noteId)!];
    const head = overlaid.get(entry.noteId)!;
    return head.kind === kind ? [head] : [];
  }) };
}

/**
 * The scope's candidate heads: `link` only, the three visible states, sorted by
 * `noteId`, deduplicated, after the cursor; and its filed links with no record
 * head after the cursor (the project's from each line's `link_from` edges, a
 * module's or file's from its anchor keys). No note file is read. A failed read
 * is returned as is.
 */
async function scopeHeads(deps: SemanticReadDeps, ctx: CoreCallContext, scope: SemanticScopeV1,
  after: string | null, cap: number, catalog: AdoptedArchitecture | null,
  visibleOnly = true): Promise<ReadOutcome<ScopeNotes>> {
  if (scope.kind === 'project') {
    const heads = await projectHeads(deps, ctx, after, cap);
    if (!heads.ok) return heads;
    const edges = await edgeNotes(deps, ctx, 'link_from', null, after, boundOf(heads.value, cap), heads.value);
    return edges.ok ? { ok: true, value: { heads: heads.value, headless: edges.value.headless } } : edges;
  }
  return keyNotes(deps, ctx, scope, catalog, after, cap, visibleOnly);
}

/**
 * [2B-16]: the notes a `kind` edge lists on each line (to one of `toRefs`, or any) after the cursor and up to the
 * page's bound, and among them the ones with no record head: one batched record read of the ids the scanned `heads`
 * do not already answer. No file is read here; the page reads its own.
 */
async function edgeNotes(deps: SemanticReadDeps, ctx: CoreCallContext, kind: KnowledgeEdgeKind,
  toRefs: readonly string[] | null, after: string | null, bound: string | null, heads: readonly NoteHeadSnapshot[]):
Promise<ReadOutcome<{ listed: ReadonlySet<string>; headless: HeadlessEntry[] }>> {
  const read = await indexedNoteIds({ lines: deps.knowledge, caller: ctx }, (index, lineRef) => index
    .noteIdsByEdge(lineRef, kind, toRefs).filter(noteId => (after === null || noteId > after) && (bound === null || noteId <= bound)));
  if (read.status !== 'ready') return asOutcome(read);
  const known = new Set(heads.map(head => head.noteId));
  const listed = read.value.flatMap(({ line, ids }) => ids.map(noteId => ({ line, noteId })));
  const unknown = listed.filter(entry => !known.has(entry.noteId));
  const batch = await readHeadBatch(deps.records, ctx.projectId, unknown.map(entry => entry.noteId), { requireAll: false });
  if (!batch.ok) {
    const failure = mapStoreFailure(batch);
    return { ok: false, code: failure.code, reason: failure.reason };
  }
  return { ok: true, value: { listed: new Set(listed.map(entry => entry.noteId)),
    headless: unknown.filter(entry => !batch.value.has(entry.noteId)) } };
}

async function projectHeads(deps: SemanticReadDeps, ctx: CoreCallContext, after: string | null,
  cap: number, kind: NoteHeadSnapshot['kind'] = LINK_KIND): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  const seen = new Map<string, NoteHeadSnapshot>();
  for (const state of VISIBLE_STATES) {
    // The ordered lookup pages at most 200 records, so the per-state read pages
    // to `cap`; the flow candidate bound (500) is larger than one page.
    let bound: { value: string; inclusive: boolean } | undefined =
      after === null ? undefined : { value: after, inclusive: false };
    let taken = 0;
    while (taken < cap) {
      const limit = Math.min(cap - taken, REQUEST_PAGE_SIZE);
      const read = await deps.records.lookupOrdered({
        index: S8E_NOTE_BY_KIND_STATE_LOOKUP,
        values: [ctx.projectId, kind, state],
        direction: 'asc',
        ...(bound === undefined ? {} : { bound }),
        limit,
      });
      if (read.status !== 'ready') return asOutcome(read);
      let lastId: string | undefined;
      for (const record of read.value.records) {
        const decoded = decodeNoteHeadSnapshot(record);
        if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note head' };
        keepVisible(seen, decoded.value, after, kind);
        lastId = decoded.value.noteId;
      }
      taken += read.value.records.length;
      if (read.value.next === null) break;
      bound = { value: lastId!, inclusive: false };
    }
  }
  return { ok: true, value: sortHeadsByNoteId(seen).slice(0, cap) };
}

/**
 * §3.8.3, [2B-14]: a module or file scope's link notes, listed by each line's index without reading a note file:
 * the notes with an exact scope key in their anchors (the module's own key and its interfaces', or the file's), and
 * for a module the notes with a file anchor the module owns (the single longest catalog owner, the rule
 * `collectModuleFileKeys` applies); a link is a note with a `link_from` edge. After the cursor, one batched record
 * read tells the ones with a record head (the three visible states; a flow range, `visibleOnly: false`, keeps a step
 * that is no longer current) from the ones without, bounded by the cap as `edgeNotes` is.
 */
async function keyNotes(deps: SemanticReadDeps, ctx: CoreCallContext, scope: Exclude<SemanticScopeV1, { kind: 'project' }>,
  catalog: AdoptedArchitecture | null, after: string | null, cap: number, visibleOnly: boolean): Promise<ReadOutcome<ScopeNotes>> {
  const keys: string[] = [];
  const ownedPrefixes: string[] = [];
  let owns = (_key: string): boolean => false;
  if (scope.kind === 'file') keys.push(`file:${normalizePath(scope.path)}`);
  else {
    keys.push(`module:${scope.moduleId}`);
    const module = catalog === null ? undefined : catalog.modules.find(candidate => candidate.ref.moduleId === scope.moduleId);
    if (catalog !== null && module !== undefined) {
      keys.push(...interfaceKeysOf(scope.moduleId, module));
      const main = await mainWorkspaceOutcomeOf(deps, ctx.projectId);
      if (!main.ok) return main;
      owns = key => moduleOfAnchor(catalog, { kind: 'file', path: key.slice('file:'.length) } as NoteAnchorV1, main.value)
        === scope.moduleId;
      for (const prefix of module.paths) {
        const stripped = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
        // The root `.` owns every file no concrete prefix claims: its candidates are every file anchor.
        if (stripped.length > 0) ownedPrefixes.push(stripped === '.' ? 'file:' : `file:${stripped}`);
      }
    }
  }
  const read = await indexedNoteIds({ lines: deps.knowledge, caller: ctx }, (index, lineRef) => {
    const ids = new Set(keys.flatMap(key => index.noteIdsByAnchor(lineRef, key)));
    for (const prefix of ownedPrefixes) {
      for (const row of index.noteAnchorsByPrefix(lineRef, prefix)) if (owns(row.anchorKey)) ids.add(row.noteId);
    }
    const links = new Set(index.noteIdsByEdge(lineRef, 'link_from', null));
    return [...ids].filter(noteId => links.has(noteId) && (after === null || noteId > after));
  });
  if (read.status !== 'ready') return asOutcome(read);
  const listed = read.value.flatMap(({ line, ids }) => ids.map(noteId => ({ line, noteId })));
  const batch = await readHeadBatch(deps.records, ctx.projectId, listed.map(entry => entry.noteId), { requireAll: false });
  if (!batch.ok) {
    const failure = mapStoreFailure(batch);
    return { ok: false, code: failure.code, reason: failure.reason };
  }
  const seen = new Map<string, NoteHeadSnapshot>();
  for (const head of batch.value.values()) keepVisible(seen, head, after, LINK_KIND, visibleOnly);
  const heads = sortHeadsByNoteId(seen).slice(0, cap);
  const bound = boundOf(heads, cap);
  return { ok: true, value: { heads, headless: listed.filter(entry => !batch.value.has(entry.noteId)
    && (bound === null || entry.noteId <= bound)) } };
}

function keepVisible(seen: Map<string, NoteHeadSnapshot>, head: NoteHeadSnapshot, after: string | null,
  kind: NoteHeadSnapshot['kind'] = LINK_KIND, visibleOnly = true): void {
  if (head.kind !== kind) return;
  if (visibleOnly && !VISIBLE_STATES.includes(head.state)) return;
  if (after !== null && head.noteId <= after) return;
  if (!seen.has(head.noteId)) seen.set(head.noteId, head);
}

function sortHeadsByNoteId(seen: ReadonlyMap<string, NoteHeadSnapshot>): NoteHeadSnapshot[] {
  return [...seen.values()].sort((left, right) => left.noteId < right.noteId ? -1 : left.noteId > right.noteId ? 1 : 0);
}

function anchorsOf(head: NoteHeadSnapshot, index: number): NoteHeadSnapshot['anchor'] {
  return index === 0 ? head.anchor : head.extraAnchors[index - 1]!;
}

function endOf(request: LinkEndRequestV1, anchor: NoteHeadSnapshot['anchor'],
  catalog: AdoptedArchitecture | null, slot: NoteCheckV1['anchorSlots'][number]): SemanticEndV1 {
  const ownership = request.kind === 'file'
    ? moduleOfFile(request.path, catalog)
    : { moduleId: request.moduleId, unresolved: null as null };
  return {
    anchor,
    request,
    moduleId: ownership.moduleId,
    unresolved: ownership.unresolved,
    anchorStatus: slot.status,
    anchorRetiredReasons: slot.reasons,
  };
}

function semanticLinkOf(head: NoteHeadSnapshot, check: NoteCheckV1,
  catalog: AdoptedArchitecture | null): SemanticLinkV1 {
  const link = head.link!;
  const slots = check.anchorSlots;
  return {
    noteId: head.noteId,
    version: head.version,
    state: head.state as SemanticLinkV1['state'],
    relation: link.relation,
    from: endOf(link.ends.from, anchorsOf(head, 0), catalog, slots[0]!),
    to: endOf(link.ends.to, anchorsOf(head, 1), catalog, slots[1]!),
    via: link.ends.via === null ? null : endOf(link.ends.via, anchorsOf(head, 2), catalog, slots[2]!),
    key: link.key ?? null,
    evidence: link.evidence.map(({ role, at }) => ({ role, at })),
    verification: check.linkVerification ?? link.verification,
    currentEligible: check.currentEligible,
    topic: head.topic,
    conclusion: head.conclusion,
    source: head.source,
    goalId: head.goalId,
    confirmedByUser: head.confirmedByUser,
    freshness: check.freshness,
  };
}

/** [2B-16]: a filed link with no record head: no version or state, its ends' anchors checked, unchecked and never current. */
function headlessLinkOf({ note }: HeadlessNote, anchorCheck: NoteAnchorCheckV1, catalog: AdoptedArchitecture | null): SemanticLinkV1 {
  const knowledge = note.knowledge;
  const link = knowledge.link!;
  const anchors = [knowledge.anchor, ...knowledge.extraAnchors] as NoteHeadSnapshot['anchor'][];
  const slots = anchorCheck.anchorSlots;
  return {
    noteId: note.noteId, version: null, state: null, relation: link.relation,
    from: endOf(link.ends.from, anchors[0]!, catalog, slots[0]!),
    to: endOf(link.ends.to, anchors[1]!, catalog, slots[1]!),
    via: link.ends.via === null ? null : endOf(link.ends.via, anchors[2]!, catalog, slots[2]!),
    key: link.key, evidence: link.evidence.map(({ role, at }) => ({ role, at })),
    verification: { status: 'unchecked', reason: 'unavailable' }, currentEligible: false,
    topic: knowledge.topic, conclusion: knowledge.conclusion, source: knowledge.source, goalId: null,
    confirmedByUser: false, freshness: 'unchecked',
  };
}

/** Each step's problem is the first of the five values. */
function problemOf(head: NoteHeadSnapshot, check: NoteCheckV1): SemanticFlowStepV1['problem'] {
  if (head.state !== 'accepted' && head.state !== 'reviewed') return 'not_current';
  if (check.linkVerification?.status === 'broken') return 'broken';
  if (check.freshness === 'stale'
    || check.anchorSlots.some(slot => slot.status === 'retired')
    || check.conflicting
    || check.sourceUnavailable) return 'stale';
  if (check.freshness === 'unchecked' || check.linkVerification?.status === 'unchecked') return 'unchecked';
  return null;
}

/**
 * Expand one flow over the step heads and checks read with its page. A missing
 * step head, or one whose file is no longer a link, is `not_current` and keeps
 * no item; the other problems keep the item. `gapsAfter` compares step i's "to"
 * with step i+1's "from" by endpoint identity, 1-based, as a hint only.
 */
export function expandFlowForHead(
  ctx: CoreCallContext,
  input: {
    flow: Pick<NoteHeadSnapshot, 'flow'>;
    steps: readonly { head: NoteHeadSnapshot; check: NoteCheckV1 }[];
    catalog: AdoptedArchitecture | null;
  },
): NoteFlowReadV1 {
  const byId = new Map(input.steps.filter(step => step.head.kind === LINK_KIND).map(step => [step.head.noteId, step]));
  const stored = input.flow.flow!.steps;
  const steps: SemanticFlowStepV1[] = stored.map(step => {
    const found = byId.get(step.link);
    if (found === undefined) return { link: step.link, item: null, problem: 'not_current' };
    const item = semanticLinkOf(found.head, found.check, input.catalog);
    const problem = problemOf(found.head, found.check);
    return { link: step.link, item: problem === 'not_current' ? null : item, problem };
  });
  const gapsAfter: number[] = [];
  for (let index = 0; index + 1 < stored.length; index += 1) {
    const left = byId.get(stored[index]!.link);
    const right = byId.get(stored[index + 1]!.link);
    if (left === undefined || right === undefined) continue;
    const to = left.head.link!.ends.to;
    const from = right.head.link!.ends.from;
    if (endpointIdentityOf(to) !== endpointIdentityOf(from)) gapsAfter.push(index + 1);
  }
  return { steps, gapsAfter };
}

/**
 * The flow row's freshness combines its own check with its steps' problems and
 * its `currentEligible` is the flow's own condition AND every step's item.
 */
function semanticFlowOf(
  head: NoteHeadSnapshot,
  check: NoteCheckV1,
  expanded: NoteFlowReadV1,
): SemanticFlowV1 {
  const combined = flowCheckOf(check, expanded.steps);
  return {
    noteId: head.noteId,
    version: head.version,
    state: head.state as SemanticFlowV1['state'],
    topic: head.topic,
    conclusion: head.conclusion,
    source: head.source,
    goalId: head.goalId,
    steps: expanded.steps,
    gapsAfter: expanded.gapsAfter,
    currentEligible: combined.currentEligible,
    freshness: combined.freshness,
  };
}

/** [2B-16]: a flow with no record head: its steps expanded the same way, unchecked and never current. */
function headlessFlowOf({ note }: HeadlessNote, expanded: NoteFlowReadV1): SemanticFlowV1 {
  const knowledge = note.knowledge;
  return {
    noteId: note.noteId, version: null, state: null, topic: knowledge.topic, conclusion: knowledge.conclusion,
    source: knowledge.source, goalId: null, steps: expanded.steps, gapsAfter: expanded.gapsAfter,
    currentEligible: false, freshness: 'unchecked',
  };
}
