CREATE TABLE IF NOT EXISTS DeliverableSchedules (
    DeliverableId INTEGER PRIMARY KEY,
    PlannedDeliveryDate TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(DeliverableId) REFERENCES Deliverables(Id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS IX_DeliverableSchedules_PlannedDeliveryDate
    ON DeliverableSchedules(PlannedDeliveryDate);
