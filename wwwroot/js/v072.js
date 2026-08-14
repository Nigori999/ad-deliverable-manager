statusNames.READY_FOR_RELEASE = '待发布';

let versionContextV072 = { deliverableId: null, versions: [], highestVersionId: null };

function parseVersionV072(value) {
  const match = /^V?(\d+)\.(\d+)\.(\d+)$/i.exec(String(value || '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersionV072(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function highestVersionIdV072(versions) {
  let highest = null;
  for (const version of versions || []) {
    const parsed = parseVersionV072(version.internalVersion);
    if (!parsed) continue;
    if (!highest || compareVersionV072(parsed, highest.parsed) > 0) highest = { id: version.id, parsed };
  }
  return highest?.id ?? null;
}

function versionActionButtons(v) {
  if (v.status === 'DRAFT' && hasPermission('VERSION_SUBMIT')) {
    return `<button type="button" class="btn btn-light btn-sm" data-version-action="submit-review" data-version-id="${v.id}">提交审批</button>`;
  }
  if (v.status === 'IN_REVIEW' && (hasPermission('VERSION_RETURN') || hasPermission('VERSION_APPROVE'))) {
    const buttons = [];
    if (hasPermission('VERSION_RETURN')) buttons.push(`<button type="button" class="btn btn-light btn-sm" data-version-action="return-draft" data-version-id="${v.id}">退回修改</button>`);
    if (hasPermission('VERSION_APPROVE')) buttons.push(`<button type="button" class="btn btn-primary btn-sm" data-version-action="approve" data-version-id="${v.id}">审批通过</button>`);
    return buttons.join('');
  }
  if (v.status === 'READY_FOR_RELEASE' && (hasPermission('VERSION_RELEASE') || hasPermission('VERSION_DEPRECATE'))) {
    const isHighest = Number(v.id) === Number(versionContextV072.highestVersionId);
    const buttons = [];
    if (hasPermission('VERSION_RELEASE')) {
      buttons.push(isHighest
        ? `<button type="button" class="btn btn-primary btn-sm" data-version-action="release" data-version-id="${v.id}">正式发布</button>`
        : '<button type="button" class="btn btn-light btn-sm" disabled title="已存在更高版本，本版本不能正式发布">不可发布</button>');
    }
    if (hasPermission('VERSION_DEPRECATE')) buttons.push(`<button type="button" class="btn btn-danger btn-sm" data-version-action="deprecate" data-version-id="${v.id}">废止</button>`);
    return buttons.join('');
  }
  if ((v.status === 'RELEASED' || v.status === 'SUPERSEDED') && hasPermission('VERSION_DEPRECATE')) {
    return `<button type="button" class="btn btn-danger btn-sm" data-version-action="deprecate" data-version-id="${v.id}">废止</button>`;
  }
  return '';
}

async function runVersionAction(deliverableId, versionId, action, button) {
  const configs = {
    'submit-review': { title: '提交审批', message: '提交后版本进入审批中。审批通过后只进入待发布状态，不会自动成为当前版本。', submitText: '提交审批' },
    'return-draft': { title: '退回修改', message: '确认将该版本退回草稿状态吗？退回后仍不能创建后续版本，需先完成本版本审批。', inputLabel: '退回原因', inputRequired: true, submitText: '确认退回' },
    approve: { title: '审批通过', message: '审批通过后版本进入待发布状态。此时可以创建后续迭代版本，但只有最高版本可以正式发布。', inputLabel: '审批意见', inputRequired: true, submitText: '确认通过' },
    release: { title: '正式发布', message: '系统将再次校验该版本是否为最高版本。发布后将形成正式基线，后续修改必须走变更流程。', inputLabel: '发布说明', inputRequired: true, submitText: '确认发布' },
    deprecate: { title: '废止版本', message: '废止后该版本不能再正式发布或继续使用，审批及历史记录仍会保留。', inputLabel: '废止原因', inputRequired: true, submitText: '确认废止', danger: true }
  };
  const config = configs[action];
  if (!config) return;
  const requiredPermission = { 'submit-review': 'VERSION_SUBMIT', 'return-draft': 'VERSION_RETURN', approve: 'VERSION_APPROVE', release: 'VERSION_RELEASE', deprecate: 'VERSION_DEPRECATE' }[action];
  if (!requiredPermission || !hasPermission(requiredPermission)) { toast('当前角色没有该操作权限。', 'error'); return; }
  const result = await confirmAction(config.title, config.message, config);
  if (!result.confirmed) return;
  button.disabled = true;
  try {
    await api(`/internal/workflow/versions/${versionId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason: result.value || null })
    });
    toast(action === 'approve' ? '版本审批已通过，当前处于待发布状态' : '版本状态已更新');
    await renderDeliverableDetail(deliverableId);
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
}

const renderDeliverableDetailBeforeV072 = renderDeliverableDetail;
renderDeliverableDetail = async function (deliverableId) {
  const snapshot = await api(`/internal/deliverables/${deliverableId}`);
  const versions = snapshot.versions || [];
  versionContextV072 = {
    deliverableId,
    versions,
    highestVersionId: highestVersionIdV072(versions)
  };
  await renderDeliverableDetailBeforeV072(deliverableId);
  applyVersionFlowPolicyV072(snapshot);
};

function applyVersionFlowPolicyV072(data) {
  const deliverable = data.deliverable;
  const versions = data.versions || [];
  const hasFormalBaseline = versions.some(version =>
    version.status === 'RELEASED' || version.status === 'SUPERSEDED' || Boolean(version.releaseDate));
  const openVersion = versions.find(version => version.status === 'DRAFT' || version.status === 'IN_REVIEW');
  const readyVersions = versions.filter(version => version.status === 'READY_FOR_RELEASE');
  const actions = document.querySelector('.detail-title .inline-actions');
  const notice = document.querySelector('.baseline-policy-alert');
  const isAdministrator = hasPermission('USER_MANAGE');

  if (!actions || !hasPermission('VERSION_CREATE')) return;

  if (!hasFormalBaseline) {
    byId('start-controlled-change')?.remove();
    let addButton = byId('add-version');
    if (!addButton) {
      addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.id = 'add-version';
      actions.prepend(addButton);
    }
    addButton.className = 'btn btn-primary';
    addButton.textContent = '+ 新增迭代版本';
    addButton.disabled = Boolean(openVersion);
    addButton.onclick = openVersion ? null : () => openVersionForm(deliverable.id, deliverable.typeCode);
    addButton.title = openVersion
      ? `当前版本 ${openVersion.internalVersion} 仍处于${statusNames[openVersion.status]}，审批完成前不能创建后续版本`
      : '当前没有草稿或审批中版本，可以创建后续迭代版本';

    if (notice) {
      notice.className = `alert baseline-policy-alert ${openVersion ? 'version-cycle-open' : 'baseline-forming'}`;
      if (openVersion) {
        notice.innerHTML = `<strong>版本流程进行中：</strong>${esc(openVersion.internalVersion)} 当前为“${esc(statusNames[openVersion.status])}”，审批完成前不能创建后续版本。`;
      } else if (readyVersions.length) {
        notice.innerHTML = '<strong>审批已完成、尚未发布：</strong>可以继续创建后续迭代版本；最终只有版本号最高且处于待发布状态的版本可以正式发布。';
      } else {
        notice.innerHTML = '<strong>尚未形成正式基线：</strong>当前可以创建迭代版本；草稿或审批中阶段只能存在一个版本。';
      }
    }
    return;
  }

  if (isAdministrator) {
    const adminButton = byId('add-version');
    if (adminButton) {
      adminButton.disabled = Boolean(openVersion);
      if (openVersion) {
        adminButton.onclick = null;
        adminButton.title = `当前版本 ${openVersion.internalVersion} 尚未完成审批，管理员也不能继续补录版本`;
      }
    }
  }
}
