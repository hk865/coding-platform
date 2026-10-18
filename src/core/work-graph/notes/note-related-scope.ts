/**
 * Slice 4C §11.2 (decision 67 item 1): the "related scope" of a `find` request.
 *
 * The module keeps the FACT READS apart from the PURE key-set builder and the
 * relatedness predicate, so the L20 assembly can reuse the pure part with the
 * facts it already read (spec §11.2 last bullet):
 *   - `selectRelatedFiles` is pure over already-read Run facts;
 *   - `taskRelatedKeys` / `moduleRelatedKeys` are pure over already-read facts;
 *   - `isRelatedHead` is the one predicate both `find` segments use.
 *
 * The read half resolves the requester exactly as the spec's table says:
 *   - a work Run with no explicit `related` resolves its own task through the
 *     narrow `NoteRunTaskResolver` (one read of the Run snapshot);
 *   - an explicit task uses the goal's current plan (`readGoalPlanWindow`) and
 *     must be inside the caller's bound project and workspace;
 *   - an explicit module must exist in the current catalog.
 * A goal/task/module that does not exist is `not_found` / `related_not_found`;
 * any failed read is `unavailable`.
 *
 * It does NOT import `views` and it does not reuse `graph-context-reader`
 * (notes may not import views, and that reader reads far too widely).
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { okFalse } from '../../../contracts/core/rejections.js';
import type { NoteAnchorV1, NoteHeadSnapshot, NoteKind } from '../../../contracts/note.js';
import { NOTE_GENERAL_KINDS } from '../../../contracts/note.js';
import type { PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../../contracts/plan.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { AdoptedArchitecture, ModuleDefinition } from '../../../contracts/architecture-catalog.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { MemoryRelatedNodeV1, NoteRunTaskResolver } from '../model/note-contracts.js';
import { S4B_NOTE_BY_PATH_LOOKUPS, decodeNoteHeadSnapshot } from '../persistence/note-record-codecs.js';
import { runActivityRefKey, decodeRunActivitySnapshot } from '../tasks/run-activity-codecs.js';
import { readGoalPlanWindow, readPlan, RUN_BY_TASK_INDEX } from '../tasks/plan-readers.js';
import { runActivityRefOf } from '../tasks/run-activity-service.js';
import { moduleOfAnchor } from './scribe-scope.js';
import { asOutcome } from './store-failures.js';

/** The note-port failure codes a related-scope read can produce. */
export type RelatedReadCode = 'invalid' | 'not_found' | 'revision_conflict' | 'unavailable';

/** The canonical resolved node carried in `result.related.node` (spec §11.2). */
export type ResolvedRelatedNode =
  | { kind: 'task'; goalId: string; taskId: string; planRevision: number }
  | { kind: 'module'; moduleId: string; catalogRevision: number };

/** The per-Run changed-file facts the pure file selector consumes. */
export type RelatedChangedFiles =
  | { status: 'known'; definite: string[]; possible: string[] }
  | { status: 'unknown' }
  | { status: 'absent' };

export type RelatedRunFact = { runEndedAt: string | null; changed: RelatedChangedFiles };

export type RelatedFileSelection = { files: string[]; omitted: number; unknownRuns: number };

export type RelatedScope = {
  node: ResolvedRelatedNode;
  keys: Set<string>;
  filesOmitted: number;
  filesUnknownRuns: number;
};

export type RelatedScopeOutcome =
  | { ok: true; value: RelatedScope | null }
  | { ok: false; code: RelatedReadCode; reason: string };

export type RelatedScopeDeps = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  architecture?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  runTask?: NoteRunTaskResolver;
  /** `FIND_RELATED_FILES_MAX`, injectable (spec §11.2). */
  relatedFilesMax: number;
};

function byteOrder(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function isGeneralKind(kind: string): boolean { return (NOTE_GENERAL_KINDS as readonly string[]).includes(kind); }

export function matchesPathPrefix(key: string, prefix: string): boolean {
  const base = `file:${prefix}`;
  return key === base || key.startsWith(`${base}/`);
}

export function anchorSlots(head: { anchorKey0: string; anchorKey1: string | null; anchorKey2: string | null;
  anchorKey3: string | null; anchorKey4: string | null }): string[] {
  return [head.anchorKey0, head.anchorKey1, head.anchorKey2, head.anchorKey3, head.anchorKey4]
    .filter((key): key is string => key !== null);
}

// --------------------------------------------------------------------------
// Pure part
// --------------------------------------------------------------------------

/**
 * §11.2: definite before possible, Runs newest-run-ended first, paths in byte
 * order inside one Run, deduplicated, `"."` dropped, capped at `max`. The
 * over-cap distinct count is `omitted`; a `changedFiles: 'unknown'` Run
 * contributes no files and increments `unknownRuns`.
 */
export function selectRelatedFiles(runs: readonly RelatedRunFact[], max: number): RelatedFileSelection {
  const definite: { at: string; path: string }[] = [];
  const possible: { at: string; path: string }[] = [];
  let unknownRuns = 0;
  for (const run of runs) {
    if (run.changed.status === 'unknown') unknownRuns += 1;
    if (run.changed.status !== 'known') continue;
    const at = run.runEndedAt ?? '';
    for (const path of run.changed.definite) definite.push({ at, path });
    for (const path of run.changed.possible) possible.push({ at, path });
  }
  const order = (left: { at: string; path: string }, right: { at: string; path: string }): number =>
    right.at < left.at ? -1 : right.at > left.at ? 1 : byteOrder(left.path, right.path);
  definite.sort(order);
  possible.sort(order);
  const distinct: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...definite, ...possible]) {
    if (entry.path === '.' || seen.has(entry.path)) continue;
    seen.add(entry.path);
    distinct.push(entry.path);
  }
  const files = distinct.slice(0, max);
  return { files, omitted: Math.max(0, distinct.length - max), unknownRuns };
}

/** §11.2: the anchor-key set of task T in goal `g` at plan revision `p`. */
export function taskRelatedKeys(input: {
  goalId: string; taskId: string; planRevision: number; stageId: string | null;
  moduleId: string | null; interfaces: readonly string[]; files: readonly string[];
}): string[] {
  const keys: string[] = [`task:${input.goalId}/${input.taskId}`, `goal:${input.goalId}`];
  if (input.stageId !== null && input.planRevision >= 1) {
    for (let revision = 1; revision <= input.planRevision; revision += 1) {
      keys.push(`stage:${input.goalId}/${String(revision)}/${input.stageId}`);
    }
  }
  if (input.moduleId !== null) {
    keys.push(`module:${input.moduleId}`);
    for (const key of input.interfaces) keys.push(key);
  }
  for (const path of input.files) keys.push(`file:${path}`);
  keys.push('project');
  return keys;
}

/** §11.2: the anchor-key set of module M. */
export function moduleRelatedKeys(input: {
  moduleId: string; interfaces: readonly string[]; files: readonly string[];
}): string[] {
  const keys: string[] = [`module:${input.moduleId}`];
  for (const key of input.interfaces) keys.push(key);
  for (const path of input.files) keys.push(`file:${path}`);
  keys.push('project');
  return keys;
}

/**
 * §11.2: a head is related when any of its main + up to 4 extra anchor slots is
 * in the set. `project` counts for the six general kinds only, so the project
 * understanding (and a project repair) is never related.
 */
export function isRelatedHead(head: { kind: NoteKind; anchorKey0: string; anchorKey1: string | null;
  anchorKey2: string | null; anchorKey3: string | null; anchorKey4: string | null }, keys: ReadonlySet<string>): boolean {
  for (const slot of [head.anchorKey0, head.anchorKey1, head.anchorKey2, head.anchorKey3, head.anchorKey4]) {
    if (slot === null || !keys.has(slot)) continue;
    if (slot === 'project' && !isGeneralKind(head.kind)) continue;
    return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Read part
// --------------------------------------------------------------------------

const PAGE_LIMIT = 200;

function unavailable(reason: string): { ok: false; code: RelatedReadCode; reason: string } {
  return okFalse('unavailable', reason);
}

function notFound(reason: string): { ok: false; code: RelatedReadCode; reason: string } {
  return okFalse('not_found', reason);
}

function readPlanFailure(read: { status: string; code?: string; reason?: string }): { ok: false; code: RelatedReadCode; reason: string } {
  if (read.status === 'rejected' && read.code === 'not_found') return notFound('related_not_found');
  return unavailable(read.status === 'rejected' ? (read.reason ?? 'the plan could not be read') : 'the plan read is not ready');
}

/** A records port that can range-read the five ordered anchor-slot indexes. */
export type RelatedRecordsPort = GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;

/**
 * RW-12(c): range-read the five ordered anchor-slot indexes from ANY key prefix
 * (UTF-8 byte order). Stop only when the slot leaves the whole `<prefix>*`
 * range; a sibling that shares the prefix without a directory boundary is
 * returned and left to the caller's filter (the read model's file predicate, or
 * `collectModuleFileKeys`'s).
 */
export async function headsOnKeyPrefix(records: RelatedRecordsPort, projectId: string, prefix: string):
Promise<{ ok: true; value: NoteHeadSnapshot[] } | { ok: false; code: RelatedReadCode; reason: string }> {
  const seen = new Map<string, NoteHeadSnapshot>();
  for (const [ordinal, index] of S4B_NOTE_BY_PATH_LOOKUPS.entries()) {
    let after: { order: string | number; refKey: string } | undefined;
    for (;;) {
      const page = await records.lookupOrdered({ index, values: [projectId], direction: 'asc',
        bound: { value: prefix, inclusive: true }, ...(after === undefined ? {} : { after }), limit: PAGE_LIMIT });
      if (page.status !== 'ready') return asOutcome(page);
      let leftRange = false;
      for (const record of page.value.records) {
        const decoded = decodeNoteHeadSnapshot(record);
        if (decoded.status !== 'decoded') return unavailable(`a note head is damaged: ${decoded.reason}`);
        const slot = (decoded.value as unknown as Record<string, unknown>)[`anchorKey${String(ordinal)}`];
        if (typeof slot !== 'string' || !slot.startsWith(prefix)) { leftRange = true; break; }
        seen.set(decoded.value.noteId, decoded.value);
      }
      if (leftRange || page.value.next === null) break;
      after = page.value.next;
    }
  }
  return { ok: true, value: [...seen.values()] };
}

/**
 * §11.2/RW-12(b): T's Runs come from `RUN_BY_TASK_INDEX`; their `RunActivity`
 * records are read in ONE batched `readMany` (the pattern of
 * `run-activity-service.ts:539-553`). A Run with no activity (still running, or
 * just ended) contributes no files; a `changedFiles: 'unknown'` Run contributes
 * no files and increments the unknown count (spec §11.2).
 */
async function readTaskChangedFiles(deps: RelatedScopeDeps, ctx: CoreCallContext, goalId: string, taskId: string):
Promise<{ ok: true; value: RelatedRunFact[] } | { ok: false; code: RelatedReadCode; reason: string }> {
  // §11.2/RW-12(b): the record key of a Run IS its canonical ref, so the
  // RunActivity key needs no materials-side Run decode (notes -> materials is
  // a forbidden submodule edge).
  const runs: { runRef: RunRef; activityKey: string }[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await deps.records.lookup({ index: RUN_BY_TASK_INDEX, values: [ctx.projectId, goalId, taskId],
      ...(after === undefined ? {} : { after }), limit: PAGE_LIMIT });
    if (page.status !== 'ready') {
      return asOutcome(page);
    }
    for (const record of page.value.records) {
      const runRef = runRefOfKey(record.refKey);
      if (runRef === null) return unavailable('a Run record key is not a canonical Run ref');
      runs.push({ runRef, activityKey: runActivityRefKey(runActivityRefOf({ ref: runRef })) });
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  const activities = await deps.records.readMany([...new Set(runs.map(entry => entry.activityKey))]);
  if (activities.status !== 'ready') return asOutcome(activities);
  const byKey = new Map(activities.value.records.map(record => [record.refKey, record]));
  const facts: RelatedRunFact[] = [];
  for (const { activityKey } of runs) {
    const activityRecord = byKey.get(activityKey);
    if (activityRecord === undefined) continue;
    const decoded = decodeRunActivitySnapshot(activityRecord);
    if (decoded.status !== 'decoded') return unavailable(`a RunActivity is damaged: ${decoded.reason}`);
    const value = decoded.value;
    if (value.facts.status === 'unknown') {
      facts.push({ runEndedAt: value.runEndedAt, changed: { status: 'unknown' } });
      continue;
    }
    const changed = value.facts.changedFiles;
    facts.push({ runEndedAt: value.runEndedAt,
      changed: { status: 'known', definite: [...changed.definite], possible: [...changed.possible] } });
  }
  return { ok: true, value: facts };
}

/** A Run record's key is `canonicalJson(RunRef)`; recover the ref or `null`. */
function runRefOfKey(refKey: string): RunRef | null {
  try {
    const parsed = JSON.parse(refKey) as Partial<RunRef>;
    if (parsed.aggregateType !== 'Run' || typeof parsed.projectId !== 'string'
      || typeof parsed.goalId !== 'string' || typeof parsed.runId !== 'string') return null;
    return { aggregateType: 'Run', projectId: parsed.projectId, goalId: parsed.goalId, runId: parsed.runId };
  } catch {
    return null;
  }
}

export function stageIdOf(task: RuntimeTask): string | null {
  if (task.stageId !== undefined) return task.stageId;
  if (task.scope.kind === 'stage' || task.scope.kind === 'module') return task.scope.stageId;
  return null;
}

function moduleIdOf(task: RuntimeTask): string | null {
  return task.scope.kind === 'module' ? task.scope.moduleRef : null;
}

async function readCatalogModule(deps: RelatedScopeDeps, ctx: CoreCallContext, moduleId: string):
Promise<{ ok: true; catalog: AdoptedArchitecture; module: ModuleDefinition; catalogRevision: number }
  | { ok: false; code: RelatedReadCode; reason: string }> {
  if (deps.architecture === undefined) return unavailable('the architecture catalog is not available');
  const read = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  if (read.status !== 'ready') {
    if (read.status === 'rejected' && read.code === 'not_found') return notFound('related_not_found');
    return unavailable(read.status === 'rejected' ? read.reason : 'the catalog read is not ready');
  }
  if (read.value.catalog === null) return notFound('related_not_found');
  const catalog = read.value.catalog.catalog;
  const module = catalog.modules.find(candidate => candidate.ref.moduleId === moduleId);
  if (module === undefined) return notFound('related_not_found');
  return { ok: true, catalog, module, catalogRevision: read.value.baseline.ref.revision };
}

/** §11.2: the module's declared interfaces, as canonical anchor keys. */
function interfaceKeysOf(moduleId: string, module: ModuleDefinition): string[] {
  return module.interfaces.map(candidate => `interface:${moduleId}/${candidate.id}`);
}

/** §11.2: file keys whose single longest catalog owner is M (via the exported `moduleOfAnchor`). */
async function collectModuleFileKeys(deps: RelatedScopeDeps, ctx: CoreCallContext,
  catalog: AdoptedArchitecture, module: ModuleDefinition):
Promise<{ ok: true; value: string[] } | { ok: false; code: RelatedReadCode; reason: string }> {
  const paths = new Set<string>();
  for (const prefix of module.paths) {
    const stripped = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    if (stripped.length === 0) continue;
    // The root `.` owns every file no concrete prefix claims, so it scans the
    // whole `file:` range and lets `moduleOfAnchor` decide each candidate.
    const isRoot = stripped === '.';
    // RW-12(c): the one generalised five-slot prefix scan, with the directory
    // boundary filter applied per slot.
    const scanned = await headsOnKeyPrefix(deps.records, ctx.projectId, isRoot ? 'file:' : `file:${stripped}`);
    if (!scanned.ok) return scanned;
    for (const head of scanned.value) {
      const slots = anchorSlots(head);
      if (!slots.some(slot => (isRoot ? slot.startsWith('file:') : matchesPathPrefix(slot, stripped)))) continue;
      for (const candidate of slots) {
        if (!candidate.startsWith('file:')) continue;
        const path = candidate.slice('file:'.length);
        if (moduleOfAnchor(catalog, { kind: 'file', path } as NoteAnchorV1) === module.ref.moduleId) paths.add(path);
      }
    }
  }
  return { ok: true, value: [...paths] };
}

function buildTaskScope(goalId: string, task: RuntimeTask, planRevision: number,
  interfaces: readonly string[], files: readonly string[], filesOmitted: number, filesUnknownRuns: number): RelatedScope {
  const moduleId = moduleIdOf(task);
  const keys = taskRelatedKeys({ goalId, taskId: task.taskId, planRevision,
    stageId: stageIdOf(task), moduleId, interfaces, files });
  return { node: { kind: 'task', goalId, taskId: task.taskId, planRevision }, keys: new Set(keys),
    filesOmitted, filesUnknownRuns };
}

async function resolvedTaskScope(deps: RelatedScopeDeps, ctx: CoreCallContext, goalId: string, taskId: string,
  plan: PlanRevisionSnapshot):
Promise<RelatedScopeOutcome> {
  const task = plan.tasks.find(candidate => candidate.taskId === taskId);
  if (task === undefined) return notFound('related_not_found');
  let interfaces: string[] = [];
  const moduleId = moduleIdOf(task);
  if (moduleId !== null) {
    const catalog = await readCatalogModule(deps, ctx, moduleId);
    if (catalog.ok) interfaces = interfaceKeysOf(moduleId, catalog.module);
    else if (catalog.code === 'unavailable') return catalog;
    // A declared module no longer in the catalog still contributes `module:M`.
    else interfaces = [];
  }
  const files = await readTaskChangedFiles(deps, ctx, goalId, taskId);
  if (!files.ok) return files;
  const selected = selectRelatedFiles(files.value, deps.relatedFilesMax);
  return { ok: true, value: buildTaskScope(goalId, task, plan.planRevision, interfaces, selected.files,
    selected.omitted, selected.unknownRuns) };
}

/**
 * The same task-scope resolution as `resolveRelatedScope`'s
 * explicit-task branch, but with the goal's plan window already read by the
 * caller. `readMemoryMaterial` uses this so one call reads one plan window.
 */
export async function resolveTaskScopeWithPlan(ctx: CoreCallContext, deps: RelatedScopeDeps,
  goalId: string, taskId: string, plan: PlanRevisionSnapshot): Promise<RelatedScopeOutcome> {
  return resolvedTaskScope(deps, ctx, goalId, taskId, plan);
}

async function explicitTaskScope(deps: RelatedScopeDeps, ctx: CoreCallContext,
  goalId: string, taskId: string,
  plans?: Map<string, PlanRevisionSnapshot | null>): Promise<RelatedScopeOutcome> {
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
  const window = await readGoalPlanWindow(deps.records, goalRef);
  if (window.status !== 'ready') {
    if (window.status === 'rejected' && window.code === 'not_found') return notFound('related_not_found');
    return unavailable(window.status === 'rejected' ? window.reason : 'the goal plan read is not ready');
  }
  if (window.goal.workspaceRef.workspaceId !== ctx.workspaceId) return notFound('related_not_found');
  if (window.plan === null) return notFound('related_not_found');
  // Hand the window this resolution just read to the caller's
  // per-call cache, so the page's `checkHeads` reuses it instead of re-reading
  // the same goal window. The key matches the check's `caches.plans`.
  plans?.set(`${ctx.projectId}\u0000${goalId}`, window.plan);
  return resolvedTaskScope(deps, ctx, goalId, taskId, window.plan);
}

async function callerTaskScope(deps: RelatedScopeDeps, ctx: CoreCallContext, goalId: string,
  taskId: string, planRef: PlanRevisionRef): Promise<RelatedScopeOutcome> {
  const planRead = await readPlan(deps.records, planRef);
  if (planRead.status !== 'ready') return readPlanFailure(planRead);
  return resolvedTaskScope(deps, ctx, goalId, taskId, planRead.plan);
}

async function explicitModuleScope(deps: RelatedScopeDeps, ctx: CoreCallContext, moduleId: string): Promise<RelatedScopeOutcome> {
  const found = await readCatalogModule(deps, ctx, moduleId);
  if (!found.ok) return found;
  const files = await collectModuleFileKeys(deps, ctx, found.catalog, found.module);
  if (!files.ok) return files;
  const keys = moduleRelatedKeys({ moduleId, interfaces: interfaceKeysOf(moduleId, found.module), files: files.value });
  return { ok: true, value: { node: { kind: 'module', moduleId, catalogRevision: found.catalogRevision },
    keys: new Set(keys), filesOmitted: 0, filesUnknownRuns: 0 } };
}

/**
 * Resolve the request's `related` node and build its key set. `'auto'` is the
 * absent value: only a work Run resolves it (fail-soft to "no segments" when no
 * resolver is injected, which is only the case in tests).
 */
export async function resolveRelatedScope(ctx: CoreCallContext, deps: RelatedScopeDeps,
  requested: MemoryRelatedNodeV1 | 'auto',
  plans?: Map<string, PlanRevisionSnapshot | null>): Promise<RelatedScopeOutcome> {
  if (requested === 'auto') {
    if (ctx.principal.kind !== 'work_run' || deps.runTask === undefined) return { ok: true, value: null };
    const resolved = await deps.runTask(ctx);
    if (resolved.status !== 'ready') return unavailable(resolved.status === 'rejected' ? resolved.reason : 'the Run task read is not ready');
    return callerTaskScope(deps, ctx, resolved.value.goalId, resolved.value.taskId, resolved.value.planRef);
  }
  if (requested === null) return { ok: true, value: null };
  if (requested.kind === 'caller_task') {
    if (ctx.principal.kind !== 'work_run' || deps.runTask === undefined) return unavailable('related_caller_unavailable');
    const resolved = await deps.runTask(ctx);
    if (resolved.status !== 'ready') return unavailable(resolved.status === 'rejected' ? resolved.reason : 'the Run task read is not ready');
    return callerTaskScope(deps, ctx, resolved.value.goalId, resolved.value.taskId, resolved.value.planRef);
  }
  if (requested.kind === 'module') return explicitModuleScope(deps, ctx, requested.moduleId);
  return explicitTaskScope(deps, ctx, requested.goalId, requested.taskId, plans);
}
