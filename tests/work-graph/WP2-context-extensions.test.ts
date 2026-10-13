/**
 * Wiring package 2, group C (spec §5.2 rows F05-F08, module side): the graph
 * reader's optional `extensions` provider now reads the Goal's saved autonomy
 * (I-4, §4.2) and the waiting-answer decision queue (I-6, §4.3), projecting
 * each card into the L5 `decision:` index row.
 *
 * The E2 acceptance evidence for F05-F08 lives in `tests/composition/WP2-wiring.test.ts`
 * (real platform). Here the provider is driven directly (entry E4): F05/F06
 * read the real Goal settings and the real S5 decision queue, and both F07
 * rows (the 100-per-page boundary and the 5,000-card capacity edge) use real
 * card histories read through the real queue. The remaining fault-injection
 * cases are named `SUP` supplements, not the row evidence.
 */
import type { ActorRef, CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalSettingsV1 } from '../../src/contracts/goal-decisions.js';
import type { ContextExtensionsV1 } from '../../src/contracts/graph-context.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { SessionAnomalyViewV1 } from '../../src/contracts/session-anomaly.js';
import type {
  DecisionCardSourcePort,
  DecisionCardV1,
  DecisionQueueReadV1,
  DecisionReadPort,
  GoalSettingsPort,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { ContextReadRequestV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createExecutedFilesStub } from '../../src/core/work-graph/tasks/executed-files-stub.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import type { SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createContextExtensionsReader } from '../../src/core/work-graph/views/context-extensions.js';
import { createDecisionReadModel, createGoalCauseCardSource } from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { GOAL_A, GOAL_B, OPERATOR, PLAN_A1, PLAN_B1, PROJECT, WORKSPACE, WORKSPACE_SCOPE, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { committed, mailboxDependencies, materialsFor, pin, ready, workContext } from '../helpers/S5-queue-support.js';
import { afterEach, describe, expect, it } from 'vitest';

/** Real-store fixtures opened by a test; every one is closed after it. */
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

const PROJECT_ID = 'p';
const WORKSPACE_ID = 'w';
const GOAL_ID = 'g';
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: GOAL_ID };
const HOST_ACTOR: Extract<ActorRef, { kind: 'human' | 'system' }> = { kind: 'system', id: 'wp2-ctx-host' };
const CURSOR_A = 'wp2-cursor-a' as CommitCursor;
const CURSOR_B = 'wp2-cursor-b' as CommitCursor;
const REQUEST: ContextReadRequestV1 = { goalRef: GOAL_REF, focusTaskIds: [] };

const CARD_KINDS = [
  'message', 'goal_cause', 'candidate', 'note_review', 'planning_question', 'goal_conflict', 'message_release',
] as const;
const ALL_CARD_CAPABILITIES: DecisionQueueReadV1['capabilities'] = CARD_KINDS.map(
  (kind) => ({ source: kind, availability: 'available' as const }),
);

function hostCtx(signal = new AbortController().signal): CoreCallContext {
  return {
    projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    principal: { kind: 'host', actor: HOST_ACTOR },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, actor: HOST_ACTOR },
    signal,
  };
}

function readyExtensions(result: ReadResult<ContextExtensionsV1>): ContextExtensionsV1 {
  if (result.status !== 'ready') throw new Error(`expected a ready extension read: ${JSON.stringify(result)}`);
  return result.value;
}

// ------------------------------------------------------------------------ //
// Anomalies: the provider always reads this first; keep it an empty page.    //
// ------------------------------------------------------------------------ //

function anomalyDouble(): Pick<SessionAnomalyPort, 'listSessionAnomalies'> {
  return {
    async listSessionAnomalies(): Promise<ReadResult<SessionPage<SessionAnomalyViewV1>>> {
      return { status: 'ready', value: { items: [], nextCursor: null, sourceCursor: CURSOR_A } };
    },
  };
}

// ------------------------------------------------------------------------ //
// Goal settings double (I-4)                                                 //
// ------------------------------------------------------------------------ //

type GoalSettingsCall = { ctx: CoreCallContext; input: { goalRef: GoalRef } };

function goalSettingsDouble(
  respond: (call: number) => ReadResult<{ goal: GoalSnapshot; settings: GoalSettingsV1 }>,
): { port: Pick<GoalSettingsPort, 'readGoalSettings'>; calls: GoalSettingsCall[] } {
  const calls: GoalSettingsCall[] = [];
  return {
    calls,
    port: {
      async readGoalSettings(ctx, input) {
        calls.push({ ctx, input });
        return respond(calls.length);
      },
    },
  };
}

// ------------------------------------------------------------------------ //
// Decision queue double (I-6)                                                //
// ------------------------------------------------------------------------ //

type QueueInput = Parameters<DecisionReadPort['queryDecisionQueue']>[1];

function queuePage(options: {
  waiting: DecisionCardV1[];
  nextCursor?: string | null;
  sourceCursor?: CommitCursor;
  capabilities?: DecisionQueueReadV1['capabilities'];
}): ReadResult<DecisionQueueReadV1> {
  return {
    status: 'ready',
    value: {
      waitingAnswer: options.waiting,
      answeredPendingApplication: [],
      history: [],
      notices: [],
      counts: { waitingAnswer: options.waiting.length, answeredPendingApplication: 0, notices: {} },
      countsComplete: true,
      nextCursor: options.nextCursor ?? null,
      sourceCursor: options.sourceCursor ?? CURSOR_A,
      seenThrough: {},
      displayToken: null,
      capabilities: options.capabilities ?? ALL_CARD_CAPABILITIES,
    },
  };
}

function decisionsDouble(
  respond: (call: number, input: QueueInput) => ReadResult<DecisionQueueReadV1>,
): { port: Pick<DecisionReadPort, 'queryDecisionQueue'>; calls: QueueInput[] } {
  const calls: QueueInput[] = [];
  return {
    calls,
    port: {
      async queryDecisionQueue(_ctx, input) {
        calls.push(input);
        return respond(calls.length, input);
      },
    },
  };
}

function decisionCard(options: {
  cardKey: string;
  kind: DecisionCardV1['source']['kind'];
  pins?: VersionPin[];
  objects?: DecisionCardV1['objects'];
  state?: DecisionCardV1['state'];
}): DecisionCardV1 {
  const source = { kind: options.kind, key: options.cardKey, goalRef: GOAL_REF, pins: options.pins ?? [] };
  return {
    cardKey: options.cardKey,
    source,
    state: options.state ?? 'waiting_answer',
    goalRef: GOAL_REF,
    senderSessionRef: null,
    requestRef: null,
    objects: options.objects ?? [],
    options: [],
    answerMessageRef: null,
    answer: null,
    application: null,
    candidateStatus: null,
    staleReason: null,
    closedReason: null,
    readOnly: false,
    actions: ['answer'],
  };
}

// The fabricated page helpers (`queuePage`, `decisionCard`, `decisionsDouble`)
// remain only for the narrowly named SUP fault-injection cases below. No row
// evidence uses them.

/**
 * F06/F07 entry E4 with REAL dependencies: the real S5 decision message owner
 * and the real `createDecisionReadModel` over the same records. No fabricated
 * card/page is used for these two rows.
 */
function realDecisionQueue(f: S5DecisionFixture,
  cardSources: readonly DecisionCardSourcePort[] = []): DecisionReadPort {
  return createDecisionReadModel({
    records: f.records,
    cardSources: [...cardSources],
    noticeSources: [],
    conflicts: createGoalConflictAssembler({ records: f.records,
      catalog: createArchitectureCatalogService({ records: f.records }), executedFiles: createExecutedFilesStub() }),
    positions: createNoticePositionComparator(),
    displayTokens: createNoticeDisplayToken(new Uint8Array(32).fill(2)),
  });
}

type DecisionHarness = {
  f: S5DecisionFixture;
  mailbox: ReturnType<typeof createSessionMailbox>;
  decisions: ReturnType<typeof createDecisionMessageService>;
  queue: DecisionReadPort;
};

async function openDecisionHarness(): Promise<DecisionHarness> {
  const f = await openS5DecisionFixture('memory');
  closers.push(() => f.close());
  const mailboxDeps = mailboxDependencies(f);
  const mailbox = createSessionMailbox(mailboxDeps);
  const decisions = createDecisionMessageService({ records: f.records, now: f.now, newId: f.newId,
    operatorActor: OPERATOR, messages: mailbox, materials: mailboxDeps.materials,
    messageWrites: createMessageWriteOwner(mailboxDeps), sources: createDecisionSourceFacts({ records: f.records }) });
  return { f, mailbox, decisions, queue: realDecisionQueue(f) };
}

/** A real decision_request user message through the original send owner. */
async function sendDecisionRequest(h: DecisionHarness, text: string) {
  return committed(await h.mailbox.sendUserMessage(workContext(h.f, h.f.claimRA), { input: {
    goalRef: GOAL_B, intent: 'decision_request', text, needsReply: true, waitAfterSend: false,
    options: [{ id: 'accept', label: 'Accept', effect: 'apply' }, { id: 'reject', label: 'Reject', effect: 'reject' }],
    objects: [] }, meta: { requestId: h.f.newId(), expected: [] } }));
}

// ------------------------------------------------------------------------ //
// F07 real page boundary: a real deferred-required-work Goal, 100 real       //
// candidate cards and the real Task-linked goal_cause card on the tail page. //
// ------------------------------------------------------------------------ //

const F07_GOAL_ID = 'wp2-f07-deferred-goal';
const F07_PLAN_ID = 'wp2-f07-deferred-plan';
const F07_DEFERRED_TASK_ID = 'wp2-f07-deferred-work';
const F07_CANDIDATE_COUNT = 100;

type DeferredDecisionHarness = {
  f: S5DecisionFixture;
  queue: DecisionReadPort;
  goalRef: GoalRef;
  candidateProposalIds: string[];
};

/**
 * A Goal whose required work Task is deferred through the real Plan writers
 * (`createGoalService` + `createPlanService`), so its Goal display carries
 * `required_task_deferred` and the real goal-decision reader prepares a real
 * Task-linked `goal_cause` card. Then 100 real `candidate_v2` PlanProposal
 * records with literal proposal ids are committed through the frozen fixture's
 * real codec/commit (`seedCandidateProposal`, the same technique the frozen S5
 * world uses for its U1/U2 candidates), so the real queue's 100-per-page window
 * puts that Task card on its second (tail) page.
 */
async function openDeferredDecisionHarness(): Promise<DeferredDecisionHarness> {
  const f = await openS5DecisionFixture('memory');
  closers.push(() => f.close());
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: GOAL_B.projectId, goalId: F07_GOAL_ID };
  const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: GOAL_B.projectId, planId: F07_PLAN_ID };
  const goals = createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks;
  const created = await goals.createGoal(f.ctx, {
    input: { goalId: goalRef.goalId, workspace: WORKSPACE_SCOPE, objective: 'F07 deferred required work' },
    meta: { requestId: 'f07-deferred-goal', expected: [
      await pin(f.records, PROJECT), await pin(f.records, WORKSPACE)] },
  });
  if (created.status !== 'committed') throw new Error(`F07 deferred Goal: ${JSON.stringify(created)}`);
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: F07_PLAN_ID, planRevision: 1,
    goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: F07_DEFERRED_TASK_ID, title: 'Deferred work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'deferred', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'wp2-f07-blocker', title: 'Active work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', executionIntent: 'plan_only', scope: { kind: 'goal' } },
      { taskId: 'wp2-f07-gate', title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: F07_DEFERRED_TASK_ID, role: 'builder', instruction: 'Deferred work' }],
    obligations: [{ obligationId: 'wp2-f07-obligation', title: 'F07 delivery', requirementLevel: 'required',
      taskIds: [F07_DEFERRED_TASK_ID, 'wp2-f07-blocker', 'wp2-f07-gate'],
      verificationRequirements: [{ requirementId: 'wp2-f07-check', requirementLevel: 'required', kind: 'test',
        description: 'F07 test' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const plans = createPlanService({ records: f.records, materials: materialsFor(f),
    initialPlanning: { bodies: f.bodies }, now: f.now, eventId: f.newId });
  const proposed = await plans.proposePlan(f.ctx, { input: { goalRef, basedOn: null, draft,
    reason: { text: 'F07 deferred plan', sources: [] } },
    meta: { requestId: 'f07-deferred-propose', expected: [{ ref: goalRef, revision: 1 }] } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`F07 deferred Plan proposal: ${JSON.stringify(proposed)}`);
  }
  const applied = await plans.applyPlanChange(f.ctx, { input: { proposalRef: proposed.value.ref,
    expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    meta: { requestId: 'f07-deferred-apply', expected: [{ ref: goalRef, revision: 1 }] } });
  if (applied.status !== 'committed') throw new Error(`F07 deferred Plan adoption: ${JSON.stringify(applied)}`);

  const candidateProposalIds: string[] = [];
  for (let index = 0; index < F07_CANDIDATE_COUNT; index += 1) {
    const proposalId = `wp2-f07-candidate-${String(index).padStart(3, '0')}`;
    candidateProposalIds.push(proposalId);
    const proposal: PlanProposal = { kind: 'candidate_v2',
      ref: { aggregateType: 'PlanProposal', projectId: GOAL_B.projectId, workspaceId: WORKSPACE.workspaceId,
        proposalId },
      revision: 1, schemaVersion: 2, goalRef, basedOn: planRef, draft,
      reason: { text: `F07 filler ${String(index)}`, sources: [] },
      status: 'candidate', issues: [], requestRef: null };
    await f.seedCandidateProposal(proposal);
  }

  const goalCauseReader = createGoalDecisionCauseReader({ records: f.records, plans });
  return { f, goalRef, candidateProposalIds,
    queue: realDecisionQueue(f, [createGoalCauseCardSource(goalCauseReader)]) };
}

describe('WP2 context extensions provider (module side; E2 evidence in WP2-wiring)', () => {
  it('F05 the reader returns the real Goal autonomy saved by the owner', async () => {
    const f = await openS5DecisionFixture('memory');
    closers.push(() => f.close());
    const service = createGoalSettingsService({ records: f.records, now: f.now, newId: f.newId,
      operatorActor: f.operatorActor });
    const read = createContextExtensionsReader({ anomalies: anomalyDouble(), hostActor: HOST_ACTOR, goalSettings: service });
    const request: ContextReadRequestV1 = { goalRef: GOAL_B, focusTaskIds: [] };
    expect(readyExtensions(await read(f.ctx, request)).goalSettings)
      .toEqual({ availability: 'available', autonomy: 'after_plan_confirmation' });

    // Change the autonomy through the real owner; the next read shows the new value.
    const saved = await service.setGoalSettings(f.ctx, {
      input: { goalRef: GOAL_B, autonomy: 'every_step', waitForGoalRef: null },
      meta: { requestId: 'wp2-c5-set-autonomy', expected: [{ ref: GOAL_B, revision: 7 }] },
    });
    expect(saved.status).toBe('committed');
    expect(readyExtensions(await read(f.ctx, request)).goalSettings)
      .toEqual({ availability: 'available', autonomy: 'every_step' });

    // The uninstalled port keeps the old narrow behaviour.
    const reader3 = createContextExtensionsReader({ anomalies: anomalyDouble(), hostActor: HOST_ACTOR });
    expect(readyExtensions(await reader3(f.ctx, request)).goalSettings)
      .toEqual({ availability: 'not_implemented', autonomy: null });
  });

  it('F06 a real waiting-answer card becomes its literal L5 row and absent sources get explicit hint lines', async () => {
    const h = await openDecisionHarness();
    const sent = await sendDecisionRequest(h, 'F06 real decision');
    const source = sent.decision?.source;
    if (source === undefined) throw new Error('the sent decision request carries no decision source');
    const read = createContextExtensionsReader({ anomalies: anomalyDouble(), hostActor: HOST_ACTOR, decisions: h.queue });
    const rows = readyExtensions(await read(h.f.ctx, { goalRef: GOAL_B, focusTaskIds: [] })).decisions.rows;
    // The row identity comes from the creating command's own decision source; its
    // captured Goal pin supplies the literal record source.
    const goalPin = source.pins[0];
    if (goalPin === undefined) throw new Error('the decision source captured no pins');
    expect(rows.find(row => row.key === `decision:${source.key}`)).toEqual({
      key: `decision:${source.key}`,
      node: { kind: 'goal', ref: GOAL_B },
      text: `待决定：message；source=${source.key}`,
      sources: [{ kind: 'record', ref: GOAL_B, revision: goalPin.revision, digest: null }],
    });
    // L5 literal hint rows for two sources production has not wired.
    expect(rows).toContainEqual({
      key: 'decision:not_available:note_review', node: { kind: 'goal', ref: GOAL_B },
      text: '待决来源尚未接入：note_review', sources: [],
    });
    expect(rows).toContainEqual({
      key: 'decision:not_available:message_release', node: { kind: 'goal', ref: GOAL_B },
      text: '待决来源尚未接入：message_release', sources: [],
    });
  });

  it('F06 answering the existing decision removes its row from the next real queue read', async () => {
    const h = await openDecisionHarness();
    const read = createContextExtensionsReader({ anomalies: anomalyDouble(), hostActor: HOST_ACTOR, decisions: h.queue });
    const request: ContextReadRequestV1 = { goalRef: GOAL_B, focusTaskIds: [] };
    const source = h.f.messages.decision.decision?.source;
    if (source === undefined) throw new Error('the S5 fixture decision message carries no decision source');
    const rowKey = `decision:${source.key}`;
    expect(readyExtensions(await read(h.f.ctx, request)).decisions.rows.map((row) => row.key)).toContain(rowKey);

    // Answer the EXISTING decision through the real owner. The next read uses
    // the same real queue: the answered card is no longer waiting, so the row is
    // gone without substituting an empty queue.
    const answered = await committed(await h.decisions.answerDecision(h.f.ctx, { input: { source,
      selection: { kind: 'option', optionId: 'accept' }, text: '', annotations: [] },
      meta: { requestId: h.f.newId(), expected: [await pin(h.f.records, h.f.messages.decision.ref), ...source.pins] } }));
    expect(answered.response).not.toBeNull();

    const rows = readyExtensions(await read(h.f.ctx, request)).decisions.rows.map((row) => row.key);
    expect(rows).not.toContain(rowKey);
  });

  it('F07 follows the real page boundary and keeps the named tail Task card under focus', async () => {
    const h = await openDeferredDecisionHarness();
    const read = createContextExtensionsReader({ anomalies: anomalyDouble(), hostActor: HOST_ACTOR, decisions: h.queue });
    const request = (focusTaskIds: string[]): ContextReadRequestV1 => ({ goalRef: h.goalRef, focusTaskIds });

    // The literal expected row order. The real queue served two pages: the 100
    // candidate cards, then the Task-linked goal_cause card (the named tail Task
    // card). The provider sorts the merged rows by key, so the three
    // not_available hint rows come first, then the goal_cause row, then the 100
    // candidate rows in their literal proposal id order. Every identity is
    // constructed from the fixture's literal values or the creating command's
    // own inputs; nothing is read back from the queue.
    const hintRowKeys = [
      'decision:not_available:message_release',
      'decision:not_available:note_review',
      'decision:not_available:planning_question',
    ];
    const deferredTaskPin: VersionPin = {
      ref: { aggregateType: 'Task', projectId: GOAL_B.projectId, goalId: h.goalRef.goalId,
        taskId: F07_DEFERRED_TASK_ID } as unknown as VersionPin['ref'],
      revision: 0,
    };
    const goalCauseRowKey = `decision:${decisionSourceKey({ kind: 'goal_cause', goalRef: h.goalRef,
      code: 'required_task_deferred', affected: [deferredTaskPin] })}`;
    // The 100 candidates also make the smallest one the Goal's pending proposal,
    // so the real display reader adds its Goal-level change_pending cause card.
    const pendingProposalPin: VersionPin = {
      ref: { aggregateType: 'PlanProposal', projectId: GOAL_B.projectId, workspaceId: WORKSPACE.workspaceId,
        proposalId: h.candidateProposalIds[0]! } as unknown as VersionPin['ref'],
      revision: 1,
    };
    const pendingGoalCauseRowKey = `decision:${decisionSourceKey({ kind: 'goal_cause', goalRef: h.goalRef,
      code: 'change_pending', affected: [pendingProposalPin] })}`;
    const candidateRowKeys = h.candidateProposalIds.map(proposalId => `decision:${decisionSourceKey({
      kind: 'candidate', goalRef: h.goalRef,
      proposalRef: { aggregateType: 'PlanProposal', projectId: GOAL_B.projectId,
        workspaceId: WORKSPACE.workspaceId, proposalId },
    })}`);
    const goalLevelRowKeys = [...hintRowKeys, pendingGoalCauseRowKey, ...candidateRowKeys];
    const allRowKeys = [...hintRowKeys, pendingGoalCauseRowKey, goalCauseRowKey, ...candidateRowKeys];

    // Empty focus reads every page and keeps the named tail Task card.
    expect(readyExtensions(await read(h.f.ctx, request([]))).decisions.rows.map(row => row.key))
      .toEqual(allRowKeys);
    // Focus on the deferred Task keeps the Task card; the Goal-level rows stay.
    expect(readyExtensions(await read(h.f.ctx, request([F07_DEFERRED_TASK_ID]))).decisions.rows.map(row => row.key))
      .toEqual(allRowKeys);
    // Any other focus drops the Task-linked card and nothing else.
    expect(readyExtensions(await read(h.f.ctx, request(['unrelated-task']))).decisions.rows.map(row => row.key))
      .toEqual(goalLevelRowKeys);
  });

  it('F07 exactly 5,000 real waiting cards succeed and one more is a capacity rejection', async () => {
    const h = await openDecisionHarness();
    const read = createContextExtensionsReader({ anomalies: anomalyDouble(), hostActor: HOST_ACTOR, decisions: h.queue });
    const request: ContextReadRequestV1 = { goalRef: GOAL_B, focusTaskIds: [] };
    // The real Goal B queue already serves 4 waiting cards; 4,996 new real
    // decision requests bring the input window to exactly the L6 bound of 5,000.
    const created: string[] = [];
    for (let index = 0; index < 4_996; index += 1) {
      const sent = await sendDecisionRequest(h, `Real decision ${String(index)}`);
      const source = sent.decision?.source;
      if (source === undefined) throw new Error('the sent decision request carries no decision source');
      created.push(`decision:${source.key}`);
    }
    const exact = readyExtensions(await read(h.f.ctx, request));
    const keys = new Set(exact.decisions.rows.map(row => row.key));
    // Every created card has its row, including the named last one.
    for (const key of created) expect(keys.has(key)).toBe(true);
    expect(keys.has(created.at(-1)!)).toBe(true);
    // The four pre-existing Goal B seed cards are present with independently
    // specified identities: the pending decision message, the two request
    // candidates and the A/B conflict, all named by the frozen fixture's literal
    // values, never by a queue readback.
    const seedKeys = [
      `decision:${decisionSourceKey({ kind: 'message', messageRef: h.f.messages.decision.ref })}`,
      `decision:${decisionSourceKey({ kind: 'candidate', goalRef: GOAL_B, requestRef: h.f.requests.Q1.ref })}`,
      `decision:${decisionSourceKey({ kind: 'candidate', goalRef: GOAL_B, requestRef: h.f.requests.Q2.ref })}`,
      `decision:${decisionSourceKey({ kind: 'goal_conflict', pair: [
        { goalRef: GOAL_A, activePlanRef: PLAN_A1 }, { goalRef: GOAL_B, activePlanRef: PLAN_B1 },
      ] })}`,
    ];
    for (const key of seedKeys) expect(keys.has(key)).toBe(true);
    // The four literal L5 not_available hint rows for the seven card sources.
    const hintKeys = [
      'decision:not_available:goal_cause',
      'decision:not_available:note_review',
      'decision:not_available:planning_question',
      'decision:not_available:message_release',
    ];
    for (const key of hintKeys) expect(keys.has(key)).toBe(true);
    // 5,000 card rows plus the 4 literal not_available hint rows; nothing was
    // truncated, skipped or fabricated.
    expect(exact.decisions.rows).toHaveLength(5_004);

    // One more real waiting card pushes the input window past the cap: the whole
    // read is refused, never a half page.
    await sendDecisionRequest(h, 'Real decision overflow');
    const over = await read(h.f.ctx, request);
    expect(over.status).toBe('rejected');
    if (over.status !== 'rejected') throw new Error(`expected a capacity rejection: ${JSON.stringify(over)}`);
    expect(over.code).toBe('capacity');
    expect(over.reason.startsWith('decision_index_page_limit:')).toBe(true);
  }, 240_000);

  it('SUP (fault injection) an installed Goal-settings read failure fails the whole context read', async () => {
    const thrown = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      goalSettings: goalSettingsDouble(() => { throw new Error('settings boom'); }).port,
    });
    const thrownResult = await thrown(hostCtx(), REQUEST);
    expect(thrownResult).toMatchObject({ status: 'rejected', code: 'unavailable' });
    if (thrownResult.status !== 'rejected') throw new Error('expected a rejection');
    expect(thrownResult.reason.startsWith('goal_settings_read_failed:')).toBe(true);

    const notReady = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      goalSettings: goalSettingsDouble(() => ({
        status: 'not_ready', observed: null, required: { kind: 'platform', cursor: CURSOR_A },
      })).port,
    });
    const notReadyResult = await notReady(hostCtx(), REQUEST);
    expect(notReadyResult).toMatchObject({ status: 'rejected', code: 'incomplete' });
    if (notReadyResult.status !== 'rejected') throw new Error('expected a rejection');
    expect(notReadyResult.reason.startsWith('goal_settings_not_ready:')).toBe(true);

    const rejectedResult = { status: 'rejected', code: 'forbidden', reason: 'the Goal is outside the scope' } as const;
    const rejected = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      goalSettings: goalSettingsDouble(() => rejectedResult).port,
    });
    expect(await rejected(hostCtx(), REQUEST)).toEqual(rejectedResult);

    const missing = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      goalSettings: goalSettingsDouble(() => ({ status: 'not_found' })).port,
    });
    expect(await missing(hostCtx(), REQUEST)).toEqual({ status: 'not_found' });
  });

  it('SUP (fault injection) an installed decision-queue read failure fails the whole context read', async () => {
    const thrown = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      decisions: decisionsDouble(() => { throw new Error('queue boom'); }).port,
    });
    const thrownResult = await thrown(hostCtx(), REQUEST);
    expect(thrownResult).toMatchObject({ status: 'rejected', code: 'unavailable' });
    if (thrownResult.status !== 'rejected') throw new Error('expected a rejection');
    expect(thrownResult.reason.startsWith('decision_queue_read_failed:')).toBe(true);

    const notReady = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      decisions: decisionsDouble(() => ({
        status: 'not_ready', observed: null, required: { kind: 'platform', cursor: CURSOR_A },
      })).port,
    });
    const notReadyResult = await notReady(hostCtx(), REQUEST);
    expect(notReadyResult).toMatchObject({ status: 'rejected', code: 'incomplete' });
    if (notReadyResult.status !== 'rejected') throw new Error('expected a rejection');
    expect(notReadyResult.reason.startsWith('decision_queue_not_ready:')).toBe(true);

    const rejectedResult = { status: 'rejected', code: 'forbidden', reason: 'the Goal is outside the scope' } as const;
    const rejected = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      decisions: decisionsDouble(() => rejectedResult).port,
    });
    expect(await rejected(hostCtx(), REQUEST)).toEqual(rejectedResult);

    const moved = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      decisions: decisionsDouble((call) => call === 1
        ? queuePage({ waiting: [], nextCursor: 'p2', sourceCursor: CURSOR_A })
        : queuePage({ waiting: [], sourceCursor: CURSOR_B })).port,
    });
    const movedResult = await moved(hostCtx(), REQUEST);
    expect(movedResult).toMatchObject({ status: 'rejected', code: 'unavailable' });
    if (movedResult.status !== 'rejected') throw new Error('expected a rejection');
    expect(movedResult.reason.startsWith('decision_queue_window_changed:')).toBe(true);

    const conflict = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      decisions: decisionsDouble(() => queuePage({ waiting: [
        decisionCard({ cardKey: 'dup', kind: 'message' }),
        decisionCard({ cardKey: 'dup', kind: 'goal_cause' }),
      ] })).port,
    });
    const conflictResult = await conflict(hostCtx(), REQUEST);
    expect(conflictResult).toMatchObject({ status: 'rejected', code: 'unavailable' });
    if (conflictResult.status !== 'rejected') throw new Error('expected a rejection');
    expect(conflictResult.reason.startsWith('decision_index_conflict:')).toBe(true);
  });

  it('SUP (fault injection) an invalid decision-queue read is returned unchanged, never a seemingly-successful context', async () => {
    // §4.3.1/L4: every real refusal, `invalid` included, is the whole read's
    // refusal; an installed-but-invalid index must not yield a ready context.
    const invalidResult = {
      status: 'rejected', code: 'invalid', reason: 'a message source key is not a SessionMessageRef',
    } as const;
    const read = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      decisions: decisionsDouble(() => invalidResult).port,
    });
    expect(await read(hostCtx(), REQUEST)).toEqual(invalidResult);
  });

  it('SUP (fault injection) a foreign scope is refused before either new read owner is reached', async () => {
    // Either owner throwing would surface as goal_settings_read_failed /
    // decision_queue_read_failed, so the forbidden result proves both were
    // never reached; no call-count assertion is needed.
    const read = createContextExtensionsReader({
      anomalies: anomalyDouble(), hostActor: HOST_ACTOR,
      goalSettings: goalSettingsDouble(() => { throw new Error('must not be called'); }).port,
      decisions: decisionsDouble(() => { throw new Error('must not be called'); }).port,
    });
    const foreign: ContextReadRequestV1 = {
      goalRef: { aggregateType: 'Goal', projectId: 'other', goalId: GOAL_ID }, focusTaskIds: [],
    };
    expect(await read(hostCtx(), foreign)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});
