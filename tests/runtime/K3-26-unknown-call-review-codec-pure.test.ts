/**
 * K3-26 codec (finding F-064, L7): `unknownCallReviewBodyProblem` accepts an
 * item summary command of exactly 512 characters and refuses 513.
 *
 * Pure only: the record below is a complete hand-written body (built input to
 * the exported validator), never a read or a committed record. The two boundary
 * command strings and the exact refusal message are literals. No store,
 * platform, Host, Workflow or Runtime is imported. This file is also the F-046
 * codec target; other codec rows append here and stay self-contained.
 */
import { describe, expect, it } from 'vitest';
import type { UnknownCallReviewItemV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { unknownCallReviewBodyProblem } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';

const PROJECT = 'P';
const GOAL = 'g1';
const WORKSPACE = 'W';
const TASK = 't1';
const AT = '2026-10-17T00:00:00.000Z';
const RUN_REF = { aggregateType: 'Run' as const, projectId: PROJECT, goalId: GOAL, runId: 'run-1234abcd' };

function processItem(command: string): UnknownCallReviewItemV1 {
  return {
    alias: 1, callId: 'call-1', toolName: 'shell', kind: 'process', contained: true,
    kernel: {
      adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 'turn-1',
      callId: 'call-1', declaredPosition: 1, startedPosition: 1,
    },
    argumentsDigest: 'd'.repeat(64),
    summary: { command, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}

/** The same complete valid body with the one summary command as `command`. */
function reviewWith(command: string): UnknownCallReviewV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: GOAL, runId: RUN_REF.runId },
    schemaVersion: 1,
    revision: 1,
    workspaceId: WORKSPACE,
    task: { projectId: PROJECT, goalId: GOAL, taskId: TASK },
    runRef: RUN_REF,
    sessionRef: { projectId: PROJECT, sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: 'k3-26 codec' },
    inventory: 'complete',
    inventoryProblem: null,
    items: [processItem(command)],
    itemsOmitted: 0,
    workspace: {
      status: 'unavailable', runBaselineKnown: false, reason: 'not_configured',
      detail: 'the pure K3-26 codec test',
    },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    status: 'pending_review',
    open: 'yes',
    decisionReasons: [],
    dispositionTargets: ['call-1'],
    proposalTargets: ['call-1'],
    stateEntry: 1,
    activeRound: null,
    rounds: [],
    proposals: [],
    blockedCommands: [],
    disposition: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

const utf8BytesOf = (text: string): number => new TextEncoder().encode(text).length;

describe('K3-26 review body codec: the 512-character summary command boundary (F-064)', () => {
  it('K3-26: a 512-character summary command is accepted and a 513-character one is refused with the exact message', () => {
    // The unvaried body passes the validator, so the two boundary rows below are
    // about the command length alone.
    expect(unknownCallReviewBodyProblem(reviewWith('echo base'))).toBeNull();

    const at512 = reviewWith('a'.repeat(512));
    const command512 = at512.items[0]!.summary.command;
    if (command512 === null) throw new Error('the built record must carry a command');
    expect(command512).toHaveLength(512);
    expect(utf8BytesOf(command512)).toBe(512);
    expect(unknownCallReviewBodyProblem(at512)).toBeNull();

    const at513 = reviewWith('a'.repeat(513));
    const command513 = at513.items[0]!.summary.command;
    if (command513 === null) throw new Error('the built record must carry a command');
    expect(command513).toHaveLength(513);
    expect(utf8BytesOf(command513)).toBe(513);
    expect(unknownCallReviewBodyProblem(at513))
      .toBe('review item 0.summary.command must be null or at most 512 characters');
  });
});
