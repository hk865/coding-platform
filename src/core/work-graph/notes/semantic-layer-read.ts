/**
 * Slice 8E L3: the semantic layer's read side. This run implements only the
 * link read; the flow read belongs to the next run and is not stubbed here.
 *
 * A page is read once from the scope's candidate heads, checked once through
 * the note check (so freshness, per-slot anchor statuses and the link
 * verification share one budget), and mapped with the stored payload. A failed
 * catalog/records/check read is never flattened into an empty page.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { LinkEndRequestV1, NoteHeadSnapshot } from '../../../contracts/note.js';
import type { SemanticEndV1, SemanticLinkV1, SemanticPageV1, SemanticScopeV1 } from '../../../contracts/semantic-layer.js';
import type { NoteCheckV1, NoteHeadCheckPort } from '../model/note-contracts.js';
import type { NoteReadDependencies } from './note-read-model.js';
import type { ReadOutcome } from './note-base-reader.js';
import { S8E_NOTE_BY_KIND_STATE_LOOKUP, decodeNoteHeadSnapshot } from '../persistence/note-record-codecs.js';
import { encodeMemoryCursor, parseMemoryCursor } from './note-read-model.js';
import { anchorSlots, collectModuleFileKeys, headsOnKeyPrefix, interfaceKeysOf, isRelatedHead,
  matchesPathPrefix, moduleRelatedKeys } from './note-related-scope.js';
import { moduleOfFile } from './link-evidence.js';
import { normalizePath } from './note-anchors.js';
import { asOutcome } from './store-failures.js';

export type SemanticReadInput = {
  scope: SemanticScopeV1;
  cursor: string | null;
  limit: number;
};

export type SemanticReadDeps = Pick<NoteReadDependencies, 'records' | 'architecture'>
  & { check: NoteHeadCheckPort };

export type SemanticLinksReader = {
  readSemanticLinks(ctx: CoreCallContext, input: SemanticReadInput):
    Promise<ReadResult<SemanticPageV1<SemanticLinkV1>>>;
};

export function createSemanticLayerRead(deps: SemanticReadDeps): SemanticLinksReader {
  return {
    readSemanticLinks(ctx, input) {
      return readLinks(deps, ctx, input);
    },
  };
}

/** The three states the Host route reads, across goals. */
const VISIBLE_STATES: readonly NoteHeadSnapshot['state'][] = ['accepted', 'reviewed', 'pending_review'];
const LINK_KIND = 'link';
const LIMIT_MAX = 100;

async function readLinks(
  deps: SemanticReadDeps,
  ctx: CoreCallContext,
  input: SemanticReadInput,
): Promise<ReadResult<SemanticPageV1<SemanticLinkV1>>> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > LIMIT_MAX) {
    return { status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' };
  }
  const request = { scope: input.scope, kind: 'links', limit: input.limit };
  const cursor = parseMemoryCursor(ctx, input.cursor, 'semantic_links', request);
  if (!cursor.ok) return { status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' };
  const after = cursor.value.after;

  // L7: one catalog read for the page; an absent catalog is `null`, any other
  // failed read is `unavailable`, never an empty catalog.
  let catalog: AdoptedArchitecture | null = null;
  let catalogRevision: number | null = null;
  if (deps.architecture !== undefined) {
    const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    if (read.status === 'ready') {
      catalog = read.value.catalog.catalog;
      catalogRevision = read.value.baseline.ref.revision;
    } else if (read.status === 'not_found'
      || (read.status === 'rejected' && read.code === 'not_found')) {
      catalog = null;
    } else {
      return { status: 'rejected', code: 'unavailable',
        reason: read.status === 'rejected' ? read.reason : 'the architecture catalog is not ready' };
    }
  }

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
 * The scope's candidate heads: `link` only, the three visible states, sorted by
 * `noteId`, deduplicated, after the cursor. A failed read is returned as is.
 */
async function scopeHeads(deps: SemanticReadDeps, ctx: CoreCallContext, scope: SemanticScopeV1,
  after: string | null, cap: number, catalog: AdoptedArchitecture | null): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  if (scope.kind === 'project') return projectHeads(deps, ctx, after, cap);
  if (scope.kind === 'file') {
    const path = normalizePath(scope.path);
    const key = `file:${path}`;
    return keyHeads(deps, ctx, [key], [path], after, cap);
  }
  const keySet = await moduleKeys(deps, ctx, scope.moduleId, catalog);
  if (!keySet.ok) return keySet;
  return keyHeads(deps, ctx, [...keySet.value.keys], keySet.value.paths, after, cap);
}

async function projectHeads(deps: SemanticReadDeps, ctx: CoreCallContext, after: string | null,
  cap: number): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  const seen = new Map<string, NoteHeadSnapshot>();
  for (const state of VISIBLE_STATES) {
    const read = await deps.records.lookupOrdered({
      index: S8E_NOTE_BY_KIND_STATE_LOOKUP,
      values: [ctx.projectId, LINK_KIND, state],
      direction: 'asc',
      ...(after === null ? {} : { bound: { value: after, inclusive: false } }),
      limit: cap,
    });
    if (read.status !== 'ready') return asOutcome(read);
    for (const record of read.value.records) {
      const decoded = decodeNoteHeadSnapshot(record);
      if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note head' };
      keepVisible(seen, decoded.value, after);
    }
  }
  return { ok: true, value: sortHeadsByNoteId(seen) };
}

/**
 * §3.8.3: the ordered anchor-path indexes page on a string prefix, so the page
 * keeps only heads whose exact key is in the scope and whose file slots pass
 * the scope's path boundary.
 */
async function keyHeads(deps: SemanticReadDeps, ctx: CoreCallContext, keys: readonly string[],
  pathPrefixes: readonly string[], after: string | null, cap: number): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  const keySet = new Set(keys);
  const seen = new Map<string, NoteHeadSnapshot>();
  for (const key of keys) {
    const read = await headsOnKeyPrefix(deps.records, ctx.projectId, key);
    if (!read.ok) return read;
    for (const head of read.value) {
      if (!isRelatedHead(head, keySet)) continue;
      if (!pathBoundaryAccepts(head, keySet, pathPrefixes)) continue;
      keepVisible(seen, head, after);
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
    const read = await collectModuleFileKeys({ records: deps.records, relatedFilesMax: 0 }, ctx, catalog, module);
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

function keepVisible(seen: Map<string, NoteHeadSnapshot>, head: NoteHeadSnapshot, after: string | null): void {
  if (head.kind !== LINK_KIND) return;
  if (!VISIBLE_STATES.includes(head.state)) return;
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
