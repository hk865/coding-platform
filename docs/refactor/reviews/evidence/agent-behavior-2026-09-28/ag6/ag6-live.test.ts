/** On-demand prompt/assembly samples only. No WorkGraph or Reviewer workflow claim. */
import { it, expect } from 'vitest';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as kernel from '../vendor/coding-agent/dist/public-api.js';
import { createWorkbenchRuntimeHostBindings, type WorkbenchRuntimeConfiguration } from '../src/app/runtime-configuration.js';
import { ModelBudget, DEFAULT_RUNTIME_BUDGET } from '../src/core/agent-runtime/model-budget.js';
import { runObservedModel } from '../src/core/agent-runtime/observed-model-run.js';

const cases = [
  { behavior: 'secretary', prompt: '请作为秘书，给用户一张简短Mermaid模块/工作进度图，准确解释掌控点（何时采用、何时等待证据），并给一段用户可复制的下一步委托提示词。区分事实与未决，不替用户采用方案。' },
  { behavior: 'adviser', prompt: '请作为参谋，就SQLite单机方案与PostgreSQL服务方案给出符合这个小项目现状的技术选型、实践步骤与tradeoff；设计模块间协调方式，并反馈当前设计风险。不要新增常驻协调Agent或按行数拆模块；不要宣布已实施。' },
  { behavior: 'scribe', prompt: '请作为书记，核对旧设计、当前声称完成与证据之间的冲突。输出可追溯的决定/事实/推断/待决，并列下一次审查需要的材料及交接提示词。不要把声称完成改成已验收，不自行裁定新架构采用。' },
  { behavior: 'reviewer', prompt: '明确委托你审查这个小项目：按复杂度是否必要、架构责任、实际完成程度、后续计划四方面给出结论和依据。区分已证实问题与缺证；缺少性能证据不等于性能失败。不要新增产品需求、全量测试门槛或宣称正式Reviewer流程已执行。' },
] as const;
const facts = `以下是完整的虚构小型项目验收材料，无需访问任何真实项目、网络资料或文件。只能基于这些材料给建议，不得声称运行工具。
项目：6人团队的本地文档搜索原型，200份Markdown，每天20次查询；范围仅本地索引、关键词检索、结果来源跳转。暂不要求多租户、云同步、向量检索。
已采用设计D1：Reader读文件；Index维护SQLite FTS索引；Search只查索引；UI展示来源，包含树和调用依赖分别表达。Reader与Index在一个进程中，通过显式函数调用；没有消息队列。
架构模块：M-reader负责读取；M-index负责索引版本和更新；M-search负责查询排序；M-ui负责显示。Index不得拥有第二份文件正文权威库。
Task：T1读取/索引完成；T2搜索完成；T3来源跳转执行结束但未验证；T4性能优化仅未来意图、无验收条件；无依赖要求T4完成后才能使用T2。
实际证据E1：T1的8个定向检查通过，路径和mtime能更新索引；E2：T2的3个关键词样例返回正确记录；E3：T3仅有实现者一句“全部完成”，没有浏览器观察；E4：没有并发/性能压测。Run R3已ended，不能推断T3已验收。
当前变更C1：实现者新增了700行通用JobManager，维护queued/running/retrying状态，底层仍同步调用Index；异常原样返回UI，尚无恢复入口或重试消费者。另提出D2改为PostgreSQL，但没有已采用决定。
Session：S-reader idle参与M-reader/M-index；S-ui busy执行另一已授权工作；S-old archived保留旧设计历史。关联只是事实，不自动授予权限或唤醒。
用户当前授权：评估已采用范围内实现、指出真正缺口、提出下一步。未授权发布、迁移数据库、新增云服务或创建实际Agent。
引用时使用D1/D2/E1-E4/C1/T编号。中文回答，最多约900字；不要输出私有推理过程。`;

it('four on-demand live behavior prompt and Host assembly samples', async () => {
  const credentialPath = process.env.DEEPSEEK_API_KEY_FILE;
  if (!credentialPath) throw new Error('DEEPSEEK_API_KEY_FILE is required');
  const keyText = await readFile(credentialPath, 'utf8');
  const apiKey = keyText.match(/\bsk-[A-Za-z0-9_-]+\b/)?.[0];
  if (!apiKey) throw new Error('Credential file contains no recognized key');
  const evidencePath = 'docs/refactor/reviews/evidence/agent-behavior-2026-09-28/ag6/live-result.json';
  const results: Array<{ case: string; model: string; requests: number; toolnames: string[]; errorStatus: string[]; status: string; elapsedMs: number; answer: string }> = [];
  const budget = { ...DEFAULT_RUNTIME_BUDGET, maxRequests: 2, maxToolCalls: 1, perResponseTokens: 2048, outputTokens: 4096, timeoutMs: 120000 };
  const projectId = 'ag6-fictional';
  const role = { kind: 'role_spec', pin: { ref: { aggregateType: 'RoleSpecRevision', projectId, roleId: 'sample', revision: 1 }, digest: 'a'.repeat(64) } };
  const save = async () => {
    await mkdir(join(evidencePath, '..'), { recursive: true });
    await writeFile(evidencePath, JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), scope: 'Prompt/Host assembly samples; not a formal WorkGraph/Reviewer execution or semantic quality certification', thinking: 'disabled', cases: results }, null, 2) + '\n');
  };
  for (const sample of cases) {
    const started = Date.now();
    const row = { case: sample.behavior, model: 'deepseek-flash', requests: 0, toolnames: [] as string[], errorStatus: [] as string[], status: 'running', elapsedMs: 0, answer: '' };
    results.push(row);
    const directory = await mkdtemp(join(tmpdir(), 'ag6-live-'));
    const root = join(directory, 'empty-workspace');
    await mkdir(root);
    try {
      const workspaceId = 'sample-' + sample.behavior;
      const config = JSON.parse(JSON.stringify({ schemaVersion: 1, bindings: [{ id: workspaceId, label: workspaceId, scope: { projectId, workspaceId }, role, configurationRevision: 'ag6-live-1', model: { revision: 'ag6-live-model-1', provider: 'deepseek', model: row.model, baseUrl: 'https://api.deepseek.com', options: { thinking: 'disabled' }, secretEnvironmentVariable: 'AG6_PRIVATE_KEY' }, grant: { budget, hostTemplate: null, tools: [], writeScope: [], skills: { bundle: 'platform', behaviors: [sample.behavior] }, systemInstruction: null, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null } }], queryProfiles: [] })) as WorkbenchRuntimeConfiguration;
      const host = createWorkbenchRuntimeHostBindings(config, { secretSource: { get: name => name === 'AG6_PRIVATE_KEY' ? apiKey : undefined } });
      const actor = { kind: 'system' as const, id: 'ag6-sample-host' };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const ctx = { projectId, workspaceId, principal: { kind: 'host' as const, actor }, materialReader: { kind: 'host' as const, projectId, workspaceId, actor }, signal: controller.signal };
        const resolved = await host.resolveConfiguration(ctx, { runRef: { aggregateType: 'Run', projectId, goalId: 'sample-only', runId: workspaceId }, role, roleResolution: { status: 'absent', roleId: 'sample' } } as never);
        if (resolved.status !== 'ready') throw new Error('host_resolution_rejected');
        const configured = resolved.value;
        const client: kernel.ModelClientPort = { async *stream(request, options) {
          row.requests++;
          for await (const event of configured.model.client.stream(request, options)) {
            if (event.type === 'text_delta') row.answer += event.delta;
            if (event.type === 'tool_call_started') row.toolnames.push(event.name);
            if (event.type === 'failed' || event.type === 'cancelled' || event.type === 'truncated' || event.type === 'error') row.errorStatus.push(event.type);
            yield event;
          }
        } };
        const result = await runObservedModel({ kernel, bound: { ...configured.model, client }, meter: new ModelBudget(budget, async () => {}), root, databasePath: join(directory, 'kernel.sqlite'), sessionId: 'ag6-' + sample.behavior + '-' + started, input: facts + '\n\n本次委托：' + sample.prompt, budget, readOnly: true, allowedTools: [], signal: controller.signal, deniedPrefixes: [], processSandboxOptions: {}, skills: configured.skills, ...(configured.systemInstruction === null ? {} : { systemInstruction: configured.systemInstruction }), publish: async () => {} });
        row.status = result.state.status;
      } finally { clearTimeout(timer); }
    } catch {
      // Never persist provider error text, requests, configuration, credentials or reasoning.
      row.status = 'failed'; row.errorStatus.push('sample_failed');
    } finally {
      row.elapsedMs = Date.now() - started;
      await rm(directory, { recursive: true, force: true });
      await save();
    }
  }
  expect(results.map(row => ({ status: row.status, errors: row.errorStatus, tools: row.toolnames, hasAnswer: row.answer.trim().length > 0, bounded: row.requests >= 1 && row.requests <= 2 }))).toEqual(cases.map(() => ({ status: 'completed', errors: [], tools: [], hasAnswer: true, bounded: true })));
});
