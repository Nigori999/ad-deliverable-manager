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
        if (context.HttpContext.User.Identity?.IsAuthenticated != true) { context.Result = new UnauthorizedResult(); return; }
        var userId = context.HttpContext.User.GetUserId();
        var service = context.HttpContext.RequestServices.GetRequiredService<PermissionService>();
        int? deliverableId = null;
        if (context.RouteData.Values.TryGetValue("id", out var idValue) && int.TryParse(idValue?.ToString(), out var id)) deliverableId=id;
        if (context.RouteData.Values.TryGetValue("deliverableId", out var deliverableValue) && int.TryParse(deliverableValue?.ToString(), out var deliverable)) deliverableId=deliverable;
        if (!await service.HasPermissionAsync(userId,_permission,_workflowNode,deliverableId,context.HttpContext.RequestAborted))
            context.Result = new ForbidResult();
    }
}
