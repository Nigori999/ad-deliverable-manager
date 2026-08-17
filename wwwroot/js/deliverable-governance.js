const deliverableCodeRule = '生成结构：AD-部门编码-交付物类型编码-项目编码-对象编码-三位流水号。';

async function loadDeliverables() {
  const form = byId('deliverable-filters');
  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);
  state.lastDeliverableFilters = Object.fromEntries(params.entries());
  params.set('page', state.deliverablePage);
  params.set('pageSize', state.deliverablePageSize);
  const data = await api(`/internal/deliverables?${params}`);
  byId('deliverable-total').textContent = `共 ${data.total} 项`;
  byId('deliverable-list').innerHTML = data.items.length ? `<table><thead><tr><th>${titleWithTip('交付物编码', deliverableCodeRule)}</th><th>统一名称</th><th>部门/类型</th><th>项目</th><th>当前版本</th><th>状态</th><th>责任人</th><th>私密/分享</th><th>最近更新</th><th>操作</th></tr></thead><tbody>${data.items.map(x => `<tr><td class="code">${esc(x.code)}</td><td><strong>${esc(x.name)}</strong><div class="muted">对象：${esc(x.objectCode)}</div></td><td>${esc(x.department)}<div class="muted">${esc(x.type)}</div></td><td>${esc(x.project)}</td><td>${esc(x.currentVersion || '—')}</td><td>${statusBadge(x.versionStatus || 'DRAFT')}</td><td>${esc(x.responsiblePerson)}</td><td>${esc(confidentialityNames[x.confidentiality] || x.confidentiality)}<div class="muted">${esc(shareNames[x.sharePolicy] || x.sharePolicy)}</div></td><td>${esc(fmtDate(x.updatedAt))}</td><td><div class="inline-actions"><a class="btn btn-light btn-sm" href="#/deliverables/${x.id}">详情</a><button type="button" class="btn btn-light btn-sm view-change-timeline" data-id="${x.id}">变更记录</button>${x.serverPath ? `<button type="button" class="btn btn-light btn-sm copy-path" data-path="${esc(x.serverPath)}">复制路径</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">没有符合条件的交付物</div>';
  document.querySelectorAll('.copy-path').forEach(btn => btn.onclick = () => copyText(btn.dataset.path));
  document.querySelectorAll('.view-change-timeline').forEach(btn => btn.onclick = () => openChangeTimelineDrawer(data.items.find(x => x.id === Number(btn.dataset.id))));
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  byId('deliverable-pagination').innerHTML = `<div class="pagination"><button type="button" class="btn btn-light btn-sm" id="prev-page" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${data.page} / ${totalPages} 页</span><button type="button" class="btn btn-light btn-sm" id="next-page" ${data.page >= totalPages ? 'disabled' : ''}>下一页</button></div>`;
  byId('prev-page').onclick = () => { state.deliverablePage--; loadDeliverables(); };
  byId('next-page').onclick = () => { state.deliverablePage++; loadDeliverables(); };
}

function closeChangeTimelineDrawer() {
  byId('drawer-root')?.replaceChildren();
  document.body.style.overflow = '';
}

async function openChangeTimelineDrawer(deliverable) {
  if (!deliverable) return;
  const root = byId('drawer-root');
  if (!root) return;
  document.body.style.overflow = 'hidden';
  root.innerHTML = `<div class="drawer-backdrop"></div><aside class="side-drawer" aria-label="交付物变更记录"><div class="drawer-head"><div><h3>${esc(deliverable.name)}</h3><p>${esc(deliverable.code)} · 变更时间线（由近到远）</p></div><button type="button" class="drawer-close" aria-label="关闭">×</button></div><div class="drawer-body"><div class="loading">正在加载变更记录…</div></div></aside>`;
  root.querySelector('.drawer-close').onclick = closeChangeTimelineDrawer;
  root.querySelector('.drawer-backdrop').onclick = closeChangeTimelineDrawer;
  try {
    const data = await api(`/internal/change-workflow/deliverable/${deliverable.id}`);
    root.querySelector('.drawer-body').innerHTML = data.items.length ? `<div class="change-timeline">${data.items.map(x => `<article class="timeline-item"><div class="timeline-head"><strong>${esc(fmtDate(x.updatedAt))}</strong>${statusBadge(x.status)}</div><div><span class="code">${esc(x.code)}</span> · ${esc(x.reason)}</div><div class="muted text-wrap" style="margin-top:7px">${esc(x.content)}</div><div class="timeline-version"><span>${esc(x.fromVersion || '无正式版本')}</span><span>→</span><strong>${esc(x.toVersion || '尚未创建')}</strong></div><div class="timeline-meta"><span>发起人：${esc(x.applicant)}</span><span>责任人：${esc(x.responsiblePerson)}</span><span>审批人：${esc(x.reviewer || '—')}</span><span>审批意见：${esc(x.reviewOpinion || '—')}</span><span>创建：${esc(fmtDate(x.createdAt))}</span><span>完成：${esc(fmtDate(x.actualCompletionDate))}</span></div>${x.toVersionId ? `<a class="btn btn-light btn-sm" href="#/deliverables/${x.deliverableId}" onclick="closeChangeTimelineDrawer()">查看变更版本</a>` : ''}</article>`).join('')}</div>` : '<div class="empty">该交付物暂无变更记录</div>';
  } catch (error) {
    root.querySelector('.drawer-body').innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`;
  }
}

function commonVersionFields(prefix = '', mode = 'initial', preview = null, summary = '') {
  const isInitial = mode === 'initial';
  const versionFields = isInitial
    ? `<input type="hidden" name="${prefix}internalVersion" value="V1.0.0"><div class="field"><label>内部版本号</label><input value="V1.0.0" readonly><small class="muted">首个版本固定从V1.0.0开始</small></div>`
    : `<div class="field"><label>版本类型 *</label><select name="${prefix}incrementType" required><option value="PATCH">修订版本</option><option value="MINOR">功能版本</option><option value="MAJOR">重大版本</option></select></div><input type="hidden" name="${prefix}internalVersion" value="${esc(preview?.nextVersion || '')}"><div class="field span-2 version-preview" id="${prefix}version-preview"><div class="version-preview-line"><span>原版本：</span><strong class="version-base">${esc(preview?.baseVersion || '—')}</strong><span>→ 新版本：</span><strong class="version-next">${esc(preview?.nextVersion || '—')}</strong></div><small class="version-rule">${esc(preview?.rule || '')}</small></div>`;
  return `${versionFields}<div class="field"><label>原始/供应商版本号</label><input name="${prefix}originalVersion"></div><div class="field"><label>原始文件名 *</label><input name="${prefix}originalFileName" required></div><div class="field"><label>服务器文件路径 *</label><input name="${prefix}serverPath" required placeholder="\\FileServer\\ADDeliverables\\..."></div><div class="field"><label>编制人/提供人 *</label><input name="${prefix}author" required></div><div class="field"><label>计划发布日期</label><input name="${prefix}plannedReleaseDate" type="date"></div><div class="field"><label>校验算法</label><select name="${prefix}hashAlgorithm"><option value="">无</option><option>SHA256</option><option>MD5</option></select></div><div class="field"><label>校验值</label><input name="${prefix}hashValue"></div><div class="field span-2"><label>版本变更摘要</label><textarea name="${prefix}changeSummary">${esc(summary)}</textarea></div>`;
}

async function refreshVersionPreview(deliverableId, prefix, incrementType) {
  const preview = await api(`/internal/versioning/deliverables/${deliverableId}/preview?incrementType=${encodeURIComponent(incrementType)}`);
  const form = byId('version-form');
  if (!form) return;
  form.elements[prefix + 'internalVersion'].value = preview.nextVersion;
  const panel = byId(prefix + 'version-preview');
  panel.querySelector('.version-base').textContent = preview.baseVersion;
  panel.querySelector('.version-next').textContent = preview.nextVersion;
  panel.querySelector('.version-rule').textContent = preview.rule;
}

async function openVersionForm(deliverableId, typeCode, options = {}) {
  try {
    const preview = await api(`/internal/versioning/deliverables/${deliverableId}/preview?incrementType=PATCH`);
    const body = `<form id="version-form"><div class="form-grid">${commonVersionFields('v_', 'new', preview, options.changeSummary || '')}</div><div id="type-specific-fields"></div></form>`;
    showModal(options.changeId ? '创建变更版本' : '新增版本', body, { submitText: '创建草稿版本', onSubmit: async close => {
      const form = byId('version-form');
      if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
      const f = new FormData(form);
      const incrementType = f.get('v_incrementType');
      const payload = buildVersionPayload(f, typeCode, 'v_');
      const endpoint = options.changeId
        ? `/internal/versioning/changes/${options.changeId}/deliverables/${deliverableId}/versions?incrementType=${encodeURIComponent(incrementType)}`
        : `/internal/versioning/deliverables/${deliverableId}/versions?incrementType=${encodeURIComponent(incrementType)}`;
      await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      close();
      toast(options.changeId ? '变更版本已创建并关联' : '新版本已创建');
      if (options.returnToChanges) await renderChanges();
      else await renderDeliverableDetail(deliverableId);
    }});
    renderTypeFields(typeCode);
    byId('version-form').elements.v_incrementType.onchange = async event => {
      try { await refreshVersionPreview(deliverableId, 'v_', event.target.value); }
      catch (error) { toast(error.message, 'error'); }
    };
  } catch (error) {
    toast(error.message, 'error');
  }
}

function buildVersionPayload(f, typeCode, prefix = '') {
  const numOrNull = name => f.get(name) ? Number(f.get(name)) : null;
  const payload = {
    internalVersion: f.get(prefix + 'internalVersion'), originalVersion: f.get(prefix + 'originalVersion'),
    originalFileName: f.get(prefix + 'originalFileName'), serverPath: f.get(prefix + 'serverPath'),
    hashAlgorithm: f.get(prefix + 'hashAlgorithm'), hashValue: f.get(prefix + 'hashValue'),
    changeSummary: f.get(prefix + 'changeSummary'), author: f.get(prefix + 'author'),
    plannedReleaseDate: f.get(prefix + 'plannedReleaseDate') || null, operator: operatorName()
  };
  if (typeCode === 'SWP') payload.hardware = { hardwareCategory: f.get('hardwareCategory'), hardwareModel: f.get('hardwareModel'), supplierName: f.get('supplierName'), softwarePackageType: f.get('softwarePackageType'), supplierPartNumber: f.get('supplierPartNumber'), internalPartNumber: f.get('internalPartNumber'), compatibleHardwareVersion: f.get('compatibleHardwareVersion'), compatiblePlatform: f.get('compatiblePlatform'), flashMethod: f.get('flashMethod'), flashTool: f.get('flashTool'), dependencyDescription: f.get('dependencyDescription'), releaseNotePath: f.get('releaseNotePath'), flashGuidePath: f.get('flashGuidePath'), remark: f.get('remark') };
  if (typeCode === 'PRD') payload.prd = { productModule: f.get('productModule'), functionName: f.get('functionName'), requirementSource: f.get('requirementSource'), targetVehicle: f.get('targetVehicle'), targetProductVersion: f.get('targetProductVersion'), targetMilestone: f.get('targetMilestone'), productOwner: f.get('productOwner'), reviewers: f.get('reviewers'), referenceBasis: f.get('referenceBasis'), inScope: f.get('inScope'), outOfScope: f.get('outOfScope') };
  if (typeCode === 'FR') payload.fr = { systemName: f.get('systemName'), subsystemName: f.get('subsystemName'), functionModule: f.get('functionModule'), upstreamPrdCode: f.get('upstreamPrdCode'), upstreamPrdVersion: f.get('upstreamPrdVersion'), functionOwner: f.get('functionOwner'), systemOwner: f.get('systemOwner'), targetSoftwareBaseline: f.get('targetSoftwareBaseline'), targetMilestone: f.get('frTargetMilestone'), interfaceImpact: f.get('interfaceImpact'), safetyLevel: f.get('safetyLevel') };
  if (typeCode === 'TC') payload.testCase = { testLevel: f.get('testLevel'), testModule: f.get('testModule'), upstreamFrCode: f.get('upstreamFrCode'), upstreamFrVersion: f.get('upstreamFrVersion'), caseCount: numOrNull('caseCount'), coverageScope: f.get('coverageScope'), testEnvironment: f.get('testEnvironment'), testOwner: f.get('testOwner'), applicableSoftwareVersion: f.get('applicableSoftwareVersion'), automatedCaseCount: numOrNull('automatedCaseCount'), manualCaseCount: numOrNull('manualCaseCount') };
  return payload;
}
