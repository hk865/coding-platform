import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function evaluate(workspace, kind = 'filter') {
 const results = [];
 const check = async (id, fn) => { try { await fn(); results.push({ id, status:'PASS' }); } catch(e) { results.push({ id, status:'FAIL', reason:e.message }); } };
 const scratch = await mkdtemp(join(tmpdir(), 'rat-ma-function-'));
 const file = join(scratch, 'tasks.json');
 const rows = JSON.parse(await readFile(join(workspace,'data/tasks.json'),'utf8'));
 await writeFile(file, JSON.stringify(rows));
 const { createApp } = await import(pathToFileURL(join(workspace,'server.mjs')));
 const { createBoard, mount } = await import(pathToFileURL(join(workspace,'src/ui.mjs')));
 const app = createApp({dataFile:file});
 await new Promise((res,rej)=>{ app.once('error',rej); app.listen(0,'127.0.0.1',res); });
 const origin = 'http://127.0.0.1:'+app.address().port;
 const requests=[];
 const fetcher = async path => {requests.push(path); return fetch(origin+path);};
 const saved=new Map(); const storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value))};
 try {
  await check('regression.http-ui-assets',async()=>{ for (const path of ['/','/src/browser.mjs','/src/ui.mjs']) assert.equal((await fetch(origin+path)).status,200); assert.equal((await fetch(origin+'/private/labels.json')).status,404); });
  await check('regression.unfiltered-pagination',async()=>{ const r=await (await fetcher('/api/tasks?page=2&pageSize=3')).json(); assert.deepEqual(r.items.map(x=>x.id),rows.slice(3,6).map(x=>x.id)); assert.equal(r.total,12); });
  await check('pagination.filter-before-slice',async()=>{ const r=await (await fetcher('/api/tasks?status=open&page=2&pageSize=3')).json(); assert.deepEqual(r.items.map(x=>x.id),rows.filter(x=>x.status==='open').slice(3,6).map(x=>x.id)); assert.equal(r.total,6); });
  await check('pagination.filter-resets-ui-page',async()=>{ const b=createBoard({fetcher,storage}); await b.load(); await b.setPage(3); await b.setFilter({status:'done'}); assert.equal(b.state().page,1); assert.deepEqual(b.state().items.map(x=>x.id),['2','4','6']); });
  if (kind==='filter' || kind==='case-sensitive') {
   await check('filter.api-parameters-and-total',async()=>{ const r=await (await fetcher('/api/tasks?status=open&q=%20RELEASE%20&page=1&pageSize=2')).json(); const expected=kind==='case-sensitive'?[]:['1','3']; assert.deepEqual(r.items.map(x=>x.id),expected); assert.equal(r.total,kind==='case-sensitive'?0:4); });
   await check('filter.empty-result',async()=>{ const r=await (await fetcher('/api/tasks?q=no-such-title')).json(); assert.deepEqual(r.items,[]); assert.equal(r.total,0); });
   await check('filter.controller-http-render',async()=>{ const b=createBoard({fetcher,storage}); await b.setFilter({status:'open',q:'release'}); const expected=kind==='case-sensitive'?['1','3','5']:['1','3','5']; assert.deepEqual(b.state().items.map(x=>x.id),expected); assert.match(requests.at(-1),/q=release/); assert.match(b.render(),/Plan release/); assert.doesNotMatch(b.render(),/Update docs/); });
   await check('filter.persistence-after-reconstruction',async()=>{ const b=createBoard({fetcher,storage}); const savedQuery=kind==='case-sensitive'?'Tag':'tag'; await b.setFilter({status:'done',q:savedQuery}); const refreshed=createBoard({fetcher,storage}); await refreshed.load(); assert.equal(refreshed.state().status,'done'); assert.equal(refreshed.state().q,savedQuery); assert.deepEqual(refreshed.state().items.map(x=>x.id),['12']); });
   await check('filter.invalid-storage-fallback',async()=>{ const bad={getItem:()=>'{malformed',setItem:()=>{}}; const b=createBoard({fetcher,storage:bad}); await b.load(); assert.equal(b.state().status,'all'); });
   await check('filter.ui-controls-and-events',async()=>{
    // A bounded DOM port checks the actual mount event wiring; this is not a browser engine.
    const elements=new Map(); const root={innerHTML:'',querySelector(selector){if(!this.innerHTML.includes('id="'+selector.slice(1)+'"'))return null;if(!elements.has(selector))elements.set(selector,{value:'',innerHTML:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});return elements.get(selector);}};
    const mounted=mount(root,{fetcher,storage}); await mounted.ready;
    const input=root.querySelector('#query'); assert.ok(input,'visible search input');
    await input.listeners.input({target:{value:'API'}}); assert.match(root.querySelector('#items').innerHTML,/tasks/); assert.equal(mounted.board.state().q,'API');
   });
  }
  await check('regression.create-idempotent-and-escaped',async()=>{ const row={id:'special',title:'<script>bad()</script>',status:'open'}; for(let n=0;n<2;n++){const r=await fetch(origin+'/api/tasks',{method:'POST',body:JSON.stringify(row)}); assert.equal(r.status,200);} const all=await (await fetcher('/api/tasks?pageSize=100')).json(); assert.equal(all.items.filter(x=>x.id==='special').length,1); const b=createBoard({fetcher,storage:undefined}); await b.setFilter({status:'all',q:''}); await b.setPage(5); assert.match(b.render(),/&lt;script&gt;/); assert.doesNotMatch(b.render(),/<script>/); });
 } finally { await new Promise(res=>app.close(res)); await rm(scratch,{recursive:true,force:true}); }
 return { schemaVersion:1, layer:'fixture-functional-evaluator', kind, status:results.every(x=>x.status==='PASS')?'PASS':'FAIL', assertions:results, browserEngine:'NOT_PREPARED', realModelExecution:'NOT_RUN' };
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){try{const result=await evaluate(resolve(process.argv[2]),process.argv[3]||'filter');console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='PASS'?0:1;}catch(error){console.log(JSON.stringify({status:'ERROR',reason:error.message}));process.exitCode=2;}}
