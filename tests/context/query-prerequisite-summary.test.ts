import { expect, it } from 'vitest';
import { summarizeQueryPrerequisites } from '../../src/data/context-compiler/query-collaboration-facts.js';
import type { TaskReductionPhase } from '../../src/contracts/reduction.js';

const task = (taskId: string, phase: TaskReductionPhase | null, matches = true, dependencies: string[] = []) => ({
  taskId, dependencies, reduction: phase === null ? null : { phase }, reductionMatchesPlan: matches,
});

it('keeps one recorded success separate from three unknown prerequisites without deriving Gate readiness', () => {
  const rows = [task('coding', 'satisfied'), task('coordinator', null), task('reader-a', null), task('reader-b', null),
    task('gate', null, true, ['coding', 'coordinator', 'reader-a', 'reader-b'])];
  expect(summarizeQueryPrerequisites(rows)).toEqual([{
    taskId: 'gate', prerequisiteTaskIds: ['coding', 'coordinator', 'reader-a', 'reader-b'],
    recordedSatisfiedTaskIds: ['coding'], unknownAcceptanceTaskIds: ['coordinator', 'reader-a', 'reader-b'],
    historicalAcceptanceTaskIds: [], unobservedTaskIds: [], otherRecordedPhases: [], currentSourceReadiness: 'not_assessed',
  }]);
});

it('distinguishes failed, blocked, stale-plan and omitted facts rather than calling all of them unknown', () => {
  const rows = [task('failed', 'failed'), task('blocked', 'blocked'), task('verifying', 'verifying'),
    task('old', 'satisfied', false), task('gate', null, true, ['failed', 'blocked', 'verifying', 'old', 'outside'])];
  expect(summarizeQueryPrerequisites(rows)).toEqual([{
    taskId: 'gate', prerequisiteTaskIds: ['failed', 'blocked', 'verifying', 'old', 'outside'], recordedSatisfiedTaskIds: [],
    unknownAcceptanceTaskIds: [], historicalAcceptanceTaskIds: ['old'], unobservedTaskIds: ['outside'],
    otherRecordedPhases: [{ taskId: 'failed', phase: 'failed' }, { taskId: 'blocked', phase: 'blocked' }, { taskId: 'verifying', phase: 'verifying' }],
    currentSourceReadiness: 'not_assessed',
  }]);
});

it('does not turn empty dependencies or recorded satisfaction into fresh source acceptance', () => {
  expect(summarizeQueryPrerequisites([])).toEqual([]);
  expect(summarizeQueryPrerequisites([task('empty', null)])).toEqual([]);
  const result = summarizeQueryPrerequisites([task('done', 'satisfied'), task('gate', null, true, ['done', 'done'])]);
  expect(result).toEqual([{ taskId: 'gate', prerequisiteTaskIds: ['done'], recordedSatisfiedTaskIds: ['done'],
    unknownAcceptanceTaskIds: [], historicalAcceptanceTaskIds: [], unobservedTaskIds: [], otherRecordedPhases: [], currentSourceReadiness: 'not_assessed' }]);
});
