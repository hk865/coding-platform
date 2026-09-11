import fs from 'node:fs';
const root='evidence/2026-09-11-source-cleanup/';
const inventories=['inventory-before.json','inventory-final.json'].map(f=>JSON.parse(fs.readFileSync(root+f)));
const stats=inventories.map(r=>{
 const contracts=r.rows.filter(x=>x.file.startsWith('src/contracts/'));
 return {contracts:contracts.length,topLevel:contracts.filter(x=>x.file.split('/').length===3).length,
 publicNamedExports:contracts.filter(x=>x.owner==='Contracts').reduce((n,x)=>n+x.exports.length,0),
 pipeline:r.rows.filter(x=>['src/control/plan-compiler/rework-plan-compiler.ts','src/control/plan-compiler/rework-proposal.ts','src/contracts/verification-service.ts','src/control/verification-engine/verification-deps.ts','src/harness/in-memory-harness.ts','src/harness/persistent-harness.ts'].includes(x.file)).map(({file,lines})=>({file,lines}))};
});
const start=JSON.parse(fs.readFileSync(root+'baseline.json')),end=JSON.parse(fs.readFileSync(root+(process.argv[2]??'candidate.json'))),changes={};
for(const k of ['product','docs']){
 const prev=new Map(start.roots[k].files.map(x=>[x.path,x.sha256])),next=new Map(end.roots[k].files.map(x=>[x.path,x.sha256]));
 changes[k]=[...new Set([...prev.keys(),...next.keys()])].filter(p=>prev.get(p)!==next.get(p)).map(p=>({path:p,before:prev.get(p)??null,after:next.get(p)??null}));
}
fs.writeFileSync(root+'changes.json',JSON.stringify(changes,null,2));
fs.writeFileSync(root+'metrics.json',JSON.stringify({before:stats[0],after:stats[1]},null,2));
console.log(JSON.stringify({stats,changes:Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,v.length]))},null,2));
