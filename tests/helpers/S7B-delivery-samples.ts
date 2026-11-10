/**
 * Hand-written expected delivery texts: the ten delivery-set template ids in
 * the order a preparation freezes them after its used templates, the ten
 * platform template files byte for byte, and one formatter per delivery
 * template that fills its slots by plain concatenation. Every literal is copied
 * by hand from the frozen template rules; nothing here imports production code
 * or calls production rendering. Hand-written packs and frozen template lists
 * spread the ids and texts from here instead of writing the ten entries again.
 */

/**
 * The six delivery templates in the platform pack's order, then the decision response. The Python syntax input,
 * then the context-summary request (slice-K2-SPEC L18), are last.
 */
export const DELIVERY_SET_IDS = [
  'action-request-delivery',
  'inquiry-delivery',
  'notify-delivery',
  'wait-reply-delivery',
  'wait-expiry-delivery',
  'intervention-delivery',
  'user-decision-response',
  'link-breaks-input',
  'python-syntax-input',
  'context-summary-request',
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
  'python-syntax-input': 'Python 文件有语法错：{{problems}}。先改语法错，再继续。',
  'context-summary-request': [
    '请把上面这段对话写成一份压缩摘要。之后这条线只看这份摘要和最近几轮的原文，更早的原文不再交给你；原记录不会删除。',
    '',
    '只回答摘要正文，不要调用工具。摘要按顺序分成下面六段，每段用给定的标题，一段都不能少；某段没有内容就写“无”。',
    '',
    '## 目标和验收义务',
    '## 用户原话和要求',
    '## 做过的决定和依据',
    '## 没解决的事',
    '## 试过什么、结果如何',
    '## 来源',
    '',
    '写的时候：',
    '- 用户的原话照抄，不改写；你推测的，标“推测”。',
    '- “没解决的事”写待处理的请求、在等的回复、待放行的事和未决问题。',
    '- “试过什么、结果如何”也写失败的和排除的路。',
    '- 注记和当前理解只写链接，不抄内容。',
    '- 计划和派工只写引用和版本；下一轮照旧重读正式事实。',
    '- 还在等批准的，不能写成已批准。',
    '- 已经撤下的结论，不要从旧摘要里再写回来。',
    '- “来源”一行一条，只用下面四种写法：',
    '  - 文件 <工作区相对路径>',
    '  - 文件 <路径> 提交 <40–64 位小写十六进制>',
    '  - 消息 <messageId>',
    '  - 检查 <goalId>/<taskId>/<runId>/<roundId>',
    '  提交只能写成“文件在某个提交里的版本”，不要单写提交号。',
  ].join('\n'),
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
