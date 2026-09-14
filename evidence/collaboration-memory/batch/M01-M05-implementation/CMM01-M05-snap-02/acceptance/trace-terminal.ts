import {TerminalContinuation} from '/mnt/d/1.project/Software/agent_platform/src/app/scheduling/terminal-continuation.js';
const scan=TerminalContinuation.prototype.scan;
TerminalContinuation.prototype.scan=function(){return scan.call(this).catch(error=>{console.error('INDEPENDENT_TERMINAL_CAUSES',error instanceof AggregateError?error.errors.map((e:any)=>String(e)):String(error));throw error;});};
