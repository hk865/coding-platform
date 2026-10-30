import type { PromptTextsV1 } from './prompt-set.js';
import { renderTemplate } from './render-template.js';

/** One delivery input: its template and every slot value; every slot is required. */
export type DeliveryInputV1 =
  | { template: 'action-request-delivery'; messageId: string; sender: string; body: string }
  | { template: 'inquiry-delivery'; messageId: string; sender: string; body: string; deadline: string }
  | { template: 'notify-delivery'; messageId: string; sender: string; body: string }
  | { template: 'wait-reply-delivery'; messageId: string; question: string; body: string }
  | { template: 'wait-expiry-delivery'; messageId: string; question: string; deadline: string; expiryCount: 1 | 2 }
  | { template: 'intervention-delivery'; messageId: string; body: string };

export type DeliveryTemplateIdV1 = DeliveryInputV1['template'];

/** The six delivery template ids, in the pack's order. */
export const DELIVERY_TEMPLATE_IDS: readonly DeliveryTemplateIdV1[] = [
  'action-request-delivery',
  'inquiry-delivery',
  'notify-delivery',
  'wait-reply-delivery',
  'wait-expiry-delivery',
  'intervention-delivery',
];

/**
 * Renders one delivery input from an execution's frozen texts; the global pack is never a fallback.
 * `toolNames` is the execution's frozen final tool list (`PromptSetV1.toolNames`): a tool block in a delivery text
 * renders only for a tool in it, the same list the preparation's declaration check used.
 */
export function renderDeliveryInput(
  texts: PromptTextsV1, input: DeliveryInputV1, toolNames: readonly string[]): string {
  // Every field but the template is one of the template's slots; `expiryCount`
  // is the only number and renders as its decimal digit.
  const slots: Record<string, string> = {};
  for (const [name, value] of Object.entries(input))
    if (name !== 'template') slots[name] = String(value);
  return renderTemplate(texts, input.template, slots, toolNames).text;
}
