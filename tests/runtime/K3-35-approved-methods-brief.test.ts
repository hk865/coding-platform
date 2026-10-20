/**
 * K3 group 4 session B3, K3-35 (二)(三) (L20 required part and its byte
 * budget): the continuation brief with ONE consistent public fact.
 *
 * The approved record, its eight real archived anchors and the continuation
 * basis all carry the record's own Task (`k3-20-a`); the prepared afterRun IS the
 * record's own Run (the ninth), read from the public store through the real
 * requeue/claim path, and the continuation Run is prepared by the production
 * preparation owner before its real Runtime entry.
 *
 * The real path leaves NO `### 异常锚点` section: each anchor is bound by the
 * next Run's real prepared `inputBinding.anomalyAnchorRefs` and is therefore
 * picked up. The L20 anomaly worst case stays in the pure-renderer test; this
 * file asserts the real prepared bytes (see the arithmetic in the test) on the
 * one process item the serial Kernel path really reaches.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  APPROVED_COMMAND, K3_35_REQUIRED_REVIEW_BLOCK_ONE, WORST_REASON, approvedMethodBlockBytes,
  openK3_35PublicRecord, type K3_35PublicRecord,
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

const NOT_LISTED = '- 不在变动清单里，不证明没做。';
const SENTENCE = '- 平台拦下原命令；要再跑先请求并得到允许。';
/**
 * The real T = 7 brief fits at the first text cap, so the one blocked-command
 * line is KEPT and nothing is omitted (the old 32-item T = 7 total described
 * the unreachable appended-start set).
 */
const BLOCKED_TITLE = '### 被拦的命令';
const BLOCKED_LINE = '- #1@00000000：被拦';
const PREPARED_SUMMARY = '这是任务 k3-20-a 的接续执行（返工）：第 9 次重新入队，失败类别：执行失败，发起方：人工。';

/** The canonical Kernel history cursor's own payload (position `i`, tail `u`). */
function cursorPayload(cursor: string): { i: number; u: number } {
  const payload = cursor.split('.')[1];
  if (payload === undefined) throw new Error(`not a canonical Kernel history cursor: ${cursor}`);
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { i: number; u: number };
}

describe.each(['memory', 'sqlite'] as const)('K3-35 (L20): the real continuation brief with the 5,120-byte method block (%s)', (kind) => {
  let facts: K3_35PublicRecord;

  // Building the world measured 1.0-1.6 s alone and with the other K3-35 files
  // beside it; 60 s keeps the 10 s default (and full-run contention) out of the
  // way without raising the global hookTimeout.
  beforeAll(async () => { facts = await openK3_35PublicRecord(kind); }, 60_000);
  afterAll(async () => { if (facts === undefined) return; await facts.close(); });

  it('uses the public record facts: one process method, one target, one blocked command', async () => {
    const review = facts.review;
    expect(review.status).toBe('resolved');
    expect(review.task).toEqual(facts.task);
    // Only the blocked `shell` call really started; the 31 later declarations
    // of the mixed batch never ran and are not appended facts.
    expect(review.items).toHaveLength(1);
    expect(review.items[0]).toMatchObject({ alias: 1, kind: 'process', toolName: 'shell' });
    expect(review.blockedCommands).toHaveLength(1);
    expect(review.blockedCommands[0]).toMatchObject({ alias: 1, reviewRunId: review.runRef.runId });
    expect(review.proposalTargets).toEqual([review.items[0]!.callId]);
    expect(review.dispositionTargets).toHaveLength(1);
    expect(review.itemsOmitted).toBe(0);
    // The record's own items come from the record Run's real Kernel Turn, not
    // appended stand-ins: the platform wrote the callId, Kernel identity and
    // arguments digest itself.
    expect(review.items).toHaveLength(1);
    expect(review.items[0]).toMatchObject({ kind: 'process', toolName: 'shell', callId: facts.processCallId });
    expect(review.items[0]!.kernel).toMatchObject({ callId: facts.processCallId });
    expect(review.items[0]!.argumentsDigest).toHaveLength(64);
    expect(Buffer.byteLength(facts.processCallId, 'utf8')).toBe(512);
    expect(review.disposition!.approvedMethods ?? []).toHaveLength(1);
    expect((review.disposition!.approvedMethods ?? []).at(0) ?? {}).toMatchObject({ alias: 1, cwd: null, command: APPROVED_COMMAND });
    expect((review.disposition!.text ?? '').length).toBe(2_000);
    expect(facts.section.blockedCommands).toEqual([
      { alias: 1, reviewRunId: review.runRef.runId, commandSha256: review.blockedCommands[0]!.commandSha256 },
    ]);
    // The eight anchors are REAL archived Runs on the record's own Task, each
    // with its own Run, and the changed-file read really failed.
    expect(facts.anchors).toHaveLength(8);
    expect(new Set(facts.anchors.map(anchor => anchor.runRef.runId)).size).toBe(8);
    expect(facts.anchors.every(anchor => anchor.task.taskId === facts.task.taskId)).toBe(true);
    expect(facts.anchors.every(anchor => anchor.changedFiles.status === 'unavailable'
      && anchor.changedFiles.source === 'unknown'
      && anchor.changedFiles.reason === WORST_REASON)).toBe(true);
    expect(facts.anchors.every(anchor => anchor.cause === 'archive_interrupted')).toBe(true);
    // A: every interrupted Run's booked boundary IS the last real Kernel
    // history entry — the same position and that entry's canonical cursor. The
    // old `observedThroughPosition + 1` / `k3-35-boundary-…` token fails the
    // `completedBoundary` canonical-cursor check (session-operations.ts:931).
    for (const anchor of facts.anchors) {
      const boundary = await facts.endBoundaryOf(anchor.runRef);
      expect(boundary.endPosition, `anchor ${anchor.runRef.runId}`).toBe(boundary.position);
      expect(boundary.entryPosition, `anchor ${anchor.runRef.runId}`).toBe(boundary.position);
      // The stored boundary cursor and the entry's own canonical cursor both
      // decode to the same Kernel identity and position (`l` is only the read
      // window's lower bound, so it legitimately differs between reads).
      const stored = cursorPayload(boundary.cursor);
      const entry = cursorPayload(boundary.entryCursor ?? '');
      expect(stored, `anchor ${anchor.runRef.runId}`).toMatchObject({ i: boundary.position, u: boundary.position });
      expect(entry, `anchor ${anchor.runRef.runId}`).toMatchObject({ i: boundary.position, u: boundary.position });
      expect(boundary.sessionCursor, `anchor ${anchor.runRef.runId}`).toBe(boundary.cursor);
    }
    expect(facts.original.run.executionHistory).not.toBeNull();
    // The command is <= 4,000 bytes; the 600 newlines' indentation adds 1,200:
    // 25 (header) + 3 (`\n  `) + 3,892 (command) + 1,200 = 5,120 exactly.
    expect(Buffer.byteLength(APPROVED_COMMAND, 'utf8')).toBe(3_892);
    expect((APPROVED_COMMAND.match(/\n/g) ?? [])).toHaveLength(600);
    expect(approvedMethodBlockBytes()).toBe(5_120);
  });

  it('K3-35 (二): prepare succeeds on the same Task and carries the required part verbatim', async () => {
    const prepared = await prepareWorstCase(facts);
    expect(prepared.result.status).toBe('ready');
    expect(prepared.input).not.toBeNull();
    const suffix = prepared.input!.slice(prepared.input!.indexOf('## 接续说明'));
    // The real T = 7 total, hand-summed from the rendered parts (never read
    // from the renderer): head 110 (15 + 95); body 1,706 = summary 126
    // (119 + T) + earlier requeues 309 + continuation Session 151 + previous
    // execution 199 + error 80 + end time 44 + headings 19+16+16+16+13
    // + position 55 + range 41 + no tools 38 + reason 46 + new input 118
    // + workspace 59+128+149+83; review 9,913 = required non-method 611
    // (title 43 + count 126 + disposition 314 + targets 22 + not-listed 44
    // + blocked sentence 62) + the 5,120-byte method string (its 601 line
    // breaks included) + the one optional conclusion 4,182; the kept blocked
    // section 41 (heading 19 + line 22); tail 357; joins 44 (45 elements - 1).
    // 110 + 1,706 + 9,913 + 41 + 357 + 44 = 12,171.
    expect(Buffer.byteLength(suffix, 'utf8')).toBe(12_171);
    expect(Buffer.byteLength(suffix, 'utf8')).toBeLessThanOrEqual(16_384);
    expect(suffix).toContain(PREPARED_SUMMARY);
    expect(requiredReviewBlock(suffix)).toBe(K3_35_REQUIRED_REVIEW_BLOCK_ONE);
    expect(suffix).toContain(BLOCKED_TITLE);
    expect(suffix).toContain(BLOCKED_LINE);
    expect(suffix).not.toContain('其余 1 行已省略');
    expect(suffix).not.toContain('### 异常锚点');
    expect(suffix.indexOf(NOT_LISTED)).toBeLessThan(suffix.indexOf(SENTENCE));
  });
});

/**
 * K3-35 (三): T = 600 is reachable through the same public steps; the new
 * `K3-35-T-by-hand.test.ts` proves the real 12,676 (T = 512) and 12,764
 * (T = 600) totals, both within 16,384 because the real path leaves no anomaly
 * section and the one blocked call fits at the first text cap. The pure
 * renderer keeps L20's anomaly bound.
 */
