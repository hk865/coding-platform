/**
 * Hand-written expected delivery texts: the eight delivery-set template ids in
 * the order a preparation freezes them after its used templates, the eight
 * platform template files byte for byte, and one formatter per delivery
 * template that fills its slots by plain concatenation. Every literal is copied
 * by hand from the frozen template rules; nothing here imports production code
 * or calls production rendering. Hand-written packs and frozen template lists
 * spread the ids and texts from here instead of writing the eight entries again.
 */

/** The six delivery templates in the platform pack's order, then the decision response. The link-break input is last. */
export const DELIVERY_SET_IDS = [
  'action-request-delivery',
  'inquiry-delivery',
  'notify-delivery',
  'wait-reply-delivery',
  'wait-expiry-delivery',
  'intervention-delivery',
  'user-decision-response',
  'link-breaks-input',
] as const;

/** The committed platform template files, byte for byte, with no trailing newline. */
export const DELIVERY_SET_TEXTS = {
  'action-request-delivery': '请处理这条动作请求（消息 {{messageId}}，来自 {{sender}}）：\n{{body}}',
  'inquiry-delivery': '请回答这条询问（消息 {{messageId}}，来自 {{sender}}，截止 {{deadline}}）：\n{{body}}',
  'notify-delivery': '通知（消息 {{messageId}}，来自 {{sender}}）：\n{{body}}',
  'wait-reply-delivery': '你的问题有了回复（消息 {{messageId}}）。\n你的问题：\n{{question}}\n回复：\n{{body}}',
  'wait-expiry-delivery':
    '你的问题到截止时间还没有回复（消息 {{messageId}}，截止 {{deadline}}，第 {{expiryCount}} 次到期）。\n你的问题：\n{{question}}',
  'intervention-delivery': '用户插话（消息 {{messageId}}）：\n{{body}}',
  'user-decision-response': '用户答复\n{{bodyJson}}',
  'link-breaks-input': '联系 {{noteId}}（版本 {{version}}）被这次改动改断了：证据对不上（下标 {{missing}}）。交结果之前请重写或撤下它。',
} as const;

// One formatter per delivery template: its platform text above with every slot
// value inserted verbatim, by concatenation only; `expiryCount` reads as its digit.

export function actionRequestDeliveryText(s: { messageId: string; sender: string; body: string }): string {
  return '请处理这条动作请求（消息 ' + s.messageId + '，来自 ' + s.sender + '）：\n' + s.body;
}

export function inquiryDeliveryText(s: { messageId: string; sender: string; body: string; deadline: string }): string {
  return '请回答这条询问（消息 ' + s.messageId + '，来自 ' + s.sender + '，截止 ' + s.deadline + '）：\n' + s.body;
}

export function notifyDeliveryText(s: { messageId: string; sender: string; body: string }): string {
  return '通知（消息 ' + s.messageId + '，来自 ' + s.sender + '）：\n' + s.body;
}

export function waitReplyDeliveryText(s: { messageId: string; question: string; body: string }): string {
  return '你的问题有了回复（消息 ' + s.messageId + '）。\n你的问题：\n' + s.question + '\n回复：\n' + s.body;
}

export function waitExpiryDeliveryText(
  s: { messageId: string; question: string; deadline: string; expiryCount: 1 | 2 },
): string {
  return '你的问题到截止时间还没有回复（消息 ' + s.messageId + '，截止 ' + s.deadline + '，第 ' + s.expiryCount
    + ' 次到期）。\n你的问题：\n' + s.question;
}

export function interventionDeliveryText(s: { messageId: string; body: string }): string {
  return '用户插话（消息 ' + s.messageId + '）：\n' + s.body;
}
