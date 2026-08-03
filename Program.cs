using System.Diagnostics;
using AdDeliverableManager.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddSingleton<DatabaseService>();
builder.Services.AddSingleton<BackupService>();
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

app.UseDefaultFiles();
app.UseStaticFiles();
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
