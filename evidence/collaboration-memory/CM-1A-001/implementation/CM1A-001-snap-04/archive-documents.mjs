import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd(),docs=path.resolve(root,'../agent_learn/agent_dev/agent_platform'),out=path.join(root,'evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04');
const sha=b=>createHash('sha256').update(b).digest('hex');
const docFiles=['AGENTS.md','PRODUCT.md','ARCHITECTURE.md','CONTEXT.md','human/module-status.md','dev_docs/document-ownership.md','dev_docs/agent/README.md',...['runtime-collaboration','context-lifecycle','state-ledger','command-event','module-boundaries'].map(n=>'dev_docs/interfaces/'+n+'.md'),...['control/control-engine','control/dispatch-engine','data/state-ledger','data/context-compiler','data/artifact-vault','execution/worker-runtime'].map(n=>'dev_docs/modules/'+n+'.md'),...['CM-1A-001','CM-1A-001-FOLLOWUP-PLAN','CM-1A-001-PROTOCOL-CONSTRAINTS','PLAN','READINESS','CURRENT-CALLCHAIN-EVIDENCE','BASELINE','HANDOFF','MAIN-AGENT-PROMPT','ACCEPTANCE-PROMPT','IMPLEMENTATION-PROMPT','CM-M06-DRAFT'].map(n=>'dev_docs/planning/active/collaboration-memory/'+n+'.md')];
docFiles.push(...['preparation-baseline.json','upstream-documents.json','product-working-tree.patch','product-untracked-source.patch'].map(n=>'dev_docs/planning/active/collaboration-memory/baseline/'+n));
const productFiles=['AGENTS.md','IMPLEMENTATION-HANDOFF.md','vendor/coding-agent/AGENTS.md','vendor/coding-agent/INTEGRATION.md','vendor/coding-agent/UPSTREAM.json'];
const rows=[];
for(const [kind,dir,files] of [['documentation',docs,docFiles],['product',root,productFiles]])for(const relative of files){const abs=path.join(dir,relative),bytes=readFileSync(abs),dest=path.join(out,'documents',kind,relative);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,bytes);rows.push({kind,path:relative,absolutePath:abs,bytes:bytes.length,sha256:sha(bytes),archivedPath:path.relative(out,dest).split(path.sep).join('/')});}
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
writeFileSync(path.join(out,'upstream-documents.json'),JSON.stringify({capturedAt:new Date().toISOString(),productHead:git(root,['rev-parse','HEAD']),documentationHead:git(docs,['rev-parse','HEAD']),documents:rows},null,2)+'\n');
writeFileSync(path.join(out,'working-tree-status.txt'),'PRODUCT HEAD '+git(root,['rev-parse','HEAD'])+'\n'+git(root,['-c','core.quotepath=false','status','--short'])+'\n\nDOCUMENTATION HEAD '+git(docs,['rev-parse','HEAD'])+'\n'+git(docs,['-c','core.quotepath=false','status','--short'])+'\n');
const snapshot=JSON.parse(readFileSync(path.join(out,'source-snapshot.json')));
const inventory=[];
for(const dir of [out,path.join(out,'logs')])for(const name of readdirSync(dir,{withFileTypes:true})){
 if(!name.isFile()||name.name==='delivery-files.json')continue;const p=path.join(dir,name.name),b=readFileSync(p);
 inventory.push({path:path.relative(out,p).split(path.sep).join('/'),bytes:b.length,sha256:sha(b)});
}
writeFileSync(path.join(out,'delivery-files.json'),JSON.stringify({sourceFingerprint:snapshot.sourceFingerprintSha256,files:inventory.sort((a,b)=>a.path.localeCompare(b.path)),sourceArchive:'source-files/',documents:'upstream-documents.json'},null,2)+'\n');
console.log({archivedDocuments:rows.length,sourceFingerprint:snapshot.sourceFingerprintSha256});
