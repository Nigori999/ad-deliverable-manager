using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class PermissionRepository
{
    private readonly DatabaseService _database;
    public PermissionRepository(DatabaseService database) => _database = database;

    public async Task<IReadOnlyList<object>> ListRolesAsync(CancellationToken cancellationToken = default)
    {
        await using var c = await _database.OpenConnectionAsync(cancellationToken);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT r.Id,r.Code,r.Name,r.Description,r.IsEnabled,r.IsSystemRole,r.CreatedBy,r.CreatedAt,r.UpdatedAt,r.Revision,(SELECT COUNT(*) FROM UserRoles ur WHERE ur.RoleId=r.Id) FROM Roles r ORDER BY r.IsSystemRole DESC,r.Name";
        var rows = new List<object>();
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) rows.Add(new { id=reader.GetInt32(0),code=reader.GetString(1),name=reader.GetString(2),description=reader.IsDBNull(3)?null:reader.GetString(3),isEnabled=reader.GetInt32(4)==1,isSystemRole=reader.GetInt32(5)==1,createdBy=reader.GetString(6),createdAt=reader.GetString(7),updatedAt=reader.GetString(8),revision=reader.GetInt32(9),userCount=reader.GetInt32(10) });
        return rows;
    }

    public async Task<object?> GetRoleAsync(int id, CancellationToken cancellationToken = default)
    {
        await using var c = await _database.OpenConnectionAsync(cancellationToken);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT Id,Code,Name,Description,IsEnabled,IsSystemRole,Revision FROM Roles WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", id);
        await using var r = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await r.ReadAsync(cancellationToken)) return null;
        var role = new { id=r.GetInt32(0),code=r.GetString(1),name=r.GetString(2),description=r.IsDBNull(3)?null:r.GetString(3),isEnabled=r.GetInt32(4)==1,isSystemRole=r.GetInt32(5)==1,revision=r.GetInt32(6) };
        await r.DisposeAsync();
        return new { role, permissions=await GetStringsAsync(cancellationToken,"SELECT p.Code FROM RolePermissions rp JOIN Permissions p ON p.Id=rp.PermissionId WHERE rp.RoleId=$id ORDER BY p.Category,p.Name",id), workflowNodes=await GetStringsAsync(cancellationToken,"SELECT WorkflowNodeCode FROM RoleWorkflowNodes WHERE RoleId=$id ORDER BY WorkflowNodeCode",id), dataScopes=await GetScopesAsync(id,cancellationToken) };
    }

    public async Task<int> CreateRoleAsync(RoleCreateRequest request,string operatorName,CancellationToken cancellationToken=default)
    {
        ValidateRole(request);
        await using var c=await _database.OpenConnectionAsync(cancellationToken); using var tx=c.BeginTransaction();
        await using var cmd=c.CreateCommand(); cmd.Transaction=tx;
        cmd.CommandText="INSERT INTO Roles(Code,Name,Description,IsEnabled,IsSystemRole,CreatedBy,CreatedAt,UpdatedAt,Revision) VALUES($code,$name,$desc,$enabled,0,$by,$now,$now,1); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$code",NormalizeCode(request.Code));cmd.Parameters.AddWithValue("$name",request.Name.Trim());cmd.Parameters.AddWithValue("$desc",request.Description);cmd.Parameters.AddWithValue("$enabled",request.IsEnabled?1:0);cmd.Parameters.AddWithValue("$by",operatorName);cmd.Parameters.AddWithValue("$now",DateTime.UtcNow.ToString("O"));
        try { var id=Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken)); await tx.CommitAsync(cancellationToken); return id; } catch(SqliteException ex) when(ex.SqliteErrorCode==19){throw new InvalidOperationException("角色编码或名称已存在。");}
    }

    public async Task<bool> UpdateRoleAsync(int id,RoleUpdateRequest request,string operatorName,CancellationToken cancellationToken=default)
    {
        ValidateRole(request); await using var c=await _database.OpenConnectionAsync(cancellationToken); using var tx=c.BeginTransaction();
        await using var cmd=c.CreateCommand(); cmd.Transaction=tx; cmd.CommandText="UPDATE Roles SET Name=$name,Description=$desc,IsEnabled=$enabled,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND Revision=$revision AND IsSystemRole=0";
        cmd.Parameters.AddWithValue("$name",request.Name.Trim());cmd.Parameters.AddWithValue("$desc",request.Description);cmd.Parameters.AddWithValue("$enabled",request.IsEnabled?1:0);cmd.Parameters.AddWithValue("$now",DateTime.UtcNow.ToString("O"));cmd.Parameters.AddWithValue("$id",id);cmd.Parameters.AddWithValue("$revision",request.Revision);
        var affected=await cmd.ExecuteNonQueryAsync(cancellationToken); if(affected==0)return false; await tx.CommitAsync(cancellationToken); return true;
    }

    public async Task DeleteRoleAsync(int id,string operatorName,CancellationToken cancellationToken=default)
    {
        await using var c=await _database.OpenConnectionAsync(cancellationToken); using var tx=c.BeginTransaction();
        await using var check=c.CreateCommand();check.Transaction=tx;check.CommandText="SELECT IsSystemRole, (SELECT COUNT(*) FROM UserRoles WHERE RoleId=$id) FROM Roles WHERE Id=$id";check.Parameters.AddWithValue("$id",id);
        await using var r=await check.ExecuteReaderAsync(cancellationToken); if(!await r.ReadAsync(cancellationToken))throw new KeyNotFoundException("角色不存在。"); var sys=r.GetInt32(0)==1; var users=r.GetInt32(1); await r.DisposeAsync();
        if(sys)throw new InvalidOperationException("系统角色不能删除，请停用或创建新的自定义角色。"); if(users>0)throw new InvalidOperationException("该角色仍被用户使用，请先调整用户角色后再删除。");
        await using var del=c.CreateCommand();del.Transaction=tx;del.CommandText="DELETE FROM Roles WHERE Id=$id AND IsSystemRole=0";del.Parameters.AddWithValue("$id",id);await del.ExecuteNonQueryAsync(cancellationToken);await tx.CommitAsync(cancellationToken);
    }

    public async Task SaveRolePolicyAsync(int id,RolePermissionUpdateRequest request,CancellationToken cancellationToken=default)
    {
        await using var c=await _database.OpenConnectionAsync(cancellationToken);using var tx=c.BeginTransaction();
        await using var exists=c.CreateCommand();exists.Transaction=tx;exists.CommandText="SELECT COUNT(*) FROM Roles WHERE Id=$id";exists.Parameters.AddWithValue("$id",id);if(Convert.ToInt32(await exists.ExecuteScalarAsync(cancellationToken))==0)throw new KeyNotFoundException("角色不存在。");
        foreach(var table in new[]{"RolePermissions","RoleWorkflowNodes","RoleDataScopes"}){await using var clear=c.CreateCommand();clear.Transaction=tx;clear.CommandText=$"DELETE FROM {table} WHERE RoleId=$id";clear.Parameters.AddWithValue("$id",id);await clear.ExecuteNonQueryAsync(cancellationToken);}
        foreach(var code in request.PermissionCodes.Distinct(StringComparer.OrdinalIgnoreCase)){await using var add=c.CreateCommand();add.Transaction=tx;add.CommandText="INSERT OR IGNORE INTO RolePermissions(RoleId,PermissionId) SELECT $roleId,Id FROM Permissions WHERE Code=$code";add.Parameters.AddWithValue("$roleId",id);add.Parameters.AddWithValue("$code",code);await add.ExecuteNonQueryAsync(cancellationToken);}
        foreach(var node in request.WorkflowNodes.Where(x=>x.Enabled)){await using var add=c.CreateCommand();add.Transaction=tx;add.CommandText="INSERT OR IGNORE INTO RoleWorkflowNodes(RoleId,WorkflowNodeCode) VALUES($id,$node)";add.Parameters.AddWithValue("$id",id);add.Parameters.AddWithValue("$node",node.NodeCode);await add.ExecuteNonQueryAsync(cancellationToken);}
        foreach(var scope in request.DataScopes.Where(x=>!string.IsNullOrWhiteSpace(x.Dimension))){await using var add=c.CreateCommand();add.Transaction=tx;add.CommandText="INSERT INTO RoleDataScopes(RoleId,Dimension,ScopeType,ScopeValue) VALUES($id,$dimension,$type,$value)";add.Parameters.AddWithValue("$id",id);add.Parameters.AddWithValue("$dimension",scope.Dimension);add.Parameters.AddWithValue("$type",scope.ScopeType);add.Parameters.AddWithValue("$value",scope.ScopeValue);await add.ExecuteNonQueryAsync(cancellationToken);}
        await tx.CommitAsync(cancellationToken);
    }

    public async Task AssignRolesAsync(int userId,int[] roleIds,CancellationToken cancellationToken=default)
    {
        await using var c=await _database.OpenConnectionAsync(cancellationToken);using var tx=c.BeginTransaction();
        await using var clear=c.CreateCommand();clear.Transaction=tx;clear.CommandText="DELETE FROM UserRoles WHERE UserId=$id";clear.Parameters.AddWithValue("$id",userId);await clear.ExecuteNonQueryAsync(cancellationToken);
        foreach(var roleId in roleIds.Distinct()){await using var add=c.CreateCommand();add.Transaction=tx;add.CommandText="INSERT INTO UserRoles(UserId,RoleId) VALUES($user,$role)";add.Parameters.AddWithValue("$user",userId);add.Parameters.AddWithValue("$role",roleId);await add.ExecuteNonQueryAsync(cancellationToken);}
        await tx.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<object>> ListPermissionsAsync(CancellationToken cancellationToken=default)
    { await using var c=await _database.OpenConnectionAsync(cancellationToken);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT Code,Name,Category FROM Permissions ORDER BY Category,Name";var rows=new List<object>();await using var r=await cmd.ExecuteReaderAsync(cancellationToken);while(await r.ReadAsync(cancellationToken))rows.Add(new{code=r.GetString(0),name=r.GetString(1),category=r.GetString(2)});return rows; }

    private async Task<List<string>> GetStringsAsync(CancellationToken cancellationToken,string sql,int id){await using var c=await _database.OpenConnectionAsync(cancellationToken);await using var cmd=c.CreateCommand();cmd.CommandText=sql;cmd.Parameters.AddWithValue("$id",id);var x=new List<string>();await using var r=await cmd.ExecuteReaderAsync(cancellationToken);while(await r.ReadAsync(cancellationToken))x.Add(r.GetString(0));return x;}
    private async Task<List<object>> GetScopesAsync(int id,CancellationToken cancellationToken){await using var c=await _database.OpenConnectionAsync(cancellationToken);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT Dimension,ScopeType,ScopeValue FROM RoleDataScopes WHERE RoleId=$id ORDER BY Dimension,ScopeValue";cmd.Parameters.AddWithValue("$id",id);var x=new List<object>();await using var r=await cmd.ExecuteReaderAsync(cancellationToken);while(await r.ReadAsync(cancellationToken))x.Add(new{dimension=r.GetString(0),scopeType=r.GetString(1),scopeValue=r.GetString(2)});return x;}
    private static void ValidateRole(RoleCreateRequest request){if(string.IsNullOrWhiteSpace(request.Name)||request.Name.Trim().Length>50)throw new ArgumentException("角色名称不能为空且不超过50字。");if(string.IsNullOrWhiteSpace(request.Code))throw new ArgumentException("角色编码不能为空。");}
    private static string NormalizeCode(string code)=>code.Trim().ToUpperInvariant().Replace(' ','_');
}
