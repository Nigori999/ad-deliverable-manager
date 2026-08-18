async function renderUsers(){
  setPage('用户管理','管理登录账号、角色绑定和账号状态');
  const data=await api('/internal/users');
  content.innerHTML=`<section class="card"><div class="card-head"><div><h3>用户</h3><p class="muted section-note">用户只绑定角色，具体功能权限和数据范围由角色决定。</p></div>${hasPermission('USER_CREATE')?'<button type="button" id="new-user" class="btn btn-primary" data-permission="USER_CREATE">+ 新增用户</button>':''}</div><div class="table-wrap">${data.items.length?`<table><thead><tr><th>用户名</th><th>显示名称</th><th>角色</th><th>状态</th><th>首次改密</th><th>最近登录</th><th>操作</th></tr></thead><tbody>${data.items.map(x=>`<tr><td class="code">${esc(x.username)}</td><td>${esc(x.displayName)}</td><td>${esc(x.roles||'未分配角色')}</td><td>${x.isEnabled?'<span class="badge released">启用</span>':'<span class="badge deprecated">停用</span>'}</td><td>${x.mustChangePassword?'是':'否'}</td><td>${esc(fmtDate(x.lastLoginAt))}</td><td><div class="inline-actions">${hasPermission('USER_EDIT')?`<button type="button" class="btn btn-light btn-sm" data-user-edit="${x.id}" data-permission="USER_EDIT">编辑</button>`:''}${hasPermission('USER_RESET_PASSWORD')?`<button type="button" class="btn btn-light btn-sm" data-user-reset="${x.id}" data-permission="USER_RESET_PASSWORD">重置密码</button>`:''}</div></td></tr>`).join('')}</tbody></table>`:'<div class="empty">暂无用户</div>'}</div></section>`;
  byId('new-user')?.addEventListener('click',()=>openUserCreate(data.roles||[]));
  content.querySelectorAll('[data-user-edit]').forEach(b=>b.onclick=()=>openUserEdit(data.items.find(x=>x.id===Number(b.dataset.userEdit)),data.roles||[]));
  content.querySelectorAll('[data-user-reset]').forEach(b=>b.onclick=()=>openResetPassword(data.items.find(x=>x.id===Number(b.dataset.userReset))));
}

function roleOptions(roles,selected=[]){return roles.filter(x=>x.isEnabled).map(x=>`<label class="field-check"><input type="checkbox" name="roleIds" value="${x.id}" ${selected.includes(x.id)?'checked':''}><span>${esc(x.name)}</span></label>`).join('');}

function openUserCreate(roles){
  const body=`<form id="user-form"><div class="form-grid"><div class="field"><label>用户名 *</label><input name="username" required minlength="3" maxlength="40"></div><div class="field"><label>显示名称 *</label><input name="displayName" required></div><div class="field"><label>初始密码 *</label><input name="password" type="password" required minlength="8"></div></div><div class="field"><label>角色 *</label><div class="field-check-grid">${roleOptions(roles)}</div></div><label class="check-line"><input type="checkbox" name="mustChangePassword" checked>首次登录必须修改密码</label></form>`;
  showModal('新增用户',body,{submitText:'创建用户',onSubmit:async close=>{const form=byId('user-form');if(!form.reportValidity())throw new Error('请补全用户信息。');const fd=new FormData(form);const roleIds=[...form.querySelectorAll('input[name="roleIds"]:checked')].map(x=>Number(x.value));if(!roleIds.length)throw new Error('请至少选择一个角色。');await api('/internal/users',{method:'POST',body:JSON.stringify({username:fd.get('username'),displayName:fd.get('displayName'),password:fd.get('password'),roleIds,mustChangePassword:fd.has('mustChangePassword')})});close();toast('用户已创建。');await renderUsers();}});
}

function openUserEdit(user,roles){
  const selected=[];const roleNames=new Set((user.roles||'').split('、'));roles.forEach(r=>{if(roleNames.has(r.name))selected.push(r.id);});
  const body=`<form id="user-edit-form"><div class="field"><label>用户名</label><input value="${esc(user.username)}" disabled></div><div class="field"><label>显示名称 *</label><input name="displayName" value="${esc(user.displayName)}" required></div><div class="field"><label>角色 *</label><div class="field-check-grid">${roleOptions(roles,selected)}</div></div><label class="check-line"><input type="checkbox" name="isEnabled" ${user.isEnabled?'checked':''}>账号启用</label></form>`;
  showModal('编辑用户',body,{submitText:'保存',onSubmit:async close=>{const form=byId('user-edit-form');if(!form.reportValidity())throw new Error('请填写显示名称。');const fd=new FormData(form);const roleIds=[...form.querySelectorAll('input[name="roleIds"]:checked')].map(x=>Number(x.value));if(!roleIds.length)throw new Error('请至少选择一个角色。');await api(`/internal/users/${user.id}`,{method:'PUT',body:JSON.stringify({displayName:fd.get('displayName'),roleIds,isEnabled:fd.has('isEnabled'),revision:user.revision})});close();toast('用户已更新。');await renderUsers();}});
}

function openResetPassword(user){
  const body=`<form id="reset-password-form"><p class="muted">为 <strong>${esc(user.displayName)}</strong>（${esc(user.username)}）设置新密码。</p><div class="field"><label>新密码 *</label><input type="password" name="newPassword" minlength="8" required></div><label class="check-line"><input type="checkbox" name="mustChangePassword" checked>下次登录必须修改密码</label></form>`;
  showModal('重置密码',body,{small:true,submitText:'确认重置',onSubmit:async close=>{const form=byId('reset-password-form');if(!form.reportValidity())throw new Error('请输入符合规则的新密码。');const fd=new FormData(form);await api(`/internal/users/${user.id}/reset-password`,{method:'POST',body:JSON.stringify({newPassword:fd.get('newPassword'),mustChangePassword:fd.has('mustChangePassword')})});close();toast('密码已重置。');await renderUsers();}});
}
