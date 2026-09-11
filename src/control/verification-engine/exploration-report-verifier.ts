import { createHash } from 'node:crypto';
import type { ArtifactPort, ArtifactRef } from '../../contracts/artifact.js';
import type { ExplorationScope as Scope, ExplorationPlan, ExplorationReport, ExplorationReview as Review } from '../../contracts/exploration.js';
import type { ExplorationSessionContextPort, ExplorationReportPort, ExplorationRunObservation } from '../../contracts/exploration-session.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const scopeKey = (scope: Scope) => canonicalJson([scope.projectId, scope.workspaceId, scope.goalId]);
function ensure(value: unknown, message: string): asserts value {
  if (!value)
    throw Error(message);
}
function text(value: unknown, label: string, cap = 4096): string {
  ensure(typeof value === 'string' && value.trim() && value.length <= cap, '无效字段：' + label);
  return value.trim();
}
function object(value: unknown): Record<string, unknown> {
  ensure(value && typeof value === 'object' && !Array.isArray(value), '需要探索任务对象');
  return value as Record<string, unknown>;
}
/** Qualifies actual readonly observations and persists their source-bound report. No Task completion authority. */
export class ExplorationReportVerifier implements ExplorationReportPort {
  constructor(private readonly deps: {
    context: Pick<ExplorationSessionContextPort, 'current' | 'run' | 'taskPhase'>;
    vault: Pick<ArtifactPort, 'put'>;
  }) { }
  private async artifact(scope: Scope, ownerRunId: string, body: string, at: string): Promise<ArtifactRef> {
    const stored = await this.deps.vault.put({
      ownerRef: { aggregateType: 'Run', projectId: scope.projectId, goalId: scope.goalId, runId: ownerRunId },
      body,
      contentType: 'text/plain',
      requestedAt: at,
      sourceRefs: [{ kind: 'artifact', refId: digest(body), revision: '1', digest: digest(body) }]
    });
    ensure(stored.status === 'stored', '探索材料保存失败');
    return stored.ref;
  }
  async reportArtifact(report: Omit<ExplorationReport, 'artifactRef'> | ExplorationReport) {
    // Bind newly produced chunks to their original producer. Identical prose in
    // different goals must not collide with a different goal's first owner.
    const chunks: ArtifactRef[] = [];
    for (let p = 0; p < report.report.length; p += 8000)
      chunks.push(await this.artifact(
        report,
        report.runId,
        canonicalJson({
          scope: scopeKey(report),
          runId: report.runId,
          part: chunks.length,
          text: report.report.slice(p, p + 8000)
        }),
        report.completedAt
      ));
    return this.artifact(
      report,
      report.runId,
      canonicalJson({
        scope: scopeKey(report),
        taskId: report.taskId,
        runId: report.runId,
        planRef: report.planRef,
        workspaceRevision: report.workspaceRevision,
        sourceDigest: report.sourceDigest,
        reportDigest: report.reportDigest,
        sourceReads: report.sourceReads,
        chunkEncoding: 'scoped-json-v1',
        chunks
      }),
      report.completedAt
    );
  }
  async capture(scope: Scope, manifest: ExplorationPlan, record: ExplorationRunObservation) {
    ensure(record.status === 'completed' && record.spec.mode === 'explore' && scopeKey(record.spec) === scopeKey(scope), '必须是当前作用域已完成的真实探索运行');
    const ctx = await this.deps.context.current(scope, manifest),
      run = await this.deps.context.run(scope, record.spec.runId);
    ensure(run, '探索运行没有正式记录');
    ensure(
      run.status === 'ended' && run.outcome === 'completed' && run.envelope && run.envelope.taskId === record.spec.taskId && canonicalJson(run.envelope.planRef) === canonicalJson(ctx.plan.ref) && run.envelope.workspaceSnapshot.revision === ctx.workspaceRevision,
      '探索运行与当前正式计划或工作区不匹配'
    );
    ensure(!run.envelope.permissions.tools.some(t => t !== 'read') && run.envelope.permissions.writeScope.length === 0, '探索运行不是只读声明');
    const messages = record.trace.filter(e => e.type === 'assistant.message_completed').map(e => object(e.data));
    const last = messages.at(-1);
    ensure(last && Array.isArray(last['toolCalls']) && last['toolCalls'].length === 0, '探索运行缺少最终助手报告');
    const report = text(object(last['message'])['content'], '最终报告', 262144);
    const calls = new Map<string, Record<string, unknown>>();
    const reads: ExplorationReport['sourceReads'] = [];
    for (const event of record.trace) {
      if (event.type === 'tool.started') {
        const call = object(object(event.data)['call']);
        if (typeof call['callId'] === 'string')
          calls.set(call['callId'], call);
      }
      if (event.type !== 'tool.completed')
        continue;
      const data = object(event.data),
        callId = data['callId'];
      if (typeof callId !== 'string' || calls.get(callId)?.['name'] !== 'read')
        continue;
      const result = object(data['result']);
      if (result['status'] !== 'success' || !Array.isArray(result['output']))
        continue;
      for (const item of result['output']) {
        const output = object(item);
        if (output['kind'] !== 'json')
          continue;
        const value = object(output['value']);
        if (typeof value['path'] === 'string' && typeof value['revision'] === 'string' && typeof value['startLine'] === 'number' && typeof value['endLine'] === 'number')
          reads.push({
            path: value['path'],
            startLine: value['startLine'],
            endLine: value['endLine'],
            revision: value['revision'],
            callId
          });
      }
    }
    ensure(reads.length > 0 && reads.length <= 1000, '探索报告缺少成功的真实 read 来源');
    const draft = {
      ...scope,
      taskId: record.spec.taskId,
      runId: record.spec.runId,
      report,
      reportDigest: digest(report),
      sourceDigest: ctx.manifest.sourceDigest,
      workspaceRevision: ctx.workspaceRevision,
      planRef: ctx.plan.ref,
      completedAt: record.events.at(-1)?.occurredAt ?? new Date().toISOString(),
      sourceReads: reads
    };
    return { ...draft, artifactRef: await this.reportArtifact(draft) };
  }
  async satisfiedReports(scope: Scope, plan: ExplorationPlan, availableReports: readonly ExplorationReport[], reviews: readonly Review[]) {
    const reports: ExplorationReport[] = [];
    for (const task of plan.tasks) {
      const phase = await this.deps.context.taskPhase(scope, task.taskId);
      ensure(phase === 'satisfied', '整体核验前工作节点必须正式满足：' + task.taskId);
      const review = reviews.find(r => scopeKey(r) === scopeKey(scope) && r.taskId === task.taskId && r.verdict === 'PASS' && r.control.status === 'applied');
      const report = availableReports.find(r => scopeKey(r) === scopeKey(scope) && r.taskId === task.taskId && r.runId === review?.runId);
      ensure(report, '整体核验缺少真实已审阅报告：' + task.taskId);
      reports.push(report);
    }
    return reports;
  }
}
