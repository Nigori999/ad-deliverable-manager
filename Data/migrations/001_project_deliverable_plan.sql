DROP TABLE IF EXISTS DeliverableSchedules;

CREATE TABLE IF NOT EXISTS ProjectDeliverablePlans (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    ProjectId INTEGER NOT NULL,
    CategoryId INTEGER NOT NULL,
    PlannedDeliveryDate TEXT NOT NULL,
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(ProjectId, CategoryId),
    FOREIGN KEY(ProjectId) REFERENCES Projects(Id),
    FOREIGN KEY(CategoryId) REFERENCES DictionaryItems(Id)
);

CREATE INDEX IF NOT EXISTS IX_ProjectDeliverablePlans_Project
    ON ProjectDeliverablePlans(ProjectId);
CREATE INDEX IF NOT EXISTS IX_ProjectDeliverablePlans_Category
    ON ProjectDeliverablePlans(CategoryId);
CREATE INDEX IF NOT EXISTS IX_ProjectDeliverablePlans_PlannedDate
    ON ProjectDeliverablePlans(PlannedDeliveryDate);
