using System.Security.Claims;
using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly UserRepository _users;
    private readonly PasswordService _passwords;

    public AuthController(UserRepository users, PasswordService passwords)
    {
        _users = users;
        _passwords = passwords;
    }

    [AllowAnonymous]
    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken cancellationToken)
    {
        var requiresBootstrap = await _users.CountAsync(cancellationToken) == 0;
        if (requiresBootstrap) return Ok(new { requiresBootstrap = true, authenticated = false });
        if (User.Identity?.IsAuthenticated != true)
            return Ok(new { requiresBootstrap = false, authenticated = false });

        var current = await _users.FindByIdAsync(User.GetUserId(), cancellationToken);
        if (current is null || !current.IsEnabled)
            return Ok(new { requiresBootstrap = false, authenticated = false });

        return Ok(new
        {
            requiresBootstrap = false,
            authenticated = true,
            user = UserResponse(current)
        });
    }

    [AllowAnonymous]
    [HttpPost("bootstrap")]
    public async Task<IActionResult> Bootstrap([FromBody] BootstrapAdminRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var id = await _users.BootstrapAdminAsync(request, cancellationToken);
            var user = await _users.FindByIdAsync(id, cancellationToken) ?? throw new InvalidOperationException("管理员初始化失败。");
            await SignInAsync(user, false);
            return Ok(new { message = "管理员账号已创建。", user = UserResponse(user) });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        var user = await _users.FindByUsernameAsync(request.Username, cancellationToken);
        if (user is null || !user.IsEnabled || !_passwords.Verify(request.Password, user.PasswordHash, user.PasswordSalt))
            return Unauthorized(new { message = "用户名或密码不正确。" });

        await SignInAsync(user, request.RememberMe);
        await _users.MarkLoginAsync(user.Id, cancellationToken);
        return Ok(new { message = "登录成功。", user = UserResponse(user) });
    }

    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok(new { message = "已退出登录。" });
    }

    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        try
        {
            await _users.ChangePasswordAsync(User.GetUserId(), request.CurrentPassword, request.NewPassword, cancellationToken);
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Ok(new { message = "密码已修改，请重新登录。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    private async Task SignInAsync(UserRecord user, bool persistent)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.DisplayName),
            new(ClaimTypes.Role, user.RoleCode),
            new("username", user.Username),
            new("mustChangePassword", user.MustChangePassword ? "1" : "0")
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, new AuthenticationProperties
        {
            IsPersistent = persistent,
            ExpiresUtc = persistent ? DateTimeOffset.UtcNow.AddDays(14) : DateTimeOffset.UtcNow.AddHours(8),
            AllowRefresh = true
        });
    }

    private static object UserResponse(UserRecord user) => new
    {
        id = user.Id, username = user.Username, displayName = user.DisplayName,
        roleCode = user.RoleCode, roleName = AppRoles.DisplayName(user.RoleCode),
        mustChangePassword = user.MustChangePassword
    };
}
