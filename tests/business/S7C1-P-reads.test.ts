/**
 * Book §5 `P-reads` (`book-7c.md:1368`; §3.2 items 4–5 `:364–374`): paged reads, the A-06 incomplete wait, the A-10
 * task-link failure and the targeted responsible card.
 *
 * The paging rows are storage rows and run on memory and SQLite: 51 real Sessions (page 1's 50 carry one real
 * archive request, so the single idle last entry is only decisive on page 2). The 401-Session bound row lives in
 * the scale file.
 *
 * The faults are A2 wrappers over the real ports and run on memory: an armed facts read excludes with `waits` and an
 * armed task-target page returns `waiting` + `task_links` instead of picking. The `listWorkLines` fault arm is
 * BLOCKED: with the frozen required `PickReadsV1.activity.record` there is no real record reader in this Host, and
 * no stand-in is built (L1 supplies it later).
 */
import { describe, expect, it } from 'vitest';
import type { MemberRequestResultV1 } from '../../src/core/work-graph/tasks/member-service.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { readGoal } from '../helpers/A2-restart-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, WORKFLOW } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { jsonOf, openS7C1World, startS7C1ToolLine } from '../helpers/S7C-member-fixture.js';
import { ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import {
  openS7C1Chooser, openS7C1DirectoryDelta, pickChooser, pickOwned,
} from '../helpers/S7C1-p-directory-delta.js';
import { openS7C1PagingWorld } from '../helpers/S7C1-p-paging-world.js';

const pickSessionKeyOf = (card: { record: { ref: { projectId: string; sessionId: string } } }): string =>
  plainSessionRefKey(card.record.ref);

describe.each(['memory', 'sqlite'] as const)('P-reads: paging on %s (book-7c.md:1368)', backend => {
  it('page 2: page 1 is fully excluded and the actual page-2 remainder is the winner', async () => {
    const world = await openS7C1PagingWorld({ backend, mode: 'page_two' });
    try {
      if (world.pageTwo === null) throw new Error('P-reads: the page-two mode recorded no pages');
      const { chooser, goal, owned, binding } = await openS7C1Chooser(world);
      const result = await chooser.chooseSession(owned, goal, binding, null, null);
      expect(result.kind).toBe('reuse');
      if (result.kind !== 'reuse') throw new Error(`P-reads: the chooser did not reuse: ${JSON.stringify(result)}`);

      // Page 1 held the 50 lower keys (all archive-requested, hence un-reusable); page 2 held only the last.
      expect(world.pageTwo.first.items.map(pickSessionKeyOf)).toEqual(world.page.keys.slice(0, 50));
      expect(world.pageTwo.second.items.map(pickSessionKeyOf)).toEqual([world.page.keys.at(-1)]);
      expect(world.pageTwo.first.nextCursor).not.toBeNull();
      expect(world.pageTwo.second.nextCursor).toBeNull();

      expect(pickSessionKeyOf(result.card)).toBe(world.page.keys.at(-1));
      expect(result.basis.candidates).toBe(1);
      expect(result.basis.rank).toBe('none');
      expect(result.basis.incomplete).toEqual([]);
    } finally {
      await world.close();
    }
  });
});

describe('P-reads: the incomplete wait (book-7c.md:1368)', () => {
  it('a nine-hop chain is incomplete: the sender is not reused and the basis names waits (A-06)', async () => {
    const world = await openS7C1DirectoryDelta({ backend: 'memory' });
    try {
      const sender = world.delta.wait.sender;
      const facts = ready<SessionFactsV1>(await world.world.post('sessions/facts',
        plain(S6A_SCOPE, sender.ref)), 'the nine-hop wait facts');
      expect(facts.waits.some(wait => wait.complete === false)).toBe(true);

      const chooser = pickChooser(world.world);
      const goal = await readGoal(world.world.ag2b, world.delta.wait.goal);
      const result = await chooser.chooseSession(pickOwned(world.world), goal, WORKFLOW.bindings[0]!, null, null);
      expect(result.kind).toBe('reuse');
      if (result.kind !== 'reuse') throw new Error(`P-reads: the incomplete wait picked nothing: ${JSON.stringify(result)}`);
      expect(plainSessionRefKey(result.card.record.ref)).not.toBe(plainSessionRefKey(sender.ref));
      // The incomplete chain is never an empty wait set: the mark and its source survive into the basis.
      expect(result.basis.incomplete).toContain('waits');
    } finally {
      await world.close();
    }
  });
});

describe('P-reads: read failures on memory (book-7c.md:1368)', () => {
  it('an armed facts failure excludes the only card with `waits` and never reuses it (A-06)', async () => {
    const world = await openS7C1PagingWorld({ backend: 'memory', mode: 'single' });
    try {
      const { chooser, goal, owned, binding } = await openS7C1Chooser(world);
      world.faults.arm('facts');
      const result = await chooser.chooseSession(owned, goal, binding, null, null);
      expect(result.kind).toBe('create');
      if (result.kind !== 'create') throw new Error(`P-reads: the facts failure picked: ${JSON.stringify(result)}`);
      expect(result.basis).toEqual({ rank: 'none', incomplete: ['waits'], candidates: 0 });
    } finally {
      await world.close();
    }
  });

  it('a failed responsible-link page returns waiting + task_links, never a pick (A-10)', async () => {
    const world = await openS7C1PagingWorld({ backend: 'memory', mode: 'single' });
    try {
      const main = s6aCardsWorkspace(world.world, S6A_SCOPE);
      await governS6B(world.world, main, world.world.goals);
      const { tasks } = await adoptS6BPlan(main, world.world.goals.first, {
        label: 's7c1-p-link', taskIds: ['s7c1-p-link-task'], role: S6A_WORK_ROLE.templateId });
      const { chooser, goal, owned, binding } = await openS7C1Chooser(world);
      world.faults.arm('link');
      const result = await chooser.chooseSession(owned, goal, binding, null, tasks[0]!);
      expect(result.kind).toBe('waiting');
      if (result.kind !== 'waiting') throw new Error(`P-reads: the failed link read picked: ${JSON.stringify(result)}`);
      expect(result.basis).toEqual({ rank: 'none', incomplete: ['task_links'], candidates: 0 });
      expect('card' in result).toBe(false);
    } finally {
      await world.close();
    }
  });
});

describe('P-reads: the targeted responsible card (book-7c.md:1368)', () => {
  it('a refused authorization excludes the targeted responsible line (P-01)', async () => {
    const world = await openS7C1World();
    try {
      await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
      const task = world.tasks[2]!;
      // A REAL Work child line: the tool-bearing Work Run creates it through `create_member`. Its delegation
      // ceiling is the creator's envelope (`writeScope: []`), while its own executor binding grants `['.']`,
      // so the real pre-claim authorization refuses it (a refusal excludes without an `incomplete` mark).
      await startS7C1ToolLine(world, { task });
      const caller = world.lines.adviser;
      if (caller === null) throw new Error('P-reads: the world was opened without its adviser caller line');
      const created = jsonOf(await world.world.scripted.requests(caller), 's7c-tool-call') as MemberRequestResultV1;
      if (created.status !== 'created') throw new Error(`P-reads: no Work child line: ${JSON.stringify(created)}`);
      const child = await world.world.readSession(created.session);
      expect(child.record.delegationCeiling?.writeScope).toEqual([]);
      expect(child.record.occupancy).toBeNull();

      const answer = await world.world.post('workflow/advance', plain(S6A_SCOPE, {
        schemaVersion: 1, goalRef: world.goal, flowId: 's7c1-p-refused', sessionHint: null,
        kind: 'select_work', taskId: task.taskId,
      }));
      const body = answer.body as { status: string; value?: { state: string; next: { kind: string;
        taskId?: string; operation?: { kind: string } } | null;
        pick: { rank: string; incomplete: readonly string[]; candidates: number } | null } };
      if (body.status !== 'ready' || body.value === undefined) {
        throw new Error(`P-reads: the refused-authorization advance was not ready: ${JSON.stringify(body)}`);
      }
      expect(body.value.pick).toEqual({ rank: 'none', incomplete: [], candidates: 0 });
      expect(body.value.next).toMatchObject({ kind: 'perform', taskId: task.taskId,
        operation: { kind: 'suggest_member' } });
      expect((await world.world.readSession(created.session)).record.occupancy).toBeNull();
    } finally {
      await world.close();
    }
  });

  it('a sole targeted card survives a page-1 failure and its rank is none (P-01)', async () => {
    const world = await openS7C1PagingWorld({ backend: 'memory', mode: 'single' });
    try {
      const only = world.page.sessions[0]!;
      await world.world.archive(only);
      const main = s6aCardsWorkspace(world.world, S6A_SCOPE);
      await governS6B(world.world, main, world.world.goals);
      const { tasks } = await adoptS6BPlan(main, world.world.goals.first, {
        label: 's7c1-pnone', taskIds: ['s7c1-pnone-task'], role: S6A_WORK_ROLE.templateId });
      const line = await createS6BLine(main, { label: 's7c1-pnone-line', role: S6A_WORK_ROLE, tasks: [tasks[0]!] });
      const session = await sessionOf(world.world, line);

      const chooser = pickChooser(world.world, {
        sessions: world.directory, sessionFacts: world.facts,
      });
      const goal = await readGoal(world.world.ag2b, world.world.goals.first);
      world.faults.arm('page');
      const result = await chooser.chooseSession(pickOwned(world.world), goal, WORKFLOW.bindings[0]!, null, tasks[0]!);
      expect(result.kind).toBe('reuse');
      if (result.kind !== 'reuse') throw new Error(`P-reads: the targeted card was not reused: ${JSON.stringify(result)}`);
      expect(plainSessionRefKey(result.card.record.ref)).toBe(plainSessionRefKey(session.ref));
      expect(result.basis.candidates).toBe(1);
      expect(result.basis.rank).toBe('none');
      expect(result.basis.incomplete).toContain('directory');
    } finally {
      await world.close();
    }
  });
});
