/**
 * Slice 4C F-06 (§11.2): the caller_task related-first find through the real
 * `platform.notes` read port and the C2.2 Run resolver. The work Run omits
 * `related`, so the read model resolves its own task; `related: null` and an
 * `anchor` switch segmentation off; an explicit missing task is
 * `not_found`/`related_not_found`.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { MemoryFindRequest, NoteMemoryReadPort } from '../../src/core/work-graph/model/note-contracts.js';
import { createS4ANoteFixture, type S4ANoteFixture } from '../helpers/S4A-note-fixture.js';

const KINDS = ['memory', 'sqlite'] as const;

function draft(anchor: NoteDraftV1['anchor'], topic: string): NoteDraftV1 {
  return { kind: 'convention', topic, conclusion: `${topic} conclusion`, anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: 'body' };
}

function findRequest(overrides: Partial<MemoryFindRequest> = {}): MemoryFindRequest {
  return { v: 1, op: 'find', limit: 20, cursor: null, ...overrides };
}

async function seed(f: S4ANoteFixture): Promise<{ t1: string; goal: string; t2: string }> {
  const goalId = f.goalRef.goalId;
  const t1 = await f.write(f.ctx(), draft({ kind: 'task', goalId, taskId: 't1' }, 'task one'), goalId,
    { commandId: 'f6-t1' });
  const goal = await f.write(f.ctx(), draft({ kind: 'goal', goalId }, 'the goal'), goalId, { commandId: 'f6-goal' });
  const t2 = await f.write(f.ctx(), draft({ kind: 'task', goalId, taskId: 't2' }, 'task two'), goalId,
    { commandId: 'f6-t2' });
  const ids: string[] = [];
  for (const result of [t1, goal, t2]) {
    if (result.status !== 'accepted') throw new Error(`F-06 seed failed: ${JSON.stringify(result)}`);
    ids.push(result.noteId);
  }
  return { t1: ids[0]!, goal: ids[1]!, t2: ids[2]! };
}

describe('S4C F-06 caller_task related-first find', () => {
  it.each(KINDS)('F-06 %s a work Run omitting related segments around its own task; related:null adds no segments', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const ids = await seed(f);
      const run = await f.claimRun('f6', 't1');
      const memory = f.notes as unknown as NoteMemoryReadPort;
      const auto = await memory.memoryFind(f.workCtx(run), findRequest());
      expect(auto.status).toBe('ready');
      if (auto.status !== 'ready') return;
      expect(auto.value.related?.node).toMatchObject({ kind: 'task', goalId: f.goalRef.goalId, taskId: 't1', planRevision: 1 });
      const segmentOf = (noteId: string): string | undefined =>
        auto.value.items.find(item => item.noteId === noteId)?.segment;
      expect(segmentOf(ids.t1)).toBe('related');
      expect(segmentOf(ids.goal)).toBe('related');
      expect(segmentOf(ids.t2)).toBe('project');
      const off = await memory.memoryFind(f.workCtx(run), findRequest({ related: null }));
      expect(off.status).toBe('ready');
      if (off.status !== 'ready') return;
      expect(off.value.related).toBeUndefined();
      expect(off.value.boundary).toBeUndefined();
      for (const item of off.value.items) expect(item.segment).toBeUndefined();
    } finally { await f.close(); }
  });

  it.each(KINDS)('F-06 %s an anchor scopes the find and adds no segments', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const ids = await seed(f);
      const run = await f.claimRun('f6a', 't1');
      const memory = f.notes as unknown as NoteMemoryReadPort;
      const result = await memory.memoryFind(f.workCtx(run),
        findRequest({ anchor: { kind: 'goal', goalId: f.goalRef.goalId } }));
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.value.related).toBeUndefined();
      expect(result.value.boundary).toBeUndefined();
      expect(result.value.items.map(item => item.noteId)).toContain(ids.goal);
      for (const item of result.value.items) expect(item.segment).toBeUndefined();
    } finally { await f.close(); }
  });

  it.each(KINDS)('F-06 %s an explicit task that does not exist is related_not_found', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      await seed(f);
      const run = await f.claimRun('f6m', 't1');
      const memory = f.notes as unknown as NoteMemoryReadPort;
      const result = await memory.memoryFind(f.workCtx(run),
        findRequest({ related: { kind: 'task', goalId: f.goalRef.goalId, taskId: 'no-such-task' } }));
      expect(result).toMatchObject({ status: 'rejected', code: 'not_found', reason: 'related_not_found' });
    } finally { await f.close(); }
  });
});
