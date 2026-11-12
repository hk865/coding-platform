/**
 * L3 ([2C2-02], [2C2-03]): a plan's knowledge pin. A propose reads every line the plan would pin right after the
 * catalog files, before its proposal window (`readPlanPin`), and narrows that read inside the window to the modules
 * the checked draft uses (`planPinOf`), so the window reads no file (121-93). Contracts and model types only.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { KnowledgeLinePinV1, KnowledgePinV1 } from '../../../contracts/knowledge.js';
import { pathOwnershipOf } from '../../../contracts/path-ownership.js';
import type { PlanRevisionDraft } from '../../../contracts/plan.js';
import { catalogForWorkspace } from '../../../contracts/workspace-catalog.js';
import { rawModuleId } from '../../../contracts/workspace-module-id.js';
import type { StoreResult } from '../../record-store/ports.js';
import type { KnowledgeCaller, KnowledgeLines } from '../model/line-knowledge.js';

/** What a propose read before its window: the Goal's workspace, the main one, and each pinned line with its workspace. */
export type PlanPinRead = {
  goalWorkspaceId: string;
  mainWorkspaceId: string;
  lines: readonly { workspaceId: string; pin: KnowledgeLinePinV1 }[];
};

/**
 * [2C2-03]: the catalog modules the tasks use: each module scope, and the owner of each planned file in the Goal's
 * workspace (a tie or no owner adds none). The projection keeps each module's project-view ref, so the owner is
 * already a project-view id; matching the project view directly would let the main workspace's `.` claim another
 * workspace's file. A module the catalog does not have is left to the module fact.
 */
function planUsedModules(tasks: PlanRevisionDraft['tasks'], catalog: AdoptedArchitecture, goalWorkspaceId: string,
  mainWorkspaceId: string): string[] {
  const known = new Set(catalog.modules.map(module => module.ref.moduleId));
  const owners = catalogForWorkspace(catalog, goalWorkspaceId, mainWorkspaceId).modules
    .map(module => ({ value: module.ref.moduleId, paths: module.paths }));
  const used = new Set<string>();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (task === null || typeof task !== 'object') continue;
    const scope = task.scope;
    if (scope !== null && typeof scope === 'object' && scope.kind === 'module' && known.has(scope.moduleRef)) {
      used.add(scope.moduleRef);
    }
    for (const path of Array.isArray(task.plannedFiles) ? task.plannedFiles : []) {
      const owner = typeof path === 'string' ? pathOwnershipOf(path, owners) : null;
      if (owner?.status === 'owner') used.add(owner.owner);
    }
  }
  return [...used].sort();
}

/** [2C2-02]: the workspace of a project-view module id. */
function moduleWorkspaceOf(moduleId: string, mainWorkspaceId: string): string {
  return rawModuleId(moduleId).workspaceId ?? mainWorkspaceId;
}

/**
 * [2C2-02], before the window: the Goal's workspace's line and the line of every module the tasks use, each pinned for
 * the used modules on it (the Goal's line for none when it has none), sorted by `lineRef`. Any line that cannot be
 * read or pinned fails the read with its reason.
 */
export async function readPlanPin(lines: KnowledgeLines, caller: KnowledgeCaller, goalWorkspaceId: string,
  tasks: PlanRevisionDraft['tasks'], catalog: AdoptedArchitecture): Promise<StoreResult<PlanPinRead>> {
  const workspaces = await lines.workspaces(caller);
  if (workspaces.status !== 'ready') return workspaces;
  const mainWorkspaceId = workspaces.value[0]!;
  const byWorkspace = new Map<string, string[]>([[goalWorkspaceId, []]]);
  for (const moduleId of planUsedModules(tasks, catalog, goalWorkspaceId, mainWorkspaceId)) {
    const workspaceId = moduleWorkspaceOf(moduleId, mainWorkspaceId);
    byWorkspace.set(workspaceId, [...(byWorkspace.get(workspaceId) ?? []), moduleId]);
  }
  const pinned: { workspaceId: string; pin: KnowledgeLinePinV1 }[] = [];
  for (const [workspaceId, modules] of byWorkspace) {
    const line = await lines.line(caller, workspaceId);
    if (line.status !== 'ready') return line;
    const pin = await line.value.pin(modules);
    if (pin.status !== 'ready') return pin;
    pinned.push({ workspaceId, pin: pin.value });
  }
  pinned.sort((left, right) => left.pin.lineRef < right.pin.lineRef ? -1 : 1);
  return { status: 'ready', value: { goalWorkspaceId, mainWorkspaceId, lines: pinned } };
}

/**
 * [2C2-02], inside the window: the plan's pin over the same catalog for the tasks the module fact checked (a subset
 * of the ones read before it): the Goal's line and the lines of the modules they use, each dirty line's modules
 * narrowed to those.
 */
export function planPinOf(read: PlanPinRead, tasks: PlanRevisionDraft['tasks'], catalog: AdoptedArchitecture): KnowledgePinV1 {
  const used = planUsedModules(tasks, catalog, read.goalWorkspaceId, read.mainWorkspaceId);
  const workspaces = new Set([read.goalWorkspaceId,
    ...used.map(moduleId => moduleWorkspaceOf(moduleId, read.mainWorkspaceId))]);
  return { lines: read.lines.filter(entry => workspaces.has(entry.workspaceId)).map(({ pin }) => pin.modules === null ? pin
    : { ...pin, modules: pin.modules.filter(module => used.includes(module.moduleId)) }) };
}
