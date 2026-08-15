using AdDeliverableManager.Models;
using AdDeliverableManager.Security;

namespace AdDeliverableManager.Services;

public sealed class PermissionSchemaService
{
    private readonly DatabaseService _database;
    public PermissionSchemaService(DatabaseService database) => _database = database;

    public async Task EnsureAsync(CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = """
CREATE TABLE IF NOT EXISTS Roles(Id INTEGER PRIMARY KEY AUTOINCREMENT,Code TEXT NOT NULL UNIQUE COLLATE NOCASE,Name TEXT NOT NULL UNIQUE,Description TEXT,IsEnabled INTEGER NOT NULL DEFAULT 1,IsSystemRole INTEGER NOT NULL DEFAULT 0,CreatedBy TEXT NOT NULL,CreatedAt TEXT NOT NULL,UpdatedAt TEXT NOT NULL,Revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS Permissions(Id INTEGER PRIMARY KEY AUTOINCREMENT,Code TEXT NOT NULL UNIQUE,Name TEXT NOT NULL,Category TEXT NOT NULL,IsEnabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS RolePermissions(RoleId INTEGER NOT NULL,PermissionId INTEGER NOT NULL,PRIMARY KEY(RoleId,PermissionId),FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE,FOREIGN KEY(PermissionId) REFERENCES Permissions(Id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS UserRoles(UserId INTEGER NOT NULL,RoleId INTEGER NOT NULL,PRIMARY KEY(UserId,RoleId),FOREIGN KEY(UserId) REFERENCES Users(Id) ON DELETE CASCADE,FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS RoleDataScopes(Id INTEGER PRIMARY KEY AUTOINCREMENT,RoleId INTEGER NOT NULL,Dimension TEXT NOT NULL,ScopeType TEXT NOT NULL,ScopeValue TEXT NOT NULL DEFAULT '',FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS IX_UserRoles_User ON UserRoles(UserId);CREATE INDEX IF NOT EXISTS IX_UserRoles_Role ON UserRoles(RoleId);CREATE INDEX IF NOT EXISTS IX_RolePermissions_Role ON RolePermissions(RoleId);CREATE INDEX IF NOT EXISTS IX_RoleDataScopes_RoleDimension ON RoleDataScopes(RoleId,Dimension);
""";
        await cmd.ExecuteNonQueryAsync(ct);

        await SeedPermissionsAsync(c, ct);
        var systemRoleId = await EnsureSystemAdminRoleAsync(c, ct);
        await EnsureSystemAdminPolicyAsync(c, systemRoleId, ct);
    }

    private static async Task SeedPermissionsAsync(Microsoft.Data.Sqlite.SqliteConnection c, CancellationToken ct)
    {
        foreach (var permission in PermissionCatalog.All)
        {
            await using var cmd = c.CreateCommand();
            cmd.CommandText = "INSERT INTO Permissions(Code,Name,Category,IsEnabled) VALUES($code,$name,$category,1) ON CONFLICT(Code) DO UPDATE SET Name=excluded.Name,Category=excluded.Category,IsEnabled=1";
            cmd.Parameters.AddWithValue("$code", permission.Code); cmd.Parameters.AddWithValue("$name", permission.Name); cmd.Parameters.AddWithValue("$category", permission.Category);
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    private static async Task<int> EnsureSystemAdminRoleAsync(Microsoft.Data.Sqlite.SqliteConnection c, CancellationToken ct)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO Roles(Code,Name,Description,IsEnabled,IsSystemRole,CreatedBy,CreatedAt,UpdatedAt,Revision) VALUES('SYSTEM_ADMIN','系统管理员','系统内置管理员，拥有全部功能权限和全部数据范围。',1,1,'SYSTEM',datetime('now'),datetime('now'),1) ON CONFLICT(Code) DO UPDATE SET Name='系统管理员',Description='系统内置管理员，拥有全部功能权限和全部数据范围。',IsEnabled=1,IsSystemRole=1 RETURNING Id";
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
    }

    private static async Task EnsureSystemAdminPolicyAsync(Microsoft.Data.Sqlite.SqliteConnection c, int roleId, CancellationToken ct)
    {
        await using var tx = await c.BeginTransactionAsync(ct);
        await using var clearPermissions = c.CreateCommand(); clearPermissions.Transaction = tx; clearPermissions.CommandText = "DELETE FROM RolePermissions WHERE RoleId=$role"; clearPermissions.Parameters.AddWithValue("$role", roleId); await clearPermissions.ExecuteNonQueryAsync(ct);
        foreach (var permission in PermissionCatalog.All)
        {
            await using var add = c.CreateCommand(); add.Transaction = tx;
            add.CommandText = "INSERT INTO RolePermissions(RoleId,PermissionId) SELECT $role,Id FROM Permissions WHERE Code=$code"; add.Parameters.AddWithValue("$role", roleId); add.Parameters.AddWithValue("$code", permission.Code); await add.ExecuteNonQueryAsync(ct);
        }
        await using var clearScopes = c.CreateCommand(); clearScopes.Transaction = tx; clearScopes.CommandText = "DELETE FROM RoleDataScopes WHERE RoleId=$role"; clearScopes.Parameters.AddWithValue("$role", roleId); await clearScopes.ExecuteNonQueryAsync(ct);
        foreach (var dimension in DataScopeCatalog.Dimensions)
        {
            await using var add = c.CreateCommand(); add.Transaction = tx;
            add.CommandText = "INSERT INTO RoleDataScopes(RoleId,Dimension,ScopeType,ScopeValue) VALUES($role,$dimension,'ALL','')";
            add.Parameters.AddWithValue("$role", roleId); add.Parameters.AddWithValue("$dimension", dimension.Code); await add.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }
}
