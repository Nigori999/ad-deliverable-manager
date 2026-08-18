namespace AdDeliverableManager.Models;

public class RoleCreateRequest
{
    public string Name { get; set; } = "";
    public string Code { get; set; } = "";
    public string? Description { get; set; }
    public bool IsEnabled { get; set; } = true;
}

public sealed class RoleUpdateRequest : RoleCreateRequest
{
    public int Revision { get; set; }
}

public sealed class RolePermissionUpdateRequest
{
    public string[] PermissionCodes { get; set; } = [];
    public DataScopeGrant[] DataScopes { get; set; } = [];
}

public sealed class DataScopeGrant
{
    public string Dimension { get; set; } = "";
    public string ScopeType { get; set; } = "INCLUDE";
    public string ScopeValue { get; set; } = "";
}