using System.Text.RegularExpressions;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class DictionaryRepository
{
    public const string DeliverableCategory = "DELIVERABLE_CATEGORY";
    public const string IssueDepartment = "ISSUE_DEPARTMENT";
    public const string IssueSource = "ISSUE_SOURCE";
    public const string IssueSeverity = "ISSUE_SEVERITY";
    public const string IssueStatus = "ISSUE_STATUS";
    public const string ScopeNone = "NONE";
    public const string ScopeDeliverableType = "DELIVERABLE_TYPE";
    public const string StructureFlat = "FLAT";
    public const string StructureTree = "TREE";

    private static readonly Regex CodePattern = new("^[A-Z0-9_]+$", RegexOptions.Compiled);
    private readonly DatabaseService _database;

    public DictionaryRepository(DatabaseService database) => _database = database;

    public async Task<IReadOnlyList<object>> ListTypesAsync(CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT d.Id,d.Code,d.Name,d.Description,d.ScopeMode,d.StructureMode,d.IsSystem,d.SortOrder,d.IsEnabled,
                   (SELECT COUNT(*) FROM DictionaryItems i WHERE i.DictionaryTypeId=d.Id AND i.IsEnabled=1)
            FROM DictionaryTypes d
            ORDER BY d.SortOrder,d.Name;
            """;
        var result = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            result.Add(new
            {
                id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2),
                description = reader.GetNullableString(3), scopeMode = reader.GetString(4),
                structureMode = reader.GetString(5), isSystem = reader.GetInt32(6) == 1,
                sortOrder = reader.GetInt32(7), isEnabled = reader.GetInt32(8) == 1,
                itemCount = reader.GetInt32(9)
            });
        }
        return result;
    }

    public async Task<IReadOnlyList<object>> ListDeliverableTypeScopesAsync(CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT TypeCode,TypeName FROM DeliverableTypes WHERE IsEnabled=1 ORDER BY SortOrder,TypeName";
        var result = new List<object>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) result.Add(new { code = reader.GetString(0), name = reader.GetString(1) });
        return result;
    }

    public async Task<object?> GetTypeAsync(string code, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        var type = await ReadTypeInfoAsync(connection, NormalizeCode(code), ct);
        if (type is null) return null;
        return ToResponse(type, await CountItemsAsync(connection, null, type.Id, ct));
    }

    public async Task<IReadOnlyList<object>> ListItemsAsync(string dictionaryCode, string? scopeValue = null, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        var type = await ReadTypeInfoAsync(connection, NormalizeCode(dictionaryCode), ct) ?? throw new KeyNotFoundException("字典不存在。");
        var scope = NormalizeScopeValue(type.ScopeMode, scopeValue);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT i.Id,i.ItemCode,i.ItemName,i.ScopeType,i.ScopeValue,i.ParentItemId,i.SortOrder,i.Remark,i.IsEnabled,
                   d.Code,d.Name,d.ScopeMode,
                   CASE d.Code
                       WHEN 'DELIVERABLE_CATEGORY' THEN (SELECT COUNT(*) FROM Deliverables x WHERE x.CategoryId=i.Id)
                       WHEN 'ISSUE_DEPARTMENT' THEN (SELECT COUNT(*) FROM IssueSnapshots x WHERE x.DepartmentItemId=i.Id)
                       WHEN 'ISSUE_SOURCE' THEN (SELECT COUNT(*) FROM IssueSnapshots x WHERE x.SourceItemId=i.Id)
                       WHEN 'ISSUE_SEVERITY' THEN (SELECT COUNT(*) FROM IssueSnapshots x WHERE x.SeverityItemId=i.Id)
                       WHEN 'ISSUE_STATUS' THEN (SELECT COUNT(*) FROM IssueSnapshotCounts x WHERE x.StatusItemId=i.Id)
                       ELSE 0 END,
                   (SELECT COUNT(*) FROM DictionaryItems child WHERE child.ParentItemId=i.Id AND child.IsEnabled=1)
            FROM DictionaryItems i JOIN DictionaryTypes d ON d.Id=i.DictionaryTypeId
            WHERE d.Id=$typeId AND i.IsEnabled=1 AND ($scopeMode='NONE' OR i.ScopeValue=$scopeValue)
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
                id = reader.GetInt32(0), value = reader.GetString(1), name = reader.GetString(2),
                scopeType = reader.GetString(3), scopeValue = reader.GetString(4),
                parentItemId = reader.IsDBNull(5) ? (int?)null : reader.GetInt32(5), sortOrder = reader.GetInt32(6),
                description = reader.GetNullableString(7), isEnabled = reader.GetInt32(8) == 1,
                dictionaryCode = reader.GetString(9), dictionaryName = reader.GetString(10), scopeMode = reader.GetString(11),
                usageCount = reader.GetInt32(12), childCount = reader.GetInt32(13)
            });
        }
        return items;
    }

    public async Task<int> CreateTypeAsync(DictionaryTypeRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateTypeRequest(request);
        var code = NormalizeCode(request.Code);
        var structureMode = NormalizeStructureMode(request.StructureMode);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO DictionaryTypes(Code,Name,Description,ScopeMode,StructureMode,IsSystem,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
            VALUES($code,$name,$description,'NONE',$structureMode,0,$sort,$enabled,$now,$now); SELECT last_insert_rowid();
            """;
        command.Parameters.AddValue("$code", code);
        command.Parameters.AddValue("$name", request.Name.Trim());
        command.Parameters.AddValue("$description", NormalizeOptionalText(request.Description));
        command.Parameters.AddValue("$structureMode", structureMode);
        command.Parameters.AddValue("$sort", request.SortOrder);
        command.Parameters.AddValue("$enabled", request.IsEnabled ? 1 : 0);
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(ct));
            await InsertAuditAsync(connection, transaction, "DictionaryType", id, "CREATE", operatorName, $"新增业务字典 {code}", ct);
            await transaction.CommitAsync(ct);
            return id;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19) { throw new InvalidOperationException("字典 Code 或字典名称已存在。"); }
    }

    public async Task UpdateTypeAsync(int id, DictionaryTypeRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateTypeRequest(request);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var current = await ReadTypeInfoAsync(connection, id, transaction, ct) ?? throw new KeyNotFoundException("字典不存在。");
        var code = NormalizeCode(request.Code);
        var structureMode = NormalizeStructureMode(request.StructureMode);
        var itemCount = await CountItemsAsync(connection, transaction, id, ct);
        if (current.IsSystem && !string.Equals(code, current.Code, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("系统级字典不能修改字典 Code。");
        if (current.IsSystem && !string.Equals(structureMode, current.StructureMode, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("系统级字典不能修改字典结构。");
        if (current.IsSystem && !request.IsEnabled) throw new InvalidOperationException("系统级字典参与核心业务，不能停用。");
        if (itemCount > 0 && !string.Equals(code, current.Code, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("该字典已包含字典项，不能修改作为稳定标识的字典 Code。");
        if (itemCount > 0 && !string.Equals(structureMode, current.StructureMode, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("该字典已包含字典项，不能切换字典结构。");

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "UPDATE DictionaryTypes SET Code=$code,Name=$name,Description=$description,StructureMode=$structureMode,SortOrder=$sort,IsEnabled=$enabled,UpdatedAt=$now WHERE Id=$id";
        command.Parameters.AddValue("$code", code);
        command.Parameters.AddValue("$name", request.Name.Trim());
        command.Parameters.AddValue("$description", NormalizeOptionalText(request.Description));
        command.Parameters.AddValue("$structureMode", structureMode);
        command.Parameters.AddValue("$sort", request.SortOrder);
        command.Parameters.AddValue("$enabled", current.IsSystem || request.IsEnabled ? 1 : 0);
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddValue("$id", id);
        try
        {
            if (await command.ExecuteNonQueryAsync(ct) == 0) throw new KeyNotFoundException("字典不存在。");
            await InsertAuditAsync(connection, transaction, "DictionaryType", id, "UPDATE", operatorName, $"修改字典 {code}，状态：{(current.IsSystem || request.IsEnabled ? "启用" : "停用")}", ct);
            await transaction.CommitAsync(ct);
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19) { throw new InvalidOperationException("字典 Code 或字典名称已存在。"); }
    }

    public async Task DeleteTypeAsync(int id, string operatorName, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var current = await ReadTypeInfoAsync(connection, id, transaction, ct) ?? throw new KeyNotFoundException("字典不存在。");
        if (current.IsSystem) throw new InvalidOperationException("系统级字典不能删除。");
        if (await CountItemsAsync(connection, transaction, id, ct) > 0) throw new InvalidOperationException("该字典仍包含字典项，请先删除全部字典项。");
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM DictionaryTypes WHERE Id=$id AND IsSystem=0";
        command.Parameters.AddValue("$id", id);
        if (await command.ExecuteNonQueryAsync(ct) == 0) throw new InvalidOperationException("字典状态已变化，请刷新后重试。");
        await InsertAuditAsync(connection, transaction, "DictionaryType", id, "DELETE", operatorName, $"删除业务字典 {current.Code}", ct);
        await transaction.CommitAsync(ct);
    }

    public async Task<int> CreateItemAsync(string dictionaryCode, DictionaryItemRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateItemRequest(request);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var type = await ReadTypeInfoAsync(connection, NormalizeCode(dictionaryCode), transaction, ct) ?? throw new KeyNotFoundException("字典不存在。");
        EnsureDictionaryEnabled(type);
        var scopeValue = await ValidateScopeAsync(connection, transaction, type.ScopeMode, request.ScopeValue, ct);
        await ValidateParentAsync(connection, transaction, type, request.ParentItemId, scopeValue, ct);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,ParentItemId,SortOrder,IsEnabled,Remark,CreatedAt,UpdatedAt)
            VALUES($typeId,$value,$name,$scopeType,$scopeValue,$parent,$sort,1,$description,$now,$now); SELECT last_insert_rowid();
            """;
        command.Parameters.AddValue("$typeId", type.Id);
        command.Parameters.AddValue("$value", NormalizeCode(request.ItemCode));
        command.Parameters.AddValue("$name", request.ItemName.Trim());
        command.Parameters.AddValue("$scopeType", type.ScopeMode == ScopeNone ? "" : type.ScopeMode);
        command.Parameters.AddValue("$scopeValue", scopeValue);
        command.Parameters.AddValue("$parent", request.ParentItemId);
        command.Parameters.AddValue("$sort", request.SortOrder);
        command.Parameters.AddValue("$description", NormalizeOptionalText(request.Description));
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        try
        {
            var id = Convert.ToInt32(await command.ExecuteScalarAsync(ct));
            await InsertAuditAsync(connection, transaction, "DictionaryItem", id, "CREATE", operatorName, $"新增字典项 {type.Code}/{NormalizeCode(request.ItemCode)}", ct);
            await transaction.CommitAsync(ct);
            return id;
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19) { throw new InvalidOperationException("当前作用域下已存在相同的字典项值或名称。"); }
    }

    public async Task UpdateItemAsync(string dictionaryCode, int id, DictionaryItemRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateItemRequest(request);
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var type = await ReadTypeInfoAsync(connection, NormalizeCode(dictionaryCode), transaction, ct) ?? throw new KeyNotFoundException("字典不存在。");
        EnsureDictionaryEnabled(type);
        var current = await ReadItemAsync(connection, transaction, type.Id, id, ct) ?? throw new KeyNotFoundException("字典项不存在或已删除。");
        var scopeValue = await ValidateScopeAsync(connection, transaction, type.ScopeMode, request.ScopeValue, ct);
        var value = NormalizeCode(request.ItemCode);
        var usage = await GetUsageCountAsync(connection, transaction, type.Code, id, ct);
        if (usage > 0 && (!string.Equals(current.Value, value, StringComparison.OrdinalIgnoreCase) || !string.Equals(current.ScopeValue, scopeValue, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException($"该字典项已被 {usage} 条业务数据使用，不能修改字典项值或作用域；可以修改名称、描述和排序。");
        await ValidateParentAsync(connection, transaction, type, request.ParentItemId, scopeValue, ct, id);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "UPDATE DictionaryItems SET ItemCode=$value,ItemName=$name,ScopeType=$scopeType,ScopeValue=$scopeValue,ParentItemId=$parent,SortOrder=$sort,Remark=$description,UpdatedAt=$now WHERE Id=$id AND DictionaryTypeId=$typeId AND IsEnabled=1";
        command.Parameters.AddValue("$value", value);
        command.Parameters.AddValue("$name", request.ItemName.Trim());
        command.Parameters.AddValue("$scopeType", type.ScopeMode == ScopeNone ? "" : type.ScopeMode);
        command.Parameters.AddValue("$scopeValue", scopeValue);
        command.Parameters.AddValue("$parent", request.ParentItemId);
        command.Parameters.AddValue("$sort", request.SortOrder);
        command.Parameters.AddValue("$description", NormalizeOptionalText(request.Description));
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        command.Parameters.AddValue("$id", id);
        command.Parameters.AddValue("$typeId", type.Id);
        try
        {
            if (await command.ExecuteNonQueryAsync(ct) == 0) throw new KeyNotFoundException("字典项不存在或已删除。");
            await InsertAuditAsync(connection, transaction, "DictionaryItem", id, "UPDATE", operatorName, $"修改字典项 {type.Code}/{value}", ct);
            await transaction.CommitAsync(ct);
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19) { throw new InvalidOperationException("当前作用域下已存在相同的字典项值或名称。"); }
    }

    public async Task DeleteItemAsync(string dictionaryCode, int id, string operatorName, CancellationToken ct = default)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var type = await ReadTypeInfoAsync(connection, NormalizeCode(dictionaryCode), transaction, ct) ?? throw new KeyNotFoundException("字典不存在。");
        EnsureDictionaryEnabled(type);
        var item = await ReadItemAsync(connection, transaction, type.Id, id, ct) ?? throw new KeyNotFoundException("字典项不存在或已删除。");
        var usage = await GetUsageCountAsync(connection, transaction, type.Code, id, ct);
        if (usage > 0) throw new InvalidOperationException($"该字典项已被 {usage} 条业务数据使用，不能删除。可以修改名称，但应保留其业务值。");
        await using var child = connection.CreateCommand();
        child.Transaction = transaction;
        child.CommandText = "SELECT COUNT(*) FROM DictionaryItems WHERE ParentItemId=$id AND IsEnabled=1";
        child.Parameters.AddValue("$id", id);
        if (Convert.ToInt32(await child.ExecuteScalarAsync(ct)) > 0) throw new InvalidOperationException("该字典项仍有下级字典项，请先处理下级项。");
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM DictionaryItems WHERE Id=$id AND DictionaryTypeId=$typeId";
        command.Parameters.AddValue("$id", id);
        command.Parameters.AddValue("$typeId", type.Id);
        if (await command.ExecuteNonQueryAsync(ct) == 0) throw new InvalidOperationException("字典项状态已变化，请刷新后重试。");
        await InsertAuditAsync(connection, transaction, "DictionaryItem", id, "DELETE", operatorName, $"删除字典项 {type.Code}/{item.Value}", ct);
        await transaction.CommitAsync(ct);
    }

    private static void ValidateTypeRequest(DictionaryTypeRequest request)
    {
        var code = NormalizeCode(request.Code);
        if (code.Length > 50 || !CodePattern.IsMatch(code)) throw new ArgumentException("字典 Code 仅支持大写字母、数字和下划线，且不超过50个字符。");
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Trim().Length > 50) throw new ArgumentException("字典名称不能为空且不超过50个字符。");
        if ((request.Description ?? "").Trim().Length > 500) throw new ArgumentException("字典描述不能超过500个字符。");
        if (request.SortOrder is < 0 or > 9999) throw new ArgumentException("排序值应在0到9999之间。");
        _ = NormalizeStructureMode(request.StructureMode);
    }

    private static void ValidateItemRequest(DictionaryItemRequest request)
    {
        var value = NormalizeCode(request.ItemCode);
        if (value.Length > 50 || !CodePattern.IsMatch(value)) throw new ArgumentException("字典项值仅支持大写字母、数字和下划线，且不超过50个字符。");
        if (string.IsNullOrWhiteSpace(request.ItemName) || request.ItemName.Trim().Length > 80) throw new ArgumentException("字典项名称不能为空且不超过80个字符。");
        if ((request.Description ?? "").Trim().Length > 500) throw new ArgumentException("字典项描述不能超过500个字符。");
        if (request.SortOrder is < 0 or > 9999) throw new ArgumentException("排序值应在0到9999之间。");
    }

    private static string NormalizeCode(string? value) => (value ?? "").Trim().ToUpperInvariant().Replace('-', '_').Replace(' ', '_');
    private static string NormalizeOptionalText(string? value) => (value ?? "").Trim();
    private static string NormalizeStructureMode(string? value) => NormalizeCode(value) switch
    {
        "" or StructureFlat => StructureFlat,
        StructureTree => StructureTree,
        _ => throw new ArgumentException("字典结构仅支持平级结构或树形结构。")
    };
    private static string NormalizeScopeValue(string scopeMode, string? scopeValue) => scopeMode == ScopeNone ? "" : NormalizeCode(scopeValue);

    private static void EnsureDictionaryEnabled(TypeInfo type)
    {
        if (!type.IsEnabled) throw new InvalidOperationException("该字典已停用，请先启用字典后再维护字典项。");
    }

    private static async Task<string> ValidateScopeAsync(SqliteConnection connection, SqliteTransaction transaction, string scopeMode, string? scopeValue, CancellationToken ct)
    {
        if (scopeMode == ScopeNone) return "";
        var value = NormalizeScopeValue(scopeMode, scopeValue);
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException("请选择字典项作用域。");
        if (scopeMode == ScopeDeliverableType)
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT COUNT(*) FROM DeliverableTypes WHERE TypeCode=$code AND IsEnabled=1";
            command.Parameters.AddValue("$code", value);
            if (Convert.ToInt32(await command.ExecuteScalarAsync(ct)) == 0) throw new ArgumentException("所选交付物类型不存在或已停用。");
        }
        return value;
    }

    private static async Task ValidateParentAsync(SqliteConnection connection, SqliteTransaction transaction, TypeInfo type, int? parentId, string scopeValue, CancellationToken ct, int? currentId = null)
    {
        if (type.StructureMode == StructureFlat)
        {
            if (parentId.HasValue) throw new ArgumentException("平级结构的字典项不能设置上级项。");
            return;
        }
        if (!parentId.HasValue) return;
        if (currentId.HasValue && parentId.Value == currentId.Value) throw new ArgumentException("字典项不能将自己设置为上级。");
        await using (var parent = connection.CreateCommand())
        {
            parent.Transaction = transaction;
            parent.CommandText = "SELECT COUNT(*) FROM DictionaryItems WHERE Id=$id AND DictionaryTypeId=$typeId AND ScopeValue=$scope AND IsEnabled=1";
            parent.Parameters.AddValue("$id", parentId.Value);
            parent.Parameters.AddValue("$typeId", type.Id);
            parent.Parameters.AddValue("$scope", scopeValue);
            if (Convert.ToInt32(await parent.ExecuteScalarAsync(ct)) == 0) throw new ArgumentException("上级字典项不存在、已删除或与当前作用域不一致。");
        }
        if (!currentId.HasValue) return;
        await using var cycle = connection.CreateCommand();
        cycle.Transaction = transaction;
        cycle.CommandText = """
            WITH RECURSIVE descendants(Id) AS (
                SELECT Id FROM DictionaryItems WHERE ParentItemId=$currentId AND IsEnabled=1
                UNION ALL
                SELECT i.Id FROM DictionaryItems i JOIN descendants d ON i.ParentItemId=d.Id WHERE i.IsEnabled=1
            )
            SELECT COUNT(*) FROM descendants WHERE Id=$parentId;
            """;
        cycle.Parameters.AddValue("$currentId", currentId.Value);
        cycle.Parameters.AddValue("$parentId", parentId.Value);
        if (Convert.ToInt32(await cycle.ExecuteScalarAsync(ct)) > 0) throw new ArgumentException("不能选择当前字典项的下级作为上级，否则会形成循环层级。");
    }

    private static async Task<int> GetUsageCountAsync(SqliteConnection connection, SqliteTransaction transaction, string dictionaryCode, int itemId, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = dictionaryCode.ToUpperInvariant() switch
        {
            DeliverableCategory => "SELECT COUNT(*) FROM Deliverables WHERE CategoryId=$id",
            IssueDepartment => "SELECT COUNT(*) FROM IssueSnapshots WHERE DepartmentItemId=$id",
            IssueSource => "SELECT COUNT(*) FROM IssueSnapshots WHERE SourceItemId=$id",
            IssueSeverity => "SELECT COUNT(*) FROM IssueSnapshots WHERE SeverityItemId=$id",
            IssueStatus => "SELECT COUNT(*) FROM IssueSnapshotCounts WHERE StatusItemId=$id",
            _ => "SELECT 0"
        };
        command.Parameters.AddValue("$id", itemId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct));
    }

    private static async Task<int> CountItemsAsync(SqliteConnection connection, SqliteTransaction? transaction, int typeId, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*) FROM DictionaryItems WHERE DictionaryTypeId=$id AND IsEnabled=1";
        command.Parameters.AddValue("$id", typeId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(ct));
    }

    private static object ToResponse(TypeInfo type, int itemCount) => new
    {
        id = type.Id, code = type.Code, name = type.Name, description = type.Description,
        scopeMode = type.ScopeMode, structureMode = type.StructureMode, isSystem = type.IsSystem,
        sortOrder = type.SortOrder, isEnabled = type.IsEnabled, itemCount
    };

    private static async Task<TypeInfo?> ReadTypeInfoAsync(SqliteConnection connection, string code, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Id,Code,Name,Description,ScopeMode,StructureMode,IsSystem,SortOrder,IsEnabled FROM DictionaryTypes WHERE Code=$code";
        command.Parameters.AddValue("$code", code);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? ReadType(reader) : null;
    }

    private static async Task<TypeInfo?> ReadTypeInfoAsync(SqliteConnection connection, string code, SqliteTransaction transaction, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT Id,Code,Name,Description,ScopeMode,StructureMode,IsSystem,SortOrder,IsEnabled FROM DictionaryTypes WHERE Code=$code";
        command.Parameters.AddValue("$code", code);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? ReadType(reader) : null;
    }

    private static async Task<TypeInfo?> ReadTypeInfoAsync(SqliteConnection connection, int id, SqliteTransaction transaction, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT Id,Code,Name,Description,ScopeMode,StructureMode,IsSystem,SortOrder,IsEnabled FROM DictionaryTypes WHERE Id=$id";
        command.Parameters.AddValue("$id", id);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? ReadType(reader) : null;
    }

    private static TypeInfo ReadType(SqliteDataReader reader) => new(
        reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetNullableString(3), reader.GetString(4),
        reader.GetString(5), reader.GetInt32(6) == 1, reader.GetInt32(7), reader.GetInt32(8) == 1);

    private static async Task<ItemInfo?> ReadItemAsync(SqliteConnection connection, SqliteTransaction transaction, int typeId, int id, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT ItemCode,ItemName,ScopeValue FROM DictionaryItems WHERE Id=$id AND DictionaryTypeId=$typeId AND IsEnabled=1";
        command.Parameters.AddValue("$id", id);
        command.Parameters.AddValue("$typeId", typeId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? new ItemInfo(reader.GetString(0), reader.GetString(1), reader.GetString(2)) : null;
    }

    private static async Task InsertAuditAsync(SqliteConnection connection, SqliteTransaction transaction, string entityType, int entityId, string actionType, string operatorName, string summary, CancellationToken ct)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES($type,$id,$action,$operator,$summary,$now)";
        command.Parameters.AddValue("$type", entityType);
        command.Parameters.AddValue("$id", entityId);
        command.Parameters.AddValue("$action", actionType);
        command.Parameters.AddValue("$operator", operatorName);
        command.Parameters.AddValue("$summary", summary);
        command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(ct);
    }

    private sealed record TypeInfo(int Id, string Code, string Name, string? Description, string ScopeMode, string StructureMode, bool IsSystem, int SortOrder, bool IsEnabled);
    private sealed record ItemInfo(string Value, string Name, string ScopeValue);
}
