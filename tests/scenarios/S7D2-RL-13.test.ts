/**
 * RL-13 (`7d2-start-rulings.v4.md:8851`, read per `later-rows-merged.md:201–:203`; v4 §3.2 item 6 `:3255`; book
 * §3.4 `:401–:416`): an adviser line splits a child region off through the real `propose_role_split`; at the open cap
 * one idle line is reclaimed first; a too-long line with no strict subrange is handed off to an adviser, a too-slow
 * one is left alone; a split resumes after a crash at each phase and never makes a second line.
 *
 * World: `openS7D2ProjectWorld` (tests/helpers/S7D2-role-line-world.ts) with `scribeReminderPeriodMs: 25` on every
 * Host start (the Host idle cycle) and, where the tool is called, `adviserTools` with `propose_role_split` added to the
 * world's three. The row's lines:
 * - L1 = `regionAdviser`: region `src`, whose known children are `src/a` and `src/b` (`s7d2Catalog`);
 * - L3 = `tooLong`: goal 2 alone (no strict subrange); the newest request of its one Work Run reports 160,000 input
 *   tokens, at `min(500,000, floor(0.8 × 200,000))` (`S7D2_TOO_LONG_INPUT_TOKENS`);
 * - L4 = an adviser this file opens with `role-lines/open {duty:'adviser',scope:[goal 1]}` (no strict subrange);
 * - L2 is not opened (no strict subrange, nothing happens; L3 and L4 cover it); L5 (unknown burden) is RL-14's
 *   `ownership_ambiguous` cell, not a world of this file.
 * A tool Run is a scripted Work Run of L1 on a Task of goal 1's one adopted Plan (goal 2's is L3's), linked to L1.
 *
 * Reads (the merged reading): `role-lines/operations` (the split row is the `role_line` row whose one step is
 * `split`); `sessions/operation` of that row for the saved body `action.split` and the `failure`, and of the step's
 * child create for the new line (`plannedSessionRef`); `sessions/read`; `sessions/successors`;
 * `role-lines/allocation`. `role-lines/read` and the burden it shows are O5b-R2's.
 *
 * Expected (by hand from the row): A — the call with L1's whole scope is
 * `{status:'rejected',code:'invalid',reason:'the move is not a strict subrange of the caller line'}` and writes no
 * operation; the `src/a` call is accepted, its one operation runs `planned → admitted → created → linked → done`
 * (outer `completed`, `result:{status:'done',reason:null}`), the saved body is `{source:L1, move:[region src/a],
 * keep:[region src], reason:'agent_proposal'}`, the new line has L1's role and the open `src/a` link, L1 keeps `src`
 * (a moved child region leaves the parent in `keep`, v4 :2492–:2494), and a later call with the same move is the same
 * operation and no second line. B — at the cap with no idle line the call is the literal `capacity` refusal with
 * `detail:{duty:'adviser',holders:N,reservations:0,open:N,episode:null}` and the row ends failed with that failure; with
 * one idle standby line it is reclaimed (archived), the split is accepted and ends done, the holders stay N. C — one
 * maintenance page hands L3 off (successor provenance `handoff` from L3, an adviser holder) and leaves L4: no
 * successor, no split, its goal link open. D — a crash after the `planned`, `admitted`, `created`, `linked` write, or
 * after the child's reservation with the cap then full, resumes on the new Host to `done` with one new line; a crash
 * before the `linked` move after L1 lost `src` ends the split `failed` with
 * `{code:'not_found',reason:'the split source no longer holds the kept region'}`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { RoleLineAllocationReportV1 } from '../../src/contracts/role-lines.js';
import type {
  RoleLineOperationV1, SessionCreateOperationRecord, SessionPage,
} from '../../src/core/work-graph/model/session-contracts.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { adoptPLMixedPlan } from '../helpers/PL-consumption-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ABackend } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import {
  freezeS7D2SplitAfter, holdS7D2SplitReserved, linkS7D2Scopes, openS7D2ProjectWorld, openTargetsOf,
  runS7D2Work, type S7D2ProjectWorld,
} from '../helpers/S7D2-role-line-world.js';
import { waitFor } from './harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D2ProjectWorld[] = [];
afterEach(async () => {
  const unreleased = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(unreleased).toEqual([]);
});

type SplitRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;

const SPLIT_TOOLS = ['read', 'send_session_message', 'create_member', 'propose_role_split'] as const;
const NOT_STRICT = 'the move is not a strict subrange of the caller line';
const REASON = 'RL-13: src/a carries a burden of its own';

async function openWorld(backend: S6ABackend, tools: boolean): Promise<S7D2ProjectWorld> {
  const handle = await openS7D2ProjectWorld({ backend, extraHostOptions: { scribeReminderPeriodMs: 25 },
    ...(tools ? { adviserTools: SPLIT_TOOLS } : {}) });
  worlds.push(handle);
  return handle;
}

/** The split rows of `role-lines/operations`: the `role_line` rows whose one step is `split`. */
const splitRows = (rows: readonly RoleLineOperationReadV1[]): SplitRow[] => rows.filter((row): row is SplitRow =>
  row.action === 'role_line' && row.steps.map(step => step.key).join(',') === 'split');

/** `sessions/operation` of an operation ref a public read returned. */
async function operationOf<T>(handle: S7D2ProjectWorld, ref: OperationRef): Promise<T> {
  return valueOf<T>(await handle.main.route('sessions/operation', ref), 'ready', `the operation ${ref.operationId}`);
}

/** The split's new line: the `plannedSessionRef` of its one step's child create. */
async function newLineOf(handle: S7D2ProjectWorld, row: SplitRow): Promise<SessionRef> {
  const child = row.steps[0]?.childOperation ?? null;
  if (child === null) throw new Error(`RL-13: the split names no child create: ${JSON.stringify(row)}`);
  return (await operationOf<SessionCreateOperationRecord>(handle, child)).action.plannedSessionRef;
}

/** Polls `role-lines/operations` until the one split row has ended (outer `completed` or `failed`). */
async function splitEnd(handle: S7D2ProjectWorld): Promise<SplitRow> {
  const rows = await waitFor(async () => splitRows(await handle.operations()),
    found => found.some(row => row.phase === 'completed' || row.phase === 'failed'), 'the split to end');
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function successorsOf(handle: S7D2ProjectWorld, line: SessionRef): Promise<SessionRecord[]> {
  return valueOf<SessionPage<SessionRecord>>(await handle.main.route('sessions/successors',
    { sessionRef: line, page: { limit: 10 } }), 'ready', `the successors of ${line.sessionId}`).items;
}

const refOfRecord = (record: SessionRecord): SessionRef =>
  ({ projectId: record.ref.projectId, sessionId: record.ref.sessionId });

/** How many times `line` is among the adviser holders. */
const holdings = (allocation: RoleLineAllocationReportV1, line: SessionRef): number =>
  allocation.duties.adviser.holders.filter(holder => holder.session.sessionId === line.sessionId).length;

/** One `workflow/advance` (`select_work` on goal 2, whose one Task already ran): the maintenance page runs first. */
async function advance(handle: S7D2ProjectWorld, label: string): Promise<void> {
  await handle.main.route('workflow/advance', { schemaVersion: 1, goalRef: handle.world.goals.second,
    flowId: `s7d2-rl13-${label}`, sessionHint: null, kind: 'select_work' });
}

/** "Wait for L3's successor": one advance, then `sessions/successors` of L3 until it names one. */
async function l3Successor(handle: S7D2ProjectWorld, label: string): Promise<SessionRecord> {
  await advance(handle, `${label}-l3`);
  const l3 = handle.tooLong.line.ref;
  const [successor] = await waitFor(() => successorsOf(handle, l3), items => items.length > 0, 'the successor of L3');
  expect(successor!.provenance).toEqual({ schemaVersion: 1, kind: 'handoff', from: l3 });
  return successor!;
}

/** Goal 1's one Plan: `taskIds` assigned to L1's role, each linked to L1. */
async function planOnL1(handle: S7D2ProjectWorld, label: string, taskIds: readonly string[]): Promise<TaskTriple[]> {
  const l1 = handle.regionAdviser;
  if (l1.role.kind !== 'legacy_template') throw new Error(`RL-13: L1 has no template role: ${JSON.stringify(l1.role)}`);
  const role = l1.role.templateId;
  const { tasks } = await adoptPLMixedPlan(handle.world, { goal: handle.goal, label,
    tasks: taskIds.map(taskId => ({ taskId, role })) });
  await linkS7D2Scopes(handle.world, { line: l1, label: `${label}-tasks`,
    targets: tasks.map(ref => ({ kind: 'task' as const, ref })) });
  return [...tasks];
}

/** One `propose_role_split` call moving region `moduleId`. */
const splitCall = (callId: string, moduleId: string) => ({ callId, name: 'propose_role_split',
  args: { move: [{ kind: 'region', moduleRef: { projectId: S6A_SCOPE.projectId, moduleId } }], reason: REASON } });

/** One real Work Run of L1 on `task`: one model reply per tool call, then a text. */
function splitRun(handle: S7D2ProjectWorld, task: TaskTriple, label: string,
  calls: readonly ReturnType<typeof splitCall>[]): Promise<unknown> {
  const replies: S6AReply[] = [...calls.map((call): S6AReply => ({ kind: 'calls', calls: [call] })),
    { kind: 'text', text: `RL-13 ${label} done` }];
  return runS7D2Work(handle.world, { line: handle.regionAdviser, goal: handle.goal, task, label, replies });
}

/** The tool's own result for `callId`, as the Runtime served it to L1's model. */
const resultOf = async (handle: S7D2ProjectWorld, callId: string): Promise<unknown> =>
  jsonOf(await handle.world.scripted.requests(handle.regionAdviser), callId);

/** The saved body of L1's split of `src/a` (v4 :2519–:2523; `keep` is L1's scope minus the move). */
const splitBody = (handle: S7D2ProjectWorld) => ({ source: handle.regionAdviser.ref,
  move: [{ kind: 'region', moduleRef: handle.modules.child }],
  keep: [{ kind: 'region', moduleRef: handle.modules.region }], reason: 'agent_proposal' });

describe('RL-13 A: propose_role_split', () => {
  /*
   * Named mutation (v4 :8851, :3255): `planRoleLineSplit` accepts a non-strict subrange (`move` the whole scope,
   * `keep` empty) -> the first call's `toEqual` (the `invalid` refusal) turns red. L1 holds only region `src`, so the
   * move of `src` is stopped by two checks at once, "`keep` non-empty" and "a region strictly inside its parent
   * (parent !== child)"; the mutation must open both for the row to turn red.
   */
  it('RL-13 A (memory): the whole scope is refused, the child region splits off once, a replay is the same operation',
    async () => {
      const handle = await openWorld('memory', true);
      const l1 = handle.regionAdviser;
      const [first, second] = await planOnL1(handle, 's7d2-rl13-a', ['rl13-a-1', 'rl13-a-2']);
      await splitRun(handle, first!, 'rl13-a-1', [splitCall('rl13-a-whole', 'src'), splitCall('rl13-a-child', 'src/a')]);
      expect(await resultOf(handle, 'rl13-a-whole')).toEqual({ status: 'rejected', code: 'invalid', reason: NOT_STRICT });
      const accepted = await resultOf(handle, 'rl13-a-child') as { operation: OperationRef };
      expect(accepted).toMatchObject({ status: 'accepted', operation: expect.any(Object), revision: expect.any(Number) });
      // The refused call wrote no operation: the one split row is the accepted call's.
      expect(splitRows(await handle.operations()).map(row => row.operation)).toEqual([accepted.operation]);

      const end = await splitEnd(handle);
      expect(end).toMatchObject({ phase: 'completed', actionPhase: 'done', result: { status: 'done', reason: null } });
      expect(end.steps.map(step => step.key)).toEqual(['split']);
      const child = end.steps[0]!.childOperation;
      expect(child).not.toBeNull();
      expect((await operationOf<RoleLineOperationV1>(handle, end.operation)).action.split).toEqual(splitBody(handle));

      const line = await newLineOf(handle, end);
      const card = await handle.readCard(line);
      expect(card.record.role).toEqual((await handle.readCard(l1)).record.role);
      expect(card.record.lifecycle).toBe('active');
      expect(openTargetsOf(card).filter(target => target.kind === 'module'))
        .toEqual([{ kind: 'module', ref: handle.modules.child }]);
      expect(openTargetsOf(await handle.readCard(l1)).filter(target => target.kind === 'module'))
        .toEqual([{ kind: 'module', ref: handle.modules.region }]);
      const allocation = await handle.allocation();
      expect(holdings(allocation, line)).toBe(1);
      expect(allocation.duties.adviser.reservations
        .filter(reservation => reservation.operationRef.operationId === child?.operationId)).toEqual([]);

      // The same move again, from a new tool call on a Task not run yet: the same operation, no second line.
      await splitRun(handle, second!, 'rl13-a-2', [splitCall('rl13-a-replay', 'src/a')]);
      expect(await resultOf(handle, 'rl13-a-replay')).toMatchObject({ status: 'accepted', operation: accepted.operation });
      const again = splitRows(await handle.operations());
      expect(again.map(row => row.operation)).toEqual([accepted.operation]);
      expect(again[0]!.steps[0]!.childOperation).toEqual(child);
      expect((await handle.findByTarget({ kind: 'module', ref: handle.modules.child }))
        .filter(found => openTargetsOf(found).some(target => target.kind === 'module'
          && target.ref.moduleId === handle.modules.child.moduleId))
        .map(found => found.record.ref.sessionId)).toEqual([line.sessionId]);
    }, 300_000);
});

describe('RL-13 B: at the open cap', () => {
  /**
   * The prior of both cells: goal 1's Plan with one Task on L1, L3's successor, one person inquiry each for the opening
   * adviser, L3 and its successor (so none is idle; L1 is occupied by its own tool call), with `standby` an idle
   * adviser S (`role-lines/open` on `[]`, no link, no message); then N = the adviser holders, no reservation, and
   * `open.adviser = N`.
   */
  async function atCap(handle: S7D2ProjectWorld, label: string, standby: boolean) {
    const [task] = await planOnL1(handle, label, [`${label}-1`]);
    const successor = await l3Successor(handle, label);
    const s = standby ? await handle.lineOf(`${label}-standby`, (await handle.open({ duty: 'adviser', scope: [],
      requestId: `${label}-standby` })).result) : null;
    const busy = [handle.lines.adviser.ref, handle.tooLong.line.ref, refOfRecord(successor)];
    for (const [index, recipient] of busy.entries()) {
      await sendS7A2PersonMessage(handle.world, { label: `${label}-busy-${String(index)}`, recipient });
    }
    const before = await handle.allocation();
    expect(before.duties.adviser.reservations).toEqual([]);
    const n = before.duties.adviser.holders.length;
    await handle.setOpen('adviser', n, `${label}-cap`);
    return { task: task!, busy, standby: s, n };
  }

  it('RL-13 B1 (memory): with no idle line the call is the at-cap refusal and the split ends failed', async () => {
    const handle = await openWorld('memory', true);
    const { task, busy, n } = await atCap(handle, 's7d2-rl13-b1', false);
    await splitRun(handle, task, 'rl13-b1', [splitCall('rl13-b1-split', 'src/a')]);
    const reason = `at_cap: adviser has ${String(n)} holder(s) and 0 reservation(s) against open limit ${String(n)}`;
    expect(await resultOf(handle, 'rl13-b1-split')).toEqual({ status: 'rejected', code: 'capacity', reason,
      detail: { duty: 'adviser', holders: n, reservations: 0, open: n, episode: null } });
    const rows = splitRows(await handle.operations());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phase: 'failed' });
    expect((await operationOf<RoleLineOperationV1>(handle, rows[0]!.operation)).failure).toEqual({ code: 'capacity', reason });
    const after = await handle.allocation();
    expect(after.duties.adviser.holders).toHaveLength(n);
    expect(after.duties.adviser.reservations).toEqual([]);
    for (const line of busy) expect((await handle.readCard(line)).record.lifecycle).toBe('active');
  }, 300_000);

  /* Named mutation: the reclaim before the at-cap refusal (the catalog admission's one attempt) is removed -> B2 is
   * refused `capacity`, and its `accepted` assertion turns red. */
  it('RL-13 B2 (memory): one idle line is reclaimed, then the split is admitted', async () => {
    const handle = await openWorld('memory', true);
    const { task, n, standby } = await atCap(handle, 's7d2-rl13-b2', true);
    await splitRun(handle, task, 'rl13-b2', [splitCall('rl13-b2-split', 'src/a')]);
    expect(await resultOf(handle, 'rl13-b2-split')).toMatchObject({ status: 'accepted' });
    expect((await handle.readCard(standby!)).record.lifecycle).toBe('archived');
    const end = await splitEnd(handle);
    expect(end).toMatchObject({ phase: 'completed', actionPhase: 'done' });
    const after = await handle.allocation();
    expect(after.duties.adviser.holders).toHaveLength(n);
    expect(holdings(after, standby!.ref)).toBe(0);
    expect(holdings(after, await newLineOf(handle, end))).toBe(1);
    expect(after.duties.adviser.reservations).toEqual([]);
  }, 300_000);
});

describe('RL-13 C: the maintenance page', () => {
  /* Named mutation: the too-long handoff still creates a secretary successor (the handoff entry's assignment keeps
   * `duty: 'secretary'`) -> the successor is no adviser holder and that assertion turns red. Also: a too-slow line
   * handed off as well -> L4 has a successor, red. */
  it('RL-13 C (memory): one page hands the too-long L3 off to an adviser and leaves the too-slow L4', async () => {
    const handle = await openWorld('memory', false);
    const l3 = handle.tooLong.line;
    const l4 = await handle.lineOf('s7d2-rl13-c-l4', (await handle.open({ duty: 'adviser',
      scope: [{ kind: 'goal', goalRef: handle.goal }], requestId: 's7d2-rl13-c-l4' })).result);
    // 11 consumable inquiries; the stretch starts at the 11th (>10), and 1,800,000 ms later it is too slow.
    for (let index = 1; index <= 11; index += 1) {
      await sendS7A2PersonMessage(handle.world, { label: `rl13-c-slow-${String(index)}`, recipient: l4.ref });
    }
    handle.world.clock.advance(1_800_000);
    const rowsBefore = splitRows(await handle.operations());
    const l3Before = await successorsOf(handle, l3.ref);

    await advance(handle, 'c');
    const settled = handle.world.consumeBarrier();
    handle.world.clock.advance(25);
    await settled;

    const successors = await waitFor(() => successorsOf(handle, l3.ref), items => items.length > 0,
      `the successor of L3 (before the page: ${JSON.stringify(l3Before)})`);
    expect(successors).toHaveLength(1);
    expect(successors[0]!.provenance).toEqual({ schemaVersion: 1, kind: 'handoff', from: l3.ref });
    expect(holdings(await handle.allocation(), refOfRecord(successors[0]!))).toBe(1);
    expect(splitRows(await handle.operations())).toEqual(rowsBefore);
    expect(await successorsOf(handle, l4.ref)).toEqual([]);
    expect(openTargetsOf(await handle.readCard(l4))).toEqual([handle.targets.goal]);
  }, 300_000);
});

describe('RL-13 D: a crash in the split', () => {
  /** The prior of every cell: goal 1's Plan with one Task on L1, L3's successor; the adviser holders then. */
  async function beforeSplit(handle: S7D2ProjectWorld, label: string): Promise<{ task: TaskTriple; holders: number }> {
    const [task] = await planOnL1(handle, label, [`${label}-1`]);
    await l3Successor(handle, label);
    return { task: task!, holders: (await handle.allocation()).duties.adviser.holders.length };
  }

  /** L1's split Run, not awaited: the crash leaves it to the abandoned Host, so it settles only after its release. */
  const startSplit = (handle: S7D2ProjectWorld, task: TaskTriple, label: string): Promise<unknown> =>
    splitRun(handle, task, label, [splitCall(`${label}-split`, 'src/a')]).catch((error: unknown) => error);

  /** The new Host's end: `done`, the saved body, one new line, one more adviser holder than before the split. */
  async function expectResumed(handle: S7D2ProjectWorld, holders: number): Promise<void> {
    const end = await splitEnd(handle);
    expect(end).toMatchObject({ phase: 'completed', actionPhase: 'done' });
    expect((await operationOf<RoleLineOperationV1>(handle, end.operation)).action.split).toEqual(splitBody(handle));
    const line = await newLineOf(handle, end);
    expect((await handle.readCard(line)).record.lifecycle).toBe('active');
    const after = await handle.allocation();
    expect(after.duties.adviser.holders).toHaveLength(holders + 1);
    expect(holdings(after, line)).toBe(1);
    expect(after.duties.adviser.reservations).toEqual([]);
  }

  /*
   * Named mutation (D1–D4; landed O1b code, checked by the lead on the merged tree): the resume re-plans from the live
   * line instead of the saved body -> a second line or another body, red.
   * The stop is `freezeS7D2SplitAfter` (lead 11-04 O2b-RW1 ruling): after the held write no later commit of the split
   * lands on the old Host, so the tool call and the Host's lifecycle queue cannot move it on before the read and the
   * crash. At the hold the outer phase is `accepted` for `planned` and `admitted` (the split has not acted yet; lead
   * 11-04 O2b-RW1 ruling) and `running` for `created` and `linked`.
   */
  it.each(['planned', 'admitted', 'created', 'linked'] as const)(
    'RL-13 D (sqlite): a crash after the %s write resumes at the first unfinished phase', async state => {
      const handle = await openWorld('sqlite', true);
      const label = `s7d2-rl13-d-${state}`;
      const { task, holders } = await beforeSplit(handle, label);
      const held = freezeS7D2SplitAfter(state);
      const run = startSplit(handle, task, label);
      await held.reached;
      const atHold = splitRows(await handle.operations());
      expect(atHold).toHaveLength(1);
      expect(atHold[0]).toMatchObject({ actionPhase: state,
        phase: state === 'planned' || state === 'admitted' ? 'accepted' : 'running' });
      held.stopMatching();
      await handle.world.crash();
      await expectResumed(handle, holders);
      held.release();
      await run;
    }, 300_000);

  /* Named mutation (O1B-R1-04; landed O1b code): the resume drives as the restarting side, not as the restored
   * creator -> D5 ends failed `capacity` with the reservation left, red. */
  it('RL-13 D5 (sqlite): a crash after the child reservation filled the cap resumes as the creator', async () => {
    const handle = await openWorld('sqlite', true);
    const { task, holders } = await beforeSplit(handle, 's7d2-rl13-d5');
    await handle.setOpen('adviser', holders + 1, 's7d2-rl13-d5-cap');
    const held = holdS7D2SplitReserved();
    const run = startSplit(handle, task, 's7d2-rl13-d5');
    await held.reached;
    await handle.world.crash();
    await expectResumed(handle, holders);
    held.release();
    await run;
  }, 300_000);

  /* Named mutation (O1B-R1-03; landed O1b code): the move regroups by who holds now -> the new line opens `src/a`,
   * red. */
  it('RL-13 D6 (sqlite): L1 loses src before the held move, and the restart ends the split not_found', async () => {
    const handle = await openWorld('sqlite', true);
    const { task, holders } = await beforeSplit(handle, 's7d2-rl13-d6');
    // lead 11-04 (stack1): the D1–D4 freeze, so the Host's lifecycle queue cannot write the held move either.
    const held = freezeS7D2SplitAfter('created');
    const run = startSplit(handle, task, 's7d2-rl13-d6');
    await held.reached;
    expect((await handle.changeScope({ session: handle.regionAdviser, scope: [], requestId: 's7d2-rl13-d6-drop-src' }))
      .result).toMatchObject({ status: 'committed' });
    held.stopMatching();
    await handle.world.crash();
    const end = await splitEnd(handle);
    expect(end).toMatchObject({ phase: 'failed' });
    expect((await operationOf<RoleLineOperationV1>(handle, end.operation)).failure)
      .toEqual({ code: 'not_found', reason: 'the split source no longer holds the kept region' });
    const line = await newLineOf(handle, end);
    const card = await handle.readCard(line);
    expect(card.record.lifecycle).toBe('active');
    expect(openTargetsOf(card).filter(target => target.kind === 'module')).toEqual([]);
    expect(openTargetsOf(await handle.readCard(handle.regionAdviser)).filter(target => target.kind === 'module'))
      .toEqual([]);
    const after = await handle.allocation();
    expect(after.duties.adviser.holders).toHaveLength(holders + 1);
    expect(after.duties.adviser.reservations).toEqual([]);
    held.release();
    await run;
  }, 300_000);
});
