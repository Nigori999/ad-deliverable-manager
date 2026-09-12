namespace AdDeliverableManager.Models;

public sealed record JiraStageTiming(string Code, string Name, double ElapsedDays, int? LimitDays, int? OverdueDays);
public sealed record JiraClosureEvent(DateTimeOffset ClosedAt, DateTimeOffset? ReopenedAt, double? ElapsedDays, bool? IsOnTime, bool TimingReliable);
public sealed record JiraReviewSnapshot(
    string JiraBaseUrl, string IssueId, string ProjectKey, string Key, string Summary, string Url,
    string SeverityLabel, string SeverityKey, DateTimeOffset CreatedAt, DateTimeOffset ClosedAt,
    double ClosureElapsedDays, int? ClosureLimitDays, int? ClosureOverdueDays,
    JiraStageTiming[] StageTimings, int StandardId, int StandardRevision, string CutoffDate);

public sealed class JiraReviewRequest
{
    public string ProjectKey { get; set; } = "";
    public string IssueKey { get; set; } = "";
    public string CutoffDate { get; set; } = "";
    public string SeverityFieldId { get; set; } = "";
    public string VariantFieldId { get; set; } = "";
    public string Reason { get; set; } = "";
    public string ResponsiblePerson { get; set; } = "";
    public int CategoryItemId { get; set; }
    public int Revision { get; set; }
}

public sealed record JiraReviewRecord(int Id, JiraReviewSnapshot Snapshot, string Reason,
    string ResponsiblePerson, int CategoryItemId, string CategoryName, string CreatedBy,
    string CreatedAt, string UpdatedBy, string UpdatedAt, int Revision);
