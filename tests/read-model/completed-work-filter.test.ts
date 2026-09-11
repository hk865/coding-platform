import { expect, it } from 'vitest';
import { createPersistentSqliteHarness } from '../../src/harness/persistent-harness.js';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { createP108ScenarioRuntime } from '../contract-suite/p1-08-harness.js';
import { runP116ContinuityScenario, type P1_16HarnessLike } from '../contract-suite/p1-16-harness.js';

it.each(['memory', 'sqlite'])('completed-work view excludes uncompleted coordination bindings (%s)', async mode => {
  const options = { runtime: createP108ScenarioRuntime() };
  const persistent = mode === 'sqlite' ? await createPersistentSqliteHarness(options) : null;
  const h = persistent ?? createInMemoryHarness(options);
  try {
    await runP116ContinuityScenario(h as unknown as P1_16HarnessLike);
    const view = await h.completedWorkView({ projectId: 'proj-alpha', workspaceId: 'ws-shared' });
    expect(view.status).toBe('ready');
    if (view.status !== 'ready') throw Error('missing completed task');
    // 该视图只收「正式完成」的工作。**一个任务只应有一个持久工作身份**：场景已经为 task-p108-work
    // 显式绑定过工作，派发面因此必须复用那个身份，而不是为同一任务再造一个（否则同一段工作会有
    // 两个 binding，接续与历史继承都会选错）。
    const rows = view.rows.map(row => ({ workId: row.workRef.workId, taskId: row.taskId }));
    expect(rows).toEqual([{ workId: 'work-p116-1', taskId: 'task-p108-work' }]);
    if (persistent) {
      await persistent.close();
      const reopened = await persistent.reopen();
      try { expect(await reopened.completedWorkView({ projectId: 'proj-alpha', workspaceId: 'ws-shared' })).toEqual(view); }
      finally { await reopened.close(); }
    }
  } finally { await persistent?.cleanup(); }
});