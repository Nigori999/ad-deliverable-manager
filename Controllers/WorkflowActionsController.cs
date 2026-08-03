using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/workflow")]
[Authorize]
public sealed class WorkflowActionsController : ControllerBase
{
    private readonly DeliverableRepository _deliverables;
    private readonly DatabaseService _database;

    public WorkflowActionsController(DeliverableRepository deliverables, DatabaseService database)
    {
        _deliverables = deliverables;
        _database = database;
    }

    [HttpPost("versions/{versionId:int}/submit-review")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Editor)]
    public Task<IActionResult> SubmitVersionReview(
        int versionId,
        [FromBody] LifecycleActionRequest request,
        CancellationToken cancellationToken) =>
        RunVersionActionAsync(versionId, "submit-review", request, false, cancellationToken);

    [HttpPost("versions/{versionId:int}/return-draft")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Approver)]
    public Task<IActionResult> ReturnVersionToDraft(
        int versionId,
        [FromBody] LifecycleActionRequest request,
        CancellationToken cancellationToken) =>
        RunVersionActionAsync(versionId, "return-draft", request, true, cancellationToken);

    [HttpPost("versions/{versionId:int}/release")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Approver)]
    public Task<IActionResult> ReleaseVersion(
        int versionId,
        [FromBody] LifecycleActionRequest request,
        CancellationToken cancellationToken) =>
        RunVersionActionAsync(versionId, "release", request, true, cancellationToken);

    [HttpPost("versions/{versionId:int}/deprecate")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Approver)]
    public Task<IActionResult> DeprecateVersion(
        int versionId,
        [FromBody] LifecycleActionRequest request,
        CancellationToken cancellationToken) =>
        RunVersionActionAsync(versionId, "deprecate", request, true, cancellationToken);

    [HttpPost("changes/{id:int}/approve")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Approver)]
    public Task<IActionResult> ApproveChange(
        int id,
        [FromBody] ChangeActionRequest request,
        CancellationToken cancellationToken) =>
        RunChangeActionAsync(id, "approve", request, cancellationToken);

    [HttpPost("changes/{id:int}/reject")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Approver)]
    public Task<IActionResult> RejectChange(
        int id,
        [FromBody] ChangeActionRequest request,
        CancellationToken cancellationToken) =>
        RunChangeActionAsync(id, "reject", request, cancellationToken);

    [HttpPost("changes/{id:int}/start")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Editor)]
    public Task<IActionResult> StartChange(
        int id,
        [FromBody] ChangeActionRequest request,
        CancellationToken cancellationToken) =>
        RunChangeActionAsync(id, "start", request, cancellationToken);

    [HttpPost("changes/{id:int}/verify")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Editor)]
    public Task<IActionResult> VerifyChange(
        int id,
        [FromBody] ChangeActionRequest request,
        CancellationToken cancellationToken) =>
        RunChangeActionAsync(id, "verify", request, cancellationToken);

    [HttpPost("changes/{id:int}/close")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Approver)]
    public Task<IActionResult> CloseChange(
        int id,
        [FromBody] ChangeActionRequest request,
        CancellationToken cancellationToken) =>
        RunChangeActionAsync(id, "close", request, cancellationToken);

    private async Task<IActionResult> RunVersionActionAsync(
        int versionId,
        string action,
        LifecycleActionRequest request,
        bool reasonRequired,
        CancellationToken cancellationToken)
    {
        if (reasonRequired && string.IsNullOrWhiteSpace(request.Reason))
            return BadRequest(new { message = "该操作必须填写处理意见。" });

        try
        {
            request.Operator = User.GetDisplayName();
            var status = await _deliverables.TransitionVersionAsync(versionId, action, request, cancellationToken);
            return Ok(new { status, message = "版本状态已更新。" });
        }
        catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
    }

    private async Task<IActionResult> RunChangeActionAsync(
        int id,
        string action,
        ChangeActionRequest request,
        CancellationToken cancellationToken)
    {
        var transition = action switch
        {
            "approve" => (Required: "PENDING_ASSESSMENT", Target: "APPROVED"),
            "reject" => (Required: "PENDING_ASSESSMENT", Target: "REJECTED"),
            "start" => (Required: "APPROVED", Target: "IMPLEMENTING"),
            "verify" => (Required: "IMPLEMENTING", Target: "PENDING_VERIFICATION"),
            "close" => (Required: "PENDING_VERIFICATION", Target: "CLOSED"),
            _ => throw new ArgumentOutOfRangeException(nameof(action))
        };

        if ((action is "approve" or "reject") && string.IsNullOrWhiteSpace(request.Opinion))
            return BadRequest(new { message = "批准或驳回时必须填写评审意见。" });

        request.Operator = User.GetDisplayName();
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        var now = DateTime.UtcNow.ToString("O");

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE ChangeRecords SET ChangeStatus=$target,
                Reviewer=CASE WHEN $target IN ('APPROVED','REJECTED') THEN $operator ELSE Reviewer END,
                ReviewOpinion=CASE WHEN $target IN ('APPROVED','REJECTED') THEN $opinion ELSE ReviewOpinion END,
                ToVersionId=COALESCE($toVersionId,ToVersionId),
                ActualCompletionDate=CASE WHEN $target='CLOSED' THEN $now ELSE ActualCompletionDate END,
                UpdatedAt=$now
            WHERE Id=$id AND ChangeStatus=$required;
            """;
        command.Parameters.AddValue("$target", transition.Target);
        command.Parameters.AddValue("$operator", request.Operator);
        command.Parameters.AddValue("$opinion", request.Opinion);
        command.Parameters.AddValue("$toVersionId", request.ToVersionId);
        command.Parameters.AddValue("$now", now);
        command.Parameters.AddValue("$id", id);
        command.Parameters.AddValue("$required", transition.Required);

        if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
            return Conflict(new { message = "当前状态不允许执行该操作，请刷新后重试。" });

        await using var audit = connection.CreateCommand();
        audit.Transaction = transaction;
        audit.CommandText = """
            INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt)
            VALUES('Change',$id,$action,$operator,$summary,$now);
            """;
        audit.Parameters.AddValue("$id", id);
        audit.Parameters.AddValue("$action", action.ToUpperInvariant());
        audit.Parameters.AddValue("$operator", request.Operator);
        audit.Parameters.AddValue("$summary", $"变更状态：{transition.Required} → {transition.Target}");
        audit.Parameters.AddValue("$now", now);
        await audit.ExecuteNonQueryAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return Ok(new { status = transition.Target, message = "变更状态已更新。" });
    }
}
