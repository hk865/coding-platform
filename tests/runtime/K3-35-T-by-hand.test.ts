/**
 * K3-35 (二)(三) on the reachable T = 512 / T = 600 facts through the REAL path.
 *
 * The record, the eight archived anchors, the continuation basis and the
 * continuation Run all carry ONE Task whose `taskId` is exactly `'t'.repeat(T)`.
 * That Task is adopted through the real Plan owner; the eight anchors are real
 * interrupted Runs (production `prepare` + production `startRun`, then the
 * scripted model's `beforeReply` fault, which the production Runtime turns into
 * `run_crashed`), archived through the public `archiveLine` path with the
 * injected failing changed-file reader; the continuation Run comes from the
 * public requeue/claim path and is prepared by the production preparation owner
 * before its real Runtime entry.
 *
 * The REAL path leaves NO `### 异常锚点` section here: every anchor is bound by
 * the NEXT Run's real prepared `inputBinding.anomalyAnchorRefs`, so by the
 * continuation all eight are picked up. That is the fact these totals measure.
 * The renderer's anomaly near-limit / over-limit cases stay in
 * `K3-35-renderer-boundary.test.ts` as pure constructed input.
 *
 * The record item/observation is the platform's: the Kernel runs a non-read-only
 * batch one call at a time, so the record Run's blocked `shell` call is the ONLY
 * call that really started and the production draft lists exactly one item. The
 * 32-item extreme stays in the pure renderer test.
 *
 * Hand arithmetic (T = 512) on that one-process-item record; the renderer is
 * never the source of an expectation, the section bytes are hand-derived:
 *   head 110 (15 + 95);
 *   body 2,211 = summary 631 (119 + T) + earlier requeues 309 (5x36 + 129)
 *     + continuation Session 151 (72 + 79) + previous execution 199
 *     (36 + 72 + 91) + error 80 + end time 44 + headings 19+16+16+16+13
 *     + position 55 + range 41 + no tools 38 + reason 46 + new input 118
 *     (64-byte digest + 54) + workspace 59+128+149+83;
 *   review 9,913 = required non-method 611 (title 43 + count 126
 *     + disposition 314 + targets 22 + not-listed 44 + blocked sentence 62)
 *     + the 5,120-byte method string (25 + 600x7 + 294, its 601 line breaks
 *     included) + the one optional conclusion 4,182 (#1 at the first text cap);
 *   the kept blocked section 41 (heading 19 + line 22); tail 357;
 *   joins 44 (45 rendered elements - 1; the method string holds its own 601
 *   line breaks inside the 5,120).
 *   110 + 2,211 + 9,913 + 41 + 357 + 44 = 12,676 bytes, 3,708 under 16,384.
 * T = 600 adds 88 (the Task id appears once, in the summary) = 12,764.
 *
 * The real one-item brief fits at the first text cap, so the blocked-command
 * section is KEPT and no omission note is rendered (the old 32-item 14,567 /
 * 14,655 comments described the unreachable appended-start set).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  APPROVED_COMMAND, K3_35_REQUIRED_REVIEW_BLOCK_ONE, openK3_35PublicRecord,
  type K3_35PublicRecord,
} from '../helpers/K3-35-continuation-fixture.js';
import { prepareWorstCase } from '../helpers/K3-35-prepare.js';
import { requiredReviewBlock } from '../helpers/K3-continuation-pure-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
// The §5.1 shell stand-in and the KE6 sandbox probe (no host process runs).
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

afterEach(() => { shellSeam.release(); });

const TASK_512 = 't'.repeat(512);
const TASK_600 = 't'.repeat(600);

function suffixOf(input: string): string {
  return input.slice(input.indexOf('## 接续说明'));
}

describe.each(['memory', 'sqlite'] as const)('K3-35 (二) T = 512 through the public steps (%s)', (kind) => {
  let facts: K3_35PublicRecord;
  // Building the world measured 1.0-1.6 s alone and with the other K3-35 files
  // beside it; 60 s keeps the 10 s default (and full-run contention) out of the
  // way without raising the global hookTimeout.
  beforeAll(async () => { facts = await openK3_35PublicRecord(kind, { taskIdBytes: 512 }); }, 60_000);
  afterAll(async () => { if (facts === undefined) return; await facts.close(); });

  it('builds one public fact on a 512-byte Task with 8 unique archived anchors and one blocked command', () => {
    expect(facts.task.taskId).toBe(TASK_512);
    expect(Buffer.byteLength(facts.task.taskId, 'utf8')).toBe(512);
    expect(facts.review.task).toEqual(facts.task);
    expect(facts.review.blockedCommands).toHaveLength(1);
    expect(facts.review.blockedCommands[0]).toMatchObject({ alias: 1, reviewRunId: facts.review.runRef.runId });
    // The real serial batch reached exactly the one blocked process call.
    expect(facts.review.items).toHaveLength(1);
    expect(facts.review.items[0]!.kind).toBe('process');
    expect(facts.review.items[0]!.toolName).toBe('shell');
    // The platform's real `captureWorkspace` ran: the old `not_configured`
    // default (a missing capture dependency) is gone. The fixture directory is
    // not a git work tree, so the platform records its own refusal reason.
    expect(facts.review.workspace).toMatchObject({ status: 'unavailable', reason: 'not_git' });
    expect((facts.review.disposition!.approvedMethods ?? [])[0]).toMatchObject({ command: APPROVED_COMMAND });
    expect(facts.section.blockedCommands).toHaveLength(1);
    expect(facts.anchors).toHaveLength(8);
    expect(new Set(facts.anchors.map(anchor => anchor.runRef.runId)).size).toBe(8);
    expect(facts.anchors.every(anchor => anchor.task.taskId === facts.task.taskId)).toBe(true);
    expect(facts.anchors.every(anchor => anchor.changedFiles.status === 'unavailable'
      && anchor.changedFiles.source === 'unknown')).toBe(true);
    expect(facts.anchors.every(anchor => anchor.cause === 'archive_interrupted')).toBe(true);
    // The record's ninth Run was entered by the production Runtime (its entry
    // facts exist) and resolved by the real RUN-20/RUN-22 owners.
    expect(facts.original.run.executionAuthorization).toBeDefined();
    expect(facts.original.run.executionHistory).not.toBeNull();
    expect(facts.original.run).toMatchObject({ status: 'ended', outcome: 'crashed' });
  });

  it('prepare succeeds within 16,384 with the whole required part verbatim and the real T = 512 total', async () => {
    const prepared = await prepareWorstCase(facts);
    expect(prepared.result.status).toBe('ready');
    expect(prepared.input).not.toBeNull();
    const suffix = suffixOf(prepared.input!);
    expect(Buffer.byteLength(suffix, 'utf8')).toBe(12_676);
    expect(Buffer.byteLength(suffix, 'utf8')).toBeLessThanOrEqual(16_384);
    expect(requiredReviewBlock(suffix)).toBe(K3_35_REQUIRED_REVIEW_BLOCK_ONE);
    // The one-item brief fits at the first text cap: the blocked command stays
    // and nothing is omitted.
    expect(suffix).toContain('### 被拦的命令');
    expect(suffix).not.toContain('其余 1 行已省略');
    // The real-path fact: the eight anchors are all picked up by later real
    // prepared bindings, so the continuation brief has no anomaly section.
    expect(suffix).not.toContain('### 异常锚点');
    expect(facts.anchors).toHaveLength(8);
  });
});

describe.each(['memory', 'sqlite'] as const)('K3-35 (三) T = 600 through the same public steps (%s)', (kind) => {
  let facts: K3_35PublicRecord;
  beforeAll(async () => { facts = await openK3_35PublicRecord(kind, { taskIdBytes: 600 }); }, 60_000);
  afterAll(async () => { if (facts === undefined) return; await facts.close(); });

  it('builds the same public fact on a 600-byte Task', () => {
    expect(facts.task.taskId).toBe(TASK_600);
    expect(Buffer.byteLength(facts.task.taskId, 'utf8')).toBe(600);
    expect(facts.review.blockedCommands).toHaveLength(1);
    expect(facts.review.items).toHaveLength(1);
    expect(facts.anchors).toHaveLength(8);
  });

  it('prepare succeeds with the real T = 600 total: 88 bytes more than T = 512, still under the cap', async () => {
    const prepared = await prepareWorstCase(facts);
    expect(prepared.result.status).toBe('ready');
    if (prepared.result.status !== 'ready') throw new Error('unreachable');
    const suffix = suffixOf(prepared.input!);
    // 12,676 + (600 - 512) = 12,764: the Task id occurs once, in the summary.
    expect(Buffer.byteLength(suffix, 'utf8')).toBe(12_764);
    expect(Buffer.byteLength(suffix, 'utf8')).toBeLessThanOrEqual(16_384);
    expect(requiredReviewBlock(suffix)).toBe(K3_35_REQUIRED_REVIEW_BLOCK_ONE);
    expect(suffix).toContain('### 被拦的命令');
    expect(suffix).not.toContain('### 异常锚点');
  });
});
