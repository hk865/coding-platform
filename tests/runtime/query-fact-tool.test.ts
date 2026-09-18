import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';
import { ReadOnlyQueryRuntime } from '../../src/execution/worker-runtime/read-only-query-runtime.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { COORDINATION_TOOL_NAMES } from '../../src/execution/worker-runtime/coordination-tools.js';

const forbiddenQueryTools = new Set<string>([...COORDINATION_TOOL_NAMES, 'edit', 'write', 'shell', 'bash']);

describe.each([1, 2] as const)('fact protocol %i', factReadVersion => {
it.each(['ready', 'stale', 'revoked-final', 'revoked-uncited', 'malformed-marker', 'cancelled-final', 'unknown-marker'] as const)('Query fact tool uses bound input and persists only authorized citations: %s', async status => {
  const dir=await mkdtemp(join(tmpdir(),'query-facts-')), root=join(dir,'source');await mkdir(root);
  const input=JSON.stringify({material:{architectureReviews:{status:'unavailable',reason:'Reader unavailable'}}});
  const digest=createHash('sha256').update(input).digest('hex');
  let calls=0, reads=0;
  let releaseFinal!:()=>void, reachedFinal!:()=>void;
  const finalGate=new Promise<void>(resolve=>{releaseFinal=resolve;}), finalEntered=new Promise<void>(resolve=>{reachedFinal=resolve;});
  const client:ModelClientPort={async *stream(request){
    calls++;expect(request.tools.some(t=>t.name==='read_query_fact')).toBe(true);
    expect(request.tools.filter(t=>forbiddenQueryTools.has(t.name))).toEqual([]);
    const common={schemaVersion:1 as const,requestId:request.requestId};
    if(calls===1){
      yield {...common,sequence:1,type:'tool_call_started',callId:'fact',name:'read_query_fact',ordinal:0};
      yield {...common,sequence:2,type:'tool_arguments_delta',callId:'fact',delta:JSON.stringify({pointer:'/material/architectureReviews',...(factReadVersion === 2 ? {assertion:{kind:'observation_status',expected:'unavailable'}} : {})})};
      yield {...common,sequence:3,type:'completed',reason:'tool_calls'};
    }else{
      expect(JSON.stringify(request.messages)).toContain(status==='stale'?'Changed input':'Reader unavailable');
      yield {...common,sequence:1,type:'text_delta',delta:status==='unknown-marker'?'目前无法读取架构决定。[F99]':status==='revoked-uncited'?'目前无法读取架构决定。':status==='malformed-marker'?'目前无法读取架构决定。[F1, F2]':'目前无法读取架构决定。[F1]'};
      yield {...common,sequence:2,type:'completed',reason:'final_answer'};
    }
  }};
  const runtime=new ReadOnlyQueryRuntime(join(dir,'runtime'),{
    rootFor:()=>root,bind:async()=>({configuration:{revision:'fixture',provider:'deepseek',model:'labelled-fact-tool',baseUrl:'http://127.0.0.1'},client}),
    materials:{assemble:async()=>({status:'ready',input,kind:'semantic_query',goalId:'g',roleBinding:{},budget:DEFAULT_RUNTIME_BUDGET,deadline:null,factReadVersion}),
      readFact:async(_request,location)=>{reads++;if(status==='cancelled-final' && reads>1){reachedFinal();await finalGate;}expect(location).toEqual({inputDigest:digest,pointer:'/material/architectureReviews'});return status!=='stale' && !((status==='revoked-final' || status==='revoked-uncited') && reads>1)?{status:'ready',inputDigest:digest,pointer:location.pointer,observation:'captured_query_input',sourceBundle:{digest:'bundle'},value:{status:'unavailable',reason:'Reader unavailable'}}:{status:'stale',message:'Changed input'};}}
  });
  const request={runRef:{aggregateType:'QueryRun' as const,projectId:'p',workspaceId:'w',queryJobId:'q',runId:'r'},bundleRef:{digest:'a'.repeat(64)} as never,question:'有哪些决定？',budget:{maxTokens:128000}};
  try{
    await runtime.init();const running=runtime.startQuery(request);
    if(status==='cancelled-final'){await finalEntered;const cancelled=runtime.cancelQuery(request.runRef);releaseFinal();await cancelled;}
    const result=await running;
    expect(reads).toBeGreaterThan(0);
    if(status==='ready'){
      expect(result.outcome).toBe('answered');
      const cited=result.sources.find(s=>s.kind==='query_fact');expect(cited?.version).toBe(digest);
      expect(JSON.parse(cited!.refKey)).toMatchObject({marker:'F1',pointer:'/material/architectureReviews',inputDigest:digest});
      await runtime.close();const reopened=new ReadOnlyQueryRuntime(join(dir,'runtime'),{rootFor:()=>root,materials:{assemble:async()=>{throw Error('no replay');}},bind:async()=>{throw Error('no model replay');}});
      await reopened.init();expect(await reopened.startQuery(request)).toEqual(result);await reopened.close();
    }else{
      expect(result.outcome).toBe(status==='cancelled-final'?'failed':'gap');expect(result.answer).toBeNull();
      const reason = status === 'stale' ? 'facts_stale' : status === 'revoked-final' || status === 'revoked-uncited' ? 'read_unavailable'
        : status === 'malformed-marker' ? 'malformed_marker' : status === 'unknown-marker' ? 'unknown_marker' : null;
      if (reason) expect(result.message).toContain('Query fact publication rejected (' + reason);
    }
  }finally{releaseFinal();await runtime.close();await rm(dir,{recursive:true,force:true});}
},60000);
});

it.each(['missing', 'mismatched'] as const)('delivers assertion guidance to the real kernel consumer and accepts an explicit corrected declaration: %s', async mode => {
  const dir = await mkdtemp(join(tmpdir(), 'query-assertion-guidance-')), root = join(dir, 'source'); await mkdir(root);
  const pointer = '/material/collaborationWork/0/latestRun';
  const value = { ref: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'producer' }, revision: 2,
    status: 'running', outcome: null, startedAt: '2026-09-16T00:00:00Z', endedAt: null,
    planRef: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan' }, matchesCurrentPlan: true };
  const input = JSON.stringify({ material: { collaborationWork: [{ latestRun: value }] } });
  const digest = createHash('sha256').update(input).digest('hex');
  let calls = 0, reads = 0;
  const client: ModelClientPort = { async *stream(request) {
    calls++; const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (calls <= 2) {
      if (calls === 2) {
        const supplied = JSON.stringify(request.messages);
        expect(supplied).toContain('supportedAssertions'); expect(supplied).toContain('run_status'); expect(supplied).toContain('running');
      }
      const assertion = calls === 2 ? { kind: 'run_status', expected: 'running' } : mode === 'mismatched' ? { kind: 'run_status', expected: 'ended' } : undefined;
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'fact-' + calls, name: 'read_query_fact', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'fact-' + calls, delta: JSON.stringify({ pointer, ...(assertion ? { assertion } : {}) }) };
      yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
    } else {
      expect(JSON.stringify(request.messages)).toContain('F1');
      yield { ...common, sequence: 1, type: 'text_delta', delta: '该 Run 的记录状态为 running；不代表 Task 已验收。[F1]' };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
    }
  } };
  const runtime = new ReadOnlyQueryRuntime(join(dir, 'runtime'), {
    rootFor: () => root, bind: async () => ({ configuration: { revision: 'fixture', provider: 'deepseek', model: 'labelled-assertion-guidance', baseUrl: 'http://127.0.0.1' }, client }),
    materials: { assemble: async () => ({ status: 'ready', input, kind: 'semantic_query', goalId: 'g', roleBinding: {}, budget: DEFAULT_RUNTIME_BUDGET, deadline: null, factReadVersion: 2 }),
      readFact: async (_request, location) => { reads++; expect(location).toEqual({ pointer, inputDigest: digest }); return { status: 'ready', inputDigest: digest, pointer, observation: 'captured_query_input', sourceBundle: { digest: 'bundle' }, value }; } },
  });
  try {
    await runtime.init();
    const result = await runtime.startQuery({ runRef: { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'q', runId: 'r' }, bundleRef: { digest: 'a'.repeat(64) } as never, question: 'What is the recorded Run status?', budget: { maxTokens: 128000 } });
    expect(result.outcome).toBe('answered'); expect(calls).toBe(3); expect(reads).toBe(3);
    expect(JSON.parse(result.sources.find(source => source.kind === 'query_fact')!.refKey)).toMatchObject({ marker: 'F1', assertion: { kind: 'run_status', expected: 'running' }, check: 'structured-state-only' });
  } finally { await runtime.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);

it.each(['old-material', 'missing-reader', 'required-reader-missing'] as const)('Query never acquires fact or coordination tools without the required capability: %s', async mode => {
  const dir=await mkdtemp(join(tmpdir(),'query-no-fact-capability-')),root=join(dir,'source');await mkdir(root);
  let calls=0,reads=0;
  const client:ModelClientPort={async *stream(request){
    calls++;
    expect(request.tools.some(tool=>tool.name==='read_query_fact')).toBe(false);
    expect(request.tools.filter(tool=>forbiddenQueryTools.has(tool.name))).toEqual([]);
    const common={schemaVersion:1 as const,requestId:request.requestId};
    yield {...common,sequence:1,type:'text_delta',delta:'Deterministic compatibility answer; no architecture absence claim.'};
    yield {...common,sequence:2,type:'completed',reason:'final_answer'};
  }};
  const runtime=new ReadOnlyQueryRuntime(join(dir,'runtime'),{
    rootFor:()=>root,bind:async()=>({configuration:{revision:'fixture',provider:'deepseek',model:'labelled-no-fact-tool',baseUrl:'http://127.0.0.1'},client}),
    materials:{assemble:async()=>({status:'ready',input:'{"material":{}}',kind:'semantic_query',goalId:'g',roleBinding:{},budget:DEFAULT_RUNTIME_BUDGET,deadline:null,...(mode==='missing-reader'?{factReadVersion:1 as const}:mode==='required-reader-missing'?{factReadVersion:2 as const}:{})}),
      ...(mode==='old-material'?{readFact:async()=>{reads++;return {status:'unavailable' as const,message:'Not exposed to this material version'};}}:{})}
  });
  try{
    await runtime.init();
    const result=await runtime.startQuery({runRef:{aggregateType:'QueryRun',projectId:'p',workspaceId:'w',queryJobId:'q',runId:'r'},bundleRef:{digest:'a'.repeat(64)} as never,question:'Read current context',budget:{maxTokens:128000}});
    // A missing required runtime dependency is an execution failure; a revoked
    // fact discovered during citation validation is the separate material gap.
    expect(result.outcome).toBe(mode==='required-reader-missing'?'failed':'answered');expect(calls).toBe(mode==='required-reader-missing'?0:1);expect(reads).toBe(0);
    if(mode==='required-reader-missing') expect(result.answer).toBeNull();
  }finally{await runtime.close();await rm(dir,{recursive:true,force:true});}
},60000);

it.each(['fact', 'explanation'] as const)('v3 delivers basis-only guidance and persists the %s publication outcome', async kind => {
  const dir = await mkdtemp(join(tmpdir(), 'query-basis-publication-')), root = join(dir, 'source'); await mkdir(root);
  const pointer = '/material/goalContext/objective', value = 'Repair isolated todo grouping';
  const input = JSON.stringify({ material: { goalContext: { objective: value } } });
  const inputDigest = createHash('sha256').update(input).digest('hex');
  let calls = 0;
  const client: ModelClientPort = { async *stream(request) {
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (++calls === 1) {
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'objective', name: 'read_query_fact', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'objective', delta: JSON.stringify({ pointer }) };
      yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
    } else {
      expect(JSON.stringify(request.messages)).toContain('Basis citation only.');
      const block = kind === 'fact' ? { kind, citation: 'F1' } : { kind, text: 'The objective concerns todo grouping.', basis: ['F1'] };
      yield { ...common, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [block] }) };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
    }
  } };
  const runtime = new ReadOnlyQueryRuntime(join(dir, 'runtime'), { rootFor: () => root,
    bind: async () => ({ configuration: { revision: 'fixture', provider: 'deepseek', model: 'deterministic-test', baseUrl: 'http://127.0.0.1' }, client }),
    materials: { assemble: async () => ({ status: 'ready', input, kind: 'semantic_query', goalId: 'g', roleBinding: {}, budget: DEFAULT_RUNTIME_BUDGET, deadline: null, factReadVersion: 3 }),
      readFact: async () => ({ status: 'ready', pointer, inputDigest, observation: 'captured_query_input', sourceBundle: { digest: 'bundle' }, value }) } });
  const request = { runRef: { aggregateType: 'QueryRun' as const, projectId: 'p', workspaceId: 'w', queryJobId: 'q', runId: 'r' }, bundleRef: { digest: 'a'.repeat(64) } as never, question: 'What is the objective?', budget: { maxTokens: 128000 } };
  try {
    await runtime.init(); const result = await runtime.startQuery(request);
    expect(result.outcome).toBe(kind === 'fact' ? 'gap' : 'answered');
    if (kind === 'fact') { expect(result.answer).toBeNull(); expect(result.message).toBe('Query fact publication rejected (assertion_required; F1).'); }
    else expect(result.answer).toContain('The objective concerns todo grouping. [F1]');
    await runtime.close();
    const reopened = new ReadOnlyQueryRuntime(join(dir, 'runtime'), { rootFor: () => root, materials: { assemble: async () => { throw Error('must not reassemble'); } }, bind: async () => { throw Error('must not resample'); } });
    await reopened.init(); try { expect(await reopened.startQuery(request)).toEqual(result); } finally { await reopened.close(); }
  } finally { await runtime.close(); await rm(dir, { recursive: true, force: true }); }
}, 60000);
