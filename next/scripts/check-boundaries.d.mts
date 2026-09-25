export function auditSourceTree(projectDir: string): Promise<string[]>;
export function inspectSourceTree(projectDir: string): Promise<{
  issues: string[];
  modules: { name: string; directory: boolean; sourceFiles: number }[];
  observedEdges: string[];
}>;
