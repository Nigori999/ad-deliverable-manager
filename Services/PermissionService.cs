using AdDeliverableManager.Security;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class PermissionService
{
    private readonly DatabaseService _database;
    public PermissionService(DatabaseService database) => _database = database;

    public async Task<bool> HasPermissionAsync(int userId,string permissionCode,string? workflowNode=null,int? deliverableId=null,CancellationToken cancellationToken=default)
    {
        await using var c=await _database.OpenConnectionAsync(cancellationToken);
        var roleIds=await GetRoleIdsAsync(c,userId,cancellationToken); if(roleIds.Count==0)return false;
        var roleCsv=string.Join(',',roleIds);
        await using var permission=c.CreateCommand();permission.CommandText=$"SELECT COUNT(*) FROM RolePermissions rp JOIN Permissions p ON p.Id=rp.PermissionId WHERE rp.RoleId IN ({roleCsv}) AND p.Code=$code AND p.IsEnabled=1";permission.Parameters.AddWithValue("$code",permissionCode);
        if(Convert.ToInt32(await permission.ExecuteScalarAsync(cancellationToken))==0)return false;
        if(workflowNode!=null){await using var node=c.CreateCommand();node.CommandText=$"SELECT COUNT(*) FROM RoleWorkflowNodes WHERE RoleId IN ({roleCsv}) AND WorkflowNodeCode=$node";node.Parameters.AddWithValue("$node",workflowNode);if(Convert.ToInt32(await node.ExecuteScalarAsync(cancellationToken))==0)return false;}
        if(deliverableId.HasValue) return await MatchesDataScopeAsync(c,roleIds,deliverableId.Value,cancellationToken);
        return true;
    }

    public async Task EnsureAsync(int userId,string permissionCode,string? workflowNode=null,int? deliverableId=null,CancellationToken cancellationToken=default)
    { if(!await HasPermissionAsync(userId,permissionCode,workflowNode,deliverableId,cancellationToken))throw new PermissionDeniedException("当前账号没有执行该操作的权限。",permissionCode); }

    public async Task<IReadOnlyList<int>?> GetAllowedDeliverableIdsAsync(int userId,string permissionCode,CancellationToken cancellationToken=default)
    {
        await using var c=await _database.OpenConnectionAsync(cancellationToken);var roles=await GetRoleIdsAsync(c,userId,cancellationToken);if(roles.Count==0)return [];
        var csv=string.Join(',',roles);
        await using var all=c.CreateCommand();all.CommandText=$"SELECT COUNT(*) FROM RoleDataScopes WHERE RoleId IN ({csv})";var scopeCount=Convert.ToInt32(await all.ExecuteScalarAsync(cancellationToken));if(scopeCount==0)return null;
        var ids=new List<int>();
        await using var d=c.CreateCommand();d.CommandText="SELECT Id FROM Deliverables WHERE LifecycleStatus <> 'ARCHIVED'";
        await using var r=await d.ExecuteReaderAsync(cancellationToken);while(await r.ReadAsync(cancellationToken)){var id=r.GetInt32(0);if(await HasPermissionAsync(userId,permissionCode,deliverableId:id,cancellationToken:cancellationToken))ids.Add(id);}return ids;
    }

    private static async Task<List<int>> GetRoleIdsAsync(SqliteConnection c,int userId,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.CommandText="SELECT RoleId FROM UserRoles ur JOIN Roles r ON r.Id=ur.RoleId WHERE ur.UserId=$id AND r.IsEnabled=1";cmd.Parameters.AddWithValue("$id",userId);var ids=new List<int>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))ids.Add(r.GetInt32(0));return ids;}

    private static async Task<bool> MatchesDataScopeAsync(SqliteConnection c,List<int> roleIds,int deliverableId,CancellationToken ct)
    {
        var csv=string.Join(',',roleIds);
        await using var cmd=c.CreateCommand();cmd.CommandText=$"""
            SELECT d.DepartmentId,d.ProjectId,d.DeliverableTypeId,d.ResponsiblePerson,h.HardwareCategory
            FROM Deliverables d
            LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId
            LEFT JOIN HardwarePackageDetails h ON h.VersionId=v.Id
            WHERE d.Id=$id;""";cmd.Parameters.AddWithValue("$id",deliverableId);
        await using var r=await cmd.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))return false;var department=r.GetInt32(0).ToString();var project=r.GetInt32(1).ToString();var type=r.GetInt32(2).ToString();var owner=r.GetString(3);var hardware=r.IsDBNull(4)?"":r.GetString(4);await r.DisposeAsync();
        var dimensions=new Dictionary<string,string>{{"DEPARTMENT",department},{"PROJECT",project},{"TYPE",type},{"OWNER",owner},{"HARDWARE_CATEGORY",hardware}};
        foreach(var roleId in roleIds){await using var q=c.CreateCommand();q.CommandText="SELECT Dimension,ScopeType,ScopeValue FROM RoleDataScopes WHERE RoleId=$role";q.Parameters.AddWithValue("$role",roleId);var scopes=new List<(string d,string t,string v)>();await using var sr=await q.ExecuteReaderAsync(ct);while(await sr.ReadAsync(ct))scopes.Add((sr.GetString(0),sr.GetString(1),sr.GetString(2)));var grouped=scopes.GroupBy(x=>x.d,StringComparer.OrdinalIgnoreCase);var ok=true;foreach(var g in grouped){var val=dimensions.TryGetValue(g.Key,out var current)?current:"";if(g.Any(s=>s.t.Equals("ALL",StringComparison.OrdinalIgnoreCase)))continue;if(!g.Any(s=>s.t.Equals("INCLUDE",StringComparison.OrdinalIgnoreCase)&&s.v.Equals(current,StringComparison.OrdinalIgnoreCase)&&!string.IsNullOrWhiteSpace(current))){ok=false;break;}}if(ok)return true;}
        return false;
    }
}

public sealed class PermissionDeniedException : Exception
{
    public string PermissionCode { get; }
    public PermissionDeniedException(string message,string permissionCode):base(message)=>PermissionCode=permissionCode;
}
