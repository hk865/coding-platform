import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as base from './bundle-base-brief.mjs';
import * as result from './bundle-result-brief.mjs';

let checks = 0;
function firstDiff(a, b) {
  const ab = Buffer.from(a, 'utf8'); const bb = Buffer.from(b, 'utf8');
  if (ab.equals(bb)) return null;
  const n = Math.min(ab.length, bb.length);
  let i = 0; while (i < n && ab[i] === bb[i]) i += 1;
  return { offset: i, baseLength: ab.length, resultLength: bb.length,
    baseAround: ab.subarray(Math.max(0, i - 8), i + 16).toString('hex'),
    resultAround: bb.subarray(Math.max(0, i - 8), i + 16).toString('hex') };
}
function sameString(label, a, b) {
  checks += 1;
  if (a === b) return;
  const d = firstDiff(a, b);
  console.error('DIFF', label, d);
  console.error('base=', JSON.stringify(a.slice(Math.max(0, d.offset - 40), d.offset + 80)));
  console.error('result=', JSON.stringify(b.slice(Math.max(0, d.offset - 40), d.offset + 80)));
  throw new Error('string diff ' + label);
}
function sameArray(label, a, b) {
  checks += 1;
  assert.deepStrictEqual(b, a);
}
const sha = (c) => c.repeat(64);
const digestOf = (brief) => base.continuationBriefDigest(brief);
const renderBoth = (label, brief) => {
  const d = digestOf(brief);
  sameString(label, base.renderContinuationBriefZh(brief, d), result.renderContinuationBriefZh(brief, d));
};

const P = 'k3r-project';
const G = 'k3r-goal';
const ref = (runId) => ({ aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId });
function file(path, over = {}) {
  return { path, mode: 'replace', change: 'modified', oldText: null, newText: null, diff: null,
    diffOmittedReason: null, ...over };
}
function reviewItem(alias, over = {}) {
  return { alias, callId: `call-${alias}`, toolName: 'shell', kind: 'process',
    summary: { text: `summary ${alias}`, truncated: false }, verdict: 'done', evidence: null,
    crashSuspicion: null, reviewerConclusion: null, files: [], ...over };
}
function reviewSection(over = {}) {
  return { reviewRef: ref('run-1'), revision: 3, origin: 'takeover_unresolved', inventory: 'complete',
    items: [], itemsOmitted: 0, disposition: null,
    workspace: { status: 'captured', runBaselineKnown: true, notVisible: [], changedSample: [], changedOmitted: 0 },
    ...over };
}
function disposition(over = {}) {
  return { choice: 'safer_method', source: 'card', text: { text: '换个跑法', truncated: false }, targets: [1, 2],
    platformTargets: [2], approvedMethods: [{ alias: 1, command: 'echo ok', cwd: null }], annotations: [], ...over };
}
function anomaly(over = {}) {
  return { anchors: [], omitted: 0, instructionVersion: 1, ...over };
}
function anchor(index, over = {}) {
  return { runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: `run-${index}` },
    sessionRef: { projectId: P, sessionId: `session-${index}` }, task: { projectId: P, goalId: G, taskId: `task-${index}` },
    role: { kind: 'role_spec', pin: { ref: { aggregateType: 'RoleSpecRevision', projectId: P, roleId: 'r', revision: 1 }, digest: sha('r') } },
    attemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: `task-${index}`, attemptId: `a-${index}` },
    cause: 'archive_interrupted', archiveRequestId: `req-${index}`, archiveRequestReceipt: { identityKey: `k-${index}`, fingerprint: sha('f') },
    archivedBy: { kind: 'human', id: 'op' }, recordedAt: `2026-10-07T10:${String(8 + index).padStart(2, '0')}:00.000Z`,
    changedFiles: { source: 'worktree', status: 'captured', confirmed: ['a.ts', 'b.ts'], possible: ['c.ts'], omitted: 0,
      baseCommit: 'abc', runBaselineKnown: true, reason: null },
    resultVerification: 'not_checked', ...over };
}

// ---- briefs ----
renderBoth('base fixture', base.baseBrief());

{
  const b = base.baseBrief(); b.unknownCallReview = reviewSection(); renderBoth('review empty', b);
}
{
  const b = base.baseBrief(); b.unknownCallReview = reviewSection({
    items: [reviewItem(1, { files: [file('src/a.ts', { oldText: { text: 'old\nline', truncated: true },
      newText: { text: 'new', truncated: false }, diff: { text: 'diff\r\nline', truncated: false } })] })],
    itemsOmitted: 4, disposition: disposition({ annotations: [{ path: null, text: '看这里' }, { path: 'a.ts', text: '记一笔' }] }),
  });
  b.blockedCommands = Array.from({ length: 3 }, (_, i) => ({ alias: i + 1, reviewRunId: `run-${i + 1}`,
    requestState: i === 0 ? 'pending' : i === 1 ? 'allowed' : 'denied', declaredForms: [['a', 'b', 'c', 'd'], [], ['字'.repeat(100)]][i] }));
  renderBoth('review full + blocked', b);
}
{
  const b = base.baseBrief(); b.unknownCallReview = reviewSection({ blockedCommands: [
    { alias: 1, reviewRunId: 'run-1', commandSha256: sha('a') }] }); renderBoth('review blocked sentence', b);
}
{
  const b = base.baseBrief(); b.unknownCallReview = reviewSection({ disposition: disposition({ choice: 'rerun_as_is' }) });
  renderBoth('disposition rerun', b);
  b.unknownCallReview.disposition = disposition({ choice: 'skip_as_done', source: 'direct', text: { text: '', truncated: false } });
  renderBoth('disposition skip empty note', b);
  b.unknownCallReview.disposition = disposition({ choice: 'handle_myself', text: null, targets: [], platformTargets: [] });
  renderBoth('disposition handle no targets', b);
  b.unknownCallReview.disposition = disposition({ choice: 'safer_method', approvedMethods: [], platformTargets: [] });
  renderBoth('disposition safer no methods', b);
}
{
  const b = base.baseBrief(); b.anomalies = anomaly({ omitted: 2, anchors: [anchor(1), anchor(2, {
    changedFiles: { source: 'worktree', status: 'unavailable', confirmed: [], possible: [], omitted: 0, baseCommit: null,
      runBaselineKnown: false, reason: '归'.repeat(64) } })] });
  renderBoth('anomalies', b);
}
{
  const b = base.baseBrief(); b.anomalies = anomaly({ anchors: [anchor(1, { changedFiles: { source: 'worktree',
    status: 'not_entered', confirmed: [], possible: [], omitted: 0, baseCommit: null, runBaselineKnown: false, reason: null } })] });
  renderBoth('anomaly not entered', b);
}
{
  const b = base.baseBrief();
  b.anomalies = anomaly({ omitted: 10, anchors: Array.from({ length: 8 }, (_, i) => anchor(i + 1, {
    task: { projectId: P, goalId: G, taskId: 't'.repeat(512) } })) });
  b.unknownCallReview = reviewSection({ items: Array.from({ length: 32 }, (_, i) => reviewItem(i + 1, {
    callId: `call-${'a'.repeat(60)}${i}`, files: [file('src/a.ts')] })),
  itemsOmitted: 0, disposition: disposition({ targets: Array.from({ length: 32 }, (_, i) => i + 1),
    platformTargets: Array.from({ length: 31 }, (_, i) => i + 2), annotations: [] }) });
  b.blockedCommands = [{ alias: 1, reviewRunId: 'run-1', requestState: null, declaredForms: [] }];
  renderBoth('heavy extreme', b);
}
{
  const b = base.baseBrief(); b.blockedCommands = Array.from({ length: 17 }, (_, i) => ({ alias: i + 1,
    reviewRunId: `r${String(i + 1).padStart(7, '0')}`, requestState: null, declaredForms: ['a'.repeat(160)] }));
  b.previous.unacceptedSteers = [4000, 4000, 3417].map((x, i) => ({ intentRef: { aggregateType: 'ControlIntent',
    projectId: P, workspaceId: 'W', intentId: `s${i + 1}` }, text: { text: 'p'.repeat(x), truncated: false } }));
  renderBoth('blocked 16 fit', b);
  b.previous.unacceptedSteers[2].text = { text: 'p'.repeat(3477), truncated: false };
  renderBoth('blocked 15', b);
}
{
  const b = base.baseBrief(); b.blockedCommands = Array.from({ length: 17 }, (_, i) => ({ alias: i + 1,
    reviewRunId: `r${String(i + 1).padStart(7, '0')}`, requestState: null, declaredForms: ['a'.repeat(160)] }));
  b.previous.unacceptedSteers = [4000, 4000, 4000, 4000].map((x, i) => ({ intentRef: { aggregateType: 'ControlIntent',
    projectId: P, workspaceId: 'W', intentId: `s${i + 1}` }, text: { text: 'p'.repeat(x), truncated: false } }));
  renderBoth('blocked all gone', b);
}
{
  const b = base.baseBrief(); b.previous.unacceptedSteers = [4000, 4000, 4000, 2536].map((x, i) => ({
    intentRef: { aggregateType: 'ControlIntent', projectId: P, workspaceId: 'W', intentId: `s${i + 1}` },
    text: { text: 'p'.repeat(x), truncated: false } }));
  b.blockedCommands = Array.from({ length: 17 }, (_, i) => ({ alias: i + 1, reviewRunId: `r${String(i + 1).padStart(7, '0')}`,
    requestState: null, declaredForms: ['a'.repeat(160)] }));
  renderBoth('blocked drops whole section', b);
}
{
  const b = base.baseBrief();
  b.previous.error = { text: '改'.repeat(4000), truncated: true };
  b.stoppedAt.lastAssistant = { text: '改'.repeat(4000), truncated: true };
  b.requeue.reason = { text: '改'.repeat(4000), truncated: true };
  b.toolCalls.confirmed = Array.from({ length: 10 }, (_, i) => ({ callId: `c-${i}`, name: 'x', target: { text: 'long\nline', truncated: true },
    result: 'success', sideEffect: 'possible', changedPaths: ['p1', 'p2'], changedPathsOmitted: 2, error: { text: 'e'.repeat(4000), truncated: true } }));
  renderBoth('caps', b);
}
{
  const b = base.baseBrief(); b.toolCalls.confirmed = Array.from({ length: 40 }, (_, i) => ({ callId: `c-${i}`, name: 'write_file',
    target: { text: 't'.repeat(50), truncated: false }, result: 'success', sideEffect: 'none',
    changedPaths: Array.from({ length: 8 }, (_, j) => `${'深'.repeat(200)}${j}`), changedPathsOmitted: 3, error: null }));
  renderBoth('overflow trailing lines', b);
}
{
  for (const continuity of ['same_session_history', 'same_session_without_previous_turn', 'other_session_seeded', 'other_session']) {
    for (const seeded of [null, { sessionRef: { projectId: P, sessionId: 's-0' }, throughPosition: null },
      { sessionRef: { projectId: P, sessionId: 's-0' }, throughPosition: 40 }]) {
      const b = base.baseBrief(); b.session.continuity = continuity; b.session.seededFrom = seeded; renderBoth('continuity ' + continuity + ' ' + JSON.stringify(seeded), b);
    }
  }
}
{
  for (const [kind, outcome, origin, reason] of [
    ['not_entered', 'cancelled', 'observed', null], ['unavailable', 'completed', 'observed', null],
    ['read', 'cancelled', 'observed', 'cancelled_at_reconcile'], ['read', 'cancelled', 'observed', 'cancelled_while_paused'],
    ['read', 'completed', 'observed', null], ['read', 'crashed', 'host_interrupted', null],
    ['read', 'crashed', 'human_attested', null], ['read', 'failed', 'observed', null]]) {
    const b = base.baseBrief(); b.stoppedAt.kernel = kind; b.stoppedAt.reason = reason;
    b.previous.outcome = outcome; b.previous.origin = origin; renderBoth(`ending ${kind}/${outcome}/${origin}/${reason}`, b);
  }
}
{
  for (const status of ['known', 'partial', 'not_entered', 'unavailable']) {
    const b = base.baseBrief(); b.workspace.selfChanged = { status, confirmed: ['a.ts'], possible: ['b.ts'], omitted: 2 };
    renderBoth('workspace self ' + status, b);
  }
  for (const status of ['git', 'not_git', 'unavailable']) {
    const b = base.baseBrief(); b.workspace.uncommitted = { status, baseCommit: status === 'git' ? 'abc' : null,
      paths: ['p'], omitted: 1, reason: status === 'unavailable' ? 'r' : null };
    b.workspace.segments = [{ from: 0, to: 1, verdict: 'changed', reason: 'diff' },
      { from: 1, to: 2, verdict: 'unchanged', reason: 'same' },
      { from: 2, to: 3, verdict: 'unknown', reason: 'why' }];
    renderBoth('workspace uncommitted ' + status, b);
  }
}
{
  const b = base.baseBrief();
  b.checks = { roundRef: { aggregateType: 'VerificationRound', projectId: P, workspaceId: 'W', goalId: G, taskId: 't', runId: 'r', roundId: 'round-1' },
    roundOrdinal: 2, failing: [{ checkId: 'lint', phase: 'finished', outcome: 'FAIL', cause: 'c', reportRef: { kind: 'artifact',
      contentType: 'text/plain', digest: sha('d'), sizeBytes: 1, source: { kind: 'artifact', refId: 'r', revision: '1' } } },
    { checkId: 'test', phase: 'finished', outcome: null, cause: null, reportRef: null }], gapCodes: ['g1', 'g2'] };
  renderBoth('checks', b);
  b.checks = { ...b.checks, failing: [], gapCodes: [] }; renderBoth('checks empty', b);
}
{
  const b = base.baseBrief();
  b.acceptedInputs = { steers: [{ intentRef: { aggregateType: 'ControlIntent', projectId: P, workspaceId: 'W', intentId: 'i1' },
    text: { text: 's', truncated: false } }], steersOmitted: 2,
    messages: [{ messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: 'W', messageId: 'm1' }, part: 'message',
      excerpt: { text: 'x', truncated: false } }, { messageRef: { aggregateType: 'SessionMessage', projectId: P,
      workspaceId: 'W', messageId: 'm2' }, part: 'response', excerpt: { text: 'y', truncated: true } }], messagesOmitted: 1 };
  renderBoth('accepted', b);
}
{
  const b = base.baseBrief();
  b.previous.interruption = { kind: 'paused', kernelPaused: true, pausedBy: 'human' };
  b.previous.cancelledBy = 'goal_fan_out';
  b.previous.limit = { kind: 'tokens', observed: 10, allowed: 5 };
  b.previous.budget = { previousTokenBudget: 10, currentTokenBudget: 20 };
  b.previous.wait = { messageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: 'W', messageId: 'm' }, status: 'read' };
  b.previous.endedAt = '2026-10-07T10:00:00.000Z';
  b.factsFrom = { runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'run-0' }, hops: 2, truncated: true };
  b.trigger.goalResume = true; b.trigger.autoRework = null;
  b.trigger.earlierRequeues = [{ afterRunId: 'run-0', failureClass: 'run_failed' }];
  b.requeue.newInputs = [{ kind: 'session_message', ref: { aggregateType: 'SessionMessage', projectId: P, workspaceId: 'W', messageId: 'm' },
    replyBody: { text: 'reply', truncated: false } }, { kind: 'artifact', ref: { kind: 'artifact', contentType: 'text/plain',
    digest: sha('d'), sizeBytes: 1, source: { kind: 'artifact', refId: 'r', revision: '1' } }, body: { text: 'body', truncated: false } }];
  renderBoth('previous extras', b);
}
{
  const b = base.baseBrief(); b.mode = 'resume_after_interruption'; b.failureClass = 'interrupted';
  b.previous.outcome = 'cancelled'; b.previous.origin = 'host_interrupted';
  b.stoppedAt.kernel = 'read'; b.stoppedAt.turnStatus = 'limit_exceeded'; b.stoppedAt.lastPosition = 7; b.stoppedAt.lastToolGroup = { sourceMessageId: 'm', calls: 2 };
  b.stoppedAt.window = { fromPosition: 1, throughPosition: 9, omittedRecords: 3 };
  renderBoth('resume', b);
  b.stoppedAt.window = { fromPosition: 1, throughPosition: 9, omittedRecords: 0 }; renderBoth('resume window 0', b);
}
{
  const b = base.baseBrief(); b.task.taskId = 'x{{slot}}\n\r\n🚀'; b.previous.error = { text: 'a\r\nb\r\nc', truncated: false };
  b.toolCalls.confirmed = [{ callId: 'c', name: 'n', target: { text: '{{x}}', truncated: false }, result: 'outcome_unknown',
    sideEffect: 'confirmed', changedPaths: [], changedPathsOmitted: 0, error: null }];
  renderBoth('special chars', b);
}
{
  const b = base.baseBrief(); b.checks = null; b.acceptedInputs = { steers: [], steersOmitted: 0, messages: [], messagesOmitted: 0 };
  b.trigger.earlierRequeues = []; b.requeue.newInputs = []; b.toolCalls = { confirmed: [], notExecuted: [], unknown: [],
    confirmedOmitted: 0, notExecutedOmitted: 0, unknownOmitted: 0 };
  renderBoth('minimal', b);
}

{
  // Mandatory-review-only final path: huge body at every cap, no anomaly section.
  const b = base.baseBrief();
  b.toolCalls.confirmed = Array.from({ length: 40 }, (_, i) => ({ callId: `c-${i}`, name: 'write_file',
    target: { text: 't'.repeat(50), truncated: false }, result: 'success', sideEffect: 'none',
    changedPaths: Array.from({ length: 8 }, (_, j) => `${'深'.repeat(200)}${j}`), changedPathsOmitted: 3, error: null }));
  b.unknownCallReview = reviewSection({ items: [reviewItem(1, { files: [file('src/a.ts')] })] });
  renderBoth('final path review only', b);
}
{
  // Mandatory-anomaly-only final path.
  const b = base.baseBrief();
  b.toolCalls.confirmed = Array.from({ length: 40 }, (_, i) => ({ callId: `c-${i}`, name: 'write_file',
    target: { text: 't'.repeat(50), truncated: false }, result: 'success', sideEffect: 'none',
    changedPaths: Array.from({ length: 8 }, (_, j) => `${'深'.repeat(200)}${j}`), changedPathsOmitted: 3, error: null }));
  b.anomalies = anomaly({ anchors: [anchor(1)] });
  renderBoth('final path anomaly only', b);
}
{
  // Both mandatory parts plus blocked commands, huge body.
  const b = base.baseBrief();
  b.toolCalls.confirmed = Array.from({ length: 40 }, (_, i) => ({ callId: `c-${i}`, name: 'write_file',
    target: { text: 't'.repeat(50), truncated: false }, result: 'success', sideEffect: 'none',
    changedPaths: Array.from({ length: 8 }, (_, j) => `${'深'.repeat(200)}${j}`), changedPathsOmitted: 3, error: null }));
  b.anomalies = anomaly({ anchors: [anchor(1)] });
  b.unknownCallReview = reviewSection({ items: [reviewItem(1, { files: [file('src/a.ts')] })] });
  b.blockedCommands = [{ alias: 1, reviewRunId: 'run-1', requestState: 'pending', declaredForms: ['f'] }];
  renderBoth('final path both + blocked', b);
}
{
  // bodyOmission with valid body prefix (kept > 0) and mandatory review.
  const b = base.baseBrief();
  b.previous.unacceptedSteers = [4000, 4000, 4000, 4000, 4000, 4000].map((x, i) => ({
    intentRef: { aggregateType: 'ControlIntent', projectId: P, workspaceId: 'W', intentId: `s${i + 1}` },
    text: { text: 'p'.repeat(x), truncated: false } }));
  b.unknownCallReview = reviewSection({ items: [reviewItem(1)] });
  renderBoth('final path kept prefix', b);
}
{
  function throwsOf(fn) { try { fn(); return null; } catch (e) { return String(e); } }
  const huge = () => {
    const b = base.baseBrief();
    b.previous.unacceptedSteers = Array.from({ length: 30 }, (_, i) => ({
      intentRef: { aggregateType: 'ControlIntent', projectId: P, workspaceId: 'W', intentId: `s${i + 1}` },
      text: { text: 'p'.repeat(4000), truncated: false } }));
    return b;
  };
  for (const [label, mutate] of [
    ['capacity anomaly', (b) => { b.anomalies = anomaly({ anchors: Array.from({ length: 40 }, (_, i) => anchor(i + 1)) }); }],
    ['capacity review', (b) => { b.unknownCallReview = reviewSection({ items: Array.from({ length: 40 }, (_, i) =>
      reviewItem(i + 1, { callId: `c${i}${'x'.repeat(30)}`, files: [file('src/a.ts')] })), disposition: disposition({
      targets: Array.from({ length: 40 }, (_, i) => i + 1), platformTargets: Array.from({ length: 40 }, (_, i) => i + 1) }) }); }],
  ]) {
    const b = huge(); mutate(b); const d = base.continuationBriefDigest(b);
    const a = throwsOf(() => base.renderContinuationBriefZh(b, d));
    const c = throwsOf(() => result.renderContinuationBriefZh(b, d));
    sameString(label, String(a), String(c));
  }
}
// ---- approved methods ----
sameArray('approved method one', base.approvedMethodLinesZh([{ alias: 1, command: 'echo ok', cwd: 'a\nb' }]),
  result.approvedMethodLinesZh([{ alias: 1, command: 'echo ok', cwd: 'a\nb' }]));
sameArray('approved method many', base.approvedMethodLinesZh([
  { alias: 1, command: base.APPROVED_COMMAND, cwd: null },
  { alias: 2, command: 'a\r\nb', cwd: 'x\r\ny' },
  { alias: 30, command: '', cwd: '' },
]), result.approvedMethodLinesZh([
  { alias: 1, command: base.APPROVED_COMMAND, cwd: null },
  { alias: 2, command: 'a\r\nb', cwd: 'x\r\ny' },
  { alias: 30, command: '', cwd: '' },
]));
sameString('standing instructions', base.CONTINUATION_STANDING_INSTRUCTIONS_ZH_V1.join('\n'), result.CONTINUATION_STANDING_INSTRUCTIONS_ZH_V1.join('\n'));

// ---- K3 review/proposal ----
const WORKSPACE = { status: 'captured', runBaselineKnown: true, notVisible: ['secret', '.env'], notVisibleOmitted: 2,
  changedSample: [{ path: 'a.ts', change: 'modified' }, { path: 'b.ts', change: 'added' }], changedOmitted: 2 };
function k3(over = {}) {
  return { reviewRef: ref('origin'), revision: 9, phase: 'review', round: 1,
    items: [
      { alias: 1, toolName: 'run_readonly_command', display: 'full', command: { text: 'echo one\n--flag', truncated: false },
        cwd: '/w', startedAt: '2026-10-16T00:00:01.000Z', sameBatch: [2], current: null },
      { alias: 2, toolName: 'shell', display: 'truncated', command: { text: 'echo two', truncated: true }, cwd: null,
        startedAt: null, sameBatch: [], current: null },
      { alias: 3, toolName: 'send_message', display: 'unexpanded', command: null, cwd: null, startedAt: null,
        sameBatch: [], current: null },
    ], targets: null, personText: null, annotations: [], platformTargets: [], workspace: WORKSPACE, ...over };
}
const k3both = (label, over) => {
  const input = k3(over);
  sameString(label, base.renderUnknownCallReviewZh(structuredClone(input)), result.renderUnknownCallReviewZh(structuredClone(input)));
};
k3both('k3 review empty workspace', { workspace: { status: 'unavailable', runBaselineKnown: false, notVisible: [],
  notVisibleOmitted: 0, changedSample: [], changedOmitted: 0 } });
k3both('k3 review written', { items: [
  { alias: 1, toolName: 'x', display: 'full', command: { text: 'c', truncated: false }, cwd: '/w', startedAt: 's',
    sameBatch: [2, 3], current: { verdict: 'done', by: 'review_round', evidence: 'e' } },
  { alias: 2, toolName: 'y', display: 'full', command: null, cwd: null, startedAt: null, sameBatch: [],
    current: { verdict: 'not_done', by: 'settlement', evidence: 'e2' } },
  { alias: 3, toolName: 'z', display: 'full', command: { text: 'c', truncated: true }, cwd: null, startedAt: null,
    sameBatch: [], current: { verdict: 'pending', by: 'platform', evidence: 'e3' } },
] });
k3both('k3 review unexpanded only', { items: [{ alias: 7, toolName: 'shell', display: 'unexpanded', command: null,
  cwd: null, startedAt: null, sameBatch: [], current: null }] });
k3both('k3 proposal full', { phase: 'proposal', targets: [2, 1], personText: '注'.repeat(2000),
  annotations: [{ path: 'a.ts', text: '看这里' }, { path: null, text: '记一笔' }], platformTargets: [3] });
k3both('k3 proposal no person empty annotations', { phase: 'proposal', targets: [], personText: '',
  annotations: [], platformTargets: [] });
k3both('k3 proposal person empty string targets null', { phase: 'proposal', targets: null, personText: '',
  annotations: [], platformTargets: [] });
k3both('k3 proposal unknown alias', { phase: 'proposal', targets: [99], personText: null, annotations: [] });
k3both('k3 proposal unexpanded summary', { phase: 'proposal', targets: [1, 3], personText: 'n',
  annotations: [{ path: null, text: 't' }], platformTargets: [2, 1],
  items: [
    { alias: 1, toolName: 'run_readonly_command', display: 'unexpanded', command: null, cwd: null, startedAt: null,
      sameBatch: [], current: null, summaryCommand: 'echo one\n--flag' },
    { alias: 2, toolName: 'shell', display: 'full', command: { text: 'c', truncated: false }, cwd: '/w', startedAt: 's',
      sameBatch: [], current: null },
    { alias: 3, toolName: 'other', display: 'truncated', command: { text: '{{x}}', truncated: true }, cwd: '', startedAt: '',
      sameBatch: [], current: null, summaryCommand: '' },
  ] });
k3both('k3 review long names/lines', { items: [{ alias: 1, toolName: 't', display: 'full',
  command: { text: 'x'.repeat(5000), truncated: false }, cwd: 'a\r\nb', startedAt: 's', sameBatch: [1, 2, 3], current: null }] });

console.log('checks', checks, 'all byte-identical');
