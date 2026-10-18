/**
 * Slice 4C-2 session A rework NE5 (spec §11.4/§11.5, §5.2 rows C-01–C-06, PU-03):
 * the `notes` extension split into `understanding`/`general`, the Goal card's
 * understanding + norm lines, the budget note rows and the note sources the
 * binding records.
 *
 * Every scenario runs over a REAL `createTargetPlatform` (memory and SQLite),
 * writes notes through the public write service, and reaches the Work assembly
 * through the public `createExecutionPreparation.prepare`, whose graph-context
 * port is the platform's real reader (and therefore the real read model). No
 * material, graph-context or note row is faked: the only local doubles are the
 * Host configuration stub, the local manifest body store and the Role-facts
 * legacy-template stub, none of which touch the note read.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef, RuntimeInputBindingV1, SourceRefV1 } from '../../src/contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type {
  ContextAssemblyBindingV1, ContextSourceV1,
} from '../../src/contracts/graph-context.js';
import type { WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import { CONTEXT_SECTION_HEADERS, createContextAssembler } from '../../src/core/agent-runtime/context-assembler.js';
import type { ExecutionPreparationDependencies } from '../../src/core/agent-runtime/execution-preparation.js';
import { createExecutionPreparation } from '../../src/core/agent-runtime/execution-preparation.js';
import type { ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import type { RawArtifactPut, RawArtifactRecord } from '../../src/core/record-store/body-ports.js';
import type { StoreResult } from '../../src/core/record-store/ports.js';
import type { MaterialPort } from '../../src/core/work-graph/model/material-contracts.js';
import type { QueryPreparationFacts } from '../../src/core/work-graph/queries/contracts.js';
import {
  S4A_AT, createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind,
} from '../helpers/S4A-note-fixture.js';
import { createWP2Platform, preparedBundle } from '../helpers/WP2-platform-support.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];

const GOAL = 's4a-goal';
const STAGE = 's1';
const TASK = 't1';
const GOAL_KEY = `goal:${GOAL}`;
const STAGE_KEY = `stage:${GOAL}/1/${STAGE}`;
const TASK_KEY = `task:${GOAL}/${TASK}`;
const FILE_A = 'src/a/x.ts';

// -------------------------------------------------------------------------- //
// Local non-note doubles (manifest body store, Host configuration, Role facts).//
// -------------------------------------------------------------------------- //

function materialsDouble(): MaterialPort {
  return {
    async storeArtifact() {
      return { status: 'rejected', code: 'unsupported', reason: 'the S4C2 fixture does not store material' };
    },
    async openArtifact() {
      return { status: 'rejected', code: 'unsupported', reason: 'the S4C2 fixture does not open material' };
    },
  };
}

function bodyStore() {
  const records = new Map<string, RawArtifactRecord>();
  let puts = 0;
  return {
    async put(input: RawArtifactPut): Promise<StoreResult<{ ref: ArtifactRef; replayed: boolean }>> {
      puts += 1;
      const fallbackSource: SourceRefV1 = { kind: 'workspace', refId: 'w', revision: '1' };
      const ref: ArtifactRef = {
        kind: 'artifact', contentType: input.contentType, digest: artifactBodyDigest(input.body),
        sizeBytes: Buffer.byteLength(input.body, 'utf8'), source: input.sourceRefs[0] ?? fallbackSource,
      };
      if (!records.has(ref.digest)) {
        records.set(ref.digest, { ref, body: input.body, sourceRefs: input.sourceRefs, origin: input.origin });
      }
      return { status: 'ready', value: { ref, replayed: false } };
    },
    async read(ref: ArtifactRef): Promise<StoreResult<RawArtifactRecord>> {
      const record = records.get(ref.digest);
      return record === undefined
        ? { status: 'rejected', code: 'not_found', reason: `no body for ${ref.digest}` }
        : { status: 'ready', value: record };
    },
    putCount: (): number => puts,
  };
}

/** The exact Session role the S4A fixture claims with: the legacy executor template. */
function runtimeConfiguration(overrides: Partial<ResolvedRuntimeConfiguration> = {}): ResolvedRuntimeConfiguration {
  return {
    configurationRevision: 's4c2-host@1',
    model: {
      configuration: { revision: 's4c2-model@1', provider: 'scripted', model: 's4c2-test', baseUrl: 'http://127.0.0.1' },
      client: {} as unknown as ResolvedRuntimeConfiguration['model']['client'],
    },
    budget: {
      contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512,
    },
    hostTemplate: { templateId: 'platform-executor', revision: 's3.1', digest: sha256Hex('s4c2-template') },
    tools: ['read'], writeScope: [],
    skills: { resourceRoot: 'resources/skills', enabledIds: [] },
    systemInstruction: 'S4C2 real-chain executor instruction: formal platform facts only.',
    deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    platformDuty: 'executor', contextResidentBytes: 4096,
    ...overrides,
  };
}

type Harness = {
  fixture: S4ANoteFixture;
  preparation: ReturnType<typeof createExecutionPreparation>;
  assembler: ReturnType<typeof createContextAssembler>;
  bodies: ReturnType<typeof bodyStore>;
};

/**
 * The local preparation harness. `config` overrides the resolved Host
 * configuration (C-02 uses `contextResidentBytes: 0`); everything else is the
 * real composition: the real note read model behind the real graph-context
 * port, the real Run reader and the real manifest body store. No Run binding is
 * injected here: C-03 binds through the WP2 platform's public runtime.
 */
function harness(fixture: S4ANoteFixture, config: Partial<ResolvedRuntimeConfiguration> = {}): Harness {
  const bodies = bodyStore();
  const graphContext = fixture.platform.graphContext;
  const executions: ExecutionPreparationDependencies['executions'] = {
    async readExecution(ctx: CoreCallContext, ref: RunRef) {
      return fixture.platform.executions.readExecution(ctx, ref);
    },
  };
  const roles: ExecutionPreparationDependencies['roles'] = {
    async resolveRoleBindingFacts() {
      return { result: { status: 'ready' as const, value: { status: 'absent' as const, roleId: 'platform-executor',
        reason: 'the S4A fixture installs no coordination policy' } }, guards: [] };
    },
  };
  const host = {
    async resolveConfiguration() { return { status: 'ready' as const, value: runtimeConfiguration(config) }; },
  };
  const unknownCallReviews = fixture.platform.unknownCallReviews;
  const assembler = createContextAssembler({
    executions, roles, materials: materialsDouble(), bodies, graphContext, taskInputs: fixture.platform.taskInputs,
    unknownCallReviews,
  });
  const deps: ExecutionPreparationDependencies = {
    executions, roles, bodies, host, now: () => S4A_AT, newId: () => 's4c2-id',
    graphContext, taskInputs: fixture.platform.taskInputs, unknownCallReviews,
    // Item 2: this assembly prepare never reads the Task closure; fail closed
    // if it ever does (never an absent → open default).
    readTaskClosure: async () => ({ status: 'rejected' as const, code: 'unavailable' as const,
      reason: 'this test does not read the Task closure' }),
  };
  return { fixture, preparation: createExecutionPreparation(deps, assembler), assembler, bodies };
}

// -------------------------------------------------------------------------- //
// Fixture note helpers and assertions.                                        //
// -------------------------------------------------------------------------- //

function common(anchor: NoteDraftV1['anchor']): Pick<NoteDraftV1, 'anchor' | 'extraAnchors' | 'facts'
  | 'basisFiles' | 'structural' | 'replaces' | 'contradicts' | 'coexistWith'> {
  return { anchor, extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [] };
}

function understandingDraft(anchor: NoteDraftV1['anchor'], conclusion: string,
  status = 's', basisFiles: string[] = []): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status, decided: 'd', open: 'o', next: 'n', risks: 'r' };
  return { ...common(anchor), kind: 'understanding', topic: 'understanding', conclusion, sections, basisFiles };
}

function generalDraft(anchor: NoteDraftV1['anchor'], topic: string, conclusion: string,
  basisFiles: string[] = []): NoteDraftV1 {
  return { ...common(anchor), kind: 'pitfall', topic, conclusion, body: 'body', basisFiles };
}

function normDraft(topic: string, conclusion: string): NoteDraftV1 {
  return { ...common({ kind: 'project' }), kind: 'convention', topic, conclusion, body: `规范 ${topic}` };
}

async function write(f: S4ANoteFixture, draft: NoteDraftV1, goalId: string | null): Promise<string> {
  const result = await f.write(f.ctx(), draft, goalId);
  expect(result.status).toBe('accepted');
  if (result.status !== 'accepted') throw new Error(`note write was not accepted: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function prepareOnce(h: Harness, runRef: RunRef, requestId: string): Promise<{
  prepared: { inputBinding: RuntimeInputBindingV1; envelope: TaskEnvelopeV1 };
  manifest: { input: string; contextAssembly?: ContextAssemblyBindingV1 };
}> {
  const result = await h.preparation.prepare(h.fixture.ctx(), { runRef, requestId });
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(`prepare was not ready: ${JSON.stringify(result)}`);
  const stored = await h.bodies.read(result.value.envelope.bundleRef);
  expect(stored.status).toBe('ready');
  if (stored.status !== 'ready') throw new Error('the prepared manifest body was not stored');
  const manifest = JSON.parse(stored.value.body) as { input: string; contextAssembly?: ContextAssemblyBindingV1 };
  return { prepared: result.value, manifest };
}

function noteSources(binding: ContextAssemblyBindingV1 | undefined): Extract<ContextSourceV1, { kind: 'note' }>[] {
  return (binding?.sources ?? []).filter((source): source is Extract<ContextSourceV1, { kind: 'note' }> =>
    source.kind === 'note');
}

function sectionText(input: string, header: string, nextHeader: string): string {
  const start = input.indexOf(header);
  if (start < 0) return '';
  const end = nextHeader === '' ? input.length : input.indexOf(nextHeader, start + header.length);
  return input.slice(start + header.length, end < 0 ? input.length : end);
}

// -------------------------------------------------------------------------- //
// C-01: two understanding rows + three general rows, with their real versions. //
// -------------------------------------------------------------------------- //

describe('S4C2 real-chain assembly', () => {
  it.each(KINDS)('C-01 (%s) records the 2 understanding and 3 general note sources with version 1', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const goalNote = await write(f, understandingDraft({ kind: 'goal', goalId: GOAL }, 'goal now'), GOAL);
      const stageNote = await write(f, understandingDraft({ kind: 'stage', goalId: GOAL, stageId: STAGE }, 'stage now'), GOAL);
      const taskNote = await write(f, generalDraft({ kind: 'task', goalId: GOAL, taskId: TASK }, 'task-general', 'task general'), GOAL);
      const goalGeneral = await write(f, generalDraft({ kind: 'goal', goalId: GOAL }, 'goal-general', 'goal general'), GOAL);
      const stageGeneral = await write(f, generalDraft({ kind: 'stage', goalId: GOAL, stageId: STAGE }, 'stage-general', 'stage general'), GOAL);

      const h = harness(f);
      const run = await f.claimRun('c01', TASK);
      const { manifest } = await prepareOnce(h, run, 'c01');
      expect(manifest.input).toContain(`目标 ${GOAL} 当前理解（${goalNote} v1）：goal now`);
      expect(manifest.input).toContain(`阶段 ${STAGE} 当前理解（${stageNote} v1）：stage now`);
      expect(manifest.input.indexOf('goal now')).toBeLessThan(manifest.input.indexOf('stage now'));

      const sources = noteSources(manifest.contextAssembly);
      expect(sources).toHaveLength(5);
      expect(sources.map(source => source.anchorKey).sort())
        .toEqual([GOAL_KEY, GOAL_KEY, STAGE_KEY, STAGE_KEY, TASK_KEY].sort());
      expect(sources.map(source => source.version)).toEqual([1, 1, 1, 1, 1]);
      expect(new Set(sources.map(source => source.noteId)))
        .toEqual(new Set([goalNote, stageNote, taskNote, goalGeneral, stageGeneral]));
    } finally { await f.close(); }
  });

  // ── C-02: a warning that does not fit → omitted 1 and no source. ───────────
  it.each(KINDS)('C-02 (%s) the stale warning does not fit: the notes section is omitted once with no source', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      // A real accepted general note whose basis file changes → freshness stale,
      // so it renders (were it to fit) as the 需复查 warning line.
      const noteId = await write(f, generalDraft({ kind: 'task', goalId: GOAL, taskId: TASK },
        'stale-general', 'STALE-WARNING', [FILE_A]), GOAL);
      await writeFile(join(f.root, FILE_A), 'export const a = 2;\n');

      // Zero resident budget: the warning row cannot fit, so the notes section
      // reports exactly one omission and records no source for it.
      const h = harness(f, { contextResidentBytes: 0 });
      const run = await f.claimRun('c02', TASK);
      const { manifest } = await prepareOnce(h, run, 'c02');
      expect(manifest.input).not.toContain(`需复查：${noteId} STALE-WARNING，不能当现行结论`);
      expect(manifest.contextAssembly?.sections.find(section => section.name === 'notes'))
        .toMatchObject({ omitted: 1, startByte: null });
      expect(noteSources(manifest.contextAssembly).some(source => source.noteId === noteId)).toBe(false);
    } finally { await f.close(); }
  });

  // ── C-03: a publicly bound Run replays the saved input after a supersede. ──
  it.each(KINDS)('C-03 (%s) a publicly bound execution replays the saved input and never re-assembles', async kind => {
    // The S4A platform's runtime is the un-wired skeleton, so public binding
    // runs on the WP2 composition root (its `runtime.startRun` persists the
    // binding; op plans are unchanged). `onCommit` aborts right after the Run
    // entry-authorization commit (the W-02 path), leaving the Run `starting`
    // with the saved binding so the next prepare must replay it.
    const controller = new AbortController();
    let armed = false;
    const f = await createWP2Platform({
      kind, duty: 'secretary', allowAnyRun: true, ownedHost: true,
      onCommit: notice => {
        if (armed && notice.aggregates.some(aggregate => aggregate.aggregateType === 'Run')) controller.abort();
      },
    });
    try {
      const goalId = f.goalRef.goalId;
      const firstNote = await f.platform.notes.writeNote(f.ctx, { commandId: 's4c2-c03-first',
        note: understandingDraft({ kind: 'goal', goalId }, 'first understanding'),
        expectedPointerRevision: null, goalId });
      expect(firstNote.status).toBe('accepted');
      if (firstNote.status !== 'accepted') return;

      const first = await preparedBundle(f, f.runRef!, 's4c2-c03-first');
      armed = true;
      const started = await f.platform.runtime.startRun({ ...f.ctx, signal: controller.signal },
        { prepared: first.prepared, consumerId: 's4c2-c03-driver', requestId: 's4c2-c03-start' });
      expect(started).toMatchObject({ status: 'rejected', code: 'cancelled' });
      const bound = await f.platform.executions.readExecution(f.ctx, f.runRef!);
      if (bound.status !== 'ready') throw new Error(`C-03 bound run read: ${JSON.stringify(bound)}`);
      expect(bound.value.run).toMatchObject({ status: 'starting', inputBinding: first.prepared.inputBinding });

      // Supersede the goal understanding through the real note write.
      const superseding = await f.platform.notes.writeNote(f.ctx, { commandId: 's4c2-c03-second',
        note: { ...understandingDraft({ kind: 'goal', goalId }, 'superseding understanding'),
          replaces: [firstNote.noteId] },
        expectedPointerRevision: 1, goalId });
      expect(superseding.status).toBe('accepted');
      if (superseding.status !== 'accepted') return;

      // Re-preparation replays the saved value: byte-identical input and no new
      // graph read (installing the counter after the first assembly).
      const graphContext = f.platform.graphContext;
      const realRead = graphContext.readContextFacts.bind(graphContext);
      let reads = 0;
      graphContext.readContextFacts = (ctx, request) => { reads += 1; return realRead(ctx, request); };
      const second = await preparedBundle(f, f.runRef!, 's4c2-c03-second');
      expect(second.prepared).toEqual(first.prepared);
      expect(second.input).toBe(first.input);
      expect(reads).toBe(0);
    } finally { await f.close(); }
  });

  // ── PU-03: project/goal/stage order, 5 norms + 另有 2 条, kept general rows. ─
  it.each(KINDS)('PU-03 (%s) keeps project/goal/stage order, five norms plus 另有 2 条, and the general row', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const projectNote = await write(f, understandingDraft({ kind: 'project' }, 'PROJECT conclusion', 'PROJECT-BODY'), null);
      const goalNote = await write(f, understandingDraft({ kind: 'goal', goalId: GOAL }, 'PROJECT-GOAL'), GOAL);
      const stageNote = await write(f, understandingDraft({ kind: 'stage', goalId: GOAL, stageId: STAGE }, 'PROJECT-STAGE'), GOAL);
      const normIds: string[] = [];
      for (let index = 1; index <= 7; index += 1) {
        normIds.push(await write(f, normDraft(`n${String(index)}`, `NORM-${String(index)}`), null));
      }
      const generalNote = await write(f, generalDraft({ kind: 'task', goalId: GOAL, taskId: TASK }, 'budget', 'BUDGET-ONLY-LINE'), GOAL);

      const h = harness(f);
      const run = await f.claimRun('pu03', TASK);
      const { manifest } = await prepareOnce(h, run, 'pu03');
      const input = manifest.input;
      const projectAt = input.indexOf('PROJECT-BODY');
      const goalAt = input.indexOf('PROJECT-GOAL');
      const stageAt = input.indexOf('PROJECT-STAGE');
      expect(projectAt).toBeGreaterThan(-1);
      expect(goalAt).toBeGreaterThan(projectAt);
      expect(stageAt).toBeGreaterThan(goalAt);
      expect(input).toContain(`项目 当前理解（${projectNote} v1）：现状\nPROJECT-BODY`);
      // Newest five project norms, each with its note id and version; the two
      // oldest are omitted and only counted on the Goal card.
      for (let index = 3; index <= 7; index += 1) {
        expect(input).toContain(`约定(项目)：NORM-${String(index)}（${normIds[index - 1]!} v1）`);
      }
      for (let index = 1; index <= 2; index += 1) expect(input).not.toContain(`NORM-${String(index)}`);
      expect(input).toContain('另有 2 条，用‘看’读项目');

      const notes = sectionText(input, CONTEXT_SECTION_HEADERS.notes, CONTEXT_SECTION_HEADERS.reminders);
      expect(notes).toContain(`坑(任务 ${TASK})：BUDGET-ONLY-LINE（${generalNote} v1）`);
      for (let index = 3; index <= 7; index += 1) {
        expect(notes).not.toContain(`NORM-${String(index)}`);
      }
      expect(notes).not.toContain(`项目 当前理解（${projectNote}`);
      // 3 understanding + 5 norms + the one kept general row.
      expect(noteSources(manifest.contextAssembly)).toHaveLength(9);
    } finally { await f.close(); }
  });

  // ── C-04: a Query keeps the understanding + norms and never the general set. ─
  it.each(KINDS)('C-04 (%s) the Query sources are the goal understanding and the norm only', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const goalNote = await write(f, understandingDraft({ kind: 'goal', goalId: GOAL }, 'query understanding'), GOAL);
      const normNote = await write(f, normDraft('path', 'QUERY-NORM'), null);
      const generalNote = await write(f, generalDraft({ kind: 'task', goalId: GOAL, taskId: TASK }, 'ignored', 'QUERY-GENERAL'), GOAL);
      const goal = await f.platform.plans.queryGoal(f.ctx(), f.goalRef);
      expect(goal.status).toBe('ready');
      if (goal.status !== 'ready') return;
      const workspace = await f.platform.projects.readWorkspaceRegistration(f.ctx(), f.scope);
      expect(workspace.status).toBe('ready');
      if (workspace.status !== 'ready') return;
      const h = harness(f);
      const result = await h.assembler.assembleQuery(f.ctx(), {
        facts: {
          record: {} as QueryPreparationFacts['record'], goal: goal.value.goal,
          workspace: workspace.value.workspace as WorkspaceSnapshot, focusPlan: null,
          initiator: { kind: 'human', id: 's4a-operator' },
        },
        role: { status: 'absent', roleId: 'platform-executor', reason: 'the S4A fixture installs no role matrix' },
        configuration: runtimeConfiguration(),
        permissions: { tools: ['read'], writeScope: [] },
        question: 'What is the current understanding?',
      });
      expect(result.status, JSON.stringify(result)).toBe('ready');
      if (result.status !== 'ready') return;
      expect(result.value.input).toContain(`目标 ${GOAL} 当前理解（${goalNote} v1）：query understanding`);
      expect(result.value.input).toContain(`约定(项目)：QUERY-NORM（${normNote} v1）`);
      expect(result.value.input).not.toContain('QUERY-GENERAL');
      expect(noteSources(result.value.binding).map(source => source.noteId).sort())
        .toEqual([goalNote, normNote].sort());
    } finally { await f.close(); }
  });

  // ── C-05: a Goal/stage with no understanding still renders its anchor line. ─
  it.each(KINDS)('C-05 (%s) a Goal and stage without understanding render the anchor line and no note source', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const h = harness(f);
      const run = await f.claimRun('c05', TASK);
      const { manifest } = await prepareOnce(h, run, 'c05');
      expect(manifest.input).toContain(`目标 ${GOAL}：还没有当前理解`);
      expect(manifest.input).toContain(`阶段 ${STAGE}：还没有当前理解`);
      expect(noteSources(manifest.contextAssembly)).toEqual([]);
    } finally { await f.close(); }
  });

  // ── C-06: an ineligible understanding is exactly ONE warning line, no body. ─
  it.each(['memory', 'sqlite'] as const)('C-06 (%s) an ineligible understanding renders one warning line without a body', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const noteId = await write(f, understandingDraft({ kind: 'goal', goalId: GOAL }, 'stale conclusion', 's', [FILE_A]), GOAL);
      await writeFile(join(f.root, FILE_A), 'export const a = 2;\n');
      const h = harness(f);
      const run = await f.claimRun('c06', TASK);
      const { manifest } = await prepareOnce(h, run, 'c06');
      expect(manifest.input).toContain(`需复查：${noteId} stale conclusion，不能当现行结论（${noteId} v1）`);
      expect(manifest.input).not.toContain(`当前理解（${noteId} v1）`);
      // §11.4: a warning line is still a rendered note and is still a source.
      expect(noteSources(manifest.contextAssembly).map(source => source.noteId)).toContain(noteId);
    } finally { await f.close(); }
  });
});
