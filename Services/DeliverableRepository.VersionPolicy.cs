namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    public async Task<bool> HasFormalBaselineAsync(int deliverableId, CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using (var exists = connection.CreateCommand())
        {
            exists.CommandText = "SELECT COUNT(*) FROM Deliverables WHERE Id=$id AND LifecycleStatus='ACTIVE'";
            exists.Parameters.AddValue("$id", deliverableId);
            if (Convert.ToInt32(await exists.ExecuteScalarAsync(cancellationToken)) == 0) throw new KeyNotFoundException("交付物不存在或已归档。");
        }
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM DeliverableVersions WHERE DeliverableId=$id AND (VersionStatus IN ('RELEASED','SUPERSEDED') OR ReleaseDate IS NOT NULL);";
        command.Parameters.AddValue("$id", deliverableId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken)) > 0;
    }

    public async Task EnsureNoOpenVersionCycleAsync(int deliverableId, CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT InternalVersion,VersionStatus FROM DeliverableVersions WHERE DeliverableId=$id AND VersionStatus IN ('DRAFT','IN_REVIEW') ORDER BY CreatedAt DESC,Id DESC LIMIT 1;";
        command.Parameters.AddValue("$id", deliverableId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return;
        var version = reader.GetString(0); var status = reader.GetString(1); var statusName = status == "DRAFT" ? "草稿" : "审批中";
        throw new InvalidOperationException($"当前版本 {version} 仍处于“{statusName}”状态，审批流程完成前不能创建后续版本。");
    }

    public Task EnsureDirectVersionCreationAllowedAsync(int deliverableId, bool _, CancellationToken cancellationToken = default)
        => EnsureDirectVersionCreationAllowedAsync(deliverableId, cancellationToken);

    public async Task EnsureDirectVersionCreationAllowedAsync(int deliverableId, CancellationToken cancellationToken = default)
    {
        await EnsureNoOpenVersionCycleAsync(deliverableId, cancellationToken);
        if (await HasFormalBaselineAsync(deliverableId, cancellationToken))
            throw new InvalidOperationException("该交付物已经形成正式基线，不能直接新增版本。请先发起变更，审批通过并进入实施后创建变更版本。");
    }

    public async Task<int> RequireCurrentReleasedBaselineAsync(int deliverableId, CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT d.CurrentVersionId,v.VersionStatus FROM Deliverables d LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId WHERE d.Id=$id AND d.LifecycleStatus='ACTIVE';";
        command.Parameters.AddValue("$id", deliverableId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) throw new KeyNotFoundException("交付物不存在或已归档。");
        if (reader.IsDBNull(0) || reader.IsDBNull(1) || !string.Equals(reader.GetString(1), "RELEASED", StringComparison.Ordinal))
            throw new InvalidOperationException("该交付物当前没有有效的已发布基线，不能发起变更。请先完成基线形成前的版本迭代并正式发布。");
        return reader.GetInt32(0);
    }
}
