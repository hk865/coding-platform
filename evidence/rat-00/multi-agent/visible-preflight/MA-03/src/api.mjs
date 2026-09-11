import { listTasks, addTask } from './store.mjs';
export async function handleApi(req, res, file) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/api/tasks') return false;
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET') {
    const rawStatus = url.searchParams.get('status') || 'all';
    const status = ['all', 'open', 'done'].includes(rawStatus) ? rawStatus : 'all';
    const page = Math.max(1, Math.trunc(Number(url.searchParams.get('page')) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.trunc(Number(url.searchParams.get('pageSize')) || 3)));
    res.end(JSON.stringify(await listTasks(file, { status, page, pageSize })));
  } else if (req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    const row = JSON.parse(body);
    if (!row.id || !row.title) { res.statusCode = 400; res.end(JSON.stringify({ error: 'id and title required' })); }
    else res.end(JSON.stringify(await addTask(file, row)));
  } else { res.statusCode = 405; res.end('{}'); }
  return true;
}
