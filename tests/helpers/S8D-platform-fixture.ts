/**
 * Slice 8D rework round 2: ONE public platform fixture for the acceptance
 * entries that observe a real workspace through `createTargetPlatform`.
 *
 * The fixture is the A-06 pattern lifted into a helper: a real temporary root,
 * the A-06 Host bindings (root resolution + explicit per-file source grant),
 * project create then workspace register with the A-06 revisions, the real
 * `captureSourceChanges`/`listFiles` observation path and the formal catalog
 * pinned for `compareFormalObserved`.
 *
 * `listFiles` publishes no `unresolved` list, so the fixture reads it from the
 * public comparison's `unresolved` findings. A catalog pin is required for that
 * comparison; `adopt()` with no arguments adopts one empty catalog exactly once
 * and every later comparison reuses that same pin (the platform admits one
 * initial adoption per project).
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ArchitectureCatalogPinV1, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { FileGraphPageNodeV1, FileGraphPageV1, LanguageCoverageV1,
  ObservationInventoryV1, ObservedCaptureRef } from '../../src/contracts/architecture-inspection.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ModuleRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { PersistedSourceCaptureRef } from '../../src/contracts/core/source.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { WorkspaceResult } from '../../src/core/workspace/ports.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';

const AT = '2026-10-17T00:00:00.000Z';

export const BACKENDS = ['memory', 'sqlite'] as const;
export type Backend = (typeof BACKENDS)[number];
export type Entry = [path: string, content: string | Uint8Array];
export type SourceAnalyzers = {
  directory?: string;
  pythonPath?: string;
  cppLibraryPath?: string;
  unitTimeoutMs?: number;
  languageTimeoutMs?: number;
};

/** §11.2 trusted test injection handed to the one observation light scan. */
export type LightScan = {
  fault?: (event: { phase: 'language' } | { phase: 'file'; path: string }) => void;
  maxRawReferences?: number;
};

/** `workspace` initializes the repo at the workspace root; `parent` one level up
 * (a real subdirectory-of-a-repo workspace; listed paths stay root-relative). */
export type FixtureGit = { repo?: 'workspace' | 'parent' };

const gitRun = promisify(execFile);
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'S8D fixture',
  GIT_AUTHOR_EMAIL: 's8d-fixture@example.invalid',
  GIT_COMMITTER_NAME: 'S8D fixture',
  GIT_COMMITTER_EMAIL: 's8d-fixture@example.invalid',
};

/** The file-level observation shape the public graph entries assert against. */
export type GraphShape = {
  nodes: FileGraphPageNodeV1[];
  edges: { from: string; to: string }[];
  unresolved: { from: string; specifier: string; reason: string | null }[];
  languages: LanguageCoverageV1[];
  complete: boolean;
  inventory: ObservationInventoryV1;
};

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type RawCaptureResult = Awaited<ReturnType<Platform['architecture']['captureSourceChanges']>>;
/** The raw write result plus the persisted ref the next capture can pass as `previous`. */
export type CaptureOutcome = RawCaptureResult & { persisted: PersistedSourceCaptureRef | null };
/** `capture()` keeps its observed capture ref and adds the persisted ref. */
export type FixtureCapture = ObservedCaptureRef & { persisted: PersistedSourceCaptureRef };
type Mappings = { id: string; kind: 'module'; paths: string[] }[];
type AdoptionDependencies = { from: ModuleRef; to: ModuleRef; reason: string }[];

export type PlatformFixture = {
  /** Absolute workspace root; `write` resolves relative to it. */
  root: string;
  platform: Platform;
  /** Project/workspace call context; its signal is `options.signal` when given. */
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  /** Explicit modules/dependencies, or the cached empty catalog when omitted. */
  adopt(modules?: ModuleDefinition[], dependencies?: AdoptionDependencies): Promise<ArchitectureCatalogPinV1>;
  /** Raw `captureSourceChanges` result (a rejected capture is returned as-is). */
  captureResult(mappings?: Mappings, requestId?: string, previous?: PersistedSourceCaptureRef | null): Promise<CaptureOutcome>;
  /** The same capture, asserting it committed; `persisted` is the ref for `previous`. */
  capture(mappings?: Mappings, requestId?: string, previous?: PersistedSourceCaptureRef | null): Promise<FixtureCapture>;
  /** The first `listFiles` page, asserting the read is ready. */
  listFiles(captureRef: ObservedCaptureRef): Promise<FileGraphPageV1>;
  /** Capture with no mappings, list, compare; a rejected capture is returned as-is. */
  graphResult(): Promise<WorkspaceResult<GraphShape>>;
  /** `ready(graphResult())` or a thrown error. */
  graph(): Promise<GraphShape>;
  /** Add/overwrite one workspace file and widen the Host allow map for it. */
  write(path: string, content: string | Uint8Array): Promise<void>;
  /** Delete one workspace file through a real unlink. The Host grant for the
   * frozen path stays: deleting a working file is not a permission revision, so
   * a later capture can still read its `previous` observation. Narrowing is
   * `deny(path)`. */
  remove(path: string): Promise<void>;
  /** Narrow the Host read authorization for one path (A-14). */
  deny(path: string): void;
  /** Close the platform first, then remove the temporary directory. */
  close(): Promise<void>;
};

function failureOf(result: { status: string; code?: string; reason?: string }): string {
  if (result.status === 'not_found') return 'not_found';
  if (result.status === 'not_ready') return 'not_ready';
  return `${result.code ?? result.status}: ${result.reason ?? ''}`;
}

export async function fixture(backend: Backend, projectId: string, entries: Entry[],
  options: { sourceAnalyzers?: SourceAnalyzers; signal?: AbortSignal;
    fileGraph?: { maxNodes: number; maxEdges: number; chunkBytes?: number };
    git?: boolean | FixtureGit; lightScan?: LightScan } = {}): Promise<PlatformFixture> {
  const directory = await mkdtemp(join(tmpdir(), 's8d-platform-'));
  const root = join(directory, 'workspace');
  let platform: Platform | undefined;
  try {
    await mkdir(root, { recursive: true });
    const files = new Map<string, string | Uint8Array>(entries);
    for (const [path, content] of entries) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    // Real Git in the temp tree only: init + one commit AFTER the entries are
    // written, so the tests can still create an untracked-but-not-ignored file
    // through `write()` afterwards. `repo: 'parent'` puts the repo one level up.
    if (options.git !== undefined && options.git !== false) {
      const repo = typeof options.git === 'object' && options.git.repo === 'parent' ? directory : root;
      await gitRun('git', ['init', '-q'], { cwd: repo, env: GIT_ENV });
      await gitRun('git', ['add', '-A'], { cwd: repo, env: GIT_ENV });
      await gitRun('git', ['commit', '-q', '--no-gpg-sign', '-m', 'S8D fixture'], { cwd: repo, env: GIT_ENV });
    }
    const allowed = new Set(files.keys());
    const workspaceId = 'main';
    const scope: WorkspaceScope = { projectId, workspaceId };
    const actor = { kind: 'human' as const, id: `${projectId}-operator` };
    const host: WorkspaceHostBindings = {
      async resolveRoot(requested) {
        return requested.projectId === projectId && requested.workspaceId === workspaceId
          ? { status: 'ready', value: { root, workspaceRevision: 1 } }
          : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
      },
      async authorize(bound, requested) {
        const permitted = bound.projectId === projectId && bound.workspaceId === workspaceId &&
          bound.principal.kind === 'host' && bound.principal.actor.id === actor.id &&
          bound.materialReader.kind === 'host' && bound.materialReader.actor.id === actor.id &&
          requested.projectId === projectId && requested.workspaceId === workspaceId;
        return permitted
          ? { status: 'ready', value: { subjectKey: `${projectId}-observer`,
              permissionRevision: `${projectId}-platform-fixture-v1`,
              allowsRead: (path: string) => allowed.has(path) } }
          : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' };
      },
    };
    const sourceAnalyzers = options.sourceAnalyzers;
    platform = await createTargetPlatform({
      storage: backend === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
      workspace: host, now: () => AT,
      architectureSource: { provider: 'typescript', configPath: null },
      ...(sourceAnalyzers === undefined ? {} : { sourceAnalyzers }),
      ...(options.fileGraph === undefined ? {} : { fileGraph: options.fileGraph }),
      ...(options.lightScan === undefined ? {} : { lightScan: options.lightScan }),
    });
    const ctx: CoreCallContext = {
      projectId, workspaceId,
      principal: { kind: 'host', actor },
      materialReader: { kind: 'host', projectId, workspaceId, actor },
      signal: options.signal ?? new AbortController().signal,
    };
    const projectRef = { aggregateType: 'Project' as const, projectId };
    const created = await platform.projects.createProject(ctx, { meta: {
      requestId: `${projectId}-create-project`,
      expected: [{ ref: projectRef, revision: 0 }],
    }, input: { projectId } });
    if (created.status !== 'committed') throw Error(`createProject ${failureOf(created)}`);
    const registered = await platform.projects.registerWorkspace(ctx, { meta: {
      requestId: `${projectId}-register-workspace`,
      expected: [{ ref: projectRef, revision: 1 },
        { ref: { aggregateType: 'Workspace', ...scope }, revision: 0 }],
    }, input: { workspace: scope } });
    if (registered.status !== 'committed') throw Error(`registerWorkspace ${failureOf(registered)}`);

    // The platform admits exactly ONE initial adoption per project; keep the
    // first pin (empty or explicit) and reuse it for every comparison.
    let pin: ArchitectureCatalogPinV1 | undefined;
    let adoptions = 0;
    let captures = 0;

    const adopt: PlatformFixture['adopt'] = async (modules = [], dependencies = []) => {
      if (pin !== undefined) {
        if (modules.length > 0 || dependencies.length > 0) {
          throw Error('the fixture project already adopted one catalog; only one initial adoption is admissible');
        }
        return pin;
      }
      const ordinal = ++adoptions;
      const adopted = await platform!.architecture.adoptInitialArchitecture(ctx, {
        meta: { requestId: `${projectId}-adopt-${ordinal}`, expected: [
          { ref: projectRef, revision: 1 },
          { ref: { aggregateType: 'Workspace', ...scope }, revision: 1 },
        ] },
        input: {
          baselineId: `${projectId}-baseline-${ordinal}`,
          description: `${projectId} platform fixture`,
          constraints: [],
          catalog: { requireDag: true, dependencies, modules },
        },
      });
      if (adopted.status !== 'committed') throw Error(`adoptInitialArchitecture ${failureOf(adopted)}`);
      const read = await platform!.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
      if (read.status !== 'ready') throw Error(`readArchitectureRevision ${failureOf(read)}`);
      if (read.value.catalog === null) throw Error('readArchitectureRevision has no catalog');
      pin = {
        catalogRef: read.value.catalog.ref,
        baseline: { ref: read.value.baseline.ref, digest: read.value.baseline.contentDigest },
      };
      return pin;
    };

    const captureResult: PlatformFixture['captureResult'] = async (mappings = [], requestId, previous = null) => {
      const result = await platform!.architecture.captureSourceChanges(ctx, {
        input: { workspace: scope, mappings, previous },
        meta: { requestId: requestId ?? `${projectId}-capture-${++captures}`, expected: [] },
      });
      // Additive: the bounded capture ref for a later `previous` read. Existing
      // fields of the write result are unchanged.
      return Object.assign(result, { persisted: result.status === 'committed' ? result.value : null });
    };

    const capture: PlatformFixture['capture'] = async (mappings = [], requestId, previous = null) => {
      const captured = await captureResult(mappings, requestId, previous);
      if (captured.status !== 'committed') throw Error(`captureSourceChanges ${failureOf(captured)}`);
      return { aggregateType: 'ObservedArchitecture', projectId, workspaceId,
        captureId: captured.value.capture.captureId, persisted: captured.value };
    };

    const listFiles: PlatformFixture['listFiles'] = async captureRef => {
      const page = await platform!.architecture.listFiles(ctx, { captureRef, cursor: null });
      if (page.status !== 'ready') throw Error(`listFiles ${failureOf(page)}`);
      return page.value;
    };

    let graphs = 0;
    const graphResult: PlatformFixture['graphResult'] = async () => {
      const captured = await captureResult([], `${projectId}-graph-capture-${++graphs}`);
      // A cancelled capture must reach the caller unchanged (A-24(4)), never be
      // converted into a fixture/setup error.
      if (captured.status !== 'committed') return captured as unknown as WorkspaceResult<GraphShape>;
      const captureRef: ObservedCaptureRef = { aggregateType: 'ObservedArchitecture', projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const page = await platform!.architecture.listFiles(ctx, { captureRef, cursor: null });
      if (page.status !== 'ready') return page as unknown as WorkspaceResult<GraphShape>;
      const catalog = await adopt();
      const comparison = await platform!.architecture.compareFormalObserved(ctx, { catalog, captureRef });
      if (comparison.status !== 'ready') return comparison as unknown as WorkspaceResult<GraphShape>;
      return { status: 'ready', value: {
        nodes: page.value.nodes,
        edges: page.value.edges,
        // The comparison's `detail` is the bare specifier when the reason is
        // null, otherwise `<specifier>（<reason>）` (spec §11.5). Split it back so
        // the fixture exposes the bare specifier plus the reason.
        unresolved: comparison.value.findings.flatMap(finding => {
          if (finding.kind !== 'unresolved' || finding.path === null) return [];
          const detail = finding.detail;
          const open = detail.lastIndexOf('（');
          return [open > 0 && detail.endsWith('）')
            ? { from: finding.path, specifier: detail.slice(0, open), reason: detail.slice(open + 1, -1) }
            : { from: finding.path, specifier: detail, reason: null }];
        }),
        languages: page.value.languages,
        complete: page.value.complete,
        inventory: page.value.inventory,
      } };
    };

    const graph: PlatformFixture['graph'] = async () => {
      const result = await graphResult();
      if (result.status !== 'ready') throw Error(`graph ${failureOf(result)}`);
      return result.value;
    };

    const write: PlatformFixture['write'] = async (path, content) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
      files.set(path, content);
      allowed.add(path);
    };
    const remove: PlatformFixture['remove'] = async path => {
      const absolute = join(root, path);
      if (!absolute.startsWith(root + '/')) throw Error(`remove path escapes the fixture root: ${path}`);
      await rm(absolute, { force: true });
      files.delete(path);
    };
    const deny: PlatformFixture['deny'] = path => { allowed.delete(path); };

    const close: PlatformFixture['close'] = async () => {
      try {
        await platform!.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };

    return { root, platform, ctx, scope, adopt, captureResult, capture, listFiles,
      graphResult, graph, write, remove, deny, close };
  } catch (error) {
    if (platform !== undefined) await platform.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
