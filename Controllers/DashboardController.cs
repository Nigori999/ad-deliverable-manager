using System.Globalization;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/dashboard")]
public sealed class DashboardController : ControllerBase
{
    private const int DeliveryWarningDays = 7;
    private readonly DatabaseService _database;
    private readonly PermissionService _permissions;

    public DashboardController(DatabaseService database, PermissionService permissions)
    {
        _database = database;
        _permissions = permissions;
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        var scope = PermissionService.BuildDataScopePredicate("d", PermissionCatalog.DashboardView);

        async Task<long> ScalarAsync(string sql)
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Parameters.AddWithValue("$scopeUserId", userId);
            return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken) ?? 0);
        }

        async Task<List<object>> GroupAsync(string sql)
        {
            var result = new List<object>();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) result.Add(new { name = reader.GetString(0), value = reader.GetInt64(1) });
            return result;
        }

        var totalDeliverables = await ScalarAsync($"SELECT COUNT(*) FROM Deliverables d WHERE d.LifecycleStatus='ACTIVE' AND {scope}");
        var currentVersions = await ScalarAsync($"SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE v.IsCurrent=1 AND v.VersionStatus='RELEASED' AND {scope}");
        var pendingReview = await ScalarAsync($"SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE v.VersionStatus='IN_REVIEW' AND {scope}");
        var monthlyNewVersions = await ScalarAsync($"SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE substr(v.CreatedAt,1,7)=substr(datetime('now'),1,7) AND {scope}");
        var monthlyChanges = await ScalarAsync($"SELECT COUNT(*) FROM ChangeRecords c JOIN Deliverables d ON d.Id=c.DeliverableId WHERE substr(c.CreatedAt,1,7)=substr(datetime('now'),1,7) AND {scope}");
        var deprecatedVersions = await ScalarAsync($"SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE v.VersionStatus='DEPRECATED' AND {scope}");

        var departmentDistribution = await GroupAsync($"SELECT d.DepartmentName,COUNT(x.Id) FROM Departments d LEFT JOIN Deliverables x ON x.DepartmentId=d.Id AND x.LifecycleStatus='ACTIVE' AND {PermissionService.BuildDataScopePredicate("x", PermissionCatalog.DashboardView)} WHERE d.IsEnabled=1 GROUP BY d.Id,d.DepartmentName ORDER BY d.SortOrder;");
        var typeDistribution = await GroupAsync($"SELECT t.TypeName,COUNT(x.Id) FROM DeliverableTypes t LEFT JOIN Deliverables x ON x.DeliverableTypeId=t.Id AND x.LifecycleStatus='ACTIVE' AND {PermissionService.BuildDataScopePredicate("x", PermissionCatalog.DashboardView)} WHERE t.IsEnabled=1 GROUP BY t.Id,t.TypeName ORDER BY t.SortOrder;");
        var statusDistribution = await GroupAsync($"SELECT CASE v.VersionStatus WHEN 'DRAFT' THEN '草稿' WHEN 'IN_REVIEW' THEN '评审中' WHEN 'RELEASED' THEN '已发布' WHEN 'SUPERSEDED' THEN '已替代' WHEN 'DEPRECATED' THEN '已废止' ELSE v.VersionStatus END,COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE {scope} GROUP BY v.VersionStatus ORDER BY COUNT(*) DESC;");

        var monthlyTrend = new List<object>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"""
                WITH RECURSIVE months(n,month) AS (
                    SELECT 5,strftime('%Y-%m','now','start of month','-5 months')
                    UNION ALL SELECT n-1,strftime('%Y-%m','now','start of month',printf('-%d months',n-1)) FROM months WHERE n>0)
                SELECT month,
                    (SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE substr(v.CreatedAt,1,7)=month AND {scope}) AS NewVersions,
                    (SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE substr(v.ReleaseDate,1,7)=month AND {scope}) AS ReleasedVersions,
                    (SELECT COUNT(*) FROM ChangeRecords c JOIN Deliverables d ON d.Id=c.DeliverableId WHERE substr(c.CreatedAt,1,7)=month AND {scope}) AS Changes
                FROM months ORDER BY month;
                """;
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                monthlyTrend.Add(new { month = reader.GetString(0), newVersions = reader.GetInt64(1), releasedVersions = reader.GetInt64(2), changes = reader.GetInt64(3) });
        }

        var recent = new List<object>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = $"SELECT d.Id,d.DeliverableCode,d.UnifiedName,v.InternalVersion,v.VersionStatus,v.UpdatedAt FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE {scope} ORDER BY v.UpdatedAt DESC LIMIT 8;";
            command.Parameters.AddWithValue("$scopeUserId", userId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                recent.Add(new { id = reader.GetInt32(0), code = reader.GetString(1), name = reader.GetString(2), version = reader.GetString(3), status = reader.GetString(4), updatedAt = reader.GetString(5) });
        }

        var deliveryPlans = new List<DeliveryPlanSnapshot>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT plan.Id,plan.ProjectId,c.CategoryName,t.TypeName,t.Id,t.DepartmentId,
                       p.ProjectName,p.VehicleModel,plan.PlannedDeliveryDate,
                       (SELECT MIN(v.CreatedAt)
                        FROM Deliverables d2
                        JOIN DeliverableVersions v ON v.DeliverableId=d2.Id
                        WHERE d2.ProjectId=plan.ProjectId AND d2.CategoryId=plan.CategoryId) AS ActualDeliveryDate
                FROM ProjectDeliverablePlans plan
                JOIN Projects p ON p.Id=plan.ProjectId
                JOIN DeliverableCategories c ON c.Id=plan.CategoryId
                JOIN DeliverableTypes t ON t.Id=c.DeliverableTypeId;
                """;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var projectId = reader.GetInt32(1);
                var typeId = reader.GetInt32(4);
                var departmentId = reader.GetInt32(5);
                if (!await _permissions.HasCreateScopeAsync(userId, PermissionCatalog.DashboardView, departmentId, projectId, typeId, cancellationToken)) continue;
                var planned = reader.GetString(8);
                var actual = reader.IsDBNull(9) ? null : reader.GetString(9);
                var status = CalculateDeliveryStatus(planned, actual);
                deliveryPlans.Add(new DeliveryPlanSnapshot(
                    reader.GetInt32(0), projectId, reader.GetString(2), reader.GetString(3), reader.GetString(6),
                    reader.IsDBNull(7) ? null : reader.GetString(7), planned, actual, status.Code, status.Days));
            }
        }

        var deliverySummary = new
        {
            dueSoon = deliveryPlans.Count(x => x.Status == "DUE_SOON"),
            overdueUndelivered = deliveryPlans.Count(x => x.Status == "OVERDUE_UNDELIVERED"),
            lateDelivered = deliveryPlans.Count(x => x.Status == "LATE_DELIVERED"),
            onTimeDelivered = deliveryPlans.Count(x => x.Status == "ON_TIME_DELIVERED")
        };
        var deliveryRisks = deliveryPlans
            .Where(x => x.Status is "DUE_SOON" or "OVERDUE_UNDELIVERED")
            .OrderBy(x => x.Status == "OVERDUE_UNDELIVERED" ? 0 : 1)
            .ThenBy(x => x.PlannedDeliveryDate)
            .Take(8)
            .Select(x => new
            {
                id = x.Id,
                projectId = x.ProjectId,
                name = x.CategoryName,
                typeName = x.TypeName,
                projectName = x.ProjectName,
                vehicleModel = x.VehicleModel,
                plannedDeliveryDate = x.PlannedDeliveryDate,
                status = x.Status,
                days = x.Days
            })
            .ToList();

        return Ok(new
        {
            summary = new { totalDeliverables, currentVersions, pendingReview, monthlyNewVersions, monthlyChanges, deprecatedVersions },
            deliverySummary,
            deliveryRisks,
            departmentDistribution,
            typeDistribution,
            statusDistribution,
            monthlyTrend,
            recent
        });
    }

    private static (string Code, int Days) CalculateDeliveryStatus(string plannedValue, string? actualValue)
    {
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
        if (remaining <= DeliveryWarningDays) return ("DUE_SOON", remaining);
        return ("UPCOMING", remaining);
    }

    private sealed record DeliveryPlanSnapshot(
        int Id, int ProjectId, string CategoryName, string TypeName, string ProjectName, string? VehicleModel,
        string PlannedDeliveryDate, string? ActualDeliveryDate, string Status, int Days);
}
