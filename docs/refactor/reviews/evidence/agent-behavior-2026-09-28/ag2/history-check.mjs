import { readFile, writeFile } from 'node:fs/promises';
const evidenceDir = 'docs/refactor/reviews/evidence/agent-behavior-2026-09-28/ag2';
const live = JSON.parse(await readFile(evidenceDir + '/live-result.json','utf8'));
const html = await (await fetch(live.url)).text();
const token = /<meta name="platform-token" content="([^"]+)">/.exec(html)?.[1];
if(!token) throw Error('Missing local Host token');
const response = await fetch(new URL('/api/real/core/sessions/history', live.url), {method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify({scope:live.scope,input:{sessionRef:live.sessionRef,afterCursor:null,throughCursor:null,limit:200}})});
const result = await response.json();
if(result.status !== 'ready') throw Error('History not readable');
const records = result.value.items.map(item=>({position:item.source.position,record:JSON.parse(item.body.text)}));
const events = records.map(({position,record})=>({position,event:record.payload.event})).filter(x=>x.event);
const failures = events.filter(x=>x.event.type==='tool.failed').map(({position,event})=>({position,detail:event.payload}));
const counts = {first:{requests:0,completedTools:0,failedTools:0},browser:{requests:0,completedTools:0,failedTools:0}};
for(const {position,event} of events){ const c=position<27?counts.first:counts.browser; if(event.type==='model.request_started')c.requests++; if(event.type==='tool.completed')c.completedTools++; if(event.type==='tool.failed')c.failedTools++; }
const summary = {scope:live.scope,sessionRef:live.sessionRef,recordCount:records.length,counts,failures,source:'formal sessions/history; tool/model event fields only; no private reasoning exported'};
await writeFile(evidenceDir+'/tool-events.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
