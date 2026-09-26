/** Independent reviewer cases. These exercise existing ports and real Stores;
 * no alternate lifecycle or catalog implementation is supplied by the tests. */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { revisionAssignments, type PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ArchitectureBaselineRevisionSnapshot } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import {
  createGraphSessionFixture, encodeGraphGovernance, GRAPH_MODULE_ONE, linkRequest,
  type GraphSessionFixture,
} from '../helpers/graph-session-fixture.js';

const fixtures: GraphSessionFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function make(kind: 'memory' | 'sqlite') {
  const f = await createGraphSessionFixture(kind); fixtures.push(f); return f;
}
const key = (ref: unknown) => canonicalJson(ref as JsonValue);

describe.each(['memory', 'sqlite'] as const)('A1 independent %s review', kind => {
  it('can explicitly close an old Task relation after the active Plan removes that Task', async () => {
    const f = await make(kind);
    const task = await f.seedAcceptedTask();
    const session = await f.createSession('removed-task');
    const target = { kind: 'task' as const, ref: task.taskRef };
    const opening = await linkRequest(f, session, target, 'responsible', true, 'old-task-open');
    const opened = await f.lifecycle.linkSessionWork(f.ctx, opening);
    expect(opened.status).toBe('committed');
    if (opened.status !== 'committed') return;

    // Trusted fixture advances the active Plan. This is not a successful
    // lifecycle seed; both opening and closure use the real lifecycle writer.
    const rows = await f.records.readMany([key(task.goalRef), key(task.planRef)]);
    expect(rows.status).toBe('ready');
    if (rows.status !== 'ready') return;
    const goal = JSON.parse(rows.value.records.find(row => row.refKey === key(task.goalRef))!.json) as GoalSnapshot;
    const plan = JSON.parse(rows.value.records.find(row => row.refKey === key(task.planRef))!.json) as PlanRevisionSnapshot;
    const replacement: PlanRevisionSnapshot = {
      ...plan, ref: { ...plan.ref, planId: 'a1-replacement-plan' }, planId: 'a1-replacement-plan',
      planRevision: plan.planRevision + 1,
      tasks: plan.tasks.filter(entry => entry.taskId !== task.taskRef.taskId),
      assignments: revisionAssignments(plan).filter(entry => entry.taskId !== task.taskRef.taskId),
      obligations: plan.obligations.map(entry => ({ ...entry,
        taskIds: entry.taskIds.filter(taskId => taskId !== task.taskRef.taskId) })),
    };
    const nextGoal = { ...goal, revision: goal.revision + 1, activePlanRevision: replacement.ref };
    expect(await f.commitRaw([
      { refKey: key(replacement.ref), schemaId: 'PlanRevisionSnapshot@1', revision: 1, json: JSON.stringify(replacement) },
      { refKey: key(nextGoal.ref), schemaId: 'GoalSnapshot@1', revision: nextGoal.revision, json: JSON.stringify(nextGoal) },
    ], [{ refKey: key(goal.ref), expectedRevision: goal.revision }])).toMatchObject({ status: 'committed' });

    const closed = await f.lifecycle.linkSessionWork(f.ctx,
      await linkRequest(f, session, target, 'responsible', false, 'old-task-close'));
    expect(closed).toMatchObject({ status: 'committed', value: { since: opened.value.since } });
    if (closed.status !== 'committed') return;
    expect(closed.value.until).toBe(closed.cursor);
    const card = await f.sessionsPort.readSession(f.ctx, session);
    expect(card.status).toBe('ready');
    if (card.status === 'ready') expect(card.value.links).toEqual([closed.value]);
    expect(await f.lifecycle.linkSessionWork(f.ctx, opening)).toEqual({ ...opened, replayed: true });
  });

  it('rechecks a current catalog pointer that changes between pointer and revision reads', async () => {
    const f = await make(kind);
    await f.seedLegacyArchitectureBaseline('before-reader-race');
    const baselineId = 'after-reader-race';
    const content = { schemaVersion: 1 as const, description: 'New coherent baseline', constraints: [] };
    const next: ArchitectureBaselineRevisionSnapshot = {
      ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: f.projectId, baselineId, revision: 1 },
      revision: 1, schemaVersion: 1, baselineId, contentRevision: 1, content,
      contentDigest: sha256Hex(canonicalJson({ schemaVersion: 1, identity: { baselineId }, revision: 1, content })),
    };
    const pointer = { ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId: f.projectId },
      projectId: f.projectId, revision: 2, activeRevision: next.ref };
    let moved = false;
    const records = { ...f.records, async readMany(refs: readonly string[]) {
      const read = await f.records.readMany(refs);
      // Mutation occurs after the real pointer read has completed, before the
      // service can fetch the pointed-to immutable revision. A readMany that
      // already contains all related facts is a coherent window and needs no
      // extra gate; this seam only targets the discovery read.
      if (!moved && refs.includes(key(pointer.ref)) && !refs.some(ref => JSON.parse(ref).aggregateType === 'ArchitectureBaselineRevision')) {
        moved = true;
        expect(await f.commitRaw([encodeGraphGovernance(next), encodeGraphGovernance(pointer)],
          [{ refKey: key(pointer.ref), expectedRevision: 1 }])).toMatchObject({ status: 'committed' });
      }
      return read;
    } };
    const result = await createArchitectureCatalogService({ records }).readArchitectureRevision(f.ctx,
      { selection: { kind: 'current' } });
    expect(moved).toBe(true);
    if (result.status === 'rejected') expect(result.code).toBe('source_stale');
    else expect(result).toMatchObject({ status: 'ready', value: { baseline: next, catalog: null } });
  });

  it('paginates distributed relations without rescanning the complete target on every page', async () => {
    const f = await make(kind);
    expect(await f.adopt('bounded-pages-adopt')).toMatchObject({ status: 'committed' });
    const target = { kind: 'module' as const, ref: f.moduleRef(GRAPH_MODULE_ONE) };
    const expected = new Set<string>();
    const relations = ['responsible', 'participates', 'investigated'] as const;
    for (let i = 0; i < 64; i++) {
      const session = await f.createSession(`bounded-page-${i}`); expected.add(session.sessionId);
      for (const relation of relations) {
        expect(await f.lifecycle.linkSessionWork(f.ctx,
          await linkRequest(f, session, target, relation, true, `bounded-link-${i}-${relation}`)))
          .toMatchObject({ status: 'committed' });
      }
    }
    const all: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      f.resetSpy();
      const result = await f.sessionsPort.findSessions(f.ctx, { workspace: f.scope, target, includeArchived: false,
        page: { limit: 5, ...(cursor === undefined ? {} : { cursor }) } });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      // 192 target links exist. A generous fixed budget of 96 returned rows
      // includes lookup streams, fetched Session facts and SessionCard links;
      // even one complete target scan exceeds it. No index names or timing
      // thresholds are assumed. Small pages must do bounded candidate work.
      expect(f.spy.lookupRecords + f.spy.readManyRecords).toBeLessThanOrEqual(96);
      expect(result.value.items.length).toBeLessThanOrEqual(5);
      all.push(...result.value.items.map(card => card.record.ref.sessionId));
      if (result.value.nextCursor === null) break;
      expect(result.value.nextCursor).not.toBe(cursor);
      cursor = result.value.nextCursor;
    }
    expect(all).toHaveLength(expected.size);
    expect(new Set(all)).toEqual(expected);
  });
});
