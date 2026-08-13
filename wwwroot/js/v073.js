function highestVersionIdV072(versions) {
  let highest = null;
  for (const version of versions || []) {
    if (version.status === 'DEPRECATED') continue;
    const parsed = parseVersionV072(version.internalVersion);
    if (!parsed) continue;
    if (!highest || compareVersionV072(parsed, highest.parsed) > 0) highest = { id: version.id, parsed };
  }
  return highest?.id ?? null;
}

const renderDeliverableDetailBeforeV073 = renderDeliverableDetail;
renderDeliverableDetail = async function (deliverableId) {
  await renderDeliverableDetailBeforeV073(deliverableId);
  await injectVersionDetailButtonsV073(deliverableId);
};

async function injectVersionDetailButtonsV073(deliverableId) {
  const snapshot = await api(`/internal/deliverables/${deliverableId}`);
  const versions = snapshot.versions || [];
  const table = content.querySelector('.card table');
  if (!table) return;
  const rows = table.querySelectorAll('tbody tr');
  rows.forEach((row, index) => {
    const version = versions[index];
    if (!version) return;
    const cell = row.lastElementChild;
    if (!cell || cell.querySelector('.version-detail-btn')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-light btn-sm version-detail-btn';
    button.textContent = '详情';
    button.title = '查看该版本完整信息';
    button.onclick = () => openVersionDetailsV073(version.id);
    cell.prepend(button);
  });
}

async function openVersionDetailsV073(versionId) {
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
    const commonHtml = Object.entries(data.common).map(([key, value]) =>
      `<div class="info-item"><span>${esc(commonLabels[key] || key)}</span><strong>${esc(valueText(key, value))}</strong></div>`
    ).join('');
    const specificHtml = Object.entries(data.specific || {}).map(([key, value]) =>
      `<div class="info-item"><span>${esc(key)}</span><strong>${esc(value === null || value === undefined || value === '' ? '—' : String(value))}</strong></div>`
    ).join('');

    const body = `
      <div class="version-detail-head">
        <div><strong>${esc(data.common.internalVersion || '')}</strong> ${statusBadge(data.common.status)}</div>
        <span class="muted">${esc(data.common.deliverableCode || '')} · ${esc(data.common.deliverableName || '')}</span>
      </div>
      <h4 style="margin:18px 0 10px">基础信息</h4>
      <div class="info-grid">${commonHtml}</div>
      ${specificHtml ? `<h4 style="margin:22px 0 10px">${esc(data.common.typeName || '类型专属信息')}</h4><div class="info-grid">${specificHtml}</div>` : ''}`;
    showModal('版本详情', body, { submitText: '关闭', onSubmit: async close => close() });
    const submit = modalRoot.querySelector('.modal-submit');
    if (submit) submit.textContent = '关闭';
  } catch (error) {
    toast(error.message, 'error');
  }
}
