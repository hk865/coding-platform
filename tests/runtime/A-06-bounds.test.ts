/**
 * A-06: only the accepted planning answer gets 256 KiB. The real secretary
 * request round keeps 16 KiB: the scripted model first calls
 * `submit_secretary_answer` with a ~100 KiB body (rejected/capacity, no answer)
 * and then with 15 KiB (accepted and readable through `queries/read` /
 * `queries/answer`). The three text fallbacks stay at 16 KiB too: the request
 * round closes `failed` with `too_long`, the ordinary Query closes `gap`, and
 * the planning round's over-long text is a gap with no answer.
 *
 * PL P3-05 / ruling line 7: every row below is a real Host row, with no
 * hand-made ctx and no direct handler. The planning text fallback needs a
 * `plan_round` planning Query; this tree stops before the goal loop's missing
 * `planCandidates` wiring (L), and P4's `refine:` route is the next stop. The
 * fallback's `gap`/no-answer read is executable after those points and is
 * reported as not proven until they close.
 */
import { describe, expect, it } from 'vitest';
import type { QueryJobAnswerSnapshot } from '../../src/contracts/query-job.js';
import {
  systemRoundRequestId, type SystemRoundV1,
} from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import { heartbeatUntil, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { initializeProject } from '../helpers/S6A-history-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { toolOutputJson } from '../scenarios/support/common.js';

const BIG = 'b'.repeat(100 * 1024);
const SMALL = 's'.repeat(15 * 1024);
const OVER_LONG = 'x'.repeat(16 * 1024 + 1);
// The 16 KiB bound is on the protocol text the tool builds around the body:
// `{"schemaVersion":1,"body":"","ideas":[],"goalCardDrafts":[]}` is 60 bytes.
const EXACT_BODY = 'e'.repeat(16 * 1024 - 60);

/** The real request round's Job, Run and saved answer, read through the public routes. */
async function readRound(world: S6AHostWorld, round: { queryJobId: string }) {
  const record = ready<QueryJobRecord>((await world.post('queries/read', plain(S6A_SCOPE, {
    aggregateType: 'QueryJob', projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId,
    queryJobId: round.queryJobId,
  }))).body, 'the A-06 round read');
  const ref = record.job.job.answerRefs.at(-1);
  const answer = ref === undefined ? null : ready<QueryJobAnswerSnapshot>(
    (await world.post('queries/answer', plain(S6A_SCOPE, ref))).body, 'the A-06 answer read');
  return { record, answer };
}

describe('A-06: the secretary submit tool and every text fallback stay at 16 KiB', () => {
  it('rejects a 100 KiB secretary body as capacity and accepts 15 KiB in the same real request round', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    try {
      await initializeProject(world);
      const held = await holdS6BRequestRound(world, {
        label: 'a06-bound', goalId: null,
        replies: () => [
          { kind: 'calls', calls: [{ callId: 'a06-big', name: 'submit_secretary_answer',
            args: { body: BIG, ideas: [] } }] },
          { kind: 'calls', calls: [{ callId: 'a06-small', name: 'submit_secretary_answer',
            args: { body: SMALL, ideas: [] } }] },
        ],
      }, async ({ manifest, request, secretary }) => ({ manifest, request, secretary }));
      // The frozen request-round manifest keeps the secretary shape.
      expect(held.value.manifest.answerShape).toBe('secretary');
      expect(held.value.manifest.request?.executionKind).toBe('semantic_query');

      const requests = await world.scripted.requests(held.value.secretary);
      expect(requests).toHaveLength(2);
      expect(toolOutputJson(requests[1], 'a06-big')).toMatchObject({
        status: 'rejected', code: 'capacity',
        reason: 'the answer over the 16 KiB answer bound; shorten the body or the plan',
      });

      const { record, answer } = await readRound(world, held.value.request.round);
      expect(record.job.job).toMatchObject({ status: 'answered', closeReason: null });
      expect(record.job.job.answerRefs).toHaveLength(1);
      expect(record.run.run.outcome).toBe('answered');
      expect(answer?.answer.answer).toBe(SMALL);
      expect(answer?.answer.answer).not.toBe(BIG);
      expect(Buffer.byteLength(answer?.answer.answer ?? '', 'utf8')).toBe(15 * 1024);

      const view = await world.readRequest(held.value.request.requestRoot);
      const roundView = view.rounds.find(entry => entry.ref.queryJobId === held.value.request.round.queryJobId);
      expect(roundView).toBeDefined();
      expect(roundView).toMatchObject({ status: 'ended', answer: SMALL, closeCode: null, closeDetail: null });
      expect(await world.scripted.pending(held.value.secretary)).toBe(0);
    } finally {
      await world.close();
    }
  }, 120_000);

  it('accepts a secretary answer of exactly 16 KiB and refuses one byte more as capacity', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    try {
      await initializeProject(world);
      const held = await holdS6BRequestRound(world, {
        label: 'a06-exact', goalId: null,
        replies: () => [
          { kind: 'calls', calls: [{ callId: 'a06-one-over', name: 'submit_secretary_answer',
            args: { body: `${EXACT_BODY}x`, ideas: [] } }] },
          { kind: 'calls', calls: [{ callId: 'a06-exact', name: 'submit_secretary_answer',
            args: { body: EXACT_BODY, ideas: [] } }] },
        ],
      }, async ({ request, secretary }) => ({ request, secretary }));
      const requests = await world.scripted.requests(held.value.secretary);
      expect(toolOutputJson(requests[1], 'a06-one-over')).toMatchObject({ status: 'rejected', code: 'capacity' });
      const { record, answer } = await readRound(world, held.value.request.round);
      expect(record.job.job).toMatchObject({ status: 'answered', closeReason: null });
      expect(answer?.answer.answer).toBe(EXACT_BODY);
      const view = await world.readRequest(held.value.request.requestRoot);
      expect(view.rounds.find(entry => entry.ref.queryJobId === held.value.request.round.queryJobId))
        .toMatchObject({ status: 'ended', answer: EXACT_BODY });
    } finally {
      await world.close();
    }
  }, 120_000);

  it('closes a request round whose un-submitted text is 16 KiB + 1 byte as failed/too_long with no answer', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    try {
      await initializeProject(world);
      const held = await holdS6BRequestRound(world, {
        label: 'a06-request-text', goalId: null,
        replies: () => [{ kind: 'text', text: OVER_LONG }],
      }, async ({ manifest, request }) => ({ manifest, request }));
      expect(held.value.manifest.answerShape).toBe('secretary');
      const { record, answer } = await readRound(world, held.value.request.round);
      // The public read exposes the observer's answerCheck.detail as closeReason.detail.
      expect(record.job.job).toMatchObject({
        status: 'closed', answerRefs: [],
        closeReason: { code: 'invalid_answer', detail: 'too_long',
          message: 'the secretary answer is over the 16 KiB answer bound' },
      });
      expect(record.run.run.outcome).toBe('failed');
      expect(answer).toBeNull();
      const view = await world.readRequest(held.value.request.requestRoot);
      const roundView = view.rounds.find(entry => entry.ref.queryJobId === held.value.request.round.queryJobId);
      expect(roundView).toMatchObject({
        status: 'ended', answer: null, closeCode: 'invalid_answer', closeDetail: 'too_long',
      });
    } finally {
      await world.close();
    }
  }, 120_000);

  it('closes an ordinary Query whose final text is 16 KiB + 1 byte as a gap with no answer', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    try {
      const session = await world.createSecretary('a06-plain');
      await world.scripted.script(session, [{ kind: 'text', text: OVER_LONG }]);
      const refs = await world.occupy(session);
      await world.finishQuery(refs);
      expect(await world.scripted.pending(session)).toBe(0);
      const { record, answer } = await readRound(world, refs.queryJobRef);
      expect(record.job.job).toMatchObject({
        status: 'closed', answerRefs: [], closeReason: { code: 'gap', detail: null },
      });
      expect(record.run.run.outcome).toBe('gap');
      expect(answer).toBeNull();
    } finally {
      await world.close();
    }
  }, 120_000);

  it('closes a planning text fallback over 16 KiB as a gap with no answer', async () => {
    const opened = await openPlanOnlyWorld('a06');
    try {
      await startGoalDriver(opened.world, opened.goal, 'a06-planning-text');
      const snapshot = ready<CollaborationSnapshot>(await driverRead(opened.world, opened.goal),
        'the A-06 planning fallback driver read');
      expect(snapshot.last).toMatchObject({
        status: 'ready',
        value: { state: 'waiting', reason: expect.stringContaining('plan_refine_pending') },
      });

      const round: SystemRoundV1 = {
        kind: 'refine', goalRef: opened.goal,
        target: { kind: 'stage', stageId: opened.stageId }, planRevision: 1,
      };
      const requestId = systemRoundRequestId(round);
      expect(requestId.status).toBe('ready');
      if (requestId.status !== 'ready') throw new Error('A-06: the refine round has no request id');
      const messageRef = systemRoundMessageRef(S6A_SCOPE, requestId.value);
      expect(messageRef.status).toBe('ready');
      if (messageRef.status !== 'ready') throw new Error('A-06: the refine round has no message ref');

      // The planning round keeps the submit tool but the model does not call
      // it: the final text is 16 KiB + 1 byte, so the observer must book a gap.
      await opened.world.scripted.script(opened.adviser, [{ kind: 'text', text: OVER_LONG }]);

      const inbox = await heartbeatUntil(opened.world,
        () => listed(opened.world, 'inbox', opened.adviser),
        items => items.some(message => message.ref.messageId === messageRef.value.messageId), 16);
      expect(inbox.some(message => message.ref.messageId === messageRef.value.messageId),
        'the planning text-fallback variant needs a plan_round planning Query, and the '
        + `goal loop sends no refine:${opened.goal.goalId}:${opened.stageId}:1 to the planning line. `
        + 'Stop point: src/business/workflow/workflow.ts:1935 emits the plan_only gap and no code '
        + 'builds refinementRoundOf/sendSystemRound (src/business/workflow/plan-round.ts:52 and '
        + 'src/app/system-round.ts:18 have no production caller). Missing owner: P4 (the goal-loop '
        + 'refine: route); P2 (offerKindOf/handleIntervention) must then offer the planning Query. '
        + 'The observer gap/no-answer reading is written after this stop and is not proven until '
        + 'P4 closes it.').toBe(true);

      expect(Buffer.byteLength(OVER_LONG, 'utf8')).toBe(16 * 1024 + 1);
      const planning = await heartbeatUntil(opened.world,
        () => readPlanningQuery(opened.world, messageRef.value),
        record => record?.job.job.status === 'closed', 16);
      expect(planning, 'A-06: the planning text fallback did not close').not.toBeNull();
      if (planning === null) throw new Error('A-06: no planning Query');
      expect(planning.job.job.intent.execution).toMatchObject({
        kind: 'intervention_planning', answerShape: 'plan_round',
      });
      const { record, answer } = await readRound(opened.world, planning.job.ref);
      // The plan_round text fallback is judged at 16 KiB, not the 256 KiB
      // planning-answer bound: the over-long text is a gap and no answer exists.
      expect(record.job.job).toMatchObject({
        status: 'closed', answerRefs: [], closeReason: { code: 'gap', detail: null },
      });
      expect(record.run.run.outcome).toBe('gap');
      expect(answer).toBeNull();
    } finally {
      await opened.close();
    }
  }, 120_000);
});
