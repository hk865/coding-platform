/**
 * R4.3a composition-root control/delivery wiring tests (stage-1 skeleton).
 *
 * The real `createTargetPlatform` owns ONE raw control service injected into the
 * same Runtime it publishes. This case drives the user-reachable normal cancel
 * chain through the public pair: `platform.controls.submitControl` ->
 * `platform.runtime.deliverControl` -> the real cooperative tool's terminal and
 * cleanup -> `readControl` applied/cancelled -> the original Run terminal and
 * same-generation release. It does not prove the same instance with a self-built
 * Runtime; the platform is the only subject.
 *
 * FINAL behaviour assertions: in this stage `platform.runtime.deliverControl`
 * still returns explicit `unsupported`, so the case stops at the delivery
 * assertion and the cancel/release/no-handle tail is NOT reached.
 *
 * The local Kernel mock is a test-only latency seam that injects ONE cooperative
 * controlled tool. It adds no permission: the real manifest/Host/Role
 * intersection still decides the model's tools.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { B2_AT, createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import {
  toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult,
} from '../../vendor/coding-agent/dist/public-api.js';

const kernelSeam = vi.hoisted(() => ({ tool: null as unknown }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/public-api.js')>();
  return {
    ...actual,
    runCodingAgent: (options: Parameters<typeof actual.runCodingAgent>[0]) => {
      const tool = kernelSeam.tool as ToolDefinition | null;
      if (tool === null) return actual.runCodingAgent(options);
      const config = options.config;
      return actual.runCodingAgent({
        ...options,
        config: { ...config, tools: { ...config.tools, enabledNames: [...config.tools.enabledNames, tool.name] } },
        additionalTools: (workspace) => [...(options.additionalTools?.(workspace) ?? []), tool],
      });
    },
  };
});

const fixtures: B2RuntimeFixture[] = [];
const platforms: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  kernelSeam.tool = null;
  for (const platform of platforms.splice(0).reverse()) await platform.close();
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function successResult(callId: string, text = 'released'): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'success',
    output: [{ kind: 'text', text }],
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
  };
}

/** A real tool that cooperatively cancels on abort; it never hangs the group. */
function cooperativeTool(
  name: string,
  entered: ReturnType<typeof deferred>,
  release: Promise<void>,
): ToolDefinition {
  return {
    name,
    description: 'R4.3a composition cooperative cancel tool',
    inputSchema: z.object({}).loose(),
    effectClass: 'read_only',
    requiredCapabilities: ['workspace_read'],
    defaultTimeoutMs: 60_000,
    outputLimitBytes: 1_024,
    independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: {
      async execute(call: Readonly<ToolCall>, options): Promise<ToolResult> {
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (options.signal.aborted) return resolve();
          options.signal.addEventListener('abort', () => resolve(), { once: true });
          release.then(resolve, resolve);
        });
        return options.signal.aborted
          ? { schemaVersion: 1, callId: call.callId, status: 'cancelled', reason: 'cooperative composition cancel',
              output: [], effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } }
          : successResult(call.callId);
      },
    },
  };
}

async function open(options: Parameters<typeof createB2RuntimeFixture>[0] = {}) {
  const fixture = await createB2RuntimeFixture({ ...options, kind: 'sqlite' });
  fixtures.push(fixture);
  await fixture.claimFixture.closeBackend();
  const platformOptions = {
    storage: { kind: 'sqlite' as const, directory: fixture.directory },
    workspace: fixture.deps.workspaceHost,
    now: () => B2_AT,
    kernelStores: { entries: [{
      adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: fixture.scope, databasePath: join(fixture.directory, 'kernel.sqlite'),
    }] },
    runtime: fixture.host,
  };
  const platform = await createTargetPlatform(platformOptions);
  platforms.push(platform);
  return { fixture, platform };
}

it('cancels a real active single tool through the public controls/runtime pair, releases the original generation and keeps the no-handle/no-writer tail', async () => {
  const entered = deferred();
  const release = deferred();
  kernelSeam.tool = cooperativeTool('r4-composition-cancel-tool', entered, release.promise);
  const { fixture, platform } = await open({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'r4-composition-tool', name: 'r4-composition-cancel-tool', args: {} }] },
    { kind: 'text', text: 'unreachable after the cooperative cancel' },
  ] });

  const prepared = await platform.runtime.prepareExecution(fixture.ctx, {
    runRef: fixture.claim.runRef, requestId: 'r4-composition-cancel-prepare',
  });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = platform.runtime.startRun(fixture.ctx, {
    prepared: prepared.value, consumerId: 'r4-composition-cancel-consumer', requestId: 'r4-composition-cancel-start',
  });
  let intentRef: ControlIntentRef | undefined;
  try {
    const first = await Promise.race([
      entered.promise.then(() => 'tool' as const),
      running.then(() => 'finished' as const),
    ]);
    expect(first, 'the cooperative tool must actually start').toBe('tool');
    if (first !== 'tool') return;

    const pinned = await platform.executions.readExecution(fixture.ctx, fixture.claim.runRef);
    expect(pinned.status).toBe('ready');
    if (pinned.status !== 'ready') return;
    const submitted = await platform.controls.submitControl(fixture.ctx, {
      input: { runRef: fixture.claim.runRef, kind: 'cancel', reason: 'stop the active tool' },
      meta: { requestId: 'r4-composition-cancel-submit',
        expected: [{ ref: fixture.claim.runRef, revision: pinned.value.run.revision }] },
    });
    expect(submitted).toMatchObject({ status: 'committed' });
    if (submitted.status !== 'committed') return;
    intentRef = submitted.value.intent.ref;

    // The public Runtime must deliver the SAME accepted intent to the active
    // driver the platform assembled (same instance), not a second runtime.
    const delivered = await platform.runtime.deliverControl!(fixture.ctx, { intentRef });
    expect(delivered, 'public runtime must deliver the public cancel to the active driver')
      .toMatchObject({ status: 'ready' });
    if (delivered.status !== 'ready') return;

    // This cooperative tool may already have settled by the next read. Accept
    // a still-queued request or the real applied cancellation; the terminal and
    // release assertions below remain mandatory after the original run drains.
    const afterDelivery = await platform.controls.readControl(fixture.ctx, intentRef);
    expect(afterDelivery.status).toBe('ready');
    if (afterDelivery.status === 'ready') {
      expect(['queued', 'applied']).toContain(afterDelivery.value.status);
      if (afterDelivery.value.status === 'applied') {
        expect(afterDelivery.value.observation).toMatchObject({ kind: 'cancelled' });
      }
    }
  } finally {
    release.resolve();
    await running;
  }

  expect(intentRef, 'a committed control ref must be known after the run').toBeDefined();
  if (intentRef === undefined) return;
  const terminal = await platform.executions.readExecution(fixture.ctx, fixture.claim.runRef);
  expect(terminal.status).toBe('ready');
  if (terminal.status !== 'ready') return;
  // The real cooperative cancellation ends the Run and releases the same generation.
  expect(terminal.value.run.status).toBe('ended');
  expect(terminal.value.run.outcome).toBe('cancelled');
  expect(terminal.value.session.occupancy).toBeNull();
  expect(terminal.value.lease?.release).toBeDefined();
  expect(await platform.controls.readControl(fixture.ctx, intentRef))
    .toMatchObject({ status: 'ready', value: { status: 'applied', observation: { kind: 'cancelled' } } });

  // Tail (kept from the original composition case): a queued intent with no
  // matching live handle is preserved without starting recovery, and the
  // internal observation writer stays off the public surface.
  const goalRead = await platform.plans.queryGoal(fixture.ctx, fixture.claimFixture.goalRef);
  expect(goalRead.status).toBe('ready');
  if (goalRead.status !== 'ready') return;
  const sessionCard = await platform.sessions.readSession(fixture.ctx, fixture.claim.sessionRef);
  expect(sessionCard.status).toBe('ready');
  if (sessionCard.status !== 'ready') return;
  const secondClaim = await platform.claims.claimTask(fixture.ctx, {
    meta: { requestId: 'r4-composition-second-claim', expected: [
      { ref: fixture.claimFixture.goalRef, revision: goalRead.value.goal.revision },
      { ref: fixture.claimFixture.workspaceRef, revision: 1 },
      { ref: sessionCard.value.record.ref, revision: sessionCard.value.record.revision },
    ] },
    input: { goalRef: fixture.claimFixture.goalRef, planRef: fixture.claimFixture.planRef,
      taskId: fixture.claimFixture.tasks.second.taskId, sessionRef: fixture.claim.sessionRef,
      roleBinding: fixture.claimFixture.roleBinding, budget: fixture.claimFixture.budget },
  });
  expect(secondClaim.status, JSON.stringify(secondClaim)).toBe('committed');
  if (secondClaim.status !== 'committed') return;
  const secondRead = await platform.executions.readExecution(fixture.ctx, secondClaim.value.runRef);
  expect(secondRead.status).toBe('ready');
  if (secondRead.status !== 'ready') return;
  const queued = await platform.controls.submitControl(fixture.ctx, {
    input: { runRef: secondClaim.value.runRef, kind: 'pause', reason: null },
    meta: { requestId: 'r4-composition-queued-submit',
      expected: [{ ref: secondClaim.value.runRef, revision: secondRead.value.run.revision }] },
  });
  expect(queued).toMatchObject({ status: 'committed' });
  if (queued.status !== 'committed') return;
  const providerCalls = fixture.scripted.calls();
  const noHandle = await platform.runtime.deliverControl!(fixture.ctx, { intentRef: queued.value.intent.ref });
  expect(noHandle, 'a queued intent with no live handle stays a durable request').toMatchObject({ status: 'ready' });
  expect(await platform.controls.readControl(fixture.ctx, queued.value.intent.ref))
    .toEqual({ status: 'ready', value: queued.value.intent });
  expect(fixture.scripted.calls(), 'no live handle must not start recovery').toBe(providerCalls);
  expect(Object.keys(platform.controls).sort()).toEqual(['readControl', 'submitControl']);
  expect((platform.controls as unknown as Record<string, unknown>)['recordControlObservation']).toBeUndefined();
});
