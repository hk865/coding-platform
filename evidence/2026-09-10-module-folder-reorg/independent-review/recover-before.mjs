import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const ev='evidence/2026-09-10-module-folder-reorg/';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const before=new Map(JSON.parse(fs.readFileSync(ev+'before-source-sha256.json')).files.map(f=>[f.path,f]));
const audit=JSON.parse(fs.readFileSync(ev+'independent-review/audit.json'));
const meta=spawnSync('git',['cat-file','--batch-all-objects','--batch-check=%(objectname) %(objecttype) %(objectsize)'],{encoding:'utf8',maxBuffer:64*1024*1024});
if(meta.status!==0)throw Error(meta.stderr);
const blobs=meta.stdout.trim().split('\n').map(s=>s.trim().split(' ')).filter(x=>x[1]==='blob');
const results=[];
for(const r of audit.inverseImportAudit.notProven){
 const expected=before.get(r.oldPath);let match=null;
 for(const [oid,,size] of blobs){
  if(Number(size)!==expected.bytes)continue;
  const b=spawnSync('git',['cat-file','blob',oid],{maxBuffer:16*1024*1024});
  if(b.status!==0)throw Error(String(b.stderr));
  if(hash(b.stdout)===expected.sha256){match={oid,body:b.stdout};break;}
 }
 if(!match){results.push({path:r.oldPath,recovered:false});continue;}
 const target=ev+'independent-review/before/'+r.oldPath;
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,match.body);
 const reconstructed=ev+'independent-review/reconstructed/'+r.oldPath;
 const diff=spawnSync('git',['diff','--no-index','--no-ext-diff','--',target,reconstructed],{encoding:'utf8',maxBuffer:8*1024*1024});
 const output=ev+'independent-review/diffs/'+r.oldPath+'.diff';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,diff.stdout);
 results.push({path:r.oldPath,recovered:true,oid:match.oid,sha256:expected.sha256,diff:output});
}
fs.writeFileSync(ev+'independent-review/recovered-before.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
