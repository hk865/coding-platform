import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import { ProjectSourceFailure, type CapturedProjectFile } from './project-source-snapshot.js';
import { textSourceKey } from './text-source-snapshot.js';
import type { CallQueryResult, ImportQueryResult, TypeScriptQueryResult, TypeScriptSourceQuery } from './typescript-source-query.js';
import type { CaptureEntry, CaptureRegistry, CursorRecord } from './capture.js';
import { deepFreeze, validateSourceQuery } from './ports.js';
import type { SourceDiagnostic, SourceFileEntry, SourceHit, SourceLocation, SourcePage, SourcePageRequest, SourceQuery, SourceRelation, WorkspaceCaptureLimits, WorkspaceError, WorkspaceResult } from './ports.js';

/** Frozen-query mapping: translates R2b analysis results into the WorkspaceTools wire. */

export const toSourceLocation = (location: { path: string; digest: string; line: number; column: number; endLine: number; endColumn: number }): SourceLocation => ({
  path: location.path, digest: location.digest,
  start: { line: location.line, column: location.column }, end: { line: location.endLine, column: location.endColumn },
});
export const toSourceRelation = (relation: ImportQueryResult): SourceRelation => ({
  kind: 'import', from: toSourceLocation(relation), expression: relation.module,
  targets: relation.targets.map(toSourceLocation), resolution: relation.resolution,
});
export const toCallRelation = (call: CallQueryResult): SourceRelation => ({
  kind: 'call', from: toSourceLocation(call), expression: call.expression,
  targets: call.target ? [toSourceLocation(call.target)] : [], resolution: call.resolution,
});
export const toSourceDiagnostic = (diagnostic: { path: string; code: number; message: string }): SourceDiagnostic =>
  ({ path: diagnostic.path, code: String(diagnostic.code), message: diagnostic.message });

const sourcePath = (path: string) => /\.(?:[cm]?[jt]sx?)$/.test(path);
export const toSourceFileEntry = (file: CapturedProjectFile): SourceFileEntry => ({
  path: file.path, digest: file.digest, sizeBytes: Buffer.byteLength(file.content),
  kind: sourcePath(file.path) ? 'source' : file.path.endsWith('package.json') ? 'dependency_manifest' : file.path.endsWith('.json') ? 'configuration' : 'text',
});

const rejected = <T>(code: WorkspaceError, reason: string): WorkspaceResult<T> => ({ status: 'rejected', code, reason });

const toHit = (result: TypeScriptQueryResult): SourceHit => {
  if ('module' in result) return { kind: 'relation', relation: toSourceRelation(result) };
  if ('expression' in result) return { kind: 'relation', relation: toCallRelation(result) };
  if ('name' in result) return { kind: 'symbol', location: toSourceLocation(result), name: result.name, symbolKind: result.kind };
  return { kind: 'location', location: toSourceLocation(result) };
};

const inScope = (path: string, pathFilter: string | undefined, prefix: string | undefined) =>
  (pathFilter === undefined || path === pathFilter) &&
  (prefix === undefined || path === prefix || path.startsWith(prefix + '/'));

/** Frozen content for one declared file; never a disk read. */
function capturedContent(entry: CaptureEntry, path: string): string | undefined {
  const key = textSourceKey(path);
  return entry.material.provider === 'text' ? entry.material.text.get(key)?.content : entry.material.snapshot.files.get(key)?.content;
}

const escapeLiteral = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Literal line scan over frozen text. The RegExp runs on the original line with the Unicode
 * flag (simple case folding, not locale), so `match.index`/`match[0].length` are already
 * original UTF-16 coordinates and the excerpt is the complete original match.
 */
function scanText(file: SourceFileEntry, content: string, text: string, caseSensitive: boolean, remaining: number): { hits: SourceHit[]; overflow: boolean } {
  const hits: SourceHit[] = [];
  const pattern = new RegExp(escapeLiteral(text), caseSensitive ? 'gu' : 'giu');
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.replace(/\r$/, '');
    pattern.lastIndex = 0;
    for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
      if (hits.length >= remaining) return { hits, overflow: true };
      hits.push({ kind: 'text', excerpt: match[0], location: { path: file.path, digest: file.digest,
        start: { line: index + 1, column: match.index + 1 }, end: { line: index + 1, column: match.index + match[0].length + 1 } } });
      if (match[0].length === 0) pattern.lastIndex++;
    }
  }
  return { hits, overflow: false };
}

/**
 * Build the complete bounded result for one frozen query, once per capture. Frozen text and
 * captured TS/JS/JSON both support `paths`/`text`; only a TS capture has semantic queries.
 * No call reads the disk, and results are collected up to the configured bound.
 */
async function completeHits(registry: CaptureRegistry, entry: CaptureEntry, query: SourceQuery, signal: AbortSignal, limits: WorkspaceCaptureLimits): Promise<WorkspaceResult<SourceHit[]>> {
  const specKey = sha256Hex(canonicalJson(query));
  const cached = entry.queries.get(specKey);
  if (cached) return { status: 'ready', value: cached };
  if (entry.queries.size >= limits.maxQueriesPerCapture) return rejected('capacity', 'query cache capacity exceeded for this capture');
  let hits: SourceHit[];
  if (query.kind === 'paths' || query.kind === 'text') {
    if (query.kind === 'paths') {
      hits = entry.files.filter(file => inScope(file.path, undefined, query.prefix)).map(file => ({ kind: 'file', file }));
      if (hits.length > limits.maxQueryResults) return rejected('capacity', 'paths query returns more than ' + limits.maxQueryResults + ' entries');
    } else {
      const selected = entry.files.filter(file => inScope(file.path, undefined, query.prefix));
      const collected: SourceHit[] = [];
      for (const file of selected) {
        const content = capturedContent(entry, file.path);
        if (content === undefined) continue;
        const found = scanText(file, content, query.text, query.caseSensitive, limits.maxQueryResults - collected.length);
        collected.push(...found.hits);
        if (found.overflow) return rejected('capacity', 'text query returns more than ' + limits.maxQueryResults + ' matches');
        signal.throwIfAborted();
      }
      hits = collected;
    }
  } else {
    if (entry.material.provider !== 'typescript') return rejected('unsupported', 'the text provider has no semantic analyzer; use paths or text queries');
    const material = entry.material;
    if (query.kind === 'imports') {
      // The capture already analysed every import once; pages only filter that frozen result.
      hits = entry.relations.filter(relation => inScope(relation.from.path, query.path, query.prefix)).map(relation => ({ kind: 'relation', relation }));
      if (hits.length > limits.maxQueryResults) return rejected('capacity', 'imports query returns more than ' + limits.maxQueryResults + ' relations');
    } else {
    const base = entry.requestedConfigPath !== null ? { configPath: entry.requestedConfigPath } : {};
    let analysisQuery: TypeScriptSourceQuery;
    switch (query.kind) {
      case 'definitions':
      case 'references':
        analysisQuery = { operation: query.kind, ...base, path: query.path, line: query.line, column: query.column };
        break;
      case 'symbols':
        analysisQuery = { operation: 'symbols', ...base,
          ...(query.path !== undefined ? { path: query.path } : {}), ...(query.prefix !== undefined ? { prefix: query.prefix } : {}) };
        break;
      case 'calls':
        analysisQuery = { operation: 'calls', ...base,
          ...(query.path !== undefined ? { path: query.path } : {}), ...(query.prefix !== undefined ? { prefix: query.prefix } : {}) };
        break;
      default:
        return rejected('unsupported', query.kind + ' queries are not implemented in this batch');
    }
    try {
      hits = material.analyzer.analyze(material.snapshot, analysisQuery, signal,
        { maxResults: limits.maxQueryResults, maxDiagnostics: 30 }).results.map(toHit);
    } catch (error) {
      if (signal.aborted) return rejected('cancelled', 'query cancelled');
      if (error instanceof ProjectSourceFailure) {
        if (error.status === 'capacity') return rejected('capacity', error.message);
        return rejected(error.status === 'unsupported' ? 'unsupported' : 'invalid', error.message);
      }
      throw error;
    }
    }
  }
  if (hits.length > limits.maxQueryResults) return rejected('capacity', 'query returns more than ' + limits.maxQueryResults + ' results');
  const frozen = deepFreeze(hits);
  // The complete result and its retained key are charged before publication; a cache hit never re-charges.
  if (!registry.charge(entry, Buffer.byteLength(JSON.stringify(frozen)) + specKey.length + 64)) return rejected('capacity', 'query result exceeds the retained-byte capacity');
  entry.queries.set(specKey, frozen);
  return { status: 'ready', value: frozen };
}

function cursorFor(registry: CaptureRegistry, entry: CaptureEntry, specKey: string, offset: number, limits: WorkspaceCaptureLimits): string | null {
  // A replay of the same query position reuses its token instead of accumulating cursors.
  for (const cursor of entry.cursors.values())
    if (cursor.specKey === specKey && cursor.offset === offset && cursor.subjectKey === entry.subjectKey && cursor.permissionRevision === entry.permissionRevision) return cursor.token;
  if (entry.cursors.size >= limits.maxCursorsPerCapture) return null;
  const token = randomUUID();
  const record: CursorRecord = { token, specKey, offset, subjectKey: entry.subjectKey, permissionRevision: entry.permissionRevision, orderVersion: entry.orderVersion };
  // Charge the actual serialized record (subject/permission revisions are host strings, not constants).
  if (!registry.charge(entry, Buffer.byteLength(JSON.stringify(record)) + 64)) return null;
  entry.cursors.set(token, record);
  return token;
}

/** Serve one bounded page from frozen material; cursor and identity are validated per request. */
export async function querySource(registry: CaptureRegistry, ctx: CoreCallContext, input: SourcePageRequest, signal: AbortSignal): Promise<WorkspaceResult<SourcePage>> {
  const limits = registry.limits;
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > limits.maxQueryResults)
    return rejected('invalid', 'limit must be a positive integer no greater than ' + limits.maxQueryResults);
  const scopeError = validateSourceQuery(input.query);
  if (scopeError) return rejected('invalid', scopeError);
  return registry.withEntry(ctx, input.capture, signal, async (entry, access) => {
    // An explicitly named scope that the current authorization cannot read is forbidden,
    // never a successful empty page over frozen material.
    const scopePath = 'path' in input.query ? input.query.path : undefined;
    if (scopePath !== undefined && !access.authorization.allowsRead(scopePath)) return rejected('forbidden', 'query path is outside the current read scope');
    const scopePrefix = 'prefix' in input.query ? input.query.prefix : undefined;
    if (scopePrefix !== undefined && !access.authorization.allowsRead(scopePrefix)) return rejected('forbidden', 'query prefix is outside the current read scope');
    const specKey = sha256Hex(canonicalJson(input.query));
    let offset = 0;
    if (input.cursor !== null) {
      const cursor = entry.cursors.get(input.cursor);
      if (!cursor) return rejected('cursor_mismatch', 'cursor is not known to this capture');
      if (cursor.specKey !== specKey) return rejected('cursor_mismatch', 'cursor belongs to another query');
      if (cursor.orderVersion !== entry.orderVersion || cursor.subjectKey !== entry.subjectKey) return rejected('cursor_mismatch', 'cursor no longer matches this frozen material');
      offset = cursor.offset;
    }
    const complete = await completeHits(registry, entry, input.query, signal, limits);
    if (complete.status !== 'ready') return complete;
    const items = deepFreeze(complete.value.slice(offset, offset + input.limit));
    const nextOffset = offset + input.limit;
    let nextCursor: string | null = null;
    if (nextOffset < complete.value.length) {
      nextCursor = cursorFor(registry, entry, specKey, nextOffset, limits);
      if (nextCursor === null) return rejected('capacity', 'cursor capacity exceeded for this capture');
    }
    return { status: 'ready', value: deepFreeze({ capture: entry.ref, items, nextCursor, complete: nextCursor === null, coverage: entry.coverage,
      observation: 'captured_source', currentness: 'not_rechecked' }) };
  });
}
