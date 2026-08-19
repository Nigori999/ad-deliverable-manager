using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/draft-deletions")]
[Authorize]
public sealed class DraftDeletionController : ControllerBase
{
    private readonly DatabaseService _database;
    public DraftDeletionController(DatabaseService database) => _database = database;

    [HttpDelete("deliverables/{id:int}")]
    public async Task<IActionResult> DeleteDeliverable(int id, CancellationToken ct)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var state = connection.CreateCommand();
        state.Transaction = transaction;
        state.CommandText = """
            SELECT d.DeliverableCode,
                   (SELECT COUNT(*) FROM DeliverableVersions v WHERE v.DeliverableId=d.Id),
                   (SELECT COUNT(*) FROM DeliverableVersions v WHERE v.DeliverableId=d.Id AND v.VersionStatus NOT IN ('DRAFT','DEPRECATED')),
                   (SELECT COUNT(*) FROM ChangeRecords c WHERE c.DeliverableId=d.Id),
                   (SELECT COUNT(*) FROM DeliverableRelations r WHERE r.SourceDeliverableId=d.Id OR r.TargetDeliverableId=d.Id),
                   (SELECT COUNT(*) FROM ProductBaselineHardware h JOIN DeliverableVersions v ON v.Id=h.SoftwareVersionId WHERE v.DeliverableId=d.Id)
                   + (SELECT COUNT(*) FROM ProductBaselineDeliverables b JOIN DeliverableVersions v ON v.Id=b.VersionId WHERE v.DeliverableId=d.Id)
            FROM Deliverables d WHERE d.Id=$id;
            """;
        state.Parameters.AddWithValue("$id", id);
        await using var reader = await state.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return NotFound(new { message = "交付物不存在。" });
        var code = reader.GetString(0);
        var versionCount = Convert.ToInt32(reader.GetInt64(1));
        var protectedVersions = Convert.ToInt32(reader.GetInt64(2));
        var changes = Convert.ToInt32(reader.GetInt64(3));
        var relations = Convert.ToInt32(reader.GetInt64(4));
        var baselineRefs = Convert.ToInt32(reader.GetInt64(5));
        await reader.CloseAsync();

        if (protectedVersions > 0)
            return Conflict(new { message = "该交付物仍存在审批中、已审批通过、已发布或已替代版本，不能删除。仅无版本、草稿版本或已作废版本可以清理。" });
        if (changes > 0 || relations > 0 || baselineRefs > 0)
            return Conflict(new { message = "该交付物仍存在变更、关联关系或产品基线引用，不能删除。" });

        await using (var lifecycleDelete = connection.CreateCommand())
        {
            lifecycleDelete.Transaction = transaction;
            lifecycleDelete.CommandText = "DELETE FROM LifecycleRecords WHERE DeliverableId=$id";
            lifecycleDelete.Parameters.AddWithValue("$id", id);
            await lifecycleDelete.ExecuteNonQueryAsync(ct);
        }
        await using (var unlink = connection.CreateCommand())
        {
            unlink.Transaction = transaction;
            unlink.CommandText = "UPDATE DeliverableVersions SET PreviousVersionId=NULL WHERE DeliverableId=$id";
            unlink.Parameters.AddWithValue("$id", id);
            await unlink.ExecuteNonQueryAsync(ct);
        }
        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM Deliverables WHERE Id=$id";
            delete.Parameters.AddWithValue("$id", id);
            await delete.ExecuteNonQueryAsync(ct);
        }
        await InsertAuditAsync(connection, transaction, "Deliverable", id, "DELETE", User.GetDisplayName(), $"删除交付物 {code}（包含 {versionCount} 个草稿/已作废版本）", ct);
        await transaction.CommitAsync(ct);
        return Ok(new { message = "交付物已删除。" });
    }

    [HttpDelete("product-baselines/{id:int}")]
    public async Task<IActionResult> DeleteProductBaseline(int id, CancellationToken ct)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var query = connection.CreateCommand();
        query.Transaction = transaction;
        query.CommandText = "SELECT ProductName,InternalVersion,VersionStatus FROM ProductBaselines WHERE Id=$id";
        query.Parameters.AddWithValue("$id", id);
        await using var reader = await query.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return NotFound(new { message = "产品基线不存在。" });
        var name = reader.GetString(0);
        var version = reader.GetString(1);
        var status = reader.GetString(2);
        await reader.CloseAsync();
        if (!string.Equals(status, "DRAFT", StringComparison.OrdinalIgnoreCase))
            return Conflict(new { message = "仅草稿状态的产品基线可以删除。" });

        await using (var dependency = connection.CreateCommand())
        {
            dependency.Transaction = transaction;
            dependency.CommandText = "SELECT COUNT(*) FROM ProductBaselines WHERE BasedOnBaselineId=$id";
            dependency.Parameters.AddWithValue("$id", id);
            if (Convert.ToInt32(await dependency.ExecuteScalarAsync(ct)) > 0)
                return Conflict(new { message = "该草稿已被其他产品基线引用，不能删除。" });
        }
        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM ProductBaselines WHERE Id=$id AND VersionStatus='DRAFT'";
            delete.Parameters.AddWithValue("$id", id);
            if (await delete.ExecuteNonQueryAsync(ct) == 0)
                return Conflict(new { message = "基线状态已变化，请刷新后重试。" });
        }
        await InsertAuditAsync(connection, transaction, "ProductBaseline", id, "DELETE_DRAFT", User.GetDisplayName(), $"删除产品基线草稿 {name} {version}", ct);
        await transaction.CommitAsync(ct);
        return Ok(new { message = "产品基线草稿已删除。" });
    }

    [HttpDelete("changes/{id:int}")]
    public async Task<IActionResult> DeleteChange(int id, CancellationToken ct)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var query = connection.CreateCommand();
        query.Transaction = transaction;
        query.CommandText = "SELECT ChangeCode,ChangeStatus,ToVersionId FROM ChangeRecords WHERE Id=$id";
        query.Parameters.AddWithValue("$id", id);
        await using var reader = await query.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return NotFound(new { message = "变更记录不存在。" });
        var code = reader.GetString(0);
        var status = reader.GetString(1);
        var toVersionId = reader.IsDBNull(2) ? (int?)null : reader.GetInt32(2);
        await reader.CloseAsync();
        if (!string.Equals(status, "PENDING_ASSESSMENT", StringComparison.OrdinalIgnoreCase) || toVersionId.HasValue)
            return Conflict(new { message = "仅尚未进入评审处理、且未生成变更版本的初始变更记录可以删除。" });

        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM ChangeRecords WHERE Id=$id AND ChangeStatus='PENDING_ASSESSMENT' AND ToVersionId IS NULL";
            delete.Parameters.AddWithValue("$id", id);
            if (await delete.ExecuteNonQueryAsync(ct) == 0)
                return Conflict(new { message = "变更状态已变化，请刷新后重试。" });
        }
        await InsertAuditAsync(connection, transaction, "Change", id, "DELETE_DRAFT", User.GetDisplayName(), $"删除待评估变更 {code}", ct);
        await transaction.CommitAsync(ct);
        return Ok(new { message = "待评估变更已删除。" });
    }

    private static async Task InsertAuditAsync(SqliteConnection connection, SqliteTransaction transaction, string entityType, int entityId, string action, string operatorName, string summary, CancellationToken ct)
    {
        await using var audit = connection.CreateCommand();
        audit.Transaction = transaction;
        audit.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES($type,$id,$action,$operator,$summary,$now)";
        audit.Parameters.AddWithValue("$type", entityType);
        audit.Parameters.AddWithValue("$id", entityId);
        audit.Parameters.AddWithValue("$action", action);
        audit.Parameters.AddWithValue("$operator", operatorName);
        audit.Parameters.AddWithValue("$summary", summary);
        audit.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        await audit.ExecuteNonQueryAsync(ct);
    }
}
