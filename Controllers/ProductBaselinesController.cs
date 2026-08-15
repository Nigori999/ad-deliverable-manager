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

    public ProductBaselinesController(ProductBaselineRepository repository, ProductBaselineChangeService changeService)
    {
        _repository = repository;
        _changeService = changeService;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(new { items = await _repository.ListAsync(ct) });

    [HttpGet("options")]
    public async Task<IActionResult> Options(CancellationToken ct) => Ok(await _repository.GetOptionsAsync(ct));

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
        try { await _changeService.ApplyAsync(id, request, User.GetDisplayName(), ct); return Ok(new { message = "产品基线变更已生效。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }
}

public sealed record RevisionRequest(int Revision);
