using System.Text.Json;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class JiraReviewRepository
{
    public const string ReasonDictionary = "JIRA_OVERTIME_REASON";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly DatabaseService _database;
    private readonly JiraConfigurationRepository _configuration;
    private readonly DictionaryRepository _dictionaries;

    public JiraReviewRepository(DatabaseService database, JiraConfigurationRepository configuration, DictionaryRepository dictionaries)
    {
        _database = database;
        _configuration = configuration;
        _dictionaries = dictionaries;
    }

    public async Task<object> GetOptionsAsync(CancellationToken ct) =>
        new { categories = await _dictionaries.ListItemsAsync(ReasonDictionary, null, ct) };

    public async Task<IReadOnlyList<JiraReviewRecord>> ListAsync(CancellationToken ct)
    {
        var source = await _configuration.RequireGlobalConnectionAsync(ct);
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT r.Id,r.SnapshotJson,r.Reason,r.ResponsiblePerson,r.CategoryItemId,d.ItemName,
                   r.CreatedBy,r.CreatedAt,r.UpdatedBy,r.UpdatedAt,r.Revision
            FROM JiraClosureReviews r JOIN DictionaryItems d ON d.Id=r.CategoryItemId
            WHERE r.JiraBaseUrl=$source ORDER BY r.UpdatedAt DESC,r.Id DESC
            """;
        command.Parameters.AddWithValue("$source", source.BaseUrl);
        var result = new List<JiraReviewRecord>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            result.Add(new(reader.GetInt32(0), JsonSerializer.Deserialize<JiraReviewSnapshot>(reader.GetString(1), JsonOptions)!,
                reader.GetString(2), reader.GetString(3), reader.GetInt32(4), reader.GetString(5), reader.GetString(6),
                reader.GetString(7), reader.GetString(8), reader.GetString(9), reader.GetInt32(10)));
        return result;
    }

    public async Task<int> CreateAsync(JiraReviewSnapshot snapshot, JiraReviewRequest request, string actor, CancellationToken ct)
    {
        Validate(request);
        var source = await _configuration.RequireGlobalConnectionAsync(ct);
        if (source.BaseUrl != snapshot.JiraBaseUrl) throw new InvalidOperationException("Jira连接已变化，请重新分析后再复盘。");
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await ValidateCategoryAsync(connection, transaction, request.CategoryItemId, ct);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO JiraClosureReviews(JiraBaseUrl,IssueId,ProjectKey,IssueKey,SnapshotJson,Reason,ResponsiblePerson,
                CategoryItemId,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision)
            VALUES($source,$issueId,$project,$key,$snapshot,$reason,$person,$category,$actor,$now,$actor,$now,1)
            RETURNING Id
            """;
        command.Parameters.AddWithValue("$source", source.BaseUrl);
        command.Parameters.AddWithValue("$issueId", snapshot.IssueId);
        command.Parameters.AddWithValue("$project", snapshot.ProjectKey);
        command.Parameters.AddWithValue("$key", snapshot.Key);
        command.Parameters.AddWithValue("$snapshot", JsonSerializer.Serialize(snapshot, JsonOptions));
        AddEditableParameters(command, request, actor);
        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(ct));
            await AuditAsync(connection, transaction, id, "CREATE", actor, $"复盘 {snapshot.Key}", ct);
            await transaction.CommitAsync(ct);
            return id;
        }
        catch (SqliteException ex) when (ex.SqliteExtendedErrorCode == 2067)
        {
            throw new InvalidOperationException("该问题已保存复盘，请刷新后查看或编辑现有记录。", ex);
        }
    }

    public async Task UpdateAsync(int id, JiraReviewRequest request, string actor, CancellationToken ct)
    {
        Validate(request);
        var source = await _configuration.RequireGlobalConnectionAsync(ct);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await ValidateCategoryAsync(connection, transaction, request.CategoryItemId, ct);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE JiraClosureReviews SET Reason=$reason,ResponsiblePerson=$person,CategoryItemId=$category,
                UpdatedBy=$actor,UpdatedAt=$now,Revision=Revision+1
            WHERE Id=$id AND JiraBaseUrl=$source AND Revision=$revision
            """;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$source", source.BaseUrl);
        command.Parameters.AddWithValue("$revision", request.Revision);
        AddEditableParameters(command, request, actor);
        if (await command.ExecuteNonQueryAsync(ct) != 1)
            throw new InvalidOperationException("复盘已被修改、删除或不属于当前Jira来源，请刷新后重试。");
        await AuditAsync(connection, transaction, id, "UPDATE", actor, "更新超期复盘原因与责任信息", ct);
        await transaction.CommitAsync(ct);
    }

    public async Task DeleteAsync(int id, int revision, string actor, CancellationToken ct)
    {
        var source = await _configuration.RequireGlobalConnectionAsync(ct);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM JiraClosureReviews WHERE Id=$id AND JiraBaseUrl=$source AND Revision=$revision";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$source", source.BaseUrl);
        command.Parameters.AddWithValue("$revision", revision);
        if (await command.ExecuteNonQueryAsync(ct) != 1)
            throw new InvalidOperationException("复盘已被修改、删除或不属于当前Jira来源，请刷新后重试。");
        await AuditAsync(connection, transaction, id, "DELETE", actor, "删除超期复盘记录", ct);
        await transaction.CommitAsync(ct);
    }

    public static void Validate(JiraReviewRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Trim().Length > 4000)
            throw new ArgumentException("请填写处理超时原因，最多4000字。");
        if (string.IsNullOrWhiteSpace(request.ResponsiblePerson) || request.ResponsiblePerson.Trim().Length > 150)
            throw new ArgumentException("请填写责任人，最多150字。");
        if (request.CategoryItemId <= 0) throw new ArgumentException("请选择超时原因分类。");
    }

    private static void AddEditableParameters(SqliteCommand command, JiraReviewRequest request, string actor)
    {
        command.Parameters.AddWithValue("$reason", request.Reason.Trim());
        command.Parameters.AddWithValue("$person", request.ResponsiblePerson.Trim());
        command.Parameters.AddWithValue("$category", request.CategoryItemId);
        command.Parameters.AddWithValue("$actor", actor);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
    }

    private static async Task ValidateCategoryAsync(SqliteConnection connection, SqliteTransaction transaction, int id, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT COUNT(*) FROM DictionaryItems i JOIN DictionaryTypes d ON d.Id=i.DictionaryTypeId
            WHERE i.Id=$id AND d.Code=$code AND i.IsEnabled=1 AND d.IsEnabled=1
            """;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$code", ReasonDictionary);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) != 1)
            throw new ArgumentException("超时原因分类无效或已停用，请重新选择。");
    }

    private static async Task AuditAsync(SqliteConnection connection, SqliteTransaction transaction, int id, string action, string actor, string summary, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES('JiraClosureReview',$id,$action,$actor,$summary,$now)";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$action", action);
        command.Parameters.AddWithValue("$actor", actor);
        command.Parameters.AddWithValue("$summary", summary);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct);
    }
}
