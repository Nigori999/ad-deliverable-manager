loadDeliverables = async function() {
  const form = byId('deliverable-filters');
  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);
  state.lastDeliverableFilters = Object.fromEntries(params.entries());
  params.set('page', state.deliverablePage); params.set('pageSize', state.deliverablePageSize);
  const data = await api(`/internal/deliverables?${params}`);
  byId('deliverable-total').textContent = `共 ${data.total} 项`;
  byId('deliverable-list').innerHTML = data.items.length ? `<table><thead><tr><th>交付物编码</th><th>统一名称</th><th>类型 / 类别</th><th>项目</th><th>当前版本</th><th>状态</th><th>责任人</th><th>私密/分享</th><th>最近更新</th><th>操作</th></tr></thead><tbody>${data.items.map(x => `<tr><td class="code">${esc(x.code)}</td><td><strong>${esc(x.name)}</strong><div class="muted">对象：${esc(x.objectCode)}</div></td><td>${esc(x.type)}<div class="muted">${esc(x.category)}</div></td><td>${esc(x.project)}</td><td>${esc(x.currentVersion || '—')}</td><td>${statusBadge(x.versionStatus || 'DRAFT')}</td><td>${esc(x.responsiblePerson)}</td><td>${esc(confidentialityNames[x.confidentiality] || x.confidentiality)}<div class="muted">${esc(shareNames[x.sharePolicy] || x.sharePolicy)}</div></td><td>${esc(fmtDate(x.updatedAt))}</td><td><div class="inline-actions"><a class="btn btn-light btn-sm" href="#/deliverables/${x.id}">详情</a><button type="button" class="btn btn-light btn-sm view-change-timeline" data-id="${x.id}">变更记录</button>${x.serverPath ? `<button type="button" class="btn btn-light btn-sm copy-path" data-path="${esc(x.serverPath)}">复制路径</button>` : ''}${x.canDeleteDraft && hasPermission('DELIVERY_EDIT') ? `<button type="button" class="btn btn-danger btn-sm delete-deliverable-draft" data-id="${x.id}">删除</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">没有符合条件的交付物</div>';
  document.querySelectorAll('.copy-path').forEach(btn => btn.onclick = () => copyText(btn.dataset.path));
  document.querySelectorAll('.view-change-timeline').forEach(btn => btn.onclick = () => openChangeTimelineDrawer(data.items.find(x => x.id === Number(btn.dataset.id))));
  document.querySelectorAll('.delete-deliverable-draft').forEach(btn => btn.onclick = async () => {
    const item = data.items.find(x => x.id === Number(btn.dataset.id));
    if (!item) return;
    const result = await confirmAction('删除草稿交付物', `确认永久删除“${item.name}”及其全部草稿版本吗？此操作不可恢复。`, { submitText: '确认删除', danger: true });
    if (!result.confirmed) return;
    btn.disabled = true;
    try { await api(`/internal/draft-deletions/deliverables/${item.id}`, { method: 'DELETE' }); toast('草稿交付物已删除'); await loadDeliverables(); }
    catch (error) { btn.disabled = false; toast(error.message, 'error'); }
  });
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  byId('deliverable-pagination').innerHTML = `<div class="pagination"><button type="button" class="btn btn-light btn-sm" id="prev-page" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${data.page} / ${totalPages} 页</span><button type="button" class="btn btn-light btn-sm" id="next-page" ${data.page >= totalPages ? 'disabled' : ''}>下一页</button></div>`;
  byId('prev-page').onclick = () => { state.deliverablePage--; loadDeliverables(); };
  byId('next-page').onclick = () => { state.deliverablePage++; loadDeliverables(); };
};
