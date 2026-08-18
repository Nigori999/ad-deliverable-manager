using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/analytics")]
[Authorize]
public sealed class AnalyticsController : ControllerBase
{
    private readonly DatabaseService _database;
    public AnalyticsController(DatabaseService database) => _database = database;

    [HttpGet("completeness")]
    public async Task<IActionResult> Completeness(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        var rows = new List<CompletionItem>();
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = """
                SELECT d.Id,d.DeliverableCode,d.UnifiedName,dep.DepartmentName,t.TypeCode,t.TypeName,cat.CategoryName,p.ProjectName,
                       d.ResponsiblePerson,d.DefaultConfidentiality,d.DefaultSharePolicy,d.UpdatedAt,
                       v.Id,v.InternalVersion,v.OriginalFileName,v.ServerPath,v.Author,v.VersionStatus,v.HashValue,
                       h.HardwareModel,h.SupplierName,h.SoftwarePackageType,
                       prd.ProductModule,prd.FunctionName,prd.ProductOwner,
                       fr.SystemName,fr.SubsystemName,fr.FunctionModule,fr.FunctionOwner,fr.SystemOwner,
                       tc.TestLevel,tc.TestModule,tc.CaseCount,tc.TestOwner
                FROM Deliverables d
                JOIN Departments dep ON dep.Id=d.DepartmentId JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
                JOIN DeliverableCategories cat ON cat.Id=d.CategoryId
                JOIN Projects p ON p.Id=d.ProjectId LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId
                LEFT JOIN HardwarePackageDetails h ON h.VersionId=v.Id LEFT JOIN PrdDetails prd ON prd.VersionId=v.Id
                LEFT JOIN FrDetails fr ON fr.VersionId=v.Id LEFT JOIN TestCaseDetails tc ON tc.VersionId=v.Id
                WHERE d.LifecycleStatus='ACTIVE' ORDER BY dep.SortOrder,p.ProjectCode,t.SortOrder,cat.SortOrder,d.DeliverableCode;
                """;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var required = new List<(string Name, bool Complete)>
                {
                    ("交付物类别",Has(reader,6)),("责任人",Has(reader,8)),("私密等级",Has(reader,9)),
                    ("分享策略",Has(reader,10)),("当前版本",!reader.IsDBNull(12)),("内部版本",Has(reader,13)),
                    ("原始文件名",Has(reader,14)),("服务器路径",Has(reader,15)),("编制/提供人",Has(reader,16))
                };
                var typeCode = reader.GetString(4);
                if (typeCode == "SWP")
                {
                    required.AddRange([("硬件型号",Has(reader,19)),("供应商",Has(reader,20)),("软件包类型",Has(reader,21)),("校验值",Has(reader,18))]);
                }
                else if (typeCode == "PRD")
                    required.AddRange([("产品模块",Has(reader,22)),("功能名称",Has(reader,23)),("产品负责人",Has(reader,24))]);
                else if (typeCode == "FR")
                    required.AddRange([("所属系统",Has(reader,25)),("所属子系统",Has(reader,26)),("功能模块",Has(reader,27)),("功能负责人",Has(reader,28)),("系统负责人",Has(reader,29))]);
                else if (typeCode == "TC")
                    required.AddRange([("测试级别",Has(reader,30)),("测试模块",Has(reader,31)),("用例数量",!reader.IsDBNull(32)),("测试负责人",Has(reader,33))]);

                var completed = required.Count(x => x.Complete);
                rows.Add(new CompletionItem(reader.GetInt32(0),reader.GetString(1),reader.GetString(2),reader.GetString(3),
                    typeCode,reader.GetString(5),reader.GetString(6),reader.GetString(7),completed,required.Count,
                    required.Where(x=>!x.Complete).Select(x=>x.Name).ToArray(),reader.GetString(11),reader.GetNullableString(17)));
            }
        }

        var totalChecks=rows.Sum(x=>x.TotalChecks);var completedChecks=rows.Sum(x=>x.CompletedChecks);var metadataPercent=Percent(completedChecks,totalChecks);
        var departmentCompleteness=rows.GroupBy(x=>x.Department).Select(g=>new{name=g.Key,total=g.Count(),complete=g.Count(x=>x.MissingFields.Length==0),percent=Percent(g.Sum(x=>x.CompletedChecks),g.Sum(x=>x.TotalChecks))}).ToArray();
        var prdTotal=await ScalarAsync(connection,"SELECT COUNT(*) FROM Deliverables d JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId WHERE d.LifecycleStatus='ACTIVE' AND t.TypeCode='PRD'",cancellationToken);
        var prdLinked=await ScalarAsync(connection,"SELECT COUNT(DISTINCT p.Id) FROM Deliverables p JOIN DeliverableTypes pt ON pt.Id=p.DeliverableTypeId JOIN DeliverableRelations r ON r.SourceDeliverableId=p.Id JOIN Deliverables f ON f.Id=r.TargetDeliverableId JOIN DeliverableTypes ft ON ft.Id=f.DeliverableTypeId WHERE p.LifecycleStatus='ACTIVE' AND pt.TypeCode='PRD' AND ft.TypeCode='FR' AND r.RelationType='DERIVES'",cancellationToken);
        var frTotal=await ScalarAsync(connection,"SELECT COUNT(*) FROM Deliverables d JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId WHERE d.LifecycleStatus='ACTIVE' AND t.TypeCode='FR'",cancellationToken);
        var frLinked=await ScalarAsync(connection,"SELECT COUNT(DISTINCT f.Id) FROM Deliverables f JOIN DeliverableTypes ft ON ft.Id=f.DeliverableTypeId JOIN DeliverableRelations r ON (r.SourceDeliverableId=f.Id OR r.TargetDeliverableId=f.Id) JOIN Deliverables other ON other.Id=CASE WHEN r.SourceDeliverableId=f.Id THEN r.TargetDeliverableId ELSE r.SourceDeliverableId END JOIN DeliverableTypes ot ON ot.Id=other.DeliverableTypeId WHERE f.LifecycleStatus='ACTIVE' AND ft.TypeCode='FR' AND ot.TypeCode='TC' AND r.RelationType='VERIFIES'",cancellationToken);

        var expectedHardware=new List<(int Id,string Name)>();
        await using(var ec=connection.CreateCommand())
        {
            ec.CommandText="SELECT c.Id,c.CategoryName FROM DeliverableCategories c JOIN DeliverableTypes t ON t.Id=c.DeliverableTypeId WHERE c.IsEnabled=1 AND t.TypeCode='SWP' ORDER BY c.SortOrder,c.CategoryName";
            await using var er=await ec.ExecuteReaderAsync(cancellationToken);while(await er.ReadAsync(cancellationToken))expectedHardware.Add((er.GetInt32(0),er.GetString(1)));
        }
        var hardwareCoverage=new List<object>();
        await using(var projects=connection.CreateCommand())
        {
            projects.CommandText="SELECT Id,ProjectCode,ProjectName FROM Projects WHERE IsEnabled=1 ORDER BY ProjectCode";
            await using var reader=await projects.ExecuteReaderAsync(cancellationToken);var projectList=new List<(int Id,string Code,string Name)>();while(await reader.ReadAsync(cancellationToken))projectList.Add((reader.GetInt32(0),reader.GetString(1),reader.GetString(2)));await reader.DisposeAsync();
            foreach(var project in projectList)
            {
                await using var categories=connection.CreateCommand();categories.CommandText="SELECT DISTINCT cat.Id,cat.CategoryName FROM Deliverables d JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId JOIN DeliverableCategories cat ON cat.Id=d.CategoryId JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId WHERE d.ProjectId=$projectId AND d.LifecycleStatus='ACTIVE' AND t.TypeCode='SWP' AND v.VersionStatus='RELEASED'";categories.Parameters.AddValue("$projectId",project.Id);
                var actualIds=new HashSet<int>();var actualNames=new List<string>();await using var cr=await categories.ExecuteReaderAsync(cancellationToken);while(await cr.ReadAsync(cancellationToken)){actualIds.Add(cr.GetInt32(0));actualNames.Add(cr.GetString(1));}
                hardwareCoverage.Add(new{projectId=project.Id,projectCode=project.Code,projectName=project.Name,covered=actualIds.Count,expected=expectedHardware.Count,percent=Percent(actualIds.Count,expectedHardware.Count),actual=actualNames,missing=expectedHardware.Where(x=>!actualIds.Contains(x.Id)).Select(x=>x.Name).ToArray()});
            }
        }

        var pendingReview=await ScalarAsync(connection,"SELECT COUNT(*) FROM DeliverableVersions WHERE VersionStatus='IN_REVIEW'",cancellationToken);var pendingChanges=await ScalarAsync(connection,"SELECT COUNT(*) FROM ChangeRecords WHERE ChangeStatus NOT IN ('CLOSED','REJECTED')",cancellationToken);var missingCurrent=rows.Count(x=>x.MissingFields.Contains("当前版本"));var stale=rows.Count(x=>DateTime.TryParse(x.UpdatedAt,out var d)&&d<DateTime.UtcNow.AddDays(-90));
        var issueRows=rows.Where(x=>x.MissingFields.Length>0||(DateTime.TryParse(x.UpdatedAt,out var d)&&d<DateTime.UtcNow.AddDays(-90))).Select(x=>new{x.Id,x.Code,x.Name,x.Department,x.Type,x.Category,x.Project,percent=Percent(x.CompletedChecks,x.TotalChecks),missing=x.MissingFields,x.UpdatedAt}).OrderBy(x=>x.percent).ThenBy(x=>x.Code).Take(100).ToArray();
        return Ok(new{summary=new{deliverables=rows.Count,metadataPercent,completeDeliverables=rows.Count(x=>x.MissingFields.Length==0),prdTracePercent=Percent(prdLinked,prdTotal),frTestTracePercent=Percent(frLinked,frTotal),pendingReview,pendingChanges,missingCurrent,stale},departmentCompleteness,traceability=new{prdToFr=new{total=prdTotal,linked=prdLinked,percent=Percent(prdLinked,prdTotal)},frToTestCase=new{total=frTotal,linked=frLinked,percent=Percent(frLinked,frTotal)}},hardwareCoverage,hardwareCategoryCount=expectedHardware.Count,issues=issueRows});
    }

    private static bool Has(Microsoft.Data.Sqlite.SqliteDataReader reader,int ordinal)=>!reader.IsDBNull(ordinal)&&!string.IsNullOrWhiteSpace(Convert.ToString(reader.GetValue(ordinal)));
    private static int Percent(int complete,int total)=>total<=0?100:(int)Math.Round(complete*100d/total);
    private static async Task<int> ScalarAsync(Microsoft.Data.Sqlite.SqliteConnection connection,string sql,CancellationToken cancellationToken){await using var command=connection.CreateCommand();command.CommandText=sql;return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));}
    private sealed record CompletionItem(int Id,string Code,string Name,string Department,string TypeCode,string Type,string Category,string Project,int CompletedChecks,int TotalChecks,string[] MissingFields,string UpdatedAt,string? VersionStatus);
}
