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
        foreach(var role in roles){await using var q=c.CreateCommand();q.CommandText="SELECT Dimension,ScopeType,ScopeValue FROM RoleDataScopes WHERE RoleId=$role";q.Parameters.AddWithValue("$role",role);var scopes=new List<(string d,string t,string v)>();await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))scopes.Add((r.GetString(0),r.GetString(1),r.GetString(2)));if(scopes.Count==0)continue;var dims=new Dictionary<string,string>{{"DEPARTMENT",departmentId.ToString()},{"PROJECT",projectId.ToString()},{"TYPE",typeId.ToString()}};var ok=true;foreach(var g in scopes.GroupBy(x=>x.d,StringComparer.OrdinalIgnoreCase)){if(g.Any(x=>x.t.Equals("ALL",StringComparison.OrdinalIgnoreCase)))continue;if(!g.Any(x=>x.t.Equals("INCLUDE",StringComparison.OrdinalIgnoreCase)&&dims.TryGetValue(g.Key,out var val)&&x.v.Equals(val,StringComparison.OrdinalIgnoreCase))){ok=false;break;}}if(ok)return true;}return false;
    }
    public async Task<IReadOnlyList<int>> GetAllowedDeliverableIdsAsync(int userId,string permissionCode,CancellationToken ct=default)
    {await using var c=await _database.OpenConnectionAsync(ct);var roles=await GetRoleIdsAsync(c,userId,ct);if(roles.Count==0)return [];var csv=string.Join(',',roles);await using var s=c.CreateCommand();s.CommandText=$"SELECT COUNT(*) FROM RoleDataScopes WHERE RoleId IN ({csv})";if(Convert.ToInt32(await s.ExecuteScalarAsync(ct))==0)return [];var ids=new List<int>();await using var d=c.CreateCommand();d.CommandText="SELECT Id FROM Deliverables WHERE LifecycleStatus <> 'ARCHIVED'";await using var r=await d.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct)){var id=r.GetInt32(0);if(await HasPermissionAsync(userId,permissionCode,deliverableId:id,ct:ct))ids.Add(id);}return ids;}

    // SQL predicate for collection queries. It implements the same rule as MatchesDataScopeAsync:
    // a user may access a deliverable when at least one enabled role has explicit scopes, and every
    // dimension configured on that role is satisfied by ALL or a matching INCLUDE value.
    // The caller must add parameter $scopeUserId with the current user id.
    public static string BuildDataScopePredicate(string deliverableAlias="d") => $"""
        EXISTS (
            SELECT 1
            FROM UserRoles ur
            JOIN Roles role ON role.Id=ur.RoleId
            WHERE ur.UserId=$scopeUserId AND role.IsEnabled=1
              AND EXISTS (SELECT 1 FROM RoleDataScopes rs0 WHERE rs0.RoleId=role.Id)
              AND NOT EXISTS (
                  SELECT 1
                  FROM RoleDataScopes dim
                  WHERE dim.RoleId=role.Id
                    AND NOT EXISTS (
                        SELECT 1
                        FROM RoleDataScopes match
                        WHERE match.RoleId=role.Id
                          AND match.Dimension=dim.Dimension
                          AND (
                              UPPER(match.ScopeType)='ALL'
                              OR (UPPER(match.ScopeType)='INCLUDE' AND match.ScopeValue=CASE UPPER(dim.Dimension)
                                  WHEN 'DEPARTMENT' THEN CAST({deliverableAlias}.DepartmentId AS TEXT)
                                  WHEN 'PROJECT' THEN CAST({deliverableAlias}.ProjectId AS TEXT)
                                  WHEN 'TYPE' THEN CAST({deliverableAlias}.DeliverableTypeId AS TEXT)
                                  WHEN 'OWNER' THEN {deliverableAlias}.ResponsiblePerson
                                  WHEN 'HARDWARE_CATEGORY' THEN COALESCE((SELECT h.HardwareCategory FROM DeliverableVersions hv LEFT JOIN HardwarePackageDetails h ON h.VersionId=hv.Id WHERE hv.Id={deliverableAlias}.CurrentVersionId),'')
                                  ELSE '' END)
                          )
                    )
              )
        )
        """;

    private static async Task<List<int>> GetRoleIdsAsync(SqliteConnection c,int userId,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.CommandText="SELECT RoleId FROM UserRoles ur JOIN Roles r ON r.Id=ur.RoleId WHERE ur.UserId=$id AND r.IsEnabled=1";cmd.Parameters.AddWithValue("$id",userId);var ids=new List<int>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))ids.Add(r.GetInt32(0));return ids;}
    private static async Task<bool> MatchesDataScopeAsync(SqliteConnection c,List<int> roleIds,int deliverableId,CancellationToken ct){var csv=string.Join(',',roleIds);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT d.DepartmentId,d.ProjectId,d.DeliverableTypeId,d.ResponsiblePerson,h.HardwareCategory FROM Deliverables d LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId LEFT JOIN HardwarePackageDetails h ON h.VersionId=v.Id WHERE d.Id=$id";cmd.Parameters.AddWithValue("$id",deliverableId);await using var r=await cmd.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))return false;var dims=new Dictionary<string,string>{{"DEPARTMENT",r.GetInt32(0).ToString()},{"PROJECT",r.GetInt32(1).ToString()},{"TYPE",r.GetInt32(2).ToString()},{"OWNER",r.GetString(3)},{"HARDWARE_CATEGORY",r.IsDBNull(4)?"":r.GetString(4)}};await r.DisposeAsync();foreach(var roleId in roleIds){await using var q=c.CreateCommand();q.CommandText="SELECT Dimension,ScopeType,ScopeValue FROM RoleDataScopes WHERE RoleId=$role";q.Parameters.AddWithValue("$role",roleId);var scopes=new List<(string d,string t,string v)>();await using var sr=await q.ExecuteReaderAsync(ct);while(await sr.ReadAsync(ct))scopes.Add((sr.GetString(0),sr.GetString(1),sr.GetString(2)));if(scopes.Count==0)continue;var ok=true;foreach(var g in scopes.GroupBy(x=>x.d,StringComparer.OrdinalIgnoreCase)){if(g.Any(x=>x.t.Equals("ALL",StringComparison.OrdinalIgnoreCase)))continue;if(!g.Any(x=>x.t.Equals("INCLUDE",StringComparison.OrdinalIgnoreCase)&&dims.TryGetValue(g.Key,out var value)&&!string.IsNullOrWhiteSpace(value)&&x.v.Equals(value,StringComparison.OrdinalIgnoreCase))){ok=false;break;}}if(ok)return true;}return false;}
}
public sealed class PermissionDeniedException:Exception{public string PermissionCode{get;}public PermissionDeniedException(string message,string permissionCode):base(message)=>PermissionCode=permissionCode;}
