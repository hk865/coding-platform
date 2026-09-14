import {useEffect,useRef,useState} from 'react';
import {Alert,Box,Button,Group,Select,Stack,Text,Textarea} from '@mantine/core';
import {ApiError,errorMessage} from '../api/client';
import type {ViewProps} from '../workbench/view-props';
import type {MemoryEntry,MemoryReadResult,MemoryPurpose} from '../../../contracts/memory';

const purposes:MemoryPurpose[]=['reply','architecture','progress','planning','handoff','execution'];
type Pending={requestId:string;expectedRevision:number;edits:unknown[]};
export function MaintainedMemory({api,scope,goalScope,data}:ViewProps){
  const [kind,setKind]=useState<'profile'|'project'>('profile');
  const [saved,setSaved]=useState(0);
  // A scope switch unmounts the editor, so late responses cannot replace another scope.
  return <Stack p="sm"><Select label="记忆范围" value={kind} onChange={value=>setKind(value==='project'?'project':'profile')}
    data={[{value:'profile',label:'用户偏好（跨项目）'},{value:'project',label:'当前项目经验'}]}/>
    <MemoryEditor key={JSON.stringify([kind,kind==='project'?scope:null])} api={api} scope={kind==='project'?scope:null} kind={kind} saved={saved}/>
    {kind==='project'&&goalScope?<ExperienceRecorder key={JSON.stringify(goalScope)} api={api} goalScope={goalScope} data={data} onSaved={()=>setSaved(value=>value+1)}/>:null}
    {scope?<MemoryAdoption key={JSON.stringify(scope)} api={api} scope={scope}/>:null}</Stack>;
}
function ExperienceRecorder({api,goalScope,data,onSaved}:Pick<ViewProps,'api'|'data'>&{goalScope:NonNullable<ViewProps['goalScope']>;onSaved:()=>void}){
  const [runId,setRunId]=useState<string|null>(null),[summary,setSummary]=useState(''),[reason,setReason]=useState('');
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [pending,setPending]=useState<Parameters<typeof api.memoryRecordExperience>[1]|null>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const runs=(data?.liveRuns??[]).filter(run=>run.spec.projectId===goalScope.projectId&&run.spec.workspaceId===goalScope.workspaceId&&run.spec.goalId===goalScope.goalId&&['running','completed','failed','cancelled'].includes(run.status));
  const save=async()=>{
    if(busy||!runId)return;setBusy(true);setMessage('');
    try{
      let command=pending;
      if(!command){const view=await api.memoryView('project',goalScope);if(!alive.current)return;
        if(view.status!=='ready'){setMessage(view.reason);return;}
        command={requestId:crypto.randomUUID(),expectedRevision:view.snapshot.revision,runId,summary,reason};setPending(command);
      }
      const receipt=await api.memoryRecordExperience(goalScope,command);if(!alive.current)return;
      if(receipt.status==='committed'){setPending(null);setSummary('');setReason('');setMessage(`经验已保存，项目版本 ${receipt.revision}。后续输入会核对来源和适用条件。`);onSaved();}
      else{if(receipt.code!=='unavailable')setPending(null);setMessage('经验未确认保存：'+receipt.reason);}
    }catch(error){if(alive.current){if(!(error instanceof ApiError)||!error.outcomeUnknown)setPending(null);setMessage(errorMessage(error)+'；未收到保存回执。');}}
    finally{if(alive.current)setBusy(false);}
  };
  return <Stack gap="xs"><Text fw={600} size="sm">记录本次工作的公开经验</Text>
    <Text size="xs" c="dimmed">填写可公开复用的结论和依据。经验会关联所选运行及记录时的规范；来源失效后停止采用。</Text>
    <Select label="经验来源运行" value={runId} onChange={setRunId} disabled={busy||!!pending} data={runs.map(run=>({value:run.spec.runId,label:`${run.taskTitle??run.spec.taskId} · ${run.spec.runId}`}))}/>
    <Textarea label="经验结论" value={summary} onChange={event=>setSummary(event.currentTarget.value)} disabled={busy||!!pending}/>
    <Textarea label="经验依据" value={reason} onChange={event=>setReason(event.currentTarget.value)} disabled={busy||!!pending}/>
    <Button disabled={!runId||!summary.trim()||!reason.trim()} loading={busy} onClick={()=>void save()}>{pending?'重试经验保存原请求':'保存公开经验'}</Button>
    {message?<Alert>{message}</Alert>:null}</Stack>;
}
function MemoryAdoption({api,scope}:Pick<ViewProps,'api'>&{scope:NonNullable<ViewProps['scope']>}){
  const [result,setResult]=useState<Awaited<ReturnType<typeof api.memoryAdoption>>|null>(null),[error,setError]=useState('');
  const live=useRef(true);
  const refresh=async()=>{try{const read=await api.memoryAdoption(scope);if(live.current){setResult(read);setError('');}}catch(e){if(live.current)setError(errorMessage(e));}};
  useEffect(()=>{live.current=true;void refresh();return()=>{live.current=false;};},[]);
  return <Stack gap="xs"><Group><Text fw={600} size="sm">实际回应的输入版本</Text><Button size="xs" variant="subtle" onClick={()=>void refresh()}>刷新采用记录</Button></Group>
    <Text size="xs" c="dimmed">这里读取每次回应已留存的输入，不会因偏好更新改写旧记录。运行未完成时，仅证明输入已组装。</Text>
    {error?<Alert color="red">{error}</Alert>:null}
    {result?.runs.length===0?<Text size="xs">尚无真实回应输入记录。</Text>:null}
    {result?.runs.map(run=><Box key={run.runId}><Text size="xs">{run.runId} · {run.purpose??'用途未记录'} · {run.status}</Text>
      <Text size="xs">{run.memory?`输入采用：用户 v${run.memory.profileRevision} / 项目 v${run.memory.projectRevision}；${run.memory.entries.map(entry=>entry.entryId+'@'+entry.revision).join('、')||'无适用条目'}`:'该运行没有可核对的记忆版本'}</Text>
      <Text size="xs" c="dimmed">输入摘要 {run.inputDigest}</Text></Box>)}
  </Stack>;
}
function MemoryEditor({api,scope,kind,saved}:Pick<ViewProps,'api'|'scope'>&{kind:'profile'|'project';saved:number}){
  const [read,setRead]=useState<MemoryReadResult|null>(null),[body,setBody]=useState(''),[purpose,setPurpose]=useState('all');
  const [editing,setEditing]=useState<MemoryEntry|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [pending,setPending]=useState<Pending|null>(null),alive=useRef(true);
  const available=kind==='profile'||scope!==null;
  const refresh=async()=>{if(!available)return;try{const result=await api.memoryView(kind,scope);if(alive.current)setRead(result);}
    catch(error){if(alive.current)setRead({status:'unavailable',reason:errorMessage(error)});}};
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(saved)void refresh();},[saved]);
  const submit=async(command:Pending)=>{
    if(busy)return;setBusy(true);setPending(command);setMessage('');
    try{
      const result=await api.memoryMaintain(kind,scope,command);if(!alive.current)return;
      if(result.status==='committed'){
        setPending(null);setBody('');setEditing(null);
        setMessage(`已保存，版本 ${result.revision}${result.replayed?'（原请求回执）':''}。后续响应组装时才会按适用条件选用。`);
      }else{
        if(result.code!=='unavailable')setPending(null);
        setMessage(`未确认保存：${result.reason}${result.code==='revision_conflict'?'。请核对刷新后的内容再修改。':''}`);
      }
      await refresh();
    }catch(error){if(alive.current){if(!(error instanceof ApiError)||!error.outcomeUnknown)setPending(null);setMessage(errorMessage(error)+'；未收到保存回执。');}}
    finally{if(alive.current)setBusy(false);}
  };
  const edit=(entry:MemoryEntry)=>{setEditing(entry);setBody(entry.content??'');setPurpose(entry.conditions.purposes.length===purposes.length?'all':entry.conditions.purposes.join(','));};
  const command=(edits:unknown[]):Pending=>({requestId:crypto.randomUUID(),expectedRevision:read?.status==='ready'?read.snapshot.revision:0,edits});
  if(!available)return <Text>请先选择项目。</Text>;
  return <Stack gap="sm">
    <Text size="xs" c="dimmed">偏好不授予权限，也不替代正式规则或当前明确指示。保存回执与某次运行实际采用的版本分别记录。</Text>
    {read?.status==='unavailable'?<Alert color="red">{read.reason}</Alert>:null}
    {message?<Alert>{message}</Alert>:null}
    {pending?<Button loading={busy} onClick={()=>void submit(pending)}>重试原请求，查询保存回执</Button>:null}
    <Textarea label={editing?'纠正记忆':'记住一条偏好或经验'} value={body} onChange={event=>setBody(event.currentTarget.value)} disabled={busy||!!pending} autosize minRows={2}/>
    <Select label="适用响应" value={purpose} onChange={value=>setPurpose(value??'all')} disabled={busy||!!pending}
      data={[{value:'all',label:'所有响应'},{value:'reply',label:'日常回复'},{value:'architecture',label:'架构解释'},{value:'progress',label:'进度汇报'},{value:'planning',label:'规划'},{value:'handoff',label:'交接'},{value:'execution',label:'执行'},
        ...(purpose.includes(',')?[{value:purpose,label:'保留原适用范围：'+purpose}]:[])]}/>
    <Group><Button disabled={read?.status!=='ready'||!body.trim()||busy||!!pending} onClick={()=>void submit(command([{
      ...(editing?{operation:'correct',entryId:editing.entryId,expectedEntryRevision:editing.revision}:{operation:'remember',entryId:crypto.randomUUID()}),
      content:body,conditions:{purposes:purpose==='all'?purposes:purpose.split(','),expiresAt:editing?.conditions.expiresAt??null}}]))}>{editing?'保存纠正':'记住'}</Button>
      <Button variant="subtle" disabled={busy||!!pending} onClick={()=>void refresh()}>刷新</Button>
      {editing?<Button variant="subtle" disabled={busy||!!pending} onClick={()=>{setEditing(null);setBody('');}}>取消编辑</Button>:null}</Group>
    {read?.status==='ready'?<><Text size="xs">当前保存版本 {read.snapshot.revision}</Text>{read.snapshot.entries.map(entry=><Box key={entry.entryId} p="xs" style={{border:'1px solid var(--mantine-color-default-border)'}}>
      <Text size="sm">{entry.content??'已删除'}</Text><Text size="xs" c="dimmed">{entry.entryId} · v{entry.revision} · {entry.state} · {entry.conditions.purposes.join(', ')} · 来源 {entry.source.kind}</Text>
      {entry.state!=='removed'?<Group mt={4}><Button size="xs" variant="subtle" disabled={busy||!!pending} onClick={()=>edit(entry)}>纠正</Button>
        <Button size="xs" color="red" variant="subtle" disabled={busy||!!pending} onClick={()=>void submit(command([{operation:'remove',entryId:entry.entryId,expectedEntryRevision:entry.revision}]))}>删除</Button></Group>:null}
    </Box>)}</>:null}
  </Stack>;
}
