namespace AdDeliverableManager.Models;

public sealed class RoleCreateRequest
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
    public WorkflowNodeGrant[] WorkflowNodes { get; set; } = [];
    public DataScopeGrant[] DataScopes { get; set; } = [];
}

public sealed class WorkflowNodeGrant
{
    public string NodeCode { get; set; } = "";
    public bool Enabled { get; set; }
}

public sealed class DataScopeGrant
{
    public string Dimension { get; set; } = "";
    public string ScopeType { get; set; } = "ALL";
    public string ScopeValue { get; set; } = "";
}

public sealed class UserCreateV08Request
{
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Password { get; set; } = "";
    public int[] RoleIds { get; set; } = [];
    public bool MustChangePassword { get; set; } = true;
}

public sealed class UserUpdateV08Request
{
    public string DisplayName { get; set; } = "";
    public int[] RoleIds { get; set; } = [];
    public bool IsEnabled { get; set; } = true;
    public int Revision { get; set; }
}
