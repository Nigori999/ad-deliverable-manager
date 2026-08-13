using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/roles")]
[Authorize]
[PermissionAuthorize(PermissionCatalog.RoleManage)]
public sealed class RolesController : ControllerBase
{
    private readonly PermissionRepository _roles;
    public RolesController(PermissionRepository roles)=>_roles=roles;

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)=>Ok(new { items=await _roles.ListRolesAsync(cancellationToken),permissions=await _roles.ListPermissionsAsync(cancellationToken),workflowNodes=PermissionCatalog.WorkflowNodes.Select(x=>new{code=x.Code,name=x.Name}) });

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id,CancellationToken cancellationToken){var x=await _roles.GetRoleAsync(id,cancellationToken);return x is null?NotFound(new{message="角色不存在。"}):Ok(x);}

    [HttpPost]
    public async Task<IActionResult> Create([FromBody]RoleCreateRequest request,CancellationToken cancellationToken){try{return Ok(new{id=await _roles.CreateRoleAsync(request,User.GetDisplayName(),cancellationToken),message="角色已创建。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}}

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id,[FromBody]RoleUpdateRequest request,CancellationToken cancellationToken){var ok=await _roles.UpdateRoleAsync(id,request,User.GetDisplayName(),cancellationToken);return ok?Ok(new{message="角色已更新。"}):Conflict(new{message="系统角色不能修改，或角色信息已被修改，请刷新后重试。"});}

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id,CancellationToken cancellationToken){try{await _roles.DeleteRoleAsync(id,User.GetDisplayName(),cancellationToken);return Ok(new{message="角色已删除。"});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}

    [HttpPut("{id:int}/policy")]
    public async Task<IActionResult> SavePolicy(int id,[FromBody]RolePermissionUpdateRequest request,CancellationToken cancellationToken){try{await _roles.SaveRolePolicyAsync(id,request,cancellationToken);return Ok(new{message="权限策略已保存。"});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
}
