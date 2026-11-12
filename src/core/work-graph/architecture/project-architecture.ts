/**
 * KLS-2b (A8): the project view of a project with several workspaces, merged
 * from every workspace's own architecture files. Pure. It lives here, not in
 * `knowledge/`: it validates the merge with the catalog validator.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import { rawModuleId } from '../../../contracts/workspace-module-id.js';
import type { DecodeResult } from '../../record-store/ports.js';
import type { KnowledgeArchitecture, KnowledgeBaselineV1, KnowledgeLineScope } from '../model/line-knowledge.js';
import { ARCHITECTURE_FILE_PATH } from '../../../contracts/knowledge.js';
import { inModuleIdOrder } from './architecture-file.js';
import { validateAdoptedArchitecture } from './catalog-record-codecs.js';

/**
 * `parts` in the order of `KnowledgeLines.workspaces` (the main workspace first). The baseline is the main
 * workspace's; every part's modules and in-workspace edges join as they are; a cross-workspace edge joins when its
 * far end's workspace is one of the parts (one that left the project, or another project's, is left out and its
 * file is not changed); containment is declared when every part that has modules declares it; the merge passes
 * the catalog validator (cycles and dangling ends across workspaces).
 */
export function projectArchitectureOf(
  parts: readonly { scope: KnowledgeLineScope; architecture: KnowledgeArchitecture }[], projectId: string,
): DecodeResult<{ catalog: AdoptedArchitecture; baseline: KnowledgeBaselineV1 }> {
  const invalid = (reason: string): DecodeResult<never> => ({ status: 'invalid', reason });
  const main = parts[0];
  if (main === undefined || main.architecture.baseline === null) {
    return invalid(`${ARCHITECTURE_FILE_PATH} of the main workspace carries no baseline`);
  }
  const baseline = main.architecture.baseline;
  if (parts.length === 1) return { status: 'decoded', value: { catalog: main.architecture.catalog, baseline } };
  const present = new Set(parts.map(part => part.scope.workspaceId));
  const inProject = (moduleId: string): boolean => present.has(rawModuleId(moduleId).workspaceId ?? main.scope.workspaceId);
  const withModules = parts.filter(part => part.architecture.catalog.modules.length > 0);
  const declared = withModules.filter(part => part.architecture.catalog.containment !== undefined).length;
  if (declared > 0 && declared < withModules.length) {
    return invalid('either every workspace with modules declares containment or none does');
  }
  const merged: AdoptedArchitecture = {
    modules: parts.flatMap(part => part.architecture.catalog.modules),
    dependencies: parts.flatMap(part => [...part.architecture.catalog.dependencies,
      ...part.architecture.crossWorkspace.dependencies.filter(edge => inProject(edge.to.moduleId))]),
    requireDag: true,
    ...(declared === 0 ? {} : { containment: { parentOf: parts.flatMap(part => [
      ...(part.architecture.catalog.containment?.parentOf ?? []),
      ...part.architecture.crossWorkspace.parentOf.filter(edge => inProject(edge.child.moduleId))]) } }),
  };
  const checked = validateAdoptedArchitecture(merged, projectId);
  if (checked.status !== 'ok') return invalid(`the project view of the workspaces' files: ${checked.reason}`);
  return { status: 'decoded', value: { catalog: inModuleIdOrder(checked.value), baseline } };
}
