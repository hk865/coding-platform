/**
 * KLS-2c-2 (test writer), K28 ([2C2-04], A5 pure): `KnowledgePinShape` under the R1 check the PlanProposal codec runs
 * on a stored pin. The problem's wording is the builder's, so a refusal is any problem. New name used:
 * `KnowledgePinShape` (`src/contracts/knowledge.ts`), read through the module object so the file type-checks on both
 * trees; while it is absent every entry is red at `checkShape`.
 */
import { describe, expect, it } from 'vitest';
import type { Fields, Shape } from '../../src/contracts/data-format.js';
import * as knowledge from '../../src/contracts/knowledge.js';
import { checkShape } from '../../src/contracts/validation/data-format.js';

const pinShape = (knowledge as unknown as { KnowledgePinShape: Shape<Fields> }).KnowledgePinShape;

const clean = { lineRef: '["ws","main"]', contentHash: 'a'.repeat(64), head: 'b'.repeat(40), dirty: false, modules: null };
const svc = { moduleId: '/@ws:ws2/svc', paths: ['/@ws:ws2/src/svc'], responsibility: 'own svc', contains: [],
  dependsOn: [{ to: 'core', reason: 'calls core' }] };
const dirty = { lineRef: '["ws2",""]', contentHash: 'c'.repeat(64), head: null, dirty: true, modules: [svc] };

describe('K28 the plan record pin shape', () => {
  it.each<[string, unknown, boolean]>([
    ['two lines in lineRef order, one clean and one dirty', { lines: [clean, dirty] }, true],
    ['no line', { lines: [] }, false],
    // 具名改坏：不查 lineRef 的排序 → 只这一条红。
    ['two lines in descending lineRef order', { lines: [dirty, clean] }, false],
    ['two lines with the same lineRef', { lines: [clean, { ...dirty, lineRef: clean.lineRef }] }, false],
    // 具名改坏：接受单线旧形状 → 只这一条红。
    ['the one-line shape', { contentHash: clean.contentHash, head: clean.head, dirty: false, modules: null }, false],
    ['the catalog pin', { catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: 'p', baselineId: 'b', revision: 1 },
      baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 'p', baselineId: 'b', revision: 1 },
        digest: 'd'.repeat(64) } }, false],
    ['a module with one more key', { lines: [clean, { ...dirty, modules: [{ ...svc, interfaces: [] }] }] }, false],
  ])('%s', (_entry, value, accepted) => {
    const problem = checkShape(pinShape, value, 'stored');
    expect({ accepted: problem === null, problem }).toMatchObject({ accepted });
  });
});
