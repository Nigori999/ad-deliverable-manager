using AdDeliverableManager.Models;
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
    public JiraBoardController(JiraBoardService service) => _service = service;

    [HttpPost("metadata")]
    public async Task<IActionResult> Metadata([FromBody] JiraConnectionRequest request, CancellationToken ct) =>
        await ExecuteAsync(() => _service.GetMetadataAsync(request, ct));

    [HttpPost("analyze")]
    public async Task<IActionResult> Analyze([FromBody] JiraBoardAnalysisRequest request, CancellationToken ct) =>
        await ExecuteAsync(() => _service.AnalyzeAsync(request, ct));

    [HttpPost("comments")]
    public async Task<IActionResult> Comments([FromBody] JiraBoardCommentRequest request, CancellationToken ct) =>
        await ExecuteAsync(() => _service.GetLatestCommentsAsync(request, ct));

    private async Task<IActionResult> ExecuteAsync(Func<Task<object>> action)
    {
        try { return Ok(await action()); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (JiraBoardException ex) { return StatusCode(StatusCodes.Status502BadGateway, new { message = ex.Message }); }
    }
}
