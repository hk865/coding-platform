/**
 * K3 section 3 item 9(c) + group 2 part 3 work item 3 (R1 K3-04; spec line
 * 1411, L5/L6 lines 213-222).
 *
 * The real `edit` is a `workspace_write` tool, not an independent read-only
 * call (`edit-tool.js:118-128`), so two in-flight edits cannot be one batch.
 * The R1 row is therefore covered by two single-call cases (`replace` and
 * `create`), each with a stand-in that keeps the REAL class and capabilities
 * and only blocks.
 *
 * K3-04 replace/create assertions:
 *  - RUN-25 (W-26) and one `compare_in_continuation` item each;
 *  - the note gives the path as `modified` / `added`, and the replace path a
 *    unified diff with the hand-computed content, <=2,000 units;
 *  - the prepared manifest's `workspaceBaseline` is an Artifact ref, not content.
 * The Host-denied file absence, the git-ignored directory handling and the
 * `notVisible` sentence are asserted in the replace case (the pre-start hook
 * writes the ignored directory before the first advance).
 */
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { toolSchema as z } from '../../vendor/coding-agent/dist/public-api.js';
import {
  continuationBriefDigest, renderContinuationBriefZh, type ContinuationBriefV1,
} from '../../src/contracts/continuation-brief.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { openWorkRoot, preparedOf, redrivePolicy } from './support/common.js';
import { preparedManifestOf } from './support/brief.js';

// --- The stand-in `edit` tool (blocks while armed). ------------------------
type EditCall = { callId: string; arguments: unknown };
type EditArmOptions = {
  /**
   * 9(c): keep the real `workspace_write` class and capabilities
   * (`edit-tool.js:118-128`). Default false is the injection stand-in: a
   * read-only, independent call the Kernel may batch with its siblings.
   */
  realClass?: boolean;
};

class EditSeam {
  private armed = false;
  private realClass = false;
  private gate: Promise<void> = Promise.resolve();
  private openGate: (() => void) | null = null;
  private waiters: Array<() => void> = [];
  readonly calls: EditCall[] = [];

  get enabled(): boolean { return this.armed; }
  arm(options: EditArmOptions = {}): void {
    this.armed = true;
    this.realClass = options.realClass === true;
    this.calls.length = 0;
    this.gate = new Promise<void>((resolve) => { this.openGate = resolve; });
  }
  release(): void {
    this.armed = false;
    this.openGate?.();
    this.openGate = null;
  }
  async waitForCall(): Promise<void> {
    if (this.calls.length > 0) return;
    await new Promise<void>((resolve) => { this.waiters.push(resolve); });
  }
  private async block(): Promise<void> { if (this.armed) await this.gate; }
  private stub(): ToolDefinition {
    return {
      name: 'edit',
      description: 'K3 stand-in edit (blocks until released)',
      inputSchema: z.object({ mode: z.string(), path: z.string() }).loose(),
      ...(this.realClass
        ? { effectClass: 'workspace_write' as const, requiredCapabilities: ['workspace_read', 'workspace_write'],
            independentReadOnly: false }
        // The injection stand-in: `RegistryToolBatchPolicy` batches a call set
        // only when every tool is `read_only` *and* `independentReadOnly`, so a
        // two-entry review is reachable without an impossible real flow.
        : { effectClass: 'read_only' as const, requiredCapabilities: ['workspace_read'], independentReadOnly: true }),
      defaultTimeoutMs: 15_000,
      outputLimitBytes: 32 * 1024,
      summarize: (argumentsValue) => ({ paths: this.realClass ? [String(argumentsValue['path'] ?? '')] : [],
        cwd: null, commandPreview: 'K3 edit' }),
      handler: {
        execute: async (call) => {
          this.calls.push({ callId: call.callId, arguments: call.arguments });
          for (const waiter of this.waiters.splice(0)) waiter();
          await this.block();
          return { schemaVersion: 1, callId: call.callId, status: 'success', output: [],
            effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
        },
      },
    } as ToolDefinition;
  }
  definition(actual: (workspace: never) => ToolDefinition, workspace: never): ToolDefinition {
    return this.armed ? this.stub() : actual(workspace);
  }
}
const seams = vi.hoisted(() => ({ editSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js')>();
  return {
    ...actual,
    createEditToolDefinition: (workspace: Parameters<typeof actual.createEditToolDefinition>[0]): ToolDefinition =>
      (seams.editSeam as EditSeam).definition(actual.createEditToolDefinition as never, workspace as never),
  };
});
const editSeam = new EditSeam();
seams.editSeam = editSeam;

afterEach(async () => {
  editSeam.release();
  await cleanupScenarios();
  await cleanupRestart();
});

const CHANGED = 'export const ag2bMarker = "K3_CHANGED";\n';
const CREATED = 'K3-04: created in flight\n';
/**
 * The unified diff of the clean start blob (`--- a/src/module.ts`) against the
 * current file: one del/add line plus the shared trailing empty line.
 */
const EXPECTED_DIFF = `--- a/src/module.ts\n+++ b/src/module.ts\n@@ -1,2 +1,2 @@\n`
  + `-export const ag2bMarker = "SCENARIO_GIT_BASELINE";\n+export const ag2bMarker = "K3_CHANGED";\n `;

type SingleEditOptions = {
  label: string;
  mode: 'replace' | 'create';
  path: string;
  callOldText: string;
  callNewText: string;
  /** Runs after `HostScenario.open` and before the first `h.advance`. */
  beforeStart?: (root: string) => Promise<void>;
  /** Runs while the single edit call is in flight. */
  during: (root: string) => Promise<void>;
};

/** One in-flight edit with the REAL class: crash (RUN-25), read the record and the prepared note. */
async function driveSingleEdit(options: SingleEditOptions): Promise<{
  review: UnknownCallReviewV1; brief: ContinuationBriefV1; note: string;
  manifest: Awaited<ReturnType<typeof preparedManifestOf>>;
}> {
  const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
  if (options.beforeStart !== undefined) await options.beforeStart(h.root);
  const toStart = await h.advance(h.select(options.label, AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const prepared = preparedOf(toStart.next);

  editSeam.arm({ realClass: true });
  const model = createScriptedModel([{ kind: 'calls', calls: [
    { callId: `${options.label}-edit`, name: 'edit', args: { mode: options.mode, path: options.path,
      oldText: options.callOldText, newText: options.callNewText } }] }]);
  const root = await openWorkRoot(h, model);
  let running: Promise<unknown> | null = null;
  let report: Awaited<ReturnType<HostScenario['restart']>>;
  try {
    running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: `${options.label}-start` });
    await editSeam.waitForCall();
    await options.during(h.root);
    report = await h.restart({ crash: true });
  } finally {
    editSeam.release();
    await running?.catch(() => undefined);
    await root.close();
  }

  const runRef = prepared.claim.runRef;
  expect(report).toMatchObject({ lease: 'owned', leaseRow: 'HL-03', report: { runs: [
    { ref: JSON.stringify(runRef), row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
      autoCleanup: { applied: true } }] } });
  const read = await h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
  if (read.status !== 'ready') throw new Error(`the review record must be readable: ${JSON.stringify(read)}`);
  const review = read.value;

  const toContinue = await h.advance(h.select(options.label, AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const continued = preparedOf(toContinue.next);
  const manifest = await preparedManifestOf(h, continued.envelope.bundleRef);
  const brief = manifest.continuationBrief;
  if (brief === undefined) throw new Error('the prepared manifest must carry the continuation brief');
  return { review, brief, note: renderContinuationBriefZh(brief, continuationBriefDigest(brief)), manifest };
}

describe('K3 R1 file change (K3-04)', () => {
  it('K3-04 (replace, L5/L6): one in-flight replace of a clean tracked file is modified and carries the hand-computed diff', async () => {
    const { review, brief, note, manifest } = await driveSingleEdit({ label: 'k3-04-replace', mode: 'replace', path: 'src/module.ts',
      callOldText: 'SCENARIO_GIT_BASELINE', callNewText: 'K3_CHANGED',
      beforeStart: async (root) => {
        // A git-ignored directory: write it and exclude it from git (an earlier
        // completed command's write). It must appear only in `notVisible`.
        await appendFile(join(root, '.git', 'info', 'exclude'), 'k3-04-ignored/\n');
        await mkdir(join(root, 'k3-04-ignored'), { recursive: true });
        await writeFile(join(root, 'k3-04-ignored', 'note.txt'), 'written into a git-ignored directory\n');
      },
      during: async (root) => { await writeFile(join(root, 'src', 'module.ts'), CHANGED); } });

    expect(review.items).toHaveLength(1);
    expect(review.items.map(item => item.toolName)).toEqual(['edit']);
    expect(review.items.map(item => item.kind)).toEqual(['file_edit']);
    expect(review.items.map(item => item.observed)).toEqual([
      { verdict: 'compare_in_continuation', by: 'platform' },
    ]);
    expect(review.workspace).toMatchObject({ status: 'captured', runBaselineKnown: true });
    // The git-ignored directory is listed in notVisible, and the ignored file is nowhere.
    expect(JSON.stringify(review)).not.toContain('k3-04-ignored/note.txt');
    if (review.workspace.status === 'captured') {
      expect(review.workspace.notVisible).toContain('k3-04-ignored/');
      expect(review.workspace.sample.map(entry => entry.path)).not.toContain('k3-04-ignored/note.txt');
    }

    const section = brief.unknownCallReview;
    expect(section).not.toBeNull();
    if (section === null || section === undefined) return;
    const file = section.items[0]!.files.find(candidate => candidate.path === 'src/module.ts');
    expect(file).toMatchObject({ path: 'src/module.ts', mode: 'replace', change: 'modified' });
    expect(file?.diff?.text).toBe(EXPECTED_DIFF);
    expect(file?.diff?.truncated).toBe(false);
    expect((file?.diff?.text.length ?? 0)).toBeLessThanOrEqual(2_000);
    expect(section.workspace.notVisible).toContain('k3-04-ignored/');
    expect(note).toContain('有改动');
    expect(note).toContain('- 不在变动清单里，不证明没做。');
    // The Host-denied file appears nowhere, not even its name.
    // L5 (spec line 204; contract line 810) requires the stored capture's
    // `notVisible` to carry the protected *prefix* `.evaluator`, and that
    // record is built outside this task's files; the denied file itself and
    // its basename must still be absent from both the note and the record.
    expect(note).not.toContain('.evaluator');
    expect(JSON.stringify(review)).not.toContain('.evaluator/hidden.ts');
    expect(JSON.stringify(review)).not.toContain('hidden.ts');

    // The prepared manifest's workspaceBaseline is an Artifact ref, not content.
    expect(manifest.workspaceBaseline).toMatchObject({ status: 'captured',
      ref: { kind: 'artifact', contentType: 'application/vnd.platform.workspace-baseline+json' },
      digest: expect.any(String) });
    expect(manifest.workspaceBaseline).not.toHaveProperty('dirty');
  }, 180_000);

  it('K3-04 (create, L5/L6): one in-flight create of an untracked file is added', async () => {
    const { review, brief } = await driveSingleEdit({ label: 'k3-04-create', mode: 'create', path: 'src/new-file.txt',
      callOldText: '', callNewText: CREATED,
      during: async (root) => { await writeFile(join(root, 'src', 'new-file.txt'), CREATED); } });

    expect(review.items).toHaveLength(1);
    expect(review.items.map(item => item.toolName)).toEqual(['edit']);
    expect(review.items.map(item => item.kind)).toEqual(['file_edit']);
    expect(review.items.map(item => item.observed)).toEqual([
      { verdict: 'compare_in_continuation', by: 'platform' },
    ]);

    const section = brief.unknownCallReview;
    expect(section).not.toBeNull();
    if (section === null || section === undefined) return;
    const file = section.items[0]!.files.find(candidate => candidate.path === 'src/new-file.txt');
    expect(file).toMatchObject({ path: 'src/new-file.txt', mode: 'create', change: 'added' });
  }, 180_000);

});
