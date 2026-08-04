namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    private static readonly string[] FormalBaselineStatuses =
        ["RELEASED", "SUPERSEDED", "DEPRECATED"];

    public async Task<bool> HasFormalBaselineAsync(
        int deliverableId,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);

        await using (var exists = connection.CreateCommand())
        {
            exists.CommandText = "SELECT COUNT(*) FROM Deliverables WHERE Id=$id AND LifecycleStatus='ACTIVE'";
            exists.Parameters.AddValue("$id", deliverableId);
            if (Convert.ToInt32(await exists.ExecuteScalarAsync(cancellationToken)) == 0)
                throw new KeyNotFoundException("交付物不存在或已归档。");
        }

        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM DeliverableVersions
            WHERE DeliverableId=$id
              AND (VersionStatus IN ('RELEASED','SUPERSEDED','DEPRECATED') OR ReleaseDate IS NOT NULL);
            """;
        command.Parameters.AddValue("$id", deliverableId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) > 0;
    }

    public async Task EnsureDirectVersionCreationAllowedAsync(
        int deliverableId,
        bool administratorOverride,
        CancellationToken cancellationToken = default)
    {
        if (administratorOverride)
        {
            // 管理员保留历史数据补录和特殊纠错能力，但前端会明确标注该入口不是正常迭代流程。
            await HasFormalBaselineAsync(deliverableId, cancellationToken);
            return;
        }

        if (await HasFormalBaselineAsync(deliverableId, cancellationToken))
        {
            throw new InvalidOperationException(
                "该交付物已经形成正式基线，不能直接新增版本。请先发起变更，审批通过并进入实施后创建变更版本。");
        }
    }

    public async Task<int> RequireCurrentReleasedBaselineAsync(
        int deliverableId,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT d.CurrentVersionId,v.VersionStatus
            FROM Deliverables d
            LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId
            WHERE d.Id=$id AND d.LifecycleStatus='ACTIVE';
            """;
        command.Parameters.AddValue("$id", deliverableId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken))
            throw new KeyNotFoundException("交付物不存在或已归档。");

        if (reader.IsDBNull(0) || reader.IsDBNull(1)
            || !string.Equals(reader.GetString(1), "RELEASED", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "该交付物当前没有有效的已发布基线，不能发起变更。请先完成基线形成前的版本迭代并正式发布。");
        }

        return reader.GetInt32(0);
    }
}
