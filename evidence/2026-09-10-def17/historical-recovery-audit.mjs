import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const roots = fs.readdirSync('.local',{withFileTypes:true}).filter(e => e.isDirectory() && (/data|browser|sep09.*evidence/.test(e.name))).map(e => '.local/' + e.name);
const directories = [], databases = [], errors = [], ignored = new Set(['node_modules','.git','dist','fixture','source']);
function visit(p, depth) {
 if(depth > 5) return;
 for(const e of fs.readdirSync(p,{withFileTypes:true})) {
  const n = p + '/' + e.name;
  if(e.isFile() && e.name === 'ledger.sqlite') databases.push(n);
  if(!e.isDirectory() || ignored.has(e.name)) continue;
  if(['real-runs','verifications'].includes(e.name)) directories.push(n); else visit(n,depth+1);
 }
}
for(const root of roots) visit(root,0);
const records = [], reviewerRecords = [];
for(const dir of directories) for(const name of fs.readdirSync(dir)) {
 if(!/^(?:review-)?[a-f0-9]{64}\.json$/.test(name)) continue;
 const file = dir + '/' + name;
 try {
  const bytes=fs.readFileSync(file), r=JSON.parse(bytes), scope=r.scope ?? r.spec;
  const entry={file,bytes:bytes.length,sha256:sha(bytes),kind:name.startsWith('review-')?'review-journal':'runtime-observation',scope:scope?Object.fromEntries(['projectId','workspaceId','goalId','runId','taskId'].map(k=>[k,scope[k]])):null,mode:r.spec?.mode??null,status:r.status??null,requestId:r.requestId??null,workRef:r.workRef??r.spec?.review?.workRef??null};
  records.push(entry);
  if(name.startsWith('review-') || r.spec?.mode==='review') reviewerRecords.push({...entry,phase:r.phase??null,events:Array.isArray(r.events)?r.events.map(e=>({eventId:e.eventId,eventType:e.eventType,sequence:e.sequence})):null,traceCount:r.trace?.length??null,usageCount:r.usage?.length??null});
 }catch(e){errors.push({file,error:String(e)})}
}
const canonical=[];
for(const file of databases) {
 let db;
 try {
  db=new DatabaseSync(file,{readOnly:true});
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
  if(!tables.includes('snapshots')){canonical.push({file,hasSnapshots:false});continue;}
  const columns=db.prepare('PRAGMA table_info(snapshots)').all().map(r=>r.name);
  if(!columns.includes('snapshot_json')){canonical.push({file,columns});continue;}
  const rows=db.prepare("SELECT snapshot_json FROM snapshots WHERE json_extract(snapshot_json,'$.ref.aggregateType') IN ('ReviewWork','ReviewResult','TaskReviewProtocol') OR (json_extract(snapshot_json,'$.ref.aggregateType')='Run' AND json_extract(snapshot_json,'$.work.kind')='review')").all().map(r=>JSON.parse(r.snapshot_json));
  canonical.push({file,reviewerSnapshots:rows.map(r=>({ref:r.ref,revision:r.revision,requestId:r.requestId??null,status:r.status??null,outcome:r.outcome??null,work:r.work??null,resultRef:r.resultRef??null,outputPresent:!!r.output}))});
 }catch(e){errors.push({file,error:String(e)})}finally{db?.close()}
}
const evidenceFiles=['evidence/2026-09-10-external-review/lease-refusal.log','evidence/2026-09-10-external-review-repair/f01-prefix-reproduction/prefix-f01-wedge.log','evidence/2026-09-10-external-review-repair/err01-targeted-pass.log'];
const logs=evidenceFiles.map(file=>{const b=fs.readFileSync(file);return{file,bytes:b.length,sha256:sha(b)}});
const result={checkedAt:new Date().toISOString(),scope:'Existing .local roots whose names contain data/browser/sep09 evidence, max five nested directory levels; only runtime/review JSON and read-only Reviewer canonical snapshots. Source/fixture/dependencies excluded. Known external-review and original-repair logs indexed separately.',roots,directories,records,reviewerRecords,canonical,errors,logs};
fs.writeFileSync('evidence/2026-09-10-def17/historical-recovery-inventory.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({roots:roots.length,directories:directories.length,qualifyingJsonFiles:records.length,reviewerRecords:reviewerRecords.length,ledgerDatabases:databases.length,reviewerCanonicalSnapshots:canonical.reduce((n,r)=>n+(r.reviewerSnapshots?.length??0),0),errors},null,2));
