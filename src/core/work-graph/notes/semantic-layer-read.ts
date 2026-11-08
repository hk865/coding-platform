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
import type { LinkEndRequestV1, LinkVerificationV1, NoteHeadSnapshot } from '../../../contracts/note.js';
import type { NoteFlowReadV1, SemanticEndV1, SemanticFlowStepV1, SemanticFlowV1, SemanticLinkV1,
  SemanticPageV1, SemanticScopeV1 } from '../../../contracts/semantic-layer.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { NoteCheckV1, NoteHeadCheckPort } from '../model/note-contracts.js';
import { NOTE_FLOW_CANDIDATE_MAX, NOTE_LINK_VERIFY_MAX } from '../model/note-contracts.js';
import { REQUEST_PAGE_SIZE } from '../model/request-contracts.js';
import type { NoteReadDependencies } from './note-read-model.js';
import type { ReadOutcome } from './note-base-reader.js';
import { S8E_NOTE_BY_KIND_STATE_LOOKUP, decodeNoteHeadSnapshot } from '../persistence/note-record-codecs.js';
import { encodeMemoryCursor, flowCheckOf, parseMemoryCursor, readSemanticCatalog } from './note-read-model.js';
import { anchorSlots, collectModuleFileKeys, headsOnKeyPrefix, interfaceKeysOf, isRelatedHead,
  matchesPathPrefix, moduleRelatedKeys } from './note-related-scope.js';
import { readHeadBatch } from './note-batch-reader.js';
import { endpointIdentityOf, moduleOfFile } from './link-evidence.js';
import { normalizePath } from './note-anchors.js';
import { asOutcome, mapStoreFailure } from './store-failures.js';

export type SemanticReadInput = {
  scope: SemanticScopeV1;
  cursor: string | null;
  limit: number;
};

export type SemanticReadDeps = Pick<NoteReadDependencies, 'records' | 'architecture' | 'mainWorkspaceOf'>
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
  const page = candidates.value.slice(0, input.limit);
  const hasMore = candidates.value.length > input.limit;

  const checked = await deps.check.checkHeads(ctx, {
    items: page.map(head => ({ head, version: head.version })),
  });
  if (checked.status !== 'ready') {
    if (checked.status === 'rejected') return checked;
    return { status: 'rejected', code: 'unavailable', reason: 'the note check is not ready' };
  }
  const items = page.map((head, index) => semanticLinkOf(head, checked.value.items[index]!, catalog));
  const next = hasMore
    ? encodeMemoryCursor(ctx, 'semantic_links', request,
      { after: page[page.length - 1]!.noteId, recordCursor: null })
    : null;
  return { status: 'ready', value: { items, next, catalogRevision } };
}

/**
 * The flow page. Project scope pages the three visible flow states; module/file
 * scope first takes every link head of the scope in ANY state (a superseded or
 * withdrawn step still brings its flow into the range) and keeps the flows
 * whose stored steps cite one of those heads. The flow heads are scanned in
 * `noteId` order, bounded per page; the cursor carries the scan position as
 * well as the last result id.
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
  let results: NoteHeadSnapshot[];
  const scanned = await projectHeads(deps, ctx, scanAfter, cap, FLOW_KIND);
  if (!scanned.ok) return { status: 'rejected', code: scanned.code, reason: scanned.reason };
  const examined = scanned.value;
  if (input.scope.kind === 'project') {
    results = examined;
  } else {
    const links = await scopeHeads(deps, ctx, input.scope, null, Number.POSITIVE_INFINITY, catalog, false);
    if (!links.ok) return { status: 'rejected', code: links.code, reason: links.reason };
    const linkIds = new Set(links.value.map(head => head.noteId));
    results = examined.filter(head => head.flow!.steps.some(step => linkIds.has(step.link)));
  }

  const pageHeads = results.slice(0, input.limit);
  const hasMore = results.length > input.limit;
  const capped = !hasMore && examined.length === cap;

  // One batched read of the page's distinct step heads, then one merged check
  // for the flow heads and those step heads. A missing step head stays absent
  // and expands to `not_current`.
  const stepIds = pageHeads.flatMap(head => head.flow!.steps.map(step => step.link));
  const batch = await readHeadBatch(deps.records, ctx.projectId, stepIds, { requireAll: false });
  if (!batch.ok) {
    const failure = mapStoreFailure(batch);
    return { status: 'rejected', code: failure.code, reason: failure.reason };
  }
  const stepHeads = [...batch.value.values()];
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
  const items = pageHeads.map((head, index) => {
    const check = checked.value.items[index]!;
    const steps = head.flow!.steps.flatMap(step => {
      const found = checkByStep.get(step.link);
      return found === undefined ? [] : [found];
    });
    return semanticFlowOf(head, check, expandFlowForHead(ctx, { flow: head, steps, catalog }));
  });

  let next: string | null = null;
  if (hasMore) {
    const last = pageHeads[pageHeads.length - 1]!.noteId;
    next = encodeMemoryCursor(ctx, 'semantic_flows', request, { after: last, recordCursor: last });
  } else if (capped && examined.length > 0) {
    next = encodeMemoryCursor(ctx, 'semantic_flows', request, {
      after: pageHeads.length === 0 ? null : pageHeads[pageHeads.length - 1]!.noteId,
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

/**
 * The scope's candidate heads: `link` only, the three visible states, sorted by
 * `noteId`, deduplicated, after the cursor. A failed read is returned as is.
 */
async function scopeHeads(deps: SemanticReadDeps, ctx: CoreCallContext, scope: SemanticScopeV1,
  after: string | null, cap: number, catalog: AdoptedArchitecture | null,
  visibleOnly = true): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  if (scope.kind === 'project') return projectHeads(deps, ctx, after, cap);
  if (scope.kind === 'file') {
    const path = normalizePath(scope.path);
    const key = `file:${path}`;
    return keyHeads(deps, ctx, [key], [path], after, cap, visibleOnly);
  }
  const keySet = await moduleKeys(deps, ctx, scope.moduleId, catalog);
  if (!keySet.ok) return keySet;
  return keyHeads(deps, ctx, [...keySet.value.keys], keySet.value.paths, after, cap, visibleOnly);
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
 * §3.8.3: the ordered anchor-path indexes page on a string prefix, so the page
 * keeps only heads whose exact key is in the scope and whose file slots pass
 * the scope's path boundary. A flow range also keeps superseded or withdrawn
 * link heads (`visibleOnly: false`): a step that is no longer current still
 * belongs to the range.
 */
async function keyHeads(deps: SemanticReadDeps, ctx: CoreCallContext, keys: readonly string[],
  pathPrefixes: readonly string[], after: string | null, cap: number,
  visibleOnly = true): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  const keySet = new Set(keys);
  const seen = new Map<string, NoteHeadSnapshot>();
  for (const key of keys) {
    const read = await headsOnKeyPrefix(deps.records, ctx.projectId, key);
    if (!read.ok) return read;
    for (const head of read.value) {
      if (!isRelatedHead(head, keySet)) continue;
      if (!pathBoundaryAccepts(head, keySet, pathPrefixes)) continue;
      keepVisible(seen, head, after, LINK_KIND, visibleOnly);
    }
  }
  return { ok: true, value: sortHeadsByNoteId(seen).slice(0, cap) };
}

async function moduleKeys(deps: SemanticReadDeps, ctx: CoreCallContext, moduleId: string,
  catalog: AdoptedArchitecture | null): Promise<ReadOutcome<{ keys: string[]; paths: string[] }>> {
  const module = catalog === null ? undefined
    : catalog.modules.find(candidate => candidate.ref.moduleId === moduleId);
  let files: string[] = [];
  if (catalog !== null && module !== undefined) {
    const read = await collectModuleFileKeys({ records: deps.records,
      ...(deps.mainWorkspaceOf === undefined ? {} : { mainWorkspaceOf: deps.mainWorkspaceOf }),
      relatedFilesMax: 0 }, ctx, catalog, module);
    if (!read.ok) return read;
    files = read.value;
  }
  const interfaces = module === undefined ? [] : interfaceKeysOf(moduleId, module);
  // The semantic module scope is the module, its interfaces and its files; the
  // `project` key belongs to general kinds only. The shared builder keeps its
  // current behaviour for the old `find` read.
  const keys = moduleRelatedKeys({ moduleId, interfaces, files }).filter(key => key !== 'project');
  const paths = module === undefined ? [] : module.paths.map(prefix => prefix.endsWith('/') ? prefix.slice(0, -1) : prefix)
    .filter(prefix => prefix.length > 0);
  return { ok: true, value: { keys, paths } };
}

function pathBoundaryAccepts(head: NoteHeadSnapshot, keySet: ReadonlySet<string>,
  pathPrefixes: readonly string[]): boolean {
  for (const slot of anchorSlots(head)) {
    if (!slot.startsWith('file:') || !keySet.has(slot)) continue;
    if (!pathPrefixes.some(prefix => prefix === '.' || matchesPathPrefix(slot, prefix))) return false;
  }
  return true;
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
 * step head is `not_current` and keeps no item; the other problems keep the
 * item. `gapsAfter` compares step i's "to" with step i+1's "from" by endpoint
 * identity, 1-based, as a hint only.
 */
export function expandFlowForHead(
  ctx: CoreCallContext,
  input: {
    flow: NoteHeadSnapshot;
    steps: readonly { head: NoteHeadSnapshot; check: NoteCheckV1 }[];
    catalog: AdoptedArchitecture | null;
  },
): NoteFlowReadV1 {
  const byId = new Map(input.steps.map(step => [step.head.noteId, step]));
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
