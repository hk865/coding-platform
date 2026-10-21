/**
 * Copy-only edge inputs for the S3 renderers (inventory §4 item 2).
 *
 * One file, so the same harness runs on the base copy and on the result copy.
 * Every case is `{ name, probe, args }`; `edge.test.ts` calls the real renderer
 * and serialises the output with the probe serialiser.
 */
import { baseBrief } from '../helpers/K3-continuation-pure-fixture.js';
import type {
  ContinuationBriefV1, ContinuationUnknownCallReviewV1,
  ContinuationUnknownCallReviewItemV1, ContinuationBlockedCommandLineV1,
} from '../../src/contracts/continuation-brief.js';
import type { UnknownCallReviewInputV1 } from '../../src/contracts/core/prepared-execution.js';
import type {
  ArchitectureReminderFactsV1, ArchitectureReminderObservationV1,
} from '../../src/contracts/architecture-observation.js';
import type { FormalObservedFindingV1 } from '../../src/contracts/architecture-inspection.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { NoteAnchorV1, NoteKind } from '../../src/contracts/note.js';
import type { SessionAnomalyAnchorV1 } from '../../src/contracts/session-anomaly.js';
import type { ModuleRef } from '../../src/contracts/core/identity.js';

export type EdgeCase = { name: string; probe: string; args: unknown[] };

export const EDGE_CASES: EdgeCase[] = [];
function add(name: string, probe: string, ...args: unknown[]): void {
  EDGE_CASES.push({ name, probe, args });
}

const AT = '2026-10-08T00:00:00.000Z';
const TEXT_EDGES: Array<{ name: string; text: string }> = [
  { name: 'crlf', text: '第一行\r\n第二行\r\n' },
  { name: 'lone-lf', text: 'a\nb\n' },
  { name: 'chinese', text: '中文标点：，。；（）「」' },
  { name: 'emoji', text: '🙂🚀👩‍👩‍👧‍👦' },
  { name: 'combining', text: 'e\u0301a\u0308' },
  { name: 'slot', text: '{{slot}} {{#slot}} {{/slot}}' },
  { name: 'backticks', text: '`code` ```fence``` `x`' },
  { name: 'trailing', text: 'trailing spaces   ' },
];

// --------------------------------------------------------------------------
// Continuation brief.
// --------------------------------------------------------------------------
function brief(mutate: (value: ContinuationBriefV1) => void = () => {}): ContinuationBriefV1 {
  const value = baseBrief();
  mutate(value);
  return value;
}

const FAILURE_CLASSES = ['interrupted', 'cancelled', 'check_failed', 'run_failed', 'check_incomplete'] as const;
for (const failureClass of FAILURE_CLASSES) {
  add(`brief.failureClass.${failureClass}`, 'brief.render', brief(value => {
    value.failureClass = failureClass;
    value.mode = failureClass === 'interrupted' ? 'resume_after_interruption' : 'rework';
    value.trigger.earlierRequeues = [{ afterRunId: 'earlier-run', failureClass }];
  }));
}
for (const actorClass of ['human', 'system', 'agent'] as const) {
  add(`brief.actorClass.${actorClass}`, 'brief.render', brief(value => {
    value.trigger.actorClass = actorClass;
    value.requeue.reasonAuthor = actorClass;
  }));
}
for (const result of ['success', 'error', 'cancelled', 'not_started', 'outcome_unknown'] as const) {
  add(`brief.toolResult.${result}`, 'brief.render', brief(value => {
    value.toolCalls.confirmed = [{
      callId: `call-${result}`, name: 'shell', target: { text: 'src/a.ts', truncated: false },
      result, sideEffect: 'possible', changedPaths: ['src/a.ts'], changedPathsOmitted: 0,
      error: result === 'error' ? { text: 'failed', truncated: false } : null,
    }];
  }));
}
for (const sideEffect of ['none', 'possible', 'confirmed', null] as const) {
  add(`brief.sideEffect.${String(sideEffect)}`, 'brief.render', brief(value => {
    value.toolCalls.confirmed = [{
      callId: 'call-side', name: 'shell', target: null, result: 'success', sideEffect,
      changedPaths: [], changedPathsOmitted: 0, error: null,
    }];
  }));
}
for (const status of ['pending', 'read', 'responded'] as const) {
  add(`brief.wait.${status}`, 'brief.render', brief(value => {
    value.previous.wait = { messageRef: { aggregateType: 'SessionMessage', projectId: 'k3r-project', workspaceId: 'w', messageId: 'm1' }, status };
  }));
}
for (const kind of ['round_open', 'requeue', 'brief'] as const) {
  add(`brief.checkpoint.${kind}`, 'brief.render', brief(value => {
    value.workspace.checkpoints = [
      { kind, at: AT, workspaceRevision: 1, sourceDigest: 'a'.repeat(64), unavailableReason: null },
      { kind: 'brief', at: AT, workspaceRevision: 2, sourceDigest: 'b'.repeat(64), unavailableReason: null },
    ];
    value.workspace.segments = [{ from: 0, to: 1, verdict: 'changed', reason: 'digest differs' }];
    value.workspace.unobserved.to = 0;
  }));
}
for (const status of ['known', 'partial', 'not_entered', 'unavailable'] as const) {
  add(`brief.selfChanged.${status}`, 'brief.render', brief(value => {
    value.workspace.selfChanged = { status, confirmed: ['src/a.ts'], possible: ['src/b.ts'], omitted: 2 };
  }));
}
for (const status of ['git', 'not_git', 'unavailable'] as const) {
  add(`brief.uncommitted.${status}`, 'brief.render', brief(value => {
    value.workspace.uncommitted = status === 'git'
      ? { status, baseCommit: 'c'.repeat(40), paths: ['src/a.ts'], omitted: 3, reason: null }
      : { status, baseCommit: null, paths: [], omitted: 0, reason: status === 'unavailable' ? 'read failed' : null };
  }));
}
for (const verdict of ['changed', 'unchanged', 'unknown'] as const) {
  add(`brief.segment.${verdict}`, 'brief.render', brief(value => {
    value.workspace.checkpoints = [
      { kind: 'requeue', at: AT, workspaceRevision: 1, sourceDigest: 'a'.repeat(64), unavailableReason: null },
      { kind: 'brief', at: AT, workspaceRevision: 2, sourceDigest: 'b'.repeat(64), unavailableReason: null },
    ];
    value.workspace.segments = [{ from: 0, to: 1, verdict, reason: 'why' }];
    value.workspace.unobserved.to = null;
  }));
}
for (const continuity of [
  'same_session_history', 'same_session_without_previous_turn', 'other_session_seeded', 'other_session',
] as const) {
  add(`brief.continuity.${continuity}`, 'brief.render', brief(value => {
    value.session.continuity = continuity;
    value.session.seededFrom = continuity === 'other_session_seeded'
      ? { sessionRef: { projectId: 'k3r-project', sessionId: 'seed' }, throughPosition: 7 }
      : null;
    value.session.boundaryPosition = continuity === 'same_session_history' ? 7 : null;
  }));
}

function anchor(runId: string, cause: SessionAnomalyAnchorV1['cause'] = 'archive_interrupted'): SessionAnomalyAnchorV1 {
  return {
    ref: { aggregateType: 'SessionAnomalyAnchor', projectId: 'k3r-project', goalId: 'k3r-goal', runId },
    revision: 1, schemaVersion: 1, workspaceId: 'w',
    task: { projectId: 'k3r-project', goalId: 'k3r-goal', taskId: 'k3r-task' },
    planRef: { aggregateType: 'PlanRevision', projectId: 'k3r-project', planId: 'plan-1' },
    lineHead: { projectId: 'k3r-project', sessionId: 's' },
    sessionRef: { projectId: 'k3r-project', sessionId: 's' },
    role: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' },
    runRef: { aggregateType: 'Run', projectId: 'k3r-project', goalId: 'k3r-goal', runId },
    attemptRef: { aggregateType: 'TaskAttempt', projectId: 'k3r-project', goalId: 'k3r-goal', taskId: 'k3r-task', attemptId: 'a' },
    cause, archiveRequestId: `req-${runId}`,
    archiveRequestReceipt: { identityKey: `key-${runId}`, fingerprint: `fp-${runId}` },
    archivedBy: { kind: 'human', projectId: 'k3r-project', principalId: 'op' },
    recordedAt: AT,
    changedFiles: {
      source: 'kernel', status: 'known', confirmed: ['src/a.ts'], possible: [], omitted: 0,
      baseCommit: null, runBaselineKnown: false, reason: null,
    },
    resultVerification: 'not_checked',
  };
}

function reviewItem(alias: number, overrides: Partial<ContinuationUnknownCallReviewItemV1> = {}): ContinuationUnknownCallReviewItemV1 {
  return {
    alias, callId: `call-${String(alias)}`, toolName: 'shell', kind: 'process',
    summary: { text: `npm run step-${String(alias)}`, truncated: false },
    verdict: 'pending', evidence: null, crashSuspicion: null, reviewerConclusion: null, files: [],
    ...overrides,
  };
}

function review(overrides: Partial<ContinuationUnknownCallReviewV1> = {}): ContinuationUnknownCallReviewV1 {
  return {
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'k3r-project', goalId: 'k3r-goal', runId: 'r' },
    revision: 1, origin: 'takeover_unresolved', inventory: 'complete',
    items: [reviewItem(1)], itemsOmitted: 0, disposition: null,
    workspace: { status: 'captured', runBaselineKnown: true, notVisible: [], changedSample: [], changedOmitted: 0 },
    ...overrides,
  };
}

function blockedLine(alias: number): ContinuationBlockedCommandLineV1 {
  return {
    alias, reviewRunId: `run-${String(alias)}-0123456789`, requestState: alias % 2 === 0 ? 'pending' : null,
    declaredForms: [`rm -rf build-${String(alias)}`, `rm -rf build-${String(alias)}`],
  };
}

const combos: Array<{ name: string; anomalies: boolean; review: boolean; blocked: boolean }> = [
  { name: 'none', anomalies: false, review: false, blocked: false },
  { name: 'anomalies', anomalies: true, review: false, blocked: false },
  { name: 'review', anomalies: false, review: true, blocked: false },
  { name: 'blocked', anomalies: false, review: false, blocked: true },
  { name: 'anomalies-review', anomalies: true, review: true, blocked: false },
  { name: 'anomalies-blocked', anomalies: true, review: false, blocked: true },
  { name: 'review-blocked', anomalies: false, review: true, blocked: true },
  { name: 'all', anomalies: true, review: true, blocked: true },
];
for (const combo of combos) {
  add(`brief.combo.${combo.name}`, 'brief.render', brief(value => {
    if (combo.anomalies) {
      value.anomalies = { anchors: [anchor('run-a'), anchor('run-b', 'retired_archive')], omitted: 2, instructionVersion: 1 };
    }
    if (combo.review) value.unknownCallReview = review();
    if (combo.blocked) value.blockedCommands = [blockedLine(1), blockedLine(2)];
  }));
}
add('brief.anomalies.25', 'brief.render', brief(value => {
  value.anomalies = {
    anchors: Array.from({ length: 25 }, (_, index) => anchor(`run-${String(index)}`, index % 2 === 0 ? 'archive_interrupted' : 'retired_archive')),
    omitted: 5, instructionVersion: 1,
  };
}));
add('brief.review.items-omitted', 'brief.render', brief(value => {
  value.unknownCallReview = review({
    inventory: 'incomplete', itemsOmitted: 4,
    items: [
      reviewItem(1, { verdict: 'done', evidence: { text: 'evidence', truncated: false },
        crashSuspicion: { verdict: 'unlikely', evidence: 'none' },
        reviewerConclusion: { text: '改判前：做了一半', truncated: false } }),
      reviewItem(2, {
        kind: 'file_edit', files: [{
          path: 'src/a.ts', mode: 'replace', change: 'modified',
          oldText: { text: 'old', truncated: false }, newText: { text: 'new', truncated: true },
          diff: { text: '@@ -1 +1 @@\n-old\n+new', truncated: false }, diffOmittedReason: null,
        }],
      }),
      reviewItem(3, {
        files: [{
          path: 'src/b.ts', mode: 'create', change: 'unknown', oldText: null, newText: null,
          diff: null, diffOmittedReason: 'too_large',
        }],
      }),
    ],
  });
}));
for (const choice of ['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself'] as const) {
  for (const source of ['card', 'direct'] as const) {
    add(`brief.disposition.${choice}.${source}`, 'brief.render', brief(value => {
      value.unknownCallReview = review({
        disposition: {
          choice, source, text: { text: 'note', truncated: false }, targets: [2, 1],
          platformTargets: [1], approvedMethods: [{ alias: 1, command: 'npm run safe', cwd: null }],
          annotations: [{ path: 'src/a.ts', text: 'annotation' }],
        },
      });
    }));
  }
}
for (const count of [1, 16, 17]) {
  add(`brief.blocked.${String(count)}`, 'brief.render', brief(value => {
    value.blockedCommands = Array.from({ length: count }, (_, index) => blockedLine(index + 1));
  }));
}
for (const edge of TEXT_EDGES) {
  add(`brief.text.${edge.name}`, 'brief.render', brief(value => {
    value.requeue.reason.text = edge.text;
    value.previous.error = { text: edge.text, truncated: false };
    value.stoppedAt.lastAssistant = { text: edge.text, truncated: true };
    value.task.taskId = edge.text;
  }));
}
add('brief.near16k.below', 'brief.render', brief(value => {
  value.acceptedInputs.messages = Array.from({ length: 3 }, (_, index) => ({
    messageRef: { aggregateType: 'SessionMessage', projectId: 'k3r-project', workspaceId: 'w', messageId: `m-${String(index)}` },
    part: 'message' as const, excerpt: { text: 'x'.repeat(4000), truncated: false },
  }));
}));
add('brief.near16k.above', 'brief.render', brief(value => {
  value.acceptedInputs.messages = Array.from({ length: 5 }, (_, index) => ({
    messageRef: { aggregateType: 'SessionMessage', projectId: 'k3r-project', workspaceId: 'w', messageId: `m-${String(index)}` },
    part: 'message' as const, excerpt: { text: 'x'.repeat(4000), truncated: false },
  }));
}));
add('brief.near16k.blocked', 'brief.render', brief(value => {
  value.acceptedInputs.messages = Array.from({ length: 4 }, (_, index) => ({
    messageRef: { aggregateType: 'SessionMessage', projectId: 'k3r-project', workspaceId: 'w', messageId: `m-${String(index)}` },
    part: 'message' as const, excerpt: { text: 'x'.repeat(4000), truncated: false },
  }));
  value.blockedCommands = Array.from({ length: 17 }, (_, index) => blockedLine(index + 1));
}));

// approvedMethodLinesZh
add('approved.empty', 'brief.approvedMethods', []);
add('approved.null-cwd', 'brief.approvedMethods', [{ alias: 1, command: 'npm test', cwd: null }]);
add('approved.empty-cwd', 'brief.approvedMethods', [{ alias: 2, command: 'npm test', cwd: '' }]);
add('approved.multiline-cwd', 'brief.approvedMethods', [{ alias: 3, command: 'a\r\nb\nc', cwd: 'x\r\ny\nz' }]);
add('approved.trailing', 'brief.approvedMethods', [{ alias: 4, command: '  npm test  ', cwd: '  /tmp/a  ' }]);
add('approved.three', 'brief.approvedMethods', [
  { alias: 1, command: 'one', cwd: null },
  { alias: 2, command: 'two\n2', cwd: 'dir' },
  { alias: 3, command: '`three` {{slot}}', cwd: '目录' },
]);

// blockedCommandsLinesZh (private; replayed through the copy-only wrapper)
function blockedEntries(forms: string[], state: ContinuationBlockedCommandLineV1['requestState'] = null): ContinuationBlockedCommandLineV1[] {
  return [{ alias: 1, reviewRunId: '0123456789abcdef', requestState: state, declaredForms: forms }];
}
add('blocked.direct.empty', 'brief.blockedCommands', [], 16, true);
add('blocked.direct.keep0', 'brief.blockedCommands', blockedEntries(['a']), 0, true);
for (const state of ['pending', 'allowed', 'denied', 'denied_final', null] as const) {
  add(`blocked.direct.state.${String(state)}`, 'brief.blockedCommands', blockedEntries(['rm -rf build'], state), 16, false);
}
add('blocked.direct.duplicates', 'brief.blockedCommands', blockedEntries(['a', 'a', 'b']), 16, false);
add('blocked.direct.four-forms', 'brief.blockedCommands', blockedEntries(['a', 'b', 'c', 'd']), 16, false);
add('blocked.direct.160-ascii', 'brief.blockedCommands', blockedEntries(['a'.repeat(160)]), 16, false);
add('blocked.direct.161-ascii', 'brief.blockedCommands', blockedEntries(['a'.repeat(161)]), 16, false);
add('blocked.direct.160-chinese', 'brief.blockedCommands', blockedEntries(['中'.repeat(54)]), 16, false);
add('blocked.direct.emoji', 'brief.blockedCommands', blockedEntries(['🙂'.repeat(41)]), 16, false);
add('blocked.direct.16', 'brief.blockedCommands',
  Array.from({ length: 16 }, (_, index) => blockedLine(index + 1)), 16, true);
add('blocked.direct.17-count', 'brief.blockedCommands',
  Array.from({ length: 17 }, (_, index) => blockedLine(index + 1)), 16, true);
add('blocked.direct.17-nocount', 'brief.blockedCommands',
  Array.from({ length: 17 }, (_, index) => blockedLine(index + 1)), 16, false);
add('blocked.direct.17-keep15', 'brief.blockedCommands',
  Array.from({ length: 17 }, (_, index) => blockedLine(index + 1)), 15, false);

// --------------------------------------------------------------------------
// renderUnknownCallReviewZh.
// --------------------------------------------------------------------------
function renderItem(alias: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    alias, toolName: 'shell', display: 'full',
    command: { text: `npm run step-${String(alias)}`, truncated: false },
    cwd: null, startedAt: null, sameBatch: [], current: null,
    ...overrides,
  };
}
function reviewInput(overrides: Record<string, unknown> = {}): UnknownCallReviewInputV1 {
  return {
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' },
    revision: 1, phase: 'review', round: 1,
    items: [renderItem(1)], targets: null, personText: null, annotations: [], platformTargets: [],
    workspace: {
      status: 'captured', runBaselineKnown: true, notVisible: [], notVisibleOmitted: 0,
      changedSample: [], changedOmitted: 0,
    },
    ...overrides,
  } as unknown as UnknownCallReviewInputV1;
}
for (const phase of ['review', 'proposal'] as const) {
  add(`k3.phase.${phase}`, 'unknownCallReview.render', reviewInput({ phase }));
}
for (const display of ['full', 'truncated', 'unexpanded'] as const) {
  add(`k3.display.${display}`, 'unknownCallReview.render', reviewInput({
    items: [renderItem(1, { display, command: display === 'unexpanded' ? null : { text: 'cmd', truncated: display === 'truncated' }, summaryCommand: 'summary-command' })],
  }));
}
add('k3.proposal.unexpanded-summary-null', 'unknownCallReview.render', reviewInput({
  phase: 'proposal', items: [renderItem(1, { display: 'unexpanded', command: null, summaryCommand: null })],
  targets: [1],
}));
add('k3.proposal.unexpanded-summary-text', 'unknownCallReview.render', reviewInput({
  phase: 'proposal', items: [renderItem(1, { display: 'unexpanded', command: null, summaryCommand: 'kept summary' })],
  targets: [1],
}));
add('k3.cwd.null', 'unknownCallReview.render', reviewInput({ items: [renderItem(1, { cwd: null })] }));
add('k3.cwd.empty', 'unknownCallReview.render', reviewInput({ items: [renderItem(1, { cwd: '' })] }));
add('k3.cwd.multiline', 'unknownCallReview.render', reviewInput({ items: [renderItem(1, { cwd: 'a\r\nb\nc' })] }));
add('k3.command.null', 'unknownCallReview.render', reviewInput({ items: [renderItem(1, { command: null })] }));
add('k3.same-batch', 'unknownCallReview.render', reviewInput({
  items: [renderItem(1, { sameBatch: [2, 3] }), renderItem(2), renderItem(3)],
}));
for (const personText of [null, '', '附言 {{slot}} `x`']) {
  add(`k3.personText.${personText === null ? 'null' : personText === '' ? 'empty' : 'text'}`, 'unknownCallReview.render', reviewInput({
    phase: 'proposal', targets: [2, 1], items: [renderItem(1), renderItem(2)], personText,
  }));
}
add('k3.targets.unsorted', 'unknownCallReview.render', reviewInput({
  phase: 'proposal', targets: [3, 1, 2], items: [renderItem(1), renderItem(2), renderItem(3)],
}));
add('k3.targets.missing-item', 'unknownCallReview.render', reviewInput({
  phase: 'proposal', targets: [9, 1], items: [renderItem(1)],
}));
add('k3.annotations.empty', 'unknownCallReview.render', reviewInput({ phase: 'proposal', targets: [1], annotations: [] }));
add('k3.annotations.two', 'unknownCallReview.render', reviewInput({
  phase: 'proposal', targets: [1],
  annotations: [{ path: null, text: 'record note' }, { path: 'src/a.ts', text: 'file note' }],
}));
add('k3.platformTargets.empty', 'unknownCallReview.render', reviewInput({ phase: 'proposal', targets: [1], platformTargets: [] }));
add('k3.platformTargets.two', 'unknownCallReview.render', reviewInput({ phase: 'proposal', targets: [1], platformTargets: [3, 2] }));
for (const status of ['captured', 'unavailable'] as const) {
  add(`k3.workspace.${status}`, 'unknownCallReview.render', reviewInput({
    workspace: status === 'captured'
      ? { status, runBaselineKnown: true, notVisible: ['ignored'], notVisibleOmitted: 2,
        changedSample: [{ path: 'src/a.ts', change: 'modified' }], changedOmitted: 3 }
      : { status, runBaselineKnown: false, notVisible: [], notVisibleOmitted: 0, changedSample: [], changedOmitted: 0, reason: 'not_git', detail: 'not a repository' },
  }));
}
add('k3.workspace.changes', 'unknownCallReview.render', reviewInput({
  workspace: {
    status: 'captured', runBaselineKnown: false, notVisible: [], notVisibleOmitted: 0,
    changedSample: (['added', 'modified', 'deleted', 'mode_changed'] as const).map(change => ({ path: `src/${change}.ts`, change })),
    changedOmitted: 0,
  },
}));
for (const verdict of ['no_review_needed', 'done', 'pending'] as const) {
  const current = verdict === 'no_review_needed' ? { verdict, by: 'platform' }
    : verdict === 'pending' ? { verdict, by: null }
      : { verdict, by: 'review_round', evidence: 'done', roundRunRef: null,
        crashSuspicion: { verdict: 'unlikely', evidence: 'none' }, reviewerConclusion: null };
  add(`k3.written.${verdict}`, 'unknownCallReview.render', reviewInput({ items: [renderItem(1, { current })] }));
}
add('k3.written.by-platform', 'unknownCallReview.render', reviewInput({
  items: [renderItem(1, { current: { verdict: 'done', by: 'platform', evidence: { kind: 'not_committed' } } })],
}));
for (const edge of TEXT_EDGES) {
  add(`k3.text.${edge.name}`, 'unknownCallReview.render', reviewInput({
    phase: 'proposal', targets: [1],
    items: [renderItem(1, {
      command: { text: edge.text, truncated: false }, cwd: edge.text, startedAt: edge.text,
      toolName: edge.text,
    })],
    personText: edge.text,
    annotations: [{ path: edge.text, text: edge.text }],
  }));
}

// --------------------------------------------------------------------------
// platformRoleProfile.
// --------------------------------------------------------------------------
for (const duty of ['executor', 'secretary', 'adviser', 'scribe', 'reviewer'] as const) {
  add(`role.${duty}`, 'roleProfile', duty);
}

// --------------------------------------------------------------------------
// formatDecisionResponseInput.
// --------------------------------------------------------------------------
const CONFLICT_GOAL = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
const SELECTIONS = [
  { kind: 'option', optionId: 'accept' },
  { kind: 'other' },
  { kind: 'conflict_wait', earlier: CONFLICT_GOAL, later: { ...CONFLICT_GOAL, goalId: 'h' } },
  { kind: 'conflict_order', goalOrder: [CONFLICT_GOAL, { ...CONFLICT_GOAL, goalId: 'h' }] },
  { kind: 'conflict_parallel', earlier: CONFLICT_GOAL, later: { ...CONFLICT_GOAL, goalId: 'h' } },
] as const;
for (const selection of SELECTIONS) {
  add(`decision.${selection.kind}`, 'decisionResponseInput', {
    schemaVersion: 1, kind: 'user_decision_response', selection, text: '', annotations: [],
  });
}
add('decision.annotations', 'decisionResponseInput', {
  schemaVersion: 1, kind: 'user_decision_response', selection: { kind: 'option', optionId: 'accept' },
  text: '  keep this\n\nexactly  ',
  annotations: [{ objectKey: '{"a":1}', text: 'first' }, { objectKey: '{"b":2}', text: 'second' }],
});
for (const edge of TEXT_EDGES) {
  add(`decision.text.${edge.name}`, 'decisionResponseInput', {
    schemaVersion: 1, kind: 'user_decision_response', selection: { kind: 'other' },
    text: edge.text, annotations: [{ objectKey: edge.text, text: edge.text }],
  });
}

// --------------------------------------------------------------------------
// architectureReminderRowEntries.
// --------------------------------------------------------------------------
const MODULE_A: ModuleRef = { projectId: 'p', moduleId: 'A' };
const MODULE_B: ModuleRef = { projectId: 'p', moduleId: 'B' };
function observation(observedAt: string, nodes: { path: string; digest: string }[]): ArchitectureReminderObservationV1 {
  return { observedAt, nodes };
}
function facts(overrides: Partial<ArchitectureReminderFactsV1> = {}): ArchitectureReminderFactsV1 {
  const defaults: ArchitectureReminderFactsV1 = {
    state: {
      current: {
        captureRef: { aggregateType: 'ObservedArchitecture', projectId: 'p', workspaceId: 'w', captureId: 'cap-2' },
        persistedRef: {
          capture: { projectId: 'p', workspaceId: 'w', captureId: 'cap-2', workspaceRevision: 1,
            sourceDigest: 'source', configDigest: 'config', indexVersion: 'typescript@1' },
          material: { kind: 'artifact', contentType: 'application/json', digest: 'd', sizeBytes: 1,
            source: { kind: 'workspace', refId: 'w', revision: '1' } },
        },
        observedAt: AT,
      },
      previous: null, previousPersistedRef: null, autoCapture: null,
    },
    catalog: {
      requireDag: true,
      modules: [
        { ref: MODULE_A, name: 'A', responsibility: 'A core', paths: ['src/a/core'], interfaces: [] },
        { ref: MODULE_B, name: 'B', responsibility: 'B', paths: ['src/b'], interfaces: [] },
      ],
      dependencies: [{ from: MODULE_A, to: MODULE_B, reason: 'A uses B' }],
    },
    latest: observation(AT, [
      { path: 'src/a/core/one.ts', digest: 'd1' },
      { path: 'src/a/core/util.ts', digest: 'd2' },
      { path: 'src/b/lib.ts', digest: 'd3' },
      { path: 'src/b/extra.ts', digest: 'd4' },
      { path: 'src/a/loose.ts', digest: 'd5' },
    ]),
    previous: observation(AT, [
      { path: 'src/a/core/one.ts', digest: 'd1' },
      { path: 'src/b/lib.ts', digest: 'd3' },
      { path: 'src/old.ts', digest: 'd' },
    ]),
    findings: [
      { kind: 'dependency_missing', moduleRef: MODULE_A, path: 'src/a/core', detail: 'A→B', certainty: 'proven' },
      { kind: 'import_undeclared', moduleRef: MODULE_B, path: 'src/b/extra.ts', detail: 'src/a/core/util.ts', certainty: 'proven' },
      { kind: 'ungrouped', moduleRef: null, path: 'src/a/loose.ts', detail: 'not under any module', certainty: 'unknown' },
    ],
  };
  return { ...defaults, ...overrides };
}
add('arch.no-observation', 'architectureReminderRows', { facts: facts({ state: { ...facts().state, current: null } }), taskModuleRef: MODULE_A, now: AT });
add('arch.no-latest', 'architectureReminderRows', { facts: facts({ latest: null }), taskModuleRef: MODULE_A, now: AT });
add('arch.catalog-null', 'architectureReminderRows', { facts: facts({ catalog: null }), taskModuleRef: MODULE_A, now: AT });
add('arch.task-null', 'architectureReminderRows', { facts: facts(), taskModuleRef: null, now: AT });
add('arch.findings-empty', 'architectureReminderRows', { facts: facts({ findings: [] }), taskModuleRef: MODULE_A, now: AT });
const FINDING_KINDS: FormalObservedFindingV1[] = [
  { kind: 'dependency_missing', moduleRef: MODULE_A, path: 'src/a/core', detail: 'A→B', certainty: 'unknown' },
  { kind: 'import_undeclared', moduleRef: MODULE_B, path: 'src/b/extra.ts', detail: 'src/a/core/util.ts', certainty: 'proven' },
  { kind: 'ungrouped', moduleRef: null, path: 'src/a/loose.ts', detail: 'not under any module', certainty: 'proven' },
  { kind: 'unresolved', moduleRef: MODULE_A, path: 'src/a/x.ts', detail: 'unresolved', certainty: 'proven' },
  { kind: 'ambiguous', moduleRef: MODULE_A, path: 'src/a/y.ts', detail: 'ambiguous', certainty: 'proven' },
  { kind: 'cycle', moduleRef: MODULE_A, path: 'src/a/z.ts', detail: 'cycle', certainty: 'proven' },
];
add('arch.finding-kinds', 'architectureReminderRows', { facts: facts({ findings: FINDING_KINDS }), taskModuleRef: MODULE_A, now: AT });
add('arch.cap-12', 'architectureReminderRows', {
  facts: facts({
    findings: Array.from({ length: 12 }, (_, index) => ({
      kind: 'dependency_missing' as const, moduleRef: MODULE_A, path: `src/a/${String(index)}`, detail: 'A→B', certainty: 'proven' as const,
    })),
  }),
  taskModuleRef: MODULE_A, now: AT,
});
add('arch.moves', 'architectureReminderRows', {
  facts: facts({
    catalog: null, findings: [],
    previous: observation(AT, [{ path: 'src/old.ts', digest: 'same' }]),
    latest: observation(AT, [{ path: 'src/new.ts', digest: 'same' }]),
  }),
  taskModuleRef: MODULE_A, now: AT,
});
const TIME_CASES: Array<[string, string]> = [
  ['0s', AT], ['59s', '2026-10-08T00:00:59.000Z'], ['60s', '2026-10-08T00:01:00.000Z'],
  ['3599s', '2026-10-08T00:59:59.000Z'], ['3600s', '2026-10-08T01:00:00.000Z'],
  ['86399s', '2026-10-09T00:00:00.000Z'], ['86400s', '2026-10-09T00:00:01.000Z'],
];
for (const [name, now] of TIME_CASES) {
  add(`arch.time.${name}`, 'architectureReminderRows', { facts: facts(), taskModuleRef: MODULE_A, now });
}

// --------------------------------------------------------------------------
// renderNoteHeader.
// --------------------------------------------------------------------------
const NOTE_ANCHORS: Array<[string, NoteAnchorV1]> = [
  ['module', { kind: 'module', moduleId: 'm' }],
  ['interface', { kind: 'interface', moduleId: 'm', interfaceId: 'i' }],
  ['file', { kind: 'file', path: 'src/a.ts' }],
  ['file-symbol', { kind: 'file', path: 'src/a.ts', symbol: { language: 'ts', qualifiedName: 'A.b', signatureDigest: 'd', range: { startLine: 1, endLine: 2 }, fileDigest: 'f' } }],
  ['file-deleted', { kind: 'file', path: 'src/a.ts', deleted: true }],
  ['goal', { kind: 'goal', goalId: 'g' }],
  ['stage', { kind: 'stage', goalId: 'g', planRevision: 1, stageId: 's' }],
  ['task', { kind: 'task', goalId: 'g', taskId: 't' }],
  ['project', { kind: 'project' }],
];
const NOTE_KINDS: NoteKind[] = ['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision', 'understanding', 'repair'];
for (const kind of NOTE_KINDS) {
  for (const [anchorName, anchorValue] of NOTE_ANCHORS) {
    add(`note.${kind}.${anchorName}`, 'noteHeader', { kind, anchor: anchorValue, structural: false, conclusion: 'conclusion' });
  }
}
for (const structural of [true, false]) {
  add(`note.structural.${String(structural)}`, 'noteHeader', {
    kind: 'decision', anchor: { kind: 'project' }, structural, conclusion: '结论',
  });
}
for (const edge of TEXT_EDGES) {
  add(`note.text.${edge.name}`, 'noteHeader', {
    kind: 'pitfall', anchor: { kind: 'file', path: edge.text }, structural: true, conclusion: edge.text,
  });
}

// --------------------------------------------------------------------------
// Consultation guidance expression.
// --------------------------------------------------------------------------
const SOURCE_REFS: Array<[string, unknown]> = [
  ['workspace', { kind: 'workspace', refId: 'w', revision: '1' }],
  ['session-message', {
    kind: 'session_message',
    messageRef: { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm' },
  }],
  ['null', null],
  ['nested', { kind: 'artifact', digest: 'a'.repeat(64), source: { kind: 'workspace', refId: 'w', revision: '1' }, extra: { a: [1, 2, null] } }],
];
for (const [name, sourceRef] of SOURCE_REFS) {
  add(`consultation.${name}`, 'consultation.guidance', `message-${name}`, sourceRef);
}
for (const edge of TEXT_EDGES) {
  add(`consultation.text.${edge.name}`, 'consultation.guidance', edge.text, { kind: 'workspace', refId: edge.text, revision: '1' });
}

// --------------------------------------------------------------------------
// Scribe reminder expression.
// --------------------------------------------------------------------------
for (const count of [0, 19, 20, 21, 40]) {
  add(`scribe.anchors.${String(count)}`, 'scribe.reminder', 10, 5,
    Array.from({ length: count }, (_, index) => `anchor-${String(index)}`));
}
for (const pending of [0, 1, 999]) {
  add(`scribe.pending.${String(pending)}`, 'scribe.reminder', pending, 5, ['a']);
}
for (const edge of TEXT_EDGES) {
  add(`scribe.text.${edge.name}`, 'scribe.reminder', 10, 5, [edge.text, edge.text]);
}

// --------------------------------------------------------------------------
// Context-extensions row texts (row 46).
// --------------------------------------------------------------------------
const DECISION_KINDS: DecisionSourceV1['kind'][] = [
  'message', 'goal_cause', 'candidate', 'note_review', 'planning_question', 'goal_conflict',
  'message_release', 'unknown_call_review', 'command_rerun_request',
];
for (const kind of DECISION_KINDS) {
  add(`context.decision.${kind}`, 'contextExtensions.decisionRow', { kind, key: `key-${kind}`, goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, pins: [] });
}
for (const edge of TEXT_EDGES) {
  add(`context.decision.text.${edge.name}`, 'contextExtensions.decisionRow', { kind: 'message', key: edge.text, goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, pins: [] });
  add(`context.notAvailable.text.${edge.name}`, 'contextExtensions.notAvailableRow', edge.text);
  add(`context.anchor.text.${edge.name}`, 'contextExtensions.anomalyAnchor', {
    ...anchor('run-text'), task: { ...anchor('run-text').task, taskId: edge.text },
    runRef: { ...anchor('run-text').runRef, runId: edge.text }, cause: 'retired_archive',
  });
}
for (const cause of ['archive_interrupted', 'retired_archive'] as const) {
  add(`context.anchor.${cause}`, 'contextExtensions.anomalyAnchor', anchor(`run-${cause}`, cause));
}
add('context.notAvailable.plain', 'contextExtensions.notAvailableRow', 'candidate');
