import fs from 'node:fs';
import crypto from 'node:crypto';
const evidence='evidence/2026-09-11-source-cleanup/contracts-followup';
const before=JSON.parse(fs.readFileSync(`${evidence}/baseline.json`,'utf8'));
const after=JSON.parse(fs.readFileSync(`${evidence}/final.json`,'utf8'));
const hash=body=>crypto.createHash('sha256').update(body).digest('hex');
const report={roots:{},unpreserved:[],uiProbeRestored:false,gitignorePreserved:false};
for(const key of ['product','docs']){
 const old=new Map(before.roots[key].files.map(f=>[f.path,f.sha256])),current=new Map(after.roots[key].files.map(f=>[f.path,f.sha256]));
 const changed=[...new Set([...old.keys(),...current.keys()])].filter(f=>old.get(f)!==current.get(f));
 const preserved=[];
 for(const file of changed.filter(f=>old.has(f))){const archive=`${evidence}/history/${key==='docs'?'docs/':''}${file}.txt`;
  if(!fs.existsSync(archive)||hash(fs.readFileSync(archive))!==old.get(file))report.unpreserved.push({root:key,file});else preserved.push(file);
 }
 report.roots[key]={headBefore:before.roots[key].head,headAfter:after.roots[key].head,digest:after.roots[key].digest,changed,removed:changed.filter(f=>!current.has(f)),added:changed.filter(f=>!old.has(f)),preserved};
 if(key==='product'){report.uiProbeRestored=old.get('src/ui/src/format.ts')===current.get('src/ui/src/format.ts');report.gitignorePreserved=old.get('.gitignore')===current.get('.gitignore');}
}
fs.writeFileSync(`${evidence}/preservation.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({roots:Object.fromEntries(Object.entries(report.roots).map(([k,v])=>[k,{changes:v.changed.length,removed:v.removed,added:v.added.length,head:v.headAfter,digest:v.digest}])),unpreserved:report.unpreserved,uiProbeRestored:report.uiProbeRestored,gitignorePreserved:report.gitignorePreserved}));
if(report.unpreserved.length||!report.uiProbeRestored||!report.gitignorePreserved)process.exitCode=1;
