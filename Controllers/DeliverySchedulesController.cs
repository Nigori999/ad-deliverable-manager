using System.Globalization;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/delivery-schedules")]
public sealed class DeliverySchedulesController : ControllerBase
{
    private const int WarningDays = 7;
    private readonly DatabaseService _database;
    private readonly PermissionService _permissions;

    public DeliverySchedulesController(DatabaseService database, PermissionService permissions)
    {
        _database = database;
        _permissions = permissions;
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] int? projectId, CancellationToken ct)
    {
        var userId = User.GetUserId();
        await using var connection = await _database.OpenConnectionAsync(ct);
        var projectScope = PermissionService.BuildReferenceScopePredicate(DataScopeCatalog.Project, "p.Id", PermissionCatalog.DeliveryScheduleView);

        var projects = new List<ProjectOption>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"SELECT p.Id,p.ProjectCode,p.ProjectName,p.VehicleModel FROM Projects p WHERE p.IsEnabled=1 AND {projectScope} ORDER BY p.ProjectCode";
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                projects.Add(new ProjectOption(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3)));
        }

        var selectedProjectId = projectId ?? projects.FirstOrDefault()?.Id;
        if (!selectedProjectId.HasValue)
            return Ok(new { warningDays = WarningDays, projects, selectedProjectId = (int?)null, summary = EmptySummary(), categories = Array.Empty<object>(), items = Array.Empty<object>() });
        if (projects.All(x => x.Id != selectedProjectId.Value))
            return StatusCode(403, new { message = "当前账号无权查看所选车型的交付计划。" });

        var categories = new List<CategoryOption>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT c.Id,c.CategoryCode,c.CategoryName,t.Id,t.TypeCode,t.TypeName,t.DepartmentId,t.SortOrder,c.SortOrder
                FROM DeliverableCategories c
                JOIN DeliverableTypes t ON t.Id=c.DeliverableTypeId
                WHERE c.IsEnabled=1 AND t.IsEnabled=1
                ORDER BY t.SortOrder,c.SortOrder,c.CategoryName;
                """;
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var categoryId = reader.GetInt32(0);
                var typeId = reader.GetInt32(3);
                var departmentId = reader.GetInt32(6);
                if (!await _permissions.HasCreateScopeAsync(userId, PermissionCatalog.DeliveryScheduleView,
                        departmentId, selectedProjectId.Value, typeId, ct)) continue;
                var canEdit = await _permissions.HasCreateScopeAsync(userId, PermissionCatalog.DeliveryScheduleEdit,
                    departmentId, selectedProjectId.Value, typeId, ct);
                categories.Add(new CategoryOption(
                    categoryId, reader.GetString(1), reader.GetString(2), typeId, reader.GetString(4), reader.GetString(5), departmentId, canEdit));
            }
        }

        var items = new List<ScheduleRow>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT p.Id,p.ProjectId,p.CategoryId,c.CategoryCode,c.CategoryName,
                       t.Id,t.TypeCode,t.TypeName,t.DepartmentId,p.PlannedDeliveryDate,
                       (SELECT MIN(v.CreatedAt)
                        FROM Deliverables d2
                        JOIN DeliverableVersions v ON v.DeliverableId=d2.Id
                        WHERE d2.ProjectId=p.ProjectId AND d2.CategoryId=p.CategoryId) AS ActualDeliveryDate,
                       (SELECT COUNT(*) FROM Deliverables d3 WHERE d3.ProjectId=p.ProjectId AND d3.CategoryId=p.CategoryId) AS MatchedDeliverables
                FROM ProjectDeliverablePlans p
                JOIN DeliverableCategories c ON c.Id=p.CategoryId
                JOIN DeliverableTypes t ON t.Id=c.DeliverableTypeId
                WHERE p.ProjectId=$projectId
                ORDER BY t.SortOrder,c.SortOrder,c.CategoryName;
                """;
            command.Parameters.AddWithValue("$projectId", selectedProjectId.Value);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var departmentId = reader.GetInt32(8);
                var typeId = reader.GetInt32(5);
                if (!await _permissions.HasCreateScopeAsync(userId, PermissionCatalog.DeliveryScheduleView,
                        departmentId, selectedProjectId.Value, typeId, ct)) continue;
                var canEdit = await _permissions.HasCreateScopeAsync(userId, PermissionCatalog.DeliveryScheduleEdit,
                    departmentId, selectedProjectId.Value, typeId, ct);
                var planned = reader.GetString(9);
                var actual = reader.IsDBNull(10) ? null : reader.GetString(10);
                var status = CalculateStatus(planned, actual);
                items.Add(new ScheduleRow(
                    reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetString(3), reader.GetString(4),
                    typeId, reader.GetString(6), reader.GetString(7), planned, actual, reader.GetInt32(11), status.Code, status.Days, canEdit));
            }
        }

        var plannedCategoryIds = items.Select(x => x.CategoryId).ToHashSet();
        var summary = new
        {
            total = items.Count,
            available = categories.Count(x => x.CanEdit && !plannedCategoryIds.Contains(x.Id)),
            dueSoon = items.Count(x => x.Status == "DUE_SOON"),
            overdueUndelivered = items.Count(x => x.Status == "OVERDUE_UNDELIVERED"),
            lateDelivered = items.Count(x => x.Status == "LATE_DELIVERED"),
            onTimeDelivered = items.Count(x => x.Status == "ON_TIME_DELIVERED"),
            upcoming = items.Count(x => x.Status == "UPCOMING")
        };

        return Ok(new { warningDays = WarningDays, projects, selectedProjectId, summary, categories, items });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreatePlansRequest request, CancellationToken ct)
    {
        if (request.ProjectId <= 0) return BadRequest(new { message = "请选择车型。" });
        if (request.Items is null || request.Items.Length == 0) return BadRequest(new { message = "请至少选择一个交付物类别。" });
        var normalized = request.Items.Where(x => x.CategoryId > 0).GroupBy(x => x.CategoryId).Select(x => x.Last()).ToArray();
        if (normalized.Length == 0) return BadRequest(new { message = "交付物类别参数无效。" });

        var userId = User.GetUserId();
        var operatorName = NormalizeOperator(request.Operator);
        await using var connection = await _database.OpenConnectionAsync(ct);
        await using (var projectCommand = connection.CreateCommand())
        {
            projectCommand.CommandText = "SELECT COUNT(*) FROM Projects WHERE Id=$id AND IsEnabled=1";
            projectCommand.Parameters.AddWithValue("$id", request.ProjectId);
            if (Convert.ToInt32(await projectCommand.ExecuteScalarAsync(ct)) == 0) return BadRequest(new { message = "所选车型不存在或已停用。" });
        }

        var validated = new List<(int CategoryId, string CategoryName, string Date)>();
        foreach (var item in normalized)
        {
            string date;
            try { date = ParseDate(item.PlannedDeliveryDate); }
            catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
            await using var categoryCommand = connection.CreateCommand();
            categoryCommand.CommandText = "SELECT c.CategoryName,t.Id,t.DepartmentId FROM DeliverableCategories c JOIN DeliverableTypes t ON t.Id=c.DeliverableTypeId WHERE c.Id=$id AND c.IsEnabled=1 AND t.IsEnabled=1";
            categoryCommand.Parameters.AddWithValue("$id", item.CategoryId);
            await using var reader = await categoryCommand.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return BadRequest(new { message = "所选交付物类别不存在或已停用。" });
            var categoryName = reader.GetString(0);var typeId = reader.GetInt32(1);var departmentId = reader.GetInt32(2);await reader.DisposeAsync();
            if (!await _permissions.HasCreateScopeAsync(userId, PermissionCatalog.DeliveryScheduleEdit, departmentId, request.ProjectId, typeId, ct))
                return StatusCode(403, new { message = $"当前账号无权为类别“{categoryName}”设置交付计划。" });
            await using var duplicate = connection.CreateCommand();
            duplicate.CommandText = "SELECT COUNT(*) FROM ProjectDeliverablePlans WHERE ProjectId=$projectId AND CategoryId=$categoryId";
            duplicate.Parameters.AddWithValue("$projectId", request.ProjectId);duplicate.Parameters.AddWithValue("$categoryId", item.CategoryId);
            if (Convert.ToInt32(await duplicate.ExecuteScalarAsync(ct)) > 0) return Conflict(new { message = $"类别“{categoryName}”已存在交付计划，请直接修改日期。" });
            validated.Add((item.CategoryId, categoryName, date));
        }

        using var transaction = connection.BeginTransaction();var now = DateTime.UtcNow.ToString("O");
        foreach (var item in validated)
        {
            await using var insert = connection.CreateCommand();insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO ProjectDeliverablePlans(ProjectId,CategoryId,PlannedDeliveryDate,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision) VALUES($projectId,$categoryId,$date,$operator,$now,$operator,$now,1) RETURNING Id";
            insert.Parameters.AddWithValue("$projectId", request.ProjectId);insert.Parameters.AddWithValue("$categoryId", item.CategoryId);insert.Parameters.AddWithValue("$date", item.Date);insert.Parameters.AddWithValue("$operator", operatorName);insert.Parameters.AddWithValue("$now", now);
            var planId = Convert.ToInt32(await insert.ExecuteScalarAsync(ct));
            await InsertAuditAsync(connection, transaction, planId, "CREATE", operatorName, $"新增车型交付计划：{item.CategoryName}，计划日期 {item.Date}", now, ct);
        }
        await transaction.CommitAsync(ct);return Ok(new { created = validated.Count });
    }

    [HttpPut]
    public async Task<IActionResult> UpdateDates([FromBody] UpdatePlanDatesRequest request, CancellationToken ct)
    {
        var ids = (request.PlanIds ?? []).Distinct().Where(x => x > 0).ToArray();if (ids.Length == 0) return BadRequest(new { message = "请至少选择一条交付计划。" });
        string date;try { date = ParseDate(request.PlannedDeliveryDate); }catch (ArgumentException ex) { return BadRequest(new { message = ex.Message }); }
        var operatorName = NormalizeOperator(request.Operator);var userId = User.GetUserId();await using var connection = await _database.OpenConnectionAsync(ct);
        List<PlanAccessRow> plans;try { plans = await ValidatePlanAccessAsync(connection, ids, userId, PermissionCatalog.DeliveryScheduleEdit, ct); }catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }catch (UnauthorizedAccessException ex) { return StatusCode(403, new { message = ex.Message }); }
        using var transaction = connection.BeginTransaction();var now = DateTime.UtcNow.ToString("O");
        foreach (var plan in plans)
        {
            await using var update = connection.CreateCommand();update.Transaction = transaction;update.CommandText = "UPDATE ProjectDeliverablePlans SET PlannedDeliveryDate=$date,UpdatedBy=$operator,UpdatedAt=$now,Revision=Revision+1 WHERE Id=$id";update.Parameters.AddWithValue("$date", date);update.Parameters.AddWithValue("$operator", operatorName);update.Parameters.AddWithValue("$now", now);update.Parameters.AddWithValue("$id", plan.Id);await update.ExecuteNonQueryAsync(ct);
            await InsertAuditAsync(connection, transaction, plan.Id, "UPDATE", operatorName, $"修改车型交付计划：{plan.CategoryName}，计划日期 {date}", now, ct);
        }
        await transaction.CommitAsync(ct);return Ok(new { updated = plans.Count, plannedDeliveryDate = date });
    }

    [HttpDelete]
    public async Task<IActionResult> Delete([FromBody] DeletePlansRequest request, CancellationToken ct)
    {
        var ids = (request.PlanIds ?? []).Distinct().Where(x => x > 0).ToArray();if (ids.Length == 0) return BadRequest(new { message = "请至少选择一条交付计划。" });
        var operatorName = NormalizeOperator(request.Operator);var userId = User.GetUserId();await using var connection = await _database.OpenConnectionAsync(ct);
        List<PlanAccessRow> plans;try { plans = await ValidatePlanAccessAsync(connection, ids, userId, PermissionCatalog.DeliveryScheduleEdit, ct); }catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }catch (UnauthorizedAccessException ex) { return StatusCode(403, new { message = ex.Message }); }
        using var transaction = connection.BeginTransaction();var now = DateTime.UtcNow.ToString("O");
        foreach (var plan in plans)
        {
            await using var delete = connection.CreateCommand();delete.Transaction = transaction;delete.CommandText = "DELETE FROM ProjectDeliverablePlans WHERE Id=$id";delete.Parameters.AddWithValue("$id", plan.Id);await delete.ExecuteNonQueryAsync(ct);
            await InsertAuditAsync(connection, transaction, plan.Id, "DELETE", operatorName, $"删除车型交付计划：{plan.CategoryName}", now, ct);
        }
        await transaction.CommitAsync(ct);return Ok(new { deleted = plans.Count });
    }

    private async Task<List<PlanAccessRow>> ValidatePlanAccessAsync(Microsoft.Data.Sqlite.SqliteConnection connection, int[] ids, int userId, string permissionCode, CancellationToken ct)
    {
        var result = new List<PlanAccessRow>();
        foreach (var id in ids)
        {
            await using var command = connection.CreateCommand();command.CommandText = "SELECT p.Id,p.ProjectId,c.CategoryName,t.Id,t.DepartmentId FROM ProjectDeliverablePlans p JOIN DeliverableCategories c ON c.Id=p.CategoryId JOIN DeliverableTypes t ON t.Id=c.DeliverableTypeId WHERE p.Id=$id";command.Parameters.AddWithValue("$id", id);
            await using var reader = await command.ExecuteReaderAsync(ct);if (!await reader.ReadAsync(ct)) throw new KeyNotFoundException("交付计划不存在或已被删除。");var row = new PlanAccessRow(reader.GetInt32(0), reader.GetInt32(1), reader.GetString(2), reader.GetInt32(3), reader.GetInt32(4));await reader.DisposeAsync();
            if (!await _permissions.HasCreateScopeAsync(userId, permissionCode, row.DepartmentId, row.ProjectId, row.TypeId, ct)) throw new UnauthorizedAccessException($"当前账号无权修改交付计划“{row.CategoryName}”。");result.Add(row);
        }
        return result;
    }

    private static string ParseDate(string? value){if(string.IsNullOrWhiteSpace(value)||!DateOnly.TryParseExact(value.Trim(),"yyyy-MM-dd",CultureInfo.InvariantCulture,DateTimeStyles.None,out var date))throw new ArgumentException("计划交付日期格式无效。");return date.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture);}
    private static string NormalizeOperator(string? value)=>string.IsNullOrWhiteSpace(value)?"系统用户":value.Trim();
    private static async Task InsertAuditAsync(Microsoft.Data.Sqlite.SqliteConnection connection,Microsoft.Data.Sqlite.SqliteTransaction transaction,int planId,string action,string operatorName,string summary,string now,CancellationToken ct){await using var audit=connection.CreateCommand();audit.Transaction=transaction;audit.CommandText="INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,DetailJson,CreatedAt) VALUES('ProjectDeliverablePlan',$id,$action,$operator,$summary,'{}',$now)";audit.Parameters.AddWithValue("$id",planId);audit.Parameters.AddWithValue("$action",action);audit.Parameters.AddWithValue("$operator",operatorName);audit.Parameters.AddWithValue("$summary",summary);audit.Parameters.AddWithValue("$now",now);await audit.ExecuteNonQueryAsync(ct);}
    private static (string Code,int Days) CalculateStatus(string plannedValue,string? actualValue){var planned=DateOnly.Parse(plannedValue[..10],CultureInfo.InvariantCulture);if(!string.IsNullOrWhiteSpace(actualValue)){var actual=DateOnly.FromDateTime(DateTime.Parse(actualValue,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind));var delta=actual.DayNumber-planned.DayNumber;return delta<=0?("ON_TIME_DELIVERED",delta):("LATE_DELIVERED",delta);}var today=DateOnly.FromDateTime(DateTime.Now);var remaining=planned.DayNumber-today.DayNumber;if(remaining<0)return("OVERDUE_UNDELIVERED",-remaining);if(remaining<=WarningDays)return("DUE_SOON",remaining);return("UPCOMING",remaining);}
    private static object EmptySummary()=>new{total=0,available=0,dueSoon=0,overdueUndelivered=0,lateDelivered=0,onTimeDelivered=0,upcoming=0};

    public sealed class CreatePlansRequest{public int ProjectId{get;set;}public CreatePlanItem[] Items{get;set;}=[];public string Operator{get;set;}="系统用户";}
    public sealed class CreatePlanItem{public int CategoryId{get;set;}public string PlannedDeliveryDate{get;set;}="";}
    public sealed class UpdatePlanDatesRequest{public int[] PlanIds{get;set;}=[];public string PlannedDeliveryDate{get;set;}="";public string Operator{get;set;}="系统用户";}
    public sealed class DeletePlansRequest{public int[] PlanIds{get;set;}=[];public string Operator{get;set;}="系统用户";}
    private sealed record ProjectOption(int Id,string Code,string Name,string? VehicleModel);
    private sealed record CategoryOption(int Id,string Code,string Name,int TypeId,string TypeCode,string TypeName,int DepartmentId,bool CanEdit);
    private sealed record ScheduleRow(int Id,int ProjectId,int CategoryId,string CategoryCode,string CategoryName,int TypeId,string TypeCode,string TypeName,string PlannedDeliveryDate,string? ActualDeliveryDate,int MatchedDeliverables,string Status,int Days,bool CanEdit);
    private sealed record PlanAccessRow(int Id,int ProjectId,string CategoryName,int TypeId,int DepartmentId);
}
