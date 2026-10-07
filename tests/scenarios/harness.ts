/**
 * A.2 step 6 scenario harness (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步", §11.11, §12.10).
 *
 * One scenario is one SQLite ledger and Kernel store in a temporary directory,
 * one workspace root and a scripted model; no real model is ever called. The
 * Goal is the AG2b seed (tests/helpers/AG2b-collaboration-fixture.ts): the
 * required work Tasks plus the Goal gate, one obligation, one registered static
 * check. Two ways to drive it share everything else:
 *
 * - host mode (`openHostScenario`): the real Host over HTTP, with its start-up
 *   reconcile and re-drive. `restart()` closes the Host (HL-06) or abandons it
 *   as a crash (its lock rewritten to an exited pid, HL-03; its held model call
 *   stays held) and starts a new Host on the same files, as the restart
 *   scenarios (tests/scenarios/A8-host-restart*.test.ts) do.
 *   `direct()` opens the composition root on the same files for owner calls as
 *   the automation or an agent, which no route accepts; `startPeer()` starts a
 *   second live Host without the lease (HL-02).
 * - platform mode (`openPlatformScenario`): the composition root in process,
 *   for the in-memory seams a Host has no route for (`registerWorkflowBinding`,
 *   `registerCheckConfiguration`). `restart()` closes and reopens it on the same
 *   files; the start-up reconcile is the Host's, so use host mode for it.
 *
 * Both modes count model calls across restarts (a restarted instance continues
 * the script at the next unused reply), read the Kernel and ledger files for
 * write counts, drive the Workflow with a step cap and check the §11
 * invariants (`assertInvariants`, over tests/state/invariants.ts) after every
 * Workflow step with a receipt (with the step's `FuzzStep`, so the step-local
 * clauses run) and after every restart. Call `cleanupScenarios` from
 * `afterEach`. A group that needs more help code puts it in
 * tests/scenarios/support/<group>.ts.
 *
 * Crash points (§12.10 step 2; lead ruling on the foundation QUESTION 2). The
 * Host exposes neither its timers nor its SQLite handle, so a crash abandons the
 * running Host: it keeps its HTTP server, its in-memory lease and drivers, and
 * any running check process, until `drainAbandoned()` or the cleanup closes it.
 * That stands in for §12.10's crash only when nothing of it runs on: the crash
 * point must be a held model call (`holdReply`), or a point between Workflow
 * steps with no background driver running (this Host configuration runs no
 * timers). A model call the abandoned Host starts after the crash is refused at
 * once and recorded (`abandonedCalls()`; never counted by `modelCalls()`, never
 * given a reply); its late ledger writes are refused by the records the
 * reconcile wrote (VR-04).
 *
 * One more rule for host mode: the invariant check after a step reads every
 * write since the previous check. With the start-up re-drive (or any other
 * background driver) running, wait for it to settle (`waitFor`) before
 * stepping, or its writes are judged as part of the step.
 */
import { expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_TOKEN_HEADER, type HostReconcileReportV1, type WorkbenchActor } from '../../src/app/core-http-types.js';
import { SETTINGS_API_PREFIX, type HostSettingsSnapshot, type SettingsResponse } from '../../src/app/host-settings-types.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, WORKFLOW_AUTOMATION_ACTOR, type TaskAutomationPolicyV1,
} from '../../src/contracts/task-requeue.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { GoalDisplayRead, TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { createScriptedModel, type ScriptedModel, type ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import {
  AG2B_CHECK_COMMAND, AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_QUERY_INSTRUCTION, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_INSTRUCTION,
  AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, AG2B_WORK_TASK_ID, ag2bChecksConfiguration, cleanupAG2b, permissionRevision, plain,
  seedAG2bWorkGraph, seedAG2bWorkGraphThrough, startAG2bHost, writeAG2bWorkspace, type AG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  answer, cleanupRestart, deferred, post, publicDirectory, tempDir, writeAutomationSettings, writeStaleLock, type AdvanceValue, type Deferred,
} from '../helpers/A2-restart-fixture.js';
import {
  checkAllInvariants, invariantStoreOf, legacyFindings, readInvariantWorld, type FuzzStep, type FuzzStepKind, type InvariantWorld,
} from '../state/invariants.js';

export type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;

/** The default Host actor of the AG2b fixture: an operator (`human` class). */
export const SCENARIO_OPERATOR: WorkbenchActor = { kind: 'human', id: 'ag2b-operator' };
const SKILLS_ROOT = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));

// ---------------------------------------------------------------------------
// Checks, script and counters (both modes)
// ---------------------------------------------------------------------------

/**
 * The one registered check (`ag2b-static`, all Tasks):
 * - `result_file` (default): PASS only while `src/ag2b-result.txt` holds the
 *   AG2b result text (what a scripted `edit` writes), else exit 3 (FAIL);
 * - `pass` / `fail`: exit 0 / exit 1 whatever the workspace holds;
 * - `{ timeoutAfterMs }`: the process sleeps past its timeout (< 4 s), so the
 *   check ends INCONCLUSIVE `process_timed_out`;
 * - `{ command }`: any other command (timeout 30 s unless given). `kind` (platform
 *   mode only) registers it under another requirement kind than `static`, so it
 *   covers no requirement of the seeded obligation (`verification_uncovered`).
 *
 * Every mode builds the configuration with the fixture's `ag2bChecksConfiguration`, revision
 * `ag2b-checks@<n>`: n = 1 at the start, +1 for every check change (`registerCheck`, a host
 * `restart({ check })` with another check), so staleness by configuration revision (LA-4) follows.
 */
export type CheckKind = TrustedCheckConfiguration['checks'][number]['kind'];
export type CheckBehaviour = 'result_file' | 'pass' | 'fail' | { timeoutAfterMs: number }
  | { command: string; timeoutMs?: number; kind?: CheckKind };

export function checkCommandOf(check: CheckBehaviour = 'result_file'): { command: string; timeoutMs: number; kind: CheckKind } {
  if (check === 'result_file') return { command: AG2B_CHECK_COMMAND, timeoutMs: 30_000, kind: 'static' };
  if (check === 'pass') return { command: 'node -e "process.exit(0)"', timeoutMs: 30_000, kind: 'static' };
  if (check === 'fail') return { command: 'node -e "process.exit(1)"', timeoutMs: 30_000, kind: 'static' };
  if ('timeoutAfterMs' in check) {
    if (check.timeoutAfterMs >= 4_000) throw new Error('a timing-out check sleeps 5 s, so its timeout must be under 4 s');
    return { command: 'sleep 5', timeoutMs: check.timeoutAfterMs, kind: 'static' };
  }
  return { command: check.command, timeoutMs: check.timeoutMs ?? 30_000, kind: check.kind ?? 'static' };
}

/** The configuration revision of check change `revision` (1 at the start). */
export function checkRevisionOf(revision: number): string {
  return `ag2b-checks@${revision}`;
}

function checksConfiguration(actor: WorkbenchActor, check: CheckBehaviour, revision: number): TrustedCheckConfiguration {
  const { command, timeoutMs, kind } = checkCommandOf(check);
  return ag2bChecksConfiguration({ actor, command, timeoutMs, kind, revision: checkRevisionOf(revision) });
}

export type ScenarioScript = {
  /**
   * Work-role replies in global order; a restarted instance continues after the
   * last call made so far. A call held when its Host was abandoned (a crash)
   * counts as made: its reply is never delivered, so the script still lists one
   * for that index.
   */
  replies?: readonly ScriptedReply[];
  /** Runs inside work model call `index` (0-based over every live instance), before its reply. */
  duringReply?: (index: number, request: ModelRequest) => Promise<void>;
  /** Query-role replies (host mode: the derived consultation child and Queries), global order as well. */
  queryReplies?: readonly ScriptedReply[];
};

/** A work model call held before its reply: `reached` settles when the call arrives. */
export type HeldReply = { reached: Promise<ModelRequest>; release(): void; fail(reason?: string): void };

/** A model call an abandoned Host started after its crash (refused at once, no reply). */
export type AbandonedCall = { instance: number; role: 'work' | 'query'; request: ModelRequest };

/**
 * Write counts read from the files, for "0 calls, 0 writes" assertions (`expect(h.counts()).toEqual(before)`):
 * - `modelCalls`: work and query provider requests of every live and peer instance (refused abandoned calls excluded);
 * - `kernelRecords`, `kernelTurnsStarted`: `session_records` rows (all, `turn.started`);
 * - `kernelSessionRevisions`: the sum of `sessions.revision` (the Kernel session header, `active_run_id`/`active_turn_id`);
 * - `kernelCheckpoints`: `checkpoints` rows (insert, prune and `deleteInvalid` all change it);
 * - `ledgerEvents`: `events` rows of the ledger;
 * - `checksBegun`: `VerificationCheckBegun` events: a check process starts only after a begun ticket (§12.10 step 4).
 * A Kernel store moved aside (`moveKernelAside`) reads as empty.
 */
export type ScenarioCounts = {
  modelCalls: number;
  kernelRecords: number;
  kernelTurnsStarted: number;
  kernelSessionRevisions: number;
  kernelCheckpoints: number;
  ledgerEvents: number;
  checksBegun: number;
};

/** One Kernel session as the frozen Kernel store holds it (byte-level comparison, A8-3l step 5). */
export type KernelSessionSnapshot = {
  sessionId: string;
  revision: number;
  activeRunId: string | null;
  activeTurnId: string | null;
  records: number;
  /** sha256 of every `record_json` of the session in `position` order. */
  recordsDigest: string;
};
export type KernelSnapshot = { sessions: KernelSessionSnapshot[]; checkpoints: number };

/** Reads one SQLite file with its own connection (the Host's stays untouched); a missing file reads `empty`. */
export function readSqlite<T>(path: string, read: (database: DatabaseSync) => T, empty: T): T {
  if (!existsSync(path)) return empty;
  const database = new DatabaseSync(path, { readOnly: true });
  try { return read(database); } finally { database.close(); }
}

/** A store's ledger event types in commit order (none without the file). */
export function eventTypesIn(database: string): string[] {
  return readSqlite(join(database, 'ledger.sqlite'), ledger => (ledger.prepare('SELECT event_json FROM events ORDER BY id')
    .all() as Array<{ event_json: string }>).map(row => (JSON.parse(row.event_json) as { eventType: string }).eventType), []);
}

/** `ScenarioCounts` without the model calls. */
export type FileCounts = Omit<ScenarioCounts, 'modelCalls'>;

function tablesOf(database: DatabaseSync): Set<string> {
  return new Set((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
    .map(row => row.name));
}

/**
 * The write counts of a store's files (`ScenarioBase.counts()`, or a moved case's own files): ledger events and
 * begun checks; Kernel records, Turn starts, the sum of the Kernel Session header revisions and the checkpoints
 * (a Kernel store moved aside, or an empty one a reader opened in its place, reads as 0).
 */
export function fileCounts(database: string): FileCounts {
  const events = eventTypesIn(database);
  const counts: FileCounts = { kernelRecords: 0, kernelTurnsStarted: 0, kernelSessionRevisions: 0, kernelCheckpoints: 0,
    ledgerEvents: events.length, checksBegun: events.filter(type => type === 'VerificationCheckBegun').length };
  return readSqlite(join(database, 'kernel.sqlite'), (kernel) => {
    const tables = tablesOf(kernel);
    if (tables.has('session_records')) {
      const rows = kernel.prepare('SELECT record_type AS type, COUNT(*) AS n FROM session_records GROUP BY record_type')
        .all() as Array<{ type: string; n: number }>;
      counts.kernelRecords = rows.reduce((sum, row) => sum + Number(row.n), 0);
      counts.kernelTurnsStarted = Number(rows.find(row => row.type === 'turn.started')?.n ?? 0);
    }
    if (tables.has('sessions')) {
      counts.kernelSessionRevisions = Number((kernel.prepare('SELECT COALESCE(SUM(revision), 0) AS n FROM sessions').get() as { n: number }).n);
    }
    if (tables.has('checkpoints')) {
      counts.kernelCheckpoints = Number((kernel.prepare('SELECT COUNT(*) AS n FROM checkpoints').get() as { n: number }).n);
    }
    return counts;
  }, counts);
}

type Instance = {
  work: ScriptedModel;
  query: ScriptedModel | null;
  /** `live`: the scenario's Host or platform (it consumes the script); `peer`: a second Host with no replies. */
  role: 'live' | 'peer';
  abandoned: boolean;
  refused: { work: number; query: number };
};

type Hold = { reached: Deferred<ModelRequest>; gate: Deferred; settled: boolean; reachedBy: number | null };

/** The model hooks of one instance, created before the instance starts (its index is reserved). */
type InstanceHooks = {
  index: number;
  replies: ScriptedReply[];
  beforeReply: (request: ModelRequest, local: number, signal: AbortSignal) => Promise<void>;
  queryReplies: ScriptedReply[];
  queryBeforeReply: (request: ModelRequest, local: number, signal: AbortSignal) => Promise<void>;
};

/** The script state shared by every instance of one scenario. */
class ScriptState {
  private readonly instances: Instance[] = [];
  /** Instances whose index `hooks` handed out and that are not registered yet. */
  private reserved = 0;
  private readonly holds = new Map<number, Hold>();
  readonly abandonedCalls: AbandonedCall[] = [];
  constructor(readonly script: ScenarioScript) {}

  private madeWork(instance: Instance): number { return instance.work.calls() - instance.refused.work; }
  private madeQuery(instance: Instance): number { return (instance.query?.calls() ?? 0) - instance.refused.query; }
  /** The global work script offset: the calls every live instance made. */
  private liveWorkCalls(): number {
    return this.instances.filter((instance) => instance.role === 'live').reduce((sum, instance) => sum + this.madeWork(instance), 0);
  }
  private liveQueryCalls(): number {
    return this.instances.filter((instance) => instance.role === 'live').reduce((sum, instance) => sum + this.madeQuery(instance), 0);
  }
  /** Every call made by a live or peer instance (refused abandoned calls excluded). */
  modelCalls(): number { return this.instances.reduce((sum, instance) => sum + this.madeWork(instance) + this.madeQuery(instance), 0); }
  requests(): ModelRequest[] {
    const refused = new Set(this.abandonedCalls.map((call) => call.request));
    return this.instances.filter((instance) => instance.role === 'live').flatMap((instance) => instance.work.requests)
      .filter((request) => !refused.has(request));
  }

  /**
   * The hooks of the next instance. A live instance continues the script at the next unused global index; a
   * peer has no replies (a call it makes is counted, never answered). Every instance refuses calls once abandoned.
   */
  hooks(role: Instance['role']): InstanceHooks {
    const index = this.instances.length + this.reserved++;
    const refuse = (kind: AbandonedCall['role'], request: ModelRequest): void => {
      const instance = this.instances[index];
      if (instance === undefined || !instance.abandoned) return;
      instance.refused[kind] += 1;
      this.abandonedCalls.push({ instance: index, role: kind, request });
      throw new Error(`scenario: the abandoned instance ${index} started a ${kind} model call after its crash`);
    };
    if (role === 'peer') {
      return { index, replies: [], queryReplies: [], beforeReply: async (request) => refuse('work', request),
        queryBeforeReply: async (request) => refuse('query', request) };
    }
    const offset = this.liveWorkCalls();
    return {
      index,
      replies: [...(this.script.replies ?? [])].slice(offset),
      queryReplies: [...(this.script.queryReplies ?? [])].slice(this.liveQueryCalls()),
      beforeReply: async (request, local, signal) => {
        refuse('work', request);
        const global = offset + local;
        await this.script.duringReply?.(global, request);
        const hold = this.holds.get(global);
        if (hold === undefined) return;
        hold.reachedBy = index;
        hold.reached.resolve(request);
        await raceAbort(hold, signal);
      },
      queryBeforeReply: async (request) => refuse('query', request),
    };
  }

  register(hooks: InstanceHooks, role: Instance['role'], work: ScriptedModel, query: ScriptedModel | null): void {
    this.reserved -= 1;
    this.instances[hooks.index] = { work, query, role, abandoned: false, refused: { work: 0, query: 0 } };
  }
  /** A start failed: the reserved index is given back. */
  release(): void { this.reserved -= 1; }

  abandon(index: number): void {
    const instance = this.instances[index];
    if (instance !== undefined) instance.abandoned = true;
  }

  hold(index: number): HeldReply {
    if (this.holds.has(index)) throw new Error(`model call ${index} is already held`);
    const entry: Hold = { reached: deferred<ModelRequest>(), gate: deferred(), settled: false, reachedBy: null };
    this.holds.set(index, entry);
    return { reached: entry.reached.promise,
      release: () => { entry.settled = true; entry.gate.resolve(); },
      fail: (reason = `scenario: model call ${index} never answers`) => { entry.settled = true; entry.gate.reject(new Error(reason)); } };
  }
  /** Throws when instance `index` has a held call it reached and nobody settled: closing it would wait forever. */
  assertNoOpenHold(index: number, what: string): void {
    for (const [call, hold] of this.holds) {
      if (hold.reachedBy === index && !hold.settled) {
        throw new Error(`${what}: model call ${call} is held (release or fail it first, or restart with { crash: true })`);
      }
    }
  }
  /** Fails the held calls instance `index` reached (all instances when null), so its Host can drain and close. */
  failHeld(index: number | null = null): void {
    for (const [call, hold] of this.holds) {
      if (!hold.settled && (index === null || hold.reachedBy === index)) {
        hold.settled = true;
        hold.gate.reject(new Error(`scenario: held model call ${call} released at cleanup`));
      }
    }
  }
}

/** A held call ends when the scenario settles its gate or when its own call is aborted (a Host closing it). */
function raceAbort(hold: Hold, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const aborted = (): void => {
      hold.settled = true;
      reject(signal.reason instanceof Error ? signal.reason : new Error('scenario: the held model call was aborted'));
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener('abort', aborted, { once: true });
    hold.gate.promise.then(() => { signal.removeEventListener('abort', aborted); resolve(); },
      (error: unknown) => { signal.removeEventListener('abort', aborted); reject(error instanceof Error ? error : new Error(String(error))); });
  });
}

// ---------------------------------------------------------------------------
// Steps (§11.11 `FuzzStep`)
// ---------------------------------------------------------------------------

const RECEIPT_STEPS: Partial<Record<WorkflowStepReceipt['kind'], FuzzStepKind>> = {
  claim_task: 'task_claimed', start: 'entry_authorized', open_checks: 'round_opened', run_check: 'check_begun',
  requeue_task: 'task_requeued', reverify_round: 'round_reverified', complete_goal: 'goal_completed',
};

/**
 * The §11.11 step of one performed Workflow operation: its kind (a committed `refused` requeue or reverify
 * is `task_rework_refused`), its actor (`requeue_task` and `reverify_round` run as `WORKFLOW_AUTOMATION_ACTOR`,
 * every other step as the Host actor) and the automation policy in effect.
 */
export function stepOfReceipt(receipt: WorkflowStepReceipt, actor: ActorRef, policy: TaskAutomationPolicyV1, label?: string): FuzzStep {
  const automatic = receipt.kind === 'requeue_task' || receipt.kind === 'reverify_round';
  const refused = automatic && receipt.result.status === 'committed' && receipt.result.value.kind === 'refused';
  return { kind: refused ? 'task_rework_refused' : RECEIPT_STEPS[receipt.kind] ?? 'other',
    actor: automatic ? { ...WORKFLOW_AUTOMATION_ACTOR } : { ...actor }, automationPolicy: { ...policy },
    ...(label === undefined ? {} : { label }) };
}

// ---------------------------------------------------------------------------
// The shared scenario surface
// ---------------------------------------------------------------------------

export type DriveOptions = {
  /** Return this unperformed request instead of sending it (`state: 'stopped'`). */
  stopBefore?: (input: WorkflowAdvanceInput) => boolean;
  /** Step cap; reaching it throws (default 64). */
  maxSteps?: number;
  /**
   * The invariants after every step that returned a receipt, with that step's `FuzzStep` (labels
   * `<label>#<n> <kind>`; default label: the input's flowId). On by default; `false` turns them off.
   */
  invariants?: { label: string } | false;
};

export type Driven = {
  steps: AdvanceValue[];
  receipts: WorkflowStepReceipt[];
  state: AdvanceValue['state'] | 'stopped';
  reason: string | null;
  /** The request `stopBefore` matched (`state: 'stopped'`), else null. */
  next: WorkflowAdvanceInput | null;
};

/** `stopBefore` for the next `perform` of `kind` (`claim_task`, `start`, `open_checks`, `requeue_task`, ...). */
export function performs(kind: string): (input: WorkflowAdvanceInput) => boolean {
  return input => input.kind === 'perform' && input.operation.kind === kind;
}

export abstract class ScenarioBase {
  /** The last world `assertInvariants` read: the `prev` of the next check (I-7, I-8, I-15, I-18, I-19). */
  lastWorld: InvariantWorld | undefined = undefined;
  readonly invariantLabels: string[] = [];
  protected policy: TaskAutomationPolicyV1;
  protected constructor(readonly root: string, readonly database: string, protected readonly models: ScriptState,
    policy: TaskAutomationPolicyV1) {
    this.policy = structuredClone(policy);
  }

  abstract readonly mode: 'host' | 'platform';
  protected abstract advanceOnce(input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult>;
  /** The actor the Host (or platform `ctx()`) runs Workflow steps as. */
  abstract stepActor(): WorkbenchActor;
  abstract taskRow(taskId?: string): Promise<TaskRow>;
  abstract goalDisplay(): Promise<GoalDisplayRead['display']>;
  abstract dispose(): Promise<void>;

  /** The automation policy in effect now (C8): the one the steps' `FuzzStep` carries. */
  automationPolicy(): TaskAutomationPolicyV1 { return structuredClone(this.policy); }
  /** Every model call so far, work and query, over every live and peer instance (crashed ones included). */
  modelCalls(): number { return this.models.modelCalls(); }
  /** Every work model request of the live instances, in order. */
  modelRequests(): ModelRequest[] { return this.models.requests(); }
  /** Calls an abandoned Host started after its crash (refused, not in `modelCalls()`); assert it before draining. */
  abandonedCalls(): AbandonedCall[] { return [...this.models.abandonedCalls]; }
  /** Holds the reply of work model call `index` (global) until released: the Kernel Turn stays open meanwhile. */
  holdReply(index: number): HeldReply { return this.models.hold(index); }

  /** Kernel session records by `record_type` (every Turn start, message and result the Kernel wrote). */
  kernelRecords(): { total: number; byType: Record<string, number> } {
    const rows = readSqlite(join(this.database, 'kernel.sqlite'), database => database.prepare(
      'SELECT record_type AS type, COUNT(*) AS n FROM session_records GROUP BY record_type').all() as Array<{ type: string; n: number }>, []);
    const byType = Object.fromEntries(rows.map(row => [row.type, Number(row.n)]));
    return { total: rows.reduce((sum, row) => sum + Number(row.n), 0), byType };
  }
  /** Every Kernel session header with a digest of its records, and the checkpoint count. */
  kernelSnapshot(): KernelSnapshot {
    return readSqlite(join(this.database, 'kernel.sqlite'), (database) => {
      const sessions = database.prepare('SELECT session_id, revision, active_run_id, active_turn_id FROM sessions ORDER BY session_id')
        .all() as Array<{ session_id: string; revision: number; active_run_id: string | null; active_turn_id: string | null }>;
      const records = database.prepare('SELECT record_json FROM session_records WHERE session_id = ? ORDER BY position');
      const checkpoints = database.prepare('SELECT COUNT(*) AS n FROM checkpoints').get() as { n: number };
      return {
        sessions: sessions.map((session) => {
          const rows = records.all(session.session_id) as Array<{ record_json: string }>;
          const digest = createHash('sha256');
          for (const row of rows) digest.update(row.record_json).update('\n');
          return { sessionId: session.session_id, revision: Number(session.revision), activeRunId: session.active_run_id,
            activeTurnId: session.active_turn_id, records: rows.length, recordsDigest: digest.digest('hex') };
        }),
        checkpoints: Number(checkpoints.n),
      };
    }, { sessions: [], checkpoints: 0 });
  }
  /** The ledger's event types in commit order. */
  ledgerEventTypes(): string[] { return eventTypesIn(this.database); }
  counts(): ScenarioCounts { return { modelCalls: this.modelCalls(), ...fileCounts(this.database) }; }

  /** `select_work` on the seeded Goal; Goal-level unless `taskId` is given. */
  select(flowId: string, taskId?: string): WorkflowAdvanceInput {
    return { schemaVersion: 1, goalRef: AG2B_GOAL_REF, flowId, sessionHint: null, kind: 'select_work',
      ...(taskId === undefined ? {} : { taskId }) };
  }

  /**
   * Drives the Workflow from `input` until `waiting`, `completed` or `stopBefore`; throws past the step cap.
   * After every step with a receipt it checks the invariants with that step's `FuzzStep` (`stepOfReceipt`).
   */
  async advance(input: WorkflowAdvanceInput, options: DriveOptions = {}): Promise<Driven> {
    const steps: AdvanceValue[] = [];
    const receipts: WorkflowStepReceipt[] = [];
    const invariants = options.invariants ?? { label: input.flowId };
    let current = input;
    const cap = options.maxSteps ?? 64;
    for (let step = 0; step < cap; step += 1) {
      if (options.stopBefore?.(current) === true) return { steps, receipts, state: 'stopped', reason: null, next: current };
      const result = await this.advanceOnce(current);
      if (result.status !== 'ready') throw new Error(`the Workflow call was not ready: ${JSON.stringify(result)}`);
      steps.push(result.value);
      const receipt = result.value.receipt;
      if (receipt !== null) {
        receipts.push(receipt);
        if (invariants !== false) {
          const label = `${invariants.label}#${step} ${receipt.kind}`;
          await assertInvariants(this, label, stepOfReceipt(receipt, this.stepActor(), this.policy, label));
        }
      }
      if (result.value.state === 'completed' || result.value.next === null) {
        return { steps, receipts, state: result.value.state, reason: result.value.reason, next: null };
      }
      current = result.value.next;
    }
    throw new Error(`the Workflow did not settle within ${cap} steps`);
  }
}

// ---------------------------------------------------------------------------
// Invariants (§11.11)
// ---------------------------------------------------------------------------

/** Where `assertInvariantsAt` reads (a platform's `storage.directory`) and the previous world it compares with. */
export type InvariantTarget = { database: string; lastWorld?: InvariantWorld | undefined; projectId?: string };

/**
 * §11.11: reads every record of the project in one window (`readInvariantWorld`
 * over a copy of the ledger, with the manifests for I-19) and runs I-1..I-22
 * against it, with the target's previous world as `prev` (the cross-step
 * clauses) and `step` for the step-local ones. Every store a scenario checks
 * started empty, so a `legacy` finding fails too. Fails with the label and
 * every finding; keeps the world as the target's next `prev`. A moved test
 * case with its own `startAG2bHost` setup calls it with `{ database }`.
 */
export async function assertInvariantsAt(target: InvariantTarget, label: string, step?: FuzzStep): Promise<InvariantWorld> {
  const world = await readInvariantWorld(invariantStoreOf(target.database), target.projectId ?? AG2B_SCOPE.projectId);
  const findings = [...checkAllInvariants(world, target.lastWorld, step), ...legacyFindings(world, target.lastWorld, step)]
    .map((finding) => `${finding.invariant}${finding.legacy === true ? ' (legacy)' : ''} ${finding.ref}: ${finding.message}`);
  target.lastWorld = world;
  expect(findings, `invariants after ${label}${step === undefined ? '' : ` (step ${step.kind})`}`).toEqual([]);
  return world;
}

/** `assertInvariantsAt` on a scenario's files; call it after every step that changes records outside `advance()`. */
export async function assertInvariants(h: ScenarioBase, label: string, step?: FuzzStep): Promise<void> {
  h.invariantLabels.push(label);
  await assertInvariantsAt(h, label, step);
}

// ---------------------------------------------------------------------------
// Polling (start-up re-drive and other background drivers)
// ---------------------------------------------------------------------------

/** Re-reads every 50 ms, at most 300 times (the start-up re-drive cases' own wait), until `done`. */
export async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, what: string): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 300 && !done(value); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
    value = await read();
  }
  if (!done(value)) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
  return value;
}

// ---------------------------------------------------------------------------
// Composition root on the scenario files (platform mode and `direct()`)
// ---------------------------------------------------------------------------

export function hostCtx(actor: WorkbenchActor = SCENARIO_OPERATOR): CoreCallContext {
  return { ...AG2B_SCOPE, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', ...AG2B_SCOPE, actor }, signal: new AbortController().signal };
}

/** An owned work Run as the caller (an agent, `actorClass` `agent`). */
export function workRunCtx(runRef: RunRef, roleBinding: RoleBindingRefV1 = AG2B_WORK_ROLE_BINDING): CoreCallContext {
  return { ...AG2B_SCOPE, principal: { kind: 'work_run', runRef, roleBinding },
    materialReader: { kind: 'run', requester: runRef }, signal: new AbortController().signal };
}

/** The AG2b workspace at `root` for a Host grant `grant` (every source read allowed). */
export function ag2bWorkspaceBindings(root: string, revision: { value: number }, grant: string): WorkspaceHostBindings {
  return {
    async resolveRoot(requested) {
      if (requested.projectId !== AG2B_SCOPE.projectId || requested.workspaceId !== AG2B_SCOPE.workspaceId) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this scenario' };
      }
      return { status: 'ready', value: { root, workspaceRevision: revision.value } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'scenario-host', permissionRevision: grant, allowsRead: () => true } };
    },
  };
}

/** The AG2b work binding's tools (the Host's startup grant). */
export const AG2B_WORK_TOOLS: readonly string[] = ['read', 'write', 'find_related_sessions', 'read_session_card', 'send_session_message'];

/**
 * The AG2b work binding's grant over a scripted client (the Host builds the same from its startup file). `tools`
 * replaces the work tools (a root whose Agent adopts plans through the W2 tools); `queryModel` adds the AG2b query
 * binding as the Host builds it (the advisor template, read-only tools).
 */
export function ag2bWorkRuntime(model: () => ScriptedModel,
  options: { tools?: readonly string[]; queryModel?: ScriptedModel } = {}): RuntimeHostBindings {
  const queryModel = options.queryModel;
  return {
    async resolveConfiguration(context, request) {
      if (context.projectId !== AG2B_SCOPE.projectId || context.workspaceId !== AG2B_SCOPE.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the runtime Host is not bound to this workspace' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
      }
      return { status: 'ready', value: {
        configurationRevision: 'ag2b-work-host@1',
        model: { configuration: { revision: 'ag2b-work-model@1', provider: 'deepseek', model: 'ag2b-scripted-work',
          baseUrl: 'http://127.0.0.1' }, client: model().client,
        inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'scenario-counter' }) } },
        budget: AG2B_RUNTIME_BUDGET,
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: 'builder', revision: '1', digest: sha256Hex(AG2B_WORK_INSTRUCTION) } : null,
        tools: [...(options.tools ?? AG2B_WORK_TOOLS)], writeScope: ['.'],
        skills: { resourceRoot: SKILLS_ROOT, enabledIds: [] }, systemInstruction: AG2B_WORK_INSTRUCTION,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
    ...(queryModel === undefined ? {} : {
      async resolveQueryConfiguration(context: CoreCallContext) {
        if (context.projectId !== AG2B_SCOPE.projectId || context.workspaceId !== AG2B_SCOPE.workspaceId) {
          return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'the runtime Host is not bound to this workspace' };
        }
        return { status: 'ready' as const, value: {
          configurationRevision: 'ag2b-query-host@1',
          model: { configuration: { revision: 'ag2b-query-model@1', provider: 'deepseek', model: 'ag2b-scripted-query',
            baseUrl: 'http://127.0.0.1' }, client: queryModel.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'scenario-counter' }) } },
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(AG2B_QUERY_INSTRUCTION) },
          tools: ['read', 'project_source'], writeScope: [],
          skills: { resourceRoot: SKILLS_ROOT, enabledIds: [] }, systemInstruction: AG2B_QUERY_INSTRUCTION,
          deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        } };
      },
    }),
  };
}

type CompositionSettings = { actor: WorkbenchActor; check: CheckBehaviour; checkRevision: number; tokenBudget: number };

function workflowBinding(tokenBudget: number): WorkflowHostConfiguration['bindings'][number] {
  return { workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING,
    budget: { tokenBudget, deadline: null } };
}

/** The composition root on the scenario files, with the same checks configuration the Host registers and the policy in effect. */
async function openComposition(root: string, database: string, settings: CompositionSettings, policy: TaskAutomationPolicyV1,
  model: (() => ScriptedModel) | null): Promise<Platform> {
  const platform = await createTargetPlatform({
    storage: { kind: 'sqlite', directory: database },
    workspace: ag2bWorkspaceBindings(root, { value: 1 }, permissionRevision(settings.actor, AG2B_SCOPE, ['.'])),
    now: () => '2026-10-06T00:00:00.000Z',
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: join(database, 'kernel.sqlite') }] },
    ...(model === null ? {} : { runtime: ag2bWorkRuntime(model) }),
    checks: checksConfiguration(settings.actor, settings.check, settings.checkRevision),
    workflow: { consumerId: AG2B_CONSUMER_ID, bindings: [workflowBinding(settings.tokenBudget)] },
  });
  platform.registerAutomationPolicy(policy);
  return platform;
}

/** The AG2b seed through the owners in process (the same writes as the HTTP seed). */
export async function seedThroughOwners(platform: Platform, actor: WorkbenchActor, workIds: readonly string[]): Promise<void> {
  type OwnerCall = (ctx: CoreCallContext, request: never) => Promise<unknown>;
  const owners: Record<string, OwnerCall> = {
    'projects/create': (ctx, request) => platform.projects.createProject(ctx, request),
    'workspaces/register': (ctx, request) => platform.projects.registerWorkspace(ctx, request),
    'completion-policies/install': (ctx, request) => platform.completionPolicies.installCompletionPolicy(ctx, request),
    'completion-policies/activate': (ctx, request) => platform.completionPolicies.activateCompletionPolicy(ctx, request),
    'architecture/adopt-initial': (ctx, request) => platform.architecture.adoptInitialArchitecture(ctx, request),
    'goals/create': (ctx, request) => platform.goals.createGoal(ctx, request),
    'plans/propose': (ctx, request) => platform.plans.proposePlan(ctx, request),
    'plans/apply': (ctx, request) => platform.plans.applyPlanChange(ctx, request),
  };
  await seedAG2bWorkGraphThrough(async (suffix, body) => {
    const owner = owners[suffix];
    if (owner === undefined) throw new Error(`no in-process owner for the seed route ${suffix}`);
    return owner(hostCtx(actor), body.request as never);
  }, workIds);
}

async function taskRowOf(read: ReadResult<{ tasks: TaskRow[] }>, taskId: string): Promise<TaskRow> {
  if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`the Task ${taskId} must be in the graph`);
  return row;
}

function displayOf(read: ReadResult<GoalDisplayRead>): GoalDisplayRead['display'] {
  if (read.status !== 'ready') throw new Error(`the Goal display must be readable: ${JSON.stringify(read)}`);
  return read.value.display;
}

const opened: ScenarioBase[] = [];

/** Disposes every scenario (held calls failed, abandoned Hosts drained), then removes the temporary files. */
export async function cleanupScenarios(): Promise<void> {
  for (const scenario of opened.splice(0).reverse()) await scenario.dispose().catch(() => undefined);
  await cleanupAG2b();
  await cleanupRestart();
}

// ---------------------------------------------------------------------------
// Host mode
// ---------------------------------------------------------------------------

export type HostScenarioOptions = {
  script?: ScenarioScript;
  check?: CheckBehaviour;
  /** Written to the private Host settings file before the first start (C8, LA-6); default 3 / resumeOnStartup true. */
  automation?: TaskAutomationPolicyV1;
  /** The Host's startup actor (default `SCENARIO_OPERATOR`). */
  actor?: WorkbenchActor;
  /** The seeded work Tasks (default the one AG2b work Task); `null` seeds nothing. */
  workIds?: readonly string[] | null;
};

export type HostRestartOptions = {
  /** Abandon the running Host as a crash (no `close()`, lock rewritten to an exited pid); default a clean close. */
  crash?: boolean;
  /** After a clean close, leave a stale lock as a crashed Host would (the next start is HL-03, not HL-01). */
  staleLock?: boolean;
  automation?: TaskAutomationPolicyV1;
  /** The registered check from this start on (startup configuration); another check is a new configuration revision. */
  check?: CheckBehaviour;
  actor?: WorkbenchActor;
  /** Start without the Kernel Store registration (W-07, H-03). */
  noKernelStores?: boolean;
  /** Check the invariants after the new Host's start-up reconcile (default true; label `restart <n>`). */
  invariants?: boolean;
};

type HostSettings = { check: CheckBehaviour; checkRevision: number; actor: WorkbenchActor; noKernelStores: boolean };

export class HostScenario extends ScenarioBase {
  readonly mode = 'host' as const;
  private current: { host: AG2bHost; index: number };
  private readonly abandoned: Array<{ host: AG2bHost; index: number }> = [];
  private readonly peers: AG2bHost[] = [];
  private directPlatform: Promise<Platform> | null = null;
  private settings: HostSettings;
  private restarts = 0;

  private constructor(root: string, database: string, readonly publicDir: string, models: ScriptState,
    first: { host: AG2bHost; index: number }, settings: HostSettings, policy: TaskAutomationPolicyV1) {
    super(root, database, models, policy);
    this.current = first;
    this.settings = settings;
  }

  static async open(options: HostScenarioOptions = {}): Promise<HostScenario> {
    const root = await tempDir('scenario-ws-');
    const database = await tempDir('scenario-db-');
    const publicDir = await publicDirectory();
    if (options.automation !== undefined) await writeAutomationSettings(database, options.automation);
    const models = new ScriptState(options.script ?? {});
    const settings: HostSettings = { check: options.check ?? 'result_file', checkRevision: 1, actor: options.actor ?? SCENARIO_OPERATOR,
      noKernelStores: false };
    const first = await HostScenario.start(root, database, publicDir, models, settings, 'live');
    const scenario = new HostScenario(root, database, publicDir, models, first, settings,
      options.automation ?? DEFAULT_TASK_AUTOMATION_POLICY);
    opened.push(scenario);
    if (options.workIds !== null) await seedAG2bWorkGraph(first.host, options.workIds ?? [AG2B_WORK_TASK_ID]);
    return scenario;
  }

  private static async start(root: string, database: string, publicDir: string, models: ScriptState, settings: HostSettings,
    role: 'live' | 'peer'): Promise<{ host: AG2bHost; index: number }> {
    const hooks = models.hooks(role);
    const { command, timeoutMs, kind } = checkCommandOf(settings.check);
    if (kind !== 'static') {
      models.release();
      throw new Error('host mode registers the AG2b static check; another kind needs platform mode');
    }
    let host: AG2bHost;
    try {
      host = await startAG2bHost(publicDir, { root, database, replies: hooks.replies, beforeReply: hooks.beforeReply,
        queryReplies: hooks.queryReplies, queryBeforeReply: hooks.queryBeforeReply, checkCommand: command, checkTimeoutMs: timeoutMs,
        checkConfigurationRevision: checkRevisionOf(settings.checkRevision), actor: settings.actor,
        noKernelStores: settings.noKernelStores });
    } catch (error) {
      models.release();
      throw error;
    }
    models.register(hooks, role, host.scripted, host.queryScripted);
    return { host, index: hooks.index };
  }

  /** The live Host (a new one after every restart). */
  get host(): AG2bHost { return this.current.host; }
  /** The start-up reconcile report of the live Host (§12.1 step 7). */
  get reconcile(): HostReconcileReportV1 { return this.current.host.host.reconcile; }
  stepActor(): WorkbenchActor { return this.settings.actor; }

  /** One core route on the live Host; a non-200 answer fails the test (use `answer` for refusals). */
  post<T>(suffix: string, body: unknown): Promise<T> { return post<T>(this.current.host, suffix, body); }
  /** Any answer of a core route, refused or not (a refusal travels as a non-200 with its rejection body). */
  answer(suffix: string, body: unknown): Promise<Record<string, unknown>> { return answer(this.current.host, suffix, body); }

  /** The Host setting `automation/save` (C8, LA-6): installs the policy at once; the steps' `FuzzStep` follows it. */
  async saveAutomation(policy: TaskAutomationPolicyV1): Promise<HostSettingsSnapshot> {
    const response = await fetch(new URL(`${SETTINGS_API_PREFIX}automation/save`, this.current.host.base), { method: 'POST',
      headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: this.current.host.token },
      body: JSON.stringify({ autoReworkLimit: policy.autoReworkLimit, resumeOnStartup: policy.resumeOnStartup }) });
    const saved = await response.json() as SettingsResponse<HostSettingsSnapshot>;
    if (saved.status !== 'ready') throw new Error(`automation/save was not ready: ${JSON.stringify(saved)}`);
    this.policy = structuredClone(policy);
    if (this.directPlatform !== null) (await this.directPlatform).registerAutomationPolicy(policy);
    return saved.value;
  }

  /**
   * §12.10 steps 1–3: stop the live Host and start a new one on the same ledger, Kernel store and
   * workspace (only missing workspace files are written). A crash abandons the old Host (see the header:
   * its held model call stays held, any call it starts afterwards is refused) with its lock naming an
   * exited process; a close drains it (HL-06) and refuses to start while it holds a reached model call.
   * Then checks the invariants (no step: a restart is not a §11.11 operation). Returns the new reconcile report.
   */
  async restart(options: HostRestartOptions = {}): Promise<HostReconcileReportV1> {
    if (options.crash === true) {
      this.models.abandon(this.current.index);
      this.abandoned.push(this.current);
      await writeStaleLock(this.database);
    } else {
      this.models.assertNoOpenHold(this.current.index, 'a clean restart drains the Host');
      await this.current.host.host.close();
      if (options.staleLock === true) await writeStaleLock(this.database);
    }
    await this.closeDirect();
    if (options.automation !== undefined) {
      await writeAutomationSettings(this.database, options.automation);
      this.policy = structuredClone(options.automation);
    }
    const check = options.check ?? this.settings.check;
    this.settings = { check, checkRevision: this.settings.checkRevision + (sameCheck(check, this.settings.check) ? 0 : 1),
      actor: options.actor ?? this.settings.actor, noKernelStores: options.noKernelStores ?? this.settings.noKernelStores };
    this.current = await HostScenario.start(this.root, this.database, this.publicDir, this.models, this.settings, 'live');
    this.restarts += 1;
    if (options.invariants !== false) await assertInvariants(this, `restart ${this.restarts}${options.crash === true ? ' (crash)' : ''}`);
    return this.current.host.host.reconcile;
  }

  /**
   * Lets the abandoned Hosts finish: fails the held calls they reached and closes them. Their late
   * ledger writes are refused by the records the reconcile wrote (VR-04), but their Kernel may still
   * append to the Kernel store (a Turn failing), so take Kernel counts before draining.
   */
  async drainAbandoned(): Promise<void> {
    for (const abandoned of this.abandoned.splice(0)) {
      this.models.failHeld(abandoned.index);
      await abandoned.host.host.close();
    }
  }

  /**
   * A second live Host on the same files without the lease (HL-02: `lease: 'held_by_other'`, no
   * reconcile, `busy` for every Kernel entry). It has no script: a model call it makes is counted by
   * `modelCalls()` and never answered. Closed by the cleanup.
   */
  async startPeer(options: { actor?: WorkbenchActor } = {}): Promise<AG2bHost> {
    const peer = await HostScenario.start(this.root, this.database, this.publicDir, this.models,
      { ...this.settings, actor: options.actor ?? this.settings.actor }, 'peer');
    this.peers.push(peer.host);
    return peer.host;
  }

  /**
   * The composition root on the same files, without a Runtime and without the instance lease: owner
   * calls as `hostCtx(actor)` or `workRunCtx(runRef)` that no route accepts (the automation, an agent).
   * It registers the Host's checks configuration and automation policy; a restart closes it (the next
   * call reopens it on the new settings).
   */
  direct(): Promise<Platform> {
    this.directPlatform ??= openComposition(this.root, this.database,
      { actor: this.settings.actor, check: this.settings.check, checkRevision: this.settings.checkRevision, tokenBudget: 1_000_000 },
      this.policy, null);
    return this.directPlatform;
  }

  private async closeDirect(): Promise<void> {
    if (this.directPlatform === null) return;
    const platform = this.directPlatform;
    this.directPlatform = null;
    await (await platform).close();
  }

  protected async advanceOnce(input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult> {
    // A refusal (e.g. `busy` on a Host without the lease, HL-07) travels as a non-200 with its body.
    return await this.answer('workflow/advance', plain(AG2B_SCOPE, input)) as WorkflowAdvanceResult;
  }

  async taskRow(taskId: string = AG2B_WORK_TASK_ID): Promise<TaskRow> {
    return taskRowOf(await this.post<ReadResult<{ tasks: TaskRow[] }>>('tasks/query', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF })), taskId);
  }

  async goalDisplay(): Promise<GoalDisplayRead['display']> {
    return displayOf(await this.post<ReadResult<GoalDisplayRead>>('goals/display', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF })));
  }

  async dispose(): Promise<void> {
    this.models.failHeld();
    for (const abandoned of this.abandoned.splice(0)) await abandoned.host.host.close().catch(() => undefined);
    for (const peer of this.peers.splice(0)) await peer.host.close().catch(() => undefined);
    await this.current.host.host.close().catch(() => undefined);
    await this.closeDirect().catch(() => undefined);
  }
}

function sameCheck(left: CheckBehaviour, right: CheckBehaviour): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A real Host on fresh files with the seeded Goal (host mode). */
export function openHostScenario(options: HostScenarioOptions = {}): Promise<HostScenario> {
  return HostScenario.open(options);
}

// ---------------------------------------------------------------------------
// Platform mode
// ---------------------------------------------------------------------------

export type PlatformScenarioOptions = {
  script?: ScenarioScript;
  check?: CheckBehaviour;
  /** Installed with `registerAutomationPolicy` (and again after every restart); default 3 / resumeOnStartup true. */
  automation?: TaskAutomationPolicyV1;
  /** The actor of `ctx()` and the check executor (default `SCENARIO_OPERATOR`). */
  actor?: WorkbenchActor;
  /** The Workflow binding's `tokenBudget` (default 1 000 000, as the AG2b Host). */
  tokenBudget?: number;
  workIds?: readonly string[] | null;
};

export class PlatformScenario extends ScenarioBase {
  readonly mode = 'platform' as const;
  private live: Platform;
  private model: ScriptedModel;
  private index: number;

  private constructor(root: string, database: string, models: ScriptState, started: { platform: Platform; model: ScriptedModel; index: number },
    private readonly settings: CompositionSettings, policy: TaskAutomationPolicyV1) {
    super(root, database, models, policy);
    this.live = started.platform;
    this.model = started.model;
    this.index = started.index;
  }

  static async open(options: PlatformScenarioOptions = {}): Promise<PlatformScenario> {
    const root = await tempDir('scenario-ws-');
    const database = await tempDir('scenario-db-');
    await writeAG2bWorkspace(root);
    const models = new ScriptState(options.script ?? {});
    const settings: CompositionSettings = { actor: options.actor ?? SCENARIO_OPERATOR, check: options.check ?? 'result_file',
      checkRevision: 1, tokenBudget: options.tokenBudget ?? 1_000_000 };
    const policy = options.automation ?? DEFAULT_TASK_AUTOMATION_POLICY;
    const started = await PlatformScenario.start(root, database, models, settings, policy);
    const scenario = new PlatformScenario(root, database, models, started, settings, policy);
    opened.push(scenario);
    if (options.workIds !== null) await seedThroughOwners(started.platform, settings.actor, options.workIds ?? [AG2B_WORK_TASK_ID]);
    return scenario;
  }

  private static async start(root: string, database: string, models: ScriptState, settings: CompositionSettings,
    policy: TaskAutomationPolicyV1): Promise<{ platform: Platform; model: ScriptedModel; index: number }> {
    const hooks = models.hooks('live');
    const model = createScriptedModel(hooks.replies, hooks.beforeReply);
    models.register(hooks, 'live', model, null);
    const platform = await openComposition(root, database, settings, policy, () => model);
    return { platform, model, index: hooks.index };
  }

  get platform(): Platform { return this.live; }
  /** The instance's scripted model (its own count; `modelCalls()` sums every instance). */
  get scripted(): ScriptedModel { return this.model; }
  ctx(actor: WorkbenchActor = this.settings.actor): CoreCallContext { return hostCtx(actor); }
  stepActor(): WorkbenchActor { return this.settings.actor; }

  /** C8: the live automation policy (kept across restarts, as a Host keeps its settings file); the steps follow it. */
  setAutomation(policy: TaskAutomationPolicyV1): void {
    this.policy = structuredClone(policy);
    this.live.registerAutomationPolicy(policy);
  }
  /** The registered check from now on, as a new configuration revision (an open round keeps its frozen one). */
  registerCheck(check: CheckBehaviour): void {
    this.settings.check = check;
    this.settings.checkRevision += 1;
    this.live.registerCheckConfiguration({ configuration: checksConfiguration(this.settings.actor, check, this.settings.checkRevision) });
  }
  /** `registerWorkflowBinding` with a new `tokenBudget` (C8-budget, AV-11). */
  setTokenBudget(tokenBudget: number): void {
    this.settings.tokenBudget = tokenBudget;
    this.live.registerWorkflowBinding({ consumerId: AG2B_CONSUMER_ID, binding: workflowBinding(tokenBudget) });
  }

  /** Closes the composition root and reopens it on the same files (no start-up reconcile: use host mode), then checks the invariants. */
  async restart(options: { invariants?: boolean } = {}): Promise<void> {
    this.models.assertNoOpenHold(this.index, 'a platform restart closes the composition root');
    await this.live.close();
    const started = await PlatformScenario.start(this.root, this.database, this.models, this.settings, this.policy);
    this.live = started.platform;
    this.model = started.model;
    this.index = started.index;
    if (options.invariants !== false) await assertInvariants(this, 'platform restart');
  }

  protected advanceOnce(input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult> {
    return this.live.workflow.advanceWork(this.ctx(), input);
  }

  async taskRow(taskId: string = AG2B_WORK_TASK_ID): Promise<TaskRow> {
    return taskRowOf(await this.live.plans.queryTaskGraph(this.ctx(), { goalRef: AG2B_GOAL_REF }), taskId);
  }

  async goalDisplay(): Promise<GoalDisplayRead['display']> {
    if (this.live.plans.queryGoalDisplay === undefined) throw new Error('the platform publishes no Goal display');
    return displayOf(await this.live.plans.queryGoalDisplay(this.ctx(), { goalRef: AG2B_GOAL_REF }));
  }

  async dispose(): Promise<void> {
    this.models.failHeld();
    await this.live.close().catch(() => undefined);
  }
}

/** The composition root on fresh files with the seeded Goal (platform mode). */
export function openPlatformScenario(options: PlatformScenarioOptions = {}): Promise<PlatformScenario> {
  return PlatformScenario.open(options);
}
