/**
 * K3-35 (一) rework, part 2 (lead rulings 2, 3 and 6; Codex findings 2 and 5):
 * the reachable single-item case through the real R2 chain, with the manifest
 * read through the public `materials/open` route and the model's input asserted
 * from the scripted model's observed request — no direct database or
 * artifact-store open anywhere.
 *
 * A real `shell` call OVER 4 KiB of control characters and quotes, with a
 * 512-byte callId, is left in flight; the Host crashes and RUN-25 creates the
 * record. While the call is blocked the test really changes 200 workspace paths
 * of exactly 512 bytes, so the REAL workspace capture holds them. The Workflow
 * then really prepares the review round (reading the original Run's Kernel
 * `assistant.message_completed` tool-call arguments), the round really starts
 * and ends, and the real `settle_review` re-judges the truncated command.
 *
 * The 32-item owner-level record and the full trim/size rules live in
 * `tests/work-graph/K3-35-owner-manifest-trim.test.ts` (the Kernel runs at most
 * one `process` call that needs review per Run; `k3-multicall-facts.out.md`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { renderUnknownCallReviewZh } from '../../src/contracts/core/prepared-execution.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from '../scenarios/harness.js';
import { preparedManifestOf } from '../scenarios/support/brief.js';
import { preparedOf, redrivePolicy } from '../scenarios/support/common.js';
import { gitIn } from '../scenarios/support/git-workspace.js';
import { driveReviewUntil, openReviewWorkRoot } from '../scenarios/support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from '../scenarios/support/shell-work-root.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';

// --- The real R2 chain's process seams (the K3-05 shape) -------------------
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(..._args: unknown[]) { void _args; }
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(_root: string, _workspace: unknown, options?: Record<string, unknown>): Promise<unknown> {
      if (options?.['workspaceMode'] !== 'read_only') {
        return { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: only read-only probing' };
      }
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shellSeam = shellSeam;

const AT = '2026-10-16T00:00:00.000Z';
/** The row's worst-case changed-path sample: exactly 200 paths of 512 bytes. */
const LONG_PATH_COUNT = 200;

afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

/** Exactly 512 ASCII bytes, the L7 upper limit for a Kernel callId. */
function bigCallId(alias: number): string {
  return `k335-callid-${String(alias).padStart(2, '0')}-`.padEnd(512, 'q');
}

/**
 * A command over 4 KiB (UTF-8) made of quotes, backslashes and control
 * characters: `JSON.stringify` turns each `"` into 2 bytes and each `\u0001`
 * into 6, so the prepared manifest grows well beyond the raw text.
 */
function bigCommand(alias: number): string {
  return `echo #${String(alias)} ` + '"\\\u0001'.repeat(1400) + '\u0000tail';
}

/** One real workspace path of exactly 512 ASCII bytes (`a/b/c` = 200+1+200+1+110). */
function longPath(index: number): string {
  const a = `k335-${String(index).padStart(3, '0')}-`.padEnd(200, 'a');
  const b = 'b'.repeat(200);
  const c = `f-${String(index).padStart(3, '0')}`.padEnd(106, 'c') + '.txt';
  return `${a}/${b}/${c}`;
}

/** Creates and commits the 200 long paths, so the run-start baseline treats them as clean. */
function seedLongPaths(root: string): void {
  for (let index = 0; index < LONG_PATH_COUNT; index += 1) {
    const target = join(root, longPath(index));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `baseline-${String(index)}\n`);
  }
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-q', '-m', 'k3-35 long paths');
}

/** The real workspace change the crash capture sees: every long path modified. */
function modifyLongPaths(root: string): void {
  for (let index = 0; index < LONG_PATH_COUNT; index += 1) {
    writeFileSync(join(root, longPath(index)), `changed-${String(index)}\n`);
  }
}

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

describe('K3-35 (一) the real review round prepare', () => {
  it('K3-35 (一): a >4 KiB control-character shell command, a 512-byte callId and 200x512-byte real changed paths prepare through the real Workflow, the manifest opens publicly, carries no callId, and the round settles', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    seedLongPaths(h.root);
    const callId = bigCallId(1);
    const command = bigCommand(1) + ' real-r2';

    // --- A: the `shell` call in flight, closed by RUN-25. --------------------
    shellSeam.arm();
    const modelA = createScriptedModel([{ kind: 'calls', calls: [
      { callId, name: 'shell', args: { command } }] }]);
    const rootA = await openShellWorkRoot(h, modelA);
    let runningA: Promise<unknown> | null = null;
    let preparedA: ReturnType<typeof preparedOf>;
    try {
      const startA = await prepareOn(rootA, h.select('k3-35-a', AG2B_WORK_TASK_ID));
      preparedA = preparedOf(startA);
      runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-35-a-start' });
      await shellSeam.waitForCall();
      // The real workspace changes while the process call is blocked.
      modifyLongPaths(h.root);
      await h.restart({ crash: true });
    } finally {
      shellSeam.release();
      await runningA?.catch(() => undefined);
      await rootA.close();
    }

    const created = await reviewOf(h, preparedA.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value.status).toBe('pending_review');
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]!.kernel.callId).toBe(callId);
    expect(created.value.items[0]!.kind).toBe('process');
    // The REAL workspace capture holds 200 changed paths: the record keeps the
    // 50-path sample, the full 200-path list is in the capture Artifact.
    expect(created.value.workspace.status).toBe('captured');
    if (created.value.workspace.status !== 'captured') return;
    expect(created.value.workspace.changedCount).toBe(LONG_PATH_COUNT);
    expect(created.value.workspace.sample).toHaveLength(50);
    expect(created.value.workspace.sample.every(path => Buffer.byteLength(path.path, 'utf8') === 512)).toBe(true);
    expect(created.value.workspace.sample[0]!.path).toBe(longPath(0));

    // --- The review round is opened for real: prepare runs in the Workflow. ---
    const modelReview = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-35-review-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'the command finished before the crash',
          crashSuspicion: { verdict: 'unlikely', evidence: 'no trace of a crash' } } }] },
      { kind: 'text', text: 'the review round wrote its conclusion' },
    ]);
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    try {
      const startStop = await driveReviewUntil(reviewRoot, h.select('k3-35-review', AG2B_WORK_TASK_ID),
        performs('start'));
      const prepared = preparedOf(startStop.stopped);
      // The whole prepared manifest through the PUBLIC materials/open route
      // (never a direct SQLite/artifact-store open, ruling 6).
      const manifest = await preparedManifestOf(h, prepared.envelope.bundleRef);
      const manifestJson = JSON.stringify(manifest);
      expect(Buffer.byteLength(manifestJson, 'utf8')).toBeLessThanOrEqual(262_144);
      // The rendered review instruction (not the whole `input`, which also
      // carries the role/goal/task prefix) is held to the literal 65,536.
      expect(Buffer.byteLength(renderUnknownCallReviewZh(manifest.unknownCallReview!), 'utf8'))
        .toBeLessThanOrEqual(65_536);
      // D8: no Kernel callId anywhere; items carry only the alias.
      expect(manifestJson).not.toContain(callId);
      expect(manifestJson).not.toContain('k335-callid-');
      const item = manifest.unknownCallReview?.items[0];
      expect(item).toMatchObject({ alias: 1, toolName: 'shell', display: 'truncated' });
      expect(manifest.input).toContain('- #1 shell');
      expect(manifest.input).toContain('这条命令没有全文');
      // The full 200-path capture reached the assembler; the sample was trimmed
      // from the back and the omitted count agrees with the recorded count.
      const workspace = manifest.unknownCallReview!.workspace;
      expect(workspace.changedSample.length + workspace.changedOmitted).toBe(LONG_PATH_COUNT);
      expect(workspace.changedSample.length).toBeGreaterThan(0);
      expect(workspace.changedSample.every(path => Buffer.byteLength(path.path, 'utf8') === 512)).toBe(true);
      expect(workspace.changedSample[0]!.path).toBe(longPath(0));
      expect(manifest.input).toContain(longPath(0));
      expect(prepared.envelope.permissions.tools).toEqual(['read', 'run_readonly_command', 'record_unknown_call_review']);
      expect(prepared.envelope.permissions.writeScope).toEqual([]);

      // The round really starts and ends.
      await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-35-review-start' });
      const ended = await readExecution(h.host, prepared.claim.runRef);
      expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed' });

      // What the MODEL received, from the scripted model's observed request.
      expect(modelReview.requests.length).toBeGreaterThanOrEqual(1);
      const received = JSON.stringify(modelReview.requests);
      expect(received).toContain('这条命令没有全文');
      expect(received).toContain('- #1 shell');
      expect(received).toContain('echo #1');
    } finally {
      await reviewRoot.close();
    }

    // --- The real settle_review step (UCR-07/D6). ----------------------------
    const settled = await h.advance(h.select('k3-35-settle', AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
    expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');
    const afterSettle = await reviewOf(h, preparedA.claim.runRef);
    expect(afterSettle.status).toBe('ready');
    if (afterSettle.status !== 'ready') return;
    expect(afterSettle.value.items[0]!.observed).toMatchObject({ verdict: 'undetermined', by: 'settlement' });
  }, 240_000);
});
