using AdDeliverableManager.Security;

namespace AdDeliverableManager.Services;

public sealed class PermissionSchemaService
{
    private readonly DatabaseService _database;
    public PermissionSchemaService(DatabaseService database)=>_database=database;

    public async Task EnsureAsync(CancellationToken ct=default)
    {
        await using var c=await _database.OpenConnectionAsync(ct);
        await using var cmd=c.CreateCommand();cmd.CommandText="""
            CREATE TABLE IF NOT EXISTS Roles(Id INTEGER PRIMARY KEY AUTOINCREMENT,Code TEXT NOT NULL UNIQUE COLLATE NOCASE,Name TEXT NOT NULL UNIQUE,Description TEXT,IsEnabled INTEGER NOT NULL DEFAULT 1,IsSystemRole INTEGER NOT NULL DEFAULT 0,CreatedBy TEXT NOT NULL,CreatedAt TEXT NOT NULL,UpdatedAt TEXT NOT NULL,Revision INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS Permissions(Id INTEGER PRIMARY KEY AUTOINCREMENT,Code TEXT NOT NULL UNIQUE,Name TEXT NOT NULL,Category TEXT NOT NULL,IsEnabled INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS RolePermissions(RoleId INTEGER NOT NULL,PermissionId INTEGER NOT NULL,PRIMARY KEY(RoleId,PermissionId),FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE,FOREIGN KEY(PermissionId) REFERENCES Permissions(Id) ON DELETE CASCADE);
            CREATE TABLE IF NOT EXISTS UserRoles(UserId INTEGER NOT NULL,RoleId INTEGER NOT NULL,PRIMARY KEY(UserId,RoleId),FOREIGN KEY(UserId) REFERENCES Users(Id) ON DELETE CASCADE,FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
            CREATE TABLE IF NOT EXISTS RoleWorkflowNodes(RoleId INTEGER NOT NULL,WorkflowNodeCode TEXT NOT NULL,PRIMARY KEY(RoleId,WorkflowNodeCode),FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
            CREATE TABLE IF NOT EXISTS RoleDataScopes(Id INTEGER PRIMARY KEY AUTOINCREMENT,RoleId INTEGER NOT NULL,Dimension TEXT NOT NULL,ScopeType TEXT NOT NULL DEFAULT 'ALL',ScopeValue TEXT NOT NULL DEFAULT '',FOREIGN KEY(RoleId) REFERENCES Roles(Id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS IX_UserRoles_User ON UserRoles(UserId);CREATE INDEX IF NOT EXISTS IX_UserRoles_Role ON UserRoles(RoleId);CREATE INDEX IF NOT EXISTS IX_RolePermissions_Role ON RolePermissions(RoleId);CREATE INDEX IF NOT EXISTS IX_RoleWorkflowNodes_Role ON RoleWorkflowNodes(RoleId);CREATE INDEX IF NOT EXISTS IX_RoleDataScopes_RoleDimension ON RoleDataScopes(RoleId,Dimension);
            """;await cmd.ExecuteNonQueryAsync(ct);
        if(await NeedsLegacyUsersMigrationAsync(c,ct))await MigrateLegacyUsersAsync(ct);
        await SeedCatalogAsync(ct);
    }

    private static async Task<bool> NeedsLegacyUsersMigrationAsync(Microsoft.Data.Sqlite.SqliteConnection c,CancellationToken ct)
    {await using var cmd=c.CreateCommand();cmd.CommandText="SELECT sql FROM sqlite_master WHERE type='table' AND name='Users'";var sql=Convert.ToString(await cmd.ExecuteScalarAsync(ct))??"";return sql.Contains("CHECK(RoleCode IN",StringComparison.OrdinalIgnoreCase);}

    private async Task MigrateLegacyUsersAsync(CancellationToken ct)
    {
        await using var c=await _database.OpenConnectionAsync(ct);using var tx=c.BeginTransaction();
        await using var rebuild=c.CreateCommand();rebuild.Transaction=tx;rebuild.CommandText="""
            CREATE TABLE Users_v08(Id INTEGER PRIMARY KEY AUTOINCREMENT,Username TEXT NOT NULL UNIQUE COLLATE NOCASE,DisplayName TEXT NOT NULL,PasswordHash TEXT NOT NULL,PasswordSalt TEXT NOT NULL,RoleCode TEXT NOT NULL DEFAULT 'CUSTOM',IsEnabled INTEGER NOT NULL DEFAULT 1,MustChangePassword INTEGER NOT NULL DEFAULT 0,LastLoginAt TEXT,CreatedBy TEXT NOT NULL,CreatedAt TEXT NOT NULL,UpdatedAt TEXT NOT NULL,Revision INTEGER NOT NULL DEFAULT 1);
            INSERT INTO Users_v08(Id,Username,DisplayName,PasswordHash,PasswordSalt,RoleCode,IsEnabled,MustChangePassword,LastLoginAt,CreatedBy,CreatedAt,UpdatedAt,Revision) SELECT Id,Username,DisplayName,PasswordHash,PasswordSalt,CASE WHEN RoleCode IN ('ADMIN','EDITOR','APPROVER','VIEWER') THEN RoleCode ELSE 'CUSTOM' END,IsEnabled,MustChangePassword,LastLoginAt,CreatedBy,CreatedAt,UpdatedAt,Revision FROM Users;
            DROP TABLE Users;ALTER TABLE Users_v08 RENAME TO Users;CREATE INDEX IF NOT EXISTS IX_Users_RoleCode ON Users(RoleCode);CREATE INDEX IF NOT EXISTS IX_Users_IsEnabled ON Users(IsEnabled);
            """;await rebuild.ExecuteNonQueryAsync(ct);await tx.CommitAsync(ct);
        foreach(var role in new[]{(AppRoles.Admin,"系统管理员"),(AppRoles.Editor,"编辑者（迁移角色）"),(AppRoles.Approver,"审批者（迁移角色）"),(AppRoles.Viewer,"查看者（迁移角色）")})await EnsureRoleAsync(role.Item1,role.Item2,true,ct);
        await using var assign=await _database.OpenConnectionAsync(ct);await using var link=assign.CreateCommand();link.CommandText="INSERT OR IGNORE INTO UserRoles(UserId,RoleId) SELECT u.Id,r.Id FROM Users u JOIN Roles r ON r.Code=u.RoleCode WHERE u.RoleCode IN ('ADMIN','EDITOR','APPROVER','VIEWER')";await link.ExecuteNonQueryAsync(ct);
    }

    private async Task SeedCatalogAsync(CancellationToken ct)
    {await using var c=await _database.OpenConnectionAsync(ct);foreach(var item in PermissionCatalog.All){await using var cmd=c.CreateCommand();cmd.CommandText="INSERT OR IGNORE INTO Permissions(Code,Name,Category,IsEnabled) VALUES($code,$name,$category,1)";cmd.Parameters.AddWithValue("$code",item.Code);cmd.Parameters.AddWithValue("$name",item.Name);cmd.Parameters.AddWithValue("$category",item.Category);await cmd.ExecuteNonQueryAsync(ct);}await SeedSystemRolePoliciesAsync(ct);}

    private async Task SeedSystemRolePoliciesAsync(CancellationToken ct)
    {var all=PermissionCatalog.All.Select(x=>x.Code).ToArray();await ApplySystemRolePolicyAsync(AppRoles.Admin,all,PermissionCatalog.WorkflowNodes.Select(x=>x.Code).ToArray(),ct);await ApplySystemRolePolicyAsync(AppRoles.Editor,new[]{PermissionCatalog.DeliveryView,PermissionCatalog.DeliveryCreate,PermissionCatalog.DeliveryEdit,PermissionCatalog.DeliveryArchive,PermissionCatalog.DeliveryExport,PermissionCatalog.VersionCreate,PermissionCatalog.VersionSubmit,PermissionCatalog.ChangeView,PermissionCatalog.ChangeCreate,PermissionCatalog.ChangeEdit,PermissionCatalog.ChangeStart,PermissionCatalog.ChangeVerify,PermissionCatalog.RelationView,PermissionCatalog.RelationEdit,PermissionCatalog.DashboardView,PermissionCatalog.AnalyticsView},new[]{"CHANGE_IMPLEMENT","CHANGE_VERIFY"},ct);await ApplySystemRolePolicyAsync(AppRoles.Approver,new[]{PermissionCatalog.DeliveryView,PermissionCatalog.DeliveryExport,PermissionCatalog.VersionReturn,PermissionCatalog.VersionApprove,PermissionCatalog.VersionRelease,PermissionCatalog.VersionDeprecate,PermissionCatalog.ChangeView,PermissionCatalog.ChangeApprove,PermissionCatalog.ChangeClose,PermissionCatalog.RelationView,PermissionCatalog.DashboardView,PermissionCatalog.AnalyticsView},new[]{"VERSION_APPROVAL","VERSION_RELEASE","VERSION_DEPRECATE","CHANGE_APPROVAL","CHANGE_CLOSE"},ct);await ApplySystemRolePolicyAsync(AppRoles.Viewer,new[]{PermissionCatalog.DeliveryView,PermissionCatalog.DeliveryExport,PermissionCatalog.ChangeView,PermissionCatalog.RelationView,PermissionCatalog.DashboardView,PermissionCatalog.AnalyticsView},Array.Empty<string>(),ct);}

    private async Task ApplySystemRolePolicyAsync(string code,string[] permissions,string[] nodes,CancellationToken ct){var roleId=await GetRoleIdAsync(code,ct);if(roleId<=0)return;await using var c=await _database.OpenConnectionAsync(ct);await using var clear=c.CreateCommand();clear.CommandText="DELETE FROM RolePermissions WHERE RoleId=$id;DELETE FROM RoleWorkflowNodes WHERE RoleId=$id;";clear.Parameters.AddWithValue("$id",roleId);await clear.ExecuteNonQueryAsync(ct);foreach(var p in permissions){await using var cmd=c.CreateCommand();cmd.CommandText="INSERT OR IGNORE INTO RolePermissions(RoleId,PermissionId) SELECT $role,Id FROM Permissions WHERE Code=$code";cmd.Parameters.AddWithValue("$role",roleId);cmd.Parameters.AddWithValue("$code",p);await cmd.ExecuteNonQueryAsync(ct);}foreach(var n in nodes){await using var cmd=c.CreateCommand();cmd.CommandText="INSERT OR IGNORE INTO RoleWorkflowNodes(RoleId,WorkflowNodeCode) VALUES($role,$node)";cmd.Parameters.AddWithValue("$role",roleId);cmd.Parameters.AddWithValue("$node",n);await cmd.ExecuteNonQueryAsync(ct);}}
    private async Task EnsureRoleAsync(string code,string name,bool system,CancellationToken ct){await using var c=await _database.OpenConnectionAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="INSERT OR IGNORE INTO Roles(Code,Name,Description,IsEnabled,IsSystemRole,CreatedBy,CreatedAt,UpdatedAt,Revision) VALUES($code,$name,$name,1,$system,'SYSTEM',$now,$now,1)";cmd.Parameters.AddWithValue("$code",code);cmd.Parameters.AddWithValue("$name",name);cmd.Parameters.AddWithValue("$system",system?1:0);cmd.Parameters.AddWithValue("$now",DateTime.UtcNow.ToString("O"));await cmd.ExecuteNonQueryAsync(ct);}
    private async Task<int> GetRoleIdAsync(string code,CancellationToken ct){await using var c=await _database.OpenConnectionAsync(ct);await using var cmd=c.CreateCommand();cmd.CommandText="SELECT Id FROM Roles WHERE Code=$code";cmd.Parameters.AddWithValue("$code",code);return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct)??0);}
}
