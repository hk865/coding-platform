/**
 * Slice 4B L22/L23: `NoteCheckPort` — the one implementation of the derived
 * per-note fields (`freshness`, `changedFiles`, `sourceUnavailable`, `invalid`,
 * `conflicting`, `overQuota`, `updateDue`, `currentEligible`, the L23 anchor
 * status, `unresolvedFacts`/`uncheckedFacts`, the L2a class-5 hints). It is a
 * pure read layer: it never writes a record or stores anything.
 *
 * P9: every fact kind is resolved through a reader that already exists:
 * `record` pointers go through the record transaction port (a `SessionMessage`
 * through the existing message decoder), `note` pointers through the note head,
 * `file` pointers through `WorkspaceToolsPort`, `commit` by format only. The
 * note read model injects this port and never imports this file (L18).
 *
 * §9: a failed plan/catalog/Run read is NEVER a definite answer. Any non-`ready`
 * dependency read rejects the whole `checkNotes` call with `unavailable`; the
 * note read model propagates that rejection instead of returning a fresh item.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult, CoreRejection } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { NoteAnchorV1, NoteFactV1, NoteHeadSnapshot, NoteSectionsV1, NoteVersionSnapshot } from '../../../contracts/note.js';
import { renderNoteHeader } from '../../../contracts/note.js';
import { bigramWindows, normalizeSearchText } from '../../record-store/lookup-index.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import { decodeRefKey } from '../../record-store/record-codec.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type { AdoptedArchitecture, ArchitectureCatalogPort, ArchitectureRevision, ModuleDefinition } from '../architecture/catalog-contracts.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { NoteCheckPort, NoteCheckV1, NoteFileObservationV1, NoteHintV1, NoteSimilarV1 } from '../model/note-contracts.js';
import { NOTE_ANCHOR_QUOTA, NOTE_BASIS_FILE_MAX_BYTES, NOTE_GOAL_QUOTA, NOTE_READ_FACTS_MAX, NOTE_READ_FILES_MAX,
  NOTE_SIMILAR_MAX, NOTE_SIMILAR_MIN, NOTE_SYMBOL_HITS_MAX, NOTE_SYMBOL_RECHECK_MAX } from '../model/note-contracts.js';
import { anchorKeyOf, isSafeRelativePath, signatureDigestOf, type NoteAnchorWorkspace } from '../notes/note-anchors.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { CaptureSummary, SourceHit, SourceProvider } from '../../workspace/ports.js';
import {
  createNoteHeadDerivations, mapStoreFailure, newHeadCache,
  type NoteHeadDerivations, type NoteHeadLike,
} from '../notes/note-read-model.js';
import {
  S4_NOTE_BY_ANCHOR_LOOKUPS, decodeNoteHeadSnapshot, decodeNoteVersionSnapshot, noteHeadRefKey, noteVersionRefKey,
} from '../persistence/note-record-codecs.js';
import { S2B_PLAN_REVISION_BY_GOAL_LOOKUP, decodePlanRevisionSnapshot, planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import { readGoalPlanWindow } from '../tasks/plan-readers.js';
import { decodeSessionMessageRecord } from '../sessions/message-record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { decodeRunActivitySnapshot } from '../persistence/run-activity-codecs.js';
import { mapExecutedFilesToModules } from './goal-conflicts.js';

export type NoteCheckLimits = {
  readFilesMax?: number;
  readFactsMax?: number;
  symbolRecheckMax?: number;
  symbolHitsMax?: number;
  basisFileMaxBytes?: number;
  anchorQuota?: number;
  goalQuota?: number;
};

export type NoteCheckDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  /** The plan readers (`queryGoal`/`queryTaskGraph`) or a narrower double. */
  plans?: Pick<PlanTaskPort, 'queryGoal' | 'queryTaskGraph'>;
  architecture?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  workspace?: NoteAnchorWorkspace;
  /** R1: the raw artifact store; an artifact fact is an existence check only. */
  artifacts?: Pick<RawArtifactStorePort, 'read'>;
  limits?: NoteCheckLimits;
};

type Reject = { ok: false; code: CoreRejection['code']; reason: string };
type Outcome<T> = { ok: true; value: T } | Reject;
type StaleReason = NoteCheckV1['anchorRetiredReasons'][number];
type UnresolvedReason = NoteCheckV1['unresolvedFacts'][number]['reason'];

function reject(code: CoreRejection['code'], reason: string): Reject { return { ok: false, code, reason }; }

/** A `ReadResult` that is not `ready` may be a bare `not_found`/`not_ready`. */
function readFailureReason(value: unknown, fallback: string): string {
  return typeof value === 'object' && value !== null && 'reason' in value && typeof (value as { reason: unknown }).reason === 'string'
    ? (value as { reason: string }).reason : fallback;
}

const COMMIT_SHA = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
/** R1: a `file` fact's digest must be 64 lowercase hex before any read. */
const FILE_DIGEST = /^[0-9a-f]{64}$/;
const RETIRED_NOTE_STATES: readonly NoteHeadSnapshot['state'][] = ['superseded', 'withdrawn', 'rejected'];
const RETIRED_TASK_DISPOSITIONS: readonly string[] = ['cancelled', 'superseded'];

type CheckBody = {
  noteId: string; version: number; state: NoteHeadSnapshot['state']; kind: NoteHeadSnapshot['kind'];
  topic: string; topicKey: string; conclusion: string; anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[];
  facts: NoteFactV1[]; basis: NoteHeadSnapshot['basis']; sections?: NoteSectionsV1; source: NoteHeadSnapshot['source'];
  replaces: readonly string[]; contradicts: readonly string[]; coexistWith: readonly string[];
};

function bodyOfHead(head: NoteHeadSnapshot): CheckBody {
  return { noteId: head.noteId, version: head.version, state: head.state, kind: head.kind, topic: head.topic,
    topicKey: head.topicKey, conclusion: head.conclusion, anchor: head.anchor, extraAnchors: head.extraAnchors,
    facts: head.facts, basis: head.basis, source: head.source, replaces: head.replaces, contradicts: head.contradicts,
    coexistWith: head.coexistWith,
    ...(head.sections === undefined ? {} : { sections: head.sections }) };
}

function bodyOfVersion(version: NoteVersionSnapshot): CheckBody {
  return { noteId: version.noteId, version: version.version, state: version.state, kind: version.kind,
    topic: version.topic, topicKey: version.topicKey, conclusion: version.conclusion, anchor: version.anchor,
    extraAnchors: version.extraAnchors, facts: version.facts, basis: version.basis, replaces: version.replaces,
    contradicts: version.contradicts, coexistWith: version.coexistWith, source: version.source,
    ...(version.sections === undefined ? {} : { sections: version.sections }) };
}

type FileRead = { status: 'ready'; digest: string } | { status: 'missing' | 'forbidden' | 'capacity' | 'unavailable' };

/**
 * MF3/R3: the one per-`checkNotes` observation budget. A path is read at most
 * once per call; the 257th distinct path (and every later one) is `exhausted`
 * and reported as an `unchecked` observation, never silently skipped.
 */
type PathRead = { status: 'ready'; digest: string }
  | { status: 'missing' | 'forbidden' | 'capacity' | 'unavailable' | 'exhausted' };

type CheckBudget = {
  filesMax: number;
  reads: Map<string, PathRead>;
  readCount: number;
  factsRemaining: number;
  symbolRechecksRemaining: number;
};

/** The per-item observations, deduplicated by path, in first-encounter order. */
type ItemObservations = Map<string, NoteFileObservationV1>;

/**
 * R2: the plan/catalog caches live for exactly one `checkNotes` call. The plan
 * key includes the project, because two projects may both have `s4a-goal`.
 */
type CheckCaches = {
  plans: Map<string, Outcome<PlanRevisionSnapshot | null>>;
  architecture: { current?: Outcome<ArchitectureRevision | null> };
};

function newCheckCaches(): CheckCaches { return { plans: new Map(), architecture: {} }; }

function newCheckBudget(limits: NoteCheckLimits): CheckBudget {
  return { filesMax: limits.readFilesMax ?? NOTE_READ_FILES_MAX, reads: new Map(), readCount: 0,
    factsRemaining: limits.readFactsMax ?? NOTE_READ_FACTS_MAX,
    symbolRechecksRemaining: limits.symbolRecheckMax ?? NOTE_SYMBOL_RECHECK_MAX };
}

type FactOutcome =
  | { kind: 'untouched' }
  | { kind: 'unchecked' }
  // R3: the fact's path is past the per-call file budget.
  | { kind: 'budget' }
  | { kind: 'unresolved'; reason: UnresolvedReason }
  | { kind: 'changed'; path: string; deleted: boolean }
  | { kind: 'source_unavailable' }
  | { kind: 'basis_note_retired' };

/** R4: the read-side symbol recheck outcome. */
type SymbolRecheck = { status: 'live' } | { status: 'changed' } | { status: 'missing' } | { status: 'unchecked' };

const SYMBOL_RECHECK_LANGUAGES: readonly string[] = ['typescript', 'python', 'cpp'];
const SYMBOL_RECHECK_PAGE = 32;

/** R4/§9: the one-based name-span text the stored `signatureDigest` hashes. */
function symbolRangeText(content: string, start: { line: number; column: number },
  end: { line: number; column: number }): string {
  const lines = content.split('\n');
  if (start.line === end.line) return lines[start.line - 1]!.slice(start.column - 1, end.column - 1);
  const parts = [lines[start.line - 1]!.slice(start.column - 1)];
  for (let line = start.line + 1; line < end.line; line += 1) parts.push(lines[line - 1]!);
  parts.push(lines[end.line - 1]!.slice(0, end.column - 1));
  return parts.join('\n');
}

/** L22: the bounded size of the one similar-notes anchor-lookup page. */
export const NOTE_SIMILAR_SCAN = 100;

export function createNoteCheck(deps: NoteCheckDependencies): NoteCheckPort {
  const limits = deps.limits ?? {};
  const basisFileMaxBytes = limits.basisFileMaxBytes ?? NOTE_BASIS_FILE_MAX_BYTES;
  const derivations: NoteHeadDerivations = createNoteHeadDerivations(deps.records,
    limits.anchorQuota ?? NOTE_ANCHOR_QUOTA, limits.goalQuota ?? NOTE_GOAL_QUOTA);

  const workspaceRef = (ctx: CoreCallContext) => ({ aggregateType: 'Workspace' as const,
    projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' });

  async function readHead(projectId: string, noteId: string): Promise<Outcome<NoteHeadSnapshot | null>> {
    const refKey = noteHeadRefKey({ aggregateType: 'NoteHead', projectId, noteId });
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return reject(read.code === 'not_found' ? 'not_found' : 'unavailable', read.reason);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return { ok: true, value: null };
    const decoded = decodeNoteHeadSnapshot(record);
    if (decoded.status !== 'decoded') return reject('unavailable', 'damaged note head');
    return { ok: true, value: decoded.value };
  }

  async function readVersion(projectId: string, noteId: string, version: number):
  Promise<Outcome<NoteVersionSnapshot | null>> {
    const refKey = noteVersionRefKey({ aggregateType: 'NoteVersion', projectId, noteId, version });
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return reject(read.code === 'not_found' ? 'not_found' : 'unavailable', read.reason);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return { ok: true, value: null };
    const decoded = decodeNoteVersionSnapshot(record);
    if (decoded.status !== 'decoded') return reject('unavailable', 'damaged note version');
    return { ok: true, value: decoded.value };
  }

  async function readCurrentFile(ctx: CoreCallContext, path: string): Promise<FileRead> {
    if (deps.workspace === undefined) return { status: 'unavailable' };
    try {
      const read = await deps.workspace.readWorkspace(ctx,
        { workspace: workspaceRef(ctx), path, maxBytes: basisFileMaxBytes, version: { kind: 'working_tree' } });
      if (read.status === 'ready') return { status: 'ready', digest: read.value.digest };
      if (read.code === 'not_found') return { status: 'missing' };
      if (read.code === 'forbidden') return { status: 'forbidden' };
      if (read.code === 'capacity') return { status: 'capacity' };
      return { status: 'unavailable' };
    } catch {
      return { status: 'unavailable' };
    }
  }

  /** R3: read one path at most once per call; past the budget it is `exhausted`. */
  async function readPathOnce(ctx: CoreCallContext, budget: CheckBudget, path: string): Promise<PathRead> {
    const hit = budget.reads.get(path);
    if (hit !== undefined) return hit;
    if (budget.readCount >= budget.filesMax) {
      const exhausted: PathRead = { status: 'exhausted' };
      budget.reads.set(path, exhausted);
      return exhausted;
    }
    budget.readCount += 1;
    const file = await readCurrentFile(ctx, path);
    const result: PathRead = file.status === 'ready' ? { status: 'ready', digest: file.digest } : { status: file.status };
    budget.reads.set(path, result);
    return result;
  }

  /** R3: one path's observation against one expected digest (null = existence only). */
  function observationFor(path: string, read: PathRead, expectedDigest: string | null): NoteFileObservationV1 {
    if (read.status === 'ready') {
      return { path, digest: read.digest,
        outcome: expectedDigest !== null && read.digest !== expectedDigest ? 'changed' : 'same' };
    }
    const outcome: NoteFileObservationV1['outcome'] =
      read.status === 'missing' ? 'deleted' : read.status === 'exhausted' ? 'unchecked' : read.status;
    return { path, digest: null, outcome };
  }

  /**
   * R3: the check's ONLY way to observe a file. Each caller gets the outcome
   * computed against its own expected digest, while the item keeps the first
   * observation of that path and the call-level budget reads the file once.
   */
  async function observeForItem(ctx: CoreCallContext, budget: CheckBudget, itemObs: ItemObservations,
    path: string, expectedDigest: string | null): Promise<NoteFileObservationV1> {
    const read = await readPathOnce(ctx, budget, path);
    const observed = observationFor(path, read, expectedDigest);
    if (!itemObs.has(path)) itemObs.set(path, observed);
    return observed;
  }

  /**
   * MF4/R4: the read-side symbol recheck. It matches by name only, uses the
   * stored range to pick among several same-name hits, and never turns an
   * incomplete analysis (cap, unsupported language, read failure, missing
   * capture) into `symbol_missing`. The capture is always released.
   */
  async function recheckSymbol(ctx: CoreCallContext, anchor: Extract<NoteAnchorV1, { kind: 'file' }>,
    hitsMax: number): Promise<SymbolRecheck> {
    const workspace = deps.workspace;
    const symbol = anchor.symbol;
    if (symbol === undefined || workspace === undefined || workspace.capture === undefined
      || workspace.querySource === undefined) return { status: 'unchecked' };
    if (!SYMBOL_RECHECK_LANGUAGES.includes(symbol.language)) return { status: 'unchecked' };
    // R4: a scan that cannot look at any hit is stopped at the cap, never a
    // definite `symbol_missing`.
    if (hitsMax <= 0) return { status: 'unchecked' };
    let capture: CaptureSummary;
    try {
      const captured = await workspace.capture(ctx, { provider: symbol.language as SourceProvider });
      if (captured.status !== 'ready') return { status: 'unchecked' };
      capture = captured.value;
    } catch {
      return { status: 'unchecked' };
    }
    try {
      const hits: Extract<SourceHit, { kind: 'symbol' }>[] = [];
      let cursor: string | null = null;
      let scanned = 0;
      while (scanned < hitsMax) {
        const limit = Math.min(hitsMax - scanned, SYMBOL_RECHECK_PAGE);
        let page: Awaited<ReturnType<NonNullable<NoteAnchorWorkspace['querySource']>>>;
        try {
          page = await workspace.querySource(ctx,
            { capture: capture.ref, query: { kind: 'symbols', path: anchor.path }, cursor, limit });
        } catch {
          return { status: 'unchecked' };
        }
        if (page.status !== 'ready') return { status: 'unchecked' };
        for (const hit of page.value.items) {
          if (hit.kind !== 'symbol' || hit.name !== symbol.qualifiedName) continue;
          hits.push(hit);
        }
        scanned += page.value.items.length;
        cursor = page.value.nextCursor;
        if (cursor === null) break;
      }
      // A scan stopped at the hits cap is incomplete, never a definitive answer.
      if (cursor !== null) return { status: 'unchecked' };
      // R4: a definite `symbol_missing` needs the captured file to have been
      // read and analysed. A file missing from the capture or unreadable is an
      // incomplete analysis, never a retirement.
      if (hits.length === 0) {
        let read: Awaited<ReturnType<NonNullable<NoteAnchorWorkspace['readWorkspace']>>>;
        try {
          read = await workspace.readWorkspace(ctx, { workspace: { aggregateType: 'Workspace',
            projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, path: anchor.path,
            maxBytes: basisFileMaxBytes, version: { kind: 'capture', capture: capture.ref } });
        } catch {
          return { status: 'unchecked' };
        }
        return read.status === 'ready' ? { status: 'missing' } : { status: 'unchecked' };
      }
      hits.sort((left, right) => left.location.start.line - right.location.start.line
        || left.location.start.column - right.location.start.column);
      const chosen = hits.length === 1 ? hits[0]
        : hits.find(hit => hit.location.start.line === symbol.range.startLine
          && hit.location.end.line === symbol.range.endLine);
      // Several same-name hits and none at the stored range: unverifiable.
      if (chosen === undefined) return { status: 'unchecked' };
      const read = await workspace.readWorkspace(ctx, { workspace: { aggregateType: 'Workspace',
        projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, path: anchor.path,
        maxBytes: basisFileMaxBytes, version: { kind: 'capture', capture: capture.ref } });
      if (read.status !== 'ready') return { status: 'unchecked' };
      const digest = signatureDigestOf(symbolRangeText(read.value.content, chosen.location.start, chosen.location.end));
      return digest === symbol.signatureDigest ? { status: 'live' } : { status: 'changed' };
    } finally {
      try { await workspace.releaseCapture?.(ctx, capture.ref); } catch { /* best-effort */ }
    }
  }

  /** §9: a failed plan read is `unavailable`, never a definite "no plan". */
  async function currentPlan(ctx: CoreCallContext, goalId: string,
    caches: CheckCaches): Promise<Outcome<PlanRevisionSnapshot | null>> {
    const key = `${ctx.projectId}\u0000${goalId}`;
    const hit = caches.plans.get(key);
    if (hit !== undefined) return hit;
    const ref: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
    const window = await readGoalPlanWindow(deps.records, ref);
    const outcome: Outcome<PlanRevisionSnapshot | null> = window.status === 'ready'
      ? { ok: true, value: window.plan }
      : reject('unavailable', readFailureReason(window, 'the goal plan cannot be read'));
    caches.plans.set(key, outcome);
    return outcome;
  }

  /** §9: a failed catalog read is `unavailable`, never an empty module list. */
  async function currentArchitecture(ctx: CoreCallContext, caches: CheckCaches):
  Promise<Outcome<ArchitectureRevision | null>> {
    const hit = caches.architecture.current;
    if (hit !== undefined) return hit;
    let outcome: Outcome<ArchitectureRevision | null>;
    if (deps.architecture === undefined) {
      outcome = { ok: true, value: null };
    } else {
      const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
      outcome = read.status === 'ready' ? { ok: true, value: read.value }
        : reject('unavailable', readFailureReason(read, 'the architecture catalog cannot be read'));
    }
    caches.architecture.current = outcome;
    return outcome;
  }

  function moduleIn(modules: readonly ModuleDefinition[], moduleId: string): ModuleDefinition | undefined {
    return modules.find(module => module.ref.moduleId === moduleId);
  }

  /**
   * Slice 2B L14 (`s2b-plan-revision-by-goal`): one Goal's PlanRevisions,
   * ordered by `acceptedAt`. Used to find the basis revision by its number,
   * because each adopted revision carries a NEW planId (plan-machine.ts:1404).
   * A store failure is `unavailable`; a genuinely absent revision is `null`.
   */
  async function basisPlanByNumber(ctx: CoreCallContext, goalId: string,
    planRevision: number): Promise<Outcome<PlanRevisionSnapshot | null>> {
    let after: { order: string | number; refKey: string } | undefined;
    for (;;) {
      const page = await deps.records.lookupOrdered({ index: S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
        values: [ctx.projectId, goalId], direction: 'asc', ...(after === undefined ? {} : { after }), limit: 200 });
      if (page.status !== 'ready') return reject('unavailable', page.reason);
      for (const record of page.value.records) {
        const decoded = decodePlanRevisionSnapshot(record);
        if (decoded.status === 'decoded' && decoded.value.planRevision === planRevision) return { ok: true, value: decoded.value };
      }
      if (page.value.next === null) return { ok: true, value: null };
      after = page.value.next;
    }
  }

  /**
   * MF5/R5: every adopted PlanRevision of one Goal, keyed by its revision
   * number, read once through the S2B index. A store failure is `unavailable`.
   */
  async function planRevisionsOfGoal(ctx: CoreCallContext, goalId: string):
  Promise<Outcome<Map<number, PlanRevisionSnapshot>>> {
    const revisions = new Map<number, PlanRevisionSnapshot>();
    let after: { order: string | number; refKey: string } | undefined;
    for (;;) {
      const page = await deps.records.lookupOrdered({ index: S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
        values: [ctx.projectId, goalId], direction: 'asc', ...(after === undefined ? {} : { after }), limit: 200 });
      if (page.status !== 'ready') return reject('unavailable', page.reason);
      for (const record of page.value.records) {
        const decoded = decodePlanRevisionSnapshot(record);
        if (decoded.status === 'decoded') revisions.set(decoded.value.planRevision, decoded.value);
      }
      if (page.value.next === null) return { ok: true, value: revisions };
      after = page.value.next;
    }
  }

  /**
   * L23: the MAIN anchor's retirement decides `anchorStatus`; a retired extra
   * anchor only appears in `retiredExtraAnchors`. Symbol rechecks are bounded
   * (`NOTE_SYMBOL_RECHECK_MAX`), scan at most `NOTE_SYMBOL_HITS_MAX` hits, and
   * each recheck consumes the `NOTE_READ_FILES_MAX` distinct-file budget.
   */
  async function anchorStatusOf(ctx: CoreCallContext, body: CheckBody, budget: CheckBudget,
    itemObs: ItemObservations, caches: CheckCaches):
  Promise<Outcome<{ retired: boolean; reasons: StaleReason[]; retiredExtraAnchors: string[]; unchecked: boolean;
    staleReasons: string[] }>> {
    const reasons: StaleReason[] = [];
    const retiredExtraAnchors: string[] = [];
    const staleReasons: string[] = [];
    let unchecked = false;
    const all = [body.anchor, ...body.extraAnchors];
    const needsCatalog = all.some(anchor => anchor.kind === 'module' || anchor.kind === 'interface');
    // MF5/R5: each task/stage anchor resolves against its OWN goal's plan.
    const plans = new Map<string, PlanRevisionSnapshot | null>();
    for (const goalId of new Set(all.flatMap(anchor =>
      anchor.kind === 'task' || anchor.kind === 'stage' ? [anchor.goalId] : []))) {
      const read = await currentPlan(ctx, goalId, caches);
      if (!read.ok) return read;
      plans.set(goalId, read.value);
    }
    let modules: readonly ModuleDefinition[] | null = null;
    if (needsCatalog) {
      const read = await currentArchitecture(ctx, caches);
      if (!read.ok) return read;
      modules = read.value?.catalog?.catalog.modules ?? null;
    }

    const retirementOf = async (anchor: NoteAnchorV1): Promise<Outcome<StaleReason[]>> => {
      switch (anchor.kind) {
        case 'module':
          if (modules !== null && moduleIn(modules, anchor.moduleId) === undefined) return { ok: true, value: ['module_removed'] };
          return { ok: true, value: [] };
        case 'interface': {
          if (modules === null) return { ok: true, value: [] };
          const module = moduleIn(modules, anchor.moduleId);
          if (module === undefined || !module.interfaces.some(item => item.id === anchor.interfaceId)) {
            return { ok: true, value: ['interface_removed'] };
          }
          return { ok: true, value: [] };
        }
        case 'task': {
          const plan = plans.get(anchor.goalId) ?? null;
          if (plan === null) return { ok: true, value: [] };
          const task = plan.tasks.find(candidate => candidate.taskId === anchor.taskId);
          if (task === undefined || RETIRED_TASK_DISPOSITIONS.includes(task.disposition)) return { ok: true, value: ['task_ended'] };
          return { ok: true, value: [] };
        }
        case 'stage': {
          const current = plans.get(anchor.goalId) ?? null;
          if (current === null) { unchecked = true; return { ok: true, value: [] }; }
          if (anchor.planRevision > current.planRevision) { unchecked = true; return { ok: true, value: [] }; }
          const revisions = await planRevisionsOfGoal(ctx, anchor.goalId);
          if (!revisions.ok) return revisions;
          // Continuity: the stage must be present in EVERY adopted revision from
          // the anchor's own revision through the current one.
          for (let revision = anchor.planRevision; revision <= current.planRevision; revision += 1) {
            const plan = revisions.value.get(revision);
            if (plan === undefined) { unchecked = true; return { ok: true, value: [] }; }
            if (!plan.stages.some(stage => stage.stageId === anchor.stageId)) {
              return { ok: true, value: ['stage_not_in_current_plan'] };
            }
          }
          return { ok: true, value: [] };
        }
        case 'file': {
          if (anchor.deleted === true) return { ok: true, value: [] };
          const observed = await observeForItem(ctx, budget, itemObs, anchor.path,
            anchor.symbol?.fileDigest ?? null);
          if (observed.outcome === 'deleted') return { ok: true, value: ['file_deleted'] };
          if (observed.outcome !== 'same' && observed.outcome !== 'changed') unchecked = true;
          return { ok: true, value: [] };
        }
        default:
          return { ok: true, value: [] };
      }
    };

    for (const anchor of all) {
      const outcome = await retirementOf(anchor);
      if (!outcome.ok) return outcome;
      const retired = outcome.value;
      if (anchor === body.anchor) reasons.push(...retired);
      else if (retired.length > 0) retiredExtraAnchors.push(anchorKeyOf(anchor));
    }

    for (const anchor of all) {
      if (anchor.kind !== 'file' || anchor.symbol === undefined) continue;
      const observed = await observeForItem(ctx, budget, itemObs, anchor.path, anchor.symbol.fileDigest);
      if (observed.outcome === 'same') continue; // stored fileDigest matches: no recheck
      if (observed.outcome === 'deleted') continue; // file_deleted already handled
      // R3/L23: the path is already charged to the distinct-file budget by the
      // observation above; only the recheck count is charged here.
      if (observed.outcome !== 'changed') { unchecked = true; continue; }
      if (budget.symbolRechecksRemaining <= 0) { unchecked = true; continue; }
      budget.symbolRechecksRemaining -= 1;
      const rechecked = await recheckSymbol(ctx, anchor, limits.symbolHitsMax ?? NOTE_SYMBOL_HITS_MAX);
      if (rechecked.status === 'changed') staleReasons.push('symbol_signature_changed');
      else if (rechecked.status === 'missing') {
        if (anchor === body.anchor) reasons.push('symbol_missing');
        else if (!retiredExtraAnchors.includes(anchorKeyOf(anchor))) retiredExtraAnchors.push(anchorKeyOf(anchor));
      } else if (rechecked.status === 'unchecked') {
        unchecked = true;
      }
    }
    return { ok: true, value: { retired: reasons.length > 0, reasons, retiredExtraAnchors, unchecked, staleReasons } };
  }

  /** L11 definitions: plan adoption, task definitions, module/interface definitions. */
  async function definitionStaleness(ctx: CoreCallContext, body: CheckBody, caches: CheckCaches):
  Promise<Outcome<{ staleReasons: string[]; unchecked: boolean }>> {
    const staleReasons: string[] = [];
    let unchecked = false;
    const anchors = [body.anchor, ...body.extraAnchors];

    if (body.kind === 'understanding' && (body.anchor.kind === 'goal' || body.anchor.kind === 'stage')) {
      const goalId = 'goalId' in body.anchor ? body.anchor.goalId : null;
      if (goalId !== null && body.basis.planRevision !== null) {
        const read = await currentPlan(ctx, goalId, caches);
        if (!read.ok) return read;
        if (read.value !== null && read.value.planRevision !== body.basis.planRevision) staleReasons.push('plan_changed');
      }
    }

    for (const anchor of anchors) {
      if (anchor.kind !== 'task' || body.basis.planRevision === null) continue;
      const read = await currentPlan(ctx, anchor.goalId, caches);
      if (!read.ok) return read;
      const plan = read.value;
      if (plan === null) { unchecked = true; continue; }
      if (plan.planRevision === body.basis.planRevision) continue;
      const basis = await basisPlanByNumber(ctx, anchor.goalId, body.basis.planRevision);
      if (!basis.ok) return basis;
      if (basis.value === null) { unchecked = true; continue; }
      const before = basis.value.tasks.find(candidate => candidate.taskId === anchor.taskId);
      const after = plan.tasks.find(candidate => candidate.taskId === anchor.taskId);
      if (before === undefined || after === undefined
        || canonicalJson(before as unknown as JsonValue) !== canonicalJson(after as unknown as JsonValue)) {
        staleReasons.push('task_definition_changed');
      }
    }

    const hasModuleAnchor = anchors.some(anchor => anchor.kind === 'module' || anchor.kind === 'interface');
    if (hasModuleAnchor && body.basis.catalogRevision !== null && deps.architecture !== undefined) {
      const current = await currentArchitecture(ctx, caches);
      if (!current.ok) return current;
      if (current.value === null) return { ok: true, value: { staleReasons, unchecked: true } };
      const currentModules = current.value.catalog?.catalog.modules ?? null;
      const basis = await deps.architecture.readArchitectureRevision(ctx,
        { selection: { kind: 'revision', ref: { ...current.value.baseline.ref, revision: body.basis.catalogRevision } } });
      if (basis.status !== 'ready') return reject('unavailable', readFailureReason(basis, 'the basis catalog revision cannot be read'));
      const basisModules = basis.value.catalog?.catalog.modules ?? null;
      for (const anchor of anchors) {
        if (anchor.kind === 'module') {
          const before = basisModules === null ? undefined : moduleIn(basisModules, anchor.moduleId);
          const after = currentModules === null ? undefined : moduleIn(currentModules, anchor.moduleId);
          if (before === undefined || after === undefined
            || canonicalJson(before as unknown as JsonValue) !== canonicalJson(after as unknown as JsonValue)) {
            staleReasons.push('module_definition_changed');
          }
        } else if (anchor.kind === 'interface') {
          const beforeModule = basisModules === null ? undefined : moduleIn(basisModules, anchor.moduleId);
          const afterModule = currentModules === null ? undefined : moduleIn(currentModules, anchor.moduleId);
          const before = beforeModule?.interfaces.find(item => item.id === anchor.interfaceId);
          const after = afterModule?.interfaces.find(item => item.id === anchor.interfaceId);
          if (before === undefined || after === undefined
            || canonicalJson(before as unknown as JsonValue) !== canonicalJson(after as unknown as JsonValue)) {
            staleReasons.push('module_definition_changed');
          }
        }
      }
    }
    return { ok: true, value: { staleReasons, unchecked } };
  }

  /**
   * MF13/R13: the authoring agent Run's task scope in the Run's bound plan. A
   * failed Run/plan read is `unavailable`, never a definite mismatch.
   */
  async function agentRunTaskScope(ctx: CoreCallContext, runRef: RunRef):
  Promise<Outcome<{ moduleRef: string | null }>> {
    const refKey = canonicalJson(runRef as unknown as JsonValue);
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return reject('unavailable', read.reason);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return reject('unavailable', 'the authoring Run cannot be read');
    const decoded = decodeRun(record);
    if (!decoded.ok) return reject('unavailable', decoded.reason);
    const run = decoded.value;
    const planKey = planRevisionRefKey(run.planRef);
    const planRead = await deps.records.readMany([planKey]);
    if (planRead.status !== 'ready') return reject('unavailable', planRead.reason);
    const planRecord = planRead.value.records.find(candidate => candidate.refKey === planKey);
    if (planRecord === undefined) return reject('unavailable', 'the Run bound plan cannot be read');
    const planDecoded = decodePlanRevisionSnapshot(planRecord);
    if (planDecoded.status !== 'decoded') return reject('unavailable', 'the Run bound plan is damaged');
    const task = planDecoded.value.tasks.find(candidate => candidate.taskId === run.task.taskId);
    const scope = task?.scope;
    return { ok: true, value: { moduleRef: scope !== undefined && scope.kind === 'module' ? scope.moduleRef : null } };
  }

  /** MF13/R13: a `file` fact for the path, or a `counted` RunActivity listing it. */
  async function hasDeletionProof(ctx: CoreCallContext, body: CheckBody, path: string): Promise<Outcome<boolean>> {
    for (const fact of body.facts) {
      if (fact.kind === 'file' && fact.path === path) return { ok: true, value: true };
      if (fact.kind !== 'record' || (fact.ref as { aggregateType?: string }).aggregateType !== 'RunActivity') continue;
      const refKey = canonicalJson(fact.ref as unknown as JsonValue);
      const read = await deps.records.readMany([refKey]);
      // R13: a failed read is `unavailable`, never "no proof".
      if (read.status !== 'ready') return reject('unavailable', read.reason);
      const record = read.value.records.find(candidate => candidate.refKey === refKey);
      if (record === undefined) continue;
      const decoded = decodeRunActivitySnapshot(record);
      // R13: an undecodable proof record is `unavailable`, never unproved.
      if (decoded.status !== 'decoded') return reject('unavailable', decoded.reason);
      if (decoded.value.facts.status === 'counted'
        && decoded.value.facts.changedFiles.definite.includes(path)) return { ok: true, value: true };
    }
    return { ok: true, value: false };
  }

  /** L2a class 5 / §4 rule 23: the three post-write hints. */
  async function classFiveHints(ctx: CoreCallContext, body: CheckBody, caches: CheckCaches): Promise<Outcome<NoteHintV1[]>> {
    const hints: NoteHintV1[] = [];
    const anchors = [body.anchor, ...body.extraAnchors];
    const moduleAnchors = anchors.filter((anchor): anchor is Extract<NoteAnchorV1, { kind: 'module' | 'interface' }> =>
      anchor.kind === 'module' || anchor.kind === 'interface');
    const fileAnchors = anchors.filter((anchor): anchor is Extract<NoteAnchorV1, { kind: 'file' }> => anchor.kind === 'file');
    let catalog: AdoptedArchitecture | null = null;
    if (moduleAnchors.length > 0 || fileAnchors.length > 0) {
      const read = await currentArchitecture(ctx, caches);
      if (!read.ok) return read;
      catalog = read.value?.catalog?.catalog ?? null;
    }
    const attributedModuleOf = (path: string): string | null => catalog === null ? null
      : mapExecutedFilesToModules(catalog, [{ path, certainty: 'definite' as const }])[0]?.moduleRef?.moduleId ?? null;

    // R13: longest-prefix attribution; the root `"."` owns nothing. A file
    // anchor contributes its own attributed module to the anchored set.
    if ((moduleAnchors.length > 0 || fileAnchors.length > 0) && body.basis.files.length > 0 && catalog !== null) {
      const anchored = new Set<string>(moduleAnchors.map(anchor => anchor.moduleId));
      for (const anchor of fileAnchors) {
        const moduleId = attributedModuleOf(anchor.path);
        if (moduleId !== null) anchored.add(moduleId);
      }
      const mapped = mapExecutedFilesToModules(catalog,
        body.basis.files.map(file => ({ path: file.path, certainty: 'definite' as const })));
      if (!mapped.some(entry => entry.moduleRef !== null && anchored.has(entry.moduleRef.moduleId))) {
        hints.push('basis_outside_anchor');
      }
    }

    // R13: only agent-written notes, against the authoring Run's bound plan.
    if (fileAnchors.length > 0 && catalog !== null && body.source.kind === 'agent' && body.source.runRef !== null) {
      const scope = await agentRunTaskScope(ctx, body.source.runRef);
      if (!scope.ok) return scope;
      if (scope.value.moduleRef !== null) {
        for (const file of fileAnchors) {
          const fileModule = attributedModuleOf(file.path);
          if (fileModule !== null && fileModule !== scope.value.moduleRef) {
            hints.push('file_module_mismatch');
            break;
          }
        }
      }
    }

    // R13: every `deleted: true` file anchor needs resolved deletion evidence.
    for (const anchor of fileAnchors) {
      if (anchor.deleted !== true) continue;
      const proof = await hasDeletionProof(ctx, body, anchor.path);
      if (!proof.ok) return proof;
      if (proof.value) continue;
      hints.push('deleted_path_unverified');
    }
    return { ok: true, value: hints };
  }

  async function resolveFact(ctx: CoreCallContext, fact: NoteFactV1, budget: CheckBudget,
    itemObs: ItemObservations): Promise<Outcome<FactOutcome>> {
    switch (fact.kind) {
      case 'commit':
        return { ok: true, value: COMMIT_SHA.test(fact.sha)
          ? { kind: 'unchecked' } : { kind: 'unresolved', reason: 'invalid_commit_format' } };
      case 'note': {
        const note = await readHead(ctx.projectId, fact.noteId);
        if (!note.ok) {
          return { ok: true, value: note.code === 'not_found'
            ? { kind: 'unresolved', reason: 'not_found' } : { kind: 'unresolved', reason: 'unavailable' } };
        }
        if (note.value === null) return { ok: true, value: { kind: 'unresolved', reason: 'not_found' } };
        if (fact.version > note.value.version) return { ok: true, value: { kind: 'unresolved', reason: 'version_ahead' } };
        if (RETIRED_NOTE_STATES.includes(note.value.state)) return { ok: true, value: { kind: 'basis_note_retired' } };
        return { ok: true, value: { kind: 'untouched' } };
      }
      case 'file': {
        // R1: format before reading — a bad digest is the new
        // `invalid_file_digest`; a path outside the workspace is `forbidden`.
        if (!FILE_DIGEST.test(fact.digest)) return { ok: true, value: { kind: 'unresolved', reason: 'invalid_file_digest' } };
        if (!isSafeRelativePath(fact.path)) return { ok: true, value: { kind: 'unresolved', reason: 'forbidden' } };
        // R3: the fact's path shares the call-level observation budget.
        const observed = await observeForItem(ctx, budget, itemObs, fact.path, fact.digest);
        if (observed.outcome === 'unchecked') return { ok: true, value: { kind: 'budget' } };
        if (observed.outcome === 'deleted') return { ok: true, value: { kind: 'changed', path: fact.path, deleted: true } };
        if (observed.outcome === 'same') return { ok: true, value: { kind: 'untouched' } };
        if (observed.outcome === 'changed') return { ok: true, value: { kind: 'changed', path: fact.path, deleted: false } };
        return { ok: true, value: { kind: 'unresolved',
          reason: observed.outcome === 'forbidden' ? 'forbidden' : 'unavailable' } };
      }
      case 'record': {
        const refKey = canonicalJson(fact.ref as unknown as JsonValue);
        const read = await deps.records.readMany([refKey]);
        if (read.status !== 'ready') return { ok: true, value: { kind: 'unresolved', reason: 'unavailable' } };
        const record = read.value.records.find(candidate => candidate.refKey === refKey);
        const isMessage = (fact.ref as { aggregateType?: string }).aggregateType === 'SessionMessage';
        if (record === undefined) {
          return { ok: true, value: isMessage ? { kind: 'source_unavailable' } : { kind: 'unresolved', reason: 'not_found' } };
        }
        // R1: a record pointer resolves when its current revision is >= the
        // pointer's revision; the digest, when present, is not compared. This
        // applies to a `SessionMessage` too, before its decoder runs.
        if (fact.revision > record.revision) return { ok: true, value: { kind: 'unresolved', reason: 'version_ahead' } };
        if (isMessage) {
          const decoded = decodeSessionMessageRecord(record);
          return { ok: true, value: decoded.status === 'decoded' ? { kind: 'untouched' } : { kind: 'source_unavailable' } };
        }
        const decoded = decodeRefKey(record.refKey);
        if (decoded.status === 'decoded' && decoded.value.aggregateType !== (fact.ref as { aggregateType?: string }).aggregateType) {
          return { ok: true, value: { kind: 'unresolved', reason: 'kind_mismatch' } };
        }
        return { ok: true, value: { kind: 'untouched' } };
      }
      case 'artifact': {
        // R1: existence through the raw artifact store; the check reads no body
        // and is not authorization-gated.
        if (deps.artifacts === undefined) return { ok: true, value: { kind: 'unresolved', reason: 'unavailable' } };
        const read = await deps.artifacts.read(fact.ref);
        if (read.status === 'ready') return { ok: true, value: { kind: 'untouched' } };
        const code: string = read.code;
        return { ok: true, value: { kind: 'unresolved', reason: code === 'not_found' ? 'not_found'
          : code === 'forbidden' ? 'forbidden' : 'unavailable' } };
      }
      case 'kernel_history': {
        // R1: the Run record and its execution-history locator; the Kernel
        // entries themselves are never read here.
        const refKey = canonicalJson(fact.runRef as unknown as JsonValue);
        const read = await deps.records.readMany([refKey]);
        if (read.status !== 'ready') return { ok: true, value: { kind: 'unresolved', reason: 'unavailable' } };
        const record = read.value.records.find(candidate => candidate.refKey === refKey);
        if (record === undefined) return { ok: true, value: { kind: 'unresolved', reason: 'not_found' } };
        const decoded = decodeRun(record);
        if (!decoded.ok) return { ok: true, value: { kind: 'unresolved', reason: 'unavailable' } };
        const history = decoded.value.executionHistory;
        if (history === undefined) return { ok: true, value: { kind: 'unresolved', reason: 'not_found' } };
        const sessionMatches = history.sessionRef.projectId === fact.sessionRef.projectId
          && history.sessionRef.sessionId === fact.sessionRef.sessionId;
        const kernelMatches = history.kernel.adapterId === fact.adapterId
          && history.kernel.kernelSessionId === fact.kernelSessionId
          && history.kernel.runId === fact.kernelRunId && history.kernel.turnId === fact.turnId;
        if (!sessionMatches || !kernelMatches) return { ok: true, value: { kind: 'unresolved', reason: 'kind_mismatch' } };
        const observed = history.endPosition ?? history.observedThroughPosition;
        if (fact.throughPosition > observed) return { ok: true, value: { kind: 'unresolved', reason: 'version_ahead' } };
        return { ok: true, value: { kind: 'untouched' } };
      }
      default:
        return { ok: true, value: { kind: 'untouched' } };
    }
  }

  /** L9: the staged repair's OWN Run (`stagedRunKey`) names the owning task. */
  async function stagedRepairTask(ctx: CoreCallContext, stagedRunKey: string | null):
  Promise<Outcome<{ goalId: string; taskId: string } | null>> {
    if (stagedRunKey === null) return { ok: true, value: null };
    const separator = stagedRunKey.indexOf('/');
    if (separator <= 0 || separator === stagedRunKey.length - 1) return { ok: true, value: null };
    const goalId = stagedRunKey.slice(0, separator);
    const runId = stagedRunKey.slice(separator + 1);
    const refKey = canonicalJson({ aggregateType: 'Run', projectId: ctx.projectId, goalId, runId } as unknown as JsonValue);
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return reject('unavailable', read.reason);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return reject('unavailable', 'the staged repair Run cannot be read');
    const decoded = decodeRun(record);
    if (!decoded.ok) return reject('unavailable', decoded.reason);
    return { ok: true, value: { goalId: decoded.value.task.goalId, taskId: decoded.value.task.taskId } };
  }

  /**
   * Slice 4B L22/P12 (M-13): similar notes for the write-side check. Candidate
   * set = current (accepted/reviewed/pending_review) notes sharing an anchor key,
   * excluding self and anything named in the subject's relations. Similarity is
   * Jaccard over the bigram windows of `normalize(topic) + "\n" +
   * normalize(conclusion)`. At most `NOTE_SIMILAR_MAX`, ties by `noteId`; it
   * never blocks a write.
   */
  async function similarNotes(ctx: CoreCallContext, body: CheckBody): Promise<Outcome<NoteSimilarV1[]>> {
    const keys = [body.anchor, ...body.extraAnchors].map(anchorKeyOf);
    const excluded = new Set<string>([body.noteId, ...body.replaces, ...body.contradicts, ...body.coexistWith]);
    const candidates = new Map<string, NoteHeadSnapshot>();
    for (const key of keys) {
      for (const index of S4_NOTE_BY_ANCHOR_LOOKUPS) {
        // L22: ONE bounded anchor-lookup page per index, never a next-loop.
        const page = await deps.records.lookup({ index, values: [ctx.projectId, key], limit: NOTE_SIMILAR_SCAN });
        if (page.status !== 'ready') return reject('unavailable', page.reason);
        for (const record of page.value.records) {
          const decoded = decodeNoteHeadSnapshot(record);
          if (decoded.status !== 'decoded') return reject('unavailable', 'damaged note head');
          const head = decoded.value;
          if (![head.anchorKey0, head.anchorKey1, head.anchorKey2, head.anchorKey3, head.anchorKey4].includes(key)) continue;
          if (excluded.has(head.noteId)) continue;
          if (head.state !== 'accepted' && head.state !== 'reviewed' && head.state !== 'pending_review') continue;
          candidates.set(head.noteId, head);
        }
      }
    }
    const windowsOf = (topic: string, conclusion: string): Set<string> =>
      new Set(bigramWindows(`${normalizeSearchText(topic)}\n${normalizeSearchText(conclusion)}`));
    const subject = windowsOf(body.topic, body.conclusion);
    const scored: NoteSimilarV1[] = [];
    for (const head of candidates.values()) {
      const other = windowsOf(head.topic, head.conclusion);
      let intersection = 0;
      for (const window of subject) if (other.has(window)) intersection += 1;
      const union = subject.size + other.size - intersection;
      const similarity = union === 0 ? 0 : intersection / union;
      if (similarity < NOTE_SIMILAR_MIN) continue;
      scored.push({ noteId: head.noteId, version: head.version,
        header: renderNoteHeader({ kind: head.kind, anchor: head.anchor, structural: head.structural,
          conclusion: head.conclusion }), similarity });
    }
    scored.sort((left, right) => right.similarity - left.similarity || (left.noteId < right.noteId ? -1 : 1));
    return { ok: true, value: scored.slice(0, NOTE_SIMILAR_MAX) };
  }

  async function checkOne(ctx: CoreCallContext, item: { noteId: string; version: number }, budget: CheckBudget,
    withSimilar: boolean, caches: CheckCaches):
  Promise<Outcome<NoteCheckV1>> {
    const headOutcome = await readHead(ctx.projectId, item.noteId);
    if (!headOutcome.ok) return headOutcome;
    const head = headOutcome.value;
    if (head === null) return reject('not_found', 'the note does not exist');
    let body = bodyOfHead(head);
    const stagedRunKey: string | null = head.stagedRunKey;
    if (item.version !== head.version) {
      const version = await readVersion(ctx.projectId, item.noteId, item.version);
      if (!version.ok) return version;
      if (version.value === null) return reject('not_found', 'the note version does not exist');
      body = bodyOfVersion(version.value);
    }

    const cache = newHeadCache();
    const conflicting = await derivations.conflictingOf(ctx.projectId, head as NoteHeadLike, cache);
    if (!conflicting.ok) return conflicting;
    const overQuota = await derivations.overQuotaOf(ctx.projectId, head, cache);
    if (!overQuota.ok) return overQuota;

    const changedFiles: { path: string; deleted: boolean }[] = [];
    const staleReasons: string[] = [];
    const unresolvedFacts: { index: number; reason: UnresolvedReason }[] = [];
    const uncheckedFacts: number[] = [];
    const hints: NoteHintV1[] = [];
    const itemObs: ItemObservations = new Map();
    let unchecked = false;
    let sourceUnavailable = false;

    // R3: the check's ONE observation pass. Basis files first, then file facts,
    // then file anchors; all share the call's distinct-file budget.
    for (const file of body.basis.files) {
      const observation = await observeForItem(ctx, budget, itemObs, file.path, file.digest);
      if (observation.outcome === 'changed') { changedFiles.push({ path: observation.path, deleted: false }); staleReasons.push('file_changed'); }
      else if (observation.outcome === 'deleted') { changedFiles.push({ path: observation.path, deleted: true }); staleReasons.push('file_deleted'); }
      else if (observation.outcome !== 'same') unchecked = true;
    }

    const definitions = await definitionStaleness(ctx, body, caches);
    if (!definitions.ok) return definitions;
    staleReasons.push(...definitions.value.staleReasons);
    if (definitions.value.unchecked) unchecked = true;

    // R13: deletion is the expected state for a `deleted: true` file anchor, so
    // a proving `file` fact's `deleted` outcome never makes the note stale.
    const deletedAnchorPaths = new Set([body.anchor, ...body.extraAnchors]
      .flatMap(anchor => anchor.kind === 'file' && anchor.deleted === true ? [anchor.path] : []));

    for (let index = 0; index < body.facts.length; index += 1) {
      if (budget.factsRemaining <= 0) { uncheckedFacts.push(index); unchecked = true; continue; }
      budget.factsRemaining -= 1;
      const resolved = await resolveFact(ctx, body.facts[index]!, budget, itemObs);
      if (!resolved.ok) return resolved;
      const outcome = resolved.value;
      if (outcome.kind === 'budget') { uncheckedFacts.push(index); unchecked = true; }
      else if (outcome.kind === 'unchecked') uncheckedFacts.push(index);
      else if (outcome.kind === 'unresolved') unresolvedFacts.push({ index, reason: outcome.reason });
      else if (outcome.kind === 'changed') {
        if (outcome.deleted && deletedAnchorPaths.has(outcome.path)) continue;
        changedFiles.push({ path: outcome.path, deleted: outcome.deleted }); staleReasons.push('file_changed');
      }
      else if (outcome.kind === 'source_unavailable') sourceUnavailable = true;
      else if (outcome.kind === 'basis_note_retired') staleReasons.push('basis_note_retired');
    }

    let invalid = false;
    if (body.state === 'staged' && body.kind === 'repair') {
      const staged = await stagedRepairTask(ctx, stagedRunKey);
      if (!staged.ok) return staged;
      if (staged.value === null) {
        // The staged repair's own Run cannot be identified; never guess live.
        unchecked = true;
      } else {
        const plan = await currentPlan(ctx, staged.value.goalId, caches);
        if (!plan.ok) return plan;
        if (plan.value !== null) {
          const task = plan.value.tasks.find(candidate => candidate.taskId === staged.value!.taskId);
          if (task === undefined || RETIRED_TASK_DISPOSITIONS.includes(task.disposition)) invalid = true;
        } else {
          unchecked = true;
        }
      }
    }

    const hintOutcome = await classFiveHints(ctx, body, caches);
    if (!hintOutcome.ok) return hintOutcome;
    hints.push(...hintOutcome.value);

    const anchor = await anchorStatusOf(ctx, body, budget, itemObs, caches);
    if (!anchor.ok) return anchor;
    staleReasons.push(...anchor.value.staleReasons);
    if (anchor.value.unchecked) unchecked = true;

    let freshness: NoteCheckV1['freshness'] = 'fresh';
    if (unchecked || unresolvedFacts.length > 0) freshness = 'unchecked';
    else if (staleReasons.length > 0 || anchor.value.retired) freshness = 'stale';

    const stateEligible = body.state === 'accepted' || body.state === 'reviewed';
    // R11: only the head version can be a current conclusion, even when the
    // caller reaches `checkNotes` directly (the read model's own mask is not
    // the only boundary).
    const isHeadVersion = item.version === head.version;
    // L9: an `accepted` note is a current conclusion only in the caller's own
    // goal or when the user confirmed it; `reviewed` carries no goal condition.
    const callerGoalId = ctx.principal.kind === 'work_run' ? ctx.principal.runRef.goalId : null;
    const ownGoalEligible = body.state !== 'accepted' || callerGoalId === null
      || head.goalId === callerGoalId || head.confirmedByUser;
    const currentEligible = stateEligible && ownGoalEligible && isHeadVersion && freshness === 'fresh'
      && !conflicting.value && !invalid && !sourceUnavailable && !anchor.value.retired && unresolvedFacts.length === 0;

    let similar: NoteSimilarV1[] | undefined;
    if (withSimilar) {
      const computed = await similarNotes(ctx, body);
      if (!computed.ok) return computed;
      similar = computed.value;
    }

    return { ok: true, value: {
      noteId: body.noteId, version: body.version,
      observedFiles: [...itemObs.values()],
      freshness, changedFiles, staleReasons,
      sourceUnavailable, invalid, conflicting: conflicting.value, overQuota: overQuota.value, updateDue: null,
      currentEligible,
      anchorStatus: anchor.value.retired ? 'retired' : 'live',
      anchorRetiredReasons: anchor.value.reasons,
      retiredExtraAnchors: anchor.value.retiredExtraAnchors,
      unresolvedFacts, uncheckedFacts, hints,
      ...(similar === undefined ? {} : { similar }),
    } };
  }

  return {
    async checkNotes(ctx, input): Promise<ReadResult<NoteCheckV1[]>> {
      if (!Array.isArray(input.items)) return { status: 'rejected', code: 'invalid', reason: 'items must be an array' };
      // R2: one cache set per call; nothing survives the call.
      const caches = newCheckCaches();
      const budget = newCheckBudget(limits);
      const results: NoteCheckV1[] = [];
      for (const item of input.items) {
        if (typeof item?.noteId !== 'string' || item.noteId.length === 0 || !Number.isSafeInteger(item.version)) {
          return { status: 'rejected', code: 'invalid', reason: 'each item needs a note id and a version' };
        }
        const outcome = await checkOne(ctx, item, budget, input.withSimilar === true, caches);
        if (!outcome.ok) return mapStoreFailure(outcome);
        results.push(outcome.value);
      }
      return { status: 'ready', value: results };
    },
  };
}
