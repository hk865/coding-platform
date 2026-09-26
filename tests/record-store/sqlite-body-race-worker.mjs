import { pathToFileURL } from 'node:url';

const [modulePath, databasePath, runId] = process.argv.slice(2);
try {
  const { createSqliteRawArtifactStore } = await import(pathToFileURL(modulePath).href);
  const owner = { aggregateType: 'Run', projectId: 'race-project', goalId: 'race-goal', runId };
  // Parent releases both processes together so the database initialization
  // itself, not only the later put, is covered by the race test.
  process.send?.({ phase: 'preopen', runId });
  process.once('message', message => {
    if (message !== 'open') return;
    try {
      const store = createSqliteRawArtifactStore(databasePath);
      process.send?.({ phase: 'ready', runId });
      process.once('message', async putMessage => {
        if (putMessage !== 'put') return;
        try {
          const result = await store.put({ body: 'identical concurrent body', contentType: 'text/plain',
            sourceRefs: [{ kind: 'workspace', refId: 'workspace-main', revision: runId }],
            origin: { kind: 'run', owner }, requestedAt: '2026-09-24T00:00:00.000Z' });
          await store.close();
          process.send?.({ phase: 'done', runId, result }, () => process.exit(0));
        } catch (error) {
          try { await store.close(); } catch { /* preserve original failure */ }
          process.send?.({ phase: 'error', runId, message: String(error) }, () => process.exit(1));
        }
      });
    } catch (error) {
      process.send?.({ phase: 'error', runId, message: String(error) }, () => process.exit(1));
    }
  });
} catch (error) {
  process.send?.({ phase: 'error', runId, message: String(error) }, () => process.exit(1));
}
