/**
 * The pure line-facts samples shared by the 2C and S7B line-status tests: one
 * Session record, one Run and the two `LineFactsV1` layers built from them.
 * Only `src` pure modules and types; no store, Host or Runtime.
 */
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { LineFactsV1, LineRunFactsV1 } from '../../src/core/work-graph/state/line-status.js';

export const P = 'p';
export const G = 'g';
export const W = 'w';
export const T0 = '2026-10-08T00:00:00.000Z';

export const TASK_A: TaskTriple = { projectId: P, goalId: G, taskId: 'A' };
export const PLAN: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
export const ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};
export const SESSION_H: SessionRef = { projectId: P, sessionId: 'h' };

export function sessionRecord(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ref: { ...SESSION_H, aggregateType: 'Session' }, revision: 3,
    kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-h' },
    lifecycle: 'active', health: 'available', healthConclusion: null,
    role: { kind: 'legacy_template', templateId: 'tpl', templateRevision: 'r1' }, workspaceId: W,
    lastExecutionRef: null, occupancy: null, historyCursor: null, createdAt: T0, archivedAt: null,
    provenance: { schemaVersion: 1, kind: 'new' }, archiveRequest: null, unavailableSince: null,
    ...over,
  };
}

export function runOf(ref: RunRef, over: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    ref, revision: 4, schemaVersion: 1, task: TASK_A, attemptId: `${ref.runId}-attempt`, planRef: PLAN,
    roleBinding: ROLE_BINDING, budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 1 },
    status: 'ended', outcome: 'completed', exitCode: 0, lastEventSeq: 2, lastRuntimeEventId: `rt-${ref.runId}`,
    lastFactEventId: `ev-${ref.runId}`, envelope: null, startedAt: T0, endedAt: T0, previousRun: null, ...over,
  };
}

export function runFacts(run: RunSnapshot, over: Partial<LineRunFactsV1> = {}): LineRunFactsV1 {
  return { run, pointer: null, pointerFromGoal: false, wait: null, goalDesiredState: 'active', ...over };
}

export function facts(over: Partial<LineFactsV1> = {}): LineFactsV1 {
  return {
    head: sessionRecord(), chain: [], omitted: { status: 'exact', value: 0 }, duty: 'executor',
    holder: null, latestWork: null, responsibleOpen: [], responsibleOpenOther: [],
    doneEvidence: { status: 'not_applicable' }, pausedTasks: [], lineCards: [],
    writtenAnchorsPending: { status: 'exact', value: 0 }, copies: [], undelivered: { status: 'not_applicable' },
    partialParts: [], handoffFrom: null, handoffFromLine: null, handedTo: null,
    unknownCallReviewsPending: 0, queueComplete: true, pinned: false, lastActivityAt: T0,
    ...over,
  };
}
