/**
 * The one executed-file-to-module mapping (slice 5 §4.3/RW-13). It lives in
 * `model` because the note side (the repair footprint) and the read views both
 * need it, and `notes` may not import `views`. The function body is the one
 * that used to live in `views/goal-conflicts.ts`; that file re-exports this
 * binding so its own callers and tests keep their import path.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { GoalFootprintV1 } from '../../../contracts/goal-decisions.js';
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
