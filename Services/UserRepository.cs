using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class UserRepository
{
    private readonly DatabaseService _database;
    private readonly PasswordService _passwords;

    public UserRepository(DatabaseService database, PasswordService passwords)
    {
        _database = database;
        _passwords = passwords;
    }

    public async Task<int> CountAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM Users";
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
    }

    public async Task<UserRecord?> FindByUsernameAsync(string username, CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id,Username,DisplayName,PasswordHash,PasswordSalt,RoleCode,IsEnabled,MustChangePassword,LastLoginAt,Revision
            FROM Users WHERE Username=$username COLLATE NOCASE;
            """;
        command.Parameters.AddWithValue("$username", username.Trim());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task<UserRecord?> FindByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id,Username,DisplayName,PasswordHash,PasswordSalt,RoleCode,IsEnabled,MustChangePassword,LastLoginAt,Revision
            FROM Users WHERE Id=$id;
            """;
        command.Parameters.AddWithValue("$id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task<int> BootstrapAdminAsync(BootstrapAdminRequest request, CancellationToken cancellationToken = default)
    {
        if (await CountAsync(cancellationToken) > 0)
            throw new InvalidOperationException("系统已经完成管理员初始化。");

        return await CreateAsync(new UserCreateRequest
        {
            Username = request.Username,
            DisplayName = request.DisplayName,
            Password = request.Password,
            RoleCode = AppRoles.Admin,
            MustChangePassword = false
        }, "SYSTEM_BOOTSTRAP", cancellationToken);
    }

    public async Task<int> CreateAsync(UserCreateRequest request, string operatorName, CancellationToken cancellationToken = default)
    {
        var username = NormalizeUsername(request.Username);
        if (string.IsNullOrWhiteSpace(request.DisplayName)) throw new ArgumentException("显示名称不能为空。");
        ValidateRole(request.RoleCode);
        var (hash, salt) = _passwords.HashPassword(request.Password);
        var now = DateTime.UtcNow.ToString("O");

        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO Users(Username,DisplayName,PasswordHash,PasswordSalt,RoleCode,IsEnabled,MustChangePassword,
                CreatedBy,CreatedAt,UpdatedAt,Revision)
            VALUES($username,$displayName,$hash,$salt,$role,1,$mustChange,$operator,$now,$now,1);
            SELECT last_insert_rowid();
            """;
        command.Parameters.AddWithValue("$username", username);
        command.Parameters.AddWithValue("$displayName", request.DisplayName.Trim());
        command.Parameters.AddWithValue("$hash", hash);
        command.Parameters.AddWithValue("$salt", salt);
        command.Parameters.AddWithValue("$role", request.RoleCode);
        command.Parameters.AddWithValue("$mustChange", request.MustChangePassword ? 1 : 0);
        command.Parameters.AddWithValue("$operator", operatorName);
        command.Parameters.AddWithValue("$now", now);
        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
            await InsertAuditAsync(connection, transaction, id, "CREATE_USER", operatorName,
                $"创建用户 {username}（{AppRoles.DisplayName(request.RoleCode)}）", cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return id;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            throw new InvalidOperationException("用户名已经存在。");
        }
    }

    public async Task<IReadOnlyList<object>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id,Username,DisplayName,RoleCode,IsEnabled,MustChangePassword,LastLoginAt,CreatedAt,UpdatedAt,Revision
            FROM Users ORDER BY CASE RoleCode WHEN 'ADMIN' THEN 1 WHEN 'APPROVER' THEN 2 WHEN 'EDITOR' THEN 3 ELSE 4 END, Username;
            """;
        var items = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new
            {
                id = reader.GetInt32(0), username = reader.GetString(1), displayName = reader.GetString(2),
                roleCode = reader.GetString(3), roleName = AppRoles.DisplayName(reader.GetString(3)),
                isEnabled = reader.GetInt32(4) == 1, mustChangePassword = reader.GetInt32(5) == 1,
                lastLoginAt = reader.IsDBNull(6) ? null : reader.GetString(6), createdAt = reader.GetString(7),
                updatedAt = reader.GetString(8), revision = reader.GetInt32(9)
            });
        }
        return items;
    }

    public async Task<bool> UpdateAsync(int id, UserUpdateRequest request, int currentUserId, string operatorName,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.DisplayName)) throw new ArgumentException("显示名称不能为空。");
        ValidateRole(request.RoleCode);

        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();

        var existing = await ReadForUpdateAsync(connection, transaction, id, cancellationToken)
            ?? throw new KeyNotFoundException("用户不存在。");
        if (existing.RoleCode == AppRoles.Admin && (!request.IsEnabled || request.RoleCode != AppRoles.Admin))
        {
            var adminCount = await CountEnabledAdminsAsync(connection, transaction, cancellationToken);
            if (adminCount <= 1) throw new InvalidOperationException("系统必须至少保留一个启用的管理员。");
        }
        if (id == currentUserId && !request.IsEnabled)
            throw new InvalidOperationException("不能停用当前登录账号。");

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE Users SET DisplayName=$displayName,RoleCode=$role,IsEnabled=$enabled,UpdatedAt=$now,Revision=Revision+1
            WHERE Id=$id AND Revision=$revision;
            """;
        command.Parameters.AddWithValue("$displayName", request.DisplayName.Trim());
        command.Parameters.AddWithValue("$role", request.RoleCode);
        command.Parameters.AddWithValue("$enabled", request.IsEnabled ? 1 : 0);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$revision", request.Revision);
        if (await command.ExecuteNonQueryAsync(cancellationToken) == 0) return false;
        await InsertAuditAsync(connection, transaction, id, "UPDATE_USER", operatorName,
            $"更新用户 {existing.Username}", cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task ResetPasswordAsync(int id, UserResetPasswordRequest request, string operatorName,
        CancellationToken cancellationToken = default)
    {
        var (hash, salt) = _passwords.HashPassword(request.NewPassword);
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE Users SET PasswordHash=$hash,PasswordSalt=$salt,MustChangePassword=$mustChange,
                UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id;
            """;
        command.Parameters.AddWithValue("$hash", hash);
        command.Parameters.AddWithValue("$salt", salt);
        command.Parameters.AddWithValue("$mustChange", request.MustChangePassword ? 1 : 0);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
            throw new KeyNotFoundException("用户不存在。");
        await InsertAuditAsync(connection, transaction, id, "RESET_PASSWORD", operatorName,
            "管理员重置用户密码", cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task ChangePasswordAsync(int userId, string currentPassword, string newPassword,
        CancellationToken cancellationToken = default)
    {
        var user = await FindByIdAsync(userId, cancellationToken) ?? throw new KeyNotFoundException("用户不存在。");
        if (!_passwords.Verify(currentPassword, user.PasswordHash, user.PasswordSalt))
            throw new InvalidOperationException("当前密码不正确。");
        var (hash, salt) = _passwords.HashPassword(newPassword);
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE Users SET PasswordHash=$hash,PasswordSalt=$salt,MustChangePassword=0,UpdatedAt=$now,Revision=Revision+1
            WHERE Id=$id;
            """;
        command.Parameters.AddWithValue("$hash", hash);
        command.Parameters.AddWithValue("$salt", salt);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", userId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task MarkLoginAsync(int id, CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "UPDATE Users SET LastLoginAt=$now,UpdatedAt=$now WHERE Id=$id";
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static UserRecord ReadUser(SqliteDataReader reader) => new(
        reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
        reader.GetString(5), reader.GetInt32(6) == 1, reader.GetInt32(7) == 1,
        reader.IsDBNull(8) ? null : reader.GetString(8), reader.GetInt32(9));

    private static async Task<UserRecord?> ReadForUpdateAsync(SqliteConnection connection, SqliteTransaction transaction,
        int id, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT Id,Username,DisplayName,PasswordHash,PasswordSalt,RoleCode,IsEnabled,MustChangePassword,LastLoginAt,Revision
            FROM Users WHERE Id=$id;
            """;
        command.Parameters.AddWithValue("$id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    private static async Task<int> CountEnabledAdminsAsync(SqliteConnection connection, SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*) FROM Users WHERE RoleCode='ADMIN' AND IsEnabled=1";
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
    }

    private static async Task InsertAuditAsync(SqliteConnection connection, SqliteTransaction transaction, int userId,
        string action, string operatorName, string summary, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt)
            VALUES('User',$id,$action,$operator,$summary,$now);
            """;
        command.Parameters.AddWithValue("$id", userId);
        command.Parameters.AddWithValue("$action", action);
        command.Parameters.AddWithValue("$operator", operatorName);
        command.Parameters.AddWithValue("$summary", summary);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string NormalizeUsername(string value)
    {
        var username = value.Trim();
        if (username.Length is < 3 or > 40 || username.Any(c => !(char.IsLetterOrDigit(c) || c is '.' or '_' or '-')))
            throw new ArgumentException("用户名需为3-40位字母、数字、点、下划线或短横线。");
        return username;
    }

    private static void ValidateRole(string roleCode)
    {
        if (!AppRoles.All.Contains(roleCode, StringComparer.Ordinal))
            throw new ArgumentException("用户角色无效。");
    }
}
