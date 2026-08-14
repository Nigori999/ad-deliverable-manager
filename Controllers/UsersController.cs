using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/users")]
[Authorize]
[PermissionAuthorize(PermissionCatalog.UserManage)]
public sealed class UsersController : ControllerBase
{
    private readonly PermissionUserRepository _users;
    private readonly PermissionRepository _roles;
    private readonly UserRepository _authUsers;
    private readonly DatabaseService _database;

    public UsersController(PermissionUserRepository users, PermissionRepository roles, UserRepository authUsers, DatabaseService database)
    { _users=users; _roles=roles; _authUsers=authUsers; _database=database; }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(new { items=await _users.ListAsync(ct), roles=await _roles.ListRolesAsync(ct) });

    [HttpGet("roles")]
    public async Task<IActionResult> Roles(CancellationToken ct) => Ok(new { items=await _roles.ListRolesAsync(ct) });

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] UserCreateRequest request, CancellationToken ct)
    { try { var id=await _users.CreateAsync(request,User.GetDisplayName(),ct); return Ok(new { id, message="用户已创建，请确认角色和权限范围后再通知用户登录。" }); } catch(ArgumentException ex){return BadRequest(new{message=ex.Message});} catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});} }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id,[FromBody] UserUpdateRequest request,CancellationToken ct)
    { try { var ok=await _users.UpdateAsync(id,request,User.GetUserId(),User.GetDisplayName(),ct); return ok?Ok(new{message="用户已更新。"}):Conflict(new{message="用户信息已发生变化，请刷新后重试。"}); } catch(ArgumentException ex){return BadRequest(new{message=ex.Message});} catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});} }

    [HttpPost("{id:int}/reset-password")]
    public async Task<IActionResult> ResetPassword(int id,[FromBody] UserResetPasswordRequest request,CancellationToken ct)
    { try { await _authUsers.ResetPasswordAsync(id,request,User.GetDisplayName(),ct); return Ok(new{message="密码已重置。"}); } catch(ArgumentException ex){return BadRequest(new{message=ex.Message});} catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});} }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id,CancellationToken ct)
    {
        if(id==User.GetUserId()) return Conflict(new{message="不能删除当前登录账号。"});
        await using var c=await _database.OpenConnectionAsync(ct);using var tx=c.BeginTransaction();
        await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT Username,DisplayName FROM Users WHERE Id=$id";q.Parameters.AddWithValue("$id",id);await using var r=await q.ExecuteReaderAsync(ct);
        if(!await r.ReadAsync(ct)) return NotFound(new{message="用户不存在。"});
        var username=r.GetString(0);var display=r.GetString(1);await r.DisposeAsync();
        await using var guard=c.CreateCommand();guard.Transaction=tx;guard.CommandText="SELECT COUNT(*) FROM UserRoles ur JOIN Roles role ON role.Id=ur.RoleId WHERE role.Code='SYSTEM_ADMIN' AND role.IsEnabled=1 AND ur.UserId=$id";guard.Parameters.AddWithValue("$id",id);
        if(Convert.ToInt32(await guard.ExecuteScalarAsync(ct))>0){await using var count=c.CreateCommand();count.Transaction=tx;count.CommandText="SELECT COUNT(*) FROM UserRoles ur JOIN Roles role ON role.Id=ur.RoleId JOIN Users u ON u.Id=ur.UserId WHERE role.Code='SYSTEM_ADMIN' AND role.IsEnabled=1 AND u.IsEnabled=1";if(Convert.ToInt32(await count.ExecuteScalarAsync(ct))<=1)return Conflict(new{message="系统必须至少保留一个启用的系统管理员。"});}
        await using var d=c.CreateCommand();d.Transaction=tx;d.CommandText="DELETE FROM Users WHERE Id=$id";d.Parameters.AddWithValue("$id",id);await d.ExecuteNonQueryAsync(ct);
        await using var a=c.CreateCommand();a.Transaction=tx;a.CommandText="INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES('User',$id,'DELETE_USER',$operator,$summary,$now)";a.Parameters.AddWithValue("$id",id);a.Parameters.AddWithValue("$operator",User.GetDisplayName());a.Parameters.AddWithValue("$summary",$"删除用户 {display}（{username}）");a.Parameters.AddWithValue("$now",DateTime.UtcNow.ToString("O"));await a.ExecuteNonQueryAsync(ct);await tx.CommitAsync(ct);return Ok(new{message="用户已删除。"});
    }

    [HttpPut("{id:int}/roles")]
    public async Task<IActionResult> AssignRoles(int id,[FromBody]int[] roleIds,CancellationToken ct){if(id<=0||roleIds.Length==0)return BadRequest(new{message="至少需要保留一个角色。"});if(await _authUsers.FindByIdAsync(id,ct)==null)return NotFound(new{message="用户不存在。"});await _roles.AssignRolesAsync(id,roleIds,ct);return Ok(new{message="角色已更新。"});}
}
