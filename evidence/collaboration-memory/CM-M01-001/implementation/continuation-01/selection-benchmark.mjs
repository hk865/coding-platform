import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
const results=[];
for(const size of [1000,10000]){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE snapshots (ref_key TEXT PRIMARY KEY, snapshot_json TEXT)');
 const insert=db.prepare('INSERT INTO snapshots VALUES (?,?)');db.exec('BEGIN');
 for(let i=0;i<size;i++)insert.run(String(i),JSON.stringify({ref:{aggregateType:i%10===0?'DispatchOutboxEntry':'OtherBenchmarkAggregate'},status:'pending',intent:{projectId:'p',goalId:i%100===0?'target':'other'},body:'x'.repeat(4096)}));
 db.exec('COMMIT');
 const oldQuery=db.prepare('SELECT snapshot_json FROM snapshots');
 const newQuery=db.prepare("SELECT snapshot_json FROM snapshots WHERE json_extract(snapshot_json, '$.ref.aggregateType') = 'DispatchOutboxEntry' AND json_extract(snapshot_json, '$.status') = 'pending' AND json_extract(snapshot_json, '$.intent.projectId') = ? AND json_extract(snapshot_json, '$.intent.goalId') = ?");
 const run=(filtered)=>{const t=performance.now();const rows=filtered?newQuery.all('p','target'):oldQuery.all();const selected=rows.map(r=>JSON.parse(r.snapshot_json)).filter(r=>r.ref.aggregateType==='DispatchOutboxEntry'&&r.status==='pending'&&r.intent.projectId==='p'&&r.intent.goalId==='target');return {milliseconds:performance.now()-t,parsedRows:rows.length,selected:selected.length};};
 run(false);run(true);const before=[],after=[];for(let n=0;n<5;n++){before.push(run(false));after.push(run(true));}
 results.push({size,before,after});db.close();
}
const report={scope:'Isolated SQLite query/JSON parsing microbenchmark, not full product latency or production-scale evidence; no index/schema change',node:process.version,results};
writeFileSync('evidence/collaboration-memory/CM-M01-001/implementation/continuation-01/selection-benchmark.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({size:r.size,beforeMedianMs:r.before.map(x=>x.milliseconds).sort((a,b)=>a-b)[2],afterMedianMs:r.after.map(x=>x.milliseconds).sort((a,b)=>a-b)[2],beforeParsed:r.before[0].parsedRows,afterParsed:r.after[0].parsedRows,selected:r.after[0].selected}))));
