using System.Text;
using AdDeliverableManager.Models;
using Microsoft.Data.Sqlite;

namespace AdDeliverableManager.Services;

public sealed partial class DeliverableRepository
{
    private static async Task InsertHardwareAsync(SqliteConnection connection, SqliteTransaction transaction, int versionId, HardwarePackageRequest x, CancellationToken ct)
    {
        await using var c = connection.CreateCommand(); c.Transaction = transaction;
        c.CommandText = """
            INSERT INTO HardwarePackageDetails(VersionId,HardwareCategory,HardwareModel,SupplierName,SupplierPartNumber,
                InternalPartNumber,SoftwarePackageType,CompatibleHardwareVersion,CompatiblePlatform,FlashMethod,FlashTool,
                DependencyDescription,ReleaseNotePath,FlashGuidePath,Remark)
            SELECT $id,cat.CategoryCode,$model,$supplier,$supplierPart,$internalPart,$packageType,$hardwareVersion,$platform,
                $flashMethod,$flashTool,$dependency,$releaseNote,$flashGuide,$remark
            FROM DeliverableVersions v JOIN Deliverables d ON d.Id=v.DeliverableId JOIN DeliverableCategories cat ON cat.Id=d.CategoryId
            WHERE v.Id=$id;
            """;
        c.Parameters.AddValue("$id", versionId);
        c.Parameters.AddValue("$model", x.HardwareModel); c.Parameters.AddValue("$supplier", x.SupplierName);
        c.Parameters.AddValue("$supplierPart", x.SupplierPartNumber); c.Parameters.AddValue("$internalPart", x.InternalPartNumber);
        c.Parameters.AddValue("$packageType", x.SoftwarePackageType); c.Parameters.AddValue("$hardwareVersion", x.CompatibleHardwareVersion);
        c.Parameters.AddValue("$platform", x.CompatiblePlatform); c.Parameters.AddValue("$flashMethod", x.FlashMethod);
        c.Parameters.AddValue("$flashTool", x.FlashTool); c.Parameters.AddValue("$dependency", x.DependencyDescription);
        c.Parameters.AddValue("$releaseNote", x.ReleaseNotePath); c.Parameters.AddValue("$flashGuide", x.FlashGuidePath);
        c.Parameters.AddValue("$remark", x.Remark);
        if (await c.ExecuteNonQueryAsync(ct) == 0) throw new InvalidOperationException("无法解析该交付物的类别，请检查基础数据配置。");
    }

    private static async Task InsertPrdAsync(SqliteConnection connection, SqliteTransaction transaction, int versionId, PrdDetailRequest x, CancellationToken ct)
    {
        await using var c = connection.CreateCommand(); c.Transaction = transaction;
        c.CommandText = """
            INSERT INTO PrdDetails(VersionId,ProductModule,FunctionName,RequirementSource,TargetVehicle,TargetProductVersion,
                TargetMilestone,ProductOwner,Reviewers,ReferenceBasis,InScope,OutOfScope)
            VALUES($id,$module,$function,$source,$vehicle,$productVersion,$milestone,$owner,$reviewers,$basis,$inScope,$outScope);
            """;
        c.Parameters.AddValue("$id", versionId); c.Parameters.AddValue("$module", x.ProductModule); c.Parameters.AddValue("$function", x.FunctionName);
        c.Parameters.AddValue("$source", x.RequirementSource); c.Parameters.AddValue("$vehicle", x.TargetVehicle); c.Parameters.AddValue("$productVersion", x.TargetProductVersion);
        c.Parameters.AddValue("$milestone", x.TargetMilestone); c.Parameters.AddValue("$owner", x.ProductOwner); c.Parameters.AddValue("$reviewers", x.Reviewers);
        c.Parameters.AddValue("$basis", x.ReferenceBasis); c.Parameters.AddValue("$inScope", x.InScope); c.Parameters.AddValue("$outScope", x.OutOfScope);
        await c.ExecuteNonQueryAsync(ct);
    }

    private static async Task InsertFrAsync(SqliteConnection connection, SqliteTransaction transaction, int versionId, FrDetailRequest x, CancellationToken ct)
    {
        await using var c = connection.CreateCommand(); c.Transaction = transaction;
        c.CommandText = """
            INSERT INTO FrDetails(VersionId,SystemName,SubsystemName,FunctionModule,UpstreamPrdCode,UpstreamPrdVersion,
                FunctionOwner,SystemOwner,TargetSoftwareBaseline,TargetMilestone,InterfaceImpact,SafetyLevel)
            VALUES($id,$system,$subsystem,$module,$prdCode,$prdVersion,$functionOwner,$systemOwner,$baseline,$milestone,$impact,$safety);
            """;
        c.Parameters.AddValue("$id", versionId); c.Parameters.AddValue("$system", x.SystemName); c.Parameters.AddValue("$subsystem", x.SubsystemName);
        c.Parameters.AddValue("$module", x.FunctionModule); c.Parameters.AddValue("$prdCode", x.UpstreamPrdCode); c.Parameters.AddValue("$prdVersion", x.UpstreamPrdVersion);
        c.Parameters.AddValue("$functionOwner", x.FunctionOwner); c.Parameters.AddValue("$systemOwner", x.SystemOwner); c.Parameters.AddValue("$baseline", x.TargetSoftwareBaseline);
        c.Parameters.AddValue("$milestone", x.TargetMilestone); c.Parameters.AddValue("$impact", x.InterfaceImpact); c.Parameters.AddValue("$safety", x.SafetyLevel);
        await c.ExecuteNonQueryAsync(ct);
    }

    private static async Task InsertTestCaseAsync(SqliteConnection connection, SqliteTransaction transaction, int versionId, TestCaseDetailRequest x, CancellationToken ct)
    {
        await using var c = connection.CreateCommand(); c.Transaction = transaction;
        c.CommandText = """
            INSERT INTO TestCaseDetails(VersionId,TestLevel,TestModule,UpstreamFrCode,UpstreamFrVersion,CaseCount,CoverageScope,
                TestEnvironment,TestOwner,ApplicableSoftwareVersion,AutomatedCaseCount,ManualCaseCount)
            VALUES($id,$level,$module,$frCode,$frVersion,$caseCount,$coverage,$environment,$owner,$softwareVersion,$autoCount,$manualCount);
            """;
        c.Parameters.AddValue("$id", versionId); c.Parameters.AddValue("$level", x.TestLevel); c.Parameters.AddValue("$module", x.TestModule);
        c.Parameters.AddValue("$frCode", x.UpstreamFrCode); c.Parameters.AddValue("$frVersion", x.UpstreamFrVersion); c.Parameters.AddValue("$caseCount", x.CaseCount);
        c.Parameters.AddValue("$coverage", x.CoverageScope); c.Parameters.AddValue("$environment", x.TestEnvironment); c.Parameters.AddValue("$owner", x.TestOwner);
        c.Parameters.AddValue("$softwareVersion", x.ApplicableSoftwareVersion); c.Parameters.AddValue("$autoCount", x.AutomatedCaseCount); c.Parameters.AddValue("$manualCount", x.ManualCaseCount);
        await c.ExecuteNonQueryAsync(ct);
    }

    private static async Task InsertAuditAsync(SqliteConnection connection, SqliteTransaction transaction, string entityType,
        int entityId, string actionType, string operatorName, string summary, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO AuditLogs(EntityType,EntityId,ActionType,Operator,Summary,CreatedAt) VALUES($entityType,$entityId,$actionType,$operator,$summary,$now)";
        command.Parameters.AddValue("$entityType", entityType); command.Parameters.AddValue("$entityId", entityId);
        command.Parameters.AddValue("$actionType", actionType); command.Parameters.AddValue("$operator", operatorName);
        command.Parameters.AddValue("$summary", summary); command.Parameters.AddValue("$now", DateTime.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string NormalizeCode(string value)
    {
        var normalized = new string(value.Trim().ToUpperInvariant().Where(c => char.IsLetterOrDigit(c)).ToArray());
        if (string.IsNullOrEmpty(normalized)) throw new ArgumentException("对象编码只能包含字母或数字。" );
        return normalized;
    }

    private static string NormalizeVersion(string value)
    {
        var version = value.Trim().ToUpperInvariant();
        if (!version.StartsWith('V')) version = "V" + version;
        if (!System.Text.RegularExpressions.Regex.IsMatch(version, "^V\\d+\\.\\d+\\.\\d+$"))
            throw new ArgumentException("内部版本号必须符合 V主版本.次版本.修订版本，例如 V1.0.0。" );
        return version;
    }

    private static string ResolveExtension(string? extension, string originalFileName)
    {
        var value = string.IsNullOrWhiteSpace(extension) ? Path.GetExtension(originalFileName) : extension;
        if (string.IsNullOrWhiteSpace(value)) return "";
        return value.StartsWith('.') ? value.ToLowerInvariant() : "." + value.ToLowerInvariant();
    }

    private static string BuildUnifiedFileName(string code, string name, string version, string status, string extension)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var safeName = new string(name.Trim().Select(c => invalid.Contains(c) ? '_' : c).ToArray()).Replace(' ', '_');
        return $"{code}_{safeName}_{version}_{status}_{DateTime.Now:yyyyMMdd}{extension}";
    }
}
