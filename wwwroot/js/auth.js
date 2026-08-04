async function initializeAuth() {
  try {
    const status = await api('/internal/auth/status');
    if (status.requiresBootstrap) return showBootstrapScreen();
    if (!status.authenticated) return showLoginScreen();
    completeLogin(status);
  } catch (error) {
    showLoginScreen(error.message);
  }
}

function showAuthCard(title, subtitle, fields, submitText, submitHandler, errorMessage = '') {
  appShell.classList.add('hidden');
  authRoot.innerHTML = `<div class="auth-screen"><div class="auth-card">
    <div class="auth-brand"><div class="brand-mark">AD</div><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></div>
    ${errorMessage ? `<div class="auth-error">${esc(errorMessage)}</div>` : ''}
    <form id="auth-form" class="auth-form">${fields}<button class="btn btn-primary auth-submit" type="submit">${esc(submitText)}</button></form>
  </div></div>`;
  byId('auth-form').onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('.auth-submit');
    button.disabled = true; button.textContent = '处理中…';
    try { await submitHandler(new FormData(event.currentTarget)); }
    catch (error) { showAuthCard(title, subtitle, fields, submitText, submitHandler, error.message); }
  };
}

function showBootstrapScreen(errorMessage = '') {
  showAuthCard('初始化管理员', '首次运行需要创建系统管理员账号。', `
    <div class="field"><label>用户名 *</label><input name="username" value="admin" required autocomplete="username"></div>
    <div class="field"><label>显示名称 *</label><input name="displayName" value="系统管理员" required></div>
    <div class="field"><label>密码 *</label><input name="password" type="password" required minlength="8" autocomplete="new-password"></div>
    <p class="form-hint">密码至少8位，并同时包含字母和数字。</p>`, '创建管理员', async form => {
      const result = await api('/internal/auth/bootstrap', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
      completeLogin({ authenticated: true, user: result.user });
    }, errorMessage);
}

function showLoginScreen(errorMessage = '') {
  showAuthCard('智驾中心交付物管理系统', '请使用系统账号登录。', `
    <div class="field"><label>用户名</label><input name="username" required autocomplete="username"></div>
    <div class="field"><label>密码</label><input name="password" type="password" required autocomplete="current-password"></div>
    <label class="check-line"><input name="rememberMe" type="checkbox" value="true">保持登录</label>`, '登录', async form => {
      const payload = Object.fromEntries(form); payload.rememberMe = form.get('rememberMe') === 'true';
      const result = await api('/internal/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      completeLogin({ authenticated: true, user: result.user });
    }, errorMessage);
}

function completeLogin(status) {
  state.auth = status;
  state.master = null;
  authRoot.replaceChildren();
  appShell.classList.remove('hidden');
  applyRoleUi();
  if (status.user.mustChangePassword) {
    setTimeout(() => openChangePassword(true), 100);
    return;
  }
  route();
}

async function logout() {
  try { await api('/internal/auth/logout', { method: 'POST' }); } catch { /* session may already be invalid */ }
  state.auth = null; state.master = null; showLoginScreen('已退出登录。');
}

function openChangePassword(forced = false) {
  const body = `<form id="password-form"><div class="form-grid one-column">
    <div class="field"><label>当前密码 *</label><input name="currentPassword" type="password" required></div>
    <div class="field"><label>新密码 *</label><input name="newPassword" type="password" required minlength="8"></div>
    <div class="field"><label>再次输入新密码 *</label><input name="confirmPassword" type="password" required minlength="8"></div>
  </div><p class="form-hint">新密码至少8位，并同时包含字母和数字。</p></form>`;
  showModal(forced ? '首次登录请修改密码' : '修改密码', body, { small: true, dismissible: !forced, submitText: '修改密码', onSubmit: async () => {
    const form = byId('password-form'); if (!form.reportValidity()) throw new Error('请完整填写密码。');
    const f = new FormData(form); if (f.get('newPassword') !== f.get('confirmPassword')) throw new Error('两次输入的新密码不一致。');
    const result = await api('/internal/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') }) });
    modalRoot.replaceChildren(); state.auth = null; showLoginScreen(result.message);
  }});
}
