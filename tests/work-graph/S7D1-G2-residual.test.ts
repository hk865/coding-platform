/**
 * `G2-residual` (book `7d1:2019`, start rulings §5 `:2124`, w56-16, DR-03): a full handoff moves the source's
 * goal/project scope to the borrower; a partial handoff leaves the scope (and holder) with the source.
 *
 * The world is `seedS7D1HandoffScopeLight` (full and `{ partial: true }`): the fixture already closed FH-1's two extra
 * Goal Tasks through the real `linkTask` (DR-03) and ran the real acceptance. The row opens the source's project
 * link through the real `sessions/link` (beside the fixture's goal link), drives the published handoff with
 * `driveS6BHandoff`, and reads both lines back through `sessions/read`. The two predicates are the tree's own:
 * `residualResponsibilityOf` reports goal/project and an adviser's module region as `'scope'`, and `openScopeLinkOf`
 * reports the same three (module only for an adviser/scribe).
 *
 * The full case's source is archived by the handoff's own formal archive commit (the archive stage the driver
 * reaches, `src/business/workflow/session-handoff.ts` archive child), so a separate public `sessions/archive` on the
 * already-archived source answers `invalid`; the holder half is read through the deferred `role-lines/allocation`
 * route (W). That route is absent on this tree, so the second case records the deferred first error
 * (`S7D1_ALLOCATION_DEFERRED`) and no fake holder value is written.
 *
 * Named mutation: break the scope before write's destination pin by taking the source link's planned revision
 * (`session-handoff-service.ts`, `destinationLink: revisionOf(links.value.records, destinationKey)` →
 * `scope.targets[index]!.revision`). The destination record is absent at revision 0, so the parent guard conflicts,
 * the drive throws and no scope link moves; restoring the expression returns the first case green.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkLinkTarget } from '../../src/contracts/core/identity.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { sameRef } from '../../src/core/work-graph/state/ref-equality.js';
import { openScopeLinkOf } from '../../src/core/work-graph/state/session-availability.js';
import { residualResponsibilityOf } from '../../src/core/work-graph/state/session-handoff-contracts.js';
import type { HandoffActionV1 } from '../../src/core/work-graph/model/session-operation-arms.js';
import type { SessionOperationRecordOf } from '../../src/core/work-graph/model/session-contracts.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { driveS6BHandoff } from '../helpers/S6B2-fixture.js';
import { readS7D1Allocation } from '../helpers/S7D1-allocation-world.js';
import {
  openLink, openLinkOf, seedS7D1HandoffScopeLight, type S7D1HandoffScopeSeed,
} from '../helpers/S7D1-role-line-world.js';

const projectTarget: WorkLinkTarget = { kind: 'project', ref: { projectId: S6A_SCOPE.projectId } };
const seeds: S7D1HandoffScopeSeed[] = [];
afterEach(async () => {
  for (const seed of seeds.splice(0)) await seed.close().catch(() => undefined);
});

/** The source's real project link, opened after the acceptance through the public route. */
async function withProjectLink(scope: S7D1HandoffScopeSeed, label: string): Promise<void> {
  const opened = await openLink(scope.world.world, {
    line: scope.source, target: projectTarget, requestId: `s7d1-residual-project-${label}`,
  });
  expect(opened.result).toMatchObject({ status: 'committed' });
}

async function seedScope(partial: boolean, label: string): Promise<S7D1HandoffScopeSeed> {
  const scope = await seedS7D1HandoffScopeLight(partial ? { partial: true } : {});
  seeds.push(scope);
  await withProjectLink(scope, label);
  return scope;
}

describe('G2-residual', () => {
  it('a full handoff moves the source goal/project scope to the successor', async () => {
    const scope = await seedScope(false, 'full');
    const source = await scope.world.world.readSession(scope.source.ref);
    const adviser = await scope.world.world.readSession(scope.adviser.ref);
    const goal = openLinkOf(source, 'goal');
    const project = openLinkOf(source, 'project');
    const module = openLinkOf(adviser, 'module');
    if (goal === undefined || project === undefined || module === undefined) {
      throw new Error('G2-residual: the accepted world is missing a goal, project or module link');
    }

    // The predicates: goal/project and an adviser's module region are the `'scope'` word.
    expect(residualResponsibilityOf(source.links, scope.tasks, 'executor')).toBe('scope');
    expect(residualResponsibilityOf([goal], [], 'executor')).toBe('scope');
    expect(residualResponsibilityOf([project], [], 'executor')).toBe('scope');
    expect(residualResponsibilityOf([module], [], 'adviser')).toBe('scope');
    expect(residualResponsibilityOf([module], [], 'executor')).toBe('scope');
    expect(openScopeLinkOf([goal], 'executor')).toBe('goal');
    expect(openScopeLinkOf([project], 'executor')).toBe('project');
    expect(openScopeLinkOf([module], 'adviser')).toBe('module');
    expect(openScopeLinkOf([module], 'executor')).toBe('module');

    const driven = await driveS6BHandoff(scope.world.world, { operation: scope.operation });
    expect(driven.progress).toMatchObject({ stage: 'finished', phase: 'completed', archived: true, lastRefusal: null });
    // Every scope sub-operation was saved, including the last one after its child closed the source link (01).
    const saved = ready<SessionOperationRecordOf<HandoffActionV1>>(
      await scope.world.world.post('sessions/operation', plain(S6A_SCOPE, scope.operation)), 'the driven handoff');
    expect(saved.action.progress.scope?.entries.every(entry => entry.receipt !== null)).toBe(true);
    const successorRef = driven.progress?.successor;
    if (successorRef === null || successorRef === undefined) throw new Error('G2-residual: no successor');

    const afterSource = await scope.world.world.readSession(scope.source.ref);
    const afterSuccessor = await scope.world.world.readSession(successorRef);
    expect(afterSource.record.lifecycle).toBe('archived');
    // No responsible link of the source is left open: every kind moved with one sub-operation per target.
    expect(afterSource.links.filter(link => link.ref.relation === 'responsible' && link.until === null)).toEqual([]);
    expect(openScopeLinkOf(afterSource.links, 'executor')).toBe(false);
    expect(residualResponsibilityOf(afterSource.links, [], 'executor')).toBe(false);

    // The successor holds the two scope links the source had, with a bound `since`.
    for (const kind of ['goal', 'project'] as const) {
      const moved = openLinkOf(afterSuccessor, kind);
      if (moved === undefined) throw new Error(`G2-residual: the successor has no open ${kind} link`);
      expect(canonicalKey(moved.ref.target)).toBe(canonicalKey(kind === 'goal' ? scope.targets.goal : projectTarget));
      expect(moved.since).not.toBeNull();
      expect(moved.until).toBeNull();
    }
    expect(afterSuccessor.links.filter(link => link.ref.relation === 'responsible'
      && link.until === null && link.ref.target.kind === 'task')).toHaveLength(scope.tasks.length);
  });

  it('a partial handoff leaves the goal/project scope with the source and gives the successor no scope link', async () => {
    const scope = await seedScope(true, 'partial');
    const source = await scope.world.world.readSession(scope.source.ref);
    expect(residualResponsibilityOf(source.links, scope.assigned, 'executor')).toBe('task');
    expect(residualResponsibilityOf(source.links, scope.tasks, 'executor')).toBe('scope');

    const driven = await driveS6BHandoff(scope.world.world, { operation: scope.operation });
    expect(driven.progress).toMatchObject({ stage: 'transfer', phase: 'running', archived: false,
      lastRefusal: 'the source still owns work the handoff does not name' });
    const successorRef = driven.progress?.successor;
    if (successorRef === null || successorRef === undefined) throw new Error('G2-residual: no partial successor');

    const afterSource = await scope.world.world.readSession(scope.source.ref);
    const afterSuccessor = await scope.world.world.readSession(successorRef);
    expect(afterSource.record.lifecycle).toBe('active');
    // Both scope links stay open on the source at the revisions the row read before the drive.
    for (const kind of ['goal', 'project'] as const) {
      expect(openLinkOf(afterSource, kind)?.revision).toBe(openLinkOf(source, kind)?.revision);
      expect(openLinkOf(afterSuccessor, kind)).toBeUndefined();
    }
    expect(openScopeLinkOf(afterSource.links, 'executor')).toBe('goal');
    // The unnamed Task link is the residual that stopped the handoff; the two named ones moved.
    expect(residualResponsibilityOf(afterSource.links, scope.assigned, 'executor')).toBe('task');
    expect(afterSuccessor.links.filter(link => link.ref.relation === 'responsible'
      && link.until === null && link.ref.target.kind === 'task')).toHaveLength(scope.assigned.length);
  });

  it.each(['full', 'partial'] as const)(
    'the %s handoff leaves the source and successor holders as the book says', async variant => {
      const scope = await seedScope(variant === 'partial', `holder-${variant}`);
      const before = await readS7D1Allocation(scope.world.world);
      const sourceHolder = before.duties.executor.holders.find(holder => sameRef(holder.session, scope.source.ref));
      if (sourceHolder === undefined) throw new Error('G2-residual: the source is not an executor holder');
      const since = sourceHolder.since;

      const driven = await driveS6BHandoff(scope.world.world, { operation: scope.operation });
      const successorRef = driven.progress?.successor;
      if (successorRef === null || successorRef === undefined) throw new Error('G2-residual: no successor');

      const after = await readS7D1Allocation(scope.world.world);
      const holders = after.duties.executor.holders.filter(holder => sameRef(holder.session, scope.source.ref)
        || sameRef(holder.session, successorRef));
      if (variant === 'full') {
        expect(holders).toHaveLength(1);
        expect(sameRef(holders[0]!.session, successorRef)).toBe(true);
        expect(holders[0]!.since).toBe(since);
        expect(after.duties.executor.holders).toHaveLength(before.duties.executor.holders.length);
        return;
      }
      // A partial handoff keeps the source's seat and gives the successor its own admission; its temporary
      // reservation became its holder, so the reservation count returns to the before value.
      const sourceAfter = after.duties.executor.holders.find(holder => sameRef(holder.session, scope.source.ref));
      const successorAfter = after.duties.executor.holders.find(holder => sameRef(holder.session, successorRef));
      expect(sourceAfter).toBeDefined();
      expect(sourceAfter!.since).toBe(since);
      expect(successorAfter).toBeDefined();
      expect(successorAfter!.since).not.toBe(since);
      expect(after.duties.executor.holders).toHaveLength(before.duties.executor.holders.length + 1);
      expect(after.duties.executor.reservations).toHaveLength(before.duties.executor.reservations.length);
    });
});
