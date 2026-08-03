namespace AdDeliverableManager.Models;

public sealed record LookupItem(int Id, string Code, string Name, int? ParentId = null, bool Flag = false);

public sealed class DeliverableCreateRequest
{
    public int DepartmentId { get; set; }
    public int DeliverableTypeId { get; set; }
    public int ProjectId { get; set; }
    public string ObjectCode { get; set; } = "";
    public string UnifiedName { get; set; } = "";
    public string? BusinessModule { get; set; }
    public string ResponsiblePerson { get; set; } = "";
    public string ConfidentialityLevel { get; set; } = "INTERNAL";
    public string SharePolicy { get; set; } = "APPROVAL_REQUIRED";
    public string? Description { get; set; }
    public string Operator { get; set; } = "系统用户";
    public VersionCreateRequest InitialVersion { get; set; } = new();
}

public sealed class DeliverableUpdateRequest
{
    public string UnifiedName { get; set; } = "";
    public string? BusinessModule { get; set; }
    public string ResponsiblePerson { get; set; } = "";
    public string ConfidentialityLevel { get; set; } = "INTERNAL";
    public string SharePolicy { get; set; } = "APPROVAL_REQUIRED";
    public string? Description { get; set; }
    public int Revision { get; set; }
    public string Operator { get; set; } = "系统用户";
}

public sealed class VersionCreateRequest
{
    public string InternalVersion { get; set; } = "V0.1.0";
    public string? OriginalVersion { get; set; }
    public string OriginalFileName { get; set; } = "";
    public string ServerPath { get; set; } = "";
    public string? FileExtension { get; set; }
    public long? FileSize { get; set; }
    public string? HashAlgorithm { get; set; }
    public string? HashValue { get; set; }
    public string? ChangeSummary { get; set; }
    public string Author { get; set; } = "";
    public string? PlannedReleaseDate { get; set; }
    public string Operator { get; set; } = "系统用户";
    public HardwarePackageRequest? Hardware { get; set; }
    public PrdDetailRequest? Prd { get; set; }
    public FrDetailRequest? Fr { get; set; }
    public TestCaseDetailRequest? TestCase { get; set; }
}

public sealed class HardwarePackageRequest
{
    public string? HardwareCategory { get; set; }
    public string? HardwareModel { get; set; }
    public string? SupplierName { get; set; }
    public string? SupplierPartNumber { get; set; }
    public string? InternalPartNumber { get; set; }
    public string? SoftwarePackageType { get; set; }
    public string? CompatibleHardwareVersion { get; set; }
    public string? CompatiblePlatform { get; set; }
    public string? FlashMethod { get; set; }
    public string? FlashTool { get; set; }
    public string? DependencyDescription { get; set; }
    public string? ReleaseNotePath { get; set; }
    public string? FlashGuidePath { get; set; }
    public string? Remark { get; set; }
}

public sealed class PrdDetailRequest
{
    public string? ProductModule { get; set; }
    public string? FunctionName { get; set; }
    public string? RequirementSource { get; set; }
    public string? TargetVehicle { get; set; }
    public string? TargetProductVersion { get; set; }
    public string? TargetMilestone { get; set; }
    public string? ProductOwner { get; set; }
    public string? Reviewers { get; set; }
    public string? ReferenceBasis { get; set; }
    public string? InScope { get; set; }
    public string? OutOfScope { get; set; }
}

public sealed class FrDetailRequest
{
    public string? SystemName { get; set; }
    public string? SubsystemName { get; set; }
    public string? FunctionModule { get; set; }
    public string? UpstreamPrdCode { get; set; }
    public string? UpstreamPrdVersion { get; set; }
    public string? FunctionOwner { get; set; }
    public string? SystemOwner { get; set; }
    public string? TargetSoftwareBaseline { get; set; }
    public string? TargetMilestone { get; set; }
    public string? InterfaceImpact { get; set; }
    public string? SafetyLevel { get; set; }
}

public sealed class TestCaseDetailRequest
{
    public string? TestLevel { get; set; }
    public string? TestModule { get; set; }
    public string? UpstreamFrCode { get; set; }
    public string? UpstreamFrVersion { get; set; }
    public int? CaseCount { get; set; }
    public string? CoverageScope { get; set; }
    public string? TestEnvironment { get; set; }
    public string? TestOwner { get; set; }
    public string? ApplicableSoftwareVersion { get; set; }
    public int? AutomatedCaseCount { get; set; }
    public int? ManualCaseCount { get; set; }
}

public sealed class LifecycleActionRequest
{
    public string Operator { get; set; } = "系统用户";
    public string? Reason { get; set; }
    public int? ReplacementVersionId { get; set; }
}

public sealed class ProjectCreateRequest
{
    public string ProjectCode { get; set; } = "";
    public string ProjectName { get; set; } = "";
    public string? VehicleModel { get; set; }
    public string? PlatformName { get; set; }
}

public sealed class ChangeCreateRequest
{
    public int DeliverableId { get; set; }
    public int? FromVersionId { get; set; }
    public string ChangeType { get; set; } = "CONTENT_CHANGE";
    public string ChangeReason { get; set; } = "";
    public string ChangeContent { get; set; } = "";
    public string? ImpactScope { get; set; }
    public string? RelatedIssueCode { get; set; }
    public string Applicant { get; set; } = "";
    public string ResponsiblePerson { get; set; } = "";
    public string? PlannedCompletionDate { get; set; }
}

public sealed class ChangeActionRequest
{
    public string Operator { get; set; } = "系统用户";
    public string? Opinion { get; set; }
    public int? ToVersionId { get; set; }
}
