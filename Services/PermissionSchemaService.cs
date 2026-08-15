using AdDeliverableManager.Security;

namespace AdDeliverableManager.Services;

public sealed class PermissionSchemaService
{
    private readonly DatabaseService _database;
    public PermissionSchemaService(DatabaseService database)=>_database=database;

    public async Task EnsureAsync(CancellationToken ct=default)
    {
        await using var c=await _database.OpenConnectionAsync(ct);
        await using var cmd=c.CreateCommand();
        cmd.CommandText="""
CREATE TABLE IF NOT EXISTS Roles(Id INTEGER PRIMARY KEY AUTOINCREMENT,Code TEXT NOT NULL UNIQUE COLLATE NOCASE,Name TEXT NOT NULL UNIQUE,Description TEXT,IsEnabled INTEGER NOT NULL DEFAULT 1,IsSystemRole INTEGER NOT NULL DEFAULT 0,CreatedBy TEXT NOT NULL,CreatedAt TEXT NOT NULL,UpdatedAt TEXT NOT NULL,Revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS Permissions(Id INTEGER PRIMARY KEY AUTOINCREMENT,Code TEXT NOT NULL UNIQUE,Name TEXT NOT NULL,Category TEXT NOT NULL,IsEnabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS RolePermissions(RoleId INTEGER NOT NULL,PermissionId INTEGER NOT NULL,PRIMARY KEY(RoleId,PermissionId),FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE,FOREIGN KEY(PermissionId) REFERENCES Permissions(Id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS UserRoles(UserId INTEGER NOT NULL,RoleId INTEGER NOT NULL,PRIMARY KEY(UserId,RoleId),FOREIGN KEY(UserId) REFERENCES Users(Id) ON DELETE CASCADE,FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS RoleWorkflowNodes(RoleId INTEGER NOT NULL,WorkflowNodeCode TEXT NOT NULL,PRIMARY KEY(RoleId,WorkflowNodeCode),FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS RoleDataScopes(Id INTEGER PRIMARY KEY AUTOINCREMENT,RoleId INTEGER NOT NULL,Dimension TEXT NOT NULL,ScopeType TEXT NOT NULL DEFAULT 'ALL',ScopeValue TEXT NOT NULL DEFAULT '',FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS IX_UserRoles_User ON UserRoles(UserId);CREATE INDEX IF NOT EXISTS IX_UserRoles_Role ON UserRoles(RoleId);CREATE INDEX IF NOT EXISTS IX_RolePermissions_Role ON RolePermissions(RoleId);CREATE INDEX IF NOT EXISTS IX_RoleWorkflowNodes_Role ON RoleWorkflowNodes(RoleId);CREATE INDEX IF NOT EXISTS IX_RoleDataScopes_RoleDimension ON RoleDataScopes(RoleId,Dimension);
""";
        await cmd.ExecuteNonQueryAsync(ct);
        await EnsureSystemAdminRoleAsync(ct);
        await SeedPermissionsAsync(ct);
        await EnsureSystemAdminPolicyAsync(ct);
        await MigrateLegacySystemAdminBindingsAsync(ct);
    }

    private async Task EnsureSystemAdminRoleAsync(CancellationToken ct)
    {
        await using var c=await _database.OpenConnectionAsync(ct);
        await using var cmd=c.CreateCommand();
        cmd.CommandText="INSERT OR IGNORE INTO Roles(Code,Name,Description,IsEnabled,IsSystemRole,CreatedBy,CreatedAt,UpdatedAt,Revision) VALUES('SYSTEM_ADMIN','系统管理员','系统初始管理员角色，默认拥有全部功能权限。',1,1,'SYSTEM',datetime('now'),datetime('now'),1)";
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task SeedPermissionsAsync(CancellationToken ct)
    {
        await using var c=await _database.OpenConnectionAsync(ct);
        foreach(var p in PermissionCatalog.All)
        {
            await using var cmd=c.CreateCommand();
            cmd.CommandText="INSERT OR IGNORE INTO Permissions(Code,Name,Category,IsEnabled) VALUES($code,$name,$category,1)";
            cmd.Parameters.AddWithValue("$code",p.Code);cmd.Parameters.AddWithValue("$name",p.Name);cmd.Parameters.AddWithValue("$category",p.Category);
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    private async Task EnsureSystemAdminPolicyAsync(CancellationToken ct)
    {
        await using var c=await _database.OpenConnectionAsync(ct);
        await using var role=c.CreateCommand();
        role.CommandText="SELECT Id FROM Roles WHERE Code='SYSTEM_ADMIN' AND IsEnabled=1";
        var roleId=Convert.ToInt32(await role.ExecuteScalarAsync(ct)??0);
        if(roleId<=0)return;

        // System administrator is the built-in full-access role. Keep it synchronized
        // with the catalog so newly introduced Permission Codes become available too.
        foreach(var p in PermissionCatalog.All)
        {
            await using var cmd=c.CreateCommand();
            cmd.CommandText="INSERT OR IGNORE INTO RolePermissions(RoleId,PermissionId) SELECT $role,Id FROM Permissions WHERE Code=$code AND IsEnabled=1";
            cmd.Parameters.AddWithValue("$role",roleId);cmd.Parameters.AddWithValue("$code",p.Code);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        foreach(var n in PermissionCatalog.WorkflowNodes)
        {
            await using var cmd=c.CreateCommand();
            cmd.CommandText="INSERT OR IGNORE INTO RoleWorkflowNodes(RoleId,WorkflowNodeCode) VALUES($role,$node)";
            cmd.Parameters.AddWithValue("$role",roleId);cmd.Parameters.AddWithValue("$node",n.Code);
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    private async Task MigrateLegacySystemAdminBindingsAsync(CancellationToken ct)
    {
        await using var c=await _database.OpenConnectionAsync(ct);
        await using var cmd=c.CreateCommand();
        // Existing databases may contain an older IsSystemRole role (for example ADMIN).
        // Preserve its users by additionally binding them to the canonical SYSTEM_ADMIN role.
        cmd.CommandText="""
INSERT OR IGNORE INTO UserRoles(UserId,RoleId)
SELECT ur.UserId, canonical.Id
FROM UserRoles ur
JOIN Roles legacy ON legacy.Id=ur.RoleId AND legacy.IsSystemRole=1 AND legacy.Code<>$canonicalCode
JOIN Roles canonical ON canonical.Code=$canonicalCode AND canonical.IsEnabled=1
""";
        cmd.Parameters.AddWithValue("$canonicalCode",AppRoles.SystemAdminCode);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
