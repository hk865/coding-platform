/**
 * Goal birth with its settings and the copy fields (6B §3.9 item 3, §3.12 items 4 and 6): GOAL-01 writes Goal@1
 * with the settings, `continuedFrom` and `copiedInterventions` it is given and the pending creation cursor; the
 * GoalCreated event carries the three fields, so the original Goal rebuilds from the event alone; every later Goal
 * writer and the record codec keep them; a record or event without `settings`, or with a malformed copy field, is
 * refused (no old-format default). Pure A5: values built here, expected values written out by hand.
 */
import { describe, expect, it } from 'vitest';
import type { CreateGoalCommand } from '../../src/contracts/command-event.js';
import type { GoalSnapshot, PendingGoalSnapshot } from '../../src/contracts/ledger.js';
import { compileGoalCreate } from '../../src/core/work-graph/persistence/commit-compiler.js';
import {
  decodeGoalCreatedEvent, decodeGoalSnapshot, encodeGoalSnapshot, goalSnapshotFromCreatedEvent,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import { goalStateOf, nextGoalDesiredState, nextGoalPointer, transitionGoal } from '../../src/core/work-graph/state/goal-machine.js';
import { buildGoalSettingsRecord } from '../../src/core/work-graph/state/goal-settings-machine.js';

const P = 'p-birth';
const OBJECTIVE = 'copy the cancelled goal';
const GOAL = { aggregateType: 'Goal' as const, projectId: P, goalId: 'g-copy' };
const WS = { aggregateType: 'Workspace' as const, projectId: P, workspaceId: 'w-birth' };
const PLAN = { aggregateType: 'PlanRevision' as const, projectId: P, planId: 'plan-1' };
const settings = () => ({ schemaVersion: 1 as const, autonomy: 'every_step' as const, order: 3, waitForGoalRef: null,
  parallelRisks: [] });
const continuedFrom = () => ({ goal: { aggregateType: 'Goal' as const, projectId: P, goalId: 'g-cancelled' },
  sourceRevision: 4, understanding: { noteId: 'note-understanding', version: 2 } });
const message = () => ({ aggregateType: 'SessionMessage' as const, projectId: P, workspaceId: 'w-birth', messageId: 'm-1' });
/** Goal@1 as written out by hand: the ledger's key order, revision 1, the three birth fields, the pending cursor. */
const BORN: PendingGoalSnapshot = {
  ref: GOAL, workspaceRef: WS, objective: OBJECTIVE, desiredState: 'active', desiredStateRevision: 1,
  desiredStateRequestedBy: null, activePlanRevision: null, revision: 1, settings: settings(), continuedFrom: continuedFrom(),
  copiedInterventions: [message()], since: null,
};
const STORED: GoalSnapshot = { ...BORN, since: 'c0000000005' as GoalSnapshot['since'] };
const COMMAND: CreateGoalCommand = {
  commandId: 'cmd-birth', commandType: 'CreateGoal', schemaVersion: 1,
  identity: { projectId: P, actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'idem-birth' },
  aggregateId: 'g-copy', expectedRevision: 0, correlationId: 'corr-birth', submittedAt: '2026-10-25T08:00:00.000Z',
  payload: { workspaceId: 'w-birth', objective: OBJECTIVE },
};

describe('Goal birth with its settings and copy fields', () => {
  it('GOAL-01 writes Goal@1 with the settings, continuedFrom and copiedInterventions it is given', () => {
    const created = transitionGoal(goalStateOf(null, null), {
      type: 'goal_created', ref: GOAL, workspaceRef: WS, objective: OBJECTIVE,
      settings: settings(), continuedFrom: continuedFrom(), copiedInterventions: [message()],
    }, { callerClass: 'human', scopePinsAgree: true, goalInWorkspace: true, completion: null });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(JSON.stringify(created.next.goal)).toBe(JSON.stringify(BORN));
  });

  it('the GoalCreated event carries the three fields and rebuilds the same pending Goal', () => {
    const prepared = compileGoalCreate({ command: COMMAND, goal: BORN, guards: [], eventId: 'e-birth',
      occurredAt: '2026-10-25T08:00:01.000Z' });
    const decoded = decodeGoalCreatedEvent(prepared.events[0]!);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value.payload).toEqual({ objective: OBJECTIVE, desiredState: 'active', activePlanRevision: null,
      settings: settings(), continuedFrom: continuedFrom(), copiedInterventions: [message()] });
    expect(goalSnapshotFromCreatedEvent(decoded.value)).toEqual(BORN);
  });

  it.each([
    ['the record codec', (goal: GoalSnapshot) => {
      const decoded = decodeGoalSnapshot(encodeGoalSnapshot(goal));
      return decoded.status === 'decoded' ? decoded.value : decoded;
    }, settings()],
    ['the plan pointer (GOAL-02)', (goal: GoalSnapshot) => nextGoalPointer(goal, PLAN), settings()],
    ['a desired-state change (GOAL-05)', (goal: GoalSnapshot) =>
      nextGoalDesiredState(goal, { to: 'paused', requestedBy: { kind: 'human', id: 'operator' } }), settings()],
    ['a settings change (S5-GS-01)', (goal: GoalSnapshot) => buildGoalSettingsRecord(goal, { ...settings(), order: 7 }),
      { ...settings(), order: 7 }],
  ])('%s keeps the copy fields and writes the settings', (_writer, write, expectedSettings) => {
    expect(write(STORED)).toMatchObject({ settings: expectedSettings, continuedFrom: continuedFrom(),
      copiedInterventions: [message()] });
  });
});

describe('rejects: a Goal without settings or with a malformed copy field', () => {
  const storedGoalWith = (change: (body: Record<string, unknown>) => void) => {
    const encoded = encodeGoalSnapshot(STORED);
    const body = JSON.parse(encoded.json) as Record<string, unknown>;
    change(body);
    return decodeGoalSnapshot({ ...encoded, json: JSON.stringify(body) });
  };
  const createdEventWith = (change: (payload: Record<string, unknown>) => void) => {
    const encoded = compileGoalCreate({ command: COMMAND, goal: BORN, guards: [], eventId: 'e-birth',
      occurredAt: '2026-10-25T08:00:01.000Z' }).events[0]!;
    const body = JSON.parse(encoded.json) as { payload: Record<string, unknown> };
    change(body.payload);
    return decodeGoalCreatedEvent({ ...encoded, json: JSON.stringify(body) });
  };
  const cf = (body: Record<string, unknown>) => body['continuedFrom'] as Record<string, unknown>;
  it.each([
    ['a record without settings', () => storedGoalWith((body) => { delete body['settings']; }),
      'Goal snapshot settings is missing'],
    ['a record without continuedFrom', () => storedGoalWith((body) => { delete body['continuedFrom']; }),
      'GoalSnapshot.continuedFrom is missing'],
    ['a record without copiedInterventions', () => storedGoalWith((body) => { delete body['copiedInterventions']; }),
      'GoalSnapshot.copiedInterventions is missing'],
    ['a source that is not a Goal ref', () => storedGoalWith((body) => { (cf(body)['goal'] as Record<string, unknown>)['aggregateType'] = 'Workspace'; }),
      'GoalSnapshot.continuedFrom.goal.aggregateType is not recognized'],
    ['a source revision 0', () => storedGoalWith((body) => { cf(body)['sourceRevision'] = 0; }),
      'GoalSnapshot.continuedFrom.sourceRevision is invalid'],
    ['an empty understanding note id', () => storedGoalWith((body) => { (cf(body)['understanding'] as Record<string, unknown>)['noteId'] = ''; }),
      'GoalSnapshot.continuedFrom.understanding.noteId is invalid'],
    ['an understanding version 0', () => storedGoalWith((body) => { (cf(body)['understanding'] as Record<string, unknown>)['version'] = 0; }),
      'GoalSnapshot.continuedFrom.understanding.version is invalid'],
    ['an extra continuedFrom key', () => storedGoalWith((body) => { cf(body)['reason'] = 'copied'; }),
      'GoalSnapshot.continuedFrom.reason is not allowed'],
    ['copiedInterventions that is not a list', () => storedGoalWith((body) => { body['copiedInterventions'] = null; }),
      'GoalSnapshot.copiedInterventions is invalid'],
    ['a copied intervention without its tag', () => storedGoalWith((body) => {
      delete (body['copiedInterventions'] as Record<string, unknown>[])[0]!['aggregateType'];
    }), 'GoalSnapshot.copiedInterventions[0].aggregateType is missing'],
    ['a GoalCreated payload without settings', () => createdEventWith((payload) => { delete payload['settings']; }),
      'GoalCreated payload.settings is missing'],
    ['a GoalCreated payload with a source revision 0', () => createdEventWith((payload) => { cf(payload)['sourceRevision'] = 0; }),
      'GoalCreated payload: GoalSnapshot.continuedFrom.sourceRevision is invalid'],
  ])('%s', (_case, decode, reason) => {
    expect(decode()).toEqual({ status: 'invalid', reason });
  });
});
