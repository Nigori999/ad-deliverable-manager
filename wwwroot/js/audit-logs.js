const auditLogState = {
  page: 1,
  pageSize: 50,
  keyword: '',
  operatorName: '',
  entityType: '',
  actionType: '',
  entityId: '',
  startDate: '',
  endDate: ''
};

function auditLogDateToIso(dateValue, nextDay = false) {
  if (!dateValue) return '';
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function auditLogSelectOptions(items, selected, emptyLabel) {
  return `<option value="">${esc(emptyLabel)}</option>${(items || []).map(x => `<option value="${esc(x)}" ${x === selected ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
}

async function renderAuditLogs() {
  setPage('操作日志', '查询系统关键操作记录，不受业务数据范围限制');
  const params = new URLSearchParams({
    page: String(auditLogState.page),
    pageSize: String(auditLogState.pageSize)
  });
  if (auditLogState.keyword) params.set('keyword', auditLogState.keyword);
  if (auditLogState.operatorName) params.set('operatorName', auditLogState.operatorName);
  if (auditLogState.entityType) params.set('entityType', auditLogState.entityType);
  if (auditLogState.actionType) params.set('actionType', auditLogState.actionType);
  if (auditLogState.entityId) params.set('entityId', auditLogState.entityId);
  if (auditLogState.startDate) params.set('startTime', auditLogDateToIso(auditLogState.startDate));
  if (auditLogState.endDate) params.set('endTime', auditLogDateToIso(auditLogState.endDate, true));

  const data = await api(`/internal/system/audit-logs?${params}`);
  auditLogState.page = data.page || 1;
  auditLogState.pageSize = data.pageSize || auditLogState.pageSize;
  const options = data.filterOptions || {};
  const hasFilters = Boolean(auditLogState.keyword || auditLogState.operatorName || auditLogState.entityType || auditLogState.actionType || auditLogState.entityId || auditLogState.startDate || auditLogState.endDate);
  const totalPages = data.totalPages || 0;

  content.innerHTML = `
    <section class="card">
      <div class="card-head"><div><h3>操作日志</h3><p class="muted section-note">记录系统关键业务操作，可按时间、操作人、对象和动作组合查询。</p></div><span class="badge">${data.total} 条</span></div>
      <form id="audit-log-filter-form">
        <div class="form-grid">
          <div class="field"><label>开始日期</label><input type="date" name="startDate" value="${esc(auditLogState.startDate)}"></div>
          <div class="field"><label>结束日期</label><input type="date" name="endDate" value="${esc(auditLogState.endDate)}"></div>
          <div class="field"><label>操作人</label><select name="operatorName">${auditLogSelectOptions(options.operators, auditLogState.operatorName, '全部操作人')}</select></div>
          <div class="field"><label>对象类型</label><select name="entityType">${auditLogSelectOptions(options.entityTypes, auditLogState.entityType, '全部对象类型')}</select></div>
          <div class="field"><label>动作类型</label><select name="actionType">${auditLogSelectOptions(options.actionTypes, auditLogState.actionType, '全部动作')}</select></div>
          <div class="field"><label>对象ID</label><input type="number" min="1" name="entityId" value="${esc(auditLogState.entityId)}" placeholder="如 123"></div>
          <div class="field span-2"><label>关键词</label><input name="keyword" value="${esc(auditLogState.keyword)}" placeholder="搜索摘要、操作人、对象类型或动作"></div>
        </div>
        <div class="inline-actions" style="margin-top:14px">
          <button type="submit" class="btn btn-primary">查询</button>
          <button type="button" id="audit-log-reset" class="btn btn-light" ${hasFilters ? '' : 'disabled'}>重置</button>
        </div>
      </form>
    </section>
    <section class="card">
      <div class="card-head">
        <div><h3>查询结果</h3><span class="muted">${data.total ? `第 ${data.page} / ${totalPages} 页` : '暂无匹配记录'}</span></div>
        <div class="inline-actions"><label class="muted" for="audit-log-page-size">每页</label><select id="audit-log-page-size"><option value="20" ${data.pageSize === 20 ? 'selected' : ''}>20</option><option value="50" ${data.pageSize === 50 ? 'selected' : ''}>50</option><option value="100" ${data.pageSize === 100 ? 'selected' : ''}>100</option></select></div>
      </div>
      <div class="table-wrap">${data.items.length ? `<table><thead><tr><th>时间</th><th>操作人</th><th>对象</th><th>动作</th><th>摘要</th></tr></thead><tbody>${data.items.map(x => `<tr><td>${esc(fmtDate(x.createdAt))}</td><td>${esc(x.operatorName)}</td><td>${esc(x.entityType)}${x.entityId == null ? '' : ` #${esc(x.entityId)}`}</td><td class="code">${esc(x.actionType)}</td><td>${esc(x.summary)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">没有符合查询条件的操作日志</div>'}</div>
      <div class="card-head" style="margin-top:12px">
        <span class="muted">共 ${data.total} 条</span>
        <div class="inline-actions"><button type="button" id="audit-log-prev" class="btn btn-light btn-sm" ${data.page <= 1 || !data.total ? 'disabled' : ''}>上一页</button><button type="button" id="audit-log-next" class="btn btn-light btn-sm" ${!data.total || data.page >= totalPages ? 'disabled' : ''}>下一页</button></div>
      </div>
    </section>`;

  byId('audit-log-filter-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    auditLogState.keyword = String(form.get('keyword') || '').trim();
    auditLogState.operatorName = String(form.get('operatorName') || '');
    auditLogState.entityType = String(form.get('entityType') || '');
    auditLogState.actionType = String(form.get('actionType') || '');
    auditLogState.entityId = String(form.get('entityId') || '').trim();
    auditLogState.startDate = String(form.get('startDate') || '');
    auditLogState.endDate = String(form.get('endDate') || '');
    if (auditLogState.startDate && auditLogState.endDate && auditLogState.startDate > auditLogState.endDate) {
      toast('结束日期不能早于开始日期。', 'error');
      return;
    }
    auditLogState.page = 1;
    await renderAuditLogs();
  };
  byId('audit-log-reset').onclick = async () => {
    Object.assign(auditLogState, { page: 1, keyword: '', operatorName: '', entityType: '', actionType: '', entityId: '', startDate: '', endDate: '' });
    await renderAuditLogs();
  };
  byId('audit-log-page-size').onchange = async event => {
    auditLogState.pageSize = Number(event.target.value) || 50;
    auditLogState.page = 1;
    await renderAuditLogs();
  };
  byId('audit-log-prev').onclick = async () => {
    if (auditLogState.page <= 1) return;
    auditLogState.page -= 1;
    await renderAuditLogs();
  };
  byId('audit-log-next').onclick = async () => {
    if (!totalPages || auditLogState.page >= totalPages) return;
    auditLogState.page += 1;
    await renderAuditLogs();
  };
}
