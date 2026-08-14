async function renderUsers() {
  if (!hasPermission('USER_MANAGE')) return;
  setPage('用户与角色', '管理登录账号、角色权限和账号状态');
  const data = await api('/internal/users');
  content.innerHTML = `<section class="card"><div class="card-head"><div><h3>用户列表</h3><p class="muted section-note">用户只负责绑定角色；具体能做什么由角色权限决定。</p></div><button type="button" id="new-user" class="btn btn-primary">+ 新增用户</button></div><div class="table-wrap">
    ${data.items.length ? `<table><thead><tr><th>用户名</th><th>显示名称</th><th>角色</th><th>状态</th><th>首次改密</th><th>最近登录</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${data.items.map(x => `<tr>
      <td class="code">${esc(x.username)}</td><td>${esc(x.displayName)}</td><td>${esc(x.roleName || x.roles || '—')}</td>
      <td>${x.isEnabled ? '<span class="badge released">启用</span>' : '<span class="badge deprecated">停用</span>'}</td>
      <td>${x.mustChangePassword ? '<span class="badge pending_assessment">是</span>' : '否'}</td><td>${esc(fmtDate(x.lastLoginAt))}</td><td>${esc(fmtDate(x.updatedAt))}</td>
      <td><div class="inline-actions"><button type="button" class="btn btn-light btn-sm edit-user" data-id="${x.id}">编辑</button><button type="button" class="btn btn-light btn-sm reset-password" data-id="${x.id}">重置密码</button></div></td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">暂无用户</div>'}
  </div></section>`;
  byId('new-user').onclick = () => openUserCreate(data.roles);
  document.querySelectorAll('.edit-user').forEach(btn => btn.onclick = () => openUserEdit(data.items.find(x => x.id === Number(btn.dataset.id)), data.roles));
  document.querySelectorAll('.reset-password').forEach(btn => btn.onclick = () => openResetPassword(data.items.find(x => x.id === Number(btn.dataset.id))));
}

function roleOptions(roles, selected = '') {
  return roles.map(x => `<option value="${x.code}" ${x.code === selected ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}

function openUserCreate(roles) {
  const body = `<form id="user-form"><div class="form-grid">
    <div class="field"><label>用户名 *</label><input name="username" required minlength="3" maxlength="40" placeholder="字母、数字、点、下划线或短横线"></div>
    <div class="field"><label>显示名称 *</label><input name="displayName" required></div>
    <div class="field"><label>初始密码 *</label><input name="password" type="password" required minlength="8" placeholder="至少8位，包含字母和数字"></div>
    <div class="field"><label>角色 *</label><select name="roleCode">${roleOptions(roles, 'VIEWER')}</select></div>
  </div></form>`;
  showModal('新增用户', body, { small: true, submitText: '创建用户', onSubmit: async close => {
    const form = byId('user-form'); if (!form.reportValidity()) throw new Error('请填写所有必填字段。');
    await api('/internal/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    close(); toast('用户已创建'); await renderUsers();
  }});
}

function openUserEdit(user, roles) {
  const body = `<form id="user-edit-form"><div class="form-grid">
    <div class="field"><label>用户名</label><input value="${esc(user.username)}" disabled></div>
    <div class="field"><label>显示名称 *</label><input name="displayName" value="${esc(user.displayName)}" required></div>
    <div class="field"><label>角色 *</label><select name="roleCode">${roleOptions(roles, user.roleCode)}</select></div>
    <label class="check-line field"><input type="checkbox" name="isEnabled" ${user.isEnabled ? 'checked' : ''}>账号启用</label>
  </div></form>`;
  showModal('编辑用户', body, { small: true, submitText: '保存', onSubmit: async close => {
    const form = byId('user-edit-form'); if (!form.reportValidity()) throw new Error('请填写显示名称。');
    const f = new FormData(form);
    await api(`/internal/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ displayName: f.get('displayName'), roleCode: f.get('roleCode'), isEnabled: f.has('isEnabled'), revision: user.revision }) });
    close(); toast('用户已更新'); await renderUsers();
  }});
}

function openResetPassword(user) {
  const body = `<form id="reset-password-form"><p class="muted">为 <strong>${esc(user.displayName)}</strong>（${esc(user.username)}）设置新密码。</p><div class="field"><label>新密码 *</label><input type="password" name="newPassword" minlength="8" required placeholder="至少8位，包含字母和数字"></div><label class="check-line"><input type="checkbox" name="mustChangePassword" checked>下次登录必须修改密码</label></form>`;
  showModal('重置密码', body, { small: true, submitText: '确认重置', onSubmit: async close => {
    const form = byId('reset-password-form'); if (!form.reportValidity()) throw new Error('请输入符合规则的新密码。');
    const f = new FormData(form);
    await api(`/internal/users/${user.id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword: f.get('newPassword'), mustChangePassword: f.has('mustChangePassword') }) });
    close(); toast('密码已重置'); await renderUsers();
  }});
}
