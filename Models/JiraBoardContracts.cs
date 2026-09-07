namespace AdDeliverableManager.Models;

public sealed class JiraConnectionRequest
{
    public string BaseUrl { get; set; } = "";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string ProjectKey { get; set; } = "";
}

public sealed class JiraBoardAnalysisRequest
{
    public JiraConnectionRequest Connection { get; set; } = new();
    public string CutoffDate { get; set; } = "";
    public string SeverityFieldId { get; set; } = "priority";
    public string? AdditionalJql { get; set; }
}

public sealed class JiraBoardCommentRequest
{
    public JiraConnectionRequest Connection { get; set; } = new();
    public string CutoffDate { get; set; } = "";
    public string[] IssueKeys { get; set; } = [];
}
