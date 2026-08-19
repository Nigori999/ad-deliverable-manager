using AdDeliverableManager.Models;
using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/analytics")]
[Authorize]
public sealed class AnalyticsController : ControllerBase
{
    private readonly DatabaseService _database;
    public AnalyticsController(DatabaseService database) => _database = database;

    [HttpGet("completeness")]
    public async Task<IActionResult> Completeness(CancellationToken ct)
    {
        await using var connection = await _database.OpenConnectionAsync(ct);
        var userId = User.GetUserId();
        var dataScope = PermissionService.BuildDataScopePredicate("d", PermissionCatalog.AnalyticsView);
        var rows = await LoadMetadataRowsAsync(connection, userId, dataScope, ct);
        var totalChecks = rows.Sum(x => x.TotalChecks);
        var completedChecks = rows.Sum(x => x.CompletedChecks);
        var metadataPercent = Percent(completedChecks, totalChecks);

        var projects = await LoadProjectsAsync(connection, userId, ct);
        var types = await LoadTypesAsync(connection, userId, ct);
        var categories = await LoadCategoriesAsync(connection, userId, ct);
        var actualCoverage = await LoadActualCoverageAsync(connection, userId, dataScope, ct);
        var projectCompleteness = new List<ProjectCompletenessItem>();
        foreach (var project in projects)
        {
            var typeRows = new List<TypeCompletenessItem>();
            var projectExpected = 0;
            var projectCovered = 0;
            foreach (var type in types)
            {
                var expected = categories.Where(x => x.TypeCode == type.Code).ToArray();
                if (expected.Length == 0) continue;
                var actual = actualCoverage.Where(x => x.ProjectId == project.Id && x.TypeCode == type.Code).Select(x => x.CategoryCode).ToHashSet(StringComparer.OrdinalIgnoreCase);
                var missing = expected.Where(x => !actual.Contains(x.Code)).Select(x => new MissingCategory(x.Code, x.Name)).ToArray();
                var covered = expected.Length - missing.Length;
                projectExpected += expected.Length;
                projectCovered += covered;
                typeRows.Add(new TypeCompletenessItem(type.Code, type.Name, expected.Length, covered, Percent(covered, expected.Length), missing));
            }
            projectCompleteness.Add(new ProjectCompletenessItem(project.Id, project.Code, project.Name, projectExpected, projectCovered, Percent(projectCovered, projectExpected), typeRows.ToArray()));
        }

        var typeSet = types.Select(x => x.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var prdToFr = typeSet.Contains("PRD") && typeSet.Contains("FR") ? await LoadRelationTraceAsync(connection, userId, "PRD", "FR", "DERIVES", ct) : TraceResult.Unavailable("当前数据范围未同时包含 PRD 与 FR");
        var frToTc = typeSet.Contains("FR") && typeSet.Contains("TC") ? await LoadRelationTraceAsync(connection, userId, "FR", "TC", "VERIFIES", ct, bidirectional: true) : TraceResult.Unavailable("当前数据范围未同时包含 FR 与测试用例");
        var swpToTr = typeSet.Contains("SWP") && typeSet.Contains("TR") ? await LoadSwpTestReportTraceAsync(connection, userId, ct) : TraceResult.Unavailable("当前数据范围未同时包含硬件软件包与测试报告");

        var pendingReview = await ScalarAsync(connection, $"SELECT COUNT(*) FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId WHERE v.VersionStatus='IN_REVIEW' AND {dataScope}", userId, ct);
        var pendingChanges = await ScalarAsync(connection, $"SELECT COUNT(*) FROM ChangeRecords c JOIN Deliverables d ON d.Id=c.DeliverableId WHERE c.ChangeStatus NOT IN ('CLOSED','REJECTED') AND {dataScope}", userId, ct);
        var stale = rows.Count(x => DateTime.TryParse(x.UpdatedAt, out var date) && date < DateTime.UtcNow.AddDays(-90));
        var metadataIssues = rows.Where(x => x.MissingFields.Length > 0 || (DateTime.TryParse(x.UpdatedAt, out var date) && date < DateTime.UtcNow.AddDays(-90)))
            .Select(x => new { kind = "METADATA", x.Id, x.Code, x.Name, x.Department, x.Type, x.Category, x.Project, percent = Percent(x.CompletedChecks, x.TotalChecks), missing = x.MissingFields, x.UpdatedAt }).OrderBy(x => x.percent).ThenBy(x => x.Code).Take(100).ToArray();

        var projectPercent = projectCompleteness.Count == 0 ? 100 : (int)Math.Round(projectCompleteness.Average(x => x.Percent));
        var collaborationValues = new[] { prdToFr, frToTc, swpToTr }.Where(x => x.Available).Select(x => x.Percent).ToArray();
        var collaborationPercent = collaborationValues.Length == 0 ? 100 : (int)Math.Round(collaborationValues.Average());

        return Ok(new
        {
            summary = new { deliverables = rows.Count, metadataPercent, completeDeliverables = rows.Count(x => x.MissingFields.Length == 0), projectPercent, collaborationPercent, pendingReview, pendingChanges, stale },
            projectCompleteness,
            collaboration = new { prdToFr, frToTestCase = frToTc, swpToTestReport = swpToTr },
            metadataIssues
        });
    }

    private async Task<List<CompletionItem>> LoadMetadataRowsAsync(SqliteConnection connection, int userId, string scope, CancellationToken ct)
    {
        var rows = new List<CompletionItem>();
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT d.Id,d.DeliverableCode,d.UnifiedName,dep.DepartmentName,t.TypeCode,t.TypeName,cat.CategoryName,p.ProjectName,
                   d.ResponsiblePerson,d.DefaultConfidentiality,d.DefaultSharePolicy,d.UpdatedAt,
                   v.Id,v.InternalVersion,v.OriginalFileName,v.ServerPath,v.Author,v.VersionStatus,v.HashValue,
                   h.HardwareModel,h.SupplierName,h.SoftwarePackageType,
                   prd.ProductModule,prd.FunctionName,prd.ProductOwner,
                   fr.SystemName,fr.SubsystemName,fr.FunctionModule,fr.FunctionOwner,fr.SystemOwner,
                   tc.TestLevel,tc.TestModule,tc.CaseCount,tc.TestOwner
            FROM Deliverables d
            JOIN Departments dep ON dep.Id=d.DepartmentId JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
            JOIN DeliverableCategories cat ON cat.Id=d.CategoryId JOIN Projects p ON p.Id=d.ProjectId
            LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId LEFT JOIN HardwarePackageDetails h ON h.VersionId=v.Id
            LEFT JOIN PrdDetails prd ON prd.VersionId=v.Id LEFT JOIN FrDetails fr ON fr.VersionId=v.Id LEFT JOIN TestCaseDetails tc ON tc.VersionId=v.Id
            WHERE d.LifecycleStatus='ACTIVE' AND {scope}
            ORDER BY p.ProjectCode,t.SortOrder,cat.SortOrder,d.DeliverableCode;
            """;
        command.Parameters.AddWithValue("$scopeUserId", userId);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var required = new List<(string Name, bool Complete)> { ("交付物类别",Has(reader,6)),("责任人",Has(reader,8)),("私密等级",Has(reader,9)),("分享策略",Has(reader,10)),("当前版本",!reader.IsDBNull(12)),("内部版本",Has(reader,13)),("原始文件名",Has(reader,14)),("服务器路径",Has(reader,15)),("编制/提供人",Has(reader,16)) };
            var typeCode = reader.GetString(4);
            if (typeCode == "SWP") required.AddRange([("硬件型号",Has(reader,19)),("供应商",Has(reader,20)),("软件包类型",Has(reader,21)),("校验值",Has(reader,18))]);
            else if (typeCode == "PRD") required.AddRange([("产品模块",Has(reader,22)),("功能名称",Has(reader,23)),("产品负责人",Has(reader,24))]);
            else if (typeCode == "FR") required.AddRange([("所属系统",Has(reader,25)),("所属子系统",Has(reader,26)),("功能模块",Has(reader,27)),("功能负责人",Has(reader,28)),("系统负责人",Has(reader,29))]);
            else if (typeCode == "TC") required.AddRange([("测试级别",Has(reader,30)),("测试模块",Has(reader,31)),("用例数量",!reader.IsDBNull(32)),("测试负责人",Has(reader,33))]);
            var completed = required.Count(x => x.Complete);
            rows.Add(new CompletionItem(reader.GetInt32(0),reader.GetString(1),reader.GetString(2),reader.GetString(3),typeCode,reader.GetString(5),reader.GetString(6),reader.GetString(7),completed,required.Count,required.Where(x=>!x.Complete).Select(x=>x.Name).ToArray(),reader.GetString(11)));
        }
        return rows;
    }

    private static async Task<List<ProjectItem>> LoadProjectsAsync(SqliteConnection connection,int userId,CancellationToken ct)
    {
        var scope=PermissionService.BuildReferenceScopePredicate(DataScopeCatalog.Project,"p.Id",PermissionCatalog.AnalyticsView);var list=new List<ProjectItem>();await using var cmd=connection.CreateCommand();cmd.CommandText=$"SELECT p.Id,p.ProjectCode,p.ProjectName FROM Projects p WHERE p.IsEnabled=1 AND {scope} ORDER BY p.ProjectCode";cmd.Parameters.AddWithValue("$scopeUserId",userId);await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct))list.Add(new(reader.GetInt32(0),reader.GetString(1),reader.GetString(2)));return list;
    }
    private static async Task<List<TypeItem>> LoadTypesAsync(SqliteConnection connection,int userId,CancellationToken ct)
    {
        var scope=PermissionService.BuildReferenceScopePredicate(DataScopeCatalog.Type,"t.Id",PermissionCatalog.AnalyticsView);var list=new List<TypeItem>();await using var cmd=connection.CreateCommand();cmd.CommandText=$"SELECT t.Id,t.TypeCode,t.TypeName FROM DeliverableTypes t WHERE t.IsEnabled=1 AND {scope} ORDER BY t.SortOrder,t.TypeName";cmd.Parameters.AddWithValue("$scopeUserId",userId);await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct))list.Add(new(reader.GetInt32(0),reader.GetString(1),reader.GetString(2)));return list;
    }
    private static async Task<List<CategoryItem>> LoadCategoriesAsync(SqliteConnection connection,int userId,CancellationToken ct)
    {
        var scope=PermissionService.BuildReferenceScopePredicate(DataScopeCatalog.Type,"t.Id",PermissionCatalog.AnalyticsView);var list=new List<CategoryItem>();await using var cmd=connection.CreateCommand();cmd.CommandText=$"SELECT t.TypeCode,c.CategoryCode,c.CategoryName FROM DeliverableCategories c JOIN DeliverableTypes t ON t.Id=c.DeliverableTypeId WHERE c.IsEnabled=1 AND t.IsEnabled=1 AND {scope} ORDER BY t.SortOrder,c.SortOrder,c.CategoryName";cmd.Parameters.AddWithValue("$scopeUserId",userId);await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct))list.Add(new(reader.GetString(0),reader.GetString(1),reader.GetString(2)));return list;
    }
    private static async Task<List<CoverageItem>> LoadActualCoverageAsync(SqliteConnection connection,int userId,string scope,CancellationToken ct)
    {
        var list=new List<CoverageItem>();await using var cmd=connection.CreateCommand();cmd.CommandText=$"SELECT DISTINCT d.ProjectId,t.TypeCode,cat.CategoryCode FROM Deliverables d JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId JOIN DeliverableCategories cat ON cat.Id=d.CategoryId WHERE d.LifecycleStatus='ACTIVE' AND {scope}";cmd.Parameters.AddWithValue("$scopeUserId",userId);await using var reader=await cmd.ExecuteReaderAsync(ct);while(await reader.ReadAsync(ct))list.Add(new(reader.GetInt32(0),reader.GetString(1),reader.GetString(2)));return list;
    }

    private static async Task<TraceResult> LoadRelationTraceAsync(SqliteConnection connection,int userId,string sourceType,string targetType,string relationType,CancellationToken ct,bool bidirectional=false)
    {
        var scope=PermissionService.BuildDataScopePredicate("d",PermissionCatalog.AnalyticsView);
        var otherScope=PermissionService.BuildDataScopePredicate("o",PermissionCatalog.AnalyticsView);
        var total=await ScalarAsync(connection,$"SELECT COUNT(*) FROM Deliverables d JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId WHERE d.LifecycleStatus='ACTIVE' AND t.TypeCode='{sourceType}' AND {scope}",userId,ct);
        var linkedSql=bidirectional?$"SELECT COUNT(DISTINCT d.Id) FROM Deliverables d JOIN DeliverableTypes st ON st.Id=d.DeliverableTypeId JOIN DeliverableRelations r ON (r.SourceDeliverableId=d.Id OR r.TargetDeliverableId=d.Id) JOIN Deliverables o ON o.Id=CASE WHEN r.SourceDeliverableId=d.Id THEN r.TargetDeliverableId ELSE r.SourceDeliverableId END JOIN DeliverableTypes ot ON ot.Id=o.DeliverableTypeId WHERE d.LifecycleStatus='ACTIVE' AND o.LifecycleStatus='ACTIVE' AND st.TypeCode='{sourceType}' AND ot.TypeCode='{targetType}' AND r.RelationType='{relationType}' AND {scope} AND {otherScope}":$"SELECT COUNT(DISTINCT d.Id) FROM Deliverables d JOIN DeliverableTypes st ON st.Id=d.DeliverableTypeId JOIN DeliverableRelations r ON r.SourceDeliverableId=d.Id JOIN Deliverables o ON o.Id=r.TargetDeliverableId JOIN DeliverableTypes ot ON ot.Id=o.DeliverableTypeId WHERE d.LifecycleStatus='ACTIVE' AND o.LifecycleStatus='ACTIVE' AND st.TypeCode='{sourceType}' AND ot.TypeCode='{targetType}' AND r.RelationType='{relationType}' AND {scope} AND {otherScope}";
        var linked=await ScalarAsync(connection,linkedSql,userId,ct);return new TraceResult(true,total,linked,Percent(linked,total),null,[]);
    }

    private static async Task<TraceResult> LoadSwpTestReportTraceAsync(SqliteConnection connection,int userId,CancellationToken ct)
    {
        var swpScope=PermissionService.BuildDataScopePredicate("d",PermissionCatalog.AnalyticsView);var trScope=PermissionService.BuildDataScopePredicate("tr",PermissionCatalog.AnalyticsView);var details=new List<SwpTestReportDetail>();await using var cmd=connection.CreateCommand();cmd.CommandText=$"""
            SELECT p.Id,p.ProjectCode,p.ProjectName,cat.CategoryCode,cat.CategoryName,
                   CASE WHEN EXISTS(
                       SELECT 1 FROM Deliverables tr JOIN DeliverableTypes tt ON tt.Id=tr.DeliverableTypeId JOIN DeliverableCategories tc ON tc.Id=tr.CategoryId
                       WHERE tr.ProjectId=d.ProjectId AND tr.LifecycleStatus='ACTIVE' AND tt.TypeCode='TR' AND tc.CategoryCode=cat.CategoryCode AND {trScope}
                   ) THEN 1 ELSE 0 END AS HasReport
            FROM Deliverables d JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId JOIN DeliverableCategories cat ON cat.Id=d.CategoryId JOIN Projects p ON p.Id=d.ProjectId
            WHERE d.LifecycleStatus='ACTIVE' AND t.TypeCode='SWP' AND {swpScope}
            GROUP BY p.Id,p.ProjectCode,p.ProjectName,cat.CategoryCode,cat.CategoryName ORDER BY p.ProjectCode,cat.CategoryName;
            """;cmd.Parameters.AddWithValue("$scopeUserId",userId);await using var reader=await cmd.ExecuteReaderAsync(ct);var total=0;var linked=0;while(await reader.ReadAsync(ct)){var ok=reader.GetInt32(5)==1;total++;if(ok)linked++;details.Add(new(reader.GetInt32(0),reader.GetString(1),reader.GetString(2),reader.GetString(3),reader.GetString(4),ok));}return new TraceResult(true,total,linked,Percent(linked,total),"按同一车型、同一硬件类别编码检查是否存在测试报告，不要求每个软件版本都有独立报告。",details.Cast<object>().ToArray());
    }

    private static bool Has(SqliteDataReader reader,int ordinal)=>!reader.IsDBNull(ordinal)&&!string.IsNullOrWhiteSpace(Convert.ToString(reader.GetValue(ordinal)));
    private static int Percent(int complete,int total)=>total<=0?100:(int)Math.Round(complete*100d/total);
    private static async Task<int> ScalarAsync(SqliteConnection connection,string sql,int userId,CancellationToken ct){await using var command=connection.CreateCommand();command.CommandText=sql;command.Parameters.AddWithValue("$scopeUserId",userId);return Convert.ToInt32(await command.ExecuteScalarAsync(ct));}
    private sealed record CompletionItem(int Id,string Code,string Name,string Department,string TypeCode,string Type,string Category,string Project,int CompletedChecks,int TotalChecks,string[] MissingFields,string UpdatedAt);
    private sealed record ProjectItem(int Id,string Code,string Name);
    private sealed record TypeItem(int Id,string Code,string Name);
    private sealed record CategoryItem(string TypeCode,string Code,string Name);
    private sealed record CoverageItem(int ProjectId,string TypeCode,string CategoryCode);
    private sealed record MissingCategory(string Code,string Name);
    private sealed record TypeCompletenessItem(string TypeCode,string TypeName,int Expected,int Covered,int Percent,MissingCategory[] Missing);
    private sealed record ProjectCompletenessItem(int ProjectId,string ProjectCode,string ProjectName,int Expected,int Covered,int Percent,TypeCompletenessItem[] Types);
    private sealed record SwpTestReportDetail(int ProjectId,string ProjectCode,string ProjectName,string CategoryCode,string CategoryName,bool HasTestReport);
    private sealed record TraceResult(bool Available,int Total,int Linked,int Percent,string? Note,object[] Details)
    {
        public static TraceResult Unavailable(string note)=>new(false,0,0,100,note,[]);
    }
}
