using System.Text;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    public async Task ArchiveAsync(int id, string operatorName, string? reason, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "UPDATE Deliverables SET LifecycleStatus='ARCHIVED',UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id";
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddValue("$id", id);
        if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) throw new KeyNotFoundException("交付物不存在。" );
        await InsertAuditAsync(connection, transaction, "Deliverable", id, "ARCHIVE", operatorName, reason ?? "归档交付物", cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static void ValidateCreateRequest(DeliverableCreateRequest request)
    {
        if (request.DepartmentId <= 0 || request.DeliverableTypeId <= 0 || request.CategoryId <= 0 || request.ProjectId <= 0)
            throw new ArgumentException("部门、交付物类型、交付物类别和项目必须选择。" );
        if (string.IsNullOrWhiteSpace(request.UnifiedName))
            throw new ArgumentException("统一名称不能为空。" );
        if (string.IsNullOrWhiteSpace(request.ResponsiblePerson))
            throw new ArgumentException("责任人不能为空。" );
        if (string.IsNullOrWhiteSpace(request.InitialVersion.InternalVersion) ||
            string.IsNullOrWhiteSpace(request.InitialVersion.OriginalFileName) ||
            string.IsNullOrWhiteSpace(request.InitialVersion.ServerPath) ||
            string.IsNullOrWhiteSpace(request.InitialVersion.Author))
            throw new ArgumentException("首个版本的版本号、原始文件名、服务器路径和编制人不能为空。" );
    }

    private static async Task<(string DepartmentCode, string TypeCode, string ProjectCode)> ReadCodesAsync(
        SqliteConnection connection, SqliteTransaction transaction, int departmentId, int typeId, int projectId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT d.DepartmentCode,t.TypeCode,p.ProjectCode
            FROM Departments d, DeliverableTypes t, Projects p
            WHERE d.Id=$departmentId AND t.Id=$typeId AND p.Id=$projectId;
            """;
        command.Parameters.AddValue("$departmentId", departmentId);
        command.Parameters.AddValue("$typeId", typeId);
        command.Parameters.AddValue("$projectId", projectId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new ArgumentException("部门、类型或项目基础数据无效。" );
        return (reader.GetString(0), reader.GetString(1), reader.GetString(2));
    }

    private static async Task<int> InsertVersionAsync(
        SqliteConnection connection, SqliteTransaction transaction, int deliverableId, string deliverableCode,
        string unifiedName, string typeCode, string confidentiality, string sharePolicy,
        VersionCreateRequest request, int? previousVersionId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.InternalVersion) || string.IsNullOrWhiteSpace(request.OriginalFileName) ||
            string.IsNullOrWhiteSpace(request.ServerPath) || string.IsNullOrWhiteSpace(request.Author))
            throw new ArgumentException("版本号、原始文件名、服务器路径和编制人不能为空。" );

        var version = NormalizeVersion(request.InternalVersion);
        var extension = ResolveExtension(request.FileExtension, request.OriginalFileName);
        var unifiedFileName = BuildUnifiedFileName(deliverableCode, unifiedName, version, "DFT", extension);
        var now = DateTime.UtcNow.ToString("O");

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO DeliverableVersions(DeliverableId,InternalVersion,OriginalVersion,OriginalFileName,
                UnifiedFileName,PreviousVersionId,ServerPath,FileExtension,FileSize,HashAlgorithm,HashValue,
                VersionStatus,ChangeSummary,ConfidentialityLevel,SharePolicy,Author,PlannedReleaseDate,
                IsCurrent,CreatedBy,CreatedAt,UpdatedAt,Revision)
            VALUES($deliverableId,$version,$originalVersion,$originalFileName,$unifiedFileName,$previousVersionId,
                $serverPath,$extension,$fileSize,$hashAlgorithm,$hashValue,'DRAFT',$changeSummary,$confidentiality,
                $sharePolicy,$author,$plannedReleaseDate,0,$operator,$now,$now,1);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddValue("$deliverableId", deliverableId);
        command.Parameters.AddValue("$version", version);
        command.Parameters.AddValue("$originalVersion", request.OriginalVersion);
        command.Parameters.AddValue("$originalFileName", request.OriginalFileName.Trim());
        command.Parameters.AddValue("$unifiedFileName", unifiedFileName);
        command.Parameters.AddValue("$previousVersionId", previousVersionId);
        command.Parameters.AddValue("$serverPath", request.ServerPath.Trim());
        command.Parameters.AddValue("$extension", extension);
        command.Parameters.AddValue("$fileSize", request.FileSize);
        command.Parameters.AddValue("$hashAlgorithm", request.HashAlgorithm);
        command.Parameters.AddValue("$hashValue", request.HashValue);
        command.Parameters.AddValue("$changeSummary", request.ChangeSummary);
        command.Parameters.AddValue("$confidentiality", confidentiality);
        command.Parameters.AddValue("$sharePolicy", sharePolicy);
        command.Parameters.AddValue("$author", request.Author.Trim());
        command.Parameters.AddValue("$plannedReleaseDate", request.PlannedReleaseDate);
        command.Parameters.AddValue("$operator", request.Operator);
        command.Parameters.AddValue("$now", now);
        var versionId = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));

        switch (typeCode)
        {
            case "SWP" when request.Hardware is not null:
                await InsertHardwareAsync(connection, transaction, versionId, request.Hardware, cancellationToken);
                break;
            case "PRD" when request.Prd is not null:
                await InsertPrdAsync(connection, transaction, versionId, request.Prd, cancellationToken);
                break;
            case "FR" when request.Fr is not null:
                await InsertFrAsync(connection, transaction, versionId, request.Fr, cancellationToken);
                break;
            case "TC" when request.TestCase is not null:
                await InsertTestCaseAsync(connection, transaction, versionId, request.TestCase, cancellationToken);
                break;
        }
        return versionId;
    }
}
