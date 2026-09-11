import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { handleApi } from './src/api.mjs';
export function createApp({ dataFile = fileURLToPath(new URL('./data/tasks.json', import.meta.url)) } = {}) {
  return createServer(async (req, res) => {
    try {
      if (await handleApi(req, res, dataFile)) return;
      const path = new URL(req.url, 'http://localhost').pathname;
      const allowed = new Map([['/', 'index.html'], ['/src/browser.mjs','src/browser.mjs'], ['/src/ui.mjs','src/ui.mjs']]);
      if (!allowed.has(path)) { res.statusCode = 404; res.end('Not found'); return; }
      res.setHeader('content-type', path.endsWith('.mjs') ? 'text/javascript' : 'text/html');
      res.end(await readFile(new URL(allowed.get(path), import.meta.url)));
    } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'request failed' })); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp({ dataFile: process.env.TASK_DATA_FILE });
  app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Taskboard: http://127.0.0.1:' + app.address().port));
}
