import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const repo = resolve(process.env.MVP_UI_REPO ?? process.cwd());
const base = resolve(process.env.MVP_UI_OUTPUT_DIR ?? '/tmp/mvp-ui-live-20260928');
const { createLocalWorkbenchHost } = await import(pathToFileURL(join(repo,'dist/app/host.js')));
const { loadWorkbenchCliConfig } = await import(pathToFileURL(join(repo,'dist/app/main.js')));
const { createBuiltinProviderRegistry } = await import(pathToFileURL(join(repo,'vendor/coding-agent/dist/public-api.js')));
const sha = s => createHash('sha256').update(s).digest('hex');
// Read only at explicit launch. Never print or persist the credential.
const keyFile=process.env.MVP_UI_API_KEY_FILE;
if(!keyFile)throw Error('MVP_UI_API_KEY_FILE must name a private credential file');
const secretText=await readFile(keyFile,'utf8');
const key = secretText.match(/sk-[A-Za-z0-9_-]+/)?.[0] ?? secretText.trim();
if (!key || /\s/.test(key)) throw Error('The authorized credential file needs one usable API key');
await mkdir(base,{recursive:true});
const runDir = await mkdtemp(join(base,'run-')); const root=join(runDir,'project'), database=join(runDir,'db');
await mkdir(join(root,'src'),{recursive:true}); await mkdir(join(root,'checks')); await mkdir(database);
await writeFile(join(root,'package.json'),JSON.stringify({type:'module',scripts:{test:'node --test checks/retry.test.mjs'}},null,2));
await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',allowJs:true},include:['src/**/*.mjs']}));
await writeFile(join(root,'README.md'),'Small retry library. Implement the contract in contract.md. Keep checks unchanged.\n');
await writeFile(join(root,'contract.md'),'retry(operation,{maxAttempts,delayMs,sleep}) passes 1-based attempts; maxAttempts includes the first call. Return the first success. Sleep only between remaining attempts. Preserve the exact final error.\n');
await writeFile(join(root,'src/retry.mjs'),'export async function retry(operation, options) { return operation(0); }\n');
await writeFile(join(root,'checks/retry.test.mjs'),`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {retry} from '../src/retry.mjs';\ntest('success and delays',async()=>{const calls=[],waits=[];const v=await retry(async n=>{calls.push(n);if(n<3)throw Error('retry');return 17},{maxAttempts:3,delayMs:5,sleep:async n=>waits.push(n)});assert.equal(v,17);assert.deepEqual(calls,[1,2,3]);assert.deepEqual(waits,[5,5]);});\ntest('final error identity',async()=>{const e=Error('same'),waits=[];await assert.rejects(()=>retry(async()=>{throw e},{maxAttempts:2,delayMs:7,sleep:async n=>waits.push(n)}),x=>x===e);assert.deepEqual(waits,[7]);});\n`);
for(const args of [['init','-q'],['add','.'],['-c','user.name=MVP UI Acceptance','-c','user.email=mvp-ui@example.invalid','commit','-qm','Initial isolated sample']]) { const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error('Isolated git setup failed'); }
const scope={projectId:'mvp-ui-live-project',workspaceId:'mvp-ui-live-workspace'},actor={kind:'human',id:'mvp-ui-operator'};
const role={kind:'legacy_template',templateId:'builder',templateRevision:'1'};
const roleBinding={schemaVersion:1,bindingId:'mvp-ui-builder',templateId:'builder',templateRevision:'1',bindingVersion:1,policyRevision:'legacy-template'};
const budget={contextWindowTokens:200000,inputTokens:null,outputTokens:null,maxRequests:20,maxToolCalls:40,timeoutMs:180000,perResponseTokens:4096};
const instruction='Use the actual project sources and user request. Read-only Query must not mutate files. For initial planning, produce the supported formal plan result and cite concrete sources. After explicit adoption, execute the assigned Work with existing tools, preserve tests, and do not claim checks passed without actual evidence. Consult tools schemas; use the revision from read for replacements. Do not invent project or Session identities.';
const sandboxNode=spawnSync('/usr/bin/node',['--version'],{encoding:'utf8'});
if(sandboxNode.status!==0)throw Error('Configured ProcessSandbox Node binary is unavailable');
const config={sqliteDirectory:database,actor,review:{notes:'Trusted completion-policy candidate only; adoption must occur through the normal UI.',policies:[{policyId:'mvp-ui-completion',contentRevision:1,content:{schemaVersion:1,requirementKinds:['static'],minimumRequiredRequirementsPerObligation:1}}]},workspaces:[{scope,name:'MVP UI isolated retry project',root,workspaceRevision:1,readPrefixes:['.'],writePrefixes:['.'],allowCommands:true}],architectureSource:{provider:'typescript',configPath:'tsconfig.json'},kernelStores:{entries:[{adapterId:'mvp-ui-kernel',storeKey:'mvp-ui-kernel-store',workspace:scope,databasePath:join(database,'kernel.sqlite')}]},runtime:{schemaVersion:1,bindings:[{id:'mvp-ui-runtime',label:'MVP UI builder',scope,role,configurationRevision:'mvp-ui-runtime@1',model:{revision:'mvp-ui-model@1',provider:'deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com',options:{thinking:'disabled'},secretEnvironmentVariable:'MVP_UI_PRIVATE_KEY'},grant:{budget,hostTemplate:{templateId:'builder',revision:'1',digest:sha(instruction)},tools:['read','write','find_related_sessions','read_session_card','send_session_message','query_task_graph'],writeScope:['.'],skills:{resourceRoot:join(repo,'resources/skills'),enabledIds:['platform-work']},systemInstruction:instruction,deniedPrefixes:['.git'],processSandboxOptions:{},materialBasis:null}}],queryProfiles:[{id:'mvp-ui-query',label:'Project conversation',scope,runtimeBindingId:'mvp-ui-runtime',sessionRole:role,roleBinding,runtimeBudget:budget,budget:{maxTokens:200000,deadline:null},consumerId:'mvp-ui-consumer'}]},workflow:{consumerId:'mvp-ui-consumer',bindings:[{workspace:scope,sessionRole:role,roleBinding,budget:{tokenBudget:200000,deadline:null}}]},checks:{configurationRevision:'mvp-ui-checks@1',workspace:{aggregateType:'Workspace',...scope},executor:actor,permissionRevision:`host-permission-v1:${sha(JSON.stringify({subject:actor,scope,readPrefixes:['.']}))}`,sourceAccess:'verification_workspace',processAccess:'all_except_denied',deniedPrefixes:['.git'],checks:[{checkId:'retry-check',kind:'static',command:'/usr/bin/node --test checks/retry.test.mjs',cwd:'.',timeoutMs:30000,taskIds:'all'}]}};
const configPath=join(runDir,'workbench.json'); await writeFile(configPath,JSON.stringify(config,null,2));
const evidence={startedAt:new Date().toISOString(),runDir,root,database,scope,sandboxNodeVersion:sandboxNode.stdout.trim(),providerCalls:0,toolNames:[],providerErrors:[],httpErrors:[],transportErrors:[],toolErrors:[],requests:[]}; const seen=new Set();
let writing=Promise.resolve();
const persist=()=>{const json=JSON.stringify(evidence,null,2).replaceAll(key,'[redacted]');writing=writing.then(()=>writeFile(join(runDir,'evidence.json'),json));return writing;};
// Diagnostic only: preserve request and response, never record headers or bodies.
const safeError = value => {
  if (value === null || typeof value !== 'object') return {};
  const result = {};
  for (const field of ['type','code','message']) {
    if (typeof value[field] === 'string' || typeof value[field] === 'number') {
      result[field] = String(value[field]).replaceAll(key,'[redacted]').replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,2000);
    }
  }
  return result;
};
const originalFetch=globalThis.fetch;
globalThis.fetch=async function(input,init){
  const response=await originalFetch.call(this,input,init);
  try {
    const url=new URL(typeof input==='string' ? input : input instanceof URL ? input.href : input.url);
    if(url.origin==='https://api.deepseek.com' && !response.ok){
      let fields={};
      try { const body=await response.clone().json(); fields=safeError(body.error ?? body); } catch { /* no raw body logging */ }
      evidence.httpErrors.push({status:response.status,...fields});
      await persist();
    }
  } catch { /* diagnostics cannot change provider behavior */ }
  return response;
};
const original=createBuiltinProviderRegistry();
const registry={get:original.get.bind(original),create(...args){const client=original.create(...args);return {async *stream(request,options){if(++evidence.providerCalls>40)throw Error('Acceptance provider-call ceiling reached');evidence.requests.push({requestId:request.requestId,messages:request.messages,tools:request.tools.map(t=>t.name)});for(const m of request.messages)if(m.role==='tool'&&m.result.status!=='success'&&!seen.has(m.callId)){seen.add(m.callId);evidence.toolErrors.push({callId:m.callId,result:m.result});}await persist();try{for await(const event of client.stream(request,options)){if(event.type==='tool_call_started')evidence.toolNames.push(event.name);if(['failed','error','cancelled','truncated'].includes(event.type))evidence.providerErrors.push({requestId:request.requestId,type:event.type,error:safeError(event.error ?? event.failure ?? event)});yield event;}}catch(error){evidence.transportErrors.push({name:error?.name,code:error?.cause?.code??null});throw error;}finally{await persist();}}};}};
const loaded=await loadWorkbenchCliConfig(configPath);
const host=await createLocalWorkbenchHost({...loaded,publicDir:join(repo,'dist/app/public/workbench'),runtimeProvider:{registry,secretSource:{get:name=>name==='MVP_UI_PRIVATE_KEY'?key:undefined}}});
const address=await host.listen();evidence.url=address.url;await persist();
await writeFile(join(base,'latest.json'),JSON.stringify({pid:process.pid,url:address.url,runDir,root,database},null,2));
console.log(JSON.stringify({pid:process.pid,url:address.url,runDir,root}));
let closing=false;async function close(){if(closing)return;closing=true;await host.close();evidence.closedAt=new Date().toISOString();await persist();process.exit(0);}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
// Intentionally no HTTP POST, no database seeding, and no automatic model call.
