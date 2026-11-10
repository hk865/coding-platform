/**
 * KLS-1b rows 03 and 06: one project's start-up reconcile merges both of its
 * workspaces into one report (STATE-MACHINES-SPEC W-11), and the public
 * `Host.close()` drains the queues, closes the platform and releases the lease
 * in that order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as leaseModule from '../../src/app/host-instance-lease.js';
import * as goalWaitWakes from '../../src/app/goal-wait-wakes.js';
import * as platformModule from '../../src/composition/create-platform.js';
import {
  AG2B_SCOPE, startAG2bHost,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  cleanupRestart, publicDirectory, readExecution, tempDir, writeAutomationSettings,
} from '../helpers/A2-restart-fixture.js';
import { hostReconcile, prepareKLS1BHostStore } from '../helpers/KLS1B-two-projects.js';
import { crashMidTurn } from './support/restart.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupRestart();
});

describe('KLS-1b per-scope reconcile and close ordering', () => {
  it('03 merges both workspaces of one project into one reconcile report (SQLite crash restart)', async () => {
    await prepareKLS1BHostStore();
    const root = await tempDir('kls1b-03-ws-');
    const database = await tempDir('kls1b-03-db-');
    const rootA2 = await tempDir('kls1b-03-ws2-');
    const publicDir = await publicDirectory();

    // Y2: the second workspace is a command-line workspace of the same project from the first start, with its own
    // binding and profile; it never joins over `workspaces/open`, so no join operation runs at the restart.
    const second2 = { scope: { projectId: AG2B_SCOPE.projectId, workspaceId: 'kls1b-03-second' }, root: rootA2 };
    const crashed = await crashMidTurn(root, database, publicDir, { host: { extraWorkspace: second2 } });
    await writeAutomationSettings(database, { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' });
    const second = await startAG2bHost(publicDir, { root, database, extraWorkspace: second2 });
    try {
      expect(hostReconcile(second.host, AG2B_SCOPE.projectId)).toMatchObject({
        lease: 'owned',
        leaseRow: 'HL-03',
        report: {
          runs: [{ ref: JSON.stringify(crashed.runRef), row: 'W-11', status: 'reconciled', reason: 'interrupted_clean' }],
          problems: [],
        },
      });
      expect((await readExecution(second, crashed.runRef)).run).toMatchObject({
        status: 'ended',
        outcome: 'crashed',
        reconciliation: {
          status: 'done',
          observation: { kind: 'interrupted_clean', kernelPaused: false, pausedIntentRef: null },
        },
      });
    } finally {
      await second.host.close();
      await crashed.release();
    }
  }, 180_000);

  it('06 drains the queues, closes the platform and releases the lease in order (SQLite only)', async () => {
    const order: string[] = [];
    const realCreateQueue = goalWaitWakes.createGoalWaitQueue;
    const realOpenPlatform = platformModule.openTargetPlatform;
    const realAcquireLease = leaseModule.acquireHostInstanceLease;
    vi.spyOn(goalWaitWakes, 'createGoalWaitQueue').mockImplementation(deps => {
      const queue = realCreateQueue(deps);
      const realSettle = queue.settle.bind(queue);
      queue.settle = async () => {
        await realSettle();
        order.push('queues-settled');
      };
      return queue;
    });
    vi.spyOn(platformModule, 'openTargetPlatform').mockImplementation(async options => {
      const made = await realOpenPlatform(options);
      const realClose = made.platform.close.bind(made.platform);
      made.platform.close = () => {
        order.push('platform-close');
        return realClose();
      };
      return made;
    });
    vi.spyOn(leaseModule, 'acquireHostInstanceLease').mockImplementation(async options => {
      const acquired = await realAcquireLease(options);
      const realRelease = acquired.release.bind(acquired);
      acquired.release = async () => {
        order.push('lease-release');
        await realRelease();
      };
      return acquired;
    });

    const publicDir = await publicDirectory();
    const root = await tempDir('kls1b-06-ws-');
    const database = await tempDir('kls1b-06-db-');
    const host = await startAG2bHost(publicDir, { root, database });
    await host.host.close();
    expect(order).toEqual(['queues-settled', 'platform-close', 'lease-release']);
  }, 120_000);
});
