const jiraBoardState = { metadata: null, connectionSignature: null, analysis: null, commentCache: new Map(), presets: [], currentPresetId: null };

const jiraStageColors = {
  new: '#6f7f9b', confirm: '#4e7bf2', analysis: '#6b5ce7', action: '#b86fe2',
  verify: '#159eaf', closed: '#21a675', closure: '#e04f64', other: '#a06a46'
};

function jiraToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function jiraConnection() {
  const form = byId('jira-board-form');
  return {
    baseUrl: form.elements.baseUrl.value.trim(),
    projectKey: form.elements.projectKey.value.trim(),
    username: form.elements.username.value.trim(),
    password: form.elements.password.value
  };
}

function jiraConnectionSignature(connection) {
  return `${connection.baseUrl.replace(/\/+$/, '').toLowerCase()}|${connection.projectKey.toUpperCase()}|${connection.username}`;
}

async function renderJiraBoard() {
  setPage('JIRA看板', '连接 Jira Server，按指定日期还原问题状态并分析处理时效');
  jiraBoardState.metadata = null;
  jiraBoardState.connectionSignature = null;
  jiraBoardState.analysis = null;
  jiraBoardState.presets = [];
  jiraBoardState.currentPresetId = null;
  jiraBoardState.commentCache.clear();
  content.innerHTML = `
    <section class="jira-hero">
      <div><span class="jira-kicker">JIRA ISSUE INTELLIGENCE</span><h2>从问题数量走向处理效率洞察</h2><p>基于 Jira 状态历史还原统计截止日的问题阶段，统一查看在途、超时、关闭率与处理周期。</p></div>
      <div class="jira-hero-rule"><span>时效口径</span><strong>按项目自动匹配</strong><small>请在系统管理 / JIRA时效标准中维护状态与自然日时限</small></div>
    </section>
    <section class="jira-config-card">
      <div class="jira-section-head"><div><span>01 · DATA SOURCE</span><h3>Jira连接与查询范围</h3><p>凭证仅用于本次查询，不写入系统数据库或浏览器本地存储。</p></div><div id="jira-connection-badge" class="jira-connection-badge idle"><i></i>等待连接</div></div>
      <form id="jira-board-form">
        <div class="jira-config-grid">
          <label><span>Jira地址 *</span><input name="baseUrl" type="url" placeholder="http://jira.company.local:8080/jira" autocomplete="url" required></label>
          <label><span>项目编号 *</span><input name="projectKey" placeholder="如：AD" autocomplete="off" required></label>
          <label><span>账号 *</span><input name="username" autocomplete="username" required></label>
          <label><span>密码 *</span><input name="password" type="password" autocomplete="current-password" required></label>
          <label><span>统计截止日期 *</span><input name="cutoffDate" type="date" value="${jiraToday()}" max="${jiraToday()}" required></label>
          <label class="jira-severity-field"><span>严重等级字段 *</span><input name="severityFieldSearch" placeholder="搜索字段名称或ID" autocomplete="off" disabled><select name="severityFieldId" disabled><option value="">连接后选择字段</option></select></label>
        </div>
        <div class="jira-connect-actions">
          <button type="button" class="btn btn-light" id="jira-test-connection">测试连接并加载字段</button>
          <span id="jira-server-summary">支持 Jira Server REST API v2</span>
        </div>
        <div id="jira-query-builder" class="jira-query-builder hidden">
          <div class="jira-preset-toolbar"><div><label><span>已保存查询方案</span><select id="jira-preset-select"><option value="">临时查询（未保存）</option></select></label><small>方案按当前系统账号和项目隔离，不保存Jira账号、密码。</small></div><div><button type="button" class="btn btn-light btn-sm" id="jira-preset-save">保存为新方案</button><button type="button" class="btn btn-light btn-sm" id="jira-preset-update" disabled>更新方案</button><button type="button" class="btn btn-danger btn-sm" id="jira-preset-delete" disabled>删除</button></div></div>
          <div class="jira-builder-head"><div><strong>组合查询条件</strong><span>项目与截止日期由系统自动叠加</span></div><button type="button" class="btn btn-light btn-sm" id="jira-add-condition">+ 添加条件</button></div>
          <div id="jira-condition-list" class="jira-condition-list"></div>
          <label class="jira-raw-jql"><span>附加JQL（可选）</span><textarea name="rawJql" rows="2" placeholder="例如：issuetype = Bug AND labels in (vehicle-test)"></textarea></label>
          <div class="jira-query-preview"><span>最终附加条件</span><code id="jira-jql-preview">无</code></div>
        </div>
        <div class="jira-run-row"><div><strong>统计说明</strong><span>指定日期将还原当日状态；关闭率仍以该日之前创建的全部问题为分母，在途与超时只统计当日未关闭问题。</span></div><button type="submit" class="btn btn-primary" id="jira-run-analysis" disabled>开始分析</button></div>
      </form>
    </section>
    <div id="jira-board-results"><section class="jira-empty"><div>◆</div><strong>连接 Jira 后生成看板</strong><span>系统会读取问题字段、状态变更历史及按需加载最新评论。</span></section></div>`;

  byId('jira-test-connection').onclick = loadJiraMetadata;
  byId('jira-board-form').onsubmit = runJiraAnalysis;
  byId('jira-board-form').elements.rawJql.addEventListener('input', updateJiraPreview);
}

async function loadJiraMetadata() {
  const form = byId('jira-board-form');
  if (!form.reportValidity()) return;
  const connection = jiraConnection();
  const button = byId('jira-test-connection');
  const badge = byId('jira-connection-badge');
  button.disabled = true;
  button.textContent = '正在连接…';
  badge.className = 'jira-connection-badge loading';
  badge.innerHTML = '<i></i>正在验证';
  try {
    const previousSignature = jiraBoardState.connectionSignature;
    const metadata = await api('/internal/jira-board/metadata', { method: 'POST', body: JSON.stringify(connection) });
    jiraBoardState.metadata = metadata;
    jiraBoardState.connectionSignature = jiraConnectionSignature(connection);
    if (previousSignature && previousSignature !== jiraBoardState.connectionSignature) {
      byId('jira-condition-list').replaceChildren();
      form.elements.rawJql.value = '';
      jiraBoardState.currentPresetId = null;
    }
    const select = form.elements.severityFieldId;
    select.innerHTML = jiraFieldOptions('', '请选择严重等级字段');
    const candidate = metadata.fields.find(field => field.severityCandidate);
    if (candidate) select.value = candidate.id;
    select.disabled = false;
    form.elements.severityFieldSearch.disabled = false;
    form.elements.severityFieldSearch.value = '';
    form.elements.severityFieldSearch.oninput = event => {
      const selected = select.value;
      select.innerHTML = jiraFieldOptions(selected, '请选择严重等级字段', event.target.value);
    };
    byId('jira-query-builder').classList.remove('hidden');
    byId('jira-run-analysis').disabled = !metadata.standard;
    const transportWarning = connection.baseUrl.toLowerCase().startsWith('http://') ? ' · 注意：HTTP会明文传输Jira凭证' : '';
    const standardText = metadata.standard ? ` · 已应用标准：${metadata.standard.projectName}` : ' · 未配置JIRA时效标准';
    byId('jira-server-summary').textContent = `${metadata.server.title} ${metadata.server.version} · ${metadata.project.name} (${metadata.project.key}) · ${metadata.fields.length} 个可查询字段${standardText}${transportWarning}`;
    badge.className = `jira-connection-badge ${metadata.standard ? 'ready' : 'warning'}`;
    badge.innerHTML = metadata.standard ? '<i></i>连接成功' : '<i></i>缺少时效标准';
    if (!byId('jira-condition-list').children.length) addJiraCondition();
    byId('jira-add-condition').onclick = addJiraCondition;
    byId('jira-preset-save').onclick = saveJiraPreset;
    byId('jira-preset-update').onclick = updateJiraPreset;
    byId('jira-preset-delete').onclick = deleteJiraPreset;
    byId('jira-preset-select').onchange = applySelectedJiraPreset;
    try { await loadJiraPresets(); }
    catch (error) { jiraBoardState.presets = []; jiraBoardState.currentPresetId = null; updateJiraPresetButtons(); toast(`Jira已连接，但查询方案加载失败：${error.message}`, 'error'); }
    updateJiraPreview();
    if (metadata.standard) toast('Jira连接成功，字段和项目时效标准已加载。');
    else toast('Jira连接成功，但当前项目尚未配置JIRA时效标准。', 'error');
  } catch (error) {
    jiraBoardState.metadata = null;
    jiraBoardState.connectionSignature = null;
    byId('jira-run-analysis').disabled = true;
    badge.className = 'jira-connection-badge error';
    badge.innerHTML = '<i></i>连接失败';
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '测试连接并加载字段';
  }
}

function jiraFieldOptions(selected = '', emptyLabel = '选择字段', keyword = '') {
  const term = keyword.trim().toLowerCase();
  const fields = (jiraBoardState.metadata?.fields || []).filter(field => !term || field.name.toLowerCase().includes(term) || field.id.toLowerCase().includes(term));
  const selectedField = jiraBoardState.metadata?.fields.find(field => field.id === selected);
  if (selectedField && !fields.some(field => field.id === selected)) fields.unshift(selectedField);
  return `<option value="">${esc(emptyLabel)}</option>${fields.map(field => `<option value="${esc(field.id)}" ${field.id === selected ? 'selected' : ''}>${esc(field.name)} · ${esc(field.id)}${field.custom ? ' · 自定义' : ''}</option>`).join('')}`;
}

function addJiraCondition(condition = {}) {
  if (!jiraBoardState.metadata) return;
  const row = document.createElement('div');
  row.className = 'jira-condition-row';
  row.innerHTML = `
    <div class="jira-field-picker"><input data-jira-field-search placeholder="搜索字段名称或ID"><select data-jira-field>${jiraFieldOptions(condition.fieldId || '')}</select></div>
    <select data-jira-operator><option value="=">等于</option><option value="!=">不等于</option><option value="~">包含</option><option value="!~">不包含</option><option value="IN">属于</option><option value="NOT IN">不属于</option><option value="IS EMPTY">为空</option><option value="IS NOT EMPTY">不为空</option></select>
    <input data-jira-value value="${esc(condition.value || '')}" placeholder="条件值；多值用逗号分隔">
    <button type="button" aria-label="删除条件">×</button>`;
  row.querySelector('[data-jira-operator]').value = condition.operator || '=';
  row.querySelector('[data-jira-field-search]').oninput = event => {
    const select = row.querySelector('[data-jira-field]');
    const selected = select.value;
    select.innerHTML = jiraFieldOptions(selected, '选择字段', event.target.value);
  };
  row.querySelectorAll('select,input').forEach(element => element.addEventListener('input', updateJiraPreview));
  row.querySelector('[data-jira-operator]').addEventListener('change', event => {
    const withoutValue = event.target.value.startsWith('IS ');
    row.querySelector('[data-jira-value]').disabled = withoutValue;
    updateJiraPreview();
  });
  row.querySelector('button').onclick = () => { row.remove(); updateJiraPreview(); };
  row.querySelector('[data-jira-value]').disabled = (condition.operator || '').startsWith('IS ');
  byId('jira-condition-list').appendChild(row);
  updateJiraPreview();
}

function jiraJqlQuote(value) {
  return `"${String(value).trim().replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function jiraFieldClause(field) {
  return /^(?:[A-Za-z][A-Za-z0-9_.-]*|cf\[\d+\])$/.test(field.clause)
    ? field.clause
    : jiraJqlQuote(field.clause);
}

function buildJiraConditions() {
  if (!jiraBoardState.metadata) return '';
  const clauses = [];
  document.querySelectorAll('.jira-condition-row').forEach(row => {
    const field = jiraBoardState.metadata.fields.find(x => x.id === row.querySelector('[data-jira-field]').value);
    const operator = row.querySelector('[data-jira-operator]').value;
    const value = row.querySelector('[data-jira-value]').value.trim();
    if (!field) return;
    if (operator.startsWith('IS ')) clauses.push(`${jiraFieldClause(field)} ${operator}`);
    else if (value) {
      const formatted = operator.includes('IN')
        ? `(${value.split(',').map(x => x.trim()).filter(Boolean).map(jiraJqlQuote).join(', ')})`
        : jiraJqlQuote(value);
      clauses.push(`${jiraFieldClause(field)} ${operator} ${formatted}`);
    }
  });
  const raw = byId('jira-board-form')?.elements.rawJql?.value.trim();
  if (raw) clauses.push(`(${raw})`);
  return clauses.join(' AND ');
}

function updateJiraPreview() {
  const preview = byId('jira-jql-preview');
  if (preview) preview.textContent = buildJiraConditions() || '无';
}

function readJiraConditionValues() {
  return [...document.querySelectorAll('.jira-condition-row')].map(row => {
    const fieldId = row.querySelector('[data-jira-field]').value;
    const field = jiraBoardState.metadata?.fields.find(x => x.id === fieldId);
    return { fieldId, fieldName: field?.name || '', operator: row.querySelector('[data-jira-operator]').value, value: row.querySelector('[data-jira-value]').value.trim() };
  }).filter(x => x.fieldId);
}

async function loadJiraPresets(selectedId = null) {
  const connection = jiraConnection();
  const query = new URLSearchParams({ baseUrl: connection.baseUrl, projectKey: connection.projectKey });
  const data = await api(`/internal/jira-board/presets?${query}`);
  jiraBoardState.presets = data.items || [];
  const select = byId('jira-preset-select');
  select.innerHTML = '<option value="">临时查询（未保存）</option>' + jiraBoardState.presets.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
  const target = selectedId ?? jiraBoardState.currentPresetId;
  if (target && jiraBoardState.presets.some(x => x.id === Number(target))) {
    select.value = String(target);
    jiraBoardState.currentPresetId = Number(target);
  } else jiraBoardState.currentPresetId = null;
  updateJiraPresetButtons();
}

function applySelectedJiraPreset(event) {
  const id = Number(event.target.value) || null;
  jiraBoardState.currentPresetId = id;
  const preset = jiraBoardState.presets.find(x => x.id === id);
  if (!preset) { updateJiraPresetButtons(); return; }
  const form = byId('jira-board-form');
  if (jiraBoardState.metadata.fields.some(x => x.id === preset.severityFieldId)) form.elements.severityFieldId.value = preset.severityFieldId;
  else toast('方案中的严重等级字段在当前Jira项目中不存在，请重新选择。', 'error');
  byId('jira-condition-list').replaceChildren();
  (preset.conditions || []).forEach(addJiraCondition);
  if (!(preset.conditions || []).length) addJiraCondition();
  form.elements.rawJql.value = preset.additionalJql || '';
  updateJiraPreview();
  updateJiraPresetButtons();
  toast(`已应用查询方案“${preset.name}”。`);
}

function updateJiraPresetButtons() {
  const selected = Boolean(jiraBoardState.currentPresetId);
  if (byId('jira-preset-update')) byId('jira-preset-update').disabled = !selected;
  if (byId('jira-preset-delete')) byId('jira-preset-delete').disabled = !selected;
}

function jiraPresetPayload(name, revision = 0) {
  const form = byId('jira-board-form');
  return {
    jiraBaseUrl: jiraConnection().baseUrl,
    projectKey: jiraConnection().projectKey,
    name,
    severityFieldId: form.elements.severityFieldId.value,
    conditions: readJiraConditionValues(),
    additionalJql: form.elements.rawJql.value.trim(),
    revision
  };
}

function requestJiraPresetName(title, initialName, submitText, onSubmit) {
  showModal(title, `<form id="jira-preset-form"><div class="field"><label>方案名称 *</label><input name="name" maxlength="60" value="${esc(initialName || '')}" required autofocus></div></form>`, {
    small: true, submitText, onSubmit: async close => {
      const form = byId('jira-preset-form');
      if (!form.reportValidity()) throw new Error('请填写查询方案名称。');
      await onSubmit(form.elements.name.value.trim()); close();
    }
  });
}

function saveJiraPreset() {
  if (!byId('jira-board-form').elements.severityFieldId.value) { toast('请先选择严重等级字段。', 'error'); return; }
  requestJiraPresetName('保存查询方案', '', '保存为新方案', async name => {
    const result = await api('/internal/jira-board/presets', { method:'POST', body:JSON.stringify(jiraPresetPayload(name)) });
    await loadJiraPresets(result.id); toast('查询方案已保存。');
  });
}

function updateJiraPreset() {
  const preset = jiraBoardState.presets.find(x => x.id === jiraBoardState.currentPresetId);
  if (!preset) return;
  requestJiraPresetName('更新查询方案', preset.name, '保存更新', async name => {
    await api(`/internal/jira-board/presets/${preset.id}`, { method:'PUT', body:JSON.stringify(jiraPresetPayload(name, preset.revision)) });
    await loadJiraPresets(preset.id); toast('查询方案已更新。');
  });
}

async function deleteJiraPreset() {
  const preset = jiraBoardState.presets.find(x => x.id === jiraBoardState.currentPresetId);
  if (!preset) return;
  const result = await confirmAction('删除查询方案', `确认删除查询方案“${preset.name}”吗？`, { submitText:'确认删除', danger:true });
  if (!result.confirmed) return;
  await api(`/internal/jira-board/presets/${preset.id}`, { method:'DELETE' });
  jiraBoardState.currentPresetId = null;
  await loadJiraPresets(); toast('查询方案已删除。');
}

async function runJiraAnalysis(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || !jiraBoardState.metadata) return;
  if (jiraBoardState.connectionSignature !== jiraConnectionSignature(jiraConnection())) { toast('Jira地址、项目或账号已变化，请重新测试连接并加载字段。', 'error'); return; }
  if (!jiraBoardState.metadata.standard) { toast('当前项目尚未配置启用的JIRA时效标准。', 'error'); return; }
  if (!form.elements.severityFieldId.value) { toast('请选择严重等级字段。', 'error'); return; }
  for (const row of document.querySelectorAll('.jira-condition-row')) {
    const field = row.querySelector('[data-jira-field]').value;
    const operator = row.querySelector('[data-jira-operator]').value;
    const value = row.querySelector('[data-jira-value]').value.trim();
    if (!field && value) { toast('存在尚未选择字段的查询条件。', 'error'); return; }
    if (field && !operator.startsWith('IS ') && !value) { toast('请填写已选择查询字段的条件值。', 'error'); return; }
  }
  const button = byId('jira-run-analysis');
  button.disabled = true;
  button.textContent = '读取并计算中…';
  byId('jira-board-results').innerHTML = '<section class="jira-loading"><div class="jira-spinner"></div><strong>正在读取 Jira 问题历史</strong><span>问题较多时需要一些时间，请保持页面打开。</span></section>';
  try {
    const payload = {
      connection: jiraConnection(),
      cutoffDate: form.elements.cutoffDate.value,
      severityFieldId: form.elements.severityFieldId.value,
      additionalJql: buildJiraConditions() || null
    };
    jiraBoardState.analysis = await api('/internal/jira-board/analyze', { method: 'POST', body: JSON.stringify(payload) });
    jiraBoardState.commentCache.clear();
    renderJiraResults(jiraBoardState.analysis);
    toast('JIRA看板已更新。');
  } catch (error) {
    byId('jira-board-results').innerHTML = `<section class="jira-empty error"><div>!</div><strong>分析未完成</strong><span>${esc(error.message)}</span></section>`;
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '开始分析';
  }
}

function jiraNumber(value) { return Number(value || 0).toLocaleString('zh-CN'); }
function jiraPercent(value) { return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`; }
function jiraDays(value) { return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}天`; }

function jiraFunnelChart(items) {
  const rowHeight = 74, center = 500;
  const points = items.map((item,index) => {
    const top = 900 - index * 100, bottom = 800 - index * 100, y = index * rowHeight;
    return `<g class="jira-funnel-layer" data-jira-stage="${esc(item.code)}" tabindex="0" role="button" aria-label="${esc(item.name)} ${item.count}项"><polygon points="${center-top/2},${y+2} ${center+top/2},${y+2} ${center+bottom/2},${y+rowHeight-3} ${center-bottom/2},${y+rowHeight-3}" fill="${jiraStageColors[item.code]}"></polygon><text x="${center}" y="${y+32}" text-anchor="middle">${esc(item.name)} · ${jiraNumber(item.count)}项</text><text class="sub" x="${center}" y="${y+52}" text-anchor="middle">占全部问题 ${jiraPercent(item.share)}</text></g>`;
  }).join('');
  return `<svg class="jira-funnel-svg" viewBox="0 0 1000 ${items.length*rowHeight}" aria-label="问题处理阶段漏斗">${points}</svg>`;
}

function jiraOverdueChart(items) {
  const max = Math.max(1,...items.map(x=>x.count));
  return `<div class="jira-hbar-chart">${items.map(item=>`<button type="button" data-jira-overdue="${esc(item.code)}" class="${item.count?'has-risk':''}"><span>${esc(item.name)}</span><i><b style="width:${item.count/max*100}%;--bar:${jiraStageColors[item.code]||jiraStageColors.other}"></b></i><strong>${jiraNumber(item.count)}</strong><small>${item.count?`最长超时 ${item.maxOverdueDays} 天`:'暂无超时'}</small></button>`).join('')}</div>`;
}

function jiraDonut(rate, label) {
  const safe=Math.max(0,Math.min(100,Number(rate||0))), circumference=276.46;
  return `<div class="jira-donut"><svg viewBox="0 0 110 110" role="img" aria-label="${esc(label)} ${jiraPercent(rate)}"><circle cx="55" cy="55" r="44"></circle><circle class="value" cx="55" cy="55" r="44" stroke-dasharray="${safe/100*circumference} ${circumference}"></circle></svg><div><strong>${jiraPercent(rate)}</strong><span>${esc(label)}</span></div></div>`;
}

function jiraRateChart(items) {
  return `<div class="jira-chart-list">${items.map(item=>`<div><span class="jira-severity ${esc(item.severityKey.toLowerCase())}">${esc(item.severity)}</span><i><b style="width:${item.rate||0}%"></b></i><strong>${jiraPercent(item.rate)}</strong><small>${item.closed}/${item.total}</small></div>`).join('')}</div>`;
}

function jiraDurationChart(items, valueField, labelField, colorField = null) {
  const max=Math.max(1,...items.map(x=>x[valueField]||0));
  return `<div class="jira-chart-list duration">${items.map((item,index)=>`<div><em>${index+1}</em><span>${esc(item[labelField])}</span><i><b style="width:${(item[valueField]||0)/max*100}%;${colorField?`--bar:${jiraStageColors[item[colorField]]}`:''}"></b></i><strong>${jiraDays(item[valueField])}</strong><small>${item.sampleCount}项</small></div>`).join('')}</div>`;
}

function renderJiraResults(data) {
  const warnings = [];
  if (data.truncated) warnings.push(`Jira共返回 ${jiraNumber(data.sourceTotal)} 条，当前看板为保护服务器仅分析前 5,000 条，请缩小查询条件。`);
  if (data.historyTruncated) warnings.push(`有 ${jiraNumber(data.historyTruncated)} 条问题的 Jira 变更历史超过接口单次展开上限，其历史阶段时长可能不完整，建议缩小查询范围后复核。`);
  if (data.unmatchedStatuses.length) warnings.push(`有 ${data.unmatchedStatuses.reduce((sum, x) => sum + x.count, 0)} 条问题状态未匹配处理阶段：${data.unmatchedStatuses.map(x => `${x.status}(${x.count})`).join('、')}。`);
  if (data.unmatchedSeverities.length) warnings.push(`有 ${data.unmatchedSeverities.reduce((sum, x) => sum + x.count, 0)} 条问题的严重等级无法映射为 S/A/B/C，因此不参与超时判定：${data.unmatchedSeverities.map(x => `${x.severity}(${x.count})`).join('、')}。`);
  const results = byId('jira-board-results');
  results.innerHTML = `
    <section class="jira-result-head"><div><span>02 · ANALYSIS RESULT</span><h3>${esc(data.project)} · 截至 ${esc(data.cutoffDate)}</h3><p>应用标准：${esc(data.standard.projectName)}（修订 ${data.standard.revision}） · 查询口径：<code>${esc(data.query)}</code></p></div><button type="button" class="btn btn-light btn-sm" id="jira-copy-jql">复制JQL</button></section>
    ${warnings.map(text => `<div class="jira-warning">${esc(text)}</div>`).join('')}
    <section class="jira-metrics">
      ${jiraMetric('统计问题', data.summary.total, '查询范围内全部问题', 'all')}
      ${jiraMetric('待关闭问题', data.summary.active, '截止日仍未进入关闭阶段', 'active', 'primary')}
      ${jiraMetric('整体关闭率', jiraPercent(data.summary.closureRate), `${jiraNumber(data.summary.closed)} 项已关闭`, 'closed', 'success')}
      ${jiraMetric('平均关闭周期', jiraDays(data.summary.averageClosureDays), '仅统计已关闭问题', 'closed-duration', 'violet')}
      ${jiraMetric('阶段超时', data.summary.stageOverdue, '当前阶段超过时效', 'stage-overdue', 'danger')}
      ${jiraMetric('关闭周期超时', data.summary.closureOverdue, '当前未关闭且超过总周期', 'closure-overdue', 'orange')}
    </section>
    <section class="jira-panel jira-funnel-panel">
      <div class="jira-panel-head"><div><span>PROCESS FUNNEL</span><h3>问题处理阶段漏斗</h3><p>点击任一阶段，查看严重等级、人员分布和问题明细。</p></div><small>当前状态快照</small></div>
      <div class="jira-funnel-chart">${jiraFunnelChart(data.funnel)}</div>
    </section>
    <section class="jira-panel">
      <div class="jira-panel-head"><div><span>OVERDUE RADAR</span><h3>处理超时报表</h3><p>阶段超时按当前阶段停留时长计算；关闭总周期按创建至截止日计算。</p></div><small>红色越深风险越高</small></div>
      ${jiraOverdueChart(data.overdue)}
    </section>
    <div class="jira-two-column">
      <section class="jira-panel">
        <div class="jira-panel-head"><div><span>CLOSURE RATE</span><h3>问题关闭率</h3><p>环形图展示整体关闭率，条形图对比不同严重等级。</p></div></div>
        <div class="jira-closure-chart">${jiraDonut(data.summary.closureRate,'整体关闭率')}${data.closureRates.length?jiraRateChart(data.closureRates):jiraNoData('暂无严重等级数据')}</div>
      </section>
      <section class="jira-panel">
        <div class="jira-panel-head"><div><span>LEAD TIME</span><h3>严重等级平均关闭周期</h3><p>按周期从长到短排序，仅统计已关闭问题。</p></div></div>
        ${data.severityAverages.length?jiraDurationChart(data.severityAverages,'averageDays','severity'):jiraNoData('暂无已关闭问题')}
      </section>
    </div>
    <section class="jira-panel">
      <div class="jira-panel-head"><div><span>STAGE EFFICIENCY</span><h3>各阶段平均处理周期</h3><p>统计已经离开该阶段的问题；同一问题多次进入同一阶段时累计计算。</p></div></div>
      ${jiraDurationChart(data.stageAverages,'averageDays','name','code')}
    </section>`;

  byId('jira-copy-jql').onclick = async () => {
    try { await navigator.clipboard.writeText(data.query); toast('JQL已复制。'); }
    catch { toast('浏览器未允许复制，请从查询口径中手动复制JQL。', 'error'); }
  };
  results.querySelectorAll('[data-jira-stage]').forEach(button => button.onclick = () => {
    const code = button.dataset.jiraStage;
    const stage = data.funnel.find(x => x.code === code);
    openJiraDetails(`${stage.name} · ${stage.count}项`, data.issues.filter(x => x.stageCode === code), code === 'closed' ? 'closure' : 'stage');
  });
  results.querySelectorAll('.jira-funnel-layer').forEach(layer => layer.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); layer.onclick(); } });
  results.querySelectorAll('[data-jira-overdue]').forEach(button => button.onclick = () => {
    const code = button.dataset.jiraOverdue;
    const item = data.overdue.find(x => x.code === code);
    const issues = code === 'closure'
      ? data.issues.filter(x => x.stageCode !== 'closed' && x.closureOverdueDays > 0).sort((a, b) => b.closureOverdueDays - a.closureOverdueDays)
      : data.issues.filter(x => x.stageCode === code && x.stageOverdueDays > 0).sort((a, b) => b.stageOverdueDays - a.stageOverdueDays);
    openJiraDetails(`${item.name}超时 · ${issues.length}项`, issues, code === 'closure' ? 'closure' : 'stage');
  });
  results.querySelectorAll('[data-jira-kind]').forEach(button => button.onclick = () => {
    const kind = button.dataset.jiraKind;
    if (kind === 'all') openJiraDetails('全部问题', data.issues, 'stage');
    if (kind === 'active') openJiraDetails('待关闭问题', data.issues.filter(x => x.stageCode !== 'closed'), 'stage');
    if (kind === 'closed' || kind === 'closed-duration') openJiraDetails('已关闭问题', data.issues.filter(x => x.stageCode === 'closed'), 'closure');
    if (kind === 'stage-overdue') openJiraDetails('阶段超时问题', data.issues.filter(x => x.stageCode !== 'closed' && x.stageOverdueDays > 0).sort((a,b) => b.stageOverdueDays-a.stageOverdueDays), 'stage');
    if (kind === 'closure-overdue') openJiraDetails('关闭周期超时问题', data.issues.filter(x => x.stageCode !== 'closed' && x.closureOverdueDays > 0).sort((a,b) => b.closureOverdueDays-a.closureOverdueDays), 'closure');
  });
}

function jiraMetric(label, value, note, kind, tone = '') {
  return `<button type="button" class="jira-metric ${tone}" data-jira-kind="${kind}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></button>`;
}

function jiraNoData(text) { return `<div class="jira-no-data">${esc(text)}</div>`; }

function jiraDistribution(items, field, emptyLabel) {
  const values = new Map();
  items.forEach(item => {
    const value = item[field] || emptyLabel;
    values.set(value, (values.get(value) || 0) + 1);
  });
  return [...values.entries()].sort((a, b) => b[1] - a[1]);
}

function jiraPieChart(items) {
  const colors=['#536fe4','#20a58f','#e2a13a','#d95067','#7b61d8','#4c93c9','#9a6b44','#7d8da8'];
  const total=items.reduce((sum,item)=>sum+item[1],0)||1;
  let cursor=0;
  const stops=items.map((item,index)=>{const start=cursor;cursor+=item[1]/total*100;return `${colors[index%colors.length]} ${start}% ${cursor}%`;});
  return `<div class="jira-mini-pie" style="--pie:${stops.length?stops.join(','):'#e9edf3 0 100%'}"><strong>${jiraNumber(total)}</strong><span>问题</span></div><div class="jira-pie-legend">${items.slice(0,8).map((item,index)=>`<i><b style="background:${colors[index%colors.length]}"></b>${esc(item[0])}<strong>${item[1]}</strong></i>`).join('')}</div>`;
}

function jiraAssigneeChart(items) {
  const max=Math.max(1,...items.map(x=>x[1]));
  return `<div class="jira-mini-bars">${items.slice(0,8).map(item=>`<div><span>${esc(item[0])}</span><i><b style="width:${item[1]/max*100}%"></b></i><strong>${item[1]}</strong></div>`).join('')}</div>`;
}

function openJiraDetails(title, items, overdueMode) {
  let page = 1;
  const pageSize = 50;
  const severity = jiraDistribution(items, 'severityLabel', '未设置');
  const assignees = jiraDistribution(items, 'assignee', '未分配');
  modalRoot.innerHTML = `<div class="modal-backdrop jira-detail-backdrop"><div class="jira-detail-modal"><div class="jira-detail-head"><div><span>DRILL DOWN</span><h3>${esc(title)}</h3><p>当前穿透范围共 ${jiraNumber(items.length)} 项，导出将包含全部明细及最新评论。</p></div><div class="jira-detail-actions"><button type="button" class="btn btn-light btn-sm" data-jira-export ${items.length?'':'disabled'}>导出CSV</button><button type="button" class="jira-detail-close" aria-label="关闭">×</button></div></div><div id="jira-detail-body"></div></div></div>`;
  const close = () => modalRoot.replaceChildren();
  modalRoot.querySelector('.jira-detail-close').onclick = close;
  modalRoot.querySelector('[data-jira-export]').onclick = event => exportJiraDetails(title,items,overdueMode,event.currentTarget);
  modalRoot.querySelector('.jira-detail-backdrop').onclick = event => { if (event.target.classList.contains('jira-detail-backdrop')) close(); };

  const renderPage = async () => {
    if (!modalRoot.querySelector('#jira-detail-body')) return;
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    page = Math.min(Math.max(1, page), totalPages);
    const visible = items.slice((page - 1) * pageSize, page * pageSize);
    byId('jira-detail-body').innerHTML = items.length ? `
      <div class="jira-detail-breakdowns"><div><div><strong>严重等级分布</strong><small>按当前明细范围统计</small></div><section>${jiraPieChart(severity)}</section></div><div><div><strong>处理人分布</strong><small>按问题数量从高到低</small></div><section>${jiraAssigneeChart(assignees)}</section></div></div>
      <div class="jira-detail-table-wrap"><table><thead><tr><th>严重等级</th><th>Jira编号 / 标题</th><th>当前处理人</th><th>当前状态</th><th>最新结论</th><th>是否超时</th></tr></thead><tbody>${visible.map(issue => jiraIssueRow(issue, overdueMode)).join('')}</tbody></table></div>
      <div class="jira-detail-pagination"><span>共 ${jiraNumber(items.length)} 项 · 第 ${page}/${totalPages} 页</span><div><button type="button" class="btn btn-light btn-sm" data-page="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><button type="button" class="btn btn-light btn-sm" data-page="next" ${page >= totalPages ? 'disabled' : ''}>下一页</button></div></div>`
      : jiraNoData('该范围内暂无问题');
    byId('jira-detail-body').querySelector('[data-page="prev"]')?.addEventListener('click', () => { page -= 1; renderPage(); });
    byId('jira-detail-body').querySelector('[data-page="next"]')?.addEventListener('click', () => { page += 1; renderPage(); });
    await loadJiraComments(visible.map(x => x.key));
  };
  renderPage();
}

function jiraIssueRow(issue, overdueMode) {
  const overdue = overdueMode === 'closure' ? issue.closureOverdueDays : issue.stageOverdueDays;
  const limit = overdueMode === 'closure' ? issue.closureLimitDays : issue.stageLimitDays;
  const comment = jiraBoardState.commentCache.get(issue.key);
  return `<tr class="${overdue > 0 ? 'is-overdue' : ''}">
    <td><span class="jira-severity ${esc(issue.severityKey.toLowerCase())}">${esc(issue.severityLabel)}</span></td>
    <td><a href="${esc(issue.url)}" target="_blank" rel="noopener noreferrer">${esc(issue.key)}</a><strong>${esc(issue.summary)}</strong><small>创建：${esc(fmtDateOnly(issue.createdAt))}</small></td>
    <td>${esc(issue.assignee)}</td><td><span class="jira-status-dot" style="--stage:${jiraStageColors[issue.stageCode] || jiraStageColors.other}"></span>${esc(issue.status)}</td>
    <td class="jira-comment" data-comment-key="${esc(issue.key)}">${jiraCommentHtml(comment)}</td>
    <td>${overdue > 0 ? `<span class="jira-overdue-tag">超时 ${overdue} 天</span>` : `<span class="jira-ok-tag">${limit ? `时限 ${limit} 天` : '未配置时限'}</span>`}</td></tr>`;
}

function jiraCommentHtml(comment) {
  if (comment === undefined) return '<span class="jira-comment-loading">加载中…</span>';
  if (comment?.error) return `<span class="jira-comment-empty" title="${esc(comment.error)}">最新评论加载失败</span>`;
  if (!comment?.body) return '<span class="jira-comment-empty">暂无评论</span>';
  return `<p>${esc(comment.body)}</p><small>${esc(comment.author || '未知用户')} · ${esc(fmtDate(comment.created))}</small>`;
}

async function loadJiraComments(keys) {
  const missing = [...new Set(keys)].filter(key => !jiraBoardState.commentCache.has(key));
  if (!missing.length) return;
  for (let index=0;index<missing.length;index+=100) {
    const batch=missing.slice(index,index+100);
    try {
      const response = await api('/internal/jira-board/comments', {
        method: 'POST',
        body: JSON.stringify({ connection: jiraConnection(), cutoffDate: jiraBoardState.analysis.cutoffDate, issueKeys: batch })
      });
      response.items.forEach(item => jiraBoardState.commentCache.set(item.key, item));
    } catch (error) {
      batch.forEach(key => jiraBoardState.commentCache.set(key, { body: null, error: error.message }));
    }
  }
  missing.forEach(key => {
    const cell = modalRoot.querySelector(`[data-comment-key="${CSS.escape(key)}"]`);
    if (cell) cell.innerHTML = jiraCommentHtml(jiraBoardState.commentCache.get(key));
  });
}

function jiraCsvCell(value) {
  let text=String(value??'');
  if (/^[=+\-@\t\r]/.test(text)) text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}

async function exportJiraDetails(title,items,overdueMode,button) {
  if (!items.length) return;
  const original=button.textContent;
  button.disabled=true;button.textContent='准备最新评论…';
  await loadJiraComments(items.map(x=>x.key));
  const headers=['Jira编号','标题','严重等级','当前处理人','当前状态','所属阶段','最新结论','评论人','评论时间','创建时间','关闭时间','阶段停留天数','阶段时限','阶段超时天数','关闭周期天数','关闭总周期时限','关闭超时天数'];
  const rows=items.map(issue=>{
    const comment=jiraBoardState.commentCache.get(issue.key)||{};
    return [issue.key,issue.summary,issue.severityLabel,issue.assignee,issue.status,issue.stageName,comment.error?`最新评论加载失败：${comment.error}`:(comment.body||''),comment.author||'',comment.created||'',issue.createdAt,issue.closedAt||'',issue.stageElapsedDays,issue.stageLimitDays??'',issue.stageOverdueDays,issue.closureElapsedDays,issue.closureLimitDays??'',issue.closureOverdueDays];
  });
  const csv='\uFEFF'+[headers,...rows].map(row=>row.map(jiraCsvCell).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  const safe=title.replace(/[\\/:*?"<>|·\s]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60)||'JIRA问题明细';
  link.download=`${safe}_${jiraBoardState.analysis.cutoffDate}.csv`;
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(link.href);
  button.disabled=false;button.textContent=original;
  toast(`已导出 ${items.length} 条问题明细。`);
}
