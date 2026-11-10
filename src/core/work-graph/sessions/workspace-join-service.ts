/**
 * The second workspace's join operation (`workspace_join`) driver: one `role_line` CoreOperation per (project,
 * workspace), born in that workspace's registration commit and driven only by that workspace's Host lifecycle pass.
 * It runs the one shared exploration flow's three phases `coarse_split → regions → proposals`, one operation commit
 * per pass, on the modules the join itself decides at its entry; the phases themselves are `cold-start-service.ts`'s
 * `createRoleExplorationPhases`, not a second copy.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { catalogForWorkspace } from '../../../contracts/workspace-catalog.js';
import type { ColdStartDriveResultV1, ColdStartServiceDeps, RoleExplorationCallV1 } from './cold-start-service.js';
import {
  createRoleExplorationPhases, readWorkspaceJoinRecord, topLevelModules,
} from './cold-start-service.js';
import { readMainWorkspace } from './role-line-operations.js';
import { writeRoleLineOperation } from './role-line-operation-write.js';
import type { RoleLineOperationV1 } from '../model/session-contracts.js';
import type { WorkspaceJoinPhaseV1, WorkspaceJoinActionV1 } from '../state/role-line-action.js';
import {
  advanceWorkspaceJoinPhase, skipJoinRegions, workspaceJoinPhaseProblem,
} from '../state/workspace-join.js';
import { catalogPinOf, readCurrentCatalogWindow } from '../architecture/catalog-service.js';

export type WorkspaceJoinService = {
  drive(ctx: CoreCallContext, input: { projectId: string; workspaceId: string }):
    Promise<ReadResult<{ phase: WorkspaceJoinPhaseV1; revision: number; completed: boolean }>>;
};

type DriveInputV1 = { projectId: string; workspaceId: string };
type JoinDriveResultV1 = { phase: WorkspaceJoinPhaseV1; revision: number; completed: boolean };
type AtV1 = { ctx: CoreCallContext; input: DriveInputV1; op: RoleLineOperationV1; action: WorkspaceJoinActionV1 };

export function createWorkspaceJoinService(deps: ColdStartServiceDeps): WorkspaceJoinService {
  const phases = createRoleExplorationPhases(deps);

  /** The join's own phase advance, handed to the shared exploration phases. */
  const advanceJoinPhase: RoleExplorationCallV1['advance'] = (action, patch) =>
    advanceWorkspaceJoinPhase(action as WorkspaceJoinActionV1,
      patch as Omit<Partial<WorkspaceJoinActionV1>, 'kind' | 'action' | 'lastCompleted'>);
  const skipJoin: RoleExplorationCallV1['skipRegions'] = (action, pin) =>
    skipJoinRegions(action as WorkspaceJoinActionV1, pin);

  /** The join's one operation commit. `ledgerHorizon` is the completion's CAS, as on the cold start. */
  const write: RoleExplorationCallV1['write'] = async (ctx, at, action, phase, ledgerHorizon) => {
    const next: RoleLineOperationV1 = { ...at.op, revision: at.op.revision + 1, updatedAt: deps.now(), action,
      phase: phase ?? at.op.phase };
    const written = await writeRoleLineOperation(deps, ctx, at.op, next, undefined,
      ledgerHorizon === undefined ? undefined
        : { records: [], claims: [], events: [], guards: [], ledgerHorizon });
    if (written.status !== 'committed') return written;
    return { status: 'ready', value: { phase: action.phase as ColdStartDriveResultV1['phase'],
      revision: next.revision, completed: next.phase === 'completed' } };
  };

  function asJoinResult(result: ReadResult<ColdStartDriveResultV1>): ReadResult<JoinDriveResultV1> {
    return result.status === 'ready'
      ? { status: 'ready', value: { phase: result.value.phase as WorkspaceJoinPhaseV1,
        revision: result.value.revision, completed: result.value.completed } }
      : result;
  }

  /** The join entry's module set: the project catalog projected onto the joining workspace, top-level, minus the
   *  modules an open region line already covers. C1 keeps its own set; this skip rule lives only here. */
  async function joinRegionModules(ctx: CoreCallContext, projectId: string, workspaceId: string,
    mainWorkspaceId: string | null): Promise<ReadResult<readonly ModuleRef[]>> {
    const window = await readCurrentCatalogWindow(deps.records, projectId);
    if (window.status !== 'ready') return window;
    const catalog = catalogForWorkspace(window.catalog.catalog, workspaceId, mainWorkspaceId);
    const lines = await deps.regionLines.readOpenRegionLines(ctx, { projectId });
    if (lines.status !== 'ready') return lines;
    const claimed = new Set<string>();
    for (const line of lines.value) {
      if (line.link.ref.target.kind !== 'module') continue;
      claimed.add(line.link.ref.target.ref.moduleId);
    }
    return { status: 'ready', value: topLevelModules(catalog).filter((module) => !claimed.has(module.moduleId)) };
  }

  async function driveWorkspaceJoin(ctx: CoreCallContext, input: DriveInputV1):
    Promise<ReadResult<JoinDriveResultV1>> {
    const read = await readWorkspaceJoinRecord(deps.records, input.projectId, input.workspaceId);
    if (read.status !== 'ready') return read;
    const { record: op, action } = read.value;
    if (op.phase === 'completed') {
      return { status: 'ready', value: { phase: action.phase, revision: op.revision, completed: true } };
    }
    if (op.phase !== 'accepted' && op.phase !== 'running') {
      return rejected('unavailable', `the workspace-join operation is ${op.phase}`);
    }
    const problem = workspaceJoinPhaseProblem(action);
    if (problem !== null) return rejected('invalid', problem);
    const at: AtV1 = { ctx, input, op, action };
    // The first drive pins the project's current catalog and does not advance; a project without a current catalog
    // waits for its cold start's adoption (a person may join before the first cold start runs).
    if (action.baseCatalogPin === null) {
      const window = await readCurrentCatalogWindow(deps.records, input.projectId);
      if (window.status === 'not_found') {
        return { status: 'ready', value: { phase: at.action.phase, revision: at.op.revision, completed: false } };
      }
      if (window.status !== 'ready') return window;
      return asJoinResult(await write(ctx, at, { ...action, baseCatalogPin: catalogPinOf(window) }));
    }
    switch (action.phase) {
      case 'coarse_split':
        return asJoinResult(await phases.coarseSplit(ctx, at, { modules: [], advance: advanceJoinPhase, write,
          skipRegions: skipJoin }));
      case 'regions': {
        const main = await readMainWorkspace(deps.records, input.projectId);
        if (main.status !== 'ready') return main;
        const modules = await joinRegionModules(ctx, input.projectId, input.workspaceId, main.value);
        if (modules.status !== 'ready') return modules;
        // M7b: the shared `regions` phase writes the formula once on the same module set the join selected.
        return asJoinResult(await phases.regions(ctx, at,
          { modules: modules.value, advance: advanceJoinPhase, write, skipRegions: skipJoin }));
      }
      case 'proposals':
        return asJoinResult(await phases.proposals(ctx, at, { modules: [], advance: advanceJoinPhase, write,
          skipRegions: skipJoin }));
    }
  }

  return { drive: driveWorkspaceJoin };
}
