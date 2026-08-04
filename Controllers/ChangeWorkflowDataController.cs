using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/change-workflow")]
[Authorize]
public sealed class ChangeWorkflowDataController : ControllerBase
{
    private readonly DatabaseService _database;
    private readonly DeliverableRepository _deliverables;

    public ChangeWorkflowDataController(DatabaseService database, DeliverableRepository deliverables)
    {
        _database = database;
        _deliverables = deliverables;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string? status, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.Id,c.ChangeCode,d.Id,d.DeliverableCode,d.UnifiedName,t.TypeCode,
                   c.ChangeType,c.ChangeReason,c.ChangeContent,c.ImpactScope,c.RelatedIssueCode,
                   c.Applicant,c.ResponsiblePerson,c.ChangeStatus,c.Reviewer,c.ReviewOpinion,
                   c.PlannedCompletionDate,c.ActualCompletionDate,c.CreatedAt,c.UpdatedAt,
                   c.FromVersionId,fv.InternalVersion,c.ToVersionId,tv.InternalVersion,tv.VersionStatus
            FROM ChangeRecords c
            JOIN Deliverables d ON d.Id=c.DeliverableId
            JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
            LEFT JOIN DeliverableVersions fv ON fv.Id=c.FromVersionId
            LEFT JOIN DeliverableVersions tv ON tv.Id=c.ToVersionId
            WHERE ($status IS NULL OR $status='' OR c.ChangeStatus=$status)
            ORDER BY c.UpdatedAt DESC,c.Id DESC;
            """;
        command.Parameters.AddValue("$status", status);
        return Ok(new { items = await ReadItemsAsync(command, cancellationToken) });
    }

    [HttpGet("deliverable/{deliverableId:int}")]
    public async Task<IActionResult> Timeline(int deliverableId, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.Id,c.ChangeCode,d.Id,d.DeliverableCode,d.UnifiedName,t.TypeCode,
                   c.ChangeType,c.ChangeReason,c.ChangeContent,c.ImpactScope,c.RelatedIssueCode,
                   c.Applicant,c.ResponsiblePerson,c.ChangeStatus,c.Reviewer,c.ReviewOpinion,
                   c.PlannedCompletionDate,c.ActualCompletionDate,c.CreatedAt,c.UpdatedAt,
                   c.FromVersionId,fv.InternalVersion,c.ToVersionId,tv.InternalVersion,tv.VersionStatus
            FROM ChangeRecords c
            JOIN Deliverables d ON d.Id=c.DeliverableId
            JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
            LEFT JOIN DeliverableVersions fv ON fv.Id=c.FromVersionId
            LEFT JOIN DeliverableVersions tv ON tv.Id=c.ToVersionId
            WHERE c.DeliverableId=$deliverableId
            ORDER BY c.UpdatedAt DESC,c.Id DESC;
            """;
        command.Parameters.AddValue("$deliverableId", deliverableId);
        var items = await ReadItemsAsync(command, cancellationToken);
        return Ok(new { deliverableId, total = items.Count, items });
    }

    [HttpPost]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Editor)]
    public async Task<IActionResult> Create([FromBody] ChangeCreateRequest request, CancellationToken cancellationToken)
    {
        request.Applicant = User.GetDisplayName();
        if (request.DeliverableId <= 0 || string.IsNullOrWhiteSpace(request.ChangeReason)
            || string.IsNullOrWhiteSpace(request.ChangeContent)
            || string.IsNullOrWhiteSpace(request.ResponsiblePerson))
            return BadRequest(new { message = "交付物、变更原因、变更内容和责任人不能为空。" });

        int fromVersionId;
        try
        {
            fromVersionId = await _deliverables.RequireCurrentReleasedBaselineAsync(
                request.DeliverableId, cancellationToken);
        }
        catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { message = ex.Message }); }

        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        var now = DateTime.UtcNow.ToString("O");
        var changeCode = $"CHG-{DateTime.Now:yyyyMMddHHmmss}-{Random.Shared.Next(100, 999)}";

        await using var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = """
            INSERT INTO ChangeRecords(ChangeCode,DeliverableId,FromVersionId,ChangeType,ChangeReason,ChangeContent,
                ImpactScope,RelatedIssueCode,Applicant,ResponsiblePerson,ChangeStatus,PlannedCompletionDate,CreatedAt,UpdatedAt)
            VALUES($code,$deliverableId,$fromVersionId,$type,$reason,$content,$impact,$issue,$applicant,$owner,
                'PENDING_ASSESSMENT',$planned,$now,$now);
            SELECT last_insert_rowid();
            """;
        insert.Parameters.AddValue("$code", changeCode);
        insert.Parameters.AddValue("$deliverableId", request.DeliverableId);
        insert.Parameters.AddValue("$fromVersionId", fromVersionId);
        insert.Parameters.AddValue("$type", request.ChangeType);
        insert.Parameters.AddValue("$reason", request.ChangeReason.Trim());
        insert.Parameters.AddValue("$content", request.ChangeContent.Trim());
        insert.Parameters.AddValue("$impact", request.ImpactScope);
        insert.Parameters.AddValue("$issue", request.RelatedIssueCode);
        insert.Parameters.AddValue("$applicant", request.Applicant);
        insert.Parameters.AddValue("$owner", request.ResponsiblePerson.Trim());
        insert.Parameters.AddValue("$planned", request.PlannedCompletionDate);
        insert.Parameters.AddValue("$now", now);
        var id = Convert.ToInt32(await insert.ExecuteScalarAsync(cancellationToken));

        await using var audit = connection.CreateCommand();
        audit.Transaction = transaction;
        audit.CommandText = """
            INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt)
            VALUES('Change',$id,'CREATE',$operator,$summary,$now);
            """;
        audit.Parameters.AddValue("$id", id);
        audit.Parameters.AddValue("$operator", request.Applicant);
        audit.Parameters.AddValue("$summary", $"发起变更 {changeCode}，锁定当前正式版本 #{fromVersionId}");
        audit.Parameters.AddValue("$now", now);
        await audit.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new { id, code = changeCode, fromVersionId, message = "变更已发起并锁定当前正式版本。" });
    }

    private static async Task<List<object>> ReadItemsAsync(
        Microsoft.Data.Sqlite.SqliteCommand command,
        CancellationToken cancellationToken)
    {
        var items = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new
            {
                id = reader.GetInt32(0),
                code = reader.GetString(1),
                deliverableId = reader.GetInt32(2),
                deliverableCode = reader.GetString(3),
                deliverableName = reader.GetString(4),
                typeCode = reader.GetString(5),
                changeType = reader.GetString(6),
                reason = reader.GetString(7),
                content = reader.GetString(8),
                impactScope = reader.GetNullableString(9),
                relatedIssueCode = reader.GetNullableString(10),
                applicant = reader.GetString(11),
                responsiblePerson = reader.GetString(12),
                status = reader.GetString(13),
                reviewer = reader.GetNullableString(14),
                reviewOpinion = reader.GetNullableString(15),
                plannedCompletionDate = reader.GetNullableString(16),
                actualCompletionDate = reader.GetNullableString(17),
                createdAt = reader.GetString(18),
                updatedAt = reader.GetString(19),
                fromVersionId = reader.IsDBNull(20) ? (int?)null : reader.GetInt32(20),
                fromVersion = reader.GetNullableString(21),
                toVersionId = reader.IsDBNull(22) ? (int?)null : reader.GetInt32(22),
                toVersion = reader.GetNullableString(23),
                toVersionStatus = reader.GetNullableString(24)
            });
        }
        return items;
    }
}
