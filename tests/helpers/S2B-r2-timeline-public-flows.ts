/**
 * Round-2 R11 Group S support: drives the task-timeline fixture's store through
 * the REAL public claim / control / entry services, so the timeline reads
 * records the frozen product wrote instead of the round-1 fixture's direct
 * storage-boundary seeds.
 *
 * What it adds on top of `openS2BTimelineFixture` (which itself builds the Goal,
 * Plan, Sessions and verification facts through their public services):
 *   - `claimRun` claims one work task through the real `TaskClaimPort` without
 *     entering it (RUN-01), returning the public `TaskClaim`;
 *   - `submitNotEnteredControl` submits a real pause/resume `ControlIntent` for
 *     a claimed-but-not-entered Run; the intent machine applies it at once with
 *     the `platform_not_entered` observation (CTL-02 / D-7), which is exactly
 *     the pre-entry observation L11 folds;
 *   - `enterClaim` enters that same claim later through the real
 *     `ExecutionEntryPort` (authorize -> begin -> recordExecutionEntered).
 *
 * The control and entry services are new instances over the same real record
 * store (the fixture's own instances are closed over); nothing here writes a
 * record directly. The caller must keep its clock in step through `setClock`.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { KernelExecutionBinding } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { openS2BTimelineFixture, type S2BTimelineFixture } from './S2B-task-timeline-fixture.js';
import type { ClaimFixtureKind } from './task-claim-fixture.js';

export type S2BR2TimelinePublicFixture = S2BTimelineFixture & {
  /** Claim one work task without entering it (RUN-01); the claim can be entered later. */
  claimRun(input: { goalRef: GoalRef; taskId: string }): Promise<TaskClaim>;
  /** Enter a previously claimed Run through the real ExecutionEntryPort at `at`. */
  enterClaim(claim: TaskClaim, at: string): Promise<void>;
  /** A real pause/resume submission of a claimed-but-not-entered Run (CTL-02). */
  submitNotEnteredControl(input: { runRef: RunRef; kind: 'pause' | 'resume'; at: string }): Promise<ControlIntentRef>;
};

export async function openS2BR2TimelinePublicFixture(
  kind: ClaimFixtureKind = 'memory',
): Promise<S2BR2TimelinePublicFixture> {
  const fx = await openS2BTimelineFixture(kind);
  const records = fx.b2.base.records;
  const ctx: CoreCallContext = fx.ctx;
  let clock = '2026-10-01T00:00:00.000Z';
  let seq = 5000;
  const requestId = (label: string): string => `s2b-r2-${label}-${++seq}`;
  const now = (): string => clock;
  const eventId = (): string => `s2b-r2-event-${++seq}`;
  const reads = createRunStateReader({ records });
  const controls = createRunControlService({
    records, authority: createMaterialRecordReaders(records).authority, reads, now, eventId,
  });

  function refKey(value: object): string { return canonicalJson(value as unknown as JsonValue); }

  async function runOf(runRef: RunRef) {
    const read = await reads.readExecution(ctx, runRef);
    if (read.status !== 'ready') throw new Error(`S2B-r2 Run read failed: ${JSON.stringify(read)}`);
    return read.value.run;
  }

  async function runPin(runRef: RunRef): Promise<VersionPin> {
    return { ref: runRef, revision: (await runOf(runRef)).revision };
  }

  async function claimRun(input: { goalRef: GoalRef; taskId: string }): Promise<TaskClaim> {
    const goalRead = await fx.b2.base.plans.queryGoal(ctx, input.goalRef);
    if (goalRead.status !== 'ready' || goalRead.value.goal.activePlanRevision === null) {
      throw new Error(`S2B-r2 Goal read failed: ${JSON.stringify(goalRead)}`);
    }
    const session: SessionRef = await fx.b2.base.createSession(requestId('session'));
    const request: GraphWrite<ClaimTaskInput> = {
      input: { goalRef: input.goalRef, planRef: goalRead.value.goal.activePlanRevision, taskId: input.taskId, sessionRef: session,
        roleBinding: fx.b2.base.roleBinding, budget: fx.b2.base.budget },
      meta: { requestId: requestId('claim'), expected: [
        { ref: input.goalRef, revision: goalRead.value.goal.revision },
        { ref: fx.b2.base.workspaceRef, revision: await readRevision(fx.b2.base.workspaceRef) },
        await fx.b2.base.sessionPin(session),
      ] },
    };
    const claimed = await fx.b2.base.service.claimTask(ctx, request);
    if (claimed.status !== 'committed') throw new Error(`S2B-r2 claim failed: ${JSON.stringify(claimed)}`);
    return claimed.value;
  }

  async function readRevision(ref: object): Promise<number> {
    const key = refKey(ref);
    const read = await records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`S2B-r2 revision read failed: ${JSON.stringify(read)}`);
    return read.value.records.find((record) => record.refKey === key)?.revision ?? 0;
  }

  async function enterClaim(claim: TaskClaim, at: string): Promise<void> {
    clock = at;
    fx.setClock(at);
    const prepared = await fx.b2.buildPrepared({ claim });
    const sessionKernel = await fx.b2.kernelFor(claim);
    const kernel: KernelExecutionBinding = { ...sessionKernel,
      runId: `${claim.runRef.runId}-kernel`, turnId: `${claim.runRef.runId}-turn` };
    const authorized = await fx.b2.entry.authorizeRuntimeEntry(ctx, {
      input: { prepared, consumerId: 's2b-r2-runtime' },
      meta: { requestId: requestId('authorize'), expected: [await runPin(claim.runRef)] },
    });
    if (authorized.status !== 'committed') throw new Error(`S2B-r2 authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await fx.b2.entry.beginRuntimeEntry(ctx, {
      input: { permit: authorized.value, kernel },
      meta: { requestId: requestId('begin'), expected: [await runPin(claim.runRef)] },
    });
    if (begun.status !== 'committed') throw new Error(`S2B-r2 begin failed: ${JSON.stringify(begun)}`);
    const entered = await fx.b2.entry.recordExecutionEntered(ctx, {
      input: { permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
        enteredAt: at, kernelSource: { ...kernel, position: 3 },
        history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: requestId('entered'), expected: [await runPin(claim.runRef)] },
    });
    if (entered.status !== 'committed') throw new Error(`S2B-r2 entered failed: ${JSON.stringify(entered)}`);
  }

  async function submitNotEnteredControl(input: { runRef: RunRef; kind: 'pause' | 'resume'; at: string }): Promise<ControlIntentRef> {
    clock = input.at;
    fx.setClock(input.at);
    const before = await runOf(input.runRef);
    const submitted = await controls.submitControl(ctx, {
      input: { runRef: input.runRef, kind: input.kind, reason: null },
      meta: { requestId: requestId(`control-${input.kind}`), expected: [{ ref: input.runRef, revision: before.revision }] },
    });
    if (submitted.status !== 'committed') throw new Error(`S2B-r2 submitControl(${input.kind}) failed: ${JSON.stringify(submitted)}`);
    return submitted.value.intent.ref;
  }

  return { ...fx, claimRun, enterClaim, submitNotEnteredControl };
}
