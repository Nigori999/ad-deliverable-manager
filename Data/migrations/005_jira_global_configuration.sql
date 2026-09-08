CREATE TABLE IF NOT EXISTS JiraGlobalConfiguration (
    Id INTEGER PRIMARY KEY CHECK(Id=1),
    BaseUrl TEXT NOT NULL,
    Username TEXT NOT NULL,
    PasswordCipher TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE JiraQueryPresets ADD COLUMN VariantFieldId TEXT NOT NULL DEFAULT '';
