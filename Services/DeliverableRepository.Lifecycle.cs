using System.Text;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    public async Task<(int Id, string Code)> CreateAsync(DeliverableCreateRequest request, CancellationToken cancellationToken)
    {
        ValidateCreateRequest(request);
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();

        var codes = await ReadCodesAsync(connection, transaction, request.DepartmentId, request.DeliverableTypeId, request.ProjectId, cancellationToken);
        var categoryCode = await ValidateCategoryAsync(connection, transaction, request.CategoryId, request.DeliverableTypeId, cancellationToken);
        var prefix = $"AD-{codes.DepartmentCode}-{codes.TypeCode}-{codes.ProjectCode}-{categoryCode}";

        await using var sequenceCommand = connection.CreateCommand();
        sequenceCommand.Transaction = transaction;
        sequenceCommand.CommandText = "SELECT COUNT(*) + 1 FROM Deliverables WHERE DeliverableCode LIKE $prefix";
        sequenceCommand.Parameters.AddValue("$prefix", prefix + "-%");
        var sequence = Convert.ToInt32(await sequenceCommand.ExecuteScalarAsync(cancellationToken));
        var deliverableCode = $"{prefix}-{sequence:000}";
        var now = DateTime.UtcNow.ToString("O");

        await using var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = """
            INSERT INTO Deliverables(DeliverableCode, UnifiedName, DepartmentId, DeliverableTypeId, CategoryId, ProjectId,
                BusinessModule, ResponsiblePerson, DefaultConfidentiality, DefaultSharePolicy,
                Description, LifecycleStatus, CreatedBy, CreatedAt, UpdatedAt, Revision)
            VALUES($code,$name,$departmentId,$typeId,$categoryId,$projectId,$module,$owner,$confidentiality,
                $sharePolicy,$description,'ACTIVE',$operator,$now,$now,1);
            SELECT last_insert_rowid();
            """;
        insert.Parameters.AddValue("$code", deliverableCode);
        insert.Parameters.AddValue("$name", request.UnifiedName.Trim());
        insert.Parameters.AddValue("$departmentId", request.DepartmentId);
        insert.Parameters.AddValue("$typeId", request.DeliverableTypeId);
        insert.Parameters.AddValue("$categoryId", request.CategoryId);
        insert.Parameters.AddValue("$projectId", request.ProjectId);
        insert.Parameters.AddValue("$module", request.BusinessModule);
        insert.Parameters.AddValue("$owner", request.ResponsiblePerson.Trim());
        insert.Parameters.AddValue("$confidentiality", request.ConfidentialityLevel);
        insert.Parameters.AddValue("$sharePolicy", request.SharePolicy);
        insert.Parameters.AddValue("$description", request.Description);
        insert.Parameters.AddValue("$operator", request.Operator);
        insert.Parameters.AddValue("$now", now);
        var id = Convert.ToInt32(await insert.ExecuteScalarAsync(cancellationToken));

        await InsertVersionAsync(connection, transaction, id, deliverableCode, request.UnifiedName, codes.TypeCode,
            request.ConfidentialityLevel, request.SharePolicy, request.InitialVersion, null, cancellationToken);
        await InsertAuditAsync(connection, transaction, "Deliverable", id, "CREATE", request.Operator,
            $"新建交付物 {deliverableCode}", cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return (id, deliverableCode);
    }

    public async Task<bool> UpdateAsync(int id, DeliverableUpdateRequest request, CancellationToken cancellationToken)
    {
        if (request.CategoryId <= 0) throw new ArgumentException("请选择交付物类别。");
        if (string.IsNullOrWhiteSpace(request.UnifiedName) || string.IsNullOrWhiteSpace(request.ResponsiblePerson))
            throw new ArgumentException("统一名称和责任人不能为空。");

        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        await using (var typeCommand = connection.CreateCommand())
        {
            typeCommand.Transaction = transaction;
            typeCommand.CommandText = "SELECT DeliverableTypeId FROM Deliverables WHERE Id=$id";
            typeCommand.Parameters.AddValue("$id", id);
            var typeValue = await typeCommand.ExecuteScalarAsync(cancellationToken);
            if (typeValue is null) throw new KeyNotFoundException("交付物不存在。");
            await ValidateCategoryAsync(connection, transaction, request.CategoryId, Convert.ToInt32(typeValue), cancellationToken);
        }

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE Deliverables SET CategoryId=$categoryId, UnifiedName=$name, BusinessModule=$module, ResponsiblePerson=$owner,
                DefaultConfidentiality=$confidentiality, DefaultSharePolicy=$sharePolicy, Description=$description,
                UpdatedAt=$now, Revision=Revision+1
            WHERE Id=$id AND Revision=$revision;
            """;
        command.Parameters.AddValue("$categoryId", request.CategoryId);
        command.Parameters.AddValue("$name", request.UnifiedName.Trim());
        command.Parameters.AddValue("$module", request.BusinessModule);
        command.Parameters.AddValue("$owner", request.ResponsiblePerson.Trim());
        command.Parameters.AddValue("$confidentiality", request.ConfidentialityLevel);
        command.Parameters.AddValue("$sharePolicy", request.SharePolicy);
        command.Parameters.AddValue("$description", request.Description);
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddValue("$id", id);
        command.Parameters.AddValue("$revision", request.Revision);
        var affected = await command.ExecuteNonQueryAsync(cancellationToken);
        if (affected == 0) return false;

        await InsertAuditAsync(connection, transaction, "Deliverable", id, "UPDATE", request.Operator,
            "修改交付物基本信息", cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<int> AddVersionAsync(int deliverableId, VersionCreateRequest request, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();

        await using var master = connection.CreateCommand();
        master.Transaction = transaction;
        master.CommandText = """
            SELECT d.DeliverableCode,d.UnifiedName,t.TypeCode,d.DefaultConfidentiality,d.DefaultSharePolicy,
                   (SELECT Id FROM DeliverableVersions WHERE DeliverableId=d.Id ORDER BY CreatedAt DESC LIMIT 1)
            FROM Deliverables d JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
            WHERE d.Id=$id AND d.LifecycleStatus='ACTIVE';
            """;
        master.Parameters.AddValue("$id", deliverableId);
        await using var reader = await master.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new KeyNotFoundException("交付物不存在或已归档。");
        var code = reader.GetString(0);
        var name = reader.GetString(1);
        var typeCode = reader.GetString(2);
        var confidentiality = reader.GetString(3);
        var sharePolicy = reader.GetString(4);
        var previousId = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5);
        await reader.DisposeAsync();

        var versionId = await InsertVersionAsync(connection, transaction, deliverableId, code, name, typeCode,
            confidentiality, sharePolicy, request, previousId, cancellationToken);
        await InsertAuditAsync(connection, transaction, "Version", versionId, "CREATE", request.Operator,
            $"新增版本 {request.InternalVersion}", cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return versionId;
    }

    public async Task<string> TransitionVersionAsync(int versionId, string action, LifecycleActionRequest request, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();

        await using var query = connection.CreateCommand();
        query.Transaction = transaction;
        query.CommandText = "SELECT DeliverableId,VersionStatus,InternalVersion FROM DeliverableVersions WHERE Id=$id";
        query.Parameters.AddValue("$id", versionId);
        await using var reader = await query.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new KeyNotFoundException("版本不存在。");
        var deliverableId = reader.GetInt32(0);
        var fromStatus = reader.GetString(1);
        var internalVersion = reader.GetString(2);
        await reader.DisposeAsync();

        var normalizedAction = action.ToLowerInvariant();
        string toStatus;
        string actionType;
        switch (normalizedAction)
        {
            case "submit-review":
                if (fromStatus != "DRAFT") throw new InvalidOperationException("只有草稿版本可以提交审批。");
                toStatus = "IN_REVIEW"; actionType = "SUBMIT_REVIEW";
                break;
            case "return-draft":
                if (fromStatus != "IN_REVIEW") throw new InvalidOperationException("只有审批中的版本可以退回草稿。");
                toStatus = "DRAFT"; actionType = "RETURN_DRAFT";
                break;
            case "release":
                if (fromStatus != "IN_REVIEW") throw new InvalidOperationException("版本必须先提交审批，审批者才能正式发布。");
                toStatus = "RELEASED"; actionType = "RELEASE";
                await using (var supersede = connection.CreateCommand())
                {
                    supersede.Transaction = transaction;
                    supersede.CommandText = "UPDATE DeliverableVersions SET VersionStatus='SUPERSEDED',IsCurrent=0,UpdatedAt=$now WHERE DeliverableId=$deliverableId AND IsCurrent=1 AND Id<>$versionId";
                    supersede.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
                    supersede.Parameters.AddValue("$deliverableId", deliverableId);
                    supersede.Parameters.AddValue("$versionId", versionId);
                    await supersede.ExecuteNonQueryAsync(cancellationToken);
                }
                break;
            case "deprecate":
                if (fromStatus is "DRAFT" or "IN_REVIEW") throw new InvalidOperationException("未发布版本无需废止，可保留草稿或退回修改。");
                toStatus = "DEPRECATED"; actionType = "DEPRECATE";
                break;
            default:
                throw new ArgumentException("不支持的版本操作。");
        }

        var now = DateTime.UtcNow.ToString("O");
        await using (var update = connection.CreateCommand())
        {
            update.Transaction = transaction;
            update.CommandText = normalizedAction switch
            {
                "submit-review" => "UPDATE DeliverableVersions SET VersionStatus=$status,Reviewer=NULL,Approver=NULL,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='DRAFT'",
                "return-draft" => "UPDATE DeliverableVersions SET VersionStatus=$status,Reviewer=$operator,Approver=NULL,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='IN_REVIEW'",
                "release" => "UPDATE DeliverableVersions SET VersionStatus=$status,IsCurrent=1,Reviewer=COALESCE(Reviewer,$operator),Approver=$operator,ReleaseDate=COALESCE(ReleaseDate,$now),EffectiveDate=COALESCE(EffectiveDate,$now),UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='IN_REVIEW'",
                "deprecate" => "UPDATE DeliverableVersions SET VersionStatus=$status,IsCurrent=0,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus IN ('RELEASED','SUPERSEDED')",
                _ => throw new ArgumentException("不支持的版本操作。")
            };
            update.Parameters.AddValue("$status", toStatus);
            update.Parameters.AddValue("$operator", request.Operator);
            update.Parameters.AddValue("$now", now);
            update.Parameters.AddValue("$id", versionId);
            if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
                throw new InvalidOperationException("版本状态已发生变化，请刷新后重试。");
        }

        if (normalizedAction == "release")
        {
            await using var updateMaster = connection.CreateCommand();
            updateMaster.Transaction = transaction;
            updateMaster.CommandText = "UPDATE Deliverables SET CurrentVersionId=$versionId,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$deliverableId";
            updateMaster.Parameters.AddValue("$versionId", versionId);
            updateMaster.Parameters.AddValue("$now", now);
            updateMaster.Parameters.AddValue("$deliverableId", deliverableId);
            await updateMaster.ExecuteNonQueryAsync(cancellationToken);
        }
        else if (normalizedAction == "deprecate")
        {
            await using var updateMaster = connection.CreateCommand();
            updateMaster.Transaction = transaction;
            updateMaster.CommandText = "UPDATE Deliverables SET CurrentVersionId=CASE WHEN CurrentVersionId=$versionId THEN NULL ELSE CurrentVersionId END,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$deliverableId";
            updateMaster.Parameters.AddValue("$versionId", versionId);
            updateMaster.Parameters.AddValue("$now", now);
            updateMaster.Parameters.AddValue("$deliverableId", deliverableId);
            await updateMaster.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var lifecycle = connection.CreateCommand())
        {
            lifecycle.Transaction = transaction;
            lifecycle.CommandText = """
                INSERT INTO LifecycleRecords(DeliverableId,VersionId,ActionType,FromStatus,ToStatus,ActionReason,ReplacementVersionId,Operator,ActionAt)
                VALUES($deliverableId,$versionId,$actionType,$fromStatus,$toStatus,$reason,$replacement,$operator,$now);
                """;
            lifecycle.Parameters.AddValue("$deliverableId", deliverableId);
            lifecycle.Parameters.AddValue("$versionId", versionId);
            lifecycle.Parameters.AddValue("$actionType", actionType);
            lifecycle.Parameters.AddValue("$fromStatus", fromStatus);
            lifecycle.Parameters.AddValue("$toStatus", toStatus);
            lifecycle.Parameters.AddValue("$reason", request.Reason);
            lifecycle.Parameters.AddValue("$replacement", request.ReplacementVersionId);
            lifecycle.Parameters.AddValue("$operator", request.Operator);
            lifecycle.Parameters.AddValue("$now", now);
            await lifecycle.ExecuteNonQueryAsync(cancellationToken);
        }

        await InsertAuditAsync(connection, transaction, "Version", versionId, actionType, request.Operator,
            $"版本 {internalVersion}: {fromStatus} → {toStatus}", cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return toStatus;
    }

    private static async Task<string> ValidateCategoryAsync(SqliteConnection connection, SqliteTransaction transaction, int categoryId, int typeId, CancellationToken cancellationToken)
    {
        if (categoryId <= 0) throw new ArgumentException("请选择交付物类别。");
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT CategoryCode FROM DeliverableCategories WHERE Id=$categoryId AND DeliverableTypeId=$typeId AND IsEnabled=1";
        command.Parameters.AddValue("$categoryId", categoryId);
        command.Parameters.AddValue("$typeId", typeId);
        var value = await command.ExecuteScalarAsync(cancellationToken);
        if (value is null) throw new ArgumentException("所选交付物类别与交付物类型不匹配或已停用，请重新选择。" );
        return Convert.ToString(value)?.Trim().ToUpperInvariant() ?? throw new ArgumentException("交付物类别编码无效。");
    }
}
