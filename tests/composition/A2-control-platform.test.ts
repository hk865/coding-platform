/**
 * A.2 step 5.1 through the public composition root on SQLite
 * (docs/refactor/STATE-MACHINES-SPEC.md §6 RUN-09..15, §7 CTL-01..06/09,
 * §5 ATT-05/23/30, §8 SES-05).
 *
 * 1. Without a Runtime Host, a real claimed Run takes a steer (queued), a pause
 *    and a resume (applied at once, D-7) and a cancel that ends the Run and its
 *    claim's Attempt, Outbox, Lease and Session occupancy in the same commit and
 *    supersedes the queued steer (CTL-04(b)); every receipt replays after the
 *    platform reopens.
 * 2. With the Runtime Host and the scripted model, controls submitted while the
 *    real Kernel Turn runs: a cancel supersedes the queued pause in its own
 *    commit (D-8), and after the Turn's natural terminal the observer settles
 *    every intent still queued (CTL-06, CD-4): the pointer cancel and the
 *    never-accepted steer are superseded by `terminal_without_cancel`.
 *
 * No model is called: the scripted model answers with one text reply.
 */
import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import type { ControlIntentKindV1, ControlIntentRef, SubmittedControl } from '../../src/contracts/control-intent.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { createTargetPlatform, type TargetPlatformOptions } from '../../src/composition/create-platform.js';
import { B2_AT, createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import { CLAIM_FIXTURE_AT, createTaskClaimFixture, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
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

async function submit(
  platform: Platform, ctx: TaskClaimFixture['ctx'], runRef: RunRef, requestId: string, kind: ControlIntentKindV1,
  reason: string | null = null,
): Promise<{ request: Parameters<Platform['controls']['submitControl']>[1]; value: SubmittedControl }> {
  const read = await platform.executions.readExecution(ctx, runRef);
  if (read.status !== 'ready') throw Error('the Run must be readable');
  const request = { input: { runRef, kind, reason }, meta: { requestId, expected: [{ ref: runRef, revision: read.value.run.revision }] } };
  const result = await platform.controls.submitControl(ctx, request);
  expect(result, `${kind} (${requestId})`).toMatchObject({ status: 'committed', replayed: false });
  if (result.status !== 'committed') throw Error(`${kind} must commit`);
  return { request, value: result.value };
}

async function intentOf(platform: Platform, ctx: TaskClaimFixture['ctx'], ref: ControlIntentRef) {
  const read = await platform.controls.readControl(ctx, ref);
  if (read.status !== 'ready') throw Error('the control intent must be readable');
  return read.value;
}

it('D-7: controls on a claimed Run apply at once and a cancel ends the Run and its claim in one commit', async () => {
  const fixture = await createTaskClaimFixture('sqlite');
  cleanups.push(() => fixture.close());
  const claimed = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
  if (claimed.status !== 'committed') throw Error('real claim failed');
  const runRef = claimed.value.runRef;
  await fixture.closeBackend();
  const options = hostOptions(fixture.directory);
  let platform = await createTargetPlatform(options);
  cleanups.push(() => platform.close().catch(() => undefined));
  const before = await platform.executions.readExecution(fixture.ctx, runRef);
  if (before.status !== 'ready') throw Error('the claimed Run must be readable');
  expect(before.value.run.status).toBe('starting');
  expect(before.value.run.executionAuthorization).toBeUndefined();

  const steer = await submit(platform, fixture.ctx, runRef, 'a2-platform-steer', 'steer', 'look at the failing check first');
  expect(steer.value.intent).toMatchObject({ status: 'queued', revision: 1 });
  const pause = await submit(platform, fixture.ctx, runRef, 'a2-platform-pause', 'pause');
  expect(pause.value.intent).toMatchObject({ status: 'applied', revision: 2,
    observation: { origin: 'platform_not_entered', kind: 'paused', detail: { entryPhase: 'none' } } });
  const resume = await submit(platform, fixture.ctx, runRef, 'a2-platform-resume', 'resume');
  expect(resume.value.intent).toMatchObject({ status: 'applied', revision: 2,
    observation: { origin: 'platform_not_entered', kind: 'resumed', detail: { entryPhase: 'none' } } });
  const resumed = await platform.executions.readExecution(fixture.ctx, runRef);
  if (resumed.status !== 'ready') throw Error('the resumed Run must be readable');
  expect(resumed.value.run).toMatchObject({ status: 'starting', revision: before.value.run.revision + 3,
    controlState: { intentRef: resume.value.intent.ref, desiredState: 'running' } });

  const cancel = await submit(platform, fixture.ctx, runRef, 'a2-platform-cancel', 'cancel', 'operator stops before entry');
  expect(cancel.value).toMatchObject({ runRevision: resumed.value.run.revision + 1, intent: { status: 'applied', revision: 2,
    observation: { origin: 'platform_not_entered', kind: 'cancelled', runRevision: resumed.value.run.revision + 1,
      detail: { entryPhase: 'none' } } } });
  const stopped = await platform.executions.readExecution(fixture.ctx, runRef);
  if (stopped.status !== 'ready') throw Error('the stopped Run must be readable');
  const { run, attempt, outbox, lease, session } = stopped.value;
  expect(run).toMatchObject({ status: 'ended', outcome: 'cancelled', endedAt: CLAIM_FIXTURE_AT, startedAt: null,
    revision: resumed.value.run.revision + 1, controlState: { intentRef: cancel.value.intent.ref, desiredState: 'cancelled' } });
  expect(run.executionAuthorization).toBeUndefined();
  expect(attempt).toMatchObject({ status: 'ended', endOutcome: 'cancelled', startedAt: null, endedAt: CLAIM_FIXTURE_AT });
  expect(outbox).toMatchObject({ status: 'settled', dispatchState: { schemaVersion: 2, phase: 'settled',
    settlement: 'not_entered', consumerId: null, entryGeneration: null, sessionGeneration: claimed.value.generation } });
  expect(lease?.release).toMatchObject({ runRef, attemptRef: claimed.value.attemptRef, generation: claimed.value.generation });
  expect(session).toMatchObject({ occupancy: null, lastExecutionRef: runRef, historyCursor: before.value.session.historyCursor });
  expect(await intentOf(platform, fixture.ctx, steer.value.intent.ref)).toMatchObject({ status: 'superseded', revision: 2,
    observation: { origin: 'platform_superseded', kind: 'superseded_by_newer', detail: { supersededBy: cancel.value.intent.ref } } });
  // A control on the ended Run is refused.
  expect(await platform.controls.submitControl(fixture.ctx, { input: { runRef, kind: 'pause', reason: null },
    meta: { requestId: 'a2-platform-late-pause', expected: [{ ref: runRef, revision: run.revision }] } }))
    .toMatchObject({ status: 'rejected', code: 'busy' });

  // Reopen: every receipt replays from its recorded event, the records read back unchanged.
  await platform.close();
  platform = await createTargetPlatform(options);
  for (const submitted of [steer, pause, resume, cancel]) {
    expect(await platform.controls.submitControl(fixture.ctx, submitted.request))
      .toMatchObject({ status: 'committed', replayed: true, value: submitted.value });
  }
  expect(await platform.executions.readExecution(fixture.ctx, runRef)).toMatchObject({ status: 'ready', value: { run, attempt, outbox } });
});

it('D-8 and CD-4 with the Runtime: a cancel supersedes the queued pause; the natural terminal settles the queued cancel and steer', async () => {
  let platform: Platform | undefined;
  const submitted: Partial<Record<'steer' | 'pause' | 'cancel', SubmittedControl>> = {};
  let pauseSuperseded: unknown;
  const fixture: B2RuntimeFixture = await createB2RuntimeFixture({ kind: 'sqlite',
    scriptedReplies: [{ kind: 'text', text: 'the work is done' }],
    beforeReply: async (_request, index) => {
      if (index !== 0 || platform === undefined) return;
      // The Kernel Turn is running; each control below is queued (RUN-12/13/15).
      for (const [kind, reason] of [['steer', 'prefer the smaller change'], ['pause', null], ['cancel', 'stop now']] as const) {
        submitted[kind] = (await submit(platform, fixture.ctx, fixture.claim.runRef, `a2-live-${kind}`, kind, reason)).value;
      }
      pauseSuperseded = await intentOf(platform, fixture.ctx, submitted.pause!.intent.ref);
    } });
  cleanups.push(() => fixture.close());
  await fixture.claimFixture.closeBackend();
  platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory: fixture.directory }, workspace: fixture.deps.workspaceHost, now: () => B2_AT,
    kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
      workspace: fixture.scope, databasePath: join(fixture.directory, 'kernel.sqlite') }] },
    runtime: fixture.host,
  });
  cleanups.push(() => platform!.close());

  const prepared = await platform.runtime.prepareExecution(fixture.ctx, { runRef: fixture.claim.runRef, requestId: 'a2-live-prepare' });
  if (prepared.status !== 'ready') throw Error(`prepare failed: ${JSON.stringify(prepared)}`);
  const started = await platform.runtime.startRun(fixture.ctx, { prepared: prepared.value, consumerId: 'a2-live', requestId: 'a2-live-start' });
  expect(started.status).toBe('ready');
  expect(fixture.scripted.calls()).toBe(1);
  const { steer, pause, cancel } = submitted;
  if (steer === undefined || pause === undefined || cancel === undefined) throw Error('the three controls must have committed');
  for (const queued of [steer, pause, cancel]) expect(queued.intent).toMatchObject({ status: 'queued', revision: 1 });

  // D-8: the cancel moved the pointer off the queued pause and superseded it in the same commit.
  expect(pauseSuperseded).toMatchObject({ status: 'superseded', revision: 2, observation: { origin: 'platform_superseded',
    kind: 'superseded_by_newer', detail: { supersededBy: cancel.intent.ref }, runRevision: cancel.runRevision } });
  expect(await intentOf(platform, fixture.ctx, pause.intent.ref)).toEqual(pauseSuperseded);

  // The Turn completed before any safe point consumed the cancel: the Run ends completed and releases.
  const ended = await platform.executions.readExecution(fixture.ctx, fixture.claim.runRef);
  if (ended.status !== 'ready') throw Error('the ended Run must be readable');
  expect(ended.value.run).toMatchObject({ status: 'ended', outcome: 'completed',
    controlState: { intentRef: cancel.intent.ref, desiredState: 'cancelled' } });
  expect(ended.value.session.occupancy).toBeNull();
  // CTL-06 / CD-4: the pointer cancel and the never-accepted steer are superseded by the Turn's own terminal.
  const locator = ended.value.run.executionHistory;
  if (locator === undefined || locator.endPosition === null) throw Error('the ended Run must carry its terminal window');
  for (const settled of [cancel, steer]) {
    const intent = await intentOf(platform, fixture.ctx, settled.intent.ref);
    expect(intent).toMatchObject({ status: 'superseded', revision: 2,
      observation: { kind: 'terminal_without_cancel', history: { endPosition: locator.endPosition } } });
    if (intent.status === 'queued' || 'origin' in intent.observation) throw Error('a Kernel observation is required');
    expect(intent.observation.source.position).toBeGreaterThanOrEqual(locator.startPosition);
    expect(intent.observation.source.position).toBeLessThanOrEqual(locator.endPosition);
  }
});
