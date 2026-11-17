CREATE TABLE IF NOT EXISTS VehicleProjectPlans (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    ProjectId INTEGER NOT NULL UNIQUE,
    PlannedStartDate TEXT NOT NULL,
    PlannedEndDate TEXT NOT NULL,
    IsEnabled INTEGER NOT NULL DEFAULT 1,
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(ProjectId) REFERENCES Projects(Id)
);

CREATE TABLE IF NOT EXISTS ProjectPlanNodes (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    PlanId INTEGER NOT NULL,
    ParentNodeId INTEGER,
    NodeLevel INTEGER NOT NULL CHECK(NodeLevel BETWEEN 1 AND 3),
    NodeName TEXT NOT NULL,
    PlannedEndDate TEXT NOT NULL,
    IsActive INTEGER NOT NULL DEFAULT 1,
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(PlanId) REFERENCES VehicleProjectPlans(Id) ON DELETE CASCADE,
    FOREIGN KEY(ParentNodeId) REFERENCES ProjectPlanNodes(Id)
);

CREATE TABLE IF NOT EXISTS ProjectPlanItems (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    NodeId INTEGER NOT NULL,
    ItemName TEXT NOT NULL,
    PlannedStartDate TEXT NOT NULL,
    PlannedEndDate TEXT NOT NULL,
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(NodeId) REFERENCES ProjectPlanNodes(Id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS KeyItems (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Topic TEXT NOT NULL,
    ResponsiblePerson TEXT NOT NULL,
    PlannedEndDate TEXT NOT NULL,
    ActualEndDate TEXT,
    ManualStatus TEXT NOT NULL DEFAULT 'NEW',
    ProjectPlanNodeId INTEGER NOT NULL,
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(ProjectPlanNodeId) REFERENCES ProjectPlanNodes(Id)
);

CREATE TABLE IF NOT EXISTS KeyItemTasks (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    KeyItemId INTEGER NOT NULL,
    TaskName TEXT NOT NULL,
    ManualStatus TEXT NOT NULL DEFAULT 'NOT_STARTED',
    PlannedEndDate TEXT NOT NULL,
    ActualEndDate TEXT,
    Output TEXT,
    HasRisk INTEGER NOT NULL DEFAULT 0,
    RiskDescription TEXT,
    ResponsiblePerson TEXT NOT NULL,
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(KeyItemId) REFERENCES KeyItems(Id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS IX_VehicleProjectPlans_Project ON VehicleProjectPlans(ProjectId);
CREATE INDEX IF NOT EXISTS IX_ProjectPlanNodes_PlanParent ON ProjectPlanNodes(PlanId,ParentNodeId,NodeLevel,PlannedEndDate);
CREATE INDEX IF NOT EXISTS IX_ProjectPlanItems_Node ON ProjectPlanItems(NodeId,PlannedStartDate);
CREATE INDEX IF NOT EXISTS IX_KeyItems_Node ON KeyItems(ProjectPlanNodeId,PlannedEndDate);
CREATE INDEX IF NOT EXISTS IX_KeyItemTasks_KeyItem ON KeyItemTasks(KeyItemId,PlannedEndDate);
CREATE INDEX IF NOT EXISTS IX_Deliverables_TypeId_Correct ON Deliverables(DeliverableTypeId);
