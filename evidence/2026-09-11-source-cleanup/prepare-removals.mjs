import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const dir='evidence/2026-09-11-source-cleanup';
const pre=JSON.parse(fs.readFileSync(dir+'/migration-preflight.json'));
const inv=JSON.parse(fs.readFileSync(dir+'/inventory-before.json'));
const base=JSON.parse(fs.readFileSync(dir+'/baseline.json')).roots.product.files;
const removed=pre.pending.filter(a=>a.action==='remove-after-copy').map(a=>a.file);
const moves={};
for(const file of removed){
 const body=fs.readFileSync(file);if(crypto.createHash('sha256').update(body).digest('hex')!==base.find(r=>r.path===file).sha256)throw Error('Concurrent edit: '+file);
 const dest=dir+'/history/'+file+'.txt';fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.writeFileSync(dest,body);
 if(file.endsWith('/index.ts')||file.endsWith('/query-context.stub.ts'))continue;
 moves[file]=file==='src/contracts/ledger-validation.ts'?'src/data/state-ledger/ledger-validation.ts':file==='src/contracts/planning-work-materials.ts'?'src/contracts/planning.ts':file.replace('src/contracts/','tests/contract-support/');
 if(!fs.existsSync(moves[file]))throw Error('Missing destination '+file);
}
fs.writeFileSync(dir+'/migrations.json',JSON.stringify({moves,removed:removed.filter(f=>!moves[f]),retainedSupport:pre.retained,consumers:inv.edges.filter(e=>removed.includes(e.to))},null,2));
fs.writeFileSync(dir+'/remove-originals.patch','*** Begin Patch\n'+removed.map(f=>'*** Delete File: '+f).join('\n')+'\n*** End Patch');
console.log(JSON.stringify({verifiedOriginals:removed.length,destinationsPresent:Object.keys(moves).length}));
