/* Focused UX improvements for version details, dashboard and completeness analysis. */

function uxMetricCard(label, value, note, tone = '', href = '') {
  const tag = href ? 'a' : 'div';
  const hrefAttr = href ? ` href="${href}"` : '';
  return `<${tag}${hrefAttr} class="ux-metric-card ${tone} ${href ? 'is-link' : ''}"><div class="ux-metric-label">${esc(label)}</div><div class="ux-metric-value">${esc(value)}</div><div class="ux-metric-note">${esc(note)}</div></${tag}>`;
}

renderDashboard = async function () {
  setPage('仪表盘', '交付物、版本和变更状态总览');
  const data = await api('/internal/dashboard');
  const s = data.summary;
  content.innerHTML = `
    <section class="ux-page-intro">
      <div><strong>运营概览</strong><span>快速判断交付物规模、版本积压与变更活跃度</span></div>
      <div class="ux-quick-actions"><a class="btn btn-light btn-sm" href="#/deliverables">查看台账</a><a class="btn btn-light btn-sm" href="#/changes">查看变更</a><a class="btn btn-primary btn-sm" href="#/analytics">完整度分析</a></div>
    </section>
    <section class="ux-metric-grid">
      ${uxMetricCard('交付物总数', `${Number(s.totalDeliverables || 0)} 项`, '当前纳管的有效交付物', 'primary', '#/deliverables')}
      ${uxMetricCard('当前有效版本', `${Number(s.currentVersions || 0)} 个`, '已成为当前有效基线', 'success', '#/deliverables')}
      ${uxMetricCard('待评审版本', `${Number(s.pendingReview || 0)} 个`, '建议优先处理审批积压', Number(s.pendingReview || 0) ? 'warning' : 'success', '#/deliverables')}
      ${uxMetricCard('本月新增版本', `${Number(s.monthlyNewVersions || 0)} 个`, '观察本月版本迭代活跃度', '', '#/deliverables')}
      ${uxMetricCard('本月变更', `${Number(s.monthlyChanges || 0)} 项`, '受控变更流程活跃度', '', '#/changes')}
      ${uxMetricCard('已废止版本', `${Number(s.deprecatedVersions || 0)} 个`, '保留历史记录，不再继续使用', 'muted-tone')}
    </section>
    <section class="ux-dashboard-grid ux-dashboard-grid-main">
      <article class="card ux-chart-card"><div class="card-head"><div><h3>各部门交付物数量</h3><p class="ux-section-note">用于观察交付物在各责任部门间的分布</p></div></div><div class="card-body"><canvas id="department-chart" class="chart"></canvas></div></article>
      <article class="card ux-chart-card"><div class="card-head"><div><h3>版本状态分布</h3><p class="ux-section-note">识别草稿、审批、发布与废止版本占比</p></div></div><div class="card-body"><canvas id="status-chart" class="chart"></canvas><div id="status-legend" class="chart-legend ux-chart-legend"></div></div></article>
    </section>
    <section class="card ux-chart-card ux-full-card"><div class="card-head"><div><h3>近 6 个月版本与变更趋势</h3><p class="ux-section-note">对比新增版本、正式发布与变更数量的变化趋势</p></div></div><div class="card-body"><canvas id="trend-chart" class="chart ux-trend-chart"></canvas></div></section>
    <section class="ux-dashboard-grid">
      <article class="card ux-chart-card"><div class="card-head"><div><h3>交付物类型分布</h3><p class="ux-section-note">观察不同类型交付物的资产规模</p></div></div><div class="card-body"><canvas id="type-chart" class="chart"></canvas></div></article>
      <article class="card"><div class="card-head"><div><h3>最近更新</h3><p class="ux-section-note">最近发生版本更新的交付物</p></div><a class="btn btn-light btn-sm" href="#/deliverables">全部台账</a></div><div class="card-body ux-recent-list">
        ${data.recent.length ? data.recent.map(x => `<a class="ux-recent-row" href="#/deliverables/${x.id}"><div class="ux-recent-main"><strong>${esc(x.name)}</strong><small><span class="code">${esc(x.code)}</span><span>版本 ${esc(x.version)}</span></small></div>${statusBadge(x.status)}</a>`).join('') : '<div class="empty">暂无交付物版本</div>'}
      </div></article>
    </section>`;
  requestAnimationFrame(() => {
    drawBarChart(byId('department-chart'), data.departmentDistribution);
    drawDonutChart(byId('status-chart'), data.statusDistribution, byId('status-legend'));
    drawLineChart(byId('trend-chart'), data.monthlyTrend);
    drawBarChart(byId('type-chart'), data.typeDistribution);
  });
};

renderAnalytics = async function () {
  setPage('完整度分析', '识别元数据缺失、追溯断点、硬件覆盖和待处理事项');
  const data = await api('/internal/analytics/completeness');
  const s = data.summary;
  const hardwareExpected = data.hardwareCoverage.length ? Math.max(...data.hardwareCoverage.map(x => Number(x.expected || 0))) : 0;
  const issueCount = data.issues.length;
  content.innerHTML = `
    <section class="ux-page-intro">
      <div><strong>数据质量体检</strong><span>从元数据、需求追溯、软件包覆盖和时效性四个维度定位治理缺口</span></div>
      <div class="ux-quick-actions"><a class="btn btn-light btn-sm" href="#/deliverables">回到台账整改</a></div>
    </section>
    <section class="ux-metric-grid analytics-stats">
      ${uxMetricCard('元数据完整度', `${s.metadataPercent}%`, `${s.completeDeliverables}/${s.deliverables} 项完全完整`, s.metadataPercent >= 90 ? 'success' : 'warning')}
      ${uxMetricCard('PRD → FR 追溯', `${s.prdTracePercent}%`, '已建立派生关系', s.prdTracePercent >= 90 ? 'success' : 'warning')}
      ${uxMetricCard('FR → 测试用例', `${s.frTestTracePercent}%`, '已建立验证关系', s.frTestTracePercent >= 90 ? 'success' : 'warning')}
      ${uxMetricCard('待审批版本', `${s.pendingReview} 个`, '需要审批者处理', s.pendingReview ? 'warning' : 'success')}
      ${uxMetricCard('未关闭变更', `${s.pendingChanges} 项`, '待评估 / 实施 / 验证', s.pendingChanges ? 'warning' : 'success', '#/changes')}
      ${uxMetricCard('超 90 天未更新', `${s.stale} 项`, '建议确认数据是否仍有效', s.stale ? 'danger-tone' : 'success')}
    </section>
    <section class="ux-dashboard-grid">
      <article class="card"><div class="card-head"><div><h3>部门元数据完整度</h3><p class="ux-section-note">按部门查看交付物必填信息完成情况</p></div></div><div class="card-body progress-list ux-progress-list">${data.departmentCompleteness.map(x => progressRow(x.name, x.percent, `${x.complete}/${x.total} 项完全完整`)).join('') || '<div class="empty">暂无数据</div>'}</div></article>
      <article class="card"><div class="card-head"><div><h3>需求追溯完整度</h3><p class="ux-section-note">检查需求从产品到功能再到测试的链路完整性</p></div></div><div class="card-body progress-list ux-progress-list">${progressRow('PRD → FR', data.traceability.prdToFr.percent, `${data.traceability.prdToFr.linked}/${data.traceability.prdToFr.total} 个 PRD 已关联 FR`)}${progressRow('FR → 测试用例', data.traceability.frToTestCase.percent, `${data.traceability.frToTestCase.linked}/${data.traceability.frToTestCase.total} 个 FR 已关联测试用例`)}</div></article>
    </section>
    <section class="card ux-full-card"><div class="card-head"><div><h3>项目硬件软件包覆盖</h3><p class="ux-section-note">覆盖标准实时取自“基础设置 → 交付物类别”中启用的硬件软件包类别${hardwareExpected ? `，当前共 ${hardwareExpected} 类` : ''}</p></div></div><div class="table-wrap ux-table-wrap">${data.hardwareCoverage.length ? `<table><thead><tr><th>项目</th><th>覆盖率</th><th>覆盖情况</th><th>缺失类别</th></tr></thead><tbody>${data.hardwareCoverage.map(x => `<tr><td><strong>${esc(x.projectName)}</strong><div class="muted">${esc(x.projectCode)}</div></td><td><div class="ux-percent-cell"><strong>${x.percent}%</strong><div class="compact-progress"><span style="width:${x.percent}%"></span></div></div></td><td><strong>${esc(x.covered)} / ${esc(x.expected)}</strong><div class="muted">已配置正式软件包类别</div></td><td class="tag-list">${x.missing.length ? x.missing.map(v => `<span class="badge deprecated">${esc(v)}</span>`).join(' ') : '<span class="badge released">已完整覆盖</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无项目数据</div>'}</div></section>
    <section class="card"><div class="card-head"><div><h3>待整改数据</h3><p class="ux-section-note">存在字段缺失或长期未更新的交付物，最多显示 100 项</p></div><span class="ux-count-badge">${issueCount} 项</span></div><div class="table-wrap ux-table-wrap">${issueCount ? `<table><thead><tr><th>交付物</th><th>部门 / 类型</th><th>项目</th><th>完整度</th><th>待补充字段</th><th>最近更新</th><th>操作</th></tr></thead><tbody>${data.issues.map(x => `<tr><td><strong>${esc(x.name)}</strong><div class="code">${esc(x.code)}</div></td><td>${esc(x.department)}<div class="muted">${esc(x.type)}</div></td><td>${esc(x.project)}</td><td><div class="ux-score ${x.percent >= 90 ? 'good' : x.percent >= 70 ? 'mid' : 'low'}">${x.percent}%</div></td><td class="tag-list">${x.missing.map(v => `<span class="badge pending_assessment">${esc(v)}</span>`).join(' ') || '<span class="badge released">完整</span>'}</td><td>${esc(fmtDate(x.updatedAt))}</td><td><a class="btn btn-light btn-sm" href="#/deliverables/${x.id}">去完善</a></td></tr>`).join('')}</tbody></table>` : '<div class="ux-empty-success"><strong>当前没有发现数据问题</strong><span>元数据、时效性与当前检查规则均未发现待整改项。</span></div>'}</div></section>`;
};

openVersionDetails = async function (versionId) {
  try {
    const data = await api(`/internal/version-details/${versionId}`);
    const c = data.common || {};
    const labels = {
      id:'版本 ID',internalVersion:'内部版本号',originalVersion:'原始 / 供应商版本号',originalFileName:'原始文件名',unifiedFileName:'统一文件名',previousVersionId:'上一版本 ID',serverPath:'服务器路径',fileExtension:'文件格式',fileSize:'文件大小',hashAlgorithm:'校验算法',hashValue:'校验值',status:'版本状态',changeSummary:'版本变更摘要',confidentiality:'私密等级',sharePolicy:'对外分享',author:'编制 / 提供人',reviewer:'评审人',approver:'审批 / 发布人',plannedReleaseDate:'计划发布日期',releaseDate:'正式发布日期',effectiveDate:'生效日期',expiryDate:'失效日期',isCurrent:'当前版本',createdBy:'创建人',createdAt:'创建时间',updatedAt:'更新时间',deliverableCode:'交付物编码',deliverableName:'交付物名称',typeCode:'交付物类型编码',typeName:'交付物类型',projectCode:'项目编码',projectName:'项目名称'
    };
    const value = (key, raw) => {
      if (raw === null || raw === undefined || raw === '') return '—';
      if (key === 'status') return statusNames[raw] || raw;
      if (key === 'confidentiality') return confidentialityNames[raw] || raw;
      if (key === 'sharePolicy') return shareNames[raw] || raw;
      if (key === 'isCurrent') return Number(raw) === 1 ? '是' : '否';
      if (['createdAt','updatedAt','plannedReleaseDate','releaseDate','effectiveDate','expiryDate'].includes(key)) return fmtDate(raw);
      if (key === 'fileSize') { const bytes=Number(raw); if(!Number.isFinite(bytes)||bytes<0)return String(raw); if(bytes>=1048576)return `${(bytes/1048576).toFixed(2)} MB`; if(bytes>=1024)return `${(bytes/1024).toFixed(2)} KB`; return `${bytes} B`; }
      return String(raw);
    };
    const group = (title, note, keys) => {
      const html = keys.filter(k => Object.prototype.hasOwnProperty.call(c,k)).map(k => `<div class="ux-detail-field ${['serverPath','originalFileName','unifiedFileName','changeSummary','hashValue'].includes(k)?'wide':''}"><span>${esc(labels[k]||k)}</span><strong ${k==='serverPath' ? `title="${esc(value(k,c[k]))}"` : ''}>${esc(value(k,c[k]))}</strong>${k==='serverPath' && c[k] ? `<button type="button" class="ux-inline-copy" data-copy-version-path="${esc(c[k])}">复制路径</button>` : ''}</div>`).join('');
      return html ? `<section class="ux-detail-section"><div class="ux-detail-section-title"><div><h4>${esc(title)}</h4><p>${esc(note)}</p></div></div><div class="ux-detail-grid">${html}</div></section>` : '';
    };
    const specificEntries = Object.entries(data.specific || {});
    const specific = specificEntries.length ? `<section class="ux-detail-section"><div class="ux-detail-section-title"><div><h4>${esc(c.typeName || '类型专属信息')}</h4><p>该交付物类型特有的版本属性</p></div></div><div class="ux-detail-grid">${specificEntries.map(([k,v])=>`<div class="ux-detail-field"><span>${esc(k)}</span><strong>${esc(v===null||v===undefined||v===''?'—':String(v))}</strong></div>`).join('')}</div></section>` : '';
    const body = `<div class="ux-version-hero"><div><div class="ux-version-title"><strong>${esc(c.internalVersion||'')}</strong>${statusBadge(c.status)}</div><div class="ux-version-sub"><span class="code">${esc(c.deliverableCode||'')}</span><span>${esc(c.deliverableName||'')}</span></div></div><div class="ux-version-flags">${Number(c.isCurrent)===1?'<span class="badge released">当前有效版本</span>':''}<span class="badge">${esc(c.projectName||c.projectCode||'未关联项目')}</span></div></div>${group('版本与文件','版本标识、文件位置及完整性校验信息',['internalVersion','originalVersion','previousVersionId','originalFileName','unifiedFileName','serverPath','fileExtension','fileSize','hashAlgorithm','hashValue','changeSummary'])}${group('状态与权限','版本当前状态及文件使用范围',['status','isCurrent','confidentiality','sharePolicy'])}${group('人员与时间','编制、评审、审批及计划 / 实际发布时间',['author','reviewer','approver','plannedReleaseDate','releaseDate','effectiveDate','expiryDate','createdBy','createdAt','updatedAt'])}${specific}`;
    showModal('版本详情', body, { submitText:'关闭', onSubmit:async close=>close() });
    setTimeout(()=>document.querySelectorAll('[data-copy-version-path]').forEach(btn=>btn.onclick=()=>copyText(btn.dataset.copyVersionPath)),0);
  } catch (error) { toast(error.message,'error'); }
};
