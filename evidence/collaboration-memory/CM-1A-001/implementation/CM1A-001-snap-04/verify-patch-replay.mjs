import{readFileSync,writeFileSync,mkdirSync,mkdtempSync}from'node:fs';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';import path from'node:path';
const root=process.cwd(),out=path.join(root,'evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-04');
const r=JSON.parse(readFileSync(path.join(out,'preparation-reconstruction.json'))),before=JSON.parse(readFileSync(path.join(out,'preparation-source-snapshot.json'))),after=JSON.parse(readFileSync(path.join(out,'source-snapshot.json')));
const scratch=mkdtempSync(path.join(root,'.local/cm1a-patch-proof-')),base=path.join(r.scratch,'baseline');
const files=Object.keys(before.fileHashes).sort();
execFileSync('git',['checkout-index','--prefix='+scratch.split(path.sep).join('/')+'/','--stdin','-z'],{cwd:base,input:files.join('\0')+'\0'});
const sha=b=>createHash('sha256').update(b).digest('hex');
function verify(snapshot){const fold=createHash('sha256');for(const f of Object.keys(snapshot.fileHashes).sort()){const hash=sha(readFileSync(path.join(scratch,f)));if(hash!==snapshot.fileHashes[f])throw Error('Byte mismatch: '+f);fold.update(f+'\0'+hash+'\n')}const id=fold.digest('hex');if(id!==snapshot.sourceFingerprintSha256)throw Error('Aggregate mismatch');return id;}
const beforeHash=verify(before);
execFileSync('git',['init','--quiet','--initial-branch=codex/cm1a-patch-proof'],{cwd:scratch});execFileSync('git',['config','core.autocrlf','false'],{cwd:scratch});
const patch=path.join(out,'baseline-to-delivery.patch');execFileSync('git',['apply','--check',patch],{cwd:scratch});execFileSync('git',['apply',patch],{cwd:scratch});
const afterHash=verify(after);
writeFileSync(path.join(out,'patch-replay-verification.json'),JSON.stringify({baselineFingerprint:beforeHash,deliveryFingerprint:afterHash,patchSha256:sha(readFileSync(patch)),beforeFiles:files.length,afterFiles:Object.keys(after.fileHashes).length,rawBytesMatch:true,isolatedDirectory:scratch,verifiedAt:new Date().toISOString()},null,2)+'\n');
console.log({beforeHash,afterHash,rawBytesMatch:true});
