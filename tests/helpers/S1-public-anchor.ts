/**
 * The slice-1 public archive path, shared.
 *
 * `tests/work-graph/S1-anomaly-owner.test.ts` (SV26–SV29) and the A8-3n
 * "closing unsupported" scenario reach an anomaly anchor through the same
 * production steps: the Run is claimed and really stopped through the formal
 * execution-result entry, the archive request is registered through the public
 * `requestSessionArchive` owner (its recorded receipt, never a fabricated one,
 * is what every step carries), and `finishSessionArchive` commits the line.
 *
 * This helper adds the slice-1 §2.6 workspace-capture step of the real
 * `SessionArchivePort.archiveLine`: the changed-file read is the production
 * `createArchiveChangedFilesReader`, and the test makes its Execution read fail
 * once (fault injection, not a stand-in reader). `unknownChangedFiles` in
 * `business/workflow/session-archive.ts` maps that rejected read to its real
 * `{ source: 'unknown', status: 'unavailable', reason }` anchor fact. The reason
 * is the spec's worst-case reason, so the rendered `改动无法确定` line keeps the
 * L20 worst case.
 *
 * The caller keeps the two Run-side steps (claim/enter and the formal stop or
 * RUN-20 reconcile) and the review fixture; this file owns the archive request,
 * the failing capture, and the archive drive.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type {
  ArchiveLineInput, ArchiveLineResultV1, SessionArchivePort,
} from '../../src/business/workflow/session-archive.js';
import type { SessionLifecyclePort } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { createArchiveChangedFilesReader } from '../../src/core/agent-runtime/session-anomaly-facts.js';

/**
 * The L20 worst-case changed-file reason: more than 60 UTF-16 units, so the
 * renderer's last text cap clips it to `…（已截断）`. It is fault-injection data
 * for the failing Execution read, never written into an anchor by hand.
 */
export const WORST_ANOMALY_REASON =
  '这次执行被归档中断，工作区里的改动无法从持久记录确定，可能混有别的执行的改动，请先看清当前状态再继续处理，不要把它当成没有改动。';

/** The real changed-file reader with its Execution read made to fail once per call. */
export function failingChangedFilesReader(reason: string = WORST_ANOMALY_REASON) {
  return createArchiveChangedFilesReader({
    executions: {
      async readExecution() {
        return { status: 'rejected' as const, code: 'unavailable' as const, reason };
      },
    } as never,
    // The rejected Execution read returns before either of these is touched.
    kernelStores: {} as never,
    workspaceHost: {} as never,
    now: () => '2026-10-07T10:00:00.000Z',
  });
}

export type PublicArchiveRequest = {
  sessionRef: SessionRef;
  reason: string;
  requestId: string;
  /** The Session revision the caller read; the only pin `archiveLine` accepts. */
  sessionRevision: number;
};

export function publicArchiveWrite(request: PublicArchiveRequest): GraphWrite<ArchiveLineInput> {
  return {
    input: { sessionRef: request.sessionRef, reason: request.reason, tasks: [], wait: null,
      confirmUnknownStopped: false },
    meta: { requestId: request.requestId,
      expected: [{ ref: { aggregateType: 'Session', ...request.sessionRef }, revision: request.sessionRevision }] },
  };
}

/**
 * Register the durable archive request through the public owner while the Run
 * still occupies the Session (the request pins that Run, so step 5 later has a
 * real Work execution to anchor). The Run is stopped by the caller afterwards.
 */
export async function registerPublicArchive(
  lifecycle: SessionLifecyclePort, ctx: CoreCallContext, request: PublicArchiveRequest,
): Promise<void> {
  const registered = await lifecycle.requestSessionArchive(ctx, publicArchiveWrite(request) as never);
  if (registered.status !== 'committed') {
    throw new Error(`the public archive request was not registered: ${JSON.stringify(registered)}`);
  }
  const recorded = registered.value.archiveRequest;
  if (recorded === null || recorded === undefined) throw new Error('the registered Session has no archive request');
}

/**
 * Continue the registered request through the real `archiveLine`: its step 5
 * reads the files with `failingChangedFilesReader` (the platform maps the
 * rejected read to `unknown/unavailable`), records the anchor through the real
 * anomaly owner, requeues the interrupted Task, and CAS-completes the archive.
 */
export async function drivePublicArchive(
  archive: Pick<SessionArchivePort, 'archiveLine'>, ctx: CoreCallContext, request: PublicArchiveRequest,
): Promise<ArchiveLineResultV1> {
  const result = await archive.archiveLine(ctx, publicArchiveWrite(request) as never);
  if (result.status !== 'ready' || result.value.state !== 'archived') {
    throw new Error(`the public archive did not complete: ${JSON.stringify(result)}`);
  }
  return result.value;
}
