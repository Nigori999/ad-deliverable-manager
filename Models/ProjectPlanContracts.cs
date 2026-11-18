namespace AdDeliverableManager.Models;

public sealed class VehicleProjectPlanRequest
{
    public int ProjectId { get; set; }
    public string PlannedStartDate { get; set; } = "";
    public string PlannedEndDate { get; set; } = "";
}

public sealed class ProjectPlanNodeRequest
{
    public int? ParentNodeId { get; set; }
    public string NodeName { get; set; } = "";
    public string PlannedEndDate { get; set; } = "";
    public int Revision { get; set; }
}

public sealed class ProjectPlanItemRequest
{
    public string ItemName { get; set; } = "";
    public string PlannedStartDate { get; set; } = "";
    public string PlannedEndDate { get; set; } = "";
    public int Revision { get; set; }
}

public sealed class KeyItemRequest
{
    public string Topic { get; set; } = "";
    public string ResponsiblePerson { get; set; } = "";
    public string PlannedEndDate { get; set; } = "";
    public string? ActualEndDate { get; set; }
    public string Status { get; set; } = "NEW";
    public int? ProjectPlanNodeId { get; set; }
    public int Revision { get; set; }
}

public sealed class KeyItemTaskRequest
{
    public string TaskName { get; set; } = "";
    public string PlannedStartDate { get; set; } = "";
    public string PlannedEndDate { get; set; } = "";
    public string? ActualEndDate { get; set; }
    public string? Output { get; set; }
    public string ResponsiblePerson { get; set; } = "";
    public int Revision { get; set; }
}

public sealed class KeyItemTaskCompletionRequest
{
    public bool IsCompleted { get; set; }
    public int Revision { get; set; }
}
