/**
 * R4.1 composition-root behaviour tests (stage-1 skeleton).
 *
 * A real formal Run is produced by the real claim service on a real SQLite
 * ledger, then the public `createTargetPlatform` composition root (WITHOUT a
 * Runtime Host) publishes `platform.controls`. These are FINAL behaviour
 * assertions: until the stage-2 implementation lands the public control methods
 * return `unsupported`, so each test stops at its first control assertion. The
 * close/reopen tail is therefore NOT reached and must not be reported verified.
 *
 * The close counterexample reaches the control call's own read window through a
 * thin `vi.mock` wrapper that forwards to the real SQLite backend and suspends
 * `readMany` only while the test holds the gate. No production test interface is
 * added; no fixed sleep or untracked promise is used.
 *
 * Specification: docs/refactor/tasks/R4-control-recovery-skeleton.md §9.6 (6).
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createTargetPlatform, type TargetPlatformOptions } from '../../src/composition/create-platform.js';
import { CLAIM_FIXTURE_AT, createTaskClaimFixture, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

/** Shared gate state for the real-backend wrapper (hoisted above the mock). */
const controlGate = vi.hoisted(() => ({ hold: null as null | (() => Promise<void>) }));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>();
  return {
    ...actual,
    createSqliteRecordBackend: (options: Parameters<typeof actual.createSqliteRecordBackend>[0]) => {
      const backend = actual.createSqliteRecordBackend(options);
      const records = { ...backend.records, async readMany(refKeys: readonly string[]) {
        const hold = controlGate.hold;
        if (hold !== null) await hold();
        return backend.records.readMany(refKeys);
      } };
      return { ...backend, records };
    },
  };
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function hostOptions(directory: string): TargetPlatformOptions {
  return {
    storage: { kind: 'sqlite', directory },
    now: () => CLAIM_FIXTURE_AT,
    workspace: {
      async resolveRoot() {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'control needs no workspace root' };
      },
      async authorize() {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'control needs no source grant' };
      },
    },
  };
}

async function claimedRun(): Promise<{ fixture: TaskClaimFixture; runRef: { aggregateType: 'Run'; projectId: string; goalId: string; runId: string }; runRevision: number }> {
  const fixture = await createTaskClaimFixture('sqlite');
  cleanups.push(() => fixture.close());
  const claimed = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
  expect(claimed.status).toBe('committed');
  if (claimed.status !== 'committed') throw Error('real claim failed');
  const execution = await createTargetPlatform(hostOptions(fixture.directory));
  try {
    const read = await execution.executions.readExecution(fixture.ctx, claimed.value.runRef);
    if (read.status !== 'ready') throw Error('real Run read failed');
    await fixture.closeBackend();
    return { fixture, runRef: claimed.value.runRef, runRevision: read.value.run.revision };
  } finally { await execution.close(); }
}

it('submits and replays a durable control request on a real formal Run without a Runtime Host', async () => {
  const { fixture, runRef, runRevision } = await claimedRun();
  const options = hostOptions(fixture.directory);
  let platform = await createTargetPlatform(options);
  try {
    const request = { input: { runRef, kind: 'cancel' as const, reason: 'host operator stop' },
      meta: { requestId: 'r4-platform-control', expected: [{ ref: runRef, revision: runRevision }] } };
    const submitted = await platform.controls.submitControl(fixture.ctx, request);
    expect(submitted).toMatchObject({ status: 'committed', replayed: false,
      value: { intent: { kind: 'cancel', desiredState: 'cancelled', status: 'queued' } } });
    if (submitted.status !== 'committed') throw Error('public control submission required');
    expect(await platform.controls.readControl(fixture.ctx, submitted.value.intent.ref))
      .toEqual({ status: 'ready', value: submitted.value.intent });

    // Close drains the in-flight read and rejects new calls; reopen replays the receipt.
    const draining = platform.controls.readControl(fixture.ctx, submitted.value.intent.ref);
    const closing = platform.close();
    expect(await draining).toEqual({ status: 'ready', value: submitted.value.intent });
    await closing;
    expect(await platform.controls.readControl(fixture.ctx, submitted.value.intent.ref))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });

    platform = await createTargetPlatform(options);
    expect(await platform.controls.readControl(fixture.ctx, submitted.value.intent.ref))
      .toEqual({ status: 'ready', value: submitted.value.intent });
    expect(await platform.controls.submitControl(fixture.ctx, request))
      .toEqual({ ...submitted, replayed: true });
  } finally { await platform.close().catch(() => undefined); }
});

it('close waits for a control read suspended in the real RecordStore, then blocks new calls', async () => {
  const { fixture, runRef, runRevision } = await claimedRun();
  const options = hostOptions(fixture.directory);
  let release: (() => void) | undefined;
  let platform = await createTargetPlatform(options);
  try {
    const request = { input: { runRef, kind: 'pause' as const, reason: null },
      meta: { requestId: 'r4-platform-drain', expected: [{ ref: runRef, revision: runRevision }] } };
    const submitted = await platform.controls.submitControl(fixture.ctx, request);
    expect(submitted).toMatchObject({ status: 'committed' });
    if (submitted.status !== 'committed') throw Error('public control submission required');

    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    controlGate.hold = async () => { enter(); await gate; };

    const pending = platform.controls.readControl(fixture.ctx, submitted.value.intent.ref);
    expect(await Promise.race([entered.then(() => 'entered' as const), pending.then(() => 'settled' as const)]))
      .toBe('entered');
    let closed = false;
    const closing = platform.close().then(() => { closed = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(closed, 'close must wait for the suspended control read before closing the ledger').toBe(false);
    expect(await platform.controls.readControl(fixture.ctx, submitted.value.intent.ref))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });

    controlGate.hold = null;
    release!();
    expect(await pending).toEqual({ status: 'ready', value: submitted.value.intent });
    await closing;
    expect(await platform.controls.readControl(fixture.ctx, submitted.value.intent.ref))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });

    platform = await createTargetPlatform(options);
    expect(await platform.controls.readControl(fixture.ctx, submitted.value.intent.ref))
      .toEqual({ status: 'ready', value: submitted.value.intent });
  } finally {
    controlGate.hold = null;
    release?.();
    await platform.close().catch(() => undefined);
  }
});
