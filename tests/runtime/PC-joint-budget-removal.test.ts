/**
 * PC-1b joint step, PC-15 (rulings 20/21/22, book §5.2 lines 651-658).
 *
 * (a) The platform case, Work, through the frozen fixture's public steps. Run 1
 *     answers with 16,384 ASCII X and no tool call; its verification round is
 *     closed INCONCLUSIVE; the same Session continues into Run 2 with a long
 *     Host instruction, a byte meter and a window tight enough that only the
 *     history may be removed. Every expected input and the tool JSON are
 *     hand-written literals below; e1/e2/t are their JSON UTF-8 bytes.
 *
 * (b) A direct `runObservedModel` call with the frozen prompt helper: base "B",
 *     no Host instruction, the reference Skill `project-conventions`, input "Q",
 *     responseFormat json_object, a final-request byte counter and window 5,314.
 *     Only the reference Skill may be removed. The numbers are hand-computed
 *     from the hand-written request (236 + 726 + 40 + 4,096 + 256 = 5,354 does
 *     not fit; without the Skill 4,628 does; inputBytes 236 + 40 = 276).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget, type ModelInputCounter } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel } from '../../src/core/agent-runtime/observed-model-run.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { asyncCounter, mutablePromptPacks, openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';
import { frozenPromptInputs } from './PC-frozen-prompt.js';

const X = 'X'.repeat(16_384);
const EMPTY_SKILLS = { resourceRoot: resolve(import.meta.dirname, '../../vendor/coding-agent/resources/skills'), enabledIds: [] as string[] };
const HOST = 'H';

// ---- (a) hand-written expected run inputs and the request tool JSON ----------
const EXPECTED_INPUT_1 = "# Verified runtime task input\n\nThis is the current task context assembled from formal platform facts; it is not a transcript.\n\n## Runtime context\n## Runtime binding\nroleBinding: {\"policyRevision\":\"legacy-template\",\"tools\":[\"read\"],\"writeScope\":[]}\ntools: read\nwriteScope: (none)\n\n## Role specification\nrole: builder@1\nlabel: WP2 platform role\npurpose: WP2_PLATFORM_DUTY_PIN\nresponsibility: human_decision_support\nrequired materials: contract (Read the assigned Plan/Task)\nrequired outputs: answer-with-sources (Report the actual result)\nexit success: Report result\nexit stop: Stop on missing permission\nexit handoff: Keep references\n\nduty: secretary\n\ncontextResidentBytes: 4096\n\n## Goal\ngoal: r4c-claim-goal\nobjective: Exercise the atomic claim skeleton\nworkspace: r4c-claim-workspace@1\nautonomy: after_plan_confirmation\ncurrent understanding: 目标 r4c-claim-goal：还没有当前理解\n\n## Accepted task\ntask: Implement A (implement-a)\ninstruction: Implement A\nplan: r4c-claim-plan\nworkspace: r4c-claim-workspace@1\ndefinitionPlan: r4c-claim-plan@1\nstage: (未声明)\nmodule: (未声明)\nrequirementLevel: required\ndisposition: active\nphase: running\nobligations: [{\"obligationId\":\"obligation-1\",\"requirementLevel\":\"required\",\"taskIds\":[\"implement-a\",\"implement-b\",\"gate-goal\"],\"title\":\"Deliver implementation\",\"verificationRequirements\":[{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]}]\nacceptance: [{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]\nupstream: null\ndownstream: [{\"dependsOnId\":\"implement-a\",\"requires\":{\"kind\":\"output-contract\",\"label\":\"A output contract\"},\"taskId\":\"implement-b\"}]\nfailure: null\n\n## Reminders\n还没有观测\n{\"key\":\"decision:not_available:message_release\",\"node\":{\"kind\":\"goal\",\"ref\":{\"aggregateType\":\"Goal\",\"goalId\":\"r4c-claim-goal\",\"projectId\":\"r4c-claim-project\"}},\"sources\":[],\"text\":\"待决来源尚未接入：message_release\"}";
/** Same input, except the brief digest token (64 lowercase hex at run time). */
const EXPECTED_INPUT_2 = "# Verified runtime task input\n\nThis is the current task context assembled from formal platform facts; it is not a transcript.\n\n## Runtime context\n## Runtime binding\nroleBinding: {\"policyRevision\":\"legacy-template\",\"tools\":[\"read\"],\"writeScope\":[]}\ntools: read\nwriteScope: (none)\n\n## Role specification\nrole: builder@1\nlabel: WP2 platform role\npurpose: WP2_PLATFORM_DUTY_PIN\nresponsibility: human_decision_support\nrequired materials: contract (Read the assigned Plan/Task)\nrequired outputs: answer-with-sources (Report the actual result)\nexit success: Report result\nexit stop: Stop on missing permission\nexit handoff: Keep references\n\nduty: secretary\n\ncontextResidentBytes: 4096\n\n## Goal\ngoal: r4c-claim-goal\nobjective: Exercise the atomic claim skeleton\nworkspace: r4c-claim-workspace@1\nautonomy: after_plan_confirmation\ncurrent understanding: 目标 r4c-claim-goal：还没有当前理解\n\n## Accepted task\ntask: Implement A (implement-a)\ninstruction: Implement A\nplan: r4c-claim-plan\nworkspace: r4c-claim-workspace@1\ndefinitionPlan: r4c-claim-plan@1\nstage: (未声明)\nmodule: (未声明)\nrequirementLevel: required\ndisposition: active\nphase: running\nobligations: [{\"obligationId\":\"obligation-1\",\"requirementLevel\":\"required\",\"taskIds\":[\"implement-a\",\"implement-b\",\"gate-goal\"],\"title\":\"Deliver implementation\",\"verificationRequirements\":[{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]}]\nacceptance: [{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]\nupstream: null\ndownstream: [{\"dependsOnId\":\"implement-a\",\"requires\":{\"kind\":\"output-contract\",\"label\":\"A output contract\"},\"taskId\":\"implement-b\"}]\nfailure: null\n\n## Reminders\n还没有观测\n{\"key\":\"decision:not_available:message_release\",\"node\":{\"kind\":\"goal\",\"ref\":{\"aggregateType\":\"Goal\",\"goalId\":\"r4c-claim-goal\",\"projectId\":\"r4c-claim-project\"}},\"sources\":[],\"text\":\"待决来源尚未接入：message_release\"}\n当前理解该更新了：goal:r4c-claim-goal\n\n## 接续说明\n[continuation-brief v1 sha256:<brief-digest>]\n这是任务 implement-a 的接续执行（返工）：第 1 次重新入队，失败类别：检查不完整，发起方：人工。\n接续方式：在同一 Session session-745d82aab121011f9bdab7c9ab2507b971e7333d620d59edaa7baf706d13fb00 中继续，上一次的对话历史仍在。\n\n### 上一次执行\n- 执行 r4c-claim-id-1（Session session-745d82aab121011f9bdab7c9ab2507b971e7333d620d59edaa7baf706d13fb00）依据执行记录以 completed 结束。\n- 结束时间：2026-09-26T00:00:00.000Z。\n\n### 停在哪里\n- 执行记录读到位置 7，Turn 状态：completed。\n- 最后的助手输出：XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX…（已截断）\n- 读取的记录范围：位置 2–7。\n\n### 工具调用\n- 执行记录中没有工具调用。\n\n### 检查\n- 轮次 <round-id>（第 1 轮）未通过的检查：无\n- 缺口：source_changed、uncovered_requirement\n\n### 重新入队\n- 原因（人工）：Continue PC work\n- 新输入：材料 text/plain; charset=utf-8 sha256:1757f3ca9e7d2ba584eccdff1ebd60095f4649a19928ce1703b9a8ea2722893e：PC15\n\n### 工作区\n- 上一次执行经工具改动的文件（完整）：无\n- 上一次执行结束（2026-09-26T00:00:00.000Z）到“检查轮次开始”之间：无法从持久记录确定是否有改动。\n- 检查轮次开始 → 重新入队：有变化（具体文件无法从持久记录确定）\n- 重新入队 → 本次执行开始前：有变化（具体文件无法从持久记录确定）\n- 工作区不是 git 仓库，未提交的改动无法列出。\n\n### 继续之前\n- 文件可能已经变化，编辑前先重新读取。\n- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。\n- “没有执行”的工具调用没有产生结果，需要时重新发起。\n- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。";
const EXPECTED_TOOLS = [{"name":"code_index","description":"Query TS/JS declarations, definitions or semantic references within explicit readable files. Coordinates are one-based UTF-16. Returns source digests and partial coverage; no project config or external dependencies. Not a complete call graph. Use source_excerpt with a returned digest to fetch material.","inputSchema":{"type":"object","properties":{"paths":{"minItems":1,"maxItems":64,"type":"array","items":{"type":"string"}},"operation":{"type":"string","enum":["symbols","definitions","references"]},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"expectedSnapshot":{"type":"string","pattern":"^[a-f0-9]{64}$"},"limit":{"default":100,"type":"integer","minimum":1,"maximum":200}},"required":["paths","operation","limit"],"additionalProperties":false}},{"name":"cpp_index","description":"Query C/C++ project symbols, definitions, references, includes and static call candidates with libclang 18 and a required compile_commands.json. Compiler commands never execute; unknown flags and external include paths return explicit gaps. Only permission-filtered workspace files are exposed through a redirect-only VFS. One-based UTF-16 coordinates, source digests and analyzer identity accompany partial semantic results. In an observation, file-level edges come from a static C/C++ include scan only: runtime-only links are not edges, while system headers and git-ignored files are unresolved or absent. C/C++ is read for one target platform (x86_64-pc-linux-gnu when the database names none).","inputSchema":{"type":"object","properties":{"operation":{"type":"string","enum":["symbols","definitions","references","imports","calls"]},"configPath":{"type":"string"},"prefix":{"type":"string"},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"expectedSnapshot":{"type":"string","pattern":"^[a-f0-9]{64}$"},"offset":{"type":"integer","minimum":0,"maximum":9007199254740991},"limit":{"default":100,"type":"integer","minimum":1,"maximum":200}},"required":["operation","limit"],"additionalProperties":false}},{"name":"list_files","description":"List readable workspace file paths with bounded pagination. Includes installed/generated files; skips denied paths and symbolic links. No source execution.","inputSchema":{"type":"object","properties":{"prefix":{"type":"string","description":"Workspace-relative directory to enumerate recursively, not a file. Omit or use a single dot for the workspace root."},"offset":{"default":0,"type":"integer","minimum":0,"maximum":20000},"limit":{"default":100,"type":"integer","minimum":1,"maximum":300}},"required":["offset","limit"],"additionalProperties":false}},{"name":"project_source","description":"Read exact source materials through the frozen capture protocol. Actions: capture (one bounded capture; provider defaults to typescript, or text for a strict readable regular UTF-8/no-NUL text scope selected by prefix; optional configPath/prefix and optional previous capture for explicit changes; the trusted workspace root/revision/identity always come from the host, never from arguments), query (page a frozen capture with an opaque cursor: null on the first page, then the returned nextCursor; limit 1-200, default 100; paths lists only the files this capture retained, text is a literal line search with original line/UTF-16 columns and complete excerpts; semantic kinds are available only for a typescript capture), read (one exact file, at most 8192 bytes, either version working_tree for the current file, version capture for the exact frozen content of a retained capture, or version git with a full 40/64 lowercase commit id for one exact historical blob; a file outside the declared scope is refused rather than reported absent), compare (same-scope content diff of two captures: added/deleted/modified plus renamed only when one digest occurs exactly once in each complete manifest, marked identical_content and never a business identity claim; or two full Git commit ids with an optional prefix, compared by authorized regular-file blob id and mode; or one full Git commit id against one bounded current-working-tree observation of authorized regular UTF-8/no-NUL text, compared by raw-byte digest and owner-executable mode in either direction with an optional prefix and currentness not_rechecked; never by a ref or shell expression), verify (re-read the real scope now and confirm whether the capture still matches; a point-in-time answer, not a future guarantee), release (drop the capture when done). Coverage and change lists are returned as exact counts with at most five preview items of at most 160 code points each and an explicit truncated flag; the complete internal material is retained untrimmed. Pages are marked captured_source/not_rechecked unless verify says otherwise; captures cover only their declared scope (not the whole worktree) and a successful capture is not acceptance of the code.","inputSchema":{"type":"object","properties":{"action":{"type":"string","enum":["capture","query","read","compare","verify","release"]},"provider":{"type":"string","enum":["typescript","text"]},"configPath":{"type":"string"},"prefix":{"type":"string"},"previous":{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false},"capture":{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false},"query":{"anyOf":[{"type":"object","properties":{"kind":{"type":"string","enum":["paths"]},"prefix":{"type":"string"}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["text"]},"text":{"type":"string"},"caseSensitive":{"type":"boolean"},"prefix":{"type":"string"}},"required":["kind","text","caseSensitive"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["symbols"]},"path":{"type":"string"},"prefix":{"type":"string"}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["definitions"]},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991}},"required":["kind","path","line","column"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["references"]},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991}},"required":["kind","path","line","column"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["imports"]},"path":{"type":"string"},"prefix":{"type":"string"}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["calls"]},"path":{"type":"string"},"prefix":{"type":"string"}},"required":["kind"],"additionalProperties":false}]},"cursor":{"anyOf":[{"type":"string"},{"type":"null"}]},"limit":{"default":100,"type":"integer","minimum":1,"maximum":200},"path":{"type":"string"},"maxBytes":{"type":"integer","minimum":1,"maximum":8192},"version":{"anyOf":[{"type":"object","properties":{"kind":{"type":"string","enum":["working_tree"]}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["capture"]},"capture":{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false}},"required":["kind","capture"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["git"]},"commit":{"type":"string","pattern":"^(?:[a-f0-9]{40}|[a-f0-9]{64})$"}},"required":["kind","commit"],"additionalProperties":false}]},"before":{"anyOf":[{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["git"]},"commit":{"type":"string","pattern":"^(?:[a-f0-9]{40}|[a-f0-9]{64})$"}},"required":["kind","commit"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["working_tree"]}},"required":["kind"],"additionalProperties":false}]},"after":{"anyOf":[{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["git"]},"commit":{"type":"string","pattern":"^(?:[a-f0-9]{40}|[a-f0-9]{64})$"}},"required":["kind","commit"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["working_tree"]}},"required":["kind"],"additionalProperties":false}]}},"required":["action"],"additionalProperties":false}},{"name":"python_index","description":"Query readable Python project symbols, definitions, references, imports and static call candidates using Jedi on an isolated source snapshot. Includes source digests, commit and unresolved relations. Workspace pyrightconfig.json, pyproject.toml and setup.cfg import roots and readable .py/.pyi dependencies are parsed as data. Source and config changes invalidate results. Project code never executes; external interpreter environments and complete dynamic call graphs are not covered. In an observation, file-level edges come from a static Python import scan only: runtime-only links are not edges, while the standard library, external packages and git-ignored files are unresolved or absent.","inputSchema":{"type":"object","properties":{"operation":{"type":"string","enum":["symbols","definitions","references","imports","calls"]},"configPath":{"type":"string"},"prefix":{"type":"string"},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"expectedSnapshot":{"type":"string","pattern":"^[a-f0-9]{64}$"},"offset":{"type":"integer","minimum":0,"maximum":9007199254740991},"limit":{"default":100,"type":"integer","minimum":1,"maximum":200}},"required":["operation","limit"],"additionalProperties":false}},{"name":"read","description":"Read a UTF-8 file or list a directory inside the workspace. Path must be workspace-relative (README.md, never /workspace/README.md or a host path). Prefer this tool over shell cat/ls; use line ranges for large files.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative file or directory path, for example README.md; never absolute"},"startLine":{"description":"First line to return, 1-based","type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"endLine":{"description":"Last line to return, inclusive","type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"maxBytes":{"description":"Maximum source bytes to read","type":"integer","exclusiveMinimum":0,"maximum":9007199254740991}},"required":["path"],"additionalProperties":false}},{"name":"search","description":"Search literal text in workspace source without running shell commands. Returns matching lines with file content digests; bounded files/results and explicit skipped coverage. Use paths to narrow a query.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"paths":{"minItems":1,"maxItems":32,"type":"array","items":{"type":"string"}},"prefix":{"type":"string","description":"Workspace-relative directory to search recursively, not a file. Omit or use a single dot for the workspace root. Use paths for individual search files."},"maxResults":{"default":40,"type":"integer","minimum":1,"maximum":100},"maxFiles":{"default":200,"type":"integer","minimum":1,"maximum":500}},"required":["query","maxResults","maxFiles"],"additionalProperties":false}},{"name":"source_excerpt","description":"Read a bounded source range at an exact content digest from code_index or symbols. Returns stale if content changed; never silently substitutes newer source.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"expectedDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"startLine":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"endLine":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991}},"required":["path","expectedDigest","startLine","endLine"],"additionalProperties":false}},{"name":"symbols","description":"Parse a file into declarations, imports and syntactic call sites using TypeScript/JavaScript AST or Python AST. Does not execute project code or resolve runtime behavior. Unsupported languages explicitly return text fallback.","inputSchema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}}] as const;

// W = C + D + 4 + 4,096 + 256 with C = 293 + e2 + t, D = 16,564 + e1.
// The placeholders stand for the 64-hex brief digest and the 36-character
// round id; the test fills the same literals with the public values below.
const e1 = Buffer.byteLength(JSON.stringify(EXPECTED_INPUT_1), 'utf8') - 2;
const e2 = Buffer.byteLength(JSON.stringify(EXPECTED_INPUT_2
  .replace('<brief-digest>', 'f'.repeat(64)).replace('<round-id>', 'f'.repeat(36))), 'utf8') - 2;
const t = Buffer.byteLength(JSON.stringify(EXPECTED_TOOLS), 'utf8');
const hostLength = 16_564 + e1;
const window = 21_213 + e1 + e2 + t;
const cap = 256;
const hostInstruction = HOST.repeat(hostLength);
const ZERO_REMOVALS = {
  memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
  historyExchange: 0, historyConclusion: 0, currentExchange: 0,
};

describe('PC-15 (a): the platform Work removes exactly the old history', () => {
  it('keeps system, current input and the two removal counts through run 2', async () => {
    expect([e1, e2, t]).toEqual([2_136, 8_220, 14_993]);
    expect(window).toBe(46_562);
    expect(window + (16_564 + e1)).toBeLessThanOrEqual(100_000);

    const counter = asyncCounter(256);
    const fixture = await openPCWorkFixture({
      model: scriptedModel([{ text: X }, { text: 'PC15 run 2 answer' }]),
      systemInstruction: null,
      skills: EMPTY_SKILLS,
      selection: { modelId: 'pc15-model', promptPack: 'platform', reasoningReplay: 'none' },
      inputCounter: counter,
      budget: { contextWindowTokens: 200_000, perResponseTokens: 32_768 },
    });
    try {
      fixture.packs.change({ base: 'B' });
      await fixture.work.prepare();
      const started1 = await fixture.work.start();
      expect(started1.status, JSON.stringify(started1)).toBe('ready');
      if (started1.status !== 'ready') return;
      expect(started1.value.run.status).toBe('ended');
      expect(started1.value.run.outcome).toBe('completed');
      const request1 = fixture.model.requests[0]!;
      expect(request1.systemPrompt).toBe('B');
      expect(request1.tools).toEqual(EXPECTED_TOOLS);
      expect(request1.messages).toHaveLength(1);
      expect(request1.messages[0]).toMatchObject({ role: 'user', content: EXPECTED_INPUT_1 });

      // Close the first verification round through the platform's public steps:
      // an empty check list leaves the real uncovered requirement, so the round
      // is INCONCLUSIVE and the Task can be requeued.
      const claim = fixture.base.claim!;
      fixture.base.platform.registerCheckConfiguration({ configuration: {
        configurationRevision: 'pc15-checks@1',
        workspace: fixture.base.fixture.workspaceRef,
        executor: { kind: 'human', id: 'r4c-claim-operator' },
        permissionRevision: 'wp2-workspace-read@1',
        sourceAccess: 'verification_workspace',
        processAccess: 'all_except_denied',
        deniedPrefixes: ['.git'],
        checks: [],
      } });
      const opened = await fixture.base.platform.evidence.openVerification(fixture.base.ctx, {
        input: { subjectRunRef: fixture.work.runRef, subject: claim.task, planRef: claim.planRef },
        meta: { requestId: 'pc15-open', expected: [] },
      });
      expect(opened.status, JSON.stringify(opened)).toBe('committed');
      if (opened.status !== 'committed') return;
      const finalized = await fixture.base.platform.evidence.finalizeChecks(fixture.base.ctx, {
        input: { roundRef: opened.value.ref },
        meta: { requestId: 'pc15-final', expected: [{ ref: opened.value.ref, revision: opened.value.revision }] },
      });
      expect(finalized.status, JSON.stringify(finalized)).toBe('committed');
      if (finalized.status !== 'committed') return;
      expect(finalized.value.snapshot.status).toBe('finalized');
      expect(finalized.value.snapshot.outcome).toBe('INCONCLUSIVE');

      // The binding is installed before run 2's first prepare; the same Session.
      const next = await fixture.continuation(fixture.work.runRef, 'PC15');
      fixture.installBinding({
        systemInstruction: hostInstruction,
        budget: { contextWindowTokens: window, perResponseTokens: cap },
        inputCounter: null,
      });
      await next.prepare();

      const started2 = await next.start();
      expect(started2.status, JSON.stringify(started2)).toBe('ready');
      if (started2.status !== 'ready') return;
      expect(started2.value.run.ref.runId).not.toBe(started1.value.run.ref.runId);
      expect(started2.value.run.executionHistory?.sessionRef)
        .toEqual(started1.value.run.executionHistory?.sessionRef);
      expect(started2.value.run.status).toBe('ended');
      expect(started2.value.run.outcome).toBe('completed');
      expect(fixture.model.calls()).toBe(2);

      // The two public identifiers the expected input carries: the digest the
      // public brief read returns and the round id the public open returned.
      const brief = await fixture.base.platform.runtime.readContinuationBrief!(
        fixture.base.ctx, { runRef: next.runRef });
      expect(brief.status, JSON.stringify(brief)).toBe('ready');
      if (brief.status !== 'ready' || brief.value === null) throw new Error(JSON.stringify(brief));
      const filled = EXPECTED_INPUT_2
        .replace('<brief-digest>', brief.value.digest)
        .replace('<round-id>', opened.value.ref.roundId);

      const request2 = fixture.model.requests[1]!;
      expect(request2.systemPrompt).toBe('B\n\n' + hostInstruction);
      expect(request2.responseFormat).toBeUndefined();
      expect(request2.tools).toEqual(EXPECTED_TOOLS);
      // The removed history leaves the current user input as the only message:
      // no old user id and no old assistant message at all.
      expect(request2.messages).toHaveLength(1);
      const current = request2.messages[0] as { role: string; messageId: string; content: string };
      expect(current.role).toBe('user');
      expect(current.content).toBe(filled);
      expect(current.content).toContain('X'.repeat(4_000));
      expect((request1.messages[0] as { messageId: string }).messageId).not.toBe(current.messageId);

      const read2 = await next.readPromptRecord();
      expect(read2.status, JSON.stringify(read2)).toBe('ready');
      if (read2.status !== 'ready') return;
      expect(read2.value.requests).toHaveLength(1);
      const recorded = read2.value.requests[0]!;
      expect(recorded.kind).toBe('work');
      if (recorded.kind === 'work') expect(recorded.maxOutputTokens).toBe(cap);
      expect(recorded.selection.inputTokens).toBe(window - cap);
      expect(recorded.selection.budget).toBe(window - cap);
      expect(recorded.selection.removed).toEqual({ ...ZERO_REMOVALS, historyExchange: 1, historyConclusion: 1 });
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

// ---- (b) responseFormat: a direct runObservedModel call ---------------------
const SKILL_ROOT = resolve(import.meta.dirname, '../../vendor/coding-agent/resources/skills');
const PROJECT_SKILLS = { resourceRoot: SKILL_ROOT, enabledIds: ['project-conventions'] };
const JSON_BUDGET = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 5_314, perResponseTokens: 256 };
const JSON_WINDOW = 5_314;
const JSON_CAP = 256;

function finalRequestCounter(requests: kernel.ModelRequest[]): ModelInputCounter {
  return {
    async count(request) {
      requests.push(structuredClone(request));
      return { tokens: Buffer.byteLength(JSON.stringify(request), 'utf8') + 4_096,
        method: 'conservative_utf8_estimate', tokenizer: 'pc15-final-request-bytes' };
    },
  };
}

describe('PC-15 (b): responseFormat is part of the measured final request', () => {
  it('removes the one reference Skill and sends the final request with json_object', async () => {
    const packs = await mutablePromptPacks();
    packs.change({ base: 'B' });
    const prompt = await frozenPromptInputs({ promptPacks: packs, skills: PROJECT_SKILLS });
    expect(prompt.base.text).toBe('B');
    expect(prompt.skills.map(skill => skill.id)).toEqual(['project-conventions']);

    const root = await mkdtemp(join(tmpdir(), 'pc15-json-'));
    const databasePath = join(root, 'kernel.sqlite');
    try {
      await writeFile(join(root, 'note.txt'), 'PC15 response format workspace.\n');
      const requests: kernel.ModelRequest[] = [];
      const client: kernel.ModelClientPort = {
        async *stream(request, options) {
          options.signal.throwIfAborted();
          requests.push(structuredClone(request));
          const base = { schemaVersion: 1 as const, requestId: request.requestId };
          yield { ...base, sequence: 1, type: 'text_delta', delta: 'pc15 json answer' };
          yield { ...base, sequence: 2, type: 'completed', reason: 'final_answer' };
        },
      };
      const counterRequests: kernel.ModelRequest[] = [];
      const meter = new ModelBudget(JSON_BUDGET, async () => {}, finalRequestCounter(counterRequests));
      const promptFacts = new Map();
      const result = await runObservedModel({
        kernel,
        bound: { configuration: { revision: 'pc15-json@1', provider: 'deepseek',
          model: 'pc15-json-model', baseUrl: 'http://127.0.0.1' }, client },
        root, databasePath, sessionId: 'pc15-json-session', input: 'Q',
        budget: JSON_BUDGET, taskBudget: { tokenBudget: null, deadline: null },
        meter, readOnly: true, allowedTools: [], signal: new AbortController().signal,
        deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
        prompt, responseFormat: { type: 'json_object' },
        bodies: new RawArtifactBodyStore(), promptFacts,
        executionIdentity: { runId: 'pc15-json', turnId: 'pc15-json-turn' },
        origin: { kind: 'run', owner: { aggregateType: 'Run', projectId: 'pc15-json-project',
          goalId: 'pc15-json-goal', runId: 'pc15-json' } },
      });
      expect(result.state.status).toBe('completed');
      expect(requests).toHaveLength(1);
      const request = requests[0]!;
      expect(request.systemPrompt).toBe('B');
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0]).toMatchObject({ role: 'user', content: 'Q' });
      expect(request.tools).toEqual([]);
      expect(request.responseFormat).toEqual({ type: 'json_object' });
      expect(request.maxOutputTokens).toBe(JSON_CAP);

      // Every measurement is a candidate: the Skill-bearing one does not fit,
      // the Skill-free one fits, and the reservation measures the same final
      // request once more (276 bytes + 4,096).
      expect(counterRequests).toHaveLength(3);
      const measured = counterRequests.at(-1)!;
      expect(measured.systemPrompt).toBe('B');
      expect(measured.responseFormat).toEqual({ type: 'json_object' });
      expect(Buffer.byteLength(JSON.stringify(measured), 'utf8')).toBe(276);

      expect(meter.entries).toHaveLength(1);
      const entry = meter.entries[0]!;
      expect(entry.inputBytes).toBe(276);
      expect(entry.reservedInput).toBe(4_372);
      expect(entry.reservedOutput).toBe(256);
      expect(meter.exhausted).toBe(false);

      const facts = promptFacts.get(request.requestId);
      expect(facts).toBeDefined();
      expect(facts.selection.inputTokens).toBe(4_372);
      expect(facts.selection.budget).toBe(5_058);
      expect(facts.selection.removed).toEqual({ ...ZERO_REMOVALS, skillReference: 1 });
      expect(facts.maxOutputTokens).toBe(256);
      expect(facts.systemDigest).toHaveLength(64);
      // The final window arithmetic: without the reference Skill it fits.
      expect(236 + 40 + 4_096 + 256).toBeLessThanOrEqual(JSON_WINDOW);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
