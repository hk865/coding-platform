/**
 * 7D1 A5 pure tables: the link-target set, the pin schema and the six R1 format round trips. No Host, store,
 * `CoreCallContext` or codec call: each row is an input literal and the refusal text or the stored value the frozen
 * rule names. Appended per segment; this file has 04a, 04b and 04c.
 */

import type { GoalRef } from '../../src/contracts/ledger.js';
import type { ResponsibilityBasisV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { sessionRecord } from './S2C-line-facts-samples.js';

export type RefCase = { name: string; value: unknown; problem: string | null };
export type FormatRoundTripCase = { name: string; value: unknown; format: 'SessionRoleFacts' | 'RoleLineAllocation'
  | 'ProjectRoleLimits' | 'ProjectNotice' | 'ProjectRoleLimitsChanged' | 'ProjectNoticeCreated' };

const GOAL_REF = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' };
const TASK_REF = { projectId: 'p1', goalId: 'g1', taskId: 't1' };
const MODULE_REF = { projectId: 'p1', moduleId: 'm1' };
const WORK_REF = { aggregateType: 'WorkContextBinding', projectId: 'p1', workspaceId: 'w1', workId: 'k1' };
const NOTICE_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const AT = '2026-11-01T00:00:00.000Z';

export const TARGET_SET_CASES: readonly RefCase[] = [
  { name: 'a task target is lawful', problem: null,
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'task', ref: TASK_REF } } },
  { name: 'a module target is lawful', problem: null,
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'module', ref: MODULE_REF } } },
  { name: 'a work target is lawful', problem: null,
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'participates', target: { kind: 'work', ref: WORK_REF } } },
  { name: 'a goal target is lawful', problem: null,
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'goal', ref: GOAL_REF } } },
  { name: 'a project target is lawful', problem: null,
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'investigated', target: { kind: 'project', ref: { projectId: 'p1' } } } },
  { name: 'a goal target in another project is refused', problem: 'work link target project disagrees with the link ref project',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'goal', ref: { aggregateType: 'Goal', projectId: 'p2', goalId: 'g1' } } } },
  { name: 'a goal target with no goalId is refused', problem: 'goal target is not a valid GoalRef',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'goal', ref: { aggregateType: 'Goal', projectId: 'p1' } } } },
  { name: 'a goal target with a bad aggregateType is refused', problem: 'goal target is not a valid GoalRef',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'goal', ref: { aggregateType: 'Milestone', projectId: 'p1', goalId: 'g1' } } } },
  { name: 'a goal target with an extra ref key is refused', problem: 'goal target must be a GoalRef',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'goal', ref: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1', extra: true } } } },
  { name: 'a project target with an extra key is refused', problem: 'project target must be a ProjectScope',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'project', ref: { projectId: 'p1' }, note: 'x' } } },
  { name: 'a project target with an empty projectId is refused', problem: 'project target requires projectId',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'project', ref: { projectId: '' } } } },
  { name: 'a goal target with an empty goalId is refused', problem: 'goal target is not a valid GoalRef',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'goal', ref: { aggregateType: 'Goal', projectId: 'p1', goalId: '' } } } },
  { name: 'a task target with an empty taskId is refused', problem: 'task target requires projectId, goalId and taskId',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'task', ref: { projectId: 'p1', goalId: 'g1', taskId: '' } } } },
  { name: 'a module target with no moduleId is refused', problem: 'module target requires projectId and moduleId',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'module', ref: { projectId: 'p1' } } } },
  { name: 'an unknown target kind is refused by the final kind refusal', problem: 'work link target kind must be module, task, work, goal or project',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'session', ref: { projectId: 'p1' } } } },
  { name: 'a work target with a bad aggregateType is refused', problem: 'work target is not a valid WorkContextRef',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'participates', target: { kind: 'work', ref: { aggregateType: 'WorkContext', projectId: 'p1', workspaceId: 'w1', workId: 'k1' } } } },
  { name: 'a task target carrying a workId instead of a taskId is refused', problem: 'task target must be a TaskTriple',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'task', ref: { projectId: 'p1', goalId: 'g1', workId: 'k1' } } } },
  { name: 'an empty sessionId is refused', problem: 'work link ref is not a valid SessionWorkLinkRef',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: '', relation: 'responsible', target: { kind: 'project', ref: { projectId: 'p1' } } } },
  { name: 'an unrecognized relation is refused', problem: 'work link relation is not recognized',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'owns', target: { kind: 'project', ref: { projectId: 'p1' } } } },
  { name: 'an extra key on the link ref is refused', problem: 'work link ref carries unknown fields',
    value: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target: { kind: 'project', ref: { projectId: 'p1' } }, note: 'x' } },
];

/**
 * The same twelve inputs as the target table: the five lawful targets, the three
 * specified refusals (foreign project, missing `goalId`, bad `aggregateType`) and
 * the four target-shape refusals (extra goal ref key, extra project key, empty
 * projectId, empty goalId). The pin must refuse every one exactly as the link
 * checker does, so no second target field table can survive.
 */
export const PIN_SCHEMA_CASES: readonly RefCase[] = TARGET_SET_CASES.slice(0, 12);

export const FORMAT_ROUND_TRIPS: readonly FormatRoundTripCase[] = [
  { name: 'SessionRoleFacts round trip', format: 'SessionRoleFacts',
    value: { ref: { aggregateType: 'SessionRoleFacts', projectId: 'p1', sessionId: 's1' }, revision: 1, sessionRef: { projectId: 'p1', sessionId: 's1' }, name: 'Adviser line', creator: { kind: 'human', actor: { kind: 'human', id: 'person-1' } }, openedBy: 'human', originOperation: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' } } },
  { name: 'SessionRoleFacts stored null sessionRef is invalid', format: 'SessionRoleFacts',
    value: { ref: { aggregateType: 'SessionRoleFacts', projectId: 'p1', sessionId: 's1' }, revision: 1, sessionRef: null, name: 'Adviser line', creator: { kind: 'human', actor: { kind: 'human', id: 'person-1' } }, openedBy: 'human', originOperation: null } },
  { name: 'SessionRoleFacts missing creator is invalid', format: 'SessionRoleFacts',
    value: { ref: { aggregateType: 'SessionRoleFacts', projectId: 'p1', sessionId: 's1' }, revision: 1, sessionRef: { projectId: 'p1', sessionId: 's1' }, name: 'Adviser line', openedBy: 'human', originOperation: null } },
  { name: 'RoleLineAllocation round trip', format: 'RoleLineAllocation',
    value: { ref: { aggregateType: 'RoleLineAllocation', projectId: 'p1', duty: 'adviser' }, revision: 1, projectRef: { projectId: 'p1' }, duty: 'adviser', holders: [{ sessionRef: { projectId: 'p1', sessionId: 's1' }, since: 'c0000000001' }], reservations: [{ operationRef: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' }, reservedAt: 'c0000000002' }] } },
  { name: 'RoleLineAllocation stored null holders[].since is invalid', format: 'RoleLineAllocation',
    value: { ref: { aggregateType: 'RoleLineAllocation', projectId: 'p1', duty: 'adviser' }, revision: 1, projectRef: { projectId: 'p1' }, duty: 'adviser', holders: [{ sessionRef: { projectId: 'p1', sessionId: 's1' }, since: null }], reservations: [] } },
  { name: 'RoleLineAllocation missing holders[].since is invalid', format: 'RoleLineAllocation',
    value: { ref: { aggregateType: 'RoleLineAllocation', projectId: 'p1', duty: 'adviser' }, revision: 1, projectRef: { projectId: 'p1' }, duty: 'adviser', holders: [{ sessionRef: { projectId: 'p1', sessionId: 's1' } }], reservations: [] } },
  { name: 'ProjectRoleLimits round trip', format: 'ProjectRoleLimits',
    value: { ref: { aggregateType: 'ProjectRoleLimits', projectId: 'p1' }, revision: 1, projectRef: { projectId: 'p1' }, running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 }, open: { secretary: 8, adviser: 8, scribe: 4, executor: 16 } } },
  { name: 'ProjectRoleLimits stored null projectRef is invalid', format: 'ProjectRoleLimits',
    value: { ref: { aggregateType: 'ProjectRoleLimits', projectId: 'p1' }, revision: 1, projectRef: null, running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 }, open: { secretary: 8, adviser: 8, scribe: 4, executor: 16 } } },
  { name: 'ProjectRoleLimits missing open is invalid', format: 'ProjectRoleLimits',
    value: { ref: { aggregateType: 'ProjectRoleLimits', projectId: 'p1' }, revision: 1, projectRef: { projectId: 'p1' }, running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 } } },
  { name: 'ProjectNotice round trip', format: 'ProjectNotice',
    value: { ref: { aggregateType: 'ProjectNotice', projectId: 'p1', noticeId: NOTICE_ID }, subject: { kind: 'project', projectRef: { projectId: 'p1' } }, kind: 'module_maintainer_assigned', summary: 'Module m1 is now maintained by line s1', operation: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' }, since: 'c0000000003', revision: 1 } },
  { name: 'ProjectNotice stored null since is invalid', format: 'ProjectNotice',
    value: { ref: { aggregateType: 'ProjectNotice', projectId: 'p1', noticeId: NOTICE_ID }, subject: { kind: 'project', projectRef: { projectId: 'p1' } }, kind: 'module_maintainer_assigned', summary: 'Module m1 is now maintained by line s1', operation: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' }, since: null, revision: 1 } },
  { name: 'ProjectNotice missing since is invalid', format: 'ProjectNotice',
    value: { ref: { aggregateType: 'ProjectNotice', projectId: 'p1', noticeId: NOTICE_ID }, subject: { kind: 'project', projectRef: { projectId: 'p1' } }, kind: 'module_maintainer_assigned', summary: 'Module m1 is now maintained by line s1', operation: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' }, revision: 1 } },
  { name: 'ProjectRoleLimitsChanged round trip', format: 'ProjectRoleLimitsChanged',
    value: { eventId: 'event-1', eventType: 'ProjectRoleLimitsChanged', schemaVersion: 1, occurredAt: AT, projectId: 'p1', workspaceId: 'w1', from: { running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 }, open: { secretary: 8, adviser: 8, scribe: 4, executor: 16 } }, to: { running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 }, open: { secretary: 12, adviser: 8, scribe: 4, executor: 16 } }, actor: { kind: 'human', id: 'person-1' }, revision: 2 } },
  { name: 'ProjectRoleLimitsChanged stored null revision is invalid', format: 'ProjectRoleLimitsChanged',
    value: { eventId: 'event-1', eventType: 'ProjectRoleLimitsChanged', schemaVersion: 1, occurredAt: AT, projectId: 'p1', workspaceId: 'w1', from: { running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 }, open: { secretary: 8, adviser: 8, scribe: 4, executor: 16 } }, to: { running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 }, open: { secretary: 12, adviser: 8, scribe: 4, executor: 16 } }, actor: { kind: 'human', id: 'person-1' }, revision: null } },
  { name: 'ProjectRoleLimitsChanged missing actor is invalid', format: 'ProjectRoleLimitsChanged',
    value: { eventId: 'event-1', eventType: 'ProjectRoleLimitsChanged', schemaVersion: 1, occurredAt: AT, projectId: 'p1', workspaceId: 'w1', from: { running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 }, open: { secretary: 8, adviser: 8, scribe: 4, executor: 16 } }, to: { running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 }, open: { secretary: 12, adviser: 8, scribe: 4, executor: 16 } }, revision: 2 } },
  { name: 'ProjectNoticeCreated round trip', format: 'ProjectNoticeCreated',
    value: { eventId: 'event-2', eventType: 'ProjectNoticeCreated', schemaVersion: 1, occurredAt: AT, projectId: 'p1', workspaceId: 'w1', notice: { ref: { aggregateType: 'ProjectNotice', projectId: 'p1', noticeId: NOTICE_ID }, subject: { kind: 'project', projectRef: { projectId: 'p1' } }, kind: 'module_maintainer_assigned', summary: 'Module m1 is now maintained by line s1', operation: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' } } } },
  { name: 'ProjectNoticeCreated stored null projectId is invalid', format: 'ProjectNoticeCreated',
    value: { eventId: 'event-2', eventType: 'ProjectNoticeCreated', schemaVersion: 1, occurredAt: AT, projectId: null, workspaceId: 'w1', notice: { ref: { aggregateType: 'ProjectNotice', projectId: 'p1', noticeId: NOTICE_ID }, subject: { kind: 'project', projectRef: { projectId: 'p1' } }, kind: 'module_maintainer_assigned', summary: 'Module m1 is now maintained by line s1', operation: { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' } } } },
  { name: 'ProjectNoticeCreated missing notice is invalid', format: 'ProjectNoticeCreated',
    value: { eventId: 'event-2', eventType: 'ProjectNoticeCreated', schemaVersion: 1, occurredAt: AT, projectId: 'p1', workspaceId: 'w1' } },
];

// ------------------------------------------------------------------------ //
// 04b (G1-2): the four pure tables                                          //
// ------------------------------------------------------------------------ //

export type RegionCase = { name: string; catalog: unknown; regions: readonly unknown[]; expected: readonly string[] };
export type ClaimCase = { name: string; close: readonly unknown[]; open: readonly unknown[]; expected: readonly unknown[] };
export type AllocationCase = { name: string; current: unknown; change: unknown; expected: unknown };
export type ReanchorCase = { name: string; input: unknown; expected: 'plan' | 'refusals';
  plan?: { sessions: readonly unknown[]; links: readonly unknown[]; claimChanges: readonly unknown[];
    bindings: readonly unknown[]; events: readonly unknown[] };
  refusals?: readonly unknown[] };

const moduleOf = (projectId: string, moduleId: string) => ({
  ref: { projectId, moduleId }, name: moduleId, responsibility: moduleId, paths: [] as string[], interfaces: [],
});
const catalogOf = (moduleIds: readonly string[], edges: readonly (readonly [string, string])[] = []) => ({
  modules: moduleIds.map((moduleId) => moduleOf('p1', moduleId)),
  dependencies: [] as unknown[],
  requireDag: true,
  containment: { parentOf: edges.map(([parent, child]) => ({
    parent: { projectId: 'p1', moduleId: parent }, child: { projectId: 'p1', moduleId: child },
  })) },
});
const regionOf = (sessionId: string, duty: string, moduleId: string) => ({
  session: { projectId: 'p1', sessionId }, duty, moduleRef: { projectId: 'p1', moduleId },
});

export const REGION_CASES: readonly RegionCase[] = [
  { name: 'a lone region owns its whole subtree', catalog: catalogOf(['a', 'a/x', 'a/x/y'], [['a', 'a/x'], ['a/x', 'a/x/y']]),
    regions: [regionOf('s1', 'adviser', 'a')], expected: ['a', 'a/x', 'a/x/y'] },
  { name: 'a deeper same-duty region is subtracted from its parent', catalog: catalogOf(['a', 'a/x', 'a/x/y'], [['a', 'a/x'], ['a/x', 'a/x/y']]),
    regions: [regionOf('s1', 'adviser', 'a'), regionOf('s2', 'adviser', 'a/x')], expected: ['a'] },
  { name: 'a deeper region of another duty is not subtracted', catalog: catalogOf(['a', 'a/x', 'a/x/y'], [['a', 'a/x'], ['a/x', 'a/x/y']]),
    regions: [regionOf('s1', 'adviser', 'a'), regionOf('s2', 'executor', 'a/x')], expected: ['a', 'a/x', 'a/x/y'] },
  { name: 'no catalog leaves the module itself', catalog: null,
    regions: [regionOf('s1', 'adviser', 'a')], expected: ['a'] },
  { name: 'an explicit empty parentOf leaves the module itself', catalog: catalogOf(['a', 'a/x']),
    regions: [regionOf('s1', 'adviser', 'a')], expected: ['a'] },
  { name: 'the output is sorted by moduleId', catalog: catalogOf(['z', 'm', 'a'], [['m', 'a'], ['m', 'z']]),
    regions: [regionOf('s1', 'adviser', 'm')], expected: ['a', 'm', 'z'] },
  { name: 'two sibling regions are not subtracted from each other', catalog: catalogOf(['a', 'a/x', 'a/y'], [['a', 'a/x'], ['a', 'a/y']]),
    regions: [regionOf('s1', 'adviser', 'a'), regionOf('s2', 'adviser', 'a/x')], expected: ['a', 'a/y'] },
  { name: 'a deeper region claimed in another project is not subtracted', catalog: catalogOf(['a', 'a/x', 'a/x/y'], [['a', 'a/x'], ['a/x', 'a/x/y']]),
    regions: [regionOf('s1', 'adviser', 'a'), { session: { projectId: 'p1', sessionId: 's2' }, duty: 'adviser',
      moduleRef: { projectId: 'p2', moduleId: 'a/x' } }], expected: ['a', 'a/x', 'a/x/y'] },
];

const claimLink = (sessionId: string, target: unknown) => ({
  aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId, relation: 'responsible', target,
});
const CLAIM_GOAL_A = claimLink('s1', { kind: 'goal', ref: GOAL_REF });
const CLAIM_GOAL_B = claimLink('s2', { kind: 'goal', ref: GOAL_REF });
const CLAIM_REGION_SCRIBE = claimLink('s3', { kind: 'module', ref: MODULE_REF });
const CLAIM_PROJECT_SECRETARY = claimLink('s4', { kind: 'project', ref: { projectId: 'p1' } });
const CLAIM_MODULE_EXECUTOR = claimLink('s5', { kind: 'module', ref: MODULE_REF });
const CLAIM_TASK_A = claimLink('s6', { kind: 'task', ref: TASK_REF });
const GOAL_TARGET = { kind: 'goal', goalRef: GOAL_REF };
const REGION_TARGET = { kind: 'region', moduleRef: MODULE_REF };

export const CLAIM_CASES: readonly ClaimCase[] = [
  { name: 'an adviser goal link takes one claim', close: [], expected: [
    { duty: 'adviser', target: GOAL_TARGET, expectedOwner: null, nextOwner: CLAIM_GOAL_A }],
    open: [{ link: CLAIM_GOAL_A, duty: 'adviser' }] },
  { name: 'a scribe region link takes one claim', close: [], expected: [
    { duty: 'scribe', target: REGION_TARGET, expectedOwner: null, nextOwner: CLAIM_REGION_SCRIBE }],
    open: [{ link: CLAIM_REGION_SCRIBE, duty: 'scribe' }] },
  { name: 'a secretary project link takes none', close: [], expected: [],
    open: [{ link: CLAIM_PROJECT_SECRETARY, duty: 'secretary' }] },
  { name: 'an executor module link takes the maintainer claim', close: [], expected: [
    { duty: 'executor', target: REGION_TARGET, expectedOwner: null, nextOwner: CLAIM_MODULE_EXECUTOR }],
    open: [{ link: CLAIM_MODULE_EXECUTOR, duty: 'executor' }] },
  { name: 'a task link takes none', close: [], expected: [],
    open: [{ link: CLAIM_TASK_A, duty: 'adviser' }] },
  { name: 'one close and open of one scope folds into one old-to-new change', expected: [
    { duty: 'adviser', target: GOAL_TARGET, expectedOwner: CLAIM_GOAL_A, nextOwner: CLAIM_GOAL_B }],
    close: [{ link: CLAIM_GOAL_A, duty: 'adviser' }], open: [{ link: CLAIM_GOAL_B, duty: 'adviser' }] },
  { name: 'equal owners make no change', close: [{ link: CLAIM_GOAL_A, duty: 'adviser' }], expected: [],
    open: [{ link: CLAIM_GOAL_A, duty: 'adviser' }] },
  { name: 'a close alone releases the owner', close: [{ link: CLAIM_GOAL_A, duty: 'adviser' }], expected: [
    { duty: 'adviser', target: GOAL_TARGET, expectedOwner: CLAIM_GOAL_A, nextOwner: null }], open: [] },
];

const ALLOC_S1 = { projectId: 'p1', sessionId: 's1' };
const ALLOC_S2 = { projectId: 'p1', sessionId: 's2' };
const ALLOC_S9 = { projectId: 'p1', sessionId: 's9' };
const ALLOC_OP1 = { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' };
const allocationOf = (revision: number, holders: readonly unknown[], reservations: readonly unknown[]) => ({
  ref: { aggregateType: 'RoleLineAllocation', projectId: 'p1', duty: 'adviser' }, revision,
  projectRef: { projectId: 'p1' }, duty: 'adviser', holders, reservations,
});
const holder = (sessionRef: unknown, since: string | null) => ({ sessionRef, since });
const reservation = (operationRef: unknown, reservedAt: string | null) => ({ operationRef, reservedAt });

export const ALLOCATION_CASES: readonly AllocationCase[] = [
  { name: 'reserve from a null current starts revision 1 with a null cursor', current: null,
    change: { kind: 'reserve', operationRef: ALLOC_OP1 },
    expected: allocationOf(1, [], [reservation(ALLOC_OP1, null)]) },
  { name: 'convert removes the reservation and adds the holder with a null cursor',
    current: allocationOf(2, [], [reservation(ALLOC_OP1, 'c2')]),
    change: { kind: 'convert', operationRef: ALLOC_OP1, sessionRef: ALLOC_S1 },
    expected: allocationOf(3, [holder(ALLOC_S1, null)], []) },
  { name: 'add_holder appends one holder with a null cursor',
    current: allocationOf(2, [holder(ALLOC_S1, 'c1')], []),
    change: { kind: 'add_holder', sessionRef: ALLOC_S2 },
    expected: allocationOf(3, [holder(ALLOC_S1, 'c1'), holder(ALLOC_S2, null)], []) },
  { name: 'cancel_reservation removes the reservation only',
    current: allocationOf(2, [holder(ALLOC_S1, 'c1')], [reservation(ALLOC_OP1, 'c2')]),
    change: { kind: 'cancel_reservation', operationRef: ALLOC_OP1 },
    expected: allocationOf(3, [holder(ALLOC_S1, 'c1')], []) },
  { name: 'release_holder removes only the named holder',
    current: allocationOf(2, [holder(ALLOC_S1, 'c1'), holder(ALLOC_S2, 'c2')], []),
    change: { kind: 'release_holder', sessionRef: ALLOC_S1 },
    expected: allocationOf(3, [holder(ALLOC_S2, 'c2')], []) },
  { name: 'move_holder keeps the moved holder since',
    current: allocationOf(2, [holder(ALLOC_S1, 'c1')], []),
    change: { kind: 'move_holder', from: ALLOC_S1, to: ALLOC_S9 },
    expected: allocationOf(3, [holder(ALLOC_S9, 'c1')], []) },
  { name: 'convert keeps an existing holder stored since',
    current: allocationOf(4, [holder(ALLOC_S1, 'c1')], [reservation(ALLOC_OP1, 'c2')]),
    change: { kind: 'convert', operationRef: ALLOC_OP1, sessionRef: ALLOC_S1 },
    expected: allocationOf(5, [holder(ALLOC_S1, 'c1')], []) },
];

const sessionRecordOf = (sessionId: string) => sessionRecord({
  ref: { aggregateType: 'Session', projectId: 'p1', sessionId },
  revision: 2,
  workspaceId: 'w1',
});
const linkOf = (sessionId: string, target: unknown) => ({
  ref: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId, relation: 'responsible', target },
  revision: 2, since: 'c1', until: null,
});
const goalTargetOf = (goalRef: unknown) => ({ kind: 'goal', ref: goalRef });
const moduleTargetOf = (moduleId: string) => ({ kind: 'module', ref: { projectId: 'p1', moduleId } });
const GOAL_2 = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g2' };
const GOAL_3 = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g3' };
const GOAL_7 = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g7' };
const GOAL_9 = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g9' };
const GOAL_404 = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g404' };
const LINK_S1_G1 = linkOf('s1', goalTargetOf(GOAL_REF));
const LINK_S1_G2 = linkOf('s1', goalTargetOf(GOAL_2));
const LINK_S2_G2 = linkOf('s2', goalTargetOf(GOAL_2));
const LINK_S2_G3 = linkOf('s2', goalTargetOf(GOAL_3));
const LINK_S2_G7 = linkOf('s2', goalTargetOf(GOAL_7));
const LINK_S2_G9 = linkOf('s2', goalTargetOf(GOAL_9));
const LINK_S2_G404 = linkOf('s2', goalTargetOf(GOAL_404));
const LINK_S2_M404 = linkOf('s2', moduleTargetOf('m404'));
const SOURCE_S1_G1 = LINK_S1_G1.ref;
const SOURCE_S1_G2 = LINK_S1_G2.ref;
const DEST_S2_G2 = LINK_S2_G2.ref;
const DEST_S2_G3 = LINK_S2_G3.ref;
const DEST_S2_G7 = LINK_S2_G7.ref;
const DEST_S2_G9 = LINK_S2_G9.ref;
const DEST_S2_G404 = LINK_S2_G404.ref;
const DEST_S2_M404 = LINK_S2_M404.ref;
const goalFactOf = (goalRef: unknown) => ({
  state: 'present', ref: goalRef, snapshot: { ref: goalRef }, version: { ref: goalRef, revision: 2 },
});
const moveOf = (source: unknown, destinations: readonly unknown[]) => ({ duty: 'adviser', source, destinations });
const REANCHOR_AUTH = { actor: { kind: 'human', id: 'person-1' }, scope: [{ kind: 'project' }] };
const REANCHOR_PROJECT = { projectId: 'p1' };
const reanchorFacts = (sessions: readonly unknown[], links: readonly unknown[], goals: readonly unknown[],
  catalog: unknown) => ({ sessions, links, goals, catalog });
const noCatalog = { state: 'none', revision: 1 };
const closedLinkOf = (link: unknown) => ({
  link, next: { ref: link, revision: 3, since: 'c1', until: null },
});
const openedLinkOf = (link: unknown) => ({
  link, next: { ref: link, revision: 1, since: null, until: null },
});
const expectedSessionOf = (sessionId: string) => sessionRecord({
  ref: { aggregateType: 'Session', projectId: 'p1', sessionId }, revision: 3, workspaceId: 'w1',
});
const claimCloseOf = (goalRef: unknown, owner: unknown) => ({
  duty: 'adviser', target: { kind: 'goal', goalRef }, expectedOwner: owner, nextOwner: null,
});
const claimOpenOf = (goalRef: unknown, owner: unknown) => ({
  duty: 'adviser', target: { kind: 'goal', goalRef }, expectedOwner: null, nextOwner: owner,
});
const eventOf = (closed: unknown, opened: unknown, openedBound: 'since' | null) => ({
  closed, opened, openedBound,
});

export const REANCHOR_CASES: readonly ReanchorCase[] = [
  { name: 'a close-only move writes one close with no destination', expected: 'plan',
    plan: {
      sessions: [expectedSessionOf('s1')],
      links: [closedLinkOf(SOURCE_S1_G1)],
      claimChanges: [claimCloseOf(GOAL_REF, SOURCE_S1_G1)],
      bindings: [{ link: SOURCE_S1_G1, field: 'until' }],
      events: [eventOf(SOURCE_S1_G1, null, null)],
    },
    input: {
      projectRef: REANCHOR_PROJECT, duty: 'adviser', moves: [moveOf(SOURCE_S1_G1, [])],
      facts: reanchorFacts([sessionRecordOf('s1')], [LINK_S1_G1], [], noCatalog),
      authorization: REANCHOR_AUTH, proposed: null } },
  { name: 'a move opens the absent destination with one binding', expected: 'plan',
    plan: {
      sessions: [expectedSessionOf('s1'), expectedSessionOf('s2')],
      links: [closedLinkOf(SOURCE_S1_G1), openedLinkOf(DEST_S2_G2)],
      claimChanges: [claimCloseOf(GOAL_REF, SOURCE_S1_G1), claimOpenOf(GOAL_2, DEST_S2_G2)],
      bindings: [{ link: SOURCE_S1_G1, field: 'until' }, { link: DEST_S2_G2, field: 'since' }],
      events: [eventOf(SOURCE_S1_G1, DEST_S2_G2, 'since')],
    },
    input: {
      projectRef: REANCHOR_PROJECT, duty: 'adviser',
      moves: [moveOf(SOURCE_S1_G1, [{ link: DEST_S2_G2, target: goalTargetOf(GOAL_2) }])],
      facts: reanchorFacts([sessionRecordOf('s1'), sessionRecordOf('s2')], [LINK_S1_G1],
        [['g2', goalFactOf(GOAL_2)]], noCatalog),
      authorization: REANCHOR_AUTH, proposed: null } },
  { name: 'a split closes the source once and opens each destination', expected: 'plan',
    plan: {
      sessions: [expectedSessionOf('s1'), expectedSessionOf('s2')],
      links: [closedLinkOf(SOURCE_S1_G1), openedLinkOf(DEST_S2_G2), openedLinkOf(DEST_S2_G3)],
      claimChanges: [claimCloseOf(GOAL_REF, SOURCE_S1_G1), claimOpenOf(GOAL_2, DEST_S2_G2),
        claimOpenOf(GOAL_3, DEST_S2_G3)],
      bindings: [{ link: SOURCE_S1_G1, field: 'until' }, { link: DEST_S2_G2, field: 'since' },
        { link: DEST_S2_G3, field: 'since' }],
      events: [eventOf(SOURCE_S1_G1, DEST_S2_G2, 'since'), eventOf(SOURCE_S1_G1, DEST_S2_G3, 'since')],
    },
    input: {
      projectRef: REANCHOR_PROJECT, duty: 'adviser', moves: [moveOf(SOURCE_S1_G1,
        [{ link: DEST_S2_G2, target: goalTargetOf(GOAL_2) }, { link: DEST_S2_G3, target: goalTargetOf(GOAL_3) }])],
      facts: reanchorFacts([sessionRecordOf('s1'), sessionRecordOf('s2')], [LINK_S1_G1],
        [['g2', goalFactOf(GOAL_2)], ['g3', goalFactOf(GOAL_3)]], noCatalog),
      authorization: REANCHOR_AUTH, proposed: null } },
  { name: 'two sources closing onto one destination keep one record and event material per source', expected: 'plan',
    plan: {
      sessions: [expectedSessionOf('s1'), expectedSessionOf('s2')],
      links: [closedLinkOf(SOURCE_S1_G1), closedLinkOf(SOURCE_S1_G2), openedLinkOf(DEST_S2_G9)],
      claimChanges: [claimCloseOf(GOAL_REF, SOURCE_S1_G1), claimCloseOf(GOAL_2, SOURCE_S1_G2),
        claimOpenOf(GOAL_9, DEST_S2_G9)],
      bindings: [{ link: SOURCE_S1_G1, field: 'until' }, { link: SOURCE_S1_G2, field: 'until' },
        { link: DEST_S2_G9, field: 'since' }],
      events: [eventOf(SOURCE_S1_G1, DEST_S2_G9, 'since'), eventOf(SOURCE_S1_G2, DEST_S2_G9, 'since')],
    },
    input: {
      projectRef: REANCHOR_PROJECT, duty: 'adviser', moves: [
        moveOf(SOURCE_S1_G1, [{ link: DEST_S2_G9, target: goalTargetOf(GOAL_9) }]),
        moveOf(SOURCE_S1_G2, [{ link: DEST_S2_G9, target: goalTargetOf(GOAL_9) }])],
      facts: reanchorFacts([sessionRecordOf('s1'), sessionRecordOf('s2')], [LINK_S1_G1, LINK_S1_G2],
        [['g9', goalFactOf(GOAL_9)]], noCatalog),
      authorization: REANCHOR_AUTH, proposed: null } },
  { name: 'a goal outside the facts and the proposal refuses the whole plan', expected: 'refusals',
    refusals: [{ status: 'rejected', code: 'not_found', reason: 'the reanchor goal destination is not present' }],
    input: {
      projectRef: REANCHOR_PROJECT, duty: 'adviser',
      moves: [moveOf(SOURCE_S1_G1, [{ link: DEST_S2_G404, target: goalTargetOf(GOAL_404) }])],
      facts: reanchorFacts([sessionRecordOf('s1'), sessionRecordOf('s2')], [LINK_S1_G1], [], noCatalog),
      authorization: REANCHOR_AUTH, proposed: null } },
  { name: 'a module outside the catalog refuses the whole plan', expected: 'refusals',
    refusals: [{ status: 'rejected', code: 'not_found', reason: 'the reanchor module destination is not in the catalog' }],
    input: {
      projectRef: REANCHOR_PROJECT, duty: 'adviser',
      moves: [moveOf(SOURCE_S1_G1, [{ link: DEST_S2_M404, target: moduleTargetOf('m404') }])],
      facts: reanchorFacts([sessionRecordOf('s1'), sessionRecordOf('s2')], [LINK_S1_G1], [],
        { state: 'present', revision: 1, catalog: catalogOf(['m1']) }),
      authorization: REANCHOR_AUTH, proposed: null } },
  { name: 'a goal present only in the proposal is lawful', expected: 'plan',
    plan: {
      sessions: [expectedSessionOf('s1'), expectedSessionOf('s2')],
      links: [closedLinkOf(SOURCE_S1_G1), openedLinkOf(DEST_S2_G7)],
      claimChanges: [claimCloseOf(GOAL_REF, SOURCE_S1_G1), claimOpenOf(GOAL_7, DEST_S2_G7)],
      bindings: [{ link: SOURCE_S1_G1, field: 'until' }, { link: DEST_S2_G7, field: 'since' }],
      events: [eventOf(SOURCE_S1_G1, DEST_S2_G7, 'since')],
    },
    input: {
      projectRef: REANCHOR_PROJECT, duty: 'adviser',
      moves: [moveOf(SOURCE_S1_G1, [{ link: DEST_S2_G7, target: goalTargetOf(GOAL_7) }])],
      facts: reanchorFacts([sessionRecordOf('s1'), sessionRecordOf('s2')], [LINK_S1_G1], [], noCatalog),
      authorization: REANCHOR_AUTH,
      proposed: { goal: { ref: GOAL_7, snapshot: { ref: GOAL_7 }, version: { ref: GOAL_7, revision: 2 } } } } },
];

/**
 * 04c G2-2: `ResponsibilityBasisV1`'s four arms. The task arm keeps the four
 * literals of the frozen codec (`task`, `planRef`, `terminalCause`, `finishedAt`),
 * the three new arms carry the one field each target kind pins. Each row is a
 * hand-computed value the event codec must encode and decode unchanged.
 */
const GOAL_BASIS_REF: GoalRef = { ...GOAL_REF, aggregateType: 'Goal' };
export const BASIS_CASES: readonly { name: string; basis: ResponsibilityBasisV1 }[] = [
  { name: 'a task basis with no terminal cause',
    basis: { kind: 'task', task: TASK_REF, planRef: { aggregateType: 'PlanRevision', projectId: 'p1', planId: 'plan-1' }, terminalCause: null, finishedAt: null } },
  { name: 'a task basis satisfied at a time',
    basis: { kind: 'task', task: TASK_REF, planRef: { aggregateType: 'PlanRevision', projectId: 'p1', planId: 'plan-1' }, terminalCause: 'satisfied', finishedAt: AT } },
  { name: 'a task basis cancelled at a time',
    basis: { kind: 'task', task: TASK_REF, planRef: { aggregateType: 'PlanRevision', projectId: 'p1', planId: 'plan-2' }, terminalCause: 'cancelled', finishedAt: '2026-11-02T12:30:00.000Z' } },
  { name: 'a task basis superseded at a time',
    basis: { kind: 'task', task: { projectId: 'p1', goalId: 'g2', taskId: 't2' }, planRef: { aggregateType: 'PlanRevision', projectId: 'p1', planId: 'plan-2' }, terminalCause: 'superseded', finishedAt: '2026-11-03T08:00:00.000Z' } },
  { name: 'a goal basis at revision 1', basis: { kind: 'goal', goalRef: GOAL_BASIS_REF, goalRevision: 1 } },
  { name: 'a goal basis at revision 3', basis: { kind: 'goal', goalRef: GOAL_BASIS_REF, goalRevision: 3 } },
  { name: 'a second goal basis at revision 5',
    basis: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g2' }, goalRevision: 5 } },
  { name: 'a goal basis at revision 9', basis: { kind: 'goal', goalRef: GOAL_BASIS_REF, goalRevision: 9 } },
  { name: 'a project basis for the project', basis: { kind: 'project', projectRef: { projectId: 'p1' } } },
  { name: 'a project basis for another project', basis: { kind: 'project', projectRef: { projectId: 'p2' } } },
  { name: 'a project basis for a third project', basis: { kind: 'project', projectRef: { projectId: 'p3' } } },
  { name: 'a module basis at catalog revision 0', basis: { kind: 'module', moduleRef: MODULE_REF, catalogRevision: 0 } },
  { name: 'a module basis at catalog revision 1', basis: { kind: 'module', moduleRef: MODULE_REF, catalogRevision: 1 } },
  { name: 'a module basis at catalog revision 5', basis: { kind: 'module', moduleRef: MODULE_REF, catalogRevision: 5 } },
  { name: 'a second module basis at catalog revision 12',
    basis: { kind: 'module', moduleRef: { projectId: 'p1', moduleId: 'm2' }, catalogRevision: 12 } },
];
