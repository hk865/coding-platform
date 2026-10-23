/**
 * PC-2 G-02/G-03 (book rulings 12): the shared range check of a re-rendered
 * continuation brief (a) keeps the blank line before a non-tail section and
 * (b) compares the binding's raw UTF-8 bytes with the rendered text, never a
 * lossy decode that turns an incomplete sequence into U+FFFD.
 *
 * Pure constructed input -> output: the text and byte intervals are literals,
 * hand-counted below; no store, Kernel, model or preparation is involved.
 */
import { describe, expect, it } from 'vitest';
import type { CoreRejection } from '../../src/contracts/core/results.js';
import type { ContextAssemblyBindingV1 } from '../../src/contracts/graph-context.js';
import { contextAssemblyProblem } from '../../src/core/work-graph/state/context-input.js';

const EXTENSIONS: ContextAssemblyBindingV1['extensions'] = {
  notes: 'not_implemented', anomalies: 'not_implemented', footprint: 'not_implemented',
  goalSettings: 'not_implemented', decisions: 'not_implemented',
};

const INVALID = { status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>;

function continuationProblem(input: {
  text: string;
  totalBytes: number;
  sections: ContextAssemblyBindingV1['sections'];
  rendered: string;
}) {
  const binding: ContextAssemblyBindingV1 = {
    schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'continuation', duty: 'executor',
    sectionOrder: ['role', 'goal', 'task', 'continuation'],
    residentBudgetBytes: 4096, residentBytes: 0, totalBytes: input.totalBytes,
    sections: input.sections, sources: [], inputSelections: [], extensions: EXTENSIONS,
  };
  return contextAssemblyProblem({
    binding, text: input.text, selectedTaskInputs: [], continuationSuffix: input.rendered,
  });
}

describe('PC2 G continuation range bytes', () => {
  it('G-02 rejects a section glued to the previous text without the two LFs before its range', () => {
    // R \n \n G \n \n T B: role [0,1), goal [3,4), task [6,7), continuation [7,8).
    const text = 'R\n\nG\n\nTB';
    expect(continuationProblem({
      text, totalBytes: 8, rendered: 'B',
      sections: [
        { name: 'role', startByte: 0, endByte: 1, omitted: 0 },
        { name: 'goal', startByte: 3, endByte: 4, omitted: 0 },
        { name: 'task', startByte: 6, endByte: 7, omitted: 0 },
        { name: 'continuation', startByte: 7, endByte: 8, omitted: 0 },
      ],
    })).toMatchObject(INVALID);
  });

  it('G-03 rejects a range holding only the first byte of 中 even though it decodes to U+FFFD', () => {
    // R \n \n G \n \n T EF BF BD \n \n E4 B8 AD: 15 bytes. The task is
    // [6,10) = "T\uFFFD"; the continuation range [12,13) holds only E4.
    const text = 'R\n\nG\n\nT\uFFFD\n\n中';
    expect(continuationProblem({
      text, totalBytes: 15, rendered: '\uFFFD',
      sections: [
        { name: 'role', startByte: 0, endByte: 1, omitted: 0 },
        { name: 'goal', startByte: 3, endByte: 4, omitted: 0 },
        { name: 'task', startByte: 6, endByte: 10, omitted: 0 },
        { name: 'continuation', startByte: 12, endByte: 13, omitted: 0 },
      ],
    })).toMatchObject(INVALID);
  });
});
