/**
 * P0b (decision 121-151, A9): a look reads the node's own Goal in the same
 * workspace; cards and history stay bound to the calling round's Goal.
 *
 * X3, X4 ① and X5 are red today at the frozen ruling's named step: X3 and X4 ①
 * see "the Goal node is outside the requested goal", X5 sees "the Run node is
 * outside the requested goal"; X4 ③ is the guard and is green. Only memory;
 * the rows are read-only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ExecutionHistoryPage, GraphExecutionHistoryReadPort } from '../../src/core/agent-runtime/execution-history-contracts.js';
import { createGraphTools } from '../../src/core/agent-runtime/graph-tools.js';
import { createGraphHistoryProxy } from '../../src/core/agent-runtime/tool-group-assembly.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  createS4C2NoteCardFixture, generalNote, type S4C2NoteCardFixture,
} from '../helpers/S4C2-note-card-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7AWorkSetup } from '../helpers/S7A-fixture.js';
import { addS7D2SecondWorkspace, type S7D2SecondWorkspace } from '../helpers/S7D2-role-line-world.js';
import type { ToolCall, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';

const noteFixtures: S4C2NoteCardFixture[] = [];
afterEach(async () => {
  for (const fixture of noteFixtures.splice(0)) await fixture.close();
});

describe('rejects: a Goal of another workspace', () => {
  it('X3 a same-project Goal in another workspace keeps the workspace refusal', async () => {
    const setup = await openS7AWorkSetup({ backend: 'memory' });
    let second: S7D2SecondWorkspace | null = null;
    try {
      second = await addS7D2SecondWorkspace(setup.world, 'p0b-x3');
      const answer = await setup.world.dispatch('graph/look', setup.world.humanContext(), plain(S6A_SCOPE, {
        goalRef: setup.goal,
        target: { kind: 'node', node: { kind: 'goal', ref: second.goal } },
        relation: 'card', page: { afterCursor: null, limit: 20 },
      }));
      expect(answer).toEqual({
        status: 'rejected', code: 'forbidden', reason: 'the Goal is outside the requested workspace',
      });
    } finally {
      await setup.world.close();
      if (second !== null) await second.remove();
    }
  }, 120_000);
});

describe('cross-Goal cards keep the note visibility of the calling round', () => {
  it('X4 a cross-Goal card carries no note material and no note-naming decision row', async () => {
    const f = await createS4C2NoteCardFixture('memory');
    noteFixtures.push(f);
    const user = await f.writeUser(generalNote({
      anchor: { kind: 'goal', goalId: f.goal2Ref.goalId } }), f.goal2Ref.goalId);
    expect(user).toMatchObject({ status: 'accepted', confirmedByUser: true });
    const agent = await f.writeAgent(f.executor2, generalNote({ kind: 'decision',
      anchor: { kind: 'goal', goalId: f.goal2Ref.goalId },
      contradicts: [(user as unknown as { noteId: string }).noteId] }), f.goal2Ref.goalId);
    expect(agent).toMatchObject({ status: 'pending_review', reasons: ['contradiction'] });
    const noteId = (agent as unknown as { noteId: string }).noteId;
    const target = { kind: 'node' as const, node: { kind: 'goal' as const, ref: f.goal2Ref } };
    const page = { afterCursor: null, limit: 1 };

    // ③ the guard (green today): a no-goal Host read of g2 still projects N2's note card.
    const guard = await f.platform.graphContext.lookGraph(f.ctx(), {
      goalRef: null, target, relation: 'card', page,
    });
    expect(guard).toMatchObject({ status: 'ready' });
    if (guard.status !== 'ready') return;
    expect(guard.value.items[0]!.node).toEqual(target.node);
    const guardRows = guard.value.items[0]!.indexes.decisions.rows;
    expect(guardRows.some(row => row.key.includes(noteId) && row.text.includes('note_review'))).toBe(true);

    // ① a g1 Work Run reads the same g2 Goal card.
    const read = await f.platform.graphContext.lookGraph(f.workCtx(f.executor.runRef), {
      goalRef: f.goalRef, target, relation: 'card', page,
    });
    expect(read).toMatchObject({ status: 'ready' });
    if (read.status !== 'ready') return;
    expect(read.value.items[0]!.goal?.ref.goalId).toBe(f.goal2Ref.goalId);
    expect(read.value.items[0]!.indexes.notes.availability).toBe('not_implemented');
    expect(JSON.stringify(read.value.items[0]!.indexes.decisions.rows)).not.toContain(noteId);
  }, 120_000);
});

describe('a Work Run history stays bound to the frozen Goal', () => {
  it('X5 a g1 Work Run cannot read the history of a g2 Run in the same workspace', async () => {
    const f = await createS4C2NoteCardFixture('memory');
    noteFixtures.push(f);
    const reached: { runRef: RunRef | null } = { runRef: null };
    const history: GraphExecutionHistoryReadPort = {
      async readTaskExecutionHistory(_ctx: CoreCallContext, request) {
        reached.runRef = request.runRef;
        const page: ExecutionHistoryPage = {
          items: [], nextCursor: null,
          basis: { kind: 'platform', cursor: 'p0b-c1' as CommitCursor },
          executionIdentity: { runId: request.runRef.runId, turnId: 'p0b-turn' }, scannedCount: 0,
        };
        return { status: 'ready', value: page };
      },
    };
    const tools = createGraphTools({
      context: f.workCtx(f.executor.runRef),
      goalRef: f.goalRef,
      graph: f.platform.graphContext,
      inputs: f.platform.taskInputs,
      // P0（A8）：挂图工具的每一轮都接注记读口，配置里 notes 必填。
      notes: f.platform.notes,
      history: createGraphHistoryProxy({
        graph: f.platform.graphContext, history, goalRef: f.goalRef, hostContext: f.ctx(),
      }),
    });
    const look = tools.create(null as unknown as WorkspaceSandbox)
      .find(candidate => candidate.name === 'look_graph')!;
    const call: ToolCall = { schemaVersion: 1, callId: 'p0b-x5', name: 'look_graph',
      arguments: { mode: 'history', runRef: f.executor2.runRef } as ToolCall['arguments'] };
    const result = await look.handler.execute(call, { signal: f.ctx().signal });
    expect(result.status).toBe('error');
    expect(result.output).toContainEqual({ kind: 'json', value: {
      status: 'rejected', code: 'forbidden', reason: 'the requested Run is not in the bound Goal',
    } });
    expect(reached.runRef).toBeNull();
    // A missing Run of g2 is refused before the card is read, so the history owner never sees it.
    const missingRun: RunRef = { ...f.executor2.runRef, runId: 'p0b-x5-missing-run' };
    const missingCall: ToolCall = { schemaVersion: 1, callId: 'p0b-x5-missing', name: 'look_graph',
      arguments: { mode: 'history', runRef: missingRun } as ToolCall['arguments'] };
    const missing = await look.handler.execute(missingCall, { signal: f.ctx().signal });
    expect(missing.status).toBe('error');
    expect(missing.output).toContainEqual({ kind: 'json', value: {
      status: 'rejected', code: 'forbidden', reason: 'the requested Run is not in the bound Goal',
    } });
    expect(reached.runRef).toBeNull();
  }, 120_000);
});
