import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const base='evidence/2026-09-11-architecture-convergence';
const scan=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(path.join(dir,e.name)):[path.join(dir,e.name)]);
const emitted=scan('dist').filter(p=>p.endsWith('.js')&&!p.replaceAll('\\','/').startsWith('dist/app/public/'));
const stale=emitted.filter(p=>!fs.existsSync(p.replace(/^dist[\\/]/,'src/').replace(/\.js$/,'.ts')));
fs.writeFileSync(base+'/build-artifacts.json',JSON.stringify({checkedAt:new Date().toISOString(),method:'Every non-UI emitted JS must have a current corresponding TS source; no orphan from an old Module path is permitted.',count:emitted.length,stale,files:emitted.map(p=>({path:p.replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}))},null,2));
if(stale.length)throw Error('stale emitted paths: '+stale.join(','));
const a=JSON.parse(fs.readFileSync(base+'/resumed.json')),b=JSON.parse(fs.readFileSync(base+'/final.json'));
const changes={};for(const root of ['product','docs']){const before=new Map(a.roots[root].files.map(f=>[f.path,f.sha256]));const after=new Map(b.roots[root].files.map(f=>[f.path,f.sha256]));changes[root]=[...new Set([...before.keys(),...after.keys()])].filter(p=>before.get(p)!==after.get(p)).map(p=>({path:p,before:before.get(p)||null,after:after.get(p)||null}));}
fs.writeFileSync(base+'/convergence-changes.json',JSON.stringify(changes,null,2));
console.log(JSON.stringify({emitted:emitted.length,stale,changed: Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,v.length]))}));
