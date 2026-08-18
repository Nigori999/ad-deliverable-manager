Object.assign(permissionFriendly, {
  DELIVERY_DELETE: '删除草稿交付物',
  VERSION_EDIT: '编辑草稿版本',
  VERSION_DELETE: '删除草稿版本',
  CHANGE_DRAFT_EDIT: '编辑待评估变更',
  CHANGE_DELETE: '删除待评估变更',
  BASELINE_DELETE: '删除产品基线草稿',
  USER_DELETE: '删除用户'
});

const uxOriginalRenderDeliverableDetail = renderDeliverableDetail;
renderDeliverableDetail = async function(id) {
  await uxOriginalRenderDeliverableDetail(id);
  try {
    const data = await api(`/internal/deliverables/${id}`);
    const versions = data.versions || [];

    document.querySelectorAll('.copy-version-path').forEach(button => {
      const path = button.dataset.path || '';
      const row = button.closest('tr');
      const cell = row?.children?.[4];
      if (cell && /^(https?:\/\/|file:\/\/)/i.test(path)) {
        cell.innerHTML = `<a href="${esc(path)}" target="_blank" rel="noopener noreferrer" class="path-link" title="${esc(path)}">${esc(path)}</a>`;
      }
    });

    document.querySelectorAll('.version-detail-btn').forEach(detailButton => {
      const versionId = Number(detailButton.dataset.versionId);
      const version = versions.find(v => v.id === versionId);
      if (!version || version.status !== 'DRAFT') return;
      const actions = detailButton.closest('.inline-actions');
      if (!actions) return;
      if (hasPermission('VERSION_EDIT') && !actions.querySelector(`[data-version-edit="${versionId}"]`)) {
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'btn btn-light btn-sm'; edit.dataset.versionEdit = String(versionId); edit.dataset.permission = 'VERSION_EDIT'; edit.textContent = '编辑';
        edit.onclick = () => openDraftVersionEditor(id, versionId);
        actions.insertBefore(edit, detailButton.nextSibling);
      }
      if (hasPermission('VERSION_DELETE') && versions.length > 1 && !actions.querySelector(`[data-version-delete="${versionId}"]`)) {
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'btn btn-danger btn-sm'; del.dataset.versionDelete = String(versionId); del.dataset.permission = 'VERSION_DELETE'; del.textContent = '删除';
        del.onclick = () => deleteDraftVersion(id, version);
        actions.appendChild(del);
      }
    });

    if (hasPermission('DELIVERY_DELETE')) {
      const canDelete = versions.length > 0 && versions.every(v => v.status === 'DRAFT');
      if (canDelete) {
        const actions = document.querySelector('.detail-title .inline-actions');
        if (actions && !actions.querySelector('[data-delete-draft-deliverable]')) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'btn btn-danger'; button.dataset.deleteDraftDeliverable = String(id); button.dataset.permission = 'DELIVERY_DELETE'; button.textContent = '删除草稿';
          button.title = '仅删除尚未进入审批、发布、变更或关联流程的草稿交付物';
          button.onclick = async () => {
            const result = await confirmAction('删除草稿交付物', `确认永久删除“${data.deliverable.name}”及其全部草稿版本吗？此操作不可恢复。`, { submitText: '确认删除', danger: true });
            if (!result.confirmed) return;
            try { await api(`/internal/draft-deletions/deliverables/${id}`, { method: 'DELETE' }); toast('草稿交付物已删除'); location.hash = '#/deliverables'; }
            catch (error) { toast(error.message, 'error'); }
          };
          actions.appendChild(button);
        }
      }
    }
  } catch (error) { console.warn('草稿CRUD增强加载失败', error); }
};

async function openDraftVersionEditor(deliverableId, versionId) {
  if (!hasPermission('VERSION_EDIT')) return toast('当前角色没有编辑草稿版本的权限。', 'error');
  const data = await api(`/internal/version-details/${versionId}`), c = data.common || {}, s = data.specific || {};
  if (c.status !== 'DRAFT') return toast('只有草稿版本可以编辑。', 'error');
  const body = `<form id="version-edit-form"><div class="alert">内部版本号由系统生成，草稿阶段可修改文件、人员、计划日期及类型专属信息。</div><div class="form-grid"><div class="field"><label>内部版本号</label><input name="internalVersion" value="${esc(c.internalVersion)}" readonly></div><div class="field"><label>原始/供应商版本号</label><input name="originalVersion" value="${esc(c.originalVersion || '')}"></div><div class="field"><label>原始文件名 *</label><input name="originalFileName" value="${esc(c.originalFileName || '')}" required></div><div class="field"><label>服务器文件路径 *</label><input name="serverPath" value="${esc(c.serverPath || '')}" required></div><div class="field"><label>编制人/提供人 *</label><input name="author" value="${esc(c.author || '')}" required></div><div class="field"><label>计划发布日期</label><input name="plannedReleaseDate" type="date" value="${esc((c.plannedReleaseDate || '').slice(0,10))}"></div><div class="field"><label>校验算法</label><select name="hashAlgorithm"><option value="">无</option><option value="SHA256" ${c.hashAlgorithm==='SHA256'?'selected':''}>SHA256</option><option value="MD5" ${c.hashAlgorithm==='MD5'?'selected':''}>MD5</option></select></div><div class="field"><label>校验值</label><input name="hashValue" value="${esc(c.hashValue || '')}"></div><div class="field span-2"><label>版本变更摘要</label><textarea name="changeSummary">${esc(c.changeSummary || '')}</textarea></div></div><div id="type-specific-fields"></div></form>`;
  showModal(`编辑草稿版本 · ${c.internalVersion}`, body, { submitText: '保存修改', onSubmit: async close => {
    const form = byId('version-edit-form'); if (!form.reportValidity()) throw new Error('请补全必填信息。');
    const payload = buildVersionPayload(new FormData(form), c.typeCode, '');
    await api(`/internal/version-details/${versionId}`, { method: 'PUT', body: JSON.stringify(payload) });
    close(); toast('草稿版本已更新'); await renderDeliverableDetail(deliverableId);
  }});
  renderTypeFields(c.typeCode);
  const map = c.typeCode === 'SWP' ? {'硬件型号':'hardwareModel','供应商':'supplierName','供应商零件号':'supplierPartNumber','内部零件号':'internalPartNumber','软件包类型':'softwarePackageType','适配硬件版本':'compatibleHardwareVersion','适配平台':'compatiblePlatform','刷写方式':'flashMethod','刷写工具':'flashTool','依赖版本':'dependencyDescription','Release Note路径':'releaseNotePath','刷写说明路径':'flashGuidePath','备注':'remark'} : c.typeCode === 'PRD' ? {'产品模块':'productModule','功能名称':'functionName','需求来源':'requirementSource','目标车型':'targetVehicle','目标产品版本':'targetProductVersion','目标节点':'targetMilestone','产品负责人':'productOwner','评审人':'reviewers','参考依据':'referenceBasis','范围内':'inScope','范围外':'outOfScope'} : c.typeCode === 'FR' ? {'所属系统':'systemName','所属子系统':'subsystemName','功能模块':'functionModule','上游PRD编码':'upstreamPrdCode','上游PRD版本':'upstreamPrdVersion','功能负责人':'functionOwner','系统负责人':'systemOwner','目标软件基线':'targetSoftwareBaseline','目标节点':'frTargetMilestone','接口影响':'interfaceImpact','安全等级':'safetyLevel'} : c.typeCode === 'TC' ? {'测试级别':'testLevel','测试模块':'testModule','上游FR编码':'upstreamFrCode','上游FR版本':'upstreamFrVersion','测试用例数量':'caseCount','覆盖范围':'coverageScope','测试环境':'testEnvironment','测试负责人':'testOwner','适用软件版本':'applicableSoftwareVersion','自动化用例数量':'automatedCaseCount','手工用例数量':'manualCaseCount'} : {};
  const form = byId('version-edit-form');
  Object.entries(map).forEach(([label,name]) => { const field=form.elements[name]; if(field && s[label] != null) field.value=s[label]; });
}

async function deleteDraftVersion(deliverableId, version) {
  const result = await confirmAction('删除草稿版本', `确认永久删除草稿版本“${version.internalVersion}”吗？此操作不可恢复。`, { submitText: '确认删除', danger: true });
  if (!result.confirmed) return;
  try { await api(`/internal/version-details/${version.id}`, { method: 'DELETE' }); toast('草稿版本已删除'); await renderDeliverableDetail(deliverableId); }
  catch (error) { toast(error.message, 'error'); }
}

const uxOriginalChangeActionButtons = changeActionButtons;
changeActionButtons = function(change) {
  let html = uxOriginalChangeActionButtons(change);
  if (change.status === 'PENDING_ASSESSMENT' && hasPermission('CHANGE_DRAFT_EDIT')) {
    const editButton = `<button type="button" class="btn btn-light btn-sm edit-change-draft" data-change-id="${change.id}" data-permission="CHANGE_DRAFT_EDIT">编辑</button>`;
    html = html.includes('<span class="muted">—</span>') ? editButton : html + editButton;
  }
  if (change.status === 'PENDING_ASSESSMENT' && hasPermission('CHANGE_DELETE')) {
    const deleteButton = `<button type="button" class="btn btn-danger btn-sm delete-change-draft" data-change-id="${change.id}" data-permission="CHANGE_DELETE">删除</button>`;
    html = html.includes('<span class="muted">—</span>') ? deleteButton : html + deleteButton;
  }
  return html;
};

const uxOriginalRenderChanges = renderChanges;
renderChanges = async function() {
  await uxOriginalRenderChanges();
  document.querySelectorAll('.edit-change-draft').forEach(button => button.onclick = async () => {
    const data = await api('/internal/change-workflow'); const change = (data.items || []).find(x => x.id === Number(button.dataset.changeId)); if (change) openPendingChangeEdit(change);
  });
  document.querySelectorAll('.delete-change-draft').forEach(button => button.onclick = async () => {
    const id = Number(button.dataset.changeId);
    const result = await confirmAction('删除待评估变更', '该变更尚未进入评审处理。确认永久删除这条初始变更记录吗？此操作不可恢复。', { submitText: '确认删除', danger: true });
    if (!result.confirmed) return; button.disabled = true;
    try { await api(`/internal/draft-deletions/changes/${id}`, { method: 'DELETE' }); toast('待评估变更已删除'); await renderChanges(); }
    catch (error) { button.disabled = false; toast(error.message, 'error'); }
  });
};

function openPendingChangeEdit(change) {
  if (!hasPermission('CHANGE_DRAFT_EDIT')) return toast('当前角色没有编辑待评估变更的权限。','error');
  const body=`<form id="change-edit-form"><div class="alert">仅待评估、且尚未生成变更版本的记录可以直接修改。</div><div class="form-grid"><div class="field"><label>变更编号</label><input value="${esc(change.code)}" disabled></div><div class="field"><label>交付物</label><input value="${esc(change.deliverableCode)} · ${esc(change.deliverableName)}" disabled></div><div class="field"><label>变更类型</label><select name="changeType">${Object.entries(changeTypeNames).map(([code,name])=>`<option value="${code}" ${change.changeType===code?'selected':''}>${esc(name)}</option>`).join('')}</select></div><div class="field"><label>关联需求/问题编号</label><input name="relatedIssueCode" value="${esc(change.relatedIssueCode || '')}"></div><div class="field span-2"><label>变更原因 *</label><textarea name="changeReason" required>${esc(change.reason)}</textarea></div><div class="field span-2"><label>变更内容 *</label><textarea name="changeContent" required>${esc(change.content)}</textarea></div><div class="field span-2"><label>影响范围</label><textarea name="impactScope">${esc(change.impactScope || '')}</textarea></div><div class="field"><label>责任人 *</label><input name="responsiblePerson" value="${esc(change.responsiblePerson)}" required></div><div class="field"><label>计划完成日期</label><input type="date" name="plannedCompletionDate" value="${esc((change.plannedCompletionDate || '').slice(0,10))}"></div></div></form>`;
  showModal(`编辑变更 · ${change.code}`,body,{submitText:'保存修改',onSubmit:async close=>{const form=byId('change-edit-form');if(!form.reportValidity())throw new Error('请补全必填信息。');const f=new FormData(form);await api(`/internal/change-workflow/${change.id}`,{method:'PUT',body:JSON.stringify({deliverableId:change.deliverableId,changeType:f.get('changeType'),changeReason:f.get('changeReason'),changeContent:f.get('changeContent'),impactScope:f.get('impactScope'),relatedIssueCode:f.get('relatedIssueCode'),responsiblePerson:f.get('responsiblePerson'),plannedCompletionDate:f.get('plannedCompletionDate')||null})});close();toast('待评估变更已更新');await renderChanges();}});
}

const uxOriginalRenderProductBaselines = renderProductBaselines;
renderProductBaselines = async function() {
  await uxOriginalRenderProductBaselines();
  if (!hasPermission('BASELINE_DELETE')) return;
  try {
    const data = await api('/internal/product-baselines');
    for (const baseline of data.items || []) {
      if (baseline.status !== 'DRAFT') continue;
      const anchor = document.querySelector(`[data-baseline-detail="${baseline.id}"]`) || document.querySelector(`[data-baseline-edit="${baseline.id}"]`);
      const actions = anchor?.closest('.inline-actions');
      if (!actions || actions.querySelector(`[data-baseline-delete="${baseline.id}"]`)) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-danger btn-sm'; button.dataset.baselineDelete = String(baseline.id); button.dataset.permission='BASELINE_DELETE'; button.textContent = '删除'; button.onclick = () => deleteBaselineDraft(baseline); actions.appendChild(button);
    }
  } catch (error) { toast(`草稿操作加载失败：${error.message}`, 'error'); }
};

async function deleteBaselineDraft(baseline) {
  const result = await confirmAction('删除产品基线草稿', `确认永久删除“${baseline.productName} ${baseline.version}”吗？草稿中的硬件配置和关联交付物快照也会一并删除。`, { submitText: '确认删除', danger: true });
  if (!result.confirmed) return;
  try { await api(`/internal/draft-deletions/product-baselines/${baseline.id}`, { method: 'DELETE' }); toast('产品基线草稿已删除'); await renderProductBaselines(); }
  catch (error) { toast(error.message, 'error'); }
}

baselineSoftwareOptions = function(options = [], category = '', selectedId = 0) {
  const list = options.filter(x => !category || String(x.hardwareCategory || '') === String(category));
  return list.map(x => `<option value="${x.id}" data-category="${baselineEsc(x.hardwareCategory || '')}" data-model="${baselineEsc(x.hardwareModel || '')}" ${Number(x.id) === Number(selectedId) ? 'selected' : ''}>${baselineEsc(x.name)} · ${baselineEsc(x.version)}${x.hardwareModel ? ` · ${baselineEsc(x.hardwareModel)}` : ''}</option>`).join('');
};

baselineDocumentSelect = function(role, versionId, options) {
  const expected = role === 'TEST_REPORT' ? 'TR' : role;
  const list = options.filter(x => x.typeCode === expected);
  return `<div class="field baseline-doc-field"><label>${baselineRoleNames[role] || role}</label><select name="doc_${role}"><option value="">未关联</option>${list.map(x => `<option value="${x.id}" ${Number(x.id) === Number(versionId) ? 'selected' : ''}>${baselineEsc(x.categoryName || '未分类')} · ${baselineEsc(x.name)} · ${baselineEsc(x.version)}</option>`).join('')}</select><small>可选，只展示已发布或已替代版本</small></div>`;
};

baselineHardwareRow = function(index, category = '', model = '', versionId = 0, options = []) {
  return `<div class="baseline-hardware-row" data-index="${index}"><div class="baseline-row-index">${index + 1}</div><div class="baseline-row-fields"><div class="field"><label>硬件类别 *</label><select name="hardwareCategory" required><option value="">请选择硬件类别</option>${baselineCategoryOptions(category)}</select></div><div class="field"><label>软件包版本 *</label><select name="softwareVersionId" required><option value="">${category ? '请选择对应软件包' : '请先选择硬件类别'}</option>${baselineSoftwareOptions(options, category, versionId)}</select></div><div class="field"><label>硬件型号</label><input name="hardwareModel" value="${baselineEsc(model)}" placeholder="选择软件包后可自动带出"></div></div><button type="button" class="btn btn-light btn-sm remove-baseline-hardware baseline-row-remove">移除</button></div>`;
};

baselineModalForm = function(detail, options) {
  const hardware = detail?.hardware || []; const docs = detail?.deliverables || []; const hardwareOptions = options.hardware || []; const documentOptions = options.documents || []; const selectedDocs = Object.fromEntries(docs.map(x => [x.roleCode, x.versionId]));
  const hardwareRows = hardware.length ? hardware.map((x, i) => baselineHardwareRow(i, x.hardwareCategory, x.hardwareModel, x.softwareVersionId, hardwareOptions)).join('') : baselineHardwareRow(0, '', '', 0, hardwareOptions); const version = detail?.baseline?.internalVersion || 'V1.0.0';
  return `<form id="baseline-form" class="baseline-form"><div class="baseline-form-intro"><div><span class="baseline-kicker">产品版本基线</span><strong>${baselineEsc(version)}</strong></div><p>按“产品信息 → 硬件软件包 → 关联交付物”完成基线快照。带 * 的项目为发布前必填。</p></div><section class="baseline-panel"><div class="baseline-panel-head"><div class="baseline-step">01</div><div><h4>产品与适用范围</h4><p>描述这个版本面向的车型、运行设计域和核心能力。</p></div></div><div class="baseline-panel-body"><div class="form-grid"><div class="field"><label>产品名称 *</label><input name="productName" value="${baselineEsc(detail?.baseline?.productName || '智驾产品')}" required maxlength="80"></div><div class="field"><label>产品版本</label><input value="${baselineEsc(version)}" readonly class="baseline-readonly"></div><div class="field span-2"><label>说明</label><textarea name="description" rows="2">${baselineEsc(detail?.baseline?.description || '')}</textarea></div><div class="field"><label>车型</label><input name="vehicleModels" value="${baselineEsc(detail?.baseline?.vehicleModels || '')}"></div><div class="field"><label>ODD</label><textarea name="odd" rows="3">${baselineEsc(detail?.baseline?.odd || '')}</textarea></div><div class="field span-2"><label>智驾能力</label><textarea name="capabilities" rows="3">${baselineEsc(detail?.baseline?.capabilities || '')}</textarea></div></div></div></section><section class="baseline-panel"><div class="baseline-panel-head"><div class="baseline-step">02</div><div><h4>硬件配置与软件包 *</h4><p>每个硬件类别只能配置一个软件包；切换类别后只显示该类别可用版本。</p></div><button type="button" class="btn btn-light btn-sm baseline-add" id="add-baseline-hardware">+ 添加硬件</button></div><div class="baseline-panel-body"><div id="baseline-hardware-list" class="baseline-hardware-list">${hardwareRows}</div></div></section><section class="baseline-panel"><div class="baseline-panel-head"><div class="baseline-step">03</div><div><h4>关联交付物</h4><p>用于形成完整产品快照，可按需关联 PRD、FR、测试用例和测试报告。</p></div></div><div class="baseline-panel-body"><div id="baseline-document-list" class="baseline-doc-grid">${baselineDocumentSelect('PRD', selectedDocs.PRD || 0, documentOptions)}${baselineDocumentSelect('FR', selectedDocs.FR || 0, documentOptions)}${baselineDocumentSelect('TC', selectedDocs.TC || 0, documentOptions)}${baselineDocumentSelect('TEST_REPORT', selectedDocs.TEST_REPORT || selectedDocs.TR || 0, documentOptions)}</div></div></section><input type="hidden" name="revision" value="${detail?.baseline?.revision || 1}"></form>`;
};

openBaselineDetail = async function(id) {
  const detail = await api(`/internal/product-baselines/${id}`); const b = detail.baseline; const hardwareCount = detail.hardware?.length || 0; const documentCount = detail.deliverables?.length || 0; const changes = detail.changes || [];
  const hardwareHtml = hardwareCount ? `<div class="baseline-detail-table"><table><thead><tr><th>类别</th><th>硬件型号</th><th>软件包</th><th>版本</th></tr></thead><tbody>${detail.hardware.map(x => `<tr><td><span class="baseline-category-chip">${baselineEsc(baselineCategoryName(x.hardwareCategory))}</span></td><td>${baselineEsc(x.hardwareModel || '—')}</td><td><strong>${baselineEsc(x.softwareName)}</strong></td><td class="code">${baselineEsc(x.softwareVersion)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="baseline-empty-compact">暂未配置硬件软件包</div>';
  const docsHtml = documentCount ? `<div class="baseline-detail-table"><table><thead><tr><th>交付物类型</th><th>名称</th><th>版本</th></tr></thead><tbody>${detail.deliverables.map(x => `<tr><td>${baselineEsc(baselineRoleNames[x.roleCode] || x.typeName)}</td><td><strong>${baselineEsc(x.name)}</strong></td><td class="code">${baselineEsc(x.version)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="baseline-empty-compact">未关联辅助交付物</div>';
  const changeHtml = changes.length ? `<div class="baseline-change-list">${changes.map(x => `<article><div><strong>${baselineEsc(x.changeReason)}</strong><span>${baselineEsc(fmtDate(x.createdAt))}</span></div><p>${baselineEsc(x.description || '无补充说明')}</p><small>操作人：${baselineEsc(x.operatorName)}</small></article>`).join('')}</div>` : '<div class="baseline-empty-compact">暂无基线变更记录</div>';
  const body = `<div class="baseline-detail-shell"><div class="baseline-detail-hero"><div><span class="baseline-kicker">${baselineEsc(b.productName)}</span><h2>${baselineEsc(b.internalVersion)}</h2><p>${baselineEsc(b.description || '暂无版本说明')}</p></div><div class="baseline-hero-status">${baselineStatusBadge(b.versionStatus)}</div></div><div class="baseline-summary-grid"><div><span>适用车型</span><strong>${baselineEsc(b.vehicleModels || '—')}</strong></div><div><span>硬件配置</span><strong>${hardwareCount} 项</strong></div><div><span>关联交付物</span><strong>${documentCount} 项</strong></div><div><span>发布时间</span><strong>${baselineEsc(b.releaseDate ? fmtDate(b.releaseDate) : '尚未发布')}</strong></div></div><section class="baseline-detail-section"><div class="baseline-detail-section-head"><h4>ODD 与智驾能力</h4><span>产品适用范围</span></div><div class="baseline-scope-grid"><div><span>ODD</span><p>${baselineEsc(b.odd || '—')}</p></div><div><span>智驾能力</span><p>${baselineEsc(b.capabilities || '—')}</p></div></div></section><section class="baseline-detail-section"><div class="baseline-detail-section-head"><h4>硬件及软件包</h4><span>${hardwareCount} 项配置</span></div>${hardwareHtml}</section><section class="baseline-detail-section"><div class="baseline-detail-section-head"><h4>关联交付物</h4><span>${documentCount} 项关联</span></div>${docsHtml}</section><section class="baseline-detail-section"><div class="baseline-detail-section-head"><h4>变更记录</h4><span>${changes.length} 条记录</span></div>${changeHtml}</section></div>`;
  showModal(`产品基线详情 · ${b.internalVersion}`, body, { submitText: '关闭', onSubmit: async close => close() });
};
