/**
 * K3 B3 rework 9, package B: F-098 pure card-summary ordering.
 *
 * A5: the pure projection is called with hand-built literals; no store,
 * platform, Host, Workflow, Runtime or stub port is imported or built. The
 * clock values are A8 inputs (plain values), not facts.
 */
import { describe, expect, it } from 'vitest';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { commandRerunRequestSummary } from '../../src/core/work-graph/tasks/command-rerun-request-card.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';
const T2 = '2026-01-03T00:00:00.000Z';

function request(overrides: {
  requestId: string; createdAt: string; revision: number; state?: CommandRerunRequestV1['state'];
  command?: string; declaredForms?: CommandRerunRequestV1['declaredForms'];
}): CommandRerunRequestV1 {
  return {
    ref: { aggregateType: 'CommandRerunRequest', projectId: 'p1', goalId: 'g1', taskId: 't1',
      requestId: overrides.requestId },
    schemaVersion: 1,
    revision: overrides.revision,
    workspaceId: 'w1',
    task: { projectId: 'p1', goalId: 'g1', taskId: 't1' },
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'p1', goalId: 'g1', runId: 'review-1' },
    runRef: { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'run-1' },
    alias: 3,
    command: overrides.command ?? `run ${overrides.requestId}`,
    commandSha256: `sha-${overrides.requestId}`,
    declared: false,
    declaredForms: overrides.declaredForms ?? [],
    match: { kind: 'exact' },
    reason: 'rerun after the check',
    state: overrides.state ?? 'allowed',
    answerMessageRef: null,
    allowedAt: null,
    usedAt: null,
    usedBy: null,
    createdAt: overrides.createdAt,
    updatedAt: overrides.createdAt,
  };
}

const review = {
  ref: { aggregateType: 'UnknownCallReview', projectId: 'p1', goalId: 'g1', runId: 'review-1' },
  revision: 4,
} as unknown as UnknownCallReviewV1;

const goal = {
  ref: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' },
  revision: 6,
} as unknown as GoalSnapshot;

function summaryOf(current: CommandRerunRequestV1, aliasRequests: CommandRerunRequestV1[]): string {
  return commandRerunRequestSummary({
    request: current, review, goal, blockedCommandText: 'npm run db:migrate',
    aliasRequests, taskActive: true,
  });
}

describe('F-098 card summary request order', () => {
  it('orders earlier requests by createdAt then requestRef descending, not by revision, and caps at five', () => {
    const current = request({ requestId: 'rq-current', createdAt: T2, revision: 5 });
    // Equal createdAt is NOT "earlier" (strictly before), whatever the ref order.
    const equal = request({ requestId: 'rq-zzz-equal', createdAt: T2, revision: 99 });
    const earlier = [
      request({ requestId: 'rq-b1', createdAt: T1, revision: 9, command: 'cmd-b1' }),
      request({ requestId: 'rq-b2', createdAt: T1, revision: 2, command: 'cmd-b2' }),
      request({ requestId: 'rq-b3', createdAt: T1, revision: 8, command: 'cmd-b3' }),
      request({ requestId: 'rq-b4', createdAt: T1, revision: 1, command: 'cmd-b4' }),
      request({ requestId: 'rq-b5', createdAt: T1, revision: 7, command: 'cmd-b5' }),
      request({ requestId: 'rq-b6', createdAt: T1, revision: 2, command: 'cmd-b6' }),
    ];
    const text = summaryOf(current, [current, equal, ...earlier]);
    const earlierLines = text.split('\n').filter(line => line.startsWith('以前：'));
    expect(earlierLines).toEqual([
      '以前：allowed；cmd-b6；允许重跑',
      '以前：allowed；cmd-b5；允许重跑',
      '以前：allowed；cmd-b4；允许重跑',
      '以前：allowed；cmd-b3；允许重跑',
      '以前：allowed；cmd-b2；允许重跑',
    ]);
  });

  it('lists an equal-createdAt sibling as neither newest nor earlier here, and keeps declared forms in declaration order', () => {
    const current = request({ requestId: 'rq-current', createdAt: T2, revision: 1 });
    const equal = request({ requestId: 'rq-zzz-equal', createdAt: T2, revision: 99 });
    const older = request({ requestId: 'rq-r1', createdAt: T1, revision: 2,
      declaredForms: [{ sha256: 'sha-old-1', text: 'old-1' }, { sha256: 'sha-old-2', text: 'old-2' }] });
    const oldest = request({ requestId: 'rq-r0', createdAt: T0, revision: 50,
      declaredForms: [{ sha256: 'sha-a', text: 'a' }] });
    const text = summaryOf(current, [current, equal, older, oldest]);
    expect(text).toContain('注明过的写法：a；old-1；old-2');
    const earlierLines = text.split('\n').filter(line => line.startsWith('以前：'));
    expect(earlierLines).toEqual(['以前：allowed；run rq-r1；允许重跑', '以前：allowed；run rq-r0；允许重跑']);
  });
});
