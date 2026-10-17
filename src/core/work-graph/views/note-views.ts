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
import type { NoteCheckPort, NoteCheckV1, NoteFileObservationV1, NoteHeadCheckItemV1, NoteHeadCheckPort, NoteHintV1, NoteSimilarV1,
  NoteUpdateDueTriggerV1, UnderstandingStatusV1 } from '../model/note-contracts.js';
import { NOTE_ANCHOR_QUOTA, NOTE_BASIS_FILE_MAX_BYTES, NOTE_GOAL_QUOTA, NOTE_READ_FACTS_MAX, NOTE_READ_FILES_MAX,
  NOTE_SIMILAR_MAX, NOTE_SIMILAR_MIN, NOTE_SYMBOL_HITS_MAX, NOTE_SYMBOL_RECHECK_MAX } from '../model/note-contracts.js';
import { anchorKeyOf, isSafeRelativePath, signatureDigestOf, type NoteAnchorWorkspace } from '../notes/note-anchors.js';
import { foldInputOf, foldUpdateDue } from '../notes/note-update-due.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { CaptureSummary, SourceHit, SourceProvider } from '../../workspace/ports.js';
import {
  createNoteHeadDerivations, mapStoreFailure, newHeadCache,
  type HeadCache, type NoteHeadDerivations, type NoteHeadLike,
} from '../notes/note-read-model.js';
import {
  S4_NOTE_BY_ANCHOR_LOOKUPS, decodeNoteHeadSnapshot, decodeNoteVersionSnapshot, noteHeadRefKey, noteVersionRefKey,
  currentPointerRefKey, decodeCurrentPointerSnapshot,
} from '../persistence/note-record-codecs.js';
import { S2B_PLAN_REVISION_BY_GOAL_LOOKUP, decodePlanRevisionSnapshot, planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import { stageContinuityOf } from '../notes/note-continuity.js';
import { readGoalPlanWindow, readGoalTriggerRecords } from '../tasks/plan-readers.js';
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
 * S2.3: one head cache is shared by every item of the call, seeded by the read
 * model with the anchor sets it already read.
 */
type CheckCaches = {
  plans: Map<string, Outcome<PlanRevisionSnapshot | null>>;
  /**
   * U-3 (§11.5): per goal, the trigger read, keyed `${projectId}\0${goalId}`
   * exactly as `plans`. Read once per call and reused by every item and by
   * `understandingAnchors`; a goal with no current plan caches the empty read.
   */
  triggers: Map<string, Outcome<{ triggers: NoteUpdateDueTriggerV1[];
    claimedArchiveKeys: ReadonlySet<string> }>>;
  /** U-3: the per-anchor understanding status, so a goal/stage pointer is read once. */
  understandings: Map<string, Outcome<UnderstandingStatusV1>>;
  /**
   * Rework item 8: pointers and pointed heads the caller already read, keyed
   * `${projectId}\0${anchorKey}` exactly as `understandings`. A seeded anchor
   * skips its own pointer and head reads.
   */
  understandingSeed: Map<string, { pointer: { noteId: string | null; revision: number | null };
    head: NoteHeadSnapshot | null }>;
  architecture: {
    current?: Outcome<ArchitectureRevision | null>;
    byRevision: Map<number, Outcome<ArchitectureRevision | null>>;
  };
  heads: HeadCache;
  /** S2.6 (b4): `conflicting`/`overQuota` per `noteId@head.version`. */
  derivations: Map<string, { conflicting: boolean; overQuota: boolean }>;
  /** S2.6 (b9): the Run task scope per Run ref. */
  runTaskScope: Map<string, Outcome<{ moduleRef: string | null }>>;
  /** S2.6 (b10): two separate caches, never one merged map. */
  planRevisions: Map<string, Outcome<Map<number, PlanRevisionSnapshot>>>;
  basisPlans: Map<string, Outcome<PlanRevisionSnapshot | null>>;
  /** S2.6: the staged repair task per staged Run key. */
  stagedRepair: Map<string, Outcome<{ goalId: string; taskId: string } | null>>;
  /** S2.6: `note` fact head reads per ref; successes only. */
  noteHeads: Map<string, Outcome<NoteHeadSnapshot | null>>;
};

function newCheckCaches(): CheckCaches {
  return { plans: new Map(), triggers: new Map(), understandings: new Map(), understandingSeed: new Map(),
    architecture: { byRevision: new Map() }, heads: newHeadCache(),
    derivations: new Map(), runTaskScope: new Map(), planRevisions: new Map(), basisPlans: new Map(),
    stagedRepair: new Map(), noteHeads: new Map() };
}

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

export function createNoteCheck(deps: NoteCheckDependencies): NoteHeadCheckPort {
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

  /**
   * S2.6: a `note` fact's head read is memoized per ref for the call. Only a
   * success (including a definite `null`) is cached; a failed read is not.
   */
  async function readHeadCached(ctx: CoreCallContext, noteId: string, caches: CheckCaches):
  Promise<Outcome<NoteHeadSnapshot | null>> {
    const key = `${ctx.projectId}\u0000${noteId}`;
    const hit = caches.noteHeads.get(key);
    if (hit !== undefined) return hit;
    const outcome = await readHead(ctx.projectId, noteId);
    if (outcome.ok) caches.noteHeads.set(key, outcome);
    return outcome;
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

  /**
   * §11.5/U-3: the goal's trigger read, cached per goal for the call exactly as
   * `plans`. A goal with no current plan has no triggers (a legal empty read);
   * any failure (including `unsupported`) rejects the whole check.
   */
  async function currentTriggers(ctx: CoreCallContext, goalId: string, caches: CheckCaches):
  Promise<Outcome<{ triggers: NoteUpdateDueTriggerV1[]; claimedArchiveKeys: ReadonlySet<string> }>> {
    const key = `${ctx.projectId}\u0000${goalId}`;
    const hit = caches.triggers.get(key);
    if (hit !== undefined) return hit;
    const plan = await currentPlan(ctx, goalId, caches);
    let outcome: Outcome<{ triggers: NoteUpdateDueTriggerV1[]; claimedArchiveKeys: ReadonlySet<string> }>;
    if (!plan.ok) outcome = plan;
    else if (plan.value === null) outcome = { ok: true, value: { triggers: [], claimedArchiveKeys: new Set() } };
    else {
      const ref: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
      const read = await readGoalTriggerRecords(deps.records, ref, plan.value);
      outcome = read.status === 'ready'
        ? { ok: true, value: { triggers: read.triggers, claimedArchiveKeys: read.claimedArchiveKeys } }
        : reject('unavailable', readFailureReason(read, 'the goal triggers cannot be read'));
    }
    caches.triggers.set(key, outcome);
    return outcome;
  }

  type ParsedUnderstandingAnchor =
    | { kind: 'project' }
    | { kind: 'goal'; goalId: string }
    | { kind: 'stage'; goalId: string; stageId: string };

  /**
   * §11.5: `understandingAnchors` are the anchor keys `checkHeads` was asked
   * for. The project anchor is `project`; the others are `goal:<id>` and
   * `stage:<goalId>/<planRevision>/<stageId>`. A key that is none of these is
   * not an understanding anchor.
   */
  function parseUnderstandingAnchorKey(anchorKey: string): ParsedUnderstandingAnchor | null {
    if (anchorKey === 'project') return { kind: 'project' };
    if (anchorKey.startsWith('goal:')) {
      const goalId = anchorKey.slice('goal:'.length);
      return goalId.length === 0 ? null : { kind: 'goal', goalId };
    }
    if (!anchorKey.startsWith('stage:')) return null;
    const rest = anchorKey.slice('stage:'.length);
    const first = rest.indexOf('/');
    const second = first < 0 ? -1 : rest.indexOf('/', first + 1);
    if (first <= 0 || second <= first + 1 || second === rest.length - 1) return null;
    return { kind: 'stage', goalId: rest.slice(0, first), stageId: rest.slice(second + 1) };
  }

  /**
   * §11.4/§11.5/U-3: one anchor's `UnderstandingStatusV1` from the same caches
   * the item check uses. The project anchor stays `updateDue: null` (M-12g); a
   * goal/stage anchor folds the trigger read. Memoized per anchor, so a lookup
   * reads its pointer once and a goal's triggers once.
   */
  async function understandingOfAnchorKey(ctx: CoreCallContext, anchorKey: string, caches: CheckCaches):
  Promise<Outcome<UnderstandingStatusV1>> {
    const cacheKey = `${ctx.projectId}\u0000${anchorKey}`;
    const hit = caches.understandings.get(cacheKey);
    if (hit !== undefined) return hit;
    const outcome = await computeUnderstandingOfAnchorKey(ctx, anchorKey, caches);
    caches.understandings.set(cacheKey, outcome);
    return outcome;
  }

  async function computeUnderstandingOfAnchorKey(ctx: CoreCallContext, anchorKey: string, caches: CheckCaches):
  Promise<Outcome<UnderstandingStatusV1>> {
    const parsed = parseUnderstandingAnchorKey(anchorKey);
    if (parsed === null) return reject('invalid', `not an understanding anchor: ${anchorKey}`);
    // Rework item 8: when the caller already read this anchor's pointer and
    // pointed head, use them and skip both reads (the project branch too).
    const seed = caches.understandingSeed.get(`${ctx.projectId}\u0000${anchorKey}`);
    let pointer: { noteId: string | null; revision: number | null } = { noteId: null, revision: null };
    if (seed !== undefined) {
      pointer = seed.pointer;
    } else {
      // §11.4: the same pointer key the write side uses.
      const pointerKey = currentPointerRefKey({ aggregateType: 'CurrentPointer', projectId: ctx.projectId, anchorKey });
      const pointerRead = await deps.records.readMany([pointerKey]);
      if (pointerRead.status !== 'ready') {
        return reject('unavailable', readFailureReason(pointerRead, 'the current pointer cannot be read'));
      }
      const pointerRecord = pointerRead.value.records.find(candidate => candidate.refKey === pointerKey);
      if (pointerRecord !== undefined) {
        const decoded = decodeCurrentPointerSnapshot(pointerRecord);
        if (decoded.status !== 'decoded') return reject('unavailable', 'damaged current pointer');
        pointer = { noteId: decoded.value.noteId, revision: decoded.value.revision };
      }
    }
    if (parsed.kind === 'project') {
      return { ok: true, value: { anchorKey, pointer, updateDue: null, latestTriggerCursor: null } };
    }

    const plan = await currentPlan(ctx, parsed.goalId, caches);
    if (!plan.ok) return plan;
    const triggers = await currentTriggers(ctx, parsed.goalId, caches);
    if (!triggers.ok) return triggers;

    let head: NoteHeadSnapshot | null = seed === undefined ? null : seed.head;
    if (seed === undefined && pointer.noteId !== null) {
      const read = await readHeadCached(ctx, pointer.noteId, caches);
      if (!read.ok) return read;
      head = read.value;
    }
    // Rework item 5: the one baseline rule, shared with the to-dos and the reader.
    const anchor = foldInputOf(anchorKey, head, plan.value, parsed.kind === 'stage' ? parsed.stageId : null);
    const folded = foldUpdateDue({ triggers: triggers.value.triggers, plan: plan.value, anchors: [anchor] })[0]!;
    return { ok: true, value: { anchorKey, pointer, updateDue: folded.updateDue,
      latestTriggerCursor: folded.latestTriggerCursor } };
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

  /**
   * S2.6 (b8): a historical catalog revision is memoized per revision number
   * for the whole check call.
   */
  async function architectureRevision(ctx: CoreCallContext, revision: number, caches: CheckCaches):
  Promise<Outcome<ArchitectureRevision | null>> {
    const hit = caches.architecture.byRevision.get(revision);
    if (hit !== undefined) return hit;
    const current = await currentArchitecture(ctx, caches);
    if (!current.ok) return current;
    if (current.value === null || deps.architecture === undefined) return { ok: true, value: null };
    const read = await deps.architecture.readArchitectureRevision(ctx,
      { selection: { kind: 'revision', ref: { ...current.value.baseline.ref, revision } } });
    const outcome: Outcome<ArchitectureRevision | null> = read.status === 'ready'
      ? { ok: true, value: read.value }
      : reject('unavailable', readFailureReason(read, 'the basis catalog revision cannot be read'));
    caches.architecture.byRevision.set(revision, outcome);
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
    planRevision: number, caches: CheckCaches): Promise<Outcome<PlanRevisionSnapshot | null>> {
    // S2.6 (b10): one cache per (goal, revision number).
    const key = `${ctx.projectId}\u0000${goalId}\u0000${String(planRevision)}`;
    const hit = caches.basisPlans.get(key);
    if (hit !== undefined) return hit;
    let after: { order: string | number; refKey: string } | undefined;
    for (;;) {
      const page = await deps.records.lookupOrdered({ index: S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
        values: [ctx.projectId, goalId], direction: 'asc', ...(after === undefined ? {} : { after }), limit: 200 });
      if (page.status !== 'ready') return reject('unavailable', page.reason);
      for (const record of page.value.records) {
        const decoded = decodePlanRevisionSnapshot(record);
        if (decoded.status === 'decoded' && decoded.value.planRevision === planRevision) {
          const found: Outcome<PlanRevisionSnapshot | null> = { ok: true, value: decoded.value };
          caches.basisPlans.set(key, found);
          return found;
        }
      }
      if (page.value.next === null) {
        const missing: Outcome<PlanRevisionSnapshot | null> = { ok: true, value: null };
        caches.basisPlans.set(key, missing);
        return missing;
      }
      after = page.value.next;
    }
  }

  /**
   * MF5/R5: every adopted PlanRevision of one Goal, keyed by its revision
   * number, read once through the S2B index. A store failure is `unavailable`.
   * S2.6 (b10): memoized per goal for the whole call.
   */
  async function planRevisionsOfGoal(ctx: CoreCallContext, goalId: string, caches: CheckCaches):
  Promise<Outcome<Map<number, PlanRevisionSnapshot>>> {
    const key = `${ctx.projectId}\u0000${goalId}`;
    const hit = caches.planRevisions.get(key);
    if (hit !== undefined) return hit;
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
      if (page.value.next === null) {
        const outcome: Outcome<Map<number, PlanRevisionSnapshot>> = { ok: true, value: revisions };
        caches.planRevisions.set(key, outcome);
        return outcome;
      }
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
          const revisions = await planRevisionsOfGoal(ctx, anchor.goalId, caches);
          if (!revisions.ok) return revisions;
          // RW-5/§11.6 R4: the ONE shared continuity decision over the closed
          // revision window; a missing revision read makes it `unchecked`.
          const continuity = stageContinuityOf({ stageId: anchor.stageId,
            anchorRevision: anchor.planRevision, currentRevision: current.planRevision,
            stagesByRevision: new Map([...revisions.value].map(([revision, plan]) =>
              [revision, plan.stages.map(stage => stage.stageId)] as const)) });
          if (continuity.status === 'unchecked') { unchecked = true; return { ok: true, value: [] }; }
          if (continuity.status === 'retired') {
            return { ok: true, value: ['stage_not_in_current_plan'] };
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
      const basis = await basisPlanByNumber(ctx, anchor.goalId, body.basis.planRevision, caches);
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
      const basis = await architectureRevision(ctx, body.basis.catalogRevision, caches);
      if (!basis.ok) return basis;
      if (basis.value === null) return { ok: true, value: { staleReasons, unchecked: true } };
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
  async function agentRunTaskScope(ctx: CoreCallContext, runRef: RunRef, caches: CheckCaches):
  Promise<Outcome<{ moduleRef: string | null }>> {
    const refKey = canonicalJson(runRef as unknown as JsonValue);
    // S2.6 (b9): one Run task scope per Run ref for the whole call.
    const hit = caches.runTaskScope.get(refKey);
    if (hit !== undefined) return hit;
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
    const outcome: Outcome<{ moduleRef: string | null }> = { ok: true,
      value: { moduleRef: scope !== undefined && scope.kind === 'module' ? scope.moduleRef : null } };
    caches.runTaskScope.set(refKey, outcome);
    return outcome;
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
      const scope = await agentRunTaskScope(ctx, body.source.runRef, caches);
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
    itemObs: ItemObservations, caches: CheckCaches): Promise<Outcome<FactOutcome>> {
    switch (fact.kind) {
      case 'commit':
        return { ok: true, value: COMMIT_SHA.test(fact.sha)
          ? { kind: 'unchecked' } : { kind: 'unresolved', reason: 'invalid_commit_format' } };
      case 'note': {
        const note = await readHeadCached(ctx, fact.noteId, caches);
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
  async function stagedRepairTask(ctx: CoreCallContext, stagedRunKey: string | null, caches: CheckCaches):
  Promise<Outcome<{ goalId: string; taskId: string } | null>> {
    if (stagedRunKey === null) return { ok: true, value: null };
    const separator = stagedRunKey.indexOf('/');
    if (separator <= 0 || separator === stagedRunKey.length - 1) return { ok: true, value: null };
    // S2.6: one read per staged Run key for the whole call.
    const hit = caches.stagedRepair.get(stagedRunKey);
    if (hit !== undefined) return hit;
    const goalId = stagedRunKey.slice(0, separator);
    const runId = stagedRunKey.slice(separator + 1);
    const refKey = canonicalJson({ aggregateType: 'Run', projectId: ctx.projectId, goalId, runId } as unknown as JsonValue);
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return reject('unavailable', read.reason);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return reject('unavailable', 'the staged repair Run cannot be read');
    const decoded = decodeRun(record);
    if (!decoded.ok) return reject('unavailable', decoded.reason);
    const outcome: Outcome<{ goalId: string; taskId: string } | null> = { ok: true,
      value: { goalId: decoded.value.task.goalId, taskId: decoded.value.task.taskId } };
    caches.stagedRepair.set(stagedRunKey, outcome);
    return outcome;
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

  /**
   * S2.5: the one item body shared by `checkNotes` (which reads the head and
   * version first) and `checkHeads` (which is handed them). A supplied
   * `snapshot` is ignored when `version === head.version`.
   */
  async function checkItem(ctx: CoreCallContext, item: NoteHeadCheckItemV1, budget: CheckBudget,
    withSimilar: boolean, caches: CheckCaches):
  Promise<Outcome<NoteCheckV1>> {
    const head = item.head;
    let body = bodyOfHead(head);
    const stagedRunKey: string | null = head.stagedRunKey;
    if (item.version !== head.version) {
      let snapshot = item.snapshot;
      if (snapshot === undefined) {
        const version = await readVersion(ctx.projectId, head.noteId, item.version);
        if (!version.ok) return version;
        if (version.value === null) return reject('not_found', 'the note version does not exist');
        snapshot = version.value;
      }
      body = bodyOfVersion(snapshot);
    }

    const cache = caches.heads;
    // S2.6 (b4): `conflicting`/`overQuota` are memoized per noteId@head.version.
    const derivationKey = `${head.noteId}@${String(head.version)}`;
    // §11.3 (b11): a derivation the read model already made (conflicts) is handed
    // over per item and used instead of being recomputed here.
    const suppliedConflicting = item.version === head.version
      ? (item as NoteHeadCheckItemV1 & { conflicting?: boolean }).conflicting : undefined;
    let derived = caches.derivations.get(derivationKey);
    if (derived === undefined) {
      const conflicting = suppliedConflicting === undefined
        ? await derivations.conflictingOf(ctx.projectId, head as NoteHeadLike, cache)
        : { ok: true as const, value: suppliedConflicting };
      if (!conflicting.ok) return conflicting;
      const overQuota = await derivations.overQuotaOf(ctx.projectId, head, cache);
      if (!overQuota.ok) return overQuota;
      derived = { conflicting: conflicting.value, overQuota: overQuota.value };
      caches.derivations.set(derivationKey, derived);
    }

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
      const resolved = await resolveFact(ctx, body.facts[index]!, budget, itemObs, caches);
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
      const staged = await stagedRepairTask(ctx, stagedRunKey, caches);
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
    // L9/§11.4: an `accepted` note is a current conclusion only in the caller's
    // own goal or when the user confirmed it; `reviewed` carries no goal
    // condition, and the project understanding is current for every goal.
    const callerGoalId = ctx.principal.kind === 'work_run' ? ctx.principal.runRef.goalId : null;
    const isProjectUnderstanding = body.kind === 'understanding' && body.anchor.kind === 'project';
    const ownGoalEligible = isProjectUnderstanding || body.state !== 'accepted' || callerGoalId === null
      || head.goalId === callerGoalId || head.confirmedByUser;
    const currentEligible = stateEligible && ownGoalEligible && isHeadVersion && freshness === 'fresh'
      && !derived.conflicting && !invalid && !sourceUnavailable && !anchor.value.retired && unresolvedFacts.length === 0;

    let similar: NoteSimilarV1[] | undefined;
    if (withSimilar) {
      const computed = await similarNotes(ctx, body);
      if (!computed.ok) return computed;
      similar = computed.value;
    }

    // §11.5/M-12: only an accepted/reviewed HEAD understanding on a goal or
    // stage anchor carries `updateDue`; the project anchor and every other item
    // stay `null` (M-12g).
    let updateDue: boolean | null = null;
    if (isHeadVersion && body.kind === 'understanding'
      && (body.anchor.kind === 'goal' || body.anchor.kind === 'stage')
      && (body.state === 'accepted' || body.state === 'reviewed')) {
      const status = await understandingOfAnchorKey(ctx, anchorKeyOf(body.anchor), caches);
      if (!status.ok) return status;
      updateDue = status.value.updateDue;
    }

    return { ok: true, value: {
      noteId: body.noteId, version: body.version,
      observedFiles: [...itemObs.values()],
      freshness, changedFiles, staleReasons,
      sourceUnavailable, invalid, conflicting: derived.conflicting, overQuota: derived.overQuota, updateDue,
      currentEligible,
      anchorStatus: anchor.value.retired ? 'retired' : 'live',
      anchorRetiredReasons: anchor.value.reasons,
      retiredExtraAnchors: anchor.value.retiredExtraAnchors,
      unresolvedFacts, uncheckedFacts, hints,
      ...(similar === undefined ? {} : { similar }),
    } };
  }

  return {
    /**
     * S2.5: the public shape is unchanged. It reads the head and version with
     * today's mapping and then runs the shared item body.
     */
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
        const headOutcome = await readHeadCached(ctx, item.noteId, caches);
        if (!headOutcome.ok) return mapStoreFailure(headOutcome);
        if (headOutcome.value === null) return mapStoreFailure(reject('not_found', 'the note does not exist'));
        const outcome = await checkItem(ctx,
          { head: headOutcome.value, version: item.version }, budget, input.withSimilar === true, caches);
        if (!outcome.ok) return mapStoreFailure(outcome);
        results.push(outcome.value);
      }
      return { status: 'ready', value: results };
    },
    /**
     * S2.5: the internal entry the read model uses. The heads arrive from
     * records read in the same call; the check never re-reads them.
     */
    async checkHeads(ctx, input): Promise<ReadResult<{ items: NoteCheckV1[]; understanding: UnderstandingStatusV1[] }>> {
      if (!Array.isArray(input.items)) return { status: 'rejected', code: 'invalid', reason: 'items must be an array' };
      const caches = newCheckCaches();
      if (input.anchorSets !== undefined) {
        // S2.3: seed exactly the sets the read model already read, keyed as its
        // own anchor cache keys them (never from a filtered set).
        for (const [key, heads] of input.anchorSets) caches.heads.anchors.set(key, { ok: true, value: heads });
      }
      if (input.planWindows !== undefined) {
        // Rework item 5(b): the read model's related-scope resolution already
        // read these goals' active plan windows; seed the check's own per-call
        // cache so `currentPlan` does not read the same window twice.
        for (const [key, plan] of input.planWindows) caches.plans.set(key, { ok: true, value: plan });
      }
      if (input.understandingPointers !== undefined) {
        // Rework item 8: the caller already read these pointers and pointed
        // heads; seed them so `computeUnderstandingOfAnchorKey` skips its own
        // per-anchor pointer and head reads for the whole call.
        for (const [key, seed] of input.understandingPointers) caches.understandingSeed.set(key, seed);
      }
      const budget = newCheckBudget(limits);
      const results: NoteCheckV1[] = [];
      for (const item of input.items) {
        if (item?.head === undefined || typeof item.head.noteId !== 'string'
          || !Number.isSafeInteger(item.version)) {
          return { status: 'rejected', code: 'invalid', reason: 'each item needs a head and a version' };
        }
        const outcome = await checkItem(ctx, item, budget, false, caches);
        if (!outcome.ok) return mapStoreFailure(outcome);
        results.push(outcome.value);
      }
      // U-3: the same caches answer the requested understanding anchors
      // (pointers, triggers and the plan), so `lookup` no longer reads its own.
      const understanding: UnderstandingStatusV1[] = [];
      for (const anchorKey of input.understandingAnchors ?? []) {
        const status = await understandingOfAnchorKey(ctx, anchorKey, caches);
        if (!status.ok) return mapStoreFailure(status);
        understanding.push(status.value);
      }
      return { status: 'ready', value: { items: results, understanding } };
    },
  };
}
