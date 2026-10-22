/**
 * W2 role-skill resource contract (Stage 1 skeleton).
 *
 * Uses preparation (the resolved pack, then the frozen set) and a REAL scripted
 * Kernel model loop (the B1 `runObservedModel` seam). It proves the wiring
 * facts the base test proved through the old resource directory: the five
 * platform Skills freeze with their content digests, an explicit enabled subset
 * (including secretary+scribe and the explicit empty selection) reaches the
 * real model request and nothing else does, and the trusted root/id path fails
 * closed with zero model calls.
 *
 * The platform bodies, titles and priorities below are hand-written literals
 * injected through the public mutable pack source; each digest is the SHA-256
 * of one (node:crypto), never the generated pack or production code.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { PlanTaskPort } from '../../src/core/work-graph/model/plan-contracts.js';
import { createWhiteboardTools } from '../../src/core/agent-runtime/whiteboard-tools.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_SKILL_RESOURCE_ROOT } from '../../src/core/agent-runtime/platform-skill-root.js';
import { customSkillDirectory, openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const ROLE_IDS = ['platform-work', 'platform-secretary', 'platform-adviser', 'platform-scribe', 'platform-reviewer'] as const;
type RoleId = typeof ROLE_IDS[number];
/** Hand-written platform Skill metadata and bodies (the same literals the selector tests use). */
const SKILL_META: Record<RoleId, { title: string; priority: number }> = {
  'platform-work': { title: 'Platform work', priority: 90 },
  'platform-secretary': { title: 'Platform secretary', priority: 70 },
  'platform-adviser': { title: 'Platform adviser', priority: 60 },
  'platform-scribe': { title: 'Platform scribe', priority: 50 },
  'platform-reviewer': { title: 'Platform reviewer', priority: 40 },
};
const TEMPLATE_OF: Record<RoleId, string> = {
  'platform-work': 'skill-platform-work',
  'platform-secretary': 'skill-platform-secretary',
  'platform-adviser': 'skill-platform-adviser',
  'platform-scribe': 'skill-platform-scribe',
  'platform-reviewer': 'skill-platform-reviewer',
};
const SKILL_CONTENT: Record<RoleId, string> = {
  'platform-work': 'W2_SKILL_WORK_BODY',
  'platform-secretary': 'W2_SKILL_SECRETARY_BODY',
  'platform-adviser': 'W2_SKILL_ADVISER_BODY',
  'platform-scribe': 'W2_SKILL_SCRIBE_BODY',
  'platform-reviewer': 'W2_SKILL_REVIEWER_BODY',
};
const SKILL_TEMPLATES = Object.fromEntries(
  ROLE_IDS.map(id => [TEMPLATE_OF[id], SKILL_CONTENT[id]]),
) as Record<string, string>;
const PLATFORM_ROOT = PLATFORM_SKILL_RESOURCE_ROOT;

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const signal = () => new AbortController().signal;
/**
 * Preparation through the public Work steps (the frozen fixture's own World).
 * The mutable pack source replaces each platform Skill template with the
 * literal body above, so the real request can be checked against literals.
 */
async function preparedPrompt(skills: { resourceRoot: string; enabledIds: string[] }) {
  const fixture = await openPCWorkFixture({ skills, tools: ['read'] });
  try {
    const pack = fixture.packs.snapshot();
    fixture.packs.replace({ ...pack, templates: { ...pack.templates, ...SKILL_TEMPLATES } });
    await fixture.work.prepare();
    return (await fixture.work.preparedTexts()).prompt;
  } finally {
    await fixture.close();
  }
}

/** A failing preparation still calls no model. */
async function expectPreparationFails(skills: { resourceRoot: string; enabledIds: string[] }) {
  const fixture = await openPCWorkFixture({ skills, tools: ['read'], model: scriptedModel([]) });
  try {
    await expect(fixture.work.prepare()).rejects.toBeDefined();
    expect(fixture.model.calls()).toBe(0);
  } finally {
    await fixture.close();
  }
}

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

function baseOptions(root: string, databasePath: string, sessionId: string, client: kernel.ModelClientPort): Omit<ObservedModelRunOptions, 'prompt'> {
  const budget = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 200_000, perResponseTokens: 512, maxRequests: 4, maxToolCalls: 4, timeoutMs: 30_000 };
  return {
    kernel,
    bound: { configuration: { revision: 'w2-role-local', provider: 'deepseek', model: 'w2-role-scripted', baseUrl: 'http://127.0.0.1' }, client },
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 256, method: 'model_tokenizer', tokenizer: 'w2-labelled-local-counter' }),
    }),
    root, databasePath, sessionId, input: 'W2 role skill turn.', budget,
    taskBudget: { tokenBudget: null, deadline: null },
    readOnly: true, signal: signal(),
    deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
    // PC-1b ruling 25: the direct caller supplies the tool-spec body store.
    bodies: { async put(input) { return { status: 'ready' as const, value: { replayed: false, ref: {
      kind: 'artifact' as const, contentType: input.contentType, digest: sha(input.body),
      sizeBytes: Buffer.byteLength(input.body, 'utf8'), source: input.sourceRefs[0]! } } }; } },
    origin: { kind: 'run', owner: { aggregateType: 'Run', projectId: 'w2-project', goalId: 'w2-goal', runId: 'w2-run' } },
    promptFacts: new Map(),
  };
}

// --------------------------------------------------------------------------
// 1. Platform Skill contexts through preparation (the pack, then the frozen set).
// --------------------------------------------------------------------------

describe('W2 platform Skill resources through preparation', () => {
  it('freezes exactly the five pack Skills with their content digests', async () => {
    const prompt = await preparedPrompt({ resourceRoot: PLATFORM_ROOT, enabledIds: [...ROLE_IDS] });
    expect(prompt.skills.map(skill => skill.id)).toEqual([...ROLE_IDS]);
    for (const id of ROLE_IDS) {
      const expected = SKILL_META[id];
      const content = SKILL_CONTENT[id];
      const skill = prompt.skills.find(candidate => candidate.id === id);
      expect(skill, `missing prepared skill ${id}`).toBeDefined();
      expect(skill).toMatchObject({ schemaVersion: 1, id, title: expected.title, kind: 'instruction', priority: expected.priority });
      expect(skill?.source).toBe(`skill:${id}@sha256:${sha(content)}`);
      expect(skill?.content).toBe(content);
    }
  }, 120_000);

  it('keeps an explicit subset, an explicit empty selection and a custom directory', async () => {
    const subset = await preparedPrompt({ resourceRoot: PLATFORM_ROOT, enabledIds: ['platform-secretary'] });
    expect(subset.skills.map(skill => skill.id)).toEqual(['platform-secretary']);
    expect(subset.skills[0]?.content).toBe(SKILL_CONTENT['platform-secretary']);

    const empty = await preparedPrompt({ resourceRoot: PLATFORM_ROOT, enabledIds: [] });
    expect(empty.skills).toEqual([]);

    const custom = await customSkillDirectory('W2_CUSTOM_SKILL_CONTENT');
    try {
      const prepared = await preparedPrompt(custom.selection);
      expect(prepared.skills).toHaveLength(1);
      expect(prepared.skills[0]).toMatchObject({ schemaVersion: 1, id: 'pc-custom', kind: 'instruction', content: 'W2_CUSTOM_SKILL_CONTENT' });
      expect(prepared.skills[0]?.source).toBe(`skill:pc-custom@sha256:${sha('W2_CUSTOM_SKILL_CONTENT')}`);
    } finally {
      await custom.close();
    }
  }, 60_000);

  it('fails closed on an unknown platform id or a missing custom root, with zero model calls', async () => {
    await expectPreparationFails({ resourceRoot: PLATFORM_ROOT, enabledIds: ['missing-role'] });
    await expectPreparationFails({ resourceRoot: join(tmpdir(), 'w2-missing-skill-root'), enabledIds: ['platform-secretary'] });
  }, 60_000);
});

// --------------------------------------------------------------------------
// 2. Prepared Skill text reaches the REAL scripted Kernel request.
// --------------------------------------------------------------------------

describe('W2 role skills in a real scripted Kernel request', () => {
  it('injects the secretary, secretary+scribe and the explicit empty selection into the real model system prompt', async () => {
    const w = await tempWorkspace('skills');
    const { client, requests } = scriptedTextClient(['secretary turn', 'secretary+scribe turn', 'explicit empty turn']);
    const base = baseOptions(w.root, w.databasePath, w.sessionId, client);

    await runObservedModel({ ...base, input: 'secretary only',
      prompt: await preparedPrompt({ resourceRoot: PLATFORM_ROOT, enabledIds: ['platform-secretary'] }) });
    expect(requests[0]?.systemPrompt).toContain(SKILL_CONTENT['platform-secretary']);
    expect(requests[0]?.systemPrompt).not.toContain(SKILL_CONTENT['platform-adviser']);
    expect(requests[0]?.systemPrompt).not.toContain(SKILL_CONTENT['platform-scribe']);

    await runObservedModel({ ...base, input: 'secretary and scribe',
      prompt: await preparedPrompt({ resourceRoot: PLATFORM_ROOT, enabledIds: ['platform-secretary', 'platform-scribe'] }) });
    expect(requests[1]?.systemPrompt).toContain(SKILL_CONTENT['platform-secretary']);
    expect(requests[1]?.systemPrompt).toContain(SKILL_CONTENT['platform-scribe']);
    expect(requests[1]?.systemPrompt).not.toContain(SKILL_CONTENT['platform-adviser']);

    // An explicit empty enabledIds must select nothing and must not fall back.
    await runObservedModel({ ...base, input: 'no skills',
      prompt: await preparedPrompt({ resourceRoot: PLATFORM_ROOT, enabledIds: [] }) });
    for (const id of ROLE_IDS) expect(requests[2]?.systemPrompt).not.toContain(SKILL_CONTENT[id]);
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
      applyPlanChange: unsupported, queryTaskGraph: unsupported,
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
      prompt: await preparedPrompt({ resourceRoot: PLATFORM_ROOT, enabledIds: ['platform-adviser'] }),
      coordinationTools: { names: ['query_ready_tasks'],
        create: workspace => handle.create(workspace).filter(tool => tool.name === 'query_ready_tasks') } });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.systemPrompt).toContain(SKILL_CONTENT['platform-adviser']);
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
});
