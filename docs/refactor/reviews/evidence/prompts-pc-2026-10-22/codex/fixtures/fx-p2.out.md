No files were changed and no checks were run. These files target the frozen PC-1b and PC-2 seams.

`tests/helpers/PC2-pack-fixture.ts`

```ts
/**
 * PC-2 fixture draft for lead review.
 *
 * Inputs and observations only; expected texts, ranges and digests belong in
 * the test rows. Construct platform fixtures serially, as PC-platform requires.
 * K3 callers install the existing K3 shellSeam mock before opening this fixture.
 */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { vi } from 'vitest';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type {
  PreparedQueryExecution, PreparedQueryManifestV1, PreparedTaskManifestV1,
} from '../../src/contracts/core/prepared-execution.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import {
  createPlatformPromptPackSource,
  type PromptPackChainEntryV1, type PromptPackManifestV1, type PromptPackSourcePort,
} from '../../src/contracts/prompts/prompt-pack.js';
import { resolvePromptPackV1 } from '../../src/contracts/prompts/resolve-pack.js';
import { readManifestFromEnvelope } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import {
  mutablePromptPacks, openPCK3ReviewFixture, openPCWorkFixture, scriptedModel,
  type PCOptions,
} from './PC-platform-fixture.js';

export const PC2_WORK_INPUT =
  '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{inputs}}'
  + '{{continuation}}{{unknown_call_review}}{{reminders}}';

export const PC2_OTHER_WORK_INPUT =
  '{{prelude}}\n\n{{role}}{{goal}}{{continuation}}{{task}}{{footprint}}{{notes}}'
  + '{{inputs}}{{unknown_call_review}}{{reminders}}';

export type PC2PackSpec = {
  parent?: string | null;
  templates?: Readonly<Record<string, string | {
    text: string; version?: number; mentionsTools?: readonly string[];
  }>>;
  strings?: Readonly<Record<string, unknown>>;
  tools?: Readonly<Record<string, unknown>>;
};

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  return result.value;
}
function committed<T>(result: WriteResult<T>): T {
  if (result.status !== 'committed') throw new Error(JSON.stringify(result));
  return result.value;
}
function editManifest(entry: PromptPackChainEntryV1, edit: (m: PromptPackManifestV1) => void): void {
  const manifest = JSON.parse(entry.manifest.text) as PromptPackManifestV1;
  edit(manifest);
  entry.manifest.text = JSON.stringify(manifest);
}

/** Plain input data, with no production renderer or resolver involved. */
export function pc2PackEntry(packId: string, spec: PC2PackSpec = {}): PromptPackChainEntryV1 {
  const templates: Record<string, { file: string; text: string }> = {};
  const tools: Record<string, { file: string; text: string }> = {};
  const manifest: PromptPackManifestV1 = {
    schemaVersion: 1, packId,
    extends: spec.parent === undefined ? (packId === 'platform' ? null : 'platform') : spec.parent,
    templates: {}, strings: 'strings.json', tools: {},
  };
  for (const [id, value] of Object.entries(spec.templates ?? {})) {
    const template = typeof value === 'string' ? { text: value } : value;
    const file = `templates/${id}.txt`;
    manifest.templates[id] = {
      file, version: template.version ?? 1, mentionsTools: [...(template.mentionsTools ?? [])],
    };
    templates[id] = { file, text: template.text };
  }
  for (const [name, entry] of Object.entries(spec.tools ?? {})) {
    const file = `tools/${name}.json`;
    manifest.tools[name] = file;
    tools[name] = { file, text: JSON.stringify(entry) };
  }
  return {
    packId, manifest: { file: 'pack.json', text: JSON.stringify(manifest) },
    strings: { file: 'strings.json', text: JSON.stringify(spec.strings ?? {}) },
    templates, tools,
  };
}

/** Fresh, hand-written chains. The first entry is the requested pack. */
export function pc2PackCases() {
  const platform = pc2PackEntry('platform', {
    templates: {
      base: 'BASE\n{{#tool:edit}}\nEDIT\n{{/tool:edit}}\nEND\n',
      'work-input': PC2_WORK_INPUT,
      'query-planning-input': '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}',
      'query-copy-input': '{{prelude}}\n\n{{role}}{{goal}}{{task}}',
      'initial-planning-answer': 'ANSWER',
      'continuation-brief': '{{marker}}{{body}}{{bodyOmission}}{{anomalies}}{{review}}{{blocked}}{{blockedOmission}}',
      'unknown-call-review': '{{workspaceLines}}\n{{writtenLines}}{{items}}',
      'unknown-call-proposal':
        '{{workspaceLines}}\n{{writtenLines}}{{targets}}{{personNote}}{{annotations}}{{platformTargets}}',
      'consultation-received-input': '{{messageId}}\n{{sourceJson}}',
      'user-decision-response': '{{bodyJson}}',
      'scribe-reminder': '{{marker}}\n{{pendingCount}}\n{{updateDueCount}}{{anchors}}',
      'stale-files-reminder': 'STALE',
      'skill-platform-work': 'WORK',
      'skill-platform-secretary': 'SECRETARY',
      'skill-platform-adviser': 'ADVISER',
      'skill-platform-scribe': 'SCRIBE',
      'skill-platform-reviewer': 'REVIEWER',
    },
    strings: {
      'context.role.label': 'ROLE', 'k3.none': 'NONE',
      'context.omissions.heading': 'OMITTED',
      'context.omissions.prefix': 'PREFIX',
      'context.omissions.suffix': 'SUFFIX',
      'context.omissions.nameSeparator': ':',
    },
    tools: {
      record_note: { description: 'Platform note.', parameters: {} },
      list_files: { description: 'Platform list.', parameters: { prefix: 'Platform prefix.' } },
    },
  });
  const parent = pc2PackEntry('pc2-parent', {
    templates: { base: { text: 'PARENT', version: 7 } },
    strings: { 'context.role.label': 'PARENT ROLE' },
  });
  const child = pc2PackEntry('pc2-child', {
    parent: parent.packId, templates: { base: { text: 'CHILD', version: 8 } },
  });
  const toolChild = pc2PackEntry('pc2-tool-child', {
    tools: { record_note: { description: 'Child note.', parameters: {} } },
  });
  const legalOrder = pc2PackEntry('pc2-order', {
    templates: { 'work-input': { text: PC2_OTHER_WORK_INPUT, version: 7 } },
  });
  const dotName = pc2PackEntry('pc2-dot-name', { templates: { base: 'DOT NAME' } });
  editManifest(dotName, m => { m.templates.base!.file = 'templates/..name.txt'; });
  dotName.templates.base!.file = 'templates/..name.txt';

  const broken: Record<string, PromptPackChainEntryV1[]> = {};
  const add = (name: string, spec: PC2PackSpec = {},
    edit?: (entry: PromptPackChainEntryV1) => void): void => {
    const entry = pc2PackEntry(`bad-${name}`, spec);
    edit?.(entry);
    broken[name] = [entry, structuredClone(platform)];
  };
  const manifestCase = (name: string, edit: (m: PromptPackManifestV1) => void): void =>
    add(name, {}, e => editManifest(e, edit));
  manifestCase('schema-version', m => { Object.assign(m, { schemaVersion: 2 }); });
  manifestCase('identity', m => { m.packId = 'different-id'; });
  manifestCase('id-syntax', m => { m.packId = 'BAD_ID'; });
  manifestCase('null-parent', m => { m.extends = null; });
  manifestCase('missing-parent', m => { m.extends = 'absent-parent'; });
  add('manifest-json', {}, e => { e.manifest.text = '{'; });
  add('manifest-object', {}, e => { e.manifest.text = '[]'; });
  add('strings-json', {}, e => { e.strings.text = '{'; });
  add('strings-object', {}, e => { e.strings.text = '[]'; });
  add('string-value', { strings: { 'context.role.label': 3 } });
  add('unknown-string', { strings: { 'pc2.unknown': 'UNKNOWN' } });
  for (const key of ['heading', 'prefix', 'suffix', 'nameSeparator']) {
    add(`fixed-${key.toLowerCase()}`, { strings: { [`context.omissions.${key}`]: 'CHANGED' } });
  }
  add('unknown-template', { templates: { 'pc2-unknown': 'UNKNOWN' } });
  for (const version of [0, -1, 1.5]) {
    add(`version-${String(version).replace('.', '-').replace('-', 'minus')}`, {
      templates: { base: { text: 'BASE', version } },
    });
  }
  add('mentions-array', { templates: { base: 'BASE' } }, e =>
    editManifest(e, m => { Object.assign(m.templates.base!, { mentionsTools: 'read' }); }));
  add('mentions-value', { templates: { base: 'BASE' } }, e =>
    editManifest(e, m => { Object.assign(m.templates.base!, { mentionsTools: ['read', 2] }); }));
  add('template-file-missing', { templates: { base: 'BASE' } }, e => { e.templates = {}; });
  add('template-file-parent', { templates: { base: 'BASE' } }, e =>
    editManifest(e, m => { m.templates.base!.file = '../outside.txt'; }));
  add('template-file-absolute', { templates: { base: 'BASE' } }, e =>
    editManifest(e, m => { m.templates.base!.file = '/outside.txt'; }));
  add('unknown-slot', { templates: { base: '{{pc2_unknown}}' } });
  add('duplicate-slot', { templates: { 'continuation-brief': '{{marker}}{{marker}}' } });
  add('required-slot-missing', { templates: { 'continuation-brief': 'NO MARKER' } });
  add('stray-open', { templates: { base: 'BASE {{' } });
  add('unclosed-block', { templates: { base: '{{#tool:edit}}EDIT' } });
  add('mismatched-block', { templates: { base: '{{#tool:edit}}EDIT{{/tool:read}}' } });
  add('section-nested', {
    templates: { 'work-input': PC2_WORK_INPUT.replace('{{role}}', '{{#tool:read}}{{role}}{{/tool:read}}') },
  });
  add('section-missing', { templates: { 'work-input': PC2_WORK_INPUT.replace('{{notes}}', '') } });
  add('section-extra', {
    templates: { 'query-copy-input': '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}' },
  });
  add('role-not-first', {
    templates: { 'work-input': PC2_WORK_INPUT.replace('{{role}}{{goal}}', '{{goal}}{{role}}') },
  });
  add('section-twice', { templates: { 'work-input': PC2_WORK_INPUT + '{{reminders}}' } });
  for (const name of ['shell', 'read', 'pc2_unknown_tool']) {
    add(`tool-${name.replaceAll('_', '-')}`, { tools: { [name]: { description: 'TEXT', parameters: {} } } });
  }
  add('tool-empty', { tools: { record_note: { description: '', parameters: {} } } });
  add('tool-parameters-object', { tools: { list_files: { description: 'List.', parameters: [] } } });
  add('tool-parameter-value', { tools: { list_files: { description: 'List.', parameters: { prefix: 3 } } } });
  add('tool-prefix-missing', { tools: { list_files: { description: 'List.', parameters: {} } } });
  add('tool-prefix-extra', {
    tools: { list_files: { description: 'List.', parameters: { prefix: 'Prefix.', 'prefix.extra': 'Extra.' } } },
  });
  add('tool-json', { tools: { record_note: {} } }, e => { e.tools.record_note!.text = '{'; });
  add('tool-file-missing', { tools: { record_note: {} } }, e => { e.tools = {}; });
  add('strings-file-missing', {}, e => editManifest(e, m => { m.strings = 'absent.json'; }));
  const badPlatform = structuredClone(platform);
  editManifest(badPlatform, m => { m.extends = 'pc2-parent'; });
  broken['platform-parent'] = [badPlatform];
  broken['duplicate-id'] = structuredClone([child, parent, parent, platform]);
  broken['no-platform'] = structuredClone([child, parent]);
  broken.cycle = [
    pc2PackEntry('cycle-a', { parent: 'cycle-b' }),
    pc2PackEntry('cycle-b', { parent: 'cycle-a' }),
    structuredClone(platform),
  ];
  return {
    platform, parent, child, toolChild, legalOrder, dotName, broken,
    parentChain: structuredClone([parent, platform]),
    childChain: structuredClone([child, parent, platform]),
    toolChain: structuredClone([toolChild, platform]),
    orderChain: structuredClone([legalOrder, platform]),
  };
}

function inside(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}
function fileTarget(root: string, file: string): string {
  if (isAbsolute(file) || /^[a-z]:/i.test(file) || file.startsWith('\\')
    || file.split(/[\\/]/).includes('..')) throw new Error(`Unsafe fixture file: ${file}`);
  const target = resolve(root, file);
  if (!inside(root, target)) throw new Error(`Fixture file leaves its pack: ${file}`);
  return target;
}

/**
 * Writes the supplied user-pack files verbatim; malformed manifest references
 * remain malformed. Use a fresh root for missing-file cases. The generated
 * platform is virtual; duplicate IDs describe one directory, not two.
 */
export async function writePC2Packs(
  promptsRoot: string, entries: readonly PromptPackChainEntryV1[],
): Promise<Record<string, string>> {
  const directories: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.packId === 'platform' || directories[entry.packId] !== undefined) continue;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.packId)) throw new Error('Unsafe fixture pack id');
    const directory = join(promptsRoot, entry.packId);
    directories[entry.packId] = directory;
    for (const file of [entry.manifest, entry.strings, ...Object.values(entry.templates), ...Object.values(entry.tools)]) {
      const target = fileTarget(directory, file.file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.text, 'utf8');
    }
  }
  return directories;
}

export type PC2PackSnapshot = Readonly<Record<string,
  { kind: 'file'; bytes: Buffer } | { kind: 'directory' } | { kind: 'link'; target: string }>>;

/** Includes old versions, unreferenced files and empty directories; never follows links. */
export async function snapshotPC2Pack(directory: string): Promise<PC2PackSnapshot> {
  const result: Record<string, PC2PackSnapshot[string]> = {};
  const visit = async (path: string, key: string): Promise<void> => {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) result[key] = { kind: 'link', target: await readlink(path) };
    else if (stat.isDirectory()) {
      result[key] = { kind: 'directory' };
      for (const name of (await readdir(path)).sort()) {
        await visit(join(path, name), key === '.' ? name : `${key}/${name}`);
      }
    } else if (stat.isFile()) result[key] = { kind: 'file', bytes: await readFile(path) };
    else throw new Error(`Unsupported fixture directory entry: ${path}`);
  };
  try { await visit(directory, '.'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Object.keys(result).length !== 0) throw error;
  }
  return result;
}

export function comparePC2Snapshots(before: PC2PackSnapshot, after: PC2PackSnapshot) {
  const added = Object.keys(after).filter(key => before[key] === undefined).sort();
  const removed = Object.keys(before).filter(key => after[key] === undefined).sort();
  const changed = Object.keys(before).filter(key => {
    const left = before[key]!, right = after[key];
    if (right === undefined) return false;
    if (left.kind !== right.kind) return true;
    if (left.kind === 'file' && right.kind === 'file') return !left.bytes.equals(right.bytes);
    return left.kind === 'link' && right.kind === 'link' && left.target !== right.target;
  }).sort();
  return { equal: added.length + removed.length + changed.length === 0, added, removed, changed };
}

export async function snapshotPC2Step<T>(directory: string, step: () => Promise<T>) {
  const before = await snapshotPC2Pack(directory);
  let outcome: { status: 'returned'; value: T } | { status: 'threw'; error: unknown };
  try { outcome = { status: 'returned', value: await step() }; }
  catch (error) { outcome = { status: 'threw', error }; }
  const after = await snapshotPC2Pack(directory);
  return { before, after, difference: comparePC2Snapshots(before, after), outcome };
}

/** Runtime inputs use the actual generated parent, never the small pure-test parent. */
export async function pc2ResolvedSource(entries: readonly PromptPackChainEntryV1[]) {
  const platform = ready(await createPlatformPromptPackSource().resolve('platform', new AbortController().signal));
  const parent: PromptPackChainEntryV1 = {
    packId: 'platform',
    manifest: { file: 'pack.json', text: JSON.stringify(platform.manifest) },
    strings: { file: platform.manifest.strings, text: JSON.stringify(platform.strings) },
    templates: Object.fromEntries(Object.entries(platform.manifest.templates).map(([id, entry]) =>
      [id, { file: entry.file, text: platform.templates[id]! }])),
    tools: Object.fromEntries(Object.entries(platform.manifest.tools).map(([name, file]) =>
      [name, { file, text: JSON.stringify(platform.tools[name]) }])),
  };
  const resolved = resolvePromptPackV1([...entries.filter(entry => entry.packId !== 'platform'), parent]);
  if (resolved.status !== 'ready') throw new Error(JSON.stringify(resolved.problems));
  return mutablePromptPacks(resolved.value);
}

/** H's disk-source constructor name is deliberately supplied by its owner. */
export type PC2DiskSourceFactory =
  (promptsRoot: string) => PromptPackSourcePort | Promise<PromptPackSourcePort>;

export async function pc2DiskOptions(
  promptsRoot: string, source: PC2DiskSourceFactory, options: PCOptions = {},
): Promise<PCOptions> {
  return { ...options, promptPacks: await source(promptsRoot) };
}

/**
 * Both modes start with PC's real pending-review chain.
 * "shrink": expanded command text exceeds 64 KiB; unexpanding removes it.
 * "empty": no review-written verdict exists, so k3.none becomes writtenLines.
 */
export async function openPC2ReviewFixture(
  mode: 'shrink' | 'empty', options: PCOptions = {},
) {
  const pack = pc2PackEntry(`pc2-review-${mode}`, {
    templates: { 'work-input': { text: PC2_WORK_INPUT, version: 7 } },
    strings: {
      'context.work.notesNotConnected': 'PC2_AFTER_REVIEW',
      'context.work.anomaliesNotConnected': 'PC2_ANOMALY',
      ...(mode === 'shrink' ? { 'k3.review.commandLead': 'Q'.repeat(65_536) } : { 'k3.none': '' }),
    },
  });
  const source = await pc2ResolvedSource([pack]);
  const fixture = await openPCK3ReviewFixture({
    ...options, promptPacks: source,
    selection: { ...options.selection, promptPack: pack.packId },
  });
  try {
    const preparation = await fixture.runtime.prepareExecution(fixture.world.fixture.ctx, {
      runRef: fixture.claim.runRef, requestId: `pc2-${mode}-prepare`,
    });
    let manifest: PreparedTaskManifestV1 | null = null;
    if (preparation.status === 'ready') {
      const read = await readManifestFromEnvelope(
        { bodies: fixture.world.fixture.bodies }, { ...preparation.value.envelope }, fixture.claim.runRef,
      );
      if (!read.ok) throw new Error(JSON.stringify(read.rejection));
      manifest = read.value.manifest;
    }
    return {
      fixture, pack, source, preparation, manifest,
      start() {
        if (preparation.status !== 'ready') throw new Error('Review preparation was not ready');
        return fixture.runtime.startRun(fixture.world.fixture.ctx, {
          prepared: structuredClone(preparation.value),
          consumerId: `pc2-${mode}`, requestId: `pc2-${mode}-start`,
        });
      },
      close: () => fixture.close(),
    };
  } catch (error) { await fixture.close(); throw error; }
}

/** Completed Work -> real inquiry derivation; also a standalone Query on the source Session. */
export async function openPC2QueryHistoryFixture(options: PCOptions = {}) {
  const fixture = await openPCWorkFixture({
    ...options,
    model: options.model ?? scriptedModel([
      { text: 'PC2 completed history.' }, { text: 'PC2 derived answer.' }, { text: 'PC2 reused answer.' },
    ]),
  });
  try {
    const { base, runtime } = fixture;
    const platform = base.platform;
    await fixture.work.prepare();
    ready(await fixture.work.start());
    if (!runtime.readCompletedBoundary || !runtime.startQuery || !runtime.prepareQuery) {
      throw new Error('The Runtime has no public Query/history port');
    }
    const boundary = ready(await runtime.readCompletedBoundary(base.ctx, { sessionRef: base.sessionRef }));
    if (boundary.cursor === null || boundary.position < 1) throw new Error('Work produced no completed history');
    const message = committed(await platform.messages.sendMessage(base.ctx, {
      input: {
        recipient: base.sessionRef, text: 'PC2 inquiry.', intent: 'inquiry',
        needsReply: true, waitAfterSend: false,
      },
      meta: { requestId: 'pc2-history-inquiry', expected: [] },
    }));
    const runtimeBudget = {
      contextWindowTokens: 200_000, inputTokens: null, outputTokens: null,
      maxRequests: 8, maxToolCalls: 8, timeoutMs: 30_000, perResponseTokens: 512,
    };
    const actualStart = runtime.startQuery.bind(runtime);
    type StartArgs = Parameters<typeof actualStart>;
    const captured: StartArgs[] = [];
    // Workflow uses this raw public Runtime port, not the composition wrapper.
    const spy = vi.spyOn(runtime, 'startQuery').mockImplementation(async (ctx, request) => {
      captured.push([ctx, structuredClone(request)]);
      return { status: 'rejected', code: 'busy', reason: 'PC2 captured before Query start' };
    });
    let consultation: Awaited<ReturnType<typeof platform.workflow.consumeConsultation>>;
    try {
      consultation = await platform.workflow.consumeConsultation(base.ctx, {
        schemaVersion: 1, messageRef: message.ref, goalRef: base.goalRef,
        roleBinding: base.roleBinding, runtimeBudget,
        budget: { maxTokens: 200_000, deadline: null }, consumerId: 'pc2-history-derived',
      });
    } finally { spy.mockRestore(); }
    const derivedArgs = captured[0];
    if (!derivedArgs || captured.length !== 1) {
      throw new Error(`No unique derived Query start: ${JSON.stringify(consultation)}`);
    }
    const queryJobRef: QueryJobRef = {
      aggregateType: 'QueryJob', ...base.scope, queryJobId: 'pc2-history-job',
    };
    const queryRunRef: QueryRunRef = {
      aggregateType: 'QueryRun', ...base.scope, queryJobId: queryJobRef.queryJobId, runId: 'pc2-history-run',
    };
    const goal = ready(await platform.plans.queryGoal(base.ctx, base.goalRef));
    const workspace = ready(await platform.projects.readWorkspaceRegistration(base.ctx, base.scope));
    const session = ready(await platform.sessions.readSession(base.ctx, base.sessionRef));
    const intent: QueryJobIntentV1 = {
      schemaVersion: 1, intentId: queryJobRef.queryJobId, ...base.scope,
      goalId: base.goalRef.goalId, question: 'PC2 ordinary Query.', focusTaskRefs: [],
      budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 },
      correlationId: 'pc2-history',
      execution: { kind: 'semantic_query', roleBinding: base.roleBinding, runtimeBudget },
    };
    committed(await platform.queries.submitQueryJob(base.ctx, {
      input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
      meta: { requestId: 'pc2-history-submit', expected: [
        { ref: base.fixture.projectRef, revision: 1 },
        { ref: base.fixture.workspaceRef, revision: workspace.workspace.revision },
        { ref: base.goalRef, revision: goal.goal.revision },
        { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
      ] },
    }));
    committed(await platform.queries.claimQuery(base.ctx, {
      input: { queryRunRef, sessionRef: base.sessionRef },
      meta: { requestId: 'pc2-history-claim', expected: [
        { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
        { ref: session.record.ref, revision: session.record.revision },
      ] },
    }));
    const reused = ready(await runtime.prepareQuery(base.ctx, {
      queryRunRef, requestId: 'pc2-history-prepare',
    }));
    const handle = async (args: StartArgs) => {
      const prepared: PreparedQueryExecution = structuredClone(args[1].prepared);
      const body = ready(await platform.materials.openArtifact(base.ctx, {
        ref: prepared.bundleRef, usage: 'historical_explanation',
      }));
      const manifest = JSON.parse(body.body) as PreparedQueryManifestV1;
      return { prepared, manifest, start: () => actualStart(args[0], structuredClone(args[1])) };
    };
    return {
      fixture, boundary, consultation,
      message: ready(await platform.messages.readMessage(base.ctx, message.ref)),
      derived: await handle(derivedArgs),
      reused: await handle([base.ctx, {
        prepared: reused, consumerId: 'pc2-history-reused', requestId: 'pc2-history-start',
      }]),
      close: () => fixture.close(),
    };
  } catch (error) { await fixture.close(); throw error; }
}

export type PC2EntryCase = 'wrong-range' | 'duplicate' | 'non-tail' | 'changed-character';

/** A real continuation, with its brief before the task and valid frozen digests. */
export async function openPC2EntryFixture(options: PCOptions = {}) {
  const pack = pc2PackEntry('pc2-entry', {
    templates: { 'work-input': { text: PC2_OTHER_WORK_INPUT, version: 7 } },
  });
  const source = await pc2ResolvedSource([pack]);
  const fixture = await openPCWorkFixture({
    ...options, promptPacks: source,
    selection: { ...options.selection, promptPack: pack.packId },
    model: options.model ?? scriptedModel([{ text: 'PC2 first turn.' }, { text: 'PC2 continuation.' }]),
  });
  try {
    await fixture.work.prepare();
    ready(await fixture.work.start());
    const continuation = await fixture.continuation();
    const prepared = await continuation.prepare();
    const opened = ready(await fixture.base.platform.materials.openArtifact(fixture.base.ctx, {
      ref: prepared.envelope.bundleRef, usage: 'historical_explanation',
    }));
    const original = JSON.parse(opened.body) as PreparedTaskManifestV1;
    const originalRange = original.contextAssembly.sections.find(section => section.name === 'continuation');
    if (originalRange?.startByte == null || originalRange.endByte == null
      || originalRange.endByte >= Buffer.byteLength(original.input)) {
      throw new Error('The prepared continuation is not a non-tail section');
    }
    let entered = false;
    return {
      fixture, source, continuation, prepared, manifest: original,
      async enter(kind: PC2EntryCase) {
        if (entered) throw new Error('Use a fresh entry fixture for each case');
        entered = true;
        const candidate = structuredClone(prepared);
        const manifest = structuredClone(original);
        const assembly = manifest.contextAssembly;
        const section = assembly.sections.find(row => row.name === 'continuation')!;
        const start = section.startByte!, end = section.endByte!;
        const bytes = Buffer.from(manifest.input);
        const rendered = bytes.subarray(start, end).toString('utf8');
        if (kind === 'wrong-range') {
          section.startByte = start + 1;
          section.endByte = end + 1;
        } else if (kind === 'duplicate') {
          const goal = assembly.sections.find(row => row.name === 'goal');
          if (goal?.endByte == null || goal.endByte >= start) throw new Error('No preceding goal section');
          const at = goal.endByte;
          const extra = Buffer.from(`\n${rendered}`);
          manifest.input = Buffer.concat([bytes.subarray(0, at), extra, bytes.subarray(at)]).toString('utf8');
          goal.endByte += extra.length;
          for (const row of assembly.sections) {
            if (row === goal || row.startByte === null || row.endByte === null) continue;
            if (row.startByte >= at) { row.startByte += extra.length; row.endByte += extra.length; }
          }
        } else if (kind === 'changed-character') {
          let at = start;
          while (at < end && !(bytes[at]! >= 33 && bytes[at]! <= 126)) at += 1;
          if (at === end) throw new Error('No ASCII character in the continuation');
          bytes[at] = bytes[at] === 88 ? 89 : 88;
          manifest.input = bytes.toString('utf8');
        }
        if (kind !== 'non-tail') {
          assembly.totalBytes = Buffer.byteLength(manifest.input);
          manifest.inputDigest = createHash('sha256').update(manifest.input).digest('hex');
          const stored = await fixture.base.platform.materials.storeArtifact(
            fixture.base.workCtx(continuation.runRef), {
              contentType: prepared.envelope.bundleRef.contentType, body: JSON.stringify(manifest),
              sources: manifest.sourceRefs, origin: { kind: 'execution', ref: continuation.runRef },
            },
          );
          if (stored.status !== 'stored') throw new Error(JSON.stringify(stored));
          candidate.envelope.bundleRef = stored.ref;
          candidate.inputBinding.inputDigest = manifest.inputDigest;
          candidate.inputBinding.manifestDigest = stored.ref.digest;
        }
        const callsBefore = fixture.model.calls();
        const result = await fixture.runtime.startRun(fixture.base.ctx, {
          prepared: candidate, consumerId: 'pc2-entry', requestId: `pc2-entry-${kind}`,
        });
        return { result, candidate, manifest, rendered, callsBefore, callsAfter: fixture.model.calls() };
      },
      close: () => fixture.close(),
    };
  } catch (error) { await fixture.close(); throw error; }
}
```

`tests/helpers/PC2-host-fixture.ts`

```ts
/**
 * PC-2 Host fixture draft for lead review.
 *
 * Uses the real Host and HTTP request handler. Only socket binding is replaced;
 * requests are streams delivered to the real Server request listener.
 * No fetch, socket, real provider or network listener is used.
 *
 * Construct/start fixtures serially: composition capture and listen capture are
 * temporary spies. All filesystem writes belong to the fixture's temporary root.
 */
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import {
  Server, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { vi } from 'vitest';
import { createBuiltinProviderRegistry } from '../../vendor/coding-agent/dist/public-api.js';
import {
  createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions,
} from '../../src/app/host.js';
import { PLATFORM_TOKEN_HEADER, type CoreScope } from '../../src/app/core-http-types.js';
import {
  SETTINGS_API_PREFIX, type SettingsResponse, type SettingsRoutes,
} from '../../src/app/host-settings-types.js';
import type { PromptPackChainEntryV1 } from '../../src/contracts/prompts/prompt-pack.js';
import * as platformModule from '../../src/composition/create-platform.js';
import { PLATFORM_TOKEN_META_NAME, writeHostPage } from './host-page.js';
import { scriptedModel } from './PC-platform-fixture.js';
import { writePC2Packs } from './PC2-pack-fixture.js';

export const PC2_PROMPT_ROUTES = [
  'prompts/packs/list', 'prompts/packs/create',
  'prompts/templates/read', 'prompts/templates/save',
  'prompts/tools/read', 'prompts/tools/save',
] as const satisfies readonly (keyof SettingsRoutes)[];

export type PC2HttpOptions = {
  method?: string;
  token?: string | null;
  origin?: string | null;
  rawBody?: string;
};
export type PC2HttpResult<T = unknown> = {
  status: number; headers: OutgoingHttpHeaders; text: string; body: T;
};
export type PC2HostStart = Partial<Pick<LocalWorkbenchHostOptions,
  'settings' | 'workspaces' | 'runtimeConfiguration' | 'kernelStores' | 'runtime'>>;
export type PC2HostOptions = {
  start?: boolean;
  scope?: CoreScope;
  packs?: readonly PromptPackChainEntryV1[];
  model?: ReturnType<typeof scriptedModel>;
  models?: NonNullable<LocalWorkbenchHostOptions['settings']>['models'];
  runtimeConfiguration?: LocalWorkbenchHostOptions['runtimeConfiguration'];
};

type Platform = Awaited<ReturnType<typeof platformModule.createTargetPlatform>>;
type RuntimeBinding = Parameters<typeof platformModule.createTargetPlatform>[0]['runtime'];
type Address = Awaited<ReturnType<LocalWorkbenchHost['listen']>>;

async function directoryLink(target: string, path: string): Promise<void> {
  await symlink(resolve(target), path, process.platform === 'win32' ? 'junction' : 'dir');
}

/** Capture the real Server without invoking node's socket-binding implementation. */
async function listenInProcess(host: LocalWorkbenchHost): Promise<{ server: Server; address: Address }> {
  const captured: Server[] = [];
  const replacement = function (this: Server, ...args: unknown[]): Server {
    captured.push(this);
    const callback = args.at(-1);
    if (typeof callback !== 'function') throw new Error('Unexpected Host listen signature');
    queueMicrotask(() => callback());
    return this;
  };
  const spy = vi.spyOn(Server.prototype, 'listen')
    .mockImplementation(replacement as typeof Server.prototype.listen);
  try {
    const address = await host.listen(18081);
    const server = captured[0];
    if (!server || captured.length !== 1) throw new Error('No unique Host HTTP server');
    return { server, address };
  } finally { spy.mockRestore(); }
}

async function dispatch(
  server: Server, address: Address, token: string,
  path: string, input: unknown, options: PC2HttpOptions = {},
): Promise<PC2HttpResult> {
  const base = new URL(address.url);
  const method = options.method ?? 'POST';
  const body = options.rawBody ?? (input === undefined ? undefined : JSON.stringify(input));
  const headers: Record<string, string> = { host: base.host, 'content-type': 'application/json' };
  const selectedToken = options.token === undefined ? token : options.token;
  const origin = options.origin === undefined ? base.origin : options.origin;
  if (selectedToken !== null) headers[PLATFORM_TOKEN_HEADER] = selectedToken;
  if (origin !== null) headers.origin = origin;
  const request = Object.assign(
    Readable.from(body === undefined ? [] : [Buffer.from(body)]),
    { headers, method, url: path, setTimeout() { return this; } },
  );
  const chunks: Buffer[] = [];
  let status = 0;
  let responseHeaders: OutgoingHttpHeaders = {};
  const response = Object.assign(new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
      done();
    },
  }), {
    writeHead(code: number, supplied: OutgoingHttpHeaders = {}) {
      status = code;
      responseHeaders = { ...supplied };
      return this;
    },
  });
  const finished = new Promise<void>((done, reject) => {
    response.once('finish', done);
    response.once('error', reject);
    request.once('error', reject);
  });
  if (!server.emit('request', request as unknown as IncomingMessage, response as unknown as ServerResponse)) {
    throw new Error('The Host has no request listener');
  }
  await finished;
  const text = Buffer.concat(chunks).toString('utf8');
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* HTML and empty bodies remain text. */ }
  return { status, headers: responseHeaders, text, body: parsed };
}

/** Reuses host-page and PC's scripted provider; the Host builds its own platform. */
export async function openPC2HostFixture(options: PC2HostOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pc2-host-'));
  const paths = {
    directory, database: join(directory, 'database'), workspace: join(directory, 'workspace'),
    settingsDirectory: join(directory, 'settings'), promptsDirectory: join(directory, 'settings', 'prompts'),
    publicDir: join(directory, 'public'), unrelated: join(directory, 'unrelated'),
  };
  const scope: CoreScope = options.scope ?? { projectId: 'pc2-host-project', workspaceId: 'pc2-host-workspace' };
  const model = options.model ?? scriptedModel([]);
  const definitions = createBuiltinProviderRegistry();
  let live: {
    host: LocalWorkbenchHost; platform: Platform; runtime: RuntimeBinding;
    server: Server; address: Address; token: string;
  } | undefined;
  let current: PC2HostStart = {};
  let closed = false;
  const defaults: LocalWorkbenchHostOptions = {
    storage: { kind: 'sqlite', directory: paths.database },
    actor: { kind: 'human', id: 'pc2-host-operator' },
    workspaces: [{
      scope, name: 'PC2 workspace', root: paths.workspace,
      workspaceRevision: 1, readPrefixes: ['.'],
    }],
    settings: {
      settingsDirectory: paths.settingsDirectory,
      ...(options.models === undefined ? {} : { models: options.models }),
    },
    publicDir: paths.publicDir,
    now: () => '2026-10-22T00:00:00.000Z',
    runtimeProvider: {
      registry: { get: definitions.get.bind(definitions), create: () => model.client },
      secretSource: { get: () => 'pc2-fixture-secret' },
    },
    ...(options.runtimeConfiguration === undefined ? {} : { runtimeConfiguration: options.runtimeConfiguration }),
  };
  const requireLive = () => {
    if (!live) throw new Error('Start the PC2 Host first');
    return live;
  };
  const stop = async (): Promise<void> => {
    const prior = live;
    live = undefined;
    await prior?.host.close();
  };
  const start = async (overrides: PC2HostStart = {}) => {
    if (closed) throw new Error('The PC2 Host fixture is closed');
    if (live) throw new Error('Stop the current Host before starting another');
    current = { ...current, ...overrides };
    let platform: Platform | undefined;
    let runtime: RuntimeBinding;
    let host: LocalWorkbenchHost | undefined;
    const actual = platformModule.createTargetPlatform;
    const spy = vi.spyOn(platformModule, 'createTargetPlatform').mockImplementation(async input => {
      runtime = input.runtime;
      platform = await actual(input);
      return platform;
    });
    try {
      host = await createLocalWorkbenchHost({ ...defaults, ...current });
    } catch (error) {
      await platform?.close();
      throw error;
    } finally { spy.mockRestore(); }
    try {
      if (!platform) throw new Error('The Host did not construct its platform');
      const transport = await listenInProcess(host);
      const page = await dispatch(transport.server, transport.address, '', '/workbench/', undefined, {
        method: 'GET', token: null,
      });
      const token = new RegExp(`<meta name="${PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(page.text)?.[1];
      if (page.status !== 200 || token === undefined) throw new Error('The Host page supplied no token');
      live = { host, platform, runtime, ...transport, token };
      return live;
    } catch (error) { await host.close(); throw error; }
  };
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try { await stop(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  };
  const request = (path: string, input: unknown, requestOptions: PC2HttpOptions = {}) => {
    const currentHost = requireLive();
    return dispatch(currentHost.server, currentHost.address, currentHost.token, path, input, requestOptions);
  };
  const call = async <K extends keyof SettingsRoutes>(
    route: K, input: SettingsRoutes[K]['input'], requestOptions: PC2HttpOptions = {},
  ): Promise<PC2HttpResult<SettingsResponse<SettingsRoutes[K]['value']>>> =>
    request(SETTINGS_API_PREFIX + route, input, requestOptions) as
      Promise<PC2HttpResult<SettingsResponse<SettingsRoutes[K]['value']>>>;

  try {
    for (const path of Object.values(paths)) await mkdir(path, { recursive: true });
    await writeFile(join(paths.workspace, 'README.md'), '# PC2 workspace\n');
    await writeHostPage(paths.publicDir);
    await writePC2Packs(paths.promptsDirectory, options.packs ?? []);
    if (options.start !== false) await start();
  } catch (error) { await close(); throw error; }

  return {
    paths, scope, model, get live() { return requireLive(); },
    start, stop, close, request, call,
    async restart(overrides: PC2HostStart = {}) { await stop(); return start(overrides); },
    async linkPack(pack: PromptPackChainEntryV1) {
      const settingsDirectory = current.settings?.settingsDirectory ?? paths.settingsDirectory;
      const promptsDirectory = join(settingsDirectory, 'prompts');
      const outside = join(directory, 'outside-packs');
      const written = await writePC2Packs(outside, [pack]);
      const target = written[pack.packId];
      if (!target) throw new Error('Only a user pack can be linked');
      await mkdir(promptsDirectory, { recursive: true });
      const link = join(promptsDirectory, pack.packId);
      await directoryLink(target, link);
      return { link, target, promptsDirectory };
    },
  };
}

export type PC2DirectoryRelation = 'settings-inside' | 'prompts-inside' | 'equal' | 'symlink';

/**
 * Restored cases obtain host-settings.json from a successful public
 * workspaces/open, then relocate that unchanged file before the tested start.
 */
export async function openPC2DirectoryCase(
  relation: PC2DirectoryRelation, registration: 'configured' | 'restored',
) {
  const fixture = await openPC2HostFixture({ start: false });
  try {
    const area = join(fixture.paths.directory, 'relation');
    let root = join(area, 'workspace');
    let settingsDirectory = join(area, 'settings');
    if (relation === 'settings-inside') settingsDirectory = join(root, 'private');
    if (relation === 'prompts-inside') root = settingsDirectory;
    if (relation === 'equal') root = join(settingsDirectory, 'prompts');
    const promptsDirectory = join(settingsDirectory, 'prompts');
    await mkdir(root, { recursive: true });
    await mkdir(settingsDirectory, { recursive: true });
    if (relation === 'symlink') {
      const realPrompts = join(root, 'linked-prompts');
      await mkdir(realPrompts, { recursive: true });
      await directoryLink(realPrompts, promptsDirectory);
    } else {
      await mkdir(promptsDirectory, { recursive: true });
    }
    const finalOptions: PC2HostStart = {
      settings: { settingsDirectory },
      workspaces: registration === 'configured' ? [{
        scope: fixture.scope, name: 'PC2 covered root', root,
        workspaceRevision: 1, readPrefixes: ['.'],
      }] : [],
    };
    if (registration === 'restored') {
      const staging = join(fixture.paths.directory, 'staging-settings');
      await fixture.start({ settings: { settingsDirectory: staging }, workspaces: [] });
      const opened = await fixture.call('workspaces/open', {
        path: root, writeAllowed: false, commandsAllowed: false,
      });
      if (opened.status !== 200 || opened.body.status !== 'ready') {
        throw new Error(`Could not create the restored-root setup: ${opened.text}`);
      }
      await fixture.stop();
      await copyFile(join(staging, 'host-settings.json'), join(settingsDirectory, 'host-settings.json'));
    }
    return {
      fixture, relation, registration, root, settingsDirectory, promptsDirectory,
      start: () => fixture.start(finalOptions),
      close: () => fixture.close(),
    };
  } catch (error) { await fixture.close(); throw error; }
}
```

The exports and reuse are:

| Export / signature | Existing helper reused |
|---|---|
| `PC2_WORK_INPUT: string`; `PC2_OTHER_WORK_INPUT: string` | Hand-written inputs; PC-2 ruling 9 |
| `PC2PackSpec` | Input type for `pc2PackEntry` |
| `pc2PackEntry(packId, spec?): PromptPackChainEntryV1` | Plain data; no platform construction |
| `pc2PackCases(): { platform, parent, child, toolChild, legalOrder, dotName, broken, …chains }` | `pc2PackEntry`; no production-derived expectations |
| `writePC2Packs(root, entries): Promise<Record<string,string>>` | Shared filesystem setup for both files |
| `PC2PackSnapshot` | Byte snapshot type |
| `snapshotPC2Pack(directory): Promise<PC2PackSnapshot>` | Filesystem observation only |
| `comparePC2Snapshots(before, after): { equal, added, removed, changed }` | Byte comparison only |
| `snapshotPC2Step<T>(directory, step): Promise<{ before, after, difference, outcome }>` | Snapshot helpers |
| `pc2ResolvedSource(entries): Promise<MutablePromptPacks>` | `PC-platform-fixture.mutablePromptPacks` |
| `PC2DiskSourceFactory`; `pc2DiskOptions(root, factory, options?): Promise<PCOptions>` | PC’s existing source option; works with its Work and RL-backed Query fixtures |
| `openPC2ReviewFixture(mode, options?): Promise<ReviewFixture>` | `openPCK3ReviewFixture`, transitively `K3-proposal-round`, `K3-review-card-fixture`, `K3-35-continuation-fixture` |
| `openPC2QueryHistoryFixture(options?): Promise<QueryHistoryFixture>` | `openPCWorkFixture` / `WP2-platform-support`; public consultation and standalone Query sequence from `WP2-wiring.test.ts` |
| `PC2EntryCase`; `openPC2EntryFixture(options?): Promise<EntryFixture>` | PC Work and its public continuation setup |
| `PC2_PROMPT_ROUTES` | Frozen six-route tuple |
| `PC2HttpOptions`; `PC2HttpResult<T>` | Transport input/output types |
| `PC2HostStart`; `PC2HostOptions` | Existing Host option types |
| `openPC2HostFixture(options?): Promise<HostFixture>` | `host-page.writeHostPage`, PC `scriptedModel`; Host construction/capture pattern from `PC-host-prompt-selection.test.ts` |
| `PC2DirectoryRelation`; `openPC2DirectoryCase(relation, registration): Promise<DirectoryFixture>` | Same Host fixture and actual `workspaces/open` persistence |

`MutablePromptPacks`, `ReviewFixture`, `QueryHistoryFixture`, `EntryFixture`, `HostFixture`, and `DirectoryFixture` above are descriptions of inferred return types, not additional imported declarations.

Name and seam notes:

- The only deferred production import is `resolvePromptPackV1`, with `PromptPackChainEntryV1`, exactly as frozen in PC-2 ruling 4.
- H’s disk-source constructor is unspecified. `PC2DiskSourceFactory` supplies it without guessing an import.
- No assembler pack-argument name or new role-reminder slot name is assumed. PE8 uses the existing required `unknown-call-review.writtenLines` slot and `k3.none`.
- Host runtime access is captured at the existing public composition entry; the code does not assume a `host.runtime` property.
- `readManifestFromEnvelope` already appears in `K3-proposal-round.ts`; it reads the prepared artifact through the existing entry-service reader.
- Duplicate-chain, omitted-platform and corrupted-platform cases describe pure resolver inputs. Disk writing preserves user-pack files; the Host supplies its generated `platform`.
- The K3 shell mock remains the calling test’s existing setup. The fixtures introduce no replacement shell seam or `read_source` permission.