async function renderDashboard() {
  setPage('仪表盘', '交付物、版本和变更状态总览');
  const data = await api('/internal/dashboard');
  const s = data.summary;
  content.innerHTML = `
    <section class="stat-grid">
      ${statCard('交付物总数', s.totalDeliverables, '项')}
      ${statCard('当前有效版本', s.currentVersions, '个')}
      ${statCard('待评审版本', s.pendingReview, '个')}
      ${statCard('本月新增版本', s.monthlyNewVersions, '个')}
      ${statCard('本月变更', s.monthlyChanges, '项')}
      ${statCard('已废止版本', s.deprecatedVersions, '个')}
    </section>
    <section class="dashboard-grid">
      <div class="card"><div class="card-head"><h3>各部门交付物数量</h3></div><div class="card-body"><canvas id="department-chart" class="chart"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>版本状态分布</h3></div><div class="card-body"><canvas id="status-chart" class="chart"></canvas><div id="status-legend" class="chart-legend"></div></div></div>
    </section>
    <section class="card" style="margin-bottom:18px"><div class="card-head"><h3>近6个月版本与变更趋势</h3></div><div class="card-body"><canvas id="trend-chart" class="chart"></canvas></div></section>
    <section class="dashboard-grid">
      <div class="card"><div class="card-head"><h3>交付物类型分布</h3></div><div class="card-body"><canvas id="type-chart" class="chart"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>最近更新</h3><a class="btn btn-light btn-sm" href="#/deliverables">查看台账</a></div><div class="card-body recent-list">
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

function statCard(label, value, unit) {
  return `<div class="stat-card"><span>${esc(label)}</span><strong>${Number(value || 0)}</strong><small>${esc(unit)}</small></div>`;
}

function prepareCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(300, rect.width) * ratio;
  canvas.height = Math.max(220, rect.height) * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  return { ctx, width: canvas.width / ratio, height: canvas.height / ratio };
}

const chartColors = ['#3568df', '#31a67a', '#ed9b38', '#8a63d2', '#dc5d5d', '#45a6c7'];
function drawBarChart(canvas, data) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const pad = { left: 50, right: 20, top: 20, bottom: 50 };
  const max = Math.max(1, ...data.map(x => Number(x.value)));
  ctx.font = '12px Segoe UI, Microsoft YaHei';
  ctx.strokeStyle = '#e8ebf0'; ctx.fillStyle = '#667085'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (height - pad.top - pad.bottom) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillText(String(Math.round(max * (4 - i) / 4)), 8, y + 4);
  }
  const area = width - pad.left - pad.right;
  const slot = area / Math.max(1, data.length);
  data.forEach((x, i) => {
    const barWidth = Math.min(56, slot * .55);
    const h = Number(x.value) / max * (height - pad.top - pad.bottom);
    const left = pad.left + slot * i + (slot - barWidth) / 2;
    const top = height - pad.bottom - h;
    ctx.fillStyle = chartColors[i % chartColors.length];
    roundedRect(ctx, left, top, barWidth, h, 6); ctx.fill();
    ctx.fillStyle = '#334155'; ctx.textAlign = 'center';
    ctx.fillText(String(x.value), left + barWidth / 2, Math.max(13, top - 7));
    ctx.fillStyle = '#667085';
    const label = String(x.name).length > 8 ? String(x.name).slice(0, 8) + '…' : String(x.name);
    ctx.fillText(label, left + barWidth / 2, height - 22);
  });
  ctx.textAlign = 'left';
}

function drawDonutChart(canvas, data, legend) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const total = data.reduce((sum, x) => sum + Number(x.value), 0);
  const cx = width / 2, cy = height / 2 - 5, radius = Math.min(width, height) * .31;
  let angle = -Math.PI / 2;
  if (!total) {
    ctx.strokeStyle = '#e8ebf0'; ctx.lineWidth = 30; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  } else {
    data.forEach((x, i) => {
      const next = angle + Math.PI * 2 * Number(x.value) / total;
      ctx.strokeStyle = chartColors[i % chartColors.length]; ctx.lineWidth = 30; ctx.beginPath(); ctx.arc(cx, cy, radius, angle, next); ctx.stroke();
      angle = next;
    });
  }
  ctx.textAlign = 'center'; ctx.fillStyle = '#1f2937'; ctx.font = '700 27px Segoe UI'; ctx.fillText(String(total), cx, cy + 4);
  ctx.fillStyle = '#667085'; ctx.font = '12px Segoe UI, Microsoft YaHei'; ctx.fillText('版本总数', cx, cy + 25);
  legend.innerHTML = data.map((x, i) => `<span class="legend-item" style="--legend:${chartColors[i % chartColors.length]}">${esc(x.name)} ${x.value}</span>`).join('');
}

function drawLineChart(canvas, data) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const pad = { left: 48, right: 24, top: 22, bottom: 45 };
  const series = [
    { key: 'newVersions', name: '新增版本', color: chartColors[0] },
    { key: 'releasedVersions', name: '正式发布', color: chartColors[1] },
    { key: 'changes', name: '变更', color: chartColors[2] }
  ];
  const max = Math.max(1, ...data.flatMap(x => series.map(s => Number(x[s.key] || 0))));
  ctx.font = '12px Segoe UI, Microsoft YaHei';
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (height - pad.top - pad.bottom) * i / 4;
    ctx.strokeStyle = '#e8ebf0'; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#667085'; ctx.fillText(String(Math.round(max * (4 - i) / 4)), 9, y + 4);
  }
  const xAt = i => pad.left + (width - pad.left - pad.right) * i / Math.max(1, data.length - 1);
  const yAt = value => height - pad.bottom - Number(value) / max * (height - pad.top - pad.bottom);
  series.forEach(s => {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.beginPath();
    data.forEach((row, i) => { const x = xAt(i), y = yAt(row[s.key]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    data.forEach((row, i) => { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(xAt(i), yAt(row[s.key]), 4, 0, Math.PI * 2); ctx.fill(); });
  });
  ctx.fillStyle = '#667085'; ctx.textAlign = 'center';
  data.forEach((row, i) => ctx.fillText(row.month, xAt(i), height - 20));
  ctx.textAlign = 'left';
  series.forEach((s, i) => { ctx.fillStyle = s.color; ctx.fillRect(width - 250 + i * 82, 5, 10, 10); ctx.fillStyle = '#667085'; ctx.fillText(s.name, width - 236 + i * 82, 14); });
}

function roundedRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
