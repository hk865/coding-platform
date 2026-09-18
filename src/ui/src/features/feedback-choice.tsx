import {Button,Group,Paper,Stack,Text} from '@mantine/core';
import {useEffect,useRef,useState} from 'react';
import type {ViewProps} from '../workbench/view-props';
import type {QueryJobAnswerV1} from '../../../contracts/query-job.js';
import {mutationError} from '../api/hooks';

/** Display published options and submit the selected identity. The server
 * rechecks the source and constructs the formal proposal and decision. */
export function FeedbackChoice({answer,api,goalScope,refresh}:Pick<ViewProps,'api'|'goalScope'|'refresh'> & {answer:QueryJobAnswerV1}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [eligibility,setEligibility]=useState<{identity:string;view:Awaited<ReturnType<typeof api.feedbackOptions>>}|null>(null);
  const identity=JSON.stringify([goalScope,answer.queryJobRef,answer.answerId]);
  const liveIdentity=useRef(identity);liveIdentity.current=identity;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setMessage('');setBusy(false);},[identity]);
  const [check,setCheck]=useState(0);
  const isDecision=answer.answer.includes('needs_decision');
  useEffect(()=>{
    if(!goalScope || !isDecision) return;
    const controller=new AbortController();
    setEligibility(null);
    void api.feedbackOptions(goalScope,{...answer.queryJobRef,aggregateType:'QueryJobAnswer',answerId:answer.answerId},{signal:controller.signal})
      .then(view=>{if(!controller.signal.aborted)setEligibility({identity,view});})
      .catch(error=>{if(!controller.signal.aborted)setMessage(mutationError(error).message);});
    return ()=>controller.abort();
  },[api,identity,answer.stale,isDecision,check]);
  const applicable=eligibility?.identity===identity?eligibility.view:null;
  let value:{action?:string;decision?:{options:{id:string;label:string;objective:string;impact:string}[];recommended:string;reason:string;independentWork:string}};
  try {value=JSON.parse(answer.answer);} catch {return null;}
  const decision=value?.action==='needs_decision'?value.decision:undefined;
  if(!goalScope || !decision || !Array.isArray(decision.options) || decision.options.length<2 || decision.options.length>4 ||
    decision.options.some(option=>!option || ['id','label','objective','impact'].some(key=>typeof option[key as keyof typeof option]!=='string')) ||
    typeof decision.reason!=='string' || typeof decision.independentWork!=='string' || typeof decision.recommended!=='string') return null;
  const choose=async(optionId:string)=>{
    const current=()=>mounted.current && liveIdentity.current===identity;
    setBusy(true);setMessage('');
    try {
      const result=await api.chooseFeedback(goalScope,{...answer.queryJobRef,aggregateType:'QueryJobAnswer',answerId:answer.answerId},optionId);
      if(current()){setMessage('决定已记录：'+result.decisionRef.decisionId);refresh();}
    } catch(error) {if(current())setMessage(mutationError(error).message);} finally {if(current()){setBusy(false);setCheck(value=>value+1);}}
  };
  return <Paper withBorder p="sm" mt="sm" data-testid="feedback-choice"><Stack gap="xs">
    <Text fw={600}>需要你的目标澄清</Text><Text size="sm">推荐理由：{decision.reason}</Text>
    <Text size="sm">等待期间可继续：{decision.independentWork}</Text>
    {decision.options.map(option=><Paper key={option.id} withBorder p="xs"><Stack gap={4}>
      <Group justify="space-between"><Text fw={500}>{option.label}{option.id===decision.recommended?'（推荐）':''}</Text>
        <Button size="xs" loading={busy} disabled={!applicable?.availableOptionIds.includes(option.id)} onClick={()=>void choose(option.id)}>选择此项</Button></Group>
      <Text size="sm">目标：{option.objective}</Text><Text size="xs">影响：{option.impact}</Text>
    </Stack></Paper>)}
    <Text size="xs" c="dimmed">选项按当前来源和计划单独核对；提交时再次检查。</Text>
    {!applicable?<Text size="xs">正在核对选择条件…</Text>:applicable.reason?<Text size="xs">{applicable.reason}</Text>:null}
    <Button size="xs" variant="subtle" onClick={()=>setCheck(value=>value+1)}>重新检查选项</Button>
    {message?<Text size="sm">{message}</Text>:null}
  </Stack></Paper>;
}
