using AdDeliverableManager.Security;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class PermissionService
{
    private readonly DatabaseService _database;
    public PermissionService(DatabaseService database)=>_database=database;

    public async Task<int?> ResolveDeliverableIdAsync(int id,CancellationToken ct=default){await using var c=await _database.OpenConnectionAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT Id FROM Deliverables WHERE Id=$id";cmd.Parameters.AddWithValue("$id",id);var value=await cmd.ExecuteScalarAsync(ct);return value is null?null:Convert.ToInt32(value);}
    public async Task<int?> ResolveDeliverableIdByVersionAsync(int versionId,CancellationToken ct=default){await using var c=await _database.OpenConnectionAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT DeliverableId FROM DeliverableVersions WHERE Id=$id";cmd.Parameters.AddWithValue("$id",versionId);var value=await cmd.ExecuteScalarAsync(ct);return value is null?null:Convert.ToInt32(value);}

    public async Task<IReadOnlyList<string>> GetEffectivePermissionsAsync(int userId,CancellationToken ct=default)
    {await using var c=await _database.OpenConnectionAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT DISTINCT p.Code FROM UserRoles ur JOIN Roles r ON r.Id=ur.RoleId JOIN RolePermissions rp ON rp.RoleId=r.Id JOIN Permissions p ON p.Id=rp.PermissionId WHERE ur.UserId=$id AND r.IsEnabled=1 AND p.IsEnabled=1 ORDER BY p.Code";cmd.Parameters.AddWithValue("$id",userId);var list=new List<string>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(r.GetString(0));return list;}
    public async Task<IReadOnlyList<string>> GetEffectiveRoleNamesAsync(int userId,CancellationToken ct=default)
    {await using var c=await _database.OpenConnectionAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT r.Name FROM UserRoles ur JOIN Roles r ON r.Id=ur.RoleId WHERE ur.UserId=$id AND r.IsEnabled=1 ORDER BY r.IsSystemRole DESC,r.Name";cmd.Parameters.AddWithValue("$id",userId);var list=new List<string>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(r.GetString(0));return list;}
    public async Task<bool> HasPermissionAsync(int userId,string permissionCode,string? workflowNode=null,int? deliverableId=null,CancellationToken ct=default)
    {
        await using var c=await _database.OpenConnectionAsync(ct);var roleIds=await GetRoleIdsAsync(c,userId,ct);if(roleIds.Count==0)return false;var csv=string.Join(',',roleIds);
        await using var p=c.CreateCommand();p.CommandText=$"SELECT COUNT(*) FROM RolePermissions rp JOIN Permissions p ON p.Id=rp.PermissionId WHERE rp.RoleId IN ({csv}) AND p.Code=$code AND p.IsEnabled=1";p.Parameters.AddWithValue("$code",permissionCode);if(Convert.ToInt32(await p.ExecuteScalarAsync(ct))==0)return false;
        if(workflowNode!=null){await using var n=c.CreateCommand();n.CommandText=$"SELECT COUNT(*) FROM RoleWorkflowNodes WHERE RoleId IN ({csv}) AND WorkflowNodeCode=$node";n.Parameters.AddWithValue("$node",workflowNode);if(Convert.ToInt32(await n.ExecuteScalarAsync(ct))==0)return false;}
        if(deliverableId.HasValue)return await MatchesDataScopeAsync(c,roleIds,deliverableId.Value,ct);return true;
    }
    public async Task<bool> HasCreateScopeAsync(int userId,string permissionCode,int departmentId,int projectId,int typeId,CancellationToken ct=default)
    {
        await using var c=await _database.OpenConnectionAsync(ct);var roles=await GetRoleIdsAsync(c,userId,ct);if(roles.Count==0)return false;
        foreach(var role in roles){await using var q=c.CreateCommand();q.CommandText="SELECT Dimension,ScopeType,ScopeValue FROM RoleDataScopes WHERE RoleId=$role";q.Parameters.AddWithValue("$role",role);var scopes=new List<(string d,string t,string v)>();await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))scopes.Add((r.GetString(0),r.GetString(1),r.GetString(2)));if(scopes.Count==0)return true;var dims=new Dictionary<string,string>{{"DEPARTMENT",departmentId.ToString()},{"PROJECT",projectId.ToString()},{"TYPE",typeId.ToString()}};var ok=true;foreach(var g in scopes.GroupBy(x=>x.d,StringComparer.OrdinalIgnoreCase)){if(g.Any(x=>x.t.Equals("ALL",StringComparison.OrdinalIgnoreCase)))continue;if(!g.Any(x=>x.t.Equals("INCLUDE",StringComparison.OrdinalIgnoreCase)&&dims.TryGetValue(g.Key,out var val)&&x.v.Equals(val,StringComparison.OrdinalIgnoreCase))){ok=false;break;}}if(ok)return true;}return false;
    }
    public async Task<IReadOnlyList<int>?> GetAllowedDeliverableIdsAsync(int userId,string permissionCode,CancellationToken ct=default)
    {await using var c=await _database.OpenConnectionAsync(ct);var roles=await GetRoleIdsAsync(c,userId,ct);if(roles.Count==0)return [];var csv=string.Join(',',roles);await using var s=c.CreateCommand();s.CommandText=$"SELECT COUNT(*) FROM RoleDataScopes WHERE RoleId IN ({csv})";if(Convert.ToInt32(await s.ExecuteScalarAsync(ct))==0)return null;var ids=new List<int>();await using var d=c.CreateCommand();d.CommandText="SELECT Id FROM Deliverables WHERE LifecycleStatus <> 'ARCHIVED'";await using var r=await d.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct)){var id=r.GetInt32(0);if(await HasPermissionAsync(userId,permissionCode,deliverableId:id,ct:ct))ids.Add(id);}return ids;}

    // SQL predicate used by aggregate/list queries that need to apply the same OR-by-role,
    // AND-by-dimension semantics as MatchesDataScopeAsync. The caller must bind $scopeUserId.
    public static string BuildDataScopePredicate(string deliverableAlias)
    {
        var a=string.IsNullOrWhiteSpace(deliverableAlias)?"d":deliverableAlias;
        return $@"EXISTS (
            SELECT 1
            FROM UserRoles ur
            JOIN Roles r ON r.Id=ur.RoleId AND r.IsEnabled=1
            WHERE ur.UserId=$scopeUserId
              AND (
                NOT EXISTS (SELECT 1 FROM RoleDataScopes s0 WHERE s0.RoleId=r.Id)
                OR (
                    (NOT EXISTS (SELECT 1 FROM RoleDataScopes s1 WHERE s1.RoleId=r.Id AND s1.Dimension='DEPARTMENT')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s1 WHERE s1.RoleId=r.Id AND s1.Dimension='DEPARTMENT' AND s1.ScopeType='ALL')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s1 WHERE s1.RoleId=r.Id AND s1.Dimension='DEPARTMENT' AND s1.ScopeType='INCLUDE' AND s1.ScopeValue=CAST({a}.DepartmentId AS TEXT)))
                    AND
                    (NOT EXISTS (SELECT 1 FROM RoleDataScopes s2 WHERE s2.RoleId=r.Id AND s2.Dimension='PROJECT')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s2 WHERE s2.RoleId=r.Id AND s2.Dimension='PROJECT' AND s2.ScopeType='ALL')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s2 WHERE s2.RoleId=r.Id AND s2.Dimension='PROJECT' AND s2.ScopeType='INCLUDE' AND s2.ScopeValue=CAST({a}.ProjectId AS TEXT)))
                    AND
                    (NOT EXISTS (SELECT 1 FROM RoleDataScopes s3 WHERE s3.RoleId=r.Id AND s3.Dimension='TYPE')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s3 WHERE s3.RoleId=r.Id AND s3.Dimension='TYPE' AND s3.ScopeType='ALL')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s3 WHERE s3.RoleId=r.Id AND s3.Dimension='TYPE' AND s3.ScopeType='INCLUDE' AND s3.ScopeValue=CAST({a}.DeliverableTypeId AS TEXT)))
                    AND
                    (NOT EXISTS (SELECT 1 FROM RoleDataScopes s4 WHERE s4.RoleId=r.Id AND s4.Dimension='OWNER')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s4 WHERE s4.RoleId=r.Id AND s4.Dimension='OWNER' AND s4.ScopeType='ALL')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s4 WHERE s4.RoleId=r.Id AND s4.Dimension='OWNER' AND s4.ScopeType='INCLUDE' AND s4.ScopeValue={a}.ResponsiblePerson))
                    AND
                    (NOT EXISTS (SELECT 1 FROM RoleDataScopes s5 WHERE s5.RoleId=r.Id AND s5.Dimension='HARDWARE_CATEGORY')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s5 WHERE s5.RoleId=r.Id AND s5.Dimension='HARDWARE_CATEGORY' AND s5.ScopeType='ALL')
                     OR EXISTS (SELECT 1 FROM RoleDataScopes s5 WHERE s5.RoleId=r.Id AND s5.Dimension='HARDWARE_CATEGORY' AND s5.ScopeType='INCLUDE' AND s5.ScopeValue=(SELECT h.HardwareCategory FROM DeliverableVersions vv LEFT JOIN HardwarePackageDetails h ON h.VersionId=vv.Id WHERE vv.Id={a}.CurrentVersionId)))
                )
              )
        )";
    }

    private static async Task<List<int>> GetRoleIdsAsync(SqliteConnection c,int userId,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.CommandText="SELECT RoleId FROM UserRoles ur JOIN Roles r ON r.Id=ur.RoleId WHERE ur.UserId=$id AND r.IsEnabled=1";cmd.Parameters.AddWithValue("$id",userId);var ids=new List<int>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))ids.Add(r.GetInt32(0));return ids;}
    private static async Task<bool> MatchesDataScopeAsync(SqliteConnection c,List<int> roleIds,int deliverableId,CancellationToken ct){var csv=string.Join(',',roleIds);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT d.DepartmentId,d.ProjectId,d.DeliverableTypeId,d.ResponsiblePerson,h.HardwareCategory FROM Deliverables d LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId LEFT JOIN HardwarePackageDetails h ON h.VersionId=v.Id WHERE d.Id=$id";cmd.Parameters.AddWithValue("$id",deliverableId);await using var r=await cmd.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))return false;var dims=new Dictionary<string,string>{{"DEPARTMENT",r.GetInt32(0).ToString()},{"PROJECT",r.GetInt32(1).ToString()},{"TYPE",r.GetInt32(2).ToString()},{"OWNER",r.GetString(3)},{"HARDWARE_CATEGORY",r.IsDBNull(4)?"":r.GetString(4)}};await r.DisposeAsync();foreach(var roleId in roleIds){await using var q=c.CreateCommand();q.CommandText="SELECT Dimension,ScopeType,ScopeValue FROM RoleDataScopes WHERE RoleId=$role";q.Parameters.AddWithValue("$role",roleId);var scopes=new List<(string d,string t,string v)>();await using var sr=await q.ExecuteReaderAsync(ct);while(await sr.ReadAsync(ct))scopes.Add((sr.GetString(0),sr.GetString(1),sr.GetString(2)));if(scopes.Count==0)return true;var ok=true;foreach(var g in scopes.GroupBy(x=>x.d,StringComparer.OrdinalIgnoreCase)){if(g.Any(x=>x.t.Equals("ALL",StringComparison.OrdinalIgnoreCase)))continue;if(!g.Any(x=>x.t.Equals("INCLUDE",StringComparison.OrdinalIgnoreCase)&&dims.TryGetValue(g.Key,out var value)&&!string.IsNullOrWhiteSpace(value)&&x.v.Equals(value,StringComparison.OrdinalIgnoreCase))){ok=false;break;}}if(ok)return true;}return false;}
}
public sealed class PermissionDeniedException:Exception{public string PermissionCode{get;}public PermissionDeniedException(string message,string permissionCode):base(message)=>PermissionCode=permissionCode;}
