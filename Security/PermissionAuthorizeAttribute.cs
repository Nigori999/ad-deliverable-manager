using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using AdDeliverableManager.Services;

namespace AdDeliverableManager.Security;

[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true, Inherited = true)]
public sealed class PermissionAuthorizeAttribute : Attribute, IAsyncAuthorizationFilter
{
    private readonly string _permission;
    private readonly string? _workflowNode;
    public PermissionAuthorizeAttribute(string permission,string? workflowNode=null){_permission=permission;_workflowNode=workflowNode;}
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        if(context.HttpContext.User.Identity?.IsAuthenticated!=true){context.Result=new UnauthorizedResult();return;}
        var userId=context.HttpContext.User.GetUserId();var service=context.HttpContext.RequestServices.GetRequiredService<PermissionService>();int? deliverableId=null;
        if(context.RouteData.Values.TryGetValue("deliverableId",out var dv)&&int.TryParse(dv?.ToString(),out var dId))deliverableId=dId;
        else if(context.RouteData.Values.TryGetValue("versionId",out var vv)&&int.TryParse(vv?.ToString(),out var versionId))deliverableId=await service.ResolveDeliverableIdByVersionAsync(versionId,context.HttpContext.RequestAborted);
        else if(context.RouteData.Values.TryGetValue("id",out var idv)&&int.TryParse(idv?.ToString(),out var id))deliverableId=await service.ResolveDeliverableIdAsync(id,context.HttpContext.RequestAborted);
        if(!await service.HasPermissionAsync(userId,_permission,_workflowNode,deliverableId,context.HttpContext.RequestAborted))context.Result=new ForbidResult();
    }
}
