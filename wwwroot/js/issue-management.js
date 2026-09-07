const issuePalette = ['#55d8ff','#7c6cff','#ffb84d','#ff6577','#48d597','#b68cff','#4ba3ff','#f58ac6'];
const issuePageState = { filters: {}, rankingDimension: 'departments', reference: null };

async function renderIssueManagement() {
  setPage('问题管理', '全公司问题存量快照与风险趋势驾驶舱');
  const query = issueFilterQuery();
  const [reference, dashboard, snapshots] = await Promise.all([
    api('/internal/issues/reference-data'),
    api(`/internal/issues/dashboard${query}`),
    api(`/internal/issues/snapshots${query}`)
  ]);
  issuePageState.reference = reference;
  const summary = dashboard.summary || {};
  const latestLabel = dashboard.latestDate || '暂无快照';
  const deltaTone = Number(summary.delta || 0) > 0 ? 'up' : Number(summary.delta || 0) < 0 ? 'down' : 'flat';
  const deltaText = dashboard.previousDate
    ? `${Number(summary.delta || 0) > 0 ? '+' : ''}${Number(summary.delta || 0)} 项${summary.growthRate === null ? '' : ` · ${Number(summary.growthRate) > 0 ? '+' : ''}${summary.growthRate}%`}`
    : '暂无上一统计日';
  content.innerHTML = `
    <section class="issue-hero">
      <div class="issue-hero-orb issue-hero-orb-a"></div><div class="issue-hero-orb issue-hero-orb-b"></div>
      <div class="issue-hero-main">
        <span class="issue-eyebrow">EXECUTIVE ISSUE INTELLIGENCE</span>
        <h2>公司问题全景驾驶舱</h2>
        <p>汇聚各问题系统截至统计日的存量快照，统一观察规模、结构、风险与变化方向。</p>
        <div class="issue-hero-meta"><span><i></i>统计快照：${esc(latestLabel)}</span><span>覆盖 ${Number(dashboard.availableDates?.length || 0)} 个统计日</span><span>${Number(summary.statusCount || 0)} 个动态状态</span></div>
      </div>
      <div class="issue-hero-status">
        ${(dashboard.statusSummary || []).map((x, i) => `<div><span style="--issue-color:${issuePalette[i % issuePalette.length]}">${esc(x.name)}</span><strong>${Number(x.value || 0).toLocaleString('zh-CN')}</strong></div>`).join('') || '<div class="issue-hero-empty">等待录入首份问题快照</div>'}
      </div>
    </section>

    <section class="issue-filter-panel">
      <div class="issue-filter-title"><strong>分析范围</strong><span>核心指标和分类取范围内最新统计日，趋势展示范围内全部快照</span></div>
      <div class="issue-filters">
        ${issueFilterField('开始日期', 'issue-date-from', 'date', issuePageState.filters.dateFrom || '')}
        ${issueFilterField('结束日期', 'issue-date-to', 'date', issuePageState.filters.dateTo || '')}
        ${issueSelectField('部门', 'issue-department-filter', reference.departments, issuePageState.filters.departmentItemId, '全部部门')}
        ${issueSelectField('问题来源', 'issue-source-filter', reference.sources, issuePageState.filters.sourceItemId, '全部来源')}
        ${issueSelectField('严重等级', 'issue-severity-filter', reference.severities, issuePageState.filters.severityItemId, '全部等级')}
        <div class="issue-filter-actions"><button class="btn btn-light" type="button" id="issue-filter-reset">重置</button><button class="btn btn-primary" type="button" id="issue-filter-apply">应用筛选</button></div>
      </div>
    </section>

    <section class="issue-metric-grid">
      ${issueMetric('问题总量', summary.total, `截至 ${latestLabel}`, 'primary', '∑')}
      ${issueMetric('较上一统计日', deltaText, dashboard.previousDate ? `对比 ${dashboard.previousDate}` : '录入更多日期后自动计算', deltaTone, deltaTone === 'up' ? '↗' : deltaTone === 'down' ? '↘' : '—', true)}
      ${issueMetric(summary.criticalLabel || '最高严重等级', summary.criticalTotal, '当前最高风险等级问题', 'danger', '!')}
      ${issueMetric('问题最多部门', summary.topDepartment || '—', `${Number(summary.topDepartmentTotal || 0)} 项问题`, 'violet', '⌂', true)}
      ${issueMetric('数据覆盖', dashboard.availableDates?.length || 0, '个有效统计日期', 'cyan', '◫')}
    </section>

    <section class="issue-dashboard-grid issue-dashboard-main">
      <article class="issue-panel issue-trend-panel">
        <div class="issue-panel-head"><div><span class="issue-panel-kicker">GROWTH TREND</span><h3>问题增长趋势</h3><p>每日数值均为截至当日的存量，不跨日期累加</p></div><span class="issue-live-badge"><i></i>动态快照</span></div>
        <div class="issue-trend-wrap">${issueTrendSvg(dashboard.trend || [])}</div>
        <div class="issue-chart-footer">${(dashboard.statusSummary || []).map((x, i) => `<span><i style="background:${issuePalette[i % issuePalette.length]}"></i>${esc(x.name)} ${Number(x.value || 0)}</span>`).join('')}</div>
      </article>
      <article class="issue-panel issue-risk-panel">
        <div class="issue-panel-head"><div><span class="issue-panel-kicker">STATUS MIX</span><h3>最新状态构成</h3><p>${dashboard.latestDate ? `${dashboard.latestDate} 公司问题状态分布` : '暂无统计数据'}</p></div></div>
        ${issueStatusBars(dashboard.statusSummary || [], summary.total || 0)}
      </article>
    </section>

    <section class="issue-section-title"><div><span>COMPOSITION</span><h3>问题分类占比</h3></div><p>从部门、严重等级和问题来源三个维度识别问题集中区域</p></section>
    <section class="issue-share-grid">
      ${issueDonutCard('按部门', dashboard.distributions?.departments || [], 'departmentItemId', 0)}
      ${issueDonutCard('按严重等级', dashboard.distributions?.severities || [], 'severityItemId', 2)}
      ${issueDonutCard('按问题来源', dashboard.distributions?.sources || [], 'sourceItemId', 4)}
    </section>

    <section class="issue-panel issue-ranking-panel">
      <div class="issue-panel-head issue-ranking-head"><div><span class="issue-panel-kicker">STACKED RANKING</span><h3>问题总量排名</h3><p>排名条由动态问题状态堆积组成，直观看到规模与状态结构</p></div><div class="issue-segmented" id="issue-ranking-tabs"><button data-dimension="departments" class="active">按部门</button><button data-dimension="sources">按来源</button><button data-dimension="severities">按严重等级</button></div></div>
      <div id="issue-ranking-chart">${issueRankingHtml(dashboard.rankings?.departments || [], dashboard.statusSummary || [])}</div>
    </section>

    <section class="issue-panel issue-record-panel">
      <div class="issue-panel-head"><div><span class="issue-panel-kicker">SNAPSHOT DATA</span><h3>问题快照明细</h3><p>每天录入各系统截至当天的汇总量；相同日期和维度组合只保留一条</p></div><div class="inline-actions">${hasPermission('DICTIONARY_VIEW') ? '<a class="btn btn-light" href="#/dictionaries">维护问题字典</a>' : ''}${hasPermission('ISSUE_CREATE') ? '<button class="btn btn-primary" type="button" id="issue-new-snapshot" data-permission="ISSUE_CREATE">＋ 录入快照</button>' : ''}</div></div>
      ${issueSnapshotTable(snapshots, reference)}
    </section>`;

  bindIssueManagementEvents(dashboard, snapshots);
}

function issueFilterQuery() {
  const params = new URLSearchParams();
  Object.entries(issuePageState.filters).forEach(([key, value]) => { if (value !== '' && value !== null && value !== undefined) params.set(key, value); });
  const text = params.toString();
  return text ? `?${text}` : '';
}

function issueFilterField(label, id, type, value) {
  return `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" value="${esc(value)}"></div>`;
}

function issueSelectField(label, id, items, selected, emptyLabel) {
  return `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}"><option value="">${esc(emptyLabel)}</option>${(items || []).map(x => `<option value="${x.id}" ${String(x.id) === String(selected || '') ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>`;
}

function issueMetric(label, value, note, tone, icon, textValue = false) {
  const display = textValue ? esc(value ?? '—') : Number(value || 0).toLocaleString('zh-CN');
  return `<article class="issue-metric ${esc(tone)}"><div class="issue-metric-top"><span>${esc(label)}</span><i>${esc(icon)}</i></div><strong class="${textValue ? 'is-text' : ''}">${display}</strong><small>${esc(note)}</small></article>`;
}

function issueTrendSvg(rows) {
  if (!rows.length) return '<div class="issue-chart-empty"><strong>暂无趋势数据</strong><span>录入不同日期的问题快照后，将自动形成增长趋势。</span></div>';
  const width = 920, height = 292, pad = { left: 54, right: 26, top: 28, bottom: 48 };
  const max = Math.max(1, ...rows.map(x => Number(x.total || 0)));
  const xAt = index => rows.length === 1 ? width / 2 : pad.left + (width - pad.left - pad.right) * index / (rows.length - 1);
  const yAt = value => height - pad.bottom - Number(value || 0) / max * (height - pad.top - pad.bottom);
  const points = rows.map((x, i) => `${xAt(i).toFixed(1)},${yAt(x.total).toFixed(1)}`).join(' ');
  const area = `${xAt(0)},${height - pad.bottom} ${points} ${xAt(rows.length - 1)},${height - pad.bottom}`;
  const grid = Array.from({ length: 5 }, (_, i) => {
    const y = pad.top + (height - pad.top - pad.bottom) * i / 4;
    const label = Math.round(max * (4 - i) / 4);
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"/><text x="8" y="${y + 4}">${label}</text>`;
  }).join('');
  const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
  const labels = rows.map((x, i) => (i % labelEvery === 0 || i === rows.length - 1) ? `<text x="${xAt(i)}" y="${height - 17}" text-anchor="middle">${esc(String(x.date).slice(5))}</text>` : '').join('');
  const dots = rows.map((x, i) => `<g><circle cx="${xAt(i)}" cy="${yAt(x.total)}" r="4.5"><title>${esc(x.date)}：${Number(x.total || 0)} 项</title></circle><circle class="issue-trend-hit" cx="${xAt(i)}" cy="${yAt(x.total)}" r="12"><title>${esc(x.date)}：${Number(x.total || 0)} 项</title></circle></g>`).join('');
  return `<svg class="issue-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="问题增长趋势"><defs><linearGradient id="issueTrendArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b7cff" stop-opacity=".34"/><stop offset="1" stop-color="#5b7cff" stop-opacity=".02"/></linearGradient></defs><g class="issue-grid">${grid}${labels}</g><polygon class="issue-trend-area" points="${area}"/><polyline class="issue-trend-line-glow" points="${points}"/><polyline class="issue-trend-line" points="${points}"/>${dots}</svg>`;
}

function issueStatusBars(items, total) {
  if (!items.length || !Number(total)) return '<div class="issue-chart-empty compact"><strong>暂无状态数据</strong><span>录入快照后显示各状态占比。</span></div>';
  return `<div class="issue-status-list">${items.map((x, i) => {
    const percent = Number(total) ? Number(x.value || 0) * 100 / Number(total) : 0;
    return `<div class="issue-status-row"><div><span><i style="background:${issuePalette[i % issuePalette.length]}"></i>${esc(x.name)}</span><strong>${Number(x.value || 0).toLocaleString('zh-CN')}</strong></div><div class="issue-status-track"><span style="width:${Math.max(0, Math.min(100, percent)).toFixed(1)}%;background:${issuePalette[i % issuePalette.length]}"></span></div><small>${percent.toFixed(1)}%</small></div>`;
  }).join('')}</div>`;
}

function issueDonutCard(title, items, dimension, colorOffset) {
  const total = items.reduce((sum, x) => sum + Number(x.value || 0), 0);
  let cursor = 0;
  const stops = total ? items.map((x, i) => {
    const start = cursor; cursor += Number(x.value || 0) * 100 / total;
    return `${issuePalette[(i + colorOffset) % issuePalette.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  }).join(',') : '#e8ecf3 0 100%';
  return `<article class="issue-panel issue-donut-card"><div class="issue-panel-head"><div><h3>${esc(title)}</h3><p>最新统计日 · 共 ${Number(total).toLocaleString('zh-CN')} 项</p></div></div><div class="issue-donut-body"><div class="issue-donut" style="--issue-donut:${stops}"><div><strong>${Number(total).toLocaleString('zh-CN')}</strong><span>问题总量</span></div></div><div class="issue-donut-legend">${items.length ? items.slice(0, 8).map((x, i) => `<button type="button" data-issue-filter="${esc(dimension)}" data-issue-value="${x.id}"><i style="background:${issuePalette[(i + colorOffset) % issuePalette.length]}"></i><span>${esc(x.name)}</span><strong>${Number(x.value || 0)}</strong></button>`).join('') : '<div class="issue-mini-empty">暂无数据</div>'}</div></div></article>`;
}

function issueRankingHtml(rows, statuses) {
  if (!rows.length) return '<div class="issue-chart-empty"><strong>暂无排名数据</strong><span>当前筛选范围尚未录入问题快照。</span></div>';
  const max = Math.max(1, ...rows.map(x => Number(x.total || 0)));
  return `<div class="issue-ranking-legend">${statuses.map((x, i) => `<span><i style="background:${issuePalette[i % issuePalette.length]}"></i>${esc(x.name)}</span>`).join('')}</div><div class="issue-ranking-list">${rows.map((row, index) => `<div class="issue-ranking-row"><div class="issue-rank">${String(index + 1).padStart(2, '0')}</div><div class="issue-rank-name" title="${esc(row.name)}">${esc(row.name)}</div><div class="issue-rank-bar"><div class="issue-rank-stack" style="width:${Math.max(2, Number(row.total || 0) * 100 / max).toFixed(1)}%">${(row.statuses || []).map((x, i) => Number(x.value || 0) ? `<span title="${esc(x.name)}：${Number(x.value)} 项" style="width:${(Number(x.value) * 100 / Math.max(1, Number(row.total))).toFixed(2)}%;background:${issuePalette[i % issuePalette.length]}"><em>${Number(x.value)}</em></span>` : '').join('')}</div></div><strong>${Number(row.total || 0).toLocaleString('zh-CN')}</strong></div>`).join('')}</div>`;
}

function issueSnapshotTable(data, reference) {
  const items = data.items || [];
  if (!items.length) return `<div class="issue-record-empty"><div>◇</div><strong>当前范围没有问题快照</strong><span>录入各系统截至统计日的汇总量，即可生成公司级问题驾驶舱。</span>${hasPermission('ISSUE_CREATE') ? '<button type="button" class="btn btn-primary" id="issue-empty-new" data-permission="ISSUE_CREATE">录入第一份快照</button>' : ''}</div>`;
  const statusMap = new Map((reference.statuses || []).map((x, i) => [Number(x.id), i]));
  return `<div class="table-wrap issue-table-wrap"><table><thead><tr><th>统计日期</th><th>部门</th><th>问题来源</th><th>严重等级</th><th>状态构成</th><th>问题总量</th><th>最后更新</th><th>操作</th></tr></thead><tbody>${items.map(row => `<tr><td><strong>${esc(row.recordDate)}</strong></td><td>${esc(row.department.name)}</td><td>${esc(row.source.name)}</td><td><span class="issue-severity-chip">${esc(row.severity.name)}</span></td><td><div class="issue-count-chips">${(row.counts || []).map(x => `<span style="--chip-color:${issuePalette[(statusMap.get(Number(x.statusItemId)) || 0) % issuePalette.length]}">${esc(x.name)} <b>${Number(x.count)}</b></span>`).join('')}</div></td><td><strong class="issue-total-cell">${Number(row.total || 0)}</strong></td><td><span class="muted">${esc(row.updatedBy)}</span><small class="issue-updated-at">${fmtDate(row.updatedAt)}</small></td><td><div class="inline-actions">${hasPermission('ISSUE_EDIT') ? `<button type="button" class="btn btn-light btn-sm" data-issue-edit="${row.id}" data-permission="ISSUE_EDIT">编辑</button>` : ''}${hasPermission('ISSUE_DELETE') ? `<button type="button" class="btn btn-danger btn-sm" data-issue-delete="${row.id}" data-permission="ISSUE_DELETE">删除</button>` : ''}</div></td></tr>`).join('')}</tbody></table>${data.limited ? '<div class="issue-limit-note">当前最多展示 250 条记录，请缩小日期或维度范围继续查看。</div>' : ''}</div>`;
}

function bindIssueManagementEvents(dashboard, snapshots) {
  byId('issue-filter-apply').onclick = async () => {
    const dateFrom = byId('issue-date-from').value;
    const dateTo = byId('issue-date-to').value;
    if (dateFrom && dateTo && dateFrom > dateTo) return toast('开始日期不能晚于结束日期。', 'error');
    issuePageState.filters = {
      dateFrom, dateTo,
      departmentItemId: byId('issue-department-filter').value,
      sourceItemId: byId('issue-source-filter').value,
      severityItemId: byId('issue-severity-filter').value
    };
    await renderIssueManagement();
  };
  byId('issue-filter-reset').onclick = async () => { issuePageState.filters = {}; await renderIssueManagement(); };
  content.querySelectorAll('[data-issue-filter]').forEach(button => button.onclick = async () => {
    issuePageState.filters[button.dataset.issueFilter] = button.dataset.issueValue;
    await renderIssueManagement();
  });
  content.querySelectorAll('#issue-ranking-tabs button').forEach(button => button.onclick = () => {
    issuePageState.rankingDimension = button.dataset.dimension;
    content.querySelectorAll('#issue-ranking-tabs button').forEach(x => x.classList.toggle('active', x === button));
    byId('issue-ranking-chart').innerHTML = issueRankingHtml(dashboard.rankings?.[issuePageState.rankingDimension] || [], dashboard.statusSummary || []);
  });
  if (issuePageState.rankingDimension !== 'departments') content.querySelector(`#issue-ranking-tabs button[data-dimension="${issuePageState.rankingDimension}"]`)?.click();
  byId('issue-new-snapshot')?.addEventListener('click', () => openIssueSnapshotForm());
  byId('issue-empty-new')?.addEventListener('click', () => openIssueSnapshotForm());
  content.querySelectorAll('[data-issue-edit]').forEach(button => button.onclick = () => openIssueSnapshotForm((snapshots.items || []).find(x => x.id === Number(button.dataset.issueEdit))));
  content.querySelectorAll('[data-issue-delete]').forEach(button => button.onclick = async () => {
    const row = (snapshots.items || []).find(x => x.id === Number(button.dataset.issueDelete));
    const result = await confirmAction('删除问题快照', `确认删除 ${row.recordDate} · ${row.department.name} · ${row.source.name} · ${row.severity.name} 的问题快照吗？删除后驾驶舱将立即重新统计。`, { submitText: '确认删除', danger: true });
    if (!result.confirmed) return;
    await api(`/internal/issues/snapshots/${row.id}`, { method: 'DELETE' });
    toast('问题汇总快照已删除。');
    await renderIssueManagement();
  });
}

function openIssueSnapshotForm(snapshot = null) {
  const reference = issuePageState.reference || {};
  if (!(reference.departments || []).length || !(reference.sources || []).length || !(reference.severities || []).length || !(reference.statuses || []).length) {
    toast('问题管理字典配置不完整，请先在字典管理中补齐部门、来源、严重等级和问题状态。', 'error');
    return;
  }
  const counts = new Map((snapshot?.counts || []).map(x => [Number(x.statusItemId), Number(x.count || 0)]));
  const option = (items, selected) => items.map(x => `<option value="${x.id}" ${Number(x.id) === Number(selected) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const body = `<form id="issue-snapshot-form">
    <div class="issue-form-intro"><strong>${snapshot ? '调整已有统计快照' : '录入截至统计日的问题存量'}</strong><span>请勿填写“当日新增量”。每个状态都应填写该维度组合截至当天的存量数量。</span></div>
    <div class="form-grid">
      <div class="field"><label>统计日期 *</label><input type="date" name="recordDate" max="${localToday}" value="${esc(snapshot?.recordDate || localToday)}" required></div>
      <div class="field"><label>部门 *</label><select name="departmentItemId" required><option value="">请选择部门</option>${option(reference.departments, snapshot?.department?.id)}</select></div>
      <div class="field"><label>问题来源 *</label><select name="sourceItemId" required><option value="">请选择来源</option>${option(reference.sources, snapshot?.source?.id)}</select></div>
      <div class="field"><label>严重等级 *</label><select name="severityItemId" required><option value="">请选择等级</option>${option(reference.severities, snapshot?.severity?.id)}</select></div>
    </div>
    <div class="issue-count-section"><div class="issue-count-head"><div><strong>各状态汇总数量</strong><span>状态项由字典动态生成，仅支持非负整数</span></div><div>合计 <strong id="issue-form-total">0</strong> 项</div></div>
      <div class="issue-count-grid">${reference.statuses.map((status, i) => `<label class="issue-count-input" style="--status-color:${issuePalette[i % issuePalette.length]}"><span><i></i>${esc(status.name)}</span><input type="number" name="status_${status.id}" data-status-id="${status.id}" min="0" step="1" value="${counts.get(Number(status.id)) || 0}" required></label>`).join('')}</div>
    </div>
  </form>`;
  showModal(snapshot ? '编辑问题快照' : '录入问题快照', body, {
    submitText: snapshot ? '保存修改' : '确认录入',
    onSubmit: async close => {
      const form = byId('issue-snapshot-form');
      if (!form.reportValidity()) throw new Error('请完整填写快照信息。');
      const countInputs = [...form.querySelectorAll('[data-status-id]')];
      const countsPayload = countInputs.map(input => ({ statusItemId: Number(input.dataset.statusId), count: Number(input.value) }));
      if (countsPayload.some(x => !Number.isInteger(x.count) || x.count < 0)) throw new Error('各状态数量必须是非负整数。');
      if (!countsPayload.some(x => x.count > 0)) throw new Error('各状态数量不能全部为零。');
      const payload = {
        recordDate: form.elements.recordDate.value,
        departmentItemId: Number(form.elements.departmentItemId.value),
        sourceItemId: Number(form.elements.sourceItemId.value),
        severityItemId: Number(form.elements.severityItemId.value),
        counts: countsPayload,
        revision: snapshot?.revision || 0
      };
      await api(snapshot ? `/internal/issues/snapshots/${snapshot.id}` : '/internal/issues/snapshots', { method: snapshot ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      close(); toast(snapshot ? '问题汇总快照已更新。' : '问题汇总快照已录入。');
      await renderIssueManagement();
    }
  });
  const updateTotal = () => { byId('issue-form-total').textContent = [...byId('issue-snapshot-form').querySelectorAll('[data-status-id]')].reduce((sum, input) => sum + Math.max(0, Number(input.value) || 0), 0).toLocaleString('zh-CN'); };
  byId('issue-snapshot-form').querySelectorAll('[data-status-id]').forEach(input => input.addEventListener('input', updateTotal));
  updateTotal();
}
