/**
 * Group R, row KA-17 (spec §5.1 KE?; §5.2 KA-17; L11, §9 M6): the capability
 * report read over the Host route says, for `continueHistory`, that a Work line
 * closes its dangling Kernel Turn and continues in the SAME Session, that a
 * Query line continues in a NEW Session, and it lists the L8 fallbacks; the
 * `recoverRun` and `safePointPause` reasons carry the M6 replacement sentences.
 * It never claims a resume of the original execution.
 *
 * This test lives at the same entry the frozen `tests/app/A2-runtime-capabilities.test.ts`
 * uses (`runtime/capabilities` over the real Host). It is the group R copy of the
 * KA-17 assertions and never edits the frozen file.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import {
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_PLACEHOLDER,
  type CoreScope,
  type RuntimeCapabilities,
  type RuntimeCapabilitiesResponse,
} from '../../src/app/core-http-types.js';
import { UI_PLATFORM_TOKEN_META_NAME } from '../../src/ui/api/protocol.js';

const at = '2026-10-14T00:00:00.000Z';
const scope: CoreScope = { projectId: 'ka17-project', workspaceId: 'ka17-workspace' };
const adapterId = 'ka17-kernel';

const temporary: string[] = [];
const hosts: LocalWorkbenchHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close().catch(() => undefined);
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function directory(prefix: string): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(created);
  return created;
}

async function startHost(paths: { publicDir: string; root: string; database: string }): Promise<{ host: LocalWorkbenchHost; origin: string; token: string }> {
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: paths.database },
    actor: { kind: 'human', id: 'ka17-operator' },
    publicDir: paths.publicDir,
    now: () => at,
    workspaces: [{ scope, name: 'KA-17 workspace', root: paths.root, workspaceRevision: 1, readPrefixes: ['.'] }],
    kernelStores: { entries: [{ adapterId, storeKey: 'ka17-store', workspace: scope,
      databasePath: join(paths.database, 'kernel.sqlite') }] },
  });
  hosts.push(host);
  const address = await host.listen(0);
  const page = await (await fetch(address.url)).text();
  const token = new RegExp(`<meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(page)?.[1];
  if (token === undefined) throw new Error('the page did not carry the token');
  return { host, origin: `http://${address.host}:${address.port}`, token };
}

async function readCapabilities(origin: string, token: string): Promise<RuntimeCapabilities> {
  const response = await fetch(new URL(`${CORE_API_PREFIX}runtime/capabilities`, origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify({ scope, input: scope }),
  });
  expect(response.status).toBe(200);
  const result = await response.json() as RuntimeCapabilitiesResponse;
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('the capability report must be ready');
  return result.value;
}

it('KA-17 reports that a Work line continues in the same Session after the platform closes its dangling Kernel Turn, a Query line in a new Session, and lists the L8 fallbacks', async () => {
  const paths = {
    publicDir: await directory('ka17-public-'),
    root: await directory('ka17-ws-'),
    database: await directory('ka17-db-'),
  };
  await writeFile(join(paths.publicDir, 'index.html'),
    `<!doctype html><meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  const host = await startHost(paths);
  const report = await readCapabilities(host.origin, host.token);

  // L11, M6: the closure is named, for a Work line, by maintenance and by the
  // Workflow (a person or the Goal continues a paused-interrupted Run).
  const reason = report.continueHistory.reason;
  expect(reason).toContain('a continuation is a new Run, never a resume of the original Turn');
  expect(reason).toContain('For a Work line the platform closes it as interrupted: the Session maintenance does so after a clean interruption, a stop by a queued cancel or a person\'s attestation, and the Workflow does so when a person, or the Goal, continues a paused-interrupted Run.');
  // Rule 1: the closure never resumes the Turn and never invents a tool result.
  expect(reason).toContain('The closure never resumes the interrupted Turn and never invents a result for an unfinished tool call');
  // The closure makes the Session available and the continuation is a new Run in
  // the same Session, whose model history holds the completed Turns before the
  // interrupted one; accepted facts reach it only through the continuation brief.
  expect(reason).toContain('the Session becomes available again and the continuation is a new Run in the same Session');
  expect(reason).toContain('whose model history holds the completed Turns before the interrupted one, while what the interrupted Turn had accepted reaches it only through the continuation brief');
  // L8 fallbacks and the Query line: a new Session.
  expect(reason).toContain('When the closure is not possible (only the legacy Kernel reader, another Kernel adapter, a Kernel that cannot close a Turn, an unreadable Kernel store, or another Run at the Kernel head), and for a Query line, whose open Turn is not closed, the continuation is a new Run in a new Session');
  expect(reason).toContain('otherwise the brief alone');
  // M6: the report never claims a resume of the original execution.
  expect(reason).not.toContain('resumes the original Turn');
  expect(reason).not.toContain('恢复原执行');

  // M6: the recoverRun and safePointPause replacement sentences.
  expect(report.recoverRun.reason).toContain('The continuation of an interrupted Run is a new Run with a continuation brief: for a Work line, after the platform closes its dangling Kernel Turn as interrupted, in the same Session; when that closure is not possible, in a new Session that continues the original Session\'s last completed history (see continueHistory).');
  expect(report.safePointPause.reason).toContain('(a new continuation Run, in the same Session once the platform has closed the dangling Kernel Turn, otherwise in a new Session)');
  expect(report.safePointPause.reason).not.toContain('(a new continuation Run in a new Session)');

  // Slice K L1/M4: the Kernel session API version is 3.
  expect(report.kernelSessionApiVersion).toBe(3);
});
