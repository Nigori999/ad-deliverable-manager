using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    public async Task<string> TransitionVersionV073Async(
        int versionId,
        string action,
        LifecycleActionRequest request,
        CancellationToken cancellationToken = default)
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
                toStatus = "IN_REVIEW";
                actionType = "SUBMIT_REVIEW";
                break;
            case "return-draft":
                if (fromStatus != "IN_REVIEW") throw new InvalidOperationException("只有审批中的版本可以退回草稿。");
                toStatus = "DRAFT";
                actionType = "RETURN_DRAFT";
                break;
            case "approve":
                if (fromStatus != "IN_REVIEW") throw new InvalidOperationException("只有审批中的版本可以审批通过。");
                toStatus = "READY_FOR_RELEASE";
                actionType = "APPROVE";
                break;
            case "release":
                if (fromStatus != "READY_FOR_RELEASE")
                    throw new InvalidOperationException("只有已经审批通过、处于待发布状态的版本可以正式发布。");

                var highestActive = await GetHighestEffectiveVersionIdAsync(connection, transaction, deliverableId, cancellationToken);
                if (highestActive != versionId)
                    throw new InvalidOperationException("该版本不是当前最高有效版本，不能正式发布。请先处理更高版本；已废止版本不参与发布排序。");

                toStatus = "RELEASED";
                actionType = "RELEASE";
                break;
            case "deprecate":
                if (fromStatus == "RELEASED")
                    throw new InvalidOperationException("当前正式版本不能直接废止，请先通过变更发布新的正式版本。");
                if (fromStatus is not ("DRAFT" or "IN_REVIEW" or "READY_FOR_RELEASE" or "SUPERSEDED"))
                    throw new InvalidOperationException("当前状态不允许废止。");
                toStatus = "DEPRECATED";
                actionType = "DEPRECATE";
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
                "submit-review" => "UPDATE DeliverableVersions SET VersionStatus='IN_REVIEW',Reviewer=NULL,Approver=NULL,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='DRAFT'",
                "return-draft" => "UPDATE DeliverableVersions SET VersionStatus='DRAFT',Reviewer=$operator,Approver=NULL,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='IN_REVIEW'",
                "approve" => "UPDATE DeliverableVersions SET VersionStatus='READY_FOR_RELEASE',Reviewer=$operator,Approver=$operator,ReleaseDate=NULL,EffectiveDate=NULL,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='IN_REVIEW'",
                "release" => "UPDATE DeliverableVersions SET VersionStatus='RELEASED',IsCurrent=1,Approver=COALESCE(Approver,$operator),ReleaseDate=COALESCE(ReleaseDate,$now),EffectiveDate=COALESCE(EffectiveDate,$now),UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='READY_FOR_RELEASE'",
                "deprecate" => "UPDATE DeliverableVersions SET VersionStatus='DEPRECATED',IsCurrent=0,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus IN ('DRAFT','IN_REVIEW','READY_FOR_RELEASE','SUPERSEDED')",
                _ => throw new ArgumentException("不支持的版本操作。")
            };
            update.Parameters.AddValue("$operator", request.Operator);
            update.Parameters.AddValue("$now", now);
            update.Parameters.AddValue("$id", versionId);
            if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
                throw new InvalidOperationException("版本状态已发生变化，请刷新后重试。");
        }

        if (normalizedAction == "release")
        {
            await using var supersede = connection.CreateCommand();
            supersede.Transaction = transaction;
            supersede.CommandText = "UPDATE DeliverableVersions SET VersionStatus='SUPERSEDED',IsCurrent=0,UpdatedAt=$now WHERE DeliverableId=$deliverableId AND IsCurrent=1 AND Id<>$versionId";
            supersede.Parameters.AddValue("$now", now);
            supersede.Parameters.AddValue("$deliverableId", deliverableId);
            supersede.Parameters.AddValue("$versionId", versionId);
            await supersede.ExecuteNonQueryAsync(cancellationToken);

            await using var updateMaster = connection.CreateCommand();
            updateMaster.Transaction = transaction;
            updateMaster.CommandText = "UPDATE Deliverables SET CurrentVersionId=$versionId,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$deliverableId";
            updateMaster.Parameters.AddValue("$versionId", versionId);
            updateMaster.Parameters.AddValue("$now", now);
            updateMaster.Parameters.AddValue("$deliverableId", deliverableId);
            await updateMaster.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var lifecycle = connection.CreateCommand();
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

        await InsertAuditAsync(connection, transaction, "Version", versionId, actionType, request.Operator,
            $"版本 {internalVersion}: {fromStatus} → {toStatus}", cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return toStatus;
    }

    private static async Task<int> GetHighestEffectiveVersionIdAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        int deliverableId,
        CancellationToken cancellationToken)
    {
        var candidates = new List<(int Id, int Major, int Minor, int Patch)>();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT Id,InternalVersion,VersionStatus FROM DeliverableVersions WHERE DeliverableId=$id AND VersionStatus <> 'DEPRECATED'";
        command.Parameters.AddValue("$id", deliverableId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            if (TryParseVersionV073(reader.GetString(1), out var version))
                candidates.Add((reader.GetInt32(0), version.Major, version.Minor, version.Patch));
        }

        return candidates
            .OrderByDescending(x => x.Major)
            .ThenByDescending(x => x.Minor)
            .ThenByDescending(x => x.Patch)
            .Select(x => x.Id)
            .FirstOrDefault();
    }

    private static bool TryParseVersionV073(string value, out (int Major, int Minor, int Patch) version)
    {
        version = default;
        var text = (value ?? string.Empty).Trim();
        if (text.StartsWith('V') || text.StartsWith('v')) text = text[1..];
        var parts = text.Split('.');
        if (parts.Length != 3 || !int.TryParse(parts[0], out var major)
            || !int.TryParse(parts[1], out var minor) || !int.TryParse(parts[2], out var patch)
            || major < 0 || minor < 0 || patch < 0) return false;
        version = (major, minor, patch);
        return true;
    }
}
