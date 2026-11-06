/**
 * RN (HANDOFF 120-13 丙; C1 rulings 12 and 13; the frozen test brief of 11-06): a region adviser's note needs at
 * least one anchor inside its own region. Links count both ends, flows every step's two ends; evidence and
 * `basisFiles` are not anchors; a project-only integrity note is refused; a sub-region handed to another adviser
 * line is no longer the parent's; a goal-scoped adviser may anchor on its own goal, a pure region line may not; the
 * opening adviser is unrestricted.
 *
 * World: `openS7D2RegionWorld` (catalog `src` ⊃ `src/a`, `src/b`, plus `docs`; Ls is the `src` region adviser), the
 * adviser Work binding `S7D2_ADVISER_WORK` with `record_note` merged in, and two more lines through
 * `role-lines/open`: La on `src/a`, Lm on `docs` and goal G. Each case is one real Work Run on the writer's line
 * whose scripted model calls the real `record_note`; the tool result is the Runtime's own JSON block for the call,
 * and `notes/list` is the public read of what was accepted.
 *
 * Named mutation: the gate uses the line's whole subtree instead of subtracting the sub-regions handed to another
 * line; case 5 (Ls anchoring on La's `src/a`) becomes a success, red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { NoteAnchorV1, NoteDraftAnchorV1 } from '../../src/contracts/note.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { adoptPLMixedPlan, PL_ADVISER_ROLE } from '../helpers/PL-consumption-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { writeColdStartSources } from '../helpers/S7D2-coldstart-world.js';
import { jsonOf } from '../helpers/S7C-member-fixture.js';
import {
  linkS7D2Scopes, openS7D2RegionWorld, runS7D2Work, S7D2_ADVISER_WORK, type S7D2RegionWorld,
} from '../helpers/S7D2-role-line-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const worlds: S7D2RegionWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

const fileAnchor = (path: string): NoteDraftAnchorV1 => ({ kind: 'file', path });
const noteList = async (world: S7D2RegionWorld, anchor: NoteAnchorV1) =>
  valueOf<{ items: { kind: string; conclusion: string; noteId: string;
    source: { kind: string; sessionRef?: { sessionId: string }; duty?: string } }[] }>(
    (await world.main.route('notes/list', { anchor, state: 'accepted', limit: 100, cursor: null })),
    'ready', 'the notes list');

type Case = {
  readonly name: string;
  readonly line: 'ls' | 'la' | 'lm' | 'opening';
  readonly callId: string;
  readonly args: Record<string, unknown>;
  readonly expected: 'accepted' | 'rejected';
  readonly anchor: NoteAnchorV1;
  readonly conclusion: string;
  readonly noteIdOf?: string;
  readonly flowSteps?: (ids: Record<string, string>) => { link: string }[];
};

describe('RN: the region adviser note gate', () => {
  it('RN (memory): the ten anchor cases and the opening adviser control', async () => {
    const world = await openS7D2RegionWorld({ backend: 'memory', extraBindings: [
      S7D2_ADVISER_WORK,
      { binding: { id: S7D2_ADVISER_WORK.binding.id } as WorkbenchRuntimeBinding, mergeTools: ['record_note'] },
    ] });
    worlds.push(world);
    await writeColdStartSources(world.world);
    const ls = world.regionAdviser;
    const la = await world.lineOf('rn-la', (await world.open({ duty: 'adviser',
      scope: [{ kind: 'region', moduleRef: world.modules.child }], requestId: 'rn-la' })).result);
    const lm = await world.lineOf('rn-lm', (await world.open({ duty: 'adviser',
      scope: [{ kind: 'region', moduleRef: world.modules.other }, { kind: 'goal', goalRef: world.goal }],
      requestId: 'rn-lm' })).result);
    const opening = world.lines.adviser;
    const role = PL_ADVISER_ROLE.templateId;
    const cases: readonly Case[] = [
      { name: '1 own file', line: 'ls', callId: 'rn-1', expected: 'accepted',
        anchor: { kind: 'file', path: 'src/b/b.ts' }, conclusion: 'RN-1 own file',
        args: { op: 'write', kind: 'pitfall', body: '', topic: 'RN-1', conclusion: 'RN-1 own file', anchor: fileAnchor('src/b/b.ts') } },
      { name: '2 link one end inside', line: 'ls', callId: 'rn-2', expected: 'accepted',
        anchor: { kind: 'file', path: 'src/b/b.ts' }, conclusion: 'RN-2 link', noteIdOf: 'rn-2',
        args: { op: 'write', kind: 'link', body: '', topic: 'RN-2', conclusion: 'RN-2 link',
          anchor: fileAnchor('src/b/b.ts'), extraAnchors: [fileAnchor('docs/guide.md')],
          link: { relation: 'data', key: { kind: 'literal', text: 'C1T_LINK' },
            evidence: [{ role: 'emit', at: { path: 'src/b/b.ts' } },
              { role: 'receive', at: { path: 'docs/guide.md' } }] } } },
      { name: '3 evidence is no anchor', line: 'ls', callId: 'rn-3', expected: 'rejected',
        anchor: { kind: 'file', path: 'docs/guide.md' }, conclusion: 'RN-3 evidence only',
        args: { op: 'write', kind: 'pitfall', body: '', topic: 'RN-3', conclusion: 'RN-3 evidence only',
          anchor: fileAnchor('docs/guide.md'), basisFiles: ['src/b/b.ts'] } },
      { name: '4 project only', line: 'ls', callId: 'rn-4', expected: 'rejected',
        anchor: { kind: 'project' }, conclusion: 'RN-4 project only',
        args: { op: 'write', kind: 'pitfall', body: '', topic: 'RN-4', conclusion: 'RN-4 project only', anchor: { kind: 'project' } } },
      { name: '5 handed sub-region', line: 'ls', callId: 'rn-5', expected: 'rejected',
        anchor: { kind: 'file', path: 'src/a/a.ts' }, conclusion: 'RN-5 handed child',
        args: { op: 'write', kind: 'pitfall', body: '', topic: 'RN-5', conclusion: 'RN-5 handed child',
          anchor: fileAnchor('src/a/a.ts') } },
      { name: '6 goal on a region line', line: 'ls', callId: 'rn-6', expected: 'rejected',
        anchor: { kind: 'goal', goalId: world.goal.goalId }, conclusion: 'RN-6 goal on region line',
        args: { op: 'write', kind: 'pitfall', body: '', topic: 'RN-6', conclusion: 'RN-6 goal on region line',
          anchor: { kind: 'goal', goalId: world.goal.goalId } } },
      { name: '7 goal-scoped adviser on its goal', line: 'lm', callId: 'rn-7', expected: 'accepted',
        anchor: { kind: 'goal', goalId: world.goal.goalId }, conclusion: 'RN-7 goal owner',
        args: { op: 'write', kind: 'pitfall', body: '', topic: 'RN-7', conclusion: 'RN-7 goal owner',
          anchor: { kind: 'goal', goalId: world.goal.goalId } } },
      { name: '8 flow with one inside step', line: 'ls', callId: 'rn-8', expected: 'accepted',
        anchor: { kind: 'file', path: 'src/b/b.ts' }, conclusion: 'RN-8 flow', flowSteps: ids =>
          [{ link: ids['rn-2']! }, { link: ids['rn-m1']! }],
        args: { op: 'write', kind: 'flow', body: '', topic: 'RN-8', conclusion: 'RN-8 flow', anchor: fileAnchor('src/b/b.ts') } },
      { name: '9 flow with no inside step', line: 'ls', callId: 'rn-9', expected: 'rejected',
        anchor: { kind: 'file', path: 'docs/guide.md' }, conclusion: 'RN-9 flow',
        flowSteps: ids => [{ link: ids['rn-m1']! }, { link: ids['rn-m2']! }],
        args: { op: 'write', kind: 'flow', body: '', topic: 'RN-9', conclusion: 'RN-9 flow', anchor: fileAnchor('docs/guide.md') } },
      { name: 'control opening adviser project only', line: 'opening', callId: 'rn-c', expected: 'accepted',
        anchor: { kind: 'project' }, conclusion: 'RN-control project only',
        args: { op: 'write', kind: 'pitfall', body: '', topic: 'RN-control', conclusion: 'RN-control project only',
          anchor: { kind: 'project' } } },
    ];
    const lines = { ls, la, lm, opening };
    // One Plan with one active work Task per case plus the two docs links, assigned to the adviser role.
    const taskIds = [...cases.map((_entry, index) => `rn-task-${String(index)}`), 'rn-m1', 'rn-m2'];
    const plan = await adoptPLMixedPlan(world.world, { goal: world.goal, label: 'rn',
      tasks: taskIds.map(taskId => ({ taskId, role })) });
    const tasks: Record<string, TaskTriple> = {};
    for (const [index, entry] of cases.entries()) {
      const task = plan.tasks[index]!;
      tasks[entry.callId] = task;
      await linkS7D2Scopes(world.world, { line: lines[entry.line], label: `rn-task-${entry.callId}`,
        targets: [{ kind: 'task', ref: task }] });
    }
    const lmLinks = { m1: plan.tasks[cases.length]!, m2: plan.tasks[cases.length + 1]! };
    for (const [key, task] of Object.entries(lmLinks)) {
      await linkS7D2Scopes(world.world, { line: lm, label: `rn-docs-link-${key}`,
        targets: [{ kind: 'task', ref: task }] });
    }
    // Lm writes the two docs-only links the flow cases cite (an allowed write in its own region).
    const ids: Record<string, string> = {};
    const toolCall = (entry: Case, linkIds: Record<string, string>): Record<string, unknown> => ({
      callId: entry.callId, name: 'record_note', args: entry.flowSteps === undefined ? entry.args : {
        ...entry.args, flow: { steps: entry.flowSteps(linkIds) } } });

    const runOn = async (line: 'ls' | 'la' | 'lm' | 'opening', entry: Case,
      call: Record<string, unknown>): Promise<unknown> => {
      await runS7D2Work(world.world, { line: lines[line], goal: world.goal, task: tasks[entry.callId]!,
        label: `rn-${entry.callId}`, replies: [
          { kind: 'calls', calls: [call] as never },
          { kind: 'text', text: `RN ${entry.name} done` },
        ] });
      return jsonOf(await world.world.scripted.requests(lines[line]), entry.callId);
    };

    // Case 2 first: its link id is a flow step of case 8.
    const case2 = cases.find(entry => entry.callId === 'rn-2')!;
    const written2 = await runOn('ls', case2, toolCall(case2, ids)) as { write: { status: string; noteId: string } };
    expect(written2.write.status, JSON.stringify(written2)).not.toBe('rejected');
    ids['rn-2'] = written2.write.noteId;
    // Lm's two docs-only links (a write on `docs`, and the second for case 9).
    const linkCall = (callId: string, from: string, to: string, relation: 'data' | 'message') => ({
      callId, name: 'record_note', args: { op: 'write', kind: 'link', body: '', topic: callId, conclusion: `${callId} docs`,
        anchor: fileAnchor(from), extraAnchors: [fileAnchor(to)],
        link: { relation, key: { kind: 'literal', text: 'C1T_LINK' },
          evidence: [{ role: 'emit' as const, at: { path: from } }, { role: 'receive' as const, at: { path: to } }] },
      } });
    await runS7D2Work(world.world, { line: lm, goal: world.goal, task: lmLinks.m1, label: 'rn-m1', replies: [
      { kind: 'calls', calls: [linkCall('rn-m1', 'docs/guide.md', 'docs/notes.md', 'data')] as never },
      { kind: 'text', text: 'RN m1 done' }] });
    ids['rn-m1'] = (jsonOf(await world.world.scripted.requests(lm), 'rn-m1') as {
      write: { noteId: string } }).write.noteId;
    await runS7D2Work(world.world, { line: lm, goal: world.goal, task: lmLinks.m2, label: 'rn-m2', replies: [
      { kind: 'calls', calls: [linkCall('rn-m2', 'docs/notes.md', 'docs/guide.md', 'message')] as never },
      { kind: 'text', text: 'RN m2 done' }] });
    ids['rn-m2'] = (jsonOf(await world.world.scripted.requests(lm), 'rn-m2') as {
      write: { noteId: string } }).write.noteId;

    for (const entry of cases) {
      if (entry.callId === 'rn-2') continue;
      const before = entry.expected === 'rejected'
        ? (await noteList(world, entry.anchor)).items.length : 0;
      const result = await runOn(entry.line, entry, toolCall(entry, ids)) as {
        write: { status: string; noteId?: string; code?: string; reason?: string } };
      if (entry.expected === 'accepted') {
        expect(result.write.status, `${entry.name}: ${JSON.stringify(result)}`).not.toBe('rejected');
        const listed = await noteList(world, entry.anchor);
        const item = listed.items.find(candidate => candidate.conclusion === entry.conclusion);
        expect(item).toBeDefined();
        expect(item?.source).toMatchObject({ kind: 'agent',
          sessionRef: { sessionId: lines[entry.line].ref.sessionId }, duty: 'adviser' });
      } else {
        expect(result.write).toMatchObject({ status: 'rejected', code: 'forbidden',
          reason: 'anchor_out_of_region' });
        expect((await noteList(world, entry.anchor)).items.length).toBe(before);
        expect((await noteList(world, entry.anchor)).items
          .some(candidate => candidate.conclusion === entry.conclusion)).toBe(false);
      }
    }
    void la;
  }, 300_000);
});
