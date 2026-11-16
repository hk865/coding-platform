/**
 * G7W (decision 121-133, `g7-rulings.md` "测试行" W1, W2; 补充裁定二). Shared S9 review world (`openS9ReviewWorld`),
 * scripted model, public routes only.
 * - W1 (SQLite only, 补充裁定二: the real run's store). A Task-only start (`workflow/driver-start` with `taskId`, as the
 *   intervention start) runs the subject Task to its check; no reviewer line, so the Workflow opens one and answers
 *   `review_line_opened`; the lane registers and parks; nothing else commits, and the review still reaches the opened
 *   line once. A flow guard, green today (three runs): the test store's reads finish before the wake-loop pass that
 *   the open's own commits schedule (after `setImmediate`), so that pass runs after the lane's registration, drains
 *   the marked wait and `reopenHandedBack` re-runs the lane. The real run's order (that pass first) has no public step
 *   and no timing helper is added (`holdAfter` also holds the notice, `commit-observer.ts:79-90`), so the named
 *   mutation (the lane only registers, `collaboration-driver.ts:1272-1283`, today's code) cannot turn it red.
 * - W2 (memory only, S3): the exec review sent to the idle reviewer line is `entering` or answered after ONE Host consume pass of the
 *   injected clock. Red today at that read (`unclaimed`): `planOnIdleLine` (`intervention.ts:451-520`) takes one step
 *   per pass. Green when one consume repeats the steps while they progress. Mutation: one step per consume (today).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { RoleLineReadResultV1 } from '../../src/core/work-graph/views/role-line-read.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { startTaskDriver } from '../helpers/DRV-fixture.js';
import { heartbeat, readBody, readPlanningQuery, settleHost } from '../helpers/IV-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready, receiptOf } from '../helpers/S7A-fixture.js';
import { openS9ReviewRound, openS9ReviewWorld, type S9ReviewWorld } from '../helpers/S9-review-fixture.js';
import { waitFor } from './harness.js';

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

/** The reviewer rows of the person's line view in the main workspace (SRV-review-line.test.ts:50). */
const reviewerLines = async (review: S9ReviewWorld): Promise<SessionRef[]> => ready<RoleLineReadResultV1>(
  await review.world.post('role-lines/read', plain(S6A_SCOPE, { workspace: { ...S6A_SCOPE } })), 'role-lines/read')
  .rows.filter(entry => entry.row.duty === 'reviewer').map(entry => entry.row.key);

/** What the Host's plan-round sender put in `line`'s inbox; the review is one such message (S9-review-send:40). */
const planRoundInbox = async (review: S9ReviewWorld, line: SessionRef): Promise<SessionMessage[]> =>
  ready<{ items: SessionMessage[] }>(await review.world.post('messages/inbox', plain(S6A_SCOPE,
    { recipient: line, page: { limit: 20 } })), 'messages/inbox').items
    .filter(message => message.sender.kind === 'host' && message.sender.actor.id === 'host:plan-round');

describe('G7W W1: a Task watch parked on a wait its own pass already satisfied is still woken', () => {
  it('W1 (SQLite only): the lane opens the review line, parks review_line_opened, and the review reaches that line', async () => {
    const review = await openS9ReviewWorld({ backend: 'sqlite', reviewLine: 'none' });
    worlds.push(review);
    await review.world.scripted.script(review.workLine, [{ kind: 'text', text: 'G7 W1 subject work done' }]);
    await startTaskDriver(review.world, review.goal, review.task.taskId, 'g7-w1');
    const lines = await waitFor(() => reviewerLines(review), found => found.length === 1, 'the opened reviewer line');
    const sent = await waitFor(() => planRoundInbox(review, lines[0]!), found => found.length > 0,
      'the review on the opened line');
    expect(sent).toHaveLength(1);
    expect((await readBody(review.world, sent[0]!.ref, 'message')).split('\n')[0]).toMatch(/^execreview:/);
  }, 120_000);
});

describe('G7W W2: an idle line advances its system round within one heartbeat', () => {
  it('W2: one Host pass after the send, the review Query is entering or answered', async () => {
    const review = await openS9ReviewWorld();
    worlds.push(review);
    await review.world.scripted.script(review.reviewLine!, [{ kind: 'text', text: 'G7 W2 review read' }]);
    const round = await openS9ReviewRound({ review });
    await settleHost(review.world);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(review.world.ag2b, round.next!, { stopBefore: 'finalize_checks', receipts });
    const messageRef = (receiptOf(receipts, 'send_system_round')?.result as
      { value: { ref: SessionMessageRef } }).value.ref;
    await heartbeat(review.world);
    const query = await readPlanningQuery(review.world, messageRef);
    const reached = query?.job.job.status === 'answered' ? 'answered'
      : query?.run.run.executionState?.phase ?? (query === null ? 'no Query' : 'unclaimed');
    expect(['entering', 'entered', 'settled', 'answered']).toContain(reached);
  }, 120_000);
});
