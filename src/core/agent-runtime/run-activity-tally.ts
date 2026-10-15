/**
 * Slice 2B L6: the pure Turn tally.
 *
 * `tallyTurnActivity` reads one already-decoded Kernel Turn plus an explicit
 * window and returns `RunActivityFactsV1`. It is deterministic, calls no model
 * and performs no I/O: the same records always yield the same facts (decision 49,
 * lead answer 03). `unresolvedCalls` is computed from the raw window exactly as
 * L1 defines it (P5); `turnTerminal` is the reduced Turn's status inside the same
 * window (L4).
 */
import {
  ACTIVITY_QUARTER_CAP,
  FILE_EDIT_TOOL_NAMES,
  RUN_ACTIVITY_RULE_VERSION,
  RUN_CHANGED_FILES_CAP,
  RUN_USAGE_REQUESTS_CAP,
} from '../../contracts/run-activity.js';
import type {
  ActivityQuarterV1,
  ActivityTotalsV1,
  RunActivityBound,
  RunActivityFactsV1,
  RunModelUsageRequestV1,
} from '../../contracts/run-activity.js';
import type { AgentEvent } from '../../../vendor/coding-agent/dist/public-api.js';
import type { KernelExecutionBinding } from '../work-graph/model/execution-entry-contracts.js';
import { reduceTurnFromStart } from './kernel-turn-facts.js';
import type { DecodedKernelRecord } from './kernel-turn-facts.js';

/** The Kernel statuses L6/L4 treat as a terminal Turn (K part A adds `interrupted`). */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'cancelled', 'limit_exceeded', 'failed', 'yielded', 'interrupted']);

/** One started call, taken from its `tool.started` (F3: the call is committed before effects). */
type StartedCall = { callId: string; name: string; arguments: Record<string, unknown>; at: string };

/** L2: a call is placed in the 15-minute UTC quarter of its `tool.started`. */
function quarterStart(at: string): string {
  const millis = Date.parse(at);
  return new Date(millis - (millis % (15 * 60 * 1000))).toISOString();
}

function isTurnStart(record: DecodedKernelRecord, kernel: KernelExecutionBinding): boolean {
  if (record.record.recordType !== 'turn.started') return false;
  const run = (record.record.payload as unknown as { run?: { runId?: string; turn?: { turnId?: string } } }).run;
  return run?.runId === kernel.runId && run.turn?.turnId === kernel.turnId;
}

/** L1 row 4: the completed edit's own output proves the two workspace revisions are equal. */
function outputRevisionsEqual(output: readonly unknown[]): boolean {
  for (const part of output) {
    if (typeof part !== 'object' || part === null) continue;
    const candidate = part as { kind?: unknown; value?: unknown };
    if (candidate.kind !== 'json' || typeof candidate.value !== 'object' || candidate.value === null) continue;
    const value = candidate.value as Record<string, unknown>;
    if (typeof value['oldRevision'] === 'string' && typeof value['newRevision'] === 'string') {
      return value['oldRevision'] === value['newRevision'];
    }
  }
  return false;
}

/** L1 row 1: the `tool.started` arguments prove a replace writes the same text back. */
function argumentsProveSameText(call: StartedCall): boolean {
  if (call.name !== 'edit') return false;
  const args = call.arguments;
  return args['mode'] === 'replace' && typeof args['oldText'] === 'string' && typeof args['newText'] === 'string'
    && args['oldText'] === args['newText'];
}

/** L3: changed paths are ordered by their UTF-8 bytes. */
function byBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/**
 * F6/F8, L3: a started shell is only `command_ran` when it reached execution. A
 * settled result whose effects are `sideEffect: 'none'` is a pre-execution
 * dispatcher refusal (`sandbox_unavailable`, `invalid_arguments`,
 * `permission_denied`, `unknown_tool`, `approval_denied`, F6) or a cancellation
 * before the command started (F8); no command ran. A shell whose result is
 * `tool.outcome_unknown` or never arrived still counts as having run.
 */
function refusedBeforeExecution(result: AgentEvent | undefined): boolean {
  if (result === undefined) return false;
  const payload = result.payload as { result?: { effects?: { sideEffect?: string } } };
  return payload.result?.effects?.sideEffect === 'none';
}

/** L2: the quarters beyond the cap are kept only as totals and their first/last time. */
function omittedOverflow(omitted: readonly ActivityQuarterV1[]): ActivityTotalsV1 & { firstAt: string; lastAt: string } {
  let steps = 0;
  let edits = 0;
  let editsUnknown = 0;
  for (const quarter of omitted) {
    steps += quarter.steps;
    edits += quarter.edits;
    editsUnknown += quarter.editsUnknown;
  }
  const first = omitted[0]!;
  const last = omitted[omitted.length - 1]!;
  return { steps, edits, editsUnknown, firstAt: first.at, lastAt: last.at };
}

export function tallyTurnActivity(records: readonly DecodedKernelRecord[], kernel: KernelExecutionBinding,
  window: { fromPosition: number; throughPosition: number; bound: RunActivityBound }): RunActivityFactsV1 {
  const inWindow = records.filter((record) => record.position <= window.throughPosition);
  const start = inWindow.find((record) => isTurnStart(record, kernel));
  if (start === undefined) {
    return { status: 'unknown', ruleVersion: RUN_ACTIVITY_RULE_VERSION, reason: 'turn_not_found',
      detail: `no turn.started for run ${kernel.runId} turn ${kernel.turnId} in positions <= ${window.throughPosition}` };
  }
  const turnStartedAt = start.record.recordedAt;
  let lastRecordAt = turnStartedAt;
  const events: { position: number; event: AgentEvent }[] = [];
  for (const record of inWindow) {
    if (record.record.recordType !== 'agent.event' || record.position <= start.position) continue;
    const event = record.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    events.push({ position: record.position, event });
    lastRecordAt = record.record.recordedAt;
  }

  const reduced = reduceTurnFromStart(inWindow, kernel);
  const turnTerminal = reduced !== null && TERMINAL_STATUSES.has(reduced.status);

  const started = new Map<string, StartedCall>();
  const settled = new Map<string, AgentEvent>();
  const unknownResult = new Set<string>();
  const requestStarts: { requestId: string; at: string }[] = [];
  const usageByRequest = new Map<string, { inputTokens: number; outputTokens: number; cachedInputTokens: number; costUsdMicros: number | null }[]>();
  for (const item of events) {
    const event = item.event;
    if (event.type === 'tool.started') {
      const call = (event.payload as { call: { callId: string; name: string; arguments: Record<string, unknown> } }).call;
      started.set(call.callId, { ...call, at: event.meta.occurredAt });
    } else if (event.type === 'tool.completed' || event.type === 'tool.failed' || event.type === 'tool.cancelled') {
      const callId = (event.payload as { callId: string }).callId;
      settled.set(callId, event);
    } else if (event.type === 'tool.outcome_unknown') {
      unknownResult.add((event.payload as { callId: string }).callId);
    } else if (event.type === 'model.request_started') {
      requestStarts.push({ requestId: (event.payload as { requestId: string }).requestId, at: event.meta.occurredAt });
    } else if (event.type === 'model.usage_recorded') {
      const recorded = event.payload as { requestId: string; delta: { inputTokens: number; outputTokens: number;
        cachedInputTokens: number; costUsdMicros: number | null } };
      const deltas = usageByRequest.get(recorded.requestId) ?? [];
      deltas.push(recorded.delta);
      usageByRequest.set(recorded.requestId, deltas);
    }
  }

  let steps = 0;
  let edits = 0;
  let editsUnknown = 0;
  const definite = new Set<string>();
  const possible = new Set<string>();
  const quarterTotals = new Map<string, ActivityQuarterV1>();
  let commandRan = false;
  const addToQuarter = (at: string, callEdits: number, callEditsUnknown: number): void => {
    const quarter = quarterStart(at);
    const current = quarterTotals.get(quarter) ?? { at: quarter, steps: 0, edits: 0, editsUnknown: 0 };
    current.steps += 1;
    current.edits += callEdits;
    current.editsUnknown += callEditsUnknown;
    quarterTotals.set(quarter, current);
  };
  for (const [callId, call] of started) {
    steps += 1;
    // L3: only a shell that reached execution marks `command_ran`; a started
    // shell the dispatcher refused before execution (effects `none`, F6) did not
    // run. Resolve the settled result once so the edit rule below can reuse it.
    const settledResult = settled.get(callId);
    if (call.name === 'shell' && !refusedBeforeExecution(settledResult)) commandRan = true;
    let callEdits = 0;
    let callEditsUnknown = 0;
    if ((FILE_EDIT_TOOL_NAMES as readonly string[]).includes(call.name)
      && !argumentsProveSameText(call)) {
      const result = settledResult;
      if (unknownResult.has(callId) || result === undefined) {
        callEditsUnknown = 1;
        const path = call.name === 'edit' && typeof call.arguments['path'] === 'string' ? call.arguments['path'] : null;
        if (path !== null) possible.add(path);
      } else {
        const payload = result.payload as { result: { output: readonly unknown[]; effects: {
          sideEffect: string; changedPaths: readonly string[]; workspaceRevision: string | null } } };
        const outputProvesSame = call.name === 'edit' && result.type === 'tool.completed'
          && outputRevisionsEqual(payload.result.output);
        if (!outputProvesSame) {
          const effects = payload.result.effects;
          const nonDot = effects.changedPaths.filter((path) => path !== '.');
          if (effects.sideEffect === 'confirmed') {
            if (nonDot.length > 0) {
              callEdits = 1;
              for (const path of nonDot) definite.add(path);
            }
          } else if (effects.sideEffect === 'possible') {
            if (effects.changedPaths.length > 0) {
              callEditsUnknown = 1;
              for (const path of effects.changedPaths) possible.add(path);
            } else if (!(call.name === 'shell' && effects.workspaceRevision !== null)) {
              callEditsUnknown = 1;
            }
          }
        }
      }
    }
    edits += callEdits;
    editsUnknown += callEditsUnknown;
    addToQuarter(call.at, callEdits, callEditsUnknown);
  }

  const sortedQuarters = [...quarterTotals.values()].sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));
  const quarters = sortedQuarters.slice(0, ACTIVITY_QUARTER_CAP);
  const overflow = sortedQuarters.length > ACTIVITY_QUARTER_CAP
    ? omittedOverflow(sortedQuarters.slice(ACTIVITY_QUARTER_CAP))
    : null;

  const definiteSorted = [...definite].sort(byBytes);
  const possibleSorted = [...possible].sort(byBytes);
  const definiteKept = definiteSorted.slice(0, RUN_CHANGED_FILES_CAP);
  const possibleKept = possibleSorted.slice(0, RUN_CHANGED_FILES_CAP);
  const definiteOmitted = definiteSorted.length - definiteKept.length;
  const possibleOmitted = possibleSorted.length - possibleKept.length;

  const incompleteBecause: ('command_ran' | 'edits_unknown' | 'cap')[] = [];
  if (commandRan) incompleteBecause.push('command_ran');
  if (editsUnknown > 0) incompleteBecause.push('edits_unknown');
  if (definiteOmitted > 0 || possibleOmitted > 0) incompleteBecause.push('cap');

  const requests: RunModelUsageRequestV1[] = [];
  for (const start of requestStarts) {
    const deltas = usageByRequest.get(start.requestId) ?? [];
    if (deltas.length === 0) {
      requests.push({ requestId: start.requestId, startedAt: start.at, usageStatus: 'unknown',
        inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsdMicros: null });
      continue;
    }
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    const costs: number[] = [];
    for (const delta of deltas) {
      inputTokens += delta.inputTokens;
      outputTokens += delta.outputTokens;
      cachedInputTokens += delta.cachedInputTokens;
      if (delta.costUsdMicros !== null) costs.push(delta.costUsdMicros);
    }
    requests.push({ requestId: start.requestId, startedAt: start.at, usageStatus: 'reported',
      inputTokens, outputTokens, cachedInputTokens,
      costUsdMicros: costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0) });
  }
  const keptRequests = requests.slice(0, RUN_USAGE_REQUESTS_CAP);
  const omittedUsage = requests.length - keptRequests.length;
  let usageComplete = omittedUsage === 0;
  const usageTotals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  for (const request of keptRequests) {
    if (request.usageStatus === 'unknown') {
      usageComplete = false;
      continue;
    }
    usageTotals.inputTokens += request.inputTokens ?? 0;
    usageTotals.outputTokens += request.outputTokens ?? 0;
    usageTotals.cachedInputTokens += request.cachedInputTokens ?? 0;
  }

  return {
    status: 'counted',
    ruleVersion: RUN_ACTIVITY_RULE_VERSION,
    window: { kernelRunId: kernel.runId, kernelTurnId: kernel.turnId, fromPosition: window.fromPosition,
      throughPosition: window.throughPosition, bound: window.bound, turnTerminal,
      unresolvedCalls: [...started.keys()].filter((callId) => !settled.has(callId)).length,
      turnStartedAt, lastRecordAt },
    quarters,
    overflow,
    totals: { steps, edits, editsUnknown },
    changedFiles: { definite: definiteKept, possible: possibleKept,
      definiteOmitted, possibleOmitted,
      possiblyIncomplete: incompleteBecause.length > 0, incompleteBecause },
    usage: { requests: keptRequests, omitted: omittedUsage, totals: usageTotals, complete: usageComplete },
  };
}
