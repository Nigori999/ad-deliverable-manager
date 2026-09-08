const jiraBoardState = { metadata: null, connectionSignature: null, analysis: null, commentCache: new Map(), commentGeneration: 0, presets: [], currentPresetId: null, trendRange: '90', variantMode: 'ADS' };

const jiraStageColors = {
  new: '#6f7f9b', confirm: '#4e7bf2', analysis: '#6b5ce7', action: '#b86fe2',
  verify: '#159eaf', closed: '#21a675', closure: '#e04f64', other: '#a06a46'
};
let jiraFieldPickerSequence = 0;

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
  jiraBoardState.trendRange = '90';
  jiraBoardState.variantMode = 'ADS';
  jiraBoardState.commentGeneration += 1;
  jiraBoardState.commentCache.clear();
  content.innerHTML = `
    <section class="jira-config-card">
      <div class="jira-section-head"><div><span>JIRA BOARD</span><h3>连接与查询范围</h3><p>凭证仅用于本次查询，不写入系统数据库或浏览器本地存储；时效口径按项目自动匹配。</p></div><div id="jira-connection-badge" class="jira-connection-badge idle"><i></i>等待连接</div></div>
      <form id="jira-board-form">
        <div class="jira-config-grid">
          <label><span>Jira地址 *</span><input name="baseUrl" type="url" placeholder="http://jira.company.local:8080/jira" autocomplete="url" required></label>
          <label><span>项目编号 *</span><input name="projectKey" placeholder="如：AD" autocomplete="off" required></label>
          <label><span>账号 *</span><input name="username" autocomplete="username" required></label>
          <label><span>密码 *</span><input name="password" type="password" autocomplete="current-password" required></label>
          <label><span>统计截止日期 *</span><input name="cutoffDate" type="date" value="${jiraToday()}" max="${jiraToday()}" required></label>
          <div class="jira-config-field jira-severity-field"><label for="jira-severity-field-input">严重等级字段 *</label><div id="jira-severity-field-host">${jiraFieldPickerHtml('', { name:'severityFieldId', placeholder:'连接后搜索并选择字段', disabled:true, inputId:'jira-severity-field-input' })}</div></div>
          <div class="jira-config-field jira-project-field"><label for="jira-variant-field-input">ECU Variant字段 *</label><div id="jira-variant-field-host">${jiraFieldPickerHtml('', { name:'variantFieldId', placeholder:'连接后搜索并选择字段', disabled:true, inputId:'jira-variant-field-input' })}</div></div>
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
    const projectFields = metadata.projectFields || metadata.fields;
    const candidate = projectFields.find(field => field.severityCandidate);
    const variantCandidate = projectFields.find(field => field.name.trim().toLowerCase() === 'ecu variant')
      || projectFields.find(field => field.name.toLowerCase().includes('ecu variant'));
    const severityHost = byId('jira-severity-field-host');
    severityHost.innerHTML = jiraFieldPickerHtml(candidate?.id || '', { name:'severityFieldId', placeholder:'搜索字段名称或ID', inputId:'jira-severity-field-input' });
    bindJiraFieldPicker(severityHost.firstElementChild, { fields:projectFields, selectedId:candidate?.id || '', onChange:updateJiraPreview });
    const variantHost = byId('jira-variant-field-host');
    variantHost.innerHTML = jiraFieldPickerHtml(variantCandidate?.id || '', { name:'variantFieldId', placeholder:'搜索项目表单字段', inputId:'jira-variant-field-input' });
    bindJiraFieldPicker(variantHost.firstElementChild, { fields:projectFields, selectedId:variantCandidate?.id || '', onChange:updateJiraPreview });
    byId('jira-query-builder').classList.remove('hidden');
    byId('jira-run-analysis').disabled = !metadata.standard;
    const transportWarning = connection.baseUrl.toLowerCase().startsWith('http://') ? ' · 注意：HTTP会明文传输Jira凭证' : '';
    const standardText = metadata.standard ? ` · 已应用标准：${metadata.standard.projectName}` : ' · 未配置JIRA时效标准';
    const projectFieldText=metadata.projectFieldsScoped?`${projectFields.length} 个项目表单字段`:`${projectFields.length} 个字段（项目范围读取失败）`;
    byId('jira-server-summary').textContent = `${metadata.server.title} ${metadata.server.version} · ${metadata.project.name} (${metadata.project.key}) · ${projectFieldText} / ${metadata.fields.length} 个可查询字段${standardText}${transportWarning}`;
    badge.className = `jira-connection-badge ${metadata.standard&&!metadata.projectFieldWarning ? 'ready' : 'warning'}`;
    badge.innerHTML = !metadata.standard?'<i></i>缺少时效标准':metadata.projectFieldWarning?'<i></i>字段范围已降级':'<i></i>连接成功';
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
    if (metadata.projectFieldWarning) toast(metadata.projectFieldWarning, 'error');
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

function jiraFieldPickerHtml(selectedId = '', { name = '', placeholder = '搜索字段名称或ID', disabled = false, inputId = '' } = {}) {
  return `<div class="jira-field-combobox" data-jira-field-picker>
    <input type="hidden" ${name ? `name="${esc(name)}"` : ''} data-jira-field value="${esc(selectedId)}">
    <input type="text" ${inputId ? `id="${esc(inputId)}"` : ''} data-jira-field-input placeholder="${esc(placeholder)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" ${disabled ? 'disabled' : ''}>
    <button type="button" data-jira-field-toggle aria-label="展开字段列表" tabindex="-1" ${disabled ? 'disabled' : ''}>⌄</button>
    <div class="jira-field-options" data-jira-field-options role="listbox" hidden></div>
  </div>`;
}

function jiraFieldDisplay(field) {
  return field ? `${field.name} · ${field.id}${field.custom ? ' · 自定义' : ''}` : '';
}

function bindJiraFieldPicker(root, { fields = jiraBoardState.metadata?.fields || [], selectedId = '', onChange = null } = {}) {
  const hidden = root.querySelector('[data-jira-field]');
  const input = root.querySelector('[data-jira-field-input]');
  const toggle = root.querySelector('[data-jira-field-toggle]');
  const options = root.querySelector('[data-jira-field-options]');
  const listId = `jira-field-options-${++jiraFieldPickerSequence}`;
  let visibleFields = [];
  let activeIndex = -1;
  let committedId = '';
  options.id = listId;
  input.setAttribute('aria-controls', listId);

  const close = () => {
    options.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };
  const refreshActive = () => {
    options.querySelectorAll('[data-jira-field-option]').forEach((option, index) => {
      const active = index === activeIndex;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) {
        input.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block:'nearest' });
      }
    });
  };
  const selectField = (field, notify = true) => {
    committedId = field?.id || '';
    hidden.value = committedId;
    input.value = jiraFieldDisplay(field);
    close();
    if (notify) onChange?.(field || null);
  };
  const renderOptions = (keyword = '') => {
    const term = keyword.trim().toLowerCase();
    const matches = fields.filter(field => !term || field.name.toLowerCase().includes(term) || field.id.toLowerCase().includes(term));
    visibleFields = matches.slice(0, 80);
    const selected = fields.find(field => field.id === committedId);
    if (!term && selected && !visibleFields.some(field => field.id === selected.id)) visibleFields.unshift(selected);
    options.innerHTML = visibleFields.length
      ? visibleFields.map((field, index) => `<button type="button" id="${listId}-${index}" role="option" aria-selected="false" data-jira-field-option="${esc(field.id)}"><strong>${esc(field.name)}</strong><small>${esc(field.id)}${field.custom ? ' · 自定义字段' : ''}</small></button>`).join('') + (matches.length > visibleFields.length ? `<div class="jira-field-options-hint">还有 ${matches.length - visibleFields.length} 个字段，请输入关键词缩小范围</div>` : '')
      : '<div class="jira-field-options-empty">没有匹配的字段</div>';
    activeIndex = -1;
    options.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    options.querySelectorAll('[data-jira-field-option]').forEach((option, index) => {
      option.addEventListener('mousedown', event => event.preventDefault());
      option.onclick = () => selectField(visibleFields[index]);
    });
  };

  root._jiraSetValue = (id, notify = false) => {
    const field = fields.find(item => item.id === id);
    selectField(field || null, notify);
    return Boolean(field);
  };
  input.onfocus = () => {
    input.select();
    renderOptions('');
  };
  input.oninput = () => {
    hidden.value = '';
    renderOptions(input.value);
    onChange?.(null);
  };
  input.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (options.hidden) renderOptions(hidden.value ? '' : input.value);
      if (!visibleFields.length) return;
      activeIndex = event.key === 'ArrowDown'
        ? (activeIndex + 1) % visibleFields.length
        : (activeIndex <= 0 ? visibleFields.length - 1 : activeIndex - 1);
      refreshActive();
    } else if (event.key === 'Enter' && !options.hidden && activeIndex >= 0) {
      event.preventDefault();
      selectField(visibleFields[activeIndex]);
    } else if (event.key === 'Escape') {
      const committed = fields.find(field => field.id === committedId);
      hidden.value = committed?.id || '';
      input.value = jiraFieldDisplay(committed);
      close();
      onChange?.(committed || null);
    }
  };
  input.onblur = () => setTimeout(() => {
    if (root.contains(document.activeElement)) return;
    if (!hidden.value) {
      const typed = input.value.trim().toLowerCase();
      const exact = fields.find(field => field.id.toLowerCase() === typed || field.name.toLowerCase() === typed || jiraFieldDisplay(field).toLowerCase() === typed);
      selectField(exact || fields.find(field => field.id === committedId) || null, true);
    } else input.value = jiraFieldDisplay(fields.find(field => field.id === hidden.value));
    close();
  }, 0);
  toggle.onclick = () => {
    const wasOpen = !options.hidden;
    if (wasOpen) close();
    else {
      input.focus();
      input.select();
      renderOptions('');
    }
  };
  root._jiraSetValue(selectedId);
}

function setJiraFieldPickerValue(root, fieldId, notify = false) {
  return root?._jiraSetValue?.(fieldId, notify) || false;
}

function addJiraCondition(condition = {}) {
  if (!jiraBoardState.metadata) return;
  const row = document.createElement('div');
  row.className = 'jira-condition-row';
  row.innerHTML = `
    ${jiraFieldPickerHtml(condition.fieldId || '')}
    <select data-jira-operator><option value="=">等于</option><option value="!=">不等于</option><option value="~">包含</option><option value="!~">不包含</option><option value="IN">属于</option><option value="NOT IN">不属于</option><option value="IS EMPTY">为空</option><option value="IS NOT EMPTY">不为空</option></select>
    <input data-jira-value value="${esc(condition.value || '')}" placeholder="条件值；多值用逗号分隔">
    <button type="button" class="jira-condition-remove" aria-label="删除条件">×</button>`;
  row.querySelector('[data-jira-operator]').value = condition.operator || '=';
  bindJiraFieldPicker(row.querySelector('[data-jira-field-picker]'), { selectedId:condition.fieldId || '', onChange:updateJiraPreview });
  row.querySelector('[data-jira-operator]').addEventListener('input', updateJiraPreview);
  row.querySelector('[data-jira-value]').addEventListener('input', updateJiraPreview);
  row.querySelector('[data-jira-operator]').addEventListener('change', event => {
    const withoutValue = event.target.value.startsWith('IS ');
    row.querySelector('[data-jira-value]').disabled = withoutValue;
    updateJiraPreview();
  });
  row.querySelector('.jira-condition-remove').onclick = () => { row.remove(); updateJiraPreview(); };
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
  const severityPicker = byId('jira-severity-field-host').querySelector('[data-jira-field-picker]');
  if (!setJiraFieldPickerValue(severityPicker, preset.severityFieldId, true)) toast('方案中的严重等级字段在当前Jira项目中不存在，请重新选择。', 'error');
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
  if (!form.elements.variantFieldId.value) { toast('请选择ECU Variant字段。', 'error'); return; }
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
      variantFieldId: form.elements.variantFieldId.value,
      additionalJql: buildJiraConditions() || null
    };
    jiraBoardState.analysis = await api('/internal/jira-board/analyze', { method: 'POST', body: JSON.stringify(payload) });
    jiraBoardState.commentGeneration += 1;
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

function jiraDateKey(value) { return String(value || '').slice(0, 10); }
function jiraUtcDate(key) { return new Date(`${key}T00:00:00Z`); }
function jiraDateOffset(key, days) { const date=jiraUtcDate(key);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10); }

function jiraTrendBuckets(data, range) {
  const cutoff=data.cutoffDate;
  const dates=data.issues.flatMap(issue=>[jiraDateKey(issue.createdAt),jiraDateKey(issue.closedAt)]).filter(Boolean).sort();
  let start=range==='all'?(dates[0]||cutoff):jiraDateOffset(cutoff,-Number(range)+1);
  if (start>cutoff) start=cutoff;
  const buckets=[];
  if (range==='all') {
    let cursor=`${start.slice(0,7)}-01`;
    while (cursor<=cutoff) {
      const date=jiraUtcDate(cursor);date.setUTCMonth(date.getUTCMonth()+1);date.setUTCDate(0);
      const end=date.toISOString().slice(0,10)>cutoff?cutoff:date.toISOString().slice(0,10);
      buckets.push({start:cursor<start?start:cursor,end,label:cursor.slice(0,7),created:0,closed:0});
      cursor=jiraDateOffset(end,1);
    }
  } else {
    const step=Number(range)>=180?7:1;
    for(let cursor=start;cursor<=cutoff;cursor=jiraDateOffset(cursor,step)) {
      const end=jiraDateOffset(cursor,step-1)>cutoff?cutoff:jiraDateOffset(cursor,step-1);
      buckets.push({start:cursor,end,label:step===1?cursor.slice(5):`${cursor.slice(5)}~${end.slice(5)}`,created:0,closed:0});
    }
  }
  const locate=key=>buckets.find(bucket=>key>=bucket.start&&key<=bucket.end);
  data.issues.forEach(issue=>{
    const created=locate(jiraDateKey(issue.createdAt));if(created)created.created+=1;
    const closed=locate(jiraDateKey(issue.closedAt));if(closed)closed.closed+=1;
  });
  return buckets;
}

function jiraTrendChart(data, range) {
  const buckets=jiraTrendBuckets(data,range);jiraBoardState.trendBuckets=buckets;
  if(!buckets.length)return jiraNoData('暂无趋势数据');
  const width=1000,height=286,left=54,right=24,top=22,bottom=42,plotWidth=width-left-right,plotHeight=height-top-bottom;
  const max=Math.max(1,...buckets.flatMap(x=>[x.created,x.closed]));
  const x=index=>left+(buckets.length===1?plotWidth/2:index*plotWidth/(buckets.length-1));
  const y=value=>top+plotHeight-value/max*plotHeight;
  const path=field=>buckets.map((bucket,index)=>`${index?'L':'M'} ${x(index).toFixed(1)} ${y(bucket[field]).toFixed(1)}`).join(' ');
  const grid=[0,.25,.5,.75,1].map(ratio=>`<g><line x1="${left}" y1="${top+plotHeight*(1-ratio)}" x2="${width-right}" y2="${top+plotHeight*(1-ratio)}"></line><text x="${left-10}" y="${top+plotHeight*(1-ratio)+4}" text-anchor="end">${Math.round(max*ratio)}</text></g>`).join('');
  const labelEvery=Math.max(1,Math.ceil(buckets.length/7));
  const labels=buckets.map((bucket,index)=>index%labelEvery===0||index===buckets.length-1?`<text x="${x(index)}" y="${height-13}" text-anchor="middle">${esc(bucket.label)}</text>`:'').join('');
  const points=(field,label,color)=>buckets.map((bucket,index)=>`<g class="jira-trend-point" data-jira-trend-index="${index}" data-jira-trend-kind="${field}" tabindex="0" role="button" aria-label="${esc(bucket.start)}至${esc(bucket.end)} ${label}${bucket[field]}项"><circle class="hit" cx="${x(index)}" cy="${y(bucket[field])}" r="9"></circle><circle cx="${x(index)}" cy="${y(bucket[field])}" r="3" fill="${color}"></circle><title>${bucket.start}${bucket.end===bucket.start?'':` ~ ${bucket.end}`}：${label}${bucket[field]}项</title></g>`).join('');
  return `<div class="jira-trend-legend"><span><i class="created"></i>新增问题</span><span><i class="closed"></i>关闭问题</span><small>点击数据点查看明细</small></div><div class="jira-trend-scroll"><svg class="jira-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="问题新增与关闭趋势"><g class="grid">${grid}${labels}</g><path class="created" d="${path('created')}"></path><path class="closed" d="${path('closed')}"></path>${points('created','新增问题','#4e6fe4')}${points('closed','关闭问题','#1ca47e')}</svg></div>`;
}

function jiraFunnelChart(items) {
  const rowHeight = 86, center = 500;
  const max=Math.max(1,...items.map(item=>item.count));
  const widths=items.map(item=>260+(item.count/max)*660);
  const points = items.map((item,index) => {
    const top=widths[index],bottom=widths[index+1]??top,y=index*rowHeight;
    return `<g class="jira-funnel-layer" data-jira-stage="${esc(item.code)}" tabindex="0" role="button" aria-label="${esc(item.name)}累计到达${item.count}项，到达率${jiraPercent(item.share)}，环节转化率${jiraPercent(item.previousConversion)}"><polygon points="${center-top/2},${y+2} ${center+top/2},${y+2} ${center+bottom/2},${y+rowHeight-3} ${center-bottom/2},${y+rowHeight-3}" fill="${jiraStageColors[item.code]}"></polygon><text x="${center}" y="${y+31}" text-anchor="middle">${esc(item.name)} · ${jiraNumber(item.count)}项</text><text class="sub" x="${center}" y="${y+51}" text-anchor="middle">到达率 ${jiraPercent(item.share)} · 环节转化 ${jiraPercent(item.previousConversion)}</text><text class="sub loss" x="${center}" y="${y+68}" text-anchor="middle">${index?'较上一阶段流失 '+jiraNumber(item.dropFromPrevious)+' 项':'全部问题基准'}</text></g>`;
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

function jiraPieSector(start,end,cx=82,cy=82,r=68) {
  const point=angle=>{const radians=(angle-90)*Math.PI/180;return [cx+r*Math.cos(radians),cy+r*Math.sin(radians)];};
  const from=point(start),to=point(end),large=end-start>180?1:0;
  return `M ${cx} ${cy} L ${from[0]} ${from[1]} A ${r} ${r} 0 ${large} 1 ${to[0]} ${to[1]} Z`;
}

function jiraVariantPie(data) {
  const active=data.issues.filter(issue=>issue.stageCode!=='closed');
  const definitions=[['ADS','ADS','#4e6fe4'],['LIDAR','LiDAR','#16a38f'],['OTHER','其他/未填写','#aab4c4']];
  const values=definitions.map(([key,label,color])=>({key,label,color,count:active.filter(issue=>issue.variantKey===key).length}));
  const total=active.length||1;let cursor=0;
  const slices=values.filter(item=>item.count).map(item=>{
    const start=cursor;cursor+=item.count/total*360;
    return item.count===total
      ? `<circle cx="82" cy="82" r="68" fill="${item.color}" data-jira-variant="${item.key}" tabindex="0" role="button"><title>${item.label} ${item.count}项</title></circle>`
      : `<path d="${jiraPieSector(start,cursor)}" fill="${item.color}" data-jira-variant="${item.key}" tabindex="0" role="button"><title>${item.label} ${item.count}项</title></path>`;
  }).join('');
  return `<div class="jira-variant-pie"><svg viewBox="0 0 164 164" aria-label="未关闭问题ECU Variant分布">${slices||'<circle cx="82" cy="82" r="68" fill="#e9edf3"></circle>'}</svg><div class="jira-variant-total"><strong>${jiraNumber(active.length)}</strong><span>未关闭问题</span></div></div><div class="jira-variant-legend">${values.map(item=>`<button type="button" data-jira-variant="${item.key}"><i style="background:${item.color}"></i><span>${item.label}</span><strong>${item.count}</strong><small>${jiraPercent(active.length?item.count/active.length*100:null)}</small></button>`).join('')}</div>`;
}

function jiraVariantAssigneeChart(data, mode) {
  const issues=data.issues.filter(issue=>issue.stageCode!=='closed'&&issue.variantKey===mode);
  const values=jiraDistribution(issues,'assignee','未分配');
  const max=Math.max(1,...values.map(item=>item[1]));
  return values.length?`<div class="jira-assignee-backlog">${values.map(item=>`<button type="button" data-jira-variant-assignee="${esc(item[0])}"><span title="${esc(item[0])}">${esc(item[0])}</span><i><b style="width:${item[1]/max*100}%"></b></i><strong>${item[1]}</strong></button>`).join('')}</div>`:jiraNoData(`${mode==='LIDAR'?'LiDAR':'ADS'}暂无未关闭问题`);
}

function renderJiraVariantAssignees(data) {
  const host=byId('jira-variant-assignee-chart');if(!host)return;
  host.innerHTML=jiraVariantAssigneeChart(data,jiraBoardState.variantMode);
  document.querySelectorAll('[data-jira-variant-mode]').forEach(button=>button.classList.toggle('active',button.dataset.jiraVariantMode===jiraBoardState.variantMode));
  host.querySelectorAll('[data-jira-variant-assignee]').forEach(button=>button.onclick=()=>{
    const assignee=button.dataset.jiraVariantAssignee;
    const issues=data.issues.filter(issue=>issue.stageCode!=='closed'&&issue.variantKey===jiraBoardState.variantMode&&issue.assignee===assignee);
    openJiraDetails(`${jiraBoardState.variantMode==='LIDAR'?'LiDAR':'ADS'} · ${assignee} · ${issues.length}项`,issues,'stage');
  });
}

function jiraFollowUpChart(items, failedCount) {
  const order={S:0,A:1,B:2,C:3,UNKNOWN:9};
  const severity=[...new Map(items.map(issue=>[issue.severityLabel,{label:issue.severityLabel,key:issue.severityKey,count:0}])).values()];
  severity.forEach(group=>group.count=items.filter(issue=>issue.severityLabel===group.label).length);
  severity.sort((a,b)=>(order[a.key]??9)-(order[b.key]??9)||b.count-a.count);
  const max=Math.max(1,...severity.map(item=>item.count));
  return `<div class="jira-followup-chart"><button type="button" class="jira-followup-total" data-jira-followup="all"><span>当日未跟进</span><strong>${jiraNumber(items.length)}</strong><small>未关闭且截止日没有新增评论</small></button><div class="jira-followup-severity">${severity.length?severity.map(item=>`<button type="button" data-jira-followup="${esc(item.label)}"><span class="jira-severity ${esc(item.key.toLowerCase())}">${esc(item.label)}</span><i><b style="width:${item.count/max*100}%"></b></i><strong>${item.count}</strong></button>`).join(''):jiraNoData('所有未关闭问题当日均有跟进')}</div></div>${failedCount?`<p class="jira-chart-warning">另有 ${failedCount} 项最新评论读取失败，未纳入未跟进统计。</p>`:''}`;
}

async function loadJiraFollowUpAnalysis(data) {
  const host=byId('jira-followup-host');if(!host)return;
  const active=data.issues.filter(issue=>issue.stageCode!=='closed');
  if(!active.length){host.innerHTML=jiraFollowUpChart([],0);return;}
  host.innerHTML='<div class="jira-chart-loading"><div class="jira-spinner"></div><strong>正在核对当日评论</strong><span>0 / '+jiraNumber(active.length)+'</span></div>';
  await loadJiraComments(active.map(issue=>issue.key),(completed,total)=>{
    if(jiraBoardState.analysis!==data)return;
    const progress=host.querySelector('span');if(progress)progress.textContent=`${jiraNumber(completed)} / ${jiraNumber(total)}`;
  });
  if(jiraBoardState.analysis!==data||!byId('jira-followup-host'))return;
  const failed=active.filter(issue=>jiraBoardState.commentCache.get(issue.key)?.error);
  const items=active.filter(issue=>{const comment=jiraBoardState.commentCache.get(issue.key);return comment&&!comment.error&&jiraDateKey(comment.created)!==data.cutoffDate;});
  host.innerHTML=jiraFollowUpChart(items,failed.length);
  host.querySelectorAll('[data-jira-followup]').forEach(button=>button.onclick=()=>{
    const value=button.dataset.jiraFollowup;
    const detail=value==='all'?items:items.filter(issue=>issue.severityLabel===value);
    openJiraDetails(`当日未跟进${value==='all'?'':` · ${value}`} · ${detail.length}项`,detail,'stage',{compact:true});
  });
}

function bindJiraKeyboardClicks(root) {
  root.querySelectorAll('[role="button"][tabindex="0"]').forEach(item=>item.onkeydown=event=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();item.onclick?.();}
  });
}

function renderJiraTrend(data) {
  const host=byId('jira-trend-chart');if(!host)return;
  host.innerHTML=jiraTrendChart(data,jiraBoardState.trendRange);
  document.querySelectorAll('[data-jira-trend-range]').forEach(button=>button.classList.toggle('active',button.dataset.jiraTrendRange===jiraBoardState.trendRange));
  host.querySelectorAll('[data-jira-trend-index]').forEach(point=>point.onclick=()=>{
    const bucket=jiraBoardState.trendBuckets[Number(point.dataset.jiraTrendIndex)],kind=point.dataset.jiraTrendKind;
    const issues=data.issues.filter(issue=>{const key=jiraDateKey(kind==='created'?issue.createdAt:issue.closedAt);return key>=bucket.start&&key<=bucket.end;});
    openJiraDetails(`${bucket.start}${bucket.end===bucket.start?'':` ~ ${bucket.end}`} · ${kind==='created'?'新增':'关闭'}问题 · ${issues.length}项`,issues,kind==='closed'?'closure':'stage');
  });
  bindJiraKeyboardClicks(host);
}

function renderJiraResults(data) {
  const warnings = [];
  if (data.truncated) warnings.push(`Jira共返回 ${jiraNumber(data.sourceTotal)} 条，当前看板为保护服务器仅分析前 5,000 条，请缩小查询条件。`);
  if (data.historyTruncated) warnings.push(`有 ${jiraNumber(data.historyTruncated)} 条问题的 Jira 变更历史超过接口单次展开上限，其历史阶段到达及阶段时长可能不完整，建议缩小查询范围后复核。`);
  if (data.unmatchedStatuses.length) warnings.push(`有 ${data.unmatchedStatuses.reduce((sum, x) => sum + x.count, 0)} 条问题状态未匹配处理阶段：${data.unmatchedStatuses.map(x => `${x.status}(${x.count})`).join('、')}。`);
  if (data.unmatchedSeverities.length) warnings.push(`有 ${data.unmatchedSeverities.reduce((sum, x) => sum + x.count, 0)} 条问题的严重等级无法映射为 S/A/B/C，因此不参与超时判定：${data.unmatchedSeverities.map(x => `${x.severity}(${x.count})`).join('、')}。`);
  const results = byId('jira-board-results');
  results.innerHTML = `
    <section class="jira-result-head"><div><span>ANALYSIS RESULT</span><h3>${esc(data.project)} · 截至 ${esc(data.cutoffDate)}</h3><p>应用标准：${esc(data.standard.projectName)}（修订 ${data.standard.revision}） · 查询口径：<code>${esc(data.query)}</code></p></div><button type="button" class="btn btn-light btn-sm" id="jira-copy-jql">复制JQL</button></section>
    ${warnings.map(text => `<div class="jira-warning">${esc(text)}</div>`).join('')}
    <section class="jira-metrics">
      ${jiraMetric('统计问题', data.summary.total, '查询范围内全部问题', 'all')}
      ${jiraMetric('待关闭问题', data.summary.active, '截止日仍未进入关闭阶段', 'active', 'primary')}
      ${jiraMetric('整体关闭率', jiraPercent(data.summary.closureRate), `${jiraNumber(data.summary.closed)} 项已关闭`, 'closed', 'success')}
      ${jiraMetric('平均关闭周期', jiraDays(data.summary.averageClosureDays), '仅统计已关闭问题', 'closed-duration', 'violet')}
      ${jiraMetric('阶段超时', data.summary.stageOverdue, '当前阶段超过时效', 'stage-overdue', 'danger')}
      ${jiraMetric('关闭周期超时', data.summary.closureOverdue, '当前未关闭且超过总周期', 'closure-overdue', 'orange')}
    </section>
    <section class="jira-panel jira-trend-panel">
      <div class="jira-panel-head"><div><span>ISSUE TREND</span><h3>问题新增与关闭趋势</h3><p>双折线对比问题流入与关闭节奏，点击数据点可查看问题明细。</p></div><div class="jira-segmented">${[['30','30天'],['90','90天'],['180','180天'],['all','全部']].map(item=>`<button type="button" data-jira-trend-range="${item[0]}" class="${jiraBoardState.trendRange===item[0]?'active':''}">${item[1]}</button>`).join('')}</div></div>
      <div id="jira-trend-chart"></div>
    </section>
    <section class="jira-panel jira-funnel-panel">
      <div class="jira-panel-head"><div><span>PROCESS FUNNEL</span><h3>问题处理阶段漏斗</h3><p>按截止日前累计到达的最深阶段向前统计；点击任一阶段查看已到达问题明细。</p></div><small>累计到达口径</small></div>
      <div class="jira-funnel-chart">${jiraFunnelChart(data.funnel)}</div>
    </section>
    <div class="jira-insight-grid">
      <section class="jira-panel jira-variant-panel">
        <div class="jira-panel-head"><div><span>VARIANT BACKLOG</span><h3>未关闭问题车型域分布</h3><p>饼图展示ADS、LiDAR及其他问题占比；右侧展示当前处理人堆积数量。</p></div><div class="jira-segmented"><button type="button" data-jira-variant-mode="ADS" class="active">ADS</button><button type="button" data-jira-variant-mode="LIDAR">LiDAR</button></div></div>
        <div class="jira-variant-body"><div class="jira-variant-summary">${jiraVariantPie(data)}</div><div><div class="jira-subhead"><strong>当前处理人问题堆积</strong><span>按数量从高到低 · 点击柱条查看明细</span></div><div id="jira-variant-assignee-chart"></div></div></div>
      </section>
      <section class="jira-panel jira-followup-panel">
        <div class="jira-panel-head"><div><span>DAILY FOLLOW-UP</span><h3>当日未跟进问题</h3><p>统计未关闭且截止日没有新增评论的问题，可按严重等级穿透。</p></div><small>仅以新增评论判断</small></div>
        <div id="jira-followup-host"></div>
      </section>
    </div>
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

  renderJiraTrend(data);
  renderJiraVariantAssignees(data);
  loadJiraFollowUpAnalysis(data);

  byId('jira-copy-jql').onclick = async () => {
    try { await navigator.clipboard.writeText(data.query); toast('JQL已复制。'); }
    catch { toast('浏览器未允许复制，请从查询口径中手动复制JQL。', 'error'); }
  };
  results.querySelectorAll('[data-jira-stage]').forEach(button => button.onclick = () => {
    const code = button.dataset.jiraStage;
    const stage = data.funnel.find(x => x.code === code);
    openJiraDetails(`${stage.name}累计到达 · ${stage.count}项`, data.issues.filter(x => x.maxReachedStageOrder >= stage.order), code === 'closed' ? 'closure' : 'stage');
  });
  results.querySelectorAll('.jira-funnel-layer').forEach(layer => layer.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); layer.onclick(); } });
  results.querySelectorAll('[data-jira-trend-range]').forEach(button=>button.onclick=()=>{jiraBoardState.trendRange=button.dataset.jiraTrendRange;renderJiraTrend(data);});
  results.querySelectorAll('[data-jira-variant-mode]').forEach(button=>button.onclick=()=>{jiraBoardState.variantMode=button.dataset.jiraVariantMode;renderJiraVariantAssignees(data);});
  results.querySelectorAll('[data-jira-variant]').forEach(button=>button.onclick=()=>{
    const key=button.dataset.jiraVariant;
    const issues=data.issues.filter(issue=>issue.stageCode!=='closed'&&issue.variantKey===key);
    const label=key==='LIDAR'?'LiDAR':key==='ADS'?'ADS':'其他/未填写';
    openJiraDetails(`${label}未关闭问题 · ${issues.length}项`,issues,'stage');
  });
  bindJiraKeyboardClicks(results);
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

function openJiraDetails(title, items, overdueMode, { compact = false } = {}) {
  let page = 1;
  const pageSize = 50;
  const severity = jiraDistribution(items, 'severityLabel', '未设置');
  const assignees = jiraDistribution(items, 'assignee', '未分配');
  modalRoot.innerHTML = `<div class="modal-backdrop jira-detail-backdrop"><div class="jira-detail-modal"><div class="jira-detail-head"><div><span>DRILL DOWN</span><h3>${esc(title)}</h3><p>当前穿透范围共 ${jiraNumber(items.length)} 项，${compact?'导出包含看板要求的六项核心字段。':'导出将包含全部明细及最新评论。'}</p></div><div class="jira-detail-actions"><button type="button" class="btn btn-light btn-sm jira-export-button" data-jira-export ${items.length?'':'disabled'}><span>↓</span> 导出CSV</button><button type="button" class="jira-detail-close" aria-label="关闭">×</button></div></div><div id="jira-detail-body"></div></div></div>`;
  const close = () => modalRoot.replaceChildren();
  modalRoot.querySelector('.jira-detail-close').onclick = close;
  modalRoot.querySelector('[data-jira-export]').onclick = event => exportJiraDetails(title,items,overdueMode,event.currentTarget,{compact});
  modalRoot.querySelector('.jira-detail-backdrop').onclick = event => { if (event.target.classList.contains('jira-detail-backdrop')) close(); };

  const renderPage = async () => {
    if (!modalRoot.querySelector('#jira-detail-body')) return;
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    page = Math.min(Math.max(1, page), totalPages);
    const visible = items.slice((page - 1) * pageSize, page * pageSize);
    byId('jira-detail-body').innerHTML = items.length ? `
      <div class="jira-detail-breakdowns"><div><div><strong>严重等级分布</strong><small>按当前明细范围统计</small></div><section>${jiraPieChart(severity)}</section></div><div><div><strong>处理人分布</strong><small>按问题数量从高到低</small></div><section>${jiraAssigneeChart(assignees)}</section></div></div>
      <div class="jira-detail-table-wrap"><table><thead>${compact?'<tr><th>Jira编号</th><th>标题</th><th>严重等级</th><th>当前处理人</th><th>当前状态</th><th>所属阶段</th></tr>':'<tr><th>严重等级</th><th>Jira编号 / 标题</th><th>当前处理人</th><th>当前状态</th><th>最新结论</th><th>是否超时</th></tr>'}</thead><tbody>${visible.map(issue => compact?jiraCompactIssueRow(issue):jiraIssueRow(issue, overdueMode)).join('')}</tbody></table></div>
      <div class="jira-detail-pagination"><span>共 ${jiraNumber(items.length)} 项 · 第 ${page}/${totalPages} 页</span><div><button type="button" class="btn btn-light btn-sm" data-page="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><button type="button" class="btn btn-light btn-sm" data-page="next" ${page >= totalPages ? 'disabled' : ''}>下一页</button></div></div>`
      : jiraNoData('该范围内暂无问题');
    byId('jira-detail-body').querySelector('[data-page="prev"]')?.addEventListener('click', () => { page -= 1; renderPage(); });
    byId('jira-detail-body').querySelector('[data-page="next"]')?.addEventListener('click', () => { page += 1; renderPage(); });
    if(!compact)await loadJiraComments(visible.map(x => x.key));
  };
  renderPage();
}

function jiraCompactIssueRow(issue) {
  return `<tr><td><a href="${esc(issue.url)}" target="_blank" rel="noopener noreferrer">${esc(issue.key)}</a></td><td><strong>${esc(issue.summary)}</strong></td><td><span class="jira-severity ${esc(issue.severityKey.toLowerCase())}">${esc(issue.severityLabel)}</span></td><td>${esc(issue.assignee)}</td><td><span class="jira-status-dot" style="--stage:${jiraStageColors[issue.stageCode]||jiraStageColors.other}"></span>${esc(issue.status)}</td><td>${esc(issue.stageName)}</td></tr>`;
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

async function loadJiraComments(keys,onProgress=null,generation=jiraBoardState.commentGeneration) {
  const unique=[...new Set(keys)],missing=unique.filter(key => !jiraBoardState.commentCache.has(key));
  let completed=unique.length-missing.length;onProgress?.(completed,unique.length);
  if (!missing.length) return;
  for (let index=0;index<missing.length;index+=100) {
    if(generation!==jiraBoardState.commentGeneration)return;
    const batch=missing.slice(index,index+100);
    try {
      const response = await api('/internal/jira-board/comments', {
        method: 'POST',
        body: JSON.stringify({ connection: jiraConnection(), cutoffDate: jiraBoardState.analysis.cutoffDate, issueKeys: batch })
      });
      if(generation!==jiraBoardState.commentGeneration)return;
      response.items.forEach(item => jiraBoardState.commentCache.set(item.key, item));
    } catch (error) {
      if(generation!==jiraBoardState.commentGeneration)return;
      batch.forEach(key => jiraBoardState.commentCache.set(key, { body: null, error: error.message }));
    }
    completed+=batch.length;onProgress?.(completed,unique.length);
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

async function exportJiraDetails(title,items,overdueMode,button,{compact=false}={}) {
  if (!items.length) return;
  const original=button.textContent;
  button.disabled=true;button.textContent=compact?'正在导出…':'准备最新评论…';
  if(!compact)await loadJiraComments(items.map(x=>x.key));
  const headers=compact?['Jira编号','标题','严重等级','当前处理人','当前状态','所属阶段']:['Jira编号','标题','严重等级','当前处理人','当前状态','所属阶段','最新结论','评论人','评论时间','创建时间','关闭时间','阶段停留天数','阶段时限','阶段超时天数','关闭周期天数','关闭总周期时限','关闭超时天数'];
  const rows=items.map(issue=>{
    if(compact)return [issue.key,issue.summary,issue.severityLabel,issue.assignee,issue.status,issue.stageName];
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
