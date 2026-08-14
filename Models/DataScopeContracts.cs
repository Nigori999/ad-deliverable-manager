namespace AdDeliverableManager.Models;

public sealed record DataScopeOption(string Value, string Name);

public sealed record DataScopeDimensionDefinition(
    string Code,
    string Name,
    string ScopeType,
    IReadOnlyList<DataScopeOption> Options);

public static class DataScopeCatalog
{
    public const string Department = "DEPARTMENT";
    public const string Project = "PROJECT";
    public const string Type = "TYPE";
    public const string Owner = "OWNER";
    public const string HardwareCategory = "HARDWARE_CATEGORY";

    public const string All = "ALL";
    public const string Include = "INCLUDE";

    public static readonly IReadOnlyList<(string Code, string Name)> Dimensions =
    [
        (Department, "部门"),
        (Project, "项目"),
        (Type, "交付物类型"),
        (Owner, "负责人"),
        (HardwareCategory, "硬件类别")
    ];

    public static bool IsDimension(string? code) =>
        !string.IsNullOrWhiteSpace(code) &&
        Dimensions.Any(x => x.Code.Equals(code, StringComparison.OrdinalIgnoreCase));

    public static bool IsScopeType(string? scopeType) =>
        All.Equals(scopeType, StringComparison.OrdinalIgnoreCase) ||
        Include.Equals(scopeType, StringComparison.OrdinalIgnoreCase);
}
