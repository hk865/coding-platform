/**
 * G-08 (C-9/N12, spec §5.3.4/§6.4.3): a failed taskbook export reaches this
 * adoption's "please be aware" notice, including when a human calls
 * `plans/apply`; it does not become a new card and does not touch the file.
 *
 * Runs to the first missing L wiring: `adoptAndExport` and the
 * `plan_adoption` notice source registration.
 */
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPLTaskbookWorld } from '../helpers/PL-taskbook-fixture.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';

describe('G-08: export failure in this adoption notice', () => {
  it('human plans/apply stays committed and the one plan_adoption notice carries the line', async () => {
    const world = await openPLTaskbookWorld();
    try {
      const taskbookRoot = join(world.settingsDirectory, 'taskbooks');
      await writeFile(taskbookRoot, 'not a directory\n');

      const adopted = await world.adopt({ label: 'g08' });
      expect(adopted.plan.planRevision).toBe(1);
      expect((await world.readActivePlan()).revision).toBe(1);

      // P6-07: each public entry point returns exactly this one item; the two
      // reads are the same notification (same `itemKey`), never one merged list.
      const { main:dmain, queue } = await world.readNotices();
      const mainNotices = dmain.filter(item => item['category'] === 'plan_adoption');
      const queueNotices = queue.filter(item => item['category'] === 'plan_adoption');
      expect(mainNotices).toHaveLength(1);
      expect(queueNotices).toHaveLength(1);
      expect(mainNotices[0]?.['itemKey']).toBe(queueNotices[0]?.['itemKey']);
      const summary = String(mainNotices[0]?.['summary']);
      const path = world.taskbookPath({
        stageId: 'stage-one', planId: adopted.plan.planId, planRevision: 1,
      });
      expect(summary).toContain(
        `任务书 stage-one 导出失败：未写出（${path}）；采用不受影响，不自动重试`);
      expect(summary).not.toContain('已导出');

      // No new "export failed" card: the card list is unchanged around the adoption.
      const cards = await world.main.readCards(world.goal);
      expect(cards.filter(card => card.closedReason === null)).toHaveLength(0);

      await expect(world.readFile(join(taskbookRoot, 'goal-g__plan-p__stage-stage-one__rev-1.md'))).rejects.toThrow();
      await expect(world.readFile(path), 'G-08: nothing exists at the real taskbook path').rejects.toThrow();

      // The same failure on the candidate card's own export read.
      const card = readyValue<{ exportRead: unknown }>(
        await world.readCandidateCard(adopted.proposalRef), 'the G-08 candidate card');
      expect(card.exportRead).toEqual({ status: 'ready',
        stages: [{ state: 'missing', stageId: 'stage-one', path }] });
    } finally {
      await world.close();
    }
  });

  it('isolation branch: the same line, nothing written inside the workspace', async () => {
    const world = await openPLTaskbookWorld({ isolation: true });
    try {
      const adopted = await world.adopt({ label: 'g08-isolated' });
      expect((await world.readActivePlan()).revision).toBe(1);

      const { main:dmain, queue } = await world.readNotices();
      const mainNotices = dmain.filter(item => item['category'] === 'plan_adoption');
      const queueNotices = queue.filter(item => item['category'] === 'plan_adoption');
      expect(mainNotices).toHaveLength(1);
      expect(queueNotices).toHaveLength(1);
      expect(mainNotices[0]?.['itemKey']).toBe(queueNotices[0]?.['itemKey']);
      expect(String(mainNotices[0]?.['summary'])).toContain('导出失败：未写出');
      expect((await world.main.readCards(world.goal)).filter(card => card.closedReason === null)).toHaveLength(0);
      await expect(world.readFile(world.taskbookPath({
        stageId: 'stage-one', planId: adopted.plan.planId, planRevision: 1,
      })), 'G-08: the isolated export wrote no file').rejects.toThrow();
    } finally {
      await world.close();
    }
  });
});
