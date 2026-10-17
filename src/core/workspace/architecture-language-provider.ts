/**
 * Slice 8A (decision 63-3; spec §2/L12) — the language provider seam for the
 * file-level observation graph.
 *
 * Placement note (spec does not fix it): this interface is put in
 * `src/core/workspace/` because it consumes `ProjectSourceAccess`, which is
 * defined in `src/core/workspace/project-source-snapshot.ts`. `src/contracts/`
 * must not import `src/core/`, so the interface cannot live in Contracts even
 * though the pure observation DTOs do.
 *
 * A provider works ONLY over the capture owner's frozen, permission-filtered
 * `ProjectSourceAccess` material; it never reads a different worktree state on
 * its own. TS/JS is the first provider (8A); C/C++ and Python arrive with 8D;
 * Rust and Go keep this interface only.
 */
import type { LanguageCoverageV1 } from '../../contracts/architecture-inspection.js';
import { captureProjectSource, type ProjectSourceAccess } from './project-source-snapshot.js';
import { TypeScriptSourceAnalyzer } from './typescript-source-query.js';

export interface ArchitectureLanguageProviderV1 {
  readonly language: 'typescript' | 'cpp' | 'python' | 'rust' | 'go' | string;
  /** Which files this provider claims (by workspace-relative path). */
  claims(path: string): boolean;
  extractImports(input: { source: ProjectSourceAccess; signal: AbortSignal }): Promise<{
    /** This language's analyzer snapshot; `null` when there is no analyzer. */
    analyzerSnapshot: string | null;
    /** Workspace-relative `(from, to)` edges. */
    edges: { from: string; to: string }[];
    /** Resolved-to-nothing specifiers kept after conversion and de-duplication. */
    unresolved: { from: string; specifier: string }[];
    /** Full (untruncated) per-language coverage; the capture owner caps stored issues. */
    coverage: {
      files: number;
      parsed: number;
      issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[];
      complete: boolean;
      reason: string | null;
    };
  }>;
}

/** One node of the assembled project file graph (8A `ProjectFileGraphV1`). */
export type ProjectFileGraphNodeV1 = { path: string; nonBlankLines: number; language: string };

/**
 * The assembled file-level observation graph across all language providers for
 * one frozen capture: nodes, edges, kept `unresolved` entries, per-language
 * coverage, and whether every provider completed.
 */
export type ProjectFileGraphV1 = {
  nodes: ProjectFileGraphNodeV1[];
  edges: { from: string; to: string }[];
  unresolved: { from: string; specifier: string }[];
  languages: LanguageCoverageV1[];
  complete: boolean;
};

/** The L12 extension table; every other extension is `other`. */
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const CPP_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.inc', '.ipp', '.inl', '.tcc']);
const PYTHON_EXTENSIONS = new Set(['.py', '.pyi']);
const RUST_EXTENSIONS = new Set(['.rs']);
const GO_EXTENSIONS = new Set(['.go']);

/** Recognized language of one workspace-relative path, by the L12 extension table. */
export function languageOfPath(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot).toLowerCase() : '';
  if (TYPESCRIPT_EXTENSIONS.has(extension)) return 'typescript';
  if (CPP_EXTENSIONS.has(extension)) return 'cpp';
  if (PYTHON_EXTENSIONS.has(extension)) return 'python';
  if (RUST_EXTENSIONS.has(extension)) return 'rust';
  if (GO_EXTENSIONS.has(extension)) return 'go';
  return 'other';
}

const IMPORT_FILE_BYTES = 2 * 1024 * 1024;
/** Walk-away bound for one import analysis; the owner still enforces the observation edge cap. */
const IMPORT_RESULT_CAP = 1_000_000;

/**
 * The first provider: wraps `TypeScriptSourceAnalyzer` over the capture owner's frozen
 * `ProjectSourceAccess` material. A project without TS files reports zero parsed files
 * and no whole-language failure.
 */
export function createTypeScriptLanguageProvider(options: { configPath?: string | null } = {}): ArchitectureLanguageProviderV1 {
  const configPath = options.configPath ?? null;
  const claims = (path: string) => languageOfPath(path) === 'typescript';
  return {
    language: 'typescript',
    claims,
    async extractImports({ source, signal }) {
      const inventory = await source.inventory(signal);
      const claimed = inventory.paths.filter(path => claims(path) && source.allowed(path));
      if (claimed.length === 0)
        return { analyzerSnapshot: null, edges: [], unresolved: [],
          coverage: { files: 0, parsed: 0, issues: [], complete: true, reason: null } };
      const analyzer = new TypeScriptSourceAnalyzer();
      try {
        const snapshot = await captureProjectSource(source, signal, { maxFileBytes: IMPORT_FILE_BYTES });
        const analysis = analyzer.analyze(snapshot, { operation: 'imports',
          ...(configPath === null ? {} : { configPath }) }, signal, { maxResults: IMPORT_RESULT_CAP });
        const edges: { from: string; to: string }[] = [];
        const edgeKeys = new Set<string>();
        const unresolved: { from: string; specifier: string }[] = [];
        const unresolvedKeys = new Set<string>();
        for (const result of analysis.results) {
          if (!('module' in result)) continue;
          for (const target of result.targets) {
            const key = result.path + '\0' + target.path;
            if (edgeKeys.has(key)) continue;
            edgeKeys.add(key);
            edges.push({ from: result.path, to: target.path });
          }
          if (result.resolution === 'unknown') {
            const key = result.path + '\0' + result.module;
            if (unresolvedKeys.has(key)) continue;
            unresolvedKeys.add(key);
            unresolved.push({ from: result.path, specifier: result.module });
          }
        }
        return { analyzerSnapshot: snapshot.snapshot, edges, unresolved,
          coverage: { files: claimed.length, parsed: analysis.indexedSources.filter(entry => claims(entry.path)).length,
            issues: [], complete: false, reason: null } };
      } catch (error) {
        if (signal.aborted) throw error;
        return { analyzerSnapshot: null, edges: [], unresolved: [],
          coverage: { files: claimed.length, parsed: 0, issues: [], complete: false,
            reason: error instanceof Error ? error.message : String(error) } };
      } finally {
        analyzer.dispose();
      }
    },
  };
}
