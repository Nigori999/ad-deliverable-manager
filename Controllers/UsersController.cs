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

    public UsersController(UserRepository users) => _users = users;

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
}
