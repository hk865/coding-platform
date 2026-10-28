/**
 * The release-candidate page input and the release block reason (A5): built input and hand-computed
 * expectations, no store, platform, Host, Workflow or Runtime.
 */
import { describe, expect, it } from 'vitest';
import { encodeKeysetCursor } from '../../src/contracts/keyset-cursor.js';
import type { DispatchBasisV1, GoalRef } from '../../src/contracts/ledger.js';
import {
  releaseCandidateBlockedReason, releaseCandidatePageInput,
} from '../../src/core/work-graph/communication/message-release.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';

const GOAL: GoalRef = { aggregateType: 'Goal', projectId: 'p-1', goalId: 'g-1' };
const OTHER_GOAL: GoalRef = { aggregateType: 'Goal', projectId: 'p-1', goalId: 'g-2' };
const AFTER = { order: '2026-10-27T10:00:00.000Z', refKey: 'message-7' };

/** The port's rejection: an exact `CoreRejection`, never a match-object. */
type PageInputCase = [
  string,
  { goalRef: GoalRef | null; after: string | null; limit: number },
  { ok: true; after: typeof AFTER | null } | { ok: false; rejection: { status: 'rejected'; code: 'invalid'; reason: string } },
];

describe('S7A2 release-candidate page input', () => {
  it.each<PageInputCase>([
    ['limit 0 is invalid', { goalRef: null, after: null, limit: 0 },
      { ok: false, rejection: { status: 'rejected', code: 'invalid',
        reason: 'the release-candidate page limit must be between 1 and 100' } }],
    ['limit 101 is invalid', { goalRef: null, after: null, limit: 101 },
      { ok: false, rejection: { status: 'rejected', code: 'invalid',
        reason: 'the release-candidate page limit must be between 1 and 100' } }],
    ['limit 1 is accepted', { goalRef: null, after: null, limit: 1 }, { ok: true, after: null }],
    ['limit 100 is accepted', { goalRef: null, after: null, limit: 100 }, { ok: true, after: null }],
    ['a cursor of another Goal is invalid on a Goal page',
      { goalRef: GOAL, after: encodeKeysetCursor(OTHER_GOAL.goalId, AFTER), limit: 2 },
      { ok: false, rejection: { status: 'rejected', code: 'invalid',
        reason: 'the release-candidate cursor does not belong to this page' } }],
    ['the workspace page cursor is invalid on a Goal page',
      { goalRef: GOAL, after: encodeKeysetCursor(null, AFTER), limit: 2 },
      { ok: false, rejection: { status: 'rejected', code: 'invalid',
        reason: 'the release-candidate cursor does not belong to this page' } }],
  ])('S7A2 %s', (_case, input, expected) => {
    expect(releaseCandidatePageInput(input)).toEqual(expected);
  });
});

const PINS: DispatchBasisV1 = { planRevision: 7, pointerRevision: 3, dispatchSequence: 5 };

type BlockedCase = [
  string,
  Pick<SessionMessage, 'intent' | 'pins'>,
  { desiredState: 'active' | 'paused'; currentValues: DispatchBasisV1 | null },
  'goal_not_active' | 'stale_pins' | null,
];

describe('S7A2 release-candidate block reason', () => {
  it.each<BlockedCase>([
    ['an inactive Goal blocks an action_request', { intent: 'action_request', pins: PINS },
      { desiredState: 'paused', currentValues: PINS }, 'goal_not_active'],
    ['an inactive Goal blocks an inquiry', { intent: 'inquiry', pins: null },
      { desiredState: 'paused', currentValues: null }, 'goal_not_active'],
    ['an active Goal with equal pins releases an action_request', { intent: 'action_request', pins: PINS },
      { desiredState: 'active', currentValues: PINS }, null],
    ['an active Goal with different pins blocks an action_request',
      { intent: 'action_request', pins: { ...PINS, dispatchSequence: 4 } },
      { desiredState: 'active', currentValues: PINS }, 'stale_pins'],
    ['an active Goal never blocks an inquiry', { intent: 'inquiry', pins: null },
      { desiredState: 'active', currentValues: PINS }, null],
  ])('S7A2 %s', (_case, message, goal, expected) => {
    expect(releaseCandidateBlockedReason(message, goal)).toEqual(expected);
  });
});
