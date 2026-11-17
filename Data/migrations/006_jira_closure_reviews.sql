CREATE TABLE JiraClosureReviews (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    JiraBaseUrl TEXT NOT NULL,
    IssueId TEXT NOT NULL,
    ProjectKey TEXT NOT NULL,
    IssueKey TEXT NOT NULL,
    SnapshotJson TEXT NOT NULL,
    Reason TEXT NOT NULL,
    ResponsiblePerson TEXT NOT NULL,
    CategoryItemId INTEGER NOT NULL REFERENCES DictionaryItems(Id),
    CreatedBy TEXT NOT NULL,
    CreatedAt TEXT NOT NULL,
    UpdatedBy TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL,
    Revision INTEGER NOT NULL DEFAULT 1,
    UNIQUE(JiraBaseUrl, IssueId)
);
CREATE INDEX IX_JiraClosureReviews_Source ON JiraClosureReviews(JiraBaseUrl, ProjectKey, UpdatedAt);
CREATE INDEX IX_JiraClosureReviews_Category ON JiraClosureReviews(CategoryItemId);

INSERT INTO DictionaryTypes(Code,Name,Description,ScopeMode,StructureMode,IsSystem,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
VALUES('JIRA_OVERTIME_REASON','Jira超时原因分类','用于已关闭问题的超期复盘与原因分析。','NONE','FLAT',1,140,1,datetime('now'),datetime('now'));

INSERT INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT d.Id,v.Code,v.Name,'','',v.SortOrder,1,datetime('now'),datetime('now')
FROM DictionaryTypes d CROSS JOIN (
    SELECT 'ANALYSIS' Code,'定位分析耗时' Name,10 SortOrder UNION ALL
    SELECT 'DEPENDENCY','跨团队或供应商依赖',20 UNION ALL
    SELECT 'RESOURCE','资源排期',30 UNION ALL
    SELECT 'VALIDATION','验证与环境限制',40 UNION ALL
    SELECT 'REWORK','修复返工',50 UNION ALL
    SELECT 'OTHER','其他',90
) v WHERE d.Code='JIRA_OVERTIME_REASON';
