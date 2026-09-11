import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export function selectNext(plan, observed, alreadyIssued=[]) {
 const step=plan.steps.find(x=>!alreadyIssued.includes(x.id));
 if(!step)return null;
 const matching=observed.filter(event=>Object.entries(step.after).every(([key,value])=>event[key]===value));
 if(matching.length<step.occurrence)return null;
 return {testInput:true,injectionId:step.id,action:step.action,args:step.args,anchorEventId:matching[step.occurrence-1].id};
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){const plan=JSON.parse(await readFile(process.argv[2],'utf8'));const state=JSON.parse(await readFile(process.argv[3],'utf8'));console.log(JSON.stringify(selectNext(plan,state.observed,state.alreadyIssued),null,2));}
