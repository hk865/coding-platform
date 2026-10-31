/**
 * The module overlap predicate and the stable partition: a waiting task overlaps when another running task of its
 * own Goal declares the same module, and the partition keeps input order on both sides. Pure A5: every input and
 * every expected triple is written out here; no store, platform, Host, Workflow or Runtime is imported.
 */
import { describe, expect, it } from 'vitest';
import type {
  ModuleOverlapCandidateV1, ModuleOverlapFactsV1, ModuleOverlapV1,
} from '../../src/core/work-graph/tasks/overlap-gates.js';
import { moduleOverlapOf, splitNonOverlapping } from '../../src/core/work-graph/tasks/overlap-gates.js';

const T1 = { projectId: 'p1', goalId: 'g1', taskId: 't1' };
const T2 = { projectId: 'p1', goalId: 'g1', taskId: 't2' };
const T3 = { projectId: 'p1', goalId: 'g1', taskId: 't3' };

describe('moduleOverlapOf', () => {
  it.each<[string, ModuleOverlapFactsV1, ModuleOverlapV1]>([
    ['the same Goal running on the module', {
      waiting: { task: T1, moduleId: 'm1', effectivePhase: 'running' },
      others: [{ task: T2, moduleId: 'm1', effectivePhase: 'running' }],
    }, { overlaps: true, moduleId: 'm1', running: [T2] }],
    ['a waiting task without the module arm', {
      waiting: { task: T1, moduleId: null, effectivePhase: 'running' },
      others: [{ task: T2, moduleId: 'm1', effectivePhase: 'running' }],
    }, { overlaps: false }],
    ['another Goal running on the module', {
      waiting: { task: T1, moduleId: 'm1', effectivePhase: 'running' },
      others: [{ task: { ...T2, goalId: 'g2' }, moduleId: 'm1', effectivePhase: 'running' }],
    }, { overlaps: false }],
    ['the same Goal on the module while verifying', {
      waiting: { task: T1, moduleId: 'm1', effectivePhase: 'running' },
      others: [{ task: T2, moduleId: 'm1', effectivePhase: 'verifying' }],
    }, { overlaps: false }],
    ['two running tasks on the module', {
      waiting: { task: T1, moduleId: 'm1', effectivePhase: 'running' },
      others: [
        { task: T2, moduleId: 'm1', effectivePhase: 'running' },
        { task: T3, moduleId: 'm1', effectivePhase: 'running' },
      ],
    }, { overlaps: true, moduleId: 'm1', running: [T2, T3] }],
  ])('%s', (_label, facts, expected) => {
    expect(moduleOverlapOf(facts)).toEqual(expected);
  });
});

const A: ModuleOverlapCandidateV1<string> = { candidate: 'A', overlap: { overlaps: true, moduleId: 'm1', running: [T2] } };
const B: ModuleOverlapCandidateV1<string> = { candidate: 'B', overlap: { overlaps: false } };
const C: ModuleOverlapCandidateV1<string> = { candidate: 'C', overlap: { overlaps: true, moduleId: 'm2', running: [T3] } };
const D: ModuleOverlapCandidateV1<string> = { candidate: 'D', overlap: { overlaps: false } };

describe('splitNonOverlapping', () => {
  it.each<[string, ModuleOverlapCandidateV1<string>[], {
    nonOverlapping: ModuleOverlapCandidateV1<string>[];
    overlapping: ModuleOverlapCandidateV1<string>[];
  }]>([
    ['a mixed input', [A, B, C, D], { nonOverlapping: [B, D], overlapping: [A, C] }],
    ['only non-overlapping candidates', [B, D], { nonOverlapping: [B, D], overlapping: [] }],
    ['only overlapping candidates', [A, C], { nonOverlapping: [], overlapping: [A, C] }],
  ])('%s keeps each side in input order', (_label, candidates, expected) => {
    expect(splitNonOverlapping(candidates)).toEqual(expected);
  });
});
