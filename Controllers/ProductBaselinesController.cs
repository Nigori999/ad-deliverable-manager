using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/product-baselines")]
[Authorize]
public sealed class ProductBaselinesController : ControllerBase
{
    private readonly ProductBaselineRepository _repository;
    private readonly ProductBaselineChangeService _changeService;
    private readonly DatabaseService _database;

    public ProductBaselinesController(ProductBaselineRepository repository, ProductBaselineChangeService changeService, DatabaseService database)
    {
        _repository = repository;
        _changeService = changeService;
        _database = database;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(new { items = await _repository.ListAsync(ct) });

    [HttpGet("options")]
    public async Task<IActionResult> Options(CancellationToken ct)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        var hardware = new List<object>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT v.Id,d.UnifiedName,v.InternalVersion,cat.CategoryCode,cat.CategoryName,h.HardwareModel
                FROM DeliverableVersions v
                JOIN Deliverables d ON d.Id=v.DeliverableId
                JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
                JOIN DeliverableCategories cat ON cat.Id=d.CategoryId
                LEFT JOIN HardwarePackageDetails h ON h.VersionId=v.Id
                WHERE t.TypeCode='SWP' AND d.LifecycleStatus='ACTIVE' AND v.VersionStatus IN ('RELEASED','SUPERSEDED')
                ORDER BY cat.SortOrder,cat.CategoryName,d.UnifiedName,v.InternalVersion DESC;
                """;
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                hardware.Add(new { id=reader.GetInt32(0), name=reader.GetString(1), version=reader.GetString(2), hardwareCategory=reader.GetString(3), categoryName=reader.GetString(4), hardwareModel=reader.GetNullableString(5) });
        }

        var documents = new List<object>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT v.Id,d.UnifiedName,v.InternalVersion,t.TypeCode,t.TypeName,cat.CategoryCode,cat.CategoryName
                FROM DeliverableVersions v
                JOIN Deliverables d ON d.Id=v.DeliverableId
                JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
                JOIN DeliverableCategories cat ON cat.Id=d.CategoryId
                WHERE t.TypeCode IN ('PRD','FR','TC','TR') AND d.LifecycleStatus='ACTIVE'
                  AND v.VersionStatus IN ('RELEASED','SUPERSEDED')
                ORDER BY t.SortOrder,cat.SortOrder,cat.CategoryName,d.UnifiedName,v.InternalVersion DESC;
                """;
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                documents.Add(new { id=reader.GetInt32(0), name=reader.GetString(1), version=reader.GetString(2), typeCode=reader.GetString(3), typeName=reader.GetString(4), categoryCode=reader.GetString(5), categoryName=reader.GetString(6) });
        }
        return Ok(new { hardware, documents });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id, CancellationToken ct)
    {
        var result = await _repository.GetAsync(id, ct);
        return result is null ? NotFound(new { message = "产品版本基线不存在。" }) : Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ProductBaselineCreateRequest request, CancellationToken ct)
    {
        try { return Ok(new { id = await _repository.CreateAsync(request, User.GetDisplayName(), ct), message = "产品版本基线已创建。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] ProductBaselineUpdateRequest request, CancellationToken ct)
    {
        foreach (var item in request.Deliverables) item.RoleCode = NormalizeDocumentRole(item.RoleCode);
        try { await _repository.UpdateDraftAsync(id, request, User.GetDisplayName(), ct); return Ok(new { message = "产品基线草稿已保存。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPost("{id:int}/publish")]
    public async Task<IActionResult> Publish(int id, [FromBody] RevisionRequest request, CancellationToken ct)
    {
        try { await _repository.PublishAsync(id, request.Revision, User.GetDisplayName(), ct); return Ok(new { message = "产品版本基线已正式发布。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPost("{id:int}/copy")]
    public async Task<IActionResult> Copy(int id, [FromBody] ProductBaselineCopyRequest request, CancellationToken ct)
    {
        try { return Ok(new { id = await _repository.CopyAsync(id, request, User.GetDisplayName(), ct), message = "产品版本基线已复制为新草稿。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpPost("{id:int}/changes")]
    public async Task<IActionResult> Change(int id, [FromBody] ProductBaselineChangeRequest request, CancellationToken ct)
    {
        foreach (var item in request.Deliverables) item.RoleCode = NormalizeDocumentRole(item.RoleCode);
        try { await _changeService.ApplyAsync(id, request, User.GetDisplayName(), ct); return Ok(new { message = "产品基线变更已生效。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    private static string NormalizeDocumentRole(string? role) => string.Equals(role?.Trim(), "TEST_REPORT", StringComparison.OrdinalIgnoreCase) ? "TR" : (role ?? "").Trim().ToUpperInvariant();
}

public sealed record RevisionRequest(int Revision);
