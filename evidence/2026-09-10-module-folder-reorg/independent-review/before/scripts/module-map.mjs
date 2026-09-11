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
const dispatch = new Set(['dispatch-engine','handoff-drive','workspace-drive','query-drive','exploration-context-drive','leased-worker-runtime','planned-task-dispatch','runtime-dispatch','operator-task-dispatch','reviewer-dispatch']);
const planning = new Set(['plan-compiler','initial-plan-compiler','operator-plan-compiler']);
const architecture = new Set(['architecture-reconciler','architecture-delta','baseline-evolution-port']);
export function owner(file) {
 const path=file.replaceAll('\\','/');
 const name=path.split('/').at(-1).replace(/\.(ts|tsx|js|py)$/,'');
 if(path==='src/app/terminal-sandbox.py')return 'WorkerRuntime';
 if(path.startsWith('src/app/public/'))return 'UI';
 if(path.startsWith('src/contracts/fixtures/'))return 'Fixtures';
 if(path.startsWith('src/contracts/testing/'))return 'TestDoubles';
 if(path.startsWith('src/contracts/'))return 'Contracts';
 if(path.startsWith('src/control/'))return dispatch.has(name)?'DispatchEngine':planning.has(name)?'PlanCompiler':architecture.has(name)?'ArchitectureReconciler':'ControlEngine';
 if(path.startsWith('src/interaction/'))return 'HumanCollaboration';
 if(path.startsWith('src/context/'))return 'ContextCompiler';
 if(path.startsWith('src/verification/'))return 'VerificationEngine';
 if(path.startsWith('src/runtime/'))return 'WorkerRuntime';
 if(path.startsWith('src/vault/'))return 'ArtifactVault';
 if(/^src\/(sqlite-)?ledger\//.test(path))return 'StateLedger';
 if(/^src\/(sqlite-)?read-model\//.test(path))return 'ReadModelIndex';
 if(path.startsWith('src/data/'))return /\/(governance-records|ledger-scope-catalog)\.ts$/.test(path)?'StateLedger':'WorkspaceReader';
 if(/^src\/(app|harness)\//.test(path))return 'Host';
 if(path.startsWith('src/storage/'))return 'Storage';
 if(path.startsWith('src/ui/'))return 'UI';
 return 'Unmapped';
}
