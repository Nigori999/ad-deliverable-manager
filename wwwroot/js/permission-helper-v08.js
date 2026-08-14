function hasPermission(code){return state.auth?.user?.permissions?.includes(code)===true;}

// V0.8.1 regression fix: permissions-v08.js previously reused the page button id
// "new-role-v08" for the modal form. getElementById() then returned the button,
// causing new FormData(button) to throw. Override the create-role flow with a
// uniquely named form id. This file is loaded after permissions-v08.js.
(function(){
  const original = window.openRoleV08Create;
  if (typeof original !== 'function') return;
  window.openRoleV08Create = function(){
    showModal('新建角色',`<form id="role-create-v081-form"><div class="field"><label>角色名称 *</label><input name="name" required placeholder="如：项目负责人"></div><div class="field"><label>角色编码 *</label><input name="code" required placeholder="如 PROJECT_OWNER"></div><div class="field"><label>说明</label><textarea name="description" placeholder="描述这个角色负责什么"></textarea></div></form>`,{
      submitText:'创建并继续配置',
      onSubmit:async close=>{
        const form=document.getElementById('role-create-v081-form');
        if (!(form instanceof HTMLFormElement)) throw new Error('角色表单加载失败，请刷新页面后重试。');
        if (!form.reportValidity()) throw new Error('请填写角色名称和角色编码。');
        const fd=new FormData(form);
        await api('/internal/roles',{method:'POST',body:JSON.stringify({name:fd.get('name'),code:fd.get('code'),description:fd.get('description'),isEnabled:true})});
        close();
        toast('角色已创建，请继续配置权限。');
        await renderRoles();
      }
    });
  };
})();
