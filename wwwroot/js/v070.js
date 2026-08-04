const dashboardRuleV070 = {
  totalDeliverables: "统计对象：生命周期状态为“有效”的交付物主档。\n排除：已归档交付物。\n刷新：每次进入页面或点击刷新时重新统计。",
  currentVersions: "统计对象：同时满足“当前版本”标记和“已发布”状态的版本。\n同一交付物正常情况下只计1个当前有效版本。",
  pendingReview: "统计对象：版本状态为“审批中”的全部版本。\n包括历史交付物下尚未处理的审批版本。",
  monthlyNewVersions: "统计对象：创建时间位于当前自然月的版本。\n按版本创建时间统计，不以发布日期为准。",
  monthlyChanges: "统计对象：创建时间位于当前自然月的变更记录。\n批准、驳回或关闭不会改变其归属月份。",
  deprecatedVersions: "统计对象：版本状态为“已废止”的全部历史版本。\n已替代版本不计入已废止版本。",
  departmentDistribution: "按交付物所属部门统计有效交付物主档数量。\n已归档交付物不参与统计；没有交付物的启用部门显示为0。",
  statusDistribution: "统计全部版本的当前状态，包括草稿、审批中、已发布、已替代和已废止。\n这是版本数量分布，不是交付物数量分布。",
  monthlyTrend: "展示最近6个自然月。\n新增版本按CreatedAt统计；正式发布按ReleaseDate统计；变更按变更记录CreatedAt统计。",
  typeDistribution: "按交付物类型统计有效交付物主档数量。\n已归档交付物不参与统计。",
  recent: "按版本最近更新时间倒序展示前8条。\n同一交付物的不同版本可能分别出现。"
};

const analyticsRuleV070 = {
  metadata: "统计范围：全部有效交付物。\n公共必填项：对象编码、责任人、私密等级、分享策略、当前版本、内部版本、原始文件名、服务器路径、编制/提供人。\n再叠加SWP、PRD、FR、测试用例各自的类型必填项。\n计算公式：已填写检查项总数 ÷ 应填写检查项总数 × 100%。",
  prdTrace: "统计范围：全部有效PRD。\n已追溯条件：PRD作为源交付物，至少存在1条类型为“派生”的PRD→FR关系。\n计算公式：已关联FR的PRD数 ÷ 有效PRD总数 × 100%。",
  frTrace: "统计范围：全部有效FR。\n已追溯条件：FR与测试用例之间至少存在1条类型为“验证”的关系，关系方向不限。\n计算公式：已关联测试用例的FR数 ÷ 有效FR总数 × 100%。",
  pendingReview: "统计版本状态为“审批中”的版本数量，需要审批者执行发布或退回。",
  pendingChanges: "统计状态不为“已关闭”且不为“已驳回”的变更，包括待评估、已批准、实施中和待验证。",
  stale: "统计有效交付物中，主档最近更新时间早于当前UTC时间90天的数量。\n版本或变更操作更新主档时间后会重新计算。",
  department: "以部门为分组，按该部门全部有效交付物的“已完成检查项 ÷ 应完成检查项”计算。\n同时显示所有检查项均完整的交付物数量。",
  traceability: "集中展示PRD→FR派生关系和FR→测试用例验证关系的覆盖情况。\n只统计有效交付物和指定关系类型。",
  hardware: "对每个启用项目检查7类标准硬件：前视摄像头、周视摄像头、角雷达、激光雷达、毫米波雷达、超声波雷达、智驾域控制器。\n只有有效交付物的当前已发布SWP版本计入覆盖。",
  issues: "列出存在必填字段缺失，或超过90天未更新的有效交付物。\n按完整度从低到高、再按编码排序，最多显示100项。"
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
  content.innerHTML = `
    <section class="stat-grid">
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
      <div class="card"><div class="card-head"><h3>${titleWithTipV070('最近更新', dashboardRuleV070.recent)}</h3><a class="btn btn-light btn-sm" href="#/deliverables">查看台账</a></div><div class="card-body recent-list">
        ${data.recent.length ? data.recent.map(x => `<a class="recent-row" href="#/deliverables/${x.id}"><div><strong>${esc(x.name)}</strong><small>${esc(x.code)} · ${esc(x.version)}</small></div>${statusBadge(x.status)}</a>`).join('') : '<div class="empty">暂无交付物版本</div>'}
      </div></div>
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
  content.innerHTML = `
    <section class="stat-grid analytics-stats">
      ${metricCardV070('元数据完整度', `${s.metadataPercent}%`, `${s.completeDeliverables}/${s.deliverables} 项完全完整`, analyticsRuleV070.metadata, s.metadataPercent)}
      ${metricCardV070('PRD→FR追溯', `${s.prdTracePercent}%`, '已建立派生关系', analyticsRuleV070.prdTrace, s.prdTracePercent)}
      ${metricCardV070('FR→测试用例', `${s.frTestTracePercent}%`, '已建立验证关系', analyticsRuleV070.frTrace, s.frTestTracePercent)}
      ${metricCardV070('待审批版本', s.pendingReview, '需要审批者处理', analyticsRuleV070.pendingReview)}
      ${metricCardV070('未关闭变更', s.pendingChanges, '待评估/实施/验证', analyticsRuleV070.pendingChanges)}
      ${metricCardV070('超90天未更新', s.stale, '建议确认有效性', analyticsRuleV070.stale)}
    </section>
    <section class="dashboard-grid">
      <div class="card"><div class="card-head"><h3>${titleWithTipV070('部门元数据完整度', analyticsRuleV070.department)}</h3></div><div class="card-body progress-list">
        ${data.departmentCompleteness.map(x => progressRow(x.name, x.percent, `${x.complete}/${x.total} 项完全完整`)).join('') || '<div class="empty">暂无数据</div>'}
      </div></div>
      <div class="card"><div class="card-head"><h3>${titleWithTipV070('需求追溯完整度', analyticsRuleV070.traceability)}</h3></div><div class="card-body progress-list">
        ${progressRow('PRD → FR', data.traceability.prdToFr.percent, `${data.traceability.prdToFr.linked}/${data.traceability.prdToFr.total} 个PRD已关联FR`)}
        ${progressRow('FR → 测试用例', data.traceability.frToTestCase.percent, `${data.traceability.frToTestCase.linked}/${data.traceability.frToTestCase.total} 个FR已关联测试用例`)}
      </div></div>
    </section>
    <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>${titleWithTipV070('项目硬件软件包覆盖', analyticsRuleV070.hardware)}</h3><span class="muted">按7类标准硬件检查当前正式版本</span></div><div class="table-wrap">
      ${data.hardwareCoverage.length ? `<table><thead><tr><th>项目</th><th>覆盖率</th><th>已覆盖</th><th>缺失类别</th></tr></thead><tbody>${data.hardwareCoverage.map(x => `<tr><td><strong>${esc(x.projectName)}</strong><div class="muted">${esc(x.projectCode)}</div></td><td><div class="compact-progress"><span style="width:${x.percent}%"></span></div><strong>${x.percent}%</strong></td><td>${esc(x.covered)} / ${esc(x.expected)}</td><td>${x.missing.length ? x.missing.map(v => `<span class="badge deprecated">${esc(v)}</span>`).join(' ') : '<span class="badge released">完整</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无项目数据</div>'}
    </div></section>
    <section class="card"><div class="card-head"><h3>${titleWithTipV070('数据问题清单', analyticsRuleV070.issues)}</h3><span class="muted">最多显示100项</span></div><div class="table-wrap">
      ${data.issues.length ? `<table><thead><tr><th>交付物</th><th>部门/类型</th><th>项目</th><th>完整度</th><th>缺失字段</th><th>最近更新</th><th>操作</th></tr></thead><tbody>${data.issues.map(x => `<tr><td><strong>${esc(x.name)}</strong><div class="code">${esc(x.code)}</div></td><td>${esc(x.department)}<div class="muted">${esc(x.type)}</div></td><td>${esc(x.project)}</td><td><strong>${x.percent}%</strong></td><td class="tag-list">${x.missing.map(v => `<span class="badge pending_assessment">${esc(v)}</span>`).join(' ') || '<span class="badge released">完整</span>'}</td><td>${esc(fmtDate(x.updatedAt))}</td><td><a class="btn btn-light btn-sm" href="#/deliverables/${x.id}">查看详情</a></td></tr>`).join('')}</tbody></table>` : '<div class="empty">没有发现缺失或超期数据</div>'}
    </div></section>`;
}

const deliverableCodeRuleV070 = "生成结构：AD-部门编码-交付物类型编码-项目编码-对象编码-三位流水号。\n示例：AD-PROD-PRD-A10-HNOA-001。\n对象编码会自动转为大写并清理非法字符；同一编码前缀下流水号从001递增。\n交付物编码由系统创建时生成，不允许用户手工修改；归档不会释放或复用原编码。";

async function loadDeliverables() {
  const form = byId('deliverable-filters');
  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);
  state.lastDeliverableFilters = Object.fromEntries(params.entries());
  params.set('page', state.deliverablePage);
  params.set('pageSize', state.deliverablePageSize);
  const data = await api(`/internal/deliverables?${params}`);
  byId('deliverable-total').textContent = `共 ${data.total} 项`;
  byId('deliverable-list').innerHTML = data.items.length ? `
    <table><thead><tr><th>${titleWithTipV070('交付物编码', deliverableCodeRuleV070)}</th><th>统一名称</th><th>部门/类型</th><th>项目</th><th>当前版本</th><th>状态</th><th>责任人</th><th>私密/分享</th><th>最近更新</th><th>操作</th></tr></thead>
    <tbody>${data.items.map(x => `<tr>
      <td class="code">${esc(x.code)}</td><td><strong>${esc(x.name)}</strong><div class="muted">对象：${esc(x.objectCode)}</div></td>
      <td>${esc(x.department)}<div class="muted">${esc(x.type)}</div></td><td>${esc(x.project)}</td>
      <td>${esc(x.currentVersion || '—')}</td><td>${statusBadge(x.versionStatus || 'DRAFT')}</td><td>${esc(x.responsiblePerson)}</td>
      <td>${esc(confidentialityNames[x.confidentiality] || x.confidentiality)}<div class="muted">${esc(shareNames[x.sharePolicy] || x.sharePolicy)}</div></td>
      <td>${esc(fmtDate(x.updatedAt))}</td><td><div class="inline-actions"><a class="btn btn-light btn-sm" href="#/deliverables/${x.id}">详情</a><button type="button" class="btn btn-light btn-sm view-change-timeline" data-id="${x.id}">变更记录</button>${x.serverPath ? `<button type="button" class="btn btn-light btn-sm copy-path" data-path="${esc(x.serverPath)}">复制路径</button>` : ''}</div></td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">没有符合条件的交付物</div>';
  document.querySelectorAll('.copy-path').forEach(btn => btn.onclick = () => copyText(btn.dataset.path));
  document.querySelectorAll('.view-change-timeline').forEach(btn => btn.onclick = () => {
    const item = data.items.find(x => x.id === Number(btn.dataset.id));
    openChangeTimelineDrawerV070(item);
  });
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  byId('deliverable-pagination').innerHTML = `<div class="pagination"><button type="button" class="btn btn-light btn-sm" id="prev-page" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${data.page} / ${totalPages} 页</span><button type="button" class="btn btn-light btn-sm" id="next-page" ${data.page >= totalPages ? 'disabled' : ''}>下一页</button></div>`;
  byId('prev-page').onclick = () => { state.deliverablePage--; loadDeliverables(); };
  byId('next-page').onclick = () => { state.deliverablePage++; loadDeliverables(); };
}

function drawerRootV070() {
  let root = byId('drawer-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'drawer-root';
    document.body.appendChild(root);
  }
  return root;
}

function closeChangeTimelineDrawerV070() {
  drawerRootV070().replaceChildren();
  document.body.style.overflow = '';
}

async function openChangeTimelineDrawerV070(deliverable) {
  const root = drawerRootV070();
  document.body.style.overflow = 'hidden';
  root.innerHTML = `<div class="drawer-backdrop"></div><aside class="side-drawer" aria-label="交付物变更记录"><div class="drawer-head"><div><h3>${esc(deliverable.name)}</h3><p>${esc(deliverable.code)} · 变更时间线（由近到远）</p></div><button type="button" class="drawer-close" aria-label="关闭">×</button></div><div class="drawer-body"><div class="loading">正在加载变更记录…</div></div></aside>`;
  root.querySelector('.drawer-close').onclick = closeChangeTimelineDrawerV070;
  root.querySelector('.drawer-backdrop').onclick = closeChangeTimelineDrawerV070;
  try {
    const data = await api(`/internal/change-workflow/deliverable/${deliverable.id}`);
    const body = root.querySelector('.drawer-body');
    body.innerHTML = data.items.length ? `<div class="change-timeline">${data.items.map(x => `
      <article class="timeline-item">
        <div class="timeline-head"><strong>${esc(fmtDate(x.updatedAt))}</strong>${statusBadge(x.status)}</div>
        <div><span class="code">${esc(x.code)}</span> · ${esc(x.reason)}</div>
        <div class="muted text-wrap" style="margin-top:7px">${esc(x.content)}</div>
        <div class="timeline-version"><span>${esc(x.fromVersion || '无正式版本')}</span><span>→</span><strong>${esc(x.toVersion || '尚未创建')}</strong></div>
        <div class="timeline-meta"><span>发起人：${esc(x.applicant)}</span><span>责任人：${esc(x.responsiblePerson)}</span><span>审批人：${esc(x.reviewer || '—')}</span><span>审批意见：${esc(x.reviewOpinion || '—')}</span><span>创建：${esc(fmtDate(x.createdAt))}</span><span>完成：${esc(fmtDate(x.actualCompletionDate))}</span></div>
        ${x.toVersionId ? `<a class="btn btn-light btn-sm change-version-link" href="#/deliverables/${x.deliverableId}" onclick="closeChangeTimelineDrawerV070()">查看变更版本</a>` : ''}
      </article>`).join('')}</div>` : '<div class="empty">该交付物暂无变更记录</div>';
  } catch (error) {
    root.querySelector('.drawer-body').innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`;
  }
}

function commonVersionFields(prefix = '', mode = 'initial', preview = null, summary = '') {
  const isInitial = mode === 'initial';
  const versionFields = isInitial ? `
    <input type="hidden" name="${prefix}internalVersion" value="V1.0.0">
    <div class="field"><label>内部版本号</label><input value="V1.0.0" readonly><small class="muted">首个版本固定从V1.0.0开始</small></div>` : `
    <div class="field"><label>版本类型 *</label><select name="${prefix}incrementType" required><option value="PATCH">修订版本</option><option value="MINOR">功能版本</option><option value="MAJOR">重大版本</option></select></div>
    <input type="hidden" name="${prefix}internalVersion" value="${esc(preview?.nextVersion || '')}">
    <div class="field span-2 version-preview" id="${prefix}version-preview"><div class="version-preview-line"><span>原版本：</span><strong class="version-base">${esc(preview?.baseVersion || '—')}</strong><span>→ 新版本：</span><strong class="version-next">${esc(preview?.nextVersion || '—')}</strong></div><small class="version-rule">${esc(preview?.rule || '')}</small></div>`;
  return `${versionFields}
    <div class="field"><label>原始/供应商版本号</label><input name="${prefix}originalVersion"></div>
    <div class="field"><label>原始文件名 *</label><input name="${prefix}originalFileName" required></div>
    <div class="field"><label>服务器文件路径 *</label><input name="${prefix}serverPath" required placeholder="\\\\FileServer\\ADDeliverables\\..."></div>
    <div class="field"><label>编制人/提供人 *</label><input name="${prefix}author" required></div>
    <div class="field"><label>计划发布日期</label><input name="${prefix}plannedReleaseDate" type="date"></div>
    <div class="field"><label>校验算法</label><select name="${prefix}hashAlgorithm"><option value="">无</option><option>SHA256</option><option>MD5</option></select></div>
    <div class="field"><label>校验值</label><input name="${prefix}hashValue"></div>
    <div class="field span-2"><label>版本变更摘要</label><textarea name="${prefix}changeSummary">${esc(summary)}</textarea></div>`;
}

async function refreshVersionPreviewV070(deliverableId, prefix, incrementType) {
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
    const form = byId('version-form');
    form.elements.v_incrementType.onchange = async event => {
      try { await refreshVersionPreviewV070(deliverableId, 'v_', event.target.value); }
      catch (error) { toast(error.message, 'error'); }
    };
  } catch (error) {
    toast(error.message, 'error');
  }
}

function buildVersionPayload(f, typeCode, prefix = '') {
  const numOrNull = name => f.get(name) ? Number(f.get(name)) : null;
  const payload = {
    internalVersion: f.get(prefix + 'internalVersion'),
    originalVersion: f.get(prefix + 'originalVersion'),
    originalFileName: f.get(prefix + 'originalFileName'),
    serverPath: f.get(prefix + 'serverPath'),
    hashAlgorithm: f.get(prefix + 'hashAlgorithm'),
    hashValue: f.get(prefix + 'hashValue'),
    changeSummary: f.get(prefix + 'changeSummary'),
    author: f.get(prefix + 'author'),
    plannedReleaseDate: f.get(prefix + 'plannedReleaseDate') || null,
    operator: operatorName()
  };
  if (typeCode === 'SWP') payload.hardware = {
    hardwareCategory: f.get('hardwareCategory'), hardwareModel: f.get('hardwareModel'), supplierName: f.get('supplierName'),
    softwarePackageType: f.get('softwarePackageType'), supplierPartNumber: f.get('supplierPartNumber'), internalPartNumber: f.get('internalPartNumber'),
    compatibleHardwareVersion: f.get('compatibleHardwareVersion'), compatiblePlatform: f.get('compatiblePlatform'), flashMethod: f.get('flashMethod'),
    flashTool: f.get('flashTool'), dependencyDescription: f.get('dependencyDescription'), releaseNotePath: f.get('releaseNotePath'), flashGuidePath: f.get('flashGuidePath'), remark: f.get('remark')
  };
  if (typeCode === 'PRD') payload.prd = {
    productModule: f.get('productModule'), functionName: f.get('functionName'), requirementSource: f.get('requirementSource'), targetVehicle: f.get('targetVehicle'),
    targetProductVersion: f.get('targetProductVersion'), targetMilestone: f.get('targetMilestone'), productOwner: f.get('productOwner'), reviewers: f.get('reviewers'), referenceBasis: f.get('referenceBasis'), inScope: f.get('inScope'), outOfScope: f.get('outOfScope')
  };
  if (typeCode === 'FR') payload.fr = {
    systemName: f.get('systemName'), subsystemName: f.get('subsystemName'), functionModule: f.get('functionModule'), upstreamPrdCode: f.get('upstreamPrdCode'),
    upstreamPrdVersion: f.get('upstreamPrdVersion'), functionOwner: f.get('functionOwner'), systemOwner: f.get('systemOwner'), targetSoftwareBaseline: f.get('targetSoftwareBaseline'), targetMilestone: f.get('frTargetMilestone'), interfaceImpact: f.get('interfaceImpact'), safetyLevel: f.get('safetyLevel')
  };
  if (typeCode === 'TC') payload.testCase = {
    testLevel: f.get('testLevel'), testModule: f.get('testModule'), upstreamFrCode: f.get('upstreamFrCode'), upstreamFrVersion: f.get('upstreamFrVersion'),
    caseCount: numOrNull('caseCount'), coverageScope: f.get('coverageScope'), testEnvironment: f.get('testEnvironment'), testOwner: f.get('testOwner'), applicableSoftwareVersion: f.get('applicableSoftwareVersion'),
    automatedCaseCount: numOrNull('automatedCaseCount'), manualCaseCount: numOrNull('manualCaseCount')
  };
  return payload;
}

const changeTypeNamesV070 = {
  CONTENT_CHANGE: '内容变更', VERSION_CHANGE: '版本变更', PATH_CHANGE: '路径变更', SECURITY_CHANGE: '权限属性变更'
};

function changeButtonsV070(x) {
  const buttons = [];
  if (x.status === 'PENDING_ASSESSMENT' && canApprove()) {
    buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-change-action="approve" data-change-id="${x.id}">批准</button>`);
    buttons.push(`<button type="button" class="btn btn-danger btn-sm" data-change-action="reject" data-change-id="${x.id}">驳回</button>`);
  }
  if (x.status === 'APPROVED' && canEdit())
    buttons.push(`<button type="button" class="btn btn-light btn-sm" data-change-action="start" data-change-id="${x.id}">开始实施</button>`);
  if (x.status === 'IMPLEMENTING' && canEdit() && !x.toVersionId)
    buttons.push(`<button type="button" class="btn btn-primary btn-sm create-change-version" data-change-id="${x.id}">创建变更版本</button>`);
  if (x.status === 'IMPLEMENTING' && canEdit() && x.toVersionId)
    buttons.push(`<button type="button" class="btn btn-light btn-sm" data-change-action="verify" data-change-id="${x.id}">提交验证</button>`);
  if (x.status === 'PENDING_VERIFICATION' && canApprove())
    buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-change-action="close" data-change-id="${x.id}">确认关闭</button>`);
  if (x.toVersionId)
    buttons.push(`<a class="btn btn-light btn-sm" href="#/deliverables/${x.deliverableId}">查看版本</a>`);
  return buttons.join('') || '<span class="muted">—</span>';
}

async function renderChanges() {
  setPage('变更管理', '变更记录与交付物前后版本形成闭环');
  const status = state.changeStatusFilter || '';
  const data = await api(`/internal/change-workflow${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  const statusOptions = ['', 'PENDING_ASSESSMENT', 'APPROVED', 'REJECTED', 'IMPLEMENTING', 'PENDING_VERIFICATION', 'CLOSED'];
  content.innerHTML = `<section class="card">
    <div class="card-head"><div class="toolbar">${canEdit() ? '<button type="button" id="new-change" class="btn btn-primary">+ 发起变更</button>' : ''}<button type="button" id="export-changes" class="btn btn-light">导出CSV</button><label class="inline-filter">状态<select id="change-status-filter">${statusOptions.map(x => `<option value="${x}" ${x === status ? 'selected' : ''}>${x ? statusNames[x] : '全部'}</option>`).join('')}</select></label></div><span class="muted">共 ${data.items.length} 项</span></div>
    <div class="table-wrap">${data.items.length ? `<table><thead><tr><th>变更编号</th><th>交付物</th><th>变更内容</th><th>版本链路</th><th>提出/责任人</th><th>状态</th><th>评审</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${data.items.map(x => `<tr>
      <td><span class="code">${esc(x.code)}</span><div class="muted">${esc(changeTypeNamesV070[x.changeType] || x.changeType)}</div></td>
      <td><a href="#/deliverables/${x.deliverableId}"><strong>${esc(x.deliverableName)}</strong><div class="muted">${esc(x.deliverableCode)}</div></a></td>
      <td><strong>${esc(x.reason)}</strong><div class="muted text-wrap">${esc(x.content)}</div></td>
      <td><span class="timeline-version"><span>${esc(x.fromVersion || '无正式版本')}</span><span>→</span><strong>${esc(x.toVersion || '尚未创建')}</strong></span>${x.toVersionStatus ? `<div>${statusBadge(x.toVersionStatus)}</div>` : ''}</td>
      <td>${esc(x.applicant)} / ${esc(x.responsiblePerson)}</td><td>${statusBadge(x.status)}</td>
      <td>${esc(x.reviewer || '—')}<div class="muted text-wrap">${esc(x.reviewOpinion || '')}</div></td><td>${esc(fmtDate(x.updatedAt))}</td>
      <td><div class="inline-actions">${changeButtonsV070(x)}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无变更记录</div>'}</div>
  </section>`;
  if (canEdit()) byId('new-change').onclick = openChangeForm;
  byId('export-changes').onclick = () => openCsvExport('changes', { status: state.changeStatusFilter || null });
  byId('change-status-filter').onchange = event => { state.changeStatusFilter = event.target.value; renderChanges(); };
  document.querySelectorAll('[data-change-action]').forEach(btn => btn.onclick = () => runChangeAction(btn));
  document.querySelectorAll('.create-change-version').forEach(btn => btn.onclick = () => {
    const change = data.items.find(x => x.id === Number(btn.dataset.changeId));
    openVersionForm(change.deliverableId, change.typeCode, {
      changeId: change.id,
      changeSummary: `变更${change.code}：${change.reason}\n${change.content}`,
      returnToChanges: true
    });
  });
}

async function openChangeForm() {
  const list = await api('/internal/deliverables?page=1&pageSize=100');
  const body = `<form id="change-form"><div class="alert">提交后系统会自动锁定该交付物当前有效版本作为“变更前版本”。变更实施时需创建并关联新版本，新版本正式发布后才能关闭变更。</div><div class="form-grid">
    <div class="field span-2"><label>交付物 *</label><select name="deliverableId" required><option value="">请选择</option>${list.items.map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)} · 当前${esc(x.currentVersion || '无正式版本')}</option>`).join('')}</select></div>
    <div class="field"><label>变更类型</label><select name="changeType"><option value="CONTENT_CHANGE">内容变更</option><option value="VERSION_CHANGE">版本变更</option><option value="PATH_CHANGE">路径变更</option><option value="SECURITY_CHANGE">权限属性变更</option></select></div>
    <div class="field"><label>关联需求/问题编号</label><input name="relatedIssueCode"></div>
    <div class="field span-2"><label>变更原因 *</label><textarea name="changeReason" required></textarea></div>
    <div class="field span-2"><label>变更内容 *</label><textarea name="changeContent" required></textarea></div>
    <div class="field span-2"><label>影响范围</label><textarea name="impactScope"></textarea></div>
    <div class="field"><label>提出人</label><input value="${esc(operatorName())}" disabled></div>
    <div class="field"><label>责任人 *</label><input name="responsiblePerson" required></div>
    <div class="field"><label>计划完成日期</label><input type="date" name="plannedCompletionDate"></div>
  </div></form>`;
  showModal('发起变更', body, { submitText: '提交变更', onSubmit: async close => {
    const form = byId('change-form');
    if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
    const f = new FormData(form);
    await api('/internal/change-workflow', { method: 'POST', body: JSON.stringify({
      deliverableId: Number(f.get('deliverableId')), changeType: f.get('changeType'),
      changeReason: f.get('changeReason'), changeContent: f.get('changeContent'), impactScope: f.get('impactScope'),
      relatedIssueCode: f.get('relatedIssueCode'), responsiblePerson: f.get('responsiblePerson'),
      plannedCompletionDate: f.get('plannedCompletionDate') || null
    }) });
    close(); toast('变更已发起并关联当前版本'); await renderChanges();
  }});
}
