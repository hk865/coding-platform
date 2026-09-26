/** Actual implementation ownership. This is a source map for the Modules that
 * exist in the source today, not another product or runtime task graph.
 * R3a added WorkGraph and RecordStore — the first two modules of the target core
 * DAG (docs/refactor/module-dag.md). It is the only pair whose edge (WorkGraph ->
 * RecordStore) has a real consumer in this batch; the remaining target edges are
 * declared together with their real consumers, never in advance. */
export const modules = [
 'HumanCollaboration','PlanCompiler','ControlEngine','DispatchEngine','VerificationEngine','ArchitectureReconciler',
 'WorkerRuntime','StateLedger','ArtifactVault','ReadModelIndex','ContextCompiler','WorkspaceTools',
 'WorkGraph','RecordStore',
];
/** Declared implementation edges checked below. Transitional injected readers
 * are explicitly listed separately; import checks cannot prove the full DI DAG. */
export const allowedModuleDependencies = {
 HumanCollaboration: ['PlanCompiler','ControlEngine','ReadModelIndex','DispatchEngine','ContextCompiler','VerificationEngine','ArtifactVault'],
 PlanCompiler: ['ContextCompiler','ControlEngine'],
 // R3a migration edge: ControlEngine -> WorkGraph replaces Control's own Goal
 // creation body. ControlEngine -> StateLedger remains until the other commit
 // kinds migrate.
 ControlEngine: ['StateLedger','WorkGraph'],
 DispatchEngine: ['ControlEngine','ContextCompiler','WorkerRuntime','ArtifactVault','StateLedger','PlanCompiler'],
 VerificationEngine: ['ControlEngine','ContextCompiler','ArtifactVault'],
 ArchitectureReconciler: ['ControlEngine','ContextCompiler','ArtifactVault'],
 WorkerRuntime: ['ContextCompiler','WorkspaceTools','ArtifactVault'],
 // R3b: ordinary material reads use WorkGraph's material port. Model-input
 // consumers keep the legacy ArtifactPort until their own flow migrates.
 ContextCompiler: ['StateLedger','ArtifactVault','ReadModelIndex','WorkspaceTools','WorkGraph'],
 // R3b legacy entry only delegates; physical bodies and domain rules have one owner.
 ArtifactVault: ['WorkGraph','RecordStore'],
 ReadModelIndex: ['StateLedger','ControlEngine'],
 // R3a migration edges: the legacy ledger adapters delegate goal-create to
 // WorkGraph and share the physical backend owned by RecordStore. WorkGraph must
 // never depend on StateLedger, and RecordStore depends on no Module at all.
 StateLedger: ['WorkGraph','RecordStore'], WorkspaceTools: [],
 // R3b material applicability uses the existing WorkspaceTools source-pin check.
 WorkGraph: ['RecordStore','WorkspaceTools'],
 RecordStore: [],
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
 ['src/core/workspace/', 'WorkspaceTools'],
 ['src/core/work-graph/', 'WorkGraph'],
 ['src/core/record-store/', 'RecordStore'],
];
/** Non-Module path prefixes: shared surfaces and composition root. */
const surfaceDirs = [
 ['src/app/public/', 'UI'],
 ['src/fixtures/', 'Fixtures'],
 ['src/testing/', 'TestDoubles'],
 ['src/contracts/', 'Contracts'],
 ['src/app/', 'Host'],
 ['src/harness/', 'Host'],
 ['src/composition/', 'Host'],
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

/** R3b migration debt, not target dependencies. These read capabilities still
 * come from legacy modules. StateLedger -> WorkGraph Goal delegation makes the
 * combined module graph cyclic, although the exact reader calls do not recurse.
 * Remove each entry only when the real provider moves to RecordStore. */
export const transitionalInjectedDependencies = [
 { from: 'WorkGraph', to: 'StateLedger', capability: 'canonical snapshot load', exitBatch: 'R3c reader migration' },
 { from: 'WorkGraph', to: 'ReadModelIndex', capability: 'materialAccessCandidates', exitBatch: 'R3c index migration' },
];
