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
    private readonly UserRepository _users;private readonly PasswordService _passwords;private readonly PermissionService _permissions;
    public AuthController(UserRepository users,PasswordService passwords,PermissionService permissions){_users=users;_passwords=passwords;_permissions=permissions;}

    [AllowAnonymous][HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken ct){var bootstrap=await _users.CountAsync(ct)==0;if(bootstrap)return Ok(new{requiresBootstrap=true,authenticated=false});if(User.Identity?.IsAuthenticated!=true)return Ok(new{requiresBootstrap=false,authenticated=false});var current=await _users.FindByIdAsync(User.GetUserId(),ct);if(current is null||!current.IsEnabled){await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);return Ok(new{requiresBootstrap=false,authenticated=false});}return Ok(new{requiresBootstrap=false,authenticated=true,user=await UserResponseAsync(current,ct)});}

    [AllowAnonymous][HttpPost("bootstrap")]
    public async Task<IActionResult> Bootstrap([FromBody]BootstrapAdminRequest request,CancellationToken ct){try{var id=await _users.BootstrapAdminAsync(request,ct);var user=await _users.FindByIdAsync(id,ct)??throw new InvalidOperationException("管理员初始化失败。");await SignInAsync(user,false,ct);return Ok(new{message="管理员账号已创建。",user=await UserResponseAsync(user,ct)});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}}

    [AllowAnonymous][HttpPost("login")]
    public async Task<IActionResult> Login([FromBody]LoginRequest request,CancellationToken ct){if(string.IsNullOrWhiteSpace(request.Username)||string.IsNullOrEmpty(request.Password))return Unauthorized(new{message="用户名或密码不正确。"});var user=await _users.FindByUsernameAsync(request.Username,ct);if(user is null||!user.IsEnabled||!_passwords.Verify(request.Password,user.PasswordHash,user.PasswordSalt))return Unauthorized(new{message="用户名或密码不正确。"});await SignInAsync(user,request.RememberMe,ct);await _users.MarkLoginAsync(user.Id,ct);return Ok(new{message="登录成功。",user=await UserResponseAsync(user,ct)});}

    [Authorize][HttpPost("logout")]
    public async Task<IActionResult> Logout(){await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);return Ok(new{message="已退出登录。"});}

    [Authorize][HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword([FromBody]ChangePasswordRequest request,CancellationToken ct){try{await _users.ChangePasswordAsync(User.GetUserId(),request.CurrentPassword,request.NewPassword,ct);await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);return Ok(new{message="密码已修改，请重新登录。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}

    private async Task SignInAsync(UserRecord user,bool persistent,CancellationToken ct)
    {var claims=new List<Claim>{new(ClaimTypes.NameIdentifier,user.Id.ToString()),new(ClaimTypes.Name,user.DisplayName),new("username",user.Username),new("mustChangePassword",user.MustChangePassword?"1":"0")};foreach(var role in new[]{AppRoles.Admin,AppRoles.Editor,AppRoles.Approver,AppRoles.Viewer})claims.Add(new Claim(ClaimTypes.Role,role));foreach(var roleName in await _permissions.GetEffectiveRoleNamesAsync(user.Id,ct))claims.Add(new Claim("roleName",roleName));var principal=new ClaimsPrincipal(new ClaimsIdentity(claims,CookieAuthenticationDefaults.AuthenticationScheme));await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,principal,new AuthenticationProperties{IsPersistent=persistent,ExpiresUtc=persistent?DateTimeOffset.UtcNow.AddDays(14):DateTimeOffset.UtcNow.AddHours(8),AllowRefresh=true});}
    private async Task<object> UserResponseAsync(UserRecord user,CancellationToken ct)=>new{id=user.Id,username=user.Username,displayName=user.DisplayName,roleCode=user.RoleCode,roleNames=await _permissions.GetEffectiveRoleNamesAsync(user.Id,ct),permissions=await _permissions.GetEffectivePermissionsAsync(user.Id,ct),mustChangePassword=user.MustChangePassword};
}
