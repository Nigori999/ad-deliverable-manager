using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/issues")]
[Authorize]
public sealed class IssueManagementController : ControllerBase
{
    private readonly IssueManagementRepository _repository;
    public IssueManagementController(IssueManagementRepository repository) => _repository = repository;

    [HttpGet("reference-data")]
    public async Task<IActionResult> ReferenceData(CancellationToken ct) => Ok(await _repository.GetReferenceDataAsync(ct));

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard(
        [FromQuery] string? dateFrom, [FromQuery] string? dateTo,
        [FromQuery] int? departmentItemId, [FromQuery] int? sourceItemId, [FromQuery] int? severityItemId,
        CancellationToken ct)
    {
        try { return Ok(await _repository.GetDashboardAsync(dateFrom, dateTo, departmentItemId, sourceItemId, severityItemId, ct)); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("snapshots")]
    public async Task<IActionResult> Snapshots(
        [FromQuery] string? dateFrom, [FromQuery] string? dateTo,
        [FromQuery] int? departmentItemId, [FromQuery] int? sourceItemId, [FromQuery] int? severityItemId,
        CancellationToken ct)
    {
        try { return Ok(await _repository.ListSnapshotsAsync(dateFrom, dateTo, departmentItemId, sourceItemId, severityItemId, ct)); }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
    }

    [HttpGet("snapshots/{id:int}")]
    public async Task<IActionResult> Snapshot(int id, CancellationToken ct)
    {
        var result = await _repository.GetSnapshotAsync(id, ct);
        return result is null ? NotFound(new { message = "问题汇总快照不存在或已删除。" }) : Ok(result);
    }

    [HttpPost("snapshots")]
    public async Task<IActionResult> Create([FromBody] IssueSnapshotRequest request, CancellationToken ct)
    {
        try
        {
            var id = await _repository.CreateSnapshotAsync(request, User.GetDisplayName(), ct);
            return Ok(new { id, message = "问题汇总快照已录入。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
    }

    [HttpPut("snapshots/{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] IssueSnapshotRequest request, CancellationToken ct)
    {
        try
        {
            await _repository.UpdateSnapshotAsync(id, request, User.GetDisplayName(), ct);
            return Ok(new { message = "问题汇总快照已更新。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpDelete("snapshots/{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        try
        {
            await _repository.DeleteSnapshotAsync(id, User.GetDisplayName(), ct);
            return Ok(new { message = "问题汇总快照已删除。" });
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }
}
