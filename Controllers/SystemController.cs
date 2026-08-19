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
    public async Task<IActionResult> AuditLogs(
        [FromQuery] string? keyword = null,
        [FromQuery] string? operatorName = null,
        [FromQuery] string? entityType = null,
        [FromQuery] string? actionType = null,
        [FromQuery] int? entityId = null,
        [FromQuery] DateTime? startTime = null,
        [FromQuery] DateTime? endTime = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken cancellationToken = default)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 10, 200);
        var offset = (long)(page - 1) * pageSize;
        var filters = new List<string> { "1=1" };

        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        if (!string.IsNullOrWhiteSpace(keyword))
        {
            filters.Add("(Summary LIKE $keyword OR Operator LIKE $keyword OR EntityType LIKE $keyword OR ActionType LIKE $keyword)");
            command.Parameters.AddWithValue("$keyword", $"%{keyword.Trim()}%");
        }
        if (!string.IsNullOrWhiteSpace(operatorName))
        {
            filters.Add("Operator LIKE $operatorName");
            command.Parameters.AddWithValue("$operatorName", $"%{operatorName.Trim()}%");
        }
        if (!string.IsNullOrWhiteSpace(entityType))
        {
            filters.Add("EntityType = $entityType");
            command.Parameters.AddWithValue("$entityType", entityType.Trim());
        }
        if (!string.IsNullOrWhiteSpace(actionType))
        {
            filters.Add("ActionType = $actionType");
            command.Parameters.AddWithValue("$actionType", actionType.Trim());
        }
        if (entityId.HasValue)
        {
            filters.Add("EntityId = $entityId");
            command.Parameters.AddWithValue("$entityId", entityId.Value);
        }
        if (startTime.HasValue)
        {
            filters.Add("CreatedAt >= $startTime");
            command.Parameters.AddWithValue("$startTime", startTime.Value.ToUniversalTime().ToString("O"));
        }
        if (endTime.HasValue)
        {
            filters.Add("CreatedAt < $endTime");
            command.Parameters.AddWithValue("$endTime", endTime.Value.ToUniversalTime().ToString("O"));
        }

        var where = string.Join(" AND ", filters);
        command.CommandText = $"""
            SELECT COUNT(*) FROM AuditLogs WHERE {where};
            SELECT Id,EntityType,EntityId,ActionType,Operator,Summary,CreatedAt
            FROM AuditLogs
            WHERE {where}
            ORDER BY CreatedAt DESC,Id DESC
            LIMIT $pageSize OFFSET $offset;
            """;
        command.Parameters.AddWithValue("$pageSize", pageSize);
        command.Parameters.AddWithValue("$offset", offset);

        var items = new List<object>();
        int total;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            await reader.ReadAsync(cancellationToken);
            total = reader.GetInt32(0);
            await reader.NextResultAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                items.Add(new
                {
                    id = reader.GetInt32(0),
                    entityType = reader.GetString(1),
                    entityId = reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2),
                    actionType = reader.GetString(3),
                    operatorName = reader.GetString(4),
                    summary = reader.GetString(5),
                    createdAt = reader.GetString(6)
                });
            }
        }

        await using var optionsCommand = connection.CreateCommand();
        optionsCommand.CommandText = """
            SELECT DISTINCT EntityType FROM AuditLogs ORDER BY EntityType;
            SELECT DISTINCT ActionType FROM AuditLogs ORDER BY ActionType;
            SELECT DISTINCT Operator FROM AuditLogs ORDER BY Operator;
            """;
        var entityTypes = new List<string>();
        var actionTypes = new List<string>();
        var operators = new List<string>();
        await using (var reader = await optionsCommand.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken)) entityTypes.Add(reader.GetString(0));
            await reader.NextResultAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) actionTypes.Add(reader.GetString(0));
            await reader.NextResultAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) operators.Add(reader.GetString(0));
        }

        return Ok(new
        {
            items,
            total,
            page,
            pageSize,
            totalPages = (int)Math.Ceiling(total / (double)pageSize),
            filterOptions = new { entityTypes, actionTypes, operators }
        });
    }
}
