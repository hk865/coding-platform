import type { PromptTextsV1 } from './prompt-set.js';
import { renderTemplate } from './render-template.js';

/**
 * One delivery input: its template and every slot value. `deadline` is the preformatted suffix the header appends
 * (`，截止 X`, or empty when the letter asks nothing or carries no deadline); `needsReply` and `wake` are the stored
 * send facts and render as human-readable words, never as `true`/`false`.
 */
export type DeliveryInputV1 =
  | { template: 'message-delivery'; messageId: string; sender: string; body: string; deadline?: string;
      needsReply: boolean; wake: boolean }
  | { template: 'wait-reply-delivery'; messageId: string; question: string; body: string }
  | { template: 'wait-expiry-delivery'; messageId: string; question: string; deadline: string; expiryCount: 1 | 2 }
  | { template: 'intervention-delivery'; messageId: string; body: string };

export type DeliveryTemplateIdV1 = DeliveryInputV1['template'];

/** The four delivery template ids, in the pack's order. */
export const DELIVERY_TEMPLATE_IDS: readonly DeliveryTemplateIdV1[] = [
  'message-delivery',
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
  // Every field but the template is one of the template's slots. `expiryCount`
  // renders as its decimal digit; the two send facts render as the words the
  // model reads, not as JavaScript booleans.
  const slots: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (name === 'template') continue;
    if (name === 'needsReply') slots[name] = value === true ? '是' : '否';
    else if (name === 'wake') slots[name] = value === true ? '会' : '不会';
    else slots[name] = String(value);
  }
  return renderTemplate(texts, input.template, slots, toolNames).text;
}
