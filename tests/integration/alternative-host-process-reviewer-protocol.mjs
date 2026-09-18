export function roundReviewProposal() {
  return {
    kind: 'plan', summary: 'Check the actual file with tools, then independently review its semantics.',
    assignments: [{ taskId: 'coding-task', role: 'executor', instruction: 'Inspect subject.txt and report its public result; independent tools and Reviewer must verify it.' }],
    plan: {
      stages: [{ stageId: 'work', title: 'File task' }],
      tasks: [
        { taskId: 'coding-task', stageId: 'work', title: 'Inspect file', taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'work' } },
        { taskId: 'gate-goal', title: 'Independent verification', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      obligations: [{ obligationId: 'file-contract', title: 'File semantics and behavior', requirementLevel: 'required', taskIds: ['coding-task', 'gate-goal'], verificationRequirements: [
        { requirementId: 'behavior', requirementLevel: 'required', kind: 'dynamic', description: 'Run all registered behavior checks.' },
        { requirementId: 'semantics', requirementLevel: 'required', kind: 'reviewer', description: 'Independent semantic review of this source version.' },
      ] }],
      taskHierarchy: { parentOf: [{ parentTaskId: 'gate-goal', childTaskId: 'coding-task' }] },
      executionDag: { dependsOn: [{ taskId: 'gate-goal', dependsOnId: 'coding-task', requires: { kind: 'gate-result', label: 'Current Task verification' } }] },
    },
  };
}


function objects(value) {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (value && typeof value === 'object') return [value, ...Object.values(value).flatMap(objects)];
  if (typeof value !== 'string') return [];
  return value.split('\n\n').flatMap(text => { try { return objects(JSON.parse(text)); } catch { return []; } });
}
// Only model-visible text and actual tool returns supply evidence identities.
export function reviewerReply(request) {
  const material = objects(request.messages);
  const packet = material.find(v => v.kind === 'independent-review-packet');
  const binding = material.find(v => typeof v.reviewId === 'string' && typeof v.packetDigest === 'string');
  if (!packet || !binding) throw Error('Missing actual Reviewer packet/binding');
  const returned = objects(request.messages.filter(message => message.role === 'tool'));
  const failed = returned.find(v => v.status === 'error' || v.status === 'cancelled');
  if (failed) throw Error('Real Reviewer tool failed: ' + JSON.stringify(failed));
  const source = returned.find(v => v.materialId === 'source:subject.txt' && typeof v.sourceDigest === 'string');
  if (!source) return { call: { id: 'source', name: 'read_source', arguments: { path: 'subject.txt', startLine: 1, maxLines: 1 } } };
  for (const entry of packet.materials) {
    const pages = returned.filter(v => v.ref?.digest === entry.ref.digest && typeof v.nextOffset === 'number');
    if (pages.some(p => p.complete === true)) continue;
    const offset = Math.max(0, ...pages.map(p => p.nextOffset));
    return { call: { id: 'material-' + entry.materialId + '-' + offset, name: 'read_material', arguments: { materialId: entry.materialId, offset, maxBytes: 32768 } } };
  }
  const tool = packet.materials.find(e => e.kind === 'tool-report');
  if (!tool) throw Error('Missing tool report');
  return { content: JSON.stringify({ schemaVersion: 1, kind: 'independent-review-result', reviewId: packet.workRef.reviewId,
    descriptorDigest: packet.descriptorDigest, packetDigest: binding.packetDigest, sourceDigest: packet.materialIdentity.sourceDigest,
    citations: [{ citationId: 'source', materialId: 'source:subject.txt', digest: source.sourceDigest, location: { kind: 'source-lines', path: 'subject.txt', startLine: 1, endLine: 1 } },
      { citationId: 'tool', materialId: tool.materialId, digest: tool.ref.digest, location: { kind: 'artifact-section', pointer: '/result' } }],
    requirements: packet.coverage.map(({ obligationId, requirementId }) => ({ obligationId, requirementId, result: 'PASS', rationale: 'Current subject.txt contains expected and the original behavior check reports PASS for this source.', citationIds: ['source', 'tool'], issueIds: [], unknowns: [] })), issues: [] }) };
}
