/**
 * PC-1b P (ruling 17): a K3 review entry re-renders the review instruction from
 * the template text and string table frozen in the saved manifest's
 * `promptSet`, never from the pack the fixture can change after preparation.
 *
 * The review world is reached through the frozen fixture's public steps; the
 * shell seam mock below is the same one the existing K3 tests install. The
 * injected template and string are literals.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { openPCK3ReviewFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real blocked Kernel
// call and the review round both need the same seam the K3 tests use).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

afterEach(() => shellSeam.release());

/** Literal copies of the pack's review template with a distinguishable tail. */
const REVIEW_TEMPLATE_FROZEN = '## PC 冻结复核\n\n### 工作区采集\n{{workspaceLines}}\n\n'
  + '### 已经写过的结论\n{{writtenLines}}\n\n### 要核对的调用{{items}}\n\nPC-FROZEN-REVIEW-A\n';
const REVIEW_TEMPLATE_AFTER = '## PC 冻结复核\n\n### 工作区采集\n{{workspaceLines}}\n\n'
  + '### 已经写过的结论\n{{writtenLines}}\n\n### 要核对的调用{{items}}\n\nPC-FROZEN-REVIEW-B\n';
const STATUS_LEAD_FROZEN = 'PC-FROZEN-REVIEW-STATUS-A';
const STATUS_LEAD_AFTER = 'PC-FROZEN-REVIEW-STATUS-B';

const withReviewPack = (pack: ResolvedPromptPackV1, text: string, lead: string): ResolvedPromptPackV1 =>
  ({ ...pack,
    templates: { ...pack.templates, 'unknown-call-review': text },
    strings: { ...pack.strings, 'k3.workspace.statusLead': lead } });

/** The user message the scripted model received, i.e. the frozen manifest input. */
function userText(fixture: Awaited<ReturnType<typeof openPCK3ReviewFixture>>): string {
  return (fixture.model.lastRequest()?.messages ?? [])
    .map(message => message.role === 'user' ? message.content : '').join('\n');
}

describe('PC entry frozen review text (ruling 17)', () => {
  it('admits the review Run with the frozen template and strings after the pack changes', async () => {
    const fixture = await openPCK3ReviewFixture({
      model: scriptedModel([{ text: 'PC review answer' }]),
    });
    try {
      fixture.packs.replace(withReviewPack(
        fixture.packs.snapshot(), REVIEW_TEMPLATE_FROZEN, STATUS_LEAD_FROZEN));
      await fixture.work.prepare();

      const prepared = await fixture.work.preparedTexts();
      expect(prepared.texts.templates['unknown-call-review']).toBe(REVIEW_TEMPLATE_FROZEN);
      expect(prepared.texts.strings['k3.workspace.statusLead']).toBe(STATUS_LEAD_FROZEN);
      expect(prepared.input).toContain(STATUS_LEAD_FROZEN);

      // Change the pack AFTER preparation: the entry's review re-render must use
      // the frozen text and strings, not these values.
      fixture.packs.replace(withReviewPack(
        fixture.packs.snapshot(), REVIEW_TEMPLATE_AFTER, STATUS_LEAD_AFTER));
      expect(fixture.packs.snapshot().templates['unknown-call-review']).toBe(REVIEW_TEMPLATE_AFTER);

      const started = await fixture.work.start();
      expect(started.status).toBe('ready');
      expect(userText(fixture)).toContain(STATUS_LEAD_FROZEN);
      expect(userText(fixture)).not.toContain(STATUS_LEAD_AFTER);
    } finally {
      await fixture.close();
    }
  });
});
