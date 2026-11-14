/**
 * KLS-3b (test writer, decision 117): rows 3B-13 and 3B-14 of the start rulings draft v2 §3, item (b) of the five
 * (lead ruling "KLS-3b 草稿按 KLS-3a 实际代码重对"; draft §1 9, §2.8): a Session the platform makes for work on a line
 * is made on that line. The world is `openJoinedLineScenario` (`tests/helpers/KLS3B-git-lines.ts`): the scenario Host
 * (SQLite: the Host makes each line's Kernel store, S3), the AG2b seed's Goal on a second checkout the person joined
 * through `workspaces/open`, the seed's executor Session on the main line. Reads are `decisions/queue`,
 * `sessions/operation`, `sessions/read`, `messages/read` and `workflow/consultation`; expected folders are the test's
 * own worktree (`addGitWorktree`'s realpath).
 * - 3B-13: the claim finds no Session of the Goal's line (the main line's executor is not one, KLS-3a2), so the
 *   Workflow asks for a member (no adviser here: the Host's `host_pick_member`, a `member_creation` card); the person
 *   approves it and the executor line is created (the line creation, draft §2.8): it is on the Goal's line. Deviation
 *   from the draft's row, which names the `createSessionStep` create choice: on a first claim the Workflow's create
 *   choice is this member request; `createSessionStep` runs only for a requeue whose Session cannot be reused or a
 *   failed Turn close, and the public way to retire the claim's Session (`sessions/link` + `sessions/archive`) is
 *   refused while its Task holds it (questions for the lead).
 * - 3B-14: the person asks a Session on the second line (`messages/send`, an inquiry); `workflow/consultation` answers
 *   it through an isolated copy (`readonly_copy`), and the copy is on its source's line.
 *   Not written: the handoff half of 3B-14 (`session-handoff-service`). Its public entries hand off a secretary
 *   (`secretaries/handoff`) or a role line (the `hand_off` tool); today's public steps make those only on the main
 *   line, so no public step puts a handoff source on the second line (questions for the lead).
 *
 * Red today (a2b618dd): there is no join, so the seed's `workspaces/open` of the worktree answers a new workspace and
 * the world stops there. With the line registered the KLS-3a2 way instead (an exploration on this tree, not kept), both
 * new Sessions are on the main line: that is the named mutation, shown. Green when KLS-3b lands the join and passes
 * the Goal's or the source's `lineFolder` in the line creation and the consultation copy.
 * Named mutations: the line creation without the Goal's `lineFolder` (3B-13), the consultation copy without
 * `card.record.lineRef.folder` (3B-14) — the new Session is on the main line.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { lineSession, openJoinedLineScenario } from '../helpers/KLS3B-git-lines.js';
import { cleanupScenarios, performs, waitFor, type HostScenario } from '../scenarios/harness.js';
import { consult } from '../scenarios/support/brief.js';
import { textReply } from '../scenarios/support/common.js';

afterEach(async () => { await cleanupScenarios(); });

/** The folder of a Session's line, by `sessions/read`. */
async function sessionFolder(h: HostScenario, session: SessionRef): Promise<string | undefined> {
  const read = await h.post<ReadResult<SessionCard>>('sessions/read',
    plain(AG2B_SCOPE, { projectId: session.projectId, sessionId: session.sessionId }));
  if (read.status !== 'ready') throw new Error(`sessions/read: ${JSON.stringify(read)}`);
  return read.value.record.lineRef?.folder;
}

describe('KLS-3b a Session made for work on a line is made on that line', () => {
  it('3B-13 the executor line the person approves for a Goal on the second line is made on that line', async () => {
    const { h, folder } = await openJoinedLineScenario();
    await h.advance(h.select('kls3b-13', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const queue = await h.post<ReadResult<{ waitingAnswer: DecisionCardV1[] }>>('decisions/queue',
      plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer'], page: { limit: 100 } }));
    const card = queue.status === 'ready' ? queue.value.waitingAnswer.find(item => item.source.kind === 'member_creation')
      : undefined;
    if (card === undefined) throw new Error(`no member_creation card: ${JSON.stringify(queue)}`);
    expect((await h.post<{ status: string }>('decisions/answer', graphWrite(AG2B_SCOPE, { source: card.source,
      selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [] }, 'kls3b-13-approve',
    card.source.pins))).status).toBe('ready');
    const operation = card.source.pins.find(pin => pin.ref.aggregateType === 'CoreOperation')?.ref;
    const done = await waitFor(async () => await h.post<ReadResult<{ phase: string;
      action: { progress?: { outcome?: { kind: string; session?: SessionRef } } } }>>('sessions/operation',
    plain(AG2B_SCOPE, operation)), read => read.status === 'ready' && read.value.phase === 'completed', 'the member line');
    const created = done.status === 'ready' ? done.value.action.progress?.outcome?.session : undefined;
    if (created === undefined) throw new Error(`the member operation created no Session: ${JSON.stringify(done)}`);
    expect(await sessionFolder(h, created)).toBe(folder);
  });

  it('3B-14 an inquiry to a Session on the second line is answered by a copy on the same line', async () => {
    const { h, folder } = await openJoinedLineScenario({ script: { queryReplies: [textReply('kls3b-14 the marker is LINE')] } });
    const { projectId, sessionId } = (await lineSession(h, 'kls3b-14-recipient', AG2B_QUERY_ROLE, folder)).ref;
    const sent = await h.post<WriteResult<SessionMessage>>('messages/send', graphWrite(AG2B_SCOPE, {
      recipient: { projectId, sessionId }, text: 'KLS3B: which marker does src/marker.ts export?', intent: 'inquiry',
      needsReply: true, goalRef: null }, 'kls3b-14-ask'));
    if (sent.status !== 'committed') throw new Error(`messages/send: ${JSON.stringify(sent)}`);
    expect(await consult(h, sent.value.ref)).toMatchObject({ status: 'ready', value: { state: 'responded' } });
    const message = await h.post<ReadResult<SessionMessage>>('messages/read', plain(AG2B_SCOPE, sent.value.ref));
    const copy = message.status === 'ready' ? message.value.consultationDerivation?.childSessionRef : undefined;
    if (copy === undefined) throw new Error(`the inquiry has no consultation copy: ${JSON.stringify(message)}`);
    expect(await sessionFolder(h, copy)).toBe(folder);
  });
});
