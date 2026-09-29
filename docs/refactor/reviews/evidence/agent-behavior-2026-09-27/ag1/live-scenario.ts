// To rerun, copy to .toolchain/ag1-live.test.ts as documented in README.md.
import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {createBuiltinProviderRegistry,type ModelClientPort} from '../vendor/coding-agent/dist/public-api.js';
import {createC2RuntimePlatform} from '../tests/helpers/C2-runtime-platform-fixture.js';

it('live Agent discovers a related idle peer and sends a consultation',async()=>{
  const keyText=await readFile(process.env.DEEPSEEK_API_KEY_FILE ?? (()=>{throw Error('Set DEEPSEEK_API_KEY_FILE to the authorized local credential file')})(),'utf8');
  const apiKey=keyText.match(/\bsk-[A-Za-z0-9_-]+\b/)?.[0];
  if(!apiKey)throw Error('The authorized credential file has no recognized DeepSeek key');
  const client=createBuiltinProviderRegistry().create('deepseek',{apiKey,model:'deepseek-flash',options:{thinking:'disabled'}});
  let requests=0;
  const names:string[]=[];
  const toolResults=new Map<string,{callId:string,status:string}>();
  const providerErrors:string[]=[];
  const tracked:ModelClientPort={async *stream(request,options){
    requests++;
    for(const m of request.messages)if(m.role==='tool')toolResults.set(m.callId,{callId:m.callId,status:m.result.status});
    for await(const e of client.stream(request,options)){
      if(e.type==='tool_call_started')names.push(e.name);
      if(e.type==='failed')providerErrors.push('provider_failed');
      yield e;
    }
  }};
  const fx=await createC2RuntimePlatform({toolNames:['find_related_sessions','read_session_card','send_session_message'],skillIds:['platform-secretary']});
  const output={schemaVersion:1,recordedAt:new Date().toISOString(),model:'deepseek-flash',thinking:'disabled',requests:0,toolCalls:names,toolResults:[] as unknown[],providerErrors,runRef:fx.runRef,sender:fx.firstSession,recipient:fx.secondSession,messageRef:null as unknown,recipientAvailability:null as unknown,readOnlyProviderDelta:null as number|null,status:'running',notCovered:['receiving Agent reply','automatic wakeup','delegation','general model selection quality'],fixture:'Existing C2 real SQLite/Kernel, formal Role/Session/Plan/claim writers; coordination policy is a declared fixture seed'};
  try{
    const target={kind:'task' as const,ref:fx.fixture.tasks.first};
    for(const [ref,relation,id] of [[fx.firstSession,'investigated','live-first'],[fx.secondSession,'participates','live-second']] as const){
      const card=await fx.platform.sessions.readSession(fx.ctx,ref);
      if(card.status!=='ready')throw Error('Live setup Session missing');
      const linked=await fx.platform.sessions.linkSessionWork(fx.ctx,{meta:{requestId:id,expected:[{ref:card.value.record.ref,revision:card.value.record.revision},{ref:{...ref,aggregateType:'SessionWorkLink',target,relation},revision:0}]},input:{sessionRef:ref,target,relation,active:true}});
      expect(linked.status).toBe('committed');
    }
    const original=fx.host.resolveConfiguration.bind(fx.host);
    fx.host.resolveConfiguration=async(ctx,request)=>{
      const value=await original(ctx,request);
      if(value.status!=='ready')return value;
      return {status:'ready',value:{...value.value,
        configurationRevision:'ag1-live@1',
        model:{...value.value.model,configuration:{...value.value.model.configuration,revision:'ag1-live@1',provider:'deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com'},client:tracked},
        budget:{...value.value.budget,maxRequests:6,maxToolCalls:6,timeoutMs:120000,perResponseTokens:2048},
        systemInstruction:'本轮工作仅验证一次实际协作咨询。你是平台秘书。请先通过关联发现工具查询 '+JSON.stringify(target)+' 的相关Session，从真实候选中选一个idle、适合咨询的同伴（不要向忙碌的自己发信），再读取其卡片确认，向其发送一个中文问题：请说明implement-a文件读取边界及需要保留的来源引用。消息里带上上述task目标定位。不要猜Session ID。发现、查看、发送都必须实际调用工具。发送成功后简短说明已发送、尚未答复，不声称对方已执行。不需要编辑文件或另外建任务。'
      }};
    };
    const prepared=await fx.platform.runtime.prepareExecution(fx.ctx,{runRef:fx.runRef,requestId:'ag1-live-prepare'});
    if(prepared.status!=='ready')throw Error('Live prepare failed: '+JSON.stringify(prepared));
    const started=await fx.platform.runtime.startRun(fx.ctx,{prepared:prepared.value,consumerId:'ag1-live',requestId:'ag1-live-start'});
    expect(started).toMatchObject({status:'ready',value:{run:{status:'ended'},session:{occupancy:null}}});
    const beforeReads=requests;
    const inbox=await fx.platform.messages.readInbox(fx.ctx,{recipient:fx.secondSession,page:{limit:10}});
    expect(inbox).toMatchObject({status:'ready',value:{items:[{recipient:fx.secondSession,status:'pending'}]}});
    if(inbox.status!=='ready'||inbox.value.items.length!==1)throw Error('Expected one actual consultation');
    output.messageRef=inbox.value.items[0]!.ref;
    const body=await fx.platform.messages.readMessageBody(fx.ctx,{messageRef:inbox.value.items[0]!.ref,part:'message'});
    expect(body).toMatchObject({status:'ready'});
    if(body.status==='ready')expect(body.value.text).toContain('implement-a');
    const peer=await fx.platform.sessions.readSession(fx.ctx,fx.secondSession);
    expect(peer).toMatchObject({status:'ready',value:{availability:'idle',record:{occupancy:null}}});
    if(peer.status==='ready')output.recipientAvailability=peer.value.availability;
    output.readOnlyProviderDelta=requests-beforeReads;
    expect(names).toEqual(['find_related_sessions','read_session_card','send_session_message']);
    expect([...toolResults.values()].every(r=>r.status==='success')).toBe(true);
    expect(fx.authorizeCalls()).toBe(0);
    expect(providerErrors).toEqual([]);
    output.status='passed';
  }finally{
    output.requests=requests;output.toolResults=[...toolResults.values()];
    if(output.status==='running')output.status='failed';
    await writeFile('docs/refactor/reviews/evidence/agent-behavior-2026-09-27/ag1/live-result.json',JSON.stringify(output,null,2)+'\n');
    await fx.close();
  }
});
