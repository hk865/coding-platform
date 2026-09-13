import {Button,Group,Paper,Stack,Text} from '@mantine/core';
import {useState} from 'react';
import type {ViewProps} from '../workbench/view-props';
import type {QueryJobAnswerV1} from '../../../contracts/query-job.js';
import {mutationError} from '../api/hooks';

/** Display published options and submit the selected identity. The server
 * rechecks the source and constructs the formal proposal and decision. */
export function FeedbackChoice({answer,api,goalScope,refresh}:Pick<ViewProps,'api'|'goalScope'|'refresh'> & {answer:QueryJobAnswerV1}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  let value:{action?:string;decision?:{options:{id:string;label:string;objective:string;impact:string}[];recommended:string;reason:string;independentWork:string}};
  try {value=JSON.parse(answer.answer);} catch {return null;}
  const decision=value?.action==='needs_decision'?value.decision:undefined;
  if(!goalScope || !decision || !Array.isArray(decision.options) || decision.options.length<2 || decision.options.length>4 ||
    decision.options.some(option=>!option || ['id','label','objective','impact'].some(key=>typeof option[key as keyof typeof option]!=='string')) ||
    typeof decision.reason!=='string' || typeof decision.independentWork!=='string' || typeof decision.recommended!=='string') return null;
  const choose=async(optionId:string)=>{
    setBusy(true);setMessage('');
    try {
      const result=await api.chooseFeedback(goalScope,{...answer.queryJobRef,aggregateType:'QueryJobAnswer',answerId:answer.answerId},optionId);
      setMessage('决定已记录：'+result.decisionRef.decisionId);refresh();
    } catch(error) {setMessage(mutationError(error).message);} finally {setBusy(false);}
  };
  return <Paper withBorder p="sm" mt="sm" data-testid="feedback-choice"><Stack gap="xs">
    <Text fw={600}>需要你的目标澄清</Text><Text size="sm">推荐理由：{decision.reason}</Text>
    <Text size="sm">等待期间可继续：{decision.independentWork}</Text>
    {decision.options.map(option=><Paper key={option.id} withBorder p="xs"><Stack gap={4}>
      <Group justify="space-between"><Text fw={500}>{option.label}{option.id===decision.recommended?'（推荐）':''}</Text>
        <Button size="xs" loading={busy} disabled={answer.stale} onClick={()=>void choose(option.id)}>选择此项</Button></Group>
      <Text size="sm">目标：{option.objective}</Text><Text size="xs">影响：{option.impact}</Text>
    </Stack></Paper>)}
    {message?<Text size="sm">{message}</Text>:null}
  </Stack></Paper>;
}
