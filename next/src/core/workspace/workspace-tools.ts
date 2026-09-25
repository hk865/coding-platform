import { CaptureRegistry } from './capture.js';
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
  const registry = new CaptureRegistry({ access: deps.access, now: deps.now, limits: validateLimits(deps.limits) });
  const tools: WorkspaceToolsPort = {
    captureSourceChanges: (ctx, input) => registry.capture(ctx, input),
    querySource: (ctx, input) => registry.query(ctx, input),
    exportCapture: (ctx, ref) => registry.exportMaterial(ctx, ref),
    verifyCapture: (ctx, ref) => registry.verify(ctx, ref),
    releaseCapture: (ctx, ref) => registry.release(ctx, ref),
    captureArchitectureSource: (ctx, input) => registry.architectureSource(ctx, input),
    readWorkspace: (ctx, input) => registry.read(ctx, input),
    compareWorkspace: (ctx, input) => registry.compare(ctx, input),
  };
  return { tools, close: () => registry.close() };
}
