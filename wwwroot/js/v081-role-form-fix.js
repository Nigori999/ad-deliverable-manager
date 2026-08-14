// V0.8.1 frontend regression fix: avoid duplicate DOM id between page button and modal form.
// Loaded after permissions-v08.js so the create-role flow uses a unique form id.
(function(){
  const originalOpenRoleV08Create = window.openRoleV08Create;
  if (typeof originalOpenRoleV08Create !== 'function') return;
  window.openRoleV08Create = function(){
    showModal('新建角色',`<form id="role-create-v081-form"><div class="field"><label>角色名称 *</label><input name="name" required placeholder="如：项目负责人"></div><div class="field"><label>角色编码 *</label><input name="code" required placeholder="如 PROJECT_OWNER"></div><div class="field"><label>说明</label><textarea name="description" placeholder="描述这个角色负责什么"></textarea></div></form>`,{submitText:'创建并继续配置',onSubmit:async close=>{const form=document.getElementById('role-create-v081-form');if(!form || form.tagName !== 'FORM') throw new Error('角色表单加载失败，请刷新页面后重试。');if(!form.reportValidity())throw new Error('请填写角色名称和角色编码。');const fd=new FormData(form);await api('/internal/roles',{method:'POST',body:JSON.stringify({name:fd.get('name'),code:fd.get('code'),description:fd.get('description'),isEnabled:true})});close();toast('角色已创建，请继续配置权限。');await renderRoles();}});
  };
})();
