/**
 * K3 group 2 part 3, work item 3 (R1 K3-40 (一)-(五); spec line 1417, L5).
 *
 * A tracked file (`src/module.ts`) is deleted / modified before the Run start
 * (uncommitted), the git workspace baseline records that path, and every case
 * leaves an unresolved in-flight tool call so the restart closes the Run by
 * RUN-25. The five cases differ in what the workspace shows when the crash
 * happens:
 *  (一) stays absent       -> no entry in the capture;
 *  (二) rebuilt            -> `added`;
 *  (三) modified then symlink -> `mode_changed`;
 *  (四) executable bit      -> `mode_changed`;
 *  (五) content             -> `modified`.
 * The assertion goes through the review record's `workspace` capture
 * (`unknown-call-reviews/read`), chosen once for all five cases.
 *
 * UNSPECIFIED (reported): the row names a stand-in `shell` in flight, but the
 * Host's prepared manifest grants no `shell` (AG2b work tools), so the Kernel
 * refuses it. This file uses a blocking stand-in for the granted `read` tool
 * instead: `read` is L3 row 1, `contained: true`, so RUN-25 applies and the
 * workspace capture is identical. The assertion is the capture, not the tool.
 */
import { chmod, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { toolSchema as z } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { CapturedPathV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { openWorkRoot, preparedOf, redrivePolicy } from './support/common.js';

// --- The stand-in `read` tool (blocks while armed). ------------------------
type ReadCall = { callId: string; arguments: unknown };

class ReadSeam {
  private armed = false;
  private gate: Promise<void> = Promise.resolve();
  private openGate: (() => void) | null = null;
  private waiters: Array<() => void> = [];
  readonly calls: ReadCall[] = [];

  get enabled(): boolean { return this.armed; }
  arm(): void {
    this.armed = true;
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
      name: 'read',
      description: 'K3 stand-in read (blocks until released)',
      inputSchema: z.object({ path: z.string() }).loose(),
      effectClass: 'read_only',
      requiredCapabilities: ['workspace_read'],
      independentReadOnly: false,
      defaultTimeoutMs: 15_000,
      outputLimitBytes: 32 * 1024,
      summarize: () => ({ paths: [], cwd: null, commandPreview: 'K3 read' }),
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
const seams = vi.hoisted(() => ({ readSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return {
    ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]): ToolDefinition =>
      (seams.readSeam as ReadSeam).definition(actual.createReadToolDefinition as never, workspace as never),
  };
});
const readSeam = new ReadSeam();
seams.readSeam = readSeam;

/**
 * K3 A.2: the artifact-body store seam. While armed, the two workspace-capture
 * content types (`workspace-baseline` on prepare, `workspace-change-capture` on
 * the RUN-25 capture) answer a store failure — a thrown error or the store's own
 * `rejected` result — while every other body call goes to the real SQLite store.
 * Failing the run-start baseline store leaves the prepared manifest with an
 * unavailable baseline, so the later capture has `baselineKnown: false`; failing
 * the capture store then exercises the two `storing the workspace capture failed`
 * branches that must report that flag, never a hard-coded `true`.
 */
const bodySeam = vi.hoisted(() => ({
  failure: null as null | 'throw' | 'reject',
  baselineContentType: 'application/vnd.platform.workspace-baseline+json',
  captureContentType: 'application/vnd.platform.workspace-change-capture+json',
}));
vi.mock('../../src/core/record-store/sqlite-body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/sqlite-body-store.js')>();
  return {
    ...actual,
    createSqliteRawArtifactStore: (path: string): ReturnType<typeof actual.createSqliteRawArtifactStore> => {
      const store = actual.createSqliteRawArtifactStore(path);
      return {
        put: async (input) => {
          const failure = bodySeam.failure;
          if (failure !== null
            && (input.contentType === bodySeam.baselineContentType
              || input.contentType === bodySeam.captureContentType)) {
            if (failure === 'throw') throw new Error('scenario body store failed this put');
            return { status: 'rejected', code: 'unavailable', reason: 'scenario body store failed this put' };
          }
          return store.put(input);
        },
        read: ref => store.read(ref),
        close: () => store.close(),
      };
    },
  };
});

afterEach(async () => {
  bodySeam.failure = null;
  readSeam.release();
  await cleanupScenarios();
  await cleanupRestart();
});

type CaseOptions = {
  /** Runs before `prepare` (the start baseline), on the scenario's own root. */
  before?: (root: string) => Promise<void>;
  /** Runs while the stand-in `read` call is in flight. */
  during?: (root: string) => Promise<void>;
  /** K3 A.2: arm the body-store seam (see `bodySeam`) for this case. */
  bodyStoreFailure?: 'throw' | 'reject';
  /** K3 A.2: after the restart, attest the unknown end so the entry builds the review record. */
  attest?: string;
};

const TRACKED = 'data/tracked.txt';
const trackedPath = (root: string): string => join(root, 'data', 'tracked.txt');

/** One case: prepare (with `before`), block a `read` call, apply `during`, crash, read the record. */
async function runCase(label: string, options: CaseOptions): Promise<{ review: UnknownCallReviewV1;
  report: Awaited<ReturnType<HostScenario['restart']>> }> {
  // A custom tracked file, NOT one `writeAG2bWorkspace` re-seeds on every Host
  // start (a missing `src/module.ts` is recreated by the restart, hiding case (一)).
  const h = await HostScenario.open({ gitWorkspace: { files: { 'data/tracked.txt': 'K3-40 baseline\n', 'README.md': '# K3-40\n' } },
    automation: redrivePolicy(false), check: 'pass' });
  bodySeam.failure = options.bodyStoreFailure ?? null;
  if (options.before !== undefined) await options.before(h.root);
  const toStart = await h.advance(h.select(label, AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
  const prepared = preparedOf(toStart.next);
  readSeam.arm();
  const model = createScriptedModel([{ kind: 'calls', calls: [
    { callId: `${label}-read`, name: 'read', args: { path: TRACKED } }] }]);
  const root = await openWorkRoot(h, model);
  let running: Promise<unknown> | null = null;
  let report: Awaited<ReturnType<HostScenario['restart']>>;
  try {
    running = root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: `${label}-start` });
    await Promise.race([
      readSeam.waitForCall(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`${label}: no read call entered the stand-in; model=${String(model.calls())}`)), 10_000);
      }),
    ]);
    if (options.during !== undefined) await options.during(h.root);
    report = await h.restart({ crash: true });
    if (options.attest !== undefined) {
      // K3 A.2: RUN-25's auto-cleanup is blocked by the failed capture, so the
      // person's attestation at the entry is what builds the review record; that
      // entry captures the workspace again through the same armed store seam.
      // The read seam stays armed: the unresolved call is still in flight in the
      // abandoned Host, so the Kernel turn still lists it and the draft is complete.
      const unknown = await readExecution(h.host, prepared.claim.runRef);
      const attested = await h.post<unknown>('executions/resolve-unknown', graphWrite(AG2B_SCOPE,
        { runRef: prepared.claim.runRef, reason: options.attest }, `${label}-attest`,
        [{ ref: prepared.claim.runRef, revision: unknown.run.revision }]));
      expect(attested).toMatchObject({ status: 'committed' });
    }
  } finally {
    readSeam.release();
    await running?.catch(() => undefined);
    await root.close();
  }
  const read = await h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read',
    plain(AG2B_SCOPE, { runRef: prepared.claim.runRef }));
  if (read.status !== 'ready') throw new Error(`${label}: the review record must be readable: ${JSON.stringify(read)}`);
  return { review: read.value, report };
}

function pathEntry(review: UnknownCallReviewV1, path: string): CapturedPathV1 | undefined {
  const workspace = review.workspace;
  if (workspace.status !== 'captured') throw new Error(`the capture must be readable: ${JSON.stringify(workspace)}`);
  return workspace.sample.find(entry => entry.path === path);
}

describe('K3 R1 workspace capture (K3-40)', () => {
  it('K3-40 (一): a tracked file deleted before the Run start and still absent is not in the capture', async () => {
    const { review, report } = await runCase('k3-40-absent', { before: async (root) => { await rm(trackedPath(root)); } });
    expect(report).toMatchObject({ report: { runs: [{ row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
      autoCleanup: { applied: true } }] } });
    expect(review.workspace).toMatchObject({ status: 'captured', runBaselineKnown: true });
    expect(pathEntry(review, TRACKED)).toBeUndefined();
  }, 180_000);

  it('K3-40 (二): a tracked file deleted before the start and rebuilt in flight is added', async () => {
    const { review } = await runCase('k3-40-rebuilt', {
      before: async (root) => { await rm(trackedPath(root)); },
      during: async (root) => { await writeFile(trackedPath(root), 'rebuilt in flight\n'); },
    });
    expect(pathEntry(review, TRACKED)).toEqual({ path: TRACKED, change: 'added' });
  }, 180_000);

  it('K3-40 (三): a file modified before the start and replaced by a symlink in flight is mode_changed', async () => {
    const { review } = await runCase('k3-40-symlink', {
      before: async (root) => { await writeFile(trackedPath(root), 'modified before the run\n'); },
      during: async (root) => {
        await rm(trackedPath(root));
        await symlink('target-that-does-not-matter', trackedPath(root));
      },
    });
    expect(pathEntry(review, TRACKED)).toEqual({ path: TRACKED, change: 'mode_changed' });
  }, 180_000);

  it('K3-40 (四): only the executable bit changed in flight is mode_changed', async () => {
    const { review } = await runCase('k3-40-mode', {
      during: async (root) => { await chmod(trackedPath(root), 0o755); },
    });
    expect(pathEntry(review, TRACKED)).toEqual({ path: TRACKED, change: 'mode_changed' });
  }, 180_000);

  it('K3-40 (五): only the content changed in flight is modified', async () => {
    const { review } = await runCase('k3-40-content', {
      during: async (root) => { await writeFile(trackedPath(root), 'content changed in flight\n'); },
    });
    expect(pathEntry(review, TRACKED)).toEqual({ path: TRACKED, change: 'modified' });
  }, 180_000);

  // K3 session 3 A.2 (Codex 4): the two capture-store failure branches must
  // report the capture's own `baselineKnown`, exactly as the success branch does.
  // The armed body-store seam fails the run-start baseline store, so the prepared
  // manifest records no usable baseline (`captured.baselineKnown === false`), and
  // then fails the capture store. The review record must show the failure with
  // `runBaselineKnown: false`; a hard-coded `true` flips this.
  it.each(['throw', 'reject'] as const)(
    'K3 A.2: a %s while storing the capture with a missing baseline reports runBaselineKnown false',
    async failure => {
      const { review } = await runCase(`k3-a2-${failure}`, { bodyStoreFailure: failure,
        attest: `K3 A.2: ${failure} while storing the capture, baseline missing` });
      expect(review.workspace).toMatchObject({
        status: 'unavailable', reason: 'read_failed', runBaselineKnown: false,
      });
    }, 180_000);
});
