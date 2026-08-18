route = async function() {
  if (!state.auth?.authenticated) return;
  try {
    const path = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [routeName, id] = path.split('/');
    const routePermissions = {
      dashboard: 'DASHBOARD_VIEW',
      deliverables: 'DELIVERY_VIEW',
      'product-baselines': 'BASELINE_VIEW',
      changes: 'CHANGE_VIEW',
      analytics: 'ANALYTICS_VIEW',
      users: 'USER_VIEW',
      roles: 'ROLE_VIEW',
      settings: 'MASTERDATA_VIEW'
    };
    const required = routePermissions[routeName];
    if (required && !hasPermission(required)) {
      if (hasPermission('DASHBOARD_VIEW') && routeName !== 'dashboard') location.hash = '#/dashboard';
      else {
        state.route = 'forbidden';
        content.innerHTML = '<div class="card"><div class="empty">当前账号没有访问该页面的权限。</div></div>';
        setPage('无权限', '当前账号没有访问该页面的权限');
      }
      return;
    }

    const referencePermission = {
      deliverables: 'DELIVERY_VIEW',
      'product-baselines': 'BASELINE_VIEW',
      changes: 'CHANGE_VIEW',
      settings: 'MASTERDATA_VIEW'
    }[routeName];
    if (referencePermission) await loadMaster(referencePermission);

    state.route = routeName;
    content.innerHTML = '<div class="loading">正在加载…</div>';
    if (routeName === 'dashboard') return renderDashboard();
    if (routeName === 'deliverables' && id) return renderDeliverableDetail(Number(id));
    if (routeName === 'deliverables') return renderDeliverables();
    if (routeName === 'product-baselines') return renderProductBaselines();
    if (routeName === 'changes') return renderChanges();
    if (routeName === 'analytics') return renderAnalytics();
    if (routeName === 'users') return renderUsers();
    if (routeName === 'roles') return renderRoles();
    if (routeName === 'settings') return renderSettings();
    if (hasPermission('DASHBOARD_VIEW')) location.hash = '#/dashboard';
  } catch (error) {
    content.innerHTML = `<div class="card"><div class="empty">页面加载失败：${esc(error.message)}</div></div>`;
    toast(error.message, 'error');
  }
};
