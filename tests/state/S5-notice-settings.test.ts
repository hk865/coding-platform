/**
 * Slice 5 unit rows NS01..NS08
 * (docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md §5.2).
 *
 * `transitionNoticeSettings` / `buildWorkspaceDecisionSettingsRecord` and the
 * empty `noticeSeen` default. Pure: the service verifies the display-page token
 * and hands in the already-computed movement. The part-1 functions are stubs,
 * so every case currently fails with the stub's `not implemented`.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_DECISION_SETTINGS_V1,
  type NoticePositionV1,
  type WorkspaceDecisionSettingsV1,
} from '../../src/contracts/goal-decisions.js';
import { makeCommitCursor, type WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { isAutomationActor, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import {
  decodeWorkspaceSnapshot, effectiveWorkspaceDecisionSettings, encodeWorkspaceSnapshot,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import {
  transitionNoticeSettings,
  type NoticeSettingsEffectV1,
  type NoticeSettingsGuardV1,
} from '../../src/core/work-graph/state/notice-settings-machine.js';

// -------------------------------------------------------------------------- //
// §5.1 fixed fixture                                                        //
// -------------------------------------------------------------------------- //

const PROJECT = 'P';
const WORKSPACE = 'W';
const WORKSPACE_REF = { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE } as const;

const position = (sequence: number): NoticePositionV1 => ({
  kind: 'commit',
  cursor: makeCommitCursor(sequence),
  itemKey: `item-${sequence}`,
});
const POS9 = position(9);
const POS10 = position(10);

function workspace(revision: number, decisionSettings?: WorkspaceDecisionSettingsV1): WorkspaceSnapshot {
  return decisionSettings === undefined
    ? { ref: WORKSPACE_REF, revision }
    : { ref: WORKSPACE_REF, revision, decisionSettings };
}

function noticeFacts(overrides: Partial<NoticeSettingsGuardV1> = {}): NoticeSettingsGuardV1 {
  return { operator: true, tokenValid: true, tokenCoversUpdates: true, pinMatches: true, ...overrides };
}

const SEEN_CHANGED: readonly NoticeSettingsEffectV1[] = [{ type: 'workspace_notice_seen_changed' }];

/** An untouched §5.1 Workspace: default revision 3 with the real empty default settings. */
const WORKSPACE_3 = workspace(3, DEFAULT_WORKSPACE_DECISION_SETTINGS_V1);

/** The NS02 transition establishes the given of the same/backward rows. */
function seenMember10(): WorkspaceSnapshot {
  const result = transitionNoticeSettings(workspace(3, { schemaVersion: 1, noticeSeen: {} }),
    { type: 'notices_seen', updates: [{ category: 'member_notice', position: POS10, movement: 'forward' }] },
    noticeFacts());
  expect(result).toEqual({ ok: true,
    next: workspace(4, { schemaVersion: 1, noticeSeen: { member_notice: POS10 } }), effects: SEEN_CHANGED });
  if (!result.ok) throw new Error('the first seen position must be established');
  return result.next;
}

// -------------------------------------------------------------------------- //
// NS01..NS08                                                                 //
// -------------------------------------------------------------------------- //

describe('S5 notice settings unit rows (§5.2 NS01..NS08)', () => {
  it('NS01 an old Workspace without decisionSettings reads the empty noticeSeen default', () => {
    const old = workspace(3);
    const encoded = encodeWorkspaceSnapshot(old);
    const originalJson = encoded.json;
    const decoded = decodeWorkspaceSnapshot(encoded);
    expect(decoded).toEqual({ status: 'decoded', value: old });
    if (decoded.status !== 'decoded') throw new Error('legacy Workspace must decode');
    expect(effectiveWorkspaceDecisionSettings(decoded.value)).toEqual({ schemaVersion: 1, noticeSeen: {} });
    expect(decoded.value).toEqual(old);
    expect(decoded.value).not.toHaveProperty('decisionSettings');
    expect(encodeWorkspaceSnapshot(decoded.value).json).toBe(originalJson);
  });

  it('NS02 forwarding member_notice to pos10 bumps the Workspace to @4 and records only that category', () => {
    const state = WORKSPACE_3;
    const before = structuredClone(state);
    const result = transitionNoticeSettings(
      state,
      { type: 'notices_seen', updates: [{ category: 'member_notice', position: POS10, movement: 'forward' }] },
      noticeFacts(),
    );
    expect(result).toEqual({
      ok: true,
      next: { ...before, revision: 4, decisionSettings: { schemaVersion: 1, noticeSeen: { member_notice: POS10 } } },
      effects: SEEN_CHANGED,
    });
    expect(state).toEqual(before);
  });

  it('NS03 the same position again is a no-op with no effects', () => {
    const state = seenMember10();
    const before = structuredClone(state);
    const result = transitionNoticeSettings(
      state,
      { type: 'notices_seen', updates: [{ category: 'member_notice', position: POS10, movement: 'same' }] },
      noticeFacts(),
    );
    expect(result).toEqual({ ok: true, next: before, effects: [] });
    expect(state).toEqual(before);
  });

  it('NS04 a backward position keeps the original pos10 and has no effects', () => {
    const state = seenMember10();
    const before = structuredClone(state);
    const result = transitionNoticeSettings(
      state,
      { type: 'notices_seen', updates: [{ category: 'member_notice', position: POS9, movement: 'backward' }] },
      noticeFacts(),
    );
    expect(result).toEqual({ ok: true, next: before, effects: [] });
    expect(state).toEqual(before);
  });

  it('NS05 an automation actor may not mark notices seen (forbidden)', () => {
    expect(isAutomationActor(WORKFLOW_AUTOMATION_ACTOR)).toBe(true);
    const result = transitionNoticeSettings(
      WORKSPACE_3,
      { type: 'notices_seen', updates: [{ category: 'member_notice', position: POS10, movement: 'forward' }] },
      noticeFacts({ operator: !isAutomationActor(WORKFLOW_AUTOMATION_ACTOR) }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'guard_failed', code: 'forbidden' });
    expect(result).not.toHaveProperty('next');
    expect(result).not.toHaveProperty('effects');
  });

  it('NS06 a token for another Workspace is invalid', () => {
    const result = transitionNoticeSettings(
      WORKSPACE_3,
      { type: 'notices_seen', updates: [{ category: 'member_notice', position: POS10, movement: 'forward' }] },
      noticeFacts({ tokenValid: false }),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect(result).not.toHaveProperty('next');
    expect(result).not.toHaveProperty('effects');
  });

  it('NS07 a token covering only member_notice cannot report automatic_rework (invalid, zero effects)', () => {
    const result = transitionNoticeSettings(
      WORKSPACE_3,
      { type: 'notices_seen', updates: [{ category: 'automatic_rework', position: position(20), movement: 'forward' }] },
      noticeFacts({ tokenCoversUpdates: false }),
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid' });
    expect(result).not.toHaveProperty('next');
    expect('effects' in result).toBe(false);
  });

  it('NS08 a forward movement against a stale Workspace pin is a revision_conflict', () => {
    // §5.2 NS08: the source pin is 2 while the current Workspace is the §5.1 revision 3.
    const result = transitionNoticeSettings(
      WORKSPACE_3,
      { type: 'notices_seen', updates: [{ category: 'member_notice', position: position(11), movement: 'forward' }] },
      noticeFacts({ pinMatches: false }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'stale', code: 'revision_conflict' });
    expect(result).not.toHaveProperty('next');
    expect(result).not.toHaveProperty('effects');
  });
});
