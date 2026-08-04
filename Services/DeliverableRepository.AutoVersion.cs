using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    private static readonly HashSet<string> VersionIncrementTypes =
        new(StringComparer.OrdinalIgnoreCase) { "MAJOR", "MINOR", "PATCH" };

    public async Task<object> GetVersionPreviewAsync(
        int deliverableId,
        string incrementType,
        CancellationToken cancellationToken = default)
    {
        var normalizedType = NormalizeIncrementType(incrementType);
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);

        await using (var exists = connection.CreateCommand())
        {
            exists.CommandText = "SELECT COUNT(*) FROM Deliverables WHERE Id=$id AND LifecycleStatus='ACTIVE'";
            exists.Parameters.AddValue("$id", deliverableId);
            if (Convert.ToInt32(await exists.ExecuteScalarAsync(cancellationToken)) == 0)
                throw new KeyNotFoundException("交付物不存在或已归档。");
        }

        var versions = new List<(int Major, int Minor, int Patch)>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT InternalVersion FROM DeliverableVersions WHERE DeliverableId=$id";
            command.Parameters.AddValue("$id", deliverableId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                if (TryParseVersion(reader.GetString(0), out var parsed)) versions.Add(parsed);
            }
        }

        var current = versions.Count == 0
            ? (Major: 0, Minor: 0, Patch: 0)
            : versions.OrderByDescending(x => x.Major)
                .ThenByDescending(x => x.Minor)
                .ThenByDescending(x => x.Patch)
                .First();
        var next = CalculateNext(current, normalizedType);

        return new
        {
            incrementType = normalizedType,
            baseVersion = FormatVersion(current),
            nextVersion = FormatVersion(next),
            rule = normalizedType switch
            {
                "MAJOR" => "重大版本：主版本号加1，次版本号和修订号归零。",
                "MINOR" => "功能版本：次版本号加1，修订号归零。",
                _ => "修订版本：修订号加1。"
            }
        };
    }

    public async Task<int> AddAutoVersionAsync(
        int deliverableId,
        string incrementType,
        VersionCreateRequest request,
        int? changeRecordId,
        CancellationToken cancellationToken = default)
    {
        var normalizedType = NormalizeIncrementType(incrementType);
        if (changeRecordId.HasValue)
            await ValidateChangeLinkAsync(changeRecordId.Value, deliverableId, cancellationToken);

        for (var attempt = 0; attempt < 2; attempt++)
        {
            dynamic preview = await GetVersionPreviewAsync(deliverableId, normalizedType, cancellationToken);
            request.InternalVersion = preview.nextVersion;

            try
            {
                var versionId = await AddVersionAsync(deliverableId, request, cancellationToken);
                if (changeRecordId.HasValue)
                    await LinkChangeVersionAsync(changeRecordId.Value, deliverableId, versionId, request.Operator, cancellationToken);
                return versionId;
            }
            catch (SqliteException ex) when (ex.SqliteErrorCode == 19 && attempt == 0)
            {
                // 并发创建了相同版本号，重新读取现有最高版本后再计算一次。
            }
        }

        throw new InvalidOperationException("版本号已被其他操作占用，请刷新后重试。");
    }

    private async Task ValidateChangeLinkAsync(
        int changeRecordId,
        int deliverableId,
        CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT DeliverableId,ChangeStatus,ToVersionId FROM ChangeRecords WHERE Id=$id";
        command.Parameters.AddValue("$id", changeRecordId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new KeyNotFoundException("变更记录不存在。");
        if (reader.GetInt32(0) != deliverableId) throw new InvalidOperationException("变更记录与交付物不匹配。");
        if (!string.Equals(reader.GetString(1), "IMPLEMENTING", StringComparison.Ordinal))
            throw new InvalidOperationException("只有实施中的变更可以创建变更版本。");
        if (!reader.IsDBNull(2)) throw new InvalidOperationException("该变更已经关联了变更后版本。");
    }

    private async Task LinkChangeVersionAsync(
        int changeRecordId,
        int deliverableId,
        int versionId,
        string operatorName,
        CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        var now = DateTime.UtcNow.ToString("O");

        await using var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = """
            UPDATE ChangeRecords SET ToVersionId=$versionId,UpdatedAt=$now
            WHERE Id=$changeId AND DeliverableId=$deliverableId AND ChangeStatus='IMPLEMENTING' AND ToVersionId IS NULL;
            """;
        update.Parameters.AddValue("$versionId", versionId);
        update.Parameters.AddValue("$now", now);
        update.Parameters.AddValue("$changeId", changeRecordId);
        update.Parameters.AddValue("$deliverableId", deliverableId);

        if (await update.ExecuteNonQueryAsync(cancellationToken) == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            await CleanupUnlinkedVersionAsync(versionId, cancellationToken);
            throw new InvalidOperationException("变更状态已变化或已关联其他版本，请刷新后重试。");
        }

        await using var audit = connection.CreateCommand();
        audit.Transaction = transaction;
        audit.CommandText = """
            INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt)
            VALUES('Change',$changeId,'LINK_VERSION',$operator,$summary,$now);
            """;
        audit.Parameters.AddValue("$changeId", changeRecordId);
        audit.Parameters.AddValue("$operator", operatorName);
        audit.Parameters.AddValue("$summary", $"关联变更后版本 #{versionId}");
        audit.Parameters.AddValue("$now", now);
        await audit.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task CleanupUnlinkedVersionAsync(int versionId, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        await using var audit = connection.CreateCommand();
        audit.Transaction = transaction;
        audit.CommandText = "DELETE FROM AuditLogs WHERE EntityType='Version' AND EntityId=$id";
        audit.Parameters.AddValue("$id", versionId);
        await audit.ExecuteNonQueryAsync(cancellationToken);

        await using var version = connection.CreateCommand();
        version.Transaction = transaction;
        version.CommandText = "DELETE FROM DeliverableVersions WHERE Id=$id AND VersionStatus='DRAFT'";
        version.Parameters.AddValue("$id", versionId);
        await version.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static string NormalizeIncrementType(string value)
    {
        var normalized = (value ?? "").Trim().ToUpperInvariant();
        if (!VersionIncrementTypes.Contains(normalized))
            throw new ArgumentException("版本类型必须是重大版本、功能版本或修订版本。");
        return normalized;
    }

    private static bool TryParseVersion(string value, out (int Major, int Minor, int Patch) version)
    {
        version = default;
        var text = (value ?? "").Trim();
        if (text.StartsWith('V') || text.StartsWith('v')) text = text[1..];
        var parts = text.Split('.');
        if (parts.Length != 3 || !int.TryParse(parts[0], out var major)
            || !int.TryParse(parts[1], out var minor) || !int.TryParse(parts[2], out var patch)
            || major < 0 || minor < 0 || patch < 0) return false;
        version = (major, minor, patch);
        return true;
    }

    private static (int Major, int Minor, int Patch) CalculateNext(
        (int Major, int Minor, int Patch) current,
        string incrementType) => incrementType switch
    {
        "MAJOR" => (current.Major + 1, 0, 0),
        "MINOR" => (current.Major, current.Minor + 1, 0),
        _ => (current.Major, current.Minor, current.Patch + 1)
    };

    private static string FormatVersion((int Major, int Minor, int Patch) version) =>
        $"V{version.Major}.{version.Minor}.{version.Patch}";
}
