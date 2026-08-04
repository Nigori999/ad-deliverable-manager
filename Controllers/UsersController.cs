using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/users")]
[Authorize(Roles = AppRoles.Admin)]
public sealed class UsersController : ControllerBase
{
    private readonly UserRepository _users;
    private readonly DatabaseService _database;

    public UsersController(UserRepository users, DatabaseService database)
    {
        _users = users;
        _database = database;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken) =>
        Ok(new { items = await _users.ListAsync(cancellationToken), roles = AppRoles.All.Select(x => new { code = x, name = AppRoles.DisplayName(x) }) });

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] UserCreateRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var id = await _users.CreateAsync(request, User.GetDisplayName(), cancellationToken);
            return Ok(new { id, message = "用户已创建。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UserUpdateRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var updated = await _users.UpdateAsync(id, request, User.GetUserId(), User.GetDisplayName(), cancellationToken);
            return updated ? Ok(new { message = "用户已更新。" }) : Conflict(new { message = "数据已被修改，请刷新后重试。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpPost("{id:int}/reset-password")]
    public async Task<IActionResult> ResetPassword(int id, [FromBody] UserResetPasswordRequest request, CancellationToken cancellationToken)
    {
        try
        {
            await _users.ResetPasswordAsync(id, request, User.GetDisplayName(), cancellationToken);
            return Ok(new { message = "密码已重置。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var currentUserId = User.GetUserId();
        if (id == currentUserId)
            return Conflict(new { message = "不能删除当前登录账号。" });

        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();

        await using var query = connection.CreateCommand();
        query.Transaction = transaction;
        query.CommandText = "SELECT Username,DisplayName,RoleCode,IsEnabled FROM Users WHERE Id=$id";
        query.Parameters.AddValue("$id", id);
        await using var reader = await query.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return NotFound(new { message = "用户不存在。" });

        var username = reader.GetString(0);
        var displayName = reader.GetString(1);
        var roleCode = reader.GetString(2);
        var isEnabled = reader.GetInt32(3) == 1;
        await reader.DisposeAsync();

        if (roleCode == AppRoles.Admin && isEnabled)
        {
            await using var count = connection.CreateCommand();
            count.Transaction = transaction;
            count.CommandText = "SELECT COUNT(*) FROM Users WHERE RoleCode='ADMIN' AND IsEnabled=1";
            var enabledAdmins = Convert.ToInt32(await count.ExecuteScalarAsync(cancellationToken));
            if (enabledAdmins <= 1)
                return Conflict(new { message = "系统必须至少保留一个启用的管理员，不能删除该账号。" });
        }

        await using var delete = connection.CreateCommand();
        delete.Transaction = transaction;
        delete.CommandText = "DELETE FROM Users WHERE Id=$id";
        delete.Parameters.AddValue("$id", id);
        if (await delete.ExecuteNonQueryAsync(cancellationToken) == 0)
            return NotFound(new { message = "用户不存在。" });

        await using var audit = connection.CreateCommand();
        audit.Transaction = transaction;
        audit.CommandText = """
            INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt)
            VALUES('User',$id,'DELETE_USER',$operator,$summary,$now);
            """;
        audit.Parameters.AddValue("$id", id);
        audit.Parameters.AddValue("$operator", User.GetDisplayName());
        audit.Parameters.AddValue("$summary", $"删除用户 {displayName}（{username}）");
        audit.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        await audit.ExecuteNonQueryAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return Ok(new { message = "用户已删除。" });
    }
}
