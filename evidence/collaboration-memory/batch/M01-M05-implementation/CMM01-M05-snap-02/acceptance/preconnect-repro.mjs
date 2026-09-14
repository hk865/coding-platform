import {createGuiServer} from '/mnt/d/1.project/Software/agent_platform/dist/app/server.js';
import {connect} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'host-preconnect-'));const app=await createGuiServer(dir);let socket;
try {
 await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
 socket=connect(app.server.address().port,'127.0.0.1');await new Promise(done=>socket.once('connect',done));
 const closing=app.close();
 const closed=await Promise.race([closing.then(()=>true),new Promise(done=>setTimeout(()=>done(false),1000))]);
 console.log(JSON.stringify({closedWithinOneSecond:closed}));
 const releasedAt=Date.now();socket.destroy();await closing;console.log(JSON.stringify({closeAfterSocketReleasedMs:Date.now()-releasedAt}));
 if(!closed)process.exitCode=1;
} finally {socket?.destroy();await app.close().catch(()=>{});await rm(dir,{recursive:true,force:true});}
