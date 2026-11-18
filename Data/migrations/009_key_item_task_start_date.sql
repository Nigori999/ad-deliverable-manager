ALTER TABLE KeyItemTasks ADD COLUMN PlannedStartDate TEXT;

CREATE INDEX IF NOT EXISTS IX_KeyItemTasks_KeyItemStart ON KeyItemTasks(KeyItemId,PlannedStartDate);
