namespace AdDeliverableManager.Models;

public sealed class DictionaryTypeRequest
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string ScopeMode { get; set; } = "NONE";
    public int SortOrder { get; set; }
}

public sealed class DictionaryItemRequest
{
    public string ItemCode { get; set; } = "";
    public string ItemName { get; set; } = "";
    public string? ScopeValue { get; set; }
    public int? ParentItemId { get; set; }
    public int SortOrder { get; set; }
    public string? Remark { get; set; }
}
