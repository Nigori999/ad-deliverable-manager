async function renderAnalytics() {
  setPage('完整度分析', '识别元数据缺失、追溯断点、硬件覆盖和待处理事项');
  const data = await api('/internal/analytics/completeness');
  const s = data.summary;
  content.innerHTML = `
    <section class="stat-grid analytics-stats">
      ${metricCard('元数据完整度', `${s.metadataPercent}%`, `${s.completeDeliverables}/${s.deliverables} 项完全完整`, s.metadataPercent)}
      ${metricCard('PRD→FR追溯', `${s.prdTracePercent}%`, '已建立派生关系', s.prdTracePercent)}
      ${metricCard('FR→测试用例', `${s.frTestTracePercent}%`, '已建立验证关系', s.frTestTracePercent)}
      ${metricCard('待审批版本', s.pendingReview, '需要审批者处理')}
      ${metricCard('未关闭变更', s.pendingChanges, '待评估/实施/验证')}
      ${metricCard('超90天未更新', s.stale, '建议确认有效性')}
    </section>

    <section class="dashboard-grid">
      <div class="card"><div class="card-head"><h3>部门元数据完整度</h3></div><div class="card-body progress-list">
        ${data.departmentCompleteness.map(x => progressRow(x.name, x.percent, `${x.complete}/${x.total} 项完全完整`)).join('') || '<div class="empty">暂无数据</div>'}
      </div></div>
      <div class="card"><div class="card-head"><h3>需求追溯完整度</h3></div><div class="card-body progress-list">
        ${progressRow('PRD → FR', data.traceability.prdToFr.percent, `${data.traceability.prdToFr.linked}/${data.traceability.prdToFr.total} 个PRD已关联FR`)}
        ${progressRow('FR → 测试用例', data.traceability.frToTestCase.percent, `${data.traceability.frToTestCase.linked}/${data.traceability.frToTestCase.total} 个FR已关联测试用例`)}
      </div></div>
    </section>

    <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>项目硬件软件包覆盖</h3><span class="muted">按7类标准硬件检查当前正式版本</span></div><div class="table-wrap">
      ${data.hardwareCoverage.length ? `<table><thead><tr><th>项目</th><th>覆盖率</th><th>已覆盖</th><th>缺失类别</th></tr></thead><tbody>${data.hardwareCoverage.map(x => `<tr><td><strong>${esc(x.projectName)}</strong><div class="muted">${esc(x.projectCode)}</div></td><td><div class="compact-progress"><span style="width:${x.percent}%"></span></div><strong>${x.percent}%</strong></td><td>${esc(x.covered)} / ${esc(x.expected)}</td><td>${x.missing.length ? x.missing.map(v => `<span class="badge deprecated">${esc(v)}</span>`).join(' ') : '<span class="badge released">完整</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无项目数据</div>'}
    </div></section>

    <section class="card"><div class="card-head"><h3>数据问题清单</h3><span class="muted">最多显示100项</span></div><div class="table-wrap">
      ${data.issues.length ? `<table><thead><tr><th>交付物</th><th>部门/类型</th><th>项目</th><th>完整度</th><th>缺失字段</th><th>最近更新</th><th>操作</th></tr></thead><tbody>${data.issues.map(x => `<tr><td><strong>${esc(x.name)}</strong><div class="code">${esc(x.code)}</div></td><td>${esc(x.department)}<div class="muted">${esc(x.type)}</div></td><td>${esc(x.project)}</td><td><strong>${x.percent}%</strong></td><td class="tag-list">${x.missing.map(v => `<span class="badge pending_assessment">${esc(v)}</span>`).join(' ') || '<span class="badge released">完整</span>'}</td><td>${esc(fmtDate(x.updatedAt))}</td><td><a class="btn btn-light btn-sm" href="#/deliverables/${x.id}">查看详情</a></td></tr>`).join('')}</tbody></table>` : '<div class="empty">没有发现缺失或超期数据</div>'}
    </div></section>`;
}

function metricCard(label, value, note, percent = null) {
  return `<div class="stat-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small>${percent === null ? '' : `<div class="compact-progress"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>`}</div>`;
}

function progressRow(name, percent, note) {
  return `<div class="progress-row"><div><strong>${esc(name)}</strong><small>${esc(note)}</small></div><div class="progress-track"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div><b>${percent}%</b></div>`;
}
