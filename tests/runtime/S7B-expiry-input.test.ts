/**
 * I-expiry-count (SR7 §7.5; SR11 §11.5's `I-expiry-count`, L's merge): the expiry input on the SQLite world. The real
 * wait is read back as the saved message, the yielded Run's continuation and the Session's oldest unconsumed wait; the
 * published `platform.messageExpiry.recordExpiry` then records the expiry, the continuation claims the original
 * Task/Session, and its input is the one hand-computed `expiry:<message key>` identity (book-7b.md:530), accepted only
 * after the claim. The chain count itself is X's owner row and is proved there through the same expiry continuation
 * (`tests/work-graph/S7B-X-expiry.test.ts`; SR5 5.5: no second count).
 *
 * SQLite only: the row restarts the Host between the Kernel acceptance and the platform confirm
 * (`tests/RULES.md:193–:195` S3). That window B is this row's own (rulings `:2868`, `:4709`, `book-7b.md:1203`): the
 * continuation's `input-accepted:` commit is held, the Host crashes, and the new Host confirms the same expiry input
 * exactly once. The expiry input identity and its not-consumed-before-acceptance state are read publicly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { SessionFactsV1, SessionWaitV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { type RunSnapshot } from '../../src/contracts/dispatch.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { callPublishedOwnerAsHost, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { crashS7AHost, holdS7ACommitter, ready } from '../helpers/S7A-fixture.js';
import { openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
const runs: Promise<unknown>[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  await Promise.allSettled(runs.splice(0));
});

describe('the expiry input on the real SQLite wait', () => {
  it('records the expiry, then claims the original Task/Session with the one expiry input identity', async () => {
    const { world, clock } = await openS7BWorld({ backend: 'sqlite' });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'expiry' });
    const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the saved wait message');
    expect(message.sender.kind).toBe('work_run');
    if (message.sender.kind !== 'work_run') return;
    expect({ projectId: message.sender.sessionRef.projectId, sessionId: message.sender.sessionRef.sessionId })
      .toEqual({ projectId: wait.sender.ref.projectId, sessionId: wait.sender.ref.sessionId });
    expect(message.intent).toBe('inquiry');
    expect(message.needsReply).toBe(true);
    expect(message.waitAfterSend).toBe(true);
    expect(message.response).toBeNull();
    expect(message.responseSince ?? null).toBeNull();
    expect(message.acceptedInputs ?? []).toEqual([]);
    expect(message.goalRef).toEqual(wait.goal);

    const execution = ready<{ run: RunSnapshot }>(
      await world.post('executions/read', plain(S6A_SCOPE, wait.run)), 'the yielded sender Run');
    expect(execution.run.status).toBe('ended');
    expect(execution.run.outcome).toBe('yielded');
    expect(execution.run.continuation).toMatchObject({ kind: 'wait_reply', messageRef: wait.message });

    const facts = ready<SessionFactsV1>(
      await world.post('sessions/facts', plain(S6A_SCOPE, wait.sender.ref)), 'the sender Session facts');
    expect(facts.wait).toMatchObject({ runRef: wait.run, messageRef: wait.message });

    // The published owner records the expiry; the input is not consumed before the continuation claims it.
    const at = clock.advance(86_400_000);
    expect(await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: wait.message })).toMatchObject({ status: 'committed' });
    const expired = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the expired wait message');
    expect(expired).toMatchObject({ ref: wait.message, expiredAt: at, response: null });
    expect(expired.acceptedInputs ?? []).toEqual([]);
    const expiredWait = ready<SessionWaitV1>(await world.platform.sessionFacts.readWait(world.humanContext(),
      { messageRef: wait.message }), 'the expired wait');
    expect(expiredWait.state.state).toBe('expired');

    // Hand-computed from book-7b.md:530's formula (`expiry:` + canonicalKey(messageRef)), never from production.
    const expiryInputId = 'expiry:' + JSON.stringify({
      aggregateType: 'SessionMessage', messageId: wait.message.messageId,
      projectId: wait.message.projectId, workspaceId: wait.message.workspaceId,
    });
    const receipts: WorkflowStepReceipt[] = [];
    // Window B: the continuation's `start` perform drives the successor Run to the Kernel's `run.input_accepted`; the
    // platform confirm is held at its `input-accepted:` commit, so the crash lands between the two. The held request
    // stays pending until teardown releases the barrier, so only the committed claim receipt is awaited here.
    const hold = holdS7ACommitter(world, byIdentityPrefix('input-accepted:'));
    const pending = driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: wait.goal,
      flowId: 's7b-expiry-input', sessionHint: wait.sender.ref, kind: 'select_work',
      taskId: wait.tasks[0]!.taskId }, { stopBefore: 'open_checks', receipts });
    runs.push(pending);
    await hold.reached;
    const windowB = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the window-B message');
    expect((windowB.acceptedInputs ?? []).filter(entry => entry.part === 'expiry')).toHaveLength(0);
    expect(windowB).toMatchObject({ ref: wait.message, expiredAt: at, response: null });
    const windowBWait = ready<SessionWaitV1>(await world.platform.sessionFacts.readWait(world.humanContext(),
      { messageRef: wait.message }), 'the window-B wait');
    expect(windowBWait).toMatchObject({ expiredAt: at, state: { state: 'expired' } });

    await crashS7AHost(world, hold);
    const claim = receipts.find(receipt => receipt.kind === 'claim_task');
    if (claim === undefined || claim.result.status !== 'committed')
      throw new Error('S7B: the expiry continuation has no committed claim receipt');
    const successorRun = claim.result.value.runRef;
    expect(successorRun).not.toEqual(wait.run);
    const record = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, successorRun)), 'the expiry continuation Run');
    expect(record.run).toMatchObject({ previousRun: wait.run, task: wait.tasks[0],
      consumedWait: { kind: 'expiry', originalRun: wait.run, messageRef: wait.message,
        expiryInputId } });
    expect(record.session.ref).toMatchObject({ projectId: wait.sender.ref.projectId,
      sessionId: wait.sender.ref.sessionId });

    // The new Host confirms the same Kernel acceptance once: one expiry input, the same id, no second acceptance.
    const accepted = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the accepted expiry input');
    const acceptedExpiry = (accepted.acceptedInputs ?? []).filter(entry => entry.part === 'expiry');
    expect(acceptedExpiry).toHaveLength(1);
    expect(acceptedExpiry[0]).toMatchObject({ inputId: expiryInputId, consumesWait: true,
      executionRef: successorRun as RunRef });
    expect(accepted).toMatchObject({ ref: wait.message, expiredAt: at, response: null });
    expect(commitBarrier.unreleased()).toContain('S7A input accepted');
    const consumed = ready<SessionWaitV1>(await world.platform.sessionFacts.readWait(world.humanContext(),
      { messageRef: wait.message }), 'the consumed wait');
    expect(consumed).toMatchObject({ expiredAt: at, state: { state: 'consumed' } });
  });
});
