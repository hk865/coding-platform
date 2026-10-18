/**
 * K3 row K3-25 (R4, L8/LA-8; spec line 1456): the host attestation entry.
 *
 * Through the REAL `executions/resolve-unknown` route:
 *  - the SAME commit creates the review record (the Run snapshot and the
 *    `UnknownCallReview` record are one observed batch);
 *  - `origin` carries the human's reason and identity;
 *  - the same request again returns the original receipt and creates no second
 *    record, even though the entry would now read a DIFFERENT draft (the Kernel
 *    store is moved aside, so a fresh draft would be `kernel_unreadable`);
 *  - the same identity with a different reason is `idempotency_conflict`;
 *  - both answers come before any draft validation (the Kernel stays unreadable
 *    while they are sent).
 *
 * The unknown Run is a real RUN-25-blocked crash (`workspace_not_git`), created
 * by the Host's own restart. Faults are store/file faults, never hand-encoded
 * records.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { ScenarioCommit } from './harness.js';
import { cleanupScenarios, HostScenario, hostCtx, performs, SCENARIO_OPERATOR } from './harness.js';
import { cleanupRestart, moveKernelAside, readExecution, restoreKernel } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';

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
  shellSeam.release();
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

/** The exact first request: same identity (requestId) and same expected pin. */
function attestBody(runRef: RunRef, revision: number, reason: string): unknown {
  return graphWrite(AG2B_SCOPE, { runRef, reason }, 'k3-25-attest', [{ ref: runRef, revision }]);
}

it('K3-25: attestation creates the record in the same commit, replays the original receipt, and refuses a moved reason before reading the Kernel', async () => {
  const batches: ScenarioCommit[] = [];
  const h = await HostScenario.open({ automation: redrivePolicy(false), check: 'pass',
    commitObserver: batch => { batches.push(batch); } });

  // A real RUN-25-blocked crash leaves a RUN-20(i) unknown Run (no record yet).
  shellSeam.arm();
  const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-25-shell', name: 'shell',
    args: { command: 'k3-25 runs a program' } }] }]);
  const root = await openShellWorkRoot(h, model);
  let running: Promise<unknown> | null = null;
  let runRef: RunRef;
  let published: WriteResult<unknown> | null = null;
  let created: ReadResult<UnknownCallReviewV1> | null = null;
  try {
    const prepared = preparedOf(await prepareOn(root, h.select('k3-25', AG2B_WORK_TASK_ID)));
    runRef = prepared.claim.runRef;
    running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: 'k3-25-start' });
    await shellSeam.waitForCall();
    await h.restart({ crash: true });
    // The stand-in stays blocked while the entry reads the draft: a released
    // handler would append its result and change the inventory.
    const unknown = await readExecution(h.host, runRef);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });

  const reason = 'K3-25: checked by hand, the command did not finish';
  const first = await h.post<WriteResult<unknown>>('executions/resolve-unknown',
    attestBody(runRef, unknown.run.revision, reason));
  expect(first).toMatchObject({ status: 'committed', replayed: false,
    value: { status: 'ended', outcome: 'crashed' } });

  // The same commit: one observed batch carries the Run snapshot and the record.
  const createdBatches = batches.filter(batch => batch.records.some(record => record.schemaId === 'UnknownCallReview@1'
    && record.refKey.includes(runRef.runId)));
  expect(createdBatches).toHaveLength(1);
  expect(createdBatches[0]!.records.map(record => record.schemaId)).toEqual(expect.arrayContaining([
    'RunSnapshot@1', 'UnknownCallReview@1']));

  // The record's origin names the operator and its reason.
  const created = await reviewOf(h, runRef);
  expect(created).toMatchObject({ status: 'ready', value: {
    schemaVersion: 1, revision: 1,
    origin: { kind: 'human_attested', attestedBy: { kind: SCENARIO_OPERATOR.kind, id: SCENARIO_OPERATOR.id },
      reason },
  } });

  // A DIFFERENT fresh draft would now be read: the Kernel store is moved aside.
  const aside = await moveKernelAside(h.database);
  try {
    // Same identity + same content -> the original receipt, no second record,
    // answered before the draft is read (the Kernel is unreadable right now).
    const replay = await h.answer('executions/resolve-unknown',
      attestBody(runRef, unknown.run.revision, reason));
    expect(replay, JSON.stringify(replay)).toEqual({ ...first, replayed: true });
    // Same identity + a different reason -> idempotency_conflict, also before
    // the draft is read.
    const conflict = await h.answer('executions/resolve-unknown',
      attestBody(runRef, unknown.run.revision, 'K3-25: a different reason'));
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  } finally {
    await restoreKernel(h.database, aside);
  }

  // Exactly one record ever; the replay did not rewrite it.
  expect(await reviewOf(h, runRef)).toEqual(created);
  expect(batches.filter(batch => batch.records.some(record => record.schemaId === 'UnknownCallReview@1'
    && record.refKey.includes(runRef.runId)))).toHaveLength(1);
  } finally {
    shellSeam.release();
    await running?.catch(() => undefined);
    await root.close();
  }
}, 240_000);
