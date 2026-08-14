function dataScopeEscape(value){return esc(String(value??''));}

function renderDataScopeGroups(schema, selectedScopes){
  const selected = new Set((selectedScopes||[]).map(x => `${x.dimension}|${x.scopeType}|${x.scopeValue}`));
  return (schema?.dimensions||[]).map(d => {
    const options = d.options||[];
    return `<div class="permission-group data-scope-group"><h4>${dataScopeEscape(d.name)}</h4><div class="field-check-grid">${options.length ? options.map(o => {
      const key = `${d.code}|${d.scopeType}|${o.value}`;
      return `<label class="field-check"><input type="checkbox" name="dataScopes" data-dimension="${dataScopeEscape(d.code)}" data-scope-type="${dataScopeEscape(d.scopeType||'INCLUDE')}" value="${dataScopeEscape(o.value)}" ${selected.has(key)?'checked':''}><span>${dataScopeEscape(o.name)}</span></label>`;
    }).join('') : '<span class="muted">暂无可选数据。</span>'}</div></div>`;
  }).join('');
}

async function openRoleV08Edit(id){
  const detail = await api(`/internal/roles/${id}`);
  const data = await api('/internal/roles');
  const schema = await api('/internal/roles/data-scope-schema');
  const selected = new Set(detail.permissions);
  const nodes = new Set(detail.workflowNodes);
  const selectedScopes = detail.dataScopes || [];
  const body = `<form id="role-v09-form">
    <div class="form-grid"><div class="field"><label>角色名称 *</label><input name="name" value="${esc(detail.role.name)}" required ${detail.role.isSystemRole?'disabled':''}></div><div class="field"><label>角色编码</label><input value="${esc(detail.role.code)}" disabled></div></div>
    <div class="section-divider"><h4>① 功能权限</h4><p class="form-hint">决定用户能看到、创建、编辑、审批哪些模块。</p>${rolePermissionGroups(data,selected)}</div>
    <div class="section-divider"><h4>② 数据范围</h4><p class="form-hint">不选择任何数据范围时表示不做额外限制；选择多个维度时，各维度之间按 AND 收敛，同一维度内多个选项按 OR 匹配。</p><div id="role-scope-box">${renderDataScopeGroups(schema,selectedScopes)}</div></div>
    <div class="section-divider"><h4>③ 流程权限</h4><div class="field-check-grid">${data.workflowNodes.map(n=>`<label class="field-check"><input type="checkbox" name="workflowNodes" value="${n.code}" ${nodes.has(n.code)?'checked':''}><span>${esc(n.name)}</span></label>`).join('')}</div></div>
    <div class="notice-panel">保存前请确认：角色权限越大，可操作范围越广；数据范围用于进一步收敛，不属于“保密等级”。</div>
  </form>`;
  showModal('配置角色权限',body,{onSubmit:async close=>{
    const form=byId('role-v09-form');
    if(!form.reportValidity())throw new Error('请填写角色名称。');
    const permissionCodes=[...form.querySelectorAll('input[name="permissionCodes"]:checked')].map(x=>x.value);
    const workflowNodes=[...form.querySelectorAll('input[name="workflowNodes"]:checked')].map(x=>({nodeCode:x.value,enabled:true}));
    const dataScopes=[...form.querySelectorAll('input[name="dataScopes"]:checked')].map(x=>({dimension:x.dataset.dimension,scopeType:x.dataset.scopeType,scopeValue:x.value}));
    await api(`/internal/roles/${id}/policy`,{method:'PUT',body:JSON.stringify({permissionCodes,workflowNodes,dataScopes})});
    if(!detail.role.isSystemRole){await api(`/internal/roles/${id}`,{method:'PUT',body:JSON.stringify({name:form.elements.name.value,code:detail.role.code,description:detail.role.description,isEnabled:detail.role.isEnabled,revision:detail.role.revision})});}
    close();toast('角色权限已保存。');await renderRoles();
  }});
}
