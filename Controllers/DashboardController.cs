using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/dashboard")]
public sealed class DashboardController : ControllerBase
{
    private readonly DatabaseService _database;
    public DashboardController(DatabaseService database)=>_database=database;

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        await using var connection=await _database.OpenConnectionAsync(cancellationToken);var scope=PermissionService.BuildDataScopePredicate("d",PermissionCatalog.DashboardView);
        async Task<long> ScalarAsync(string sql){await using var command=connection.CreateCommand();command.CommandText=sql;command.Parameters.AddWithValue("$scopeUserId",User.GetUserId());return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken)??0);}
        async Task<List<object>> GroupAsync(string sql){var result=new List<object>();await using var command=connection.CreateCommand();command.CommandText=sql;command.Parameters.AddWithValue("$scopeUserId",User.GetUserId());await using var reader=await command.ExecuteReaderAsync(cancellationToken);while(await reader.ReadAsync(cancellationToken))result.Add(new{name=reader.GetString(0),value=reader.GetInt64(1)});return result;}

        var totalDeliverables=await ScalarAsync($"SELECT COUNT(*) FROM Deliverables d WHERE d.LifecycleStatus='ACTIVE' AND {scope}");
        var currentVersions=await ScalarAsync($"SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE v.IsCurrent=1 AND v.VersionStatus='RELEASED' AND {scope}");
        var pendingReview=await ScalarAsync($"SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE v.VersionStatus='IN_REVIEW' AND {scope}");
        var monthlyNewVersions=await ScalarAsync($"SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE substr(v.CreatedAt,1,7)=substr(datetime('now'),1,7) AND {scope}");
        var monthlyChanges=await ScalarAsync($"SELECT COUNT(*) FROM ChangeRecords c JOIN Deliverables d ON d.Id=c.DeliverableId WHERE substr(c.CreatedAt,1,7)=substr(datetime('now'),1,7) AND {scope}");
        var deprecatedVersions=await ScalarAsync($"SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE v.VersionStatus='DEPRECATED' AND {scope}");

        var departmentDistribution=await GroupAsync($"SELECT d.DepartmentName,COUNT(x.Id) FROM Departments d LEFT JOIN Deliverables x ON x.DepartmentId=d.Id AND x.LifecycleStatus='ACTIVE' AND {PermissionService.BuildDataScopePredicate("x",PermissionCatalog.DashboardView)} WHERE d.IsEnabled=1 GROUP BY d.Id,d.DepartmentName ORDER BY d.SortOrder;");
        var typeDistribution=await GroupAsync($"SELECT t.TypeName,COUNT(x.Id) FROM DeliverableTypes t LEFT JOIN Deliverables x ON x.DeliverableTypeId=t.Id AND x.LifecycleStatus='ACTIVE' AND {PermissionService.BuildDataScopePredicate("x",PermissionCatalog.DashboardView)} WHERE t.IsEnabled=1 GROUP BY t.Id,t.TypeName ORDER BY t.SortOrder;");
        var statusDistribution=await GroupAsync($"SELECT CASE v.VersionStatus WHEN 'DRAFT' THEN '草稿' WHEN 'IN_REVIEW' THEN '评审中' WHEN 'RELEASED' THEN '已发布' WHEN 'SUPERSEDED' THEN '已替代' WHEN 'DEPRECATED' THEN '已废止' ELSE v.VersionStatus END,COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE {scope} GROUP BY v.VersionStatus ORDER BY COUNT(*) DESC;");

        var monthlyTrend=new List<object>();await using(var command=connection.CreateCommand()){
            command.CommandText=$"""
                WITH RECURSIVE months(n,month) AS (
                    SELECT 5,strftime('%Y-%m','now','start of month','-5 months')
                    UNION ALL SELECT n-1,strftime('%Y-%m','now','start of month',printf('-%d months',n-1)) FROM months WHERE n>0)
                SELECT month,
                    (SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE substr(v.CreatedAt,1,7)=month AND {scope}) AS NewVersions,
                    (SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE substr(v.ReleaseDate,1,7)=month AND {scope}) AS ReleasedVersions,
                    (SELECT COUNT(*) FROM ChangeRecords c JOIN Deliverables d ON d.Id=c.DeliverableId WHERE substr(c.CreatedAt,1,7)=month AND {scope}) AS Changes
                FROM months ORDER BY month;
                """;command.Parameters.AddWithValue("$scopeUserId",User.GetUserId());await using var reader=await command.ExecuteReaderAsync(cancellationToken);while(await reader.ReadAsync(cancellationToken))monthlyTrend.Add(new{month=reader.GetString(0),newVersions=reader.GetInt64(1),releasedVersions=reader.GetInt64(2),changes=reader.GetInt64(3)});
        }
        var recent=new List<object>();await using(var command=connection.CreateCommand()){
            command.CommandText=$"SELECT d.Id,d.DeliverableCode,d.UnifiedName,v.InternalVersion,v.VersionStatus,v.UpdatedAt FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE {scope} ORDER BY v.UpdatedAt DESC LIMIT 8;";command.Parameters.AddWithValue("$scopeUserId",User.GetUserId());await using var reader=await command.ExecuteReaderAsync(cancellationToken);while(await reader.ReadAsync(cancellationToken))recent.Add(new{id=reader.GetInt32(0),code=reader.GetString(1),name=reader.GetString(2),version=reader.GetString(3),status=reader.GetString(4),updatedAt=reader.GetString(5)});
        }

        var deliveryStatus=new Dictionary<string,long>(StringComparer.OrdinalIgnoreCase)
        {
            ["DUE_SOON"]=0,["OVERDUE_UNDELIVERED"]=0,["LATE_DELIVERED"]=0,["ON_TIME_DELIVERED"]=0
        };
        var deliveryRisks=new List<object>();
        await using(var command=connection.CreateCommand()){
            command.CommandText=$"""
                WITH delivery AS (
                    SELECT d.Id,d.DeliverableCode,d.UnifiedName,d.ResponsiblePerson,p.ProjectName,p.VehicleModel,
                           s.PlannedDeliveryDate,
                           (SELECT MIN(v.CreatedAt) FROM DeliverableVersions v WHERE v.DeliverableId=d.Id) AS ActualDeliveryDate
                    FROM Deliverables d
                    JOIN Projects p ON p.Id=d.ProjectId
                    JOIN DeliverableSchedules s ON s.DeliverableId=d.Id
                    WHERE d.LifecycleStatus='ACTIVE' AND {scope}
                ), classified AS (
                    SELECT *,CASE
                        WHEN ActualDeliveryDate IS NOT NULL AND date(ActualDeliveryDate)<=date(PlannedDeliveryDate) THEN 'ON_TIME_DELIVERED'
                        WHEN ActualDeliveryDate IS NOT NULL AND date(ActualDeliveryDate)>date(PlannedDeliveryDate) THEN 'LATE_DELIVERED'
                        WHEN date(PlannedDeliveryDate)<date('now','localtime') THEN 'OVERDUE_UNDELIVERED'
                        WHEN date(PlannedDeliveryDate)<=date('now','localtime','+7 day') THEN 'DUE_SOON'
                        ELSE 'UPCOMING' END AS DeliveryStatus
                    FROM delivery
                )
                SELECT DeliveryStatus,COUNT(*) FROM classified
                WHERE DeliveryStatus IN ('DUE_SOON','OVERDUE_UNDELIVERED','LATE_DELIVERED','ON_TIME_DELIVERED')
                GROUP BY DeliveryStatus;
                """;
            command.Parameters.AddWithValue("$scopeUserId",User.GetUserId());
            await using var reader=await command.ExecuteReaderAsync(cancellationToken);
            while(await reader.ReadAsync(cancellationToken))deliveryStatus[reader.GetString(0)]=reader.GetInt64(1);
        }
        await using(var command=connection.CreateCommand()){
            command.CommandText=$"""
                WITH delivery AS (
                    SELECT d.Id,d.DeliverableCode,d.UnifiedName,d.ResponsiblePerson,p.ProjectName,p.VehicleModel,
                           s.PlannedDeliveryDate,
                           (SELECT MIN(v.CreatedAt) FROM DeliverableVersions v WHERE v.DeliverableId=d.Id) AS ActualDeliveryDate
                    FROM Deliverables d
                    JOIN Projects p ON p.Id=d.ProjectId
                    JOIN DeliverableSchedules s ON s.DeliverableId=d.Id
                    WHERE d.LifecycleStatus='ACTIVE' AND {scope}
                ), classified AS (
                    SELECT *,CASE
                        WHEN ActualDeliveryDate IS NOT NULL THEN NULL
                        WHEN date(PlannedDeliveryDate)<date('now','localtime') THEN 'OVERDUE_UNDELIVERED'
                        WHEN date(PlannedDeliveryDate)<=date('now','localtime','+7 day') THEN 'DUE_SOON'
                        ELSE NULL END AS DeliveryStatus
                    FROM delivery
                )
                SELECT Id,DeliverableCode,UnifiedName,ResponsiblePerson,ProjectName,VehicleModel,PlannedDeliveryDate,DeliveryStatus,
                       CAST(julianday(date('now','localtime'))-julianday(date(PlannedDeliveryDate)) AS INTEGER) AS DeltaDays
                FROM classified WHERE DeliveryStatus IS NOT NULL
                ORDER BY CASE DeliveryStatus WHEN 'OVERDUE_UNDELIVERED' THEN 0 ELSE 1 END,PlannedDeliveryDate
                LIMIT 8;
                """;
            command.Parameters.AddWithValue("$scopeUserId",User.GetUserId());
            await using var reader=await command.ExecuteReaderAsync(cancellationToken);
            while(await reader.ReadAsync(cancellationToken))deliveryRisks.Add(new{id=reader.GetInt32(0),code=reader.GetString(1),name=reader.GetString(2),responsiblePerson=reader.GetString(3),projectName=reader.GetString(4),vehicleModel=reader.IsDBNull(5)?null:reader.GetString(5),plannedDeliveryDate=reader.GetString(6),status=reader.GetString(7),deltaDays=reader.GetInt32(8)});
        }

        return Ok(new{summary=new{totalDeliverables,currentVersions,pendingReview,monthlyNewVersions,monthlyChanges,deprecatedVersions},deliverySummary=new{dueSoon=deliveryStatus["DUE_SOON"],overdueUndelivered=deliveryStatus["OVERDUE_UNDELIVERED"],lateDelivered=deliveryStatus["LATE_DELIVERED"],onTimeDelivered=deliveryStatus["ON_TIME_DELIVERED"]},deliveryRisks,departmentDistribution,typeDistribution,statusDistribution,monthlyTrend,recent});
    }
}
