import fs from 'node:fs';
import path from 'node:path';
import ts from '../../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const evidence='evidence/2026-09-11-source-cleanup/contracts-followup';
const baseline=JSON.parse(fs.readFileSync(`${evidence}/baseline.json`,'utf8'));
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):e.name.endsWith('.ts')?[`${dir}/${e.name}`]:[]);}
function metric(file,read=file){const body=fs.readFileSync(read,'utf8'),tree=ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true);return {file,lines:body.split(/\r?\n/).length,exports:tree.statements.filter(s=>s.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)).map(s=>s.name?.text??s.declarationList?.declarations[0].name.getText(tree))};}
const before=baseline.roots.product.files.filter(f=>f.path.startsWith('src/contracts/')&&f.path.endsWith('.ts')).map(f=>metric(f.path,fs.existsSync(`${evidence}/history/${f.path}.txt`)?`${evidence}/history/${f.path}.txt`:f.path));
const after=walk('src/contracts').map(f=>metric(f));
const summarize=files=>({files:files.length,topLevel:files.filter(f=>path.posix.dirname(f.file)==='src/contracts').length,exports:files.reduce((n,f)=>n+f.exports.length,0)});
const report={before:summarize(before),after:summarize(after),beforeRelevant:before.filter(f=>/\/(validation|rework(-drive|-acceptance|-disposition)?)\.ts$/.test(f.file)),afterRelevant:after.filter(f=>/\/contracts\/(validation|rework)\//.test(f.file))};
fs.writeFileSync(`${evidence}/metrics.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({before:report.before,after:report.after,newFiles:report.afterRelevant.map(({file,lines})=>({file,lines}))}));
