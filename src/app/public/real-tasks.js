import {referencesFor,clearReferences} from './file-references.js';
export function initializeRealTasks({ token, current, refresh }) {
  const $ = id => document.getElementById(id);
  let retry = null, draftScope = null;
  const drafts = new Map();
  const keyOf = c => JSON.stringify([c.projectId,c.workspaceId,c.goalId]);
  const keepDraft = () => { if(draftScope) drafts.set(keyOf(draftScope),$('real-task-instruction').value); };
  $('real-task-instruction').addEventListener('input',keepDraft);
  $('real-task-dialog').addEventListener('close',keepDraft);
  async function post(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-platform-token': token }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw Error(result.error ?? '请求失败'); return result;
  }
  const openTask = () => {
    const c = current(); if (!c.goalId) return;
    keepDraft(); draftScope = {...c};
    $('real-task-instruction').value = drafts.get(keyOf(c)) ?? c.objective ?? '';
    $('real-task-root').textContent = c.root ?? '';
    $('real-task-write').checked = false; $('real-task-error').textContent = '';
    $('real-task-dialog').showModal();
  };
  $('real-task-open').onclick = openTask;
  $('compose-real-task').onclick = openTask;
  $('real-task-form').onsubmit = async event => {
    event.preventDefault(); const button = $('real-task-submit'); button.disabled = true;
    const c = current();
    const body = { projectId: c.projectId, workspaceId: c.workspaceId, goalId: c.goalId, instruction: $('real-task-instruction').value, references: referencesFor(c), allowWrite: $('real-task-write').checked, budget: { contextWindowTokens: Number($('real-context').value), inputTokens: Number($('real-input-limit').value), outputTokens: Number($('real-output-limit').value), maxRequests: Number($('real-request-limit').value), maxToolCalls: Number($('real-tool-limit').value), timeoutMs: Number($('real-time-limit').value) * 1000 } };
    const identity = JSON.stringify(body);
    if (retry?.identity !== identity) retry = { identity, requestId: crypto.randomUUID() };
    try { await post('/api/real/tasks', { ...body, requestId: retry.requestId }); drafts.delete(keyOf(c)); draftScope = null; $('real-task-dialog').close(); clearReferences(c); await refresh(); }
    catch (error) { $('real-task-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-cancel-real]'); if (!button) return;
    button.disabled = true;
    try { const c = current(); await post('/api/real/cancel', { projectId: c.projectId, workspaceId: c.workspaceId, goalId: c.goalId, runId: button.dataset.cancelReal }); await refresh(); }
    catch (error) { $('notice').hidden = false; $('notice').textContent = error.message; }
    finally { button.disabled = false; }
  });
}
