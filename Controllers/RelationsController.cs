using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/relations")]
[Authorize]
public sealed class RelationsController : ControllerBase
{
    private static readonly string[] AllowedTypes = ["DERIVES", "VERIFIES", "DEPENDS_ON", "REFERENCES", "REPLACES"];
    private readonly DatabaseService _database;

    public RelationsController(DatabaseService database) => _database = database;

    [HttpGet("deliverable/{deliverableId:int}")]
    public async Task<IActionResult> GetForDeliverable(int deliverableId, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT r.Id,r.SourceDeliverableId,sd.DeliverableCode,sd.UnifiedName,st.TypeCode,
                   r.SourceVersionId,sv.InternalVersion,
                   r.TargetDeliverableId,td.DeliverableCode,td.UnifiedName,tt.TypeCode,
                   r.TargetVersionId,tv.InternalVersion,r.RelationType,r.Description,r.CreatedAt
            FROM DeliverableRelations r
            JOIN Deliverables sd ON sd.Id=r.SourceDeliverableId
            JOIN DeliverableTypes st ON st.Id=sd.DeliverableTypeId
            JOIN Deliverables td ON td.Id=r.TargetDeliverableId
            JOIN DeliverableTypes tt ON tt.Id=td.DeliverableTypeId
            LEFT JOIN DeliverableVersions sv ON sv.Id=r.SourceVersionId
            LEFT JOIN DeliverableVersions tv ON tv.Id=r.TargetVersionId
            WHERE r.SourceDeliverableId=$id OR r.TargetDeliverableId=$id
            ORDER BY r.CreatedAt DESC;
            """;
        command.Parameters.AddWithValue("$id", deliverableId);
        var items = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new
            {
                id=reader.GetInt32(0), sourceDeliverableId=reader.GetInt32(1), sourceCode=reader.GetString(2),
                sourceName=reader.GetString(3), sourceTypeCode=reader.GetString(4),
                sourceVersionId=reader.IsDBNull(5)?(int?)null:reader.GetInt32(5), sourceVersion=reader.GetNullableString(6),
                targetDeliverableId=reader.GetInt32(7), targetCode=reader.GetString(8), targetName=reader.GetString(9),
                targetTypeCode=reader.GetString(10), targetVersionId=reader.IsDBNull(11)?(int?)null:reader.GetInt32(11),
                targetVersion=reader.GetNullableString(12), relationType=reader.GetString(13), description=reader.GetNullableString(14),
                createdAt=reader.GetString(15), direction=reader.GetInt32(1)==deliverableId?"OUTGOING":"INCOMING"
            });
        }
        return Ok(new { items, relationTypes = RelationTypes() });
    }

    [HttpGet("candidates")]
    public async Task<IActionResult> Candidates([FromQuery] int? excludeId, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT d.Id,d.DeliverableCode,d.UnifiedName,t.TypeCode,t.TypeName,p.ProjectName,d.CurrentVersionId,v.InternalVersion
            FROM Deliverables d
            JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
            JOIN Projects p ON p.Id=d.ProjectId
            LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId
            WHERE d.LifecycleStatus='ACTIVE' AND ($excludeId IS NULL OR d.Id<>$excludeId)
            ORDER BY p.ProjectName,t.SortOrder,d.DeliverableCode;
            """;
        command.Parameters.AddValue("$excludeId", excludeId);
        var items = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new
            {
                id=reader.GetInt32(0), code=reader.GetString(1), name=reader.GetString(2), typeCode=reader.GetString(3),
                type=reader.GetString(4), project=reader.GetString(5), currentVersionId=reader.IsDBNull(6)?(int?)null:reader.GetInt32(6),
                currentVersion=reader.GetNullableString(7)
            });
        }
        return Ok(new { items });
    }

    [HttpGet("versions/{deliverableId:int}")]
    public async Task<IActionResult> Versions(int deliverableId, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id,InternalVersion,VersionStatus FROM DeliverableVersions WHERE DeliverableId=$id ORDER BY CreatedAt DESC";
        command.Parameters.AddWithValue("$id", deliverableId);
        var items = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
            items.Add(new { id=reader.GetInt32(0), version=reader.GetString(1), status=reader.GetString(2) });
        return Ok(new { items });
    }

    [HttpPost]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Editor)]
    public async Task<IActionResult> Create([FromBody] RelationCreateRequest request, CancellationToken cancellationToken)
    {
        if (request.SourceDeliverableId <= 0 || request.TargetDeliverableId <= 0)
            return BadRequest(new { message = "必须选择源交付物和目标交付物。" });
        if (request.SourceDeliverableId == request.TargetDeliverableId)
            return BadRequest(new { message = "交付物不能与自身建立关联。" });
        if (!AllowedTypes.Contains(request.RelationType, StringComparer.Ordinal))
            return BadRequest(new { message = "关联类型无效。" });

        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        if (!await DeliverableExistsAsync(connection, transaction, request.SourceDeliverableId, cancellationToken)
            || !await DeliverableExistsAsync(connection, transaction, request.TargetDeliverableId, cancellationToken))
            return BadRequest(new { message = "源交付物或目标交付物不存在。" });
        if (!await VersionBelongsAsync(connection, transaction, request.SourceVersionId, request.SourceDeliverableId, cancellationToken)
            || !await VersionBelongsAsync(connection, transaction, request.TargetVersionId, request.TargetDeliverableId, cancellationToken))
            return BadRequest(new { message = "所选版本不属于对应交付物。" });

        await using var duplicate = connection.CreateCommand();
        duplicate.Transaction = transaction;
        duplicate.CommandText = """
            SELECT COUNT(*) FROM DeliverableRelations
            WHERE SourceDeliverableId=$source AND TargetDeliverableId=$target AND RelationType=$type
              AND COALESCE(SourceVersionId,0)=COALESCE($sourceVersion,0)
              AND COALESCE(TargetVersionId,0)=COALESCE($targetVersion,0);
            """;
        duplicate.Parameters.AddValue("$source", request.SourceDeliverableId);
        duplicate.Parameters.AddValue("$target", request.TargetDeliverableId);
        duplicate.Parameters.AddValue("$type", request.RelationType);
        duplicate.Parameters.AddValue("$sourceVersion", request.SourceVersionId);
        duplicate.Parameters.AddValue("$targetVersion", request.TargetVersionId);
        if (Convert.ToInt32(await duplicate.ExecuteScalarAsync(cancellationToken)) > 0)
            return Conflict(new { message = "相同关联关系已经存在。" });

        var now = DateTime.UtcNow.ToString("O");
        await using var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = """
            INSERT INTO DeliverableRelations(SourceDeliverableId,SourceVersionId,TargetDeliverableId,TargetVersionId,RelationType,Description,CreatedAt)
            VALUES($source,$sourceVersion,$target,$targetVersion,$type,$description,$now);
            SELECT last_insert_rowid();
            """;
        insert.Parameters.AddValue("$source", request.SourceDeliverableId);
        insert.Parameters.AddValue("$sourceVersion", request.SourceVersionId);
        insert.Parameters.AddValue("$target", request.TargetDeliverableId);
        insert.Parameters.AddValue("$targetVersion", request.TargetVersionId);
        insert.Parameters.AddValue("$type", request.RelationType);
        insert.Parameters.AddValue("$description", request.Description);
        insert.Parameters.AddValue("$now", now);
        var id = Convert.ToInt32(await insert.ExecuteScalarAsync(cancellationToken));
        await InsertAuditAsync(connection, transaction, id, "CREATE_RELATION", User.GetDisplayName(),
            $"建立交付物关联 {request.RelationType}", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new { id, message = "交付物关联已建立。" });
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = AppRoles.Admin + "," + AppRoles.Editor)]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM DeliverableRelations WHERE Id=$id";
        command.Parameters.AddWithValue("$id", id);
        if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
            return NotFound(new { message = "关联关系不存在。" });
        var now = DateTime.UtcNow.ToString("O");
        await InsertAuditAsync(connection, transaction, id, "DELETE_RELATION", User.GetDisplayName(),
            "删除交付物关联", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return Ok(new { message = "关联关系已删除。" });
    }

    private static object[] RelationTypes() =>
    [
        new { code="DERIVES", name="派生" }, new { code="VERIFIES", name="验证" },
        new { code="DEPENDS_ON", name="依赖" }, new { code="REFERENCES", name="引用" },
        new { code="REPLACES", name="替代" }
    ];

    private static async Task<bool> DeliverableExistsAsync(SqliteConnection connection, SqliteTransaction transaction,
        int id, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*) FROM Deliverables WHERE Id=$id"; command.Parameters.AddWithValue("$id", id);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) > 0;
    }

    private static async Task<bool> VersionBelongsAsync(SqliteConnection connection, SqliteTransaction transaction,
        int? versionId, int deliverableId, CancellationToken cancellationToken)
    {
        if (!versionId.HasValue) return true;
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*) FROM DeliverableVersions WHERE Id=$versionId AND DeliverableId=$deliverableId";
        command.Parameters.AddWithValue("$versionId", versionId); command.Parameters.AddWithValue("$deliverableId", deliverableId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) > 0;
    }

    private static async Task InsertAuditAsync(SqliteConnection connection, SqliteTransaction transaction, int id,
        string action, string operatorName, string summary, string now, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES('Relation',$id,$action,$operator,$summary,$now)";
        command.Parameters.AddValue("$id", id); command.Parameters.AddValue("$action", action);
        command.Parameters.AddValue("$operator", operatorName); command.Parameters.AddValue("$summary", summary); command.Parameters.AddValue("$now", now);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
