async function renderChanges() {
  setPage('变更管理', '记录交付物变更原因、影响范围和处理状态');
  const data = await api('/internal/changes');
  content.innerHTML = `<section class="card"><div class="card-head"><div class="toolbar"><button id="new-change" class="btn btn-primary">+ 发起变更</button></div><span class="muted">共 ${data.items.length} 项</span></div><div class="table-wrap">
    ${data.items.length ? `<table><thead><tr><th>变更编号</th><th>交付物</th><th>变更内容</th><th>提出/责任人</th><th>状态</th><th>计划完成</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
    ${data.items.map(x => `<tr><td class="code">${esc(x.code)}</td><td>${esc(x.deliverableName)}<div class="muted">${esc(x.deliverableCode)}</div></td><td><strong>${esc(x.reason)}</strong><div class="muted">${esc(x.content)}</div></td>
    <td>${esc(x.applicant)} / ${esc(x.responsiblePerson)}</td><td>${statusBadge(x.status)}</td><td>${esc(fmtDateOnly(x.plannedCompletionDate))}</td><td>${esc(fmtDate(x.updatedAt))}</td><td><div class="inline-actions">${changeActionButtons(x)}</div></td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">暂无变更记录</div>'}</div></section>`;
  byId('new-change').onclick = openChangeForm;
  document.querySelectorAll('[data-change-action]').forEach(btn => btn.onclick = () => runChangeAction(Number(btn.dataset.changeId), btn.dataset.changeAction));
}

function changeActionButtons(x) {
  const map = {
    PENDING_ASSESSMENT: [['approve','批准'],['reject','驳回']], APPROVED: [['start','开始实施']],
    IMPLEMENTING: [['verify','提交验证']], PENDING_VERIFICATION: [['close','关闭']]
  };
  return (map[x.status] || []).map(([action,label]) => `<button class="btn ${action === 'reject' ? 'btn-danger' : 'btn-light'} btn-sm" data-change-action="${action}" data-change-id="${x.id}">${label}</button>`).join('');
}

async function openChangeForm() {
  const list = await api('/internal/deliverables?page=1&pageSize=100');
  const body = `<form id="change-form"><div class="form-grid">
    <div class="field span-2"><label>交付物 *</label><select name="deliverableId" required><option value="">请选择</option>${list.items.map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label>变更类型</label><select name="changeType"><option value="CONTENT_CHANGE">内容变更</option><option value="VERSION_CHANGE">版本变更</option><option value="PATH_CHANGE">路径变更</option><option value="SECURITY_CHANGE">权限属性变更</option></select></div>
    <div class="field"><label>关联需求/问题编号</label><input name="relatedIssueCode"></div>
    <div class="field span-2"><label>变更原因 *</label><textarea name="changeReason" required></textarea></div>
    <div class="field span-2"><label>变更内容 *</label><textarea name="changeContent" required></textarea></div>
    <div class="field span-2"><label>影响范围</label><textarea name="impactScope"></textarea></div>
    <div class="field"><label>提出人 *</label><input name="applicant" value="${esc(operatorName())}" required></div>
    <div class="field"><label>责任人 *</label><input name="responsiblePerson" required></div>
    <div class="field"><label>计划完成日期</label><input type="date" name="plannedCompletionDate"></div>
  </div></form>`;
  showModal('发起变更', body, { submitText: '提交变更', onSubmit: async close => {
    const form = byId('change-form'); if (!form.reportValidity()) throw new Error('请先填写所有必填字段。'); const f = new FormData(form);
    await api('/internal/changes', { method: 'POST', body: JSON.stringify({
      deliverableId: Number(f.get('deliverableId')), changeType: f.get('changeType'), changeReason: f.get('changeReason'), changeContent: f.get('changeContent'),
      impactScope: f.get('impactScope'), relatedIssueCode: f.get('relatedIssueCode'), applicant: f.get('applicant'), responsiblePerson: f.get('responsiblePerson'),
      plannedCompletionDate: f.get('plannedCompletionDate') || null
    }) });
    close(); toast('变更已发起'); renderChanges();
  }});
}

async function runChangeAction(id, action) {
  const label = { approve:'批准', reject:'驳回', start:'开始实施', verify:'提交验证', close:'关闭' }[action];
  if (!confirm(`确认${label}该变更吗？`)) return;
  const opinion = ['approve','reject'].includes(action) ? (prompt('请输入评审意见：') || '') : '';
  await api(`/internal/changes/${id}/${action}`, { method: 'POST', body: JSON.stringify({ operator: operatorName(), opinion }) });
  toast('变更状态已更新'); renderChanges();
}

async function renderSettings() {
  setPage('基础设置', '项目基础数据、运行状态和数据库备份');
  const health = await api('/internal/system/health');
  content.innerHTML = `<section class="dashboard-grid">
    <div class="card"><div class="card-head"><h3>运行状态</h3><span class="badge released">运行正常</span></div><div class="card-body"><div class="kv-list">
      <div>应用名称</div><div>${esc(health.application)}</div><div>SQLite版本</div><div>${esc(health.sqliteVersion)}</div><div>数据库路径</div><div class="code">${esc(health.databasePath)}</div><div>系统时间</div><div>${esc(health.time)}</div>
    </div><div style="margin-top:14px"><button id="manual-backup" class="btn btn-primary">立即备份数据库</button></div></div></div>
    <div class="card"><div class="card-head"><h3>项目/车型</h3><button id="new-project" class="btn btn-primary btn-sm">+ 新增项目</button></div><div class="card-body recent-list">
      ${state.master.projects.map(x => `<div class="recent-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.code)}</small></div><span class="badge active">启用</span></div>`).join('')}
    </div></div></section>
    <section class="card"><div class="card-head"><h3>当前V1.0范围</h3></div><div class="card-body"><p>当前版本聚焦交付物主档、版本生命周期、变更记录、基础统计和本地备份。暂未启用复杂账号权限、外部系统对接和开放API。</p></div></section>`;
  byId('manual-backup').onclick = async () => { const result = await api('/internal/system/backup', { method: 'POST' }); toast(result.message); };
  byId('new-project').onclick = openProjectForm;
}

function openProjectForm() {
  const body = `<form id="project-form"><div class="form-grid"><div class="field"><label>项目编码 *</label><input name="projectCode" required placeholder="A10"></div><div class="field"><label>项目名称 *</label><input name="projectName" required></div><div class="field"><label>车型</label><input name="vehicleModel"></div><div class="field"><label>平台</label><input name="platformName"></div></div></form>`;
  showModal('新增项目/车型', body, { small: true, submitText: '新增', onSubmit: async close => {
    const form = byId('project-form'); if (!form.reportValidity()) throw new Error('请填写项目编码和名称。'); const f = new FormData(form);
    await api('/internal/master-data/projects', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
    state.master = null; await loadMaster(); close(); toast('项目已新增'); renderSettings();
  }});
}

async function copyText(value) {
  try { await navigator.clipboard.writeText(value || ''); toast('路径已复制'); }
  catch { prompt('请复制以下路径：', value || ''); }
}

route();
