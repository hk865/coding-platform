/**
 * Slice 2B BE0: the pure tally `tallyTurnActivity`.
 *
 * The values asserted here are hand-computed from the frozen spec L1–L4 tables and
 * examples, never from the product's own functions. Every record sequence comes
 * from `tests/helpers/S2B-kernel-records-fixture.ts`, which validates the
 * hand-written Kernel events with the real `agentEventSchema` and replays them
 * through the real reducer. No store is read, no model is called.
 */
import { describe, expect, it } from 'vitest';

import { tallyTurnActivity } from '../../src/core/agent-runtime/run-activity-tally.js';
import type { RunActivityFactsV1 } from '../../src/contracts/run-activity.js';
import {
  KernelTurnRecords,
  cancelledResult,
  editCreateCall,
  editReplaceCall,
  failedResult,
  kernelToolCall,
  readCall,
  shellCall,
  successResult,
} from '../helpers/S2B-kernel-records-fixture.js';

/** Run the pure function over the whole fixture Turn and narrow the counted branch. */
function tally(builder: KernelTurnRecords): Extract<RunActivityFactsV1, { status: 'counted' }> {
  const facts = tallyTurnActivity(builder.records(), builder.kernel, builder.window());
  expect(facts.status).toBe('counted');
  if (facts.status !== 'counted') throw new Error(`expected counted, got ${facts.status}`);
  return facts;
}

const REV = 'rev-2';

/** A minimal open Turn with one started tool call, ready for a result. */
function turnWithStarted(call: ReturnType<typeof editReplaceCall>): KernelTurnRecords {
  const builder = new KernelTurnRecords();
  builder.runStarted().modelRequestStarted('req-1').assistantMessage('m-1', [call]).toolStarted(call);
  return builder;
}

describe('BE0 tallyTurnActivity', () => {
  describe('2B-01 L1 edit table and first-match order', () => {
    it('2B-01 row 1: an edit whose arguments prove oldText === newText is never an edit, whatever the result', () => {
      const call = editReplaceCall('c1', 'c.ts', 'same', 'same');
      const cases: Array<{ name: string; finish: (builder: KernelTurnRecords) => void }> = [
        { name: 'success', finish: (b) => b.toolCompleted('c1', successResult('c1',
          { effects: { sideEffect: 'confirmed', changedPaths: ['c.ts'], workspaceRevision: REV } })) },
        { name: 'cancelled after the write', finish: (b) => b.toolCancelled('c1', cancelledResult('c1',
          { effects: { sideEffect: 'confirmed', changedPaths: ['c.ts'], workspaceRevision: REV } })) },
        { name: 'dispatcher timeout', finish: (b) => b.toolFailed('c1', 'execution', failedResult('c1',
          { code: 'timeout', effects: { sideEffect: 'confirmed', changedPaths: ['c.ts'], workspaceRevision: REV } })) },
        { name: 'outcome unknown', finish: (b) => b.toolOutcomeUnknown('c1', { toolName: 'edit', effectClass: 'workspace_write' }) },
        { name: 'no result by the window end', finish: () => { /* nothing */ } },
      ];
      for (const testCase of cases) {
        const builder = turnWithStarted(call);
        testCase.finish(builder);
        const facts = tally(builder);
        expect(facts.totals, testCase.name).toEqual({ steps: 1, edits: 0, editsUnknown: 0 });
        expect(facts.changedFiles.definite, testCase.name).toEqual([]);
        expect(facts.changedFiles.possible, testCase.name).toEqual([]);
        expect(facts.changedFiles.possiblyIncomplete, testCase.name).toBe(false);
        expect(facts.changedFiles.incompleteBecause, testCase.name).toEqual([]);
        const unresolved = testCase.name === 'outcome unknown' || testCase.name === 'no result by the window end' ? 1 : 0;
        expect(facts.window.unresolvedCalls, testCase.name).toBe(unresolved);
      }
    });

    it('2B-01 row 2: a tool.outcome_unknown call is one unknown edit (a shell, and an edit requesting d.ts)', () => {
      const shell = turnWithStarted(shellCall('s1', 'rm -rf build'));
      shell.toolOutcomeUnknown('s1', { toolName: 'shell', effectClass: 'process' });
      const shellFacts = tally(shell);
      expect(shellFacts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 1 });
      expect(shellFacts.changedFiles.possible).toEqual([]);
      expect(shellFacts.changedFiles.incompleteBecause).toContain('edits_unknown');
      expect(shellFacts.window.unresolvedCalls).toBe(1);

      const edit = turnWithStarted(editReplaceCall('e1', 'd.ts', 'before', 'after'));
      edit.toolOutcomeUnknown('e1', { toolName: 'edit', effectClass: 'workspace_write' });
      const editFacts = tally(edit);
      expect(editFacts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 1 });
      expect(editFacts.changedFiles.possible).toEqual(['d.ts']);
      expect(editFacts.window.unresolvedCalls).toBe(1);
    });

    it('2B-01 row 3: a call whose result never reached the window end is one unknown edit', () => {
      const builder = turnWithStarted(editReplaceCall('e1', 'e.ts', 'before', 'after'));
      const facts = tally(builder);
      expect(facts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 1 });
      expect(facts.changedFiles.possible).toEqual(['e.ts']);
      expect(facts.changedFiles.incompleteBecause).toContain('edits_unknown');
      expect(facts.window.unresolvedCalls).toBe(1);
    });

    it('2B-01 row 4: a completed edit whose output revisions are equal is not an edit', () => {
      const call = editReplaceCall('e1', 'f.ts', 'before', 'after');
      const builder = turnWithStarted(call);
      builder.toolCompleted('e1', successResult('e1', {
        output: [{ kind: 'json', value: { oldRevision: 'r1', newRevision: 'r1' } }],
        effects: { sideEffect: 'confirmed', changedPaths: ['f.ts'], workspaceRevision: REV },
      }));
      const facts = tally(builder);
      expect(facts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 0 });
      expect(facts.changedFiles.definite).toEqual([]);
      expect(facts.changedFiles.possible).toEqual([]);
      expect(facts.changedFiles.possiblyIncomplete).toBe(false);
    });

    it('2B-01 row 5: confirmed changed paths are edits (success, failed, cancelled, create)', () => {
      const success = turnWithStarted(editReplaceCall('e1', 'a.ts', 'before', 'after'));
      success.toolCompleted('e1', successResult('e1',
        { effects: { sideEffect: 'confirmed', changedPaths: ['a.ts'], workspaceRevision: REV } }));
      expect(tally(success).totals).toEqual({ steps: 1, edits: 1, editsUnknown: 0 });
      expect(tally(success).changedFiles.definite).toEqual(['a.ts']);

      const failed = turnWithStarted(editReplaceCall('e1', 'b.ts', 'before', 'after'));
      failed.toolFailed('e1', 'execution', failedResult('e1',
        { code: 'execution_failed', effects: { sideEffect: 'confirmed', changedPaths: ['b.ts', 'c.ts'], workspaceRevision: REV } }));
      expect(tally(failed).totals).toEqual({ steps: 1, edits: 1, editsUnknown: 0 });
      expect(tally(failed).changedFiles.definite).toEqual(['b.ts', 'c.ts']);

      const cancelled = turnWithStarted(editReplaceCall('e1', 'b.ts', 'before', 'after'));
      cancelled.toolCancelled('e1', cancelledResult('e1',
        { effects: { sideEffect: 'confirmed', changedPaths: ['b.ts', 'c.ts'], workspaceRevision: REV } }));
      expect(tally(cancelled).totals).toEqual({ steps: 1, edits: 1, editsUnknown: 0 });
      expect(tally(cancelled).changedFiles.definite).toEqual(['b.ts', 'c.ts']);

      const create = turnWithStarted(editCreateCall('e1', 'd.ts', 'new file'));
      create.toolCompleted('e1', successResult('e1',
        { effects: { sideEffect: 'confirmed', changedPaths: ['d.ts'], workspaceRevision: REV } }));
      expect(tally(create).totals).toEqual({ steps: 1, edits: 1, editsUnknown: 0 });
      expect(tally(create).changedFiles.definite).toEqual(['d.ts']);
    });

    it('2B-01 row 6: a confirmed change of only "." is not an edit', () => {
      const builder = turnWithStarted(shellCall('s1', 'git checkout -b x'));
      builder.toolCompleted('s1', successResult('s1',
        { effects: { sideEffect: 'confirmed', changedPaths: ['.'], workspaceRevision: REV } }));
      const facts = tally(builder);
      expect(facts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 0 });
      expect(facts.changedFiles.definite).toEqual([]);
    });

    it('2B-01 row 7: a possible change with a path is one unknown edit', () => {
      const call = editReplaceCall('e1', 'p.ts', 'before', 'after');
      const builder = turnWithStarted(call);
      builder.toolCompleted('e1', successResult('e1',
        { effects: { sideEffect: 'possible', changedPaths: ['p.ts'], workspaceRevision: null } }));
      const facts = tally(builder);
      expect(facts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 1 });
      expect(facts.changedFiles.possible).toEqual(['p.ts']);
      expect(facts.changedFiles.incompleteBecause).toContain('edits_unknown');
    });

    it('2B-01 row 8: a shell possible change with an empty path list and a revision is not an edit', () => {
      const success = turnWithStarted(shellCall('s1', 'ls'));
      success.toolCompleted('s1', successResult('s1',
        { effects: { sideEffect: 'possible', changedPaths: [], workspaceRevision: 'r3' } }));
      expect(tally(success).totals).toEqual({ steps: 1, edits: 0, editsUnknown: 0 });

      const failed = turnWithStarted(shellCall('s1', 'false'));
      failed.toolFailed('s1', 'execution', failedResult('s1',
        { code: 'execution_failed', effects: { sideEffect: 'possible', changedPaths: [], workspaceRevision: 'r3' } }));
      expect(tally(failed).totals).toEqual({ steps: 1, edits: 0, editsUnknown: 0 });
    });

    it('2B-01 row 9: a shell possible change with an empty path list and no revision is one unknown edit', () => {
      const exception = turnWithStarted(shellCall('s1', 'cat huge'));
      exception.toolCompleted('s1', successResult('s1',
        { effects: { sideEffect: 'possible', changedPaths: [], workspaceRevision: null } }));
      expect(tally(exception).totals).toEqual({ steps: 1, edits: 0, editsUnknown: 1 });

      const dispatcher = turnWithStarted(shellCall('s1', 'cat huge'));
      dispatcher.toolFailed('s1', 'execution', failedResult('s1',
        { code: 'execution_failed', message: 'shell 执行失败',
          effects: { sideEffect: 'possible', changedPaths: [], workspaceRevision: null } }));
      const facts = tally(dispatcher);
      expect(facts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 1 });
      expect(facts.changedFiles.incompleteBecause).toContain('edits_unknown');
    });

    it('2B-01 row 10: effects none (a clean shell and an after-start rejection) are no edit', () => {
      const clean = turnWithStarted(shellCall('s1', 'true'));
      clean.toolCompleted('s1', successResult('s1',
        { effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null } }));
      expect(tally(clean).totals).toEqual({ steps: 1, edits: 0, editsUnknown: 0 });

      const rejected = turnWithStarted(editReplaceCall('e1', 'x.ts', 'before', 'after'));
      rejected.toolFailed('e1', 'execution', failedResult('e1',
        { code: 'invalid_arguments', effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null } }));
      const facts = tally(rejected);
      expect(facts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 0 });
      expect(facts.changedFiles.possiblyIncomplete).toBe(false);
    });

    it('2B-01 not-started calls: a Hook-blocked call and an abandoned call are no steps', () => {
      const blocked = new KernelTurnRecords();
      blocked.runStarted().modelRequestStarted('req-1').assistantMessage('m-1', [readCall('h1', 'src/a.ts')]);
      blocked.toolFailed('h1', 'pre_execution', failedResult('h1', { code: 'hook_blocked' }));
      const blockedFacts = tally(blocked);
      expect(blockedFacts.totals).toEqual({ steps: 0, edits: 0, editsUnknown: 0 });
      expect(blockedFacts.window.unresolvedCalls).toBe(0);
      expect(blockedFacts.changedFiles.possiblyIncomplete).toBe(false);

      const abandoned = new KernelTurnRecords();
      abandoned.runStarted().modelRequestStarted('req-1').assistantMessage('m-1', [readCall('a1', 'src/a.ts')]);
      abandoned.runCancelled();
      const abandonedFacts = tally(abandoned);
      expect(abandonedFacts.totals).toEqual({ steps: 0, edits: 0, editsUnknown: 0 });
      expect(abandonedFacts.window.unresolvedCalls).toBe(0);
      expect(abandonedFacts.window.turnTerminal).toBe(true);
    });

    it('2B-01 non-edit tools: a coordination write and a read with unknown results are steps but never edits', () => {
      const coordination = turnWithStarted(kernelToolCall('g1', 'send_session_message', { text: 'hi' }));
      coordination.toolOutcomeUnknown('g1', { toolName: 'send_session_message', effectClass: 'workspace_write' });
      const coordinationFacts = tally(coordination);
      expect(coordinationFacts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 0 });
      expect(coordinationFacts.window.unresolvedCalls).toBe(1);
      expect(coordinationFacts.changedFiles.possiblyIncomplete).toBe(false);

      const read = turnWithStarted(readCall('r1', 'src/a.ts'));
      read.toolOutcomeUnknown('r1', { toolName: 'read', effectClass: 'read_only' });
      const readFacts = tally(read);
      expect(readFacts.totals).toEqual({ steps: 1, edits: 0, editsUnknown: 0 });
      expect(readFacts.window.unresolvedCalls).toBe(1);
      expect(readFacts.changedFiles.possiblyIncomplete).toBe(false);
    });

    it('2B-01 unresolvedCalls and turnTerminal follow the reduced window', () => {
      const open = turnWithStarted(readCall('r1', 'src/a.ts'));
      expect(tally(open).window.turnTerminal).toBe(false);
      expect(tally(open).window.unresolvedCalls).toBe(1);

      const resolved = turnWithStarted(readCall('r1', 'src/a.ts'));
      resolved.toolCompleted('r1', successResult('r1'));
      resolved.runCancelled();
      const resolvedFacts = tally(resolved);
      expect(resolvedFacts.window.turnTerminal).toBe(true);
      expect(resolvedFacts.window.unresolvedCalls).toBe(0);

      const terminal = turnWithStarted(readCall('r1', 'src/a.ts'));
      terminal.runCancelled();
      const terminalFacts = tally(terminal);
      expect(terminalFacts.window.turnTerminal).toBe(true);
      expect(terminalFacts.window.unresolvedCalls).toBe(1);
    });
  });

  describe('2B-02 L2 quarters, overflow and span', () => {
    it('2B-02 a call starting 10:59:50 is recorded in the 10:45 quarter, not the 11:00 one', () => {
      const call = readCall('r1', 'src/a.ts');
      const builder = new KernelTurnRecords({ at: '2026-10-14T10:59:00.000Z' });
      builder.runStarted('2026-10-14T10:59:00.000Z').modelRequestStarted('req-1', '2026-10-14T10:59:00.000Z')
        .assistantMessage('m-1', [call], '2026-10-14T10:59:00.000Z')
        .toolStarted(call, '2026-10-14T10:59:50.000Z')
        .toolCompleted('r1', successResult('r1'), '2026-10-14T11:00:20.000Z');
      const facts = tally(builder);
      expect(facts.quarters).toEqual([{ at: '2026-10-14T10:45:00.000Z', steps: 1, edits: 0, editsUnknown: 0 }]);
    });

    it('2B-02 calls at 10:44 and 10:46 fall in the 10:30 and 10:45 quarters', () => {
      const first = readCall('r1', 'src/a.ts');
      const second = readCall('r2', 'src/b.ts');
      const builder = new KernelTurnRecords({ at: '2026-10-14T10:00:00.000Z' });
      builder.runStarted('2026-10-14T10:00:00.000Z').modelRequestStarted('req-1', '2026-10-14T10:00:00.000Z')
        .assistantMessage('m-1', [first, second], '2026-10-14T10:00:00.000Z')
        .toolStarted(first, '2026-10-14T10:44:00.000Z')
        .toolStarted(second, '2026-10-14T10:46:00.000Z')
        .toolCompleted('r1', successResult('r1'), '2026-10-14T10:46:30.000Z')
        .toolCompleted('r2', successResult('r2'), '2026-10-14T10:47:00.000Z');
      const facts = tally(builder);
      expect(facts.quarters).toEqual([
        { at: '2026-10-14T10:30:00.000Z', steps: 1, edits: 0, editsUnknown: 0 },
        { at: '2026-10-14T10:45:00.000Z', steps: 1, edits: 0, editsUnknown: 0 },
      ]);
      expect(facts.totals).toEqual({ steps: 2, edits: 0, editsUnknown: 0 });
    });

    it('2B-02 1,001 distinct quarters keep 1,000 quarters and put the rest in overflow', { timeout: 300_000 }, () => {
      const calls = Array.from({ length: 1001 }, (_, index) => readCall(`r${index}`, `src/f${index}.ts`));
      const builder = new KernelTurnRecords({ at: '2026-10-14T00:00:00.000Z' });
      builder.runStarted('2026-10-14T00:00:00.000Z')
        .modelRequestStarted('req-1', '2026-10-14T00:00:00.000Z')
        .assistantMessage('m-1', calls, '2026-10-14T00:00:00.000Z');
      for (let index = 0; index < calls.length; index += 1) {
        builder.toolStarted(calls[index]!, new Date(Date.UTC(2026, 9, 14) + index * 15 * 60 * 1000).toISOString());
      }
      const facts = tally(builder);
      expect(facts.quarters).toHaveLength(1000);
      expect(facts.quarters[0]).toEqual({ at: '2026-10-14T00:00:00.000Z', steps: 1, edits: 0, editsUnknown: 0 });
      expect(facts.quarters[999]).toEqual({ at: '2026-10-24T09:45:00.000Z', steps: 1, edits: 0, editsUnknown: 0 });
      expect(facts.overflow).toEqual({ steps: 1, edits: 0, editsUnknown: 0,
        firstAt: '2026-10-24T10:00:00.000Z', lastAt: '2026-10-24T10:00:00.000Z' });
      expect(facts.totals).toEqual({ steps: 1001, edits: 0, editsUnknown: 0 });
    });

    it('2B-02 span times are the turn start and the last record; a Turn with no tool call is not empty', () => {
      const call = readCall('r1', 'src/a.ts');
      const builder = new KernelTurnRecords({ at: '2026-10-14T09:00:00.000Z' });
      builder.runStarted('2026-10-14T09:00:05.000Z').modelRequestStarted('req-1', '2026-10-14T09:00:05.000Z')
        .assistantMessage('m-1', [call], '2026-10-14T09:00:06.000Z')
        .toolStarted(call, '2026-10-14T09:05:00.000Z')
        .toolCompleted('r1', successResult('r1'), '2026-10-14T09:05:01.000Z');
      const facts = tally(builder);
      expect(facts.window.turnStartedAt).toBe('2026-10-14T09:00:00.000Z');
      expect(facts.window.lastRecordAt).toBe('2026-10-14T09:05:01.000Z');

      const empty = new KernelTurnRecords({ at: '2026-10-14T09:00:00.000Z' });
      empty.runStarted('2026-10-14T09:00:05.000Z');
      const emptyFacts = tally(empty);
      expect(emptyFacts.quarters).toEqual([]);
      expect(emptyFacts.window.turnStartedAt).toBe('2026-10-14T09:00:00.000Z');
      expect(emptyFacts.window.lastRecordAt).toBe('2026-10-14T09:00:05.000Z');
    });
  });

  describe('2B-03 L3 changed files and model usage', () => {
    it('2B-03 changed files: definite excludes the same-text edit, possible holds the unknown edit, shell marks command_ran', () => {
      const edited = editReplaceCall('e1', 'a.ts', 'before', 'after');
      const same = editReplaceCall('e2', 'c.ts', 'same', 'same');
      const unknownEdit = editReplaceCall('e3', 'd.ts', 'before', 'after');
      const shell = shellCall('s1', 'ls');
      const builder = new KernelTurnRecords();
      builder.runStarted().modelRequestStarted('req-1')
        .assistantMessage('m-1', [edited, same, unknownEdit, shell], '2026-10-14T10:00:01.000Z')
        .toolStarted(edited, '2026-10-14T10:00:02.000Z')
        .toolCompleted('e1', successResult('e1',
          { effects: { sideEffect: 'confirmed', changedPaths: ['a.ts'], workspaceRevision: REV } }), '2026-10-14T10:00:03.000Z')
        .toolStarted(same, '2026-10-14T10:00:04.000Z')
        .toolCompleted('e2', successResult('e2',
          { effects: { sideEffect: 'confirmed', changedPaths: ['c.ts'], workspaceRevision: REV } }), '2026-10-14T10:00:05.000Z')
        .toolStarted(unknownEdit, '2026-10-14T10:00:06.000Z')
        .toolOutcomeUnknown('e3', { toolName: 'edit', effectClass: 'workspace_write' }, '2026-10-14T10:00:07.000Z')
        .toolStarted(shell, '2026-10-14T10:00:08.000Z')
        .toolCompleted('s1', successResult('s1',
          { effects: { sideEffect: 'possible', changedPaths: [], workspaceRevision: 'r3' } }), '2026-10-14T10:00:09.000Z');
      const facts = tally(builder);
      expect(facts.totals).toEqual({ steps: 4, edits: 1, editsUnknown: 1 });
      expect(facts.changedFiles).toEqual({ definite: ['a.ts'], possible: ['d.ts'],
        definiteOmitted: 0, possibleOmitted: 0, possiblyIncomplete: true,
        incompleteBecause: ['command_ran', 'edits_unknown'] });
    });

    it('2B-03 caps: 501 definite and 501 possible paths each keep 500 and report 1 omitted', () => {
      const definitePaths = Array.from({ length: 501 }, (_, index) => `src/f${String(index).padStart(3, '0')}.ts`);
      const shell = shellCall('s1', 'touch many');
      const definiteTurn = new KernelTurnRecords();
      definiteTurn.runStarted().modelRequestStarted('req-1')
        .assistantMessage('m-1', [shell], '2026-10-14T10:00:01.000Z')
        .toolStarted(shell, '2026-10-14T10:00:02.000Z')
        .toolCompleted('s1', successResult('s1',
          { effects: { sideEffect: 'confirmed', changedPaths: definitePaths, workspaceRevision: REV } }), '2026-10-14T10:00:03.000Z');
      const definiteFacts = tally(definiteTurn);
      expect(definiteFacts.changedFiles.definite).toHaveLength(500);
      expect(definiteFacts.changedFiles.definite[0]).toBe('src/f000.ts');
      expect(definiteFacts.changedFiles.definite[499]).toBe('src/f499.ts');
      expect(definiteFacts.changedFiles.definiteOmitted).toBe(1);
      expect(definiteFacts.changedFiles.incompleteBecause).toEqual(['command_ran', 'cap']);

      const possiblePaths = Array.from({ length: 501 }, (_, index) => `src/p${String(index).padStart(3, '0')}.ts`);
      const edit = editReplaceCall('e1', 'src/p.ts', 'before', 'after');
      const possibleTurn = new KernelTurnRecords();
      possibleTurn.runStarted().modelRequestStarted('req-1')
        .assistantMessage('m-1', [edit], '2026-10-14T10:00:01.000Z')
        .toolStarted(edit, '2026-10-14T10:00:02.000Z')
        .toolCompleted('e1', successResult('e1',
          { effects: { sideEffect: 'possible', changedPaths: possiblePaths, workspaceRevision: null } }), '2026-10-14T10:00:03.000Z');
      const possibleFacts = tally(possibleTurn);
      expect(possibleFacts.changedFiles.possible).toHaveLength(500);
      expect(possibleFacts.changedFiles.possible[0]).toBe('src/p000.ts');
      expect(possibleFacts.changedFiles.possibleOmitted).toBe(1);
      expect(possibleFacts.changedFiles.incompleteBecause).toEqual(['edits_unknown', 'cap']);
    });

    it('2B-03 usage: four requests, three reported, totals are the sum of the three and complete is false', () => {
      const first = readCall('r1', 'src/a.ts');
      const second = readCall('r2', 'src/b.ts');
      const third = readCall('r3', 'src/c.ts');
      const fourth = readCall('r4', 'src/d.ts');
      const builder = new KernelTurnRecords({ at: '2026-10-14T10:00:00.000Z' });
      builder.runStarted('2026-10-14T10:00:00.000Z')
        .modelRequestStarted('req-1', '2026-10-14T10:00:00.000Z')
        .modelUsageRecorded('req-1', { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, costUsdMicros: 100 }, '2026-10-14T10:00:01.000Z')
        .assistantMessage('m-1', [first], '2026-10-14T10:00:02.000Z')
        .toolStarted(first, '2026-10-14T10:00:03.000Z')
        .toolCompleted('r1', successResult('r1'), '2026-10-14T10:00:04.000Z')
        .modelRequestStarted('req-2', '2026-10-14T10:01:00.000Z')
        .assistantMessage('m-2', [second], '2026-10-14T10:01:01.000Z')
        .toolStarted(second, '2026-10-14T10:01:02.000Z')
        .toolCompleted('r2', successResult('r2'), '2026-10-14T10:01:03.000Z')
        .modelRequestStarted('req-3', '2026-10-14T10:02:00.000Z')
        .modelUsageRecorded('req-3', { inputTokens: 20, outputTokens: 7, cachedInputTokens: 0, costUsdMicros: null }, '2026-10-14T10:02:01.000Z')
        .assistantMessage('m-3', [third], '2026-10-14T10:02:02.000Z')
        .toolStarted(third, '2026-10-14T10:02:03.000Z')
        .toolCompleted('r3', successResult('r3'), '2026-10-14T10:02:04.000Z')
        .modelRequestStarted('req-4', '2026-10-14T10:03:00.000Z')
        .modelUsageRecorded('req-4', { inputTokens: 30, outputTokens: 9, cachedInputTokens: 5, costUsdMicros: 300 }, '2026-10-14T10:03:01.000Z')
        .assistantMessage('m-4', [fourth], '2026-10-14T10:03:02.000Z')
        .toolStarted(fourth, '2026-10-14T10:03:03.000Z')
        .toolCompleted('r4', successResult('r4'), '2026-10-14T10:03:04.000Z');
      const facts = tally(builder);
      expect(facts.usage.requests).toEqual([
        { requestId: 'req-1', startedAt: '2026-10-14T10:00:00.000Z', usageStatus: 'reported',
          inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, costUsdMicros: 100 },
        { requestId: 'req-2', startedAt: '2026-10-14T10:01:00.000Z', usageStatus: 'unknown',
          inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsdMicros: null },
        { requestId: 'req-3', startedAt: '2026-10-14T10:02:00.000Z', usageStatus: 'reported',
          inputTokens: 20, outputTokens: 7, cachedInputTokens: 0, costUsdMicros: null },
        { requestId: 'req-4', startedAt: '2026-10-14T10:03:00.000Z', usageStatus: 'reported',
          inputTokens: 30, outputTokens: 9, cachedInputTokens: 5, costUsdMicros: 300 },
      ]);
      expect(facts.usage.omitted).toBe(0);
      expect(facts.usage.totals).toEqual({ inputTokens: 60, outputTokens: 21, cachedInputTokens: 7 });
      expect(facts.usage.complete).toBe(false);
    });
  });
});
