/**
 * NET-B NB-12…NB-16, NB-12b (netb-start-rulings §1 table, §2.2 items 1, 5, 9): a real Host in process (SQLite, real
 * bubblewrap) whose commands reach the "public internet" only through the platform proxy. The Host input
 * `networkProvider` (A8; lead ruling NET-B Q7): `pkg.example` resolves to 93.184.216.34, `inner.example` to 127.0.0.1;
 * a dial of 93.184.216.34 lands on this file's stub upstream (`ok-<path>`), other addresses are dialled for real. The
 * startup file is K3-07's (the executor has `shell`) plus `run_readonly_command` for the Query binding, workspace
 * commands on, the check per row. python3 urllib reads the proxy variables; `NO_PROXY` covers `localhost` (SBX §2.4),
 * so NB-13's refused host is `inner.example`. Red today, green after B2: NB-12 and NB-13 tool text '' (no proxy);
 * NB-14 `/usr/bin/node\n`; NB-15 ① round FAIL (no npm), ② a guard row green at run time, red only in typecheck
 * (`networkProvider`); NB-16 stdout ''. Mutations: NB-12 no route for the Query / opened after it ran / the recorder
 * keeps the path (one more field); NB-13 `observed-model-run`'s last hop drops `network` / no address check (the inner
 * listener is reached); NB-14 no `executablePath` / no `lib` mount / toolchain for the read-only command only (②);
 * NB-15 ① check without the toolchain, ② check given network; NB-16 workbench sandbox without `network`; NB-12b
 * `readRunNetwork` without the `subject.projectId !== ctx.projectId` refusal (B reads A's record as `null`).
 */
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { connect, createServer as createTcpServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createLocalWorkbenchHost } from '../../src/app/host.js';
import { loadWorkbenchCliConfig } from '../../src/app/main.js';
import type { CoreScope, QueryRunRef } from '../../src/app/core-http-types.js';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { ProviderRegistry, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_AT, AG2B_SCOPE, AG2B_SECRET_VALUE, AG2B_SECRET_VAR, ag2bChecksConfiguration, claimBusyQuery, corePost,
  createAG2bSession, plain, readPageToken, seedAG2bWorkGraph, startBusyQuery, writeAG2bWorkspace, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import { advanceUntil, cleanupRestart, post, publicDirectory, selectWork, tempDir, workRow } from '../helpers/A2-restart-fixture.js';
import { k307HostConfig } from '../helpers/K3-07-support.js';
import { makeRLWorkspace, removeRLWorkspace, requireRLCapabilities } from '../helpers/RL-resource-caps-support.js';
import { settingsPost } from './support/S8A-L8-host.js';

const servers: Server[] = [];
const sockets: Socket[] = [];
const hosts: AG2bHost[] = [];
async function listen(server: Server): Promise<number> {
  servers.push(server.on('connection', (socket: Socket) => { sockets.push(socket); }));
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  return (server.address() as AddressInfo).port;
}
let stubPort = 0;
beforeAll(async () => {
  const sandbox = await makeRLWorkspace();
  try { await requireRLCapabilities(sandbox); } finally { await removeRLWorkspace(sandbox); }
  stubPort = await listen(createServer((request, response) => { response.end(`ok-${String(request.url).slice(1)}`); }));
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.host.close();
  await cleanupRestart();
});
afterAll(() => { for (const socket of sockets) socket.destroy(); for (const server of servers) server.close(); });

const networkProvider = {
  lookup: async (name: string) => name === 'pkg.example' ? [{ address: '93.184.216.34', family: 4 as const }]
    : name === 'inner.example' ? [{ address: '127.0.0.1', family: 4 as const }] : [],
  dial: (address: string, port: number) => connect({ host: '127.0.0.1', port: address === '93.184.216.34' ? stubPort : port }),
};

async function startNetbHost(over: { replies?: ScriptedReply[]; queryReplies?: ScriptedReply[]; check?: string }): Promise<AG2bHost> {
  const [root, database, configDir, publicDir] = [await tempDir('netb-ws-'), await tempDir('netb-db-'),
    await tempDir('netb-config-'), await publicDirectory()];
  await writeAG2bWorkspace(root);
  const config = k307HostConfig({ database, root });
  const runtime = config['runtime'] as WorkbenchRuntimeConfiguration;
  const actor = config['actor'] as AG2bHost['actor'];
  await writeFile(join(configDir, 'workbench.json'), JSON.stringify({ ...config,
    workspaces: (config['workspaces'] as object[]).map(entry => ({ ...entry, writePrefixes: ['.'], allowCommands: true })),
    runtime: { ...runtime, bindings: runtime.bindings.map(binding => binding.id !== 'ag2b-query-binding' ? binding
      : { ...binding, grant: { ...binding.grant, tools: ['read', 'run_readonly_command'], readonlyCommandAccess: 'all_except_denied' } }) },
    checks: ag2bChecksConfiguration({ actor, command: over.check ?? 'true' }) }));
  const scripted = createScriptedModel(over.replies ?? []);
  const queryScripted = createScriptedModel(over.queryReplies ?? []);
  const registry = new ProviderRegistry().register({
    id: 'deepseek', secretEnvironmentVariable: AG2B_SECRET_VAR, defaultBaseUrl: 'https://invalid.test',
    capabilities: { streaming: true, toolCalls: true, usage: true },
    create: context => context.model.includes('scripted-query') ? queryScripted.client : scripted.client,
  });
  const host = await createLocalWorkbenchHost({ ...await loadWorkbenchCliConfig(join(configDir, 'workbench.json')),
    publicDir, now: () => AG2B_AT, networkProvider,
    runtimeProvider: { registry, secretSource: { get: (name: string) => name === AG2B_SECRET_VAR ? AG2B_SECRET_VALUE : undefined } } });
  const base = (await host.listen()).url;
  const handle: AG2bHost = { host, base, token: await readPageToken(base), root, database, publicDir, actor, scripted, queryScripted };
  hosts.push(handle);
  return handle;
}

const GET = (...urls: string[]): string => `python3 -c 'import sys, urllib.request as r, urllib.error as e
for u in sys.argv[1:]:
 try: print(r.urlopen(u, timeout=10).read().decode())
 except e.HTTPError as x: print(x.code)' ${urls.join(' ')}`;
const call = (name: string, command: string): ScriptedReply => ({ kind: 'calls', calls: [{ callId: 'netb-call', name, args: { command } }] });
const DONE: ScriptedReply = { kind: 'text', text: 'NET-B round done' };
const pkgAllowed = { host: 'pkg.example', port: 80, address: '93.184.216.34', verdict: 'allowed', firstAt: '2026-09-28T00:00:00.000Z' };

/** The text the model was given back for the command call. */
function toolText(requests: readonly ModelRequest[]): string | undefined {
  const message = requests.at(-1)?.messages.find(entry => entry.role === 'tool' && entry.callId === 'netb-call');
  const part = message?.role === 'tool' ? message.result.output.find(entry => entry.kind === 'text') : undefined;
  return part?.kind === 'text' ? part.text : undefined;
}
async function runQuery(host: AG2bHost): Promise<QueryRunRef> {
  await seedAG2bWorkGraph(host);
  const refs = await claimBusyQuery(host, await createAG2bSession(host, 'netb-query-line'), 'netb');
  await startBusyQuery(host, refs, 'netb');
  return refs.queryRunRef;
}
async function runWork(host: AG2bHost): Promise<RunRef> {
  await seedAG2bWorkGraph(host);
  await post(host, 'workflow/advance', plain(AG2B_SCOPE, await advanceUntil(host, selectWork('netb-work'), 'start')));
  const runRef = (await workRow(host)).execution;
  if (runRef === null) throw new Error('the Work Run must be selected');
  return runRef;
}
/** `network/read` answers the whole RunNetwork snapshot (§2.1); the rows compare its `hosts` and `omitted` only. */
async function network(host: AG2bHost, subject: RunRef | QueryRunRef): Promise<{ hosts: unknown; omitted: unknown }> {
  const read = await post<ReadResult<{ hosts: unknown; omitted: unknown } | null>>(host, 'network/read', plain(AG2B_SCOPE, { subject }));
  if (read.status !== 'ready' || read.value === null) throw new Error(`the Run's host record must be readable: ${JSON.stringify(read)}`);
  return { hosts: read.value.hosts, omitted: read.value.omitted };
}

it('NB-12 a Query command reaches the public internet through the proxy and its QueryRun lists the host', async () => {
  const host = await startNetbHost({ queryReplies: [call('run_readonly_command', GET('http://pkg.example/q')), DONE] });
  const queryRunRef = await runQuery(host);
  expect(toolText(host.queryScripted.requests)).toBe('ok-q\n');
  expect(await network(host, queryRunRef)).toEqual({ hosts: [pkgAllowed], omitted: 0 });
}, 120_000);

it('NB-12b network/read refuses another project\'s RunNetwork and the owning project still reads it', async () => {
  const host = await startNetbHost({ queryReplies: [call('run_readonly_command', GET('http://pkg.example/q')), DONE] });
  const queryRunRef = await runQuery(host);
  const secondRoot = await tempDir('netb-cross-project-');
  const opened = await settingsPost(host.base, 'workspaces/open', host.token,
    { path: secondRoot, writeAllowed: false, commandsAllowed: false });
  const openedBody = await opened.json() as { status: string; value?: { scope: CoreScope } };
  if (openedBody.status !== 'ready' || openedBody.value === undefined)
    throw new Error(`the second project did not open: ${JSON.stringify(openedBody)}`);
  const cross = await corePost(host.base, 'network/read', host.token,
    plain(openedBody.value.scope, { subject: queryRunRef }));
  expect(await cross.json()).toEqual({ status: 'rejected', code: 'forbidden', reason: 'the Run belongs to another project' });
  expect(await network(host, queryRunRef)).toEqual({ hosts: [pkgAllowed], omitted: 0 });
}, 120_000);

it('NB-13 an executor shell reaches the internet, is refused a host resolving to loopback, and its Run lists each host once', async () => {
  let innerConnections = 0;
  const innerPort = await listen(createTcpServer(socket => { innerConnections += 1; socket.destroy(); }));
  const host = await startNetbHost({ replies: [call('shell',
    GET('http://pkg.example/w', 'http://pkg.example/w', `http://inner.example:${String(innerPort)}/`)), DONE] });
  const runRef = await runWork(host);
  expect(toolText(host.scripted.requests)).toBe('ok-w\nok-w\n403\n');
  expect(innerConnections).toBe(0);
  expect(await network(host, runRef)).toEqual({ omitted: 0, hosts: [pkgAllowed,
    { host: 'inner.example', port: innerPort, address: '127.0.0.1', verdict: 'refused', firstAt: '2026-09-28T00:00:00.000Z' }] });
}, 120_000);

it.each<[string, 'query' | 'work']>([['① a Query run_readonly_command', 'query'], ['② an executor shell', 'work']])(
  'NB-14 %s runs the Host node first on PATH, with npm beside it', async (_, kind) => {
    const replies = [call(kind === 'query' ? 'run_readonly_command' : 'shell', 'command -v node; npm --version >/dev/null && echo npm-ok'), DONE];
    const host = await startNetbHost(kind === 'query' ? { queryReplies: replies } : { replies });
    if (kind === 'query') await runQuery(host); else await runWork(host);
    expect(toolText((kind === 'query' ? host.queryScripted : host.scripted).requests)).toBe('/opt/agent-toolchain/bin/node\nnpm-ok\n');
  }, 120_000);

it.each<[string]>([['npm --version'], ['test -z "$HTTP_PROXY"']])(
  'NB-15 the registered check `%s` gets the toolchain and no network (coordination: a check judges this workspace version only), so its round passes',
  async (check) => {
    const host = await startNetbHost({ replies: [DONE], check });
    await seedAG2bWorkGraph(host);
    expect(await post<WorkflowAdvanceResult>(host, 'workflow/advance',
      plain(AG2B_SCOPE, await advanceUntil(host, selectWork('netb-15'), 'finalize_checks')))).toMatchObject({ status: 'ready',
      value: { receipt: { kind: 'finalize_checks', result: { status: 'committed', value: { outcome: 'PASS' } } } } });
  }, 120_000);

it('NB-16 a command the person starts on the workbench reaches the public internet', async () => {
  const host = await startNetbHost({});
  const started = await post<ReadResult<{ commandId: string }>>(host, 'commands/start',
    plain(AG2B_SCOPE, { requestId: 'netb-16', command: GET('http://pkg.example/p'), cwd: '.' }));
  if (started.status !== 'ready') throw new Error(`the command must start: ${JSON.stringify(started)}`);
  const read = async () => await post<ReadResult<{ state: string; stdout: string }>>(host, 'commands/read',
    plain(AG2B_SCOPE, { commandId: started.value.commandId }));
  await expect.poll(async () => { const now = await read(); return now.status === 'ready' ? now.value.state : now.status; },
    { timeout: 60_000, interval: 50 }).toBe('settled');
  expect(await read()).toMatchObject({ status: 'ready', value: { stdout: 'ok-p\n' } });
}, 120_000);
