/**
 * W2 role-skill resource contract (Stage 1 skeleton).
 *
 * Uses the REAL frozen Kernel `FileSkillLoader`/`SkillRegistry` over the real
 * `next/resources/skills` root and a REAL scripted Kernel model loop (the B1
 * `runObservedModel` seam). It proves three wiring facts: the five real
 * manifests load with their content digests, an explicit enabled subset reaches
 * the real model request and nothing else does, and the trusted root/id path
 * fails closed.
 *
 * This is NOT a model-capability score and its checks are NOT a prompt-copy
 * word matrix: matching content clauses proved only that a static resource said
 * the required thing and they would pin the pre-AG6 text. AG6 owns the behavior
 * assembly checks, so this file keeps its real resource/digest, selection,
 * tool-call and error-path checks only.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { PlanTaskPort } from '../../src/core/work-graph/tasks/plan-contracts.js';
import { createWhiteboardTools } from '../../src/core/agent-runtime/whiteboard-tools.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { FileSkillLoader } from '../../vendor/coding-agent/dist/skills/loader/file-skill-loader.js';
import type { SkillRegistry } from '../../vendor/coding-agent/dist/skills/registry/skill-registry.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';

const ROLE_IDS = ['platform-work', 'platform-secretary', 'platform-adviser', 'platform-scribe', 'platform-reviewer'] as const;
const RESOURCE_ROOT = resolve(import.meta.dirname, '../../resources/skills');
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const signal = () => new AbortController().signal;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function readRoleResource(id: string): Promise<{ manifest: Record<string, unknown>; content: string }> {
  const manifest = JSON.parse(await readFile(join(RESOURCE_ROOT, id, 'skill.json'), 'utf8')) as Record<string, unknown>;
  const content = await readFile(join(RESOURCE_ROOT, id, 'content.md'), 'utf8');
  return { manifest, content };
}

async function loadRegistry(): Promise<SkillRegistry> {
  const loader = await FileSkillLoader.create(RESOURCE_ROOT);
  return loader.load(signal());
}

// --------------------------------------------------------------------------
// Real scripted Kernel model loop (reuses the B1 assembly seam).
// --------------------------------------------------------------------------

function scriptedTextClient(replies: readonly string[]) {
  let round = 0;
  const requests: kernel.ModelRequest[] = [];
  const client: kernel.ModelClientPort = {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      requests.push(structuredClone(request));
      const text = replies[round++];
      if (text === undefined) throw new Error(`W2 scripted model ran out of replies at round ${round - 1}`);
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      let sequence = 0;
      yield { ...base, sequence: ++sequence, type: 'text_delta', delta: text };
      yield { ...base, sequence: ++sequence, type: 'completed', reason: 'final_answer' };
    },
  };
  return { client, requests };
}

async function tempWorkspace(name: string) {
  const directory = await mkdtemp(join(tmpdir(), `next-w2-role-${name}-`));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  return { directory, root, databasePath: join(directory, 'kernel.sqlite'), sessionId: `w2-role-${name}` };
}

function baseOptions(root: string, databasePath: string, sessionId: string, client: kernel.ModelClientPort): ObservedModelRunOptions {
  const budget = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 200_000, perResponseTokens: 512, maxRequests: 4, maxToolCalls: 4, timeoutMs: 30_000 };
  return {
    kernel,
    bound: { configuration: { revision: 'w2-role-local', provider: 'deepseek', model: 'w2-role-scripted', baseUrl: 'http://127.0.0.1' }, client },
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 256, method: 'model_tokenizer', tokenizer: 'w2-labelled-local-counter' }),
    }),
    root, databasePath, sessionId, input: 'W2 role skill turn.', budget,
    readOnly: true, signal: signal(),
    deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
  };
}

// --------------------------------------------------------------------------
// 1. Real loader: manifests, content digests, subset selection.
// --------------------------------------------------------------------------

describe('W2 role skill resources through the real FileSkillLoader', () => {
  it('loads exactly the five real manifests with their content digests', async () => {
    const registry = await loadRegistry();
    expect(registry.list().map(skill => skill.id)).toEqual(['platform-adviser', 'platform-reviewer', 'platform-scribe', 'platform-secretary', 'platform-work']);
    for (const id of ROLE_IDS) {
      const skill = registry.list().find(candidate => candidate.id === id);
      const { manifest, content } = await readRoleResource(id);
      expect(skill, `missing loaded skill ${id}`).toBeDefined();
      expect(skill).toMatchObject({
        schemaVersion: 1,
        id,
        title: manifest['title'],
        kind: manifest['kind'],
        priority: manifest['priority'],
      });
      // Real Kernel digest/summary: content digest of the exact resource bytes.
      expect(skill?.source).toBe(`skill:${id}@sha256:${sha256(content)}`);
      expect(skill?.content).toBe(content);
    }
  });

  it('selects an explicit enabled subset and rejects an unknown id', async () => {
    const registry = await loadRegistry();
    const selected = await registry.select({ schemaVersion: 1, requestedIds: ['platform-secretary'] }, { signal: signal() });
    expect(selected.map(skill => skill.id)).toEqual(['platform-secretary']);
    expect(selected[0]?.content).toBe((await readRoleResource('platform-secretary')).content);
    await expect(registry.select({ schemaVersion: 1, requestedIds: ['missing-role'] }, { signal: signal() }))
      .rejects.toMatchObject({ code: 'not_found' });
  });
});

// --------------------------------------------------------------------------
// 2. The enabled subset reaches the REAL scripted Kernel request.
// --------------------------------------------------------------------------

describe('W2 role skills in a real scripted Kernel request', () => {
  it('injects only the enabled role content into the real model system prompt', async () => {
    const w = await tempWorkspace('skills');
    const { client, requests } = scriptedTextClient(['secretary turn', 'secretary+scribe turn', 'explicit empty turn']);
    const base = baseOptions(w.root, w.databasePath, w.sessionId, client);
    const resources = await Promise.all(ROLE_IDS.map(readRoleResource));
    const body = Object.fromEntries(ROLE_IDS.map((id, i) => [id, resources[i]!.content]));

    await runObservedModel({ ...base, input: 'secretary only', skills: { resourceRoot: RESOURCE_ROOT, enabledIds: ['platform-secretary'] } });
    expect(requests[0]?.systemPrompt).toContain(body['platform-secretary']);
    expect(requests[0]?.systemPrompt).not.toContain(body['platform-adviser']);
    expect(requests[0]?.systemPrompt).not.toContain(body['platform-scribe']);

    await runObservedModel({ ...base, input: 'secretary and scribe', skills: { resourceRoot: RESOURCE_ROOT, enabledIds: ['platform-secretary', 'platform-scribe'] } });
    expect(requests[1]?.systemPrompt).toContain(body['platform-secretary']);
    expect(requests[1]?.systemPrompt).toContain(body['platform-scribe']);
    expect(requests[1]?.systemPrompt).not.toContain(body['platform-adviser']);

    // An explicit empty enabledIds must select nothing and must not fall back.
    await runObservedModel({ ...base, input: 'no skills', skills: { resourceRoot: RESOURCE_ROOT, enabledIds: [] } });
    for (const id of ROLE_IDS) expect(requests[2]?.systemPrompt).not.toContain(body[id]);
  }, 60_000);

  it('loads the adviser and dispatches an actual scripted whiteboard call whose typed result reaches the next model request', async () => {
    const w = await tempWorkspace('adviser-tool');
    const requests: kernel.ModelRequest[] = [];
    const delivered: Array<{ ctx: CoreCallContext; input: unknown }> = [];
    const result = { status: 'ready' as const,
      value: { items: [], nextCursor: 'next-page-from-domain', sourceCursor: makeCommitCursor(7) } };
    // This is explicitly an adapter/Kernel seam test. The formal WG/Run/Plan
    // integration remains in the separately owned composition test.
    const unsupported = async () => ({ status: 'rejected' as const, code: 'unsupported' as const, reason: 'unused adapter port' });
    const plans: PlanTaskPort = {
      queryGoal: unsupported, readPlanProposal: unsupported, proposePlan: unsupported,
      applyPlanChange: unsupported, queryTaskGraph: unsupported, readTaskInput: unsupported,
      async queryReadyTasks(ctx, input) { delivered.push({ ctx, input }); return result; },
    };
    const runRef = { aggregateType: 'Run' as const, projectId: 'w2-project', goalId: 'w2-goal', runId: 'w2-run' };
    const ctx: CoreCallContext = { projectId: runRef.projectId, workspaceId: 'w2-workspace', signal: signal(),
      principal: { kind: 'work_run', runRef, roleBinding: { schemaVersion: 1, bindingId: 'w2-role-binding',
        templateId: 'adviser', templateRevision: '1', bindingVersion: 1, policyRevision: 'w2-policy' } },
      materialReader: { kind: 'run', requester: runRef } };
    const handle = createWhiteboardTools({ plans, context: ctx,
      goalRef: { aggregateType: 'Goal', projectId: runRef.projectId, goalId: runRef.goalId },
      requestIdForCall: call => `${runRef.runId}:${call.name}:${call.callId}` });
    const client: kernel.ModelClientPort = { async *stream(request, options) {
      options.signal.throwIfAborted(); requests.push(structuredClone(request));
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      if (requests.length === 1) {
        yield { ...base, sequence: 1, type: 'tool_call_started', callId: 'adviser-ready', name: 'query_ready_tasks', ordinal: 0 };
        yield { ...base, sequence: 2, type: 'tool_arguments_delta', callId: 'adviser-ready',
          delta: JSON.stringify({ includeBlocked: true, page: { limit: 5, cursor: 'prior-page' } }) };
        yield { ...base, sequence: 3, type: 'completed', reason: 'tool_calls' };
      } else {
        yield { ...base, sequence: 1, type: 'text_delta', delta: 'Observed the returned task page.' };
        yield { ...base, sequence: 2, type: 'completed', reason: 'final_answer' };
      }
    } };
    await runObservedModel({ ...baseOptions(w.root, w.databasePath, w.sessionId, client),
      skills: { resourceRoot: RESOURCE_ROOT, enabledIds: ['platform-adviser'] },
      coordinationTools: { names: ['query_ready_tasks'],
        create: workspace => handle.create(workspace).filter(tool => tool.name === 'query_ready_tasks') } });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.systemPrompt).toContain((await readRoleResource('platform-adviser')).content);
    const names = requests[0]!.tools.map(tool => tool.name);
    expect(names).toContain('query_ready_tasks');
    expect(names).not.toContain('propose_future_plan'); expect(names).not.toContain('apply_future_plan');
    const message = requests[1]!.messages.find(message => message.role === 'tool' && message.callId === 'adviser-ready');
    expect(message).toBeDefined();
    if (!message || message.role !== 'tool') throw Error('actual Kernel tool result missing');
    expect(message.result.status).toBe('success');
    const output = message.result.output.find(block => block.kind === 'json');
    expect(output?.kind === 'json' ? output.value : undefined).toEqual(result);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.input).toEqual({ goalRef: { aggregateType: 'Goal', projectId: runRef.projectId,
      goalId: runRef.goalId }, includeBlocked: true, page: { limit: 5, cursor: 'prior-page' } });
  }, 60_000);

  it('fails closed when the trusted resource root or enabled id is wrong', async () => {
    const w = await tempWorkspace('bad-skill');
    const { client, requests } = scriptedTextClient(['unreachable']);
    const base = baseOptions(w.root, w.databasePath, w.sessionId, client);
    await expect(runObservedModel({ ...base, input: 'unknown id', skills: { resourceRoot: RESOURCE_ROOT, enabledIds: ['missing-role'] } }))
      .rejects.toMatchObject({ code: 'not_found' });
    await expect(runObservedModel({
      ...base, input: 'missing root',
      skills: { resourceRoot: join(w.directory, 'missing-skill-root'), enabledIds: ['platform-secretary'] },
    })).rejects.toBeDefined();
    expect(requests).toHaveLength(0);
  }, 60_000);
});
