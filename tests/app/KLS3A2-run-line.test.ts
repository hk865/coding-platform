/**
 * KLS-3a2 (test writer, decision 117): a line drives execution. Rows 3A2-01..06 and 3A2-08 of the start rulings draft
 * v2 §3 (lead rulings KLS-3a and "KLS-3a2 草稿按 3a1 实际代码重对"), plus the 3A2-09 gap cell (run sheet
 * 7d2-gapkls3a2), on the scenario harness's real Host
 * (`openHostScenario`: SQLite, a scripted model behind the real tools, the Workflow over HTTP, restarts). SQLite only:
 * the Host fills its line roots and line Kernel stores when it starts (S3, Host restart). No KLS world has a Run
 * runtime on a git root, so the KLS helpers are reused inside this one: `addGitWorktree`, `kls3a1Checkout` and
 * `registerCheckoutLine`.
 *
 * The world (`openLineScenario`): the main checkout is the scenario's own git root (`src/marker.ts` = MAIN); the
 * person adds a second checkout with `git worktree add -b wt` and commits LINE there. The AG2b seed runs through the
 * public routes; just before its `goals/create` the second line is registered through the public owner
 * `projects.registerLine` (the draft's §3: until KLS-3b the only step that adds a line to a workspace), and the Goal
 * is created on it (`lineFolder`). The seed's executor Session stays on the main line and holds the open responsible
 * link of the work Task. The Host restarts (it registers its lines at start), then the second line gets its own
 * Session through `sessions/create` with `lineFolder`. Expected values come from the test's own git and files.
 * 3A2-09 reads what the Run changed through the public `unknown-call-reviews/read` capture: the Run's third `read` is
 * held, the crash leaves an unresolved call, and the Host's takeover reconcile compares the second folder with the
 * run-start baseline.
 *
 * Red today (ac44fed7): the Run has no `workspaceSnapshot.line`, the chooser takes the main line's responsible
 * Session (two candidates), Runs and Queries resolve the main checkout (they read MAIN, the edit lands in the main
 * checkout), and a start-up Host registers no Kernel store for a line. Green when KLS-3a2 lands the line in the Run
 * snapshot and the manifests, the line filter in the chooser, `resolveRoot` by line with the Host's `lineRoots`, and
 * the Kernel store per line (`registerHostLines`, `forLine`).
 */
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { tempDir } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_ROLE, AG2B_SCOPE, AG2B_WORK_ROLE, AG2B_WORK_TASK_ID, AG2B_WORKSPACE_REF,
  claimBusyQuery, plain, seedAG2bWorkGraphThrough, startBusyQuery,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { limitHold } from '../helpers/hold-limit.js';
import { readToolSeam } from '../helpers/K3-tool-seams.js';
import { kls3a1Checkout, registerCheckoutLine } from '../helpers/KLS2A-knowledge-world.js';
import {
  cleanupScenarios, hostCtx, openHostScenario, performs, type HostRestartOptions, type HostScenario, type ScenarioScript,
} from '../scenarios/harness.js';
import { createFileReplies, execution, NO_REDRIVE, preparedOf, selectedRun, textReply } from '../scenarios/support/common.js';
import { addGitWorktree, DEFAULT_GIT_WORKSPACE_FILES, gitIn } from '../scenarios/support/git-workspace.js';

/**
 * 3A2-09 holds a `read` call through the existing K3 read stand-in (`tests/helpers/K3-tool-seams.ts`): the crashed Run
 * keeps an unresolved tool call, the Host's takeover reconcile captures the workspace against the prepared baseline,
 * and `unknown-call-reviews/read` is the public read of what the Run changed. Other tests get the real read tool.
 */
const seams = vi.hoisted(() => ({
  readToolSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').readToolSeam,
}));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return { ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]) =>
      seams.readToolSeam.enabled ? seams.readToolSeam.definition() : actual.createReadToolDefinition(workspace) };
});
seams.readToolSeam = readToolSeam;

afterEach(async () => {
  readToolSeam.release();
  await cleanupScenarios();
});

const W = AG2B_WORK_TASK_ID;
const MAIN = 'export const marker = "KLS3A2_MAIN";\n';
const LINE = 'export const marker = "KLS3A2_LINE";\n';
const MOVED = 'export const marker = "KLS3A2_MOVED";\n';

type LineScenario = { h: HostScenario; folder: string; line: { repoKey: string; folder: string; branch: string } };

async function openLineScenario(script: ScenarioScript = {}, restart: HostRestartOptions = {},
  afterOpen?: () => void): Promise<LineScenario> {
  const h = await openHostScenario({ gitWorkspace: { files: { ...DEFAULT_GIT_WORKSPACE_FILES, 'src/marker.ts': MAIN } },
    workIds: null, automation: NO_REDRIVE, script });
  afterOpen?.();
  const folder = addGitWorktree(h.root, join(await tempDir('scenario-wt-'), 'wt'), 'wt');
  writeFileSync(join(folder, 'src/marker.ts'), LINE);
  gitIn(folder, 'commit', '-q', '-am', 'kls3a2 the line marker');
  await seedAG2bWorkGraphThrough(async (suffix, body) => {
    if (suffix !== 'goals/create' || !('request' in body)) return await h.answer(suffix, body);
    const registration = await h.post<ReadResult<{ workspace: { revision: number } }>>('workspaces/registration',
      plain(AG2B_SCOPE, AG2B_SCOPE));
    if (registration.status !== 'ready') throw new Error(`workspaces/registration: ${JSON.stringify(registration)}`);
    const registered = await registerCheckoutLine((await h.direct()).projects, hostCtx(), { workspaceId: AG2B_SCOPE.workspaceId,
      folder, workspacePin: { ref: AG2B_WORKSPACE_REF, revision: registration.value.workspace.revision },
      requestId: 'kls3a2-second-line' });
    if (registered.status !== 'committed') throw new Error(`registerLine: ${JSON.stringify(registered)}`);
    return await h.answer(suffix, { ...body,
      request: { ...body.request, input: { ...(body.request.input as object), lineFolder: folder } } });
  });
  await h.settleAutoCapture();
  await h.restart(restart);
  const { repoKey, branch } = kls3a1Checkout(folder).line;
  return { h, folder, line: { repoKey, folder, branch } };
}

/** `sessions/create` of `role`, on the line of `lineFolder` (default the main line); the created record. */
async function sessionOn(h: HostScenario, requestId: string, role: RoleConfigurationRef, lineFolder?: string): Promise<SessionRecord> {
  const created = await h.answer('sessions/create', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, role, recommendedRefs: [],
    initialLinks: [], meta: { requestId, expected: [] }, ...(lineFolder === undefined ? {} : { lineFolder }) }));
  if (created['status'] !== 'completed') throw new Error(`sessions/create ${requestId}: ${JSON.stringify(created)}`);
  return created['value'] as SessionRecord;
}

/** One `read` of `src/marker.ts` (call `<label>-read`). */
const readMarker = (label: string): ScriptedReply =>
  ({ kind: 'calls', calls: [{ callId: `${label}-read`, name: 'read', args: { path: 'src/marker.ts' } }] });

/** The tool message the model got back for `callId`, as JSON text. */
function toolResultText(requests: readonly ModelRequest[], callId: string): string {
  const message = requests.flatMap(request => request.messages)
    .find(candidate => candidate.role === 'tool' && candidate.callId === callId);
  if (message === undefined) throw new Error(`no model request carries the result of ${callId}`);
  return JSON.stringify(message);
}

describe('KLS-3a2 a Goal on the second line runs on that line', () => {
  it('3A2-01, 3A2-06 the claim takes the Session of the Goal\'s line, and the Run records that line', async () => {
    /* Named mutations: 3A2-06 — drop the folder comparison in `session-chooser.ts` `roleReusable`: the main line's
     * responsible Session is a candidate too (two) and wins on its Task link. 3A2-01 — `newRunRecord` writes
     * `line: null`: the Run reads null. Red today at `candidates` (2); green once the chooser compares folders and
     * the claim writes the Goal's `lineRef` into the Run. */
    const { h, folder, line } = await openLineScenario();
    const onLine = await sessionOn(h, 'kls3a2-01-line', AG2B_WORK_ROLE, folder);
    const driven = await h.advance(h.select('kls3a2-01', W), { stopBefore: performs('start') });
    const run = await execution(h, await selectedRun(h));
    expect(driven.steps.find(step => step.pick !== null)?.pick?.candidates).toBe(1);
    expect(run.session.ref.sessionId).toBe(onLine.ref.sessionId);
    expect(run.run.workspaceSnapshot.line).toEqual(line);
  });

  it('3A2-02, 3A2-03 the Run reads the second folder\'s file and writes into the second folder, not the main checkout', async () => {
    /* Named mutations: 3A2-02 — `execution-driver.ts` resolves the root without the Run's line: it reads MAIN. 3A2-03 —
     * the Host's `resolveRoot` ignores `line` (always `byScope`): `src/out.ts` lands in the main checkout. Red today
     * at the read (MAIN); green once the driver resolves the Run's line and the Host answers it from `lineRoots`. */
    const { h, folder } = await openLineScenario({ replies: [readMarker('kls3a2-02'),
      ...createFileReplies('kls3a2-03', 'src/out.ts', 'export const out = "KLS3A2_OUT";\n')] });
    await sessionOn(h, 'kls3a2-02-line', AG2B_WORK_ROLE, folder);
    await h.advance(h.select('kls3a2-02', W), { stopBefore: performs('open_checks') });
    const read = toolResultText(h.modelRequests(), 'kls3a2-02-read');
    expect([read.includes('KLS3A2_LINE'), read.includes('KLS3A2_MAIN')]).toEqual([true, false]);
    expect([existsSync(join(folder, 'src/out.ts')), existsSync(join(h.root, 'src/out.ts'))]).toEqual([true, false]);
  });

  it('3A2-09 the Run-start baseline is the second line folder: the Run changed src/out.ts, not the line\'s own marker', async () => {
    /* Named mutation: drop `pin.line` from the baseline `resolveRoot` (`execution-preparation.ts:264-265`). The
     * baseline still reads the main checkout (MAIN) while the Run works in the second folder (LINE), so the capture
     * compared with that folder counts `src/marker.ts` as modified beside `src/out.ts`. The Run holds its third
     * `read` call, the crash leaves it with an unresolved call, and the Host's takeover reconcile builds the review;
     * `unknown-call-reviews/read` is the public read of the files the Run changed. */
    let armHeld: () => void = () => undefined;
    const heldArmed = new Promise<void>((resolve) => { armHeld = resolve; });
    readToolSeam.arm();
    const { h, folder } = await openLineScenario({
      replies: [readMarker('kls3a2-09'),
        { kind: 'calls', calls: [{ callId: 'kls3a2-09-edit', name: 'edit',
          args: { mode: 'create', path: 'src/out.ts', newText: 'export const out = "KLS3A2_OUT";\n' } }] },
        readMarker('kls3a2-09-hold')],
      duringReply: async (index) => { if (index === 2) { readToolSeam.arm(); armHeld(); } },
    }, {}, () => readToolSeam.release());
    await sessionOn(h, 'kls3a2-09-line', AG2B_WORK_ROLE, folder);
    const toStart = await h.advance(h.select('kls3a2-09', W), { stopBefore: performs('start') });
    const prepared = preparedOf(toStart.next);
    readToolSeam.arm();
    const running = h.post<unknown>('executions/start', plain(AG2B_SCOPE, { prepared,
      consumerId: AG2B_CONSUMER_ID, requestId: 'kls3a2-09-start' }));
    await limitHold(readToolSeam.waitForCall(), 'kls3a2-09 first read');
    readToolSeam.release();
    await heldArmed;
    await limitHold(readToolSeam.waitForCall(), 'kls3a2-09 held read');
    await h.restart({ crash: true });
    readToolSeam.release();
    await running.catch(() => undefined);
    const review = await h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read',
      plain(AG2B_SCOPE, { runRef: prepared.claim.runRef }));
    if (review.status !== 'ready') throw new Error(`unknown-call-reviews/read: ${JSON.stringify(review)}`);
    const workspace = review.value.workspace;
    if (workspace.status !== 'captured') throw new Error(`the capture must be readable: ${JSON.stringify(workspace)}`);
    expect(workspace.sample.map(entry => entry.path)).toEqual(['src/out.ts']);
  });

  it('3A2-08 the prepared Run starts after a restart on its stored line, though the main checkout moved', async () => {
    /* Named mutation: `execution-preparation.ts` copies the Run's workspace pin into the manifest without `line`: the
     * prepared binding no longer matches the Run (`guard_failed`), or the start resolves the main checkout (MOVED).
     * Red today at the read (MOVED); green once the manifest keeps the Run's line and the start resolves it. */
    const { h, folder, line } = await openLineScenario({ replies: [readMarker('kls3a2-08'), textReply('kls3a2-08 read')] });
    await sessionOn(h, 'kls3a2-08-line', AG2B_WORK_ROLE, folder);
    const toStart = await h.advance(h.select('kls3a2-08', W), { stopBefore: performs('start') });
    // The person moves the main checkout to another branch with another marker, then the Host restarts.
    gitIn(h.root, 'checkout', '-q', '-b', 'kls3a2-moved');
    writeFileSync(join(h.root, 'src/marker.ts'), MOVED);
    gitIn(h.root, 'commit', '-q', '-am', 'kls3a2 the main checkout moved');
    await h.restart();
    await h.advance(toStart.next!, { stopBefore: performs('open_checks') });
    const read = toolResultText(h.modelRequests(), 'kls3a2-08-read');
    expect(['KLS3A2_LINE', 'KLS3A2_MAIN', 'KLS3A2_MOVED'].map(marker => read.includes(marker))).toEqual([true, false, false]);
    expect((await execution(h, await selectedRun(h))).run.workspaceSnapshot.line).toEqual(line);
  });
});

describe('KLS-3a2 the second line\'s Kernel store and Queries', () => {
  it('3A2-04 each line has its own Kernel store: the main line keeps its old one, the second one is named by its folder', async () => {
    /* Named mutation: `kernelStoreEntry` without `lineFolder` — both lines get the main line's adapter and file (the
     * second registration is refused as a duplicate, and the second line's `sessions/create` finds no store). Red
     * today at the second line's `sessions/create` (`unsupported`: a started Host registers no store); green once
     * `registerHostLines` registers one per line at start and admission picks it by line. */
    const { h, folder } = await openLineScenario({}, { noKernelStores: true });
    const second = await sessionOn(h, 'kls3a2-04-line', AG2B_WORK_ROLE, folder);
    const main = await sessionOn(h, 'kls3a2-04-main', AG2B_WORK_ROLE);
    const adapterOf = async (session: SessionRecord): Promise<string> => {
      const read = await h.post<ReadResult<SessionCard>>('sessions/read',
        plain(AG2B_SCOPE, { projectId: session.ref.projectId, sessionId: session.ref.sessionId }));
      if (read.status !== 'ready') throw new Error(`sessions/read: ${JSON.stringify(read)}`);
      return read.value.record.kernel.adapterId;
    };
    const suffix = (...parts: string[]): string => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
    const { projectId, workspaceId } = AG2B_SCOPE;
    expect([await adapterOf(main), await adapterOf(second)]).toEqual([
      `host-settings-kernel-${suffix(projectId, workspaceId)}`, `host-settings-kernel-${suffix(projectId, workspaceId, folder)}`]);
  });

  it('3A2-05 a Query on a Session of the second line reads the second folder', async () => {
    /* Named mutation: `query-execution.ts` resolves the root without `manifest.workspace.line`: it reads MAIN. Red
     * today at the read (MAIN); green once the Query manifest carries the Session's line and the start resolves it. */
    const { h, folder } = await openLineScenario({ queryReplies: [readMarker('kls3a2-05'), textReply('kls3a2-05 answered')] });
    const adviser = await sessionOn(h, 'kls3a2-05-line', AG2B_QUERY_ROLE, folder);
    const refs = await claimBusyQuery(h.host, { sessionRef: adviser.ref, sessionAggregateRef: adviser.ref,
      revision: adviser.revision }, 'kls3a2-05');
    await startBusyQuery(h.host, refs, 'kls3a2-05');
    const read = toolResultText(h.host.queryScripted.requests, 'kls3a2-05-read');
    expect([read.includes('KLS3A2_LINE'), read.includes('KLS3A2_MAIN')]).toEqual([true, false]);
  });
});
