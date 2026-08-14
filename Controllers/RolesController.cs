using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/roles")]
[Authorize]
[PermissionAuthorize(PermissionCatalog.RoleManage)]
public sealed class RolesController : ControllerBase
{
    private readonly PermissionRepository _roles;
    private readonly DatabaseService _database;

    public RolesController(PermissionRepository roles, DatabaseService database)
    { _roles=roles; _database=database; }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)=>Ok(new { items=await _roles.ListRolesAsync(cancellationToken),permissions=await _roles.ListPermissionsAsync(cancellationToken),workflowNodes=PermissionCatalog.WorkflowNodes.Select(x=>new{code=x.Code,name=x.Name}) });

    [HttpGet("data-scope-schema")]
    public async Task<IActionResult> DataScopeSchema(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        async Task<List<DataScopeOption>> ReadAsync(string sql)
        {
            var result = new List<DataScopeOption>();
            await using var command = connection.CreateCommand(); command.CommandText = sql;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) result.Add(new DataScopeOption(reader.GetString(0), reader.GetString(1)));
            return result;
        }
        var departments = await ReadAsync("SELECT CAST(Id AS TEXT), DepartmentName FROM Departments WHERE IsEnabled=1 ORDER BY SortOrder,Id");
        var projects = await ReadAsync("SELECT CAST(Id AS TEXT), ProjectName FROM Projects WHERE IsEnabled=1 ORDER BY ProjectCode,Id");
        var types = await ReadAsync("SELECT CAST(Id AS TEXT), TypeName FROM DeliverableTypes WHERE IsEnabled=1 ORDER BY SortOrder,Id");
        var hardwareCategories = await ReadAsync("SELECT DISTINCT HardwareCategory, HardwareCategory FROM HardwarePackageDetails WHERE HardwareCategory IS NOT NULL AND TRIM(HardwareCategory)<>'' ORDER BY HardwareCategory");
        // ResponsiblePerson is currently free text, so use the display name as the stored scope value for compatibility.
        var owners = await ReadAsync("SELECT DisplayName, DisplayName || '（' || Username || '）' FROM Users WHERE IsEnabled=1 ORDER BY DisplayName,Username");
        return Ok(new
        {
            dimensions = new[]
            {
                new DataScopeDimensionDefinition(DataScopeCatalog.Department, "部门", "INCLUDE", departments),
                new DataScopeDimensionDefinition(DataScopeCatalog.Project, "项目", "INCLUDE", projects),
                new DataScopeDimensionDefinition(DataScopeCatalog.Type, "交付物类型", "INCLUDE", types),
                new DataScopeDimensionDefinition(DataScopeCatalog.Owner, "负责人", "INCLUDE", owners),
                new DataScopeDimensionDefinition(DataScopeCatalog.HardwareCategory, "硬件类别", "INCLUDE", hardwareCategories)
            }
        });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id,CancellationToken cancellationToken){var x=await _roles.GetRoleAsync(id,cancellationToken);return x is null?NotFound(new{message="角色不存在。"}):Ok(x);}
    [HttpPost]
    public async Task<IActionResult> Create([FromBody]RoleCreateRequest request,CancellationToken cancellationToken){try{return Ok(new{id=await _roles.CreateRoleAsync(request,User.GetDisplayName(),cancellationToken),message="角色已创建。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}}
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id,[FromBody]RoleUpdateRequest request,CancellationToken cancellationToken){var ok=await _roles.UpdateRoleAsync(id,request,User.GetDisplayName(),cancellationToken);return ok?Ok(new{message="角色已更新。"}):Conflict(new{message="系统角色不能修改，或角色信息已被修改，请刷新后重试。"});}
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id,CancellationToken cancellationToken){try{await _roles.DeleteRoleAsync(id,User.GetDisplayName(),cancellationToken);return Ok(new{message="角色已删除。"});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
    [HttpPut("{id:int}/policy")]
    public async Task<IActionResult> SavePolicy(int id,[FromBody]RolePermissionUpdateRequest request,CancellationToken cancellationToken){try{await _roles.SaveRolePolicyAsync(id,request,cancellationToken);return Ok(new{message="权限策略已保存。"});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}
}
