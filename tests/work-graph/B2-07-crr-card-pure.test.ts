/**
 * B2-07 / L19a / rework 9 F-023: the `command_rerun_request` card summary and
 * its earlier-request block as a PURE projection.
 *
 * The request, the Goal, the review record and every sibling request are built
 * here and passed in; no store, platform, Host, Workflow, Runtime or test
 * fixture is imported. The expected summary is a hand-written literal (the
 * previous service row's oracle) and the fixed sentence is written out, never
 * taken from the production constant.
 *
 * Ruling 10 freezes the ordering: newest is the first of (`createdAt`
 * descending, `requestRef` descending); "earlier" is strictly before the
 * current `createdAt`, in that same order, at most five.
 */
import { describe, expect, it } from 'vitest';
import {
  commandRerunRequestCardFacts, commandRerunRequestSummary,
} from '../../src/core/work-graph/tasks/command-rerun-request-card.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

const projectId = 'P';
const workspaceId = 'W';
const goalId = 'g1';
const taskId = 't1';
const runId = 'run-0001';
const at = (second: number): string => `2026-10-08T00:00:${String(second).padStart(2, '0')}.000Z`;

const reviewRef = { aggregateType: 'UnknownCallReview' as const, projectId, goalId, runId };
const runRef = { aggregateType: 'Run' as const, projectId, goalId, runId };
const fixedSentence = '平台按文字和静态解析认出改写；没认出的，agent 要注明以后才请求。允许只放行这一种写法。';

const review: UnknownCallReviewV1 = {
  ref: reviewRef, schemaVersion: 1, revision: 1, workspaceId,
  task: { projectId, goalId, taskId }, runRef,
  sessionRef: { projectId, sessionId: 's1' },
  origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: 'b2-07 pure' },
  inventory: 'complete', inventoryProblem: null, items: [], itemsOmitted: 0,
  workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'b2-07 pure' },
  streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
  status: 'pending_review', open: 'yes', decisionReasons: [],
  dispositionTargets: null, proposalTargets: null, stateEntry: 1, activeRound: null,
  rounds: [], proposals: [], blockedCommands: [], disposition: null,
  createdAt: at(10), updatedAt: at(10),
};

const goal: GoalSnapshot = {
  ref: { aggregateType: 'Goal', projectId, goalId },
  workspaceRef: { aggregateType: 'Workspace', projectId, workspaceId },
  objective: 'Run the migration',
  desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null,
  activePlanRevision: null, revision: 4,
  settings: { schemaVersion: 1, autonomy: 'every_step', order: 0, waitForGoalRef: null, parallelRisks: [] },
  since: 'c0000000001' as GoalSnapshot['since'],
};

const baseRequest: CommandRerunRequestV1 = {
  ref: { aggregateType: 'CommandRerunRequest', projectId, goalId, taskId, requestId: 'now' },
  schemaVersion: 1, revision: 1, workspaceId,
  task: { projectId, goalId, taskId }, reviewRef, runRef,
  alias: 1, command: 'npm run migrate', commandSha256: 'a'.repeat(64),
  declared: false, declaredForms: [],
  match: { kind: 'exact', action: { text: 'npm run migrate', sha256: 'b'.repeat(64) } },
  reason: 'the migration must really run',
  state: 'pending', answerMessageRef: null, allowedAt: null, usedAt: null, usedBy: null,
  createdAt: at(10), updatedAt: at(10),
};

function sibling(requestId: string, command: string, createdAt: string): CommandRerunRequestV1 {
  return {
    ...baseRequest, ref: { ...baseRequest.ref, requestId }, command, createdAt,
    state: 'denied', answerMessageRef: null, allowedAt: null, usedAt: null, usedBy: null,
  };
}

describe('B2-07 pure: earlier requests are strictly before, newest first, at most five', () => {
  it('B2-07: shows the five newest strictly-earlier requests and never a later one', () => {
    const earlier = Array.from({ length: 6 }, (_unused, index) =>
      sibling(`earlier-${String(index)}`, `earlier-command-${String(index)}`, at(index)));
    const later = sibling('later', 'later-command', at(11));
    const facts = commandRerunRequestCardFacts({
      request: baseRequest, review, goal, blockedCommandText: 'npm run migrate',
      aliasRequests: [...earlier, later, baseRequest], taskActive: true,
    });
    const expected = [
      '#1@run-0001',
      '原命令：npm run migrate',
      '这次请求：npm run migrate',
      '命中：npm run migrate',
      '原因：the migration must really run',
      '以前：denied；earlier-command-5；不允许',
      '以前：denied；earlier-command-4；不允许',
      '以前：denied；earlier-command-3；不允许',
      '以前：denied；earlier-command-2；不允许',
      '以前：denied；earlier-command-1；不允许',
      fixedSentence,
    ].join('\n');
    expect(facts.summary).toBe(expected);
    // The oldest of the six is dropped by the five-row cap, not by the filter...
    expect(facts.summary).not.toContain('earlier-command-0');
    // ...while a sibling created AFTER this request is not an earlier request.
    expect(facts.summary).not.toContain('later-command');
    expect(facts.objects).toEqual([
      { kind: 'aggregate', pin: { ref: baseRequest.ref, revision: 1 }, label: expected },
    ]);
  });

  it('B2-07: equal createdAt orders by requestRef descending (tie frozen by ruling 10)', () => {
    const tieA = sibling('tie-a', 'tie-a-command', at(5));
    const tieZ = sibling('tie-z', 'tie-z-command', at(5));
    const summary = commandRerunRequestSummary({
      request: baseRequest, review, goal, blockedCommandText: 'npm run migrate',
      aliasRequests: [tieA, tieZ, baseRequest], taskActive: true,
    });
    expect(summary).toBe([
      '#1@run-0001',
      '原命令：npm run migrate',
      '这次请求：npm run migrate',
      '命中：npm run migrate',
      '原因：the migration must really run',
      '以前：denied；tie-z-command；不允许',
      '以前：denied；tie-a-command；不允许',
      fixedSentence,
    ].join('\n'));
  });
});
