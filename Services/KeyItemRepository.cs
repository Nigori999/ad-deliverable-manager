using System.Globalization;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed class KeyItemRepository
{
    private readonly DatabaseService _database;
    public KeyItemRepository(DatabaseService database) => _database = database;

    public async Task<object> GetReferenceAsync(CancellationToken ct=default)
    {
        await using var c=await _database.OpenConnectionAsync(ct);
        var nodes=await LoadNodeReferencesAsync(c,ct);
        return new { nodes };
    }

    public async Task<object> ListAsync(int? projectId,string? status,string? keyword,CancellationToken ct=default)
    {
        await using var c=await _database.OpenConnectionAsync(ct);
        var rows=new List<KeyItemRow>();
        await using var cmd=c.CreateCommand();
        cmd.CommandText="""
            SELECT k.Id,k.Topic,k.ResponsiblePerson,k.PlannedEndDate,k.ActualEndDate,k.ManualStatus,k.ProjectPlanNodeId,k.Revision,
                   p.ProjectName,p.VehicleModel,n.NodeName,n.NodeLevel,n.ParentNodeId
            FROM KeyItems k LEFT JOIN ProjectPlanNodes n ON n.Id=k.ProjectPlanNodeId
            LEFT JOIN VehicleProjectPlans vp ON vp.Id=n.PlanId LEFT JOIN Projects p ON p.Id=vp.ProjectId
            WHERE ($project IS NULL OR p.Id=$project)
              AND ($keyword='' OR k.Topic LIKE $like OR k.ResponsiblePerson LIKE $like OR n.NodeName LIKE $like)
            ORDER BY k.PlannedEndDate,k.Topic;
            """;
        cmd.Parameters.AddValue("$project",projectId);cmd.Parameters.AddValue("$keyword",keyword?.Trim()??"");cmd.Parameters.AddValue("$like",$"%{keyword?.Trim()??""}%");
        await using var r=await cmd.ExecuteReaderAsync(ct);
        while(await r.ReadAsync(ct)) rows.Add(new(r.GetInt32(0),r.GetString(1),r.GetString(2),r.GetString(3),r.GetNullableString(4),r.GetString(5),r.IsDBNull(6)?(int?)null:r.GetInt32(6),r.GetInt32(7),r.GetNullableString(8),r.GetNullableString(9),r.GetNullableString(10),r.IsDBNull(11)?(int?)null:r.GetInt32(11),r.IsDBNull(12)?(int?)null:r.GetInt32(12)));
        var taskSummary=await LoadTaskSummaryAsync(c,rows.Select(x=>x.Id).ToArray(),ct);
        var items=rows.Select(x=>new {id=x.Id,topic=x.Topic,responsiblePerson=x.ResponsiblePerson,plannedEndDate=x.PlannedEndDate,actualEndDate=x.ActualEndDate,status=ResolveStatus(x.ManualStatus,x.PlannedEndDate,x.ActualEndDate),projectPlanNodeId=x.NodeId,projectName=x.ProjectName,vehicleModel=x.VehicleModel,nodeName=x.NodeName,nodeLevel=x.NodeLevel,taskCount=TaskCount(taskSummary,x.Id),riskTaskCount=RiskCount(taskSummary,x.Id),revision=x.Revision}).Where(x=>string.IsNullOrWhiteSpace(status)||x.status==status).ToArray();
        return new { items };
    }

    public async Task<object?> GetAsync(int id,CancellationToken ct=default)
    {
        var data=await ListAsync(null,null,null,ct); var item=((IEnumerable<dynamic>)data.GetType().GetProperty("items")!.GetValue(data)!).FirstOrDefault(x=>(int)x.id==id); if(item is null)return null;
        await using var c=await _database.OpenConnectionAsync(ct); return new { item, tasks=await LoadTasksAsync(c,id,ct) };
    }

    public async Task<int> CreateAsync(KeyItemRequest request,string actor,CancellationToken ct=default)
    {
        Validate(request);await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();if(request.ProjectPlanNodeId.HasValue)await EnsureNodeAsync(c,tx,request.ProjectPlanNodeId.Value,ct);
        await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="INSERT INTO KeyItems(Topic,ResponsiblePerson,PlannedEndDate,ActualEndDate,ManualStatus,ProjectPlanNodeId,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision) VALUES($topic,$owner,$plan,$actual,$status,$node,$actor,$now,$actor,$now,1);SELECT last_insert_rowid();";Bind(cmd,request,actor);var id=Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));await AuditAsync(c,tx,"KeyItem",id,"CREATE",actor,$"新增关键事项：{request.Topic.Trim()}",ct);await tx.CommitAsync(ct);return id;
    }

    public async Task UpdateAsync(int id,KeyItemRequest request,string actor,CancellationToken ct=default)
    {
        Validate(request);await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();if(request.ProjectPlanNodeId.HasValue)await EnsureNodeAsync(c,tx,request.ProjectPlanNodeId.Value,ct);await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="UPDATE KeyItems SET Topic=$topic,ResponsiblePerson=$owner,PlannedEndDate=$plan,ActualEndDate=$actual,ManualStatus=$status,ProjectPlanNodeId=$node,UpdatedBy=$actor,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND Revision=$revision";Bind(cmd,request,actor);cmd.Parameters.AddValue("$id",id);cmd.Parameters.AddValue("$revision",request.Revision);if(await cmd.ExecuteNonQueryAsync(ct)==0)throw new InvalidOperationException("关键事项已被他人修改，请刷新后重试。");await AuditAsync(c,tx,"KeyItem",id,"UPDATE",actor,$"更新关键事项：{request.Topic.Trim()}",ct);await tx.CommitAsync(ct);
    }
    public async Task DeleteAsync(int id,string actor,CancellationToken ct=default){await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="DELETE FROM KeyItems WHERE Id=$id";cmd.Parameters.AddValue("$id",id);if(await cmd.ExecuteNonQueryAsync(ct)==0)throw new KeyNotFoundException("关键事项不存在。");await AuditAsync(c,tx,"KeyItem",id,"DELETE",actor,"删除关键事项",ct);await tx.CommitAsync(ct);}
    public async Task<IReadOnlyList<object>> GetTasksAsync(int id,CancellationToken ct=default){await using var c=await _database.OpenConnectionAsync(ct);return await LoadTasksAsync(c,id,ct);}
    public async Task<int> CreateTaskAsync(int keyItemId,KeyItemTaskRequest request,string actor,CancellationToken ct=default){ValidateTask(request);await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();await EnsureKeyItemAsync(c,tx,keyItemId,ct);await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="INSERT INTO KeyItemTasks(KeyItemId,TaskName,ManualStatus,PlannedStartDate,PlannedEndDate,ActualEndDate,Output,HasRisk,RiskDescription,ResponsiblePerson,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision) VALUES($key,$name,$status,$start,$plan,$actual,$output,$risk,$riskDesc,$owner,$actor,$now,$actor,$now,1);SELECT last_insert_rowid();";BindTask(cmd,keyItemId,request,actor);var id=Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));await AuditAsync(c,tx,"KeyItemTask",id,"CREATE",actor,$"新增细分任务：{request.TaskName.Trim()}",ct);await tx.CommitAsync(ct);return id;}
    public async Task UpdateTaskAsync(int id,KeyItemTaskRequest request,string actor,CancellationToken ct=default){ValidateTask(request);await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="UPDATE KeyItemTasks SET TaskName=$name,ManualStatus=$status,PlannedStartDate=$start,PlannedEndDate=$plan,ActualEndDate=$actual,Output=$output,HasRisk=$risk,RiskDescription=$riskDesc,ResponsiblePerson=$owner,UpdatedBy=$actor,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id AND Revision=$revision";BindTask(cmd,0,request,actor);cmd.Parameters.AddValue("$id",id);cmd.Parameters.AddValue("$revision",request.Revision);if(await cmd.ExecuteNonQueryAsync(ct)==0)throw new InvalidOperationException("细分任务已被他人修改，请刷新后重试。");await AuditAsync(c,tx,"KeyItemTask",id,"UPDATE",actor,$"更新细分任务：{request.TaskName.Trim()}",ct);await tx.CommitAsync(ct);}
    public async Task DeleteTaskAsync(int id,string actor,CancellationToken ct=default){await using var c=await _database.OpenConnectionAsync(ct);await using var tx=c.BeginTransaction();await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="DELETE FROM KeyItemTasks WHERE Id=$id";cmd.Parameters.AddValue("$id",id);if(await cmd.ExecuteNonQueryAsync(ct)==0)throw new KeyNotFoundException("细分任务不存在。");await AuditAsync(c,tx,"KeyItemTask",id,"DELETE",actor,"删除细分任务",ct);await tx.CommitAsync(ct);}

    private static async Task<List<object>> LoadNodeReferencesAsync(SqliteConnection c,CancellationToken ct){var raw=new List<NodeRef>();await using var cmd=c.CreateCommand();cmd.CommandText="SELECT n.Id,n.ParentNodeId,n.NodeLevel,n.NodeName,n.PlannedEndDate,p.ProjectName,p.VehicleModel FROM ProjectPlanNodes n JOIN VehicleProjectPlans vp ON vp.Id=n.PlanId JOIN Projects p ON p.Id=vp.ProjectId WHERE n.IsActive=1 AND vp.IsEnabled=1 ORDER BY p.ProjectCode,n.NodeLevel,n.PlannedEndDate";await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))raw.Add(new(r.GetInt32(0),r.IsDBNull(1)?(int?)null:r.GetInt32(1),r.GetInt32(2),r.GetString(3),r.GetString(4),r.GetString(5),r.GetNullableString(6)));return raw.Select(x=>new{id=x.Id,parentNodeId=x.ParentId,nodeLevel=x.Level,nodeName=x.Name,plannedEndDate=x.EndDate,projectName=x.ProjectName,vehicleModel=x.VehicleModel,path=BuildPath(x,raw)}).Cast<object>().ToList();}
    private static string BuildPath(NodeRef node,IReadOnlyList<NodeRef> all){var path=new List<string>{node.Name};var current=node;while(current.ParentId.HasValue){var parent=all.FirstOrDefault(x=>x.Id==current.ParentId.Value);if(parent is null)break;path.Insert(0,parent.Name);current=parent;}return string.Join(" ＞ ",path);}
    private static async Task<Dictionary<int,(int Count,int Risk)>> LoadTaskSummaryAsync(SqliteConnection c,int[] ids,CancellationToken ct){var output=new Dictionary<int,(int,int)>();if(ids.Length==0)return output;await using var cmd=c.CreateCommand();var names=new List<string>();for(var i=0;i<ids.Length;i++){var name="$id"+i;names.Add(name);cmd.Parameters.AddValue(name,ids[i]);}cmd.CommandText=$"SELECT KeyItemId,COUNT(*),SUM(HasRisk) FROM KeyItemTasks WHERE KeyItemId IN ({string.Join(',',names)}) GROUP BY KeyItemId";await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))output[r.GetInt32(0)]=(r.GetInt32(1),r.IsDBNull(2)?0:r.GetInt32(2));return output;}
    private static async Task<List<object>> LoadTasksAsync(SqliteConnection c,int keyId,CancellationToken ct){var result=new List<object>();await using var cmd=c.CreateCommand();cmd.CommandText="SELECT Id,TaskName,ManualStatus,PlannedStartDate,PlannedEndDate,ActualEndDate,Output,HasRisk,RiskDescription,ResponsiblePerson,Revision FROM KeyItemTasks WHERE KeyItemId=$key ORDER BY COALESCE(PlannedStartDate,PlannedEndDate),PlannedEndDate,TaskName";cmd.Parameters.AddValue("$key",keyId);await using var r=await cmd.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct)){var start=r.GetNullableString(3)??r.GetString(4);var plan=r.GetString(4);var actual=r.GetNullableString(5);result.Add(new{id=r.GetInt32(0),taskName=r.GetString(1),status=ResolveTaskStatus(r.GetString(2),plan,actual),plannedStartDate=start,plannedEndDate=plan,actualEndDate=actual,output=r.GetNullableString(6),hasRisk=r.GetInt32(7)==1,riskDescription=r.GetNullableString(8),responsiblePerson=r.GetString(9),revision=r.GetInt32(10)});}return result;}
    private static async Task EnsureNodeAsync(SqliteConnection c,SqliteTransaction tx,int id,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="SELECT COUNT(*) FROM ProjectPlanNodes WHERE Id=$id AND IsActive=1";cmd.Parameters.AddValue("$id",id);if(Convert.ToInt32(await cmd.ExecuteScalarAsync(ct))==0)throw new ArgumentException("请选择有效的整车项目计划节点。");}
    private static async Task EnsureKeyItemAsync(SqliteConnection c,SqliteTransaction tx,int id,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="SELECT COUNT(*) FROM KeyItems WHERE Id=$id";cmd.Parameters.AddValue("$id",id);if(Convert.ToInt32(await cmd.ExecuteScalarAsync(ct))==0)throw new KeyNotFoundException("关键事项不存在。");}
    private static void Bind(SqliteCommand cmd,KeyItemRequest r,string actor){cmd.Parameters.AddValue("$topic",r.Topic.Trim());cmd.Parameters.AddValue("$owner",r.ResponsiblePerson.Trim());cmd.Parameters.AddValue("$plan",r.PlannedEndDate);cmd.Parameters.AddValue("$actual",r.ActualEndDate);cmd.Parameters.AddValue("$status",r.ActualEndDate is null?r.Status:"NEW");cmd.Parameters.AddValue("$node",r.ProjectPlanNodeId);cmd.Parameters.AddValue("$actor",actor);cmd.Parameters.AddValue("$now",Now());}
    private static void BindTask(SqliteCommand cmd,int keyId,KeyItemTaskRequest r,string actor){if(keyId>0)cmd.Parameters.AddValue("$key",keyId);cmd.Parameters.AddValue("$name",r.TaskName.Trim());cmd.Parameters.AddValue("$status",r.ActualEndDate is null?r.Status:"NOT_STARTED");cmd.Parameters.AddValue("$start",r.PlannedStartDate);cmd.Parameters.AddValue("$plan",r.PlannedEndDate);cmd.Parameters.AddValue("$actual",r.ActualEndDate);cmd.Parameters.AddValue("$output",r.Output);cmd.Parameters.AddValue("$risk",r.HasRisk?1:0);cmd.Parameters.AddValue("$riskDesc",r.HasRisk?r.RiskDescription:null);cmd.Parameters.AddValue("$owner",r.ResponsiblePerson.Trim());cmd.Parameters.AddValue("$actor",actor);cmd.Parameters.AddValue("$now",Now());}
    private static void Validate(KeyItemRequest r){if(string.IsNullOrWhiteSpace(r.Topic)||string.IsNullOrWhiteSpace(r.ResponsiblePerson))throw new ArgumentException("主题和主责人不能为空。");ValidateDate(r.PlannedEndDate,"计划结束时间");if(r.ActualEndDate is not null)ValidateDate(r.ActualEndDate,"实际结束时间");if(r.ActualEndDate is null&&r.Status is not("NEW" or "IN_PROGRESS"))throw new ArgumentException("未完成关键事项只能设置为新增或进行中。");}
    private static void ValidateTask(KeyItemTaskRequest r){if(string.IsNullOrWhiteSpace(r.TaskName)||string.IsNullOrWhiteSpace(r.ResponsiblePerson))throw new ArgumentException("任务名称和负责人不能为空。");ValidateDate(r.PlannedStartDate,"任务计划开始时间");ValidateDate(r.PlannedEndDate,"任务计划结束时间");if(string.CompareOrdinal(r.PlannedStartDate,r.PlannedEndDate)>0)throw new ArgumentException("任务计划结束时间不能早于计划开始时间。");if(r.ActualEndDate is not null)ValidateDate(r.ActualEndDate,"任务实际结束时间");if(r.ActualEndDate is null&&r.Status is not("NOT_STARTED" or "IN_PROGRESS"))throw new ArgumentException("未完成任务只能设置为未开始或进行中。");}
    private static void ValidateDate(string value,string label){if(!DateOnly.TryParseExact(value,"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out _))throw new ArgumentException($"{label}格式无效。");}
    private static string ResolveStatus(string manual,string plan,string? actual)=>actual is not null?(string.CompareOrdinal(actual,plan)<=0?"ON_TIME_COMPLETED":"LATE_COMPLETED"):manual;
    private static string ResolveTaskStatus(string manual,string plan,string? actual)=>actual is not null?"COMPLETED":string.CompareOrdinal(plan,DateTime.UtcNow.ToString("yyyy-MM-dd"))<0?"OVERDUE":manual;
    private static int TaskCount(IReadOnlyDictionary<int,(int Count,int Risk)> summary,int id)=>summary.TryGetValue(id,out var item)?item.Count:0;
    private static int RiskCount(IReadOnlyDictionary<int,(int Count,int Risk)> summary,int id)=>summary.TryGetValue(id,out var item)?item.Risk:0;
    private static async Task AuditAsync(SqliteConnection c,SqliteTransaction tx,string type,int id,string action,string actor,string summary,CancellationToken ct){await using var cmd=c.CreateCommand();cmd.Transaction=tx;cmd.CommandText="INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES($type,$id,$action,$actor,$summary,$now)";cmd.Parameters.AddValue("$type",type);cmd.Parameters.AddValue("$id",id);cmd.Parameters.AddValue("$action",action);cmd.Parameters.AddValue("$actor",actor);cmd.Parameters.AddValue("$summary",summary);cmd.Parameters.AddValue("$now",Now());await cmd.ExecuteNonQueryAsync(ct);}
    private static string Now()=>DateTime.UtcNow.ToString("O");
    private sealed record KeyItemRow(int Id,string Topic,string ResponsiblePerson,string PlannedEndDate,string? ActualEndDate,string ManualStatus,int? NodeId,int Revision,string? ProjectName,string? VehicleModel,string? NodeName,int? NodeLevel,int? ParentId);
    private sealed record NodeRef(int Id,int? ParentId,int Level,string Name,string EndDate,string ProjectName,string? VehicleModel);
}
