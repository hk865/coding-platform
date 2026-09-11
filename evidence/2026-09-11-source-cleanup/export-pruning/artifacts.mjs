import fs from 'node:fs';
import path from 'node:path';
const root='evidence/2026-09-11-source-cleanup/export-pruning';
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
const files=walk('dist').filter(f=>f.endsWith('.js')&&!f.startsWith('dist/app/public/'));
const stale=files.filter(f=>!fs.existsSync(f.replace(/^dist\//,'src/').replace(/\.js$/,'.ts')));
const stage=process.argv[2];if(!['before','remove-known','after'].includes(stage))throw Error('stage required');
const output=`${root}/artifacts-${stage}.json`;if(fs.existsSync(output))throw Error('Existing evidence');
const report={checkedAt:new Date().toISOString(),count:files.length,stale};fs.writeFileSync(output,JSON.stringify(report,null,2));
if(stage==='remove-known'){
 for(const file of stale){if(file!=='dist/contracts/commands/reviewer-work.js'||!path.resolve(file).startsWith(path.resolve('dist/contracts/commands')+path.sep))throw Error(`Unexpected output ${file}`);}
 for(const file of stale){const original=fs.readFileSync(file),archive=`${root}/history/${file}.txt`;fs.mkdirSync(path.dirname(archive),{recursive:true});fs.writeFileSync(archive,original,{flag:'wx'});if(!fs.readFileSync(file).equals(original))throw Error('Concurrent artifact write');fs.unlinkSync(file);}
}else if(stale.length)process.exitCode=1;
console.log(JSON.stringify(report));
