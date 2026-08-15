/* System settings and master-data UI. Change workflow is implemented in v070.js. */

async function renderSettings() {
  setPage('基础设置', '项目基础数据、运行状态、备份及审计信息');
  const health = await api('/internal/system/health');
  let auditHtml = '';
  if (hasPermission('AUDIT_VIEW')) {
    const audit = await api('/internal/system/audit-logs?limit=30');
    auditHtml = `<section class="card"><div class="card-head"><h3>最近操作日志</h3><span class="muted">最近 ${audit.items.length} 条</span></div><div class="table-wrap">${audit.items.length ? `<table><thead><tr><th>时间</th><th>操作人</th><th>对象</th><th>动作</th><th>摘要</th></tr></thead><tbody>${audit.items.map(x => `<tr><td>${esc(fmtDate(x.createdAt))}</td><td>${esc(x.operatorName)}</td><td>${esc(x.entityType)} #${esc(x.entityId ?? '—')}</td><td class="code">${esc(x.actionType)}</td><td>${esc(x.summary)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无日志</div>'}</div></section>`;
  }
  content.innerHTML = `<section class="dashboard-grid">
    <div class="card"><div class="card-head"><h3>运行状态</h3><span class="badge released">运行正常</span></div><div class="card-body"><div class="kv-list"><div>应用名称</div><div>${esc(health.application)}</div><div>SQLite版本</div><div>${esc(health.sqliteVersion)}</div><div>数据库路径</div><div class="code">${esc(health.databasePath)}</div><div>系统时间</div><div>${esc(health.time)}</div></div>${hasPermission('SYSTEM_BACKUP') ? '<div style="margin-top:14px"><button type="button" id="manual-backup" class="btn btn-primary">立即备份数据库</button></div>' : ''}</div></div>
    <div class="card"><div class="card-head"><h3>项目/车型</h3>${hasPermission('MASTERDATA_EDIT') ? '<button type="button" id="new-project" class="btn btn-primary btn-sm">+ 新增项目</button>' : ''}</div><div class="card-body recent-list">${state.master.projects.map(x => `<div class="recent-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.code)}</small></div><span class="badge active">启用</span></div>`).join('')}</div></div>
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
