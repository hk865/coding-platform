export const MODULE_TARGET_PATH: string;
export interface ModuleTargetSubmodule {
  id: string;
  path: string;
  directory: boolean;
  dependencies: string[];
  /** Spec §14.4 `pure: true`: imports only src/contracts/, itself and its declared dependencies. */
  pure: boolean;
}
export interface ModuleTargetModule {
  id: string;
  path: string;
  prefix: string;
  dependencies: string[];
  submodules: ModuleTargetSubmodule[] | null;
}
export function loadModuleTarget(projectDir: string): Promise<{
  modules: ModuleTargetModule[];
  issues: string[];
}>;
export function auditSourceTree(projectDir: string): Promise<string[]>;
export function inspectSourceTree(projectDir: string): Promise<{
  issues: string[];
  modules: { name: string; directory: boolean; sourceFiles: number }[];
  submodules: { name: string; sourceFiles: number }[];
  allowedEdgeCount: number;
  /** Spec §14.4 pure submodules, e.g. `WorkGraph/state`. */
  pureSubmodules: string[];
  observedEdges: string[];
  observedSubmoduleEdges: string[];
}>;
