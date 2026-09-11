import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const product=process.cwd();
const docs=path.resolve(product,'../agent_learn/agent_dev/agent_platform');
const skip=new Set(['.git','node_modules','.pnpm-store','.local','dist','evidence','.venv','__pycache__']);
function scan(root,dir=root){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
 const p=path.join(dir,e.name),rel=path.relative(root,p).replaceAll('\\','/');
 if(skip.has(e.name)||rel==='src/app/public/workbench'||rel==='dev_docs/verification/2026-09-11-source-cleanup')return [];
 if(e.isDirectory())return scan(root,p);
 if(!e.isFile()||(!/\.(md|mjs|cjs|js|jsx|ts|tsx|json|yaml|yml|sh|py|html|css|toml)$/.test(e.name)&& !['.gitignore'].includes(e.name)))return [];
 return [{path:rel,sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}];
}).sort((a,b)=>a.path.localeCompare(b.path));}
const result={createdAt:new Date().toISOString(),scope:'Text source/config/tests/vendor and current+historical documents; excludes generated workbench, dist, dependencies, evidence and this review directory',roots:{}};
for(const [name,root]of Object.entries({product,docs})){const files=scan(root);result.roots[name]={root,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files,digest:crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex')};}
fs.writeFileSync(path.join(product,'evidence/2026-09-11-source-cleanup',process.argv[2]||'baseline.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(result.roots).map(([k,v])=>[k,{head:v.head,files:v.files.length,digest:v.digest}]))));


