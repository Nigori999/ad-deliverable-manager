CREATE TABLE JiraCategoryMappings (
    DictionaryItemId INTEGER NOT NULL REFERENCES DictionaryItems(Id) ON DELETE CASCADE,
    FieldId TEXT NOT NULL DEFAULT '',
    MatchType TEXT NOT NULL CHECK(MatchType IN ('ID','NAME')),
    MatchValue TEXT NOT NULL CHECK(length(MatchValue)>0),
    CHECK(MatchType<>'ID' OR length(FieldId)>0),
    PRIMARY KEY(FieldId,MatchType,MatchValue)
);
CREATE INDEX IX_JiraCategoryMappings_Item ON JiraCategoryMappings(DictionaryItemId);

INSERT INTO DictionaryTypes(Code,Name,Description,ScopeMode,StructureMode,IsSystem,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
VALUES('JIRA_ISSUE_CATEGORY','JIRA问题分类','维护大类与细分项，并在字典项中配置对应的JIRA字段选项。分类调整在重新分析后生效。','NONE','TREE',1,150,1,datetime('now'),datetime('now'));
INSERT INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT d.Id,v.Code,v.Name,'','',v.SortOrder,1,datetime('now'),datetime('now')
FROM DictionaryTypes d CROSS JOIN (
    SELECT 'ADS' Code,'ADS' Name,10 SortOrder UNION ALL
    SELECT 'SENSOR','传感器',20
) v WHERE d.Code='JIRA_ISSUE_CATEGORY';
INSERT INTO DictionaryItems(DictionaryTypeId,ItemCode,ItemName,ScopeType,ScopeValue,ParentItemId,SortOrder,IsEnabled,CreatedAt,UpdatedAt)
SELECT d.Id,v.Code,v.Name,'','',p.Id,v.SortOrder,1,datetime('now'),datetime('now')
FROM DictionaryTypes d JOIN DictionaryItems p ON p.DictionaryTypeId=d.Id AND p.ItemCode='SENSOR'
CROSS JOIN (
    SELECT 'MMW_RADAR' Code,'毫米波雷达' Name,10 SortOrder UNION ALL
    SELECT 'LIDAR','激光雷达',20 UNION ALL
    SELECT 'CAMERA','摄像头',30
) v WHERE d.Code='JIRA_ISSUE_CATEGORY';
-- Only confirmed source names are mapped. Other options remain visible as unclassified.
INSERT INTO JiraCategoryMappings(DictionaryItemId,FieldId,MatchType,MatchValue)
SELECT i.Id,'','NAME',v.SourceName
FROM DictionaryTypes d JOIN DictionaryItems i ON i.DictionaryTypeId=d.Id
JOIN (SELECT 'ADS' Code,'ADS' SourceName UNION ALL SELECT 'ADS','ADCU' UNION ALL SELECT 'LIDAR','LiDAR') v ON v.Code=i.ItemCode
WHERE d.Code='JIRA_ISSUE_CATEGORY';
