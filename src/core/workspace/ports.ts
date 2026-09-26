import type { WorkspaceRef } from '../../contracts/ledger.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SourceCaptureRef } from '../../contracts/core/source.js';
import type { ArchitectureSourceMapping, ArchitectureSourceSnapshotV1 } from '../../contracts/architecture-source.js';

/**
 * WorkspaceTools wire contract. `WorkspaceCapturePort` is the R2c capture subset; the full
 * `WorkspaceToolsPort` adds precise current/frozen reads and same-scope content comparison.
 * `readWorkspace`/`compareWorkspace` share this one registry implementation.
 */
export type WorkspaceError = 'invalid' | 'forbidden' | 'not_found'
  | 'source_stale' | 'capture_expired' | 'cursor_mismatch' | 'capacity'
  | 'unsupported' | 'unavailable' | 'cancelled';
export type WorkspaceResult<T> = { status: 'ready'; value: T }
  | { status: 'rejected'; code: WorkspaceError; reason: string };
export type SourceProvider = 'text' | 'typescript' | 'python' | 'cpp';
export type SourceLocation = {
  path: string; digest: string;
  start: { line: number; column: number }; end: { line: number; column: number };
};
export type SourceFileEntry = {
  path: string; digest: string; sizeBytes: number;
  kind: 'source' | 'configuration' | 'dependency_manifest' | 'text';
};
export type SourceRelation = {
  kind: 'import' | 'reference' | 'call'; from: SourceLocation;
  expression: string; targets: SourceLocation[];
  resolution: 'resolved' | 'static_candidate' | 'unknown';
};
export type SourceDiagnostic = { path: string | null; code: string; message: string };

/**
 * Declared content scope of one capture. `complete` means the declared scope was fully
 * processed; it never means the whole worktree or a complete semantic graph.
 */
export type CaptureContentScope =
  | { kind: 'typescript_project_inputs'; selectionVersion: 'ts-js-json-v1';
      prefix: null; digestBasis: 'decoded_utf8' }
  | { kind: 'text_files'; selectionVersion: 'readable-regular-utf8-no-nul-v1';
      prefix: string | null; digestBasis: 'raw_bytes' };

export type SourceCoverage = {
  provider: SourceProvider; engine: string; engineVersion: string;
  projectConfiguration: string | null; sourceCount: number;
  indexedSourceCount: number; permissionFiltered: true;
  scope: CaptureContentScope;
  complete: boolean; unresolved: string[];
  filesystemAtomic: false; fullRuntimeCallGraph: false;
};
export type CaptureSummary = {
  ref: SourceCaptureRef; capturedAt: string; verifiedAt: string;
  commitHash: string | null; expiresAt: string; coverage: SourceCoverage;
  changes: { added: string[]; modified: string[]; deleted: string[] };
};
export type SourceCaptureMaterial = {
  summary: CaptureSummary; files: SourceFileEntry[];
  relations: SourceRelation[]; diagnostics: SourceDiagnostic[]; diagnosticsTruncated: boolean;
};
export type CaptureSourceRequest = {
  workspace: WorkspaceRef; workspaceRevision: number;
  provider: SourceProvider; configPath?: string; prefix?: string;
  previous?: SourceCaptureRef; changedPaths?: readonly string[];
};
export type SourceQuery =
  | { kind: 'paths'; prefix?: string }
  | { kind: 'text'; text: string; caseSensitive: boolean; prefix?: string }
  | { kind: 'symbols'; path?: string; prefix?: string }
  | { kind: 'definitions' | 'references'; path: string; line: number; column: number }
  | { kind: 'imports' | 'calls'; path?: string; prefix?: string };
export type SourceHit =
  | { kind: 'file'; file: SourceFileEntry }
  | { kind: 'text'; location: SourceLocation; excerpt: string }
  | { kind: 'symbol'; location: SourceLocation; name: string; symbolKind: string }
  | { kind: 'location'; location: SourceLocation }
  | { kind: 'relation'; relation: SourceRelation };
export type SourcePageRequest = {
  capture: SourceCaptureRef; query: SourceQuery; cursor: string | null; limit: number;
};
export type SourcePage = {
  capture: SourceCaptureRef; items: SourceHit[]; nextCursor: string | null;
  complete: boolean; coverage: SourceCoverage;
  observation: 'captured_source'; currentness: 'not_rechecked';
};

export type WorkspaceVersion =
  | { kind: 'working_tree' }
  | { kind: 'git'; commit: string }
  | { kind: 'capture'; capture: SourceCaptureRef };
export type ReadWorkspaceRequest = {
  workspace: WorkspaceRef; path: string; maxBytes: number;
  version: WorkspaceVersion;
};
export type WorkspaceFile = {
  path: string; content: string; digest: string; sizeBytes: number;
  /** What `digest` hashes: raw file bytes, or the decoded UTF-8 text for TS captures. */
  digestBasis: 'raw_bytes' | 'decoded_utf8';
  version: WorkspaceVersion; readAt: string;
};
export type WorkspaceComparisonRequest = {
  workspace: WorkspaceRef;
  before: WorkspaceVersion;
  after: WorkspaceVersion;
  /** Git/working-tree scope selector; a capture/capture comparison rejects it as invalid. */
  prefix?: string;
};
export type WorkspaceChange =
  | { kind: 'added'; path: string; digest: string }
  | { kind: 'deleted'; path: string; digest: string }
  | { kind: 'modified'; path: string; beforeDigest: string; afterDigest: string }
  | { kind: 'renamed'; beforePath: string; afterPath: string;
      digest: string; evidence: 'identical_content' };

/** The one Git version shape; `commit` is a full lowercase commit OID, never a ref/expression. */
export type GitWorkspaceVersion = Extract<WorkspaceVersion, { kind: 'git' }>;

/** Original capture-content comparison. Field names and semantics are unchanged. */
export type CapturedWorkspaceComparison = {
  before: SourceCaptureRef; after: SourceCaptureRef;
  scope: CaptureContentScope;
  comparison: 'captured_content_only'; complete: true;
  changes: WorkspaceChange[];
};

/** Git blob identity: the object id is a Git blob OID, explicitly not the content SHA-256. */
export type GitFileIdentity = {
  objectId: string;
  mode: '100644' | '100755';
};
export type GitWorkspaceChange =
  | { kind: 'added'; path: string; after: GitFileIdentity }
  | { kind: 'deleted'; path: string; before: GitFileIdentity }
  | { kind: 'modified'; path: string; before: GitFileIdentity; after: GitFileIdentity };
export type GitWorkspaceComparison = {
  before: GitWorkspaceVersion; after: GitWorkspaceVersion;
  scope: { kind: 'git_regular_files'; selectionVersion: 'authorized-regular-blob-v1';
    prefix: string | null };
  comparison: 'git_tree_content_and_mode'; complete: true;
  changes: GitWorkspaceChange[];
};
/** The current working tree as one compare side. */
export type WorkingTreeWorkspaceVersion = Extract<WorkspaceVersion, { kind: 'working_tree' }>;
/** The one new mixed pair: one fixed Git commit against the current working tree. Direction is preserved. */
export type GitWorkingTreePair =
  | { before: GitWorkspaceVersion; after: WorkingTreeWorkspaceVersion }
  | { before: WorkingTreeWorkspaceVersion; after: GitWorkspaceVersion };
/**
 * One side of a mixed text comparison. `digest` is the original bytes' SHA-256 for both the
 * historical blob and the current file, never a re-encoded body; `mode` is normalized from the
 * owner-executable bit by the shared workspace rule.
 */
export type WorkspaceContentModeIdentity = {
  digest: string; digestBasis: 'raw_bytes'; sizeBytes: number;
  mode: '100644' | '100755';
};
export type GitWorkingTreeChange =
  | { kind: 'added'; path: string; after: WorkspaceContentModeIdentity }
  | { kind: 'deleted'; path: string; before: WorkspaceContentModeIdentity }
  | { kind: 'modified'; path: string;
      before: WorkspaceContentModeIdentity; after: WorkspaceContentModeIdentity };
export type GitWorkingTreeComparison = GitWorkingTreePair & {
  scope: Extract<CaptureContentScope, { kind: 'text_files' }>;
  comparison: 'git_worktree_raw_content_and_mode'; complete: true;
  observedAt: string; currentness: 'not_rechecked';
  changes: GitWorkingTreeChange[];
};
export type WorkspaceComparison = CapturedWorkspaceComparison | GitWorkspaceComparison | GitWorkingTreeComparison;

export interface WorkspaceCapturePort {
  captureSourceChanges(ctx: CoreCallContext, input: CaptureSourceRequest):
    Promise<WorkspaceResult<CaptureSummary>>;
  querySource(ctx: CoreCallContext, input: SourcePageRequest):
    Promise<WorkspaceResult<SourcePage>>;
  exportCapture(ctx: CoreCallContext, capture: SourceCaptureRef):
    Promise<WorkspaceResult<SourceCaptureMaterial>>;
  verifyCapture(ctx: CoreCallContext, capture: SourceCaptureRef):
    Promise<WorkspaceResult<{ capture: SourceCaptureRef; verifiedAt: string }>>;
  releaseCapture(ctx: CoreCallContext, capture: SourceCaptureRef):
    Promise<WorkspaceResult<{ released: boolean }>>;
  captureArchitectureSource(ctx: CoreCallContext, input: {
    capture: SourceCaptureRef; mappings: ArchitectureSourceMapping[];
  }): Promise<WorkspaceResult<ArchitectureSourceSnapshotV1>>;
}

export interface WorkspaceToolsPort extends WorkspaceCapturePort {
  readWorkspace(ctx: CoreCallContext, input: ReadWorkspaceRequest):
    Promise<WorkspaceResult<WorkspaceFile>>;
  compareWorkspace(ctx: CoreCallContext, input: WorkspaceComparisonRequest):
    Promise<WorkspaceResult<WorkspaceComparison>>;
}

/** Retention/capacity policy. Host-configured; never model-supplied. */
export type WorkspaceCaptureLimits = {
  maxFileBytes: number; maxCaptureBytes: number; maxInventoryFiles: number;
  maxQueryResults: number; maxRetainedCaptures: number;
  maxRetainedBytes: number; idleExpiryMs: number;
  maxQueriesPerCapture: number; maxCursorsPerCapture: number;
};

/**
 * Deep-freeze a published value so a caller cannot rewrite registry-retained material.
 * Module code never mutates published values; freezing turns an accidental write into a
 * TypeError instead of silent cross-request corruption.
 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

const safeRelative = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  !/[\\:\0]/.test(value) && value.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');

/** Validate query scope in the core so a malformed path/prefix/coordinate is rejected, never an empty match. */
export function validateSourceQuery(query: SourceQuery): string | null {
  const scope = (value: string | undefined, label: string) => value !== undefined && !safeRelative(value) ? `${label} must be a normalized relative path` : null;
  if (query.kind === 'definitions' || query.kind === 'references') {
    const pathError = scope(query.path, 'path');
    if (pathError) return pathError;
    if (!Number.isSafeInteger(query.line) || query.line < 1 || !Number.isSafeInteger(query.column) || query.column < 1)
      return 'definitions/references require one-based integer line and column';
    return null;
  }
  if (query.kind === 'text') {
    const prefixError = scope(query.prefix, 'prefix');
    if (prefixError) return prefixError;
    if (typeof query.caseSensitive !== 'boolean') return 'text queries require a boolean caseSensitive';
    if (typeof query.text !== 'string' || query.text.length === 0) return 'text must be a non-empty string';
    if (Array.from(query.text).length > 512) return 'text must be at most 512 Unicode code points';
    if (Buffer.byteLength(query.text) > 2048) return 'text must be at most 2048 UTF-8 bytes';
    if (/[\r\n]/.test(query.text)) return 'text must not contain CR or LF';
    return null;
  }
  const pathError = scope(query.kind === 'symbols' || query.kind === 'imports' || query.kind === 'calls' ? query.path : undefined, 'path');
  const prefix = query.kind === 'paths' || query.kind === 'symbols' || query.kind === 'imports' || query.kind === 'calls' ? query.prefix : undefined;
  return pathError ?? scope(prefix, 'prefix');
}
