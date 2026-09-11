import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from '../../.local/linux-test-tools/node_modules/typescript/lib/typescript.js';
const root='evidence/2026-09-11-source-cleanup', inv=JSON.parse(fs.readFileSync(root+'/inventory-before.json'));
const baseline=JSON.parse(fs.readFileSync(root+'/baseline.json')).roots.product.files;
const saved=new Set();
const dry=process.argv.includes('--dry-run');
const actions=[];
const original=file=>fs.readFileSync(fs.existsSync(root+'/history/'+file+'.txt')?root+'/history/'+file+'.txt':file,'utf8');
export function save(file){if(saved.has(file)||fs.existsSync(root+'/history/'+file+'.txt'))return;const body=fs.readFileSync(file);const before=baseline.find(r=>r.path===file);if(before&&crypto.createHash('sha256').update(body).digest('hex')!==before.sha256)throw Error('Concurrent edit: '+file);const dest=root+'/history/'+file+'.txt';fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body);saved.add(file);}
export function put(file,body){if(fs.existsSync(file)){const current=fs.readFileSync(file,'utf8');if(current===body)return;if(current!==original(file))throw Error('Unexpected intermediate edit: '+file);if(!dry)save(file);}actions.push({file,action:'write',bytes:Buffer.byteLength(body)});if(dry)return;fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.cleanup-tmp';fs.writeFileSync(temp,body,{flag:'wx'});fs.renameSync(temp,file);}
// Follow fixture-to-fixture imports from real source consumers before moving anything.
const support=inv.rows.filter(r=>/^src\/contracts\/(fixtures|testing)\//.test(r.file)).map(r=>r.file), retained=new Set();
function keep(file){if(retained.has(file))return;retained.add(file);for(const e of inv.edges.filter(e=>e.from===file&&support.includes(e.to)))keep(e.to);}
for(const e of inv.edges)if(e.from.startsWith('src/')&&!support.includes(e.from)&&support.includes(e.to))keep(e.to);
const removed=['src/contracts/index.ts','src/contracts/fixtures/index.ts','src/contracts/testing/index.ts','src/contracts/testing/query-context.stub.ts'];
const moves=Object.fromEntries(support.filter(f=>!retained.has(f)&&!removed.includes(f)).map(f=>[f,f.replace('src/contracts/','tests/contract-support/')]));
// This validation is private to the two StateLedger adapters; wire schemas remain unchanged.
moves['src/contracts/ledger-validation.ts']='src/data/state-ledger/ledger-validation.ts';
const merged='src/contracts/planning-work-materials.ts';
moves[merged]='src/contracts/planning.ts';
for(const row of inv.rows){const file=row.file;if(removed.includes(file))continue;let body=original(file);const dest=moves[file]??file;const ast=ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true);const edits=[];
 function visit(n){if(ts.isStringLiteral(n)&&n.text.startsWith('.')&&(ts.isImportDeclaration(n.parent)||ts.isExportDeclaration(n.parent)||ts.isLiteralTypeNode(n.parent)||ts.isCallExpression(n.parent))){const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),n.text)).replace(/\.js$/,'.ts');if(moves[file]||moves[target]){let spec=path.posix.relative(path.posix.dirname(dest),moves[target]??target).replace(/\.ts$/,'.js');if(!spec.startsWith('.'))spec='./'+spec;edits.push({start:n.getStart(ast)+1,end:n.end-1,spec});}}ts.forEachChild(n,visit);}visit(ast);
 for(const e of edits.sort((a,b)=>b.start-a.start))body=body.slice(0,e.start)+e.spec+body.slice(e.end);
 if(file===merged)continue;
 if(edits.length||dest!==file)put(dest,body);
}
put('src/contracts/planning.ts',fs.readFileSync('src/contracts/planning.ts','utf8')+'\n'+fs.readFileSync(merged,'utf8'));
if(process.argv.includes('--imports-only')){console.log(JSON.stringify({mode:'imports-only',actions},null,2));process.exit(0);}
for(const file of [...removed,...Object.keys(moves)]){if(!dry){save(file);fs.unlinkSync(file);}actions.push({file,action:'remove-after-copy'});}
if(dry){console.log(JSON.stringify({dryRun:true,unexpectedIntermediateEdits:0,pending:actions,retained:[...retained]},null,2));process.exit(0);}
fs.writeFileSync(root+'/migrations.json',JSON.stringify({moves,removed,retainedSupport:[...retained],consumers:inv.edges.filter(e=>moves[e.to]||removed.includes(e.to))},null,2));
console.log(JSON.stringify({moved:Object.keys(moves),removed,retained:[...retained]},null,2));
