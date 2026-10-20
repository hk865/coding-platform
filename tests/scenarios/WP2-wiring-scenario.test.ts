/**
 * Wiring package 2, group D, entry E0 (spec §5.2 rows Z01, Z02): automatic
 * Workflow advancement on the production composition with a scripted model. The
 * registered check is deliberately absent (L-bwrap: E0 must not depend on one).
 *
 * Z01 now runs through the scenario harness: a real `HostScenario` advances the
 * Workflow, and `openOwnedWorkRoot` (lead-approved additive helper) supplies the
 * owned Host lease so the REAL `reconcile.recordSessionHealth` writes SES-12 and
 * SES-13 on the scenario files.
 *
 * Z02 needs a `role_spec` secretary member (the stock scenario work role is the
 * legacy `builder`/executor) and a `send_user_message` grant, so it keeps the
 * group-D `createWP2Platform` helper; it checks the real prepared reminder input
 * via `requestText`.
 */
import { afterEach, expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import {
  AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  claimSuccessorRun, createWP2Platform, decisionRequestArgs, preparedBundleInput, requestText, type WP2PlatformFixture,
} from '../helpers/WP2-platform-support.js';
import {
  cleanupScenarios, hostCtx, openHostScenario, type HostScenario, type ScenarioCommit,
} from './harness.js';
import { consult } from './support/brief.js';
import {
  execution, NO_REDRIVE, openOwnedWorkRoot, selectedRun, WORK_TARGET,
} from './support/common.js';

const GOAL = { aggregateType: 'Goal', projectId: 'r4c-claim-project', goalId: 'r4c-claim-goal' } as const;

const fixtures: WP2PlatformFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
  await cleanupScenarios();
});

/** Drive the automatic Workflow until it settles or stops. */
async function drive(f: WP2PlatformFixture, flowId: string): Promise<Extract<WorkflowAdvanceResult, { status: 'ready' }>> {
  let input: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: f.goalRef, flowId, sessionHint: null, kind: 'select_work' };
  for (let step = 0; step < 32; step += 1) {
    const result = await f.platform.workflow.advanceWork(f.ctx, input);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('unreachable');
    if (result.value.state === 'completed' || result.value.next === null) return result;
    input = result.value.next;
  }
  throw new Error('the Workflow did not settle');
}

/**
 * Item 9 / ruling 8: the ONE public `architecture/observation-state` read is
 * polled (bounded, 10 ms) until the real PASS's automatic capture has no pending
 * request. Without it the capture's commit lands inside a counted notices read
 * and the assertion below sees one commit too many.
 */
async function waitForAutoCapture(h: HostScenario): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const state = await h.post<ReadResult<ArchitectureObservationStateV1>>('architecture/observation-state',
      plain(AG2B_SCOPE, { workspace: AG2B_SCOPE }));
    if (state.status === 'ready' && state.value.autoCapture !== null && state.value.autoCapture.pending === false) return;
    if (Date.now() >= deadline) throw new Error(`the automatic capture did not settle: ${JSON.stringify(state)}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

it('Z02 automatic advancement: a secretary member asks the user to decide, the card reaches the queue, the NEXT prepared reminder input carries its row, and answering removes the row', async () => {
  const f = await createWP2Platform({
    duty: 'secretary',
    workflowBound: true,
    skipClaim: true,
    allowAnyRun: true,
    ownedHost: true,
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 'z02-send', name: 'send_user_message',
        args: decisionRequestArgs(GOAL, { text: '请你决定：自动推进是否继续' }) }] },
      { kind: 'text', text: 'the member asked the user' },
    ],
  });
  fixtures.push(f);
  const settled = await drive(f, 'wp2-z02');
  // The automatic advance stopped at the unregistered check, not at the send.
  expect(settled.value.receipt?.kind).toBe('open_checks');

  // The member really sent one decision request while its Run was entered.
  expect(f.scripted.calls()).toBe(2);
  // Z02 audit fix: check the real PREPARED reminder input (the model request
  // text), not only graph facts. The decision extension's L5 rows reach the
  // assembled context the member actually received.
  // 4C-2 wiring: the note_review source is registered, so it is available and
  // emits no "尚未接入" hint row (message_release still would).
  expect(requestText(f.scripted)).not.toContain('待决来源尚未接入：note_review');
  // §5.2 line 308/§8.5: a queue read makes no new commit and calls neither model.
  const queueCommitsBefore = f.commits().length;
  const queueCallsBefore = f.scripted.calls();
  const queueQueryCallsBefore = f.queryScripted.calls();
  const queue = await f.platform.decisions.queryDecisionQueue(f.ctx, {
    workspace: f.scope, goalRef: f.goalRef, sections: ['waiting_answer'], page: { limit: 100 } });
  expect(f.commits().length).toBe(queueCommitsBefore);
  expect(f.scripted.calls()).toBe(queueCallsBefore);
  expect(f.queryScripted.calls()).toBe(queueQueryCallsBefore);
  expect(queue.status).toBe('ready');
  if (queue.status !== 'ready') return;
  expect(queue.value.waitingAnswer).toHaveLength(1);
  const card = queue.value.waitingAnswer[0]!;
  expect(card.source.kind).toBe('message');
  expect(card.state).toBe('waiting_answer');
  expect(card.options).toEqual([
    { id: 'continue', label: '继续', effect: 'apply' },
    { id: 'stop', label: '停止', effect: 'reject' },
  ]);

  // Z02 audit fix: the NEXT prepared reminder input. Claim a real successor Run
  // (implement-b) for an idle Session through the public claim owner, then read
  // the exact assembled input of the not-yet-started Run.
  const primaryCard = await f.platform.sessions.readSession(f.ctx, f.sessionRef);
  if (primaryCard.status !== 'ready') throw new Error(`Z02 primary session: ${JSON.stringify(primaryCard)}`);
  const successorSession = await f.platform.runtime.createSession(f.ctx, { workspace: f.scope,
    role: primaryCard.value.record.role, recommendedRefs: [], initialLinks: [],
    meta: { requestId: 'z02-successor-session', expected: [] } });
  expect(successorSession).toMatchObject({ status: 'completed' });
  if (successorSession.status !== 'completed') return;
  const successorRef = { projectId: successorSession.value.ref.projectId, sessionId: successorSession.value.ref.sessionId };
  const successorRun = await claimSuccessorRun(f, f.goalRef, 'implement-b', successorRef, 'z02-claim-successor');
  const beforeInput = await preparedBundleInput(f, successorRun, 'z02-next-before');
  // The expected L5 source key is observed from the send command's OWN committed
  // event (the approved full-commit seam), not a queue readback.
  const sentEvent = f.preparedCommits().flatMap(commit => commit.events)
    .find(event => event.eventType === 'SessionMessageSent');
  expect(sentEvent).toBeDefined();
  if (sentEvent === undefined) return;
  const observedSourceKey = (JSON.parse(sentEvent.json) as
    { message?: { decision?: { source?: { key?: string } } } }).message?.decision?.source?.key;
  expect(typeof observedSourceKey).toBe('string');
  if (observedSourceKey === undefined) return;
  // The assembled reminders row is a canonical JSON object, so the inner L5 text
  // is JSON-escaped.
  const rowText = JSON.stringify(`待决定：message；source=${observedSourceKey}`).slice(1, -1);
  expect(beforeInput).toContain(rowText);

  // The user answers the one card; the next preparation of the SAME
  // not-yet-started Run no longer carries the row.
  const source = JSON.parse(card.source.key) as { kind: 'message'; messageRef: SessionMessageRef };
  const message = await f.platform.messages.readMessage(f.ctx, source.messageRef);
  expect(message).toMatchObject({ status: 'ready' });
  if (message.status !== 'ready') return;
  const answered = await f.platform.workflow.resolveDecision!(f.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'continue' }, text: '继续', annotations: [] },
    meta: { requestId: 'z02-answer', expected: [...card.source.pins, { ref: source.messageRef, revision: message.value.revision }] },
  });
  expect(answered).toMatchObject({ status: 'ready', value: { answer: { status: 'committed' } } });

  expect(await preparedBundleInput(f, successorRun, 'z02-next-after')).not.toContain(rowText);
});

it('Z01 automatic advancement through the scenario harness: a yielded wait is answered, the member is retired, the notice appears, seen clears it, and SES-13 recovery keeps it out', async () => {
  const commits: ScenarioCommit[] = [];
  const send = { callId: 'z01-send', name: 'send_session_message',
    args: { recipient: {}, text: 'Z01 which file should the interrupted work write?', intent: 'inquiry', needsReply: true, waitAfterSend: true } as Record<string, unknown> };
  const h = await openHostScenario({ automation: NO_REDRIVE, check: 'pass',
    script: {
      replies: [{ kind: 'calls', calls: [send] }],
      queryReplies: [{ kind: 'text', text: 'Z01 use result.txt' }],
    },
    commitObserver: batch => { commits.push(batch); } });

  // A real query-capable member the work Session asks (the recipient must take
  // part in the work).
  const member = (await createAG2bSession(h.host, 'z01-member', AG2B_QUERY_ROLE,
    [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
  send.args['recipient'] = member;

  // The automatic advance drives the work Session to a real yielded wait.
  const yielded = await h.advance(h.select('z01-yield', AG2B_WORK_TASK_ID));
  expect(yielded.state).toBe('waiting');
  const runRef = await selectedRun(h, AG2B_WORK_TASK_ID);
  const record = await execution(h, runRef);
  expect(record.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
  const messageRef = record.run.continuation?.messageRef;
  if (messageRef === undefined) throw new Error('the yielded Run must name its wait message');
  const sessionRef: SessionRef = { projectId: record.session.ref.projectId, sessionId: record.session.ref.sessionId };

  // The member answers through the real consultation consumer.
  expect(await consult(h, messageRef)).toMatchObject({ status: 'ready', value: { state: 'responded' } });

  // The REAL health writer retires S through the owned work root.
  const platform = await openOwnedWorkRoot(h);
  try {
    const retired = await platform.reconcile.recordSessionHealth(hostCtx(), { sessionRef,
      probe: { verdict: 'missing', activeRunId: null } });
    expect((retired as { status?: string }).status).not.toBe('rejected');

    // §5.2 Z01: the handwritten position is the ONE commit that retired S, seen
    // by the scenario's production commit observer, never a record readback.
    const healthCommits = commits.filter(batch => batch.events.some(event => {
      if (event.eventType !== 'SessionHealthObserved') return false;
      const body = JSON.parse(event.json) as { observed?: string; session?: { ref?: { sessionId?: string } } };
      return body.observed === 'unavailable' && body.session?.ref?.sessionId === sessionRef.sessionId;
    }));
    expect(healthCommits).toHaveLength(1);
    const retiredAt = healthCommits[0]!.cursor;

    const noticesOf = async (limit = 100) => {
      // The Host route and the seen route share the Host composition's display
      // key, so a token issued here is valid for `decisions/notices/seen`.
      // §5.2 line 308/§8.5: the read makes no new commit and calls no model.
      // The real PASS also starts an automatic capture; wait (through the one
      // public observation-state read) until its request is satisfied first.
      await waitForAutoCapture(h);
      const commitsBefore = commits.length;
      const callsBefore = h.modelCalls();
      const page = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue', plain(AG2B_SCOPE, {
        workspace: AG2B_SCOPE, sections: ['notices'], categories: ['undelivered_reply'], page: { limit } }));
      expect(commits.length).toBe(commitsBefore);
      expect(h.modelCalls()).toBe(callsBefore);
      if (page.status !== 'ready') throw new Error(`Z01 notices: ${JSON.stringify(page)}`);
      return page.value;
    };
    const first = await noticesOf();
    expect(first.notices).toHaveLength(1);
    expect(first.notices[0]!.position).toMatchObject({ kind: 'commit', cursor: retiredAt });
    expect(first.notices[0]!.summary).toContain('未送达回复');

    // Marking the displayed page seen removes it. The Host route carries the
    // configured operator actor (the owner port needs it).
    const workspace = await platform.projects.readWorkspaceRegistration(hostCtx(), AG2B_SCOPE);
    if (workspace.status !== 'ready') throw new Error(`Z01 workspace: ${JSON.stringify(workspace)}`);
    const marked = await h.post<{ status: string }>('decisions/notices/seen', graphWrite(AG2B_SCOPE, {
      workspace: AG2B_SCOPE, displayToken: first.displayToken!, seenThrough: first.seenThrough,
    }, 'z01-seen', [{ ref: workspace.value.workspace.ref, revision: workspace.value.workspace.revision }]));
    expect(marked).toMatchObject({ status: 'committed' });
    expect((await noticesOf()).notices).toEqual([]);

    // SES-13 recovery removes the interruption position.
    const recovered = await platform.reconcile.recordSessionHealth(hostCtx(), { sessionRef,
      probe: { verdict: 'ready', activeRunId: null } });
    expect((recovered as { status?: string }).status).not.toBe('rejected');
    expect((await noticesOf()).notices).toEqual([]);

    // Z01 audit fix: prove the recovery removal POSITIVELY. A re-entry writes a
    // new R and the notice becomes visible UNSEEN again; a second recovery then
    // removes it without any seen step.
    const reentered = await platform.reconcile.recordSessionHealth(hostCtx(), { sessionRef,
      probe: { verdict: 'missing', activeRunId: null } });
    expect((reentered as { status?: string }).status).not.toBe('rejected');
    const again = await noticesOf();
    expect(again.notices).toHaveLength(1);

    const recoveredAgain = await platform.reconcile.recordSessionHealth(hostCtx(), { sessionRef,
      probe: { verdict: 'ready', activeRunId: null } });
    expect((recoveredAgain as { status?: string }).status).not.toBe('rejected');
    const card = await platform.sessions.readSession(hostCtx(), sessionRef);
    expect(card).toMatchObject({ status: 'ready', value: { record: { health: 'available' } } });
    if (card.status === 'ready') {
      expect(Object.prototype.hasOwnProperty.call(card.value.record, 'unavailableSince')).toBe(false);
    }
    expect((await noticesOf()).notices).toEqual([]);
  } finally {
    await platform.close();
  }
}, 120_000);
