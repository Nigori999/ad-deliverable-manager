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
    private readonly DatabaseService _database;
    public MasterDataController(DatabaseService database) => _database = database;
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        await using var connection=await _database.OpenConnectionAsync(cancellationToken);
        async Task<List<LookupItem>> ReadAsync(string sql,bool hasParent=false,bool hasFlag=false){var result=new List<LookupItem>();await using var command=connection.CreateCommand();command.CommandText=sql;await using var reader=await command.ExecuteReaderAsync(cancellationToken);while(await reader.ReadAsync(cancellationToken)){var parent=hasParent&&!reader.IsDBNull(3)?reader.GetInt32(3):(int?)null;var flagOrdinal=hasParent?4:3;var flag=hasFlag&&!reader.IsDBNull(flagOrdinal)&&reader.GetInt32(flagOrdinal)==1;result.Add(new LookupItem(reader.GetInt32(0),reader.GetString(1),reader.GetString(2),parent,flag));}return result;}
        var departments=await ReadAsync("SELECT Id, DepartmentCode, DepartmentName, 0 FROM Departments WHERE IsEnabled=1 ORDER BY SortOrder");
        var projects=new List<object>();await using(var projectCommand=connection.CreateCommand()){projectCommand.CommandText="SELECT Id,ProjectCode,ProjectName,VehicleModel,PlatformName FROM Projects WHERE IsEnabled=1 ORDER BY ProjectCode";await using var reader=await projectCommand.ExecuteReaderAsync(cancellationToken);while(await reader.ReadAsync(cancellationToken))projects.Add(new{id=reader.GetInt32(0),code=reader.GetString(1),name=reader.GetString(2),vehicleModel=reader.GetNullableString(3),platformName=reader.GetNullableString(4)});}
        var types=await ReadAsync("SELECT Id, TypeCode, TypeName, DepartmentId, HasHardwareFields FROM DeliverableTypes WHERE IsEnabled=1 ORDER BY SortOrder",true,true);
        return Ok(new{departments,projects,types,confidentialityLevels=new[]{new{code="PUBLIC",name="公开"},new{code="INTERNAL",name="内部"},new{code="CONFIDENTIAL",name="秘密"},new{code="STRICTLY_CONFIDENTIAL",name="机密"}},sharePolicies=new[]{new{code="ALLOWED",name="允许对外分享"},new{code="APPROVAL_REQUIRED",name="审批后允许"},new{code="PROHIBITED",name="禁止分享"}},hardwareCategories=new[]{"前视摄像头","周视摄像头","角雷达","激光雷达","毫米波雷达","超声波雷达","智驾域控制器"}});
    }
    [HttpPost("projects")]
    public async Task<IActionResult> CreateProject([FromBody]ProjectCreateRequest request,CancellationToken cancellationToken){if(string.IsNullOrWhiteSpace(request.ProjectCode)||string.IsNullOrWhiteSpace(request.ProjectName))return BadRequest(new{message="项目编码和项目名称不能为空。"});await using var connection=await _database.OpenConnectionAsync(cancellationToken);await using var command=connection.CreateCommand();command.CommandText="INSERT INTO Projects(ProjectCode,ProjectName,VehicleModel,PlatformName,ProjectStatus,IsEnabled,CreatedAt) VALUES($code,$name,$vehicle,$platform,'ACTIVE',1,$now);SELECT last_insert_rowid();";command.Parameters.AddValue("$code",request.ProjectCode.Trim().ToUpperInvariant());command.Parameters.AddValue("$name",request.ProjectName.Trim());command.Parameters.AddValue("$vehicle",request.VehicleModel);command.Parameters.AddValue("$platform",request.PlatformName);command.Parameters.AddValue("$now",DateTime.UtcNow.ToString("O"));try{var id=Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));return Ok(new{id,message="项目已新增。"});}catch(SqliteException ex)when(ex.SqliteErrorCode==19){return Conflict(new{message="项目编码已存在。"});}}
    [HttpPut("projects/{id:int}")]
    public async Task<IActionResult> UpdateProject(int id,[FromBody]ProjectUpdateRequest request,CancellationToken cancellationToken){if(string.IsNullOrWhiteSpace(request.ProjectCode)||string.IsNullOrWhiteSpace(request.ProjectName))return BadRequest(new{message="项目编码和项目名称不能为空。"});await using var connection=await _database.OpenConnectionAsync(cancellationToken);await using var command=connection.CreateCommand();command.CommandText="UPDATE Projects SET ProjectCode=$code,ProjectName=$name,VehicleModel=$vehicle,PlatformName=$platform WHERE Id=$id AND IsEnabled=1";command.Parameters.AddValue("$code",request.ProjectCode.Trim().ToUpperInvariant());command.Parameters.AddValue("$name",request.ProjectName.Trim());command.Parameters.AddValue("$vehicle",request.VehicleModel);command.Parameters.AddValue("$platform",request.PlatformName);command.Parameters.AddValue("$id",id);try{if(await command.ExecuteNonQueryAsync(cancellationToken)==0)return Conflict(new{message="项目不存在或已删除，请刷新后重试。"});return Ok(new{message="项目已更新。"});}catch(SqliteException ex)when(ex.SqliteErrorCode==19){return Conflict(new{message="项目编码已存在。"});}}
    [HttpDelete("projects/{id:int}")]
    public async Task<IActionResult> DeleteProject(int id,CancellationToken cancellationToken){await using var connection=await _database.OpenConnectionAsync(cancellationToken);await using var check=connection.CreateCommand();check.CommandText="SELECT COUNT(*) FROM Deliverables WHERE ProjectId=$id";check.Parameters.AddValue("$id",id);var used=Convert.ToInt32(await check.ExecuteScalarAsync(cancellationToken));if(used>0)return Conflict(new{message=$"该项目已被 {used} 个交付物引用，不能删除。请先处理关联数据。"});await using var command=connection.CreateCommand();command.CommandText="UPDATE Projects SET IsEnabled=0 WHERE Id=$id AND IsEnabled=1";command.Parameters.AddWithValue("$id",id);if(await command.ExecuteNonQueryAsync(cancellationToken)==0)return NotFound(new{message="项目不存在或已删除。"});return Ok(new{message="项目已删除。"});}
}
