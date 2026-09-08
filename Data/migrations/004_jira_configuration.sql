CREATE TABLE IF NOT EXISTS JiraProjectStandards (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    JiraBaseUrl TEXT NOT NULL COLLATE NOCASE,
    ProjectKey TEXT NOT NULL COLLATE NOCASE,
    ProjectName TEXT NOT NULL,
    IsEnabled INTEGER NOT NULL DEFAULT 1,
    StagesJson TEXT NOT NULL,
    ClosureLimitsJson TEXT NOT NULL,
    RuleNote TEXT NOT NULL DEFAULT '',
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(JiraBaseUrl, ProjectKey)
);

CREATE TABLE IF NOT EXISTS JiraQueryPresets (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    UserId INTEGER NOT NULL,
    JiraBaseUrl TEXT NOT NULL COLLATE NOCASE,
    ProjectKey TEXT NOT NULL COLLATE NOCASE,
    Name TEXT NOT NULL COLLATE NOCASE,
    SeverityFieldId TEXT NOT NULL,
    ConditionsJson TEXT NOT NULL,
    AdditionalJql TEXT NOT NULL DEFAULT '',
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(UserId, JiraBaseUrl, ProjectKey, Name),
    FOREIGN KEY(UserId) REFERENCES Users(Id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS IX_JiraProjectStandards_Project
ON JiraProjectStandards(JiraBaseUrl, ProjectKey, IsEnabled);

CREATE INDEX IF NOT EXISTS IX_JiraQueryPresets_UserProject
ON JiraQueryPresets(UserId, JiraBaseUrl, ProjectKey, UpdatedAt);
