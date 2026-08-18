using System.Text.RegularExpressions;
using AdDeliverableManager.Models;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/master-data")]
[Authorize]
public sealed class MasterDataController : ControllerBase
{
    private static readonly Regex CategoryCodePattern = new("^[A-Z0-9_]+$", RegexOptions.Compiled);
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
        var projects = new List<object>();
        await using (var projectCommand = connection.CreateCommand())
        {
            projectCommand.CommandText = "SELECT Id,ProjectCode,ProjectName,VehicleModel,PlatformName FROM Projects WHERE IsEnabled=1 ORDER BY ProjectCode";
            await using var reader = await projectCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                projects.Add(new { id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2), vehicleModel = reader.GetNullableString(3), platformName = reader.GetNullableString(4) });
        }

        var types = await ReadAsync("SELECT Id, TypeCode, TypeName, DepartmentId, HasHardwareFields FROM DeliverableTypes WHERE IsEnabled=1 ORDER BY SortOrder", true, true);
        var categories = new List<object>();
        await using (var categoryCommand = connection.CreateCommand())
        {
            categoryCommand.CommandText = """
                SELECT c.Id,c.CategoryCode,c.CategoryName,c.DeliverableTypeId,t.TypeCode,t.TypeName,c.SortOrder
                FROM DeliverableCategories c JOIN DeliverableTypes t ON t.Id=c.DeliverableTypeId
                WHERE c.IsEnabled=1 AND t.IsEnabled=1
                ORDER BY t.SortOrder,c.SortOrder,c.CategoryName;
                """;
            await using var reader = await categoryCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                categories.Add(new
                {
                    id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2),
                    typeId = reader.GetInt32(3), typeCode = reader.GetString(4), typeName = reader.GetString(5),
                    sortOrder = reader.GetInt32(6)
                });
        }

        return Ok(new
        {
            departments,
            projects,
            types,
            categories,
            confidentialityLevels = new[] { new { code = "PUBLIC", name = "公开" }, new { code = "INTERNAL", name = "内部" }, new { code = "CONFIDENTIAL", name = "秘密" }, new { code = "STRICTLY_CONFIDENTIAL", name = "机密" } },
            sharePolicies = new[] { new { code = "ALLOWED", name = "允许对外分享" }, new { code = "APPROVAL_REQUIRED", name = "审批后允许" }, new { code = "PROHIBITED", name = "禁止分享" } }
        });
    }

    [HttpPost("categories")]
    public async Task<IActionResult> CreateCategory([FromBody] DeliverableCategoryRequest request, CancellationToken cancellationToken)
    {
        var validation = ValidateCategoryRequest(request);
        if (validation is not null) return BadRequest(new { message = validation });
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        if (!await TypeExistsAsync(connection, request.DeliverableTypeId, cancellationToken)) return BadRequest(new { message = "所选交付物类型不存在或已停用。" });
        await using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO DeliverableCategories(DeliverableTypeId,CategoryCode,CategoryName,SortOrder,IsEnabled,CreatedAt,UpdatedAt) VALUES($type,$code,$name,$sort,1,$now,$now);SELECT last_insert_rowid();";
        command.Parameters.AddValue("$type", request.DeliverableTypeId);
        command.Parameters.AddValue("$code", NormalizeCategoryCode(request.CategoryCode));
        command.Parameters.AddValue("$name", request.CategoryName.Trim());
        command.Parameters.AddValue("$sort", request.SortOrder);
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
            return Ok(new { id, message = "交付物类别已新增。" });
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            return Conflict(new { message = "该交付物类型下已存在相同的类别编码或类别名称。" });
        }
    }

    [HttpPut("categories/{id:int}")]
    public async Task<IActionResult> UpdateCategory(int id, [FromBody] DeliverableCategoryRequest request, CancellationToken cancellationToken)
    {
        var validation = ValidateCategoryRequest(request);
        if (validation is not null) return BadRequest(new { message = validation });
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        if (!await TypeExistsAsync(connection, request.DeliverableTypeId, cancellationToken)) return BadRequest(new { message = "所选交付物类型不存在或已停用。" });

        await using var current = connection.CreateCommand();
        current.CommandText = "SELECT DeliverableTypeId,CategoryCode FROM DeliverableCategories WHERE Id=$id AND IsEnabled=1";
        current.Parameters.AddValue("$id", id);
        await using var reader = await current.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return NotFound(new { message = "交付物类别不存在或已删除。" });
        var oldTypeId = reader.GetInt32(0);
        var oldCode = reader.GetString(1);
        await reader.DisposeAsync();

        await using var usage = connection.CreateCommand();
        usage.CommandText = "SELECT COUNT(*) FROM Deliverables WHERE CategoryId=$id";
        usage.Parameters.AddValue("$id", id);
        var used = Convert.ToInt32(await usage.ExecuteScalarAsync(cancellationToken));
        var normalizedCode = NormalizeCategoryCode(request.CategoryCode);
        if (used > 0 && (oldTypeId != request.DeliverableTypeId || !string.Equals(oldCode, normalizedCode, StringComparison.OrdinalIgnoreCase)))
            return Conflict(new { message = $"该类别已被 {used} 个交付物使用，不能修改所属类型或类别编码；可以修改类别名称和排序。" });

        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE DeliverableCategories SET DeliverableTypeId=$type,CategoryCode=$code,CategoryName=$name,SortOrder=$sort,UpdatedAt=$now WHERE Id=$id AND IsEnabled=1";
        command.Parameters.AddValue("$type", request.DeliverableTypeId);
        command.Parameters.AddValue("$code", normalizedCode);
        command.Parameters.AddValue("$name", request.CategoryName.Trim());
        command.Parameters.AddValue("$sort", request.SortOrder);
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddValue("$id", id);
        try
        {
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return NotFound(new { message = "交付物类别不存在或已删除。" });
            return Ok(new { message = "交付物类别已更新。" });
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            return Conflict(new { message = "该交付物类型下已存在相同的类别编码或类别名称。" });
        }
    }

    [HttpDelete("categories/{id:int}")]
    public async Task<IActionResult> DeleteCategory(int id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var usage = connection.CreateCommand();
        usage.CommandText = "SELECT COUNT(*) FROM Deliverables WHERE CategoryId=$id";
        usage.Parameters.AddValue("$id", id);
        var used = Convert.ToInt32(await usage.ExecuteScalarAsync(cancellationToken));
        if (used > 0) return Conflict(new { message = $"该类别已被 {used} 个交付物使用，不能删除。可以修改类别名称，但应保留其业务标识。" });
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM DeliverableCategories WHERE Id=$id";
        command.Parameters.AddValue("$id", id);
        if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return NotFound(new { message = "交付物类别不存在或已删除。" });
        return Ok(new { message = "交付物类别已删除。" });
    }

    [HttpPost("projects")]
    public async Task<IActionResult> CreateProject([FromBody] ProjectCreateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.ProjectCode) || string.IsNullOrWhiteSpace(request.ProjectName)) return BadRequest(new { message = "项目编码和项目名称不能为空。" });
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO Projects(ProjectCode,ProjectName,VehicleModel,PlatformName,ProjectStatus,IsEnabled,CreatedAt) VALUES($code,$name,$vehicle,$platform,'ACTIVE',1,$now);SELECT last_insert_rowid();";
        command.Parameters.AddValue("$code", request.ProjectCode.Trim().ToUpperInvariant()); command.Parameters.AddValue("$name", request.ProjectName.Trim()); command.Parameters.AddValue("$vehicle", request.VehicleModel); command.Parameters.AddValue("$platform", request.PlatformName); command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        try { var id = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)); return Ok(new { id, message = "项目已新增。" }); }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19) { return Conflict(new { message = "项目编码已存在。" }); }
    }

    [HttpPut("projects/{id:int}")]
    public async Task<IActionResult> UpdateProject(int id, [FromBody] ProjectUpdateRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.ProjectCode) || string.IsNullOrWhiteSpace(request.ProjectName)) return BadRequest(new { message = "项目编码和项目名称不能为空。" });
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Projects SET ProjectCode=$code,ProjectName=$name,VehicleModel=$vehicle,PlatformName=$platform WHERE Id=$id AND IsEnabled=1";
        command.Parameters.AddValue("$code", request.ProjectCode.Trim().ToUpperInvariant()); command.Parameters.AddValue("$name", request.ProjectName.Trim()); command.Parameters.AddValue("$vehicle", request.VehicleModel); command.Parameters.AddValue("$platform", request.PlatformName); command.Parameters.AddValue("$id", id);
        try { if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return Conflict(new { message = "项目不存在或已删除，请刷新后重试。" }); return Ok(new { message = "项目已更新。" }); }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19) { return Conflict(new { message = "项目编码已存在。" }); }
    }

    [HttpDelete("projects/{id:int}")]
    public async Task<IActionResult> DeleteProject(int id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var check = connection.CreateCommand(); check.CommandText = "SELECT COUNT(*) FROM Deliverables WHERE ProjectId=$id"; check.Parameters.AddValue("$id", id);
        var used = Convert.ToInt32(await check.ExecuteScalarAsync(cancellationToken));
        if (used > 0) return Conflict(new { message = $"该项目已被 {used} 个交付物引用，不能删除。请先处理关联数据。" });
        await using var command = connection.CreateCommand(); command.CommandText = "UPDATE Projects SET IsEnabled=0 WHERE Id=$id AND IsEnabled=1"; command.Parameters.AddValue("$id", id);
        if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return NotFound(new { message = "项目不存在或已删除。" });
        return Ok(new { message = "项目已删除。" });
    }

    private static string? ValidateCategoryRequest(DeliverableCategoryRequest request)
    {
        if (request.DeliverableTypeId <= 0) return "请选择交付物类型。";
        if (string.IsNullOrWhiteSpace(request.CategoryCode)) return "类别编码不能为空。";
        var code = NormalizeCategoryCode(request.CategoryCode);
        if (code.Length > 40 || !CategoryCodePattern.IsMatch(code)) return "类别编码仅支持大写字母、数字和下划线，且不超过40个字符。";
        if (string.IsNullOrWhiteSpace(request.CategoryName) || request.CategoryName.Trim().Length > 40) return "类别名称不能为空且不超过40个字符。";
        if (request.SortOrder < 0 || request.SortOrder > 9999) return "排序值应在0到9999之间。";
        return null;
    }

    private static string NormalizeCategoryCode(string value) => value.Trim().ToUpperInvariant().Replace('-', '_').Replace(' ', '_');

    private static async Task<bool> TypeExistsAsync(SqliteConnection connection, int id, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM DeliverableTypes WHERE Id=$id AND IsEnabled=1";
        command.Parameters.AddValue("$id", id);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) > 0;
    }
}
