import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { listTasks } from '../src/store.mjs';
import { createBoard } from '../src/ui.mjs';
test('unfiltered first page', async () => {
 const page = await listTasks(fileURLToPath(new URL('../data/tasks.json', import.meta.url)), {});
 assert.equal(page.items.length, 3); assert.equal(page.total, 12);
});
test('board renders returned tasks', async () => {
 const board = createBoard({ fetcher: async () => ({ok:true,json:async()=>({items:[{id:'one',title:'Smoke'}],total:1})}), storage:undefined });
 await board.load(); assert.match(board.render(), /Smoke/);
});
