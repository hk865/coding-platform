/**
 * Shared real-Host fixture for the `runtime/capabilities` route tests
 * (A2-runtime-capabilities, K-R-runtime-capabilities): a Host over SQLite whose
 * workspace has a configured Kernel store, a minimal index page that only
 * carries the per-instance token, and the public capability read.
 *
 * Each caller keeps its own scope, adapter id/storeKey, workspace name, clock and
 * directory prefixes; this file owns only the temporary-directory tracking, the
 * Host start-up and the capability read, so both tests exercise the same
 * construction instead of two copied ones.
 */
import { expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import {
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  type CoreScope,
  type RuntimeCapabilities,
  type RuntimeCapabilitiesResponse,
} from '../../src/app/core-http-types.js';
import { PLATFORM_TOKEN_META_NAME } from './host-page.js';

export type RuntimeCapabilitiesHostPaths = { publicDir: string; root: string; database: string };
export type StartedRuntimeCapabilitiesHost = { host: LocalWorkbenchHost; origin: string; token: string };

export type RuntimeCapabilitiesFixtureOptions = {
  scope: CoreScope;
  adapterId: string;
  actorId: string;
  workspaceName: string;
  storeKey: string;
  now(): string;
};

export type RuntimeCapabilitiesFixture = {
  directory(prefix: string): Promise<string>;
  startHost(paths: RuntimeCapabilitiesHostPaths): Promise<StartedRuntimeCapabilitiesHost>;
  readCapabilities(origin: string, token: string): Promise<RuntimeCapabilities>;
  cleanup(): Promise<void>;
};

export function createRuntimeCapabilitiesFixture(options: RuntimeCapabilitiesFixtureOptions): RuntimeCapabilitiesFixture {
  const temporary: string[] = [];
  const hosts: LocalWorkbenchHost[] = [];
  async function directory(prefix: string): Promise<string> {
    const created = await mkdtemp(join(tmpdir(), prefix));
    temporary.push(created);
    return created;
  }

  /** A real Host over SQLite whose workspace has a configured Kernel store; the
   * page is a minimal index that only carries the per-instance token. */
  async function startHost(paths: RuntimeCapabilitiesHostPaths): Promise<StartedRuntimeCapabilitiesHost> {
    const host = await createLocalWorkbenchHost({
      storage: { kind: 'sqlite', directory: paths.database },
      actor: { kind: 'human', id: options.actorId },
      publicDir: paths.publicDir,
      now: options.now,
      workspaces: [{ scope: options.scope, name: options.workspaceName, root: paths.root, workspaceRevision: 1, readPrefixes: ['.'] }],
      kernelStores: { entries: [{ adapterId: options.adapterId, storeKey: options.storeKey, workspace: options.scope,
        databasePath: join(paths.database, 'kernel.sqlite') }] },
    });
    hosts.push(host);
    const address = await host.listen(0);
    const page = await (await fetch(address.url)).text();
    const token = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(page)?.[1];
    if (token === undefined) throw new Error('the page did not carry the token');
    return { host, origin: `http://${address.host}:${address.port}`, token };
  }

  async function readCapabilities(origin: string, token: string): Promise<RuntimeCapabilities> {
    const response = await fetch(new URL(`${CORE_API_PREFIX}runtime/capabilities`, origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
      body: JSON.stringify({ scope: options.scope, input: options.scope }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as RuntimeCapabilitiesResponse;
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('the capability report must be ready');
    return result.value;
  }

  async function cleanup(): Promise<void> {
    for (const host of hosts.splice(0)) await host.close().catch(() => undefined);
    for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
  }

  return { directory, startHost, readCapabilities, cleanup };
}
