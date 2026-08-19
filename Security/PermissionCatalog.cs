namespace AdDeliverableManager.Security;

public static class PermissionCatalog
{
    public const string DeliveryView = "DELIVERY_VIEW";
    public const string DeliveryCreate = "DELIVERY_CREATE";
    public const string DeliveryEdit = "DELIVERY_EDIT";
    public const string DeliveryDelete = "DELIVERY_DELETE";
    public const string DeliveryArchive = "DELIVERY_ARCHIVE";
    public const string DeliveryExport = "DELIVERY_EXPORT";

    public const string VersionView = "VERSION_VIEW";
    public const string VersionCreate = "VERSION_CREATE";
    public const string VersionEdit = "VERSION_EDIT";
    public const string VersionDelete = "VERSION_DELETE";
    public const string VersionSupplement = "VERSION_SUPPLEMENT";
    public const string VersionSubmit = "VERSION_SUBMIT";
    public const string VersionReturn = "VERSION_RETURN";
    public const string VersionApprove = "VERSION_APPROVE";
    public const string VersionRelease = "VERSION_RELEASE";
    public const string VersionDeprecate = "VERSION_DEPRECATE";

    public const string RelationView = "RELATION_VIEW";
    public const string RelationCreate = "RELATION_CREATE";
    public const string RelationEdit = "RELATION_EDIT";
    public const string RelationDelete = "RELATION_DELETE";

    public const string ChangeView = "CHANGE_VIEW";
    public const string ChangeCreate = "CHANGE_CREATE";
    public const string ChangeDraftEdit = "CHANGE_DRAFT_EDIT";
    public const string ChangeDelete = "CHANGE_DELETE";
    public const string ChangeExport = "CHANGE_EXPORT";
    public const string ChangeApprove = "CHANGE_APPROVE";
    public const string ChangeReject = "CHANGE_REJECT";
    public const string ChangeStart = "CHANGE_START";
    public const string ChangeEdit = "CHANGE_EDIT";
    public const string ChangeVerify = "CHANGE_VERIFY";
    public const string ChangeClose = "CHANGE_CLOSE";

    public const string BaselineView = "BASELINE_VIEW";
    public const string BaselineCreate = "BASELINE_CREATE";
    public const string BaselineEdit = "BASELINE_EDIT";
    public const string BaselineDelete = "BASELINE_DELETE";
    public const string BaselinePublish = "BASELINE_PUBLISH";
    public const string BaselineCopy = "BASELINE_COPY";
    public const string BaselineChange = "BASELINE_CHANGE";

    public const string DashboardView = "DASHBOARD_VIEW";
    public const string AnalyticsView = "ANALYTICS_VIEW";
    public const string MasterDataView = "MASTERDATA_VIEW";
    public const string MasterDataCreate = "MASTERDATA_CREATE";
    public const string MasterDataEdit = "MASTERDATA_EDIT";
    public const string MasterDataDelete = "MASTERDATA_DELETE";
    public const string UserView = "USER_VIEW";
    public const string UserCreate = "USER_CREATE";
    public const string UserEdit = "USER_EDIT";
    public const string UserDelete = "USER_DELETE";
    public const string UserResetPassword = "USER_RESET_PASSWORD";
    public const string RoleView = "ROLE_VIEW";
    public const string RoleCreate = "ROLE_CREATE";
    public const string RoleEdit = "ROLE_EDIT";
    public const string RolePermissionEdit = "ROLE_PERMISSION_EDIT";
    public const string RoleDelete = "ROLE_DELETE";
    public const string SystemBackup = "SYSTEM_BACKUP";
    public const string AuditView = "AUDIT_VIEW";

    public static readonly IReadOnlyList<(string Code, string Name, string Category)> All =
    [
        (DeliveryView, "查看交付物", "交付物台账"),
        (DeliveryCreate, "新增交付物", "交付物台账"),
        (DeliveryEdit, "编辑草稿交付物", "交付物台账"),
        (DeliveryDelete, "删除交付物", "交付物台账"),
        (DeliveryArchive, "归档交付物", "交付物台账"),
        (DeliveryExport, "导出交付物", "交付物台账"),
        (VersionView, "查看版本", "交付物台账"),
        (VersionCreate, "新增版本", "交付物台账"),
        (VersionEdit, "编辑草稿版本", "交付物台账"),
        (VersionDelete, "删除草稿/已作废版本", "交付物台账"),
        (VersionSupplement, "补录版本", "交付物台账"),
        (VersionSubmit, "提交版本审批", "交付物台账"),
        (VersionReturn, "退回版本修改", "交付物台账"),
        (VersionApprove, "版本审批通过", "交付物台账"),
        (VersionRelease, "版本正式发布", "交付物台账"),
        (VersionDeprecate, "废止版本", "交付物台账"),
        (RelationView, "查看关联关系", "交付物台账"),
        (RelationCreate, "建立关联关系", "交付物台账"),
        (RelationEdit, "编辑关联关系", "交付物台账"),
        (RelationDelete, "删除关联关系", "交付物台账"),
        (BaselineView, "查看产品基线", "产品基线"),
        (BaselineCreate, "新增产品基线", "产品基线"),
        (BaselineEdit, "编辑产品基线草稿", "产品基线"),
        (BaselineDelete, "删除产品基线草稿", "产品基线"),
        (BaselinePublish, "发布产品基线", "产品基线"),
        (BaselineCopy, "复制产品基线", "产品基线"),
        (BaselineChange, "变更产品基线", "产品基线"),
        (ChangeView, "查看变更", "变更管理"),
        (ChangeCreate, "发起变更", "变更管理"),
        (ChangeDraftEdit, "编辑待评估变更", "变更管理"),
        (ChangeDelete, "删除待评估变更", "变更管理"),
        (ChangeExport, "导出变更", "变更管理"),
        (ChangeApprove, "批准变更", "变更管理"),
        (ChangeReject, "驳回变更", "变更管理"),
        (ChangeStart, "开始实施变更", "变更管理"),
        (ChangeEdit, "创建变更版本", "变更管理"),
        (ChangeVerify, "提交变更验证", "变更管理"),
        (ChangeClose, "关闭变更", "变更管理"),
        (DashboardView, "查看仪表盘", "概览分析"),
        (AnalyticsView, "查看完整度分析", "概览分析"),
        (MasterDataView, "查看基础数据", "系统管理"),
        (MasterDataCreate, "新增基础数据", "系统管理"),
        (MasterDataEdit, "编辑基础数据", "系统管理"),
        (MasterDataDelete, "删除基础数据", "系统管理"),
        (UserView, "查看用户", "系统管理"),
        (UserCreate, "新增用户", "系统管理"),
        (UserEdit, "编辑用户", "系统管理"),
        (UserDelete, "删除用户", "系统管理"),
        (UserResetPassword, "重置用户密码", "系统管理"),
        (RoleView, "查看角色", "系统管理"),
        (RoleCreate, "新增角色", "系统管理"),
        (RoleEdit, "编辑角色", "系统管理"),
        (RolePermissionEdit, "配置角色权限", "系统管理"),
        (RoleDelete, "删除角色", "系统管理"),
        (SystemBackup, "数据库备份", "系统管理"),
        (AuditView, "查看审计日志", "系统管理")
    ];
}
