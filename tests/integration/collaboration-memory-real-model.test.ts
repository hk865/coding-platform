import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createModelSettings } from '../../src/app/model-settings.js';
import { architectureServiceScenario } from '../app/architecture-review-service-fixture.js';
import type { ModelClientPort, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';

const purposes = ['reply', 'architecture', 'progress'] as const;
type Purpose = typeof purposes[number];
const brief = '请用中文简短回答，无论接话、架构解释还是进度更新，都优先用两三句话说明核心事实。';
const architecture = '架构解释请用中文充分说明目的、职责边界、替代方案及对真实消费者的影响，区分已经决定和仍未完成的事项。';
const progress = '进度更新请用中文简短说明变化、真实阻塞和下一步；不得把报告已交或人的决定当作实现与验证完成。';
const reply = '一般接话请用中文简短自然地回应，不展开不相关的架构细节。';
const questions: Record<Purpose, string> = {
  reply: '围绕 reader-a 的当前工作，回应用户：明白了，我们接下来怎么配合？请根据已有事实回答。',
  architecture: '解释当前 Record.id 方案及它与两位 reader 的关系。请根据当前事实说明已决定、未决定和下一步。',
  progress: 'reader-a 和共享 Record.id 协作现在进展如何？明确阻塞和下一步，不把报告已交或人的决定当作实现及验证完成。',
};

it.skipIf(!process.env['I01_REAL_MEMORY'])('real DeepSeek same-Task replies consume corrected purpose-specific memory after host restart', async () => {
  const directory = resolve('evidence/collaboration-memory/batch/integration/real-memory', new Date().toISOString().replaceAll(/[:.]/g, '-'));
  await mkdir(directory, { recursive: true });
  const rubric = {
    writtenBeforeModelCalls: true,
    scope: 'One HTTP host, Goal, accepted Plan and reader-a; six real semantic Query responses before/after memory correction and host reopen.',
    criteria: [
      'Revision 2: all three responses follow the saved Chinese concise preference while preserving unresolved interface conflict.',
      'Revision 3 after restart: architecture explains purpose, responsibility boundaries, a meaningful alternative and concrete effects on both readers.',
      'Revision 3: progress and ordinary reply remain concise; purpose-specific architecture detail does not spill into unrelated responses.',
      'Responses distinguish recorded human acceptance from baseline activation, implementation, integration and independent verification; no invented completion or evidence.',
      'Formal current decision and its impact on Record.id and both consumers are reflected accurately, with uncertainty preserved when material cannot establish a fact.',
    ],
    rating: 'Each criterion is met / partly met / not met / cannot assess after reading the complete responses. Length and keywords alone are not quality acceptance.',
    exclusions: 'Planning, parallel reader reports, architecture-conflict reporting and successor responses remain labelled deterministic protocol fixtures. Reopen is one-process host close/reopen with persistent data, not an OS-process kill. This is not coding E2E or general collaboration-quality acceptance.',
  };
  await writeFile(join(directory, 'rubric.json'), JSON.stringify(rubric, null, 2) + '\n');
  const settings = await createModelSettings(directory, { directory: '/home/han001/.config/agent-platform/2925e9d16dbd6c81bc7fcb84' });
  const bound = await settings.bindRun('integration-real-memory-query');
  // The binding exposes only public configuration and a ready client. Never read,
  // serialize, copy or save settings credentials; fixture Host uses LOCAL_TEST_KEY.
  await writeFile(join(directory, 'model.json'), JSON.stringify(bound.configuration, null, 2) + '\n');
  const inputs: ModelRequest[] = [];
  let label = '', serial = 0;
  const samples: Array<Record<string, unknown>> = [];
  const queryClient: ModelClientPort = { async *stream(request, options) {
    inputs.push(structuredClone(request));
    await writeFile(join(directory, `${label}-request-${inputs.length}.json`), JSON.stringify({ requestId: request.requestId, messages: request.messages, tools: request.tools.map(t => t.name) }, null, 2) + '\n');
    yield* bound.client.stream(request, options);
  } };
  const query = async (context: any, phase: string, purpose: Purpose, revision: number) => {
    label = `${phase}-${purpose}`;
    const requestId = 'real-memory-' + ++serial, before = inputs.length;
    expect(await context.post('/api/real/queries', { ...context.scope, requestId, focusTaskId: 'reader-a', responsePurpose: purpose, question: questions[purpose] })).toMatchObject({ status: 200 });
    let run: any;
    await expect.poll(async () => {
      run = (await context.post('/api/real/queries/runs', context.scope)).body.runs.find((row: any) => row.runRef.runId === 'real-query-' + requestId);
      return run?.status;
    }, { timeout: 150000, interval: 250 }).toBe('completed');
    const compiled = JSON.parse(run.input), messages = inputs.slice(before).flatMap(input => input.messages), modelInput = JSON.stringify(messages);
    const sample = { phase, purpose, question: questions[purpose], scope: context.scope, focusTaskId: 'reader-a',
      runRef: run.runRef, status: run.status, result: run.result, input: compiled,
      inputDigest: createHash('sha256').update(modelInput).digest('hex'), modelRequestIds: inputs.slice(before).map(input => input.requestId) };
    samples.push(sample);
    await writeFile(join(directory, label + '.json'), JSON.stringify(sample, null, 2) + '\n');
    await writeFile(join(directory, label + '.md'), `Question: ${questions[purpose]}\n\n${run.result?.answer ?? '(no answer)'}\n`);
    expect(run.result.outcome).toBe('answered');
    expect(inputs.length).toBeGreaterThan(before);
    expect(compiled.maintainedPreferences.profileRevision).toBe(revision);
    if (revision === 2) expect(modelInput).toContain(brief);
    else {
      expect(modelInput).not.toContain(brief);
      expect(modelInput.includes(architecture)).toBe(purpose === 'architecture');
      expect(modelInput.includes(progress)).toBe(purpose === 'progress');
      expect(modelInput.includes(reply)).toBe(purpose === 'reply');
    }
    // These are protocol/input assertions. Semantic quality is reviewed using
    // rubric.json and the preserved complete answers, never a keyword PASS.
  };
  try {
    await architectureServiceScenario('accept', {
      readSharedSource: true, queryClient,
      afterReported: async context => {
        expect((await context.post('/api/real/memory/profile/maintain', { requestId: 'real-memory-general', expectedRevision: 1,
          edits: [{ operation: 'correct', entryId: 'style', expectedEntryRevision: 1, content: brief }] })).body).toMatchObject({ status: 'committed', revision: 2 });
        await writeFile(join(directory, 'before-state.json'), JSON.stringify(await context.state(), null, 2) + '\n');
        for (const purpose of purposes) await query(context, 'before', purpose, 2);
        const result = (await context.post('/api/real/memory/profile/maintain', { requestId: 'real-memory-correction', expectedRevision: 2, edits: [
          { operation: 'correct', entryId: 'style', expectedEntryRevision: 2, content: architecture, conditions: { purposes: ['architecture'], expiresAt: null } },
          { operation: 'remember', entryId: 'progress-style', content: progress, conditions: { purposes: ['progress'], expiresAt: null } },
          { operation: 'remember', entryId: 'reply-style', content: reply, conditions: { purposes: ['reply'], expiresAt: null } },
        ] })).body;
        expect(result).toMatchObject({ status: 'committed', revision: 3 });
        await writeFile(join(directory, 'correction-receipt.json'), JSON.stringify(result, null, 2) + '\n');
      },
      afterRestart: async context => {
        await writeFile(join(directory, 'after-state.json'), JSON.stringify(await context.state(), null, 2) + '\n');
        await writeFile(join(directory, 'architecture-decision.json'), JSON.stringify((await context.post('/api/real/architecture-reviews/view', context.scope)).body, null, 2) + '\n');
        for (const purpose of purposes) await query(context, 'after', purpose, 3);
        expect((await context.post('/api/real/memory/profile/view', {})).body.snapshot.revision).toBe(3);
        expect(inputs.every(request => request.tools.every(tool => !['edit', 'write', 'bash', 'shell'].includes(tool.name)))).toBe(true);
      },
    });
    await writeFile(join(directory, 'protocol-result.json'), JSON.stringify({ status: 'passed', samples: samples.length, boundary: rubric.exclusions, quality: 'Pending reading complete responses against the predeclared rubric.' }, null, 2) + '\n');
  } catch (error) {
    await writeFile(join(directory, 'protocol-result.json'), JSON.stringify({ status: 'failed', samples: samples.length, error: error instanceof Error ? error.message : 'test failed', quality: 'Unassessed; preserve partial actual responses.' }, null, 2) + '\n');
    throw error;
  } finally { settings.close(); }
}, 1000000);
