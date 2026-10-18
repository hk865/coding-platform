/**
 * Slice 1 §3.5: the pure anomaly-anchor constructor, transition, pickup
 * derivation and the Task archive-state label/next derivation. The anchor is
 * immutable; a Run gets at most one.
 */
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { GoalDesiredState } from '../../../contracts/ledger.js';
import type { SessionAnomalyAnchorV1, SessionAnomalyViewV1, SessionAnomalyAnchorRef } from '../../../contracts/session-anomaly.js';
import type { TaskPhaseCauseV1 } from '../../../contracts/task-failure.js';
import type { TaskReworkRefusalCode } from '../../../contracts/task-requeue.js';
import { sameRef } from './ref-equality.js';
import { accept, reject, type Transition } from './transition.js';

export type NewSessionAnomalyInputV1 = Omit<SessionAnomalyAnchorV1, 'revision' | 'schemaVersion'>;
export type AnomalyEventV1 = { kind: 'record'; input: NewSessionAnomalyInputV1 };
export type AnomalyGuardV1 = {
  execution: 'work' | 'query'; stopped: boolean; taskTerminal: boolean;
  sameScope: boolean; requestMatches: boolean;
};
export type AnomalyEffectV1 =
  | { kind: 'write_anchor'; anchor: SessionAnomalyAnchorV1 }
  | { kind: 'emit_event'; eventType: 'SessionAnomalyRecorded' };
export function newSessionAnomalyAnchorRecord(input: NewSessionAnomalyInputV1): SessionAnomalyAnchorV1 {
  return { ...input, revision: 1, schemaVersion: 1 };
}
export function transitionSessionAnomaly(
  state: 'absent' | SessionAnomalyAnchorV1, event: AnomalyEventV1, ctx: AnomalyGuardV1,
): Transition<'absent' | SessionAnomalyAnchorV1, AnomalyEventV1, AnomalyEffectV1> {
  if (state !== 'absent') {
    // At most one anchor per Run: the recorded anchor is returned unchanged and nothing is written.
    return accept<'absent' | SessionAnomalyAnchorV1, AnomalyEffectV1>(state);
  }
  if (ctx.execution === 'query') {
    return reject('illegal', 'invalid', 'an anomaly anchor records an interrupted Work execution, not a QueryRun');
  }
  if (!ctx.stopped) {
    return reject('guard_failed', 'busy', 'the Work execution has not stopped; its outcome must be settled before an anchor');
  }
  if (ctx.taskTerminal) {
    return reject('illegal', 'invalid', 'the Task is already terminal; there is no interrupted execution to record');
  }
  if (!ctx.sameScope) {
    return reject('guard_failed', 'forbidden', 'archive_scope: the anomaly anchor is outside the archive scope');
  }
  if (!ctx.requestMatches) {
    return reject('guard_failed', 'invalid', 'archive_input_invalid: the archive request does not match this Run and attempt');
  }
  const anchor = newSessionAnomalyAnchorRecord(event.input);
  return accept<'absent' | SessionAnomalyAnchorV1, AnomalyEffectV1>(anchor, [
    { kind: 'write_anchor', anchor },
    { kind: 'emit_event', eventType: 'SessionAnomalyRecorded' },
  ]);
}
export function deriveSessionAnomalyView(
  anchor: SessionAnomalyAnchorV1,
  entered: readonly { runRef: RunRef; sessionRef: SessionRef; enteredAt: string;
    anchorRefs: readonly SessionAnomalyAnchorRef[] }[],
): SessionAnomalyViewV1 {
  let pickedUpBy: RunRef | null = null;
  let bestAt: string | null = null;
  for (const entry of entered) {
    // The anchor's own line is not a successor; only a later, different Session can pick it up.
    if (sameRef(entry.sessionRef, anchor.sessionRef)) continue;
    if (!entry.anchorRefs.some((ref) => sameRef(ref, anchor.ref))) continue;
    if (bestAt === null || entry.enteredAt < bestAt
      || (entry.enteredAt === bestAt && pickedUpBy !== null && entry.runRef.runId < pickedUpBy.runId)) {
      pickedUpBy = entry.runRef;
      bestAt = entry.enteredAt;
    }
  }
  return { anchor, pickedUpBy };
}
export type TaskArchiveNextV1 = { kind: 'dispatch' } | { kind: 'human_continue' }
  | { kind: 'goal_stopped'; desiredState: 'paused' | 'cancelled' } | { kind: 'rework_blocked'; code: TaskReworkRefusalCode };
export function deriveTaskArchiveState(input: {
  views: readonly SessionAnomalyViewV1[];
  goalDesiredState: GoalDesiredState; phaseCause: TaskPhaseCauseV1 | null;
  reworkRefusal: TaskReworkRefusalCode | null; claimable: boolean;
}): { pending: SessionAnomalyViewV1[]; label: '中断，待核对' | null; next: TaskArchiveNextV1 | null } {
  const pending = input.views.filter((view) => view.pickedUpBy === null);
  if (pending.length === 0) return { pending: [], label: null, next: null };
  const next: TaskArchiveNextV1 | null = input.goalDesiredState !== 'active'
    ? { kind: 'goal_stopped', desiredState: input.goalDesiredState }
    : input.phaseCause?.code === 'paused_interrupted'
      ? { kind: 'human_continue' }
      : input.reworkRefusal !== null
        ? { kind: 'rework_blocked', code: input.reworkRefusal }
        : input.claimable ? { kind: 'dispatch' } : null;
  return { pending, label: '中断，待核对', next };
}
