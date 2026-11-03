/**
 * C-label (8E L1): the note header's kind labels are byte-identical for the
 * eight kinds that existed before this slice. The row calls only the public
 * `renderNoteHeader`; no store, platform, Host or fixture.
 *
 * A pure `module` anchor on `runtime`, `structural: false` and the conclusion
 * `结论` exercise the frozen template `${label}(${display})${marker}：${conclusion}`,
 * where the module prefix is `模块 ` and the marker is empty.
 */
import { describe, expect, it } from 'vitest';
import { renderNoteHeader } from '../../src/contracts/note.js';
import type { NoteAnchorV1, NoteKind } from '../../src/contracts/note.js';

const ANCHOR: NoteAnchorV1 = { kind: 'module', moduleId: 'runtime' };

const CASES: { kind: NoteKind; header: string }[] = [
  { kind: 'convention', header: '约定(模块 runtime)：结论' },
  { kind: 'pitfall', header: '坑(模块 runtime)：结论' },
  { kind: 'tradeoff', header: '取舍(模块 runtime)：结论' },
  { kind: 'open_question', header: '待解问题(模块 runtime)：结论' },
  { kind: 'preference', header: '偏好(模块 runtime)：结论' },
  { kind: 'decision', header: '决定(模块 runtime)：结论' },
  { kind: 'understanding', header: '当前理解(模块 runtime)：结论' },
  { kind: 'repair', header: '修补(模块 runtime)：结论' },
];

describe('S8E L1 C-label', () => {
  it.each(CASES)('C-label $kind: the old kind keeps its frozen header bytes', ({ kind, header }) => {
    expect(renderNoteHeader({ kind, anchor: ANCHOR, structural: false, conclusion: '结论' })).toBe(header);
  });
});
