/**
 * KLS-2c-2b owner rows for the read-back gate in the decision queue (a person's copy of a module file: two files carry
 * one id, so the current architecture is unreadable).
 * Ruling 3(b): a frozen structural batch's card pins only the active pointer's revision, so it stays in the queue; the
 * card that would repair the files is not taken away. W-C is tests/helpers/S8C-proposal-world.ts (the real adviser
 * line and propose tool, the real queue read).
 * Merge ruling 3 (as 121-105 isolates the conflict cards): a staged repair behind a settled PASS reads the current
 * catalog for its footprint; the gate refusing it takes only the repair cards away (`repair_approval` is
 * `not_available`), the other cards and the notices are read. W-A is tests/helpers/S8C-repair-world.ts (the real Work
 * Run's `record_note`, the real check round, the real `decisions/queue`).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { openProposalWorld, type ProposalWorld } from '../helpers/S8C-proposal-world.js';
import { openS8CRepairWorld, type S8CRepairWorld } from '../helpers/S8C-repair-world.js';

const worlds: (ProposalWorld | S8CRepairWorld)[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.close())); });

/** A person's copy of the first module file under `root`: two files carry one id. */
function copyModuleFile(root: string): void {
  const folder = join(root, '.workbench/modules');
  const name = readdirSync(folder)[0]!;
  writeFileSync(join(folder, `copy-${name}`), readFileSync(join(folder, name)));
}

it('3(b): a structural card stays in the queue while a duplicate module id blocks the architecture read', async () => {
  const target = await openProposalWorld({ backend: 'memory' });
  worlds.push(target);
  const [result] = await target.propose([{ baseCatalogPin: target.pin, reason: 'KLS2C2 3(b)', ops: [{ op: 'add_module',
    module: { ref: { projectId: target.projectId, moduleId: 'kls2c2-new' }, name: 'kls2c2-new',
      responsibility: 'Own kls2c2-new', paths: ['src/kls2c2'], interfaces: [] } }] }]);
  if (result?.status !== 'needs_decision') throw new Error(JSON.stringify(result));
  copyModuleFile(target.staff.world.root);
  await expect(target.readCatalog()).rejects.toThrow(/unavailable/);
  expect(await target.cardByKey(result.cardKey)).toMatchObject({ state: 'waiting_answer',
    source: { kind: 'structural_proposal' } });
});

it('merge ruling 3: the gate refusing a PASS repair\'s footprint catalog takes away only the repair cards', async () => {
  const w = await openS8CRepairWorld({ label: 'kls2c2-repair-gate', dropRunActivity: true });
  worlds.push(w);
  await w.pass(await w.writeRepair({ ops: [{ op: 'set_responsibility', moduleId: 's6a-core', text: 'KLS2C2 core' }] }));
  const read = async () => {
    const body = await w.main.route('decisions/queue', { workspace: w.main.scope,
      sections: ['waiting_answer', 'answered_pending_application', 'history', 'notices'], page: { limit: 100 } }) as
      { status: string; value?: DecisionQueueReadV1 };
    expect(body, JSON.stringify(body).slice(0, 400)).toMatchObject({ status: 'ready' });
    const queue = body.value!;
    return { cards: [...queue.waitingAnswer, ...queue.answeredPendingApplication, ...queue.history]
      .map(card => card.source.kind), notices: queue.notices.map(notice => notice.category),
    repair: queue.capabilities.find(capability => capability.source === 'repair_approval')?.availability };
  };
  // The unknown footprint (no RunActivity) behind the PASS cards the repair; the Plan's candidate and its adoption
  // notice are the other card and notice.
  expect(await read()).toEqual({ cards: ['repair_approval', 'candidate'], notices: ['plan_adoption'],
    repair: 'available' });
  copyModuleFile(w.world.root);
  // 具名改坏「足迹读到闸门拒绝时照旧回拒绝」→ 整个队列回 unavailable，红在 read 里的 ready。
  expect(await read()).toEqual({ cards: ['candidate'], notices: ['plan_adoption'], repair: 'not_available' });
});
