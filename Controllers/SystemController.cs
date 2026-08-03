using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/system")]
public sealed class SystemController : ControllerBase
{
    private readonly DatabaseService _database;
    private readonly BackupService _backup;
    private readonly IConfiguration _configuration;

    public SystemController(DatabaseService database, BackupService backup, IConfiguration configuration)
    {
        _database = database;
        _backup = backup;
        _configuration = configuration;
    }

    [HttpGet("health")]
    public async Task<IActionResult> Health(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT sqlite_version()";
        var sqliteVersion = Convert.ToString(await command.ExecuteScalarAsync(cancellationToken));
        return Ok(new
        {
            status = "ok",
            application = _configuration["Application:Name"],
            sqliteVersion,
            databasePath = _database.DatabasePath,
            time = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")
        });
    }

    [HttpPost("backup")]
    public async Task<IActionResult> Backup(CancellationToken cancellationToken)
    {
        var path = await _backup.CreateBackupAsync("manual", cancellationToken);
        return Ok(new { path, message = path is null ? "数据库尚未生成。" : "备份已创建。" });
    }

    [HttpGet("audit-logs")]
    public async Task<IActionResult> AuditLogs([FromQuery] int limit = 100, CancellationToken cancellationToken = default)
    {
        limit = Math.Clamp(limit, 10, 500);
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id,EntityType,EntityId,ActionType,Operator,Summary,CreatedAt FROM AuditLogs ORDER BY CreatedAt DESC LIMIT $limit";
        command.Parameters.AddValue("$limit", limit);
        var items = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new
            {
                id = reader.GetInt32(0), entityType = reader.GetString(1), entityId = reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2),
                actionType = reader.GetString(3), operatorName = reader.GetString(4), summary = reader.GetString(5), createdAt = reader.GetString(6)
            });
        }
        return Ok(new { items });
    }
}
