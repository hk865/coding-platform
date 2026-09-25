import { toolSchema as z, type ToolDefinition, type ToolResult } from '../../../vendor/coding-agent/dist/public-api.js';
import type { SourceCaptureRef } from '../../contracts/core/source.js';
import type { JsonValue } from '../../contracts/fingerprint.js';
import type { RuntimeSourceCaptureAccess } from './source-tool-ports.js';
import type {
  CaptureSummary, SourceCoverage, SourcePage, SourceQuery, WorkspaceComparison, WorkspaceFile, WorkspaceResult,
} from '../../core/workspace/ports.js';

/**
 * The `project_source` model wire. It is a thin adapter over the trusted WorkspaceToolsPort:
 * it owns no capture/cursor/AST/authorization cache of its own, and every request
 * re-authorizes inside the core. The model sees exactly six actions — capture once (TS or
 * strict text), page a frozen capture with an opaque cursor, read one exact current or frozen
 * file, compare two same-scope captures, verify currentness explicitly, release when done —
 * and never supplies root, revision, principal, role or a git expression.
 */

const METADATA_SAMPLE_LIMIT = 5;
const METADATA_ITEM_CODE_POINTS = 160;

/** Bounded model-side preview of one exact list: precise count, at most five samples of at
 * most 160 Unicode code points, with truncation stated explicitly in both cases. */
export type MetadataSample = { count: number; sample: string[]; truncated: boolean };
export type ModelSourceCoverage = Omit<SourceCoverage, 'unresolved'> & { unresolved: MetadataSample };
export type ModelCaptureSummary = Omit<CaptureSummary, 'coverage' | 'changes'> & {
  coverage: ModelSourceCoverage;
  changes: { added: MetadataSample; modified: MetadataSample; deleted: MetadataSample };
};
export type ModelSourcePage = Omit<SourcePage, 'coverage'> & { coverage: ModelSourceCoverage };
/** Every frozen-query kind the core implements; the schema below decides the exact wire. */
export type SourceQuerySupported = SourceQuery;
/** The model may read a working-tree file or one exact frozen capture; git stays unsupported. */
export type ModelReadVersion =
  | { kind: 'working_tree' }
  | { kind: 'capture'; capture: SourceCaptureRef };
export type ProjectSourceToolInput =
  | { action: 'capture'; provider?: 'typescript' | 'text'; configPath?: string; prefix?: string; previous?: SourceCaptureRef }
  | { action: 'query'; capture: SourceCaptureRef; query: SourceQuerySupported; cursor: string | null; limit: number }
  | { action: 'read'; path: string; maxBytes: number; version: ModelReadVersion }
  | { action: 'compare'; before: SourceCaptureRef; after: SourceCaptureRef }
  | { action: 'verify'; capture: SourceCaptureRef }
  | { action: 'release'; capture: SourceCaptureRef };

export function metadataSample(values: readonly string[]): MetadataSample {
  const preview = values.slice(0, METADATA_SAMPLE_LIMIT);
  const sample = preview.map(value => {
    const codePoints = Array.from(value);
    return codePoints.length > METADATA_ITEM_CODE_POINTS ? codePoints.slice(0, METADATA_ITEM_CODE_POINTS).join('') : value;
  });
  const truncated = values.length > METADATA_SAMPLE_LIMIT
    || preview.some(value => Array.from(value).length > METADATA_ITEM_CODE_POINTS);
  return { count: values.length, sample, truncated };
}
export const toModelCoverage = (coverage: SourceCoverage): ModelSourceCoverage =>
  ({ ...coverage, unresolved: metadataSample(coverage.unresolved) });
export const toModelCapture = (summary: CaptureSummary): ModelCaptureSummary => ({
  ...summary,
  coverage: toModelCoverage(summary.coverage),
  changes: {
    added: metadataSample(summary.changes.added),
    modified: metadataSample(summary.changes.modified),
    deleted: metadataSample(summary.changes.deleted),
  },
});

const identifier = z.string().min(1).max(512);
const digest = z.string().regex(/^[a-f0-9]{64}$/, 'Use a lowercase hexadecimal sha256 digest');
const positiveInt = z.number().int().positive().refine(Number.isSafeInteger, 'Use a positive safe integer');
/** The existing normalized relative path constraint, including rejection of `.` segments. */
const relativePath = z.string().min(1).max(1024).refine(value =>
  !value.startsWith('/') && !/[\\:\0]/.test(value)
  && value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..'),
  'Use a normalized workspace-relative path');
const captureRefSchema = z.object({
  projectId: identifier, workspaceId: identifier, captureId: identifier,
  workspaceRevision: positiveInt,
  sourceDigest: digest, configDigest: digest, indexVersion: identifier,
}).strict();
const scopedQuery = { path: relativePath.optional(), prefix: relativePath.optional() };
const textNeedle = z.string().min(1).max(2048).refine(value => !/[\r\n]/.test(value), 'Use a single-line literal text');
const querySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('paths'), prefix: relativePath.optional() }).strict(),
  z.object({ kind: z.literal('text'), text: textNeedle, caseSensitive: z.boolean(), prefix: relativePath.optional() }).strict(),
  z.object({ kind: z.literal('symbols'), ...scopedQuery }).strict(),
  z.object({ kind: z.literal('definitions'), path: relativePath, line: positiveInt, column: positiveInt }).strict(),
  z.object({ kind: z.literal('references'), path: relativePath, line: positiveInt, column: positiveInt }).strict(),
  z.object({ kind: z.literal('imports'), ...scopedQuery }).strict(),
  z.object({ kind: z.literal('calls'), ...scopedQuery }).strict(),
]);
/** Model reads are bounded to 8192 raw bytes so the worst-case JSON escape stays inside the output limit. */
const MODEL_READ_MAX_BYTES = 8192;
const readVersionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('working_tree') }).strict(),
  z.object({ kind: z.literal('capture'), capture: captureRefSchema }).strict(),
]);
export const projectSourceInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('capture'), provider: z.enum(['typescript', 'text']).optional(), configPath: relativePath.optional(), prefix: relativePath.optional(), previous: captureRefSchema.optional() }).strict(),
  z.object({ action: z.literal('query'), capture: captureRefSchema, query: querySchema, cursor: z.string().min(1).max(2048).nullable(), limit: z.number().int().min(1).max(200).default(100) }).strict(),
  z.object({ action: z.literal('read'), path: relativePath, maxBytes: z.number().int().min(1).max(MODEL_READ_MAX_BYTES), version: readVersionSchema }).strict(),
  z.object({ action: z.literal('compare'), before: captureRefSchema, after: captureRefSchema }).strict(),
  z.object({ action: z.literal('verify'), capture: captureRefSchema }).strict(),
  z.object({ action: z.literal('release'), capture: captureRefSchema }).strict(),
]);

type ProjectSourceOutcome =
  | { action: 'capture'; result: WorkspaceResult<ModelCaptureSummary> }
  | { action: 'query'; result: WorkspaceResult<ModelSourcePage> }
  | { action: 'read'; result: WorkspaceResult<WorkspaceFile> }
  | { action: 'compare'; result: WorkspaceResult<WorkspaceComparison> }
  | { action: 'verify'; result: WorkspaceResult<{ capture: SourceCaptureRef; verifiedAt: string }> }
  | { action: 'release'; result: WorkspaceResult<{ released: boolean }> };

export type ProjectSourceToolOptions = {
  /**
   * Trusted per-loop capability; the tool never opens or closes it. The object form is the
   * existing contract. The resolver form is the frozen B1 first-use seam: it is called only
   * after argument/path validation and before dispatch, and its result is shared for the run;
   * the run loop, not this tool, still owns opening/closing it.
   */
  access: RuntimeSourceCaptureAccess | (() => Promise<RuntimeSourceCaptureAccess>);
  /** The existing exploration/Reviewer path policy; no second permission cache is built here. */
  requireVisible: (path: string) => void;
  assertCurrent?: () => Promise<void>;
};

const NONE = { sideEffect: 'none' as const, changedPaths: [], workspaceRevision: null, artifactRefs: [] };
const MODEL_OUTPUT_LIMIT_BYTES = 60 * 1024;

const cancelled = (callId: string): ToolResult => ({
  schemaVersion: 1, callId, status: 'cancelled', reason: 'Project source operation cancelled', output: [], effects: NONE,
});
const invalidArguments = (callId: string): ToolResult => ({
  schemaVersion: 1, callId, status: 'error',
  error: { code: 'invalid_arguments', message: 'Invalid project_source arguments', retryable: false },
  output: [], effects: NONE,
});
const executionFailed = (callId: string, message: string): ToolResult => ({
  schemaVersion: 1, callId, status: 'error',
  error: { code: 'execution_failed', message, retryable: false },
  output: [{ kind: 'text', text: message }], effects: NONE,
});
const succeeded = (callId: string, value: JsonValue): ToolResult => ({
  schemaVersion: 1, callId, status: 'success', output: [{ kind: 'json', value }], effects: NONE,
});

const exactMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function requireQueryVisible(requireVisible: (path: string) => void, query: SourceQuerySupported): void {
  // Nested query fields are the real read scope; the wrapper's top-level check cannot see them.
  if ('path' in query && query.path !== undefined) requireVisible(query.path);
  if ('prefix' in query && query.prefix !== undefined) requireVisible(query.prefix);
}

async function dispatch(
  input: ProjectSourceToolInput,
  signal: AbortSignal,
  access: RuntimeSourceCaptureAccess,
): Promise<ProjectSourceOutcome> {
  if (input.action === 'capture') {
    // The trusted workspace and its registered revision come from the Host capability, never
    // from model arguments; `previous` is fully re-verified by the core.
    const revision = await access.currentWorkspaceRevision(signal);
    if (revision.status !== 'ready') return { action: 'capture', result: revision };
    const captured = await access.port.captureSourceChanges(access.context(signal), {
      workspace: access.workspace, workspaceRevision: revision.value, provider: input.provider ?? 'typescript',
      ...(input.configPath !== undefined ? { configPath: input.configPath } : {}),
      ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
      ...(input.previous !== undefined ? { previous: input.previous } : {}),
    });
    return { action: 'capture', result: captured.status === 'ready' ? { status: 'ready', value: toModelCapture(captured.value) } : captured };
  }
  const ctx = access.context(signal);
  if (input.action === 'query') {
    const page = await access.port.querySource(ctx, { capture: input.capture, query: input.query, cursor: input.cursor, limit: input.limit });
    return { action: 'query', result: page.status === 'ready' ? { status: 'ready', value: { ...page.value, coverage: toModelCoverage(page.value.coverage) } } : page };
  }
  if (input.action === 'read') {
    return { action: 'read', result: await access.port.readWorkspace(ctx, { workspace: access.workspace, path: input.path, maxBytes: input.maxBytes, version: input.version }) };
  }
  if (input.action === 'compare') {
    return { action: 'compare', result: await access.port.compareWorkspace(ctx, { workspace: access.workspace,
      before: { kind: 'capture', capture: input.before }, after: { kind: 'capture', capture: input.after } }) };
  }
  if (input.action === 'verify') return { action: 'verify', result: await access.port.verifyCapture(ctx, input.capture) };
  return { action: 'release', result: await access.port.releaseCapture(ctx, input.capture) };
}

export function createProjectSourceTool(options: ProjectSourceToolOptions): ToolDefinition {
  // The object form is the existing contract. The deferred resolver form is the B1 first-use seam:
  // it is invoked per call only after argument, path and current checks pass and immediately
  // before dispatch, so no Context/root placeholder is fabricated and an explicit frozen mode
  // never falls back to the live `project_index`. The resolver stays owned by the run loop; this
  // tool never opens or closes the capability and never owns its lifetime.
  const accessOption = options.access;
  return {
    name: 'project_source',
    description: 'Read exact source materials through the frozen capture protocol. Actions: capture (one bounded capture; provider defaults to typescript, or text for a strict readable regular UTF-8/no-NUL text scope selected by prefix; optional configPath/prefix and optional previous capture for explicit changes; the trusted workspace root/revision/identity always come from the host, never from arguments), query (page a frozen capture with an opaque cursor: null on the first page, then the returned nextCursor; limit 1-200, default 100; paths lists only the files this capture retained, text is a literal line search with original line/UTF-16 columns and complete excerpts; semantic kinds are available only for a typescript capture), read (one exact file, at most 8192 bytes, either version working_tree for the current file or version capture for the exact frozen content of a retained capture; a file outside the declared scope is refused rather than reported absent), compare (same-scope content diff of two captures: added/deleted/modified plus renamed only when one digest occurs exactly once in each complete manifest, marked identical_content and never a business identity claim), verify (re-read the real scope now and confirm whether the capture still matches; a point-in-time answer, not a future guarantee), release (drop the capture when done). Coverage and change lists are returned as exact counts with at most five preview items of at most 160 code points each and an explicit truncated flag; the complete internal material is retained untrimmed. Pages are marked captured_source/not_rechecked unless verify says otherwise; captures cover only their declared scope (not the whole worktree) and a successful capture is not acceptance of the code. Prefer this protocol over project_index for multi-page retrieval; project_index remains the live compatibility path that re-reads on every page.',
    inputSchema: projectSourceInputSchema,
    effectClass: 'read_only',
    requiredCapabilities: ['workspace_read'],
    defaultTimeoutMs: 60000,
    outputLimitBytes: 64 * 1024,
    independentReadOnly: true,
    summarize: args => {
      const paths: string[] = [];
      for (const key of ['configPath', 'prefix', 'path']) if (typeof args[key] === 'string') paths.push(args[key] as string);
      const query = args['query'];
      if (query !== null && typeof query === 'object') {
        for (const key of ['path', 'prefix']) {
          const value = (query as Record<string, unknown>)[key];
          if (typeof value === 'string') paths.push(value);
        }
      }
      return { paths, cwd: null, commandPreview: null };
    },
    handler: {
      execute: async (call, executionOptions) => {
        const signal = executionOptions.signal;
        if (signal.aborted) return cancelled(call.callId);
        const parsed = projectSourceInputSchema.safeParse(call.arguments);
        if (!parsed.success) return invalidArguments(call.callId);
        const input = parsed.data as ProjectSourceToolInput;
        /** A capture that reached the core but has not been delivered to the model. */
        let undisclosed: SourceCaptureRef | undefined;
        /** Resolved only after argument/path/current validation; a deferred resolver may suspend. */
        let access: RuntimeSourceCaptureAccess | undefined;
        const releaseUndisclosed = async () => {
          if (!undisclosed || !access) return;
          const ref = undisclosed;
          undisclosed = undefined;
          try {
            // Same trusted identity/scope, but a fresh cleanup signal: the run signal may already
            // be aborted, while release still needs to pass the core's per-request authorization.
            await access.port.releaseCapture(access.context(new AbortController().signal), ref);
          } catch { /* best effort; the owned access handle close reclaims whatever remains */ }
        };
        try {
          if (input.action === 'capture') {
            if (input.configPath !== undefined) options.requireVisible(input.configPath);
            if (input.prefix !== undefined) options.requireVisible(input.prefix);
          } else if (input.action === 'query') {
            requireQueryVisible(options.requireVisible, input.query);
          } else if (input.action === 'read') {
            options.requireVisible(input.path);
          }
          await options.assertCurrent?.();
          // The currentness check may suspend; an already-cancelled call must not start its
          // first-use open. The check after resolution still covers cancellation during open.
          if (signal.aborted) return cancelled(call.callId);
          // Resolve the trusted Host capability only once the request itself is valid. A frozen
          // first-use open remains the run loop's resource: this tool never opens or closes it,
          // and an unresolved or failed open never falls back to the live project_index.
          access = typeof accessOption === 'function' ? await accessOption() : accessOption;
          if (signal.aborted) return cancelled(call.callId);
          const outcome = await dispatch(input, signal, access);
          if (outcome.action === 'capture' && outcome.result.status === 'ready') undisclosed = outcome.result.value.ref;
          await options.assertCurrent?.();
          if (signal.aborted) { await releaseUndisclosed(); return cancelled(call.callId); }
          const value: unknown = outcome.result;
          if (Buffer.byteLength(JSON.stringify(value)) > MODEL_OUTPUT_LIMIT_BYTES)
            throw Error('Project source output is too large for the model; narrow the query, lower the limit or shrink the capture scope');
          // Delivered to the model: from here on the capture belongs to the caller's lifecycle.
          undisclosed = undefined;
          return succeeded(call.callId, value as JsonValue);
        } catch (error) {
          await releaseUndisclosed();
          if (signal.aborted) return cancelled(call.callId);
          return executionFailed(call.callId, exactMessage(error));
        }
      },
    },
  };
}
