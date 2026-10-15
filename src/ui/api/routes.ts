/** Core route tables: the graph-write routes and the product-language route labels. */

import type { CoreRouteSuffix } from '../../app/core-http-types.js';

export const GRAPH_WRITE_ROUTES = new Set<CoreRouteSuffix>([
  'controls/submit',
  'projects/create', 'workspaces/register', 'completion-policies/install',
  'completion-policies/activate', 'goals/create', 'architecture/adopt-initial',
  'architecture/capture', 'plans/propose', 'plans/apply', 'messages/send',
  'queries/submit', 'queries/claim',
]);

const ROUTE_LABELS: Record<CoreRouteSuffix, string> = {
  'controls/submit': '提交控制', 'controls/read': '查看控制事实', 'controls/deliver': '投递控制', 'executions/start': '继续原执行',
  'projects/create': '创建项目',
  'workspaces/register': '登记工作区',
  'completion-policies/install': '安装完成策略',
  'completion-policies/activate': '启用完成策略',
  'completion-policies/read': '查看当前完成策略',
  'goals/create': '创建目标',
  'goals/read': '查看目标',
  'architecture/adopt-initial': '采用初始架构',
  'architecture/read': '查看采用架构',
  'architecture/capture': '捕获观察结构',
  'architecture/query': '查看观察结构',
  'plans/propose': '提交计划草案',
  'plans/apply': '采用计划',
  'plans/proposal': '查看计划草案',
  'tasks/query': '查看任务图',
  'files/read': '读取文件',
  'source/capture': '捕获来源',
  'source/query': '列出文件',
  'sessions/find': '查看会话',
  'sessions/read': '查看会话详情',
  'sessions/operation': '刷新创建状态',
  'runtime/capabilities': '查看 Runtime 能力',
  'sessions/create': '创建会话',
  'sessions/history': '查看原历史',
  'sessions/archive': '归档会话',
  'sessions/reactivate': '重新启用会话',
  'sessions/link': '关联工作',
  'messages/send': '发送消息',
  'messages/inbox': '查看收件箱',
  'messages/read': '查看消息',
  'messages/body': '查看消息正文',
  'messages/outbox': '查看发送记录',
  'workspaces/registration': '查看项目/工作区登记',
  'queries/submit': '提交调查',
  'queries/read': '查看调查',
  'queries/claim': '领取调查',
  'queries/prepare': '准备调查',
  'queries/start': '开始调查',
  'queries/observe': '刷新调查状态',
  'queries/answer': '查看调查回答',
  'materials/open': '读取材料',
  'workflow/goal-input': '提交规划输入',
  'workflow/advance': '推进执行',
  'workflow/consultation': '处理咨询',
  'workflow/driver-start': '启动协同推进',
  'workflow/driver-read': '查看协同推进',
  'workflow/driver-stop': '停止协同推进',
  'executions/read': '查看执行事实',
  'executions/history': '查看本次执行原历史',
  // MVP UI connection suffixes. These are display labels only; the Stage-2 UI
  // wiring owns the real actions and is intentionally NOT implemented here.
  'executions/list': '查看执行列表',
  'projects/read': '查看项目',
  'files/list': '列出目录',
  'files/save': '保存文件',
  'files/compare': '比较文件',
  'commands/start': '运行命令',
  'commands/read': '查看命令输出',
  'commands/stop': '停止命令',
  // A.2 step 5.4 suffixes: display labels only (the label table is total over
  // CoreRouteSuffix); the actions are the new UI's (task E3).
  'tasks/requeue': '重新入队 / 继续',
  'executions/brief': '查看接续说明',
  // A.2 step 5.5 suffixes: display labels only (the table is total over
  // CoreRouteSuffix); the actions are the new UI's (task E3).
  'goals/control': '暂停 / 恢复 / 取消目标',
  'goals/display': '查看目标状态',
  // A.2 step 5.6 suffixes: display labels only (the table is total over
  // CoreRouteSuffix); the actions are the new UI's (task E3).
  'executions/resolve-unknown': '认定未知结果',
  'queries/resolve-unknown': '认定未知结果（查询）',
  'host/reconcile-report': '查看启动核对报告',
  // A.2 step 5.9 suffix: display label only (the table is total over
  // CoreRouteSuffix); the action is the new UI's (task E3).
  'verification/reverify': '重新检查 / 重新验收',
  // Slice 1 (Session facts, corrections and archive) suffixes: display labels
  // only (this table is total over CoreRouteSuffix); the actions are the new UI's.
  'sessions/archive-line': '归档会话（组合）',
  'sessions/archive-continue': '继续归档',
  'sessions/archive-release': '释放归档请求',
  'sessions/facts': '查看会话事实',
  'sessions/successors': '查看后继会话',
  'sessions/executions': '查看会话执行',
  'sessions/queries': '查看会话调查',
  'sessions/transfer-responsibility': '转移负责关系',
  'tasks/archive-state': '查看任务归档状态',
  'anomalies/list': '列出异常锚点',
  'messages/undelivered-replies': '查看未送达回复',
  // Slice 3 suffixes: display labels only (the table is total over
  // CoreRouteSuffix); the action is the new UI's (task E3).
  'graph/look': '查看图节点',
  'graph/find': '查找节点',
  // Slice 5 §4.5 suffixes: display labels only (the table is total over
  // CoreRouteSuffix); the actions are the new UI's (task E3).
  'goals/settings': '查看目标设置',
  'goals/settings/set': '修改目标设置',
  'goals/reorder': '调整目标顺序',
  'goals/conflicts': '查看目标冲突',
  'plans/request-candidate': '查看请求候选',
  'plans/abandon': '放弃计划候选',
  'decisions/queue': '查看决定队列',
  'decisions/card': '查看决定卡',
  'decisions/answer': '答复决定',
  'decisions/application': '记录决定落实',
  'decisions/notices/seen': '标记通知已读',
  'messages/user-send': '向用户发送消息',
  // Slice 2B L15 suffixes: display labels only (this table is total over
  // CoreRouteSuffix); the actions are the new UI's.
  'activity/calendar': '查看活动日历',
  'activity/runs': '查看执行活动',
  'activity/track': '查看轨道',
  'tasks/timeline': '查看任务时间线',
  'activity/backfill': '补算活动',
};

export const routeLabel = (route: CoreRouteSuffix): string => ROUTE_LABELS[route];
