using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class PermissionRepository
{
    private readonly DatabaseService _database;
    public PermissionRepository(DatabaseService database) => _database = database;

    public async Task<IReadOnlyList<object>> ListRolesAsync(CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT r.Id,r.Code,r.Name,r.Description,r.IsEnabled,r.IsSystemRole,r.CreatedBy,r.CreatedAt,r.UpdatedAt,r.Revision,(SELECT COUNT(*) FROM UserRoles ur WHERE ur.RoleId=r.Id) FROM Roles r ORDER BY r.IsSystemRole DESC,r.Name";
        var rows = new List<object>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new
            {
                id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2),
                description = reader.IsDBNull(3) ? null : reader.GetString(3), isEnabled = reader.GetInt32(4) == 1,
                isSystemRole = reader.GetInt32(5) == 1, createdBy = reader.GetString(6), createdAt = reader.GetString(7),
                updatedAt = reader.GetString(8), revision = reader.GetInt32(9), userCount = reader.GetInt32(10)
            });
        }
        return rows;
    }

    public async Task<object?> GetRoleAsync(int id, CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT Id,Code,Name,Description,IsEnabled,IsSystemRole,Revision FROM Roles WHERE Id=$id";
        cmd.Parameters.AddWithValue("$id", id);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        var role = new
        {
            id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2),
            description = reader.IsDBNull(3) ? null : reader.GetString(3), isEnabled = reader.GetInt32(4) == 1,
            isSystemRole = reader.GetInt32(5) == 1, revision = reader.GetInt32(6)
        };
        return new { role, permissions = await GetStringsAsync("SELECT p.Code FROM RolePermissions rp JOIN Permissions p ON p.Id=rp.PermissionId WHERE rp.RoleId=$id ORDER BY p.Category,p.Name", id, ct), dataScopes = await GetScopesAsync(id, ct) };
    }

    public async Task<int> CreateRoleAsync(RoleCreateRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateRole(request);
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await using var cmd = c.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT INTO Roles(Code,Name,Description,IsEnabled,IsSystemRole,CreatedBy,CreatedAt,UpdatedAt,Revision) VALUES($code,$name,$desc,$enabled,0,$by,$now,$now,1); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("$code", NormalizeCode(request.Code)); cmd.Parameters.AddWithValue("$name", request.Name.Trim());
        cmd.Parameters.AddWithValue("$desc", request.Description); cmd.Parameters.AddWithValue("$enabled", request.IsEnabled ? 1 : 0);
        cmd.Parameters.AddWithValue("$by", operatorName); cmd.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        try { var id = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct)); await tx.CommitAsync(ct); return id; }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19) { throw new InvalidOperationException("角色编码或名称已存在。"); }
    }

    public async Task<bool> UpdateRoleAsync(int id, RoleUpdateRequest request, CancellationToken ct = default)
    {
        ValidateRole(request);
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE Roles SET Name=$name,Description=$desc,IsEnabled=$enabled,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND Revision=$revision AND IsSystemRole=0";
        cmd.Parameters.AddWithValue("$name", request.Name.Trim()); cmd.Parameters.AddWithValue("$desc", request.Description);
        cmd.Parameters.AddWithValue("$enabled", request.IsEnabled ? 1 : 0); cmd.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$id", id); cmd.Parameters.AddWithValue("$revision", request.Revision);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    public async Task DeleteRoleAsync(int id, CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await using var check = c.CreateCommand();
        check.Transaction = tx;
        check.CommandText = "SELECT IsSystemRole,(SELECT COUNT(*) FROM UserRoles WHERE RoleId=$id) FROM Roles WHERE Id=$id";
        check.Parameters.AddWithValue("$id", id);
        await using var reader = await check.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) throw new KeyNotFoundException("角色不存在。");
        var isSystem = reader.GetInt32(0) == 1; var userCount = reader.GetInt32(1); await reader.DisposeAsync();
        if (isSystem) throw new InvalidOperationException("系统管理员角色不能删除。");
        if (userCount > 0) throw new InvalidOperationException("该角色仍被用户使用，请先调整用户角色后再删除。");
        await using var del = c.CreateCommand(); del.Transaction = tx; del.CommandText = "DELETE FROM Roles WHERE Id=$id AND IsSystemRole=0"; del.Parameters.AddWithValue("$id", id); await del.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
    }

    public async Task SaveRolePolicyAsync(int id, RolePermissionUpdateRequest request, CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await using var roleCmd = c.CreateCommand();
        roleCmd.Transaction = tx;
        roleCmd.CommandText = "SELECT IsSystemRole FROM Roles WHERE Id=$id";
        roleCmd.Parameters.AddWithValue("$id", id);
        var roleValue = await roleCmd.ExecuteScalarAsync(ct);
        if (roleValue is null) throw new KeyNotFoundException("角色不存在。");
        var isSystem = Convert.ToInt32(roleValue) == 1;

        var permissionCodes = isSystem ? PermissionCatalog.All.Select(x => x.Code).ToArray() : request.PermissionCodes.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        await using var clearPermissions = c.CreateCommand(); clearPermissions.Transaction = tx; clearPermissions.CommandText = "DELETE FROM RolePermissions WHERE RoleId=$id"; clearPermissions.Parameters.AddWithValue("$id", id); await clearPermissions.ExecuteNonQueryAsync(ct);
        foreach (var code in permissionCodes)
        {
            await using var add = c.CreateCommand(); add.Transaction = tx;
            add.CommandText = "INSERT INTO RolePermissions(RoleId,PermissionId) SELECT $role,Id FROM Permissions WHERE Code=$code AND IsEnabled=1";
            add.Parameters.AddWithValue("$role", id); add.Parameters.AddWithValue("$code", code);
            await add.ExecuteNonQueryAsync(ct);
        }

        await using var clearScopes = c.CreateCommand(); clearScopes.Transaction = tx; clearScopes.CommandText = "DELETE FROM RoleDataScopes WHERE RoleId=$id"; clearScopes.Parameters.AddWithValue("$id", id); await clearScopes.ExecuteNonQueryAsync(ct);
        var scopes = isSystem
            ? DataScopeCatalog.Dimensions.Select(x => new DataScopeGrant { Dimension = x.Code, ScopeType = DataScopeCatalog.All }).ToArray()
            : request.DataScopes;
        foreach (var scope in scopes.Where(x => !string.IsNullOrWhiteSpace(x.Dimension)))
        {
            await using var add = c.CreateCommand(); add.Transaction = tx;
            add.CommandText = "INSERT INTO RoleDataScopes(RoleId,Dimension,ScopeType,ScopeValue) VALUES($role,$dimension,$type,$value)";
            add.Parameters.AddWithValue("$role", id); add.Parameters.AddWithValue("$dimension", scope.Dimension.ToUpperInvariant());
            add.Parameters.AddWithValue("$type", scope.ScopeType.ToUpperInvariant()); add.Parameters.AddWithValue("$value", scope.ScopeValue ?? "");
            await add.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }

    public async Task AssignRolesAsync(int userId, int[] roleIds, CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var tx = await c.BeginTransactionAsync(ct);
        await using var clear = c.CreateCommand(); clear.Transaction = tx; clear.CommandText = "DELETE FROM UserRoles WHERE UserId=$id"; clear.Parameters.AddWithValue("$id", userId); await clear.ExecuteNonQueryAsync(ct);
        foreach (var roleId in roleIds.Distinct())
        {
            await using var add = c.CreateCommand(); add.Transaction = tx; add.CommandText = "INSERT INTO UserRoles(UserId,RoleId) SELECT $user,Id FROM Roles WHERE Id=$role AND IsEnabled=1"; add.Parameters.AddWithValue("$user", userId); add.Parameters.AddWithValue("$role", roleId);
            if (await add.ExecuteNonQueryAsync(ct) == 0) throw new InvalidOperationException("所选角色不存在或已停用。");
        }
        await tx.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<object>> ListPermissionsAsync(CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT Code,Name,Category FROM Permissions WHERE IsEnabled=1 ORDER BY Category,Name";
        var rows = new List<object>(); await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) rows.Add(new { code = reader.GetString(0), name = reader.GetString(1), category = reader.GetString(2) });
        return rows;
    }

    private async Task<List<string>> GetStringsAsync(string sql, int id, CancellationToken ct)
    {
        await using var c = await _database.OpenConnectionAsync(ct); await using var cmd = c.CreateCommand(); cmd.CommandText = sql; cmd.Parameters.AddWithValue("$id", id);
        var values = new List<string>(); await using var reader = await cmd.ExecuteReaderAsync(ct); while (await reader.ReadAsync(ct)) values.Add(reader.GetString(0)); return values;
    }

    private async Task<List<object>> GetScopesAsync(int id, CancellationToken ct)
    {
        await using var c = await _database.OpenConnectionAsync(ct); await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT Dimension,ScopeType,ScopeValue FROM RoleDataScopes WHERE RoleId=$id ORDER BY Dimension,ScopeValue"; cmd.Parameters.AddWithValue("$id", id);
        var values = new List<object>(); await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) values.Add(new { dimension = reader.GetString(0), scopeType = reader.GetString(1), scopeValue = reader.GetString(2) }); return values;
    }

    private static void ValidateRole(RoleCreateRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 50) throw new ArgumentException("角色名称不能为空且不超过50字。");
        if (string.IsNullOrWhiteSpace(request.Code)) throw new ArgumentException("角色编码不能为空。");
    }

    private static string NormalizeCode(string code) => code.Trim().ToUpperInvariant().Replace(' ', '_');
}
