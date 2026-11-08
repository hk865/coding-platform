/**
 * UI1 A5: the read that maps the live Runs' planned files and module claims to
 * the observed file/module nodes ("current working files").
 *
 * It is a read model, not an owner: one lookup per live status, one batch read
 * of the pinned plans, one current-catalog read, then every rule in memory.
 * `plannedFiles` is the plan's intent ("planned to change"), never the files a
 * Run has already changed; active Runs have no readable RunActivity.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureGroupV1, ArchitectureWorkScopeV1, WorkScopeFileV1,
  WorkScopeModuleV1, WorkScopeRunV1, WorkScopeTaskV1 } from '../../../contracts/architecture-search.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { pathOwnershipOf } from '../../../contracts/path-ownership.js';
import { catalogForWorkspace } from '../../../contracts/workspace-catalog.js';
import { buildArchitectureGroups, moduleKey } from '../architecture/architecture-search-index.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import { decodePlanRevisionSnapshot, planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { decodeRun } from '../persistence/run-record-codecs.js';
import { RUN_BY_WORKSPACE_STATUS_INDEX } from '../tasks/plan-readers.js';

export type { ArchitectureGroupV1, ArchitectureWorkScopeV1, WorkScopeFileV1,
  WorkScopeModuleV1, WorkScopeRunV1, WorkScopeTaskV1 } from '../../../contracts/architecture-search.js';

/** A live Run over 200 is refused whole; a partial work set is never returned. */
const MAX_LIVE_RUNS = 200;

/** Ruling 35: one row per complete RunRef across the two status pages, then the combined 200 cap. */
export type MergedLiveRuns = { status: 'capacity' } | { status: 'runs'; runs: RunSnapshot[] };

export function mergeLiveRuns(pages: readonly (readonly RunSnapshot[])[]): MergedLiveRuns {
  const byRef = new Map<string, RunSnapshot>();
  for (const page of pages) for (const run of page) {
    byRef.set(canonicalKey(run.ref), run);
  }
  const runs = [...byRef.values()];
  return runs.length > MAX_LIVE_RUNS ? { status: 'capacity' } : { status: 'runs', runs };
}

export type ArchitectureWorkScopeDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany'> & RecordLookupPort;
  catalog: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  /** The project's main workspace; absent treats the read workspace as main. */
  mainWorkspaceOf?: (projectId: string) => Promise<ReadResult<string | null>>;
};

export interface ArchitectureWorkScopePort {
  /** The workspace comes from the bound `ctx`; the input stays `{}`. */
  readArchitectureWorkScope(ctx: CoreCallContext, input: Record<string, never>):
    Promise<ReadResult<ArchitectureWorkScopeV1>>;
}

function workScopeTaskKey(task: WorkScopeTaskV1): string {
  return task.goalId + '\u0000' + task.taskId;
}

function sortedTasks(tasks: readonly WorkScopeTaskV1[]): WorkScopeTaskV1[] {
  const byKey = new Map<string, WorkScopeTaskV1>();
  for (const task of tasks) if (!byKey.has(workScopeTaskKey(task))) byKey.set(workScopeTaskKey(task), task);
  return [...byKey.values()].sort((left, right) => left.goalId < right.goalId ? -1 : left.goalId > right.goalId ? 1
    : left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0);
}

type FileEntry = { tasks: WorkScopeTaskV1[] };
type ModuleEntry = { group: ArchitectureGroupV1; files: Set<string>; tasks: WorkScopeTaskV1[]; claimedWithoutFiles: boolean };

/** The one read assembly; every failure is returned, never folded into an empty set. */
export function createArchitectureWorkScopeReader(
  deps: ArchitectureWorkScopeDependencies,
): ArchitectureWorkScopePort {
  async function readArchitectureWorkScope(ctx: CoreCallContext, _input: Record<string, never>): Promise<ReadResult<ArchitectureWorkScopeV1>> {
    if (ctx?.signal?.aborted) {
      return { status: 'rejected', code: 'cancelled', reason: 'the architecture work scope read was cancelled' };
    }
    const workspaceId = ctx.workspaceId;
    if (workspaceId === undefined || workspaceId.length === 0) {
      return { status: 'rejected', code: 'forbidden',
        reason: 'architecture work scope requires a bound project/workspace context' };
    }
    const projectId = ctx.projectId;

    const pages: RunSnapshot[][] = [];
    for (const status of ['starting', 'running'] as const) {
      const page = await deps.records.lookup({ index: RUN_BY_WORKSPACE_STATUS_INDEX,
        values: [projectId, workspaceId, status], limit: MAX_LIVE_RUNS });
      if (page.status !== 'ready') return storeFailureToRejection(page);
      if (page.value.next !== null) {
        return { status: 'rejected', code: 'capacity', reason: 'work scope: more than 200 live Runs in this workspace' };
      }
      const runs: RunSnapshot[] = [];
      for (const record of page.value.records) {
        const decoded = decodeRun(record);
        if (!decoded.ok) {
          return { status: 'rejected', code: 'unavailable', reason: 'Run record ' + record.refKey + ': ' + decoded.reason };
        }
        if (decoded.value.workspaceSnapshot.workspaceId !== workspaceId) {
          return { status: 'rejected', code: 'unavailable', reason: 'work scope: a live Run names another workspace' };
        }
        runs.push(decoded.value);
      }
      pages.push(runs);
    }
    const merged = mergeLiveRuns(pages);
    if (merged.status === 'capacity') {
      return { status: 'rejected', code: 'capacity', reason: 'work scope: more than 200 live Runs in this workspace' };
    }
    const runs = merged.runs;
    runs.sort((left, right) => left.ref.runId < right.ref.runId ? -1 : left.ref.runId > right.ref.runId ? 1 : 0);

    const planKeys = [...new Set(runs.map(run => planRevisionRefKey(run.planRef)))];
    const planRead = await deps.records.readMany(planKeys);
    if (planRead.status !== 'ready') return storeFailureToRejection(planRead);
    // Ruling 35: decode every distinct Plan exactly once, then look it up by the Run's planRef.
    const plansByKey = new Map(planRead.value.records.map(record => [record.refKey, record]));
    const decodedPlansByKey = new Map(planKeys.map(key => {
      const record = plansByKey.get(key);
      return [key, record === undefined ? undefined : decodePlanRevisionSnapshot(record)] as const;
    }));

    const catalogRevision = await deps.catalog.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    let catalog: AdoptedArchitecture | null = null;
    if (catalogRevision.status === 'ready') catalog = catalogRevision.value.catalog.catalog;
    else if (catalogRevision.status !== 'not_found') return catalogRevision;
    // The Runs are this workspace's; the module paths and the catalog must be
    // projected to the same workspace before any ownership comparison.
    if (catalog !== null) {
      let mainWorkspaceId = workspaceId;
      if (deps.mainWorkspaceOf !== undefined) {
        const main = await deps.mainWorkspaceOf(projectId);
        // A failed main read refuses the work scope as `unavailable`; a ready
        // `null` (no workspace yet) keeps the read workspace as main.
        if (main.status !== 'ready') {
          return { status: 'rejected', code: 'unavailable',
            reason: main.status === 'rejected' ? main.reason : 'the main workspace cannot be read' };
        }
        mainWorkspaceId = main.value ?? workspaceId;
      }
      catalog = catalogForWorkspace(catalog, workspaceId, mainWorkspaceId);
    }

    const groups = buildArchitectureGroups(catalog?.modules ?? [], catalog?.containment);
    const groupsByKey = new Map(groups.map(group => [moduleKey(group.ref), group]));
    const ownershipCandidates = groups.map(group => ({ value: group, paths: group.paths }));

    const files = new Map<string, FileEntry>();
    const claims = new Map<string, ModuleEntry>();
    const seenTasks = new Set<string>();
    const workScopeTaskOf = (run: RunSnapshot): WorkScopeTaskV1 => ({ goalId: run.task.goalId, taskId: run.task.taskId });
    for (const run of runs) {
      const decodedPlan = decodedPlansByKey.get(planRevisionRefKey(run.planRef));
      if (decodedPlan === undefined) {
        return { status: 'rejected', code: 'unavailable', reason: 'plan ' + run.planRef.planId + ' does not exist' };
      }
      if (decodedPlan.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable',
          reason: 'plan ' + run.planRef.planId + ' is corrupt: ' + decodedPlan.reason };
      }
      const task = decodedPlan.value.tasks.find(candidate => candidate.taskId === run.task.taskId);
      if (task === undefined) {
        return { status: 'rejected', code: 'unavailable', reason: 'work scope: Run ' + run.ref.runId + ' names task '
          + run.task.taskId + ' that is not in plan ' + run.planRef.planId };
      }
      const key = workScopeTaskKey(workScopeTaskOf(run));
      if (seenTasks.has(key)) continue;
      seenTasks.add(key);
      if (task.plannedFiles !== undefined) {
        for (const path of task.plannedFiles) {
          const entry = files.get(path);
          if (entry === undefined) files.set(path, { tasks: [workScopeTaskOf(run)] });
          else entry.tasks.push(workScopeTaskOf(run));
        }
      } else if (task.scope.kind === 'module') {
        const ref: ModuleRef = { projectId, moduleId: task.scope.moduleRef };
        const group = groupsByKey.get(moduleKey(ref));
        if (group === undefined) continue;
        const entry = claims.get(moduleKey(ref));
        if (entry === undefined) claims.set(moduleKey(ref), { group, files: new Set(), tasks: [workScopeTaskOf(run)], claimedWithoutFiles: true });
        else { entry.tasks.push(workScopeTaskOf(run)); entry.claimedWithoutFiles = true; }
      }
    }

    const fileRows: WorkScopeFileV1[] = [...files.entries()].map(([path, entry]) => {
      const ownership = pathOwnershipOf(path, ownershipCandidates);
      const module = ownership.status === 'owner' ? ownership.owner : null;
      return { kind: 'file' as const, nodeRef: { kind: 'file' as const, path },
        label: path.slice(path.lastIndexOf('/') + 1), path, module, tasks: sortedTasks(entry.tasks) };
    }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

    const modules = new Map<string, ModuleEntry>(claims);
    for (const row of fileRows) {
      if (row.module === null) continue;
      const key = moduleKey(row.module.ref);
      const entry = modules.get(key);
      if (entry === undefined) modules.set(key, { group: row.module, files: new Set([row.path]), tasks: [...row.tasks], claimedWithoutFiles: false });
      else { entry.files.add(row.path); entry.tasks.push(...row.tasks); }
    }
    const moduleRows: WorkScopeModuleV1[] = [...modules.values()].map(entry => ({
      kind: 'module' as const, nodeRef: { kind: 'module' as const, ref: entry.group.ref },
      label: entry.group.name, module: entry.group,
      files: [...entry.files].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
      tasks: sortedTasks(entry.tasks), claimedWithoutFiles: entry.claimedWithoutFiles,
    })).sort((left, right) => moduleKey(left.module.ref) < moduleKey(right.module.ref) ? -1
      : moduleKey(left.module.ref) > moduleKey(right.module.ref) ? 1 : 0);

    return { status: 'ready', value: {
      workspace: { projectId, workspaceId },
      runs: runs.map(run => ({
        ref: run.ref, task: run.task, planRef: run.planRef,
        status: run.status as 'starting' | 'running',
        writeScope: run.envelope === null ? null : [...run.envelope.permissions.writeScope],
      })),
      files: fileRows, modules: moduleRows,
      counts: { runs: runs.length, files: fileRows.length, modules: moduleRows.length },
      sources: { catalog: catalog === null ? 'not_adopted' : 'available' },
    } };
  }
  return { readArchitectureWorkScope };
}
