export const MODULE_TARGET_PATH: string;
export interface ModuleTargetSubmodule {
  id: string;
  path: string;
  directory: boolean;
  dependencies: string[];
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
  /** Spec §14.4 pure directories, e.g. `src/core/work-graph/state/`. */
  pureDirectories: string[];
  issues: string[];
}>;
export function auditSourceTree(projectDir: string): Promise<string[]>;
export function inspectSourceTree(projectDir: string): Promise<{
  issues: string[];
  modules: { name: string; directory: boolean; sourceFiles: number }[];
  submodules: { name: string; sourceFiles: number }[];
  allowedEdgeCount: number;
  pureDirectories: string[];
  observedEdges: string[];
  observedSubmoduleEdges: string[];
}>;
