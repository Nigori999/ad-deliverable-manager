using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/deliverables")]
[Authorize]
public sealed class DeliverablesController : ControllerBase
{
    private readonly DeliverableRepository _repository;
    private readonly PermissionService _permissions;
    private readonly DatabaseService _database;

    public DeliverablesController(DeliverableRepository repository, PermissionService permissions, DatabaseService database)
    {
        _repository = repository;
        _permissions = permissions;
        _database = database;
    }

    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string? keyword,[FromQuery] int? departmentId,[FromQuery] int? typeId,[FromQuery] int? categoryId,[FromQuery] int? projectId,[FromQuery] string? status,[FromQuery] string? confidentiality,[FromQuery] string? sharePolicy,[FromQuery] int page=1,[FromQuery] int pageSize=20,CancellationToken ct=default)
    {
        var allowed=await _permissions.GetAllowedDeliverableIdsAsync(User.GetUserId(),PermissionCatalog.DeliveryView,ct);
        return Ok(await _repository.SearchAsync(keyword,departmentId,typeId,projectId,status,confidentiality,sharePolicy,page,pageSize,ct,allowed,categoryId));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id,CancellationToken ct){var result=await _repository.GetAsync(id,ct);if(result is null)return NotFound(new{message="交付物不存在。"});if(!await _permissions.HasPermissionAsync(User.GetUserId(),PermissionCatalog.DeliveryView,id,ct))return Forbid();return Ok(result);}

    [HttpPost]
    public async Task<IActionResult> Create([FromBody]DeliverableCreateRequest request,CancellationToken ct)
    {
        try
        {
            if(!await _permissions.HasCreateScopeAsync(User.GetUserId(),PermissionCatalog.DeliveryCreate,request.DepartmentId,request.ProjectId,request.DeliverableTypeId,ct))return Forbid();
            request.ObjectCode=await ResolveCategoryCodeAsync(request.CategoryId,request.DeliverableTypeId,ct);
            request.Operator=User.GetDisplayName();
            request.InitialVersion.Operator=request.Operator;
            var result=await _repository.CreateAsync(request,ct);
            return Ok(new{id=result.Id,code=result.Code,message="交付物及首个版本已创建。"});
        }
        catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}
        catch(SqliteException ex)when(ex.SqliteErrorCode==19){return Conflict(new{message="交付物编码、版本号或类别约束发生重复，请重试。"});}
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id,[FromBody]DeliverableUpdateRequest request,CancellationToken ct){try{request.Operator=User.GetDisplayName();var updated=await _repository.UpdateAsync(id,request,ct);return updated?Ok(new{message="交付物信息已更新。"}):Conflict(new{message="数据已被其他人修改，请刷新后重试。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}}

    [HttpPost("{id:int}/versions")]
    public async Task<IActionResult> AddVersion(int id,[FromBody]VersionCreateRequest request,CancellationToken ct){try{await _repository.EnsureDirectVersionCreationAllowedAsync(id,true,ct);request.Operator=User.GetDisplayName();var versionId=await _repository.AddVersionWithOpenCyclePolicyAsync(id,request,ct);return Ok(new{id=versionId,message="新版本已创建为草稿。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}catch(SqliteException ex)when(ex.SqliteErrorCode==19){return Conflict(new{message="该内部版本号已存在。"});}}

    [HttpPost("{id:int}/versions/supplement")]
    public async Task<IActionResult> SupplementVersion(int id,[FromBody]VersionCreateRequest request,CancellationToken ct){if(!await _permissions.HasPermissionAsync(User.GetUserId(),PermissionCatalog.VersionSupplement,id,ct))return Forbid();try{if(!await _repository.HasFormalBaselineAsync(id,ct))return Conflict(new{message="该交付物尚未形成正式基线，请使用正常的新增版本入口。"});await _repository.EnsureNoOpenVersionCycleAsync(id,ct);request.Operator=User.GetDisplayName();var versionId=await _repository.AddVersionWithOpenCyclePolicyAsync(id,request,ct);return Ok(new{id=versionId,message="补录版本已创建为草稿，请继续按版本审批流程处理。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}catch(SqliteException ex)when(ex.SqliteErrorCode==19){return Conflict(new{message="该内部版本号已存在。"});}}

    [HttpPost("versions/{versionId:int}/{action}")]
    public async Task<IActionResult> VersionAction(int versionId,string action,[FromBody]LifecycleActionRequest request,CancellationToken ct){var normalized=action.ToLowerInvariant();var allowed=new[]{"submit-review","return-draft","approve","release","deprecate"};if(!allowed.Contains(normalized,StringComparer.Ordinal))return BadRequest(new{message="不支持的版本操作。"});if((normalized is "return-draft" or "approve" or "release" or "deprecate")&&string.IsNullOrWhiteSpace(request.Reason))return BadRequest(new{message="退回、审批通过、发布或废止时必须填写处理意见。"});try{request.Operator=User.GetDisplayName();var versionStatus=await _repository.TransitionVersionV073Async(versionId,normalized,request,ct);return Ok(new{status=versionStatus,message="版本状态已更新。"});}catch(ArgumentException ex){return BadRequest(new{message=ex.Message});}catch(InvalidOperationException ex){return Conflict(new{message=ex.Message});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}

    [HttpPost("{id:int}/archive")]
    public async Task<IActionResult> Archive(int id,[FromBody]LifecycleActionRequest request,CancellationToken ct){try{await _repository.ArchiveAsync(id,User.GetDisplayName(),request.Reason,ct);return Ok(new{message="交付物已归档，历史记录仍保留。"});}catch(KeyNotFoundException ex){return NotFound(new{message=ex.Message});}}

    private async Task<string> ResolveCategoryCodeAsync(int categoryId,int typeId,CancellationToken ct)
    {
        if(categoryId<=0)throw new ArgumentException("请选择交付物类别。");
        await using var connection=await _database.OpenConnectionAsync(ct);
        await using var command=connection.CreateCommand();
        command.CommandText="SELECT CategoryCode FROM DeliverableCategories WHERE Id=$categoryId AND DeliverableTypeId=$typeId AND IsEnabled=1";
        command.Parameters.AddWithValue("$categoryId",categoryId);
        command.Parameters.AddWithValue("$typeId",typeId);
        var value=await command.ExecuteScalarAsync(ct);
        if(value is null)throw new ArgumentException("所选交付物类别与交付物类型不匹配或已停用，请重新选择。");
        return Convert.ToString(value)?.Trim().ToUpperInvariant()??throw new ArgumentException("交付物类别编码无效。");
    }
}
