/**
 * K3 row K3-26 (R4, L8/L9, spec line 1457): the inventory a human attestation
 * builds, through the REAL `executions/resolve-unknown` entry and the REAL
 * `unknown-call-reviews/read` route.
 *
 *   (一) Kernel readable, the Turn has a command -> `pending_review`, then a
 *        real review round;
 *   (三) the Kernel is unreadable now -> `incomplete` (`kernel_unreadable`),
 *        `needs_decision`, never `resolved`;
 *   (四) the Turn is terminal and has a call without a result -> the record is
 *        built from those calls, `complete`;
 *   (五) the Kernel was unreadable at the stop (RUN-20(ii)) and is readable
 *        again at the attestation -> `incomplete`
 *        (`kernel_unreadable_at_stop`), `needs_decision`;
 *   (六) an in-process RUN-08 Run whose Kernel store was replaced by a copy
 *        taken before the Turn started -> `incomplete` (`turn_not_found`);
 *   (九) a 513-byte UTF-8 callId from the scripted provider -> `incomplete`
 *        (`undecodable_call`), `needs_decision`, the id appears nowhere; the
 *        512-byte callId of the same Turn is listed.
 *
 * (二) (readable, no unresolved calls -> empty, `resolved`) needs a message
 * read fault at classification, which the Host route cannot inject; it lives
 * in `tests/work-graph/K3-26-empty-inventory.test.ts`.
 *
 * The card / disposition assertions are session B: this file asserts the
 * record state and reasons only. Faults are real store/tool faults (the
 * blocking `read`/`shell` stand-ins keep the REAL effect classes; the Kernel
 * files are copied and moved, never edited). Scripted model only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  cleanupScenarios, HostScenario, hostCtx, performs, SCENARIO_OPERATOR,
} from './harness.js';
import {
  moveKernelAside, readExecution, restoreKernel, tempDir,
} from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { lockLedgerAfter, openWorkRoot, preparedOf, redrivePolicy, WORK_TARGET } from './support/common.js';
import { kernelTurnOf } from './support/restart.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import type { Platform } from './harness.js';

// K3-26 (二) fault: ONE mailbox `readMessage` fails (the message the yielded Run
// waits on), so the start-up classifier cannot rebuild the continuation and
// books RUN-20(iii) `continuation_unrebuildable` with no unresolved calls. Only
// that read is faulted; every other mailbox read passes.
const mailboxSeam = vi.hoisted(() => ({ failNextRead: false }));
vi.mock('../../src/core/work-graph/communication/mailbox-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/work-graph/communication/mailbox-service.js')>();
  return {
    ...actual,
    createSessionMailbox: (deps: Parameters<typeof actual.createSessionMailbox>[0]) => {
      const mailbox = actual.createSessionMailbox({ ...deps, defaultInquiryDeadlineMs: 86_400_000 });
      return { ...mailbox,
        async readMessage(ctx: Parameters<typeof mailbox.readMessage>[0], ref: Parameters<typeof mailbox.readMessage>[1]) {
          if (mailboxSeam.failNextRead) {
            mailboxSeam.failNextRead = false;
            return { status: 'rejected' as const, code: 'unavailable' as const,
              reason: 'K3-26 (二): the wait message read failed once' };
          }
          return mailbox.readMessage(ctx, ref);
        } };
    },
  };
});

// The blocking `read` stand-in: the REAL definition and class (`read_only`,
// `independentReadOnly: true`), only the handler blocks. Two read calls in one
// batch therefore both reach `tool.started` before the test acts.
const readSeam = vi.hoisted(() => {
  let armed = false;
  let gate: Promise<void> = Promise.resolve();
  let openGate: (() => void) | null = null;
  const calls: Array<{ callId: string }> = [];
  const waiters: Array<() => void> = [];
  const definition = (actual: (workspace: never) => ToolDefinition, workspace: never): ToolDefinition => {
    const real = actual(workspace);
    if (!armed) return real;
    return { ...real, handler: { ...real.handler,
      execute: async (call: never): Promise<never> => {
        const typed = call as unknown as { callId: string };
        calls.push({ callId: typed.callId });
        for (const waiter of waiters.splice(0)) waiter();
        await gate;
        return { schemaVersion: 1, callId: typed.callId, status: 'success', output: [],
          effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } } as never;
      } } };
  };
  return {
    arm(): void { armed = true; calls.length = 0; waiters.length = 0;
      gate = new Promise<void>((resolve) => { openGate = resolve; }); },
    release(): void { armed = false; openGate?.(); openGate = null; },
    get enabled(): boolean { return armed; },
    calls,
    async waitFor(count: number): Promise<void> {
      while (calls.length < count) await new Promise<void>((resolve) => { waiters.push(resolve); });
    },
    definition,
  };
});

vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return {
    ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]): ToolDefinition =>
      readSeam.definition(actual.createReadToolDefinition as never, workspace as never),
  };
});

// The KE6 stand-in (as K3-05): `reviewCapability` reads the read-only probe with
// no host process; the general (process) probe stays unavailable.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  const { createProcessSandboxStandin } = await import('./support/process-sandbox-standin.js');
  return { ...actual, ProcessSandbox: createProcessSandboxStandin(actual, sandbox) };
});

const seams = vi.hoisted(() => ({ shell: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shell as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shell = shellSeam;

afterEach(async () => {
  readSeam.release();
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

async function attest(h: HostScenario, runRef: RunRef, revision: number,
  requestId: string): Promise<unknown> {
  return await h.answer('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
    { runRef, reason: `K3-26: checked by hand (${requestId})` }, requestId, [{ ref: runRef, revision }]));
}

/** Wait until the Run ended `outcome_unknown` (RUN-08) or fail loudly. */
async function awaitUnknown(h: HostScenario, runRef: RunRef): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const record = await readExecution(h.host, runRef);
    if (record.run.status === 'ended' && record.run.outcome === 'outcome_unknown') return record.run.revision;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`the Run ${runRef.runId} did not end outcome_unknown`);
}

/** Submit a cancel for `runRef` through the real control owner and deliver it to the live runtime. */
async function cancelRun(root: Platform, runRef: RunRef, requestId: string): Promise<void> {
  const read = await root.executions.readExecution(hostCtx(), runRef);
  if (read.status !== 'ready') throw new Error(JSON.stringify(read));
  const submitted = await root.controls.submitControl(hostCtx(), { input: { runRef, kind: 'cancel',
    reason: 'K3-26: stop this Turn so its calls stay unresolved' },
  meta: { requestId, expected: [{ ref: runRef, revision: read.value.run.revision }] } });
  if (submitted.status !== 'committed') throw new Error(JSON.stringify(submitted));
  const delivered = await root.runtime.deliverControl!(hostCtx(), { intentRef: submitted.value.intent.ref });
  expect(delivered).toMatchObject({ status: 'ready' });
}

describe('K3-26 the attestation inventory through the Host entry', () => {
  it('K3-26 (一): Kernel readable with a command in the Turn -> pending_review, then a real review round settles it', async () => {
    // A non-git workspace blocks RUN-25 (`workspace_not_git`), so this Run is the
    // RUN-20(i) unknown the human later attests (no record was created before).
    const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass' });
    shellSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-26-one-shell', name: 'shell',
      args: { command: 'k3-26 (一) runs a program' } }] }]);
    const root = await openShellWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    let runRef: RunRef;
    try {
      const prepared = preparedOf(await prepareOn(root, h.select('k3-26-one', AG2B_WORK_TASK_ID)));
      runRef = prepared.claim.runRef;
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-26-one-start' });
      await shellSeam.waitForCall();
      const report = await h.restart({ crash: true });
      expect(report.report?.runs.find(row => row.ref === JSON.stringify(runRef)))
        .toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
          autoCleanup: { applied: false, blockedBy: 'workspace_not_git' } });
      // The stand-in stays blocked: the Kernel call is still unresolved when the
      // Host entry reads the draft (a released handler would append its result).
      const unknown = await readExecution(h.host, runRef);
      expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
        reconciliation: { observation: { kind: 'unresolved', reason: 'tool_calls_unresolved',
          unresolvedToolCallIds: ['k3-26-one-shell'] } } });

      const attested = await attest(h, runRef, unknown.run.revision, 'k3-26-one-attest');
      expect(attested, JSON.stringify(attested)).toMatchObject({ status: 'committed' });
      const created = await reviewOf(h, runRef);
      expect(created, JSON.stringify(created)).toMatchObject({ status: 'ready', value: {
        inventory: 'complete', inventoryProblem: null, itemsOmitted: 0, status: 'pending_review',
        decisionReasons: [], activeRound: null,
        items: [{ alias: 1, callId: 'k3-26-one-shell', toolName: 'shell', kind: 'process',
          observed: { verdict: 'pending', by: null } }],
      } });
    } finally {
      shellSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }

    // The real review round opens, records `done` / `unlikely` and ends; the
    // Workflow's `settle_review` (never `open_checks`) resolves the record.
    const reviewModel = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-26-one-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'the command finished before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' } } }] },
      { kind: 'text', text: 'k3-26 (一) the review round wrote its conclusion' },
    ]);
    const reviewRoot = await openReviewWorkRoot(h, reviewModel);
    try {
      const claimStop = await driveReviewUntil(reviewRoot, h.select('k3-26-one-review', AG2B_WORK_TASK_ID),
        performs('claim_task'));
      expect(claimStop.stopped.kind).toBe('perform');
      const startStop = await driveReviewUntil(reviewRoot, claimStop.stopped, performs('start'));
      const preparedRound = preparedOf(startStop.stopped);
      await reviewRoot.runtime.startRun(hostCtx(), { prepared: preparedRound, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-26-one-review-start' });
      expect((await readExecution(h.host, preparedRound.claim.runRef)).run)
        .toMatchObject({ status: 'ended', outcome: 'completed' });
      const settled = await h.advance(h.select('k3-26-one-settle', AG2B_WORK_TASK_ID),
        { stopBefore: performs('requeue_task') });
      expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');
      expect(settled.receipts.map(receipt => receipt.kind)).not.toContain('open_checks');
      expect(await reviewOf(h, runRef)).toMatchObject({ status: 'ready', value: {
        status: 'resolved', decisionReasons: [], activeRound: null,
        items: [{ observed: { verdict: 'done', by: 'review_round' } }] } });
    } finally {
      await reviewRoot.close();
    }
  }, 240_000);

  it('K3-26 (二): Kernel readable with no unresolved calls -> an empty, resolved inventory', async () => {
    const send = { callId: 'k3-26-two-send', name: 'send_session_message',
      args: { recipient: {} as Record<string, unknown>, text: 'k3-26 (二) a question',
        intent: 'inquiry', needsReply: true, waitAfterSend: true } };
    const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass',
      script: { replies: [{ kind: 'calls', calls: [send] }] } });
    const recipient = (await createAG2bSession(h.host, 'k3-26-two-recipient', AG2B_QUERY_ROLE,
      [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
    send.args.recipient = { projectId: recipient.projectId, sessionId: recipient.sessionId };
    // The A8-3b crash point: the wait message is saved and the Kernel yields, but
    // the observer's yielded-terminal write fails (the ledger and Kernel stores
    // are locked), so the Run is still `running` at the restart.
    const toStart = await h.advance(h.select('k3-26-two', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const prepared = preparedOf(toStart.next);
    const runRef = prepared.claim.runRef;
    const lock = lockLedgerAfter(h.database, 'SessionMessageSent');
    const model = createScriptedModel([{ kind: 'calls', calls: [send] }]);
    const root = await openWorkRoot(h, model, lock.observer);
    try {
      await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-26-two-start' });
    } finally {
      lock.release();
      await root.close();
    }
    expect(lock.locked()).toBe(true);
    const running = await readExecution(h.host, runRef);
    expect(running.run).toMatchObject({ status: 'running', outcome: null });
    const binding = running.run.executionAuthorization;
    if (binding === undefined || !('schemaVersion' in binding) || binding.kernel === null) {
      throw new Error('the Run must hold its Kernel binding');
    }
    // The blocked Kernel write lands once the lock is released; wait for the
    // yielded terminal the crashing Host recorded in its own store (A8-3b).
    let events: string[] = [];
    for (let attempt = 0; attempt < 200; attempt += 1) {
      events = kernelTurnOf(h.database, binding.kernel.runId)?.eventTypes ?? [];
      if (events.includes('run.yielded')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(events, JSON.stringify(kernelTurnOf(h.database, binding.kernel.runId))).toContain('run.yielded');

    // The restart cannot read the message the yielded Turn waits on: RUN-20(iii)
    // names no unresolved call, so the inventory is empty.
    mailboxSeam.failNextRead = true;
    const report = await h.restart({ crash: true });
    expect(report.report?.runs.find(row => row.ref === JSON.stringify(runRef)))
      .toMatchObject({ row: 'W-10', status: 'reconciled', reason: 'unknown' });
    const unknown = await readExecution(h.host, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      reconciliation: { observation: { kind: 'unresolved', reason: 'continuation_unrebuildable',
        unresolvedToolCallIds: [] } } });

    const attested = await attest(h, runRef, unknown.run.revision, 'k3-26-two-attest');
    expect(attested, JSON.stringify(attested)).toMatchObject({ status: 'committed' });
    expect(await reviewOf(h, runRef)).toMatchObject({ status: 'ready', value: {
      inventory: 'complete', inventoryProblem: null, items: [], itemsOmitted: 0,
      status: 'resolved', decisionReasons: [],
    } });
  }, 240_000);

  it('K3-26 (三): an unreadable Kernel now -> incomplete/kernel_unreadable/needs_decision, never resolved', async () => {
    const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass' });
    shellSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-26-three-shell', name: 'shell',
      args: { command: 'k3-26 (三) runs a program' } }] }]);
    const root = await openShellWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    let runRef: RunRef;
    try {
      const prepared = preparedOf(await prepareOn(root, h.select('k3-26-three', AG2B_WORK_TASK_ID)));
      runRef = prepared.claim.runRef;
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-26-three-start' });
      await shellSeam.waitForCall();
      await h.restart({ crash: true });
    } finally {
      shellSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }
    const unknown = await readExecution(h.host, runRef);
    const aside = await moveKernelAside(h.database);
    try {
      expect(await attest(h, runRef, unknown.run.revision, 'k3-26-three-attest'))
        .toMatchObject({ status: 'committed' });
      expect(await reviewOf(h, runRef)).toMatchObject({ status: 'ready', value: {
        inventory: 'incomplete', inventoryProblem: 'kernel_unreadable', items: [], itemsOmitted: 0,
        status: 'needs_decision', decisionReasons: ['inventory_incomplete'],
      } });
    } finally {
      await restoreKernel(h.database, aside);
    }
    // "Never resolved": the record stays `needs_decision` after the store returns.
    const reread = await reviewOf(h, runRef);
    expect(reread).toMatchObject({ status: 'ready', value: {
      inventory: 'incomplete', inventoryProblem: 'kernel_unreadable',
      status: 'needs_decision', decisionReasons: ['inventory_incomplete'],
    } });
  }, 180_000);

  it('K3-26 (四): a terminal Turn with unresolved calls builds a complete record from those calls', async () => {
    const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass' });
    readSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-26-four-read', name: 'read',
      args: { path: 'src/module.ts' } }] }]);
    const root = await openReviewWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    let runRef: RunRef;
    try {
      const prepared = preparedOf(await prepareOn(root, h.select('k3-26-four', AG2B_WORK_TASK_ID)));
      runRef = prepared.claim.runRef;
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-26-four-start' });
      await readSeam.waitFor(1);
      await cancelRun(root, runRef, 'k3-26-four-cancel');
      await running;
    } finally {
      readSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }
    const revision = await awaitUnknown(h, runRef);
    // The Kernel's own terminal left the read call without a result.
    expect((await readExecution(h.host, runRef)).run.reconciliation?.observation)
      .toMatchObject({ kind: 'unresolved', unresolvedToolCallIds: ['k3-26-four-read'] });

    expect(await attest(h, runRef, revision, 'k3-26-four-attest')).toMatchObject({ status: 'committed' });
    expect(await reviewOf(h, runRef)).toMatchObject({ status: 'ready', value: {
      inventory: 'complete', inventoryProblem: null, itemsOmitted: 0,
      items: [{ alias: 1, callId: 'k3-26-four-read', toolName: 'read', kind: 'read_only',
        observed: { verdict: 'no_review_needed', by: 'platform' } }],
    } });
  }, 180_000);

  it('K3-26 (五): unreadable at the stop (RUN-20(ii)), readable again at the attestation -> kernel_unreadable_at_stop', async () => {
    const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass' });
    shellSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-26-five-shell', name: 'shell',
      args: { command: 'k3-26 (五) runs a program' } }] }]);
    const root = await openShellWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    let runRef: RunRef;
    let aside: string | null = null;
    try {
      const prepared = preparedOf(await prepareOn(root, h.select('k3-26-five', AG2B_WORK_TASK_ID)));
      runRef = prepared.claim.runRef;
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-26-five-start' });
      await shellSeam.waitForCall();
      aside = await moveKernelAside(h.database);
      const report = await h.restart({ crash: true });
      expect(report.report?.runs.find(row => row.ref === JSON.stringify(runRef)))
        .toMatchObject({ row: 'W-14', status: 'reconciled', reason: 'unknown' });
    } finally {
      shellSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }
    if (aside === null) throw new Error('the Kernel must have been moved aside');
    const unknown = await readExecution(h.host, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      reconciliation: { observation: { kind: 'unresolved', reason: 'kernel_unreadable' } } });
    await restoreKernel(h.database, aside);

    expect(await attest(h, runRef, unknown.run.revision, 'k3-26-five-attest'))
      .toMatchObject({ status: 'committed' });
    expect(await reviewOf(h, runRef)).toMatchObject({ status: 'ready', value: {
      inventory: 'incomplete', inventoryProblem: 'kernel_unreadable_at_stop',
      status: 'needs_decision', decisionReasons: ['inventory_incomplete'],
    } });
  }, 180_000);

  it('K3-26 (六): an in-process RUN-08 whose Kernel store is a copy from before the Turn -> turn_not_found', async () => {
    const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass' });
    readSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-26-six-read', name: 'read',
      args: { path: 'src/module.ts' } }] }]);
    const root = await openReviewWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    let runRef: RunRef;
    let before: string;
    try {
      const prepared = preparedOf(await prepareOn(root, h.select('k3-26-six', AG2B_WORK_TASK_ID)));
      runRef = prepared.claim.runRef;
      // The copy is taken after the claim/prepare registered the Kernel Session
      // and BEFORE the Turn starts (file copy, never a database edit).
      before = await tempDir('k3-26-six-kernel-before-');
      for (const name of ['kernel.sqlite', 'kernel.sqlite-wal', 'kernel.sqlite-shm', 'kernel.sqlite-journal']) {
        if (existsSync(join(h.database, name))) copyFileSync(join(h.database, name), join(before, name));
      }
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-26-six-start' });
      await readSeam.waitFor(1);
      await cancelRun(root, runRef, 'k3-26-six-cancel');
      await running;
    } finally {
      readSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }
    const revision = await awaitUnknown(h, runRef);
    // The current store is moved aside and the pre-Turn copy takes its place.
    await moveKernelAside(h.database);
    await restoreKernel(h.database, before);

    const attested = await attest(h, runRef, revision, 'k3-26-six-attest');
    expect(attested, JSON.stringify(attested)).toMatchObject({ status: 'committed' });
    expect(await reviewOf(h, runRef)).toMatchObject({ status: 'ready', value: {
      inventory: 'incomplete', inventoryProblem: 'turn_not_found',
      status: 'needs_decision', decisionReasons: ['inventory_incomplete'],
    } });
  }, 180_000);

  it('K3-26 (九): a 513-byte callId is undecodable and appears nowhere; the 512-byte one is listed', async () => {
    const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass' });
    const long = 'x'.repeat(513);
    const exactly = 'y'.repeat(512);
    readSeam.arm();
    const model = createScriptedModel([{ kind: 'calls', calls: [
      { callId: long, name: 'read', args: { path: 'src/module.ts' } },
      { callId: exactly, name: 'read', args: { path: 'src/module.ts' } },
    ] }]);
    const root = await openReviewWorkRoot(h, model);
    let running: Promise<unknown> | null = null;
    let runRef: RunRef;
    try {
      const prepared = preparedOf(await prepareOn(root, h.select('k3-26-nine', AG2B_WORK_TASK_ID)));
      runRef = prepared.claim.runRef;
      running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-26-nine-start' });
      await readSeam.waitFor(2);
      await cancelRun(root, runRef, 'k3-26-nine-cancel');
      await running;
    } finally {
      readSeam.release();
      await running?.catch(() => undefined);
      await root.close();
    }
    const revision = await awaitUnknown(h, runRef);
    expect((await readExecution(h.host, runRef)).run.reconciliation?.observation)
      .toMatchObject({ kind: 'unresolved', unresolvedToolCallIds: [long, exactly] });

    expect(await attest(h, runRef, revision, 'k3-26-nine-attest')).toMatchObject({ status: 'committed' });
    const read = await reviewOf(h, runRef);
    expect(read).toMatchObject({ status: 'ready', value: {
      inventory: 'incomplete', inventoryProblem: 'undecodable_call', itemsOmitted: 0,
      status: 'needs_decision', decisionReasons: ['inventory_incomplete'],
      items: [{ alias: 1, callId: exactly, toolName: 'read', kind: 'read_only',
        observed: { verdict: 'no_review_needed', by: 'platform' } }],
    } });
    if (read.status !== 'ready') throw new Error(JSON.stringify(read));
    // The over-long id is nowhere in the record.
    expect(read.value.items.map(item => item.callId)).toEqual([exactly]);
    expect(JSON.stringify(read.value)).not.toContain(long);
  }, 180_000);
});

// The operator identity the attestation records is the scenario Host's actor.
void SCENARIO_OPERATOR;
