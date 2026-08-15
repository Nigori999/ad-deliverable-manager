namespace AdDeliverableManager.Services;

public static class HardwareCategoryCatalog
{
    public static readonly IReadOnlyList<string> All = new[]
    {
        "前视摄像头",
        "周视摄像头",
        "角雷达",
        "激光雷达",
        "毫米波雷达",
        "超声波雷达",
        "智驾域控制器"
    };

    public static bool Contains(string? value) => !string.IsNullOrWhiteSpace(value)
        && All.Contains(value.Trim(), StringComparer.OrdinalIgnoreCase);
}
