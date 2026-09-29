/**
 * MVP UI connection — HTTP entry seam.
 *
 * Stage one proves the seven new suffixes are published on the SAME per-instance
 * token / same-origin boundary as every other Host route, that `files/compare`
 * forwards the EXISTING WorkspaceToolsPort.compareWorkspace, and that the
 * Host workbench-tools default (no writePrefixes, no allowCommands) denies the
 * save/command routes.
 *
 * The cold-start Project read is the expected FIRST RED until stage two wires
 * the real narrow owner read; the browser E2E stays with the reviewer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { CORE_ROUTE_SPECS } from '../../src/app/core-routes.js';
import {
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_META_NAME,
  type CoreScope,
} from '../../src/app/core-http-types.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import { renderArchitectureContainment } from '../../src/ui/views.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import {
  DISPLAY_PREFERENCE_V1_KEY, createScopeDisplayStore,
  DIRECTORY_INVENTORY_PAGE_SIZE, ensureDirectory, showMoreDirectoryInventory,
} from '../../src/ui/main.js';
import type {
  DirectoryInventoryReply, DirectoryInventorySend, DirectoryInventoryState,
  DisplayPreferenceStorage, ScopeDisplayReadPort,
} from '../../src/ui/main.js';

const projectDir = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const scope: CoreScope = { projectId: 'mvp-ui-project', workspaceId: 'mvp-ui-workspace' };
const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', ...scope };
const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: 'mvp-ui-goal' };
const at = '2026-09-28T00:00:00.000Z';

let publicDir = '';
const temporary: string[] = [];

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'mvp-ui-entry-public-'));
  temporary.push(publicDir);
  const build = spawnSync(process.execPath, ['scripts/build-workbench.mjs'], {
    cwd: projectDir, encoding: 'utf8', env: { ...process.env, WORKBENCH_OUT_DIR: publicDir },
  });
  if (build.status !== 0) throw new Error(`workbench build failed: ${build.stdout}\n${build.stderr}`);
}, 60_000);

afterAll(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Started = { host: LocalWorkbenchHost; base: string; token: string };

async function startHost(): Promise<Started> {
  const root = await mkdtemp(join(tmpdir(), 'mvp-ui-entry-ws-'));
  const database = await mkdtemp(join(tmpdir(), 'mvp-ui-entry-db-'));
  temporary.push(root, database);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'app.ts'), 'export const answer = 1;\n');
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: database },
    actor: { kind: 'human', id: 'mvp-ui-operator' },
    publicDir,
    now: () => at,
    workspaces: [{ scope, name: 'MVP UI workspace', root, workspaceRevision: 1, readPrefixes: ['src'] }],
  });
  const address = await host.listen();
  const token = await readPageToken(address.url);
  return { host, base: address.url, token };
}

async function readPageToken(base: string): Promise<string> {
  const response = await fetch(base);
  const html = await response.text();
  const match = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return match[1];
}

const coreUrl = (base: string, suffix: string): string => new URL(CORE_API_PREFIX + suffix, base).toString();
const plain = (input: unknown) => ({ scope, input });
const graphWrite = (input: unknown, requestId: string, expected: unknown[] = []) =>
  ({ scope, request: { input, meta: { requestId, expected } } });

async function corePost(base: string, suffix: string, token: string | undefined, body: unknown): Promise<Response> {
  return fetch(coreUrl(base, suffix), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { [PLATFORM_TOKEN_HEADER]: token }) },
    body: JSON.stringify(body),
  });
}

describe('MVP UI route table (stage-one green)', () => {
  it('publishes the frozen UI suffixes with explicit, named classifications', () => {
    expect(CORE_ROUTE_SPECS['executions/list']).toEqual({ kind: 'plain', binding: 'listExecutions', owner: 'executions.listExecutions' });
    expect(CORE_ROUTE_SPECS['projects/read']).toEqual({ kind: 'plain', binding: 'readProject', owner: 'projects.readProject' });
    expect(CORE_ROUTE_SPECS['files/save']).toEqual({ kind: 'plain', binding: 'saveWorkspaceFile', owner: 'workbench.saveFile' });
    expect(CORE_ROUTE_SPECS['files/list']).toEqual({ kind: 'plain', binding: 'listWorkspaceFiles', owner: 'workbench.listFiles' });
    expect(CORE_ROUTE_SPECS['files/compare']).toEqual({ kind: 'plain', binding: 'compareWorkspaceFiles', owner: 'workspace.compareWorkspace' });
    expect(CORE_ROUTE_SPECS['commands/start']).toEqual({ kind: 'plain', binding: 'startCommand', owner: 'workbench.startCommand' });
    expect(CORE_ROUTE_SPECS['commands/read']).toEqual({ kind: 'plain', binding: 'readCommand', owner: 'workbench.readCommand' });
    expect(CORE_ROUTE_SPECS['commands/stop']).toEqual({ kind: 'plain', binding: 'stopCommand', owner: 'workbench.stopCommand' });
  });
});

describe('MVP UI HTTP boundary (stage-one green)', () => {
  it('keeps the token/scope boundary and denies write/execute by default', async () => {
    const started = await startHost();
    try {
      const saveBody = plain({ path: 'src/app.ts', expectedRevision: null, content: 'changed\n' });
      const missingToken = await corePost(started.base, 'files/save', undefined, saveBody);
      expect(missingToken.status).toBe(403);
      const save = await corePost(started.base, 'files/save', started.token, saveBody);
      expect(save.status).toBe(200);
      expect(await save.json()).toMatchObject({ status: 'rejected', code: 'forbidden' });
      const command = await corePost(started.base, 'commands/start', started.token,
        plain({ requestId: 'mvp-command-1', command: 'echo should-not-run', cwd: '.' }));
      expect(await command.json()).toMatchObject({ status: 'rejected', code: 'forbidden' });
      // compare forwards the EXISTING WorkspaceToolsPort.compareWorkspace.
      const compare = await corePost(started.base, 'files/compare', started.token,
        plain({ workspace: workspaceRef, before: { kind: 'working_tree' }, after: { kind: 'working_tree' } }));
      // 200 proves the suffix is published; the body is the EXISTING owner's own
      // result (it may legitimately reject an identical before/after pair), never
      // the route-level unsupported fallback.
      expect(compare.status).toBe(200);
      const compareBody = await compare.json() as { status: string; code?: string };
      expect(compareBody.code).not.toBe('unsupported');
      // The list/read routes are published (never an unpublished 404).
      const list = await corePost(started.base, 'executions/list', started.token,
        plain({ goalRef, page: { afterCursor: null, limit: 10 } }));
      expect(list.status).toBe(200);
    } finally {
      await started.host.close();
    }
  });
});

describe('MVP UI cold start (expected red until stage two)', () => {
  it('registers the Project and then reads its real revision through the narrow owner read', async () => {
    const started = await startHost();
    try {
      const created = await corePost(started.base, 'projects/create', started.token,
        graphWrite({ projectId: scope.projectId }, 'mvp-ui-project-1', [{ ref: projectRef, revision: 0 }]));
      expect(await created.json()).toMatchObject({ status: 'committed' });
      const read = await corePost(started.base, 'projects/read', started.token, plain(scope.projectId));
      expect(await read.json()).toMatchObject({ status: 'ready', value: { ref: projectRef, revision: 1 } });
    } finally {
      await started.host.close();
    }
  });
});

// Stage-one renderer regression for the dual-graph prototype narrow fix: an
// adopted catalog that has modules and dependencies but no containment must
// still show the real modules as parallel root nodes and click targets. A
// missing containment field is a real "not declared" state, never a reason to
// infer a tree or an edge from paths or dependencies.
describe('MVP UI containment without a declared tree', () => {
  const revision: ArchitectureRevision = {
    baseline: {
      ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: scope.projectId, baselineId: 'mvp-ui-baseline', revision: 1 },
      revision: 1,
      schemaVersion: 1,
      baselineId: 'mvp-ui-baseline',
      contentRevision: 1,
      contentDigest: 'a'.repeat(64),
      content: { schemaVersion: 1, description: 'containment regression fixture', constraints: [] },
    },
    catalog: {
      ref: { aggregateType: 'ArchitectureCatalog', projectId: scope.projectId, baselineId: 'mvp-ui-baseline', revision: 1 },
      revision: 1,
      baselineRef: { aggregateType: 'ArchitectureBaselineRevision', projectId: scope.projectId, baselineId: 'mvp-ui-baseline', revision: 1 },
      schemaVersion: 1,
      catalog: {
        requireDag: true,
        modules: [
          { ref: { projectId: scope.projectId, moduleId: 'module-alpha' }, name: 'Alpha', responsibility: 'owns alpha',
            paths: ['src/alpha'], interfaces: [] },
          { ref: { projectId: scope.projectId, moduleId: 'module-beta' }, name: 'Beta', responsibility: 'owns beta',
            paths: ['src/beta'], interfaces: [] },
        ],
        dependencies: [
          { from: { projectId: scope.projectId, moduleId: 'module-alpha' },
            to: { projectId: scope.projectId, moduleId: 'module-beta' }, reason: 'alpha calls beta' },
        ],
      },
    },
  };

  it('keeps real root module nodes and click targets and fabricates no edges', () => {
    const html = renderArchitectureContainment({ status: 'ready', value: revision });
    expect(html).toContain('data-view="architecture-containment"');
    // Both declared modules stay as nodes of the existing node/link renderer.
    expect(html).toContain('class="q-graphnode');
    expect(html).toContain('data-node="module-alpha"');
    expect(html).toContain('data-node="module-beta"');
    // Each node is a real click target bound to the module ref the consumer reads.
    expect(html).toContain('data-action="select-node"');
    expect(html).toContain('data-target-kind="module"');
    expect(html).toContain('data-module-id="module-alpha"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    // No containment was declared, so no edge line may appear even though the
    // catalog carries a real dependency.
    expect(html).not.toContain('<path');
  });
});

// Stage-one red contract for the scope display-identity preference. Each scope
// must keep its OWN display ids so a second browser tab saving scope B cannot
// erase scope A; the legacy v1 record migrates only its explicit `scopeKey`.
// A restore re-reads the original Goal/Session through the formal owner reads
// (not a chat/DTO store) and a slow response can never overwrite a later user
// choice. Both cases are EXPECTED RED until Stage 2 implements the seam.
describe('MVP UI scope display preference', () => {
  const memoryStorage = (): DisplayPreferenceStorage & { keys: () => string[] } => {
    const entries = new Map<string, string>();
    return {
      get: key => entries.get(key) ?? null,
      set: (key, value) => { entries.set(key, value); },
      keys: () => [...entries.keys()],
    };
  };

  const scopeA: CoreScope = { projectId: 'scope-preference-project', workspaceId: 'workspace-a' };
  const scopeB: CoreScope = { projectId: 'scope-preference-project', workspaceId: 'workspace-b' };

  it('keeps display ids per scope and migrates only the explicit v1 scopeKey', () => {
    const sharedStorage = memoryStorage();
    const store = createScopeDisplayStore(sharedStorage);
    const otherTab = createScopeDisplayStore(sharedStorage);
    store.save(scopeA, { goalId: 'goal-a', sessionId: 'session-a', mainSessionId: 'main-a' });
    // A second tab switches to B and saves its own ids: A must still be intact.
    otherTab.save(scopeB, { goalId: 'goal-b', sessionId: 'session-b', mainSessionId: 'main-b' });
    // Each scope owns its OWN storage key, never one shared blob.
    const scopeKeys = sharedStorage.keys();
    expect(scopeKeys).toHaveLength(2);
    expect(new Set(scopeKeys).size).toBe(2);
    // Writing the global fields adds only the global key and cannot touch a scope.
    store.writeGlobal({ lastScopeKey: JSON.stringify([scopeB.projectId, scopeB.workspaceId]), theme: 'dark' });
    expect(sharedStorage.keys()).toHaveLength(3);
    expect(sharedStorage.keys()).toEqual(expect.arrayContaining(scopeKeys));
    expect(store.load(scopeA)).toEqual({ goalId: 'goal-a', sessionId: 'session-a', mainSessionId: 'main-a' });
    expect(store.load(scopeB)).toEqual({ goalId: 'goal-b', sessionId: 'session-b', mainSessionId: 'main-b' });
    // Only lastscope/theme are global; no scope's display ids leak into them.
    const global = store.readGlobal();
    expect(global).toEqual({ lastScopeKey: JSON.stringify([scopeB.projectId, scopeB.workspaceId]), theme: 'dark' });
    expect(JSON.stringify(global)).not.toContain('goal-a');

    // The legacy v1 record migrates ONLY the scope named by its explicit scopeKey,
    // and its lastscope/theme migrate into the separate global key.
    const legacy = memoryStorage();
    legacy.set(DISPLAY_PREFERENCE_V1_KEY, JSON.stringify({
      scopeKey: JSON.stringify([scopeA.projectId, scopeA.workspaceId]),
      goalId: 'legacy-goal', sessionId: 'legacy-session', mainSessionId: 'legacy-main', theme: 'dark',
    }));
    const migrated = createScopeDisplayStore(legacy);
    expect(migrated.load(scopeA)).toEqual({ goalId: 'legacy-goal', sessionId: 'legacy-session', mainSessionId: 'legacy-main' });
    expect(migrated.load(scopeB)).toEqual({ goalId: null, sessionId: null, mainSessionId: null });
    // Old ids landed on exactly ONE scope key; B got nothing.
    expect(legacy.keys().filter(key => key !== DISPLAY_PREFERENCE_V1_KEY)).toHaveLength(1);
    expect(migrated.readGlobal()).toEqual({ lastScopeKey: JSON.stringify([scopeA.projectId, scopeA.workspaceId]), theme: 'dark' });
  });

  it('restores the original Goal/Session facts from formal reads and lets no slow read overwrite a later choice', async () => {
    const store = createScopeDisplayStore(memoryStorage());
    store.save(scopeA, { goalId: 'goal-original', sessionId: 'session-original', mainSessionId: 'main-original' });

    // The formal reads return the real owner facts; the Goal FACT is restored,
    // not only the form id, and no id is fabricated when the owner has none.
    const calls: string[] = [];
    const readyRead: ScopeDisplayReadPort = {
      readGoal: async goalId => {
        calls.push(`goals/read:${goalId}`);
        return goalId === 'goal-original'
          ? { status: 'ready', value: { goal: { ref: { aggregateType: 'Goal', projectId: scopeA.projectId, goalId }, workspace: scopeA, objective: 'restored objective fact' }, pendingPlan: null } }
          : null;
      },
      readSession: async sessionId => {
        calls.push(`sessions/read:${sessionId}`);
        return { status: 'ready', value: { record: { ref: { aggregateType: 'Session', projectId: scopeA.projectId, sessionId }, workspace: scopeA }, availability: 'idle', links: [], recommendationReasons: [] } };
      },
    };
    const restored = await store.restore(scopeA, readyRead);
    expect(restored).toMatchObject({ goalId: 'goal-original', sessionId: 'session-original', mainSessionId: 'main-original' });
    expect(restored?.goalRead).toMatchObject({ value: { goal: { objective: 'restored objective fact' } } });
    expect(calls).toContain('goals/read:goal-original');
    expect(calls).toContain('sessions/read:session-original');
    expect(calls).toContain('sessions/read:main-original');
    // A restore is not a selection: active + main are retained together and the
    // persisted preference is left exactly as saved.
    expect(store.load(scopeA)).toEqual({ goalId: 'goal-original', sessionId: 'session-original', mainSessionId: 'main-original' });

    // A missing/mismatched formal read is never faked into a success.
    store.save(scopeA, { goalId: 'goal-missing', sessionId: null, mainSessionId: null });
    const missing = await store.restore(scopeA, { readGoal: async () => null, readSession: async () => null });
    expect(missing).toBeNull();

    // A slow restore for the ORIGINAL ids must not overwrite a later choice.
    store.save(scopeA, { goalId: 'goal-original', sessionId: 'session-original', mainSessionId: 'main-original' });
    let releaseGoal!: (value: { status: 'ready'; value: unknown }) => void;
    const slowGoal = new Promise<{ status: 'ready'; value: unknown }>(resolve => { releaseGoal = resolve; });
    const pending = store.restore(scopeA, {
      readGoal: () => slowGoal,
      readSession: async sessionId => ({ status: 'ready', value: { record: { ref: { aggregateType: 'Session', projectId: scopeA.projectId, sessionId }, workspace: scopeA }, availability: 'idle', links: [], recommendationReasons: [] } }),
    });
    // The user picks a newer Goal/Session while the slow read is still open.
    store.save(scopeA, { goalId: 'goal-newer', sessionId: 'session-newer', mainSessionId: null });
    releaseGoal({ status: 'ready', value: { goal: { ref: { aggregateType: 'Goal', projectId: scopeA.projectId, goalId: 'goal-original' }, workspace: scopeA, objective: 'restored objective fact' }, pendingPlan: null } });
    expect(await pending).toBeNull();
    expect(store.load(scopeA)).toEqual({ goalId: 'goal-newer', sessionId: 'session-newer', mainSessionId: null });
  });
});

// Stage-two contract for the decoupled directory inventory: the ordinary file
// tree keeps its OWN local projection per exact scope+prefix. The real
// `ensureDirectory` entry freezes scope+prefix+generation, so a stale
// same-prefix refresh cannot land, a new prefix gets its own list, and only a
// failure keeps the previous list - flagged stale under its own prefix.
// "Show more" is local: it appends the next 100 and issues no request.
describe('MVP UI directory inventory local projection', () => {
  it('appends locally, keeps scope+prefix attribution and lets only the newest refresh land', async () => {
    const inventoryScope: CoreScope = { projectId: 'directory-inventory-project', workspaceId: 'workspace-a' };
    const directories = new Map<string, DirectoryInventoryState>();
    const paths = Array.from({ length: 250 }, (_, index) => `src/f${String(index).padStart(3, '0')}.txt`);
    const calls: { prefix: string; generation: number }[] = [];
    const pendingReplies = new Map<string, (reply: DirectoryInventoryReply) => void>();
    const send: DirectoryInventorySend = request => {
      calls.push({ prefix: request.prefix, generation: request.generation });
      return new Promise(resolve => { pendingReplies.set(`${request.prefix}@${request.generation}`, resolve); });
    };

    // A NEW prefix list is created and attributed to its exact scope+prefix.
    const rootPending = ensureDirectory(directories, inventoryScope, 'src', false, send);
    expect(directories.get('src')?.loading).toBe(true);
    pendingReplies.get('src@1')?.({ status: 'ready', value: { paths, partial: true } });
    const first = await rootPending;
    expect(first).toMatchObject({ scope: inventoryScope, prefix: 'src', partial: true, loading: false, stale: false });
    expect(first?.paths).toHaveLength(250);
    expect(first?.visibleCount).toBe(DIRECTORY_INVENTORY_PAGE_SIZE);

    // "Show more" is LOCAL: it appends the next 100 rows and issues NO request.
    const more = showMoreDirectoryInventory(first!);
    expect(more.visibleCount).toBe(2 * DIRECTORY_INVENTORY_PAGE_SIZE);
    expect(more.paths.slice(0, DIRECTORY_INVENTORY_PAGE_SIZE)).toEqual(paths.slice(0, DIRECTORY_INVENTORY_PAGE_SIZE));
    expect(calls).toHaveLength(1);

    // A different prefix opens an INDEPENDENT list; the old prefix is untouched.
    const docsPending = ensureDirectory(directories, inventoryScope, 'docs', false, send);
    pendingReplies.get('docs@1')?.({ status: 'ready', value: { paths: ['docs/readme.md'], partial: false } });
    const docs = await docsPending;
    expect(docs?.paths).toEqual(['docs/readme.md']);
    expect(directories.get('src')?.paths).toHaveLength(250);

    // Same-prefix refresh: the OLDER in-flight reply must not land after a newer
    // generation has already settled.
    const slow = ensureDirectory(directories, inventoryScope, 'src', true, send);
    const fast = ensureDirectory(directories, inventoryScope, 'src', true, send);
    expect(calls.filter(call => call.prefix === 'src').map(call => call.generation)).toEqual([1, 2, 3]);
    pendingReplies.get('src@3')?.({ status: 'ready', value: { paths: ['src/new.txt'], partial: false } });
    expect((await fast)?.paths).toEqual(['src/new.txt']);
    pendingReplies.get('src@2')?.({ status: 'ready', value: { paths: ['src/stale.txt'], partial: false } });
    expect((await slow)?.paths).toEqual(['src/new.txt']);
    expect(directories.get('src')?.paths).toEqual(['src/new.txt']);

    // Only a FAILURE keeps the previous list, marked stale under its own prefix.
    const failed = ensureDirectory(directories, inventoryScope, 'src', true, send);
    pendingReplies.get('src@4')?.({ status: 'rejected', code: 'unavailable', reason: 'boom' });
    const kept = await failed;
    expect(kept).toMatchObject({ prefix: 'src', error: 'boom', stale: true, loading: false });
    expect(kept?.paths).toEqual(['src/new.txt']);
    expect(directories.get('docs')?.paths).toEqual(['docs/readme.md']);

    // A ready reply with ZERO paths but partial=true is an INCOMPLETE listing,
    // never an empty directory.
    const emptyPartialPending = ensureDirectory(directories, inventoryScope, 'empty-partial', false, send);
    pendingReplies.get('empty-partial@1')?.({ status: 'ready', value: { paths: [], partial: true } });
    const emptyPartial = await emptyPartialPending;
    expect(emptyPartial).toMatchObject({ prefix: 'empty-partial', paths: [], partial: true, loading: false, stale: false });
  });
});
