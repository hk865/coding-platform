/**
 * O5b-R5 (`7d2-start-rulings.v4.md:6757`; O5b start rulings 5, 6, 8, 9; write-tests brief `tests-7d2-o5b2.txt`
 * "O5b-R5"): the three Skill templates whose text O5b-2 changes (adviser, reviewer, work; the scribe template is not
 * changed, ruling 5) are generated from the committed files at the tree's version plus one (adviser 9 -> 10,
 * reviewer 3 -> 4, work 10 -> 11; ruling 6) with no declared tool mention; their files' and `pack.json`'s digests are
 * the `runtime-assets.json` entries; the three new sentences (the brief's literals) render only with their tool, and
 * the reviewer's tool list renders no note tool (book §3.8 item 6, "cannot write notes").
 *
 * Digests are `node:crypto` over the committed file bytes, never the generator (rule sheet F8); `renderTemplate` and
 * `PLATFORM_PROMPT_PACK_V1` are the public surface under test, not constants an expectation is computed from.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';

/** The public export, read through the contract type so the template ids can be looked up. */
const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;
const ROOT = new URL('../../', import.meta.url);
const bytesOf = (path: string): Promise<Buffer> => readFile(new URL(path, ROOT));
const fileOf = (id: string): string => `resources/prompts/platform/templates/${id}.txt`;

// The brief's literal sentences (the two O5b-2 briefs carry them word for word).
const ADVISER_SPLIT = '- 你负责的范围太大、照这样做下去会太慢或上下文太长时，用 `propose_role_split` 把其中一部分交给一条新的同职责线：`move` 只列你现在负责的目标或区域，必须比你现有的少（至少留一项），不能列项目；平台当场核对、当场回答，被拒时照它给的原因改。';
const REVIEWER_READ_ONLY = '- 你只读：不改文件、不写注记；要记下的事实写进审阅结论，交给参谋或书记去记。';
const WORK_INQUIRY = '- 读到别的线写的注记有疑问，可以按注记的来源用 `send_session_message` 发只读问询（`inquiry`）问写它的那条线；回答你的是它的只读副本，不打断它，也不替它改主意。';
const L1 = '- 要改着试（改代码再构建、跑测试），先 `cp -r /workspace /tmp/w`，在 `/tmp/w` 里改和跑。';
const L2 = '- 只写“为什么”：原因、约定、坑、取舍和还没有答案的问题；不写“改了什么”，改了哪些文件，平台在 Run 的活动记录里自己记。';
/** The reviewer line's tools (the construction brief's item 1); both of its templates render with them. */
const REVIEWER_TOOLS = ['read', 'look_graph', 'find_graph', 'check_links', 'run_readonly_command'];

describe('O5b-R5: the pack closure and digests of the three changed Skill templates', () => {
  /* Named mutation: leave `pack.json`'s adviser entry at version 9 (and regenerate) -> the adviser row's manifest
   * `toEqual` is red; edit the adviser file without regenerating -> its text `toBe` is red. */
  it.each([
    ['skill-platform-adviser', 12], ['skill-platform-reviewer', 4], ['skill-platform-work', 11],
  ] as const)('R5-1 %s: the generated text is the file, at version %i, with no tool mention', async (id, version) => {
    expect(PACK.templates[id]).toBe((await bytesOf(fileOf(id))).toString('utf8'));
    expect(PACK.manifest.templates[id]).toEqual({ file: `templates/${id}.txt`, version, mentionsTools: [] });
  });

  /* Named mutation (v4 :6762; DR second table, R5): hand-edit one character of the adviser template's `sha256` in
   * `runtime-assets.json` -> the adviser row's `toEqual` is red. */
  it.each([
    fileOf('skill-platform-adviser'), fileOf('skill-platform-reviewer'), fileOf('skill-platform-work'),
    'resources/prompts/platform/pack.json',
  ])('R5-2 %s: the file digest is its one runtime-assets.json entry', async path => {
    const assets = JSON.parse((await bytesOf('runtime-assets.json')).toString('utf8')) as { path: string; sha256: string }[];
    expect(assets.filter(entry => entry.path === path).map(entry => entry.sha256))
      .toEqual([createHash('sha256').update(await bytesOf(path)).digest('hex')]);
  });

  /* Named mutation: drop the adviser's `{{#tool:propose_role_split}}` block -> the line `toContain` and the rendered
   * `toContain` are red; leave the sentence outside the block -> the `[]` render's `not.toContain` is red. */
  it('R5-3a adviser: the split sentence is its own propose_role_split block', () => {
    expect(PACK.templates['skill-platform-adviser']!.split(/\r?\n/)).toContain('{{#tool:propose_role_split}}');
    expect(renderTemplate(PACK, 'skill-platform-adviser', {}, ['propose_role_split']).text).toContain(ADVISER_SPLIT);
    expect(renderTemplate(PACK, 'skill-platform-adviser', {}, []).text).not.toContain(ADVISER_SPLIT);
  });

  /* Named mutation: drop the reviewer's read-only line -> its `toContain` is red; move the work template's
   * "你用 `record_note` 的 `write` 和 `withdraw`" line out of its `{{#tool:record_note}}` block -> the work
   * `not.toContain` is red. */
  it('R5-3b reviewer: it reads only, and its tool list renders no note tool', () => {
    expect(PACK.templates['skill-platform-reviewer']).toContain(REVIEWER_READ_ONLY);
    for (const id of ['skill-platform-reviewer', 'skill-platform-work']) {
      expect(renderTemplate(PACK, id, {}, REVIEWER_TOOLS).text, id).not.toContain('record_note');
    }
  });

  /* Named mutation: drop the inquiry sentence from the work template's `send_session_message` block -> the
   * `toContain` is red; leave it outside the block -> the `[]` render's `not.toContain` is red. */
  it('R5-3c work: the inquiry sentence renders only with send_session_message', () => {
    expect(renderTemplate(PACK, 'skill-platform-work', {}, ['send_session_message']).text).toContain(WORK_INQUIRY);
    expect(renderTemplate(PACK, 'skill-platform-work', {}, []).text).not.toContain(WORK_INQUIRY);
  });

  /* AGTP-8 (AGT+ ruling §3; §1 item 5): the one `/tmp` paragraph is gated by `run_readonly_command`, and the note
   * sentence is unconditional. Today both are red: the template has neither line and the pack is still version 10.
   * The package inserts L1 between §"先理解" and §"计划、实施与协调" and L2 after §"注记"'s first bullet, then regenerates
   * the pack at version 11. */
  it('AGTP-8 work: the /tmp paragraph needs the read-only command and the note rule is unconditional', () => {
    const withTool = renderTemplate(PACK, 'skill-platform-work', {}, ['run_readonly_command']).text;
    const without = renderTemplate(PACK, 'skill-platform-work', {}, []).text;
    expect(withTool).toContain(L1);
    expect(without).not.toContain(L1);
    expect(withTool).toContain(L2);
    expect(without).toContain(L2);
  });
});
