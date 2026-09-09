namespace AdDeliverableManager.Models;

public sealed class JiraProjectStandardRequest
{
    public string JiraBaseUrl { get; set; } = "";
    public string ProjectKey { get; set; } = "";
    public string ProjectName { get; set; } = "";
    public bool IsEnabled { get; set; } = true;
    public List<JiraStageStandardRequest> Stages { get; set; } = [];
    public Dictionary<string, int?> ClosureLimits { get; set; } = new();
    public string RuleNote { get; set; } = "";
    public int Revision { get; set; }
}

public sealed class JiraStageStandardRequest
{
    public string StageCode { get; set; } = "";
    public List<string> Statuses { get; set; } = [];
    public Dictionary<string, int?> Limits { get; set; } = new();
}

public sealed class JiraQueryConditionRequest
{
    public string FieldId { get; set; } = "";
    public string FieldName { get; set; } = "";
    public string Operator { get; set; } = "";
    public string Value { get; set; } = "";
}

public sealed class JiraQueryPresetRequest
{
    public string JiraBaseUrl { get; set; } = "";
    public string ProjectKey { get; set; } = "";
    public string Name { get; set; } = "";
    public string SeverityFieldId { get; set; } = "";
    public string VariantFieldId { get; set; } = "";
    public List<JiraQueryConditionRequest> Conditions { get; set; } = [];
    public string AdditionalJql { get; set; } = "";
    public int Revision { get; set; }
}

public sealed record JiraProjectStandardDefinition(
    int Id,
    string JiraBaseUrl,
    string ProjectKey,
    string ProjectName,
    bool IsEnabled,
    IReadOnlyList<JiraStageStandardRequest> Stages,
    IReadOnlyDictionary<string, int?> ClosureLimits,
    string RuleNote,
    string CreatedBy,
    string CreatedAt,
    string UpdatedBy,
    string UpdatedAt,
    int Revision);
