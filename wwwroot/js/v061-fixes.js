function resetPageScrollV061() {
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
}

function showAuthCard(title, subtitle, fields, submitText, submitHandler, errorMessage = '') {
  appShell.classList.add('hidden');
  authRoot.classList.remove('hidden');
  authRoot.innerHTML = `<div class="auth-screen"><div class="auth-card">
    <div class="auth-brand"><div class="brand-mark">AD</div><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></div>
    ${errorMessage ? `<div class="auth-error">${esc(errorMessage)}</div>` : ''}
    <form id="auth-form" class="auth-form">${fields}<button class="btn btn-primary auth-submit" type="submit">${esc(submitText)}</button></form>
  </div></div>`;
  resetPageScrollV061();
  byId('auth-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('.auth-submit');
    button.disabled = true;
    button.textContent = '处理中…';
    try {
      await submitHandler(new FormData(event.currentTarget));
    } catch (error) {
      showAuthCard(title, subtitle, fields, submitText, submitHandler, error.message);
    }
  };
}

function completeLogin(status) {
  state.auth = status;
  state.master = null;
  authRoot.replaceChildren();
  authRoot.classList.add('hidden');
  appShell.classList.remove('hidden');
  applyRoleUi();
  resetPageScrollV061();
  requestAnimationFrame(resetPageScrollV061);
  if (status.user.mustChangePassword) {
    setTimeout(() => openChangePassword(true), 100);
    return;
  }
  route();
}

async function runVersionAction(deliverableId, versionId, action, button) {
  const configs = {
    'submit-review': { title: '提交审批', message: '提交后版本将进入审批中状态，由审批者执行发布或退回。', submitText: '提交审批' },
    'return-draft': { title: '退回修改', message: '确认将该版本退回草稿状态吗？', inputLabel: '退回原因', inputRequired: true, submitText: '确认退回' },
    release: { title: '审批并发布', message: '发布后该版本将成为当前有效版本，原当前版本自动标记为已替代。', inputLabel: '审批意见', inputRequired: true, submitText: '确认发布' },
    deprecate: { title: '废止版本', message: '废止后该版本将被标记为禁止继续使用。', inputLabel: '废止原因', inputRequired: true, submitText: '确认废止', danger: true }
  };
  const config = configs[action];
  if (!config) return;
  const result = await confirmAction(config.title, config.message, config);
  if (!result.confirmed) return;
  button.disabled = true;
  try {
    await api(`/internal/workflow/versions/${versionId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason: result.value || null })
    });
    toast('版本状态已更新');
    await renderDeliverableDetail(deliverableId);
  } catch (error) {
    button.disabled = false;
    toast(error.message, 'error');
  }
}

async function runChangeAction(button) {
  const id = Number(button.dataset.changeId);
  const action = button.dataset.changeAction;
  const config = {
    approve: ['批准变更', '确认批准该变更进入实施阶段吗？', '评审意见', true, '确认批准'],
    reject: ['驳回变更', '确认驳回该变更吗？', '驳回原因', true, '确认驳回'],
    start: ['开始实施', '确认将该变更标记为实施中吗？', '', false, '开始实施'],
    verify: ['提交验证', '确认实施已完成并提交验证吗？', '', false, '提交验证'],
    close: ['关闭变更', '确认验证通过并关闭该变更吗？', '验证结论', false, '确认关闭']
  }[action];
  if (!config) return;
  const [title, message, inputLabel, required, submitText] = config;
  const result = await confirmAction(title, message, {
    inputLabel,
    inputRequired: required,
    submitText,
    danger: action === 'reject'
  });
  if (!result.confirmed) return;
  button.disabled = true;
  try {
    await api(`/internal/workflow/changes/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ opinion: result.value || null })
    });
    toast('变更状态已更新');
    await renderChanges();
  } catch (error) {
    toast(error.message, 'error');
    button.disabled = false;
  }
}

async function renderUsers() {
  if (!hasRole('ADMIN')) return;
  setPage('用户与角色', '管理登录账号、角色权限和账号状态');
  const data = await api('/internal/users');
  content.innerHTML = `<section class="card"><div class="card-head"><div><h3>用户列表</h3><p class="muted section-note">管理员：全部权限；编辑者：录入与实施；审批者：审批与发布；查看者：只读和导出。</p></div><button type="button" id="new-user" class="btn btn-primary">+ 新增用户</button></div><div class="table-wrap">
    ${data.items.length ? `<table><thead><tr><th>用户名</th><th>显示名称</th><th>角色</th><th>状态</th><th>首次改密</th><th>最近登录</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${data.items.map(x => `<tr>
      <td class="code">${esc(x.username)}</td><td>${esc(x.displayName)}</td><td><span class="badge role-${x.roleCode.toLowerCase()}">${esc(x.roleName)}</span></td>
      <td>${x.isEnabled ? '<span class="badge released">启用</span>' : '<span class="badge deprecated">停用</span>'}</td>
      <td>${x.mustChangePassword ? '<span class="badge pending_assessment">是</span>' : '否'}</td><td>${esc(fmtDate(x.lastLoginAt))}</td><td>${esc(fmtDate(x.updatedAt))}</td>
      <td><div class="inline-actions"><button type="button" class="btn btn-light btn-sm edit-user" data-id="${x.id}">编辑</button><button type="button" class="btn btn-light btn-sm reset-password" data-id="${x.id}">重置密码</button>${x.id === state.auth.user.id ? '' : `<button type="button" class="btn btn-danger btn-sm delete-user" data-id="${x.id}">删除</button>`}</div></td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">暂无用户</div>'}
  </div></section>`;
  byId('new-user').onclick = () => openUserCreate(data.roles);
  document.querySelectorAll('.edit-user').forEach(btn => btn.onclick = () => openUserEdit(data.items.find(x => x.id === Number(btn.dataset.id)), data.roles));
  document.querySelectorAll('.reset-password').forEach(btn => btn.onclick = () => openResetPassword(data.items.find(x => x.id === Number(btn.dataset.id))));
  document.querySelectorAll('.delete-user').forEach(btn => btn.onclick = () => deleteUser(data.items.find(x => x.id === Number(btn.dataset.id))));
}

async function deleteUser(user) {
  const result = await confirmAction(
    '删除用户',
    `确认永久删除用户“${user.displayName}（${user.username}）”吗？该用户将立即无法登录。`,
    { inputLabel: '请输入用户名确认', inputRequired: true, submitText: '确认删除', danger: true }
  );
  if (!result.confirmed) return;
  if (result.value !== user.username) {
    toast('输入的用户名不一致，已取消删除。', 'error');
    return;
  }
  try {
    await api(`/internal/users/${user.id}`, { method: 'DELETE' });
    toast('用户已删除');
    await renderUsers();
  } catch (error) {
    toast(error.message, 'error');
  }
}
