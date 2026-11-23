/**
 * FN-1 / FN-2 (`cp2fn-rulings.md`, Opus P-A 1–2): a platform system round opened beside a yielded Work wait (cp2f7
 * P-A 2) takes neither the wait's own reply nor another agent line's queued letter; both go to the Run that continues.
 *
 * What this file guards. Today no Query round is claimed on a line that still has a yielded Work wait:
 * `src/core/work-graph/state/session-availability.ts:564-576` (S1-DISPATCH-02) refuses every Query claim there as
 * `busy`, so the refine's Query waits and its mailbox supply never runs beside the wait. The supply and the
 * input-acceptance write would otherwise take the bound reply (writing `consumesWait:true`, so the continuation's claim
 * is refused) and the queued letter, exactly as FN-1 and FN-2 describe. If a later change lets a Query round claim a
 * line with a yielded wait, the first row here turns red: FN-1 and FN-2 must be handled first. A wait whose yielded
 * Run was cancelled no longer blocks the line; its reply is then an ordinary reply (lead ruling, unchanged).
 *
 * The world: the adviser really runs W and its Run yields on a waiting inquiry M to a Work line X; X's own woken round
 * answers M (P2, design-frozen:262). A `refine:` opens on the adviser line through P1's real `sendSystemRound`.
 * - FN-1: the reply bound to the yielded Run belongs to that Run's continuation (p2-frozen:151, design-frozen:267,
 *   cp2mp MP-4): no other execution accepts it while the wait stands; the continuation accepts it and consumes the
 *   wait.
 * - FN-2: another agent line's ordinary letter N (`wake:true`, `needsReply:false`), which the idle view leaves queued
 *   (PL-45), stays queued until the Run that continues (design-frozen:206, p2-frozen:143), which accepts it.
 * - The refine's own source belongs to its round from the send on (design-frozen:203, :255, :262): the continuing Work
 *   Run is not supplied it, and once the wait is gone the refine round is claimed, answers and is settled.
 * Every step is public: `plans/*`, `sessions/create`, `workflow/advance` with the scripted model calling the real
 * `send_session_message`, the Host's own consume passes, P1's `sendSystemRound`, and the `messages/*` and
 * `queries/read` reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import {
  awaitPlanningAnswer, heartbeat, readPlanningQuery, settleHost, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import { acceptS7BReply, listed, readS7BMessage, sendS7BWaitingInquiry } from '../helpers/S7B-fixture.js';
import {
  PL_ADVISER_ROLE, adoptPLMixedPlan, createPLLine, openPLConsumptionWorld, sendPLRefine,
} from '../helpers/PL-consumption-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/** One message's `messages/read` status and acceptance rows: which execution took which part, and whether it
 *  consumed the wait. */
async function acceptanceOf(world: S6AHostWorld, ref: SessionMessageRef) {
  const message = await readS7BMessage(world, ref);
  return { status: message.status, accepted: (message.acceptedInputs ?? []).map(entry =>
    ({ part: entry.part, executionRef: entry.executionRef, consumesWait: entry.consumesWait })) };
}

type AnsweredWait = {
  world: S6AHostWorld; goal: GoalRef; planRevision: number; tasks: readonly TaskTriple[];
  adviser: S6ASession; sender: S6ASession; m: SessionMessage; yielded: RunRef;
};

/** The adviser's W yields on M to X and X's own woken round answers M; the adviser has not continued yet. */
async function seedAnsweredWait(label: string): Promise<AnsweredWait> {
  const world = await openPLConsumptionWorld({ label });
  worlds.push(world);
  await settleHost(world);
  const goal = world.goals.first;
  const { plan, tasks } = await adoptPLMixedPlan(world, { goal, label, tasks: [
    { taskId: `${label}-w`, role: PL_ADVISER_ROLE.templateId },
    { taskId: `${label}-a`, role: S6A_WORK_ROLE.templateId },
  ] });
  const adviser = await createPLLine(world, { label: `${label}-adviser`, role: PL_ADVISER_ROLE, tasks: [tasks[0]!] });
  const answerer = await createPLLine(world, { label: `${label}-x`, role: S6A_WORK_ROLE });
  const sender = await createPLLine(world, { label: `${label}-sender`, role: S6A_WORK_ROLE, tasks: [tasks[1]!] });
  const m = await sendS7BWaitingInquiry(world, { goal, session: adviser, taskId: tasks[0]!.taskId,
    label: `${label}-m`, trailingText: false,
    body: { recipient: answerer.ref, text: `${label}: M asks X`, needsReply: true, waitAfterSend: true } });
  if (m.sender.kind !== 'work_run') throw new Error('FN: M is not the adviser Run\'s own wait');
  await world.scripted.script(answerer, [{ kind: 'text', text: `${label}: X answers M` }]);
  expect((await waitForResponse(world, m.ref)).status, 'X answered M in its own round').toBe('responded');
  return { world, goal, planRevision: plan.planRevision, tasks, adviser, sender, m, yielded: m.sender.runRef };
}

/** The adviser's continuation through the real Workflow, with one scripted text; returns the successor Run. */
async function continueAdviser(seeded: AnsweredWait, label: string): Promise<RunRef> {
  await seeded.world.scripted.script(seeded.adviser, [{ kind: 'text', text: `${label}: continued` }]);
  return (await acceptS7BReply(seeded.world, { goal: seeded.goal, sender: seeded.adviser, task: seeded.tasks[0]!,
    run: seeded.yielded, message: seeded.m.ref, label })).run;
}

describe('FN: a system round beside a yielded Work wait', () => {
  it('FN-1/FN-2 beside the wait nothing takes the bound reply or the queued letter; the continuation takes both',
    async () => {
      const seeded = await seedAnsweredWait('fn');
      const { world, goal, adviser, sender, m } = seeded;

      // Another agent line's ordinary letter N, sent by its own Work Run.
      await world.scripted.script(sender, [
        { kind: 'calls', calls: [{ callId: 'fn-n', name: 'send_session_message',
          args: { recipient: adviser.ref, text: 'fn: N for the adviser' } }] },
        { kind: 'text', text: 'fn: N sent' },
      ]);
      await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'fn-n', sessionHint: sender.ref,
        kind: 'select_work', taskId: 'fn-a' }, { stopBefore: 'open_checks' });
      const n = (await listed(world, 'inbox', adviser)).find(message =>
        message.sender.kind === 'work_run' && message.sender.sessionRef.sessionId === sender.ref.sessionId);
      if (n === undefined) throw new Error('FN: N is not in the adviser inbox');
      expect({ wake: n.wake, needsReply: n.needsReply === true }, 'N wakes and needs no reply')
        .toEqual({ wake: true, needsReply: false });

      // The refine opens beside the wait; the Host makes its passes while the wait stands.
      const refine = await sendPLRefine(world, { goal, line: adviser, taskId: 'fn-w',
        planRevision: seeded.planRevision });
      for (let pass = 0; pass < 4; pass += 1) await heartbeat(world);
      expect(await readPlanningQuery(world, refine.messageRef), 'the refine opened its planning Query').not.toBeNull();
      expect((await acceptanceOf(world, m.ref)).accepted, 'FN-1: nothing took the bound reply').toEqual([]);
      expect(await acceptanceOf(world, n.ref), 'FN-2: N stays queued').toEqual({ status: 'pending', accepted: [] });

      // The adviser's continuation accepts the reply (consuming the wait) and N.
      const successor = await continueAdviser(seeded, 'fn');
      expect((await acceptanceOf(world, m.ref)).accepted, 'FN-1: the continuation takes the reply and the wait')
        .toEqual([{ part: 'response', executionRef: successor, consumesWait: true }]);
      expect((await acceptanceOf(world, n.ref)).accepted, 'FN-2: the continuation takes N')
        .toEqual([{ part: 'message', executionRef: successor, consumesWait: false }]);
    }, 120_000);

  it('FN-S the continuing Work Run is not supplied the refine source; the refine round runs once the wait is gone',
    async () => {
      const seeded = await seedAnsweredWait('fns');
      const { world, goal, adviser } = seeded;
      const refine = await sendPLRefine(world, { goal, line: adviser, taskId: 'fns-w',
        planRevision: seeded.planRevision });
      for (let pass = 0; pass < 2; pass += 1) await heartbeat(world);
      expect((await readPlanningQuery(world, refine.messageRef))?.job.job.status,
        'the refine\'s Query waits beside the wait').toBe('pending');

      await continueAdviser(seeded, 'fns');
      expect(await acceptanceOf(world, refine.messageRef), 'the continuation is not supplied the refine source')
        .toEqual({ status: 'pending', accepted: [] });

      // With the wait consumed the refine round is claimed on the adviser line, answers and is settled.
      await world.scripted.script(adviser, [{ kind: 'text', text: 'fns: refine looked' }]);
      const query = await awaitPlanningAnswer(world, refine.messageRef);
      expect({ job: query?.job.job.status, answers: query?.job.job.answerRefs.length },
        'the refine round answered once').toEqual({ job: 'answered', answers: 1 });
      expect((await acceptanceOf(world, refine.messageRef)).accepted, 'no execution took the source as mail')
        .toEqual([]);
      if (query === null) throw new Error('FN-S: the refine round has no Query');
      expect((await waitForResponse(world, refine.messageRef)).response?.sender,
        'the refine round that just answered settled its source').toMatchObject({ kind: 'query_run',
        queryRunRef: query.run.ref });
    }, 120_000);
});
