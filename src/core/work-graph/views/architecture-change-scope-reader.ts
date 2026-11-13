/**
 * The read behind `architecture/change-scope`: the files the current Goal's Runs
 * actually changed, summed by each file's one owning module ("改动 n").
 *
 * It is a read model, not an owner: one `GoalExecutedFilesPort` read (all of the
 * Goal's Runs and RunActivity at once, never one `graph/detail` per task), one
 * project-scope Goal read for its own workspace (104-1) and one current-catalog
 * read projected onto that workspace, then every rule in memory. The facts are
 * `RunActivity.changedFiles`: not the plan's `plannedFiles`, and not the workspace's uncommitted files.
 */
import { mappingsOf, ownershipRuleOf, type AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureChangeScopeV1 } from '../../../contracts/architecture-search.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { catalogForWorkspace } from '../../../contracts/workspace-catalog.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import { mapExecutedFilesToModules } from '../model/architecture-footprint.js';
import type { GoalExecutedFilesPort } from '../model/decision-contracts.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import { hostContextIn } from '../tasks/plan-lineage.js';

export type ArchitectureChangeScopeDependencies = {
  executedFiles: Pick<GoalExecutedFilesPort, 'readGoalExecutedFiles'>;
  /** 104-1: the Goal is read in the project, and a Goal of another workspace is read in its own workspace. */
  goals: Pick<PlanTaskPort, 'queryGoal'>;
  catalog: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  /** The project's main workspace, as `architecture/work-scope` takes it; absent
   *  treats the read workspace as main. */
  mainWorkspaceOf?: (projectId: string) => Promise<ReadResult<string | null>>;
};

export interface ArchitectureChangeScopePort {
  readArchitectureChangeScope(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<ArchitectureChangeScopeV1>>;
}

const textOrder = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/**
 * The pure fold over one projected catalog and the port's file rows. A path is
 * one row: any `definite` row makes it `definite` (the `graph/detail` rule). The
 * module is the longest legal catalog path (`mapExecutedFilesToModules`; none or
 * a tie stays `null`); `interfaceId` is the layered `ownershipRuleOf` inside that
 * module, prepared once for all the rows. A module row counts the distinct paths of the module itself, its
 * interfaces' files included; an unowned file is in `files` and `counts` only.
 */
export function changeScopeOf(
  catalog: AdoptedArchitecture,
  files: readonly { path: string; certainty: 'definite' | 'possible' }[],
  complete: boolean,
  sourceCursor: CommitCursor | null,
): Omit<ArchitectureChangeScopeV1, 'goalRef'> {
  const certaintyByPath = new Map<string, 'definite' | 'possible'>();
  for (const file of files) {
    if (file.certainty === 'definite' || !certaintyByPath.has(file.path)) certaintyByPath.set(file.path, file.certainty);
  }
  const unique = [...certaintyByPath.entries()].map(([path, certainty]) => ({ path, certainty }))
    .sort((left, right) => textOrder(left.path, right.path));
  const ownerOf = ownershipRuleOf(mappingsOf(catalog));
  const rows: ArchitectureChangeScopeV1['files'] = mapExecutedFilesToModules(catalog, unique).map(file => ({
    path: file.path, moduleRef: file.moduleRef,
    interfaceId: file.moduleRef === null ? null : ownerOf(file.path).interfaceId,
    certainty: file.certainty,
  }));
  const modules = new Map<string, ArchitectureChangeScopeV1['modules'][number]>();
  for (const row of rows) {
    if (row.moduleRef === null) continue;
    const entry = modules.get(row.moduleRef.moduleId)
      ?? { moduleRef: row.moduleRef, changed: 0, possible: 0 };
    if (row.certainty === 'definite') entry.changed += 1;
    else entry.possible += 1;
    modules.set(row.moduleRef.moduleId, entry);
  }
  const changed = rows.filter(row => row.certainty === 'definite').length;
  return {
    files: rows,
    modules: [...modules.values()].sort((left, right) => textOrder(left.moduleRef.moduleId, right.moduleRef.moduleId)),
    counts: { files: rows.length, changed, possible: rows.length - changed },
    complete,
    sourceCursor,
  };
}

/** The one read assembly; every failure is returned, never folded into an empty set. */
export function createArchitectureChangeScopeReader(
  deps: ArchitectureChangeScopeDependencies,
): ArchitectureChangeScopePort {
  async function readArchitectureChangeScope(ctx: CoreCallContext, input: { goalRef: GoalRef }):
  Promise<ReadResult<ArchitectureChangeScopeV1>> {
    const workspaceId = ctx.workspaceId;
    if (workspaceId === undefined || workspaceId.length === 0) {
      return { status: 'rejected', code: 'forbidden',
        reason: 'architecture change scope requires a bound project/workspace context' };
    }
    // 104-1: reading platform data is not limited to the bound workspace. The Goal's executed files are its own
    // workspace's paths, so they are read in that workspace and projected onto its part of the catalog.
    const goal = await deps.goals.queryGoal(ctx, input.goalRef, { scope: 'project' });
    if (goal.status !== 'ready') return goal;
    const goalWorkspaceId = goal.value.goal.workspaceRef.workspaceId;
    const executed = await deps.executedFiles.readGoalExecutedFiles(hostContextIn(ctx, goalWorkspaceId), { goalRef: input.goalRef });
    if (executed.status !== 'ready') return executed;
    // An unreadable fact is a failed read, never zero changed files.
    if (executed.value.availability === 'not_available') {
      return { status: 'rejected', code: 'unavailable', reason: 'the goal\'s executed files are not available' };
    }
    const revision = await deps.catalog.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    let catalog: AdoptedArchitecture | null = null;
    if (revision.status === 'ready') catalog = revision.value.catalog.catalog;
    else if (revision.status !== 'not_found') return revision;
    // The Runs changed the Goal's workspace's files: the project catalog is
    // projected onto that workspace before any ownership comparison.
    if (catalog !== null) {
      let mainWorkspaceId = goalWorkspaceId;
      if (deps.mainWorkspaceOf !== undefined) {
        const main = await deps.mainWorkspaceOf(ctx.projectId);
        // A failed main read refuses the read as `unavailable`; a ready `null`
        // (no workspace yet) keeps the read workspace as main.
        if (main.status !== 'ready') {
          return { status: 'rejected', code: 'unavailable',
            reason: main.status === 'rejected' ? main.reason : 'the main workspace cannot be read' };
        }
        mainWorkspaceId = main.value ?? goalWorkspaceId;
      }
      catalog = catalogForWorkspace(catalog, goalWorkspaceId, mainWorkspaceId);
    }
    // No adopted catalog: every file is listed with no module.
    const scope = changeScopeOf(catalog ?? { modules: [], dependencies: [], requireDag: true },
      executed.value.files, !executed.value.possiblyIncomplete, executed.value.sourceCursor);
    return { status: 'ready', value: { goalRef: input.goalRef, ...scope } };
  }
  return { readArchitectureChangeScope };
}
