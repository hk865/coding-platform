/**
 * MVP UI connection — HTTP entry seam.
 *
 * Stage one proves the seven new suffixes are published on the SAME per-instance
 * token / same-origin boundary as every other Host route, that `files/compare`
 * forwards the EXISTING WorkspaceToolsPort.compareWorkspace, and that the
 * Host workbench-tools default (no writePrefixes, no allowCommands) denies the
 * save/command routes.
 *
 * The old browser workbench is gone (2026-10-20); these rows cover the Host
 * routes it used, reached over the real HTTP boundary.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { CORE_ROUTE_SPECS } from '../../src/app/core-routes.js';
import {
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  type CoreScope,
} from '../../src/app/core-http-types.js';
import { PLATFORM_TOKEN_META_NAME, writeHostPage } from '../helpers/host-page.js';
import { EXPECTED_ROUTE_ROWS, MVP_UI_ROUTES } from '../helpers/S6B3-route-suffixes.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';

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
  await writeHostPage(publicDir);
});

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
    for (const suffix of MVP_UI_ROUTES) {
      expect(CORE_ROUTE_SPECS[suffix], suffix).toEqual(EXPECTED_ROUTE_ROWS[suffix]);
    }
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
