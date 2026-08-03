async function renderDeliverableDetail(id) {
  setPage('交付物详情', '查看主档、版本、生命周期和关联关系');
  const data = await api(`/internal/deliverables/${id}`);
  const d = data.deliverable;
  content.innerHTML = `
    <div class="detail-title"><div><h2>${esc(d.name)}</h2><div class="detail-meta"><span class="code">${esc(d.code)}</span>${statusBadge(d.lifecycleStatus)}<span class="badge">${esc(d.type)}</span></div></div>
      <div class="inline-actions">${canEdit() ? '<button type="button" class="btn btn-primary" id="add-version">+ 新增版本</button><button type="button" class="btn btn-light" id="archive-deliverable">归档</button>' : ''}</div></div>
    <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>基本信息</h3></div><div class="card-body"><div class="info-grid">
      ${infoItem('所属部门', d.department)}${infoItem('交付物类型', d.type)}${infoItem('项目/车型', d.project)}${infoItem('对象编码', d.objectCode)}
      ${infoItem('业务模块', d.businessModule || '—')}${infoItem('责任人', d.responsiblePerson)}${infoItem('私密等级', confidentialityNames[d.confidentiality] || d.confidentiality)}${infoItem('对外分享', shareNames[d.sharePolicy] || d.sharePolicy)}
    </div>${d.description ? `<p class="muted" style="margin:16px 0 0">${esc(d.description)}</p>` : ''}</div></section>
    <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>版本记录</h3><span class="muted">共 ${data.versions.length} 个版本</span></div><div class="table-wrap">
      ${data.versions.length ? `<table><thead><tr><th>内部版本</th><th>原始版本</th><th>状态</th><th>统一文件名</th><th>服务器路径</th><th>编制/审批</th><th>发布时间</th><th>操作</th></tr></thead><tbody>
        ${data.versions.map(v => `<tr><td><strong>${esc(v.internalVersion)}</strong>${v.isCurrent ? '<div class="badge released">当前</div>' : ''}</td><td>${esc(v.originalVersion || '—')}</td><td>${statusBadge(v.status)}</td>
        <td class="path-cell" title="${esc(v.unifiedFileName)}">${esc(v.unifiedFileName)}</td><td class="path-cell" title="${esc(v.serverPath)}">${esc(v.serverPath)}</td>
        <td>${esc(v.author)}${v.approver ? `<div class="muted">审批：${esc(v.approver)}</div>` : ''}</td><td>${esc(fmtDateOnly(v.releaseDate))}</td>
        <td><div class="inline-actions">${versionActionButtons(v)}<button type="button" class="btn btn-light btn-sm copy-version-path" data-path="${esc(v.serverPath)}">复制路径</button></div></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">暂无版本</div>'}
    </div></section>
    <section class="card"><div class="card-head"><h3>关联交付物</h3><div class="toolbar">${canEdit() ? '<button type="button" id="add-relation" class="btn btn-primary btn-sm">+ 建立关联</button>' : ''}<span id="relation-count" class="muted"></span></div></div><div id="relations-list"><div class="loading">正在加载关联关系…</div></div></section>`;
  if (byId('add-version')) byId('add-version').onclick = () => openVersionForm(id, d.typeCode);
  if (byId('archive-deliverable')) byId('archive-deliverable').onclick = () => archiveDeliverable(id);
  if (byId('add-relation')) byId('add-relation').onclick = () => openRelationForm(id, data.versions);
  document.querySelectorAll('.copy-version-path').forEach(btn => btn.onclick = () => copyText(btn.dataset.path));
  document.querySelectorAll('[data-version-action]').forEach(btn => btn.onclick = () => runVersionAction(id, Number(btn.dataset.versionId), btn.dataset.versionAction, btn));
  await loadRelations(id);
}

function infoItem(label, value) { return `<div class="info-item"><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong></div>`; }

function versionActionButtons(v) {
  if (v.status === 'DRAFT' && canEdit())
    return `<button type="button" class="btn btn-light btn-sm" data-version-action="submit-review" data-version-id="${v.id}">提交审批</button>`;
  if (v.status === 'IN_REVIEW' && canApprove())
    return `<button type="button" class="btn btn-light btn-sm" data-version-action="return-draft" data-version-id="${v.id}">退回修改</button><button type="button" class="btn btn-primary btn-sm" data-version-action="release" data-version-id="${v.id}">审批并发布</button>`;
  if ((v.status === 'RELEASED' || v.status === 'SUPERSEDED') && canApprove())
    return `<button type="button" class="btn btn-danger btn-sm" data-version-action="deprecate" data-version-id="${v.id}">废止</button>`;
  return '';
}

function openVersionForm(deliverableId, typeCode) {
  const body = `<form id="version-form"><div class="form-grid">${commonVersionFields('v_')}</div><div id="type-specific-fields"></div></form>`;
  showModal('新增版本', body, { submitText: '创建草稿版本', onSubmit: async close => {
    const form = byId('version-form'); if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
    const f = new FormData(form); const payload = buildVersionPayload(f, typeCode, 'v_');
    await api(`/internal/deliverables/${deliverableId}/versions`, { method: 'POST', body: JSON.stringify(payload) });
    close(); toast('新版本已创建'); await renderDeliverableDetail(deliverableId);
  }});
  renderTypeFields(typeCode);
}

async function runVersionAction(deliverableId, versionId, action, button) {
  const configs = {
    'submit-review': { title: '提交审批', message: '提交后版本将进入审批中状态，由审批者执行发布或退回。', submitText: '提交审批' },
    'return-draft': { title: '退回修改', message: '确认将该版本退回草稿状态吗？', inputLabel: '退回原因', inputRequired: true, submitText: '确认退回' },
    release: { title: '审批并发布', message: '发布后该版本将成为当前有效版本，原当前版本自动标记为已替代。', inputLabel: '审批意见', inputRequired: true, submitText: '确认发布' },
    deprecate: { title: '废止版本', message: '废止后该版本将被标记为禁止继续使用。', inputLabel: '废止原因', inputRequired: true, submitText: '确认废止', danger: true }
  };
  const config = configs[action];
  const result = await confirmAction(config.title, config.message, config);
  if (!result.confirmed) return;
  button.disabled = true;
  try {
    await api(`/internal/deliverables/versions/${versionId}/${action}`, { method: 'POST', body: JSON.stringify({ reason: result.value }) });
    toast('版本状态已更新'); await renderDeliverableDetail(deliverableId);
  } catch (error) {
    button.disabled = false; toast(error.message, 'error');
  }
}

async function archiveDeliverable(id) {
  const result = await confirmAction('归档交付物', '归档后默认查询将不再显示该交付物，历史记录仍保留。', { inputLabel: '归档原因', inputRequired: true, submitText: '确认归档', danger: true });
  if (!result.confirmed) return;
  await api(`/internal/deliverables/${id}/archive`, { method: 'POST', body: JSON.stringify({ reason: result.value }) });
  toast('交付物已归档'); location.hash = '#/deliverables';
}

async function loadRelations(deliverableId) {
  const data = await api(`/internal/relations/deliverable/${deliverableId}`);
  byId('relation-count').textContent = `共 ${data.items.length} 项`;
  byId('relations-list').innerHTML = data.items.length ? `<div class="table-wrap"><table><thead><tr><th>方向</th><th>源交付物</th><th>关系</th><th>目标交付物</th><th>说明</th><th>操作</th></tr></thead><tbody>
    ${data.items.map(x => `<tr><td>${x.direction === 'OUTGOING' ? '<span class="badge active">当前 → 下游</span>' : '<span class="badge approved">上游 → 当前</span>'}</td>
      <td><a class="table-link" href="#/deliverables/${x.sourceDeliverableId}">${esc(x.sourceCode)}<div class="muted">${esc(x.sourceName)}${x.sourceVersion ? ` · ${esc(x.sourceVersion)}` : ''}</div></a></td>
      <td><span class="relation-arrow">${esc(relationNames[x.relationType] || x.relationType)} →</span></td>
      <td><a class="table-link" href="#/deliverables/${x.targetDeliverableId}">${esc(x.targetCode)}<div class="muted">${esc(x.targetName)}${x.targetVersion ? ` · ${esc(x.targetVersion)}` : ''}</div></a></td>
      <td>${esc(x.description || '—')}</td><td>${canEdit() ? `<button type="button" class="btn btn-danger btn-sm delete-relation" data-id="${x.id}">删除</button>` : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">尚未建立交付物关联关系</div>';
  document.querySelectorAll('.delete-relation').forEach(button => button.onclick = async () => {
    const result = await confirmAction('删除关联', '确认删除该交付物关联关系吗？', { submitText: '确认删除', danger: true });
    if (!result.confirmed) return;
    try { await api(`/internal/relations/${button.dataset.id}`, { method: 'DELETE' }); toast('关联关系已删除'); await loadRelations(deliverableId); }
    catch (error) { toast(error.message, 'error'); }
  });
}

async function openRelationForm(currentId, currentVersions) {
  const candidates = await api(`/internal/relations/candidates?excludeId=${currentId}`);
  if (!candidates.items.length) { toast('没有可关联的其他交付物。', 'error'); return; }
  const currentVersionOptions = `<option value="">交付物级关联</option>${currentVersions.map(x => `<option value="${x.id}">${esc(x.internalVersion)} · ${esc(statusNames[x.status] || x.status)}</option>`).join('')}`;
  const body = `<form id="relation-form"><div class="form-grid">
    <div class="field"><label>当前交付物角色 *</label><select name="direction"><option value="SOURCE">作为源/上游</option><option value="TARGET">作为目标/下游</option></select></div>
    <div class="field"><label>关联类型 *</label><select name="relationType"><option value="DERIVES">派生</option><option value="VERIFIES">验证</option><option value="DEPENDS_ON">依赖</option><option value="REFERENCES">引用</option><option value="REPLACES">替代</option></select></div>
    <div class="field span-2"><label>关联交付物 *</label><select name="otherDeliverableId" required><option value="">请选择</option>${candidates.items.map(x => `<option value="${x.id}">${esc(x.project)} · ${esc(x.type)} · ${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</select></div>
    <div class="field"><label>当前交付物版本</label><select name="currentVersionId">${currentVersionOptions}</select></div>
    <div class="field"><label>关联交付物版本</label><select name="otherVersionId"><option value="">请先选择交付物</option></select></div>
    <div class="field span-2"><label>关系说明</label><textarea name="description" placeholder="说明关联依据、影响范围或依赖关系"></textarea></div>
  </div></form>`;
  showModal('建立交付物关联', body, { submitText: '建立关联', onSubmit: async close => {
    const form = byId('relation-form'); if (!form.reportValidity()) throw new Error('请选择关联交付物。');
    const f = new FormData(form); const currentIsSource = f.get('direction') === 'SOURCE';
    const otherId = Number(f.get('otherDeliverableId'));
    const payload = {
      sourceDeliverableId: currentIsSource ? currentId : otherId,
      sourceVersionId: Number(currentIsSource ? f.get('currentVersionId') : f.get('otherVersionId')) || null,
      targetDeliverableId: currentIsSource ? otherId : currentId,
      targetVersionId: Number(currentIsSource ? f.get('otherVersionId') : f.get('currentVersionId')) || null,
      relationType: f.get('relationType'), description: f.get('description')
    };
    await api('/internal/relations', { method: 'POST', body: JSON.stringify(payload) });
    close(); toast('关联关系已建立'); await loadRelations(currentId);
  }});
  byId('relation-form').elements.otherDeliverableId.onchange = async event => {
    const select = byId('relation-form').elements.otherVersionId;
    if (!event.target.value) { select.innerHTML = '<option value="">请先选择交付物</option>'; return; }
    const data = await api(`/internal/relations/versions/${event.target.value}`);
    select.innerHTML = `<option value="">交付物级关联</option>${data.items.map(x => `<option value="${x.id}">${esc(x.version)} · ${esc(statusNames[x.status] || x.status)}</option>`).join('')}`;
  };
}
