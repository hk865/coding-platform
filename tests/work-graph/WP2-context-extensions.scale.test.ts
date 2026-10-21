/**
 * Wiring package 2, group C scale rows (spec §5.2): F07's 100-candidate tail
 * page and the 5,000/5,001-card capacity edge, moved verbatim from
 * `WP2-context-extensions.test.ts`. Sizes, backends, assertions and timeouts
 * are unchanged and no page width is injected here.
 */
import type { ActorRef, CommitCursor } from '../../src/contracts/command-event.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ContextExtensionsV1 } from '../../src/contracts/graph-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { SessionAnomalyViewV1 } from '../../src/contracts/session-anomaly.js';
import type { DecisionCardSourcePort, DecisionReadPort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ContextReadRequestV1 } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createSessionAnomalyService, type SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createContextExtensionsReader } from '../../src/core/work-graph/views/context-extensions.js';
import { createDecisionReadModel, createGoalCauseCardSource } from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { GOAL_A, GOAL_B, OPERATOR, PLAN_A1, PLAN_B1, PROJECT, WORKSPACE, WORKSPACE_SCOPE, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { committed, mailboxDependencies, materialsFor, pin, workContext } from '../helpers/S5-queue-support.js';
import { afterEach, describe, expect, it } from 'vitest';

/** Real-store fixtures opened by a test; every one is closed after it. */
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

const HOST_ACTOR: Extract<ActorRef, { kind: 'human' | 'system' }> = { kind: 'system', id: 'wp2-ctx-host' };
const CURSOR_A = 'wp2-cursor-a' as CommitCursor;

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
      catalog: createArchitectureCatalogService({ records: f.records }),
      executedFiles: createGoalExecutedFilesReader({ records: f.records }) }),
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
  /** W2b-22: the real SessionAnomaly reader over the same world's records. */
  anomalies: SessionAnomalyPort;
  goalRef: GoalRef;
  candidateProposalIds: string[];
};

/**
 * A Goal whose required work Task is deferred through the real Plan writers
 * (`createGoalService` + `createPlanService`), so its Goal display carries
 * `required_task_deferred` and the real goal-decision reader prepares a real
 * Task-linked `goal_cause` card. Then 100 real `candidate_v2` proposals are
 * submitted through the public `plans.proposePlan` owner (each with its own
 * real request id); the returned proposal ids are sorted before the literal
 * row keys are built, so the real queue's 100-per-page window puts that Task
 * card on its second (tail) page.
 *
 * W2b-21: the world is the S5 fixture's real path: its Sessions come from the
 * production Session operation owner and its running Run RA is entered by the
 * shared real Runtime, so no Session, Kernel identity or entered fact is
 * handwritten under this row.
 */
async function openDeferredDecisionHarness(kind: 'memory' | 'sqlite'): Promise<DeferredDecisionHarness> {
  const f = await openS5DecisionFixture(kind, { realRuntime: true });
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

  const settings = createGoalSettingsService({ records: f.records, now: f.now, newId: f.newId,
    operatorActor: f.operatorActor });
  const current = await settings.readGoalSettings(f.ctx, { goalRef });
  if (current.status !== 'ready') throw new Error(`F07 deferred Goal read: ${JSON.stringify(current)}`);
  // Adoption incremented the Goal; every proposed candidate is guarded by that
  // same current Goal pin (a proposal does not write the Goal itself).
  const goalRevision = current.value.goal.revision;

  const candidateProposalIds: string[] = [];
  for (let index = 0; index < F07_CANDIDATE_COUNT; index += 1) {
    const requestId = `f07-candidate-${String(index).padStart(3, '0')}`;
    const proposal = await plans.proposePlan(f.ctx, { input: { goalRef, basedOn: planRef, draft,
      reason: { text: `F07 filler ${String(index)}`, sources: [] } },
      meta: { requestId, expected: [{ ref: goalRef, revision: goalRevision }] } });
    if (proposal.status !== 'committed' || proposal.value.issues.length > 0) {
      throw new Error(`F07 candidate proposal ${requestId}: ${JSON.stringify(proposal)}`);
    }
    candidateProposalIds.push(proposal.value.ref.proposalId);
  }
  // The real queue picks the pending candidate by its canonical ref key and the
  // provider sorts the L5 rows by key, so the literal expectation order is the
  // sorted returned proposal-id order, never the submission order.
  candidateProposalIds.sort();

  const goalCauseReader = createGoalDecisionCauseReader({ records: f.records, plans });
  // W2b-22: the provider's anomaly read goes to the real SessionAnomaly owner of
  // this same world (its Session facts over the same records), not a double.
  const anomalies = createSessionAnomalyService({ records: f.records, lookups: f.records,
    sessionFacts: createSessionFactsService({ records: f.records }), now: f.now });
  return { f, goalRef, candidateProposalIds, anomalies,
    queue: realDecisionQueue(f, [createGoalCauseCardSource(goalCauseReader)]) };
}

describe('WP2 context extensions provider (module side; E2 evidence in WP2-wiring)', () => {
  it.each(['memory', 'sqlite'] as const)('F07 %s follows the real page boundary and keeps the named tail Task card under focus', async kind => {
    const h = await openDeferredDecisionHarness(kind);
    const read = createContextExtensionsReader({ anomalies: h.anomalies, hostActor: HOST_ACTOR, decisions: h.queue });
    const request = (focusTaskIds: string[]): ContextReadRequestV1 => ({ goalRef: h.goalRef, focusTaskIds });

    // The literal expected row order. The real queue served two pages: the 100
    // candidate cards, then the Task-linked goal_cause card (the named tail Task
    // card). Every row key is written out from the spec format below; the only
    // values taken from the platform are the proposal ids the real `proposePlan`
    // returned, used as returned. Nothing is read back from the queue.
    //
    // Spec: a card row's key is 'decision:' + card.cardKey and the merged rows are
    // sorted by key in character-code order (wiring-2 §4.3 items 4 and 6, L5);
    // the card key is the source identity (slice-5 §4.1), written as canonical
    // JSON: object keys in UTF-16 code-unit order, no whitespace (slice-5 §2:
    // the full ref's canonical JSON is the key). So:
    //   GoalRef      {"aggregateType":"Goal","goalId":"wp2-f07-deferred-goal","projectId":"P"}
    //   proposal     {"aggregateType":"PlanProposal","projectId":"P","proposalId":<id>,"workspaceId":"W"}
    //   goal_cause   {"affected":[<pins>],"code":<code>,"goalRef":<GoalRef>,"kind":"goal_cause"}
    //   candidate    {"goalRef":<GoalRef>,"kind":"candidate","proposalRef":<proposal>}
    //   a pin        {"ref":<ref>,"revision":<n>}
    // The deferred Task's pin is the L5 Task designation
    // {aggregateType:'Task',projectId,goalId,taskId}@0. The 100 candidates also
    // make the smallest proposal id the Goal's pending proposal, so the real
    // display reader adds its Goal-level change_pending cause, pinned at that
    // proposal's first revision, 1.
    // Order: 'n' (0x6E) < '{' (0x7B), so the three hint rows come first;
    // '{"affected"' < '{"goalRef"', so both goal_cause rows precede the candidates;
    // 'PlanProposal' < 'Task' ('P' < 'T'), so change_pending precedes
    // required_task_deferred; the candidate keys differ only in the proposal id,
    // so they follow the sorted proposal ids.
    const hintRowKeys = [
      'decision:not_available:message_release',
      'decision:not_available:note_review',
      'decision:not_available:planning_question',
    ];
    const goalJson = '{"aggregateType":"Goal","goalId":"wp2-f07-deferred-goal","projectId":"P"}';
    const proposalJson = (proposalId: string): string =>
      `{"aggregateType":"PlanProposal","projectId":"P","proposalId":"${proposalId}","workspaceId":"W"}`;
    const goalCauseRowKey = 'decision:{"affected":[{"ref":{"aggregateType":"Task","goalId":"wp2-f07-deferred-goal",'
      + '"projectId":"P","taskId":"wp2-f07-deferred-work"},"revision":0}],"code":"required_task_deferred",'
      + `"goalRef":${goalJson},"kind":"goal_cause"}`;
    const pendingGoalCauseRowKey = `decision:{"affected":[{"ref":${proposalJson(h.candidateProposalIds[0]!)},"revision":1}],`
      + `"code":"change_pending","goalRef":${goalJson},"kind":"goal_cause"}`;
    const candidateRowKeys = h.candidateProposalIds.map(proposalId =>
      `decision:{"goalRef":${goalJson},"kind":"candidate","proposalRef":${proposalJson(proposalId)}}`);
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

  // Lead (2A §5.3, frozen): wiring 2's temporary 5,000-card bound is removed
  // (2A §0.4); 5,001 real waiting cards are all read, nothing is refused.
  it('F07 5,000 real waiting cards are all read and one more is read too (no capacity bound)', async () => {
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

    // One more real waiting card: the read still succeeds and carries it, with
    // every earlier row kept (5,001 card rows plus the 4 hint rows).
    const overflow = await sendDecisionRequest(h, 'Real decision overflow');
    const overflowSource = overflow.decision?.source;
    if (overflowSource === undefined) throw new Error('the sent decision request carries no decision source');
    const over = readyExtensions(await read(h.f.ctx, request));
    const overKeys = new Set(over.decisions.rows.map(row => row.key));
    expect(overKeys.has(`decision:${overflowSource.key}`)).toBe(true);
    for (const key of [...created, ...seedKeys, ...hintKeys]) expect(overKeys.has(key)).toBe(true);
    expect(over.decisions.rows).toHaveLength(5_005);
  }, 240_000);
});
