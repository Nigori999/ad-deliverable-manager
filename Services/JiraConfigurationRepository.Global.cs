using AdDeliverableManager.Models;
using Microsoft.AspNetCore.DataProtection;

namespace AdDeliverableManager.Services;

public sealed partial class JiraConfigurationRepository
{
    public async Task<object> GetGlobalConfigurationViewAsync(CancellationToken ct = default)
    {
        var value = await GetGlobalConnectionAsync(ct);
        return value is null
            ? new { configured = false, baseUrl = "", username = "", hasPassword = false, updatedAt = (string?)null, revision = 0 }
            : new { configured = true, baseUrl = value.BaseUrl, username = value.Username, hasPassword = true, updatedAt = (string?)value.UpdatedAt, revision = value.Revision };
    }

    public async Task<JiraGlobalConnectionDefinition?> GetGlobalConnectionAsync(CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT BaseUrl,Username,PasswordCipher,UpdatedAt,Revision FROM JiraGlobalConfiguration WHERE Id=1";
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        try
        {
            return new JiraGlobalConnectionDefinition(reader.GetString(0), reader.GetString(1), _protector.Unprotect(reader.GetString(2)), reader.GetString(3), reader.GetInt32(4));
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Jira密码无法解密，请在“基础设置”中重新保存连接配置。", ex);
        }
    }

    public async Task<JiraGlobalConnectionDefinition> RequireGlobalConnectionAsync(CancellationToken ct = default) =>
        await GetGlobalConnectionAsync(ct) ?? throw new InvalidOperationException("尚未配置Jira连接，请先在“系统管理 / 基础设置”中完成配置。");

    public async Task SaveGlobalConfigurationAsync(JiraGlobalConfigurationRequest request, string operatorName, CancellationToken ct = default)
    {
        var normalized = ValidateGlobalConfiguration(request);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        string? existingCipher = null;
        int existingRevision = 0;
        await using (var read = connection.CreateCommand())
        {
            read.Transaction = transaction;
            read.CommandText = "SELECT PasswordCipher,Revision FROM JiraGlobalConfiguration WHERE Id=1";
            await using var reader = await read.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct)) { existingCipher = reader.GetString(0); existingRevision = reader.GetInt32(1); }
        }
        if (existingCipher is not null && normalized.Revision != existingRevision)
            throw new InvalidOperationException("Jira连接配置已被其他人更新，请刷新页面后重试。");
        if (existingCipher is null && normalized.Revision != 0)
            throw new InvalidOperationException("Jira连接配置状态已变化，请刷新页面后重试。");
        if (string.IsNullOrEmpty(normalized.Password) && existingCipher is null)
            throw new ArgumentException("首次配置时必须填写Jira密码。");

        var cipher = string.IsNullOrEmpty(normalized.Password) ? existingCipher! : _protector.Protect(normalized.Password);
        var now = DateTime.UtcNow.ToString("O");
        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = existingCipher is null
                ? "INSERT INTO JiraGlobalConfiguration(Id,BaseUrl,Username,PasswordCipher,UpdatedBy,UpdatedAt,Revision) VALUES(1,$url,$username,$password,$operator,$now,1)"
                : "UPDATE JiraGlobalConfiguration SET BaseUrl=$url,Username=$username,PasswordCipher=$password,UpdatedBy=$operator,UpdatedAt=$now,Revision=Revision+1 WHERE Id=1";
            command.Parameters.AddWithValue("$url", normalized.BaseUrl);
            command.Parameters.AddWithValue("$username", normalized.Username);
            command.Parameters.AddWithValue("$password", cipher);
            command.Parameters.AddWithValue("$operator", operatorName);
            command.Parameters.AddWithValue("$now", now);
            await command.ExecuteNonQueryAsync(ct);
        }
        await using (var audit = connection.CreateCommand())
        {
            audit.Transaction = transaction;
            audit.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES('JiraGlobalConfiguration',1,$action,$operator,'更新Jira全局连接配置',$now)";
            audit.Parameters.AddWithValue("$action", existingCipher is null ? "CREATE" : "UPDATE");
            audit.Parameters.AddWithValue("$operator", operatorName);
            audit.Parameters.AddWithValue("$now", now);
            await audit.ExecuteNonQueryAsync(ct);
        }
        await transaction.CommitAsync(ct);
    }

    private static JiraGlobalConfigurationRequest ValidateGlobalConfiguration(JiraGlobalConfigurationRequest request)
    {
        if (request is null) throw new ArgumentException("请填写Jira连接配置。");
        if (!Uri.TryCreate(request.BaseUrl?.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ArgumentException("Jira地址必须是完整的HTTP或HTTPS地址。");
        if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            throw new ArgumentException("Jira地址不能包含账号、查询参数或锚点。");
        var username = request.Username?.Trim() ?? "";
        if (username.Length is < 1 or > 150) throw new ArgumentException("Jira账号长度应为1至150个字符。");
        var password = request.Password ?? "";
        if (password.Length > 500) throw new ArgumentException("Jira密码长度不能超过500个字符。");
        return new JiraGlobalConfigurationRequest
        {
            BaseUrl = uri.GetLeftPart(UriPartial.Path).TrimEnd('/'), Username = username, Password = password, Revision = request.Revision
        };
    }
}

public sealed record JiraGlobalConnectionDefinition(string BaseUrl, string Username, string Password, string UpdatedAt, int Revision);
