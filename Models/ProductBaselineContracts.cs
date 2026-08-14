namespace AdDeliverableManager.Models;

public sealed record ProductBaselineCreateRequest(string ProductName, string Description, string VehicleModels, string Odd, string Capabilities);
public sealed record ProductBaselineUpdateRequest(string ProductName, string Description, string VehicleModels, string Odd, string Capabilities, List<ProductBaselineHardwareRequest> Hardware, List<ProductBaselineDeliverableRequest> Deliverables, int Revision);
public sealed record ProductBaselineHardwareRequest(string HardwareCategory, string HardwareModel, int SoftwareVersionId);
public sealed record ProductBaselineDeliverableRequest(string RoleCode, int VersionId);
public sealed record ProductBaselineCopyRequest(string VersionType);
public sealed record ProductBaselineChangeRequest(string ChangeReason, string Description, string VehicleModels, string Odd, string Capabilities, int Revision);
