const relationEditBaseLoadRelations = loadRelations;
loadRelations = async function(deliverableId) {
  await relationEditBaseLoadRelations(deliverableId);
  if (!hasPermission('RELATION_EDIT')) return;
  const table = byId('relations-list')?.querySelector('table');
  if (!table) return;
  const data = await api(`/internal/relations/deliverable/${deliverableId}`);
  const rows = [...table.querySelectorAll('tbody tr')];
  rows.forEach((row, index) => {
    const relation = data.items[index];
    if (!relation) return;
    const actions = row.lastElementChild?.querySelector('.inline-actions') || row.lastElementChild;
    if (!actions || actions.querySelector('[data-relation-edit]')) return;
    if (actions.textContent?.trim() === '—') actions.textContent = '';
    actions.classList.add('inline-actions');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-light btn-sm';
    button.dataset.relationEdit = String(relation.id);
    button.dataset.permission = 'RELATION_EDIT';
    button.textContent = '编辑';
    button.onclick = () => openRelationEditForm(deliverableId, relation);
    actions.insertBefore(button, actions.firstChild);
  });
};

async function openRelationEditForm(currentDeliverableId, relation) {
  if (!hasPermission('RELATION_EDIT')) return toast('当前角色没有编辑关联关系的权限。', 'error');
  const [sourceVersions, targetVersions] = await Promise.all([
    api(`/internal/relations/versions/${relation.sourceDeliverableId}`),
    api(`/internal/relations/versions/${relation.targetDeliverableId}`)
  ]);
  const versionOptions = (items, selected) => `<option value="">交付物级关联</option>${items.map(x => `<option value="${x.id}" ${Number(x.id)===Number(selected)?'selected':''}>${esc(x.version)} · ${esc(statusNames[x.status]||x.status)}</option>`).join('')}`;
  const body = `<form id="relation-edit-form"><div class="alert">关联双方创建后保持不变；如关联对象选错，请删除后重新建立。这里可以调整双方版本、关系类型和关系说明。</div><div class="form-grid"><div class="field span-2"><label>关联双方</label><div class="relation-fixed-pair"><div><span>源/上游</span><strong>${esc(relation.sourceCode)} · ${esc(relation.sourceName)}</strong></div><div class="relation-fixed-arrow">→</div><div><span>目标/下游</span><strong>${esc(relation.targetCode)} · ${esc(relation.targetName)}</strong></div></div></div><div class="field"><label>源交付物版本</label><select name="sourceVersionId">${versionOptions(sourceVersions.items||[],relation.sourceVersionId)}</select></div><div class="field"><label>目标交付物版本</label><select name="targetVersionId">${versionOptions(targetVersions.items||[],relation.targetVersionId)}</select></div><div class="field"><label>关联类型 *</label><select name="relationType">${Object.entries(relationNames).map(([code,name])=>`<option value="${code}" ${relation.relationType===code?'selected':''}>${esc(name)}</option>`).join('')}</select></div><div class="field span-2"><label>关系说明</label><textarea name="description" rows="4" placeholder="说明关联依据、验证范围或依赖关系">${esc(relation.description||'')}</textarea></div></div></form>`;
  showModal('编辑关联关系', body, { submitText:'保存修改', onSubmit:async close=>{
    const form=byId('relation-edit-form');if(!form.reportValidity())throw new Error('请补全必填信息。');const f=new FormData(form);
    await api(`/internal/relations/${relation.id}`,{method:'PUT',body:JSON.stringify({sourceDeliverableId:relation.sourceDeliverableId,targetDeliverableId:relation.targetDeliverableId,sourceVersionId:Number(f.get('sourceVersionId'))||null,targetVersionId:Number(f.get('targetVersionId'))||null,relationType:f.get('relationType'),description:f.get('description')})});
    close();toast('关联关系已更新。');await loadRelations(currentDeliverableId);
  }});
}
