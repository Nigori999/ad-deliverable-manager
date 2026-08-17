/*
 * Permission/workflow regression fixes.
 * Loaded after the historical V0.7.x compatibility modules so the current
 * configurable permission model remains the final source of UI behavior.
 */

permissionFriendly.VERSION_SUPPLEMENT = '补录版本';

changeButtonsV070 = function (x) {
  const buttons = [];
  if (x.status === 'PENDING_ASSESSMENT' && hasPermission('CHANGE_APPROVE')) {
    buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-change-action="approve" data-change-id="${x.id}" data-permission="CHANGE_APPROVE">批准</button>`);
  }
  if (x.status === 'PENDING_ASSESSMENT' && hasPermission('CHANGE_REJECT')) {
    buttons.push(`<button type="button" class="btn btn-danger btn-sm" data-change-action="reject" data-change-id="${x.id}" data-permission="CHANGE_REJECT">驳回</button>`);
  }
  if (x.status === 'APPROVED' && hasPermission('CHANGE_START')) {
    buttons.push(`<button type="button" class="btn btn-light btn-sm" data-change-action="start" data-change-id="${x.id}" data-permission="CHANGE_START">开始实施</button>`);
  }
  if (x.status === 'IMPLEMENTING' && hasPermission('CHANGE_EDIT') && !x.toVersionId) {
    buttons.push(`<button type="button" class="btn btn-primary btn-sm create-change-version" data-change-id="${x.id}" data-permission="CHANGE_EDIT">创建变更版本</button>`);
  }
  if (x.status === 'IMPLEMENTING' && hasPermission('CHANGE_VERIFY') && x.toVersionId) {
    buttons.push(`<button type="button" class="btn btn-light btn-sm" data-change-action="verify" data-change-id="${x.id}" data-permission="CHANGE_VERIFY">提交验证</button>`);
  }
  if (x.status === 'PENDING_VERIFICATION' && hasPermission('CHANGE_CLOSE')) {
    buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-change-action="close" data-change-id="${x.id}" data-permission="CHANGE_CLOSE">确认关闭</button>`);
  }
  if (x.toVersionId) buttons.push(`<a class="btn btn-light btn-sm" href="#/deliverables/${x.deliverableId}">查看版本</a>`);
  return buttons.join('') || '<span class="muted">—</span>';
};

handleChangeActionV070 = async function (button, items) {
  const changeId = Number(button.dataset.changeId);
  const action = String(button.dataset.changeAction || '').trim().toLowerCase();
  const change = items.find(x => x.id === changeId);
  if (!change) {
    toast('变更记录不存在，请刷新后重试。', 'error');
    return;
  }

  const permissionByAction = {
    approve: 'CHANGE_APPROVE',
    reject: 'CHANGE_REJECT',
    start: 'CHANGE_START',
    verify: 'CHANGE_VERIFY',
    close: 'CHANGE_CLOSE'
  };
  const permission = permissionByAction[action];
  if (!permission || !hasPermission(permission)) {
    toast('当前角色没有执行该变更操作的权限。', 'error');
    return;
  }

  let opinion = '';
  if (action === 'approve' || action === 'reject') {
    const result = await promptActionOpinion(
      action === 'approve' ? '批准变更' : '驳回变更',
      action === 'approve' ? '请填写评审意见。' : '请填写驳回原因。'
    );
    if (!result.confirmed) return;
    opinion = result.value.trim();
    if (!opinion) {
      toast('评审意见不能为空。', 'error');
      return;
    }
  } else {
    const result = await confirmAction(
      action === 'start' ? '开始实施' : action === 'verify' ? '提交验证' : '确认关闭',
      `确定对 ${change.code} 执行“${button.textContent.trim()}”吗？`
    );
    if (!result.confirmed) return;
  }

  button.disabled = true;
  try {
    await api(`/internal/workflow/changes/${changeId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ opinion, toVersionId: change.toVersionId || null })
    });
    toast(action === 'approve' ? '变更已批准。' : action === 'reject' ? '变更已驳回。' : '变更状态已更新。');
    await renderChanges();
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
};

async function openSupplementVersionFormV100(deliverableId, typeCode) {
  if (!hasPermission('VERSION_SUPPLEMENT')) {
    toast('当前角色没有补录版本权限。', 'error');
    return;
  }

  const body = `<form id="version-form"><div class="form-grid">${commonVersionFields('v_')}</div><div id="type-specific-fields"></div></form>`;
  showModal('管理员补录版本', body, {
    submitText: '创建补录版本',
    onSubmit: async close => {
      const form = byId('version-form');
      if (!form.reportValidity()) throw new Error('请先填写所有必填字段。');
      const formData = new FormData(form);
      const payload = buildVersionPayload(formData, typeCode, 'v_');
      await api(`/internal/deliverables/${deliverableId}/versions/supplement`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      close();
      toast('补录版本已创建');
      await renderDeliverableDetail(deliverableId);
    }
  });
  renderTypeFields(typeCode);
}

const renderDeliverableDetailBeforeV100 = renderDeliverableDetail;
renderDeliverableDetail = async function (deliverableId) {
  await renderDeliverableDetailBeforeV100(deliverableId);
  await applySupplementVersionPolicyV100(deliverableId);
};

async function applySupplementVersionPolicyV100(deliverableId) {
  if (!hasPermission('VERSION_SUPPLEMENT')) return;

  const data = await api(`/internal/deliverables/${deliverableId}`);
  const deliverable = data.deliverable;
  const versions = data.versions || [];
  const hasFormalBaseline = versions.some(version =>
    ['RELEASED', 'SUPERSEDED', 'DEPRECATED'].includes(version.status) || Boolean(version.releaseDate));
  if (!hasFormalBaseline) return;

  const actions = document.querySelector('.detail-title .inline-actions');
  if (!actions) return;

  const openVersion = versions.find(version => version.status === 'DRAFT' || version.status === 'IN_REVIEW');
  let button = byId('supplement-version');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.id = 'supplement-version';
    button.className = 'btn btn-light';
    button.dataset.permission = 'VERSION_SUPPLEMENT';
    actions.append(button);
  }

  button.textContent = '+ 管理员补录版本';
  button.disabled = Boolean(openVersion);
  button.title = openVersion
    ? `当前版本 ${openVersion.internalVersion} 仍处于${statusNames[openVersion.status]}，完成当前审批流程后才能补录版本`
    : '仅用于历史数据迁移或特殊纠错；正常版本修改仍必须走变更流程';
  button.onclick = openVersion ? null : async () => {
    if (!hasPermission('VERSION_SUPPLEMENT')) {
      toast('当前角色没有补录版本权限。', 'error');
      return;
    }
    const result = await confirmAction(
      '管理员补录版本',
      '该交付物已经形成正式基线。正常修改必须走变更流程；补录版本仅用于历史数据迁移或特殊纠错。确认继续吗？',
      { submitText: '继续补录', danger: true }
    );
    if (result.confirmed) await openSupplementVersionFormV100(deliverableId, deliverable.typeCode);
  };

  const notice = document.querySelector('.baseline-policy-alert');
  if (notice && !notice.textContent.includes('补录版本')) {
    notice.insertAdjacentHTML('beforeend', ' 拥有“补录版本”权限的用户仅可将其用于历史数据迁移或特殊纠错。');
  }
}
