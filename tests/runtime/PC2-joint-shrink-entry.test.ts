/**
 * PC-2 joint step, PC-21: the renderer material carries the frozen section plan
 * and the billed resident bytes; `rerenderContextV1` replaces only the review
 * slot, recomputes the ranges and `totalBytes`, keeps the budget choice and the
 * omission metadata, and leaves the reminder byte for byte. A real K3 shrink
 * reaches the review text, the tail reminder, the hand-computed ranges and the
 * entry. A person's pack with another legal order is followed through the real
 * entry, which passes its guard; a changed character stays `invalid`.
 *
 * The full 49-byte budget example (book §5.2) is a hand-written table here; the
 * expected ranges and totals are hand-computed from the literals.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { PromptTextsV1 } from '../../src/contracts/prompts/prompt-set.js';
import { renderContext, rerenderContextV1 } from '../../src/core/agent-runtime/context-rendering.js';
import { openPC2EntryFixture, openPC2ReviewFixture } from '../helpers/PC2-pack-fixture.js';
import { scriptedModel } from '../helpers/PC-platform-fixture.js';

// The frozen PC2 review fixture starts a real blocked Run: §5.1's stand-in
// `shell` must be armed so the Run is held at its call.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

/** The first Run crashes (a requeueable end); the continuation Run answers. */
const continuationModel = () => scriptedModel([
  { beforeReply: async () => { throw new Error('PC2 joint base crash'); } },
  { text: 'PC2 joint continuation answer' },
]);

const WORK_INPUT = '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{inputs}}'
  + '{{continuation}}{{unknown_call_review}}{{reminders}}';

const PACK: PromptTextsV1 = {
  templates: { 'work-input': WORK_INPUT, 'stale-files-reminder': 'STALE' },
  strings: {
    'context.prelude.work': 'PRE', 'context.section.role': 'R', 'context.section.goal': 'G',
    'context.section.task': 'T', 'context.section.footprint': 'F', 'context.section.notes': 'N',
    'context.section.reminders': 'M', 'context.section.inputs': 'I',
    'context.omissions.heading': '## Context omissions', 'context.omissions.prefix': '另有 ',
    'context.omissions.suffix': ' 条，用‘看’读', 'context.omissions.nameSeparator': ': ',
  },
};

/** The whole review text after the real K3 shrink (hand-written, 777 bytes). */
const SHRUNK_REVIEW = '## Unknown-call review\n这一轮只核对，不做任务，不改工作区；不许重跑下面的命令。\n\n'
  + '### 工作区采集\n状态：unavailable；基准已知：否\n看不见的部分：（无）\n变了的前 200 条：（无）\n'
  + '不在清单里不证明没做。\n\n### 已经写过的结论\n（无）\n\n### 要核对的调用\n'
  + '- #1 shell：没展开，按判断不了处理。\n'
  + '  这条命令没有全文，两个结论（做没做完、会不会是崩溃的原因）一律按判断不了处理；你看到的痕迹照样写进依据。\n\n'
  + '### 每条要回答两件事\n1. 做没做完：已做 / 没做 / 做了一半 / 判断不了，附依据；\n'
  + '2. 会不会就是 Host 崩溃的原因：不太可能 / 可能 / 判断不了，附依据（命令本身、留下的痕迹）。';
/** The tail reminder section (hand-written, 41 bytes). */
const REVIEW_REMINDERS = '## Reminders\nPC2_ANOMALY\nPC2_AFTER_REVIEW';

describe('PC-21 the renderer material and its re-render', () => {
  it('keeps the plan, the billed bytes, the omission metadata and the reminder byte for byte', () => {
    const first = renderContext({
      prelude: 'PRE', required: { role: 'r', goal: null, task: 't' }, optional: {},
      continuationSuffix: null, reviewSuffix: 'REVIEW-1', residentBudgetBytes: 4096,
      takesSessionHistory: true, texts: PACK, toolNames: ['read'],
    });
    expect(first.input).toBe('PRE\n\nR\nr\nSTALE\n\nT\nt\n\nREVIEW-1');
    expect(first.residentBytes).toBe(0);
    // The material carries the frozen plan, the billed bytes and the frozen tool list.
    expect(first.material).toMatchObject({
      templateId: 'work-input', toolNames: ['read'], residentBudgetBytes: 4096, residentBytes: 0,
    });
    expect(first.material.sections).toEqual([
      { name: 'role', omitted: 0, wholeOmitted: false },
      { name: 'task', omitted: 0, wholeOmitted: false },
      { name: 'unknown_call_review', omitted: 0, wholeOmitted: false },
    ]);
    expect(first.material.slots).not.toHaveProperty('unknown_call_review');

    const rerendered = rerenderContextV1(first.material, 'REVIEW-2-LONGER');
    expect(rerendered.input).toBe('PRE\n\nR\nr\nSTALE\n\nT\nt\n\nREVIEW-2-LONGER');
    expect(rerendered.residentBytes).toBe(0);
    expect(rerendered.totalBytes).toBe(36);
    expect(rerendered.sections).toEqual([
      { name: 'role', startByte: 5, endByte: 14, omitted: 0 },
      { name: 'task', startByte: 16, endByte: 19, omitted: 0 },
      { name: 'unknown_call_review', startByte: 21, endByte: 36, omitted: 0 },
    ]);
    // The role range, reminder included, is unchanged byte for byte.
    expect(rerendered.input.slice(5, 14)).toBe('R\nr\nSTALE');
    expect(first.input.slice(5, 14)).toBe('R\nr\nSTALE');
  });

  it('the book\'s budget example keeps reminders over inputs while displaying them last', () => {
    const result = renderContext({
      prelude: 'PRE', required: { role: 'r', goal: null, task: null },
      optional: {
        footprint: [{ key: 'f', text: 'f' }], notes: [{ key: 'n', text: 'n' }],
        reminders: [{ key: 'm', text: 'm' }], inputs: [{ key: 'i', text: 'I'.repeat(40) }],
      },
      continuationSuffix: null, residentBudgetBytes: 49, takesSessionHistory: false, texts: PACK,
    });
    // All kept bills 59; k = 4 is 59 > 49, k = 3 is 49 <= 49, so inputs lose the row.
    expect(result.input).toBe("PRE\n\nR\nr\n\nF\nf\n\nN\nn\n\nI\n另有 1 条，用‘看’读\n\nM\nm");
    expect(result.residentBytes).toBe(49);
    expect(result.material.residentBytes).toBe(49);
    expect(result.material.sections).toEqual([
      { name: 'role', omitted: 0, wholeOmitted: false },
      { name: 'footprint', omitted: 0, wholeOmitted: false },
      { name: 'notes', omitted: 0, wholeOmitted: false },
      { name: 'inputs', omitted: 1, wholeOmitted: false },
      { name: 'reminders', omitted: 0, wholeOmitted: false },
    ]);
    const rerendered = rerenderContextV1(result.material, 'REVIEW');
    // Only the review slot was added; the budget's choice and omission row are unchanged.
    expect(rerendered.input).toBe("PRE\n\nR\nr\n\nF\nf\n\nN\nn\n\nI\n另有 1 条，用‘看’读\n\nREVIEW\n\nM\nm");
    expect(rerendered.residentBytes).toBe(49);
    expect(rerendered.totalBytes).toBe(65);
  });
});

describe('PC-21 a real K3 shrink reaches the entry', () => {
  it('renders the shrunk review and the tail reminder at the hand-computed ranges and starts', async () => {
    const fixture = await openPC2ReviewFixture('shrink');
    try {
      expect(fixture.preparation.status, JSON.stringify(fixture.preparation)).toBe('ready');
      const manifest = fixture.manifest;
      if (manifest === null) throw new Error('PC-21 the review preparation must be ready');
      const review = manifest.unknownCallReview;
      if (review === undefined) throw new Error('PC-21 the review Run must carry its review input');
      // The actual 64 KiB command lead was unexpanded, not prefixed into the input.
      expect(review.items).toHaveLength(1);
      expect(review.items[0]).toMatchObject({ alias: 1, toolName: 'shell', display: 'unexpanded', command: null });
      expect(manifest.input.includes('Q'.repeat(64))).toBe(false);
      expect(Buffer.byteLength(SHRUNK_REVIEW, 'utf8')).toBe(777);
      expect(Buffer.byteLength(REVIEW_REMINDERS, 'utf8')).toBe(41);

      // The shrunk input is the whole re-render, not the stale prefix cut.
      expect(Buffer.byteLength(manifest.input, 'utf8')).toBe(2195);
      expect(manifest.contextAssembly.totalBytes).toBe(2195);
      expect(manifest.contextAssembly.sections).toEqual([
        { name: 'role', startByte: 127, endByte: 622, omitted: 0 },
        { name: 'goal', startByte: 624, endByte: 656, omitted: 0 },
        { name: 'task', startByte: 658, endByte: 1373, omitted: 0 },
        { name: 'unknown_call_review', startByte: 1375, endByte: 2152, omitted: 0 },
        { name: 'reminders', startByte: 2154, endByte: 2195, omitted: 0 },
      ]);
      // The billed bytes and the omission metadata are the material's, not the
      // difference between the last sections.
      expect(manifest.contextAssembly.residentBytes).toBe(43);
      expect(manifest.contextAssembly.residentBudgetBytes).toBe(4096);
      expect(manifest.contextAssembly.sections.every(section => section.omitted === 0)).toBe(true);

      const bytes = Buffer.from(manifest.input, 'utf8');
      expect(bytes.subarray(1375, 2152).toString('utf8')).toBe(SHRUNK_REVIEW);
      expect(bytes.subarray(2154, 2195).toString('utf8')).toBe(REVIEW_REMINDERS);

      const started = await fixture.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

describe('PC-21 a person\'s legal order reaches the entry guard and a changed character is invalid', () => {
  it('follows the template order, admits the non-tail continuation and rejects a changed character', async () => {
    const fixture = await openPC2EntryFixture({ model: continuationModel() });
    const admitted = await fixture.enter('non-tail');
    try {
      // The legal order is the person's work-input order projected onto the continuation call kind.
      expect(fixture.manifest.contextAssembly.sections.map(section => section.name)).toEqual([
        'role', 'goal', 'continuation', 'task', 'reminders',
      ]);
      expect(admitted.result.status, JSON.stringify(admitted.result)).toBe('ready');
      expect(admitted.callsAfter).toBe(admitted.callsBefore + 1);
    } finally {
      await fixture.close();
    }

    const changed = await openPC2EntryFixture({ model: continuationModel() });
    try {
      const rejected = await changed.enter('changed-character');
      expect(rejected.result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(rejected.callsAfter).toBe(rejected.callsBefore);
    } finally {
      await changed.close();
    }
  }, 60_000);
});
