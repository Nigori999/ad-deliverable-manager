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
    private readonly JiraConfigurationRepository _configuration;

    private static readonly StageDefinition[] Stages =
    [
        new("new", "新增", 0),
        new("confirm", "问题确认", 1),
        new("analysis", "原因分析", 2),
        new("action", "措施确认", 3),
        new("verify", "测试验证", 4),
        new("closed", "问题关闭", 5)
    ];

    public JiraBoardService(HttpClient http, JiraConfigurationRepository configuration)
    {
        _http = http;
        _configuration = configuration;
    }

    public async Task<object> GetProjectsAsync(CancellationToken ct = default)
    {
        var global = await _configuration.RequireGlobalConnectionAsync(ct);
        var connection = ValidateConnection(global.BaseUrl, global.Username, global.Password, "", false);
        using var server = await GetJsonAsync(connection, "serverInfo", ct);
        using var projects = await GetJsonAsync(connection, "project", ct);
        var items = projects.RootElement.ValueKind == JsonValueKind.Array
            ? projects.RootElement.EnumerateArray()
                .Select(x => new { key = GetString(x, "key") ?? "", name = GetString(x, "name") ?? GetString(x, "key") ?? "" })
                .Where(x => x.key.Length > 0)
                .OrderBy(x => x.key, StringComparer.OrdinalIgnoreCase)
                .ToArray()
            : [];
        return new
        {
            configured = true,
            server = new { title = GetString(server.RootElement, "serverTitle") ?? "Jira Server", version = GetString(server.RootElement, "version") ?? "未知版本" },
            projects = items
        };
    }

    public async Task<object> TestConnectionAsync(JiraGlobalConfigurationRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var password = request.Password;
        if (string.IsNullOrEmpty(password))
        {
            var existing = await _configuration.GetGlobalConnectionAsync(ct);
            password = existing?.Password ?? "";
        }
        var connection = ValidateConnection(request.BaseUrl, request.Username, password, "", false);
        using var server = await GetJsonAsync(connection, "serverInfo", ct);
        using var projects = await GetJsonAsync(connection, "project", ct);
        var projectCount = projects.RootElement.ValueKind == JsonValueKind.Array ? projects.RootElement.GetArrayLength() : 0;
        return new
        {
            title = GetString(server.RootElement, "serverTitle") ?? "Jira Server",
            version = GetString(server.RootElement, "version") ?? "未知版本",
            projectCount
        };
    }

    public async Task<object> GetMetadataAsync(JiraProjectRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var connection = await ConnectionForProjectAsync(request.ProjectKey, ct);
        using var server = await GetJsonAsync(connection, "serverInfo", ct);
        using var project = await GetJsonAsync(connection, $"project/{Uri.EscapeDataString(connection.ProjectKey)}", ct);
        using var fields = await GetJsonAsync(connection, "field", ct);

        var allFields = ReadFields(fields.RootElement);
        var fieldItems = ToFieldResponse(allFields);
        FieldMeta[] projectFieldSource;
        string? projectFieldWarning = null;
        var projectFieldsScoped = true;
        try
        {
            projectFieldSource = await GetProjectFieldsAsync(connection, server.RootElement, ct);
            if (projectFieldSource.Length == 0) throw new InvalidOperationException("当前账号未返回可创建字段。");
        }
        catch (Exception ex) when (ex is JiraBoardException or InvalidOperationException)
        {
            try
            {
                projectFieldSource = await GetIssueScopedProjectFieldsAsync(connection, allFields, ct);
                if (projectFieldSource.Length == 0) throw new InvalidOperationException("当前项目暂无可用的问题字段。");
                projectFieldWarning = "当前账号无法读取项目创建表单，已改为仅显示该项目问题中可见的字段。";
            }
            catch (Exception fallbackEx) when (fallbackEx is JiraBoardException or InvalidOperationException)
            {
                projectFieldSource = [];
                projectFieldsScoped = false;
                projectFieldWarning = "无法读取当前项目的表单字段，不会回退显示其他项目字段。请确认账号具有该项目的查看或创建问题权限。";
            }
        }
        var projectFieldItems = ToFieldResponse(projectFieldSource);
        var standard = await _configuration.GetEffectiveStandardAsync(connection.BaseUrl, connection.ProjectKey, ct);

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
            fields = fieldItems,
            projectFields = projectFieldItems,
            projectFieldsScoped,
            projectFieldWarning,
            standard = standard is null ? null : new
            {
                standard.Id,
                standard.ProjectName,
                standard.RuleNote,
                standard.Revision
            }
        };
    }

    private static object[] ToFieldResponse(IEnumerable<FieldMeta> fields) => fields
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

    public async Task<object> AnalyzeAsync(JiraBoardAnalysisRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var connection = await ConnectionForProjectAsync(request.ProjectKey, ct);
        var cutoffDate = ValidateCutoffDate(request.CutoffDate);
        var severityFieldId = ValidateFieldId(request.SeverityFieldId);
        var variantFieldId = ValidateFieldId(request.VariantFieldId, "ECU Variant字段");
        var additionalJql = NormalizeAdditionalJql(request.AdditionalJql);
        var standard = await _configuration.GetEffectiveStandardAsync(connection.BaseUrl, connection.ProjectKey, ct)
            ?? throw new ArgumentException($"项目 {connection.ProjectKey} 尚未配置启用的JIRA时效标准，请先在“系统管理 / JIRA时效标准”中完成配置。");

        using var server = await GetJsonAsync(connection, "serverInfo", ct);
        var serverNow = ParseJiraDate(GetString(server.RootElement, "serverTime")) ?? DateTimeOffset.Now;
        if (cutoffDate > DateOnly.FromDateTime(serverNow.Date))
            throw new ArgumentException("统计截止日期不能晚于 Jira 服务器当前日期。");
        var effectiveCutoff = cutoffDate == DateOnly.FromDateTime(serverNow.Date)
            ? serverNow
            : new DateTimeOffset(cutoffDate.Year, cutoffDate.Month, cutoffDate.Day, 23, 59, 59, serverNow.Offset);

        var jql = BuildJql(connection.ProjectKey, cutoffDate, additionalJql);
        var requestedFields = new[] { "summary", "status", "assignee", "created", "resolutiondate", severityFieldId, variantFieldId }
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
                issues.Add(ParseIssue(issue, connection, severityFieldId, variantFieldId, effectiveCutoff, standard));
            }
            startAt += pageIssues.GetArrayLength();
            if (pageIssues.GetArrayLength() == 0) break;
        }
        while (startAt < total && issues.Count < MaxIssues);

        var closedCount = issues.Count(x => x.StageCode == "closed");
        var activeCount = issues.Count - closedCount;
        var closedDurations = issues.Where(x => x.StageCode == "closed" && x.TimingReliable && x.ClosedAt.HasValue)
            .Select(x => (x.ClosedAt!.Value - x.CreatedAt).TotalDays)
            .Where(x => x >= 0)
            .ToArray();

        var funnelCounts = Stages.Select(stage => new
        {
            code = stage.Code,
            name = stage.Name,
            order = stage.Order,
            count = issues.Count(x => x.MaxReachedStageOrder >= stage.Order)
        }).ToArray();
        var funnel = funnelCounts.Select((stage, index) => new
        {
            stage.code,
            stage.name,
            stage.order,
            stage.count,
            share = Percent(stage.count, issues.Count),
            previousConversion = Percent(stage.count, index == 0 ? issues.Count : funnelCounts[index - 1].count),
            dropFromPrevious = index == 0 ? 0 : Math.Max(0, funnelCounts[index - 1].count - stage.count)
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

        var severityAverages = issues.Where(x => x.StageCode == "closed" && x.TimingReliable && x.ClosedAt.HasValue)
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
            effectiveCutoff,
            jiraBaseUrl = connection.BaseUrl,
            cutoffDate = cutoffDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            project = connection.ProjectKey,
            standard = new { standard.Id, standard.ProjectName, standard.RuleNote, standard.Revision },
            query = jql,
            truncated = total > MaxIssues,
            sourceTotal = total,
            historyTruncated = issues.Count(x => x.HistoryTruncated),
            summary = new
            {
                total = issues.Count,
                active = activeCount,
                closed = closedCount,
                assessedClosed = issues.Count(x => x.StageCode == "closed" && x.IsOnTime.HasValue),
                onTimeClosed = issues.Count(x => x.StageCode == "closed" && x.IsOnTime == true),
                onTimeRate = Percent(issues.Count(x => x.StageCode == "closed" && x.IsOnTime == true), issues.Count(x => x.StageCode == "closed" && x.IsOnTime.HasValue)),
                unassessableClosed = issues.Count(x => x.StageCode == "closed" && !x.IsOnTime.HasValue),
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

    public async Task<JiraReviewSnapshot> GetReviewSnapshotAsync(JiraReviewRequest request, CancellationToken ct)
    {
        var connection = await ConnectionForProjectAsync(request.ProjectKey, ct);
        var key = (request.IssueKey ?? "").Trim().ToUpperInvariant();
        if (!IssueKeyRegex().IsMatch(key)) throw new ArgumentException("Jira问题编号格式无效。");
        var severityField = ValidateFieldId(request.SeverityFieldId);
        var variantField = ValidateFieldId(request.VariantFieldId, "ECU Variant字段");
        var standard = await _configuration.GetEffectiveStandardAsync(connection.BaseUrl, connection.ProjectKey, ct)
            ?? throw new ArgumentException("当前项目没有启用的时效标准，请完成配置后重新分析。");
        var cutoffDate = ValidateCutoffDate(request.CutoffDate);
        using var server = await GetJsonAsync(connection, "serverInfo", ct);
        var now = ParseJiraDate(GetString(server.RootElement, "serverTime")) ?? DateTimeOffset.Now;
        if (cutoffDate > DateOnly.FromDateTime(now.Date)) throw new ArgumentException("统计截止日期不能晚于当前日期。");
        var cutoff = cutoffDate == DateOnly.FromDateTime(now.Date) ? now
            : new DateTimeOffset(cutoffDate.Year, cutoffDate.Month, cutoffDate.Day, 23, 59, 59, now.Offset);
        var fields = Uri.EscapeDataString($"summary,status,assignee,created,resolutiondate,project,{severityField},{variantField}");
        using var page = await GetJsonAsync(connection, $"issue/{Uri.EscapeDataString(key)}?fields={fields}&expand=changelog", ct);
        var project = page.RootElement.GetProperty("fields").GetProperty("project");
        if (!string.Equals(GetString(project, "key"), connection.ProjectKey, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("问题不属于所选项目，请重新分析。");
        var issue = ParseIssue(page.RootElement, connection, severityField, variantField, cutoff, standard);
        if (issue.StageCode != "closed" || !issue.TimingReliable)
            throw new InvalidOperationException("问题未关闭或历史数据不完整，无法保存复盘，请重新分析并核对Jira历史。");
        if (issue.IsOnTime != false && !issue.StageTimings.Any(x => x.OverdueDays > 0))
            throw new InvalidOperationException("该问题未发现关闭总周期或阶段超期，无需填写超期复盘。");
        return new(connection.BaseUrl, issue.IssueId, connection.ProjectKey, issue.Key, issue.Summary, issue.Url,
            issue.SeverityLabel, issue.SeverityKey, issue.CreatedAt, issue.ClosedAt!.Value, issue.ClosureElapsedDays,
            issue.ClosureLimitDays, issue.IsOnTime.HasValue ? issue.ClosureOverdueDays : null,
            issue.StageTimings, standard.Id, standard.Revision, cutoffDate.ToString("yyyy-MM-dd"));
    }

    public async Task<object> GetLatestCommentsAsync(JiraBoardCommentRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var connection = await ConnectionForProjectAsync(request.ProjectKey, ct);
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
        CommentValue? latest = null;
        var total = 0;
        while (startAt < 500)
        {
            using var page = await GetJsonAsync(connection,
                $"issue/{Uri.EscapeDataString(key)}/comment?startAt={startAt}&maxResults=100", ct);
            var comments = page.RootElement.TryGetProperty("comments", out var values) && values.ValueKind == JsonValueKind.Array
                ? values.EnumerateArray().ToArray()
                : [];
            foreach (var comment in comments.Select(ReadComment).Where(x => x.Created.HasValue && x.Created.Value <= cutoff))
            {
                if (latest is null || comment.Created!.Value > latest.Created!.Value) latest = comment;
            }
            total = GetInt(page.RootElement, "total");
            startAt += comments.Length;
            if (comments.Length == 0 || startAt >= total) break;
        }
        if (startAt < total)
            return new { key, body = (string?)null, author = (string?)null, created = (DateTimeOffset?)null, error = "该问题评论超过500条，无法准确还原截止日最新评论。" };
        if (latest is not null)
            return new { key, body = latest.Body, author = latest.Author, created = latest.Created };
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

    private static AnalyzedIssue ParseIssue(JsonElement element, ConnectionSettings connection, string severityFieldId, string variantFieldId, DateTimeOffset cutoff, JiraProjectStandardDefinition standard)
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
        var variantLabel = fields.TryGetProperty(variantFieldId, out var variantValue)
            ? DisplayValue(variantValue) ?? "其他/未填写"
            : "其他/未填写";
        var variantKey = NormalizeVariant(variantLabel);
        var createdDate = ParseJiraDate(GetString(fields, "created"));
        var createdAt = createdDate ?? cutoff;
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
        var activeStage = StageFor(initialStatus, standard);
        var activeStageStarted = createdAt;
        var completed = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        var closureEvents = new List<JiraClosureEvent>();
        var closureLimit = ClosureLimit(severityKey, standard);
        DateTimeOffset? lastClosedAt = activeStage == "closed" ? resolutionDate : null;

        foreach (var change in statusChanges)
        {
            if (change.Created < createdAt) continue;
            var newStage = StageFor(change.ToValue, standard);
            if (!newStage.Equals(activeStage, StringComparison.OrdinalIgnoreCase))
            {
                if (activeStage != "other")
                {
                    var days = Math.Max(0, (change.Created - activeStageStarted).TotalDays);
                    completed[activeStage] = completed.GetValueOrDefault(activeStage) + days;
                }
                if (activeStage == "closed" && closureEvents.Count > 0)
                    closureEvents[^1] = closureEvents[^1] with { ReopenedAt = change.Created };
                if (newStage == "closed")
                {
                    lastClosedAt = change.Created;
                    var elapsed = (change.Created - createdAt).TotalDays;
                    closureEvents.Add(new(change.Created, null, elapsed,
                        !historyTruncated && createdDate.HasValue && elapsed >= 0 && closureLimit.HasValue ? elapsed <= closureLimit.Value : null,
                        !historyTruncated && createdDate.HasValue && elapsed >= 0));
                }
                else lastClosedAt = null;
                activeStage = newStage;
                activeStageStarted = change.Created;
            }
        }

        var stageCode = StageFor(status, standard);
        if (stageCode != activeStage)
        {
            activeStage = stageCode;
            activeStageStarted = statusChanges.LastOrDefault()?.Created ?? createdAt;
        }
        if (stageCode == "closed" && !lastClosedAt.HasValue && resolutionDate.HasValue && resolutionDate.Value <= cutoff) lastClosedAt = resolutionDate;
        var maxReachedStageOrder = new[] { initialStatus, status }
            .Concat(statusChanges.Select(x => x.ToValue))
            .Select(value => StageFor(value, standard))
            .Select(code => Stages.FirstOrDefault(stage => stage.Code.Equals(code, StringComparison.OrdinalIgnoreCase))?.Order ?? 0)
            .DefaultIfEmpty(0)
            .Max();

        var stageElapsedDays = Math.Max(0, (cutoff - activeStageStarted).TotalDays);
        var closureElapsedDays = Math.Max(0, ((stageCode == "closed" ? lastClosedAt ?? cutoff : cutoff) - createdAt).TotalDays);
        var stageLimit = StageLimit(stageCode, severityKey, standard);
        var timingReliable = !historyTruncated && createdDate.HasValue && lastClosedAt.HasValue && lastClosedAt.Value >= createdAt && lastClosedAt.Value <= cutoff;
        if (stageCode == "closed" && timingReliable && closureEvents.Count == 0)
            closureEvents.Add(new(lastClosedAt!.Value, null, closureElapsedDays, closureLimit.HasValue ? closureElapsedDays <= closureLimit.Value : null, true));
        var stageTimings = Stages.Where(x => x.Code != "closed" && completed.ContainsKey(x.Code)).Select(stage =>
        {
            var days = completed[stage.Code];
            var limit = StageLimit(stage.Code, severityKey, standard);
            return new JiraStageTiming(stage.Code, stage.Name, Round(days), limit,
                !historyTruncated && createdDate.HasValue && limit.HasValue ? OverdueDays(days, limit) : null);
        }).ToArray();
        var stageOverdue = stageCode == "closed" ? 0 : OverdueDays(stageElapsedDays, stageLimit);
        var closureOverdue = stageCode == "closed" ? OverdueDays(closureElapsedDays, closureLimit) : OverdueDays((cutoff - createdAt).TotalDays, closureLimit);

        return new AnalyzedIssue(
            key, summary, $"{connection.BaseUrl}/browse/{Uri.EscapeDataString(key)}", status, stageCode,
            StageName(stageCode), assignee, severityLabel, severityKey, variantLabel, variantKey,
            maxReachedStageOrder, createdAt, stageCode == "closed" ? lastClosedAt : null,
            Round(stageElapsedDays), stageLimit, stageOverdue, Round(closureElapsedDays), closureLimit, closureOverdue, completed, historyTruncated,
            GetString(element, "id") ?? key, timingReliable && closureLimit.HasValue ? closureElapsedDays <= closureLimit.Value : null,
            timingReliable, stageTimings, closureEvents.ToArray());
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
        issue.VariantLabel,
        issue.VariantKey,
        issue.MaxReachedStageOrder,
        issue.CreatedAt,
        issue.ClosedAt,
        issue.StageElapsedDays,
        issue.StageLimitDays,
        issue.StageOverdueDays,
        issue.ClosureElapsedDays,
        issue.ClosureLimitDays,
        issue.ClosureOverdueDays,
        issue.CompletedStageDays,
        issue.HistoryTruncated,
        issue.IssueId,
        issue.IsOnTime,
        issue.TimingReliable,
        issue.StageTimings,
        issue.ClosureEvents
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

    private async Task<FieldMeta[]> GetProjectFieldsAsync(ConnectionSettings connection, JsonElement server, CancellationToken ct)
    {
        var version = ReadServerVersion(server);
        return version is not null && version < new Version(8, 4)
            ? await GetLegacyProjectFieldsAsync(connection, ct)
            : await GetPagedProjectFieldsAsync(connection, ct);
    }

    private async Task<FieldMeta[]> GetIssueScopedProjectFieldsAsync(ConnectionSettings connection, IReadOnlyList<FieldMeta> allFields, CancellationToken ct)
    {
        var jql = $"project = \"{EscapeJql(connection.ProjectKey)}\" ORDER BY created DESC";
        using var page = await GetJsonAsync(connection,
            $"search?jql={Uri.EscapeDataString(jql)}&startAt=0&maxResults=1&fields=*all", ct);
        if (!page.RootElement.TryGetProperty("issues", out var issues) || issues.ValueKind != JsonValueKind.Array)
            return [];
        var issue = issues.EnumerateArray().FirstOrDefault();
        if (issue.ValueKind != JsonValueKind.Object || !issue.TryGetProperty("fields", out var fields) || fields.ValueKind != JsonValueKind.Object)
            return [];
        var ids = fields.EnumerateObject().Select(x => x.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return allFields.Where(x => ids.Contains(x.Id)).ToArray();
    }

    private async Task<FieldMeta[]> GetPagedProjectFieldsAsync(ConnectionSettings connection, CancellationToken ct)
    {
        var issueTypeIds = new List<string>();
        var startAt = 0;
        while (startAt < 1000)
        {
            using var page = await GetJsonAsync(connection,
                $"issue/createmeta/{Uri.EscapeDataString(connection.ProjectKey)}/issuetypes?startAt={startAt}&maxResults=100", ct);
            var values = ReadValues(page.RootElement);
            foreach (var item in values)
            {
                var id = GetString(item, "id");
                if (!string.IsNullOrWhiteSpace(id)) issueTypeIds.Add(id);
            }
            if (values.Length == 0 || IsLastPage(page.RootElement, startAt, values.Length)) break;
            startAt += values.Length;
        }

        var result = new List<FieldMeta>();
        foreach (var issueTypeId in issueTypeIds.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            startAt = 0;
            while (startAt < 1000)
            {
                using var page = await GetJsonAsync(connection,
                    $"issue/createmeta/{Uri.EscapeDataString(connection.ProjectKey)}/issuetypes/{Uri.EscapeDataString(issueTypeId)}?startAt={startAt}&maxResults=100", ct);
                var values = ReadValues(page.RootElement);
                foreach (var item in values)
                {
                    var field = ReadCreateField(item);
                    if (field is not null) result.Add(field);
                }
                if (values.Length == 0 || IsLastPage(page.RootElement, startAt, values.Length)) break;
                startAt += values.Length;
            }
        }
        return result.DistinctBy(x => x.Id, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private async Task<FieldMeta[]> GetLegacyProjectFieldsAsync(ConnectionSettings connection, CancellationToken ct)
    {
        using var document = await GetJsonAsync(connection,
            $"issue/createmeta?projectKeys={Uri.EscapeDataString(connection.ProjectKey)}&expand=projects.issuetypes.fields", ct);
        var result = new List<FieldMeta>();
        if (!document.RootElement.TryGetProperty("projects", out var projects) || projects.ValueKind != JsonValueKind.Array) return [];
        foreach (var project in projects.EnumerateArray())
        {
            if (!project.TryGetProperty("issuetypes", out var issueTypes) || issueTypes.ValueKind != JsonValueKind.Array) continue;
            foreach (var issueType in issueTypes.EnumerateArray())
            {
                if (!issueType.TryGetProperty("fields", out var fields) || fields.ValueKind != JsonValueKind.Object) continue;
                foreach (var property in fields.EnumerateObject())
                {
                    var field = ReadCreateField(property.Value, property.Name);
                    if (field is not null) result.Add(field);
                }
            }
        }
        return result.DistinctBy(x => x.Id, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static FieldMeta? ReadCreateField(JsonElement item, string? fallbackId = null)
    {
        var id = GetString(item, "fieldId") ?? GetString(item, "id") ?? fallbackId;
        var name = GetString(item, "name");
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name)) return null;
        var custom = id.StartsWith("customfield_", StringComparison.OrdinalIgnoreCase);
        var clause = custom ? $"cf[{id[12..]}]" : name;
        var schemaType = item.TryGetProperty("schema", out var schema) ? GetString(schema, "type") : null;
        return new(id, name, clause, custom, true, schemaType);
    }

    private static JsonElement[] ReadValues(JsonElement root) =>
        root.TryGetProperty("values", out var values) && values.ValueKind == JsonValueKind.Array
            ? values.EnumerateArray().ToArray()
            : [];

    private static bool IsLastPage(JsonElement root, int startAt, int count)
    {
        foreach (var property in new[] { "isLast", "last" })
        {
            if (root.TryGetProperty(property, out var isLast) && isLast.ValueKind is JsonValueKind.True or JsonValueKind.False)
                return isLast.GetBoolean();
        }
        var total = GetInt(root, "total");
        return total > 0 && startAt + count >= total;
    }

    private static Version? ReadServerVersion(JsonElement server)
    {
        if (server.TryGetProperty("versionNumbers", out var numbers) && numbers.ValueKind == JsonValueKind.Array)
        {
            var parts = numbers.EnumerateArray().Where(x => x.TryGetInt32(out _)).Select(x => x.GetInt32()).Take(3).ToArray();
            if (parts.Length >= 2) return new Version(parts[0], parts[1], parts.Length > 2 ? parts[2] : 0);
        }
        return Version.TryParse(GetString(server, "version"), out var version) ? version : null;
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

    private async Task<ConnectionSettings> ConnectionForProjectAsync(string? projectKey, CancellationToken ct)
    {
        var global = await _configuration.RequireGlobalConnectionAsync(ct);
        return ValidateConnection(global.BaseUrl, global.Username, global.Password, projectKey, true);
    }

    private static ConnectionSettings ValidateConnection(string? baseUrlValue, string? usernameValue, string? passwordValue, string? projectKeyValue, bool requireProject)
    {
        if (!Uri.TryCreate(baseUrlValue?.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ArgumentException("Jira 地址必须是完整的 HTTP 或 HTTPS 地址。");
        if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            throw new ArgumentException("Jira 地址不能包含账号、查询参数或锚点。");
        if (string.IsNullOrWhiteSpace(usernameValue)) throw new ArgumentException("请填写 Jira 账号。");
        if (string.IsNullOrWhiteSpace(passwordValue)) throw new ArgumentException("请填写 Jira 密码。");
        var projectKey = projectKeyValue?.Trim().ToUpperInvariant() ?? "";
        if (requireProject && !ProjectKeyRegex().IsMatch(projectKey)) throw new ArgumentException("Jira 项目编号格式无效。");
        var baseUrl = uri.GetLeftPart(UriPartial.Path).TrimEnd('/');
        return new(baseUrl, usernameValue.Trim(), passwordValue, projectKey);
    }

    private static DateOnly ValidateCutoffDate(string value)
    {
        if (!DateOnly.TryParseExact(value?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            throw new ArgumentException("统计截止日期格式无效。");
        return date;
    }

    private static string ValidateFieldId(string value, string fieldName = "严重等级字段")
    {
        var fieldId = value?.Trim() ?? "";
        if (!FieldIdRegex().IsMatch(fieldId)) throw new ArgumentException($"{fieldName}无效，请重新加载 Jira 字段。");
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
    private static string StageFor(string? status, JiraProjectStandardDefinition standard)
    {
        if (string.IsNullOrWhiteSpace(status)) return "other";
        var normalized = status.Trim();
        return standard.Stages.FirstOrDefault(stage => stage.Statuses.Any(value => value.Equals(normalized, StringComparison.OrdinalIgnoreCase)))?.StageCode ?? "other";
    }
    private static string StageName(string code) => Stages.FirstOrDefault(x => x.Code == code)?.Name ?? "其他状态";
    private static bool IsStatusField(string field) => field.Equals("status", StringComparison.OrdinalIgnoreCase) || field == "状态";
    private static bool IsAssigneeField(string field) => field.Equals("assignee", StringComparison.OrdinalIgnoreCase) || field is "经办人" or "处理人" or "受理人";

    private static int? StageLimit(string stage, string severity, JiraProjectStandardDefinition standard)
    {
        var definition = standard.Stages.FirstOrDefault(x => x.StageCode.Equals(stage, StringComparison.OrdinalIgnoreCase));
        return definition is not null && definition.Limits.TryGetValue(severity, out var value) ? value : null;
    }

    private static int? ClosureLimit(string severity, JiraProjectStandardDefinition standard) =>
        standard.ClosureLimits.TryGetValue(severity, out var value) ? value : null;

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

    private static string NormalizeVariant(string value)
    {
        var normalized = value.Trim();
        if (normalized.Equals("ADS", StringComparison.OrdinalIgnoreCase)) return "ADS";
        if (normalized.Equals("LiDAR", StringComparison.OrdinalIgnoreCase)) return "LIDAR";
        return "OTHER";
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
        string SeverityLabel, string SeverityKey, string VariantLabel, string VariantKey,
        int MaxReachedStageOrder, DateTimeOffset CreatedAt, DateTimeOffset? ClosedAt,
        double StageElapsedDays, int? StageLimitDays, int StageOverdueDays,
        double ClosureElapsedDays, int? ClosureLimitDays, int ClosureOverdueDays,
        Dictionary<string, double> CompletedStageDays,
        bool HistoryTruncated, string IssueId, bool? IsOnTime, bool TimingReliable,
        JiraStageTiming[] StageTimings, JiraClosureEvent[] ClosureEvents);
}

public sealed class JiraBoardException : Exception
{
    public HttpStatusCode StatusCode { get; }
    public JiraBoardException(string message, HttpStatusCode statusCode) : base(message) => StatusCode = statusCode;
}
