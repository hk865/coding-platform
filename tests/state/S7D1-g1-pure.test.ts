/**
 * 7D1 G1-2's five pure rows: effective regions, the claim hook/fold, the allocation migration, the reanchor
 * plan and the seat inheritance. Each table row is a hand-computed input and expectation; no store, Host,
 * `CoreCallContext` or world is built here.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { ProjectScope, SessionWorkLinkRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { HandoffSeatFactsV1, SessionRecord, SessionWorkLink } from '../../src/contracts/core/session.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import {
  roleScopeClaimKey, scopeOwnedDetailOfSlot, type RoleLineAllocationV1, type RoleLineDutyV1,
  type RoleScopeClaimChangeV1, type RoleScopeV1,
} from '../../src/contracts/role-lines.js';
import { allocationNext } from '../../src/core/work-graph/state/role-line-allocation.js';
import {
  planReanchor, type ReanchorCatalogFactsV1, type ReanchorFactsV1, type ReanchorGoalFactsV1,
  type ReanchorMoveV1,
} from '../../src/core/work-graph/state/reanchor.js';
import {
  deepestContainingRegion, effectiveRegions, foldRoleScopeClaimChanges, responsibilityClaimChanges,
  type RegionClaimV1,
} from '../../src/core/work-graph/state/role-scope.js';
import { openResponsibleLinkOf } from '../../src/core/work-graph/state/session-availability.js';
import { residualResponsibilityOf, seatInheritanceOf } from '../../src/core/work-graph/state/session-handoff-contracts.js';
import {
  ALLOCATION_CASES, CLAIM_CASES, REANCHOR_CASES, REGION_CASES,
} from '../helpers/S7D1-pure-tables.js';

type AllocationChange = Parameters<typeof allocationNext>[0]['change'];
type ReanchorRow = {
  projectRef: ProjectScope; duty: RoleLineDutyV1; moves: readonly ReanchorMoveV1[];
  facts: { sessions: readonly SessionRecord[]; links: readonly SessionWorkLink[];
    goals: readonly (readonly [string, ReanchorGoalFactsV1])[]; catalog: ReanchorCatalogFactsV1 };
  authorization: { actor: ActorRef; scope: readonly RoleScopeV1[] };
  proposed: Parameters<typeof planReanchor>[0]['proposed'];
};

describe('G1-region', () => {
  it.each(REGION_CASES)('$name', (c) => {
    const regions = c.regions as RegionClaimV1[];
    const result = effectiveRegions({ regions, catalog: c.catalog as AdoptedArchitecture | null });
    expect(result).toHaveLength(regions.length);
    expect(result[0]!.modules.map((module) => module.moduleId)).toEqual(c.expected);
    expect(result[0]!.session).toEqual(regions[0]!.session);
  });

  it('deepestContainingRegion picks the deepest root that contains every module', () => {
    const catalog = {
      modules: [], dependencies: [], requireDag: true, containment: { parentOf: [
        { parent: { projectId: 'p1', moduleId: 'a' }, child: { projectId: 'p1', moduleId: 'a/x' } },
        { parent: { projectId: 'p1', moduleId: 'a/x' }, child: { projectId: 'p1', moduleId: 'a/x/y' } },
      ] },
    } as unknown as AdoptedArchitecture;
    expect(deepestContainingRegion(catalog, ['a', 'a/x'], ['a/x/y'])).toBe('a/x');
    expect(deepestContainingRegion(catalog, ['a', 'a/x'], ['a/x/y', 'a/x/z'])).toBeNull();
  });
});

describe('G1-claim', () => {
  it.each(CLAIM_CASES)('$name', (c) => {
    const projectRef: ProjectScope = { projectId: 'p1' };
    const close = c.close as { link: SessionWorkLinkRef; duty: RoleLineDutyV1 }[];
    const open = c.open as { link: SessionWorkLinkRef; duty: RoleLineDutyV1 }[];
    const changes = responsibilityClaimChanges({ projectRef, close, open });
    expect(foldRoleScopeClaimChanges(projectRef, changes)).toEqual(c.expected as RoleScopeClaimChangeV1[]);
  });

  it('the key text and the slot owner decode to duty, target and holder', () => {
    const target: RoleScopeV1 = { kind: 'region', moduleRef: { projectId: 'p1', moduleId: 'm1' } };
    const key = roleScopeClaimKey({ projectRef: { projectId: 'p1' }, duty: 'adviser', target });
    expect(key).toBe('role-scope:{"duty":"adviser","projectId":"p1","target":{"kind":"region","moduleRef":{"moduleId":"m1","projectId":"p1"}}}');
    const owner = '{"aggregateType":"SessionWorkLink","projectId":"p1","relation":"responsible","sessionId":"s1",'
      + '"target":{"kind":"module","ref":{"moduleId":"m1","projectId":"p1"}}}';
    expect(scopeOwnedDetailOfSlot({ claimKey: key, owner })).toEqual({
      duty: 'adviser', target, holder: { projectId: 'p1', sessionId: 's1' },
    });
  });
});

describe('G1-alloc', () => {
  it.each(ALLOCATION_CASES)('$name', (c) => {
    const result = allocationNext({
      projectRef: { projectId: 'p1' }, duty: 'adviser',
      current: c.current as RoleLineAllocationV1 | null, change: c.change as AllocationChange,
    });
    expect(result).toEqual(c.expected);
  });
});

describe('G1-reanchor', () => {
  it.each(REANCHOR_CASES)('$name', (c) => {
    const row = c.input as ReanchorRow;
    const facts: ReanchorFactsV1 = {
      sessions: new Map(row.facts.sessions.map((session) => [session.ref.sessionId, session])),
      links: new Map(row.facts.links.map((link) => [canonicalKey(link.ref), link])),
      goals: new Map(row.facts.goals), catalog: row.facts.catalog,
    };
    const result = planReanchor({
      projectRef: row.projectRef, duty: row.duty, moves: row.moves, facts,
      authorization: row.authorization, proposed: row.proposed,
    });

    if (c.expected === 'refusals') {
      expect(result).toEqual({ ok: false, refusals: c.refusals });
      return;
    }

    expect(result).toEqual({ ok: true, plan: c.plan });
  });
});

const SEAT_GOAL = { kind: 'goal', ref: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' } } as const;
const SEAT_TASK = {
  kind: 'task', ref: { projectId: 'p1', goalId: 'g1', taskId: 't1' },
} as const;
const HANDOFF_OPERATION: OperationRef = {
  aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1',
};
const HANDOFF_SOURCE = { projectId: 'p1', sessionId: 's9' };
const HANDOFF_FACTS: HandoffSeatFactsV1 = {
  ref: HANDOFF_OPERATION, phase: 'running',
  action: { kind: 'handoff', input: { source: HANDOFF_SOURCE, assignments: [{ target: { kind: 'create', duty: 'adviser' } }] } },
  progress: { assignments: [{ successor: null, createInput: { commandId: 'cmd-1' } }] },
};
const seatLink = (target: SessionWorkLink['ref']['target']): SessionWorkLink => ({
  ref: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', relation: 'responsible', target },
  revision: 1, since: makeCommitCursor(1), until: null,
});
const seatInput = { parentOperation: HANDOFF_OPERATION, operation: HANDOFF_FACTS, duty: 'adviser' as PlatformDutyV1,
  sourceDuty: 'adviser' as const, namedTasks: [] as TaskTriple[], sourceLinks: [] as SessionWorkLink[],
  createCommandId: 'cmd-1' };

describe('G1-seat', () => {
  it('a goal link before an unnamed open task answers not_full and borrows nothing', () => {
    const goal = seatLink(SEAT_GOAL);
    const task = seatLink(SEAT_TASK);
    const links = [goal, task];
    expect(openResponsibleLinkOf(links)).toBe('task');
    expect(residualResponsibilityOf(links, [], 'adviser')).toBe('task');
    expect(seatInheritanceOf({ ...seatInput, sourceLinks: links })).toEqual({ kind: 'none', reason: 'not_full' });
  });

  it('a named task is filtered and a scope-only source borrows the parent', () => {
    const links = [seatLink(SEAT_TASK), seatLink(SEAT_GOAL)];
    expect(residualResponsibilityOf(links, [SEAT_TASK.ref], 'adviser')).toBe('scope');
    expect(seatInheritanceOf({ ...seatInput, namedTasks: [SEAT_TASK.ref], sourceLinks: links }))
      .toEqual({ kind: 'borrow', handoff: HANDOFF_OPERATION, source: HANDOFF_SOURCE });
  });

  it('the reason order is no_parent, not_our_parent, other_duty and not_first_create', () => {
    expect(seatInheritanceOf({ ...seatInput, parentOperation: null }))
      .toEqual({ kind: 'none', reason: 'no_parent' });
    expect(seatInheritanceOf({ ...seatInput, operation: null }))
      .toEqual({ kind: 'none', reason: 'not_our_parent' });
    expect(seatInheritanceOf({ ...seatInput, duty: 'secretary' }))
      .toEqual({ kind: 'none', reason: 'other_duty' });
    expect(seatInheritanceOf({ ...seatInput, createCommandId: 'cmd-2' }))
      .toEqual({ kind: 'none', reason: 'not_first_create' });
  });
});
