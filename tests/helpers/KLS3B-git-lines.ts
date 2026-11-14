/**
 * KLS-3b (test writer, decision 117): the person's git steps on a workspace's lines, and the two public steps the line
 * rows share. `mergeBranch`, `removeWorktree` and `commitFile` are real git in the test's own folders (`gitIn`, as a
 * person runs it); `addGitWorktree` stays in `tests/scenarios/support/git-workspace.ts`. `joinCheckout` is the person
 * opening another checkout of the repository inside a project: the Host settings route `workspaces/open` with the
 * projectId (start rulings draft v2 §2.5, the join). `workspaceLines` is the public read `workspaces/lines`.
 * `openJoinedLineScenario` is the KLS-3a2 line world of `tests/app/KLS3A2-run-line.test.ts` (that file's local
 * `openLineScenario`, which registers the second line through the owner) with the second checkout joined through
 * `workspaces/open` instead, so the Goal is born on a line the Host made; `lineSession` is that file's `sessionOn`
 * (`sessions/create` with `lineFolder`). No record is read or written here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CoreScope } from '../../src/app/core-http-types.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { LineSnapshot } from '../../src/contracts/line.js';
import { settingsPost } from '../app/support/S8A-L8-host.js';
import { openHostScenario, type CheckBehaviour, type HostScenario, type ScenarioScript } from '../scenarios/harness.js';
import { NO_REDRIVE } from '../scenarios/support/common.js';
import { addGitWorktree, DEFAULT_GIT_WORKSPACE_FILES, gitIn } from '../scenarios/support/git-workspace.js';
import { tempDir } from './A2-restart-fixture.js';
import { AG2B_SCOPE, plain, seedAG2bWorkGraphThrough } from './AG2b-collaboration-fixture.js';

/** A person merges `branch` into the branch checked out at `root` (a real merge commit when both moved). */
export function mergeBranch(root: string, branch: string): void {
  gitIn(root, 'merge', '-q', '--no-edit', branch);
}

/** A person removes the worktree at `folder` (its folder goes; its branch stays). */
export function removeWorktree(root: string, folder: string): void {
  gitIn(root, 'worktree', 'remove', '--force', folder);
}

/** A person writes `rel` in the checkout at `folder` and commits it there. */
export function commitFile(folder: string, rel: string, text: string): void {
  mkdirSync(dirname(join(folder, rel)), { recursive: true });
  writeFileSync(join(folder, rel), text);
  gitIn(folder, 'add', '--', rel);
  gitIn(folder, 'commit', '-q', '-m', `kls3b ${rel}`);
}

type SettingsCall = <T>(suffix: string, body: unknown) => Promise<T>;

/** `workspaces/open` of `folder` inside `projectId`, as the person's page sends it; the scope it answers. */
export async function joinCheckout(settings: SettingsCall, projectId: string, folder: string): Promise<CoreScope> {
  const opened = await settings<{ status: string; value?: { scope: CoreScope } }>('workspaces/open',
    { projectId, path: folder, writeAllowed: true, commandsAllowed: false });
  if (opened.status !== 'ready' || opened.value === undefined) throw new Error(`workspaces/open: ${JSON.stringify(opened)}`);
  return opened.value.scope;
}

/** `workspaces/lines` from `scope`: one workspace's lines (`workspaceId`), or the whole project's without it. */
export async function workspaceLines(call: SettingsCall, scope: CoreScope, workspaceId?: string): Promise<LineSnapshot[]> {
  const read = await call<{ status: string; value?: { lines: LineSnapshot[] } }>('workspaces/lines',
    plain(scope, workspaceId === undefined ? {} : { workspaceId }));
  if (read.status !== 'ready' || read.value === undefined) throw new Error(`workspaces/lines: ${JSON.stringify(read)}`);
  return read.value.lines;
}

export const KLS3B_MAIN = 'export const marker = "KLS3B_MAIN";\n';
export const KLS3B_LINE = 'export const marker = "KLS3B_LINE";\n';

/**
 * The scenario Host (SQLite, scripted models, the Workflow over HTTP) on a git root whose `src/marker.ts` is MAIN; the
 * person adds a second checkout (`git worktree add -b wt`) and commits LINE there. The AG2b seed runs through the
 * public routes; just before its `goals/create` the person opens the second checkout inside the project
 * (`workspaces/open`, which must answer the seed's own workspace), and the Goal is created on that line
 * (`lineFolder`). The seed's executor Session stays on the main line. `goalOnLine: false` still joins the second
 * checkout at that same hook but leaves the Goal on the main line (no `lineFolder`).
 */
export async function openJoinedLineScenario(options: { script?: ScenarioScript; check?: CheckBehaviour; goalOnLine?: boolean } = {}):
  Promise<{ h: HostScenario; folder: string }> {
  const h = await openHostScenario({ gitWorkspace: { files: { ...DEFAULT_GIT_WORKSPACE_FILES, 'src/marker.ts': KLS3B_MAIN } },
    workIds: null, automation: NO_REDRIVE, script: options.script ?? {},
    ...(options.check === undefined ? {} : { check: options.check }) });
  // The scenario clock is fixed, so both lines are made in the same instant and order by their keys (KLS-3a): the
  // second checkout's folder sorts after the root's (`scenario-wt-` after `scenario-ws-`, as KLS3A2's rows), so the
  // root stays the main line.
  const folder = addGitWorktree(h.root, join(await tempDir('scenario-wt-'), 'wt'), 'wt');
  commitFile(folder, 'src/marker.ts', KLS3B_LINE);
  const settings: SettingsCall = async <T>(suffix: string, body: unknown) =>
    await (await settingsPost(h.host.base, suffix, h.host.token, body)).json() as T;
  await seedAG2bWorkGraphThrough(async (suffix, body) => {
    if (suffix !== 'goals/create' || !('request' in body)) return await h.answer(suffix, body);
    const joined = await joinCheckout(settings, AG2B_SCOPE.projectId, folder);
    if (joined.workspaceId !== AG2B_SCOPE.workspaceId) throw new Error(`the join made a workspace: ${JSON.stringify(joined)}`);
    return await h.answer(suffix, { ...body,
      request: { ...body.request, input: { ...(body.request.input as object),
        ...(options.goalOnLine === false ? {} : { lineFolder: folder }) } } });
  });
  await h.settleAutoCapture();
  return { h, folder };
}

/** `sessions/create` of `role` on the line of `lineFolder` (KLS-3a2's public input), as the person makes a Session. */
export async function lineSession(h: HostScenario, requestId: string, role: RoleConfigurationRef, lineFolder: string):
  Promise<SessionRecord> {
  const created = await h.answer('sessions/create', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, role, recommendedRefs: [],
    initialLinks: [], meta: { requestId, expected: [] }, lineFolder }));
  if (created['status'] !== 'completed') throw new Error(`sessions/create ${requestId}: ${JSON.stringify(created)}`);
  return created['value'] as SessionRecord;
}
