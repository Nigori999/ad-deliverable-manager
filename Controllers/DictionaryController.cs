using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/master-data/dictionaries")]
[Authorize]
public sealed class DictionaryController : ControllerBase
{
    private readonly DictionaryRepository _repository;
    public DictionaryController(DictionaryRepository repository) => _repository = repository;

    [HttpGet]
    public async Task<IActionResult> ListTypes(CancellationToken ct) => Ok(new { items = await _repository.ListTypesAsync(ct) });

    [HttpGet("{code}")]
    public async Task<IActionResult> GetItems(string code, [FromQuery] string? scopeValue, CancellationToken ct)
    {
        try
        {
            var type = await _repository.GetTypeAsync(code, ct);
            if (type is null) return NotFound(new { message = "字典类型不存在或已停用。" });
            return Ok(new { dictionary = type, items = await _repository.ListItemsAsync(code, scopeValue, ct) });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpPost]
    public async Task<IActionResult> CreateType([FromBody] DictionaryTypeRequest request, CancellationToken ct)
    {
        try { return Ok(new { id = await _repository.CreateTypeAsync(request, User.GetDisplayName(), ct), message = "字典类型已新增。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateType(int id, [FromBody] DictionaryTypeRequest request, CancellationToken ct)
    {
        try { await _repository.UpdateTypeAsync(id, request, User.GetDisplayName(), ct); return Ok(new { message = "字典类型已更新。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteType(int id, CancellationToken ct)
    {
        try { await _repository.DeleteTypeAsync(id, User.GetDisplayName(), ct); return Ok(new { message = "字典类型已删除。" }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpPost("{code}/items")]
    public async Task<IActionResult> CreateItem(string code, [FromBody] DictionaryItemRequest request, CancellationToken ct)
    {
        try { return Ok(new { id = await _repository.CreateItemAsync(code, request, User.GetDisplayName(), ct), message = "字典项已新增。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpPut("{code}/items/{id:int}")]
    public async Task<IActionResult> UpdateItem(string code, int id, [FromBody] DictionaryItemRequest request, CancellationToken ct)
    {
        try { await _repository.UpdateItemAsync(code, id, request, User.GetDisplayName(), ct); return Ok(new { message = "字典项已更新。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpDelete("{code}/items/{id:int}")]
    public async Task<IActionResult> DeleteItem(string code, int id, CancellationToken ct)
    {
        try { await _repository.DeleteItemAsync(code, id, User.GetDisplayName(), ct); return Ok(new { message = "字典项已删除。" }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }
}
