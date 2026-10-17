/**
 * Slice 4C-2 session A rework: rows D-03, D-10, D-15 (reminder part), D-18 and
 * NE6, plus the immediate-send rule (missed 2 / ruling 8) and the real
 * recipient resolver.
 *
 * Part 1 pins the §11.5 counting rules over the real `platform.notes`
 * (`readScribeTodos`) on a real memory platform: only pending notes with an
 * empty live `userReasonsOf` count, and a pending understanding overridden by a
 * newer current version stays a scribe to-do (D-15).
 *
 * Part 2 runs a REAL `createLocalWorkbenchHost` over the SAME SQLite store as a
 * real `S4ANoteFixture` platform: the persisted notes/sessions are produced by
 * the real services, the reminder's to-do read is the production
 * `readScribeTodos` (a counting wrapper delegates to the real port), the sender
 * is the real platform mailbox sender, and the recipient resolver is the real
 * one.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions,
  type WorkbenchWorkspaceConfig,
} from '../../src/app/host.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ArchiveTaskChoiceV1 } from '../../src/contracts/core/session-archive.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { NoteScribeTodoPort, NoteScribeTodosV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createS4ANoteFixture, type S4ANoteFixture } from '../helpers/S4A-note-fixture.js';
import { createScriptedModel, type ScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { C2_SKILL_ROOT } from '../helpers/C2-runtime-platform-fixture.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { attentionConfig } from '../helpers/orchestration-fixture.js';

const scope = { projectId: 's4c2-scribe-project', workspaceId: 's4c2-scribe-workspace' };

function goalAnchor(goalId: string): NoteDraftV1['anchor'] { return { kind: 'goal', goalId }; }

function general(goalId: string, topic: string): NoteDraftV1 {
  return { kind: 'convention', topic, conclusion: `结论 ${topic}`, body: `正文 ${topic}`,
    anchor: goalAnchor(goalId), extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [] };
}

function understanding(goalId: string, topic: string, structural: boolean): NoteDraftV1 {
  return { kind: 'understanding', topic, conclusion: `理解 ${topic}`,
    sections: { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' },
    anchor: goalAnchor(goalId), extraAnchors: [], facts: [], basisFiles: [], structural,
    replaces: [], contradicts: [], coexistWith: [] };
}

async function writeNote(f: S4ANoteFixture, ctx: CoreCallContext, draft: NoteDraftV1,
  goalId: string | null): Promise<WriteResult<unknown>> {
  return f.write(ctx, draft, goalId) as Promise<WriteResult<unknown>>;
}

async function scribeRead(f: S4ANoteFixture, goalId: string): Promise<NoteScribeTodosV1[]> {
  const read = await f.platform.notes.readScribeTodos(f.ctx(), { goalIds: [goalId] });
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw Error('readScribeTodos was not ready');
  return read.value;
}

it('S4C2 D-10 counts only pending notes the scribe can act on', async () => {
  const f = await createS4ANoteFixture('memory', { anchorQuota: 1 });
  try {
    const goalId = f.goalRef.goalId;
    // A real executor Run writes; a user write would bypass the quota.
    const agent = f.workCtx(await f.claimRun('d10'));
    // Fill the one current slot so every further plain note is `quota_full`.
    expect((await writeNote(f, agent, general(goalId, 'fill'), goalId)).status).toBe('accepted');
    for (let index = 0; index < 9; index += 1) {
      expect((await writeNote(f, agent, general(goalId, `plain-${String(index)}`), goalId)).status).toBe('pending_review');
    }
    // One structural understanding is pending but carries a live user reason.
    expect((await writeNote(f, agent, understanding(goalId, 'structural', true), goalId)).status).toBe('pending_review');
    expect((await scribeRead(f, goalId))[0]!.pending).toHaveLength(9);
    // A tenth plain pending reaches the threshold.
    expect((await writeNote(f, agent, general(goalId, 'plain-9'), goalId)).status).toBe('pending_review');
    expect((await scribeRead(f, goalId))[0]!.pending).toHaveLength(10);
    // One entry per input goal, then EXACTLY ONE goal-less entry.
    expect((await scribeRead(f, goalId)).map(entry => entry.goalId)).toEqual([goalId, null]);
    expect((await scribeRead(f, goalId))[1]!.pending).toEqual([]);
  } finally { await f.close(); }
});

it('S4C2 D-15 counts a pending understanding overridden by a newer current version', async () => {
  const f = await createS4ANoteFixture('memory');
  try {
    const goalId = f.goalRef.goalId;
    const agent = f.workCtx(await f.claimRun('d15'));
    expect((await writeNote(f, agent, understanding(goalId, 'old', true), goalId)).status).toBe('pending_review');
    // The user writes the newer current understanding of the SAME anchor.
    const newer = await writeNote(f, f.ctx(), understanding(goalId, 'new', false), goalId);
    expect(newer.status).toBe('accepted');
    const entries = await scribeRead(f, goalId);
    expect(entries[0]!.pending.map(todo => todo.noteId)).toHaveLength(1);
    expect(entries[0]!.pending[0]!.updateDue).toBe(false);
    expect(entries[0]!.pending[0]!.identity).toMatch(/@\d+$/);
  } finally { await f.close(); }
});

// --------------------------------------------------------------------------
// The real Host over the real SQLite store
// --------------------------------------------------------------------------

type Sent = { requestId: string; text: string };

type RealScribe = {
  f: S4ANoteFixture;
  host: LocalWorkbenchHost;
  scribeRef: SessionRef;
  counters: { cursor: number; todos: number };
  sent: Sent[];
  clock: { ms: number };
  /** The executor Run context the pending notes were written with (null with none). */
  writer: CoreCallContext | null;
  close: () => Promise<void>;
};

const HOST_CLOCK_START = 1_000_000;

function workspaceOf(f: S4ANoteFixture): WorkbenchWorkspaceConfig {
  return { scope: f.scope, name: 's4c2 real scribe workspace', root: f.root, workspaceRevision: 1,
    readPrefixes: ['.'] };
}

function hostOptionsFor(f: S4ANoteFixture, clock: { ms: number }, port: NoteScribeTodoPort | undefined,
  send: NonNullable<LocalWorkbenchHostOptions['sendScribeReminder']>): LocalWorkbenchHostOptions {
  return {
    storage: { kind: 'sqlite', directory: join(dirname(f.root), 'storage') },
    actor: { kind: 'human', id: 's4a-operator' },
    workspaces: [workspaceOf(f)],
    kernelStores: { entries: [{ adapterId: 's4a-kernel', storeKey: 's4a-kernel-store', workspace: f.scope,
      databasePath: join(dirname(f.root), 'kernel.sqlite') }] },
    now: () => new Date(clock.ms).toISOString(),
    ...(port === undefined ? {} : { noteScribeTodos: port }),
    sendScribeReminder: send,
    scribeReminderPeriodMs: 60_000,
    attention: [{
      scope: f.scope, targetSession: null, goalRef: null, paths: ['README.md'], maxBytes: 4096,
      config: attentionConfig({ heartbeatMs: 5, maxCoalesceMs: 50,
        files: { minChangedLines: 1, minRatio: 1, scopePrefixes: ['.'] } }),
    }],
  };
}

function countingPort(f: S4ANoteFixture, counters: { cursor: number; todos: number }): NoteScribeTodoPort {
  return {
    async readLedgerCursor(ctx) {
      counters.cursor += 1;
      return f.platform.notes.readLedgerCursor(ctx);
    },
    async readScribeTodos(ctx, input) {
      counters.todos += 1;
      return f.platform.notes.readScribeTodos(ctx, input);
    },
  };
}

/**
 * A real Host on the SAME SQLite directory as `f`, with a mutable injected
 * clock, a 60 s reminder period and a 5 ms attention heartbeat (so the loop
 * spins). The send wrapper delegates to the real mailbox sender and records the
 * request id.
 */
async function startHostOn(f: S4ANoteFixture, scribeRef: SessionRef, options: {
  clock?: { ms: number }; port?: NoteScribeTodoPort;
  /** Use the PRODUCTION to-do port (omit `noteScribeTodos` entirely). */
  realPort?: boolean; failFirstSend?: boolean; writer?: CoreCallContext;
} = {}): Promise<RealScribe> {
  const clock = options.clock ?? { ms: HOST_CLOCK_START };
  const counters = { cursor: 0, todos: 0 };
  const port = options.realPort === true ? undefined : (options.port ?? countingPort(f, counters));
  const sent: Sent[] = [];
  let failOnce = options.failFirstSend ?? false;
  const send = (async (ctx: CoreCallContext, request: { input: { recipient: SessionRef; text: string };
    meta: { requestId: string } }) => {
    sent.push({ requestId: request.meta.requestId, text: request.input.text });
    if (failOnce) { failOnce = false; throw new Error('the first scribe send fails'); }
    return f.platform.messages.sendMessage(ctx, request as never);
  }) as NonNullable<LocalWorkbenchHostOptions['sendScribeReminder']>;
  const host = await createLocalWorkbenchHost(hostOptionsFor(f, clock, port, send));
  return { f, host, scribeRef, counters, sent, clock, writer: options.writer ?? null,
    close: async () => { await host.close(); await f.close(); } };
}

/** A fresh SQLite fixture plus a real Host on it. `pendingNotes` are written by
 * a real executor Run under `anchorQuota: 1` (the first accepted, the rest
 * `pending_review`). */
async function startRealScribe(options: { pendingNotes?: number; scribeRequests?: string[];
  failFirstSend?: boolean; port?: (f: S4ANoteFixture) => NoteScribeTodoPort } = {}): Promise<RealScribe> {
  const f = await createS4ANoteFixture('sqlite', { anchorQuota: 1 });
  await writeFile(join(f.root, 'README.md'), 's4c2 scribe real workspace\n');
  const scribeCreated = await f.createSession((options.scribeRequests ?? ['scribe-a'])[0]!, 'scribe');
  const scribeRef: SessionRef = { projectId: f.scope.projectId, sessionId: scribeCreated.sessionRef.sessionId };
  const pendingWanted = options.pendingNotes ?? 0;
  let writer: CoreCallContext | null = null;
  if (pendingWanted > 0) {
    writer = f.workCtx(await f.claimRun('pending-writer'));
    for (let index = 0; index <= pendingWanted; index += 1) {
      const written = await f.write(writer, general(f.goalRef.goalId, `pending-${String(index)}`), f.goalRef.goalId);
      if (index === 0 && written.status !== 'accepted') throw new Error('the first pending note must be accepted');
      if (index > 0 && written.status !== 'pending_review') throw new Error(`note ${String(index)} must be pending`);
    }
  }
  return await startHostOn(f, scribeRef, {
    ...(options.failFirstSend === undefined ? {} : { failFirstSend: options.failFirstSend }),
    ...(options.port === undefined ? {} : { port: options.port(f) }),
    ...(writer === null ? {} : { writer }),
  });
}

/**
 * Two real scribe Sessions on one SQLite fixture plus a real Host. The fixture
 * gets a deterministic note id generator (`s4c2-note-01`, `s4c2-note-02`, ...),
 * so the D-03 identity list and its sha256 are pinned literals in the test and
 * are never recomputed from the write results.
 */
type RealScribePair = {
  f: S4ANoteFixture;
  host: LocalWorkbenchHost;
  /** Ascending by sessionId; the resolver picks `lowest`. */
  scribes: SessionRef[];
  lowest: SessionRef;
  remaining: SessionRef;
  counters: { cursor: number; todos: number };
  sent: Sent[];
  clock: { ms: number };
  writer: CoreCallContext;
  close: () => Promise<void>;
};

async function startRealScribePair(options: { failFirstSend?: boolean } = {}): Promise<RealScribePair> {
  let noteSeq = 0;
  const f = await createS4ANoteFixture('sqlite', { anchorQuota: 1,
    noteNewId: () => `s4c2-note-${String(++noteSeq).padStart(2, '0')}` });
  await writeFile(join(f.root, 'README.md'), 's4c2 scribe pair workspace\n');
  const created: SessionRef[] = [];
  for (const requestId of ['scribe-pair-a', 'scribe-pair-b']) {
    const session = await f.createSession(requestId, 'scribe');
    created.push({ projectId: f.scope.projectId, sessionId: session.sessionRef.sessionId });
  }
  const scribes = [...created].sort((left, right) =>
    left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0);
  const writer = f.workCtx(await f.claimRun('pair-writer'));
  for (let index = 0; index <= 10; index += 1) {
    const written = await f.write(writer, general(f.goalRef.goalId, `pair-${String(index)}`), f.goalRef.goalId);
    if (index === 0) {
      if (written.status !== 'accepted') throw new Error('the first pair note must be accepted');
    } else {
      if (written.status !== 'pending_review') throw new Error(`pair note ${String(index)} must be pending`);
      if (written.version !== 1) throw new Error(`pair note ${String(index)} must start at version 1`);
    }
  }
  const clock = { ms: HOST_CLOCK_START };
  const counters = { cursor: 0, todos: 0 };
  const port = countingPort(f, counters);
  const sent: Sent[] = [];
  let failOnce = options.failFirstSend ?? false;
  const send = (async (ctx: CoreCallContext, request: { input: { recipient: SessionRef; text: string };
    meta: { requestId: string } }) => {
    sent.push({ requestId: request.meta.requestId, text: request.input.text });
    if (failOnce) { failOnce = false; throw new Error('the first pair send fails'); }
    return f.platform.messages.sendMessage(ctx, request as never);
  }) as NonNullable<LocalWorkbenchHostOptions['sendScribeReminder']>;
  const host = await createLocalWorkbenchHost(hostOptionsFor(f, clock, port, send));
  return { f, host, scribes, lowest: scribes[0]!, remaining: scribes[1]!, counters, sent, clock, writer,
    close: async () => { await host.close(); await f.close(); } };
}

/** The real `SessionLifecyclePort.archiveSession` through the platform owner. */
async function archiveScribe(f: S4ANoteFixture, ref: SessionRef, requestId: string): Promise<void> {
  const card = await f.platform.sessions.readSession(f.ctx(), ref);
  if (card.status !== 'ready') throw new Error(`the scribe Session must be readable: ${JSON.stringify(card)}`);
  const result = await f.platform.sessions.archiveSession(f.ctx(), {
    input: { sessionRef: ref, reason: 'archive the lowest scribe to change the recipient' },
    meta: { requestId, expected: [{ ref: plainSessionRefToAggregate(ref), revision: card.value.record.revision }] },
  });
  if (result.status !== 'committed') throw new Error(`the scribe archive did not commit: ${JSON.stringify(result)}`);
}

async function inboxOfRef(f: S4ANoteFixture, recipient: SessionRef): Promise<SessionMessage[]> {
  const read = await f.platform.messages.readInbox(f.ctx(), { recipient, page: { limit: 100 } });
  if (read.status !== 'ready') throw new Error('the recipient inbox is not readable');
  return read.value.items;
}

/** The WHOLE inbox, following `nextCursor` past the 100-per-page boundary. */
async function fullInboxOf(f: S4ANoteFixture, recipient: SessionRef): Promise<SessionMessage[]> {
  const items: SessionMessage[] = [];
  let cursor: string | undefined;
  do {
    const read = await f.platform.messages.readInbox(f.ctx(), { recipient,
      page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) } });
    if (read.status !== 'ready') throw new Error('the recipient inbox is not readable');
    items.push(...read.value.items);
    cursor = read.value.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
}

async function waitFor(check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!check()) throw new Error('the scribe reminder condition did not settle in time');
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function inboxOf(started: RealScribe): Promise<SessionMessage[]> {
  const read = await started.f.platform.messages.readInbox(started.f.ctx(), { recipient: started.scribeRef,
    page: { limit: 100 } });
  if (read.status !== 'ready') throw new Error('the recipient inbox is not readable');
  return read.value.items;
}

// --------------------------------------------------------------------------
// The fixture-level SQLite backend wrapper (same pattern as
// tests/work-graph/S4C2-read-counts.test.ts:38-70). It is a FAULT injection
// seam only: it can fail exactly ONE real read of a chosen Run (turning one
// genuine completed Run read into `unavailable` once, then serving it for
// real) and fail one inbox page read. It never rewrites a record body, never
// injects an `acceptedInput` and never fakes a Run's state. It is installed
// BEFORE the fixture and the Host so both use the wrapped backend.
// --------------------------------------------------------------------------

type BackendControls = {
  /** The next `readMany` naming this Run refKey answers `unavailable` once. */
  failRunRefKeyOnce: string | null;
  /** Arm `failRunRefKeyOnce` only when the recipient inbox page returns this
   * reminder, so the disposition's completion read — never a startup read — is
   * the one failed read. */
  armRunFailOnReminder: { reminderRefKey: string; runRefKey: string } | null;
  failInboxPage2Once: boolean;
  failedRunReads: number;
  failedPageReads: number;
};

type WrappableBatch = { status: 'ready'; value: { records: EncodedRecord[] } }
  | { status: 'rejected'; code: string; reason: string };

async function installSqliteBackendWrapper(controls: BackendControls): Promise<() => void> {
  const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
  const original = sqliteBackend.createSqliteRecordBackend;
  const spy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend').mockImplementation(optionsIn => {
    const backend = original(optionsIn);
    const records = (backend as unknown as {
      records: {
        readMany(refKeys: readonly string[]): Promise<WrappableBatch>;
        lookup(request: RecordLookupRequest): Promise<WrappableBatch>;
      };
    }).records;
    const wrapped = {
      ...(records as object),
      async readMany(refKeys: readonly string[]): Promise<WrappableBatch> {
        if (controls.failRunRefKeyOnce !== null && refKeys.includes(controls.failRunRefKeyOnce)) {
          controls.failRunRefKeyOnce = null;
          controls.failedRunReads += 1;
          return { status: 'rejected', code: 'unavailable', reason: 'injected Run read failure' };
        }
        return records.readMany(refKeys);
      },
      async lookup(request: RecordLookupRequest): Promise<WrappableBatch> {
        if (controls.failInboxPage2Once && request.index === 'session-message-by-recipient' && request.after !== null) {
          controls.failInboxPage2Once = false;
          controls.failedPageReads += 1;
          return { status: 'rejected', code: 'unavailable', reason: 'injected inbox page read failure' };
        }
        const result = await records.lookup(request);
        if (result.status === 'ready' && controls.armRunFailOnReminder !== null
          && request.index === 'session-message-by-recipient'
          && result.value.records.some(record => record.refKey === controls.armRunFailOnReminder!.reminderRefKey)) {
          const arm = controls.armRunFailOnReminder;
          controls.armRunFailOnReminder = null;
          controls.failRunRefKeyOnce = arm.runRefKey;
        }
        return result;
      },
    };
    return { ...(backend as object), records: wrapped } as never;
  });
  return () => { spy.mockRestore(); };
}

function freshBackendControls(): BackendControls {
  return { failRunRefKeyOnce: null, armRunFailOnReminder: null, failInboxPage2Once: false,
    failedRunReads: 0, failedPageReads: 0 };
}

/**
 * The trusted Host runtime binding for item 2: a local scripted model whose one
 * text reply completes the Run. It accepts only the fixture's scope and copies
 * the WP2 Host binding shape (tests/helpers/WP2-platform-support.ts:326-418).
 */
function item2RuntimeHost(scopeOf: () => { projectId: string; workspaceId: string }):
  { host: RuntimeHostBindings; scripted: ScriptedModel } {
  const scripted = createScriptedModel([{ kind: 'text', text: 'S4C2 item 2 completes' }]);
  const host: RuntimeHostBindings = {
    async resolveConfiguration(ctx, request) {
      const bound = scopeOf();
      if (ctx.projectId !== bound.projectId || ctx.workspaceId !== bound.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'item 2 Host is not bound to this scope' };
      }
      if (request.roleResolution.status === 'inadmissible') {
        return { status: 'rejected', code: 'forbidden', reason: 'item 2 Host refuses the current Role' };
      }
      return { status: 'ready', value: {
        configurationRevision: 's4c2-item2-host@1',
        model: { configuration: { revision: 's4c2-item2-host@1', provider: 'deepseek', model: 's4c2-local-scripted',
          baseUrl: 'http://127.0.0.1' }, client: scripted.client,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const,
            tokenizer: 's4c2-item2-counter' }) } },
        budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 12,
          maxToolCalls: 16, timeoutMs: 30000, perResponseTokens: 512 },
        tools: [],
        writeScope: [],
        hostTemplate: request.role.kind === 'legacy_template'
          ? { templateId: request.role.templateId, revision: request.role.templateRevision,
            digest: sha256Hex('s4c2 item 2 host template') } : null,
        skills: { resourceRoot: C2_SKILL_ROOT, enabledIds: [] },
        systemInstruction: null,
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
  return { host, scripted };
}

/** Drive the real Runtime over a real claim to a terminal Run. */
async function prepareAndCompleteRun(f: S4ANoteFixture, runRef: RunRef, requestId: string): Promise<void> {
  const prepared = await f.platform.runtime.prepareExecution(f.ctx(), { runRef, requestId });
  if (prepared.status !== 'ready') throw new Error(`item 2 prepare: ${JSON.stringify(prepared)}`);
  const started = await f.platform.runtime.startRun(f.ctx(), { prepared: prepared.value,
    consumerId: 's4c2-item2-driver', requestId: `${requestId}-start` });
  if (started.status !== 'ready') throw new Error(`item 2 start: ${JSON.stringify(started)}`);
}

// --------------------------------------------------------------------------
// D-03 fixed literals. The fixture's deterministic `noteNewId` produces
// `s4c2-note-01`, `s4c2-note-02`, ...; `session-directory.ts` derives Session
// ids deterministically from (host actor, projectId, meta.requestId). The
// sorted identity list, its sha256 and the full request ids are pinned here and
// are NEVER recomputed from a write result or a live session read.
// --------------------------------------------------------------------------
const D03_WORKSPACE = 's4a-workspace';
/** The 10 pending notes' identities, sorted ascending. */
const D03_IDENTITIES: readonly string[] = ['s4c2-note-02@1', 's4c2-note-03@1', 's4c2-note-04@1',
  's4c2-note-05@1', 's4c2-note-06@1', 's4c2-note-07@1', 's4c2-note-08@1', 's4c2-note-09@1',
  's4c2-note-10@1', 's4c2-note-11@1'];
/** `sha256Hex(canonicalJson(D03_IDENTITIES))`, precomputed. */
const D03_DIGEST = '52fb73e4f4ad9a4fe278eb7c62f4d326f52317ca07250c4a44d4a055dfbf9b11';
/** The `s4a-admit-scribe-pair-b` Session: the smaller id, so the resolver's `lowest`. */
const D03_LOWEST_SESSION = 'session-0a4e047c44c759fc33d12806132b5f6dc5f7a7f9aad6570c516c6bbd2be67f61';
/** The `s4a-admit-scribe-pair-a` Session: the larger id, so after the archive the `remaining`. */
const D03_REMAINING_SESSION = 'session-1d714093ba7bb9baa5f20ae6222074476d9332e754e9b121b120c5453e730a60';
const D03_LOWEST_REQUEST_ID = `scribe-reminder:${D03_WORKSPACE}:${D03_LOWEST_SESSION}:${D03_DIGEST}`;
const D03_REMAINING_REQUEST_ID = `scribe-reminder:${D03_WORKSPACE}:${D03_REMAINING_SESSION}:${D03_DIGEST}`;

it('S4C2 D-03 sends the literal requestId, then re-owner to the remaining scribe after a public archive', async () => {
  const started = await startRealScribePair();
  try {
    await waitFor(() => started.sent.length === 1);
    expect(started.sent).toHaveLength(1);
    expect(started.sent[0]!.text).toContain('待审 10 条');

    // The deterministic fixture names match the pinned literals.
    expect(started.lowest.sessionId).toBe(D03_LOWEST_SESSION);
    expect(started.remaining.sessionId).toBe(D03_REMAINING_SESSION);
    expect(D03_IDENTITIES).toHaveLength(10);
    expect(D03_IDENTITIES.every(identity => /@1$/.test(identity))).toBe(true);
    // Consistency only; the request id below uses the literal digest.
    expect(sha256Hex(canonicalJson([...D03_IDENTITIES] as never))).toBe(D03_DIGEST);
    expect(started.sent[0]!.requestId).toBe(D03_LOWEST_REQUEST_ID);

    // It really persisted, once, to the lowest scribe.
    expect(await inboxOfRef(started.f, started.lowest)).toHaveLength(1);
    expect(await inboxOfRef(started.f, started.remaining)).toHaveLength(0);

    // The SAME identity set and cursor send no second message.
    const before = started.counters.cursor;
    started.clock.ms += 60_000;
    await waitFor(() => started.counters.cursor > before);
    await sleep(120);
    expect(started.sent).toHaveLength(1);

    // A real ledger event: archive the lowest scribe through the public owner.
    await archiveScribe(started.f, started.lowest, 'd03-archive-lowest');

    started.clock.ms += 60_000;
    await waitFor(() => started.sent.length === 2);
    expect(started.sent).toHaveLength(2);
    expect(started.sent[1]!.requestId).toBe(D03_REMAINING_REQUEST_ID);
    expect(started.sent[1]!.requestId).not.toBe(started.sent[0]!.requestId);
    expect(started.sent[1]!.requestId).not.toContain(D03_LOWEST_SESSION);
    // Exactly one reminder reached the remaining scribe.
    expect(await inboxOfRef(started.f, started.remaining)).toHaveLength(1);
  } finally { await started.close(); }
}, 60_000);

it('S4C2 item 2: a public completion + one new pending note, one failed Run read blocks a period', async () => {
  const controls = freshBackendControls();
  const restore = await installSqliteBackendWrapper(controls);
  let fixtureRef: S4ANoteFixture | undefined;
  const runtime = item2RuntimeHost(() => ({
    projectId: fixtureRef!.scope.projectId, workspaceId: fixtureRef!.scope.workspaceId }));
  let first: RealScribe | undefined;
  let second: RealScribe | undefined;
  try {
    const f = await createS4ANoteFixture('sqlite', { anchorQuota: 1, runtime: runtime.host });
    fixtureRef = f;
    await writeFile(join(f.root, 'README.md'), 's4c2 item2 workspace\n');
    const created = await f.createSession('item2-scribe', 'scribe');
    const scribeRef: SessionRef = { projectId: f.scope.projectId, sessionId: created.sessionRef.sessionId };
    const writer = f.workCtx(await f.claimRun('item2-writer'));
    for (let index = 0; index <= 10; index += 1) {
      const written = await f.write(writer, general(f.goalRef.goalId, `item2-${String(index)}`), f.goalRef.goalId);
      if (index === 0) expect(written.status).toBe('accepted');
      else expect(written.status).toBe('pending_review');
    }

    // Host A sends the real old reminder (10 pending), which really persists.
    first = await startHostOn(f, scribeRef, { clock: { ms: HOST_CLOCK_START } });
    await waitFor(() => first!.sent.length === 1);
    const oldRequestId = first.sent[0]!.requestId;
    const reminder = (await inboxOf(first))[0]!;
    await first.host.close();
    first = undefined;

    // The old reminder's completion through the PUBLIC execution chain: a real
    // Run in the scribe Session is prepared and started by the trusted Runtime
    // to ended/completed. The Runtime's own `confirmMailboxInputs` found the
    // original Kernel `run.input_accepted` event and called the mailbox owner's
    // `recordInputAccepted`, so the persisted reminder carries the real accepted
    // input. Nothing here rewrites a record body or fakes a Run's state.
    const runRef = await f.claimInSession('item2-old-reminder', scribeRef, 't3', 'scribe');
    await prepareAndCompleteRun(f, runRef, 'item2-old-reminder');
    expect(runtime.scripted.calls()).toBe(1);
    const finished = await f.platform.executions.readExecution(f.ctx(), runRef);
    if (finished.status !== 'ready') throw new Error(`item 2 run read: ${JSON.stringify(finished)}`);
    expect(finished.value.run).toMatchObject({ status: 'ended', outcome: 'completed' });
    const history = finished.value.run.executionHistory;
    if (history === undefined) throw new Error('the completed Run has no executionHistory');

    // Read the acceptance through the public inbox; it names the real Run.
    const afterAccept = await inboxOfRef(f, scribeRef);
    expect(afterAccept).toHaveLength(1);
    const acceptedInput = afterAccept[0]!.acceptedInputs?.[0];
    expect(acceptedInput).toMatchObject({ part: 'message', executionRef: runRef });
    expect(acceptedInput?.kernel).toMatchObject(history.kernel);
    // Replaying the SAME real Kernel identity through the public mailbox owner
    // is idempotent (the original acceptance came from the Runtime, not here).
    const recordAccepted = f.platform.messages.recordInputAccepted;
    if (recordAccepted === undefined) throw new Error('the mailbox owner does not expose recordInputAccepted');
    const replayed = await recordAccepted.call(f.platform.messages, f.ctx(), {
      input: { messageRef: reminder.ref, part: 'message', executionRef: runRef,
        executionSessionRef: scribeRef, kernel: acceptedInput!.kernel },
      meta: { requestId: 'item2-accept-old-reminder-replay', expected: [] },
    });
    expect(replayed).toMatchObject({ status: 'committed', replayed: true });

    // Exactly ONE new pending note, written publicly by the executor Run.
    const extra = await f.write(writer, general(f.goalRef.goalId, 'item2-new-pending'), f.goalRef.goalId);
    expect(extra.status).toBe('pending_review');

    // Host B: exactly ONE real Run read fails once, on the disposition's
    // completion read triggered by the reminder's inbox page; later reads are
    // real. This is fault injection only (no record body is rewritten).
    controls.armRunFailOnReminder = { reminderRefKey: canonicalJson(reminder.ref as never),
      runRefKey: canonicalJson(runRef as never) };
    second = await startHostOn(f, scribeRef, { clock: { ms: HOST_CLOCK_START + 60_000 } });
    await waitFor(() => controls.failedRunReads >= 1);
    await sleep(120);
    expect(controls.failedRunReads).toBe(1);
    expect(second.counters.todos).toBe(0); // `unknown` returned before the to-do read
    expect(second.sent).toHaveLength(0); // unknown: nothing sent, cursor left unset
    expect(await fullInboxOf(f, scribeRef)).toHaveLength(1);

    // The next period reads the Run for real (completed); the new 11-note set
    // sends exactly once and persists exactly one new message.
    second.clock.ms += 60_000;
    await waitFor(() => second!.sent.length === 1);
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0]!.requestId).toContain(scribeRef.sessionId);
    expect(second.sent[0]!.requestId).not.toBe(oldRequestId);
    expect(second.sent[0]!.text).toContain('待审 11 条');
    // The recipient's inbox (not the send wrapper alone) shows exactly one new
    // persisted message.
    const inbox = await fullInboxOf(f, scribeRef);
    expect(inbox).toHaveLength(2);
    expect(inbox.filter(message => message.sender.kind === 'host' && message.intent === 'notify')).toHaveLength(2);
  } finally {
    if (first !== undefined) await first.host.close();
    if (second !== undefined) await second.host.close();
    if (fixtureRef !== undefined) await fixtureRef.close();
    restore();
  }
}, 60_000);

it('S4C2 item 3: after the cursor moves the stale send is never retried to the old recipient', async () => {
  const started = await startRealScribePair({ failFirstSend: true });
  try {
    await waitFor(() => started.sent.length === 1);
    expect(started.sent).toHaveLength(1);
    expect(started.sent[0]!.requestId).toContain(started.lowest.sessionId);
    expect(await inboxOfRef(started.f, started.lowest)).toHaveLength(0); // nothing persisted

    // A real ledger event: archive the lowest scribe through the public owner.
    await archiveScribe(started.f, started.lowest, 'item3-archive-lowest');

    started.clock.ms += 60_000;
    await waitFor(() => started.sent.length === 2);
    expect(started.sent).toHaveLength(2);
    // The retry must use B's new request id, never A's old one.
    expect(started.sent[1]!.requestId).toContain(started.remaining.sessionId);
    expect(started.sent[1]!.requestId).not.toContain(started.lowest.sessionId);
    expect(started.sent[1]!.requestId).not.toBe(started.sent[0]!.requestId);
    expect(await inboxOfRef(started.f, started.remaining)).toHaveLength(1);
    expect(await inboxOfRef(started.f, started.lowest)).toHaveLength(0);
  } finally { await started.close(); }
}, 60_000);

it('S4C2 item 7: a restarted Host does not re-send an unhandled reminder (whole-inbox recovery)', async () => {
  const started = await startRealScribe({ pendingNotes: 10 });
  let restarted: RealScribe | undefined;
  try {
    await waitFor(() => started.sent.length === 1);
    expect(await inboxOf(started)).toHaveLength(1);
    await started.host.close();

    // An 11th pending note lands after Host A stopped, through the SAME Run.
    const extra = await started.f.write(started.writer!, general(started.f.goalRef.goalId, 'pending-extra'),
      started.f.goalRef.goalId);
    expect(extra.status).toBe('pending_review');

    // Host B starts on the SAME directory and runs one check.
    restarted = await startHostOn(started.f, started.scribeRef, { clock: { ms: HOST_CLOCK_START + 60_000 } });
    await waitFor(() => restarted!.counters.cursor >= 1);
    await sleep(120);
    expect(restarted.sent).toHaveLength(0);
    expect(await inboxOf(restarted)).toHaveLength(1);
  } finally {
    if (restarted !== undefined) await restarted.host.close();
    await started.f.close();
  }
}, 60_000);

it('S4C2 item 5: the restart recovery crosses inbox pages and a failed page read sends nothing', async () => {
  const controls = freshBackendControls();
  const restore = await installSqliteBackendWrapper(controls);
  let started: RealScribe | undefined;
  let restarted: RealScribe | undefined;
  try {
    started = await startRealScribe({ pendingNotes: 10 });
    await waitFor(() => started!.sent.length === 1);
    const reminder = (await inboxOf(started))[0]!;
    await started.host.close();
    const reminderKey = canonicalJson(reminder.ref as never);
    if (reminder.sender.kind !== 'host') throw new Error('the reminder sender must be the host');
    const senderIdentity = { kind: 'host', actor: { ...reminder.sender.actor } };

    // At least 100 REAL filler messages whose canonical refKeys sort BEFORE the
    // reminder, so the Host's 100-per-page read must cross a page boundary to
    // find the older unhandled reminder on page 2.
    let fillers = 0;
    for (let index = 0; fillers < 100; index += 1) {
      const requestId = `restart-filler-${String(index)}`;
      const messageId = 'session-message-' + sha256Hex(canonicalJson({
        projectId: started.f.scope.projectId, workspaceId: started.f.scope.workspaceId,
        sender: senderIdentity, requestId } as never));
      const fillerKey = canonicalJson({ aggregateType: 'SessionMessage', projectId: started.f.scope.projectId,
        workspaceId: started.f.scope.workspaceId, messageId } as never);
      if (fillerKey >= reminderKey) continue;
      const sentFiller = await started.f.platform.messages.sendMessage(started.f.ctx(), {
        input: { recipient: started.scribeRef, text: 'restart filler' },
        meta: { requestId, expected: [] },
      });
      if (sentFiller.status !== 'committed') throw new Error(`filler ${requestId} did not commit`);
      fillers += 1;
    }
    expect(fillers).toBe(100);
    expect(await fullInboxOf(started.f, started.scribeRef)).toHaveLength(101);

    // One failed second-page lookup is `unknown`: nothing is sent and the
    // computed cursor stays unset.
    controls.failInboxPage2Once = true;
    restarted = await startHostOn(started.f, started.scribeRef,
      { clock: { ms: HOST_CLOCK_START + 60_000 }, writer: started.writer! });
    await waitFor(() => controls.failedPageReads >= 1);
    await sleep(120);
    expect(restarted.sent).toHaveLength(0);

    // The next period re-pages both pages, finds the older unhandled reminder
    // on page 2 and still sends nothing; no duplicate message appears.
    const cursorsBefore = restarted.counters.cursor;
    restarted.clock.ms += 60_000;
    await waitFor(() => restarted!.counters.cursor > cursorsBefore);
    await sleep(120);
    expect(restarted.sent).toHaveLength(0);
    expect(await fullInboxOf(restarted.f, restarted.scribeRef)).toHaveLength(101);
  } finally {
    if (restarted !== undefined) await restarted.host.close();
    if (started !== undefined) { await started.host.close(); await started.f.close(); }
    restore();
  }
}, 120_000);

it('S4C2 real recipient resolver: two scribes, the smallest session id wins', async () => {
  const f = await createS4ANoteFixture('sqlite');
  try {
    const first = await f.createSession('scribe-b', 'scribe');
    const second = await f.createSession('scribe-a', 'scribe');
    const ids = [first.sessionRef.sessionId, second.sessionRef.sessionId].sort();
    const resolved = await f.platform.notes.resolveScribeRecipient(f.ctx());
    expect(resolved.status).toBe('ready');
    if (resolved.status !== 'ready') throw new Error('the scribe resolver was not ready');
    expect(resolved.value?.sessionId).toBe(ids[0]);
  } finally { await f.close(); }
});

it('S4C2 NE6: the cursor/period gate reads the injected clock and skips unchanged cursors', async () => {
  const started = await startRealScribe({ pendingNotes: 9 });
  try {
    await waitFor(() => started.counters.cursor >= 1 && started.counters.todos >= 1);
    expect(started.sent).toHaveLength(0); // below the pending threshold
    expect(started.counters.cursor).toBe(1);
    expect(started.counters.todos).toBe(1);

    // 59,999 ms is still inside the period: the loop spins, the reads do not.
    started.clock.ms += 59_999;
    await sleep(150);
    expect(started.counters.cursor).toBe(1);
    expect(started.counters.todos).toBe(1);

    // 60,000 ms: the cursor is unchanged, so the to-dos are NOT re-read.
    started.clock.ms += 1;
    await waitFor(() => started.counters.cursor >= 2);
    expect(started.counters.cursor).toBe(2);
    expect(started.counters.todos).toBe(1);

    // A real commit moves the cursor; the next period re-reads the to-dos.
    const written = await started.f.write(started.writer!, general(started.f.goalRef.goalId, 'ne6-extra'),
      started.f.goalRef.goalId);
    expect(written.status).toBe('pending_review');
    started.clock.ms += 60_000;
    await waitFor(() => started.counters.cursor >= 3 && started.counters.todos >= 2);
    expect(started.counters.cursor).toBe(3);
    expect(started.counters.todos).toBe(2);
  } finally { await started.close(); }
}, 60_000);

it('S4C2 D-18: a failed send retries the SAME requestId without re-reading the to-dos', async () => {
  const started = await startRealScribe({ pendingNotes: 10, failFirstSend: true });
  try {
    await waitFor(() => started.sent.length === 1 && started.counters.todos >= 1);
    expect(started.sent).toHaveLength(1); // the failed attempt captured its request id
    expect(started.counters.todos).toBe(1);
    expect(await inboxOf(started)).toHaveLength(0); // nothing persisted yet

    const before = started.counters.cursor;
    started.clock.ms += 60_000;
    await waitFor(() => started.sent.length === 2);
    expect(started.counters.cursor).toBeGreaterThan(before);
    expect(started.counters.todos).toBe(1); // no to-do re-read on a retry
    expect(started.sent[1]!.requestId).toBe(started.sent[0]!.requestId);
    expect(await inboxOf(started)).toHaveLength(1); // the retry persisted exactly once
  } finally { await started.close(); }
}, 60_000);

// --------------------------------------------------------------------------
// Missed 2 / ruling 8: `immediate` obeys the goal anchor's baseline, on REAL
// records produced by public owners (no hand-encoded TaskRequeue/NoteHead).
// --------------------------------------------------------------------------

/**
 * Archive a live executor Session publicly: the Session holds a claimed,
 * unstarted Run, so `platform.workflow.archiveLine` submits the stop itself,
 * ends the Run `cancelled`, writes the anchor and a TaskRequeue whose real
 * `archiveOrigin` names the archived Session (session-archive.ts step 5/7).
 * No record and no `archiveOrigin` is hand-encoded. The Run must NOT be
 * pre-cancelled: that clears the Session occupancy, the request records
 * `execution:{kind:'none'}` and no requeue is ever written.
 */
async function archiveExecutionLine(f: S4ANoteFixture, requestId: string): Promise<void> {
  const ctx = f.ctx();
  const created = await f.createSession(requestId, 'executor');
  const sessionRef: SessionRef = { projectId: f.scope.projectId, sessionId: created.sessionRef.sessionId };
  await f.claimInSession(requestId, created.sessionRef, 't1', 'executor');
  const card = await f.platform.sessions.readSession(ctx, sessionRef);
  if (card.status !== 'ready') throw new Error(`the executor Session must be readable: ${JSON.stringify(card)}`);
  const tasks: ArchiveTaskChoiceV1[] = [];
  for (const link of card.value.links) {
    if (link.until !== null || link.ref.relation !== 'responsible') continue;
    const target = link.ref.target;
    if (target.kind === 'task' || target.kind === 'work') tasks.push({ target, disposition: { kind: 'drop' } });
  }
  const archived = await f.platform.workflow.archiveLine(ctx, {
    input: { sessionRef, reason: 'archive the live executor line', tasks, wait: null },
    meta: { requestId: `archive-${requestId}`,
      expected: [{ ref: card.value.record.ref, revision: card.value.record.revision }] },
  });
  if (archived.status !== 'ready' || archived.value.state !== 'archived') {
    throw new Error(`the public archive did not finish: ${JSON.stringify(archived)}`);
  }
}

/** The production to-do port's entry for the fixture's only goal. */
async function immediateEntry(f: S4ANoteFixture): Promise<NoteScribeTodosV1> {
  const read = await f.platform.notes.readScribeTodos(f.ctx(), { goalIds: [f.goalRef.goalId] });
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error(`readScribeTodos: ${JSON.stringify(read)}`);
  return read.value.find(entry => entry.goalId === f.goalRef.goalId)!;
}

/** The real archive requeue still drives an update-due anchor. */
const hasArchiveTrigger = (entry: NoteScribeTodosV1): boolean =>
  entry.updateDueTodos.some(todo => todo.latestTriggerCursor !== null
    && todo.latestTriggerCursor.startsWith('archive:t1/'));

it('S4C2 missed 2: a public archive with no later understanding is immediate; the real Host sends once', async () => {
  const f = await createS4ANoteFixture('sqlite');
  try {
    await writeFile(join(f.root, 'README.md'), 's4c2 immediate positive workspace\n');
    const scribeCreated = await f.createSession('immediate-scribe', 'scribe');
    const scribeRef: SessionRef = { projectId: f.scope.projectId, sessionId: scribeCreated.sessionRef.sessionId };
    await archiveExecutionLine(f, 'immediate-positive');

    // The production to-do port reads the real unclaimed archive requeue.
    const goal = await immediateEntry(f);
    expect(goal.immediate).toBe(true);
    expect(hasArchiveTrigger(goal)).toBe(true);

    // The REAL Host: the production to-do port (no `noteScribeTodos` override).
    const started = await startHostOn(f, scribeRef, { realPort: true });
    try {
      await waitFor(() => started.sent.length === 1);
      expect(started.sent).toHaveLength(1);
      expect(started.sent[0]!.text).toContain('待审 0 条');
      expect(started.sent[0]!.text).toContain('该更新 2 条');
      // The REAL persisted message, not the send wrapper alone.
      expect(await inboxOf(started)).toHaveLength(1);
    } finally { await started.host.close(); }
  } finally { await f.close(); }
}, 60_000);

it('S4C2 missed 2: a public understanding after the archive covers the trigger; the real Host sends nothing', async () => {
  const f = await createS4ANoteFixture('sqlite');
  try {
    await writeFile(join(f.root, 'README.md'), 's4c2 immediate negative workspace\n');
    const scribeCreated = await f.createSession('immediate-scribe-overshadowed', 'scribe');
    const scribeRef: SessionRef = { projectId: f.scope.projectId, sessionId: scribeCreated.sessionRef.sessionId };
    await archiveExecutionLine(f, 'immediate-negative');
    // A real user understanding written AFTER the archive trigger: its real
    // `createdAt` becomes the goal anchor's folded baseline.
    const written = await f.write(f.ctx(), understanding(f.goalRef.goalId, 'after the archive', false), f.goalRef.goalId);
    expect(written.status).toBe('accepted');

    // The trigger still makes the (stage) anchor update-due; only its immediacy
    // is covered, so the thresholds alone would not send.
    const goal = await immediateEntry(f);
    expect(goal.immediate).toBe(false);
    expect(hasArchiveTrigger(goal)).toBe(true);

    const started = await startHostOn(f, scribeRef, { realPort: true });
    try {
      await sleep(400);
      expect(started.sent).toHaveLength(0);
      expect(await inboxOf(started)).toHaveLength(0);
    } finally { await started.host.close(); }
  } finally { await f.close(); }
}, 60_000);

it('S4C2 D-03 claimed archive requeue: the real Host sends nothing (claim filter)', async () => {
  const f = await createS4ANoteFixture('sqlite');
  try {
    await writeFile(join(f.root, 'README.md'), 's4c2 claimed archive workspace\n');
    const scribeCreated = await f.createSession('claimed-scribe', 'scribe');
    const scribeRef: SessionRef = { projectId: f.scope.projectId, sessionId: scribeCreated.sessionRef.sessionId };
    // A real executor line is archived: `workflow.archiveLine` writes the real
    // `archiveOrigin` TaskRequeue (no hand-encoded record).
    await archiveExecutionLine(f, 'claimed-archive');

    // The real requeueRef comes from the PUBLIC task graph.
    const graph = await f.platform.plans.queryTaskGraph(f.ctx(), { goalRef: f.goalRef });
    if (graph.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(graph)}`);
    const t1 = graph.value.tasks.find(task => task.ref.taskId === 't1');
    const requeueRef = t1?.requeueRef;
    if (requeueRef === undefined) throw new Error('t1 carries no real requeueRef after the archive');

    // A brand-new work line claims t1 WITH that real requeueRef through the
    // public `claims.claimTask` (TASK-03 continuation).
    const work = await f.createSession('claimed-work', 'executor');
    const newRunRef = await f.claimInSession('claimed-work', work.sessionRef, 't1', 'executor', requeueRef);

    // The public execution read confirms the new Run carries the reference.
    const runRead = await f.platform.executions.readExecution(f.ctx(), newRunRef);
    if (runRead.status !== 'ready') throw new Error(`the new Run must be readable: ${JSON.stringify(runRead)}`);
    expect(runRead.value.run.requeueRef).toEqual(requeueRef);

    // NO understanding after the archive and the counts are below the
    // thresholds: the archive trigger is still update-due, but the real claim
    // makes the goal anchor NOT immediate (the claim filter).
    const goal = await immediateEntry(f);
    expect(hasArchiveTrigger(goal)).toBe(true);
    expect(goal.immediate).toBe(false);

    // The REAL Host with the production to-do port sends nothing and the inbox
    // stays empty (same wait as the negative neighbour).
    const started = await startHostOn(f, scribeRef, { realPort: true });
    try {
      await sleep(400);
      expect(started.sent).toHaveLength(0);
      expect(await inboxOf(started)).toHaveLength(0);
    } finally { await started.host.close(); }
  } finally { await f.close(); }
}, 60_000);
