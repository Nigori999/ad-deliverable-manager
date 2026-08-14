using System.Text.Json;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class ProductBaselineRepository
{
    private readonly DatabaseService _database;
    public ProductBaselineRepository(DatabaseService database) => _database = database;

    public async Task<IReadOnlyList<object>> ListAsync(CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT Id,ProductName,InternalVersion,VersionStatus,Description,VehicleModels,Odd,Capabilities,CreatedBy,CreatedAt,ReleaseDate,Revision FROM ProductBaselines ORDER BY CreatedAt DESC";
        var rows = new List<object>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) rows.Add(new
        {
            id = r.GetInt32(0), productName = r.GetString(1), version = r.GetString(2), status = r.GetString(3),
            description = r.IsDBNull(4) ? "" : r.GetString(4), vehicleModels = r.IsDBNull(5) ? "" : r.GetString(5),
            odd = r.IsDBNull(6) ? "" : r.GetString(6), capabilities = r.IsDBNull(7) ? "" : r.GetString(7),
            createdBy = r.GetString(8), createdAt = r.GetString(9), releaseDate = r.IsDBNull(10) ? null : r.GetString(10), revision = r.GetInt32(11)
        });
        return rows;
    }

    public async Task<object?> GetAsync(int id, CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        var baseline = await ReadBaselineAsync(c, id, ct);
        if (baseline is null) return null;
        var hardware = await ReadHardwareAsync(c, id, ct);
        var deliverables = await ReadDeliverablesAsync(c, id, ct);
        var changes = await ReadChangesAsync(c, id, ct);
        return new { baseline, hardware, deliverables, changes };
    }

    public async Task<object> GetOptionsAsync(CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        var hardware = new List<object>();
        var documents = new List<object>();
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = """
SELECT v.Id,d.UnifiedName,v.InternalVersion,h.HardwareCategory,h.HardwareModel
FROM DeliverableVersions v
JOIN Deliverables d ON d.Id=v.DeliverableId
JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
LEFT JOIN HardwarePackageDetails h ON h.VersionId=v.Id
WHERE t.TypeCode='SWP' AND v.VersionStatus IN ('RELEASED','SUPERSEDED')
ORDER BY d.UnifiedName,v.InternalVersion DESC
""";
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) hardware.Add(new { id = r.GetInt32(0), name = r.GetString(1), version = r.GetString(2), hardwareCategory = r.IsDBNull(3) ? "" : r.GetString(3), hardwareModel = r.IsDBNull(4) ? "" : r.GetString(4) });
        }
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = """
SELECT v.Id,d.UnifiedName,v.InternalVersion,t.TypeCode,t.TypeName
FROM DeliverableVersions v
JOIN Deliverables d ON d.Id=v.DeliverableId
JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
WHERE t.TypeCode IN ('PRD','FR','TC','TR') AND v.VersionStatus IN ('RELEASED','SUPERSEDED')
ORDER BY t.SortOrder,d.UnifiedName,v.InternalVersion DESC
""";
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) documents.Add(new { id = r.GetInt32(0), name = r.GetString(1), version = r.GetString(2), typeCode = r.GetString(3), typeName = r.GetString(4) });
        }
        return new { hardware, documents };
    }

    public async Task<int> CreateAsync(ProductBaselineCreateRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateName(request.ProductName);
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM ProductBaselines WHERE ProductName=$name AND InternalVersion='V1.0.0'";
        cmd.Parameters.AddWithValue("$name", request.ProductName.Trim());
        if (Convert.ToInt32(await cmd.ExecuteScalarAsync(ct)) > 0) throw new InvalidOperationException("该产品已存在V1.0.0，请从已发布基线复制创建后续版本。");
        await using var tx = c.BeginTransaction();
        cmd.Transaction = tx;
        cmd.CommandText = """
INSERT INTO ProductBaselines(ProductName,InternalVersion,VersionStatus,Description,VehicleModels,Odd,Capabilities,CreatedBy,CreatedAt,UpdatedAt,Revision)
VALUES($name,'V1.0.0','DRAFT',$description,$vehicles,$odd,$capabilities,$by,$now,$now,1); SELECT last_insert_rowid();
""";
        cmd.Parameters.AddWithValue("$description", request.Description?.Trim() ?? "");
        cmd.Parameters.AddWithValue("$vehicles", request.VehicleModels?.Trim() ?? "");
        cmd.Parameters.AddWithValue("$odd", request.Odd?.Trim() ?? "");
        cmd.Parameters.AddWithValue("$capabilities", request.Capabilities?.Trim() ?? "");
        cmd.Parameters.AddWithValue("$by", operatorName); cmd.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        var id = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        await tx.CommitAsync(ct);
        return id;
    }

    public async Task UpdateDraftAsync(int id, ProductBaselineUpdateRequest request, string operatorName, CancellationToken ct = default)
    {
        ValidateName(request.ProductName);
        ValidateComponents(request.Hardware);
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var tx = c.BeginTransaction();
        await EnsureDraftAsync(c, tx, id, request.Revision, ct);
        await using (var cmd = c.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE ProductBaselines SET ProductName=$name,Description=$description,VehicleModels=$vehicles,Odd=$odd,Capabilities=$capabilities,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id";
            cmd.Parameters.AddWithValue("$name", request.ProductName.Trim()); cmd.Parameters.AddWithValue("$description", request.Description?.Trim() ?? "");
            cmd.Parameters.AddWithValue("$vehicles", request.VehicleModels?.Trim() ?? ""); cmd.Parameters.AddWithValue("$odd", request.Odd?.Trim() ?? "");
            cmd.Parameters.AddWithValue("$capabilities", request.Capabilities?.Trim() ?? ""); cmd.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O")); cmd.Parameters.AddWithValue("$id", id);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await using (var clear = c.CreateCommand())
        {
            clear.Transaction = tx; clear.CommandText = "DELETE FROM ProductBaselineHardware WHERE BaselineId=$id; DELETE FROM ProductBaselineDeliverables WHERE BaselineId=$id;";
            clear.Parameters.AddWithValue("$id", id); await clear.ExecuteNonQueryAsync(ct);
        }
        foreach (var item in request.Hardware)
        {
            await using var add = c.CreateCommand(); add.Transaction = tx;
            add.CommandText = "INSERT INTO ProductBaselineHardware(BaselineId,HardwareCategory,HardwareModel,SoftwareVersionId) VALUES($id,$category,$model,$version)";
            add.Parameters.AddWithValue("$id", id); add.Parameters.AddWithValue("$category", item.HardwareCategory.Trim()); add.Parameters.AddWithValue("$model", item.HardwareModel?.Trim() ?? ""); add.Parameters.AddWithValue("$version", item.SoftwareVersionId); await add.ExecuteNonQueryAsync(ct);
        }
        foreach (var item in request.Deliverables.DistinctBy(x => (x.RoleCode, x.VersionId)))
        {
            await using var add = c.CreateCommand(); add.Transaction = tx;
            add.CommandText = "INSERT INTO ProductBaselineDeliverables(BaselineId,RoleCode,VersionId) VALUES($id,$role,$version)";
            add.Parameters.AddWithValue("$id", id); add.Parameters.AddWithValue("$role", item.RoleCode); add.Parameters.AddWithValue("$version", item.VersionId); await add.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }

    public async Task PublishAsync(int id, int revision, string operatorName, CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var tx = c.BeginTransaction();
        await EnsureDraftAsync(c, tx, id, revision, ct);
        await ValidatePublishAsync(c, tx, id, ct);
        await using var cmd = c.CreateCommand(); cmd.Transaction = tx;
        cmd.CommandText = "UPDATE ProductBaselines SET VersionStatus='RELEASED',ReleaseDate=$date,UpdatedAt=$date,Revision=Revision+1 WHERE Id=$id";
        cmd.Parameters.AddWithValue("$date", DateTime.UtcNow.ToString("O")); cmd.Parameters.AddWithValue("$id", id); await cmd.ExecuteNonQueryAsync(ct); await tx.CommitAsync(ct);
    }

    public async Task<int> CopyAsync(int sourceId, ProductBaselineCopyRequest request, string operatorName, CancellationToken ct = default)
    {
        var increment = request.VersionType?.Trim().ToUpperInvariant() switch { "MAJOR" => 0, "MINOR" => 1, "PATCH" => 2, _ => -1 };
        if (increment < 0) throw new ArgumentException("版本类型必须为MAJOR、MINOR或PATCH。");
        await using var c = await _database.OpenConnectionAsync(ct);
        var source = await ReadBaselineAsync(c, sourceId, ct) ?? throw new KeyNotFoundException("产品基线不存在。");
        if (!string.Equals(source.VersionStatus, "RELEASED", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("只有已发布产品基线可以复制。");
        var next = await NextVersionAsync(c, source.ProductName, source.InternalVersion, increment, ct);
        await using var tx = c.BeginTransaction();
        await using var cmd = c.CreateCommand(); cmd.Transaction = tx;
        cmd.CommandText = """
INSERT INTO ProductBaselines(ProductName,InternalVersion,VersionStatus,Description,VehicleModels,Odd,Capabilities,BasedOnBaselineId,CreatedBy,CreatedAt,UpdatedAt,Revision)
VALUES($name,$version,'DRAFT',$description,$vehicles,$odd,$capabilities,$based,$by,$now,$now,1); SELECT last_insert_rowid();
""";
        cmd.Parameters.AddWithValue("$name", source.ProductName); cmd.Parameters.AddWithValue("$version", next); cmd.Parameters.AddWithValue("$description", source.Description); cmd.Parameters.AddWithValue("$vehicles", source.VehicleModels); cmd.Parameters.AddWithValue("$odd", source.Odd); cmd.Parameters.AddWithValue("$capabilities", source.Capabilities); cmd.Parameters.AddWithValue("$based", source.Id); cmd.Parameters.AddWithValue("$by", operatorName); cmd.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O"));
        var id = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
        await using (var copy = c.CreateCommand())
        {
            copy.Transaction = tx; copy.CommandText = "INSERT INTO ProductBaselineHardware(BaselineId,HardwareCategory,HardwareModel,SoftwareVersionId) SELECT $newId,HardwareCategory,HardwareModel,SoftwareVersionId FROM ProductBaselineHardware WHERE BaselineId=$oldId; INSERT INTO ProductBaselineDeliverables(BaselineId,RoleCode,VersionId) SELECT $newId,RoleCode,VersionId FROM ProductBaselineDeliverables WHERE BaselineId=$oldId;";
            copy.Parameters.AddWithValue("$newId", id); copy.Parameters.AddWithValue("$oldId", sourceId); await copy.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct); return id;
    }

    public async Task ApplyChangeAsync(int id, ProductBaselineChangeRequest request, string operatorName, CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        var current = await ReadBaselineAsync(c, id, ct) ?? throw new KeyNotFoundException("产品基线不存在。");
        if (!string.Equals(current.VersionStatus, "RELEASED", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("只有已发布产品基线可以发起基础信息变更。");
        if (string.IsNullOrWhiteSpace(request.ChangeReason)) throw new ArgumentException("请填写变更原因。");
        var before = JsonSerializer.Serialize(new { current.Description, current.VehicleModels, current.Odd, current.Capabilities });
        var after = JsonSerializer.Serialize(new { Description = request.Description?.Trim() ?? "", VehicleModels = request.VehicleModels?.Trim() ?? "", Odd = request.Odd?.Trim() ?? "", Capabilities = request.Capabilities?.Trim() ?? "" });
        await using var tx = c.BeginTransaction();
        await using (var cmd = c.CreateCommand())
        {
            cmd.Transaction = tx; cmd.CommandText = "UPDATE ProductBaselines SET Description=$description,VehicleModels=$vehicles,Odd=$odd,Capabilities=$capabilities,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND Revision=$revision AND VersionStatus='RELEASED'";
            cmd.Parameters.AddWithValue("$description", request.Description?.Trim() ?? ""); cmd.Parameters.AddWithValue("$vehicles", request.VehicleModels?.Trim() ?? ""); cmd.Parameters.AddWithValue("$odd", request.Odd?.Trim() ?? ""); cmd.Parameters.AddWithValue("$capabilities", request.Capabilities?.Trim() ?? ""); cmd.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O")); cmd.Parameters.AddWithValue("$id", id); cmd.Parameters.AddWithValue("$revision", request.Revision);
            if (await cmd.ExecuteNonQueryAsync(ct) == 0) throw new InvalidOperationException("基线已被其他人修改，请刷新后重试。");
        }
        await using (var log = c.CreateCommand())
        {
            log.Transaction = tx; log.CommandText = "INSERT INTO ProductBaselineChanges(BaselineId,ChangeReason,Description,BeforeJson,AfterJson,Operator,CreatedAt) VALUES($id,$reason,$description,$before,$after,$by,$now)";
            log.Parameters.AddWithValue("$id", id); log.Parameters.AddWithValue("$reason", request.ChangeReason.Trim()); log.Parameters.AddWithValue("$description", request.Description?.Trim() ?? ""); log.Parameters.AddWithValue("$before", before); log.Parameters.AddWithValue("$after", after); log.Parameters.AddWithValue("$by", operatorName); log.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O")); await log.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }

    private static void ValidateName(string name){if(string.IsNullOrWhiteSpace(name)||name.Trim().Length>80)throw new ArgumentException("产品名称不能为空且不超过80字。");}
    private static void ValidateComponents(List<ProductBaselineHardwareRequest> hardware){if(hardware.Count==0)throw new ArgumentException("至少配置一项硬件及其对应软件包。");if(hardware.Any(x=>string.IsNullOrWhiteSpace(x.HardwareCategory)||x.SoftwareVersionId<=0))throw new ArgumentException("每项硬件都必须配置类别和对应的软件包版本。");if(hardware.GroupBy(x=>x.HardwareCategory.Trim(),StringComparer.OrdinalIgnoreCase).Any(g=>g.Count()>1))throw new ArgumentException("同一硬件类别只能配置一个软件包版本。");}

    private static async Task EnsureDraftAsync(SqliteConnection c, SqliteTransaction tx, int id, int revision, CancellationToken ct)
    { await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="SELECT VersionStatus FROM ProductBaselines WHERE Id=$id AND Revision=$revision";cmd.Parameters.AddWithValue("$id",id);cmd.Parameters.AddWithValue("$revision",revision);var status=await cmd.ExecuteScalarAsync(ct) as string; if(status is null)throw new InvalidOperationException("基线不存在、已发布或已被其他人修改，请刷新后重试。");if(!string.Equals(status,"DRAFT",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("已发布基线不能直接修改。"); }

    private static async Task ValidatePublishAsync(SqliteConnection c,SqliteTransaction tx,int id,CancellationToken ct)
    {
        await using var count=c.CreateCommand(); count.Transaction=tx; count.CommandText="SELECT COUNT(*) FROM ProductBaselineHardware WHERE BaselineId=$id"; count.Parameters.AddWithValue("$id",id);
        if(Convert.ToInt32(await count.ExecuteScalarAsync(ct))==0)throw new ArgumentException("发布前至少需要配置一项硬件及对应软件包。");
        await using var badHardware=c.CreateCommand(); badHardware.Transaction=tx; badHardware.CommandText="""
SELECT COUNT(*) FROM ProductBaselineHardware h
JOIN DeliverableVersions v ON v.Id=h.SoftwareVersionId
JOIN Deliverables d ON d.Id=v.DeliverableId
JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
WHERE h.BaselineId=$id AND (t.TypeCode<>'SWP' OR v.VersionStatus NOT IN ('RELEASED','SUPERSEDED'))
"""; badHardware.Parameters.AddWithValue("$id",id);
        if(Convert.ToInt32(await badHardware.ExecuteScalarAsync(ct))>0)throw new ArgumentException("基线中的硬件软件包必须引用已正式发布或已替代的硬件软件包版本。");
        await using var badDocs=c.CreateCommand(); badDocs.Transaction=tx; badDocs.CommandText="""
SELECT COUNT(*) FROM ProductBaselineDeliverables b
JOIN DeliverableVersions v ON v.Id=b.VersionId
JOIN Deliverables d ON d.Id=v.DeliverableId
JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
WHERE b.BaselineId=$id AND (t.TypeCode NOT IN ('PRD','FR','TC','TR') OR v.VersionStatus NOT IN ('RELEASED','SUPERSEDED'))
"""; badDocs.Parameters.AddWithValue("$id",id);
        if(Convert.ToInt32(await badDocs.ExecuteScalarAsync(ct))>0)throw new ArgumentException("基线中的辅助交付物必须引用已正式发布或已替代的交付物版本。");
    }

    private static async Task<object?> ReadBaselineAsync(SqliteConnection c,int id,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.CommandText="SELECT Id,ProductName,InternalVersion,VersionStatus,Description,VehicleModels,Odd,Capabilities,BasedOnBaselineId,CreatedBy,CreatedAt,ReleaseDate,UpdatedAt,Revision FROM ProductBaselines WHERE Id=$id";cmd.Parameters.AddWithValue("$id",id);await using var r=await cmd.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))return null;return new {id=r.GetInt32(0),productName=r.GetString(1),internalVersion=r.GetString(2),versionStatus=r.GetString(3),description=r.IsDBNull(4)?"":r.GetString(4),vehicleModels=r.IsDBNull(5)?"":r.GetString(5),odd=r.IsDBNull(6)?"":r.GetString(6),capabilities=r.IsDBNull(7)?"":r.GetString(7),basedOnBaselineId=r.IsDBNull(8)?(int?)null:r.GetInt32(8),createdBy=r.GetString(9),createdAt=r.GetString(10),releaseDate=r.IsDBNull(11)?null:r.GetString(11),updatedAt=r.GetString(12),revision=r.GetInt32(13)};}
    private static async Task<List<object>> ReadHardwareAsync(SqliteConnection c,int id,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.CommandText="SELECT h.HardwareCategory,h.HardwareModel,h.SoftwareVersionId,d.UnifiedName,v.InternalVersion FROM ProductBaselineHardware h JOIN DeliverableVersions v ON v.Id=h.SoftwareVersionId JOIN Deliverables d ON d.Id=v.DeliverableId WHERE h.BaselineId=$id ORDER BY h.HardwareCategory";cmd.Parameters.AddWithValue("$id",id);var x=new List<object>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))x.Add(new{hardwareCategory=r.GetString(0),hardwareModel=r.IsDBNull(1)?"":r.GetString(1),softwareVersionId=r.GetInt32(2),softwareName=r.GetString(3),softwareVersion=r.GetString(4)});return x;}
    private static async Task<List<object>> ReadDeliverablesAsync(SqliteConnection c,int id,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.CommandText="SELECT b.RoleCode,b.VersionId,d.UnifiedName,v.InternalVersion,t.TypeName FROM ProductBaselineDeliverables b JOIN DeliverableVersions v ON v.Id=b.VersionId JOIN Deliverables d ON d.Id=v.DeliverableId JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId WHERE b.BaselineId=$id ORDER BY b.RoleCode,d.UnifiedName";cmd.Parameters.AddWithValue("$id",id);var x=new List<object>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))x.Add(new{roleCode=r.GetString(0),versionId=r.GetInt32(1),name=r.GetString(2),version=r.GetString(3),typeName=r.GetString(4)});return x;}
    private static async Task<List<object>> ReadChangesAsync(SqliteConnection c,int id,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.CommandText="SELECT Id,ChangeReason,Description,Operator,CreatedAt FROM ProductBaselineChanges WHERE BaselineId=$id ORDER BY CreatedAt DESC";cmd.Parameters.AddWithValue("$id",id);var x=new List<object>();await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))x.Add(new{id=r.GetInt32(0),changeReason=r.GetString(1),description=r.IsDBNull(2)?"":r.GetString(2),operatorName=r.GetString(3),createdAt=r.GetString(4)});return x;}
    private static async Task<string> NextVersionAsync(SqliteConnection c,string productName,string current,int type,CancellationToken ct)
    {var parts=current.TrimStart('V').Split('.').Select(int.Parse).ToArray();if(parts.Length!=3)throw new InvalidOperationException("产品基线版本号必须符合V主.次.修订格式。");if(type==0)parts[0]++;else if(type==1)parts[1]++;else parts[2]++;if(type==0){parts[1]=0;parts[2]=0;}else if(type==1)parts[2]=0;var candidate=$"V{parts[0]}.{parts[1]}.{parts[2]}";await using var cmd=c.CreateCommand();cmd.CommandText="SELECT COUNT(*) FROM ProductBaselines WHERE ProductName=$name AND InternalVersion=$version";cmd.Parameters.AddWithValue("$name",productName);cmd.Parameters.AddWithValue("$version",candidate);if(Convert.ToInt32(await cmd.ExecuteScalarAsync(ct))>0)throw new InvalidOperationException($"版本{candidate}已存在，请选择其他版本类型。");return candidate;}
}
