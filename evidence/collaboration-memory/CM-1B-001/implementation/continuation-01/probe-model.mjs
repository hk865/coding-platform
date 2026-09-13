import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createModelSettings,defaultSettingsDirectory} from '../../../../../dist/app/model-settings.js';
const data=resolve('.local/gui'),directory=defaultSettingsDirectory(data);
if(!existsSync(join(directory,'settings.json'))){console.log(JSON.stringify({status:'not_configured',directory,data}));process.exit(0);}
const settings=await createModelSettings(data);
try{const publicView=await settings.read();console.log(JSON.stringify({data,directory,configuration:publicView.configuration,keyConfigured:publicView.keyConfigured}));}
finally{settings.close();}