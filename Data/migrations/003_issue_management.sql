CREATE TABLE IF NOT EXISTS IssueSnapshots (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    DepartmentItemId INTEGER NOT NULL,
    SourceItemId INTEGER NOT NULL,
    SeverityItemId INTEGER NOT NULL,
    RecordDate TEXT NOT NULL,
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(RecordDate, DepartmentItemId, SourceItemId, SeverityItemId),
    FOREIGN KEY(DepartmentItemId) REFERENCES DictionaryItems(Id),
    FOREIGN KEY(SourceItemId) REFERENCES DictionaryItems(Id),
    FOREIGN KEY(SeverityItemId) REFERENCES DictionaryItems(Id)
);

CREATE TABLE IF NOT EXISTS IssueSnapshotCounts (
    SnapshotId INTEGER NOT NULL,
    StatusItemId INTEGER NOT NULL,
    IssueCount INTEGER NOT NULL CHECK(IssueCount >= 0),
    PRIMARY KEY(SnapshotId, StatusItemId),
    FOREIGN KEY(SnapshotId) REFERENCES IssueSnapshots(Id) ON DELETE CASCADE,
    FOREIGN KEY(StatusItemId) REFERENCES DictionaryItems(Id)
);

CREATE INDEX IF NOT EXISTS IX_IssueSnapshots_RecordDate ON IssueSnapshots(RecordDate);
CREATE INDEX IF NOT EXISTS IX_IssueSnapshots_Department ON IssueSnapshots(DepartmentItemId);
CREATE INDEX IF NOT EXISTS IX_IssueSnapshots_Source ON IssueSnapshots(SourceItemId);
CREATE INDEX IF NOT EXISTS IX_IssueSnapshots_Severity ON IssueSnapshots(SeverityItemId);
CREATE INDEX IF NOT EXISTS IX_IssueSnapshotCounts_Status ON IssueSnapshotCounts(StatusItemId);

INSERT OR IGNORE INTO DictionaryTypes(Code,Name,Description,ScopeMode,StructureMode,IsSystem,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
VALUES
('ISSUE_DEPARTMENT','问题所属部门','用于问题汇总快照和管理驾驶舱的部门维度，与交付物业务部门独立。','NONE','FLAT',1,100,1,datetime('now'),datetime('now')),
('ISSUE_SOURCE','问题来源','用于标识问题汇总数据来自哪个内部或外部系统。','NONE','FLAT',1,110,1,datetime('now'),datetime('now')),
('ISSUE_SEVERITY','问题严重等级','用于问题风险分层和严重等级占比分析。','NONE','FLAT',1,120,1,datetime('now'),datetime('now')),
('ISSUE_STATUS','问题状态','用于动态配置问题快照需要录入和堆积展示的状态。','NONE','FLAT',1,130,1,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT dictionary.Id,department.DepartmentCode,department.DepartmentName,'','',department.SortOrder,1,datetime('now'),datetime('now')
FROM DictionaryTypes dictionary CROSS JOIN Departments department
WHERE dictionary.Code='ISSUE_DEPARTMENT' AND department.IsEnabled=1;

INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'JIRA','Jira','','',10,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_SOURCE';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'KTM','KTM','','',20,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_SOURCE';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'TEST_PLATFORM','测试平台','','',30,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_SOURCE';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'SUPPLIER','供应商系统','','',40,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_SOURCE';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'OTHER','其他来源','','',90,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_SOURCE';

INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'CRITICAL','致命','','',10,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_SEVERITY';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'HIGH','严重','','',20,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_SEVERITY';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'MEDIUM','一般','','',30,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_SEVERITY';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'LOW','轻微','','',40,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_SEVERITY';

INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'NEW','新增','','',10,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_STATUS';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'IN_PROGRESS','处理中','','',20,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_STATUS';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'RESOLVED','已解决','','',30,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_STATUS';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'CLOSED','已关闭','','',40,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_STATUS';
INSERT OR IGNORE INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT Id,'OVERDUE','已延期','','',50,1,datetime('now'),datetime('now') FROM DictionaryTypes WHERE Code='ISSUE_STATUS';
