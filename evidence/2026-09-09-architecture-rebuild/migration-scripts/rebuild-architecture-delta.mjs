import { readFileSync, writeFileSync } from 'node:fs';
const path = 'src/contracts/architecture-inspection.ts';
const source = readFileSync(path, 'utf8');
const start = source.indexOf('/** Deterministic mechanical diff:');
const end = source.indexOf('// ------------------------------------------------------------------------ //\n// Finding', start);
const crlfEnd = source.indexOf('// ------------------------------------------------------------------------ //\r\n// Finding', start);
const boundary = end < 0 ? crlfEnd : end;
if (start < 0 || boundary < 0) throw Error('Missing architecture delta block');
const algorithm = source.slice(start, boundary).trimEnd();
writeFileSync('src/control/architecture-delta.ts', `import type { ArchitectureDeltaV1, ArchitectureDeltaChange, CodeGraphSnapshotV1 } from '../contracts/architecture-inspection.js';\nimport { canonicalJson, sha256Hex } from '../contracts/fingerprint.js';\n\n${algorithm}\n`);
writeFileSync(path, source.slice(0, start) + source.slice(boundary));
for (const file of ['tests/control/architecture-delta-regression.test.ts', 'tests/contract-suite/p1-12-harness.ts', 'tests/contract-suite/architecture.contract.suite.ts']) {
  const text = readFileSync(file, 'utf8').replace(/(import \{ computeArchitectureDelta \} from ["'])\.\.\/\.\.\/src\/contracts\/architecture-inspection.js(["'];)/, '$1../../src/control/architecture-delta.js$2');
  writeFileSync(file, text);
}
for (const [file, module] of [['src/control/architecture-reconciler.ts','./architecture-delta.js'], ['tests/control/architecture-reconciler.test.ts','../../src/control/architecture-delta.js']]) {
  let text = readFileSync(file, 'utf8').replace(/\bcomputeArchitectureDelta,\s*/, '');
  text = `import { computeArchitectureDelta } from '${module}';\n` + text;
  writeFileSync(file, text);
}
const test = 'tests/contract-suite/verification.contract.suite.ts';
writeFileSync(test, "import { compileVerificationPlan } from '../../src/verification/verification-plan-compiler.js';\n" + readFileSync(test,'utf8').replace('compileVerificationPlan, ',''));
