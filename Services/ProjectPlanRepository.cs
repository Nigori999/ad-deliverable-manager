using System.Globalization;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class ProjectPlanRepository
{
    private readonly DatabaseService _database;
    public ProjectPlanRepository(DatabaseService database) => _database = database;

    public async Task<object> GetAsync(int? projectId, CancellationToken ct = default)
    {
        await using var c = await _database.OpenConnectionAsync(ct);
        var projects = new List<object>();
        await using (var q = c.CreateCommand())
        {
            q.CommandText = "SELECT Id,ProjectCode,ProjectName,VehicleModel FROM Projects WHERE IsEnabled=1 ORDER BY CASE WHEN VehicleModel='' OR VehicleModel IS NULL THEN 1 ELSE 0 END,ProjectCode";
            await using var r = await q.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) projects.Add(new { id=r.GetInt32(0), code=r.GetString(1), name=r.GetString(2), vehicleModel=r.GetNullableString(3) });
        }
        var selected = projectId ?? 0;
        if (selected <= 0)
        {
            await using var first = c.CreateCommand();
            first.CommandText = "SELECT Id FROM Projects WHERE IsEnabled=1 ORDER BY CASE WHEN VehicleModel='' OR VehicleModel IS NULL THEN 1 ELSE 0 END,ProjectCode LIMIT 1";
            selected = Convert.ToInt32(await first.ExecuteScalarAsync(ct) ?? 0);
        }
        if (selected <= 0) return new { projects, selectedProjectId = (int?)null, plan = (object?)null, nodes = Array.Empty<object>() };
        await using var command = c.CreateCommand();
        command.CommandText = "SELECT Id,PlannedStartDate,PlannedEndDate,Revision FROM VehicleProjectPlans WHERE ProjectId=$project AND IsEnabled=1";
        command.Parameters.AddValue("$project", selected);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return new { projects, selectedProjectId = selected, plan = (object?)null, nodes = Array.Empty<object>() };
        var planId = reader.GetInt32(0);
        var plan = new { id=planId, plannedStartDate=reader.GetString(1), plannedEndDate=reader.GetString(2), revision=reader.GetInt32(3) };
        return new { projects, selectedProjectId=selected, plan, nodes=await LoadNodesAsync(c, planId, ct) };
    }

    public async Task<int> SavePlanAsync(VehicleProjectPlanRequest request, string actor, CancellationToken ct = default)
    {
        ValidateRange(request.PlannedStartDate, request.PlannedEndDate, "整车项目计划");
        await using var c = await _database.OpenConnectionAsync(ct);
        await using var tx = c.BeginTransaction();
        await EnsureProjectAsync(c, tx, request.ProjectId, ct);
        await using (var nodeCheck = c.CreateCommand())
        {
            nodeCheck.Transaction = tx;
            nodeCheck.CommandText = "SELECT COUNT(*) FROM ProjectPlanNodes WHERE PlanId=(SELECT Id FROM VehicleProjectPlans WHERE ProjectId=$project) AND IsActive=1 AND (PlannedEndDate<$start OR PlannedEndDate>$end)";
            nodeCheck.Parameters.AddValue("$project", request.ProjectId); nodeCheck.Parameters.AddValue("$start", request.PlannedStartDate); nodeCheck.Parameters.AddValue("$end", request.PlannedEndDate);
            if (Convert.ToInt32(await nodeCheck.ExecuteScalarAsync(ct)) > 0) throw new ArgumentException("已有计划节点落在新的整车计划周期外，不能缩短周期。");
        }
        await using var command = c.CreateCommand(); command.Transaction=tx;
        command.CommandText = "INSERT INTO VehicleProjectPlans(ProjectId,PlannedStartDate,PlannedEndDate,IsEnabled,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision) VALUES($project,$start,$end,1,$actor,$now,$actor,$now,1) ON CONFLICT(ProjectId) DO UPDATE SET PlannedStartDate=excluded.PlannedStartDate,PlannedEndDate=excluded.PlannedEndDate,IsEnabled=1,UpdatedBy=excluded.UpdatedBy,UpdatedAt=excluded.UpdatedAt,Revision=VehicleProjectPlans.Revision+1 RETURNING Id";
        command.Parameters.AddValue("$project", request.ProjectId); command.Parameters.AddValue("$start", request.PlannedStartDate); command.Parameters.AddValue("$end", request.PlannedEndDate); command.Parameters.AddValue("$actor", actor); command.Parameters.AddValue("$now", Now());
        var id=Convert.ToInt32(await command.ExecuteScalarAsync(ct));
        await AuditAsync(c, tx, "VehicleProjectPlan", id, "UPSERT", actor, "维护整车项目计划周期", ct);
        await tx.CommitAsync(ct); return id;
    }

    public async Task<int> CreateNodeAsync(int planId, ProjectPlanNodeRequest request, string actor, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.NodeName)) throw new ArgumentException("计划名称不能为空。");
        EnsureDate(request.PlannedEndDate, "计划结束日期");
        await using var c=await _database.OpenConnectionAsync(ct); await using var tx=c.BeginTransaction();
        var context=await GetNodeContextAsync(c,tx,planId,request.ParentNodeId,ct);
        ValidateNodeDate(request.PlannedEndDate,context.Start,context.End);
        await ValidateSiblingDateAsync(c,tx,planId,request.ParentNodeId,request.PlannedEndDate,null,ct);
        await using var cmd=c.CreateCommand();cmd.Transaction=tx;
        cmd.CommandText="INSERT INTO ProjectPlanNodes(PlanId,ParentNodeId,NodeLevel,NodeName,PlannedEndDate,IsActive,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision) VALUES($plan,$parent,$level,$name,$end,1,$actor,$now,$actor,$now,1);SELECT last_insert_rowid();";
        cmd.Parameters.AddValue("$plan",planId);cmd.Parameters.AddValue("$parent",request.ParentNodeId);cmd.Parameters.AddValue("$level",context.Level);cmd.Parameters.AddValue("$name",request.NodeName.Trim());cmd.Parameters.AddValue("$end",request.PlannedEndDate);cmd.Parameters.AddValue("$actor",actor);cmd.Parameters.AddValue("$now",Now());
        var id=Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));await AuditAsync(c,tx,"ProjectPlanNode",id,"CREATE",actor,$"新增{context.Level}级计划：{request.NodeName.Trim()}",ct);await tx.CommitAsync(ct);return id;
    }

    public async Task UpdateNodeAsync(int nodeId, ProjectPlanNodeRequest request, string actor, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.NodeName)) throw new ArgumentException("计划名称不能为空。"); EnsureDate(request.PlannedEndDate,"计划结束日期");
        await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();
        var node=await ReadNodeAsync(c,tx,nodeId,ct) ?? throw new KeyNotFoundException("计划节点不存在或已停用。");
        if (node.Revision!=request.Revision) throw new InvalidOperationException("计划节点已被他人修改，请刷新后重试。");
        var context=await GetNodeContextAsync(c,tx,node.PlanId,node.ParentId,ct);ValidateNodeDate(request.PlannedEndDate,context.Start,context.End);await ValidateSiblingDateAsync(c,tx,node.PlanId,node.ParentId,request.PlannedEndDate,nodeId,ct);
        await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="UPDATE ProjectPlanNodes SET NodeName=$name,PlannedEndDate=$end,UpdatedBy=$actor,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND Revision=$revision";cmd.Parameters.AddValue("$name",request.NodeName.Trim());cmd.Parameters.AddValue("$end",request.PlannedEndDate);cmd.Parameters.AddValue("$actor",actor);cmd.Parameters.AddValue("$now",Now());cmd.Parameters.AddValue("$id",nodeId);cmd.Parameters.AddValue("$revision",request.Revision);
        if(await cmd.ExecuteNonQueryAsync(ct)==0)throw new InvalidOperationException("计划节点已被他人修改，请刷新后重试。");
        await AuditAsync(c,tx,"ProjectPlanNode",nodeId,"UPDATE",actor,$"更新计划节点：{request.NodeName.Trim()}",ct);await tx.CommitAsync(ct);
    }

    public async Task DeactivateNodeAsync(int nodeId,string actor,CancellationToken ct=default)
    {
        await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();
        var node=await ReadNodeAsync(c,tx,nodeId,ct)??throw new KeyNotFoundException("计划节点不存在或已停用。");
        await using var check=c.CreateCommand();check.Transaction=tx;check.CommandText="SELECT (SELECT COUNT(*) FROM ProjectPlanNodes WHERE ParentNodeId=$id AND IsActive=1)+(SELECT COUNT(*) FROM KeyItems WHERE ProjectPlanNodeId=$id)";check.Parameters.AddValue("$id",nodeId);
        if(Convert.ToInt32(await check.ExecuteScalarAsync(ct))>0)throw new InvalidOperationException("该节点存在下级计划或已被关键事项引用，不能停用。");
        await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="UPDATE ProjectPlanNodes SET IsActive=0,UpdatedBy=$actor,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id";cmd.Parameters.AddValue("$actor",actor);cmd.Parameters.AddValue("$now",Now());cmd.Parameters.AddValue("$id",nodeId);await cmd.ExecuteNonQueryAsync(ct);await AuditAsync(c,tx,"ProjectPlanNode",nodeId,"DEACTIVATE",actor,$"停用计划节点：{node.Name}",ct);await tx.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<object>> GetItemsAsync(int nodeId,CancellationToken ct=default)
    { await using var c=await _database.OpenConnectionAsync(ct);return await LoadItemsAsync(c,nodeId,ct); }
    public async Task<int> CreateItemAsync(int nodeId,ProjectPlanItemRequest request,string actor,CancellationToken ct=default)
    {
        ValidateItem(request);await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();var node=await ReadNodeAsync(c,tx,nodeId,ct)??throw new KeyNotFoundException("计划节点不存在或已停用。");await ValidateItemWindowAsync(c,tx,node,request,ct);
        await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="INSERT INTO ProjectPlanItems(NodeId,ItemName,PlannedStartDate,PlannedEndDate,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision) VALUES($node,$name,$start,$end,$actor,$now,$actor,$now,1);SELECT last_insert_rowid();";cmd.Parameters.AddValue("$node",nodeId);cmd.Parameters.AddValue("$name",request.ItemName.Trim());cmd.Parameters.AddValue("$start",request.PlannedStartDate);cmd.Parameters.AddValue("$end",request.PlannedEndDate);cmd.Parameters.AddValue("$actor",actor);cmd.Parameters.AddValue("$now",Now());var id=Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));await AuditAsync(c,tx,"ProjectPlanItem",id,"CREATE",actor,$"新增计划事项：{request.ItemName.Trim()}",ct);await tx.CommitAsync(ct);return id;
    }
    public async Task UpdateItemAsync(int itemId,ProjectPlanItemRequest request,string actor,CancellationToken ct=default)
    {
        ValidateItem(request);await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();await using var read=c.CreateCommand();read.Transaction=tx;read.CommandText="SELECT i.NodeId,i.Revision,n.PlanId,n.ParentNodeId,n.NodeLevel,n.NodeName,n.PlannedEndDate,n.IsActive FROM ProjectPlanItems i JOIN ProjectPlanNodes n ON n.Id=i.NodeId WHERE i.Id=$id";read.Parameters.AddValue("$id",itemId);await using var r=await read.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new KeyNotFoundException("计划事项不存在。");var node=new NodeRow(r.GetInt32(2),r.GetInt32(0),r.IsDBNull(3)?(int?)null:r.GetInt32(3),r.GetInt32(4),r.GetString(5),r.GetString(6),r.GetInt32(7)==1,r.GetInt32(1));if(node.Revision!=request.Revision)throw new InvalidOperationException("计划事项已被他人修改，请刷新后重试。");await ValidateItemWindowAsync(c,tx,node,request,ct);
        await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="UPDATE ProjectPlanItems SET ItemName=$name,PlannedStartDate=$start,PlannedEndDate=$end,UpdatedBy=$actor,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND Revision=$revision";cmd.Parameters.AddValue("$name",request.ItemName.Trim());cmd.Parameters.AddValue("$start",request.PlannedStartDate);cmd.Parameters.AddValue("$end",request.PlannedEndDate);cmd.Parameters.AddValue("$actor",actor);cmd.Parameters.AddValue("$now",Now());cmd.Parameters.AddValue("$id",itemId);cmd.Parameters.AddValue("$revision",request.Revision);if(await cmd.ExecuteNonQueryAsync(ct)==0)throw new InvalidOperationException("计划事项已被他人修改，请刷新后重试。");await AuditAsync(c,tx,"ProjectPlanItem",itemId,"UPDATE",actor,$"更新计划事项：{request.ItemName.Trim()}",ct);await tx.CommitAsync(ct);
    }
    public async Task DeleteItemAsync(int itemId,string actor,CancellationToken ct=default)
    {await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="DELETE FROM ProjectPlanItems WHERE Id=$id";cmd.Parameters.AddValue("$id",itemId);if(await cmd.ExecuteNonQueryAsync(ct)==0)throw new KeyNotFoundException("计划事项不存在。");await AuditAsync(c,tx,"ProjectPlanItem",itemId,"DELETE",actor,"删除计划事项",ct);await tx.CommitAsync(ct);}

    private static async Task<List<object>> LoadNodesAsync(SqliteConnection c,int planId,CancellationToken ct){var result=new List<object>();await using var cmd=c.CreateCommand();cmd.CommandText="SELECT Id,ParentNodeId,NodeLevel,NodeName,PlannedEndDate,Revision FROM ProjectPlanNodes WHERE PlanId=$plan AND IsActive=1 ORDER BY NodeLevel,ParentNodeId,PlannedEndDate";cmd.Parameters.AddValue("$plan",planId);await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))result.Add(new{id=r.GetInt32(0),planId,parentNodeId=r.IsDBNull(1)?(int?)null:r.GetInt32(1),nodeLevel=r.GetInt32(2),nodeName=r.GetString(3),plannedEndDate=r.GetString(4),revision=r.GetInt32(5)});return result;}
    private static async Task<List<object>> LoadItemsAsync(SqliteConnection c,int nodeId,CancellationToken ct){var result=new List<object>();await using var cmd=c.CreateCommand();cmd.CommandText="SELECT Id,ItemName,PlannedStartDate,PlannedEndDate,Revision FROM ProjectPlanItems WHERE NodeId=$node ORDER BY PlannedStartDate,PlannedEndDate";cmd.Parameters.AddValue("$node",nodeId);await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))result.Add(new{id=r.GetInt32(0),itemName=r.GetString(1),plannedStartDate=r.GetString(2),plannedEndDate=r.GetString(3),revision=r.GetInt32(4)});return result;}
    private static async Task EnsureProjectAsync(SqliteConnection c,SqliteTransaction tx,int projectId,CancellationToken ct){if(projectId<=0)throw new ArgumentException("请选择车型。");await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="SELECT COUNT(*) FROM Projects WHERE Id=$id AND IsEnabled=1";cmd.Parameters.AddValue("$id",projectId);if(Convert.ToInt32(await cmd.ExecuteScalarAsync(ct))==0)throw new ArgumentException("车型不存在或已停用。");}
    private static async Task<NodeContext> GetNodeContextAsync(SqliteConnection c,SqliteTransaction tx,int planId,int? parentId,CancellationToken ct){await using var plan=c.CreateCommand();plan.Transaction=tx;plan.CommandText="SELECT PlannedStartDate,PlannedEndDate FROM VehicleProjectPlans WHERE Id=$id AND IsEnabled=1";plan.Parameters.AddValue("$id",planId);await using var r=await plan.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new ArgumentException("请先维护车型的整车项目计划周期。");var start=r.GetString(0);var end=r.GetString(1);if(!parentId.HasValue)return new(1,start,end);var parent=await ReadNodeAsync(c,tx,parentId.Value,ct)??throw new ArgumentException("所属上级计划不存在或已停用。");if(parent.PlanId!=planId||parent.Level>=3)throw new ArgumentException("上级计划层级或归属无效。");return new(parent.Level+1,start,parent.EndDate);}
    private static async Task<NodeRow?> ReadNodeAsync(SqliteConnection c,SqliteTransaction tx,int id,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="SELECT PlanId,Id,ParentNodeId,NodeLevel,NodeName,PlannedEndDate,IsActive,Revision FROM ProjectPlanNodes WHERE Id=$id";cmd.Parameters.AddValue("$id",id);await using var r=await cmd.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct)||r.GetInt32(6)!=1)return null;return new(r.GetInt32(0),r.GetInt32(1),r.IsDBNull(2)?(int?)null:r.GetInt32(2),r.GetInt32(3),r.GetString(4),r.GetString(5),true,r.GetInt32(7));}
    private static async Task ValidateSiblingDateAsync(SqliteConnection c,SqliteTransaction tx,int planId,int? parentId,string endDate,int? excludeId,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="SELECT PlannedEndDate FROM ProjectPlanNodes WHERE PlanId=$plan AND ((ParentNodeId IS NULL AND $parent IS NULL) OR ParentNodeId=$parent) AND IsActive=1 AND Id<>COALESCE($exclude,-1)";cmd.Parameters.AddValue("$plan",planId);cmd.Parameters.AddValue("$parent",parentId);cmd.Parameters.AddValue("$exclude",excludeId);await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))if(string.CompareOrdinal(endDate,r.GetString(0))==0)throw new ArgumentException("同一父计划下的计划结束日期不能相同。");}
    private static async Task ValidateItemWindowAsync(SqliteConnection c,SqliteTransaction tx,NodeRow node,ProjectPlanItemRequest request,CancellationToken ct){var context=await GetNodeContextAsync(c,tx,node.PlanId,node.ParentId,ct);if(string.CompareOrdinal(request.PlannedStartDate,context.Start)<0||string.CompareOrdinal(request.PlannedEndDate,node.EndDate)>0)throw new ArgumentException("计划事项必须落在所属计划节点允许的时间范围内。");}
    private static void ValidateNodeDate(string date,string start,string end){EnsureDate(date,"计划结束日期");if(string.CompareOrdinal(date,start)<0||string.CompareOrdinal(date,end)>0)throw new ArgumentException("计划结束日期必须处于上级计划周期内。");}
    private static void ValidateItem(ProjectPlanItemRequest r){if(string.IsNullOrWhiteSpace(r.ItemName))throw new ArgumentException("事项名称不能为空。");ValidateRange(r.PlannedStartDate,r.PlannedEndDate,"计划事项");}
    private static void ValidateRange(string start,string end,string name){EnsureDate(start,$"{name}开始日期");EnsureDate(end,$"{name}结束日期");if(string.CompareOrdinal(start,end)>0)throw new ArgumentException($"{name}结束日期不能早于开始日期。");}
    private static void EnsureDate(string value,string label){if(!DateOnly.TryParseExact(value,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out _))throw new ArgumentException($"{label}格式无效。");}
    private static async Task AuditAsync(SqliteConnection c,SqliteTransaction tx,string type,int id,string action,string actor,string summary,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES($type,$id,$action,$actor,$summary,$now)";cmd.Parameters.AddValue("$type",type);cmd.Parameters.AddValue("$id",id);cmd.Parameters.AddValue("$action",action);cmd.Parameters.AddValue("$actor",actor);cmd.Parameters.AddValue("$summary",summary);cmd.Parameters.AddValue("$now",Now());await cmd.ExecuteNonQueryAsync(ct);}
    private static string Now()=>DateTime.UtcNow.ToString("O");
    private sealed record NodeRow(int PlanId,int Id,int? ParentId,int Level,string Name,string EndDate,bool Active,int Revision);
    private sealed record NodeContext(int Level,string Start,string End);
}
