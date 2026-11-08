/**
 * xws2p: the read-time projection of the ONE project catalog onto one
 * workspace. The catalog stays a single project record; this pure view keeps
 * only the modules that declare a path in the requested workspace, strips the
 * prefix from those paths, and drops dependencies/containment whose ends are
 * gone. It lives in Contracts because WorkGraph and the UI task map share this
 * exact view and neither may import the other.
 */
import type { AdoptedArchitecture, ModuleDefinition } from './architecture-catalog.js';
import { splitWorkspacePath } from './workspace-path.js';

function workspaceModuleKey(ref: ModuleDefinition['ref']): string {
  return `${ref.projectId}\u0000${ref.moduleId}`;
}

export function catalogForWorkspace(catalog: AdoptedArchitecture, workspaceId: string,
  mainWorkspaceId: string | null): AdoptedArchitecture {
  const modules: ModuleDefinition[] = [];
  const kept = new Set<string>();
  for (const module of catalog.modules) {
    const paths: string[] = [];
    for (const path of module.paths) {
      const parsed = splitWorkspacePath(path);
      if ((parsed.workspaceId ?? mainWorkspaceId) !== workspaceId) continue;
      paths.push(parsed.path);
    }
    if (paths.length === 0) continue;
    const interfaces = module.interfaces.map(iface => {
      const interfacePaths: string[] = [];
      for (const path of iface.paths) {
        const parsed = splitWorkspacePath(path);
        if ((parsed.workspaceId ?? mainWorkspaceId) !== workspaceId) continue;
        interfacePaths.push(parsed.path);
      }
      return { ...iface, paths: interfacePaths };
    });
    modules.push({ ...module, paths, interfaces });
    kept.add(workspaceModuleKey(module.ref));
  }
  const dependencies = catalog.dependencies.filter(dependency =>
    kept.has(workspaceModuleKey(dependency.from)) && kept.has(workspaceModuleKey(dependency.to)));
  const projected: AdoptedArchitecture = { modules, dependencies, requireDag: catalog.requireDag };
  if (catalog.containment !== undefined) {
    projected.containment = {
      parentOf: catalog.containment.parentOf.filter(pair =>
        kept.has(workspaceModuleKey(pair.parent)) && kept.has(workspaceModuleKey(pair.child))),
    };
  }
  return projected;
}
