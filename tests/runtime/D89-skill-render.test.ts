/**
 * Decision 89 small step: the five Skill templates render the locked paragraphs
 * and their tool blocks by the final grant. Every expected fragment below is
 * hand-written from the frozen draft's §3.1–§3.5 fences (the spec), never copied
 * from a render; the hand-computed blank-line count is the same for every grant.
 * The six grant combinations are one pure table; two real calls on memory check
 * the final tools a Work and a Query end with and the paragraphs they render.
 */
import { describe, expect, it } from 'vitest';
import { createBuiltinProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import { createWorkbenchRuntimeHostBindings, type PlatformBehavior, type WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { committed, ready } from '../helpers/S1-runtime-scenario-fixture.js';
import { createWP2Platform } from '../helpers/WP2-platform-support.js';

const PACK = PLATFORM_PROMPT_PACK_V1;
type Skill = { readonly outside: readonly string[]; readonly blocks: Readonly<Record<string, string>>; readonly blankLines: number };

/** Hand-written outside lines, block bodies (by name) and blank-line counts, from the draft. */
const SKILLS: Readonly<Record<string, Skill>> = {
  'skill-platform-work': {
    outside: "## 共享的东西只写一份\n同一个工作区里常有几个成员同时在改代码。每个人只看得见开工时的代码、自己写的和别人已经落盘的文件，所以两个任务都需要的一条规则，很容易各写一份。两份当时一样，后来只改了一份，行为就悄悄分了岔：同一个输入一处接受、一处拒绝，修好的毛病在另一份里还在。派工只核版本，冲突只看同一个文件，两份代码的测试各自都会通过，都发现不了这种重复。这一节的目的：一条规则只有一个家，而且动手之前就知道家在哪。\n什么时候照做：你要新写的东西带着规则（校验、上限、格式和解析、状态怎么变、给人看的文字、配置项），或者别的文件也会用到（对外的函数、类型和常量，测试的辅助和夹具）。不带规则、只整理本地数据的小函数不必照做。把这次要写的几件东西放在一起查一次，记住结果；只有范围、约定或输入变了才重查。\n1. 先找现成的，按内容找，不只按名字找。\n   为什么：别人起的名字你猜不到，同一条规则里的数字和消息却是一样的；在写之前拦下重复，代价最小。\n2. 找到了就用它。不完全合适时，在它原来的地方做最小的扩展（在你的授权范围内），或者请它的负责人扩展；不要复制一份再改几处。\n   为什么：改过几处的副本最难发现，看着一样，其实不一样。\n3. 照接口约定走，看清同时在做的同伴。\n   - 约定把这件东西交给了别的任务：照约定的名字和接口用。对方还没写完，先做你不依赖它的部分，真的卡住才让出等它。\n   - 约定里没有、同伴看起来也会要：请协调的人（这个目标的参谋，没有参谋就是秘书）定归属。\n     不管问到没有，都写进做完时的说明，交回给派工的人。\n   为什么：归属在约定里定；问一句的代价，远小于事后审出重复再返工。\n4. 等不到答复、又必须往下走：先写在你自己的文件里，不导出。答复或共享的那份到了就换过去；做完之前，把已经能换掉的临时件删掉。\n   为什么：不导出能少很多直接引用，以后换成共享的那份时要改的地方少；临时件留着不收，就成了第二份。\n5. 你确实新建了共享的东西：放进管这个概念的模块，而不是你正在写的功能文件。\n   为什么：同伴动模块前先看锚点上的注记；只靠搜代码，要猜中词才找得到。\n6. 做完时的说明（最后的回答，和发出的“请知悉”）里，列出你新建的共享件（名字 → 文件），以及还没换掉的临时件和原因（列为未解决）。\n   为什么：参谋和审阅者拿这份清单核对重叠，同伴也借此知道它已经有了。\n这些步骤不改变派工：要和正在做的任务改同一个模块，仍然先等接口约定或明确放行。上面说的“接着做”，指已经获准动手以后，归属没定不妨碍你先做不依赖它的部分。\n接口约定（参谋记，没有参谋时秘书记；大家按它来查）：\n- 种类 `convention`，挂在那个模块锚点上，话题固定写“接口约定”。\n- 结论一句话说清分工；正文一行一件共享件：名字 | 负责的任务 | 接口（输入和输出） | 放在哪个文件；最后列“直接复用的现成件”。\n- 改约定前先读现行的那条，保留仍然适用的分工，再写一条新的，用 `replaces` 指向旧的。同一个模块上读到两条现行的接口约定，交给书记理清。\n为什么：话题固定，大家用同一个词就查得到；每次用新条取代旧条，是为了让现行的分工只有一份。平台允许两条并存，同时写入也可能留下两条，所以读到两条时要交给书记，而不是自己挑一条。".split('\n'),
    blocks: {
      'work.search': "   - 用 `search` 搜这条规则里不会变的字面量：上限数字、错误消息、字段名、配置键。", 'work.code_index': "   - 用 `code_index` 查你想到的几个名字有没有定义。",
      'work.lookup': "   - 用 `look_graph` 的 `lookup` 读你要动的模块锚点，看话题（`topics`）里有没有“接口约定”和说明某件东西放在哪的约定。", 'work.children': "   - 用 `look_graph` 读目标节点的子项（阶段和不在阶段里的任务），相关阶段再读一层它的子项，结果分页时按返回的游标翻完；再看任务卡上的状态和模块，知道哪些任务正在做、动哪些模块。",
      'work.discovery': "     不知道该找谁时，可以用 `find_related_sessions` 按这个模块或任务找相关的线，从它们的卡片里认出参谋或秘书；找不到就走下面的退路。", 'work.send': "     知道该找谁时（例如派你这项工作的就是他），用 `send_session_message` 发行动请求（`action_request`），`needsReply` 为真、`waitAfterSend` 为假，接着做不依赖它的部分。只读问询（`inquiry`）只能问已经定了的归属：回答你的是对方的只读副本，它不能替对方定分工。",
      'work.question': "     发不出消息时，用 `record_note` 在那个模块上记一条 `open_question`（例如“X 归谁写？我先在某文件里写了一份不导出的”）。记下不等于对方已经收到。", 'work.convention': "   - 用 `record_note` 在那个模块锚点上记一条 `convention`：话题写它的名字，结论一句话（“X 只在某文件里，要用就引用它，不另写”），`facts` 指向那个文件。",
    },
    blankLines: 17,
  },
  'skill-platform-adviser': {
    outside: "## 拆并行任务：共享件先定归属\n原因见共同工作原则“共享的东西只写一份”。能在开工前定下“谁来写”的只有计划和接口约定，所以这一步在你这里。目的：每个共享件开工前就有唯一负责的任务，别的任务只用它。\n什么时候照做：做计划、改计划时，凡是会同时进行的任务；要派一个和正在做的任务改同一个模块的任务之前。\n1. 列共享件。对每组会同时做的任务问一句：“它们各自单干，会各写出哪些一样的东西？”常见的有数据结构和类型、校验规则和上限、格式和解析、状态怎么变、给人看的文字、测试的辅助和夹具。\n2. 每件定一个去处。已经有的，写进相关任务的说明：“用现成的 X（某文件）”。新的只交给一个任务写，写明名字、输入和输出、放在哪；其他任务的说明写“用任务 T 提供的 X”。几乎所有任务都要的一小块，可以排成一个先做的小任务。\n   为什么：说明里写明用谁的，执行者就不必猜。先做一小块会让并行晚开始，所以只在很多任务都依赖它时这样排。\n3. 分工要放在执行者会看的地方：每个任务的说明里，和模块上的接口约定（格式见共同工作原则）。\n   - 这一轮记不了注记（例如只读的规划回答）时，把分工写进计划草案的任务说明，并写明接口约定要记什么，由之后有权写的那一轮落实；不要说已经记下。\n4. 有人请你定归属时尽快定。\n   - 这一轮记不了注记时，把定下的归属写进回答，交给之后有权写的那一轮。\n   为什么：问题挂着不答，对方只能先写一份。\n5. 收到完成说明或变化提醒时，对照里面新建的共享件和还在做的任务；有重叠，马上告诉还在做的一方改用现成的。\n   为什么：对方做完之前提醒，改一处就够；做完以后，两份都要审、都要合。".split('\n'),
    blocks: {
      'adviser.search': "   - 再用 `search` 查哪些其实已经有了。", 'adviser.note': "   - 用 `record_note` 把接口约定记在模块上。",
      'adviser.lookup': "   - 被唤醒时，用 `look_graph` 的 `lookup` 看一次这一轮相关模块上新的 `open_question`；同一轮里不重复看。", 'adviser.update': "   - 定了就用 `record_note` 更新接口约定（先读现行的，再写一条新的取代它），并记一条 `decision`，用 `replaces` 收掉那条问题。",
    },
    blankLines: 18,
  },
  'skill-platform-reviewer': {
    outside: "## 查重复实现\n原因见共同工作原则“共享的东西只写一份”。你是合入之前最后一个能看出它的人。目的：合入之前找出“同一条规则写了两份”，并给出只留一份的改法。\n什么时候照做：被审的工作新加了带规则或对外的东西，或者它和别的任务同时做过。\n1. 列出这次新加的定义：从被审工作改过的文件，和它做完时列出的共享件、临时件清单入手。\n2. 把这次新加的几条规则放在一起，按内容和名字在全库找一遍，也看同时进行的任务新加的东西；已经核过的不重复找。\n   为什么：重复的两份常常名字不同，只按名字找会漏。\n3. 确认是同一条规则写了两份，才报为问题：写出两处位置、该留哪一份（接口约定里的负责任务，或已经有调用方的那份）、要改的调用处，以及只改一份会出现什么不一致。算不算问题，看它是不是同一条规则，不看它多短、导没导出；临时件没有收回，也按重复报。只是长得像、规则其实不同的，说明为什么不算；不带规则、只整理本地数据的小函数，最多给一条非阻塞的建议。\n   为什么：给出能直接照做的一种改法，返工一次就能收；把相似当成重复，会让人去合并本来就该不同的东西。\n4. 这次工作开始之前就存在的重复，另列为清理建议，不算这次的问题。\n   为什么：审查的是这次的工作；旧账混进来，返工就没有边界。".split('\n'),
    blocks: {
      'reviewer.diff': "   - 可以用 `run_readonly_command` 跑 `git diff` 看改动。", 'reviewer.search': "   - 用 `search` 搜它的字面量、消息和字段名。",
      'reviewer.code_index': "   - 用 `code_index` 查同名定义。",
    },
    blankLines: 9,
  },
  'skill-platform-scribe': {
    outside: "## 注记里露出的重复代码\n- 两条注记都说某件东西“只在这里”，却指向不同的文件；或者同一个模块上读到两条现行的接口约定。照常理清注记；同时把它当作代码里可能有两份的线索，连同两条注记和两个文件告诉相关目标的参谋。\n  为什么：注记你能理清，代码里的两份要由参谋安排谁来改；你不改代码，也不派返工。".split('\n'),
    blocks: { 'scribe.send': "  - 用 `send_session_message` 发“请知悉”。" },
    blankLines: 11,
  },
  'skill-platform-secretary': {
    outside: "## 没有参谋时的接口约定\n- 目标没有参谋时，共享件的归属由你定：列出几个任务都会用到的共享件，每件只交给一个任务写。收到请你定归属的行动请求，或者读到模块上的 `open_question`，也由你定。\n  - 这一轮记不了注记时，把分工写进计划草案或回答，由之后有权写的那一轮落实；不要说已经记下。\n  为什么：没有参谋时，这件事没有别人接；你不定，执行者只能各写一份。".split('\n'),
    blocks: { 'secretary.note': "  - 用 `record_note` 按共同工作原则里的格式记接口约定（更新时先读现行的，再写一条新的取代它）；回答了 `open_question` 的，记一条 `decision` 用 `replaces` 收掉它。" },
    blankLines: 13,
  },
};

/** Every block body by its name. */
const BLOCKS: Readonly<Record<string, string>> = Object.fromEntries(Object.values(SKILLS).flatMap(skill => Object.entries(skill.blocks)));

const ALL_TOOLS = [
  'read', 'edit', 'shell', 'search', 'code_index', 'look_graph', 'send_session_message',
  'find_related_sessions', 'record_note', 'run_readonly_command',
] as const;

/** S2: each grant with its hand-computed visible blocks. The four partial grants each add exactly one of
 * `search`, `code_index`, `look_graph` and `run_readonly_command`, so no two of those four share a row. */
const COMBOS: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
  ['all tools', ALL_TOOLS, Object.keys(BLOCKS)],
  ['none', [], []],
  ['send without notes, with search', ['send_session_message', 'find_related_sessions', 'search'],
    ['work.search', 'work.discovery', 'work.send', 'adviser.search', 'reviewer.search', 'scribe.send']],
  ['notes without send, with code_index', ['record_note', 'code_index'], ['work.code_index', 'work.question',
    'work.convention', 'adviser.note', 'adviser.update', 'reviewer.code_index', 'secretary.note']],
  ['discovery without send, with look_graph', ['find_related_sessions', 'look_graph'],
    ['work.lookup', 'work.children', 'adviser.lookup']],
  ['send without discovery, with run_readonly_command', ['send_session_message', 'run_readonly_command'],
    ['work.send', 'scribe.send', 'reviewer.diff']],
];

describe('decision 89 Skill rendering', () => {
  it.each(COMBOS)('renders all five Skills with %s', (_name, tools, visible) => {
    for (const [id, skill] of Object.entries(SKILLS)) {
      const text = renderTemplate(PACK, id, {}, tools).text;
      for (const line of skill.outside) expect(text, `${id} outside line`).toContain(line);
      for (const [name, body] of Object.entries(skill.blocks)) {
        if (visible.includes(name)) expect(text, `${name} present`).toContain(body);
        else expect(text, `${name} absent`).not.toContain(body);
      }
      expect(text.split('\n').filter(line => line === ''), `${id} blank lines left`).toHaveLength(skill.blankLines + 1);
    }
  });
});

/** What a read grant ends with besides its builtin tools: the source tools (`project_source` with the frozen
 * source), src/core/agent-runtime/tool-group-assembly.ts:51 and :476. */
const SOURCE_TOOLS = ['list_files', 'search', 'symbols', 'code_index', 'project_source', 'python_index', 'cpp_index', 'source_excerpt'];
/** The common principles' blocks a read grant shows, and the look_graph, send, discovery and notes ones it hides. */
const READ_SHOWN = ['work.search', 'work.code_index'];
const READ_HIDDEN = ['work.lookup', 'work.children', 'work.send', 'work.discovery', 'work.question', 'work.convention'];

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

function expectPrompt(prompt: string, shown: readonly string[], hidden: readonly string[]): void {
  for (const name of shown) expect(prompt, `${name} present`).toContain(BLOCKS[name]);
  for (const name of hidden) expect(prompt, `${name} absent`).not.toContain(BLOCKS[name]);
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
      expectPrompt(request.systemPrompt, READ_SHOWN, READ_HIDDEN);
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
      expectPrompt(request.systemPrompt, READ_SHOWN, [...READ_HIDDEN, 'secretary.note']);
      expect(request.systemPrompt).toContain(SKILLS['skill-platform-secretary']!.outside[0]);
    } finally { await fx.close(); }
  }, 60_000);
});
