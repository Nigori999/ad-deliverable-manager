using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/changes")]
[Authorize]
public sealed class ChangesController : ControllerBase
{
    private readonly DatabaseService _database;

    public ChangesController(DatabaseService database) => _database = database;

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] string? status, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.Id,c.ChangeCode,d.DeliverableCode,d.UnifiedName,c.ChangeType,c.ChangeReason,c.ChangeContent,
                   c.ImpactScope,c.RelatedIssueCode,c.Applicant,c.ResponsiblePerson,c.ChangeStatus,c.Reviewer,
                   c.ReviewOpinion,c.PlannedCompletionDate,c.ActualCompletionDate,c.CreatedAt,c.UpdatedAt,
                   c.FromVersionId,c.ToVersionId
            FROM ChangeRecords c JOIN Deliverables d ON d.Id=c.DeliverableId
            WHERE ($status IS NULL OR $status='' OR c.ChangeStatus=$status)
            ORDER BY c.UpdatedAt DESC;
            """;
        command.Parameters.AddValue("$status", status);
        var items = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new
            {
                id=reader.GetInt32(0), code=reader.GetString(1), deliverableCode=reader.GetString(2), deliverableName=reader.GetString(3),
                changeType=reader.GetString(4), reason=reader.GetString(5), content=reader.GetString(6), impactScope=reader.GetNullableString(7),
                relatedIssueCode=reader.GetNullableString(8), applicant=reader.GetString(9), responsiblePerson=reader.GetString(10),
                status=reader.GetString(11), reviewer=reader.GetNullableString(12), reviewOpinion=reader.GetNullableString(13),
                plannedCompletionDate=reader.GetNullableString(14), actualCompletionDate=reader.GetNullableString(15),
                createdAt=reader.GetString(16), updatedAt=reader.GetString(17),
                fromVersionId=reader.IsDBNull(18) ? (int?)null : reader.GetInt32(18),
                toVersionId=reader.IsDBNull(19) ? (int?)null : reader.GetInt32(19)
            });
        }
        return Ok(new { items });
    }

    [HttpPost]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Editor)]
    public async Task<IActionResult> Create([FromBody] ChangeCreateRequest request, CancellationToken cancellationToken)
    {
        request.Applicant = User.GetDisplayName();
        if (request.DeliverableId <= 0 || string.IsNullOrWhiteSpace(request.ChangeReason) ||
            string.IsNullOrWhiteSpace(request.ChangeContent) || string.IsNullOrWhiteSpace(request.ResponsiblePerson))
            return BadRequest(new { message = "交付物、变更原因、变更内容和责任人不能为空。" });

        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        var now = DateTime.UtcNow.ToString("O");
        var changeCode = $"CHG-{DateTime.Now:yyyyMMddHHmmss}-{Random.Shared.Next(100, 999)}";

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO ChangeRecords(ChangeCode,DeliverableId,FromVersionId,ChangeType,ChangeReason,ChangeContent,
                ImpactScope,RelatedIssueCode,Applicant,ResponsiblePerson,ChangeStatus,PlannedCompletionDate,CreatedAt,UpdatedAt)
            VALUES($code,$deliverableId,$fromVersionId,$type,$reason,$content,$impact,$issue,$applicant,$owner,
                'PENDING_ASSESSMENT',$planned,$now,$now);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddValue("$code", changeCode); command.Parameters.AddValue("$deliverableId", request.DeliverableId);
        command.Parameters.AddValue("$fromVersionId", request.FromVersionId); command.Parameters.AddValue("$type", request.ChangeType);
        command.Parameters.AddValue("$reason", request.ChangeReason.Trim()); command.Parameters.AddValue("$content", request.ChangeContent.Trim());
        command.Parameters.AddValue("$impact", request.ImpactScope); command.Parameters.AddValue("$issue", request.RelatedIssueCode);
        command.Parameters.AddValue("$applicant", request.Applicant); command.Parameters.AddValue("$owner", request.ResponsiblePerson.Trim());
        command.Parameters.AddValue("$planned", request.PlannedCompletionDate); command.Parameters.AddValue("$now", now);
        var id = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));

        await InsertAuditAsync(connection, transaction, id, "CREATE", request.Applicant, $"发起变更 {changeCode}", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new { id, code = changeCode, message = "变更已发起。" });
    }

    [HttpPost("{id:int}/{action}")]
    public async Task<IActionResult> Action(int id, string action, [FromBody] ChangeActionRequest request, CancellationToken cancellationToken)
    {
        var transitions = new Dictionary<string, (string Required, string Target)>(StringComparer.OrdinalIgnoreCase)
        {
            ["approve"] = ("PENDING_ASSESSMENT", "APPROVED"),
            ["reject"] = ("PENDING_ASSESSMENT", "REJECTED"),
            ["start"] = ("APPROVED", "IMPLEMENTING"),
            ["verify"] = ("IMPLEMENTING", "PENDING_VERIFICATION"),
            ["close"] = ("PENDING_VERIFICATION", "CLOSED")
        };
        if (!transitions.TryGetValue(action, out var transition)) return BadRequest(new { message = "不支持的变更操作。" });
        if (!CanRunAction(action)) return Forbid();

        request.Operator = User.GetDisplayName();
        if ((action.Equals("approve", StringComparison.OrdinalIgnoreCase) || action.Equals("reject", StringComparison.OrdinalIgnoreCase))
            && string.IsNullOrWhiteSpace(request.Opinion))
            return BadRequest(new { message = "批准或驳回时必须填写评审意见。" });

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
        command.Parameters.AddValue("$target", transition.Target); command.Parameters.AddValue("$operator", request.Operator);
        command.Parameters.AddValue("$opinion", request.Opinion); command.Parameters.AddValue("$toVersionId", request.ToVersionId);
        command.Parameters.AddValue("$now", now); command.Parameters.AddValue("$id", id);
        command.Parameters.AddValue("$required", transition.Required);
        if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
            return Conflict(new { message = "当前状态不允许执行该操作，请刷新后重试。" });

        await InsertAuditAsync(connection, transaction, id, action.ToUpperInvariant(), request.Operator,
            $"变更状态：{transition.Required} → {transition.Target}", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new { status = transition.Target, message = "变更状态已更新。" });
    }

    private bool CanRunAction(string action)
    {
        if (User.IsInRole(AppRoles.Admin)) return true;
        return action.ToLowerInvariant() switch
        {
            "approve" or "reject" or "close" => User.IsInRole(AppRoles.Approver),
            "start" or "verify" => User.IsInRole(AppRoles.Editor),
            _ => false
        };
    }

    private static async Task InsertAuditAsync(Microsoft.Data.Sqlite.SqliteConnection connection,
        Microsoft.Data.Sqlite.SqliteTransaction transaction, int id, string action, string operatorName,
        string summary, string now, CancellationToken cancellationToken)
    {
        await using var audit = connection.CreateCommand();
        audit.Transaction = transaction;
        audit.CommandText = """
            INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt)
            VALUES('Change',$id,$action,$operator,$summary,$now);
            """;
        audit.Parameters.AddValue("$id", id); audit.Parameters.AddValue("$action", action);
        audit.Parameters.AddValue("$operator", operatorName); audit.Parameters.AddValue("$summary", summary);
        audit.Parameters.AddValue("$now", now);
        await audit.ExecuteNonQueryAsync(cancellationToken);
    }
}
