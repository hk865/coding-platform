import { CaptureRegistry } from './capture.js';
import { createPythonLanguageProvider } from './architecture-language-provider.js';
import type { WorkspaceAccessFactory } from './access.js';
import type { WorkspaceCaptureLimits, WorkspaceToolsPort } from './ports.js';

/** Host defaults (module page §8 / task book §6); the model never supplies these. */
export const DEFAULT_WORKSPACE_LIMITS: WorkspaceCaptureLimits = {
  maxFileBytes: 2 * 1024 * 1024,
  maxCaptureBytes: 128 * 1024 * 1024,
  maxInventoryFiles: 60000,
  maxQueryResults: 10000,
  maxRetainedCaptures: 8,
  maxRetainedBytes: 256 * 1024 * 1024,
  idleExpiryMs: 300000,
  maxQueriesPerCapture: 16,
  maxCursorsPerCapture: 1024,
};

export type WorkspaceToolsDependencies = {
  access: WorkspaceAccessFactory;
  now: () => string;
  limits: WorkspaceCaptureLimits;
  /** 8A file-graph caps; defaults are 20,000 files / 100,000 edges. Injectable for capacity tests. */
  fileGraph?: { maxNodes: number; maxEdges: number };
  /** §11.2 trusted test/host injection for the one observation light scan (faults
   * and the raw-reference cap). Never model input. */
  lightScan?: { fault?: (event: { phase: 'language' } | { phase: 'file'; path: string }) => void; maxRawReferences?: number };
  /**
   * L13/8D trusted analyzer resources. `directory` is the Python analyzers archive
   * directory and is forwarded only to the exploration tools; `cppLibraryPath` is
   * the installed libclang and `pythonPath` the system interpreter for both
   * analyzers. `unitTimeoutMs`/`languageTimeoutMs` are the §11.5 runner limits;
   * exploration ignores them. Production passes nothing and keeps the indexes'
   * own defaults; this is test/host injection, never model input.
   */
  sourceAnalyzers?: { directory?: string; pythonPath?: string; cppLibraryPath?: string;
    unitTimeoutMs?: number; languageTimeoutMs?: number };
};
export type WorkspaceToolsHandle = {
  tools: WorkspaceToolsPort;
  close(): Promise<void>;
};

const HARD_LIMITS: Record<string, number> = {
  maxFileBytes: DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
  maxCaptureBytes: DEFAULT_WORKSPACE_LIMITS.maxCaptureBytes,
  maxInventoryFiles: DEFAULT_WORKSPACE_LIMITS.maxInventoryFiles,
};
function validateLimits(limits: WorkspaceCaptureLimits): WorkspaceCaptureLimits {
  const names = Object.keys(DEFAULT_WORKSPACE_LIMITS) as (keyof WorkspaceCaptureLimits)[];
  for (const name of names) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value < 1) throw Error(name + ' must be a positive safe integer');
    if (HARD_LIMITS[name] !== undefined && value > HARD_LIMITS[name]) throw Error(name + ' exceeds the workspace source hard limit');
  }
  return { ...limits };
}

/** Assemble the implemented WorkspaceTools surface over one registry and Host-configured limits. */
export function createWorkspaceTools(deps: WorkspaceToolsDependencies): WorkspaceToolsHandle {
  const analyzers = deps.sourceAnalyzers;
  // The observation's Python provider gets only the interpreter and the runner
  // timeouts; `sourceAnalyzers.directory` reaches the exploration tools alone.
  const providers = [
    createPythonLanguageProvider({
      ...(analyzers?.pythonPath === undefined ? {} : { pythonPath: analyzers.pythonPath }),
      ...(analyzers?.unitTimeoutMs === undefined ? {} : { unitTimeoutMs: analyzers.unitTimeoutMs }),
      ...(analyzers?.languageTimeoutMs === undefined ? {} : { languageTimeoutMs: analyzers.languageTimeoutMs }),
    }),
  ];
  const registry = new CaptureRegistry({ access: deps.access, now: deps.now, limits: validateLimits(deps.limits),
    providers, ...(analyzers === undefined ? {} : { analyzers }),
    ...(deps.lightScan === undefined ? {} : { lightScan: deps.lightScan }),
    ...(deps.fileGraph ? { fileGraph: deps.fileGraph } : {}) });
  const tools: WorkspaceToolsPort = {
    captureSourceChanges: (ctx, input) => registry.capture(ctx, input),
    captureObservation: (ctx, input) => registry.captureObservation(ctx, input),
    querySource: (ctx, input) => registry.query(ctx, input),
    exportCapture: (ctx, ref) => registry.exportMaterial(ctx, ref),
    verifyCapture: (ctx, ref) => registry.verify(ctx, ref),
    releaseCapture: (ctx, ref) => registry.release(ctx, ref),
    captureArchitectureSource: (ctx, input) => registry.architectureSource(ctx, input),
    captureFileGraph: (ctx, input) => registry.captureFileGraph(ctx, input),
    readWorkspace: (ctx, input) => registry.read(ctx, input),
    compareWorkspace: (ctx, input) => registry.compare(ctx, input),
  };
  return { tools, close: () => registry.close() };
}
