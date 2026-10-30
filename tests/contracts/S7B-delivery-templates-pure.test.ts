/**
 * Delivery rendering, pure: the six platform templates from the frozen sample
 * helper's literals, the same inputs against a second literal text set, and one empty
 * required slot per template. Expected values are hand-written or the frozen helper's;
 * none is derived from the pack or the renderer.
 */
import { describe, expect, it } from 'vitest';
import { DELIVERY_TEMPLATE_IDS, renderDeliveryInput, type DeliveryInputV1 } from '../../src/contracts/prompts/delivery-input.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../src/contracts/prompts/prompt-set.js';
import { PromptRenderError } from '../../src/contracts/prompts/render-template.js';
import {
  actionRequestDeliveryText, inquiryDeliveryText, interventionDeliveryText,
  notifyDeliveryText, waitExpiryDeliveryText, waitReplyDeliveryText,
} from '../helpers/S7B-delivery-samples.js';

const ACTION_REQUEST: DeliveryInputV1 = { template: 'action-request-delivery', messageId: 'm-1', sender: '林', body: '请把报告补齐。' };
const INQUIRY: DeliveryInputV1 = { template: 'inquiry-delivery', messageId: 'm-2', sender: '周', body: '是否同意？', deadline: '2026-10-30' };
const NOTIFY: DeliveryInputV1 = { template: 'notify-delivery', messageId: 'm-3', sender: '平台', body: '任务已开始。' };
const WAIT_REPLY: DeliveryInputV1 = { template: 'wait-reply-delivery', messageId: 'm-4', question: '要不要合并？', body: '先不合。' };
const WAIT_EXPIRY: DeliveryInputV1 = { template: 'wait-expiry-delivery', messageId: 'm-5', question: '要合并吗？', deadline: '2026-10-31', expiryCount: 2 };
const INTERVENTION: DeliveryInputV1 = { template: 'intervention-delivery', messageId: 'm-6', body: '先停一下。' };

const PLATFORM_ROWS: Array<{ id: string; input: DeliveryInputV1; expected: string }> = [
  { id: 'action-request-delivery', input: ACTION_REQUEST, expected: actionRequestDeliveryText({ messageId: 'm-1', sender: '林', body: '请把报告补齐。' }) },
  { id: 'inquiry-delivery', input: INQUIRY, expected: inquiryDeliveryText({ messageId: 'm-2', sender: '周', body: '是否同意？', deadline: '2026-10-30' }) },
  { id: 'notify-delivery', input: NOTIFY, expected: notifyDeliveryText({ messageId: 'm-3', sender: '平台', body: '任务已开始。' }) },
  { id: 'wait-reply-delivery', input: WAIT_REPLY, expected: waitReplyDeliveryText({ messageId: 'm-4', question: '要不要合并？', body: '先不合。' }) },
  { id: 'wait-expiry-delivery', input: WAIT_EXPIRY, expected: waitExpiryDeliveryText({ messageId: 'm-5', question: '要合并吗？', deadline: '2026-10-31', expiryCount: 2 }) },
  { id: 'intervention-delivery', input: INTERVENTION, expected: interventionDeliveryText({ messageId: 'm-6', body: '先停一下。' }) },
];

/** A second, literal text set: no text here resembles the platform's. */
const OTHER_TEXTS: PromptTextsV1 = { strings: {}, templates: {
  'action-request-delivery': 'OTHER {{messageId}}/{{sender}}/{{body}}',
  'inquiry-delivery': 'OTHER {{deadline}}|{{messageId}}|{{sender}}|{{body}}',
  'notify-delivery': 'OTHER {{sender}} => {{body}} ({{messageId}})',
  'wait-reply-delivery': 'OTHER {{question}} + {{body}} @ {{messageId}}',
  'wait-expiry-delivery': 'OTHER {{expiryCount}} {{question}} {{deadline}} {{messageId}}',
  'intervention-delivery': 'OTHER {{messageId}}: {{body}}',
} };

const OTHER_ROWS: Array<{ id: string; input: DeliveryInputV1; expected: string }> = [
  { id: 'action-request-delivery', input: ACTION_REQUEST, expected: 'OTHER m-1/林/请把报告补齐。' },
  { id: 'inquiry-delivery', input: INQUIRY, expected: 'OTHER 2026-10-30|m-2|周|是否同意？' },
  { id: 'notify-delivery', input: NOTIFY, expected: 'OTHER 平台 => 任务已开始。 (m-3)' },
  { id: 'wait-reply-delivery', input: WAIT_REPLY, expected: 'OTHER 要不要合并？ + 先不合。 @ m-4' },
  { id: 'wait-expiry-delivery', input: WAIT_EXPIRY, expected: 'OTHER 2 要合并吗？ 2026-10-31 m-5' },
  { id: 'intervention-delivery', input: INTERVENTION, expected: 'OTHER m-6: 先停一下。' },
];

const EMPTY_SLOT_ROWS: Array<{ input: DeliveryInputV1; slot: string }> = [
  { input: ACTION_REQUEST, slot: 'sender' },
  { input: INQUIRY, slot: 'deadline' },
  { input: NOTIFY, slot: 'body' },
  { input: WAIT_REPLY, slot: 'question' },
  { input: WAIT_EXPIRY, slot: 'deadline' },
  { input: INTERVENTION, slot: 'messageId' },
];
describe('the six delivery templates', () => {
  it('lists the ids in the pack order', () => {
    expect(DELIVERY_TEMPLATE_IDS).toEqual([
      'action-request-delivery', 'inquiry-delivery', 'notify-delivery',
      'wait-reply-delivery', 'wait-expiry-delivery', 'intervention-delivery',
    ]);
  });
  it.each(PLATFORM_ROWS)('$id renders the platform literal', ({ input, expected }) => expect(renderDeliveryInput(PLATFORM_PROMPT_PACK_V1, input, [])).toBe(expected));
  it.each(OTHER_ROWS)('$id follows the frozen texts, not the global pack', ({ input, expected }) => expect(renderDeliveryInput(OTHER_TEXTS, input, [])).toBe(expected));
  it.each(EMPTY_SLOT_ROWS)('$input.template rejects an empty $slot', ({ input, slot }) => {
    let thrown: unknown;
    const blank = { ...input, [slot]: '' } as unknown as DeliveryInputV1;
    try { renderDeliveryInput(PLATFORM_PROMPT_PACK_V1, blank, []); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(PromptRenderError);
    expect(thrown).toMatchObject({ code: 'required_slot_empty', slot, templateId: input.template });
  });
});
