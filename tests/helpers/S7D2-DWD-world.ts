/**
 * DWD (the workspace withdraw/remove package): the XWS2A second-workspace world plus the two removal settings
 * routes, the join's full `sessions/operation` record, the registration snapshot and the settings-file helpers.
 *
 * Every state comes from a public step: `openXWS2AWorld` opens the second workspace through the Host's
 * `workspaces/open` route and births its `workspace_join`; `approveCoarse` is the person's `decisions/answer` of the
 * coarse proposal's card; the removal routes are the Host's own settings routes; `notes/write` is the person's note
 * route. No record, context or store is read or written here, and no `WorkspaceSnapshot` is built by hand.
 */
import { chmod, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { BootstrapResponse } from '../../src/app/core-http-types.js';
import type { GoalControlOutcomeV1 } from '../../src/app/goal-fan-out-driver.js';
import type {
  HostSettingsSnapshot, SettingsResponse, SettingsWorkspace,
} from '../../src/app/host-settings-types.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import type { WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from './S6A-request-fixture.js';
import { readyValue } from './S6A-memory-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { openXWS2AWorld, xws2aJoinRef, type XWS2AWorld } from './XWS2A-world.js';
import { waitFor } from '../scenarios/harness.js';

/** The world the four rows share: the XWS2A second-workspace world, nothing added. */
export type DwdWorld = XWS2AWorld;

export type DwdWorldOptions = {
  backend: 'memory' | 'sqlite';
  /** Runs the person's approval of the coarse proposal, so `second-mod` enters the project catalog. */
  withModule?: boolean;
  /** Passed as `extraHostOptions.settings.settingsDirectory` (the Host settings directory). */
  settingsDirectory?: string;
  /** Files written into the second workspace root after it opens. */
  secondFiles?: Record<string, string>;
};

/** The two removal routes production adds in `src/app/host-settings-types.ts` (wd-build §3.7/E5). */
export type DwdRemovalRoute = 'workspaces/withdraw' | 'workspaces/remove';

/** The lead ruling Q2: both routes answer the sibling `{settings, bootstrap}` shape. */
export type DwdRemovalValue = { settings: HostSettingsSnapshot; bootstrap: BootstrapResponse };

export type DwdRemovalResponse = SettingsResponse<DwdRemovalValue>;

type RemovalSettingsCall = (
  route: DwdRemovalRoute,
  input: unknown,
) => Promise<DwdRemovalResponse>;

/**
 * One removal settings call. `SettingsRoutes` has no removal route on this tree; production adds `workspaces/withdraw`
 * and `workspaces/remove` in `src/app/host-settings-types.ts` (wd-build §3.7/E5), and this one narrow cast goes away
 * then. The cast is at the route-string boundary only: nothing about the production objects is changed.
 */
function removalSettings(world: DwdWorld, route: DwdRemovalRoute, input: unknown): Promise<DwdRemovalResponse> {
  const send = world.base.world.settings as unknown as RemovalSettingsCall;
  return send(route, input);
}

const removalRouteOf = (kind: 'withdraw' | 'remove'): DwdRemovalRoute =>
  kind === 'withdraw' ? 'workspaces/withdraw' : 'workspaces/remove';

/**
 * Open the world: `openXWS2AWorld` with the optional Host settings directory and second-root files. `withModule`
 * approves the coarse proposal so the second workspace's module is in the project catalog (WD-07's guard).
 */
export async function openDwdWorld(options: DwdWorldOptions): Promise<DwdWorld> {
  const extraHostOptions = options.settingsDirectory === undefined ? undefined
    : { settings: { settingsDirectory: options.settingsDirectory } };
  const world = await openXWS2AWorld({ backend: options.backend,
    ...(extraHostOptions === undefined ? {} : { extraHostOptions }),
    ...(options.secondFiles === undefined ? {} : { secondFiles: options.secondFiles }) });
  try {
    if (options.withModule === true) {
      await world.approveCoarse();
      // `approveCoarse` returns once the join reads `regions`; the region line's own exploration (and its
      // responsibility link) lands just after, so WDT-06 must wait for it before saving that link.
      await waitFor(async () => await world.join(),
        join => join?.explorations?.some(entry => entry.segment === 'region') === true,
        'the join region exploration');
    }
    return world;
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** `goals/control` of the second workspace's Goal, at the two pins its public reads answer. */
export async function controlSecondGoal(world: DwdWorld, control: 'cancel' | 'pause'):
Promise<GoalControlOutcomeV1> {
  const ws = world.second.workspace;
  const goal = world.second.goal;
  const read = readyValue<{ goal: { revision: number } }>(await ws.route('goals/read', goal),
    `the goal ${goal.goalId}`);
  const graph = await ws.route('tasks/query', { goalRef: goal }) as
    { status: string; value?: { completion?: { status: 'not_recorded' } | { status: 'recorded'; snapshot: { revision: number } } } };
  const completion = graph.status === 'ready' ? graph.value?.completion : undefined;
  const phaseRevision = completion?.status === 'recorded' ? completion.snapshot.revision : 0;
  return valueOf<GoalControlOutcomeV1>(await ws.post('goals/control', graphWrite(ws.scope,
    { goalRef: goal, control, reason: `the DWD world ${control}s the second goal` },
    `dwd-${control}-${goal.goalId}`, [
      { ref: goal, revision: read.goal.revision },
      { ref: { aggregateType: 'GoalPhase', projectId: goal.projectId, goalId: goal.goalId }, revision: phaseRevision },
    ])), 'committed', `the second goal ${control}`);
}

/** The cancel arm the removal rows use before a successful withdraw/remove. */
export function cancelSecondGoal(world: DwdWorld): Promise<GoalControlOutcomeV1> {
  return controlSecondGoal(world, 'cancel');
}

/** The project path of the second workspace's module (`/ @ws:<id>/second-mod`, hand-computed). */
export function secondId(world: DwdWorld): string {
  return '/@ws:' + encodeURIComponent(world.second.scope.workspaceId) + '/second-mod';
}

/**
 * The join's full `sessions/operation` record through the MAIN workspace (the second workspace's own HTTP is gone
 * after a removal). Defaults to the second workspace; WDT-09 passes a newly opened scope.
 */
export async function fullJoin(world: DwdWorld, scope: WorkspaceScope = world.second.scope):
Promise<SessionOperationRecord> {
  return valueOf<SessionOperationRecord>((await world.base.world.post('sessions/operation',
    plain(S6A_SCOPE, xws2aJoinRef(scope.projectId, scope.workspaceId)))).body, 'ready',
  `the join of ${scope.workspaceId}`);
}

/**
 * The person's `notes/write` of one `convention` note on a real second-workspace file; it must be accepted at once.
 * `path` is the second root's own path (the raw form a file anchor takes in that workspace's frame).
 */
export async function writeSecondFileNote(world: DwdWorld, path: string): Promise<WriteNoteEnvelopeV1> {
  const answer = await world.base.world.post('notes/write', plain(world.second.scope, {
    commandId: `dwd-note-${path}`, goalId: world.second.goal.goalId, expectedPointerRevision: null,
    note: { kind: 'convention', topic: 'dwd-file-note', conclusion: `DWD file note ${path}`,
      anchor: { kind: 'file', path }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
      replaces: [], contradicts: [], coexistWith: [], body: `DWD file note ${path}` },
  }));
  const envelope = answer.body as WriteNoteEnvelopeV1;
  if (envelope === undefined) throw new Error(`DWD: notes/write did not answer an envelope: ${JSON.stringify(answer.body)}`);
  if (envelope.write.status !== 'accepted') throw new Error(`DWD: the note was not accepted: ${JSON.stringify(envelope)}`);
  return envelope;
}

/** Every file under `<root>/.workbench/notes`, by path relative to that directory; files only, no database. */
export async function readNoteBytes(root: string): Promise<Map<string, Buffer>> {
  const notes = join(root, '.workbench', 'notes');
  const files = new Map<string, Buffer>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.set(relative(notes, full), await readFile(full));
    }
  };
  await walk(notes);
  return files;
}

/** The Host's `snapshot` workspaces (`HostSettingsSnapshot.workspaces`). */
export async function snapshotWorkspaces(world: DwdWorld): Promise<readonly SettingsWorkspace[]> {
  const snapshot = await world.base.world.settings('snapshot', {});
  if (snapshot.status !== 'ready') throw new Error(`DWD: the Host snapshot is not ready: ${JSON.stringify(snapshot)}`);
  return snapshot.value.workspaces;
}

export type DwdProjectNotice = { itemKey: string; summary: string };

/** The main workspace's `project_notice` page (today's public shape: `notices`, not the frozen word `items`). */
export async function projectNotices(world: DwdWorld): Promise<readonly DwdProjectNotice[]> {
  return valueOf<{ notices: readonly DwdProjectNotice[] }>((await world.base.world.post('decisions/queue',
    plain(S6A_SCOPE, { workspace: S6A_SCOPE, sections: ['notices'], categories: ['project_notice'],
      page: { limit: 100 } }))).body, 'ready', 'the project notices').notices;
}

/** `workspaces/withdraw` (`kind: 'withdraw'`) or `workspaces/remove` (`kind: 'remove'`) of `scope`. */
export function remove(world: DwdWorld, kind: 'withdraw' | 'remove',
  scope: WorkspaceScope = world.second.scope): Promise<DwdRemovalResponse> {
  return removalSettings(world, removalRouteOf(kind), { scope });
}

/**
 * The same removal route with a caller's raw body (WDT-13's rejected inputs); the extra state is the body, not a
 * second way to a removal. Documented deviation from wd-tests §0, which names only `remove(world, kind)`.
 */
export function removeRaw(world: DwdWorld, kind: 'withdraw' | 'remove', input: unknown): Promise<DwdRemovalResponse> {
  return removalSettings(world, removalRouteOf(kind), input);
}

/** WDT-10: make the settings module's temporary-file write fail; the old `host-settings.json` is kept. */
export async function blockSettingsSave(settingsDirectory: string): Promise<void> {
  await chmod(settingsDirectory, 0o500);
}

/** WDT-10: restore the directory so the next real save can write. */
export async function unblockSettingsSave(settingsDirectory: string): Promise<void> {
  await chmod(settingsDirectory, 0o700);
}
