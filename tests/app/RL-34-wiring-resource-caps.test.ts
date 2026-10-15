/**
 * RL slice row RL-34 (RE2): every construction site is wired to the Host's live
 * resource-cap source and reads `current()` once per command (spec §5.2 RL-34,
 * L13).
 *
 * Builds: the real `createHostSettings` backend over a temporary directory and a
 * mutable holder; the saved value feeds one `ResourceCapSource` handed to the
 * composition root of each chain. The Kernel `ProcessSandbox` is the RL double,
 * which records the `current()` value at every `execute`.
 * Rows: RL-34.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostSettings, type HostSettingsAssembly } from '../../src/app/host-settings.js';
import type { HostSettingsPort } from '../../src/app/host-settings-types.js';
import type { BootstrapResponse } from '../../src/app/core-http-types.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createWorkbenchTools } from '../../src/app/workbench-tools.js';
import { createS2BBe1Platform, type S2BBe1PlatformFixture, type Be1Reply } from '../helpers/S2B-be1-platform-fixture.js';
import { createRLQueryFixture, rlQueryHostCtx, type RLQueryFixture } from '../helpers/RL-query-fixture.js';
import { createR3eEvidenceFixture, type R3eEvidenceFixture } from '../helpers/R3e-evidence-fixture.js';
import { B2_AT } from '../helpers/B2-execution-fixture.js';
import { defaultRLSandboxResult, rlSandbox } from '../helpers/RL-kernel-sandbox-double.js';

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const { mockRLKernelSandboxModule } = await import('../helpers/RL-kernel-sandbox-double.js');
  return await mockRLKernelSandboxModule(importOriginal as never);
});

// The S2B Work fixture builds its own platform without a resource-cap option;
// this per-file wrapper injects the test's holder at the platform root without
// editing that shared fixture.
const injected = vi.hoisted(() => ({
  source: undefined as { current(): { memoryMaxBytes: number; tasksMax: number } } | undefined,
}));
vi.mock('../../src/composition/create-platform.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/composition/create-platform.js')>();
  return { ...actual, createTargetPlatform: (options: Parameters<typeof actual.createTargetPlatform>[0]) =>
    actual.createTargetPlatform({ ...options, ...(injected.source === undefined ? {} : { resourceCaps: injected.source }) }) };
});

const EXPECTED_SAVED = { memoryMaxBytes: 300 * 1_048_576, tasksMax: 100 };
const EXPECTED_SECOND = { memoryMaxBytes: 400 * 1_048_576, tasksMax: 200 };

const assembly: HostSettingsAssembly = {
  listWorkspaces: () => [],
  listProjectIds: () => [],
  secretConfigured: () => false,
  bootstrap: () => ({}) as BootstrapResponse,
  async openWorkspace() { return { status: 'rejected', code: 'unsupported', reason: 'not used by RL-34' }; },
};

type CapSettings = { settings: HostSettingsPort; source: { current(): { memoryMaxBytes: number; tasksMax: number } }; directory: string };

const directories: string[] = [];
const fixtures: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await fixture.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  rlSandbox.reset();
  vi.restoreAllMocks();
});

async function openCapSettings(): Promise<CapSettings> {
  const directory = await mkdtemp(join(tmpdir(), 'rl-34-settings-'));
  directories.push(directory);
  let effective: { memoryMaxBytes: number; tasksMax: number } | undefined;
  const settings = await createHostSettings({ settingsDirectory: directory, assembly },
    { onConfigurationChanged(snapshot) { effective = snapshot.resourceCaps; } });
  const source = {
    current(): { memoryMaxBytes: number; tasksMax: number } {
      if (effective === undefined) throw new Error('RL-34 the resource-cap holder was never installed');
      return effective;
    },
  };
  injected.source = source;
  return { settings, source, directory };
}

async function saveCapSettings(settings: HostSettingsPort, memoryMaxMiB: number, tasksMax: number): Promise<void> {
  const saved = await settings.call('resource-caps/save', { memoryMaxMiB, tasksMax });
  expect(saved.status).toBe('ready');
}

function workShellFixture(replies: readonly Be1Reply[], beforeReply?: Parameters<typeof createS2BBe1Platform>[0]['beforeReply']): Promise<S2BBe1PlatformFixture> {
  return createS2BBe1Platform({ toolNames: ['read', 'shell'], writeScope: ['.'], shell: true,
    scriptedReplies: replies, ...(beforeReply === undefined ? {} : { beforeReply }) });
}

/** Read the persisted prepared manifest through the public material owner. */
async function manifestBody(f: S2BBe1PlatformFixture, prepared: PreparedTaskExecution): Promise<Record<string, unknown>> {
  const read = await f.platform.materials.openArtifact(f.ctx,
    { ref: prepared.envelope.bundleRef, usage: 'historical_explanation' });
  if (read.status !== 'ready') throw new Error('RL-34 the prepared manifest body was not readable');
  return JSON.parse(read.value.body) as Record<string, unknown>;
}

it('RL-34 a saved setting reaches the Work shell and is read as bytes at execute', async () => {
  const caps = await openCapSettings();
  await saveCapSettings(caps.settings, 300, 100);
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: { status: 'none', reason: 'not_configured', text: 'x' } });
  const f = await workShellFixture([
    { kind: 'calls', calls: [{ callId: 'rl34-shell', name: 'shell', args: { command: 'echo rl34' } }] },
    { kind: 'text', text: 'RL-34 shell done' },
  ]);
  fixtures.push(f);
  await f.run('rl34-shell');
  expect(rlSandbox.currentReads.at(-1)).toEqual(EXPECTED_SAVED);
});

it('RL-34 a saved setting reaches the Query read-only command', async () => {
  const caps = await openCapSettings();
  await saveCapSettings(caps.settings, 300, 100);
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: { status: 'none', reason: 'not_configured', text: 'x' } });
  const f = await createRLQueryFixture({ resourceCaps: caps.source,
    replies: [{ kind: 'calls', calls: [{ callId: 'rl34-query', name: 'run_readonly_command', args: { command: 'ls' } }] },
      { kind: 'text', text: 'RL-34 query done' }] });
  fixtures.push(f);
  await f.run();
  expect(rlSandbox.currentReads.at(-1)).toEqual(EXPECTED_SAVED);
});

it('RL-34 a saved setting reaches an empty-write Work read-only command', async () => {
  const caps = await openCapSettings();
  await saveCapSettings(caps.settings, 300, 100);
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: { status: 'none', reason: 'not_configured', text: 'x' } });
  const f = await createS2BBe1Platform({ toolNames: ['read', 'run_readonly_command'], writeScope: [], readonlyCommands: true,
    scriptedReplies: [{ kind: 'calls', calls: [{ callId: 'rl34-work-ro', name: 'run_readonly_command', args: { command: 'ls' } }] },
      { kind: 'text', text: 'RL-34 work readonly done' }] });
  fixtures.push(f);
  await f.run('rl34-work-ro');
  expect(rlSandbox.currentReads.at(-1)).toEqual(EXPECTED_SAVED);
});

it('RL-34 a saved setting reaches the registered check', async () => {
  const caps = await openCapSettings();
  await saveCapSettings(caps.settings, 300, 100);
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: { status: 'none', reason: 'not_configured', text: 'x' } });
  const fixture = await createR3eEvidenceFixture('sqlite');
  fixtures.push(fixture);
  await fixture.b2.base.closeBackend();
  const platform = await createTargetPlatform({ storage: { kind: 'sqlite', directory: fixture.b2.base.directory },
    workspace: fixture.workspaceHost, checks: fixture.configuration, resourceCaps: caps.source, now: () => B2_AT });
  fixtures.push({ close: () => platform.close() });
  const opened = await platform.evidence.openVerification(fixture.ctx, fixture.openRequest());
  if (opened.status !== 'committed') throw new Error('RL-34 open did not commit');
  await platform.checks.runRegisteredCheck(fixture.ctx, { input: { roundRef: opened.value.ref, checkId: fixture.passCheck.checkId },
    meta: { requestId: 'rl34-check', expected: [{ ref: opened.value.ref, revision: opened.value.revision }] } });
  expect(rlSandbox.currentReads.at(-1)).toEqual(EXPECTED_SAVED);
});

it('RL-34 a saved setting reaches the workbench command page', async () => {
  const caps = await openCapSettings();
  await saveCapSettings(caps.settings, 300, 100);
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: { status: 'none', reason: 'not_configured', text: 'x' } });
  const root = await mkdtemp(join(tmpdir(), 'rl-34-workbench-'));
  directories.push(root);
  const handle = createWorkbenchTools({ workspaces: [{ scope: { projectId: 'rl-34-project', workspaceId: 'rl-34-workspace' },
    root, readPrefixes: ['.'], writePrefixes: ['.'], allowCommands: true }], resourceCaps: caps.source });
  fixtures.push({ close: () => handle.close() });
  const context = { projectId: 'rl-34-project', workspaceId: 'rl-34-workspace',
    principal: { kind: 'host' as const, actor: { kind: 'human' as const, id: 'rl-34-operator' } },
    materialReader: { kind: 'host' as const, projectId: 'rl-34-project', workspaceId: 'rl-34-workspace', actor: { kind: 'human' as const, id: 'rl-34-operator' } },
    signal: new AbortController().signal };
  const started = await handle.tools.startCommand(context, { requestId: 'rl34-workbench', command: 'echo rl34', cwd: '.' });
  if (started.status !== 'ready') throw new Error('RL-34 workbench start failed');
  await expect.poll(async () => {
    const read = await handle.tools.readCommand(context, { commandId: started.value.commandId });
    return read.status === 'ready' ? read.value.state : 'missing';
  }, { timeout: 5_000 }).toBe('settled');
  expect(rlSandbox.currentReads.at(-1)).toEqual(EXPECTED_SAVED);
});

it('RL-34 a Work reads the old value then the new value across two calls and its prepared execution carries no caps', async () => {
  const caps = await openCapSettings();
  await saveCapSettings(caps.settings, 300, 100);
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: { status: 'none', reason: 'not_configured', text: 'x' } });
  let savedSecond = false;
  const f = await workShellFixture([
    { kind: 'calls', calls: [{ callId: 'rl34-first', name: 'shell', args: { command: 'echo first' } }] },
    { kind: 'calls', calls: [{ callId: 'rl34-second', name: 'shell', args: { command: 'echo second' } }] },
    { kind: 'text', text: 'RL-34 two calls done' },
  ], async (_request, index) => {
    if (index === 1 && !savedSecond) {
      savedSecond = true;
      await saveCapSettings(caps.settings, 400, 200);
    }
  });
  fixtures.push(f);
  const prepared = await f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef, requestId: 'rl34-two-prepare' });
  if (prepared.status !== 'ready') throw new Error('RL-34 two-call prepare failed');
  expect(JSON.stringify(prepared.value)).not.toContain('resourceCaps');
  const started = await f.platform.runtime.startRun(f.ctx, { prepared: prepared.value, consumerId: 'rl34-two-consumer', requestId: 'rl34-two-start' });
  if (started.status !== 'ready') throw new Error('RL-34 two-call start failed');
  expect(rlSandbox.currentReads).toEqual([EXPECTED_SAVED, EXPECTED_SECOND]);
});

it('RL-34 caps enter no prepared manifest before or after a live save', async () => {
  const caps = await openCapSettings();
  await saveCapSettings(caps.settings, 300, 100);
  rlSandbox.next = () => defaultRLSandboxResult({ resourceCaps: { status: 'none', reason: 'not_configured', text: 'x' } });
  const f = await createS2BBe1Platform({
    taskIds: ['implement-a', 'implement-b'],
    toolNames: ['read', 'shell'], writeScope: ['.'], shell: true,
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'rl34-rev-a', name: 'shell', args: { command: 'echo a' } }] },
      { kind: 'text', text: 'RL-34 rev a done' },
      { kind: 'calls', calls: [{ callId: 'rl34-rev-b', name: 'shell', args: { command: 'echo b' } }] },
      { kind: 'text', text: 'RL-34 rev b done' },
    ],
  });
  fixtures.push(f);

  // Before the save: prepare Run 0; the product-written manifest carries no caps.
  const before = await f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runs[0]!.ref, requestId: 'rl34-rev-before' });
  if (before.status !== 'ready') throw new Error('RL-34 revision-before prepare failed');
  const bodyBefore = await manifestBody(f, before.value);
  expect(JSON.stringify(bodyBefore)).not.toContain('resourceCaps');
  const startedBefore = await f.platform.runtime.startRun(f.ctx, { prepared: before.value,
    consumerId: 'rl34-rev-a', requestId: 'rl34-rev-a-start' });
  if (startedBefore.status !== 'ready') throw new Error('RL-34 revision Run A failed');

  // The live save between commands updates the holder only.
  await saveCapSettings(caps.settings, 400, 200);

  // After the save: prepare Run 1; the caps still enter no prepared manifest.
  const after = await f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runs[1]!.ref, requestId: 'rl34-rev-after' });
  if (after.status !== 'ready') throw new Error('RL-34 revision-after prepare failed');
  const bodyAfter = await manifestBody(f, after.value);
  expect(JSON.stringify(bodyAfter)).not.toContain('resourceCaps');
  // Run A read the pre-save value; the live mid-run read is covered by the
  // preceding two-call case.
  expect(rlSandbox.currentReads).toEqual([EXPECTED_SAVED]);
});
