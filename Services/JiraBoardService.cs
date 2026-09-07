using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AdDeliverableManager.Models;

namespace AdDeliverableManager.Services;

public sealed partial class JiraBoardService
{
    private const int SearchPageSize = 100;
    private const int MaxIssues = 5000;
    private const int MaxCommentIssues = 100;
    private readonly HttpClient _http;

    private static readonly StageDefinition[] Stages =
    [
        new("new", "新增", 0),
        new("confirm", "问题确认", 1),
        new("analysis", "原因分析", 2),
        new("action", "措施确认", 3),
        new("verify", "测试验证", 4),
        new("closed", "问题关闭", 5)
    ];

    private static readonly Dictionary<string, string> StatusStages = new(StringComparer.OrdinalIgnoreCase)
    {
        ["新增"] = "new",
        ["Reopened"] = "confirm",
        ["Analysis"] = "analysis",
        ["Supplier Inbox"] = "analysis",
        ["Supplier In Progress"] = "analysis",
        ["Soluation Identified"] = "analysis",
        ["Solved"] = "action",
        ["Ready for Test"] = "verify",
        ["Stay Constant"] = "verify",
        ["Rejected"] = "verify",
        ["Under OB Servation"] = "verify",
        ["Closed"] = "closed",
        ["Cancelled"] = "closed"
    };

    public JiraBoardService(HttpClient http) => _http = http;

    public async Task<object> GetMetadataAsync(JiraConnectionRequest request, CancellationToken ct = default)
    {
        var connection = ValidateConnection(request);
        using var server = await GetJsonAsync(connection, "serverInfo", ct);
        using var project = await GetJsonAsync(connection, $"project/{Uri.EscapeDataString(connection.ProjectKey)}", ct);
        using var fields = await GetJsonAsync(connection, "field", ct);

        var fieldItems = ReadFields(fields.RootElement)
            .Where(x => x.Searchable)
            .OrderByDescending(x => SeverityCandidateScore(x.Name, x.Id))
            .ThenBy(x => x.Custom)
            .ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .Select(x => new
            {
                id = x.Id,
                name = x.Name,
                clause = x.Clause,
                custom = x.Custom,
                schemaType = x.SchemaType,
                severityCandidate = IsSeverityCandidate(x.Name, x.Id)
            })
            .ToArray();

        return new
        {
            server = new
            {
                title = GetString(server.RootElement, "serverTitle") ?? "Jira Server",
                version = GetString(server.RootElement, "version") ?? "未知版本",
                serverTime = GetString(server.RootElement, "serverTime")
            },
            project = new
            {
                key = GetString(project.RootElement, "key") ?? connection.ProjectKey,
                name = GetString(project.RootElement, "name") ?? connection.ProjectKey
            },
            fields = fieldItems
        };
    }

    public async Task<object> AnalyzeAsync(JiraBoardAnalysisRequest request, CancellationToken ct = default)
    {
        var connection = ValidateConnection(request.Connection);
        var cutoffDate = ValidateCutoffDate(request.CutoffDate);
        var severityFieldId = ValidateFieldId(request.SeverityFieldId);
        var additionalJql = NormalizeAdditionalJql(request.AdditionalJql);

        using var server = await GetJsonAsync(connection, "serverInfo", ct);
        var serverNow = ParseJiraDate(GetString(server.RootElement, "serverTime")) ?? DateTimeOffset.Now;
        if (cutoffDate > DateOnly.FromDateTime(serverNow.Date))
            throw new ArgumentException("统计截止日期不能晚于 Jira 服务器当前日期。");
        var effectiveCutoff = cutoffDate == DateOnly.FromDateTime(serverNow.Date)
            ? serverNow
            : new DateTimeOffset(cutoffDate.Year, cutoffDate.Month, cutoffDate.Day, 23, 59, 59, serverNow.Offset);

        var jql = BuildJql(connection.ProjectKey, cutoffDate, additionalJql);
        var requestedFields = new[] { "summary", "status", "assignee", "created", "resolutiondate", severityFieldId }
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var issues = new List<AnalyzedIssue>();
        var total = 0;
        var startAt = 0;

        do
        {
            var query = $"search?jql={Uri.EscapeDataString(jql)}&startAt={startAt}&maxResults={SearchPageSize}" +
                        $"&fields={Uri.EscapeDataString(string.Join(',', requestedFields))}&expand=changelog";
            using var page = await GetJsonAsync(connection, query, ct);
            total = GetInt(page.RootElement, "total");
            if (!page.RootElement.TryGetProperty("issues", out var pageIssues) || pageIssues.ValueKind != JsonValueKind.Array) break;
            foreach (var issue in pageIssues.EnumerateArray())
            {
                if (issues.Count >= MaxIssues) break;
                issues.Add(ParseIssue(issue, connection, severityFieldId, effectiveCutoff));
            }
            startAt += pageIssues.GetArrayLength();
            if (pageIssues.GetArrayLength() == 0) break;
        }
        while (startAt < total && issues.Count < MaxIssues);

        var closedCount = issues.Count(x => x.StageCode == "closed");
        var activeCount = issues.Count - closedCount;
        var closedDurations = issues.Where(x => x.StageCode == "closed" && x.ClosedAt.HasValue)
            .Select(x => (x.ClosedAt!.Value - x.CreatedAt).TotalDays)
            .Where(x => x >= 0)
            .ToArray();

        var funnel = Stages.Select(stage => new
        {
            code = stage.Code,
            name = stage.Name,
            order = stage.Order,
            count = issues.Count(x => x.StageCode == stage.Code),
            share = Percent(issues.Count(x => x.StageCode == stage.Code), issues.Count)
        }).ToArray();

        var overdue = Stages.Where(x => x.Code != "closed").Select(stage => new
        {
            code = stage.Code,
            name = stage.Name,
            count = issues.Count(x => x.StageCode == stage.Code && x.StageOverdueDays > 0),
            maxOverdueDays = issues.Where(x => x.StageCode == stage.Code).Select(x => x.StageOverdueDays).DefaultIfEmpty(0).Max()
        }).Concat(new[]
        {
            new
            {
                code = "closure",
                name = "关闭总周期",
                count = issues.Count(x => x.StageCode != "closed" && x.ClosureOverdueDays > 0),
                maxOverdueDays = issues.Where(x => x.StageCode != "closed").Select(x => x.ClosureOverdueDays).DefaultIfEmpty(0).Max()
            }
        }).ToArray();

        var closureRates = issues.GroupBy(x => x.SeverityLabel, StringComparer.OrdinalIgnoreCase)
            .Select(group => new
            {
                severity = group.Key,
                severityKey = group.Select(x => x.SeverityKey).FirstOrDefault() ?? "UNKNOWN",
                total = group.Count(),
                closed = group.Count(x => x.StageCode == "closed"),
                rate = Percent(group.Count(x => x.StageCode == "closed"), group.Count())
            })
            .OrderBy(x => SeverityOrder(x.severityKey))
            .ThenBy(x => x.severity)
            .ToArray();

        var stageAverages = Stages.Where(x => x.Code != "closed").Select(stage =>
        {
            var samples = issues.Where(x => x.CompletedStageDays.ContainsKey(stage.Code))
                .Select(x => x.CompletedStageDays[stage.Code])
                .Where(x => x >= 0)
                .ToArray();
            return new
            {
                code = stage.Code,
                name = stage.Name,
                sampleCount = samples.Length,
                averageDays = Average(samples)
            };
        }).ToArray();

        var severityAverages = issues.Where(x => x.StageCode == "closed" && x.ClosedAt.HasValue)
            .GroupBy(x => x.SeverityLabel, StringComparer.OrdinalIgnoreCase)
            .Select(group => new
            {
                severity = group.Key,
                severityKey = group.Select(x => x.SeverityKey).FirstOrDefault() ?? "UNKNOWN",
                sampleCount = group.Count(),
                averageDays = Average(group.Select(x => (x.ClosedAt!.Value - x.CreatedAt).TotalDays).Where(x => x >= 0))
            })
            .OrderByDescending(x => x.averageDays ?? -1)
            .ThenBy(x => SeverityOrder(x.severityKey))
            .ToArray();

        var unmatchedStatuses = issues.Where(x => x.StageCode == "other")
            .GroupBy(x => x.Status, StringComparer.OrdinalIgnoreCase)
            .Select(x => new { status = x.Key, count = x.Count() })
            .OrderByDescending(x => x.count)
            .ThenBy(x => x.status)
            .ToArray();
        var unmatchedSeverities = issues.Where(x => x.SeverityKey == "UNKNOWN")
            .GroupBy(x => x.SeverityLabel, StringComparer.OrdinalIgnoreCase)
            .Select(x => new { severity = x.Key, count = x.Count() })
            .OrderByDescending(x => x.count)
            .ThenBy(x => x.severity)
            .ToArray();

        return new
        {
            generatedAt = serverNow,
            cutoffDate = cutoffDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            project = connection.ProjectKey,
            query = jql,
            truncated = total > MaxIssues,
            sourceTotal = total,
            historyTruncated = issues.Count(x => x.HistoryTruncated),
            summary = new
            {
                total = issues.Count,
                active = activeCount,
                closed = closedCount,
                closureRate = Percent(closedCount, issues.Count),
                averageClosureDays = Average(closedDurations),
                stageOverdue = issues.Count(x => x.StageCode != "closed" && x.StageOverdueDays > 0),
                closureOverdue = issues.Count(x => x.StageCode != "closed" && x.ClosureOverdueDays > 0)
            },
            funnel,
            overdue,
            closureRates,
            stageAverages,
            severityAverages,
            unmatchedStatuses,
            unmatchedSeverities,
            issues = issues.Select(ToIssueResponse).ToArray()
        };
    }

    public async Task<object> GetLatestCommentsAsync(JiraBoardCommentRequest request, CancellationToken ct = default)
    {
        var connection = ValidateConnection(request.Connection);
        var cutoffDate = ValidateCutoffDate(request.CutoffDate);
        using var server = await GetJsonAsync(connection, "serverInfo", ct);
        var serverNow = ParseJiraDate(GetString(server.RootElement, "serverTime")) ?? DateTimeOffset.Now;
        if (cutoffDate > DateOnly.FromDateTime(serverNow.Date))
            throw new ArgumentException("统计截止日期不能晚于 Jira 服务器当前日期。");
        var cutoff = cutoffDate == DateOnly.FromDateTime(serverNow.Date)
            ? serverNow
            : new DateTimeOffset(cutoffDate.Year, cutoffDate.Month, cutoffDate.Day, 23, 59, 59, serverNow.Offset);
        var keys = request.IssueKeys.Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim().ToUpperInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(MaxCommentIssues + 1)
            .ToArray();
        if (keys.Length == 0) throw new ArgumentException("请至少选择一个 Jira 问题。");
        if (keys.Length > MaxCommentIssues) throw new ArgumentException($"一次最多查询 {MaxCommentIssues} 个问题的最新评论。");
        if (keys.Any(x => !IssueKeyRegex().IsMatch(x))) throw new ArgumentException("Jira 问题编号格式无效。");

        using var gate = new SemaphoreSlim(6);
        var tasks = keys.Select(async key =>
        {
            await gate.WaitAsync(ct);
            try { return await GetLatestCommentAsync(connection, key, cutoff, ct); }
            finally { gate.Release(); }
        });
        return new { items = await Task.WhenAll(tasks) };
    }

    private async Task<object> GetLatestCommentAsync(ConnectionSettings connection, string key, DateTimeOffset cutoff, CancellationToken ct)
    {
        var startAt = 0;
        while (startAt < 500)
        {
            using var page = await GetJsonAsync(connection,
                $"issue/{Uri.EscapeDataString(key)}/comment?startAt={startAt}&maxResults=100&orderBy=-created", ct);
            var comments = page.RootElement.TryGetProperty("comments", out var values) && values.ValueKind == JsonValueKind.Array
                ? values.EnumerateArray().Select(ReadComment).Where(x => x.Created.HasValue).OrderByDescending(x => x.Created).ToArray()
                : [];
            var latest = comments.FirstOrDefault(x => x.Created!.Value <= cutoff);
            if (latest is not null)
            {
                return new
                {
                    key,
                    body = latest.Body,
                    author = latest.Author,
                    created = latest.Created
                };
            }
            var total = GetInt(page.RootElement, "total");
            startAt += comments.Length;
            if (comments.Length == 0 || startAt >= total) break;
        }
        return new { key, body = (string?)null, author = (string?)null, created = (DateTimeOffset?)null };
    }

    private static CommentValue ReadComment(JsonElement element)
    {
        var author = element.TryGetProperty("author", out var authorValue)
            ? GetString(authorValue, "displayName") ?? GetString(authorValue, "name")
            : null;
        var body = element.TryGetProperty("body", out var bodyValue) ? DisplayValue(bodyValue) : null;
        if (body?.Length > 800) body = body[..800] + "…";
        return new(body, author, ParseJiraDate(GetString(element, "created")));
    }

    private static AnalyzedIssue ParseIssue(JsonElement element, ConnectionSettings connection, string severityFieldId, DateTimeOffset cutoff)
    {
        var key = GetString(element, "key") ?? "UNKNOWN";
        var fields = element.GetProperty("fields");
        var summary = GetString(fields, "summary") ?? "（无标题）";
        var currentStatus = fields.TryGetProperty("status", out var statusValue)
            ? GetString(statusValue, "name") ?? "未知状态"
            : "未知状态";
        var currentAssignee = fields.TryGetProperty("assignee", out var assigneeValue) && assigneeValue.ValueKind == JsonValueKind.Object
            ? GetString(assigneeValue, "displayName") ?? GetString(assigneeValue, "name") ?? "未分配"
            : "未分配";
        var severityLabel = fields.TryGetProperty(severityFieldId, out var severityValue)
            ? DisplayValue(severityValue) ?? "未设置"
            : "未设置";
        var severityKey = NormalizeSeverity(severityLabel);
        var createdAt = ParseJiraDate(GetString(fields, "created")) ?? cutoff;
        var resolutionDate = ParseJiraDate(GetString(fields, "resolutiondate"));
        var allChanges = ReadChanges(element).OrderBy(x => x.Created).ToArray();
        var changes = allChanges.Where(x => x.Created <= cutoff).ToArray();
        var historyTruncated = true;
        if (element.TryGetProperty("changelog", out var historyPage) &&
            historyPage.TryGetProperty("histories", out var historyItems) && historyItems.ValueKind == JsonValueKind.Array)
            historyTruncated = GetInt(historyPage, "total") > historyItems.GetArrayLength();
        var statusChanges = changes.Where(x => IsStatusField(x.FieldId)).ToArray();
        var allStatusChanges = allChanges.Where(x => IsStatusField(x.FieldId)).ToArray();
        var assigneeChanges = allChanges.Where(x => IsAssigneeField(x.FieldId)).ToArray();

        var status = ResolveValueAt(currentStatus, allStatusChanges, cutoff);
        var assignee = ResolveValueAt(currentAssignee, assigneeChanges, cutoff);
        if (string.IsNullOrWhiteSpace(assignee)) assignee = "未分配";

        var initialStatus = allStatusChanges.FirstOrDefault()?.FromString;
        if (string.IsNullOrWhiteSpace(initialStatus)) initialStatus = status;
        var activeStage = StageFor(initialStatus);
        var activeStageStarted = createdAt;
        var completed = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        DateTimeOffset? lastClosedAt = activeStage == "closed" ? resolutionDate : null;

        foreach (var change in statusChanges)
        {
            if (change.Created < createdAt) continue;
            var newStage = StageFor(change.ToValue);
            if (!newStage.Equals(activeStage, StringComparison.OrdinalIgnoreCase))
            {
                if (activeStage != "other")
                {
                    var days = Math.Max(0, (change.Created - activeStageStarted).TotalDays);
                    completed[activeStage] = completed.GetValueOrDefault(activeStage) + days;
                }
                activeStage = newStage;
                activeStageStarted = change.Created;
            }
            if (newStage == "closed") lastClosedAt = change.Created;
            else if (activeStage != "closed") lastClosedAt = null;
        }

        var stageCode = StageFor(status);
        if (stageCode != activeStage)
        {
            activeStage = stageCode;
            activeStageStarted = statusChanges.LastOrDefault()?.Created ?? createdAt;
        }
        if (stageCode == "closed" && !lastClosedAt.HasValue && resolutionDate.HasValue && resolutionDate.Value <= cutoff) lastClosedAt = resolutionDate;

        var stageElapsedDays = Math.Max(0, (cutoff - activeStageStarted).TotalDays);
        var closureElapsedDays = Math.Max(0, ((stageCode == "closed" ? lastClosedAt ?? cutoff : cutoff) - createdAt).TotalDays);
        var stageLimit = StageLimit(stageCode, severityKey);
        var closureLimit = ClosureLimit(severityKey);
        var stageOverdue = stageCode == "closed" ? 0 : OverdueDays(stageElapsedDays, stageLimit);
        var closureOverdue = stageCode == "closed" ? OverdueDays(closureElapsedDays, closureLimit) : OverdueDays((cutoff - createdAt).TotalDays, closureLimit);

        return new AnalyzedIssue(
            key, summary, $"{connection.BaseUrl}/browse/{Uri.EscapeDataString(key)}", status, stageCode,
            StageName(stageCode), assignee, severityLabel, severityKey, createdAt, stageCode == "closed" ? lastClosedAt : null,
            Round(stageElapsedDays), stageLimit, stageOverdue, Round(closureElapsedDays), closureLimit, closureOverdue, completed, historyTruncated);
    }

    private static object ToIssueResponse(AnalyzedIssue issue) => new
    {
        issue.Key,
        issue.Summary,
        issue.Url,
        issue.Status,
        issue.StageCode,
        issue.StageName,
        issue.Assignee,
        issue.SeverityLabel,
        issue.SeverityKey,
        issue.CreatedAt,
        issue.ClosedAt,
        issue.StageElapsedDays,
        issue.StageLimitDays,
        issue.StageOverdueDays,
        issue.ClosureElapsedDays,
        issue.ClosureLimitDays,
        issue.ClosureOverdueDays,
        issue.HistoryTruncated
    };

    private static ChangeValue[] ReadChanges(JsonElement issue)
    {
        if (!issue.TryGetProperty("changelog", out var changelog) ||
            !changelog.TryGetProperty("histories", out var histories) || histories.ValueKind != JsonValueKind.Array) return [];
        var result = new List<ChangeValue>();
        foreach (var history in histories.EnumerateArray())
        {
            var created = ParseJiraDate(GetString(history, "created"));
            if (!created.HasValue || !history.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array) continue;
            foreach (var item in items.EnumerateArray())
            {
                var fieldId = GetString(item, "fieldId") ?? GetString(item, "field") ?? "";
                result.Add(new(created.Value, fieldId, GetString(item, "fromString"), GetString(item, "toString")));
            }
        }
        return result.ToArray();
    }

    private static string ResolveValueAt(string current, IReadOnlyList<ChangeValue> changes, DateTimeOffset cutoff)
    {
        if (changes.Count == 0) return current;
        var before = changes.Where(x => x.Created <= cutoff).OrderBy(x => x.Created).LastOrDefault();
        if (before is not null) return before.ToValue ?? current;
        return changes.OrderBy(x => x.Created).First().FromString ?? current;
    }

    private static List<FieldMeta> ReadFields(JsonElement root)
    {
        var result = new List<FieldMeta>();
        if (root.ValueKind != JsonValueKind.Array) return result;
        foreach (var item in root.EnumerateArray())
        {
            var id = GetString(item, "id");
            var name = GetString(item, "name");
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) continue;
            var custom = item.TryGetProperty("custom", out var customValue) && customValue.ValueKind == JsonValueKind.True;
            var searchable = !item.TryGetProperty("searchable", out var searchableValue) || searchableValue.ValueKind == JsonValueKind.True;
            var clause = custom && id.StartsWith("customfield_", StringComparison.OrdinalIgnoreCase)
                ? $"cf[{id[12..]}]"
                : ReadClause(item) ?? name;
            var schemaType = item.TryGetProperty("schema", out var schema) ? GetString(schema, "type") : null;
            result.Add(new(id, name, clause, custom, searchable, schemaType));
        }
        return result;
    }

    private static string? ReadClause(JsonElement field)
    {
        foreach (var property in new[] { "clauseNames", "clauses" })
        {
            if (!field.TryGetProperty(property, out var clauses) || clauses.ValueKind != JsonValueKind.Array) continue;
            var first = clauses.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()).FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(first)) return first;
        }
        return null;
    }

    private async Task<JsonDocument> GetJsonAsync(ConnectionSettings connection, string resource, CancellationToken ct) =>
        await SendJsonAsync(connection, HttpMethod.Get, resource, null, ct);

    private async Task<JsonDocument> SendJsonAsync(ConnectionSettings connection, HttpMethod method, string resource, string? payload, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, BuildApiUri(connection.BaseUrl, resource));
        var credential = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{connection.Username}:{connection.Password}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credential);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (payload is not null) request.Content = new StringContent(payload, Encoding.UTF8, "application/json");
        HttpResponseMessage response;
        try { response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct); }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { throw new JiraBoardException("连接 Jira 超时，请检查服务器地址和网络。", HttpStatusCode.GatewayTimeout); }
        catch (HttpRequestException) { throw new JiraBoardException("无法连接 Jira，请检查服务器地址、网络和证书配置。", HttpStatusCode.BadGateway); }
        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(ct);
                throw new JiraBoardException(BuildJiraError(response.StatusCode, errorBody), response.StatusCode);
            }
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            try { return await JsonDocument.ParseAsync(stream, cancellationToken: ct); }
            catch (JsonException) { throw new JiraBoardException("Jira 返回的数据格式无法识别，请确认服务器版本和接口地址。", HttpStatusCode.BadGateway); }
        }
    }

    private static string BuildJiraError(HttpStatusCode status, string body)
    {
        if (status == HttpStatusCode.Unauthorized) return "Jira 认证失败，请检查账号和密码。";
        if (status == HttpStatusCode.Forbidden) return "Jira 拒绝访问：该账号没有查看项目或问题的权限。";
        if (status == HttpStatusCode.NotFound) return "Jira 接口或项目不存在，请检查地址、上下文路径和项目编号。";
        try
        {
            using var error = JsonDocument.Parse(body);
            if (error.RootElement.TryGetProperty("errorMessages", out var messages) && messages.ValueKind == JsonValueKind.Array)
            {
                var text = string.Join("；", messages.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()));
                if (!string.IsNullOrWhiteSpace(text)) return $"Jira 查询失败：{text}";
            }
        }
        catch (JsonException) { }
        return $"Jira 请求失败（HTTP {(int)status}）。";
    }

    private static ConnectionSettings ValidateConnection(JiraConnectionRequest request)
    {
        if (request is null) throw new ArgumentException("请填写 Jira 连接信息。");
        if (!Uri.TryCreate(request.BaseUrl?.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ArgumentException("Jira 地址必须是完整的 HTTP 或 HTTPS 地址。");
        if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            throw new ArgumentException("Jira 地址不能包含账号、查询参数或锚点。");
        if (string.IsNullOrWhiteSpace(request.Username)) throw new ArgumentException("请填写 Jira 账号。");
        if (string.IsNullOrWhiteSpace(request.Password)) throw new ArgumentException("请填写 Jira 密码。");
        var projectKey = request.ProjectKey?.Trim().ToUpperInvariant() ?? "";
        if (!ProjectKeyRegex().IsMatch(projectKey)) throw new ArgumentException("Jira 项目编号格式无效。");
        var baseUrl = uri.GetLeftPart(UriPartial.Path).TrimEnd('/');
        return new(baseUrl, request.Username.Trim(), request.Password, projectKey);
    }

    private static DateOnly ValidateCutoffDate(string value)
    {
        if (!DateOnly.TryParseExact(value?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            throw new ArgumentException("统计截止日期格式无效。");
        return date;
    }

    private static string ValidateFieldId(string value)
    {
        var fieldId = value?.Trim() ?? "";
        if (!FieldIdRegex().IsMatch(fieldId)) throw new ArgumentException("严重等级字段无效，请重新加载 Jira 字段。");
        return fieldId;
    }

    private static string? NormalizeAdditionalJql(string? value)
    {
        var jql = value?.Trim();
        if (string.IsNullOrWhiteSpace(jql)) return null;
        if (jql.Length > 1500) throw new ArgumentException("附加 JQL 不能超过 1500 个字符，请精简条件或分批查询。");
        if (OrderByRegex().IsMatch(jql)) throw new ArgumentException("附加 JQL 中不要填写 ORDER BY，系统会统一排序。");
        return jql;
    }

    private static string BuildJql(string projectKey, DateOnly cutoff, string? additionalJql)
    {
        var parts = new List<string>
        {
            $"project = \"{EscapeJql(projectKey)}\"",
            $"created <= \"{cutoff:yyyy-MM-dd} 23:59\""
        };
        if (!string.IsNullOrWhiteSpace(additionalJql)) parts.Add($"({additionalJql})");
        return string.Join(" AND ", parts) + " ORDER BY created DESC";
    }

    private static string EscapeJql(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    private static Uri BuildApiUri(string baseUrl, string resource) => new($"{baseUrl}/rest/api/2/{resource}", UriKind.Absolute);
    private static string StageFor(string? status) => status is not null && StatusStages.TryGetValue(status.Trim(), out var stage) ? stage : "other";
    private static string StageName(string code) => Stages.FirstOrDefault(x => x.Code == code)?.Name ?? "其他状态";
    private static bool IsStatusField(string field) => field.Equals("status", StringComparison.OrdinalIgnoreCase) || field == "状态";
    private static bool IsAssigneeField(string field) => field.Equals("assignee", StringComparison.OrdinalIgnoreCase) || field is "经办人" or "处理人" or "受理人";

    private static int? StageLimit(string stage, string severity) => stage switch
    {
        "new" or "confirm" => 1,
        "analysis" when severity is "S" or "A" or "B" => 2,
        "analysis" when severity == "C" => 6,
        "action" when severity is "S" or "A" or "B" => 2,
        "action" when severity == "C" => 7,
        "verify" => 5,
        _ => null
    };

    private static int? ClosureLimit(string severity) => severity switch
    {
        "S" or "A" => 14,
        "B" or "C" => 25,
        _ => null
    };

    private static int OverdueDays(double elapsed, int? limit) => !limit.HasValue || elapsed <= limit.Value
        ? 0
        : Math.Max(1, (int)Math.Ceiling(elapsed - limit.Value));

    private static string NormalizeSeverity(string value)
    {
        var normalized = Regex.Replace(value.Trim().ToUpperInvariant(), @"\s+", "");
        if (IsSeverityValue(normalized, "S")) return "S";
        if (IsSeverityValue(normalized, "A")) return "A";
        if (IsSeverityValue(normalized, "B")) return "B";
        if (IsSeverityValue(normalized, "C")) return "C";
        return "UNKNOWN";
    }

    private static bool IsSeverityValue(string value, string grade) => value == grade ||
        value.StartsWith(grade + "级", StringComparison.Ordinal) || value.StartsWith(grade + "&", StringComparison.Ordinal) ||
        value.StartsWith(grade + "/", StringComparison.Ordinal) || value.StartsWith(grade + "(", StringComparison.Ordinal) ||
        value.StartsWith(grade + "（", StringComparison.Ordinal) || value.StartsWith(grade + "-", StringComparison.Ordinal);

    private static bool IsSeverityCandidate(string name, string id) =>
        SeverityCandidateScore(name, id) > 0;

    private static int SeverityCandidateScore(string name, string id) =>
        name.Contains("严重", StringComparison.OrdinalIgnoreCase) || name.Contains("severity", StringComparison.OrdinalIgnoreCase) ? 2 :
        id.Equals("priority", StringComparison.OrdinalIgnoreCase) ||
        name.Contains("priority", StringComparison.OrdinalIgnoreCase) ? 1 : 0;

    private static int SeverityOrder(string key) => key switch { "S" => 0, "A" => 1, "B" => 2, "C" => 3, _ => 9 };
    private static double? Average(IEnumerable<double> values)
    {
        var items = values.ToArray();
        return items.Length == 0 ? null : Round(items.Average());
    }
    private static double? Percent(int part, int total) => total == 0 ? null : Math.Round(part * 100d / total, 1);
    private static double Round(double value) => Math.Round(value, 1);

    private static string? DisplayValue(JsonElement value)
    {
        if (value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return null;
        if (value.ValueKind == JsonValueKind.String) return value.GetString();
        if (value.ValueKind == JsonValueKind.Number) return value.GetRawText();
        if (value.ValueKind == JsonValueKind.Array)
        {
            var parts = value.EnumerateArray().Select(DisplayValue).Where(x => !string.IsNullOrWhiteSpace(x));
            return string.Join("、", parts!);
        }
        if (value.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in new[] { "value", "name", "displayName", "key" })
            {
                var text = GetString(value, property);
                if (!string.IsNullOrWhiteSpace(text)) return text;
            }
        }
        return value.ToString();
    }

    private static string? GetString(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int GetInt(JsonElement element, string property) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.TryGetInt32(out var number) ? number : 0;

    private static DateTimeOffset? ParseJiraDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var parsed)) return parsed;
        var normalized = Regex.Replace(value, @"([+-]\d{2})(\d{2})$", "$1:$2");
        return DateTimeOffset.TryParse(normalized, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out parsed) ? parsed : null;
    }

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_-]{0,99}$")]
    private static partial Regex ProjectKeyRegex();
    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_-]{0,99}$")]
    private static partial Regex FieldIdRegex();
    [GeneratedRegex("^[A-Z][A-Z0-9_]*-[0-9]+$")]
    private static partial Regex IssueKeyRegex();
    [GeneratedRegex(@"\border\s+by\b", RegexOptions.IgnoreCase)]
    private static partial Regex OrderByRegex();

    private sealed record ConnectionSettings(string BaseUrl, string Username, string Password, string ProjectKey);
    private sealed record StageDefinition(string Code, string Name, int Order);
    private sealed record FieldMeta(string Id, string Name, string Clause, bool Custom, bool Searchable, string? SchemaType);
    private sealed record ChangeValue(DateTimeOffset Created, string FieldId, string? FromString, string? ToValue);
    private sealed record CommentValue(string? Body, string? Author, DateTimeOffset? Created);
    private sealed record AnalyzedIssue(
        string Key, string Summary, string Url, string Status, string StageCode, string StageName, string Assignee,
        string SeverityLabel, string SeverityKey, DateTimeOffset CreatedAt, DateTimeOffset? ClosedAt,
        double StageElapsedDays, int? StageLimitDays, int StageOverdueDays,
        double ClosureElapsedDays, int? ClosureLimitDays, int ClosureOverdueDays,
        Dictionary<string, double> CompletedStageDays,
        bool HistoryTruncated = false);
}

public sealed class JiraBoardException : Exception
{
    public HttpStatusCode StatusCode { get; }
    public JiraBoardException(string message, HttpStatusCode statusCode) : base(message) => StatusCode = statusCode;
}
