using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/versioning")]
[Authorize]
public sealed class VersioningController : ControllerBase
{
    private readonly DeliverableRepository _deliverables;

    public VersioningController(DeliverableRepository deliverables) => _deliverables = deliverables;

    [HttpGet("deliverables/{deliverableId:int}/preview")]
    public async Task<IActionResult> Preview(
        int deliverableId,
        [FromQuery] string incrementType = "PATCH",
        CancellationToken cancellationToken = default)
    {
        try
        {
            return Ok(await _deliverables.GetVersionPreviewAsync(deliverableId, incrementType, cancellationToken));
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpPost("deliverables/{deliverableId:int}/versions")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Editor)]
    public async Task<IActionResult> CreateVersion(
        int deliverableId,
        [FromQuery] string incrementType,
        [FromBody] VersionCreateRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            await _deliverables.EnsureDirectVersionCreationAllowedAsync(
                deliverableId,
                User.IsInRole(AppRoles.Admin),
                cancellationToken);
            return await CreateAsync(deliverableId, incrementType, request, null, cancellationToken);
        }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    [HttpPost("changes/{changeId:int}/deliverables/{deliverableId:int}/versions")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Editor)]
    public Task<IActionResult> CreateChangeVersion(
        int changeId,
        int deliverableId,
        [FromQuery] string incrementType,
        [FromBody] VersionCreateRequest request,
        CancellationToken cancellationToken) =>
        CreateAsync(deliverableId, incrementType, request, changeId, cancellationToken);

    private async Task<IActionResult> CreateAsync(
        int deliverableId,
        string incrementType,
        VersionCreateRequest request,
        int? changeId,
        CancellationToken cancellationToken)
    {
        try
        {
            request.Operator = User.GetDisplayName();
            var versionId = await _deliverables.AddAutoVersionWithOpenCyclePolicyAsync(
                deliverableId, incrementType, request, changeId, cancellationToken);
            var preview = await _deliverables.GetVersionPreviewAsync(deliverableId, "PATCH", cancellationToken);
            return Ok(new
            {
                id = versionId,
                message = changeId.HasValue ? "变更版本已创建并关联。" : "新版本已创建为草稿。",
                nextPreview = preview
            });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            return Conflict(new { message = "版本号已被其他操作占用，请刷新后重试。" });
        }
    }
}
