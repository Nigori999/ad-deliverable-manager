const jiraBoardState = {
  metadata: null, metadataProjectKey: '', projects: [], server: null, analysis: null,
  commentCache: new Map(), commentGeneration: 0, presets: [], editingPresetId: null,
  selectedPresetIds: new Set(), dirty: false, applyingPreset: false,
  trendRange: '90', trendVisible: { created:true, closed:true }, distributionSelection: null,
  overdueSort: 'process', pdfReady: false, comparison: null
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
  jiraBoardState.distributionSelection = null;
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
  for (const group of jiraGroupBy(selected, x=>x.projectKey).values()) {
    if(new Set(group.map(x=>x.severityFieldId)).size>1) {
      toast(`项目 ${group[0].projectKey} 的查询方案使用了不同严重等级字段，请统一字段后再合并分析。`,'error');return;
    }
  }
  const button = byId('jira-run-analysis');
  button.disabled = true;
  button.textContent = '读取并计算中…';
  byId('jira-board-results').innerHTML = '<section class="jira-loading"><div class="jira-spinner"></div><strong>正在读取 Jira 问题历史</strong><span>问题较多时需要一些时间，请保持页面打开。</span></section>';
  try {
    const analyses=await runJiraPresetAnalyses(selected,cutoffDate,button);
    jiraBoardState.analysis = mergeJiraAnalyses(analyses,cutoffDate);
    jiraBoardState.comparison = {unit:'month',mode:'mom',from:new Date(jiraShiftPeriod(jiraPeriodStart(Date.parse(cutoffDate),'month'),'month',-5)).toISOString().slice(0,10),to:cutoffDate};
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
  entries.forEach(({data,preset})=>(data.issues||[]).forEach(issue=>{const key=`${data.project}|${issue.key}`;if(unique.has(key)){const existing=unique.get(key);if(!existing.sourceSchemes.includes(preset.name))existing.sourceSchemes.push(preset.name);}else unique.set(key,{...issue,projectKey:data.project,projectName:data.standard?.projectName||data.project,sourceSchemes:[preset.name],reviewContext:{projectKey:data.project,issueKey:issue.key,cutoffDate,severityFieldId:preset.severityFieldId,variantFieldId:preset.variantFieldId}});}));
  const issues=[...unique.values()],stages=[['new','新增'],['confirm','问题确认'],['analysis','原因分析'],['action','措施确认'],['verify','测试验证'],['closed','问题关闭']];
  const closed=issues.filter(x=>x.stageCode==='closed'),active=issues.filter(x=>x.stageCode!=='closed');
  const funnel=stages.map(([code,name],order)=>({code,name:code==='new'?'创建':name,order,count:issues.filter(x=>x.maxReachedStageOrder>=order).length}));
  const overdue=stages.slice(0,-1).map(([code,name])=>{const values=issues.filter(x=>x.stageCode===code);return{code,name,count:values.filter(x=>x.stageOverdueDays>0).length,maxOverdueDays:Math.max(0,...values.map(x=>x.stageOverdueDays||0))};});
  overdue.push({code:'closure',name:'关闭总周期',count:active.filter(x=>x.closureOverdueDays>0).length,maxOverdueDays:Math.max(0,...active.map(x=>x.closureOverdueDays||0))});

  const unmatchedStatuses=jiraCounts(issues.filter(x=>x.stageCode==='other'),x=>x.status,'status');
  const unmatchedSeverities=jiraCounts(issues.filter(x=>x.severityKey==='UNKNOWN'),x=>x.severityLabel,'severity');
  const generatedAt=entries.map(x=>new Date(x.data.generatedAt)).filter(x=>!Number.isNaN(x.valueOf())).sort((a,b)=>b-a)[0]?.toISOString()||new Date().toISOString();
  return{categories:[...new Map(entries.flatMap(x=>x.data.categories||[]).map(x=>[x.id,x])).values()],generatedAt,effectiveCutoff:entries.map(x=>x.data.effectiveCutoff).sort((a,b)=>Date.parse(a)-Date.parse(b))[0],jiraBaseUrl:entries[0]?.data.jiraBaseUrl,cutoffDate,project:[...new Set(entries.map(x=>x.data.project))].join('、'),projects:[...new Set(entries.map(x=>x.data.project))],presetNames:entries.map(x=>x.preset.name),standards:entries.map(x=>({project:x.data.project,...x.data.standard})),queries:entries.map(x=>({project:x.data.project,preset:x.preset.name,jql:x.data.query})),truncated:entries.some(x=>x.data.truncated),sourceTotal:entries.reduce((sum,x)=>sum+(x.data.sourceTotal||0),0),historyTruncated:issues.filter(x=>x.historyTruncated).length,summary:{...jiraClosureSummary(issues),total:issues.length,active:active.length,closed:closed.length,closureRate:jiraPercentValue(closed.length,issues.length),averageClosureDays:jiraAverage(closed.filter(x=>x.timingReliable).map(x=>x.closureElapsedDays)),stageOverdue:active.filter(x=>x.stageOverdueDays>0).length,closureOverdue:active.filter(x=>x.closureOverdueDays>0).length},funnel,overdue,unmatchedStatuses,unmatchedSeverities,issues};
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

async function loadJiraFollowUpAnalysis(data) {
  const host=byId('jira-followup-host');if(!host)return;
  setJiraPdfReady(false);
  const active=data.issues.filter(issue=>issue.stageCode!=='closed');
  disposeJiraCharts(host);
  host.innerHTML='<div class="jira-chart-loading"><div class="jira-spinner"></div><strong>正在核对当日评论</strong><span>0 / '+jiraNumber(active.length)+'</span></div>';
  await loadJiraComments(active,(completed,total)=>{
    if(jiraBoardState.analysis!==data)return;
    const progress=host.querySelector('span');if(progress)progress.textContent=`${jiraNumber(completed)} / ${jiraNumber(total)}`;
  });
  if(jiraBoardState.analysis!==data||byId('jira-followup-host')!==host)return;
  const failed=active.filter(issue=>jiraBoardState.commentCache.get(jiraCommentKey(issue))?.error);
  const items=active.filter(issue=>{const comment=jiraBoardState.commentCache.get(jiraCommentKey(issue));return comment&&!comment.error&&jiraDateKey(comment.created)!==data.cutoffDate;});
  renderJiraFollowUpChart(host,items,failed.length);
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
    .jira-panel-head,.jira-result-head { flex-direction:row !important; }
    .jira-compare-controls { grid-template-columns:repeat(4,minmax(0,1fr)) !important; }
    .jira-compare-card { padding:16px !important;break-inside:auto !important; }
    .jira-compare-body { padding:4px 19px 19px !important; }
    .jira-dimension-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
    .jira-scope-actions { display:none !important; }
    .jira-result-actions, .jira-result-jql, .jira-segmented, .jira-chart-data { display: none !important; }
    .jira-chart-warning button { display: none !important; }
    .jira-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
    .jira-diagnosis-grid { grid-template-columns: minmax(0, 1.15fr) minmax(350px, .85fr) !important; }
    .jira-risk-stack { grid-template-columns: minmax(0, 1fr) !important; }
    .jira-two-column { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
    .jira-panel, .jira-dimension-grid { max-width:none !important; overflow:visible !important; }
    .jira-duration-scroll { overflow:visible !important; }
    .jira-duration-scroll .jira-echart-wrap { min-width:0 !important; }
    .jira-duration-note { display:none !important; }
    .jira-echart { width:100% !important; overflow:visible !important; }
    .jira-echart>svg { display:block; width:100% !important; }
    .jira-compare-controls button { display:none !important; }
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
    // Freeze the analyzed result at click time, before waiting for export fonts/styles.
    const snapshots=new Map([...source.querySelectorAll('[data-jira-chart]')].map(node=>{
      const entry=jiraCharts.get(node);
      if(!entry)throw new Error('Chart is not ready: '+node.dataset.jiraChart);
      return [node.dataset.jiraChart,{entry,height:node.clientHeight||300,legend:entry.chart.getOption().legend||[]}];
    }));
    const results=source.cloneNode(true);
    const copiedSelects=results.querySelectorAll('select');
    source.querySelectorAll('select').forEach((select,index)=>{copiedSelects[index].value=select.value;});
    // Unapplied form edits must not relabel the already analyzed comparison data.
    results.querySelectorAll('[data-compare]').forEach(input=>{input.value=jiraBoardState.comparison[input.dataset.compare];});
    page.appendChild(results);
    printDocument.body.appendChild(page);

    await Promise.all(stylesheetLoads);
    if(printDocument.fonts?.ready)await printDocument.fonts.ready;
    prepareJiraChartsPdf(snapshots,results);
    await new Promise(resolve=>printWindow.requestAnimationFrame(()=>printWindow.requestAnimationFrame(resolve)));

    const pageHeight=Math.ceil(Math.max(page.scrollHeight,page.getBoundingClientRect().height))+2;
    const maximumSinglePageHeight=18000;
    if(pageHeight>maximumSinglePageHeight){
      printWindow.close();
      toast('看板内容超过单页PDF的安全高度，请缩小查询范围后重试。','error');
      return;
    }
    const pageStyle=printDocument.createElement('style');
    pageStyle.textContent=`@page { size: 1400px ${pageHeight}px; margin: 0; } @media print { html, body { width: 1400px !important; height: auto !important; min-height: 0 !important; } }`;
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

function renderJiraResults(data) {
  jiraBoardState.pdfReady=false;
  const warnings = [];
  if (data.truncated) warnings.push(`Jira共返回 ${jiraNumber(data.sourceTotal)} 条，当前看板为保护服务器仅分析前 5,000 条，请缩小查询条件。`);
  if (data.historyTruncated) warnings.push(`有 ${jiraNumber(data.historyTruncated)} 条问题的 Jira 变更历史超过接口单次展开上限，其历史时效无法可靠判定；已关闭的问题仍计入按期关闭率分母，不计入按期分子和平均周期有效样本。请核对Jira历史完整性。`);
  if (data.unmatchedStatuses.length) warnings.push(`有 ${data.unmatchedStatuses.reduce((sum, x) => sum + x.count, 0)} 条问题状态未匹配处理阶段：${data.unmatchedStatuses.map(x => `${x.status}(${x.count})`).join('、')}。`);
  if (data.unmatchedSeverities.length) warnings.push(`有 ${data.unmatchedSeverities.reduce((sum, x) => sum + x.count, 0)} 条问题的严重等级无法映射为 S/A/B/C，因此不参与超时判定：${data.unmatchedSeverities.map(x => `${x.severity}(${x.count})`).join('、')}。`);
  const results = byId('jira-board-results');
  const queryText=data.queries.map(x=>`【${x.preset} / ${x.project}】\n${x.jql}`).join('\n\n');
  disposeJiraCharts(results);
  results.innerHTML = `
    <section class="jira-result-head jira-result-context"><div><h3>${esc(data.project)} · 截至 ${esc(data.cutoffDate)}</h3><p>${data.presetNames.length} 个查询方案 · ${data.projects.length} 个项目 · 数据生成于 ${esc(fmtDate(data.generatedAt))}</p><details class="jira-result-jql"><summary>查看查询口径</summary><pre>${esc(queryText)}</pre></details></div><div class="jira-result-actions"><button type="button" class="btn btn-light btn-sm" id="jira-edit-query">修改查询范围</button><button type="button" class="btn btn-light btn-sm" id="jira-copy-jql">复制JQL</button><button type="button" class="btn btn-light btn-sm" id="jira-export-pdf" disabled>准备PDF数据…</button><button type="button" class="btn btn-primary btn-sm" id="jira-rerun">重新分析</button></div></section>
    ${warnings.map(text => `<div class="jira-warning">${esc(text)}</div>`).join('')}
    <section class="jira-metrics">
      ${jiraMetric('问题总量', data.summary.total, '查询范围内全部问题', 'all')}
      ${jiraMetric('已关闭问题', data.summary.closed, '查看明细与超期复盘', 'closed-list', 'success')}
      ${jiraMetric('待关闭问题', data.summary.active, '截止日仍未进入关闭阶段', 'active', 'primary')}
      ${jiraMetric('整体关闭率', jiraPercent(data.summary.closureRate), `${jiraNumber(data.summary.closed)} 项已关闭`, 'closed', 'success')}
      ${jiraMetric('平均关闭周期', jiraDays(data.summary.averageClosureDays), '仅统计已关闭问题', 'closed-duration', 'violet')}
      ${jiraMetric('按期关闭率（总周期）', jiraPercent(data.summary.onTimeRate), `阶段超期${data.summary.stageOverdueClosed}/${data.summary.closed} · 无法判定${data.summary.unassessableStageClosed}`, 'on-time', 'primary')}
      ${jiraMetric('阶段超时', data.summary.stageOverdue, '当前阶段超过时效', 'stage-overdue', 'danger')}
      ${jiraMetric('关闭周期超时', data.summary.closureOverdue, '当前未关闭且超过总周期', 'closure-overdue', 'orange')}
    </section>
    <div class="jira-diagnosis-grid">
      <section class="jira-panel jira-funnel-panel"><div class="jira-panel-head"><div><h3>问题处理阶段漏斗</h3><p>按截止日前曾经到达的最深阶段累计统计；点击阶段查看明细。</p></div><small>累计到达</small></div><div class="jira-funnel-chart">${jiraChartSlot('funnel','问题处理阶段漏斗',480)}</div></section>
      <div class="jira-risk-stack">
        <section class="jira-panel jira-followup-panel"><div class="jira-panel-head"><div><h3>当日未跟进问题</h3><p>未关闭且截止日没有新增评论。</p></div><small>评论口径</small></div><div id="jira-followup-host"></div></section>
        <section class="jira-panel jira-overdue-panel"><div class="jira-panel-head"><div><h3>处理超时报表</h3><p>阶段停留与关闭总周期风险。</p></div><div class="jira-segmented"><button type="button" data-jira-overdue-sort="process" class="${jiraBoardState.overdueSort==='process'?'active':''}">流程</button><button type="button" data-jira-overdue-sort="count" class="${jiraBoardState.overdueSort==='count'?'active':''}">数量</button></div></div><div id="jira-overdue-chart"></div></section>
      </div>
    </div>
    <section class="jira-panel jira-trend-panel"><div class="jira-panel-head"><div><h3>问题新增与关闭趋势</h3><p>对比问题流入和关闭节奏，点击数据点查看对应问题。</p></div><div class="jira-segmented">${[['30','30天'],['90','90天'],['180','180天'],['all','全部']].map(item=>`<button type="button" data-jira-trend-range="${item[0]}" class="${jiraBoardState.trendRange===item[0]?'active':''}">${item[1]}</button>`).join('')}</div></div><div id="jira-trend-chart"></div></section>
    <section class="jira-panel jira-variant-panel"><div class="jira-panel-head"><div><h3>未关闭问题分布</h3><p>按严重等级、问题分类查看未关闭问题；点击扇区联动下方处理人分布。</p></div></div>
      <div class="jira-dimension-grid"><div><h4>按严重等级</h4>${jiraChartSlot('active-severity','按严重等级',300)}</div><div><h4>按问题分类</h4>${jiraChartSlot('active-category','按问题分类',300)}</div></div>
      <div class="jira-assignee-scope"><div class="jira-subhead"><div><strong>当前处理人问题堆积</strong><p id="jira-category-selection"></p></div><div class="jira-scope-actions"><button type="button" class="btn btn-light btn-sm" id="jira-distribution-details">查看所选明细</button><button type="button" class="btn btn-light btn-sm" id="jira-distribution-reset">重置范围</button></div></div>${jiraChartSlot('variant-assignee','当前处理人问题堆积',300)}</div>
    </section>
    <div class="jira-section-label"><strong>效率复盘</strong><span>关闭结果与处理周期</span></div>
    <section class="jira-panel" id="jira-closure-comparison"></section>
    <section class="jira-panel jira-rate-panel">
      <div class="jira-panel-head"><div><h3>问题关闭率</h3><p>各分组已关闭问题数 ÷ 该分组全部问题数，包含超期关闭的问题。</p></div></div>
      <div class="jira-dimension-grid"><div><h4>按严重等级</h4>${jiraChartSlot('closure-severity','严重等级关闭率',340)}</div><div><h4>按问题分类</h4>${jiraChartSlot('closure-category','问题分类关闭率',340)}</div></div>
    </section>
    <section class="jira-panel jira-rate-panel">
      <div class="jira-panel-head"><div><h3>按期关闭率</h3><p>各分组总周期按期关闭问题数 ÷ 该分组全部已关闭问题数；时限采用各项目、严重等级对应的 JIRA 时效标准。</p></div></div>
      <div class="jira-dimension-grid"><div><h4>按严重等级</h4>${jiraChartSlot('ontime-severity','严重等级按期关闭率',340)}</div><div><h4>按问题分类</h4>${jiraChartSlot('ontime-category','问题分类按期关闭率',340)}</div></div>
      <p class="jira-duration-note">无法判定保留在已关闭分母中；“—”表示无已关闭样本。点击柱子默认查看按期问题，可筛选超期、无法判定及全部已关闭问题。</p>
    </section>
    <section class="jira-panel jira-duration-panel">
      <div class="jira-panel-head"><div><h3>问题处理时长分析</h3><p>仅统计已关闭问题：问题分类、严重等级按创建至实际关闭计算；处理阶段按本阶段累计耗时计算。共用天数刻度，各分区独立连线。</p></div></div>
      <div class="jira-duration-scroll">${jiraChartSlot('duration-analysis','问题处理时长分析',420)}</div>
      <p class="jira-duration-note">“—”表示无有效样本，不按0天计算。点击节点查看参与平均值计算的问题；分类较多时可横向滚动查看全部。</p>
    </section>`;

  renderJiraBoardCharts(data);
  renderJiraTrend(data);
  renderJiraClosureComparisons(data);
  renderJiraCategories(data);
  loadJiraFollowUpAnalysis(data);

  byId('jira-copy-jql').onclick = async () => {
    try { await navigator.clipboard.writeText(queryText); toast('JQL已复制。'); }
    catch { toast('浏览器未允许复制，请从查询口径中手动复制JQL。', 'error'); }
  };
  byId('jira-rerun').onclick=runJiraAnalysis;
  byId('jira-export-pdf').onclick=exportJiraBoardPdf;
  byId('jira-edit-query').onclick=()=>document.querySelector('.jira-config-card').scrollIntoView({behavior:'smooth',block:'start'});
  results.querySelectorAll('[data-jira-trend-range]').forEach(button=>button.onclick=()=>{jiraBoardState.trendRange=button.dataset.jiraTrendRange;renderJiraTrend(data);});
  results.querySelectorAll('[data-jira-overdue-sort]').forEach(button=>button.onclick=()=>{jiraBoardState.overdueSort=button.dataset.jiraOverdueSort;renderJiraOverdue(data);});
  results.querySelectorAll('[data-jira-kind]').forEach(button => button.onclick = () => {
    const kind = button.dataset.jiraKind;
    if (kind === 'all') openJiraDetails('全部问题', data.issues, 'stage');
    if (kind === 'closed-list') openJiraClosedDetails(data);
    if (kind === 'on-time') openJiraClosedDetails(data,{onTimeOnly:true});
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

function jiraMatchesTiming(issue,selection) {
  return !selection||(selection==='onTime'?issue.isOnTime===true:selection==='overdue'?issue.isOnTime===false:typeof issue.isOnTime!=='boolean');
}

function openJiraDetails(title, items, overdueMode, { compact = false, category = false, duration = null, timing = false } = {}) {
  let page = 1,currentItems=[...items];
  const pageSize = 50;
  const trigger=document.activeElement;
  const severityOptions=[...new Set(items.map(x=>x.severityLabel))].sort((a,b)=>jiraSeverityOrder(items.find(x=>x.severityLabel===a)?.severityKey)-jiraSeverityOrder(items.find(x=>x.severityLabel===b)?.severityKey));
  const statusOptions=[...new Set(items.map(x=>x.status))].sort();
  const assigneeOptions=[...new Set(items.map(x=>x.assignee))].sort();
  const timingFilter=timing?'<label><span>总周期时效</span><select id="jira-detail-timing"><option value="onTime">按期</option><option value="overdue">超期</option><option value="unknown">无法判定</option><option value="">全部已关闭</option></select></label>':'';
  const categoryFilter=category?`<label><span>问题分类</span><select id="jira-detail-category">${jiraCategoryOptions({...jiraBoardState.analysis,categories:jiraBoardState.analysis.categories.filter(node=>items.some(issue=>jiraCategoryIncludes(jiraBoardState.analysis,issue,String(node.id))))})}</select></label>`:'';
  disposeJiraCharts(modalRoot);
  modalRoot.innerHTML = `<div class="modal-backdrop jira-detail-backdrop"><div class="jira-detail-modal" role="dialog" aria-modal="true" aria-labelledby="jira-detail-title"><div class="jira-detail-head"><div><h3 id="jira-detail-title">${esc(title)}</h3><p>当前穿透范围共 ${jiraNumber(items.length)} 项，支持搜索、快速筛选和导出当前结果。</p></div><div class="jira-detail-actions"><button type="button" class="btn btn-light btn-sm jira-export-button" data-jira-export ${items.length?'':'disabled'}><span>↓</span>导出当前结果</button><button type="button" class="jira-detail-close" aria-label="关闭">×</button></div></div><div class="jira-detail-filters"><label class="jira-detail-search"><span>搜索</span><input id="jira-detail-search" placeholder="输入Jira编号或标题"></label><label><span>严重等级</span><select id="jira-detail-severity"><option value="">全部</option>${severityOptions.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label><label><span>当前状态</span><select id="jira-detail-status"><option value="">全部</option>${statusOptions.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label><label><span>当前处理人</span><select id="jira-detail-assignee"><option value="">全部</option>${assigneeOptions.map(x=>`<option>${esc(x)}</option>`).join('')}</select></label>${categoryFilter}${timingFilter}</div><div class="jira-detail-body" id="jira-detail-body"></div></div></div>`;
  const onKeydown=event=>{if(event.key==='Escape')close();if(event.key==='Tab'){const focusable=[...modalRoot.querySelectorAll('button:not([disabled]),input,select,a[href]')];if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};
  const close = () => {document.removeEventListener('keydown',onKeydown);disposeJiraCharts(modalRoot);modalRoot.replaceChildren();trigger?.focus?.();};
  document.addEventListener('keydown',onKeydown);
  modalRoot.querySelector('.jira-detail-close').onclick = close;
  modalRoot.querySelector('[data-jira-export]').onclick = event => exportJiraDetails(title,currentItems,overdueMode,event.currentTarget,{compact,category,duration,timing});
  modalRoot.querySelector('.jira-detail-backdrop').onclick = event => { if (event.target.classList.contains('jira-detail-backdrop')) close(); };

  const renderPage = async () => {
    if (!modalRoot.querySelector('#jira-detail-body')) return;
    const keyword=byId('jira-detail-search').value.trim().toLowerCase(),severityValue=byId('jira-detail-severity').value,statusValue=byId('jira-detail-status').value,assigneeValue=byId('jira-detail-assignee').value;
    currentItems=items.filter(issue=>(!timing||jiraMatchesTiming(issue,byId('jira-detail-timing').value))&&(!category||jiraCategoryIncludes(jiraBoardState.analysis,issue,byId('jira-detail-category').value))&&(!keyword||issue.key.toLowerCase().includes(keyword)||issue.summary.toLowerCase().includes(keyword)||(category&&String(issue.variantLabel||'').toLowerCase().includes(keyword)))&&(!severityValue||issue.severityLabel===severityValue)&&(!statusValue||issue.status===statusValue)&&(!assigneeValue||issue.assignee===assigneeValue));
    const totalPages = Math.max(1, Math.ceil(currentItems.length / pageSize));
    page = Math.min(Math.max(1, page), totalPages);
    const visible = currentItems.slice((page - 1) * pageSize, page * pageSize);
    modalRoot.querySelector('[data-jira-export]').disabled=!currentItems.length;
    disposeJiraCharts(byId('jira-detail-body'));
    byId('jira-detail-body').innerHTML = currentItems.length ? `
      <div class="jira-detail-breakdowns"><div><div><strong>严重等级分布</strong><small>按当前明细范围统计</small></div><section>${jiraChartSlot('detail-severity','严重等级分布',190)}</section></div><div><div><strong>处理人分布</strong><small>按问题数量从高到低</small></div><section>${jiraChartSlot('detail-assignee','处理人分布',190)}</section></div></div>
      <div class="jira-detail-table-wrap"><table><thead>${compact?'<tr><th>所属项目</th><th>来源方案</th><th>Jira编号</th><th>标题</th><th>严重等级</th><th>当前处理人</th><th>当前状态</th><th>所属阶段</th></tr>':'<tr><th>项目 / 来源</th><th>严重等级</th><th>Jira编号 / 标题</th><th>当前处理人</th><th>当前状态</th><th>最新结论</th><th>是否超时</th>'+ (category?'<th>问题分类 / JIRA原始选项</th>':'')+(duration?'<th>本次统计耗时（天）</th>':'')+'</tr>'}</thead><tbody>${visible.map(issue => compact?jiraCompactIssueRow(issue):jiraIssueRow(issue, overdueMode, category, duration)).join('')}</tbody></table></div>
      <div class="jira-detail-pagination"><span>筛选后 ${jiraNumber(currentItems.length)} 项 · 第 ${page}/${totalPages} 页</span><div><button type="button" class="btn btn-light btn-sm" data-page="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><button type="button" class="btn btn-light btn-sm" data-page="next" ${page >= totalPages ? 'disabled' : ''}>下一页</button></div></div>`
      : jiraNoData('该范围内暂无问题');
    byId('jira-detail-body').querySelector('[data-page="prev"]')?.addEventListener('click', () => { page -= 1; renderPage(); });
    byId('jira-detail-body').querySelector('[data-page="next"]')?.addEventListener('click', () => { page += 1; renderPage(); });
    if(currentItems.length)renderJiraDetailCharts(currentItems);
    if(!compact)await loadJiraComments(visible);
  };
  ['jira-detail-search','jira-detail-severity','jira-detail-status','jira-detail-assignee',...(category?['jira-detail-category']:[]),...(timing?['jira-detail-timing']:[])].forEach(id=>byId(id).addEventListener(id==='jira-detail-search'?'input':'change',()=>{page=1;renderPage();}));
  renderPage();
  setTimeout(()=>byId('jira-detail-search')?.focus(),0);
}

function jiraCompactIssueRow(issue) {
  return `<tr><td><strong>${esc(issue.projectKey)}</strong></td><td>${esc(issue.sourceSchemes.join('、'))}</td><td><a href="${esc(issue.url)}" target="_blank" rel="noopener noreferrer">${esc(issue.key)}</a></td><td class="jira-detail-title-cell"><strong>${esc(issue.summary)}</strong></td><td><span class="jira-severity ${esc(issue.severityKey.toLowerCase())}">${esc(issue.severityLabel)}</span></td><td>${esc(issue.assignee)}</td><td><span class="jira-status-dot" style="--stage:${jiraStageColors[issue.stageCode]||jiraStageColors.other}"></span>${esc(issue.status)}</td><td>${esc(issue.stageName)}</td></tr>`;
}

function jiraIssueRow(issue, overdueMode, category = false, duration = null) {
  const overdue = overdueMode === 'closure' ? issue.closureOverdueDays : issue.stageOverdueDays;
  const unknown = overdueMode === 'closure' && issue.stageCode === 'closed' && typeof issue.isOnTime !== 'boolean';
  const limit = overdueMode === 'closure' ? issue.closureLimitDays : issue.stageLimitDays;
  const comment = jiraBoardState.commentCache.get(jiraCommentKey(issue));
  return `<tr class="${overdue > 0 ? 'is-overdue' : ''}">
    <td><strong>${esc(issue.projectKey)}</strong><small>${esc(issue.sourceSchemes.join('、'))}</small></td><td><span class="jira-severity ${esc(issue.severityKey.toLowerCase())}">${esc(issue.severityLabel)}</span></td>
    <td class="jira-detail-title-cell"><a href="${esc(issue.url)}" target="_blank" rel="noopener noreferrer">${esc(issue.key)}</a><strong>${esc(issue.summary)}</strong><small>创建：${esc(fmtDateOnly(issue.createdAt))}</small></td>
    <td>${esc(issue.assignee)}</td><td><span class="jira-status-dot" style="--stage:${jiraStageColors[issue.stageCode] || jiraStageColors.other}"></span>${esc(issue.status)}</td>
    <td class="jira-comment" data-comment-key="${esc(jiraCommentKey(issue))}">${jiraCommentHtml(comment)}</td>
    <td>${unknown ? '<span class="jira-unknown-tag">无法判定</span>' : overdue > 0 ? `<span class="jira-overdue-tag">超时 ${overdue} 天</span>` : `<span class="jira-ok-tag">${limit ? `时限 ${limit} 天` : '未配置时限'}</span>`}</td>${category?`<td>${esc(jiraCategoryLabel(jiraBoardState.analysis,issue))}<small>${esc(issue.variantLabel||'未填写')}</small></td>`:''}${duration?`<td>${jiraDurationValue(issue,duration.stageCode).toFixed(2)}</td>`:''}</tr>`;
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

async function exportJiraDetails(title,items,overdueMode,button,{compact=false,category=false,duration=null,timing=false}={}) {
  if (!items.length) return;
  const original=button.textContent;
  button.disabled=true;button.textContent=compact?'正在导出…':'准备最新评论…';
  if(!compact)await loadJiraComments(items);
  const headers=compact?['所属项目','来源方案','Jira编号','标题','严重等级','当前处理人','当前状态','所属阶段']:['所属项目','来源方案','Jira编号','标题','严重等级','当前处理人','当前状态','所属阶段','最新结论','评论人','评论时间','创建时间','关闭时间','阶段停留天数','阶段时限','阶段超时天数','关闭周期天数','关闭总周期时限','关闭超时天数'];
  const rows=items.map(issue=>{
    if(compact)return [issue.projectKey,issue.sourceSchemes.join('、'),issue.key,issue.summary,issue.severityLabel,issue.assignee,issue.status,issue.stageName];
    const comment=jiraBoardState.commentCache.get(jiraCommentKey(issue))||{};
    return [issue.projectKey,issue.sourceSchemes.join('、'),issue.key,issue.summary,issue.severityLabel,issue.assignee,issue.status,issue.stageName,comment.error?`最新评论加载失败：${comment.error}`:(comment.body||''),comment.author||'',comment.created||'',issue.createdAt,issue.closedAt||'',issue.stageElapsedDays,issue.stageLimitDays??'',issue.stageOverdueDays,issue.stageCode==='closed'&&!issue.timingReliable?'无法判定':issue.closureElapsedDays??'无法判定',issue.closureLimitDays??'',issue.stageCode==='closed'&&typeof issue.isOnTime!=='boolean'?'无法判定':issue.closureOverdueDays];
  });
  if(category){headers.push('问题分类','JIRA原始选项');rows.forEach((row,index)=>row.push(jiraCategoryLabel(jiraBoardState.analysis,items[index]),items[index].variantLabel||'未填写'));}
  if(timing){headers.push('总周期时效');rows.forEach((row,index)=>row.push(items[index].isOnTime===true?'按期':items[index].isOnTime===false?'超期':'无法判定'));}
  if(duration){headers.push('本次统计耗时（天）');rows.forEach((row,index)=>row.push(jiraDurationValue(items[index],duration.stageCode)));}
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
