/**
 * Wiring package 1, I-3 (spec §2.5, §4.2, L7-L9): the graph reader's optional
 * `extensions` provider. It reads the Goal's not-yet-picked-up anomaly anchors
 * as the Host (the graph reader has already authorized the caller's read of
 * this Goal), projects each into one deterministic reminder index row, and
 * leaves the other four extensions `not_implemented`. A read failure is
 * returned as the owner's real rejection, never turned into an empty row.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { ContextExtensionsV1, ContextIndexRowV1 } from '../../../contracts/graph-context.js';
import type { SessionAnomalyAnchorV1, SessionAnomalyViewV1 } from '../../../contracts/session-anomaly.js';
import type { ContextReadRequestV1 } from '../model/graph-context-contracts.js';
import type { SessionAnomalyPort } from '../tasks/session-anomaly-service.js';
import { sessionAnomalyRefKey } from '../tasks/session-anomaly-codecs.js';

export type ContextExtensionsDependencies = {
  anomalies: Pick<SessionAnomalyPort, 'listSessionAnomalies'>;
  hostActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
};

/** The anchor owner's own scan budget (spec §4.2, L8): 100 per page, at most 25
 * pages. The provider adds no failure boundary of its own. */
const LOOKUP_PAGE_LIMIT = 100;
const LOOKUP_MAX_PAGES = 25;

/** A `not_implemented` extension with no rows, fresh for every result. */
function notImplemented(): { availability: 'not_implemented'; rows: ContextIndexRowV1[] } {
  return { availability: 'not_implemented', rows: [] };
}

function rejection(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** L9: the one deterministic index line for an anchor, never UI wording. */
function anchorText(anchor: SessionAnomalyAnchorV1): string {
  const interruption = anchor.cause === 'retired_archive' ? '因线退役被归档中断' : '被归档中断';
  return `中断，待核对：任务 ${anchor.task.taskId} 的执行 ${anchor.runRef.runId} ${interruption}，改动没撤销也没核对`;
}

function anchorRow(item: SessionAnomalyViewV1): ContextIndexRowV1 {
  const { anchor } = item;
  return {
    key: `anomaly:${sessionAnomalyRefKey(anchor.ref)}`,
    node: { kind: 'task', ref: anchor.task, planRef: anchor.planRef },
    text: anchorText(anchor),
    sources: [{ kind: 'record', ref: anchor.ref, revision: 1, digest: null }],
  };
}

export function createContextExtensionsReader(deps: ContextExtensionsDependencies):
  (ctx: CoreCallContext, request: ContextReadRequestV1) => Promise<ReadResult<ContextExtensionsV1>> {
  return async (ctx, request) => {
    // Step 1: the provider needs a bound project/workspace context with a
    // signal, and the request must name this project. All of these refuse
    // before the owner is called.
    const projectId: unknown = ctx.projectId;
    const workspaceId: unknown = ctx.workspaceId;
    const signal: AbortSignal | undefined = ctx.signal;
    if (typeof projectId !== 'string' || projectId.length === 0
      || typeof workspaceId !== 'string' || workspaceId.length === 0 || signal === undefined) {
      return rejection('forbidden', 'the context extensions need a bound project/workspace context');
    }
    if (request.goalRef.projectId !== projectId) {
      return rejection('forbidden', 'the context extensions need a bound project/workspace context');
    }
    if (signal.aborted) return rejection('cancelled', 'the context extensions read was cancelled');

    // Step 2: the anchor owner is Host-only. Rebuild the SAME scope with the
    // injected Host actor and the caller's signal, exactly as the graph reader
    // builds its own internal Host context.
    const hostCtx: CoreCallContext = {
      projectId,
      workspaceId,
      principal: { kind: 'host', actor: deps.hostActor },
      materialReader: { kind: 'host', projectId, workspaceId, actor: deps.hostActor },
      signal,
    };

    // Step 3: page the Goal's anchors under the owner's own 25-page budget. A
    // rejection is returned unchanged; a throw is the provider's `unavailable`.
    const collected: SessionAnomalyViewV1[] = [];
    let cursor: string | null = null;
    try {
      for (let page = 0; page < LOOKUP_MAX_PAGES; page++) {
        const read = await deps.anomalies.listSessionAnomalies(hostCtx, {
          goalRef: request.goalRef,
          page: cursor === null ? { limit: LOOKUP_PAGE_LIMIT } : { limit: LOOKUP_PAGE_LIMIT, cursor },
        });
        if (read.status === 'not_found') return { status: 'not_found' };
        if (read.status === 'not_ready') {
          return rejection('incomplete', 'the Goal anomaly anchors are not readable at the required watermark');
        }
        if (read.status !== 'ready') return read;
        collected.push(...read.value.items);
        cursor = read.value.nextCursor;
        if (cursor === null) break;
      }
    } catch (error) {
      return rejection('unavailable', `the anomaly anchor read failed: ${messageOf(error)}`);
    }
    if (cursor !== null) {
      return rejection('incomplete', 'anomaly_index_page_limit: the Goal anomaly anchors did not fit the 25-page read budget');
    }

    // Step 4: only anchors nobody has picked up become a row; rows are ordered
    // by key. An anchor may also appear in a continuation brief (§4.3), which
    // is allowed: this is only an index line, never a second body text.
    const rows = collected
      .filter(item => item.pickedUpBy === null)
      .map(anchorRow)
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

    // Step 5: the wired anomalies index; the other four extensions stay
    // explicitly unimplemented (I-4/I-6 wire goalSettings/decisions later).
    return { status: 'ready', value: {
      notes: notImplemented(),
      anomalies: { availability: 'available', rows },
      footprint: notImplemented(),
      goalSettings: { availability: 'not_implemented', autonomy: null },
      decisions: notImplemented(),
    } };
  };
}
