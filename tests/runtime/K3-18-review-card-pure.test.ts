/**
 * K3-18 (四) review card facts/options/targets (F-046): the pure card-fact
 * derivation called directly with a built record, Goal and Run.
 *
 * Moved out of `K3-18-review-card-queue.test.ts` (which keeps its real queue and
 * annotation rows). No store, platform, Host, Workflow, Runtime, fixture or stub
 * port is imported (A5). The fixed mixed line is written here as its own text
 * instead of reading the production constant (F8); the four option labels have
 * the literal texts the spec fixes.
 */
import { describe, expect, it } from 'vitest';
import type { RunSnapshot, RunRef } from '../../src/contracts/dispatch.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { UnknownCallReviewItemV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { newUnknownCallReview } from '../../src/core/work-graph/state/unknown-call-review.js';
import {
  UNKNOWN_CALL_REVIEW_OPTION_LABELS, unknownCallReviewCardFacts,
} from '../../src/core/work-graph/tasks/unknown-call-review-card.js';

const PROJECT = 'P';
const WORKSPACE = 'W';
const GOAL_REF = { aggregateType: 'Goal' as const, projectId: PROJECT, goalId: 'g1' };
const RUN_REF: RunRef = { aggregateType: 'Run', projectId: PROJECT, goalId: 'g1', runId: 'run-12345678' };
const AT = '2026-10-20T00:00:00.000Z';

const GOAL: GoalSnapshot = {
  ref: GOAL_REF, workspaceRef: { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE },
  objective: 'K3-18 card', desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null,
  activePlanRevision: { aggregateType: 'PlanRevision', projectId: PROJECT, planId: 'plan-1' }, revision: 4,
  settings: { schemaVersion: 1, autonomy: 'every_step', order: 0, waitForGoalRef: null, parallelRisks: [] },
};
const RUN = { ref: RUN_REF, revision: 3 } as unknown as RunSnapshot;

function processItem(callId = 'call-1'): UnknownCallReviewItemV1 {
  return {
    alias: 1, callId, toolName: 'shell', kind: 'process', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't', callId,
      declaredPosition: 1, startedPosition: 1 },
    argumentsDigest: 'd'.repeat(64),
    summary: { command: 'echo hi', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}
function platformItem(callId = 'call-2', alias = 2): UnknownCallReviewItemV1 {
  return {
    alias, callId, toolName: 'send_user_message', kind: 'platform', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't', callId,
      declaredPosition: 2, startedPosition: 2 },
    argumentsDigest: 'e'.repeat(64),
    summary: { command: null, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null,
    observed: { verdict: 'undetermined', by: 'platform', evidence: { kind: 'lookup_failed', reason: 'k3-18' } },
  };
}

function fileEditItem(paths: string[], alias = 1, callId = `call-edit-${String(alias)}`): UnknownCallReviewItemV1 {
  return {
    alias, callId, toolName: 'edit', kind: 'file_edit', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't', callId,
      declaredPosition: 1, startedPosition: alias },
    argumentsDigest: 'f'.repeat(64),
    summary: { command: null, cwd: null, mode: 'replace', paths, pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'compare_in_continuation', by: 'platform' },
  };
}

function record(input: { items: UnknownCallReviewItemV1[]; inventory?: 'complete' | 'incomplete';
  rounds?: UnknownCallReviewV1['rounds'];
  sample?: { path: string; change: 'added' | 'modified' | 'deleted' | 'mode_changed' }[] }): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: { aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: 'g1', runId: RUN_REF.runId },
    workspaceId: WORKSPACE, task: { projectId: PROJECT, goalId: 'g1', taskId: 't1' }, runRef: RUN_REF,
    sessionRef: { projectId: PROJECT, sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: 'k3-18' },
    inventory: input.inventory ?? 'incomplete', inventoryProblem: 'kernel_unreadable',
    items: input.items, itemsOmitted: 0,
    workspace: { status: 'captured', runBaselineKnown: true, baseCommit: 'base', headNow: 'head',
      captureRef: { kind: 'artifact', contentType: 'application/vnd.platform.workspace-change-capture+json',
        digest: 'digest', sizeBytes: 12, source: { kind: 'workspace', refId: 'src', revision: '1' } },
      changedCount: 2,
      sample: input.sample ?? [{ path: 'src/a.ts', change: 'modified' }, { path: 'src/b.ts', change: 'added' }],
      notVisible: [], notVisibleOmitted: 0 },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    rounds: input.rounds ?? [], createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

const round = (index: number): UnknownCallReviewV1['rounds'][number] => ({
  runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'g1', runId: `round-${String(index)}` },
  phase: 'review', round: index, stateEntry: 1, result: 'finished',
});

// sha256 of `a\n` and `b\n`: the exact values the workspace owner returns.
const DIGEST_A = '87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7';
const DIGEST_B = '0263829989b6fd954f72baaf2fc64bc2e2f01d692d4de72986ea808f6e99813f';

describe('K3-18 (四) review card shape (pure)', () => {
  it('K3-18: a mixed needs_decision card offers the four options in order with the exact labels and the mixed line', () => {
    const facts = unknownCallReviewCardFacts({ record: record({ items: [processItem(), platformItem()] }),
      goal: GOAL, run: RUN, taskActive: true, fileDigests: new Map() });
    expect(facts.options).toEqual([
      { id: 'rerun_as_is', label: '照原样重跑', effect: 'apply' },
      { id: 'safer_method', label: '换个稳妥的跑法再跑', effect: 'apply' },
      { id: 'skip_as_done', label: '跳过，当作已做', effect: 'apply' },
      { id: 'handle_myself', label: '我来处理', effect: 'apply' },
    ]);
    expect(Object.values(UNKNOWN_CALL_REVIEW_OPTION_LABELS)).toEqual(['照原样重跑', '换个稳妥的跑法再跑', '跳过，当作已做', '我来处理']);
    expect(facts.summary).toContain('选“换个稳妥的跑法再跑”并同意方案以后，查不清的平台条目在接续说明里写“结果查不清，重做前先核实”。');
    expect(facts.closedReason).toBeNull();
    expect(facts.taskActive).toBe(true);
    expect(facts.source.kind).toBe('unknown_call_review');
    expect(facts.source.pins).toHaveLength(3);
    // Only the record object: a process/platform item has no target path, and
    // the workspace change sample must never become a file object (L18).
    expect(facts.objects.map(object => object.kind)).toEqual(['aggregate']);
  });

  it('K3-18: the card carries one file object per unknown edit target path', () => {
    const built = record({
      items: [fileEditItem(['src/x.ts'])],
      sample: [{ path: 'src/other.ts', change: 'modified' }],
    });
    const facts = unknownCallReviewCardFacts({ record: built, goal: GOAL, run: RUN, taskActive: true,
      fileDigests: new Map([['src/x.ts', DIGEST_A], ['src/other.ts', DIGEST_B]]) });
    expect(facts.objects).toEqual([
      { kind: 'aggregate', pin: { ref: built.ref, revision: built.revision },
        label: '核对记录 run-1234：需要你决定' },
      { kind: 'file', workspace: { projectId: PROJECT, workspaceId: WORKSPACE },
        path: 'src/x.ts', digest: '87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7',
        label: 'src/x.ts' },
    ]);
    expect(facts.objects.some(object => object.kind === 'file' && object.path === 'src/other.ts')).toBe(false);
  });

  it('K3-18: the card carries at most 31 file objects, the first 31 target paths in item order', () => {
    const paths = Array.from({ length: 40 }, (_unused, index) => `src/f${String(index)}.ts`);
    const items = [0, 1, 2, 3, 4].map(index =>
      fileEditItem(paths.slice(index * 8, index * 8 + 8), index + 1));
    const fileDigests = new Map(paths.map((path, index) => [path, index === 5 ? null : DIGEST_A]));
    const facts = unknownCallReviewCardFacts({ record: record({ items }), goal: GOAL, run: RUN,
      taskActive: true, fileDigests });
    const files = facts.objects.filter(object => object.kind === 'file');
    expect(facts.objects).toHaveLength(32);
    expect(files).toHaveLength(31);
    expect(files.map(object => object.path)).toEqual(paths.slice(0, 31));
    // Per-path digests come from the injected map; an unreadable path is null.
    expect(files.map(object => object.digest)).toEqual(paths.slice(0, 31).map(
      (_unused, index) => (index === 5
        ? null
        : '87428fc522803d31065e7bce3cf03fe475096631e5e07bbd7a0fde60c4cf25c7')));
    expect(files.some(object => object.path === paths[31])).toBe(false);
  });

  it('K3-45(四): with no proposable command the card has three options and no mixed line', () => {
    const facts = unknownCallReviewCardFacts({ record: record({ items: [platformItem('call-2', 1)], inventory: 'complete',
      rounds: [] }), goal: GOAL, run: RUN, taskActive: true, fileDigests: new Map() });
    expect(facts.options.map(option => option.id)).toEqual(['rerun_as_is', 'skip_as_done', 'handle_myself']);
    expect(facts.summary).not.toContain('选“换个稳妥的跑法再跑”并同意方案以后，查不清的平台条目在接续说明里写“结果查不清，重做前先核实”。');
  });

  it('K3-45(四): with fewer than two free round slots the card has three options', () => {
    const rounds = Array.from({ length: 7 }, (_unused, index) => round(index + 1));
    const facts = unknownCallReviewCardFacts({ record: record({ items: [processItem(), platformItem()], rounds }),
      goal: GOAL, run: RUN, taskActive: true, fileDigests: new Map() });
    expect(facts.options.map(option => option.id)).toEqual(['rerun_as_is', 'skip_as_done', 'handle_myself']);
  });

  it('K3-18: a cancelled Goal or an inactive Task closes the card as read-only history', () => {
    const cancelled = unknownCallReviewCardFacts({ record: record({ items: [processItem()] }),
      goal: { ...GOAL, desiredState: 'cancelled' }, run: RUN, taskActive: true, fileDigests: new Map() });
    expect(cancelled.closedReason).toBe('goal_cancelled');
    const inactive = unknownCallReviewCardFacts({ record: record({ items: [processItem()] }),
      goal: GOAL, run: RUN, taskActive: false, fileDigests: new Map() });
    expect(inactive.closedReason).toBe('source_resolved');
  });
});
