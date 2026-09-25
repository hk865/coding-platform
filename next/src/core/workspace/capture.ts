import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { WorkspaceRef } from '../../contracts/ledger.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SourceCaptureRef } from '../../contracts/core/source.js';
import type { ArchitectureSourceMapping, ArchitectureSourceSnapshotV1 } from '../../contracts/architecture-source.js';
import { captureProjectSource, ProjectSourceFailure, SOURCE_ENGINE, type ProjectSourceSnapshot } from './project-source-snapshot.js';
import { TypeScriptSourceAnalyzer } from './typescript-source-query.js';
import { captureTextSource, TEXT_ENGINE, type TextSourceFile } from './text-source-snapshot.js';
import { mapArchitectureSource, type ArchitectureSourceMaterial } from './architecture-source.js';
import { compareCapturedFiles, diffContent, manifestOf, readCapturedFile, readWorkingTreeFile, summaryChanges } from './workspace-read.js';
import { querySource, toSourceDiagnostic, toSourceFileEntry, toSourceRelation } from './source-query.js';
import { deepFreeze } from './ports.js';
import type { WorkspaceAccessFactory, WorkspaceReadAccess } from './access.js';
import type { CaptureContentScope, CaptureSourceRequest, CaptureSummary, ReadWorkspaceRequest, SourceCaptureMaterial, SourceCoverage, SourceDiagnostic, SourceFileEntry, SourceHit, SourcePage, SourcePageRequest, SourceRelation, WorkspaceCaptureLimits, WorkspaceComparison, WorkspaceComparisonRequest, WorkspaceError, WorkspaceFile, WorkspaceResult, WorkspaceVersion } from './ports.js';

/** One opaque page cursor: bound to capture, subject, permission revision, query and ordering. */
export type CursorRecord = {
  token: string; specKey: string; offset: number;
  subjectKey: string; permissionRevision: string; orderVersion: string;
};

/** Provider-specific frozen material; everything else on an entry is shared metadata. */
export type CaptureMaterial =
  | { provider: 'typescript'; analyzer: TypeScriptSourceAnalyzer; snapshot: ProjectSourceSnapshot }
  | { provider: 'text'; analyzer: null; text: ReadonlyMap<string, TextSourceFile>;
      identity: Readonly<{ workspace: string; commit: string | null }>; snapshot: string };

/** One published capture: frozen material plus its trusted authorization domain. */
export type CaptureEntry = {
  ref: SourceCaptureRef;
  subjectKey: string; permissionRevision: string; workspaceIdentity: string;
  requestedConfigPath: string | null; resolvedConfigPath: string | null;
  commitHash: string | null;
  capturedAt: string; verifiedAt: string; lastUsedAt: number; expiresAt: number;
  changes: { added: string[]; modified: string[]; deleted: string[] };
  released: boolean; activeReaders: number;
  /** Logical bytes: frozen content + manifest/relations/diagnostics + cached results + cursors. */
  bytes: number;
  scope: CaptureContentScope;
  material: CaptureMaterial;
  files: SourceFileEntry[];
  sources: { path: string; digest: string }[];
  relations: SourceRelation[];
  diagnostics: SourceDiagnostic[];
  diagnosticsTruncated: boolean;
  coverage: SourceCoverage;
  orderVersion: string;
  /** Complete bounded results per canonical query spec; pages only slice these. */
  queries: Map<string, SourceHit[]>;
  cursors: Map<string, CursorRecord>;
};

type Tombstone = { ref: SourceCaptureRef; subjectKey: string; permissionRevision: string; expiresAt: number; bytes: number };

const rejected = <T>(code: WorkspaceError, reason: string): WorkspaceResult<T> => ({ status: 'rejected', code, reason });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const safeRelative = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  !/[\\:\0]/.test(value) && value.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');
const sameRef = (a: SourceCaptureRef, b: SourceCaptureRef) =>
  a.projectId === b.projectId && a.workspaceId === b.workspaceId && a.captureId === b.captureId &&
  a.workspaceRevision === b.workspaceRevision && a.sourceDigest === b.sourceDigest &&
  a.configDigest === b.configDigest && a.indexVersion === b.indexVersion;
const workspaceOf = (ref: SourceCaptureRef): WorkspaceRef => ({ aggregateType: 'Workspace', projectId: ref.projectId, workspaceId: ref.workspaceId });

/** The TS provider's declared scope is constant; its query prefix never changes the captured set. */
const TS_SCOPE: CaptureContentScope = deepFreeze({ kind: 'typescript_project_inputs', selectionVersion: 'ts-js-json-v1', prefix: null, digestBasis: 'decoded_utf8' });

/** Registry-owned provider/wire mapping: the R2b snapshot is read through the access adapter. */
const projectAccess = (access: WorkspaceReadAccess, limits: WorkspaceCaptureLimits) => ({
  allowed: (path: string) => access.authorization.allowsRead(path),
  read: (path: string, maxBytes: number) => access.read(path, maxBytes),
  inventory: () => access.listFiles(limits.maxInventoryFiles),
  sourceIdentity: () => access.sourceIdentity(),
});

/**
 * Temporary capture registry. Every operation opens a fresh access (resolveRoot + authorize),
 * binds it to the capture's stored subject/permission/root domain, and releases it afterwards.
 * The registry never stores a request ctx, signal or live access; published material is frozen.
 */
export class CaptureRegistry {
  readonly limits: WorkspaceCaptureLimits;
  private readonly entries = new Map<string, CaptureEntry>();
  private readonly tombstones = new Map<string, Tombstone>();
  private readonly tombstoneOrder: string[] = [];
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly lifecycle = new AbortController();
  /** Capture slots reserved before the first await so concurrent starts cannot over-publish. */
  private pendingCaptures = 0;
  private stopping = false;
  private closing: Promise<void> | undefined;

  constructor(private readonly deps: { access: WorkspaceAccessFactory; now: () => string; limits: WorkspaceCaptureLimits }) {
    this.limits = deps.limits;
  }

  capture(ctx: CoreCallContext, input: CaptureSourceRequest): Promise<WorkspaceResult<CaptureSummary>> {
    return this.track(ctx, signal => this.captureOp(ctx, input, signal));
  }
  query(ctx: CoreCallContext, input: SourcePageRequest): Promise<WorkspaceResult<SourcePage>> {
    return this.track(ctx, signal => querySource(this, ctx, input, signal));
  }
  read(ctx: CoreCallContext, input: ReadWorkspaceRequest): Promise<WorkspaceResult<WorkspaceFile>> {
    return this.track(ctx, async signal => {
      if (!input || typeof input !== 'object' || !input.workspace || input.workspace.aggregateType !== 'Workspace') return rejected('invalid', 'workspace scope required');
      if (input.version.kind === 'git') return rejected('unsupported', 'git versions are not implemented in this batch');
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > this.limits.maxFileBytes)
        return rejected('invalid', 'maxBytes must be a positive safe integer within the configured per-file limit');
      if (input.version.kind === 'working_tree') {
        if (ctx.projectId !== input.workspace.projectId || ctx.workspaceId !== input.workspace.workspaceId)
          return rejected('forbidden', 'call context scope does not match the requested workspace');
        return this.withAccess(ctx, input.workspace, signal, access => readWorkingTreeFile(access, input, signal, this.deps.now, this.limits.maxFileBytes));
      }
      const ref = input.version.capture;
      if (input.workspace.projectId !== ref.projectId || input.workspace.workspaceId !== ref.workspaceId)
        return rejected('forbidden', 'call context scope does not match the capture');
      return this.withEntry(ctx, ref, signal, async entry => {
        const result = readCapturedFile(entry, input, this.deps.now);
        return result.status === 'ready' ? { status: 'ready', value: deepFreeze(result.value) } : result;
      });
    });
  }
  compare(ctx: CoreCallContext, input: WorkspaceComparisonRequest): Promise<WorkspaceResult<WorkspaceComparison>> {
    return this.track(ctx, async signal => {
      if (!input || typeof input !== 'object' || !input.workspace || input.workspace.aggregateType !== 'Workspace') return rejected('invalid', 'workspace scope required');
      // Widen for runtime validation: JS callers may send a version outside the declared union.
      const before = input.before as WorkspaceVersion, after = input.after as WorkspaceVersion;
      if (!before || !after) return rejected('invalid', 'two capture versions are required');
      if (before.kind === 'working_tree' || after.kind === 'working_tree') return rejected('invalid', 'compare requires two capture versions');
      if (before.kind === 'git' || after.kind === 'git') return rejected('unsupported', 'git comparisons are not implemented in this batch');
      if (before.kind !== 'capture' || after.kind !== 'capture') return rejected('invalid', 'compare requires two capture versions');
      const workspace = input.workspace;
      if (workspace.projectId !== before.capture.projectId || workspace.workspaceId !== before.capture.workspaceId ||
          workspace.projectId !== after.capture.projectId || workspace.workspaceId !== after.capture.workspaceId)
        return rejected('forbidden', 'call context scope does not match both captures');
      return this.withPair(ctx, before.capture, after.capture, signal, async (beforeEntry, afterEntry) =>
        compareCapturedFiles(beforeEntry, afterEntry, this.limits));
    });
  }
  exportMaterial(ctx: CoreCallContext, ref: SourceCaptureRef): Promise<WorkspaceResult<SourceCaptureMaterial>> {
    return this.track(ctx, signal => this.withEntry(ctx, ref, signal, async entry => {
      if (entry.relations.length > this.limits.maxQueryResults || entry.files.length > this.limits.maxQueryResults)
        return rejected('capacity', 'complete capture material exceeds the configured export capacity');
      return { status: 'ready', value: deepFreeze({ summary: this.summaryOf(entry), files: entry.files, relations: entry.relations,
        diagnostics: entry.diagnostics, diagnosticsTruncated: entry.diagnosticsTruncated }) };
    }));
  }
  verify(ctx: CoreCallContext, ref: SourceCaptureRef): Promise<WorkspaceResult<{ capture: SourceCaptureRef; verifiedAt: string }>> {
    return this.track(ctx, signal => this.withEntry(ctx, ref, signal, async (entry, access) => {
      if (access.workspaceRevision !== entry.ref.workspaceRevision) return rejected('source_stale', 'workspace revision changed since capture');
      if (entry.material.provider === 'text') {
        const observed = await captureTextSource(access, { prefix: entry.scope.prefix }, signal, this.captureLimits());
        if (observed.snapshot !== entry.material.snapshot) return rejected('source_stale', 'text sources changed since capture');
      } else {
        const observed = await captureProjectSource(projectAccess(access, this.limits), signal, this.captureLimits());
        if (observed.snapshot !== entry.material.snapshot.snapshot) return rejected('source_stale', 'project sources changed since capture');
      }
      entry.verifiedAt = this.deps.now();
      return { status: 'ready', value: deepFreeze({ capture: entry.ref, verifiedAt: entry.verifiedAt }) };
    }));
  }
  release(ctx: CoreCallContext, ref: SourceCaptureRef): Promise<WorkspaceResult<{ released: boolean }>> {
    return this.track(ctx, signal => this.releaseOp(ctx, ref, signal));
  }
  architectureSource(ctx: CoreCallContext, input: { capture: SourceCaptureRef; mappings: ArchitectureSourceMapping[] }): Promise<WorkspaceResult<ArchitectureSourceSnapshotV1>> {
    return this.track(ctx, signal => this.withEntry(ctx, input.capture, signal, async entry => {
      // Text captures have no semantic relations; an empty graph would be a false complete picture.
      if (entry.material.provider !== 'typescript') return rejected('unsupported', 'the text provider has no architecture source mapping');
      if (entry.relations.length > this.limits.maxQueryResults) return rejected('capacity', 'complete import material exceeds the configured graph capacity');
      const material: ArchitectureSourceMaterial = {
        sources: entry.sources,
        imports: entry.relations.map(relation => ({ path: relation.from.path, digest: relation.from.digest, line: relation.from.start.line,
          module: relation.expression, resolution: relation.resolution, targets: relation.targets.map(target => ({ path: target.path, digest: target.digest })) })),
        manifestDigest: entry.ref.sourceDigest, commit: entry.commitHash,
        engine: entry.coverage.engine, engineVersion: entry.coverage.engineVersion, configPath: entry.resolvedConfigPath,
      };
      try { return { status: 'ready', value: deepFreeze(mapArchitectureSource(material, { projectId: entry.ref.projectId, workspaceId: entry.ref.workspaceId, workspaceRevision: entry.ref.workspaceRevision }, input.mappings)) }; }
      catch (error) { return /capacity/.test(message(error)) ? rejected('capacity', message(error)) : rejected('invalid', message(error)); }
    }));
  }

  /**
   * Charge newly retained derived material (cached result or cursor) against the global
   * logical-byte budget before it is published. A cache hit never re-charges.
   */
  charge(entry: CaptureEntry, delta: number): boolean {
    if (this.retainedBytes() + delta > this.limits.maxRetainedBytes) return false;
    entry.bytes += delta;
    return true;
  }

  /**
   * Fresh-open + authorization-domain check around one frozen-material use. Active readers are
   * counted before the open so a concurrent release defers collection until they finish.
   */
  async withEntry<T>(ctx: CoreCallContext, ref: SourceCaptureRef, signal: AbortSignal,
    work: (entry: CaptureEntry, access: WorkspaceReadAccess) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> {
    if (this.stopping) return rejected('cancelled', 'workspace capture service is closing');
    this.sweep();
    const live = this.liveEntry(ref);
    if (live.status !== 'ready') return live;
    const entry = live.value;
    entry.activeReaders++;
    try {
      const opened = await this.open(ctx, signal, workspaceOf(entry.ref));
      if (opened.status !== 'ready') return opened;
      const access = opened.value;
      try {
        const denied = this.checkDomain([entry], access);
        if (denied) return denied;
        const result = await work(entry, access);
        if (result.status === 'ready') this.touch(entry);
        return result;
      } finally { await access.release(); }
    } finally {
      entry.activeReaders--;
      if (entry.released && entry.activeReaders === 0) this.collect(entry);
    }
  }

  /**
   * One fresh access authorizes a comparison of two pinned captures. Both readers are admitted
   * before the open (the same ref counts once), and a single ledger check covers both.
   */
  async withPair<T>(ctx: CoreCallContext, beforeRef: SourceCaptureRef, afterRef: SourceCaptureRef, signal: AbortSignal,
    work: (before: CaptureEntry, after: CaptureEntry) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> {
    if (this.stopping) return rejected('cancelled', 'workspace capture service is closing');
    this.sweep();
    const liveBefore = this.liveEntry(beforeRef);
    if (liveBefore.status !== 'ready') return liveBefore;
    const liveAfter = beforeRef.captureId === afterRef.captureId && sameRef(beforeRef, afterRef) ? liveBefore : this.liveEntry(afterRef);
    if (liveAfter.status !== 'ready') return liveAfter;
    const before = liveBefore.value, after = liveAfter.value, same = before === after;
    if (before.ref.projectId !== after.ref.projectId || before.ref.workspaceId !== after.ref.workspaceId)
      return rejected('forbidden', 'captures belong to different workspaces');
    if (before.material.provider !== after.material.provider) return rejected('unsupported', 'captures use different providers');
    if (before.ref.indexVersion !== after.ref.indexVersion) return rejected('unsupported', 'captures use different index versions');
    if (canonicalJson(before.scope) !== canonicalJson(after.scope)) return rejected('unsupported', 'captures declare different content scopes');
    before.activeReaders++;
    if (!same) after.activeReaders++;
    try {
      const opened = await this.open(ctx, signal, workspaceOf(before.ref));
      if (opened.status !== 'ready') return opened;
      const access = opened.value;
      try {
        const denied = this.checkDomain(same ? [before] : [before, after], access);
        if (denied) return denied;
        const result = await work(before, after);
        if (result.status === 'ready') { this.touch(before); if (!same) this.touch(after); }
        return result;
      } finally { await access.release(); }
    } finally {
      before.activeReaders--;
      if (before.released && before.activeReaders === 0) this.collect(before);
      if (!same) {
        after.activeReaders--;
        if (after.released && after.activeReaders === 0) this.collect(after);
      }
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopping = true;
    this.lifecycle.abort(new Error('workspace capture service closing'));
    this.closing = (async () => {
      await Promise.allSettled([...this.inFlight]);
      for (const entry of [...this.entries.values()]) this.collect(entry);
      this.tombstones.clear();
      this.tombstoneOrder.length = 0;
    })();
    return this.closing;
  }

  private liveEntry(ref: SourceCaptureRef): WorkspaceResult<CaptureEntry> {
    const entry = this.entries.get(ref.captureId);
    if (!entry || !sameRef(entry.ref, ref)) return rejected('capture_expired', 'capture is not retained by this process');
    if (entry.released) return rejected('capture_expired', 'capture was released');
    if (this.expired(entry)) { this.sweep(); return rejected('capture_expired', 'capture expired'); }
    return { status: 'ready', value: entry };
  }
  private checkDomain(entries: readonly CaptureEntry[], access: WorkspaceReadAccess): WorkspaceResult<never> | null {
    for (const entry of entries) {
      if (access.authorization.subjectKey !== entry.subjectKey) return rejected('forbidden', 'capture belongs to another subject');
      if (access.authorization.permissionRevision !== entry.permissionRevision) return rejected('forbidden', 'read permission revision changed since capture');
      if (access.workspaceIdentity !== entry.workspaceIdentity) return rejected('forbidden', 'workspace root binding changed since capture');
    }
    return null;
  }
  private track<T>(ctx: CoreCallContext, run: (signal: AbortSignal) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> {
    if (this.stopping) return Promise.resolve(rejected('cancelled', 'workspace capture service is closing'));
    const signal = AbortSignal.any([ctx.signal, this.lifecycle.signal]);
    const task = (async (): Promise<WorkspaceResult<T>> => {
      try { return await run(signal); }
      catch (error) {
        if (signal.aborted) return rejected('cancelled', 'request cancelled');
        return rejected('unavailable', message(error));
      }
    })();
    this.inFlight.add(task);
    void task.finally(() => { this.inFlight.delete(task); }).catch(() => {});
    return task;
  }

  private open(ctx: CoreCallContext, signal: AbortSignal, workspace: WorkspaceRef): Promise<WorkspaceResult<WorkspaceReadAccess>> {
    return this.deps.access.open({ ...ctx, signal }, workspace);
  }
  private async withAccess<T>(ctx: CoreCallContext, workspace: WorkspaceRef, signal: AbortSignal,
    work: (access: WorkspaceReadAccess) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> {
    if (this.stopping) return rejected('cancelled', 'workspace capture service is closing');
    const opened = await this.open(ctx, signal, workspace);
    if (opened.status !== 'ready') return opened;
    const access = opened.value;
    try { return await work(access); } finally { await access.release(); }
  }

  private async captureOp(ctx: CoreCallContext, input: CaptureSourceRequest, signal: AbortSignal): Promise<WorkspaceResult<CaptureSummary>> {
    const limits = this.limits;
    if (!input || typeof input !== 'object') return rejected('invalid', 'capture request required');
    const workspace = input.workspace;
    if (!workspace || workspace.aggregateType !== 'Workspace' || !workspace.projectId || !workspace.workspaceId) return rejected('invalid', 'workspace scope required');
    if (input.provider !== 'typescript' && input.provider !== 'text') return rejected('unsupported', 'only the typescript and text providers are implemented in this batch');
    if (input.provider === 'text' && input.configPath !== undefined) return rejected('invalid', 'the text provider has no project configuration');
    if (!Number.isSafeInteger(input.workspaceRevision) || input.workspaceRevision < 1) return rejected('invalid', 'trusted workspace revision required');
    if (input.configPath !== undefined && !safeRelative(input.configPath)) return rejected('invalid', 'configuration path must be a normalized relative path');
    if (input.prefix !== undefined && !safeRelative(input.prefix)) return rejected('invalid', 'prefix must be a normalized relative path');
    if (input.changedPaths !== undefined && (!Array.isArray(input.changedPaths) || input.changedPaths.some(path => !safeRelative(path)))) return rejected('invalid', 'changed paths must be normalized relative paths');
    this.sweep();
    // Reserve the slot before the first await; a concurrent start must not over-publish.
    if (this.activeCount() + this.pendingCaptures >= limits.maxRetainedCaptures) return rejected('capacity', 'retained capture capacity reached; release a capture first');
    this.pendingCaptures++;
    let reserved = true;
    const releaseReservation = () => { if (reserved) { reserved = false; this.pendingCaptures--; } };
    let access1: WorkspaceReadAccess | undefined;
    let analyzer: TypeScriptSourceAnalyzer | undefined;
    let published = false;
    try {
      const opened1 = await this.open(ctx, signal, workspace);
      if (opened1.status !== 'ready') return opened1;
      access1 = opened1.value;
      if (access1.workspaceRevision !== input.workspaceRevision) return rejected('source_stale', 'requested workspace revision is not current');
      if (input.configPath !== undefined && !access1.authorization.allowsRead(input.configPath)) return rejected('forbidden', 'configuration path outside readable scope');

      let scope: CaptureContentScope, files: SourceFileEntry[], sources: { path: string; digest: string }[], relations: SourceRelation[];
      let diagnostics: SourceDiagnostic[], diagnosticsTruncated: boolean, coverage: SourceCoverage;
      let commitHash: string | null, resolvedConfigPath: string | null, indexVersion: string, configDigest: string, sourceDigest: string, orderVersion: string;
      let material: CaptureMaterial;
      if (input.provider === 'text') {
        const text = await captureTextSource(access1, { prefix: input.prefix ?? null }, signal, this.captureLimits());
        scope = text.scope; commitHash = text.identity.commit; resolvedConfigPath = null; indexVersion = TEXT_ENGINE.indexVersion;
        sourceDigest = text.snapshot;
        configDigest = sha256Hex(canonicalJson({ provider: 'text', indexVersion, scope }));
        material = { provider: 'text', analyzer: null, text: text.files, identity: text.identity, snapshot: text.snapshot };
        files = deepFreeze([...text.files.values()].map(file => ({ path: file.path, digest: file.digest, sizeBytes: file.byteLength, kind: 'text' as const })));
        sources = []; relations = []; diagnostics = []; diagnosticsTruncated = false;
        coverage = deepFreeze({ provider: 'text', engine: TEXT_ENGINE.name, engineVersion: TEXT_ENGINE.version,
          projectConfiguration: null, sourceCount: files.length, indexedSourceCount: 0, permissionFiltered: true,
          scope, complete: true, unresolved: [], filesystemAtomic: false, fullRuntimeCallGraph: false });
        orderVersion = sha256Hex(JSON.stringify(files.map(file => [file.path, file.digest])));
      } else {
        const snapshot = await captureProjectSource(projectAccess(access1, limits), signal, this.captureLimits());
        analyzer = new TypeScriptSourceAnalyzer();
        // The complete configured relation set is analysed once without the result hint: a capture
        // prefix only scopes explicitly prefixed queries, never the full export/graph material.
        const analysis = analyzer.analyze(snapshot, { operation: 'imports',
          ...(input.configPath !== undefined ? { configPath: input.configPath } : {}) }, signal, { maxResults: limits.maxQueryResults });
        relations = deepFreeze(analysis.results.filter(result => 'module' in result).map(toSourceRelation));
        files = deepFreeze([...snapshot.files.values()].map(toSourceFileEntry));
        // Graph sources keep exactly the original {path,digest} shape; the export manifest is richer.
        sources = deepFreeze(analysis.indexedSources.map(({ path, digest }) => ({ path, digest })));
        diagnostics = deepFreeze(analysis.diagnostics.map(toSourceDiagnostic));
        diagnosticsTruncated = analysis.diagnosticsTruncated;
        scope = TS_SCOPE; commitHash = snapshot.identity.commit; resolvedConfigPath = analysis.coverage.projectConfiguration;
        indexVersion = SOURCE_ENGINE.name + '@' + SOURCE_ENGINE.version;
        sourceDigest = snapshot.snapshot;
        material = { provider: 'typescript', analyzer, snapshot };
        coverage = deepFreeze({ provider: 'typescript', engine: SOURCE_ENGINE.name, engineVersion: SOURCE_ENGINE.version,
          projectConfiguration: analysis.coverage.projectConfiguration, sourceCount: files.length, indexedSourceCount: sources.length,
          permissionFiltered: true, scope, complete: true,
          unresolved: relations.filter(relation => relation.resolution === 'unknown').map(relation => 'unresolved import: ' + relation.from.path + ':' + relation.from.start.line + ' -> ' + relation.expression),
          filesystemAtomic: false, fullRuntimeCallGraph: false });
        configDigest = sha256Hex(canonicalJson({ requestedConfigPath: input.configPath ?? null, resolvedConfigPath,
          configurations: files.filter(file => file.path.endsWith('.json')).map(file => [file.path, file.digest]),
          provider: 'typescript', indexVersion, prefix: input.prefix ?? null }));
        orderVersion = sha256Hex(JSON.stringify(relations));
      }

      // The final verification always uses a fresh access: root, identity, permission and revision must not move under the capture.
      const opened2 = await this.open(ctx, signal, workspace);
      if (opened2.status !== 'ready') return opened2;
      const access2 = opened2.value;
      try {
        if (access2.authorization.subjectKey !== access1.authorization.subjectKey) return rejected('source_stale', 'reader identity changed during capture');
        if (access2.authorization.permissionRevision !== access1.authorization.permissionRevision) return rejected('source_stale', 'read permission revision changed during capture');
        if (access2.workspaceIdentity !== access1.workspaceIdentity) return rejected('source_stale', 'workspace root binding changed during capture');
        if (access2.workspaceRevision !== access1.workspaceRevision) return rejected('source_stale', 'workspace revision changed during capture');
        if (material.provider === 'text') {
          const verified = await captureTextSource(access2, { prefix: input.prefix ?? null }, signal, this.captureLimits());
          if (verified.snapshot !== sourceDigest || canonicalJson(verified.scope) !== canonicalJson(scope))
            return rejected('source_stale', 'text sources changed during capture');
        } else {
          const verified = await captureProjectSource(projectAccess(access2, limits), signal, this.captureLimits());
          if (verified.snapshot !== sourceDigest) return rejected('source_stale', 'project sources changed during capture');
        }
      } finally { await access2.release(); }
      // Cancellation may have arrived while the final verification access was being released:
      // never publish a capture whose request was cancelled.
      signal.throwIfAborted();

      let changes: CaptureSummary['changes'] = { added: files.map(file => file.path), modified: [], deleted: [] };
      if (input.previous) {
        const previous = this.entries.get(input.previous.captureId);
        if (!previous || !sameRef(previous.ref, input.previous) || previous.released) return rejected('capture_expired', 'previous capture is no longer retained');
        if (this.expired(previous)) { this.sweep(); return rejected('capture_expired', 'previous capture expired'); }
        // A previous baseline only applies to the same scope, authorization domain and provider.
        if (previous.ref.projectId !== workspace.projectId || previous.ref.workspaceId !== workspace.workspaceId)
          return rejected('forbidden', 'previous capture belongs to another workspace scope');
        if (previous.ref.indexVersion !== indexVersion) return rejected('unsupported', 'previous capture uses an incompatible provider/index version');
        if (canonicalJson(previous.scope) !== canonicalJson(scope)) return rejected('unsupported', 'previous capture declares a different content scope');
        if (previous.subjectKey !== access1.authorization.subjectKey || previous.permissionRevision !== access1.authorization.permissionRevision || previous.workspaceIdentity !== access1.workspaceIdentity)
          return rejected('forbidden', 'previous capture belongs to another reader or authorization domain');
        changes = deepFreeze(summaryChanges(diffContent(manifestOf(previous), manifestOf({ material }))));
      } else {
        changes = deepFreeze(changes);
      }
      const ref: SourceCaptureRef = deepFreeze({ projectId: workspace.projectId, workspaceId: workspace.workspaceId, captureId: randomUUID(),
        workspaceRevision: access1.workspaceRevision, sourceDigest, configDigest, indexVersion });
      const nowMs = this.nowMs();
      const entry: CaptureEntry = {
        ref, subjectKey: access1.authorization.subjectKey, permissionRevision: access1.authorization.permissionRevision, workspaceIdentity: access1.workspaceIdentity,
        requestedConfigPath: input.configPath ?? null, resolvedConfigPath, commitHash,
        capturedAt: this.deps.now(), verifiedAt: this.deps.now(), lastUsedAt: nowMs, expiresAt: nowMs + limits.idleExpiryMs, changes,
        released: false, activeReaders: 0, bytes: 0, scope, material, files, sources, relations, diagnostics, diagnosticsTruncated, coverage,
        orderVersion, queries: new Map(), cursors: new Map(),
      };
      entry.bytes = this.logicalBytes(entry);
      if (entry.bytes + this.retainedBytes() > limits.maxRetainedBytes) return rejected('capacity', 'capture material exceeds the configured retained-byte capacity');
      // Publish atomically: the reservation becomes the retained entry.
      releaseReservation();
      this.entries.set(ref.captureId, entry);
      published = true;
      return { status: 'ready', value: deepFreeze(this.summaryOf(entry)) };
    } catch (error) {
      if (signal.aborted) return rejected('cancelled', 'capture cancelled');
      if (error instanceof ProjectSourceFailure) return this.captureFailure(error);
      throw error;
    } finally {
      releaseReservation();
      if (!published) analyzer?.dispose();
      if (access1) await access1.release();
    }
  }

  private async releaseOp(ctx: CoreCallContext, ref: SourceCaptureRef, signal: AbortSignal): Promise<WorkspaceResult<{ released: boolean }>> {
    if (this.stopping) return rejected('cancelled', 'workspace capture service is closing');
    this.sweep();
    const entry = this.entries.get(ref.captureId);
    if (entry && !sameRef(entry.ref, ref)) return rejected('capture_expired', 'capture reference does not match retained material');
    const tombstone = entry ? undefined : this.tombstones.get(ref.captureId);
    if (!entry && (!tombstone || !sameRef(tombstone.ref, ref))) return rejected('capture_expired', 'capture is not retained by this process');
    const subjectKey = entry ? entry.subjectKey : tombstone!.subjectKey;
    if (entry && this.expired(entry)) { this.sweep(); return rejected('capture_expired', 'capture expired'); }
    const opened = await this.open(ctx, signal, workspaceOf(ref));
    if (opened.status !== 'ready') return opened;
    const access = opened.value;
    try {
      if (access.authorization.subjectKey !== subjectKey) return rejected('forbidden', 'capture belongs to another subject');
      const released = entry !== undefined && !entry.released;
      if (entry && !entry.released) {
        entry.released = true;
        // Free the entry's bytes before recording the tombstone whenever no reader still owns it;
        // a reader-held entry is left untouched and the tombstone then stays within budget or is skipped.
        if (entry.activeReaders === 0) this.collect(entry);
        this.addTombstone(entry);
      }
      return { status: 'ready', value: deepFreeze({ released }) };
    } finally { await access.release(); }
  }

  private summaryOf(entry: CaptureEntry): CaptureSummary {
    return { ref: entry.ref, capturedAt: entry.capturedAt, verifiedAt: entry.verifiedAt, commitHash: entry.commitHash,
      expiresAt: new Date(entry.expiresAt).toISOString(), coverage: entry.coverage, changes: entry.changes };
  }
  private captureLimits() { return { maxFileBytes: this.limits.maxFileBytes, maxCaptureBytes: this.limits.maxCaptureBytes, maxInventoryFiles: this.limits.maxInventoryFiles }; }
  private captureFailure(failure: ProjectSourceFailure): WorkspaceResult<never> {
    if (failure.status === 'unsupported') return rejected('unsupported', failure.message);
    if (failure.status === 'stale') return rejected('source_stale', failure.message);
    if (failure.status === 'capacity') return rejected('capacity', failure.message);
    if (/inventory incomplete|capacity/.test(failure.message)) return rejected('capacity', failure.message);
    if (/outside readable scope/.test(failure.message)) return rejected('forbidden', failure.message);
    return rejected('invalid', failure.message);
  }
  private nowMs(): number {
    const value = Date.parse(this.deps.now());
    if (!Number.isFinite(value)) throw Error('now() must return an ISO timestamp');
    return value;
  }
  private expired(entry: CaptureEntry) { return entry.expiresAt <= this.nowMs(); }
  private touch(entry: CaptureEntry) { entry.lastUsedAt = this.nowMs(); entry.expiresAt = entry.lastUsedAt + this.limits.idleExpiryMs; }
  /** A retained slot is occupied until the entry is released or expires with no active reader. */
  private activeCount() { const now = this.nowMs(); return [...this.entries.values()].filter(entry => !entry.released && (entry.expiresAt > now || entry.activeReaders > 0)).length; }
  private retainedBytes() { return [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) + [...this.tombstones.values()].reduce((sum, tombstone) => sum + tombstone.bytes, 0); }
  private logicalBytes(entry: CaptureEntry): number {
    const content = entry.material.provider === 'text'
      ? [...entry.material.text.values()].reduce((sum, file) => sum + file.byteLength, 0)
      : [...entry.material.snapshot.files.values()].reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
    const material = Buffer.byteLength(JSON.stringify({ files: entry.files, sources: entry.sources, relations: entry.relations, diagnostics: entry.diagnostics, scope: entry.scope }));
    // Ref/scope/authorization/config/delta metadata is retained too; its byte length is not constant.
    const metadata = Buffer.byteLength(JSON.stringify({ ref: entry.ref, subjectKey: entry.subjectKey, permissionRevision: entry.permissionRevision,
      workspaceIdentity: entry.workspaceIdentity, requestedConfigPath: entry.requestedConfigPath, resolvedConfigPath: entry.resolvedConfigPath,
      commitHash: entry.commitHash, capturedAt: entry.capturedAt, verifiedAt: entry.verifiedAt, changes: entry.changes, coverage: entry.coverage,
      orderVersion: entry.orderVersion }));
    return content + material + metadata + 64;
  }
  private collect(entry: CaptureEntry) {
    if (!this.entries.delete(entry.ref.captureId)) return;
    if (entry.material.provider === 'typescript') entry.material.analyzer.dispose();
  }
  /**
   * Release tombstones are best-effort replay aids, never a reason to exceed the logical budget
   * or to disturb an active reader: expired reader-less entries are swept first, then the oldest
   * tombstones are evicted, and if the budget still cannot hold this one it is simply not kept
   * (the handle is then treated as unknown).
   */
  private addTombstone(entry: CaptureEntry) {
    this.sweep();
    const tombstone: Tombstone = { ref: entry.ref, subjectKey: entry.subjectKey, permissionRevision: entry.permissionRevision, expiresAt: entry.expiresAt, bytes: 0 };
    tombstone.bytes = Buffer.byteLength(JSON.stringify(tombstone)) + 64;
    while (this.retainedBytes() + tombstone.bytes > this.limits.maxRetainedBytes && this.tombstoneOrder.length)
      this.tombstones.delete(this.tombstoneOrder.shift()!);
    if (this.retainedBytes() + tombstone.bytes > this.limits.maxRetainedBytes) return;
    this.tombstones.set(entry.ref.captureId, tombstone);
    this.tombstoneOrder.push(entry.ref.captureId);
    const limit = Math.max(1, this.limits.maxRetainedCaptures * 2);
    while (this.tombstoneOrder.length > limit) this.tombstones.delete(this.tombstoneOrder.shift()!);
  }
  private sweep() {
    const now = this.nowMs();
    for (const entry of [...this.entries.values()]) if (!entry.released && entry.activeReaders === 0 && entry.expiresAt <= now) this.collect(entry);
    for (const [captureId, tombstone] of [...this.tombstones]) if (tombstone.expiresAt <= now) {
      this.tombstones.delete(captureId);
      const index = this.tombstoneOrder.indexOf(captureId);
      if (index >= 0) this.tombstoneOrder.splice(index, 1);
    }
  }
}
