function hasPermission(code){return state.auth?.user?.permissions?.includes(code)===true;}

/* V0.8.1 role management interaction layer.
 * Loaded after permissions-v08.js so dynamic role-page behavior is centralized here.
 */
(function(){
  function ensureDrawerStyle(){
    if(document.getElementById('v081-role-drawer-style'))return;
    const style=document.createElement('style');
    style.id='v081-role-drawer-style';
    style.textContent=`
      .v081-drawer-mask{position:fixed;inset:0;background:rgba(15,23,42,.24);z-index:1200;display:flex;justify-content:flex-end}
      .v081-drawer{width:min(520px,92vw);height:100%;background:#fff;box-shadow:-12px 0 32px rgba(15,23,42,.16);display:flex;flex-direction:column}
      .v081-drawer-head{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 22px;border-bottom:1px solid #e5e7eb}
      .v081-drawer-title{font-size:18px;font-weight:700;margin:0}.v081-drawer-subtitle{margin:6px 0 0;color:#64748b;font-size:13px}
      .v081-drawer-close{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#64748b}
      .v081-drawer-body{padding:20px 22px;overflow:auto;flex:1}
      .v081-detail-grid{display:grid;grid-template-columns:120px 1fr;gap:12px 16px;font-size:14px}.v081-detail-label{color:#64748b}.v081-detail-value{color:#0f172a;word-break:break-word}
      .v081-chip-list{display:flex;flex-wrap:wrap;gap:8px}.v081-chip{display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;background:#f1f5f9;color:#334155;font-size:12px}
      .v081-section{margin-top:22px}.v081-section h4{margin:0 0 10px;font-size:14px}.v081-empty{padding:28px 0;text-align:center;color:#94a3b8}
      .v081-user-table{width:100%;border-collapse:collapse}.v081-user-table th,.v081-user-table td{text-align:left;padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:13px}.v081-user-table th{color:#64748b;font-weight:600}
      .v081-role-users-link{border:0;background:none;padding:0;cursor:pointer;color:#2563eb;text-decoration:underline;text-underline-offset:2px;font:inherit}
    `;
    document.head.appendChild(style);
  }

  function closeDrawer(){const root=byId('drawer-root');if(root)root.replaceChildren();}
  function openDrawer(title,subtitle,body){
    ensureDrawerStyle();
    const root=byId('drawer-root');
    if(!root)return;
    root.innerHTML=`<div class="v081-drawer-mask"><aside class="v081-drawer" role="dialog" aria-modal="true"><div class="v081-drawer-head"><div><h3 class="v081-drawer-title">${esc(title)}</h3><p class="v081-drawer-subtitle">${esc(subtitle||'')}</p></div><button type="button" class="v081-drawer-close" aria-label="关闭">×</button></div><div class="v081-drawer-body">${body}</div></aside></div>`;
    const mask=root.querySelector('.v081-drawer-mask');
    root.querySelector('.v081-drawer-close').onclick=closeDrawer;
    mask.addEventListener('click',e=>{if(e.target===mask)closeDrawer();});
    const onKey=e=>{if(e.key==='Escape'){closeDrawer();document.removeEventListener('keydown',onKey);}};
    document.addEventListener('keydown',onKey);
  }

  async function openRoleDetailV081(id){
    try{
      const detail=await api(`/internal/roles/${id}`);
      const role=detail.role;
      const permissions=detail.permissions||[];
      const workflows=detail.workflowNodes||[];
      const scopes=detail.dataScopes||[];
      openDrawer('角色详情',role.name,`
        <div class="v081-detail-grid">
          <div class="v081-detail-label">角色名称</div><div class="v081-detail-value">${esc(role.name)}</div>
          <div class="v081-detail-label">角色编码</div><div class="v081-detail-value code">${esc(role.code)}</div>
          <div class="v081-detail-label">状态</div><div class="v081-detail-value">${role.isEnabled?'启用':'停用'}</div>
          <div class="v081-detail-label">角色类型</div><div class="v081-detail-value">${role.isSystemRole?'系统角色':'自定义角色'}</div>
          <div class="v081-detail-label">说明</div><div class="v081-detail-value">${esc(role.description||'—')}</div>
          <div class="v081-detail-label">版本修订</div><div class="v081-detail-value">${role.revision}</div>
        </div>
        <div class="v081-section"><h4>功能权限（${permissions.length}项）</h4><div class="v081-chip-list">${permissions.length?permissions.map(x=>`<span class="v081-chip">${esc(typeof permissionFriendly!=='undefined'?(permissionFriendly[x]||x):x)}</span>`).join(''):'<div class="v081-empty">未配置功能权限</div>'}</div></div>
        <div class="v081-section"><h4>流程节点（${workflows.length}项）</h4><div class="v081-chip-list">${workflows.length?workflows.map(x=>`<span class="v081-chip">${esc(typeof permissionWorkflowName==='function'?permissionWorkflowName(x):x)}</span>`).join(''):'<div class="v081-empty">未配置流程节点</div>'}</div></div>
        <div class="v081-section"><h4>数据范围（${scopes.length}项）</h4><div class="v081-chip-list">${scopes.length?scopes.map(x=>`<span class="v081-chip">${esc(`${x.dimension} / ${x.scopeType}${x.scopeValue?` / ${x.scopeValue}`:''}`)}</span>`).join(''):'<div class="v081-empty">未配置额外数据范围限制</div>'}</div></div>
      `);
    }catch(error){toast(`角色详情加载失败：${error.message}`,'error');}
  }

  async function openRoleUsersV081(id,name){
    try{
      const data=await api('/internal/users');
      const users=(data.items||[]).filter(x=>(x.roles||'').split('、').includes(name));
      const rows=users.map(x=>`<tr><td class="code">${esc(x.username)}</td><td>${esc(x.displayName)}</td><td>${x.isEnabled?'<span class="badge released">启用</span>':'<span class="badge deprecated">停用</span>'}</td></tr>`).join('');
      openDrawer('角色成员',`${name} · ${users.length}人`,rows?`<table class="v081-user-table"><thead><tr><th>用户名</th><th>名称</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="v081-empty">当前没有用户绑定该角色。</div>');
    }catch(error){toast(`角色用户加载失败：${error.message}`,'error');}
  }

  async function renderRolesV081(){
    setPage('角色权限','先定义角色，再分配功能权限、数据范围和流程节点');
    const data=await api('/internal/roles');
    content.innerHTML=`<section class="card"><div class="card-head"><div><h3>角色</h3><p class="muted section-note">角色是权限的集合，可按岗位、项目或职责组合。</p></div><button type="button" id="new-role-v081" class="btn btn-primary">+ 新建角色</button></div><div class="table-wrap"><table><thead><tr><th>角色名称</th><th>角色编码</th><th>说明</th><th>用户数</th><th>状态</th><th>操作</th></tr></thead><tbody>${data.items.map(r=>`<tr><td>${esc(r.name)} ${r.isSystemRole?'<span class="badge">系统</span>':''}</td><td class="code">${esc(r.code)}</td><td>${esc(r.description||'—')}</td><td><button type="button" class="v081-role-users-link" data-role-users="${r.id}" data-role-name="${esc(r.name)}">${r.userCount}</button></td><td>${r.isEnabled?'<span class="badge released">启用</span>':'<span class="badge deprecated">停用</span>'}</td><td><div class="inline-actions"><button type="button" class="btn btn-light btn-sm" data-role-config="${r.id}">配置权限</button><button type="button" class="btn btn-light btn-sm" data-role-detail="${r.id}">详情</button></div></td></tr>`).join('')}</tbody></table></div></section>`;
    byId('new-role-v081').onclick=()=>window.openRoleV08Create();
    const table=content.querySelector('table');
    if(table){
      table.addEventListener('click',async e=>{
        const config=e.target.closest('[data-role-config]');
        if(config){e.preventDefault();await window.openRoleV08Edit(Number(config.dataset.roleConfig));return;}
        const detail=e.target.closest('[data-role-detail]');
        if(detail){e.preventDefault();await openRoleDetailV081(Number(detail.dataset.roleDetail));return;}
        const users=e.target.closest('[data-role-users]');
        if(users){e.preventDefault();await openRoleUsersV081(Number(users.dataset.roleUsers),users.dataset.roleName||'');}
      });
    }
  }

  const originalCreate=window.openRoleV08Create;
  window.openRoleV08Create=async function(){
    showModal('新建角色',`<form id="role-create-v081-form"><div class="field"><label>角色名称 *</label><input name="name" required placeholder="如：项目负责人"></div><div class="field"><label>角色编码 *</label><input name="code" required placeholder="如 PROJECT_OWNER"></div><div class="field"><label>说明</label><textarea name="description" placeholder="描述这个角色负责什么"></textarea></div></form>`,{submitText:'创建并配置权限',onSubmit:async close=>{
      const form=byId('role-create-v081-form');if(!(form instanceof HTMLFormElement))throw new Error('角色表单加载失败，请刷新页面后重试。');if(!form.reportValidity())throw new Error('请填写角色名称和角色编码。');
      const fd=new FormData(form);const result=await api('/internal/roles',{method:'POST',body:JSON.stringify({name:fd.get('name'),code:fd.get('code'),description:fd.get('description'),isEnabled:true})});close();toast('角色已创建，请继续配置权限。');if(result?.id){await window.openRoleV08Edit(Number(result.id));}else{await renderRolesV081();}
    }});
  };
  window.renderRoles=renderRolesV081;
})();
