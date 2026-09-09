const jiraBoardState = {
  metadata: null, metadataProjectKey: '', projects: [], server: null, analysis: null,
  commentCache: new Map(), commentGeneration: 0, presets: [], editingPresetId: null,
  selectedPresetIds: new Set(), dirty: false, applyingPreset: false,
  trendRange: '90', trendVisible: { created:true, closed:true }, variantMode: 'ADS',
  assigneeExpanded: false, overdueSort: 'process', pdfReady: false
};

const jiraStageColors = {
  new: '#6f7f9b', confirm: '#4e7bf2', analysis: '#6b5ce7', action: '#b86fe2',
  verify: '#159eaf', closed: '#21a675', closure: '#e04f64', other: '#a06a46'
};
let jiraFieldPickerSequence = 0;

function jiraToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function renderJiraBoard() {
  setPage('JIRA看板', '组合多个项目查询方案，识别流程瓶颈、积压风险与处理效率');
  jiraBoardState.metadata = null;
  jiraBoardState.metadataProjectKey = '';
  jiraBoardState.analysis = null;
  jiraBoardState.presets = [];
  jiraBoardState.editingPresetId = null;
  jiraBoardState.selectedPresetIds = new Set();
  jiraBoardState.dirty = false;
  jiraBoardState.trendRange = '90';
  jiraBoardState.trendVisible = { created:true, closed:true };
  jiraBoardState.variantMode = 'ADS';
  jiraBoardState.assigneeExpanded = false;
  jiraBoardState.overdueSort = 'process';
  jiraBoardState.pdfReady = false;
  jiraBoardState.commentGeneration += 1;
  jiraBoardState.commentCache.clear();
  content.innerHTML = '<section class="jira-loading"><div class="jira-spinner"></div><strong>正在读取Jira连接和查询方案</strong><span>请稍候…</span></section>';
  try {
    const [projectData,presetData]=await Promise.all([api('/internal/jira-board/projects'),api('/internal/jira-board/presets')]);
    jiraBoardState.projects=projectData.projects||[];
    jiraBoardState.server=projectData.server||null;
    jiraBoardState.presets=presetData.items||[];
  } catch(error) {
    content.innerHTML=`<section class="jira-empty error"><div>!</div><strong>Jira连接尚未就绪</strong><span>${esc(error.message)}</span>${hasPermission('MASTERDATA_VIEW')?'<a class="btn btn-primary" href="#/settings">前往基础设置</a>':''}</section>`;
    return;
  }
  content.innerHTML = `
    <section class="jira-config-card">
      <div class="jira-section-head"><div><h3>分析范围</h3><p>选择一个或多个查询方案统一分析；每个方案绑定一个项目并独立匹配字段和时效标准。</p></div><div class="jira-connection-badge ready"><i></i>${esc(jiraBoardState.server?.title||'Jira Server')} ${esc(jiraBoardState.server?.version||'')}</div></div>
      <form id="jira-board-form">
        <div class="jira-analysis-toolbar">
          <label><span>统计截止日期 *</span><input name="cutoffDate" type="date" value="${jiraToday()}" max="${jiraToday()}" required></label>
          <div><span>已选查询方案</span><strong id="jira-selected-count">0 个</strong></div>
          <div><span>涉及项目</span><strong id="jira-selected-projects">—</strong></div>
          <button type="button" class="btn btn-primary" id="jira-run-analysis">开始分析</button>
        </div>
        <div class="jira-preset-workspace">
          <aside class="jira-preset-sidebar">
            <div class="jira-preset-sidebar-head"><div><strong>查询方案</strong><span>勾选后参与本次分析</span></div><button type="button" class="btn btn-light btn-sm" id="jira-preset-new">+ 新建</button></div>
            <div id="jira-preset-list" class="jira-preset-list"></div>
          </aside>
          <div class="jira-preset-editor">
            <div class="jira-editor-head"><div><strong id="jira-editor-title">新建查询方案</strong><span id="jira-unsaved-badge" class="jira-unsaved-badge hidden">未保存</span></div><span id="jira-project-load-status">请先选择项目</span></div>
            <div class="jira-config-grid compact">
              <label><span>项目编号 *</span><input name="projectKey" list="jira-project-options" placeholder="输入项目编号或名称搜索" autocomplete="off" required><datalist id="jira-project-options">${jiraBoardState.projects.map(x=>`<option value="${esc(x.key)}">${esc(x.name)}</option>`).join('')}</datalist></label>
              <div class="jira-config-field"><label for="jira-severity-field-input">严重等级字段 *</label><div id="jira-severity-field-host">${jiraFieldPickerHtml('', { name:'severityFieldId', placeholder:'选择项目后搜索字段', disabled:true, inputId:'jira-severity-field-input' })}</div><small id="jira-severity-error"></small></div>
              <div class="jira-config-field"><label for="jira-variant-field-input">ECU Variant字段 *</label><div id="jira-variant-field-host">${jiraFieldPickerHtml('', { name:'variantFieldId', placeholder:'选择项目后搜索字段', disabled:true, inputId:'jira-variant-field-input' })}</div><small id="jira-variant-error"></small></div>
            </div>
            <div id="jira-query-builder" class="jira-query-builder hidden">
              <div class="jira-builder-head"><div><strong>组合查询条件</strong><span>项目和截止日期由系统自动叠加</span></div><button type="button" class="btn btn-light btn-sm" id="jira-add-condition">+ 添加条件</button></div>
              <div id="jira-condition-list" class="jira-condition-list"></div>
              <details class="jira-jql-details"><summary>查看查询口径</summary><label class="jira-raw-jql"><span>附加JQL（可选）</span><textarea name="rawJql" rows="2" placeholder="例如：issuetype = Bug AND labels in (vehicle-test)"></textarea></label><div class="jira-query-preview"><span>最终附加条件</span><code id="jira-jql-preview">无</code></div></details>
            </div>
            <div class="jira-editor-actions"><button type="button" class="btn btn-danger btn-sm hidden" id="jira-preset-delete">删除方案</button><div><button type="button" class="btn btn-light" id="jira-preset-save-new">另存为新方案</button><button type="button" class="btn btn-primary" id="jira-preset-save">保存方案</button></div></div>
          </div>
        </div>
      </form>
    </section>
    <div id="jira-board-results"><section class="jira-empty"><div>◆</div><strong>选择查询方案后生成看板</strong><span>可以同时选择多个项目方案，系统会去重汇总并按各项目标准计算。</span></section></div>`;

  renderJiraPresetList();
  byId('jira-preset-new').onclick=()=>switchJiraPresetEditor(null);
  byId('jira-preset-save').onclick=()=>saveJiraPreset(false);
  byId('jira-preset-save-new').onclick=()=>saveJiraPreset(true);
  byId('jira-preset-delete').onclick=deleteJiraPreset;
  byId('jira-add-condition').onclick=()=>{addJiraCondition();markJiraDirty();};
  byId('jira-run-analysis').onclick=runJiraAnalysis;
  byId('jira-board-form').elements.projectKey.addEventListener('change',handleJiraProjectChange);
  byId('jira-board-form').elements.projectKey.addEventListener('input',markJiraDirty);
  byId('jira-board-form').elements.rawJql.addEventListener('input',()=>{updateJiraPreview();markJiraDirty();});
  updateJiraSelectionSummary();
  if(jiraBoardState.presets.length)await switchJiraPresetEditor(jiraBoardState.presets[0].id,true);
}

function jiraProjectKey(){return byId('jira-board-form')?.elements.projectKey.value.trim().toUpperCase()||'';}

async function loadJiraMetadataForProject(preset=null) {
  const form = byId('jira-board-form');
  const projectKey=jiraProjectKey();
  const project=jiraBoardState.projects.find(x=>x.key.toUpperCase()===projectKey);
  if(!project){byId('jira-project-load-status').textContent='请选择列表中的项目';return false;}
  byId('jira-project-load-status').textContent='正在加载项目字段…';
  try {
    const metadata = await api('/internal/jira-board/metadata', { method: 'POST', body: JSON.stringify({projectKey}) });
    jiraBoardState.metadata = metadata;
    jiraBoardState.metadataProjectKey=projectKey;
    const projectFields = metadata.projectFields || metadata.fields;
    const candidate = projectFields.find(field => field.severityCandidate);
    const variantCandidate = projectFields.find(field => field.name.trim().toLowerCase() === 'ecu variant')
      || projectFields.find(field => field.name.toLowerCase().includes('ecu variant'));
    const severityHost = byId('jira-severity-field-host');
    const severityId=preset?.severityFieldId||candidate?.id||'';
    severityHost.innerHTML = jiraFieldPickerHtml(severityId, { name:'severityFieldId', placeholder:'搜索项目表单字段', inputId:'jira-severity-field-input' });
    bindJiraFieldPicker(severityHost.firstElementChild, { fields:projectFields, selectedId:severityId, onChange:()=>{updateJiraPreview();markJiraDirty();} });
    const variantHost = byId('jira-variant-field-host');
    const variantId=preset?.variantFieldId||variantCandidate?.id||'';
    variantHost.innerHTML = jiraFieldPickerHtml(variantId, { name:'variantFieldId', placeholder:'搜索项目表单字段', inputId:'jira-variant-field-input' });
    bindJiraFieldPicker(variantHost.firstElementChild, { fields:projectFields, selectedId:variantId, onChange:()=>{updateJiraPreview();markJiraDirty();} });
    byId('jira-query-builder').classList.remove('hidden');
    byId('jira-project-load-status').textContent=metadata.standard?`${metadata.project.name} · ${projectFields.length}个项目字段 · 已匹配时效标准`:`${metadata.project.name} · 未配置时效标准`;
    byId('jira-severity-error').textContent=severityId&&projectFields.some(x=>x.id===severityId)?'':'请选择当前项目的严重等级字段';
    byId('jira-variant-error').textContent=variantId&&projectFields.some(x=>x.id===variantId)?'':'请选择当前项目的ECU Variant字段';
    if (metadata.projectFieldWarning) toast(metadata.projectFieldWarning, 'error');
    return true;
  } catch (error) {
    jiraBoardState.metadata = null;
    jiraBoardState.metadataProjectKey='';
    byId('jira-project-load-status').textContent='项目字段加载失败';
    toast(error.message, 'error');
    return false;
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
  bindJiraFieldPicker(row.querySelector('[data-jira-field-picker]'), { selectedId:condition.fieldId || '', onChange:()=>{updateJiraPreview();markJiraDirty();} });
  row.querySelector('[data-jira-operator]').addEventListener('input',()=>{updateJiraPreview();markJiraDirty();});
  row.querySelector('[data-jira-value]').addEventListener('input',()=>{updateJiraPreview();markJiraDirty();});
  row.querySelector('[data-jira-operator]').addEventListener('change', event => {
    const withoutValue = event.target.value.startsWith('IS ');
    row.querySelector('[data-jira-value]').disabled = withoutValue;
    updateJiraPreview();markJiraDirty();
  });
  row.querySelector('.jira-condition-remove').onclick = () => { row.remove(); updateJiraPreview();markJiraDirty(); };
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

function renderJiraPresetList(){
  const host=byId('jira-preset-list');if(!host)return;
  host.innerHTML=jiraBoardState.presets.length?jiraBoardState.presets.map(item=>`<div class="jira-preset-item ${jiraBoardState.editingPresetId===item.id?'editing':''} ${!item.severityFieldId||!item.variantFieldId?'incomplete':''}"><label><input type="checkbox" data-jira-preset-check="${item.id}" ${jiraBoardState.selectedPresetIds.has(item.id)?'checked':''}><span><strong>${esc(item.name)}</strong><small>${esc(item.projectKey)}${!item.severityFieldId||!item.variantFieldId?' · 字段待补充':''}</small></span></label><button type="button" data-jira-preset-edit="${item.id}" aria-label="编辑${esc(item.name)}">编辑</button></div>`).join(''):'<div class="jira-preset-empty">暂无查询方案<br><small>新建并保存后即可组合分析</small></div>';
  host.querySelectorAll('[data-jira-preset-check]').forEach(input=>input.onchange=()=>{const id=Number(input.dataset.jiraPresetCheck);if(input.checked)jiraBoardState.selectedPresetIds.add(id);else jiraBoardState.selectedPresetIds.delete(id);updateJiraSelectionSummary();});
  host.querySelectorAll('[data-jira-preset-edit]').forEach(button=>button.onclick=()=>switchJiraPresetEditor(Number(button.dataset.jiraPresetEdit)));
}

function updateJiraSelectionSummary(){
  const selected=jiraBoardState.presets.filter(x=>jiraBoardState.selectedPresetIds.has(x.id));
  const incomplete=selected.filter(x=>!x.severityFieldId||!x.variantFieldId).length;
  if(byId('jira-selected-count'))byId('jira-selected-count').textContent=`${selected.length} 个${incomplete?`（${incomplete}个待补充字段）`:''}`;
  if(byId('jira-selected-projects'))byId('jira-selected-projects').textContent=[...new Set(selected.map(x=>x.projectKey))].join('、')||'—';
}

function markJiraDirty(){
  if(jiraBoardState.applyingPreset)return;
  jiraBoardState.dirty=true;
  byId('jira-unsaved-badge')?.classList.remove('hidden');
}

async function switchJiraPresetEditor(id,force=false){
  if(!force&&jiraBoardState.dirty){const answer=await confirmAction('切换查询方案','当前修改尚未保存，继续切换将丢失这些修改。',{submitText:'继续切换'});if(!answer.confirmed)return;}
  const preset=jiraBoardState.presets.find(x=>x.id===id)||null;
  jiraBoardState.applyingPreset=true;jiraBoardState.editingPresetId=preset?.id||null;jiraBoardState.dirty=false;
  const form=byId('jira-board-form');
  form.elements.projectKey.value=preset?.projectKey||'';
  form.elements.rawJql.value=preset?.additionalJql||'';
  byId('jira-condition-list').replaceChildren();
  byId('jira-query-builder').classList.toggle('hidden',!preset);
  byId('jira-editor-title').textContent=preset?`${preset.name} · ${preset.projectKey}`:'新建查询方案';
  byId('jira-preset-delete').classList.toggle('hidden',!preset);
  byId('jira-unsaved-badge').classList.add('hidden');
  if(preset){
    const loaded=await loadJiraMetadataForProject(preset);
    if(loaded){(preset.conditions||[]).forEach(addJiraCondition);if(!(preset.conditions||[]).length)addJiraCondition();}
  }else{
    jiraBoardState.metadata=null;jiraBoardState.metadataProjectKey='';byId('jira-project-load-status').textContent='请先选择项目';
    byId('jira-severity-field-host').innerHTML=jiraFieldPickerHtml('',{name:'severityFieldId',placeholder:'选择项目后搜索字段',disabled:true,inputId:'jira-severity-field-input'});
    byId('jira-variant-field-host').innerHTML=jiraFieldPickerHtml('',{name:'variantFieldId',placeholder:'选择项目后搜索字段',disabled:true,inputId:'jira-variant-field-input'});
  }
  updateJiraPreview();jiraBoardState.applyingPreset=false;if(preset&&(!preset.severityFieldId||!preset.variantFieldId))markJiraDirty();renderJiraPresetList();
}

async function handleJiraProjectChange(){
  const preset=jiraBoardState.presets.find(x=>x.id===jiraBoardState.editingPresetId);
  const sameProject=preset?.projectKey===jiraProjectKey();
  jiraBoardState.applyingPreset=true;
  const loaded=await loadJiraMetadataForProject(sameProject?preset:null);
  if(loaded){byId('jira-condition-list').replaceChildren();addJiraCondition();}
  jiraBoardState.applyingPreset=false;markJiraDirty();
}

function jiraPresetPayload(name, revision = 0) {
  const form = byId('jira-board-form');
  return {
    projectKey: jiraProjectKey(),
    name,
    severityFieldId: form.elements.severityFieldId.value,
    variantFieldId: form.elements.variantFieldId.value,
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

function validateJiraEditor(){
  const form=byId('jira-board-form');
  if(!jiraBoardState.metadata||jiraBoardState.metadataProjectKey!==jiraProjectKey()){toast('请先从项目列表选择项目并完成字段加载。','error');return false;}
  if(!jiraBoardState.metadata.standard){toast('当前项目尚未配置启用的JIRA时效标准。','error');return false;}
  if(!form.elements.severityFieldId.value){byId('jira-severity-error').textContent='请选择严重等级字段';toast('请选择严重等级字段。','error');return false;}
  if(!form.elements.variantFieldId.value){byId('jira-variant-error').textContent='请选择ECU Variant字段';toast('请选择ECU Variant字段。','error');return false;}
  for(const row of document.querySelectorAll('.jira-condition-row')){const field=row.querySelector('[data-jira-field]').value,operator=row.querySelector('[data-jira-operator]').value,value=row.querySelector('[data-jira-value]').value.trim();if(!field&&value){toast('存在尚未选择字段的查询条件。','error');return false;}if(field&&!operator.startsWith('IS ')&&!value){toast('请填写已选择查询字段的条件值。','error');return false;}}
  return true;
}

function saveJiraPreset(forceNew=false) {
  if(!validateJiraEditor())return;
  const existing=forceNew?null:jiraBoardState.presets.find(x=>x.id===jiraBoardState.editingPresetId);
  requestJiraPresetName(existing?'更新查询方案':'保存查询方案',existing?.name||'',existing?'保存更新':'保存为新方案',async name=>{
    let id;
    if(existing){await api(`/internal/jira-board/presets/${existing.id}`,{method:'PUT',body:JSON.stringify(jiraPresetPayload(name,existing.revision))});id=existing.id;}
    else{id=(await api('/internal/jira-board/presets',{method:'POST',body:JSON.stringify(jiraPresetPayload(name))})).id;}
    jiraBoardState.presets=(await api('/internal/jira-board/presets')).items||[];
    jiraBoardState.selectedPresetIds.add(id);jiraBoardState.dirty=false;await switchJiraPresetEditor(id,true);updateJiraSelectionSummary();toast(existing?'查询方案已更新。':'查询方案已保存并加入本次分析。');
  });
}

async function deleteJiraPreset() {
  const preset = jiraBoardState.presets.find(x => x.id === jiraBoardState.editingPresetId);
  if (!preset) return;
  const result = await confirmAction('删除查询方案', `确认删除查询方案“${preset.name}”吗？`, { submitText:'确认删除', danger:true });
  if (!result.confirmed) return;
  await api(`/internal/jira-board/presets/${preset.id}`, { method:'DELETE' });
  jiraBoardState.selectedPresetIds.delete(preset.id);jiraBoardState.presets=(await api('/internal/jira-board/presets')).items||[];
  await switchJiraPresetEditor(null,true);renderJiraPresetList();updateJiraSelectionSummary();toast('查询方案已删除。');
}

async function runJiraAnalysis() {
  const form = byId('jira-board-form');
  const cutoffDate=form.elements.cutoffDate.value;
  if(!cutoffDate){toast('请选择统计截止日期。','error');return;}
  if(cutoffDate>jiraToday()){toast('统计截止日期不能晚于今天。','error');return;}
  const selected=jiraBoardState.presets.filter(x=>jiraBoardState.selectedPresetIds.has(x.id));
  if(!selected.length){toast('请至少勾选一个查询方案。','error');return;}
  const incomplete=selected.filter(x=>!x.projectKey||!x.severityFieldId||!x.variantFieldId);
  if(incomplete.length){
    const details=incomplete.map(item=>{const missing=[];if(!item.projectKey)missing.push('项目编号');if(!item.severityFieldId)missing.push('严重等级字段');if(!item.variantFieldId)missing.push('ECU Variant字段');return `“${item.name}”缺少${missing.join('、')}`;});
    toast(`${details.join('；')}，请先编辑并保存。`,'error');return;
  }
  const button = byId('jira-run-analysis');
  button.disabled = true;
  button.textContent = '读取并计算中…';
  byId('jira-board-results').innerHTML = '<section class="jira-loading"><div class="jira-spinner"></div><strong>正在读取 Jira 问题历史</strong><span>问题较多时需要一些时间，请保持页面打开。</span></section>';
  try {
    const analyses=await runJiraPresetAnalyses(selected,cutoffDate,button);
    jiraBoardState.analysis = mergeJiraAnalyses(analyses,cutoffDate);
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

async function runJiraPresetAnalyses(presets,cutoffDate,button){
  const results=new Array(presets.length);let next=0,completed=0;
  const worker=async()=>{while(next<presets.length){const index=next++,preset=presets[index];const data=await api('/internal/jira-board/analyze',{method:'POST',body:JSON.stringify({projectKey:preset.projectKey,cutoffDate,severityFieldId:preset.severityFieldId,variantFieldId:preset.variantFieldId,additionalJql:buildJiraPresetConditions(preset)||null})});results[index]={data,preset};completed+=1;button.textContent=`读取中 ${completed}/${presets.length}`;}};
  await Promise.all(Array.from({length:Math.min(3,presets.length)},worker));return results;
}

function buildJiraPresetConditions(preset){
  const clauses=(preset.conditions||[]).map(condition=>{const clause=condition.fieldId.startsWith('customfield_')?`cf[${condition.fieldId.slice(12)}]`:condition.fieldId;const field=/^(?:[A-Za-z][A-Za-z0-9_.-]*|cf\[\d+\])$/.test(clause)?clause:jiraJqlQuote(condition.fieldName||clause);if(condition.operator.startsWith('IS '))return `${field} ${condition.operator}`;const formatted=condition.operator.includes('IN')?`(${String(condition.value).split(',').map(x=>x.trim()).filter(Boolean).map(jiraJqlQuote).join(', ')})`:jiraJqlQuote(condition.value);return `${field} ${condition.operator} ${formatted}`;});if(preset.additionalJql)clauses.push(`(${preset.additionalJql})`);return clauses.join(' AND ');
}

function jiraAverage(values){const valid=values.filter(value=>Number.isFinite(Number(value))).map(Number);return valid.length?Math.round(valid.reduce((a,b)=>a+b,0)/valid.length*10)/10:null;}
function jiraPercentValue(part,total){return total?Math.round(part*1000/total)/10:null;}

function mergeJiraAnalyses(entries,cutoffDate){
  const unique=new Map();
  entries.forEach(({data,preset})=>(data.issues||[]).forEach(issue=>{const key=`${data.project}|${issue.key}`;if(unique.has(key)){const existing=unique.get(key);if(!existing.sourceSchemes.includes(preset.name))existing.sourceSchemes.push(preset.name);}else unique.set(key,{...issue,projectKey:data.project,projectName:data.standard?.projectName||data.project,sourceSchemes:[preset.name]});}));
  const issues=[...unique.values()],stages=[['new','新增'],['confirm','问题确认'],['analysis','原因分析'],['action','措施确认'],['verify','测试验证'],['closed','问题关闭']];
  const closed=issues.filter(x=>x.stageCode==='closed'),active=issues.filter(x=>x.stageCode!=='closed');
  const funnel=stages.map(([code,name],order)=>{const count=issues.filter(x=>x.maxReachedStageOrder>=order).length,previous=order?issues.filter(x=>x.maxReachedStageOrder>=order-1).length:issues.length;return{code,name,order,count,share:jiraPercentValue(count,issues.length),previousConversion:jiraPercentValue(count,previous),dropFromPrevious:order?Math.max(0,previous-count):0};});
  const overdue=stages.slice(0,-1).map(([code,name])=>{const values=issues.filter(x=>x.stageCode===code);return{code,name,count:values.filter(x=>x.stageOverdueDays>0).length,maxOverdueDays:Math.max(0,...values.map(x=>x.stageOverdueDays||0))};});
  overdue.push({code:'closure',name:'关闭总周期',count:active.filter(x=>x.closureOverdueDays>0).length,maxOverdueDays:Math.max(0,...active.map(x=>x.closureOverdueDays||0))});
  const severityGroups=jiraGroupBy(issues,x=>`${x.severityKey}|${x.severityLabel}`);
  const closureRates=[...severityGroups.values()].map(group=>({severity:group[0].severityLabel,severityKey:group[0].severityKey,total:group.length,closed:group.filter(x=>x.stageCode==='closed').length,rate:jiraPercentValue(group.filter(x=>x.stageCode==='closed').length,group.length)})).sort((a,b)=>jiraSeverityOrder(a.severityKey)-jiraSeverityOrder(b.severityKey)||a.severity.localeCompare(b.severity));
  const stageAverages=stages.slice(0,-1).map(([code,name])=>{const samples=issues.flatMap(x=>x.completedStageDays&&Number.isFinite(Number(x.completedStageDays[code]))?[Number(x.completedStageDays[code])]:[]);return{code,name,sampleCount:samples.length,averageDays:jiraAverage(samples)};});
  const severityAverages=[...jiraGroupBy(closed,x=>`${x.severityKey}|${x.severityLabel}`).values()].map(group=>({severity:group[0].severityLabel,severityKey:group[0].severityKey,sampleCount:group.length,averageDays:jiraAverage(group.map(x=>x.closureElapsedDays))})).sort((a,b)=>(b.averageDays??-1)-(a.averageDays??-1)||jiraSeverityOrder(a.severityKey)-jiraSeverityOrder(b.severityKey));
  const unmatchedStatuses=jiraCounts(issues.filter(x=>x.stageCode==='other'),x=>x.status,'status');
  const unmatchedSeverities=jiraCounts(issues.filter(x=>x.severityKey==='UNKNOWN'),x=>x.severityLabel,'severity');
  const generatedAt=entries.map(x=>new Date(x.data.generatedAt)).filter(x=>!Number.isNaN(x.valueOf())).sort((a,b)=>b-a)[0]?.toISOString()||new Date().toISOString();
  return{generatedAt,cutoffDate,project:[...new Set(entries.map(x=>x.data.project))].join('、'),projects:[...new Set(entries.map(x=>x.data.project))],presetNames:entries.map(x=>x.preset.name),standards:entries.map(x=>({project:x.data.project,...x.data.standard})),queries:entries.map(x=>({project:x.data.project,preset:x.preset.name,jql:x.data.query})),truncated:entries.some(x=>x.data.truncated),sourceTotal:entries.reduce((sum,x)=>sum+(x.data.sourceTotal||0),0),historyTruncated:issues.filter(x=>x.historyTruncated).length,summary:{total:issues.length,active:active.length,closed:closed.length,closureRate:jiraPercentValue(closed.length,issues.length),averageClosureDays:jiraAverage(closed.map(x=>x.closureElapsedDays)),stageOverdue:active.filter(x=>x.stageOverdueDays>0).length,closureOverdue:active.filter(x=>x.closureOverdueDays>0).length},funnel,overdue,closureRates,stageAverages,severityAverages,unmatchedStatuses,unmatchedSeverities,issues};
}

function jiraGroupBy(items,keySelector){const groups=new Map();items.forEach(item=>{const key=keySelector(item);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);});return groups;}
function jiraCounts(items,keySelector,label){return[...jiraGroupBy(items,keySelector).entries()].map(([key,values])=>({[label]:key,count:values.length})).sort((a,b)=>b.count-a.count);}
function jiraSeverityOrder(key){return({S:0,A:1,B:2,C:3,UNKNOWN:9})[key]??9;}

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
  const points=(field,label,color)=>jiraBoardState.trendVisible[field]?buckets.map((bucket,index)=>`<g class="jira-trend-point" data-jira-trend-index="${index}" data-jira-trend-kind="${field}" tabindex="0" role="button" aria-label="${esc(bucket.start)}至${esc(bucket.end)} ${label}${bucket[field]}项"><line class="guide" x1="${x(index)}" y1="${top}" x2="${x(index)}" y2="${top+plotHeight}"></line><circle class="hit" cx="${x(index)}" cy="${y(bucket[field])}" r="11"></circle><circle cx="${x(index)}" cy="${y(bucket[field])}" r="3" fill="${color}"></circle></g>`).join(''):'';
  return `<div class="jira-trend-legend"><button type="button" data-jira-trend-toggle="created" class="${jiraBoardState.trendVisible.created?'active':''}"><i class="created"></i>新增问题</button><button type="button" data-jira-trend-toggle="closed" class="${jiraBoardState.trendVisible.closed?'active':''}"><i class="closed"></i>关闭问题</button><small>悬停查看数值，点击数据点查看明细</small></div><div class="jira-trend-scroll"><div class="jira-chart-tooltip" id="jira-trend-tooltip" hidden></div><svg class="jira-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="问题新增与关闭趋势"><g class="grid">${grid}${labels}</g>${jiraBoardState.trendVisible.created?`<path class="created" d="${path('created')}"></path>`:''}${jiraBoardState.trendVisible.closed?`<path class="closed" d="${path('closed')}"></path>`:''}${points('created','新增问题','#3b5ccc')}${points('closed','关闭问题','#169b74')}</svg></div>`;
}

function jiraFunnelChart(items) {
  const rowHeight = 86, center = 500;
  const max=Math.max(1,...items.map(item=>item.count));
  const widths=items.map(item=>item.count?Math.max(8,item.count/max*920):0);
  const points = items.map((item,index) => {
    const top=widths[index],bottom=widths[index+1]??top,y=index*rowHeight;
    return `<g class="jira-funnel-layer" data-jira-stage="${esc(item.code)}" tabindex="0" role="button" aria-label="${esc(item.name)}累计到达${item.count}项，到达率${jiraPercent(item.share)}，环节转化率${jiraPercent(item.previousConversion)}"><rect class="hit" x="20" y="${y}" width="960" height="${rowHeight}" fill="transparent"></rect>${item.count?`<polygon points="${center-top/2},${y+2} ${center+top/2},${y+2} ${center+bottom/2},${y+rowHeight-3} ${center-bottom/2},${y+rowHeight-3}" fill="${jiraStageColors[item.code]}"></polygon>`:`<line class="zero" x1="${center-20}" y1="${y+rowHeight/2}" x2="${center+20}" y2="${y+rowHeight/2}"></line>`}<g class="label"><rect x="${center-132}" y="${y+12}" width="264" height="58" rx="9"></rect><text x="${center}" y="${y+31}" text-anchor="middle">${esc(item.name)} · ${jiraNumber(item.count)}项</text><text class="sub" x="${center}" y="${y+49}" text-anchor="middle">到达率 ${jiraPercent(item.share)} · 环节转化 ${jiraPercent(item.previousConversion)}</text><text class="sub loss" x="${center}" y="${y+65}" text-anchor="middle">${index?'较上一阶段流失 '+jiraNumber(item.dropFromPrevious)+' 项':'全部问题基准'}</text></g></g>`;
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
  return `<div class="jira-chart-list">${items.map(item=>`<button type="button" data-jira-rate-severity="${esc(item.severity)}" title="点击查看明细"><span class="jira-severity ${esc(item.severityKey.toLowerCase())}">${esc(item.severity)}</span><i><b style="width:${item.rate||0}%"></b></i><strong>${jiraPercent(item.rate)}</strong><small>${item.closed}/${item.total}</small></button>`).join('')}</div>`;
}

function jiraDurationChart(items, valueField, labelField, colorField = null) {
  const max=Math.max(1,...items.map(x=>x[valueField]||0));
  return `<div class="jira-chart-list duration">${items.map((item,index)=>`<button type="button" data-jira-duration="${esc(colorField?item[colorField]:item.severity)}" data-jira-duration-type="${colorField?'stage':'severity'}" title="点击查看明细"><em>${index+1}</em><span>${esc(item[labelField])}</span><i><b style="width:${(item[valueField]||0)/max*100}%;${colorField?`--bar:${jiraStageColors[item[colorField]]}`:''}"></b></i><strong>${jiraDays(item[valueField])}</strong><small>${item.sampleCount}项</small></button>`).join('')}</div>`;
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
  const visible=jiraBoardState.assigneeExpanded?values:values.slice(0,10);
  return values.length?`<div class="jira-assignee-backlog">${visible.map(item=>`<button type="button" data-jira-variant-assignee="${esc(item[0])}" class="${item[0]==='未分配'?'unassigned':''}" title="点击查看明细"><span title="${esc(item[0])}">${esc(item[0])}</span><i><b style="width:${item[1]/max*100}%"></b></i><strong>${item[1]}</strong></button>`).join('')}</div>${values.length>10?`<button type="button" class="jira-show-all" id="jira-assignee-expand">${jiraBoardState.assigneeExpanded?'收起':'展开全部 '+values.length+' 人'}</button>`:''}`:jiraNoData(`${mode==='LIDAR'?'LiDAR':'ADS'}暂无未关闭问题`);
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
  byId('jira-assignee-expand')?.addEventListener('click',()=>{jiraBoardState.assigneeExpanded=!jiraBoardState.assigneeExpanded;renderJiraVariantAssignees(data);});
}

function jiraFollowUpChart(items, failedCount) {
  const order={S:0,A:1,B:2,C:3,UNKNOWN:9};
  const severity=[...new Map(items.map(issue=>[issue.severityLabel,{label:issue.severityLabel,key:issue.severityKey,count:0}])).values()];
  severity.forEach(group=>group.count=items.filter(issue=>issue.severityLabel===group.label).length);
  severity.sort((a,b)=>(order[a.key]??9)-(order[b.key]??9)||b.count-a.count);
  const max=Math.max(1,...severity.map(item=>item.count));
  return `<div class="jira-followup-chart"><button type="button" class="jira-followup-total" data-jira-followup="all" title="点击查看明细"><span>当日未跟进</span><strong>${jiraNumber(items.length)}</strong><small>未关闭且截止日没有新增评论</small></button><div class="jira-followup-severity">${severity.length?severity.map(item=>`<button type="button" data-jira-followup="${esc(item.label)}" title="点击查看明细"><span class="jira-severity ${esc(item.key.toLowerCase())}">${esc(item.label)}</span><i><b style="width:${item.count/max*100}%"></b></i><strong>${item.count}</strong></button>`).join(''):jiraNoData('所有未关闭问题当日均有跟进')}</div></div>${failedCount?`<p class="jira-chart-warning">另有 ${failedCount} 项最新评论读取失败，未纳入统计。<button type="button" id="jira-comment-retry">重试失败项</button></p>`:''}`;
}

async function loadJiraFollowUpAnalysis(data) {
  const host=byId('jira-followup-host');if(!host)return;
  setJiraPdfReady(false);
  const active=data.issues.filter(issue=>issue.stageCode!=='closed');
  if(!active.length){host.innerHTML=jiraFollowUpChart([],0);setJiraPdfReady(true);return;}
  host.innerHTML='<div class="jira-chart-loading"><div class="jira-spinner"></div><strong>正在核对当日评论</strong><span>0 / '+jiraNumber(active.length)+'</span></div>';
  await loadJiraComments(active,(completed,total)=>{
    if(jiraBoardState.analysis!==data)return;
    const progress=host.querySelector('span');if(progress)progress.textContent=`${jiraNumber(completed)} / ${jiraNumber(total)}`;
  });
  if(jiraBoardState.analysis!==data||byId('jira-followup-host')!==host)return;
  const failed=active.filter(issue=>jiraBoardState.commentCache.get(jiraCommentKey(issue))?.error);
  const items=active.filter(issue=>{const comment=jiraBoardState.commentCache.get(jiraCommentKey(issue));return comment&&!comment.error&&jiraDateKey(comment.created)!==data.cutoffDate;});
  host.innerHTML=jiraFollowUpChart(items,failed.length);
  host.querySelectorAll('[data-jira-followup]').forEach(button=>button.onclick=()=>{
    const value=button.dataset.jiraFollowup;
    const detail=value==='all'?items:items.filter(issue=>issue.severityLabel===value);
    openJiraDetails(`当日未跟进${value==='all'?'':` · ${value}`} · ${detail.length}项`,detail,'stage',{compact:true});
  });
  byId('jira-comment-retry')?.addEventListener('click',()=>{failed.forEach(issue=>jiraBoardState.commentCache.delete(jiraCommentKey(issue)));loadJiraFollowUpAnalysis(data);});
  setJiraPdfReady(true);
}

function setJiraPdfReady(ready) {
  jiraBoardState.pdfReady=ready;
  const button=byId('jira-export-pdf');
  if(!button)return;
  button.disabled=!ready;
  button.textContent=ready?'导出PDF':'准备PDF数据…';
}

function jiraPdfFileName(data) {
  const project=String(data.project||'JIRA').replace(/[\\/:*?\"<>|]+/g,'-').replace(/\s+/g,'_');
  return `JIRA问题分析_${project}_截至_${data.cutoffDate||jiraToday()}`;
}

function jiraPdfStyles() {
  return `
    :root { color-scheme: light; }
    html, body { width: 1400px !important; min-width: 1400px !important; margin: 0 !important; overflow: visible !important; background: #f4f6f9 !important; }
    body { padding: 0 !important; color: #172033; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .jira-pdf-page { box-sizing: border-box; width: 1400px; padding: 32px; overflow: visible !important; }
    #jira-board-results, #jira-board-results * { box-sizing: border-box; }
    #jira-board-results { width: 100%; overflow: visible !important; }
    .jira-result-head { position: static !important; }
    .jira-result-actions, .jira-result-jql, .jira-segmented, .jira-show-all, .jira-chart-tooltip { display: none !important; }
    .jira-chart-warning button { display: none !important; }
    .jira-metrics { grid-template-columns: repeat(6, minmax(0, 1fr)) !important; }
    .jira-diagnosis-grid { grid-template-columns: minmax(0, 1.15fr) minmax(350px, .85fr) !important; }
    .jira-risk-stack { grid-template-columns: minmax(0, 1fr) !important; }
    .jira-two-column { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .jira-variant-body { grid-template-columns: minmax(310px, .8fr) minmax(320px, 1.2fr) !important; }
    .jira-variant-summary { border-right: 1px solid #edf0f4 !important; border-bottom: 0 !important; padding-bottom: 0 !important; }
    .jira-trend-scroll, .jira-panel, .jira-variant-body { max-width: none !important; overflow: visible !important; }
    button, [role=\"button\"] { pointer-events: none !important; }
    * { animation: none !important; transition: none !important; }
  `;
}

async function exportJiraBoardPdf() {
  const data=jiraBoardState.analysis;
  const source=byId('jira-board-results');
  if(!data||!source){toast('请先生成JIRA看板。','error');return;}
  if(!jiraBoardState.pdfReady){toast('正在准备当日跟进数据，请稍候再导出。','error');return;}

  const printWindow=window.open('','_blank');
  if(!printWindow){toast('浏览器阻止了打印窗口，请允许本站打开弹窗后重试。','error');return;}

  try {
    const printDocument=printWindow.document;
    printDocument.open();
    printDocument.write('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>');
    printDocument.close();
    printDocument.title=jiraPdfFileName(data);

    const stylesheetLoads=[];
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(sourceStyle=>{
      const copy=sourceStyle.cloneNode(true);
      if(copy.tagName==='LINK'){
        copy.href=sourceStyle.href;
        stylesheetLoads.push(new Promise(resolve=>{copy.onload=resolve;copy.onerror=resolve;}));
      }
      printDocument.head.appendChild(copy);
    });
    const exportStyle=printDocument.createElement('style');
    exportStyle.textContent=jiraPdfStyles();
    printDocument.head.appendChild(exportStyle);

    const page=printDocument.createElement('main');
    page.className='jira-pdf-page';
    const results=source.cloneNode(true);
    page.appendChild(results);
    printDocument.body.appendChild(page);

    await Promise.all(stylesheetLoads);
    if(printDocument.fonts?.ready)await printDocument.fonts.ready;
    await new Promise(resolve=>printWindow.requestAnimationFrame(()=>printWindow.requestAnimationFrame(resolve)));

    const pageHeight=Math.ceil(Math.max(page.scrollHeight,page.getBoundingClientRect().height))+2;
    const maximumSinglePageHeight=18000;
    if(pageHeight>maximumSinglePageHeight){
      printWindow.close();
      toast('看板内容超过单页PDF的安全高度，请缩小查询范围后重试。','error');
      return;
    }
    const pageStyle=printDocument.createElement('style');
    pageStyle.textContent=`@page { size: 1400px ${pageHeight}px; margin: 0; } @media print { html, body { width: 1400px !important; height: ${pageHeight}px !important; } }`;
    printDocument.head.appendChild(pageStyle);
    printWindow.addEventListener('afterprint',()=>printWindow.close(),{once:true});
    printWindow.focus();
    printWindow.print();
  } catch(error) {
    printWindow.close();
    console.error('Failed to prepare Jira PDF export.',error);
    toast('PDF打印内容准备失败，请刷新页面后重试。','error');
  }
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
  host.querySelectorAll('[data-jira-trend-toggle]').forEach(button=>button.onclick=()=>{const kind=button.dataset.jiraTrendToggle;jiraBoardState.trendVisible[kind]=!jiraBoardState.trendVisible[kind];if(!jiraBoardState.trendVisible.created&&!jiraBoardState.trendVisible.closed)jiraBoardState.trendVisible[kind]=true;renderJiraTrend(data);});
  const tooltip=byId('jira-trend-tooltip');
  host.querySelectorAll('[data-jira-trend-index]').forEach(point=>{const show=event=>{const bucket=jiraBoardState.trendBuckets[Number(point.dataset.jiraTrendIndex)];tooltip.innerHTML=`<strong>${esc(bucket.start)}${bucket.end===bucket.start?'':` ~ ${esc(bucket.end)}`}</strong><span>新增 ${bucket.created} · 关闭 ${bucket.closed} · 净增 ${bucket.created-bucket.closed}</span>`;tooltip.hidden=false;const rect=host.querySelector('.jira-trend-scroll').getBoundingClientRect();tooltip.style.left=`${Math.min(rect.width-210,Math.max(10,event.clientX-rect.left+12))}px`;tooltip.style.top=`${Math.max(8,event.clientY-rect.top-58)}px`;};point.onmouseenter=show;point.onmousemove=show;point.onmouseleave=()=>{tooltip.hidden=true;};});
  bindJiraKeyboardClicks(host);
}

function renderJiraResults(data) {
  jiraBoardState.pdfReady=false;
  const warnings = [];
  if (data.truncated) warnings.push(`Jira共返回 ${jiraNumber(data.sourceTotal)} 条，当前看板为保护服务器仅分析前 5,000 条，请缩小查询条件。`);
  if (data.historyTruncated) warnings.push(`有 ${jiraNumber(data.historyTruncated)} 条问题的 Jira 变更历史超过接口单次展开上限，其历史阶段到达及阶段时长可能不完整，建议缩小查询范围后复核。`);
  if (data.unmatchedStatuses.length) warnings.push(`有 ${data.unmatchedStatuses.reduce((sum, x) => sum + x.count, 0)} 条问题状态未匹配处理阶段：${data.unmatchedStatuses.map(x => `${x.status}(${x.count})`).join('、')}。`);
  if (data.unmatchedSeverities.length) warnings.push(`有 ${data.unmatchedSeverities.reduce((sum, x) => sum + x.count, 0)} 条问题的严重等级无法映射为 S/A/B/C，因此不参与超时判定：${data.unmatchedSeverities.map(x => `${x.severity}(${x.count})`).join('、')}。`);
  const results = byId('jira-board-results');
  const queryText=data.queries.map(x=>`【${x.preset} / ${x.project}】\n${x.jql}`).join('\n\n');
  const overdueItems=jiraBoardState.overdueSort==='count'?[...data.overdue].sort((a,b)=>b.count-a.count):data.overdue;
  results.innerHTML = `
    <section class="jira-result-head jira-result-context"><div><h3>${esc(data.project)} · 截至 ${esc(data.cutoffDate)}</h3><p>${data.presetNames.length} 个查询方案 · ${data.projects.length} 个项目 · 数据生成于 ${esc(fmtDate(data.generatedAt))}</p><details class="jira-result-jql"><summary>查看查询口径</summary><pre>${esc(queryText)}</pre></details></div><div class="jira-result-actions"><button type="button" class="btn btn-light btn-sm" id="jira-edit-query">修改查询范围</button><button type="button" class="btn btn-light btn-sm" id="jira-copy-jql">复制JQL</button><button type="button" class="btn btn-light btn-sm" id="jira-export-pdf" disabled>准备PDF数据…</button><button type="button" class="btn btn-primary btn-sm" id="jira-rerun">重新分析</button></div></section>
    ${warnings.map(text => `<div class="jira-warning">${esc(text)}</div>`).join('')}
    <section class="jira-metrics">
      ${jiraMetric('统计问题', data.summary.total, '查询范围内全部问题', 'all')}
      ${jiraMetric('待关闭问题', data.summary.active, '截止日仍未进入关闭阶段', 'active', 'primary')}
      ${jiraMetric('整体关闭率', jiraPercent(data.summary.closureRate), `${jiraNumber(data.summary.closed)} 项已关闭`, 'closed', 'success')}
      ${jiraMetric('平均关闭周期', jiraDays(data.summary.averageClosureDays), '仅统计已关闭问题', 'closed-duration', 'violet')}
      ${jiraMetric('阶段超时', data.summary.stageOverdue, '当前阶段超过时效', 'stage-overdue', 'danger')}
      ${jiraMetric('关闭周期超时', data.summary.closureOverdue, '当前未关闭且超过总周期', 'closure-overdue', 'orange')}
    </section>
    <div class="jira-diagnosis-grid">
      <section class="jira-panel jira-funnel-panel"><div class="jira-panel-head"><div><h3>问题处理阶段漏斗</h3><p>按截止日前曾经到达的最深阶段累计统计；点击阶段查看明细。</p></div><small>累计到达</small></div><div class="jira-funnel-chart">${jiraFunnelChart(data.funnel)}</div></section>
      <div class="jira-risk-stack">
        <section class="jira-panel jira-followup-panel"><div class="jira-panel-head"><div><h3>当日未跟进问题</h3><p>未关闭且截止日没有新增评论。</p></div><small>评论口径</small></div><div id="jira-followup-host"></div></section>
        <section class="jira-panel jira-overdue-panel"><div class="jira-panel-head"><div><h3>处理超时报表</h3><p>阶段停留与关闭总周期风险。</p></div><div class="jira-segmented"><button type="button" data-jira-overdue-sort="process" class="${jiraBoardState.overdueSort==='process'?'active':''}">流程</button><button type="button" data-jira-overdue-sort="count" class="${jiraBoardState.overdueSort==='count'?'active':''}">数量</button></div></div><div id="jira-overdue-chart">${jiraOverdueChart(overdueItems)}</div></section>
      </div>
    </div>
    <section class="jira-panel jira-trend-panel"><div class="jira-panel-head"><div><h3>问题新增与关闭趋势</h3><p>对比问题流入和关闭节奏，点击数据点查看对应问题。</p></div><div class="jira-segmented">${[['30','30天'],['90','90天'],['180','180天'],['all','全部']].map(item=>`<button type="button" data-jira-trend-range="${item[0]}" class="${jiraBoardState.trendRange===item[0]?'active':''}">${item[1]}</button>`).join('')}</div></div><div id="jira-trend-chart"></div></section>
    <section class="jira-panel jira-variant-panel"><div class="jira-panel-head"><div><h3>未关闭问题 ECU Variant 分布</h3><p>查看ADS、LiDAR占比及对应处理人堆积。</p></div><div class="jira-segmented"><button type="button" data-jira-variant-mode="ADS" class="active">ADS</button><button type="button" data-jira-variant-mode="LIDAR">LiDAR</button></div></div><div class="jira-variant-body"><div class="jira-variant-summary">${jiraVariantPie(data)}</div><div><div class="jira-subhead"><strong>当前处理人问题堆积</strong><span>默认展示前10名</span></div><div id="jira-variant-assignee-chart"></div></div></div></section>
    <div class="jira-section-label"><strong>效率复盘</strong><span>关闭结果与处理周期</span></div>
    <div class="jira-two-column">
      <section class="jira-panel">
        <div class="jira-panel-head"><div><h3>问题关闭率</h3><p>整体关闭率及各严重等级关闭情况。</p></div></div>
        <div class="jira-closure-chart">${jiraDonut(data.summary.closureRate,'整体关闭率')}${data.closureRates.length?jiraRateChart(data.closureRates):jiraNoData('暂无严重等级数据')}</div>
      </section>
      <section class="jira-panel">
        <div class="jira-panel-head"><div><h3>严重等级平均关闭周期</h3><p>按周期从长到短排序，仅统计已关闭问题。</p></div></div>
        ${data.severityAverages.length?jiraDurationChart(data.severityAverages,'averageDays','severity'):jiraNoData('暂无已关闭问题')}
      </section>
    </div>
    <section class="jira-panel">
      <div class="jira-panel-head"><div><h3>各阶段平均处理周期</h3><p>统计已经离开该阶段的问题；同一问题多次进入时累计计算。</p></div></div>
      ${jiraDurationChart(data.stageAverages,'averageDays','name','code')}
    </section>`;

  renderJiraTrend(data);
  renderJiraVariantAssignees(data);
  loadJiraFollowUpAnalysis(data);

  byId('jira-copy-jql').onclick = async () => {
    try { await navigator.clipboard.writeText(queryText); toast('JQL已复制。'); }
    catch { toast('浏览器未允许复制，请从查询口径中手动复制JQL。', 'error'); }
  };
  byId('jira-rerun').onclick=runJiraAnalysis;
  byId('jira-export-pdf').onclick=exportJiraBoardPdf;
  byId('jira-edit-query').onclick=()=>document.querySelector('.jira-config-card').scrollIntoView({behavior:'smooth',block:'start'});
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
  results.querySelectorAll('[data-jira-overdue-sort]').forEach(button=>button.onclick=()=>{jiraBoardState.overdueSort=button.dataset.jiraOverdueSort;renderJiraResults(data);});
  results.querySelectorAll('[data-jira-kind]').forEach(button => button.onclick = () => {
    const kind = button.dataset.jiraKind;
    if (kind === 'all') openJiraDetails('全部问题', data.issues, 'stage');
    if (kind === 'active') openJiraDetails('待关闭问题', data.issues.filter(x => x.stageCode !== 'closed'), 'stage');
    if (kind === 'closed' || kind === 'closed-duration') openJiraDetails('已关闭问题', data.issues.filter(x => x.stageCode === 'closed'), 'closure');
    if (kind === 'stage-overdue') openJiraDetails('阶段超时问题', data.issues.filter(x => x.stageCode !== 'closed' && x.stageOverdueDays > 0).sort((a,b) => b.stageOverdueDays-a.stageOverdueDays), 'stage');
    if (kind === 'closure-overdue') openJiraDetails('关闭周期超时问题', data.issues.filter(x => x.stageCode !== 'closed' && x.closureOverdueDays > 0).sort((a,b) => b.closureOverdueDays-a.closureOverdueDays), 'closure');
  });
  results.querySelectorAll('[data-jira-rate-severity]').forEach(button=>button.onclick=()=>{const severity=button.dataset.jiraRateSeverity;openJiraDetails(`${severity}级问题关闭情况`,data.issues.filter(x=>x.severityLabel===severity),'closure');});
  results.querySelectorAll('[data-jira-duration]').forEach(button=>button.onclick=()=>{const value=button.dataset.jiraDuration;if(button.dataset.jiraDurationType==='severity')openJiraDetails(`${value}级已关闭问题`,data.issues.filter(x=>x.stageCode==='closed'&&x.severityLabel===value),'closure');else openJiraDetails(`${data.funnel.find(x=>x.code===value)?.name||value}已完成阶段样本`,data.issues.filter(x=>x.completedStageDays&&x.completedStageDays[value]!==undefined),'stage');});
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
  let page = 1,currentItems=[...items];
  const pageSize = 50;
  const trigger=document.activeElement;
  const severityOptions=[...new Set(items.map(x=>x.severityLabel))].sort((a,b)=>jiraSeverityOrder(items.find(x=>x.severityLabel===a)?.severityKey)-jiraSeverityOrder(items.find(x=>x.severityLabel===b)?.severityKey));
  const statusOptions=[...new Set(items.map(x=>x.status))].sort();
  const assigneeOptions=[...new Set(items.map(x=>x.assignee))].sort();
  modalRoot.innerHTML = `<div class="modal-backdrop jira-detail-backdrop"><div class="jira-detail-modal" role="dialog" aria-modal="true" aria-labelledby="jira-detail-title"><div class="jira-detail-head"><div><h3 id="jira-detail-title">${esc(title)}</h3><p>当前穿透范围共 ${jiraNumber(items.length)} 项，支持搜索、快速筛选和导出当前结果。</p></div><div class="jira-detail-actions"><button type="button" class="btn btn-light btn-sm jira-export-button" data-jira-export ${items.length?'':'disabled'}><span>↓</span>导出当前结果</button><button type="button" class="jira-detail-close" aria-label="关闭">×</button></div></div><div class="jira-detail-filters"><label class="jira-detail-search"><span>搜索</span><input id="jira-detail-search" placeholder="输入Jira编号或标题"></label><label><span>严重等级</span><select id="jira-detail-severity"><option value="">全部</option>${severityOptions.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label><label><span>当前状态</span><select id="jira-detail-status"><option value="">全部</option>${statusOptions.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label><label><span>当前处理人</span><select id="jira-detail-assignee"><option value="">全部</option>${assigneeOptions.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label></div><div id="jira-detail-body"></div></div></div>`;
  const onKeydown=event=>{if(event.key==='Escape')close();if(event.key==='Tab'){const focusable=[...modalRoot.querySelectorAll('button:not([disabled]),input,select,a[href]')];if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};
  const close = () => {document.removeEventListener('keydown',onKeydown);modalRoot.replaceChildren();trigger?.focus?.();};
  document.addEventListener('keydown',onKeydown);
  modalRoot.querySelector('.jira-detail-close').onclick = close;
  modalRoot.querySelector('[data-jira-export]').onclick = event => exportJiraDetails(title,currentItems,overdueMode,event.currentTarget,{compact});
  modalRoot.querySelector('.jira-detail-backdrop').onclick = event => { if (event.target.classList.contains('jira-detail-backdrop')) close(); };

  const renderPage = async () => {
    if (!modalRoot.querySelector('#jira-detail-body')) return;
    const keyword=byId('jira-detail-search').value.trim().toLowerCase(),severityValue=byId('jira-detail-severity').value,statusValue=byId('jira-detail-status').value,assigneeValue=byId('jira-detail-assignee').value;
    currentItems=items.filter(issue=>(!keyword||issue.key.toLowerCase().includes(keyword)||issue.summary.toLowerCase().includes(keyword))&&(!severityValue||issue.severityLabel===severityValue)&&(!statusValue||issue.status===statusValue)&&(!assigneeValue||issue.assignee===assigneeValue));
    const severity = jiraDistribution(currentItems, 'severityLabel', '未设置');
    const assignees = jiraDistribution(currentItems, 'assignee', '未分配');
    const totalPages = Math.max(1, Math.ceil(currentItems.length / pageSize));
    page = Math.min(Math.max(1, page), totalPages);
    const visible = currentItems.slice((page - 1) * pageSize, page * pageSize);
    modalRoot.querySelector('[data-jira-export]').disabled=!currentItems.length;
    byId('jira-detail-body').innerHTML = currentItems.length ? `
      <div class="jira-detail-breakdowns"><div><div><strong>严重等级分布</strong><small>按当前明细范围统计</small></div><section>${jiraPieChart(severity)}</section></div><div><div><strong>处理人分布</strong><small>按问题数量从高到低</small></div><section>${jiraAssigneeChart(assignees)}</section></div></div>
      <div class="jira-detail-table-wrap"><table><thead>${compact?'<tr><th>所属项目</th><th>来源方案</th><th>Jira编号</th><th>标题</th><th>严重等级</th><th>当前处理人</th><th>当前状态</th><th>所属阶段</th></tr>':'<tr><th>项目 / 来源</th><th>严重等级</th><th>Jira编号 / 标题</th><th>当前处理人</th><th>当前状态</th><th>最新结论</th><th>是否超时</th></tr>'}</thead><tbody>${visible.map(issue => compact?jiraCompactIssueRow(issue):jiraIssueRow(issue, overdueMode)).join('')}</tbody></table></div>
      <div class="jira-detail-pagination"><span>筛选后 ${jiraNumber(currentItems.length)} 项 · 第 ${page}/${totalPages} 页</span><div><button type="button" class="btn btn-light btn-sm" data-page="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><button type="button" class="btn btn-light btn-sm" data-page="next" ${page >= totalPages ? 'disabled' : ''}>下一页</button></div></div>`
      : jiraNoData('该范围内暂无问题');
    byId('jira-detail-body').querySelector('[data-page="prev"]')?.addEventListener('click', () => { page -= 1; renderPage(); });
    byId('jira-detail-body').querySelector('[data-page="next"]')?.addEventListener('click', () => { page += 1; renderPage(); });
    if(!compact)await loadJiraComments(visible);
  };
  ['jira-detail-search','jira-detail-severity','jira-detail-status','jira-detail-assignee'].forEach(id=>byId(id).addEventListener(id==='jira-detail-search'?'input':'change',()=>{page=1;renderPage();}));
  renderPage();
  setTimeout(()=>byId('jira-detail-search')?.focus(),0);
}

function jiraCompactIssueRow(issue) {
  return `<tr><td><strong>${esc(issue.projectKey)}</strong></td><td>${esc(issue.sourceSchemes.join('、'))}</td><td><a href="${esc(issue.url)}" target="_blank" rel="noopener noreferrer">${esc(issue.key)}</a></td><td><strong>${esc(issue.summary)}</strong></td><td><span class="jira-severity ${esc(issue.severityKey.toLowerCase())}">${esc(issue.severityLabel)}</span></td><td>${esc(issue.assignee)}</td><td><span class="jira-status-dot" style="--stage:${jiraStageColors[issue.stageCode]||jiraStageColors.other}"></span>${esc(issue.status)}</td><td>${esc(issue.stageName)}</td></tr>`;
}

function jiraIssueRow(issue, overdueMode) {
  const overdue = overdueMode === 'closure' ? issue.closureOverdueDays : issue.stageOverdueDays;
  const limit = overdueMode === 'closure' ? issue.closureLimitDays : issue.stageLimitDays;
  const comment = jiraBoardState.commentCache.get(jiraCommentKey(issue));
  return `<tr class="${overdue > 0 ? 'is-overdue' : ''}">
    <td><strong>${esc(issue.projectKey)}</strong><small>${esc(issue.sourceSchemes.join('、'))}</small></td><td><span class="jira-severity ${esc(issue.severityKey.toLowerCase())}">${esc(issue.severityLabel)}</span></td>
    <td><a href="${esc(issue.url)}" target="_blank" rel="noopener noreferrer">${esc(issue.key)}</a><strong>${esc(issue.summary)}</strong><small>创建：${esc(fmtDateOnly(issue.createdAt))}</small></td>
    <td>${esc(issue.assignee)}</td><td><span class="jira-status-dot" style="--stage:${jiraStageColors[issue.stageCode] || jiraStageColors.other}"></span>${esc(issue.status)}</td>
    <td class="jira-comment" data-comment-key="${esc(jiraCommentKey(issue))}">${jiraCommentHtml(comment)}</td>
    <td>${overdue > 0 ? `<span class="jira-overdue-tag">超时 ${overdue} 天</span>` : `<span class="jira-ok-tag">${limit ? `时限 ${limit} 天` : '未配置时限'}</span>`}</td></tr>`;
}

function jiraCommentHtml(comment) {
  if (comment === undefined) return '<span class="jira-comment-loading">加载中…</span>';
  if (comment?.error) return `<span class="jira-comment-empty" title="${esc(comment.error)}">最新评论加载失败</span>`;
  if (!comment?.body) return '<span class="jira-comment-empty">暂无评论</span>';
  return `<p>${esc(comment.body)}</p><small>${esc(comment.author || '未知用户')} · ${esc(fmtDate(comment.created))}</small>`;
}

function jiraCommentKey(issue){return `${issue.projectKey}|${issue.key}`;}

async function loadJiraComments(issues,onProgress=null,generation=jiraBoardState.commentGeneration) {
  const unique=[...new Map(issues.map(issue=>[jiraCommentKey(issue),issue])).values()],missing=unique.filter(issue => !jiraBoardState.commentCache.has(jiraCommentKey(issue)));
  let completed=unique.length-missing.length;onProgress?.(completed,unique.length);
  if (!missing.length) return;
  const groups=jiraGroupBy(missing,issue=>issue.projectKey);
  for(const [projectKey,projectIssues] of groups){
    for (let index=0;index<projectIssues.length;index+=100) {
      if(generation!==jiraBoardState.commentGeneration)return;
      const batch=projectIssues.slice(index,index+100);
      try {
        const response = await api('/internal/jira-board/comments', {
          method: 'POST',
          body: JSON.stringify({ projectKey, cutoffDate: jiraBoardState.analysis.cutoffDate, issueKeys: batch.map(x=>x.key) })
        });
        if(generation!==jiraBoardState.commentGeneration)return;
        response.items.forEach(item => jiraBoardState.commentCache.set(`${projectKey}|${item.key}`, item));
      } catch (error) {
        if(generation!==jiraBoardState.commentGeneration)return;
        batch.forEach(issue => jiraBoardState.commentCache.set(jiraCommentKey(issue), { body: null, error: error.message }));
      }
      completed+=batch.length;onProgress?.(completed,unique.length);
    }
  }
  missing.forEach(issue => {
    const key=jiraCommentKey(issue),cell = modalRoot.querySelector(`[data-comment-key="${CSS.escape(key)}"]`);
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
  if(!compact)await loadJiraComments(items);
  const headers=compact?['所属项目','来源方案','Jira编号','标题','严重等级','当前处理人','当前状态','所属阶段']:['所属项目','来源方案','Jira编号','标题','严重等级','当前处理人','当前状态','所属阶段','最新结论','评论人','评论时间','创建时间','关闭时间','阶段停留天数','阶段时限','阶段超时天数','关闭周期天数','关闭总周期时限','关闭超时天数'];
  const rows=items.map(issue=>{
    if(compact)return [issue.projectKey,issue.sourceSchemes.join('、'),issue.key,issue.summary,issue.severityLabel,issue.assignee,issue.status,issue.stageName];
    const comment=jiraBoardState.commentCache.get(jiraCommentKey(issue))||{};
    return [issue.projectKey,issue.sourceSchemes.join('、'),issue.key,issue.summary,issue.severityLabel,issue.assignee,issue.status,issue.stageName,comment.error?`最新评论加载失败：${comment.error}`:(comment.body||''),comment.author||'',comment.created||'',issue.createdAt,issue.closedAt||'',issue.stageElapsedDays,issue.stageLimitDays??'',issue.stageOverdueDays,issue.closureElapsedDays,issue.closureLimitDays??'',issue.closureOverdueDays];
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
