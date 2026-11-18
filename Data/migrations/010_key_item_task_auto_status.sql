DROP INDEX IF EXISTS IX_KeyItemTasks_KeyItemStart;

CREATE TABLE KeyItemTasks_New (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    KeyItemId INTEGER NOT NULL,
    TaskName TEXT NOT NULL,
    PlannedStartDate TEXT NOT NULL,
    PlannedEndDate TEXT NOT NULL,
    ActualEndDate TEXT,
    Output TEXT,
    ResponsiblePerson TEXT NOT NULL,
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(KeyItemId) REFERENCES KeyItems(Id) ON DELETE CASCADE
);

INSERT INTO KeyItemTasks_New(Id,KeyItemId,TaskName,PlannedStartDate,PlannedEndDate,ActualEndDate,Output,ResponsiblePerson,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision)
SELECT Id,KeyItemId,TaskName,COALESCE(PlannedStartDate,PlannedEndDate),PlannedEndDate,ActualEndDate,Output,ResponsiblePerson,CreatedBy,CreatedAt,UpdatedBy,UpdatedAt,Revision
FROM KeyItemTasks;

DROP TABLE KeyItemTasks;
ALTER TABLE KeyItemTasks_New RENAME TO KeyItemTasks;

CREATE INDEX IF NOT EXISTS IX_KeyItemTasks_KeyItem ON KeyItemTasks(KeyItemId,PlannedEndDate);
CREATE INDEX IF NOT EXISTS IX_KeyItemTasks_KeyItemStart ON KeyItemTasks(KeyItemId,PlannedStartDate);
