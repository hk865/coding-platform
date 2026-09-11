import { readFile, writeFile } from 'node:fs/promises';
export async function readTasks(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function listTasks(file, { status = 'all', q = '', page = 1, pageSize = 3 } = {}) {
  const rows = await readTasks(file);
  const start = (page - 1) * pageSize;
  const matches = row => (status === 'all' || row.status === status) && row.title.includes(q.trim());
  const selected = rows.filter(matches).slice(start, start + pageSize);
  return { items: selected, total: rows.filter(matches).length, page, pageSize };
}
export async function addTask(file, row) {
  const rows = await readTasks(file);
  const existing = rows.find(item => item.id === row.id);
  if (existing) return existing;
  const task = { id: String(row.id), title: String(row.title), status: row.status === 'done' ? 'done' : 'open' };
  await writeFile(file, JSON.stringify([...rows, task], null, 2) + '\n');
  return task;
}
