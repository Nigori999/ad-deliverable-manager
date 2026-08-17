const changeTypeNames = { CONTENT_CHANGE: '内容变更', VERSION_CHANGE: '版本变更', PATH_CHANGE: '路径变更', SECURITY_CHANGE: '权限属性变更' };

function changeActionButtons(change) {
  const buttons = [];
  if (change.status === 'PENDING_ASSESSMENT' && hasPermission('CHANGE_APPROVE')) buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-change-action="approve" data-change-id="${change.id}" data-permission="CHANGE_APPROVE">批准</button>`);
  if (change.status === 'PENDING_ASSESSMENT' && hasPermission('CHANGE_REJECT')) buttons.push(`<button type="button" class="btn btn-danger btn-sm" data-change-action="reject" data-change-id="${change.id}" data-permission="CHANGE_REJECT">驳回</button>`);
  if (change.status === 'APPROVED' && hasPermission('CHANGE_START')) buttons.push(`<button type="button" class="btn btn-light btn-sm" data-change-action="start" data-change-id="${change.id}" data-permission="CHANGE_START">开始实施</button>`);
  if (change.status === 'IMPLEMENTING' && hasPermission('CHANGE_EDIT') && !change.toVersionId) buttons.push(`<button type="button" class="btn btn-primary btn-sm create-change-version" data-change-id="${change.id}" data-permission="CHANGE_EDIT">创建变更版本</button>`);
  if (change.status === 'IMPLEMENTING' && hasPermission('CHANGE_VERIFY') && change.toVersionId) buttons.push(`<button type="button" class="btn btn-light btn-sm" data-change-action="verify" data-change-id="${change.id}" data-permission="CHANGE_VERIFY">提交验证</button>`);
  if (change.status === 'PENDING_VERIFICATION' && hasPermission('CHANGE_CLOSE')) buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-change-action="close" data-change-id="${change.id}" data-permission="CHANGE_CLOSE">确认关闭</button>`);
  if (change.toVersionId) buttons.push(`<a class="btn btn-light btn-sm" href="#/deliverables/${change.deliverableId}">查看版本</a>`);
  return buttons.join('') || '<span class="muted">—</span>';
}

async function renderChanges() {
  setPage('变更管理', '变更记录与交付物前后版本形成闭环');
  const status = state.changeStatusFilter || '';
  const data = await api(`/internal/change-workflow${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  const statusOptions = ['', 'PENDING_ASSESSMENT', 'APPROVED', 'REJECTED', 'IMPLEMENTING', 'PENDING_VERIFICATION', 'CLOSED'];
  content.innerHTML = `<section class="card"><div class="card-head"><div class="toolbar">${hasPermission('CHANGE_CREATE') ? '<button type="button" id="new-change" class="btn btn-primary" data-permission="CHANGE_CREATE">+ 发起变更</button>' : ''}<button type="button" id="export-changes" class="btn btn-light">导出CSV</button><label class="inline-filter">状态<select id="change-status-filter">${statusOptions.map(x => `<option value="${x}" ${x === status ? 'selected' : ''}>${x ? statusNames[x] : '全部'}</option>`).join('')}</select></label></div><span class="muted">共 ${data.items.length} 项</span></div><div class="table-wrap">${data.items.length ? `<table><thead><tr><th>变更编号</th><th>交付物</th><th>变更内容</th><th>版本链路</th><th>提出/责任人</th><th>状态</th><th>评审</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${data.items.map(x => `<tr><td><span class="code">${esc(x.code)}</span><div class="muted">${esc(changeTypeNames[x.changeType] || x.changeType)}</div></td><td><a href="#/deliverables/${x.deliverableId}"><strong>${esc(x.deliverableName)}</strong><div class="muted">${esc(x.deliverableCode)}</div></a></td><td><strong>${esc(x.reason)}</strong><div class="muted text-wrap">${esc(x.content)}</div></td><td><span class="timeline-version"><span>${esc(x.fromVersion || '无正式版本')}</span><span>→</span><strong>${esc(x.toVersion || '尚未创建')}</strong></span>${x.toVersionStatus ? `<div>${statusBadge(x.toVersionStatus)}</div>` : ''}</td><td>${esc(x.applicant)} / ${esc(x.responsiblePerson)}</td><td>${statusBadge(x.status)}</td><td>${esc(x.reviewer || '—')}<div class="muted text-wrap">${esc(x.reviewOpinion || '')}</div></td><td>${esc(fmtDate(x.updatedAt))}</td><td><div class="inline-actions">${changeActionButtons(x)}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无变更记录</div>'}</div></section>`;
  byId('new-change')?.addEventListener('click', () => openChangeForm());
  byId('export-changes').onclick = () => openCsvExport('changes', { status: state.changeStatusFilter || null });
  byId('change-status-filter').onchange = event => { state.changeStatusFilter = event.target.value; renderChanges(); };
  document.querySelectorAll('[data-change-action]').forEach(button => button.onclick = () => handleChangeAction(button, data.items));
  document.querySelectorAll('.create-change-version').forEach(button => button.onclick = () => {
    const change = data.items.find(x => x.id === Number(button.dataset.changeId));
    if (!change || !hasPermission('CHANGE_EDIT')) return;
    openVersionForm(change.deliverableId, change.typeCode, { changeId: change.id, changeSummary: `变更${change.code}：${change.reason}\n${change.content}`, returnToChanges: true });
  });
}

async function handleChangeAction(button, items) {
  const changeId = Number(button.dataset.changeId);
  const action = String(button.dataset.changeAction || '').trim().toLowerCase();
  const change = items.find(x => x.id === changeId);
  if (!change) { toast('变更记录不存在，请刷新后重试。', 'error'); return; }
  const permissionByAction = { approve: 'CHANGE_APPROVE', reject: 'CHANGE_REJECT', start: 'CHANGE_START', verify: 'CHANGE_VERIFY', close: 'CHANGE_CLOSE' };
  const permission = permissionByAction[action];
  if (!permission || !hasPermission(permission)) { toast('当前角色没有执行该变更操作的权限。', 'error'); return; }
  let opinion = '';
  if (action === 'approve' || action === 'reject') {
    const result = await promptChangeOpinion(action === 'approve' ? '批准变更' : '驳回变更', action === 'approve' ? '请填写评审意见。' : '请填写驳回原因。');
    if (!result.confirmed) return;
    opinion = result.value.trim();
    if (!opinion) { toast('评审意见不能为空。', 'error'); return; }
  } else {
    const result = await confirmAction(action === 'start' ? '开始实施' : action === 'verify' ? '提交验证' : '确认关闭', `确定对 ${change.code} 执行“${button.textContent.trim()}”吗？`);
    if (!result.confirmed) return;
  }
  button.disabled = true;
  try {
    await api(`/internal/workflow/changes/${changeId}/${action}`, { method: 'POST', body: JSON.stringify({ opinion, toVersionId: change.toVersionId || null }) });
    toast(action === 'approve' ? '变更已批准。' : action === 'reject' ? '变更已驳回。' : '变更状态已更新。');
    await renderChanges();
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
}

function promptChangeOpinion(title, hint) {
  return new Promise(resolve => {
    showModal(title, `<form id="change-opinion-form"><div class="form-hint">${esc(hint)}</div><div class="field"><label>评审意见 *</label><textarea name="opinion" rows="5" required></textarea></div></form>`, {
      submitText: '提交',
      onSubmit: async close => {
        const form = byId('change-opinion-form');
        if (!form.reportValidity()) throw new Error('请填写评审意见。');
        const value = form.elements.opinion.value;
        close();
        resolve({ confirmed: true, value });
      }
    });
  });
}

async function openChangeForm(preselectedDeliverableId = null, preselectedDeliverable = null) {
  if (!hasPermission('CHANGE_CREATE')) { toast('当前角色没有发起变更权限。', 'error'); return; }
  try {
    const list = await api('/internal/deliverables?page=1&pageSize=100');
    const eligible = (list.items || []).filter(item => Boolean(item.currentVersion) && item.versionStatus === 'RELEASED');
    if (!eligible.length) { toast('当前没有已形成正式基线且仍有效的交付物，无法发起变更。', 'error'); return; }
    const selectedId = Number(preselectedDeliverableId) || null;
    if (selectedId && !eligible.some(item => item.id === selectedId)) { toast('该交付物当前没有有效的已发布基线，无法发起变更。', 'error'); return; }
    const deliverableOptions = selectedId
      ? `<option value="${selectedId}" selected>${esc(preselectedDeliverable?.code || '')} · ${esc(preselectedDeliverable?.name || '')}</option>`
      : `<option value="">请选择</option>${eligible.map(item => `<option value="${item.id}">${esc(item.code)} · ${esc(item.name)} · 当前版本 ${esc(item.currentVersion)}</option>`).join('')}`;
    const body = `<form id="change-form"><div class="alert">变更只能基于当前有效的已发布版本发起。提交后系统会自动锁定该版本作为“变更前版本”。</div><div class="form-grid"><div class="field span-2"><label>交付物 *</label><select name="deliverableId" required ${selectedId ? 'disabled' : ''}>${deliverableOptions}</select>${selectedId ? `<input type="hidden" name="deliverableId" value="${selectedId}">` : ''}</div><div class="field"><label>变更类型</label><select name="changeType"><option value="CONTENT_CHANGE">内容变更</option><option value="VERSION_CHANGE">版本变更</option><option value="PATH_CHANGE">路径变更</option><option value="SECURITY_CHANGE">权限属性变更</option></select></div><div class="field"><label>关联需求/问题编号</label><input name="relatedIssueCode"></div><div class="field span-2"><label>变更原因 *</label><textarea name="changeReason" required></textarea></div><div class="field span-2"><label>变更内容 *</label><textarea name="changeContent" required></textarea></div><div class="field span-2"><label>影响范围</label><textarea name="impactScope"></textarea></div><div class="field"><label>提出人</label><input value="${esc(operatorName())}" disabled></div><div class="field"><label>责任人 *</label><input name="responsiblePerson" value="${esc(preselectedDeliverable?.responsiblePerson || '')}" required></div><div class="field"><label>计划完成日期</label><input type="date" name="plannedCompletionDate"></div></div></form>`;
    showModal('发起变更', body, { submitText: '提交变更', onSubmit: async close => {
      const form = byId('change-form');
      if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
      const f = new FormData(form);
      const deliverableId = Number(f.get('deliverableId'));
      await api('/internal/change-workflow', { method: 'POST', body: JSON.stringify({ deliverableId, changeType: f.get('changeType'), changeReason: f.get('changeReason'), changeContent: f.get('changeContent'), impactScope: f.get('impactScope'), relatedIssueCode: f.get('relatedIssueCode'), responsiblePerson: f.get('responsiblePerson'), plannedCompletionDate: f.get('plannedCompletionDate') || null }) });
      close();
      toast('变更已发起并锁定当前正式版本');
      if (selectedId) await renderDeliverableDetail(selectedId);
      else await renderChanges();
    }});
  } catch (error) {
    toast(error.message, 'error');
  }
}
