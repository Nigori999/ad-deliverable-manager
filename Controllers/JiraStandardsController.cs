using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/jira-standards")]
[Authorize]
public sealed class JiraStandardsController : ControllerBase
{
    private readonly JiraConfigurationRepository _repository;
    public JiraStandardsController(JiraConfigurationRepository repository) => _repository = repository;

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(new { items = await _repository.ListStandardsAsync(ct) });

    [HttpGet("template")]
    public IActionResult Template() => Ok(_repository.GetTemplate());

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Detail(int id, CancellationToken ct)
    {
        var item = await _repository.GetStandardAsync(id, ct);
        return item is null ? NotFound(new { message = "JIRA时效标准不存在或已删除。" }) : Ok(item);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] JiraProjectStandardRequest request, CancellationToken ct)
    {
        try
        {
            var id = await _repository.CreateStandardAsync(request, User.GetDisplayName(), ct);
            return Ok(new { id, message = "JIRA时效标准已新增。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] JiraProjectStandardRequest request, CancellationToken ct)
    {
        try
        {
            await _repository.UpdateStandardAsync(id, request, User.GetDisplayName(), ct);
            return Ok(new { message = "JIRA时效标准已更新。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        try
        {
            await _repository.DeleteStandardAsync(id, User.GetDisplayName(), ct);
            return Ok(new { message = "JIRA时效标准已删除。" });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }
}
