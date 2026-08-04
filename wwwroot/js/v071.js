const formalBaselineStatusesV071 = new Set(['RELEASED', 'SUPERSEDED', 'DEPRECATED']);
const renderDeliverableDetailBeforeV071 = renderDeliverableDetail;

renderDeliverableDetail = async function (deliverableId) {
  await renderDeliverableDetailBeforeV071(deliverableId);
  await applyBaselineVersionPolicyV071(deliverableId);
};

async function applyBaselineVersionPolicyV071(deliverableId) {
  const data = await api(`/internal/deliverables/${deliverableId}`);
  const deliverable = data.deliverable;
  const versions = data.versions || [];
  const hasFormalBaseline = versions.some(version =>
    formalBaselineStatusesV071.has(version.status) || Boolean(version.releaseDate));
  const hasCurrentReleasedBaseline = versions.some(version =>
    version.isCurrent && version.status === 'RELEASED');
  const isAdministrator = hasRole('ADMIN');

  const title = document.querySelector('.detail-title');
  if (title && !document.querySelector('.baseline-policy-alert')) {
    const notice = document.createElement('div');
    notice.className = `alert baseline-policy-alert ${hasFormalBaseline ? 'baseline-formed' : 'baseline-forming'}`;
    notice.innerHTML = hasFormalBaseline
      ? `<strong>已形成正式基线：</strong>后续内容修改必须发起变更，经评估、实施、版本发布和验证后关闭。${isAdministrator ? '管理员仅可使用“补录版本”处理历史数据迁移或特殊纠错。' : ''}`
      : '<strong>尚未形成正式基线：</strong>当前可以直接新增迭代版本；首个版本正式发布后，后续修改必须通过变更流程。';
    title.insertAdjacentElement('afterend', notice);
  }

  if (!canEdit()) return;

  const actions = document.querySelector('.detail-title .inline-actions');
  if (!actions) return;

  let addVersionButton = byId('add-version');
  if (!addVersionButton && (!hasFormalBaseline || isAdministrator)) {
    addVersionButton = document.createElement('button');
    addVersionButton.type = 'button';
    addVersionButton.id = 'add-version';
    actions.prepend(addVersionButton);
  }

  if (!hasFormalBaseline) {
    if (addVersionButton) {
      addVersionButton.className = 'btn btn-primary';
      addVersionButton.textContent = '+ 新增迭代版本';
      addVersionButton.title = '用于正式基线形成前的草稿迭代和评审修改';
      addVersionButton.onclick = () => openVersionForm(deliverableId, deliverable.typeCode);
    }
    return;
  }

  let changeButton = byId('start-controlled-change');
  if (!changeButton) {
    changeButton = document.createElement('button');
    changeButton.type = 'button';
    changeButton.id = 'start-controlled-change';
    actions.prepend(changeButton);
  }
  changeButton.className = 'btn btn-primary';
  changeButton.textContent = '+ 发起变更';
  changeButton.disabled = !hasCurrentReleasedBaseline;
  changeButton.title = hasCurrentReleasedBaseline
    ? '基于当前正式版本发起受控变更'
    : '当前没有有效的已发布版本，无法发起变更';
  changeButton.onclick = hasCurrentReleasedBaseline
    ? () => openChangeFormV071(deliverableId, deliverable)
    : null;

  if (!isAdministrator) {
    addVersionButton?.remove();
    return;
  }

  if (addVersionButton) {
    addVersionButton.className = 'btn btn-light';
    addVersionButton.textContent = '+ 管理员补录版本';
    addVersionButton.title = '仅用于历史数据迁移或特殊纠错，不属于正常版本迭代流程';
    addVersionButton.onclick = async () => {
      const result = await confirmAction(
        '管理员补录版本',
        '该交付物已经形成正式基线。正常修改必须走变更流程；补录版本仅用于历史数据迁移或特殊纠错。确认继续吗？',
        { submitText: '继续补录', danger: true }
      );
      if (result.confirmed) openVersionForm(deliverableId, deliverable.typeCode);
    };
  }
}

async function openChangeFormV071(preselectedDeliverableId = null, preselectedDeliverable = null) {
  try {
    const list = await api('/internal/deliverables?page=1&pageSize=100');
    const eligible = (list.items || []).filter(item =>
      Boolean(item.currentVersion) && item.versionStatus === 'RELEASED');

    if (!eligible.length) {
      toast('当前没有已形成正式基线且仍有效的交付物，无法发起变更。', 'error');
      return;
    }

    const selectedId = Number(preselectedDeliverableId) || null;
    if (selectedId && !eligible.some(item => item.id === selectedId)) {
      toast('该交付物当前没有有效的已发布基线，无法发起变更。', 'error');
      return;
    }

    const deliverableOptions = selectedId
      ? `<option value="${selectedId}" selected>${esc(preselectedDeliverable?.code || '')} · ${esc(preselectedDeliverable?.name || '')}</option>`
      : `<option value="">请选择</option>${eligible.map(item => `<option value="${item.id}">${esc(item.code)} · ${esc(item.name)} · 当前版本 ${esc(item.currentVersion)}</option>`).join('')}`;

    const body = `<form id="change-form"><div class="alert">变更只能基于当前有效的已发布版本发起。提交后系统会自动锁定该版本作为“变更前版本”。</div><div class="form-grid">
      <div class="field span-2"><label>交付物 *</label><select name="deliverableId" required ${selectedId ? 'disabled' : ''}>${deliverableOptions}</select>${selectedId ? `<input type="hidden" name="deliverableId" value="${selectedId}">` : ''}</div>
      <div class="field"><label>变更类型</label><select name="changeType"><option value="CONTENT_CHANGE">内容变更</option><option value="VERSION_CHANGE">版本变更</option><option value="PATH_CHANGE">路径变更</option><option value="SECURITY_CHANGE">权限属性变更</option></select></div>
      <div class="field"><label>关联需求/问题编号</label><input name="relatedIssueCode"></div>
      <div class="field span-2"><label>变更原因 *</label><textarea name="changeReason" required></textarea></div>
      <div class="field span-2"><label>变更内容 *</label><textarea name="changeContent" required></textarea></div>
      <div class="field span-2"><label>影响范围</label><textarea name="impactScope"></textarea></div>
      <div class="field"><label>提出人</label><input value="${esc(operatorName())}" disabled></div>
      <div class="field"><label>责任人 *</label><input name="responsiblePerson" value="${esc(preselectedDeliverable?.responsiblePerson || '')}" required></div>
      <div class="field"><label>计划完成日期</label><input type="date" name="plannedCompletionDate"></div>
    </div></form>`;

    showModal('发起变更', body, {
      submitText: '提交变更',
      onSubmit: async close => {
        const form = byId('change-form');
        if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
        const formData = new FormData(form);
        const deliverableId = Number(formData.get('deliverableId'));
        await api('/internal/change-workflow', {
          method: 'POST',
          body: JSON.stringify({
            deliverableId,
            changeType: formData.get('changeType'),
            changeReason: formData.get('changeReason'),
            changeContent: formData.get('changeContent'),
            impactScope: formData.get('impactScope'),
            relatedIssueCode: formData.get('relatedIssueCode'),
            responsiblePerson: formData.get('responsiblePerson'),
            plannedCompletionDate: formData.get('plannedCompletionDate') || null
          })
        });
        close();
        toast('变更已发起并锁定当前正式版本');
        if (selectedId) await renderDeliverableDetail(selectedId);
        else await renderChanges();
      }
    });
  } catch (error) {
    toast(error.message, 'error');
  }
}

// 变更管理页的“发起变更”入口也统一使用基线筛选和新工作流接口。
openChangeForm = openChangeFormV071;
