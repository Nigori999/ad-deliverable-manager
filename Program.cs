using System.Diagnostics;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Authentication;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;

var builder = WebApplication.CreateBuilder(args);

var dataProtectionPath = Path.Combine(AppContext.BaseDirectory, "data", "keys");
Directory.CreateDirectory(dataProtectionPath);
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionPath))
    .SetApplicationName("AdDeliverableManager");

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "ad-deliverable-auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.None;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return context.Response.WriteAsJsonAsync(new { message = "登录已失效，请重新登录。" });
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return context.Response.WriteAsJsonAsync(new { message = "当前账号没有执行该操作的权限。" });
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddControllers();
builder.Services.AddSingleton<DatabaseService>();
builder.Services.AddSingleton<BackupService>();
builder.Services.AddSingleton<PasswordService>();
builder.Services.AddScoped<UserRepository>();
builder.Services.AddScoped<DeliverableRepository>();

var app = builder.Build();

var database = app.Services.GetRequiredService<DatabaseService>();
await database.InitializeAsync();

var backupService = app.Services.GetRequiredService<BackupService>();
if (app.Configuration.GetValue("Backup:AutoBackupOnStart", true))
{
    await backupService.CreateBackupAsync("startup");
    backupService.DeleteExpiredBackups();
}

app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (Exception exception)
    {
        var logDirectory = Path.Combine(AppContext.BaseDirectory, "logs");
        Directory.CreateDirectory(logDirectory);
        var line = $"{DateTime.Now:O}\t{context.Request.Method} {context.Request.Path}\t{exception}\n";
        await File.AppendAllTextAsync(Path.Combine(logDirectory, $"error-{DateTime.Now:yyyyMM}.log"), line);
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            await context.Response.WriteAsJsonAsync(new { message = "系统处理失败，错误已记录到logs目录。" });
        }
    }
});

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        context.Context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        context.Context.Response.Headers.Pragma = "no-cache";
        context.Context.Response.Headers.Expires = "0";
    }
});
app.UseAuthentication();
app.Use(async (context, next) =>
{
    var isInternal = context.Request.Path.StartsWithSegments("/internal");
    var isAnonymousAuth = context.Request.Path.StartsWithSegments("/internal/auth/login")
        || context.Request.Path.StartsWithSegments("/internal/auth/bootstrap")
        || context.Request.Path.StartsWithSegments("/internal/auth/status");

    if (isInternal && !isAnonymousAuth && context.User.Identity?.IsAuthenticated != true)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new { message = "请先登录。" });
        return;
    }

    if (context.User.Identity?.IsAuthenticated == true && isInternal)
    {
        using var scope = context.RequestServices.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserRepository>();
        var userId = context.User.GetUserId();
        var current = await users.FindByIdAsync(userId, context.RequestAborted);
        var claimedRole = context.User.GetRoleCode();
        if (current is null || !current.IsEnabled || !string.Equals(current.RoleCode, claimedRole, StringComparison.Ordinal))
        {
            await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { message = "账号状态或角色已变化，请重新登录。" });
            return;
        }

        var mustChange = context.User.FindFirst("mustChangePassword")?.Value == "1";
        var allowedPasswordPath = context.Request.Path.StartsWithSegments("/internal/auth/change-password")
            || context.Request.Path.StartsWithSegments("/internal/auth/logout")
            || context.Request.Path.StartsWithSegments("/internal/auth/status");
        if (mustChange && !allowedPasswordPath)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = "首次登录必须先修改密码。" });
            return;
        }

        bool roleAllowed = true;
        var path = context.Request.Path.Value ?? "";
        if (context.Request.Method == "POST" && path.Equals("/internal/master-data/projects", StringComparison.OrdinalIgnoreCase))
            roleAllowed = current.RoleCode is AppRoles.Admin or AppRoles.Editor;
        else if (path.StartsWith("/internal/system/backup", StringComparison.OrdinalIgnoreCase)
                 || path.StartsWith("/internal/system/audit-logs", StringComparison.OrdinalIgnoreCase))
            roleAllowed = current.RoleCode == AppRoles.Admin;

        if (!roleAllowed)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new { message = "当前账号没有执行该操作的权限。" });
            return;
        }
    }
    await next();
});
app.UseAuthorization();
app.MapControllers();
app.MapFallbackToFile("index.html");

var port = app.Configuration.GetValue("Application:Port", 5078);
var allowLan = app.Configuration.GetValue("Application:AllowLanAccess", false);
var host = allowLan ? "0.0.0.0" : "127.0.0.1";
app.Urls.Add($"http://{host}:{port}");

if (app.Configuration.GetValue("Application:AutoOpenBrowser", true))
{
    app.Lifetime.ApplicationStarted.Register(() =>
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = $"http://localhost:{port}",
                UseShellExecute = true
            });
        }
        catch
        {
            // 浏览器启动失败不影响后端运行。
        }
    });
}

await app.RunAsync();
