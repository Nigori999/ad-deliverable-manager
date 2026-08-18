using System.Text.RegularExpressions;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class DictionaryRepository
{
    public const string DeliverableCategory = "DELIVERABLE_CATEGORY";
    public const string ScopeNone = "NONE";
    public const string ScopeDeliverableType = "DELIVERABLE_TYPE";

    private static readonly Regex CodePattern = new("^[A-Z0-9_]+$", RegexOptions.Compiled);
    private readonly DatabaseService _database;

    public DictionaryRepository(DatabaseService database) => _database = database;

    public async Task<IReadOnlyList<object>> ListTypesAsync(CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id,Code,Name,Description,ScopeMode,IsSystem,SortOrder,IsEnabled
            FROM DictionaryTypes WHERE IsEnabled=1 ORDER BY SortOrder,Name;
            """;
        var result = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            result.Add(new
            {
                id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2),
                description = reader.GetNullableString(3), scopeMode = reader.GetString(4),
                isSystem = reader.GetInt32(5) == 1, sortOrder = reader.GetInt32(6), isEnabled = reader.GetInt32(7) == 1
            });
        }
        return result;
    }

    public async Task<object?> GetTypeAsync(string code, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        return await ReadTypeAsync(connection, NormalizeCode(code), ct);
    }

    public async Task<IReadOnlyList<object>> ListItemsAsync(string dictionaryCode, string? scopeValue = null, CancellationToken ct = default)
    {
        var code = NormalizeCode(dictionaryCode);
        await using var connection = await _database.OpenConnectionAsync(ct);
        var type = await ReadTypeInfoAsync(connection, code, ct) ?? throw new KeyNotFoundException("字典类型不存在或已停用。");
        var scope = NormalizeScopeValue(type.ScopeMode, scopeValue);

        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT i.Id,i.ItemCode,i.ItemName,i.ScopeType,i.ScopeValue,i.ParentItemId,i.SortOrder,i.Remark,i.IsEnabled,
                   d.Code,d.Name,d.ScopeMode
            FROM DictionaryItems i JOIN DictionaryTypes d ON d.Id=i.DictionaryTypeId
            WHERE d.Id=$typeId AND i.IsEnabled=1
              AND ($scopeMode='NONE' OR i.ScopeValue=$scopeValue)
            ORDER BY i.SortOrder,i.ItemName;
            """;
        command.Parameters.AddWithValue("$typeId", type.Id);
        command.Parameters.AddWithValue("$scopeMode", type.ScopeMode);
        command.Parameters.AddWithValue("$scopeValue", scope);
        var items = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            items.Add(new
            {
                id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2),
                scopeType = reader.GetString(3), scopeValue = reader.GetString(4),
                parentItemId = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5), sortOrder = reader.GetInt32(6),
                remark = reader.GetNullableString(7), isEnabled = reader.GetInt32(8) == 1,
                dictionaryCode = reader.GetString(9), dictionaryName = reader.GetString(10), scopeMode = reader.GetString(11)
            });
        }
        return items;
    }

    public async Task<int> CreateTypeAsync(DictionaryTypeRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateTypeRequest(request);
        var code = NormalizeCode(request.Code);
        var scopeMode = NormalizeScopeMode(request.ScopeMode);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO DictionaryTypes(Code,Name,Description,ScopeMode,IsSystem,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
            VALUES($code,$name,$description,$scopeMode,0,$sort,1,$now,$now); SELECT last_insert_rowid();
            """;
        command.Parameters.AddValue("$code", code);
        command.Parameters.AddValue("$name", request.Name.Trim());
        command.Parameters.AddValue("$description", request.Description);
        command.Parameters.AddValue("$scopeMode", scopeMode);
        command.Parameters.AddValue("$sort", request.SortOrder);
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(ct));
            await InsertAuditAsync(connection, transaction, "DictionaryType", id, "CREATE", operatorName, $"新增字典类型 {code}", ct);
            await transaction.CommitAsync(ct);
            return id;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            throw new InvalidOperationException("字典编码或名称已存在。");
        }
    }

    public async Task UpdateTypeAsync(int id, DictionaryTypeRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateTypeRequest(request);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var current = await ReadTypeInfoAsync(connection, id, transaction, ct) ?? throw new KeyNotFoundException("字典类型不存在或已停用。");
        var code = NormalizeCode(request.Code);
        var scopeMode = NormalizeScopeMode(request.ScopeMode);
        if (current.IsSystem && (!string.Equals(code, current.Code, StringComparison.OrdinalIgnoreCase) || !string.Equals(scopeMode, current.ScopeMode, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException("系统字典不能修改字典编码或作用域模式。");
        if (!string.Equals(scopeMode, current.ScopeMode, StringComparison.OrdinalIgnoreCase) && await CountItemsAsync(connection, transaction, id, ct) > 0)
            throw new InvalidOperationException("该字典已有字典项，不能修改作用域模式。");

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "UPDATE DictionaryTypes SET Code=$code,Name=$name,Description=$description,ScopeMode=$scopeMode,SortOrder=$sort,UpdatedAt=$now WHERE Id=$id AND IsEnabled=1";
        command.Parameters.AddValue("$code", code); command.Parameters.AddValue("$name", request.Name.Trim());
        command.Parameters.AddValue("$description", request.Description); command.Parameters.AddValue("$scopeMode", scopeMode);
        command.Parameters.AddValue("$sort", request.SortOrder); command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O")); command.Parameters.AddValue("$id", id);
        try
        {
            if (await command.ExecuteNonQueryAsync(ct) == 0) throw new KeyNotFoundException("字典类型不存在或已停用。");
            await InsertAuditAsync(connection, transaction, "DictionaryType", id, "UPDATE", operatorName, $"修改字典类型 {code}", ct);
            await transaction.CommitAsync(ct);
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            throw new InvalidOperationException("字典编码或名称已存在。");
        }
    }

    public async Task DeleteTypeAsync(int id, string operatorName, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var current = await ReadTypeInfoAsync(connection, id, transaction, ct) ?? throw new KeyNotFoundException("字典类型不存在或已停用。");
        if (current.IsSystem) throw new InvalidOperationException("系统字典不能删除。");
        if (await CountItemsAsync(connection, transaction, id, ct) > 0) throw new InvalidOperationException("该字典仍包含字典项，请先删除字典项。");
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "DELETE FROM DictionaryTypes WHERE Id=$id AND IsSystem=0"; command.Parameters.AddValue("$id", id);
        if (await command.ExecuteNonQueryAsync(ct) == 0) throw new InvalidOperationException("字典类型状态已变化，请刷新后重试。");
        await InsertAuditAsync(connection, transaction, "DictionaryType", id, "DELETE", operatorName, $"删除字典类型 {current.Code}", ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<int> CreateItemAsync(string dictionaryCode, DictionaryItemRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateItemRequest(request);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var type = await ReadTypeInfoAsync(connection, NormalizeCode(dictionaryCode), transaction, ct) ?? throw new KeyNotFoundException("字典类型不存在或已停用。");
        var scopeValue = await ValidateScopeAsync(connection, transaction, type.ScopeMode, request.ScopeValue, ct);
        await ValidateParentAsync(connection, transaction, type.Id, request.ParentItemId, scopeValue, ct);
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,ParentItemId,SortOrder,IsEnabled,Remark,CreatedAt,UpdatedAt)
            VALUES($typeId,$code,$name,$scopeType,$scopeValue,$parent,$sort,1,$remark,$now,$now); SELECT last_insert_rowid();
            """;
        command.Parameters.AddValue("$typeId", type.Id); command.Parameters.AddValue("$code", NormalizeCode(request.ItemCode));
        command.Parameters.AddValue("$name", request.ItemName.Trim()); command.Parameters.AddValue("$scopeType", type.ScopeMode == ScopeNone ? "" : type.ScopeMode);
        command.Parameters.AddValue("$scopeValue", scopeValue); command.Parameters.AddValue("$parent", request.ParentItemId);
        command.Parameters.AddValue("$sort", request.SortOrder); command.Parameters.AddValue("$remark", request.Remark); command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(ct));
            await InsertAuditAsync(connection, transaction, "DictionaryItem", id, "CREATE", operatorName, $"新增字典项 {type.Code}/{NormalizeCode(request.ItemCode)}", ct);
            await transaction.CommitAsync(ct); return id;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            throw new InvalidOperationException("当前作用域下已存在相同的字典项编码或名称。");
        }
    }

    public async Task UpdateItemAsync(string dictionaryCode, int id, DictionaryItemRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateItemRequest(request);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var type = await ReadTypeInfoAsync(connection, NormalizeCode(dictionaryCode), transaction, ct) ?? throw new KeyNotFoundException("字典类型不存在或已停用。");
        var current = await ReadItemAsync(connection, transaction, type.Id, id, ct) ?? throw new KeyNotFoundException("字典项不存在或已删除。");
        var scopeValue = await ValidateScopeAsync(connection, transaction, type.ScopeMode, request.ScopeValue, ct);
        var code = NormalizeCode(request.ItemCode);
        var usage = await GetUsageCountAsync(connection, transaction, type.Code, id, ct);
        if (usage > 0 && (!string.Equals(current.Code, code, StringComparison.OrdinalIgnoreCase) || !string.Equals(current.ScopeValue, scopeValue, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException($"该字典项已被 {usage} 条业务数据使用，不能修改编码或作用域；可以修改名称、备注和排序。");
        await ValidateParentAsync(connection, transaction, type.Id, request.ParentItemId, scopeValue, ct, id);
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = """
            UPDATE DictionaryItems SET ItemCode=$code,ItemName=$name,ScopeType=$scopeType,ScopeValue=$scopeValue,
                ParentItemId=$parent,SortOrder=$sort,Remark=$remark,UpdatedAt=$now
            WHERE Id=$id AND DictionaryTypeId=$typeId AND IsEnabled=1;
            """;
        command.Parameters.AddValue("$code", code); command.Parameters.AddValue("$name", request.ItemName.Trim());
        command.Parameters.AddValue("$scopeType", type.ScopeMode == ScopeNone ? "" : type.ScopeMode); command.Parameters.AddValue("$scopeValue", scopeValue);
        command.Parameters.AddValue("$parent", request.ParentItemId); command.Parameters.AddValue("$sort", request.SortOrder);
        command.Parameters.AddValue("$remark", request.Remark); command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddValue("$id", id); command.Parameters.AddValue("$typeId", type.Id);
        try
        {
            if (await command.ExecuteNonQueryAsync(ct) == 0) throw new KeyNotFoundException("字典项不存在或已删除。");
            await InsertAuditAsync(connection, transaction, "DictionaryItem", id, "UPDATE", operatorName, $"修改字典项 {type.Code}/{code}", ct);
            await transaction.CommitAsync(ct);
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            throw new InvalidOperationException("当前作用域下已存在相同的字典项编码或名称。");
        }
    }

    public async Task DeleteItemAsync(string dictionaryCode, int id, string operatorName, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var type = await ReadTypeInfoAsync(connection, NormalizeCode(dictionaryCode), transaction, ct) ?? throw new KeyNotFoundException("字典类型不存在或已停用。");
        var item = await ReadItemAsync(connection, transaction, type.Id, id, ct) ?? throw new KeyNotFoundException("字典项不存在或已删除。");
        var usage = await GetUsageCountAsync(connection, transaction, type.Code, id, ct);
        if (usage > 0) throw new InvalidOperationException($"该字典项已被 {usage} 条业务数据使用，不能删除。可以修改名称，但应保留其业务编码。");
        await using var child = connection.CreateCommand(); child.Transaction = transaction;
        child.CommandText = "SELECT COUNT(*) FROM DictionaryItems WHERE ParentItemId=$id AND IsEnabled=1"; child.Parameters.AddValue("$id", id);
        if (Convert.ToInt32(await child.ExecuteScalarAsync(ct)) > 0) throw new InvalidOperationException("该字典项仍有下级字典项，不能删除。");
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "DELETE FROM DictionaryItems WHERE Id=$id AND DictionaryTypeId=$typeId"; command.Parameters.AddValue("$id", id); command.Parameters.AddValue("$typeId", type.Id);
        if (await command.ExecuteNonQueryAsync(ct) == 0) throw new InvalidOperationException("字典项状态已变化，请刷新后重试。");
        await InsertAuditAsync(connection, transaction, "DictionaryItem", id, "DELETE", operatorName, $"删除字典项 {type.Code}/{item.Code}", ct);
        await transaction.CommitAsync(ct);
    }

    private static void ValidateTypeRequest(DictionaryTypeRequest request)
    {
        var code = NormalizeCode(request.Code);
        if (code.Length > 50 || !CodePattern.IsMatch(code)) throw new ArgumentException("字典编码仅支持大写字母、数字和下划线，且不超过50个字符。");
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 50) throw new ArgumentException("字典名称不能为空且不超过50个字符。");
        if (request.SortOrder is < 0 or > 9999) throw new ArgumentException("排序值应在0到9999之间。");
        _ = NormalizeScopeMode(request.ScopeMode);
    }

    private static void ValidateItemRequest(DictionaryItemRequest request)
    {
        var code = NormalizeCode(request.ItemCode);
        if (code.Length > 50 || !CodePattern.IsMatch(code)) throw new ArgumentException("字典项编码仅支持大写字母、数字和下划线，且不超过50个字符。");
        if (string.IsNullOrWhiteSpace(request.ItemName) || request.ItemName.Trim().Length > 80) throw new ArgumentException("字典项名称不能为空且不超过80个字符。");
        if (request.SortOrder is < 0 or > 9999) throw new ArgumentException("排序值应在0到9999之间。");
    }

    private static string NormalizeCode(string? value) => (value ?? "").Trim().ToUpperInvariant().Replace('-', '_').Replace(' ', '_');
    private static string NormalizeScopeMode(string? value)
    {
        var mode = NormalizeCode(value);
        return mode switch { "" or ScopeNone => ScopeNone, ScopeDeliverableType => ScopeDeliverableType, _ => throw new ArgumentException("当前仅支持无作用域或交付物类型作用域。") };
    }
    private static string NormalizeScopeValue(string scopeMode, string? scopeValue) => scopeMode == ScopeNone ? "" : NormalizeCode(scopeValue);

    private static async Task<string> ValidateScopeAsync(SqliteConnection connection, SqliteTransaction transaction, string scopeMode, string? scopeValue, CancellationToken ct)
    {
        if (scopeMode == ScopeNone) return "";
        var value = NormalizeScopeValue(scopeMode, scopeValue);
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("请选择字典项作用域。");
        if (scopeMode == ScopeDeliverableType)
        {
            await using var command = connection.CreateCommand(); command.Transaction = transaction;
            command.CommandText = "SELECT COUNT(*) FROM DeliverableTypes WHERE TypeCode=$code AND IsEnabled=1"; command.Parameters.AddValue("$code", value);
            if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) == 0) throw new ArgumentException("所选交付物类型不存在或已停用。");
        }
        return value;
    }

    private static async Task ValidateParentAsync(SqliteConnection connection, SqliteTransaction transaction, int typeId, int? parentId, string scopeValue, CancellationToken ct, int? currentId = null)
    {
        if (!parentId.HasValue) return;
        if (currentId.HasValue && parentId.Value == currentId.Value) throw new ArgumentException("字典项不能将自己设置为上级。");
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*) FROM DictionaryItems WHERE Id=$id AND DictionaryTypeId=$typeId AND ScopeValue=$scope AND IsEnabled=1";
        command.Parameters.AddValue("$id", parentId.Value); command.Parameters.AddValue("$typeId", typeId); command.Parameters.AddValue("$scope", scopeValue);
        if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) == 0) throw new ArgumentException("上级字典项不存在、已删除或与当前作用域不一致。");
    }

    private static async Task<int> GetUsageCountAsync(SqliteConnection connection, SqliteTransaction transaction, string dictionaryCode, int itemId, CancellationToken ct)
    {
        if (!dictionaryCode.Equals(DeliverableCategory, StringComparison.OrdinalIgnoreCase)) return 0;
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*) FROM Deliverables WHERE CategoryId=$id"; command.Parameters.AddValue("$id", itemId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct));
    }

    private static async Task<int> CountItemsAsync(SqliteConnection connection, SqliteTransaction transaction, int typeId, CancellationToken ct)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*) FROM DictionaryItems WHERE DictionaryTypeId=$id AND IsEnabled=1"; command.Parameters.AddValue("$id", typeId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct));
    }

    private static async Task<object?> ReadTypeAsync(SqliteConnection connection, string code, CancellationToken ct)
    {
        var type = await ReadTypeInfoAsync(connection, code, ct);
        return type is null ? null : new { id = type.Id, code = type.Code, name = type.Name, description = type.Description, scopeMode = type.ScopeMode, isSystem = type.IsSystem, sortOrder = type.SortOrder };
    }

    private static async Task<TypeInfo?> ReadTypeInfoAsync(SqliteConnection connection, string code, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id,Code,Name,Description,ScopeMode,IsSystem,SortOrder FROM DictionaryTypes WHERE Code=$code AND IsEnabled=1"; command.Parameters.AddValue("$code", code);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? new TypeInfo(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetNullableString(3), reader.GetString(4), reader.GetInt32(5) == 1, reader.GetInt32(6)) : null;
    }

    private static async Task<TypeInfo?> ReadTypeInfoAsync(SqliteConnection connection, string code, SqliteTransaction transaction, CancellationToken ct)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT Id,Code,Name,Description,ScopeMode,IsSystem,SortOrder FROM DictionaryTypes WHERE Code=$code AND IsEnabled=1"; command.Parameters.AddValue("$code", code);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? new TypeInfo(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetNullableString(3), reader.GetString(4), reader.GetInt32(5) == 1, reader.GetInt32(6)) : null;
    }

    private static async Task<TypeInfo?> ReadTypeInfoAsync(SqliteConnection connection, int id, SqliteTransaction transaction, CancellationToken ct)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT Id,Code,Name,Description,ScopeMode,IsSystem,SortOrder FROM DictionaryTypes WHERE Id=$id AND IsEnabled=1"; command.Parameters.AddValue("$id", id);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? new TypeInfo(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetNullableString(3), reader.GetString(4), reader.GetInt32(5) == 1, reader.GetInt32(6)) : null;
    }

    private static async Task<ItemInfo?> ReadItemAsync(SqliteConnection connection, SqliteTransaction transaction, int typeId, int id, CancellationToken ct)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "SELECT ItemCode,ItemName,ScopeValue FROM DictionaryItems WHERE Id=$id AND DictionaryTypeId=$typeId AND IsEnabled=1";
        command.Parameters.AddValue("$id", id); command.Parameters.AddValue("$typeId", typeId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? new ItemInfo(reader.GetString(0), reader.GetString(1), reader.GetString(2)) : null;
    }

    private static async Task InsertAuditAsync(SqliteConnection connection, SqliteTransaction transaction, string entityType, int entityId, string actionType, string operatorName, string summary, CancellationToken ct)
    {
        await using var command = connection.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES($type,$id,$action,$operator,$summary,$now)";
        command.Parameters.AddValue("$type", entityType); command.Parameters.AddValue("$id", entityId); command.Parameters.AddValue("$action", actionType);
        command.Parameters.AddValue("$operator", operatorName); command.Parameters.AddValue("$summary", summary); command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct);
    }

    private sealed record TypeInfo(int Id, string Code, string Name, string? Description, string ScopeMode, bool IsSystem, int SortOrder);
    private sealed record ItemInfo(string Code, string Name, string ScopeValue);
}
