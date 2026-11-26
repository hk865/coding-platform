/** INT-B1 (§4.8, SK L7): a Kernel-refused refinement round writes `plan_refine_failed` and its reason into the wait. */
import { expect, it } from 'vitest';
import { systemRoundRequestId, type SystemRoundV1 } from '../../src/contracts/plan-round.js';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import { heartbeat, heartbeatUntil, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';

const ADVISER_TOOLS = ['read', 'look_graph', 'find_graph', 'check_links', 'run_readonly_command', 'record_note',
  'send_session_message', 'read_session_inbox', 'read_session_message', 'read_session_message_body',
  'respond_session_message', 'withdraw_session_message', 'notify_person', 'ask_person', 'ask_copy',
  'read_user_decision', 'dispatch_task', 'hold_claim', 'release_hold', 'request_stop', 'query_task_graph',
  'query_ready_tasks', 'propose_future_plan', 'create_member', 'assign_module_maintainer', 'propose_role_split',
  'propose_architecture_revision', 'read_requests', 'request_rework', 'request_recheck', 'hand_off'] as const;

it('INT-B1 a refinement round refused by the Kernel reports plan_refine_failed with the reason', async () => {
  const opened = await openPlanOnlyWorld('int-b1', { contextWindowTokens: 128_000, tools: ADVISER_TOOLS });
  try {
    await startGoalDriver(opened.world, opened.goal, 'int-b1');
    const round: SystemRoundV1 = { kind: 'refine', goalRef: opened.goal, target: { kind: 'stage',
      stageId: opened.stageId }, planRevision: 1 };
    const requestId = systemRoundRequestId(round);
    if (requestId.status !== 'ready') throw new Error('INT-B1: no request id');
    const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
    if (messageRef.status !== 'ready') throw new Error('INT-B1: no message ref');
    const inbox = await heartbeatUntil(opened.world, () => listed(opened.world, 'inbox', opened.adviser),
      items => items.some(message => message.ref.messageId === messageRef.value.messageId), 16);
    expect(inbox.some(message => message.ref.messageId === messageRef.value.messageId), 'the refine round is sent')
      .toBe(true);
    const query = await heartbeatUntil(opened.world, () => readPlanningQuery(opened.world, messageRef.value),
      read => read !== null && read.job.job.closeReason !== null, 24);
    expect(query?.job.job.closeReason?.code, `the Kernel refused the round: ${JSON.stringify({ job: query?.job.job.status, run: query?.run.run.status, close: query?.job.job.closeReason, answers: query?.job.job.answerRefs.length, phase: query?.run.run.executionState?.phase, requests: (await opened.world.scripted.requests(opened.adviser)).length })}`).toBe('failed');
    expect(query?.job.job.closeReason?.message).toMatch(/^required_content_over_budget/);
    const closeMessage = query?.job.job.closeReason?.message ?? '';

    for (let pass = 0; pass < 4; pass += 1) await heartbeat(opened.world);
    const snapshot = ready<CollaborationSnapshot>(await driverRead(opened.world, opened.goal), 'the B1 driver read');
    expect(snapshot.last?.status === 'ready' && snapshot.last.value.reason).toMatch(/^plan_refine_failed:/);
    const driverReason = snapshot.last?.status === 'ready' ? snapshot.last.value.reason : '';
    expect(driverReason, 'the person sees the Kernel reason').toContain(closeMessage);
    expect(snapshot.last?.status === 'ready' && snapshot.last.value.waitBasis?.reasons)
      .toContain('plan_refine_failed');
  } finally {
    await opened.close();
  }
}, 180_000);
