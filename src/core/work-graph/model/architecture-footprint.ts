/**
 * The one executed-file-to-module mapping and the one plan-footprint rule
 * (slice 5 §4.3/RW-13). It lives in `model` because the note side (the repair
 * footprint) and the read views both need it, and `notes` may not import
 * `views`. The function body is the one that used to live in
 * `views/goal-conflicts.ts`; that file re-exports this binding so its own
 * callers and tests keep their import path.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { RuntimeTask } from '../../../contracts/plan.js';
import type { ModuleRef } from '../../../contracts/core/identity.js';
import type { GoalFootprintV1 } from '../../../contracts/goal-decisions.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { pathOwnershipOf } from '../../../contracts/path-ownership.js';

/**
 * §4.3: project-relative, segmented, longest legal catalog path match (RW-13:
 * the ONE `pathOwnershipOf`); files with no single longest owner stay
 * `moduleRef: null` (unmapped), never guessed.
 */
export function mapExecutedFilesToModules(
  catalog: AdoptedArchitecture,
  files: readonly { path: string; certainty: 'definite' | 'possible' }[],
): GoalFootprintV1['executedFiles'] {
  const candidates = catalog.modules.map((definition) => ({ value: definition.ref, paths: definition.paths }));
  return files.map((file) => {
    const ownership = pathOwnershipOf(file.path, candidates);
    return { path: file.path, moduleRef: ownership.status === 'owner' ? ownership.owner : null, certainty: file.certainty };
  });
}

/**
 * DESIGN §1.2 (decision 42 第 4 条, decision 121-10): the plan half of one Goal's footprint, the ONE rule the conflict
 * read uses (and through it the conflict card's source check). Work tasks that are not cancelled or superseded count
 * (future and deferred are still intent). A task that lists planned files gives those files with its own module; any
 * other task with a module scope gives its module as a module claim.
 */
export function plannedFootprintOf(tasks: readonly RuntimeTask[], projectId: string):
Pick<GoalFootprintV1, 'plannedModules' | 'plannedFiles'> {
  const plannedModules: ModuleRef[] = [];
  const plannedFiles: GoalFootprintV1['plannedFiles'] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (task.taskKind !== 'work' || task.disposition === 'cancelled' || task.disposition === 'superseded') continue;
    const taskModule: ModuleRef | null = task.scope.kind === 'module'
      ? { projectId, moduleId: task.scope.moduleRef } : null;
    if (task.plannedFiles !== undefined) {
      for (const path of task.plannedFiles) plannedFiles.push({ path, taskModule });
    } else if (taskModule !== null) {
      const key = canonicalJson(taskModule as unknown as JsonValue);
      if (seen.has(key)) continue;
      seen.add(key);
      plannedModules.push(taskModule);
    }
  }
  return { plannedModules, plannedFiles };
}
