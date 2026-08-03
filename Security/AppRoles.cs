namespace AdDeliverableManager.Security;

public static class AppRoles
{
    public const string Admin = "ADMIN";
    public const string Editor = "EDITOR";
    public const string Approver = "APPROVER";
    public const string Viewer = "VIEWER";

    public static readonly string[] All = [Admin, Editor, Approver, Viewer];

    public static string DisplayName(string roleCode) => roleCode switch
    {
        Admin => "管理员",
        Editor => "编辑者",
        Approver => "审批者",
        Viewer => "查看者",
        _ => roleCode
    };
}
