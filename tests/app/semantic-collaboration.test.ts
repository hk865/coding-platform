import {it,vi,expect} from 'vitest';
import {createGuiServer} from '../../src/app/server.js';
import {semanticCollaborationFixture} from './semantic-collaboration-fixture.js';
import {ControlEngineImpl} from '../../src/control/control-engine/control-engine.js';
import {ExecutionFeedbackCompiler} from '../../src/control/plan-compiler/execution-feedback-compiler.js';

it('real HTTP/SQLite/kernel task investigates material and FAIL, repairs from sourced coordination, admits required independent review and replays settled records',()=>semanticCollaborationFixture(createGuiServer),120000);

it('the same repaired task remains unsatisfied when tools pass but its required independent Reviewer returns FAIL',()=>semanticCollaborationFixture(createGuiServer,undefined,{reviewResult:'FAIL'}),120000);

it('a human selects the unresolved catalog-versus-display product scope after FAIL, replays that decision and returns through sourced repair and required independent review',()=>semanticCollaborationFixture(createGuiServer,undefined,{humanChoice:true}),120000);

it.each(['before_apply','before_query'] as const)('real host recovers a saved human choice after one %s fault using the labelled model stub',async stage=>{
  let injected=false;
  await semanticCollaborationFixture(createGuiServer,undefined,{humanChoice:true,humanChoiceInterruption:{stage,install:()=>{
    if(stage==='before_apply'){
      const original=ControlEngineImpl.prototype.applyPlanChange;
      const spy=vi.spyOn(ControlEngineImpl.prototype,'applyPlanChange').mockImplementation(function(this:ControlEngineImpl,command){
        if(!injected && command.payload.changeReason.startsWith('human-feedback-clarification:')){injected=true;throw Error('semantic fixture interruption before_apply');}
        return original.call(this,command);
      });
      return ()=>{spy.mockRestore();expect(injected).toBe(true);};
    }
    const spy=vi.spyOn(ExecutionFeedbackCompiler.prototype,'requestDecision').mockImplementationOnce(async()=>{injected=true;throw Error('semantic fixture interruption before_query');});
    return ()=>{spy.mockRestore();expect(injected).toBe(true);};
  }}});
},120000);
