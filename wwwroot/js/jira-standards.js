const jiraStandardStageNames = { new:'新增', confirm:'问题确认', analysis:'原因分析', action:'措施确认', verify:'测试验证', closed:'问题关闭' };
const jiraStandardSeverityCodes = ['S','A','B','C'];

async function renderJiraStandards() {
  setPage('JIRA时效标准', '按Jira服务器和项目标识配置状态映射与自然日时效规则');
  const data = await api('/internal/jira-standards');
  const canManage = hasPermission('JIRA_STANDARD_MANAGE');
  content.innerHTML = `<section class="card jira-standard-page">
    <div class="card-head"><div><h3>项目时效标准</h3><p class="muted section-note">JIRA看板按“服务器地址＋Project Key”自动匹配唯一启用标准。状态名称不区分大小写。</p></div>${canManage?'<button type="button" id="jira-standard-new" class="btn btn-primary" data-permission="JIRA_STANDARD_MANAGE">+ 新增项目标准</button>':''}</div>
    ${data.items.length ? `<div class="table-wrap"><table><thead><tr><th>项目</th><th>Jira服务器</th><th>阶段状态</th><th>关闭总周期</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${data.items.map(item=>jiraStandardRow(item,canManage)).join('')}</tbody></table></div>` : '<div class="empty">尚未配置JIRA时效标准。新增配置后，对应项目才能生成JIRA看板。</div>'}
  </section>`;
  byId('jira-standard-new')?.addEventListener('click',()=>openJiraStandardEditor());
  content.querySelectorAll('[data-standard-view]').forEach(button=>button.onclick=()=>openJiraStandardDetail(Number(button.dataset.standardView)));
  content.querySelectorAll('[data-standard-edit]').forEach(button=>button.onclick=()=>openJiraStandardEditor(Number(button.dataset.standardEdit)));
  content.querySelectorAll('[data-standard-copy]').forEach(button=>button.onclick=()=>openJiraStandardEditor(Number(button.dataset.standardCopy),true));
  content.querySelectorAll('[data-standard-delete]').forEach(button=>button.onclick=async()=>{
    const item=data.items.find(x=>x.id===Number(button.dataset.standardDelete));
    const result=await confirmAction('删除JIRA时效标准',`确认删除“${item.projectName}（${item.projectKey}）”的时效标准吗？删除后该项目将无法生成JIRA看板。`,{submitText:'确认删除',danger:true});
    if(!result.confirmed)return;
    await api(`/internal/jira-standards/${item.id}`,{method:'DELETE'});
    toast('JIRA时效标准已删除。');
    await renderJiraStandards();
  });
}

function jiraStandardRow(item,canManage){
  const stageSummary=item.stages.map(stage=>`${jiraStandardStageNames[stage.stageCode]||stage.stageCode} ${stage.statuses.length}个`).join(' · ');
  const closure=jiraStandardSeverityCodes.map(code=>`${code}:${item.closureLimits[code]??'—'}天`).join(' / ');
  return `<tr><td><strong>${esc(item.projectName)}</strong><small class="table-sub">${esc(item.projectKey)}</small></td><td class="code">${esc(item.jiraBaseUrl)}</td><td><span class="jira-standard-summary">${esc(stageSummary)}</span></td><td>${esc(closure)}</td><td><span class="badge ${item.isEnabled?'released':'deprecated'}">${item.isEnabled?'启用':'停用'}</span></td><td>${esc(fmtDate(item.updatedAt))}<small class="table-sub">${esc(item.updatedBy)}</small></td><td><div class="inline-actions"><button type="button" class="btn btn-light btn-sm" data-standard-view="${item.id}">查看</button>${canManage?`<button type="button" class="btn btn-light btn-sm" data-standard-edit="${item.id}">编辑</button><button type="button" class="btn btn-light btn-sm" data-standard-copy="${item.id}">复制</button><button type="button" class="btn btn-danger btn-sm" data-standard-delete="${item.id}">删除</button>`:''}</div></td></tr>`;
}

async function openJiraStandardDetail(id){
  const item=await api(`/internal/jira-standards/${id}`);
  const body=`<div class="jira-standard-detail"><div class="jira-standard-detail-meta"><div><span>项目</span><strong>${esc(item.projectName)}（${esc(item.projectKey)}）</strong></div><div><span>Jira服务器</span><strong>${esc(item.jiraBaseUrl)}</strong></div><div><span>状态</span><strong>${item.isEnabled?'启用':'停用'}</strong></div></div><div class="jira-standard-detail-table"><div><strong>阶段</strong><strong>对应Jira状态</strong>${jiraStandardSeverityCodes.map(x=>`<strong>${x}级</strong>`).join('')}</div>${item.stages.map(stage=>`<div><span>${esc(jiraStandardStageNames[stage.stageCode]||stage.stageCode)}</span><span>${stage.statuses.map(esc).join('、')}</span>${jiraStandardSeverityCodes.map(code=>`<span>${stage.stageCode==='closed'?'—':`${stage.limits[code]??'—'}天`}</span>`).join('')}</div>`).join('')}<div class="closure"><span>关闭总周期</span><span>从创建至关闭/截止日</span>${jiraStandardSeverityCodes.map(code=>`<span>${item.closureLimits[code]??'—'}天</span>`).join('')}</div></div>${item.ruleNote?`<div class="notice-panel">${esc(item.ruleNote)}</div>`:''}<small>最后更新：${esc(item.updatedBy)} · ${esc(fmtDate(item.updatedAt))} · 修订 ${item.revision}</small></div>`;
  const modal=showModal('查看JIRA时效标准',body,{submitText:'关闭',onSubmit:async close=>close()});
  modal.root.classList.add('jira-standard-modal');
}

async function openJiraStandardEditor(id=null,copy=false){
  const source=id?await api(`/internal/jira-standards/${id}`):await api('/internal/jira-standards/template');
  const item=id?source:{jiraBaseUrl:'',projectKey:'',projectName:'',isEnabled:true,revision:0,...source};
  if(copy){item.projectKey='';item.projectName=`${item.projectName} - 副本`;item.revision=0;}
  const title=copy?'复制项目标准':id?'编辑项目标准':'新增项目标准';
  const body=`<form id="jira-standard-form" class="jira-standard-form">
    <div class="form-grid jira-standard-base"><div class="field"><label>Jira服务器地址 *</label><input name="jiraBaseUrl" type="url" value="${esc(item.jiraBaseUrl||'')}" placeholder="http://jira.company.local/jira" required ${id&&!copy?'readonly':''}></div><div class="field"><label>Project Key *</label><input name="projectKey" value="${esc(item.projectKey||'')}" placeholder="如：AD" required ${id&&!copy?'readonly':''}></div><div class="field"><label>项目名称 *</label><input name="projectName" value="${esc(item.projectName||'')}" required></div></div>
    <label class="check-line"><input type="checkbox" name="isEnabled" ${item.isEnabled?'checked':''}>启用该项目标准</label>
    <div class="jira-standard-section"><div><h4>阶段状态与时效</h4><p>状态用换行或英文逗号分隔；时效单位为自然日。一个状态不能同时属于多个阶段。</p></div>
      <div class="jira-standard-matrix"><div class="jira-standard-matrix-head"><span>处理阶段</span><span>对应Jira状态</span>${jiraStandardSeverityCodes.map(x=>`<span>${x}级</span>`).join('')}</div>${item.stages.map(stage=>jiraStandardStageEditor(stage)).join('')}</div>
    </div>
    <div class="jira-standard-section"><div><h4>问题关闭总周期</h4><p>从问题创建时间计算至关闭时间；未关闭问题计算至统计截止时间。</p></div><div class="jira-closure-limits">${jiraStandardSeverityCodes.map(code=>`<label><span>${code}级</span><input type="number" min="1" max="365" name="closure_${code}" value="${esc(item.closureLimits[code]??'')}" required><small>天</small></label>`).join('')}</div></div>
    <div class="field"><label>规则说明</label><textarea name="ruleNote" maxlength="500" rows="3" placeholder="例如：测试验证由小V 2天和集成测试3天组成">${esc(item.ruleNote||'')}</textarea></div>
  </form>`;
  const modal=showModal(title,body,{submitText:'保存标准',onSubmit:async close=>{
    const request=readJiraStandardForm(item.revision||0);
    if(id&&!copy)await api(`/internal/jira-standards/${id}`,{method:'PUT',body:JSON.stringify(request)});
    else await api('/internal/jira-standards',{method:'POST',body:JSON.stringify(request)});
    close();toast('JIRA时效标准已保存。');await renderJiraStandards();
  }});
  modal.root.classList.add('jira-standard-modal');
}

function jiraStandardStageEditor(stage){
  const closed=stage.stageCode==='closed';
  return `<div class="jira-standard-matrix-row" data-stage-code="${esc(stage.stageCode)}"><strong>${esc(jiraStandardStageNames[stage.stageCode]||stage.stageCode)}</strong><textarea rows="${Math.min(4,Math.max(2,stage.statuses.length))}" data-stage-statuses required>${esc(stage.statuses.join('\n'))}</textarea>${jiraStandardSeverityCodes.map(code=>closed?'<span class="jira-limit-na">—</span>':`<label><input type="number" min="1" max="365" data-stage-limit="${code}" value="${esc(stage.limits[code]??'')}" required><small>天</small></label>`).join('')}</div>`;
}

function readJiraStandardForm(revision){
  const form=byId('jira-standard-form');
  if(!form.reportValidity())throw new Error('请完整填写项目、阶段状态和时效标准。');
  const stages=[...form.querySelectorAll('[data-stage-code]')].map(row=>({
    stageCode:row.dataset.stageCode,
    statuses:row.querySelector('[data-stage-statuses]').value.split(/[\n,，]+/).map(x=>x.trim()).filter(Boolean),
    limits:Object.fromEntries(jiraStandardSeverityCodes.map(code=>[code,row.querySelector(`[data-stage-limit="${code}"]`)?Number(row.querySelector(`[data-stage-limit="${code}"]`).value):null]))
  }));
  return {jiraBaseUrl:form.elements.jiraBaseUrl.value.trim(),projectKey:form.elements.projectKey.value.trim(),projectName:form.elements.projectName.value.trim(),isEnabled:form.elements.isEnabled.checked,stages,closureLimits:Object.fromEntries(jiraStandardSeverityCodes.map(code=>[code,Number(form.elements[`closure_${code}`].value)])),ruleNote:form.elements.ruleNote.value.trim(),revision};
}
