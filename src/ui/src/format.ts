import type { RunDisplayState, UsageEntry } from './api/types';

const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });

export const time = (value: string | null | undefined): string => (value && !Number.isNaN(Date.parse(value)) ? timeFormat.format(new Date(value)) : '—');
export const day = (value: string | null | undefined): string => (value && !Number.isNaN(Date.parse(value)) ? dayFormat.format(new Date(value)) : '—');
export const number = (value: number): string => value.toLocaleString('zh-CN');

export const runLabels: Record<RunDisplayState, string> = {
  starting: '正在启动', ongoing: '运行中', completed_run: '运行已结束', crashed: '执行失败',
  cancelled: '已取消', budget_exhausted: '达到运行限额', outcome_unknown: '结果未知', ended_no_outcome: '尚无结果',
};

export const taskPhaseLabels: Record<string, string> = {
  pending: '待处理', active: '进行中', satisfied: '已验证', blocked: '受阻', failed: '验证失败',
  COMPLETED: '已完成', IN_PROGRESS: '进行中', BLOCKED: '受阻', FAILED: '验收未通过',
};

export const runStatusLabels: Record<string, string> = {
  prepared: '排队等待执行', running: '正在执行', completed: '运行已结束', failed: '执行失败',
  cancelled: '运行已取消', budget_exhausted: '达到运行限额', outcome_unknown: '结果未知',
};

export const eventLabels: Record<string, string> = {
  goal_created: '目标已创建', plan_accepted: '执行计划已接受', task_claimed: '已领取任务',
  run_started: '开始运行', run_event: '运行记录已更新', run_outcome_unknown: '运行结果待确认',
  evidence_admitted: '收到验证证据', task_reduction: '任务判定已更新', goal_phase: '目标状态已更新',
  handoff_recorded: '已记录交接材料', replacement_claimed: '替代 Agent 已接手',
};

export function summarizeUsage(usage: UsageEntry[] = []): { input: number; output: number; cached: number; requests: number; unknown: number } {
  const total = { input: 0, output: 0, cached: 0, requests: usage.length, unknown: 0 };
  for (const entry of usage) {
    if (entry.status !== 'reported' || !Number.isFinite(entry.inputTokens) || !Number.isFinite(entry.outputTokens)) total.unknown += 1;
    if (Number.isFinite(entry.inputTokens)) total.input += entry.inputTokens ?? 0;
    if (Number.isFinite(entry.outputTokens)) total.output += entry.outputTokens ?? 0;
    if (Number.isFinite(entry.cachedInputTokens)) total.cached += entry.cachedInputTokens ?? 0;
  }
  return total;
}

export function toolCommand(call: { name?: string; arguments?: Record<string, unknown> } | undefined): string {
  if (!call) return '工具调用';
  const args = call.arguments ?? {};
  const value = args['command'] ?? args['path'] ?? args['pattern'] ?? args['query'] ?? call.name;
  return String(value ?? '工具调用');
}

export const toolNames: Record<string, string> = {
  shell: '执行命令', read: '读取文件', edit: '修改文件', write: '写入文件', search: '搜索', glob: '查找文件', code_index: '源码查询', list: '列出目录',
};

export function statusTone(status: string): 'green' | 'red' | 'yellow' | 'gray' | 'blue' {
  if (['completed', 'satisfied', 'COMPLETED', 'PASS', 'ready', 'finished'].includes(status)) return 'green';
  if (['failed', 'FAILED', 'crashed', 'error', 'rejected'].includes(status)) return 'red';
  if (['outcome_unknown', 'blocked', 'BLOCKED', 'budget_exhausted', 'interrupted', 'stale'].includes(status)) return 'yellow';
  if (['running', 'ongoing', 'prepared', 'starting', 'active', 'IN_PROGRESS'].includes(status)) return 'blue';
  return 'gray';
}

export function isActiveRun(status: string): boolean { return status === 'prepared' || status === 'running'; }

export function fileLineLabel(lines: { start: number; end: number } | undefined): string {
  if (!lines) return '';
  return lines.start === lines.end ? ':' + lines.start : ':' + lines.start + '-' + lines.end;
}

