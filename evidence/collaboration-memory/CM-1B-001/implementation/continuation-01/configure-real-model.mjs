import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createModelSettings} from '../../../../../dist/app/model-settings.js';
const output=resolve('evidence/collaboration-memory/CM-1B-001/implementation/continuation-01/model-connection-01.json');
let settings;
try{
  const raw=await readFile('/mnt/d/1.project/Software/agent_learn/agent_api.txt','utf8');
  const keys=[...new Set(raw.match(/\bsk-[A-Za-z0-9_-]+\b/g)??[])];
  if(keys.length!==1)throw Error('Cannot select exactly one local key');
  settings=await createModelSettings(resolve('.local/gui'),{timeoutMs:60000});
  await settings.save({provider:'deepseek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com',apiKey:keys[0]});
  const result=await settings.testConnection();
  await writeFile(output,JSON.stringify({dataDirectory:resolve('.local/gui'),settingsDirectory:settings.directory,result},null,2)+'\n');
  console.log(JSON.stringify({configured:true,model:'deepseek-flash',baseUrl:'https://api.deepseek.com',ok:result.ok,code:result.code,evidence:output}));
}catch{
  console.log(JSON.stringify({ok:false,code:'local_configuration_or_connection_failed',credentialsDisplayed:false}));process.exitCode=1;
}finally{settings?.close();}
