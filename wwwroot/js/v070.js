/*
 * V0.9 workflow and analytics enhancements.
 *
 * This module is a feature module, not a permission compatibility layer.
 * All authorization is expressed through Permission Code via hasPermission().
 */

const dashboardRuleV070 = {
  totalDeliverables: '统计对象：生命周期状态为“有效”的交付物主档。排除已归档交付物。',
  currentVersions: '统计对象：当前版本且已发布的版本。',
  pendingReview: '统计版本状态为审批中的版本。',
  monthlyNewVersions: '按版本创建时间统计当前自然月新增版本。',
  monthlyChanges: '按变更记录创建时间统计当前自然月变更。',
  deprecatedVersions: '统计全部已废止版本。',
  departmentDistribution: '按部门统计有效交付物主档数量。',
  statusDistribution: '统计全部版本的当前状态分布。',
  monthlyTrend: '展示最近6个自然月版本与变更趋势。',
  typeDistribution: '按交付物类型统计有效交付物数量。',
  recent: '按版本最近更新时间倒序展示前8条。'
};

const analyticsRuleV070 = {
  metadata: '统计全部有效交付物的必填元数据完整度。',
  prdTrace: '统计有效PRD是否建立PRD→FR派生关系。',
  frTrace: '统计有效FR是否建立FR→测试用例验证关系。',
  pendingReview: '统计审批中的版本。',
  pendingChanges: '统计未关闭且未驳回的变更。',
  stale: '统计超过90天未更新的有效交付物。',
  department: '按部门统计元数据完整度。',
  traceability: '统计PRD→FR及FR→测试用例追溯覆盖。',
  hardware: '统计项目标准硬件软件包覆盖情况。',
  issues: '列出必填字段缺失或超过90天未更新的有效交付物。'
};

function infoTipV070(text) {
  const value = esc(text).replaceAll('\n', '&#10;');
  return `<span class="info-tip" tabindex="0" aria-label="统计规则说明" data-tooltip="${value}">i</span>`;
}

function titleWithTipV070(title, rule) {
  return `<span class="title-with-tip">${esc(title)}${infoTipV070(rule)}</span>`;
}

function statCardV070(label, value, unit, rule) {
  return `<div class="stat-card"><span class="stat-label-with-tip">${esc(label)}${infoTipV070(rule)}</span><strong>${Number(value || 0)}</strong><small>${esc(unit)}</small></div>`;
}

async function renderDashboard() {
  setPage('仪表盘', '交付物、版本和变更状态总览');
  const data = await api('/internal/dashboard');
  const s = data.summary;
  content.innerHTML = `<section class="stat-grid">
    ${statCardV070('交付物总数', s.totalDeliverables, '项', dashboardRuleV070.totalDeliverables)}
    ${statCardV070('当前有效版本', s.currentVersions, '个', dashboardRuleV070.currentVersions)}
    ${statCardV070('待评审版本', s.pendingReview, '个', dashboardRuleV070.pendingReview)}
    ${statCardV070('本月新增版本', s.monthlyNewVersions, '个', dashboardRuleV070.monthlyNewVersions)}
    ${statCardV070('本月变更', s.monthlyChanges, '项', dashboardRuleV070.monthlyChanges)}
    ${statCardV070('已废止版本', s.deprecatedVersions, '个', dashboardRuleV070.deprecatedVersions)}
  </section>
  <section class="dashboard-grid">
    <div class="card"><div class="card-head"><h3>${titleWithTipV070('各部门交付物数量', dashboardRuleV070.departmentDistribution)}</h3></div><div class="card-body"><canvas id="department-chart" class="chart"></canvas></div></div>
    <div class="card"><div class="card-head"><h3>${titleWithTipV070('版本状态分布', dashboardRuleV070.statusDistribution)}</h3></div><div class="card-body"><canvas id="status-chart" class="chart"></canvas><div id="status-legend" class="chart-legend"></div></div></div>
  </section>
  <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>${titleWithTipV070('近6个月版本与变更趋势', dashboardRuleV070.monthlyTrend)}</h3></div><div class="card-body"><canvas id="trend-chart" class="chart"></canvas></div></section>
  <section class="dashboard-grid">
    <div class="card"><div class="card-head"><h3>${titleWithTipV070('交付物类型分布', dashboardRuleV070.typeDistribution)}</h3></div><div class="card-body"><canvas id="type-chart" class="chart"></canvas></div></div>
    <div class="card"><div class="card-head"><h3>${titleWithTipV070('最近更新', dashboardRuleV070.recent)}</h3><a class="btn btn-light btn-sm" href="#/deliverables">查看台账</a></div><div class="card-body recent-list">${data.recent.length ? data.recent.map(x => `<a class="recent-row" href="#/deliverables/${x.id}"><div><strong>${esc(x.name)}</strong><small>${esc(x.code)} · ${esc(x.version)}</small></div>${statusBadge(x.status)}</a>`).join('') : '<div class="empty">暂无交付物版本</div>'}</div></div>
  </section>`;
  requestAnimationFrame(() => {
    drawBarChart(byId('department-chart'), data.departmentDistribution);
    drawDonutChart(byId('status-chart'), data.statusDistribution, byId('status-legend'));
    drawLineChart(byId('trend-chart'), data.monthlyTrend);
    drawBarChart(byId('type-chart'), data.typeDistribution);
  });
}

function metricCardV070(label, value, note, rule, percent = null) {
  return `<div class="stat-card"><span class="stat-label-with-tip">${esc(label)}${infoTipV070(rule)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small>${percent === null ? '' : `<div class="compact-progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>`}</div>`;
}

async function renderAnalytics() {
  setPage('完整度分析', '识别元数据缺失、追溯断点、硬件覆盖和待处理事项');
  const data = await api('/internal/analytics/completeness');
  const s = data.summary;
  content.innerHTML = `<section class="stat-grid analytics-stats">
    ${metricCardV070('元数据完整度', `${s.metadataPercent}%`, `${s.completeDeliverables}/${s.deliverables} 项完全完整`, analyticsRuleV070.metadata, s.metadataPercent)}
    ${metricCardV070('PRD→FR追溯', `${s.prdTracePercent}%`, '已建立派生关系', analyticsRuleV070.prdTrace, s.prdTracePercent)}
    ${metricCardV070('FR→测试用例', `${s.frTestTracePercent}%`, '已建立验证关系', analyticsRuleV070.frTrace, s.frTestTracePercent)}
    ${metricCardV070('待审批版本', s.pendingReview, '需要审批者处理', analyticsRuleV070.pendingReview)}
    ${metricCardV070('未关闭变更', s.pendingChanges, '待评估/实施/验证', analyticsRuleV070.pendingChanges)}
    ${metricCardV070('超90天未更新', s.stale, '建议确认有效性', analyticsRuleV070.stale)}
  </section>
  <section class="dashboard-grid"><div class="card"><div class="card-head"><h3>${titleWithTipV070('部门元数据完整度', analyticsRuleV070.department)}</h3></div><div class="card-body progress-list">${data.departmentCompleteness.map(x => progressRow(x.name, x.percent, `${x.complete}/${x.total} 项完全完整`)).join('') || '<div class="empty">暂无数据</div>'}</div></div>
  <div class="card"><div class="card-head"><h3>${titleWithTipV070('需求追溯完整度', analyticsRuleV070.traceability)}</h3></div><div class="card-body progress-list">${progressRow('PRD → FR', data.traceability.prdToFr.percent, `${data.traceability.prdToFr.linked}/${data.traceability.prdToFr.total} 个PRD已关联FR`)}${progressRow('FR → 测试用例', data.traceability.frToTestCase.percent, `${data.traceability.frToTestCase.linked}/${data.traceability.frToTestCase.total} 个FR已关联测试用例`)}</div></div></section>
  <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>${titleWithTipV070('项目硬件软件包覆盖', analyticsRuleV070.hardware)}</h3><span class="muted">按7类标准硬件检查当前正式版本</span></div><div class="table-wrap">${data.hardwareCoverage.length ? `<table><thead><tr><th>项目</th><th>覆盖率</th><th>已覆盖</th><th>缺失类别</th></tr></thead><tbody>${data.hardwareCoverage.map(x => `<tr><td><strong>${esc(x.projectName)}</strong><div class="muted">${esc(x.projectCode)}</div></td><td><div class="compact-progress"><span style="width:${x.percent}%"></span></div><strong>${x.percent}%</strong></td><td>${esc(x.covered)} / ${esc(x.expected)}</td><td>${x.missing.length ? x.missing.map(v => `<span class="badge deprecated">${esc(v)}</span>`).join(' ') : '<span class="badge released">完整</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无项目数据</div>'}</div></section>
  <section class="card"><div class="card-head"><h3>${titleWithTipV070('数据问题清单', analyticsRuleV070.issues)}</h3><span class="muted">最多显示100项</span></div><div class="table-wrap">${data.issues.length ? `<table><thead><tr><th>交付物</th><th>部门/类型</th><th>项目</th><th>完整度</th><th>缺失字段</th><th>最近更新</th><th>操作</th></tr></thead><tbody>${data.issues.map(x => `<tr><td><strong>${esc(x.name)}</strong><div class="code">${esc(x.code)}</div></td><td>${esc(x.department)}<div class="muted">${esc(x.type)}</div></td><td>${esc(x.project)}</td><td><strong>${x.percent}%</strong></td><td class="tag-list">${x.missing.map(v => `<span class="badge pending_assessment">${esc(v)}</span>`).join(' ') || '<span class="badge released">完整</span>'}</td><td>${esc(fmtDate(x.updatedAt))}</td><td><a class="btn btn-light btn-sm" href="#/deliverables/${x.id}">查看详情</a></td></tr>`).join('')}</tbody></table>` : '<div class="empty">没有发现缺失或超期数据</div>'}</div></section>`;
}

const deliverableCodeRuleV070 = '生成结构：AD-部门编码-交付物类型编码-项目编码-对象编码-三位流水号。';

async function loadDeliverables() {
  const form = byId('deliverable-filters');
  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);
  state.lastDeliverableFilters = Object.fromEntries(params.entries());
  params.set('page', state.deliverablePage); params.set('pageSize', state.deliverablePageSize);
  const data = await api(`/internal/deliverables?${params}`);
  byId('deliverable-total').textContent = `共 ${data.total} 项`;
  byId('deliverable-list').innerHTML = data.items.length ? `<table><thead><tr><th>${titleWithTipV070('交付物编码', deliverableCodeRuleV070)}</th><th>统一名称</th><th>部门/类型</th><th>项目</th><th>当前版本</th><th>状态</th><th>责任人</th><th>私密/分享</th><th>最近更新</th><th>操作</th></tr></thead><tbody>${data.items.map(x => `<tr><td class="code">${esc(x.code)}</td><td><strong>${esc(x.name)}</strong><div class="muted">对象：${esc(x.objectCode)}</div></td><td>${esc(x.department)}<div class="muted">${esc(x.type)}</div></td><td>${esc(x.project)}</td><td>${esc(x.currentVersion || '—')}</td><td>${statusBadge(x.versionStatus || 'DRAFT')}</td><td>${esc(x.responsiblePerson)}</td><td>${esc(confidentialityNames[x.confidentiality] || x.confidentiality)}<div class="muted">${esc(shareNames[x.sharePolicy] || x.sharePolicy)}</div></td><td>${esc(fmtDate(x.updatedAt))}</td><td><div class="inline-actions"><a class="btn btn-light btn-sm" href="#/deliverables/${x.id}">详情</a><button type="button" class="btn btn-light btn-sm view-change-timeline" data-id="${x.id}">变更记录</button>${x.serverPath ? `<button type="button" class="btn btn-light btn-sm copy-path" data-path="${esc(x.serverPath)}">复制路径</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">没有符合条件的交付物</div>';
  document.querySelectorAll('.copy-path').forEach(btn => btn.onclick = () => copyText(btn.dataset.path));
  document.querySelectorAll('.view-change-timeline').forEach(btn => btn.onclick = () => openChangeTimelineDrawerV070(data.items.find(x => x.id === Number(btn.dataset.id))));
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  byId('deliverable-pagination').innerHTML = `<div class="pagination"><button type="button" class="btn btn-light btn-sm" id="prev-page" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${data.page} / ${totalPages} 页</span><button type="button" class="btn btn-light btn-sm" id="next-page" ${data.page >= totalPages ? 'disabled' : ''}>下一页</button></div>`;
  byId('prev-page').onclick = () => { state.deliverablePage--; loadDeliverables(); };
  byId('next-page').onclick = () => { state.deliverablePage++; loadDeliverables(); };
}

function drawerRootV070() { return byId('drawer-root'); }
function closeChangeTimelineDrawerV070() { drawerRootV070()?.replaceChildren(); document.body.style.overflow = ''; }

async function openChangeTimelineDrawerV070(deliverable) {
  if (!deliverable) return;
  const root = drawerRootV070(); if (!root) return;
  document.body.style.overflow = 'hidden';
  root.innerHTML = `<div class="drawer-backdrop"></div><aside class="side-drawer" aria-label="交付物变更记录"><div class="drawer-head"><div><h3>${esc(deliverable.name)}</h3><p>${esc(deliverable.code)} · 变更时间线（由近到远）</p></div><button type="button" class="drawer-close" aria-label="关闭">×</button></div><div class="drawer-body"><div class="loading">正在加载变更记录…</div></div></aside>`;
  root.querySelector('.drawer-close').onclick = closeChangeTimelineDrawerV070;
  root.querySelector('.drawer-backdrop').onclick = closeChangeTimelineDrawerV070;
  try {
    const data = await api(`/internal/change-workflow/deliverable/${deliverable.id}`);
    root.querySelector('.drawer-body').innerHTML = data.items.length ? `<div class="change-timeline">${data.items.map(x => `<article class="timeline-item"><div class="timeline-head"><strong>${esc(fmtDate(x.updatedAt))}</strong>${statusBadge(x.status)}</div><div><span class="code">${esc(x.code)}</span> · ${esc(x.reason)}</div><div class="muted text-wrap" style="margin-top:7px">${esc(x.content)}</div><div class="timeline-version"><span>${esc(x.fromVersion || '无正式版本')}</span><span>→</span><strong>${esc(x.toVersion || '尚未创建')}</strong></div><div class="timeline-meta"><span>发起人：${esc(x.applicant)}</span><span>责任人：${esc(x.responsiblePerson)}</span><span>审批人：${esc(x.reviewer || '—')}</span><span>审批意见：${esc(x.reviewOpinion || '—')}</span><span>创建：${esc(fmtDate(x.createdAt))}</span><span>完成：${esc(fmtDate(x.actualCompletionDate))}</span></div>${x.toVersionId ? `<a class="btn btn-light btn-sm" href="#/deliverables/${x.deliverableId}" onclick="closeChangeTimelineDrawerV070()">查看变更版本</a>` : ''}</article>`).join('')}</div>` : '<div class="empty">该交付物暂无变更记录</div>';
  } catch (error) { root.querySelector('.drawer-body').innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`; }
}

function commonVersionFields(prefix = '', mode = 'initial', preview = null, summary = '') {
  const isInitial = mode === 'initial';
  const versionFields = isInitial ? `<input type="hidden" name="${prefix}internalVersion" value="V1.0.0"><div class="field"><label>内部版本号</label><input value="V1.0.0" readonly><small class="muted">首个版本固定从V1.0.0开始</small></div>` : `<div class="field"><label>版本类型 *</label><select name="${prefix}incrementType" required><option value="PATCH">修订版本</option><option value="MINOR">功能版本</option><option value="MAJOR">重大版本</option></select></div><input type="hidden" name="${prefix}internalVersion" value="${esc(preview?.nextVersion || '')}"><div class="field span-2 version-preview" id="${prefix}version-preview"><div class="version-preview-line"><span>原版本：</span><strong class="version-base">${esc(preview?.baseVersion || '—')}</strong><span>→ 新版本：</span><strong class="version-next">${esc(preview?.nextVersion || '—')}</strong></div><small class="version-rule">${esc(preview?.rule || '')}</small></div>`;
  return `${versionFields}<div class="field"><label>原始/供应商版本号</label><input name="${prefix}originalVersion"></div><div class="field"><label>原始文件名 *</label><input name="${prefix}originalFileName" required></div><div class="field"><label>服务器文件路径 *</label><input name="${prefix}serverPath" required placeholder="\\FileServer\\ADDeliverables\\..."></div><div class="field"><label>编制人/提供人 *</label><input name="${prefix}author" required></div><div class="field"><label>计划发布日期</label><input name="${prefix}plannedReleaseDate" type="date"></div><div class="field"><label>校验算法</label><select name="${prefix}hashAlgorithm"><option value="">无</option><option>SHA256</option><option>MD5</option></select></div><div class="field"><label>校验值</label><input name="${prefix}hashValue"></div><div class="field span-2"><label>版本变更摘要</label><textarea name="${prefix}changeSummary">${esc(summary)}</textarea></div>`;
}

async function refreshVersionPreviewV070(deliverableId, prefix, incrementType) {
  const preview = await api(`/internal/versioning/deliverables/${deliverableId}/preview?incrementType=${encodeURIComponent(incrementType)}`);
  const form = byId('version-form'); if (!form) return;
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
      const form = byId('version-form'); if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
      const f = new FormData(form); const incrementType = f.get('v_incrementType');
      const payload = buildVersionPayload(f, typeCode, 'v_');
      const endpoint = options.changeId ? `/internal/versioning/changes/${options.changeId}/deliverables/${deliverableId}/versions?incrementType=${encodeURIComponent(incrementType)}` : `/internal/versioning/deliverables/${deliverableId}/versions?incrementType=${encodeURIComponent(incrementType)}`;
      await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      close(); toast(options.changeId ? '变更版本已创建并关联' : '新版本已创建');
      if (options.returnToChanges) await renderChanges(); else await renderDeliverableDetail(deliverableId);
    }});
    renderTypeFields(typeCode);
    byId('version-form').elements.v_incrementType.onchange = async event => { try { await refreshVersionPreviewV070(deliverableId, 'v_', event.target.value); } catch (error) { toast(error.message, 'error'); } };
  } catch (error) { toast(error.message, 'error'); }
}

function buildVersionPayload(f, typeCode, prefix = '') {
  const numOrNull = name => f.get(name) ? Number(f.get(name)) : null;
  const payload = { internalVersion: f.get(prefix + 'internalVersion'), originalVersion: f.get(prefix + 'originalVersion'), originalFileName: f.get(prefix + 'originalFileName'), serverPath: f.get(prefix + 'serverPath'), hashAlgorithm: f.get(prefix + 'hashAlgorithm'), hashValue: f.get(prefix + 'hashValue'), changeSummary: f.get(prefix + 'changeSummary'), author: f.get(prefix + 'author'), plannedReleaseDate: f.get(prefix + 'plannedReleaseDate') || null, operator: operatorName() };
  if (typeCode === 'SWP') payload.hardware = { hardwareCategory: f.get('hardwareCategory'), hardwareModel: f.get('hardwareModel'), supplierName: f.get('supplierName'), softwarePackageType: f.get('softwarePackageType'), supplierPartNumber: f.get('supplierPartNumber'), internalPartNumber: f.get('internalPartNumber'), compatibleHardwareVersion: f.get('compatibleHardwareVersion'), compatiblePlatform: f.get('compatiblePlatform'), flashMethod: f.get('flashMethod'), flashTool: f.get('flashTool'), dependencyDescription: f.get('dependencyDescription'), releaseNotePath: f.get('releaseNotePath'), flashGuidePath: f.get('flashGuidePath'), remark: f.get('remark') };
  if (typeCode === 'PRD') payload.prd = { productModule: f.get('productModule'), functionName: f.get('functionName'), requirementSource: f.get('requirementSource'), targetVehicle: f.get('targetVehicle'), targetProductVersion: f.get('targetProductVersion'), targetMilestone: f.get('targetMilestone'), productOwner: f.get('productOwner'), reviewers: f.get('reviewers'), referenceBasis: f.get('referenceBasis'), inScope: f.get('inScope'), outOfScope: f.get('outOfScope') };
  if (typeCode === 'FR') payload.fr = { systemName: f.get('systemName'), subsystemName: f.get('subsystemName'), functionModule: f.get('functionModule'), upstreamPrdCode: f.get('upstreamPrdCode'), upstreamPrdVersion: f.get('upstreamPrdVersion'), functionOwner: f.get('functionOwner'), systemOwner: f.get('systemOwner'), targetSoftwareBaseline: f.get('targetSoftwareBaseline'), targetMilestone: f.get('frTargetMilestone'), interfaceImpact: f.get('interfaceImpact'), safetyLevel: f.get('safetyLevel') };
  if (typeCode === 'TC') payload.testCase = { testLevel: f.get('testLevel'), testModule: f.get('testModule'), upstreamFrCode: f.get('upstreamFrCode'), upstreamFrVersion: f.get('upstreamFrVersion'), caseCount: numOrNull('caseCount'), coverageScope: f.get('coverageScope'), testEnvironment: f.get('testEnvironment'), testOwner: f.get('testOwner'), applicableSoftwareVersion: f.get('applicableSoftwareVersion'), automatedCaseCount: numOrNull('automatedCaseCount'), manualCaseCount: numOrNull('manualCaseCount') };
  return payload;
}

const changeTypeNamesV070 = { CONTENT_CHANGE: '内容变更', VERSION_CHANGE: '版本变更', PATH_CHANGE: '路径变更', SECURITY_CHANGE: '权限属性变更' };

function changeButtonsV070(x) {
  const buttons = [];
  if (x.status === 'PENDING_ASSESSMENT' && hasPermission('CHANGE_APPROVE')) buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-change-action="approve" data-change-id="${x.id}">批准</button>`, `<button type="button" class="btn btn-danger btn-sm" data-change-action="reject" data-change-id="${x.id}">驳回</button>`);
  if (x.status === 'APPROVED' && hasPermission('CHANGE_START')) buttons.push(`<button type="button" class="btn btn-light btn-sm" data-change-action="start" data-change-id="${x.id}">开始实施</button>`);
  if (x.status === 'IMPLEMENTING' && hasPermission('CHANGE_EDIT') && !x.toVersionId) buttons.push(`<button type="button" class="btn btn-primary btn-sm create-change-version" data-change-id="${x.id}">创建变更版本</button>`);
  if (x.status === 'IMPLEMENTING' && hasPermission('CHANGE_VERIFY') && x.toVersionId) buttons.push(`<button type="button" class="btn btn-light btn-sm" data-change-action="verify" data-change-id="${x.id}">提交验证</button>`);
  if (x.status === 'PENDING_VERIFICATION' && hasPermission('CHANGE_CLOSE')) buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-change-action="close" data-change-id="${x.id}">确认关闭</button>`);
  if (x.toVersionId) buttons.push(`<a class="btn btn-light btn-sm" href="#/deliverables/${x.deliverableId}">查看版本</a>`);
  return buttons.join('') || '<span class="muted">—</span>';
}

async function renderChanges() {
  setPage('变更管理', '变更记录与交付物前后版本形成闭环');
  const status = state.changeStatusFilter || '';
  const data = await api(`/internal/change-workflow${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  const statusOptions = ['', 'PENDING_ASSESSMENT', 'APPROVED', 'REJECTED', 'IMPLEMENTING', 'PENDING_VERIFICATION', 'CLOSED'];
  content.innerHTML = `<section class="card"><div class="card-head"><div class="toolbar">${hasPermission('CHANGE_CREATE') ? '<button type="button" id="new-change" class="btn btn-primary">+ 发起变更</button>' : ''}<button type="button" id="export-changes" class="btn btn-light">导出CSV</button><label class="inline-filter">状态<select id="change-status-filter">${statusOptions.map(x => `<option value="${x}" ${x === status ? 'selected' : ''}>${x ? statusNames[x] : '全部'}</option>`).join('')}</select></label></div><span class="muted">共 ${data.items.length} 项</span></div><div class="table-wrap">${data.items.length ? `<table><thead><tr><th>变更编号</th><th>交付物</th><th>变更内容</th><th>版本链路</th><th>提出/责任人</th><th>状态</th><th>评审</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${data.items.map(x => `<tr><td><span class="code">${esc(x.code)}</span><div class="muted">${esc(changeTypeNamesV070[x.changeType] || x.changeType)}</div></td><td><a href="#/deliverables/${x.deliverableId}"><strong>${esc(x.deliverableName)}</strong><div class="muted">${esc(x.deliverableCode)}</div></a></td><td><strong>${esc(x.reason)}</strong><div class="muted text-wrap">${esc(x.content)}</div></td><td><span class="timeline-version"><span>${esc(x.fromVersion || '无正式版本')}</span><span>→</span><strong>${esc(x.toVersion || '尚未创建')}</strong></span>${x.toVersionStatus ? `<div>${statusBadge(x.toVersionStatus)}</div>` : ''}</td><td>${esc(x.applicant)} / ${esc(x.responsiblePerson)}</td><td>${statusBadge(x.status)}</td><td>${esc(x.reviewer || '—')}<div class="muted text-wrap">${esc(x.reviewOpinion || '')}</div></td><td>${esc(fmtDate(x.updatedAt))}</td><td><div class="inline-actions">${changeButtonsV070(x)}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无变更记录</div>'}</div></section>`;
  if (hasPermission('CHANGE_CREATE')) byId('new-change').onclick = openChangeForm;
  byId('export-changes').onclick = () => openCsvExport('changes', { status: state.changeStatusFilter || null });
  byId('change-status-filter').onchange = event => { state.changeStatusFilter = event.target.value; renderChanges(); };
  document.querySelectorAll('[data-change-action]').forEach(btn => btn.onclick = () => handleChangeActionV070(btn, data.items));
  document.querySelectorAll('.create-change-version').forEach(btn => btn.onclick = () => { const change = data.items.find(x => x.id === Number(btn.dataset.changeId)); openVersionForm(change.deliverableId, change.typeCode, { changeId: change.id, changeSummary: `变更${change.code}：${change.reason}\n${change.content}`, returnToChanges: true }); });
}

async function handleChangeActionV070(button, items) {
  const changeId = Number(button.dataset.changeId);
  const action = String(button.dataset.changeAction || '').trim().toLowerCase();
  const change = items.find(x => x.id === changeId);
  if (!change) { toast('变更记录不存在，请刷新后重试。', 'error'); return; }
  const permissionByAction = { approve:'CHANGE_APPROVE', reject:'CHANGE_APPROVE', start:'CHANGE_START', verify:'CHANGE_VERIFY', close:'CHANGE_CLOSE' };
  const permission = permissionByAction[action];
  if (!permission || !hasPermission(permission)) { toast('当前角色没有执行该变更操作的权限。', 'error'); return; }
  let opinion = '';
  if (action === 'approve' || action === 'reject') {
    const result = await promptActionOpinion(action === 'approve' ? '批准变更' : '驳回变更', action === 'approve' ? '请填写评审意见。' : '请填写驳回原因。');
    if (!result.confirmed) return;
    opinion = result.value.trim();
    if (!opinion) { toast('评审意见不能为空。', 'error'); return; }
  } else {
    const result = await confirmAction(action === 'start' ? '开始实施' : action === 'verify' ? '提交验证' : '确认关闭', `确定对 ${change.code} 执行“${button.textContent.trim()}”吗？`);
    if (!result.confirmed) return;
  }
  button.disabled = true;
  try {
    await api(`/internal/changes/${changeId}/${action}`, { method: 'POST', body: JSON.stringify({ opinion, toVersionId: change.toVersionId || null }) });
    toast(action === 'approve' ? '变更已批准。' : action === 'reject' ? '变更已驳回。' : '变更状态已更新。');
    await renderChanges();
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
}

async function promptActionOpinion(title, hint) {
  return new Promise(resolve => {
    showModal(title, `<form id="change-opinion-form"><div class="form-hint">${esc(hint)}</div><div class="field"><label>评审意见 *</label><textarea name="opinion" rows="5" required></textarea></div></form>`, { submitText:'提交', onSubmit:async close=>{const form=byId('change-opinion-form');if(!form.reportValidity())throw new Error('请填写评审意见。');const value=form.elements.opinion.value;close();resolve({confirmed:true,value});} });
  });
}

async function openChangeForm() {
  if (!hasPermission('CHANGE_CREATE')) { toast('当前角色没有发起变更权限。', 'error'); return; }
  const list = await api('/internal/deliverables?page=1&pageSize=100');
  const body = `<form id="change-form"><div class="alert">提交后系统会自动锁定该交付物当前有效版本作为“变更前版本”。变更实施时需创建并关联新版本，新版本正式发布后才能关闭变更。</div><div class="form-grid"><div class="field span-2"><label>交付物 *</label><select name="deliverableId" required><option value="">请选择</option>${list.items.map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)} · 当前${esc(x.currentVersion || '无正式版本')}</option>`).join('')}</select></div><div class="field"><label>变更类型</label><select name="changeType"><option value="CONTENT_CHANGE">内容变更</option><option value="VERSION_CHANGE">版本变更</option><option value="PATH_CHANGE">路径变更</option><option value="SECURITY_CHANGE">权限属性变更</option></select></div><div class="field"><label>关联需求/问题编号</label><input name="relatedIssueCode"></div><div class="field span-2"><label>变更原因 *</label><textarea name="changeReason" required></textarea></div><div class="field span-2"><label>变更内容 *</label><textarea name="changeContent" required></textarea></div><div class="field span-2"><label>影响范围</label><textarea name="impactScope"></textarea></div><div class="field"><label>提出人</label><input value="${esc(operatorName())}" disabled></div><div class="field"><label>责任人 *</label><input name="responsiblePerson" required></div><div class="field"><label>计划完成日期</label><input type="date" name="plannedCompletionDate"></div></div></form>`;
  showModal('发起变更', body, { submitText: '提交变更', onSubmit: async close => { const form = byId('change-form'); if (!form.reportValidity()) throw new Error('请先填写所有必填字段。'); const f = new FormData(form); await api('/internal/change-workflow', { method: 'POST', body: JSON.stringify({ deliverableId: Number(f.get('deliverableId')), changeType: f.get('changeType'), changeReason: f.get('changeReason'), changeContent: f.get('changeContent'), impactScope: f.get('impactScope'), relatedIssueCode: f.get('relatedIssueCode'), responsiblePerson: f.get('responsiblePerson'), plannedCompletionDate: f.get('plannedCompletionDate') || null }) }); close(); toast('变更已发起并关联当前版本'); await renderChanges(); } });
}
