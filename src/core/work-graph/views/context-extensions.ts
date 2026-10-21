/**
 * Spec §2.5, §4.2, L7-L9: the graph reader's optional
 * `extensions` provider. It reads the Goal's not-yet-picked-up anomaly anchors
 * as the Host (the graph reader has already authorized the caller's read of
 * this Goal), projects each into one deterministic reminder index row, and
 * leaves the other four extensions `not_implemented`. A read failure is
 * returned as the owner's real rejection, never turned into an empty row.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { isRecord } from '../../../contracts/validation/common.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../../contracts/prompts/platform-pack.generated.js';
import type { DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import type {
  ContextExtensionsV1, ContextIndexRowV1, ContextSourceV1, NotesUnderstandingRowV1,
} from '../../../contracts/graph-context.js';
import type { SessionAnomalyAnchorV1, SessionAnomalyViewV1 } from '../../../contracts/session-anomaly.js';
import type { ContextReadRequestV1 } from '../model/graph-context-contracts.js';
import type {
  DecisionCardV1,
  DecisionQueueReadV1,
  DecisionReadPort,
  GoalSettingsPort,
} from '../model/decision-contracts.js';
import type { SessionAnomalyPort } from '../tasks/session-anomaly-service.js';
import { sessionAnomalyRefKey } from '../tasks/session-anomaly-codecs.js';
import type { NoteMemoryMaterialPort, NoteMemoryMaterialV1 } from '../model/note-contracts.js';

export type ContextExtensionsDependencies = {
  anomalies: Pick<SessionAnomalyPort, 'listSessionAnomalies'>;
  hostActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  goalSettings?: Pick<GoalSettingsPort, 'readGoalSettings'>;
  decisions?: Pick<DecisionReadPort, 'queryDecisionQueue'>;
  /** U8: the one memory-material read per assembly, when wired. */
  memoryMaterial?: NoteMemoryMaterialPort;
  /** The page width of the decision-queue read (default DECISION_PAGE_LIMIT = 100). */
  decisionPageLimit?: number;
};

/** The anchor owner's own scan budget (spec §4.2, L8): 100 per page, at most 25
 * pages. The provider adds no failure boundary of its own. */
const LOOKUP_PAGE_LIMIT = 100;
const LOOKUP_MAX_PAGES = 25;

/** §4.3.5: the seven formal card source kinds; notice categories never hint here. */
const CARD_SOURCE_KINDS: readonly DecisionSourceV1['kind'][] = [
  'message', 'goal_cause', 'candidate', 'note_review', 'planning_question', 'goal_conflict', 'message_release',
];

/** §4.3.1: 100 per page. 2A §0.4 row 1 removes the 50-page / 5,000-card cap;
 * only this page size stays (P6). */
const DECISION_PAGE_LIMIT = 100;

type TaskTriple = { aggregateType: 'Task'; projectId: string; goalId: string; taskId: string };

/** The formal Task designation `{aggregateType:'Task',projectId,goalId,taskId}`, or null. */
function taskTripleOf(ref: unknown): TaskTriple | null {
  if (!isRecord(ref) || ref['aggregateType'] !== 'Task') return null;
  const { projectId, goalId, taskId } = ref;
  if (typeof projectId !== 'string' || typeof goalId !== 'string' || typeof taskId !== 'string') return null;
  return { aggregateType: 'Task', projectId, goalId, taskId };
}

/** §4.3.3: the formal Task designations of one card, from source pins and objects. */
function taskTriplesOf(card: DecisionCardV1): TaskTriple[] {
  const byKey = new Map<string, TaskTriple>();
  const consider = (ref: unknown): void => {
    const triple = taskTripleOf(ref);
    if (triple !== null) byKey.set(canonicalJson(triple as unknown as JsonValue), triple);
  };
  for (const pin of card.source.pins) consider(pin.ref);
  for (const object of card.objects) {
    if (object.kind === 'aggregate') consider(object.pin.ref);
  }
  return [...byKey.values()];
}

/**
 * §4.3.4: only a pin that is a real `AggregateRef` at revision > 0 becomes a
 * record source. `Task` is a designation, not an `AggregateRef` member
 * (`contracts/ledger.ts`), and production only ever builds `Task@0`
 * (`goal-decision-reader.ts:taskPin`); the `revision <= 0` guard already skips
 * that form. The explicit Task check is therefore a defensive guard that never
 * fires for any owner-produced pin, rather than a general Task@0 exception.
 */
function recordSourcesOf(pins: DecisionCardV1['source']['pins']): ContextSourceV1[] {
  const byKey = new Map<string, ContextSourceV1>();
  for (const pin of pins) {
    if (pin.revision <= 0) continue;
    if (!isRecord(pin.ref)) continue;
    if (taskTripleOf(pin.ref) !== null) continue;
    const source: ContextSourceV1 = { kind: 'record', ref: pin.ref, revision: pin.revision, digest: null };
    byKey.set(canonicalJson(source as unknown as JsonValue), source);
  }
  return [...byKey.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map((entry) => entry[1]);
}

/**
 * §4.3.3-§4.3.5: the deterministic decision index. Focus filtering keeps
 * Goal-level cards and cards whose same-Goal Task designation matches a focus
 * task; absent card sources get their explicit hint line. A repeated key with
 * different content is a conflict, never an arbitrary winner.
 */
function decisionRows(
  cards: readonly DecisionCardV1[],
  capabilities: DecisionQueueReadV1['capabilities'],
  request: ContextReadRequestV1,
): { rows: ContextIndexRowV1[] } | { conflict: string } {
  const focus = new Set(request.focusTaskIds);
  const rows: ContextIndexRowV1[] = [];
  for (const card of cards) {
    const tasks = taskTriplesOf(card);
    if (focus.size > 0 && tasks.length > 0
      && !tasks.some((task) => task.projectId === request.goalRef.projectId
        && task.goalId === request.goalRef.goalId && focus.has(task.taskId))) {
      continue;
    }
    rows.push({
      key: `decision:${card.cardKey}`,
      node: { kind: 'goal', ref: request.goalRef },
      text: `${PLATFORM_PROMPT_PACK_V1.strings['contextExtension.decisionPrefix']}${card.source.kind}${PLATFORM_PROMPT_PACK_V1.strings['contextExtension.sourceSeparator']}${card.source.key}`,
      sources: recordSourcesOf(card.source.pins),
    });
  }
  for (const capability of capabilities) {
    if (!CARD_SOURCE_KINDS.includes(capability.source as DecisionSourceV1['kind'])) continue;
    if (capability.availability !== 'not_available') continue;
    rows.push({
      key: `decision:not_available:${capability.source}`,
      node: { kind: 'goal', ref: request.goalRef },
      text: `${PLATFORM_PROMPT_PACK_V1.strings['contextExtension.unavailablePrefix']}${capability.source}`,
      sources: [],
    });
  }
  const byKey = new Map<string, ContextIndexRowV1>();
  for (const row of rows) {
    const existing = byKey.get(row.key);
    if (existing === undefined) {
      byKey.set(row.key, row);
      continue;
    }
    if (canonicalJson(existing as unknown as JsonValue) !== canonicalJson(row as unknown as JsonValue)) {
      return { conflict: row.key };
    }
  }
  return {
    rows: [...byKey.values()].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
  };
}

/** A `not_implemented` extension with no rows, fresh for every result. */
function notImplemented(): { availability: 'not_implemented'; rows: ContextIndexRowV1[] } {
  return { availability: 'not_implemented', rows: [] };
}

/** §11.4/U-1: the `notes` member's empty `not_implemented` value (CA14). */
function emptyNotes(): ContextExtensionsV1['notes'] {
  return {
    availability: 'not_implemented',
    understanding: { rows: [], norms: [], normsOmitted: 0 },
    general: [],
  };
}

function rejection(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** L9: the one deterministic index line for an anchor, never UI wording. */
function anchorText(anchor: SessionAnomalyAnchorV1): string {
  const interruption = anchor.cause === 'retired_archive'
    ? PLATFORM_PROMPT_PACK_V1.strings['contextExtension.interruption.retiredArchive']
    : PLATFORM_PROMPT_PACK_V1.strings['contextExtension.interruption.archive'];
  return `${PLATFORM_PROMPT_PACK_V1.strings['contextExtension.anchorPrefix']}${anchor.task.taskId}${PLATFORM_PROMPT_PACK_V1.strings['contextExtension.anchorRunSeparator']}${anchor.runRef.runId} ${interruption}${PLATFORM_PROMPT_PACK_V1.strings['contextExtension.anchorSuffix']}`;
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
    const decisionPageLimit = deps.decisionPageLimit ?? DECISION_PAGE_LIMIT;
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

    // Step 4b (§11.4/U8): one memory-material read per assembly, when the port
    // is wired. Only the context-assembly path passes `includeInputs` (work
    // true, query false); `lookGraph`/`findGraph` leave it undefined and must
    // never pay for the material (§11.7). A missing port or a look/find request
    // stays `not_implemented` (CA14); a real failure is the port's own
    // rejection, never a fabricated empty row.
    let notes: ContextExtensionsV1['notes'];
    if (deps.memoryMaterial === undefined || request.includeInputs === undefined) {
      notes = emptyNotes();
    } else {
      let materialRead: ReadResult<NoteMemoryMaterialV1>;
      try {
        materialRead = await deps.memoryMaterial.readMemoryMaterial(hostCtx, {
          goalId: request.goalRef.goalId,
          taskId: request.focusTaskIds[0] ?? null,
          // Ruling 9 (verifier "missed 3"): a Query (`includeInputs === false`)
          // wants understanding + norms only. The read model then skips the
          // related scope and the general part entirely.
          includeInputs: request.includeInputs === true,
        });
      } catch (error) {
        return rejection('unavailable', `memory_material_read_failed: ${messageOf(error)}`);
      }
      if (materialRead.status !== 'ready') {
        return materialRead.status === 'rejected' && materialRead.code === 'unsupported'
          ? rejection('unavailable', materialRead.reason)
          : materialRead;
      }
      const material = materialRead.value;
      const rows = [material.projectUnderstanding, ...material.localUnderstanding]
        .filter((row): row is NotesUnderstandingRowV1 => row !== null);
      notes = {
        availability: 'available',
        understanding: { rows, norms: material.norms, normsOmitted: material.normsOmitted },
        general: material.general,
      };
    }

    // Step 4: only anchors nobody has picked up become a row; rows are ordered
    // by key. An anchor may also appear in a continuation brief (§4.3), which
    // is allowed: this is only an index line, never a second body text.
    const rows = collected
      .filter(item => item.pickedUpBy === null)
      .map(anchorRow)
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

    // Step 5 (§4.2/I-4): the Goal's saved autonomy through the owner. A missing
    // port is `not_implemented`; a real read failure fails the whole read.
    let goalSettings: ContextExtensionsV1['goalSettings'];
    if (deps.goalSettings === undefined) {
      goalSettings = { availability: 'not_implemented', autonomy: null };
    } else {
      let settingsRead;
      try {
        settingsRead = await deps.goalSettings.readGoalSettings(hostCtx, { goalRef: request.goalRef });
      } catch (error) {
        return rejection('unavailable', `goal_settings_read_failed: ${messageOf(error)}`);
      }
      if (settingsRead.status === 'not_found') return { status: 'not_found' };
      if (settingsRead.status === 'not_ready') {
        return rejection('incomplete', 'goal_settings_not_ready: the Goal settings are not readable at the required watermark');
      }
      if (settingsRead.status !== 'ready') return settingsRead;
      goalSettings = { availability: 'available', autonomy: settingsRead.value.settings.autonomy };
    }

    // Step 6 (§4.3/I-6): page the current Goal's waiting-answer cards. The
    // provider reads only that section and never caches a partial queue.
    let decisions: ContextExtensionsV1['decisions'];
    if (deps.decisions === undefined) {
      decisions = notImplemented();
    } else {
      const cards: DecisionCardV1[] = [];
      let capabilities: DecisionQueueReadV1['capabilities'] = [];
      let sourceCursor: DecisionQueueReadV1['sourceCursor'] | null = null;
      let cursor: string | undefined;
      try {
        for (;;) {
          const read = await deps.decisions.queryDecisionQueue(hostCtx, {
            workspace: { projectId, workspaceId },
            goalRef: request.goalRef,
            sections: ['waiting_answer'],
            page: cursor === undefined
              ? { limit: decisionPageLimit }
              : { limit: decisionPageLimit, cursor },
          });
          if (read.status === 'not_found') return { status: 'not_found' };
          if (read.status === 'not_ready') {
            return rejection('incomplete', 'decision_queue_not_ready: the decision queue is not readable at the required watermark');
          }
          if (read.status !== 'ready') return read;
          if (sourceCursor === null) {
            sourceCursor = read.value.sourceCursor;
            capabilities = read.value.capabilities;
          } else if (read.value.sourceCursor !== sourceCursor) {
            return rejection('unavailable', 'decision_queue_window_changed: the decision queue pages did not share one ledger window');
          }
          for (const card of read.value.waitingAnswer) {
            if (card.state !== 'waiting_answer') continue;
            cards.push(card);
          }
          const next = read.value.nextCursor;
          if (next === null) break;
          cursor = next;
        }
      } catch (error) {
        return rejection('unavailable', `decision_queue_read_failed: ${messageOf(error)}`);
      }
      const projected = decisionRows(cards, capabilities, request);
      if ('conflict' in projected) {
        return rejection('unavailable', `decision_index_conflict: the decision index has conflicting rows for ${projected.conflict}`);
      }
      decisions = { availability: 'available', rows: projected.rows };
    }
    // Step 7: the wired anomalies, goal settings and decisions index.
    return { status: 'ready', value: {
      notes,
      anomalies: { availability: 'available', rows },
      footprint: notImplemented(),
      goalSettings,
      decisions,
    } };
  };
}
