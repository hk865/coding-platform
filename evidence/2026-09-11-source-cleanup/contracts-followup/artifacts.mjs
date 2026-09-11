import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const evidence='evidence/2026-09-11-source-cleanup/contracts-followup';
const allowed=new Set(['validation.js','rework.js','rework-drive.js','rework-acceptance.js','rework-disposition.js'].map(f=>`dist/contracts/${f}`));
function scan(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
const files=scan('dist').filter(f=>f.endsWith('.js')&&!f.startsWith('dist/app/public/'));
const stale=files.filter(f=>!fs.existsSync(f.replace(/^dist\//,'src/').replace(/\.js$/,'.ts')));
const report={checkedAt:new Date().toISOString(),count:files.length,stale};
const stage=process.argv[2];if(!['before','remove-known','after'].includes(stage))throw Error('stage required');
const out=`${evidence}/artifacts-${stage}.json`;if(fs.existsSync(out))throw Error('Evidence already exists');
fs.writeFileSync(out,JSON.stringify(report,null,2));
if(stage==='remove-known'){
 for(const file of stale){const absolute=path.resolve(file),expectedRoot=path.resolve('dist/contracts')+path.sep;
  if(!allowed.has(file)||!absolute.startsWith(expectedRoot))throw Error(`Unexpected artifact: ${file}`);
 }
 for(const file of stale){const body=fs.readFileSync(file),history=`${evidence}/history/${file}.txt`;fs.mkdirSync(path.dirname(history),{recursive:true});fs.writeFileSync(history,body,{flag:'wx'});
  const digest=crypto.createHash('sha256').update(body).digest('hex');if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==digest)throw Error(`Concurrent output ${file}`);
  fs.unlinkSync(file);
 }
}else if(stale.length)process.exitCode=1;
console.log(JSON.stringify(report));
