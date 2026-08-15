(() => {
  function installSystemManagementMenu(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav)return;
    // index.html now owns the canonical system-management group. Do not move its
    // child links again; doing so would detach them from data-permission-group.
    if(nav.querySelector('.sidebar-group[data-permission-group="SYSTEM_MANAGEMENT"]'))return;
    if(nav.querySelector('[data-system-management]'))return;
    const links=['users','roles','settings'].map(route=>nav.querySelector(`a[data-route="${route}"]`)).filter(Boolean);
    if(!links.length)return;
    const group=document.createElement('details');group.className='nav-system-group';group.dataset.systemManagement='true';
    const summary=document.createElement('summary');summary.innerHTML='<span>⚙</span>系统管理';group.appendChild(summary);links.forEach(link=>group.appendChild(link));nav.insertBefore(group,links[0]);
  }
  function updateSystemManagementVisibility(){
    const group=document.querySelector('[data-system-management]');
    if(!group)return;
    const visible=[...group.querySelectorAll('a[data-permission]')].some(a=>!a.classList.contains('hidden'));
    group.classList.toggle('hidden',!visible);
  }
  if(!document.getElementById('v09-requested-fixes-style')){const style=document.createElement('style');style.id='v09-requested-fixes-style';style.textContent='.nav-system-group{border-radius:9px;overflow:hidden}.nav-system-group summary{list-style:none;cursor:pointer;padding:11px 12px;border-radius:9px;display:flex;gap:11px;align-items:center;font-size:14px}.nav-system-group summary::-webkit-details-marker{display:none}.nav-system-group[open] summary,.nav-system-group summary:hover{background:rgba(79,119,229,.22);color:#fff}.nav-system-group>a{margin-left:12px;padding:9px 12px!important;font-size:13px!important}.nav-system-group>a.active{box-shadow:inset 3px 0 #6e95ff}';document.head.appendChild(style);}
  const originalApplyRoleUiV09=window.applyRoleUi;if(typeof originalApplyRoleUiV09==='function'&&!originalApplyRoleUiV09.__v09RequestedWrapped){window.applyRoleUi=function(){originalApplyRoleUiV09();updateSystemManagementVisibility();};window.applyRoleUi.__v09RequestedWrapped=true;}
  installSystemManagementMenu();setTimeout(updateSystemManagementVisibility,0);
  function openProjectEditForm(project){const body=`<form id="project-edit-form"><div class="form-grid"><div class="field"><label>项目编码 *</label><input name="projectCode" value="${esc(project.code)}" required></div><div class="field"><label>项目名称 *</label><input name="projectName" value="${esc(project.name)}" required></div><div class="field"><label>车型</label><input name="vehicleModel" value="${esc(project.vehicleModel||'')}"></div><div class="field"><label>平台</label><input name="platformName" value="${esc(project.platformName||'')}"></div></div></form>`;showModal('修改项目/车型',body,{small:true,submitText:'保存',onSubmit:async close=>{const form=byId('project-edit-form');if(!form.reportValidity())throw new Error('请填写项目编码和名称。');const f=new FormData(form);await api(`/internal/master-data/projects/${project.id}`,{method:'PUT',body:JSON.stringify(Object.fromEntries(f))});close();state.master=null;await loadMaster();toast('项目已更新');await renderSettings();}});}
  async function deleteProject(project){const result=await confirmAction('删除项目/车型',`确认删除“${project.name}（${project.code}）”吗？删除后将不再出现在项目车型选择项中。`,{submitText:'确认删除',danger:true});if(!result.confirmed)return;try{await api(`/internal/master-data/projects/${project.id}`,{method:'DELETE'});state.master=null;await loadMaster();toast('项目已删除');await renderSettings();}catch(error){toast(error.message,'error');}}
  const originalRenderSettingsV09=window.renderSettings;if(typeof originalRenderSettingsV09==='function'&&!originalRenderSettingsV09.__v09RequestedWrapped){window.renderSettings=async function(){await originalRenderSettingsV09();if(!hasPermission('MASTERDATA_EDIT'))return;const list=content.querySelector('.recent-list');if(!list)return;list.querySelectorAll('.recent-row').forEach((row,index)=>{const project=state.master?.projects?.[index];if(!project)return;const actions=document.createElement('div');actions.className='inline-actions';actions.innerHTML='<button type="button" class="btn btn-light btn-sm project-edit">修改</button><button type="button" class="btn btn-danger btn-sm project-delete">删除</button>';row.appendChild(actions);row.querySelector('.project-edit').onclick=()=>openProjectEditForm(project);row.querySelector('.project-delete').onclick=()=>deleteProject(project);});};window.renderSettings.__v09RequestedWrapped=true;}
  const originalRenderDetailV09=window.renderDeliverableDetail;if(typeof originalRenderDetailV09==='function'&&!originalRenderDetailV09.__v09RequestedWrapped){window.renderDeliverableDetail=async function(id){try{await originalRenderDetailV09(id);}catch(error){const relationList=byId('relations-list');if(relationList){relationList.innerHTML=`<div class="empty">关联关系暂时无法加载：${esc(error.message)}<br><button type="button" class="btn btn-light btn-sm" id="retry-relations">重新加载</button></div>`;const retry=byId('retry-relations');if(retry)retry.onclick=async()=>{try{await loadRelations(id);}catch(retryError){toast(retryError.message,'error');}};toast(error.message,'error');return;}throw error;}};window.renderDeliverableDetail.__v09RequestedWrapped=true;}
})();
