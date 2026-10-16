/**
 * Slice 4A group G (P1, P6): the scribe scope facts and the per-scope current
 * count (L7). Nothing here is stored: the facts are derived from public reads —
 *   (a) each scribe's scope: a Session of duty `scribe` with an open
 *       `responsible` SessionWorkLink to a `module` (region), or no module link
 *       (project). Archived Sessions have no open links and do not count;
 *   (b) a module's region: the module plus its `containment.parentOf` subtree in
 *       the active catalog, or the module alone when the catalog declares none;
 *   (c) write admission: a region scribe may use module-class anchors inside its
 *       region (deeper regions included); a project scribe may use every anchor;
 *   (d) a note's managing scope: the deepest scope that has a scribe and
 *       contains all anchors of the note and of its `replaces`/`contradicts`
 *       targets; mixed module-class/goal-class anchors or several goals → project.
 *
 * The count (P1) is implemented here and exposed on the `notes` owner: distinct
 * note ids whose stored state is `accepted`/`reviewed` and whose managing scope is
 * exactly the requested scope. A scope with no scribe manages nothing (count 0);
 * its notes count for the scope they go up to.
 *
 * Round 2 item 3: a session/catalog/goal/head/relation read that FAILS is
 * returned, never turned into an empty scope fact set or a smaller count.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { ModuleRef, SessionRef } from '../../../contracts/core/identity.js';
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { NoteAnchorV1, NoteHeadSnapshot, NoteSourceV1 } from '../../../contracts/note.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { SessionCard, SessionDirectoryPort } from '../model/session-contracts.js';
import type { NoteDutyResolver, NoteScopeReadPort, NoteScopeV1 } from '../model/note-contracts.js';
import {
  S4_NOTE_BY_REVIEW_STATUS_LOOKUP, decodeNoteHeadSnapshot, noteHeadRefKey,
} from '../persistence/note-record-codecs.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { readAllHeads, readAllRecords, mapStoreFailure, type ReadFailureCode } from './note-read-model.js';
import { pathOwnershipOf } from './note-path-ownership.js';
import { GOAL_BY_WORKSPACE_INDEX } from '../tasks/plan-readers.js';

export type ScribeScopeDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  duties: NoteDutyResolver;
};

export type ScribeScopeRefusal = { code: 'forbidden' | 'unavailable'; reason: string };

/**
 * Item 1: the per-CALL cache the service creates at every public entry
 * (`writeNote`, `reviewNote`, `withdrawNote`, `countCurrentNotes`) and passes
 * down. It never outlives the call; there is no module-level or `ctx`-keyed
 * cache, so a reused Run context cannot leak an earlier call's facts.
 */
export type ScribeScopeCall = { facts?: Promise<FactsOutcome> };
export function newScribeScopeCall(): ScribeScopeCall { return {}; }

export interface ScribeScope extends NoteScopeReadPort {
  /** L2a class 3 for a scribe caller: `null` admits; otherwise the refusal. */
  writeAdmission(ctx: CoreCallContext, sessionRef: SessionRef, anchors: readonly NoteAnchorV1[],
    call: ScribeScopeCall): Promise<ScribeScopeRefusal | null>;
  /** L5 managing scope of a stored note, including its replaces/contradicts anchors. */
  managingScopeOf(ctx: CoreCallContext, head: NoteHeadSnapshot, call: ScribeScopeCall):
    Promise<ReadResult<NoteScopeV1>>;
  /** Whether the caller Session is a scribe whose scope is exactly `scope`. */
  manages(ctx: CoreCallContext, sessionRef: SessionRef, scope: NoteScopeV1, call: ScribeScopeCall):
    Promise<ReadResult<boolean>>;
}

type AnchorClass = 'module' | 'goal' | 'project';

function anchorClassOf(anchor: NoteAnchorV1): AnchorClass {
  switch (anchor.kind) {
    case 'module': case 'interface': case 'file': return 'module';
    case 'goal': case 'stage': case 'task': return 'goal';
    case 'project': return 'project';
  }
}

function goalIdOf(anchor: NoteAnchorV1): string | null {
  return 'goalId' in anchor ? anchor.goalId : null;
}

function sameScope(left: NoteScopeV1, right: NoteScopeV1): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'region' && right.kind === 'region') return left.moduleId === right.moduleId;
  if (left.kind === 'goal' && right.kind === 'goal') return left.goalId === right.goalId;
  return true;
}

/** L5/P6: file anchors map to a module by the shared longest-legal-prefix ownership rule (RW-13). */
export function moduleOfAnchor(catalog: AdoptedArchitecture | null, anchor: NoteAnchorV1): string | null {
  if (anchor.kind === 'module' || anchor.kind === 'interface') return anchor.moduleId;
  if (anchor.kind !== 'file' || catalog === null) return null;
  const ownership = pathOwnershipOf(anchor.path,
    catalog.modules.map(definition => ({ value: definition.ref.moduleId, paths: definition.paths })));
  return ownership.status === 'owner' ? ownership.owner : null;
}

/** P6(b): the region of `root` is the containment subtree (or the module alone when no containment is declared). */
function regionContains(catalog: AdoptedArchitecture | null, root: string, moduleId: string): boolean {
  if (root === moduleId) return true;
  if (catalog?.containment === undefined) return false;
  const children = new Map<string, string[]>();
  for (const edge of catalog.containment.parentOf) {
    const list = children.get(edge.parent.moduleId) ?? [];
    list.push(edge.child.moduleId);
    children.set(edge.parent.moduleId, list);
  }
  const stack = [...(children.get(root) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === moduleId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(children.get(current) ?? []));
  }
  return false;
}

function moduleDepth(catalog: AdoptedArchitecture | null, moduleId: string): number {
  if (catalog?.containment === undefined) return 0;
  const parents = new Map<string, string>();
  for (const edge of catalog.containment.parentOf) parents.set(edge.child.moduleId, edge.parent.moduleId);
  let depth = 0;
  let current = moduleId;
  const seen = new Set<string>();
  while (parents.has(current) && !seen.has(current)) {
    seen.add(current);
    current = parents.get(current)!;
    depth += 1;
  }
  return depth;
}

type ScribeFacts = {
  catalog: AdoptedArchitecture | null;
  regions: Set<string>;
  project: boolean;
  scopesBySession: Map<string, NoteScopeV1[]>;
};

/** Item 3 fix 7: `null` catalog is a real "no catalog adopted"; a failure is separate. */
type CatalogOutcome = { ok: true; catalog: AdoptedArchitecture | null }
  | { ok: false; code: 'forbidden' | 'unavailable'; reason: string };

async function readCatalog(ctx: CoreCallContext, deps: ScribeScopeDependencies): Promise<CatalogOutcome> {
  try {
    const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    if (read.status === 'ready') {
      return { ok: true, catalog: read.value.catalog === null ? null : read.value.catalog.catalog };
    }
    if (read.status === 'rejected') {
      return { ok: false, code: read.code === 'forbidden' ? 'forbidden' : 'unavailable', reason: read.reason };
    }
    return { ok: false, code: 'unavailable', reason: 'the catalog cannot be read' };
  } catch {
    return { ok: false, code: 'unavailable', reason: 'the catalog cannot be read' };
  }
}

type FactsFailureCode = 'invalid' | 'forbidden' | 'unavailable';
type FactsOutcome = { ok: true; facts: ScribeFacts } | { ok: false; code: FactsFailureCode; reason: string };

/** P6(a): a scribe's scope from open responsible module links; no module link → project. */
async function deriveFacts(ctx: CoreCallContext, deps: ScribeScopeDependencies): Promise<FactsOutcome> {
  if (ctx.workspaceId === undefined) {
    return { ok: false, code: 'invalid', reason: 'a workspace is required to derive the scribe scope' };
  }
  const catalogRead = await readCatalog(ctx, deps);
  if (!catalogRead.ok) return { ok: false, code: catalogRead.code, reason: catalogRead.reason };
  const regions = new Set<string>();
  const scopesBySession = new Map<string, NoteScopeV1[]>();
  let project = false;
  let cursor: string | undefined;
  for (;;) {
    let page: ReadResult<{ items: SessionCard[]; nextCursor: string | null }>;
    try {
      page = await deps.sessions.findSessions(ctx, { workspace: { projectId: ctx.projectId, workspaceId: ctx.workspaceId },
        includeArchived: false, page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) } });
    } catch {
      return { ok: false, code: 'unavailable', reason: 'the scribe sessions cannot be read' };
    }
    if (page.status !== 'ready') {
      if (page.status === 'rejected') {
        return { ok: false, code: page.code === 'forbidden' ? 'forbidden' : 'unavailable', reason: page.reason };
      }
      return { ok: false, code: 'unavailable', reason: 'the scribe sessions cannot be read' };
    }
    for (const card of page.value.items) {
      // Item 3 should-fix 1 / spec §4: a duty resolution that is rejected or
      // throws is a read failure, never a silent `'unknown'` that drops the
      // Session from every scope calculation. A READY `'unknown'` stays as it is
      // (R12: the frozen resolver maps a failed RoleSpec read to `'unknown'`).
      let duty: string;
      try {
        const resolved = await deps.duties(card.record.role, ctx);
        if (resolved.status !== 'ready') {
          return { ok: false, code: 'unavailable', reason: 'the session duty cannot be read' };
        }
        duty = resolved.value;
      } catch {
        return { ok: false, code: 'unavailable', reason: 'the session duty cannot be read' };
      }
      if (duty !== 'scribe') continue;
      const scopes: NoteScopeV1[] = [];
      for (const link of card.links) {
        if (link.until !== null || link.ref.relation !== 'responsible' || link.ref.target.kind !== 'module') continue;
        const moduleId = link.ref.target.ref.moduleId;
        scopes.push({ kind: 'region', moduleId });
        regions.add(moduleId);
      }
      if (scopes.length === 0) { scopes.push({ kind: 'project' }); project = true; }
      scopesBySession.set(card.record.ref.sessionId, scopes);
    }
    if (page.value.nextCursor === null) break;
    cursor = page.value.nextCursor;
  }
  return { ok: true, facts: { catalog: catalogRead.catalog, regions, project, scopesBySession } };
}

/** P6(d): the deepest scribe scope containing every anchor (goal-class anchors only count for a goal scribe; none in 4A). */
function managingScopeOfAnchors(facts: ScribeFacts, anchors: readonly NoteAnchorV1[]): NoteScopeV1 {
  if (anchors.some(anchor => anchorClassOf(anchor) === 'project')) return { kind: 'project' };
  const goals = new Set<string>();
  const moduleAnchors: NoteAnchorV1[] = [];
  for (const anchor of anchors) {
    const cls = anchorClassOf(anchor);
    if (cls === 'goal') { const goalId = goalIdOf(anchor); if (goalId !== null) goals.add(goalId); }
    else if (cls === 'module') moduleAnchors.push(anchor);
  }
  if (goals.size > 0) {
    if (moduleAnchors.length > 0 || goals.size > 1) return { kind: 'project' };
    // A goal scribe needs slice 7D1's `goal` work-link target; 4A has none.
    return { kind: 'project' };
  }
  if (facts.regions.size === 0) return { kind: 'project' };
  const modules: string[] = [];
  for (const anchor of moduleAnchors) {
    const moduleId = moduleOfAnchor(facts.catalog, anchor);
    if (moduleId === null) return { kind: 'project' };
    modules.push(moduleId);
  }
  if (modules.length === 0) return { kind: 'project' };
  let best: string | null = null;
  let bestDepth = -1;
  for (const root of facts.regions) {
    if (!modules.every(moduleId => regionContains(facts.catalog, root, moduleId))) continue;
    const depth = moduleDepth(facts.catalog, root);
    if (depth > bestDepth || (depth === bestDepth && (best === null || root.localeCompare(best) < 0))) {
      best = root;
      bestDepth = depth;
    }
  }
  return best === null ? { kind: 'project' } : { kind: 'region', moduleId: best };
}

type HeadsOutcome = { ok: true; heads: NoteHeadSnapshot[] } | { ok: false; code: ReadFailureCode; reason: string };

export function createScribeScope(deps: ScribeScopeDependencies): ScribeScope {
  function result<T>(value: T): ReadResult<T> { return { status: 'ready', value }; }

  // Item 1/§11.7: the scope facts are derived ONCE per CALL. The call object is
  // created by the public entry and passed in, so one `writeNote`/`dispose` that
  // asks several times (write admission, the subject scope, the manages checks)
  // reads Sessions and the catalog once, while a reused `ctx` never leaks facts.
  function factsFor(call: ScribeScopeCall, ctx: CoreCallContext): Promise<FactsOutcome> {
    let cached = call.facts;
    if (cached === undefined) {
      cached = deriveFacts(ctx, deps);
      call.facts = cached;
    }
    return cached;
  }

  async function goalIdsOf(ctx: CoreCallContext): Promise<{ ok: true; goalIds: string[] } | { ok: false; code: ReadFailureCode; reason: string }> {
    if (ctx.workspaceId === undefined) return { ok: false, code: 'invalid', reason: 'a workspace is required to read the goals' };
    const page = await readAllRecords(deps.records, GOAL_BY_WORKSPACE_INDEX, [ctx.projectId, ctx.workspaceId]);
    if (!page.ok) return page;
    const ids = new Set<string>();
    for (const record of page.value) {
      const decoded = decodeGoalSnapshot(record);
      if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged goal' };
      ids.add(decoded.value.ref.goalId);
    }
    return { ok: true, goalIds: [...ids] };
  }

  async function lookupHeads(index: string, values: readonly (string | null)[]): Promise<HeadsOutcome> {
    return readAllHeads(deps.records, index, values);
  }

  async function currentHeads(ctx: CoreCallContext): Promise<HeadsOutcome> {
    const goals = await goalIdsOf(ctx);
    if (!goals.ok) return goals;
    const seen = new Map<string, NoteHeadSnapshot>();
    for (const state of ['accepted', 'reviewed'] as const) {
      for (const goalId of [null, ...goals.goalIds] as (string | null)[]) {
        const page = await lookupHeads(S4_NOTE_BY_REVIEW_STATUS_LOOKUP, [ctx.projectId, goalId, state]);
        if (!page.ok) return page;
        for (const head of page.heads) {
          if (head.state === 'accepted' || head.state === 'reviewed') seen.set(head.noteId, head);
        }
      }
    }
    return { ok: true, heads: [...seen.values()] };
  }

  async function relationAnchorsOf(head: NoteHeadSnapshot):
  Promise<{ ok: true; anchors: NoteAnchorV1[] } | { ok: false; code: ReadFailureCode; reason: string }> {
    const relations = [...new Set([...head.replaces, ...head.contradicts])];
    if (relations.length === 0) return { ok: true, anchors: [] };
    // RW-12a: every relation head in ONE batched read.
    const refKeys = relations.map(noteId => noteHeadRefKey({ aggregateType: 'NoteHead',
      projectId: head.ref.projectId, noteId }));
    const read = await deps.records.readMany(refKeys);
    if (read.status !== 'ready') {
      const mapped = mapStoreFailure(read);
      return { ok: false, code: mapped.code, reason: mapped.reason };
    }
    const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
    const anchors: NoteAnchorV1[] = [];
    for (const refKey of refKeys) {
      const record = byKey.get(refKey);
      if (record === undefined) return { ok: false, code: 'unavailable', reason: 'a relation head is missing' };
      const decoded = decodeNoteHeadSnapshot(record);
      if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'a relation head is damaged' };
      anchors.push(decoded.value.anchor, ...decoded.value.extraAnchors);
    }
    return { ok: true, anchors };
  }

  async function managingScopeOf(call: ScribeScopeCall, ctx: CoreCallContext,
    head: NoteHeadSnapshot): Promise<ReadResult<NoteScopeV1>> {
    const factsRead = await factsFor(call, ctx);
    if (!factsRead.ok) return { status: 'rejected', code: factsRead.code, reason: factsRead.reason };
    const relationRead = await relationAnchorsOf(head);
    if (!relationRead.ok) return { status: 'rejected', code: relationRead.code, reason: relationRead.reason };
    const anchors = [head.anchor, ...head.extraAnchors, ...relationRead.anchors];
    return result(managingScopeOfAnchors(factsRead.facts, anchors));
  }

  return {
    async countCurrentNotes(ctx, input) {
      // This is itself a public read: it owns its own per-call cache.
      const call = newScribeScopeCall();
      const factsRead = await factsFor(call, ctx);
      if (!factsRead.ok) return { status: 'rejected', code: factsRead.code, reason: factsRead.reason };
      // P1/item 10a: a scope with no scribe manages nothing (count 0). Its notes
      // count for the scope they go up to. A failed read is still unavailable.
      const held = [...factsRead.facts.scopesBySession.values()]
        .some(list => list.some(scope => sameScope(scope, input.scope)));
      if (!held) return result({ scope: input.scope, current: 0 });
      const headsRead = await currentHeads(ctx);
      if (!headsRead.ok) return { status: 'rejected', code: headsRead.code, reason: headsRead.reason };
      let current = 0;
      for (const head of headsRead.heads) {
        const relationRead = await relationAnchorsOf(head);
        if (!relationRead.ok) return { status: 'rejected', code: relationRead.code, reason: relationRead.reason };
        const anchors = [head.anchor, ...head.extraAnchors, ...relationRead.anchors];
        if (sameScope(managingScopeOfAnchors(factsRead.facts, anchors), input.scope)) current += 1;
      }
      return result({ scope: input.scope, current });
    },

    async writeAdmission(ctx, sessionRef, anchors, call) {
      const factsRead = await factsFor(call, ctx);
      // Item 3 fix 7: a failed scope-fact read refuses with `unavailable`.
      if (!factsRead.ok) return { code: 'unavailable', reason: factsRead.reason };
      const facts = factsRead.facts;
      const scopes = facts.scopesBySession.get(sessionRef.sessionId) ?? [];
      if (scopes.length === 0) return { code: 'forbidden', reason: 'anchor_out_of_scope' };
      if (scopes.some(scope => scope.kind === 'project')) return null;
      for (const anchor of anchors) {
        if (anchorClassOf(anchor) !== 'module') return { code: 'forbidden', reason: 'anchor_out_of_scope' };
        const moduleId = moduleOfAnchor(facts.catalog, anchor);
        if (moduleId === null) return { code: 'forbidden', reason: 'anchor_out_of_scope' };
        const admitted = scopes.some(scope => scope.kind === 'region' && regionContains(facts.catalog, scope.moduleId, moduleId));
        if (!admitted) return { code: 'forbidden', reason: 'anchor_out_of_scope' };
      }
      return null;
    },

    async manages(ctx, sessionRef, scope, call) {
      const factsRead = await factsFor(call, ctx);
      if (!factsRead.ok) return { status: 'rejected', code: factsRead.code, reason: factsRead.reason };
      const scopes = factsRead.facts.scopesBySession.get(sessionRef.sessionId) ?? [];
      return result(scopes.some(candidate => sameScope(candidate, scope)));
    },

    async managingScopeOf(ctx, head, call) {
      return managingScopeOf(call, ctx, head);
    },
  };
}

/** Exported for the note-service's own managed-scope check on a `replaces`/`contradicts` target. */
export function sourceIsAuthorOf(source: NoteSourceV1, author: NoteSourceV1): boolean {
  if (source.kind !== 'agent' || author.kind !== 'agent') return false;
  return source.sessionRef.projectId === author.sessionRef.projectId
    && source.sessionRef.sessionId === author.sessionRef.sessionId;
}

export type { ModuleRef };
