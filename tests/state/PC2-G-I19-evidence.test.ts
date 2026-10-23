/**
 * PC-2 G2-03/G2-04 (book rulings 12/17): the I-19 continuation-brief evidence
 * is independent of the production renderer.
 *
 * Every expected value here is a hand-written literal: the brief is a
 * hand-built `ContinuationBriefV1` (not `assembleContinuationBrief`), the digest
 * is the precomputed literal sha256 of its canonical JSON, the personal
 * template/string table/tool list are test literals, and the full text and both
 * byte boundaries are hand-computed from them. The production checker must
 * agree by re-rendering with exactly this frozen material.
 */
import { describe, expect, it } from 'vitest';
import type { ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import type { RunSnapshot, TaskAttemptRef, RunRef } from '../../src/contracts/dispatch.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskClaimOutbox } from '../../src/core/work-graph/model/claim-contracts.js';
import {
  checkI19ContinuationBriefBinding, emptyInvariantWorld, type InvariantManifest, type InvariantWorld,
} from './invariants.js';

const PROJECT = 'pc2g';
const GOAL = 'pc2g-goal';
const TASK = 'pc2g-task';
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId });
const PREVIOUS_RUN = runRef('pc2g-previous-run');
const RUN = runRef('pc2g-run');
const TASK_TRIPLE = { projectId: PROJECT, goalId: GOAL, taskId: TASK };
const PREVIOUS_SESSION: SessionRef = { projectId: PROJECT, sessionId: 'pc2g-previous-session' };
const PREVIOUS_ATTEMPT: TaskAttemptRef = {
  aggregateType: 'TaskAttempt', projectId: PROJECT, goalId: GOAL, taskId: TASK, attemptId: 'pc2g-previous-attempt',
};

/** Hand-built brief; no production assembler and no production renderer generates any expected value below. */
const brief: ContinuationBriefV1 = {
  schemaVersion: 1,
  runRef: RUN,
  task: TASK_TRIPLE,
  requeueRef: { aggregateType: 'TaskRequeue', projectId: PROJECT, goalId: GOAL, taskId: TASK, afterRunId: PREVIOUS_RUN.runId },
  mode: 'rework',
  failureClass: 'check_failed',
  trigger: { actorClass: 'system', goalResume: false, requeueNumber: 1, autoRework: null, earlierRequeues: [] },
  previous: {
    runRef: PREVIOUS_RUN,
    attemptRef: PREVIOUS_ATTEMPT,
    sessionRef: PREVIOUS_SESSION,
    outcome: 'completed',
    origin: 'observed',
    interruption: null,
    cancelledBy: null,
    error: null,
    limit: null,
    budget: null,
    wait: null,
    unacceptedSteers: [],
    endedAt: null,
  },
  factsFrom: { runRef: PREVIOUS_RUN, hops: 0, truncated: false },
  stoppedAt: {
    kernel: 'unavailable', reason: null, turnStatus: null, lastPosition: null,
    lastToolGroup: null, lastAssistant: null, window: null,
  },
  toolCalls: {
    confirmed: [], notExecuted: [], unknown: [],
    confirmedOmitted: 0, notExecutedOmitted: 0, unknownOmitted: 0,
  },
  acceptedInputs: { steers: [], steersOmitted: 0, messages: [], messagesOmitted: 0 },
  checks: null,
  requeue: { reason: { text: 'hand-built rework', truncated: false }, reasonAuthor: 'system', newInputs: [] },
  workspace: {
    selfChanged: { status: 'not_entered', confirmed: [], possible: [], omitted: 0 },
    checkpoints: [],
    segments: [],
    unobserved: { from: 'previous_run_end', to: null, previousEndedAt: null },
    uncommitted: { status: 'not_git', baseCommit: null, paths: [], omitted: 0, reason: null },
  },
  session: {
    continuity: 'same_session_history', sessionRef: PREVIOUS_SESSION, seededFrom: null, boundaryPosition: null,
  },
  standingInstructionVersion: 1,
  // A present but empty anomaly section: exactly two string-dependent lines
  // render, so the hand-computed text distinguishes the frozen string table.
  anomalies: { anchors: [], omitted: 0, instructionVersion: 1 },
};

/** sha256(canonicalJson(brief)) computed once, outside the test, and frozen here. */
const DIGEST = '6af557b2b4f43af30876c6f8d15d2eef26ce1bdf5028c88b642d40aa586bdc37';

/** A personal template: the marker, the string-dependent anomaly lines, and one tool condition. */
const TEMPLATE = '## HAND-BRIEF\n{{marker}}\n{{anomalies}}\n{{#tool:read_source}}READ-SOURCE{{/tool:read_source}}{{#tool:look_graph}}LOOK-GRAPH{{/tool:look_graph}}';
/**
 * Hand-written literal table: only the keys this renderer reads for this
 * brief, no generated pack. Every non-rendered value is the same token; the
 * two anomaly lines are the personal strings the test distinguishes.
 */
const STRINGS: Record<string, string> = {
  'brief.actorClass.agent': 'X',
  'brief.actorClass.human': 'X',
  'brief.actorClass.system': 'X',
  'brief.anomaly.cause.archive_interrupted': 'X',
  'brief.anomaly.cause.retired_archive': 'X',
  'brief.anomaly.lastSentence': 'HAND-CLOSE',
  'brief.anomaly.mixedOwnership': 'X',
  'brief.anomaly.title': 'HAND-ANOMALY',
  'brief.blocked.state.allowed': 'X',
  'brief.blocked.state.denied': 'X',
  'brief.blocked.state.denied_final': 'X',
  'brief.blocked.state.pending': 'X',
  'brief.blocked.title': 'X',
  'brief.checkpoint.brief': 'X',
  'brief.checkpoint.requeue': 'X',
  'brief.checkpoint.round_open': 'X',
  'brief.clip.newlineIndent': 'X',
  'brief.clip.truncatedSuffix': 'X',
  'brief.continuity.sameHistoryLead': 'X',
  'brief.continuity.sameHistorySuffix': 'X',
  'brief.continuity.sessionPrefix': 'X',
  'brief.ending.observedLead': 'X',
  'brief.ending.observedSuffix': 'X',
  'brief.failureClass.cancelled': 'X',
  'brief.failureClass.check_failed': 'X',
  'brief.failureClass.check_incomplete': 'X',
  'brief.failureClass.interrupted': 'X',
  'brief.failureClass.run_failed': 'X',
  'brief.mode.rework': 'X',
  'brief.previous.runLead': 'X',
  'brief.previous.sessionOpen': 'X',
  'brief.requeue.none': 'X',
  'brief.requeue.reasonLead': 'X',
  'brief.requeue.reasonMiddle': 'X',
  'brief.review.autoSource': 'X',
  'brief.review.blocked': 'X',
  'brief.review.change.added': 'X',
  'brief.review.change.deleted': 'X',
  'brief.review.change.mode_changed': 'X',
  'brief.review.change.modified': 'X',
  'brief.review.change.not_visible': 'X',
  'brief.review.change.unchanged': 'X',
  'brief.review.change.unknown': 'X',
  'brief.review.diffReason.baseline_dirty': 'X',
  'brief.review.diffReason.binary': 'X',
  'brief.review.diffReason.not_text': 'X',
  'brief.review.diffReason.protected': 'X',
  'brief.review.diffReason.section_limit': 'X',
  'brief.review.diffReason.too_large': 'X',
  'brief.review.disposition.handle_myself': 'X',
  'brief.review.disposition.rerun_as_is': 'X',
  'brief.review.disposition.safer_method': 'X',
  'brief.review.disposition.skip_as_done': 'X',
  'brief.review.mode.create': 'X',
  'brief.review.mode.replace': 'X',
  'brief.review.noDisposition': 'X',
  'brief.review.notListed': 'X',
  'brief.review.source.card': 'X',
  'brief.review.source.direct': 'X',
  'brief.review.title': 'X',
  'brief.review.verdict.compare_in_continuation': 'X',
  'brief.review.verdict.done': 'X',
  'brief.review.verdict.no_review_needed': 'X',
  'brief.review.verdict.not_done': 'X',
  'brief.review.verdict.partial': 'X',
  'brief.review.verdict.pending': 'X',
  'brief.review.verdict.undetermined': 'X',
  'brief.section.previous': 'X',
  'brief.section.requeue': 'X',
  'brief.section.stoppedAt': 'X',
  'brief.section.toolCalls': 'X',
  'brief.section.workspace': 'X',
  'brief.sideEffect.confirmed': 'X',
  'brief.sideEffect.none': 'X',
  'brief.sideEffect.possible': 'X',
  'brief.stopRequester.goal_fan_out': 'X',
  'brief.stopRequester.human': 'X',
  'brief.stopRequester.none': 'X',
  'brief.stopRequester.system': 'X',
  'brief.stoppedAt.unavailable': 'X',
  'brief.summary.afterMode': 'X',
  'brief.summary.afterTask': 'X',
  'brief.summary.beforeActor': 'X',
  'brief.summary.beforeFailureClass': 'X',
  'brief.summary.lead': 'X',
  'brief.summary.requeueLead': 'X',
  'brief.toolCalls.noneUnavailable': 'X',
  'brief.toolGroup.confirmed': 'X',
  'brief.toolGroup.notExecuted': 'X',
  'brief.toolGroup.unknown': 'X',
  'brief.toolResult.cancelled': 'X',
  'brief.toolResult.error': 'X',
  'brief.toolResult.not_started': 'X',
  'brief.toolResult.outcome_unknown': 'X',
  'brief.toolResult.success': 'X',
  'brief.waitStatus.pending': 'X',
  'brief.waitStatus.read': 'X',
  'brief.waitStatus.responded': 'X',
  'brief.workspace.notGit': 'X',
  'brief.workspace.selfNotEntered': 'X',
  'brief.workspace.thisStart': 'X',
  'brief.workspace.timeUnknown': 'X',
  'brief.workspace.unobservedAfter': 'X',
  'brief.workspace.unobservedLead': 'X',
  'brief.workspace.unobservedMiddle': 'X',
  'brief.workspace.unobservedTail': 'X',
};
/** The manifest's explicit frozen tool list; it excludes `look_graph`, so the tool block renders nothing. */
const TOOL_NAMES = ['read_source'];
/**
 * Hand-computed: title + LF, marker + LF, the slot's leading LF and the empty
 * line of its own three-line array, the two personal strings, then the
 * template's LF and the in-list `read_source` block (out-of-list `look_graph`
 * is absent, so the text ends there).
 */
const FULL_TEXT = `## HAND-BRIEF\n[continuation-brief v1 sha256:${DIGEST}]\n\n\nHAND-ANOMALY\nHAND-CLOSE\nREAD-SOURCE`;
const FULL_BYTES = 147;

function world(range: { startByte: number; endByte: number }): InvariantWorld {
  const run = {
    ref: RUN, revision: 1, schemaVersion: 1, task: TASK_TRIPLE, attemptId: 'pc2g-attempt',
    requeueRef: brief.requeueRef, inputBinding: { continuationBriefDigest: DIGEST },
  } as unknown as RunSnapshot;
  const outbox = {
    ref: {
      aggregateType: 'DispatchOutboxEntry', projectId: PROJECT, goalId: GOAL, taskId: TASK, attemptId: run.attemptId,
    },
    claim: { runRef: RUN },
  } as unknown as TaskClaimOutbox;
  const manifest: InvariantManifest = {
    runRef: RUN, continuationBrief: brief, input: FULL_TEXT, continuationRange: range,
    promptTexts: { templates: { 'continuation-brief': TEMPLATE }, strings: STRINGS },
    toolNames: TOOL_NAMES, problem: null,
  };
  const value = emptyInvariantWorld(PROJECT);
  value.runs = [run];
  value.outboxes = [outbox];
  value.manifests = [manifest];
  return value;
}

describe('PC2 G2-03 I-19 independent evidence', () => {
  it('accepts the hand-computed full text and both boundaries', () => {
    expect(Buffer.byteLength(FULL_TEXT, 'utf8')).toBe(FULL_BYTES);
    expect(checkI19ContinuationBriefBinding(world({ startByte: 0, endByte: FULL_BYTES }))).toEqual([]);
  });

  it('rejects an end boundary one byte past the input', () => {
    expect(checkI19ContinuationBriefBinding(world({ startByte: 0, endByte: FULL_BYTES + 1 }))
      .map(violation => violation.message))
      .toEqual([`the manifest continuation range of Run ${RUN.runId} is outside the input`]);
  });
});
