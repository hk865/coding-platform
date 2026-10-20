/**
 * Workspace line-pin state machine (slice 2C L9, row S2C-PIN-01).
 *
 * ONE atomic pin change per request: the event carries `add` and `remove`, the
 * new table is `(current − remove) ∪ add`, and the machine never reads storage,
 * mints an id or reads a clock. The owner service
 * (`configuration/line-settings-service.ts`) verifies the operator, reads the
 * current Workspace, checks every newly added Session through the injected
 * directory read and passes the verdict; with an unchanged table the machine
 * returns the input with `effects=[]`, so the service commits the event without
 * writing a record (`configuration/decision-settings-service.ts`'s no-op path).
 *
 * Refusal order (spec §2): `forbidden` (not the operator) → `invalid`
 * (duplicates, add/remove overlap, a new Session outside the workspace or a
 * read-only copy) → `capacity` (the final set exceeds 100) → `revision_conflict`
 * (the Workspace version did not match).
 */
import type { SessionRef } from '../../../contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { WorkspaceLineSettingsV1, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import { accept, reject, type Transition } from './transition.js';

// --------------------------------------------------------------------------
// Machine event, guard context, effects (spec §2)
// --------------------------------------------------------------------------

export type LinePinEventV1 = {
  type: 'line_pins_changed';
  add: SessionRef[];
  remove: SessionRef[];
  /** The request clock instant new pins carry; existing pins keep theirs. */
  at: string;
};

export type LinePinGuardV1 = {
  operator: boolean;
  pinMatches: boolean;
  /** `add` and `remove` each repeat no Session. */
  noDuplicates: boolean;
  /** No Session appears in both `add` and `remove`. */
  noOverlap: boolean;
  /** Every Session newly added to the table exists in this workspace. */
  addedInWorkspace: boolean;
  /** No newly added Session is a read-only copy (a copy is not a line). */
  addedNotCopies: boolean;
  /** The final set holds at most 100 entries. */
  finalUnderCap: boolean;
};

export type LinePinEffectV1 = { type: 'workspace_line_pins_changed' };

const PIN_EFFECTS: readonly LinePinEffectV1[] = [{ type: 'workspace_line_pins_changed' }];

/** The read-side default: an absent table is the empty pin table. */
const EMPTY_LINE_SETTINGS: WorkspaceLineSettingsV1 = { schemaVersion: 1, pinned: [] };

function keyOf(ref: SessionRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

function currentSettings(state: WorkspaceSnapshot): WorkspaceLineSettingsV1 {
  return state.lineSettings ?? EMPTY_LINE_SETTINGS;
}

/** The final table equals the current one, item for item (including `pinnedAt`). */
function samePins(left: WorkspaceLineSettingsV1['pinned'], right: WorkspaceLineSettingsV1['pinned']): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return other !== undefined && keyOf(item.sessionRef) === keyOf(other.sessionRef)
      && item.pinnedAt === other.pinnedAt;
  });
}

// --------------------------------------------------------------------------
// Transition and record constructor
// --------------------------------------------------------------------------

/**
 * S2C-PIN-01: refuse `operator=false → forbidden`, a duplicate/overlap/foreign
 * or copy addition `→ invalid`, a final set over 100 `→ capacity`, then a stale
 * pin `→ revision_conflict`. Existing pins keep their position and `pinnedAt`;
 * new pins take `event.at` and the `add` order.
 */
export function transitionLinePins(state: WorkspaceSnapshot, event: LinePinEventV1,
  facts: LinePinGuardV1): Transition<WorkspaceSnapshot, LinePinEventV1, LinePinEffectV1> {
  if (!facts.operator) return reject('guard_failed', 'forbidden', 'only the configured operator may pin work lines');
  if (!facts.noDuplicates) return reject('guard_failed', 'invalid', 'add and remove must not repeat a Session');
  if (!facts.noOverlap) return reject('guard_failed', 'invalid', 'a Session cannot be added and removed in one request');
  if (!facts.addedInWorkspace) {
    return reject('guard_failed', 'invalid', 'every newly added Session must exist in this workspace');
  }
  if (!facts.addedNotCopies) return reject('guard_failed', 'invalid', 'a read-only copy is not a work line');
  if (!facts.finalUnderCap) return reject('guard_failed', 'capacity', 'the pinned set cannot exceed 100 Sessions');
  if (!facts.pinMatches) return reject('stale', 'revision_conflict', 'the Workspace revision changed since it was read');

  const current = currentSettings(state);
  const removeKeys = new Set(event.remove.map(keyOf));
  const kept = current.pinned.filter(item => !removeKeys.has(keyOf(item.sessionRef)));
  const present = new Set(kept.map(item => keyOf(item.sessionRef)));
  const added: WorkspaceLineSettingsV1['pinned'] = [];
  for (const ref of event.add) {
    const key = keyOf(ref);
    if (present.has(key)) continue;
    present.add(key);
    added.push({ sessionRef: { ...ref }, pinnedAt: event.at });
  }
  const pinned = [...kept, ...added];
  if (samePins(current.pinned, pinned)) return accept<WorkspaceSnapshot, LinePinEffectV1>(state, []);
  return accept<WorkspaceSnapshot, LinePinEffectV1>(
    buildWorkspaceLineSettingsRecord(state, { schemaVersion: 1, pinned }), PIN_EFFECTS);
}

/** Writes only `lineSettings` and `revision + 1` (spec §2, L9). */
export function buildWorkspaceLineSettingsRecord(workspace: WorkspaceSnapshot,
  settings: WorkspaceLineSettingsV1): WorkspaceSnapshot {
  return { ...workspace, revision: workspace.revision + 1, lineSettings: settings };
}
