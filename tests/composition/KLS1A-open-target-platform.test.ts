/**
 * KLS-1a T1: the records the composition root hands out are the backend its
 * platform writes (S6, T6, V2). Runs on memory and on a real SQLite directory.
 */
import { afterEach, expect, it } from 'vitest';
import {
  PROJECT_ID, WORKSPACE_ID, cleanupRestart, hostCtx, platformModule, projectKey, tempDir, bindingsForWorkspaces,
} from '../helpers/KLS1A-project-store-fixture.js';

afterEach(cleanupRestart);

it.each(['memory', 'sqlite'] as const)(
  'T1 %s: openTargetPlatform hands out the records backend the platform writes',
  async kind => {
    const directory = await tempDir('kls1a-platform-');
    const { openTargetPlatform } = await platformModule();
    const opened = await openTargetPlatform?.({
      storage: kind === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
      workspace: bindingsForWorkspaces([{ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, root: directory }]),
      kernelStores: { entries: [] },
      hostInstance: { hostInstanceId: 'kls1a-host', lease: 'owned', takeover: { kind: 'hl01_no_lock' } },
      now: () => '2026-11-10T00:00:00.000Z',
    });
    try {
      const receipt = await opened.platform.projects.createProject(hostCtx(PROJECT_ID, WORKSPACE_ID), {
        input: { projectId: PROJECT_ID },
        meta: { requestId: 'kls1a-p',
          expected: [{ ref: { aggregateType: 'Project', projectId: PROJECT_ID }, revision: 0 }] },
      });
      expect(receipt.status).toBe('committed');
      const read = await opened.records.readMany([projectKey(PROJECT_ID)]);
      expect(read.status).toBe('ready');
      expect(read.value.readThrough).toBe(receipt.cursor);
      expect(read.value.records.map((record: { refKey: string }) => record.refKey))
        .toEqual([projectKey(PROJECT_ID)]);
    } finally {
      await opened?.platform.close();
    }
  });
