using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/jira-board")]
[Authorize]
public sealed class JiraBoardController : ControllerBase
{
    private readonly JiraBoardService _service;
    private readonly JiraConfigurationRepository _configuration;
    public JiraBoardController(JiraBoardService service, JiraConfigurationRepository configuration)
    {
        _service = service;
        _configuration = configuration;
    }

    [HttpPost("metadata")]
    public async Task<IActionResult> Metadata([FromBody] JiraConnectionRequest request, CancellationToken ct) =>
        await ExecuteAsync(() => _service.GetMetadataAsync(request, ct));

    [HttpPost("analyze")]
    public async Task<IActionResult> Analyze([FromBody] JiraBoardAnalysisRequest request, CancellationToken ct) =>
        await ExecuteAsync(() => _service.AnalyzeAsync(request, ct));

    [HttpPost("comments")]
    public async Task<IActionResult> Comments([FromBody] JiraBoardCommentRequest request, CancellationToken ct) =>
        await ExecuteAsync(() => _service.GetLatestCommentsAsync(request, ct));

    [HttpGet("presets")]
    public async Task<IActionResult> Presets([FromQuery] string baseUrl, [FromQuery] string projectKey, CancellationToken ct)
    {
        try { return Ok(new { items = await _configuration.ListPresetsAsync(User.GetUserId(), baseUrl, projectKey, ct) }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpPost("presets")]
    public async Task<IActionResult> CreatePreset([FromBody] JiraQueryPresetRequest request, CancellationToken ct)
    {
        try { return Ok(new { id = await _configuration.CreatePresetAsync(User.GetUserId(), request, ct), message = "查询方案已保存。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPut("presets/{id:int}")]
    public async Task<IActionResult> UpdatePreset(int id, [FromBody] JiraQueryPresetRequest request, CancellationToken ct)
    {
        try { await _configuration.UpdatePresetAsync(User.GetUserId(), id, request, ct); return Ok(new { message = "查询方案已更新。" }); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpDelete("presets/{id:int}")]
    public async Task<IActionResult> DeletePreset(int id, CancellationToken ct)
    {
        try { await _configuration.DeletePresetAsync(User.GetUserId(), id, ct); return Ok(new { message = "查询方案已删除。" }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    private async Task<IActionResult> ExecuteAsync(Func<Task<object>> action)
    {
        try { return Ok(await action()); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (JiraBoardException ex) { return StatusCode(StatusCodes.Status502BadGateway, new { message = ex.Message }); }
    }
}
