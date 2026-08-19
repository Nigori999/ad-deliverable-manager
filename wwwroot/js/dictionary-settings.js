let settingsDictionaryTypeId = null;
let settingsDictionaryScopeValue = '';

async function loadDictionarySettingsModel() {
  const typeData = await api('/internal/master-data/dictionaries');
  const types = typeData.items || [];
  if (!types.length) return { types: [], selectedType: null, items: [], scopeValue: '' };

  let selectedType = types.find(x => Number(x.id) === Number(settingsDictionaryTypeId)) || types[0];
  settingsDictionaryTypeId = selectedType.id;

  if (selectedType.scopeMode === 'DELIVERABLE_TYPE') {
    const validScopes = state.master.types || [];
    if (!settingsDictionaryScopeValue || !validScopes.some(x => x.code === settingsDictionaryScopeValue)) {
      settingsDictionaryScopeValue = validScopes[0]?.code || '';
    }
  } else {
    settingsDictionaryScopeValue = '';
  }

  const query = settingsDictionaryScopeValue ? `?scopeValue=${encodeURIComponent(settingsDictionaryScopeValue)}` : '';
  const itemData = await api(`/internal/master-data/dictionaries/${encodeURIComponent(selectedType.code)}${query}`);
  return { types, selectedType, items: itemData.items || [], scopeValue: settingsDictionaryScopeValue };
}

function dictionarySettingsMarkup(model) {
  const { types, selectedType, items, scopeValue } = model;
  const canCreate = hasPermission('MASTERDATA_CREATE');
  const canEdit = hasPermission('MASTERDATA_EDIT');
  const canDelete = hasPermission('MASTERDATA_DELETE');

  if (!types.length) {
    return `<section class="card dictionary-card"><div class="card-head"><div><h3>数据字典</h3><p class="muted section-note">集中维护系统中的枚举型业务配置。</p></div>${canCreate ? '<button type="button" id="new-dictionary-type" class="btn btn-primary btn-sm">+ 新增字典</button>' : ''}</div><div class="empty">暂无字典类型</div></section>`;
  }

  const scopeFilter = selectedType.scopeMode === 'DELIVERABLE_TYPE'
    ? `<div class="field dictionary-scope-filter"><label>交付物类型</label><select id="dictionary-scope-filter">${state.master.types.map(x => `<option value="${esc(x.code)}" ${x.code === scopeValue ? 'selected' : ''}>${esc(x.name)}（${esc(x.code)}）</option>`).join('')}</select></div>`
    : `<div class="dictionary-scope-summary"><span class="badge">全局字典</span><small>该字典不区分业务作用域</small></div>`;

  const scopeName = value => state.master.types.find(x => x.code === value)?.name || value || '全局';
  return `<section class="card dictionary-card" style="margin-bottom:18px">
    <div class="card-head dictionary-head"><div><h3>数据字典</h3><p class="muted section-note">用统一的“字典类型 → 字典项”模型维护枚举型业务配置。交付物类别已迁移为系统字典，后续可在这里扩展其他普通字典。</p></div><div class="inline-actions">${canCreate ? '<button type="button" id="new-dictionary-type" class="btn btn-light btn-sm">+ 新增字典</button>' : ''}${canCreate ? '<button type="button" id="new-dictionary-item" class="btn btn-primary btn-sm">+ 新增字典项</button>' : ''}</div></div>
    <div class="dictionary-layout">
      <aside class="dictionary-types-panel"><div class="dictionary-panel-title">字典类型 <span>${types.length}</span></div><div class="dictionary-type-list">${types.map(x => `<button type="button" class="dictionary-type-button ${x.id === selectedType.id ? 'active' : ''}" data-id="${x.id}"><strong>${esc(x.name)}</strong><small>${esc(x.code)}</small>${x.isSystem ? '<span class="badge">系统</span>' : ''}</button>`).join('')}</div></aside>
      <div class="dictionary-items-panel">
        <div class="dictionary-selected-head"><div><div class="dictionary-selected-title"><h4>${esc(selectedType.name)}</h4>${selectedType.isSystem ? '<span class="badge">系统字典</span>' : '<span class="badge active">业务字典</span>'}</div><p>${esc(selectedType.description || '暂无说明')}</p><div class="code">${esc(selectedType.code)}</div></div><div class="inline-actions">${canEdit ? '<button type="button" id="edit-dictionary-type" class="btn btn-light btn-sm">编辑字典</button>' : ''}${canDelete && !selectedType.isSystem ? '<button type="button" id="delete-dictionary-type" class="btn btn-danger btn-sm">删除字典</button>' : ''}</div></div>
        <div class="dictionary-toolbar">${scopeFilter}<div class="dictionary-toolbar-note">${selectedType.scopeMode === 'DELIVERABLE_TYPE' ? `当前显示：${esc(scopeName(scopeValue))} 下的字典项` : '字典项对全系统生效'}</div></div>
        <div class="table-wrap dictionary-table">${items.length ? `<table><thead><tr><th>字典项名称</th><th>字典项编码</th>${selectedType.scopeMode !== 'NONE' ? '<th>作用域</th>' : ''}<th>排序</th><th>备注</th><th>操作</th></tr></thead><tbody>${items.map(x => `<tr><td><strong>${esc(x.name)}</strong></td><td class="code">${esc(x.code)}</td>${selectedType.scopeMode !== 'NONE' ? `<td>${esc(scopeName(x.scopeValue))}</td>` : ''}<td>${x.sortOrder}</td><td class="muted">${esc(x.remark || '—')}</td><td><div class="inline-actions">${canEdit ? `<button type="button" class="btn btn-light btn-sm dictionary-item-edit" data-id="${x.id}">编辑</button>` : ''}${canDelete ? `<button type="button" class="btn btn-danger btn-sm dictionary-item-delete" data-id="${x.id}">删除</button>` : ''}</div></td></tr>`).join('')}</tbody></table>` : `<div class="empty">当前作用域暂无字典项。${canCreate ? '可点击“新增字典项”开始配置。' : ''}</div>`}</div>
      </div>
    </div>
  </section>`;
}

function bindDictionarySettings(model) {
  const { types, selectedType, items } = model;
  document.querySelectorAll('.dictionary-type-button').forEach(button => button.onclick = async () => {
    settingsDictionaryTypeId = Number(button.dataset.id);
    settingsDictionaryScopeValue = '';
    await renderSettings();
  });
  byId('dictionary-scope-filter')?.addEventListener('change', async event => {
    settingsDictionaryScopeValue = event.target.value;
    await renderSettings();
  });
  byId('new-dictionary-type')?.addEventListener('click', () => openDictionaryTypeForm(null));
  byId('edit-dictionary-type')?.addEventListener('click', () => openDictionaryTypeForm(selectedType));
  byId('delete-dictionary-type')?.addEventListener('click', () => deleteDictionaryType(selectedType));
  byId('new-dictionary-item')?.addEventListener('click', () => openDictionaryItemForm(selectedType, null));
  document.querySelectorAll('.dictionary-item-edit').forEach(button => button.onclick = () => openDictionaryItemForm(selectedType, items.find(x => x.id === Number(button.dataset.id))));
  document.querySelectorAll('.dictionary-item-delete').forEach(button => button.onclick = () => deleteDictionaryItem(selectedType, items.find(x => x.id === Number(button.dataset.id))));
}

function openDictionaryTypeForm(dictionary) {
  const editing = Boolean(dictionary);
  const systemLocked = editing && dictionary.isSystem;
  const body = `<form id="dictionary-type-form"><div class="form-hint">字典用于维护结构简单、相对稳定的枚举型业务配置。状态机、用户、角色、项目等复杂业务实体不建议字典化。</div><div class="form-grid"><div class="field"><label>字典编码 *</label><input name="code" value="${esc(dictionary?.code || '')}" required maxlength="50" ${systemLocked ? 'readonly' : ''} placeholder="如 SOFTWARE_PACKAGE_TYPE"></div><div class="field"><label>字典名称 *</label><input name="name" value="${esc(dictionary?.name || '')}" required maxlength="50" placeholder="如 软件包类型"></div><div class="field"><label>作用域模式 *</label><select name="scopeMode" ${systemLocked ? 'disabled' : ''}><option value="NONE" ${(dictionary?.scopeMode || 'NONE') === 'NONE' ? 'selected' : ''}>无作用域（全局）</option><option value="DELIVERABLE_TYPE" ${dictionary?.scopeMode === 'DELIVERABLE_TYPE' ? 'selected' : ''}>按交付物类型</option></select></div><div class="field"><label>排序</label><input name="sortOrder" type="number" min="0" max="9999" value="${dictionary?.sortOrder ?? 10}"></div><div class="field span-2"><label>字典说明</label><textarea name="description" placeholder="说明该字典的业务用途及使用范围">${esc(dictionary?.description || '')}</textarea></div></div></form>`;
  showModal(editing ? '编辑字典类型' : '新增字典类型', body, { submitText: editing ? '保存修改' : '新增字典', onSubmit: async close => {
    const form = byId('dictionary-type-form'); if (!form.reportValidity()) throw new Error('请补全字典类型信息。');
    const payload = { code: form.elements.code.value.trim().toUpperCase().replace(/[-\s]+/g, '_'), name: form.elements.name.value.trim(), description: form.elements.description.value.trim(), scopeMode: systemLocked ? dictionary.scopeMode : form.elements.scopeMode.value, sortOrder: Number(form.elements.sortOrder.value) || 0 };
    const result = await api(editing ? `/internal/master-data/dictionaries/${dictionary.id}` : '/internal/master-data/dictionaries', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    close(); toast(result.message || (editing ? '字典类型已更新' : '字典类型已新增'));
    if (!editing && result.id) settingsDictionaryTypeId = result.id;
    settingsDictionaryScopeValue = ''; await renderSettings();
  }});
}

function openDictionaryItemForm(dictionary, item) {
  const editing = Boolean(item);
  const scopeField = dictionary.scopeMode === 'DELIVERABLE_TYPE'
    ? `<div class="field"><label>交付物类型作用域 *</label><select name="scopeValue" required>${state.master.types.map(x => `<option value="${esc(x.code)}" ${x.code === (item?.scopeValue || settingsDictionaryScopeValue) ? 'selected' : ''}>${esc(x.name)}（${esc(x.code)}）</option>`).join('')}</select></div>`
    : '<input type="hidden" name="scopeValue" value="">';
  const body = `<form id="dictionary-item-form"><div class="form-hint">字典项编码是稳定业务标识。被业务数据使用后，编码和作用域将锁定，但名称、备注和排序仍可调整。</div><div class="form-grid">${scopeField}<div class="field"><label>字典项编码 *</label><input name="itemCode" value="${esc(item?.code || '')}" required maxlength="50" placeholder="如 LIDAR、DRIVING"></div><div class="field"><label>字典项名称 *</label><input name="itemName" value="${esc(item?.name || '')}" required maxlength="80" placeholder="如 激光雷达、行车"></div><div class="field"><label>排序</label><input name="sortOrder" type="number" min="0" max="9999" value="${item?.sortOrder ?? 10}"></div><div class="field span-2"><label>备注</label><textarea name="remark" placeholder="可选：补充该字典项的业务说明">${esc(item?.remark || '')}</textarea></div></div></form>`;
  showModal(editing ? `编辑字典项 · ${dictionary.name}` : `新增字典项 · ${dictionary.name}`, body, { submitText: editing ? '保存修改' : '新增字典项', onSubmit: async close => {
    const form = byId('dictionary-item-form'); if (!form.reportValidity()) throw new Error('请补全字典项信息。');
    const payload = { itemCode: form.elements.itemCode.value.trim().toUpperCase().replace(/[-\s]+/g, '_'), itemName: form.elements.itemName.value.trim(), scopeValue: form.elements.scopeValue.value || null, parentItemId: null, sortOrder: Number(form.elements.sortOrder.value) || 0, remark: form.elements.remark.value.trim() || null };
    const endpoint = editing ? `/internal/master-data/dictionaries/${encodeURIComponent(dictionary.code)}/items/${item.id}` : `/internal/master-data/dictionaries/${encodeURIComponent(dictionary.code)}/items`;
    const result = await api(endpoint, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    close(); toast(result.message || (editing ? '字典项已更新' : '字典项已新增'));
    if (dictionary.code === 'DELIVERABLE_CATEGORY') { state.master = null; await loadMaster(); }
    settingsDictionaryScopeValue = payload.scopeValue || ''; await renderSettings();
  }});
}

async function deleteDictionaryType(dictionary) {
  if (!dictionary || dictionary.isSystem) return;
  const result = await confirmAction('删除字典类型', `确认删除“${dictionary.name}（${dictionary.code}）”吗？仅空字典可以删除，此操作不可恢复。`, { submitText: '确认删除', danger: true });
  if (!result.confirmed) return;
  try { await api(`/internal/master-data/dictionaries/${dictionary.id}`, { method: 'DELETE' }); settingsDictionaryTypeId = null; settingsDictionaryScopeValue = ''; toast('字典类型已删除'); await renderSettings(); }
  catch (error) { toast(error.message, 'error'); }
}

async function deleteDictionaryItem(dictionary, item) {
  if (!dictionary || !item) return;
  const result = await confirmAction('删除字典项', `确认删除“${item.name}（${item.code}）”吗？如果已经被业务数据使用，系统会阻止删除。`, { submitText: '确认删除', danger: true });
  if (!result.confirmed) return;
  try {
    await api(`/internal/master-data/dictionaries/${encodeURIComponent(dictionary.code)}/items/${item.id}`, { method: 'DELETE' });
    if (dictionary.code === 'DELIVERABLE_CATEGORY') { state.master = null; await loadMaster(); }
    toast('字典项已删除'); await renderSettings();
  } catch (error) { toast(error.message, 'error'); }
}
