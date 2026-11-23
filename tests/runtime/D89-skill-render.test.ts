/**
 * Decision 89 small step: the five Skill templates render their outside lines and
 * their tool blocks by the final grant. The lines are read from the pack's committed
 * templates in `parseSkill` (no prose is copied here); the blank-line counts are the
 * renderer fact per grant. The six grant combinations are one pure table; two real
 * calls on memory check the final tools a Work and a Query end with and the lines
 * they render.
 */
import { describe, expect, it } from 'vitest';
import { createBuiltinProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import { createWorkbenchRuntimeHostBindings, type PlatformBehavior, type WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { parseTemplateV1, renderTemplate, type TemplateNodeV1 } from '../../src/contracts/prompts/render-template.js';
import { committed, ready } from '../helpers/S1-runtime-scenario-fixture.js';
import { createWP2Platform } from '../helpers/WP2-platform-support.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;
type Skill = {
  /** Non-empty text lines outside every tool block; they render under every grant. */
  readonly outside: readonly string[];
  /** One occurrence per template block, with the tools that must all be granted for it to render. */
  readonly blocks: readonly { readonly tool: string; readonly requires: readonly string[];
    readonly lines: readonly string[] }[];
  /** Empty lines when no optional tool is granted, excluding the final newline's empty line. */
  readonly blankLines: number;
  readonly blankLinesWith?: Readonly<Record<string, number>>;
};

/**
 * Reads one Skill's current text from the pack and splits it into the lines outside
 * any tool block and each block's own text lines. Nesting is kept: a block renders
 * only when every enclosing tool and its own tool are granted. No expected text is
 * copied here; the pack's committed file is the one authority.
 */
function parseSkill(id: string): Skill {
  const source = PACK.templates[id];
  if (source === undefined) throw new Error(`the pack has no Skill template ${id}`);
  const parsed = parseTemplateV1(id, source);
  if (parsed.status !== 'parsed') throw new Error(`template ${id}: ${parsed.error.message}`);
  const outside: string[] = [];
  const blocks: Array<{ tool: string; requires: string[]; lines: string[] }> = [];
  const stack: Array<{ tool: string; requires: string[]; lines: string[] }> = [];
  const addText = (text: string): void => {
    for (const raw of text.split('\n')) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (line.trim().length <= 1) continue;
      if (stack.length === 0) outside.push(line);
      else stack[stack.length - 1]!.lines.push(line);
    }
  };
  const walk = (nodes: readonly TemplateNodeV1[], ancestors: readonly string[]): void => {
    for (const node of nodes) {
      if (node.kind === 'text') { addText(node.text); continue; }
      if (node.kind === 'slot') continue;
      if (node.kind === 'tool') {
        const block = { tool: node.name, requires: [...ancestors, node.name], lines: [] };
        blocks.push(block);
        stack.push(block);
        walk(node.children, block.requires);
        stack.pop();
        continue;
      }
      walk(node.children, ancestors);
    }
  };
  walk(parsed.nodes, []);
  return { outside, blocks, blankLines: 0 };
}

/** The five Skills' current lines and block gates; blank-line counts are the frozen renderer fact per grant. */
const SKILLS: Readonly<Record<string, Skill>> = {
  'skill-platform-work': { ...parseSkill('skill-platform-work'), blankLines: 27, blankLinesWith: { run_readonly_command: 1 } },
  'skill-platform-adviser': { ...parseSkill('skill-platform-adviser'), blankLines: 27 },
  'skill-platform-reviewer': { ...parseSkill('skill-platform-reviewer'), blankLines: 11 },
  'skill-platform-scribe': { ...parseSkill('skill-platform-scribe'), blankLines: 13 },
  'skill-platform-secretary': { ...parseSkill('skill-platform-secretary'), blankLines: 23 },
};

const ALL_TOOLS = [
  'read', 'edit', 'shell', 'search', 'code_index', 'look_graph', 'send_session_message',
  'record_note', 'run_readonly_command',
] as const;

/** The six grants: all tools, none, and one row per optional section. */
const COMBOS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['all tools', ALL_TOOLS],
  ['none', []],
  ['send without notes, with search', ['send_session_message', 'look_graph', 'search']],
  ['notes without send, with code_index', ['record_note', 'code_index']],
  ['discovery without send, with look_graph', ['look_graph', 'find_graph']],
  ['send without discovery, with run_readonly_command', ['send_session_message', 'run_readonly_command']],
];

/** Every outside line is unconditional and every block line follows its whole tool path. */
function expectSkillText(text: string, id: string, tools: readonly string[]): void {
  const skill = SKILLS[id];
  if (skill === undefined) throw new Error(`no parsed Skill ${id}`);
  for (const line of skill.outside) expect(text, `${id} outside line`).toContain(line);
  for (const block of skill.blocks) {
    const present = block.requires.every(tool => tools.includes(tool));
    for (const line of block.lines) {
      if (present) expect(text, `${id}.${block.tool} present`).toContain(line);
      else expect(text, `${id}.${block.tool} absent`).not.toContain(line);
    }
  }
}

describe('decision 89 Skill rendering', () => {
  it.each(COMBOS)('renders all five Skills with %s', (_name, tools) => {
    for (const [id, skill] of Object.entries(SKILLS)) {
      const text = renderTemplate(PACK, id, {}, tools).text;
      expectSkillText(text, id, tools);
      const gated = tools.reduce((sum, tool) => sum + (skill.blankLinesWith?.[tool] ?? 0), 0);
      expect(text.split('\n').filter(line => line === ''), `${id} blank lines left`)
        .toHaveLength(skill.blankLines + gated + 1);
    }
  });
});

/** What a read grant ends with besides its builtin tools: the source tools (`project_source` with the frozen
 * source), src/core/agent-runtime/tool-group-assembly.ts:51 and :476. */
const SOURCE_TOOLS = ['list_files', 'search', 'symbols', 'code_index', 'project_source', 'python_index', 'cpp_index', 'source_excerpt'];
/** A8: the Host's branches become the real trusted factory over one binding whose grant selects the platform
 * Skill bundle with `behaviors` (src/app/runtime-configuration.ts:414); the platform holds this Host object. */
function useBundleHost(fx: Awaited<ReturnType<typeof createWP2Platform>>, grant: Pick<WorkbenchRuntimeBinding['grant'], 'tools' | 'writeScope' | 'shellWorkspaceAccess'>,
  behaviors: PlatformBehavior[]) {
  const role = { kind: 'legacy_template', templateId: fx.roleBinding.templateId, templateRevision: fx.roleBinding.templateRevision } as const;
  const builtin = createBuiltinProviderRegistry();
  Object.assign(fx.host, createWorkbenchRuntimeHostBindings({ schemaVersion: 1, queryProfiles: [], bindings: [{
    id: 'd89', label: 'D89', scope: fx.scope, role, configurationRevision: 'd89@1',
    model: { revision: 'd89-model@1', provider: 'deepseek', model: 'd89-scripted' },
    grant: { ...grant, budget: DEFAULT_RUNTIME_BUDGET, skills: { bundle: 'platform', behaviors }, systemInstruction: null,
      hostTemplate: { templateId: role.templateId, revision: role.templateRevision, digest: 'd'.repeat(64) },
      deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null },
  }] }, { registry: { get: builtin.get.bind(builtin), create: () => fx.scripted.client }, secretSource: { get: () => 'd89' } }));
  return role;
}

describe('decision 89 real calls on memory', () => {
  it('a claimed Work granted read, write and shell ends with read, edit, shell and the source tools', async () => {
    const fx = await createWP2Platform({ kind: 'memory', allowSourceRead: true });
    try {
      useBundleHost(fx, { tools: ['read', 'write', 'shell'], writeScope: ['.'], shellWorkspaceAccess: 'all_except_denied' }, []);
      const prepared = ready(await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef!, requestId: 'd89-prepare' }));
      expect(await fx.platform.runtime.startRun(fx.ctx, { prepared, consumerId: 'd89', requestId: 'd89-start' }))
        .toMatchObject({ status: 'ready' });
      const request = fx.scripted.requests[0]!;
      expect(request.tools.map(tool => tool.name).sort()).toEqual(['read', 'edit', 'shell', ...SOURCE_TOOLS].sort());
      expectSkillText(request.systemPrompt, 'skill-platform-work', request.tools.map(tool => tool.name));
    } finally { await fx.close(); }
  }, 60_000);

  it('a submitted, claimed read-only Query ends with read and the source tools', async () => {
    const fx = await createWP2Platform({ kind: 'memory', allowSourceRead: true });
    try {
      const role = useBundleHost(fx, { tools: ['read'], writeScope: [] }, ['secretary']);
      const job: QueryJobRef = { aggregateType: 'QueryJob', ...fx.scope, queryJobId: 'd89-job' };
      const run: QueryRunRef = { aggregateType: 'QueryRun', ...fx.scope, queryJobId: 'd89-job', runId: 'd89-run' };
      const goal = ready(await fx.platform.plans.queryGoal(fx.ctx, fx.goalRef)).goal;
      const registration = ready(await fx.platform.projects.readWorkspaceRegistration(fx.ctx, fx.scope));
      const submitted = committed(await fx.platform.queries.submitQueryJob(fx.ctx, { input: { queryJobId: job.queryJobId, runId: run.runId, intent: {
        schemaVersion: 1, intentId: job.queryJobId, ...fx.scope, goalId: fx.goalRef.goalId, question: 'D89 question',
        focusTaskRefs: [], budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'd89',
        execution: { kind: 'semantic_query', roleBinding: fx.roleBinding, runtimeBudget: DEFAULT_RUNTIME_BUDGET } } },
      meta: { requestId: 'd89-submit', expected: [{ ref: fx.fixture.projectRef, revision: registration.project.revision },
        { ref: fx.fixture.workspaceRef, revision: registration.workspace.revision }, { ref: fx.goalRef, revision: goal.revision },
        { ref: job, revision: 0 }, { ref: run, revision: 0 }] } }));
      const session = await fx.platform.runtime.createSession(fx.ctx, { workspace: fx.scope, role, recommendedRefs: [],
        initialLinks: [], meta: { requestId: 'd89-session', expected: [] } });
      if (session.status !== 'completed') throw new Error(JSON.stringify(session));
      committed(await fx.platform.queries.claimQuery(fx.ctx, { input: { queryRunRef: run, sessionRef: session.value.ref },
        meta: { requestId: 'd89-claim', expected: [{ ref: job, revision: submitted.job.revision }, { ref: run, revision: submitted.run.revision },
          { ref: session.value.ref, revision: session.value.revision }] } }));
      const prepared = ready(await fx.platform.runtime.prepareQuery(fx.ctx, { queryRunRef: run, requestId: 'd89-prepare' }));
      expect(await fx.platform.runtime.startQuery(fx.ctx, { prepared, consumerId: 'd89', requestId: 'd89-start' }))
        .toMatchObject({ status: 'ready' });
      const request = fx.scripted.requests[0]!;
      expect(request.tools.map(tool => tool.name).sort()).toEqual(['read', ...SOURCE_TOOLS].sort());
      const names = request.tools.map(tool => tool.name);
      expectSkillText(request.systemPrompt, 'skill-platform-work', names);
      expectSkillText(request.systemPrompt, 'skill-platform-secretary', names);
      expect(request.systemPrompt).toContain(SKILLS['skill-platform-secretary']!.outside[0]!);
    } finally { await fx.close(); }
  }, 60_000);
});
