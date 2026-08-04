using System.Security.Claims;

namespace AdDeliverableManager.Security;

public static class ClaimsPrincipalExtensions
{
    public static int GetUserId(this ClaimsPrincipal user)
    {
        var value = user.FindFirstValue(ClaimTypes.NameIdentifier);
        return int.TryParse(value, out var id) ? id : 0;
    }

    public static string GetDisplayName(this ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.Name) ?? "系统用户";

    public static string GetUsername(this ClaimsPrincipal user) =>
        user.FindFirstValue("username") ?? "";

    public static string GetRoleCode(this ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.Role) ?? AppRoles.Viewer;
}
