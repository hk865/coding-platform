import fs from 'node:fs';
const file='src/control/baseline-evolution-port.ts';
let text=fs.readFileSync(file,'utf8');
text=text.replace('import type { StateLedger } from "../contracts/ledger.js";', 'import type { BaselineEvolutionContextPort } from "../contracts/architecture-context.js";')
 .replace('  ledger: StateLedger;','  context: BaselineEvolutionContextPort;')
 .replace('import type { AggregateSnapshot } from "../contracts/ledger.js";','')
 .replace('import type { ArchitectureCandidateProposalSnapshot } from "../contracts/architecture-inspection.js";','')
 .replace('import { canonicalJson } from "../contracts/fingerprint.js";','')
 .replace('import { resolveProjectArchitectureBaseline } from "../data/governance-records.js";','');
const helperStart=text.indexOf('function isProposalSnapshot('),helperEnd=text.indexOf('export class BaselineEvolutionPortImpl');
if(helperStart<0||helperEnd<0)throw Error('missing helper');
text=text.slice(0,helperStart)+text.slice(helperEnd);
const start=text.indexOf('    // -- 1.'),end=text.indexOf('    // -- 3.');
if(start<0||end<0)throw Error('missing material selection');
text=text.slice(0,start)+`    const selected = await this.deps.context.assemble(proposalRef);
    if (selected.status !== 'ready') return selected;
    const proposal = selected.proposal;

`+text.slice(end);
fs.writeFileSync(file,text);
