using System.Text;
using AdDeliverableManager.Models;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/exports")]
[Authorize]
public sealed class ExportsController : ControllerBase
{
    private readonly DatabaseService _database;

    private static readonly IReadOnlyDictionary<string, string> DeliverableFields = new Dictionary<string, string>
    {
        ["code"]="交付物编码", ["name"]="统一名称", ["department"]="所属部门", ["type"]="交付物类型",
        ["project"]="项目/车型", ["objectCode"]="对象编码", ["businessModule"]="业务模块",
        ["currentVersion"]="当前版本", ["versionStatus"]="版本状态", ["originalVersion"]="原始版本",
        ["originalFileName"]="原始文件名", ["serverPath"]="服务器路径", ["responsiblePerson"]="责任人",
        ["confidentiality"]="私密等级", ["sharePolicy"]="对外分享策略", ["author"]="编制/提供人",
        ["releaseDate"]="发布日期", ["updatedAt"]="最近更新时间"
    };

    private static readonly IReadOnlyDictionary<string, string> ChangeFields = new Dictionary<string, string>
    {
        ["code"]="变更编号", ["deliverableCode"]="交付物编码", ["deliverableName"]="交付物名称",
        ["changeType"]="变更类型", ["reason"]="变更原因", ["content"]="变更内容", ["impactScope"]="影响范围",
        ["relatedIssueCode"]="关联需求/问题", ["applicant"]="提出人", ["responsiblePerson"]="责任人",
        ["status"]="变更状态", ["reviewer"]="评审人", ["reviewOpinion"]="评审意见",
        ["plannedCompletionDate"]="计划完成日期", ["actualCompletionDate"]="实际完成日期",
        ["createdAt"]="创建时间", ["updatedAt"]="更新时间"
    };

    public ExportsController(DatabaseService database) => _database = database;

    [HttpGet("fields")]
    public IActionResult Fields() => Ok(new
    {
        deliverables = DeliverableFields.Select(x => new { code=x.Key, name=x.Value }),
        changes = ChangeFields.Select(x => new { code=x.Key, name=x.Value })
    });

    [HttpPost("deliverables")]
    public async Task<IActionResult> Deliverables([FromBody] DeliverableExportRequest request, CancellationToken cancellationToken)
    {
        var fields = ValidateFields(request.Fields, DeliverableFields, ["code","name","department","type","project","currentVersion","versionStatus","responsiblePerson"]);
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        var where = new StringBuilder(" WHERE d.LifecycleStatus <> 'ARCHIVED' ");
        var parameters = new List<(string Name, object? Value)>();
        if (!string.IsNullOrWhiteSpace(request.Keyword))
        {
            where.Append(" AND (d.DeliverableCode LIKE $keyword OR d.UnifiedName LIKE $keyword OR d.ObjectCode LIKE $keyword OR d.ResponsiblePerson LIKE $keyword) ");
            parameters.Add(("$keyword", $"%{request.Keyword.Trim()}%"));
        }
        if (request.DepartmentId.HasValue) { where.Append(" AND d.DepartmentId=$departmentId "); parameters.Add(("$departmentId", request.DepartmentId)); }
        if (request.TypeId.HasValue) { where.Append(" AND d.DeliverableTypeId=$typeId "); parameters.Add(("$typeId", request.TypeId)); }
        if (request.ProjectId.HasValue) { where.Append(" AND d.ProjectId=$projectId "); parameters.Add(("$projectId", request.ProjectId)); }
        if (!string.IsNullOrWhiteSpace(request.Status)) { where.Append(" AND COALESCE(v.VersionStatus,'NO_VERSION')=$status "); parameters.Add(("$status", request.Status)); }
        if (!string.IsNullOrWhiteSpace(request.Confidentiality)) { where.Append(" AND d.DefaultConfidentiality=$confidentiality "); parameters.Add(("$confidentiality", request.Confidentiality)); }
        if (!string.IsNullOrWhiteSpace(request.SharePolicy)) { where.Append(" AND d.DefaultSharePolicy=$sharePolicy "); parameters.Add(("$sharePolicy", request.SharePolicy)); }

        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT d.DeliverableCode,d.UnifiedName,dep.DepartmentName,t.TypeName,p.ProjectName,d.ObjectCode,d.BusinessModule,
                   v.InternalVersion,v.VersionStatus,v.OriginalVersion,v.OriginalFileName,v.ServerPath,d.ResponsiblePerson,
                   d.DefaultConfidentiality,d.DefaultSharePolicy,v.Author,v.ReleaseDate,d.UpdatedAt
            FROM Deliverables d
            JOIN Departments dep ON dep.Id=d.DepartmentId JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
            JOIN Projects p ON p.Id=d.ProjectId LEFT JOIN DeliverableVersions v ON v.Id=d.CurrentVersionId
            {where} ORDER BY dep.SortOrder,p.ProjectCode,t.SortOrder,d.DeliverableCode;
            """;
        foreach (var (name,value) in parameters) command.Parameters.AddValue(name,value);
        var rows = new List<IReadOnlyDictionary<string, object?>>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new Dictionary<string, object?>
            {
                ["code"]=reader.GetString(0), ["name"]=reader.GetString(1), ["department"]=reader.GetString(2),
                ["type"]=reader.GetString(3), ["project"]=reader.GetString(4), ["objectCode"]=reader.GetString(5),
                ["businessModule"]=reader.GetNullableString(6), ["currentVersion"]=reader.GetNullableString(7),
                ["versionStatus"]=reader.GetNullableString(8), ["originalVersion"]=reader.GetNullableString(9),
                ["originalFileName"]=reader.GetNullableString(10), ["serverPath"]=reader.GetNullableString(11),
                ["responsiblePerson"]=reader.GetString(12), ["confidentiality"]=reader.GetString(13),
                ["sharePolicy"]=reader.GetString(14), ["author"]=reader.GetNullableString(15),
                ["releaseDate"]=reader.GetNullableString(16), ["updatedAt"]=reader.GetString(17)
            });
        }
        return File(CsvService.Build(fields, DeliverableFields, rows), "text/csv; charset=utf-8", $"deliverables_{DateTime.Now:yyyyMMdd_HHmmss}.csv");
    }

    [HttpPost("changes")]
    public async Task<IActionResult> Changes([FromBody] ChangeExportRequest request, CancellationToken cancellationToken)
    {
        var fields = ValidateFields(request.Fields, ChangeFields, ["code","deliverableCode","deliverableName","reason","status","responsiblePerson","updatedAt"]);
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.ChangeCode,d.DeliverableCode,d.UnifiedName,c.ChangeType,c.ChangeReason,c.ChangeContent,c.ImpactScope,
                   c.RelatedIssueCode,c.Applicant,c.ResponsiblePerson,c.ChangeStatus,c.Reviewer,c.ReviewOpinion,
                   c.PlannedCompletionDate,c.ActualCompletionDate,c.CreatedAt,c.UpdatedAt
            FROM ChangeRecords c JOIN Deliverables d ON d.Id=c.DeliverableId
            WHERE ($status IS NULL OR $status='' OR c.ChangeStatus=$status) ORDER BY c.UpdatedAt DESC;
            """;
        command.Parameters.AddValue("$status", request.Status);
        var rows = new List<IReadOnlyDictionary<string, object?>>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            rows.Add(new Dictionary<string, object?>
            {
                ["code"]=reader.GetString(0), ["deliverableCode"]=reader.GetString(1), ["deliverableName"]=reader.GetString(2),
                ["changeType"]=reader.GetString(3), ["reason"]=reader.GetString(4), ["content"]=reader.GetString(5),
                ["impactScope"]=reader.GetNullableString(6), ["relatedIssueCode"]=reader.GetNullableString(7),
                ["applicant"]=reader.GetString(8), ["responsiblePerson"]=reader.GetString(9), ["status"]=reader.GetString(10),
                ["reviewer"]=reader.GetNullableString(11), ["reviewOpinion"]=reader.GetNullableString(12),
                ["plannedCompletionDate"]=reader.GetNullableString(13), ["actualCompletionDate"]=reader.GetNullableString(14),
                ["createdAt"]=reader.GetString(15), ["updatedAt"]=reader.GetString(16)
            });
        }
        return File(CsvService.Build(fields, ChangeFields, rows), "text/csv; charset=utf-8", $"changes_{DateTime.Now:yyyyMMdd_HHmmss}.csv");
    }

    private static string[] ValidateFields(string[] requested, IReadOnlyDictionary<string,string> allowed, string[] defaults)
    {
        var fields = requested.Where(allowed.ContainsKey).Distinct(StringComparer.Ordinal).ToArray();
        return fields.Length > 0 ? fields : defaults;
    }
}
