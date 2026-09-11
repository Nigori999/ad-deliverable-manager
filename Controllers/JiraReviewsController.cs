using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Authorize]
[Route("internal/jira-reviews")]
public sealed class JiraReviewsController : ControllerBase
{
    private readonly JiraReviewRepository _repository;
    private readonly JiraBoardService _board;
    public JiraReviewsController(JiraReviewRepository repository, JiraBoardService board)
    {
        _repository = repository;
        _board = board;
    }

    [HttpGet]
    public Task<IActionResult> List(CancellationToken ct) => ExecuteAsync(async () => new { items = await _repository.ListAsync(ct) });

    [HttpGet("reference-data")]
    public Task<IActionResult> Options(CancellationToken ct) => ExecuteAsync(() => _repository.GetOptionsAsync(ct));

    [HttpPost]
    public Task<IActionResult> Create([FromBody] JiraReviewRequest request, CancellationToken ct) => ExecuteAsync(async () =>
    {
        JiraReviewRepository.Validate(request);
        var snapshot = await _board.GetReviewSnapshotAsync(request, ct);
        var id = await _repository.CreateAsync(snapshot, request, User.GetDisplayName(), ct);
        return new { id, message = "超期复盘已保存。" };
    });

    [HttpPut("{id:int}")]
    public Task<IActionResult> Update(int id, [FromBody] JiraReviewRequest request, CancellationToken ct) => ExecuteAsync(async () =>
    {
        await _repository.UpdateAsync(id, request, User.GetDisplayName(), ct);
        return new { message = "超期复盘已更新。" };
    });

    [HttpDelete("{id:int}")]
    public Task<IActionResult> Delete(int id, [FromQuery] int revision, CancellationToken ct) => ExecuteAsync(async () =>
    {
        await _repository.DeleteAsync(id, revision, User.GetDisplayName(), ct);
        return new { message = "超期复盘已删除。" };
    });

    private async Task<IActionResult> ExecuteAsync(Func<Task<object>> action)
    {
        try { return Ok(await action()); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (JiraBoardException ex) { return StatusCode(502, new { message = ex.Message }); }
    }
}
