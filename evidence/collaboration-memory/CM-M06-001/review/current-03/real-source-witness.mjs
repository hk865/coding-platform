import '../../../../../tests/coordination/process-loader.mjs';
import { AlternativeReportMaterialCompiler } from '../../../../../src/data/context-compiler/alternative-report-materials.ts';
import { qualifiedAlternativeReport } from '../../../../../src/contracts/alternative-report.ts';
import { ArtifactVault } from '../../../../../src/data/artifact-vault/artifact-vault.ts';
import { createMaterialAccessResolver } from '../../../../../src/data/artifact-vault/material-access-policy.ts';
import { materialAccessGrantIdFor, materialAccessGrantRefFor } from '../../../../../src/contracts/material-access.ts';
import { canonicalJson } from '../../../../../src/contracts/fingerprint.ts';
const run={aggregateType:'Run',projectId:'p',goalId:'g',runId:'pre'};
const owner={...run,runId:'author'};
let pin={schemaVersion:1,projectId:'p',workspaceId:'w',sourceSet:{kind:'workspace_paths',paths:['.']},identity:{workspace:'fixture',commit:null},manifestDigest:'a'.repeat(64)};
let basis={planRef:null,workspaceRevision:1,sourceDigest:pin.manifestDigest,sourcePin:pin};
const predecessor={ref:run,revision:2,planRef:null,workspaceSnapshot:{workspaceId:'w',revision:1},envelope:{workspaceId:'w',planRef:null,workspaceSnapshot:{revision:1}}};
const wait={ref:{aggregateType:'WaitCondition',projectId:'p',workspaceId:'w',waitId:'wait'},wait:{mode:'any',predecessorRunRef:run}};
const records=new Map(); const put=s=>records.set(canonicalJson(s.ref),s);
put(predecessor); put({ref:{aggregateType:'Workspace',projectId:'p',workspaceId:'w'},revision:1});
put({ref:{aggregateType:'Goal',projectId:'p',goalId:'g'},revision:1,activePlanRevision:null,workspaceRef:{projectId:'p',workspaceId:'w'}});
const ledger={load:async ref=>records.has(canonicalJson(ref))?{status:'found',snapshot:records.get(canonicalJson(ref))}:{status:'not_found'}};
const source={capture:async()=>({status:'sourced',pin})};
const index={materialAccessCandidates:async q=>({status:'ready',sourceCursor:'99',grants:[...records.values()].filter(s=>s.ref.aggregateType==='MaterialAccessGrant'&&!s.revocation&&s.grant.materials.some(m=>canonicalJson(m)===canonicalJson(q.material))).map(s=>({ref:s.ref,revision:s.revision}))})};
const vault=new ArtifactVault(new Map(),{grants:createMaterialAccessResolver(ledger,index,source)});
const bodies=[];
for(const body of ['earlier valid body','later valid body']) bodies.push((await vault.put({body,contentType:'text/plain',ownerRef:owner,sourceRefs:[{kind:'fixture',id:body}]})).ref);
function grant(materials,revoked=false){const id=materialAccessGrantIdFor(run,materials,basis),ref=materialAccessGrantRefFor('p','w','g',id);const snapshot={ref,revision:revoked?2:1,grant:{schemaVersion:1,grantId:id,scope:{projectId:'p',workspaceId:'w',goalId:'g'},materials,reader:run,issuedBy:{aggregateType:'Control',projectId:'p',goalId:'g'},purpose:'fixture',basis,grantedAt:'2026-09-13T00:00:00.000Z'},revocation:revoked?{reason:'revoked'}:null};put(snapshot);return snapshot;}

const candidates=bodies.map((body,i)=>({conditionIndex:i,sourceCursor:String(i+1),deliveryRef:{aggregateType:'Delivery',projectId:'p',workspaceId:'w',deliveryId:String(i)},delivery:{delivery:{bodyRef:body}},request:{}}));
const compiler=new AlternativeReportMaterialCompiler({ledger,vault,source,grantCandidates:index});
const { WorkspaceSourceApplicability } = await import('../../../../../src/data/workspace-reader/source-applicability.ts');
const fs = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const root=await fs.mkdtemp(join(tmpdir(),'m06-independent-real-source-'));
const file=join(root,'report-source.txt'), held=join(root,'report-source.held');
let injectMissingRead=false, readFailures=0;
const access={
 sourceIdentity:async()=>({workspace:root,commit:null}),
 inventory:async()=>({paths:['report-source.txt'],truncated:false}),
 allowed:path=>path==='report-source.txt',
 read:async(path)=>{
  if(injectMissingRead){
   injectMissingRead=false;
   await fs.rename(file,held);
   try { await fs.readFile(file,'utf8'); throw Error('expected real ENOENT'); }
   catch(error){if(error.code!=='ENOENT')throw error; readFailures++; throw error;}
   finally { await fs.rename(held,file); }
  }
  return {content:await fs.readFile(join(root,path),'utf8')};
 }
};
const realSource=new WorkspaceSourceApplicability(async scope=>scope.projectId==='p'&&scope.workspaceId==='w'?access:null);
source.capture=(...args)=>realSource.capture(...args);
const capture=()=>realSource.capture({projectId:'p',workspaceId:'w',sourceSet:{kind:'workspace_paths',paths:['.']}});
async function prepare(){
 const captured=await capture();if(captured.status!=='sourced')throw Error('real capture unavailable');
 pin=captured.pin;basis={planRef:null,workspaceRevision:1,sourceDigest:pin.manifestDigest,sourcePin:pin};
 for(const [key,value] of records)if(value.grant)records.delete(key);
 grant([bodies[0]]);grant([bodies[1]]);
 return pin.manifestDigest;
}
function winner(result){return result.status==='observed'?qualifiedAlternativeReport(wait,candidates,result.qualification,ref=>records.get(canonicalJson(ref))):null;}
const open=vault.open.bind(vault);
try{
 await fs.writeFile(file,'source version one\n');
 const before=await prepare();
 let opens=0;
 vault.open=async(...args)=>{opens++;if(opens===1)await fs.writeFile(file,'source version two\n');return open(...args);};
 const changed=await compiler.observe(wait,predecessor,candidates);
 const after=await capture();
 if(changed.status!=='unavailable'||winner(changed)!==null||after.status!=='sourced'||before===after.pin.manifestDigest)throw Error('changed source selected report');
 console.log(JSON.stringify({case:'real file changed between compiler capture and Vault validation',before,after:after.pin.manifestDigest,opens,result:changed,winner:winner(changed)}));
 vault.open=open;
 // New source basis needs freshly prepared grants; a fresh retry can select the first report.
 await prepare();
 const refreshed=await compiler.observe(wait,predecessor,candidates);
 if(winner(refreshed)?.conditionIndex!==0)throw Error('fresh changed-source retry did not recover');
 console.log(JSON.stringify({case:'new-source exact grants retry',status:refreshed.status,winner:winner(refreshed)}));
 // Trigger actual ENOENT only during Vault's source validation, then restore the file.
 let faultArmed=false;
 vault.open=async(...args)=>{if(!faultArmed){faultArmed=true;injectMissingRead=true;}return open(...args);};
 const temporary=await compiler.observe(wait,predecessor,candidates);
 if(readFailures!==1||temporary.status!=='unavailable'||winner(temporary)!==null)throw Error('real transient source read selected later report');
 console.log(JSON.stringify({case:'real ENOENT during Vault source capture, restored before post-capture',readFailures,result:temporary,winner:winner(temporary)}));
 vault.open=open;
 const recovered=await compiler.observe(wait,predecessor,candidates);
 if(winner(recovered)?.conditionIndex!==0)throw Error('restored source did not recover first report');
 console.log(JSON.stringify({case:'retry after source restored',status:recovered.status,winner:winner(recovered)}));
 console.log('PASS real source change + transient ENOENT + fresh retry');
}finally{
 vault.open=open;
 await fs.rm(root,{recursive:true,force:true});
}
