import { captureProjectSource, isIgnoredSourcePath, isSafeSourcePath, isSourcePath, ProjectSourceFailure, sha256Text, SOURCE_ENGINE, type ProjectSourceAccess } from './project-source-snapshot.js';
import { TypeScriptSourceAnalyzer, type ImportQueryResult, type ProjectSourceChanges, type SourceDiagnosticEntry, type SourceFileEntry, type TypeScriptQueryResult, type TypeScriptSourceCoverage, type TypeScriptSourceQuery } from './typescript-source-query.js';

export type { CapturedProjectFile, ProjectSourceAccess, ProjectSourceSnapshot } from './project-source-snapshot.js';
export type { ImportQueryResult, ProjectSourceChanges, TypeScriptQueryResult } from './typescript-source-query.js';

/** Public tool query: the original fields plus request-scoped pagination and snapshot pinning. */
export type ProjectSourceQuery = TypeScriptSourceQuery & {
  expectedSnapshot?: string;
  offset?: number;
  limit?: number;
};

export type ProjectSourceProvenance = {
  workspace: string;
  commit: string | null;
  source: 'working_tree';
  engine: string;
  engineVersion: string;
  manifestDigest: string;
};

export type ProjectSourceSourced = {
  status: 'sourced';
  snapshot: string;
  provenance: ProjectSourceProvenance;
  results: TypeScriptQueryResult[];
  totalResults: number;
  sources: SourceFileEntry[];
  /** Full analysed material for graph consumers; the public page omits it. */
  indexedSources: SourceFileEntry[];
  sourceCount: number;
  changes: ProjectSourceChanges;
  diagnostics: SourceDiagnosticEntry[];
  diagnosticsTruncated: boolean;
  coverage: TypeScriptSourceCoverage;
};

export type ProjectSourceFailureResult = { status: 'rejected' | 'unsupported' | 'stale'; message: string; snapshot?: string } | { status: 'cancelled' };

/** One public page: the complete analysis with the display manifest and results bounded. */
export type ProjectSourcePage = Omit<ProjectSourceSourced, 'indexedSources'> & {
  nextOffset: number | null;
  sourcesTruncated: boolean;
};

const OPERATIONS = ['symbols', 'definitions', 'references', 'imports', 'calls'] as const;

/**
 * WorkspaceTools — public TS/JS project index over the frozen capture.
 *
 * This class owns request validation, the capture → analyse → capture/verify pair,
 * provenance and wire shaping. The analyzer owns the installed-input baseline, so
 * `changes` and the incremental language service share exactly one previous state.
 */
export class ProjectSourceIndex {
  private readonly analyzer = new TypeScriptSourceAnalyzer();

  constructor(private readonly access: ProjectSourceAccess) {}

  dispose() { this.analyzer.dispose(); }

  /** Full permission-filtered material for the graph consumer; never the display manifest's first page. */
  async architectureMaterials(configPath?: string, signal: AbortSignal = new AbortController().signal): Promise<{
    snapshot: string; provenance: ProjectSourceProvenance; imports: ImportQueryResult[];
    configPath: string | null; sources: SourceFileEntry[];
  }> {
    const result = await this.inspect({ operation: 'imports', ...(configPath ? { configPath } : {}) }, signal);
    if (result.status !== 'sourced') throw Error('architecture source unavailable: ' + JSON.stringify(result));
    if (result.results.length > 10000) throw Error('architecture import capacity exceeded; narrow project configuration');
    // The operation is fixed to `imports`, so every analysed result is an import relation.
    return { snapshot: result.snapshot, provenance: result.provenance, imports: result.results as ImportQueryResult[],
      configPath: result.coverage.projectConfiguration, sources: result.indexedSources };
  }

  async query(query: ProjectSourceQuery, signal: AbortSignal = new AbortController().signal): Promise<ProjectSourcePage | ProjectSourceFailureResult> {
    if (signal.aborted) return { status: 'cancelled' as const };
    if ((query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200)) ||
        (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0))) return { status: 'rejected' as const, message: 'invalid operation or pagination' };
    const analysis = await this.inspect(query, signal);
    if (analysis.status !== 'sourced') return analysis;
    const { indexedSources: _indexedSources, ...result } = analysis;
    const offset = query.offset ?? 0, limit = query.limit ?? 100;
    return { ...result, results: result.results.slice(offset, offset + limit),
      nextOffset: offset + limit < result.totalResults ? offset + limit : null,
      sources: result.sources.slice(0, 200), sourcesTruncated: result.sources.length > 200 };
  }

  /** Capture and verify once per operation; consumers shape pages from the same analysis. */
  private async inspect(query: ProjectSourceQuery, signal: AbortSignal): Promise<ProjectSourceSourced | ProjectSourceFailureResult> {
    try {
      if (!(OPERATIONS as readonly string[]).includes(query.operation)) throw new ProjectSourceFailure('rejected', 'invalid operation or pagination');
      for (const p of [query.path, query.prefix, query.configPath]) if (p !== undefined && (!isSafeSourcePath(p) || !this.access.allowed(p) || isIgnoredSourcePath(p))) throw new ProjectSourceFailure('rejected', 'path outside readable scope');
      if (query.path && !isSourcePath(query.path)) throw new ProjectSourceFailure('unsupported', 'this project service supports TS/JS; other languages require their declared provider');
      const captured = await captureProjectSource(this.access, signal);
      // Config selection and query scope are part of the index identity.
      const snapshot = sha256Text(JSON.stringify({ sources: captured.snapshot, config: query.configPath ?? null, prefix: query.prefix ?? null }));
      if (query.expectedSnapshot && query.expectedSnapshot !== snapshot) return { status: 'stale' as const, snapshot, message: 'project contents, inventory, configuration, scope or commit changed' };
      const analysisQuery: TypeScriptSourceQuery = { operation: query.operation,
        ...(query.configPath !== undefined ? { configPath: query.configPath } : {}),
        ...(query.prefix !== undefined ? { prefix: query.prefix } : {}),
        ...(query.path !== undefined ? { path: query.path } : {}),
        ...(query.line !== undefined ? { line: query.line } : {}),
        ...(query.column !== undefined ? { column: query.column } : {}) };
      // `analyze` installs the capture and computes `changes` against the previous installed
      // inputs before verification, so a failed verification does not redefine that baseline.
      const analysis = this.analyzer.analyze(captured, analysisQuery, signal);
      const verified = await captureProjectSource(this.access, signal);
      if (verified.snapshot !== captured.snapshot) return { status: 'stale' as const, message: 'project changed during query; repeat against current snapshot' };
      return { status: 'sourced' as const, snapshot, provenance: { ...captured.identity, source: 'working_tree', engine: SOURCE_ENGINE.name, engineVersion: SOURCE_ENGINE.version, manifestDigest: captured.snapshot },
        results: analysis.results, totalResults: analysis.results.length, sources: analysis.sources, indexedSources: analysis.indexedSources, sourceCount: analysis.sources.length,
        changes: analysis.changes, diagnostics: analysis.diagnostics, diagnosticsTruncated: analysis.diagnosticsTruncated, coverage: analysis.coverage };
    } catch (error) {
      if (signal.aborted) return { status: 'cancelled' as const };
      if (error instanceof ProjectSourceFailure) return { status: error.status === 'capacity' ? 'rejected' : error.status, message: error.message };
      throw error;
    }
  }
}
