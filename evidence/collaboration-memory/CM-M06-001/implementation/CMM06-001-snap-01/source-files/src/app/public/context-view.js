const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** This is the recorded task input, never reconstructed from today's state. */
export function contextManifestMarkup(record) {
  const context=record?.context;
  if(!context?.manifest) return '<p class="muted" data-context-state="historical">本次历史运行没有保存上下文选材清单，无法据此还原当时的输入。</p>';
  const manifest=context.manifest, selected=manifest.selected ?? [], gaps=manifest.gaps ?? [], truncated=manifest.truncated ?? [];
  return '<div data-context-state="recorded"><p>已核对任务、资料版本和权限。选入 '+selected.length+' 项材料。</p>'
    +'<ul>'+selected.map(item=>'<li><strong>'+esc(item.id)+'</strong>：'+esc(item.selectedBecause)+'<small>来源：'+esc(item.sourceRefs?.map(ref=>ref.refId+' @ '+ref.revision).join('、') || '当前运行')+'</small></li>').join('')+'</ul>'
    +(gaps.length?'<p><strong>尚未接入或缺少的材料</strong></p><ul>'+gaps.map(gap=>'<li>'+esc(gap)+'</li>').join('')+'</ul>':'')
    +(truncated.length?'<p><strong>缩减的材料</strong></p><ul>'+truncated.map(item=>'<li>'+esc(item.id)+'：'+esc(item.reason)+'</li>').join('')+'</ul>':'<p>本次组装没有裁剪已选材料。</p>')
    +'<details><summary>本次任务输入</summary><p class="muted">执行启动时实际提供的任务材料；不含系统提示及后续工具结果。</p><pre>'+esc(context.input)+'</pre></details>'
    +'<details><summary>版本与来源校验记录</summary><pre>'+esc(JSON.stringify(manifest,null,2))+'</pre></details></div>';
}
