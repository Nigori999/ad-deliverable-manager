const uxOriginalRenderDeliverableDetail = renderDeliverableDetail;
renderDeliverableDetail = async function(id) {
  await uxOriginalRenderDeliverableDetail(id);
  if (!hasPermission('DELIVERY_EDIT')) return;
  try {
    const data = await api(`/internal/deliverables/${id}`);
    const versions = data.versions || [];
    const canDelete = versions.length > 0 && versions.every(v => v.status === 'DRAFT');
    if (!canDelete) return;
    const actions = document.querySelector('.detail-title .inline-actions');
    if (!actions || actions.querySelector('[data-delete-draft-deliverable]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-danger';
    button.dataset.deleteDraftDeliverable = String(id);
    button.textContent = '删除草稿';
    button.title = '仅删除尚未进入审批、发布、变更或关联流程的草稿交付物';
    button.onclick = async () => {
      const result = await confirmAction('删除草稿交付物', `确认永久删除“${data.deliverable.name}”及其全部草稿版本吗？此操作不可恢复。`, { submitText: '确认删除', danger: true });
      if (!result.confirmed) return;
      try {
        await api(`/internal/draft-deletions/deliverables/${id}`, { method: 'DELETE' });
        toast('草稿交付物已删除');
        location.hash = '#/deliverables';
      } catch (error) { toast(error.message, 'error'); }
    };
    actions.appendChild(button);
  } catch { /* detail page itself has already rendered; deletion enhancement can fail silently */ }
};

const uxOriginalChangeActionButtons = changeActionButtons;
changeActionButtons = function(change) {
  let html = uxOriginalChangeActionButtons(change);
  if (change.status === 'PENDING_ASSESSMENT' && hasPermission('CHANGE_EDIT')) {
    const deleteButton = `<button type="button" class="btn btn-danger btn-sm delete-change-draft" data-change-id="${change.id}">删除</button>`;
    html = html.includes('<span class="muted">—</span>') ? deleteButton : html + deleteButton;
  }
  return html;
};

const uxOriginalRenderChanges = renderChanges;
renderChanges = async function() {
  await uxOriginalRenderChanges();
  document.querySelectorAll('.delete-change-draft').forEach(button => button.onclick = async () => {
    const id = Number(button.dataset.changeId);
    const result = await confirmAction('删除待评估变更', '该变更尚未进入评审处理。确认永久删除这条初始变更记录吗？此操作不可恢复。', { submitText: '确认删除', danger: true });
    if (!result.confirmed) return;
    button.disabled = true;
    try {
      await api(`/internal/draft-deletions/changes/${id}`, { method: 'DELETE' });
      toast('待评估变更已删除');
      await renderChanges();
    } catch (error) { button.disabled = false; toast(error.message, 'error'); }
  });
};

const uxOriginalRenderProductBaselines = renderProductBaselines;
renderProductBaselines = async function() {
  await uxOriginalRenderProductBaselines();
  if (!hasPermission('BASELINE_EDIT')) return;
  try {
    const data = await api('/internal/product-baselines');
    for (const baseline of data.items || []) {
      if (baseline.status !== 'DRAFT') continue;
      const edit = document.querySelector(`[data-baseline-edit="${baseline.id}"]`);
      const actions = edit?.closest('.inline-actions');
      if (!actions || actions.querySelector(`[data-baseline-delete="${baseline.id}"]`)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-danger btn-sm';
      button.dataset.baselineDelete = String(baseline.id);
      button.textContent = '删除';
      button.onclick = () => deleteBaselineDraft(baseline);
      actions.appendChild(button);
    }
  } catch (error) { toast(`草稿操作加载失败：${error.message}`, 'error'); }
};

async function deleteBaselineDraft(baseline) {
  const result = await confirmAction('删除产品基线草稿', `确认永久删除“${baseline.productName} ${baseline.version}”吗？草稿中的硬件配置和关联交付物快照也会一并删除。`, { submitText: '确认删除', danger: true });
  if (!result.confirmed) return;
  try {
    await api(`/internal/draft-deletions/product-baselines/${baseline.id}`, { method: 'DELETE' });
    toast('产品基线草稿已删除');
    await renderProductBaselines();
  } catch (error) { toast(error.message, 'error'); }
}

baselineSoftwareOptions = function(options = [], category = '', selectedId = 0) {
  const list = options.filter(x => !category || String(x.hardwareCategory || '') === String(category));
  return list.map(x => `<option value="${x.id}" data-category="${baselineEsc(x.hardwareCategory || '')}" data-model="${baselineEsc(x.hardwareModel || '')}" ${Number(x.id) === Number(selectedId) ? 'selected' : ''}>${baselineEsc(x.name)} · ${baselineEsc(x.version)}${x.hardwareModel ? ` · ${baselineEsc(x.hardwareModel)}` : ''}</option>`).join('');
};

baselineDocumentSelect = function(role, versionId, options) {
  const expected = role === 'TEST_REPORT' ? 'TR' : role;
  const list = options.filter(x => x.typeCode === expected);
  return `<div class="field baseline-doc-field"><label>${baselineRoleNames[role] || role}</label><select name="doc_${role}"><option value="">未关联</option>${list.map(x => `<option value="${x.id}" ${Number(x.id) === Number(versionId) ? 'selected' : ''}>${baselineEsc(x.categoryName || '未分类')} · ${baselineEsc(x.name)} · ${baselineEsc(x.version)}</option>`).join('')}</select><small>可选，只展示已发布或已替代版本</small></div>`;
};

baselineHardwareRow = function(index, category = '', model = '', versionId = 0, options = []) {
  return `<div class="baseline-hardware-row" data-index="${index}"><div class="baseline-row-index">${index + 1}</div><div class="baseline-row-fields"><div class="field"><label>硬件类别 *</label><select name="hardwareCategory" required><option value="">请选择硬件类别</option>${baselineCategoryOptions(category)}</select></div><div class="field"><label>软件包版本 *</label><select name="softwareVersionId" required><option value="">${category ? '请选择对应软件包' : '请先选择硬件类别'}</option>${baselineSoftwareOptions(options, category, versionId)}</select></div><div class="field"><label>硬件型号</label><input name="hardwareModel" value="${baselineEsc(model)}" placeholder="选择软件包后可自动带出"></div></div><button type="button" class="btn btn-light btn-sm remove-baseline-hardware baseline-row-remove">移除</button></div>`;
};

baselineModalForm = function(detail, options) {
  const hardware = detail?.hardware || [];
  const docs = detail?.deliverables || [];
  const hardwareOptions = options.hardware || [];
  const documentOptions = options.documents || [];
  const selectedDocs = Object.fromEntries(docs.map(x => [x.roleCode, x.versionId]));
  const hardwareRows = hardware.length ? hardware.map((x, i) => baselineHardwareRow(i, x.hardwareCategory, x.hardwareModel, x.softwareVersionId, hardwareOptions)).join('') : baselineHardwareRow(0, '', '', 0, hardwareOptions);
  const version = detail?.baseline?.internalVersion || 'V1.0.0';
  return `<form id="baseline-form" class="baseline-form">
    <div class="baseline-form-intro"><div><span class="baseline-kicker">产品版本基线</span><strong>${baselineEsc(version)}</strong></div><p>按“产品信息 → 硬件软件包 → 关联交付物”完成基线快照。带 * 的项目为发布前必填。</p></div>
    <section class="baseline-panel"><div class="baseline-panel-head"><div class="baseline-step">01</div><div><h4>产品与适用范围</h4><p>描述这个版本面向的车型、运行设计域和核心能力。</p></div></div><div class="baseline-panel-body"><div class="form-grid"><div class="field"><label>产品名称 *</label><input name="productName" value="${baselineEsc(detail?.baseline?.productName || '智驾产品')}" required maxlength="80"></div><div class="field"><label>产品版本</label><input value="${baselineEsc(version)}" readonly class="baseline-readonly"></div><div class="field span-2"><label>说明</label><textarea name="description" rows="2" placeholder="简要说明该版本定位或关键变化">${baselineEsc(detail?.baseline?.description || '')}</textarea></div><div class="field"><label>车型</label><input name="vehicleModels" value="${baselineEsc(detail?.baseline?.vehicleModels || '')}" placeholder="如：A10、A10 Pro"></div><div class="field"><label>ODD</label><textarea name="odd" rows="3" placeholder="道路、区域、速度、天气等适用范围">${baselineEsc(detail?.baseline?.odd || '')}</textarea></div><div class="field span-2"><label>智驾能力</label><textarea name="capabilities" rows="3" placeholder="如：高速NOA、城区NOA、APA">${baselineEsc(detail?.baseline?.capabilities || '')}</textarea></div></div></div></section>
    <section class="baseline-panel"><div class="baseline-panel-head"><div class="baseline-step">02</div><div><h4>硬件配置与软件包 *</h4><p>每个硬件类别只能配置一个软件包；切换类别后只显示该类别可用版本。</p></div><button type="button" class="btn btn-light btn-sm baseline-add" id="add-baseline-hardware">+ 添加硬件</button></div><div class="baseline-panel-body"><div id="baseline-hardware-list" class="baseline-hardware-list">${hardwareRows}</div></div></section>
    <section class="baseline-panel"><div class="baseline-panel-head"><div class="baseline-step">03</div><div><h4>关联交付物</h4><p>用于形成完整产品快照，可按需关联 PRD、FR、测试用例和测试报告。</p></div></div><div class="baseline-panel-body"><div id="baseline-document-list" class="baseline-doc-grid">${baselineDocumentSelect('PRD', selectedDocs.PRD || 0, documentOptions)}${baselineDocumentSelect('FR', selectedDocs.FR || 0, documentOptions)}${baselineDocumentSelect('TC', selectedDocs.TC || 0, documentOptions)}${baselineDocumentSelect('TEST_REPORT', selectedDocs.TEST_REPORT || selectedDocs.TR || 0, documentOptions)}</div></div></section>
    <input type="hidden" name="revision" value="${detail?.baseline?.revision || 1}">
  </form>`;
};

openBaselineDetail = async function(id) {
  const detail = await api(`/internal/product-baselines/${id}`);
  const b = detail.baseline;
  const hardwareCount = detail.hardware?.length || 0;
  const documentCount = detail.deliverables?.length || 0;
  const changes = detail.changes || [];
  const hardwareHtml = hardwareCount ? `<div class="baseline-detail-table"><table><thead><tr><th>类别</th><th>硬件型号</th><th>软件包</th><th>版本</th></tr></thead><tbody>${detail.hardware.map(x => `<tr><td><span class="baseline-category-chip">${baselineEsc(baselineCategoryName(x.hardwareCategory))}</span></td><td>${baselineEsc(x.hardwareModel || '—')}</td><td><strong>${baselineEsc(x.softwareName)}</strong></td><td class="code">${baselineEsc(x.softwareVersion)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="baseline-empty-compact">暂未配置硬件软件包</div>';
  const docsHtml = documentCount ? `<div class="baseline-detail-table"><table><thead><tr><th>交付物类型</th><th>名称</th><th>版本</th></tr></thead><tbody>${detail.deliverables.map(x => `<tr><td>${baselineEsc(baselineRoleNames[x.roleCode] || x.typeName)}</td><td><strong>${baselineEsc(x.name)}</strong></td><td class="code">${baselineEsc(x.version)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="baseline-empty-compact">未关联辅助交付物</div>';
  const changeHtml = changes.length ? `<div class="baseline-change-list">${changes.map(x => `<article><div><strong>${baselineEsc(x.changeReason)}</strong><span>${baselineEsc(fmtDate(x.createdAt))}</span></div><p>${baselineEsc(x.description || '无补充说明')}</p><small>操作人：${baselineEsc(x.operatorName)}</small></article>`).join('')}</div>` : '<div class="baseline-empty-compact">暂无基线变更记录</div>';
  const body = `<div class="baseline-detail-shell"><div class="baseline-detail-hero"><div><span class="baseline-kicker">${baselineEsc(b.productName)}</span><h2>${baselineEsc(b.internalVersion)}</h2><p>${baselineEsc(b.description || '暂无版本说明')}</p></div><div class="baseline-hero-status">${baselineStatusBadge(b.versionStatus)}</div></div><div class="baseline-summary-grid"><div><span>适用车型</span><strong>${baselineEsc(b.vehicleModels || '—')}</strong></div><div><span>硬件配置</span><strong>${hardwareCount} 项</strong></div><div><span>关联交付物</span><strong>${documentCount} 项</strong></div><div><span>发布时间</span><strong>${baselineEsc(b.releaseDate ? fmtDate(b.releaseDate) : '尚未发布')}</strong></div></div><section class="baseline-detail-section"><div class="baseline-detail-section-head"><h4>ODD 与智驾能力</h4><span>产品适用范围</span></div><div class="baseline-scope-grid"><div><span>ODD</span><p>${baselineEsc(b.odd || '—')}</p></div><div><span>智驾能力</span><p>${baselineEsc(b.capabilities || '—')}</p></div></div></section><section class="baseline-detail-section"><div class="baseline-detail-section-head"><h4>硬件及软件包</h4><span>${hardwareCount} 项配置</span></div>${hardwareHtml}</section><section class="baseline-detail-section"><div class="baseline-detail-section-head"><h4>关联交付物</h4><span>${documentCount} 项关联</span></div>${docsHtml}</section><section class="baseline-detail-section"><div class="baseline-detail-section-head"><h4>变更记录</h4><span>${changes.length} 条记录</span></div>${changeHtml}</section></div>`;
  showModal(`产品基线详情 · ${b.internalVersion}`, body, { submitText: '关闭', onSubmit: async close => close() });
};
