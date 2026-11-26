/**
 * G-01, G-02, G-12 (spec :116, :186, N13): every stage has a stage gate, the
 * model writes it and the reviewer checks it, and the platform adds no check.
 * The rule only exists if it reaches the model through these prompts, and the
 * stage gate only covers its own stage's work (SK-2). The last row is pure
 * rendering: the executor's share-only block is mounted by the tools it names,
 * so a Query round never pays for it.
 */
import { describe, expect, it } from 'vitest';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

const PER_STAGE_GATE = /(stage[- ]gate|阶段 ?gate|(each|every|per)[- ]stage[^.\n]{0,40}gate|每(个|一)?(阶段|段)[^。\n]{0,30}gate)/i;

/** The frozen anchors of the SK rulings, by name. */
const ANCHOR = {
  K1: 'Each stage has exactly one required stage gate',
  K2: 'goal-scoped work counts for no stage gate',
  K2z: '阶段 gate 只覆盖同段',
  K3: 'when the change replaces or drops what a task does',
  K4: 'a validation problem is never a reason to answer questions',
  K4z: '`ideas` 空就没有规划轮',
  K5: '回复前不结束任务',
  K5b: "no check stands in for the person's decision",
  K6: '用 `project_source` 的 compare',
  K7: '填 followupOf 指向原消息',
  K7b: '那一组调用里只放这一条',
  K8: '不拿已装的旧检查当候选',
  K9: 'double quotes eat one backslash',
  EXECUTOR_SHARE: '执行者做事轮按第 3–6 步',
} as const;

const template = (id: string): string => PACK.templates[id] ?? '';
const parameter = (tool: string, path: string): string => PACK.tools[tool]?.parameters[path] ?? '';
const toolDescription = (tool: string): string => PACK.tools[tool]?.description ?? '';

describe('G-01/G-02/G-12: the per-stage gate rule reaches the model', () => {
  it.each(['initial-planning-answer', 'skill-platform-adviser', 'plan-review-input', 'skill-platform-reviewer'])(
    '%s names the rule', (id) => {
      expect(PACK.templates[id] ?? '').toMatch(PER_STAGE_GATE);
    });

  // T4 ①: SK-1 puts the same rule in the two tools that write the plan.
  it.each([
    ['submit_initial_plan', 'plan.tasks'],
    ['propose_future_plan', 'draft'],
  ])('%s names the rule in %s', (tool, path) => {
    expect(parameter(tool, path)).toMatch(PER_STAGE_GATE);
  });

  // T4 ②: one anchor, one named place; each entry fails alone.
  const PLACES: ReadonlyArray<readonly [place: string, anchor: string, read: () => string]> = [
    ['submit_initial_plan plan.tasks', ANCHOR.K1, () => parameter('submit_initial_plan', 'plan.tasks')],
    ['submit_initial_plan plan.tasks', ANCHOR.K2, () => parameter('submit_initial_plan', 'plan.tasks')],
    ['propose_future_plan draft', ANCHOR.K1, () => parameter('propose_future_plan', 'draft')],
    ['propose_future_plan draft', ANCHOR.K2, () => parameter('propose_future_plan', 'draft')],
    ['submit_initial_plan plan.assignments', ANCHOR.K5b, () => parameter('submit_initial_plan', 'plan.assignments')],
    ['submit_initial_plan setup.checks', ANCHOR.K9, () => parameter('submit_initial_plan', 'setup.checks')],
    ['initial-planning-answer', ANCHOR.K2, () => template('initial-planning-answer')],
    ['initial-planning-answer', ANCHOR.K3, () => template('initial-planning-answer')],
    ['initial-planning-answer', ANCHOR.K4, () => template('initial-planning-answer')],
    ['initial-planning-answer', ANCHOR.K9, () => template('initial-planning-answer')],
    ['plan-review-input', ANCHOR.K2z, () => template('plan-review-input')],
    ['plan-review-input', ANCHOR.K8, () => template('plan-review-input')],
    ['skill-platform-secretary', ANCHOR.K4z, () => template('skill-platform-secretary')],
    ['send_session_message', ANCHOR.K7, () => toolDescription('send_session_message')],
    ['send_session_message', ANCHOR.K7b, () => toolDescription('send_session_message')],
  ];
  it.each(PLACES)('%s carries %s', (place, anchor, read) => {
    expect(read(), place).toContain(anchor);
  });

  // T4 ③: W1 and SK-6 render only where the executor can act on them.
  it('the work skill keeps the share steps and the duplicate check behind their tools', () => {
    const message = renderTemplate(PACK, 'skill-platform-work', {}, ['send_session_message']).text;
    expect(message, 'K5 needs the message tool').toContain(ANCHOR.K5);

    const editAndSource = renderTemplate(PACK, 'skill-platform-work', {}, ['edit', 'project_source']).text;
    expect(editAndSource, 'K6 needs edit and project_source').toContain(ANCHOR.K6);
    expect(editAndSource, 'the share steps need edit').toContain(ANCHOR.EXECUTOR_SHARE);

    const sourceOnly = renderTemplate(PACK, 'skill-platform-work', {}, ['project_source']).text;
    expect(sourceOnly, 'K6 stays out of a round that cannot edit').not.toContain(ANCHOR.K6);
    expect(sourceOnly, 'the share steps stay out of a round that cannot edit').not.toContain(ANCHOR.EXECUTOR_SHARE);
  });
});
