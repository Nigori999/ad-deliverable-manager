statusNames.READY_FOR_RELEASE = '待发布';
permissionFriendly.VERSION_SUPPLEMENT = '补录版本';

function parseSemanticVersion(value) {
  const match = /^V?(\d+)\.(\d+)\.(\d+)$/i.exec(String(value || '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareSemanticVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function highestActiveVersionId(versions) {
  let highest = null;
  for (const version of versions || []) {
    if (version.status === 'DEPRECATED') continue;
    const parsed = parseSemanticVersion(version.internalVersion);
    if (!parsed) continue;
    if (!highest || compareSemanticVersion(parsed, highest.parsed) > 0) highest = { id: version.id, parsed };
  }
  return highest?.id ?? null;
}

async function renderDeliverableDetail(id) {
  setPage('交付物详情', '查看主档、版本、生命周期和关联关系');
  const data = await api(`/internal/deliverables/${id}`);
  const d = data.deliverable;
  const versions = data.versions || [];
  const hasFormalBaseline = versions.some(version =>
    ['RELEASED', 'SUPERSEDED', 'DEPRECATED'].includes(version.status) || Boolean(version.releaseDate));
  const hasCurrentReleasedBaseline = versions.some(version => version.isCurrent && version.status === 'RELEASED');
  const openVersion = versions.find(version => version.status === 'DRAFT' || version.status === 'IN_REVIEW');
  const readyVersions = versions.filter(version => version.status === 'READY_FOR_RELEASE');
  const highestVersionId = highestActiveVersionId(versions);

  const actionButtons = [];
  if (!hasFormalBaseline && hasPermission('VERSION_CREATE')) {
    actionButtons.push(`<button type="button" class="btn btn-primary" id="add-version" data-permission="VERSION_CREATE" ${openVersion ? 'disabled' : ''}>+ 新增迭代版本</button>`);
  }
  if (hasFormalBaseline && hasPermission('CHANGE_CREATE')) {
    actionButtons.push(`<button type="button" class="btn btn-primary" id="start-controlled-change" data-permission="CHANGE_CREATE" ${hasCurrentReleasedBaseline ? '' : 'disabled'}>+ 发起变更</button>`);
  }
  if (hasFormalBaseline && hasPermission('VERSION_SUPPLEMENT')) {
    actionButtons.push(`<button type="button" class="btn btn-light" id="supplement-version" data-permission="VERSION_SUPPLEMENT" ${openVersion ? 'disabled' : ''}>+ 管理员补录版本</button>`);
  }
  if (hasPermission('DELIVERY_ARCHIVE')) {
    actionButtons.push('<button type="button" class="btn btn-light" id="archive-deliverable" data-permission="DELIVERY_ARCHIVE">归档</button>');
  }

  let baselineNotice;
  if (hasFormalBaseline) {
    baselineNotice = `<strong>已形成正式基线：</strong>后续正常修改必须发起变更，经评估、实施、版本发布和验证后关闭。${hasPermission('VERSION_SUPPLEMENT') ? ' “补录版本”仅用于历史数据迁移或特殊纠错。' : ''}`;
  } else if (openVersion) {
    baselineNotice = `<strong>版本流程进行中：</strong>${esc(openVersion.internalVersion)} 当前为“${esc(statusNames[openVersion.status])}”，审批完成前不能创建后续版本。`;
  } else if (readyVersions.length) {
    baselineNotice = '<strong>审批已完成、尚未发布：</strong>可以继续创建后续迭代版本；最终只有版本号最高且处于待发布状态的版本可以正式发布。';
  } else {
    baselineNotice = '<strong>尚未形成正式基线：</strong>当前可以创建迭代版本；草稿或审批中阶段只能存在一个版本。';
  }

  content.innerHTML = `
    <div class="detail-title"><div><h2>${esc(d.name)}</h2><div class="detail-meta"><span class="code">${esc(d.code)}</span>${statusBadge(d.lifecycleStatus)}<span class="badge">${esc(d.type)}</span></div></div>
      <div class="inline-actions">${actionButtons.join('')}</div></div>
    <div class="alert baseline-policy-alert ${hasFormalBaseline ? 'baseline-formed' : openVersion ? 'version-cycle-open' : 'baseline-forming'}">${baselineNotice}</div>
    <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>基本信息</h3></div><div class="card-body"><div class="info-grid">
      ${infoItem('所属部门', d.department)}${infoItem('交付物类型', d.type)}${infoItem('交付物类别', d.category)}${infoItem('类别编码', d.categoryCode)}${infoItem('项目/车型', d.project)}
      ${infoItem('业务模块', d.businessModule || '—')}${infoItem('责任人', d.responsiblePerson)}${infoItem('私密等级', confidentialityNames[d.confidentiality] || d.confidentiality)}${infoItem('对外分享', shareNames[d.sharePolicy] || d.sharePolicy)}
    </div>${d.description ? `<p class="muted" style="margin:16px 0 0">${esc(d.description)}</p>` : ''}</div></section>
    <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>版本记录</h3><span class="muted">共 ${versions.length} 个版本</span></div><div class="table-wrap">
      ${versions.length ? `<table><thead><tr><th>内部版本</th><th>原始版本</th><th>状态</th><th>统一文件名</th><th>服务器路径</th><th>编制/审批</th><th>发布时间</th><th>操作</th></tr></thead><tbody>
        ${versions.map(v => `<tr><td><strong>${esc(v.internalVersion)}</strong>${v.isCurrent ? '<div class="badge released">当前</div>' : ''}</td><td>${esc(v.originalVersion || '—')}</td><td>${statusBadge(v.status)}</td>
        <td class="path-cell" title="${esc(v.unifiedFileName)}">${esc(v.unifiedFileName)}</td><td class="path-cell" title="${esc(v.serverPath)}">${esc(v.serverPath)}</td>
        <td>${esc(v.author)}${v.approver ? `<div class="muted">审批：${esc(v.approver)}</div>` : ''}</td><td>${esc(fmtDateOnly(v.releaseDate))}</td>
        <td><div class="inline-actions"><button type="button" class="btn btn-light btn-sm version-detail-btn" data-version-id="${v.id}">详情</button>${versionActionButtons(v, highestVersionId)}<button type="button" class="btn btn-light btn-sm copy-version-path" data-path="${esc(v.serverPath)}">复制路径</button></div></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">暂无版本</div>'}
    </div></section>
    <section class="card"><div class="card-head"><h3>关联交付物</h3><div class="toolbar">${hasPermission('RELATION_CREATE') ? '<button type="button" id="add-relation" class="btn btn-primary btn-sm" data-permission="RELATION_CREATE">+ 建立关联</button>' : ''}<span id="relation-count" class="muted"></span></div></div><div id="relations-list"><div class="loading">正在加载关联关系…</div></div></section>`;

  const addVersion = byId('add-version');
  if (addVersion) {
    addVersion.title = openVersion ? `当前版本 ${openVersion.internalVersion} 尚未完成审批` : '当前没有草稿或审批中版本，可以创建后续迭代版本';
    if (!openVersion) addVersion.onclick = () => openVersionForm(id, d.typeCode);
  }
  const changeButton = byId('start-controlled-change');
  if (changeButton) {
    changeButton.title = hasCurrentReleasedBaseline ? '基于当前正式版本发起受控变更' : '当前没有有效的已发布版本，无法发起变更';
    if (hasCurrentReleasedBaseline) changeButton.onclick = () => openChangeForm(id, d);
  }
  const supplementButton = byId('supplement-version');
  if (supplementButton) {
    supplementButton.title = openVersion ? `当前版本 ${openVersion.internalVersion} 尚未完成审批，不能继续补录版本` : '仅用于历史数据迁移或特殊纠错';
    if (!openVersion) supplementButton.onclick = () => confirmSupplementVersion(id, d.typeCode);
  }
  byId('archive-deliverable')?.addEventListener('click', () => archiveDeliverable(id));
  byId('add-relation')?.addEventListener('click', () => openRelationForm(id, versions));
  document.querySelectorAll('.copy-version-path').forEach(btn => btn.onclick = () => copyText(btn.dataset.path));
  document.querySelectorAll('[data-version-action]').forEach(btn => btn.onclick = () => runVersionAction(id, Number(btn.dataset.versionId), btn.dataset.versionAction, btn));
  document.querySelectorAll('.version-detail-btn').forEach(btn => btn.onclick = () => openVersionDetails(Number(btn.dataset.versionId)));
  await loadRelations(id);
}

function infoItem(label, value) {
  return `<div class="info-item"><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong></div>`;
}

function versionActionButtons(version, highestVersionId) {
  if (version.status === 'DRAFT' && hasPermission('VERSION_SUBMIT')) {
    return `<button type="button" class="btn btn-light btn-sm" data-version-action="submit-review" data-version-id="${version.id}" data-permission="VERSION_SUBMIT">提交审批</button>`;
  }
  if (version.status === 'IN_REVIEW') {
    const buttons = [];
    if (hasPermission('VERSION_RETURN')) buttons.push(`<button type="button" class="btn btn-light btn-sm" data-version-action="return-draft" data-version-id="${version.id}" data-permission="VERSION_RETURN">退回修改</button>`);
    if (hasPermission('VERSION_APPROVE')) buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-version-action="approve" data-version-id="${version.id}" data-permission="VERSION_APPROVE">审批通过</button>`);
    return buttons.join('');
  }
  if (version.status === 'READY_FOR_RELEASE') {
    const buttons = [];
    if (hasPermission('VERSION_RELEASE')) {
      buttons.push(Number(version.id) === Number(highestVersionId)
        ? `<button type="button" class="btn btn-primary btn-sm" data-version-action="release" data-version-id="${version.id}" data-permission="VERSION_RELEASE">正式发布</button>`
        : '<button type="button" class="btn btn-light btn-sm" disabled title="已存在更高版本，本版本不能正式发布">不可发布</button>');
    }
    if (hasPermission('VERSION_DEPRECATE')) buttons.push(`<button type="button" class="btn btn-danger btn-sm" data-version-action="deprecate" data-version-id="${version.id}" data-permission="VERSION_DEPRECATE">废止</button>`);
    return buttons.join('');
  }
  if ((version.status === 'RELEASED' || version.status === 'SUPERSEDED') && hasPermission('VERSION_DEPRECATE')) {
    return `<button type="button" class="btn btn-danger btn-sm" data-version-action="deprecate" data-version-id="${version.id}" data-permission="VERSION_DEPRECATE">废止</button>`;
  }
  return '';
}

async function runVersionAction(deliverableId, versionId, action, button) {
  const configs = {
    'submit-review': { title: '提交审批', message: '提交后版本进入审批中。审批通过后只进入待发布状态，不会自动成为当前版本。', submitText: '提交审批' },
    'return-draft': { title: '退回修改', message: '确认将该版本退回草稿状态吗？', inputLabel: '退回原因', inputRequired: true, submitText: '确认退回' },
    approve: { title: '审批通过', message: '审批通过后版本进入待发布状态。', inputLabel: '审批意见', inputRequired: true, submitText: '确认通过' },
    release: { title: '正式发布', message: '发布后将形成正式基线，后续正常修改必须走变更流程。', inputLabel: '发布说明', inputRequired: true, submitText: '确认发布' },
    deprecate: { title: '废止版本', message: '废止后该版本不能再正式发布或继续使用，审批及历史记录仍会保留。', inputLabel: '废止原因', inputRequired: true, submitText: '确认废止', danger: true }
  };
  const requiredPermission = {
    'submit-review': 'VERSION_SUBMIT',
    'return-draft': 'VERSION_RETURN',
    approve: 'VERSION_APPROVE',
    release: 'VERSION_RELEASE',
    deprecate: 'VERSION_DEPRECATE'
  }[action];
  const config = configs[action];
  if (!config || !requiredPermission || !hasPermission(requiredPermission)) {
    toast('当前角色没有该操作权限。', 'error');
    return;
  }
  const result = await confirmAction(config.title, config.message, config);
  if (!result.confirmed) return;
  button.disabled = true;
  try {
    await api(`/internal/workflow/versions/${versionId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason: result.value || null })
    });
    toast(action === 'approve' ? '版本审批已通过，当前处于待发布状态' : '版本状态已更新');
    await renderDeliverableDetail(deliverableId);
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
}

async function confirmSupplementVersion(deliverableId, typeCode) {
  if (!hasPermission('VERSION_SUPPLEMENT')) {
    toast('当前角色没有补录版本权限。', 'error');
    return;
  }
  const result = await confirmAction(
    '管理员补录版本',
    '该交付物已经形成正式基线。正常修改必须走变更流程；补录版本仅用于历史数据迁移或特殊纠错。确认继续吗？',
    { submitText: '继续补录', danger: true }
  );
  if (!result.confirmed) return;
  await openSupplementVersionForm(deliverableId, typeCode);
}

async function openSupplementVersionForm(deliverableId, typeCode) {
  const preview = await api(`/internal/versioning/deliverables/${deliverableId}/preview?incrementType=PATCH`);
  const body = `<form id="version-form"><div class="form-grid">${commonVersionFields('v_', 'new', preview)}</div><div id="type-specific-fields"></div></form>`;
  showModal('管理员补录版本', body, {
    submitText: '创建补录版本',
    onSubmit: async close => {
      const form = byId('version-form');
      if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
      const f = new FormData(form);
      const payload = buildVersionPayload(f, typeCode, 'v_');
      await api(`/internal/deliverables/${deliverableId}/versions/supplement`, { method: 'POST', body: JSON.stringify(payload) });
      close();
      toast('补录版本已创建');
      await renderDeliverableDetail(deliverableId);
    }
  });
  renderTypeFields(typeCode);
  byId('version-form').elements.v_incrementType.onchange = async event => {
    try { await refreshVersionPreview(deliverableId, 'v_', event.target.value); }
    catch (error) { toast(error.message, 'error'); }
  };
}

async function openVersionDetails(versionId) {
  try {
    const data = await api(`/internal/version-details/${versionId}`);
    const commonLabels = {
      id: '版本ID', internalVersion: '内部版本号', originalVersion: '原始版本号', originalFileName: '原始文件名',
      unifiedFileName: '统一文件名', previousVersionId: '上一版本ID', serverPath: '服务器路径', fileExtension: '文件格式',
      fileSize: '文件大小', hashAlgorithm: '校验算法', hashValue: '校验值', status: '版本状态', changeSummary: '变更摘要',
      confidentiality: '私密等级', sharePolicy: '对外分享', author: '编制/提供人', reviewer: '评审人', approver: '审批/发布人',
      plannedReleaseDate: '计划发布日期', releaseDate: '正式发布日期', effectiveDate: '生效日期', expiryDate: '失效日期',
      isCurrent: '当前版本', createdBy: '创建人', createdAt: '创建时间', updatedAt: '更新时间', deliverableCode: '交付物编码',
      deliverableName: '交付物名称', typeCode: '交付物类型编码', typeName: '交付物类型', projectCode: '项目编码', projectName: '项目名称'
    };
    const valueText = (key, value) => {
      if (value === null || value === undefined || value === '') return '—';
      if (key === 'status') return statusNames[value] || value;
      if (key === 'confidentiality') return confidentialityNames[value] || value;
      if (key === 'sharePolicy') return shareNames[value] || value;
      if (key === 'isCurrent') return Number(value) === 1 ? '是' : '否';
      if (['createdAt', 'updatedAt', 'plannedReleaseDate', 'releaseDate', 'effectiveDate', 'expiryDate'].includes(key)) return fmtDate(value);
      if (key === 'fileSize') {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes < 0) return String(value);
        if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${bytes} B`;
      }
      return String(value);
    };
    const commonHtml = Object.entries(data.common).map(([key, value]) => `<div class="info-item"><span>${esc(commonLabels[key] || key)}</span><strong>${esc(valueText(key, value))}</strong></div>`).join('');
    const specificHtml = Object.entries(data.specific || {}).map(([key, value]) => `<div class="info-item"><span>${esc(key)}</span><strong>${esc(value === null || value === undefined || value === '' ? '—' : String(value))}</strong></div>`).join('');
    const body = `<div class="version-detail-head"><div><strong>${esc(data.common.internalVersion || '')}</strong> ${statusBadge(data.common.status)}</div><span class="muted">${esc(data.common.deliverableCode || '')} · ${esc(data.common.deliverableName || '')}</span></div><h4 style="margin:18px 0 10px">基础信息</h4><div class="info-grid">${commonHtml}</div>${specificHtml ? `<h4 style="margin:22px 0 10px">${esc(data.common.typeName || '类型专属信息')}</h4><div class="info-grid">${specificHtml}</div>` : ''}`;
    showModal('版本详情', body, { submitText: '关闭', onSubmit: async close => close() });
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function archiveDeliverable(id) {
  if (!hasPermission('DELIVERY_ARCHIVE')) { toast('当前角色没有归档权限。', 'error'); return; }
  const result = await confirmAction('归档交付物', '归档后默认查询将不再显示该交付物，历史记录仍保留。', { inputLabel: '归档原因', inputRequired: true, submitText: '确认归档', danger: true });
  if (!result.confirmed) return;
  await api(`/internal/deliverables/${id}/archive`, { method: 'POST', body: JSON.stringify({ reason: result.value }) });
  toast('交付物已归档');
  location.hash = '#/deliverables';
}

async function loadRelations(deliverableId) {
  const data = await api(`/internal/relations/deliverable/${deliverableId}`);
  byId('relation-count').textContent = `共 ${data.items.length} 项`;
  byId('relations-list').innerHTML = data.items.length ? `<div class="table-wrap"><table><thead><tr><th>方向</th><th>源交付物</th><th>关系</th><th>目标交付物</th><th>说明</th><th>操作</th></tr></thead><tbody>
    ${data.items.map(x => `<tr><td>${x.direction === 'OUTGOING' ? '<span class="badge active">当前 → 下游</span>' : '<span class="badge approved">上游 → 当前</span>'}</td><td><a class="table-link" href="#/deliverables/${x.sourceDeliverableId}">${esc(x.sourceCode)}<div class="muted">${esc(x.sourceName)}${x.sourceVersion ? ` · ${esc(x.sourceVersion)}` : ''}</div></a></td><td><span class="relation-arrow">${esc(relationNames[x.relationType] || x.relationType)} →</span></td><td><a class="table-link" href="#/deliverables/${x.targetDeliverableId}">${esc(x.targetCode)}<div class="muted">${esc(x.targetName)}${x.targetVersion ? ` · ${esc(x.targetVersion)}` : ''}</div></a></td><td>${esc(x.description || '—')}</td><td>${hasPermission('RELATION_DELETE') ? `<button type="button" class="btn btn-danger btn-sm delete-relation" data-id="${x.id}" data-permission="RELATION_DELETE">删除</button>` : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">尚未建立交付物关联关系</div>';
  document.querySelectorAll('.delete-relation').forEach(button => button.onclick = async () => {
    if (!hasPermission('RELATION_DELETE')) { toast('当前角色没有删除关联关系权限。', 'error'); return; }
    const result = await confirmAction('删除关联', '确认删除该交付物关联关系吗？', { submitText: '确认删除', danger: true });
    if (!result.confirmed) return;
    try { await api(`/internal/relations/${button.dataset.id}`, { method: 'DELETE' }); toast('关联关系已删除'); await loadRelations(deliverableId); }
    catch (error) { toast(error.message, 'error'); }
  });
}

async function openRelationForm(currentId, currentVersions) {
  if (!hasPermission('RELATION_CREATE')) { toast('当前角色没有建立关联关系权限。', 'error'); return; }
  const candidates = await api(`/internal/relations/candidates?excludeId=${currentId}`);
  if (!candidates.items.length) { toast('没有可关联的其他交付物。', 'error'); return; }
  const currentVersionOptions = `<option value="">交付物级关联</option>${currentVersions.map(x => `<option value="${x.id}">${esc(x.internalVersion)} · ${esc(statusNames[x.status] || x.status)}</option>`).join('')}`;
  const body = `<form id="relation-form"><div class="form-grid"><div class="field"><label>当前交付物角色 *</label><select name="direction"><option value="SOURCE">作为源/上游</option><option value="TARGET">作为目标/下游</option></select></div><div class="field"><label>关联类型 *</label><select name="relationType"><option value="DERIVES">派生</option><option value="VERIFIES">验证</option><option value="DEPENDS_ON">依赖</option><option value="REFERENCES">引用</option><option value="REPLACES">替代</option></select></div><div class="field span-2"><label>关联交付物 *</label><select name="otherDeliverableId" required><option value="">请选择</option>${candidates.items.map(x => `<option value="${x.id}">${esc(x.project)} · ${esc(x.type)} · ${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>当前交付物版本</label><select name="currentVersionId">${currentVersionOptions}</select></div><div class="field"><label>关联交付物版本</label><select name="otherVersionId"><option value="">请先选择交付物</option></select></div><div class="field span-2"><label>关系说明</label><textarea name="description" placeholder="说明关联依据、影响范围或依赖关系"></textarea></div></div></form>`;
  showModal('建立交付物关联', body, { submitText: '建立关联', onSubmit: async close => {
    const form = byId('relation-form');
    if (!form.reportValidity()) throw new Error('请选择关联交付物。');
    const f = new FormData(form);
    const currentIsSource = f.get('direction') === 'SOURCE';
    const otherId = Number(f.get('otherDeliverableId'));
    const payload = {
      sourceDeliverableId: currentIsSource ? currentId : otherId,
      sourceVersionId: Number(currentIsSource ? f.get('currentVersionId') : f.get('otherVersionId')) || null,
      targetDeliverableId: currentIsSource ? otherId : currentId,
      targetVersionId: Number(currentIsSource ? f.get('otherVersionId') : f.get('currentVersionId')) || null,
      relationType: f.get('relationType'),
      description: f.get('description')
    };
    await api('/internal/relations', { method: 'POST', body: JSON.stringify(payload) });
    close();
    toast('关联关系已建立');
    await loadRelations(currentId);
  }});
  byId('relation-form').elements.otherDeliverableId.onchange = async event => {
    const select = byId('relation-form').elements.otherVersionId;
    if (!event.target.value) { select.innerHTML = '<option value="">请先选择交付物</option>'; return; }
    const data = await api(`/internal/relations/versions/${event.target.value}`);
    select.innerHTML = `<option value="">交付物级关联</option>${data.items.map(x => `<option value="${x.id}">${esc(x.version)} · ${esc(statusNames[x.status] || x.status)}</option>`).join('')}`;
  };
}
