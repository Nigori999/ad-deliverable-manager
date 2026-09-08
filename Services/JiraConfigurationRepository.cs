using System.Text.Json;
using System.Text.RegularExpressions;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed partial class JiraConfigurationRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly string[] StageCodes = ["new", "confirm", "analysis", "action", "verify", "closed"];
    private static readonly string[] SeverityCodes = ["S", "A", "B", "C"];
    private static readonly HashSet<string> QueryOperators = new(StringComparer.OrdinalIgnoreCase)
        { "=", "!=", "~", "!~", "IN", "NOT IN", "IS EMPTY", "IS NOT EMPTY" };
    private readonly DatabaseService _database;

    public JiraConfigurationRepository(DatabaseService database) => _database = database;

    public object GetTemplate() => new
    {
        stages = DefaultStages(),
        closureLimits = new Dictionary<string, int?> { ["S"] = 14, ["A"] = 14, ["B"] = 25, ["C"] = 25 },
        ruleNote = "测试验证：小V测试≤2天＋集成测试≤3天；当前按测试验证阶段总计5个自然日统计。"
    };

    public async Task<IReadOnlyList<JiraProjectStandardDefinition>> ListStandardsAsync(CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id,JiraBaseUrl,ProjectKey,ProjectName,IsEnabled,StagesJson,ClosureLimitsJson,RuleNote,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision FROM JiraProjectStandards ORDER BY IsEnabled DESC,ProjectKey,ProjectName";
        return await ReadStandardsAsync(command, ct);
    }

    public async Task<JiraProjectStandardDefinition?> GetStandardAsync(int id, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id,JiraBaseUrl,ProjectKey,ProjectName,IsEnabled,StagesJson,ClosureLimitsJson,RuleNote,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision FROM JiraProjectStandards WHERE Id=$id";
        command.Parameters.AddWithValue("$id", id);
        return (await ReadStandardsAsync(command, ct)).FirstOrDefault();
    }

    public async Task<JiraProjectStandardDefinition?> GetEffectiveStandardAsync(string baseUrl, string projectKey, CancellationToken ct = default)
    {
        var identity = NormalizeProjectIdentity(baseUrl, projectKey);
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id,JiraBaseUrl,ProjectKey,ProjectName,IsEnabled,StagesJson,ClosureLimitsJson,RuleNote,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision FROM JiraProjectStandards WHERE JiraBaseUrl=$url AND ProjectKey=$project AND IsEnabled=1";
        command.Parameters.AddWithValue("$url", identity.BaseUrl);
        command.Parameters.AddWithValue("$project", identity.ProjectKey);
        return (await ReadStandardsAsync(command, ct)).FirstOrDefault();
    }

    public async Task<int> CreateStandardAsync(JiraProjectStandardRequest request, string operatorName, CancellationToken ct = default)
    {
        var normalized = ValidateStandard(request, requireRevision: false);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var now = DateTime.UtcNow.ToString("O");
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO JiraProjectStandards(JiraBaseUrl,ProjectKey,ProjectName,IsEnabled,StagesJson,ClosureLimitsJson,RuleNote,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision)
            VALUES($url,$project,$name,$enabled,$stages,$closure,$note,$operator,$now,$operator,$now,1); SELECT last_insert_rowid();
            """;
        BindStandard(command, normalized, operatorName, now);
        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(ct));
            await InsertAuditAsync(connection, transaction, id, "CREATE", operatorName, $"新增JIRA时效标准 {normalized.ProjectKey}（{normalized.ProjectName}）", ct);
            await transaction.CommitAsync(ct);
            return id;
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == 2067)
        {
            throw new InvalidOperationException("该Jira服务器和项目标识已存在时效标准，请编辑已有配置。");
        }
    }

    public async Task UpdateStandardAsync(int id, JiraProjectStandardRequest request, string operatorName, CancellationToken ct = default)
    {
        var normalized = ValidateStandard(request, requireRevision: true);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var now = DateTime.UtcNow.ToString("O");
        await using (var identity = connection.CreateCommand())
        {
            identity.Transaction = transaction;
            identity.CommandText = "SELECT JiraBaseUrl,ProjectKey FROM JiraProjectStandards WHERE Id=$id";
            identity.Parameters.AddWithValue("$id", id);
            await using var reader = await identity.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) throw new KeyNotFoundException("JIRA时效标准不存在或已删除。");
            if (!reader.GetString(0).Equals(normalized.JiraBaseUrl, StringComparison.OrdinalIgnoreCase) ||
                !reader.GetString(1).Equals(normalized.ProjectKey, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Jira服务器地址和Project Key创建后不能修改；如项目标识错误，请复制为新标准后删除原配置。");
        }
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE JiraProjectStandards SET JiraBaseUrl=$url,ProjectKey=$project,ProjectName=$name,IsEnabled=$enabled,
                StagesJson=$stages,ClosureLimitsJson=$closure,RuleNote=$note,UpdatedBy=$operator,UpdatedAt=$now,Revision=Revision+1
            WHERE Id=$id AND Revision=$revision;
            """;
        BindStandard(command, normalized, operatorName, now);
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$revision", request.Revision);
        try
        {
            if (await command.ExecuteNonQueryAsync(ct) == 0) await ThrowStandardConcurrencyAsync(connection, transaction, id, ct);
            await InsertAuditAsync(connection, transaction, id, "UPDATE", operatorName, $"更新JIRA时效标准 {normalized.ProjectKey}（{normalized.ProjectName}）", ct);
            await transaction.CommitAsync(ct);
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == 2067)
        {
            throw new InvalidOperationException("该Jira服务器和项目标识已存在时效标准。");
        }
    }

    public async Task DeleteStandardAsync(int id, string operatorName, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var read = connection.CreateCommand();
        read.Transaction = transaction;
        read.CommandText = "SELECT ProjectKey,ProjectName FROM JiraProjectStandards WHERE Id=$id";
        read.Parameters.AddWithValue("$id", id);
        await using var reader = await read.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) throw new KeyNotFoundException("JIRA时效标准不存在或已删除。");
        var summary = $"删除JIRA时效标准 {reader.GetString(0)}（{reader.GetString(1)}）";
        await reader.DisposeAsync();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM JiraProjectStandards WHERE Id=$id";
        command.Parameters.AddWithValue("$id", id);
        await command.ExecuteNonQueryAsync(ct);
        await InsertAuditAsync(connection, transaction, id, "DELETE", operatorName, summary, ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<object>> ListPresetsAsync(int userId, string baseUrl, string projectKey, CancellationToken ct = default)
    {
        var identity = NormalizeProjectIdentity(baseUrl, projectKey);
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id,Name,SeverityFieldId,ConditionsJson,AdditionalJql,UpdatedAt,Revision FROM JiraQueryPresets WHERE UserId=$user AND JiraBaseUrl=$url AND ProjectKey=$project ORDER BY UpdatedAt DESC,Name";
        command.Parameters.AddWithValue("$user", userId);
        command.Parameters.AddWithValue("$url", identity.BaseUrl);
        command.Parameters.AddWithValue("$project", identity.ProjectKey);
        var result = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(new
        {
            id = reader.GetInt32(0),
            name = reader.GetString(1),
            severityFieldId = reader.GetString(2),
            conditions = DeserializeConditions(reader.GetString(3)),
            additionalJql = reader.GetString(4),
            updatedAt = reader.GetString(5),
            revision = reader.GetInt32(6)
        });
        return result;
    }

    public async Task<int> CreatePresetAsync(int userId, JiraQueryPresetRequest request, CancellationToken ct = default)
    {
        var normalized = ValidatePreset(request, requireRevision: false);
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO JiraQueryPresets(UserId,JiraBaseUrl,ProjectKey,Name,SeverityFieldId,ConditionsJson,AdditionalJql,CreatedAt,UpdatedAt,Revision)
            VALUES($user,$url,$project,$name,$severity,$conditions,$jql,$now,$now,1); SELECT last_insert_rowid();
            """;
        BindPreset(command, userId, normalized);
        try { return Convert.ToInt32(await command.ExecuteScalarAsync(ct)); }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == 2067) { throw new InvalidOperationException("当前项目下已存在同名查询方案。"); }
    }

    public async Task UpdatePresetAsync(int userId, int id, JiraQueryPresetRequest request, CancellationToken ct = default)
    {
        var normalized = ValidatePreset(request, requireRevision: true);
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE JiraQueryPresets SET JiraBaseUrl=$url,ProjectKey=$project,Name=$name,SeverityFieldId=$severity,
                ConditionsJson=$conditions,AdditionalJql=$jql,UpdatedAt=$now,Revision=Revision+1
            WHERE Id=$id AND UserId=$user AND Revision=$revision;
            """;
        BindPreset(command, userId, normalized);
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$revision", request.Revision);
        try
        {
            if (await command.ExecuteNonQueryAsync(ct) == 0)
            {
                await using var exists = connection.CreateCommand();
                exists.CommandText = "SELECT COUNT(*) FROM JiraQueryPresets WHERE Id=$id AND UserId=$user";
                exists.Parameters.AddWithValue("$id", id);
                exists.Parameters.AddWithValue("$user", userId);
                if (Convert.ToInt32(await exists.ExecuteScalarAsync(ct)) == 0) throw new KeyNotFoundException("查询方案不存在或不属于当前用户。");
                throw new InvalidOperationException("查询方案已被更新，请重新加载后再修改。");
            }
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == 2067) { throw new InvalidOperationException("当前项目下已存在同名查询方案。"); }
    }

    public async Task DeletePresetAsync(int userId, int id, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM JiraQueryPresets WHERE Id=$id AND UserId=$user";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$user", userId);
        if (await command.ExecuteNonQueryAsync(ct) == 0) throw new KeyNotFoundException("查询方案不存在或不属于当前用户。");
    }

    private static JiraProjectStandardRequest ValidateStandard(JiraProjectStandardRequest request, bool requireRevision)
    {
        if (request is null) throw new ArgumentException("请填写JIRA时效标准。");
        var identity = NormalizeProjectIdentity(request.JiraBaseUrl, request.ProjectKey);
        var name = request.ProjectName?.Trim() ?? "";
        if (name.Length is < 1 or > 100) throw new ArgumentException("项目名称长度应为1至100个字符。");
        if (requireRevision && request.Revision <= 0) throw new ArgumentException("配置版本无效，请刷新后重试。");
        if (request.Stages is null || request.Stages.Count != StageCodes.Length) throw new ArgumentException("必须完整配置六个问题处理阶段。");
        if (request.Stages.Any(x => x is null) || request.Stages.Select(x => x.StageCode).Distinct(StringComparer.OrdinalIgnoreCase).Count() != StageCodes.Length)
            throw new ArgumentException("处理阶段不能缺失或重复。");
        var stages = new List<JiraStageStandardRequest>();
        var usedStatuses = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var code in StageCodes)
        {
            var source = request.Stages.SingleOrDefault(x => string.Equals(x.StageCode, code, StringComparison.OrdinalIgnoreCase))
                ?? throw new ArgumentException($"缺少阶段配置：{code}。");
            var statuses = (source.Statuses ?? []).Select(x => x?.Trim() ?? "").Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (statuses.Count == 0) throw new ArgumentException($"阶段“{StageName(code)}”至少需要配置一个Jira状态。");
            if (statuses.Any(x => x.Length > 100)) throw new ArgumentException("Jira状态名称不能超过100个字符。");
            foreach (var status in statuses)
                if (!usedStatuses.Add(status)) throw new ArgumentException($"Jira状态“{status}”不能同时属于多个处理阶段。");
            var limits = new Dictionary<string, int?>();
            if (code != "closed")
                foreach (var severity in SeverityCodes)
                {
                    (source.Limits ?? new Dictionary<string, int?>()).TryGetValue(severity, out var value);
                    if (!value.HasValue || value.Value is < 1 or > 365) throw new ArgumentException($"阶段“{StageName(code)}”的{severity}级时限必须为1至365天。");
                    limits[severity] = value;
                }
            stages.Add(new JiraStageStandardRequest { StageCode = code, Statuses = statuses, Limits = limits });
        }
        var closure = new Dictionary<string, int?>();
        foreach (var severity in SeverityCodes)
        {
            (request.ClosureLimits ?? new Dictionary<string, int?>()).TryGetValue(severity, out var value);
            if (!value.HasValue || value.Value is < 1 or > 365) throw new ArgumentException($"{severity}级问题关闭总周期必须为1至365天。");
            closure[severity] = value;
        }
        var note = (request.RuleNote ?? "").Trim();
        if (note.Length > 500) throw new ArgumentException("规则说明不能超过500个字符。");
        return new JiraProjectStandardRequest
        {
            JiraBaseUrl = identity.BaseUrl, ProjectKey = identity.ProjectKey, ProjectName = name,
            IsEnabled = request.IsEnabled, Stages = stages, ClosureLimits = closure, RuleNote = note, Revision = request.Revision
        };
    }

    private static JiraQueryPresetRequest ValidatePreset(JiraQueryPresetRequest request, bool requireRevision)
    {
        if (request is null) throw new ArgumentException("请填写查询方案。");
        var identity = NormalizeProjectIdentity(request.JiraBaseUrl, request.ProjectKey);
        var name = request.Name?.Trim() ?? "";
        if (name.Length is < 1 or > 60) throw new ArgumentException("查询方案名称长度应为1至60个字符。");
        if (requireRevision && request.Revision <= 0) throw new ArgumentException("查询方案版本无效，请重新加载。");
        var severity = request.SeverityFieldId?.Trim() ?? "";
        if (!FieldIdRegex().IsMatch(severity)) throw new ArgumentException("严重等级字段无效。");
        if ((request.AdditionalJql ?? "").Length > 1500) throw new ArgumentException("附加JQL不能超过1500个字符。");
        if ((request.Conditions?.Count ?? 0) > 30) throw new ArgumentException("一个查询方案最多保存30个字段条件。");
        if (request.Conditions?.Any(x => x is null) == true) throw new ArgumentException("查询方案包含无效条件。");
        var conditions = new List<JiraQueryConditionRequest>();
        foreach (var condition in request.Conditions ?? [])
        {
            var fieldId = condition.FieldId?.Trim() ?? "";
            var fieldName = condition.FieldName?.Trim() ?? "";
            var op = condition.Operator?.Trim().ToUpperInvariant() ?? "";
            var value = condition.Value?.Trim() ?? "";
            if (!FieldIdRegex().IsMatch(fieldId) || fieldName.Length is < 1 or > 150) throw new ArgumentException("查询方案包含无效字段。");
            if (!QueryOperators.Contains(op)) throw new ArgumentException("查询方案包含不支持的运算符。");
            if (!op.StartsWith("IS ") && value.Length == 0) throw new ArgumentException($"请填写字段“{fieldName}”的条件值。");
            if (value.Length > 500) throw new ArgumentException("单个查询条件值不能超过500个字符。");
            conditions.Add(new JiraQueryConditionRequest { FieldId = fieldId, FieldName = fieldName, Operator = op, Value = value });
        }
        return new JiraQueryPresetRequest
        {
            JiraBaseUrl = identity.BaseUrl, ProjectKey = identity.ProjectKey, Name = name, SeverityFieldId = severity,
            Conditions = conditions, AdditionalJql = (request.AdditionalJql ?? "").Trim(), Revision = request.Revision
        };
    }

    private static ProjectIdentity NormalizeProjectIdentity(string baseUrl, string projectKey)
    {
        if (!Uri.TryCreate(baseUrl?.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ArgumentException("Jira地址必须是完整的HTTP或HTTPS地址。");
        if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            throw new ArgumentException("Jira地址不能包含账号、查询参数或锚点。");
        var key = projectKey?.Trim().ToUpperInvariant() ?? "";
        if (!ProjectKeyRegex().IsMatch(key)) throw new ArgumentException("Jira项目标识格式无效。");
        return new(uri.GetLeftPart(UriPartial.Path).TrimEnd('/'), key);
    }

    private static void BindStandard(SqliteCommand command, JiraProjectStandardRequest request, string operatorName, string now)
    {
        command.Parameters.AddWithValue("$url", request.JiraBaseUrl);
        command.Parameters.AddWithValue("$project", request.ProjectKey);
        command.Parameters.AddWithValue("$name", request.ProjectName);
        command.Parameters.AddWithValue("$enabled", request.IsEnabled ? 1 : 0);
        command.Parameters.AddWithValue("$stages", JsonSerializer.Serialize(request.Stages, JsonOptions));
        command.Parameters.AddWithValue("$closure", JsonSerializer.Serialize(request.ClosureLimits, JsonOptions));
        command.Parameters.AddWithValue("$note", request.RuleNote);
        command.Parameters.AddWithValue("$operator", operatorName);
        command.Parameters.AddWithValue("$now", now);
    }

    private static void BindPreset(SqliteCommand command, int userId, JiraQueryPresetRequest request)
    {
        command.Parameters.AddWithValue("$user", userId);
        command.Parameters.AddWithValue("$url", request.JiraBaseUrl);
        command.Parameters.AddWithValue("$project", request.ProjectKey);
        command.Parameters.AddWithValue("$name", request.Name);
        command.Parameters.AddWithValue("$severity", request.SeverityFieldId);
        command.Parameters.AddWithValue("$conditions", JsonSerializer.Serialize(request.Conditions, JsonOptions));
        command.Parameters.AddWithValue("$jql", request.AdditionalJql);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        if (request.Revision > 0) command.Parameters.AddWithValue("$revision", request.Revision);
    }

    private static async Task<List<JiraProjectStandardDefinition>> ReadStandardsAsync(SqliteCommand command, CancellationToken ct)
    {
        var result = new List<JiraProjectStandardDefinition>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(new(
            reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt32(4) == 1,
            JsonSerializer.Deserialize<List<JiraStageStandardRequest>>(reader.GetString(5), JsonOptions) ?? [],
            JsonSerializer.Deserialize<Dictionary<string, int?>>(reader.GetString(6), JsonOptions) ?? new Dictionary<string, int?>(), reader.GetString(7),
            reader.GetString(8), reader.GetString(9), reader.GetString(10), reader.GetString(11), reader.GetInt32(12)));
        return result;
    }

    private static List<JiraQueryConditionRequest> DeserializeConditions(string json) =>
        JsonSerializer.Deserialize<List<JiraQueryConditionRequest>>(json, JsonOptions) ?? [];

    private static async Task ThrowStandardConcurrencyAsync(SqliteConnection connection, SqliteTransaction transaction, int id, CancellationToken ct)
    {
        await using var exists = connection.CreateCommand();
        exists.Transaction = transaction;
        exists.CommandText = "SELECT COUNT(*) FROM JiraProjectStandards WHERE Id=$id";
        exists.Parameters.AddWithValue("$id", id);
        if (Convert.ToInt32(await exists.ExecuteScalarAsync(ct)) == 0) throw new KeyNotFoundException("JIRA时效标准不存在或已删除。");
        throw new InvalidOperationException("该配置已被其他人更新，请刷新后重试。");
    }

    private static async Task InsertAuditAsync(SqliteConnection connection, SqliteTransaction transaction, int id, string action, string operatorName, string summary, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES('JiraProjectStandard',$id,$action,$operator,$summary,$now)";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$action", action);
        command.Parameters.AddWithValue("$operator", operatorName);
        command.Parameters.AddWithValue("$summary", summary);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct);
    }

    private static List<JiraStageStandardRequest> DefaultStages() =>
    [
        Stage("new", ["新增"], 1, 1, 1, 1),
        Stage("confirm", ["Reopened"], 1, 1, 1, 1),
        Stage("analysis", ["Analysis", "Supplier Inbox", "Supplier In Progress", "Soluation Identified"], 2, 2, 2, 6),
        Stage("action", ["Solved"], 2, 2, 2, 7),
        Stage("verify", ["Ready for Test", "Stay Constant", "Rejected", "Under OB Servation"], 5, 5, 5, 5),
        new JiraStageStandardRequest { StageCode = "closed", Statuses = ["Closed", "Cancelled"], Limits = new Dictionary<string, int?>() }
    ];

    private static JiraStageStandardRequest Stage(string code, List<string> statuses, int s, int a, int b, int c) => new()
    {
        StageCode = code,
        Statuses = statuses,
        Limits = new Dictionary<string, int?> { ["S"] = s, ["A"] = a, ["B"] = b, ["C"] = c }
    };

    private static string StageName(string code) => code switch
    {
        "new" => "新增", "confirm" => "问题确认", "analysis" => "原因分析", "action" => "措施确认",
        "verify" => "测试验证", "closed" => "问题关闭", _ => code
    };

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_-]{0,99}$")]
    private static partial Regex ProjectKeyRegex();
    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_-]{0,99}$")]
    private static partial Regex FieldIdRegex();

    private sealed record ProjectIdentity(string BaseUrl, string ProjectKey);
}
