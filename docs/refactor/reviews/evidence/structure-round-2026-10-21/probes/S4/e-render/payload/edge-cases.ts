/**
 * S4 (D3b) edge-input matrix (inventory §4 item 2), shared by the base copy and
 * the result copy. The case list is copy-independent: only the adapter that
 * imports the real functions (`tests/probes/edge-targets.ts`, written by the
 * installer variant) differs. Every value is fixed: no clock, no random id.
 */
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';

export type EdgeCase = { name: string; probe: string; args: unknown[] };

const P = 'project-1';
const G = 'goal-1';
const W = 'workspace-1';
const goalRef = { aggregateType: 'Goal', projectId: P, goalId: G };
const planRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const triple = (taskId = 't1') => ({ projectId: P, goalId: G, taskId });

function permissions(tools = ['read', 'write'], writeScope = ['.']) {
  return { policyRevision: 'policy-1', tools, writeScope };
}

function noteRow(anchorKey: string, n: string, over: Record<string, unknown> = {}) {
  return {
    anchorKey, noteId: `note-${n}`, version: 2, kind: 'general', conclusion: `conclusion ${n}`,
    freshness: 'fresh', label: `label ${n}`, ...over,
  };
}

function uRow(scope: string, n: string, over: Record<string, unknown> = {}) {
  const anchorKey = scope === 'project' ? 'project' : scope === 'goal' ? `goal:${G}` : `stage:${G}/7/stage-1`;
  return {
    scope, status: { anchorKey, pointer: { noteId: `u-${n}`, revision: 4 }, updateDue: false, latestTriggerCursor: null },
    version: 3, currentEligible: true, conclusion: `understanding ${n}`, body: `body ${n}`, ...over,
  };
}

function makeExt(parts: Record<string, any> = {}) {
  return {
    notes: parts.notes ?? {
      availability: 'available',
      understanding: { rows: [], norms: [], normsOmitted: 0 },
      general: [],
    },
    anomalies: parts.anomalies ?? { availability: 'available', rows: [] },
    footprint: parts.footprint ?? { availability: 'not_implemented', rows: [] },
    goalSettings: parts.goalSettings ?? { availability: 'available', autonomy: 'every_step' },
    decisions: parts.decisions ?? { availability: 'available', rows: [] },
  };
}

const indexRow = (key: string, text: string) => ({
  key, node: { kind: 'goal', ref: goalRef }, text, sources: [],
});

function makePlan(over: Record<string, unknown> = {}) {
  const base = {
    ref: planRef, revision: 1, goalRef, planId: 'plan-1', planRevision: 7,
    acceptedAt: '2026-01-01T00:00:00.000Z',
    effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: P, policyId: 'cp' }, revision: 1 },
    effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: P, baselineId: 'ab' }, revision: 1 },
    stages: [{ stageId: 'stage-1', title: 'Stage One' }],
    tasks: [{
      taskId: 't1', stageId: 'stage-1', title: 'Task One', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending',
      scope: { kind: 'module', stageId: 'stage-1', moduleRef: 'module.a' },
    }],
    assignments: [{ taskId: 't1', role: 'executor', instruction: 'do the thing' }],
    obligations: [{
      obligationId: 'obligation-1', title: 'Obligation One', requirementLevel: 'required', taskIds: ['t1'],
      verificationRequirements: [
        { requirementId: 'req-2', requirementLevel: 'required', kind: 'check', description: 'second' },
        { requirementId: 'req-1', requirementLevel: 'required', kind: 'check', description: 'first' },
      ],
    }],
    taskHierarchy: { parentOf: [] },
    executionDag: {
      dependsOn: [
        { taskId: 't1', dependsOnId: 't0', requires: { kind: 'artifact', label: 'upstream output' } },
        { taskId: 't2', dependsOnId: 't1', requires: { kind: 'artifact', label: 'downstream input' } },
      ],
    },
  };
  return { ...base, ...over };
}

function record(over: Record<string, any> = {}) {
  const taskId = over.taskId ?? 't1';
  const claim = over.claim ?? true;
  return {
    run: {
      ref: { aggregateType: 'Run', projectId: P, goalId: G, taskId, runId: 'run-1' },
      status: over.status ?? 'running', outcome: over.outcome ?? null,
      task: triple(taskId), workspaceSnapshot: { workspaceId: W, revision: 9 },
    },
    attempt: { ref: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId, attemptId: 'attempt-1' }, revision: 1 },
    outbox: claim ? { claim: { task: triple(taskId) } } : {},
    plan: makePlan(over.plan ?? {}),
    session: { workspaceId: W },
    lease: null,
    readThrough: null,
  };
}

function taskGraphRow(taskId: string, phase: string, title: string) {
  return { ref: triple(taskId), definition: { title }, effectivePhase: phase };
}

function architecture(over: Record<string, unknown> = {}) {
  return {
    modules: [
      { ref: { projectId: P, moduleId: 'module.parent' }, name: 'Parent', responsibility: 'parent resp', paths: [], interfaces: [] },
      { ref: { projectId: P, moduleId: 'module.child' }, name: 'Child', responsibility: 'child resp', paths: [], interfaces: [] },
      { ref: { projectId: P, moduleId: 'module.other' }, name: 'Other', responsibility: '中文职责 😀', paths: [], interfaces: [] },
    ],
    dependencies: [], requireDag: true,
    containment: { parentOf: [{ parent: { projectId: P, moduleId: 'module.parent' }, child: { projectId: P, moduleId: 'module.child' } }] },
    ...over,
  };
}

// --------------------------------------------------------------------------
// renderContext candidate-prefix byte boundaries (−1 / == / +1 per k).
// The candidate text is the base rule (header + rows + omission marker); it is
// only used to choose the budgets, the recorded output is the real function's.
// --------------------------------------------------------------------------
const OPTIONAL_NAMES = ['footprint', 'notes', 'reminders', 'inputs'] as const;
const OPTIONAL_HEADERS: Record<string, string> = {
  footprint: '## Footprint', notes: '## Note index', reminders: '## Reminders', inputs: '## Selected inputs',
};
function orderedRows(name: string, rows: any[]) {
  return name === 'notes' ? [...rows] : [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
function candidateText(optional: Record<string, any[]>, k: number): string {
  const present = OPTIONAL_NAMES
    .map((name) => ({ name, rows: orderedRows(name, optional[name] ?? []) }))
    .filter((section) => section.rows.length > 0);
  let remaining = k;
  const parts: string[] = [];
  for (const section of present) {
    const kept = Math.min(remaining, section.rows.length);
    remaining -= kept;
    const missing = section.rows.length - kept;
    let text = OPTIONAL_HEADERS[section.name]!;
    if (kept > 0) text += '\n' + section.rows.slice(0, kept).map((row) => row.text).join('\n');
    if (missing > 0) text += `\n另有 ${String(missing)} 条，用‘看’读`;
    parts.push(text);
  }
  return parts.length === 0 ? '' : '\n\n' + parts.join('\n\n');
}
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

const boundaryOptional = {
  footprint: [
    { key: 'z', text: 'footprint z' },
    { key: 'a', text: 'footprint a' },
  ],
  notes: [
    { key: 'note:b', text: 'note b' },
    { key: 'note:a', text: 'note a' },
  ],
  reminders: [{ key: 'anomaly:1', text: 'reminder 1' }],
  inputs: [{ key: 'input:1', text: 'input 1' }],
};

export const EDGE_CASES: EdgeCase[] = [];
function add(name: string, probe: string, args: unknown[]) { EDGE_CASES.push({ name, probe, args }); }

// ==========================================================================
// renderContext
// ==========================================================================
const ctx = (over: Record<string, any> = {}) => ({
  prelude: 'PRELUDE',
  required: { role: 'ROLE BODY', goal: 'GOAL BODY', task: 'TASK BODY' },
  optional: {},
  continuationSuffix: null,
  residentBudgetBytes: 1_000_000,
  ...over,
});

add('renderContext.prelude-empty', 'renderContext', [ctx({ prelude: '' })]);
add('renderContext.prelude-nonempty', 'renderContext', [ctx({ prelude: '# Verified runtime task input\n\nbody' })]);
add('renderContext.role-empty', 'renderContext', [ctx({ required: { role: '', goal: 'GOAL', task: 'TASK' } })]);
add('renderContext.goal-null', 'renderContext', [ctx({ required: { role: 'ROLE', goal: null, task: 'TASK' } })]);
add('renderContext.goal-empty', 'renderContext', [ctx({ required: { role: 'ROLE', goal: '', task: 'TASK' } })]);
add('renderContext.goal-plain', 'renderContext', [ctx({ required: { role: 'ROLE', goal: 'goal: g1', task: 'TASK' } })]);
add('renderContext.task-null', 'renderContext', [ctx({ required: { role: 'ROLE', goal: 'GOAL', task: null } })]);
add('renderContext.task-empty', 'renderContext', [ctx({ required: { role: 'ROLE', goal: 'GOAL', task: '' } })]);
add('renderContext.task-plain', 'renderContext', [ctx({ required: { role: 'ROLE', goal: 'GOAL', task: 'task: t1' } })]);
add('renderContext.optional-footprint-alone', 'renderContext', [ctx({
  optional: { footprint: [{ key: 'z', text: 'fz' }, { key: 'a', text: 'fa' }] },
})]);
add('renderContext.optional-notes-alone', 'renderContext', [ctx({
  optional: { notes: [{ key: 'note:b', text: 'nb' }, { key: 'note:a', text: 'na' }] },
})]);
add('renderContext.optional-reminders-alone', 'renderContext', [ctx({
  optional: { reminders: [{ key: 'b', text: 'rb' }, { key: 'a', text: 'ra' }] },
})]);
add('renderContext.optional-inputs-alone', 'renderContext', [ctx({
  optional: { inputs: [{ key: 'i2', text: 'i2' }, { key: 'i1', text: 'i1' }] },
})]);
add('renderContext.optional-all-reversed-notes', 'renderContext', [ctx({
  optional: {
    footprint: [{ key: 'z', text: 'fz' }, { key: 'a', text: 'fa' }],
    notes: [{ key: 'z', text: 'nz' }, { key: 'a', text: 'na' }, { key: 'm', text: 'nm' }],
    reminders: [{ key: 'z', text: 'rz' }, { key: 'a', text: 'ra' }],
    inputs: [{ key: 'z', text: 'iz' }, { key: 'a', text: 'ia' }],
  },
})]);
add('renderContext.budget-zero-empty-optional', 'renderContext', [ctx({ residentBudgetBytes: 0 })]);
add('renderContext.budget-zero-with-optional', 'renderContext', [ctx({ optional: boundaryOptional, residentBudgetBytes: 0 })]);
add('renderContext.budget-negative', 'renderContext', [ctx({ optional: boundaryOptional, residentBudgetBytes: -1 })]);
for (let k = 0; k <= 6; k += 1) {
  const exact = utf8Bytes(candidateText(boundaryOptional, k));
  for (const [suffix, budget] of [['minus1', exact - 1], ['exact', exact], ['plus1', exact + 1]] as const) {
    add(`renderContext.boundary-k${k}-${suffix}`, 'renderContext', [ctx({
      optional: boundaryOptional, residentBudgetBytes: budget,
    })]);
  }
}
add('renderContext.continuation-absent', 'renderContext', [ctx({ optional: { inputs: [{ key: 'i', text: 'i' }] } })]);
add('renderContext.continuation-null-review-null', 'renderContext', [ctx({ continuationSuffix: null, reviewSuffix: null })]);
add('renderContext.continuation-empty-review-null', 'renderContext', [ctx({ continuationSuffix: '', reviewSuffix: null })]);
add('renderContext.continuation-nonempty-review-null', 'renderContext', [ctx({ continuationSuffix: 'CONTINUATION', reviewSuffix: null })]);
add('renderContext.continuation-null-review-empty', 'renderContext', [ctx({ continuationSuffix: null, reviewSuffix: '' })]);
add('renderContext.continuation-null-review-nonempty', 'renderContext', [ctx({ continuationSuffix: null, reviewSuffix: 'REVIEW' })]);
add('renderContext.continuation-and-review-nonempty', 'renderContext', [ctx({ continuationSuffix: 'C', reviewSuffix: 'R' })]);
add('renderContext.continuation-empty-review-empty', 'renderContext', [ctx({ continuationSuffix: '', reviewSuffix: '' })]);
add('renderContext.unicode-and-controls', 'renderContext', [ctx({
  prelude: 'line1\r\nline2 中文 😀 e\u0301 `backtick` {{slot}}  ',
  required: {
    role: 'role {{role}}\r\n中文 e\u0301 😀 trailing   ',
    goal: '目标：中文 😀 `g`  ',
    task: 'task {{task}}\te\u0301  ',
  },
  optional: {
    footprint: [{ key: 'k {{slot}}', text: 'foot `x` 中文 😀 ' }],
    notes: [{ key: 'note:中文', text: 'note e\u0301 {{note}}  ' }],
  },
  continuationSuffix: '续\r\n😀',
  reviewSuffix: 'review `r` e\u0301',
})]);

// ==========================================================================
// renderQueryContext (result-only split; the base adapter maps it to the base
// renderContext with the same prelude/required/optional, so the case list is
// shared). Planning is expressed by the footprint slot being present.
// ==========================================================================
const QUERY_PRELUDE = '# Verified read-only Query input\n\nThis is the current bounded Query context assembled from formal platform facts; it is not a transcript.';
const queryCtx = (over: Record<string, any> = {}) => ({
  templateId: 'query-copy-input', prelude: QUERY_PRELUDE,
  required: { role: 'QUERY ROLE', goal: 'goal: g1', task: null },
  optional: {}, residentBudgetBytes: 1_000_000, ...over,
});
add('renderQueryContext.copy-empty-footprint', 'renderQueryContext', [queryCtx()]);
add('renderQueryContext.planning-footprint-unsorted', 'renderQueryContext', [queryCtx({
  templateId: 'query-planning-input',
  optional: { footprint: [{ key: 'z', text: 'fz' }, { key: 'a', text: 'fa' }] },
})]);
add('renderQueryContext.planning-empty-footprint', 'renderQueryContext', [queryCtx({
  templateId: 'query-planning-input', optional: { footprint: [] },
})]);
add('renderQueryContext.planning-budget-zero', 'renderQueryContext', [queryCtx({
  templateId: 'query-planning-input', optional: { footprint: [{ key: 'a', text: 'fa' }] }, residentBudgetBytes: 0,
})]);
add('renderQueryContext.unicode', 'renderQueryContext', [queryCtx({
  required: { role: 'role {{x}}\r\n中文 😀', goal: '目标 e\u0301  ', task: null },
  optional: { footprint: [{ key: '模块', text: '职责 `f` 😀' }] },
  residentBudgetBytes: 1_000_000,
})]);

// ==========================================================================
// renderAttentionChanges
// ==========================================================================
const attention = (over: Record<string, any> = {}) => ({
  scope: { projectId: P, workspaceId: W }, goalRef: null, nodes: [], edges: [], revision: null,
  files: [], heartbeat: null, feedbackIds: [], ...over,
});
add('attention.empty', 'renderAttentionChanges', [attention()]);
add('attention.revision-only', 'renderAttentionChanges', [attention({ revision: { before: null, after: 'rev-9' } })]);
add('attention.goal-and-nodes-unsorted', 'renderAttentionChanges', [attention({
  goalRef,
  nodes: [
    { key: 'z', change: 'added', beforeVersion: null, afterVersion: '2', detail: { node: { kind: 'goal', ref: goalRef }, name: 'Z', summary: 'zs', state: null } },
    { key: 'a', change: 'removed', beforeVersion: '1', afterVersion: null, detail: { node: { kind: 'goal', ref: goalRef }, name: 'A', summary: 'as', state: 'running' } },
  ],
  edges: [{ key: 'z', change: 'added' }, { key: 'a', change: 'removed' }],
  files: [{ path: 'z.ts', version: null }, { path: 'a.ts', version: 'v1' }],
  feedbackIds: ['f2', 'f1'],
})]);
add('attention.heartbeat', 'renderAttentionChanges', [attention({
  heartbeat: { pendingInputs: 0, messageCursor: null },
})]);
add('attention.heartbeat-nonzero', 'renderAttentionChanges', [attention({
  heartbeat: { pendingInputs: 3, messageCursor: 'cursor-1' },
})]);
add('attention.unicode', 'renderAttentionChanges', [attention({
  nodes: [{ key: '中文', change: 'added', beforeVersion: null, afterVersion: 'v', detail: {
    node: { kind: 'goal', ref: goalRef }, name: '😀 e\u0301', summary: '`s` {{x}}', state: null } }],
  feedbackIds: ['反馈'],
})]);
const manyNodes = [];
for (let index = 0; index < 200; index += 1) {
  manyNodes.push({
    key: `node-${String(index).padStart(4, '0')}`, change: 'added', beforeVersion: null, afterVersion: '1',
    detail: { node: { kind: 'goal', ref: goalRef }, name: `n${index}`, summary: 'x'.repeat(120), state: null },
  });
}
add('attention-overflow-omitted', 'renderAttentionChanges', [attention({ nodes: manyNodes })]);

// ==========================================================================
// effectiveDuty
// ==========================================================================
const roleResolved = (duty?: string) => ({
  status: 'resolved', roleId: 'role-1', revision: { revision: 2 },
  spec: {
    ...(duty === undefined ? {} : { platformDuty: duty }),
    label: 'Label', purpose: 'Purpose', responsibility: ['execution'],
    requiredMaterials: [{ kind: 'note', reason: 'need' }],
    requiredOutputs: [{ kind: 'artifact', reason: 'out' }],
    exit: { success: 'ok', stop: 'stop', handoff: 'handoff' },
  },
});
const roleAbsent = { status: 'absent', roleId: 'role-x', reason: 'not installed' };
const legacyOf = (duty: string) => platformRoleProfile(duty as never).template;

add('effectiveDuty.resolved-executor', 'fact.effectiveDuty', [roleResolved('executor'), {}, undefined]);
add('effectiveDuty.resolved-host-secretary', 'fact.effectiveDuty', [roleResolved('secretary'), { platformDuty: 'secretary' }, undefined]);
add('effectiveDuty.resolved-adviser-template-executor', 'fact.effectiveDuty', [roleResolved('adviser'), { platformDuty: 'adviser' }, legacyOf('executor')]);
add('effectiveDuty.absent-host-scribe', 'fact.effectiveDuty', [roleAbsent, { platformDuty: 'scribe' }, undefined]);
add('effectiveDuty.absent-template-reviewer', 'fact.effectiveDuty', [roleAbsent, {}, legacyOf('reviewer')]);
add('effectiveDuty.all-undefined', 'fact.effectiveDuty', [roleAbsent, undefined, undefined]);
add('effectiveDuty.resolved-no-duty-host-reviewer', 'fact.effectiveDuty', [roleResolved(undefined), { platformDuty: 'reviewer' }, undefined]);
add('effectiveDuty.reject-role-vs-host', 'fact.effectiveDuty', [roleResolved('executor'), { platformDuty: 'secretary' }, undefined]);
add('effectiveDuty.reject-template-vs-host', 'fact.effectiveDuty', [roleAbsent, { platformDuty: 'reviewer' }, legacyOf('secretary')]);
add('effectiveDuty.unrelated-template', 'fact.effectiveDuty', [roleAbsent, {}, { kind: 'legacy_template', templateId: 'other', templateRevision: '1' }]);

// ==========================================================================
// rolePayload
// ==========================================================================
add('rolePayload.resolved-full', 'fact.rolePayload', [
  roleResolved('executor'), permissions(['read', 'write'], ['.']), 'executor', 4096,
]);
add('rolePayload.resolved-empty-permissions-zero-budget', 'fact.rolePayload', [
  roleResolved('reviewer'), permissions([], []), 'reviewer', 0,
]);
add('rolePayload.absent-executor', 'fact.rolePayload', [roleAbsent, permissions(), 'executor', 321]);
add('rolePayload.absent-secretary-empty', 'fact.rolePayload', [roleAbsent, permissions([], []), 'secretary', 123]);
add('rolePayload.absent-scribe-unicode', 'fact.rolePayload', [
  { status: 'absent', roleId: '角色 😀', reason: '未安装 {{x}}' }, permissions(['工具'], ['路径 中文']), 'scribe', 1,
]);
add('rolePayload.resolved-duty-mismatch-in-spec', 'fact.rolePayload', [
  roleResolved('executor'), permissions(['t'], ['.']), 'adviser', 7,
]);

// ==========================================================================
// goalPayload
// ==========================================================================
const goal = {
  ref: goalRef, workspaceRef: { aggregateType: 'Workspace', projectId: P, workspaceId: W },
  objective: 'Ship the thing', desiredState: 'active', desiredStateRevision: 1,
  desiredStateRequestedBy: null, activePlanRevision: null, revision: 2,
};
add('goalPayload.not-implemented', 'fact.goalPayload', [goal, 9, makeExt({
  notes: { availability: 'not_implemented', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
  goalSettings: { availability: 'not_implemented', autonomy: null },
})]);
add('goalPayload.autonomy-null', 'fact.goalPayload', [goal, 9, makeExt({ goalSettings: { availability: 'available', autonomy: null } })]);
add('goalPayload.autonomy-every-step-empty', 'fact.goalPayload', [goal, 0, makeExt()]);
add('goalPayload.understanding-project', 'fact.goalPayload', [goal, 3, makeExt({
  notes: { availability: 'available', understanding: { rows: [uRow('project', 'p')], norms: [], normsOmitted: 0 }, general: [] },
})]);
add('goalPayload.understanding-three-and-norm', 'fact.goalPayload', [goal, 3, makeExt({
  notes: { availability: 'available', understanding: {
    rows: [uRow('project', 'p'), uRow('goal', 'g'), uRow('stage', 's')],
    norms: [noteRow('project', 'norm', { label: '项目规范' })], normsOmitted: 0,
  }, general: [] },
})]);
add('goalPayload.understanding-four-sliced-norms-omitted', 'fact.goalPayload', [goal, 3, makeExt({
  notes: { availability: 'available', understanding: {
    rows: [uRow('project', '1'), uRow('goal', '2'), uRow('stage', '3'), uRow('goal', '4')],
    norms: [], normsOmitted: 2,
  }, general: [] },
})]);
add('goalPayload.understanding-ineligible-with-note', 'fact.goalPayload', [goal, 1, makeExt({
  notes: { availability: 'available', understanding: { rows: [uRow('goal', 'bad', {
    currentEligible: false, conclusion: 'old', body: null,
  })], norms: [], normsOmitted: 0 }, general: [] },
})]);
add('goalPayload.understanding-ineligible-no-note', 'fact.goalPayload', [goal, 1, makeExt({
  notes: { availability: 'available', understanding: {
    rows: [uRow('stage', 'none', { currentEligible: false, version: null, conclusion: null, body: null })],
    norms: [], normsOmitted: 0,
  }, general: [] },
})]);
add('goalPayload.understanding-no-note-eligible', 'fact.goalPayload', [goal, 1, makeExt({
  notes: { availability: 'available', understanding: {
    rows: [uRow('project', 'none', { version: null, conclusion: null, body: null })],
    norms: [], normsOmitted: 0,
  }, general: [] },
})]);
add('goalPayload.unicode', 'fact.goalPayload', [{ ...goal, objective: '目标 😀 e\u0301 `o`  ' }, 12, makeExt({
  notes: { availability: 'available', understanding: {
    rows: [uRow('project', 'u', { conclusion: '结论 {{x}}', body: '正文 😀\r\n' })], norms: [], normsOmitted: 0,
  }, general: [] },
})]);

// ==========================================================================
// taskPayload
// ==========================================================================
add('taskPayload.no-claim', 'fact.taskPayload', [makePlan(), record({ claim: false }), { tasks: [] }]);
add('taskPayload.task-not-in-plan', 'fact.taskPayload', [makePlan({ tasks: [] }), record(), null]);
add('taskPayload.full', 'fact.taskPayload', [makePlan(), record(), { tasks: [taskGraphRow('t1', 'running', 'Task One')] }]);
add('taskPayload.goal-scope-no-stage', 'fact.taskPayload', [makePlan({
  tasks: [{ taskId: 't1', title: 'Goal Task', requirementLevel: 'optional', taskKind: 'work', disposition: 'deferred', phase: 'pending', scope: { kind: 'goal' } }],
  assignments: [], stages: [],
}), record(), null]);
add('taskPayload.module-stage-present', 'fact.taskPayload', [makePlan({
  tasks: [{ taskId: 't1', stageId: 'stage-9', title: 'Task Z', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'blocked', scope: { kind: 'module', stageId: 'stage-9', moduleRef: 'module.z' } }],
  stages: [{ stageId: 'stage-9', title: 'Stage Nine' }],
}), record(), { tasks: [taskGraphRow('t1', 'satisfied', 'Task Z')] }]);
add('taskPayload.legacy-input-requirements', 'fact.taskPayload', [makePlan({
  inputRequirements: [
    { requirementId: 'req-b', consumerTaskId: 't1', kind: 'artifact', artifactRef: { aggregateType: 'Artifact', projectId: P, artifactId: 'art-b' } },
    { requirementId: 'req-a', consumerTaskId: 't1', kind: 'artifact', artifactRef: { aggregateType: 'Artifact', projectId: P, artifactId: 'art-a' } },
    { requirementId: 'req-other', consumerTaskId: 't2', kind: 'artifact', artifactRef: { aggregateType: 'Artifact', projectId: P, artifactId: 'art-c' } },
  ],
}), record(), { tasks: [] }]);
add('taskPayload.obligations-sorted', 'fact.taskPayload', [makePlan({
  obligations: [
    { obligationId: 'o-z', title: 'Z', requirementLevel: 'required', taskIds: ['t1'], verificationRequirements: [] },
    { obligationId: 'o-a', title: 'A', requirementLevel: 'optional', taskIds: ['t1'], verificationRequirements: [] },
  ],
}), record(), { tasks: [] }]);
add('taskPayload.run-ended-outcome', 'fact.taskPayload', [makePlan(), record({ status: 'ended', outcome: 'completed' }), { tasks: [] }]);

// ==========================================================================
// queryFocusLines
// ==========================================================================
const queryFacts = (refs: any[] | null) => ({
  record: { job: { job: { intent: refs === null ? null : { focusTaskRefs: refs } } } },
});
add('queryFocusLines.none', 'fact.queryFocusLines', [queryFacts([]), { tasks: [] }]);
add('queryFocusLines.intent-null', 'fact.queryFocusLines', [queryFacts(null), { tasks: [] }]);
add('queryFocusLines.one-found', 'fact.queryFocusLines', [queryFacts([{ ...triple('t1'), goalId: G }]), {
  tasks: [taskGraphRow('t1', 'running', 'Task One')],
}]);
add('queryFocusLines.two-one-missing', 'fact.queryFocusLines', [queryFacts([
  { ...triple('t1'), goalId: G }, { ...triple('t2'), goalId: G },
]), { tasks: [taskGraphRow('t1', 'running', '任务 😀')] }]);
add('queryFocusLines.graph-null', 'fact.queryFocusLines', [queryFacts([{ ...triple('t1'), goalId: G }]), null]);

// ==========================================================================
// queryPlanSummary
// ==========================================================================
add('queryPlanSummary.empty', 'fact.queryPlanSummary', [makePlan({ stages: [], tasks: [] })]);
add('queryPlanSummary.one-each', 'fact.queryPlanSummary', [makePlan({ stages: [{ stageId: 's', title: 'S' }], tasks: [{ taskId: 't', title: 'T' }] })]);
add('queryPlanSummary.many-unicode', 'fact.queryPlanSummary', [makePlan({
  stages: [{ stageId: 's1', title: '阶段一' }, { stageId: 's2', title: 'Stage 😀' }],
  tasks: [{ taskId: 't1', title: '任务 `x`' }, { taskId: 't2', title: 'e\u0301' }],
})]);

// ==========================================================================
// notImplementedExtensions
// ==========================================================================
add('notImplementedExtensions.empty', 'fact.notImplementedExtensions', []);

// ==========================================================================
// noteSourcesOf
// ==========================================================================
add('noteSources.empty', 'fact.noteSourcesOf', [
  makeExt({ notes: { availability: 'not_implemented', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] } }).notes,
  [],
]);
add('noteSources.rows-norms-general', 'fact.noteSourcesOf', [
  makeExt({ notes: { availability: 'available', understanding: {
    rows: [uRow('project', 'p'), uRow('goal', 'g'), uRow('stage', 's'), uRow('goal', 'fourth')],
    norms: [noteRow('goal:g', 'norm-b', { label: 'norm b' }), noteRow('stage:g/7/stage-1', 'norm-a', { label: 'norm a' })],
    normsOmitted: 1,
  }, general: [] } }).notes,
  [noteRow('task:t1', 'g1'), noteRow('task:t1', 'g2')],
]);
add('noteSources.skips-null-pointer-and-version', 'fact.noteSourcesOf', [
  makeExt({ notes: { availability: 'available', understanding: {
    rows: [uRow('goal', 'n1', { status: { anchorKey: `goal:${G}`, pointer: { noteId: null, revision: null }, updateDue: null, latestTriggerCursor: null } }),
      uRow('stage', 'n2', { version: null })],
    norms: [], normsOmitted: 0,
  }, general: [] } }).notes,
  [],
]);
const manyUnderstanding = Array.from({ length: 25 }, (_, index) =>
  uRow(index % 3 === 0 ? 'project' : index % 3 === 1 ? 'goal' : 'stage', `many-${index}`));
const manyGeneral = Array.from({ length: 25 }, (_, index) =>
  noteRow(index === 0 ? '' : `anchor:${index}`, `many-${index}`));
add('noteSources.many-rows-empty-anchor', 'fact.noteSourcesOf', [makeExt({
  notes: { availability: 'available', understanding: {
    rows: manyUnderstanding,
    norms: [noteRow('', 'norm-empty'), noteRow('goal:g', 'norm-1'), noteRow('stage:g/7/stage-1', 'norm-2'), noteRow('project', 'norm-3')],
    normsOmitted: 3,
  }, general: [] },
}).notes, manyGeneral]);
add('noteSources.dedupe-and-unicode', 'fact.noteSourcesOf', [
  makeExt({ notes: { availability: 'available', understanding: {
    rows: [uRow('goal', 'same', { conclusion: '结论 😀' })], norms: [], normsOmitted: 0,
  }, general: [] } }).notes,
  [noteRow('goal:g', 'same', { label: '同一 note' })],
]);

// ==========================================================================
// declarationsForTask
// ==========================================================================
add('declarationsForTask.none', 'fact.declarationsForTask', [makePlan({ executionDag: { dependsOn: [] } }), 't1']);
add('declarationsForTask.edges-and-legacy', 'fact.declarationsForTask', [makePlan({
  inputRequirements: [{ requirementId: 'req-b', consumerTaskId: 't1', kind: 'artifact', artifactRef: { aggregateType: 'Artifact', projectId: P, artifactId: 'b' } }],
}), 't1']);
add('declarationsForTask.other-task-only', 'fact.declarationsForTask', [makePlan(), 't2']);
add('declarationsForTask.no-input-requirements-field', 'fact.declarationsForTask', [makePlan({ inputRequirements: undefined }), 't1']);

// ==========================================================================
// missingInputReminder
// ==========================================================================
const selection = (over: Record<string, any> = {}) => ({
  declaration: {
    declarationId: 'decl-1', consumer: triple(), planRef,
    upstream: null, requires: { kind: 'artifact', label: 'x' }, legacyArtifactRef: null,
    ...(over.declaration ?? {}),
  },
  state: over.state ?? 'missing',
  source: null, candidates: [], usage: 'historical_explanation',
  reason: over.reason ?? null, errorCode: null,
});
add('missingInputReminder.no-upstream-no-executions', 'fact.missingInputReminder', [selection(), []]);
add('missingInputReminder.no-upstream-reason', 'fact.missingInputReminder', [selection({ reason: 'not produced yet', state: 'ambiguous' }), []]);
add('missingInputReminder.upstream-no-record', 'fact.missingInputReminder', [
  selection({ declaration: { upstream: triple('t0') } }), [],
]);
add('missingInputReminder.upstream-found-open', 'fact.missingInputReminder', [
  selection({ declaration: { upstream: triple('t0') } }), [record({ taskId: 't0', status: 'running', outcome: null })],
]);
add('missingInputReminder.upstream-found-completed', 'fact.missingInputReminder', [
  selection({ declaration: { upstream: triple('t0') } }), [record({ taskId: 't0', status: 'ended', outcome: 'completed' })],
]);
add('missingInputReminder.upstream-found-failed', 'fact.missingInputReminder', [
  selection({ declaration: { upstream: triple('t0') } }), [record({ taskId: 't0', status: 'ended', outcome: 'failed' })],
]);

// ==========================================================================
// optionalRowsFromExtensions
// ==========================================================================
add('optionalRows.empty', 'fact.optionalRowsFromExtensions', [makeExt({
  notes: { availability: 'available', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
})]);
add('optionalRows.general-reversed', 'fact.optionalRowsFromExtensions', [makeExt({
  notes: { availability: 'available', understanding: { rows: [], norms: [], normsOmitted: 0 },
    general: [noteRow('z', 'z'), noteRow('a', 'a')] },
})]);
add('optionalRows.anomalies-prefix', 'fact.optionalRowsFromExtensions', [makeExt({
  anomalies: { availability: 'available', rows: [indexRow('a', 'a-text'), indexRow('anomaly:b', 'b-text')] },
})]);
add('optionalRows.decisions-prefix', 'fact.optionalRowsFromExtensions', [makeExt({
  decisions: { availability: 'available', rows: [indexRow('d', 'd-text'), indexRow('decision:e', 'e-text')] },
})]);
add('optionalRows.understanding-update-due', 'fact.optionalRowsFromExtensions', [makeExt({
  notes: { availability: 'available', understanding: {
    rows: [
      uRow('goal', 'due', { status: { anchorKey: `goal:${G}`, pointer: { noteId: 'u-due', revision: 1 }, updateDue: true, latestTriggerCursor: null } }),
      uRow('stage', 'not-due'),
      uRow('project', 'null-due', { status: { anchorKey: 'project', pointer: { noteId: null, revision: null }, updateDue: null, latestTriggerCursor: null } }),
    ],
    norms: [], normsOmitted: 0,
  }, general: [] },
})]);
add('optionalRows.many-rows-empty-anchor', 'fact.optionalRowsFromExtensions', [makeExt({
  notes: { availability: 'available', understanding: {
    rows: manyUnderstanding.map((row, index) => ({ ...row, status: { ...row.status, updateDue: index < 5 } })),
    norms: [], normsOmitted: 0,
  }, general: manyGeneral },
  anomalies: { availability: 'available', rows: Array.from({ length: 25 }, (_, index) => indexRow(index === 0 ? '' : `anomaly:${index}`, `a${index}`)) },
  decisions: { availability: 'available', rows: Array.from({ length: 25 }, (_, index) => indexRow(`decision:${index}`, `d${index}`)) },
})]);
add('optionalRows.all-combined', 'fact.optionalRowsFromExtensions', [makeExt({
  notes: { availability: 'available', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [noteRow('task:t1', 'g')] },
  anomalies: { availability: 'available', rows: [indexRow('anomaly:1', 'a')] },
  decisions: { availability: 'available', rows: [indexRow('decision:1', 'd')] },
})]);

// ==========================================================================
// annotations
// ==========================================================================
add('annotations.all-available', 'fact.annotations', [makeExt()]);
add('annotations.all-not-implemented', 'fact.annotations', [makeExt({
  notes: { availability: 'not_implemented', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
  anomalies: { availability: 'not_implemented', rows: [] },
  footprint: { availability: 'not_implemented', rows: [] },
  goalSettings: { availability: 'not_implemented', autonomy: null },
  decisions: { availability: 'not_implemented', rows: [] },
})]);
add('annotations.mixed-unavailable', 'fact.annotations', [makeExt({
  notes: { availability: 'unavailable', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
  anomalies: { availability: 'not_implemented', rows: [] },
  goalSettings: { availability: 'unavailable', autonomy: null },
})]);

// ==========================================================================
// topLevelModuleCards
// ==========================================================================
add('moduleCards.null', 'fact.topLevelModuleCards', [null]);
add('moduleCards.empty', 'fact.topLevelModuleCards', [architecture({ modules: [], containment: undefined })]);
add('moduleCards.flat', 'fact.topLevelModuleCards', [architecture({ containment: undefined })]);
add('moduleCards.containment', 'fact.topLevelModuleCards', [architecture()]);
add('moduleCards.unicode', 'fact.topLevelModuleCards', [architecture({
  modules: [{ ref: { projectId: P, moduleId: '模块-1' }, name: 'M', responsibility: '职责 😀 `x`', paths: [], interfaces: [] }],
  containment: { parentOf: [] },
})]);

// ==========================================================================
// generalWarningLabel
// ==========================================================================
const warningItem = (over: Record<string, unknown> = {}) => ({
  freshness: 'fresh', conflicting: false, sourceUnavailable: false, ...over,
});
const warningHead = { noteId: 'note-1', conclusion: 'the conclusion' };
add('generalWarningLabel.none', 'note.generalWarningLabel', [warningItem(), warningHead]);
add('generalWarningLabel.stale', 'note.generalWarningLabel', [warningItem({ freshness: 'stale' }), warningHead]);
add('generalWarningLabel.conflict', 'note.generalWarningLabel', [warningItem({ conflicting: true }), warningHead]);
add('generalWarningLabel.sourceUnavailable', 'note.generalWarningLabel', [warningItem({ sourceUnavailable: true }), warningHead]);
add('generalWarningLabel.stale-and-conflict', 'note.generalWarningLabel', [warningItem({ freshness: 'stale', conflicting: true, sourceUnavailable: true }), warningHead]);
add('generalWarningLabel.conflict-and-source', 'note.generalWarningLabel', [warningItem({ conflicting: true, sourceUnavailable: true }), warningHead]);
add('generalWarningLabel.empty-ids', 'note.generalWarningLabel', [warningItem({ freshness: 'stale' }), { noteId: '', conclusion: '' }]);
add('generalWarningLabel.unicode', 'note.generalWarningLabel', [warningItem({ freshness: 'stale' }), { noteId: '注记 😀', conclusion: '结论 e\u0301 `c`' }]);
