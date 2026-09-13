import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,copyFileSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=process.cwd();
const out=path.join(root,'evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04');
const documents=path.resolve(root,'../agent_learn/agent_dev/agent_platform');
const prepDir=path.join(documents,'dev_docs/planning/active/collaboration-memory/baseline');
const prep=JSON.parse(readFileSync(path.join(prepDir,'preparation-baseline.json'),'utf8'));
const current=JSON.parse(readFileSync(path.join(out,'source-snapshot.json'),'utf8'));
const before=JSON.parse(readFileSync(path.join(out,'../continuation-04/baseline.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=(name,v)=>writeFileSync(path.join(out,name),JSON.stringify(v,null,2)+'\n');
const git=(cwd,args)=>execFileSync('git',args,{cwd,maxBuffer:128*1024*1024});
const scoped=f=>!/(^|\/)(node_modules|dist|coverage|\.local|\.git)(\/|$)/.test(f)&&(/^(src|tests|scripts|vendor\/coding-agent)\//.test(f)||/^[^/]+\.(json|ya?ml|mjs|ts)$/.test(f)||f==='.gitignore'||f==='.gitattributes');
const delta=(old,now)=>{
 const files=[...new Set([...Object.keys(old),...Object.keys(now)])].sort();
 return files.filter(f=>old[f]!==now[f]).map(f=>({path:f,change:!(f in old)?'added':!(f in now)||now[f]==='deleted'?'removed':'modified',beforeSha256:old[f]??null,afterSha256:now[f]??null}));
};
const changes=delta(before.fileHashes,current.fileHashes);
json('snap03-to-snap04-diff.json',{baselineFingerprint:before.sourceFingerprintSha256,sourceFingerprint:current.sourceFingerprintSha256,changes});
for(const f of Object.keys(current.fileHashes)){
 if(current.fileHashes[f]==='deleted')continue;
 const b=readFileSync(path.join(root,f));if(sha(b)!==current.fileHashes[f])throw Error('Frozen source changed: '+f);
 const dest=path.join(out,'source-files',f);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,b);
}
const scratch=mkdtempSync(path.join(root,'.local/cm1a-preparation-'));
const archive=path.join(scratch,'head.tar'),base=path.join(scratch,'baseline');mkdirSync(base);
const rootFiles=git(root,['ls-tree','--name-only',prep.product.head]).toString('utf8').trim().split('\n').filter(f=>scoped(f)||f==='IMPLEMENTATION-HANDOFF.md');
git(root,['-c','core.autocrlf=false','-c','core.eol=lf','archive','--format=tar','--output='+archive,prep.product.head,'--','src','tests','scripts','vendor/coding-agent',...rootFiles]);
if(process.platform==='win32') {
 const wsl=p=>'/mnt/'+p[0].toLowerCase()+p.slice(2).split(path.sep).join('/');
 execFileSync('wsl',['-e','tar','-xf',wsl(archive),'-C',wsl(base)]);
} else execFileSync('tar',['-xf',archive,'-C',base]);
git(base,['init','--quiet','--initial-branch=codex/cm1a-evidence-baseline']);git(base,['config','core.autocrlf','false']);
// Git's stored CRLF blobs were normalized in the preparation patch. Restore
// those text contexts for apply, then require the recorded raw SHA-256 below.
for(const item of prep.product.tracked_changes){ const dest=path.join(base,item.path);writeFileSync(dest,readFileSync(dest,'utf8').replaceAll('\r\n','\n')); }
for(const p of ['product-working-tree.patch','product-untracked-source.patch']){
 git(base,['apply','--check',path.join(prepDir,p)]);git(base,['apply',path.join(prepDir,p)]);
}
const verified=[];
for(const item of [...prep.product.tracked_changes,...prep.product.payload_untracked]){
 const dest=path.join(base,item.path);let b=readFileSync(dest);
 if(sha(b)!==item.sha256){
  const text=b.toString('utf8').replaceAll('\r\n','\n');
  const candidates=[Buffer.from(text),Buffer.from(text.replaceAll('\n','\r\n'))];
  const retained=existsSync(path.join(root,item.path)) ? readFileSync(path.join(root,item.path)) : Buffer.alloc(0);
  const match=[...candidates,retained].find(x=>sha(x)===item.sha256);if(!match)throw Error('Cannot reconstruct exact preparation bytes: '+item.path);b=match;writeFileSync(dest,b);
 }
 verified.push({path:item.path,sha256:sha(b)});
}
// Recover checkout EOL bytes for files whose content is unchanged from HEAD and
// whose raw bytes are also pinned by the adopted snap-03. The aggregate recorded
// preparation fingerprint below is the final independent equality check.
const headBlobs=new Map(git(root,['ls-tree','-r','-z',prep.product.head]).toString('utf8').split('\0').filter(Boolean).map(line=>{const [meta,f]=line.split('\t');return [f,meta.split(' ')[2]];}));
const payloadPaths=new Set([...prep.product.tracked_changes,...prep.product.payload_untracked].map(x=>x.path));
const checkoutRestorations=[];
const blobSha=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
for(const [f,blob] of headBlobs){
 if(!scoped(f)||payloadPaths.has(f)||current.fileHashes[f]!==before.fileHashes[f]||!existsSync(path.join(base,f)))continue;
 const retained=readFileSync(path.join(root,f));const stored=readFileSync(path.join(base,f));
 if(sha(retained)===sha(stored))continue;
 const normalized=Buffer.from(retained.toString('utf8').replaceAll('\r\n','\n'));
 if(blobSha(retained)!==blob && (retained.includes(0)||blobSha(normalized)!==blob))continue;
 writeFileSync(path.join(base,f),retained);checkoutRestorations.push({path:f,headBlob:blob,rawSha256:sha(retained),verifiedInSnap03:true});
}
// Preparation reused the prior template checkpoint's exact source tree. Its
// complete per-file index folds to the independently recorded preparation ID.
const oldIndexPath='evidence/2026-09-12-agent-templates-memory/source-fingerprint.json';
const oldIndexBytes=readFileSync(path.join(root,oldIndexPath));
const expectedIndex=JSON.parse(oldIndexBytes).files.filter(x=>scoped(x.path)).sort((a,b)=>a.path<b.path?-1:1);
const expectedFold=createHash('sha256');for(const item of expectedIndex)expectedFold.update(item.path+'\0'+item.sha256+'\n');
if('sha256:'+expectedFold.digest('hex')!==prep.product.source_snapshot.id)throw Error('Historical per-file index is not the preparation baseline');
const mixedEndingRestorations=[];
for(const item of expectedIndex){
 const dest=path.join(base,item.path);const original=readFileSync(dest);if(sha(original)===item.sha256)continue;
 const lines=original.toString('utf8').replaceAll('\r\n','\n').split('\n');let matched=null;
 for(let split=0;split<lines.length && !matched;split++)for(const reverse of [false,true]){
  const candidate=Buffer.from(lines.map((line,k)=>k===lines.length-1?line:line+((k<split)!==reverse?'\r\n':'\n')).join(''));
  if(sha(candidate)===item.sha256){matched=candidate;mixedEndingRestorations.push({path:item.path,split,reverse,sha256:item.sha256});break;}
 }
 if(!matched)throw Error('Cannot recover exact historical bytes: '+item.path);writeFileSync(dest,matched);
}
git(base,['add','--all']);
const baselineFiles=git(base,['ls-files','-z']).toString('utf8').split('\0').filter(f=>f&&scoped(f)).sort();
const hashes=Object.fromEntries(baselineFiles.map(f=>[f,sha(readFileSync(path.join(base,f)))]));
const fold=createHash('sha256');for(const f of baselineFiles)fold.update(f+'\0'+hashes[f]+'\n');
const baselineFingerprint=fold.digest('hex');
json('preparation-reconstruction.json',{source:prepDir,head:prep.product.head,recordedFingerprint:prep.product.source_snapshot.id,computedFingerprint:baselineFingerprint,fileCount:baselineFiles.length,verifiedPayloads:verified,checkoutRestorations,mixedEndingRestorations,historicalIndex:{path:oldIndexPath,sha256:sha(oldIndexBytes)},scratch});
if('sha256:'+baselineFingerprint!==prep.product.source_snapshot.id)throw Error('Preparation fingerprint mismatch: '+baselineFingerprint);
json('preparation-source-snapshot.json',{head:prep.product.head,sourceFileCount:baselineFiles.length,sourceFingerprintSha256:baselineFingerprint,fileHashes:hashes,provenance:'preparation-reconstruction.json'});
json('preparation-to-delivery-diff.json',{baselineFingerprint,sourceFingerprint:current.sourceFingerprintSha256,changes:delta(hashes,current.fileHashes)});
for(const f of [...new Set([...baselineFiles,...Object.keys(current.fileHashes)])]){
 const dest=path.join(base,f);
 if(!(f in current.fileHashes)||current.fileHashes[f]==='deleted'){if(existsSync(dest))unlinkSync(dest);continue;}
 mkdirSync(path.dirname(dest),{recursive:true});copyFileSync(path.join(out,'source-files',f),dest);
}
git(base,['add','--intent-to-add','--all']);
writeFileSync(path.join(out,'baseline-to-delivery.patch'),git(base,['diff','--binary','--no-ext-diff']));
json('evidence-source-index.json',{sourceFingerprint:current.sourceFingerprintSha256,fileCount:Object.keys(current.fileHashes).length,sourceDirectory:'source-files',preparationToDeliveryPatchSha256:sha(readFileSync(path.join(out,'baseline-to-delivery.patch'))),snap03Changes:changes.length});
console.log(JSON.stringify({baselineFingerprint,matchesRecorded:'sha256:'+baselineFingerprint===prep.product.source_snapshot.id,sourceFingerprint:current.sourceFingerprintSha256,snap03Changes:changes.length,scratch}));
