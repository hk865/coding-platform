/** Slice 5 round 2, group D: T-R2-1 attribution and LB-2 tool replay. */
import { afterEach, describe, expect, it } from 'vitest';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { DecisionApplicationReceiptV1 } from '../../src/contracts/core/session-message.js';
import { decisionSourceKey, type UserDecisionBodyV1 } from '../../src/contracts/goal-decisions.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createWhiteboardTools } from '../../src/core/agent-runtime/whiteboard-tools.js';
import { createSessionMailboxTools } from '../../src/core/agent-runtime/communication-tools.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createInitializationBindingReader } from '../../src/core/work-graph/tasks/goal-confirm-service.js';
import { createToolCommitLookup } from '../../src/composition/tool-commit-lookup.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { decodePlanRevisionAcceptedEvent } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { WorkspaceSandbox, type ToolCall, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import {
  GOAL_B, PLAN_B1, T, WORKSPACE_SCOPE, openS5DecisionFixture,
  type S5DecisionFixture, type S5FixtureKind, type S5Records,
} from '../helpers/S5-decision-fixture.js';
import { decoded, goalAt, keyOf, messageAt, owners, pin } from '../helpers/S5-application-support.js';
import { committed, modelRequests, ready, realOwners, workContext } from '../helpers/S5-user-message-support.js';

const fixtures: S5DecisionFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const answerBody: UserDecisionBodyV1 = {
  schemaVersion: 1, kind: 'user_decision_response', selection: { kind: 'other' },
  text: 'Adopt this future plan and preserve the running work.', annotations: [],
};

function call(name: string, callId: string, args: Record<string, unknown>): ToolCall {
  // The same Kernel JSON-boundary cast as frozen W2-future-intent-platform/TU.
  return { schemaVersion: 1, name, callId, arguments: args as ToolCall['arguments'] };
}
function toolJson(result: ToolResult): unknown {
  expect(result.output).toHaveLength(1);
  const output = result.output[0];
  if (output === undefined || output.kind !== 'json') throw new Error('expected one JSON tool output');
  return output.value;
}
function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected a JSON object');
  return Object.fromEntries(Object.entries(value));
}

/** Only add an unassigned planning node; every traced Task definition stays intact. */
function futureDraft(f: S5DecisionFixture): PlanRevisionDraft {
  const source = f.plans.B1;
  return {
    schemaVersion: 2, planId: 'PB2-R2D', planRevision: 2, goalId: 'B',
    stages: structuredClone(source.stages),
    tasks: [...structuredClone(source.tasks), {
      taskId: 'b-r2d-future', title: 'Consider the next change', taskKind: 'work',
      requirementLevel: 'optional', disposition: 'active', phase: 'pending',
      scope: { kind: 'goal' }, executionIntent: 'plan_only',
    }],
    assignments: structuredClone(source.assignments ?? []),
    obligations: structuredClone(source.obligations),
    taskHierarchy: structuredClone(source.taskHierarchy), executionDag: structuredClone(source.executionDag),
  };
}

async function harness(kind: S5FixtureKind) {
  const f = await openS5DecisionFixture(kind, { duties: ['adviser'],
    preEntryTools: ['propose_future_plan'] });
  fixtures.push(f);
  // Armed only for R2D03's retry, and only for the saved answer's record read.
  const fault = { answerKey: '', armed: false, hits: 0 };
  const records: S5Records = { ...f.records, async readMany(keys) {
    if (fault.armed && keys.includes(fault.answerKey)) {
      fault.hits += 1;
      return { status: 'rejected', code: 'unavailable', reason: 'R2D03 answer pre-read unavailable' };
    }
    return f.records.readMany(keys);
  } };
  const messages = realOwners(f, ['adviser'], records);
  const reads = owners(f, records).reads;
  const executions = createRunStateReader({ records });
  const plans = createPlanService({ records, bindings: createInitializationBindingReader({ records }),
    now: f.now, eventId: f.newId, operatorActor: f.operatorActor,
    delegatedWrites: {
      reads: executions,
      roles: createRoleConfigurationService({ records, now: f.now, eventId: f.newId }),
      bodies: f.bodies,
      authorizeConfiguration: async (_ctx, input) => ({ status: 'ready', value: {
        configurationRevision: input.configurationRevision,
        permissions: structuredClone(input.permissions), hostTemplate: structuredClone(input.hostTemplate),
      } }),
    },
  });
  const execution = ready(await executions.readExecution(f.ctx, f.runRA.ref));
  expect(execution.run).toMatchObject({ ref: f.claimRA.runRef, status: 'running',
    executionAuthorization: { schemaVersion: 2, phase: 'entered' },
    envelope: { permissions: { tools: expect.arrayContaining(['propose_future_plan']) } } });
  expect(execution.outbox.claim.sessionRef).toEqual(f.sessionS);
  expect(await goalAt(records)).toMatchObject({ ref: GOAL_B, revision: 7,
    activePlanRevision: PLAN_B1, settings: { autonomy: 'after_plan_confirmation' } });
  const sandbox = await WorkspaceSandbox.create(f.base.directory);
  const context = workContext(f);
  const requestIdForCall = (toolCall: Readonly<ToolCall>) =>
    `s5r2-d:${f.runRA.ref.runId}:${toolCall.name}:${toolCall.callId}`;
  const whiteboardConfig = { plans, context, goalRef: GOAL_B, requestIdForCall };
  const definitions = [
    ...createWhiteboardTools(whiteboardConfig).create(sandbox),
    ...createSessionMailboxTools({ mailbox: messages.mailbox, context, sessionRef: f.sessionS,
      requestIdForCall, decisionMessages: { ...messages.decisions, sendUserMessage: messages.mailbox.sendUserMessage },
    }).create(sandbox),
  ];
  // The real operator's mailbox tools: same owner/factory, bound to the fixture's Host ctx, so
  // registration and replay run as the actor that performed the adoption.
  const operatorDefinitions = createSessionMailboxTools({ mailbox: messages.mailbox, context: f.ctx, sessionRef: f.sessionS,
    requestIdForCall, decisionMessages: { ...messages.decisions, sendUserMessage: messages.mailbox.sendUserMessage },
  }).create(sandbox);
  const executeWith = (tools: typeof definitions, name: string, callId: string, args: Record<string, unknown>) => {
    const tool = tools.find(item => item.name === name);
    if (tool === undefined) throw new Error(`missing real tool ${name}`);
    return tool.handler.execute(call(name, callId, args), { signal: new AbortController().signal });
  };
  const execute = (name: string, callId: string, args: Record<string, unknown>) => executeWith(definitions, name, callId, args);
  const executeAsOperator = (name: string, callId: string, args: Record<string, unknown>) =>
    executeWith(operatorDefinitions, name, callId, args);
  const queue = async () => ready(await reads.queryDecisionQueue(f.ctx, {
    workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
    sections: ['waiting_answer', 'answered_pending_application', 'history'], page: { limit: 100 },
  }));
  return { f, records, fault, messages, plans, reads, execute, executeAsOperator, queue };
}
type Harness = Awaited<ReturnType<typeof harness>>;

async function propose(h: Harness) {
  const result = await h.execute('propose_future_plan', 'propose', {
    basedOn: PLAN_B1, draft: futureDraft(h.f), reason: { text: 'Add future intent only.', sources: [] },
    expected: [pin(GOAL_B, 7), pin(PLAN_B1, 1)],
  });
  expect(result.status, JSON.stringify(result)).toBe('success');
  // Decode the JSON tool boundary just as the frozen W2 composition test does.
  const proposed = committed(toolJson(result) as WriteResult<PlanProposal>);
  expect(proposed.value).toMatchObject({ kind: 'candidate_v2', status: 'candidate', revision: 1,
    goalRef: GOAL_B, basedOn: PLAN_B1, issues: [],
    submittedBy: { runRef: h.f.runRA.ref, sessionRef: h.f.sessionS, roleBinding: h.f.runRA.roleBinding } });
  if (proposed.value.kind !== 'candidate_v2') throw new Error('Agent must propose a v2 candidate');
  expect(proposed.value.requestRef ?? null).toBeNull();
  expect(ready(await h.plans.readPlanProposal(h.f.ctx, proposed.value.ref))).toEqual(proposed.value);
  return proposed.value;
}

async function answeredCandidate(h: Harness) {
  const proposal = await propose(h);
  const cardKey = decisionSourceKey({ kind: 'candidate', goalRef: GOAL_B, proposalRef: proposal.ref });
  const cards = (await h.queue()).waitingAnswer.filter(card => card.cardKey === cardKey);
  expect(cards).toHaveLength(1);
  const card = cards[0];
  if (card === undefined) throw new Error('Agent candidate card missing');
  expect(card).toMatchObject({ state: 'waiting_answer', requestRef: null });
  expect(card.source.pins).toContainEqual(pin(proposal.ref, 1));
  const answer = committed(await h.messages.decisions.answerDecision(h.f.ctx, {
    input: { source: card.source, selection: answerBody.selection, text: answerBody.text, annotations: answerBody.annotations },
    meta: { requestId: 's5r2-d:answer', expected: card.source.pins },
  }));
  expect(answer).toMatchObject({ replayed: false, value: { revision: 1, status: 'responded', application: null,
    response: { decision: { selection: { kind: 'other' }, annotations: [], requiresApplication: true } } } });
  const saved = await messageAt(h.records, answer.value.ref);
  expect(saved).toMatchObject(answer.value);
  const response = saved.response;
  if (response === null || !('decision' in response)) throw new Error('committed user decision missing');
  expect(ready(await h.reads.readDecisionCard(h.f.ctx, { source: card.source })))
    .toMatchObject({ cardKey, state: 'answered_pending_application', answerMessageRef: answer.value.ref });
  expect((await h.queue()).counts.answeredPendingApplication).toBe(2);
  h.fault.answerKey = keyOf(answer.value.ref);
  return { proposal, source: card.source, answer, saved, answerSource: response.decision.source };
}
type Answered = Awaited<ReturnType<typeof answeredCandidate>>;

async function acceptedEvent(h: Harness, cursor: DecisionApplicationReceiptV1['cursor']) {
  const located = await h.records.eventAt(cursor);
  expect(located.status).toBe('ready');
  if (located.status !== 'ready') throw new Error('Plan acceptance event missing');
  expect(located.value.cursor).toBe(cursor);
  expect(located.value.event.eventType).toBe('PlanRevisionAccepted');
  return { event: decoded(decodePlanRevisionAcceptedEvent(located.value.event)),
    wire: jsonObject(JSON.parse(located.value.event.json)) };
}

async function adoptAsOperator(h: Harness, given: Answered) {
  const accepted = committed(await h.plans.applyPlanChange(h.f.ctx, {
    input: { proposalRef: given.proposal.ref, expectedProposalRevision: 1, decisionRefs: [],
      acknowledgementRef: given.answer.value.ref, decisionSource: given.answerSource },
    meta: { requestId: 's5r2-d:operator-apply', expected: [pin(GOAL_B, 7)] },
  }));
  expect(accepted).toMatchObject({ replayed: false, value: {
    ref: { aggregateType: 'PlanRevision', projectId: 'P', planId: 'PB2-R2D' }, revision: 1, planRevision: 2,
  } });
  const { event, wire } = await acceptedEvent(h, accepted.cursor);
  expect(event.payload.planRevision).toEqual(accepted.value);
  expect(event.payload.acknowledgementRef).toEqual(given.answer.value.ref);
  const proof = event.payload.decisionApplication;
  expect(proof).toBeDefined();
  if (proof === undefined) throw new Error('attributed acceptance must save its decision proof');
  expect(proof.acknowledgementRef).toEqual(given.answer.value.ref);
  expect(proof.capturedPins).toEqual(given.answerSource.pins);
  expect(proof.basisRebases).toEqual([]);
  const identityKey = wire['identityKey'];
  const fingerprint = wire['fingerprint'];
  expect(typeof identityKey).toBe('string');
  expect(typeof fingerprint).toBe('string');
  if (typeof identityKey !== 'string' || typeof fingerprint !== 'string') throw new Error('event receipt identity missing');
  expect(identityKey.length).toBeGreaterThan(0);
  expect(fingerprint.length).toBeGreaterThan(0);
  const applicationReceipt: DecisionApplicationReceiptV1 = { identityKey, fingerprint, cursor: accepted.cursor };
  const lookup = await h.records.lookupCommit(applicationReceipt);
  expect(lookup).toMatchObject({ status: 'ready', value: { cursor: accepted.cursor, eventIds: [event.eventId] } });
  return { accepted, applicationReceipt };
}

async function recordApplication(h: Harness, given: Answered, receipt: DecisionApplicationReceiptV1) {
  const before = await h.queue();
  expect(before.counts.answeredPendingApplication).toBe(2);
  const expected = ready(await createDecisionSourceFacts({ records: h.records, bindings: createInitializationBindingReader({ records: h.records }) }).readApplication(h.f.ctx, {
    answer: given.saved, receipt,
  }));
  expect(expected.actor).toEqual(h.f.operatorActor);
  expect(expected.appliedAt).toBe(T);
  const result = await h.executeAsOperator('record_decision_application', 'record', { messageRef: given.answer.value.ref, receipt });
  expect(result.status, JSON.stringify(result)).toBe('success');
  const recorded = committed(toolJson(result) as WriteResult<SessionMessage>);
  expect(recorded.replayed).toBe(false);
  expect(recorded.value.revision).toBe(given.answer.value.revision + 1);
  expect(recorded.value.revision).toBe(2);
  expect(recorded.value.application).toEqual(expected);
  expect(await messageAt(h.records, given.answer.value.ref)).toEqual(recorded.value);
  expect(ready(await h.reads.readDecisionCard(h.f.ctx, { source: given.source })))
    .toMatchObject({ cardKey: given.source.key, state: 'applied', application: expected });
  const after = await h.queue();
  expect(after.counts.answeredPendingApplication).toBe(1);
  expect(after.counts.answeredPendingApplication).toBe(before.counts.answeredPendingApplication - 1);
  return recorded;
}

describe.each(['memory', 'sqlite'] as const)('S5R2 Agent application (%s)', kind => {
  it('R2D02 records the operator\'s application and removes its pending card', async () => {
    const h = await harness(kind);
    const given = await answeredCandidate(h);
    const adopted = await adoptAsOperator(h, given);
    await recordApplication(h, given, adopted.applicationReceipt);
  });

  it('R2D03 replays the same application call when the retry answer pre-read is unavailable', async () => {
    const h = await harness(kind);
    const given = await answeredCandidate(h);
    const adopted = await adoptAsOperator(h, given);
    const first = await recordApplication(h, given, adopted.applicationReceipt);
    expect(h.fault.hits).toBe(0);
    const before = await h.f.storeSnapshot();
    const allocations = { ...h.f.allocationCounts };
    h.fault.armed = true;
    let retry: ToolResult;
    try {
      retry = await h.executeAsOperator('record_decision_application', 'record', {
        messageRef: given.answer.value.ref, receipt: adopted.applicationReceipt,
      });
    } finally { h.fault.armed = false; }
    expect(h.fault.hits).toBe(1);
    expect(retry.status, JSON.stringify(retry)).toBe('success');
    expect(toolJson(retry)).toEqual({ ...first, replayed: true });
    const after = await h.f.storeSnapshot();
    expect(after).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
    expect(modelRequests(after)).toEqual(modelRequests(before));
  });

  it('R2D04 lets the asking Agent read its original answer after operator adoption', async () => {
    const h = await harness(kind);
    const given = await answeredCandidate(h);
    const adopted = committed(await h.plans.applyPlanChange(h.f.ctx, {
      input: { proposalRef: given.proposal.ref, expectedProposalRevision: 1, decisionRefs: [],
        acknowledgementRef: given.answer.value.ref, decisionSource: given.answerSource },
      meta: { requestId: 's5r2-d:host-apply', expected: [pin(GOAL_B, 7)] },
    }));
    const { event } = await acceptedEvent(h, adopted.cursor);
    expect(event.actor).toEqual(h.f.operatorActor);
    expect(event.payload.acknowledgementRef).toEqual(given.answer.value.ref);
    expect(ready(await h.plans.readPlanProposal(h.f.ctx, given.proposal.ref)))
      .toMatchObject({ status: 'accepted', revision: 2 });
    const before = await h.f.storeSnapshot();
    const allocations = { ...h.f.allocationCounts };
    const result = await h.execute('read_user_decision', 'read-after-host-apply', { source: given.source });
    expect(result.status, JSON.stringify(result)).toBe('success');
    expect(toolJson(result)).toEqual({ message: given.saved, body: answerBody });
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
  });

  it('R2D05 refuses an acknowledgement ref in another Workspace without writing', async () => {
    const h = await harness(kind);
    const given = await answeredCandidate(h);
    const before = await h.f.storeSnapshot();
    const allocations = { ...h.f.allocationCounts };
    const result = await h.plans.applyPlanChange(h.f.ctx, {
      input: { proposalRef: given.proposal.ref, expectedProposalRevision: 1, decisionRefs: [],
        acknowledgementRef: { ...given.answer.value.ref, workspaceId: 'W2' }, decisionSource: given.answerSource },
      meta: { requestId: 's5r2-d:foreign-ack', expected: [pin(GOAL_B, 7)] },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await h.f.storeSnapshot()).toEqual(before);
    expect(h.f.allocationCounts).toEqual(allocations);
  });

  it('K3-39 record_decision_application reports not_committed through the production dispatch', async () => {
    const h = await harness(kind);
    const given = await answeredCandidate(h);
    const adopted = await adoptAsOperator(h, given);
    await recordApplication(h, given, adopted.applicationReceipt);
    // The PRODUCTION default table (`createToolCommitLookup` as composed in
    // `src/composition/tool-commit-lookup.ts`), in the production owner order;
    // the lookup is called with a Host ctx like the start-up reconcile.
    const lookup = createToolCommitLookup([
      h.messages.mailbox.lookupToolCommit, h.messages.decisions.lookupToolCommit, h.plans.lookupToolCommit,
    ]);
    const origin = { runRef: h.f.runRA.ref, sessionRef: h.f.sessionS,
      generation: h.f.claimRA.generation, workspaceId: h.f.ctx.workspaceId as string };
    const args = { messageRef: given.answer.value.ref, receipt: adopted.applicationReceipt };
    // The recorded application's sender is the operator; the dispatch reconstructs the
    // Agent origin, so this identity can never name the committed receipt.
    const miss = await lookup(h.f.ctx, {
      toolName: 'record_decision_application', arguments: args, kernelCallId: 'k3-39-decision-call-1', origin,
    });
    expect(miss).toEqual({ status: 'not_committed' });
  });
});
