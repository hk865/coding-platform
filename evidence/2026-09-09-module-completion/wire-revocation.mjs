import fs from 'node:fs';
function edit(file, from, to) {
  const s = fs.readFileSync(file, 'utf8');
  if (!s.includes(from)) throw Error(`Missing anchor: ${file}: ${from}`);
  fs.writeFileSync(file, s.replace(from, to));
}
for (const file of ['src/harness/persistent-harness.ts', 'src/harness/in-memory-harness.ts']) {
  const signature = '  grantMaterialAccess(command: import("../contracts/material-access.js").GrantMaterialAccessCommand): Promise<import("../contracts/material-access.js").GrantMaterialAccessReceipt>;';
  edit(file, signature, signature + '\n  revokeMaterialAccess(command: import("../contracts/material-access.js").RevokeMaterialAccessCommand): Promise<import("../contracts/material-access.js").RevokeMaterialAccessReceipt>;');
  const s = fs.readFileSync(file, 'utf8');
  const start = s.indexOf('grantMaterialAccess: async (command) => {');
  const end = s.indexOf('\n', s.indexOf('},', start)) + 1;
  const block = s.slice(start, end);
  edit(file, block, block.replaceAll('grantMaterialAccess', 'revokeMaterialAccess') + block);
}
edit('src/contracts/testing/control.double.ts', '  readonly grantMaterialAccessCalls:', '  async revokeMaterialAccess(_command: import("../material-access.js").RevokeMaterialAccessCommand): Promise<import("../material-access.js").RevokeMaterialAccessReceipt> {\n    throw new Error("ScriptedControlEngine: no revokeMaterialAccess behavior configured");\n  }\n\n  readonly grantMaterialAccessCalls:');
for (const file of ['src/read-model/read-model-index.ts', 'src/sqlite-read-model/sqlite-read-model-index.ts']) {
  edit(file, '      eventType === "MaterialAccessGranted" ||', '      eventType === "MaterialAccessGranted" ||\n      eventType === "MaterialAccessRevoked" ||');
  edit(file, 'if (event.eventType !== "MaterialAccessGranted") return;\n    const ev = event as import("../contracts/material-access.js").MaterialAccessGrantedEvent;', 'if (event.eventType !== "MaterialAccessGranted" && event.eventType !== "MaterialAccessRevoked") return;\n    const ev = event;');
  if (file.includes('src/read-model/')) {
    edit(file, '    this.p118Grants.push({\n      ref:', '    const prior = this.p118Grants.findIndex(row => row.ref.projectId === ev.projectId && row.ref.workspaceId === ev.workspaceId && row.ref.goalId === grant.scope.goalId && row.ref.grantId === grant.grantId);\n    if (prior >= 0) this.p118Grants.splice(prior, 1);\n    this.p118Grants.push({\n      ...(ev.eventType === "MaterialAccessRevoked" ? { revocation: ev.payload.revocation } : {}),\n      ref:');
    edit(file, 'this.p118Grants.filter(row => matchesMaterialAccessLookup(row.grant, query))', 'this.p118Grants.filter(row => !row.revocation && matchesMaterialAccessLookup(row.grant, query))');
  } else {
    edit(file, 'const row: import("../contracts/material-access.js").MaterialAccessGrantRow = {\n      ref,', 'const row: import("../contracts/material-access.js").MaterialAccessGrantRow = {\n      ...(ev.eventType === "MaterialAccessRevoked" ? { revocation: ev.payload.revocation } : {}),\n      ref,');
    edit(file, 'if (matchesMaterialAccessLookup(row.grant, query)) grants.push(row);', 'if (!row.revocation && matchesMaterialAccessLookup(row.grant, query)) grants.push(row);');
  }
}
