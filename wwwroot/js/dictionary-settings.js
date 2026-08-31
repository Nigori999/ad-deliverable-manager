const dictionaryManagementState = {
  selectedId: null,
  scopeValue: '',
  filters: { keyword: '', type: '', structure: '', status: '' }
};

function filterDictionaries(items) {
  const filters = dictionaryManagementState.filters;
  const keyword = filters.keyword.trim().toLowerCase();
  return items.filter(item => {
    if (keyword && !`${item.name} ${item.code} ${item.description || ''}`.toLowerCase().includes(keyword)) return false;
    if (filters.type === 'SYSTEM' && !item.isSystem) return false;
    if (filters.type === 'BUSINESS' && item.isSystem) return false;
    if (filters.structure && item.structureMode !== filters.structure) return false;
    if (filters.status === 'ENABLED' && !item.isEnabled) return false;
    if (filters.status === 'DISABLED' && item.isEnabled) return false;
    return true;
  });
}

async function loadDictionaryManagementModel() {
  const listData = await api('/internal/master-data/dictionaries');
  const allTypes = listData.items || [];
  const types = filterDictionaries(allTypes);
  let selectedType = types.find(x => Number(x.id) === Number(dictionaryManagementState.selectedId)) || types[0] || null;
  dictionaryManagementState.selectedId = selectedType?.id || null;
  const scopeOptions = listData.scopeOptions?.deliverableTypes || [];
  if (!selectedType) return { allTypes, types, selectedType: null, items: [], scopeOptions };

  if (selectedType.scopeMode === 'DELIVERABLE_TYPE') {
    if (!scopeOptions.some(x => x.code === dictionaryManagementState.scopeValue)) dictionaryManagementState.scopeValue = scopeOptions[0]?.code || '';
  } else {
    dictionaryManagementState.scopeValue = '';
  }
  const query = dictionaryManagementState.scopeValue ? `?scopeValue=${encodeURIComponent(dictionaryManagementState.scopeValue)}` : '';
  const detail = await api(`/internal/master-data/dictionaries/${encodeURIComponent(selectedType.code)}${query}`);
  selectedType = detail.dictionary || selectedType;
  return { allTypes, types, selectedType, items: detail.items || [], scopeOptions };
}

function flattenDictionaryItems(items) {
  const sorted = [...items].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || a.name.localeCompare(b.name, 'zh-CN'));
  const byParent = new Map();
  sorted.forEach(item => {
    const key = item.parentItemId == null ? 0 : Number(item.parentItemId);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(item);
  });
  const result = [];
  const visited = new Set();
  const visit = (item, depth) => {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    result.push({ item, depth });
    (byParent.get(Number(item.id)) || []).forEach(child => visit(child, depth + 1));
  };
  (byParent.get(0) || []).forEach(item => visit(item, 0));
  sorted.filter(item => !visited.has(item.id)).forEach(item => visit(item, 0));
  return result;
}

function dictionaryItemsTable(dictionary, items) {
  const canCreate = hasPermission('DICTIONARY_CREATE') && dictionary.isEnabled;
  const canEdit = hasPermission('DICTIONARY_EDIT') && dictionary.isEnabled;
  const canDelete = hasPermission('DICTIONARY_DELETE') && dictionary.isEnabled;
  const tree = dictionary.structureMode === 'TREE';
  if (!items.length) return `<div class="dictionary-empty"><strong>暂无字典项</strong><p>${dictionary.isEnabled ? '可新增第一个字典项开始配置。' : '该字典已停用，如需维护请先启用。'}</p>${canCreate ? '<button type="button" class="btn btn-primary" id="new-dictionary-item-empty">+ 新增字典项</button>' : ''}</div>`;
  const rows = tree ? flattenDictionaryItems(items) : items.map(item => ({ item, depth: 0 }));
  return `<div class="table-wrap dictionary-table"><table><thead><tr><th>字典项名称</th><th>字典项值</th><th>描述</th><th>排序</th><th>业务引用</th><th>操作</th></tr></thead><tbody>${rows.map(({ item, depth }) => `<tr>
    <td><div class="dictionary-tree-name" style="--tree-depth:${depth}">${tree ? `<span class="tree-connector">${item.childCount ? '▾' : '·'}</span>` : ''}<strong>${esc(item.name)}</strong></div></td>
    <td class="code">${esc(item.value)}</td><td class="muted dictionary-description-cell">${esc(item.description || '—')}</td><td>${item.sortOrder}</td>
    <td>${item.usageCount ? `<span class="badge">${item.usageCount} 条</span>` : '<span class="muted">未引用</span>'}</td>
    <td><div class="inline-actions">${canCreate && tree ? `<button type="button" class="btn btn-light btn-sm dictionary-item-child" data-id="${item.id}">新增下级</button>` : ''}${canEdit ? `<button type="button" class="btn btn-light btn-sm dictionary-item-edit" data-id="${item.id}">编辑</button>` : ''}${canDelete ? `<button type="button" class="btn btn-danger btn-sm dictionary-item-delete" data-id="${item.id}">删除</button>` : ''}</div></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function dictionaryManagementMarkup(model) {
  const { allTypes, types, selectedType, items, scopeOptions } = model;
  const filters = dictionaryManagementState.filters;
  const canCreate = hasPermission('DICTIONARY_CREATE');
  const enabledCount = allTypes.filter(x => x.isEnabled).length;
  const systemCount = allTypes.filter(x => x.isSystem).length;
  const filterPanel = `<form id="dictionary-filter-form" class="dictionary-filter-bar">
    <div class="field"><label>关键词</label><input name="keyword" value="${esc(filters.keyword)}" placeholder="搜索名称、Code 或描述"></div>
    <div class="field"><label>字典类型</label><select name="type"><option value="">全部类型</option><option value="SYSTEM" ${filters.type === 'SYSTEM' ? 'selected' : ''}>系统级</option><option value="BUSINESS" ${filters.type === 'BUSINESS' ? 'selected' : ''}>业务级</option></select></div>
    <div class="field"><label>字典结构</label><select name="structure"><option value="">全部结构</option><option value="FLAT" ${filters.structure === 'FLAT' ? 'selected' : ''}>平级结构</option><option value="TREE" ${filters.structure === 'TREE' ? 'selected' : ''}>树形结构</option></select></div>
    <div class="field"><label>状态</label><select name="status"><option value="">全部状态</option><option value="ENABLED" ${filters.status === 'ENABLED' ? 'selected' : ''}>启用</option><option value="DISABLED" ${filters.status === 'DISABLED' ? 'selected' : ''}>停用</option></select></div>
    <div class="dictionary-filter-actions"><button type="submit" class="btn btn-primary btn-sm">筛选</button><button type="button" id="reset-dictionary-filter" class="btn btn-light btn-sm">重置</button></div>
  </form>`;
  const list = types.length ? types.map(x => `<button type="button" class="dictionary-type-button ${Number(x.id) === Number(selectedType?.id) ? 'active' : ''} ${x.isEnabled ? '' : 'disabled-type'}" data-id="${x.id}">
      <span class="dictionary-type-name"><strong>${esc(x.name)}</strong><small>${esc(x.code)}</small></span>
      <span class="dictionary-type-badges"><span class="badge ${x.isSystem ? '' : 'active'}">${x.isSystem ? '系统级' : '业务级'}</span><span class="status-dot-label ${x.isEnabled ? 'enabled' : 'disabled'}">${x.isEnabled ? '启用' : '停用'}</span></span>
      <small class="dictionary-type-meta">${x.structureMode === 'TREE' ? '树形结构' : '平级结构'} · ${x.itemCount} 项</small>
    </button>`).join('') : '<div class="dictionary-list-empty">没有符合条件的字典</div>';
  if (!selectedType) {
    return `<section class="dictionary-overview"><div><h2>字典管理</h2><p>集中维护系统级与业务级字典，为业务字段提供稳定、统一的选项来源。</p></div>${canCreate ? '<button type="button" id="new-dictionary-type" class="btn btn-primary">+ 新增业务字典</button>' : ''}</section>${filterPanel}<section class="card dictionary-card"><div class="dictionary-layout"><aside class="dictionary-types-panel"><div class="dictionary-panel-title"><span>字典列表</span><span>${types.length}/${allTypes.length}</span></div>${list}</aside><div class="dictionary-no-selection"><strong>暂无可展示的字典</strong><p>调整筛选条件，或新增一个业务字典。</p></div></div></section>`;
  }
  const scopeFilter = selectedType.scopeMode === 'DELIVERABLE_TYPE'
    ? `<div class="field dictionary-scope-filter"><label>交付物类型作用域</label><select id="dictionary-scope-filter">${scopeOptions.map(x => `<option value="${esc(x.code)}" ${x.code === dictionaryManagementState.scopeValue ? 'selected' : ''}>${esc(x.name)}（${esc(x.code)}）</option>`).join('')}</select></div>`
    : '<div class="dictionary-scope-summary"><span class="badge">全局字典</span><small>字典项对全系统生效</small></div>';
  const canMaintainItems = selectedType.isEnabled;
  return `<section class="dictionary-overview"><div><h2>字典管理</h2><p>共 ${allTypes.length} 个字典，${enabledCount} 个启用，${systemCount} 个系统级字典。</p></div>${canCreate ? '<button type="button" id="new-dictionary-type" class="btn btn-primary">+ 新增业务字典</button>' : ''}</section>${filterPanel}
    <section class="card dictionary-card"><div class="dictionary-layout">
      <aside class="dictionary-types-panel"><div class="dictionary-panel-title"><span>字典列表</span><span>${types.length}/${allTypes.length}</span></div><div class="dictionary-type-list">${list}</div></aside>
      <div class="dictionary-items-panel"><div class="dictionary-selected-head"><div><div class="dictionary-selected-title"><h3>${esc(selectedType.name)}</h3><span class="badge ${selectedType.isSystem ? '' : 'active'}">${selectedType.isSystem ? '系统级' : '业务级'}</span><span class="badge">${selectedType.structureMode === 'TREE' ? '树形结构' : '平级结构'}</span><span class="badge ${selectedType.isEnabled ? 'released' : 'deprecated'}">${selectedType.isEnabled ? '启用' : '停用'}</span></div><p>${esc(selectedType.description || '暂无字典描述')}</p><div class="code">${esc(selectedType.code)}</div></div>
        <div class="inline-actions">${hasPermission('DICTIONARY_EDIT') ? '<button type="button" id="edit-dictionary-type" class="btn btn-light btn-sm">编辑字典</button>' : ''}${hasPermission('DICTIONARY_DELETE') && !selectedType.isSystem ? '<button type="button" id="delete-dictionary-type" class="btn btn-danger btn-sm">删除字典</button>' : ''}</div></div>
        ${selectedType.isEnabled ? '' : '<div class="notice-panel dictionary-disabled-notice">该字典已停用，不再提供业务选项。重新启用后才可维护字典项。</div>'}
        <div class="dictionary-toolbar">${scopeFilter}<div class="inline-actions"><span class="muted">${items.length} 个字典项</span>${hasPermission('DICTIONARY_CREATE') && canMaintainItems ? '<button type="button" id="new-dictionary-item" class="btn btn-primary btn-sm">+ 新增字典项</button>' : ''}</div></div>
        ${dictionaryItemsTable(selectedType, items)}
      </div>
    </div></section>`;
}

async function renderDictionaryManagement() {
  setPage('字典管理', '维护系统级与业务级字典及字典项');
  const model = await loadDictionaryManagementModel();
  content.innerHTML = dictionaryManagementMarkup(model);
  bindDictionaryManagement(model);
}

function bindDictionaryManagement(model) {
  const { selectedType, items } = model;
  byId('dictionary-filter-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    dictionaryManagementState.filters = Object.fromEntries(form);
    dictionaryManagementState.selectedId = null;
    await renderDictionaryManagement();
  });
  byId('reset-dictionary-filter')?.addEventListener('click', async () => {
    dictionaryManagementState.filters = { keyword: '', type: '', structure: '', status: '' };
    dictionaryManagementState.selectedId = null;
    await renderDictionaryManagement();
  });
  document.querySelectorAll('.dictionary-type-button').forEach(button => button.onclick = async () => {
    dictionaryManagementState.selectedId = Number(button.dataset.id);
    dictionaryManagementState.scopeValue = '';
    await renderDictionaryManagement();
  });
  byId('dictionary-scope-filter')?.addEventListener('change', async event => {
    dictionaryManagementState.scopeValue = event.target.value;
    await renderDictionaryManagement();
  });
  byId('new-dictionary-type')?.addEventListener('click', () => openDictionaryTypeForm(null));
  if (!selectedType) return;
  byId('edit-dictionary-type')?.addEventListener('click', () => openDictionaryTypeForm(selectedType));
  byId('delete-dictionary-type')?.addEventListener('click', () => deleteDictionaryType(selectedType));
  byId('new-dictionary-item')?.addEventListener('click', () => openDictionaryItemForm(selectedType, items, null));
  byId('new-dictionary-item-empty')?.addEventListener('click', () => openDictionaryItemForm(selectedType, items, null));
  document.querySelectorAll('.dictionary-item-child').forEach(button => button.onclick = () => openDictionaryItemForm(selectedType, items, null, Number(button.dataset.id)));
  document.querySelectorAll('.dictionary-item-edit').forEach(button => button.onclick = () => openDictionaryItemForm(selectedType, items, items.find(x => x.id === Number(button.dataset.id))));
  document.querySelectorAll('.dictionary-item-delete').forEach(button => button.onclick = () => deleteDictionaryItem(selectedType, items.find(x => x.id === Number(button.dataset.id))));
}

function openDictionaryTypeForm(dictionary) {
  const editing = Boolean(dictionary);
  const codeLocked = editing && (dictionary.isSystem || dictionary.itemCount > 0);
  const structureLocked = editing && (dictionary.isSystem || dictionary.itemCount > 0);
  const body = `<form id="dictionary-type-form"><div class="form-hint">系统级字典由系统初始化；管理员新增的字典统一为业务级。字典包含字典项后，Code 和结构将锁定。</div><div class="form-grid">
    <div class="field"><label>字典 Code *</label><input name="code" value="${esc(dictionary?.code || '')}" required maxlength="50" ${codeLocked ? 'readonly' : ''} placeholder="如 SOFTWARE_PACKAGE_TYPE"><small>仅支持大写字母、数字和下划线</small></div>
    <div class="field"><label>字典名称 *</label><input name="name" value="${esc(dictionary?.name || '')}" required maxlength="50"></div>
    <div class="field"><label>字典类型</label><input value="${dictionary?.isSystem ? '系统级' : '业务级'}" readonly></div>
    <div class="field"><label>字典结构 *</label><select name="structureMode" ${structureLocked ? 'disabled' : ''}><option value="FLAT" ${(dictionary?.structureMode || 'FLAT') === 'FLAT' ? 'selected' : ''}>平级结构</option><option value="TREE" ${dictionary?.structureMode === 'TREE' ? 'selected' : ''}>树形结构</option></select>${structureLocked ? '<small>系统字典或已有字典项时不可切换</small>' : ''}</div>
    <div class="field"><label>排序</label><input name="sortOrder" type="number" min="0" max="9999" value="${dictionary?.sortOrder ?? 10}"></div>
    <div class="field"><label>状态</label><select name="isEnabled" ${dictionary?.isSystem ? 'disabled' : ''}><option value="true" ${dictionary?.isEnabled !== false ? 'selected' : ''}>启用</option><option value="false" ${dictionary?.isEnabled === false ? 'selected' : ''}>停用</option></select>${dictionary?.isSystem ? '<small>系统级字典不可停用</small>' : ''}</div>
    <div class="field span-2"><label>字典描述</label><textarea name="description" maxlength="500" placeholder="说明业务用途及使用范围">${esc(dictionary?.description || '')}</textarea></div>
  </div></form>`;
  showModal(editing ? '编辑字典' : '新增业务字典', body, { submitText: editing ? '保存修改' : '新增字典', onSubmit: async close => {
    const form = byId('dictionary-type-form');
    if (!form.reportValidity()) throw new Error('请补全字典信息。');
    const payload = {
      code: form.elements.code.value.trim().toUpperCase().replace(/[-\s]+/g, '_'),
      name: form.elements.name.value.trim(), description: form.elements.description.value.trim(),
      structureMode: structureLocked ? dictionary.structureMode : form.elements.structureMode.value,
      sortOrder: Number(form.elements.sortOrder.value) || 0,
      isEnabled: dictionary?.isSystem ? true : form.elements.isEnabled.value === 'true'
    };
    const result = await api(editing ? `/internal/master-data/dictionaries/${dictionary.id}` : '/internal/master-data/dictionaries', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    close();
    if (!editing && result.id) {
      dictionaryManagementState.selectedId = result.id;
      dictionaryManagementState.filters = { keyword: '', type: '', structure: '', status: '' };
    }
    toast(result.message || (editing ? '字典已更新' : '字典已新增'));
    await renderDictionaryManagement();
  }});
}

function collectDescendantIds(items, id) {
  const result = new Set();
  const visit = parentId => items.filter(x => Number(x.parentItemId) === Number(parentId)).forEach(child => {
    if (result.has(child.id)) return;
    result.add(child.id); visit(child.id);
  });
  visit(id); return result;
}

function parentOptions(items, item, selectedParentId) {
  const excluded = item ? collectDescendantIds(items, item.id) : new Set();
  if (item) excluded.add(item.id);
  const rows = flattenDictionaryItems(items).filter(x => !excluded.has(x.item.id));
  return `<option value="">无（作为根节点）</option>${rows.map(({ item: candidate, depth }) => `<option value="${candidate.id}" ${Number(candidate.id) === Number(selectedParentId) ? 'selected' : ''}>${'　'.repeat(depth)}${esc(candidate.name)}（${esc(candidate.value)}）</option>`).join('')}`;
}

function openDictionaryItemForm(dictionary, items, item, defaultParentId = null) {
  const editing = Boolean(item);
  const valueLocked = editing && item.usageCount > 0;
  const scopeOptions = document.querySelectorAll('#dictionary-scope-filter option');
  const scopeField = dictionary.scopeMode === 'DELIVERABLE_TYPE'
    ? `<div class="field"><label>交付物类型作用域 *</label><select name="scopeValue" ${valueLocked ? 'disabled' : ''}>${[...scopeOptions].map(x => `<option value="${esc(x.value)}" ${x.value === (item?.scopeValue || dictionaryManagementState.scopeValue) ? 'selected' : ''}>${esc(x.textContent)}</option>`).join('')}</select></div>`
    : '<input type="hidden" name="scopeValue" value="">';
  const parentField = dictionary.structureMode === 'TREE'
    ? `<div class="field"><label>上级字典项</label><select name="parentItemId">${parentOptions(items, item, item?.parentItemId ?? defaultParentId)}</select></div>` : '';
  const body = `<form id="dictionary-item-form"><div class="form-hint">字典项值是稳定业务标识。被业务引用后不可修改其值和作用域；树形结构不能形成循环层级。</div><div class="form-grid">${scopeField}${parentField}
    <div class="field"><label>字典项值 *</label><input name="itemCode" value="${esc(item?.value || '')}" required maxlength="50" ${valueLocked ? 'readonly' : ''} placeholder="如 LIDAR、DRIVING"></div>
    <div class="field"><label>字典项名称 *</label><input name="itemName" value="${esc(item?.name || '')}" required maxlength="80"></div>
    <div class="field"><label>排序</label><input name="sortOrder" type="number" min="0" max="9999" value="${item?.sortOrder ?? 10}"></div>
    <div class="field span-2"><label>字典项描述</label><textarea name="description" maxlength="500" placeholder="补充字典项的业务含义">${esc(item?.description || '')}</textarea></div>
  </div></form>`;
  showModal(editing ? `编辑字典项 · ${dictionary.name}` : `新增字典项 · ${dictionary.name}`, body, { submitText: editing ? '保存修改' : '新增字典项', onSubmit: async close => {
    const form = byId('dictionary-item-form');
    if (!form.reportValidity()) throw new Error('请补全字典项信息。');
    const payload = {
      itemCode: form.elements.itemCode.value.trim().toUpperCase().replace(/[-\s]+/g, '_'),
      itemName: form.elements.itemName.value.trim(),
      scopeValue: dictionary.scopeMode === 'DELIVERABLE_TYPE' ? (valueLocked ? item.scopeValue : form.elements.scopeValue.value) : null,
      parentItemId: dictionary.structureMode === 'TREE' && form.elements.parentItemId.value ? Number(form.elements.parentItemId.value) : null,
      sortOrder: Number(form.elements.sortOrder.value) || 0,
      description: form.elements.description.value.trim() || null
    };
    const endpoint = editing ? `/internal/master-data/dictionaries/${encodeURIComponent(dictionary.code)}/items/${item.id}` : `/internal/master-data/dictionaries/${encodeURIComponent(dictionary.code)}/items`;
    const result = await api(endpoint, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    close(); toast(result.message || (editing ? '字典项已更新' : '字典项已新增'));
    if (dictionary.code === 'DELIVERABLE_CATEGORY') state.master = null;
    dictionaryManagementState.scopeValue = payload.scopeValue || '';
    await renderDictionaryManagement();
  }});
}

async function deleteDictionaryType(dictionary) {
  const result = await confirmAction('删除字典', `确认删除“${dictionary.name}（${dictionary.code}）”吗？仅没有字典项的业务级字典可以删除，此操作不可恢复。`, { submitText: '确认删除', danger: true });
  if (!result.confirmed) return;
  try {
    await api(`/internal/master-data/dictionaries/${dictionary.id}`, { method: 'DELETE' });
    dictionaryManagementState.selectedId = null; dictionaryManagementState.scopeValue = '';
    toast('字典已删除'); await renderDictionaryManagement();
  } catch (error) { toast(error.message, 'error'); }
}

async function deleteDictionaryItem(dictionary, item) {
  if (!item) return;
  const reason = item.childCount ? '该字典项仍有下级，系统将阻止删除。' : item.usageCount ? `该字典项已被 ${item.usageCount} 条业务数据引用，系统将阻止删除。` : '此操作不可恢复。';
  const result = await confirmAction('删除字典项', `确认删除“${item.name}（${item.value}）”吗？${reason}`, { submitText: '确认删除', danger: true });
  if (!result.confirmed) return;
  try {
    await api(`/internal/master-data/dictionaries/${encodeURIComponent(dictionary.code)}/items/${item.id}`, { method: 'DELETE' });
    if (dictionary.code === 'DELIVERABLE_CATEGORY') state.master = null;
    toast('字典项已删除'); await renderDictionaryManagement();
  } catch (error) { toast(error.message, 'error'); }
}
