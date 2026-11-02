/**
 * PL-46 (spec §5.3.4, §6.4.3): adopting one stage writes its Markdown taskbook
 * under the external settings directory; a candidate turned into a card is
 * exported once with its draft and read back through
 * `decisions/candidate-card.exportRead`; the workspace revision and file set do
 * not move; the isolation variant writes nothing.
 *
 * Every expected value is a literal from §5.3.4/§6.4.3 or a hand-built path;
 * production is never read back for its own answer. Runs to the first missing
 * L wiring: `adoptAndExport` and the `decisions/candidate-card` route.
 *
 * The `exportRead` table also holds PL-47's card rows: a failed export is read
 * through the route, on a candidate nobody adopted.
 */
import { describe, expect, it, vi } from 'vitest';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as goalFanOutModule from '../../src/app/goal-fan-out-driver.js';
import * as taskbookExport from '../../src/app/taskbook-export.js';
import { deferred, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { startGoalDriver } from '../helpers/DRV-fixture.js';
import { readProposal } from '../helpers/IV-host-fixture.js';
import { openPLTaskbookWorld, type PLTaskbookOptions, type PLTaskbookWorld } from '../helpers/PL-taskbook-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import { OPERATOR, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { checkConfiguration } from '../helpers/S7A-fixture.js';
import { withConfiguredHost } from '../helpers/S7C-member-fixture.js';

const INSTRUCTION = 'Do the stage one work.';

/** Every path under the workspace root: a nested export shows here, a top-level look would not. */
const workspaceFiles = async (world: PLTaskbookWorld): Promise<string[]> =>
  (await readdir(world.world.root, { recursive: true })).sort();

/** One `exportRead` state: `arrange` brings it about after the card exit and returns the literal the route must answer. */
type CardExportState = {
  name: string;
  options?: PLTaskbookOptions;
  before?(world: PLTaskbookWorld): Promise<void>;
  arrange(path: string, read: () => Promise<unknown>): Promise<unknown>;
};

/** Every export started so far, as `<planId>@<planRevision>`; the caller spied on `exportTaskbooksForPlan`. */
const exportsStarted = (): string[] => vi.mocked(taskbookExport.exportTaskbooksForPlan).mock.calls
  .map(([input]) => `${input.plan.planId}@${String(input.plan.planRevision)}`);

const missingAt = (path: string): unknown => ({ status: 'ready',
  stages: [{ state: 'missing', stageId: 'stage-one', path }] });

const cardExportStates: readonly CardExportState[] = [
  {
    name: 'missing after a real ENOTDIR at the export root',
    // A regular file where `<settingsDirectory>/taskbooks` must be, before the first export runs.
    before: async (world) => { await writeFile(join(world.settingsDirectory, 'taskbooks'), 'not a directory\n'); },
    arrange: async path => missingAt(path),
  },
  {
    name: 'missing when the export root is inside the workspace',
    options: { isolation: true },
    arrange: async path => missingAt(path),
  },
  {
    name: 'incomplete when the written file is cut short',
    before: async () => { vi.spyOn(taskbookExport, 'exportTaskbooksForPlan'); },
    arrange: async (path, read) => {
      // A3: every export the advance started has ended, so the cut below is the last write.
      await Promise.all(vi.mocked(taskbookExport.exportTaskbooksForPlan).mock.results.map(result => result.value));
      const written = await read() as { stages: [{ bytes: number }] };
      await writeFile(path, 'x', 'utf8');
      return { status: 'ready', stages: [{ state: 'incomplete', stageId: 'stage-one', path,
        actualBytes: 1, expectedBytes: written.stages[0].bytes }] };
    },
  },
  {
    name: 'unavailable when the probe itself fails',
    arrange: async () => {
      // A2: the real probe cannot run; the card must say so, never a blank.
      vi.spyOn(taskbookExport, 'exportBooks').mockRejectedValue(new Error('PL-46 the probe cannot run'));
      return { status: 'unavailable', reason: 'the taskbook export read failed: PL-46 the probe cannot run' };
    },
  },
];

describe('PL-46: one stage taskbook adopted', () => {
  it('writes a UTF-8 file outside the workspace with the whole instruction and its identifiers', async () => {
    const world = await openPLTaskbookWorld();
    try {
      const before = await world.readWorkspaceRegistration();
      const filesBefore = await workspaceFiles(world);
      const adopted = await world.adopt({ label: 'pl46' });
      expect(adopted.plan.stages.map(stage => stage.stageId)).toEqual(['stage-one']);

      const path = world.taskbookPath({
        stageId: 'stage-one', planId: adopted.plan.planId, planRevision: 1,
      });
      const text = await vi.waitFor(() => world.readFile(path), { timeout: 5_000 });

      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain(INSTRUCTION);
      expect(text).toContain('stage-work');
      expect(text).toContain('stage-one');
      expect(text).toContain(adopted.plan.planId);
      // The body carries the plan revision; `rev-1` is the file name only.
      expect(text).toContain('- Plan revision: 1');

      const after = await world.readWorkspaceRegistration();
      expect(after).toEqual(before);
      const homework = await readdir(world.world.root, { withFileTypes: true });
      expect(homework.some(entry => entry.name.startsWith('goal-'))).toBe(false);
      expect(await workspaceFiles(world)).toEqual(filesBefore);

      // The notice names the written file on both public reads.
      const notices = await world.readNotices();
      for (const items of [notices.main, notices.queue]) {
        const adoption = items.find(item => item['category'] === 'plan_adoption');
        expect(String(adoption?.['summary'])).toContain(`任务书 stage-one 已导出（${path}）`);
      }
    } finally {
      await world.close();
    }
  });

  it('exports a candidate once at the Workflow candidate-card exit and reads it through decisions/candidate-card', async () => {
    vi.spyOn(taskbookExport, 'exportTaskbooksForPlan');
    const world = await openPLTaskbookWorld();
    try {
      await world.adopt({ label: 'pl46-card-base' });
      const before = await world.readWorkspaceRegistration();
      const filesBefore = await workspaceFiles(world);
      const candidate = await world.main.proposeCandidate({
        label: 'pl46-card', goal: world.goal, request: null,
      });

      // The ruled path is propose -> the real Workflow advance's candidate-card
      // exit -> the Host's export -> the card read. The candidate is not
      // adopted (no review line), so P4's goal loop exports the draft once
      // before it answers the card. This tree has no plan loop in
      // `selectNext` (P4, workflow.ts) and no `adoptAndExport` in Host (L), so
      // the advance below cannot reach the exit and no file is written; the
      // real file read is where the row stops until those symbols land.
      const steps = await driveWorkflow(world.world.ag2b, {
        schemaVersion: 1, goalRef: world.goal, flowId: 'pl46-card-exit',
        sessionHint: null, kind: 'select_work',
      });
      expect(steps.length).toBeGreaterThan(0);

      // The candidate draft is the active revision + 1 (hand-computed from
      // `oneStageDraft` revision 1); the path is §5.3.4's literal.
      const path = world.taskbookPath({
        stageId: 'stage-one', planId: 's6a-cards-plan-pl46-card', planRevision: 2,
      });
      const text = await vi.waitFor(() => world.readFile(path), { timeout: 5_000 });
      expect(text).toContain(INSTRUCTION);
      expect(text).toContain('- Plan revision: 2');

      // §6.4.3 "调一次": one write per candidate version, not one per exit of the round.
      await world.world.settleDetached();
      const once = ['pl-taskbook-pl46-card-base@1', 's6a-cards-plan-pl46-card@2'];
      expect(exportsStarted()).toEqual(once);

      // A later round reaches the same card exit: the count stands and the card still reads the path.
      const again = await driveWorkflow(world.world.ag2b, {
        schemaVersion: 1, goalRef: world.goal, flowId: 'pl46-card-exit-again',
        sessionHint: null, kind: 'select_work',
      });
      expect(again.at(-1)?.source?.kind).toBe('candidate');
      await world.world.settleDetached();
      expect(exportsStarted()).toEqual(once);

      const read = await world.readCandidateCard(candidate.proposal.ref) as Record<string, unknown>;
      expect(read['status']).toBe('ready');
      const value = read['value'] as Record<string, unknown>;
      const exportRead = value['exportRead'] as Record<string, unknown>;
      expect(exportRead['status']).toBe('ready');
      const stages = exportRead['stages'] as Array<Record<string, unknown>>;
      expect(stages).toHaveLength(1);
      expect(stages[0]?.['state']).toBe('written');
      expect(stages[0]?.['stageId']).toBe('stage-one');
      expect(stages[0]?.['path']).toBe(path);
      expect(await world.readWorkspaceRegistration()).toEqual(before);
      expect(await workspaceFiles(world)).toEqual(filesBefore);
    } finally {
      vi.restoreAllMocks();
      await world.close();
    }
  });

  it('the Goal driver exports a candidate at its card exit, the same as the public advance', async () => {
    const world = await openPLTaskbookWorld();
    try {
      await world.adopt({ label: 'pl46-driver-base' });
      await world.main.proposeCandidate({ label: 'pl46-driver', goal: world.goal, request: null });
      await startGoalDriver(world.world, world.goal, 'pl46-driver');
      const path = world.taskbookPath({
        stageId: 'stage-one', planId: 's6a-cards-plan-pl46-driver', planRevision: 2,
      });
      const text = await vi.waitFor(() => world.readFile(path), { timeout: 5_000 });
      expect(text).toContain('- Plan revision: 2');
    } finally {
      await world.close();
    }
  });

  it.each(cardExportStates)('the card reads exportRead $name', async (state) => {
    const world = await openPLTaskbookWorld(state.options);
    try {
      await state.before?.(world);
      await world.adopt({ label: 'pl46-state-base' });
      const candidate = await world.main.proposeCandidate({
        label: 'pl46-state', goal: world.goal, request: null,
      });
      await driveWorkflow(world.world.ag2b, {
        schemaVersion: 1, goalRef: world.goal, flowId: 'pl46-state-exit',
        sessionHint: null, kind: 'select_work',
      });
      const path = world.taskbookPath({
        stageId: 'stage-one', planId: 's6a-cards-plan-pl46-state', planRevision: 2,
      });
      const read = async (): Promise<unknown> => readyValue<{ exportRead: unknown }>(
        await world.readCandidateCard(candidate.proposal.ref), 'the candidate card').exportRead;
      const expected = await state.arrange(path, read);
      expect(await read()).toEqual(expected);
      // The read takes the draft of a candidate nobody adopted.
      expect((await readProposal(world.world, candidate.proposal.ref)).status).toBe('candidate');
    } finally {
      vi.restoreAllMocks();
      await world.close();
    }
  });

  it('the card reads exportRead not_configured on a Host with no settings directory', async () => {
    const world = await withConfiguredHost(
      () => openS6AHostWorld({ backend: 'memory',
        extraHostOptions: { checks: checkConfiguration({ ...OPERATOR, kind: 'human' }) } }),
      original => async ({ settings: _none, ...hostOptions }) => await original(hostOptions));
    try {
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      await governS6B(world, main, world.goals);
      const candidate = await main.proposeCandidate({ label: 'pl46-none', goal: world.goals.first, request: null });
      const card = readyValue<{ exportRead: unknown }>(await main.route('decisions/candidate-card', {
        goalRef: world.goals.first, proposalRef: candidate.proposal.ref,
      }), 'the candidate card');
      expect(card.exportRead).toEqual({ status: 'not_configured' });
    } finally {
      await world.close();
    }
  });

  it('Host close waits for a taskbook export still running', async () => {
    // A3: the export is held until the goal fan-out's close, the last drain before
    // the Host's export wait. From there the stores close after microtasks only,
    // and the real write needs the disk: without the wait the stores go first.
    const fanOutClosed = deferred();
    const realFanOut = goalFanOutModule.createGoalFanOutDriver;
    vi.spyOn(goalFanOutModule, 'createGoalFanOutDriver').mockImplementation((deps) => {
      const driver = realFanOut(deps);
      return { ...driver, close: async () => { await driver.close(); fanOutClosed.resolve(); } };
    });
    const realExport = taskbookExport.exportTaskbooksForPlan;
    let finished = 0;
    vi.spyOn(taskbookExport, 'exportTaskbooksForPlan').mockImplementation(async (input) => {
      await fanOutClosed.promise;
      const results = await realExport(input);
      finished += 1;
      return results;
    });
    const world = await openPLTaskbookWorld();
    try {
      const adopted = await world.adopt({ label: 'pl46-close' });
      const platform = world.world.platform;
      const realClose = platform.close.bind(platform);
      let finishedAtStoreClose: number | undefined;
      platform.close = async () => { finishedAtStoreClose = finished; await realClose(); };
      await world.world.host.close();
      expect(finishedAtStoreClose).toBe(1);
      const text = await world.readFile(world.taskbookPath({
        stageId: 'stage-one', planId: adopted.plan.planId, planRevision: 1,
      }));
      expect(text).toContain(INSTRUCTION);
    } finally {
      vi.restoreAllMocks();
      await world.close();
    }
  });

  it('isolation: the export root is the workspace root, so nothing is written and the notice says so', async () => {
    const world = await openPLTaskbookWorld({ isolation: true });
    try {
      const adopted = await world.adopt({ label: 'pl46-isolated' });
      expect(adopted.plan.planRevision).toBe(1);
      const files = await readdir(join(world.settingsDirectory, 'taskbooks'), { withFileTypes: true });
      expect(files.some(entry => entry.name.endsWith('.md'))).toBe(false);
      const nested = await readdir(join(world.settingsDirectory, 'taskbooks'), { recursive: true });
      expect(nested.filter(name => name.endsWith('.md'))).toEqual([]);
      const cards = await world.main.readCards(world.goal);
      expect(cards.filter(card => card.state === 'waiting_answer')).toEqual([]);

      // P6-07: each public entry point returns exactly this one item; the two
      // reads are the same notification (same `itemKey`), never one merged list.
      const { main:dmain, queue } = await world.readNotices();
      const mainNotices = dmain.filter(item => item['category'] === 'plan_adoption');
      const queueNotices = queue.filter(item => item['category'] === 'plan_adoption');
      expect(mainNotices).toHaveLength(1);
      expect(queueNotices).toHaveLength(1);
      expect(mainNotices[0]?.['itemKey']).toBe(queueNotices[0]?.['itemKey']);
      expect(String(mainNotices[0]?.['summary'])).toContain('导出失败：未写出');
    } finally {
      await world.close();
    }
  });
});
