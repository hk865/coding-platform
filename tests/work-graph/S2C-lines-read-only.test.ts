/**
 * 2C-20: the reads must not write. A dataset is built once through the real
 * public services; every read runs twice with no other action between the two
 * reads, and the two read windows must be identical. `lines/page` is read for
 * all four WorkGraph sections; `graph/hover` and `graph/detail` run over group
 * D's real NodeDetail reader.
 *
 * On the zero-model-call / zero-Runtime-history-read half of 2C-20: at LE3 the
 * `WorkLineReadPort` and `NodeDetailReadPort` dependency shapes carry NO model
 * port and NO AgentRuntime history-reader port (rule 1; see `WorkLineReaderDeps`
 * and `NodeDetailReaderDeps`). There is therefore no injected seam at this entry
 * a spy could count, and a hand-written `0` asserted against `0` would be
 * tautological rather than an observation, so it is deliberately not asserted
 * at LE3. The observations run through real injected seams instead: the
 * Kernel-history half through `createWorkLineConversation`'s injected
 * `readSessionHistory` (the test above), and the model-call half through the
 * LE4/LE7 Host route path, where the scenario harness owns and counts the
 * scripted model (`2C-20 Host-composed model-call observation` below).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { createWorkLineConversation } from '../../src/composition/work-line-conversation.js';
import type { WorkLineStore } from '../../src/core/work-graph/views/work-line-reader.js';
import { openLineFixture, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { nodeReaderOf, openNodeFixture, type NodeFixture } from '../helpers/S2C-D-node-support.js';
import { cleanupScenarios, openHostScenario } from '../scenarios/harness.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_TASK_ID, createAG2bSession, plain }
  from '../helpers/AG2b-collaboration-fixture.js';
import { lineArchived, lineConversation, lineList, lineRead, lineSection }
  from '../helpers/S2C-K-scenario-support.js';
import { hoverGoal } from '../helpers/S2C-K2-scenario-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

function taskTarget(task: TaskTriple) {
  return { kind: 'task' as const, ref: task };
}

/**
 * 2C-20: the reads must not write. The WorkGraph readers carry no model or
 * AgentRuntime dependency at all (rule 1), so the observation available on this
 * entry is a storage-boundary one: this wrapper counts every `commit` (a write)
 * and every read call. A read that wrote would leave a nonzero `commits` tally,
 * and the two back-to-back reads must make the same number of storage calls.
 * The zero-model / zero-history half is not observable at this entry (no such
 * port exists to spy on); see the file header.
 */
function watchStore(store: WorkLineStore): { records: WorkLineStore; state: { commits: number; reads: number } } {
  const state = { commits: 0, reads: 0 };
  const records = {
    ...store,
    async commit(input: Parameters<WorkLineStore['commit']>[0]) {
      state.commits += 1;
      return store.commit(input);
    },
    async readMany(keys: readonly string[]) { state.reads += 1; return store.readMany(keys); },
    async lookup(request: Parameters<WorkLineStore['lookup']>[0]) { state.reads += 1; return store.lookup(request); },
    async lookupOrdered(request: Parameters<WorkLineStore['lookupOrdered']>[0]) {
      state.reads += 1;
      return store.lookupOrdered(request);
    },
    async countLookup(request: Parameters<WorkLineStore['countLookup']>[0]) {
      state.reads += 1;
      return store.countLookup(request);
    },
    async eventAt(cursor: Parameters<WorkLineStore['eventAt']>[0]) { state.reads += 1; return store.eventAt(cursor); },
  } as unknown as WorkLineStore;
  return { records, state };
}

describe.each(['memory', 'sqlite'] as const)('2C-20 read does not write (%s)', (kind) => {
  const open: LineFixture[] = [];
  const nodes: NodeFixture[] = [];
  afterEach(async () => {
    for (const fixture of open.splice(0)) await fixture.close();
    for (const fixture of nodes.splice(0)) await fixture.close();
  });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-20 two lines/list reads share the same read window and counts', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g20', [{ taskId: 'x', title: 'X' }]);
    const head = (await f.createSession('s20-a')).ref;
    await f.link(head, taskTarget(goal.tasks['x']!), 'responsible', true);
    await f.archive((await f.createSession('s20-archived')).ref);
    const first = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const second = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(second.readWindow.from).toBe(first.readWindow.from);
    expect(second.readWindow.to).toBe(first.readWindow.to);
    expect(second.counts).toEqual(first.counts);
    expect(second.rows.map((row) => row.key)).toEqual(first.rows.map((row) => row.key));
  });

  it('2C-20 two lines/archived reads share the same source cursor and rows', async () => {
    const f = await lineFixture();
    await f.archive((await f.createSession('s20-arch-a')).ref);
    await f.archive((await f.createSession('s20-arch-b')).ref);
    const first = ready(await f.reader.listArchivedLines(f.ctx, { workspace: f.base.scope, page: { limit: 10 } }));
    const second = ready(await f.reader.listArchivedLines(f.ctx, { workspace: f.base.scope, page: { limit: 10 } }));
    expect(second.sourceCursor).toBe(first.sourceCursor);
    expect(second.withoutArchivedAt).toEqual(first.withoutArchivedAt);
    expect(second.rows.map((row) => row.key)).toEqual(first.rows.map((row) => row.key));
  });

  it('2C-20 two lines/read reads share the same row and source cursor', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s20-read')).ref;
    const first = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: head }));
    const second = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: head }));
    expect(second).toEqual(first);
  });

  it('2C-20 two lines/page reads per section share the same source cursor and items', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g20p', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s20-page')).ref;
    await f.link(head, taskTarget(goal.tasks['w']!), 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.mailbox().sendMessage(f.ctx, { input: { recipient: head, text: 'S2C-L read-only',
      intent: 'notify' }, meta: { requestId: 's20-page-msg', expected: [] } });
    await f.runs.beginConsultationCopy(head, 's20-page-copy');

    for (const section of ['participation', 'messages', 'copies', 'executions'] as const) {
      const first = ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: head,
        section, page: { limit: 10 } }));
      const second = ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: head,
        section, page: { limit: 10 } }));
      expect(second.sourceCursor).toBe(first.sourceCursor);
      expect(second).toEqual(first);
    }
  });

  it('2C-20 two graph/hover reads are identical', async () => {
    const fixture = await openNodeFixture(kind);
    nodes.push(fixture);
    const { reader } = nodeReaderOf(fixture);
    const first = ready(await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef }));
    const second = ready(await reader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef }));
    expect(second.sourceCursor).toBe(first.sourceCursor);
    expect(second).toEqual(first);
  });

  it('2C-20 two graph/detail reads are identical', async () => {
    const fixture = await openNodeFixture(kind);
    nodes.push(fixture);
    const { reader } = nodeReaderOf(fixture);
    const request = { goalRef: fixture.goalRef, node: { kind: 'goal' as const, ref: fixture.goalRef },
      section: 'summary' as const, page: { afterCursor: null, limit: 10 } };
    const first = ready(await reader.readNodeDetail(fixture.ctx, request));
    const second = ready(await reader.readNodeDetail(fixture.ctx, request));
    expect(second.sourceCursor).toBe(first.sourceCursor);
    expect(second).toEqual(first);
  });

  it('2C-20 (observations) two reads of every entry make zero commits and the same storage calls', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g20obs', [{ taskId: 'obs', title: 'Observed' }]);
    const head = (await f.createSession('s20-obs')).ref;
    await f.link(head, taskTarget(goal.tasks['obs']!), 'responsible', true);
    const claim = await f.claim('obs', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.mailbox().sendMessage(f.ctx, { input: { recipient: head, text: 'S2C-20 observations',
      intent: 'notify' }, meta: { requestId: 's20-obs-msg', expected: [] } });
    await f.runs.beginConsultationCopy(head, 's20-obs-copy');

    const watched = watchStore(f.records);
    const reader = f.readerWith(watched.records);

    // Every pair runs back-to-back with no other action between the two reads; the
    // second read makes the same number of storage calls and writes nothing. The
    // zero-model/zero-history observation is structurally unavailable at this LE3
    // entry (no model or Runtime history port is injected into this reader): the
    // Host-composed model-call observation is in the block below, the injected
    // Kernel-history observation in the test above.
    const pair = async <T>(read: () => Promise<ReadResult<T>>): Promise<void> => {
      const beforeCalls = watched.state.reads;
      const first = ready(await read());
      const firstCalls = watched.state.reads - beforeCalls;
      const beforeSecond = watched.state.reads;
      const second = ready(await read());
      expect(watched.state.reads - beforeSecond).toBe(firstCalls);
      expect(second).toEqual(first);
    };

    await pair(() => reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    await pair(() => reader.listArchivedLines(f.ctx, { workspace: f.base.scope, page: { limit: 10 } }));
    await pair(() => reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: head }));
    for (const section of ['participation', 'messages', 'copies', 'executions'] as const) {
      await pair(() => reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: head, section,
        page: { limit: 10 } }));
    }
    expect(watched.state.commits, 'lines/* wrote nothing').toBe(0);

    // The NodeDetail entries over the same kind of watched store.
    const fixture = await openNodeFixture(kind);
    nodes.push(fixture);
    const watchedNode = watchStore(fixture.records);
    (fixture as { records: WorkLineStore }).records = watchedNode.records;
    const { reader: nodeReader } = nodeReaderOf(fixture);
    const hoverRequest = { goalRef: fixture.goalRef };
    const detailRequest = { goalRef: fixture.goalRef, node: { kind: 'goal' as const, ref: fixture.goalRef },
      section: 'summary' as const, page: { afterCursor: null, limit: 10 } };
    const hoverFirst = ready(await nodeReader.readGraphHover(fixture.ctx, hoverRequest));
    const hoverSecond = ready(await nodeReader.readGraphHover(fixture.ctx, hoverRequest));
    expect(hoverSecond).toEqual(hoverFirst);
    const detailFirst = ready(await nodeReader.readNodeDetail(fixture.ctx, detailRequest));
    const detailSecond = ready(await nodeReader.readNodeDetail(fixture.ctx, detailRequest));
    expect(detailSecond).toEqual(detailFirst);
    expect(watchedNode.state.commits, 'graph/hover and graph/detail wrote nothing').toBe(0);
  });

  // 2C-20 (review item 6c): the model/history-call observation. There is no model
  // port at this entry, but the Kernel-history read IS an injected port on the
  // Host-composed `conversation` section (`createWorkLineConversation`). Reading
  // it through the same injected seam shows that lines/* and graph/* start no
  // Kernel history read; only the conversation section's own reads are counted.
  it('2C-20 (observations) lines/* and graph/* start no Kernel history read beyond the conversation section', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g20hist', [{ taskId: 'h', title: 'H task' }]);
    const head = (await f.createSession('s20-hist')).ref;
    await f.link(head, taskTarget(goal.tasks['h']!), 'responsible', true);
    let historyReads = 0;
    const runtime: RuntimeExecutionPort['readSessionHistory'] =
      async (_ctx: CoreCallContext, request): Promise<ReadResult<{ items: SessionHistoryEntry[]; nextCursor: string | null;
        basis: { kind: 'session'; ref: typeof request.sessionRef; cursor: CommitCursor } }>> => {
        historyReads += 1;
        return { status: 'ready', value: { items: [], nextCursor: null,
          basis: { kind: 'session', ref: request.sessionRef, cursor: 'c0' as CommitCursor } } };
      };
    const conversation = createWorkLineConversation({ lines: f.reader, readSessionHistory: runtime });

    ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    ready(await f.reader.listArchivedLines(f.ctx, { workspace: f.base.scope, page: { limit: 10 } }));
    ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: head }));
    for (const section of ['participation', 'messages', 'copies', 'executions'] as const) {
      ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: head, section,
        page: { limit: 10 } }));
    }
    expect(historyReads, 'lines/* other than the conversation section read no Kernel history').toBe(0);

    // The real graph/* reads over the node-detail entry.
    const fixture = await openNodeFixture(kind);
    nodes.push(fixture);
    const { reader: nodeReader } = nodeReaderOf(fixture);
    ready(await nodeReader.readGraphHover(fixture.ctx, { goalRef: fixture.goalRef }));
    ready(await nodeReader.readNodeDetail(fixture.ctx, { goalRef: fixture.goalRef,
      node: { kind: 'goal', ref: fixture.goalRef }, section: 'summary', page: { afterCursor: null, limit: 10 } }));
    expect(historyReads, 'graph/* reads no Kernel history').toBe(0);

    // The conversation section is the one counted reader of Kernel history.
    ready(await conversation.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: head,
      section: 'conversation', page: { limit: 10 } }));
    expect(historyReads).toBeGreaterThan(0);
  });
});

/**
 * 2C-20 (review item 6c): the model-call observation through the real
 * Host-composed seam. The LE4 Host owns the scripted model — the same seam the
 * other read-only scenario checks count with `h.modelCalls()` — so every
 * `lines/*` and `graph/*` read runs through the real routes with a live model
 * counter behind them and the counter must not move. The Host-composed
 * `conversation` section reads Kernel history (the injected-seam test above),
 * not the model, so it must not move the counter either.
 */
describe('2C-20 Host-composed model-call observation', () => {
  afterEach(cleanupScenarios);

  it('2C-20 (observations) lines/* and graph/* start no scripted model call through the real Host routes', async () => {
    const h = await openHostScenario({ script: { replies: [{ kind: 'text', text: '2C-20: no read may reach the model' }] } });
    const session = await createAG2bSession(h.host, 's2c20-host', AG2B_WORK_ROLE,
      [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId,
        taskId: AG2B_WORK_TASK_ID } }, relation: 'responsible' }]);
    const key = session.sessionRef;

    // The measured baseline: the route dataset was built without a model call.
    const before = h.modelCalls();
    expect(before, 'the route dataset is built without a model call').toBe(0);

    ready(await lineList(h));
    ready(await lineArchived(h));
    ready(await lineRead(h, key));
    for (const section of ['participation', 'messages', 'copies', 'executions'] as const) {
      ready(await lineSection(h, key, section));
    }
    // The Host-composed conversation section is a real Kernel-history read (see
    // the injected-seam test above), not a model call.
    ready(await lineConversation(h, key));
    ready(await hoverGoal(h));
    ready(await h.post<ReadResult<unknown>>('graph/detail', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF,
      node: { kind: 'goal', ref: AG2B_GOAL_REF }, section: 'summary', page: { afterCursor: null, limit: 10 } })));

    expect(h.modelCalls(), 'lines/* and graph/* started no scripted model call').toBe(before);
    expect(h.modelCalls(), 'the reads left the scripted model at zero').toBe(0);
  }, 240_000);
});
