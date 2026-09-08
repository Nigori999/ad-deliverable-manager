namespace AdDeliverableManager.Models;

public sealed class JiraGlobalConfigurationRequest
{
    public string BaseUrl { get; set; } = "";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public int Revision { get; set; }
}

public sealed class JiraProjectRequest
{
    public string ProjectKey { get; set; } = "";
}

public sealed class JiraBoardAnalysisRequest
{
    public string ProjectKey { get; set; } = "";
    public string CutoffDate { get; set; } = "";
    public string SeverityFieldId { get; set; } = "priority";
    public string VariantFieldId { get; set; } = "";
    public string? AdditionalJql { get; set; }
}

public sealed class JiraBoardCommentRequest
{
    public string ProjectKey { get; set; } = "";
    public string CutoffDate { get; set; } = "";
    public string[] IssueKeys { get; set; } = [];
}
