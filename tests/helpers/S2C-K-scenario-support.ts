/**
 * Group K1's shared LE4 Host-scenario support (slice 2C, spec §5.1 LE4; P8).
 *
 * Everything here is a thin typed reader/writer over the REAL Host routes on the
 * existing KE3 framework (`tests/scenarios/harness.ts`: `openHostScenario`,
 * `restart()`, `direct()`). No record is written directly and no existing
 * helper/harness file is edited (L-scope). Group K2 imports this file; a change
 * goes through the coordinator to K1 (P8).
 *
 * Files it builds data with (all public services / real routes):
 * - `lines/list`, `lines/archived`, `lines/read`, `lines/page` route readers;
 * - `sessions/read` for a Session card (lifecycle/health/occupancy);
 * - a maintenance pass through the composition root `direct()` (the clock the
 *   harness opens it with is `2026-10-06`, eight days after the Host's
 *   `2026-09-28`, so a line finished on the Host clock is past the one-day
 *   executor archive threshold).
 */
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WorkLineConversationPageV1, TaskExecutionRecord } from '../../src/app/core-http-types.js';
import type {
  ArchivedLinePageV1, LineControlKindV1, LineControlV1, LineRowV1, WorkLineDetailV1,
  WorkLineListV1, WorkLineSectionPageV1,
} from '../../src/contracts/work-line.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { hostCtx, type HostScenario } from '../scenarios/harness.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';

/** `lines/read` can answer the line or name its two branch heads (spec §2). */
export type LineDetailRead = WorkLineDetailV1 | { kind: 'branched'; heads: SessionRef[] };

/** A `lines/page` answer: one WorkGraph section, or the Host-composed conversation. */
export type LinePageRead = WorkLineSectionPageV1 | WorkLineConversationPageV1;

/** A page request for `lines/archived` and `lines/page`; `limit` defaults to 100 (the maximum). */
export type LinePageRequest = { limit?: number; cursor?: string };

// ---------------------------------------------------------------------------
// Route readers (LE4, the real Host route layer)
// ---------------------------------------------------------------------------

/** `lines/list` through the live Host. */
export function lineList(h: HostScenario): Promise<ReadResult<WorkLineListV1>> {
  return h.post<ReadResult<WorkLineListV1>>('lines/list', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE }));
}

/** `lines/archived` through the live Host; `limit` defaults to 100. */
export function lineArchived(h: HostScenario, page: LinePageRequest = {}): Promise<ReadResult<ArchivedLinePageV1>> {
  return h.post<ReadResult<ArchivedLinePageV1>>('lines/archived',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, page: { limit: page.limit ?? 100, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) } }));
}

/** `lines/read` for any Session of a line (the head or a predecessor). */
export function lineRead(h: HostScenario, key: SessionRef): Promise<ReadResult<LineDetailRead>> {
  return h.post<ReadResult<LineDetailRead>>('lines/read', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, key }));
}

/** `lines/page` for one WorkGraph section (`participation`, `messages`, `copies`, `executions`). */
export function lineSection(h: HostScenario, key: SessionRef, section: WorkLineSectionPageV1['section'],
  page: LinePageRequest = {}): Promise<ReadResult<WorkLineSectionPageV1>> {
  return h.post<ReadResult<WorkLineSectionPageV1>>('lines/page',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, key, section, page: { limit: page.limit ?? 100, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) } }));
}

/** `lines/page`'s Host-composed `conversation` section (L12; needs group L/W's conversation wiring). */
export function lineConversation(h: HostScenario, key: SessionRef, page: LinePageRequest = {}): Promise<ReadResult<WorkLineConversationPageV1>> {
  return h.post<ReadResult<WorkLineConversationPageV1>>('lines/page',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, key, section: 'conversation', page: { limit: page.limit ?? 100, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) } }));
}

// ---------------------------------------------------------------------------
// Ready unwrapping and line lookup
// ---------------------------------------------------------------------------

/** Unwraps a ready `ReadResult`; a rejection/incomplete fails the calling test with `what`. */
export function ready<T>(result: ReadResult<T>, what: string): T {
  if (result.status !== 'ready') throw new Error(`${what}: expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

/** The one active line whose head or chain contains `sessionId`. */
export function lineContaining(list: WorkLineListV1, sessionId: string): LineRowV1 | undefined {
  return list.rows.find(row => row.key.sessionId === sessionId
    || row.chainSessions.some(session => session.sessionId === sessionId));
}

/** The active line headed by `sessionId` (`undefined` when it is not a head). */
export function lineOf(list: WorkLineListV1, sessionId: string): LineRowV1 | undefined {
  return list.rows.find(row => row.key.sessionId === sessionId);
}

/** The active line containing `sessionId`; fails the test when there is none. */
export function requireLine(list: WorkLineListV1, sessionId: string, what = 'the active line'): LineRowV1 {
  const row = lineContaining(list, sessionId);
  if (row === undefined) throw new Error(`${what}: no active line contains ${sessionId}`);
  return row;
}

/** The archived line whose head or chain contains `sessionId`. */
export function archivedLineContaining(page: ArchivedLinePageV1, sessionId: string): LineRowV1 | undefined {
  return page.rows.find(row => row.key.sessionId === sessionId
    || row.chainSessions.some(session => session.sessionId === sessionId));
}

/** The archived line headed by `sessionId`. */
export function archivedLineOf(page: ArchivedLinePageV1, sessionId: string): LineRowV1 | undefined {
  return page.rows.find(row => row.key.sessionId === sessionId);
}

/** The control of `kind` on a line row, if the reader listed it (§3.10). */
export function controlOf(row: LineRowV1, kind: LineControlKindV1): LineControlV1 | undefined {
  return row.controls.find(control => control.kind === kind);
}

/** The control of `kind`; fails the test when the reader did not list it. */
export function requireControl(row: LineRowV1, kind: LineControlKindV1, what = 'the line control'): LineControlV1 {
  const control = controlOf(row, kind);
  if (control === undefined) throw new Error(`${what}: the line lists no ${kind} control`);
  return control;
}

// ---------------------------------------------------------------------------
// Session reads
// ---------------------------------------------------------------------------

/** The SessionRef of a session record/ref shape (projectId + sessionId). */
export function sessionRefOf(ref: { projectId: string; sessionId: string }): SessionRef {
  return { projectId: ref.projectId, sessionId: ref.sessionId };
}

/** `sessions/read` through the live Host (the public Session card). */
export async function sessionCard(h: HostScenario, ref: SessionRef): Promise<TaskExecutionRecord['session']> {
  const answer = await h.post<ReadResult<{ record: TaskExecutionRecord['session'] }>>('sessions/read', plain(AG2B_SCOPE, ref));
  return ready(answer, `sessions/read ${ref.sessionId}`).record;
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/** The goal-level `select_work` input the Host's own re-drive uses. */
export function maintenanceSelect(flowId: string): WorkflowAdvanceInput {
  return { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId, sessionHint: null, kind: 'select_work' };
}

/**
 * Runs the Workflow's maintenance page through the composition root
 * (`direct()`) and stops before the next `perform` step (the root has no
 * Runtime, so a `start`/`run` step is never driven here). The `direct()` root
 * runs on the harness's `2026-10-06` clock, after the Host's `2026-09-28`, so
 * an executor line that finished on the Host clock is past the one-day archive
 * threshold (spec §3.6 A2, 2C-05 (1)). Returns the last performed step.
 */
export async function runMaintenance(h: HostScenario, flowId: string): Promise<Extract<WorkflowAdvanceResult, { status: 'ready' }>['value']> {
  const platform = await h.direct();
  let current = maintenanceSelect(flowId);
  for (let step = 0; step < 32; step += 1) {
    const result = await platform.workflow.advanceWork(hostCtx(), current);
    if (result.status !== 'ready') throw new Error(`the maintenance step was not ready: ${JSON.stringify(result)}`);
    const value = result.value;
    if (value.next === null || value.next.kind === 'perform') return value;
    current = value.next;
  }
  throw new Error('the maintenance drive did not settle or reach a perform step');
}

// ---------------------------------------------------------------------------
// Writes (the existing routes the line controls submit to)
// ---------------------------------------------------------------------------

/** A `graph_write` envelope for the existing routes over the AG2b scope. */
export function lineWrite(input: unknown, requestId: string, expected: unknown[] = []): unknown {
  return graphWrite(AG2B_SCOPE, input, requestId, expected);
}
