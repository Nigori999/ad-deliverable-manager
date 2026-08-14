async function renderChanges() {
  setPage('变更管理', '记录交付物变更原因、影响范围和审批状态');
  const status = state.changeStatusFilter || '';
  const data = await api(`/internal/changes${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  const statusOptions = ['', 'PENDING_ASSESSMENT', 'APPROVED', 'REJECTED', 'IMPLEMENTING', 'PENDING_VERIFICATION', 'CLOSED'];
  content.innerHTML = `<section class="card">
    <div class="card-head">
      <div class="toolbar">
        ${hasPermission('CHANGE_CREATE') ? '<button type="button" id="new-change" class="btn btn-primary">+ 发起变更</button>' : ''}
        <button type="button" id="export-changes" class="btn btn-light">导出CSV</button>
        <label class="inline-filter">状态<select id="change-status-filter">${statusOptions.map(x => `<option value="${x}" ${x === status ? 'selected' : ''}>${x ? statusNames[x] : '全部'}</option>`).join('')}</select></label>
      </div>
      <span class="muted">共 ${data.items.length} 项</span>
    </div>
    <div class="table-wrap">
      ${data.items.length ? `<table><thead><tr><th>变更编号</th><th>交付物</th><th>变更内容</th><th>提出/责任人</th><th>状态</th><th>评审</th><th>计划完成</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
      ${data.items.map(x => `<tr>
        <td class="code">${esc(x.code)}</td>
        <td>${esc(x.deliverableName)}<div class="muted">${esc(x.deliverableCode)}</div></td>
        <td><strong>${esc(x.reason)}</strong><div class="muted text-wrap">${esc(x.content)}</div></td>
        <td>${esc(x.applicant)} / ${esc(x.responsiblePerson)}</td>
        <td>${statusBadge(x.status)}</td>
        <td>${esc(x.reviewer || '—')}<div class="muted text-wrap">${esc(x.reviewOpinion || '')}</div></td>
        <td>${esc(fmtDateOnly(x.plannedCompletionDate))}</td><td>${esc(fmtDate(x.updatedAt))}</td>
        <td><div class="inline-actions">${changeActionButtons(x)}</div></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">暂无变更记录</div>'}
    </div>
  </section>`;

  if (hasPermission('CHANGE_CREATE')) byId('new-change').onclick = openChangeForm;
  byId('export-changes').onclick = () => openCsvExport('changes', { status: state.changeStatusFilter || null });
  byId('change-status-filter').onchange = event => { state.changeStatusFilter = event.target.value; renderChanges(); };
  document.querySelectorAll('[data-change-action]').forEach(btn => btn.onclick = () => runChangeAction(btn));
}

function changeActionButtons(x) {
  const buttons = [];
  if (x.status === 'PENDING_ASSESSMENT' && hasPermission('CHANGE_APPROVE')) {
    buttons.push(['approve', '批准', 'btn-primary'], ['reject', '驳回', 'btn-danger']);
  }
  if (x.status === 'APPROVED' && hasPermission('CHANGE_START')) buttons.push(['start', '开始实施', 'btn-light']);
  if (x.status === 'IMPLEMENTING' && hasPermission('CHANGE_VERIFY')) buttons.push(['verify', '提交验证', 'btn-light']);
  if (x.status === 'PENDING_VERIFICATION' && hasPermission('CHANGE_CLOSE')) buttons.push(['close', '确认关闭', 'btn-primary']);
  return buttons.map(([action, label, cls]) => `<button type="button" class="btn ${cls} btn-sm" data-change-action="${action}" data-change-id="${x.id}">${label}</button>`).join('') || '<span class="muted">—</span>';
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
    <div class="field"><label>提出人</label><input value="${esc(operatorName())}" disabled></div>
    <div class="field"><label>责任人 *</label><input name="responsiblePerson" required></div>
    <div class="field"><label>计划完成日期</label><input type="date" name="plannedCompletionDate"></div>
  </div></form>`;
  showModal('发起变更', body, { submitText: '提交变更', onSubmit: async close => {
    const form = byId('change-form');
    if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
    const f = new FormData(form);
    await api('/internal/changes', { method: 'POST', body: JSON.stringify({
      deliverableId: Number(f.get('deliverableId')), changeType: f.get('changeType'),
      changeReason: f.get('changeReason'), changeContent: f.get('changeContent'), impactScope: f.get('impactScope'),
      relatedIssueCode: f.get('relatedIssueCode'), responsiblePerson: f.get('responsiblePerson'),
      plannedCompletionDate: f.get('plannedCompletionDate') || null
    }) });
    close(); toast('变更已发起'); await renderChanges();
  }});
}

async function runChangeAction(button) {
  const id = Number(button.dataset.changeId);
  const action = button.dataset.changeAction;
  const config = {
    approve: ['批准变更', '确认批准该变更进入实施阶段吗？', '评审意见', true, '确认批准'],
    reject: ['驳回变更', '确认驳回该变更吗？', '驳回原因', true, '确认驳回'],
    start: ['开始实施', '确认将该变更标记为实施中吗？', '', false, '开始实施'],
    verify: ['提交验证', '确认实施已完成并提交验证吗？', '', false, '提交验证'],
    close: ['关闭变更', '确认验证通过并关闭该变更吗？', '验证结论', false, '确认关闭']
  }[action];
  if (!config) return;
  const [title, message, inputLabel, required, submitText] = config;
  const result = await confirmAction(title, message, { inputLabel, inputRequired: required, submitText, danger: action === 'reject' });
  if (!result.confirmed) return;
  button.disabled = true;
  try {
    await api(`/internal/changes/${id}/${action}`, { method: 'POST', body: JSON.stringify({ opinion: result.value || null }) });
    toast('变更状态已更新'); await renderChanges();
  } catch (error) {
    toast(error.message, 'error'); button.disabled = false;
  }
}

async function renderSettings() {
  setPage('基础设置', '项目基础数据、运行状态、备份及审计信息');
  const health = await api('/internal/system/health');
  let auditHtml = '';
  if (hasPermission('AUDIT_VIEW')) {
    const audit = await api('/internal/system/audit-logs?limit=30');
    auditHtml = `<section class="card"><div class="card-head"><h3>最近操作日志</h3><span class="muted">最近 ${audit.items.length} 条</span></div><div class="table-wrap">
      ${audit.items.length ? `<table><thead><tr><th>时间</th><th>操作人</th><th>对象</th><th>动作</th><th>摘要</th></tr></thead><tbody>${audit.items.map(x => `<tr><td>${esc(fmtDate(x.createdAt))}</td><td>${esc(x.operatorName)}</td><td>${esc(x.entityType)} #${esc(x.entityId ?? '—')}</td><td class="code">${esc(x.actionType)}</td><td>${esc(x.summary)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无日志</div>'}
    </div></section>`;
  }
  content.innerHTML = `<section class="dashboard-grid">
    <div class="card"><div class="card-head"><h3>运行状态</h3><span class="badge released">运行正常</span></div><div class="card-body"><div class="kv-list">
      <div>应用名称</div><div>${esc(health.application)}</div><div>SQLite版本</div><div>${esc(health.sqliteVersion)}</div><div>数据库路径</div><div class="code">${esc(health.databasePath)}</div><div>系统时间</div><div>${esc(health.time)}</div>
    </div>${hasPermission('SYSTEM_BACKUP') ? '<div style="margin-top:14px"><button type="button" id="manual-backup" class="btn btn-primary">立即备份数据库</button></div>' : ''}</div></div>
    <div class="card"><div class="card-head"><h3>项目/车型</h3>${hasPermission('MASTERDATA_EDIT') ? '<button type="button" id="new-project" class="btn btn-primary btn-sm">+ 新增项目</button>' : ''}</div><div class="card-body recent-list">
      ${state.master.projects.map(x => `<div class="recent-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.code)}</small></div><span class="badge active">启用</span></div>`).join('')}
    </div></div>
  </section>${auditHtml}`;
  if (hasPermission('SYSTEM_BACKUP')) byId('manual-backup').onclick = async () => { try { const result = await api('/internal/system/backup', { method: 'POST' }); toast(result.message); } catch (error) { toast(error.message, 'error'); } };
  if (hasPermission('MASTERDATA_EDIT')) byId('new-project').onclick = openProjectForm;
}

function openProjectForm() {
  const body = `<form id="project-form"><div class="form-grid"><div class="field"><label>项目编码 *</label><input name="projectCode" required placeholder="A10"></div><div class="field"><label>项目名称 *</label><input name="projectName" required></div><div class="field"><label>车型</label><input name="vehicleModel"></div><div class="field"><label>平台</label><input name="platformName"></div></div></form>`;
  showModal('新增项目/车型', body, { small: true, submitText: '新增', onSubmit: async close => {
    const form = byId('project-form'); if (!form.reportValidity()) throw new Error('请填写项目编码和名称。');
    const f = new FormData(form);
    await api('/internal/master-data/projects', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
    state.master = null; await loadMaster(); close(); toast('项目已新增'); await renderSettings();
  }});
}

async function copyText(value) {
  try { await navigator.clipboard.writeText(value || ''); toast('路径已复制'); }
  catch { window.prompt('请复制以下路径：', value || ''); }
}
