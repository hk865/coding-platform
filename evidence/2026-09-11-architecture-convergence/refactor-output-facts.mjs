import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const write=(p,s)=>fs.writeFileSync(p,s);
const p='src/control/verification-engine/role-output-completeness.ts';let s=read(p);
const channels=s.slice(s.indexOf('export type RoleOutputWitnessChannelV1 ='),s.indexOf('export type RoleOutputWitnessRuleV1'));
write('src/contracts/run-output-materials.ts',`import type { RunSnapshot } from './dispatch.js';\n${channels}\nexport type RunOutputWitness = { channel: RoleOutputWitnessChannelV1; fact: string } | { channel: RoleOutputWitnessChannelV1; unavailable: string };\nexport interface RunOutputMaterialPort { runOutputWitness(run: RunSnapshot, channel: Exclude<RoleOutputWitnessChannelV1, null>): Promise<RunOutputWitness>; }\n`);
const imports=s.slice(s.indexOf("import type { CommitCursor }"),s.indexOf('/**\n * 见证通道。')).split('\n').filter(l=>!l.includes('RoleOutputKindV1')&&!l.includes('RoleSpecReadPort')&&!l.includes('VerificationRoundRoleOutput')).join('\n');
const scan=s.slice(s.indexOf('export const RUN_OUTPUT_SCAN_PAGE_SIZE'),s.indexOf('/**\n * 核对本 Run'));
const cls=s.slice(s.indexOf('class RunOutputFacts'),s.indexOf('export type { VerificationRoundRoleOutput'));
write('src/data/context-compiler/run-output-materials.ts',`/** Read and attribute persisted output material to its exact producing Run.
 * Verification owns the role expectation table; Context owns storage reads. */
${imports}
import type { RoleOutputWitnessChannelV1, RunOutputWitness as WitnessOutcomeV1 } from '../../contracts/run-output-materials.js';
${scan}
${cls.replace('class RunOutputFacts','export class RunOutputFacts')}`);
const firstImport=s.indexOf('import type { CommitCursor }'), channelEnd=s.indexOf('export type RoleOutputWitnessRuleV1');
s=s.slice(0,firstImport)+`import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { RoleOutputKindV1 } from '../../contracts/role-spec.js';
import type { RoleSpecReadPort } from '../../contracts/role-spec-materials.js';
import type { VerificationRoundRoleOutput, VerificationRoundRoleOutputs } from '../../contracts/verification-round.js';
import type { RoleOutputWitnessChannelV1, RunOutputMaterialPort } from '../../contracts/run-output-materials.js';
export type { RoleOutputWitnessChannelV1 } from '../../contracts/run-output-materials.js';

`+s.slice(channelEnd);
const la=s.indexOf('  /**\n   * 只读账本：'),lb=s.indexOf('/**\n * 核对本 Run',la);
s=s.slice(0,la)+`  materials: RunOutputMaterialPort;
};

`+s.slice(lb);
s=s.replace('  const facts = new RunOutputFacts(input.run, input.ledger);','');
s=s.replace('await facts.witness(rule.channel)','await input.materials.runOutputWitness(input.run, rule.channel)');
const ca=s.indexOf('/** 见证求值的两种结果');s=s.slice(0,ca)+'export type { VerificationRoundRoleOutput, VerificationRoundRoleOutputs };\n';
s=s.replaceAll('一律记为缺项并扣留归约','仅记录未见证的产出期望，不扣留归约').replaceAll('轮次扣留归约','仅记录未见证的产出期望').replace('其轮次仍会\n *     扣留归约，直到有一条把答案绑到 Run 的通道。','其轮次仍会记录未见证的产出期望；不扣留归约。');
write(p,s);
const cp='src/contracts/verification-context.ts';s=read(cp).replace('export interface VerificationContextPort {',"export interface VerificationContextPort extends importRunOutputMaterialPort {");s="import type { RunOutputMaterialPort as importRunOutputMaterialPort } from './run-output-materials.js';\n"+s;write(cp,s);
const cc='src/data/context-compiler/verification-context.ts';s=read(cc);s="import { RunOutputFacts } from './run-output-materials.js';\nimport type { RoleOutputWitnessChannelV1 } from '../../contracts/run-output-materials.js';\n"+s;
const idx=s.indexOf('\n',s.indexOf('export class VerificationContextCompiler'));
s=s.slice(0,idx)+`\n  async runOutputWitness(run: RunSnapshot, channel: Exclude<RoleOutputWitnessChannelV1, null>) {
    return new RunOutputFacts(run, this.deps.ledger).witness(channel);
  }
`+s.slice(idx);write(cc,s);
const ds='src/contracts/verification-service.ts';s=read(ds);const da=s.indexOf('  /**\n   * 只读：未处置问题'), db=s.indexOf('  context: VerificationContextPort;',da);s=s.slice(0,da)+"  disposition: import('./rework-disposition.js').ReworkDispositionPort;\n"+s.slice(db);write(ds,s);
const vs='src/control/verification-engine/verification-service.ts';write(vs,read(vs).replace('ledger: deps.ledger','disposition: deps.disposition'));
const vr='src/control/verification-engine/verification-rounds.ts';write(vr,read(vr).replace('ledger: this.deps.ledger','materials: this.deps.context'));
