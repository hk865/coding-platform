/**
 * PC-2 joint step: PC-20 prepare-to-request (the final tool list renders the
 * system text through a real Work preparation and start, and the same frozen
 * list reaches a Skill and the continuation brief) and PC-26 (a Work and a Query
 * run use `list_files`, the Work also `record_note`; a person's pack changes
 * their descriptions, the frozen set carries the hand-computed digest, a later
 * pack change never reaches the prepared start or resume, and `toolSpecsRef`
 * holds the whole hand-written spec JSON).
 *
 * The expected texts are hand-written; the digest is sha256 over a literal
 * canonical body. `read_source` stays renderer-only (no public path selects it).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { PROMPT_TOOL_TEXT_CONTENT_TYPE } from '../../src/contracts/prompts/prompt-set.js';
import { PLATFORM_SKILL_RESOURCE_ROOT } from '../../src/core/agent-runtime/platform-skill-root.js';
import { rlQueryHostCtx } from '../helpers/RL-query-fixture.js';
import {
  openPCQueryFixture, openPCWorkFixture, replyGate, scriptedModel,
} from '../helpers/PC-platform-fixture.js';
import { PC2_WORK_INPUT, pc2PackEntry, pc2ResolvedSource } from '../helpers/PC2-pack-fixture.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const runGit = promisify(execFile);
const git = async (directory: string, args: string[]): Promise<void> => {
  await runGit('git', args, { cwd: directory });
};

/** A committed baseline so the Kernel's own resume sees an unchanged workspace. */
async function gitBaseline(directory: string): Promise<void> {
  await git(directory, ['init']);
  await git(directory, ['config', 'user.email', 'pc@example.test']);
  await git(directory, ['config', 'user.name', 'PC']);
  await writeFile(`${directory}/.gitignore`, '*.sqlite*\n');
  await git(directory, ['add', '.gitignore', 'wp2-read.txt']);
  await git(directory, ['commit', '-m', 'PC joint tool baseline']);
}
const NO_SKILLS = { resourceRoot: '/nonexistent/pc2-joint', enabledIds: [] as string[] };
const NOTE_BODY = JSON.stringify({ description: 'PC2 note text', parameters: {} });
const LIST_BODY = JSON.stringify({ description: 'PC2 list text', parameters: { prefix: 'PC2 prefix text' } });

// The complete Kernel spec JSON of every tool, hand-written in the frozen order.
// The pack changes only the list_files/record_note texts; the rest is the
// platform contract. `toolSpecsRef` must be these exact bytes, never a substring.
const CODE_INDEX_SPEC = '{"name":"code_index","description":"Query TS/JS declarations, definitions or semantic references within explicit readable files. Coordinates are one-based UTF-16. Returns source digests and partial coverage; no project config or external dependencies. Not a complete call graph. Use source_excerpt with a returned digest to fetch material.","inputSchema":{"type":"object","properties":{"paths":{"minItems":1,"maxItems":64,"type":"array","items":{"type":"string"}},"operation":{"type":"string","enum":["symbols","definitions","references"]},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"expectedSnapshot":{"type":"string","pattern":"^[a-f0-9]{64}$"},"limit":{"default":100,"type":"integer","minimum":1,"maximum":200}},"required":["paths","operation","limit"],"additionalProperties":false}}';
const CPP_INDEX_SPEC = '{"name":"cpp_index","description":"Query C/C++ project symbols, definitions, references, includes and static call candidates with libclang 18 and a required compile_commands.json. Compiler commands never execute; unknown flags and external include paths return explicit gaps. Only permission-filtered workspace files are exposed through a redirect-only VFS. One-based UTF-16 coordinates, source digests and analyzer identity accompany partial semantic results. In an observation, file-level edges come from a static C/C++ include scan only: runtime-only links are not edges, while system headers and git-ignored files are unresolved or absent. C/C++ is read for one target platform (x86_64-pc-linux-gnu when the database names none).","inputSchema":{"type":"object","properties":{"operation":{"type":"string","enum":["symbols","definitions","references","imports","calls"]},"configPath":{"type":"string"},"prefix":{"type":"string"},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"expectedSnapshot":{"type":"string","pattern":"^[a-f0-9]{64}$"},"offset":{"type":"integer","minimum":0,"maximum":9007199254740991},"limit":{"default":100,"type":"integer","minimum":1,"maximum":200}},"required":["operation","limit"],"additionalProperties":false}}';
const LIST_FILES_SPEC = '{"name":"list_files","description":"PC2 list text","inputSchema":{"type":"object","properties":{"prefix":{"type":"string","description":"PC2 prefix text"},"offset":{"default":0,"type":"integer","minimum":0,"maximum":20000},"limit":{"default":100,"type":"integer","minimum":1,"maximum":300}},"required":["offset","limit"],"additionalProperties":false}}';
const PROJECT_SOURCE_SPEC = '{"name":"project_source","description":"Read exact source materials through the frozen capture protocol. Actions: capture (one bounded capture; provider defaults to typescript, or text for a strict readable regular UTF-8/no-NUL text scope selected by prefix; optional configPath/prefix and optional previous capture for explicit changes; the trusted workspace root/revision/identity always come from the host, never from arguments), query (page a frozen capture with an opaque cursor: null on the first page, then the returned nextCursor; limit 1-200, default 100; paths lists only the files this capture retained, text is a literal line search with original line/UTF-16 columns and complete excerpts; semantic kinds are available only for a typescript capture), read (one exact file, at most 8192 bytes, either version working_tree for the current file, version capture for the exact frozen content of a retained capture, or version git with a full 40/64 lowercase commit id for one exact historical blob; a file outside the declared scope is refused rather than reported absent), compare (same-scope content diff of two captures: added/deleted/modified plus renamed only when one digest occurs exactly once in each complete manifest, marked identical_content and never a business identity claim; or two full Git commit ids with an optional prefix, compared by authorized regular-file blob id and mode; or one full Git commit id against one bounded current-working-tree observation of authorized regular UTF-8/no-NUL text, compared by raw-byte digest and owner-executable mode in either direction with an optional prefix and currentness not_rechecked; never by a ref or shell expression), verify (re-read the real scope now and confirm whether the capture still matches; a point-in-time answer, not a future guarantee), release (drop the capture when done). Coverage and change lists are returned as exact counts with at most five preview items of at most 160 code points each and an explicit truncated flag; the complete internal material is retained untrimmed. Pages are marked captured_source/not_rechecked unless verify says otherwise; captures cover only their declared scope (not the whole worktree) and a successful capture is not acceptance of the code.","inputSchema":{"type":"object","properties":{"action":{"type":"string","enum":["capture","query","read","compare","verify","release"]},"provider":{"type":"string","enum":["typescript","text"]},"configPath":{"type":"string"},"prefix":{"type":"string"},"previous":{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false},"capture":{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false},"query":{"anyOf":[{"type":"object","properties":{"kind":{"type":"string","enum":["paths"]},"prefix":{"type":"string"}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["text"]},"text":{"type":"string"},"caseSensitive":{"type":"boolean"},"prefix":{"type":"string"}},"required":["kind","text","caseSensitive"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["symbols"]},"path":{"type":"string"},"prefix":{"type":"string"}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["definitions"]},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991}},"required":["kind","path","line","column"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["references"]},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991}},"required":["kind","path","line","column"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["imports"]},"path":{"type":"string"},"prefix":{"type":"string"}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["calls"]},"path":{"type":"string"},"prefix":{"type":"string"}},"required":["kind"],"additionalProperties":false}]},"cursor":{"anyOf":[{"type":"string"},{"type":"null"}]},"limit":{"default":100,"type":"integer","minimum":1,"maximum":200},"path":{"type":"string"},"maxBytes":{"type":"integer","minimum":1,"maximum":8192},"version":{"anyOf":[{"type":"object","properties":{"kind":{"type":"string","enum":["working_tree"]}},"required":["kind"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["capture"]},"capture":{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false}},"required":["kind","capture"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["git"]},"commit":{"type":"string","pattern":"^(?:[a-f0-9]{40}|[a-f0-9]{64})$"}},"required":["kind","commit"],"additionalProperties":false}]},"before":{"anyOf":[{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["git"]},"commit":{"type":"string","pattern":"^(?:[a-f0-9]{40}|[a-f0-9]{64})$"}},"required":["kind","commit"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["working_tree"]}},"required":["kind"],"additionalProperties":false}]},"after":{"anyOf":[{"type":"object","properties":{"projectId":{"type":"string"},"workspaceId":{"type":"string"},"captureId":{"type":"string"},"workspaceRevision":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"sourceDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"configDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"indexVersion":{"type":"string"}},"required":["projectId","workspaceId","captureId","workspaceRevision","sourceDigest","configDigest","indexVersion"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["git"]},"commit":{"type":"string","pattern":"^(?:[a-f0-9]{40}|[a-f0-9]{64})$"}},"required":["kind","commit"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["working_tree"]}},"required":["kind"],"additionalProperties":false}]}},"required":["action"],"additionalProperties":false}}';
const PYTHON_INDEX_SPEC = '{"name":"python_index","description":"Query readable Python project symbols, definitions, references, imports and static call candidates using Jedi on an isolated source snapshot. Includes source digests, commit and unresolved relations. Workspace pyrightconfig.json, pyproject.toml and setup.cfg import roots and readable .py/.pyi dependencies are parsed as data. Source and config changes invalidate results. Project code never executes; external interpreter environments and complete dynamic call graphs are not covered. In an observation, file-level edges come from a static Python import scan only: runtime-only links are not edges, while the standard library, external packages and git-ignored files are unresolved or absent.","inputSchema":{"type":"object","properties":{"operation":{"type":"string","enum":["symbols","definitions","references","imports","calls"]},"configPath":{"type":"string"},"prefix":{"type":"string"},"path":{"type":"string"},"line":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"column":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"expectedSnapshot":{"type":"string","pattern":"^[a-f0-9]{64}$"},"offset":{"type":"integer","minimum":0,"maximum":9007199254740991},"limit":{"default":100,"type":"integer","minimum":1,"maximum":200}},"required":["operation","limit"],"additionalProperties":false}}';
const READ_SPEC = '{"name":"read","description":"Read a UTF-8 file or list a directory inside the workspace. Path must be workspace-relative (README.md, never /workspace/README.md or a host path). Prefer this tool over shell cat/ls; use line ranges for large files.","inputSchema":{"type":"object","properties":{"path":{"type":"string","description":"Workspace-relative file or directory path, for example README.md; never absolute"},"startLine":{"description":"First line to return, 1-based","type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"endLine":{"description":"Last line to return, inclusive","type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"maxBytes":{"description":"Maximum source bytes to read","type":"integer","exclusiveMinimum":0,"maximum":9007199254740991}},"required":["path"],"additionalProperties":false}}';
const SEARCH_SPEC = '{"name":"search","description":"Search literal text in workspace source without running shell commands. Returns matching lines with file content digests; bounded files/results and explicit skipped coverage. Use paths to narrow a query.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"paths":{"minItems":1,"maxItems":32,"type":"array","items":{"type":"string"}},"prefix":{"type":"string","description":"Workspace-relative directory to search recursively, not a file. Omit or use a single dot for the workspace root. Use paths for individual search files."},"maxResults":{"default":40,"type":"integer","minimum":1,"maximum":100},"maxFiles":{"default":200,"type":"integer","minimum":1,"maximum":500}},"required":["query","maxResults","maxFiles"],"additionalProperties":false}}';
const SOURCE_EXCERPT_SPEC = '{"name":"source_excerpt","description":"Read a bounded source range at an exact content digest from code_index or symbols. Returns stale if content changed; never silently substitutes newer source.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"expectedDigest":{"type":"string","pattern":"^[a-f0-9]{64}$"},"startLine":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},"endLine":{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991}},"required":["path","expectedDigest","startLine","endLine"],"additionalProperties":false}}';
const SYMBOLS_SPEC = '{"name":"symbols","description":"Parse a file into declarations, imports and syntactic call sites using TypeScript/JavaScript AST or Python AST. Does not execute project code or resolve runtime behavior. Unsupported languages explicitly return text fallback.","inputSchema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}}';
const RECORD_NOTE_SPEC = '{"name":"record_note","description":"PC2 note text","inputSchema":{"type":"object","properties":{"op":{"type":"string","enum":["write","review","withdraw"]},"kind":{"type":"string","enum":["convention","pitfall","tradeoff","open_question","preference","decision","understanding","repair"]},"topic":{"type":"string"},"conclusion":{"type":"string"},"anchor":{"anyOf":[{"type":"object","properties":{"kind":{"type":"string","enum":["module"]},"moduleId":{"type":"string"}},"required":["kind","moduleId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["interface"]},"moduleId":{"type":"string"},"interfaceId":{"type":"string"}},"required":["kind","moduleId","interfaceId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["file"]},"path":{"type":"string"},"symbolRequest":{"type":"object","properties":{"language":{"type":"string"},"name":{"type":"string"},"range":{"type":"object","properties":{"startLine":{"type":"integer","minimum":0,"maximum":9007199254740991},"endLine":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["startLine","endLine"],"additionalProperties":false}},"required":["language","name"],"additionalProperties":false},"deleted":{"type":"boolean","enum":[true]}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["goal"]},"goalId":{"type":"string"}},"required":["kind","goalId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["stage"]},"goalId":{"type":"string"},"stageId":{"type":"string"}},"required":["kind","goalId","stageId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["task"]},"goalId":{"type":"string"},"taskId":{"type":"string"}},"required":["kind","goalId","taskId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["project"]}},"required":["kind"],"additionalProperties":false}]},"extraAnchors":{"maxItems":4,"type":"array","items":{"anyOf":[{"type":"object","properties":{"kind":{"type":"string","enum":["module"]},"moduleId":{"type":"string"}},"required":["kind","moduleId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["interface"]},"moduleId":{"type":"string"},"interfaceId":{"type":"string"}},"required":["kind","moduleId","interfaceId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["file"]},"path":{"type":"string"},"symbolRequest":{"type":"object","properties":{"language":{"type":"string"},"name":{"type":"string"},"range":{"type":"object","properties":{"startLine":{"type":"integer","minimum":0,"maximum":9007199254740991},"endLine":{"type":"integer","minimum":0,"maximum":9007199254740991}},"required":["startLine","endLine"],"additionalProperties":false}},"required":["language","name"],"additionalProperties":false},"deleted":{"type":"boolean","enum":[true]}},"required":["kind","path"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["goal"]},"goalId":{"type":"string"}},"required":["kind","goalId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["stage"]},"goalId":{"type":"string"},"stageId":{"type":"string"}},"required":["kind","goalId","stageId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["task"]},"goalId":{"type":"string"},"taskId":{"type":"string"}},"required":["kind","goalId","taskId"],"additionalProperties":false},{"type":"object","properties":{"kind":{"type":"string","enum":["project"]}},"required":["kind"],"additionalProperties":false}]}},"facts":{"type":"array","items":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}},"basisFiles":{"type":"array","items":{"type":"string"}},"replaces":{"type":"array","items":{"type":"string"}},"contradicts":{"type":"array","items":{"type":"string"}},"coexistWith":{"type":"array","items":{"type":"string"}},"structural":{"type":"boolean"},"body":{"type":"string"},"sections":{"type":"object","properties":{"status":{"type":"string"},"decided":{"type":"string"},"open":{"type":"string"},"next":{"type":"string"},"risks":{"type":"string"}},"required":["status","decided","open","next","risks"],"additionalProperties":false},"expectedPointerRevision":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"noteId":{"type":"string"},"expectedVersion":{"type":"integer","minimum":1,"maximum":9007199254740991},"verdict":{"type":"string","enum":["review","accept","reject"]},"resolution":{"type":"string","enum":["supersede","coexist"]},"reason":{"anyOf":[{"type":"string"},{"type":"null"}]}},"required":["op"],"additionalProperties":false}}';

/** The 9 Query tools, in ruling 16 order (no `record_note`). */
const QUERY_TOOL_SPECS = [
  CODE_INDEX_SPEC, CPP_INDEX_SPEC, LIST_FILES_SPEC, PROJECT_SOURCE_SPEC, PYTHON_INDEX_SPEC,
  READ_SPEC, SEARCH_SPEC, SOURCE_EXCERPT_SPEC, SYMBOLS_SPEC,
] as const;
/** The same list plus `record_note`, in the Work's frozen order. */
const WORK_TOOL_SPECS = [
  CODE_INDEX_SPEC, CPP_INDEX_SPEC, LIST_FILES_SPEC, PROJECT_SOURCE_SPEC, PYTHON_INDEX_SPEC,
  READ_SPEC, RECORD_NOTE_SPEC, SEARCH_SPEC, SOURCE_EXCERPT_SPEC, SYMBOLS_SPEC,
] as const;
const QUERY_SPECS_BODY = `[${QUERY_TOOL_SPECS.join(',')}]`;
const WORK_SPECS_BODY = `[${WORK_TOOL_SPECS.join(',')}]`;
/** sha256 of each literal body (hand-computed, checked against the literal below). */
const QUERY_SPECS_DIGEST = 'a0a9123608b7c8f0ea7ae97fbf93c7ccda7d2dc757cac5f077d8e44131a4c84a';
const WORK_SPECS_DIGEST = '5e640edd28883a9b7a1e7d20f0774ecfd7bbcc1982a1ec6c97cdbbba3fd26061';

function toolPack(note: string, list: string, prefix: string) {
  return pc2PackEntry('pc2-joint-tools', {
    tools: {
      record_note: { description: note, parameters: {} },
      list_files: { description: list, parameters: { prefix } },
    },
  });
}

/** The raw `toolSpecsRef` body, whole, and its SHA-256 over those literal bytes. */
function expectWholeSpecs(specs: string, expected: string, digest: string): void {
  expect(specs).toBe(expected);
  expect(sha(specs)).toBe(digest);
}
async function readManifest(
  fixture: { base: { ctx: unknown; platform: { materials: { openArtifact: Function } } } },
  prepared: { envelope: { bundleRef: unknown } },
): Promise<{ input: string; contextAssembly: { sections: { name: string; startByte: number | null; endByte: number | null }[] } }> {
  const opened = await fixture.base.platform.materials.openArtifact(fixture.base.ctx, {
    ref: prepared.envelope.bundleRef, usage: 'historical_explanation',
  });
  if (opened.status !== 'ready') throw new Error(JSON.stringify(opened));
  return JSON.parse(opened.value.body);
}

function sectionText(input: string, section: { startByte: number | null; endByte: number | null }): string {
  if (section.startByte === null || section.endByte === null) throw new Error('the section is absent');
  return Buffer.from(input, 'utf8').subarray(section.startByte, section.endByte).toString('utf8');
}

describe('PC-20 the frozen tool list reaches the prepared request', () => {
  const base = 'A{{#tool:read}}R{{/tool:read}}{{#tool:edit}}E{{/tool:edit}}'
    + '{{#tool:shell}}S{{/tool:shell}}Z';

  it('the whole system prompt and request tool list for read, write and shell', async () => {
    const pack = pc2PackEntry('pc2-joint-writable', { templates: { base } });
    const fixture = await openPCWorkFixture({
      promptPacks: await pc2ResolvedSource([pack]),
      selection: { promptPack: pack.packId },
      writable: true,
      tools: ['read', 'write', 'shell'],
      systemInstruction: null,
      skills: NO_SKILLS,
      model: scriptedModel([{ text: 'PC-20 answer' }]),
    });
    try {
      await fixture.work.prepare();
      const started = await fixture.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      const request = fixture.model.requests[0]!;
      // The pack's base names read, edit and shell; production maps the granted
      // `write` to the Kernel's `edit`, so every block renders.
      expect(request.systemPrompt).toBe('ARESZ');
      expect(request.tools.map(tool => tool.name)).toEqual([
        'code_index', 'cpp_index', 'edit', 'list_files', 'project_source', 'python_index',
        'read', 'search', 'shell', 'source_excerpt', 'symbols',
      ]);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  for (const [name, tools, expected] of [
    ['read only', ['read'], 'ARZ'],
    ['no read tool', ['search'], 'AZ'],
  ] as const) {
    it(`renders the whole system prompt for ${name}`, async () => {
      const pack = pc2PackEntry('pc2-joint-list', { templates: { base } });
      const fixture = await openPCWorkFixture({
        promptPacks: await pc2ResolvedSource([pack]),
        selection: { promptPack: pack.packId },
        tools: [...tools],
        systemInstruction: null,
        skills: NO_SKILLS,
        model: scriptedModel([{ text: 'PC-20 answer' }]),
      });
      try {
        await fixture.work.prepare();
        const started = await fixture.work.start();
        expect(started.status, JSON.stringify(started)).toBe('ready');
        expect(fixture.model.requests[0]!.systemPrompt).toBe(expected);
      } finally {
        await fixture.close();
      }
    }, 60_000);
  }

  it('the frozen list reaches a Skill and the continuation brief through the real run', async () => {
    const pack = pc2PackEntry('pc2-joint-skill', {
      templates: {
        base: 'BASE',
        'work-input': PC2_WORK_INPUT,
        'skill-platform-work': 'S{{#tool:read}}R{{/tool:read}}E',
        'continuation-brief': '{{marker}}B{{#tool:read}}R{{/tool:read}}E',
      },
    });
    for (const [tools, skill, brief] of [
      [['read'], 'SRE', 'BRE'],
      [['search'], 'SE', 'BE'],
    ] as const) {
      const fixture = await openPCWorkFixture({
        promptPacks: await pc2ResolvedSource([pack]),
        selection: { promptPack: pack.packId },
        tools: [...tools],
        systemInstruction: null,
        skills: { resourceRoot: PLATFORM_SKILL_RESOURCE_ROOT, enabledIds: ['platform-work'] },
        model: scriptedModel([
          { beforeReply: async () => { throw new Error('PC-20 first run ended'); } },
          { text: 'PC-20 continuation answer' },
        ]),
      });
      try {
        await fixture.work.prepare();
        await fixture.work.start();
        const continuation = await fixture.continuation();
        const prepared = await continuation.prepare();
        const manifest = await readManifest(fixture, prepared as never);
        const section = manifest.contextAssembly.sections.find(candidate => candidate.name === 'continuation');
        if (section === undefined) throw new Error('PC-20 the continuation input has no continuation section');
        const briefText = sectionText(manifest.input, section);

        const started = await continuation.start();
        expect(started.status, JSON.stringify(started)).toBe('ready');
        const request = fixture.model.requests.at(-1)!;
        // The whole system prompt is the base plus the hand-built Skill section.
        const source = `skill:platform-work@sha256:${sha(skill)}`;
        expect(request.systemPrompt).toBe(
          `BASE\n\n[skill_instruction id="platform-work" source="${source}"]\n${skill}`);

        // The marker's only dynamic part is the digest the public read returns;
        // the brief body itself is the hand-written literal.
        const saved = await fixture.base.platform.runtime.readContinuationBrief!(
          fixture.base.ctx, { runRef: continuation.runRef });
        expect(saved.status, JSON.stringify(saved)).toBe('ready');
        if (saved.status !== 'ready' || saved.value === null) {
          throw new Error(JSON.stringify(saved));
        }
        const expectedBrief =
          `[continuation-brief v1 sha256:${saved.value.digest}]${brief}`;
        expect(briefText).toBe(expectedBrief);

        const current = request.messages.at(-1);
        if (current === undefined || !('content' in current)) {
          throw new Error('PC-20 the request has no current input');
        }
        expect(sectionText(current.content, section)).toBe(expectedBrief);
      } finally {
        await fixture.close();
      }
    }
  }, 60_000);
});

describe('PC-26 the prepared tool texts reach the request and the record', () => {
  it('a Work run sends record_note and list_files with the changed texts and the hand-computed digest', async () => {
    const pack = toolPack('PC2 note text', 'PC2 list text', 'PC2 prefix text');
    const source = await pc2ResolvedSource([pack]);
    const fixture = await openPCWorkFixture({
      promptPacks: source,
      selection: { promptPack: pack.packId },
      tools: ['read', 'record_note', 'list_files'],
      systemInstruction: null,
      skills: NO_SKILLS,
      model: scriptedModel([{ text: 'PC-26 work answer' }]),
    });
    try {
      await fixture.work.prepare();
      const started = await fixture.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      const request = fixture.model.requests[0]!;
      expect(request.tools.find(tool => tool.name === 'record_note')?.description).toBe('PC2 note text');
      expect(request.tools.find(tool => tool.name === 'list_files')?.description).toBe('PC2 list text');
      expect(request.tools.find(tool => tool.name === 'list_files')?.inputSchema)
        .toMatchObject({ properties: { prefix: { description: 'PC2 prefix text' } } });

      const record = await fixture.work.readPromptRecord();
      expect(record.status).toBe('ready');
      if (record.status !== 'ready') throw new Error('PC-26 readPromptRecord failed');
      // The frozen set carries the hand-computed digests of the literal canonical bodies.
      expect(record.value.set.tools.map(entry => entry.name)).toContain('record_note');
      expect(record.value.set.tools.map(entry => entry.name)).toContain('list_files');
      expect(record.value.set.tools.find(entry => entry.name === 'record_note')).toMatchObject({
        packId: pack.packId, digest: sha(NOTE_BODY),
      });
      expect(record.value.set.tools.find(entry => entry.name === 'list_files')).toMatchObject({
        packId: pack.packId, digest: sha(LIST_BODY),
      });
      expect(record.value.texts[sha(NOTE_BODY)]).toBe(NOTE_BODY);
      expect(record.value.texts[sha(LIST_BODY)]).toBe(LIST_BODY);
      const recordRequest = record.value.requests[0]!;
      expect(recordRequest.toolsDigest).toBe(WORK_SPECS_DIGEST);
      expect(recordRequest.toolSpecsRef.digest).toBe(WORK_SPECS_DIGEST);
      const specs = record.value.texts[recordRequest.toolSpecsRef.digest];
      if (specs === undefined) throw new Error('PC-26 the tool-spec body is missing');
      expect(record.value.texts[WORK_SPECS_DIGEST]).toBe(WORK_SPECS_BODY);
      expectWholeSpecs(specs, WORK_SPECS_BODY, WORK_SPECS_DIGEST);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('a Query run uses list_files with the changed texts and adds no new permission', async () => {
    const pack = toolPack('PC2 note text', 'PC2 list text', 'PC2 prefix text');
    const source = await pc2ResolvedSource([pack]);
    const fixture = await openPCQueryFixture({
      promptPacks: source,
      selection: { promptPack: pack.packId },
      tools: ['read', 'list_files'],
      systemInstruction: null,
      skills: NO_SKILLS,
      model: scriptedModel([{ text: 'PC-26 query answer' }]),
    });
    try {
      const prepared = await fixture.prepare();
      const opened = await fixture.base.platform.materials.openArtifact(rlQueryHostCtx(), {
        ref: prepared.bundleRef, usage: 'historical_explanation',
      });
      if (opened.status !== 'ready') throw new Error(JSON.stringify(opened));
      const manifest = JSON.parse(opened.value.body) as {
        permissions: { tools: string[] }; promptSet: { toolNames: string[]; tools: { name: string; digest: string }[] };
      };
      // The grant is the selected permission set; the frozen final list adds the
      // exploration tools around it and never the unselected `record_note`.
      expect(manifest.permissions.tools).toEqual(['read', 'list_files']);
      expect(manifest.promptSet.toolNames).toContain('list_files');
      expect(manifest.promptSet.toolNames).not.toContain('record_note');
      expect(manifest.promptSet.tools.find(entry => entry.name === 'list_files')?.digest).toBe(sha(LIST_BODY));

      // A pack changed AFTER preparation must not reach this start.
      source.replace({
        ...source.snapshot(),
        tools: {
          ...source.snapshot().tools,
          list_files: { description: 'PC2 LATER list', parameters: { prefix: 'PC2 LATER prefix' } },
        },
      });
      const started = await fixture.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      const request = fixture.model.requests[0]!;
      expect(request.tools.find(tool => tool.name === 'list_files')?.description).toBe('PC2 list text');
      expect(request.tools.find(tool => tool.name === 'list_files')?.inputSchema)
        .toMatchObject({ properties: { prefix: { description: 'PC2 prefix text' } } });

      const record = await fixture.readPromptRecord();
      expect(record.status).toBe('ready');
      if (record.status !== 'ready') throw new Error('PC-26 Query readPromptRecord failed');
      const listEntry = record.value.set.tools.find(entry => entry.name === 'list_files');
      expect(listEntry).toMatchObject({ packId: pack.packId, digest: sha(LIST_BODY) });
      expect(record.value.texts[sha(LIST_BODY)]).toBe(LIST_BODY);
      const recordRequest = record.value.requests[0]!;
      expect(recordRequest.toolsDigest).toBe(QUERY_SPECS_DIGEST);
      expect(recordRequest.toolSpecsRef.digest).toBe(QUERY_SPECS_DIGEST);
      const specs = record.value.texts[recordRequest.toolSpecsRef.digest];
      if (specs === undefined) throw new Error('PC-26 the Query tool-spec body is missing');
      expect(record.value.texts[QUERY_SPECS_DIGEST]).toBe(QUERY_SPECS_BODY);
      expectWholeSpecs(specs, QUERY_SPECS_BODY, QUERY_SPECS_DIGEST);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('a Work resume after pause still sends the prepared texts', async () => {
    const gate = replyGate();
    const pack = toolPack('PC2 note text', 'PC2 list text', 'PC2 prefix text');
    const source = await pc2ResolvedSource([pack]);
    const fixture = await openPCWorkFixture({
      promptPacks: source,
      selection: { promptPack: pack.packId },
      tools: ['read', 'record_note', 'list_files'],
      systemInstruction: null,
      skills: NO_SKILLS,
      model: scriptedModel([
        { toolCalls: [{ callId: 'pc26-read', name: 'read', arguments: { path: 'wp2-read.txt' } }],
          beforeReply: gate.beforeReply },
        { text: 'PC-26 resumed answer' },
      ]),
    });
    try {
      await gitBaseline(fixture.base.fixture.directory);
      await fixture.work.prepare();
      const running = fixture.work.start();
      await gate.reached;
      // The start already sends both prepared pack texts.
      expect(fixture.model.requests[0]!.tools.find(tool => tool.name === 'record_note')?.description)
        .toBe('PC2 note text');
      expect(fixture.model.requests[0]!.tools.find(tool => tool.name === 'list_files')?.description)
        .toBe('PC2 list text');
      await fixture.work.pause();
      const paused = await fixture.work.observe();
      expect(paused.status, JSON.stringify(paused)).toBe('ready');
      if (paused.status === 'ready') {
        expect(paused.value.run.controlState?.desiredState).toBe('paused');
      }
      gate.release();
      expect((await running).status).toBe('ready');
      expect(fixture.model.calls()).toBe(1);

      // The pack changes after the pause; the resume still sends the prepared texts.
      source.replace({
        ...source.snapshot(),
        tools: {
          ...source.snapshot().tools,
          record_note: { description: 'PC2 LATER note', parameters: {} },
          list_files: { description: 'PC2 LATER list', parameters: { prefix: 'PC2 LATER prefix' } },
        },
      });
      const resumed = await fixture.work.resume();
      expect(resumed.status, JSON.stringify(resumed)).toBe('ready');
      await expect.poll(() => fixture.model.calls(), { timeout: 60_000 }).toBe(2);
      expect(fixture.model.requests).toHaveLength(2);
      const resumedRequest = fixture.model.requests[1]!;
      expect(resumedRequest.tools.find(tool => tool.name === 'record_note')?.description)
        .toBe('PC2 note text');
      expect(resumedRequest.tools.find(tool => tool.name === 'list_files')?.description)
        .toBe('PC2 list text');
      expect(resumedRequest.tools.find(tool => tool.name === 'list_files')?.inputSchema)
        .toMatchObject({ properties: { prefix: { description: 'PC2 prefix text' } } });
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('a body-store failure on only the tool-text content type is the preparation\'s unavailable', async () => {
    const pack = toolPack('PC2 note text', 'PC2 list text', 'PC2 prefix text');
    const fixture = await openPCWorkFixture({
      promptPacks: await pc2ResolvedSource([pack]),
      selection: { promptPack: pack.packId },
      failPutContentType: PROMPT_TOOL_TEXT_CONTENT_TYPE,
      tools: ['read', 'record_note', 'list_files'],
      systemInstruction: null,
      skills: NO_SKILLS,
      model: scriptedModel([{ text: 'PC-26 failure answer' }]),
    });
    try {
      const prepared = await fixture.runtime.prepareExecution(fixture.base.ctx, {
        runRef: fixture.work.runRef, requestId: 'pc26-store-failure',
      });
      expect(prepared).toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
