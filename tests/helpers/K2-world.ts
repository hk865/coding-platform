/**
 * K2 world: one real Host (`openS6AHostWorld`) with the K2 shared budget (1,000,000-token window,
 * 2,000,000-token Work run budget) and, when a row needs it, the startup `runtime.compaction` block.
 *
 * The startup block is written into the Host's trusted runtime configuration before the real factory runs
 * (`withConfiguredHost`, the PL-readings recipe); every reopen writes it again. The Host settings route that
 * rebuilds the configuration (`automation/save`) is the one K2P1-15 exercises through `setResumeOnStartup`.
 *
 * Work rows use the public plan/line/Workflow steps of `S6B1-fixture`/`A2-restart-fixture`, exactly as
 * `PL-readings-fixture.ts` does: a Plan's tasks are assigned to the Work role, a line is created with open
 * responsible links, and `workflow/advance` runs each task on that line. No record, call context or Kernel
 * field is written by hand.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionRecordSchema, type ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { Page } from '../../src/contracts/core/results.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import {
  openS6AHostWorld, usageOf, type S6AHostWorld, type S6AHostWorldOptions, type S6AReply,
} from './S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession } from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';
import { checkConfiguration, claimedRunOf, sessionOf } from './S7A-fixture.js';
import { withConfiguredHost } from './S7C-member-fixture.js';

/** The decoded Kernel record the public history publishes. */
export type K2KernelRecord = ReturnType<typeof sessionRecordSchema.parse>;

export type K2Ratios = { triggerRatio: number; targetRatio: number; tailRatio: number };
export const K2_DEFAULT_RATIOS: K2Ratios = { triggerRatio: 0.4, targetRatio: 0.2, tailRatio: 0.5 };
export const K2_WINDOW_TOKENS = 1_000_000;

/** The one shared budget of book-k2-slim.frozen §2.1: 1M window and the frozen Work run limits. */
const K2_WORK_BUDGET = {
  contextWindowTokens: K2_WINDOW_TOKENS, inputTokens: null, outputTokens: null, maxRequests: null,
  maxToolCalls: null, timeoutMs: null, perResponseTokens: 16_384,
} as const;

/** The startup `runtime.compaction` block a world is opened with; absent means the defaults. */
export type K2Compaction = Partial<K2Ratios>;

/** A reply both the Work (S6A) and Query (B2) scripted models accept. */
export type K2Reply =
  | { kind: 'text'; text: string; usage?: ReturnType<typeof usageOf> }
  | { kind: 'calls'; calls: ReadonlyArray<{ callId: string; name: string; args: Record<string, unknown> }>;
    usage?: ReturnType<typeof usageOf> };

type Configure = Parameters<typeof withConfiguredHost>[1];

function configured(compaction: K2Compaction | undefined): Configure {
  return original => async hostOptions => {
    const configuration = hostOptions.runtimeConfiguration;
    if (configuration === undefined) throw new Error('K2: the Host has no runtime configuration');
    // The row's startup JSON as written; the Host's parse fills each absent ratio.
    if (compaction !== undefined) configuration.compaction = { ...compaction };
    return original(hostOptions);
  };
}

/**
 * The Kernel refuses a Session history that repeats a tool call id ("重复 ToolCall"), and a real model never repeats
 * one, so the first use of an id on a line keeps it and a repeat gets `@<label>` (the task or round that made it).
 */
export function renameRepeatedCalls<R extends { kind: string }>(used: Set<string>, label: string, replies: readonly R[]): R[] {
  return replies.map(reply => {
    if (reply.kind !== 'calls') return reply;
    const calls = (reply as unknown as Extract<K2Reply, { kind: 'calls' }>).calls.map(call => {
      let callId = call.callId;
      for (let repeat = 1; used.has(callId); repeat += 1) {
        callId = `${call.callId}@${label}${repeat === 1 ? '' : `#${String(repeat)}`}`;
      }
      used.add(callId);
      return { ...call, callId };
    });
    return { ...reply, calls } as R;
  });
}

export type K2WorkWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly goal: GoalRef;
  readonly tasks: readonly TaskTriple[];
  readonly line: S6ASession;
  /** Script the line's replies, run `taskId` on the line, and answer the Run. */
  runTask(taskId: string, flowId: string, replies: readonly S6AReply[]): Promise<RunRef>;
  /** Script the line's replies; `runTask` already does this, this is for a run whose start is held. */
  script(replies: readonly S6AReply[]): Promise<void>;
  /** The line's queued model requests, in order. */
  requests(): Promise<ModelRequest[]>;
  /** `sessions/history` of the line, from position 1. */
  history(limit?: number): Promise<SessionHistoryEntry[]>;
  /** The records of `history`, decoded with the Kernel's public schema. */
  records(): Promise<K2KernelRecord[]>;
  /** The decoded records of another Session of this world (e.g. the continuation line's own). */
  recordsOf(sessionRef: SessionRef): Promise<K2KernelRecord[]>;
  /** `automation/save` of the Host setting: the next start's configuration rebuild. */
  settingsRebuild(): Promise<unknown>;
  /** SQLite only: reopen on the same directory with the same startup `compaction`. */
  reopen(): Promise<void>;
  close(): Promise<void>;
};

export type K2WorkOptions = {
  backend?: S6ABackend;
  compaction?: K2Compaction;
  taskIds?: readonly string[];
  /** Write `big-1..big-N.txt` (60,000 `a`) and `small.txt` (2,000 `b`) into the workspace. */
  files?: { big?: number; small?: boolean };
  /** A row's own exception to the shared Work budget (K2P2-05: `outputTokens` 8,193). */
  workBudget?: NonNullable<S6AHostWorldOptions['workBudget']>;
};

/** `sessions/history` of one Session of a K2 world, from position 1. */
async function historyOf(world: S6AHostWorld, sessionRef: SessionRef, limit = 200): Promise<SessionHistoryEntry[]> {
  const answer = await world.post('sessions/history', plain(S6A_SCOPE, {
    sessionRef, afterCursor: null, throughCursor: null, limit }));
  const page = answer.body as ReadResult<Page<SessionHistoryEntry>>;
  if (page.status !== 'ready') throw new Error(`K2: sessions/history is not ready: ${JSON.stringify(answer.body)}`);
  return page.value.items;
}

/** The decoded Kernel records of one Session of a K2 world. */
export async function kernelRecordsOf(world: S6AHostWorld, sessionRef: SessionRef): Promise<K2KernelRecord[]> {
  return (await historyOf(world, sessionRef)).flatMap(item => 'encoding' in item.body
    && item.body.encoding === 'kernel_session_record_json'
    ? [sessionRecordSchema.parse(JSON.parse(item.body.text))] : []);
}

export async function openK2WorkWorld(options: K2WorkOptions = {}): Promise<K2WorkWorld> {
  const settingsDirectory = await mkdtemp(join(tmpdir(), 'k2-settings-'));
  const configure = configured(options.compaction);
  const world = await withConfiguredHost(
    () => openS6AHostWorld({ backend: options.backend ?? 'memory', workBudget: { ...K2_WORK_BUDGET, ...options.workBudget },
      extraHostOptions: { settings: { settingsDirectory },
        checks: checkConfiguration({ ...OPERATOR, kind: 'human' }) } }),
    configure);
  try {
    if (options.files !== undefined) {
      for (let index = 1; index <= (options.files.big ?? 0); index += 1) {
        await writeFile(join(world.root, `big-${String(index)}.txt`), 'a'.repeat(60_000));
      }
      if (options.files.small === true) await writeFile(join(world.root, 'small.txt'), 'b'.repeat(2_000));
    }
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await world.setResumeOnStartup(false);
    await world.settleDetached();
    await governS6B(world, main, world.goals);
    await world.settleDetached();
    const goal = world.goals.first;
    const taskIds = options.taskIds ?? ['k2-r1', 'k2-r2', 'k2-r3'];
    const { tasks } = await adoptS6BPlan(main, goal, {
      label: 'k2-work', taskIds, role: S6A_WORK_ROLE.templateId });
    const line = await sessionOf(world, await createS6BLine(main, {
      label: 'k2-work-line', role: S6A_WORK_ROLE, tasks }));
    const usedCallIds = new Set<string>();
    let scripts = 0;
    const runTask = async (taskId: string, flowId: string, replies: readonly S6AReply[]): Promise<RunRef> => {
      await world.scripted.script(line, renameRepeatedCalls(usedCallIds, taskId, replies));
      const claimInput = await advanceUntil(world.ag2b, {
        schemaVersion: 1, goalRef: goal, flowId, sessionHint: line.ref, kind: 'select_work', taskId,
      }, 'claim_task');
      const receipts: WorkflowStepReceipt[] = [];
      await driveWorkflow(world.ag2b, claimInput, { stopBefore: 'claim_task', receipts });
      return claimedRunOf(receipts, taskId).run;
    };
    const history = async (limit = 200): Promise<SessionHistoryEntry[]> => historyOf(world, line.ref, limit);
    return {
      world, main, goal, tasks, line,
      runTask,
      script: replies => world.scripted.script(line, renameRepeatedCalls(usedCallIds, `script${String(++scripts)}`, replies)),
      requests: () => world.scripted.requests(line),
      history,
      async records() {
        return kernelRecordsOf(world, line.ref);
      },
      recordsOf: sessionRef => kernelRecordsOf(world, sessionRef),
      settingsRebuild: () => world.setResumeOnStartup(false),
      async reopen() {
        await withConfiguredHost(() => world.reopen(), configure);
      },
      async close() {
        await world.close().catch(() => undefined);
        await rm(settingsDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    await rm(settingsDirectory, { recursive: true, force: true });
    throw error;
  }
}

/** A 12-call large-result turn, then its answer reporting `inputTokens`. */
export function bigReply(count: number, inputTokens: number, text: string): readonly K2Reply[] {
  return [
    { kind: 'calls', calls: Array.from({ length: count }, (_, index) => ({
      callId: `big-${String(index + 1)}`, name: 'read', args: { path: `big-${String(index + 1)}.txt` } })) },
    { kind: 'text', text, usage: usageOf(inputTokens) },
  ];
}

/** A one-small-result turn, then its answer reporting `inputTokens`. */
export function smallReply(inputTokens: number | null, text: string): readonly K2Reply[] {
  return [
    { kind: 'calls', calls: [{ callId: 'small', name: 'read', args: { path: 'small.txt' } }] },
    inputTokens === null ? { kind: 'text', text } : { kind: 'text', text, usage: usageOf(inputTokens) },
  ];
}

/** The compaction records of a history's decoded records, newest last. */
export function compactions(records: readonly K2KernelRecord[]): K2KernelRecord[] {
  return records.filter(record => record.recordType === 'context.compacted');
}

// ---------------------------------------------------------------------------
// The Query world: a real secretary line through the Host request driver
// ---------------------------------------------------------------------------

export type K2QueryWorld = {
  readonly world: S6AHostWorld;
  readonly line: S6ASession;
  readonly goal: GoalRef;
  /** Script the line's replies, submit one request round (recipient null means the Host's selection), wait for it. */
  round(label: string, replies: readonly K2Reply[], recipient?: S6ASession | null):
    Promise<{ requests: ModelRequest[]; secretary: SessionRef; queryJobId: string }>;
  /** The line's queued model requests, in order. */
  requests(): ModelRequest[];
  /** `sessions/history` of the line. */
  history(limit?: number): Promise<SessionHistoryEntry[]>;
  records(): Promise<K2KernelRecord[]>;
  close(): Promise<void>;
};

export async function openK2QueryWorld(options: { compaction?: K2Compaction } = {}): Promise<K2QueryWorld> {
  const settingsDirectory = await mkdtemp(join(tmpdir(), 'k2-query-settings-'));
  const configure = configured(options.compaction);
  const world = await withConfiguredHost(
    () => openS6AHostWorld({ backend: 'memory', secretaryBudget: { contextWindowTokens: K2_WINDOW_TOKENS, maxTokens: null },
      extraHostOptions: { settings: { settingsDirectory }, requestDriver: 'on', scribeReminderPeriodMs: 25 } }),
    configure);
  try {
    for (let index = 1; index <= 12; index += 1) {
      await writeFile(join(world.root, `big-${String(index)}.txt`), 'a'.repeat(60_000));
    }
    await writeFile(join(world.root, 'small.txt'), 'b'.repeat(2_000));
    const line = await world.createSecretary('k2-query-line');
    const goal = world.goals.first;
    let sequence = 0;
    const usedCallIds = new Set<string>();
    const round = async (label: string, replies: readonly K2Reply[], recipient: S6ASession | null = line) => {
      const before = world.model.requests.length;
      world.scriptReplies(renameRepeatedCalls(usedCallIds, label, replies));
      const submitted = await world.submit({ commandId: `k2-query-${label}-${String(++sequence)}`,
        goalId: goal.goalId, text: `K2 ${label}`, continues: null, recipient });
      if (submitted.status !== 'queued' || submitted.secretary === null) {
        throw new Error(`K2: the request ${label} was not queued: ${JSON.stringify(submitted)}`);
      }
      let view = await world.readRequest(submitted.requestRoot);
      for (let attempt = 0; attempt < 2400
        && view.rounds.find(entry => entry.ref.queryJobId === submitted.round.queryJobId)?.status !== 'ended'; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
        view = await world.readRequest(submitted.requestRoot);
      }
      if (view.rounds.find(entry => entry.ref.queryJobId === submitted.round.queryJobId)?.status !== 'ended') {
        throw new Error(`timed out waiting for the K2 round ${label}: ${JSON.stringify(view)}`);
      }
      void view;
      return { requests: world.model.requests.slice(before),
        secretary: submitted.secretary, queryJobId: submitted.round.queryJobId };
    };
    const history = async (limit = 200): Promise<SessionHistoryEntry[]> => historyOf(world, line.ref, limit);
    return {
      world, line, goal, round,
      requests: () => world.model.requests,
      history,
      async records() {
        return kernelRecordsOf(world, line.ref);
      },
      async close() {
        await world.close().catch(() => undefined);
        await rm(settingsDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    await rm(settingsDirectory, { recursive: true, force: true });
    throw error;
  }
}
