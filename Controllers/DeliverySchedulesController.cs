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
        var deliverableScope = PermissionService.BuildDataScopePredicate("d", PermissionCatalog.DeliveryScheduleView);

        var projects = new List<object>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"SELECT p.Id,p.ProjectCode,p.ProjectName,p.VehicleModel FROM Projects p WHERE p.IsEnabled=1 AND {projectScope} ORDER BY p.ProjectCode";
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
                projects.Add(new { id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2), vehicleModel = reader.IsDBNull(3) ? null : reader.GetString(3) });
        }

        var selectedProjectId = projectId ?? projects.Select(x => (int)x.GetType().GetProperty("id")!.GetValue(x)!).FirstOrDefault();
        if (selectedProjectId <= 0)
            return Ok(new { warningDays = WarningDays, projects, selectedProjectId = (int?)null, summary = new { total = 0, configured = 0, unset = 0, dueSoon = 0, overdueUndelivered = 0, lateDelivered = 0, onTimeDelivered = 0, upcoming = 0 }, items = Array.Empty<object>() });

        var items = new List<ScheduleRow>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"""
                SELECT d.Id,d.DeliverableCode,d.UnifiedName,d.ResponsiblePerson,
                       t.Id,t.TypeCode,t.TypeName,t.SortOrder,
                       c.Id,c.CategoryCode,c.CategoryName,c.SortOrder,
                       s.PlannedDeliveryDate,
                       (SELECT MIN(v.CreatedAt) FROM DeliverableVersions v WHERE v.DeliverableId=d.Id) AS ActualDeliveryDate
                FROM Deliverables d
                JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
                JOIN DeliverableCategories c ON c.Id=d.CategoryId
                LEFT JOIN DeliverableSchedules s ON s.DeliverableId=d.Id
                WHERE d.ProjectId=$projectId AND d.LifecycleStatus='ACTIVE' AND {deliverableScope}
                ORDER BY t.SortOrder,c.SortOrder,d.UnifiedName,d.DeliverableCode;
                """;
            command.Parameters.AddWithValue("$projectId", selectedProjectId);
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var planned = reader.IsDBNull(12) ? null : reader.GetString(12);
                var actual = reader.IsDBNull(13) ? null : reader.GetString(13);
                var status = CalculateStatus(planned, actual);
                items.Add(new ScheduleRow(
                    reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                    reader.GetInt32(4), reader.GetString(5), reader.GetString(6),
                    reader.GetInt32(8), reader.GetString(9), reader.GetString(10),
                    planned, actual, status.Code, status.Days));
            }
        }

        var summary = new
        {
            total = items.Count,
            configured = items.Count(x => x.PlannedDeliveryDate is not null),
            unset = items.Count(x => x.Status == "UNSET"),
            dueSoon = items.Count(x => x.Status == "DUE_SOON"),
            overdueUndelivered = items.Count(x => x.Status == "OVERDUE_UNDELIVERED"),
            lateDelivered = items.Count(x => x.Status == "LATE_DELIVERED"),
            onTimeDelivered = items.Count(x => x.Status == "ON_TIME_DELIVERED"),
            upcoming = items.Count(x => x.Status == "UPCOMING")
        };

        return Ok(new { warningDays = WarningDays, projects, selectedProjectId, summary, items });
    }

    [HttpPut]
    public async Task<IActionResult> Save([FromBody] DeliveryScheduleSaveRequest request, CancellationToken ct)
    {
        if (request.DeliverableIds is null || request.DeliverableIds.Length == 0)
            return BadRequest(new { message = "请至少选择一个交付物。" });
        var ids = request.DeliverableIds.Distinct().Where(x => x > 0).ToArray();
        if (ids.Length == 0)
            return BadRequest(new { message = "交付物参数无效。" });

        string? planned = null;
        if (!string.IsNullOrWhiteSpace(request.PlannedDeliveryDate))
        {
            if (!DateOnly.TryParseExact(request.PlannedDeliveryDate.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
                return BadRequest(new { message = "计划交付日期格式无效。" });
            planned = parsed.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        var userId = User.GetUserId();
        foreach (var id in ids)
            if (!await _permissions.HasPermissionAsync(userId, PermissionCatalog.DeliveryScheduleEdit, id, ct))
                return StatusCode(403, new { message = "当前账号无权修改所选交付物的交付计划。" });

        await using var connection = await _database.OpenConnectionAsync(ct);
        using var transaction = connection.BeginTransaction();
        var now = DateTime.UtcNow.ToString("O");
        var operatorName = string.IsNullOrWhiteSpace(request.Operator) ? "系统用户" : request.Operator.Trim();

        foreach (var id in ids)
        {
            if (planned is null)
            {
                await using var delete = connection.CreateCommand();
                delete.Transaction = transaction;
                delete.CommandText = "DELETE FROM DeliverableSchedules WHERE DeliverableId=$id";
                delete.Parameters.AddWithValue("$id", id);
                await delete.ExecuteNonQueryAsync(ct);
            }
            else
            {
                await using var upsert = connection.CreateCommand();
                upsert.Transaction = transaction;
                upsert.CommandText = """
                    INSERT INTO DeliverableSchedules(DeliverableId,PlannedDeliveryDate,UpdatedBy,UpdatedAt,Revision)
                    VALUES($id,$date,$operator,$now,1)
                    ON CONFLICT(DeliverableId) DO UPDATE SET PlannedDeliveryDate=excluded.PlannedDeliveryDate,UpdatedBy=excluded.UpdatedBy,UpdatedAt=excluded.UpdatedAt,Revision=DeliverableSchedules.Revision+1;
                    """;
                upsert.Parameters.AddWithValue("$id", id);
                upsert.Parameters.AddWithValue("$date", planned);
                upsert.Parameters.AddWithValue("$operator", operatorName);
                upsert.Parameters.AddWithValue("$now", now);
                await upsert.ExecuteNonQueryAsync(ct);
            }

            await using var audit = connection.CreateCommand();
            audit.Transaction = transaction;
            audit.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,DetailJson,CreatedAt) VALUES('DeliverableSchedule',$id,$action,$operator,$summary,$detail,$now)";
            audit.Parameters.AddWithValue("$id", id);
            audit.Parameters.AddWithValue("$action", planned is null ? "CLEAR" : "SET");
            audit.Parameters.AddWithValue("$operator", operatorName);
            audit.Parameters.AddWithValue("$summary", planned is null ? "清除计划交付日期" : $"设置计划交付日期为 {planned}");
            audit.Parameters.AddWithValue("$detail", planned is null ? "{}" : $"{{\"plannedDeliveryDate\":\"{planned}\"}}");
            audit.Parameters.AddWithValue("$now", now);
            await audit.ExecuteNonQueryAsync(ct);
        }

        await transaction.CommitAsync(ct);
        return Ok(new { updated = ids.Length, plannedDeliveryDate = planned });
    }

    private static (string Code, int? Days) CalculateStatus(string? plannedValue, string? actualValue)
    {
        if (string.IsNullOrWhiteSpace(plannedValue)) return ("UNSET", null);
        var planned = DateOnly.Parse(plannedValue[..10], CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(actualValue))
        {
            var actual = DateOnly.FromDateTime(DateTime.Parse(actualValue, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));
            var delta = actual.DayNumber - planned.DayNumber;
            return delta <= 0 ? ("ON_TIME_DELIVERED", delta) : ("LATE_DELIVERED", delta);
        }

        var today = DateOnly.FromDateTime(DateTime.Now);
        var remaining = planned.DayNumber - today.DayNumber;
        if (remaining < 0) return ("OVERDUE_UNDELIVERED", -remaining);
        if (remaining <= WarningDays) return ("DUE_SOON", remaining);
        return ("UPCOMING", remaining);
    }

    public sealed class DeliveryScheduleSaveRequest
    {
        public int[] DeliverableIds { get; set; } = [];
        public string? PlannedDeliveryDate { get; set; }
        public string Operator { get; set; } = "系统用户";
    }

    private sealed record ScheduleRow(
        int Id, string Code, string Name, string ResponsiblePerson,
        int TypeId, string TypeCode, string TypeName,
        int CategoryId, string CategoryCode, string CategoryName,
        string? PlannedDeliveryDate, string? ActualDeliveryDate, string Status, int? Days);
}
