/**
 * P4-01 byte-proof probe. Copy this file into a scratch copy as
 * tests/zz-p4-probe.test.ts; it renders the review/proposal inputs with the
 * copy's own source and writes each UTF-8 output to $P4_OUT. No production
 * import or export is added.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { renderUnknownCallReviewZh } from '../src/contracts/core/prepared-execution.js';

const OUT = process.env.P4_OUT;
if (OUT === undefined || OUT === '') throw new Error('P4_OUT is not set');

const item = (alias: number, display: 'full' | 'truncated' | 'unexpanded') => ({
  alias,
  toolName: 'shell',
  display,
  command: display === 'unexpanded' ? null : { text: `echo item ${String(alias)}`, truncated: display === 'truncated' },
  cwd: display === 'unexpanded' ? null : '/work',
  startedAt: display === 'unexpanded' ? null : '2026-01-01T00:00:00.000Z',
  sameBatch: display === 'full' ? [1] : [],
  current: null,
});

const base = {
  reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'r' },
  revision: 1,
  round: 1,
  targets: null,
  personText: null,
  annotations: [],
  platformTargets: [],
  workspace: {
    status: 'captured',
    runBaselineKnown: true,
    notVisible: ['ignored/'],
    notVisibleOmitted: 2,
    changedSample: [{ path: 'src/a.ts', change: 'modified' }],
    changedOmitted: 3,
  },
};

const cases: Array<[string, Record<string, unknown>]> = [
  ['review-empty', { ...base, phase: 'review', items: [] }],
  ['review-three', { ...base, phase: 'review', items: [item(1, 'full'), item(2, 'truncated'), item(3, 'unexpanded')] }],
  ['proposal-no-targets', {
    ...base, phase: 'proposal', items: [item(1, 'full'), item(2, 'truncated'), item(3, 'unexpanded')],
    targets: null, personText: 'please propose', annotations: [{ path: 'src/a.ts', text: 'note' }],
  }],
  ['proposal-targets', {
    ...base, phase: 'proposal', items: [item(1, 'full'), item(2, 'truncated'), item(3, 'unexpanded')],
    targets: [3, 1], personText: 'please propose', annotations: [{ path: null, text: 'note' }], platformTargets: [2],
  }],
];

test('p4-01 renderer outputs', () => {
  mkdirSync(OUT, { recursive: true });
  for (const [name, input] of cases) {
    // The copy's own type is checked by the call; the probe data is complete.
    writeFileSync(join(OUT, `${name}.txt`), renderUnknownCallReviewZh(input as never), 'utf8');
  }
});
