function buildVersionPayload(f, typeCode, prefix = '') {
  const numOrNull = name => f.get(name) ? Number(f.get(name)) : null;
  const payload = {
    internalVersion: f.get(prefix + 'internalVersion'), originalVersion: f.get(prefix + 'originalVersion'),
    originalFileName: f.get(prefix + 'originalFileName'), serverPath: f.get(prefix + 'serverPath'),
    hashAlgorithm: f.get(prefix + 'hashAlgorithm'), hashValue: f.get(prefix + 'hashValue'),
    changeSummary: f.get(prefix + 'changeSummary'), author: f.get(prefix + 'author'),
    plannedReleaseDate: f.get(prefix + 'plannedReleaseDate') || null, operator: operatorName()
  };
  if (typeCode === 'SWP') payload.hardware = {
    hardwareCategory: f.get('hardwareCategory'), hardwareModel: f.get('hardwareModel'), supplierName: f.get('supplierName'),
    softwarePackageType: f.get('softwarePackageType'), supplierPartNumber: f.get('supplierPartNumber'), internalPartNumber: f.get('internalPartNumber'),
    compatibleHardwareVersion: f.get('compatibleHardwareVersion'), compatiblePlatform: f.get('compatiblePlatform'), flashMethod: f.get('flashMethod'),
    flashTool: f.get('flashTool'), dependencyDescription: f.get('dependencyDescription'), releaseNotePath: f.get('releaseNotePath'), flashGuidePath: f.get('flashGuidePath')
  };
  if (typeCode === 'PRD') payload.prd = {
    productModule: f.get('productModule'), functionName: f.get('functionName'), requirementSource: f.get('requirementSource'), targetVehicle: f.get('targetVehicle'),
    targetProductVersion: f.get('targetProductVersion'), targetMilestone: f.get('targetMilestone'), productOwner: f.get('productOwner'), reviewers: f.get('reviewers')
  };
  if (typeCode === 'FR') payload.fr = {
    systemName: f.get('systemName'), subsystemName: f.get('subsystemName'), functionModule: f.get('functionModule'), upstreamPrdCode: f.get('upstreamPrdCode'),
    upstreamPrdVersion: f.get('upstreamPrdVersion'), functionOwner: f.get('functionOwner'), systemOwner: f.get('systemOwner'), targetSoftwareBaseline: f.get('targetSoftwareBaseline')
  };
  if (typeCode === 'TC') payload.testCase = {
    testLevel: f.get('testLevel'), testModule: f.get('testModule'), upstreamFrCode: f.get('upstreamFrCode'), upstreamFrVersion: f.get('upstreamFrVersion'),
    caseCount: numOrNull('caseCount'), coverageScope: f.get('coverageScope'), applicableSoftwareVersion: f.get('applicableSoftwareVersion'),
    automatedCaseCount: numOrNull('automatedCaseCount'), manualCaseCount: numOrNull('manualCaseCount')
  };
  return payload;
}

async function renderDeliverableDetail(id) {
  setPage('交付物详情', '查看主档、版本和生命周期记录');
  const data = await api(`/internal/deliverables/${id}`);
  const d = data.deliverable;
  content.innerHTML = `
    <div class="detail-title"><div><h2>${esc(d.name)}</h2><div class="detail-meta"><span class="code">${esc(d.code)}</span>${statusBadge(d.lifecycleStatus)}<span class="badge">${esc(d.type)}</span></div></div>
      <div class="inline-actions"><button class="btn btn-primary" id="add-version">+ 新增版本</button><button class="btn btn-light" id="archive-deliverable">归档</button></div></div>
    <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>基本信息</h3></div><div class="card-body"><div class="info-grid">
      ${infoItem('所属部门', d.department)}${infoItem('交付物类型', d.type)}${infoItem('项目/车型', d.project)}${infoItem('对象编码', d.objectCode)}
      ${infoItem('业务模块', d.businessModule || '—')}${infoItem('责任人', d.responsiblePerson)}${infoItem('私密等级', confidentialityNames[d.confidentiality] || d.confidentiality)}${infoItem('对外分享', shareNames[d.sharePolicy] || d.sharePolicy)}
    </div>${d.description ? `<p class="muted" style="margin:16px 0 0">${esc(d.description)}</p>` : ''}</div></section>
    <section class="card"><div class="card-head"><h3>版本记录</h3><span class="muted">共 ${data.versions.length} 个版本</span></div><div class="table-wrap">
      ${data.versions.length ? `<table><thead><tr><th>内部版本</th><th>原始版本</th><th>状态</th><th>统一文件名</th><th>服务器路径</th><th>编制人</th><th>发布时间</th><th>操作</th></tr></thead><tbody>
        ${data.versions.map(v => `<tr><td><strong>${esc(v.internalVersion)}</strong>${v.isCurrent ? '<div class="badge released">当前</div>' : ''}</td><td>${esc(v.originalVersion || '—')}</td><td>${statusBadge(v.status)}</td>
        <td class="path-cell" title="${esc(v.unifiedFileName)}">${esc(v.unifiedFileName)}</td><td class="path-cell" title="${esc(v.serverPath)}">${esc(v.serverPath)}</td><td>${esc(v.author)}</td><td>${esc(fmtDateOnly(v.releaseDate))}</td>
        <td><div class="inline-actions">${versionActionButtons(v)}<button class="btn btn-light btn-sm copy-version-path" data-path="${esc(v.serverPath)}">复制路径</button></div></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">暂无版本</div>'}
    </div></section>`;
  byId('add-version').onclick = () => openVersionForm(id, d.typeCode);
  byId('archive-deliverable').onclick = () => archiveDeliverable(id);
  document.querySelectorAll('.copy-version-path').forEach(btn => btn.onclick = () => copyText(btn.dataset.path));
  document.querySelectorAll('[data-version-action]').forEach(btn => btn.onclick = () => runVersionAction(id, Number(btn.dataset.versionId), btn.dataset.versionAction));
}

function infoItem(label, value) { return `<div class="info-item"><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong></div>`; }
function versionActionButtons(v) {
  if (v.status === 'DRAFT') return `<button class="btn btn-light btn-sm" data-version-action="submit-review" data-version-id="${v.id}">提交评审</button><button class="btn btn-primary btn-sm" data-version-action="release" data-version-id="${v.id}">发布</button>`;
  if (v.status === 'IN_REVIEW') return `<button class="btn btn-light btn-sm" data-version-action="return-draft" data-version-id="${v.id}">退回</button><button class="btn btn-primary btn-sm" data-version-action="release" data-version-id="${v.id}">发布</button>`;
  if (v.status === 'RELEASED' || v.status === 'SUPERSEDED') return `<button class="btn btn-danger btn-sm" data-version-action="deprecate" data-version-id="${v.id}">废止</button>`;
  return '';
}

function openVersionForm(deliverableId, typeCode) {
  const body = `<form id="version-form"><div class="form-grid">${commonVersionFields('v_')}</div><div id="type-specific-fields"></div></form>`;
  showModal('新增版本', body, { submitText: '创建草稿版本', onSubmit: async close => {
    const form = byId('version-form'); if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
    const f = new FormData(form); const payload = buildVersionPayload(f, typeCode, 'v_');
    await api(`/internal/deliverables/${deliverableId}/versions`, { method: 'POST', body: JSON.stringify(payload) });
    close(); toast('新版本已创建'); renderDeliverableDetail(deliverableId);
  }});
  renderTypeFields(typeCode);
}

async function runVersionAction(deliverableId, versionId, action) {
  const labels = { 'submit-review': '提交评审', 'return-draft': '退回草稿', release: '正式发布', deprecate: '废止版本' };
  if (!confirm(`确认执行“${labels[action]}”吗？`)) return;
  let reason = '';
  if (action === 'deprecate') reason = prompt('请输入废止原因：') || '';
  await api(`/internal/deliverables/versions/${versionId}/${action}`, { method: 'POST', body: JSON.stringify({ operator: operatorName(), reason }) });
  toast('版本状态已更新'); renderDeliverableDetail(deliverableId);
}

async function archiveDeliverable(id) {
  const reason = prompt('请输入归档原因：'); if (reason === null) return;
  await api(`/internal/deliverables/${id}/archive`, { method: 'POST', body: JSON.stringify({ operator: operatorName(), reason }) });
  toast('交付物已归档'); location.hash = '#/deliverables';
}
