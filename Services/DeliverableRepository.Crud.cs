using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    public async Task EnsureDraftDeliverableEditableAsync(int deliverableId, int requestedCategoryId, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT d.CategoryId,
                   (SELECT COUNT(*) FROM DeliverableVersions v WHERE v.DeliverableId=d.Id),
                   (SELECT COUNT(*) FROM DeliverableVersions v WHERE v.DeliverableId=d.Id AND v.VersionStatus<>'DRAFT')
            FROM Deliverables d WHERE d.Id=$id;
            """;
        command.Parameters.AddValue("$id", deliverableId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) throw new KeyNotFoundException("交付物不存在。" );
        if (reader.GetInt32(0) != requestedCategoryId) throw new InvalidOperationException("交付物类别参与唯一编码生成，创建后不能通过普通编辑修改。" );
        if (reader.GetInt64(1) == 0) throw new InvalidOperationException("交付物没有版本，不能直接编辑。" );
        if (reader.GetInt64(2) > 0) throw new InvalidOperationException("交付物已经进入审批或正式流程，不能直接编辑主档。请通过对应流程处理。" );
    }

    public async Task UpdateDraftVersionAsync(int versionId, VersionCreateRequest request, string operatorName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.OriginalFileName) || string.IsNullOrWhiteSpace(request.ServerPath) || string.IsNullOrWhiteSpace(request.Author))
            throw new ArgumentException("原始文件名、服务器路径和编制人不能为空。" );

        await using var connection = await _database.OpenConnectionAsync(ct);
        using var tx = connection.BeginTransaction();
        int deliverableId; string deliverableCode; string unifiedName; string typeCode; string internalVersion;
        await using (var read = connection.CreateCommand())
        {
            read.Transaction = tx;
            read.CommandText = """
                SELECT v.DeliverableId,v.VersionStatus,d.DeliverableCode,d.UnifiedName,t.TypeCode,v.InternalVersion
                FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
                WHERE v.Id=$id;
                """;
            read.Parameters.AddValue("$id", versionId);
            await using var reader = await read.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) throw new KeyNotFoundException("版本不存在。" );
            if (!string.Equals(reader.GetString(1), "DRAFT", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("只有草稿版本可以直接编辑。" );
            deliverableId = reader.GetInt32(0); deliverableCode = reader.GetString(2); unifiedName = reader.GetString(3); typeCode = reader.GetString(4); internalVersion = reader.GetString(5);
        }

        var extension = ResolveExtension(request.FileExtension, request.OriginalFileName);
        var unifiedFileName = BuildUnifiedFileName(deliverableCode, unifiedName, internalVersion, "DFT", extension);
        var now = DateTime.UtcNow.ToString("O");
        await using (var update = connection.CreateCommand())
        {
            update.Transaction = tx;
            update.CommandText = """
                UPDATE DeliverableVersions SET OriginalVersion=$originalVersion,OriginalFileName=$originalFileName,UnifiedFileName=$unifiedFileName,
                    ServerPath=$serverPath,FileExtension=$extension,FileSize=COALESCE($fileSize,FileSize),HashAlgorithm=$hashAlgorithm,HashValue=$hashValue,
                    ChangeSummary=$changeSummary,Author=$author,PlannedReleaseDate=$planned,UpdatedAt=$now,Revision=Revision+1
                WHERE Id=$id AND VersionStatus='DRAFT';
                """;
            update.Parameters.AddValue("$originalVersion", request.OriginalVersion);
            update.Parameters.AddValue("$originalFileName", request.OriginalFileName.Trim());
            update.Parameters.AddValue("$unifiedFileName", unifiedFileName);
            update.Parameters.AddValue("$serverPath", request.ServerPath.Trim());
            update.Parameters.AddValue("$extension", extension);
            update.Parameters.AddValue("$fileSize", request.FileSize);
            update.Parameters.AddValue("$hashAlgorithm", request.HashAlgorithm);
            update.Parameters.AddValue("$hashValue", request.HashValue);
            update.Parameters.AddValue("$changeSummary", request.ChangeSummary);
            update.Parameters.AddValue("$author", request.Author.Trim());
            update.Parameters.AddValue("$planned", request.PlannedReleaseDate);
            update.Parameters.AddValue("$now", now); update.Parameters.AddValue("$id", versionId);
            if (await update.ExecuteNonQueryAsync(ct) == 0) throw new InvalidOperationException("版本状态已变化，请刷新后重试。" );
        }

        foreach (var table in new[] { "HardwarePackageDetails", "PrdDetails", "FrDetails", "TestCaseDetails" })
        {
            await using var delete = connection.CreateCommand(); delete.Transaction = tx; delete.CommandText = $"DELETE FROM {table} WHERE VersionId=$id"; delete.Parameters.AddValue("$id", versionId); await delete.ExecuteNonQueryAsync(ct);
        }
        if (typeCode == "SWP" && request.Hardware is not null) await InsertHardwareAsync(connection, tx, versionId, request.Hardware, ct);
        if (typeCode == "PRD" && request.Prd is not null) await InsertPrdAsync(connection, tx, versionId, request.Prd, ct);
        if (typeCode == "FR" && request.Fr is not null) await InsertFrAsync(connection, tx, versionId, request.Fr, ct);
        if (typeCode == "TC" && request.TestCase is not null) await InsertTestCaseAsync(connection, tx, versionId, request.TestCase, ct);
        await InsertAuditAsync(connection, tx, "Version", versionId, "EDIT_DRAFT", operatorName, $"编辑草稿版本 {internalVersion}", ct);
        await tx.CommitAsync(ct);
    }

    public async Task DeleteDraftVersionAsync(int versionId, string operatorName, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var tx = connection.BeginTransaction();
        int deliverableId; string version;
        await using (var read = connection.CreateCommand())
        {
            read.Transaction = tx; read.CommandText = "SELECT DeliverableId,InternalVersion,VersionStatus FROM DeliverableVersions WHERE Id=$id"; read.Parameters.AddValue("$id", versionId);
            await using var reader = await read.ExecuteReaderAsync(ct); if (!await reader.ReadAsync(ct)) throw new KeyNotFoundException("版本不存在。" );
            deliverableId = reader.GetInt32(0); version = reader.GetString(1); if (!string.Equals(reader.GetString(2), "DRAFT", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("只有草稿版本可以删除。" );
        }
        await using (var count = connection.CreateCommand())
        {
            count.Transaction = tx; count.CommandText = "SELECT COUNT(*) FROM DeliverableVersions WHERE DeliverableId=$id"; count.Parameters.AddValue("$id", deliverableId);
            if (Convert.ToInt32(await count.ExecuteScalarAsync(ct)) <= 1) throw new InvalidOperationException("不能单独删除交付物的唯一草稿版本；如需清理，请删除整个草稿交付物。" );
        }
        await using (var refs = connection.CreateCommand())
        {
            refs.Transaction = tx; refs.CommandText = """
                SELECT (SELECT COUNT(*) FROM ChangeRecords WHERE FromVersionId=$id OR ToVersionId=$id)
                     + (SELECT COUNT(*) FROM ProductBaselineHardware WHERE SoftwareVersionId=$id)
                     + (SELECT COUNT(*) FROM ProductBaselineDeliverables WHERE VersionId=$id)
                     + (SELECT COUNT(*) FROM DeliverableRelations WHERE SourceVersionId=$id OR TargetVersionId=$id)
                     + (SELECT COUNT(*) FROM LifecycleRecords WHERE VersionId=$id OR ReplacementVersionId=$id)
                     + (SELECT COUNT(*) FROM DeliverableVersions WHERE PreviousVersionId=$id);
                """; refs.Parameters.AddValue("$id", versionId);
            if (Convert.ToInt32(await refs.ExecuteScalarAsync(ct)) > 0) throw new InvalidOperationException("该草稿版本已经被流程、基线或关联关系引用，不能删除。" );
        }
        await using (var delete = connection.CreateCommand()) { delete.Transaction = tx; delete.CommandText = "DELETE FROM DeliverableVersions WHERE Id=$id AND VersionStatus='DRAFT'"; delete.Parameters.AddValue("$id", versionId); if (await delete.ExecuteNonQueryAsync(ct) == 0) throw new InvalidOperationException("版本状态已变化，请刷新后重试。" ); }
        await InsertAuditAsync(connection, tx, "Version", versionId, "DELETE_DRAFT", operatorName, $"删除草稿版本 {version}", ct);
        await tx.CommitAsync(ct);
    }
}
