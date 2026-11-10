/**
 * KLS-1b rows 05 and 05b: the one change stream carries each commit's project
 * and that project store's own cursor under the Host's own sequence id, and a
 * resume answers one merged change per missed project.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BOOTSTRAP_SUFFIX, CORE_API_PREFIX, PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { cleanupRestart, publicDirectory, tempDir } from '../helpers/A2-restart-fixture.js';
import { corePost, graphWrite, readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import { openChangeStream } from '../helpers/change-stream-reader.js';

const A: CoreScope = { projectId: 'kls1b-a', workspaceId: 'kls1b-a-ws' };
const B: CoreScope = { projectId: 'kls1b-b', workspaceId: 'kls1b-b-ws' };
const h = (k: number): string => `h${String(k).padStart(10, '0')}`;

let host: LocalWorkbenchHost | undefined;

afterEach(async () => {
  await host?.close();
  host = undefined;
  await cleanupRestart();
});

async function startFeedHost(backend: 'memory' | 'sqlite') {
  const rootA = await tempDir('kls1b-05-a-');
  const rootB = await tempDir('kls1b-05-b-');
  const storage = backend === 'sqlite'
    ? { kind: 'sqlite' as const, directory: await tempDir('kls1b-05-db-') }
    : { kind: 'memory' as const };
  host = await createLocalWorkbenchHost({
    storage,
    actor: { kind: 'human', id: 'kls1b-05' },
    publicDir: await publicDirectory(),
    workspaces: [
      { scope: A, name: 'kls1b-a-ws', root: rootA, workspaceRevision: 1, readPrefixes: ['.'] },
      { scope: B, name: 'kls1b-b-ws', root: rootB, workspaceRevision: 1, readPrefixes: ['.'] },
    ],
  });
  const address = await host.listen(0);
  const token = await readPageToken(address.url);
  return { origin: address.url, token };
}

async function bootstrapHead(origin: string, token: string): Promise<string | null> {
  const response = await fetch(new URL(CORE_API_PREFIX + BOOTSTRAP_SUFFIX, origin), {
    headers: { [PLATFORM_TOKEN_HEADER]: token },
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { changesHead?: string | null };
  return body.changesHead ?? null;
}

async function createProject(origin: string, token: string, scope: CoreScope, requestId: string):
Promise<{ status: string; cursor: string }> {
  const response = await corePost(origin, 'projects/create', token, graphWrite(scope, { projectId: scope.projectId },
    requestId, [{ ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: 0 }]));
  expect(response.status).toBe(200);
  const body = await response.json() as { status: string; cursor: string };
  expect(body.status).toBe('committed');
  return body;
}

async function installPolicy(origin: string, token: string, scope: CoreScope, requestId: string):
Promise<{ status: string; cursor: string }> {
  const response = await corePost(origin, 'completion-policies/install', token, graphWrite(scope, {
    policyId: 'kls1b-05b', contentRevision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
  }, requestId, [
    { ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: 1 },
    { ref: { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: 'kls1b-05b', revision: 1 },
      revision: 0 },
  ]));
  expect(response.status).toBe(200);
  const body = await response.json() as { status: string; cursor: string };
  expect(body.status).toBe('committed');
  return body;
}

describe('KLS-1b change feed per project', () => {
  it.each(['memory', 'sqlite'] as const)('05 stamps the Host id, the project and that project store cursor (%s)', async backend => {
    const { origin, token } = await startFeedHost(backend);
    const head = await bootstrapHead(origin, token);
    const n = head === null ? 0 : Number(head.slice(1));
    const stream = await openChangeStream(origin, token, head ?? undefined);
    try {
      expect(await stream.nextEvent()).toEqual({ comment: false, event: 'ready', id: head, data: { cursor: head } });

      const b = await createProject(origin, token, B, 'kls1b-05-b');
      expect(await stream.nextEvent()).toEqual({ comment: false, event: 'change', id: h(n + 1),
        data: { projectId: 'kls1b-b', cursor: b.cursor, kinds: ['project'], projects: ['kls1b-b'] } });

      const a = await createProject(origin, token, A, 'kls1b-05-a');
      expect(await stream.nextEvent()).toEqual({ comment: false, event: 'change', id: h(n + 2),
        data: { projectId: 'kls1b-a', cursor: a.cursor, kinds: ['project'], projects: ['kls1b-a'] } });
    } finally {
      stream.abort();
    }
  }, 60_000);

  it('05b answers one merged change per missed project on resume (memory)', async () => {
    const { origin, token } = await startFeedHost('memory');
    await createProject(origin, token, B, 'kls1b-05b-b-first');
    const head = await bootstrapHead(origin, token);
    expect(head).not.toBeNull();
    const n = Number(head!.slice(1));

    await createProject(origin, token, A, 'kls1b-05b-a-project');
    const aPolicy = await installPolicy(origin, token, A, 'kls1b-05b-a-policy');
    const bPolicy = await installPolicy(origin, token, B, 'kls1b-05b-b-policy');

    const stream = await openChangeStream(origin, token, head!);
    try {
      expect(await stream.nextEvent()).toEqual({ comment: false, event: 'change', id: h(n + 2),
        data: { projectId: 'kls1b-a', cursor: aPolicy.cursor, kinds: ['project'], projects: ['kls1b-a'] } });
      expect(await stream.nextEvent()).toEqual({ comment: false, event: 'change', id: h(n + 3),
        data: { projectId: 'kls1b-b', cursor: bPolicy.cursor, kinds: ['project'], projects: ['kls1b-b'] } });
    } finally {
      stream.abort();
    }
  }, 60_000);
});
