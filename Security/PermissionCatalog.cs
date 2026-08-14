namespace AdDeliverableManager.Security;

public static class PermissionCatalog
{
    public const string DeliveryView="DELIVERY_VIEW";public const string DeliveryCreate="DELIVERY_CREATE";public const string DeliveryEdit="DELIVERY_EDIT";public const string DeliveryArchive="DELIVERY_ARCHIVE";public const string DeliveryExport="DELIVERY_EXPORT";
    public const string VersionViewSafe="VERSION_VIEW";public const string VersionCreate="VERSION_CREATE";public const string VersionSubmit="VERSION_SUBMIT";public const string VersionReturn="VERSION_RETURN";public const string VersionApprove="VERSION_APPROVE";public const string VersionRelease="VERSION_RELEASE";public const string VersionDeprecate="VERSION_DEPRECATE";
    public const string ChangeView="CHANGE_VIEW";public const string ChangeCreate="CHANGE_CREATE";public const string ChangeEdit="CHANGE_EDIT";public const string ChangeExport="CHANGE_EXPORT";public const string ChangeApprove="CHANGE_APPROVE";public const string ChangeStart="CHANGE_START";public const string ChangeVerify="CHANGE_VERIFY";public const string ChangeClose="CHANGE_CLOSE";
    public const string RelationView="RELATION_VIEW";public const string RelationEdit="RELATION_EDIT";public const string DashboardView="DASHBOARD_VIEW";public const string AnalyticsView="ANALYTICS_VIEW";public const string MasterDataView="MASTERDATA_VIEW";public const string MasterDataEdit="MASTERDATA_EDIT";public const string UserManage="USER_MANAGE";public const string RoleManage="ROLE_MANAGE";public const string SystemBackup="SYSTEM_BACKUP";public const string AuditView="AUDIT_VIEW";
    public const string BaselineView="BASELINE_VIEW";public const string BaselineCreate="BASELINE_CREATE";public const string BaselineEdit="BASELINE_EDIT";public const string BaselinePublish="BASELINE_PUBLISH";public const string BaselineCopy="BASELINE_COPY";public const string BaselineChange="BASELINE_CHANGE";
    public static readonly IReadOnlyList<(string Code,string Name,string Category)> All=[
        (DeliveryView,"查看交付物","交付物台账"),(DeliveryCreate,"新增交付物","交付物台账"),(DeliveryEdit,"编辑交付物","交付物台账"),(DeliveryArchive,"归档交付物","交付物台账"),(DeliveryExport,"导出交付物","交付物台账"),
        (VersionViewSafe,"查看版本","版本管理"),(VersionCreate,"创建版本","版本管理"),(VersionSubmit,"提交审批","版本管理"),(VersionReturn,"退回修改","版本管理"),(VersionApprove,"审批通过","版本管理"),(VersionRelease,"正式发布","版本管理"),(VersionDeprecate,"废止版本","版本管理"),
        (ChangeView,"查看变更","变更管理"),(ChangeCreate,"发起变更","变更管理"),(ChangeEdit,"编辑变更","变更管理"),(ChangeExport,"导出变更","变更管理"),(ChangeApprove,"批准/驳回变更","变更管理"),(ChangeStart,"开始实施","变更管理"),(ChangeVerify,"提交验证","变更管理"),(ChangeClose,"关闭变更","变更管理"),
        (RelationView,"查看关联关系","交付物关联"),(RelationEdit,"维护关联关系","交付物关联"),(DashboardView,"查看仪表盘","统计分析"),(AnalyticsView,"查看完整度分析","统计分析"),(MasterDataView,"查看基础数据","基础设置"),(MasterDataEdit,"维护基础数据","基础设置"),(UserManage,"用户管理","系统管理"),(RoleManage,"角色管理","系统管理"),(SystemBackup,"数据备份","系统管理"),(AuditView,"审计日志","系统管理"),
        (BaselineView,"查看产品基线","产品版本基线"),(BaselineCreate,"新增产品基线","产品版本基线"),(BaselineEdit,"编辑基线草稿","产品版本基线"),(BaselinePublish,"发布产品基线","产品版本基线"),(BaselineCopy,"复制已发布基线","产品版本基线"),(BaselineChange,"变更基线基础信息","产品版本基线")
    ];
    public static readonly IReadOnlyList<(string Code,string Name)> WorkflowNodes=[("VERSION_APPROVAL","版本内容审批"),("VERSION_RELEASE","版本正式发布"),("VERSION_DEPRECATE","版本废止"),("CHANGE_APPROVAL","变更批准/驳回"),("CHANGE_IMPLEMENT","变更实施"),("CHANGE_VERIFY","变更验证"),("CHANGE_CLOSE","变更关闭")];
}
