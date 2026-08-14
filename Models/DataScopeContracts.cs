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

    public static readonly IReadOnlyList<(string Code, string Name)> Dimensions =
    [
        (Department, "部门"),
        (Project, "项目"),
        (Type, "交付物类型"),
        (Owner, "负责人"),
        (HardwareCategory, "硬件类别")
    ];

    public static readonly IReadOnlyList<string> HardwareCategories =
    ["前视摄像头", "周视摄像头", "角雷达", "激光雷达", "毫米波雷达", "超声波雷达", "智驾域控制器"];

    public static bool IsDimension(string code) => Dimensions.Any(x => x.Code.Equals(code, StringComparison.OrdinalIgnoreCase));
    public static bool IsScopeType(string type) => type.Equals("ALL", StringComparison.OrdinalIgnoreCase) || type.Equals("INCLUDE", StringComparison.OrdinalIgnoreCase);
}
