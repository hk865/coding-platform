/**
 * K3 B3 rework 9, package B: F-099 A5 codec refusal.
 *
 * A5: the exported pure codec is called with a built, otherwise valid review
 * body; no store, platform, Host, Workflow, Runtime or stub port is imported or
 * built. The body is the codec's input, not a platform fact: no owner write or
 * record store is involved.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import {
  decodeUnknownCallReview, UNKNOWN_CALL_REVIEW_SCHEMA_ID,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';

const REF = { aggregateType: 'UnknownCallReview', projectId: 'p1', goalId: 'g1', runId: 'run-1' };

function validBody(cwd: string): Record<string, unknown> {
  return {
    ref: REF,
    schemaVersion: 1,
    revision: 2,
    workspaceId: 'w1',
    task: { projectId: 'p1', goalId: 'g1', taskId: 't1' },
    runRef: { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'run-1' },
    sessionRef: { projectId: 'p1', sessionId: 'session-1' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator-1' },
      reason: 'operator attested the review' },
    inventory: 'complete',
    inventoryProblem: null,
    items: [],
    itemsOmitted: 0,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'no_baseline', detail: '' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    status: 'resolved',
    open: 'no',
    decisionReasons: [],
    dispositionTargets: null,
    proposalTargets: null,
    stateEntry: 1,
    activeRound: null,
    rounds: [],
    proposals: [{
      proposalId: 'proposal-1',
      callId: 'call-1',
      alias: 1,
      command: 'npm run db:migrate',
      cwd,
      rationale: 'safer method',
      roundRunRef: { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'run-1' },
    }],
    blockedCommands: [],
    disposition: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function recordOf(body: Record<string, unknown>): EncodedRecord {
  return {
    refKey: canonicalJson(REF as never),
    schemaId: UNKNOWN_CALL_REVIEW_SCHEMA_ID,
    revision: body['revision'] as number,
    json: JSON.stringify(body),
  };
}

describe('rejects: proposal.cwd', () => {
  it('refuses an otherwise valid body whose only defect is proposal.cwd = \'\'', () => {
    expect(decodeUnknownCallReview(recordOf(validBody('app'))).status).toBe('decoded');
    const refused = decodeUnknownCallReview(recordOf(validBody('')));
    expect(refused.status).toBe('invalid');
    if (refused.status !== 'invalid') throw new Error('an empty proposal.cwd was accepted');
    expect(refused.reason).toBe(
      'UnknownCallReview record payload is invalid: review proposal.cwd must be null or 1..512 UTF-8 bytes');
  });
});
