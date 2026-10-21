/**
 * P3-01 proof probe, for the result copy only. Copy this file into a scratch
 * copy as tests/zz-p3-probe.test.ts. It prints PASS/FAIL lines for:
 *  - a required slot declared in the table but not used by the template text,
 *    passed as undefined, must now throw the existing error text;
 *  - every v1 template renders with exactly the slots its caller passes.
 */
import { expect, test } from 'vitest';
import { renderTemplate } from '../src/contracts/prompts/render-template.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../src/contracts/prompts/platform-pack.generated.js';

test('p3-01 required slot unused by the template text', () => {
  const pack = {
    manifest: PLATFORM_PROMPT_PACK_V1.manifest,
    templates: { ...PLATFORM_PROMPT_PACK_V1.templates, 'unknown-call-review': 'only {{writtenLines}}' },
    strings: PLATFORM_PROMPT_PACK_V1.strings,
    tools: PLATFORM_PROMPT_PACK_V1.tools,
  };
  expect(() => renderTemplate(pack, 'unknown-call-review', { writtenLines: 'w' }, []))
    .toThrow(new Error('required slot "workspaceLines" is empty in template "unknown-call-review"'));
});

test('p3-01 every v1 template renders with its callers\' slots', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['initial-planning-answer', {}],
    ['continuation-brief', { marker: 'm' }],
    ['unknown-call-review', { workspaceLines: 'w', writtenLines: 'x' }],
    ['unknown-call-proposal', { workspaceLines: 'w', writtenLines: 'x' }],
    ['consultation-received-input', { messageId: 'm', sourceJson: '{}' }],
    ['user-decision-response', { bodyJson: '{}' }],
    ['scribe-reminder', { marker: 'm', pendingCount: '1', updateDueCount: '0' }],
  ];
  for (const [id, slots] of cases) {
    const rendered = renderTemplate(PLATFORM_PROMPT_PACK_V1, id, slots, []);
    expect(rendered.text.length).toBeGreaterThan(0);
  }
});
