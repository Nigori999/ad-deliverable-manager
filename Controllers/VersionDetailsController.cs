using AdDeliverableManager.Security;
using AdDeliverableManager.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace AdDeliverableManager.Controllers;

[ApiController]
[Route("internal/version-details")]
[Authorize]
public sealed class VersionDetailsController : ControllerBase
{
    private readonly DatabaseService _database;

    public VersionDetailsController(DatabaseService database) => _database = database;

    [HttpGet("{versionId:int}")]
    public async Task<IActionResult> Get(int versionId, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT v.Id,v.DeliverableId,v.InternalVersion,v.OriginalVersion,v.OriginalFileName,v.UnifiedFileName,
                   v.PreviousVersionId,v.ServerPath,v.FileExtension,v.FileSize,v.HashAlgorithm,v.HashValue,
                   v.VersionStatus,v.ChangeSummary,v.ConfidentialityLevel,v.SharePolicy,v.Author,v.Reviewer,
                   v.Approver,v.PlannedReleaseDate,v.ReleaseDate,v.EffectiveDate,v.ExpiryDate,v.IsCurrent,
                   v.CreatedBy,v.CreatedAt,v.UpdatedAt,
                   d.DeliverableCode,d.UnifiedName,
                   t.TypeCode,t.TypeName,p.ProjectCode,p.ProjectName,
                   h.HardwareCategory,h.HardwareModel,h.SupplierName,h.SupplierPartNumber,h.InternalPartNumber,
                   h.SoftwarePackageType,h.CompatibleHardwareVersion,h.CompatiblePlatform,h.FlashMethod,h.FlashTool,
                   h.DependencyDescription,h.ReleaseNotePath,h.FlashGuidePath,h.Remark,
                   pd.ProductModule,pd.FunctionName,pd.RequirementSource,pd.TargetVehicle,pd.TargetProductVersion,
                   pd.TargetMilestone,pd.ProductOwner,pd.Reviewers,pd.ReferenceBasis,pd.InScope,pd.OutOfScope,
                   fd.SystemName,fd.SubsystemName,fd.FunctionModule,fd.UpstreamPrdCode,fd.UpstreamPrdVersion,
                   fd.FunctionOwner,fd.SystemOwner,fd.TargetSoftwareBaseline,fd.TargetMilestone,fd.InterfaceImpact,fd.SafetyLevel,
                   tc.TestLevel,tc.TestModule,tc.UpstreamFrCode,tc.UpstreamFrVersion,tc.CaseCount,tc.CoverageScope,
                   tc.TestEnvironment,tc.TestOwner,tc.ApplicableSoftwareVersion,tc.AutomatedCaseCount,tc.ManualCaseCount
            FROM DeliverableVersions v
            JOIN Deliverables d ON d.Id=v.DeliverableId
            JOIN DeliverableTypes t ON t.Id=d.DeliverableTypeId
            LEFT JOIN Projects p ON p.Id=d.ProjectId
            LEFT JOIN HardwarePackageDetails h ON h.VersionId=v.Id
            LEFT JOIN PrdDetails pd ON pd.VersionId=v.Id
            LEFT JOIN FrDetails fd ON fd.VersionId=v.Id
            LEFT JOIN TestCaseDetails tc ON tc.VersionId=v.Id
            WHERE v.Id=$id;
            """;
        command.Parameters.AddValue("$id", versionId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return NotFound(new { message = "版本不存在。" });

        object? Value(int index) => reader.IsDBNull(index) ? null : reader.GetValue(index);
        var typeCode = reader.GetString(28);

        var common = new Dictionary<string, object?>
        {
            ["id"] = Value(0), ["deliverableId"] = Value(1), ["internalVersion"] = Value(2),
            ["originalVersion"] = Value(3), ["originalFileName"] = Value(4), ["unifiedFileName"] = Value(5),
            ["previousVersionId"] = Value(6), ["serverPath"] = Value(7), ["fileExtension"] = Value(8),
            ["fileSize"] = Value(9), ["hashAlgorithm"] = Value(10), ["hashValue"] = Value(11),
            ["status"] = Value(12), ["changeSummary"] = Value(13), ["confidentiality"] = Value(14),
            ["sharePolicy"] = Value(15), ["author"] = Value(16), ["reviewer"] = Value(17),
            ["approver"] = Value(18), ["plannedReleaseDate"] = Value(19), ["releaseDate"] = Value(20),
            ["effectiveDate"] = Value(21), ["expiryDate"] = Value(22), ["isCurrent"] = Value(23),
            ["createdBy"] = Value(24), ["createdAt"] = Value(25), ["updatedAt"] = Value(26),
            ["deliverableCode"] = Value(27), ["deliverableName"] = Value(28),
            ["typeCode"] = typeCode, ["typeName"] = Value(29), ["projectCode"] = Value(30), ["projectName"] = Value(31)
        };

        object specific = typeCode switch
        {
            "SWP" => new Dictionary<string, object?>
            {
                ["硬件类别"] = Value(32), ["硬件型号"] = Value(33), ["供应商"] = Value(34), ["供应商零件号"] = Value(35),
                ["内部零件号"] = Value(36), ["软件包类型"] = Value(37), ["适配硬件版本"] = Value(38), ["适配平台"] = Value(39),
                ["刷写方式"] = Value(40), ["刷写工具"] = Value(41), ["依赖版本"] = Value(42), ["Release Note路径"] = Value(43),
                ["刷写说明路径"] = Value(44), ["备注"] = Value(45)
            },
            "PRD" => new Dictionary<string, object?>
            {
                ["产品模块"] = Value(46), ["功能名称"] = Value(47), ["需求来源"] = Value(48), ["目标车型"] = Value(49),
                ["目标产品版本"] = Value(50), ["目标节点"] = Value(51), ["产品负责人"] = Value(52), ["评审人"] = Value(53),
                ["参考依据"] = Value(54), ["范围内"] = Value(55), ["范围外"] = Value(56)
            },
            "FR" => new Dictionary<string, object?>
            {
                ["所属系统"] = Value(57), ["所属子系统"] = Value(58), ["功能模块"] = Value(59), ["上游PRD编码"] = Value(60),
                ["上游PRD版本"] = Value(61), ["功能负责人"] = Value(62), ["系统负责人"] = Value(63), ["目标软件基线"] = Value(64),
                ["目标节点"] = Value(65), ["接口影响"] = Value(66), ["安全等级"] = Value(67)
            },
            "TC" => new Dictionary<string, object?>
            {
                ["测试级别"] = Value(68), ["测试模块"] = Value(69), ["上游FR编码"] = Value(70), ["上游FR版本"] = Value(71),
                ["测试用例数量"] = Value(72), ["覆盖范围"] = Value(73), ["测试环境"] = Value(74), ["测试负责人"] = Value(75),
                ["适用软件版本"] = Value(76), ["自动化用例数量"] = Value(77), ["手工用例数量"] = Value(78)
            },
            _ => new Dictionary<string, object?>()
        };

        return Ok(new { common, specific });
    }
}
