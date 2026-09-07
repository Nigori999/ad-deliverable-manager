namespace AdDeliverableManager.Models;

public sealed class IssueSnapshotRequest
{
    public int DepartmentItemId { get; set; }
    public int SourceItemId { get; set; }
    public int SeverityItemId { get; set; }
    public string RecordDate { get; set; } = "";
    public List<IssueStatusCountRequest> Counts { get; set; } = [];
    public int Revision { get; set; }
}

public sealed class IssueStatusCountRequest
{
    public int StatusItemId { get; set; }
    public int Count { get; set; }
}
