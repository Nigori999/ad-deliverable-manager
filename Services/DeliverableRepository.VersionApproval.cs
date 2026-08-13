using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    public async Task<int> AddVersionWithOpenCyclePolicyAsync(
        int deliverableId,
        VersionCreateRequest request,
        CancellationToken cancellationToken = default)
    {
        await EnsureNoOpenVersionCycleAsync(deliverableId, cancellationToken);
        return await AddVersionAsync(deliverableId, request, cancellationToken);
    }

    public async Task<int> AddAutoVersionWithOpenCyclePolicyAsync(
        int deliverableId,
        string incrementType,
        VersionCreateRequest request,
        int? changeRecordId,
        CancellationToken cancellationToken = default)
    {
        await EnsureNoOpenVersionCycleAsync(deliverableId, cancellationToken);
        return await AddAutoVersionAsync(
            deliverableId, incrementType, request, changeRecordId, cancellationToken);
    }

    public async Task<string> TransitionVersionV072Async(
        int versionId,
        string action,
        LifecycleActionRequest request,
        CancellationToken cancellationToken)
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
                    throw new InvalidOperationException("版本必须先审批通过，进入待发布状态后才能正式发布。");
                await EnsureHighestVersionForReleaseAsync(
                    connection, transaction, deliverableId, versionId, internalVersion, cancellationToken);
                toStatus = "RELEASED";
                actionType = "RELEASE";
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
                if (fromStatus is "DRAFT" or "IN_REVIEW")
                    throw new InvalidOperationException("草稿或审批中的版本不能废止，请先完成或退回审批流程。");
                if (fromStatus is not ("READY_FOR_RELEASE" or "RELEASED" or "SUPERSEDED"))
                    throw new InvalidOperationException("当前版本状态不能执行废止操作。");
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
                "submit-review" => "UPDATE DeliverableVersions SET VersionStatus=$status,Reviewer=NULL,Approver=NULL,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='DRAFT'",
                "return-draft" => "UPDATE DeliverableVersions SET VersionStatus=$status,Reviewer=$operator,Approver=NULL,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='IN_REVIEW'",
                "approve" => "UPDATE DeliverableVersions SET VersionStatus=$status,Reviewer=$operator,Approver=NULL,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='IN_REVIEW'",
                "release" => "UPDATE DeliverableVersions SET VersionStatus=$status,IsCurrent=1,Approver=$operator,ReleaseDate=COALESCE(ReleaseDate,$now),EffectiveDate=COALESCE(EffectiveDate,$now),UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus='READY_FOR_RELEASE'",
                "deprecate" => "UPDATE DeliverableVersions SET VersionStatus=$status,IsCurrent=0,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND VersionStatus IN ('READY_FOR_RELEASE','RELEASED','SUPERSEDED')",
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

    private async Task EnsureHighestVersionForReleaseAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        int deliverableId,
        int versionId,
        string internalVersion,
        CancellationToken cancellationToken)
    {
        if (!TryParseVersion(internalVersion, out var current))
            throw new InvalidOperationException($"版本号 {internalVersion} 不符合三级版本规则，不能正式发布。");

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT Id,InternalVersion FROM DeliverableVersions WHERE DeliverableId=$deliverableId AND Id<>$versionId";
        command.Parameters.AddValue("$deliverableId", deliverableId);
        command.Parameters.AddValue("$versionId", versionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var candidateText = reader.GetString(1);
            if (!TryParseVersion(candidateText, out var candidate)) continue;
            if (CompareVersion(candidate, current) <= 0) continue;
            throw new InvalidOperationException(
                $"已存在更高版本 {candidateText}，{internalVersion} 不能再正式发布。请发布最高版本或废止不再使用的待发布版本。");
        }
    }

    private static int CompareVersion(
        (int Major, int Minor, int Patch) left,
        (int Major, int Minor, int Patch) right)
    {
        var major = left.Major.CompareTo(right.Major);
        if (major != 0) return major;
        var minor = left.Minor.CompareTo(right.Minor);
        return minor != 0 ? minor : left.Patch.CompareTo(right.Patch);
    }
}
