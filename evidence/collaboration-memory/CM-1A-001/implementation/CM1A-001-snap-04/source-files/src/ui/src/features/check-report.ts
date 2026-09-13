/**
 * Adapter between the persisted command-check report and what the workbench shows.
 *
 * The server returns {requestId, status, reports[]}; the command, classification
 * and sandbox output live INSIDE each report body, and the record lifecycle
 * ("finished") is not the check verdict (PASS/FAIL/INCONCLUSIVE). This module is
 * the single place that reads those fields, so a shape drift is a type error and
 * a missing field is reported as missing instead of being silently dropped.
 */
import type { CheckReportsResponse, CommandCheckReportBody } from '../api/types';

export const categoryLabels: Record<string, string> = {
  tool_check: '工具检查', timeout: '执行超时', environment_error: '环境异常', stale_source: '来源已变化',
  runtime_error: '运行异常', cancelled: '已取消', unknown_effects: '副作用未知',
};
export const resultLabels: Record<string, string> = { PASS: 'PASS（通过）', FAIL: 'FAIL（失败）', INCONCLUSIVE: 'INCONCLUSIVE（不确定）' };
export const lifecycleLabels: Record<string, string> = { running: '检查中', finished: '检查结束', interrupted: '检查中断（结果未知）' };
export const checkpointLabels: Record<string, string> = { intent_recorded: '请求已记录', acquisition_rejected: '未执行：工作区租约未获准', lease_acquired: '已取得工作区租约', executing: '执行已开始', report_stored: '报告正文已保存', result_recorded: '结果已记录', lease_released: '工作区租约已释放', reconciliation_required: '检查需要对账' };

export type ReportView = {
  observationId: string;
  checkId: string;
  kind: string;
  command: string;
  cwd: string;
  category: string;
  result: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  signal: string | null;
  stdout: string;
  stdoutTruncated: boolean;
  stderr: string;
  stderrTruncated: boolean;
  sourceDigest: string;
  workspaceRevision: number | null;
  planRef: string | null;
  startedAt: string;
  endedAt: string;
  sandboxProfileVersion: string | null;
  /** Fields the persisted record does not contain — shown as missing, never guessed. */
  missing: string[];
};

export type CheckReportView = {
  requestId: string;
  lifecycle: string;
  command: string | null;
  kind: string | null;
  timeoutMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  observations: Array<{ checkId: string; kind: string; result: string; summary: string; reportSaved: boolean }>;
  reports: ReportView[];
  /** True when at least one observation has no persisted report body. */
  reportsMissing: boolean;
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function adaptReport(body: CommandCheckReportBody): ReportView {
  const missing: string[] = [];
  const definition = body.definition ?? ({} as CommandCheckReportBody['definition']);
  const context = body.context ?? ({} as CommandCheckReportBody['context']);
  const execution = body.execution;
  if (!body.definition) missing.push('检查定义');
  if (!body.context) missing.push('上下文');
  if (execution === null || execution === undefined) missing.push('沙箱执行结果');
  return {
    observationId: text(body.observationId) || '—',
    checkId: text(definition.checkId) || '—',
    kind: text(definition.kind) || '—',
    command: text(definition.command) || '—',
    cwd: text(definition.cwd) || '—',
    category: categoryLabels[text(body.category)] ?? (text(body.category) || '—'),
    result: resultLabels[text(body.result)] ?? (text(body.result) || '—'),
    exitCode: num(execution?.exitCode),
    timedOut: execution?.timedOut === true,
    cancelled: execution?.cancelled === true,
    signal: execution?.signal ?? null,
    stdout: text(execution?.stdout?.text),
    stdoutTruncated: execution?.stdout?.truncated === true,
    stderr: text(execution?.stderr?.text),
    stderrTruncated: execution?.stderr?.truncated === true,
    sourceDigest: text(body.sourceDigest) || '—',
    workspaceRevision: num(context.workspaceRevision),
    planRef: context.planRef ? text(context.planRef.planId) || null : null,
    startedAt: text(body.startedAt) || '—',
    endedAt: text(body.endedAt) || '—',
    sandboxProfileVersion: execution?.sandboxProfileVersion ?? null,
    missing,
  };
}

export function adaptCheckReport(response: CheckReportsResponse): CheckReportView {
  const reports = (response.reports ?? []).map(adaptReport);
  const observations = (response.observations ?? []).map(observation => ({
    checkId: observation.checkId,
    kind: observation.kind,
    result: resultLabels[observation.result] ?? observation.result,
    summary: observation.summary,
    reportSaved: !!observation.artifactRef,
  }));
  return {
    requestId: response.requestId,
    lifecycle: lifecycleLabels[response.status] ?? response.status,
    command: response.command,
    kind: response.kind,
    timeoutMs: response.timeoutMs,
    startedAt: response.startedAt,
    finishedAt: response.finishedAt,
    observations,
    reports,
    reportsMissing: observations.some(observation => !observation.reportSaved) || (observations.length > 0 && reports.length === 0),
  };
}

/** The first observation verdict, which is the check verdict the list column shows. */
export function checkVerdict(check: { result?: unknown }): string {
  const result = check.result as { status?: string; observations?: Array<{ result?: string }> } | null | undefined;
  if (!result) return '尚无报告';
  if (result.status === 'rejected') return '被拒绝';
  if (result.status === 'incomplete') return '材料不完整';
  const verdict = result.observations?.[0]?.result;
  return verdict ? (resultLabels[verdict] ?? verdict) : '尚无报告';
}
