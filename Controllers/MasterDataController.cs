using AdDeliverableManager.Models;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/master-data")]
public sealed class MasterDataController : ControllerBase
{
    private readonly DatabaseService _database;

    public MasterDataController(DatabaseService database) => _database = database;

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);

        async Task<List<LookupItem>> ReadAsync(string sql, bool hasParent = false, bool hasFlag = false)
        {
            var result = new List<LookupItem>();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var parent = hasParent && !reader.IsDBNull(3) ? reader.GetInt32(3) : (int?)null;
                var flagOrdinal = hasParent ? 4 : 3;
                var flag = hasFlag && !reader.IsDBNull(flagOrdinal) && reader.GetInt32(flagOrdinal) == 1;
                result.Add(new LookupItem(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), parent, flag));
            }
            return result;
        }

        var departments = await ReadAsync("SELECT Id, DepartmentCode, DepartmentName, 0 FROM Departments WHERE IsEnabled=1 ORDER BY SortOrder");
        var projects = await ReadAsync("SELECT Id, ProjectCode, ProjectName, 0 FROM Projects WHERE IsEnabled=1 ORDER BY ProjectCode");
        var types = await ReadAsync("SELECT Id, TypeCode, TypeName, DepartmentId, HasHardwareFields FROM DeliverableTypes WHERE IsEnabled=1 ORDER BY SortOrder", true, true);

        return Ok(new
        {
            departments,
            projects,
            types,
            confidentialityLevels = new[]
            {
                new { code = "PUBLIC", name = "公开" },
                new { code = "INTERNAL", name = "内部" },
                new { code = "CONFIDENTIAL", name = "秘密" },
                new { code = "STRICTLY_CONFIDENTIAL", name = "机密" }
            },
            sharePolicies = new[]
            {
                new { code = "ALLOWED", name = "允许对外分享" },
                new { code = "APPROVAL_REQUIRED", name = "审批后允许" },
                new { code = "PROHIBITED", name = "禁止对外分享" }
            },
            hardwareCategories = new[] { "前视摄像头", "周视摄像头", "角雷达", "激光雷达", "毫米波雷达", "超声波雷达", "智驾域控制器" }
        });
    }

    [HttpPost("projects")]
    public async Task<IActionResult> CreateProject([FromBody] ProjectCreateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.ProjectCode) || string.IsNullOrWhiteSpace(request.ProjectName))
            return BadRequest(new { message = "项目编码和项目名称不能为空。" });

        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO Projects(ProjectCode, ProjectName, VehicleModel, PlatformName, ProjectStatus, IsEnabled, CreatedAt)
            VALUES($code, $name, $vehicle, $platform, 'ACTIVE', 1, $now);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddValue("$code", request.ProjectCode.Trim().ToUpperInvariant());
        command.Parameters.AddValue("$name", request.ProjectName.Trim());
        command.Parameters.AddValue("$vehicle", request.VehicleModel);
        command.Parameters.AddValue("$platform", request.PlatformName);
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));

        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
            return Ok(new { id, message = "项目已新增。" });
        }
        catch (Microsoft.Data.Sqlite.SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            return Conflict(new { message = "项目编码已存在。" });
        }
    }
}
