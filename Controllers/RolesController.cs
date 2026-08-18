using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/roles")]
[Authorize]
public sealed class RolesController : ControllerBase
{
    private readonly PermissionRepository _roles;
    private readonly DatabaseService _database;

    public RolesController(PermissionRepository roles, DatabaseService database)
    {
        _roles = roles;
        _database = database;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(new { items = await _roles.ListRolesAsync(ct), permissions = await _roles.ListPermissionsAsync(ct) });

    [HttpGet("data-scope-schema")]
    public async Task<IActionResult> DataScopeSchema(CancellationToken ct)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        async Task<List<DataScopeOption>> ReadAsync(string sql)
        {
            var result = new List<DataScopeOption>();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) result.Add(new DataScopeOption(reader.GetString(0), reader.GetString(1)));
            return result;
        }

        return Ok(new
        {
            dimensions = new[]
            {
                new DataScopeDimensionDefinition(DataScopeCatalog.Department, "部门", DataScopeCatalog.Include, await ReadAsync("SELECT CAST(Id AS TEXT), DepartmentName FROM Departments WHERE IsEnabled=1 ORDER BY SortOrder,Id")),
                new DataScopeDimensionDefinition(DataScopeCatalog.Project, "项目", DataScopeCatalog.Include, await ReadAsync("SELECT CAST(Id AS TEXT), ProjectName FROM Projects WHERE IsEnabled=1 ORDER BY ProjectCode,Id")),
                new DataScopeDimensionDefinition(DataScopeCatalog.Type, "交付物类型", DataScopeCatalog.Include, await ReadAsync("SELECT CAST(Id AS TEXT), TypeName FROM DeliverableTypes WHERE IsEnabled=1 ORDER BY SortOrder,Id"))
            }
        });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var result = await _roles.GetRoleAsync(id, ct);
        return result is null ? NotFound(new { message = "角色不存在。" }) : Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] RoleCreateRequest request, CancellationToken ct)
    {
        try { return Ok(new { id = await _roles.CreateRoleAsync(request, User.GetDisplayName(), ct), message = "角色已创建。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] RoleUpdateRequest request, CancellationToken ct)
    {
        var ok = await _roles.UpdateRoleAsync(id, request, ct);
        return ok ? Ok(new { message = "角色已更新。" }) : Conflict(new { message = "系统角色不能修改，或角色信息已被修改，请刷新后重试。" });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        try { await _roles.DeleteRoleAsync(id, ct); return Ok(new { message = "角色已删除。" }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpPut("{id:int}/policy")]
    public async Task<IActionResult> SavePolicy(int id, [FromBody] RolePermissionUpdateRequest request, CancellationToken ct)
    {
        foreach (var code in request.PermissionCodes.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!PermissionCatalog.All.Any(x => x.Code.Equals(code, StringComparison.OrdinalIgnoreCase))) return BadRequest(new { message = $"不存在的权限点：{code}" });
        }
        foreach (var scope in request.DataScopes)
        {
            if (!DataScopeCatalog.IsDimension(scope.Dimension)) return BadRequest(new { message = $"不支持的数据权限维度：{scope.Dimension}" });
            if (!DataScopeCatalog.IsScopeType(scope.ScopeType)) return BadRequest(new { message = $"不支持的数据范围类型：{scope.ScopeType}" });
            if (scope.ScopeType.Equals(DataScopeCatalog.Include, StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(scope.ScopeValue)) return BadRequest(new { message = "指定数据范围必须选择具体范围。" });
        }
        try { await _roles.SaveRolePolicyAsync(id, request, ct); return Ok(new { message = "权限策略已保存。" }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }
}
