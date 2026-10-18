/**
 * K3 row K3-24 (R3, L1/L30): the stability of an existing unknown outcome.
 *
 *   (一) A `EndedUnknown` left by a pre-K3 path still only goes RUN-21 (new
 *        Kernel evidence, `live_clean`) and RUN-22 (human attestation). When the
 *        Kernel becomes readable again the late terminal is booked as RUN-21;
 *        after that a RUN-25-style reconcile refuses and the known terminal is
 *        never rewritten.
 *   (二) A Host that stayed alive and whose execution ended unknown in process
 *        (RUN-08, basis `live_clean`) stays `outcome_unknown` with no RUN-25 and
 *        no review record; restarting (same instance or with no takeover proof)
 *        changes nothing and calls no model.
 *   (三) A Run with no review record (the pre-K3 shape: the authoritative read
 *        is `not_found`) opens no review round; the reconcile leaves the Run and
 *        writes no record.
 *
 * Fixture (built only through public calls; follows
 * `tests/runtime/A2-reconcile-runtime.test.ts`): one real Runtime, the real
 * WorkGraph owners and a real Kernel on one SQLite fixture. The Kernel store
 * fault of (一)/(三) is the same explicit probe seam the sibling K3-22 case
 * uses (a `missing` probe verdict, i.e. the storage-boundary `moveKernelAside`
 * shape); the review read is the same public `readReview` K3-26 uses. Scripted
 * model replies only; no real model is called.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { HostTakeoverProofV1 } from '../../src/contracts/unknown-call-review.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import {
  bookLateEvidenceInProcess, reconcileRunAtStartup, type RunReconcileClassifierDependencies,
} from '../../src/core/agent-runtime/run-reconcile.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import type { SessionMappingProbe } from '../../src/core/agent-runtime/session-operations.js';
import type { HostInstanceFacts } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import { B2_AT, createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import { toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';

// K3: RUN-25/RUN-22 create an `UnknownCallReview` in the same commit, so its
// snapshot, its `UnknownCallReviewChanged@1` event and its lookups must be
// registered; the control records carry the (二) cancel. This is the pattern
// `tests/runtime/A2-reconcile-runtime.test.ts` uses.
vi.mock('../helpers/task-claim-fixture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/task-claim-fixture.js')>();
  const { CONTROL_RECORD_SCHEMAS } = await import('../../src/core/work-graph/persistence/control-record-codecs.js');
  const { COMPLETION_RECORD_SCHEMAS } = await import('../../src/core/work-graph/tasks/completion-record-codecs.js');
  const { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } = await import('../../src/core/work-graph/tasks/unknown-call-review-codecs.js');
  const withControls = (
    kind: Parameters<typeof actual.createTaskClaimFixture>[0],
    additionalSchemas: RecordBackendSchemas = { records: [], events: [] },
  ) => actual.createTaskClaimFixture(kind, {
    records: [...additionalSchemas.records, ...CONTROL_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records,
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records],
    events: [...additionalSchemas.events, ...CONTROL_RECORD_SCHEMAS.events, ...COMPLETION_RECORD_SCHEMAS.events,
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events],
    lookups: [...(additionalSchemas.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
      ...(COMPLETION_RECORD_SCHEMAS.lookups ?? []), ...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? [])],
  });
  return { ...actual, createTaskClaimFixture: withControls };
});

const fixtures: B2RuntimeFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

const HOST_1: HostInstanceFacts = { hostInstanceId: 'k3-24-host-1', lease: 'owned' };
const HOST_2: HostInstanceFacts = { hostInstanceId: 'k3-24-host-2', lease: 'owned' };

async function makeFixture(options: Parameters<typeof createB2RuntimeFixture>[0] = {}): Promise<B2RuntimeFixture> {
  const fixture = await createB2RuntimeFixture({ ...options, kind: 'sqlite' });
  fixtures.push(fixture);
  return fixture;
}

type Controls = ReturnType<typeof createRunControlService>;

function controlsOn(fx: B2RuntimeFixture): Controls {
  let seq = 0;
  return createRunControlService({
    records: fx.claimFixture.records,
    authority: createMaterialRecordReaders(fx.claimFixture.records).authority,
    reads: createRunStateReader({ records: fx.claimFixture.records }),
    now: () => B2_AT,
    eventId: () => `k3-24-control-event-${++seq}`,
  });
}

function reviewsOn(fx: B2RuntimeFixture) {
  return createUnknownCallReviewService({ records: fx.claimFixture.records });
}

/** A restarted Host: fresh owners over the same stores under `host`, and the start-up classifier's dependencies. */
type ClassifierOverrides = Partial<Pick<RunReconcileClassifierDependencies,
  'turnClosureSupport' | 'captureWorkspace' | 'lookupToolCommit'>>;

function restartedHost(fx: B2RuntimeFixture, host: HostInstanceFacts, controls: RunControlPort,
  overrides: ClassifierOverrides = {}, takeover?: HostTakeoverProofV1 | null, probeOverride?: SessionMappingProbe) {
  const deps = fx.rebuildDeps({ hostInstance: host, runReconcile: true });
  let seq = 0;
  const classifier: RunReconcileClassifierDependencies = {
    owner: createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores }), controls,
    entry: deps.entry, reconcile: deps.runReconcile!, now: () => B2_AT, newId: () => `k3-24-reconcile-${host.hostInstanceId}-${++seq}`,
    ...overrides,
  };
  const reconcile = async () => {
    const record = await read(fx, deps);
    const probe = probeOverride ?? await classifier.owner.probe({ session: record.session, signal: fx.ctx.signal });
    return reconcileRunAtStartup(classifier, fx.ctx, { record, hostInstanceId: host.hostInstanceId, probe, takeover: takeover ?? null });
  };
  return { deps, classifier, reconcile };
}

async function read(fx: B2RuntimeFixture, deps: RuntimeExecutionDependencies = fx.deps) {
  const record = await deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  if (record.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(record)}`);
  return record.value;
}

async function submit(fx: B2RuntimeFixture, controls: RunControlPort, kind: 'pause' | 'cancel' | 'resume' | 'steer', reason: string | null,
  requestId: string): Promise<ControlIntentRef> {
  const run = (await read(fx)).run;
  const submitted = await controls.submitControl(fx.ctx, { input: { runRef: fx.claim.runRef, kind, reason },
    meta: { requestId, expected: [{ ref: fx.claim.runRef, revision: run.revision }] } });
  if (submitted.status !== 'committed') throw new Error(`${kind}: ${JSON.stringify(submitted)}`);
  return submitted.value.intent.ref;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

/** A controlled Kernel tool (as A2/R4: it only decides WHEN a call settles; it ignores a cancel). */
function blockingTool(name: string, entered: () => void, release: Promise<void>): ToolDefinition {
  return {
    name, description: 'K3-24 controlled runtime tool', inputSchema: z.object({}).loose(), effectClass: 'read_only',
    requiredCapabilities: ['workspace_read'], defaultTimeoutMs: 60_000, outputLimitBytes: 1_024,
    independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: async (call: Readonly<ToolCall>): Promise<ToolResult> => {
      entered();
      await release;
      return { schemaVersion: 1, callId: call.callId, status: 'success', output: [{ kind: 'text', text: 'K3-24: the late tool result' }],
        effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
    } },
  };
}

function withTool(kernel: RuntimeExecutionDependencies['kernel'], tool: ToolDefinition): RuntimeExecutionDependencies['kernel'] {
  return {
    ...kernel,
    runCodingAgent: (options) => kernel.runCodingAgent({
      ...options,
      config: { ...options.config, tools: { ...options.config.tools, enabledNames: [...options.config.tools.enabledNames, tool.name] } },
      additionalTools: (workspace) => [...(options.additionalTools?.(workspace) ?? []), tool],
    }),
  };
}

async function prepare(fx: B2RuntimeFixture, runtime: ReturnType<typeof createAgentRuntime>, requestId: string) {
  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  return prepared.value;
}

const KERNEL_ASIDE: SessionMappingProbe = { verdict: 'missing', activeRunId: null,
  reason: 'K3-24: the mapped Kernel database file is missing' };

// -------------------------------------------------------------------------- //
// K3-24 (一): a pre-K3 EndedUnknown only goes RUN-21 and RUN-22                  //
// -------------------------------------------------------------------------- //

it('K3-24 (一) a pre-K3 EndedUnknown goes RUN-21 when the Kernel is readable again, and a later RUN-25-style reconcile never rewrites the known terminal', async () => {
  const toolName = 'k3-24-late-tool';
  const entered = deferred(); const release = deferred();
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-24-late-call', name: toolName, args: {} }] },
    { kind: 'text', text: 'K3-24: the late terminal' }] });
  const controls = controlsOn(fx);
  const reviews = reviewsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const runtime = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, 'k3-24a-prepare');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 'k3-24a-consumer', requestId: 'k3-24a-start' });
  try {
    await entered.promise;
    // RUN-20(ii): the Kernel store is unreadable at the restart, so the Running Run
    // ends `outcome_unknown` with a `kernel_unreadable` observation. This is the
    // same pre-K3 `EndedUnknown` a K3-before copy left behind.
    const first = restartedHost(fx, HOST_2, controls, {}, undefined, KERNEL_ASIDE);
    const firstResult = await first.reconcile();
    expect(firstResult).toMatchObject({ row: 'W-14', status: 'reconciled', reason: 'unknown' });
    expect(firstResult.autoCleanup, 'an unknown outcome never offers RUN-25').toBeUndefined();
    const unknown = await read(fx, first.deps);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      reconciliation: { status: 'quarantined', observation: { kind: 'unresolved', reason: 'kernel_unreadable' } } });
    expect(await reviews.readReview(fx.ctx, { runRef: fx.claim.runRef }),
      'a pre-K3 unknown end has no review record').toEqual({ status: 'not_found' });

    // The old process's late terminal: the tool settles, but its next entry is
    // refused (the platform Run already ended), so the Kernel records a failure.
    release.resolve();
    await running.catch(() => undefined);

    // The next reconcile reads the Kernel without the probe fault: the late
    // terminal is booked as RUN-21 on `live_clean`.
    const second = restartedHost(fx, HOST_2, controls);
    expect(await bookLateEvidenceInProcess(second.classifier, fx.ctx, { record: unknown }),
      'RUN-21 books the late evidence in process').toBe(true);
    const known = await read(fx, second.deps);
    // RUN-21 books the Kernel's late terminal. Once the platform Run already ended
    // `outcome_unknown`, the old process's next entry is refused, so the Kernel
    // records a failure; RUN-21 books that real terminal (never a guess).
    expect(known.run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { status: 'done', basis: { kind: 'live_clean' }, observation: { kind: 'runtime_terminal' } } });
    expect(await reviews.readReview(fx.ctx, { runRef: fx.claim.runRef }),
      'RUN-21 opens no review round').toEqual({ status: 'not_found' });

    // A later RUN-25-style start-up reconcile refuses: a known terminal is never rewritten.
    const revision = known.run.revision;
    const later = await second.reconcile();
    expect(later, 'a known terminal is left, never auto-closed').toMatchObject({ row: 'W-01..W-04', status: 'left' });
    expect(later.autoCleanup, 'a known terminal never offers RUN-25').toBeUndefined();
    expect(await bookLateEvidenceInProcess(second.classifier, fx.ctx, { record: known }),
      'the late evidence of a known terminal is refused').toBe(false);
    const after = await read(fx, second.deps);
    expect(after.run.revision, 'the Run is unchanged').toBe(revision);
    expect(after.run).toMatchObject({ status: 'ended', outcome: 'crashed' });
    expect(await reviews.readReview(fx.ctx, { runRef: fx.claim.runRef })).toEqual({ status: 'not_found' });
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);

// -------------------------------------------------------------------------- //
// K3-24 (二): a live in-process RUN-08 stays unknown and gets no record          //
// -------------------------------------------------------------------------- //

it('K3-24 (二) an in-process RUN-08 (live_clean) stays outcome_unknown with no RUN-25 and no record, and a restart (same instance or no proof) changes nothing with zero model calls', async () => {
  const toolName = 'k3-24-ignoring-tool';
  const entered = deferred(); const release = deferred();
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-24-ignoring-call', name: toolName, args: {} }] }] });
  const controls = controlsOn(fx);
  // The ack after the unknown end is lost with the process (the A8-3k crash point).
  const lostAcks: Controls = { ...controls,
    recordControlObservation: async () => ({ status: 'rejected', code: 'unavailable', reason: 'K3-24: the ack was lost with the process' }) };
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const runtime = createAgentRuntime({ ...deps, controls: lostAcks,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, 'k3-24b-prepare');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 'k3-24b-consumer', requestId: 'k3-24b-start' });
  let cancelRef: ControlIntentRef | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await entered.promise;
    cancelRef = await submit(fx, controls, 'cancel', 'stop now', 'k3-24b-cancel');
    expect(await runtime.port.deliverControl!(fx.ctx, { intentRef: cancelRef })).toMatchObject({ status: 'ready' });
    const finished = await Promise.race([running.then(() => true),
      new Promise<false>((resolve) => { deadline = setTimeout(() => resolve(false), 8_000); })]);
    expect(finished, 'the Kernel cancel drain must end the Turn').toBe(true);
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    release.resolve();
    await running.catch(() => undefined);
  }
  if (cancelRef === undefined) throw new Error('the cancel must be submitted');
  const reviews = reviewsOn(fx);
  // RUN-08 (live_clean): the Host stayed alive; the Run keeps the Session and the Lease.
  const unknown = await read(fx);
  expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
    reconciliation: { status: 'quarantined', basis: { kind: 'live_clean' }, observation: { kind: 'unresolved',
      unresolvedToolCallIds: ['k3-24-ignoring-call'] } } });
  expect(await reviews.readReview(fx.ctx, { runRef: fx.claim.runRef }),
    'an in-process RUN-08 creates no review record').toEqual({ status: 'not_found' });

  // The restart makes no model call: the Host stays alive and the unknown end waits for an attestation.
  const callsBeforeRestart = fx.scripted.calls();
  const same = restartedHost(fx, HOST_1, controls);
  expect(await same.reconcile(), 'the same instance leaves the live unknown end alone').toMatchObject({ row: 'W-15', status: 'left' });
  const noProof = restartedHost(fx, HOST_2, controls);
  expect(await noProof.reconcile(), 'no takeover proof changes nothing either').toMatchObject({ row: 'W-15', status: 'left' });
  const after = await read(fx, noProof.deps);
  expect(after.run, 'the Run stays outcome_unknown').toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
  expect(after.run.revision, 'the unknown end is never rewritten').toBe(unknown.run.revision);
  expect(await bookLateEvidenceInProcess(noProof.classifier, fx.ctx, { record: after }),
    'no new Kernel terminal, so no RUN-21').toBe(false);
  expect(await reviews.readReview(fx.ctx, { runRef: fx.claim.runRef }),
    'still no review record and no review round').toEqual({ status: 'not_found' });
  expect(fx.scripted.calls(), 'the restarts call no model').toBe(callsBeforeRestart);
}, 60_000);

// -------------------------------------------------------------------------- //
// K3-24 (三): a Run with no review record opens no review round                 //
// -------------------------------------------------------------------------- //

it('K3-24 (三) a Run with no review record (the pre-K3 shape) is left unchanged and gets no record from the reconcile', async () => {
  // Limit (reported): the spec's "attested before K3" Run is committed by the
  // Codex fixture through the storage boundary, but in this copy every public
  // attestation (RUN-22 `resolveUnknownRun`) now writes an `UnknownCallReview`
  // in the same commit (L8), and the only exception (a review-round Run) has no
  // public creation path here. So the reachable pre-K3 shape is an
  // `EndedUnknown` with an authoritative absent record; the "continue as today"
  // step itself is the Workflow's (K3-33) and is out of scope for this file.
  // What is asserted is L30's R3 half: an absent record is not a review round,
  // the reconcile writes no record and leaves the Run as it is.
  const toolName = 'k3-24-attested-tool';
  const entered = deferred(); const release = deferred();
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-24-attested-call', name: toolName, args: {} }] }] });
  const controls = controlsOn(fx);
  const reviews = reviewsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const runtime = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, 'k3-24c-prepare');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 'k3-24c-consumer', requestId: 'k3-24c-start' });
  try {
    await entered.promise;
    const first = restartedHost(fx, HOST_2, controls, {}, undefined, KERNEL_ASIDE);
    expect(await first.reconcile()).toMatchObject({ row: 'W-14', status: 'reconciled' });
    const unknown = await read(fx, first.deps);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
    expect(await reviews.readReview(fx.ctx, { runRef: fx.claim.runRef }),
      'the authoritative read is `not_found`: no record').toEqual({ status: 'not_found' });

    // A restart with the Kernel still unreadable writes nothing and opens no review round.
    const second = restartedHost(fx, HOST_2, controls, {}, undefined, KERNEL_ASIDE);
    expect(await second.reconcile()).toMatchObject({ row: 'W-15', status: 'left',
      reason: 'the Kernel is unreadable; the unknown end waits for an attestation' });
    const after = await read(fx, second.deps);
    expect(after.run.revision, 'the Run is unchanged').toBe(unknown.run.revision);
    expect(after.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });
    expect(await reviews.readReview(fx.ctx, { runRef: fx.claim.runRef }),
      'no record is created and no review round opens').toEqual({ status: 'not_found' });
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);
