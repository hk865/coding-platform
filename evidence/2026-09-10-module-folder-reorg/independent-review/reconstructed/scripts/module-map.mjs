/** Actual implementation ownership. This is a source map for the existing
 * twelve Modules, not another product or runtime task graph. */
export const modules = [
 'HumanCollaboration','PlanCompiler','ControlEngine','DispatchEngine','VerificationEngine','ArchitectureReconciler',
 'WorkerRuntime','StateLedger','ArtifactVault','ReadModelIndex','ContextCompiler','WorkspaceReader',
];
/** Long-term dependencies, including injected ports. Kept in step with
 * ARCHITECTURE.md; tests alone cannot discover or approve new DI edges. */
export const allowedModuleDependencies = {
 HumanCollaboration: ['PlanCompiler','ControlEngine','ReadModelIndex','DispatchEngine','ContextCompiler','VerificationEngine','ArtifactVault'],
 PlanCompiler: ['ContextCompiler','ControlEngine'],
 ControlEngine: ['StateLedger'],
 DispatchEngine: ['ControlEngine','ContextCompiler','WorkerRuntime','ArtifactVault','StateLedger','PlanCompiler'],
 VerificationEngine: ['ControlEngine','ContextCompiler','ArtifactVault'],
 ArchitectureReconciler: ['ControlEngine','ContextCompiler','ArtifactVault'],
 WorkerRuntime: ['ContextCompiler','WorkspaceReader','ArtifactVault'],
 ContextCompiler: ['StateLedger','ArtifactVault','ReadModelIndex','WorkspaceReader'],
 ArtifactVault: ['StateLedger','ReadModelIndex','WorkspaceReader'],
 ReadModelIndex: ['StateLedger','ControlEngine'],
 StateLedger: [], WorkspaceReader: [],
};
/**
 * Directory prefix -> owner. EVERY Module owns exactly one directory, so
 * ownership is decidable from the path alone: `src/control/dispatch-engine/…`
 * is DispatchEngine, `src/data/state-ledger/…` is StateLedger, and so on. No
 * filename lists, no per-file exceptions — a file whose path does not say which
 * Module it belongs to is a layout bug, and is reported as Unmapped.
 *
 * Ordered longest-prefix-first so a nested or future prefix cannot be shadowed
 * by a shorter one.
 */
const moduleDirs = [
 ['src/control/control-engine/', 'ControlEngine'],
 ['src/control/plan-compiler/', 'PlanCompiler'],
 ['src/control/dispatch-engine/', 'DispatchEngine'],
 ['src/control/verification-engine/', 'VerificationEngine'],
 ['src/control/architecture-reconciler/', 'ArchitectureReconciler'],
 ['src/interaction/human-collaboration/', 'HumanCollaboration'],
 ['src/execution/worker-runtime/', 'WorkerRuntime'],
 ['src/data/state-ledger/', 'StateLedger'],
 ['src/data/artifact-vault/', 'ArtifactVault'],
 ['src/data/read-model-index/', 'ReadModelIndex'],
 ['src/data/context-compiler/', 'ContextCompiler'],
 ['src/data/workspace-reader/', 'WorkspaceReader'],
];
/** Non-Module path prefixes: shared surfaces and composition root. */
const surfaceDirs = [
 ['src/app/public/', 'UI'],
 ['src/contracts/fixtures/', 'Fixtures'],
 ['src/contracts/testing/', 'TestDoubles'],
 ['src/contracts/', 'Contracts'],
 ['src/app/', 'Host'],
 ['src/harness/', 'Host'],
 ['src/storage/', 'Storage'],
 ['src/ui/', 'UI'],
];
export function owner(file) {
 const path=file.replaceAll('\\','/');
 const hit=moduleDirs.find(([dir])=>path.startsWith(dir));
 if(hit)return hit[1];
 const surface=surfaceDirs.find(([dir])=>path.startsWith(dir));
 if(surface)return surface[1];
 return 'Unmapped';
}
