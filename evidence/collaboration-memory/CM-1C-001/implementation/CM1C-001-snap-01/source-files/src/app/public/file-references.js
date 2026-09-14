const drafts = new Map();
let current = null;
const keyOf = scope => JSON.stringify([scope?.projectId,scope?.workspaceId,scope?.goalId]);
export const referencesFor = scope => (drafts.get(keyOf(scope)) ?? []).map(({path,sha256}) => ({path,sha256}));
export function clearReferences(scope) { drafts.delete(keyOf(scope)); render(); }
function render() {
  for (const id of ['file-reference-draft','real-task-references']) {
    const host = document.getElementById(id); if (!host) continue;
    host.replaceChildren(); const refs = referencesFor(current); host.hidden = !refs.length;
    if (!refs.length) continue;
    const title = document.createElement('p'); title.textContent = '任务草稿中的文件 · 提交时核对版本，Agent 按需读取'; host.append(title);
    refs.forEach(ref => { const chip = document.createElement('span'); chip.className = 'reference-chip'; const label = document.createElement('span'); label.textContent = ref.path; label.title = ref.path;
      const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label','移除引用 '+ref.path);
      close.onclick = () => { drafts.set(keyOf(current),referencesFor(current).filter(item => item.path !== ref.path)); render(); };
      chip.append(label,close); host.append(chip);
    });
  }
}
window.addEventListener('platform-scope-changing',()=>{current=null;render();});
window.addEventListener('platform-state', event => { current = {...event.detail.scope,goalId:event.detail.goalId}; render(); });
window.addEventListener('platform-add-file-reference', event => {
  const ref = event.detail;
  const notice = document.getElementById('notice');
  if (!current?.goalId || ref.projectId !== current.projectId || ref.workspaceId !== current.workspaceId) { notice.hidden=false; notice.textContent='请先选择该项目的目标，再添加文件到任务草稿。'; return; }
  const refs = referencesFor(current), existing = refs.findIndex(item => item.path === ref.path);
  if (existing < 0 && refs.length >= 8) { notice.hidden=false; notice.textContent='一个任务最多引用 8 个文件。'; return; }
  const value = {path:ref.path,sha256:ref.sha256}; if (existing < 0) refs.push(value); else refs[existing]=value;
  drafts.set(keyOf(current),refs); render(); notice.hidden=false; notice.textContent='文件已加入当前任务草稿。点击“编写开发任务”继续。';
});
