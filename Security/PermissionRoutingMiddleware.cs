using AdDeliverableManager.Services;

namespace AdDeliverableManager.Security;

public sealed class PermissionRoutingMiddleware
{
    private readonly RequestDelegate _next;public PermissionRoutingMiddleware(RequestDelegate next)=>_next=next;
    public async Task InvokeAsync(HttpContext context)
    {
        var path=context.Request.Path.Value??"";if(!path.StartsWith("/internal",StringComparison.OrdinalIgnoreCase)){await _next(context);return;}
        if(path.StartsWith("/internal/auth/",StringComparison.OrdinalIgnoreCase)||path.Equals("/internal/system/health",StringComparison.OrdinalIgnoreCase)){await _next(context);return;}
        if(context.User.Identity?.IsAuthenticated!=true){context.Response.StatusCode=401;await context.Response.WriteAsJsonAsync(new{message="请先登录。"});return;}
        var rule=ResolveRule(context.Request.Method,path);if(rule is null){context.Response.StatusCode=403;await context.Response.WriteAsJsonAsync(new{message="该操作尚未配置权限策略，请联系管理员。"});return;}
        var service=context.RequestServices.GetRequiredService<PermissionService>();int? deliverableId=null;
        if(int.TryParse(GetSegmentAfter(path,"deliverables"),out var directId))deliverableId=await service.ResolveDeliverableIdAsync(directId,context.RequestAborted);
        if(!deliverableId.HasValue&&int.TryParse(GetSegmentAfter(path,"version-details"),out var detailId))deliverableId=await service.ResolveDeliverableIdByVersionAsync(detailId,context.RequestAborted);
        if(!deliverableId.HasValue){var idx=path.IndexOf("/versions/",StringComparison.OrdinalIgnoreCase);if(idx>=0){var text=path[(idx+10)..].Split('/')[0];if(int.TryParse(text,out var v))deliverableId=await service.ResolveDeliverableIdByVersionAsync(v,context.RequestAborted);}}
        if(!deliverableId.HasValue){var idx=path.IndexOf("/changes/",StringComparison.OrdinalIgnoreCase);if(idx>=0){var text=path[(idx+9)..].Split('/')[0];if(int.TryParse(text,out var change))deliverableId=await ResolveChangeDeliverableIdAsync(change,context.RequestServices,context.RequestAborted);}}
        if(!await service.HasPermissionAsync(context.User.GetUserId(),rule.Permission,rule.Node,deliverableId,context.RequestAborted)){context.Response.StatusCode=403;await context.Response.WriteAsJsonAsync(new{message=rule.Message??"当前账号没有执行该操作的权限。"});return;}
        await _next(context);
    }
    private sealed record Rule(string Permission,string? Node,string? Message);
    private static Rule? ResolveRule(string method,string path)
    {
        if(path.StartsWith("/internal/dashboard",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.DashboardView,null,"当前角色没有查看仪表盘的权限。");
        if(path.StartsWith("/internal/analytics",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.AnalyticsView,null,"当前角色没有查看完整度分析的权限。");
        if(path.StartsWith("/internal/users",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.UserManage,null,"当前角色没有用户管理权限。");
        if(path.StartsWith("/internal/roles",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.RoleManage,null,"当前角色没有角色管理权限。");
        if(path.StartsWith("/internal/product-baselines",StringComparison.OrdinalIgnoreCase))return ProductBaselineRule(method,path);
        if(path.StartsWith("/internal/system/backup",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.SystemBackup,null,"当前角色没有数据库备份权限。");
        if(path.StartsWith("/internal/system/audit-logs",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.AuditView,null,"当前角色没有查看审计日志的权限。");
        if(path.StartsWith("/internal/master-data",StringComparison.OrdinalIgnoreCase))return new(method=="GET"?PermissionCatalog.MasterDataView:PermissionCatalog.MasterDataEdit,null,"当前角色没有维护基础数据的权限。");
        if(path.StartsWith("/internal/exports/deliverables",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.DeliveryExport,null,"当前角色没有导出交付物台账的权限。");
        if(path.StartsWith("/internal/exports/changes",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.ChangeExport,null,"当前角色没有导出变更记录的权限。");
        if(path.StartsWith("/internal/exports/fields",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.DeliveryView,null,"当前角色没有查看导出字段的权限。");
        if(path.StartsWith("/internal/change-workflow",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.ChangeView,null,"当前角色没有查看变更流程数据的权限。");
        if(path.StartsWith("/internal/version-details",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.VersionViewSafe,null,"当前角色没有查看版本详情的权限。");
        if(path.StartsWith("/internal/relations",StringComparison.OrdinalIgnoreCase))return new(method=="GET"?PermissionCatalog.RelationView:PermissionCatalog.RelationEdit,null,"当前角色没有维护交付物关联关系的权限。");
        if(path.StartsWith("/internal/workflow/versions/",StringComparison.OrdinalIgnoreCase))return VersionActionRule(path.Split('/').LastOrDefault());
        if(path.StartsWith("/internal/workflow/changes/",StringComparison.OrdinalIgnoreCase))return ChangeActionRule(path.Split('/').LastOrDefault());
        if(path.StartsWith("/internal/versioning",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.VersionCreate,null,"当前角色没有创建版本的权限。");
        if(path.StartsWith("/internal/deliverables",StringComparison.OrdinalIgnoreCase))
        {if(method=="GET")return new(PermissionCatalog.DeliveryView,null,"当前角色没有查看交付物的权限。");if(method=="POST"&&path.Contains("/versions/",StringComparison.OrdinalIgnoreCase))return VersionActionRule(path.Split('/').LastOrDefault());if(method=="POST"&&path.Contains("/archive",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.DeliveryArchive,null,"当前角色没有归档交付物的权限。");if(method=="POST"&&path.Contains("/versions",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.VersionCreate,null,"当前角色没有创建版本的权限。");if(method=="POST")return new(PermissionCatalog.DeliveryCreate,null,"当前角色没有新增交付物的权限。");if(method=="PUT")return new(PermissionCatalog.DeliveryEdit,null,"当前角色没有编辑交付物的权限。");}
        if(path.StartsWith("/internal/changes",StringComparison.OrdinalIgnoreCase))
        {if(method=="GET")return new(PermissionCatalog.ChangeView,null,"当前角色没有查看变更的权限。");if(method=="POST"&&path.TrimEnd('/').Equals("/internal/changes",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.ChangeCreate,null,"当前角色没有发起变更的权限。");return ChangeActionRule(path.Split('/').LastOrDefault());}
        return null;
    }
    private static Rule ProductBaselineRule(string method,string path)
    {
        if(path.EndsWith("/options",StringComparison.OrdinalIgnoreCase)||method=="GET"&&path.TrimEnd('/').Equals("/internal/product-baselines",StringComparison.OrdinalIgnoreCase)||method=="GET")return new(PermissionCatalog.BaselineView,null,"当前角色没有查看产品基线的权限。");
        if(path.EndsWith("/publish",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.BaselinePublish,null,"当前角色没有发布产品基线的权限。");
        if(path.EndsWith("/copy",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.BaselineCopy,null,"当前角色没有复制已发布基线的权限。");
        if(path.EndsWith("/changes",StringComparison.OrdinalIgnoreCase))return new(PermissionCatalog.BaselineChange,null,"当前角色没有变更基线基础信息的权限。");
        return method=="POST"?new(PermissionCatalog.BaselineCreate,null,"当前角色没有新增产品基线的权限。"):new(PermissionCatalog.BaselineEdit,null,"当前角色没有编辑产品基线草稿的权限。");
    }
    private static Rule VersionActionRule(string? action)=>action?.ToLowerInvariant() switch{"submit-review"=>new(PermissionCatalog.VersionSubmit,"VERSION_APPROVAL","当前角色没有提交版本审批的权限。"),"return-draft"=>new(PermissionCatalog.VersionReturn,"VERSION_APPROVAL","当前角色没有退回版本的权限。"),"approve"=>new(PermissionCatalog.VersionApprove,"VERSION_APPROVAL","当前角色没有版本审批权限。"),"release"=>new(PermissionCatalog.VersionRelease,"VERSION_RELEASE","当前角色没有版本正式发布权限。"),"deprecate"=>new(PermissionCatalog.VersionDeprecate,"VERSION_DEPRECATE","当前角色没有版本废止权限。"),_=>new(PermissionCatalog.VersionViewSafe,null,"当前角色没有版本操作权限。")};
    private static Rule ChangeActionRule(string? action)=>action?.ToLowerInvariant() switch{"approve" or "reject"=>new(PermissionCatalog.ChangeApprove,"CHANGE_APPROVAL","当前角色没有变更批准/驳回权限。"),"start"=>new(PermissionCatalog.ChangeStart,"CHANGE_IMPLEMENT","当前角色没有开始实施变更的权限。"),"verify"=>new(PermissionCatalog.ChangeVerify,"CHANGE_VERIFY","当前角色没有提交变更验证的权限。"),"close"=>new(PermissionCatalog.ChangeClose,"CHANGE_CLOSE","当前角色没有关闭变更的权限。"),_=>new(PermissionCatalog.ChangeView,null,"当前角色没有变更操作权限。")};
    private static string? GetSegmentAfter(string path,string segment){var parts=path.Trim('/').Split('/');for(var i=0;i<parts.Length-1;i++)if(parts[i].Equals(segment,StringComparison.OrdinalIgnoreCase))return parts[i+1];return null;}
    private static async Task<int?> ResolveChangeDeliverableIdAsync(int changeId,IServiceProvider services,CancellationToken ct){var db=services.GetRequiredService<DatabaseService>();await using var c=await db.OpenConnectionAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT DeliverableId FROM ChangeRecords WHERE Id=$id";cmd.Parameters.AddWithValue("$id",changeId);var value=await cmd.ExecuteScalarAsync(ct);return value is null?null:Convert.ToInt32(value);}
}
