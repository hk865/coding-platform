/**
 * S4C2-1 (spec §11.5, row M-12, ruling U-9): the pure `foldUpdateDue` fold in
 * `notes/note-update-due.ts`. The expected values are literal and hand-computed
 * from the rules; there is no clock and no record store here. The plan snapshot
 * is a tiny hand-built literal: goal `g1`, stages `s1`/`s2`, tasks `t1` (s1),
 * `t2` (s2) and `t3` (no top-level `stageId`; its stage comes from
 * `scope.stageId` = s2).
 */
import { describe, expect, it } from 'vitest';
import type { NoteHeadSnapshot, NoteState } from '../../src/contracts/note.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { NoteUpdateDueTriggerV1 } from '../../src/core/work-graph/model/note-contracts.js';
import {
  foldInputOf, foldUpdateDue, type NoteUpdateDueAnchorInputV1,
} from '../../src/core/work-graph/notes/note-update-due.js';

const BEFORE = '2026-09-30T00:00:00.000Z';
const AT = '2026-10-01T00:00:00.000Z';
const AFTER = '2026-10-02T00:00:00.000Z';
const LATER = '2026-10-03T00:00:00.000Z';

const PLAN: PlanRevisionSnapshot = {
  schemaVersion: 2,
  ref: { aggregateType: 'PlanRevision', projectId: 's4c2', planId: 'plan-1' },
  revision: 1,
  goalRef: { aggregateType: 'Goal', projectId: 's4c2', goalId: 'g1' },
  planId: 'plan-1',
  planRevision: 1,
  acceptedAt: AT,
  effectiveCompletionPolicy: {
    ref: { aggregateType: 'CompletionPolicyRevision', projectId: 's4c2', policyId: 'policy', revision: 1 },
    digest: 'a'.repeat(64),
  },
  effectiveArchitectureBaseline: {
    ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 's4c2', baselineId: 'baseline', revision: 1 },
    digest: 'b'.repeat(64),
  },
  stages: [{ stageId: 's1', title: 'Stage 1' }, { stageId: 's2', title: 'Stage 2' }],
  tasks: [
    { taskId: 't1', stageId: 's1', title: 't1', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 's1' } },
    { taskId: 't2', stageId: 's2', title: 't2', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 's2' } },
    { taskId: 't3', title: 't3', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 's2' } },
  ],
  obligations: [],
  taskHierarchy: { parentOf: [] },
  executionDag: { dependsOn: [] },
};

function trigger(key: string, at: string, kind: NoteUpdateDueTriggerV1['kind'],
  taskId: string | null = null): NoteUpdateDueTriggerV1 {
  return { key, at, kind, taskId };
}

const GOAL: NoteUpdateDueAnchorInputV1 = { anchorKey: 'goal:g1', baseline: AT };
const STAGE_S1: NoteUpdateDueAnchorInputV1 = { anchorKey: 'stage:s1', baseline: AT, stageId: 's1' };
const STAGE_S2: NoteUpdateDueAnchorInputV1 = { anchorKey: 'stage:s2', baseline: AT, stageId: 's2' };

/** A minimal hand-built head; only the fields `foldInputOf` reads are meaningful. */
function headOf(state: NoteState, createdAt: string): NoteHeadSnapshot {
  return {
    ref: { aggregateType: 'NoteHead', projectId: 's4c2', noteId: 'n-u' },
    noteId: 'n-u', version: 1, state, goalId: 'g1', source: { kind: 'user', principalId: 'op' }, stagedRunKey: null,
    reviewReasons: [], confirmedByUser: true,
    anchorKey0: 'goal:g1', anchorKey1: null, anchorKey2: null, anchorKey3: null, anchorKey4: null,
    createdAt, since: 'c1' as never, kind: 'understanding', topic: 'understanding', topicKey: 'understanding',
    conclusion: 'c', body: '', anchor: { kind: 'goal', goalId: 'g1' }, extraAnchors: [], facts: [],
    basis: { planRevision: null, catalogRevision: null, files: [] },
    structural: false, replaces: [], contradicts: [], coexistWith: [],
  };
}

describe('S4C2-1 foldUpdateDue (spec §11.5, M-12, U-9)', () => {
  it('S4C2-1a: a task_end strictly after the baseline makes the goal anchor due', () => {
    const rows = foldUpdateDue({
      triggers: [trigger('task_end:t1#r2', AFTER, 'task_end', 't1')],
      plan: PLAN,
      anchors: [GOAL],
    });
    expect(rows).toEqual([{ anchorKey: 'goal:g1', updateDue: true, latestTriggerCursor: 'task_end:t1#r2' }]);
  });

  it('S4C2-1b: a trigger at exactly the baseline does not make it due', () => {
    const rows = foldUpdateDue({
      triggers: [trigger('task_end:t1#r2', AT, 'task_end', 't1')],
      plan: PLAN,
      anchors: [GOAL],
    });
    expect(rows).toEqual([{ anchorKey: 'goal:g1', updateDue: false, latestTriggerCursor: null }]);
  });

  it('S4C2-1c: a trigger before the baseline does not make it due', () => {
    const rows = foldUpdateDue({
      triggers: [trigger('task_end:t1#r2', BEFORE, 'task_end', 't1')],
      plan: PLAN,
      anchors: [GOAL],
    });
    expect(rows).toEqual([{ anchorKey: 'goal:g1', updateDue: false, latestTriggerCursor: null }]);
  });

  it('S4C2-1d: a plan trigger qualifies the goal anchor, is ignored for a stage anchor and when includePlanTrigger is false', () => {
    const rows = foldUpdateDue({
      triggers: [trigger('plan:p2', AFTER, 'plan')],
      plan: PLAN,
      anchors: [GOAL, { anchorKey: 'goal:g1', baseline: AT, includePlanTrigger: false }, STAGE_S1],
    });
    expect(rows).toEqual([
      { anchorKey: 'goal:g1', updateDue: true, latestTriggerCursor: 'plan:p2' },
      { anchorKey: 'goal:g1', updateDue: false, latestTriggerCursor: null },
      { anchorKey: 'stage:s1', updateDue: false, latestTriggerCursor: null },
    ]);
  });

  it('S4C2-1e: a task_end maps to its stage via plan.tasks[].stageId (or scope.stageId), not another stage', () => {
    const rows = foldUpdateDue({
      triggers: [
        trigger('task_end:t1#r2', AFTER, 'task_end', 't1'),
        trigger('task_end:t3#r1', LATER, 'task_end', 't3'),
      ],
      plan: PLAN,
      anchors: [GOAL, STAGE_S1, STAGE_S2],
    });
    expect(rows).toEqual([
      { anchorKey: 'goal:g1', updateDue: true, latestTriggerCursor: 'task_end:t3#r1' },
      { anchorKey: 'stage:s1', updateDue: true, latestTriggerCursor: 'task_end:t1#r2' },
      { anchorKey: 'stage:s2', updateDue: true, latestTriggerCursor: 'task_end:t3#r1' },
    ]);
  });

  it('S4C2-1f: a task that is not in the plan maps to no stage (but still reaches the goal anchor)', () => {
    const rows = foldUpdateDue({
      triggers: [trigger('task_end:tx#r1', AFTER, 'task_end', 'tx')],
      plan: PLAN,
      anchors: [STAGE_S1, GOAL],
    });
    expect(rows).toEqual([
      { anchorKey: 'stage:s1', updateDue: false, latestTriggerCursor: null },
      { anchorKey: 'goal:g1', updateDue: true, latestTriggerCursor: 'task_end:tx#r1' },
    ]);
  });

  it('S4C2-1g: latestTriggerCursor is the newest at; a tie breaks to the smallest key', () => {
    const rows = foldUpdateDue({
      triggers: [
        trigger('task_end:old#r1', BEFORE, 'task_end', 't1'),
        trigger('rework:t1/run-2', AFTER, 'rework', 't1'),
        trigger('archive:t1/run-2', AFTER, 'archive', 't1'),
      ],
      plan: PLAN,
      anchors: [GOAL],
    });
    expect(rows).toEqual([{ anchorKey: 'goal:g1', updateDue: true, latestTriggerCursor: 'archive:t1/run-2' }]);
  });

  it('S4C2-1h: no current understanding (baseline null) still sees an earlier task_end, but includePlanTrigger:false ignores plan', () => {
    const anchors: NoteUpdateDueAnchorInputV1[] = [{ anchorKey: 'goal:g1', baseline: null, includePlanTrigger: false }];
    expect(foldUpdateDue({ triggers: [trigger('plan:p2', AFTER, 'plan')], plan: PLAN, anchors }))
      .toEqual([{ anchorKey: 'goal:g1', updateDue: false, latestTriggerCursor: null }]);
    expect(foldUpdateDue({
      triggers: [trigger('task_end:t1#r1', BEFORE, 'task_end', 't1'), trigger('plan:p2', AFTER, 'plan')],
      plan: PLAN, anchors,
    })).toEqual([{ anchorKey: 'goal:g1', updateDue: true, latestTriggerCursor: 'task_end:t1#r1' }]);
  });

  it('S4C2-1i: plan === null makes every anchor false/null even with triggers', () => {
    const rows = foldUpdateDue({
      triggers: [trigger('task_end:t1#r1', AFTER, 'task_end', 't1'), trigger('plan:p2', LATER, 'plan')],
      plan: null,
      anchors: [{ anchorKey: 'goal:g1', baseline: null }, STAGE_S1],
    });
    expect(rows).toEqual([
      { anchorKey: 'goal:g1', updateDue: false, latestTriggerCursor: null },
      { anchorKey: 'stage:s1', updateDue: false, latestTriggerCursor: null },
    ]);
  });

  it('S4C2-1j (rework item 5): equal-`at` ties break in UTF-8 byte order, not UTF-16 code-unit order', () => {
    // 'Ａ' is U+FF21 (UTF-8 EF BC A1); '😀' is U+1F600 (UTF-8 F0 9F 98 80).
    // UTF-16 code units would put the emoji's high surrogate (0xD83D) before
    // U+FF21; byte order puts 'Ａ' first, so it is the latest qualifying key.
    const rows = foldUpdateDue({
      triggers: [
        trigger('task_end:Ａ#r1', AFTER, 'task_end', 't1'),
        trigger('task_end:😀#r1', AFTER, 'task_end', 't1'),
      ],
      plan: PLAN,
      anchors: [GOAL],
    });
    expect(rows).toEqual([{ anchorKey: 'goal:g1', updateDue: true, latestTriggerCursor: 'task_end:Ａ#r1' }]);
  });

  it('S4C2-1k: foldInputOf goal anchor: accepted/reviewed is current, withdrawn is not', () => {
    const accepted = headOf('accepted', AT);
    expect(foldInputOf('goal:g1', accepted, PLAN)).toEqual(
      { anchorKey: 'goal:g1', baseline: AT, includePlanTrigger: true });
    const reviewed = headOf('reviewed', AT);
    expect(foldInputOf('goal:g1', reviewed, PLAN)).toEqual(
      { anchorKey: 'goal:g1', baseline: AT, includePlanTrigger: true });
    expect(foldInputOf('goal:g1', headOf('withdrawn', AT), PLAN)).toEqual(
      { anchorKey: 'goal:g1', baseline: null, includePlanTrigger: false });
  });

  it('S4C2-1l: foldInputOf stage anchor: no current head falls back to plan.acceptedAt', () => {
    expect(foldInputOf('stage:g1/1/s1', null, PLAN, 's1')).toEqual(
      { anchorKey: 'stage:g1/1/s1', baseline: AT, stageId: 's1' });
    expect(foldInputOf('stage:g1/1/s1', headOf('withdrawn', AFTER), PLAN, 's1')).toEqual(
      { anchorKey: 'stage:g1/1/s1', baseline: AT, stageId: 's1' });
    expect(foldInputOf('stage:g1/1/s1', headOf('accepted', AFTER), PLAN, 's1')).toEqual(
      { anchorKey: 'stage:g1/1/s1', baseline: AFTER, stageId: 's1' });
    expect(foldInputOf('stage:g1/1/s1', null, null, 's1')).toEqual(
      { anchorKey: 'stage:g1/1/s1', baseline: null, stageId: 's1' });
  });
});
