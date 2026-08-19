using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/reference-data")]
[Authorize]
public sealed class ReferenceDataController : ControllerBase
{
    private static readonly HashSet<string> AllowedPermissions = new(StringComparer.OrdinalIgnoreCase)
    {
        PermissionCatalog.DeliveryView,
        PermissionCatalog.BaselineView,
        PermissionCatalog.ChangeView
    };

    private readonly DatabaseService _database;
    private readonly PermissionService _permissions;

    public ReferenceDataController(DatabaseService database, PermissionService permissions)
    {
        _database = database;
        _permissions = permissions;
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] string permission, CancellationToken ct)
    {
        var permissionCode = (permission ?? "").Trim().ToUpperInvariant();
        if (!AllowedPermissions.Contains(permissionCode))
            return BadRequest(new { message = "不支持的业务参考数据权限上下文。" });

        var userId = User.GetUserId();
        if (!await _permissions.HasPermissionAsync(userId, permissionCode, null, ct))
            return Forbid();

        await using var connection = await _database.OpenConnectionAsync(ct);
        var departmentScope = PermissionService.BuildReferenceScopePredicate(DataScopeCatalog.Department, "d.Id", permissionCode);
        var projectScope = PermissionService.BuildReferenceScopePredicate(DataScopeCatalog.Project, "p.Id", permissionCode);
        var typeScope = PermissionService.BuildReferenceScopePredicate(DataScopeCatalog.Type, "t.Id", permissionCode);

        var departments = new List<object>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"SELECT d.Id,d.DepartmentCode,d.DepartmentName FROM Departments d WHERE d.IsEnabled=1 AND {departmentScope} ORDER BY d.SortOrder";
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) departments.Add(new { id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2) });
        }

        var projects = new List<object>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"SELECT p.Id,p.ProjectCode,p.ProjectName,p.VehicleModel,p.PlatformName FROM Projects p WHERE p.IsEnabled=1 AND {projectScope} ORDER BY p.ProjectCode";
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) projects.Add(new { id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2), vehicleModel = reader.GetNullableString(3), platformName = reader.GetNullableString(4) });
        }

        var types = new List<object>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"SELECT t.Id,t.TypeCode,t.TypeName,t.DepartmentId,t.HasHardwareFields FROM DeliverableTypes t WHERE t.IsEnabled=1 AND {typeScope} ORDER BY t.SortOrder";
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) types.Add(new { id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2), parentId = reader.GetInt32(3), flag = reader.GetInt32(4) == 1 });
        }

        var categories = new List<object>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"""
                SELECT c.Id,c.CategoryCode,c.CategoryName,c.DeliverableTypeId,t.TypeCode,t.TypeName,c.SortOrder
                FROM DeliverableCategories c JOIN DeliverableTypes t ON t.Id=c.DeliverableTypeId
                WHERE c.IsEnabled=1 AND t.IsEnabled=1 AND {typeScope}
                ORDER BY t.SortOrder,c.SortOrder,c.CategoryName;
                """;
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) categories.Add(new
            {
                id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2),
                typeId = reader.GetInt32(3), typeCode = reader.GetString(4), typeName = reader.GetString(5), sortOrder = reader.GetInt32(6)
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
}
