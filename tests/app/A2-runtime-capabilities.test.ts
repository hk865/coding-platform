/**
 * A.2 step 5.2 through the real Host (docs/refactor/STATE-MACHINES-SPEC.md
 * §7.7, D-15, lead decision LA-1): the workspace-level Runtime capability
 * report read over HTTP from `runtime/capabilities` on a SQLite ledger with a
 * registered Kernel store.
 *
 * `continueHistory`, `safePointPause` and `cancel` are supported, and each
 * reason states the boundary of that support as it holds today (D-15): a
 * continuation is a new Run, never a resume of the original Turn, and a Session
 * whose last Kernel Turn has no terminal takes no new Turn; a pause or cancel of
 * a Run that never entered is the platform's own (step 5.1 proves that
 * behaviour in tests/composition/A2-control-platform.test.ts); a cancel of a Run
 * paused at a safe point cannot be delivered yet; a Query has no control.
 * `recoverRun` stays unsupported until step 5.7. The §7.7 target boundaries
 * that later substeps build (5.4 continuation brief; 5.6 new Session after an
 * open Kernel Turn, restart rebuild, paused-interrupted, paused stop, restart
 * stop) add their phrases here in those substeps. Every item has its own reason
 * (no shared placeholder), and the report is the same after the Host reopens
 * the ledger.
 *
 * No model is called and no Run is started: the report is a declaration.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import {
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_META_NAME,
  PLATFORM_TOKEN_PLACEHOLDER,
  type CoreScope,
  type RuntimeCapabilities,
  type RuntimeCapabilitiesResponse,
} from '../../src/app/core-http-types.js';

const at = '2026-10-05T00:00:00.000Z';
const scope: CoreScope = { projectId: 'a2-capabilities-project', workspaceId: 'a2-capabilities-workspace' };
const adapterId = 'a2-capabilities-kernel';

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

/** A real Host over SQLite whose workspace has a configured Kernel store; the
 * page is a minimal index that only carries the per-instance token. */
async function startHost(paths: { publicDir: string; root: string; database: string }): Promise<{ host: LocalWorkbenchHost; origin: string; token: string }> {
  const host = await createLocalWorkbenchHost({
    storage: { kind: 'sqlite', directory: paths.database },
    actor: { kind: 'human', id: 'a2-capabilities-operator' },
    publicDir: paths.publicDir,
    now: () => at,
    workspaces: [{ scope, name: 'A2 capabilities workspace', root: paths.root, workspaceRevision: 1, readPrefixes: ['.'] }],
    kernelStores: { entries: [{ adapterId, storeKey: 'a2-capabilities-store', workspace: scope,
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
    body: JSON.stringify({ scope, input: scope }),
  });
  expect(response.status).toBe(200);
  const result = await response.json() as RuntimeCapabilitiesResponse;
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('the capability report must be ready');
  return result.value;
}

function expectAllIn(reason: string, phrases: readonly string[]): void {
  for (const phrase of phrases) expect(reason, phrase).toContain(phrase);
}

it('reports continuation, safe-point pause and cancel as supported with their boundaries over the Host route', async () => {
  const paths = {
    publicDir: await directory('a2-capabilities-public-'),
    root: await directory('a2-capabilities-ws-'),
    database: await directory('a2-capabilities-db-'),
  };
  await writeFile(join(paths.publicDir, 'index.html'),
    `<!doctype html><meta name="${PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  const first = await startHost(paths);
  const report = await readCapabilities(first.origin, first.token);

  expect(report).toMatchObject({
    adapterId,
    createSession: { supported: true }, readHistory: { supported: true },
    continueHistory: { supported: true }, safePointPause: { supported: true }, cancel: { supported: true },
    // Step 5.7 reports start-up reconciliation; nothing else changes in A.2.
    recoverRun: { supported: false },
    nativeCompact: { supported: false }, scopedWorkspaceWrites: { supported: false },
  });
  expect([1, 2]).toContain(report.kernelSessionApiVersion);

  // LA-1: a continuation is a new Run, never the original Turn; with a Kernel
  // terminal it continues in the same Session (including the yielded successor),
  // and the frozen Kernel takes no new Turn in a Session whose last Turn is open.
  expectAllIn(report.continueHistory.reason, [
    'a continuation is a new Run, never a resume of the original Turn',
    'has a Kernel terminal, a new Run in the same Session continues its history',
    'the successor Run after a yielded wait',
    'has no Kernel terminal',
    'the Kernel refuses a new Turn in that Session and no continuation is offered',
  ]);
  // §7.7 safePointPause as it holds today: live handle at a safe point, D-7 for
  // a Run that never entered, no restart reconciliation yet, D-11.
  expectAllIn(report.safePointPause.reason, [
    'pauses through its live handle at the next safe point (before a model call or between tool groups)',
    'a resume re-enters the original Turn',
    'has not entered the Kernel is paused and resumed by the platform at once',
    'not reconciled after a Host restart (see recoverRun)',
    'A Query cannot be paused',
  ]);
  // §7.7 cancel as it holds today: live handle with the pending stop request,
  // D-7, the undeliverable cancel of a paused Run (§7.3 case 3), the
  // yielded-wait fence, and no Query control (§7.3 case 1, GAP-06).
  expectAllIn(report.cancel.reason, [
    'cancelled through its live handle',
    'pending stop request until the Run\'s stop is proved',
    'has not entered the Kernel is cancelled by the platform at once',
    'already paused at a safe point cannot be delivered',
    'only fences its continuation',
    'A Query cannot be cancelled',
    'refused as invalid',
    'there is no QueryJob close',
  ]);
  expect(report.recoverRun.reason).toContain('there is no start-up reconciliation of Runs');
  // D-15: no reason states a §7.7 target boundary before its substep builds it.
  // 5.4 (continuation brief, C3) and 5.6 (new Session after an open Kernel Turn,
  // restart rebuild, paused-interrupted, RUN-14, RD-7, RUN-23, GOAL-29, C7) move
  // their phrases from here into the lists above.
  const notYetBuilt = ['continuation brief', 'new Session', 'kernel_turn_open', 'waiting message',
    'paused-interrupted', 'exit proof', 'whether or not the Kernel paused it', 'resuming the Goal',
    'Task disposition'];
  for (const reason of [report.continueHistory.reason, report.safePointPause.reason, report.cancel.reason]) {
    for (const phrase of notYetBuilt) expect(reason, phrase).not.toContain(phrase);
  }
  // Every item states its own reason; nothing shares one placeholder.
  const items = [report.createSession, report.readHistory, report.continueHistory, report.recoverRun,
    report.safePointPause, report.cancel, report.nativeCompact, report.scopedWorkspaceWrites];
  expect(items.every(item => item.reason.length > 0)).toBe(true);
  expect(new Set(items.map(item => item.reason)).size).toBe(items.length);

  // The report is a declaration over configuration, not state: the reopened
  // Host on the same ledger reports exactly the same.
  await first.host.close();
  const reopened = await startHost(paths);
  expect(await readCapabilities(reopened.origin, reopened.token)).toEqual(report);
});
