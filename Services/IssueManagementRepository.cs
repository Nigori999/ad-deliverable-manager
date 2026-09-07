using System.Globalization;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class IssueManagementRepository
{
    public const string DepartmentDictionary = "ISSUE_DEPARTMENT";
    public const string SourceDictionary = "ISSUE_SOURCE";
    public const string SeverityDictionary = "ISSUE_SEVERITY";
    public const string StatusDictionary = "ISSUE_STATUS";

    private readonly DatabaseService _database;
    public IssueManagementRepository(DatabaseService database) => _database = database;

    public async Task<object> GetReferenceDataAsync(CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        return new
        {
            departments = await LoadOptionsAsync(connection, DepartmentDictionary, ct),
            sources = await LoadOptionsAsync(connection, SourceDictionary, ct),
            severities = await LoadOptionsAsync(connection, SeverityDictionary, ct),
            statuses = await LoadOptionsAsync(connection, StatusDictionary, ct)
        };
    }

    public async Task<object> GetDashboardAsync(
        string? dateFrom, string? dateTo, int? departmentItemId, int? sourceItemId, int? severityItemId,
        CancellationToken ct = default)
    {
        ValidateDateRange(dateFrom, dateTo);
        await using var connection = await _database.OpenConnectionAsync(ct);
        var statuses = await LoadOptionsAsync(connection, StatusDictionary, ct);
        var severities = await LoadOptionsAsync(connection, SeverityDictionary, ct);
        var rows = await LoadSnapshotsAsync(connection, dateFrom, dateTo, departmentItemId, sourceItemId, severityItemId, null, ct);
        var availableDates = rows.Select(x => x.RecordDate).Distinct().OrderBy(x => x).ToArray();
        var latestDate = availableDates.LastOrDefault();
        List<SnapshotRow> latestRows = latestDate is null ? [] : rows.Where(x => x.RecordDate == latestDate).ToList();
        var previousDate = availableDates.Length > 1 ? availableDates[^2] : null;
        List<SnapshotRow> previousRows = previousDate is null ? [] : rows.Where(x => x.RecordDate == previousDate).ToList();
        var total = latestRows.Sum(Total);
        var previousTotal = previousRows.Sum(Total);
        var delta = total - previousTotal;
        var growthRate = previousDate is null || previousTotal == 0 ? (decimal?)null : Math.Round(delta * 100m / previousTotal, 1);

        var statusSummary = statuses.Select(status => new
        {
            id = status.Id,
            code = status.Code,
            name = status.Name,
            value = latestRows.Sum(row => Count(row, status.Id)),
            sortOrder = status.SortOrder
        }).ToArray();
        var departmentDistribution = Distribution(latestRows, x => x.DepartmentId, x => x.DepartmentName);
        var sourceDistribution = Distribution(latestRows, x => x.SourceId, x => x.SourceName);
        var severityDistribution = Distribution(latestRows, x => x.SeverityId, x => x.SeverityName);
        var trend = availableDates.Select(date =>
        {
            var dayRows = rows.Where(x => x.RecordDate == date).ToArray();
            return new
            {
                date,
                total = dayRows.Sum(Total),
                statuses = statuses.Select(status => new
                {
                    id = status.Id,
                    name = status.Name,
                    value = dayRows.Sum(row => Count(row, status.Id))
                }).ToArray()
            };
        }).ToArray();
        var topSeverity = severities.FirstOrDefault();
        var criticalTotal = topSeverity is null ? 0 : latestRows.Where(x => x.SeverityId == topSeverity.Id).Sum(Total);

        return new
        {
            latestDate,
            previousDate,
            summary = new
            {
                total,
                previousTotal,
                delta,
                growthRate,
                criticalTotal,
                criticalLabel = topSeverity?.Name ?? "最高严重等级",
                topDepartment = departmentDistribution.FirstOrDefault()?.Name,
                topDepartmentTotal = departmentDistribution.FirstOrDefault()?.Value ?? 0,
                statusCount = statusSummary.Length
            },
            statusSummary,
            trend,
            distributions = new
            {
                departments = departmentDistribution,
                sources = sourceDistribution,
                severities = severityDistribution
            },
            rankings = new
            {
                departments = Ranking(latestRows, statuses, x => x.DepartmentId, x => x.DepartmentName),
                sources = Ranking(latestRows, statuses, x => x.SourceId, x => x.SourceName),
                severities = Ranking(latestRows, statuses, x => x.SeverityId, x => x.SeverityName)
            },
            availableDates
        };
    }

    public async Task<object> ListSnapshotsAsync(
        string? dateFrom, string? dateTo, int? departmentItemId, int? sourceItemId, int? severityItemId,
        CancellationToken ct = default)
    {
        ValidateDateRange(dateFrom, dateTo);
        await using var connection = await _database.OpenConnectionAsync(ct);
        var rows = await LoadSnapshotsAsync(connection, dateFrom, dateTo, departmentItemId, sourceItemId, severityItemId, 251, ct);
        var visible = rows.Take(250).ToArray();
        return new { items = visible.Select(ToResponse).ToArray(), total = visible.Length, limited = rows.Count > visible.Length };
    }

    public async Task<object?> GetSnapshotAsync(int id, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        var rows = await LoadSnapshotsAsync(connection, null, null, null, null, null, null, ct, id);
        return rows.Count == 0 ? null : ToResponse(rows[0]);
    }

    public async Task<int> CreateSnapshotAsync(IssueSnapshotRequest request, string operatorName, CancellationToken ct = default)
    {
        var normalized = await ValidateRequestAsync(request, ct);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO IssueSnapshots(DepartmentItemId,SourceItemId,SeverityItemId,RecordDate,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision)
            VALUES($department,$source,$severity,$date,$operator,$now,$operator,$now,1); SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("$department", request.DepartmentItemId);
        command.Parameters.AddWithValue("$source", request.SourceItemId);
        command.Parameters.AddWithValue("$severity", request.SeverityItemId);
        command.Parameters.AddWithValue("$date", normalized.RecordDate);
        command.Parameters.AddWithValue("$operator", operatorName);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(ct));
            await ReplaceCountsAsync(connection, transaction, id, normalized.Counts, ct);
            await InsertAuditAsync(connection, transaction, id, "CREATE", operatorName, $"新增问题汇总快照 {normalized.RecordDate}，合计 {normalized.Counts.Sum(x => x.Count)} 项", ct);
            await transaction.CommitAsync(ct);
            return id;
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == 2067)
        {
            throw new InvalidOperationException("同一日期、部门、来源和严重等级的快照已存在，请编辑已有记录。");
        }
    }

    public async Task UpdateSnapshotAsync(int id, IssueSnapshotRequest request, string operatorName, CancellationToken ct = default)
    {
        if (request.Revision <= 0) throw new ArgumentException("记录版本无效，请刷新页面后重试。");
        var normalized = await ValidateRequestAsync(request, ct);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE IssueSnapshots
            SET DepartmentItemId=$department,SourceItemId=$source,SeverityItemId=$severity,RecordDate=$date,
                UpdatedBy=$operator,UpdatedAt=$now,Revision=Revision+1
            WHERE Id=$id AND Revision=$revision;
            """;
        command.Parameters.AddWithValue("$department", request.DepartmentItemId);
        command.Parameters.AddWithValue("$source", request.SourceItemId);
        command.Parameters.AddWithValue("$severity", request.SeverityItemId);
        command.Parameters.AddWithValue("$date", normalized.RecordDate);
        command.Parameters.AddWithValue("$operator", operatorName);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$revision", request.Revision);
        try
        {
            if (await command.ExecuteNonQueryAsync(ct) == 0)
            {
                await using var exists = connection.CreateCommand();
                exists.Transaction = transaction;
                exists.CommandText = "SELECT COUNT(*) FROM IssueSnapshots WHERE Id=$id";
                exists.Parameters.AddWithValue("$id", id);
                if (Convert.ToInt32(await exists.ExecuteScalarAsync(ct)) == 0) throw new KeyNotFoundException("问题汇总快照不存在或已删除。");
                throw new InvalidOperationException("该记录已被其他人更新，请刷新后再修改。");
            }
            await ReplaceCountsAsync(connection, transaction, id, normalized.Counts, ct);
            await InsertAuditAsync(connection, transaction, id, "UPDATE", operatorName, $"修改问题汇总快照 {normalized.RecordDate}，合计 {normalized.Counts.Sum(x => x.Count)} 项", ct);
            await transaction.CommitAsync(ct);
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == 2067)
        {
            throw new InvalidOperationException("同一日期、部门、来源和严重等级的快照已存在，请编辑已有记录。");
        }
    }

    public async Task DeleteSnapshotAsync(int id, string operatorName, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var detail = connection.CreateCommand();
        detail.Transaction = transaction;
        detail.CommandText = "SELECT RecordDate FROM IssueSnapshots WHERE Id=$id";
        detail.Parameters.AddWithValue("$id", id);
        var date = Convert.ToString(await detail.ExecuteScalarAsync(ct));
        if (string.IsNullOrWhiteSpace(date)) throw new KeyNotFoundException("问题汇总快照不存在或已删除。");
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM IssueSnapshots WHERE Id=$id";
        command.Parameters.AddWithValue("$id", id);
        await command.ExecuteNonQueryAsync(ct);
        await InsertAuditAsync(connection, transaction, id, "DELETE", operatorName, $"删除问题汇总快照 {date}", ct);
        await transaction.CommitAsync(ct);
    }

    private async Task<ValidatedRequest> ValidateRequestAsync(IssueSnapshotRequest request, CancellationToken ct)
    {
        if (!DateOnly.TryParseExact(request.RecordDate?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            throw new ArgumentException("记录日期格式无效。");
        if (date > DateOnly.FromDateTime(DateTime.Now)) throw new ArgumentException("记录日期不能晚于今天。");
        if (request.Counts is null || request.Counts.Count == 0) throw new ArgumentException("请填写至少一个问题状态数量。");
        if (request.Counts.Any(x => x.Count < 0)) throw new ArgumentException("问题数量不能为负数。");
        if (request.Counts.GroupBy(x => x.StatusItemId).Any(x => x.Count() > 1)) throw new ArgumentException("问题状态不能重复。");
        var positive = request.Counts.Where(x => x.Count > 0).ToArray();
        if (positive.Length == 0) throw new ArgumentException("各状态数量不能全部为零。");

        await using var connection = await _database.OpenConnectionAsync(ct);
        await EnsureOptionAsync(connection, request.DepartmentItemId, DepartmentDictionary, "部门", ct);
        await EnsureOptionAsync(connection, request.SourceItemId, SourceDictionary, "问题来源", ct);
        await EnsureOptionAsync(connection, request.SeverityItemId, SeverityDictionary, "严重等级", ct);
        foreach (var count in request.Counts) await EnsureOptionAsync(connection, count.StatusItemId, StatusDictionary, "问题状态", ct);
        return new ValidatedRequest(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), positive);
    }

    private static async Task EnsureOptionAsync(SqliteConnection connection, int id, string dictionaryCode, string fieldName, CancellationToken ct)
    {
        if (id <= 0) throw new ArgumentException($"请选择{fieldName}。");
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM DictionaryItems i
            JOIN DictionaryTypes d ON d.Id=i.DictionaryTypeId
            WHERE i.Id=$id AND i.IsEnabled=1 AND d.IsEnabled=1 AND d.Code=$code;
            """;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$code", dictionaryCode);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) == 0) throw new ArgumentException($"所选{fieldName}不存在或已停用。");
    }

    private static async Task ReplaceCountsAsync(SqliteConnection connection, SqliteTransaction transaction, int snapshotId, IReadOnlyList<IssueStatusCountRequest> counts, CancellationToken ct)
    {
        await using (var clear = connection.CreateCommand())
        {
            clear.Transaction = transaction;
            clear.CommandText = "DELETE FROM IssueSnapshotCounts WHERE SnapshotId=$id";
            clear.Parameters.AddWithValue("$id", snapshotId);
            await clear.ExecuteNonQueryAsync(ct);
        }
        foreach (var count in counts)
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO IssueSnapshotCounts(SnapshotId,StatusItemId,IssueCount) VALUES($snapshot,$status,$count)";
            insert.Parameters.AddWithValue("$snapshot", snapshotId);
            insert.Parameters.AddWithValue("$status", count.StatusItemId);
            insert.Parameters.AddWithValue("$count", count.Count);
            await insert.ExecuteNonQueryAsync(ct);
        }
    }

    private static async Task<List<DictionaryOption>> LoadOptionsAsync(SqliteConnection connection, string code, CancellationToken ct)
    {
        var result = new List<DictionaryOption>();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT i.Id,i.ItemCode,i.ItemName,i.SortOrder
            FROM DictionaryItems i JOIN DictionaryTypes d ON d.Id=i.DictionaryTypeId
            WHERE d.Code=$code AND d.IsEnabled=1 AND i.IsEnabled=1
            ORDER BY i.SortOrder,i.ItemName;
            """;
        command.Parameters.AddWithValue("$code", code);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(new(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetInt32(3)));
        return result;
    }

    private static async Task<List<SnapshotRow>> LoadSnapshotsAsync(
        SqliteConnection connection, string? dateFrom, string? dateTo, int? departmentId, int? sourceId, int? severityId,
        int? limit, CancellationToken ct, int? snapshotId = null)
    {
        var snapshots = new Dictionary<int, SnapshotRow>();
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT s.Id,s.RecordDate,s.DepartmentItemId,department.ItemName,s.SourceItemId,source.ItemName,
                   s.SeverityItemId,severity.ItemName,s.CreatedBy,s.CreatedAt,s.UpdatedBy,s.UpdatedAt,s.Revision,
                   count.StatusItemId,status.ItemCode,status.ItemName,count.IssueCount,status.SortOrder
            FROM IssueSnapshots s
            JOIN DictionaryItems department ON department.Id=s.DepartmentItemId
            JOIN DictionaryItems source ON source.Id=s.SourceItemId
            JOIN DictionaryItems severity ON severity.Id=s.SeverityItemId
            LEFT JOIN IssueSnapshotCounts count ON count.SnapshotId=s.Id
            LEFT JOIN DictionaryItems status ON status.Id=count.StatusItemId
            WHERE ($snapshotId=0 OR s.Id=$snapshotId)
              AND ($dateFrom='' OR s.RecordDate >= $dateFrom) AND ($dateTo='' OR s.RecordDate <= $dateTo)
              AND ($department=0 OR s.DepartmentItemId=$department)
              AND ($source=0 OR s.SourceItemId=$source)
              AND ($severity=0 OR s.SeverityItemId=$severity)
              AND s.Id IN (
                  SELECT filtered.Id FROM IssueSnapshots filtered
                  WHERE ($snapshotId=0 OR filtered.Id=$snapshotId)
                    AND ($dateFrom='' OR filtered.RecordDate >= $dateFrom) AND ($dateTo='' OR filtered.RecordDate <= $dateTo)
                    AND ($department=0 OR filtered.DepartmentItemId=$department)
                    AND ($source=0 OR filtered.SourceItemId=$source)
                    AND ($severity=0 OR filtered.SeverityItemId=$severity)
                  ORDER BY filtered.RecordDate DESC,filtered.Id DESC
                  {(limit.HasValue ? "LIMIT $limit" : "")}
              )
            ORDER BY s.RecordDate DESC,s.Id DESC,status.SortOrder,status.ItemName;
            """;
        command.Parameters.AddWithValue("$snapshotId", snapshotId ?? 0);
        command.Parameters.AddWithValue("$dateFrom", (dateFrom ?? "").Trim());
        command.Parameters.AddWithValue("$dateTo", (dateTo ?? "").Trim());
        command.Parameters.AddWithValue("$department", departmentId ?? 0);
        command.Parameters.AddWithValue("$source", sourceId ?? 0);
        command.Parameters.AddWithValue("$severity", severityId ?? 0);
        if (limit.HasValue) command.Parameters.AddWithValue("$limit", limit.Value);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var id = reader.GetInt32(0);
            if (!snapshots.TryGetValue(id, out var row))
            {
                row = new SnapshotRow(
                    id, reader.GetString(1), reader.GetInt32(2), reader.GetString(3), reader.GetInt32(4), reader.GetString(5),
                    reader.GetInt32(6), reader.GetString(7), reader.GetString(8), reader.GetString(9), reader.GetString(10), reader.GetString(11), reader.GetInt32(12));
                snapshots.Add(id, row);
            }
            if (!reader.IsDBNull(13)) row.Counts.Add(new StatusCount(reader.GetInt32(13), reader.GetString(14), reader.GetString(15), reader.GetInt32(16), reader.GetInt32(17)));
        }
        return snapshots.Values.OrderByDescending(x => x.RecordDate).ThenByDescending(x => x.Id).ToList();
    }

    private static object ToResponse(SnapshotRow row) => new
    {
        id = row.Id,
        recordDate = row.RecordDate,
        department = new { id = row.DepartmentId, name = row.DepartmentName },
        source = new { id = row.SourceId, name = row.SourceName },
        severity = new { id = row.SeverityId, name = row.SeverityName },
        counts = row.Counts.Select(x => new { statusItemId = x.StatusId, code = x.StatusCode, name = x.StatusName, count = x.Count, sortOrder = x.SortOrder }).ToArray(),
        total = Total(row),
        row.CreatedBy,
        row.CreatedAt,
        row.UpdatedBy,
        row.UpdatedAt,
        row.Revision
    };

    private static List<DistributionItem> Distribution(IReadOnlyList<SnapshotRow> rows, Func<SnapshotRow, int> id, Func<SnapshotRow, string> name) =>
        rows.GroupBy(x => new { Id = id(x), Name = name(x) })
            .Select(x => new DistributionItem(x.Key.Id, x.Key.Name, x.Sum(Total)))
            .OrderByDescending(x => x.Value).ThenBy(x => x.Name).ToList();

    private static object[] Ranking(IReadOnlyList<SnapshotRow> rows, IReadOnlyList<DictionaryOption> statuses, Func<SnapshotRow, int> id, Func<SnapshotRow, string> name) =>
        rows.GroupBy(x => new { Id = id(x), Name = name(x) })
            .Select(group => new
            {
                id = group.Key.Id,
                name = group.Key.Name,
                total = group.Sum(Total),
                statuses = statuses.Select(status => new { id = status.Id, name = status.Name, value = group.Sum(row => Count(row, status.Id)) }).ToArray()
            })
            .OrderByDescending(x => x.total).ThenBy(x => x.name).Take(12).Cast<object>().ToArray();

    private static int Total(SnapshotRow row) => row.Counts.Sum(x => x.Count);
    private static int Count(SnapshotRow row, int statusId) => row.Counts.Where(x => x.StatusId == statusId).Sum(x => x.Count);

    private static void ValidateDateRange(string? dateFrom, string? dateTo)
    {
        static DateOnly? Parse(string? value, string field)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            if (!DateOnly.TryParseExact(value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                throw new ArgumentException($"{field}格式无效。");
            return date;
        }
        var from = Parse(dateFrom, "开始日期");
        var to = Parse(dateTo, "结束日期");
        if (from.HasValue && to.HasValue && from > to) throw new ArgumentException("开始日期不能晚于结束日期。");
    }

    private static async Task InsertAuditAsync(SqliteConnection connection, SqliteTransaction transaction, int id, string action, string operatorName, string summary, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES('IssueSnapshot',$id,$action,$operator,$summary,$now)";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$action", action);
        command.Parameters.AddWithValue("$operator", operatorName);
        command.Parameters.AddWithValue("$summary", summary);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct);
    }

    private sealed record ValidatedRequest(string RecordDate, IReadOnlyList<IssueStatusCountRequest> Counts);
    private sealed record DictionaryOption(int Id, string Code, string Name, int SortOrder);
    private sealed record StatusCount(int StatusId, string StatusCode, string StatusName, int Count, int SortOrder);
    private sealed record DistributionItem(int Id, string Name, int Value);
    private sealed class SnapshotRow
    {
        public SnapshotRow(int id, string recordDate, int departmentId, string departmentName, int sourceId, string sourceName,
            int severityId, string severityName, string createdBy, string createdAt, string updatedBy, string updatedAt, int revision)
        {
            Id = id; RecordDate = recordDate; DepartmentId = departmentId; DepartmentName = departmentName;
            SourceId = sourceId; SourceName = sourceName; SeverityId = severityId; SeverityName = severityName;
            CreatedBy = createdBy; CreatedAt = createdAt; UpdatedBy = updatedBy; UpdatedAt = updatedAt; Revision = revision;
        }
        public int Id { get; }
        public string RecordDate { get; }
        public int DepartmentId { get; }
        public string DepartmentName { get; }
        public int SourceId { get; }
        public string SourceName { get; }
        public int SeverityId { get; }
        public string SeverityName { get; }
        public string CreatedBy { get; }
        public string CreatedAt { get; }
        public string UpdatedBy { get; }
        public string UpdatedAt { get; }
        public int Revision { get; }
        public List<StatusCount> Counts { get; } = [];
    }
}
