using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;
using System.Text.RegularExpressions;

namespace AdDeliverableManager.Services;

public sealed partial class DictionaryRepository
{
    public const string JiraIssueCategoryCode = "JIRA_ISSUE_CATEGORY";

    private static async Task<Dictionary<int, List<JiraCategoryMapping>>> ReadJiraMappingsAsync(SqliteConnection connection, CancellationToken ct, SqliteTransaction? transaction = null)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT DictionaryItemId,FieldId,MatchType,MatchValue FROM JiraCategoryMappings ORDER BY FieldId,MatchType,MatchValue";
        var result = new Dictionary<int, List<JiraCategoryMapping>>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var id = reader.GetInt32(0);
            if (!result.TryGetValue(id, out var mappings)) result[id] = mappings = [];
            mappings.Add(new(reader.GetString(1), reader.GetString(2), reader.GetString(3)));
        }
        return result;
    }

    public async Task<IReadOnlyList<JiraIssueCategory>> ListJiraCategoriesAsync(CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        // Read the hierarchy and its mappings from the same database snapshot.
        using var transaction = connection.BeginTransaction();
        var mappings = await ReadJiraMappingsAsync(connection, ct, transaction);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT i.Id,i.ItemName,i.ParentItemId,i.SortOrder FROM DictionaryItems i
            JOIN DictionaryTypes d ON d.Id=i.DictionaryTypeId
            WHERE d.Code='JIRA_ISSUE_CATEGORY' AND d.IsEnabled=1 AND i.IsEnabled=1
            ORDER BY i.SortOrder,i.ItemName;
            """;
        var result = new List<JiraIssueCategory>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            result.Add(new(reader.GetInt32(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetInt32(2),
                reader.GetInt32(3), mappings.GetValueOrDefault(reader.GetInt32(0)) ?? []));
        return result;
    }

    public static int? ResolveJiraCategory(IReadOnlyList<JiraIssueCategory> categories, string fieldId, string? optionId, string optionName)
    {
        // An explicit field/option ID takes priority; names match exactly, never by substring.
        foreach (var match in new[] { new JiraCategoryMapping(fieldId, "ID", optionId ?? ""),
                     new JiraCategoryMapping(fieldId, "NAME", optionName), new JiraCategoryMapping("", "NAME", optionName) })
        {
            if (match.MatchValue.Length == 0) continue;
            var category = categories.FirstOrDefault(x => x.Mappings.Contains(match));
            if (category is not null) return category.Id;
        }
        return null;
    }

    private static async Task SaveJiraMappingsAsync(SqliteConnection connection, SqliteTransaction transaction,
        string dictionaryCode, int itemId, JiraCategoryMapping[]? mappings, CancellationToken ct)
    {
        mappings ??= [];
        if (dictionaryCode != JiraIssueCategoryCode)
        {
            if (mappings.Length > 0) throw new ArgumentException("仅JIRA问题分类字典支持配置JIRA选项映射。");
            return;
        }
        if (mappings.Length > 100) throw new ArgumentException("每个分类最多配置100条选项映射。");
        var normalized = new HashSet<JiraCategoryMapping>();
        foreach (var mapping in mappings)
        {
            if (mapping is null) throw new ArgumentException("JIRA选项映射不能为空。");
            var field = (mapping.FieldId ?? "").Trim();
            var type = (mapping.MatchType ?? "").Trim().ToUpperInvariant();
            var value = (mapping.MatchValue ?? "").Trim();
            if (field.Length > 100 || (field.Length > 0 && !Regex.IsMatch(field, @"^[A-Za-z][A-Za-z0-9_]*$")))
                throw new ArgumentException("JIRA字段ID格式不正确，例如 customfield_12345。");
            if (type is not ("ID" or "NAME") || value.Length is 0 or > 200)
                throw new ArgumentException("请选择映射方式并填写选项ID或完整名称（最多200个字符）。");
            if (type == "ID" && (field.Length == 0 || !Regex.IsMatch(value, @"^[0-9]+$")))
                throw new ArgumentException("按选项ID匹配时，必须填写字段ID与数字形式的选项ID。");
            if (!normalized.Add(new(field, type, value))) throw new ArgumentException("存在重复的JIRA选项映射，请删除重复行。");
        }
        await using var delete = connection.CreateCommand();
        delete.Transaction = transaction;
        delete.CommandText = "DELETE FROM JiraCategoryMappings WHERE DictionaryItemId=$id";
        delete.Parameters.AddValue("$id", itemId);
        await delete.ExecuteNonQueryAsync(ct);
        foreach (var mapping in normalized)
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO JiraCategoryMappings(DictionaryItemId,FieldId,MatchType,MatchValue) VALUES($id,$field,$type,$value)";
            insert.Parameters.AddValue("$id", itemId);
            insert.Parameters.AddValue("$field", mapping.FieldId);
            insert.Parameters.AddValue("$type", mapping.MatchType);
            insert.Parameters.AddValue("$value", mapping.MatchValue);
            try { await insert.ExecuteNonQueryAsync(ct); }
            catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
            { throw new InvalidOperationException("相同字段下的该选项映射已被其他分类使用，请先解除原映射。"); }
        }
    }
}
