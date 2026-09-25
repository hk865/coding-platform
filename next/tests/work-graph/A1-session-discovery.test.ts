/**
 * A1 target-indexed Session discovery behavior tests (skeleton phase).
 *
 * These tests call only the new formal services to write real target links and
 * then the existing `findSessions`; the current directory is intentionally NOT
 * modified in this phase. They fail RED (new services are `unsupported`) and
 * become the standard the implementation phase must satisfy when the directory
 * becomes target-index driven.
 *
 * The read-count assertions require that a target query does not fall back to a
 * workspace enumeration and that read volume tracks the target candidates, not
 * the number of unrelated Sessions.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef, WorkLinkRelation, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import {
  createGraphSessionFixture, GRAPH_MODULE_ONE, GRAPH_MODULE_TWO, linkRequest, lifecycleRequest,
  type GraphSessionFixture, type GraphRecordSpy,
} from '../helpers/graph-session-fixture.js';

const fixtures: GraphSessionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function make(kind: 'memory' | 'sqlite'): Promise<GraphSessionFixture> {
  const fixture = await createGraphSessionFixture(kind);
  fixtures.push(fixture);
  return fixture;
}
function moduleTarget(fixture: GraphSessionFixture, moduleId: string): WorkLinkTarget {
  return { kind: 'module', ref: fixture.moduleRef(moduleId) };
}
async function link(fixture: GraphSessionFixture, session: SessionRef, target: WorkLinkTarget,
  relation: WorkLinkRelation, requestId: string): Promise<void> {
  const result = await fixture.lifecycle.linkSessionWork(fixture.ctx, await linkRequest(fixture, session, target, relation, true, requestId));
  if (result.status !== 'committed') throw new Error(`A1 discovery fixture needs a committed link: ${JSON.stringify(result)}`);
}
function ids(fixture: GraphSessionFixture, ...sessions: SessionRef[]): Set<string> {
  return new Set(sessions.map(session => session.sessionId));
}
function findTarget(fixture: GraphSessionFixture, target: WorkLinkTarget, includeArchived = false, limit = 50,
  cursor?: string) {
  return fixture.sessionsPort.findSessions(fixture.ctx, {
    workspace: fixture.scope, target, includeArchived,
    page: cursor === undefined ? { limit } : { limit, cursor },
  });
}
function workspaceLookups(spy: GraphRecordSpy): number {
  return spy.lookups.filter(entry => entry.index === 'session-by-workspace' || entry.index === 'session-by-workspace-lifecycle').length;
}

describe.each(['memory', 'sqlite'] as const)('A1 target-indexed discovery over real %s RecordStore', kind => {
  it('finds a standby Session and excludes its closed link regardless of includeArchived while preserving history', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-discovery');
    const session = await fixture.createSession('discovery-module');
    const target = moduleTarget(fixture, GRAPH_MODULE_ONE);
    await link(fixture, session, target, 'responsible', 'discovery-link');

    const found = await findTarget(fixture, target);
    expect(found.status).toBe('ready');
    if (found.status !== 'ready') return;
    expect(found.value.items.map(card => card.record.ref.sessionId)).toContain(session.sessionId);
    // A Session with no occupancy is still discoverable (standby), not hidden.
    const card = found.value.items.find(entry => entry.record.ref.sessionId === session.sessionId);
    expect(['idle', 'recoverable']).toContain(card?.availability);

    const closed = await fixture.lifecycle.linkSessionWork(fixture.ctx,
      await linkRequest(fixture, session, target, 'responsible', false, 'discovery-close'));
    expect(closed.status).toBe('committed');
    for (const includeArchived of [false, true]) {
      const afterClose = await findTarget(fixture, target, includeArchived);
      expect(afterClose.status).toBe('ready');
      if (afterClose.status === 'ready') {
        expect(afterClose.value.items.map(entry => entry.record.ref.sessionId)).not.toContain(session.sessionId);
      }
    }
    const history = await fixture.sessionsPort.readSession(fixture.ctx, session);
    expect(history.status).toBe('ready');
    if (history.status === 'ready') {
      expect(history.value.links.some(entry => entry.until !== null)).toBe(true);
    }
  });

  it('hides an archived Session by default, keeps it readable, and shows it again after reactivation', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-archive-discovery');
    const session = await fixture.createSession('discovery-archive');
    const target = moduleTarget(fixture, GRAPH_MODULE_TWO);
    await link(fixture, session, target, 'investigated', 'discovery-archive-link');
    const archived = await fixture.lifecycle.archiveSession(fixture.ctx,
      await lifecycleRequest(fixture, session, 'discovery-archive', 'done'));
    expect(archived.status).toBe('committed');

    const hidden = await findTarget(fixture, target, false);
    expect(hidden.status).toBe('ready');
    if (hidden.status === 'ready') expect(hidden.value.items).toHaveLength(0);
    const withArchived = await findTarget(fixture, target, true);
    expect(withArchived.status).toBe('ready');
    if (withArchived.status === 'ready') {
      expect(withArchived.value.items.map(entry => entry.record.ref.sessionId)).toContain(session.sessionId);
    }
    // History is always readable through readSession, independent of discovery.
    const history = await fixture.sessionsPort.readSession(fixture.ctx, session);
    expect(history.status).toBe('ready');
    if (history.status === 'ready') {
      expect(history.value.record.lifecycle).toBe('archived');
      expect(history.value.links.some(entry => entry.until === null)).toBe(true);
    }

    const reactivated = await fixture.lifecycle.reactivateSession(fixture.ctx,
      await lifecycleRequest(fixture, session, 'discovery-reactivate', 'resume'));
    expect(reactivated.status).toBe('committed');
    const visible = await findTarget(fixture, target, false);
    expect(visible.status).toBe('ready');
    if (visible.status === 'ready') {
      expect(visible.value.items.map(entry => entry.record.ref.sessionId)).toContain(session.sessionId);
    }
  });

  it('deduplicates multiple relations to one Session across a stable page boundary', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-pagination');
    const sessions: SessionRef[] = [];
    for (let index = 0; index < 3; index += 1) {
      const session = await fixture.createSession(`page-session-${index}`);
      sessions.push(session);
      await link(fixture, session, moduleTarget(fixture, GRAPH_MODULE_ONE), 'responsible', `page-link-${index}-a`);
      await link(fixture, session, moduleTarget(fixture, GRAPH_MODULE_ONE), 'participates', `page-link-${index}-b`);
    }
    const expected = ids(fixture, ...sessions);
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const found = await findTarget(fixture, moduleTarget(fixture, GRAPH_MODULE_ONE), false, 1, cursor);
      expect(found.status).toBe('ready');
      if (found.status !== 'ready') return;
      for (const card of found.value.items) collected.push(card.record.ref.sessionId);
      if (found.value.nextCursor === null) break;
      cursor = found.value.nextCursor;
    }
    expect(collected).toHaveLength(expected.size);
    expect(new Set(collected)).toEqual(expected);
  });

  it('returns an empty target lookup without creating a formal-catalog admission gate', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-unknown-target');
    const found = await findTarget(fixture, moduleTarget(fixture, 'not-in-catalog'));
    expect(found).toMatchObject({ status: 'ready', value: { items: [], nextCursor: null } });
  });

  it('reads with volume that tracks target candidates, not all workspace Sessions', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-read-count');
    const target = moduleTarget(fixture, GRAPH_MODULE_ONE);
    const linked: SessionRef[] = [];
    for (let index = 0; index < 2; index += 1) {
      const session = await fixture.createSession(`measured-linked-${index}`);
      linked.push(session);
      await link(fixture, session, target, 'responsible', `measured-link-${index}`);
    }
    for (let index = 0; index < 40; index += 1) await fixture.createSession(`unrelated-a-${index}`);

    fixture.resetSpy();
    const first = await findTarget(fixture, target, false, 10);
    expect(first.status).toBe('ready');
    const firstRecords = fixture.spy.lookupRecords + fixture.spy.readManyRecords;
    expect(workspaceLookups(fixture.spy)).toBe(0);
    expect(fixture.spy.lookups.some(entry => entry.index.startsWith('session-links-by-module'))).toBe(true);

    for (let index = 0; index < 40; index += 1) await fixture.createSession(`unrelated-b-${index}`);
    fixture.resetSpy();
    const second = await findTarget(fixture, target, false, 10);
    expect(second.status).toBe('ready');
    // Doubling unrelated Sessions must not double target-query reads.
    expect(fixture.spy.lookupRecords + fixture.spy.readManyRecords).toBeLessThanOrEqual(firstRecords + 4);
    expect(workspaceLookups(fixture.spy)).toBe(0);
    if (first.status === 'ready') expect(first.value.items).toHaveLength(linked.length);
    if (second.status === 'ready') expect(second.value.items).toHaveLength(linked.length);
    const sessionKeys = fixture.spy.readMany.flat().filter(key => JSON.parse(key).aggregateType === 'Session');
    expect(new Set(sessionKeys.map(key => JSON.parse(key).sessionId))).toEqual(ids(fixture, ...linked));
  });

  it('binds page cursors to actor, target, role and archive filter', async () => {
    const f = await make(kind);
    await f.adopt('cursor-adopt');
    const target = moduleTarget(f, GRAPH_MODULE_ONE);
    for (let i = 0; i < 2; i++) await link(f, await f.createSession(`cursor-${i}`), target, 'responsible', `cursor-link-${i}`);
    const first = await findTarget(f, target, false, 1);
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.value.nextCursor).not.toBeNull();
    const page = { limit: 1, cursor: first.value.nextCursor! };
    const base = { workspace: f.scope, target, includeArchived: false, page };
    for (const changed of [
      { ...base, target: moduleTarget(f, GRAPH_MODULE_TWO) },
      { ...base, includeArchived: true },
      { ...base, role: { kind: 'legacy_template' as const, templateId: 'other', templateRevision: '1' } },
    ]) expect(await f.sessionsPort.findSessions(f.ctx, changed)).toMatchObject({ status: 'rejected', code: 'invalid' });
    const actor = { kind: 'human' as const, id: 'other-reader' };
    const other = { ...f.ctx, principal: { kind: 'host' as const, actor },
      materialReader: { kind: 'host' as const, ...f.scope, actor } };
    expect(await f.sessionsPort.findSessions(other, base)).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('preserves the non-target workspace directory semantics', async () => {
    const fixture = await make(kind);
    await fixture.adopt('adopt-nontarget');
    const first = await fixture.createSession('nontarget-a');
    const second = await fixture.createSession('nontarget-b');
    const page = await fixture.sessionsPort.findSessions(fixture.ctx,
      { workspace: fixture.scope, includeArchived: false, page: { limit: 10 } });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') return;
    const returned = new Set(page.value.items.map(card => card.record.ref.sessionId));
    expect(returned).toEqual(ids(fixture, first, second));
  });
});
