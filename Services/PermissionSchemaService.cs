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
DROP TABLE IF EXISTS RoleWorkflowNodes;
CREATE TABLE IF NOT EXISTS Roles(Id INTEGER PRIMARY KEY AUTOINCREMENT,Code TEXT NOT NULL UNIQUE COLLATE NOCASE,Name TEXT NOT NULL UNIQUE,Description TEXT,IsEnabled INTEGER NOT NULL DEFAULT 1,IsSystemRole INTEGER NOT NULL DEFAULT 0,CreatedBy TEXT NOT NULL,CreatedAt TEXT NOT NULL,UpdatedAt TEXT NOT NULL,Revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS Permissions(Id INTEGER PRIMARY KEY AUTOINCREMENT,Code TEXT NOT NULL UNIQUE,Name TEXT NOT NULL,Category TEXT NOT NULL,IsEnabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS RolePermissions(RoleId INTEGER NOT NULL,PermissionId INTEGER NOT NULL,PRIMARY KEY(RoleId,PermissionId),FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE,FOREIGN KEY(PermissionId) REFERENCES Permissions(Id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS UserRoles(UserId INTEGER NOT NULL,RoleId INTEGER NOT NULL,PRIMARY KEY(UserId,RoleId),FOREIGN KEY(UserId) REFERENCES Users(Id) ON DELETE CASCADE,FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS RoleDataScopes(Id INTEGER PRIMARY KEY AUTOINCREMENT,RoleId INTEGER NOT NULL,Dimension TEXT NOT NULL,ScopeType TEXT NOT NULL,ScopeValue TEXT NOT NULL DEFAULT '',FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS IX_UserRoles_User ON UserRoles(UserId);CREATE INDEX IF NOT EXISTS IX_UserRoles_Role ON UserRoles(RoleId);CREATE INDEX IF NOT EXISTS IX_RolePermissions_Role ON RolePermissions(RoleId);CREATE INDEX IF NOT EXISTS IX_RoleDataScopes_RoleDimension ON RoleDataScopes(RoleId,Dimension);
""";
        await cmd.ExecuteNonQueryAsync(ct);
        await using var cleanup = c.CreateCommand(); cleanup.CommandText = "DELETE FROM RoleDataScopes WHERE Dimension NOT IN ('DEPARTMENT','PROJECT','TYPE')"; await cleanup.ExecuteNonQueryAsync(ct);
        var catalogCodes = string.Join(",", PermissionCatalog.All.Select(x => $"'{x.Code.Replace("'", "''")}'"));
        await using var permissionCleanup = c.CreateCommand(); permissionCleanup.CommandText = $"DELETE FROM Permissions WHERE Code NOT IN ({catalogCodes})"; await permissionCleanup.ExecuteNonQueryAsync(ct);
        await SeedPermissionsAsync(c, ct);
        await MigrateDictionaryPermissionsAsync(c, ct);
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

    private static async Task MigrateDictionaryPermissionsAsync(Microsoft.Data.Sqlite.SqliteConnection c, CancellationToken ct)
    {
        await using (var create = c.CreateCommand())
        {
            create.CommandText = "CREATE TABLE IF NOT EXISTS PermissionSchemaMigrations(MigrationId TEXT PRIMARY KEY,AppliedAt TEXT NOT NULL)";
            await create.ExecuteNonQueryAsync(ct);
        }
        await using (var exists = c.CreateCommand())
        {
            exists.CommandText = "SELECT COUNT(*) FROM PermissionSchemaMigrations WHERE MigrationId='001_DICTIONARY_PERMISSIONS'";
            if (Convert.ToInt32(await exists.ExecuteScalarAsync(ct)) > 0) return;
        }

        var mappings = new[]
        {
            (PermissionCatalog.MasterDataView, PermissionCatalog.DictionaryView),
            (PermissionCatalog.MasterDataCreate, PermissionCatalog.DictionaryCreate),
            (PermissionCatalog.MasterDataEdit, PermissionCatalog.DictionaryEdit),
            (PermissionCatalog.MasterDataDelete, PermissionCatalog.DictionaryDelete)
        };
        using var transaction = c.BeginTransaction();
        foreach (var (source, target) in mappings)
        {
            await using var command = c.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT OR IGNORE INTO RolePermissions(RoleId,PermissionId)
                SELECT rp.RoleId,target.Id
                FROM RolePermissions rp
                JOIN Permissions source ON source.Id=rp.PermissionId AND source.Code=$source
                JOIN Permissions target ON target.Code=$target AND target.IsEnabled=1;
                """;
            command.Parameters.AddWithValue("$source", source);
            command.Parameters.AddWithValue("$target", target);
            await command.ExecuteNonQueryAsync(ct);
        }
        await using var record = c.CreateCommand();
        record.Transaction = transaction;
        record.CommandText = "INSERT INTO PermissionSchemaMigrations(MigrationId,AppliedAt) VALUES('001_DICTIONARY_PERMISSIONS',$now)";
        record.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        await record.ExecuteNonQueryAsync(ct);
        await transaction.CommitAsync(ct);
    }

    private static async Task<int> EnsureSystemAdminRoleAsync(Microsoft.Data.Sqlite.SqliteConnection c, CancellationToken ct)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO Roles(Code,Name,Description,IsEnabled,IsSystemRole,CreatedBy,CreatedAt,UpdatedAt,Revision) VALUES('SYSTEM_ADMIN','系统管理员','系统内置管理员，拥有全部功能权限和全部数据范围。',1,1,'SYSTEM',datetime('now'),datetime('now'),1) ON CONFLICT(Code) DO UPDATE SET Name='系统管理员',Description='系统内置管理员，拥有全部功能权限和全部数据范围。',IsEnabled=1,IsSystemRole=1 RETURNING Id";
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
    }

    private static async Task EnsureSystemAdminPolicyAsync(Microsoft.Data.Sqlite.SqliteConnection c, int roleId, CancellationToken ct)
    {
        using var tx = c.BeginTransaction();
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
