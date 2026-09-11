import fs from 'node:fs';
import crypto from 'node:crypto';
const root='evidence/2026-09-11-source-cleanup/export-pruning';
const before=JSON.parse(fs.readFileSync(`${root}/baseline.json`,'utf8')),after=JSON.parse(fs.readFileSync(`${root}/final.json`,'utf8'));
const report={roots:{},unpreserved:[],uiProbeRestored:false,gitignorePreserved:false};
for(const key of ['product','docs']){const old=new Map(before.roots[key].files.map(f=>[f.path,f.sha256])),current=new Map(after.roots[key].files.map(f=>[f.path,f.sha256]));
 const changed=[...new Set([...old.keys(),...current.keys()])].filter(f=>old.get(f)!==current.get(f)),preserved=[];
 for(const file of changed.filter(f=>old.has(f))){const archive=`${root}/history/${key==='docs'?'docs/':''}${file}.txt`;if(!fs.existsSync(archive)||crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!==old.get(file))report.unpreserved.push({key,file});else preserved.push(file);}
 report.roots[key]={headBefore:before.roots[key].head,headAfter:after.roots[key].head,digest:after.roots[key].digest,changed,removed:changed.filter(f=>!current.has(f)),added:changed.filter(f=>!old.has(f)),preserved};
 if(key==='product'){report.uiProbeRestored=old.get('src/ui/src/format.ts')===current.get('src/ui/src/format.ts');report.gitignorePreserved=old.get('.gitignore')===current.get('.gitignore');}
}
fs.writeFileSync(`${root}/preservation.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({changes:Object.fromEntries(Object.entries(report.roots).map(([k,v])=>[k,{count:v.changed.length,removed:v.removed,added:v.added}])),unpreserved:report.unpreserved,uiProbeRestored:report.uiProbeRestored,gitignorePreserved:report.gitignorePreserved}));if(report.unpreserved.length||!report.uiProbeRestored||!report.gitignorePreserved)process.exitCode=1;
