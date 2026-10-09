/**
 * Workspace notice-settings state machine
 * (docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md §3.1,
 * rows S5-NT-01/02).
 *
 * The owner service (`configuration/decision-settings-service.ts`) verifies the
 * display-page token, reads the current Workspace, compares each update with
 * `NoticePositionComparatorPort` and passes the movement already decided. This
 * machine never touches a key or a clock: `movement='forward'` is the only one
 * that changes a category; with no forward update `next` equals the input and
 * `effects=[]` (NS03/NS04).
 */
import {
  DEFAULT_WORKSPACE_DECISION_SETTINGS_V1,
  type NoticeCategoryV1,
  type NoticePositionV1,
  type WorkspaceDecisionSettingsV1,
} from '../../../contracts/goal-decisions.js';
import type { WorkspaceSnapshot } from '../../../contracts/ledger.js';
import { accept, reject, type Rejected, type Transition } from './transition.js';

// --------------------------------------------------------------------------
// Machine events, guard context, effects (spec §3.1)
// --------------------------------------------------------------------------

/** One category's displayed position and the service-computed movement. */
export type NoticeSeenUpdateV1 = { category: NoticeCategoryV1; position: NoticePositionV1;
  movement: 'forward' | 'same' | 'backward' };

export type NoticeSettingsEventV1 = { type: 'notices_seen'; updates: NoticeSeenUpdateV1[] };

/** `tokenValid`/`tokenCoversUpdates` are the service's verified token verdict; state holds no key. */
export type NoticeSettingsGuardV1 = { operator: boolean; tokenValid: boolean; tokenCoversUpdates: boolean;
  pinMatches: boolean };

export type NoticeSettingsEffectV1 = { type: 'workspace_notice_seen_changed' };

const SEEN_CHANGED: readonly NoticeSettingsEffectV1[] = [{ type: 'workspace_notice_seen_changed' }];

// --------------------------------------------------------------------------
// Transition and constructor (spec §3.1)
// --------------------------------------------------------------------------

/** S5-NT-01/02: refuse `operator=false → forbidden`, bad token `→ invalid`, stale pin `→ revision_conflict`. */
export function transitionNoticeSettings(state: WorkspaceSnapshot, event: NoticeSettingsEventV1,
  facts: NoticeSettingsGuardV1): Transition<WorkspaceSnapshot, NoticeSettingsEventV1, NoticeSettingsEffectV1> {
  const shared = sharedProblem(facts);
  if (shared !== null) return shared;
  const base = state.decisionSettings ?? DEFAULT_WORKSPACE_DECISION_SETTINGS_V1;
  // Only a forward movement may write; a same/backward update is a no-op
  // (§3.1 rows S5-NT-01/02, NS03/NS04), and the service already filtered the
  // categories/positions the display token really returned.
  const noticeSeen: Partial<Record<NoticeCategoryV1, NoticePositionV1>> = { ...base.noticeSeen };
  let moved = false;
  for (const update of event.updates) {
    if (update.movement !== 'forward') continue;
    noticeSeen[update.category] = update.position;
    moved = true;
  }
  if (!moved) return accept<WorkspaceSnapshot, NoticeSettingsEffectV1>(state, []);
  return accept<WorkspaceSnapshot, NoticeSettingsEffectV1>(
    buildWorkspaceDecisionSettingsRecord(state, { schemaVersion: 1, noticeSeen }), SEEN_CHANGED);
}

/** §3.1 refusal order: forbidden, invalid, then the stale pin. */
function sharedProblem(facts: NoticeSettingsGuardV1): Rejected | null {
  if (!facts.operator) return reject('guard_failed', 'forbidden', 'only the configured operator may mark notices seen');
  if (!facts.tokenValid || !facts.tokenCoversUpdates) {
    return reject('guard_failed', 'invalid', 'the notice display token does not cover this request');
  }
  if (!facts.pinMatches) return reject('stale', 'revision_conflict', 'the Workspace revision changed since it was read');
  return null;
}

/** Writes only `decisionSettings` and `revision + 1` (spec §3.1). */
export function buildWorkspaceDecisionSettingsRecord(workspace: WorkspaceSnapshot,
  settings: WorkspaceDecisionSettingsV1): WorkspaceSnapshot {
  return { ...workspace, revision: workspace.revision + 1, decisionSettings: settings };
}
